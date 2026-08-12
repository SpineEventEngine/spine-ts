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
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import {
  PickUpShardSchema,
  ReleaseExpiredSessionsSchema,
  ReleaseShardSchema,
  RemoveMessageSchema,
  WriteMessageSchema,
} from "@spine-event-engine/proto/delivery-server";
import { CommandSchema } from "@spine-event-engine/proto";
import {
  InboxMessageSchema,
  InboxMessageStatus,
  ShardIndexSchema,
  WorkerIdSchema,
} from "@spine-event-engine/proto/delivery";

import { InMemoryDelivery } from "../../src/index.js";

const context = { signal: new AbortController().signal } as never;
const shard = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" });

describe("in-memory Shards", () => {
  it("refreshes the same live worker but never lets a delayed owner release its replacement", async () => {
    const core = InMemoryDelivery.create();
    const first = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "first" });
    const second = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "second" });
    const firstPickup = create(PickUpShardSchema, { shard, worker: first });
    const secondPickup = create(PickUpShardSchema, { shard, worker: second });

    const revalidate = {
      signal: new AbortController().signal,
      requestHeader: new Headers([["x-spine-delivery-revalidate", "true"]]),
      responseHeader: new Headers(),
    } as never;
    await core.shards.pickShard(firstPickup, context);
    await expect(core.shards.pickShard(firstPickup, revalidate)).resolves.toMatchObject({
      value: { case: "pickedUp", value: { worker: first } },
    });
    expect(
      (revalidate as { responseHeader: Headers }).responseHeader.get(
        "x-spine-delivery-revalidation",
      ),
    ).toBe("refreshed");
    await core.shards.releaseSession(create(ReleaseShardSchema, { shard, worker: first }), context);
    await core.shards.pickShard(secondPickup, context);
    await core.shards.releaseSession(create(ReleaseShardSchema, { shard, worker: first }), context);

    await expect(core.shards.pickShard(secondPickup, context)).resolves.toMatchObject({
      value: { case: "alreadyPickedUp", value: { worker: second } },
    });
  });

  it("labels fresh and conflicting revalidation outcomes", async () => {
    const core = InMemoryDelivery.create();
    const first = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "first" });
    const second = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "second" });
    const revalidate = () =>
      ({
        signal: new AbortController().signal,
        requestHeader: new Headers([["x-spine-delivery-revalidate", "true"]]),
        responseHeader: new Headers(),
      }) as never;
    const fresh = revalidate();

    await core.shards.pickShard(create(PickUpShardSchema, { shard, worker: first }), fresh);
    expect(
      (fresh as { responseHeader: Headers }).responseHeader.get("x-spine-delivery-revalidation"),
    ).toBe("picked");

    const conflicting = revalidate();
    await expect(
      core.shards.pickShard(create(PickUpShardSchema, { shard, worker: second }), conflicting),
    ).resolves.toMatchObject({ value: { case: "alreadyPickedUp" } });
    expect(
      (conflicting as { responseHeader: Headers }).responseHeader.get(
        "x-spine-delivery-revalidation",
      ),
    ).toBe("lost");
  });

  it("counts only TO_DELIVER messages across replacement and deletion", async () => {
    const core = InMemoryDelivery.create();
    const pending = {
      signal: new AbortController().signal,
      requestHeader: new Headers([["x-spine-delivery-pickup-mode", "pending"]]),
      responseHeader: new Headers(),
    } as never;
    const request = create(PickUpShardSchema, { shard, worker });
    const message = pendingMessage("status");
    await core.inbox.writeOne(create(WriteMessageSchema, { message }), context);
    await expect(core.shards.pickShard(request, pending)).resolves.toMatchObject({
      value: { case: "pickedUp" },
    });
    await core.shards.releaseSession(create(ReleaseShardSchema, { shard, worker }), context);
    const delivered = create(InboxMessageSchema, {
      ...message,
      status: InboxMessageStatus.DELIVERED,
    });
    await core.inbox.writeOne(create(WriteMessageSchema, { message: delivered }), context);
    await expect(core.shards.pickShard(request, pending)).rejects.toMatchObject({
      code: Code.FailedPrecondition,
    });
    await core.inbox.writeOne(create(WriteMessageSchema, { message }), context);
    await expect(core.shards.pickShard(request, pending)).resolves.toMatchObject({
      value: { case: "pickedUp" },
    });
    await core.inbox.removeOne(create(RemoveMessageSchema, { message }), context);
    await core.shards.releaseSession(create(ReleaseShardSchema, { shard, worker }), context);
    await expect(core.shards.pickShard(request, pending)).rejects.toMatchObject({
      code: Code.FailedPrecondition,
    });
  });
  it("conditionally refuses an empty shard without creating a session", async () => {
    const core = InMemoryDelivery.create();
    const pending = {
      signal: new AbortController().signal,
      requestHeader: new Headers([["x-spine-delivery-pickup-mode", "pending"]]),
      responseHeader: new Headers(),
    } as never;
    const request = create(PickUpShardSchema, { shard, worker });

    let outcome: unknown;
    try {
      await core.shards.pickShard(request, pending);
    } catch (error) {
      outcome = error;
    }
    expect(outcome).toMatchObject({ code: Code.FailedPrecondition });
    expect((outcome as ConnectError).metadata.get("x-spine-delivery-outcome")).toBe(
      "no-pending-work",
    );
    await expect(core.shards.pickShard(request, context)).resolves.toMatchObject({
      value: { case: "pickedUp" },
    });
  });

  it("conditionally picks up a shard with retained pending work and rejects malformed pickup modes", async () => {
    const core = InMemoryDelivery.create();
    await core.inbox.writeOne(
      create(WriteMessageSchema, { message: pendingMessage("pending") }),
      context,
    );
    const request = create(PickUpShardSchema, { shard, worker });
    const pending = {
      signal: new AbortController().signal,
      requestHeader: new Headers([["x-spine-delivery-pickup-mode", "pending"]]),
      responseHeader: new Headers(),
    } as never;
    const malformed = {
      signal: new AbortController().signal,
      requestHeader: new Headers([["x-spine-delivery-pickup-mode", "anything-else"]]),
      responseHeader: new Headers(),
    } as never;

    await expect(core.shards.pickShard(request, pending)).resolves.toMatchObject({
      value: { case: "pickedUp" },
    });
    expect(
      (pending as { responseHeader: Headers }).responseHeader.get("x-spine-delivery-outcome"),
    ).toBe("pending-acknowledged");
    await expect(core.shards.pickShard(request, pending)).resolves.toMatchObject({
      value: { case: "alreadyPickedUp" },
    });
    expect(
      (pending as { responseHeader: Headers }).responseHeader.get("x-spine-delivery-outcome"),
    ).toBe("pending-acknowledged");
    await expect(core.shards.pickShard(request, malformed)).rejects.toMatchObject({
      code: Code.InvalidArgument,
    });
  });

  it("rejects a delayed conditional loser after removal and observes arrivals on either side", async () => {
    const core = InMemoryDelivery.create();
    const request = create(PickUpShardSchema, { shard, worker });
    const release = create(ReleaseShardSchema, { shard, worker });
    const pending = {
      signal: new AbortController().signal,
      requestHeader: new Headers([["x-spine-delivery-pickup-mode", "pending"]]),
      responseHeader: new Headers(),
    } as never;
    const winnerMessage = pendingMessage("winner");
    await core.inbox.writeOne(create(WriteMessageSchema, { message: winnerMessage }), context);
    await core.shards.pickShard(request, context);
    await core.inbox.removeOne(create(RemoveMessageSchema, { message: winnerMessage }), context);
    await core.shards.releaseSession(release, context);

    await expect(core.shards.pickShard(request, pending)).rejects.toMatchObject({
      code: Code.FailedPrecondition,
    });
    const before = pendingMessage("before");
    await core.inbox.writeOne(create(WriteMessageSchema, { message: before }), context);
    await expect(core.shards.pickShard(request, pending)).resolves.toMatchObject({
      value: { case: "pickedUp" },
    });
    await core.inbox.removeOne(create(RemoveMessageSchema, { message: before }), context);
    await core.shards.releaseSession(release, context);
    await expect(core.shards.pickShard(request, pending)).rejects.toMatchObject({
      code: Code.FailedPrecondition,
    });

    await core.inbox.writeOne(
      create(WriteMessageSchema, { message: pendingMessage("after") }),
      context,
    );
    await expect(core.shards.pickShard(request, pending)).resolves.toMatchObject({
      value: { case: "pickedUp" },
    });
  });

  it("allows exactly one active pickup and allows reacquisition after worker-agnostic release", async () => {
    const core = InMemoryDelivery.create();
    const request = create(PickUpShardSchema, { shard, worker });
    const results = await Promise.all(
      Array.from({ length: 20 }, () => Promise.resolve(core.shards.pickShard(request, context))),
    );
    expect(results.filter((value) => value.value?.case === "pickedUp")).toHaveLength(1);
    await core.shards.releaseSession(create(ReleaseShardSchema, { shard, worker }), context);
    await expect(core.shards.pickShard(request, context)).resolves.toMatchObject({
      value: { case: "pickedUp" },
    });
  });

  it("detaches already-picked-up workers and requires a release worker", async () => {
    const core = InMemoryDelivery.create();
    const request = create(PickUpShardSchema, { shard, worker });
    await core.shards.pickShard(request, context);
    const rejected = await core.shards.pickShard(request, context);
    if (rejected.value?.case !== "alreadyPickedUp") throw new Error("Expected rejection.");
    if (rejected.value.value.worker === undefined) throw new Error("Expected worker.");
    rejected.value.value.worker.value = "mutated";
    const again = await core.shards.pickShard(request, context);
    expect(again).toMatchObject({ value: { case: "alreadyPickedUp", value: { worker } } });
    await expect(
      core.shards.releaseSession(create(ReleaseShardSchema, { shard }), context),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it("uses strict automatic and inclusive manual expiration boundaries", async () => {
    let now = 100;
    const core = InMemoryDelivery.create({ processingTimeoutMs: 10, now: () => now });
    const request = create(PickUpShardSchema, { shard, worker });
    await core.shards.pickShard(request, context);
    now = 110;
    await expect(core.shards.pickShard(request, context)).resolves.toMatchObject({
      value: { case: "alreadyPickedUp" },
    });
    const released = await core.shards.releaseSessions(
      create(ReleaseExpiredSessionsSchema, {
        inactivityPeriod: { seconds: 0n, nanos: 10_000_000 },
      }),
      context,
    );
    expect(released.shard).toHaveLength(1);
    await expect(core.shards.pickShard(request, context)).resolves.toMatchObject({
      value: { case: "pickedUp" },
    });
  });

  it("takes over one millisecond after timeout and never takes over when timeout is zero", async () => {
    let now = 0;
    const request = create(PickUpShardSchema, { shard, worker });
    const strict = InMemoryDelivery.create({ processingTimeoutMs: 10, now: () => now });
    await strict.shards.pickShard(request, context);
    now = 11;
    await expect(strict.shards.pickShard(request, context)).resolves.toMatchObject({
      value: { case: "pickedUp" },
    });
    const disabled = InMemoryDelivery.create({ processingTimeoutMs: 0, now: () => now });
    await disabled.shards.pickShard(request, context);
    now = 1_000_000;
    await expect(disabled.shards.pickShard(request, context)).resolves.toMatchObject({
      value: { case: "alreadyPickedUp" },
    });
  });

  it("rejects an invalid clock before storing a shard session", async () => {
    const request = create(PickUpShardSchema, { shard, worker });
    for (const now of [Number.NaN, -62_135_596_800_001, 253_402_300_800_000]) {
      const core = InMemoryDelivery.create({ now: () => now });
      await expect(core.shards.pickShard(request, context)).rejects.toBeInstanceOf(RangeError);
    }
    const healthy = InMemoryDelivery.create({ now: () => 0 });
    await expect(healthy.shards.pickShard(request, context)).resolves.toMatchObject({
      value: { case: "pickedUp" },
    });
  });

  it("treats absent and repeated releases as no-ops regardless of supplied worker", async () => {
    const core = InMemoryDelivery.create();
    const request = create(PickUpShardSchema, { shard, worker });
    await core.shards.releaseSession(create(ReleaseShardSchema, { shard, worker }), context);
    await core.shards.pickShard(request, context);
    await core.shards.releaseSession(
      create(ReleaseShardSchema, {
        shard,
        worker: create(WorkerIdSchema, { nodeId: { value: "other" }, value: "other" }),
      }),
      context,
    );
    await core.shards.releaseSession(create(ReleaseShardSchema, { shard, worker }), context);
    await expect(core.shards.pickShard(request, context)).resolves.toMatchObject({
      value: { case: "pickedUp" },
    });
  });

  it("rejects malformed shard workers and protobuf-overflow durations", async () => {
    const core = InMemoryDelivery.create();
    await expect(
      core.shards.releaseSessions(create(ReleaseExpiredSessionsSchema), context),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    await expect(
      core.shards.pickShard(
        create(PickUpShardSchema, { shard: { index: -1, ofTotal: 1 }, worker }),
        context,
      ),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    await expect(
      core.shards.pickShard(create(PickUpShardSchema, { shard, worker: { value: "" } }), context),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    await expect(
      core.shards.pickShard(
        create(PickUpShardSchema, {
          shard,
          worker: { nodeId: { value: "node" }, value: "x".repeat(129) },
        }),
        context,
      ),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    await expect(
      core.shards.releaseSessions(
        create(ReleaseExpiredSessionsSchema, {
          inactivityPeriod: { seconds: 315_576_000_001n, nanos: 0 },
        }),
        context,
      ),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it("rejects impossible shard identities before pickup or release admission", async () => {
    const core = InMemoryDelivery.create();
    const impossible = create(ShardIndexSchema, { index: 1, ofTotal: 1 });
    await expect(
      core.shards.pickShard(create(PickUpShardSchema, { shard: impossible, worker }), context),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    await expect(
      core.shards.releaseSession(
        create(ReleaseShardSchema, { shard: impossible, worker }),
        context,
      ),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    await expect(
      core.shards.pickShard(create(PickUpShardSchema, { shard, worker }), context),
    ).resolves.toMatchObject({ value: { case: "pickedUp" } });
  });

  it("rejects a new session once tracked-shard capacity is full", async () => {
    const core = InMemoryDelivery.create({ maxTrackedShards: 1 });
    const other = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
    await core.shards.pickShard(create(PickUpShardSchema, { shard, worker }), context);
    await expect(
      core.shards.pickShard(create(PickUpShardSchema, { shard: other, worker }), context),
    ).rejects.toMatchObject({ code: Code.ResourceExhausted });
  });

  it("prunes released message-free shards so normal churn does not consume capacity", async () => {
    const core = InMemoryDelivery.create({ maxTrackedShards: 1 });
    const other = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
    await core.shards.pickShard(create(PickUpShardSchema, { shard, worker }), context);
    await core.shards.releaseSession(create(ReleaseShardSchema, { shard, worker }), context);
    await expect(
      core.shards.pickShard(create(PickUpShardSchema, { shard: other, worker }), context),
    ).resolves.toMatchObject({ value: { case: "pickedUp" } });
  });

  it("does not manually expire below the threshold", async () => {
    let now = 0;
    const core = InMemoryDelivery.create({ now: () => now });
    const request = create(PickUpShardSchema, { shard, worker });
    await core.shards.pickShard(request, context);
    now = 9;
    const released = await core.shards.releaseSessions(
      create(ReleaseExpiredSessionsSchema, {
        inactivityPeriod: { seconds: 0n, nanos: 10_000_000 },
      }),
      context,
    );
    expect(released.shard).toHaveLength(0);
    await expect(core.shards.pickShard(request, context)).resolves.toMatchObject({
      value: { case: "alreadyPickedUp" },
    });
  });

  it("releases every eligible active shard atomically at the manual boundary", async () => {
    let now = 0;
    const core = InMemoryDelivery.create({ now: () => now });
    const first = create(ShardIndexSchema, { index: 0, ofTotal: 2 });
    const second = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
    await core.shards.pickShard(create(PickUpShardSchema, { shard: first, worker }), context);
    await core.shards.pickShard(create(PickUpShardSchema, { shard: second, worker }), context);
    now = 10;
    const released = await core.shards.releaseSessions(
      create(ReleaseExpiredSessionsSchema, {
        inactivityPeriod: { seconds: 0n, nanos: 10_000_000 },
      }),
      context,
    );
    expect(released.shard?.map((value) => value.shard?.index)).toEqual([0, 1]);
    expect(released.shard).toMatchObject([
      {
        worker,
        whenPicked: { seconds: 0n, nanos: 0 },
        whenReleased: { seconds: 0n, nanos: 10_000_000 },
      },
      {
        worker,
        whenPicked: { seconds: 0n, nanos: 0 },
        whenReleased: { seconds: 0n, nanos: 10_000_000 },
      },
    ]);
    await expect(
      core.shards.pickShard(create(PickUpShardSchema, { shard: first, worker }), context),
    ).resolves.toMatchObject({ value: { case: "pickedUp" } });
    await expect(
      core.shards.pickShard(create(PickUpShardSchema, { shard: second, worker }), context),
    ).resolves.toMatchObject({ value: { case: "pickedUp" } });
  });
});

function pendingMessage(uuid: string) {
  return create(InboxMessageSchema, {
    id: { uuid, index: shard },
    signalId: { value: "signal" },
    inboxId: { entityId: { id: { typeUrl: "example.Entity" } }, typeUrl: "example.State" },
    payload: {
      case: "command",
      value: create(CommandSchema, { message: { typeUrl: "example.Command" } }),
    },
    label: 1,
    status: 1,
    whenReceived: { seconds: 1n, nanos: 0 },
    version: 1,
  });
}
