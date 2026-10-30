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

import { create, equals, type MessageShape } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { AnyPacker, TypeUrls, Validate, type MessageSchema } from "@spine-event-engine/core";
import {
  CommandIdSchema,
  EventIdSchema,
  EventSchema,
  MessageIdSchema,
  type MessageId,
  type Event,
} from "@spine-event-engine/proto";
import {
  AgentOperationRefSchema,
  AiModelKind,
  ModelRefSchema,
  type AgentOperationRef,
} from "@spine-event-engine/proto/agent";
import type { SignalMetadata } from "../runtime/signal-metadata.js";
import type {
  AgentLiveInvocation,
  AgentLiveModel,
  AgentOperationIdentity,
} from "./agent-live-inputs.js";

/**
 * Validation and envelope construction for one live Agent operation.
 */
interface LiveInteractionEvents {
  /**
   * Returns the original typed source without changing its payload URL.
   *
   * @param invocation Captured live Agent invocation.
   * @returns The original typed Command or Event source reference.
   */
  sourceRef(invocation: AgentLiveInvocation): MessageId;

  /**
   * Creates a typed reference without a durable execution journal.
   *
   * @param invocation Captured live Agent invocation.
   * @param operation Current AI operation identity.
   * @param selected Models or selection retained for this invocation.
   * @param stateSchema Generated Entity state schema.
   * @returns The typed reference for this live AI operation.
   */
  operationRef(
    invocation: AgentLiveInvocation,
    operation: AgentOperationIdentity,
    stateSchema: MessageSchema,
    selected: AgentLiveModel,
  ): AgentOperationRef;

  /**
   * Creates one original System Event after validating its typed payload.
   *
   * @typeParam Schema Generated schema of the original System fact.
   * @param agentId Typed Agent identifier.
   * @param invocation Captured live Agent invocation.
   * @param metadata Captured signal metadata.
   * @param payload Typed serialized payload.
   * @param schema Generated Protobuf schema for the payload.
   * @returns The original System Event envelope for the validated payload.
   */
  envelope<Schema extends MessageSchema>(
    invocation: AgentLiveInvocation,
    metadata: SignalMetadata,
    agentId: AgentLiveInvocation["recipientId"],
    schema: Schema,
    payload: MessageShape<Schema>,
  ): Event;
}

/**
 * Builds validated source and System-event facts without an execution journal.
 */
export const AgentLiveInteractionEvents: LiveInteractionEvents = Object.freeze({
  /**
   * Correlates one live AI call with the original typed source and selected model.
   * @param invocation Original source, Agent ID, and state type.
   * @param operation Required operation and conversation IDs.
   * @param stateSchema Generated Agent state descriptor.
   * @param selected Authorized model and connection.
   * @returns Validated operation reference.
   */
  operationRef(
    invocation: AgentLiveInvocation,
    operation: AgentOperationIdentity,
    stateSchema: MessageSchema,
    selected: AgentLiveModel,
  ): AgentOperationRef {
    if (invocation.stateType !== stateSchema.typeName)
      throw new TypeError("Agent interaction state type does not match accepted work.");
    if (!invocation.recipientId.typeUrl.trim())
      throw new TypeError("Agent interaction requires typed Agent ID.");
    if (!operation.operation.value.trim() || !operation.conversation.value.trim())
      throw new TypeError("Agent interaction requires operation and conversation IDs.");
    const kind: unknown = Reflect.get(selected, "kind");
    if (kind !== AiModelKind.GENERATION && kind !== AiModelKind.DECISION)
      throw new TypeError("Agent interaction requires a selected model and kind.");
    Validate.check(ModelRefSchema, selected.model);
    const sourceSignal = this.sourceRef(invocation);
    return Validate.check(
      AgentOperationRefSchema,
      create(AgentOperationRefSchema, {
        operation: operation.operation,
        agent: create(MessageIdSchema, {
          id: invocation.recipientId,
          typeUrl: TypeUrls.derive(stateSchema),
        }),
        sourceSignal,
        model: selected.model,
        kind: selected.kind,
        conversation: operation.conversation,
      }),
    );
  },

  /**
   * Wraps one typed System payload with the original source and Agent producer.
   * @typeParam Schema Generated System payload descriptor.
   * @param invocation Original source and typed recipient.
   * @param metadata Signal ID, Time, and causal context provider.
   * @param agentId Typed producer Agent ID.
   * @param schema Generated System payload descriptor.
   * @param payload Typed System payload.
   * @returns Validated original Event envelope.
   */
  envelope<Schema extends MessageSchema>(
    invocation: AgentLiveInvocation,
    metadata: SignalMetadata,
    agentId: AgentLiveInvocation["recipientId"],
    schema: Schema,
    payload: MessageShape<Schema>,
  ): Event {
    if (!agentId.typeUrl.trim() || !equals(AnySchema, invocation.recipientId, agentId))
      throw new TypeError("Agent interaction producer differs from accepted recipient.");
    this.sourceRef(invocation);
    Validate.check(schema, payload);
    const source = invocation.source;
    const origin =
      source.case === "command"
        ? metadata.eventFromCommand(source.value, {})
        : metadata.eventFromEvent(source.value, {});
    origin.context.producerId = agentId;
    return Validate.check(
      EventSchema,
      create(EventSchema, {
        id: origin.id,
        context: origin.context,
        message: AnyPacker.pack(schema, payload),
      }),
    );
  },

  /**
   * Requires a typed source ID and preserves its concrete payload URL.
   */
  sourceRef(invocation: AgentLiveInvocation): MessageId {
    const source = invocation.source;
    if (source.case === "command") {
      const id = source.value.id;
      if (!id?.uuid.trim()) throw new TypeError("Agent interaction requires source Command ID.");
      const typeUrl = source.value.message?.typeUrl;
      if (!typeUrl?.trim()) throw new TypeError("Agent interaction requires source payload type.");
      return create(MessageIdSchema, { id: AnyPacker.pack(CommandIdSchema, id), typeUrl });
    }
    const id = source.value.id;
    if (!id?.value.trim()) throw new TypeError("Agent interaction requires source Event ID.");
    const typeUrl = source.value.message?.typeUrl;
    if (!typeUrl?.trim()) throw new TypeError("Agent interaction requires source payload type.");
    return create(MessageIdSchema, { id: AnyPacker.pack(EventIdSchema, id), typeUrl });
  },
});
