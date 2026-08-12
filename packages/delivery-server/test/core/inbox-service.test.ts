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
import { Code } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { CommandSchema } from "@spine-event-engine/proto";
import {
  ReadMessagesSinceTimeSchema,
  OptionalInboxMessageSchema,
  PageOfMessagesSchema,
  RemoveMessageSchema,
  RemoveMessagesSchema,
  WriteMessagesSchema,
  WriteMessageSchema,
} from "@spine-event-engine/proto/delivery-server";
import {
  InboxMessageIdSchema,
  InboxMessageSchema,
  InboxMessageStatus,
  ShardIndexSchema,
} from "@spine-event-engine/proto/delivery";

import { InMemoryDelivery } from "../../src/index.js";

const context = { signal: new AbortController().signal } as never;
const shard = create(ShardIndexSchema, { index: 0, ofTotal: 2 });

describe("in-memory Inbox", () => {
  it("upserts duplicate identities and returns detached strict ordered pages", async () => {
    const core = InMemoryDelivery.create();
    await core.inbox.writeOne(create(WriteMessageSchema, { message: message("a", 1, 2) }), context);
    await core.inbox.writeOne(create(WriteMessageSchema, { message: message("a", 2, 3) }), context);
    await core.inbox.writeOne(create(WriteMessageSchema, { message: message("b", 2, 1) }), context);

    const page = await core.inbox.findManyInShard(
      create(ReadMessagesSinceTimeSchema, {
        shard,
        pageSize: 10,
        sinceWhen: { seconds: 1n, nanos: 0 },
      }),
      context,
    );
    expect((page.message ?? []).map((value) => value.id?.uuid)).toEqual(["b", "a"]);
    const first = page.message?.[0];
    if (first?.id?.index !== undefined) first.id.index.index = 9;
    const again = await core.inbox.findManyInShard(
      create(ReadMessagesSinceTimeSchema, { shard, pageSize: 10 }),
      context,
    );
    expect(again.message?.[0]?.id?.index?.index).toBe(0);
  });

  it("rejects malformed direct messages before mutation", async () => {
    const core = InMemoryDelivery.create();
    await expect(
      core.inbox.writeOne(create(WriteMessageSchema, { message: message("", 1, 1) }), context),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    expect(
      (
        await core.inbox.findManyInShard(
          create(ReadMessagesSinceTimeSchema, { shard, pageSize: 1 }),
          context,
        )
      ).message,
    ).toHaveLength(0);
    expect(() => core.inbox.findOne(id("", shard), context)).toThrow(
      expect.objectContaining({ code: Code.InvalidArgument }),
    );
    expect(() =>
      core.inbox.findManyInShard(
        create(ReadMessagesSinceTimeSchema, {
          shard,
          pageSize: 1,
          sinceWhen: { seconds: -62_135_596_801n, nanos: 0 },
        }),
        context,
      ),
    ).toThrow(expect.objectContaining({ code: Code.InvalidArgument }));
  });

  it("rejects poison direct-RPC records and atomically rejects a mixed batch", async () => {
    const core = InMemoryDelivery.create();
    const poison = message("poison", 1, 1);
    poison.payload = { case: undefined };
    await expect(
      core.inbox.writeOne(create(WriteMessageSchema, { message: poison }), context),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    const oversized = message("oversized", 1, 1);
    oversized.payload = {
      case: "command",
      value: create(CommandSchema, {
        message: { typeUrl: "example.Payload", value: new Uint8Array(1_048_577) },
      }),
    };
    await expect(
      core.inbox.writeOne(create(WriteMessageSchema, { message: oversized }), context),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    const invalid = message("invalid", 1, 1);
    invalid.label = 0;
    await expect(
      core.inbox.writeMany(
        create(WriteMessagesSchema, { shard, message: [message("safe", 1, 1), invalid] }),
        context,
      ),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    expect((await core.inbox.findOne(id("safe", shard), context)).message).toBeUndefined();
  });

  it("rejects retained message, byte, and shard capacity atomically", async () => {
    const messages = InMemoryDelivery.create({ maxRetainedMessages: 1 });
    await expect(
      messages.inbox.writeMany(
        create(WriteMessagesSchema, {
          shard,
          message: [message("one", 1, 1), message("two", 1, 1)],
        }),
        context,
      ),
    ).rejects.toMatchObject({ code: Code.ResourceExhausted });
    expect((await messages.inbox.findOne(id("one", shard), context)).message).toBeUndefined();

    const bytes = InMemoryDelivery.create({ maxRetainedBytes: 1 });
    await expect(
      bytes.inbox.writeOne(
        create(WriteMessageSchema, { message: message("bytes", 1, 1) }),
        context,
      ),
    ).rejects.toMatchObject({ code: Code.ResourceExhausted });

    const shards = InMemoryDelivery.create({ maxTrackedShards: 1 });
    const other = create(ShardIndexSchema, { index: 0, ofTotal: 3 });
    await shards.inbox.writeOne(
      create(WriteMessageSchema, { message: message("first", 1, 1) }),
      context,
    );
    await expect(
      shards.inbox.writeOne(
        create(WriteMessageSchema, { message: message("second", 1, 1, other) }),
        context,
      ),
    ).rejects.toMatchObject({ code: Code.ResourceExhausted });
  });

  it("bounds full records and explicitly rejects an oversized requested page", async () => {
    const core = InMemoryDelivery.create();
    const records = Array.from({ length: 5 }, (_, index) =>
      message(`large-${String(index)}`, 1, index, shard, 0, 900_000),
    );
    await core.inbox.writeMany(create(WriteMessagesSchema, { shard, message: records }), context);
    const one = await core.inbox.findOne(id("large-0", shard), context);
    expect(
      toBinary(OptionalInboxMessageSchema, create(OptionalInboxMessageSchema, one)).byteLength,
    ).toBeLessThanOrEqual(4_194_304);
    const newest = await core.inbox.newestMessageToDeliver(shard, context);
    expect(
      toBinary(OptionalInboxMessageSchema, create(OptionalInboxMessageSchema, newest)).byteLength,
    ).toBeLessThanOrEqual(4_194_304);
    expect(() =>
      core.inbox.findManyInShard(
        create(ReadMessagesSinceTimeSchema, { shard, pageSize: 5 }),
        context,
      ),
    ).toThrow(
      expect.objectContaining({
        code: Code.ResourceExhausted,
        rawMessage: "Delivery page exceeds the 4 MiB response limit; request a smaller page.",
      }),
    );
    const page = await core.inbox.findManyInShard(
      create(ReadMessagesSinceTimeSchema, { shard, pageSize: 4 }),
      context,
    );
    expect(
      toBinary(PageOfMessagesSchema, create(PageOfMessagesSchema, page)).byteLength,
    ).toBeLessThanOrEqual(4_194_304);

    const oversizedRecord = message("record", 1, 1);
    if (oversizedRecord.inboxId === undefined) throw new Error("Expected Inbox ID.");
    oversizedRecord.inboxId.typeUrl = "x".repeat(4_194_304);
    await expect(
      core.inbox.writeOne(create(WriteMessageSchema, { message: oversizedRecord }), context),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it("rejects write and remove batch lengths before inspecting records", async () => {
    const core = InMemoryDelivery.create();
    for (const request of [
      core.inbox.writeMany(
        create(WriteMessagesSchema, { shard, message: Array.from({ length: 101 }, () => ({})) }),
        context,
      ),
      core.inbox.removeMany(
        create(RemoveMessagesSchema, { shard, message: Array.from({ length: 101 }, () => ({})) }),
        context,
      ),
      core.inbox.writeMany(create(WriteMessagesSchema, { shard, message: [] }), context),
      core.inbox.removeMany(create(RemoveMessagesSchema, { shard, message: [] }), context),
    ]) {
      await expect(request).rejects.toMatchObject({
        code: Code.InvalidArgument,
        rawMessage: "Delivery message batch is invalid.",
      });
    }
  });

  it("rejects impossible shard identities before Inbox reads or admission", async () => {
    const core = InMemoryDelivery.create();
    const impossible = create(ShardIndexSchema, { index: 2, ofTotal: 2 });
    await expect(
      core.inbox.writeOne(
        create(WriteMessageSchema, { message: message("impossible", 1, 1, impossible) }),
        context,
      ),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    expect(() => core.inbox.findOne(id("impossible", impossible), context)).toThrow(
      expect.objectContaining({ code: Code.InvalidArgument }),
    );
    expect(() =>
      core.inbox.findManyInShard(
        create(ReadMessagesSinceTimeSchema, { shard: impossible, pageSize: 1 }),
        context,
      ),
    ).toThrow(expect.objectContaining({ code: Code.InvalidArgument }));
    expect(
      (
        await core.inbox.findManyInShard(
          create(ReadMessagesSinceTimeSchema, { shard, pageSize: 1 }),
          context,
        )
      ).message,
    ).toHaveLength(0);
  });

  it("keeps same UUIDs in different full shard identities and batch changes atomic", async () => {
    const core = InMemoryDelivery.create();
    const other = create(ShardIndexSchema, { index: 0, ofTotal: 3 });
    await core.inbox.writeOne(
      create(WriteMessageSchema, { message: message("same", 1, 1) }),
      context,
    );
    await core.inbox.writeOne(
      create(WriteMessageSchema, { message: message("same", 1, 1, other) }),
      context,
    );
    expect((await core.inbox.findOne(id("same", shard), context)).message?.id?.index?.ofTotal).toBe(
      2,
    );
    expect((await core.inbox.findOne(id("same", other), context)).message?.id?.index?.ofTotal).toBe(
      3,
    );
    await core.inbox.writeMany(
      create(WriteMessagesSchema, {
        shard,
        message: [message("repeat", 1, 1), message("repeat", 2, 2)],
      }),
      context,
    );
    expect((await core.inbox.findOne(id("repeat", shard), context)).message?.version).toBe(2);
    await expect(
      core.inbox.writeMany(
        create(WriteMessagesSchema, { shard, message: [message("new", 1, 1), message("", 1, 1)] }),
        context,
      ),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    expect((await core.inbox.findOne(id("new", shard), context)).message).toBeUndefined();
    await core.inbox.removeMany(
      create(RemoveMessagesSchema, {
        shard,
        message: [message("repeat", 1, 1), message("repeat", 1, 1), message("missing", 1, 1)],
      }),
      context,
    );
    expect((await core.inbox.findOne(id("repeat", shard), context)).message).toBeUndefined();
    await core.inbox.removeOne(
      create(RemoveMessageSchema, { message: message("same", 1, 1) }),
      context,
    );
    expect((await core.inbox.findOne(id("same", other), context)).message).toBeDefined();
  });

  it("uses strict nanos and bounded pages and starts a new core empty", async () => {
    const core = InMemoryDelivery.create();
    await core.inbox.writeOne(
      create(WriteMessageSchema, { message: message("nanos", 1, 1, shard, 5) }),
      context,
    );
    expect(
      (
        await core.inbox.findManyInShard(
          create(ReadMessagesSinceTimeSchema, {
            shard,
            pageSize: 10,
            sinceWhen: { seconds: 1n, nanos: 5 },
          }),
          context,
        )
      ).message,
    ).toHaveLength(0);
    expect(() =>
      core.inbox.findManyInShard(
        create(ReadMessagesSinceTimeSchema, { shard, pageSize: 0 }),
        context,
      ),
    ).toThrow();
    expect(() =>
      core.inbox.findManyInShard(
        create(ReadMessagesSinceTimeSchema, { shard, pageSize: 1001 }),
        context,
      ),
    ).toThrow();
    expect(
      (await InMemoryDelivery.create().inbox.findOne(id("nanos", shard), context)).message,
    ).toBeUndefined();
  });

  it("selects newest pending by timestamp, version, then UUID", async () => {
    const core = InMemoryDelivery.create();
    await core.inbox.writeOne(
      create(WriteMessageSchema, { message: message("a", 2, 1, shard, 1) }),
      context,
    );
    await core.inbox.writeOne(
      create(WriteMessageSchema, { message: message("z", 2, 1, shard, 1) }),
      context,
    );
    await core.inbox.writeOne(
      create(WriteMessageSchema, {
        message: create(InboxMessageSchema, {
          ...message("ignored", 3, 9),
          status: InboxMessageStatus.DELIVERED,
        }),
      }),
      context,
    );
    expect((await core.inbox.newestMessageToDeliver(shard, context)).message?.id?.uuid).toBe("z");
  });
});

function message(
  uuid: string,
  seconds: number,
  version: number,
  index = shard,
  nanos = 0,
  payloadBytes = 0,
) {
  return create(InboxMessageSchema, {
    id: { uuid, index },
    signalId: { value: "signal" },
    inboxId: { entityId: { id: { typeUrl: "example.Entity" } }, typeUrl: "example.State" },
    payload: {
      case: "command",
      value: create(CommandSchema, {
        message: { typeUrl: "example.Payload", value: new Uint8Array(payloadBytes) },
      }),
    },
    label: 1,
    whenReceived: { seconds: BigInt(seconds), nanos },
    version,
    status: InboxMessageStatus.TO_DELIVER,
  });
}

function id(uuid: string, index: typeof shard) {
  return create(InboxMessageIdSchema, { uuid, index });
}
