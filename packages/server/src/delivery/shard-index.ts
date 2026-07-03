/** Zero-based shard index with a stable shard count. */
export class ShardIndex {
  /** Create a shard index. */
  constructor(
    /** Zero-based position of this shard. */
    readonly index: number,
    /** Total number of shards in the same shard set. */
    readonly ofTotal: number,
  ) {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error("ShardIndex.index must be a non-negative integer.");
    }
    if (!Number.isInteger(ofTotal) || ofTotal <= 0) {
      throw new Error("ShardIndex.ofTotal must be a positive integer.");
    }
    if (index >= ofTotal) {
      throw new Error("ShardIndex.index must be smaller than ShardIndex.ofTotal.");
    }
    Object.freeze(this);
  }

  /** Single local shard. */
  static single(): ShardIndex {
    return new ShardIndex(0, 1);
  }

  /** Deterministic storage key for this shard. */
  key(): string {
    return `${String(this.index)}/${String(this.ofTotal)}`;
  }
}
