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

import { clone, equals } from "@bufbuild/protobuf";
import { type Timestamp } from "@bufbuild/protobuf/wkt";
import { Time } from "@spine-event-engine/core/time";
import {
  OpaqueSessionRecordSchema,
  type OpaqueSessionRecord,
} from "@spine-event-engine/proto/auth";

import { SessionRecords } from "./session-record.js";

/**
 * Atomic domain transitions for stable opaque-session references.
 */
export interface OpaqueSessionStore {
  /**
   * Creates one session only when its stable reference is absent.
   *
   * `true` confirms this record was inserted, even if cancellation arrives after
   * the physical commit. `false` confirms no mutation: an existing reference
   * or a process-local capacity refusal can prevent insertion. A thrown result
   * is unconfirmed; callers cannot safely infer insertion and
   * must not delete another session after an ID collision. Custom stores must
   * retain this distinction so a cancelled confirmed insert can be removed
   * conditionally against this complete record.
   *
   * @param record Complete new session.
   * @param signal Optional operation cancellation.
   * @returns Whether insertion won.
   */
  insert(record: OpaqueSessionRecord, signal?: AbortSignal): Promise<boolean>;

  /**
   * Reads one authoritative session by stable reference.
   *
   * @param id Stable reference.
   * @param signal Optional operation cancellation.
   * @returns Detached current record, if present.
   */
  read(id: string, signal?: AbortSignal): Promise<OpaqueSessionRecord | undefined>;

  /**
   * Replaces exactly the expected generation and deadline.
   *
   * A committed replacement returns `true` even if cancellation arrives just
   * after commit; the caller can conditionally remove that new generation.
   * A `false` result confirms that no replacement occurred.
   *
   * @param expected Complete expected record.
   * @param next Complete replacement with the same stable reference.
   * @param signal Optional operation cancellation.
   * @returns Whether the replacement won.
   */
  replace(
    expected: OpaqueSessionRecord,
    next: OpaqueSessionRecord,
    signal?: AbortSignal,
  ): Promise<boolean>;

  /**
   * Removes the current generation behind a stable reference.
   *
   * @param id Stable reference.
   * @param signal Optional operation cancellation.
   * @returns Whether a record was removed.
   */
  revoke(id: string, signal?: AbortSignal): Promise<boolean>;

  /**
   * Deletes only one complete expected record.
   *
   * @param expected Record that may be removed.
   * @param signal Optional operation cancellation.
   * @returns Whether the expected record was removed.
   */
  remove(expected: OpaqueSessionRecord, signal?: AbortSignal): Promise<boolean>;

  /**
   * Removes eligible exact deadlines through the selected cutoff.
   *
   * @param cutoff Trusted current-or-earlier deadline.
   * @param signal Optional maintenance cancellation.
   * @returns Number of records conditionally removed.
   */
  purgeExpired(cutoff: Timestamp, signal?: AbortSignal): Promise<number>;
}

/**
 * Process-local implementation of the same atomic session transitions.
 */
export class MemoryOpaqueSessionStore implements OpaqueSessionStore {
  readonly #records = new Map<string, OpaqueSessionRecord>();

  readonly #clock: () => Timestamp;

  readonly #maxSessions: number;

  #closed = false;

  /**
   * Creates a process-local store with a trusted maintenance clock.
   *
   * @param clock Supplies the latest allowed purge cutoff.
   * @param maxSessions Process-local retained record bound; defaults to 10,000.
   */
  constructor(clock: () => Timestamp = Time.currentTime, maxSessions = 10_000) {
    if (!Number.isSafeInteger(maxSessions) || maxSessions <= 0)
      throw new RangeError("maxSessions must be a positive safe integer.");
    this.#clock = clock;
    this.#maxSessions = maxSessions;
  }

  /**
   * Returns whether the process-local retained record bound is reached.
   *
   * @returns Whether another insert requires explicit expiry maintenance.
   */
  atCapacity(): boolean {
    return this.#records.size >= this.#maxSessions;
  }

  /**
   * Creates a complete session only when its stable reference is absent.
   *
   * @param record Complete session to insert.
   * @param signal Optional cancellation.
   * @returns Whether insertion won.
   */
  insert(record: OpaqueSessionRecord, signal?: AbortSignal): Promise<boolean> {
    return this.#run(() => {
      this.#check(signal);
      if (this.#records.has(record.id)) return false;
      if (this.atCapacity()) return false;
      SessionRecords.expiry(record);
      this.#records.set(record.id, clone(OpaqueSessionRecordSchema, record));
      return true;
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
    return this.#run(() => {
      this.#check(signal);
      const record = this.#records.get(id);
      return record === undefined ? undefined : clone(OpaqueSessionRecordSchema, record);
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
    return this.#run(() => {
      this.#check(signal);
      if (expected.id !== next.id) throw new Error("Replacement must retain the stable reference.");
      SessionRecords.expiry(next);
      const current = this.#records.get(expected.id);
      if (current === undefined || !equals(OpaqueSessionRecordSchema, current, expected))
        return false;
      this.#records.set(next.id, clone(OpaqueSessionRecordSchema, next));
      return true;
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
    return this.#run(() => {
      this.#check(signal);
      return this.#records.delete(id);
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
    return this.#run(() => {
      this.#check(signal);
      const current = this.#records.get(expected.id);
      if (current === undefined || !equals(OpaqueSessionRecordSchema, current, expected))
        return false;
      return this.#records.delete(expected.id);
    });
  }

  /**
   * Removes exact deadlines at or before the trusted cutoff.
   *
   * @param cutoff Current-or-earlier exact deadline.
   * @param signal Optional maintenance cancellation.
   * @returns Number of conditionally removed records.
   */
  purgeExpired(cutoff: Timestamp, signal?: AbortSignal): Promise<number> {
    return this.#run(() => {
      this.#check(signal);
      const valid = SessionRecords.deadline(cutoff);
      if (SessionRecords.compare(valid, SessionRecords.deadline(this.#clock())) > 0)
        throw new RangeError("Purge cutoff cannot be later than the trusted clock.");
      let removed = 0;
      for (const record of this.#records.values()) {
        this.#check(signal);
        if (SessionRecords.compare(SessionRecords.expiry(record), valid) <= 0) {
          this.#records.delete(record.id);
          removed += 1;
        }
      }
      return removed;
    });
  }

  /**
   * Closes and drops the process-local record references.
   *
   * @returns Completion after local records are dropped.
   */
  close(): Promise<void> {
    this.#closed = true;
    this.#records.clear();
    return Promise.resolve();
  }

  /**
   * Converts one synchronous memory transition to the asynchronous port.
   *
   * @typeParam T Result produced by the atomic transition.
   * @param action Atomic memory transition.
   * @returns Transition result or rejected failure.
   */
  #run<T>(action: () => T): Promise<T> {
    return Promise.resolve().then(action);
  }

  /**
   * Rejects new work after close or cancellation.
   *
   * @param signal Optional operation cancellation.
   */
  #check(signal?: AbortSignal): void {
    if (this.#closed) throw new Error("Opaque session store is closed.");
    signal?.throwIfAborted();
  }
}
