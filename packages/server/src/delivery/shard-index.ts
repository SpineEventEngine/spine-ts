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

/**
 * Zero-based shard index with a stable shard count.
 */
export class ShardIndex {
  // prettier-ignore

  /**
   * Creates a shard index.
   *
   * @param index Identifies the zero-based shard position.
   * @param ofTotal States the total shards in the shard set.
   */
  constructor(
    // prettier-ignore

    /**
     * Zero-based position of this shard.
     */
    readonly index: number,

    /**
     * Total number of shards in the same shard set.
     */
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
