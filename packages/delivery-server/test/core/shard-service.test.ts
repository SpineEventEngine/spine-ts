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
import { describe, expect, it, vi } from "vitest";
import {
  DeliveryShardPickupSchema,
  WriteMessageSchema,
  PickUpShardSchema,
  ReleaseExpiredSessionsSchema,
  ReleaseShardSchema,
} from "@spine-event-engine/proto/delivery-server";
import { ShardIndexSchema, WorkerIdSchema } from "@spine-event-engine/proto/delivery";

import { InMemoryDelivery } from "../../src/index.js";
import { DeliveryAssembly } from "../../src/server/assembly.js";
import { domainMessage, encodedBytes } from "./domain-message.js";
import { pickedHandle } from "../session-fixtures.js";

const context = { signal: new AbortController().signal } as never;
const shard = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "run-1" });
const rival = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "run-2" });
const request = create(DeliveryShardPickupSchema, { shard, worker });

describe("typed Shard sessions", () => {
  it("releases more than 1,000 eligible sessions without truncation", async () => {
    let now = create(TimestampSchema, { seconds: 1n });
    const core = InMemoryDelivery.create({ now: () => now });
    try {
      for (let index = 0; index < 1_201; index++) {
        const at = create(ShardIndexSchema, { index, ofTotal: 1_201 });
        const result = await core.managed.pickShardRaw(
          create(DeliveryShardPickupSchema, { shard: at, worker }),
          context,
        );
        expect(result.result?.case).toBe("pickedUp");
      }
      now = create(TimestampSchema, { seconds: 3n });
      const released = await core.shards.releaseSessions(
        create(ReleaseExpiredSessionsSchema, { inactivityPeriod: { seconds: 1n } }),
        context,
      );
      expect(released.shard).toHaveLength(1_201);
      expect(released.shard?.at(-1)?.shard?.index).toBe(1_200);
    } finally {
      core.close();
    }
  });

  it("keeps a long session through the first Node timer and expires at the full lifetime", async () => {
    vi.useFakeTimers();
    const firstTimer = 2_147_483_647;
    const core = InMemoryDelivery.create({ processingTimeoutMs: firstTimer + 10 });
    const competing = create(DeliveryShardPickupSchema, { shard, worker: rival });
    try {
      const first = pickedHandle(await core.managed.pickShardRaw(request, context));
      await vi.advanceTimersByTimeAsync(firstTimer);
      expect((await core.managed.pickShardRaw(competing, context)).result?.case).toBe("busy");
      await vi.advanceTimersByTimeAsync(10);
      const second = pickedHandle(await core.managed.pickShardRaw(competing, context));
      expect(second.sessionId).not.toBe(first.sessionId);
    } finally {
      core.close();
      vi.useRealTimers();
    }
  });

  it("keeps the live session when a renewal or release has an invalid handle", async () => {
    const core = InMemoryDelivery.create();
    try {
      const active = pickedHandle(await core.managed.pickShardRaw(request, context));
      await expect(
        core.managed.renewShardSession({ ...active, sessionId: " " }, context),
      ).rejects.toMatchObject({ code: Code.InvalidArgument });
      await expect(
        core.managed.releaseShardSession({ ...active, whenPicked: undefined }, context),
      ).rejects.toMatchObject({ code: Code.InvalidArgument });
      const renewed = await core.managed.renewShardSession(active, context);
      expect(renewed.sessionId).toBe(active.sessionId);
    } finally {
      core.close();
    }
  });

  it("skips a shard with a released session and a pending row during inactivity cleanup", async () => {
    const core = InMemoryDelivery.create();
    try {
      const row = domainMessage("waiting-after-release", shard);
      await core.inbox.writeOne(create(WriteMessageSchema, { message: row }), context);
      const handle = pickedHandle(await core.managed.pickShardForDelivery(request, context));
      await core.managed.releaseShardSession(handle, context);
      const free = await core.shards.releaseSessions(
        create(ReleaseExpiredSessionsSchema, {
          inactivityPeriod: { seconds: 0n, nanos: 1_000 },
        }),
        context,
      );
      expect(free.shard).toEqual([]);
      expect((await core.inbox.newestMessageToDeliver(shard, context)).message).toEqual(row);
    } finally {
      core.close();
    }
  });

  it("returns no work for a free empty managed shard but grants a raw handle", async () => {
    const core = InMemoryDelivery.create();
    expect((await core.managed.pickShardForDelivery(request, context)).result?.case).toBe("noWork");
    const raw = pickedHandle(await core.managed.pickShardRaw(request, context));
    expect(raw.sessionId).toBeTruthy();
    expect(raw).toMatchObject({ lifetime: { seconds: 60n } });
    expect((await core.managed.pickShardForDelivery(request, context)).result?.case).toBe("busy");
    await core.managed.releaseShardSession(raw, context);
    core.close();
  });

  it("reports a later pickup reply sample than the retained session sample", async () => {
    let nanos = 0;
    const core = InMemoryDelivery.create({
      now: () => create(TimestampSchema, { seconds: 10n, nanos: nanos++ }),
    });
    const handle = pickedHandle(await core.managed.pickShardRaw(request, context));
    const busy = await core.managed.pickShardRaw(
      create(DeliveryShardPickupSchema, { shard, worker: rival }),
      context,
    );
    expect(handle.whenPicked).toMatchObject({ nanos: 1 });
    expect(busy.result?.case).toBe("busy");
    if (busy.result?.case === "busy")
      expect(busy.result.value.whenPicked).toMatchObject({ nanos: 0 });
    core.close();
  });

  it("renews a raw same-worker pickup but never renews managed through raw pickup", async () => {
    const core = InMemoryDelivery.create();
    const first = pickedHandle(await core.managed.pickShardRaw(request, context));
    const renewedRaw = pickedHandle(await core.managed.pickShardRaw(request, context));
    expect(renewedRaw.sessionId).toBe(first.sessionId);
    await core.managed.releaseShardSession(first, context);
    const row = domainMessage("pending", shard);
    await core.inbox.writeOne(create(WriteMessageSchema, { message: row }), context);
    const managed = pickedHandle(await core.managed.pickShardForDelivery(request, context));
    expect((await core.managed.pickShardRaw(request, context)).result?.case).toBe("busy");
    const renewed = await core.managed.renewShardSession(managed, context);
    expect(renewed.sessionId).toBe(managed.sessionId);
    expect(encodedBytes(row)).toBeGreaterThan(0);
    core.close();
  });

  it("rejects worker-only mutation calls and keeps the current typed session", async () => {
    const core = InMemoryDelivery.create();
    const handle = pickedHandle(await core.managed.pickShardRaw(request, context));
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
      ).result?.case,
    ).toBe("busy");
    await core.managed.releaseShardSession(handle, context);
    core.close();
  });

  it("preserves nanoseconds for exact 499/500 microsecond inactivity boundaries", async () => {
    let now = create(TimestampSchema, { seconds: 10n, nanos: 0 });
    const core = InMemoryDelivery.create({ now: () => now });
    const handle = pickedHandle(await core.managed.pickShardRaw(request, context));
    expect(handle).toMatchObject({ whenPicked: { nanos: 0 } });
    const release = create(ReleaseExpiredSessionsSchema, {
      inactivityPeriod: { seconds: 0n, nanos: 500_000 },
    });
    now = create(TimestampSchema, { seconds: 10n, nanos: 499_000 });
    expect((await core.shards.releaseSessions(release, context)).shard).toHaveLength(0);
    now = create(TimestampSchema, { seconds: 10n, nanos: 500_000 });
    const released = (await core.shards.releaseSessions(release, context)).shard ?? [];
    expect(released).toHaveLength(1);
    expect(released[0]?.whenPicked?.nanos).toBe(0);
    expect(released[0]?.whenReleased?.nanos).toBe(500_000);
    core.close();
  });

  it("ignores a stale release for a later pickup by the same worker", async () => {
    const core = InMemoryDelivery.create();
    const old = pickedHandle(await core.managed.pickShardRaw(request, context));
    await core.managed.releaseShardSession(old, context);
    const current = pickedHandle(await core.managed.pickShardRaw(request, context));
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
      ).result?.case,
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
    expect((await core.managed.pickShardRaw(request, context)).result?.case).toBe("pickedUp");
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
    expect((await core.managed.pickShardRaw(request, context)).result?.case).toBe("pickedUp");
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
    expect((outcome.shard ?? []).map((value) => value.shard?.index)).toEqual([0, 1]);
    core.close();
  });

  it("keeps a renewed revision when an earlier release enters the same admission batch", async () => {
    const core = InMemoryDelivery.create();
    const first = pickedHandle(await core.managed.pickShardRaw(request, context));
    const renewal = core.managed.renewShardSession(first, context);
    const staleRelease = core.managed.releaseShardSession(first, context);
    const refreshed = await renewal;
    await staleRelease;
    expect(refreshed.sessionId).toBe(first.sessionId);
    expect(
      (
        await core.managed.pickShardRaw(
          create(DeliveryShardPickupSchema, {
            shard,
            worker: rival,
          }),
          context,
        )
      ).result?.case,
    ).toBe("busy");
    await core.managed.releaseShardSession(first, context);
    expect(
      (
        await core.managed.pickShardRaw(
          create(DeliveryShardPickupSchema, {
            shard,
            worker: rival,
          }),
          context,
        )
      ).result?.case,
    ).toBe("pickedUp");
    core.close();
  });

  it("keeps a renewal when a private release captured its revision before a capacity wait", async () => {
    const assembly = DeliveryAssembly.create();
    try {
      const first = pickedHandle(await assembly.managed.pickShardRaw(request, context));
      const delayedRevision = assembly.sessionRuntime.receivedRevision(first.shard);
      await assembly.managed.renewShardSession(first, context);
      await assembly.sessionRuntime.releaseAtRevision(
        first,
        new AbortController().signal,
        delayedRevision,
      );
      expect(
        (
          await assembly.managed.pickShardRaw(
            create(DeliveryShardPickupSchema, { shard, worker: rival }),
            context,
          )
        ).result?.case,
      ).toBe("busy");
    } finally {
      assembly.closeSessions();
    }
  });

  it("rejects a renewal that entered after a release in the same admission batch", async () => {
    const core = InMemoryDelivery.create();
    const first = pickedHandle(await core.managed.pickShardRaw(request, context));
    const release = core.managed.releaseShardSession(first, context);
    const renewal = core.managed.renewShardSession(first, context);
    await release;
    await expect(renewal).rejects.toMatchObject({ code: Code.FailedPrecondition });
    expect((await core.managed.pickShardRaw(request, context)).result?.case).toBe("pickedUp");
    core.close();
  });

  it("uses monotonic elapsed time when wall time rolls back during renewal", async () => {
    let wall = create(TimestampSchema, { seconds: 10n, nanos: 0 });
    let elapsed = 0;
    const core = InMemoryDelivery.create({
      processingTimeoutMs: 100,
      now: () => wall,
      monotonicNow: () => elapsed,
    });
    const first = pickedHandle(await core.managed.pickShardRaw(request, context));
    elapsed = 90;
    wall = create(TimestampSchema, { seconds: 5n, nanos: 0 });
    const renewed = await core.managed.renewShardSession(first, context);
    expect(renewed.whenPicked).toMatchObject({ seconds: 10n });
    elapsed = 189;
    const competing = create(DeliveryShardPickupSchema, { shard, worker: rival });
    expect((await core.managed.pickShardRaw(competing, context)).result?.case).toBe("busy");
    elapsed = 190;
    expect((await core.managed.pickShardRaw(competing, context)).result?.case).toBe("pickedUp");
    core.close();
  });
});
