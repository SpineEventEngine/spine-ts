import type { StorageContext, StorageFactory } from "@spine-ts/storage";

import { Inbox } from "./inbox.js";
import { InboxStorage } from "./inbox-storage.js";
import type { InboxId } from "./inbox.js";
import { ShardIndex } from "./shard-index.js";
import { ShardedWorkRegistry } from "./sharded-work-registry.js";

/** Delivery owner for inbox storage, shard registry, and shard strategy. */
export class Delivery {
  /** Durable inbox facade. */
  readonly inbox: Inbox;
  /** Storage-backed shard registry. */
  readonly shards: ShardedWorkRegistry;
  /** Shard routing strategy. */
  readonly strategy: DeliveryStrategy;

  /** Open delivery from one storage context and factory. */
  constructor(options: DeliveryOptions) {
    this.strategy = options.strategy ?? new LocalDeliveryStrategy();
    this.inbox = new Inbox(
      new InboxStorage({
        context: options.context,
        storageFactory: options.storageFactory,
      }),
    );
    this.shards = new ShardedWorkRegistry({
      context: options.context,
      storageFactory: options.storageFactory,
      ...(options.leaseMs === undefined ? {} : { leaseMs: options.leaseMs }),
    });
    Object.freeze(this);
  }
}

/** Delivery construction options. */
export interface DeliveryOptions {
  /** Storage context owning delivery data. */
  readonly context: StorageContext;
  /** Storage factory used for durable delivery records. */
  readonly storageFactory: StorageFactory;
  /** Optional shard routing strategy. */
  readonly strategy?: DeliveryStrategy;
  /** Optional shard lease duration in milliseconds. */
  readonly leaseMs?: number;
}

/** Shard routing strategy for one inbox target. */
export interface DeliveryStrategy {
  /** Determine a shard for one inbox target. */
  determineIndex(inboxId: InboxId): ShardIndex;
}

/** Local default delivery strategy. */
export class LocalDeliveryStrategy implements DeliveryStrategy {
  readonly #ofTotal: number;

  /** Route all local delivery through one shard by default. */
  constructor(ofTotal = 1) {
    if (!Number.isInteger(ofTotal) || ofTotal <= 0) {
      throw new Error("LocalDeliveryStrategy shard count must be a positive integer.");
    }
    this.#ofTotal = ofTotal;
    Object.freeze(this);
  }

  /** Determine the stable shard for one target inbox. */
  determineIndex(inboxId: InboxId): ShardIndex {
    if (this.#ofTotal === 1) {
      return ShardIndex.single();
    }

    return new ShardIndex(hashInbox(inboxId) % this.#ofTotal, this.#ofTotal);
  }
}

function hashInbox(inboxId: InboxId): number {
  const value = `${inboxId.targetTypeUrl}:${inboxId.targetId}`;
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}
