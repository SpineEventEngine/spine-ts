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
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";

interface FinalGuardFields {
  readonly key: string;
  readonly inbox: string;
  readonly signalId: string;
  readonly inboxMessageId: string;
}

interface PendingGuardFields {
  readonly signalId: string;
  readonly valueBase64: string;
}

export function finalDedupRecord(fields: FinalGuardFields): Any {
  return create(AnySchema, {
    typeUrl: "type.spine-ts.dev/internal/InboxDedupRecord",
    value: Buffer.from(
      JSON.stringify({
        ...fields,
        shardIndex: 0,
        shardTotal: 1,
        state: "FINAL",
        status: "TO_DELIVER",
      }),
      "utf8",
    ),
  });
}

export function pendingDedupRecord(fields: PendingGuardFields): Any {
  return create(AnySchema, {
    typeUrl: "type.spine-ts.dev/internal/InboxDedupRecord",
    value: Buffer.from(
      JSON.stringify({
        key: testDedupKey(fields.signalId),
        state: "PENDING",
        message: storedInboxJson(fields),
      }),
      "utf8",
    ),
  });
}

export function storedInboxRecord(fields: PendingGuardFields): Any {
  return create(AnySchema, {
    typeUrl: "type.spine-ts.dev/internal/InboxMessageRecord",
    value: Buffer.from(JSON.stringify(storedInboxJson(fields)), "utf8"),
  });
}

export function storedInboxJson(fields: PendingGuardFields): Record<string, unknown> {
  return {
    key: "0/1:message-1",
    id: "message-1",
    shard: "0/1",
    shardIndex: 0,
    shardTotal: 1,
    inbox: testInboxKey,
    inboxId: {
      targetId: "projection-1",
      targetTypeUrl: "type.example.dev/tasks.Projection",
    },
    signalId: fields.signalId,
    signal: {
      typeUrl: "type.example.dev/tasks.LargeSignal",
      valueBase64: fields.valueBase64,
    },
    label: "UPDATE_SUBSCRIBER",
    status: "TO_DELIVER",
    whenReceivedMs: Date.parse("2026-07-02T08:00:00.000Z"),
    version: "1",
  };
}

export function invalidUtf8JsonBytes(value: Record<string, unknown>, marker: string): Buffer {
  const encoded = Buffer.from(JSON.stringify(value), "utf8");
  const markerBytes = Buffer.from(marker, "utf8");
  const markerIndex = encoded.indexOf(markerBytes);

  if (markerIndex < 0) {
    throw new Error(`Expected marker "${marker}" in encoded JSON.`);
  }

  return Buffer.concat([
    encoded.subarray(0, markerIndex),
    Buffer.from([0x80]),
    encoded.subarray(markerIndex + 1),
  ]);
}

export function oversizedPayload(): string {
  return Buffer.alloc(256 * 1024 + 1).toString("base64");
}

export function oversizedStoredRecord(): Buffer {
  return Buffer.concat([Buffer.from("{", "utf8"), Buffer.alloc(512 * 1024)]);
}

export function testDedupKey(signalId: string): string {
  return `${testInboxKey}:${signalId}`;
}

export const testInboxKey = JSON.stringify({
  targetId: "projection-1",
  targetTypeUrl: "type.example.dev/tasks.Projection",
});
