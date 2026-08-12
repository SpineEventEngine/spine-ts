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
import { clone, create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  SubscriptionRecordSchema,
  SubscriptionIdSchema,
  SubscriptionSchema,
  SubscriptionStatus,
  type SubscriptionRecord,
} from "@spine-event-engine/proto/client";

import type { StandSubscriptionEntry } from "./subscription-registry.js";

const maximumBytes = 1_048_576;

/**
 * Encodes and validates the approved durable subscription record.
 */
export const StandSubscriptionRecords: {
  readonly schema: typeof SubscriptionRecordSchema;
  read(record: SubscriptionRecord, expectedId?: string): StandSubscriptionEntry;
  write(entry: StandSubscriptionEntry): SubscriptionRecord;
  decode(bytes: Uint8Array, expectedId?: string): StandSubscriptionEntry;
} = Object.freeze({
  schema: SubscriptionRecordSchema,

  read(record: SubscriptionRecord, expectedId?: string): StandSubscriptionEntry {
    try {
      const id = record.id?.value;
      const subscription = record.subscription;
      if (typeof id !== "string" || id.trim() === "" || id !== subscription?.id?.value)
        throw Error();
      if (expectedId !== undefined && id !== expectedId) throw Error();
      if (
        typeof subscription.topic?.id?.value !== "string" ||
        subscription.topic.id.value.trim() === ""
      )
        throw Error();
      const createdAt = milliseconds(record.whenCreated);
      if (record.status === SubscriptionStatus.PENDING) {
        const pendingUntil = milliseconds(record.whenActivationExpires);
        if (pendingUntil < createdAt) throw Error();
        return Object.freeze({
          subscription: clone(SubscriptionSchema, subscription),
          phase: "pending" as const,
          createdAt,
          pendingUntil,
        });
      }
      if (record.status !== SubscriptionStatus.ACTIVE || record.whenActivationExpires !== undefined)
        throw Error();
      return Object.freeze({
        subscription: clone(SubscriptionSchema, subscription),
        phase: "active" as const,
        createdAt,
      });
    } catch {
      throw new Error("Stand subscription record is invalid.");
    }
  },

  write(entry: StandSubscriptionEntry): SubscriptionRecord {
    const id = entry.subscription.id;
    if (id === undefined) throw new TypeError("Stand subscription ID must be non-blank.");
    const record = create(SubscriptionRecordSchema, {
      id: clone(SubscriptionIdSchema, id),
      subscription: clone(SubscriptionSchema, entry.subscription),
      status: entry.phase === "pending" ? SubscriptionStatus.PENDING : SubscriptionStatus.ACTIVE,
      whenCreated: timestamp(entry.createdAt),
      ...(entry.phase === "pending"
        ? { whenActivationExpires: timestamp(entry.pendingUntil) }
        : {}),
    });
    this.read(record, id.value);
    if (toBinary(SubscriptionRecordSchema, record).byteLength > maximumBytes)
      throw new RangeError("Stand subscription record exceeds 1048576 bytes.");
    return record;
  },

  decode(bytes: Uint8Array, expectedId?: string): StandSubscriptionEntry {
    if (bytes.byteLength > maximumBytes) throw new Error("Malformed Stand subscription record.");
    try {
      return this.read(fromBinary(SubscriptionRecordSchema, bytes), expectedId);
    } catch {
      throw new Error("Malformed Stand subscription record.");
    }
  },
});

function milliseconds(
  value: { readonly seconds: bigint; readonly nanos: number } | undefined,
): number {
  if (value === undefined || value.seconds < 0n || value.nanos < 0 || value.nanos >= 1_000_000_000)
    throw Error();
  const result = Number(value.seconds) * 1000 + Math.floor(value.nanos / 1_000_000);
  if (!Number.isSafeInteger(result)) throw Error();
  return result;
}

function timestamp(value: number): { readonly seconds: bigint; readonly nanos: number } {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError("Stand subscription time is invalid.");
  return { seconds: BigInt(Math.floor(value / 1000)), nanos: (value % 1000) * 1_000_000 };
}
