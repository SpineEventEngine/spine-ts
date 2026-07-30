import type { StorageContext, StorageFactory } from "@spine-event-engine/storage";
import { clone } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";

import {
  DeliveryAttempts,
  deliveryAttemptCapacity,
  type DeliveryFailureReason,
  type DeliveryFailureStage,
} from "./delivery-attempts.js";
import { DeliveryStorageCorruptionError } from "./delivery-storage-error.js";
import { DeliveryLoop, type DeliveryLoopRun } from "./delivery-loop.js";
import {
  Inbox,
  InboxMessageError,
  type InboxMessage,
  type InboxReadContinuation,
} from "./inbox.js";
import { inboxStorageAccess, InboxStorage } from "./inbox-storage.js";
import { DeliveryLeases } from "./delivery-lease.js";
import { DeliveryRetryDecisions, type DeliveryRetryDecision } from "./delivery-retry-decision.js";
import { ShardIndex } from "./shard-index.js";
import { ShardedWorkRegistry } from "./sharded-work-registry.js";
import type {
  DeliveryInbox,
  DeliveryInboxWork,
  DeliveryOperationOptions,
  DeliveryWorkRegistry,
  DeliveryWorkSession,
} from "./delivery-ports.js";
import type {
  DeliveryMonitor,
  DeliveryPage,
  DeliveryResult,
  DeliveryRunOptions,
  DeliveryStrategy,
} from "./delivery-builder.js";

/** Delivery owner for inbox storage and shard registry. */
export class Delivery {
  readonly #context: StorageContext;
  readonly #leaseMs: number;
  readonly #now: () => Date;
  readonly #storageFactory: StorageFactory;

  /** Immutable storage namespace selected for this delivery. */
  readonly context: StorageContext;
  /** Immutable storage factory selected for this delivery. */
  readonly storageFactory: StorageFactory;
  /** Immutable target-to-shard strategy selected for this delivery. */
  readonly strategy: DeliveryStrategy;
  /** Node identity selected for finite local runs. */
  readonly node: string;
  /** Positive accepted-work bound for one public delivery page. */
  readonly pageSize: number;
  /** Positive page bound for one public finite local run. */
  readonly batchSize: number;
  readonly #monitor: DeliveryMonitor | undefined;

  /** Durable inbox facade. */
  readonly inbox: DeliveryInbox;
  /** Internal retained delivery attempt history. */
  readonly attempts: DeliveryAttempts;
  /** Storage-backed shard registry. */
  readonly shards: DeliveryWorkRegistry;

  /**
   * Opens delivery from one storage context and factory.
   *
   * @param options The durable delivery configuration.
   */
  constructor(options: DeliveryOptions) {
    const context = DeliveryValues.copyStorageContext(options.context);
    this.#context = context;
    this.#leaseMs = DeliveryLeases.requireMs("Delivery", options.leaseMs ?? defaultShardLeaseMs);
    this.#now = options.now ?? (() => new Date());
    this.#storageFactory = options.storageFactory;
    this.context = context;
    this.storageFactory = options.storageFactory;
    this.strategy = options.strategy ?? singleShardStrategy;
    this.node = options.node ?? "local";
    this.pageSize = options.pageSize ?? defaultPageSize;
    this.batchSize = options.batchSize ?? defaultBatchSize;
    this.#monitor = options.monitor;
    this.inbox =
      options.inbox ??
      new Inbox(
        new InboxStorage({
          context,
          storageFactory: options.storageFactory,
          now: this.#now,
        }),
      );
    this.attempts = new DeliveryAttempts({
      context,
      storageFactory: options.storageFactory,
    });
    this.shards =
      options.workRegistry ??
      new ShardedWorkRegistry({
        context,
        storageFactory: options.storageFactory,
        leaseMs: this.#leaseMs,
        now: this.#now,
      });
    deliveryDrainers.set(this, (shard, options, controls) => this.#drain(shard, options, controls));
    Object.freeze(this);
  }

  /**
   * Processes one shard through the framework-owned direct worker boundary.
   *
   * The drain first picks up the shard with lease fencing, then scans
   * `TO_DELIVER` rows in inbox order. `limit` bounds accepted endpoint work;
   * newly observed rows stop at the storage read cap plus `limit` while the
   * drain advances past unavailable rows with keyset continuations before
   * endpoint invocation. The `onMessage` endpoint
   * receives a public `DeliveryEndpointMessage` snapshot only for supported
   * worker labels: `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`, and
   * `REACT_UPON_EVENT`.
   * Worker-unsupported labels remain pending and are skipped before callback
   * invocation, row acceptance, failure recording, or failure-budget
   * consumption. Malformed or deprecated legacy label data remains a true
   * fail-closed storage-corruption path.
   *
   * The returned `DeliveryRun` reports whether the shard was drained or
   * skipped, how many rows were read, accepted for work, delivered, or failed,
   * and the per-message failures observed during this run. Supported endpoint
   * failures also retain a bounded, sanitized internal attempt history. Before
   * a supported endpoint callback, this method applies the fixed package-
   * internal 100-attempt exhaustion gate for that exact inbox message.
   * Exhausted rows skip the callback and another attempt, then use an exact-row
   * claim synchronized to the live shard fence to mark the row delivered. If
   * lease/fencing fails through the final guard before durable marking begins,
   * the run retains one bounded `LEASE` / `LEASE_INACTIVE` attempt, reports one
   * failure with no accepted work, and leaves the row pending. If
   * an exhaustion-time mark fails and claim cleanup succeeds, the row remains
   * pending and contributes one frozen, bounded, stack-free facts object. If
   * cleanup also fails, the run instead preserves one `CLEANUP` result whose
   * `AggregateError` contains the mark and cleanup errors; that error is not
   * promised to be frozen, bounded, or stack-free. Either path counts as one
   * failure. The gate is not configurable or a public retry policy: this method
   * does not schedule later runs, open transports, or implement backoff.
   *
   * @param shard The shard to pick up and drain.
   * @param options The endpoint, node, and optional operation controls.
   * @returns The bounded direct-drain result.
   */
  async drain(shard: ShardIndex, options: DeliveryDrainOptions): Promise<DeliveryRun> {
    const outcome = await this.#drain(shard, options, {});

    return outcome.run;
  }

  /**
   * Executes one shard through the configured finite local page boundary.
   *
   * @param options The shard and endpoint callback.
   * @returns The terminal finite-run result.
   */
  async run(options: DeliveryRunOptions): Promise<DeliveryResult> {
    return this.#run(options);
  }

  /**
   * Executes with package-owned operation fencing while preserving public `run()` behavior.
   *
   * @param options The controlled shard run.
   * @returns The terminal finite-run result.
   */
  async runControlled(
    options: import("./delivery-run-control.js").DeliveryControlledRun,
  ): Promise<DeliveryResult> {
    return this.#run(options, { signal: options.signal }, true);
  }

  async #run(
    options: DeliveryRunOptions,
    operation?: DeliveryOperationOptions,
    completeAdmittedEmptyEpoch = false,
  ): Promise<DeliveryResult> {
    if (options.shard !== undefined && options.shard.ofTotal !== this.strategy.shardCount) {
      throw new Error("Delivery run shard total must equal the configured strategy shard count.");
    }
    if (options.shard === undefined && this.strategy.shardCount > 1) {
      throw new Error("Delivery run requires an explicit shard for a multi-shard strategy.");
    }
    const shard = options.shard ?? ShardIndex.single();
    const pages: DeliveryPage[] = [];
    let started = false;
    const loop = new DeliveryLoop({
      delivery: this,
      shard,
      node: this.node,
      limit: this.pageSize,
      onMessage: options.onMessage,
      ...(operation === undefined ? {} : { operation }),
      ...(completeAdmittedEmptyEpoch ? { completeAdmittedEmptyEpoch: true } : {}),
      onStarted: () => {
        if (!started) {
          this.#monitor?.onStarted?.(shard);
          started = true;
        }
      },
    });
    for (let index = 0; index < this.batchSize; index += 1) {
      const loopRun = await loop.run();
      const page = DeliveryPages.fromLoop(loopRun);
      pages.push(page);
      if (loopRun.status === "SKIPPED") {
        this.#monitor?.onSkipped?.(shard);
        return this.#complete("SKIPPED", pages);
      }
      const continueRun = this.#monitor?.onPage?.(page);
      if (page.failed > 0) {
        this.#monitor?.onFailure?.(page);
        return this.#complete("FAILED", pages);
      }
      if (continueRun === false) {
        return this.#complete("STOPPED", pages);
      }
      if (loopRun.status === "STOPPED") {
        return this.#complete("STOPPED", pages);
      }
      if (loopRun.status === "IDLE" && loopRun.processed < inboxStorageAccess.maxReadLimit) {
        return this.#complete("COMPLETED", pages);
      }
    }
    return this.#complete("PAUSED", pages);
  }

  #complete(status: DeliveryResult["status"], pages: readonly DeliveryPage[]): DeliveryResult {
    const result = Object.freeze({ status, pages: Object.freeze([...pages]) });
    this.#monitor?.onCompleted?.(result);
    return result;
  }

  async #drain(
    shard: ShardIndex,
    options: DeliveryDrainOptions,
    controls: DeliveryDrainControls,
  ): Promise<DeliveryDrainOutcome> {
    const scope = this.#drainScope();
    const limit = inboxStorageAccess.readLimit(options.limit);
    const maxFailures = DeliveryValues.requireFailureLimit(controls.maxFailures);
    const fence = deliveryOperations.fence(options.operation);
    fence.requireActive();
    const session = await scope.shards.pickUp(shard, options.node, options.operation);
    if (session === undefined) {
      return DeliveryRunValues.deliveryDrainOutcome(
        DeliveryRunValues.deliveryRun("SKIPPED", 0, 0, 0, 0, []),
      );
    }
    const active = new ActiveWork();
    const lease = DeliveryRunValues.keepShardLease(
      scope.shards,
      session,
      this.#leaseMs,
      () => this.#now().getTime(),
      {
        onRenewWork: (next) => active.renew(next, options.operation),
        ...(options.operation === undefined ? {} : { operation: options.operation }),
      },
    );

    try {
      controls.onStarted?.();
      if (controls.epoch !== undefined) {
        return await this.#drainAdmittedMessages(
          scope.inbox,
          scope.attempts,
          limit,
          options.onMessage,
          lease,
          active,
          controls.epoch,
          maxFailures,
          fence,
        );
      }
      const cursor = this.#resolveDrainCursor(controls.resume);

      return await this.#drainAvailableMessages(
        scope.inbox,
        scope.attempts,
        session.shard,
        limit,
        options.onMessage,
        lease,
        active,
        cursor,
        maxFailures,
        fence,
      );
    } finally {
      await lease.close();
      await scope.shards.release(session, options.operation);
    }
  }

  async #drainAdmittedMessages(
    inbox: DeliveryInbox,
    attempts: DeliveryAttempts,
    limit: number,
    onMessage: OnDeliveryMessage,
    lease: ShardLeaseKeeper,
    active: ActiveWork,
    epoch: DeliveryEpochSlice,
    maxFailures: number | undefined,
    fence: DeliveryOperationFence,
  ): Promise<DeliveryDrainOutcome> {
    const progress = DeliveryRunValues.drainProgress();
    const scanBudget = inboxStorageAccess.maxReadLimit + limit;
    const initial = epoch.next;
    let next = initial;
    let examined = 0;

    while (next < epoch.messages.length && examined < scanBudget) {
      const message = epoch.messages[next];
      if (message === undefined) {
        throw new Error("Delivery epoch progress is invalid.");
      }
      next += 1;
      examined += 1;

      await this.#tryDrainMessage(
        inbox,
        attempts,
        progress,
        message,
        onMessage,
        lease,
        active,
        fence,
      );
      if (progress.accepted >= limit) {
        break;
      }
      if (maxFailures !== undefined && progress.failed >= maxFailures) {
        break;
      }
    }

    const safeNext = progress.failed === 0 ? next : initial;
    const complete = safeNext >= epoch.messages.length;
    const run = progress.finish({}).run;

    return Object.freeze({
      run,
      exhaustedSkippedScan:
        !complete && run.accepted === 0 && run.delivered === 0 && run.failed === 0,
      epochProgress: Object.freeze({ next: safeNext, complete }),
    });
  }

  async #drainAvailableMessages(
    inbox: DeliveryInbox,
    attempts: DeliveryAttempts,
    shard: ShardIndex,
    limit: number,
    onMessage: OnDeliveryMessage,
    lease: ShardLeaseKeeper,
    active: ActiveWork,
    cursor: DeliveryDrainCursor,
    maxFailures: number | undefined,
    fence: DeliveryOperationFence,
  ): Promise<DeliveryDrainOutcome> {
    const progress = DeliveryRunValues.drainProgress();
    const scanBudget = inboxStorageAccess.maxReadLimit + limit;
    const scan = new DeliveryScanState(cursor);

    while (progress.processed < scanBudget) {
      const readLimit = scan.readLimit(scanBudget, progress.processed);
      fence.requireActive();
      const messages = await this.#readPendingDeliveryPage(
        inbox,
        shard,
        readLimit,
        scan.after,
        fence.options,
      );

      const pageOutcome = await this.#drainPendingPage(
        inbox,
        attempts,
        progress,
        scan,
        scanBudget,
        messages,
        onMessage,
        lease,
        active,
        limit,
        maxFailures,
        fence,
      );
      if (pageOutcome !== undefined) {
        return pageOutcome;
      }

      if (messages.length < readLimit) {
        return progress.finish(
          scan.finishShortPage(progress.accepted, progress.failed),
          scan.shouldRescanHead(progress.accepted, progress.failed),
        );
      }
    }

    return this.#finishExhaustedSkippedScan(progress, scan);
  }

  async #drainPendingPage(
    inbox: DeliveryInbox,
    attempts: DeliveryAttempts,
    progress: DrainProgress,
    scan: DeliveryScanState,
    scanBudget: number,
    messages: readonly InboxMessage[],
    onMessage: OnDeliveryMessage,
    lease: ShardLeaseKeeper,
    active: ActiveWork,
    limit: number,
    maxFailures: number | undefined,
    fence: DeliveryOperationFence,
  ): Promise<DeliveryDrainOutcome | undefined> {
    for (const message of messages) {
      const accepted = progress.accepted;
      if (progress.hasSeen(message)) {
        return this.#finishExhaustedSkippedScan(progress, scan);
      } else if (progress.processed >= scanBudget) {
        return this.#finishExhaustedSkippedScan(progress, scan);
      }

      await this.#tryDrainMessage(
        inbox,
        attempts,
        progress,
        message,
        onMessage,
        lease,
        active,
        fence,
      );
      scan.advancePast(message);
      if (progress.accepted > accepted && scan.hasResumedCursor()) {
        scan.rewindToHead();
      }
      if (progress.accepted >= limit) {
        return progress.finish(scan.cursor());
      }
      if (maxFailures !== undefined && progress.failed >= maxFailures) {
        return progress.finish(scan.cursor());
      }
    }

    return undefined;
  }

  #finishExhaustedSkippedScan(
    progress: DrainProgress,
    scan: DeliveryScanState,
  ): DeliveryDrainOutcome {
    return progress.finish(scan.cursor(), true);
  }

  async #readPendingDeliveryPage(
    inbox: DeliveryInbox,
    shard: ShardIndex,
    limit: number,
    after: InboxReadContinuation | undefined,
    operation: DeliveryOperationOptions | undefined,
  ): Promise<readonly InboxMessage[]> {
    return inbox.read(shard, {
      statuses: ["TO_DELIVER"],
      limit,
      ...(after === undefined ? {} : { after }),
      ...(operation ?? {}),
    });
  }

  /**
   * Processes one exact pending inbox message through the local worker boundary.
   *
   * Local framework handoffs use this when the caller has just written a
   * durable row and must not run unrelated pending rows from the same shard.
   * The message shard is picked up with lease fencing; if the row is already
   * unavailable or unsupported by this worker, no endpoint callback runs.
   * Supported callbacks are limited to `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`,
   * and `REACT_UPON_EVENT`.
   *
   * The returned `DeliveryRun` uses the same counters as `drain()`, scoped to
   * this single row.
   *
   * @param message The pending inbox message.
   * @param options The node and endpoint callback.
   * @returns The exact-message drain result.
   */
  async drainMessage(
    message: InboxMessage,
    options: DeliveryMessageDrainOptions,
  ): Promise<DeliveryRun> {
    const scope = this.#drainScope();
    const shard = DeliveryValues.requireMessageShard(message);
    const id = Object.freeze({
      value: message.id.value,
      shard,
    });
    const session = await scope.shards.pickUp(shard, options.node);
    if (session === undefined) {
      return DeliveryRunValues.deliveryRun("SKIPPED", 0, 0, 0, 0, []);
    }
    const active = new ActiveWork();
    const lease = DeliveryRunValues.keepShardLease(
      scope.shards,
      session,
      this.#leaseMs,
      () => this.#now().getTime(),
      { onRenewWork: (next) => active.renew(next) },
    );

    try {
      if (!DeliveryValues.sameShard(session.shard, shard)) {
        throw new InboxMessageError("Inbox message lease shard does not match message shard.");
      }

      const pending = await this.#readPendingMessage(scope.inbox, id, shard);
      if (pending === undefined) {
        return DeliveryRunValues.deliveryRun("DRAINED", 0, 0, 0, 0, []);
      }

      return await this.#drainExactMessage(
        scope.inbox,
        scope.attempts,
        pending,
        options.onMessage,
        lease,
        active,
      );
    } finally {
      await lease.close();
      await scope.shards.release(session);
    }
  }

  async #readPendingMessage(
    inbox: DeliveryInbox,
    id: InboxMessage["id"],
    shard: ShardIndex,
  ): Promise<InboxMessage | undefined> {
    const pending = await inbox.readMessage(id);
    if (pending?.status !== "TO_DELIVER") {
      return undefined;
    }
    const pendingShard = DeliveryValues.requireMessageShard(pending);
    if (!DeliveryValues.sameShard(pendingShard, shard)) {
      throw new InboxMessageError("Inbox message row shard does not match message shard.");
    }

    return pending;
  }

  async #drainExactMessage(
    inbox: DeliveryInbox,
    attempts: DeliveryAttempts,
    message: InboxMessage,
    onMessage: OnDeliveryMessage,
    lease: ShardLeaseKeeper,
    active: ActiveWork,
  ): Promise<DeliveryRun> {
    if (!DeliveryValues.isEndpointLabel(message.label)) {
      return DeliveryRunValues.deliveryRun("DRAINED", 1, 0, 0, 0, []);
    }

    DeliveryValues.requireEndpointStatus(message.status);
    const retry = await this.#decideRetry(attempts, message.id);
    if (retry.kind === "EXHAUSTED") {
      const action = await this.#markExhaustedDelivered(
        inbox,
        message,
        retry,
        lease,
        active,
        deliveryOperations.fence(undefined),
      );
      await this.#recordExhaustedActionFailure(attempts, message, action);
      if (action.kind === "SKIPPED") {
        return DeliveryRunValues.deliveryRun("DRAINED", 1, 0, 0, 0, []);
      }
      if (action.kind === "DELIVERED") {
        return DeliveryRunValues.deliveryRun("DRAINED", 1, 0, 1, 0, []);
      }

      return DeliveryRunValues.deliveryRun("DRAINED", 1, 0, 0, 1, [
        Object.freeze({
          message: DeliveryValues.exhaustedFailureMessage(message),
          error: action.error,
        }),
      ]);
    }

    const endpoint = DeliveryValues.requireEndpointMessage(message);
    const attempt = await this.#deliverMessage(
      inbox,
      endpoint,
      onMessage,
      lease,
      active,
      deliveryOperations.fence(undefined),
    );
    if (attempt.kind === "SKIPPED") {
      return DeliveryRunValues.deliveryRun("DRAINED", 1, 0, 0, 0, []);
    }
    if (attempt.kind === "DELIVERED") {
      return DeliveryRunValues.deliveryRun("DRAINED", 1, 1, 1, 0, []);
    }

    await this.#recordFailedAttempt(attempts, endpoint, attempt);
    const failures = [Object.freeze({ message: endpoint, error: attempt.error })];

    return DeliveryRunValues.deliveryRun("DRAINED", 1, attempt.accepted ? 1 : 0, 0, 1, failures);
  }

  async #deliverMessage(
    inbox: DeliveryInbox,
    message: DeliveryEndpointMessage,
    onMessage: OnDeliveryMessage,
    lease: ShardLeaseKeeper,
    active: ActiveWork,
    fence: DeliveryOperationFence,
  ): Promise<DeliveryMessageResult> {
    let stage: DeliveryFailureStage = "CLAIM";

    try {
      const work = await this.#beginMessageDelivery(inbox, message, lease, fence);
      if (work === undefined) {
        return { kind: "SKIPPED" };
      }

      active.set(work);
      stage = "LEASE";
      await this.#synchronizeActiveWork(lease, active, fence);
      stage = "ENDPOINT";
      await this.#invokeEndpoint(work.message, onMessage, lease, active, fence);
      stage = "STATUS_UPDATE";
      await this.#completeActiveWork(message, lease, active, undefined, fence);

      return { kind: "DELIVERED" };
    } catch (error) {
      const cleanup = await this.#clearFailedWork(error, active, fence.options);
      const failedStage = cleanup.cleanupFailed
        ? "CLEANUP"
        : DeliveryRunValues.deliveryFailureStage(stage, active.callbackAccepted());

      return Object.freeze({
        kind: "FAILED" as const,
        accepted: active.callbackAccepted(),
        error: cleanup.error,
        node: DeliverySessionValues.sessionNode(lease.session()),
        stage: failedStage,
        reason: DeliveryRunValues.deliveryFailureReason(failedStage),
      });
    } finally {
      active.clear();
    }
  }

  async #markExhaustedDelivered(
    inbox: DeliveryInbox,
    message: InboxMessage,
    retry: DeliveryRetryDecision,
    lease: ShardLeaseKeeper,
    active: ActiveWork,
    fence: DeliveryOperationFence,
  ): Promise<DeliveryMessageResult> {
    const failure: { stage: DeliveryFailureStage } = { stage: "CLAIM" };

    try {
      const work = await this.#beginMessageDelivery(inbox, message, lease, fence);
      if (work === undefined) {
        return { kind: "SKIPPED" };
      }

      active.set(work);
      failure.stage = "LEASE";
      await this.#synchronizeActiveWork(lease, active, fence);
      await this.#completeActiveWork(
        message,
        lease,
        active,
        () => {
          failure.stage = "STATUS_UPDATE";
        },
        fence,
      );

      return { kind: "DELIVERED" };
    } catch (error) {
      const cleanup = await this.#clearFailedWork(error, active, fence.options);
      const failedStage: DeliveryFailureStage = cleanup.cleanupFailed ? "CLEANUP" : failure.stage;
      const failureError =
        failedStage === "STATUS_UPDATE"
          ? DeliveryRunValues.retryExhaustedMarkFailure(retry)
          : cleanup.error;

      return Object.freeze({
        kind: "FAILED" as const,
        accepted: false,
        error: failureError,
        node: DeliverySessionValues.sessionNode(lease.session()),
        stage: failedStage,
        reason: DeliveryRunValues.deliveryFailureReason(failedStage),
      });
    } finally {
      active.clear();
    }
  }

  async #recordExhaustedActionFailure(
    attempts: DeliveryAttempts,
    message: InboxMessage,
    action: DeliveryMessageResult,
  ): Promise<void> {
    if (action.kind === "FAILED" && action.stage !== "STATUS_UPDATE") {
      await this.#recordFailedAttempt(
        attempts,
        DeliveryValues.exhaustedFailureMessage(message),
        action,
      );
    }
  }

  async #beginMessageDelivery(
    inbox: DeliveryInbox,
    message: InboxMessage,
    lease: ShardLeaseKeeper,
    fence: DeliveryOperationFence,
  ): Promise<DeliveryInboxWork | undefined> {
    lease.requireActive();
    fence.requireActive();
    return inbox.begin(message, lease.session(), fence.options);
  }

  async #synchronizeActiveWork(
    lease: ShardLeaseKeeper,
    active: ActiveWork,
    fence: DeliveryOperationFence,
  ): Promise<void> {
    await lease.awaitRenewal();
    lease.requireActive();
    fence.requireActive();
    await active.synchronize(lease.session(), fence.options);
  }

  async #invokeEndpoint(
    message: InboxMessage,
    onMessage: OnDeliveryMessage,
    lease: ShardLeaseKeeper,
    active: ActiveWork,
    fence: DeliveryOperationFence,
  ): Promise<void> {
    await lease.awaitRenewal();
    lease.requireActive();
    DeliveryValues.requireEndpointLabel(message.label);
    active.markCallbackAccepted();
    await onMessage(DeliveryValues.endpointSnapshot(message));
    fence.requireActive();
    active.markCallbackSucceeded();
  }

  async #completeActiveWork(
    message: InboxMessage,
    lease: ShardLeaseKeeper,
    active: ActiveWork,
    onFinalize?: () => void,
    fence?: DeliveryOperationFence,
  ): Promise<void> {
    await lease.awaitRenewal();
    lease.requireActive();
    fence?.requireActive();
    onFinalize?.();

    const completed = await active.complete(fence?.options);
    if (!completed) {
      throw new Error(`Inbox message "${message.id.value}" was not marked delivered.`);
    }
  }

  async #clearFailedWork(
    error: unknown,
    active: ActiveWork,
    operation?: DeliveryOperationOptions,
  ): Promise<DeliveryErrorState> {
    if (active.callbackSucceeded()) {
      return Object.freeze({ error, cleanupFailed: false });
    }

    try {
      await active.abandon(operation);

      return Object.freeze({ error, cleanupFailed: false });
    } catch (clearError) {
      return Object.freeze({
        error: DeliveryValues.claimClearFailure(error, clearError),
        cleanupFailed: true,
      });
    }
  }

  async #tryDrainMessage(
    inbox: DeliveryInbox,
    attempts: DeliveryAttempts,
    progress: DrainProgress,
    message: InboxMessage,
    onMessage: OnDeliveryMessage,
    lease: ShardLeaseKeeper,
    active: ActiveWork,
    fence: DeliveryOperationFence,
  ): Promise<void> {
    if (!progress.observe(message)) {
      return;
    }

    if (!DeliveryValues.isEndpointLabel(message.label)) {
      return;
    }

    DeliveryValues.requireEndpointStatus(message.status);
    const retry = await this.#decideRetry(attempts, message.id);
    if (retry.kind === "EXHAUSTED") {
      const action = await this.#markExhaustedDelivered(
        inbox,
        message,
        retry,
        lease,
        active,
        fence,
      );
      await this.#recordExhaustedActionFailure(attempts, message, action);
      progress.recordExhausted(message, action);
      return;
    }

    const endpoint = DeliveryValues.requireEndpointMessage(message);
    const attempt = await this.#deliverMessage(inbox, endpoint, onMessage, lease, active, fence);
    if (attempt.kind === "FAILED") {
      await this.#recordFailedAttempt(attempts, endpoint, attempt);
    }
    progress.record(endpoint, attempt);
  }

  async #decideRetry(
    attempts: DeliveryAttempts,
    messageId: InboxMessage["id"],
  ): Promise<DeliveryRetryDecision> {
    const summary = await attempts.summarize(messageId);

    return retryDecisions.decide(summary);
  }

  async #recordFailedAttempt(
    attempts: DeliveryAttempts,
    message: DeliveryEndpointMessage,
    attempt: Extract<DeliveryMessageResult, { readonly kind: "FAILED" }>,
  ): Promise<void> {
    try {
      await attempts.recordFailure({
        message,
        node: attempt.node,
        attemptedAt: this.#now(),
        accepted: attempt.accepted,
        stage: attempt.stage,
        reason: attempt.reason,
      });
    } catch (error) {
      if (error instanceof DeliveryStorageCorruptionError) {
        throw error;
      }
      // Retained attempt history is observational; run/loop failure accounting
      // must continue to report the original delivery failure.
    }
  }

  #drainScope(): DeliveryScope {
    const context = DeliveryValues.snapshotStorageContext(this.#context);
    const attempts = new DeliveryAttempts({
      context,
      storageFactory: this.#storageFactory,
    });

    return Object.freeze({ inbox: this.inbox, attempts, shards: this.shards });
  }

  #resolveDrainCursor(value: DeliveryDrainCursor | undefined): DeliveryDrainCursor {
    return DeliveryValues.requireDrainCursor(value);
  }
}

/** Delivery construction options. */
export interface DeliveryOptions {
  /** Storage context owning delivery data. */
  readonly context: StorageContext;
  /** Storage factory used for durable delivery records. */
  readonly storageFactory: StorageFactory;
  /** Optional shard lease duration in milliseconds, at least 1000. */
  readonly leaseMs?: number;
  /**
   * Returns the clock time for delivery timing decisions such as lease and dedup expiry.
   *
   * @returns The current time.
   */
  readonly now?: () => Date;
  /** Optional public builder-selected work registry. */
  readonly workRegistry?: DeliveryWorkRegistry;
  /** Optional server-owned inbox port. */
  readonly inbox?: DeliveryInbox;
  /** Optional public builder-selected target strategy. */
  readonly strategy?: DeliveryStrategy;
  /** Optional finite-run monitor. */
  readonly monitor?: DeliveryMonitor;
  /** Optional public builder-selected page size. */
  readonly pageSize?: number;
  /** Optional public builder-selected batch size. */
  readonly batchSize?: number;
  /** Optional public builder-selected pickup node. */
  readonly node?: string;
}

/** Options for one direct delivery shard drain. */
export interface DeliveryDrainOptions {
  /** Worker node name used for shard pickup. */
  readonly node: string;
  /** Optional positive accepted-work cap for one drain run. */
  readonly limit?: number;
  /** Framework endpoint callback invoked for each available supported worker row. */
  readonly onMessage: OnDeliveryMessage;
  /** Optional cancellation and deadline propagated through every port operation. */
  readonly operation?: DeliveryOperationOptions;
}

interface DeliveryDrainControls {
  readonly resume?: DeliveryDrainCursor;
  readonly maxFailures?: number;
  readonly epoch?: DeliveryEpochSlice;
  readonly onStarted?: () => void;
}

/** Provides framework-only access to loop-private delivery controls. */
export interface DeliveryAccess {
  /**
   * Processes one shard through a registered delivery instance.
   *
   * @param delivery The delivery instance.
   * @param shard The shard to drain.
   * @param options The direct-drain options.
   * @param controls The loop-private controls.
   * @returns The bounded drain outcome.
   */
  drain(
    delivery: Delivery,
    shard: ShardIndex,
    options: DeliveryDrainOptions,
    controls: DeliveryDrainControls,
  ): Promise<DeliveryDrainOutcome>;
  /**
   * Sets a delivery's private drainer.
   *
   * @param delivery The delivery instance.
   * @param drainer The replacement drainer.
   * @returns A function that restores the previous drainer.
   */
  replace(delivery: Delivery, drainer: DeliveryDrainer): () => void;
}

type DeliveryDrainer = (
  shard: ShardIndex,
  options: DeliveryDrainOptions,
  controls: DeliveryDrainControls,
) => Promise<DeliveryDrainOutcome>;

const deliveryDrainers = new WeakMap<Delivery, DeliveryDrainer>();
const defaultPageSize = 100;
const defaultBatchSize = 100;
const singleShardStrategy: DeliveryStrategy = Object.freeze({
  shardCount: 1,
  shardFor: () => ShardIndex.single(),
});

/** Creates public immutable delivery page summaries. */
const DeliveryPages = Object.freeze({
  fromLoop(run: DeliveryLoopRun): DeliveryPage {
    return Object.freeze({
      status: run.status,
      processed: run.processed,
      accepted: run.accepted,
      delivered: run.delivered,
      failed: run.failed,
    });
  },
});

/** Provides framework-only access to loop-private delivery controls. */
export const deliveryAccess: DeliveryAccess = Object.freeze({
  /** Processes one shard through a registered delivery instance. */
  drain(
    delivery: Delivery,
    shard: ShardIndex,
    options: DeliveryDrainOptions,
    controls: DeliveryDrainControls,
  ) {
    return DeliveryValues.requireDeliveryDrainer(delivery)(shard, options, controls);
  },
  /** Sets a delivery's private drainer. */
  replace(delivery: Delivery, drainer: DeliveryDrainer) {
    const previous = DeliveryValues.requireDeliveryDrainer(delivery);
    deliveryDrainers.set(delivery, drainer);

    return () => {
      deliveryDrainers.set(delivery, previous);
    };
  },
});

/** Options for one exact-message delivery drain. */
export interface DeliveryMessageDrainOptions {
  /** Worker node name used for shard pickup. */
  readonly node: string;
  /**
   * Framework endpoint callback invoked for the exact pending row when it is
   * still available and supported by this worker, at most once.
   */
  readonly onMessage: OnDeliveryMessage;
}

/**
 * Independent callback or ordinary failure snapshot for one supported durable inbox row.
 *
 * Ordinary callback/failure snapshots copy `Date` values and `Any.value`
 * payload bytes, so mutation cannot alter the claimed internal row. Exhausted-
 * row failure snapshots use this same shape but intentionally omit `signal` to
 * avoid copying payload bytes that the exhaustion path does not consume.
 */
export interface DeliveryEndpointMessage extends Omit<InboxMessage, "label" | "status"> {
  /** Delivery label supported by the direct worker endpoint callback surface. */
  readonly label: "HANDLE_COMMAND" | "UPDATE_SUBSCRIBER" | "REACT_UPON_EVENT";
  /** Pending delivery status exposed by the direct worker endpoint callback surface. */
  readonly status: "TO_DELIVER";
}

/** One durable inbox row accepted by framework-owned direct worker endpoints. */
type DeliveryEndpointLabel = DeliveryEndpointMessage["label"];

/**
 * Invokes one supported durable inbox row.
 *
 * @param message The immutable endpoint message.
 * @returns Completion of the endpoint callback.
 */
export type OnDeliveryMessage = (message: DeliveryEndpointMessage) => Promise<void> | void;

/** Simple delivery worker run statistics. */
export interface DeliveryRun {
  /** Whether a shard was picked up and drained or skipped because another worker owns it. */
  readonly status: "DRAINED" | "SKIPPED";
  /** Number of pending rows read for this run. */
  readonly processed: number;
  /** Number of rows whose endpoint callback was invoked during this run. */
  readonly accepted: number;
  /** Number of rows marked delivered after callback success or callback-free exhaustion. */
  readonly delivered: number;
  /**
   * Number of observed endpoint, lease/fencing, status-update, cleanup, or
   * failed exhaustion-time mark observations.
   */
  readonly failed: number;
  /** Per-message failure observations kept only in the returned run result. */
  readonly failures: readonly DeliveryFailure[];
}

/** Failure from one message in a direct delivery run. */
export interface DeliveryFailure {
  /** Independent supported-row snapshot associated with this failure observation. */
  readonly message: DeliveryEndpointMessage;
  /**
   * Error observed during endpoint callback, lease/fencing, delivery-status
   * update, or framework cleanup work. An exhaustion-time mark failure with
   * successful cleanup uses frozen, bounded, stack-free facts. If cleanup also
   * fails, the existing `CLEANUP` result carries an `AggregateError` containing
   * the original mark error and cleanup error without that guarantee. The
   * durable mark phase starts only after the final lease/fencing guard.
   */
  readonly error: unknown;
}

interface ShardLeaseKeeper {
  readonly awaitRenewal: () => Promise<void>;
  readonly close: () => Promise<void>;
  readonly requireActive: () => void;
  readonly session: () => DeliveryWorkSession;
}

interface ShardLeaseRenewalOptions {
  readonly onRenewWork: (session: DeliveryWorkSession) => Promise<void>;
  readonly operation?: DeliveryOperationOptions;
}

interface DeliveryScope {
  readonly inbox: DeliveryInbox;
  readonly attempts: DeliveryAttempts;
  readonly shards: DeliveryWorkRegistry;
}

/** Describes the cursor used by the package-local delivery loop path. */
export interface DeliveryDrainCursor {
  /** Identifies the last scanned inbox row, when present. */
  readonly after?: InboxReadContinuation;
}

/** Describes internal result metadata used by `DeliveryLoop`. */
export interface DeliveryDrainOutcome {
  /** Contains the public direct-drain result. */
  readonly run: DeliveryRun;
  /** Holds the next resume cursor, when a scan remains. */
  readonly resumeCursor?: DeliveryDrainCursor;
  /** States whether unavailable rows exhausted the scan. */
  readonly exhaustedSkippedScan: boolean;
  /** Holds admitted-epoch progress, when applicable. */
  readonly epochProgress?: DeliveryEpochProgress;
}

/** Describes immutable admitted row membership and loop position. */
export interface DeliveryEpochSlice {
  /** Lists the immutable admitted rows. */
  readonly messages: readonly InboxMessage[];
  /** Identifies the next admitted row index. */
  readonly next: number;
}

/** Describes the last safe position in one admitted delivery epoch. */
export interface DeliveryEpochProgress {
  /** Identifies the next admitted row index. */
  readonly next: number;
  /** States whether all admitted rows are complete. */
  readonly complete: boolean;
}

interface DrainProgress {
  readonly accepted: number;
  readonly failed: number;
  readonly processed: number;
  readonly finish: (
    cursor: DeliveryDrainCursor,
    exhaustedSkippedScan?: boolean,
  ) => DeliveryDrainOutcome;
  readonly hasSeen: (message: InboxMessage) => boolean;
  readonly observe: (message: InboxMessage) => boolean;
  readonly recordExhausted: (message: InboxMessage, action: DeliveryMessageResult) => void;
  readonly record: (message: DeliveryEndpointMessage, attempt: DeliveryMessageResult) => void;
}

/** Mutable cursor state for one bounded pending-message scan. */
class DeliveryScanState {
  #after: InboxReadContinuation | undefined;
  #resumedCursor: boolean;

  constructor(cursor: DeliveryDrainCursor) {
    this.#after = cursor.after;
    this.#resumedCursor = cursor.after !== undefined;
  }

  get after(): InboxReadContinuation | undefined {
    return this.#after;
  }

  hasResumedCursor(): boolean {
    return this.#resumedCursor;
  }

  readLimit(scanBudget: number, processed: number): number {
    return Math.min(inboxStorageAccess.maxReadLimit, scanBudget - processed);
  }

  rewindToHead(): void {
    this.#after = undefined;
    this.#resumedCursor = false;
  }

  advancePast(message: InboxMessage): void {
    this.#after = DeliveryValues.inboxContinuation(message);
  }

  cursor(): DeliveryDrainCursor {
    return DeliveryValues.drainCursor(this.#after);
  }

  finishShortPage(accepted: number, failed: number): DeliveryDrainCursor {
    return this.#resumedCursor && accepted === 0 && failed === 0
      ? DeliveryValues.drainCursor()
      : this.cursor();
  }

  shouldRescanHead(accepted: number, failed: number): boolean {
    return this.#resumedCursor && accepted === 0 && failed === 0;
  }
}

type DeliveryMessageResult =
  | { readonly kind: "SKIPPED" }
  | { readonly kind: "DELIVERED" }
  | {
      readonly kind: "FAILED";
      readonly accepted: boolean;
      readonly error: unknown;
      readonly node: string;
      readonly stage: DeliveryFailureStage;
      readonly reason: DeliveryFailureReason;
    };

interface DeliveryErrorState {
  readonly error: unknown;
  readonly cleanupFailed: boolean;
}

interface DeliveryRetryExhaustedFailure {
  readonly kind: "EXHAUSTED";
  readonly action: "MARK_DELIVERED";
  readonly message: "Delivery retry attempts exhausted; the row could not be marked delivered.";
  readonly count: number;
  readonly limit: number;
  readonly latestStage: DeliveryFailureStage | undefined;
  readonly latestReason: DeliveryFailureReason | undefined;
  readonly latestAccepted: boolean | undefined;
}

const defaultShardLeaseMs = 30_000;
const maxContinuationTextBytes = 16 * 1024;
const retryDecisions = new DeliveryRetryDecisions({ maxAttempts: deliveryAttemptCapacity });

/** Groups package-local delivery run and lease operations. */
const DeliveryRunValues = Object.freeze({
  deliveryRun(
    status: DeliveryRun["status"],
    processed: number,
    accepted: number,
    delivered: number,
    failed: number,
    failures: readonly DeliveryFailure[],
  ): DeliveryRun {
    return Object.freeze({
      status,
      processed,
      accepted,
      delivered,
      failed,
      failures: Object.freeze([...failures]),
    });
  },

  deliveryFailureStage(stage: DeliveryFailureStage, accepted: boolean): DeliveryFailureStage {
    return stage === "ENDPOINT" && !accepted ? "LEASE" : stage;
  },

  deliveryFailureReason(stage: DeliveryFailureStage): DeliveryFailureReason {
    switch (stage) {
      case "CLAIM":
        return "CLAIM_FAILED";
      case "LEASE":
        return "LEASE_INACTIVE";
      case "ENDPOINT":
        return "ENDPOINT_REJECTED";
      case "CLEANUP":
        return "CLEANUP_FAILED";
      case "STATUS_UPDATE":
        return "STATUS_UPDATE_FAILED";
    }
  },

  deliveryDrainOutcome(
    run: DeliveryRun,
    resumeCursor?: DeliveryDrainCursor,
    exhaustedSkippedScan = false,
  ): DeliveryDrainOutcome {
    return Object.freeze({
      run,
      ...(resumeCursor === undefined ? {} : { resumeCursor }),
      exhaustedSkippedScan,
    });
  },

  retryExhaustedMarkFailure(decision: DeliveryRetryDecision): DeliveryRetryExhaustedFailure {
    return Object.freeze({
      kind: "EXHAUSTED",
      action: "MARK_DELIVERED",
      message: "Delivery retry attempts exhausted; the row could not be marked delivered.",
      count: decision.count,
      limit: decision.limit,
      latestStage: decision.latestStage,
      latestReason: decision.latestReason,
      latestAccepted: decision.latestAccepted,
    });
  },

  drainProgress(): DrainProgress {
    const seen = new Set<string>();
    const failures: DeliveryFailure[] = [];
    let processed = 0;
    let accepted = 0;
    let delivered = 0;

    return Object.freeze({
      get accepted() {
        return accepted;
      },
      get processed() {
        return processed;
      },
      get failed() {
        return failures.length;
      },
      finish(cursor: DeliveryDrainCursor, exhaustedSkippedScan = false) {
        const run = DeliveryRunValues.deliveryRun(
          "DRAINED",
          processed,
          accepted,
          delivered,
          failures.length,
          failures,
        );
        const resumableSkippedScan =
          exhaustedSkippedScan && run.accepted === 0 && run.delivered === 0 && run.failed === 0;

        return DeliveryRunValues.deliveryDrainOutcome(
          run,
          run.failed > 0 || cursor.after === undefined ? undefined : cursor,
          resumableSkippedScan,
        );
      },
      hasSeen(message: InboxMessage) {
        return seen.has(message.id.value);
      },
      observe(message: InboxMessage) {
        if (seen.has(message.id.value)) {
          return false;
        }
        seen.add(message.id.value);
        processed += 1;

        return true;
      },
      recordExhausted(message: InboxMessage, action: DeliveryMessageResult) {
        if (action.kind === "DELIVERED") {
          delivered += 1;
        } else if (action.kind === "FAILED") {
          failures.push(
            Object.freeze({
              message: DeliveryValues.exhaustedFailureMessage(message),
              error: action.error,
            }),
          );
        }
      },
      record(message: DeliveryEndpointMessage, attempt: DeliveryMessageResult) {
        if (attempt.kind === "SKIPPED") {
          return;
        }
        if (attempt.kind === "FAILED" && !attempt.accepted) {
          failures.push(Object.freeze({ message, error: attempt.error }));
          return;
        }
        accepted += 1;
        if (attempt.kind === "DELIVERED") {
          delivered += 1;
        } else {
          failures.push(Object.freeze({ message, error: attempt.error }));
        }
      },
    });
  },

  keepShardLease(
    shards: DeliveryWorkRegistry,
    session: DeliveryWorkSession,
    leaseMs: number,
    nowMs: () => number,
    options: ShardLeaseRenewalOptions,
  ): ShardLeaseKeeper {
    if (session.kind === "EXCLUSIVE") {
      return Object.freeze({
        awaitRenewal: () => Promise.resolve(),
        close: () => Promise.resolve(),
        requireActive: () => undefined,
        session: () => session,
      });
    }
    if (shards.renew === undefined) {
      throw new Error("Leased delivery sessions require registry renewal.");
    }
    const renew = shards.renew.bind(shards);
    let current = session;
    let failed: unknown;
    let renewing: Promise<void> | undefined;
    let stopped = false;
    const interval = setInterval(
      () => {
        if (stopped || renewing !== undefined) {
          return;
        }

        renewing = renew(current, options.operation)
          .then(async (next) => {
            if (next === undefined) {
              failed = new Error("Shard lease was lost.");

              return;
            }
            await options.onRenewWork(next);
            current = next;
          })
          .catch((error: unknown) => {
            failed = error;
          })
          .finally(() => {
            renewing = undefined;
          });
      },
      Math.max(1, Math.floor(leaseMs / 2)),
    );

    if (typeof interval.unref === "function") {
      interval.unref();
    }
    const stopRenewal = (): void => {
      if (!stopped) {
        stopped = true;
        clearInterval(interval);
      }
    };
    options.operation?.signal?.addEventListener("abort", stopRenewal, { once: true });

    return Object.freeze({
      async awaitRenewal() {
        await renewing;
      },
      async close() {
        stopRenewal();
        options.operation?.signal?.removeEventListener("abort", stopRenewal);
        await renewing;
      },
      requireActive() {
        if (failed !== undefined) {
          throw DeliveryValues.leaseError(failed);
        }
        if (current.expiresAt.getTime() <= nowMs()) {
          failed = new Error("Shard lease expired.");
          throw failed;
        }
      },
      session() {
        return current;
      },
    });
  },
});

interface DeliveryOperationFence {
  readonly options: DeliveryOperationOptions | undefined;
  requireActive(): void;
}

/** Creates package-local delivery operation fences. */
export interface DeliveryOperations {
  /**
   * Creates an operation fence from optional controls.
   *
   * @param options Optional cancellation and deadline controls.
   * @returns The active operation fence.
   */
  fence(options: DeliveryOperationOptions | undefined): DeliveryOperationFence;
}

/** Creates package-local delivery operation fences. */
export const deliveryOperations: DeliveryOperations = Object.freeze({
  /**
   * Creates one operation fence whose deadline starts at admission.
   *
   * @param options Optional cancellation and deadline controls.
   * @returns The active operation fence.
   */
  fence(options: DeliveryOperationOptions | undefined): DeliveryOperationFence {
    const deadline =
      options?.timeoutMs === undefined
        ? undefined
        : Date.now() + DeliveryOperationValues.requireTimeout(options.timeoutMs);
    return Object.freeze({
      options,
      requireActive() {
        if (options?.signal?.aborted) {
          throw options.signal.reason instanceof Error
            ? options.signal.reason
            : new Error("Delivery operation was aborted.");
        }
        if (deadline !== undefined && Date.now() >= deadline) {
          throw new Error("Delivery operation deadline elapsed.");
        }
      },
    });
  },
});

/** Groups internal operation-control validation. */
const DeliveryOperationValues = Object.freeze({
  requireTimeout(value: number): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error("Delivery operation timeoutMs must be a positive safe integer.");
    }
    return value;
  },
});

/** Groups package-local delivery value and validation operations. */
const DeliverySessionValues = Object.freeze({
  sessionNode(session: DeliveryWorkSession): string {
    return session.kind === "LEASED" ? session.node : "exclusive";
  },
});

class ActiveWork {
  #work: DeliveryInboxWork | undefined;
  #callbackAccepted = false;
  #callbackSucceeded = false;
  #lock: Promise<void> = Promise.resolve();

  callbackAccepted(): boolean {
    return this.#callbackAccepted;
  }

  callbackSucceeded(): boolean {
    return this.#callbackSucceeded;
  }

  clear(): void {
    this.#work = undefined;
    this.#callbackAccepted = false;
    this.#callbackSucceeded = false;
  }

  async abandon(options?: DeliveryOperationOptions): Promise<void> {
    await this.#locked(async () => {
      const current = this.#work;
      if (current !== undefined) {
        await current.abandon(options);
        this.#work = undefined;
      }
    });
  }

  async complete(options?: DeliveryOperationOptions): Promise<boolean> {
    return this.#locked(async () => {
      const current = this.#work;
      if (current === undefined) {
        throw new Error("Inbox work was lost.");
      }
      const completed = await current.complete(options);
      if (completed) {
        this.#work = undefined;
      }
      return completed;
    });
  }

  markCallbackAccepted(): void {
    this.#callbackAccepted = true;
  }

  markCallbackSucceeded(): void {
    this.#callbackSucceeded = true;
  }

  set(work: DeliveryInboxWork): void {
    this.#work = work;
    this.#callbackAccepted = false;
    this.#callbackSucceeded = false;
  }

  async renew(session: DeliveryWorkSession, options?: DeliveryOperationOptions): Promise<void> {
    await this.#locked(async () => {
      if (this.#work !== undefined) {
        await this.#work.synchronize(session, options);
      }
    });
  }

  async synchronize(
    session: DeliveryWorkSession,
    options?: DeliveryOperationOptions,
  ): Promise<void> {
    await this.#locked(async () => {
      const current = this.#work;
      if (current === undefined) {
        throw new Error("Inbox work was lost.");
      }
      await current.synchronize(session, options);
    });
  }

  async #locked<T>(callback: () => Promise<T>): Promise<T> {
    const previous = this.#lock;
    let release: () => void = () => undefined;
    this.#lock = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await callback();
    } finally {
      release();
    }
  }
}

/** Groups package-local delivery message and storage operations. */
const DeliveryValues = Object.freeze({
  endpointSnapshot(message: InboxMessage): DeliveryEndpointMessage {
    const label = DeliveryValues.requireEndpointLabel(message.label);
    const status = DeliveryValues.requireEndpointStatus(message.status);

    return Object.freeze({
      id: Object.freeze({
        value: message.id.value,
        shard: message.id.shard,
      }),
      inboxId: Object.freeze({ ...message.inboxId }),
      label,
      status,
      signalId: message.signalId,
      shard: message.shard,
      whenReceived: new Date(message.whenReceived),
      version: message.version,
      ...(message.signal === undefined
        ? {}
        : { signal: DeliveryValues.copySignal(message.signal) }),
      ...(message.keepUntil === undefined ? {} : { keepUntil: new Date(message.keepUntil) }),
    });
  },

  exhaustedFailureMessage(message: InboxMessage): DeliveryEndpointMessage {
    return Object.freeze({
      id: Object.freeze({
        value: message.id.value,
        shard: message.id.shard,
      }),
      inboxId: Object.freeze({ ...message.inboxId }),
      label: DeliveryValues.requireEndpointLabel(message.label),
      status: DeliveryValues.requireEndpointStatus(message.status),
      signalId: message.signalId,
      shard: message.shard,
      whenReceived: new Date(message.whenReceived),
      version: message.version,
      ...(message.keepUntil === undefined ? {} : { keepUntil: new Date(message.keepUntil) }),
    });
  },

  copySignal(signal: Any): Any {
    const copied = clone(AnySchema, signal);
    copied.value = new Uint8Array(copied.value);

    return copied;
  },

  requireEndpointLabel(label: InboxMessage["label"]): DeliveryEndpointLabel {
    if (DeliveryValues.isEndpointLabel(label)) {
      return label;
    }

    throw new Error(`Delivery worker does not support "${label}" messages.`);
  },

  requireFailureLimit(value: unknown): number | undefined {
    return value === undefined ? undefined : inboxStorageAccess.readLimit(value);
  },

  requireDrainCursor(value: unknown): DeliveryDrainCursor {
    if (value === undefined) {
      return DeliveryValues.drainCursor();
    }
    if (typeof value !== "object" || value === null) {
      throw new Error("Delivery resume cursor must be an object.");
    }

    const { after } = value as {
      readonly after?: unknown;
    };
    if (after === undefined) {
      return DeliveryValues.drainCursor();
    }
    return DeliveryValues.drainCursor(DeliveryValues.requireResumeContinuation(after));
  },

  requireResumeContinuation(value: unknown): InboxReadContinuation {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("Delivery resume cursor continuation must be an object.");
    }

    const input = value as {
      readonly messageId?: unknown;
      readonly whenReceived?: unknown;
      readonly version?: unknown;
    };

    return DeliveryValues.continuationFromValues(
      input.messageId,
      input.whenReceived,
      input.version,
    );
  },

  drainCursor(after?: InboxReadContinuation): DeliveryDrainCursor {
    return Object.freeze(after === undefined ? {} : { after });
  },

  inboxContinuation(message: Pick<InboxMessage, "id" | "whenReceived" | "version">) {
    return DeliveryValues.continuationFromValues(
      message.id.value,
      message.whenReceived,
      message.version,
    );
  },

  continuationFromValues(
    messageId: unknown,
    whenReceived: unknown,
    version: unknown,
  ): InboxReadContinuation {
    if (typeof messageId !== "string" || messageId.trim().length === 0) {
      throw new Error("Delivery resume cursor requires a message ID.");
    }
    if (Buffer.byteLength(messageId, "utf8") > maxContinuationTextBytes) {
      throw new Error(
        `Delivery resume cursor message ID exceeds ${String(maxContinuationTextBytes)} bytes and cannot be stored.`,
      );
    }
    if (!(whenReceived instanceof Date) || Number.isNaN(whenReceived.getTime())) {
      throw new Error("Delivery resume cursor requires a valid receive time.");
    }
    if (typeof version !== "bigint") {
      throw new Error("Delivery resume cursor requires a bigint version.");
    }
    const encodedVersion = version.toString();
    if (Buffer.byteLength(encodedVersion, "utf8") > maxContinuationTextBytes) {
      throw new Error(
        `Delivery resume cursor version exceeds ${String(maxContinuationTextBytes)} bytes and cannot be stored.`,
      );
    }

    return Object.freeze({
      messageId,
      whenReceived: new Date(whenReceived.getTime()),
      version,
    });
  },

  requireEndpointMessage(message: InboxMessage): DeliveryEndpointMessage {
    return DeliveryValues.endpointSnapshot(message);
  },

  requireEndpointStatus(status: InboxMessage["status"]): DeliveryEndpointMessage["status"] {
    if (status === "TO_DELIVER") {
      return status;
    }

    throw new Error(`Delivery worker does not support "${status}" message status.`);
  },

  isEndpointLabel(label: InboxMessage["label"]): label is DeliveryEndpointLabel {
    return (
      label === "HANDLE_COMMAND" || label === "UPDATE_SUBSCRIBER" || label === "REACT_UPON_EVENT"
    );
  },

  leaseError(error: unknown): Error {
    return error instanceof Error
      ? error
      : new Error("Shard lease renewal failed.", { cause: error });
  },

  claimClearFailure(deliveryError: unknown, clearError: unknown): AggregateError {
    return new AggregateError(
      [deliveryError, clearError],
      "Delivery failed and framework cleanup failed.",
    );
  },

  requireDeliveryDrainer(delivery: Delivery): DeliveryDrainer {
    const drainer = deliveryDrainers.get(delivery);
    if (drainer === undefined) {
      throw new TypeError("Loop drain access requires a Delivery instance.");
    }

    return drainer;
  },

  requireMessageShard(message: InboxMessage): ShardIndex {
    const idShard = DeliveryValues.readShard(message.id.shard, "Inbox message ID shard");
    const rowShard = DeliveryValues.readShard(message.shard, "Inbox message shard");

    if (!DeliveryValues.sameShard(idShard, rowShard)) {
      throw new InboxMessageError("Inbox message ID shard does not match message shard.");
    }

    return idShard;
  },

  snapshotStorageContext(context: StorageContext): StorageContext {
    if (!context.multitenant) {
      return Object.freeze({
        name: context.name,
        multitenant: false,
      });
    }

    const { tenantId } = context;
    if (tenantId === undefined || tenantId.trim().length === 0) {
      throw new Error(`Multitenant storage "${context.name}" requires context.tenantId.`);
    }

    return Object.freeze({
      name: context.name,
      multitenant: true,
      tenantId,
    });
  },

  copyStorageContext(context: StorageContext): StorageContext {
    if (!context.multitenant) {
      return Object.freeze({ name: context.name, multitenant: false });
    }
    const tenantId = context.tenantId;
    return Object.freeze({
      name: context.name,
      multitenant: true,
      ...(tenantId === undefined ? {} : { tenantId }),
    });
  },

  readShard(value: unknown, label: string): ShardIndex {
    try {
      if (typeof value !== "object" || value === null) {
        throw new Error(`${label} is invalid.`);
      }
      const shard = value as { readonly index?: unknown; readonly ofTotal?: unknown };
      const index = shard.index;
      const ofTotal = shard.ofTotal;

      return new ShardIndex(index as number, ofTotal as number);
    } catch (error) {
      throw new InboxMessageError(`${label} is invalid.`, { cause: error });
    }
  },

  sameShard(
    left: Pick<ShardIndex, "index" | "ofTotal">,
    right: Pick<ShardIndex, "index" | "ofTotal">,
  ): boolean {
    return left.index === right.index && left.ofTotal === right.ofTotal;
  },
});
