import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
  InboxMessageSchema,
  ShardIndexSchema,
  WorkerIdSchema,
} from "@spine-event-engine/proto/delivery";

import { InMemoryDeliveryState } from "../../src/core/in-memory-delivery-state.js";

describe("InMemoryDeliveryState", () => {
  it("retains last-pick data while clearing a released worker", () => {
    const state = new InMemoryDeliveryState();
    const shard = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
    const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" });
    state.putAll([
      { message: create(InboxMessageSchema, { id: { uuid: "message", index: shard } }), bytes: 1 },
    ]);
    state.setSession(shard, worker, 42);
    state.release(shard);
    const record = state.shards.get("0/1");
    expect(record?.worker).toBeUndefined();
    expect(record?.whenLastPicked).toBe(42);
  });

  it("prunes a released shard after its last retained message is removed", () => {
    const state = new InMemoryDeliveryState({ maxTrackedShards: 1 });
    const first = create(ShardIndexSchema, { index: 0, ofTotal: 2 });
    const second = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
    const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" });
    const message = create(InboxMessageSchema, { id: { uuid: "message", index: first } });
    state.putAll([{ message, bytes: 1 }]);
    state.setSession(first, worker, 42);
    state.release(first);
    state.delete(message);
    expect(state.shards.has("0/2")).toBe(false);
    expect(() => {
      state.setSession(second, worker, 43);
    }).not.toThrow();
  });
});
