import type { StorageContext, StorageFactory } from "@spine-ts/storage";

import { Inbox, InboxMessageError, type InboxMessage } from "./inbox.js";
import { InboxStorage } from "./inbox-storage.js";
import { ShardIndex } from "./shard-index.js";
import { ShardedWorkRegistry, type ShardSession } from "./sharded-work-registry.js";

/** Delivery owner for inbox storage and shard registry. */
export class Delivery {
  readonly #leaseMs: number;

  /** Durable inbox facade. */
  readonly inbox: Inbox;
  /** Storage-backed shard registry. */
  readonly shards: ShardedWorkRegistry;

  /** Open delivery from one storage context and factory. */
  constructor(options: DeliveryOptions) {
    this.#leaseMs = options.leaseMs ?? 30_000;
    this.inbox = new Inbox(
      new InboxStorage({
        context: options.context,
        storageFactory: options.storageFactory,
        ...(options.now === undefined ? {} : { now: options.now }),
      }),
    );
    this.shards = new ShardedWorkRegistry({
      context: options.context,
      storageFactory: options.storageFactory,
      ...(options.leaseMs === undefined ? {} : { leaseMs: options.leaseMs }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    Object.freeze(this);
  }

  /**
   * Drain one shard by claiming it, delivering pending rows, and releasing it.
   *
   * The `onMessage` endpoint is invoked once for each `TO_DELIVER` row read in
   * inbox order. Callback failures leave the row pending for a later run.
   * Successful callbacks are followed by an exact-message `Inbox.markDelivered()`
   * update; marker failures are reported as per-message failures.
   *
   * This is a framework-owned direct worker boundary. It does not schedule
   * later runs, open transports, or retain endpoint attempt history.
   */
  async drain(shard: ShardIndex, options: DeliveryDrainOptions): Promise<DeliveryRun> {
    const session = await this.shards.pickUp(shard, options.node);
    if (session === undefined) {
      return deliveryRun("SKIPPED", 0, 0, 0, []);
    }
    const lease = keepShardLease(this.shards, session, this.#leaseMs);

    try {
      const messages = await this.inbox.read(session.shard, {
        statuses: ["TO_DELIVER"],
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      });
      let delivered = 0;
      const failures: DeliveryFailure[] = [];

      for (const message of messages) {
        try {
          lease.requireActive();
          await options.onMessage(message);
          lease.requireActive();
          const marked = await this.inbox.markDelivered(message);
          if (marked === undefined) {
            throw new Error(`Inbox message "${message.id.value}" was not marked delivered.`);
          }
          delivered += 1;
        } catch (error) {
          failures.push(Object.freeze({ message, error }));
        }
      }

      return deliveryRun("DRAINED", messages.length, delivered, failures.length, failures);
    } finally {
      await lease.close();
      await this.shards.release(session);
    }
  }

  /**
   * Drain one exact pending inbox message by claiming its shard and replaying only that row.
   *
   * Local framework handoffs use this when the caller has just written a durable row and must not
   * run unrelated pending rows from the same shard.
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
      return deliveryRun("SKIPPED", 0, 0, 0, []);
    }
    const lease = keepShardLease(this.shards, session, this.#leaseMs);

    try {
      if (!sameShard(session.shard, shard)) {
        throw new InboxMessageError("Inbox message lease shard does not match message shard.");
      }

      const pending = await this.inbox.readMessage(id);
      if (pending?.status !== "TO_DELIVER") {
        return deliveryRun("DRAINED", 0, 0, 0, []);
      }
      const pendingShard = requireMessageShard(pending);
      if (!sameShard(pendingShard, shard)) {
        throw new InboxMessageError("Inbox message row shard does not match message shard.");
      }

      try {
        lease.requireActive();
        await options.onMessage(pending);
        lease.requireActive();
        const marked = await this.inbox.markDelivered(pending);
        if (marked === undefined) {
          throw new Error(`Inbox message "${pending.id.value}" was not marked delivered.`);
        }

        return deliveryRun("DRAINED", 1, 1, 0, []);
      } catch (error) {
        const failures = [Object.freeze({ message: pending, error })];

        return deliveryRun("DRAINED", 1, 0, 1, failures);
      }
    } finally {
      await lease.close();
      await this.shards.release(session);
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
  /** Framework endpoint callback invoked once per pending inbox row. */
  readonly onMessage: DeliveryEndpoint;
}

/** Options for one exact-message delivery drain. */
export interface DeliveryMessageDrainOptions {
  /** Worker node name used for shard pickup. */
  readonly node: string;
  /** Framework endpoint callback invoked for the pending inbox row. */
  readonly onMessage: DeliveryEndpoint;
}

/** Framework endpoint callback for one durable inbox row. */
export type DeliveryEndpoint = (message: InboxMessage) => Promise<void> | void;

/** Simple delivery worker run statistics. */
export interface DeliveryRun {
  /** Whether a shard was claimed and drained or skipped because another worker owns it. */
  readonly status: "DRAINED" | "SKIPPED";
  /** Number of pending rows read for this run. */
  readonly processed: number;
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
  readonly close: () => Promise<void>;
  readonly requireActive: () => void;
}

function deliveryRun(
  status: DeliveryRun["status"],
  processed: number,
  delivered: number,
  failed: number,
  failures: readonly DeliveryFailure[],
): DeliveryRun {
  return Object.freeze({
    status,
    processed,
    delivered,
    failed,
    failures: Object.freeze([...failures]),
  });
}

function keepShardLease(
  shards: ShardedWorkRegistry,
  session: ShardSession,
  leaseMs: number,
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
        .then((next) => {
          if (next === undefined) {
            failed = new Error("Shard lease was lost.");

            return;
          }
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
    async close() {
      clearInterval(interval);
      await renewing;
    },
    requireActive() {
      if (failed !== undefined) {
        throw failed;
      }
    },
  });
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
