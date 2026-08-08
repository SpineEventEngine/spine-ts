import type { Delivery, DeliveryRun, OnDeliveryMessage } from "./delivery.js";
import type { DeliveryOperationOptions } from "./delivery-ports.js";
import type { ShardIndex } from "./shard-index.js";

/** A small finite compatibility wrapper over one direct delivery drain. */
export class DeliveryLoop {
  readonly #options: DeliveryLoopOptions;
  #stopped = false;
  #progress: DeliveryLoopProgress = empty();

  constructor(options: DeliveryLoopOptions) { this.#options = options; }
  stop(): void { this.#stopped = true; }
  async close(): Promise<void> { this.stop(); }
  async run(): Promise<DeliveryLoopRun> {
    if (this.#stopped) return this.#finish("STOPPED", empty());
    const run = await this.#options.delivery.drain(this.#options.shard, {
      onMessage: this.#options.onMessage,
      ...(this.#options.operation === undefined ? {} : { operation: this.#options.operation }),
    });
    return this.#finish(map(run.status), run);
  }
  progress(): DeliveryLoopProgress { return this.#progress; }
  #finish(status: DeliveryLoopStatus, run: DeliveryRun | DeliveryLoopProgress): DeliveryLoopRun {
    this.#progress = Object.freeze({ runs: 1, processed: run.processed, accepted: run.accepted, delivered: run.delivered, failed: run.failed, failures: run.failures });
    return Object.freeze({ status, ...this.#progress });
  }
}
export interface DeliveryLoopOptions { readonly delivery: Delivery; readonly shard: ShardIndex; readonly node?: string; readonly limit?: number; readonly maxFailures?: number; readonly onMessage: OnDeliveryMessage; readonly operation?: DeliveryOperationOptions; readonly onStarted?: () => void; readonly completeAdmittedEmptyEpoch?: boolean; }
export type DeliveryLoopStatus = "IDLE" | "SKIPPED" | "STOPPED" | "FAILED" | "PAUSED";
export interface DeliveryLoopRun extends DeliveryLoopProgress { readonly status: DeliveryLoopStatus; }
export interface DeliveryLoopProgress { readonly runs: number; readonly processed: number; readonly accepted: number; readonly delivered: number; readonly failed: number; readonly failures: readonly import("./delivery.js").DeliveryFailure[]; }
export const deliveryLoopAccess: Readonly<{
  progress(loop: DeliveryLoop): DeliveryLoopProgress;
}> = Object.freeze({ progress(loop: DeliveryLoop): DeliveryLoopProgress { return loop.progress(); } });
function empty(): DeliveryLoopProgress { return Object.freeze({ runs: 0, processed: 0, accepted: 0, delivered: 0, failed: 0, failures: Object.freeze([]) }); }
function map(status: DeliveryRun["status"]): DeliveryLoopStatus { return status === "DRAINED" ? "IDLE" : status; }
