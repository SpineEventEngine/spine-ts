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
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

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

export function readInboxMessage(record: Any, expectedKey?: string): InboxMessage {
  return inboxMessageFromStored(readStoredInboxMessage(record, expectedKey));
}

export function writeInboxMessage(message: InboxMessage): Any {
  return packRecord(inboxRecordTypeUrl, "Inbox message record", storedInboxMessage(message));
}

export function dedupGuardKey(message: Pick<InboxMessage, "inboxId" | "signalId">): string {
  return requireCompositeInputText(
    `${inboxKey(message.inboxId)}:${requireInputText(message.signalId, "Inbox signal ID")}`,
    "Inbox dedup key",
  );
}

export function isPendingDedupRecord(record: Any): boolean {
  return readStoredDedupRecord(record).state === "PENDING";
}

function readStoredDedupRecord(record: Any): StoredDedupRecord {
  const decoded = readStoredRecord(record, dedupRecordTypeUrl, "Inbox dedup record");
  const state = requireDedupState(decoded.state);
  const key = requireStoredText(decoded.key, "Inbox dedup key", maxCompositeTextBytes);

  return state === "PENDING" ? readPendingDedup(decoded, key) : readFinalDedup(decoded, key);
}

export function writeDedupClaim(message: InboxMessage): Any {
  const storedMessage = storedInboxMessage(message);
  const stored: StoredPendingDedupRecord = {
    key: dedupGuardKey(message),
    state: "PENDING",
    message: storedMessage,
  };
  assertPendingClaimBudget(stored);

  return packRecord(dedupRecordTypeUrl, "Inbox dedup record", stored);
}

export function writeDedupRecord(message: InboxMessage): Any {
  validateInboxMessage(message);

  const stored: StoredFinalDedupRecord = {
    key: dedupGuardKey(message),
    inbox: inboxKey(message.inboxId),
    signalId: requireInputText(message.signalId, "Inbox signal ID"),
    inboxMessageId: requireMessageIdText(message.id.value),
    shardIndex: message.id.shard.index,
    shardTotal: message.id.shard.ofTotal,
    state: "FINAL",
    status: requireInputDeliveryStatus(message.status),
    ...(message.keepUntil === undefined
      ? {}
      : { keepUntilMs: requireInputTimestamp(message.keepUntil, "Inbox keep-until time") }),
  };

  return packRecord(dedupRecordTypeUrl, "Inbox dedup record", stored);
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
      value: requireStoredText(dedup.message.id, "Inbox dedup message ID"),
      shard: new ShardIndex(
        requireNumber(dedup.message.shardIndex, "Inbox dedup shard index"),
        requireNumber(dedup.message.shardTotal, "Inbox dedup shard total"),
      ),
    });
  }

  return Object.freeze({
    value: requireStoredText(dedup.inboxMessageId, "Inbox dedup message ID"),
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
  return requireCompositeInputText(
    JSON.stringify({
      targetId: requireInputText(inboxId.targetId, "Inbox target ID"),
      targetTypeUrl: requireInputText(inboxId.targetTypeUrl, "Inbox target type URL"),
    }),
    "Inbox key",
  );
}

function inboxMessageKey(id: InboxMessageId): string {
  return `${id.shard.key()}:${requireMessageIdText(id.value)}`;
}

function packRecord(
  typeUrl: string,
  label: string,
  value: StoredInboxMessage | StoredDedupRecord,
): Any {
  const encoded = Buffer.from(JSON.stringify(value), "utf8");
  assertStoredRecordSize(encoded, label);

  return create(AnySchema, {
    typeUrl,
    value: encoded,
  });
}

function storedInboxMessage(message: InboxMessage): StoredInboxMessage {
  validateInboxMessage(message);
  assertSignalPayloadSize(message.signal);
  const version = requireInputText(message.version.toString(), "Inbox version");

  return Object.freeze({
    key: inboxMessageKey(message.id),
    id: requireMessageIdText(message.id.value),
    shard: message.shard.key(),
    shardIndex: message.shard.index,
    shardTotal: message.shard.ofTotal,
    inbox: inboxKey(message.inboxId),
    inboxId: {
      targetId: requireInputText(message.inboxId.targetId, "Inbox target ID"),
      targetTypeUrl: requireInputText(message.inboxId.targetTypeUrl, "Inbox target type URL"),
    },
    signalId: requireInputText(message.signalId, "Inbox signal ID"),
    label: requireInputDeliveryLabel(message.label),
    status: requireInputDeliveryStatus(message.status),
    whenReceivedMs: requireInputTimestamp(message.whenReceived, "Inbox receive time"),
    version,
    ...(message.signal === undefined ? {} : { signal: packSignal(message.signal) }),
    ...(message.keepUntil === undefined
      ? {}
      : { keepUntilMs: requireInputTimestamp(message.keepUntil, "Inbox keep-until time") }),
  });
}

function validateInboxMessage(message: InboxMessage): void {
  if (message.id.shard.key() !== message.shard.key()) {
    throw new InboxMessageError("Inbox message ID shard does not match message shard.");
  }

  requireMessageIdText(message.id.value);
  requireInputText(message.signalId, "Inbox signal ID");
  requireInputText(message.inboxId.targetId, "Inbox target ID");
  requireInputText(message.inboxId.targetTypeUrl, "Inbox target type URL");
  if (message.signal !== undefined) {
    requireInputText(message.signal.typeUrl, "Inbox signal type URL");
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
    whenReceived: storedDate(stored.whenReceivedMs, "Inbox receive time"),
    version: parseStoredVersion(stored.version),
    ...(stored.signal === undefined ? {} : { signal: unpackSignal(stored.signal) }),
    ...(stored.keepUntilMs === undefined
      ? {}
      : { keepUntil: storedDate(stored.keepUntilMs, "Inbox keep-until time") }),
  });
}

function packSignal(signal: Any): StoredSignal {
  return Object.freeze({
    typeUrl: requireInputText(signal.typeUrl, "Inbox signal type URL"),
    valueBase64: Buffer.from(signal.value).toString("base64"),
  });
}

function unpackSignal(signal: StoredSignal): Any {
  const valueBase64 = requireStoredSignalBase64(signal.valueBase64);

  return create(AnySchema, {
    typeUrl: requireStoredText(signal.typeUrl, "Inbox signal type URL"),
    value: decodeSignalPayload(valueBase64),
  });
}

function readStoredInboxMessage(record: Any, expectedKey?: string): StoredInboxMessage {
  return parseStoredInboxMessage(
    readStoredRecord(record, inboxRecordTypeUrl, "Inbox message record"),
    "Inbox message record",
    expectedKey,
  );
}

function parseStoredInboxMessage(
  value: unknown,
  label: string,
  expectedKey?: string,
): StoredInboxMessage {
  const decoded = requireStoredObject(value, label);
  const shard = readStoredShard(decoded);
  const id = requireStoredText(decoded.id, "Inbox message ID");
  const key = readStoredMessageKey(decoded, shard, id, expectedKey);
  const inboxId = readStoredInboxId(decoded.inboxId);
  const inbox = readStoredInboxKey(decoded, inboxId);

  return buildStoredInboxMessage(decoded, shard, id, key, inbox, inboxId);
}

function readStoredSignal(value: unknown): StoredSignal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DeliveryStorageCorruptionError("Inbox signal payload is invalid.");
  }

  return Object.freeze({
    typeUrl: requireStoredText(Reflect.get(value, "typeUrl"), "Inbox signal type URL"),
    valueBase64: requireStoredSignalBase64(Reflect.get(value, "valueBase64")),
  });
}

function readStoredInboxId(value: unknown): Readonly<{ targetId: string; targetTypeUrl: string }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DeliveryStorageCorruptionError("Inbox target identity is invalid.");
  }

  return Object.freeze({
    targetId: requireStoredText(Reflect.get(value, "targetId"), "Inbox target ID"),
    targetTypeUrl: requireStoredText(Reflect.get(value, "targetTypeUrl"), "Inbox target type URL"),
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
    const decoded = JSON.parse(decodeStoredUtf8(record.value, label)) as unknown;

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

function decodeStoredUtf8(value: Uint8Array, label: string): string {
  try {
    return utf8Decoder.decode(value);
  } catch (error) {
    throw new DeliveryStorageCorruptionError(`${label} contains invalid UTF-8.`, {
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

function requireInputDeliveryLabel(value: unknown): DeliveryLabel {
  if (
    value === "HANDLE_COMMAND" ||
    value === "UPDATE_SUBSCRIBER" ||
    value === "REACT_UPON_EVENT" ||
    value === "IMPORT_EVENT" ||
    value === "CATCH_UP"
  ) {
    return value;
  }

  throw new InboxMessageError(`Inbox delivery label "${String(value)}" is invalid.`);
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

function requireInputDeliveryStatus(value: unknown): DeliveryStatus {
  if (
    value === "TO_DELIVER" ||
    value === "SCHEDULED" ||
    value === "DELIVERED" ||
    value === "TO_CATCH_UP"
  ) {
    return value;
  }

  throw new InboxMessageError(`Inbox delivery status "${String(value)}" is invalid.`);
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

function requireStoredText(value: unknown, label: string, maxBytes = maxTextBytes): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DeliveryStorageCorruptionError(`${label} must be a non-empty string.`);
  }
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new DeliveryStorageCorruptionError(
      `${label} exceeds ${String(maxBytes)} bytes and cannot be stored.`,
    );
  }

  return value;
}

function requireInputText(value: unknown, label: string, maxBytes = maxTextBytes): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InboxMessageError(`${label} must be a non-empty string.`);
  }
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new InboxMessageError(`${label} exceeds ${String(maxBytes)} bytes and cannot be stored.`);
  }

  return value;
}

function requireCompositeInputText(value: string, label: string): string {
  if (Buffer.byteLength(value, "utf8") > maxCompositeTextBytes) {
    throw new InboxMessageError(
      `${label} exceeds ${String(maxCompositeTextBytes)} bytes and cannot be stored.`,
    );
  }

  return value;
}

function requireMessageIdText(value: string): string {
  return requireInputText(value, "Inbox message ID");
}

function requireStoredSignalBase64(value: unknown): string {
  if (typeof value !== "string") {
    throw new DeliveryStorageCorruptionError("Inbox signal payload must be a string.");
  }
  if (Buffer.byteLength(value, "utf8") > maxSignalPayloadChars) {
    throw new DeliveryStorageCorruptionError(
      `Inbox signal payload exceeds ${String(maxSignalPayloadBytes)} bytes and cannot be stored.`,
    );
  }

  return value;
}

function requireInputTimestamp(value: Date, label: string): number {
  const time = value.getTime();

  if (!Number.isFinite(time)) {
    throw new InboxMessageError(`${label} is invalid.`);
  }

  return time;
}

function requireStoredTimestampNumber(value: unknown, label: string): number {
  const time = requireNumber(value, label);
  storedDate(time, label);
  return time;
}

function storedDate(value: number, label: string): Date {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new DeliveryStorageCorruptionError(`${label} is invalid.`);
  }

  return date;
}

function parseStoredVersion(value: string): bigint {
  try {
    return BigInt(requireStoredText(value, "Inbox version"));
  } catch (error) {
    throw error instanceof DeliveryStorageCorruptionError
      ? error
      : new DeliveryStorageCorruptionError("Inbox version is invalid.", { cause: error });
  }
}

function assertSignalPayloadSize(signal: Any | undefined): void {
  if (signal !== undefined && signal.value.byteLength > maxSignalPayloadBytes) {
    throw new InboxMessageError(
      `Inbox signal payload exceeds ${String(maxSignalPayloadBytes)} bytes and cannot be stored.`,
    );
  }
}

function assertStoredRecordSize(value: Buffer, label: string): void {
  if (value.byteLength > maxStoredRecordBytes) {
    throw new InboxMessageError(
      `${label} exceeds ${String(maxStoredRecordBytes)} bytes and cannot be stored.`,
    );
  }
}

function assertPendingClaimBudget(record: StoredPendingDedupRecord): void {
  const size = Buffer.byteLength(JSON.stringify(record), "utf8");
  if (size > maxStoredRecordBytes) {
    throw new InboxMessageError(
      `Inbox pending dedup claim exceeds ${String(maxStoredRecordBytes)} bytes aggregate budget.`,
    );
  }
}

function readPendingDedup(decoded: Record<string, unknown>, key: string): StoredPendingDedupRecord {
  const message = parseStoredInboxMessage(
    Reflect.get(decoded, "message"),
    "Inbox dedup pending message",
  );
  if (storedDedupGuardKey(message.inbox, message.signalId) !== key) {
    throw new DeliveryStorageCorruptionError(
      "Inbox dedup pending message does not match the guard key.",
    );
  }

  return Object.freeze({
    key,
    state: "PENDING",
    message,
  });
}

function readFinalDedup(decoded: Record<string, unknown>, key: string): StoredFinalDedupRecord {
  const inbox = requireStoredText(decoded.inbox, "Inbox dedup inbox", maxCompositeTextBytes);
  const signalId = requireStoredText(decoded.signalId, "Inbox dedup signal ID");
  if (`${inbox}:${signalId}` !== key) {
    throw new DeliveryStorageCorruptionError(
      "Inbox dedup final record does not match the guard key.",
    );
  }

  return Object.freeze({
    key,
    inbox,
    signalId,
    inboxMessageId: requireStoredText(decoded.inboxMessageId, "Inbox dedup message ID"),
    shardIndex: requireNumber(decoded.shardIndex, "Inbox dedup shard index"),
    shardTotal: requireNumber(decoded.shardTotal, "Inbox dedup shard total"),
    state: "FINAL",
    status: requireDeliveryStatus(decoded.status),
    ...(decoded.keepUntilMs === undefined
      ? {}
      : {
          keepUntilMs: requireStoredTimestampNumber(
            decoded.keepUntilMs,
            "Inbox dedup keep-until time",
          ),
        }),
  });
}

function requireStoredObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DeliveryStorageCorruptionError(`${label} is invalid.`);
  }

  return value as Record<string, unknown>;
}

function readStoredShard(decoded: Record<string, unknown>): ShardIndex {
  const shard = new ShardIndex(
    requireNumber(decoded.shardIndex, "Inbox shard index"),
    requireNumber(decoded.shardTotal, "Inbox shard total"),
  );
  if (requireStoredText(decoded.shard, "Inbox shard key", maxCompositeTextBytes) !== shard.key()) {
    throw new DeliveryStorageCorruptionError(
      "Inbox message record shard key does not match shard.",
    );
  }

  return shard;
}

function readStoredMessageKey(
  decoded: Record<string, unknown>,
  shard: ShardIndex,
  id: string,
  expectedKey?: string,
): string {
  const key = requireStoredText(decoded.key, "Inbox message key", maxCompositeTextBytes);
  if (key !== storedInboxMessageKey(id, shard)) {
    throw new DeliveryStorageCorruptionError(
      "Inbox message record key does not match message identity.",
    );
  }
  if (expectedKey !== undefined && key !== expectedKey) {
    throw new DeliveryStorageCorruptionError(
      `Inbox message record "${key}" does not match storage key "${expectedKey}".`,
    );
  }

  return key;
}

function readStoredInboxKey(
  decoded: Record<string, unknown>,
  inboxId: Readonly<{ targetId: string; targetTypeUrl: string }>,
): string {
  const inbox = requireStoredText(decoded.inbox, "Inbox key", maxCompositeTextBytes);
  if (inbox !== storedInboxKey(inboxId)) {
    throw new DeliveryStorageCorruptionError(
      "Inbox message record inbox key does not match target identity.",
    );
  }

  return inbox;
}

function buildStoredInboxMessage(
  decoded: Record<string, unknown>,
  shard: ShardIndex,
  id: string,
  key: string,
  inbox: string,
  inboxId: Readonly<{ targetId: string; targetTypeUrl: string }>,
): StoredInboxMessage {
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
    signalId: requireStoredText(decoded.signalId, "Inbox signal ID"),
    ...(decoded.signal === undefined ? {} : { signal: readStoredSignal(decoded.signal) }),
    label: requireDeliveryLabel(decoded.label),
    status: requireDeliveryStatus(decoded.status),
    whenReceivedMs: requireNumber(decoded.whenReceivedMs, "Inbox receive time"),
    version: requireStoredText(decoded.version, "Inbox version"),
    ...(decoded.keepUntilMs === undefined
      ? {}
      : { keepUntilMs: requireNumber(decoded.keepUntilMs, "Inbox keep-until time") }),
  });
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

function storedDedupGuardKey(inbox: string, signalId: string): string {
  return `${inbox}:${signalId}`;
}

function storedInboxMessageKey(id: string, shard: ShardIndex): string {
  return `${shard.key()}:${id}`;
}

function storedInboxKey(inboxId: Readonly<{ targetId: string; targetTypeUrl: string }>): string {
  return JSON.stringify({
    targetId: inboxId.targetId,
    targetTypeUrl: inboxId.targetTypeUrl,
  });
}

const inboxRecordTypeUrl = "type.spine-ts.dev/internal/InboxMessageRecord";
const dedupRecordTypeUrl = "type.spine-ts.dev/internal/InboxDedupRecord";
const maxSignalPayloadChars = Math.ceil(maxSignalPayloadBytes / 3) * 4;
const maxStoredRecordBytes = 512 * 1024;
const maxTextBytes = 16 * 1024;
const maxCompositeTextBytes = 64 * 1024;
const canonicalBase64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
