import type { Any } from "@bufbuild/protobuf/wkt";
import type { RecordStorage, StorageContext, StorageFactory } from "@spine-ts/storage";

import type { DeliveryStatus, InboxMessage, InboxReadOptions, InboxWriteResult } from "./inbox.js";
import {
  dedupGuardKey,
  dedupRecordBlocks,
  dedupRecordSpec,
  inboxRecordSpec,
  readDedupRecord,
  readInboxMessage,
  writeDedupRecord,
  writeInboxMessage,
} from "./inbox-records.js";
import { ShardIndex } from "./shard-index.js";

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
        ...(options.limit === undefined ? {} : { limit: options.limit }),
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
    const nextDedup = writeDedupRecord(message);

    for (;;) {
      const currentDedup = await dedupStorage.read(dedupKey);

      if (
        currentDedup !== undefined &&
        dedupRecordBlocks(readDedupRecord(currentDedup), this.#now())
      ) {
        return await this.#duplicateResult(inboxStorage, currentDedup, message);
      }

      const claimed = await dedupStorage.compareAndSet(dedupKey, currentDedup, nextDedup);
      if (!claimed) {
        continue;
      }

      try {
        await inboxStorage.write(writeInboxMessage(message));
      } catch (error) {
        await dedupStorage.compareAndSet(dedupKey, nextDedup, currentDedup);
        throw error;
      }

      return Object.freeze({
        outcome: "WRITTEN" as const,
        message: readInboxMessage(writeInboxMessage(message)),
      });
    }
  }

  async #duplicateResult(
    inboxStorage: RecordStorage<string, Any>,
    dedupRecord: Any,
    message: InboxMessage,
  ): Promise<InboxWriteResult> {
    const guard = readDedupRecord(dedupRecord);
    const storedMessage = await inboxStorage.read(guard.inboxMessageKey);

    if (storedMessage === undefined) {
      throw new Error(
        `Delivery storage corruption: inbox dedup guard "${dedupGuardKey(message)}" points to a missing inbox message.`,
      );
    }

    return Object.freeze({
      outcome: "DUPLICATE" as const,
      message: readInboxMessage(storedMessage),
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
