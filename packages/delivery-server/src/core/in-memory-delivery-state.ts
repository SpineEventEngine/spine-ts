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

import { OrderedMap } from "@js-sdsl/ordered-map";
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
  readonly ordered: OrderedMap<DeliveryOrderKey, InboxMessage>;
  readonly pending: OrderedMap<DeliveryOrderKey, InboxMessage>;
}

/**
 * Keys the two shard trees by the JVM receive-time, version, and UTF-8 UUID order.
 */
interface DeliveryOrderKey {
  readonly seconds: bigint;
  readonly nanos: number;
  readonly version: number;
  readonly uuid: Buffer;
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

  readonly #buckets = new Map<string, ShardBucket>();

  /**
   * Stores one validated inbox message and updates its shard's trees.
   *
   * @param message Supplies the new contents of this inbox ID.
   * @returns Whether the previous or new message is pending.
   */
  put(message: InboxMessage): boolean {
    return this.#replace(DeliveryMessages.key(message), message);
  }

  /**
   * Stores the last message for each inbox ID in a validated batch.
   *
   * @param messages Supplies the messages in request order.
   * @returns Whether the worker notification state needs to be checked.
   */
  putAll(messages: readonly { readonly message: InboxMessage }[]): boolean {
    const final = new Map<string, InboxMessage>();
    for (const { message } of messages) final.set(DeliveryMessages.key(message), message);
    let affectsWork = false;
    for (const [key, message] of final) {
      if (this.#replace(key, message)) affectsWork = true;
    }
    return affectsWork;
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
    this.#removeFromBucket(current);
    this.#pruneBucket(DeliveryShards.key(this.#requiredShard(current)));
    return true;
  }

  /**
   * Deletes the stored members of a validated shard batch from both trees.
   *
   * @param shard Identifies the validated batch shard.
   * @param messages Supplies requested row identities, including possible duplicates.
   * @returns Whether stored or pending rows changed.
   */
  deleteMany(
    shard: ShardIndex,
    messages: readonly InboxMessage[],
  ): { changed: boolean; pendingChanged: boolean } {
    const keys = new Set(messages.map(DeliveryMessages.key));
    let pendingChanged = false;
    let changed = false;
    for (const key of keys) {
      const current = this.messages.get(key);
      if (current === undefined) continue;
      changed = true;
      this.messages.delete(key);
      this.#removeFromBucket(current);
      pendingChanged ||= current.status === InboxMessageStatus.TO_DELIVER;
    }
    if (!changed) return { changed: false, pendingChanged: false };
    const shardKey = DeliveryShards.key(shard);
    this.#pruneBucket(shardKey);
    return { changed, pendingChanged };
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
    return (this.#buckets.get(DeliveryShards.key(shard))?.pending.size() ?? 0) > 0;
  }

  /**
   * Returns the count of all retained rows in one shard, including completed rows.
   *
   * @param shard Identifies the shard.
   * @returns The exact stored-row count.
   */
  storedCount(shard: ShardIndex): number {
    return this.#buckets.get(DeliveryShards.key(shard))?.ordered.size() ?? 0;
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
    const rows = this.#buckets.get(DeliveryShards.key(shard))?.ordered;
    if (rows === undefined) return [];
    const page: InboxMessage[] = [];
    // Any stored Protobuf version is finite. This key skips every message at sinceWhen.
    const start =
      sinceWhen === undefined
        ? rows.begin()
        : rows.upperBound({ ...sinceWhen, version: Infinity, uuid: Buffer.alloc(0) });
    const end = rows.end();
    for (const cursor = start; !cursor.equals(end); cursor.next()) {
      page.push(DeliveryMessages.copy(cursor.pointer[1]));
      if (page.length === size) break;
    }
    return page;
  }

  /**
   * Marks the retained pending message delivered and removes its pending tree entry.
   *
   * @param current Pending message held by the server.
   * @param deadline First retention deadline computed by the server.
   */
  markDelivered(current: InboxMessage, deadline: Timestamp): void {
    const shard = this.#requiredShard(current);
    this.#buckets
      .get(DeliveryShards.key(shard))
      ?.pending.eraseElementByKey(DeliveryRowOrder.key(current));
    current.status = InboxMessageStatus.DELIVERED;
    current.keepUntil = deadline;
  }

  /**
   * Removes delivered messages whose retention has ended in the requested shard.
   *
   * @param shard Selects the shard being drained.
   * @param now Supplies the server time at cleanup.
   * @returns Whether any stored message was removed.
   */
  removeExpiredDelivered(shard: ShardIndex, now: Timestamp): boolean {
    const bucket = this.#buckets.get(DeliveryShards.key(shard));
    if (bucket === undefined || bucket.ordered.size() === bucket.pending.size()) return false;
    const expired: InboxMessage[] = [];
    for (const [, message] of bucket.ordered) {
      if (message.status !== InboxMessageStatus.DELIVERED) continue;
      const until = message.keepUntil;
      if (
        until === undefined ||
        until.seconds < now.seconds ||
        (until.seconds === now.seconds && until.nanos <= now.nanos)
      ) {
        expired.push(message);
      }
    }
    return this.deleteMany(shard, expired).changed;
  }

  /**
   * Finds the last pending row in delivery order for one shard.
   *
   * @param shard Identifies the shard.
   * @returns A detached row or undefined when none remains.
   */
  newestPending(shard: ShardIndex): InboxMessage | undefined {
    const row = this.#buckets.get(DeliveryShards.key(shard))?.pending.back()?.[1];
    return row === undefined ? undefined : DeliveryMessages.copy(row);
  }

  /**
   * Lists shards with pending rows without visiting unrelated Inbox records.
   *
   * @returns Detached shard identities.
   */
  *pendingShards(): Iterable<ShardIndex> {
    for (const bucket of this.#buckets.values())
      if (bucket.pending.size() > 0) yield DeliveryShards.copy(bucket.shard);
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

  #replace(key: string, message: InboxMessage): boolean {
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
      bucket = {
        shard: DeliveryShards.copy(shard),
        ordered: new OrderedMap([], DeliveryRowOrder.compare),
        pending: new OrderedMap([], DeliveryRowOrder.compare),
      };
      this.#buckets.set(shardKey, bucket);
    }
    const order = DeliveryRowOrder.key(detached);
    bucket.ordered.setElement(order, detached);
    if (detached.status === InboxMessageStatus.TO_DELIVER)
      bucket.pending.setElement(order, detached);
    return (
      prior?.status === InboxMessageStatus.TO_DELIVER ||
      detached.status === InboxMessageStatus.TO_DELIVER
    );
  }

  #removeFromBucket(message: InboxMessage): void {
    const key = DeliveryShards.key(this.#requiredShard(message));
    const bucket = this.#buckets.get(key);
    if (bucket === undefined) throw new TypeError("Delivery message shard count is invalid.");
    const order = DeliveryRowOrder.key(message);
    bucket.ordered.eraseElementByKey(order);
    if (message.status === InboxMessageStatus.TO_DELIVER) bucket.pending.eraseElementByKey(order);
  }

  #pruneBucket(key: string): void {
    if (this.#buckets.get(key)?.ordered.size() !== 0) return;
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
 * Maintains the per-shard receive-time, version, and UTF-8 UUID order.
 */
const DeliveryRowOrder = Object.freeze({
  /**
   * Creates an exact tree key for one stored row.
   *
   * @param row Supplies the stored row.
   * @returns Its stable ordering key.
   */
  key(row: InboxMessage): DeliveryOrderKey {
    if (row.whenReceived === undefined || row.id === undefined)
      throw new TypeError("Delivery message ordering fields are missing.");
    return {
      seconds: row.whenReceived.seconds,
      nanos: row.whenReceived.nanos,
      version: row.version,
      uuid: Buffer.from(row.id.uuid),
    };
  },

  /**
   * Compares exact keys and exclusive timestamp probes.
   *
   * @param left Supplies the first key.
   * @param right Supplies the second key.
   * @returns A signed order comparison.
   */
  compare(left: DeliveryOrderKey, right: DeliveryOrderKey): number {
    if (left.seconds !== right.seconds) return left.seconds < right.seconds ? -1 : 1;
    if (left.nanos !== right.nanos) return left.nanos < right.nanos ? -1 : 1;
    if (left.version !== right.version) return left.version < right.version ? -1 : 1;
    return Buffer.compare(left.uuid, right.uuid);
  },
});
