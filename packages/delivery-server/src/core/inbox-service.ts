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

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import {
  InboxService,
  OptionalInboxMessageSchema,
  PageOfMessagesSchema,
} from "@spine-event-engine/proto/delivery-server";
import {
  InboxLabel,
  InboxMessageStatus,
  type InboxMessage,
  type ShardIndex,
} from "@spine-event-engine/proto/delivery";

import { InMemoryDeliveryState } from "./in-memory-delivery-state.js";
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
   * @param onStoredChange Observes changes to retained rows for Admin.
   * @param onWorkChange Observes changes affecting pending work availability.
   * @returns The Inbox service implementation.
   */
  create: (
    state: InMemoryDeliveryState,
    admission: MutationAdmission,
    onStoredChange?: (shard: ShardIndex) => void,
    onWorkChange?: (shard: ShardIndex) => void,
  ) => ServiceImpl<typeof InboxService>;
}> = Object.freeze({
  create: (
    state: InMemoryDeliveryState,
    admission: MutationAdmission,
    onStoredChange?: (shard: ShardIndex) => void,
    onWorkChange?: (shard: ShardIndex) => void,
  ): ServiceImpl<typeof InboxService> =>
    Object.freeze({
      writeOne: InboxOperations.writeOne(state, admission, onStoredChange, onWorkChange),
      writeMany: InboxOperations.writeMany(state, admission, onStoredChange, onWorkChange),
      removeOne: InboxOperations.removeOne(state, admission, onStoredChange, onWorkChange),
      removeMany: InboxOperations.removeMany(state, admission, onStoredChange, onWorkChange),
      findOne: InboxOperations.findOne(state),
      findManyInShard: InboxOperations.findManyInShard(state),
      newestMessageToDeliver: InboxOperations.newestMessageToDeliver(state),
    }),
});

const InboxOperations = {
  writeOne:
    (
      state: InMemoryDeliveryState,
      admission: MutationAdmission,
      onStoredChange?: (shard: ShardIndex) => void,
      onWorkChange?: (shard: ShardIndex) => void,
    ): ServiceImpl<typeof InboxService>["writeOne"] =>
    async (request, context) => {
      const message = InboxMessages.required(request.message);
      await admission.run(context.signal, () => {
        const affectsWork = state.put(message.message);
        const shard = InboxShards.required(message.message.id?.index);
        onStoredChange?.(shard);
        if (affectsWork) onWorkChange?.(shard);
      });
      return {};
    },
  writeMany:
    (
      state: InMemoryDeliveryState,
      admission: MutationAdmission,
      onStoredChange?: (shard: ShardIndex) => void,
      onWorkChange?: (shard: ShardIndex) => void,
    ): ServiceImpl<typeof InboxService>["writeMany"] =>
    async (request, context) => {
      const messages = request.message.map(InboxMessages.required);
      await admission.run(context.signal, () => {
        for (const [shard, group] of InboxOperations.groupByShard(
          messages,
          (item) => item.message,
        )) {
          const affectsWork = state.putAll(group);
          onStoredChange?.(shard);
          if (affectsWork) onWorkChange?.(shard);
        }
      });
      return {};
    },
  removeOne:
    (
      state: InMemoryDeliveryState,
      admission: MutationAdmission,
      onStoredChange?: (shard: ShardIndex) => void,
      onWorkChange?: (shard: ShardIndex) => void,
    ): ServiceImpl<typeof InboxService>["removeOne"] =>
    async (request, context) => {
      const message = InboxOperations.requiredRemoval(request.message);
      await admission.run(context.signal, () => {
        const prior = state.messages.get(DeliveryMessages.key(message));
        if (state.delete(message)) {
          const shard = InboxShards.required(message.id?.index);
          onStoredChange?.(shard);
          if (prior?.status === InboxMessageStatus.TO_DELIVER) onWorkChange?.(shard);
        }
      });
      return {};
    },
  removeMany:
    (
      state: InMemoryDeliveryState,
      admission: MutationAdmission,
      onStoredChange?: (shard: ShardIndex) => void,
      onWorkChange?: (shard: ShardIndex) => void,
    ): ServiceImpl<typeof InboxService>["removeMany"] =>
    async (request, context) => {
      const messages = request.message.map((message) => InboxOperations.requiredRemoval(message));
      await admission.run(context.signal, () => {
        for (const [shard, group] of InboxOperations.groupByShard(messages, (item) => item)) {
          const { changed, pendingChanged } = state.deleteMany(shard, group);
          if (changed) onStoredChange?.(shard);
          if (pendingChanged) onWorkChange?.(shard);
        }
      });
      return {};
    },
  findOne:
    (state: InMemoryDeliveryState): ServiceImpl<typeof InboxService>["findOne"] =>
    (request) => {
      if (request.index === undefined || request.uuid.trim().length === 0)
        throw InboxResponses.invalid("Delivery message identity is missing.");
      InboxShards.required(request.index);
      const message = state.messages.get(`${DeliveryShards.key(request.index)}:${request.uuid}`);
      return create(
        OptionalInboxMessageSchema,
        message === undefined ? {} : { message: DeliveryMessages.copy(message) },
      );
    },
  findManyInShard:
    (state: InMemoryDeliveryState): ServiceImpl<typeof InboxService>["findManyInShard"] =>
    (request) => {
      const shard = InboxShards.required(request.shard);
      if (request.pageSize <= 0)
        throw new ConnectError("Delivery page size is invalid.", Code.Unknown);
      if (request.sinceWhen !== undefined && !InboxTime.valid(request.sinceWhen))
        throw InboxResponses.invalid("Delivery page timestamp is invalid.");
      const sinceWhen = request.sinceWhen;
      const message = state.page(
        shard,
        sinceWhen?.seconds === 0n && sinceWhen.nanos === 0 ? undefined : sinceWhen,
        request.pageSize,
      );
      return create(PageOfMessagesSchema, { message });
    },
  newestMessageToDeliver:
    (state: InMemoryDeliveryState): ServiceImpl<typeof InboxService>["newestMessageToDeliver"] =>
    (shard) => {
      const newest = state.newestPending(InboxShards.required(shard));
      return create(OptionalInboxMessageSchema, newest === undefined ? {} : { message: newest });
    },

  /**
   * Validates the inbox identity used by a removal.
   *
   * @param message Supplies the inbox message carrying the identity.
   * @returns The inbox message after its identity is checked.
   */
  requiredRemoval(message: InboxMessage | undefined): InboxMessage {
    if (message?.id?.index === undefined || message.id.uuid.trim().length === 0)
      throw InboxResponses.invalid("Delivery message identity is missing.");
    InboxShards.required(message.id.index);
    return message;
  },

  /**
   * Groups a batch by the actual inbox identity shard in first-seen order.
   *
   * @typeParam Item The type of a validated batch item.
   * @param items Supplies the validated batch.
   * @param message Selects each item’s inbox message.
   * @returns Per-shard groups retaining input order.
   */
  groupByShard<Item>(
    items: readonly Item[],
    message: (item: Item) => InboxMessage,
  ): readonly (readonly [ShardIndex, Item[]])[] {
    const groups = new Map<string, { shard: ShardIndex; items: Item[] }>();
    for (const item of items) {
      const shard = InboxShards.required(message(item).id?.index);
      const key = DeliveryShards.key(shard);
      let group = groups.get(key);
      if (group === undefined) {
        group = { shard, items: [] };
        groups.set(key, group);
      }
      group.items.push(item);
    }
    return [...groups.values()].map(({ shard, items }) => [shard, items] as const);
  },
};

/**
 * Describes a validated Inbox message.
 */
interface InboxRecord {
  // prettier-ignore

  /**
   * Holds the detached validated Inbox message.
   */
  readonly message: InboxMessage;
}

/**
 * Validates Inbox messages and preserves their delivery ordering.
 */
export const InboxMessages: Readonly<{
  // prettier-ignore

  /**
   * Validates and copies an Inbox message.
   *
   * @param message Holds the candidate Inbox message.
   * @returns The validated detached message.
   */
  required: (message: InboxMessage | undefined) => InboxRecord;

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
    return { message: DeliveryMessages.copy(message) };
  },
  validPayload: (message: InboxMessage): boolean => {
    const payload = message.payload;
    if (payload.case !== "command" && payload.case !== "event") return false;
    const value: unknown = Reflect.get(payload, "value");
    return typeof value === "object" && value !== null;
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
export const InboxShards: Readonly<{
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
}> = Object.freeze({
  valid: (value: { readonly seconds: bigint; readonly nanos: number }): boolean =>
    value.seconds >= -62_135_596_800n &&
    value.seconds <= 253_402_300_799n &&
    Number.isInteger(value.nanos) &&
    value.nanos >= 0 &&
    value.nanos < 1_000_000_000,
});

/**
 * Creates Inbox RPC errors.
 */
const InboxResponses = Object.freeze({
  invalid: (message: string): ConnectError => new ConnectError(message, Code.InvalidArgument),
});
