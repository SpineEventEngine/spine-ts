import { create } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import { RecordColumn, RecordSpec } from "@spine-ts/storage";

import { DeliveryStorageCorruptionError } from "./delivery-storage-error.js";
import {
  InboxMessageError,
  type DeliveryLabel,
  type DeliveryStatus,
  type InboxMessage,
  type InboxMessageId,
} from "./inbox.js";
import { ShardIndex } from "./shard-index.js";

interface StoredSignal {
  readonly typeUrl: string;
  readonly valueBase64: string;
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
  readonly signal?: StoredSignal;
  readonly label: DeliveryLabel;
  readonly status: DeliveryStatus;
  readonly whenReceivedMs: number;
  readonly version: string;
  readonly keepUntilMs?: number;
}

interface StoredPendingDedupRecord {
  readonly key: string;
  readonly state: "PENDING";
  readonly message: StoredInboxMessage;
}

interface StoredFinalDedupRecord {
  readonly key: string;
  readonly inbox: string;
  readonly signalId: string;
  readonly inboxMessageId: string;
  readonly shardIndex: number;
  readonly shardTotal: number;
  readonly state: "FINAL";
  readonly status: DeliveryStatus;
  readonly keepUntilMs?: number;
}

type StoredDedupRecord = StoredPendingDedupRecord | StoredFinalDedupRecord;

const maxSignalPayloadBytes: number = 256 * 1024;

export const inboxRecordSpec: RecordSpec<string, Any> = new RecordSpec<string, Any>({
  schema: AnySchema,
  extractId: (record) => readStoredInboxMessage(record).key,
  columns: [
    new RecordColumn("signalId", (record) => readStoredInboxMessage(record).signalId),
    new RecordColumn("inbox", (record) => readStoredInboxMessage(record).inbox),
    new RecordColumn("status", (record) => readStoredInboxMessage(record).status),
    new RecordColumn("label", (record) => readStoredInboxMessage(record).label),
    new RecordColumn("shard", (record) => readStoredInboxMessage(record).shard),
    new RecordColumn("receivedAt", (record) => readStoredInboxMessage(record).whenReceivedMs),
    new RecordColumn("version", (record) =>
      parseStoredVersion(readStoredInboxMessage(record).version),
    ),
    new RecordColumn("messageId", (record) => readStoredInboxMessage(record).id),
  ],
});

export const dedupRecordSpec: RecordSpec<string, Any> = new RecordSpec<string, Any>({
  schema: AnySchema,
  extractId: (record) => readStoredDedupRecord(record).key,
});

export function readInboxMessage(record: Any): InboxMessage {
  return inboxMessageFromStored(readStoredInboxMessage(record));
}

export function writeInboxMessage(message: InboxMessage): Any {
  validateInboxMessage(message);
  return packRecord(inboxRecordTypeUrl, storedInboxMessage(message));
}

export function dedupGuardKey(message: Pick<InboxMessage, "inboxId" | "signalId">): string {
  return `${inboxKey(message.inboxId)}:${requireText(message.signalId, "Inbox signal ID")}`;
}

export function isPendingDedupRecord(record: Any): boolean {
  return readStoredDedupRecord(record).state === "PENDING";
}

function readStoredDedupRecord(record: Any): StoredDedupRecord {
  const decoded = readStoredRecord(record, dedupRecordTypeUrl, "Inbox dedup record");
  const state = requireDedupState(decoded.state);
  const key = requireText(decoded.key, "Inbox dedup key");

  if (state === "PENDING") {
    const message = parseStoredInboxMessage(
      Reflect.get(decoded, "message"),
      "Inbox dedup pending message",
    );
    if (dedupGuardKey(inboxMessageFromStored(message)) !== key) {
      throw new DeliveryStorageCorruptionError(
        "Inbox dedup pending message does not match the guard key.",
      );
    }

    return Object.freeze({
      key,
      state,
      message,
    });
  }

  const inbox = requireText(decoded.inbox, "Inbox dedup inbox");
  const signalId = requireText(decoded.signalId, "Inbox dedup signal ID");
  if (`${inbox}:${signalId}` !== key) {
    throw new DeliveryStorageCorruptionError(
      "Inbox dedup final record does not match the guard key.",
    );
  }

  return Object.freeze({
    key,
    inbox,
    signalId,
    inboxMessageId: requireText(decoded.inboxMessageId, "Inbox dedup message ID"),
    shardIndex: requireNumber(decoded.shardIndex, "Inbox dedup shard index"),
    shardTotal: requireNumber(decoded.shardTotal, "Inbox dedup shard total"),
    state,
    status: requireDeliveryStatus(decoded.status),
    ...(decoded.keepUntilMs === undefined
      ? {}
      : {
          keepUntilMs: requireNumber(decoded.keepUntilMs, "Inbox dedup keep-until time"),
        }),
  });
}

export function writeDedupClaim(message: InboxMessage): Any {
  const stored: StoredPendingDedupRecord = {
    key: dedupGuardKey(message),
    state: "PENDING",
    message: storedInboxMessage(message),
  };

  return packRecord(dedupRecordTypeUrl, stored);
}

export function writeDedupRecord(message: InboxMessage): Any {
  validateInboxMessage(message);

  const stored: StoredFinalDedupRecord = {
    key: dedupGuardKey(message),
    inbox: inboxKey(message.inboxId),
    signalId: requireText(message.signalId, "Inbox signal ID"),
    inboxMessageId: requireText(message.id.value, "Inbox message ID"),
    shardIndex: message.id.shard.index,
    shardTotal: message.id.shard.ofTotal,
    state: "FINAL",
    status: requireDeliveryStatus(message.status),
    ...(message.keepUntil === undefined
      ? {}
      : { keepUntilMs: requireTimestamp(message.keepUntil, "Inbox keep-until time") }),
  };

  return packRecord(dedupRecordTypeUrl, stored);
}

export function dedupMessageId(record: Any, expectedKey?: string): InboxMessageId {
  const dedup = readStoredDedupRecord(record);
  if (expectedKey !== undefined && dedup.key !== expectedKey) {
    throw new DeliveryStorageCorruptionError(
      `Inbox dedup guard "${expectedKey}" does not match its storage key.`,
    );
  }

  if (dedup.state === "PENDING") {
    return Object.freeze({
      value: requireText(dedup.message.id, "Inbox dedup message ID"),
      shard: new ShardIndex(
        requireNumber(dedup.message.shardIndex, "Inbox dedup shard index"),
        requireNumber(dedup.message.shardTotal, "Inbox dedup shard total"),
      ),
    });
  }

  return Object.freeze({
    value: requireText(dedup.inboxMessageId, "Inbox dedup message ID"),
    shard: new ShardIndex(
      requireNumber(dedup.shardIndex, "Inbox dedup shard index"),
      requireNumber(dedup.shardTotal, "Inbox dedup shard total"),
    ),
  });
}

export function readPendingMessage(record: Any): InboxMessage | undefined {
  const dedup = readStoredDedupRecord(record);
  return dedup.state === "PENDING" ? inboxMessageFromStored(dedup.message) : undefined;
}

function inboxKey(inboxId: InboxMessage["inboxId"]): string {
  return JSON.stringify({
    targetId: requireText(inboxId.targetId, "Inbox target ID"),
    targetTypeUrl: requireText(inboxId.targetTypeUrl, "Inbox target type URL"),
  });
}

function inboxMessageKey(id: InboxMessageId): string {
  return `${id.shard.key()}:${requireText(id.value, "Inbox message ID")}`;
}

function packRecord(typeUrl: string, value: StoredInboxMessage | StoredDedupRecord): Any {
  return create(AnySchema, {
    typeUrl,
    value: Buffer.from(JSON.stringify(value), "utf8"),
  });
}

function storedInboxMessage(message: InboxMessage): StoredInboxMessage {
  validateInboxMessage(message);
  assertSignalPayloadSize(message.signal);

  return Object.freeze({
    key: inboxMessageKey(message.id),
    id: requireText(message.id.value, "Inbox message ID"),
    shard: message.shard.key(),
    shardIndex: message.shard.index,
    shardTotal: message.shard.ofTotal,
    inbox: inboxKey(message.inboxId),
    inboxId: {
      targetId: requireText(message.inboxId.targetId, "Inbox target ID"),
      targetTypeUrl: requireText(message.inboxId.targetTypeUrl, "Inbox target type URL"),
    },
    signalId: requireText(message.signalId, "Inbox signal ID"),
    label: requireDeliveryLabel(message.label),
    status: requireDeliveryStatus(message.status),
    whenReceivedMs: requireTimestamp(message.whenReceived, "Inbox receive time"),
    version: message.version.toString(),
    ...(message.signal === undefined ? {} : { signal: packSignal(message.signal) }),
    ...(message.keepUntil === undefined
      ? {}
      : { keepUntilMs: requireTimestamp(message.keepUntil, "Inbox keep-until time") }),
  });
}

function validateInboxMessage(message: InboxMessage): void {
  if (message.id.shard.key() !== message.shard.key()) {
    throw new InboxMessageError("Inbox message ID shard does not match message shard.");
  }
}

function inboxMessageFromStored(stored: StoredInboxMessage): InboxMessage {
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
    version: parseStoredVersion(stored.version),
    ...(stored.signal === undefined ? {} : { signal: unpackSignal(stored.signal) }),
    ...(stored.keepUntilMs === undefined ? {} : { keepUntil: new Date(stored.keepUntilMs) }),
  });
}

function packSignal(signal: Any): StoredSignal {
  return Object.freeze({
    typeUrl: requireText(signal.typeUrl, "Inbox signal type URL"),
    valueBase64: Buffer.from(signal.value).toString("base64"),
  });
}

function unpackSignal(signal: StoredSignal): Any {
  const valueBase64 = requireText(signal.valueBase64, "Inbox signal payload");

  return create(AnySchema, {
    typeUrl: requireText(signal.typeUrl, "Inbox signal type URL"),
    value: decodeSignalPayload(valueBase64),
  });
}

function readStoredInboxMessage(record: Any): StoredInboxMessage {
  return parseStoredInboxMessage(
    readStoredRecord(record, inboxRecordTypeUrl, "Inbox message record"),
    "Inbox message record",
  );
}

function parseStoredInboxMessage(value: unknown, label: string): StoredInboxMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DeliveryStorageCorruptionError(`${label} is invalid.`);
  }

  const decoded = value as Record<string, unknown>;
  const shard = new ShardIndex(
    requireNumber(decoded.shardIndex, "Inbox shard index"),
    requireNumber(decoded.shardTotal, "Inbox shard total"),
  );

  if (requireText(decoded.shard, "Inbox shard key") !== shard.key()) {
    throw new DeliveryStorageCorruptionError(
      "Inbox message record shard key does not match shard.",
    );
  }

  const id = requireText(decoded.id, "Inbox message ID");
  const key = requireText(decoded.key, "Inbox message key");
  if (key !== inboxMessageKey({ value: id, shard })) {
    throw new DeliveryStorageCorruptionError(
      "Inbox message record key does not match message identity.",
    );
  }

  const inboxId = readStoredInboxId(decoded.inboxId);
  const inbox = requireText(decoded.inbox, "Inbox key");
  if (inbox !== inboxKey(inboxId)) {
    throw new DeliveryStorageCorruptionError(
      "Inbox message record inbox key does not match target identity.",
    );
  }

  return Object.freeze({
    key,
    id,
    shard: shard.key(),
    shardIndex: shard.index,
    shardTotal: shard.ofTotal,
    inbox,
    inboxId: {
      targetId: inboxId.targetId,
      targetTypeUrl: inboxId.targetTypeUrl,
    },
    signalId: requireText(decoded.signalId, "Inbox signal ID"),
    ...(decoded.signal === undefined ? {} : { signal: readStoredSignal(decoded.signal) }),
    label: requireDeliveryLabel(decoded.label),
    status: requireDeliveryStatus(decoded.status),
    whenReceivedMs: requireNumber(decoded.whenReceivedMs, "Inbox receive time"),
    version: requireText(decoded.version, "Inbox version"),
    ...(decoded.keepUntilMs === undefined
      ? {}
      : { keepUntilMs: requireNumber(decoded.keepUntilMs, "Inbox keep-until time") }),
  });
}

function readStoredSignal(value: unknown): StoredSignal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DeliveryStorageCorruptionError("Inbox signal payload is invalid.");
  }

  return Object.freeze({
    typeUrl: requireText(Reflect.get(value, "typeUrl"), "Inbox signal type URL"),
    valueBase64: requireText(Reflect.get(value, "valueBase64"), "Inbox signal payload"),
  });
}

function readStoredInboxId(value: unknown): Readonly<{ targetId: string; targetTypeUrl: string }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DeliveryStorageCorruptionError("Inbox target identity is invalid.");
  }

  return Object.freeze({
    targetId: requireText(Reflect.get(value, "targetId"), "Inbox target ID"),
    targetTypeUrl: requireText(Reflect.get(value, "targetTypeUrl"), "Inbox target type URL"),
  });
}

function readStoredRecord(
  record: Any,
  expectedTypeUrl: string,
  label: string,
): Record<string, unknown> {
  if (record.typeUrl !== expectedTypeUrl) {
    throw new DeliveryStorageCorruptionError(`${label} type URL "${record.typeUrl}" is invalid.`);
  }

  if (record.value.byteLength > maxStoredRecordBytes) {
    throw new DeliveryStorageCorruptionError(
      `${label} exceeds ${String(maxStoredRecordBytes)} bytes and cannot be read.`,
    );
  }

  try {
    const decoded = JSON.parse(Buffer.from(record.value).toString("utf8")) as unknown;

    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
      throw new DeliveryStorageCorruptionError(`${label} is not a JSON object.`);
    }

    return decoded as Record<string, unknown>;
  } catch (error) {
    if (error instanceof DeliveryStorageCorruptionError) {
      throw error;
    }

    throw new DeliveryStorageCorruptionError(`${label} contains malformed JSON.`, {
      cause: error,
    });
  }
}

function requireDeliveryLabel(value: unknown): DeliveryLabel {
  if (
    value === "HANDLE_COMMAND" ||
    value === "UPDATE_SUBSCRIBER" ||
    value === "REACT_UPON_EVENT" ||
    value === "IMPORT_EVENT" ||
    value === "CATCH_UP"
  ) {
    return value;
  }

  throw new DeliveryStorageCorruptionError(`Inbox delivery label "${String(value)}" is invalid.`);
}

function requireDeliveryStatus(value: unknown): DeliveryStatus {
  if (
    value === "TO_DELIVER" ||
    value === "SCHEDULED" ||
    value === "DELIVERED" ||
    value === "TO_CATCH_UP"
  ) {
    return value;
  }

  throw new DeliveryStorageCorruptionError(`Inbox delivery status "${String(value)}" is invalid.`);
}

function requireDedupState(value: unknown): "PENDING" | "FINAL" {
  if (value === "PENDING" || value === "FINAL") {
    return value;
  }

  throw new DeliveryStorageCorruptionError(`Inbox dedup state "${String(value)}" is invalid.`);
}

function requireNumber(value: unknown, label: string): number {
  if (!Number.isInteger(value) || !Number.isFinite(value)) {
    throw new DeliveryStorageCorruptionError(`${label} must be a finite integer.`);
  }

  return value as number;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DeliveryStorageCorruptionError(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireTimestamp(value: Date, label: string): number {
  const time = value.getTime();

  if (!Number.isFinite(time)) {
    throw new DeliveryStorageCorruptionError(`${label} is invalid.`);
  }

  return time;
}

function parseStoredVersion(value: string): bigint {
  try {
    return BigInt(requireText(value, "Inbox version"));
  } catch (error) {
    throw error instanceof DeliveryStorageCorruptionError
      ? error
      : new DeliveryStorageCorruptionError("Inbox version is invalid.", { cause: error });
  }
}

function assertSignalPayloadSize(signal: Any | undefined): void {
  if (signal !== undefined && signal.value.byteLength > maxSignalPayloadBytes) {
    throw new Error(
      `Inbox signal payload exceeds ${String(maxSignalPayloadBytes)} bytes and cannot be stored.`,
    );
  }
}

function decodeSignalPayload(valueBase64: string): Buffer {
  if (valueBase64.length > maxSignalPayloadChars) {
    throw new DeliveryStorageCorruptionError(
      `Inbox signal payload exceeds ${String(maxSignalPayloadBytes)} bytes and cannot be stored.`,
    );
  }

  if (!canonicalBase64Pattern.test(valueBase64)) {
    throw new DeliveryStorageCorruptionError("Inbox signal payload base64 is invalid.");
  }

  const value = Buffer.from(valueBase64, "base64");
  if (value.toString("base64") !== valueBase64) {
    throw new DeliveryStorageCorruptionError("Inbox signal payload base64 is not canonical.");
  }

  if (value.byteLength > maxSignalPayloadBytes) {
    throw new DeliveryStorageCorruptionError(
      `Inbox signal payload exceeds ${String(maxSignalPayloadBytes)} bytes and cannot be stored.`,
    );
  }

  return value;
}

const inboxRecordTypeUrl = "type.spine-ts.dev/internal/InboxMessageRecord";
const dedupRecordTypeUrl = "type.spine-ts.dev/internal/InboxDedupRecord";
const maxSignalPayloadChars = Math.ceil(maxSignalPayloadBytes / 3) * 4;
const maxStoredRecordBytes = 512 * 1024;
const canonicalBase64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
