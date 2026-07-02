import { create } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import { RecordColumn, RecordSpec } from "@spine-ts/storage";

import { DeliveryStorageCorruptionError } from "./delivery-storage-error.js";
import type { DeliveryLabel, DeliveryStatus, InboxMessage, InboxMessageId } from "./inbox.js";
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
  readonly inbox: string;
  readonly signalId: string;
  readonly inboxMessageId: string;
  readonly shardIndex: number;
  readonly shardTotal: number;
  readonly state: "PENDING";
  readonly claimedAtMs: number;
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

export type StoredDedupRecord = StoredPendingDedupRecord | StoredFinalDedupRecord;

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
  extractId: (record) => readDedupRecord(record).key,
});

export function readInboxMessage(record: Any): InboxMessage {
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
    version: parseStoredVersion(stored.version),
    ...(stored.signal === undefined ? {} : { signal: unpackSignal(stored.signal) }),
    ...(stored.keepUntilMs === undefined ? {} : { keepUntil: new Date(stored.keepUntilMs) }),
  });
}

export function writeInboxMessage(message: InboxMessage): Any {
  assertSignalPayloadSize(message.signal);

  const stored: StoredInboxMessage = {
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
  };

  return packRecord(inboxRecordTypeUrl, stored);
}

export function dedupGuardKey(message: Pick<InboxMessage, "inboxId" | "signalId">): string {
  return `${inboxKey(message.inboxId)}:${requireText(message.signalId, "Inbox signal ID")}`;
}

export function readDedupRecord(record: Any): StoredDedupRecord {
  const decoded = readStoredRecord(record, dedupRecordTypeUrl, "Inbox dedup record");
  const state = requireDedupState(decoded.state);
  const common = {
    key: requireText(decoded.key, "Inbox dedup key"),
    inbox: requireText(decoded.inbox, "Inbox dedup inbox"),
    signalId: requireText(decoded.signalId, "Inbox dedup signal ID"),
    inboxMessageId: requireText(decoded.inboxMessageId, "Inbox dedup message ID"),
    shardIndex: requireNumber(decoded.shardIndex, "Inbox dedup shard index"),
    shardTotal: requireNumber(decoded.shardTotal, "Inbox dedup shard total"),
  } as const;

  if (state === "PENDING") {
    return Object.freeze({
      ...common,
      state,
      claimedAtMs: requireNumber(decoded.claimedAtMs, "Inbox dedup claim time"),
    });
  }

  return Object.freeze({
    ...common,
    state,
    status: requireDeliveryStatus(decoded.status),
    ...(decoded.keepUntilMs === undefined
      ? {}
      : {
          keepUntilMs: requireNumber(decoded.keepUntilMs, "Inbox dedup keep-until time"),
        }),
  });
}

export function writeDedupClaim(message: InboxMessage, now: Date): Any {
  const stored: StoredPendingDedupRecord = {
    key: dedupGuardKey(message),
    inbox: inboxKey(message.inboxId),
    signalId: requireText(message.signalId, "Inbox signal ID"),
    inboxMessageId: requireText(message.id.value, "Inbox message ID"),
    shardIndex: message.id.shard.index,
    shardTotal: message.id.shard.ofTotal,
    state: "PENDING",
    claimedAtMs: requireTimestamp(now, "Inbox dedup claim time"),
  };

  return packRecord(dedupRecordTypeUrl, stored);
}

export function writeDedupRecord(message: InboxMessage): Any {
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

export function dedupRecordBlocks(record: StoredDedupRecord, now: Date): boolean {
  return (
    record.state === "PENDING" ||
    record.status !== "DELIVERED" ||
    keepUntilActive(record.keepUntilMs, now.getTime())
  );
}

export function dedupMessageId(record: StoredDedupRecord): InboxMessageId {
  return Object.freeze({
    value: requireText(record.inboxMessageId, "Inbox dedup message ID"),
    shard: new ShardIndex(
      requireNumber(record.shardIndex, "Inbox dedup shard index"),
      requireNumber(record.shardTotal, "Inbox dedup shard total"),
    ),
  });
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

function packSignal(signal: Any): StoredSignal {
  return Object.freeze({
    typeUrl: requireText(signal.typeUrl, "Inbox signal type URL"),
    valueBase64: Buffer.from(signal.value).toString("base64"),
  });
}

function unpackSignal(signal: StoredSignal): Any {
  return create(AnySchema, {
    typeUrl: requireText(signal.typeUrl, "Inbox signal type URL"),
    value: Buffer.from(requireText(signal.valueBase64, "Inbox signal payload"), "base64"),
  });
}

function readStoredInboxMessage(record: Any): StoredInboxMessage {
  const decoded = readStoredRecord(record, inboxRecordTypeUrl, "Inbox message record");
  const shard = new ShardIndex(
    requireNumber(decoded.shardIndex, "Inbox shard index"),
    requireNumber(decoded.shardTotal, "Inbox shard total"),
  );

  if (requireText(decoded.shard, "Inbox shard key") !== shard.key()) {
    throw new DeliveryStorageCorruptionError(
      "Inbox message record shard key does not match shard.",
    );
  }

  const inboxId = readStoredInboxId(decoded.inboxId);

  return Object.freeze({
    key: requireText(decoded.key, "Inbox message key"),
    id: requireText(decoded.id, "Inbox message ID"),
    shard: shard.key(),
    shardIndex: shard.index,
    shardTotal: shard.ofTotal,
    inbox: requireText(decoded.inbox, "Inbox key"),
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

function keepUntilActive(keepUntilMs: number | undefined, nowMs: number): boolean {
  return keepUntilMs !== undefined && keepUntilMs >= nowMs;
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

function requireDedupState(value: unknown): StoredDedupRecord["state"] {
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

const inboxRecordTypeUrl = "type.spine-ts.dev/internal/InboxMessageRecord";
const dedupRecordTypeUrl = "type.spine-ts.dev/internal/InboxDedupRecord";
