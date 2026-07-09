import type { Delivery, DeliveryEndpoint, DeliveryFailure, DeliveryRun } from "./delivery.js";
import type { ShardIndex } from "./shard-index.js";

/** Small scheduler loop around the direct `Delivery.drain()` worker boundary. */
export class DeliveryLoop {
  readonly #delivery: Delivery;
  readonly #shard: ShardIndex;
  readonly #node: string;
  readonly #limit: number | undefined;
  readonly #maxFailures: number;
  readonly #onMessage: DeliveryEndpoint;
  readonly #state = { stopped: false };
  #running: Promise<DeliveryLoopRun> | undefined;

  /** Configure a loop for one shard and node. */
  constructor(options: DeliveryLoopOptions) {
    this.#delivery = options.delivery;
    this.#shard = options.shard;
    this.#node = options.node;
    this.#limit =
      options.limit === undefined ? undefined : requirePositiveSafeInteger("limit", options.limit);
    this.#maxFailures = requirePositiveSafeInteger("maxFailures", options.maxFailures ?? 1);
    this.#onMessage = options.onMessage;
    Object.freeze(this);
  }

  /** Run drains until idle, skipped, stopped, or the failure bound is reached. */
  run(): Promise<DeliveryLoopRun> {
    if (this.#running !== undefined) {
      throw new Error("DeliveryLoop is already running.");
    }
    if (this.#state.stopped) {
      return Promise.resolve(loopRun("STOPPED"));
    }

    const running = this.#runLoop().finally(() => {
      this.#running = undefined;
    });
    this.#running = running;
    return running;
  }

  /** Prevent future drain starts without interrupting a current `Delivery.drain()`. */
  stop(): void {
    this.#state.stopped = true;
  }

  /** Call `stop()` and wait for the current drain, if any, to finish. */
  async close(): Promise<void> {
    this.stop();
    await this.#running;
  }

  async #runLoop(): Promise<DeliveryLoopRun> {
    const summary = new DeliveryLoopSummary();
    for (;;) {
      if (this.#state.stopped) {
        return summary.result("STOPPED");
      }
      const run = await this.#drain();
      summary.add(run);
      if (run.status === "SKIPPED") {
        return summary.result("SKIPPED");
      }
      if (summary.failed >= this.#maxFailures && run.failed > 0) {
        return summary.result("FAILED");
      }
      if (run.processed === 0) {
        return summary.result("IDLE");
      }
    }
  }

  #drain(): Promise<DeliveryRun> {
    return this.#delivery.drain(this.#shard, {
      node: this.#node,
      onMessage: this.#onMessage,
      ...(this.#limit === undefined ? {} : { limit: this.#limit }),
    });
  }
}

/** Delivery loop construction options. */
export interface DeliveryLoopOptions {
  /** Delivery owner whose `drain()` method provides the durable worker boundary. */
  readonly delivery: Delivery;
  /** Shard to drain repeatedly. */
  readonly shard: ShardIndex;
  /** Worker node name used for shard pickup. */
  readonly node: string;
  /** Optional positive safe integer page size for each underlying drain. */
  readonly limit?: number;
  /** Maximum failed message attempts before the loop stops. Defaults to one. */
  readonly maxFailures?: number;
  /** Framework endpoint callback invoked once per pending inbox row. */
  readonly onMessage: DeliveryEndpoint;
}

/** Delivery loop stop reason. */
export type DeliveryLoopStatus = "IDLE" | "SKIPPED" | "STOPPED" | "FAILED";

/** Aggregate statistics for one delivery loop run. */
export interface DeliveryLoopRun {
  /** Why the loop stopped. */
  readonly status: DeliveryLoopStatus;
  /** Number of `Delivery.drain()` calls started by this loop run. */
  readonly runs: number;
  /** Number of pending rows read across all drains. */
  readonly processed: number;
  /** Number of rows delivered across all drains. */
  readonly delivered: number;
  /** Number of endpoint or delivery-marking failures across all drains. */
  readonly failed: number;
  /** Per-message failures retained only in the returned run result. */
  readonly failures: readonly DeliveryFailure[];
}

class DeliveryLoopSummary {
  #runs = 0;
  #processed = 0;
  #delivered = 0;
  #failed = 0;
  readonly #failures: DeliveryFailure[] = [];

  get failed(): number {
    return this.#failed;
  }

  add(run: DeliveryRun): void {
    this.#runs += 1;
    this.#processed += run.processed;
    this.#delivered += run.delivered;
    this.#failed += run.failed;
    this.#failures.push(...run.failures);
  }

  result(status: DeliveryLoopStatus): DeliveryLoopRun {
    return loopRun(
      status,
      this.#runs,
      this.#processed,
      this.#delivered,
      this.#failed,
      this.#failures,
    );
  }
}

function loopRun(
  status: DeliveryLoopStatus,
  runs = 0,
  processed = 0,
  delivered = 0,
  failed = 0,
  failures: readonly DeliveryFailure[] = [],
): DeliveryLoopRun {
  return Object.freeze({
    status,
    runs,
    processed,
    delivered,
    failed,
    failures: Object.freeze([...failures]),
  });
}

function requirePositiveSafeInteger(name: "limit" | "maxFailures", value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`DeliveryLoop ${name} must be a positive safe integer.`);
  }
  return value;
}
