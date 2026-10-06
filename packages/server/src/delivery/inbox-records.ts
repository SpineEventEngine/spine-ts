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
  type Timestamp,
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
  type InboxMessageSnapshotInput,
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
  /**
   * Decodes a durable inbox record and verifies its embedded identifier when requested.
   *
   * @param record The generated durable inbox record.
   * @param expectedId The optional row identifier to compare with the embedded identifier.
   * @returns An immutable inbox view with detached payload and occurrence Timestamp.
   */
  read(record: WireInboxMessage, expectedId?: WireInboxMessageId): InboxMessage;

  /**
   * Validates and serializes an inbox message into the generated durable record.
   *
   * @param message The domain inbox message to persist.
   * @returns A generated inbox record suitable for durable storage.
   */
  write(message: InboxMessageSnapshotInput): WireInboxMessage;
}> = Object.freeze({
  /**
   * Decodes a durable inbox record and verifies its embedded identifier when requested.
   *
   * @param record The generated durable inbox record.
   * @param expectedId The optional row identifier to compare with the embedded identifier.
   * @returns An immutable inbox view with detached payload and occurrence Timestamp.
   */
  read(record: WireInboxMessage, expectedId?: WireInboxMessageId): InboxMessage {
    return Values.read(record, expectedId);
  },

  /**
   * Validates and serializes an inbox message into the generated durable record.
   *
   * @param message The domain inbox message to persist.
   * @returns A generated inbox record suitable for durable storage.
   */
  write(message: InboxMessageSnapshotInput): WireInboxMessage {
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
  /**
   * Validates and serializes an inbox message into the generated durable record.
   *
   * @param input The domain inbox message to validate and encode.
   * @returns A generated inbox record suitable for durable storage.
   */
  write(input: InboxMessageSnapshotInput): WireInboxMessage {
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
      whenReceived: Values.receiveTime(message.whenReceived),
      version: Number(message.version),
      ...(message.keepUntil === undefined
        ? {}
        : { keepUntil: Values.timestamp(message.keepUntil.getTime()) }),
    });
  },

  /**
   * Decodes a durable inbox record and verifies its embedded identifier when requested.
   *
   * @param record The generated durable inbox record.
   * @param expectedId The optional row identifier to compare with the embedded identifier.
   * @returns An immutable inbox view with detached payload and occurrence Timestamp.
   */
  read(record: WireInboxMessage, expectedId?: WireInboxMessageId): InboxMessage {
    const { id, shard, inbox, entity, signal, payload, whenReceived } = Values.readParts(
      record,
      expectedId,
    );
    return Object.freeze({
      id: Object.freeze({ value: Values.text(id.uuid, "Inbox message ID"), shard }),
      inboxId: Object.freeze({ targetId: clone(AnySchema, entity), targetTypeUrl: inbox.typeUrl }),
      signalId: signal,
      ...(payload === undefined ? {} : { signal: payload }),
      label: Values.readLabel(record.label),
      status: Values.readStatus(record.status),
      shard,
      whenReceived: clone(TimestampSchema, whenReceived),
      version: BigInt(record.version),
      ...(record.keepUntil === undefined
        ? {}
        : { keepUntil: Values.date(record.keepUntil, "Inbox keep-until time") }),
    });
  },

  /**
   * Checks required stored fields, identifier, shard, and payload before building the domain view.
   *
   * @param record The generated durable inbox record.
   * @param expectedId The optional row identifier to compare with the embedded identifier.
   * @returns Validated identifiers, target, signal, and receipt timestamp.
   */
  readParts(record: WireInboxMessage, expectedId?: WireInboxMessageId) {
    const id = Values.id(record);
    const shard = Values.shard(record);
    Values.validateExpectedId(id, expectedId);
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
      !Values.validReceiveTime(record.whenReceived) ||
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
    return { id, shard, inbox, entity, signal, payload, whenReceived: record.whenReceived };
  },

  /**
   * Rejects a stored row whose embedded identifier differs from the requested row.
   *
   * @param id The embedded inbox message identifier.
   * @param expectedId The optional row identifier to compare with the embedded identifier.
   */
  validateExpectedId(id: WireInboxMessageId, expectedId?: WireInboxMessageId): void {
    if (
      expectedId !== undefined &&
      (id.uuid !== expectedId.uuid ||
        id.index?.index !== expectedId.index?.index ||
        id.index?.ofTotal !== expectedId.index?.ofTotal)
    )
      throw new DeliveryStorageCorruptionError("Inbox message does not match its storage ID.");
  },

  /**
   * Validates domain inbox fields, receipt time, label, status, and optional expiry.
   *
   * @param value The candidate domain inbox message.
   * @returns The validated domain inbox message.
   */
  input(value: InboxMessageSnapshotInput): InboxMessageSnapshotInput {
    Values.validateIdentity(value);
    const inbox = value.inboxId;
    if (
      typeof inbox.targetId.typeUrl !== "string" ||
      inbox.targetId.typeUrl.trim().length === 0 ||
      !(inbox.targetId.value instanceof Uint8Array) ||
      typeof inbox.targetTypeUrl !== "string" ||
      inbox.targetTypeUrl.trim().length === 0 ||
      typeof value.signalId !== "string" ||
      value.signalId.trim().length === 0 ||
      !Values.validReceiveTime(value.whenReceived) ||
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

  /**
   * Validates the inbox identity and its matching shard before encoding.
   * @param value The inbox write input whose identity is checked.
   */
  validateIdentity(value: InboxMessageSnapshotInput): void {
    const id = value.id;
    const shard = value.shard;
    if (
      typeof id.value !== "string" ||
      id.value.trim().length === 0 ||
      !(id.shard instanceof ShardIndex) ||
      !(shard instanceof ShardIndex) ||
      id.shard.key() !== shard.key()
    )
      throw new InboxMessageError("Inbox message ID shard does not match message shard.");
  },

  /**
   * Encodes a serialized Command or Event into the corresponding wire payload.
   *
   * @param signal The command or event payload to encode.
   * @returns The wire command or event union.
   */
  payload(signal: Any) {
    if (signal.typeUrl === "type.spine.io/spine.core.Command")
      return { case: "command" as const, value: fromBinary(CommandSchema, signal.value) };
    if (signal.typeUrl === "type.spine.io/spine.core.Event")
      return { case: "event" as const, value: fromBinary(EventSchema, signal.value) };
    throw new InboxMessageError("Inbox signal must contain a command or event payload.");
  },

  /**
   * Checks known target identifier encodings and wraps decoding errors for the caller.
   *
   * @param value The serialized entity identifier to validate.
   * @param ErrorType The error constructor appropriate to input validation or stored-data corruption.
   */
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

  /**
   * Checks that a command label carries a Command and other labels carry an Event.
   *
   * @param label The operation name used in timeout errors.
   * @param signal The command or event payload to encode.
   * @param ErrorType The error constructor appropriate to input validation or stored-data corruption.
   */
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

  /**
   * Packs a generated Command or Event as a domain signal Any.
   *
   * @param kind The signal domain kind.
   * @param payload The generated command or event payload.
   * @returns The serialized command or event Any value.
   */
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

  /**
   * Returns the required embedded identifier or reports stored-data corruption.
   *
   * @param record The generated durable inbox record.
   * @returns The embedded generated identifier.
   */
  id(record: WireInboxMessage): WireInboxMessageId {
    if (record.id === undefined)
      throw new DeliveryStorageCorruptionError("Inbox message ID is missing.");
    return record.id;
  },

  /**
   * Decodes the stored identifier shard or reports stored-data corruption.
   *
   * @param record The generated durable inbox record.
   * @returns The validated shard index.
   */
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

  /**
   * Converts a Unix millisecond instant to Protobuf seconds and nanos.
   *
   * @param ms The Unix millisecond instant to encode.
   * @returns A Protobuf Timestamp at millisecond precision.
   */
  timestamp(ms: number) {
    const seconds = Math.floor(ms / 1_000);
    return create(TimestampSchema, {
      seconds: BigInt(seconds),
      nanos: (ms - seconds * 1_000) * 1_000_000,
    });
  },

  /**
   * Copies an occurrence Timestamp without reducing nanos, or converts a millisecond Date.
   *
   * @param value The occurrence Date or Protobuf Timestamp.
   * @returns A cloned occurrence Timestamp; Date input has millisecond precision.
   */
  receiveTime(value: Date | Timestamp): Timestamp {
    return value instanceof Date
      ? Values.timestamp(value.getTime())
      : clone(TimestampSchema, value);
  },

  /**
   * Checks finite Date input or valid Protobuf Timestamp fields without reducing nanosecond precision.
   *
   * @param value The candidate occurrence Date or Protobuf Timestamp.
   * @returns Whether the Date or Protobuf Timestamp is in its valid range.
   */
  validReceiveTime(value: Date | Timestamp): boolean {
    if (value instanceof Date) return Number.isFinite(value.getTime());
    return (
      (value as unknown as { $typeName?: string } | null)?.$typeName === TimestampSchema.typeName &&
      value.seconds >= -62_135_596_800n &&
      value.seconds <= 253_402_300_799n &&
      Number.isInteger(value.nanos) &&
      value.nanos >= 0 &&
      value.nanos < 1_000_000_000
    );
  },

  /**
   * Converts stored Protobuf seconds and nanos to a millisecond Date for the expiry boundary.
   *
   * @param value The stored Protobuf timestamp fields.
   * @param label The field name used in corruption errors.
   * @returns A Date rounded down to milliseconds from the Protobuf timestamp.
   */
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

  /**
   * Maps a domain delivery label to its generated enum value.
   *
   * @param value The domain delivery label.
   * @returns The matching generated inbox label.
   */
  label(value: DeliveryLabel): InboxLabel {
    return {
      HANDLE_COMMAND: InboxLabel.HANDLE_COMMAND,
      UPDATE_SUBSCRIBER: InboxLabel.UPDATE_SUBSCRIBER,
      REACT_UPON_EVENT: InboxLabel.REACT_UPON_EVENT,
      CATCH_UP: InboxLabel.CATCH_UP,
    }[value];
  },

  /**
   * Maps a domain delivery status to its generated enum value.
   *
   * @param value The domain delivery status.
   * @returns The matching generated delivery status.
   */
  status(value: DeliveryStatus): InboxMessageStatus {
    return {
      TO_DELIVER: InboxMessageStatus.TO_DELIVER,
      SCHEDULED: InboxMessageStatus.SCHEDULED,
      DELIVERED: InboxMessageStatus.DELIVERED,
      TO_CATCH_UP: InboxMessageStatus.TO_CATCH_UP,
    }[value];
  },

  /**
   * Maps a stored enum to a known domain label or reports corruption.
   *
   * @param value The stored wire label enum.
   * @returns The domain delivery label.
   */
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

  /**
   * Maps a stored enum to a known domain status or reports corruption.
   *
   * @param value The stored wire status enum.
   * @returns The domain delivery status.
   */
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

  /**
   * Rejects labels outside the supported domain delivery states.
   *
   * @param value The candidate domain delivery label.
   */
  inputLabel(value: unknown): void {
    if (!(
      value === "HANDLE_COMMAND" ||
      value === "UPDATE_SUBSCRIBER" ||
      value === "REACT_UPON_EVENT" ||
      value === "CATCH_UP"
    ))
      throw new InboxMessageError("Inbox delivery label is invalid.");
  },

  /**
   * Rejects statuses outside the supported domain delivery states.
   *
   * @param value The candidate domain delivery status.
   */
  inputStatus(value: unknown): void {
    if (!(
      value === "TO_DELIVER" ||
      value === "SCHEDULED" ||
      value === "DELIVERED" ||
      value === "TO_CATCH_UP"
    ))
      throw new InboxMessageError("Inbox delivery status is invalid.");
  },

  /**
   * Validates nonblank stored text and reports corruption otherwise.
   *
   * @param value The stored text field to check.
   * @param label The field name used in corruption errors.
   * @returns The nonblank stored text.
   */
  text(value: unknown, label: string): string {
    if (typeof value !== "string" || value.trim().length === 0)
      throw new DeliveryStorageCorruptionError(`${label} is invalid.`);
    return value;
  },
});
