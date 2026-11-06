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

import type { Message } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import {
  defaultQueryCandidateLimit,
  type RecordContinuation,
  type RecordStorage,
} from "@spine-event-engine/storage";

import { SessionRecords } from "../sessions/session-record.js";

/**
 * Selected native record with an authoritative expiry.
 */
export type ExpiringRecord = Message & {
  /**
   * Authoritative native Session or Verification expiry.
   */
  readonly expiresAt?: Timestamp | undefined;
};

/**
 * Selected indexed maintenance operations over exact native expiry values.
 */
interface ExpiryOperations {
  /**
   * Removes eligible rows after conditional storage confirmation.
   *
   * @typeParam R Selected record with an authoritative expiry.
   * @param storage Selected native record handle.
   * @param cutoff Latest eligible expiry.
   * @param signal Optional cancellation.
   * @returns Number of confirmed removals.
   */
  purgeExpired<R extends ExpiringRecord>(
    storage: RecordStorage<string, R>,
    cutoff: Timestamp,
    signal?: AbortSignal,
  ): Promise<number>;

  /**
   * Finds the next eligible ordered expiry.
   *
   * @typeParam R Selected record with an authoritative expiry.
   * @param storage Selected native record handle.
   * @param maximum Latest eligible ordered expiry.
   * @param completed Last completed expiry key.
   * @returns Next ordered expiry or absence.
   */
  nextExpiry<R extends ExpiringRecord>(
    storage: RecordStorage<string, R>,
    maximum: Uint8Array,
    completed?: Uint8Array,
  ): Promise<Uint8Array | undefined>;

  /**
   * Removes one exact expiry group through finite ID pages.
   *
   * @typeParam R Selected record with an authoritative expiry.
   * @param storage Selected native record handle.
   * @param key Exact ordered expiry key.
   * @param cutoff Latest eligible expiry.
   * @param signal Optional cancellation.
   * @returns Confirmed count and race indication.
   */
  purgeTie<R extends ExpiringRecord>(
    storage: RecordStorage<string, R>,
    key: Uint8Array,
    cutoff: Timestamp,
    signal?: AbortSignal,
  ): Promise<[number, boolean]>;

  /**
   * Validates the authoritative expiry of one persisted record.
   *
   * @param record Selected native record.
   * @returns Exact validated expiry.
   */
  requiredExpiry(record: ExpiringRecord): Timestamp;
}

/**
 * Performs explicit indexed expiry maintenance for selected native records.
 */
export const ExpiryMaintenance: Readonly<ExpiryOperations> = Object.freeze({
  /**
   * Removes selected expired records through the declared expiry index.
   *
   * @typeParam R Selected record with an authoritative expiry.
   * @param storage Selected native Session or Verification handle.
   * @param cutoff Latest eligible exact expiry.
   * @param signal Optional cooperative cancellation.
   * @returns Number of confirmed removals; changed rows remain for a later call.
   */
  async purgeExpired<R extends ExpiringRecord>(
    storage: RecordStorage<string, R>,
    cutoff: Timestamp,
    signal?: AbortSignal,
  ): Promise<number> {
    const maximum = SessionRecords.orderKey(cutoff);
    let completed: Uint8Array | undefined;
    let removed = 0;
    for (;;) {
      signal?.throwIfAborted();
      const key = await this.nextExpiry(storage, maximum, completed);
      signal?.throwIfAborted();
      if (key === undefined) return removed;
      const [count, raced] = await this.purgeTie(storage, key, cutoff, signal);
      removed += count;
      if (raced) return removed;
      completed = key;
    }
  },

  /**
   * Finds the next distinct exact expiry through the provider range index.
   *
   * @typeParam R Selected record with an authoritative expiry.
   * @param storage Selected native record handle.
   * @param maximum Latest eligible ordered expiry.
   * @param completed Last fully processed expiry key.
   * @returns Next ordered expiry, if present.
   */
  async nextExpiry<R extends ExpiringRecord>(
    storage: RecordStorage<string, R>,
    maximum: Uint8Array,
    completed?: Uint8Array,
  ): Promise<Uint8Array | undefined> {
    const upper = {
      kind: "comparison" as const,
      column: "expires_order",
      operator: "lessOrEqual" as const,
      value: maximum,
    };
    const predicate =
      completed === undefined
        ? upper
        : {
            kind: "all" as const,
            predicates: [
              upper,
              {
                kind: "comparison" as const,
                column: "expires_order",
                operator: "greaterThan" as const,
                value: completed,
              },
            ],
          };
    const entries = await storage.queryPlanEntries({
      predicate,
      order: [{ column: "expires_order", direction: "asc" }],
      limit: 1,
    });
    return entries[0] === undefined
      ? undefined
      : SessionRecords.orderKey(this.requiredExpiry(entries[0].record));
  },

  /**
   * Removes one exact expiry in finite provider ID pages.
   *
   * @typeParam R Selected record with an authoritative expiry.
   * @param storage Selected native record handle.
   * @param key Exact expiry index key.
   * @param cutoff Latest eligible expiry.
   * @param signal Optional cooperative cancellation.
   * @returns Confirmed removals and whether a changed row ended this invocation.
   */
  async purgeTie<R extends ExpiringRecord>(
    storage: RecordStorage<string, R>,
    key: Uint8Array,
    cutoff: Timestamp,
    signal?: AbortSignal,
  ): Promise<[number, boolean]> {
    let after: RecordContinuation<string> | undefined;
    let removed = 0;
    let raced = false;
    for (;;) {
      signal?.throwIfAborted();
      const entries = await storage.queryEntries({
        filters: [{ column: "expires_order", value: key }],
        sort: [{ field: "id" }],
        limit: defaultQueryCandidateLimit,
        ...(after === undefined ? {} : { after }),
      });
      signal?.throwIfAborted();
      if (entries.length === 0) return [removed, raced];
      for (const entry of entries) {
        signal?.throwIfAborted();
        if (SessionRecords.compare(this.requiredExpiry(entry.record), cutoff) > 0) continue;
        if (await storage.compareAndSet(entry.id, entry.record, undefined)) removed++;
        else raced = true;
        signal?.throwIfAborted();
      }
      const last = entries.at(-1);
      if (last === undefined) return [removed, raced];
      after = { id: last.id, values: [{ field: "id", value: last.id }] };
    }
  },

  /**
   * Reads a required exact native expiry without silently repairing stored data.
   *
   * @param record Selected native record.
   * @returns Validated exact expiry.
   */
  requiredExpiry(record: ExpiringRecord): Timestamp {
    if (record.expiresAt === undefined) throw new Error("Stored Better Auth record has no expiry.");
    return SessionRecords.deadline(record.expiresAt);
  },
});
