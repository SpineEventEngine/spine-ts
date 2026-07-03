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
  dedupGuardKey,
  dedupRecordSpec,
  inboxRecordSpec,
  isPendingDedupRecord,
  readDedupGuard,
  readPendingMessage,
  readInboxMessage,
  writeDedupClaim,
  writeDedupRecord,
  writeInboxMessage,
  type DedupGuardState,
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
      const records = await storage.queryEntries({
        filters: [{ column: "shard", value: shard.key() }, ...statusFilters(options.statuses)],
        sort: [{ field: "receivedAt" }, { field: "version" }, { field: "messageId" }],
        limit: options.limit ?? defaultReadLimit,
      });

      return Object.freeze(records.map((entry) => readInboxMessage(entry.record, entry.id)));
    } finally {
      storage.close();
    }
  }

  /** Write one inbox message unless a live dedup key already exists. */
  async write(message: InboxMessage): Promise<InboxWriteResult> {
    // Serialize the inbox row once so validation and all later CAS keys use
    // one immutable caller-input snapshot.
    const snapshot = readInboxMessage(writeInboxMessage(message));
    writeDedupClaim(snapshot);

    const inboxStorage = this.#inboxStorage();
    const dedupStorage = this.#dedupStorage();

    try {
      return await this.#writeWithDedup(inboxStorage, dedupStorage, snapshot);
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

    const storedGuard = await this.#readGuardMessage(inboxStorage, dedupKey, current);

    if (storedGuard !== undefined) {
      return this.#handleStoredGuardMessage(dedupStorage, dedupKey, current, storedGuard, message);
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
    storedGuard: GuardMessage,
    message: InboxMessage,
  ): Promise<WriteStep> {
    const { guard, message: storedMessage } = storedGuard;
    const now = this.#dedupNow();
    let expected = current;
    if (isPendingDedupRecord(current)) {
      expected = writeDedupRecord(storedMessage);
      const finalized = await dedupStorage.compareAndSet(dedupKey, current, expected);
      if (!finalized) {
        return { kind: "RETRY" };
      }
    }

    return this.#messageBlocks(guard, now)
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

    const now = this.#dedupNow();
    const storedMessage = await this.#ensureInboxRow(
      inboxStorage,
      pendingMessage,
      "STORAGE_CORRUPTION",
    );

    const finalRecord = writeDedupRecord(storedMessage);
    const finalized = await dedupStorage.compareAndSet(dedupKey, current, finalRecord);
    if (!finalized) {
      return { kind: "RETRY" };
    }

    return this.#messageBlocks(storedMessage, now)
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

    let storedMessage: InboxMessage;
    try {
      storedMessage = await this.#ensureInboxRow(inboxStorage, step.message);
    } catch (error) {
      await dedupStorage.compareAndSet(dedupKey, pending, step.expected);
      throw error;
    }

    const finalized = await dedupStorage.compareAndSet(
      dedupKey,
      pending,
      writeDedupRecord(storedMessage),
    );
    return finalized ? this.#written(storedMessage).result : undefined;
  }

  async #ensureInboxRow(
    inboxStorage: RecordStorage<string, Any>,
    message: InboxMessage,
    conflict: InboxConflict = "CALLER_INPUT",
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

      const storedMessage = readInboxMessage(current, key);
      if (this.#sameRecord(writeInboxMessage(storedMessage), record)) {
        return storedMessage;
      }

      if (conflict === "STORAGE_CORRUPTION") {
        throw new DeliveryStorageCorruptionError(
          `Inbox message "${key}" already exists with conflicting inbox bytes.`,
        );
      }

      throw new InboxMessageError(`Inbox message "${key}" already exists.`);
    }
  }

  async #readGuardMessage(
    inboxStorage: RecordStorage<string, Any>,
    dedupKey: string,
    guard: Any,
  ): Promise<GuardMessage | undefined> {
    const guardState = readDedupGuard(guard, dedupKey);
    const expectedKey = this.#messageKey(guardState.messageId);
    const storedRecord = await inboxStorage.read(expectedKey);
    if (storedRecord === undefined) {
      return undefined;
    }

    const message = readInboxMessage(storedRecord, expectedKey);
    if (dedupGuardKey(message) !== dedupKey) {
      throw new DeliveryStorageCorruptionError(
        `Inbox dedup guard "${dedupKey}" points to another dedup key.`,
      );
    }

    const pendingMessage = isPendingDedupRecord(guard) ? readPendingMessage(guard) : undefined;
    if (
      pendingMessage !== undefined &&
      !this.#sameRecord(writeInboxMessage(pendingMessage), storedRecord)
    ) {
      throw new DeliveryStorageCorruptionError(
        `Inbox pending dedup guard "${dedupKey}" does not match the visible inbox row.`,
      );
    }

    if (pendingMessage === undefined && !this.#sameGuardMetadata(guardState, message)) {
      throw new DeliveryStorageCorruptionError(
        `Inbox final dedup guard "${dedupKey}" does not match the visible inbox row.`,
      );
    }

    return Object.freeze({ guard: guardState, message });
  }

  #messageBlocks(message: Pick<InboxMessage, "status" | "keepUntil">, now: number): boolean {
    if (message.status !== "DELIVERED") {
      return true;
    }

    return message.keepUntil !== undefined && message.keepUntil.getTime() >= now;
  }

  #dedupNow(): number {
    const now = this.#now();
    if (!(now instanceof Date)) {
      throw new Error("Inbox storage clock must return a Date.");
    }

    const time = now.getTime();
    if (!Number.isFinite(time)) {
      throw new Error("Inbox storage clock returned an invalid time.");
    }

    return time;
  }

  #sameRecord(left: Any, right: Any): boolean {
    return (
      left.typeUrl === right.typeUrl && Buffer.from(left.value).equals(Buffer.from(right.value))
    );
  }

  #sameGuardMetadata(
    guard: Pick<DedupGuardState, "status" | "keepUntil">,
    message: Pick<InboxMessage, "status" | "keepUntil">,
  ): boolean {
    return guard.status === message.status && this.#sameTime(guard.keepUntil, message.keepUntil);
  }

  #sameTime(left: Date | undefined, right: Date | undefined): boolean {
    return left?.getTime() === right?.getTime();
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

interface GuardMessage {
  readonly guard: DedupGuardState;
  readonly message: InboxMessage;
}

type InboxConflict = "CALLER_INPUT" | "STORAGE_CORRUPTION";
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
