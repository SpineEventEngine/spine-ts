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

import { create, toBinary } from "@bufbuild/protobuf";
import { AnySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AnyPacker, SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import { CommandIdSchema } from "@spine-event-engine/proto";
import {
  AgentModelSelectionChangedSchema,
  AiConnectionIdentitySchema,
  AiModelKind,
  AiOperationIdSchema,
  ConversationIdSchema,
  ModelRefSchema,
} from "@spine-event-engine/proto/agent";
import { describe, expect, it } from "vitest";
import { AgentLiveInteractionEvents } from "../../src/agent/agent-live-interaction-events.js";
import type { AgentLiveInvocation } from "../../src/agent/agent-live-inputs.js";
import { SignalMetadata } from "../../src/runtime/signal-metadata.js";
import { DraftSupportReplySchema } from "../../test-fixtures/generated/entity-metadata/support_agent_commands_pb.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
} from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";

const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-live" });
const recipient = AnyPacker.pack(SupportReplyAgentIdSchema, id);
const metadata = new SignalMetadata({
  timeProvider: { currentTime: () => create(TimestampSchema, { seconds: 1_800_100_000n }) },
});
const source = SignalEnvelopes.command({
  schema: DraftSupportReplySchema,
  message: create(DraftSupportReplySchema, { agent: id, question: "Status?" }),
  context: metadata.commandContext({}),
});
const invocation: AgentLiveInvocation = {
  source: { case: "command", value: source },
  recipientId: recipient,
  stateType: SupportReplyAgentStateSchema.typeName,
};
const operation = {
  operation: create(AiOperationIdSchema, { value: "live-operation" }),
  conversation: create(ConversationIdSchema, { value: "live-conversation" }),
};
const selected = {
  kind: AiModelKind.GENERATION as const,
  model: create(ModelRefSchema, { name: { value: "support-model" }, revision: { value: "v1" } }),
  connection: create(AiConnectionIdentitySchema),
};

describe("live Agent interaction facts", () => {
  it("preserves original typed source and recipient without an execution record", () => {
    const sourceBytes = toBinary(CommandIdSchema, source.id ?? create(CommandIdSchema));
    const recipientBytes = toBinary(AnySchema, recipient);
    const reference = AgentLiveInteractionEvents.operationRef(
      invocation,
      operation,
      SupportReplyAgentStateSchema,
      selected,
    );
    expect(reference.agent?.typeUrl).toBe(TypeUrls.derive(SupportReplyAgentStateSchema));
    expect(reference.sourceSignal?.typeUrl).toBe(TypeUrls.derive(DraftSupportReplySchema));
    expect(reference.sourceSignal?.id?.typeUrl).toBe(TypeUrls.derive(CommandIdSchema));
    expect(reference.operation).toEqual(operation.operation);
    expect(reference.conversation).toEqual(operation.conversation);
    expect(toBinary(CommandIdSchema, source.id ?? create(CommandIdSchema))).toEqual(sourceBytes);
    expect(toBinary(AnySchema, recipient)).toEqual(recipientBytes);
  });

  it("saves one typed System Event with original causal context", () => {
    const reference = AgentLiveInteractionEvents.operationRef(
      invocation,
      operation,
      SupportReplyAgentStateSchema,
      selected,
    );
    const payload = create(AgentModelSelectionChangedSchema, {
      agent: reference.agent,
      sourceSignal: reference.sourceSignal,
      kind: AiModelKind.GENERATION,
      selectedModel: selected.model,
      changedAt: create(TimestampSchema, { seconds: 1_800_100_000n }),
    });
    const event = AgentLiveInteractionEvents.envelope(
      invocation,
      metadata,
      recipient,
      AgentModelSelectionChangedSchema,
      payload,
    );
    expect(event.context?.producerId).toEqual(recipient);
    expect(event.context?.origin.case).toBe("pastMessage");
    if (event.message === undefined) throw new Error("Expected a typed System Event.");
    expect(AnyPacker.unpack(event.message, AgentModelSelectionChangedSchema)).toEqual(payload);
    expect(() =>
      AgentLiveInteractionEvents.envelope(
        invocation,
        metadata,
        create(AnySchema),
        AgentModelSelectionChangedSchema,
        payload,
      ),
    ).toThrow(/producer/);
  });
});
