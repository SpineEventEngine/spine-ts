import {
  controlledDeliveryRunner,
  type Delivery,
  type DeliveryResult,
  type DeliveryRunOptions,
} from "./delivery-builder.js";
import type { ShardIndex } from "./shard-index.js";

/** @internal Controlled admission for one finite delivery run. */
export class DeliveryRunControl {
  readonly #runControlled: (options: DeliveryControlledRun) => Promise<DeliveryResult>;

  constructor(delivery: Delivery) {
    const runControlled = controlledDeliveryRunner(delivery);
    if (runControlled === undefined) {
      throw new TypeError("DeliverySupervisor requires a Delivery built by DeliveryBuilder.");
    }
    this.#runControlled = runControlled;
  }

  run(options: DeliveryControlledRun): Promise<DeliveryResult> {
    if (options.signal.aborted) return Promise.reject(abortError(options.signal));
    const settled = this.#runControlled(options);
    const aborted = abortPromise(options.signal);
    void settled.catch(() => undefined);
    void aborted.catch(() => undefined);
    return Promise.race([settled, aborted]).finally(() => {
      options.signal.removeEventListener("abort", aborted.abort);
    });
  }
}

/** @internal One controlled finite delivery request. */
export interface DeliveryControlledRun extends DeliveryRunOptions {
  readonly shard: ShardIndex;
  readonly signal: AbortSignal;
}

function abortPromise(signal: AbortSignal): Promise<never> & { abort: () => void } {
  const gate = Promise.withResolvers<never>();
  const abort = () => {
    gate.reject(abortError(signal));
  };
  signal.addEventListener("abort", abort, { once: true });
  return Object.assign(gate.promise, { abort });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Delivery run was aborted.");
}
