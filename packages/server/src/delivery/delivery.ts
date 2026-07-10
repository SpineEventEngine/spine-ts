import type { StorageContext, StorageFactory } from "@spine-ts/storage";

import { Inbox, InboxMessageError, type InboxMessage } from "./inbox.js";
import { inboxStorageAccess, InboxStorage } from "./inbox-storage.js";
import type { ClaimedInboxMessage } from "./inbox-claim.js";
import { ShardIndex } from "./shard-index.js";
import { ShardedWorkRegistry, type ShardSession } from "./sharded-work-registry.js";

/** Delivery owner for inbox storage and shard registry. */
export class Delivery {
  readonly #leaseMs: number;
  readonly #now: () => Date;

  /** Durable inbox facade. */
  readonly inbox: Inbox;
  /** Storage-backed shard registry. */
  readonly shards: ShardedWorkRegistry;

  /** Open delivery from one storage context and factory. */
  constructor(options: DeliveryOptions) {
    this.#leaseMs = Delivery.#requireLeaseMs(options.leaseMs);
    this.#now = options.now ?? (() => new Date());
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
    Object.freeze(this);
  }

  static #requireLeaseMs(value: unknown = defaultShardLeaseMs): number {
    if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maxLeaseMs) {
      throw new Error(
        `ShardedWorkRegistry leaseMs must be a positive safe integer at most ${String(maxLeaseMs)}.`,
      );
    }

    return value as number;
  }

  /**
   * Drain one shard through the framework-owned direct worker boundary.
   *
   * The drain first picks up the shard with lease fencing, then scans
   * `TO_DELIVER` rows in inbox order. `limit` bounds accepted endpoint work and
   * the initial scan window; later scan pages advance past unavailable rows
   * before endpoint invocation. The `onMessage` endpoint receives a public
   * `InboxMessage` snapshot only for supported worker labels:
   * `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`, and `REACT_UPON_EVENT`.
   * Worker-unsupported labels remain pending and are skipped before callback
   * invocation.
   *
   * The returned `DeliveryRun` reports whether the shard was drained or
   * skipped, how many rows were read, accepted for work, delivered, or failed,
   * and the per-message failures observed during this run. This method does not
   * schedule later runs, open transports, or retain endpoint attempt history.
   */
  async drain(shard: ShardIndex, options: DeliveryDrainOptions): Promise<DeliveryRun> {
    const limit = inboxStorageAccess.readLimit(options.limit);
    const session = await this.shards.pickUp(shard, options.node);
    if (session === undefined) {
      return deliveryRun("SKIPPED", 0, 0, 0, 0, []);
    }
    const active = new ActiveClaim();
    const lease = keepShardLease(this.shards, session, this.#leaseMs, () => this.#now().getTime(), {
      renewClaim: (next) => active.renew(this.inbox.storage, next),
    });

    try {
      return await this.#drainAvailableMessages(
        session.shard,
        limit,
        options.onMessage,
        lease,
        active,
      );
    } finally {
      await lease.close();
      await this.shards.release(session);
    }
  }

  async #drainAvailableMessages(
    shard: ShardIndex,
    limit: number,
    onMessage: DeliveryEndpoint,
    lease: ShardLeaseKeeper,
    active: ActiveClaim,
  ): Promise<DeliveryRun> {
    const progress = drainProgress();
    let readLimit = limit;
    let offset = 0;

    for (;;) {
      const messages = await this.#readPendingDeliveryPage(shard, readLimit, offset);

      for (const message of messages) {
        const remainsPending = await this.#tryDrainMessage(
          progress,
          message,
          onMessage,
          lease,
          active,
        );
        if (remainsPending) {
          offset += 1;
        }
        if (progress.accepted >= limit) {
          return progress.finish();
        }
      }

      if (messages.length < readLimit) {
        return progress.finish();
      }
      readLimit = Math.min(readLimit + limit, inboxStorageAccess.maxReadLimit);
    }
  }

  async #readPendingDeliveryPage(
    shard: ShardIndex,
    limit: number,
    offset: number,
  ): Promise<readonly InboxMessage[]> {
    return this.inbox.read(shard, {
      statuses: ["TO_DELIVER"],
      limit,
      offset,
    });
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
    const shard = requireMessageShard(message);
    const id = Object.freeze({
      value: message.id.value,
      shard,
    });
    const session = await this.shards.pickUp(shard, options.node);
    if (session === undefined) {
      return deliveryRun("SKIPPED", 0, 0, 0, 0, []);
    }
    const active = new ActiveClaim();
    const lease = keepShardLease(this.shards, session, this.#leaseMs, () => this.#now().getTime(), {
      renewClaim: (next) => active.renew(this.inbox.storage, next),
    });

    try {
      if (!sameShard(session.shard, shard)) {
        throw new InboxMessageError("Inbox message lease shard does not match message shard.");
      }

      const pending = await this.#readPendingMessage(id, shard);
      if (pending === undefined) {
        return deliveryRun("DRAINED", 0, 0, 0, 0, []);
      }

      return this.#drainExactMessage(pending, options.onMessage, lease, active);
    } finally {
      await lease.close();
      await this.shards.release(session);
    }
  }

  async #readPendingMessage(
    id: InboxMessage["id"],
    shard: ShardIndex,
  ): Promise<InboxMessage | undefined> {
    const pending = await this.inbox.readMessage(id);
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
    message: InboxMessage,
    onMessage: DeliveryEndpoint,
    lease: ShardLeaseKeeper,
    active: ActiveClaim,
  ): Promise<DeliveryRun> {
    if (!isEndpointLabel(message.label)) {
      return deliveryRun("DRAINED", 1, 0, 0, 0, []);
    }

    const attempt = await this.#deliverMessage(message, onMessage, lease, active);
    if (attempt.kind === "SKIPPED") {
      return deliveryRun("DRAINED", 1, 0, 0, 0, []);
    }
    if (attempt.kind === "DELIVERED") {
      return deliveryRun("DRAINED", 1, 1, 1, 0, []);
    }

    const failures = [Object.freeze({ message, error: attempt.error })];

    return deliveryRun("DRAINED", 1, 1, 0, 1, failures);
  }

  async #deliverMessage(
    message: InboxMessage,
    onMessage: DeliveryEndpoint,
    lease: ShardLeaseKeeper,
    active: ActiveClaim,
  ): Promise<DeliveryMessageResult> {
    try {
      const claimed = await this.#claimMessageForDelivery(message, lease);
      if (claimed === undefined) {
        return { kind: "SKIPPED" };
      }

      active.set(claimed);
      await this.#invokeEndpoint(claimed, onMessage, lease, active);
      await this.#markActiveDelivered(message, lease, active);

      return { kind: "DELIVERED" };
    } catch (error) {
      return Object.freeze({
        kind: "FAILED" as const,
        error: await this.#clearFailedClaim(error, active),
      });
    } finally {
      active.clear();
    }
  }

  async #claimMessageForDelivery(
    message: InboxMessage,
    lease: ShardLeaseKeeper,
  ): Promise<ClaimedInboxMessage | undefined> {
    lease.requireActive();

    return inboxStorageAccess.claim(this.inbox.storage, message, lease.session());
  }

  async #invokeEndpoint(
    message: ClaimedInboxMessage,
    onMessage: DeliveryEndpoint,
    lease: ShardLeaseKeeper,
    active: ActiveClaim,
  ): Promise<void> {
    await lease.awaitRenewal();
    lease.requireActive();
    requireEndpointLabel(message.label);
    await onMessage(endpointMessage(message));
    active.markCallbackSucceeded();
  }

  async #markActiveDelivered(
    message: InboxMessage,
    lease: ShardLeaseKeeper,
    active: ActiveClaim,
  ): Promise<void> {
    await lease.awaitRenewal();
    lease.requireActive();

    const marked = await active.finalize((current) =>
      inboxStorageAccess.markDelivered(this.inbox.storage, current),
    );
    if (marked === undefined) {
      throw new Error(`Inbox message "${message.id.value}" was not marked delivered.`);
    }
  }

  async #clearFailedClaim(error: unknown, active: ActiveClaim): Promise<unknown> {
    if (active.callbackSucceeded()) {
      return error;
    }

    try {
      await active.clearStored(this.inbox.storage);

      return error;
    } catch (clearError) {
      return claimClearFailure(error, clearError);
    }
  }

  async #tryDrainMessage(
    progress: DrainProgress,
    message: InboxMessage,
    onMessage: DeliveryEndpoint,
    lease: ShardLeaseKeeper,
    active: ActiveClaim,
  ): Promise<boolean> {
    if (!progress.observe(message)) {
      return true;
    }

    if (!isEndpointLabel(message.label)) {
      return true;
    }

    const attempt = await this.#deliverMessage(message, onMessage, lease, active);
    progress.record(message, attempt);

    return attempt.kind !== "DELIVERED";
  }
}

/** Delivery construction options. */
export interface DeliveryOptions {
  /** Storage context owning delivery data. */
  readonly context: StorageContext;
  /** Storage factory used for durable delivery records. */
  readonly storageFactory: StorageFactory;
  /** Optional shard lease duration in milliseconds. */
  readonly leaseMs?: number;
  /** Optional clock used for delivery timing decisions such as lease and dedup expiry. */
  readonly now?: () => Date;
}

/** Options for one direct delivery shard drain. */
export interface DeliveryDrainOptions {
  /** Worker node name used for shard pickup. */
  readonly node: string;
  /** Optional positive accepted-work cap and initial scan window for one drain run. */
  readonly limit?: number;
  /** Framework endpoint callback invoked for each available supported worker row. */
  readonly onMessage: DeliveryEndpoint;
}

/** Options for one exact-message delivery drain. */
export interface DeliveryMessageDrainOptions {
  /** Worker node name used for shard pickup. */
  readonly node: string;
  /** Framework endpoint callback invoked for each available supported worker row. */
  readonly onMessage: DeliveryEndpoint;
}

/** Framework endpoint callback for one durable inbox row. */
export type DeliveryEndpoint = (message: InboxMessage) => Promise<void> | void;

/** Simple delivery worker run statistics. */
export interface DeliveryRun {
  /** Whether a shard was picked up and drained or skipped because another worker owns it. */
  readonly status: "DRAINED" | "SKIPPED";
  /** Number of pending rows read for this run. */
  readonly processed: number;
  /** Number of rows accepted for endpoint work or fail-closed validation. */
  readonly accepted: number;
  /** Number of rows whose endpoint callback succeeded and were marked delivered. */
  readonly delivered: number;
  /** Number of endpoint callback, validation, lease/fencing, status update, or cleanup failures. */
  readonly failed: number;
  /** Per-message failures kept only in the returned run result. */
  readonly failures: readonly DeliveryFailure[];
}

/** Failure from one message in a direct delivery run. */
export interface DeliveryFailure {
  /** Message that failed during this run. */
  readonly message: InboxMessage;
  /**
   * Error observed during endpoint callback, fail-closed validation,
   * lease/fencing, delivery-status update, or framework cleanup work.
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
  readonly renewClaim: (session: ShardSession) => Promise<void>;
}

interface DrainProgress {
  readonly accepted: number;
  readonly finish: () => DeliveryRun;
  readonly observe: (message: InboxMessage) => boolean;
  readonly record: (message: InboxMessage, attempt: DeliveryMessageResult) => void;
}

type DeliveryMessageResult =
  | { readonly kind: "SKIPPED" }
  | { readonly kind: "DELIVERED" }
  | { readonly kind: "FAILED"; readonly error: unknown };

const defaultShardLeaseMs = 30_000;
const maxLeaseMs = 2_147_483_647;

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
    finish() {
      return deliveryRun("DRAINED", processed, accepted, delivered, failures.length, failures);
    },
    observe(message: InboxMessage) {
      if (seen.has(message.id.value)) {
        return false;
      }
      seen.add(message.id.value);
      processed += 1;

      return true;
    },
    record(message: InboxMessage, attempt: DeliveryMessageResult) {
      if (attempt.kind === "SKIPPED") {
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
          await options.renewClaim(next);
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
        throw failed;
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
  #deliveredCallback = false;
  #lock: Promise<void> = Promise.resolve();

  callbackSucceeded(): boolean {
    return this.#deliveredCallback;
  }

  clear(): void {
    this.#claimed = undefined;
    this.#deliveredCallback = false;
  }

  async clearStored(storage: InboxStorage): Promise<void> {
    await this.#locked(async () => {
      const current = this.#claimed;
      this.#claimed = undefined;
      await clearActiveClaim(storage, current);
    });
  }

  async finalize<T>(action: (message: ClaimedInboxMessage) => Promise<T>): Promise<T> {
    return this.#locked(async () => {
      const current = this.#claimed;
      this.#claimed = undefined;
      if (current === undefined) {
        throw new Error("Inbox claim was lost.");
      }

      return action(current);
    });
  }

  markCallbackSucceeded(): void {
    this.#deliveredCallback = true;
  }

  async renew(storage: InboxStorage, session: ShardSession): Promise<void> {
    await this.#locked(async () => {
      if (this.#claimed === undefined) {
        return;
      }

      const renewed = await inboxStorageAccess.renew(storage, this.#claimed, session);
      if (renewed === undefined) {
        throw new Error("Inbox claim was lost.");
      }
      this.#claimed = renewed;
    });
  }

  set(message: ClaimedInboxMessage): void {
    this.#claimed = message;
    this.#deliveredCallback = false;
  }

  async #locked<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.#lock;
    let release: () => void = () => undefined;
    this.#lock = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }
}

function endpointMessage(message: ClaimedInboxMessage): InboxMessage {
  const { claim: _claim, ...unclaimed } = message;
  return Object.freeze(unclaimed);
}

function requireEndpointLabel(label: InboxMessage["label"]): void {
  if (isEndpointLabel(label)) {
    return;
  }

  throw new Error(`Delivery worker does not support "${label}" messages.`);
}

function isEndpointLabel(label: InboxMessage["label"]): boolean {
  return (
    label === "HANDLE_COMMAND" || label === "UPDATE_SUBSCRIBER" || label === "REACT_UPON_EVENT"
  );
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

function requireMessageShard(message: InboxMessage): ShardIndex {
  const idShard = readShard(message.id.shard, "Inbox message ID shard");
  const rowShard = readShard(message.shard, "Inbox message shard");

  if (!sameShard(idShard, rowShard)) {
    throw new InboxMessageError("Inbox message ID shard does not match message shard.");
  }

  return idShard;
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
