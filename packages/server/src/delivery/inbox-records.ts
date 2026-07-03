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

export interface DedupGuardState {
  readonly messageId: InboxMessageId;
  readonly status: DeliveryStatus;
  readonly keepUntil?: Date;
}

interface InboxMessageSnapshot {
  readonly id: string;
  readonly idShard: ShardIndex;
  readonly shard: ShardIndex;
  readonly inboxId: {
    readonly targetId: string;
    readonly targetTypeUrl: string;
  };
  readonly inbox: string;
  readonly signalId: string;
  readonly signal?: StoredSignal;
  readonly label: DeliveryLabel;
  readonly status: DeliveryStatus;
  readonly whenReceivedMs: number;
  readonly version: string;
  readonly keepUntilMs?: number;
}

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

/** Encodes and decodes durable inbox message records. */
export const InboxRecords: Readonly<{
  read(record: Any, expectedKey?: string): InboxMessage;
  write(message: InboxMessage): Any;
}> = Object.freeze({
  /** Read a durable inbox message record. */
  read(record: Any, expectedKey?: string): InboxMessage {
    return inboxMessageFromStored(readStoredInboxMessage(record, expectedKey));
  },

  /** Write a durable inbox message record. */
  write(message: InboxMessage): Any {
    return packRecord(inboxRecordTypeUrl, "Inbox message record", storedInboxMessage(message));
  },
});

/** Encodes, decodes, and keys durable dedup guard records. */
export const DedupRecords: Readonly<{
  guardKey(message: Pick<InboxMessage, "inboxId" | "signalId">): string;
  isPending(record: Any): boolean;
  writeClaim(message: InboxMessage): Any;
  writeFinal(message: InboxMessage): Any;
  readGuard(record: Any, expectedKey?: string): DedupGuardState;
  readPendingMessage(record: Any): InboxMessage | undefined;
}> = Object.freeze({
  /** Build the durable dedup guard key for one inbox signal target. */
  guardKey(message: Pick<InboxMessage, "inboxId" | "signalId">): string {
    return requireCompositeInputText(
      `${inboxKey(message.inboxId)}:${requireInputText(message.signalId, "Inbox signal ID")}`,
      "Inbox dedup key",
    );
  },

  /** Whether the durable guard is a pending claim. */
  isPending(record: Any): boolean {
    return readStoredDedupRecord(record).state === "PENDING";
  },

  /** Write a pending durable dedup claim. */
  writeClaim(message: InboxMessage): Any {
    const storedMessage = storedInboxMessage(message);
    const stored: StoredPendingDedupRecord = {
      key: requireCompositeInputText(
        storedDedupGuardKey(storedMessage.inbox, storedMessage.signalId),
        "Inbox dedup key",
      ),
      state: "PENDING",
      message: storedMessage,
    };
    assertPendingClaimBudget(stored);

    return packRecord(dedupRecordTypeUrl, "Inbox dedup record", stored);
  },

  /** Write a final durable dedup guard. */
  writeFinal(message: InboxMessage): Any {
    const storedMessage = storedInboxMessage(message);

    const stored: StoredFinalDedupRecord = {
      key: requireCompositeInputText(
        storedDedupGuardKey(storedMessage.inbox, storedMessage.signalId),
        "Inbox dedup key",
      ),
      inbox: storedMessage.inbox,
      signalId: storedMessage.signalId,
      inboxMessageId: storedMessage.id,
      shardIndex: storedMessage.shardIndex,
      shardTotal: storedMessage.shardTotal,
      state: "FINAL",
      status: storedMessage.status,
      ...(storedMessage.keepUntilMs === undefined
        ? {}
        : { keepUntilMs: storedMessage.keepUntilMs }),
    };

    return packRecord(dedupRecordTypeUrl, "Inbox dedup record", stored);
  },

  /** Read a durable dedup guard state. */
  readGuard(record: Any, expectedKey?: string): DedupGuardState {
    const dedup = readStoredDedupRecord(record);
    if (expectedKey !== undefined && dedup.key !== expectedKey) {
      throw new DeliveryStorageCorruptionError(
        `Inbox dedup guard "${expectedKey}" does not match its storage key.`,
      );
    }

    return dedup.state === "PENDING"
      ? dedupGuardState(
          dedup.message.id,
          dedup.message.shardIndex,
          dedup.message.shardTotal,
          dedup.message.status,
          dedup.message.keepUntilMs,
        )
      : dedupGuardState(
          dedup.inboxMessageId,
          dedup.shardIndex,
          dedup.shardTotal,
          dedup.status,
          dedup.keepUntilMs,
        );
  },

  /** Read the pending message embedded in a durable dedup guard. */
  readPendingMessage(record: Any): InboxMessage | undefined {
    const dedup = readStoredDedupRecord(record);
    return dedup.state === "PENDING" ? inboxMessageFromStored(dedup.message) : undefined;
  },
});

function readStoredDedupRecord(record: Any): StoredDedupRecord {
  const decoded = readStoredRecord(record, dedupRecordTypeUrl, "Inbox dedup record");
  const state = requireDedupState(decoded.state);
  const key = requireStoredText(decoded.key, "Inbox dedup key", maxCompositeTextBytes);

  return state === "PENDING" ? readPendingDedup(decoded, key) : readFinalDedup(decoded, key);
}

function inboxKey(inboxId: InboxMessage["inboxId"]): string {
  const input = requireInputObject(inboxId, "Inbox target identity");
  const targetId = requireInputText(Reflect.get(input, "targetId"), "Inbox target ID");
  const targetTypeUrl = requireInputText(
    Reflect.get(input, "targetTypeUrl"),
    "Inbox target type URL",
  );

  return inboxKeyFromText(targetId, targetTypeUrl);
}

function inboxKeyFromText(targetId: string, targetTypeUrl: string): string {
  return requireCompositeInputText(
    JSON.stringify({
      targetId,
      targetTypeUrl,
    }),
    "Inbox key",
  );
}

function dedupGuardState(
  messageId: string,
  shardIndex: number,
  shardTotal: number,
  status: DeliveryStatus,
  keepUntilMs?: number,
): DedupGuardState {
  const shard = storedShardIndex(
    requireNumber(shardIndex, "Inbox dedup shard index"),
    requireNumber(shardTotal, "Inbox dedup shard total"),
    "Inbox dedup shard",
  );

  return Object.freeze({
    messageId: Object.freeze({
      value: requireStoredText(messageId, "Inbox dedup message ID"),
      shard,
    }),
    status,
    ...(keepUntilMs === undefined
      ? {}
      : { keepUntil: storedDate(keepUntilMs, "Inbox dedup keep-until time") }),
  });
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
  const snapshot = snapshotInboxMessage(message);

  return Object.freeze({
    key: storedInboxMessageKey(snapshot.id, snapshot.idShard),
    id: snapshot.id,
    shard: snapshot.shard.key(),
    shardIndex: snapshot.shard.index,
    shardTotal: snapshot.shard.ofTotal,
    inbox: snapshot.inbox,
    inboxId: {
      targetId: snapshot.inboxId.targetId,
      targetTypeUrl: snapshot.inboxId.targetTypeUrl,
    },
    signalId: snapshot.signalId,
    label: snapshot.label,
    status: snapshot.status,
    whenReceivedMs: snapshot.whenReceivedMs,
    version: snapshot.version,
    ...(snapshot.signal === undefined ? {} : { signal: snapshot.signal }),
    ...(snapshot.keepUntilMs === undefined ? {} : { keepUntilMs: snapshot.keepUntilMs }),
  });
}

function snapshotInboxMessage(message: InboxMessage): InboxMessageSnapshot {
  const messageInput = requireInputObject(message, "Inbox message");
  const idInput = requireInputObject(
    readInputProperty(messageInput, "id", "Inbox message ID"),
    "Inbox message ID",
  );
  const inboxIdInput = requireInputObject(
    readInputProperty(messageInput, "inboxId", "Inbox target identity"),
    "Inbox target identity",
  );
  const idShard = requireInputShard(
    readInputProperty(idInput, "shard", "Inbox message ID shard"),
    "Inbox message ID shard",
  );
  const shard = requireInputShard(
    readInputProperty(messageInput, "shard", "Inbox message shard"),
    "Inbox message shard",
  );
  if (idShard.key() !== shard.key()) {
    throw new InboxMessageError("Inbox message ID shard does not match message shard.");
  }

  const id = requireMessageIdText(readInputProperty(idInput, "value", "Inbox message ID"));
  const targetId = requireInputText(
    readInputProperty(inboxIdInput, "targetId", "Inbox target ID"),
    "Inbox target ID",
  );
  const targetTypeUrl = requireInputText(
    readInputProperty(inboxIdInput, "targetTypeUrl", "Inbox target type URL"),
    "Inbox target type URL",
  );
  const signalId = requireInputText(
    readInputProperty(messageInput, "signalId", "Inbox signal ID"),
    "Inbox signal ID",
  );
  const label = requireInputDeliveryLabel(
    readInputProperty(messageInput, "label", "Inbox delivery label"),
  );
  const status = requireInputDeliveryStatus(
    readInputProperty(messageInput, "status", "Inbox delivery status"),
  );
  const whenReceivedMs = requireInputTimestamp(
    readInputProperty(messageInput, "whenReceived", "Inbox receive time"),
    "Inbox receive time",
  );
  const version = requireInputVersion(readInputProperty(messageInput, "version", "Inbox version"));
  const signal = readInputProperty(messageInput, "signal", "Inbox signal") as Any | undefined;
  const keepUntil = readInputProperty(messageInput, "keepUntil", "Inbox keep-until time");

  return Object.freeze({
    id,
    idShard,
    shard,
    inboxId: Object.freeze({ targetId, targetTypeUrl }),
    inbox: inboxKeyFromText(targetId, targetTypeUrl),
    signalId,
    ...(signal === undefined ? {} : { signal: packSignal(signal) }),
    label,
    status,
    whenReceivedMs,
    version,
    ...(keepUntil === undefined
      ? {}
      : { keepUntilMs: requireInputTimestamp(keepUntil, "Inbox keep-until time") }),
  });
}

function readInputProperty(
  value: Record<string, unknown>,
  property: string,
  label: string,
): unknown {
  try {
    return Reflect.get(value, property);
  } catch (error) {
    throw new InboxMessageError(`${label} is invalid.`, { cause: error });
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
  const value = requireInputBytes(signal.value, "Inbox signal payload");
  if (value.byteLength > maxSignalPayloadBytes) {
    throw new InboxMessageError(
      `Inbox signal payload exceeds ${String(maxSignalPayloadBytes)} bytes and cannot be stored.`,
    );
  }

  return Object.freeze({
    typeUrl: requireSignalTypeUrl(signal),
    valueBase64: Buffer.from(value).toString("base64"),
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
  const typeUrl = readRecordTypeUrl(record, label);
  if (typeUrl !== expectedTypeUrl) {
    throw new DeliveryStorageCorruptionError(`${label} type URL "${typeUrl}" is invalid.`);
  }

  const value = readStoredBytes(record, label);
  if (value.byteLength > maxStoredRecordBytes) {
    throw new DeliveryStorageCorruptionError(
      `${label} exceeds ${String(maxStoredRecordBytes)} bytes and cannot be read.`,
    );
  }

  try {
    const decoded = JSON.parse(decodeStoredUtf8(value, label)) as unknown;

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

function readRecordTypeUrl(record: Any, label: string): string {
  try {
    return requireStoredText(Reflect.get(record, "typeUrl"), `${label} type URL`);
  } catch (error) {
    if (error instanceof DeliveryStorageCorruptionError) {
      throw error;
    }

    throw new DeliveryStorageCorruptionError(`${label} type URL is invalid.`, {
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

function requireSignalTypeUrl(signal: Any): string {
  try {
    return requireInputText(Reflect.get(signal, "typeUrl"), "Inbox signal type URL");
  } catch (error) {
    if (error instanceof InboxMessageError) {
      throw error;
    }

    throw new InboxMessageError("Inbox signal type URL is invalid.", { cause: error });
  }
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

function requireInputInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || !Number.isFinite(value)) {
    throw new InboxMessageError(`${label} must be a finite integer.`);
  }

  return value as number;
}

function requireInputBytes(value: unknown, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new InboxMessageError(`${label} must be a Uint8Array.`);
  }

  try {
    return Buffer.from(value);
  } catch (error) {
    throw new InboxMessageError(`${label} is invalid.`, { cause: error });
  }
}

function requireInputObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InboxMessageError(`${label} is invalid.`);
  }

  return value as Record<string, unknown>;
}

function requireInputShard(value: unknown, label: string): ShardIndex {
  if (typeof value !== "object" || value === null) {
    throw new InboxMessageError(`${label} is invalid.`);
  }

  try {
    return new ShardIndex(
      requireInputInteger(Reflect.get(value, "index"), `${label} index`),
      requireInputInteger(Reflect.get(value, "ofTotal"), `${label} total`),
    );
  } catch (error) {
    if (error instanceof InboxMessageError) {
      throw error;
    }

    throw new InboxMessageError(`${label} is invalid.`, { cause: error });
  }
}

function requireCompositeInputText(value: string, label: string): string {
  if (Buffer.byteLength(value, "utf8") > maxCompositeTextBytes) {
    throw new InboxMessageError(
      `${label} exceeds ${String(maxCompositeTextBytes)} bytes and cannot be stored.`,
    );
  }

  return value;
}

function requireMessageIdText(value: unknown): string {
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

function requireInputTimestamp(value: unknown, label: string): number {
  if (!(value instanceof Date)) {
    throw new InboxMessageError(`${label} must be a Date.`);
  }

  let time: number;
  try {
    time = value.getTime();
  } catch (error) {
    throw new InboxMessageError(`${label} is invalid.`, { cause: error });
  }

  if (!Number.isFinite(time)) {
    throw new InboxMessageError(`${label} is invalid.`);
  }

  return time;
}

function requireInputVersion(value: unknown): string {
  if (typeof value !== "bigint") {
    throw new InboxMessageError("Inbox version must be a bigint.");
  }

  return requireInputText(value.toString(), "Inbox version");
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
  const shard = storedShardIndex(
    requireNumber(decoded.shardIndex, "Inbox shard index"),
    requireNumber(decoded.shardTotal, "Inbox shard total"),
    "Inbox shard",
  );
  if (requireStoredText(decoded.shard, "Inbox shard key", maxCompositeTextBytes) !== shard.key()) {
    throw new DeliveryStorageCorruptionError(
      "Inbox message record shard key does not match shard.",
    );
  }

  return shard;
}

function readStoredBytes(record: Any, label: string): Uint8Array {
  try {
    const value = Reflect.get(record, "value") as unknown;
    if (!(value instanceof Uint8Array)) {
      throw new DeliveryStorageCorruptionError(`${label} value must be a Uint8Array.`);
    }

    return value;
  } catch (error) {
    if (error instanceof DeliveryStorageCorruptionError) {
      throw error;
    }

    throw new DeliveryStorageCorruptionError(`${label} value is invalid.`, { cause: error });
  }
}

function storedShardIndex(index: number, total: number, label: string): ShardIndex {
  try {
    return new ShardIndex(index, total);
  } catch (error) {
    throw new DeliveryStorageCorruptionError(`${label} is invalid.`, { cause: error });
  }
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
    whenReceivedMs: requireStoredTimestampNumber(decoded.whenReceivedMs, "Inbox receive time"),
    version: requireStoredText(decoded.version, "Inbox version"),
    ...(decoded.keepUntilMs === undefined
      ? {}
      : {
          keepUntilMs: requireStoredTimestampNumber(decoded.keepUntilMs, "Inbox keep-until time"),
        }),
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
