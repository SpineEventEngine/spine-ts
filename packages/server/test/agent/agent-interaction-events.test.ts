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

import { clone, create, toBinary } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AnyMessages, SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandIdSchema,
  CommandSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  TenantIdSchema,
  UserIdSchema,
  type Command,
  type Event,
} from "@spine-event-engine/proto";
import { AgentModelSelectionChangedSchema, AiModelKind } from "@spine-event-engine/proto/agent";
import {
  AgentAcceptedInvocationSchema,
  AgentNamedOperationSchema,
  AgentSelectedModelSchema,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { describe, expect, it } from "vitest";
import { AgentInteractionEvents } from "../../src/agent/agent-interaction-events.js";
import { SignalMetadata } from "../../src/runtime/signal-metadata.js";
import { DraftSupportReplySchema } from "../../test-fixtures/generated/entity-metadata/support_agent_commands_pb.js";
import { SupportTicketUpdatedSchema } from "../../test-fixtures/generated/entity-metadata/support_agent_events_pb.js";
import * as Rejections from "../../test-fixtures/generated/entity-metadata/support_agent_rejections_pb.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
} from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";

const instant = create(TimestampSchema, { seconds: 1_800_000_000n, nanos: 123_000_000 });
const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-47" });
const recipient = AnyMessages.pack(SupportReplyAgentIdSchema, id);
const actor = create(ActorContextSchema, {
  actor: create(UserIdSchema, { value: "support-user" }),
  tenantId: create(TenantIdSchema, { kind: { case: "value", value: "tenant-1" } }),
});
const metadata = new SignalMetadata({ timeProvider: { currentTime: () => instant } });
const command = SignalEnvelopes.command({
  schema: DraftSupportReplySchema,
  message: create(DraftSupportReplySchema, { agent: id, question: "Where is my order?" }),
  context: metadata.commandContext({ actorContext: actor }),
});
const updated = SignalEnvelopes.event({
  schema: SupportTicketUpdatedSchema,
  message: create(SupportTicketUpdatedSchema, { agent: id, question: "Any news?" }),
  context: create(EventContextSchema, {
    timestamp: instant,
    origin: { case: "importContext", value: actor },
    producerId: recipient,
  }),
});
const rejection = SignalEnvelopes.event({
  schema: Rejections.SupportReplyUnavailableSchema,
  message: create(Rejections.SupportReplyUnavailableSchema, { agent: id }),
  context: create(EventContextSchema, {
    timestamp: instant,
    origin: { case: "importContext", value: actor },
    producerId: recipient,
    rejection: { command },
  }),
});
const selected = create(AgentSelectedModelSchema, {
  kind: AiModelKind.GENERATION,
  model: { name: { value: "support-model" }, revision: { value: "v1" } },
});
const operation = create(AgentNamedOperationSchema, {
  callName: "draft",
  operation: { value: "operation-1" },
  conversation: { value: "conversation-1" },
});

/**
 * Copies an original support signal into the relevant accepted invocation facts.
 * @param signal Typed Command or Event envelope.
 * @returns Accepted invocation with the same source identity.
 */
const acceptedFor = (
  signal: { kind: "command"; value: Command } | { kind: "event"; value: Event },
) => {
  const copied =
    signal.kind === "command"
      ? { case: "command" as const, value: clone(CommandSchema, signal.value) }
      : { case: "event" as const, value: clone(EventSchema, signal.value) };
  if (!copied.value.id) throw new Error("Fixture source requires a typed ID");
  const sourceSignal = {
    id:
      copied.case === "command"
        ? { case: "command" as const, value: copied.value.id }
        : { case: "event" as const, value: copied.value.id },
  };
  return create(AgentAcceptedInvocationSchema, {
    key: {
      scope: { stateType: SupportReplyAgentStateSchema.typeName, agentKey: id.ticketNumber },
      sourceSignal,
    },
    recipientId: recipient,
    signal: copied,
    actor,
    order: { receivedAt: instant, inboxVersion: 1n, sourceSignal },
    codeRevision: { value: "support-v1" },
    schemaRevision: { value: "schema-v1" },
    policyRevision: { value: "policy-v1" },
  });
};

describe("Agent interaction event facts", () => {
  it("references typed Agent, source Command, selected model and conversation without mutation", () => {
    const accepted = acceptedFor({ kind: "command", value: command });
    const before = toBinary(AgentAcceptedInvocationSchema, accepted);
    const ref = AgentInteractionEvents.operationRef(
      accepted,
      operation,
      SupportReplyAgentStateSchema,
      selected,
    );
    expect(ref.agent?.typeUrl).toBe(TypeUrls.derive(SupportReplyAgentStateSchema));
    if (!ref.agent?.id || !ref.sourceSignal?.id) throw new Error("Expected typed references");
    expect(AnyMessages.unpack(ref.agent.id, SupportReplyAgentIdSchema)).toEqual(id);
    expect(ref.sourceSignal.typeUrl).toBe(TypeUrls.derive(DraftSupportReplySchema));
    expect(AnyMessages.unpack(ref.sourceSignal.id, CommandIdSchema)).toEqual(command.id);
    expect(ref.operation?.value).toBe("operation-1");
    expect(ref.conversation?.value).toBe("conversation-1");
    expect(ref.model).toEqual(selected.model);
    expect(ref.kind).toBe(AiModelKind.GENERATION);
    expect(toBinary(AgentAcceptedInvocationSchema, accepted)).toEqual(before);
  });

  it.each([
    ["event", updated, SupportTicketUpdatedSchema],
    ["rejection", rejection, Rejections.SupportReplyUnavailableSchema],
  ] as const)(
    "references the original %s Event ID and concrete payload",
    (_name, source, schema) => {
      const ref = AgentInteractionEvents.operationRef(
        acceptedFor({ kind: "event", value: source }),
        operation,
        SupportReplyAgentStateSchema,
        selected,
      );
      expect(ref.sourceSignal?.typeUrl).toBe(TypeUrls.derive(schema));
      if (!ref.sourceSignal?.id) throw new Error("Expected typed source ID");
      expect(AnyMessages.unpack(ref.sourceSignal.id, EventIdSchema)).toEqual(source.id);
    },
  );

  it.each([
    { kind: "command" as const, value: command },
    { kind: "event" as const, value: updated },
    { kind: "event" as const, value: rejection },
  ])("envelopes a System Event from a $kind with Time, producer and source context", (signal) => {
    const accepted = acceptedFor(signal);
    const ref = AgentInteractionEvents.operationRef(
      accepted,
      operation,
      SupportReplyAgentStateSchema,
      selected,
    );
    const payload = create(AgentModelSelectionChangedSchema, {
      agent: ref.agent,
      sourceSignal: ref.sourceSignal,
      kind: ref.kind,
      selectedModel: ref.model,
      changedAt: instant,
    });
    const before = toBinary(AgentAcceptedInvocationSchema, accepted);
    const event = AgentInteractionEvents.envelope(
      accepted,
      metadata,
      recipient,
      AgentModelSelectionChangedSchema,
      payload,
    );
    expect(event.id?.value).toMatch(/^[0-9a-f-]{36}$/i);
    if (!event.message) throw new Error("Expected typed System-event payload");
    expect(AnyMessages.unpack(event.message, AgentModelSelectionChangedSchema)).toEqual(payload);
    expect(event.context?.producerId).toEqual(recipient);
    expect(event.context?.timestamp).toEqual(instant);
    expect(event.context?.origin.case).toBe("pastMessage");
    if (event.context?.origin.case !== "pastMessage") throw new Error("Expected source origin");
    expect(event.context.origin.value.message?.typeUrl).toBe(signal.value.message?.typeUrl);
    expect(event.context.origin.value.actorContext).toEqual(actor);
    expect(toBinary(AgentAcceptedInvocationSchema, accepted)).toEqual(before);
  });

  it("rejects missing source IDs, payload types, state mismatch and absent selected model", () => {
    const missingId = acceptedFor({ kind: "command", value: command });
    if (missingId.signal.case !== "command") throw new Error("Expected Command");
    missingId.signal.value.id = undefined;
    expect(() =>
      AgentInteractionEvents.operationRef(
        missingId,
        operation,
        SupportReplyAgentStateSchema,
        selected,
      ),
    ).toThrow(/source.*ID/i);
    const missingType = acceptedFor({ kind: "event", value: updated });
    if (missingType.signal.case !== "event") throw new Error("Expected Event");
    missingType.signal.value.message = undefined;
    expect(() =>
      AgentInteractionEvents.operationRef(
        missingType,
        operation,
        SupportReplyAgentStateSchema,
        selected,
      ),
    ).toThrow(/payload type/i);
    const missingEventId = acceptedFor({ kind: "event", value: updated });
    if (missingEventId.signal.case !== "event") throw new Error("Expected Event");
    missingEventId.signal.value.id = undefined;
    expect(() =>
      AgentInteractionEvents.operationRef(
        missingEventId,
        operation,
        SupportReplyAgentStateSchema,
        selected,
      ),
    ).toThrow(/source Event ID/i);
    const missingCommandType = acceptedFor({ kind: "command", value: command });
    if (missingCommandType.signal.case !== "command") throw new Error("Expected Command");
    missingCommandType.signal.value.message = undefined;
    expect(() =>
      AgentInteractionEvents.operationRef(
        missingCommandType,
        operation,
        SupportReplyAgentStateSchema,
        selected,
      ),
    ).toThrow(/payload type/i);
    expect(() =>
      AgentInteractionEvents.operationRef(
        acceptedFor({ kind: "command", value: command }),
        operation,
        SupportReplyAgentIdSchema,
        selected,
      ),
    ).toThrow(/state type/i);
    expect(() =>
      AgentInteractionEvents.operationRef(
        acceptedFor({ kind: "command", value: command }),
        operation,
        SupportReplyAgentStateSchema,
        create(AgentSelectedModelSchema),
      ),
    ).toThrow(/selected model/i);
    expect(() =>
      AgentInteractionEvents.operationRef(
        acceptedFor({ kind: "command", value: command }),
        operation,
        SupportReplyAgentStateSchema,
        create(AgentSelectedModelSchema, {
          kind: AiModelKind.AI_MODEL_KIND_UNSPECIFIED,
          model: selected.model,
        }),
      ),
    ).toThrow(/selected model/i);
  });

  it("rejects untyped Agent IDs and incomplete operation correlation", () => {
    const accepted = acceptedFor({ kind: "command", value: command });
    accepted.recipientId = undefined;
    expect(() =>
      AgentInteractionEvents.operationRef(
        accepted,
        operation,
        SupportReplyAgentStateSchema,
        selected,
      ),
    ).toThrow(/typed Agent ID/i);
    accepted.recipientId = recipient;
    const incomplete = create(AgentNamedOperationSchema, { conversation: operation.conversation });
    expect(() =>
      AgentInteractionEvents.operationRef(
        accepted,
        incomplete,
        SupportReplyAgentStateSchema,
        selected,
      ),
    ).toThrow(/operation and conversation/i);
  });

  it("rejects a changed producer and missing accepted signal before event construction", () => {
    const accepted = acceptedFor({ kind: "command", value: command });
    const payload = create(AgentModelSelectionChangedSchema);
    const otherAgent = AnyMessages.pack(
      SupportReplyAgentIdSchema,
      create(SupportReplyAgentIdSchema, { ticketNumber: "T-48" }),
    );
    expect(() =>
      AgentInteractionEvents.envelope(
        accepted,
        metadata,
        otherAgent,
        AgentModelSelectionChangedSchema,
        payload,
      ),
    ).toThrow(/producer differs/i);
    accepted.signal = { case: undefined };
    expect(() =>
      AgentInteractionEvents.envelope(
        accepted,
        metadata,
        recipient,
        AgentModelSelectionChangedSchema,
        payload,
      ),
    ).toThrow(/source signal/i);
  });
});
