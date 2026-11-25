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
  PickUpShardSchema,
  ReleaseExpiredSessionsSchema,
  ReleaseShardSchema,
} from "@spine-event-engine/proto/delivery-server";
import { ShardIndexSchema, WorkerIdSchema } from "@spine-event-engine/proto/delivery";

import { InMemoryDelivery } from "../../src/index.js";
import { domainMessage, encodedBytes } from "./domain-message.js";

const context = { signal: new AbortController().signal } as never;
const shard = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "run-1" });
const rival = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "run-2" });
const request = create(DeliveryShardPickupSchema, { shard, worker });

function picked(
  result: Awaited<
    ReturnType<ReturnType<typeof InMemoryDelivery.create>["managed"]["pickShardRaw"]>
  >,
) {
  if (result.result.case !== "pickedUp") throw new Error("Expected a pickup.");
  return result.result.value;
}

describe("typed Shard sessions", () => {
  it("returns no work for a free empty managed shard but grants a raw handle", async () => {
    const core = InMemoryDelivery.create();
    expect((await core.managed.pickShardForDelivery(request, context)).result.case).toBe("noWork");
    const raw = picked(await core.managed.pickShardRaw(request, context));
    expect(raw.sessionId).toBeTruthy();
    expect(raw).toMatchObject({ lifetime: { seconds: 60n } });
    expect((await core.managed.pickShardForDelivery(request, context)).result.case).toBe("busy");
    await core.managed.releaseShardSession(raw, context);
    core.close();
  });

  it("renews a raw same-worker pickup but never renews managed through raw pickup", async () => {
    const core = InMemoryDelivery.create();
    const first = picked(await core.managed.pickShardRaw(request, context));
    const renewedRaw = picked(await core.managed.pickShardRaw(request, context));
    expect(renewedRaw.sessionId).toBe(first.sessionId);
    await core.managed.releaseShardSession(first, context);
    const row = domainMessage("pending", shard);
    await core.inbox.writeOne({ message: row }, context);
    const managed = picked(await core.managed.pickShardForDelivery(request, context));
    expect((await core.managed.pickShardRaw(request, context)).result.case).toBe("busy");
    const renewed = await core.managed.renewShardSession(managed, context);
    expect(renewed.sessionId).toBe(managed.sessionId);
    expect(encodedBytes(row)).toBeGreaterThan(0);
    core.close();
  });

  it("rejects worker-only mutation calls and keeps the current typed session", async () => {
    const core = InMemoryDelivery.create();
    const handle = picked(await core.managed.pickShardRaw(request, context));
    await expect(
      core.shards.pickShard(create(PickUpShardSchema, { shard, worker }), context),
    ).rejects.toMatchObject({ code: Code.FailedPrecondition });
    await expect(
      core.shards.releaseSession(create(ReleaseShardSchema, { shard, worker }), context),
    ).rejects.toMatchObject({ code: Code.FailedPrecondition });
    expect(
      (
        await core.managed.pickShardRaw(
          create(DeliveryShardPickupSchema, {
            shard,
            worker: rival,
          }),
          context,
        )
      ).result.case,
    ).toBe("busy");
    await core.managed.releaseShardSession(handle, context);
    core.close();
  });

  it("preserves nanoseconds for exact 499/500 microsecond inactivity boundaries", async () => {
    let now = create(TimestampSchema, { seconds: 10n, nanos: 0 });
    const core = InMemoryDelivery.create({ now: () => now });
    const handle = picked(await core.managed.pickShardRaw(request, context));
    expect(handle).toMatchObject({ whenPicked: { nanos: 0 } });
    const release = create(ReleaseExpiredSessionsSchema, {
      inactivityPeriod: { seconds: 0n, nanos: 500_000 },
    });
    now = create(TimestampSchema, { seconds: 10n, nanos: 499_000 });
    expect((await core.shards.releaseSessions(release, context)).shard).toHaveLength(0);
    now = create(TimestampSchema, { seconds: 10n, nanos: 500_000 });
    const released = (await core.shards.releaseSessions(release, context)).shard;
    expect(released).toHaveLength(1);
    expect(released[0]?.whenPicked?.nanos).toBe(0);
    expect(released[0]?.whenReleased?.nanos).toBe(500_000);
    core.close();
  });

  it("ignores a stale release for a later pickup by the same worker", async () => {
    const core = InMemoryDelivery.create();
    const old = picked(await core.managed.pickShardRaw(request, context));
    await core.managed.releaseShardSession(old, context);
    const current = picked(await core.managed.pickShardRaw(request, context));
    expect(current.sessionId).not.toBe(old.sessionId);
    await core.managed.releaseShardSession(old, context);
    expect(
      (
        await core.managed.pickShardRaw(
          create(DeliveryShardPickupSchema, {
            shard,
            worker: rival,
          }),
          context,
        )
      ).result.case,
    ).toBe("busy");
    core.close();
  });

  it("checks cancellation at mutation admission", async () => {
    const core = InMemoryDelivery.create();
    const cancelled = new AbortController();
    cancelled.abort(new Error("cancelled"));
    await expect(
      core.managed.pickShardRaw(request, { signal: cancelled.signal } as never),
    ).rejects.toThrow("cancelled");
    expect((await core.managed.pickShardRaw(request, context)).result.case).toBe("pickedUp");
    core.close();
  });

  it("rejects malformed workers, shards, and overflowing durations before mutation", async () => {
    const core = InMemoryDelivery.create();
    const invalidShard = create(ShardIndexSchema, { index: 2, ofTotal: 2 });
    await expect(
      core.managed.pickShardRaw(
        create(DeliveryShardPickupSchema, { shard, worker: create(WorkerIdSchema) }),
        context,
      ),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    await expect(
      core.managed.pickShardRaw(
        create(DeliveryShardPickupSchema, { shard: invalidShard, worker }),
        context,
      ),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    await expect(
      core.shards.releaseSessions(
        create(ReleaseExpiredSessionsSchema, {
          inactivityPeriod: { seconds: 315_576_000_001n },
        }),
        context,
      ),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    expect((await core.managed.pickShardRaw(request, context)).result.case).toBe("pickedUp");
    core.close();
  });

  it("rejects an invalid clock before storing a session", async () => {
    const core = InMemoryDelivery.create({
      now: () =>
        create(TimestampSchema, {
          seconds: 253_402_300_800n,
        }),
    });
    await expect(core.managed.pickShardRaw(request, context)).rejects.toThrow(
      "Delivery clock returned an invalid timestamp.",
    );
    core.close();
  });

  it("enforces tracked-shard capacity and frees it after a raw release", async () => {
    const core = InMemoryDelivery.create({ maxTrackedShards: 1 });
    const other = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
    const first = picked(await core.managed.pickShardRaw(request, context));
    await expect(
      core.managed.pickShardRaw(
        create(DeliveryShardPickupSchema, {
          shard: other,
          worker,
        }),
        context,
      ),
    ).rejects.toMatchObject({ code: Code.ResourceExhausted });
    await core.managed.releaseShardSession(first, context);
    expect(
      (
        await core.managed.pickShardRaw(
          create(DeliveryShardPickupSchema, {
            shard: other,
            worker,
          }),
          context,
        )
      ).result.case,
    ).toBe("pickedUp");
    core.close();
  });

  it("releases every eligible current session at one exact manual boundary", async () => {
    let now = create(TimestampSchema, { seconds: 20n, nanos: 0 });
    const core = InMemoryDelivery.create({ now: () => now });
    const other = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
    await core.managed.pickShardRaw(request, context);
    await core.managed.pickShardRaw(
      create(DeliveryShardPickupSchema, {
        shard: other,
        worker: rival,
      }),
      context,
    );
    now = create(TimestampSchema, { seconds: 20n, nanos: 500_000 });
    const outcome = await core.shards.releaseSessions(
      create(ReleaseExpiredSessionsSchema, {
        inactivityPeriod: { seconds: 0n, nanos: 500_000 },
      }),
      context,
    );
    expect(outcome.shard).toHaveLength(2);
    expect(outcome.shard.map((value) => value.shard?.index)).toEqual([0, 1]);
    core.close();
  });
});
