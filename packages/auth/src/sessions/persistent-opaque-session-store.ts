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

import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { Time } from "@spine-event-engine/core/time";
import {
  OpaqueSessionRecordSchema,
  type OpaqueSessionRecord,
} from "@spine-event-engine/proto/auth";
import {
  ColumnTypes,
  defaultQueryCandidateLimit,
  RecordColumn,
  RecordSpec,
  type RecordContinuation,
  type RecordStorage,
  type StorageContext,
  type StorageFactory,
  type StorageGroup,
} from "@spine-event-engine/storage";
import { StoragePreparations } from "@spine-event-engine/storage/provider";

import type { OpaqueSessionStore } from "./opaque-session-store.js";
import { SessionRecords } from "./session-record.js";

/**
 * Construction policy and placement for a durable opaque-session store.
 */
export interface PersistentOpaqueStoreOptions {
  // prettier-ignore

  /**
   * Provider factory used only to acquire this store's independent handle.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Physical group selected for this session family.
   */
  readonly group: StorageGroup;

  /**
   * Whether to prepare and check structures before returning; defaults to true.
   */
  readonly createMissingStructures?: boolean;

  /**
   * Returns the trusted latest allowed purge cutoff.
   *
   * @returns Current exact deadline.
   */
  readonly clock?: () => Timestamp;
}

/**
 * Durable opaque sessions backed by one independently closeable record handle.
 */
export class PersistentOpaqueSessionStore implements OpaqueSessionStore {
  readonly #storage: RecordStorage<string, OpaqueSessionRecord>;

  readonly #clock: () => Timestamp;

  #closed = false;

  #active = 0;

  #drained: (() => void) | undefined;

  #closing: Promise<void> | undefined;

  /**
   * Binds the selected record handle and trusted maintenance clock.
   *
   * @param storage Independently closeable session handle.
   * @param clock Supplies latest allowed purge cutoff.
   */
  private constructor(storage: RecordStorage<string, OpaqueSessionRecord>, clock: () => Timestamp) {
    this.#storage = storage;
    this.#clock = clock;
  }

  /**
   * Acquires an independent handle and completes default physical preparation.
   *
   * @param options Provider placement and preparation policy.
   * @returns Fully prepared store, or non-preparing store when explicitly selected.
   */
  static async create(
    options: PersistentOpaqueStoreOptions,
  ): Promise<PersistentOpaqueSessionStore> {
    const storage = options.storageFactory.createRecordStorage(context, spec, options.group, {
      prepareOnAccess: false,
    });
    try {
      if (!storage.atomicCompareAndSet)
        throw new Error("Opaque session storage requires atomic compare-and-set.");
      if (options.createMissingStructures !== false)
        await StoragePreparations.for(options.storageFactory).prepareRecord(
          context,
          spec,
          options.group,
          "create",
        );
      return new PersistentOpaqueSessionStore(storage, options.clock ?? Time.currentTime);
    } catch (error) {
      try {
        storage.close();
      } catch (closeError) {
        throw new AggregateError(
          [error, closeError],
          "Opaque session preparation and handle cleanup both failed.",
        );
      }
      throw error;
    }
  }

  /**
   * Creates a complete session only when its stable reference is absent.
   *
   * @param record Complete session to insert.
   * @param signal Optional cancellation.
   * @returns Whether insertion won.
   */
  insert(record: OpaqueSessionRecord, signal?: AbortSignal): Promise<boolean> {
    return this.#run(async () => {
      signal?.throwIfAborted();
      SessionRecords.expiry(record);
      const inserted = await this.#storage.compareAndSet(record.id, undefined, record);
      if (!inserted) signal?.throwIfAborted();
      return inserted;
    });
  }

  /**
   * Reads one authoritative session by stable reference.
   *
   * @param id Stable session reference.
   * @param signal Optional cancellation.
   * @returns Detached current record, if present.
   */
  read(id: string, signal?: AbortSignal): Promise<OpaqueSessionRecord | undefined> {
    return this.#run(async () => {
      signal?.throwIfAborted();
      const record = await this.#storage.read(id);
      signal?.throwIfAborted();
      return record;
    });
  }

  /**
   * Replaces exactly one expected session record.
   *
   * @param expected Complete record that must still be current.
   * @param next Replacement with the same stable reference.
   * @param signal Optional cancellation.
   * @returns Whether replacement won.
   */
  replace(
    expected: OpaqueSessionRecord,
    next: OpaqueSessionRecord,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return this.#run(async () => {
      signal?.throwIfAborted();
      if (expected.id !== next.id) throw new Error("Replacement must retain the stable reference.");
      SessionRecords.expiry(next);
      const replaced = await this.#storage.compareAndSet(expected.id, expected, next);
      if (!replaced) signal?.throwIfAborted();
      return replaced;
    });
  }

  /**
   * Deletes the current generation behind a stable reference.
   *
   * @param id Stable session reference.
   * @param signal Optional cancellation.
   * @returns Whether a record was removed.
   */
  revoke(id: string, signal?: AbortSignal): Promise<boolean> {
    return this.#run(async () => {
      signal?.throwIfAborted();
      const removed = await this.#storage.delete(id);
      signal?.throwIfAborted();
      return removed;
    });
  }

  /**
   * Deletes only one complete expected record.
   *
   * @param expected Complete record that may be removed.
   * @param signal Optional cancellation.
   * @returns Whether the expected record was removed.
   */
  remove(expected: OpaqueSessionRecord, signal?: AbortSignal): Promise<boolean> {
    return this.#run(async () => {
      signal?.throwIfAborted();
      const removed = await this.#storage.compareAndSet(expected.id, expected, undefined);
      signal?.throwIfAborted();
      return removed;
    });
  }

  /**
   * Removes exact deadlines at or before the trusted cutoff.
   * A changed selected row ends the pass after its current expiry group, so
   * other eligible rows can remain for later explicit maintenance.
   *
   * @param cutoff Current-or-earlier exact deadline.
   * @param signal Optional maintenance cancellation.
   * @returns Number removed by this completed pass.
   */
  purgeExpired(cutoff: Timestamp, signal?: AbortSignal): Promise<number> {
    return this.#run(async () => {
      const valid = SessionRecords.deadline(cutoff);
      signal?.throwIfAborted();
      if (SessionRecords.compare(valid, SessionRecords.deadline(this.#clock())) > 0)
        throw new RangeError("Purge cutoff cannot be later than the trusted clock.");
      return this.#purge(valid, signal);
    });
  }

  /**
   * Closes admission, drains admitted work, then releases this handle.
   *
   * @returns Repeatable close completion.
   */
  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    this.#closed = true;
    this.#closing = this.#finishClose();
    return this.#closing;
  }

  /**
   * Waits for admitted work and closes only the acquired record handle.
   *
   * @returns Completion after handle release.
   */
  async #finishClose(): Promise<void> {
    if (this.#active > 0) await new Promise<void>((resolve) => (this.#drained = resolve));
    this.#storage.close();
  }

  /**
   * Keeps one operation admitted through all asynchronous storage work.
   *
   * @typeParam T Result produced by the admitted operation.
   * @param work Operation body.
   * @returns Operation result.
   */
  async #run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#closed) throw new Error("Opaque session store is closed.");
    this.#active += 1;
    try {
      return await work();
    } finally {
      this.#active -= 1;
      if (this.#active === 0) this.#drained?.();
    }
  }

  /**
   * Discovers exact expiry ties and drains each one through ID keyset pages.
   * A conditional race ends this pass after the selected expiry group.
   *
   * @param cutoff Latest eligible deadline.
   * @param signal Optional cancellation.
   * @returns Number of removed rows.
   */
  async #purge(cutoff: Timestamp, signal?: AbortSignal): Promise<number> {
    const cutoffKey = SessionRecords.orderKey(cutoff);
    let completed: Uint8Array | undefined;
    let removed = 0;
    for (;;) {
      signal?.throwIfAborted();
      const key = await this.#nextExpiry(cutoffKey, completed);
      signal?.throwIfAborted();
      if (key === undefined) return removed;
      const [count, raced] = await this.#purgeTie(key, cutoff, signal);
      removed += count;
      if (raced) return removed;
      completed = key;
    }
  }

  /**
   * Finds one distinct expiry using the provider's indexed range and order.
   *
   * @param cutoffKey Encoded latest eligible deadline.
   * @param completed Previously completed expiry key, if any.
   * @returns Next exact expiry key, if present.
   */
  async #nextExpiry(
    cutoffKey: Uint8Array,
    completed?: Uint8Array,
  ): Promise<Uint8Array | undefined> {
    const maximum = {
      kind: "comparison" as const,
      column: "expires_order",
      operator: "lessOrEqual" as const,
      value: cutoffKey,
    };
    const predicate =
      completed === undefined
        ? maximum
        : {
            kind: "all" as const,
            predicates: [
              maximum,
              {
                kind: "comparison" as const,
                column: "expires_order",
                operator: "greaterThan" as const,
                value: completed,
              },
            ],
          };
    const entries = await this.#storage.queryPlanEntries({
      predicate,
      order: [{ column: "expires_order", direction: "asc" }],
      limit: 1,
    });
    return entries[0] === undefined
      ? undefined
      : SessionRecords.orderKey(SessionRecords.expiry(entries[0].record));
  }

  /**
   * Drains one exact expiry group in finite provider ID pages.
   *
   * @param key Encoded exact expiry group.
   * @param cutoff Latest eligible deadline.
   * @param signal Optional cancellation.
   * @returns Removed rows and whether a changed row ended this maintenance pass.
   */
  async #purgeTie(
    key: Uint8Array,
    cutoff: Timestamp,
    signal?: AbortSignal,
  ): Promise<[number, boolean]> {
    let after: RecordContinuation<string> | undefined;
    let removed = 0;
    let raced = false;
    for (;;) {
      signal?.throwIfAborted();
      const entries = await this.#storage.queryEntries({
        filters: [{ column: "expires_order", value: key }],
        sort: [{ field: "id" }],
        limit: defaultQueryCandidateLimit,
        ...(after === undefined ? {} : { after }),
      });
      signal?.throwIfAborted();
      if (entries.length === 0) return [removed, raced];
      for (const entry of entries) {
        const result = await this.#removeEligible(entry.record, cutoff, signal);
        if (result === undefined) raced = true;
        else removed += result;
      }
      const last = entries.at(-1);
      if (last === undefined) return [removed, raced];
      after = { id: last.id, values: [{ field: "id", value: last.id }] };
    }
  }

  /**
   * Conditionally removes one selected row at most once.
   *
   * @param candidate Selected row snapshot.
   * @param cutoff Latest eligible deadline.
   * @param signal Optional cancellation.
   * @returns One if deleted, zero if ineligible, or undefined if the row changed.
   */
  async #removeEligible(
    candidate: OpaqueSessionRecord,
    cutoff: Timestamp,
    signal?: AbortSignal,
  ): Promise<number | undefined> {
    signal?.throwIfAborted();
    if (SessionRecords.compare(SessionRecords.expiry(candidate), cutoff) > 0) return 0;
    const removed = await this.#storage.compareAndSet(candidate.id, candidate, undefined);
    signal?.throwIfAborted();
    return removed ? 1 : undefined;
  }
}

const context: StorageContext = { name: "__AUTH_OPAQUE_SESSIONS__", multitenant: false };
const spec = new RecordSpec<string, OpaqueSessionRecord>({
  recordType: OpaqueSessionRecordSchema,
  idKind: "string",
  extractId: (record) => record.id,
  columns: [
    new RecordColumn("expires_order", ColumnTypes.fixedBytes(12), (record: OpaqueSessionRecord) =>
      SessionRecords.orderKey(SessionRecords.expiry(record)),
    ),
  ],
  indexes: [{ name: "expiry", columns: ["expires_order", "id"] }],
});
