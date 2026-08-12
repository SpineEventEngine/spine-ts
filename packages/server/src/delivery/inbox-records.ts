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

import { clone, create, fromBinary, ScalarType, toBinary } from "@bufbuild/protobuf";
import {
  AnySchema,
  Int32ValueSchema,
  Int64ValueSchema,
  StringValueSchema,
  TimestampSchema,
  type Any,
} from "@bufbuild/protobuf/wkt";
import { CommandSchema, EventSchema } from "@spine-event-engine/proto";
import {
  InboxIdSchema,
  InboxLabel,
  InboxMessageIdSchema,
  InboxMessageSchema,
  InboxMessageStatus,
  InboxSignalIdSchema,
  ShardIndexSchema,
  type InboxMessage as WireInboxMessage,
  type InboxMessageId as WireInboxMessageId,
} from "@spine-event-engine/proto/delivery";
import { ColumnTypes, RecordColumn, RecordSpec } from "@spine-event-engine/storage";

import { DeliveryStorageCorruptionError } from "./delivery-storage-error.js";
import {
  InboxMessageError,
  type DeliveryLabel,
  type DeliveryStatus,
  type InboxMessage,
} from "./inbox.js";
import { ShardIndex } from "./shard-index.js";

/**
 * Identifies the public inbox view that maps directly to the durable record.
 */
export type InboxRecordMessage = InboxMessage;

/**
 * Converts between the ergonomic port view and the generated durable record.
 */
export const InboxRecords: Readonly<{
  read(record: WireInboxMessage, expectedId?: WireInboxMessageId): InboxMessage;
  write(message: InboxMessage): WireInboxMessage;
}> = Object.freeze({
  read(record: WireInboxMessage, expectedId?: WireInboxMessageId): InboxMessage {
    return Values.read(record, expectedId);
  },
  write(message: InboxMessage): WireInboxMessage {
    return Values.write(message);
  },
});

/**
 * Defines the direct generated record specification for durable inbox rows.
 */
export const inboxRecordSpec: RecordSpec<WireInboxMessageId, WireInboxMessage> = new RecordSpec<
  WireInboxMessageId,
  WireInboxMessage
>({
  sourceType: InboxMessageSchema,
  recordType: InboxMessageSchema,
  idSchema: InboxMessageIdSchema,
  extractId: (record) => Values.id(record),
  columns: [
    new RecordColumn(
      "inbox_id",
      ColumnTypes.fromField(InboxMessageSchema.field.inboxId),
      (record) => record.inboxId,
    ),
    new RecordColumn(
      "signal_id",
      ColumnTypes.fromField(InboxMessageSchema.field.signalId),
      (record) => record.signalId,
    ),
    new RecordColumn(
      "shard_index",
      ColumnTypes.scalar(ScalarType.INT32),
      (record) => Values.shard(record).index,
    ),
    new RecordColumn(
      "shard_total",
      ColumnTypes.scalar(ScalarType.INT32),
      (record) => Values.shard(record).ofTotal,
    ),
    new RecordColumn(
      "status",
      ColumnTypes.fromField(InboxMessageSchema.field.status),
      (record) => record.status,
    ),
    new RecordColumn(
      "when_received",
      ColumnTypes.fromField(InboxMessageSchema.field.whenReceived),
      (record) => record.whenReceived,
    ),
    new RecordColumn(
      "version",
      ColumnTypes.fromField(InboxMessageSchema.field.version),
      (record) => record.version,
    ),
    new RecordColumn("message_id", ColumnTypes.scalar(ScalarType.STRING), (record) =>
      Values.text(record.id?.uuid, "Inbox message ID"),
    ),
  ],
});

const Values = Object.freeze({
  write(input: InboxMessage): WireInboxMessage {
    const message = Values.input(input);
    Values.target(message.inboxId.targetId, InboxMessageError);
    Values.payloadForLabel(message.label, message.signal, InboxMessageError);
    const payload =
      message.signal === undefined ? { case: undefined } : Values.payload(message.signal);
    return create(InboxMessageSchema, {
      id: create(InboxMessageIdSchema, {
        uuid: message.id.value,
        index: create(ShardIndexSchema, {
          index: message.shard.index,
          ofTotal: message.shard.ofTotal,
        }),
      }),
      signalId: create(InboxSignalIdSchema, { value: message.signalId }),
      inboxId: create(InboxIdSchema, {
        entityId: {
          id: clone(AnySchema, message.inboxId.targetId),
        },
        typeUrl: message.inboxId.targetTypeUrl,
      }),
      payload,
      label: Values.label(message.label),
      status: Values.status(message.status),
      whenReceived: Values.timestamp(message.whenReceived.getTime()),
      version: Number(message.version),
      ...(message.keepUntil === undefined
        ? {}
        : { keepUntil: Values.timestamp(message.keepUntil.getTime()) }),
    });
  },
  read(record: WireInboxMessage, expectedId?: WireInboxMessageId): InboxMessage {
    const id = Values.id(record);
    const shard = Values.shard(record);
    if (
      expectedId !== undefined &&
      (id.uuid !== expectedId.uuid ||
        id.index?.index !== expectedId.index?.index ||
        id.index?.ofTotal !== expectedId.index?.ofTotal)
    )
      throw new DeliveryStorageCorruptionError("Inbox message does not match its storage ID.");
    const inbox = record.inboxId;
    const entity = inbox?.entityId?.id;
    const signal = record.signalId?.value;
    if (
      inbox === undefined ||
      typeof entity?.typeUrl !== "string" ||
      entity.typeUrl.trim().length === 0 ||
      typeof signal !== "string" ||
      signal.trim().length === 0 ||
      typeof inbox.typeUrl !== "string" ||
      inbox.typeUrl.trim().length === 0 ||
      record.whenReceived === undefined ||
      !Number.isSafeInteger(record.version) ||
      record.version < 0
    )
      throw new DeliveryStorageCorruptionError("Inbox message record is invalid.");
    if (!(entity.value instanceof Uint8Array))
      throw new DeliveryStorageCorruptionError("Inbox target ID is invalid.");
    Values.target(entity, DeliveryStorageCorruptionError);
    const payload =
      record.payload.case === undefined
        ? undefined
        : Values.signal(record.payload.case, record.payload.value);
    Values.payloadForLabel(Values.readLabel(record.label), payload, DeliveryStorageCorruptionError);
    return Object.freeze({
      id: Object.freeze({ value: Values.text(id.uuid, "Inbox message ID"), shard }),
      inboxId: Object.freeze({ targetId: clone(AnySchema, entity), targetTypeUrl: inbox.typeUrl }),
      signalId: signal,
      ...(payload === undefined ? {} : { signal: payload }),
      label: Values.readLabel(record.label),
      status: Values.readStatus(record.status),
      shard,
      whenReceived: Values.date(record.whenReceived, "Inbox receive time"),
      version: BigInt(record.version),
      ...(record.keepUntil === undefined
        ? {}
        : { keepUntil: Values.date(record.keepUntil, "Inbox keep-until time") }),
    });
  },
  input(value: InboxMessage): InboxMessage {
    const id = value.id;
    const inbox = value.inboxId;
    const shard = value.shard;
    if (
      typeof id.value !== "string" ||
      id.value.trim().length === 0 ||
      !(id.shard instanceof ShardIndex) ||
      !(shard instanceof ShardIndex) ||
      id.shard.key() !== shard.key()
    )
      throw new InboxMessageError("Inbox message ID shard does not match message shard.");
    if (
      typeof inbox.targetId.typeUrl !== "string" ||
      inbox.targetId.typeUrl.trim().length === 0 ||
      !(inbox.targetId.value instanceof Uint8Array) ||
      typeof inbox.targetTypeUrl !== "string" ||
      inbox.targetTypeUrl.trim().length === 0 ||
      typeof value.signalId !== "string" ||
      value.signalId.trim().length === 0 ||
      !(value.whenReceived instanceof Date) ||
      !Number.isFinite(value.whenReceived.getTime()) ||
      typeof value.version !== "bigint" ||
      value.version < 0n ||
      value.version > BigInt(0x7fffffff)
    )
      throw new InboxMessageError("Inbox message is invalid.");
    Values.inputLabel(value.label);
    Values.inputStatus(value.status);
    if (
      value.keepUntil !== undefined &&
      (!(value.keepUntil instanceof Date) || !Number.isFinite(value.keepUntil.getTime()))
    )
      throw new InboxMessageError("Inbox keep-until time is invalid.");
    return value;
  },
  payload(signal: Any) {
    if (signal.typeUrl === "type.spine.io/spine.core.Command")
      return { case: "command" as const, value: fromBinary(CommandSchema, signal.value) };
    if (signal.typeUrl === "type.spine.io/spine.core.Event")
      return { case: "event" as const, value: fromBinary(EventSchema, signal.value) };
    throw new InboxMessageError("Inbox signal must contain a command or event payload.");
  },
  target(
    value: Any,
    ErrorType: typeof InboxMessageError | typeof DeliveryStorageCorruptionError,
  ): void {
    try {
      switch (value.typeUrl) {
        case "type.googleapis.com/google.protobuf.StringValue":
          if (fromBinary(StringValueSchema, value.value).value.trim().length === 0)
            throw new TypeError("String target ID is blank.");
          break;
        case "type.googleapis.com/google.protobuf.Int32Value":
          fromBinary(Int32ValueSchema, value.value);
          break;
        case "type.googleapis.com/google.protobuf.Int64Value":
          fromBinary(Int64ValueSchema, value.value);
          break;
      }
    } catch (error) {
      throw new ErrorType("Inbox target ID is invalid.", { cause: error });
    }
  },
  payloadForLabel(
    label: DeliveryLabel,
    signal: Any | undefined,
    ErrorType: typeof InboxMessageError | typeof DeliveryStorageCorruptionError,
  ): void {
    const expected =
      label === "HANDLE_COMMAND"
        ? "type.spine.io/spine.core.Command"
        : "type.spine.io/spine.core.Event";
    if (signal?.typeUrl !== expected)
      throw new ErrorType("Inbox delivery label does not match its signal payload.");
  },
  signal(kind: "command" | "event", payload: unknown): Any {
    return kind === "command"
      ? create(AnySchema, {
          typeUrl: "type.spine.io/spine.core.Command",
          value: toBinary(CommandSchema, payload as never),
        })
      : create(AnySchema, {
          typeUrl: "type.spine.io/spine.core.Event",
          value: toBinary(EventSchema, payload as never),
        });
  },
  id(record: WireInboxMessage): WireInboxMessageId {
    if (record.id === undefined)
      throw new DeliveryStorageCorruptionError("Inbox message ID is missing.");
    return record.id;
  },
  shard(record: WireInboxMessage): ShardIndex {
    const index = record.id?.index;
    if (index === undefined)
      throw new DeliveryStorageCorruptionError("Inbox message ID shard is missing.");
    try {
      return new ShardIndex(index.index, index.ofTotal);
    } catch (error) {
      throw new DeliveryStorageCorruptionError("Inbox message shard is invalid.", { cause: error });
    }
  },
  timestamp(ms: number) {
    const seconds = Math.floor(ms / 1_000);
    return create(TimestampSchema, {
      seconds: BigInt(seconds),
      nanos: (ms - seconds * 1_000) * 1_000_000,
    });
  },
  date(value: { readonly seconds: bigint; readonly nanos: number }, label: string): Date {
    const ms = Number(value.seconds) * 1000 + Math.floor(value.nanos / 1_000_000);
    if (
      !Number.isInteger(value.nanos) ||
      value.nanos < 0 ||
      value.nanos >= 1_000_000_000 ||
      !Number.isSafeInteger(ms)
    )
      throw new DeliveryStorageCorruptionError(`${label} is invalid.`);
    return new Date(ms);
  },
  label(value: DeliveryLabel): InboxLabel {
    return {
      HANDLE_COMMAND: InboxLabel.HANDLE_COMMAND,
      UPDATE_SUBSCRIBER: InboxLabel.UPDATE_SUBSCRIBER,
      REACT_UPON_EVENT: InboxLabel.REACT_UPON_EVENT,
      CATCH_UP: InboxLabel.CATCH_UP,
    }[value];
  },
  status(value: DeliveryStatus): InboxMessageStatus {
    return {
      TO_DELIVER: InboxMessageStatus.TO_DELIVER,
      SCHEDULED: InboxMessageStatus.SCHEDULED,
      DELIVERED: InboxMessageStatus.DELIVERED,
      TO_CATCH_UP: InboxMessageStatus.TO_CATCH_UP,
    }[value];
  },
  readLabel(value: InboxLabel): DeliveryLabel {
    const result: Partial<Record<InboxLabel, DeliveryLabel>> = {
      [InboxLabel.HANDLE_COMMAND]: "HANDLE_COMMAND",
      [InboxLabel.UPDATE_SUBSCRIBER]: "UPDATE_SUBSCRIBER",
      [InboxLabel.REACT_UPON_EVENT]: "REACT_UPON_EVENT",
      [InboxLabel.CATCH_UP]: "CATCH_UP",
    };
    if (result[value] === undefined)
      throw new DeliveryStorageCorruptionError("Inbox label is invalid.");
    return result[value];
  },
  readStatus(value: InboxMessageStatus): DeliveryStatus {
    const result: Partial<Record<InboxMessageStatus, DeliveryStatus>> = {
      [InboxMessageStatus.TO_DELIVER]: "TO_DELIVER",
      [InboxMessageStatus.SCHEDULED]: "SCHEDULED",
      [InboxMessageStatus.DELIVERED]: "DELIVERED",
      [InboxMessageStatus.TO_CATCH_UP]: "TO_CATCH_UP",
    };
    if (result[value] === undefined)
      throw new DeliveryStorageCorruptionError("Inbox status is invalid.");
    return result[value];
  },
  inputLabel(value: unknown): void {
    if (!(
      value === "HANDLE_COMMAND" ||
      value === "UPDATE_SUBSCRIBER" ||
      value === "REACT_UPON_EVENT" ||
      value === "CATCH_UP"
    ))
      throw new InboxMessageError("Inbox delivery label is invalid.");
  },
  inputStatus(value: unknown): void {
    if (!(
      value === "TO_DELIVER" ||
      value === "SCHEDULED" ||
      value === "DELIVERED" ||
      value === "TO_CATCH_UP"
    ))
      throw new InboxMessageError("Inbox delivery status is invalid.");
  },
  text(value: unknown, label: string): string {
    if (typeof value !== "string" || value.trim().length === 0)
      throw new DeliveryStorageCorruptionError(`${label} is invalid.`);
    return value;
  },
});
