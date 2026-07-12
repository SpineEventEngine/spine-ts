import { inboxStorageAccess } from "./inbox-storage.js";
import {
  deliveryAccess,
  type Delivery,
  type DeliveryDrainOutcome,
  type DeliveryEpochSlice,
  type DeliveryFailure,
  type DeliveryRun,
  type OnDeliveryMessage,
} from "./delivery.js";
import type { InboxMessage, InboxMessageId, InboxReadContinuation } from "./inbox.js";
import type { ShardIndex } from "./shard-index.js";

/** Small local repeat loop around the direct `Delivery.drain()` worker boundary. */
export class DeliveryLoop {
  readonly #delivery: Delivery;
  readonly #shard: ShardIndex;
  readonly #node: string;
  readonly #limit: number | undefined;
  readonly #maxFailures: number;
  readonly #onMessage: OnDeliveryMessage;
  readonly #admission = new DeliveryAdmissionSweep();
  #epoch: DeliveryEpoch | undefined;
  #progress = loopProgress();
  #resume: DeliveryResumeCursor | undefined;
  #stopped = false;
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
    deliveryLoopInternals.set(this, { progress: () => this.#progress });
    Object.freeze(this);
  }

  /**
   * Run one bounded step through an immutable admitted epoch until idle, skipped,
   * stopped, paused, or the failure bound is reached.
   */
  run(): Promise<DeliveryLoopRun> {
    if (this.#running !== undefined) {
      throw new Error("DeliveryLoop is already running.");
    }
    if (this.#isStopped()) {
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
    this.#stopped = true;
  }

  /** Call `stop()` and wait for the current drain, if any, to finish. */
  async close(): Promise<void> {
    this.stop();
    await this.#running;
  }

  async #runLoop(): Promise<DeliveryLoopRun> {
    this.#requireStorageBoundedLimit();
    const summary = new DeliveryLoopSummary();
    if (this.#epoch === undefined) {
      this.#progress = loopProgress();
      this.#epoch = await DeliveryEpoch.admit(this.#delivery, this.#shard, this.#admission.after);
    }
    if (this.#isStopped()) {
      this.#admission.reset();
      this.#epoch = undefined;
      return summary.result("STOPPED");
    }
    let resumableScanRuns = 0;
    for (;;) {
      const remainingFailures = this.#maxFailures - summary.failed;
      const limit = this.#drainLimit();
      const outcome = await this.#drain(limit, remainingFailures);
      const { run } = outcome;
      this.#resume = outcome.resumeCursor;
      summary.add(run);
      this.#progress = addLoopProgress(this.#progress, run);
      if (this.#isStopped()) {
        this.#admission.reset();
        this.#epoch = undefined;
        this.#resume = undefined;
        return summary.result("STOPPED");
      }
      if (run.status === "SKIPPED") {
        this.#admission.reset();
        this.#epoch = undefined;
        this.#resume = undefined;
        return summary.result("SKIPPED");
      }
      if (summary.failed >= this.#maxFailures && run.failed > 0) {
        this.#admission.reset();
        this.#epoch = undefined;
        this.#resume = undefined;
        return summary.result("FAILED");
      }
      if (outcome.epochProgress !== undefined) {
        this.#epoch.advance(outcome.epochProgress.next);
        resumableScanRuns += 1;
        if (outcome.epochProgress.complete) {
          this.#admission.complete(this.#epoch.nextAdmissionAfter);
          this.#epoch = undefined;
          this.#resume = undefined;
          return summary.result("IDLE");
        }
        if (resumableScanRuns >= maxResumableScanRuns) {
          this.#resume = undefined;
          return summary.result("PAUSED");
        }
        continue;
      }
      if (run.accepted === 0 && run.delivered === 0 && run.failed === 0) {
        if (outcome.exhaustedSkippedScan) {
          resumableScanRuns += 1;
          if (resumableScanRuns >= maxResumableScanRuns) {
            return summary.result("PAUSED");
          }
          continue;
        }
        resumableScanRuns = 0;
        this.#admission.reset();
        this.#epoch = undefined;
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
        ...(this.#epoch === undefined ? {} : { epoch: this.#epoch.slice() }),
        ...(this.#epoch !== undefined || this.#resume === undefined
          ? {}
          : { resume: this.#resume }),
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

  #isStopped(): boolean {
    return this.#stopped;
  }
}

const maxDeliveryLoopFailures = 1_000;
const maxResumableScanRuns = 2;
const maxAdmittedEpochMessages = 10_000;
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
   * Maximum failed observations before the loop stops. Successful exhaustion
   * marking consumes no failure budget; a failed exhaustion-time mark and
   * existing failures do. Defaults to one; capped at 1000.
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

/** @internal Last safely completed drain evidence for the current admitted epoch. */
export interface DeliveryLoopProgress {
  readonly runs: number;
  readonly processed: number;
  readonly accepted: number;
  readonly delivered: number;
  readonly failed: number;
  readonly failures: readonly DeliveryFailure[];
}

/** @internal Loop evidence helpers for package-local worker coordination. */
export interface DeliveryLoopAccess {
  progress(loop: DeliveryLoop): DeliveryLoopProgress;
}

interface DeliveryLoopInternals {
  readonly progress: () => DeliveryLoopProgress;
}

const deliveryLoopInternals = new WeakMap<DeliveryLoop, DeliveryLoopInternals>();

/** @internal Loop evidence helpers for package-local worker coordination. */
export const deliveryLoopAccess: DeliveryLoopAccess = Object.freeze({
  progress(loop: DeliveryLoop) {
    const internals = deliveryLoopInternals.get(loop);
    if (internals === undefined) {
      throw new Error("Delivery loop access requires a DeliveryLoop instance.");
    }
    return internals.progress();
  },
});

class DeliveryLoopSummary {
  #runs = 0;
  #processed = 0;
  #accepted = 0;
  #delivered = 0;
  #failed = 0;
  readonly #failures: DeliveryFailure[] = [];

  get runs(): number {
    return this.#runs;
  }

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

class DeliveryEpoch {
  readonly #messageIds: readonly InboxMessageId[];
  readonly #nextAdmissionAfter: InboxReadContinuation | undefined;
  #next = 0;

  private constructor(
    messageIds: readonly InboxMessageId[],
    nextAdmissionAfter: InboxReadContinuation | undefined,
  ) {
    this.#messageIds = Object.freeze([...messageIds]);
    this.#nextAdmissionAfter = nextAdmissionAfter;
  }

  static async admit(
    delivery: Delivery,
    shard: ShardIndex,
    initialAfter: InboxReadContinuation | undefined,
  ): Promise<DeliveryEpoch> {
    const messageIds: InboxMessageId[] = [];
    let after = initialAfter;

    while (messageIds.length < maxAdmittedEpochMessages) {
      const limit = Math.min(
        inboxStorageAccess.maxReadLimit,
        maxAdmittedEpochMessages - messageIds.length,
      );
      const messages = await delivery.inbox.read(shard, {
        statuses: ["TO_DELIVER"],
        limit,
        ...(after === undefined ? {} : { after }),
      });
      for (const message of messages) {
        messageIds.push(epochMessageId(message));
      }
      if (messages.length < limit) {
        break;
      }
      const last = messages.at(-1);
      if (last === undefined) {
        break;
      }
      after = epochContinuation(last);
    }

    return new DeliveryEpoch(
      messageIds,
      messageIds.length === maxAdmittedEpochMessages ? after : undefined,
    );
  }

  get nextAdmissionAfter(): InboxReadContinuation | undefined {
    return this.#nextAdmissionAfter;
  }

  advance(next: number): void {
    if (!Number.isSafeInteger(next) || next < this.#next || next > this.#messageIds.length) {
      throw new Error("Delivery epoch progress is invalid.");
    }
    this.#next = next;
  }

  slice(): DeliveryEpochSlice {
    return Object.freeze({ messageIds: this.#messageIds, next: this.#next });
  }
}

class DeliveryAdmissionSweep {
  #after: InboxReadContinuation | undefined;
  #completed = 0n;
  #length = 1n;

  get after(): InboxReadContinuation | undefined {
    return this.#after;
  }

  complete(next: InboxReadContinuation | undefined): void {
    if (next === undefined) {
      this.reset();
      return;
    }

    this.#completed += 1n;
    if (this.#completed === this.#length) {
      this.#after = undefined;
      this.#completed = 0n;
      this.#length *= 2n;
      return;
    }
    this.#after = next;
  }

  reset(): void {
    this.#after = undefined;
    this.#completed = 0n;
    this.#length = 1n;
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

function loopProgress(
  runs = 0,
  processed = 0,
  accepted = 0,
  delivered = 0,
  failed = 0,
  failures: readonly DeliveryFailure[] = [],
): DeliveryLoopProgress {
  return Object.freeze({
    runs,
    processed,
    accepted,
    delivered,
    failed,
    failures: Object.freeze([...failures]),
  });
}

function addLoopProgress(progress: DeliveryLoopProgress, run: DeliveryRun): DeliveryLoopProgress {
  return loopProgress(
    progress.runs + 1,
    progress.processed + run.processed,
    progress.accepted + run.accepted,
    progress.delivered + run.delivered,
    progress.failed + run.failed,
    [...progress.failures, ...run.failures],
  );
}

function epochMessageId(message: InboxMessage): InboxMessageId {
  return Object.freeze({ value: message.id.value, shard: message.shard });
}

function epochContinuation(message: InboxMessage): InboxReadContinuation {
  return Object.freeze({
    messageId: message.id.value,
    whenReceived: new Date(message.whenReceived.getTime()),
    version: message.version,
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
