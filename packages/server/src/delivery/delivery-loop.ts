import type { Delivery, DeliveryRun, OnDeliveryMessage } from "./delivery.js";
import type { DeliveryOperationOptions } from "./delivery-ports.js";
import type { ShardIndex } from "./shard-index.js";

/**
 * Runs one finite direct delivery drain at a time.
 */
export class DeliveryLoop {
  readonly #options: DeliveryLoopOptions;
  #stopped = false;
  #progress: DeliveryLoopProgress = empty();
  #running: Promise<DeliveryLoopRun> | undefined;

  /**
   * Creates a loop for one selected shard.
   *
   * @param options The immutable drain configuration.
   */
  constructor(options: DeliveryLoopOptions) {
    this.#options = options;
  }

  /**
   * Stops admission of later loop runs.
   */
  stop(): void {
    this.#stopped = true;
  }

  /**
   * Stops the loop and waits for its active drain to settle.
   *
   * @returns A promise that settles after the active drain, if any.
   */
  async close(): Promise<void> {
    this.stop();
    await this.#running;
  }

  /**
   * Executes one finite direct delivery drain.
   *
   * @returns The terminal loop result.
   */
  run(): Promise<DeliveryLoopRun> {
    if (this.#running !== undefined)
      return Promise.reject(new Error("DeliveryLoop is already running."));
    if (this.#stopped) return Promise.resolve(this.#stoppedRun());
    const running = this.#options.delivery
      .drain(this.#options.shard, {
        onMessage: this.#options.onMessage,
        ...(this.#options.operation === undefined ? {} : { operation: this.#options.operation }),
      })
      .then((run) => this.#finish(map(run.status), run))
      .finally(() => {
        this.#running = undefined;
      });
    this.#running = running;
    return running;
  }

  /**
   * Returns the latest immutable loop progress.
   *
   * @returns The latest terminal progress.
   */
  progress(): DeliveryLoopProgress {
    return this.#progress;
  }

  #finish(status: DeliveryLoopStatus, run: DeliveryRun | DeliveryLoopProgress): DeliveryLoopRun {
    this.#progress = Object.freeze({
      runs: 1,
      processed: run.processed,
      accepted: run.accepted,
      delivered: run.delivered,
      failed: run.failed,
      failures: run.failures,
    });
    return Object.freeze({ status, ...this.#progress });
  }

  #stoppedRun(): DeliveryLoopRun {
    return Object.freeze({ status: "STOPPED", ...this.#progress });
  }
}

/**
 * Configures one finite direct delivery loop.
 */
export interface DeliveryLoopOptions {
  // prettier-ignore

  /**
   * Supplies the direct delivery runtime.
   */
  readonly delivery: Delivery;

  /**
   * Selects the shard to drain.
   */
  readonly shard: ShardIndex;

  /**
   * Dispatches one supported Inbox message.
   */
  readonly onMessage: OnDeliveryMessage;

  /**
   * Propagates cancellation and deadline information.
   */
  readonly operation?: DeliveryOperationOptions;
}

/**
 * Identifies the terminal state of a finite loop.
 */
export type DeliveryLoopStatus = "IDLE" | "SKIPPED" | "STOPPED" | "FAILED";

/**
 * Combines loop progress with its terminal state.
 */
export interface DeliveryLoopRun extends DeliveryLoopProgress {
  // prettier-ignore

  /**
   * Identifies why the loop ended.
   */
  readonly status: DeliveryLoopStatus;
}

/**
 * Counts work observed by one finite loop.
 */
export interface DeliveryLoopProgress {
  // prettier-ignore

  /**
   * Counts finite drains started by the loop.
   */
  readonly runs: number;

  /**
   * Counts messages considered for dispatch.
   */
  readonly processed: number;

  /**
   * Counts messages whose endpoint callback ran.
   */
  readonly accepted: number;

  /**
   * Counts messages acknowledged as delivered.
   */
  readonly delivered: number;

  /**
   * Counts dispatch or acknowledgement failures.
   */
  readonly failed: number;

  /**
   * Lists retained ephemeral failure facts.
   */
  readonly failures: readonly import("./delivery.js").DeliveryFailure[];
}

/**
 * Exposes package-local loop progress for retained integrations.
 */
export const deliveryLoopAccess: Readonly<{
  // prettier-ignore

  /**
   * Returns the current progress for one loop.
   *
   * @param loop The loop to inspect.
   * @returns The loop's immutable progress.
   */
  progress(loop: DeliveryLoop): DeliveryLoopProgress;
}> = Object.freeze({
  progress(loop: DeliveryLoop): DeliveryLoopProgress {
    return loop.progress();
  },
});

function empty(): DeliveryLoopProgress {
  return Object.freeze({
    runs: 0,
    processed: 0,
    accepted: 0,
    delivered: 0,
    failed: 0,
    failures: Object.freeze([]),
  });
}

function map(status: DeliveryRun["status"]): DeliveryLoopStatus {
  return status === "DRAINED" ? "IDLE" : status;
}
