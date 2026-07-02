import type { Any } from "@bufbuild/protobuf/wkt";
import type { RecordStorage, StorageContext, StorageFactory } from "@spine-ts/storage";

import { DeliveryStorageCorruptionError } from "./delivery-storage-error.js";
import type { DeliveryStatus, InboxMessage, InboxReadOptions, InboxWriteResult } from "./inbox.js";
import {
  dedupMessageId,
  dedupGuardKey,
  dedupRecordSpec,
  inboxRecordSpec,
  readDedupRecord,
  readInboxMessage,
  writeDedupClaim,
  writeDedupRecord,
  writeInboxMessage,
} from "./inbox-records.js";
import { ShardIndex } from "./shard-index.js";

const defaultReadLimit = 100;
const dedupClaimMs = 250;
const pendingRetryMs = 10;

/** Durable inbox storage over record storage. */
export class InboxStorage {
  readonly #context: StorageContext;
  readonly #storageFactory: StorageFactory;
  readonly #now: () => Date;

  /** Open an inbox storage from one storage context and storage factory. */
  constructor(options: InboxStorageOptions) {
    this.#context = options.context;
    this.#storageFactory = options.storageFactory;
    this.#now = options.now ?? (() => new Date());
    Object.freeze(this);
  }

  /** Read ordered inbox messages for one shard. */
  async read(shard: ShardIndex, options: InboxReadOptions = {}): Promise<readonly InboxMessage[]> {
    const storage = this.#inboxStorage();

    try {
      const records = await storage.query({
        filters: [{ column: "shard", value: shard.key() }, ...statusFilters(options.statuses)],
        sort: [{ field: "receivedAt" }, { field: "version" }, { field: "messageId" }],
        limit: options.limit ?? defaultReadLimit,
      });

      return Object.freeze(records.map((record) => readInboxMessage(record)));
    } finally {
      storage.close();
    }
  }

  /** Write one inbox message unless a live dedup key already exists. */
  async write(message: InboxMessage): Promise<InboxWriteResult> {
    const inboxStorage = this.#inboxStorage();
    const dedupStorage = this.#dedupStorage();

    try {
      return await this.#writeWithDedup(inboxStorage, dedupStorage, message);
    } finally {
      inboxStorage.close();
      dedupStorage.close();
    }
  }

  async #writeWithDedup(
    inboxStorage: RecordStorage<string, Any>,
    dedupStorage: RecordStorage<string, Any>,
    message: InboxMessage,
  ): Promise<InboxWriteResult> {
    const dedupKey = dedupGuardKey(message);

    for (;;) {
      const now = this.#now();
      const currentDedup = await dedupStorage.read(dedupKey);
      const guard = currentDedup === undefined ? undefined : readDedupRecord(currentDedup);

      if (guard !== undefined) {
        const storedMessage = await this.#readGuardMessage(inboxStorage, guard);

        if (storedMessage !== undefined) {
          if (guard.state === "PENDING") {
            await dedupStorage.compareAndSet(
              dedupKey,
              currentDedup,
              writeDedupRecord(storedMessage),
            );
          }

          if (this.#messageBlocks(storedMessage, now)) {
            return Object.freeze({
              outcome: "DUPLICATE" as const,
              message: storedMessage,
            });
          }
        } else if (guard.state === "FINAL") {
          throw new DeliveryStorageCorruptionError(
            `Inbox dedup guard "${dedupKey}" points to a missing inbox message.`,
          );
        } else if (!this.#claimExpired(guard, now)) {
          await this.#waitPending();
          continue;
        }
      }

      const claimedMessage =
        guard?.state === "PENDING" ? this.#restoreMessage(message, guard) : message;
      const pendingDedup = writeDedupClaim(claimedMessage, now);
      const claimed = await dedupStorage.compareAndSet(dedupKey, currentDedup, pendingDedup);
      if (!claimed) {
        continue;
      }

      try {
        await inboxStorage.write(writeInboxMessage(claimedMessage));
      } catch (error) {
        await dedupStorage.compareAndSet(dedupKey, pendingDedup, currentDedup);
        throw error;
      }

      await dedupStorage.compareAndSet(dedupKey, pendingDedup, writeDedupRecord(claimedMessage));

      return Object.freeze({
        outcome: "WRITTEN" as const,
        message: readInboxMessage(writeInboxMessage(claimedMessage)),
      });
    }
  }

  async #readGuardMessage(
    inboxStorage: RecordStorage<string, Any>,
    guard: ReturnType<typeof readDedupRecord>,
  ): Promise<InboxMessage | undefined> {
    const storedMessage = await inboxStorage.read(this.#messageKey(guard));
    return storedMessage === undefined ? undefined : readInboxMessage(storedMessage);
  }

  #messageBlocks(message: InboxMessage, now: Date): boolean {
    if (message.status !== "DELIVERED") {
      return true;
    }

    return message.keepUntil !== undefined && message.keepUntil.getTime() >= now.getTime();
  }

  #restoreMessage(message: InboxMessage, guard: ReturnType<typeof readDedupRecord>): InboxMessage {
    const id = dedupMessageId(guard);

    return Object.freeze({
      ...message,
      id,
      shard: id.shard,
    });
  }

  #claimExpired(guard: ReturnType<typeof readDedupRecord>, now: Date): boolean {
    return guard.state === "PENDING" && guard.claimedAtMs + dedupClaimMs <= now.getTime();
  }

  #messageKey(guard: ReturnType<typeof readDedupRecord>): string {
    const id = dedupMessageId(guard);
    return `${id.shard.key()}:${id.value}`;
  }

  #waitPending(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, pendingRetryMs);
    });
  }

  #inboxStorage(): RecordStorage<string, Any> {
    return this.#storageFactory.createRecordStorage(
      inboxStorageContext(this.#context),
      inboxRecordSpec,
    );
  }

  #dedupStorage(): RecordStorage<string, Any> {
    return this.#storageFactory.createRecordStorage(
      dedupStorageContext(this.#context),
      dedupRecordSpec,
    );
  }
}

/** Inbox storage construction options. */
export interface InboxStorageOptions {
  /** Storage context owning this inbox set. */
  readonly context: StorageContext;
  /** Storage factory used for durable records. */
  readonly storageFactory: StorageFactory;
  /** Optional clock used for deduplication retention decisions. */
  readonly now?: () => Date;
}

function statusFilters(statuses: readonly DeliveryStatus[] | undefined) {
  return statuses === undefined || statuses.length === 0
    ? []
    : [{ column: "status", value: [...statuses] as readonly DeliveryStatus[] }];
}

function dedupStorageContext(context: StorageContext): StorageContext {
  return deliveryStorageContext(context, "inbox-dedup");
}

function inboxStorageContext(context: StorageContext): StorageContext {
  return deliveryStorageContext(context, "inbox");
}

function deliveryStorageContext(context: StorageContext, name: string): StorageContext {
  return context.multitenant
    ? {
        name: `${context.name}.delivery.${name}`,
        multitenant: true,
        ...(context.tenantId === undefined ? {} : { tenantId: context.tenantId }),
      }
    : {
        name: `${context.name}.delivery.${name}`,
        multitenant: false,
      };
}
