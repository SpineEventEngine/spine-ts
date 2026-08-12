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

  it("rejects malformed message identity and tolerates an absent release", () => {
    const state = new InMemoryDeliveryState();
    const shard = create(ShardIndexSchema, { index: 0, ofTotal: 1 });

    expect(state.release(shard)).toBeUndefined();
    expect(() =>
      state.putAll([
        {
          message: create(InboxMessageSchema, { id: { uuid: "missing-shard" } }),
          bytes: 1,
        },
      ]),
    ).toThrow("Delivery message identity is missing.");
  });

  it("fails closed when callers corrupt the exposed retained-message map", () => {
    const shard = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
    const message = create(InboxMessageSchema, { id: { uuid: "message", index: shard } });
    const seeded = new InMemoryDeliveryState();
    seeded.putAll([{ message, bytes: 1 }]);
    const key = seeded.messages.keys().next().value;
    if (key === undefined) throw new Error("Expected a retained message key.");

    const replacement = new InMemoryDeliveryState();
    replacement.messages.set(key, message);
    expect(() => replacement.putAll([{ message, bytes: 2 }])).toThrow(
      "Delivery message shard count is invalid.",
    );

    const deletion = new InMemoryDeliveryState();
    deletion.putAll([{ message, bytes: 1 }]);
    expect(deletion.delete(message)).toBe(true);
    deletion.messages.set(key, message);
    expect(() => deletion.delete(message)).toThrow("Delivery message shard count is invalid.");
  });
});
