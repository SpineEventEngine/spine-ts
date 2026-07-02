import { create } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import {
  RecordColumn,
  RecordSpec,
  type RecordStorage,
  type StorageContext,
  type StorageFactory,
} from "@spine-ts/storage";

import type {
  DeliveryStatus,
  InboxMessage,
  InboxMessageId,
  InboxReadOptions,
  InboxWriteResult,
} from "./inbox.js";
import { ShardIndex } from "./shard-index.js";

/** Durable inbox storage over record storage. */
export class InboxStorage {
  readonly #context: StorageContext;
  readonly #storageFactory: StorageFactory;

  /** Open an inbox storage from one storage context and storage factory. */
  constructor(options: InboxStorageOptions) {
    this.#context = options.context;
    this.#storageFactory = options.storageFactory;
    Object.freeze(this);
  }

  /** Read ordered inbox messages for one shard. */
  async read(shard: ShardIndex, options: InboxReadOptions = {}): Promise<readonly InboxMessage[]> {
    const storage = this.#storage();

    try {
      const filters = [{ column: "shard", value: shard.key() }, ...statusFilters(options.statuses)];
      const records = await storage.query({
        filters,
        sort: [{ field: "receivedAt" }, { field: "version" }],
      });

      return Object.freeze(records.map((record) => readInboxMessage(record)));
    } finally {
      storage.close();
    }
  }

  /** Write one inbox message unless a live dedup key already exists. */
  write(message: InboxMessage): Promise<InboxWriteResult> {
    const lockKey = `${storageContextKey(this.#context)}:${message.signalId}:${inboxKey(message.inboxId)}`;

    return InboxWriteLocks.withLock(this.#storageFactory, lockKey, async () => {
      const storage = this.#storage();

      try {
        const duplicate = await this.#findDuplicate(storage, message, message.whenReceived);
        if (duplicate !== undefined) {
          return Object.freeze({
            outcome: "DUPLICATE" as const,
            message: duplicate,
          });
        }

        await storage.write(writeInboxMessage(message));
        return Object.freeze({
          outcome: "WRITTEN" as const,
          message: cloneMessage(message),
        });
      } finally {
        storage.close();
      }
    });
  }

  async #findDuplicate(
    storage: RecordStorage<string, Any>,
    message: InboxMessage,
    when: Date,
  ): Promise<InboxMessage | undefined> {
    const matches = await storage.query({
      filters: [
        { column: "signalId", value: message.signalId },
        { column: "inbox", value: inboxKey(message.inboxId) },
      ],
      sort: [{ field: "receivedAt" }, { field: "version" }],
    });

    return matches
      .map((record) => readInboxMessage(record))
      .find((candidate) => isDuplicate(candidate, when));
  }

  #storage(): RecordStorage<string, Any> {
    return this.#storageFactory.createRecordStorage(
      inboxStorageContext(this.#context),
      inboxRecordSpec,
    );
  }
}

/** Inbox storage construction options. */
export interface InboxStorageOptions {
  /** Storage context owning this inbox set. */
  readonly context: StorageContext;
  /** Storage factory used for durable records. */
  readonly storageFactory: StorageFactory;
}

interface StoredInboxMessage {
  readonly key: string;
  readonly id: string;
  readonly shard: string;
  readonly shardIndex: number;
  readonly shardTotal: number;
  readonly inbox: string;
  readonly inboxId: {
    readonly targetId: string;
    readonly targetTypeUrl: string;
  };
  readonly signalId: string;
  readonly signal?: Any;
  readonly label: InboxMessage["label"];
  readonly status: DeliveryStatus;
  readonly whenReceivedMs: number;
  readonly version: string;
  readonly keepUntilMs?: number;
}

const inboxRecordSpec = new RecordSpec<string, Any>({
  schema: AnySchema,
  extractId: (record) => readStoredInboxMessage(record).key,
  columns: [
    new RecordColumn("signalId", (record) => readStoredInboxMessage(record).signalId),
    new RecordColumn("inbox", (record) => readStoredInboxMessage(record).inbox),
    new RecordColumn("status", (record) => readStoredInboxMessage(record).status),
    new RecordColumn("label", (record) => readStoredInboxMessage(record).label),
    new RecordColumn("shard", (record) => readStoredInboxMessage(record).shard),
    new RecordColumn("receivedAt", (record) => readStoredInboxMessage(record).whenReceivedMs),
    new RecordColumn("version", (record) => BigInt(readStoredInboxMessage(record).version)),
  ],
});

const InboxWriteLocks = Object.freeze({
  queues: new WeakMap<StorageFactory, Map<string, Promise<void>>>(),

  async withLock<T>(factory: StorageFactory, key: string, work: () => Promise<T>): Promise<T> {
    const queues = this.queueMap(factory);
    const previous = queues.get(key) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    queues.set(
      key,
      previous.then(() => current),
    );

    try {
      await previous;
      return await work();
    } finally {
      release?.();
      if (queues.get(key) === current) {
        queues.delete(key);
      }
    }
  },

  queueMap(factory: StorageFactory): Map<string, Promise<void>> {
    let queues = this.queues.get(factory);

    if (queues === undefined) {
      queues = new Map<string, Promise<void>>();
      this.queues.set(factory, queues);
    }

    return queues;
  },
});

function cloneDefinedDate(value: Date): Date {
  return new Date(value.getTime());
}

function cloneInboxId(value: InboxMessage["inboxId"]): InboxMessage["inboxId"] {
  return Object.freeze({
    targetId: value.targetId,
    targetTypeUrl: value.targetTypeUrl,
  });
}

function cloneMessage(message: InboxMessage): InboxMessage {
  return Object.freeze({
    id: cloneMessageId(message.id),
    inboxId: cloneInboxId(message.inboxId),
    signalId: message.signalId,
    label: message.label,
    status: message.status,
    shard: cloneShard(message.shard),
    whenReceived: new Date(message.whenReceived.getTime()),
    version: message.version,
    ...(message.signal === undefined ? {} : { signal: cloneDefinedSignal(message.signal) }),
    ...(message.keepUntil === undefined ? {} : { keepUntil: cloneDefinedDate(message.keepUntil) }),
  });
}

function cloneMessageId(value: InboxMessageId): InboxMessageId {
  return Object.freeze({
    value: value.value,
    shard: cloneShard(value.shard),
  });
}

function cloneShard(shard: ShardIndex): ShardIndex {
  return new ShardIndex(shard.index, shard.ofTotal);
}

function cloneDefinedSignal(signal: Any): Any {
  return create(AnySchema, {
    typeUrl: signal.typeUrl,
    value: signal.value,
  });
}

function inboxKey(inboxId: InboxMessage["inboxId"]): string {
  return JSON.stringify({
    targetId: inboxId.targetId,
    targetTypeUrl: inboxId.targetTypeUrl,
  });
}

function inboxStorageContext(context: StorageContext): StorageContext {
  return context.multitenant
    ? {
        name: `${context.name}.delivery.inbox`,
        multitenant: true,
        ...(context.tenantId === undefined ? {} : { tenantId: context.tenantId }),
      }
    : {
        name: `${context.name}.delivery.inbox`,
        multitenant: false,
      };
}

function isDuplicate(message: InboxMessage, when: Date): boolean {
  return message.status !== "DELIVERED" || keepUntilActive(message.keepUntil, when);
}

function keepUntilActive(keepUntil: Date | undefined, when: Date): boolean {
  return keepUntil !== undefined && keepUntil.getTime() >= when.getTime();
}

function readInboxMessage(record: Any): InboxMessage {
  const stored = readStoredInboxMessage(record);
  const shard = new ShardIndex(stored.shardIndex, stored.shardTotal);

  return Object.freeze({
    id: Object.freeze({
      value: stored.id,
      shard,
    }),
    inboxId: Object.freeze({
      targetId: stored.inboxId.targetId,
      targetTypeUrl: stored.inboxId.targetTypeUrl,
    }),
    signalId: stored.signalId,
    label: stored.label,
    status: stored.status,
    shard,
    whenReceived: new Date(stored.whenReceivedMs),
    version: BigInt(stored.version),
    ...(stored.signal === undefined ? {} : { signal: cloneDefinedSignal(stored.signal) }),
    ...(stored.keepUntilMs === undefined ? {} : { keepUntil: new Date(stored.keepUntilMs) }),
  });
}

function readStoredInboxMessage(record: Any): StoredInboxMessage {
  if (record.typeUrl !== inboxRecordTypeUrl) {
    throw new Error("Inbox record type URL is invalid.");
  }

  const decoded = JSON.parse(Buffer.from(record.value).toString("utf8")) as StoredInboxMessage;
  if (typeof decoded.key !== "string" || typeof decoded.id !== "string") {
    throw new Error("Inbox record is invalid.");
  }
  return decoded;
}

function statusFilters(statuses: readonly DeliveryStatus[] | undefined) {
  return statuses === undefined || statuses.length === 0
    ? []
    : [{ column: "status", value: [...statuses] as readonly DeliveryStatus[] }];
}

function storageContextKey(context: StorageContext): string {
  return JSON.stringify(
    context.multitenant
      ? {
          name: context.name,
          multitenant: true,
          tenantId: context.tenantId ?? "",
        }
      : {
          name: context.name,
          multitenant: false,
        },
  );
}

function writeInboxMessage(message: InboxMessage): Any {
  const stored: StoredInboxMessage = {
    key: inboxMessageKey(message.id),
    id: message.id.value,
    shard: message.shard.key(),
    shardIndex: message.shard.index,
    shardTotal: message.shard.ofTotal,
    inbox: inboxKey(message.inboxId),
    inboxId: {
      targetId: message.inboxId.targetId,
      targetTypeUrl: message.inboxId.targetTypeUrl,
    },
    signalId: message.signalId,
    label: message.label,
    status: message.status,
    whenReceivedMs: message.whenReceived.getTime(),
    version: message.version.toString(),
    ...(message.signal === undefined ? {} : { signal: cloneDefinedSignal(message.signal) }),
    ...(message.keepUntil === undefined ? {} : { keepUntilMs: message.keepUntil.getTime() }),
  };

  return create(AnySchema, {
    typeUrl: inboxRecordTypeUrl,
    value: Buffer.from(JSON.stringify(stored), "utf8"),
  });
}

function inboxMessageKey(id: InboxMessageId): string {
  return `${id.shard.key()}:${id.value}`;
}

const inboxRecordTypeUrl = "type.spine-ts.dev/internal/InboxMessageRecord";
