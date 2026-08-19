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

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  AnySchema,
  Int32ValueSchema,
  Int64ValueSchema,
  StringValueSchema,
  type Any,
} from "@bufbuild/protobuf/wkt";

import type { InboxMessage, InboxMessageId } from "@spine-event-engine/server";
import { ShardIndex } from "@spine-event-engine/server";
import { CommandSchema, EventSchema } from "@spine-event-engine/proto";
import {
  type ExpiredSession,
  type ShardInfo,
  type ShardInfoUpdate,
  type ShardPickedUp,
  ShardStatus,
} from "@spine-event-engine/proto/delivery-server";
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
} from "@spine-event-engine/proto/delivery";

import {
  DeliveryProtocolError,
  MAX_DELIVERY_BATCH_MESSAGES,
  MAX_DELIVERY_RPC_BYTES,
  MAX_DELIVERY_WORKER_BYTES,
  MAX_INBOX_PAYLOAD_BYTES,
  type DeliveryClientOptions,
  type DeliveryWorkerId,
  type ReleasedShardSession,
  type RemoteShardObservation,
  type RemoteShardSession,
} from "../client/types.js";

/**
 * Holds primitive validation and immutable-value operations for the delivery wire protocol.
 */
const DeliveryValues = Object.freeze({
  // prettier-ignore

  /**
   * Determines whether a text value contains non-whitespace characters.
   *
   * @param value Supplies the text value.
   * @returns Whether the value contains text.
   */
  hasText(value: string): boolean {
    return value.trim().length > 0;
  },

  /**
   * Counts bytes in a UTF-8 text value.
   *
   * @param value Supplies the text value.
   * @returns The UTF-8 byte count.
   */
  utf8Bytes(value: string): number {
    return new TextEncoder().encode(value).byteLength;
  },

  /**
   * Freezes an object before returning it.
   * @typeParam Value Describes the object type.
   * @param value Supplies the object to freeze.
   * @returns The frozen object.
   */
  freeze<Value extends object>(value: Value): Value {
    return Object.freeze(value);
  },

  /**
   * Validates an integer in an inclusive range.
   *
   * @param value Supplies the number to validate.
   * @param minimum Defines the inclusive lower bound.
   * @param maximum Defines the inclusive upper bound.
   * @param name Names the value in validation errors.
   * @returns The validated value.
   */
  bounded(value: number, minimum: number, maximum: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
      throw new TypeError(`${name} is invalid.`);
    return value;
  },

  /**
   * Validates a finite number in an inclusive range.
   *
   * @param value Supplies the number to validate.
   * @param minimum Defines the inclusive lower bound.
   * @param maximum Defines the inclusive upper bound.
   * @param name Names the value in validation errors.
   * @returns The validated value.
   */
  finite(value: number, minimum: number, maximum: number, name: string): number {
    if (!Number.isFinite(value) || value < minimum || value > maximum)
      throw new TypeError(`${name} is invalid.`);
    return value;
  },
});

const DeliveryTargetIds = Object.freeze({
  validate(typeUrl: string, value: Uint8Array): void {
    switch (typeUrl) {
      case "type.googleapis.com/google.protobuf.StringValue":
        if (!DeliveryValues.hasText(fromBinary(StringValueSchema, value).value))
          throw new TypeError("String target ID is blank.");
        break;
      case "type.googleapis.com/google.protobuf.Int32Value":
        fromBinary(Int32ValueSchema, value);
        break;
      case "type.googleapis.com/google.protobuf.Int64Value":
        fromBinary(Int64ValueSchema, value);
        break;
    }
  },
});

type DeliveryMessageCodecApi = Readonly<{
  encodeBatch(messages: readonly InboxMessage[]): {
    readonly ids: readonly string[];
    readonly shard: WireShardIndex;
    readonly messages: WireInboxMessage[];
  };
  encode(message: InboxMessage): WireInboxMessage;
  decode(message: WireInboxMessage, expectedShard: ShardIndex): InboxMessage;
  encodeId(id: InboxMessageId): string;
  snapshot(value: InboxMessage): InboxMessage;
  target(inbox: InboxMessage["inboxId"]): { typeUrl: string; value: Uint8Array };
  decodeTarget(typeUrl: string, value: Uint8Array): Any;
  payload(signal: InboxMessage["signal"]): WireInboxMessage["payload"];
  label(value: InboxMessage["label"]): InboxLabel;
  status(value: InboxMessage["status"]): InboxMessageStatus;
  decodePayload(message: WireInboxMessage): NonNullable<InboxMessage["signal"]>;
  decodeLabel(value: InboxLabel): InboxMessage["label"];
  decodeStatus(value: InboxMessageStatus): InboxMessage["status"];
}>;

/**
 * Encodes and decodes inbox messages without exposing mutable wire values.
 */
const DeliveryMessageCodec: DeliveryMessageCodecApi = Object.freeze({
  // prettier-ignore

  /**
   * Encodes one bounded, single-shard inbox batch.
   *
   * @param messages Supplies the messages to encode.
   * @returns The encoded messages, their IDs, and their common shard.
   */
  encodeBatch(messages: readonly InboxMessage[]): {
    readonly ids: readonly string[];
    readonly shard: WireShardIndex;
    readonly messages: WireInboxMessage[];
  } {
    if (messages.length === 0 || messages.length > MAX_DELIVERY_BATCH_MESSAGES)
      throw new TypeError("Delivery message batch is invalid.");
    const ids = messages.map((message) => DeliveryMessageCodec.encodeId(message.id));
    if (new Set(ids).size !== ids.length)
      throw new TypeError("Delivery message batch contains duplicate IDs.");
    const first = messages.at(0);
    if (first === undefined) throw new TypeError("Delivery message batch is invalid.");
    const shard = DeliveryShardCodec.encode(first.id.shard);
    for (const message of messages) {
      const messageShard = DeliveryShardCodec.encode(message.id.shard);
      if (messageShard.index !== shard.index || messageShard.ofTotal !== shard.ofTotal)
        throw new TypeError("Delivery message batch spans multiple shards.");
    }
    return {
      ids: Object.freeze(ids),
      shard,
      messages: messages.map((message) => DeliveryMessageCodec.encode(message)),
    };
  },

  /**
   * Encodes an inbox message for the delivery server.
   *
   * @param message Supplies the message to encode.
   * @returns The validated wire message.
   */
  encode(message: InboxMessage): WireInboxMessage {
    const id = DeliveryMessageCodec.encodeId(message.id);
    const shard = DeliveryShardCodec.encode(message.id.shard);
    if (
      message.shard.index !== message.id.shard.index ||
      message.shard.ofTotal !== message.id.shard.ofTotal
    )
      throw new TypeError("Delivery inbox message shard is invalid.");
    const target = DeliveryMessageCodec.target(message.inboxId);
    const whenReceived = DeliveryRequestCodec.timestamp(message.whenReceived);
    const keepUntil =
      message.keepUntil === undefined
        ? undefined
        : DeliveryRequestCodec.timestamp(message.keepUntil);
    if (typeof message.signalId !== "string" || !DeliveryValues.hasText(message.signalId))
      throw new TypeError("Delivery inbox signal ID is invalid.");
    if (
      typeof message.version !== "bigint" ||
      message.version < 0n ||
      message.version > BigInt(0x7fffffff)
    )
      throw new TypeError("Delivery inbox message version is invalid.");
    return create(InboxMessageSchema, {
      id: create(InboxMessageIdSchema, { uuid: id, index: shard }),
      signalId: create(InboxSignalIdSchema, { value: message.signalId }),
      inboxId: create(InboxIdSchema, {
        entityId: { id: { typeUrl: target.typeUrl, value: target.value } },
        typeUrl: message.inboxId.targetTypeUrl,
      }),
      payload: DeliveryMessageCodec.payload(message.signal),
      label: DeliveryMessageCodec.label(message.label),
      status: DeliveryMessageCodec.status(message.status),
      whenReceived,
      version: Number(message.version),
      ...(keepUntil === undefined ? {} : { keepUntil }),
    });
  },

  /**
   * Decodes an inbox message and confirms its expected shard.
   *
   * @param message Supplies the wire message.
   * @param expectedShard Identifies the requested shard.
   * @returns The detached immutable inbox message.
   */
  decode(message: WireInboxMessage, expectedShard: ShardIndex): InboxMessage {
    const id = message.id;
    const inboxId = message.inboxId;
    const entityId = inboxId?.entityId?.id;
    if (
      id === undefined ||
      inboxId === undefined ||
      entityId === undefined ||
      message.signalId === undefined ||
      message.whenReceived === undefined ||
      !DeliveryValues.hasText(id.uuid) ||
      !DeliveryValues.hasText(message.signalId.value) ||
      !DeliveryValues.hasText(inboxId.typeUrl) ||
      !DeliveryValues.hasText(entityId.typeUrl) ||
      id.index === undefined
    )
      throw DeliveryRequestCodec.protocol();
    const shard = DeliveryShardCodec.decode(id.index);
    if (shard.index !== expectedShard.index || shard.ofTotal !== expectedShard.ofTotal)
      throw DeliveryRequestCodec.protocol();
    const keepUntil =
      message.keepUntil === undefined ? undefined : DeliveryShardCodec.date(message.keepUntil);
    if (!Number.isSafeInteger(message.version) || message.version < 0)
      throw DeliveryRequestCodec.protocol();
    const targetId = DeliveryMessageCodec.decodeTarget(entityId.typeUrl, entityId.value);
    return DeliveryValues.freeze({
      id: DeliveryValues.freeze({ value: id.uuid, shard }),
      inboxId: DeliveryValues.freeze({
        targetId,
        targetTypeUrl: inboxId.typeUrl,
      }),
      signalId: message.signalId.value,
      signal: DeliveryMessageCodec.decodePayload(message),
      label: DeliveryMessageCodec.decodeLabel(message.label),
      status: DeliveryMessageCodec.decodeStatus(message.status),
      shard,
      whenReceived: DeliveryShardCodec.date(message.whenReceived),
      version: BigInt(message.version),
      ...(keepUntil === undefined ? {} : { keepUntil }),
    });
  },

  /**
   * Validates and returns an inbox message identifier.
   *
   * @param id Supplies the identifier to encode.
   * @returns The identifier value.
   */
  encodeId(id: InboxMessageId): string {
    if (typeof id.value !== "string" || !DeliveryValues.hasText(id.value))
      throw new TypeError("Delivery inbox message ID is invalid.");
    return id.value;
  },

  /**
   * Copies an inbox message for later exact-snapshot checks.
   *
   * @param value Supplies the message to copy.
   * @returns A detached immutable message.
   */
  snapshot(value: InboxMessage): InboxMessage {
    return DeliveryValues.freeze({
      id: DeliveryValues.freeze({
        value: value.id.value,
        shard: DeliveryShardCodec.snapshot(value.id.shard),
      }),
      inboxId: DeliveryValues.freeze({
        targetId: DeliveryValues.freeze(
          create(AnySchema, {
            typeUrl: value.inboxId.targetId.typeUrl,
            value: new Uint8Array(value.inboxId.targetId.value),
          }),
        ),
        targetTypeUrl: value.inboxId.targetTypeUrl,
      }),
      signalId: value.signalId,
      ...(value.signal === undefined
        ? {}
        : {
            signal: DeliveryValues.freeze(
              create(AnySchema, {
                typeUrl: value.signal.typeUrl,
                value: new Uint8Array(value.signal.value),
              }),
            ),
          }),
      label: value.label,
      status: value.status,
      shard: DeliveryShardCodec.snapshot(value.shard),
      whenReceived: new Date(value.whenReceived.getTime()),
      version: value.version,
      ...(value.keepUntil === undefined ? {} : { keepUntil: new Date(value.keepUntil.getTime()) }),
    });
  },

  /**
   * Parses an inbox target identifier.
   *
   * @param inbox Supplies the inbox identifier.
   * @returns The type URL and serialized target ID.
   */
  target(inbox: InboxMessage["inboxId"]): { typeUrl: string; value: Uint8Array } {
    if (
      typeof inbox.targetId.typeUrl !== "string" ||
      !DeliveryValues.hasText(inbox.targetId.typeUrl) ||
      !(inbox.targetId.value instanceof Uint8Array) ||
      typeof inbox.targetTypeUrl !== "string" ||
      !DeliveryValues.hasText(inbox.targetTypeUrl)
    )
      throw new TypeError("Delivery inbox ID is invalid.");
    try {
      DeliveryTargetIds.validate(inbox.targetId.typeUrl, inbox.targetId.value);
      return {
        typeUrl: inbox.targetId.typeUrl,
        value: new Uint8Array(inbox.targetId.value),
      };
    } catch (error) {
      throw new TypeError("Delivery inbox ID is invalid.", { cause: error });
    }
  },

  /**
   * Decodes an inbox target identifier while preserving plain framework IDs.
   *
   * @param typeUrl Identifies the wire entity-ID message.
   * @param value Contains the serialized entity-ID message.
   * @returns The framework target identifier.
   */
  decodeTarget(typeUrl: string, value: Uint8Array): Any {
    if (!DeliveryValues.hasText(typeUrl)) throw DeliveryRequestCodec.protocol();
    try {
      DeliveryTargetIds.validate(typeUrl, value);
    } catch {
      throw DeliveryRequestCodec.protocol();
    }
    return create(AnySchema, { typeUrl, value: new Uint8Array(value) });
  },

  /**
   * Encodes a delivered signal payload.
   *
   * @param signal Supplies the optional serialized signal.
   * @returns The wire payload union.
   */
  payload(signal: InboxMessage["signal"]): WireInboxMessage["payload"] {
    if (signal === undefined) return { case: undefined };
    if (signal.typeUrl === "type.spine.io/spine.core.Command")
      return { case: "command", value: fromBinary(CommandSchema, signal.value) };
    if (signal.typeUrl === "type.spine.io/spine.core.Event")
      return { case: "event", value: fromBinary(EventSchema, signal.value) };
    throw new TypeError("Delivery inbox message payload is invalid.");
  },

  /**
   * Encodes an inbox label.
   *
   * @param value Supplies the label.
   * @returns The wire enum value.
   */
  label(value: InboxMessage["label"]): InboxLabel {
    const labels: Record<InboxMessage["label"], InboxLabel> = {
      HANDLE_COMMAND: InboxLabel.HANDLE_COMMAND,
      UPDATE_SUBSCRIBER: InboxLabel.UPDATE_SUBSCRIBER,
      REACT_UPON_EVENT: InboxLabel.REACT_UPON_EVENT,
      CATCH_UP: InboxLabel.CATCH_UP,
    };
    if (!(value in labels)) throw new TypeError("Delivery inbox message label is invalid.");
    return labels[value];
  },

  /**
   * Encodes an inbox status.
   *
   * @param value Supplies the status.
   * @returns The wire enum value.
   */
  status(value: InboxMessage["status"]): InboxMessageStatus {
    const statuses: Record<InboxMessage["status"], InboxMessageStatus> = {
      TO_DELIVER: InboxMessageStatus.TO_DELIVER,
      SCHEDULED: InboxMessageStatus.SCHEDULED,
      DELIVERED: InboxMessageStatus.DELIVERED,
      TO_CATCH_UP: InboxMessageStatus.TO_CATCH_UP,
    };
    if (!(value in statuses)) throw new TypeError("Delivery inbox message status is invalid.");
    return statuses[value];
  },

  /**
   * Decodes a delivered signal payload.
   *
   * @param message Supplies the wire message.
   * @returns The immutable serialized signal.
   */
  decodePayload(message: WireInboxMessage): NonNullable<InboxMessage["signal"]> {
    const wire = message.payload;
    if (wire.case !== "command" && wire.case !== "event") throw DeliveryRequestCodec.protocol();
    const schema = wire.case === "command" ? CommandSchema : EventSchema;
    const encoded = toBinary(schema, wire.value, { writeUnknownFields: false });
    if (encoded.byteLength > MAX_INBOX_PAYLOAD_BYTES) throw DeliveryRequestCodec.protocol();
    return DeliveryValues.freeze(
      create(AnySchema, {
        typeUrl: `type.spine.io/${schema.typeName}`,
        value: new Uint8Array(encoded),
      }),
    );
  },

  /**
   * Decodes an inbox label.
   *
   * @param value Supplies the wire enum value.
   * @returns The domain label.
   */
  decodeLabel(value: InboxLabel): InboxMessage["label"] {
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
        throw DeliveryRequestCodec.protocol();
    }
  },

  /**
   * Decodes an inbox status.
   *
   * @param value Supplies the wire enum value.
   * @returns The domain status.
   */
  decodeStatus(value: InboxMessageStatus): InboxMessage["status"] {
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
        throw DeliveryRequestCodec.protocol();
    }
  },
});

type DeliveryShardCodecApi = Readonly<{
  decodeObservation(value: ShardInfo): RemoteShardObservation;
  decodeUpdate(value: ShardInfoUpdate): RemoteShardObservation;
  encode(value: ShardIndex): WireShardIndex;
  snapshot(value: ShardIndex): ShardIndex;
  encodeWorker(value: DeliveryWorkerId): WorkerId;
  decodePicked(
    value: ShardPickedUp,
    expectedShard: ShardIndex,
    expectedWorker: DeliveryWorkerId,
  ): RemoteShardSession;
  validatePicked(
    value: {
      shard?: { index: number; ofTotal: number } | undefined;
      worker?: { nodeId?: { value: string } | undefined; value: string } | undefined;
      whenPicked?: { seconds: bigint; nanos: number } | undefined;
    },
    expectedShard: ShardIndex,
  ): void;
  decodeReleased(value: ExpiredSession): ReleasedShardSession;
  date(value: { seconds: bigint; nanos: number }): Date;
  status(value: ShardStatus): RemoteShardObservation["status"];
  decode(value: { index: number; ofTotal: number }): ShardIndex;
  decodeWorker(value: { nodeId?: { value: string } | undefined; value: string }): DeliveryWorkerId;
}>;

/**
 * Encodes and decodes delivery shards, workers, and exclusive sessions.
 */
const DeliveryShardCodec: DeliveryShardCodecApi = Object.freeze({
  // prettier-ignore

  /**
   * Decodes an administrative shard observation.
   *
   * @param value Supplies the wire observation.
   * @returns The immutable remote observation.
   */
  decodeObservation(value: ShardInfo): RemoteShardObservation {
    if (value.index === undefined || !Number.isSafeInteger(value.messages) || value.messages < 0)
      throw DeliveryRequestCodec.protocol();
    const lastPicked =
      value.lastPicked === undefined ? undefined : DeliveryShardCodec.date(value.lastPicked);
    return DeliveryValues.freeze({
      shard: DeliveryShardCodec.decode(value.index),
      status: DeliveryShardCodec.status(value.status),
      ...(lastPicked === undefined ? {} : { lastPicked }),
      messages: value.messages,
    });
  },

  /**
   * Decodes an administrative shard update.
   *
   * @param value Supplies the wire update.
   * @returns The immutable remote observation.
   */
  decodeUpdate(value: ShardInfoUpdate): RemoteShardObservation {
    if (
      value.index === undefined ||
      !Number.isSafeInteger(value.newMessagesCount) ||
      value.newMessagesCount < 0
    )
      throw DeliveryRequestCodec.protocol();
    const lastPicked =
      value.whenLastPicked === undefined
        ? undefined
        : DeliveryShardCodec.date(value.whenLastPicked);
    return DeliveryValues.freeze({
      shard: DeliveryShardCodec.decode(value.index),
      status: DeliveryShardCodec.status(value.newStatus),
      ...(lastPicked === undefined ? {} : { lastPicked }),
      messages: value.newMessagesCount,
    });
  },

  /**
   * Encodes a shard index.
   *
   * @param value Supplies the shard index.
   * @returns The wire shard index.
   */
  encode(value: ShardIndex): WireShardIndex {
    if (!(value instanceof ShardIndex)) throw new TypeError("Delivery shard is invalid.");
    return create(ShardIndexSchema, { index: value.index, ofTotal: value.ofTotal });
  },

  /**
   * Copies a shard index.
   *
   * @param value Supplies the shard index.
   * @returns The detached shard index.
   */
  snapshot(value: ShardIndex): ShardIndex {
    return new ShardIndex(value.index, value.ofTotal);
  },

  /**
   * Encodes a delivery worker identifier.
   *
   * @param value Supplies the worker identifier.
   * @returns The wire worker identifier.
   */
  encodeWorker(value: DeliveryWorkerId): WorkerId {
    if (
      typeof value.nodeId !== "string" ||
      !DeliveryValues.hasText(value.nodeId) ||
      typeof value.value !== "string" ||
      !DeliveryValues.hasText(value.value) ||
      DeliveryValues.utf8Bytes(value.nodeId) + DeliveryValues.utf8Bytes(value.value) >
        MAX_DELIVERY_WORKER_BYTES
    )
      throw new TypeError("Delivery worker ID is invalid.");
    return create(WorkerIdSchema, { nodeId: { value: value.nodeId }, value: value.value });
  },

  /**
   * Decodes a successful exclusive pickup.
   *
   * @param value Supplies the pickup response.
   * @param expectedShard Identifies the requested shard.
   * @param expectedWorker Identifies the requesting worker.
   * @returns The immutable exclusive session.
   */
  decodePicked(
    value: ShardPickedUp,
    expectedShard: ShardIndex,
    expectedWorker: DeliveryWorkerId,
  ): RemoteShardSession {
    if (value.shard === undefined || value.worker === undefined || value.whenPicked === undefined)
      throw DeliveryRequestCodec.protocol();
    const shard = DeliveryShardCodec.decode(value.shard);
    const worker = DeliveryShardCodec.decodeWorker(value.worker);
    if (
      shard.index !== expectedShard.index ||
      shard.ofTotal !== expectedShard.ofTotal ||
      worker.nodeId !== expectedWorker.nodeId ||
      worker.value !== expectedWorker.value
    )
      throw DeliveryRequestCodec.protocol();
    return DeliveryValues.freeze({
      kind: "EXCLUSIVE",
      shard,
      worker,
      whenPicked: DeliveryShardCodec.date(value.whenPicked),
    });
  },

  /**
   * Validates an already-picked response.
   *
   * @param value Supplies the response fields.
   * @param expectedShard Identifies the requested shard.
   */
  validatePicked(
    value: {
      shard?: { index: number; ofTotal: number } | undefined;
      worker?: { nodeId?: { value: string } | undefined; value: string } | undefined;
      whenPicked?: { seconds: bigint; nanos: number } | undefined;
    },
    expectedShard: ShardIndex,
  ): void {
    if (value.worker === undefined || value.whenPicked === undefined)
      throw DeliveryRequestCodec.protocol();
    if (value.shard !== undefined) {
      const shard = DeliveryShardCodec.decode(value.shard);
      if (shard.index !== expectedShard.index || shard.ofTotal !== expectedShard.ofTotal)
        throw DeliveryRequestCodec.protocol();
    }
    DeliveryShardCodec.decodeWorker(value.worker);
    DeliveryShardCodec.date(value.whenPicked);
  },

  /**
   * Decodes an expired exclusive session.
   *
   * @param value Supplies the expired-session response.
   * @returns The immutable released session.
   */
  decodeReleased(value: ExpiredSession): ReleasedShardSession {
    if (
      value.shard === undefined ||
      value.worker === undefined ||
      value.whenPicked === undefined ||
      value.whenReleased === undefined
    )
      throw DeliveryRequestCodec.protocol();
    return DeliveryValues.freeze({
      kind: "EXCLUSIVE",
      shard: DeliveryShardCodec.decode(value.shard),
      worker: DeliveryShardCodec.decodeWorker(value.worker),
      whenPicked: DeliveryShardCodec.date(value.whenPicked),
      whenReleased: DeliveryShardCodec.date(value.whenReleased),
    });
  },

  /**
   * Decodes a protocol timestamp.
   *
   * @param value Supplies the timestamp fields.
   * @returns The decoded date.
   */
  date(value: { seconds: bigint; nanos: number }): Date {
    if (!Number.isInteger(value.nanos) || value.nanos < 0 || value.nanos >= 1_000_000_000)
      throw DeliveryRequestCodec.protocol();
    const millis = Number(value.seconds) * 1000 + Math.floor(value.nanos / 1_000_000);
    if (!Number.isSafeInteger(millis)) throw DeliveryRequestCodec.protocol();
    const result = new Date(millis);
    if (Number.isNaN(result.getTime())) throw DeliveryRequestCodec.protocol();
    return result;
  },

  /**
   * Decodes a shard status.
   *
   * @param value Supplies the wire status.
   * @returns The remote observation status.
   */
  status(value: ShardStatus): RemoteShardObservation["status"] {
    switch (value) {
      case ShardStatus.PICKED:
        return "PICKED";
      case ShardStatus.NOT_PICKED:
        return "NOT_PICKED";
      default:
        throw DeliveryRequestCodec.protocol();
    }
  },

  /**
   * Decodes a shard index.
   *
   * @param value Supplies the wire shard index.
   * @returns The validated shard index.
   */
  decode(value: { index: number; ofTotal: number }): ShardIndex {
    try {
      return new ShardIndex(value.index, value.ofTotal);
    } catch {
      throw DeliveryRequestCodec.protocol();
    }
  },

  /**
   * Decodes a worker identifier.
   *
   * @param value Supplies the wire worker identifier.
   * @returns The immutable worker identifier.
   */
  decodeWorker(value: { nodeId?: { value: string } | undefined; value: string }): DeliveryWorkerId {
    if (
      value.nodeId === undefined ||
      !DeliveryValues.hasText(value.nodeId.value) ||
      !DeliveryValues.hasText(value.value)
    )
      throw DeliveryRequestCodec.protocol();
    return DeliveryValues.freeze({ nodeId: value.nodeId.value, value: value.value });
  },
});

type DeliveryRequestCodecApi = Readonly<{
  duration(value: number): { seconds: bigint; nanos: number };
  timestamp(value: Date): { seconds: bigint; nanos: number };
  protocol(): DeliveryProtocolError;
  callOptions(
    signal: AbortSignal | undefined,
    timeoutMs?: number,
  ): { readonly timeoutMs?: number; readonly signal?: AbortSignal };
  pageSize(value: number): number;
  bounded(value: number, minimum: number, maximum: number, name: string): number;
  normalize(options: DeliveryClientOptions): DeliveryClientOptions;
  baseUrl(value: string): void;
  requestBytes(schema: Parameters<typeof toBinary>[0], value: Parameters<typeof toBinary>[1]): void;
  responseBytes(
    schema: Parameters<typeof toBinary>[0],
    value: Parameters<typeof toBinary>[1],
  ): void;
  retries(value: number): number;
  backoff(value: number): number;
  timeout(value: number): number;
}>;

/**
 * Validates delivery RPC values and prepares call-scoped protocol data.
 */
const DeliveryRequestCodec: DeliveryRequestCodecApi = Object.freeze({
  // prettier-ignore

  /**
   * Encodes an inactivity duration.
   *
   * @param value Supplies milliseconds.
   * @returns The protocol duration fields.
   */
  duration(value: number): { seconds: bigint; nanos: number } {
    const maximumMilliseconds = 315_576_000_000_000;
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximumMilliseconds)
      throw new TypeError("Delivery inactivity duration is invalid.");
    return { seconds: BigInt(Math.floor(value / 1000)), nanos: (value % 1000) * 1_000_000 };
  },

  /**
   * Encodes a date timestamp.
   *
   * @param value Supplies the date.
   * @returns The protocol timestamp fields.
   */
  timestamp(value: Date): { seconds: bigint; nanos: number } {
    if (!(value instanceof Date) || Number.isNaN(value.getTime()))
      throw new TypeError("Delivery inbox timestamp is invalid.");
    const millis = value.getTime();
    return {
      seconds: BigInt(Math.floor(millis / 1000)),
      nanos: (((millis % 1000) + 1000) % 1000) * 1_000_000,
    };
  },

  /**
   * Creates a protocol-validation error.
   *
   * @returns The protocol error.
   */
  protocol(): DeliveryProtocolError {
    return new DeliveryProtocolError();
  },

  /**
   * Creates Connect call options.
   *
   * @param signal Supplies the optional cancellation signal.
   * @param timeoutMs Supplies the validated timeout.
   * @returns The call options.
   */
  callOptions(
    signal: AbortSignal | undefined,
    timeoutMs?: number,
  ): { readonly timeoutMs?: number; readonly signal?: AbortSignal } {
    if (timeoutMs === undefined) return signal === undefined ? {} : { signal };
    return signal === undefined ? { timeoutMs } : { timeoutMs, signal };
  },

  /**
   * Validates a page size.
   *
   * @param value Supplies the page size.
   * @returns The validated page size.
   */
  pageSize(value: number): number {
    return DeliveryValues.bounded(value, 1, 1_000, "Delivery page size");
  },

  /**
   * Validates an integer in an inclusive range.
   *
   * @param value Supplies the number to validate.
   * @param minimum Defines the inclusive lower bound.
   * @param maximum Defines the inclusive upper bound.
   * @param name Names the value in validation errors.
   * @returns The validated value.
   */
  bounded(value: number, minimum: number, maximum: number, name: string): number {
    return DeliveryValues.bounded(value, minimum, maximum, name);
  },

  /**
   * Normalizes client options to bounded immutable values.
   *
   * @param options Supplies the optional client settings.
   * @returns The normalized settings.
   */
  normalize(options: DeliveryClientOptions): DeliveryClientOptions {
    return Object.freeze({
      pageSize: DeliveryRequestCodec.pageSize(options.pageSize ?? 100),
      readRetries: DeliveryRequestCodec.retries(options.readRetries ?? 0),
      retryBackoffMs: DeliveryRequestCodec.backoff(options.retryBackoffMs ?? 0),
      observationReconnects: DeliveryRequestCodec.retries(options.observationReconnects ?? 0),
      observationReconnectBackoffMs: DeliveryRequestCodec.backoff(
        options.observationReconnectBackoffMs ?? 0,
      ),
      observationBufferSize: DeliveryValues.bounded(
        options.observationBufferSize ?? 100,
        1,
        1_000,
        "Delivery observation buffer size",
      ),
    });
  },

  /**
   * Validates a delivery service base URL.
   *
   * @param value Supplies the URL.
   */
  baseUrl(value: string): void {
    if (typeof value !== "string") throw new TypeError("Delivery client base URL is invalid.");
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new TypeError("Delivery client base URL is invalid.");
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.pathname !== "/")
      throw new TypeError("Delivery client base URL is invalid.");
  },

  /**
   * Rejects an oversized RPC request.
   *
   * @param schema Supplies the message schema.
   * @param value Supplies the message value.
   */
  requestBytes(
    schema: Parameters<typeof toBinary>[0],
    value: Parameters<typeof toBinary>[1],
  ): void {
    if (toBinary(schema, value).byteLength > MAX_DELIVERY_RPC_BYTES)
      throw new TypeError("Delivery RPC request exceeds the 4 MiB limit.");
  },

  /**
   * Rejects an oversized RPC response when it can be re-encoded.
   *
   * @param schema Supplies the message schema.
   * @param value Supplies the message value.
   */
  responseBytes(
    schema: Parameters<typeof toBinary>[0],
    value: Parameters<typeof toBinary>[1],
  ): void {
    try {
      if (toBinary(schema, value).byteLength > MAX_DELIVERY_RPC_BYTES)
        throw DeliveryRequestCodec.protocol();
    } catch (error) {
      if (error instanceof DeliveryProtocolError) throw error;
      return;
    }
  },

  /**
   * Validates read retry count.
   *
   * @param value Supplies the retry count.
   * @returns The validated count.
   */
  retries(value: number): number {
    return DeliveryValues.bounded(value, 0, 5, "Delivery read retries");
  },

  /**
   * Validates retry backoff milliseconds.
   *
   * @param value Supplies the backoff.
   * @returns The validated backoff.
   */
  backoff(value: number): number {
    return DeliveryValues.finite(value, 0, 10_000, "Delivery retry backoff");
  },

  /**
   * Validates RPC timeout milliseconds.
   *
   * @param value Supplies the timeout.
   * @returns The validated timeout.
   */
  timeout(value: number): number {
    return DeliveryValues.bounded(value, 1, 120_000, "Delivery request timeout");
  },
});

export { DeliveryMessageCodec, DeliveryRequestCodec, DeliveryShardCodec };
