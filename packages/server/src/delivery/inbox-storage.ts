import { toBinary } from "@bufbuild/protobuf";
import type {
  InboxMessage as WireInboxMessage,
  InboxMessageId as WireInboxMessageId,
} from "@spine-event-engine/proto/delivery";
import type { RecordStorage, StorageContext, StorageFactory } from "@spine-event-engine/storage";

import {
  InboxMessageError,
  type DeliveryStatus,
  type InboxMessage,
  type InboxMessageId,
  type InboxReadOptions,
  type InboxWriteResult,
} from "./inbox.js";
import { InboxRecords, inboxRecordSpec } from "./inbox-records.js";
import { ShardIndex } from "./shard-index.js";

const defaultReadLimit = 100;
const maxReadLimit = 1_000;

/** Durable storage for generated inbox records. */
export class InboxStorage {
  readonly #context: StorageContext;
  readonly #storageFactory: StorageFactory;
  readonly #now: () => Date;

  constructor(options: InboxStorageOptions) {
    this.#context = options.context;
    this.#storageFactory = options.storageFactory;
    this.#now = options.now ?? (() => new Date());
    Object.freeze(this);
  }

  async read(shard: ShardIndex, options: InboxReadOptions = {}): Promise<readonly InboxMessage[]> {
    const requested = Values.shard(shard);
    const limit = Values.limit(options.limit ?? defaultReadLimit);
    const storage = this.#storage();
    try {
      const rows = await storage.queryEntries({
        filters: [
          { column: "shard_index", value: requested.index },
          { column: "shard_total", value: requested.ofTotal },
          ...(options.statuses === undefined
            ? []
            : [{ column: "status", value: options.statuses.map(Values.status) }]),
        ],
        sort: [{ field: "when_received" }, { field: "version" }, { field: "message_id" }],
        limit,
      });
      return Object.freeze(rows.map((row) => InboxRecords.read(row.record, row.id)));
    } finally {
      storage.close();
    }
  }

  async readMessage(id: InboxMessageId): Promise<InboxMessage | undefined> {
    const wireId = Values.id(id);
    const storage = this.#storage();
    try {
      const record = await storage.read(wireId);
      return record === undefined ? undefined : InboxRecords.read(record, wireId);
    } finally {
      storage.close();
    }
  }

  async write(message: InboxMessage): Promise<InboxWriteResult> {
    const record = InboxRecords.write(message);
    const id = Values.wireId(record);
    const storage = this.#storage();
    try {
      if (await storage.compareAndSet(id, undefined, record)) {
        return Object.freeze({ outcome: "WRITTEN", message: InboxRecords.read(record, id) });
      }
      const existing = await storage.read(id);
      if (existing !== undefined && Values.same(existing, record)) {
        return Object.freeze({ outcome: "DUPLICATE", message: InboxRecords.read(existing, id) });
      }
      throw new InboxMessageError("Inbox message ID already exists.");
    } finally {
      storage.close();
    }
  }

  async markDelivered(message: InboxMessage): Promise<InboxMessage | undefined> {
    const expected = InboxRecords.write(message);
    const id = Values.wireId(expected);
    const storage = this.#storage();
    try {
      const current = await storage.read(id);
      if (current === undefined) return undefined;
      const decoded = InboxRecords.read(current, id);
      if (decoded.status === "DELIVERED") {
        return Values.same(current, InboxRecords.write({ ...message, status: "DELIVERED" }))
          ? decoded
          : undefined;
      }
      if (decoded.status !== "TO_DELIVER" || !Values.same(current, expected)) return undefined;
      const delivered = InboxRecords.write({ ...decoded, status: "DELIVERED" });
      return (await storage.compareAndSet(id, current, delivered))
        ? InboxRecords.read(delivered, id)
        : undefined;
    } finally {
      storage.close();
    }
  }

  /** Admits one exact pending row while the caller owns its shard. */
  async admit(message: InboxMessage): Promise<InboxMessage | undefined> {
    const expected = InboxRecords.write(message);
    const id = Values.wireId(expected);
    const storage = this.#storage();
    try {
      const current = await storage.read(id);
      if (current === undefined || !Values.same(current, expected)) return undefined;
      const pending = InboxRecords.read(current, id);
      if (pending.status !== "TO_DELIVER") return undefined;
      const delivered = await storage.queryEntries({
        filters: [
          { column: "shard_index", value: pending.shard.index },
          { column: "shard_total", value: pending.shard.ofTotal },
          { column: "status", value: Values.status("DELIVERED") },
        ],
        limit: maxReadLimit,
      });
      const predecessor = delivered
        .map((row) => InboxRecords.read(row.record, row.id))
        .find(
          (row) =>
            row.signalId === pending.signalId &&
            row.inboxId.targetId === pending.inboxId.targetId &&
            row.inboxId.targetTypeUrl === pending.inboxId.targetTypeUrl &&
            (row.keepUntil === undefined || row.keepUntil.getTime() > Values.now(this.#now)),
        );
      if (predecessor === undefined) return pending;
      await storage.compareAndSet(
        id,
        current,
        InboxRecords.write({ ...pending, status: "DELIVERED" }),
      );
      return undefined;
    } finally {
      storage.close();
    }
  }

  #storage(): RecordStorage<WireInboxMessageId, WireInboxMessage> {
    return this.#storageFactory.createRecordStorage(Values.context(this.#context), inboxRecordSpec);
  }
}

export interface InboxStorageOptions {
  readonly context: StorageContext;
  readonly storageFactory: StorageFactory;
  readonly now?: () => Date;
}

const Values = Object.freeze({
  status(value: DeliveryStatus): number {
    return { TO_DELIVER: 1, SCHEDULED: 2, DELIVERED: 3, TO_CATCH_UP: 4 }[value];
  },
  id(value: InboxMessageId): WireInboxMessageId {
    return Values.wireId(
      InboxRecords.write({
        id: value,
        inboxId: { targetId: "id", targetTypeUrl: "id" },
        signalId: "id",
        label: "UPDATE_SUBSCRIBER",
        status: "TO_DELIVER",
        shard: value.shard,
        whenReceived: new Date(0),
        version: 0n,
      }),
    );
  },
  wireId(value: WireInboxMessage): WireInboxMessageId {
    if (value.id === undefined) throw new InboxMessageError("Inbox message ID is invalid.");
    return value.id;
  },
  same(left: WireInboxMessage, right: WireInboxMessage): boolean {
    return Buffer.from(toBinary(inboxRecordSpec.recordType, left)).equals(
      Buffer.from(toBinary(inboxRecordSpec.recordType, right)),
    );
  },
  shard(value: unknown): ShardIndex {
    if (!(value instanceof ShardIndex)) throw new InboxMessageError("Inbox shard is invalid.");
    return value;
  },
  limit(value: unknown): number {
    if (
      !Number.isSafeInteger(value) ||
      typeof value !== "number" ||
      value <= 0 ||
      value > maxReadLimit
    ) {
      throw new InboxMessageError(
        `Inbox read limit must be a positive safe integer at most ${String(maxReadLimit)}.`,
      );
    }
    return value;
  },
  now(clock: () => Date): number {
    const value = clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
      throw new InboxMessageError("Inbox storage clock returned an invalid time.");
    return value.getTime();
  },
  context(context: StorageContext): StorageContext {
    return context.multitenant
      ? {
          name: `${context.name}.delivery.inbox`,
          multitenant: true,
          ...(context.tenantId === undefined ? {} : { tenantId: context.tenantId }),
        }
      : { name: `${context.name}.delivery.inbox`, multitenant: false };
  },
});
