/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { Time } from "@spine-event-engine/core/time";
import { clone, create } from "@bufbuild/protobuf";
import { AnySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { randomUUID } from "node:crypto";
import { TenantIdSchema } from "@spine-event-engine/proto";
import { WorkerIdSchema, type WorkerId } from "@spine-event-engine/proto/delivery";
import type { StorageContext, StorageFactory } from "@spine-event-engine/storage";
import type { ILogLayer } from "loglayer";

import type { DeliveryControlledRun } from "./delivery-run-control.js";
import {
  AlreadyPickedUp,
  DeliveryMonitor,
  FailedPickUp,
  FailedReception,
  type DeliveryStatistics,
} from "./delivery-monitor.js";
import type { DeliveryInbox, DeliveryWorkRegistry, DeliveryWorkSession } from "./delivery-ports.js";
import { Inbox, InboxTargets, type InboxMessage } from "./inbox.js";
import { InboxStorage, InboxStorageClock } from "./inbox-storage.js";
import { ShardIndex } from "./shard-index.js";
import { ShardedWorkRegistry } from "./sharded-work-registry.js";
import { deliveryTenantKey } from "./delivery-tenant.js";
import { withDeliveryCommitFence } from "../repository/commit-fence.js";
import { receptionObservation, type ReceptionObservation } from "./reception-observation.js";
import { AgentDeliveryScope, type AgentDeliveryOutcome } from "./agent-delivery-scope.js";
import type { DeliveryResult, DeliveryRunOptions, DeliveryStrategy } from "./delivery-builder.js";
import { emitServerError } from "../server/server-log.js";

const deliveryFailureLimit = 100;
const controlledMessageSettlers = new WeakMap<
  DeliveryDrainOptions,
  (message: InboxMessage) => void
>();

/**
 * Describes an endpoint snapshot supplied for direct Inbox delivery.
 */
export type DeliveryEndpointMessage = InboxMessage;

/**
 * Dispatches one persisted Inbox message to an endpoint.
 *
 * @param message The message to dispatch.
 * @returns A promise that settles when endpoint dispatch completes.
 */
export type OnDeliveryMessage = (message: DeliveryEndpointMessage) => void | Promise<void>;

interface DirectDrainInput {
  readonly onMessage: OnDeliveryMessage;
  readonly onDelivered?: (message: InboxMessage) => void;
  readonly onDuplicateRemoved?: (message: InboxMessage) => void;
  readonly acceptMessage?: (message: InboxMessage) => boolean;
}

interface DirectPending {
  readonly shardKey: string;
  readonly input: DirectDrainInput;
  readonly settle: (outcome: DeliveryMessageOutcome) => boolean;
  readonly completed: Promise<DeliveryDirectRun>;
}

type DirectDrainRequest =
  | OnDeliveryMessage
  | {
      readonly node?: string;
      readonly onMessage: OnDeliveryMessage;
      readonly onDelivered?: (message: InboxMessage) => void;
      readonly onDuplicateRemoved?: (message: InboxMessage) => void;
      readonly acceptMessage?: (message: InboxMessage) => boolean;
    };

/**
 * Reports one direct drain and whether it durably resolved the selected message.
 *
 * @internal
 */
export interface DeliveryDirectRun {
  // prettier-ignore

  /**
   * Contains the terminal shard-drain outcome.
   */
  readonly run?: DeliveryRun;

  /**
   * Indicates whether this drain marked the selected message delivered or
   * removed it as a duplicate.
   */
  readonly acknowledged: boolean;

  /**
   * The selected row's complete attempt outcome, when it was attempted.
   */
  readonly outcome?: DeliveryMessageOutcome;
}

/**
 * One selected Inbox row's result, independently of its shard drain.
 */
export type DeliveryMessageOutcome =
  | {
      /**
       * Indicates durable acknowledgement of the selected row.
       */
      readonly kind: "acknowledged";

      /**
       * Whether this row was accepted by a live Agent.
       */
      readonly agent: boolean;
    }
  | {
      /**
       * Indicates a row deferred until capacity becomes available.
       */
      readonly kind: "deferred";
    }
  | {
      /**
       * Indicates a failed row attempt.
       */
      readonly kind: "failed";

      /**
       * Original dispatch or acknowledgement failure.
       */
      readonly error: unknown;
    }
  | {
      /**
       * Indicates a row that requires a later shard attempt.
       */
      readonly kind: "unresolved";

      /**
       * Terminal status of the current finite shard run.
       */
      readonly run: DeliveryRun;
    };

/**
 * Summarizes one finite direct delivery run.
 */
export interface DeliveryRun {
  // prettier-ignore

  /**
   * Identifies the terminal delivery outcome.
   */
  readonly status: "DRAINED" | "SKIPPED" | "FAILED" | "STOPPED";

  /**
   * Counts messages considered for dispatch.
   */
  readonly processed: number;

  /**
   * Counts messages admitted to the endpoint.
   */
  readonly accepted: number;

  /**
   * Counts messages durably acknowledged as delivered.
   */
  readonly delivered: number;

  /**
   * Counts dispatch or acknowledgement failures.
   */
  readonly failed: number;

  /**
   * Lists ephemeral delivery failures.
   */
  readonly failures: readonly DeliveryFailure[];
}

/**
 * Describes ephemeral delivery failure evidence that is never persisted.
 */
export interface DeliveryFailure {
  // prettier-ignore

  /**
   * Identifies the message associated with the failure.
   */
  readonly message: InboxMessage;

  /**
   * Supplies the observed failure.
   */
  readonly error: unknown;
}

/**
 * Executes direct Inbox delivery for one complete worker identity.
 */
interface ActiveDeliveryRun {
  completed: Promise<DeliveryRun>;
  readonly shared: boolean;
  drain?: DeliveryDrain;
  releaseFailure?: unknown;
}

const dispatchNotAdmitted = Symbol("Delivery recipient closed before dispatch");

interface DeliveryAcknowledgement {
  completed: boolean;
  exhausted: boolean;
  notAdmitted?: boolean;
}

/**
 * Runs one retained direct-delivery worker and its durable Inbox.
 */
export class Delivery {
  // prettier-ignore

  /**
   * Identifies the immutable storage namespace.
   */
  readonly context: StorageContext;

  /**
   * Supplies durable record storage.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Maps targets to delivery shards.
   */
  readonly strategy: DeliveryStrategy;

  /**
   * Identifies this worker's opaque durable ownership identity.
   */
  readonly worker: WorkerId;

  /**
   * Names the worker node for compatibility integrations.
   */
  readonly node: string;

  /**
   * Bounds each direct Inbox read.
   */
  readonly pageSize: number;

  /**
   * Reads and acknowledges direct Inbox rows.
   */
  readonly inbox: DeliveryInbox;

  /**
   * Acquires and releases direct shard ownership.
   */
  readonly shards: DeliveryWorkRegistry;

  readonly #monitor: DeliveryMonitor;

  readonly #directPending = new Map<string, DirectPending>();

  readonly #logger: ILogLayer | undefined;

  readonly #backgroundObserved = new WeakSet<Promise<DeliveryRun>>();

  readonly #callerObserved = new WeakSet<Promise<DeliveryRun>>();

  readonly #activeDirect = new Map<
    string,
    { readonly completed: Promise<DeliveryRun>; wake(): void }
  >();

  readonly #activeRuns = new Set<ActiveDeliveryRun>();

  readonly #directDrains = new Map<string, DeliveryDrain>();

  readonly #pendingDirectWake = new Set<string>();

  #replay: OnDeliveryMessage | undefined;

  #acceptReplay: ((message: InboxMessage) => boolean) | undefined;

  #closing = false;

  #startupDraining = false;

  #closeAttempt: Promise<void> | undefined;

  #closingRuns: ActiveDeliveryRun[] | undefined;

  /**
   * Sets the complete direct fallback dispatcher before receiving work.
   *
   * @internal
   * @param onReplay Callback that replays a ready Inbox route.
   * @param onAccept Reports whether a live recipient currently serves the row.
   */
  setReplay(onReplay: OnDeliveryMessage, onAccept?: (message: InboxMessage) => boolean): void {
    this.#replay = onReplay;
    this.#acceptReplay = onAccept;
  }

  /**
   * Waits for every retained direct shard run to release its session.
   *
   * @internal
   * @returns Completion after retained shard sessions release.
   */
  async whenIdle(): Promise<void> {
    const failures: unknown[] = [];
    while (this.#activeRuns.size > 0) {
      const active = [...this.#activeRuns];
      const settled = await Promise.allSettled(active.map(({ completed }) => completed));
      settled.forEach((outcome, index) => {
        const failure = active[index]?.releaseFailure;
        if (failure !== undefined) failures.push(failure);
        if (outcome.status === "rejected") failures.push(outcome.reason);
      });
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Delivery idle wait failed.");
  }

  /**
   * Stops direct admission and drains all entered shard work.
   *
   * @internal
   * @returns Completion after admitted work and retained cleanup settle.
   */
  close(): Promise<void> {
    if (this.#closeAttempt !== undefined) return this.#closeAttempt;
    this.beginClose();
    const active = this.#closingRuns ?? [];
    this.#closeAttempt = Promise.allSettled(active.map(({ completed }) => completed)).then(
      async (settled) => {
        const failures: unknown[] = [];
        settled.forEach((result, index) => {
          const releaseFailure = active[index]?.releaseFailure;
          if (releaseFailure !== undefined) failures.push(releaseFailure);
          if (result.status === "rejected") failures.push(result.reason);
        });
        const storage = await Promise.allSettled([
          this.inbox instanceof Inbox ? this.inbox.storage.close() : Promise.resolve(),
          this.shards instanceof ShardedWorkRegistry ? this.shards.close() : Promise.resolve(),
        ]);
        for (const result of storage)
          if (result.status === "rejected") failures.push(result.reason);
        if (failures.length === 1) throw failures[0];
        if (failures.length) throw new AggregateError(failures, "Delivery close failed.");
      },
    );
    return this.#closeAttempt;
  }

  /**
   * Closes admission synchronously and retains admitted release outcomes.
   *
   * @internal
   */
  beginClose(): void {
    if (this.#closing) return;
    this.#closing = true;
    this.#closingRuns ??= [...this.#activeRuns];
    for (const active of this.#closingRuns) active.drain?.stop(new Error("Delivery closed."));
  }

  /**
   * Marks public runs as unavailable while preserving exact admitted local handoffs.
   *
   * @internal
   */
  beginStartupDrain(): void {
    if (this.#startupDraining || this.#closing) return;
    this.#startupDraining = true;
    this.#closingRuns = [...this.#activeRuns];
  }

  /**
   * Notifies an admitted shard run to scan newly eligible durable rows.
   *
   * @internal
   * @param shard Delivery shard identifier.
   */
  wake(shard: ShardIndex): void {
    if (this.#closing || (this.#startupDraining && !this.#hasPending(shard.key()))) return;
    const drain = this.#directDrains.get(shard.key());
    if (drain !== undefined) {
      if (!drain.wake()) this.#pendingDirectWake.add(shard.key());
      return;
    }
    if (this.#replay !== undefined) this.#observeBackground(this.#startDirect(shard), shard);
  }

  /**
   * Creates direct delivery from immutable options.
   *
   * @param options The delivery configuration.
   */
  constructor(options: DeliveryOptions) {
    if (options.context.multitenant)
      throw new TypeError("Delivery requires a single-tenant storage context.");
    if (
      options.worker !== undefined &&
      options.node !== undefined &&
      options.worker.nodeId?.value !== options.node
    ) {
      throw new Error("Delivery worker node must match the configured delivery node.");
    }
    this.context = Delivery.#contextSnapshot(options.context);
    this.#logger = options.logger;
    this.storageFactory = options.storageFactory;
    this.strategy = options.strategy ?? { shardCount: 1, shardFor: () => ShardIndex.single() };
    this.worker =
      options.worker === undefined
        ? workerId(options.node ?? "local")
        : snapshotWorker(options.worker);
    this.node = this.worker.nodeId?.value ?? "local";
    this.pageSize = options.pageSize ?? 100;
    this.inbox =
      options.inbox ??
      new Inbox(new InboxStorage({ context: this.context, storageFactory: this.storageFactory }));
    this.shards =
      options.workRegistry ??
      new ShardedWorkRegistry({ context: this.context, storageFactory: this.storageFactory });
    this.#monitor = options.monitor ?? new DeliveryMonitor();
    Object.freeze(this);
  }

  /**
   * Executes one finite shard delivery.
   *
   * @param options The selected shard and endpoint callback.
   * @returns The terminal public delivery result.
   */
  async run(options: DeliveryRunOptions): Promise<DeliveryResult> {
    const shard = options.shard ?? ShardIndex.single();
    const run = await this.drain(shard, { onMessage: options.onMessage });
    return Object.freeze({
      status:
        run.status === "SKIPPED"
          ? "SKIPPED"
          : run.status === "FAILED"
            ? "FAILED"
            : run.status === "STOPPED"
              ? "STOPPED"
              : "COMPLETED",
    });
  }

  /**
   * Executes one finite shard delivery under an operation signal.
   *
   * @param options The controlled shard, endpoint, and cancellation signal.
   * @returns The terminal public delivery result.
   */
  runControlled(options: DeliveryControlledRun): Promise<DeliveryResult> {
    const shard = options.shard;
    const drainOptions = this.#controlledOptions(options);
    if (options.onMessageSettled !== undefined)
      controlledMessageSettlers.set(drainOptions, options.onMessageSettled);
    const completed =
      this.#replay === undefined
        ? this.drain(shard, drainOptions)
        : this.#startShared(shard, drainOptions);
    return completed
      .then((run) => {
        options.onDrainResult?.(run);
        return Object.freeze({
          status:
            run.status === "SKIPPED"
              ? "SKIPPED"
              : run.status === "FAILED"
                ? "FAILED"
                : run.status === "STOPPED"
                  ? "STOPPED"
                  : "COMPLETED",
        });
      })
      .finally(() => {
        controlledMessageSettlers.delete(drainOptions);
      });
  }

  /**
   * Builds the exact controlled options for an endpoint or retained replay run.
   * @param options Controlled run input.
   * @returns The options passed to one physical shard drain.
   */
  #controlledOptions(options: DeliveryControlledRun): DeliveryDrainOptions {
    return this.#replay === undefined
      ? {
          onMessage: options.onMessage,
          ...(options.acceptMessage === undefined ? {} : { acceptMessage: options.acceptMessage }),
          operation: { signal: options.signal },
        }
      : { ...this.#directOptions(), operation: { signal: options.signal } };
  }

  /**
   * Delivers the selected message's shard for local handoff integration.
   *
   * @param message The message selecting the shard to drain.
   * @param input The endpoint callback or callback configuration.
   * @returns The terminal direct-delivery result.
   */
  async drainMessage(message: InboxMessage, input: DirectDrainRequest): Promise<DeliveryDirectRun> {
    return this.#drainDirect(message, this.#directInput(input));
  }

  #directInput(input: Parameters<Delivery["drainMessage"]>[1]): DirectDrainInput {
    return typeof input === "function" ? { onMessage: input } : input;
  }

  static #contextSnapshot(context: StorageContext): StorageContext {
    return Object.freeze(
      context.multitenant
        ? {
            name: context.name,
            multitenant: true,
            tenantId: clone(TenantIdSchema, context.tenantId),
          }
        : { name: context.name, multitenant: false },
    );
  }

  async #drainDirect(message: InboxMessage, input: DirectDrainInput): Promise<DeliveryDirectRun> {
    const key = Delivery.#messageKey(message);
    const pending = this.#directPending.get(key);
    if (pending !== undefined) return pending.completed;
    const selected = Promise.withResolvers<DeliveryDirectRun>();
    const settle = (outcome: DeliveryMessageOutcome): boolean => {
      if (this.#directPending.get(key)?.settle !== settle) return false;
      this.#directPending.delete(key);
      selected.resolve(Object.freeze({ acknowledged: outcome.kind === "acknowledged", outcome }));
      return true;
    };
    this.#directPending.set(key, {
      shardKey: message.shard.key(),
      input,
      settle,
      completed: selected.promise,
    });
    const completed = this.#startDirect(message.shard);
    this.#observeSelectedRun(message.shard, key, completed, settle);
    return selected.promise;
  }

  /**
   * Transfers an unresolved exact-row observer to a successor shard run.
   */
  #observeSelectedRun(
    shard: ShardIndex,
    key: string,
    completed: Promise<DeliveryRun>,
    settle: DirectPending["settle"],
  ): void {
    void completed.then(
      (run) => {
        if (!this.#directPending.has(key)) return;
        const successor = this.#activeDirect.get(shard.key())?.completed;
        if (successor !== undefined && successor !== completed) {
          this.#observeSelectedRun(shard, key, successor, settle);
        } else settle({ kind: "unresolved", run });
      },
      (error: unknown) => {
        if (settle({ kind: "failed", error })) this.#callerObserved.add(completed);
      },
    );
  }

  static #messageKey(message: InboxMessage): string {
    return JSON.stringify([
      deliveryTenantKey(message),
      message.id.value,
      message.id.shard.index,
      message.id.shard.ofTotal,
    ]);
  }

  /**
   * Starts or wakes the retained direct run for one shard.
   */
  #startDirect(shard: ShardIndex): Promise<DeliveryRun> {
    if (this.#closing || (this.#startupDraining && !this.#hasPending(shard.key())))
      return Promise.resolve(result("STOPPED"));
    return this.#startShared(shard, this.#directOptions());
  }

  /**
   * Checks whether an exact accepted handoff needs this shard.
   * @param shardKey Canonical shard key.
   * @returns Whether an exact pending observer remains.
   */
  #hasPending(shardKey: string): boolean {
    return [...this.#directPending.values()].some((pending) => pending.shardKey === shardKey);
  }

  /**
   * Starts or joins the one retained shard run used by local posts and supervision.
   * @param shard Shard selected by the accepted message or supervisor.
   * @param options Complete drain callbacks for a newly admitted run.
   * @returns The terminal run shared by both entry paths.
   */
  #startShared(shard: ShardIndex, options: DeliveryDrainOptions): Promise<DeliveryRun> {
    const key = shard.key();
    if (this.#startupDraining && !this.#hasPending(key)) return Promise.resolve(result("STOPPED"));
    const active = this.#activeDirect.get(key);
    if (active !== undefined) {
      active.wake();
      return active.completed;
    }
    const completed = this.#trackDrain(shard, options, true);
    this.#activeDirect.set(key, {
      completed,
      wake: () => {
        const drain = this.#directDrains.get(key);
        if (drain === undefined) this.#pendingDirectWake.add(key);
        else if (!drain.wake()) this.#pendingDirectWake.add(key);
      },
    });
    void completed
      .finally(() => {
        this.#activeDirect.delete(key);
        this.#directDrains.delete(key);
        if (this.#pendingDirectWake.delete(key) && !this.#closing)
          this.#observeBackground(this.#startDirect(shard), shard);
      })
      .catch(() => undefined);
    return completed;
  }

  /**
   * Reports a detached local shard failure without changing its result.
   * @param completed Detached shard run.
   * @param shard Failed shard.
   */
  #observeBackground(completed: Promise<DeliveryRun>, shard: ShardIndex): void {
    if (this.#backgroundObserved.has(completed)) return;
    this.#backgroundObserved.add(completed);
    void completed.catch(async (error: unknown) => {
      // Give exact-row observers of this rejection a chance to settle first.
      await Promise.resolve();
      if (this.#closing || this.#logger === undefined || this.#callerObserved.has(completed))
        return;
      emitServerError(this.#logger, "Background Delivery failed.", {
        shardId: shard.key(),
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    });
  }

  /**
   * Dispatches each selected direct row through its registered endpoint.
   */
  #directOptions(): DeliveryDrainOptions {
    const request = (message: InboxMessage) =>
      this.#directPending.get(Delivery.#messageKey(message));
    return {
      onMessage: (message) => {
        const selected = request(message);
        return selected === undefined ? this.#replay?.(message) : selected.input.onMessage(message);
      },
      acceptMessage: (message) => {
        const selected = request(message);
        return selected === undefined
          ? !this.#startupDraining &&
              this.#replay !== undefined &&
              (this.#acceptReplay?.(message) ?? true)
          : (selected.input.acceptMessage?.(message) ?? true);
      },
      onDelivered: (message) => request(message)?.input.onDelivered?.(message),
      onDuplicateRemoved: (message) => request(message)?.input.onDuplicateRemoved?.(message),
      onMessageOutcome: (message, outcome) => request(message)?.settle(outcome),
    };
  }

  /**
   * Executes one owned shard drain while containing monitor and endpoint failures.
   *
   * @param shard The shard to acquire and drain.
   * @param options The endpoint and optional operation signal.
   * @returns The terminal direct-delivery result.
   */
  drain(shard: ShardIndex, options: DeliveryDrainOptions): Promise<DeliveryRun> {
    return this.#trackDrain(shard, options, false);
  }

  /**
   * Tracks one complete physical drain before opening its shard session.
   * @param shard Selected shard.
   * @param options Complete drain callbacks.
   * @param shared Whether the run serves the shared replay route.
   * @returns Completion after shard release.
   */
  #trackDrain(
    shard: ShardIndex,
    options: DeliveryDrainOptions,
    shared: boolean,
  ): Promise<DeliveryRun> {
    if (this.#closing || (this.#startupDraining && (!shared || !this.#hasPending(shard.key()))))
      return Promise.resolve(result("STOPPED"));
    const completion = Promise.withResolvers<DeliveryRun>();
    const active: ActiveDeliveryRun = { completed: completion.promise, shared };
    this.#activeRuns.add(active);
    if (this.#startupDraining) this.#closingRuns?.push(active);
    void this.#drainAdmitted(shard, options, active).then(completion.resolve, completion.reject);
    void active.completed.finally(() => this.#activeRuns.delete(active)).catch(() => undefined);
    return active.completed;
  }

  /**
   * Completes shard acquisition, callbacks, and release for an admitted run.
   * @param shard Selected shard.
   * @param options Complete drain callbacks.
   * @param active Admitted run record.
   * @returns Terminal result after release.
   */
  async #drainAdmitted(
    shard: ShardIndex,
    options: DeliveryDrainOptions,
    active: ActiveDeliveryRun,
  ): Promise<DeliveryRun> {
    if (this.#shouldStop(options)) return result("STOPPED");
    let session;
    try {
      session = await this.shards.pickUp(shard, this.worker, options.operation);
    } catch (error) {
      await safely(async () =>
        (await this.#monitor.onShardPickUpFailure(new FailedPickUp(shard, error))).execute(),
      );
      return result("FAILED");
    }
    if (session === undefined) {
      await safely(async () =>
        (await this.#monitor.onShardAlreadyPicked(new AlreadyPickedUp(shard))).execute(),
      );
      return result("SKIPPED");
    }
    if (this.#shouldStop(options)) return this.#releaseStoppedSession(session, active);
    return this.#runSession(shard, options, session, active);
  }

  /**
   * Releases a session acquired after direct admission closed.
   *
   * @param session The acquired session to release.
   * @param active The admitted run retaining release failure.
   * @returns The stopped or failed direct-delivery result.
   */
  async #releaseStoppedSession(
    session: DeliveryWorkSession,
    active: ActiveDeliveryRun,
  ): Promise<DeliveryRun> {
    try {
      const released = await this.shards.release(session);
      if (!released) active.releaseFailure = new Error("Shard release was not confirmed.");
      return result(released ? "STOPPED" : "FAILED");
    } catch (error) {
      active.releaseFailure =
        error instanceof Error ? error : new Error("Shard release failed.", { cause: error });
      return result("FAILED");
    }
  }

  /**
   * Reads current admission fences after asynchronous shard acquisition.
   */
  #shouldStop(options: DeliveryDrainOptions): boolean {
    return this.#closing || options.operation?.signal?.aborted === true;
  }

  /**
   * Tracks an admitted direct session through its complete drain.
   */
  #runSession(
    shard: ShardIndex,
    options: DeliveryDrainOptions,
    session: DeliveryWorkSession,
    active: ActiveDeliveryRun,
  ): Promise<DeliveryRun> {
    const drain = new DeliveryDrain({
      inbox: this.inbox,
      monitor: this.#monitor,
      options,
      pageSize: this.pageSize,
      session,
      shards: this.shards,
      shard,
    });
    active.drain = drain;
    if (active.shared) {
      this.#directDrains.set(shard.key(), drain);
      if (this.#pendingDirectWake.delete(shard.key())) drain.wake();
    }
    const completed = drain.run().finally(() => {
      active.releaseFailure = drain.releaseFailure;
    });
    void completed
      .finally(() => {
        if (active.shared && this.#directDrains.get(shard.key()) === drain)
          this.#directDrains.delete(shard.key());
      })
      .catch(() => undefined);
    return completed;
  }
}

/**
 * Processes inbox pages while retaining one shard session.
 */
class DeliveryDrain {
  readonly #statistics = counts();

  readonly #agentController = new AbortController();

  readonly #liveAgents = new Set<Promise<void>>();

  readonly #failures: DeliveryFailure[] = [];

  readonly #deduplication: DeliveryDeduplication;

  readonly #blockedTargets = new Set<string>();

  readonly #capacityBlockedTargets = new Set<string>();

  readonly #removedInPage = new Set<InboxMessage>();

  readonly #messageOutcomes = new WeakMap<InboxMessage, DeliveryMessageOutcome>();

  #wakeGeneration = 0;

  #wakeGate = Promise.withResolvers<undefined>();

  #sessionSerial: Promise<void> = Promise.resolve();

  #renewalTimer: ReturnType<typeof setTimeout> | undefined;

  #current: DeliveryWorkSession;

  #ownershipLost = false;

  #failureLimitReached = false;

  #stopped = false;

  #reading = true;

  #releaseFailure: unknown;

  /**
   * Returns a failed session release to an active direct close.
   *
   * @returns The original shard-release failure, if one occurred.
   */
  get releaseFailure(): unknown {
    return this.#releaseFailure;
  }

  /**
   * Creates a drain for one acquired shard session.
   *
   * @param input Supplies the inbox, callbacks, and shard session.
   */
  constructor(private readonly input: DeliveryDrainInputState) {
    this.#current = input.session;
    this.#deduplication = new DeliveryDeduplication(input.inbox);
  }

  /**
   * Notifies a fresh durable scan without starting a second shard session.
   *
   * @returns Whether the wake was recorded for a live shard run.
   */
  wake(): boolean {
    if (!this.#reading) return false;
    this.#wakeGeneration += 1;
    for (const target of this.#capacityBlockedTargets) this.#blockedTargets.delete(target);
    this.#capacityBlockedTargets.clear();
    this.#wakeGate.resolve(undefined);
    this.#wakeGate = Promise.withResolvers<undefined>();
    return true;
  }

  /**
   * Stops new work and cancels entered Agent work for explicit shutdown.
   *
   * @param reason Cause of cancellation or failure.
   */
  stop(reason: unknown): void {
    this.#stopped = true;
    this.#agentController.abort(reason);
    this.#clearRenewal();
    this.wake();
  }

  /**
   * Serializes validation, renewal, and release against one current session snapshot.
   * @typeParam T Result of the admitted shard operation.
   * @param onOperation Current-session operation serialized with renewal and release.
   * @returns Result of the admitted session operation.
   */
  #sessionOperation<T>(onOperation: () => Promise<T>): Promise<T> {
    const attempt = this.#sessionSerial.then(onOperation);
    this.#sessionSerial = attempt.then(
      () => undefined,
      () => undefined,
    );
    return attempt;
  }

  /**
   * Schedules renewal before the issued lease expires while live work remains.
   */
  #scheduleRenewal(): void {
    if (this.#stopped || this.#current.kind !== "LEASED" || this.input.shards.renew === undefined)
      return;
    this.#clearRenewal();
    const life = this.#current.expiresAt.getTime() - this.#current.pickedUpAt.getTime();
    const delay = Math.max(
      1,
      Math.min(
        Math.floor(life / 2),
        this.#current.expiresAt.getTime() - Time.currentTimeMillis() - 1,
      ),
    );
    this.#renewalTimer = setTimeout(() => {
      void this.#renewLease();
    }, delay);
    this.#renewalTimer.unref();
  }

  /**
   * Updates one live lease and fences the run permanently on loss.
   * @returns Completion of lease renewal or loss fencing.
   */
  async #renewLease(): Promise<void> {
    await this.#sessionOperation(async () => {
      const renew = this.input.shards.renew?.bind(this.input.shards);
      if (this.#current.kind !== "LEASED" || this.#stopped || renew === undefined) return;
      const renewed = await safelyValue(
        () => renew(this.#current as import("./delivery-ports.js").LeasedDeliveryWorkSession),
        undefined,
      );
      if (renewed === undefined) this.stop(new Error("Shard ownership was lost."));
      else this.#current = renewed;
    });
    if (!this.#stopped && this.#liveAgents.size > 0) this.#scheduleRenewal();
  }

  /**
   * Cancels the live lease timer after completion or loss.
   */
  #clearRenewal(): void {
    if (this.#renewalTimer !== undefined) clearTimeout(this.#renewalTimer);
    this.#renewalTimer = undefined;
  }

  /**
   * Executes delivery and releases the shard session.
   *
   * @returns The terminal delivery outcome and counts.
   */
  async run(): Promise<DeliveryRun> {
    let run: DeliveryRun;
    try {
      run = (await this.#canStart()) ? await this.#readPages() : this.#complete("STOPPED");
    } catch (error) {
      this.#reading = false;
      this.stop(error);
      await this.#release();
      throw error;
    }
    this.#reading = false;
    return (await this.#release()) ? run : this.#complete("FAILED");
  }

  /**
   * Removes the session and reports completion when release succeeds.
   *
   * @returns Whether the session was released.
   */
  async #release(): Promise<boolean> {
    if (this.#stopped || this.#ownershipLost || this.input.options.operation?.signal?.aborted)
      this.#agentController.abort();
    await Promise.allSettled(this.#liveAgents);
    this.#clearRenewal();
    let released = false;
    try {
      released = await this.#sessionOperation(() =>
        this.input.shards.release(this.#current, this.input.options.operation),
      );
    } catch (error) {
      this.#releaseFailure =
        error instanceof Error ? error : new Error("Shard release failed.", { cause: error });
    }
    if (!released && this.#releaseFailure === undefined)
      this.#releaseFailure = new Error("Shard release was not confirmed.");
    if (released) await safely(() => this.#completeMonitoring());
    return released;
  }

  /**
   * Checks whether monitoring permits this drain to start.
   *
   * @returns Whether page processing may start.
   */
  async #canStart(): Promise<boolean> {
    if (!(await safelyBoolean(() => this.input.monitor.shouldContinueAfter("DELIVERY"))))
      return false;
    return safely(() => this.input.monitor.onDeliveryStarted(this.input.shard));
  }

  /**
   * Reads and processes inbox pages until the shard is drained or stopped.
   *
   * @returns The terminal delivery outcome.
   */
  async #readPages(): Promise<DeliveryRun> {
    let after: import("./inbox.js").InboxReadContinuation | undefined;
    let deliveredInScan = false;
    let scanGeneration = this.#wakeGeneration;
    for (;;) {
      if (this.#stopped || this.#ownershipLost || this.input.options.operation?.signal?.aborted)
        return this.#complete("STOPPED");
      const wake = this.#wakeGate.promise;
      const messages = await this.#readPage(after);
      this.#removedInPage.clear();
      if (messages.length === 0) {
        if (await this.#emptyPageDrained(deliveredInScan, scanGeneration, wake))
          return this.#complete("DRAINED");
        after = undefined;
        deliveredInScan = false;
        scanGeneration = this.#wakeGeneration;
        continue;
      }
      const deliveredBefore = this.#statistics.delivered;
      if (!(await this.#processPage(messages))) return this.#complete("STOPPED");
      if (!(await this.#cleanupPage(messages))) return this.#complete("STOPPED");
      deliveredInScan ||= this.#statistics.delivered !== deliveredBefore;
      if (messages.length < this.input.pageSize) {
        if (await this.#shortPageDrained(deliveredInScan, scanGeneration, wake))
          return this.#complete("DRAINED");
        after = undefined;
        deliveredInScan = false;
        scanGeneration = this.#wakeGeneration;
        continue;
      }
      const survivor = messages.findLast((message) => !this.#removedInPage.has(message));
      if (survivor !== undefined) after = this.#continuation([survivor]);
    }
  }

  /**
   * Waits for admitted Agent work after an empty Inbox page.
   * @param deliveredInScan Whether the current scan delivered a row.
   * @param generation Wake generation captured before reading the page.
   * @param wake Notification that new work became ready.
   * @returns Whether the empty page ends this drain.
   */
  async #emptyPageDrained(
    deliveredInScan: boolean,
    generation: number,
    wake: Promise<void>,
  ): Promise<boolean> {
    if (generation !== this.#wakeGeneration) return false;
    if (this.#liveAgents.size > 0) {
      await Promise.race([...this.#liveAgents, wake]);
      return false;
    }
    return !deliveredInScan && this.#endScan(generation);
  }

  /**
   * Waits for live Agent work before deciding that a short page is drained.
   * @param deliveredInScan Whether the current scan delivered a row.
   * @param generation Wake generation captured before reading the page.
   * @param wake Notification that new work became ready.
   * @returns Whether the short page ends this drain.
   */
  async #shortPageDrained(
    deliveredInScan: boolean,
    generation: number,
    wake: Promise<void>,
  ): Promise<boolean> {
    if (deliveredInScan) return false;
    if (generation !== this.#wakeGeneration) return false;
    if (this.#liveAgents.size === 0) return this.#endScan(generation);
    await Promise.race([...this.#liveAgents, wake]);
    return false;
  }

  /**
   * Checks the terminal scan decision against a concurrent durable wake.
   *
   * @param generation Wake generation captured before reading the page.
   * @returns Whether this scan may finish without losing a notification.
   */
  #endScan(generation: number): boolean {
    if (generation !== this.#wakeGeneration) return false;
    this.#reading = false;
    return true;
  }

  /**
   * Reads the next inbox page after an optional continuation.
   *
   * @param after Supplies the prior page position, when present.
   * @returns The ordered inbox messages in the next page.
   */
  #readPage(after: import("./inbox.js").InboxReadContinuation | undefined) {
    return this.input.inbox.read(this.input.shard, {
      limit: this.input.pageSize,
      ...(after === undefined ? {} : { after }),
      ...(this.input.options.operation ?? {}),
    });
  }

  /**
   * Processes every message in one page.
   *
   * @param messages Supplies the inbox page to process.
   * @returns Whether page processing may continue.
   */
  async #processPage(messages: readonly InboxMessage[]): Promise<boolean> {
    const page = this.#deduplication.page(messages, this.#retentionTime());
    for (const message of messages) {
      if (!(await this.#processMessage(message, page))) return false;
      if (this.#failureLimitReached) return false;
    }
    return true;
  }

  /**
   * Processes one message unless it is skipped or its target is blocked.
   *
   * @param message Supplies the inbox message.
   * @param page Provides duplicate checks for this page.
   * @returns Whether processing may continue.
   */
  async #processMessage(message: InboxMessage, page: ReturnType<DeliveryDeduplication["page"]>) {
    if (this.#stopped || this.input.options.operation?.signal?.aborted) return false;
    if (this.#shouldSkip(message)) return true;
    try {
      const target = this.#targetKey(message);
      if (this.#blockedTargets.has(target)) return true;
      this.#statistics.processed += 1;
      if (!(await this.#mayProcess())) return false;
      if (page.isDuplicate(message)) {
        const continued = await this.#removeDuplicate(message, target);
        this.#reportOutcome(message);
        return continued;
      }
      return await this.#deliver(message, target);
    } finally {
      controlledMessageSettlers.get(this.input.options)?.(message);
    }
  }

  /**
   * Determines whether an inbox message is ineligible for endpoint delivery.
   *
   * @param message Supplies the message to check.
   * @returns Whether the message should be skipped.
   */
  #shouldSkip(message: InboxMessage): boolean {
    return (
      message.status !== "TO_DELIVER" ||
      !isEndpointMessage(message) ||
      (this.input.options.acceptMessage !== undefined && !this.input.options.acceptMessage(message))
    );
  }

  /**
   * Builds the key used to block further messages for one target.
   *
   * @param message Supplies the inbox message.
   * @returns The target type and ID key.
   */
  #targetKey(message: InboxMessage): string {
    return JSON.stringify([
      deliveryTenantKey(message),
      message.inboxId.targetTypeUrl,
      InboxTargets.key(message.inboxId.targetId),
    ]);
  }

  /**
   * Checks monitoring and verifies that the shard session remains current.
   *
   * @returns Whether this message may be processed.
   */
  async #mayProcess(): Promise<boolean> {
    return (
      (await safelyBoolean(() => this.input.monitor.shouldContinueAfter("PAGE"))) &&
      (await this.#validate())
    );
  }

  /**
   * Removes a duplicate message and records a failure if removal fails.
   *
   * @param message Supplies the duplicate message.
   * @param target Identifies the target to block after a failure.
   * @returns Whether processing may continue.
   */
  async #removeDuplicate(message: InboxMessage, target: string): Promise<boolean> {
    try {
      if (!(await this.input.inbox.removeDuplicate(message, this.input.options.operation)))
        throw new Error("Inbox duplicate was not removed.");
      this.#removedInPage.add(message);
      this.#messageOutcomes.set(message, { kind: "acknowledged", agent: false });
      this.input.options.onDuplicateRemoved?.(message);
    } catch (error) {
      this.#recordFailure(message, error);
      this.#blockedTargets.add(target);
    }
    return true;
  }

  /**
   * Delivers one message and records its outcome.
   *
   * @param message Supplies the inbox message.
   * @param target Identifies the message target.
   * @returns Whether processing may continue.
   */
  async #deliver(message: InboxMessage, target: string): Promise<boolean> {
    const acknowledgement: DeliveryAcknowledgement = { completed: false, exhausted: false };
    await this.#processAttempt(message, target, acknowledgement);
    this.#reportOutcome(message);
    return !this.#ownershipLost && !this.input.options.operation?.signal?.aborted;
  }

  /**
   * Records one selected row after its endpoint and monitor policy settle.
   * @param message Inbox row whose settled outcome is reported.
   */
  #reportOutcome(message: InboxMessage): void {
    const outcome = this.#messageOutcomes.get(message);
    if (outcome !== undefined) this.input.options.onMessageOutcome?.(message, outcome);
  }

  /**
   * Executes one dispatch attempt and the monitor-selected response to a receptor failure.
   *
   * @param message The persisted Inbox message.
   * @param target The target key used to isolate acknowledgement failure.
   * @param acknowledgement Shared status across immediate repeats.
   * @returns Completion of the attempt and its selected action.
   */
  async #processAttempt(
    message: InboxMessage,
    target: string,
    acknowledgement: DeliveryAcknowledgement,
  ): Promise<void> {
    const observation = receptionObservation.create();
    const generation = this.#wakeGeneration;
    try {
      const agent = await this.#dispatch(message, observation);
      if (agent === dispatchNotAdmitted) {
        acknowledgement.notAdmitted = true;
        return;
      }
      this.#statistics.accepted += 1;
      if (agent?.kind === "deferred") {
        this.#recordDeferred(message, target, generation);
        return;
      }
      if (agent?.kind === "error") {
        this.#recordFailure(message, agent.error);
        this.#blockedTargets.add(target);
        return;
      }
      if (agent?.kind === "accepted") {
        await this.#completeAgentAttempt(message, target, acknowledgement, agent);
        return;
      }
    } catch (error) {
      await this.#handleReceptionFailure(message, target, acknowledgement, observation, error);
      if (this.#ownershipLost || this.input.options.operation?.signal?.aborted) return;
    }
    await this.#completeAttempt(message, target, acknowledgement);
  }

  /**
   * Completes acknowledgement before starting an admitted Agent handler.
   * @param message Persisted Inbox row.
   * @param target Canonical target key.
   * @param acknowledgement Status shared with immediate repeats.
   * @param agent Admitted handler awaiting durable acknowledgement.
   * @returns Completion after acknowledgement and handler start or discard.
   */
  async #completeAgentAttempt(
    message: InboxMessage,
    target: string,
    acknowledgement: DeliveryAcknowledgement,
    agent: Extract<AgentDeliveryOutcome, { kind: "accepted" }>,
  ): Promise<void> {
    await this.#completeAttempt(message, target, acknowledgement);
    if (acknowledgement.completed) {
      this.#messageOutcomes.set(message, { kind: "acknowledged", agent: true });
      this.#startAgent(message, agent);
    } else agent.discard();
  }

  /**
   * Records a capacity deferral and revisits it if release raced with dispatch.
   * @param generation Wake generation captured before admission.
   * @param message Inbox row deferred for Agent capacity.
   * @param target Canonical target key blocked in this scan.
   */
  #recordDeferred(message: InboxMessage, target: string, generation: number): void {
    this.#messageOutcomes.set(message, { kind: "deferred" });
    this.#blockedTargets.add(target);
    this.#capacityBlockedTargets.add(target);
    if (generation !== this.#wakeGeneration) this.wake();
  }

  /**
   * Applies the original receptor monitor only to an actual receptor failure.
   * @param acknowledgement Status shared with repeated attempts.
   * @param error Original reception failure.
   * @param message Inbox row whose receptor failed.
   * @param observation Whether the receptor callback was entered.
   * @param target Canonical target key for acknowledgement.
   * @returns Completion of the monitor-selected failure action.
   */
  async #handleReceptionFailure(
    message: InboxMessage,
    target: string,
    acknowledgement: DeliveryAcknowledgement,
    observation: ReceptionObservation,
    error: unknown,
  ): Promise<void> {
    if (this.#ownershipLost || this.input.options.operation?.signal?.aborted) {
      this.#recordFailure(message, error);
      return;
    }
    if (!receptionObservation.isReceptorFailure(observation, error)) throw error;
    this.#recordFailure(message, error);
    const reception = new FailedReception(
      message,
      error,
      () => this.#acknowledgeOnce(message, acknowledgement),
      () => this.#processAttempt(message, target, acknowledgement),
    );
    const action = await this.input.monitor.onReceptionFailure(reception);
    await action.execute();
  }

  /**
   * Marks completed processing once, including nested repeat recovery.
   *
   * @param message The processed Inbox message.
   * @param target The target key used to isolate acknowledgement failure.
   * @param acknowledgement Shared status across immediate repeats.
   * @returns Completion after acknowledgement or exhausted retry containment.
   */
  async #completeAttempt(
    message: InboxMessage,
    target: string,
    acknowledgement: DeliveryAcknowledgement,
  ): Promise<void> {
    if (
      acknowledgement.completed ||
      acknowledgement.exhausted ||
      acknowledgement.notAdmitted ||
      this.input.options.operation?.signal?.aborted
    )
      return;
    if (!(await this.#validate())) return;
    try {
      await this.#acknowledgeWithRetry(message, acknowledgement);
    } catch (error) {
      acknowledgement.exhausted = true;
      this.#recordFailure(message, error);
      this.#blockedTargets.add(target);
    }
  }

  /**
   * Retries only durable acknowledgement after processing has completed.
   *
   * @param message Supplies the successfully processed message.
   * @param acknowledgement Shared status across immediate repeats.
   * @returns Completion after acknowledgement.
   */
  async #acknowledgeWithRetry(
    message: InboxMessage,
    acknowledgement: DeliveryAcknowledgement,
  ): Promise<void> {
    let firstError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.#acknowledgeOnce(message, acknowledgement);
        return;
      } catch (error) {
        firstError ??= error;
        if (this.#ownershipLost || this.input.options.operation?.signal?.aborted) break;
      }
    }
    throw firstError;
  }

  /**
   * Marks a message delivered after checking the shard session.
   *
   * @param message Supplies the inbox message to acknowledge.
   * @returns Completion after the message is marked delivered.
   */
  async #acknowledge(message: InboxMessage): Promise<void> {
    if (!(await this.#validate())) throw new Error("Shard ownership was lost.");
    await this.#markDelivered(message);
  }

  /**
   * Marks a message delivered once across nested monitor-selected repeats.
   *
   * @param message The message to mark delivered.
   * @param acknowledgement Shared status across immediate repeats.
   * @returns Completion after acknowledgement.
   */
  async #acknowledgeOnce(
    message: InboxMessage,
    acknowledgement: DeliveryAcknowledgement,
  ): Promise<void> {
    if (acknowledgement.completed) return;
    await this.#acknowledge(message);
    acknowledgement.completed = true;
  }

  /**
   * Dispatches a message while validating the shard session before the call.
   *
   * @param message Supplies the inbox message for the endpoint.
   * @param observation Records failure origin for this attempt.
   * @returns Completion after endpoint dispatch.
   */
  async #dispatch(
    message: InboxMessage,
    observation: ReceptionObservation,
  ): Promise<AgentDeliveryOutcome | typeof dispatchNotAdmitted | undefined> {
    const operation = this.input.options.operation?.signal;
    const signal =
      operation === undefined
        ? this.#agentController.signal
        : AbortSignal.any([this.#agentController.signal, operation]);
    const admission = { rejected: false };
    const outcome = await AgentDeliveryScope.run(
      () =>
        receptionObservation.run(observation, () =>
          withDeliveryCommitFence(
            async () => {
              if (!(await this.#validate())) throw new Error("Shard ownership was lost.");
            },
            () => {
              if (this.input.options.acceptMessage?.(message) === false) {
                admission.rejected = true;
                return Promise.resolve();
              }
              observation.entered = true;
              return Promise.resolve(this.input.options.onMessage(message));
            },
          ),
        ),
      signal,
    );
    return admission.rejected ? dispatchNotAdmitted : outcome;
  }

  /**
   * Records admitted Agent work under this shard session after Inbox acknowledgement.
   * @param agent Accepted Agent turn and discard callback.
   * @param message Acknowledged Inbox row.
   */
  #startAgent(
    message: InboxMessage,
    agent: Extract<AgentDeliveryOutcome, { kind: "accepted" }>,
  ): void {
    const operation = this.input.options.operation?.signal;
    const signal =
      operation === undefined
        ? this.#agentController.signal
        : AbortSignal.any([this.#agentController.signal, operation]);
    const checkSession = async () => {
      if (!(await this.#validate())) throw new Error("Shard ownership was lost.");
    };
    const work = Promise.resolve()
      .then(() => agent.run(signal, checkSession))
      .catch((error: unknown) => {
        this.#recordFailure(message, error);
      })
      .finally(() => {
        this.#liveAgents.delete(work);
        this.wake();
      });
    this.#liveAgents.add(work);
    this.#scheduleRenewal();
  }

  /**
   * Marks a message delivered and updates local counts and callbacks.
   *
   * @param message Supplies the inbox message to acknowledge.
   * @returns Completion after durable acknowledgement.
   */
  async #markDelivered(message: InboxMessage): Promise<void> {
    if ((await this.input.inbox.markDelivered(message, this.input.options.operation)) === undefined)
      throw new Error("Inbox message was not marked delivered.");
    this.#deduplication.recordDelivered(message);
    this.#statistics.delivered += 1;
    this.#messageOutcomes.set(message, { kind: "acknowledged", agent: false });
    try {
      this.input.options.onDelivered?.(message);
    } catch {
      // A post-ack observer cannot undo durable delivery or repeat processing.
    }
  }

  /**
   * Removes expired delivered messages from one page when supported.
   *
   * @param messages Supplies the inbox page to clean up.
   * @returns Whether cleanup completed while the session remained valid.
   */
  async #cleanupPage(messages: readonly InboxMessage[]): Promise<boolean> {
    if (this.input.inbox.removeDelivered === undefined) return true;
    if (!(await this.#validate())) return false;
    const now = this.#retentionTime().getTime();
    for (const message of messages) {
      if (
        message.status === "DELIVERED" &&
        (message.keepUntil === undefined || message.keepUntil.getTime() <= now)
      ) {
        const removed = await this.#removeDelivered(message);
        if (removed === undefined) return false;
        if (removed) this.#removedInPage.add(message);
      }
    }
    return true;
  }

  /**
   * Removes one expired delivered message when supported.
   *
   * @param message Supplies the delivered message to remove.
   * @returns Whether the row was removed, or undefined if the session was lost.
   */
  async #removeDelivered(message: InboxMessage): Promise<boolean | undefined> {
    if (this.input.inbox.removeDelivered === undefined) return false;
    if (this.input.options.operation?.signal?.aborted || !(await this.#validate()))
      return undefined;
    const removed = await this.input.inbox.removeDelivered(message, this.input.options.operation);
    return removed;
  }

  /**
   * Creates the continuation following the last message in a page.
   *
   * @param messages Supplies the non-empty inbox page.
   * @returns The continuation identifying its last message.
   */
  #continuation(messages: readonly InboxMessage[]): import("./inbox.js").InboxReadContinuation {
    const last = messages.at(-1);
    if (last === undefined) throw new Error("Inbox page has no continuation.");
    return { messageId: last.id.value, whenReceived: last.whenReceived, version: last.version };
  }

  /**
   * Reads the inbox retention clock or the current time.
   *
   * @returns The time used to evaluate message retention.
   */
  #retentionTime(): Date {
    return this.input.inbox instanceof Inbox
      ? InboxStorageClock.read(this.input.inbox.storage)
      : new Date(Time.currentTimeMillis());
  }

  /**
   * Checks the shard session and records when it is lost.
   *
   * @returns Whether the shard session remains valid.
   */
  async #validate(): Promise<boolean> {
    return this.#sessionOperation(async () => {
      if (this.#stopped || this.#ownershipLost) return false;
      const current = await safelyValue(
        () => this.input.shards.validateOwnership(this.#current, this.input.options.operation),
        undefined,
      );
      if (current === undefined) {
        this.#ownershipLost = true;
        this.stop(new Error("Shard ownership was lost."));
      } else this.#current = current;
      return current !== undefined;
    });
  }

  /**
   * Records an ephemeral delivery failure up to the configured limit.
   *
   * @param message Supplies the failed inbox message.
   * @param error Supplies the observed failure.
   */
  #recordFailure(message: InboxMessage, error: unknown): void {
    this.#statistics.failed += 1;
    if (this.#messageOutcomes.get(message)?.kind !== "acknowledged")
      this.#messageOutcomes.set(message, { kind: "failed", error });
    if (this.#failures.length < deliveryFailureLimit)
      this.#failures.push(Object.freeze({ message: snapshot(message), error }));
    this.#failureLimitReached = this.#failures.length === deliveryFailureLimit;
  }

  /**
   * Creates a terminal result from the current counters and failures.
   *
   * @param status Identifies the terminal delivery outcome.
   * @returns The immutable delivery result.
   */
  #complete(status: DeliveryRun["status"]): DeliveryRun {
    this.#reading = false;
    return result(status, this.#statistics, this.#failures);
  }

  /**
   * Sends delivery completion to the monitor.
   *
   * @returns Completion after the monitor callback settles.
   */
  #completeMonitoring(): Promise<void> {
    return Promise.resolve(
      this.input.monitor.onDeliveryCompleted(
        Object.freeze({
          processed: this.#statistics.processed,
          delivered: this.#statistics.delivered,
          failed: this.#statistics.failed,
        } satisfies DeliveryStatistics),
      ),
    );
  }
}

interface DeliveryDrainInputState {
  readonly inbox: DeliveryInbox;
  readonly monitor: DeliveryMonitor;
  readonly options: DeliveryDrainOptions;
  readonly pageSize: number;
  readonly session: DeliveryWorkSession;
  readonly shard: ShardIndex;
  readonly shards: DeliveryWorkRegistry;
}

/**
 * Configures one direct delivery owner.
 */
export interface DeliveryOptions {
  // prettier-ignore

  /**
   * Identifies the storage namespace.
   */
  readonly context: StorageContext;

  /**
   * Supplies durable record storage.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Receives contained diagnostics for detached local shard runs.
   */
  readonly logger?: ILogLayer;

  /**
   * Supplies direct shard ownership when customized.
   */
  readonly workRegistry?: DeliveryWorkRegistry;

  /**
   * Supplies direct Inbox access when customized.
   */
  readonly inbox?: DeliveryInbox;

  /**
   * Maps targets to shards when customized.
   */
  readonly strategy?: DeliveryStrategy;

  /**
   * Supplies delivery lifecycle and failure policy hooks.
   */
  readonly monitor?: DeliveryMonitor;

  /**
   * Supplies a complete opaque worker identity.
   */
  readonly worker?: WorkerId;

  /**
   * Names the node used to derive a default worker identity.
   */
  readonly node?: string;

  /**
   * Bounds each direct Inbox read.
   */
  readonly pageSize?: number;
}

/**
 * Configures one direct shard drain.
 */
export interface DeliveryDrainOptions {
  // prettier-ignore

  /**
   * Dispatches supported Inbox messages.
   */
  readonly onMessage: OnDeliveryMessage;

  /**
   * Observes a selected row only after its full attempt policy settles.
   *
   * @param message Inbox row with a settled outcome.
   * @param outcome Acknowledged, deferred, or failed result for that row.
   * @internal
   */
  readonly onMessageOutcome?: (message: InboxMessage, outcome: DeliveryMessageOutcome) => void;

  /**
   * Observes a durable delivered transition.
   *
   * @param message Contains the acknowledged Inbox message.
   * @internal
   */
  readonly onDelivered?: (message: InboxMessage) => void;

  /**
   * Observes successful removal of a duplicate Inbox message.
   *
   * @param message Contains the removed duplicate.
   * @internal
   */
  readonly onDuplicateRemoved?: (message: InboxMessage) => void;

  /**
   * Determines whether this drain callback owns a message.
   *
   * @param message Contains a pending Inbox message.
   * @returns `true` when the callback owns the message.
   * @internal
   */
  readonly acceptMessage?: (message: InboxMessage) => boolean;

  /**
   * Propagates cancellation through the drain.
   */
  readonly operation?: import("./delivery-ports.js").DeliveryOperationOptions;
}
function workerId(node: string): WorkerId {
  return create(WorkerIdSchema, { nodeId: { value: node }, value: randomUUID() });
}
function snapshotWorker(worker: WorkerId): WorkerId {
  return Object.freeze({
    nodeId: Object.freeze({ value: worker.nodeId?.value ?? "" }),
    value: worker.value,
  }) as WorkerId;
}
function counts() {
  return { processed: 0, accepted: 0, delivered: 0, failed: 0 };
}
function result(
  status: DeliveryRun["status"],
  value = counts(),
  failures: readonly DeliveryFailure[] = [],
): DeliveryRun {
  const run = Object.freeze({ status, ...value, failures: Object.freeze([...failures]) });
  return run;
}
function snapshot(message: InboxMessage): InboxMessage {
  return Object.freeze({
    ...message,
    id: Object.freeze({
      ...message.id,
      shard: new ShardIndex(message.id.shard.index, message.id.shard.ofTotal),
    }),
    inboxId: Object.freeze({ ...message.inboxId }),
    ...(message.signal === undefined ? {} : { signal: clone(AnySchema, message.signal) }),
    shard: new ShardIndex(message.shard.index, message.shard.ofTotal),
    whenReceived: clone(TimestampSchema, message.whenReceived),
    ...(message.keepUntil === undefined ? {} : { keepUntil: new Date(message.keepUntil) }),
  });
}
async function safely(action: () => void | Promise<void>): Promise<boolean> {
  try {
    await action();
    return true;
  } catch {
    return false;
  }
}
async function safelyBoolean(action: () => boolean | Promise<boolean>): Promise<boolean> {
  try {
    return await action();
  } catch {
    return false;
  }
}

/**
 * Returns an action result or a fallback when the action fails.
 *
 * @typeParam T Action result type.
 * @param action Supplies the action to run.
 * @param fallback Supplies the result to use after failure.
 * @returns The action result or fallback value.
 */
async function safelyValue<T>(action: () => T | Promise<T>, fallback: T): Promise<T> {
  try {
    return await action();
  } catch {
    return fallback;
  }
}
function isEndpointMessage(message: InboxMessage): boolean {
  return (
    message.label === "HANDLE_COMMAND" ||
    message.label === "UPDATE_SUBSCRIBER" ||
    message.label === "REACT_UPON_EVENT"
  );
}

/**
 * Tracks recently delivered messages for one inbox.
 */
class DeliveryDeduplication {
  readonly #recent: RecentDeliveries;

  /**
   * Creates or reuses recent delivery state for the supplied inbox.
   *
   * @param inbox Supplies the inbox used as the deduplication key.
   */
  constructor(inbox: DeliveryInbox) {
    const current = recentDeliveries.get(inbox);
    this.#recent = current ?? new RecentDeliveries();
    if (current === undefined) recentDeliveries.set(inbox, this.#recent);
  }

  /**
   * Creates duplicate checks for one page and retention time.
   *
   * @param messages Supplies the messages in the page.
   * @param now Supplies the time used to check message retention.
   * @returns Duplicate checks for the page.
   */
  page(messages: readonly InboxMessage[], now: Date): DeliveryPageDeduplication {
    return new DeliveryPageDeduplication(messages, this.#recent, now);
  }

  /**
   * Records a message as recently delivered.
   *
   * @param message Supplies the delivered message.
   */
  recordDelivered(message: InboxMessage): void {
    this.#recent.add(message);
  }
}

/**
 * Checks duplicates within a page and the recent-delivery cache.
 */
class DeliveryPageDeduplication {
  readonly #identities: Set<string>;

  /**
   * Creates duplicate checks from retained messages in one page.
   *
   * @param messages Supplies the inbox page.
   * @param recent Provides recently delivered message identities.
   * @param now Supplies the time used to check message retention.
   */
  constructor(
    messages: readonly InboxMessage[],
    private readonly recent: RecentDeliveries,
    now: Date,
  ) {
    this.#identities = new Set(
      messages
        .filter(
          (message) =>
            message.status === "DELIVERED" &&
            message.keepUntil !== undefined &&
            message.keepUntil.getTime() > now.getTime(),
        )
        .map((message) => RecentDeliveries.key(message)),
    );
  }

  /**
   * Checks whether a message appeared earlier in the page or cache.
   *
   * @param message Supplies the message to check.
   * @returns Whether this message is a duplicate.
   */
  isDuplicate(message: InboxMessage): boolean {
    const identity = RecentDeliveries.key(message);
    if (this.#identities.has(identity) || this.recent.has(identity)) return true;
    this.#identities.add(identity);
    return false;
  }
}

/**
 * Stores a bounded set of recently delivered message identities.
 */
class RecentDeliveries {
  readonly #identities = new Map<string, undefined>();

  /**
   * Checks whether an identity is in the recent-delivery set.
   *
   * @param identity Supplies the encoded message identity.
   * @returns Whether that identity is present.
   */
  has(identity: string): boolean {
    return this.#identities.has(identity);
  }

  /**
   * Adds a message identity and removes the oldest entry when over capacity.
   *
   * @param message Supplies the delivered message.
   */
  add(message: InboxMessage): void {
    const identity = RecentDeliveries.key(message);
    this.#identities.delete(identity);
    this.#identities.set(identity, undefined);
    if (this.#identities.size > 1_000) {
      const oldest = this.#identities.keys().next().value;
      if (oldest !== undefined) this.#identities.delete(oldest);
    }
  }

  /**
   * Creates the identity key used for recent-delivery checks.
   *
   * @param message Supplies the message to identify.
   * @returns The serialized message identity.
   */
  static key(message: InboxMessage): string {
    return JSON.stringify([
      deliveryTenantKey(message),
      message.signalId,
      message.inboxId.targetTypeUrl,
      InboxTargets.key(message.inboxId.targetId),
    ]);
  }
}

const recentDeliveries = new WeakMap<DeliveryInbox, RecentDeliveries>();
