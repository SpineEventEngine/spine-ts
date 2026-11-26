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
  it("accepts batches and pages beyond the former 100 and 1000 record cutoffs", async () => {
    const core = InMemoryDelivery.create();
    const records = Array.from({ length: 1_001 }, (_, index) =>
      message(`unbounded-${String(index)}`, 1, index),
    );
    await core.inbox.writeMany(create(WriteMessagesSchema, { shard, message: records }), context);
    const page = await core.inbox.findManyInShard(
      create(ReadMessagesSinceTimeSchema, { shard, pageSize: 1_001 }),
      context,
    );
    expect(page.message).toHaveLength(1_001);
  });

  it("accepts a payload and response beyond the former byte cutoffs", async () => {
    const core = InMemoryDelivery.create();
    const large = message("large", 1, 1, shard, 0, 4_194_305);
    await core.inbox.writeOne(create(WriteMessageSchema, { message: large }), context);
    const found = await core.inbox.findOne(id("large", shard), context);
    expect(found.message?.payload?.case).toBe("command");
    expect(
      toBinary(OptionalInboxMessageSchema, create(OptionalInboxMessageSchema, found)).byteLength,
    ).toBeGreaterThan(4_194_304);
  });
  it("upserts duplicate identities and returns detached strict ordered pages", async () => {
    const core = InMemoryDelivery.create();
    await core.inbox.writeOne(create(WriteMessageSchema, { message: message("a", 1, 2) }), context);
    await core.inbox.writeOne(
      create(WriteMessageSchema, {
        message: { ...message("a", 2, 3), status: InboxMessageStatus.DELIVERED },
      }),
      context,
    );
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
    expect(page.message?.[1]?.status).toBe(InboxMessageStatus.DELIVERED);
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

  it("returns a full page larger than the former RPC response ceiling", async () => {
    const core = InMemoryDelivery.create();
    const records = Array.from({ length: 5 }, (_, index) =>
      message(`large-${String(index)}`, 1, index, shard, 0, 900_000),
    );
    await core.inbox.writeMany(create(WriteMessagesSchema, { shard, message: records }), context);
    const page = await core.inbox.findManyInShard(
      create(ReadMessagesSinceTimeSchema, { shard, pageSize: 5 }),
      context,
    );
    expect(page.message).toHaveLength(5);
    expect(
      toBinary(PageOfMessagesSchema, create(PageOfMessagesSchema, page)).byteLength,
    ).toBeGreaterThan(4_194_304);
  });

  it("keeps more than 32 MiB of separately written inbox rows", async () => {
    const core = InMemoryDelivery.create();
    try {
      for (let i = 0; i < 9; i++) {
        const row = message(`stored-${String(i)}`, 1, i, shard, 0, 4 * 1024 * 1024);
        await core.inbox.writeOne(create(WriteMessageSchema, { message: row }), context);
      }
      for (const key of ["stored-0", "stored-8"]) {
        const found = await core.inbox.findOne(id(key, shard), context);
        expect(found.message?.id?.uuid).toBe(key);
      }
    } finally {
      core.close();
    }
  });

  it("rejects empty batches and validates records in nonempty batches", async () => {
    const core = InMemoryDelivery.create();
    for (const request of [
      core.inbox.writeMany(create(WriteMessagesSchema, { shard, message: [] }), context),
      core.inbox.removeMany(create(RemoveMessagesSchema, { shard, message: [] }), context),
    ]) {
      await expect(request).rejects.toMatchObject({
        code: Code.InvalidArgument,
        rawMessage: "Delivery message batch is invalid.",
      });
    }
    await expect(
      core.inbox.writeMany(
        create(WriteMessagesSchema, { shard, message: Array.from({ length: 101 }, () => ({})) }),
        context,
      ),
    ).rejects.toMatchObject({
      code: Code.InvalidArgument,
      rawMessage: "Delivery message identity is incomplete.",
    });
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

  it("uses strict nanos and starts a new core empty", async () => {
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
