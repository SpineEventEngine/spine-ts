import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { randomBytes } from "node:crypto";
import {
  StandSubscriptionRecordSchema,
  SubscriptionPhase,
  type StandSubscriptionRecord,
} from "@spine-event-engine/proto/generated/spine/system/server/stand_subscription_pb.js";

import type { StandSubscriptionEntry } from "./subscription-registry.js";

const maximumBytes = 1_048_576;

/**
 * Encodes the frozen Stand subscription record with lifecycle validation.
 */
interface StandSubscriptionRecordCodec {
  readonly schema: typeof StandSubscriptionRecordSchema;
  read(record: StandSubscriptionRecord, expectedId?: string): StandSubscriptionEntry;
  write(entry: StandSubscriptionEntry, generation?: Uint8Array): StandSubscriptionRecord;
  decode(bytes: Uint8Array, expectedId?: string): StandSubscriptionEntry;
}

/**
 * Encodes and validates durable Stand subscription records.
 */
export const StandSubscriptionRecords: StandSubscriptionRecordCodec = Object.freeze({
  schema: StandSubscriptionRecordSchema,

  read(record: StandSubscriptionRecord, expectedId?: string): StandSubscriptionEntry {
    try {
      const subscription = record.subscription;
      if (subscription === undefined) throw Error();
      const id = subscription.id?.value;
      if (
        typeof id !== "string" ||
        id.trim() === "" ||
        (expectedId !== undefined && id !== expectedId)
      )
        throw Error();
      const topicId = subscription.topic?.id?.value;
      if (typeof topicId !== "string" || topicId.trim() === "") throw Error();
      if (record.generation.byteLength !== 16) throw Error();
      if (record.createdAt === undefined || record.createdAt.seconds < 0n) throw Error();
      if (record.revision < 1n || record.revision > BigInt(Number.MAX_SAFE_INTEGER)) throw Error();
      const createdAtMs =
        Number(record.createdAt.seconds) * 1000 + Math.floor(record.createdAt.nanos / 1_000_000);
      if (!Number.isSafeInteger(createdAtMs)) throw Error();
      if (record.phase === SubscriptionPhase.PENDING) {
        if (record.pendingUntil === undefined) throw Error();
        const pendingUntilMs =
          Number(record.pendingUntil.seconds) * 1000 +
          Math.floor(record.pendingUntil.nanos / 1_000_000);
        if (!Number.isSafeInteger(pendingUntilMs) || pendingUntilMs < createdAtMs) throw Error();
        return Object.freeze({
          subscription,
          phase: "pending",
          createdAt: createdAtMs,
          pendingUntil: pendingUntilMs,
          revision: record.revision,
        });
      }
      if (record.phase !== SubscriptionPhase.ACTIVE || record.pendingUntil !== undefined)
        throw Error();
      return Object.freeze({
        subscription,
        phase: "active",
        createdAt: createdAtMs,
        revision: record.revision,
      });
    } catch {
      throw new Error("Stand subscription record is invalid.");
    }
  },

  write(entry: StandSubscriptionEntry, generation = randomBytes(16)): StandSubscriptionRecord {
    if (generation.byteLength !== 16)
      throw new RangeError("Stand subscription generation is invalid.");
    const record = create(StandSubscriptionRecordSchema, {
      subscription: entry.subscription,
      phase: entry.phase === "pending" ? SubscriptionPhase.PENDING : SubscriptionPhase.ACTIVE,
      createdAt: timestamp(entry.createdAt),
      ...(entry.pendingUntil === undefined ? {} : { pendingUntil: timestamp(entry.pendingUntil) }),
      revision: entry.revision,
      generation,
    });
    StandSubscriptionRecords.read(record, entry.subscription.id?.value);
    if (toBinary(StandSubscriptionRecordSchema, record).byteLength > maximumBytes) {
      throw new RangeError("Stand subscription record exceeds 1048576 bytes.");
    }
    return record;
  },

  decode(bytes: Uint8Array, expectedId?: string): StandSubscriptionEntry {
    if (bytes.byteLength > maximumBytes) throw new Error("Malformed Stand subscription record.");
    try {
      return StandSubscriptionRecords.read(
        fromBinary(StandSubscriptionRecordSchema, bytes),
        expectedId,
      );
    } catch {
      throw new Error("Malformed Stand subscription record.");
    }
  },
});

function timestamp(milliseconds: number): { readonly seconds: bigint; readonly nanos: number } {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0)
    throw new RangeError("Stand subscription time is invalid.");
  return {
    seconds: BigInt(Math.floor(milliseconds / 1000)),
    nanos: (milliseconds % 1000) * 1_000_000,
  };
}
