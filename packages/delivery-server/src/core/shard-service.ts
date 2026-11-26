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

import { randomUUID } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { DurationSchema, TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import {
  DeliverySessionHandleSchema,
  type DeliverySessionHandle,
  DeliveryShardBusySchema,
  DeliveryShardPickupOutcomeSchema as PickupOutcomeSchema,
  ExpiredSessionSchema,
  ExpiredSessionsReleasedSchema,
  ManagedShardService,
  ShardService,
} from "@spine-event-engine/proto/delivery-server";
import type { ShardIndex, WorkerId } from "@spine-event-engine/proto/delivery";
import { Time } from "@spine-event-engine/core/time";

import { InMemoryDeliveryState, type ShardRecord } from "./in-memory-delivery-state.js";
import { MutationAdmission } from "./mutation-admission.js";
import { DeliveryShards, DeliveryWorkers } from "./wire-values.js";

/**
 * Records fields required by every live raw or managed session.
 */
interface ActiveShardRecord extends ShardRecord {
  readonly worker: WorkerId;
  readonly whenLastPicked: Timestamp;
  readonly sessionId: string;
  readonly kind: "RAW" | "MANAGED";
  readonly revision: number;
}

/**
 * A session runtime shared by the raw and managed RPC surfaces.
 */
export class ShardSessionRuntime {
  readonly #state: InMemoryDeliveryState;

  readonly #admission: MutationAdmission;

  readonly #now: () => Timestamp;

  readonly #monotonicNow: () => number;

  readonly #lifetimeMs: number;

  readonly #onTransition: ((shard: ShardIndex) => void) | undefined;

  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();

  readonly #leaseStarts = new Map<string, { id: string; started: number }>();

  #closed = false;

  /**
   * Serves the frozen raw Shard RPC descriptor.
   */
  readonly raw: ServiceImpl<typeof ShardService>;

  /**
   * Serves the TS session-handle RPC descriptor.
   */
  readonly managed: ServiceImpl<typeof ManagedShardService>;

  /**
   * Creates one session authority for both RPC surfaces.
   *
   * @param state Stores shard pickup records.
   * @param admission Serializes and cancels mutations.
   * @param now Supplies a full-precision wall clock sample.
   * @param lifetimeMs Sets the positive session lifetime in milliseconds.
   * @param onTransition Publishes pickup and release changes.
   * @param monotonicNow Measures elapsed lease time independently of wall time.
   */
  constructor(
    state: InMemoryDeliveryState,
    admission: MutationAdmission,
    now: () => Timestamp,
    lifetimeMs: number,
    onTransition?: (shard: ShardIndex) => void,
    monotonicNow: () => number = () => Time.monotonicTime(),
  ) {
    if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs <= 0 || lifetimeMs > 315_576_000_000_000)
      throw new RangeError("Delivery session lifetime is invalid.");
    this.#state = state;
    this.#admission = admission;
    this.#now = now;
    this.#monotonicNow = monotonicNow;
    this.#lifetimeMs = lifetimeMs;
    this.#onTransition = onTransition;
    this.raw = this.#rawService();
    this.managed = this.#managedService();
  }

  /**
   * Creates the frozen raw descriptor with explicit worker-only rejection.
   *
   * @returns The raw service implementation.
   */
  #rawService(): ServiceImpl<typeof ShardService> {
    return {
      pickShard: () => Promise.reject(SessionValues.unsupported()),
      releaseSession: () => Promise.reject(SessionValues.unsupported()),
      releaseSessions: async (request, context) => {
        const duration = request.inactivityPeriod;
        if (duration === undefined || !SessionValues.validDuration(duration))
          throw SessionValues.invalid("Inactivity period is invalid.");
        return this.#admission.run(context.signal, () => this.#releaseInactive(duration));
      },
    };
  }

  /**
   * Creates the typed raw and managed session descriptor.
   *
   * @returns The managed service implementation.
   */
  #managedService(): ServiceImpl<typeof ManagedShardService> {
    return {
      pickShardRaw: async (request, context) => {
        const shard = SessionValues.requireShard(request.shard);
        const worker = SessionValues.requireWorker(request.worker);
        return this.#admission.run(context.signal, () => this.#pick(shard, worker, "RAW"));
      },
      pickShardForDelivery: async (request, context) => {
        const shard = SessionValues.requireShard(request.shard);
        const worker = SessionValues.requireWorker(request.worker);
        return this.#admission.run(context.signal, () => this.#pick(shard, worker, "MANAGED"));
      },
      renewShardSession: async (request, context) => {
        return this.renewAtRevision(request, context.signal, this.receivedRevision(request.shard));
      },
      releaseShardSession: async (request, context) => {
        return this.releaseAtRevision(
          request,
          context.signal,
          this.receivedRevision(request.shard),
        );
      },
    };
  }

  /**
   * Captures the current revision at the authoritative child request boundary.
   *
   * @param shard Identifies the shard in the received handle.
   * @returns The current internal revision, if a session exists.
   */
  receivedRevision(shard: ShardIndex | undefined): number | undefined {
    return this.#state.session(SessionValues.requireShard(shard))?.revision;
  }

  /**
   * Updates only the revision observed before local admission, so a queued
   * request cannot apply to a later revision of the same session.
   *
   * @param request Supplies the session handle.
   * @param signal Cancels before admission.
   * @param revision Captures the received revision.
   * @returns The renewed handle.
   */
  renewAtRevision(
    request: DeliverySessionHandle,
    signal: AbortSignal,
    revision: number | undefined,
  ): Promise<DeliverySessionHandle> {
    const shard = SessionValues.requireShard(request.shard);
    const worker = SessionValues.requireWorker(request.worker);
    const id = SessionValues.requireId(request.sessionId);
    this.#requireHandle(request);
    return this.#admission.run(signal, () => this.#renew(shard, worker, id, revision));
  }

  /**
   * Removes only the revision observed before local admission, so a delayed
   * release cannot clear a session renewed while it was queued.
   *
   * @param request Supplies the session handle.
   * @param signal Cancels before admission.
   * @param revision Captures the received revision.
   * @returns An empty response after the matching session is released.
   */
  async releaseAtRevision(
    request: DeliverySessionHandle,
    signal: AbortSignal,
    revision: number | undefined,
  ): Promise<Record<string, never>> {
    const shard = SessionValues.requireShard(request.shard);
    const worker = SessionValues.requireWorker(request.worker);
    const id = SessionValues.requireId(request.sessionId);
    this.#requireHandle(request);
    await this.#admission.run(signal, () => {
      this.#releaseMatching(shard, worker, id, revision);
    });
    return {};
  }

  /**
   * Updates only the current record with the matching session identity.
   *
   * @param shard Identifies the requested shard.
   * @param worker Identifies the requesting worker.
   * @param id Identifies the session to renew.
   * @param revision Captures the record revision before admission.
   * @returns The updated session handle.
   */
  #renew(shard: ShardIndex, worker: WorkerId, id: string, revision: number | undefined) {
    const current = this.#live(shard);
    if (!SessionValues.matches(current, worker, id) || current.revision !== revision)
      throw SessionValues.lost();
    const whenPicked = SessionValues.later(SessionValues.requireTime(current), this.#sample());
    this.#state.setSession(shard, worker, whenPicked, id, current.kind, current.revision + 1);
    this.#schedule(shard, id);
    this.#onTransition?.(shard);
    return this.#handle(SessionValues.requireActive(this.#state.session(shard)));
  }

  /**
   * Removes only the current record with the matching session identity.
   *
   * @param shard Identifies the requested shard.
   * @param worker Identifies the requesting worker.
   * @param id Identifies the session to release.
   * @param revision Captures the record revision before admission.
   */
  #releaseMatching(
    shard: ShardIndex,
    worker: WorkerId,
    id: string,
    revision: number | undefined,
  ): void {
    const current = this.#live(shard);
    if (SessionValues.matches(current, worker, id) && current.revision === revision)
      this.#release(shard);
  }

  /**
   * Validates a live managed session during an admitted Inbox mutation.
   *
   * @param handle Supplies the worker's complete session handle.
   * @returns The shard held by the matching session.
   */
  requireManaged(handle: DeliverySessionHandle): ShardIndex {
    const shard = SessionValues.requireShard(handle.shard);
    const worker = SessionValues.requireWorker(handle.worker);
    const id = SessionValues.requireId(handle.sessionId);
    this.#requireHandle(handle);
    const current = this.#live(shard);
    if (!SessionValues.matches(current, worker, id) || current.kind !== "MANAGED")
      throw SessionValues.lost();
    return shard;
  }

  /**
   * Stops session timers after the listener closes.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    this.#leaseStarts.clear();
  }

  /**
   * Requires the complete typed handle on renewal and release.
   */
  #requireHandle(value: {
    whenPicked?: Timestamp | undefined;
    lifetime?: { seconds: bigint; nanos: number } | undefined;
  }): void {
    if (
      value.whenPicked === undefined ||
      value.lifetime === undefined ||
      !SessionValues.validTimestamp(value.whenPicked) ||
      !SessionValues.validDuration(value.lifetime) ||
      value.lifetime.seconds * 1_000_000_000n + BigInt(value.lifetime.nanos) !==
        BigInt(this.#lifetimeMs) * 1_000_000n
    )
      throw SessionValues.invalid("Delivery session handle is incomplete or invalid.");
  }

  /**
   * Grants a free shard or returns its current state.
   */
  #pick(shard: ShardIndex, worker: WorkerId, kind: "RAW" | "MANAGED") {
    const current = this.#live(shard);
    if (current !== undefined) {
      if (current.kind === kind && SessionValues.sameWorker(current.worker, worker)) {
        const whenPicked = SessionValues.later(SessionValues.requireTime(current), this.#sample());
        this.#state.setSession(
          shard,
          worker,
          whenPicked,
          current.sessionId,
          kind,
          current.revision + 1,
        );
        this.#schedule(shard, current.sessionId);
        this.#onTransition?.(shard);
        return this.#picked(SessionValues.requireActive(this.#state.session(shard)));
      }
      return create(PickupOutcomeSchema, {
        result: {
          case: "busy",
          value: create(DeliveryShardBusySchema, {
            worker: DeliveryWorkers.copy(current.worker),
            whenPicked: SessionValues.copyTime(current.whenLastPicked),
          }),
        },
      });
    }
    if (kind === "MANAGED" && !this.#state.hasPending(shard))
      return create(PickupOutcomeSchema, { result: { case: "noWork", value: {} } });
    const id = randomUUID();
    this.#state.setSession(shard, worker, this.#sample(), id, kind);
    this.#schedule(shard, id);
    this.#onTransition?.(shard);
    return this.#picked(SessionValues.requireActive(this.#state.session(shard)));
  }

  /**
   * Returns a success with a second clock sample, following JVM pickup timing.
   */
  #picked(record: ActiveShardRecord) {
    return create(PickupOutcomeSchema, {
      result: { case: "pickedUp", value: this.#handle(record, this.#sample()) },
    });
  }

  /**
   * Builds a detached typed session handle.
   */
  #handle(record: ActiveShardRecord, whenPicked = record.whenLastPicked) {
    const seconds = Math.floor(this.#lifetimeMs / 1_000);
    return create(DeliverySessionHandleSchema, {
      shard: DeliveryShards.copy(record.shard),
      worker: DeliveryWorkers.copy(record.worker),
      sessionId: record.sessionId,
      whenPicked: SessionValues.copyTime(whenPicked),
      lifetime: create(DurationSchema, {
        seconds: BigInt(seconds),
        nanos: (this.#lifetimeMs - seconds * 1_000) * 1_000_000,
      }),
    });
  }

  /**
   * Reads a session and expires it before a competing admission.
   */
  #live(shard: ShardIndex): ActiveShardRecord | undefined {
    const current = this.#state.session(shard);
    if (current === undefined) return undefined;
    const active = SessionValues.requireActive(current);
    if (this.#elapsed(shard, active.sessionId) >= this.#lifetimeMs) {
      this.#release(shard);
      return undefined;
    }
    return active;
  }

  /**
   * Releases the current record and publishes newly available work.
   */
  #release(shard: ShardIndex): void {
    const key = DeliveryShards.key(shard);
    const timer = this.#timers.get(key);
    if (timer !== undefined) clearTimeout(timer);
    this.#timers.delete(key);
    this.#leaseStarts.delete(key);
    if (this.#state.release(shard) !== undefined) this.#onTransition?.(shard);
  }

  /**
   * Scans current records at the request's exact inactivity threshold.
   */
  #releaseInactive(period: { seconds: bigint; nanos: number }) {
    const selectedAt = this.#sample();
    const threshold = period.seconds * 1_000_000_000n + BigInt(period.nanos);
    const released = [];
    for (const record of this.#state.shards.values()) {
      const retained = this.#state.session(record.shard);
      if (retained === undefined) continue;
      const session = SessionValues.requireActive(retained);
      const inactive =
        SessionValues.nanoseconds(selectedAt) -
        SessionValues.nanoseconds(SessionValues.requireTime(session));
      if (inactive < threshold) continue;
      this.#release(record.shard);
      released.push(
        create(ExpiredSessionSchema, {
          shard: DeliveryShards.copy(session.shard),
          worker: DeliveryWorkers.copy(session.worker),
          whenPicked: SessionValues.copyTime(SessionValues.requireTime(session)),
          whenReleased: this.#sample(),
        }),
      );
    }
    return create(ExpiredSessionsReleasedSchema, { shard: released });
  }

  /**
   * Reschedules one expiry; long lifetimes use multiple Node timer intervals.
   */
  #schedule(shard: ShardIndex, id: string, reset = true): void {
    const key = DeliveryShards.key(shard);
    const old = this.#timers.get(key);
    if (old !== undefined) clearTimeout(old);
    if (reset) this.#leaseStarts.set(key, { id, started: this.#clock() });
    const remaining = this.#lifetimeMs - this.#elapsed(shard, id);
    const delay = Math.max(1, Math.min(remaining, 2_147_483_647));
    const timer = setTimeout(() => {
      if (this.#closed) return;
      void this.#admission
        .run(undefined, () => {
          const live = this.#state.session(shard);
          if (live?.sessionId !== id) return;
          if (this.#elapsed(shard, id) >= this.#lifetimeMs) {
            this.#release(shard);
          } else this.#schedule(shard, id, false);
        })
        .catch(() => {
          // Terminal admission closure has already cleared all session timers.
        });
    }, delay);
    timer.unref();
    this.#timers.set(key, timer);
  }

  /**
   * Reads a finite monotonic elapsed time for one unchanged session.
   */
  #elapsed(shard: ShardIndex, id: string): number {
    const lease = this.#leaseStarts.get(DeliveryShards.key(shard));
    if (lease?.id !== id) throw new TypeError("Delivery lease clock is missing.");
    return this.#clock() - lease.started;
  }

  /**
   * Validates a monotonic clock sample.
   */
  #clock(): number {
    const value = this.#monotonicNow();
    if (!Number.isFinite(value)) throw new RangeError("Delivery monotonic clock is invalid.");
    return value;
  }

  /**
   * Reads and validates a full-precision clock sample.
   */
  #sample(): Timestamp {
    const value = this.#now();
    if (!SessionValues.validTimestamp(value))
      throw new RangeError("Delivery clock returned an invalid timestamp.");
    return SessionValues.copyTime(value);
  }
}

/**
 * Validates pickup inputs before local session admission.
 */
export const DeliverySessionInputs: Readonly<{
  /**
   * Validates a complete shard identity.
   */
  requireShard: (shard: ShardIndex | undefined) => ShardIndex;

  /**
   * Validates a complete worker identity.
   */
  requireWorker: (worker: WorkerId | undefined) => WorkerId;
}> = Object.freeze({
  requireShard: (shard: ShardIndex | undefined): ShardIndex => SessionValues.requireShard(shard),
  requireWorker: (worker: WorkerId | undefined): WorkerId => SessionValues.requireWorker(worker),
});

/**
 * Validates session inputs, times, and definitive RPC errors.
 */
const SessionValues = Object.freeze({
  /**
   * Validates the required fields of a live session record.
   *
   * @param record Supplies a possibly released record.
   * @returns The complete active record.
   */
  requireActive(record: ShardRecord | undefined): ActiveShardRecord {
    if (
      record?.worker === undefined ||
      record.whenLastPicked === undefined ||
      record.sessionId === undefined ||
      record.kind === undefined ||
      record.revision === undefined
    )
      throw new TypeError("Delivery shard session is invalid.");
    return record as ActiveShardRecord;
  },

  /**
   * Validates a shard identity.
   *
   * @param shard Supplies the candidate shard.
   * @returns The valid shard.
   */
  requireShard(shard: ShardIndex | undefined): ShardIndex {
    if (
      shard === undefined ||
      !Number.isInteger(shard.index) ||
      shard.index < 0 ||
      !Number.isInteger(shard.ofTotal) ||
      shard.ofTotal < 1 ||
      shard.index >= shard.ofTotal
    )
      throw SessionValues.invalid("Delivery shard is invalid.");
    return shard;
  },

  /**
   * Validates a complete stable worker identity.
   *
   * @param worker Supplies the candidate worker.
   * @returns The valid worker.
   */
  requireWorker(worker: WorkerId | undefined): WorkerId {
    if (worker?.nodeId === undefined || !worker.value.trim() || !worker.nodeId.value.trim())
      throw SessionValues.invalid("Delivery worker is invalid.");
    return worker;
  },

  /**
   * Validates a session identity.
   *
   * @param id Supplies the candidate session ID.
   * @returns The nonempty ID.
   */
  requireId(id: string): string {
    if (!id.trim()) throw SessionValues.invalid("Delivery session ID is missing.");
    return id;
  },

  /**
   * Matches a live record against its worker and session ID.
   *
   * @param record Supplies the current record.
   * @param worker Supplies the requesting worker.
   * @param id Supplies the session ID.
   * @returns Whether the record matches.
   */
  matches(
    record: ActiveShardRecord | undefined,
    worker: WorkerId,
    id: string,
  ): record is ActiveShardRecord {
    return (
      record?.sessionId === id &&
      record.worker.nodeId?.value === worker.nodeId?.value &&
      record.worker.value === worker.value
    );
  },

  /**
   * Compares complete stable worker identities.
   *
   * @param first Supplies the held worker.
   * @param second Supplies the requesting worker.
   * @returns Whether the workers match.
   */
  sameWorker(first: WorkerId | undefined, second: WorkerId): boolean {
    return first?.nodeId?.value === second.nodeId?.value && first?.value === second.value;
  },

  /**
   * Validates a retained pickup time.
   *
   * @param record Supplies the current record.
   * @returns Its full-precision pickup time.
   */
  requireTime(record: ShardRecord): Timestamp {
    if (record.whenLastPicked === undefined)
      throw new TypeError("Delivery session has no pickup time.");
    return record.whenLastPicked;
  },

  /**
   * Converts a timestamp to integer nanoseconds.
   *
   * @param value Supplies the timestamp.
   * @returns Its epoch nanoseconds.
   */
  nanoseconds(value: Timestamp): bigint {
    return value.seconds * 1_000_000_000n + BigInt(value.nanos);
  },

  /**
   * Copies a timestamp without sharing mutable wire fields.
   *
   * @param value Supplies the timestamp.
   * @returns A detached timestamp.
   */
  copyTime(value: Timestamp): Timestamp {
    return create(TimestampSchema, { seconds: value.seconds, nanos: value.nanos });
  },

  /**
   * Returns the later of two pickup samples.
   *
   * @param first Supplies the stored sample.
   * @param second Supplies the current sample.
   * @returns The later timestamp.
   */
  later(first: Timestamp, second: Timestamp): Timestamp {
    return first.seconds > second.seconds ||
      (first.seconds === second.seconds && first.nanos >= second.nanos)
      ? first
      : second;
  },

  /**
   * Validates the frozen Duration wire range.
   *
   * @param value Supplies the candidate duration.
   * @returns Whether it is valid.
   */
  validDuration(value: { seconds: bigint; nanos: number }): boolean {
    return (
      value.seconds >= 0n &&
      value.seconds <= 315_576_000_000n &&
      Number.isInteger(value.nanos) &&
      value.nanos >= 0 &&
      value.nanos < 1_000_000_000
    );
  },

  /**
   * Validates the Protobuf Timestamp seconds and nanos range.
   *
   * @param value Supplies the candidate timestamp.
   * @returns Whether it is valid.
   */
  validTimestamp(value: { seconds: bigint; nanos: number }): boolean {
    return (
      value.seconds >= -62_135_596_800n &&
      value.seconds <= 253_402_300_799n &&
      Number.isInteger(value.nanos) &&
      value.nanos >= 0 &&
      value.nanos < 1_000_000_000
    );
  },

  /**
   * Creates an invalid-argument session error.
   *
   * @param message Describes the invalid input.
   * @returns The RPC error.
   */
  invalid(message: string): ConnectError {
    return new ConnectError(message, Code.InvalidArgument);
  },

  /**
   * Creates a failed-precondition error for a lost session.
   *
   * @returns The RPC error.
   */
  lost(): ConnectError {
    return new ConnectError("Delivery session is no longer live.", Code.FailedPrecondition);
  },

  /**
   * Creates a failed-precondition error for worker-only methods.
   *
   * @returns The RPC error.
   */
  unsupported(): ConnectError {
    return new ConnectError(
      "A typed delivery session handle is required.",
      Code.FailedPrecondition,
    );
  },
});
