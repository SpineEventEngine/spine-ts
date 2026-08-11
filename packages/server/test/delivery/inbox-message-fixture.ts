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
      targetId: AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: "projection-1" })),
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
