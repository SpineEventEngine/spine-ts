import type { StorageContext, StorageFactory } from "@spine-ts/storage";

import { Inbox, InboxMessageError, type InboxMessage } from "./inbox.js";
import { InboxStorage } from "./inbox-storage.js";
import type { ShardIndex } from "./shard-index.js";
import { ShardedWorkRegistry } from "./sharded-work-registry.js";

/** Delivery owner for inbox storage and shard registry. */
export class Delivery {
  /** Durable inbox facade. */
  readonly inbox: Inbox;
  /** Storage-backed shard registry. */
  readonly shards: ShardedWorkRegistry;

  /** Open delivery from one storage context and factory. */
  constructor(options: DeliveryOptions) {
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

    try {
      const messages = await this.inbox.read(session.shard, {
        statuses: ["TO_DELIVER"],
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      });
      let delivered = 0;
      const failures: DeliveryFailure[] = [];

      for (const message of messages) {
        try {
          await options.onMessage(message);
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
    assertMessageShardMatchesId(message);
    const session = await this.shards.pickUp(message.shard, options.node);
    if (session === undefined) {
      return deliveryRun("SKIPPED", 0, 0, 0, []);
    }

    try {
      const pending = await this.inbox.readMessage(message.id);
      if (pending === undefined || pending.status !== "TO_DELIVER") {
        return deliveryRun("DRAINED", 0, 0, 0, []);
      }

      try {
        await options.onMessage(pending);
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

function assertMessageShardMatchesId(message: InboxMessage): void {
  if (message.id.shard.key() !== message.shard.key()) {
    throw new InboxMessageError("Inbox message ID shard does not match message shard.");
  }
}
