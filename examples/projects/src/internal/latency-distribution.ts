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
