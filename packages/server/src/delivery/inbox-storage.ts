/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { Time } from "@spine-event-engine/core/time";
import { clone, create, toBinary } from "@bufbuild/protobuf";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import { TenantIdSchema } from "@spine-event-engine/proto";
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
const storageClocks = new WeakMap<InboxStorage, () => Date>();

/**
 * Internal clock access for concrete local inbox delivery.
 * @internal
 */
export const InboxStorageClock: Readonly<{ read(storage: InboxStorage): Date }> = Object.freeze({
  /**
   * Reads the configured storage clock.
   * @param storage Supplies the concrete local storage.
   * @returns Its current retention time.
   */
  read(storage: InboxStorage): Date {
    const clock = storageClocks.get(storage);
    return clock === undefined ? new Date(Time.currentTimeMillis()) : new Date(Values.now(clock));
  },
});

/**
 * Stores direct generated inbox records in the configured durable family.
 */
export class InboxStorage {
  readonly #context: StorageContext;

  readonly #storageFactory: StorageFactory;

  readonly #now: () => Date;

  #retained: RecordStorage<WireInboxMessageId, WireInboxMessage> | undefined;

  #active = 0;

  #closing = false;

  #drained: (() => void) | undefined;

  #closeAttempt: Promise<void> | undefined;

  /**
   * Opens direct inbox storage.
   *
   * @param options Configures the storage context, factory, and optional clock.
   */
  constructor(options: InboxStorageOptions) {
    this.#context = Values.snapshotContext(options.context);
    this.#storageFactory = options.storageFactory;
    this.#now = options.now ?? (() => new Date(Time.currentTimeMillis()));
    storageClocks.set(this, this.#now);
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
      this.#finish();
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
      this.#finish();
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
      this.#finish();
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
      this.#finish();
    }
  }

  /**
   * Removes one eligible delivered row by ID before cancellation or deadline.
   *
   * @param message Supplies the delivered ID and cleanup eligibility.
   * @param options Propagates cancellation and a delivery deadline.
   * @returns Whether direct ID deletion removed a row.
   */
  async removeDelivered(
    message: InboxMessage,
    options?: import("./delivery-ports.js").DeliveryOperationOptions,
  ): Promise<boolean> {
    if (
      message.status !== "DELIVERED" ||
      (message.keepUntil !== undefined && message.keepUntil.getTime() > Values.now(this.#now))
    )
      return false;
    return this.#remove(message, options);
  }

  /**
   * Removes one pending duplicate by ID before cancellation or deadline.
   *
   * @param message Supplies the pending duplicate ID.
   * @param options Propagates cancellation and a delivery deadline.
   * @returns Whether direct ID deletion removed a row.
   */
  async removeDuplicate(
    message: InboxMessage,
    options?: import("./delivery-ports.js").DeliveryOperationOptions,
  ): Promise<boolean> {
    if (message.status !== "TO_DELIVER") return false;
    return this.#remove(message, options);
  }

  async #remove(
    message: InboxMessage,
    options?: import("./delivery-ports.js").DeliveryOperationOptions,
  ): Promise<boolean> {
    const isActive = this.#activeOperation(options);
    if (isActive?.() !== true) return false;
    const storage = this.#storage();
    try {
      if (!isActive()) return false;
      return await storage.delete(Values.id(message.id));
    } finally {
      this.#finish();
    }
  }

  #activeOperation(
    options: import("./delivery-ports.js").DeliveryOperationOptions | undefined,
  ): (() => boolean) | undefined {
    if (
      options?.timeoutMs !== undefined &&
      (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 0)
    )
      return undefined;
    const deadline =
      options?.timeoutMs === undefined ? undefined : Values.now(this.#now) + options.timeoutMs;
    return () =>
      !options?.signal?.aborted && (deadline === undefined || Values.now(this.#now) < deadline);
  }

  #storage(): RecordStorage<WireInboxMessageId, WireInboxMessage> {
    if (this.#closing) throw new Error("Inbox storage is closed.");
    this.#active++;
    try {
      return (this.#retained ??= this.#storageFactory.createRecordStorage(
        Values.context(this.#context),
        inboxRecordSpec,
      ));
    } catch (error) {
      this.#finish();
      throw error;
    }
  }

  #finish(): void {
    this.#active--;
    if (this.#active === 0) this.#drained?.();
  }

  /**
   * Closes the retained physical record handle after admitted work drains.
   *
   * @returns The shared close completion.
   */
  close(): Promise<void> {
    if (this.#closeAttempt !== undefined) return this.#closeAttempt;
    this.#closing = true;
    const drained =
      this.#active === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            this.#drained = resolve;
          });
    return (this.#closeAttempt = drained.then(() => this.#retained?.close()));
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
  /**
   * Copies the storage context and its tenant ID.
   *
   * @param context Supplies the context to copy.
   * @returns A detached context snapshot.
   */
  snapshotContext(context: StorageContext): StorageContext {
    return context.multitenant
      ? {
          name: context.name,
          multitenant: true,
          tenantId: clone(TenantIdSchema, context.tenantId),
        }
      : { name: context.name, multitenant: false };
  },

  /**
   * Converts an inbox status to its stored numeric value.
   *
   * @param value Supplies the inbox status.
   * @returns The stored status value.
   */
  status(value: DeliveryStatus): number {
    switch (value) {
      case "TO_DELIVER":
        return 1;
      case "SCHEDULED":
        return 2;
      case "DELIVERED":
        return 3;
      case "TO_CATCH_UP":
        return 4;
      default:
        throw new InboxMessageError("Inbox read status is invalid.");
    }
  },

  /**
   * Builds the Protobuf inbox message ID from its value and shard.
   *
   * @param value Supplies the inbox message ID.
   * @returns The wire-format message ID.
   */
  id(value: InboxMessageId): WireInboxMessageId {
    return create(InboxMessageIdSchema, {
      uuid: value.value,
      index: { index: value.shard.index, ofTotal: value.shard.ofTotal },
    });
  },

  /**
   * Reads the required ID from a wire inbox message.
   *
   * @param value Supplies the wire inbox message.
   * @returns Its message ID.
   */
  wireId(value: WireInboxMessage): WireInboxMessageId {
    if (value.id === undefined) throw new InboxMessageError("Inbox message ID is invalid.");
    return value.id;
  },

  /**
   * Compares two wire inbox messages by their encoded record data.
   *
   * @param left Supplies the first wire message.
   * @param right Supplies the second wire message.
   * @returns Whether both messages encode to the same data.
   */
  same(left: WireInboxMessage, right: WireInboxMessage): boolean {
    return Buffer.from(toBinary(inboxRecordSpec.recordType, left)).equals(
      Buffer.from(toBinary(inboxRecordSpec.recordType, right)),
    );
  },

  /**
   * Checks and returns a shard index.
   *
   * @param value Supplies the value to check.
   * @returns The valid shard index.
   */
  shard(value: unknown): ShardIndex {
    if (!(value instanceof ShardIndex)) throw new InboxMessageError("Inbox shard is invalid.");
    return value;
  },

  /**
   * Checks an inbox page limit.
   *
   * @param value Supplies the requested limit.
   * @returns The valid page limit.
   */
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

  /**
   * Checks an optional inbox page offset.
   *
   * @param value Supplies the requested offset.
   * @returns The valid offset, or undefined when omitted.
   */
  offset(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
      throw new InboxMessageError("Inbox read offset must be a non-negative safe integer.");
    return value;
  },

  /**
   * Converts and checks a continuation for one shard query.
   *
   * @param value Supplies the continuation, when present.
   * @param shard Identifies the shard being queried.
   * @returns The normalized record-query continuation.
   */
  after(value: InboxReadOptions["after"], shard: ShardIndex) {
    if (value === undefined) return undefined;
    if (
      typeof value.messageId !== "string" ||
      value.messageId.trim().length === 0 ||
      !Values.validReceiveTime(value.whenReceived) ||
      typeof value.version !== "bigint" ||
      value.version < 0n ||
      value.version > BigInt(0x7fffffff)
    )
      throw new InboxMessageError("Inbox read continuation is invalid.");
    return {
      values: [
        { field: "when_received", value: Values.receiveTime(value.whenReceived) },
        { field: "version", value: Number(value.version) },
        { field: "message_id", value: value.messageId },
      ],
      id: Values.id({ value: value.messageId, shard }),
    };
  },

  /**
   * Converts milliseconds to a Protobuf timestamp.
   *
   * @param ms Supplies the time in milliseconds.
   * @returns The equivalent Protobuf timestamp.
   */
  timestamp(ms: number) {
    const seconds = Math.floor(ms / 1_000);
    return create(TimestampSchema, {
      seconds: BigInt(seconds),
      nanos: (ms - seconds * 1_000) * 1_000_000,
    });
  },

  /**
   * Copies a precise inbox receive timestamp.
   * @param value The receive instant supplied by a caller.
   * @returns A detached Protobuf timestamp.
   */
  receiveTime(value: Timestamp): Timestamp {
    return clone(TimestampSchema, value);
  },

  /**
   * Validates the Protobuf timestamp range for an inbox receive time.
   * @param value The receive instant to inspect.
   * @returns Whether the instant can be persisted without loss.
   */
  validReceiveTime(value: Timestamp): boolean {
    return (
      (value as unknown as { $typeName?: string } | null)?.$typeName === TimestampSchema.typeName &&
      value.seconds >= -62_135_596_800n &&
      value.seconds <= 253_402_300_799n &&
      Number.isInteger(value.nanos) &&
      value.nanos >= 0 &&
      value.nanos < 1_000_000_000
    );
  },

  /**
   * Checks for atomic compare-and-set support in inbox record storage.
   *
   * @param storage Supplies the inbox record storage.
   */
  atomic(storage: RecordStorage<WireInboxMessageId, WireInboxMessage>): void {
    if (!storage.atomicCompareAndSet)
      throw new InboxMessageError("Inbox storage requires atomic compare-and-set.");
  },

  /**
   * Reads and validates the configured clock.
   *
   * @param clock Supplies the time source.
   * @returns The current time in milliseconds.
   */
  now(clock: () => Date): number {
    const value = clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
      throw new InboxMessageError("Inbox storage clock returned an invalid time.");
    return value.getTime();
  },

  /**
   * Creates the storage context used for inbox records.
   *
   * @param context Supplies the caller's storage context.
   * @returns The context reserved for delivery inbox storage.
   */
  context(context: StorageContext): StorageContext {
    return context.multitenant
      ? {
          name: `${context.name}.delivery.inbox`,
          multitenant: true,
          tenantId: clone(TenantIdSchema, context.tenantId),
        }
      : { name: `${context.name}.delivery.inbox`, multitenant: false };
  },
});
