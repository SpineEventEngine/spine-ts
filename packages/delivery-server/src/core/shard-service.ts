import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import {
  ExpiredSessionSchema,
  ExpiredSessionsReleasedSchema,
  LiquorPickUpOutcomeSchema as PickUpOutcomeSchema,
  ShardAlreadyPickedUpSchema as AlreadyPickedUpSchema,
  ShardPickedUpSchema,
  ShardService,
} from "@spine-event-engine/proto/delivery-server";
import type { ShardIndex, WorkerId } from "@spine-event-engine/proto/delivery";

import { InMemoryDeliveryState } from "./in-memory-delivery-state.js";
import { MAX_DELIVERY_RESPONSE_SHARDS, MAX_DELIVERY_WORKER_BYTES } from "./limits.js";
import { MutationAdmission } from "./mutation-admission.js";
import { DeliveryShards, DeliveryWorkers } from "./wire-values.js";

/** Provides Shard RPC handler implementations. */
export const ShardHandlers: Readonly<{
  /**
   * Creates Shard RPC handlers.
   *
   * @param state Stores the Shard sessions served by the handlers.
   * @param admission Controls mutation admission and cancellation.
   * @param now Supplies the current millisecond time.
   * @param processingTimeoutMs Holds the automatic processing timeout.
   * @param onTransition Observes picked and released shard transitions.
   * @returns The Shard service implementation.
   */
  create: (
    state: InMemoryDeliveryState,
    admission: MutationAdmission,
    now: () => number,
    processingTimeoutMs: number,
    onTransition?: (shard: ShardIndex) => void,
  ) => ServiceImpl<typeof ShardService>;
}> = Object.freeze({
  create: (
    state: InMemoryDeliveryState,
    admission: MutationAdmission,
    now: () => number,
    processingTimeoutMs: number,
    onTransition?: (shard: ShardIndex) => void,
  ): ServiceImpl<typeof ShardService> => ({
    pickShard: async (request, context) => {
      const shard = ShardInputs.requireShard(request.shard);
      const worker = DeliveryWorkers.copy(ShardInputs.requireWorker(request.worker));
      return admission.run(context.signal, () => {
        const pickedAt = ShardTime.current(now);
        const current = state.session(shard);
        const stale =
          current !== undefined &&
          processingTimeoutMs > 0 &&
          pickedAt - ShardInputs.requireWhenPicked(current) > processingTimeoutMs;
        if (current === undefined || stale) {
          state.setSession(shard, worker, pickedAt);
          onTransition?.(shard);
          return create(PickUpOutcomeSchema, {
            value: {
              case: "pickedUp",
              value: create(ShardPickedUpSchema, {
                shard: DeliveryShards.copy(shard),
                worker: DeliveryWorkers.copy(worker),
                whenPicked: ShardTime.timestamp(pickedAt),
              }),
            },
          });
        }
        return create(PickUpOutcomeSchema, {
          value: {
            case: "alreadyPickedUp",
            value: create(AlreadyPickedUpSchema, {
              worker: DeliveryWorkers.copy(ShardInputs.requireWorker(current.worker)),
              whenPicked: ShardTime.timestamp(ShardInputs.requireWhenPicked(current)),
            }),
          },
        });
      });
    },
    releaseSession: async (request, context) => {
      const shard = ShardInputs.requireShard(request.shard);
      ShardInputs.requireWorker(request.worker);
      await admission.run(context.signal, () => {
        if (state.release(shard) !== undefined) onTransition?.(shard);
      });
      return {};
    },
    releaseSessions: async (request, context) => {
      if (request.inactivityPeriod === undefined)
        throw ShardErrors.invalid("Inactivity period is missing.");
      if (!ShardInputs.validDuration(request.inactivityPeriod))
        throw ShardErrors.invalid("Inactivity period is invalid.");
      const period =
        Number(request.inactivityPeriod.seconds) * 1_000 +
        Math.trunc(request.inactivityPeriod.nanos / 1_000_000);
      if (!Number.isFinite(period) || period < 0)
        throw ShardErrors.invalid("Inactivity period is invalid.");
      return admission.run(context.signal, () => {
        const releasedAt = ShardTime.current(now);
        const released = [];
        for (const record of state.shards.values()) {
          if (released.length === MAX_DELIVERY_RESPONSE_SHARDS) break;
          const session = state.session(record.shard);
          if (
            session !== undefined &&
            releasedAt - ShardInputs.requireWhenPicked(session) >= period
          ) {
            state.release(record.shard);
            onTransition?.(record.shard);
            released.push(
              create(ExpiredSessionSchema, {
                shard: DeliveryShards.copy(session.shard),
                worker: DeliveryWorkers.copy(ShardInputs.requireWorker(session.worker)),
                whenPicked: ShardTime.timestamp(ShardInputs.requireWhenPicked(session)),
                whenReleased: ShardTime.timestamp(releasedAt),
              }),
            );
          }
        }
        return create(ExpiredSessionsReleasedSchema, { shard: released });
      });
    },
  }),
});

/** Owns Shard request validation and input conversions. */
const ShardInputs: Readonly<{
  /**
   * Requires a Shard session pickup time.
   *
   * @param record Holds the Shard session record.
   * @returns The recorded pickup time in milliseconds.
   */
  requireWhenPicked: (record: { readonly whenLastPicked: number | undefined }) => number;
  /**
   * Requires a valid worker identity.
   *
   * @param worker Holds the candidate worker identity.
   * @returns The validated worker identity.
   */
  requireWorker: (worker: WorkerId | undefined) => WorkerId;
  /**
   * Requires a valid Shard identity.
   *
   * @param shard Holds the candidate Shard identity.
   * @returns The validated Shard identity.
   */
  requireShard: (shard: ShardIndex | undefined) => ShardIndex;
  /**
   * Validates a protobuf duration.
   *
   * @param value Holds the candidate duration.
   * @returns Whether the duration is within protobuf bounds.
   */
  validDuration: (value: { readonly seconds: bigint; readonly nanos: number }) => boolean;
  /**
   * Measures a string's UTF-8 size.
   *
   * @param value Holds the string to measure.
   * @returns The UTF-8 byte length.
   */
  utf8Bytes: (value: string) => number;
}> = Object.freeze({
  requireWhenPicked: (record: { readonly whenLastPicked: number | undefined }): number => {
    if (record.whenLastPicked === undefined)
      throw new TypeError("Delivery shard session is invalid.");
    return record.whenLastPicked;
  },
  requireWorker: (worker: WorkerId | undefined): WorkerId => {
    if (
      worker?.nodeId === undefined ||
      worker.value.trim().length === 0 ||
      worker.nodeId.value.trim().length === 0 ||
      ShardInputs.utf8Bytes(worker.value) + ShardInputs.utf8Bytes(worker.nodeId.value) >
        MAX_DELIVERY_WORKER_BYTES
    ) {
      throw ShardErrors.invalid("Delivery worker is invalid.");
    }
    return worker;
  },
  requireShard: (shard: ShardIndex | undefined): ShardIndex => {
    if (
      shard === undefined ||
      !Number.isInteger(shard.index) ||
      shard.index < 0 ||
      !Number.isInteger(shard.ofTotal) ||
      shard.ofTotal < 1 ||
      shard.index >= shard.ofTotal
    ) {
      throw ShardErrors.invalid("Delivery shard is invalid.");
    }
    return shard;
  },
  validDuration: (value: { readonly seconds: bigint; readonly nanos: number }): boolean =>
    value.seconds >= 0n &&
    value.seconds <= 315_576_000_000n &&
    Number.isInteger(value.nanos) &&
    value.nanos >= 0 &&
    value.nanos < 1_000_000_000,
  utf8Bytes: (value: string): number => new TextEncoder().encode(value).byteLength,
});

/** Owns Shard clock validation and protobuf timestamp conversion. */
const ShardTime: Readonly<{
  /**
   * Converts milliseconds to a protobuf timestamp.
   *
   * @param milliseconds Holds the millisecond time.
   * @returns The equivalent protobuf timestamp.
   */
  timestamp: (milliseconds: number) => { seconds: bigint; nanos: number };
  /**
   * Reads and validates the current millisecond time.
   *
   * @param now Supplies the current millisecond time.
   * @returns The valid current millisecond time.
   */
  current: (now: () => number) => number;
}> = Object.freeze({
  timestamp: (milliseconds: number): { seconds: bigint; nanos: number } => {
    const seconds = Math.floor(milliseconds / 1_000);
    return { seconds: BigInt(seconds), nanos: (milliseconds - seconds * 1_000) * 1_000_000 };
  },
  current: (now: () => number): number => {
    const value = now();
    if (!Number.isInteger(value) || value < -62_135_596_800_000 || value > 253_402_300_799_999)
      throw new RangeError("Delivery clock returned an invalid millisecond value.");
    return value;
  },
});

/** Owns Shard RPC error creation. */
const ShardErrors: Readonly<{
  /**
   * Creates an invalid-argument RPC error.
   *
   * @param message Describes the invalid request.
   * @returns The invalid-argument error.
   */
  invalid: (message: string) => ConnectError;
}> = Object.freeze({
  invalid: (message: string): ConnectError => new ConnectError(message, Code.InvalidArgument),
});
