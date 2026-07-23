import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ShardIndexSchema, WorkerIdSchema } from "@spine-ts/proto/delivery";

import { InMemoryDeliveryState } from "../../src/core/in-memory-delivery-state.js";

describe("InMemoryDeliveryState", () => {
  it("retains last-pick data while clearing a released worker", () => {
    const state = new InMemoryDeliveryState();
    const shard = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
    const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" });
    state.setSession(shard, worker, 42);
    state.release(shard);
    const record = state.shards.get("0/1");
    expect(record?.worker).toBeUndefined();
    expect(record?.whenLastPicked).toBe(42);
  });
});
