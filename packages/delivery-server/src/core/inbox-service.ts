import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import {
  InboxService,
  OptionalInboxMessageSchema,
  PageOfMessagesSchema,
} from "@spine-ts/proto/delivery-server";
import { InboxMessageStatus, type InboxMessage, type ShardIndex } from "@spine-ts/proto/delivery";

import { MutationAdmission } from "./mutation-admission.js";
import { InMemoryDeliveryState } from "./in-memory-delivery-state.js";
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
        if (state.put(message)) onMessageTransition?.(requiredShard(message.id?.index), 1);
      });
      return {};
    },
    writeMany: async (request, context) => {
      const shard = requiredShard(request.shard);
      const messages = request.message.map(requiredMessage);
      ensureShard(messages, shard);
      await admission.run(context.signal, () => {
        for (const message of messages)
          if (state.put(message)) onMessageTransition?.(requiredShard(message.id?.index), 1);
      });
      return {};
    },
    removeOne: async (request, context) => {
      const message = requiredMessage(request.message);
      await admission.run(context.signal, () => {
        if (state.delete(message)) onMessageTransition?.(requiredShard(message.id?.index), -1);
      });
      return {};
    },
    removeMany: async (request, context) => {
      const shard = requiredShard(request.shard);
      const messages = request.message.map(requiredMessage);
      ensureShard(messages, shard);
      await admission.run(context.signal, () => {
        for (const message of messages)
          if (state.delete(message)) onMessageTransition?.(requiredShard(message.id?.index), -1);
      });
      return {};
    },
    findOne: (request) => {
      if (request.index === undefined || request.uuid.trim().length === 0)
        throw invalid("Delivery message identity is missing.");
      requiredShard(request.index);
      const message = state.messages.get(`${shardKey(request.index)}:${request.uuid}`);
      return create(
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
      return create(PageOfMessagesSchema, { message });
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
      return create(
        OptionalInboxMessageSchema,
        newest === undefined ? {} : { message: copyMessage(newest) },
      );
    },
  };
}

function requiredMessage(message: InboxMessage | undefined): InboxMessage {
  if (
    message?.id?.index === undefined ||
    message.whenReceived === undefined ||
    message.id.uuid.trim().length === 0 ||
    !validShard(message.id.index) ||
    !validTimestamp(message.whenReceived)
  ) {
    throw invalid("Delivery message is incomplete.");
  }
  return copyMessage(message);
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
