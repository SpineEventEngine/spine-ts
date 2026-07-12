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

  /** Configure worker loops for one node over known delivery shards. */
  constructor(options: DeliveryWorkerOptions) {
    const shards = requireShards(options.shards);
    this.#shards = shards;

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
    this.#states = shards.map(() => "READY");
    deliveryWorkerInternals.set(this, {
      start: (obligation, shards) => this.#startInternal(obligation, shards),
      awaitSettled: () => this.#awaitSettled(),
      retire: () => this.#retire(),
    });
    Object.freeze(this);
  }

  /** Start all configured loops and resolve when they stop. */
  start(): Promise<DeliveryWorkerRun> {
    this.#requireNotRetired();
    if (this.#running !== undefined) {
      throw new Error("DeliveryWorker is already running.");
    }

    const obligation = Object.freeze({});
    this.#obligation = obligation;
    this.#states.fill("READY");
    const running = compatibilityWorkerRun(this.#settle(this.#allEntries(), obligation)).finally(
      () => {
        this.#running = undefined;
      },
    );
    this.#running = running;
    return running;
  }

  /** Prevent future drain starts without interrupting current drains. */
  stop(): void {
    this.#stopped = true;
    for (const loop of this.#loops) {
      loop.stop();
    }
  }

  /** Call `stop()` and wait for active loops, if any, to finish. */
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
      const eligible = state === "READY" || state === "PAUSED" || state === "REJECTED";
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
        return rejectedShard(entry.shard, obligation, result.reason, progress);
      }

      this.#states[entry.index] = shardState(result.value.status);
      return fulfilledShard(entry.shard, obligation, result.value, progress);
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
  /**
   * Maximum failed observations per loop before that loop stops. Successful
   * exhaustion marking consumes no failure budget; a failed exhaustion mark
   * and existing endpoint, claim, lease/fencing, cleanup, or status-update
   * failures do. Defaults to one; capped at 1000.
   */
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

/** @internal Identity of one package-owned request to run configured delivery shards. */
export type DeliveryWorkerObligation = object;

/** @internal Ordered fulfilled and rejected evidence for one internal worker invocation. */
export interface DeliveryWorkerEvidence {
  readonly obligation: DeliveryWorkerObligation;
  readonly shards: readonly DeliveryShardEvidence[];
}

/** @internal Evidence for one configured shard in configured order. */
export type DeliveryShardEvidence = FulfilledDeliveryShard | RejectedDeliveryShard;

/** @internal Fulfilled loop evidence associated with its shard and obligation. */
export interface FulfilledDeliveryShard {
  readonly status: "fulfilled";
  readonly shard: ShardIndex;
  readonly obligation: DeliveryWorkerObligation;
  readonly run: DeliveryLoopRun;
  readonly progress: DeliveryLoopProgress;
}

/** @internal Rejected loop evidence preserving its original cause and last safe progress. */
export interface RejectedDeliveryShard {
  readonly status: "rejected";
  readonly shard: ShardIndex;
  readonly obligation: DeliveryWorkerObligation;
  readonly cause: unknown;
  readonly progress: DeliveryLoopProgress;
}

/** @internal Worker-result helpers for package-local tests and runtime code. */
export interface DeliveryWorkerAccess {
  status(loops: readonly DeliveryLoopRun[]): DeliveryLoopStatus;
  start(
    worker: DeliveryWorker,
    obligation: DeliveryWorkerObligation,
    shards?: readonly ShardIndex[],
  ): Promise<DeliveryWorkerEvidence>;
  awaitSettled(worker: DeliveryWorker): Promise<void>;
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

type DeliveryShardState = "READY" | "PAUSED" | "REJECTED" | "PARKED" | "COMPLETE" | "STOPPED";

const deliveryWorkerInternals = new WeakMap<DeliveryWorker, DeliveryWorkerInternals>();

function requireShards(shards: readonly ShardIndex[]): readonly ShardIndex[] {
  if (!Array.isArray(shards) || shards.length === 0) {
    throw new Error("DeliveryWorker shards must be a non-empty array.");
  }

  return Object.freeze(Array.from<ShardIndex>(shards));
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
  start(
    worker: DeliveryWorker,
    obligation: DeliveryWorkerObligation,
    shards?: readonly ShardIndex[],
  ) {
    return requireWorkerInternals(worker).start(obligation, shards);
  },
  awaitSettled(worker: DeliveryWorker) {
    return requireWorkerInternals(worker).awaitSettled();
  },
  retire(worker: DeliveryWorker) {
    return requireWorkerInternals(worker).retire();
  },
});

function requireWorkerInternals(worker: DeliveryWorker): DeliveryWorkerInternals {
  const internals = deliveryWorkerInternals.get(worker);
  if (internals === undefined) {
    throw new Error("Delivery worker access requires a DeliveryWorker instance.");
  }
  return internals;
}

async function compatibilityWorkerRun(
  evidence: Promise<DeliveryWorkerEvidence>,
): Promise<DeliveryWorkerRun> {
  const settled = (await evidence).shards;
  const loops: DeliveryLoopRun[] = [];
  const failures: unknown[] = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      loops.push(result.run);
    } else {
      failures.push(result.cause);
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

function fulfilledShard(
  shard: ShardIndex,
  obligation: DeliveryWorkerObligation,
  run: DeliveryLoopRun,
  progress: DeliveryLoopProgress,
): FulfilledDeliveryShard {
  return Object.freeze({ status: "fulfilled", shard, obligation, run, progress });
}

function rejectedShard(
  shard: ShardIndex,
  obligation: DeliveryWorkerObligation,
  cause: unknown,
  progress: DeliveryLoopProgress,
): RejectedDeliveryShard {
  return Object.freeze({ status: "rejected", shard, obligation, cause, progress });
}

function shardState(status: DeliveryLoopStatus): DeliveryShardState {
  switch (status) {
    case "PAUSED":
      return "PAUSED";
    case "IDLE":
      return "COMPLETE";
    case "STOPPED":
      return "STOPPED";
    case "FAILED":
    case "SKIPPED":
      return "PARKED";
  }
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
