/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import {
  PickUpShardSchema,
  ReleaseExpiredSessionsSchema,
  ReleaseShardSchema,
} from "@spine-event-engine/proto/delivery-server";
import { ShardIndexSchema, WorkerIdSchema } from "@spine-event-engine/proto/delivery";
import { InMemoryDelivery } from "../../src/index.js";

const context = { signal: new AbortController().signal } as never;
const shard = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" });
const rival = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "rival" });
const pickup = (who = worker) => create(PickUpShardSchema, { shard, worker: who });
const release = (who = worker) => create(ReleaseShardSchema, { shard, worker: who });

describe("ShardService", () => {
  it("picks a free shard and reports a full-precision reply timestamp", async () => {
    const now = create(TimestampSchema, { seconds: 12n, nanos: 123_456_789 });
    const core = InMemoryDelivery.create({ now: () => now });
    const result = await core.shards.pickShard(pickup(), context);
    expect(result.value?.case).toBe("pickedUp");
    if (result.value?.case === "pickedUp")
      expect(result.value.value.whenPicked).toMatchObject(now);
    core.close();
  });

  it("renews on a repeat pickup by the same worker and rejects another worker", async () => {
    let now = create(TimestampSchema, { seconds: 12n, nanos: 1 });
    const core = InMemoryDelivery.create({ now: () => now });
    await core.shards.pickShard(pickup(), context);
    now = create(TimestampSchema, { seconds: 12n, nanos: 2 });
    expect((await core.shards.pickShard(pickup(), context)).value?.case).toBe("pickedUp");
    const busy = await core.shards.pickShard(pickup(rival), context);
    expect(busy.value?.case).toBe("alreadyPickedUp");
    if (busy.value?.case === "alreadyPickedUp") expect(busy.value.value.whenPicked?.nanos).toBe(2);
    core.close();
  });

  it("does not release another worker's shard", async () => {
    const core = InMemoryDelivery.create();
    await core.shards.pickShard(pickup(), context);
    await core.shards.releaseSession(release(rival), context);
    expect((await core.shards.pickShard(pickup(rival), context)).value?.case).toBe(
      "alreadyPickedUp",
    );
    await core.shards.releaseSession(release(), context);
    expect((await core.shards.pickShard(pickup(rival), context)).value?.case).toBe("pickedUp");
    core.close();
  });

  it("takes over only after the configured processing timeout", async () => {
    let now = create(TimestampSchema, { seconds: 1n });
    const core = InMemoryDelivery.create({ now: () => now, processingTimeoutMs: 1_000 });
    await core.shards.pickShard(pickup(), context);
    now = create(TimestampSchema, { seconds: 2n });
    expect((await core.shards.pickShard(pickup(rival), context)).value?.case).toBe(
      "alreadyPickedUp",
    );
    now = create(TimestampSchema, { seconds: 2n, nanos: 1 });
    expect((await core.shards.pickShard(pickup(rival), context)).value?.case).toBe("pickedUp");
    core.close();
  });

  it("releases all sessions at the exact inactivity threshold without truncation", async () => {
    let now = create(TimestampSchema, { seconds: 1n });
    const core = InMemoryDelivery.create({ now: () => now });
    for (let index = 0; index < 1_001; index++) {
      const manyShard = create(ShardIndexSchema, { index, ofTotal: 1_001 });
      await core.shards.pickShard(create(PickUpShardSchema, { shard: manyShard, worker }), context);
    }
    now = create(TimestampSchema, { seconds: 2n });
    const released = await core.shards.releaseSessions(
      create(ReleaseExpiredSessionsSchema, {
        inactivityPeriod: { seconds: 1n },
      }),
      context,
    );
    expect(released.shard).toHaveLength(1_001);
    core.close();
  });
});
