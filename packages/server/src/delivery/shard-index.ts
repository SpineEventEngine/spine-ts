/** Zero-based shard index with a stable shard count. */
export class ShardIndex {
  /**
   * Creates a shard index.
   *
   * @param index - Identifies the zero-based shard position.
   * @param ofTotal - States the total shards in the shard set.
   */
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

  /**
   * Creates the single local shard.
   *
   * @returns The only shard in a one-shard set.
   */
  static single(): ShardIndex {
    return new ShardIndex(0, 1);
  }

  /**
   * Returns the deterministic storage key for this shard.
   *
   * @returns The shard position and total encoded as a storage key.
   */
  key(): string {
    return `${String(this.index)}/${String(this.ofTotal)}`;
  }
}
