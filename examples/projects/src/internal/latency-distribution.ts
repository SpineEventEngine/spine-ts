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
 * Reports nearest-rank latency measurements in milliseconds.
 */
export interface LatencyPercentiles {
  // prettier-ignore

  /**
   * Reports the nearest-rank fiftieth-percentile latency.
   */
  readonly p50Ms: number;

  /**
   * Reports the nearest-rank ninety-fifth-percentile latency.
   */
  readonly p95Ms: number;

  /**
   * Reports the nearest-rank ninety-ninth-percentile latency.
   */
  readonly p99Ms: number;
}

/**
 * Calculates nearest-rank latency percentiles for internal load aggregation.
 * @internal
 */
export class LatencyDistribution {
  // prettier-ignore

  /**
   * Calculates percentile values from unsorted latency measurements.
   *
   * @param values Supplies latency measurements in milliseconds.
   * @returns Reports zeroes for empty input or nearest-rank percentile values.
   */
  static from(values: readonly number[]): LatencyPercentiles {
    const distribution = new LatencyDistribution(values);
    return {
      p50Ms: distribution.nearestRank(0.5),
      p95Ms: distribution.nearestRank(0.95),
      p99Ms: distribution.nearestRank(0.99),
    };
  }

  private readonly sorted: readonly number[];

  private constructor(values: readonly number[]) {
    this.sorted = [...values].sort((left, right) => left - right);
  }

  private nearestRank(ratio: number): number {
    if (this.sorted.length === 0) return 0;
    return (
      this.sorted[Math.min(this.sorted.length - 1, Math.ceil(this.sorted.length * ratio) - 1)] ?? 0
    );
  }
}
