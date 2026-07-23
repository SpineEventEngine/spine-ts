import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";

import type { InboxMessage, InboxMessageId } from "@spine-ts/server";
import { ShardIndex } from "@spine-ts/server";
import { CommandSchema, EventSchema } from "@spine-ts/proto";
import {
  type ExpiredSession,
  type ShardInfo,
  type ShardInfoUpdate,
  type ShardPickedUp,
  ShardStatus,
} from "@spine-ts/proto/delivery-server";
import {
  InboxIdSchema,
  InboxLabel,
  InboxMessageSchema,
  InboxMessageStatus,
  InboxMessageIdSchema,
  InboxSignalIdSchema,
  ShardIndexSchema,
  type InboxMessage as WireInboxMessage,
  type ShardIndex as WireShardIndex,
  type WorkerId,
  WorkerIdSchema,
} from "@spine-ts/proto/delivery";

import {
  DeliveryProtocolError,
  MAX_DELIVERY_BATCH_MESSAGES,
  MAX_DELIVERY_RPC_BYTES,
  MAX_INBOX_PAYLOAD_BYTES,
  type DeliveryClientOptions,
  type DeliveryWorkerId,
  type ReleasedShardSession,
  type RemoteShardObservation,
  type RemoteShardSession,
} from "./types.js";

export function encodeInboxBatch(messages: readonly InboxMessage[]): {
  readonly ids: readonly string[];
  readonly shard: ReturnType<typeof encodeShard>;
  readonly messages: WireInboxMessage[];
} {
  if (messages.length === 0 || messages.length > MAX_DELIVERY_BATCH_MESSAGES)
    throw new TypeError("Delivery message batch is invalid.");
  const ids = messages.map((message) => messageId(message.id));
  if (new Set(ids).size !== ids.length)
    throw new TypeError("Delivery message batch contains duplicate IDs.");
  const first = messages.at(0);
  if (first === undefined) throw new TypeError("Delivery message batch is invalid.");
  const batchShard = encodeShard(first.id.shard);
  for (const message of messages) {
    const messageShard = encodeShard(message.id.shard);
    if (messageShard.index !== batchShard.index || messageShard.ofTotal !== batchShard.ofTotal)
      throw new TypeError("Delivery message batch spans multiple shards.");
  }
  return {
    ids: Object.freeze(ids),
    shard: batchShard,
    messages: messages.map(encodeInboxMessage),
  };
}

export function encodeInboxMessage(message: InboxMessage): WireInboxMessage {
  const id = messageId(message.id);
  const messageShard = encodeShard(message.id.shard);
  if (
    message.shard.index !== message.id.shard.index ||
    message.shard.ofTotal !== message.id.shard.ofTotal
  )
    throw new TypeError("Delivery inbox message shard is invalid.");
  const target = targetId(message.inboxId);
  const received = encodeTimestamp(message.whenReceived);
  const keepUntil =
    message.keepUntil === undefined ? undefined : encodeTimestamp(message.keepUntil);
  if (typeof message.signalId !== "string" || !text(message.signalId))
    throw new TypeError("Delivery inbox signal ID is invalid.");
  if (
    typeof message.version !== "bigint" ||
    message.version < 0n ||
    message.version > BigInt(0x7fffffff)
  )
    throw new TypeError("Delivery inbox message version is invalid.");
  return create(InboxMessageSchema, {
    id: create(InboxMessageIdSchema, { uuid: id, index: messageShard }),
    signalId: create(InboxSignalIdSchema, { value: message.signalId }),
    inboxId: create(InboxIdSchema, {
      entityId: { id: { typeUrl: target.typeUrl, value: target.value } },
      typeUrl: message.inboxId.targetTypeUrl,
    }),
    payload: encodePayload(message.signal),
    label: encodeLabel(message.label),
    status: encodeStatus(message.status),
    whenReceived: received,
    version: Number(message.version),
    ...(keepUntil === undefined ? {} : { keepUntil }),
  });
}

export function decodeInboxMessage(
  message: WireInboxMessage,
  expectedShard: ShardIndex,
): InboxMessage {
  const id = message.id;
  const inboxId = message.inboxId;
  const entityId = inboxId?.entityId?.id;
  if (
    id === undefined ||
    inboxId === undefined ||
    entityId === undefined ||
    message.signalId === undefined ||
    message.whenReceived === undefined ||
    !text(id.uuid) ||
    !text(message.signalId.value) ||
    !text(inboxId.typeUrl) ||
    !text(entityId.typeUrl) ||
    id.index === undefined
  )
    throw protocol();
  const messageShard = decodeShard(id.index);
  if (messageShard.index !== expectedShard.index || messageShard.ofTotal !== expectedShard.ofTotal)
    throw protocol();
  const signal = decodePayload(message);
  const whenReceived = decodeDate(message.whenReceived);
  const keepUntil = message.keepUntil === undefined ? undefined : decodeDate(message.keepUntil);
  if (!Number.isSafeInteger(message.version) || message.version < 0) throw protocol();
  return freeze({
    id: freeze({ value: id.uuid, shard: messageShard }),
    inboxId: freeze({
      targetId: `${entityId.typeUrl}:${Buffer.from(entityId.value).toString("base64")}`,
      targetTypeUrl: inboxId.typeUrl,
    }),
    signalId: message.signalId.value,
    signal,
    label: decodeLabel(message.label),
    status: decodeStatus(message.status),
    shard: messageShard,
    whenReceived,
    version: BigInt(message.version),
    ...(keepUntil === undefined ? {} : { keepUntil }),
  });
}

export function decodeShardObservation(value: ShardInfo): RemoteShardObservation {
  if (value.index === undefined || !Number.isSafeInteger(value.messages) || value.messages < 0)
    throw protocol();
  const lastPicked = value.lastPicked === undefined ? undefined : decodeDate(value.lastPicked);
  return freeze({
    shard: decodeShard(value.index),
    status: decodeShardStatus(value.status),
    ...(lastPicked === undefined ? {} : { lastPicked }),
    messages: value.messages,
  });
}

export function decodeShardUpdate(value: ShardInfoUpdate): RemoteShardObservation {
  if (
    value.index === undefined ||
    !Number.isSafeInteger(value.newMessagesCount) ||
    value.newMessagesCount < 0
  )
    throw protocol();
  const lastPicked =
    value.whenLastPicked === undefined ? undefined : decodeDate(value.whenLastPicked);
  return freeze({
    shard: decodeShard(value.index),
    status: decodeShardStatus(value.newStatus),
    ...(lastPicked === undefined ? {} : { lastPicked }),
    messages: value.newMessagesCount,
  });
}

export function encodeShard(value: ShardIndex): WireShardIndex {
  if (!(value instanceof ShardIndex)) throw new TypeError("Delivery shard is invalid.");
  return create(ShardIndexSchema, { index: value.index, ofTotal: value.ofTotal });
}

export function encodeMessageId(id: InboxMessageId): string {
  return messageId(id);
}

export function snapshotShard(value: ShardIndex): ShardIndex {
  return new ShardIndex(value.index, value.ofTotal);
}

/** Makes a detached delivery-message value safe for later exact-snapshot checks. */
export function snapshotInboxMessage(value: InboxMessage): InboxMessage {
  return freeze({
    id: freeze({ value: value.id.value, shard: snapshotShard(value.id.shard) }),
    inboxId: freeze({
      targetId: value.inboxId.targetId,
      targetTypeUrl: value.inboxId.targetTypeUrl,
    }),
    signalId: value.signalId,
    ...(value.signal === undefined
      ? {}
      : {
          signal: freeze(
            create(AnySchema, {
              typeUrl: value.signal.typeUrl,
              value: new Uint8Array(value.signal.value),
            }),
          ),
        }),
    label: value.label,
    status: value.status,
    shard: snapshotShard(value.shard),
    whenReceived: new Date(value.whenReceived.getTime()),
    version: value.version,
    ...(value.keepUntil === undefined ? {} : { keepUntil: new Date(value.keepUntil.getTime()) }),
  });
}

export function encodeWorker(value: DeliveryWorkerId): WorkerId {
  if (
    typeof value.nodeId !== "string" ||
    !text(value.nodeId) ||
    typeof value.value !== "string" ||
    !text(value.value)
  )
    throw new TypeError("Delivery worker ID is invalid.");
  return create(WorkerIdSchema, { nodeId: { value: value.nodeId }, value: value.value });
}

export function decodePickedUpSession(
  value: ShardPickedUp,
  expectedShard: ShardIndex,
  expectedWorker: DeliveryWorkerId,
): RemoteShardSession {
  if (value.shard === undefined || value.worker === undefined || value.whenPicked === undefined)
    throw protocol();
  const resultShard = decodeShard(value.shard);
  const resultWorker = decodeWorker(value.worker);
  if (
    resultShard.index !== expectedShard.index ||
    resultShard.ofTotal !== expectedShard.ofTotal ||
    resultWorker.nodeId !== expectedWorker.nodeId ||
    resultWorker.value !== expectedWorker.value
  )
    throw protocol();
  return freeze({
    kind: "EXCLUSIVE",
    shard: resultShard,
    worker: resultWorker,
    whenPicked: decodeDate(value.whenPicked),
  });
}

export function validateAlreadyPickedUp(
  value: {
    shard?: { index: number; ofTotal: number } | undefined;
    worker?: { nodeId?: { value: string } | undefined; value: string } | undefined;
    whenPicked?: { seconds: bigint; nanos: number } | undefined;
  },
  expectedShard: ShardIndex,
): void {
  if (value.worker === undefined || value.whenPicked === undefined) throw protocol();
  if (value.shard !== undefined) {
    const resultShard = decodeShard(value.shard);
    if (resultShard.index !== expectedShard.index || resultShard.ofTotal !== expectedShard.ofTotal)
      throw protocol();
  }
  decodeWorker(value.worker);
  decodeDate(value.whenPicked);
}

export function decodeReleasedSession(value: ExpiredSession): ReleasedShardSession {
  if (
    value.shard === undefined ||
    value.worker === undefined ||
    value.whenPicked === undefined ||
    value.whenReleased === undefined
  )
    throw protocol();
  return freeze({
    kind: "EXCLUSIVE",
    shard: decodeShard(value.shard),
    worker: decodeWorker(value.worker),
    whenPicked: decodeDate(value.whenPicked),
    whenReleased: decodeDate(value.whenReleased),
  });
}

export function encodeDuration(value: number): { seconds: bigint; nanos: number } {
  const maximumMilliseconds = 315_576_000_000_000;
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximumMilliseconds)
    throw new TypeError("Delivery inactivity duration is invalid.");
  return { seconds: BigInt(Math.floor(value / 1000)), nanos: (value % 1000) * 1_000_000 };
}

export function encodeTimestamp(value: Date): { seconds: bigint; nanos: number } {
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    throw new TypeError("Delivery inbox timestamp is invalid.");
  const millis = value.getTime();
  return {
    seconds: BigInt(Math.floor(millis / 1000)),
    nanos: (((millis % 1000) + 1000) % 1000) * 1_000_000,
  };
}

export function protocol(): DeliveryProtocolError {
  return new DeliveryProtocolError();
}

export function callOptions(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { readonly timeoutMs: number; readonly signal?: AbortSignal } {
  return signal === undefined ? { timeoutMs } : { timeoutMs, signal };
}

export function pageSize(value: number): number {
  return bounded(value, 1, 1_000, "Delivery page size");
}

export function normalizeOptions(options: DeliveryClientOptions): DeliveryClientOptions {
  return Object.freeze({
    pageSize: pageSize(options.pageSize ?? 100),
    readRetries: retries(options.readRetries ?? 0),
    retryBackoffMs: backoff(options.retryBackoffMs ?? 0),
    observationReconnects: retries(options.observationReconnects ?? 0),
    observationReconnectBackoffMs: backoff(options.observationReconnectBackoffMs ?? 0),
    observationBufferSize: bounded(
      options.observationBufferSize ?? 100,
      1,
      1_000,
      "Delivery observation buffer size",
    ),
  });
}

export function validBaseUrl(value: string): void {
  if (typeof value !== "string") throw new TypeError("Delivery client base URL is invalid.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Delivery client base URL is invalid.");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.pathname !== "/")
    throw new TypeError("Delivery client base URL is invalid.");
}

export function requestBytes(
  schema: Parameters<typeof toBinary>[0],
  value: Parameters<typeof toBinary>[1],
): void {
  if (toBinary(schema, value).byteLength > MAX_DELIVERY_RPC_BYTES)
    throw new TypeError("Delivery RPC request exceeds the 4 MiB limit.");
}

export function responseBytes(
  schema: Parameters<typeof toBinary>[0],
  value: Parameters<typeof toBinary>[1],
): void {
  try {
    if (toBinary(schema, value).byteLength > MAX_DELIVERY_RPC_BYTES) throw protocol();
  } catch (error) {
    if (error instanceof DeliveryProtocolError) throw error;
    // Connect may materialize a partial optional-message object. Its decoder
    // remains the authoritative validation boundary when re-encoding is absent.
    return;
  }
}

export function retries(value: number): number {
  return bounded(value, 0, 5, "Delivery read retries");
}

export function backoff(value: number): number {
  return finite(value, 0, 10_000, "Delivery retry backoff");
}

export function timeout(value: number): number {
  return bounded(value, 1, 120_000, "Delivery request timeout");
}

export function bounded(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new TypeError(`${name} is invalid.`);
  return value;
}

function targetId(inbox: InboxMessage["inboxId"]): { typeUrl: string; value: Uint8Array } {
  if (
    typeof inbox.targetId !== "string" ||
    typeof inbox.targetTypeUrl !== "string" ||
    !text(inbox.targetTypeUrl)
  )
    throw new TypeError("Delivery inbox ID is invalid.");
  const separator = inbox.targetId.indexOf(":");
  if (separator <= 0) throw new TypeError("Delivery inbox ID is invalid.");
  const typeUrl = inbox.targetId.slice(0, separator);
  try {
    return { typeUrl, value: Buffer.from(inbox.targetId.slice(separator + 1), "base64") };
  } catch {
    throw new TypeError("Delivery inbox ID is invalid.");
  }
}

function encodePayload(signal: InboxMessage["signal"]): WireInboxMessage["payload"] {
  if (signal === undefined) return { case: undefined };
  if (signal.typeUrl === "type.spine.io/spine.core.Command")
    return { case: "command", value: fromBinary(CommandSchema, signal.value) };
  if (signal.typeUrl === "type.spine.io/spine.core.Event")
    return { case: "event", value: fromBinary(EventSchema, signal.value) };
  throw new TypeError("Delivery inbox message payload is invalid.");
}

function encodeLabel(value: InboxMessage["label"]): InboxLabel {
  const labels: Record<InboxMessage["label"], InboxLabel> = {
    HANDLE_COMMAND: InboxLabel.HANDLE_COMMAND,
    UPDATE_SUBSCRIBER: InboxLabel.UPDATE_SUBSCRIBER,
    REACT_UPON_EVENT: InboxLabel.REACT_UPON_EVENT,
    CATCH_UP: InboxLabel.CATCH_UP,
  };
  if (!(value in labels)) throw new TypeError("Delivery inbox message label is invalid.");
  return labels[value];
}

function encodeStatus(value: InboxMessage["status"]): InboxMessageStatus {
  const statuses: Record<InboxMessage["status"], InboxMessageStatus> = {
    TO_DELIVER: InboxMessageStatus.TO_DELIVER,
    SCHEDULED: InboxMessageStatus.SCHEDULED,
    DELIVERED: InboxMessageStatus.DELIVERED,
    TO_CATCH_UP: InboxMessageStatus.TO_CATCH_UP,
  };
  if (!(value in statuses)) throw new TypeError("Delivery inbox message status is invalid.");
  return statuses[value];
}

function decodePayload(message: WireInboxMessage) {
  const wire = message.payload;
  if (wire.case !== "command" && wire.case !== "event") throw protocol();
  const schema = wire.case === "command" ? CommandSchema : EventSchema;
  const encoded = toBinary(schema, wire.value, { writeUnknownFields: false });
  if (encoded.byteLength > MAX_INBOX_PAYLOAD_BYTES) throw protocol();
  return freeze(
    create(AnySchema, {
      typeUrl: `type.spine.io/${schema.typeName}`,
      value: new Uint8Array(encoded),
    }),
  );
}

function decodeLabel(value: InboxLabel): InboxMessage["label"] {
  switch (value) {
    case InboxLabel.HANDLE_COMMAND:
      return "HANDLE_COMMAND";
    case InboxLabel.UPDATE_SUBSCRIBER:
      return "UPDATE_SUBSCRIBER";
    case InboxLabel.REACT_UPON_EVENT:
      return "REACT_UPON_EVENT";
    case InboxLabel.CATCH_UP:
      return "CATCH_UP";
    default:
      throw protocol();
  }
}

function decodeStatus(value: InboxMessageStatus): InboxMessage["status"] {
  switch (value) {
    case InboxMessageStatus.TO_DELIVER:
      return "TO_DELIVER";
    case InboxMessageStatus.SCHEDULED:
      return "SCHEDULED";
    case InboxMessageStatus.DELIVERED:
      return "DELIVERED";
    case InboxMessageStatus.TO_CATCH_UP:
      return "TO_CATCH_UP";
    default:
      throw protocol();
  }
}

function decodeDate(value: { seconds: bigint; nanos: number }): Date {
  if (!Number.isInteger(value.nanos) || value.nanos < 0 || value.nanos >= 1_000_000_000)
    throw protocol();
  const millis = Number(value.seconds) * 1000 + Math.floor(value.nanos / 1_000_000);
  if (!Number.isSafeInteger(millis)) throw protocol();
  const result = new Date(millis);
  if (Number.isNaN(result.getTime())) throw protocol();
  return result;
}

function decodeShardStatus(value: ShardStatus): RemoteShardObservation["status"] {
  switch (value) {
    case ShardStatus.PICKED:
      return "PICKED";
    case ShardStatus.NOT_PICKED:
      return "NOT_PICKED";
    default:
      throw protocol();
  }
}

function decodeShard(value: { index: number; ofTotal: number }): ShardIndex {
  try {
    return new ShardIndex(value.index, value.ofTotal);
  } catch {
    throw protocol();
  }
}

function decodeWorker(value: {
  nodeId?: { value: string } | undefined;
  value: string;
}): DeliveryWorkerId {
  if (value.nodeId === undefined || !text(value.nodeId.value) || !text(value.value))
    throw protocol();
  return freeze({ nodeId: value.nodeId.value, value: value.value });
}

function messageId(id: InboxMessageId): string {
  if (typeof id.value !== "string" || !text(id.value))
    throw new TypeError("Delivery inbox message ID is invalid.");
  return id.value;
}

function finite(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum)
    throw new TypeError(`${name} is invalid.`);
  return value;
}

function text(value: string): boolean {
  return value.trim().length > 0;
}

function freeze<T extends object>(value: T): T {
  return Object.freeze(value);
}
