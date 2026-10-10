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

import { clone, create, equals } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import type { Any } from "@bufbuild/protobuf/wkt";
import type { ActorContext, Command, Event } from "@spine-event-engine/proto";
import { ActorContextSchema, CommandSchema, EventSchema } from "@spine-event-engine/proto";
import {
  AgentAcceptedInvocationSchema,
  AgentCodeRevisionSchema,
  AgentExecutionScopeSchema,
  AgentHandlerBindingSchema,
  AgentHandlerKind,
  AgentHandlerOrigin,
  AgentInboxOrderSchema,
  AgentInvocationKeySchema,
  AgentPolicyRevisionSchema,
  AgentSchemaRevisionSchema,
  AgentSignalKeySchema,
  type AgentAcceptedInvocation,
  type AgentHandlerBinding,
  type AgentSignalKey,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import type { RegisteredHandlerMetadata } from "../handler/handler-metadata.js";
import type { InboxMessage } from "../delivery/inbox.js";

/**
 * Complete source and selected bindings at one durable Inbox handoff.
 */
export interface AgentAdmissionInput {
  /**
   * Generated Agent state type.
   */
  readonly stateType: string;

  /**
   * Canonical storage key of the typed recipient.
   */
  readonly agentKey: string;

  /**
   * Original typed recipient from the persisted Inbox row.
   */
  readonly recipientId: Any;

  /**
   * Original Command or Event envelope.
   */
  readonly signal:
    | { readonly kind: "command"; readonly value: Command }
    | { readonly kind: "event"; readonly value: Event };

  /**
   * Actor selected from the original envelope.
   */
  readonly actor: ActorContext;

  /**
   * Original durable Inbox receipt and order.
   */
  readonly inbox: InboxMessage;

  /**
   * Every matching handler in actual execution order.
   */
  readonly handlers: readonly RegisteredHandlerMetadata[];

  /**
   * Application build revision supplied by Agent registration.
   */
  readonly codeRevision: string;

  /**
   * Descriptor digest of accepted generated schemas.
   */
  readonly schemaRevision: string;

  /**
   * Digest of effective AI policy and configuration.
   */
  readonly policyRevision: string;
}

interface AgentAdmissionAccess {
  /**
   * Copies the exact accepted recipient and selected bindings for durable admission.
   * @param input Routed Inbox work and registration revisions.
   * @returns Immutable accepted invocation content.
   */
  create(input: AgentAdmissionInput): AgentAcceptedInvocation;

  /**
   * Compares every persisted handler-binding field with current registration.
   * @param accepted Binding saved with the original invocation.
   * @param registered Current generated handler metadata.
   * @param ordinal Expected position in the accepted handler order.
   * @returns Whether current registration exactly matches the saved binding.
   */
  matchesHandler(
    accepted: AgentHandlerBinding,
    registered: RegisteredHandlerMetadata,
    ordinal: number,
  ): boolean;
}

/**
 * Materializes provider admission without running application handlers.
 */
export const AgentAdmission: AgentAdmissionAccess = Object.freeze({
  matchesHandler(
    accepted: AgentHandlerBinding,
    registered: RegisteredHandlerMetadata,
    ordinal: number,
  ): boolean {
    return equals(AgentHandlerBindingSchema, accepted, binding(registered, ordinal));
  },

  create(input: AgentAdmissionInput): AgentAcceptedInvocation {
    const sourceSignal = signalKey(input.signal);
    const bindings = input.handlers.map((handler, ordinal) => binding(handler, ordinal));
    if (bindings.length === 0) throw new TypeError("Agent admission requires a selected handler.");
    return create(AgentAcceptedInvocationSchema, {
      key: create(AgentInvocationKeySchema, {
        scope: create(AgentExecutionScopeSchema, {
          stateType: nonblank(input.stateType, "state type"),
          agentKey: nonblank(input.agentKey, "Agent key"),
        }),
        sourceSignal,
      }),
      recipientId: clone(AnySchema, input.recipientId),
      signal:
        input.signal.kind === "command"
          ? { case: "command", value: clone(CommandSchema, input.signal.value) }
          : { case: "event", value: clone(EventSchema, input.signal.value) },
      actor: clone(ActorContextSchema, input.actor),
      order: create(AgentInboxOrderSchema, {
        receivedAt: input.inbox.whenReceived,
        inboxVersion: input.inbox.version,
        sourceSignal,
      }),
      handlers: bindings,
      codeRevision: create(AgentCodeRevisionSchema, {
        value: nonblank(input.codeRevision, "code revision"),
      }),
      schemaRevision: create(AgentSchemaRevisionSchema, {
        value: nonblank(input.schemaRevision, "schema revision"),
      }),
      policyRevision: create(AgentPolicyRevisionSchema, {
        value: nonblank(input.policyRevision, "policy revision"),
      }),
    });
  },
});

/**
 * Requires the original typed signal identity before constructing its durable key.
 * @param signal Accepted Command or Event envelope.
 * @returns Typed source identity.
 */
function signalKey(signal: AgentAdmissionInput["signal"]): AgentSignalKey {
  if (signal.kind === "command") {
    const id = signal.value.id;
    if (id === undefined)
      throw new TypeError("Agent admission requires the original typed signal ID.");
    return create(AgentSignalKeySchema, { id: { case: "command", value: id } });
  }
  const id = signal.value.id;
  if (id === undefined)
    throw new TypeError("Agent admission requires the original typed signal ID.");
  return create(AgentSignalKeySchema, {
    id: { case: "event", value: id },
  });
}

/**
 * Converts one generated handler identity without reinterpreting its route.
 * @param registered Selected generated handler metadata.
 * @param ordinal Position within this accepted signal.
 * @returns Complete stored binding.
 */
function binding(registered: RegisteredHandlerMetadata, ordinal: number): AgentHandlerBinding {
  const handler = registered.handler;
  const kind =
    handler.kind === "command-assignment"
      ? AgentHandlerKind.AGENT_HANDLER_COMMAND_ASSIGNMENT
      : handler.kind === "command-reaction"
        ? AgentHandlerKind.AGENT_HANDLER_COMMAND_REACTION
        : handler.kind === "event-reaction"
          ? AgentHandlerKind.AGENT_HANDLER_EVENT_REACTION
          : undefined;
  if (kind === undefined) throw new TypeError("Agent admission selected an unsupported handler.");
  return create(AgentHandlerBindingSchema, {
    ordinal,
    receiverType: registered.entity.schema.typeName,
    methodName: handler.methodName,
    kind,
    signalType: handler.messageFullTypeName,
    origin:
      handler.origin === "external"
        ? AgentHandlerOrigin.AGENT_HANDLER_EXTERNAL
        : AgentHandlerOrigin.AGENT_HANDLER_DOMESTIC,
    parameterCount: handler.parameterCount,
    ...(handler.where === undefined
      ? {}
      : {
          whereEventField: handler.where.eventField,
          whereEquals: handler.where.equals,
        }),
  });
}

/**
 * Requires a nonblank serialized identity or revision.
 * @param value Text to validate.
 * @param label Diagnostic field name.
 * @returns Original checked text.
 */
function nonblank(value: string, label: string): string {
  if (value.trim() === "") throw new TypeError(`Agent admission requires ${label}.`);
  return value;
}
