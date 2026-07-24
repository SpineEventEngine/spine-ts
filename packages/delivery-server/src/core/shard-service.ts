import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import {
  ExpiredSessionSchema,
  ExpiredSessionsReleasedSchema,
  LiquorPickUpOutcomeSchema,
  ShardAlreadyPickedUpSchema,
  ShardPickedUpSchema,
  ShardService,
} from "@spine-event-engine/proto/delivery-server";
import type { ShardIndex, WorkerId } from "@spine-event-engine/proto/delivery";

import { MutationAdmission } from "./mutation-admission.js";
import { InMemoryDeliveryState } from "./in-memory-delivery-state.js";
import { MAX_DELIVERY_RESPONSE_SHARDS, MAX_DELIVERY_WORKER_BYTES } from "./limits.js";
import { copyShard, copyWorker } from "./wire-values.js";

export function createShardService(
  state: InMemoryDeliveryState,
  admission: MutationAdmission,
  now: () => number,
  processingTimeoutMs: number,
  onTransition?: (shard: ShardIndex) => void,
): ServiceImpl<typeof ShardService> {
  return {
    pickShard: async (request, context) => {
      const shard = requiredShard(request.shard);
      const worker = copyWorker(requiredWorker(request.worker));
      return admission.run(context.signal, () => {
        const pickedAt = currentTime(now);
        const current = state.session(shard);
        const stale =
          current !== undefined &&
          processingTimeoutMs > 0 &&
          pickedAt - requiredWhenPicked(current) > processingTimeoutMs;
        if (current === undefined || stale) {
          state.setSession(shard, worker, pickedAt);
          onTransition?.(shard);
          return create(LiquorPickUpOutcomeSchema, {
            value: {
              case: "pickedUp",
              value: create(ShardPickedUpSchema, {
                shard: copyShard(shard),
                worker: copyWorker(worker),
                whenPicked: timestamp(pickedAt),
              }),
            },
          });
        }
        return create(LiquorPickUpOutcomeSchema, {
          value: {
            case: "alreadyPickedUp",
            value: create(ShardAlreadyPickedUpSchema, {
              worker: copyWorker(requiredWorker(current.worker)),
              whenPicked: timestamp(requiredWhenPicked(current)),
            }),
          },
        });
      });
    },
    releaseSession: async (request, context) => {
      const shard = requiredShard(request.shard);
      requiredWorker(request.worker);
      await admission.run(context.signal, () => {
        if (state.release(shard) !== undefined) onTransition?.(shard);
      });
      return {};
    },
    releaseSessions: async (request, context) => {
      if (request.inactivityPeriod === undefined) throw invalid("Inactivity period is missing.");
      if (!validDuration(request.inactivityPeriod)) throw invalid("Inactivity period is invalid.");
      const period =
        Number(request.inactivityPeriod.seconds) * 1_000 +
        Math.trunc(request.inactivityPeriod.nanos / 1_000_000);
      if (!Number.isFinite(period) || period < 0) throw invalid("Inactivity period is invalid.");
      return admission.run(context.signal, () => {
        const releasedAt = currentTime(now);
        const released = [];
        for (const record of state.shards.values()) {
          if (released.length === MAX_DELIVERY_RESPONSE_SHARDS) break;
          const session = state.session(record.shard);
          if (session !== undefined && releasedAt - requiredWhenPicked(session) >= period) {
            state.release(record.shard);
            onTransition?.(record.shard);
            released.push(
              create(ExpiredSessionSchema, {
                shard: copyShard(session.shard),
                worker: copyWorker(requiredWorker(session.worker)),
                whenPicked: timestamp(requiredWhenPicked(session)),
                whenReleased: timestamp(releasedAt),
              }),
            );
          }
        }
        return create(ExpiredSessionsReleasedSchema, { shard: released });
      });
    },
  };
}

function requiredWhenPicked(record: { readonly whenLastPicked: number | undefined }): number {
  if (record.whenLastPicked === undefined)
    throw new TypeError("Delivery shard session is invalid.");
  return record.whenLastPicked;
}

function requiredWorker(worker: WorkerId | undefined): WorkerId {
  if (
    worker?.nodeId === undefined ||
    worker.value.trim().length === 0 ||
    worker.nodeId.value.trim().length === 0 ||
    utf8Bytes(worker.value) + utf8Bytes(worker.nodeId.value) > MAX_DELIVERY_WORKER_BYTES
  )
    throw invalid("Delivery worker is invalid.");
  return worker;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function requiredShard(shard: ShardIndex | undefined): ShardIndex {
  if (
    shard === undefined ||
    !Number.isInteger(shard.index) ||
    shard.index < 0 ||
    !Number.isInteger(shard.ofTotal) ||
    shard.ofTotal < 1 ||
    shard.index >= shard.ofTotal
  )
    throw invalid("Delivery shard is invalid.");
  return shard;
}

function timestamp(milliseconds: number): { seconds: bigint; nanos: number } {
  const seconds = Math.floor(milliseconds / 1_000);
  return { seconds: BigInt(seconds), nanos: (milliseconds - seconds * 1_000) * 1_000_000 };
}

function validDuration(value: { readonly seconds: bigint; readonly nanos: number }): boolean {
  return (
    value.seconds >= 0n &&
    value.seconds <= 315_576_000_000n &&
    Number.isInteger(value.nanos) &&
    value.nanos >= 0 &&
    value.nanos < 1_000_000_000
  );
}

function invalid(message: string): ConnectError {
  return new ConnectError(message, Code.InvalidArgument);
}

function currentTime(now: () => number): number {
  const value = now();
  if (!Number.isInteger(value) || value < -62_135_596_800_000 || value > 253_402_300_799_999)
    throw new RangeError("Delivery clock returned an invalid millisecond value.");
  return value;
}
