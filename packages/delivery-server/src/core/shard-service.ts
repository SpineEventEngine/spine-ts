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

import { create } from "@bufbuild/protobuf";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import {
  DeliveryPickUpOutcomeSchema as PickUpOutcomeSchema,
  ExpiredSessionSchema,
  ExpiredSessionsReleasedSchema,
  ShardService,
  ShardPickedUpSchema,
  ShardAlreadyPickedUpSchema as AlreadyPickedSchema,
} from "@spine-event-engine/proto/delivery-server";
import type { ShardIndex, WorkerId } from "@spine-event-engine/proto/delivery";

import { InMemoryDeliveryState, type ShardRecord } from "./in-memory-delivery-state.js";
import { MutationAdmission } from "./mutation-admission.js";
import { DeliveryShards, DeliveryWorkers } from "./wire-values.js";

/**
 * Serves the JVM-compatible shard pickup and release operations.
 */
export class ShardSessionRuntime {
  readonly #state: InMemoryDeliveryState;

  readonly #admission: MutationAdmission;

  readonly #now: () => Timestamp;

  readonly #timeoutNs: bigint;

  readonly #onTransition: ((shard: ShardIndex) => void) | undefined;

  /**
   * The ShardService handlers.
   */
  readonly service: ServiceImpl<typeof ShardService>;

  /**
   * Creates the shard service over one in-memory record store.
   *
   * @param state Stores the current shard records.
   * @param admission Serializes mutations of that store.
   * @param now Supplies the full-precision wall clock.
   * @param timeoutMs Makes another worker's session stale after this duration.
   * @param onTransition Reports a pickup or release to observers.
   */
  constructor(
    state: InMemoryDeliveryState,
    admission: MutationAdmission,
    now: () => Timestamp,
    timeoutMs: number,
    onTransition?: (shard: ShardIndex) => void,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0)
      throw new RangeError("Processing timeout is invalid.");
    this.#state = state;
    this.#admission = admission;
    this.#now = now;
    this.#timeoutNs = BigInt(timeoutMs) * 1_000_000n;
    this.#onTransition = onTransition;
    this.service = this.#handlers();
  }

  /**
   * Creates the three JVM shard RPC handlers.
   *
   * @returns The shard service implementation.
   */
  #handlers(): ServiceImpl<typeof ShardService> {
    return {
      pickShard: (request, context) => {
        const shard = SessionValues.requireShard(request.shard);
        const worker = SessionValues.requireWorker(request.worker);
        return this.#admission.run(context.signal, () => this.#pick(shard, worker));
      },
      releaseSession: async (request, context) => {
        const shard = SessionValues.requireShard(request.shard);
        const worker = SessionValues.requireWorker(request.worker);
        const observed = this.#state.session(shard);
        await this.#admission.run(context.signal, () => {
          const current = this.#state.session(shard);
          if (current === observed && SessionValues.sameWorker(current?.worker, worker))
            this.#release(shard);
        });
        return {};
      },
      releaseSessions: (request, context) => {
        const duration = request.inactivityPeriod;
        if (
          duration === undefined ||
          duration.seconds < 0n ||
          duration.nanos < 0 ||
          duration.nanos >= 1_000_000_000
        )
          throw new ConnectError("Inactivity period is invalid.", Code.InvalidArgument);
        return this.#admission.run(context.signal, () => this.#releaseInactive(duration));
      },
    };
  }

  /**
   * Picks up a free or stale shard, or renews the same worker's record.
   *
   * @param shard Identifies the shard.
   * @param worker Identifies the requesting worker.
   * @returns The JVM Delivery pickup outcome.
   */
  #pick(shard: ShardIndex, worker: WorkerId) {
    const sampled = this.#sample();
    const current = this.#state.session(shard);
    if (current !== undefined && !SessionValues.sameWorker(current.worker, worker)) {
      const last = SessionValues.requireTime(current);
      if (
        this.#timeoutNs === 0n ||
        SessionValues.ns(sampled) - SessionValues.ns(last) <= this.#timeoutNs
      )
        return this.#alreadyPickedUp(shard, current, last);
    }
    const last =
      current === undefined || !SessionValues.sameWorker(current.worker, worker)
        ? sampled
        : SessionValues.later(sampled, SessionValues.requireTime(current));
    this.#state.setSession(shard, worker, last);
    this.#onTransition?.(shard);
    return create(PickUpOutcomeSchema, {
      value: {
        case: "pickedUp",
        value: create(ShardPickedUpSchema, {
          shard: DeliveryShards.copy(shard),
          worker: DeliveryWorkers.copy(worker),
          whenPicked: this.#sample(),
        }),
      },
    });
  }

  /**
   * Builds the outcome for a shard held by a different worker.
   *
   * @param shard Identifies the requested shard.
   * @param current Supplies the active record.
   * @param last Supplies its exact pickup time.
   * @returns The rejected pickup outcome.
   */
  #alreadyPickedUp(shard: ShardIndex, current: ShardRecord, last: Timestamp) {
    return create(PickUpOutcomeSchema, {
      value: {
        case: "alreadyPickedUp",
        value: create(AlreadyPickedSchema, {
          shard: DeliveryShards.copy(shard),
          worker: DeliveryWorkers.copy(SessionValues.requireWorker(current.worker)),
          whenPicked: SessionValues.copyTime(last),
        }),
      },
    });
  }

  /**
   * Clears one worker's record and reports newly available work.
   */
  #release(shard: ShardIndex): void {
    if (this.#state.release(shard) !== undefined) this.#onTransition?.(shard);
  }

  /**
   * Releases every session at least as old as the requested period.
   *
   * @param period Supplies the JVM inactivity threshold.
   * @returns The records released by this call.
   */
  #releaseInactive(period: { seconds: bigint; nanos: number }) {
    const now = this.#sample();
    const threshold = period.seconds * 1_000_000_000n + BigInt(period.nanos);
    const released = [];
    for (const record of this.#state.shards.values()) {
      if (record.worker === undefined || record.whenLastPicked === undefined) continue;
      if (SessionValues.ns(now) - SessionValues.ns(record.whenLastPicked) < threshold) continue;
      this.#release(record.shard);
      released.push(
        create(ExpiredSessionSchema, {
          shard: DeliveryShards.copy(record.shard),
          worker: DeliveryWorkers.copy(record.worker),
          whenPicked: SessionValues.copyTime(record.whenLastPicked),
          whenReleased: this.#sample(),
        }),
      );
    }
    return create(ExpiredSessionsReleasedSchema, { shard: released });
  }

  /**
   * Reads one valid full-precision wall clock sample.
   *
   * @returns The detached timestamp.
   */
  #sample(): Timestamp {
    const time = this.#now();
    if (
      typeof time.seconds !== "bigint" ||
      !Number.isInteger(time.nanos) ||
      time.nanos < 0 ||
      time.nanos >= 1_000_000_000
    )
      throw new RangeError("Delivery clock returned an invalid timestamp.");
    return SessionValues.copyTime(time);
  }
}

/**
 * Validates received shard and worker identities.
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
  requireShard: (shard) => SessionValues.requireShard(shard),
  requireWorker: (worker) => SessionValues.requireWorker(worker),
});

/**
 * Validates shard session values.
 */
const SessionValues = Object.freeze({
  /**
   * Validates a shard index.
   *
   * @param shard Supplies the candidate index.
   * @returns The valid index.
   */
  requireShard(shard: ShardIndex | undefined): ShardIndex {
    if (
      shard === undefined ||
      !Number.isInteger(shard.index) ||
      !Number.isInteger(shard.ofTotal) ||
      shard.index < 0 ||
      shard.ofTotal < 1 ||
      shard.index >= shard.ofTotal
    )
      throw new ConnectError("Delivery shard is invalid.", Code.InvalidArgument);
    return shard;
  },

  /**
   * Validates a complete worker identity.
   *
   * @param worker Supplies the candidate worker.
   * @returns The valid worker.
   */
  requireWorker(worker: WorkerId | undefined): WorkerId {
    if (!worker?.nodeId?.value.trim() || !worker.value.trim())
      throw new ConnectError("Delivery worker is invalid.", Code.InvalidArgument);
    return worker;
  },

  /**
   * Compares two worker identities.
   *
   * @param first Supplies the recorded worker.
   * @param second Supplies the requesting worker.
   * @returns Whether their node and worker values match.
   */
  sameWorker(first: WorkerId | undefined, second: WorkerId): boolean {
    return first?.nodeId?.value === second.nodeId?.value && first?.value === second.value;
  },

  /**
   * Reads the pickup time of an active record.
   *
   * @param record Supplies the active record.
   * @returns Its full-precision pickup time.
   */
  requireTime(record: ShardRecord): Timestamp {
    if (record.whenLastPicked === undefined)
      throw new TypeError("Active shard has no pickup time.");
    return record.whenLastPicked;
  },

  /**
   * Converts a timestamp to integer nanoseconds.
   *
   * @param time Supplies the timestamp.
   * @returns Nanoseconds since the Protobuf epoch.
   */
  ns(time: Timestamp): bigint {
    return time.seconds * 1_000_000_000n + BigInt(time.nanos);
  },

  /**
   * Returns the later of two timestamps.
   *
   * @param first Supplies one timestamp.
   * @param second Supplies another timestamp.
   * @returns The later timestamp.
   */
  later(first: Timestamp, second: Timestamp): Timestamp {
    return SessionValues.ns(first) >= SessionValues.ns(second) ? first : second;
  },

  /**
   * Copies a timestamp with its nanoseconds intact.
   *
   * @param time Supplies the source timestamp.
   * @returns A detached timestamp.
   */
  copyTime(time: Timestamp): Timestamp {
    return create(TimestampSchema, { seconds: time.seconds, nanos: time.nanos });
  },
});
