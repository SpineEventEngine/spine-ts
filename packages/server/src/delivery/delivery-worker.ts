import {
  DeliveryLoop,
  deliveryLoopAccess,
  type DeliveryLoopProgress,
  type DeliveryLoopRun,
  type DeliveryLoopStatus,
} from "./delivery-loop.js";
import type { Delivery, OnDeliveryMessage } from "./delivery.js";
import type { ShardIndex } from "./shard-index.js";

/**
 * Framework-owned local/direct wrapper over one node's configured shard loops.
 *
 * DeliveryWorker starts and closes caller-configured DeliveryLoop instances. It
 * does not own production supervision, retry policy, or transport topology.
 */
export class DeliveryWorker {
  readonly #shards: readonly ShardIndex[];
  readonly #loops: readonly DeliveryLoop[];
  readonly #states: DeliveryShardState[];
  #obligation: DeliveryWorkerObligation | undefined;
  #running: Promise<unknown> | undefined;
  #stopped = false;
  #retired = false;

  /**
   * Creates worker loops for one node over known delivery shards.
   *
   * @param options The worker configuration.
   */
  constructor(options: DeliveryWorkerOptions) {
    const shards = DeliveryWorkerValues.requireShards(options.shards);
    this.#shards = shards;

    this.#loops = Object.freeze(
      shards.map(
        (shard) =>
          new DeliveryLoop({
            delivery: options.delivery,
            shard,
            onMessage: options.onMessage,
          }),
      ),
    );
    this.#states = shards.map(() => "READY");
    deliveryWorkerInternals.set(this, {
      start: (obligation, shards) => this.#startInternal(obligation, shards),
      awaitSettled: () => this.#awaitSettled(),
      retire: () => this.#retire(),
    });
    Object.freeze(this);
  }

  /**
   * Starts all configured loops and resolves when they stop.
   *
   * @returns The aggregate worker result.
   */
  start(): Promise<DeliveryWorkerRun> {
    this.#requireNotRetired();
    if (this.#running !== undefined) {
      throw new Error("DeliveryWorker is already running.");
    }

    const obligation = Object.freeze({});
    this.#obligation = obligation;
    this.#states.fill("READY");
    const running = DeliveryWorkerValues.compatibilityRun(
      this.#settle(this.#allEntries(), obligation),
    ).finally(() => {
      this.#running = undefined;
    });
    this.#running = running;
    return running;
  }

  /**
   * Stops future drain starts without interrupting current drains.
   */
  stop(): void {
    this.#stopped = true;
    for (const loop of this.#loops) {
      loop.stop();
    }
  }

  /**
   * Closes active loops after they finish.
   *
   * @returns A promise that settles after the worker closes.
   */
  async close(): Promise<void> {
    this.stop();
    await this.#running;
  }

  #startInternal(
    obligation: DeliveryWorkerObligation,
    shards?: readonly ShardIndex[],
  ): Promise<DeliveryWorkerEvidence> {
    this.#requireNotRetired();
    if (this.#running !== undefined) {
      throw new Error("DeliveryWorker is already running.");
    }
    if (this.#obligation !== obligation) {
      this.#obligation = obligation;
      this.#states.fill("READY");
    }

    const selected = shards === undefined ? undefined : new Set(shards.map((shard) => shard.key()));
    const entries = this.#allEntries().filter(({ index, shard }) => {
      const state = this.#states[index];
      const eligible = state === "READY" || state === "REJECTED";
      return eligible && (selected === undefined || selected.has(shard.key()));
    });
    const running = this.#settle(entries, obligation).finally(() => {
      this.#running = undefined;
    });
    this.#running = running;
    return running;
  }

  #awaitSettled(): Promise<void> {
    const running = this.#running;
    return running === undefined
      ? Promise.resolve()
      : running.then(
          () => undefined,
          () => undefined,
        );
  }

  #retire(): Promise<void> {
    if (!this.#stopped) {
      return Promise.reject(new Error("DeliveryWorker must be stopped before retirement."));
    }
    this.#retired = true;
    return this.#awaitSettled();
  }

  #requireNotRetired(): void {
    if (this.#retired) {
      throw new Error("DeliveryWorker is permanently retired.");
    }
  }

  async #settle(
    entries: readonly DeliveryShardEntry[],
    obligation: DeliveryWorkerObligation,
  ): Promise<DeliveryWorkerEvidence> {
    const settled = await Promise.allSettled(entries.map(({ loop }) => loop.run()));
    const shards = settled.map((result, offset): DeliveryShardEvidence => {
      const entry = entries[offset];
      if (entry === undefined) {
        throw new Error("DeliveryWorker shard settlement is invalid.");
      }
      const progress = deliveryLoopAccess.progress(entry.loop);
      if (result.status === "rejected") {
        this.#states[entry.index] = "REJECTED";
        return DeliveryWorkerValues.rejected(entry.shard, obligation, result.reason, progress);
      }

      this.#states[entry.index] = DeliveryWorkerValues.state(result.value.status);
      return DeliveryWorkerValues.fulfilled(entry.shard, obligation, result.value, progress);
    });

    return Object.freeze({ obligation, shards: Object.freeze(shards) });
  }

  #allEntries(): readonly DeliveryShardEntry[] {
    return this.#loops.map((loop, index) => {
      const shard = this.#shards[index];
      if (shard === undefined) {
        throw new Error("DeliveryWorker shard configuration is invalid.");
      }
      return { index, shard, loop };
    });
  }
}

/**
 * Delivery worker construction options.
 */
export interface DeliveryWorkerOptions {
  // prettier-ignore

  /**
   * Delivery owner drained by this worker.
   */
  readonly delivery: Delivery;

  /**
   * Non-empty list of shards this worker drains for its node.
   */
  readonly shards: readonly ShardIndex[];

  /**
   * Framework endpoint callback invoked for each available supported worker row.
   */
  readonly onMessage: OnDeliveryMessage;
}

/**
 * Aggregate result from one delivery worker run.
 */
export interface DeliveryWorkerRun {
  // prettier-ignore

  /**
   * Highest-priority stop reason across configured loops.
   */
  readonly status: DeliveryLoopStatus;

  /**
   * Per-shard loop results in configured shard order.
   */
  readonly loops: readonly DeliveryLoopRun[];
}

/**
 * Identifies one package-owned request to run configured delivery shards.
 */
export type DeliveryWorkerObligation = object;

/**
 * Describes ordered fulfilled and rejected evidence for one worker invocation.
 */
export interface DeliveryWorkerEvidence {
  // prettier-ignore

  /**
   * Holds the exact worker obligation.
   */
  readonly obligation: DeliveryWorkerObligation;

  /**
   * Lists per-shard evidence in configured order.
   */
  readonly shards: readonly DeliveryShardEvidence[];
}

/**
 * Names evidence for one configured shard.
 */
export type DeliveryShardEvidence = FulfilledDeliveryShard | RejectedDeliveryShard;

/**
 * Describes fulfilled loop evidence for a shard and obligation.
 */
export interface FulfilledDeliveryShard {
  // prettier-ignore

  /**
   * States that the loop fulfilled.
   */
  readonly status: "fulfilled";

  /**
   * Identifies the shard.
   */
  readonly shard: ShardIndex;

  /**
   * Holds the worker obligation.
   */
  readonly obligation: DeliveryWorkerObligation;

  /**
   * Holds the loop result.
   */
  readonly run: DeliveryLoopRun;

  /**
   * Holds the final safe progress.
   */
  readonly progress: DeliveryLoopProgress;
}

/**
 * Describes rejected loop evidence and its last safe progress.
 */
export interface RejectedDeliveryShard {
  // prettier-ignore

  /**
   * States that the loop rejected.
   */
  readonly status: "rejected";

  /**
   * Identifies the shard.
   */
  readonly shard: ShardIndex;

  /**
   * Holds the worker obligation.
   */
  readonly obligation: DeliveryWorkerObligation;

  /**
   * Holds the rejection cause.
   */
  readonly cause: unknown;

  /**
   * Holds the final safe progress.
   */
  readonly progress: DeliveryLoopProgress;
}

/**
 * Provides package-internal worker coordination and lifecycle access.
 */
export interface DeliveryWorkerAccess {
  // prettier-ignore

  /**
   * Determines aggregate compatibility status from fulfilled loop results.
   *
   * @param loops The fulfilled loop results.
   * @returns The aggregate loop status.
   */
  status(loops: readonly DeliveryLoopRun[]): DeliveryLoopStatus;

  /**
   * Starts eligible configured shards for one finite obligation.
   *
   * @param worker The worker to start.
   * @param obligation The worker obligation.
   * @param shards Optional shard subset.
   * @returns The worker evidence.
   */
  start(
    worker: DeliveryWorker,
    obligation: DeliveryWorkerObligation,
    shards?: readonly ShardIndex[],
  ): Promise<DeliveryWorkerEvidence>;

  /**
   * Awaits the current active start without interrupting it.
   *
   * @param worker The worker to inspect.
   * @returns A promise that resolves after the worker's active run settles.
   */
  awaitSettled(worker: DeliveryWorker): Promise<void>;

  /**
   * Closes a stopped worker permanently after active work settles.
   *
   * @param worker The worker to retire.
   *
   * Requires a successful prior `stop()`, then permanently closes public and
   * internal starts and awaits active settlement. Prior active rejection is
   * treated as settled; no fallible resource cleanup follows closure.
   *
   * @returns A promise that settles after the worker retires.
   */
  retire(worker: DeliveryWorker): Promise<void>;
}

interface DeliveryWorkerInternals {
  readonly start: (
    obligation: DeliveryWorkerObligation,
    shards?: readonly ShardIndex[],
  ) => Promise<DeliveryWorkerEvidence>;
  readonly awaitSettled: () => Promise<void>;
  readonly retire: () => Promise<void>;
}

interface DeliveryShardEntry {
  readonly index: number;
  readonly shard: ShardIndex;
  readonly loop: DeliveryLoop;
}

type DeliveryShardState = "READY" | "REJECTED" | "PARKED" | "COMPLETE" | "STOPPED";

const deliveryWorkerInternals = new WeakMap<DeliveryWorker, DeliveryWorkerInternals>();

/**
 * Provides package-internal worker coordination and lifecycle access.
 */
export const deliveryWorkerAccess: DeliveryWorkerAccess = Object.freeze({
  status(loops: readonly DeliveryLoopRun[]) {
    return DeliveryWorkerValues.status(loops);
  },
  start(
    worker: DeliveryWorker,
    obligation: DeliveryWorkerObligation,
    shards?: readonly ShardIndex[],
  ) {
    return DeliveryWorkerValues.requireInternals(worker).start(obligation, shards);
  },
  awaitSettled(worker: DeliveryWorker) {
    return DeliveryWorkerValues.requireInternals(worker).awaitSettled();
  },
  retire(worker: DeliveryWorker) {
    return DeliveryWorkerValues.requireInternals(worker).retire();
  },
});

/**
 * Groups internal worker validation, evidence, and compatibility operations.
 */
const DeliveryWorkerValues = Object.freeze({
  requireShards(shards: readonly ShardIndex[]): readonly ShardIndex[] {
    if (!Array.isArray(shards) || shards.length === 0) {
      throw new Error("DeliveryWorker shards must be a non-empty array.");
    }
    return Object.freeze(Array.from<ShardIndex>(shards));
  },
  run(loops: readonly DeliveryLoopRun[]): DeliveryWorkerRun {
    return Object.freeze({ status: this.status(loops), loops: Object.freeze([...loops]) });
  },
  requireInternals(worker: DeliveryWorker): DeliveryWorkerInternals {
    const internals = deliveryWorkerInternals.get(worker);
    if (internals === undefined)
      throw new Error("Delivery worker access requires a DeliveryWorker instance.");
    return internals;
  },
  async compatibilityRun(evidence: Promise<DeliveryWorkerEvidence>): Promise<DeliveryWorkerRun> {
    const loops: DeliveryLoopRun[] = [];
    const failures: unknown[] = [];
    for (const result of (await evidence).shards) {
      if (result.status === "fulfilled") loops.push(result.run);
      else failures.push(result.cause);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "DeliveryWorker loops failed.");
    return this.run(loops);
  },
  fulfilled(
    shard: ShardIndex,
    obligation: DeliveryWorkerObligation,
    run: DeliveryLoopRun,
    progress: DeliveryLoopProgress,
  ): FulfilledDeliveryShard {
    return Object.freeze({ status: "fulfilled", shard, obligation, run, progress });
  },
  rejected(
    shard: ShardIndex,
    obligation: DeliveryWorkerObligation,
    cause: unknown,
    progress: DeliveryLoopProgress,
  ): RejectedDeliveryShard {
    return Object.freeze({ status: "rejected", shard, obligation, cause, progress });
  },
  state(status: DeliveryLoopStatus): DeliveryShardState {
    switch (status) {
      case "IDLE":
        return "COMPLETE";
      case "STOPPED":
        return "STOPPED";
      case "FAILED":
      case "SKIPPED":
        return "PARKED";
    }
  },
  status(loops: readonly DeliveryLoopRun[]): DeliveryLoopStatus {
    if (loops.some(({ status }) => status === "FAILED")) return "FAILED";
    if (loops.some(({ status }) => status === "STOPPED")) return "STOPPED";
    if (loops.some(({ status }) => status === "SKIPPED")) return "SKIPPED";
    return "IDLE";
  },
});
