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
import { InboxRecords } from "./inbox-records.js";
import type { InboxMessage, InboxReadContinuation } from "./inbox.js";
import type { ShardIndex } from "./shard-index.js";
import type { DeliveryOperationOptions } from "./delivery-ports.js";

/** Small local repeat loop around the direct `Delivery.drain()` worker boundary. */
export class DeliveryLoop {
  readonly #delivery: Delivery;
  readonly #shard: ShardIndex;
  readonly #node: string;
  readonly #limit: number | undefined;
  readonly #maxFailures: number;
  readonly #onMessage: OnDeliveryMessage;
  readonly #onStarted: (() => void) | undefined;
  readonly #operation: DeliveryOperationOptions | undefined;
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
    this.#onStarted = options.onStarted;
    this.#operation = options.operation;
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
    const admission = await this.#admitEpoch(summary);
    if (admission !== undefined) {
      return admission;
    }

    let resumableScanRuns = 0;
    for (;;) {
      const remainingFailures = this.#maxFailures - summary.failed;
      const outcome = await this.#drain(this.#drainLimit(), remainingFailures);
      this.#recordOutcome(summary, outcome);
      const transition = this.#outcomeTransition(summary, outcome, resumableScanRuns);
      if (transition.kind === "TERMINAL") {
        return this.#finish(summary, transition);
      }
      resumableScanRuns = transition.resumableScanRuns;
    }
  }

  async #admitEpoch(summary: DeliveryLoopSummary): Promise<DeliveryLoopRun | undefined> {
    if (this.#epoch === undefined) {
      this.#progress = loopProgress();
      this.#epoch = await DeliveryEpoch.admit(
        this.#delivery,
        this.#shard,
        this.#admission.after,
        this.#operation,
      );
    }
    return this.#isStopped() ? this.#finish(summary, terminalTransition("STOPPED")) : undefined;
  }

  #recordOutcome(summary: DeliveryLoopSummary, outcome: DeliveryDrainOutcome): void {
    this.#resume = outcome.resumeCursor;
    summary.add(outcome.run);
    this.#progress = addLoopProgress(this.#progress, outcome.run);
  }

  #outcomeTransition(
    summary: DeliveryLoopSummary,
    outcome: DeliveryDrainOutcome,
    resumableScanRuns: number,
  ): LoopTransition {
    if (this.#isStopped()) {
      return terminalTransition("STOPPED");
    }
    if (outcome.run.status === "SKIPPED") {
      return terminalTransition("SKIPPED");
    }
    if (summary.failed >= this.#maxFailures && outcome.run.failed > 0) {
      return terminalTransition("FAILED");
    }
    return outcome.epochProgress === undefined
      ? this.#availableTransition(outcome, resumableScanRuns)
      : this.#epochTransition(outcome, resumableScanRuns);
  }

  #epochTransition(outcome: DeliveryDrainOutcome, resumableScanRuns: number): LoopTransition {
    const progress = outcome.epochProgress;
    if (progress === undefined || this.#epoch === undefined) {
      throw new Error("Delivery epoch progress is unavailable.");
    }
    this.#epoch.advance(progress.next);
    const nextRuns = resumableScanRuns + 1;
    if (progress.complete) {
      return terminalTransition("IDLE", true);
    }
    if (nextRuns >= maxResumableScanRuns) {
      this.#resume = undefined;
      return terminalTransition("PAUSED");
    }
    return continueTransition(nextRuns);
  }

  #availableTransition(outcome: DeliveryDrainOutcome, resumableScanRuns: number): LoopTransition {
    const { run } = outcome;
    if (run.accepted !== 0 || run.delivered !== 0 || run.failed !== 0) {
      return continueTransition(0);
    }
    if (!outcome.exhaustedSkippedScan) {
      return terminalTransition("IDLE");
    }
    const nextRuns = resumableScanRuns + 1;
    return nextRuns >= maxResumableScanRuns
      ? terminalTransition("PAUSED")
      : continueTransition(nextRuns);
  }

  #finish(summary: DeliveryLoopSummary, transition: TerminalTransition): DeliveryLoopRun {
    if (transition.status === "PAUSED") {
      return summary.result(transition.status);
    }
    if (transition.completedEpoch && this.#epoch !== undefined) {
      this.#admission.complete(this.#epoch.nextAdmissionAfter);
    } else {
      this.#admission.reset();
    }
    this.#epoch = undefined;
    this.#resume = undefined;
    return summary.result(transition.status);
  }

  #drain(limit: number, remainingFailures: number): Promise<DeliveryDrainOutcome> {
    return deliveryAccess.drain(
      this.#delivery,
      this.#shard,
      {
        node: this.#node,
        onMessage: this.#onMessage,
        limit,
        ...(this.#operation === undefined ? {} : { operation: this.#operation }),
      },
      {
        maxFailures: remainingFailures,
        ...(this.#epoch === undefined ? {} : { epoch: this.#epoch.slice() }),
        ...(this.#epoch !== undefined || this.#resume === undefined
          ? {}
          : { resume: this.#resume }),
        ...(this.#onStarted === undefined ? {} : { onStarted: this.#onStarted }),
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
type DeliveryResumeCursor = DeliveryDrainOutcome["resumeCursor"];

type LoopTransition = ContinueTransition | TerminalTransition;

interface ContinueTransition {
  readonly kind: "CONTINUE";
  readonly resumableScanRuns: number;
}

interface TerminalTransition {
  readonly kind: "TERMINAL";
  readonly status: DeliveryLoopStatus;
  readonly completedEpoch: boolean;
}

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
  /** Optional operation cancellation/deadline propagated to every drain port call. */
  readonly operation?: DeliveryOperationOptions;
  /** Optional package-owned observation after successful shard pickup. */
  readonly onStarted?: () => void;
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
  readonly #messages: readonly InboxMessage[];
  readonly #nextAdmissionAfter: InboxReadContinuation | undefined;
  #next = 0;

  private constructor(
    messages: readonly InboxMessage[],
    nextAdmissionAfter: InboxReadContinuation | undefined,
  ) {
    this.#messages = Object.freeze(messages.map(epochMessageSnapshot));
    this.#nextAdmissionAfter = nextAdmissionAfter;
  }

  static async admit(
    delivery: Delivery,
    shard: ShardIndex,
    initialAfter: InboxReadContinuation | undefined,
    operation: DeliveryOperationOptions | undefined,
  ): Promise<DeliveryEpoch> {
    const messages = await delivery.inbox.read(shard, {
      statuses: ["TO_DELIVER"],
      limit: inboxStorageAccess.maxReadLimit,
      ...(initialAfter === undefined ? {} : { after: initialAfter }),
      ...(operation ?? {}),
    });
    const last = messages.at(-1);
    const nextAdmissionAfter =
      messages.length === inboxStorageAccess.maxReadLimit && last !== undefined
        ? epochContinuation(last)
        : undefined;

    return new DeliveryEpoch(messages, nextAdmissionAfter);
  }

  get nextAdmissionAfter(): InboxReadContinuation | undefined {
    return this.#nextAdmissionAfter;
  }

  advance(next: number): void {
    if (!Number.isSafeInteger(next) || next < this.#next || next > this.#messages.length) {
      throw new Error("Delivery epoch progress is invalid.");
    }
    this.#next = next;
  }

  slice(): DeliveryEpochSlice {
    return Object.freeze({ messages: this.#messages, next: this.#next });
  }
}

class DeliveryAdmissionSweep {
  #after: InboxReadContinuation | undefined;
  #completedChunks = 0n;
  #chunksPerPass = 1n;

  get after(): InboxReadContinuation | undefined {
    return this.#after;
  }

  complete(next: InboxReadContinuation | undefined): void {
    if (next === undefined) {
      this.reset();
      return;
    }

    // Every pass starts at the head and doubles its chunk reach before the next restart.
    this.#completedChunks += 1n;
    if (this.#completedChunks === this.#chunksPerPass) {
      this.#after = undefined;
      this.#completedChunks = 0n;
      this.#chunksPerPass *= 2n;
      return;
    }
    this.#after = next;
  }

  reset(): void {
    this.#after = undefined;
    this.#completedChunks = 0n;
    this.#chunksPerPass = 1n;
  }
}

function continueTransition(resumableScanRuns: number): ContinueTransition {
  return Object.freeze({ kind: "CONTINUE", resumableScanRuns });
}

function terminalTransition(
  status: DeliveryLoopStatus,
  completedEpoch = false,
): TerminalTransition {
  return Object.freeze({ kind: "TERMINAL", status, completedEpoch });
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

function epochMessageSnapshot(message: InboxMessage): InboxMessage {
  return InboxRecords.read(InboxRecords.write(message));
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
