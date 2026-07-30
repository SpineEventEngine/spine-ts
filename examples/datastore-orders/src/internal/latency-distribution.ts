/** Latency measurements at selected nearest-rank percentiles. */
export interface LatencyPercentiles {
  /** Nearest-rank fiftieth percentile latency in milliseconds. */
  readonly p50Ms: number;
  /** Nearest-rank ninety-fifth percentile latency in milliseconds. */
  readonly p95Ms: number;
  /** Nearest-rank ninety-ninth percentile latency in milliseconds. */
  readonly p99Ms: number;
}

/** Internal nearest-rank percentile calculator for load-run latency measurements.
 *
 * @internal
 */
export class LatencyDistribution {
  private constructor(private readonly sorted: readonly number[]) {}

  static from(values: readonly number[]): LatencyDistribution {
    return new LatencyDistribution([...values].sort((left, right) => left - right));
  }

  percentiles(): LatencyPercentiles {
    return {
      p50Ms: this.atNearestRank(0.5),
      p95Ms: this.atNearestRank(0.95),
      p99Ms: this.atNearestRank(0.99),
    };
  }

  private atNearestRank(ratio: number): number {
    return this.sorted.length === 0
      ? 0
      : (this.sorted[Math.min(this.sorted.length - 1, Math.ceil(this.sorted.length * ratio) - 1)] ??
          0);
  }
}
