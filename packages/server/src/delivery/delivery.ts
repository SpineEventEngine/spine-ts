import type { StorageContext, StorageFactory } from "@spine-ts/storage";
import { clone } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";

import { Inbox, InboxMessageError, type InboxMessage } from "./inbox.js";
import { inboxStorageAccess, InboxStorage } from "./inbox-storage.js";
import type { ClaimedInboxMessage, InboxClaim } from "./inbox-claim.js";
import { requireDeliveryLeaseMs } from "./delivery-lease.js";
import { ShardIndex } from "./shard-index.js";
import { ShardedWorkRegistry, type ShardSession } from "./sharded-work-registry.js";

/** Delivery owner for inbox storage and shard registry. */
export class Delivery {
  readonly #context: StorageContext;
  readonly #leaseMs: number;
  readonly #now: () => Date;
  readonly #storageFactory: StorageFactory;

  /** Durable inbox facade. */
  readonly inbox: Inbox;
  /** Storage-backed shard registry. */
  readonly shards: ShardedWorkRegistry;

  /** Open delivery from one storage context and factory. */
  constructor(options: DeliveryOptions) {
    this.#context = options.context;
    this.#leaseMs = requireDeliveryLeaseMs("Delivery", options.leaseMs ?? defaultShardLeaseMs);
    this.#now = options.now ?? (() => new Date());
    this.#storageFactory = options.storageFactory;
    this.inbox = new Inbox(
      new InboxStorage({
        context: options.context,
        storageFactory: options.storageFactory,
        now: this.#now,
      }),
    );
    this.shards = new ShardedWorkRegistry({
      context: options.context,
      storageFactory: options.storageFactory,
      leaseMs: this.#leaseMs,
      now: this.#now,
    });
    deliveryDrainers.set(this, (shard, options, controls) => this.#drain(shard, options, controls));
    Object.freeze(this);
  }

  /**
   * Drain one shard through the framework-owned direct worker boundary.
   *
   * The drain first picks up the shard with lease fencing, then scans
   * `TO_DELIVER` rows in inbox order. `limit` bounds accepted endpoint work;
   * newly observed rows stop at the storage read cap plus `limit` while the
   * drain advances past unavailable rows before endpoint invocation. If a
   * stale offset boundary moves, the drain may also read one cap-sized page of
   * already-seen rows plus one-row boundary probes to reach moved work. The
   * `onMessage` endpoint
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
   * and the per-message failures observed during this run. This method does not
   * schedule later runs, open transports, or retain endpoint attempt history.
   */
  async drain(shard: ShardIndex, options: DeliveryDrainOptions): Promise<DeliveryRun> {
    const outcome = await this.#drain(shard, options, {});

    return outcome.run;
  }

  async #drain(
    shard: ShardIndex,
    options: DeliveryDrainOptions,
    controls: DeliveryDrainControls,
  ): Promise<DeliveryDrainOutcome> {
    const scope = this.#drainScope();
    const limit = inboxStorageAccess.readLimit(options.limit);
    const maxFailures = requireFailureLimit(controls.maxFailures);
    const session = await scope.shards.pickUp(shard, options.node);
    if (session === undefined) {
      return deliveryDrainOutcome(deliveryRun("SKIPPED", 0, 0, 0, 0, []));
    }
    const active = new ActiveClaim();
    const lease = keepShardLease(
      scope.shards,
      session,
      this.#leaseMs,
      () => this.#now().getTime(),
      {
        onRenewClaim: (next) => active.renew(scope.inbox.storage, next),
      },
    );

    try {
      const cursor = this.#resolveDrainCursor(controls.resume);

      return await this.#drainAvailableMessages(
        scope.inbox,
        session.shard,
        limit,
        options.onMessage,
        lease,
        active,
        cursor,
        maxFailures,
      );
    } finally {
      await lease.close();
      await scope.shards.release(session);
    }
  }

  async #drainAvailableMessages(
    inbox: Inbox,
    shard: ShardIndex,
    limit: number,
    onMessage: OnDeliveryMessage,
    lease: ShardLeaseKeeper,
    active: ActiveClaim,
    cursor: DeliveryDrainCursor,
    maxFailures: number | undefined,
  ): Promise<DeliveryDrainOutcome> {
    const progress = drainProgress();
    const scanBudget = inboxStorageAccess.maxReadLimit + limit;
    const scan = new DeliveryScanState(cursor);
    const finishExhaustedSkippedScan = () =>
      progress.finish(scan.finishSkippedScan(progress.accepted, progress.failed), true);

    while (progress.processed < scanBudget) {
      if (
        scan.requiresBoundaryValidation() &&
        !(await this.#pendingBoundaryMatches(inbox, shard, scan.offset, scan.pendingBoundaryId))
      ) {
        // Offset pages are relative to the current `TO_DELIVER` set. If
        // skipped rows disappeared, reset once instead of paging past work
        // that moved before the old absolute offset.
        scan.resetAfterBoundaryChange();
        continue;
      }

      const readLimit = scan.readLimit(scanBudget, progress.processed);
      const messages = await this.#readPendingDeliveryPage(inbox, shard, readLimit, scan.offset);

      if (
        scan.requiresBoundaryValidation() &&
        !(await this.#pendingBoundaryMatches(inbox, shard, scan.offset, scan.pendingBoundaryId))
      ) {
        // The offset page may have been read from a changed `TO_DELIVER` set.
        // Discard it before processing so work that moved to the head is not skipped.
        scan.resetAfterBoundaryChange();
        continue;
      }

      if (messages.length === 0 && progress.processed === 0 && scan.hasResumedCursor()) {
        scan.rewindToHead();
        continue;
      }

      for (const message of messages) {
        const accepted = progress.accepted;
        if (progress.hasSeen(message)) {
          if (!scan.consumeSeenRescanAllowance()) {
            return finishExhaustedSkippedScan();
          }
        } else if (progress.processed >= scanBudget) {
          return finishExhaustedSkippedScan();
        }

        const remainsPending = await this.#tryDrainMessage(
          inbox,
          progress,
          message,
          onMessage,
          lease,
          active,
        );
        if (remainsPending) {
          scan.advancePastPending(message);
        }
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

      if (messages.length < readLimit) {
        if (scan.shouldRescanShortPage(progress.accepted, progress.failed)) {
          scan.rewindToHead();
          continue;
        }

        return progress.finish(scan.cursor());
      }
    }

    return finishExhaustedSkippedScan();
  }

  async #readPendingDeliveryPage(
    inbox: Inbox,
    shard: ShardIndex,
    limit: number,
    offset: number,
  ): Promise<readonly InboxMessage[]> {
    return inbox.read(shard, {
      statuses: ["TO_DELIVER"],
      limit,
      offset,
    });
  }

  async #pendingBoundaryMatches(
    inbox: Inbox,
    shard: ShardIndex,
    offset: number,
    pendingBoundaryId: string,
  ): Promise<boolean> {
    const [boundary] = await inbox.read(shard, {
      statuses: ["TO_DELIVER"],
      limit: 1,
      offset: offset - 1,
    });

    return boundary?.id.value === pendingBoundaryId;
  }

  /**
   * Drain one exact pending inbox message through the local worker boundary.
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
   */
  async drainMessage(
    message: InboxMessage,
    options: DeliveryMessageDrainOptions,
  ): Promise<DeliveryRun> {
    const scope = this.#drainScope();
    const shard = requireMessageShard(message);
    const id = Object.freeze({
      value: message.id.value,
      shard,
    });
    const session = await scope.shards.pickUp(shard, options.node);
    if (session === undefined) {
      return deliveryRun("SKIPPED", 0, 0, 0, 0, []);
    }
    const active = new ActiveClaim();
    const lease = keepShardLease(
      scope.shards,
      session,
      this.#leaseMs,
      () => this.#now().getTime(),
      {
        onRenewClaim: (next) => active.renew(scope.inbox.storage, next),
      },
    );

    try {
      if (!sameShard(session.shard, shard)) {
        throw new InboxMessageError("Inbox message lease shard does not match message shard.");
      }

      const pending = await this.#readPendingMessage(scope.inbox, id, shard);
      if (pending === undefined) {
        return deliveryRun("DRAINED", 0, 0, 0, 0, []);
      }

      return await this.#drainExactMessage(scope.inbox, pending, options.onMessage, lease, active);
    } finally {
      await lease.close();
      await scope.shards.release(session);
    }
  }

  async #readPendingMessage(
    inbox: Inbox,
    id: InboxMessage["id"],
    shard: ShardIndex,
  ): Promise<InboxMessage | undefined> {
    const pending = await inbox.readMessage(id);
    if (pending?.status !== "TO_DELIVER") {
      return undefined;
    }
    const pendingShard = requireMessageShard(pending);
    if (!sameShard(pendingShard, shard)) {
      throw new InboxMessageError("Inbox message row shard does not match message shard.");
    }

    return pending;
  }

  async #drainExactMessage(
    inbox: Inbox,
    message: InboxMessage,
    onMessage: OnDeliveryMessage,
    lease: ShardLeaseKeeper,
    active: ActiveClaim,
  ): Promise<DeliveryRun> {
    if (!isEndpointLabel(message.label)) {
      return deliveryRun("DRAINED", 1, 0, 0, 0, []);
    }

    const endpoint = requireEndpointMessage(message);
    const attempt = await this.#deliverMessage(inbox, endpoint, onMessage, lease, active);
    if (attempt.kind === "SKIPPED") {
      return deliveryRun("DRAINED", 1, 0, 0, 0, []);
    }
    if (attempt.kind === "DELIVERED") {
      return deliveryRun("DRAINED", 1, 1, 1, 0, []);
    }

    const failures = [Object.freeze({ message: endpoint, error: attempt.error })];

    return deliveryRun("DRAINED", 1, attempt.accepted ? 1 : 0, 0, 1, failures);
  }

  async #deliverMessage(
    inbox: Inbox,
    message: DeliveryEndpointMessage,
    onMessage: OnDeliveryMessage,
    lease: ShardLeaseKeeper,
    active: ActiveClaim,
  ): Promise<DeliveryMessageResult> {
    try {
      const claimed = await this.#claimMessageForDelivery(inbox, message, lease);
      if (claimed === undefined) {
        return { kind: "SKIPPED" };
      }

      active.set(claimed);
      await this.#synchronizeActiveClaim(inbox, lease, active);
      await this.#invokeEndpoint(claimed, onMessage, lease, active);
      await this.#markActiveDelivered(inbox, message, lease, active);

      return { kind: "DELIVERED" };
    } catch (error) {
      return Object.freeze({
        kind: "FAILED" as const,
        accepted: active.callbackAccepted(),
        error: await this.#clearFailedClaim(inbox, error, active),
      });
    } finally {
      active.clear();
    }
  }

  async #claimMessageForDelivery(
    inbox: Inbox,
    message: InboxMessage,
    lease: ShardLeaseKeeper,
  ): Promise<ClaimedInboxMessage | undefined> {
    lease.requireActive();

    return inboxStorageAccess.claim(inbox.storage, message, lease.session());
  }

  async #synchronizeActiveClaim(
    inbox: Inbox,
    lease: ShardLeaseKeeper,
    active: ActiveClaim,
  ): Promise<void> {
    await lease.awaitRenewal();
    lease.requireActive();
    await active.synchronize(inbox.storage, lease.session());
  }

  async #invokeEndpoint(
    message: ClaimedInboxMessage,
    onMessage: OnDeliveryMessage,
    lease: ShardLeaseKeeper,
    active: ActiveClaim,
  ): Promise<void> {
    await lease.awaitRenewal();
    lease.requireActive();
    requireEndpointLabel(message.label);
    active.markCallbackAccepted();
    await onMessage(endpointMessage(message));
    active.markCallbackSucceeded();
  }

  async #markActiveDelivered(
    inbox: Inbox,
    message: InboxMessage,
    lease: ShardLeaseKeeper,
    active: ActiveClaim,
  ): Promise<void> {
    await lease.awaitRenewal();
    lease.requireActive();

    const marked = await active.finalize((current) =>
      inboxStorageAccess.markDelivered(inbox.storage, current),
    );
    if (marked === undefined) {
      throw new Error(`Inbox message "${message.id.value}" was not marked delivered.`);
    }
  }

  async #clearFailedClaim(inbox: Inbox, error: unknown, active: ActiveClaim): Promise<unknown> {
    if (active.callbackSucceeded()) {
      return error;
    }

    try {
      await active.clearStored(inbox.storage);

      return error;
    } catch (clearError) {
      return claimClearFailure(error, clearError);
    }
  }

  async #tryDrainMessage(
    inbox: Inbox,
    progress: DrainProgress,
    message: InboxMessage,
    onMessage: OnDeliveryMessage,
    lease: ShardLeaseKeeper,
    active: ActiveClaim,
  ): Promise<boolean> {
    if (!progress.observe(message)) {
      return true;
    }

    if (!isEndpointLabel(message.label)) {
      return true;
    }

    const endpoint = requireEndpointMessage(message);
    const attempt = await this.#deliverMessage(inbox, endpoint, onMessage, lease, active);
    progress.record(endpoint, attempt);

    return attempt.kind !== "DELIVERED";
  }

  #drainScope(): DeliveryScope {
    const context = snapshotStorageContext(this.#context);
    const inbox = new Inbox(
      new InboxStorage({
        context,
        storageFactory: this.#storageFactory,
        now: this.#now,
      }),
    );
    const shards = new ShardedWorkRegistry({
      context,
      storageFactory: this.#storageFactory,
      leaseMs: this.#leaseMs,
      now: this.#now,
    });

    return Object.freeze({ inbox, shards });
  }

  #resolveDrainCursor(value: DeliveryDrainCursor | undefined): DeliveryDrainCursor {
    const cursor = requireDrainCursor(value);
    if (cursor.offset === 0 || cursor.pendingBoundaryId === undefined) {
      return drainCursor(0);
    }

    return cursor;
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
  /** Optional clock used for delivery timing decisions such as lease and dedup expiry. */
  readonly now?: () => Date;
}

/** Options for one direct delivery shard drain. */
export interface DeliveryDrainOptions {
  /** Worker node name used for shard pickup. */
  readonly node: string;
  /** Optional positive accepted-work cap for one drain run. */
  readonly limit?: number;
  /** Framework endpoint callback invoked for each available supported worker row. */
  readonly onMessage: OnDeliveryMessage;
}

interface DeliveryDrainControls {
  readonly resume?: DeliveryDrainCursor;
  readonly maxFailures?: number;
}

/** @internal Framework-only access to loop-private delivery controls. */
export interface DeliveryAccess {
  drain(
    delivery: Delivery,
    shard: ShardIndex,
    options: DeliveryDrainOptions,
    controls: DeliveryDrainControls,
  ): Promise<DeliveryDrainOutcome>;
  replace(delivery: Delivery, drainer: DeliveryDrainer): () => void;
}

type DeliveryDrainer = (
  shard: ShardIndex,
  options: DeliveryDrainOptions,
  controls: DeliveryDrainControls,
) => Promise<DeliveryDrainOutcome>;

const deliveryDrainers = new WeakMap<Delivery, DeliveryDrainer>();

/** @internal Framework-only access to loop-private delivery controls. */
export const deliveryAccess: DeliveryAccess = Object.freeze({
  drain(
    delivery: Delivery,
    shard: ShardIndex,
    options: DeliveryDrainOptions,
    controls: DeliveryDrainControls,
  ) {
    return requireDeliveryDrainer(delivery)(shard, options, controls);
  },
  replace(delivery: Delivery, drainer: DeliveryDrainer) {
    const previous = requireDeliveryDrainer(delivery);
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
 * Independent callback/failure snapshot for one supported durable inbox row.
 *
 * `Date` values and `Any.value` payload bytes are copied, so callback mutation
 * cannot alter the claimed internal row.
 */
export interface DeliveryEndpointMessage extends Omit<InboxMessage, "label" | "status"> {
  /** Delivery label supported by the direct worker endpoint callback surface. */
  readonly label: "HANDLE_COMMAND" | "UPDATE_SUBSCRIBER" | "REACT_UPON_EVENT";
  /** Pending delivery status exposed by the direct worker endpoint callback surface. */
  readonly status: "TO_DELIVER";
}

/** One durable inbox row accepted by framework-owned direct worker endpoints. */
type DeliveryEndpointLabel = DeliveryEndpointMessage["label"];

/** Framework callback for one supported durable inbox row. */
export type OnDeliveryMessage = (message: DeliveryEndpointMessage) => Promise<void> | void;

/** Simple delivery worker run statistics. */
export interface DeliveryRun {
  /** Whether a shard was picked up and drained or skipped because another worker owns it. */
  readonly status: "DRAINED" | "SKIPPED";
  /** Number of pending rows read for this run. */
  readonly processed: number;
  /** Number of rows whose endpoint callback was invoked during this run. */
  readonly accepted: number;
  /** Number of rows whose endpoint callback succeeded and were marked delivered. */
  readonly delivered: number;
  /** Number of endpoint callback, lease/fencing, status update, or cleanup failures. */
  readonly failed: number;
  /** Per-message failures kept only in the returned run result. */
  readonly failures: readonly DeliveryFailure[];
}

/** Failure from one message in a direct delivery run. */
export interface DeliveryFailure {
  /** Independent supported-row snapshot that failed during this run. */
  readonly message: DeliveryEndpointMessage;
  /**
   * Error observed during endpoint callback, lease/fencing,
   * delivery-status update, or framework cleanup work.
   */
  readonly error: unknown;
}

interface ShardLeaseKeeper {
  readonly awaitRenewal: () => Promise<void>;
  readonly close: () => Promise<void>;
  readonly requireActive: () => void;
  readonly session: () => ShardSession;
}

interface ShardLeaseRenewalOptions {
  readonly onRenewClaim: (session: ShardSession) => Promise<void>;
}

interface DeliveryScope {
  readonly inbox: Inbox;
  readonly shards: ShardedWorkRegistry;
}

/** @internal Cursor used only by the package-local delivery loop access path. */
export interface DeliveryDrainCursor {
  readonly offset: number;
  readonly pendingBoundaryId?: string;
}

/** @internal Result metadata used by `DeliveryLoop` without widening public `DeliveryRun`. */
export interface DeliveryDrainOutcome {
  readonly run: DeliveryRun;
  readonly resumeCursor?: DeliveryDrainCursor;
  readonly exhaustedSkippedScan: boolean;
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
  readonly record: (message: DeliveryEndpointMessage, attempt: DeliveryMessageResult) => void;
}

/** Mutable cursor state for one bounded pending-message scan. */
class DeliveryScanState {
  #offset: number;
  #pendingBoundaryId: string | undefined;
  #resumedCursor: boolean;
  #offsetRescan = false;
  #rescanSeenAllowance = 0;

  constructor(cursor: DeliveryDrainCursor) {
    this.#offset = cursor.offset;
    this.#pendingBoundaryId = cursor.pendingBoundaryId;
    this.#resumedCursor = cursor.offset > 0;
  }

  get offset(): number {
    return this.#offset;
  }

  get pendingBoundaryId(): string {
    if (this.#pendingBoundaryId === undefined) {
      throw new Error("Pending boundary ID is required while validating a delivery scan cursor.");
    }

    return this.#pendingBoundaryId;
  }

  requiresBoundaryValidation(): boolean {
    return this.#offset > 0 && this.#pendingBoundaryId !== undefined && !this.#offsetRescan;
  }

  hasResumedCursor(): boolean {
    return this.#resumedCursor;
  }

  readLimit(scanBudget: number, processed: number): number {
    return Math.min(
      inboxStorageAccess.maxReadLimit,
      scanBudget - processed + this.#rescanSeenAllowance,
    );
  }

  resetAfterBoundaryChange(): void {
    this.#offset = 0;
    this.#pendingBoundaryId = undefined;
    this.#offsetRescan = true;
    this.#resumedCursor = false;
    this.#rescanSeenAllowance = inboxStorageAccess.maxReadLimit;
  }

  rewindToHead(): void {
    this.#offset = 0;
    this.#pendingBoundaryId = undefined;
    this.#resumedCursor = false;
  }

  consumeSeenRescanAllowance(): boolean {
    if (this.#rescanSeenAllowance === 0) {
      return false;
    }

    this.#rescanSeenAllowance -= 1;
    return true;
  }

  advancePastPending(message: InboxMessage): void {
    this.#offset += 1;
    this.#pendingBoundaryId = message.id.value;
  }

  shouldRescanShortPage(accepted: number, failed: number): boolean {
    return this.#resumedCursor && accepted === 0 && failed === 0;
  }

  cursor(): DeliveryDrainCursor {
    return drainCursor(this.#offset, this.#pendingBoundaryId);
  }

  finishSkippedScan(accepted: number, failed: number): DeliveryDrainCursor {
    return this.#resumedCursor && accepted === 0 && failed === 0 ? drainCursor(0) : this.cursor();
  }
}

type DeliveryMessageResult =
  | { readonly kind: "SKIPPED" }
  | { readonly kind: "DELIVERED" }
  | { readonly kind: "FAILED"; readonly accepted: boolean; readonly error: unknown };

const defaultShardLeaseMs = 30_000;

function deliveryRun(
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
}

function deliveryDrainOutcome(
  run: DeliveryRun,
  resumeCursor?: DeliveryDrainCursor,
  exhaustedSkippedScan = false,
): DeliveryDrainOutcome {
  return Object.freeze({
    run,
    ...(resumeCursor === undefined ? {} : { resumeCursor }),
    exhaustedSkippedScan,
  });
}

function drainProgress(): DrainProgress {
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
      const run = deliveryRun("DRAINED", processed, accepted, delivered, failures.length, failures);
      const resumableSkippedScan =
        exhaustedSkippedScan && run.accepted === 0 && run.delivered === 0 && run.failed === 0;

      return deliveryDrainOutcome(
        run,
        run.failed > 0 || cursor.offset === 0 ? undefined : cursor,
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
}

function keepShardLease(
  shards: ShardedWorkRegistry,
  session: ShardSession,
  leaseMs: number,
  nowMs: () => number,
  options: ShardLeaseRenewalOptions,
): ShardLeaseKeeper {
  let current = session;
  let failed: unknown;
  let renewing: Promise<void> | undefined;
  const interval = setInterval(
    () => {
      if (renewing !== undefined) {
        return;
      }

      renewing = shards
        .renew(current)
        .then(async (next) => {
          if (next === undefined) {
            failed = new Error("Shard lease was lost.");

            return;
          }
          await options.onRenewClaim(next);
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

  return Object.freeze({
    async awaitRenewal() {
      await renewing;
    },
    async close() {
      clearInterval(interval);
      await renewing;
    },
    requireActive() {
      if (failed !== undefined) {
        throw leaseError(failed);
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
}

class ActiveClaim {
  #claimed: ClaimedInboxMessage | undefined;
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
    this.#claimed = undefined;
    this.#callbackAccepted = false;
    this.#callbackSucceeded = false;
  }

  async clearStored(storage: InboxStorage): Promise<void> {
    await this.#locked(async () => {
      const current = this.#claimed;
      this.#claimed = undefined;
      await clearActiveClaim(storage, current);
    });
  }

  async finalize<T>(callback: (message: ClaimedInboxMessage) => Promise<T>): Promise<T> {
    return this.#locked(async () => {
      const current = this.#claimed;
      this.#claimed = undefined;
      if (current === undefined) {
        throw new Error("Inbox claim was lost.");
      }

      return callback(current);
    });
  }

  markCallbackAccepted(): void {
    this.#callbackAccepted = true;
  }

  markCallbackSucceeded(): void {
    this.#callbackSucceeded = true;
  }

  async renew(storage: InboxStorage, session: ShardSession): Promise<void> {
    await this.#locked(async () => {
      const current = this.#claimed;
      if (current === undefined) {
        return;
      }
      if (claimMatchesSession(current.claim, session)) {
        return;
      }

      const renewed = await inboxStorageAccess.renew(storage, current, session);
      if (renewed === undefined) {
        throw new Error("Inbox claim was lost.");
      }
      this.#claimed = renewed;
    });
  }

  set(message: ClaimedInboxMessage): void {
    this.#claimed = message;
    this.#callbackAccepted = false;
    this.#callbackSucceeded = false;
  }

  async synchronize(storage: InboxStorage, session: ShardSession): Promise<void> {
    await this.#locked(async () => {
      const current = this.#claimed;
      if (current === undefined) {
        throw new Error("Inbox claim was lost.");
      }
      if (claimMatchesSession(current.claim, session)) {
        return;
      }

      const renewed = await inboxStorageAccess.renew(storage, current, session);
      if (renewed === undefined) {
        throw new Error("Inbox claim was lost.");
      }
      this.#claimed = renewed;
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

function claimMatchesSession(claim: InboxClaim, session: ShardSession): boolean {
  return (
    claim.id === session.id &&
    claim.node === session.node &&
    claim.expiresAt.getTime() === session.expiresAt.getTime()
  );
}

function endpointMessage(message: ClaimedInboxMessage): DeliveryEndpointMessage {
  return endpointSnapshot(message);
}

function endpointSnapshot(message: InboxMessage): DeliveryEndpointMessage {
  const label = requireEndpointLabel(message.label);
  const status = requireEndpointStatus(message.status);

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
    ...(message.signal === undefined ? {} : { signal: copySignal(message.signal) }),
    ...(message.keepUntil === undefined ? {} : { keepUntil: new Date(message.keepUntil) }),
  });
}

function copySignal(signal: Any): Any {
  const copied = clone(AnySchema, signal);
  copied.value = new Uint8Array(copied.value);

  return copied;
}

function requireEndpointLabel(label: InboxMessage["label"]): DeliveryEndpointLabel {
  if (isEndpointLabel(label)) {
    return label;
  }

  throw new Error(`Delivery worker does not support "${label}" messages.`);
}

function requireFailureLimit(value: unknown): number | undefined {
  return value === undefined ? undefined : inboxStorageAccess.readLimit(value);
}

function requireDrainCursor(value: unknown): DeliveryDrainCursor {
  if (value === undefined) {
    return drainCursor(0);
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("Delivery resume cursor must be an object.");
  }

  const { offset, pendingBoundaryId } = value as {
    readonly offset?: unknown;
    readonly pendingBoundaryId?: unknown;
  };
  const safeOffset = requireResumeCursorOffset(offset);
  if (safeOffset === 0) {
    return drainCursor(0);
  }
  if (typeof pendingBoundaryId !== "string" || pendingBoundaryId.length === 0) {
    throw new Error("Delivery resume cursor requires a pending boundary message ID.");
  }

  return drainCursor(safeOffset, pendingBoundaryId);
}

function requireResumeCursorOffset(value: unknown): number {
  if (value === undefined) {
    return 0;
  }
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("Delivery resume cursor offset must be a non-negative safe integer.");
  }

  return value as number;
}

function drainCursor(offset: number, pendingBoundaryId?: string): DeliveryDrainCursor {
  if (offset === 0) {
    return Object.freeze({ offset: 0 });
  }
  if (pendingBoundaryId === undefined || pendingBoundaryId.length === 0) {
    throw new Error("Delivery resume cursor requires a pending boundary message ID.");
  }

  return Object.freeze({ offset, pendingBoundaryId });
}

function requireEndpointMessage(message: InboxMessage): DeliveryEndpointMessage {
  return endpointSnapshot(message);
}

function requireEndpointStatus(status: InboxMessage["status"]): DeliveryEndpointMessage["status"] {
  if (status === "TO_DELIVER") {
    return status;
  }

  throw new Error(`Delivery worker does not support "${status}" message status.`);
}

function isEndpointLabel(label: InboxMessage["label"]): label is DeliveryEndpointLabel {
  return (
    label === "HANDLE_COMMAND" || label === "UPDATE_SUBSCRIBER" || label === "REACT_UPON_EVENT"
  );
}

function leaseError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error("Shard lease renewal failed.", { cause: error });
}

async function clearActiveClaim(
  storage: InboxStorage,
  message: ClaimedInboxMessage | undefined,
): Promise<void> {
  if (message === undefined) {
    return;
  }

  const cleared = await inboxStorageAccess.clear(storage, message);
  if (cleared === undefined) {
    throw new Error("Framework cleanup did not clear the pending row.");
  }
}

function claimClearFailure(deliveryError: unknown, clearError: unknown): AggregateError {
  return new AggregateError(
    [deliveryError, clearError],
    "Delivery failed and framework cleanup failed.",
  );
}

function requireDeliveryDrainer(delivery: Delivery): DeliveryDrainer {
  const drainer = deliveryDrainers.get(delivery);
  if (drainer === undefined) {
    throw new TypeError("Loop drain access requires a Delivery instance.");
  }

  return drainer;
}

function requireMessageShard(message: InboxMessage): ShardIndex {
  const idShard = readShard(message.id.shard, "Inbox message ID shard");
  const rowShard = readShard(message.shard, "Inbox message shard");

  if (!sameShard(idShard, rowShard)) {
    throw new InboxMessageError("Inbox message ID shard does not match message shard.");
  }

  return idShard;
}

function snapshotStorageContext(context: StorageContext): StorageContext {
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
}

function readShard(value: unknown, label: string): ShardIndex {
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
}

function sameShard(
  left: Pick<ShardIndex, "index" | "ofTotal">,
  right: Pick<ShardIndex, "index" | "ofTotal">,
): boolean {
  return left.index === right.index && left.ofTotal === right.ofTotal;
}
