import { create } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import {
  RecordColumn,
  RecordSpec,
  type RecordStorage,
  type StorageContext,
  type StorageFactory,
} from "@spine-event-engine/storage";

import type { DeliveryEndpointMessage } from "./delivery.js";
import { DeliveryStorageCorruptionError } from "./delivery-storage-error.js";
import type { InboxId, InboxMessageId } from "./inbox.js";
import { ShardIndex } from "./shard-index.js";

const attemptTypeUrl = "type.spine-ts.dev/server/delivery/DeliveryAttemptRecord";
const casRetryLimit = 8;
const defaultReadLimit = 1_000;
/** Limits the retained delivery-failure attempts for one inbox message. */
export const deliveryAttemptCapacity = 100;
const maxStoredRecordBytes = 512 * 1024;
const maxTextBytes = 16 * 1024;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

/** Internal durable history of supported delivery endpoint failures. */
export class DeliveryAttempts {
  readonly #context: StorageContext;
  readonly #storageFactory: StorageFactory;

  /**
   * Opens attempt storage from one delivery storage context and factory.
   *
   * @param options - Supplies the owning context and durable storage factory.
   */
  constructor(options: DeliveryAttemptsOptions) {
    this.#context = DeliveryAttemptValues.storageContextSnapshot(options.context);
    this.#storageFactory = options.storageFactory;
    Object.freeze(this);
  }

  /**
   * Reads retained attempts in deterministic storage order.
   *
   * @param options - Limits the read to an optional shard and bounded page size.
   * @returns The retained attempts in storage order.
   */
  async read(options: DeliveryAttemptReadOptions = {}): Promise<readonly DeliveryAttempt[]> {
    const storage = this.#storage();

    try {
      const records = await storage.queryEntries({
        filters: [
          ...(options.shard === undefined
            ? []
            : [
                { column: "shard", value: DeliveryAttemptValues.requireShard(options.shard).key() },
              ]),
        ],
        sort: [{ field: "attemptedAt" }, { field: "sequence" }, { field: "messageKey" }],
        limit: DeliveryAttemptValues.requireLimit(options.limit ?? defaultReadLimit),
      });

      return Object.freeze(
        records.map((entry) =>
          DeliveryAttemptValues.attemptFromStored(
            DeliveryAttemptValues.readStoredAttempt(entry.record, entry.id),
          ),
        ),
      );
    } finally {
      storage.close();
    }
  }

  /**
   * Returns retained attempts for one exact inbox message.
   *
   * @param messageId - Identifies the message whose attempts are summarized.
   * @returns The ordered attempt history and its latest state.
   */
  async summarize(messageId: InboxMessageId): Promise<DeliveryAttemptSummary> {
    const storage = this.#storage();

    try {
      const attempts = await DeliveryAttemptValues.readMessageAttempts(storage, messageId);

      return DeliveryAttemptValues.attemptSummary(attempts);
    } finally {
      storage.close();
    }
  }

  /**
   * Records one supported endpoint failure attempt.
   *
   * @param input - Supplies the sanitized failed-delivery details.
   * @returns A promise that resolves after the failure attempt is recorded.
   */
  async recordFailure(input: DeliveryAttemptInput): Promise<void> {
    const attempt = DeliveryAttemptValues.attemptFromInput(input);
    const storage = this.#storage();

    try {
      await this.#writeAttempt(storage, attempt);
    } finally {
      storage.close();
    }
  }

  async #writeAttempt(storage: RecordStorage<string, Any>, attempt: AttemptInput): Promise<void> {
    for (let index = 0; index < casRetryLimit; index += 1) {
      const sequence = await DeliveryAttemptValues.nextSequence(storage, attempt.messageKey);
      const stored = DeliveryAttemptValues.storedAttempt(attempt, sequence);
      const previous = await storage.read(stored.key);
      const written = await storage.compareAndSet(
        stored.key,
        previous,
        DeliveryAttemptValues.packAttempt(stored),
      );
      if (written) {
        return;
      }
    }

    throw new Error("Delivery attempt could not be recorded due to concurrent changes.");
  }

  #storage(): RecordStorage<string, Any> {
    return this.#storageFactory.createRecordStorage(
      DeliveryAttemptValues.attemptStorageContext(this.#context),
      spec,
    );
  }
}

/** Delivery attempt storage construction options. */
export interface DeliveryAttemptsOptions {
  /** Storage context owning delivery data. */
  readonly context: StorageContext;
  /** Storage factory used for durable delivery records. */
  readonly storageFactory: StorageFactory;
}

/** Read filter for retained delivery attempts. */
export interface DeliveryAttemptReadOptions {
  /** Optional shard to read. */
  readonly shard?: ShardIndex;
  /** Optional bounded page size. Defaults to 1000. */
  readonly limit?: number;
}

/** One retained, sanitized delivery endpoint attempt. */
export interface DeliveryAttempt {
  /** Durable inbox message identity. */
  readonly messageId: InboxMessageId;
  /** Target inbox identity. */
  readonly inboxId: InboxId;
  /** Original signal identity. */
  readonly signalId: string;
  /** Supported endpoint label. */
  readonly label: DeliveryEndpointMessage["label"];
  /** Delivery shard. */
  readonly shard: ShardIndex;
  /** Worker node that attempted delivery. */
  readonly node: string;
  /** Time the framework recorded the failed attempt. */
  readonly attemptedAt: Date;
  /** Whether endpoint callback work had been accepted. */
  readonly accepted: boolean;
  /** Stable framework stage where the failure was observed. */
  readonly stage: DeliveryFailureStage;
  /** Stable bounded reason for retry policy. */
  readonly reason: DeliveryFailureReason;
}

/** Internal exact-message view over retained delivery attempts. */
export interface DeliveryAttemptSummary {
  /** Retained attempts for the message in ascending attempt sequence. */
  readonly attempts: readonly DeliveryAttempt[];
  /** Number of retained attempts for the message. */
  readonly count: number;
  /** Latest retained attempt by sequence, when present. */
  readonly latestAttempt: DeliveryAttempt | undefined;
  /** Latest retained failure stage, when present. */
  readonly latestStage: DeliveryFailureStage | undefined;
  /** Latest retained failure reason, when present. */
  readonly latestReason: DeliveryFailureReason | undefined;
  /** Latest retained accepted flag, when present. */
  readonly latestAccepted: boolean | undefined;
}

/** Stable delivery failure stage retained for retry policy. */
export type DeliveryFailureStage = "CLAIM" | "LEASE" | "ENDPOINT" | "CLEANUP" | "STATUS_UPDATE";

/** Stable delivery failure reason retained for retry policy. */
export type DeliveryFailureReason =
  | "CLAIM_FAILED"
  | "LEASE_INACTIVE"
  | "ENDPOINT_REJECTED"
  | "CLEANUP_FAILED"
  | "STATUS_UPDATE_FAILED";

/** Internal input for recording one failed supported endpoint attempt. */
export interface DeliveryAttemptInput {
  /** Supported endpoint message snapshot. */
  readonly message: DeliveryEndpointMessage;
  /** Worker node that attempted delivery. */
  readonly node: string;
  /** Time the framework records the failed attempt. */
  readonly attemptedAt: Date;
  /** Whether endpoint callback work had been accepted. */
  readonly accepted: boolean;
  /** Stable framework stage where the failure was observed. */
  readonly stage: DeliveryFailureStage;
  /** Stable bounded reason for retry policy. */
  readonly reason: DeliveryFailureReason;
}

interface StoredAttempt {
  readonly key: string;
  readonly messageKey: string;
  readonly messageId: string;
  readonly shard: string;
  readonly shardIndex: number;
  readonly shardTotal: number;
  readonly inbox: string;
  readonly inboxId: {
    readonly targetId: string;
    readonly targetTypeUrl: string;
  };
  readonly signalId: string;
  readonly label: DeliveryEndpointMessage["label"];
  readonly node: string;
  readonly attemptedAtMs: number;
  readonly accepted: boolean;
  readonly stage: DeliveryFailureStage;
  readonly reason: DeliveryFailureReason;
  readonly sequence: number;
}

type AttemptInput = Omit<StoredAttempt, "key" | "sequence">;

const spec: RecordSpec<string, Any> = new RecordSpec<string, Any>({
  schema: AnySchema,
  storageKey: "spine.delivery.Attempt:current",
  idKind: "string",
  extractId: (record) => DeliveryAttemptValues.readStoredAttempt(record).key,
  columns: [
    new RecordColumn(
      "messageKey",
      (record) => DeliveryAttemptValues.readStoredAttempt(record).messageKey,
      "string",
    ),
    new RecordColumn(
      "shard",
      (record) => DeliveryAttemptValues.readStoredAttempt(record).shard,
      "string",
    ),
    new RecordColumn(
      "attemptedAt",
      (record) => DeliveryAttemptValues.readStoredAttempt(record).attemptedAtMs,
      "number",
    ),
    new RecordColumn(
      "sequence",
      (record) => DeliveryAttemptValues.readStoredAttempt(record).sequence,
      "int64",
    ),
  ],
});

const DeliveryAttemptValues = Object.freeze({
  async nextSequence(storage: RecordStorage<string, Any>, messageKey: string): Promise<number> {
    let sequence = 0;

    for (let slot = 1; slot <= deliveryAttemptCapacity; slot += 1) {
      const key = DeliveryAttemptValues.attemptKey(messageKey, slot);
      const record = await storage.read(key);
      if (record === undefined) {
        continue;
      }

      sequence = Math.max(sequence, DeliveryAttemptValues.readStoredAttempt(record, key).sequence);
    }

    if (sequence >= Number.MAX_SAFE_INTEGER) {
      throw new DeliveryStorageCorruptionError(
        "Delivery attempt sequence cannot be incremented safely.",
      );
    }

    return sequence + 1;
  },

  async readMessageAttempts(
    storage: RecordStorage<string, Any>,
    messageId: InboxMessageId,
  ): Promise<readonly StoredAttempt[]> {
    const messageKey = DeliveryAttemptValues.attemptMessageKey(messageId);
    const attempts: StoredAttempt[] = [];

    for (let slot = 1; slot <= deliveryAttemptCapacity; slot += 1) {
      const key = DeliveryAttemptValues.attemptKey(messageKey, slot);
      const record = await storage.read(key);
      if (record !== undefined) {
        attempts.push(DeliveryAttemptValues.readStoredAttempt(record, key));
      }
    }

    return Object.freeze(attempts.sort((first, second) => first.sequence - second.sequence));
  },

  attemptFromInput(input: DeliveryAttemptInput): AttemptInput {
    const message = input.message;
    const shard = DeliveryAttemptValues.requireShard(message.shard);
    const messageId = DeliveryAttemptValues.requireText(
      message.id.value,
      "Delivery attempt message ID",
    );
    const inboxId = DeliveryAttemptValues.inputInboxId(message.inboxId);
    const signalId = DeliveryAttemptValues.requireText(
      message.signalId,
      "Delivery attempt signal ID",
    );
    const node = DeliveryAttemptValues.requireText(input.node, "Delivery attempt node");
    const attemptedAtMs = DeliveryAttemptValues.requireDate(
      input.attemptedAt,
      "Delivery attempt time",
    );

    return Object.freeze({
      messageKey: DeliveryAttemptValues.attemptMessageKey(message.id),
      messageId,
      shard: shard.key(),
      shardIndex: shard.index,
      shardTotal: shard.ofTotal,
      inbox: DeliveryAttemptValues.inboxKey(inboxId),
      inboxId,
      signalId,
      label: DeliveryAttemptValues.requireLabel(message.label),
      node,
      attemptedAtMs,
      accepted: DeliveryAttemptValues.requireBoolean(input.accepted),
      stage: DeliveryAttemptValues.requireStage(input.stage),
      reason: DeliveryAttemptValues.requireReason(input.reason),
    });
  },

  storedAttempt(input: AttemptInput, sequence: number): StoredAttempt {
    return Object.freeze({
      ...input,
      sequence,
      key: DeliveryAttemptValues.attemptKey(input.messageKey, sequence),
    });
  },

  attemptFromStored(stored: StoredAttempt): DeliveryAttempt {
    return Object.freeze({
      messageId: Object.freeze({
        value: stored.messageId,
        shard: new ShardIndex(stored.shardIndex, stored.shardTotal),
      }),
      inboxId: Object.freeze({ ...stored.inboxId }),
      signalId: stored.signalId,
      label: stored.label,
      shard: new ShardIndex(stored.shardIndex, stored.shardTotal),
      node: stored.node,
      attemptedAt: new Date(stored.attemptedAtMs),
      accepted: stored.accepted,
      stage: stored.stage,
      reason: stored.reason,
    });
  },

  attemptSummary(storedAttempts: readonly StoredAttempt[]): DeliveryAttemptSummary {
    const attempts = Object.freeze(storedAttempts.map(DeliveryAttemptValues.attemptFromStored));
    const latestStored = storedAttempts.at(-1);
    const latestAttempt =
      latestStored === undefined
        ? undefined
        : DeliveryAttemptValues.attemptFromStored(latestStored);

    return Object.freeze({
      attempts,
      count: attempts.length,
      latestAttempt,
      latestStage: latestStored?.stage,
      latestReason: latestStored?.reason,
      latestAccepted: latestStored?.accepted,
    });
  },

  packAttempt(stored: StoredAttempt): Any {
    const encoded = Buffer.from(JSON.stringify(stored), "utf8");
    DeliveryAttemptValues.assertStoredRecordSize(encoded);

    return create(AnySchema, {
      typeUrl: attemptTypeUrl,
      value: encoded,
    });
  },

  readStoredAttempt(record: Any, expectedKey?: string): StoredAttempt {
    const decoded = DeliveryAttemptValues.readStoredRecord(record);
    const shard = DeliveryAttemptValues.storedShard(decoded);
    const key = DeliveryAttemptValues.requireText(
      Reflect.get(decoded, "key"),
      "Delivery attempt key",
    );
    if (expectedKey !== undefined && key !== expectedKey) {
      throw new DeliveryStorageCorruptionError(
        `Delivery attempt "${expectedKey}" does not match its storage key.`,
      );
    }

    const messageKey = DeliveryAttemptValues.requireText(
      Reflect.get(decoded, "messageKey"),
      "Delivery attempt message key",
    );
    const messageId = DeliveryAttemptValues.requireText(
      Reflect.get(decoded, "messageId"),
      "Delivery attempt message ID",
    );
    const sequence = DeliveryAttemptValues.requireSequence(Reflect.get(decoded, "sequence"));
    const inboxId = DeliveryAttemptValues.storedInboxId(Reflect.get(decoded, "inboxId"));
    const stored = Object.freeze({
      key,
      messageKey,
      messageId,
      shard: shard.key(),
      shardIndex: shard.index,
      shardTotal: shard.ofTotal,
      inbox: DeliveryAttemptValues.requireText(
        Reflect.get(decoded, "inbox"),
        "Delivery attempt inbox key",
      ),
      inboxId,
      signalId: DeliveryAttemptValues.requireText(
        Reflect.get(decoded, "signalId"),
        "Delivery attempt signal ID",
      ),
      label: DeliveryAttemptValues.requireLabel(Reflect.get(decoded, "label")),
      node: DeliveryAttemptValues.requireText(
        Reflect.get(decoded, "node"),
        "Delivery attempt node",
      ),
      attemptedAtMs: DeliveryAttemptValues.requireTimestamp(Reflect.get(decoded, "attemptedAtMs")),
      accepted: DeliveryAttemptValues.requireBoolean(Reflect.get(decoded, "accepted")),
      stage: DeliveryAttemptValues.requireStage(Reflect.get(decoded, "stage")),
      reason: DeliveryAttemptValues.requireReason(Reflect.get(decoded, "reason")),
      sequence,
    });

    DeliveryAttemptValues.assertAttemptIdentity(stored);

    return stored;
  },

  readStoredRecord(record: Any): Record<string, unknown> {
    const typeUrl = DeliveryAttemptValues.readStoredTypeUrl(record);
    if (typeUrl !== attemptTypeUrl) {
      throw new DeliveryStorageCorruptionError(
        `Delivery attempt record type URL "${typeUrl}" is invalid.`,
      );
    }

    const value = DeliveryAttemptValues.readStoredBytes(record);
    if (value.byteLength > maxStoredRecordBytes) {
      throw new DeliveryStorageCorruptionError(
        `Delivery attempt record exceeds ${String(maxStoredRecordBytes)} bytes and cannot be read.`,
      );
    }

    try {
      const decoded = JSON.parse(DeliveryAttemptValues.decodeStoredUtf8(value)) as unknown;

      if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
        throw new DeliveryStorageCorruptionError("Delivery attempt record is not a JSON object.");
      }

      return decoded as Record<string, unknown>;
    } catch (error) {
      if (error instanceof DeliveryStorageCorruptionError) {
        throw error;
      }

      throw new DeliveryStorageCorruptionError("Delivery attempt record contains malformed JSON.", {
        cause: error,
      });
    }
  },

  readStoredTypeUrl(record: Any): string {
    try {
      return DeliveryAttemptValues.requireText(
        Reflect.get(record, "typeUrl"),
        "Delivery attempt type URL",
      );
    } catch (error) {
      throw DeliveryAttemptValues.corruptionFrom(
        error,
        "Delivery attempt record type URL is invalid.",
      );
    }
  },

  readStoredBytes(record: Any): Uint8Array {
    let value: unknown;
    try {
      value = Reflect.get(record, "value");
    } catch (error) {
      throw new DeliveryStorageCorruptionError("Delivery attempt record value is invalid.", {
        cause: error,
      });
    }
    if (!(value instanceof Uint8Array)) {
      throw new DeliveryStorageCorruptionError("Delivery attempt record value must be bytes.");
    }

    return value;
  },

  decodeStoredUtf8(value: Uint8Array): string {
    try {
      return utf8Decoder.decode(value);
    } catch (error) {
      throw new DeliveryStorageCorruptionError("Delivery attempt record contains invalid UTF-8.", {
        cause: error,
      });
    }
  },

  assertAttemptIdentity(stored: StoredAttempt): void {
    const messageKey = DeliveryAttemptValues.attemptMessageKey({
      value: stored.messageId,
      shard: new ShardIndex(stored.shardIndex, stored.shardTotal),
    });
    if (
      stored.messageKey !== messageKey ||
      stored.shard !== DeliveryAttemptValues.storedMessageShard(stored)
    ) {
      throw new DeliveryStorageCorruptionError(
        "Delivery attempt message identity does not match shard identity.",
      );
    }
    const expectedKey = DeliveryAttemptValues.attemptKey(stored.messageKey, stored.sequence);
    if (stored.key !== expectedKey) {
      throw new DeliveryStorageCorruptionError(
        "Delivery attempt key does not match message identity and sequence.",
      );
    }
    if (stored.inbox !== DeliveryAttemptValues.inboxKey(stored.inboxId)) {
      throw new DeliveryStorageCorruptionError(
        "Delivery attempt inbox identity does not match its composite key.",
      );
    }
  },

  storedMessageShard(stored: Pick<StoredAttempt, "shardIndex" | "shardTotal">): string {
    return new ShardIndex(stored.shardIndex, stored.shardTotal).key();
  },

  inputInboxId(value: InboxId): StoredAttempt["inboxId"] {
    return Object.freeze({
      targetId: DeliveryAttemptValues.requireText(
        value.targetId,
        "Delivery attempt inbox target ID",
      ),
      targetTypeUrl: DeliveryAttemptValues.requireText(
        value.targetTypeUrl,
        "Delivery attempt inbox target type URL",
      ),
    });
  },

  storedInboxId(value: unknown): StoredAttempt["inboxId"] {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new DeliveryStorageCorruptionError("Delivery attempt inbox identity is invalid.");
    }
    const input = value as Record<string, unknown>;

    return Object.freeze({
      targetId: DeliveryAttemptValues.requireText(
        Reflect.get(input, "targetId"),
        "Delivery attempt inbox target ID",
      ),
      targetTypeUrl: DeliveryAttemptValues.requireText(
        Reflect.get(input, "targetTypeUrl"),
        "Delivery attempt inbox target type URL",
      ),
    });
  },

  storedShard(input: Record<string, unknown>): ShardIndex {
    const shardIndex = DeliveryAttemptValues.requireSafeInteger(
      Reflect.get(input, "shardIndex"),
      "Delivery attempt shard index",
    );
    const shardTotal = DeliveryAttemptValues.requireSafeInteger(
      Reflect.get(input, "shardTotal"),
      "Delivery attempt shard total",
    );

    try {
      return new ShardIndex(shardIndex, shardTotal);
    } catch (error) {
      throw DeliveryAttemptValues.corruptionFrom(
        error,
        "Delivery attempt shard identity is invalid.",
      );
    }
  },

  attemptMessageKey(id: InboxMessageId): string {
    const shard = DeliveryAttemptValues.requireShard(id.shard);

    return `${shard.key()}:${DeliveryAttemptValues.requireText(id.value, "Delivery attempt message ID")}`;
  },

  inboxKey(inboxId: StoredAttempt["inboxId"]): string {
    return DeliveryAttemptValues.requireText(
      JSON.stringify({
        targetId: inboxId.targetId,
        targetTypeUrl: inboxId.targetTypeUrl,
      }),
      "Delivery attempt inbox key",
    );
  },

  requireShard(value: ShardIndex): ShardIndex {
    return new ShardIndex(value.index, value.ofTotal);
  },

  requireLabel(value: unknown): DeliveryEndpointMessage["label"] {
    if (
      value === "HANDLE_COMMAND" ||
      value === "UPDATE_SUBSCRIBER" ||
      value === "REACT_UPON_EVENT"
    ) {
      return value;
    }

    throw new DeliveryStorageCorruptionError(
      `Delivery attempt label "${String(value)}" is invalid.`,
    );
  },

  requireStage(value: unknown): DeliveryFailureStage {
    if (
      value === "CLAIM" ||
      value === "LEASE" ||
      value === "ENDPOINT" ||
      value === "CLEANUP" ||
      value === "STATUS_UPDATE"
    ) {
      return value;
    }

    throw new DeliveryStorageCorruptionError(
      `Delivery attempt stage "${String(value)}" is invalid.`,
    );
  },

  requireReason(value: unknown): DeliveryFailureReason {
    if (
      value === "CLAIM_FAILED" ||
      value === "LEASE_INACTIVE" ||
      value === "ENDPOINT_REJECTED" ||
      value === "CLEANUP_FAILED" ||
      value === "STATUS_UPDATE_FAILED"
    ) {
      return value;
    }

    throw new DeliveryStorageCorruptionError(
      `Delivery attempt reason "${String(value)}" is invalid.`,
    );
  },

  requireText(value: unknown, label: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new DeliveryStorageCorruptionError(`${label} must be a non-empty string.`);
    }
    if (Buffer.byteLength(value, "utf8") > maxTextBytes) {
      throw new DeliveryStorageCorruptionError(
        `${label} exceeds ${String(maxTextBytes)} bytes and cannot be stored.`,
      );
    }

    return value;
  },

  requireDate(value: unknown, label: string): number {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new DeliveryStorageCorruptionError(`${label} must be a valid date.`);
    }

    return value.getTime();
  },

  requireTimestamp(value: unknown): number {
    if (!Number.isSafeInteger(value)) {
      throw new DeliveryStorageCorruptionError("Delivery attempt time must be a safe integer.");
    }

    const timestamp = value as number;
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) {
      throw new DeliveryStorageCorruptionError("Delivery attempt time is invalid.");
    }

    return timestamp;
  },

  requireBoolean(value: unknown): boolean {
    if (typeof value !== "boolean") {
      throw new DeliveryStorageCorruptionError("Delivery attempt accepted flag must be boolean.");
    }

    return value;
  },

  requireSafeInteger(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value)) {
      throw new DeliveryStorageCorruptionError(`${label} must be a safe integer.`);
    }

    return value as number;
  },

  requireSequence(value: unknown): number {
    if (!Number.isSafeInteger(value)) {
      throw new DeliveryStorageCorruptionError("Delivery attempt sequence must be a safe integer.");
    }
    const sequence = value as number;
    if (sequence <= 0) {
      throw new DeliveryStorageCorruptionError("Delivery attempt sequence must be positive.");
    }

    return sequence;
  },

  requireLimit(value: number): number {
    if (!Number.isSafeInteger(value) || value <= 0 || value > defaultReadLimit) {
      throw new Error(
        `Delivery attempt read limit must be a positive safe integer at most ${String(defaultReadLimit)}.`,
      );
    }

    return value;
  },

  attemptSlot(sequence: number): string {
    const slot = ((sequence - 1) % deliveryAttemptCapacity) + 1;

    return String(slot).padStart(12, "0");
  },

  attemptKey(messageKey: string, sequence: number): string {
    return `${messageKey}:attempt:${DeliveryAttemptValues.attemptSlot(sequence)}`;
  },

  assertStoredRecordSize(value: Buffer): void {
    if (value.byteLength > maxStoredRecordBytes) {
      throw new DeliveryStorageCorruptionError(
        `Delivery attempt record exceeds ${String(maxStoredRecordBytes)} bytes and cannot be stored.`,
      );
    }
  },

  corruptionFrom(error: unknown, message: string): DeliveryStorageCorruptionError {
    return error instanceof DeliveryStorageCorruptionError
      ? error
      : new DeliveryStorageCorruptionError(message, { cause: error });
  },

  attemptStorageContext(context: StorageContext): StorageContext {
    return context.multitenant
      ? {
          name: `${context.name}.delivery.attempts`,
          multitenant: true,
          ...(context.tenantId === undefined ? {} : { tenantId: context.tenantId }),
        }
      : {
          name: `${context.name}.delivery.attempts`,
          multitenant: false,
        };
  },

  storageContextSnapshot(context: StorageContext): StorageContext {
    if (context.multitenant) {
      const tenantId = context.tenantId;

      return Object.freeze({
        name: context.name,
        multitenant: true,
        ...(tenantId === undefined ? {} : { tenantId }),
      });
    }

    return Object.freeze({
      name: context.name,
      multitenant: false,
    });
  },
});
