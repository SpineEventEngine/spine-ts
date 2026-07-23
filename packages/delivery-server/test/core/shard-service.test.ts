import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import {
  PickUpShardSchema,
  ReleaseExpiredSessionsSchema,
  ReleaseShardSchema,
} from "@spine-ts/proto/delivery-server";
import { ShardIndexSchema, WorkerIdSchema } from "@spine-ts/proto/delivery";

import { createInMemoryDeliveryServerCore } from "../../src/index.js";

const context = { signal: new AbortController().signal } as never;
const shard = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" });

describe("in-memory Shards", () => {
  it("allows exactly one active pickup and allows reacquisition after worker-agnostic release", async () => {
    const core = createInMemoryDeliveryServerCore();
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
    const core = createInMemoryDeliveryServerCore();
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
    const core = createInMemoryDeliveryServerCore({ processingTimeoutMs: 10, now: () => now });
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
    const strict = createInMemoryDeliveryServerCore({ processingTimeoutMs: 10, now: () => now });
    await strict.shards.pickShard(request, context);
    now = 11;
    await expect(strict.shards.pickShard(request, context)).resolves.toMatchObject({
      value: { case: "pickedUp" },
    });
    const disabled = createInMemoryDeliveryServerCore({ processingTimeoutMs: 0, now: () => now });
    await disabled.shards.pickShard(request, context);
    now = 1_000_000;
    await expect(disabled.shards.pickShard(request, context)).resolves.toMatchObject({
      value: { case: "alreadyPickedUp" },
    });
  });

  it("rejects an invalid clock before storing a shard session", async () => {
    const request = create(PickUpShardSchema, { shard, worker });
    for (const now of [Number.NaN, -62_135_596_800_001, 253_402_300_800_000]) {
      const core = createInMemoryDeliveryServerCore({ now: () => now });
      await expect(core.shards.pickShard(request, context)).rejects.toBeInstanceOf(RangeError);
    }
    const healthy = createInMemoryDeliveryServerCore({ now: () => 0 });
    await expect(healthy.shards.pickShard(request, context)).resolves.toMatchObject({
      value: { case: "pickedUp" },
    });
  });

  it("treats absent and repeated releases as no-ops regardless of supplied worker", async () => {
    const core = createInMemoryDeliveryServerCore();
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
    const core = createInMemoryDeliveryServerCore();
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
    const core = createInMemoryDeliveryServerCore();
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
    const core = createInMemoryDeliveryServerCore({ maxTrackedShards: 1 });
    const other = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
    await core.shards.pickShard(create(PickUpShardSchema, { shard, worker }), context);
    await expect(
      core.shards.pickShard(create(PickUpShardSchema, { shard: other, worker }), context),
    ).rejects.toMatchObject({ code: Code.ResourceExhausted });
  });

  it("prunes released message-free shards so normal churn does not consume capacity", async () => {
    const core = createInMemoryDeliveryServerCore({ maxTrackedShards: 1 });
    const other = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
    await core.shards.pickShard(create(PickUpShardSchema, { shard, worker }), context);
    await core.shards.releaseSession(create(ReleaseShardSchema, { shard, worker }), context);
    await expect(
      core.shards.pickShard(create(PickUpShardSchema, { shard: other, worker }), context),
    ).resolves.toMatchObject({ value: { case: "pickedUp" } });
  });

  it("does not manually expire below the threshold", async () => {
    let now = 0;
    const core = createInMemoryDeliveryServerCore({ now: () => now });
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
    const core = createInMemoryDeliveryServerCore({ now: () => now });
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
