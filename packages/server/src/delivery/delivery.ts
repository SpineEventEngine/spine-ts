import type { StorageContext, StorageFactory } from "@spine-ts/storage";

import { Inbox, InboxMessageError, type InboxMessage } from "./inbox.js";
import { inboxStorageAccess, InboxStorage, requireInboxReadLimit } from "./inbox-storage.js";
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
    this.#leaseMs = options.leaseMs ?? 30_000;
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
      ...(options.leaseMs === undefined ? {} : { leaseMs: options.leaseMs }),
      now: this.#now,
    });
    Object.freeze(this);
  }

  /**
   * Drain one shard through the framework-owned direct worker boundary.
   *
   * The drain first picks up the shard with lease fencing, then reads
   * `TO_DELIVER` rows in inbox order. Rows unavailable to this worker are
   * skipped before endpoint invocation. The `onMessage` endpoint receives a
   * public `InboxMessage` snapshot only for supported worker labels:
   * `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`, and `REACT_UPON_EVENT`.
   * Unsupported labels fail closed before the callback runs.
   *
   * The returned `DeliveryRun` reports whether the shard was drained or
   * skipped, how many rows were read, accepted for work, delivered, or failed,
   * and the per-message failures observed during this run. This method does not
   * schedule later runs, open transports, or retain endpoint attempt history.
   */
  async drain(shard: ShardIndex, options: DeliveryDrainOptions): Promise<DeliveryRun> {
    const limit = options.limit === undefined ? undefined : requireInboxReadLimit(options.limit);
    const session = await this.shards.pickUp(shard, options.node);
    if (session === undefined) {
      return deliveryRun("SKIPPED", 0, 0, 0, 0, []);
    }
    const active = activeClaim();
    const lease = keepShardLease(this.shards, session, this.#leaseMs, () => this.#now().getTime(), {
      renewClaim: (next) => active.renew(this.inbox.storage, next),
    });

    try {
      const messages = await this.inbox.read(session.shard, {
        statuses: ["TO_DELIVER"],
        ...(limit === undefined ? {} : { limit }),
      });
      let accepted = 0;
      let delivered = 0;
      const failures: DeliveryFailure[] = [];

      for (const message of messages) {
        const attempt = await this.#deliverMessage(message, options.onMessage, lease, active);
        if (attempt.kind === "SKIPPED") {
          continue;
        }
        accepted += 1;
        if (attempt.kind === "DELIVERED") {
          delivered += 1;
        } else {
          failures.push(Object.freeze({ message, error: attempt.error }));
        }
      }

      return deliveryRun(
        "DRAINED",
        messages.length,
        accepted,
        delivered,
        failures.length,
        failures,
      );
    } finally {
      await lease.close();
      await this.shards.release(session);
    }
  }

  /**
   * Drain one exact pending inbox message through the local worker boundary.
   *
   * Local framework handoffs use this when the caller has just written a
   * durable row and must not run unrelated pending rows from the same shard.
   * The message shard is picked up with lease fencing; if the row is already
   * unavailable, no endpoint callback runs. Supported callbacks are limited to
   * `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`, and `REACT_UPON_EVENT`; unsupported
   * labels fail closed before the callback.
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
    const active = activeClaim();
    const lease = keepShardLease(this.shards, session, this.#leaseMs, () => this.#now().getTime(), {
      renewClaim: (next) => active.renew(this.inbox.storage, next),
    });

    try {
      if (!sameShard(session.shard, shard)) {
        throw new InboxMessageError("Inbox message lease shard does not match message shard.");
      }

      const pending = await this.inbox.readMessage(id);
      if (pending?.status !== "TO_DELIVER") {
        return deliveryRun("DRAINED", 0, 0, 0, 0, []);
      }
      const pendingShard = requireMessageShard(pending);
      if (!sameShard(pendingShard, shard)) {
        throw new InboxMessageError("Inbox message row shard does not match message shard.");
      }

      const attempt = await this.#deliverMessage(pending, options.onMessage, lease, active);
      if (attempt.kind === "SKIPPED") {
        return deliveryRun("DRAINED", 1, 0, 0, 0, []);
      }
      if (attempt.kind === "DELIVERED") {
        return deliveryRun("DRAINED", 1, 1, 1, 0, []);
      }

      const failures = [Object.freeze({ message: pending, error: attempt.error })];

      return deliveryRun("DRAINED", 1, 1, 0, 1, failures);
    } finally {
      await lease.close();
      await this.shards.release(session);
    }
  }

  async #deliverMessage(
    message: InboxMessage,
    onMessage: DeliveryEndpoint,
    lease: ShardLeaseKeeper,
    active: ActiveClaim,
  ): Promise<DeliveryMessageResult> {
    try {
      lease.requireActive();
      const claimed = await inboxStorageAccess.claim(this.inbox.storage, message, lease.session());
      if (claimed === undefined) {
        return { kind: "SKIPPED" };
      }

      active.set(claimed);
      await lease.awaitRenewal();
      lease.requireActive();
      requireEndpointLabel(claimed.label);
      await onMessage(endpointMessage(claimed));
      active.markCallbackSucceeded();
      await lease.awaitRenewal();
      lease.requireActive();

      const marked = await active.finalize((current) =>
        inboxStorageAccess.markDelivered(this.inbox.storage, current),
      );
      if (marked === undefined) {
        throw new Error(`Inbox message "${message.id.value}" was not marked delivered.`);
      }

      return { kind: "DELIVERED" };
    } catch (error) {
      if (!active.callbackSucceeded()) {
        await active.clearStored(this.inbox.storage);
      }

      return Object.freeze({ kind: "FAILED" as const, error });
    } finally {
      active.clear();
    }
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
  /** Optional positive page size for one drain run. */
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
  /** Number of endpoint or delivery-marking failures. */
  readonly failed: number;
  /** Per-message failures kept only in the returned run result. */
  readonly failures: readonly DeliveryFailure[];
}

/** Failure from one message in a direct delivery run. */
export interface DeliveryFailure {
  /** Message that failed during this run. */
  readonly message: InboxMessage;
  /** Error thrown by the endpoint callback or delivery status update. */
  readonly error: unknown;
}

interface ShardLeaseKeeper {
  readonly awaitRenewal: () => Promise<void>;
  readonly close: () => Promise<void>;
  readonly requireActive: () => void;
  readonly session: () => ShardSession;
}

interface ActiveClaim {
  readonly callbackSucceeded: () => boolean;
  readonly clear: () => void;
  readonly clearStored: (storage: InboxStorage) => Promise<void>;
  readonly finalize: <T>(action: (message: ClaimedInboxMessage) => Promise<T>) => Promise<T>;
  readonly markCallbackSucceeded: () => void;
  readonly renew: (storage: InboxStorage, session: ShardSession) => Promise<void>;
  readonly set: (message: ClaimedInboxMessage) => void;
}

interface ShardLeaseRenewalOptions {
  readonly renewClaim: (session: ShardSession) => Promise<void>;
}

type DeliveryMessageResult =
  | { readonly kind: "SKIPPED" }
  | { readonly kind: "DELIVERED" }
  | { readonly kind: "FAILED"; readonly error: unknown };

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

function activeClaim(): ActiveClaim {
  let claimed: ClaimedInboxMessage | undefined;
  let deliveredCallback = false;
  let lock: Promise<void> = Promise.resolve();

  async function locked<T>(action: () => Promise<T>): Promise<T> {
    const previous = lock;
    let release: () => void = () => undefined;
    lock = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }

  return Object.freeze({
    callbackSucceeded() {
      return deliveredCallback;
    },
    clear() {
      claimed = undefined;
      deliveredCallback = false;
    },
    async clearStored(storage: InboxStorage) {
      await locked(async () => {
        const current = claimed;
        claimed = undefined;
        await clearActiveClaim(storage, current);
      });
    },
    async finalize<T>(action: (message: ClaimedInboxMessage) => Promise<T>) {
      return locked(async () => {
        const current = claimed;
        claimed = undefined;
        if (current === undefined) {
          throw new Error("Inbox claim was lost.");
        }

        return action(current);
      });
    },
    markCallbackSucceeded() {
      deliveredCallback = true;
    },
    async renew(storage: InboxStorage, session: ShardSession) {
      await locked(async () => {
        if (claimed === undefined) {
          return;
        }

        const renewed = await inboxStorageAccess.renew(storage, claimed, session);
        if (renewed === undefined) {
          throw new Error("Inbox claim was lost.");
        }
        claimed = renewed;
      });
    },
    set(message: ClaimedInboxMessage) {
      claimed = message;
      deliveredCallback = false;
    },
  });
}

function endpointMessage(message: ClaimedInboxMessage): InboxMessage {
  const { claim: _claim, ...unclaimed } = message;
  return Object.freeze(unclaimed);
}

function requireEndpointLabel(label: InboxMessage["label"]): void {
  if (label === "HANDLE_COMMAND" || label === "UPDATE_SUBSCRIBER" || label === "REACT_UPON_EVENT") {
    return;
  }

  throw new Error(`Delivery worker does not support "${label}" messages.`);
}

async function ignoreClearError(message: Promise<InboxMessage | undefined>): Promise<void> {
  try {
    await message;
  } catch {
    // Preserve the original endpoint or marker failure reported by the drain.
  }
}

async function clearActiveClaim(
  storage: InboxStorage,
  message: ClaimedInboxMessage | undefined,
): Promise<void> {
  if (message === undefined) {
    return;
  }

  await ignoreClearError(inboxStorageAccess.clear(storage, message));
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
