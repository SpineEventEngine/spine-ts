import type { Delivery, DeliveryRun, OnDeliveryMessage } from "./delivery.js";
import type { DeliveryOperationOptions } from "./delivery-ports.js";
import type { ShardIndex } from "./shard-index.js";

/** A small finite compatibility wrapper over one direct delivery drain. */
export class DeliveryLoop {
  readonly #options: DeliveryLoopOptions;
  #stopped = false;
  #progress: DeliveryLoopProgress = empty();
  #running: Promise<DeliveryLoopRun> | undefined;

  constructor(options: DeliveryLoopOptions) {
    this.#options = options;
  }
  stop(): void {
    this.#stopped = true;
  }
  async close(): Promise<void> {
    this.stop();
    await this.#running;
  }
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
export interface DeliveryLoopOptions {
  readonly delivery: Delivery;
  readonly shard: ShardIndex;
  readonly node?: string;
  readonly limit?: number;
  readonly maxFailures?: number;
  readonly onMessage: OnDeliveryMessage;
  readonly operation?: DeliveryOperationOptions;
  readonly onStarted?: () => void;
  readonly completeAdmittedEmptyEpoch?: boolean;
}
export type DeliveryLoopStatus = "IDLE" | "SKIPPED" | "STOPPED" | "FAILED" | "PAUSED";
export interface DeliveryLoopRun extends DeliveryLoopProgress {
  readonly status: DeliveryLoopStatus;
}
export interface DeliveryLoopProgress {
  readonly runs: number;
  readonly processed: number;
  readonly accepted: number;
  readonly delivered: number;
  readonly failed: number;
  readonly failures: readonly import("./delivery.js").DeliveryFailure[];
}
export const deliveryLoopAccess: Readonly<{
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
