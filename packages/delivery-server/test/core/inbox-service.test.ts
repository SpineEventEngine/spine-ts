import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import {
  ReadMessagesSinceTimeSchema,
  RemoveMessageSchema,
  RemoveMessagesSchema,
  WriteMessagesSchema,
  WriteMessageSchema,
} from "@spine-ts/proto/delivery-server";
import {
  InboxMessageIdSchema,
  InboxMessageSchema,
  InboxMessageStatus,
  ShardIndexSchema,
} from "@spine-ts/proto/delivery";

import { createInMemoryDeliveryServerCore } from "../../src/index.js";

const context = { signal: new AbortController().signal } as never;
const shard = create(ShardIndexSchema, { index: 0, ofTotal: 2 });

describe("in-memory Inbox", () => {
  it("upserts duplicate identities and returns detached strict ordered pages", async () => {
    const core = createInMemoryDeliveryServerCore();
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
    const core = createInMemoryDeliveryServerCore();
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

  it("rejects impossible shard identities before Inbox reads or admission", async () => {
    const core = createInMemoryDeliveryServerCore();
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
    const core = createInMemoryDeliveryServerCore();
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
    const core = createInMemoryDeliveryServerCore();
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
      (await createInMemoryDeliveryServerCore().inbox.findOne(id("nanos", shard), context)).message,
    ).toBeUndefined();
  });

  it("selects newest pending by timestamp, version, then UUID", async () => {
    const core = createInMemoryDeliveryServerCore();
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

function message(uuid: string, seconds: number, version: number, index = shard, nanos = 0) {
  return create(InboxMessageSchema, {
    id: { uuid, index },
    whenReceived: { seconds: BigInt(seconds), nanos },
    version,
    status: InboxMessageStatus.TO_DELIVER,
  });
}

function id(uuid: string, index: typeof shard) {
  return create(InboxMessageIdSchema, { uuid, index });
}
