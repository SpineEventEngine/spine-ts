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

import { clone, create, equals, type MessageShape } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import { AnyMessages, TypeUrls, Validate, type MessageSchema } from "@spine-event-engine/core";
import {
  CommandIdSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  MessageIdSchema,
  type Event,
} from "@spine-event-engine/proto";
import {
  AgentOperationRefSchema,
  AiModelKind,
  ConversationIdSchema,
  AiOperationIdSchema,
  ModelRefSchema,
  type AgentOperationRef,
} from "@spine-event-engine/proto/agent";
import {
  type AgentAcceptedInvocation,
  type AgentNamedOperation,
  type AgentSelectedModel,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import type { SignalMetadata } from "../runtime/signal-metadata.js";

/**
 * Requires the original identifier's concrete Protobuf type URL.
 * @param value Candidate typed identifier.
 * @param field Diagnostic field name.
 * @returns Candidate after its type URL is checked.
 */
const typedId = (value: Any | undefined, field: string): Any => {
  if (!value?.typeUrl.trim()) throw new TypeError(`Agent interaction requires typed ${field}.`);
  return value;
};

/**
 * Copies the original signal ID and domain payload type from accepted work.
 * @param accepted Original accepted Command, Event, or rejection.
 * @returns Canonical source MessageId.
 */
const sourceRef = (accepted: AgentAcceptedInvocation) => {
  const signal = accepted.signal;
  if (signal.case === "command") {
    const id = signal.value.id;
    if (!id?.uuid.trim()) throw new TypeError("Agent interaction requires source Command ID.");
    const typeUrl = signal.value.message?.typeUrl;
    if (!typeUrl?.trim()) throw new TypeError("Agent interaction requires source payload type.");
    return create(MessageIdSchema, { id: AnyMessages.pack(CommandIdSchema, id), typeUrl });
  }
  if (signal.case === "event") {
    const id = signal.value.id;
    if (!id?.value.trim()) throw new TypeError("Agent interaction requires source Event ID.");
    const typeUrl = signal.value.message?.typeUrl;
    if (!typeUrl?.trim()) throw new TypeError("Agent interaction requires source payload type.");
    return create(MessageIdSchema, { id: AnyMessages.pack(EventIdSchema, id), typeUrl });
  }
  throw new TypeError("Agent interaction requires a source signal.");
};

/**
 * Creates references and typed envelopes for Agent interaction events.
 */
interface AgentInteractionEventFactory {
  /**
   * Creates a reference to accepted work and its selected model.
   * @param accepted Durable accepted invocation.
   * @param operation Named model operation.
   * @param stateSchema Generated Agent state descriptor.
   * @param selected Selected deployment for this operation kind.
   * @returns Complete operation reference.
   */
  operationRef(
    accepted: AgentAcceptedInvocation,
    operation: AgentNamedOperation,
    stateSchema: MessageSchema,
    selected: AgentSelectedModel,
  ): AgentOperationRef;

  /**
   * Wraps a typed System-event payload with the original causal context.
   * @typeParam Schema Generated System-event descriptor.
   * @param accepted Durable source Command, Event, or rejection.
   * @param metadata Spine ID, Time, and origin metadata provider.
   * @param agentId Original typed Agent identifier.
   * @param schema Generated System-event descriptor.
   * @param payload Matching typed System-event message.
   * @returns Fresh Event envelope.
   */
  envelope<Schema extends MessageSchema>(
    accepted: AgentAcceptedInvocation,
    metadata: SignalMetadata,
    agentId: Any,
    schema: Schema,
    payload: MessageShape<Schema>,
  ): Event;
}

/**
 * Creates immutable System-event facts from accepted Agent work.
 */
export const AgentInteractionEvents: AgentInteractionEventFactory = Object.freeze({
  /**
   * Correlates a named operation with its typed Agent, source signal, and selected model.
   * @param accepted Durable accepted invocation.
   * @param operation Named model operation.
   * @param stateSchema Generated Agent state descriptor.
   * @param selected Selected deployment for this operation kind.
   * @returns Complete operation reference.
   */
  operationRef(
    accepted: AgentAcceptedInvocation,
    operation: AgentNamedOperation,
    stateSchema: MessageSchema,
    selected: AgentSelectedModel,
  ): AgentOperationRef {
    const stateType = accepted.key?.scope?.stateType;
    if (stateType !== stateSchema.typeName)
      throw new TypeError("Agent interaction state type does not match accepted work.");
    const agentId = typedId(accepted.recipientId, "Agent ID");
    if (!operation.operation?.value.trim() || !operation.conversation?.value.trim())
      throw new TypeError("Agent interaction requires operation and conversation IDs.");
    if (
      !selected.model?.name?.value.trim() ||
      !selected.model.revision?.value.trim() ||
      (selected.kind !== AiModelKind.GENERATION && selected.kind !== AiModelKind.DECISION)
    )
      throw new TypeError("Agent interaction requires a selected model and kind.");
    const result = create(AgentOperationRefSchema, {
      operation: clone(AiOperationIdSchema, operation.operation),
      agent: create(MessageIdSchema, {
        id: clone(AnySchema, agentId),
        typeUrl: TypeUrls.derive(stateSchema),
      }),
      sourceSignal: sourceRef(accepted),
      model: clone(ModelRefSchema, selected.model),
      kind: selected.kind,
      conversation: clone(ConversationIdSchema, operation.conversation),
    });
    return Validate.check(AgentOperationRefSchema, result);
  },

  /**
   * Wraps one typed System-event payload with original causality and Agent producer identity.
   * @typeParam Schema Generated System-event descriptor.
   * @param accepted Durable source Command, Event, or rejection.
   * @param metadata Spine ID, Time, and origin metadata provider.
   * @param agentId Original typed Agent identifier.
   * @param schema Generated System-event descriptor.
   * @param payload Matching typed System-event message.
   * @returns Fresh Event envelope without mutating accepted work.
   */
  envelope<Schema extends MessageSchema>(
    accepted: AgentAcceptedInvocation,
    metadata: SignalMetadata,
    agentId: Any,
    schema: Schema,
    payload: MessageShape<Schema>,
  ): Event {
    const producer = typedId(agentId, "Agent ID");
    if (!accepted.recipientId || !equals(AnySchema, accepted.recipientId, producer))
      throw new TypeError("Agent interaction producer differs from accepted recipient.");
    sourceRef(accepted);
    const origin =
      accepted.signal.case === "command"
        ? metadata.eventFromCommand(accepted.signal.value, {})
        : accepted.signal.case === "event"
          ? metadata.eventFromEvent(accepted.signal.value, {})
          : undefined;
    if (!origin) throw new TypeError("Agent interaction requires a source signal.");
    const context = clone(EventContextSchema, origin.context);
    context.producerId = clone(AnySchema, producer);
    return Validate.check(
      EventSchema,
      create(EventSchema, {
        id: origin.id,
        context,
        message: AnyMessages.pack(schema, payload),
      }),
    );
  },
});
