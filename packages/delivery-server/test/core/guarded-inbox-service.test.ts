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
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Code } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import {
  DeliveryShardPickupSchema,
  GuardedInboxRequestSchema,
  RemoveMessageSchema,
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
 * Acquires one managed session after writing the supplied row.
 *
 * @param core Supplies the guarded delivery core.
 * @param row Supplies the pending row.
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

describe("guarded Inbox mutations", () => {
  it("rejects a missing handle and a row from another shard before changing storage", async () => {
    const core = InMemoryDelivery.create();
    const expected = domainMessage("authorized", shard);
    const session = await acquire(core, expected);
    expect(() =>
      core.guarded.acknowledge(create(GuardedInboxRequestSchema, { expected }), context),
    ).toThrow();
    const anotherShard = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
    const wrong = create(GuardedInboxRequestSchema, {
      session,
      expected: domainMessage("elsewhere", anotherShard),
    });
    for (const mutate of [
      core.guarded.acknowledge,
      core.guarded.removePendingDuplicate,
      core.guarded.removeExpiredDelivered,
    ]) {
      await expect(mutate(wrong, context)).rejects.toMatchObject({ code: Code.InvalidArgument });
    }
    const retained = await core.inbox.findOne(
      create(InboxMessageIdSchema, { index: shard, uuid: "authorized" }),
      context,
    );
    expect(retained.message?.status).toBe(InboxMessageStatus.TO_DELIVER);
    core.close();
  });

  it("does not match an operation with the wrong row status or a missing ACK row", async () => {
    const core = InMemoryDelivery.create();
    const pending = domainMessage("status", shard);
    const session = await acquire(core, pending);
    const pendingRequest = create(GuardedInboxRequestSchema, { session, expected: pending });
    expect((await core.guarded.removeExpiredDelivered(pendingRequest, context)).matched).toBe(
      false,
    );
    const first = await core.guarded.acknowledge(pendingRequest, context);
    if (first.message === undefined) throw new Error("Expected completion.");
    const completed = create(InboxMessageSchema, first.message);
    const completedRequest = create(GuardedInboxRequestSchema, { session, expected: completed });
    expect((await core.guarded.acknowledge(completedRequest, context)).matched).toBe(false);
    expect((await core.guarded.removePendingDuplicate(completedRequest, context)).matched).toBe(
      false,
    );
    await core.inbox.removeOne(create(RemoveMessageSchema, { message: completed }), context);
    expect((await core.guarded.acknowledge(pendingRequest, context)).matched).toBe(false);
    core.close();
  });

  it("keeps a completed row before its full-precision deadline and removes it at the boundary", async () => {
    let now = create(TimestampSchema, { seconds: 10n, nanos: 123_456 });
    const core = InMemoryDelivery.create({ now: () => now });
    const pending = domainMessage("deadline", shard);
    const session = await acquire(core, pending);
    const first = await core.guarded.acknowledge(
      create(GuardedInboxRequestSchema, { session, expected: pending }),
      context,
    );
    if (first.message === undefined) throw new Error("Expected completion.");
    const completed = create(InboxMessageSchema, first.message);
    expect(completed.keepUntil).toMatchObject({ seconds: 15n, nanos: 123_456 });
    const request = create(GuardedInboxRequestSchema, { session, expected: completed });
    now = create(TimestampSchema, { seconds: 15n, nanos: 123_455 });
    expect((await core.guarded.removeExpiredDelivered(request, context)).matched).toBe(false);
    now = create(TimestampSchema, { seconds: 15n, nanos: 123_456 });
    expect((await core.guarded.removeExpiredDelivered(request, context)).matched).toBe(true);
    expect((await core.guarded.removeExpiredDelivered(request, context)).matched).toBe(true);
    core.close();
  });

  it("retains the first completion deadline on an exact retry", async () => {
    let now = create(TimestampSchema, { seconds: 10n, nanos: 123_456 });
    const core = InMemoryDelivery.create({ now: () => now });
    const expected = domainMessage("ack", shard);
    const session = await acquire(core, expected);
    const request = create(GuardedInboxRequestSchema, { session, expected });
    const first = await core.guarded.acknowledge(request, context);
    expect(first).toMatchObject({
      matched: true,
      message: {
        status: InboxMessageStatus.DELIVERED,
        keepUntil: { seconds: 15n, nanos: 123_456 },
      },
    });
    now = create(TimestampSchema, { seconds: 20n, nanos: 987_654 });
    const repeated = await core.guarded.acknowledge(request, context);
    expect(repeated.message?.keepUntil).toEqual(first.message?.keepUntil);
    core.close();
  });

  it("rejects a replacement differing only in nanoseconds or unknown wire data", async () => {
    const core = InMemoryDelivery.create();
    const expected = domainMessage("stale", shard);
    const session = await acquire(core, expected);
    const request = create(GuardedInboxRequestSchema, { session, expected });
    const nanos = clone(InboxMessageSchema, expected);
    if (nanos.whenReceived === undefined) throw new Error("Missing receive time.");
    nanos.whenReceived.nanos += 1;
    await core.inbox.writeOne(create(WriteMessageSchema, { message: nanos }), context);
    expect((await core.guarded.acknowledge(request, context)).matched).toBe(false);
    expect((await core.guarded.removePendingDuplicate(request, context)).matched).toBe(false);
    const unknown = fromBinary(
      InboxMessageSchema,
      new Uint8Array([...toBinary(InboxMessageSchema, expected), 0x98, 0x06, 0x7b]),
    );
    await core.inbox.writeOne(create(WriteMessageSchema, { message: unknown }), context);
    expect((await core.guarded.acknowledge(request, context)).matched).toBe(false);
    expect((await core.guarded.removePendingDuplicate(request, context)).matched).toBe(false);
    core.close();
  });

  it("rejects stale completed cleanup and a lost managed session", async () => {
    let now = create(TimestampSchema, { seconds: 10n, nanos: 0 });
    const core = InMemoryDelivery.create({ now: () => now });
    const expected = domainMessage("cleanup", shard);
    const session = await acquire(core, expected);
    const first = await core.guarded.acknowledge(
      create(GuardedInboxRequestSchema, {
        session,
        expected,
      }),
      context,
    );
    if (first.message === undefined) throw new Error("Expected completion.");
    const completed = create(InboxMessageSchema, first.message);
    const request = create(GuardedInboxRequestSchema, { session, expected: completed });
    now = create(TimestampSchema, { seconds: 15n, nanos: 0 });
    const replacement = clone(InboxMessageSchema, completed);
    if (replacement.keepUntil === undefined) throw new Error("Missing deadline.");
    replacement.keepUntil.nanos += 1;
    await core.inbox.writeOne(create(WriteMessageSchema, { message: replacement }), context);
    expect((await core.guarded.removeExpiredDelivered(request, context)).matched).toBe(false);
    const unknown = fromBinary(
      InboxMessageSchema,
      new Uint8Array([...toBinary(InboxMessageSchema, completed), 0x98, 0x06, 0x7b]),
    );
    await core.inbox.writeOne(create(WriteMessageSchema, { message: unknown }), context);
    expect((await core.guarded.removeExpiredDelivered(request, context)).matched).toBe(false);
    await core.managed.releaseShardSession(session, context);
    await expect(core.guarded.removeExpiredDelivered(request, context)).rejects.toMatchObject({
      code: Code.FailedPrecondition,
    });
    core.close();
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
    const stale = create(GuardedInboxRequestSchema, { session: first, expected });
    await expect(core.guarded.acknowledge(stale, context)).rejects.toMatchObject({
      code: Code.FailedPrecondition,
    });
    await expect(core.guarded.removePendingDuplicate(stale, context)).rejects.toMatchObject({
      code: Code.FailedPrecondition,
    });
    await expect(core.guarded.removeExpiredDelivered(stale, context)).rejects.toMatchObject({
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

  it("keeps a pending row after cancellation before guarded admission", async () => {
    const core = InMemoryDelivery.create();
    const expected = domainMessage("cancelled", shard);
    const session = await acquire(core, expected);
    const cancelled = new AbortController();
    cancelled.abort(new Error("worker stopped"));
    await expect(
      core.guarded.acknowledge(
        create(GuardedInboxRequestSchema, {
          session,
          expected,
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

  it("settles repeated guarded cleanup after the first removal", async () => {
    let now = create(TimestampSchema, { seconds: 10n, nanos: 0 });
    const core = InMemoryDelivery.create({ now: () => now });
    const pending = domainMessage("duplicate-retry", shard);
    const session = await acquire(core, pending);
    const duplicate = create(GuardedInboxRequestSchema, { session, expected: pending });
    expect((await core.guarded.removePendingDuplicate(duplicate, context)).matched).toBe(true);
    expect((await core.guarded.removePendingDuplicate(duplicate, context)).matched).toBe(true);
    const later = domainMessage("completed-retry", shard);
    await core.inbox.writeOne(create(WriteMessageSchema, { message: later }), context);
    const completed = await core.guarded.acknowledge(
      create(GuardedInboxRequestSchema, {
        session,
        expected: later,
      }),
      context,
    );
    if (completed.message === undefined) throw new Error("Expected completion.");
    const completedRow = create(InboxMessageSchema, completed.message);
    now = create(TimestampSchema, { seconds: 15n, nanos: 0 });
    const cleanup = create(GuardedInboxRequestSchema, { session, expected: completedRow });
    expect((await core.guarded.removeExpiredDelivered(cleanup, context)).matched).toBe(true);
    expect((await core.guarded.removeExpiredDelivered(cleanup, context)).matched).toBe(true);
    core.close();
  });
});
