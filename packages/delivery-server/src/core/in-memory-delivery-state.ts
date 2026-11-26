/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { createHash } from "node:crypto";
import {
  InboxMessageStatus,
  type InboxMessage,
  type ShardIndex,
  type WorkerId,
} from "@spine-event-engine/proto/delivery";

import type { Timestamp } from "@bufbuild/protobuf/wkt";

import { DeliveryMessages, DeliveryShards, DeliveryWorkers } from "./wire-values.js";

/**
 * Represents retained pickup state for one delivery shard.
 */
export interface ShardRecord {
  // prettier-ignore

  /**
   * Identifies the tracked shard.
   */
  readonly shard: ShardIndex;

  /**
   * Identifies the current worker when picked.
   */
  readonly worker: WorkerId | undefined;

  /**
   * Records the latest pickup or renewal with full timestamp precision.
   */
  readonly whenLastPicked: Timestamp | undefined;

  /**
   * Identifies one fresh pickup across its renewals.
   */
  readonly sessionId?: string;

  /**
   * Distinguishes raw and work-aware pickup behavior.
   */
  readonly kind?: "RAW" | "MANAGED";

  /**
   * Changes on each renewal to guard replacement of the current record.
   */
  readonly revision?: number;
}

/**
 * Stores one shard's retained and pending rows in delivery order.
 */
interface ShardBucket {
  readonly shard: ShardIndex;
  readonly ordered: InboxMessage[];
  readonly pending: InboxMessage[];
}

/**
 * Package-private canonical detached state; a new instance deliberately starts empty.
 */
export class InMemoryDeliveryState {
  // prettier-ignore

  /**
   * Stores messages by stable identity.
   */
  readonly messages: Map<string, InboxMessage> = new Map<string, InboxMessage>();

  /**
   * Stores sessions by stable shard identity.
   */
  readonly shards: Map<string, ShardRecord> = new Map<string, ShardRecord>();

  readonly #acknowledgements = new Map<string, string>();

  readonly #buckets = new Map<string, ShardBucket>();

  /**
   * Stores a validated batch atomically.
   *
   * @param messages Supplies validated messages.
   * @returns Lists newly inserted messages.
   */
  putAll(messages: readonly { readonly message: InboxMessage }[]): InboxMessage[] {
    const inserted: InboxMessage[] = [];
    const seen = new Set<string>();
    const final = new Map<string, { readonly message: InboxMessage }>();
    for (const candidate of messages) {
      const key = DeliveryMessages.key(candidate.message);
      if (!this.messages.has(key) && !seen.has(key)) inserted.push(candidate.message);
      seen.add(key);
      final.set(key, candidate);
    }
    for (const [key, candidate] of final) this.#replace(key, candidate.message);
    return inserted;
  }

  /**
   * Deletes a message.
   *
   * @param message Identifies the message.
   * @returns Reports whether the message existed.
   */
  delete(message: InboxMessage): boolean {
    const key = DeliveryMessages.key(message);
    const current = this.messages.get(key);
    if (current === undefined) return false;
    this.messages.delete(key);
    this.#acknowledgements.delete(key);
    this.#removeFromBucket(current);
    this.#pruneBucket(DeliveryShards.key(this.#requiredShard(current)));
    return true;
  }

  /**
   * Records the exact wire transition performed by a guarded acknowledgement.
   *
   * @param key Identifies the retained row.
   * @param expected Encodes its original pending snapshot.
   */
  rememberAcknowledgement(key: string, expected: Uint8Array): void {
    this.#acknowledgements.set(key, DeliveryBytes.digest(expected));
  }

  /**
   * Checks a retry against the exact first guarded completion.
   *
   * @param key Identifies the retained row.
   * @param expected Encodes its original pending snapshot.
   * @returns Whether the first completion remains unchanged.
   */
  sameAcknowledgement(key: string, expected: Uint8Array): boolean {
    return this.#acknowledgements.get(key) === DeliveryBytes.digest(expected);
  }

  /**
   * Finds an active shard session.
   *
   * @param shard Identifies the shard.
   * @returns Provides the session when active.
   */
  session(shard: ShardIndex): ShardRecord | undefined {
    const record = this.shards.get(DeliveryShards.key(shard));
    return record?.worker === undefined ? undefined : record;
  }

  /**
   * Determines whether a shard has a retained `TO_DELIVER` message awaiting delivery.
   *
   * @param shard Identifies the shard to inspect.
   * @returns Whether the shard has at least one retained `TO_DELIVER` message.
   */
  hasPending(shard: ShardIndex): boolean {
    return (this.#buckets.get(DeliveryShards.key(shard))?.pending.length ?? 0) > 0;
  }

  /**
   * Returns the count of all retained rows in one shard, including completed rows.
   *
   * @param shard Identifies the shard.
   * @returns The exact stored-row count.
   */
  storedCount(shard: ShardIndex): number {
    return this.#buckets.get(DeliveryShards.key(shard))?.ordered.length ?? 0;
  }

  /**
   * Reads one shard in delivery order, strictly after an optional receive time.
   *
   * @param shard Identifies the shard.
   * @param sinceWhen Excludes rows received at or before this full timestamp.
   * @param size Sets the page size already validated by the RPC handler.
   * @returns A detached page in delivery order.
   */
  page(
    shard: ShardIndex,
    sinceWhen: { readonly seconds: bigint; readonly nanos: number } | undefined,
    size: number,
  ): InboxMessage[] {
    const rows = this.#buckets.get(DeliveryShards.key(shard))?.ordered ?? [];
    const page: InboxMessage[] = [];
    for (let index = DeliveryRowOrder.firstAfter(rows, sinceWhen); index < rows.length; index++) {
      const row = rows[index];
      if (row === undefined) throw new TypeError("Delivery row index is invalid.");
      page.push(DeliveryMessages.copy(row));
      if (page.length === size) break;
    }
    return page;
  }

  /**
   * Finds the last pending row in delivery order for one shard.
   *
   * @param shard Identifies the shard.
   * @returns A detached row or undefined when none remains.
   */
  newestPending(shard: ShardIndex): InboxMessage | undefined {
    const row = this.#buckets.get(DeliveryShards.key(shard))?.pending.at(-1);
    return row === undefined ? undefined : DeliveryMessages.copy(row);
  }

  /**
   * Lists shards with pending rows without visiting unrelated Inbox records.
   *
   * @returns Detached shard identities.
   */
  *pendingShards(): Iterable<ShardIndex> {
    for (const bucket of this.#buckets.values())
      if (bucket.pending.length > 0) yield DeliveryShards.copy(bucket.shard);
  }

  /**
   * Lists known retained or session shards in deterministic order.
   *
   * @returns Detached shard identities.
   */
  *knownShards(): Iterable<ShardIndex> {
    const all = new Map<string, ShardIndex>();
    for (const [key, bucket] of this.#buckets) all.set(key, bucket.shard);
    for (const [key, record] of this.shards) all.set(key, record.shard);
    yield* [...all.values()].sort((a, b) => DeliveryShards.compare(a, b)).map(DeliveryShards.copy);
  }

  /**
   * Stores a shard pickup session.
   *
   * @param shard Identifies the shard.
   * @param worker Identifies the worker.
   * @param whenPicked Records the pickup time.
   * @param sessionId Identifies the fresh pickup.
   * @param kind Distinguishes raw and managed pickup.
   * @param revision Changes on renewal.
   */
  setSession(
    shard: ShardIndex,
    worker: WorkerId,
    whenPicked: Timestamp,
    sessionId: string,
    kind: "RAW" | "MANAGED",
    revision = 1,
  ): void {
    this.shards.set(DeliveryShards.key(shard), {
      shard: DeliveryShards.copy(shard),
      worker: DeliveryWorkers.copy(worker),
      whenLastPicked: whenPicked,
      sessionId,
      kind,
      revision,
    });
  }

  /**
   * Removes an active shard session.
   *
   * @param shard Identifies the shard.
   * @returns Provides the former session when active.
   */
  release(shard: ShardIndex): ShardRecord | undefined {
    const key = DeliveryShards.key(shard);
    const record = this.shards.get(key);
    if (record?.worker === undefined) return undefined;
    if (this.#buckets.has(key))
      this.shards.set(key, {
        shard: record.shard,
        worker: undefined,
        whenLastPicked: record.whenLastPicked,
      });
    else {
      this.shards.delete(key);
    }
    return record;
  }

  #replace(key: string, message: InboxMessage): void {
    this.#acknowledgements.delete(key);
    const prior = this.messages.get(key);
    if (prior !== undefined) {
      this.#removeFromBucket(prior);
    }
    const detached = DeliveryMessages.copy(message);
    this.messages.set(key, detached);
    const shard = this.#requiredShard(detached);
    const shardKey = DeliveryShards.key(shard);
    let bucket = this.#buckets.get(shardKey);
    if (bucket === undefined) {
      bucket = { shard: DeliveryShards.copy(shard), ordered: [], pending: [] };
      this.#buckets.set(shardKey, bucket);
    }
    DeliveryRowOrder.insert(bucket.ordered, detached);
    if (detached.status === InboxMessageStatus.TO_DELIVER)
      DeliveryRowOrder.insert(bucket.pending, detached);
  }

  #removeFromBucket(message: InboxMessage): void {
    const key = DeliveryShards.key(this.#requiredShard(message));
    const bucket = this.#buckets.get(key);
    if (bucket === undefined) throw new TypeError("Delivery message shard count is invalid.");
    DeliveryRowOrder.remove(bucket.ordered, message);
    if (message.status === InboxMessageStatus.TO_DELIVER)
      DeliveryRowOrder.remove(bucket.pending, message);
  }

  #pruneBucket(key: string): void {
    if (this.#buckets.get(key)?.ordered.length !== 0) return;
    this.#buckets.delete(key);
    if (this.shards.get(key)?.worker === undefined) this.shards.delete(key);
  }

  #requiredShard(message: InboxMessage): ShardIndex {
    if (message.id?.index === undefined)
      throw new TypeError("Delivery message identity is missing.");
    return message.id.index;
  }
}

/**
 * Digests encoded row snapshots without retaining a second payload.
 */
const DeliveryBytes = Object.freeze({
  /**
   * Calculates one exact wire encoding's digest.
   *
   * @param value Supplies the encoding.
   * @returns Its fixed-size SHA-256 digest.
   */
  digest(value: Uint8Array): string {
    return createHash("sha256").update(value).digest("hex");
  },
});

/**
 * Maintains the per-shard receive-time, version, and UTF-8 ID order.
 */
const DeliveryRowOrder = Object.freeze({
  /**
   * Compares two rows in delivery order.
   *
   * @param left Supplies the first row.
   * @param right Supplies the second row.
   * @returns A signed order comparison.
   */
  compare(left: InboxMessage, right: InboxMessage): number {
    const time = this.compareTime(left, right.whenReceived);
    if (time !== 0) return time;
    const version = left.version - right.version;
    if (version !== 0) return version;
    return Buffer.compare(Buffer.from(left.id?.uuid ?? ""), Buffer.from(right.id?.uuid ?? ""));
  },

  /**
   * Compares a row's full receive time with a timestamp.
   *
   * @param row Supplies the row.
   * @param time Supplies the comparison timestamp.
   * @returns A signed time comparison.
   */
  compareTime(
    row: InboxMessage,
    time: { readonly seconds: bigint; readonly nanos: number } | undefined,
  ): number {
    if (row.whenReceived === undefined || time === undefined)
      throw new TypeError("Delivery message receive time is missing.");
    if (row.whenReceived.seconds !== time.seconds)
      return row.whenReceived.seconds < time.seconds ? -1 : 1;
    return row.whenReceived.nanos - time.nanos;
  },

  /**
   * Finds the first row strictly after a full receive timestamp.
   *
   * @param rows Supplies the ordered shard index.
   * @param time Supplies the optional exclusive receive time.
   * @returns The first eligible row position.
   */
  firstAfter(
    rows: readonly InboxMessage[],
    time: { readonly seconds: bigint; readonly nanos: number } | undefined,
  ): number {
    if (time === undefined) return 0;
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const candidate = rows[middle];
      if (candidate === undefined) throw new TypeError("Delivery row index is invalid.");
      if (this.compareTime(candidate, time) <= 0) low = middle + 1;
      else high = middle;
    }
    return low;
  },

  /**
   * Adds a row at its sorted position.
   *
   * @param rows Supplies the mutable shard index.
   * @param row Supplies the row to insert.
   */
  insert(rows: InboxMessage[], row: InboxMessage): void {
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const candidate = rows[middle];
      if (candidate === undefined) throw new TypeError("Delivery row index is invalid.");
      if (this.compare(candidate, row) < 0) low = middle + 1;
      else high = middle;
    }
    rows.splice(low, 0, row);
  },

  /**
   * Removes one row from its shard index.
   *
   * @param rows Supplies the mutable shard index.
   * @param row Identifies the row to remove.
   */
  remove(rows: InboxMessage[], row: InboxMessage): void {
    const index = rows.findIndex((candidate) => candidate.id?.uuid === row.id?.uuid);
    if (index < 0) throw new TypeError("Delivery message shard count is invalid.");
    rows.splice(index, 1);
  },
});
