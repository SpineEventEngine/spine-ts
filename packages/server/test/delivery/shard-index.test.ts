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

import { describe, expect, it } from "vitest";

import { ShardIndex } from "../../src/index.js";

describe("ShardIndex", () => {
  it("rejects invalid index and shard count values", () => {
    expect(() => new ShardIndex(0.5, 2)).toThrow(/non-negative integer/);
    expect(() => new ShardIndex(-1, 2)).toThrow(/non-negative integer/);
    expect(() => new ShardIndex(0, 1.5)).toThrow(/positive integer/);
    expect(() => new ShardIndex(0, 0)).toThrow(/positive integer/);
    expect(() => new ShardIndex(2, 2)).toThrow(/smaller than/);
  });

  it("creates a single shard and formats stable keys", () => {
    const single = ShardIndex.single();

    expect(single).toMatchObject({ index: 0, ofTotal: 1 });
    expect(single.key()).toBe("0/1");
    expect(new ShardIndex(3, 5).key()).toBe("3/5");
  });
});
