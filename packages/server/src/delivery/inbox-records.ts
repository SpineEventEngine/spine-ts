import { create } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import { RecordColumn, RecordSpec } from "@spine-event-engine/storage";

import { DeliveryStorageCorruptionError } from "./delivery-storage-error.js";
import {
  InboxMessageError,
  type DeliveryLabel,
  type DeliveryStatus,
  type InboxMessage,
  type InboxMessageId,
} from "./inbox.js";
import type { InboxClaim, InboxRecordMessage } from "./inbox-claim.js";
import { ShardIndex } from "./shard-index.js";

/** Encodes and decodes durable inbox message records. */
export const InboxRecords: Readonly<{
  read(record: Any, expectedKey?: string): InboxRecordMessage;
  write(message: InboxRecordMessage): Any;
}> = Object.freeze({
  /** Reads a durable inbox message record. */
  read(record: Any, expectedKey?: string): InboxRecordMessage {
    return InboxRecordValues.inboxMessageFromStored(
      InboxRecordValues.readStoredInboxMessage(record, expectedKey),
    );
  },

  /** Writes a durable inbox message record. */
  write(message: InboxRecordMessage): Any {
    return InboxRecordValues.packRecord(
      inboxRecordTypeUrl,
      "Inbox message record",
      InboxRecordValues.storedInboxMessage(message),
    );
  },
});

/** Encodes and decodes internal durable inbox claims. */
export const InboxClaimRecords: Readonly<{
  snapshot(claim: InboxClaim): InboxClaim;
}> = Object.freeze({
  /** Validates and copies one caller-provided claim snapshot. */
  snapshot(claim: InboxClaim): InboxClaim {
    return InboxRecordValues.snapshotClaim(claim);
  },
});

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
  readonly label: StoredDeliveryLabel;
  readonly status: DeliveryStatus;
  readonly whenReceivedMs: number;
  readonly version: string;
  readonly keepUntilMs?: number;
  readonly claim?: StoredInboxClaim;
}

interface StoredInboxClaim {
  readonly id: string;
  readonly node: string;
  readonly expiresAtMs: number;
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

/** Describes the durable deduplication guard for one delivered signal. */
export interface DedupGuardState {
  /** Identifies the inbox message protected by this guard. */
  readonly messageId: InboxMessageId;
  /** Records the message status represented by the guard. */
  readonly status: DeliveryStatus;
  /** Limits how long a delivered guard suppresses duplicates. */
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
  readonly claim?: InboxClaim;
}

type StoredDeliveryLabel = DeliveryLabel | "IMPORT_EVENT";

const maxSignalPayloadBytes: number = 256 * 1024;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

/** Defines the durable record shape for inbox messages. */
export const inboxRecordSpec: RecordSpec<string, Any> = new RecordSpec<string, Any>({
  schema: AnySchema,
  storageKey: "spine.delivery.Inbox:current",
  idKind: "string",
  extractId: (record) => InboxRecordValues.readStoredInboxMessage(record).key,
  columns: [
    new RecordColumn(
      "signalId",
      (record) => InboxRecordValues.readStoredInboxMessage(record).signalId,
      "string",
    ),
    new RecordColumn(
      "inbox",
      (record) => InboxRecordValues.readStoredInboxMessage(record).inbox,
      "string",
    ),
    new RecordColumn(
      "status",
      (record) => InboxRecordValues.readStoredInboxMessage(record).status,
      "string",
    ),
    new RecordColumn(
      "label",
      (record) => InboxRecordValues.readStoredInboxMessage(record).label,
      "string",
    ),
    new RecordColumn(
      "shard",
      (record) => InboxRecordValues.readStoredInboxMessage(record).shard,
      "string",
    ),
    new RecordColumn(
      "receivedAt",
      (record) => InboxRecordValues.readStoredInboxMessage(record).whenReceivedMs,
      "number",
    ),
    new RecordColumn(
      "version",
      (record) =>
        InboxRecordValues.parseStoredVersion(
          InboxRecordValues.readStoredInboxMessage(record).version,
        ),
      "int64",
    ),
    new RecordColumn(
      "messageId",
      (record) => InboxRecordValues.readStoredInboxMessage(record).id,
      "string",
    ),
  ],
});

/** Defines the durable record shape for inbox deduplication guards. */
export const dedupRecordSpec: RecordSpec<string, Any> = new RecordSpec<string, Any>({
  schema: AnySchema,
  storageKey: "spine.delivery.Deduplication:current",
  idKind: "string",
  extractId: (record) => InboxRecordValues.readStoredDedupRecord(record).key,
});

/** Encodes, decodes, and keys durable dedup guard records. */
export const DedupRecords: Readonly<{
  guardKey(message: Pick<InboxMessage, "inboxId" | "signalId">): string;
  isPending(record: Any): boolean;
  writeClaim(message: InboxRecordMessage): Any;
  writeFinal(message: InboxRecordMessage): Any;
  readGuard(record: Any, expectedKey?: string): DedupGuardState;
  readPendingMessage(record: Any): InboxRecordMessage | undefined;
}> = Object.freeze({
  /** Builds the durable dedup guard key for one inbox signal target. */
  guardKey(message: Pick<InboxMessage, "inboxId" | "signalId">): string {
    const inbox = InboxRecordValues.inboxKey(message.inboxId);
    const signal = InboxRecordValues.requireInputText(message.signalId, "Inbox signal ID");
    return InboxRecordValues.requireCompositeInputText(`${inbox}:${signal}`, "Inbox dedup key");
  },

  /** Whether the durable guard is a pending claim. */
  isPending(record: Any): boolean {
    return InboxRecordValues.readStoredDedupRecord(record).state === "PENDING";
  },

  /** Writes a pending durable dedup claim. */
  writeClaim(message: InboxRecordMessage): Any {
    const storedMessage = InboxRecordValues.storedInboxMessage(message);
    const stored: StoredPendingDedupRecord = {
      key: InboxRecordValues.requireCompositeInputText(
        InboxRecordValues.storedDedupGuardKey(storedMessage.inbox, storedMessage.signalId),
        "Inbox dedup key",
      ),
      state: "PENDING",
      message: storedMessage,
    };
    InboxRecordValues.assertPendingClaimBudget(stored);

    return InboxRecordValues.packRecord(dedupRecordTypeUrl, "Inbox dedup record", stored);
  },

  /** Writes a final durable dedup guard. */
  writeFinal(message: InboxRecordMessage): Any {
    const storedMessage = InboxRecordValues.storedInboxMessage(message);

    const stored: StoredFinalDedupRecord = {
      key: InboxRecordValues.requireCompositeInputText(
        InboxRecordValues.storedDedupGuardKey(storedMessage.inbox, storedMessage.signalId),
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

    return InboxRecordValues.packRecord(dedupRecordTypeUrl, "Inbox dedup record", stored);
  },

  /** Reads a durable dedup guard state. */
  readGuard(record: Any, expectedKey?: string): DedupGuardState {
    const dedup = InboxRecordValues.readStoredDedupRecord(record);
    if (expectedKey !== undefined && dedup.key !== expectedKey) {
      throw new DeliveryStorageCorruptionError(
        `Inbox dedup guard "${expectedKey}" does not match its storage key.`,
      );
    }

    return dedup.state === "PENDING"
      ? InboxRecordValues.dedupGuardState(
          dedup.message.id,
          dedup.message.shardIndex,
          dedup.message.shardTotal,
          dedup.message.status,
          dedup.message.keepUntilMs,
        )
      : InboxRecordValues.dedupGuardState(
          dedup.inboxMessageId,
          dedup.shardIndex,
          dedup.shardTotal,
          dedup.status,
          dedup.keepUntilMs,
        );
  },

  /** Reads the pending message embedded in a durable dedup guard. */
  readPendingMessage(record: Any): InboxRecordMessage | undefined {
    const dedup = InboxRecordValues.readStoredDedupRecord(record);
    return dedup.state === "PENDING"
      ? InboxRecordValues.inboxMessageFromStored(dedup.message)
      : undefined;
  },
});

const InboxRecordValues = Object.freeze({
  readStoredDedupRecord(record: Any): StoredDedupRecord {
    const decoded = InboxRecordValues.readStoredRecord(
      record,
      dedupRecordTypeUrl,
      "Inbox dedup record",
    );
    const state = InboxRecordValues.requireDedupState(decoded.state);
    const key = InboxRecordValues.requireStoredText(
      decoded.key,
      "Inbox dedup key",
      maxCompositeTextBytes,
    );

    return state === "PENDING"
      ? InboxRecordValues.readPendingDedup(decoded, key)
      : InboxRecordValues.readFinalDedup(decoded, key);
  },

  inboxKey(inboxId: InboxMessage["inboxId"]): string {
    const input = InboxRecordValues.requireInputObject(inboxId, "Inbox target identity");
    const targetId = InboxRecordValues.requireInputText(
      Reflect.get(input, "targetId"),
      "Inbox target ID",
    );
    const targetTypeUrl = InboxRecordValues.requireInputText(
      Reflect.get(input, "targetTypeUrl"),
      "Inbox target type URL",
    );

    return InboxRecordValues.inboxKeyFromText(targetId, targetTypeUrl);
  },

  inboxKeyFromText(targetId: string, targetTypeUrl: string): string {
    return InboxRecordValues.requireCompositeInputText(
      JSON.stringify({
        targetId,
        targetTypeUrl,
      }),
      "Inbox key",
    );
  },

  dedupGuardState(
    messageId: string,
    shardIndex: number,
    shardTotal: number,
    status: DeliveryStatus,
    keepUntilMs?: number,
  ): DedupGuardState {
    const shard = InboxRecordValues.storedShardIndex(
      InboxRecordValues.requireNumber(shardIndex, "Inbox dedup shard index"),
      InboxRecordValues.requireNumber(shardTotal, "Inbox dedup shard total"),
      "Inbox dedup shard",
    );

    return Object.freeze({
      messageId: Object.freeze({
        value: InboxRecordValues.requireStoredText(messageId, "Inbox dedup message ID"),
        shard,
      }),
      status,
      ...(keepUntilMs === undefined
        ? {}
        : { keepUntil: InboxRecordValues.storedDate(keepUntilMs, "Inbox dedup keep-until time") }),
    });
  },

  packRecord(typeUrl: string, label: string, value: StoredInboxMessage | StoredDedupRecord): Any {
    const encoded = Buffer.from(JSON.stringify(value), "utf8");
    InboxRecordValues.assertStoredRecordSize(encoded, label);

    return create(AnySchema, {
      typeUrl,
      value: encoded,
    });
  },

  storedInboxMessage(message: InboxRecordMessage): StoredInboxMessage {
    const snapshot = InboxRecordValues.snapshotInboxMessage(message);

    return Object.freeze({
      key: InboxRecordValues.storedInboxMessageKey(snapshot.id, snapshot.idShard),
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
      ...(snapshot.claim === undefined
        ? {}
        : {
            claim: {
              id: snapshot.claim.id,
              node: snapshot.claim.node,
              expiresAtMs: InboxRecordValues.requireInputTimestamp(
                snapshot.claim.expiresAt,
                "Inbox claim expiry time",
              ),
            },
          }),
    });
  },

  snapshotInboxMessage(message: InboxRecordMessage): InboxMessageSnapshot {
    const messageInput = InboxRecordValues.requireInputObject(message, "Inbox message");
    const idInput = InboxRecordValues.requireInputObject(
      InboxRecordValues.readInputProperty(messageInput, "id", "Inbox message ID"),
      "Inbox message ID",
    );
    const inboxIdInput = InboxRecordValues.requireInputObject(
      InboxRecordValues.readInputProperty(messageInput, "inboxId", "Inbox target identity"),
      "Inbox target identity",
    );
    const idShard = InboxRecordValues.requireInputShard(
      InboxRecordValues.readInputProperty(idInput, "shard", "Inbox message ID shard"),
      "Inbox message ID shard",
    );
    const shard = InboxRecordValues.requireInputShard(
      InboxRecordValues.readInputProperty(messageInput, "shard", "Inbox message shard"),
      "Inbox message shard",
    );
    if (idShard.key() !== shard.key()) {
      throw new InboxMessageError("Inbox message ID shard does not match message shard.");
    }

    const id = InboxRecordValues.requireMessageIdText(
      InboxRecordValues.readInputProperty(idInput, "value", "Inbox message ID"),
    );
    const targetId = InboxRecordValues.requireInputText(
      InboxRecordValues.readInputProperty(inboxIdInput, "targetId", "Inbox target ID"),
      "Inbox target ID",
    );
    const targetTypeUrl = InboxRecordValues.requireInputText(
      InboxRecordValues.readInputProperty(inboxIdInput, "targetTypeUrl", "Inbox target type URL"),
      "Inbox target type URL",
    );
    const signalId = InboxRecordValues.requireInputText(
      InboxRecordValues.readInputProperty(messageInput, "signalId", "Inbox signal ID"),
      "Inbox signal ID",
    );
    const label = InboxRecordValues.requireInputDeliveryLabel(
      InboxRecordValues.readInputProperty(messageInput, "label", "Inbox delivery label"),
    );
    const status = InboxRecordValues.requireInputDeliveryStatus(
      InboxRecordValues.readInputProperty(messageInput, "status", "Inbox delivery status"),
    );
    const whenReceivedMs = InboxRecordValues.requireInputTimestamp(
      InboxRecordValues.readInputProperty(messageInput, "whenReceived", "Inbox receive time"),
      "Inbox receive time",
    );
    const version = InboxRecordValues.requireInputVersion(
      InboxRecordValues.readInputProperty(messageInput, "version", "Inbox version"),
    );
    const signal = InboxRecordValues.readInputProperty(messageInput, "signal", "Inbox signal") as
      Any | undefined;
    const keepUntil = InboxRecordValues.readInputProperty(
      messageInput,
      "keepUntil",
      "Inbox keep-until time",
    );
    const claim = InboxRecordValues.readOwnInputProperty(messageInput, "claim", "Inbox claim") as
      InboxClaim | undefined;

    return Object.freeze({
      id,
      idShard,
      shard,
      inboxId: Object.freeze({ targetId, targetTypeUrl }),
      inbox: InboxRecordValues.inboxKeyFromText(targetId, targetTypeUrl),
      signalId,
      ...(signal === undefined ? {} : { signal: InboxRecordValues.packSignal(signal) }),
      label,
      status,
      whenReceivedMs,
      version,
      ...(keepUntil === undefined
        ? {}
        : {
            keepUntilMs: InboxRecordValues.requireInputTimestamp(
              keepUntil,
              "Inbox keep-until time",
            ),
          }),
      ...(claim === undefined ? {} : { claim: InboxRecordValues.snapshotClaim(claim) }),
    });
  },

  readInputProperty(value: Record<string, unknown>, property: string, label: string): unknown {
    try {
      return Reflect.get(value, property);
    } catch (error) {
      throw new InboxMessageError(`${label} is invalid.`, { cause: error });
    }
  },

  readOwnInputProperty(value: Record<string, unknown>, property: string, label: string): unknown {
    try {
      return Object.prototype.hasOwnProperty.call(value, property)
        ? Reflect.get(value, property)
        : undefined;
    } catch (error) {
      throw new InboxMessageError(`${label} is invalid.`, { cause: error });
    }
  },

  inboxMessageFromStored(stored: StoredInboxMessage): InboxRecordMessage {
    const shard = new ShardIndex(stored.shardIndex, stored.shardTotal);
    const label = InboxRecordValues.requireSupportedLabel(stored.label);

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
      label,
      status: stored.status,
      shard,
      whenReceived: InboxRecordValues.storedDate(stored.whenReceivedMs, "Inbox receive time"),
      version: InboxRecordValues.parseStoredVersion(stored.version),
      ...(stored.signal === undefined
        ? {}
        : { signal: InboxRecordValues.unpackSignal(stored.signal) }),
      ...(stored.keepUntilMs === undefined
        ? {}
        : { keepUntil: InboxRecordValues.storedDate(stored.keepUntilMs, "Inbox keep-until time") }),
      ...(stored.claim === undefined
        ? {}
        : { claim: InboxRecordValues.inboxClaimFromStored(stored.claim) }),
    });
  },

  snapshotClaim(claim: InboxClaim): InboxClaim {
    const claimInput = InboxRecordValues.requireInputObject(claim, "Inbox claim");

    return Object.freeze({
      id: InboxRecordValues.requireInputText(
        InboxRecordValues.readInputProperty(claimInput, "id", "Inbox claim ID"),
        "Inbox claim ID",
      ),
      node: InboxRecordValues.requireInputText(
        InboxRecordValues.readInputProperty(claimInput, "node", "Inbox claim node"),
        "Inbox claim node",
      ),
      expiresAt: new Date(
        InboxRecordValues.requireInputTimestamp(
          InboxRecordValues.readInputProperty(claimInput, "expiresAt", "Inbox claim expiry time"),
          "Inbox claim expiry time",
        ),
      ),
    });
  },

  inboxClaimFromStored(claim: StoredInboxClaim): InboxClaim {
    return Object.freeze({
      id: claim.id,
      node: claim.node,
      expiresAt: InboxRecordValues.storedDate(claim.expiresAtMs, "Inbox claim expiry time"),
    });
  },

  packSignal(signal: Any): StoredSignal {
    const signalInput = InboxRecordValues.requireInputObject(signal, "Inbox signal");
    const value = InboxRecordValues.requireInputBytes(
      InboxRecordValues.readInputProperty(signalInput, "value", "Inbox signal payload"),
      "Inbox signal payload",
    );
    if (value.byteLength > maxSignalPayloadBytes) {
      throw new InboxMessageError(
        `Inbox signal payload exceeds ${String(maxSignalPayloadBytes)} bytes and cannot be stored.`,
      );
    }

    return Object.freeze({
      typeUrl: InboxRecordValues.requireSignalTypeUrl(signalInput),
      valueBase64: Buffer.from(value).toString("base64"),
    });
  },

  unpackSignal(signal: StoredSignal): Any {
    const valueBase64 = InboxRecordValues.requireStoredSignalBase64(signal.valueBase64);

    return create(AnySchema, {
      typeUrl: InboxRecordValues.requireStoredText(signal.typeUrl, "Inbox signal type URL"),
      value: InboxRecordValues.decodeSignalPayload(valueBase64),
    });
  },

  readStoredInboxMessage(record: Any, expectedKey?: string): StoredInboxMessage {
    return InboxRecordValues.parseStoredInboxMessage(
      InboxRecordValues.readStoredRecord(record, inboxRecordTypeUrl, "Inbox message record"),
      "Inbox message record",
      expectedKey,
    );
  },

  parseStoredInboxMessage(value: unknown, label: string, expectedKey?: string): StoredInboxMessage {
    const decoded = InboxRecordValues.requireStoredObject(value, label);
    const shard = InboxRecordValues.readStoredShard(decoded);
    const id = InboxRecordValues.requireStoredText(decoded.id, "Inbox message ID");
    const key = InboxRecordValues.readStoredMessageKey(decoded, shard, id, expectedKey);
    const inboxId = InboxRecordValues.readStoredInboxId(decoded.inboxId);
    const inbox = InboxRecordValues.readStoredInboxKey(decoded, inboxId);

    return InboxRecordValues.buildStoredInboxMessage(decoded, shard, id, key, inbox, inboxId);
  },

  readStoredSignal(value: unknown): StoredSignal {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new DeliveryStorageCorruptionError("Inbox signal payload is invalid.");
    }

    return Object.freeze({
      typeUrl: InboxRecordValues.requireStoredText(
        Reflect.get(value, "typeUrl"),
        "Inbox signal type URL",
      ),
      valueBase64: InboxRecordValues.requireStoredSignalBase64(Reflect.get(value, "valueBase64")),
    });
  },

  readStoredInboxId(value: unknown): Readonly<{ targetId: string; targetTypeUrl: string }> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new DeliveryStorageCorruptionError("Inbox target identity is invalid.");
    }

    return Object.freeze({
      targetId: InboxRecordValues.requireStoredText(
        Reflect.get(value, "targetId"),
        "Inbox target ID",
      ),
      targetTypeUrl: InboxRecordValues.requireStoredText(
        Reflect.get(value, "targetTypeUrl"),
        "Inbox target type URL",
      ),
    });
  },

  readStoredRecord(record: Any, expectedTypeUrl: string, label: string): Record<string, unknown> {
    const typeUrl = InboxRecordValues.readRecordTypeUrl(record, label);
    if (typeUrl !== expectedTypeUrl) {
      throw new DeliveryStorageCorruptionError(`${label} type URL "${typeUrl}" is invalid.`);
    }

    const value = InboxRecordValues.readStoredBytes(record, label);
    if (value.byteLength > maxStoredRecordBytes) {
      throw new DeliveryStorageCorruptionError(
        `${label} exceeds ${String(maxStoredRecordBytes)} bytes and cannot be read.`,
      );
    }

    try {
      const decoded = JSON.parse(InboxRecordValues.decodeStoredUtf8(value, label)) as unknown;

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
  },

  readRecordTypeUrl(record: Any, label: string): string {
    try {
      return InboxRecordValues.requireStoredText(
        Reflect.get(record, "typeUrl"),
        `${label} type URL`,
      );
    } catch (error) {
      if (error instanceof DeliveryStorageCorruptionError) {
        throw error;
      }

      throw new DeliveryStorageCorruptionError(`${label} type URL is invalid.`, {
        cause: error,
      });
    }
  },

  decodeStoredUtf8(value: Uint8Array, label: string): string {
    try {
      return utf8Decoder.decode(value);
    } catch (error) {
      throw new DeliveryStorageCorruptionError(`${label} contains invalid UTF-8.`, {
        cause: error,
      });
    }
  },

  requireDeliveryLabel(value: unknown): StoredDeliveryLabel {
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
  },

  requireSupportedLabel(value: StoredDeliveryLabel): DeliveryLabel {
    if (value === "IMPORT_EVENT") {
      throw new DeliveryStorageCorruptionError(
        'Inbox delivery label "IMPORT_EVENT" is deprecated and unsupported.',
      );
    }

    return value;
  },

  requireInputDeliveryLabel(value: unknown): DeliveryLabel {
    if (
      value === "HANDLE_COMMAND" ||
      value === "UPDATE_SUBSCRIBER" ||
      value === "REACT_UPON_EVENT" ||
      value === "CATCH_UP"
    ) {
      return value;
    }

    throw new InboxMessageError(`Inbox delivery label "${String(value)}" is invalid.`);
  },

  requireSignalTypeUrl(signal: Record<string, unknown>): string {
    try {
      return InboxRecordValues.requireInputText(
        Reflect.get(signal, "typeUrl"),
        "Inbox signal type URL",
      );
    } catch (error) {
      if (error instanceof InboxMessageError) {
        throw error;
      }

      throw new InboxMessageError("Inbox signal type URL is invalid.", { cause: error });
    }
  },

  requireDeliveryStatus(value: unknown): DeliveryStatus {
    if (
      value === "TO_DELIVER" ||
      value === "SCHEDULED" ||
      value === "DELIVERED" ||
      value === "TO_CATCH_UP"
    ) {
      return value;
    }

    throw new DeliveryStorageCorruptionError(
      `Inbox delivery status "${String(value)}" is invalid.`,
    );
  },

  requireInputDeliveryStatus(value: unknown): DeliveryStatus {
    if (
      value === "TO_DELIVER" ||
      value === "SCHEDULED" ||
      value === "DELIVERED" ||
      value === "TO_CATCH_UP"
    ) {
      return value;
    }

    throw new InboxMessageError(`Inbox delivery status "${String(value)}" is invalid.`);
  },

  requireDedupState(value: unknown): "PENDING" | "FINAL" {
    if (value === "PENDING" || value === "FINAL") {
      return value;
    }

    throw new DeliveryStorageCorruptionError(`Inbox dedup state "${String(value)}" is invalid.`);
  },

  requireNumber(value: unknown, label: string): number {
    if (!Number.isInteger(value) || !Number.isFinite(value)) {
      throw new DeliveryStorageCorruptionError(`${label} must be a finite integer.`);
    }

    return value as number;
  },

  requireStoredText(value: unknown, label: string, maxBytes = maxTextBytes): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new DeliveryStorageCorruptionError(`${label} must be a non-empty string.`);
    }
    if (Buffer.byteLength(value, "utf8") > maxBytes) {
      throw new DeliveryStorageCorruptionError(
        `${label} exceeds ${String(maxBytes)} bytes and cannot be stored.`,
      );
    }

    return value;
  },

  requireInputText(value: unknown, label: string, maxBytes = maxTextBytes): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new InboxMessageError(`${label} must be a non-empty string.`);
    }
    if (Buffer.byteLength(value, "utf8") > maxBytes) {
      throw new InboxMessageError(
        `${label} exceeds ${String(maxBytes)} bytes and cannot be stored.`,
      );
    }

    return value;
  },

  requireInputInteger(value: unknown, label: string): number {
    if (!Number.isInteger(value) || !Number.isFinite(value)) {
      throw new InboxMessageError(`${label} must be a finite integer.`);
    }

    return value as number;
  },

  requireInputBytes(value: unknown, label: string): Uint8Array {
    if (!(value instanceof Uint8Array)) {
      throw new InboxMessageError(`${label} must be a Uint8Array.`);
    }

    try {
      return Buffer.from(value);
    } catch (error) {
      throw new InboxMessageError(`${label} is invalid.`, { cause: error });
    }
  },

  requireInputObject(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new InboxMessageError(`${label} is invalid.`);
    }

    return value as Record<string, unknown>;
  },

  requireInputShard(value: unknown, label: string): ShardIndex {
    if (typeof value !== "object" || value === null) {
      throw new InboxMessageError(`${label} is invalid.`);
    }

    try {
      return new ShardIndex(
        InboxRecordValues.requireInputInteger(Reflect.get(value, "index"), `${label} index`),
        InboxRecordValues.requireInputInteger(Reflect.get(value, "ofTotal"), `${label} total`),
      );
    } catch (error) {
      if (error instanceof InboxMessageError) {
        throw error;
      }

      throw new InboxMessageError(`${label} is invalid.`, { cause: error });
    }
  },

  requireCompositeInputText(value: string, label: string): string {
    if (Buffer.byteLength(value, "utf8") > maxCompositeTextBytes) {
      throw new InboxMessageError(
        `${label} exceeds ${String(maxCompositeTextBytes)} bytes and cannot be stored.`,
      );
    }

    return value;
  },

  requireMessageIdText(value: unknown): string {
    return InboxRecordValues.requireInputText(value, "Inbox message ID");
  },

  requireStoredSignalBase64(value: unknown): string {
    if (typeof value !== "string") {
      throw new DeliveryStorageCorruptionError("Inbox signal payload must be a string.");
    }
    if (Buffer.byteLength(value, "utf8") > maxSignalPayloadChars) {
      throw new DeliveryStorageCorruptionError(
        `Inbox signal payload exceeds ${String(maxSignalPayloadBytes)} bytes and cannot be stored.`,
      );
    }

    return value;
  },

  requireInputTimestamp(value: unknown, label: string): number {
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
  },

  requireInputVersion(value: unknown): string {
    if (typeof value !== "bigint") {
      throw new InboxMessageError("Inbox version must be a bigint.");
    }

    return InboxRecordValues.requireInputText(value.toString(), "Inbox version");
  },

  requireStoredTimestampNumber(value: unknown, label: string): number {
    const time = InboxRecordValues.requireNumber(value, label);
    InboxRecordValues.storedDate(time, label);
    return time;
  },

  storedDate(value: number, label: string): Date {
    const date = new Date(value);

    if (!Number.isFinite(date.getTime())) {
      throw new DeliveryStorageCorruptionError(`${label} is invalid.`);
    }

    return date;
  },

  parseStoredVersion(value: string): bigint {
    try {
      return BigInt(InboxRecordValues.requireStoredText(value, "Inbox version"));
    } catch (error) {
      throw error instanceof DeliveryStorageCorruptionError
        ? error
        : new DeliveryStorageCorruptionError("Inbox version is invalid.", { cause: error });
    }
  },

  assertStoredRecordSize(value: Buffer, label: string): void {
    if (value.byteLength > maxStoredRecordBytes) {
      throw new InboxMessageError(
        `${label} exceeds ${String(maxStoredRecordBytes)} bytes and cannot be stored.`,
      );
    }
  },

  assertPendingClaimBudget(record: StoredPendingDedupRecord): void {
    const size = Buffer.byteLength(JSON.stringify(record), "utf8");
    if (size > maxStoredRecordBytes) {
      throw new InboxMessageError(
        `Inbox pending dedup claim exceeds ${String(maxStoredRecordBytes)} bytes aggregate budget.`,
      );
    }
  },

  readPendingDedup(decoded: Record<string, unknown>, key: string): StoredPendingDedupRecord {
    const message = InboxRecordValues.parseStoredInboxMessage(
      Reflect.get(decoded, "message"),
      "Inbox dedup pending message",
    );
    if (InboxRecordValues.storedDedupGuardKey(message.inbox, message.signalId) !== key) {
      throw new DeliveryStorageCorruptionError(
        "Inbox dedup pending message does not match the guard key.",
      );
    }

    return Object.freeze({
      key,
      state: "PENDING",
      message,
    });
  },

  readFinalDedup(decoded: Record<string, unknown>, key: string): StoredFinalDedupRecord {
    const inbox = InboxRecordValues.requireStoredText(
      decoded.inbox,
      "Inbox dedup inbox",
      maxCompositeTextBytes,
    );
    const signalId = InboxRecordValues.requireStoredText(decoded.signalId, "Inbox dedup signal ID");
    if (`${inbox}:${signalId}` !== key) {
      throw new DeliveryStorageCorruptionError(
        "Inbox dedup final record does not match the guard key.",
      );
    }

    return Object.freeze({
      key,
      inbox,
      signalId,
      inboxMessageId: InboxRecordValues.requireStoredText(
        decoded.inboxMessageId,
        "Inbox dedup message ID",
      ),
      shardIndex: InboxRecordValues.requireNumber(decoded.shardIndex, "Inbox dedup shard index"),
      shardTotal: InboxRecordValues.requireNumber(decoded.shardTotal, "Inbox dedup shard total"),
      state: "FINAL",
      status: InboxRecordValues.requireDeliveryStatus(decoded.status),
      ...(decoded.keepUntilMs === undefined
        ? {}
        : {
            keepUntilMs: InboxRecordValues.requireStoredTimestampNumber(
              decoded.keepUntilMs,
              "Inbox dedup keep-until time",
            ),
          }),
    });
  },

  requireStoredObject(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new DeliveryStorageCorruptionError(`${label} is invalid.`);
    }

    return value as Record<string, unknown>;
  },

  readStoredShard(decoded: Record<string, unknown>): ShardIndex {
    const shard = InboxRecordValues.storedShardIndex(
      InboxRecordValues.requireNumber(decoded.shardIndex, "Inbox shard index"),
      InboxRecordValues.requireNumber(decoded.shardTotal, "Inbox shard total"),
      "Inbox shard",
    );
    if (
      InboxRecordValues.requireStoredText(
        decoded.shard,
        "Inbox shard key",
        maxCompositeTextBytes,
      ) !== shard.key()
    ) {
      throw new DeliveryStorageCorruptionError(
        "Inbox message record shard key does not match shard.",
      );
    }

    return shard;
  },

  readStoredBytes(record: Any, label: string): Uint8Array {
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
  },

  storedShardIndex(index: number, total: number, label: string): ShardIndex {
    try {
      return new ShardIndex(index, total);
    } catch (error) {
      throw new DeliveryStorageCorruptionError(`${label} is invalid.`, { cause: error });
    }
  },

  readStoredMessageKey(
    decoded: Record<string, unknown>,
    shard: ShardIndex,
    id: string,
    expectedKey?: string,
  ): string {
    const key = InboxRecordValues.requireStoredText(
      decoded.key,
      "Inbox message key",
      maxCompositeTextBytes,
    );
    if (key !== InboxRecordValues.storedInboxMessageKey(id, shard)) {
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
  },

  readStoredInboxKey(
    decoded: Record<string, unknown>,
    inboxId: Readonly<{ targetId: string; targetTypeUrl: string }>,
  ): string {
    const inbox = InboxRecordValues.requireStoredText(
      decoded.inbox,
      "Inbox key",
      maxCompositeTextBytes,
    );
    if (inbox !== InboxRecordValues.storedInboxKey(inboxId)) {
      throw new DeliveryStorageCorruptionError(
        "Inbox message record inbox key does not match target identity.",
      );
    }

    return inbox;
  },

  buildStoredInboxMessage(
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
      signalId: InboxRecordValues.requireStoredText(decoded.signalId, "Inbox signal ID"),
      ...(decoded.signal === undefined
        ? {}
        : { signal: InboxRecordValues.readStoredSignal(decoded.signal) }),
      label: InboxRecordValues.requireDeliveryLabel(decoded.label),
      status: InboxRecordValues.requireDeliveryStatus(decoded.status),
      whenReceivedMs: InboxRecordValues.requireStoredTimestampNumber(
        decoded.whenReceivedMs,
        "Inbox receive time",
      ),
      version: InboxRecordValues.requireStoredText(decoded.version, "Inbox version"),
      ...(decoded.keepUntilMs === undefined
        ? {}
        : {
            keepUntilMs: InboxRecordValues.requireStoredTimestampNumber(
              decoded.keepUntilMs,
              "Inbox keep-until time",
            ),
          }),
      ...(decoded.claim === undefined
        ? {}
        : { claim: InboxRecordValues.readStoredClaim(decoded.claim) }),
    });
  },

  readStoredClaim(value: unknown): StoredInboxClaim {
    const decoded = InboxRecordValues.requireStoredObject(value, "Inbox claim");

    return Object.freeze({
      id: InboxRecordValues.requireStoredText(decoded.id, "Inbox claim ID"),
      node: InboxRecordValues.requireStoredText(decoded.node, "Inbox claim node"),
      expiresAtMs: InboxRecordValues.requireStoredTimestampNumber(
        decoded.expiresAtMs,
        "Inbox claim expiry time",
      ),
    });
  },

  decodeSignalPayload(valueBase64: string): Buffer {
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
  },

  storedDedupGuardKey(inbox: string, signalId: string): string {
    return `${inbox}:${signalId}`;
  },

  storedInboxMessageKey(id: string, shard: ShardIndex): string {
    return `${shard.key()}:${id}`;
  },

  storedInboxKey(inboxId: Readonly<{ targetId: string; targetTypeUrl: string }>): string {
    return JSON.stringify({
      targetId: inboxId.targetId,
      targetTypeUrl: inboxId.targetTypeUrl,
    });
  },
});

const inboxRecordTypeUrl = "type.spine-ts.dev/internal/InboxMessageRecord";
const dedupRecordTypeUrl = "type.spine-ts.dev/internal/InboxDedupRecord";
const maxSignalPayloadChars = Math.ceil(maxSignalPayloadBytes / 3) * 4;
const maxStoredRecordBytes = 512 * 1024;
const maxTextBytes = 16 * 1024;
const maxCompositeTextBytes = 64 * 1024;
const canonicalBase64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
