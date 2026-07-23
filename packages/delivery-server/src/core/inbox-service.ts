import {
  create,
  toBinary,
  type Message,
  type MessageInitShape,
  type MessageShape,
} from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import { CommandSchema, EventSchema } from "@spine-ts/proto";
import {
  InboxService,
  OptionalInboxMessageSchema,
  PageOfMessagesSchema,
} from "@spine-ts/proto/delivery-server";
import {
  InboxLabel,
  InboxMessageSchema,
  InboxMessageStatus,
  type InboxMessage,
  type ShardIndex,
} from "@spine-ts/proto/delivery";

import { MutationAdmission } from "./mutation-admission.js";
import { InMemoryDeliveryState } from "./in-memory-delivery-state.js";
import {
  MAX_DELIVERY_BATCH_MESSAGES,
  MAX_DELIVERY_RPC_BYTES,
  MAX_INBOX_PAYLOAD_BYTES,
  MAX_INBOX_RECORD_BYTES,
} from "./limits.js";
import { copyMessage, shardKey } from "./wire-values.js";

export function createInboxService(
  state: InMemoryDeliveryState,
  admission: MutationAdmission,
  onMessageTransition?: (shard: ShardIndex, delta: 1 | -1) => void,
): ServiceImpl<typeof InboxService> {
  return {
    writeOne: async (request, context) => {
      const message = requiredMessage(request.message);
      await admission.run(context.signal, () => {
        for (const inserted of state.putAll([message]))
          onMessageTransition?.(requiredShard(inserted.id?.index), 1);
      });
      return {};
    },
    writeMany: async (request, context) => {
      const shard = requiredShard(request.shard);
      requiredBatchLength(request.message.length);
      const messages = request.message.map(requiredMessage);
      ensureShard(
        messages.map((value) => value.message),
        shard,
      );
      await admission.run(context.signal, () => {
        for (const inserted of state.putAll(messages))
          onMessageTransition?.(requiredShard(inserted.id?.index), 1);
      });
      return {};
    },
    removeOne: async (request, context) => {
      const message = requiredMessage(request.message);
      await admission.run(context.signal, () => {
        if (state.delete(message.message))
          onMessageTransition?.(requiredShard(message.message.id?.index), -1);
      });
      return {};
    },
    removeMany: async (request, context) => {
      const shard = requiredShard(request.shard);
      requiredBatchLength(request.message.length);
      const messages = request.message.map(requiredMessage);
      ensureShard(
        messages.map((value) => value.message),
        shard,
      );
      await admission.run(context.signal, () => {
        for (const message of messages)
          if (state.delete(message.message))
            onMessageTransition?.(requiredShard(message.message.id?.index), -1);
      });
      return {};
    },
    findOne: (request) => {
      if (request.index === undefined || request.uuid.trim().length === 0)
        throw invalid("Delivery message identity is missing.");
      requiredShard(request.index);
      const message = state.messages.get(`${shardKey(request.index)}:${request.uuid}`);
      return boundedResponse(
        OptionalInboxMessageSchema,
        message === undefined ? {} : { message: copyMessage(message) },
      );
    },
    findManyInShard: (request) => {
      const shard = requiredShard(request.shard);
      if (!Number.isInteger(request.pageSize) || request.pageSize < 1 || request.pageSize > 1_000)
        throw invalid("Delivery page size must be between 1 and 1000.");
      if (request.sinceWhen !== undefined && !validTimestamp(request.sinceWhen))
        throw invalid("Delivery page timestamp is invalid.");
      const message = [...state.messages.values()]
        .filter(
          (value) => value.id?.index !== undefined && shardKey(value.id.index) === shardKey(shard),
        )
        .filter(
          (value) =>
            request.sinceWhen === undefined || compareTimestamp(value, request.sinceWhen) > 0,
        )
        .sort(compareMessage)
        .slice(0, request.pageSize)
        .map(copyMessage);
      return boundedResponse(
        PageOfMessagesSchema,
        { message },
        "Delivery page exceeds the 4 MiB response limit; request a smaller page.",
      );
    },
    newestMessageToDeliver: (shard) => {
      const key = shardKey(requiredShard(shard));
      const newest = [...state.messages.values()]
        .filter(
          (value) =>
            value.id?.index !== undefined &&
            shardKey(value.id.index) === key &&
            value.status === InboxMessageStatus.TO_DELIVER,
        )
        .sort(compareMessage)
        .at(-1);
      return boundedResponse(
        OptionalInboxMessageSchema,
        newest === undefined ? {} : { message: copyMessage(newest) },
      );
    },
  };
}

function requiredMessage(message: InboxMessage | undefined): {
  readonly message: InboxMessage;
  readonly bytes: number;
} {
  if (message?.id?.index === undefined || message.inboxId?.entityId?.id === undefined)
    throw invalid("Delivery message identity is incomplete.");
  if (message.signalId === undefined || message.whenReceived === undefined)
    throw invalid("Delivery message fields are incomplete.");
  if (
    message.id.uuid.trim().length === 0 ||
    message.signalId.value.trim().length === 0 ||
    message.inboxId.typeUrl.trim().length === 0 ||
    message.inboxId.entityId.id.typeUrl.trim().length === 0 ||
    !validShard(message.id.index) ||
    !validTimestamp(message.whenReceived) ||
    (message.keepUntil !== undefined && !validTimestamp(message.keepUntil)) ||
    !Number.isSafeInteger(message.version) ||
    message.version < 0
  ) {
    throw invalid("Delivery message is incomplete.");
  }
  if (!validPayload(message)) throw invalid("Delivery message payload is invalid.");
  if (!validLabel(message.label) || !validStatus(message.status))
    throw invalid("Delivery message enum is invalid.");
  const bytes = toBinary(InboxMessageSchema, message).byteLength;
  if (bytes > MAX_INBOX_RECORD_BYTES) throw invalid("Delivery message record is too large.");
  return { message: copyMessage(message), bytes };
}

function requiredBatchLength(length: number): void {
  if (length < 1 || length > MAX_DELIVERY_BATCH_MESSAGES)
    throw invalid("Delivery message batch is invalid.");
}

function boundedResponse<Schema extends GenMessage<Message>>(
  schema: Schema,
  initializer: MessageInitShape<Schema>,
  errorMessage = "Delivery response exceeds the 4 MiB limit.",
): MessageShape<Schema> {
  const response = create(schema, initializer);
  if (toBinary(schema, response).byteLength > MAX_DELIVERY_RPC_BYTES) throw exhausted(errorMessage);
  return response;
}

function validPayload(message: InboxMessage): boolean {
  const payload = message.payload;
  if (payload.case !== "command" && payload.case !== "event") return false;
  const schema = payload.case === "command" ? CommandSchema : EventSchema;
  return (
    toBinary(schema, payload.value, { writeUnknownFields: false }).byteLength <=
    MAX_INBOX_PAYLOAD_BYTES
  );
}

function validLabel(label: InboxLabel): boolean {
  return (
    label === InboxLabel.HANDLE_COMMAND ||
    label === InboxLabel.UPDATE_SUBSCRIBER ||
    label === InboxLabel.REACT_UPON_EVENT ||
    label === InboxLabel.CATCH_UP
  );
}

function validStatus(status: InboxMessageStatus): boolean {
  return (
    status === InboxMessageStatus.TO_DELIVER ||
    status === InboxMessageStatus.SCHEDULED ||
    status === InboxMessageStatus.DELIVERED ||
    status === InboxMessageStatus.TO_CATCH_UP
  );
}

function requiredShard(shard: ShardIndex | undefined): ShardIndex {
  if (shard === undefined || !validShard(shard)) throw invalid("Delivery shard is invalid.");
  return shard;
}

function validShard(shard: ShardIndex): boolean {
  return (
    Number.isInteger(shard.index) &&
    shard.index >= 0 &&
    Number.isInteger(shard.ofTotal) &&
    shard.ofTotal >= 1 &&
    shard.index < shard.ofTotal
  );
}

function validTimestamp(value: { readonly seconds: bigint; readonly nanos: number }): boolean {
  return (
    value.seconds >= -62_135_596_800n &&
    value.seconds <= 253_402_300_799n &&
    Number.isInteger(value.nanos) &&
    value.nanos >= 0 &&
    value.nanos < 1_000_000_000
  );
}

function ensureShard(messages: readonly InboxMessage[], shard: ShardIndex): void {
  for (const message of messages) {
    if (message.id?.index === undefined || shardKey(message.id.index) !== shardKey(shard))
      throw invalid("Delivery batch spans shards.");
  }
}

function compareMessage(left: InboxMessage, right: InboxMessage): number {
  const received = compareTimestamp(left, right.whenReceived);
  if (received !== 0) return received;
  const version = left.version - right.version;
  if (version !== 0) return version;
  return (left.id?.uuid ?? "").localeCompare(right.id?.uuid ?? "");
}

function compareTimestamp(
  left: InboxMessage,
  right: { readonly seconds: bigint; readonly nanos: number } | undefined,
): number {
  if (right === undefined || left.whenReceived === undefined)
    throw new TypeError("Delivery message receive time is missing.");
  if (left.whenReceived.seconds !== right.seconds)
    return left.whenReceived.seconds < right.seconds ? -1 : 1;
  return left.whenReceived.nanos - right.nanos;
}

function invalid(message: string): ConnectError {
  return new ConnectError(message, Code.InvalidArgument);
}

function exhausted(message: string): ConnectError {
  return new ConnectError(message, Code.ResourceExhausted);
}
