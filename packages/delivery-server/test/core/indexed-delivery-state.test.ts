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
import { describe, expect, it, vi } from "vitest";
import { InboxMessageStatus, ShardIndexSchema } from "@spine-event-engine/proto/delivery";
import { InMemoryDeliveryState } from "../../src/core/in-memory-delivery-state.js";
import { domainMessage } from "./domain-message.js";

const first = create(ShardIndexSchema, { index: 0, ofTotal: 2 });
const second = create(ShardIndexSchema, { index: 1, ofTotal: 2 });

describe("indexed delivery state", () => {
  it("retains more than the former 10,000 row default across shards", () => {
    const state = new InMemoryDeliveryState();
    const rows = Array.from({ length: 10_001 }, (_, index) => {
      const shard = create(ShardIndexSchema, { index, ofTotal: 10_001 });
      const message = domainMessage(`row-${String(index)}`, shard);
      return { message };
    });
    state.putAll(rows);
    expect([...state.knownShards()]).toHaveLength(10_001);
    expect([...state.pendingShards()]).toHaveLength(10_001);
    const extra = domainMessage("extra", first);
    state.putAll([{ message: extra }]);
    expect(state.storedCount(first)).toBe(1);
  });

  it("orders one shard by full time, version, then UTF-8 ID without reading unrelated rows", () => {
    const state = new InMemoryDeliveryState();
    const rows = [
      domainMessage("é", first, 500_000, 1),
      domainMessage("z", first, 500_000, 1),
      domainMessage("early", first, 499_000, 9),
      domainMessage("later", first, 500_000, 2),
      domainMessage("other", second, 0, 0),
    ];
    state.putAll(rows.map((message) => ({ message })));
    const values = vi.spyOn(state.messages, "values").mockImplementation(() => {
      throw new Error("unrelated global scan");
    });
    const keys = vi.spyOn(state.messages, "keys").mockImplementation(() => {
      throw new Error("unrelated global key copy");
    });
    expect(state.page(first, undefined, 10).map((row) => row.id?.uuid)).toEqual([
      "early",
      "z",
      "é",
      "later",
    ]);
    expect(
      state.page(first, { seconds: 1n, nanos: 499_000 }, 10).map((row) => row.id?.uuid),
    ).toEqual(["z", "é", "later"]);
    expect(state.newestPending(first)?.id?.uuid).toBe("later");
    expect(state.storedCount(first)).toBe(4);
    expect([...state.pendingShards()]).toEqual([first, second]);
    expect([...state.knownShards()]).toEqual([first, second]);
    const added = domainMessage("new", first, 501_000, 0);
    state.putAll([{ message: added }]);
    expect(state.storedCount(first)).toBe(5);
    values.mockRestore();
    keys.mockRestore();
  });

  it("tracks a final repeated identity once and indexes later writes", () => {
    const state = new InMemoryDeliveryState();
    const one = domainMessage("one", first);
    const completed = domainMessage("one", first, 0, 1, InboxMessageStatus.DELIVERED);
    state.putAll([{ message: one }, { message: completed }]);
    expect(state.storedCount(first)).toBe(1);
    expect(state.hasPending(first)).toBe(false);
    expect(state.newestPending(first)).toBeUndefined();
    const two = domainMessage("two", second);
    const three = domainMessage("three", first);
    state.putAll([{ message: two }, { message: three }]);
    expect(state.storedCount(first)).toBe(2);
    expect(state.storedCount(second)).toBe(1);
    expect(state.messages.size).toBe(3);
    expect(state.delete(completed)).toBe(true);
    expect(state.delete(completed)).toBe(false);
    expect(state.storedCount(first)).toBe(1);
    expect([...state.knownShards()]).toEqual([first, second]);
  });
});
