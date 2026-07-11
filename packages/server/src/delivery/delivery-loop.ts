import { inboxStorageAccess } from "./inbox-storage.js";
import {
  deliveryAccess,
  type Delivery,
  type DeliveryDrainOutcome,
  type DeliveryFailure,
  type DeliveryRun,
  type OnDeliveryMessage,
} from "./delivery.js";
import type { ShardIndex } from "./shard-index.js";

/** Small local repeat loop around the direct `Delivery.drain()` worker boundary. */
export class DeliveryLoop {
  readonly #delivery: Delivery;
  readonly #shard: ShardIndex;
  readonly #node: string;
  readonly #limit: number | undefined;
  readonly #maxFailures: number;
  readonly #onMessage: OnDeliveryMessage;
  #resume: DeliveryResumeCursor | undefined;
  readonly #state = { stopped: false };
  #running: Promise<DeliveryLoopRun> | undefined;

  /** Configure a loop for one shard and node. */
  constructor(options: DeliveryLoopOptions) {
    this.#delivery = options.delivery;
    this.#shard = options.shard;
    this.#node = options.node;
    this.#limit =
      options.limit === undefined ? undefined : requirePositiveSafeInteger("limit", options.limit);
    this.#maxFailures = requireBoundedInteger(
      "maxFailures",
      options.maxFailures ?? 1,
      maxDeliveryLoopFailures,
    );
    this.#onMessage = options.onMessage;
    Object.freeze(this);
  }

  /**
   * Run drains until idle, skipped, stopped, paused after a bounded skipped-only scan streak,
   * or the failure bound is reached, including a failed exhaustion-time mark.
   */
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
    this.#requireStorageBoundedLimit();
    const summary = new DeliveryLoopSummary();
    let resumableScanRuns = 0;
    for (;;) {
      if (this.#state.stopped) {
        this.#resume = undefined;
        return summary.result("STOPPED");
      }
      const remainingFailures = this.#maxFailures - summary.failed;
      const limit = this.#drainLimit();
      const outcome = await this.#drain(limit, remainingFailures);
      const { run } = outcome;
      this.#resume = outcome.resumeCursor;
      summary.add(run);
      if (run.status === "SKIPPED") {
        this.#resume = undefined;
        return summary.result("SKIPPED");
      }
      if (summary.failed >= this.#maxFailures && run.failed > 0) {
        this.#resume = undefined;
        return summary.result("FAILED");
      }
      if (run.accepted === 0 && run.delivered === 0 && run.failed === 0) {
        if (outcome.exhaustedSkippedScan) {
          resumableScanRuns += 1;
          if (resumableScanRuns >= maxResumableScanRuns) {
            this.#resume = undefined;
            return summary.result("PAUSED");
          }
          continue;
        }
        resumableScanRuns = 0;
        this.#resume = undefined;
        return summary.result("IDLE");
      }
      resumableScanRuns = 0;
    }
  }

  #drain(limit: number, remainingFailures: number): Promise<DeliveryDrainOutcome> {
    return deliveryAccess.drain(
      this.#delivery,
      this.#shard,
      {
        node: this.#node,
        onMessage: this.#onMessage,
        limit,
      },
      {
        maxFailures: remainingFailures,
        ...(this.#resume === undefined ? {} : { resume: this.#resume }),
      },
    );
  }

  #drainLimit(): number {
    return this.#limit ?? inboxStorageAccess.readLimit(undefined);
  }

  #requireStorageBoundedLimit(): void {
    if (this.#limit !== undefined && this.#limit > inboxStorageAccess.maxReadLimit) {
      throw new Error(
        `Inbox read limit must be a positive safe integer at most ${String(inboxStorageAccess.maxReadLimit)}.`,
      );
    }
  }
}

const maxDeliveryLoopFailures = 1_000;
const maxResumableScanRuns = 2;
type DeliveryResumeCursor = DeliveryDrainOutcome["resumeCursor"];

/** Delivery loop construction options. */
export interface DeliveryLoopOptions {
  /** Delivery owner whose `drain()` method provides the durable worker boundary. */
  readonly delivery: Delivery;
  /** Shard to drain repeatedly. */
  readonly shard: ShardIndex;
  /** Worker node name used for shard pickup. */
  readonly node: string;
  /** Optional positive accepted-work cap for each drain. */
  readonly limit?: number;
  /**
   * Maximum failed observations before the loop stops, including a failed
   * exhaustion-time mark. Defaults to one; capped at 1000.
   */
  readonly maxFailures?: number;
  /** Framework endpoint callback invoked for each available supported worker row. */
  readonly onMessage: OnDeliveryMessage;
}

/** Delivery loop stop reason. */
export type DeliveryLoopStatus = "IDLE" | "SKIPPED" | "STOPPED" | "FAILED" | "PAUSED";

/** Aggregate statistics for one delivery loop run. */
export interface DeliveryLoopRun {
  /** Why the loop stopped. */
  readonly status: DeliveryLoopStatus;
  /** Number of `Delivery.drain()` calls started by this loop run. */
  readonly runs: number;
  /** Number of pending rows read across all drains. */
  readonly processed: number;
  /** Number of rows accepted for endpoint work across all drains. */
  readonly accepted: number;
  /** Number of rows delivered across all drains. Unsupported labels are skipped pending. */
  readonly delivered: number;
  /**
   * Number of observed endpoint, lease/fencing, status-update, cleanup, or
   * failed exhaustion-time mark observations.
   */
  readonly failed: number;
  /** Per-message failure observations retained only in the returned run result. */
  readonly failures: readonly DeliveryFailure[];
}

class DeliveryLoopSummary {
  #runs = 0;
  #processed = 0;
  #accepted = 0;
  #delivered = 0;
  #failed = 0;
  readonly #failures: DeliveryFailure[] = [];

  get failed(): number {
    return this.#failed;
  }

  add(run: DeliveryRun): void {
    this.#runs += 1;
    this.#processed += run.processed;
    this.#accepted += run.accepted;
    this.#delivered += run.delivered;
    this.#failed += run.failed;
    this.#failures.push(...run.failures);
  }

  result(status: DeliveryLoopStatus): DeliveryLoopRun {
    return loopRun(
      status,
      this.#runs,
      this.#processed,
      this.#accepted,
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
  accepted = 0,
  delivered = 0,
  failed = 0,
  failures: readonly DeliveryFailure[] = [],
): DeliveryLoopRun {
  return Object.freeze({
    status,
    runs,
    processed,
    accepted,
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

function requireBoundedInteger(name: "limit" | "maxFailures", value: number, max: number): number {
  requirePositiveSafeInteger(name, value);
  if (value > max) {
    throw new Error(`DeliveryLoop ${name} must be a positive safe integer at most ${String(max)}.`);
  }
  return value;
}
