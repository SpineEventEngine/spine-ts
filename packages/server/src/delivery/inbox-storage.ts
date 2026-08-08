import { create, toBinary } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import type {
  InboxMessage as WireInboxMessage,
  InboxMessageId as WireInboxMessageId,
} from "@spine-event-engine/proto/delivery";
import { InboxMessageIdSchema } from "@spine-event-engine/proto/delivery";
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
const dedupReadLimit = 2;
const maxDedupReadPages = maxReadLimit / dedupReadLimit;

/**
 * Stores direct generated inbox records in the configured durable family.
 */
export class InboxStorage {
  readonly #context: StorageContext;
  readonly #storageFactory: StorageFactory;
  readonly #now: () => Date;

  /**
   * Opens direct inbox storage.
   *
   * @param options Configures the storage context, factory, and optional clock.
   */
  constructor(options: InboxStorageOptions) {
    this.#context = options.context;
    this.#storageFactory = options.storageFactory;
    this.#now = options.now ?? (() => new Date());
    Object.freeze(this);
  }

  /**
   * Reads ordered direct inbox rows from one shard.
   *
   * @param shard Identifies the shard to query.
   * @param options Filters and bounds the returned page.
   * @returns The matching durable inbox messages.
   */
  async read(shard: ShardIndex, options: InboxReadOptions = {}): Promise<readonly InboxMessage[]> {
    const requested = Values.shard(shard);
    const limit = Values.limit(options.limit ?? defaultReadLimit);
    const offset = Values.offset(options.offset);
    const after = Values.after(options.after, requested);
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
        ...(offset === undefined ? {} : { offset }),
        ...(after === undefined ? {} : { after }),
      });
      return Object.freeze(rows.map((row) => InboxRecords.read(row.record, row.id)));
    } finally {
      storage.close();
    }
  }

  /**
   * Reads one exact direct inbox row.
   *
   * @param id Identifies the message and shard.
   * @returns The durable message, or `undefined` when it is absent.
   */
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

  /**
   * Writes one direct inbox row without overwriting a collision.
   *
   * @param message Supplies the message to persist.
   * @returns Whether the row was written or matched an existing duplicate.
   */
  async write(message: InboxMessage): Promise<InboxWriteResult> {
    const record = InboxRecords.write(message);
    const id = Values.wireId(record);
    const storage = this.#storage();
    try {
      Values.atomic(storage);
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

  /**
   * Marks one exact pending row delivered.
   *
   * @param message Supplies the expected pending snapshot.
   * @returns The delivered row, or `undefined` when the snapshot no longer matches.
   */
  async markDelivered(message: InboxMessage): Promise<InboxMessage | undefined> {
    const expected = InboxRecords.write(message);
    const id = Values.wireId(expected);
    const storage = this.#storage();
    try {
      Values.atomic(storage);
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
      if (await storage.compareAndSet(id, current, delivered))
        return InboxRecords.read(delivered, id);
      const successor = await storage.read(id);
      return successor !== undefined && Values.same(successor, delivered)
        ? InboxRecords.read(successor, id)
        : undefined;
    } finally {
      storage.close();
    }
  }

  /**
   * Returns one exact pending row while the caller owns its shard.
   *
   * @param message Supplies the expected pending snapshot.
   * @returns The admitted row, or `undefined` when it is unavailable or duplicated.
   */
  async admit(message: InboxMessage): Promise<InboxMessage | undefined> {
    const expected = InboxRecords.write(message);
    const id = Values.wireId(expected);
    const storage = this.#storage();
    try {
      Values.atomic(storage);
      const current = await storage.read(id);
      if (current === undefined || !Values.same(current, expected)) return undefined;
      const pending = InboxRecords.read(current, id);
      if (pending.status !== "TO_DELIVER") return undefined;
      let after: ReturnType<typeof Values.after> | undefined;
      for (let page = 0; page < maxDedupReadPages; page++) {
        const delivered = await storage.queryEntries({
          filters: [
            { column: "inbox_id", value: expected.inboxId },
            { column: "signal_id", value: expected.signalId },
            { column: "status", value: Values.status("DELIVERED") },
          ],
          sort: [{ field: "when_received" }, { field: "version" }, { field: "message_id" }],
          limit: dedupReadLimit,
          ...(after === undefined ? {} : { after }),
        });
        const rows = delivered.map((row) => InboxRecords.read(row.record, row.id));
        if (
          rows.some(
            (row) =>
              row.signalId === pending.signalId &&
              row.inboxId.targetId === pending.inboxId.targetId &&
              row.inboxId.targetTypeUrl === pending.inboxId.targetTypeUrl &&
              (row.keepUntil === undefined || row.keepUntil.getTime() > Values.now(this.#now)),
          )
        ) {
          await storage.compareAndSet(
            id,
            current,
            InboxRecords.write({ ...pending, status: "DELIVERED" }),
          );
          return undefined;
        }
        if (rows.length < dedupReadLimit) return pending;
        const last = rows.at(-1);
        if (last === undefined) return pending;
        after = Values.after(
          { messageId: last.id.value, whenReceived: last.whenReceived, version: last.version },
          pending.shard,
        );
      }
      throw new InboxMessageError("Inbox deduplication scan reached its finite bound.");
    } finally {
      storage.close();
    }
  }

  #storage(): RecordStorage<WireInboxMessageId, WireInboxMessage> {
    return this.#storageFactory.createRecordStorage(Values.context(this.#context), inboxRecordSpec);
  }
}

/**
 * Configures direct durable inbox storage.
 */
export interface InboxStorageOptions {
  // prettier-ignore

  /**
   * Storage context that owns this inbox family.
   */
  readonly context: StorageContext;

  /**
   * Factory that opens the direct inbox record storage.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Returns the current time used when evaluating delivered-row retention.
   *
   * @returns The current time.
   */
  readonly now?: () => Date;
}

const Values = Object.freeze({
  status(value: DeliveryStatus): number {
    return { TO_DELIVER: 1, SCHEDULED: 2, DELIVERED: 3, TO_CATCH_UP: 4 }[value];
  },
  id(value: InboxMessageId): WireInboxMessageId {
    return create(InboxMessageIdSchema, {
      uuid: value.value,
      index: { index: value.shard.index, ofTotal: value.shard.ofTotal },
    });
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
  offset(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
      throw new InboxMessageError("Inbox read offset must be a non-negative safe integer.");
    return value;
  },
  after(value: InboxReadOptions["after"], shard: ShardIndex) {
    if (value === undefined) return undefined;
    if (
      typeof value.messageId !== "string" ||
      value.messageId.trim().length === 0 ||
      !(value.whenReceived instanceof Date) ||
      !Number.isFinite(value.whenReceived.getTime()) ||
      typeof value.version !== "bigint" ||
      value.version < 0n ||
      value.version > BigInt(0x7fffffff)
    )
      throw new InboxMessageError("Inbox read continuation is invalid.");
    return {
      values: [
        { field: "when_received", value: Values.timestamp(value.whenReceived.getTime()) },
        { field: "version", value: Number(value.version) },
        { field: "message_id", value: value.messageId },
      ],
      id: Values.id({ value: value.messageId, shard }),
    };
  },
  timestamp(ms: number) {
    return create(TimestampSchema, {
      seconds: BigInt(Math.floor(ms / 1_000)),
      nanos: (ms % 1_000) * 1_000_000,
    });
  },
  atomic(storage: RecordStorage<WireInboxMessageId, WireInboxMessage>): void {
    if (!storage.atomicCompareAndSet)
      throw new InboxMessageError("Inbox storage requires atomic compare-and-set.");
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
