import {
  deliveryControls,
  type Delivery,
  type DeliveryResult,
  type DeliveryRunOptions,
} from "./delivery-builder.js";
import type { ShardIndex } from "./shard-index.js";

/**
 * Controls admission for one finite delivery run.
 */
export class DeliveryRunControl {
  readonly #runControlled: (options: DeliveryControlledRun) => Promise<DeliveryResult>;

  /**
   * Creates controlled admission for a builder-created delivery.
   *
   * @param delivery The builder-created delivery to control.
   */
  constructor(delivery: Delivery) {
    const runControlled = deliveryControls.runner(delivery);
    if (runControlled === undefined) {
      throw new TypeError("DeliverySupervisor requires a Delivery built by DeliveryBuilder.");
    }
    this.#runControlled = runControlled;
  }

  /**
   * Executes one controlled delivery until it settles or its signal aborts.
   *
   * @param options The finite shard run and its cancellation signal.
   * @returns The delivery result, or an abort error.
   */
  run(options: DeliveryControlledRun): Promise<DeliveryResult> {
    if (options.signal.aborted) return Promise.reject(this.#abortError(options.signal));
    const settled = this.#runControlled(options);
    const aborted = this.#abortPromise(options.signal);
    void settled.catch(() => undefined);
    void aborted.catch(() => undefined);
    return Promise.race([settled, aborted]).finally(() => {
      options.signal.removeEventListener("abort", aborted.abort);
    });
  }

  #abortPromise(signal: AbortSignal): Promise<never> & { abort: () => void } {
    const gate = Promise.withResolvers<never>();
    const abort = () => {
      gate.reject(this.#abortError(signal));
    };
    signal.addEventListener("abort", abort, { once: true });
    return Object.assign(gate.promise, { abort });
  }

  #abortError(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : new Error("Delivery run was aborted.");
  }
}

/**
 * Describes one controlled finite delivery request.
 */
export interface DeliveryControlledRun extends DeliveryRunOptions {
  // prettier-ignore

  /**
   * Identifies the shard to drain.
   */
  readonly shard: ShardIndex;

  /**
   * Cancels the controlled run.
   */
  readonly signal: AbortSignal;
}
