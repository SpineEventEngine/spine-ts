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
import {
  create,
  toBinary,
  type Message,
  type MessageInitShape,
  type MessageShape,
} from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import { CommandSchema, EventSchema } from "@spine-event-engine/proto";
import {
  InboxService,
  OptionalInboxMessageSchema,
  PageOfMessagesSchema,
} from "@spine-event-engine/proto/delivery-server";
import {
  InboxLabel,
  InboxMessageSchema,
  InboxMessageStatus,
  type InboxMessage,
  type ShardIndex,
} from "@spine-event-engine/proto/delivery";

import { InMemoryDeliveryState } from "./in-memory-delivery-state.js";
import {
  MAX_DELIVERY_BATCH_MESSAGES,
  MAX_DELIVERY_RPC_BYTES,
  MAX_INBOX_PAYLOAD_BYTES,
  MAX_INBOX_RECORD_BYTES,
} from "./limits.js";
import { MutationAdmission } from "./mutation-admission.js";
import { DeliveryMessages, DeliveryShards } from "./wire-values.js";

/**
 * Provides Inbox RPC handler implementations.
 */
export const InboxHandlers: Readonly<{
  // prettier-ignore

  /**
   * Creates Inbox RPC handlers.
   *
   * @param state Stores Inbox messages served by the handlers.
   * @param admission Controls write admission and cancellation.
   * @param onMessageTransition Observes retained-message count transitions.
   * @returns The Inbox service implementation.
   */
  create: (
    state: InMemoryDeliveryState,
    admission: MutationAdmission,
    onMessageTransition?: (shard: ShardIndex, delta: 1 | -1) => void,
  ) => ServiceImpl<typeof InboxService>;
}> = Object.freeze({
  create: (
    state: InMemoryDeliveryState,
    admission: MutationAdmission,
    onMessageTransition?: (shard: ShardIndex, delta: 1 | -1) => void,
  ): ServiceImpl<typeof InboxService> => ({
    writeOne: async (request, context) => {
      const message = InboxMessages.required(request.message);
      await admission.run(context.signal, () => {
        for (const inserted of state.putAll([message]))
          onMessageTransition?.(InboxShards.required(inserted.id?.index), 1);
      });
      return {};
    },
    writeMany: async (request, context) => {
      const shard = InboxShards.required(request.shard);
      InboxMessages.requiredBatchLength(request.message.length);
      const messages = request.message.map(InboxMessages.required);
      InboxShards.ensure(
        messages.map((value) => value.message),
        shard,
      );
      await admission.run(context.signal, () => {
        for (const inserted of state.putAll(messages))
          onMessageTransition?.(InboxShards.required(inserted.id?.index), 1);
      });
      return {};
    },
    removeOne: async (request, context) => {
      const message = InboxMessages.required(request.message);
      await admission.run(context.signal, () => {
        if (state.delete(message.message))
          onMessageTransition?.(InboxShards.required(message.message.id?.index), -1);
      });
      return {};
    },
    removeMany: async (request, context) => {
      const shard = InboxShards.required(request.shard);
      InboxMessages.requiredBatchLength(request.message.length);
      const messages = request.message.map(InboxMessages.required);
      InboxShards.ensure(
        messages.map((value) => value.message),
        shard,
      );
      await admission.run(context.signal, () => {
        for (const message of messages)
          if (state.delete(message.message))
            onMessageTransition?.(InboxShards.required(message.message.id?.index), -1);
      });
      return {};
    },
    findOne: (request) => {
      if (request.index === undefined || request.uuid.trim().length === 0)
        throw InboxResponses.invalid("Delivery message identity is missing.");
      InboxShards.required(request.index);
      const message = state.messages.get(`${DeliveryShards.key(request.index)}:${request.uuid}`);
      return InboxResponses.bounded(
        OptionalInboxMessageSchema,
        message === undefined ? {} : { message: DeliveryMessages.copy(message) },
      );
    },
    findManyInShard: (request) => {
      const shard = InboxShards.required(request.shard);
      if (!Number.isInteger(request.pageSize) || request.pageSize < 1 || request.pageSize > 1_000)
        throw InboxResponses.invalid("Delivery page size must be between 1 and 1000.");
      if (request.sinceWhen !== undefined && !InboxTime.valid(request.sinceWhen))
        throw InboxResponses.invalid("Delivery page timestamp is invalid.");
      const message = [...state.messages.values()]
        .filter(
          (value) =>
            value.id?.index !== undefined &&
            DeliveryShards.key(value.id.index) === DeliveryShards.key(shard),
        )
        .filter(
          (value) =>
            request.sinceWhen === undefined || InboxTime.compare(value, request.sinceWhen) > 0,
        )
        .sort(InboxMessages.compare)
        .slice(0, request.pageSize)
        .map(DeliveryMessages.copy);
      return InboxResponses.bounded(
        PageOfMessagesSchema,
        { message },
        "Delivery page exceeds the 4 MiB response limit; request a smaller page.",
      );
    },
    newestMessageToDeliver: (shard) => {
      const key = DeliveryShards.key(InboxShards.required(shard));
      const newest = [...state.messages.values()]
        .filter(
          (value) =>
            value.id?.index !== undefined &&
            DeliveryShards.key(value.id.index) === key &&
            value.status === InboxMessageStatus.TO_DELIVER,
        )
        .sort(InboxMessages.compare)
        .at(-1);
      return InboxResponses.bounded(
        OptionalInboxMessageSchema,
        newest === undefined ? {} : { message: DeliveryMessages.copy(newest) },
      );
    },
  }),
});

/**
 * Describes a validated Inbox message and its encoded record size.
 */
interface InboxRecord {
  // prettier-ignore

  /**
   * Holds the detached validated Inbox message.
   */
  readonly message: InboxMessage;

  /**
   * Holds the encoded Inbox record size in bytes.
   */
  readonly bytes: number;
}

/**
 * Validates Inbox messages and preserves their delivery ordering.
 */
const InboxMessages: Readonly<{
  // prettier-ignore

  /**
   * Validates and copies an Inbox message.
   *
   * @param message Holds the candidate Inbox message.
   * @returns The validated detached message and its encoded size.
   */
  required: (message: InboxMessage | undefined) => InboxRecord;

  /**
   * Validates an Inbox batch length.
   *
   * @param length Holds the requested batch length.
   * @returns Nothing when the length is valid.
   */
  requiredBatchLength: (length: number) => void;

  /**
   * Compares Inbox messages by receive time, version, and UUID.
   *
   * @param left Holds the first Inbox message.
   * @param right Holds the second Inbox message.
   * @returns A sort-order comparison result.
   */
  compare: (left: InboxMessage, right: InboxMessage) => number;

  /**
   * Validates an Inbox payload.
   *
   * @param message Holds the Inbox message whose payload is checked.
   * @returns Whether the payload has a supported case and valid size.
   */
  validPayload: (message: InboxMessage) => boolean;

  /**
   * Validates an Inbox label enum value.
   *
   * @param label Holds the candidate Inbox label.
   * @returns Whether the label is supported.
   */
  validLabel: (label: InboxLabel) => boolean;

  /**
   * Validates an Inbox status enum value.
   *
   * @param status Holds the candidate Inbox status.
   * @returns Whether the status is supported.
   */
  validStatus: (status: InboxMessageStatus) => boolean;
}> = Object.freeze({
  required: (message: InboxMessage | undefined): InboxRecord => {
    if (message?.id?.index === undefined || message.inboxId?.entityId?.id === undefined)
      throw InboxResponses.invalid("Delivery message identity is incomplete.");
    if (message.signalId === undefined || message.whenReceived === undefined)
      throw InboxResponses.invalid("Delivery message fields are incomplete.");
    if (
      message.id.uuid.trim().length === 0 ||
      message.signalId.value.trim().length === 0 ||
      message.inboxId.typeUrl.trim().length === 0 ||
      message.inboxId.entityId.id.typeUrl.trim().length === 0 ||
      !InboxShards.valid(message.id.index) ||
      !InboxTime.valid(message.whenReceived) ||
      (message.keepUntil !== undefined && !InboxTime.valid(message.keepUntil)) ||
      !Number.isSafeInteger(message.version) ||
      message.version < 0
    ) {
      throw InboxResponses.invalid("Delivery message is incomplete.");
    }
    if (!InboxMessages.validPayload(message))
      throw InboxResponses.invalid("Delivery message payload is invalid.");
    if (!InboxMessages.validLabel(message.label) || !InboxMessages.validStatus(message.status))
      throw InboxResponses.invalid("Delivery message enum is invalid.");
    const bytes = toBinary(InboxMessageSchema, message).byteLength;
    if (bytes > MAX_INBOX_RECORD_BYTES)
      throw InboxResponses.invalid("Delivery message record is too large.");
    return { message: DeliveryMessages.copy(message), bytes };
  },
  requiredBatchLength: (length: number): void => {
    if (length < 1 || length > MAX_DELIVERY_BATCH_MESSAGES)
      throw InboxResponses.invalid("Delivery message batch is invalid.");
  },
  compare: (left: InboxMessage, right: InboxMessage): number => {
    const received = InboxTime.compare(left, right.whenReceived);
    if (received !== 0) return received;
    const version = left.version - right.version;
    if (version !== 0) return version;
    return (left.id?.uuid ?? "").localeCompare(right.id?.uuid ?? "");
  },
  validPayload: (message: InboxMessage): boolean => {
    const payload = message.payload;
    if (payload.case !== "command" && payload.case !== "event") return false;
    const schema = payload.case === "command" ? CommandSchema : EventSchema;
    return (
      toBinary(schema, payload.value, { writeUnknownFields: false }).byteLength <=
      MAX_INBOX_PAYLOAD_BYTES
    );
  },
  validLabel: (label: InboxLabel): boolean =>
    label === InboxLabel.HANDLE_COMMAND ||
    label === InboxLabel.UPDATE_SUBSCRIBER ||
    label === InboxLabel.REACT_UPON_EVENT ||
    label === InboxLabel.CATCH_UP,
  validStatus: (status: InboxMessageStatus): boolean =>
    status === InboxMessageStatus.TO_DELIVER ||
    status === InboxMessageStatus.SCHEDULED ||
    status === InboxMessageStatus.DELIVERED ||
    status === InboxMessageStatus.TO_CATCH_UP,
});

/**
 * Validates Inbox shard identities and batch consistency.
 */
const InboxShards: Readonly<{
  // prettier-ignore

  /**
   * Validates and returns a shard identity.
   *
   * @param shard Holds the candidate shard identity.
   * @returns The validated shard identity.
   */
  required: (shard: ShardIndex | undefined) => ShardIndex;

  /**
   * Validates a shard identity.
   *
   * @param shard Holds the candidate shard identity.
   * @returns Whether the shard identity is valid.
   */
  valid: (shard: ShardIndex) => boolean;

  /**
   * Validates that all messages belong to a shard.
   *
   * @param messages Holds the messages to check.
   * @param shard Holds the expected shard identity.
   * @returns Nothing when all messages belong to the shard.
   */
  ensure: (messages: readonly InboxMessage[], shard: ShardIndex) => void;
}> = Object.freeze({
  required: (shard: ShardIndex | undefined): ShardIndex => {
    if (shard === undefined || !InboxShards.valid(shard))
      throw InboxResponses.invalid("Delivery shard is invalid.");
    return shard;
  },
  valid: (shard: ShardIndex): boolean =>
    Number.isInteger(shard.index) &&
    shard.index >= 0 &&
    Number.isInteger(shard.ofTotal) &&
    shard.ofTotal >= 1 &&
    shard.index < shard.ofTotal,
  ensure: (messages: readonly InboxMessage[], shard: ShardIndex): void => {
    for (const message of messages) {
      if (
        message.id?.index === undefined ||
        DeliveryShards.key(message.id.index) !== DeliveryShards.key(shard)
      )
        throw InboxResponses.invalid("Delivery batch spans shards.");
    }
  },
});

/**
 * Validates and compares Inbox timestamps.
 */
const InboxTime: Readonly<{
  // prettier-ignore

  /**
   * Validates a protobuf timestamp.
   *
   * @param value Holds the candidate timestamp.
   * @returns Whether the timestamp is within protobuf bounds.
   */
  valid: (value: { readonly seconds: bigint; readonly nanos: number }) => boolean;

  /**
   * Compares a message receive time to a timestamp.
   *
   * @param left Holds the Inbox message.
   * @param right Holds the comparison timestamp.
   * @returns A sort-order comparison result.
   */
  compare: (
    left: InboxMessage,
    right: { readonly seconds: bigint; readonly nanos: number } | undefined,
  ) => number;
}> = Object.freeze({
  valid: (value: { readonly seconds: bigint; readonly nanos: number }): boolean =>
    value.seconds >= -62_135_596_800n &&
    value.seconds <= 253_402_300_799n &&
    Number.isInteger(value.nanos) &&
    value.nanos >= 0 &&
    value.nanos < 1_000_000_000,
  compare: (
    left: InboxMessage,
    right: { readonly seconds: bigint; readonly nanos: number } | undefined,
  ): number => {
    if (right === undefined || left.whenReceived === undefined)
      throw new TypeError("Delivery message receive time is missing.");
    if (left.whenReceived.seconds !== right.seconds)
      return left.whenReceived.seconds < right.seconds ? -1 : 1;
    return left.whenReceived.nanos - right.nanos;
  },
});

/**
 * Bounds Inbox responses and creates RPC errors.
 */
const InboxResponses: Readonly<{
  // prettier-ignore

  /**
   * Creates a response after enforcing its encoded size limit.
   *
   * @param schema Defines the response message type.
   * @param initializer Holds the response fields.
   * @param errorMessage Describes an oversized response.
   * @returns The bounded response message.
   */
  bounded: <Schema extends GenMessage<Message>>(
    schema: Schema,
    initializer: MessageInitShape<Schema>,
    errorMessage?: string,
  ) => MessageShape<Schema>;

  /**
   * Creates an invalid-argument RPC error.
   *
   * @param message Describes the invalid request.
   * @returns The invalid-argument error.
   */
  invalid: (message: string) => ConnectError;

  /**
   * Creates a resource-exhausted RPC error.
   *
   * @param message Describes the exhausted resource.
   * @returns The resource-exhausted error.
   */
  exhausted: (message: string) => ConnectError;
}> = Object.freeze({
  bounded: <Schema extends GenMessage<Message>>(
    schema: Schema,
    initializer: MessageInitShape<Schema>,
    errorMessage = "Delivery response exceeds the 4 MiB limit.",
  ): MessageShape<Schema> => {
    const response = create(schema, initializer);
    if (toBinary(schema, response).byteLength > MAX_DELIVERY_RPC_BYTES)
      throw InboxResponses.exhausted(errorMessage);
    return response;
  },
  invalid: (message: string): ConnectError => new ConnectError(message, Code.InvalidArgument),
  exhausted: (message: string): ConnectError => new ConnectError(message, Code.ResourceExhausted),
});
