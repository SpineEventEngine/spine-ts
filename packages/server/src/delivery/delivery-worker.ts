import { DeliveryLoop, type DeliveryLoopRun, type DeliveryLoopStatus } from "./delivery-loop.js";
import type { Delivery, OnDeliveryMessage } from "./delivery.js";
import type { ShardIndex } from "./shard-index.js";

/**
 * Framework-owned local/direct wrapper over one node's configured shard loops.
 *
 * DeliveryWorker starts and closes caller-configured DeliveryLoop instances. It
 * does not own production supervision, retry policy, or transport topology.
 */
export class DeliveryWorker {
  readonly #loops: readonly DeliveryLoop[];
  #running: Promise<DeliveryWorkerRun> | undefined;

  /** Configure worker loops for one node over known delivery shards. */
  constructor(options: DeliveryWorkerOptions) {
    const shards = requireShards(options.shards);

    this.#loops = Object.freeze(
      shards.map(
        (shard) =>
          new DeliveryLoop({
            delivery: options.delivery,
            shard,
            node: options.node,
            onMessage: options.onMessage,
            ...(options.limit === undefined ? {} : { limit: options.limit }),
            ...(options.maxFailures === undefined ? {} : { maxFailures: options.maxFailures }),
          }),
      ),
    );
    Object.freeze(this);
  }

  /** Start all configured loops and resolve when they stop. */
  start(): Promise<DeliveryWorkerRun> {
    if (this.#running !== undefined) {
      throw new Error("DeliveryWorker is already running.");
    }

    const running = settleWorkerRun(this.#loops.map((loop) => loop.run())).finally(() => {
      this.#running = undefined;
    });
    this.#running = running;
    return running;
  }

  /** Prevent future drain starts without interrupting current drains. */
  stop(): void {
    for (const loop of this.#loops) {
      loop.stop();
    }
  }

  /** Call `stop()` and wait for active loops, if any, to finish. */
  async close(): Promise<void> {
    this.stop();
    await this.#running;
  }
}

/** Delivery worker construction options. */
export interface DeliveryWorkerOptions {
  /** Delivery owner drained by this worker. */
  readonly delivery: Delivery;
  /** Non-empty list of shards this worker drains for its node. */
  readonly shards: readonly ShardIndex[];
  /** Worker node name used for shard pickup. */
  readonly node: string;
  /** Optional positive accepted-work cap for each drain. */
  readonly limit?: number;
  /** Maximum failed message attempts per loop before that loop stops. Defaults to one; capped at 1000. */
  readonly maxFailures?: number;
  /** Framework endpoint callback invoked for each available supported worker row. */
  readonly onMessage: OnDeliveryMessage;
}

/** Aggregate result from one delivery worker run. */
export interface DeliveryWorkerRun {
  /** Highest-priority stop reason across configured loops. */
  readonly status: DeliveryLoopStatus;
  /** Per-shard loop results in configured shard order. */
  readonly loops: readonly DeliveryLoopRun[];
}

/** @internal Worker-result helpers for package-local tests and runtime code. */
export interface DeliveryWorkerAccess {
  status(loops: readonly DeliveryLoopRun[]): DeliveryLoopStatus;
}

function requireShards(shards: readonly ShardIndex[]): readonly ShardIndex[] {
  if (!Array.isArray(shards) || shards.length === 0) {
    throw new Error("DeliveryWorker shards must be a non-empty array.");
  }

  return Object.freeze([...shards]);
}

function workerRun(loops: readonly DeliveryLoopRun[]): DeliveryWorkerRun {
  return Object.freeze({
    status: workerStatus(loops),
    loops: Object.freeze([...loops]),
  });
}

/** @internal Worker-result helpers for package-local tests and runtime code. */
export const deliveryWorkerAccess: DeliveryWorkerAccess = Object.freeze({
  status(loops: readonly DeliveryLoopRun[]) {
    return workerStatus(loops);
  },
});

async function settleWorkerRun(
  loopRuns: readonly Promise<DeliveryLoopRun>[],
): Promise<DeliveryWorkerRun> {
  const settled = await Promise.allSettled(loopRuns);
  const loops: DeliveryLoopRun[] = [];
  const failures: unknown[] = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      loops.push(result.value);
    } else {
      failures.push(result.reason);
    }
  }

  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, "DeliveryWorker loops failed.");
  }

  return workerRun(loops);
}

function workerStatus(loops: readonly DeliveryLoopRun[]): DeliveryLoopStatus {
  if (loops.some(({ status }) => status === "FAILED")) {
    return "FAILED";
  }
  if (loops.some(({ status }) => status === "STOPPED")) {
    return "STOPPED";
  }
  if (loops.some(({ status }) => status === "PAUSED")) {
    return "PAUSED";
  }
  if (loops.some(({ status }) => status === "SKIPPED")) {
    return "SKIPPED";
  }

  return "IDLE";
}
