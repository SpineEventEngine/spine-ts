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
