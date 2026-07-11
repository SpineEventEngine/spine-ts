import { create } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import {
  RecordColumn,
  RecordSpec,
  type RecordStorage,
  type StorageContext,
  type StorageFactory,
} from "@spine-ts/storage";

import type { DeliveryEndpointMessage } from "./delivery.js";
import { DeliveryStorageCorruptionError } from "./delivery-storage-error.js";
import type { InboxId, InboxMessageId } from "./inbox.js";
import { ShardIndex } from "./shard-index.js";

const attemptTypeUrl = "type.spine-ts.dev/server/delivery/DeliveryAttemptRecord";
const casRetryLimit = 8;
const defaultReadLimit = 1_000;
const maxAttemptsPerMessage = 100;
const maxStoredRecordBytes = 512 * 1024;
const maxTextBytes = 16 * 1024;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

/** Internal durable history of supported delivery endpoint failures. */
export class DeliveryAttempts {
  readonly #context: StorageContext;
  readonly #storageFactory: StorageFactory;

  /** Open attempt storage from one delivery storage context and factory. */
  constructor(options: DeliveryAttemptsOptions) {
    this.#context = options.context;
    this.#storageFactory = options.storageFactory;
    Object.freeze(this);
  }

  /** Read retained attempts in deterministic storage order. */
  async read(options: DeliveryAttemptReadOptions = {}): Promise<readonly DeliveryAttempt[]> {
    const storage = this.#storage();

    try {
      const records = await storage.queryEntries({
        filters: [
          ...(options.shard === undefined
            ? []
            : [{ column: "shard", value: requireShard(options.shard).key() }]),
        ],
        sort: [{ field: "attemptedAt" }, { field: "sequence" }, { field: "messageKey" }],
        limit: requireLimit(options.limit ?? defaultReadLimit),
      });

      return Object.freeze(
        records.map((entry) => attemptFromStored(readStoredAttempt(entry.record, entry.id))),
      );
    } finally {
      storage.close();
    }
  }

  /** Record one supported endpoint failure attempt. */
  async recordFailure(input: DeliveryAttemptInput): Promise<void> {
    const attempt = attemptFromInput(input);
    const storage = this.#storage();

    try {
      await this.#writeAttempt(storage, attempt);
    } finally {
      storage.close();
    }
  }

  async #writeAttempt(storage: RecordStorage<string, Any>, attempt: AttemptInput): Promise<void> {
    for (let index = 0; index < casRetryLimit; index += 1) {
      const sequence = await nextSequence(storage, attempt.messageKey);
      const stored = storedAttempt(attempt, sequence);
      const previous = await storage.read(stored.key);
      const written = await storage.compareAndSet(stored.key, previous, packAttempt(stored));
      if (written) {
        return;
      }
    }

    throw new Error("Delivery attempt could not be recorded due to concurrent changes.");
  }

  #storage(): RecordStorage<string, Any> {
    return this.#storageFactory.createRecordStorage(attemptStorageContext(this.#context), spec);
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

interface AttemptInput extends Omit<StoredAttempt, "key" | "sequence"> {}

const spec: RecordSpec<string, Any> = new RecordSpec<string, Any>({
  schema: AnySchema,
  extractId: (record) => readStoredAttempt(record).key,
  columns: [
    new RecordColumn("messageKey", (record) => readStoredAttempt(record).messageKey),
    new RecordColumn("shard", (record) => readStoredAttempt(record).shard),
    new RecordColumn("attemptedAt", (record) => readStoredAttempt(record).attemptedAtMs),
    new RecordColumn("sequence", (record) => readStoredAttempt(record).sequence),
  ],
});

async function nextSequence(
  storage: RecordStorage<string, Any>,
  messageKey: string,
): Promise<number> {
  const records = await storage.queryEntries({
    filters: [{ column: "messageKey", value: messageKey }],
    sort: [{ field: "sequence", direction: "desc" }],
    limit: 1,
  });
  const last = records[0];
  if (last === undefined) {
    return 1;
  }

  return readStoredAttempt(last.record, last.id).sequence + 1;
}

function attemptFromInput(input: DeliveryAttemptInput): AttemptInput {
  const message = input.message;
  const shard = requireShard(message.shard);
  const messageId = requireText(message.id.value, "Delivery attempt message ID");
  const inboxId = inputInboxId(message.inboxId);
  const signalId = requireText(message.signalId, "Delivery attempt signal ID");
  const node = requireText(input.node, "Delivery attempt node");
  const attemptedAtMs = requireDate(input.attemptedAt, "Delivery attempt time");

  return Object.freeze({
    messageKey: attemptMessageKey(message.id),
    messageId,
    shard: shard.key(),
    shardIndex: shard.index,
    shardTotal: shard.ofTotal,
    inbox: inboxKey(inboxId),
    inboxId,
    signalId,
    label: requireLabel(message.label),
    node,
    attemptedAtMs,
    accepted: requireBoolean(input.accepted),
    stage: requireStage(input.stage),
    reason: requireReason(input.reason),
  });
}

function storedAttempt(input: AttemptInput, sequence: number): StoredAttempt {
  return Object.freeze({
    ...input,
    sequence,
    key: `${input.messageKey}:attempt:${attemptSlot(sequence)}`,
  });
}

function attemptFromStored(stored: StoredAttempt): DeliveryAttempt {
  const shard = new ShardIndex(stored.shardIndex, stored.shardTotal);

  return Object.freeze({
    messageId: Object.freeze({
      value: stored.messageId,
      shard,
    }),
    inboxId: Object.freeze({ ...stored.inboxId }),
    signalId: stored.signalId,
    label: stored.label,
    shard,
    node: stored.node,
    attemptedAt: new Date(stored.attemptedAtMs),
    accepted: stored.accepted,
    stage: stored.stage,
    reason: stored.reason,
  });
}

function packAttempt(stored: StoredAttempt): Any {
  const encoded = Buffer.from(JSON.stringify(stored), "utf8");
  assertStoredRecordSize(encoded);

  return create(AnySchema, {
    typeUrl: attemptTypeUrl,
    value: encoded,
  });
}

function readStoredAttempt(record: Any, expectedKey?: string): StoredAttempt {
  const decoded = readStoredRecord(record);
  const shard = storedShard(decoded);
  const key = requireText(Reflect.get(decoded, "key"), "Delivery attempt key");
  if (expectedKey !== undefined && key !== expectedKey) {
    throw new DeliveryStorageCorruptionError(
      `Delivery attempt "${expectedKey}" does not match its storage key.`,
    );
  }

  const messageKey = requireText(
    Reflect.get(decoded, "messageKey"),
    "Delivery attempt message key",
  );
  const messageId = requireText(Reflect.get(decoded, "messageId"), "Delivery attempt message ID");
  const sequence = requireSequence(Reflect.get(decoded, "sequence"));
  const inboxId = storedInboxId(Reflect.get(decoded, "inboxId"));
  const stored = Object.freeze({
    key,
    messageKey,
    messageId,
    shard: shard.key(),
    shardIndex: shard.index,
    shardTotal: shard.ofTotal,
    inbox: requireText(Reflect.get(decoded, "inbox"), "Delivery attempt inbox key"),
    inboxId,
    signalId: requireText(Reflect.get(decoded, "signalId"), "Delivery attempt signal ID"),
    label: requireLabel(Reflect.get(decoded, "label")),
    node: requireText(Reflect.get(decoded, "node"), "Delivery attempt node"),
    attemptedAtMs: requireTimestamp(Reflect.get(decoded, "attemptedAtMs")),
    accepted: requireBoolean(Reflect.get(decoded, "accepted")),
    stage: requireStage(Reflect.get(decoded, "stage")),
    reason: requireReason(Reflect.get(decoded, "reason")),
    sequence,
  });

  assertAttemptIdentity(stored);

  return stored;
}

function readStoredRecord(record: Any): Record<string, unknown> {
  const typeUrl = readStoredTypeUrl(record);
  if (typeUrl !== attemptTypeUrl) {
    throw new DeliveryStorageCorruptionError(
      `Delivery attempt record type URL "${typeUrl}" is invalid.`,
    );
  }

  const value = readStoredBytes(record);
  if (value.byteLength > maxStoredRecordBytes) {
    throw new DeliveryStorageCorruptionError(
      `Delivery attempt record exceeds ${String(maxStoredRecordBytes)} bytes and cannot be read.`,
    );
  }

  try {
    const decoded = JSON.parse(decodeStoredUtf8(value)) as unknown;

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
}

function readStoredTypeUrl(record: Any): string {
  try {
    return requireText(Reflect.get(record, "typeUrl"), "Delivery attempt type URL");
  } catch (error) {
    throw corruptionFrom(error, "Delivery attempt record type URL is invalid.");
  }
}

function readStoredBytes(record: Any): Uint8Array {
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
}

function decodeStoredUtf8(value: Uint8Array): string {
  try {
    return utf8Decoder.decode(value);
  } catch (error) {
    throw new DeliveryStorageCorruptionError("Delivery attempt record contains invalid UTF-8.", {
      cause: error,
    });
  }
}

function assertAttemptIdentity(stored: StoredAttempt): void {
  const messageKey = attemptMessageKey({
    value: stored.messageId,
    shard: new ShardIndex(stored.shardIndex, stored.shardTotal),
  });
  if (stored.messageKey !== messageKey || stored.shard !== storedMessageShard(stored)) {
    throw new DeliveryStorageCorruptionError(
      "Delivery attempt message identity does not match shard identity.",
    );
  }
  const expectedKey = `${stored.messageKey}:attempt:${attemptSlot(stored.sequence)}`;
  if (stored.key !== expectedKey) {
    throw new DeliveryStorageCorruptionError(
      "Delivery attempt key does not match message identity and sequence.",
    );
  }
  if (stored.inbox !== inboxKey(stored.inboxId)) {
    throw new DeliveryStorageCorruptionError(
      "Delivery attempt inbox identity does not match its composite key.",
    );
  }
}

function storedMessageShard(stored: Pick<StoredAttempt, "shardIndex" | "shardTotal">): string {
  return new ShardIndex(stored.shardIndex, stored.shardTotal).key();
}

function inputInboxId(value: InboxId): StoredAttempt["inboxId"] {
  return Object.freeze({
    targetId: requireText(value.targetId, "Delivery attempt inbox target ID"),
    targetTypeUrl: requireText(value.targetTypeUrl, "Delivery attempt inbox target type URL"),
  });
}

function storedInboxId(value: unknown): StoredAttempt["inboxId"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DeliveryStorageCorruptionError("Delivery attempt inbox identity is invalid.");
  }
  const input = value as Record<string, unknown>;

  return Object.freeze({
    targetId: requireText(Reflect.get(input, "targetId"), "Delivery attempt inbox target ID"),
    targetTypeUrl: requireText(
      Reflect.get(input, "targetTypeUrl"),
      "Delivery attempt inbox target type URL",
    ),
  });
}

function storedShard(input: Record<string, unknown>): ShardIndex {
  return new ShardIndex(
    requireInteger(Reflect.get(input, "shardIndex"), "Delivery attempt shard index"),
    requireInteger(Reflect.get(input, "shardTotal"), "Delivery attempt shard total"),
  );
}

function attemptMessageKey(id: InboxMessageId): string {
  const shard = requireShard(id.shard);

  return `${shard.key()}:${requireText(id.value, "Delivery attempt message ID")}`;
}

function inboxKey(inboxId: StoredAttempt["inboxId"]): string {
  return requireText(
    JSON.stringify({
      targetId: inboxId.targetId,
      targetTypeUrl: inboxId.targetTypeUrl,
    }),
    "Delivery attempt inbox key",
  );
}

function requireShard(value: ShardIndex): ShardIndex {
  return new ShardIndex(value.index, value.ofTotal);
}

function requireLabel(value: unknown): DeliveryEndpointMessage["label"] {
  if (value === "HANDLE_COMMAND" || value === "UPDATE_SUBSCRIBER" || value === "REACT_UPON_EVENT") {
    return value;
  }

  throw new DeliveryStorageCorruptionError(`Delivery attempt label "${String(value)}" is invalid.`);
}

function requireStage(value: unknown): DeliveryFailureStage {
  if (
    value === "CLAIM" ||
    value === "LEASE" ||
    value === "ENDPOINT" ||
    value === "CLEANUP" ||
    value === "STATUS_UPDATE"
  ) {
    return value;
  }

  throw new DeliveryStorageCorruptionError(`Delivery attempt stage "${String(value)}" is invalid.`);
}

function requireReason(value: unknown): DeliveryFailureReason {
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
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DeliveryStorageCorruptionError(`${label} must be a non-empty string.`);
  }
  if (Buffer.byteLength(value, "utf8") > maxTextBytes) {
    throw new DeliveryStorageCorruptionError(
      `${label} exceeds ${String(maxTextBytes)} bytes and cannot be stored.`,
    );
  }

  return value;
}

function requireDate(value: unknown, label: string): number {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new DeliveryStorageCorruptionError(`${label} must be a valid date.`);
  }

  return value.getTime();
}

function requireTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value)) {
    throw new DeliveryStorageCorruptionError("Delivery attempt time must be a safe integer.");
  }

  const timestamp = value as number;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) {
    throw new DeliveryStorageCorruptionError("Delivery attempt time is invalid.");
  }

  return timestamp;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new DeliveryStorageCorruptionError("Delivery attempt accepted flag must be boolean.");
  }

  return value;
}

function requireInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || !Number.isFinite(value)) {
    throw new DeliveryStorageCorruptionError(`${label} must be a finite integer.`);
  }

  return value as number;
}

function requireSequence(value: unknown): number {
  const sequence = requireInteger(value, "Delivery attempt sequence");
  if (sequence <= 0) {
    throw new DeliveryStorageCorruptionError("Delivery attempt sequence must be positive.");
  }

  return sequence;
}

function requireLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > defaultReadLimit) {
    throw new Error(
      `Delivery attempt read limit must be a positive safe integer at most ${String(defaultReadLimit)}.`,
    );
  }

  return value;
}

function attemptSlot(sequence: number): string {
  const slot = ((sequence - 1) % maxAttemptsPerMessage) + 1;

  return String(slot).padStart(12, "0");
}

function assertStoredRecordSize(value: Buffer): void {
  if (value.byteLength > maxStoredRecordBytes) {
    throw new DeliveryStorageCorruptionError(
      `Delivery attempt record exceeds ${String(maxStoredRecordBytes)} bytes and cannot be stored.`,
    );
  }
}

function corruptionFrom(error: unknown, message: string): DeliveryStorageCorruptionError {
  return error instanceof DeliveryStorageCorruptionError
    ? error
    : new DeliveryStorageCorruptionError(message, { cause: error });
}

function attemptStorageContext(context: StorageContext): StorageContext {
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
}
