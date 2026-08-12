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

import { create, toBinary } from "@bufbuild/protobuf";
import { AnySchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import { AnyMessages } from "@spine-event-engine/core";
import { EventSchema } from "@spine-event-engine/proto";

import type { InboxMessage } from "../../src/delivery/inbox.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";

export function createMessage(
  id: string,
  signalId: string,
  version: bigint,
  whenReceived = new Date("2026-07-02T08:00:00.000Z"),
): InboxMessage {
  return Object.freeze({
    id: Object.freeze({
      value: id,
      shard: ShardIndex.single(),
    }),
    inboxId: Object.freeze({
      targetId: AnyMessages.pack(
        StringValueSchema,
        create(StringValueSchema, { value: "projection-1" }),
      ),
      targetTypeUrl: "type.example.dev/tasks.Projection",
    }),
    signalId,
    signal: create(AnySchema, {
      typeUrl: "type.spine.io/spine.core.Event",
      value: toBinary(EventSchema, create(EventSchema)),
    }),
    label: "UPDATE_SUBSCRIBER" as const,
    status: "TO_DELIVER" as const,
    shard: ShardIndex.single(),
    whenReceived,
    version,
  });
}

export function oversizedText(length: number, char = "x"): string {
  return char.repeat(length);
}

export function oversizedVersion(): bigint {
  return BigInt(`1${"0".repeat(16 * 1024)}`);
}
