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
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Code } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import {
  DeliveryShardPickupSchema,
  InboxWorkRequestSchema,
  WriteMessageSchema,
} from "@spine-event-engine/proto/delivery-server";
import {
  InboxMessageIdSchema,
  InboxMessageSchema,
  InboxMessageStatus,
  ShardIndexSchema,
  WorkerIdSchema,
} from "@spine-event-engine/proto/delivery";
import { InMemoryDelivery } from "../../src/index.js";
import { domainMessage } from "./domain-message.js";
import { pickedHandle } from "../session-fixtures.js";

const context = { signal: new AbortController().signal } as never;
const shard = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "run" });

/**
 * Acquires one managed session after writing a pending inbox message.
 *
 * @param core Supplies the in-memory server.
 * @param row Supplies the pending message.
 * @returns The granted handle.
 */
async function acquire(
  core: ReturnType<typeof InMemoryDelivery.create>,
  row: ReturnType<typeof domainMessage>,
) {
  await core.inbox.writeOne(create(WriteMessageSchema, { message: row }), context);
  const result = await core.managed.pickShardForDelivery(
    create(DeliveryShardPickupSchema, {
      shard,
      worker,
    }),
    context,
  );
  return pickedHandle(result);
}

describe("inbox changes during a managed shard session", () => {
  it("acknowledges the current inbox ID and cleans its shard at the retention deadline", async () => {
    let now = create(TimestampSchema, { seconds: 10n, nanos: 20 });
    const core = InMemoryDelivery.create({ now: () => now });
    try {
      const original = domainMessage("work", shard);
      const session = await acquire(core, original);
      const otherShardId = create(InboxMessageIdSchema, {
        uuid: "0fc706d5-785d-4fb5-9a08-1577fdb2fa22",
        index: create(ShardIndexSchema, { index: 1, ofTotal: 2 }),
      });
      await expect(
        core.managed.markDelivered(
          create(InboxWorkRequestSchema, { session, id: otherShardId }),
          context,
        ),
      ).rejects.toMatchObject({ code: Code.InvalidArgument });
      const replacement = domainMessage("work", shard);
      replacement.whenReceived = create(TimestampSchema, { seconds: 11n });
      await core.inbox.writeOne(create(WriteMessageSchema, { message: replacement }), context);
      const id = create(InboxMessageIdSchema, original.id);
      const request = create(InboxWorkRequestSchema, { session, id });
      const first = await core.managed.markDelivered(request, context);
      expect(first.whenKeepUntil).toMatchObject({ seconds: 15n, nanos: 20 });
      now = create(TimestampSchema, { seconds: 15n, nanos: 19 });
      const retry = await core.managed.markDelivered(request, context);
      expect(retry).toEqual(first);
      if (!retry.whenKeepUntil) throw new Error("Expected the stored retention deadline.");
      retry.whenKeepUntil.seconds = 999n;
      await core.managed.removeExpiredDelivered(session, context);
      expect((await core.inbox.findOne(id, context)).message).toMatchObject({
        status: InboxMessageStatus.DELIVERED,
        whenReceived: replacement.whenReceived,
      });
      const pending = domainMessage("next", shard);
      await core.inbox.writeOne(create(WriteMessageSchema, { message: pending }), context);
      now = create(TimestampSchema, { seconds: 15n, nanos: 20 });
      await core.managed.removeExpiredDelivered(session, context);
      expect((await core.inbox.findOne(id, context)).message).toBeUndefined();
      expect(
        (await core.inbox.findOne(create(InboxMessageIdSchema, pending.id), context)).message,
      ).toEqual(pending);
    } finally {
      core.close();
    }
  });

  it("removes a pending duplicate by inbox ID and leaves a retained completion intact", async () => {
    const core = InMemoryDelivery.create();
    try {
      const first = domainMessage("first", shard);
      const session = await acquire(core, first);
      const duplicate = create(InboxMessageSchema, {
        ...first,
        id: create(InboxMessageIdSchema, {
          uuid: "d5ebc6a3-7420-4a46-888a-a2afc55088e7",
          index: shard,
        }),
      });
      await core.inbox.writeOne(create(WriteMessageSchema, { message: duplicate }), context);
      const delivered = create(InboxWorkRequestSchema, { session, id: first.id });
      const pending = create(InboxWorkRequestSchema, { session, id: duplicate.id });
      await core.managed.markDelivered(delivered, context);
      expect((await core.managed.removeDuplicate(delivered, context)).matched).toBe(false);
      expect((await core.managed.removeDuplicate(pending, context)).matched).toBe(true);
      expect((await core.managed.removeDuplicate(pending, context)).matched).toBe(true);
      expect((await core.managed.markDelivered(pending, context)).matched).toBe(false);
      expect(
        (await core.inbox.findOne(create(InboxMessageIdSchema, first.id), context)).message?.status,
      ).toBe(InboxMessageStatus.DELIVERED);
    } finally {
      core.close();
    }
  });

  it("rejects every old worker mutation after expiry and fresh pickup", async () => {
    let elapsed = 0;
    const core = InMemoryDelivery.create({
      processingTimeoutMs: 60_000,
      monotonicNow: () => elapsed,
    });
    const expected = domainMessage("takeover", shard);
    const first = await acquire(core, expected);
    elapsed = 60_000;
    const successor = pickedHandle(
      await core.managed.pickShardForDelivery(
        create(DeliveryShardPickupSchema, {
          shard,
          worker: create(WorkerIdSchema, { nodeId: { value: "other" }, value: "run" }),
        }),
        context,
      ),
    );

    expect(successor.sessionId).not.toBe(first.sessionId);
    const stale = create(InboxWorkRequestSchema, { session: first, id: expected.id });
    await expect(core.managed.markDelivered(stale, context)).rejects.toMatchObject({
      code: Code.FailedPrecondition,
    });
    await expect(core.managed.removeDuplicate(stale, context)).rejects.toMatchObject({
      code: Code.FailedPrecondition,
    });
    await expect(core.managed.removeExpiredDelivered(first, context)).rejects.toMatchObject({
      code: Code.FailedPrecondition,
    });
    expect(
      (
        await core.inbox.findOne(
          create(InboxMessageIdSchema, { index: shard, uuid: "takeover" }),
          context,
        )
      ).message?.status,
    ).toBe(InboxMessageStatus.TO_DELIVER);
    core.close();
  });

  it("keeps the inbox message pending when the worker cancels before acknowledgement", async () => {
    const core = InMemoryDelivery.create();
    const expected = domainMessage("cancelled", shard);
    const session = await acquire(core, expected);
    const cancelled = new AbortController();
    cancelled.abort(new Error("worker stopped"));
    await expect(
      core.managed.markDelivered(
        create(InboxWorkRequestSchema, {
          session,
          id: expected.id,
        }),
        { signal: cancelled.signal } as never,
      ),
    ).rejects.toThrow();
    expect(
      (
        await core.inbox.findOne(
          create(InboxMessageIdSchema, { index: shard, uuid: "cancelled" }),
          context,
        )
      ).message?.status,
    ).toBe(InboxMessageStatus.TO_DELIVER);
    core.close();
  });
});
