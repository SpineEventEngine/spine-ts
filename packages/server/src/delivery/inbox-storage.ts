import type { Any } from "@bufbuild/protobuf/wkt";
import type { RecordStorage, StorageContext, StorageFactory } from "@spine-ts/storage";

import { DeliveryStorageCorruptionError } from "./delivery-storage-error.js";
import {
  InboxMessageError,
  type DeliveryStatus,
  type InboxMessage,
  type InboxReadOptions,
  type InboxWriteResult,
} from "./inbox.js";
import {
  dedupMessageId,
  dedupGuardKey,
  dedupRecordSpec,
  inboxRecordSpec,
  isPendingDedupRecord,
  readPendingMessage,
  readInboxMessage,
  writeDedupClaim,
  writeDedupRecord,
  writeInboxMessage,
} from "./inbox-records.js";
import { ShardIndex } from "./shard-index.js";

const defaultReadLimit = 100;

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
    if (message.id.shard.key() !== message.shard.key()) {
      throw new InboxMessageError("Inbox message ID shard does not match message shard.");
    }

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
      const step = await this.#readWriteStep(inboxStorage, dedupStorage, dedupKey, message);
      if (step.kind === "RETURN") {
        return step.result;
      }
      if (step.kind === "RETRY") {
        continue;
      }
      const result = await this.#claimAndWrite(inboxStorage, dedupStorage, dedupKey, step);
      if (result !== undefined) {
        return result;
      }
    }
  }

  async #readWriteStep(
    inboxStorage: RecordStorage<string, Any>,
    dedupStorage: RecordStorage<string, Any>,
    dedupKey: string,
    message: InboxMessage,
  ): Promise<WriteStep> {
    const current = await dedupStorage.read(dedupKey);
    if (current === undefined) {
      return { kind: "CLAIM", expected: undefined, message };
    }

    const storedMessage = await this.#readGuardMessage(inboxStorage, dedupKey, current);

    if (storedMessage !== undefined) {
      return this.#handleStoredGuardMessage(
        dedupStorage,
        dedupKey,
        current,
        storedMessage,
        message,
      );
    }

    if (!isPendingDedupRecord(current)) {
      throw new DeliveryStorageCorruptionError(
        `Inbox dedup guard "${dedupKey}" points to a missing inbox message.`,
      );
    }

    return this.#recoverPendingClaim(inboxStorage, dedupStorage, dedupKey, current, message);
  }

  async #handleStoredGuardMessage(
    dedupStorage: RecordStorage<string, Any>,
    dedupKey: string,
    current: Any,
    storedMessage: InboxMessage,
    message: InboxMessage,
  ): Promise<WriteStep> {
    let expected = current;
    if (isPendingDedupRecord(current)) {
      expected = writeDedupRecord(storedMessage);
      const finalized = await dedupStorage.compareAndSet(dedupKey, current, expected);
      if (!finalized) {
        return { kind: "RETRY" };
      }
    }

    return this.#messageBlocks(storedMessage, this.#now())
      ? this.#duplicate(storedMessage)
      : { kind: "CLAIM", expected, message };
  }

  async #recoverPendingClaim(
    inboxStorage: RecordStorage<string, Any>,
    dedupStorage: RecordStorage<string, Any>,
    dedupKey: string,
    current: Any,
    message: InboxMessage,
  ): Promise<WriteStep> {
    const pendingMessage = readPendingMessage(current);
    if (pendingMessage === undefined) {
      return { kind: "RETRY" };
    }

    const storedMessage = await this.#ensureInboxRow(inboxStorage, pendingMessage);
    const finalRecord = writeDedupRecord(storedMessage);
    const finalized = await dedupStorage.compareAndSet(dedupKey, current, finalRecord);
    if (!finalized) {
      return { kind: "RETRY" };
    }

    return this.#messageBlocks(storedMessage, this.#now())
      ? this.#written(storedMessage)
      : { kind: "CLAIM", expected: finalRecord, message };
  }

  async #claimAndWrite(
    inboxStorage: RecordStorage<string, Any>,
    dedupStorage: RecordStorage<string, Any>,
    dedupKey: string,
    step: WriteClaim,
  ): Promise<InboxWriteResult | undefined> {
    const pending = writeDedupClaim(step.message);
    const claimed = await dedupStorage.compareAndSet(dedupKey, step.expected, pending);
    if (!claimed) {
      return undefined;
    }

    try {
      const storedMessage = await this.#ensureInboxRow(inboxStorage, step.message);
      const finalized = await dedupStorage.compareAndSet(
        dedupKey,
        pending,
        writeDedupRecord(storedMessage),
      );
      return finalized ? this.#written(storedMessage).result : undefined;
    } catch (error) {
      await dedupStorage.compareAndSet(dedupKey, pending, step.expected);
      throw error;
    }
  }

  async #ensureInboxRow(
    inboxStorage: RecordStorage<string, Any>,
    message: InboxMessage,
  ): Promise<InboxMessage> {
    const key = this.#messageKey(message.id);
    const record = writeInboxMessage(message);

    for (;;) {
      if (await inboxStorage.compareAndSet(key, undefined, record)) {
        return readInboxMessage(record);
      }

      const current = await inboxStorage.read(key);
      if (current === undefined) {
        continue;
      }

      if (this.#sameRecord(current, record)) {
        return readInboxMessage(current);
      }

      throw new Error(`Inbox message "${key}" already exists.`);
    }
  }

  async #readGuardMessage(
    inboxStorage: RecordStorage<string, Any>,
    dedupKey: string,
    guard: Any,
  ): Promise<InboxMessage | undefined> {
    const storedRecord = await inboxStorage.read(this.#messageKey(dedupMessageId(guard)));
    if (storedRecord === undefined) {
      return undefined;
    }

    const message = readInboxMessage(storedRecord);
    if (dedupGuardKey(message) !== dedupKey) {
      throw new DeliveryStorageCorruptionError(
        `Inbox dedup guard "${dedupKey}" points to another dedup key.`,
      );
    }

    return message;
  }

  #messageBlocks(message: InboxMessage, now: Date): boolean {
    if (message.status !== "DELIVERED") {
      return true;
    }

    return message.keepUntil !== undefined && message.keepUntil.getTime() >= now.getTime();
  }

  #sameRecord(left: Any, right: Any): boolean {
    return (
      left.typeUrl === right.typeUrl && Buffer.from(left.value).equals(Buffer.from(right.value))
    );
  }

  #written(message: InboxMessage): WriteReturn {
    return {
      kind: "RETURN",
      result: Object.freeze({
        outcome: "WRITTEN" as const,
        message,
      }),
    };
  }

  #duplicate(message: InboxMessage): WriteReturn {
    return {
      kind: "RETURN",
      result: Object.freeze({
        outcome: "DUPLICATE" as const,
        message,
      }),
    };
  }

  #messageKey(id: Pick<InboxMessage["id"], "value" | "shard">): string {
    return `${id.shard.key()}:${id.value}`;
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

interface WriteClaim {
  readonly kind: "CLAIM";
  readonly expected: Any | undefined;
  readonly message: InboxMessage;
}

interface WriteReturn {
  readonly kind: "RETURN";
  readonly result: InboxWriteResult;
}

type WriteStep = WriteClaim | WriteReturn | { readonly kind: "RETRY" };

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
