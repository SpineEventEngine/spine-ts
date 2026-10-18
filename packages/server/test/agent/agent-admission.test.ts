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
import { AiModel, AiRegistry } from "@spine-event-engine/ai";
import { AnyMessages, SignalEnvelopes } from "@spine-event-engine/core";
import { ActorContextSchema, CommandContextSchema } from "@spine-event-engine/proto";
import { AgentHandlerKind } from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { describe, expect, it } from "vitest";

import { AgentAdmission } from "../../src/agent/agent-admission.js";
import { AgentRevisions } from "../../src/agent/agent-revisions.js";
import { Agent } from "../../src/entity/entity.js";
import { EntityHandlers, HandlerMetadataRegistry } from "../../src/handler/handler-metadata.js";
import { createMessage } from "../delivery/inbox-message-fixture.js";
import {
  DraftSupportReplySchema,
  type DraftSupportReply,
} from "../../test-fixtures/generated/entity-metadata/support_agent_commands_pb.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
  type SupportReplyAgentId,
} from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import {
  ProposedSupportReplySchema,
  SupportTicketFactsSchema,
} from "../../test-fixtures/generated/entity-metadata/support_ai_types_pb.js";

class SupportAgent extends Agent<SupportReplyAgentId, typeof SupportReplyAgentStateSchema> {
  draft(command: DraftSupportReply): void {
    void command;
  }
}

describe("Agent durable admission", () => {
  it("retains the original envelope, recipient, full Inbox order and selected handler", () => {
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-91" });
    const command = SignalEnvelopes.command({
      schema: DraftSupportReplySchema,
      message: create(DraftSupportReplySchema, { agent: id, question: "Where is my order?" }),
      context: create(CommandContextSchema),
    });
    const recipientId = AnyMessages.pack(SupportReplyAgentIdSchema, id);
    const actor = create(ActorContextSchema);
    const inbox = createMessage("inbox-1", command.id?.uuid ?? "", 4_294_967_296n);
    const handlers = new HandlerMetadataRegistry([
      EntityHandlers.define(SupportAgent, SupportReplyAgentStateSchema, (builder) => [
        builder.assign(DraftSupportReplySchema, "draft"),
      ]),
    ]).listHandlers();

    const accepted = AgentAdmission.create({
      stateType: SupportReplyAgentStateSchema.typeName,
      agentKey: id.ticketNumber,
      recipientId,
      signal: { kind: "command", value: command },
      actor,
      inbox,
      handlers,
      codeRevision: "support-v1",
      schemaRevision: "schema-v1",
      policyRevision: "policy-v1",
    });

    expect(accepted.order?.inboxVersion).toBe(4_294_967_296n);
    expect(accepted.key?.sourceSignal?.id.case).toBe("command");
    expect(accepted.signal.case).toBe("command");
    expect(accepted.recipientId).toEqual(recipientId);
    expect(accepted.handlers).toMatchObject([
      {
        ordinal: 0,
        receiverType: SupportReplyAgentStateSchema.typeName,
        methodName: "draft",
        kind: AgentHandlerKind.AGENT_HANDLER_COMMAND_ASSIGNMENT,
        signalType: DraftSupportReplySchema.typeName,
      },
    ]);
    const selected = handlers[0];
    const saved = accepted.handlers[0];
    if (selected === undefined || saved === undefined)
      throw new Error("Expected selected Agent handler.");
    expect(AgentAdmission.matchesHandler(saved, selected, 0)).toBe(true);
    expect(AgentAdmission.matchesHandler({ ...saved, parameterCount: 2 }, selected, 0)).toBe(false);
    expect(AgentAdmission.matchesHandler({ ...saved, ordinal: 1 }, selected, 0)).toBe(false);
  });

  it("does not admit an unhandled signal", () => {
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-92" });
    const command = SignalEnvelopes.command({
      schema: DraftSupportReplySchema,
      message: create(DraftSupportReplySchema, { agent: id, question: "Help" }),
      context: create(CommandContextSchema),
    });
    expect(() =>
      AgentAdmission.create({
        stateType: SupportReplyAgentStateSchema.typeName,
        agentKey: id.ticketNumber,
        recipientId: AnyMessages.pack(SupportReplyAgentIdSchema, id),
        signal: { kind: "command", value: command },
        actor: create(ActorContextSchema),
        inbox: createMessage("inbox-2", command.id?.uuid ?? "", 1n),
        handlers: [],
        codeRevision: "support-v1",
        schemaRevision: "schema-v1",
        policyRevision: "policy-v1",
      }),
    ).toThrow(/selected handler/);
  });

  it("changes policy revision when a capability instruction changes", () => {
    const ai = AiRegistry.create({
      defaultModels: {},
      invocationLimits: {
        operations: 1,
        modelRequests: 1,
        toolCalls: 0,
        recordedReads: 1,
        deadlineMs: 1000,
        totalInputBytes: 4000,
        totalOutputBytes: 4000,
        maxRecoveryBytes: 4000,
      },
      concurrentOperations: 1,
      queuedOperations: 0,
    });
    const capability = (instructions: string) =>
      AiModel.define({
        name: "draft-support-reply",
        version: "v1",
        kind: "generation",
        input: SupportTicketFactsSchema,
        output: ProposedSupportReplySchema,
        instructions,
        outputMode: "prompt-and-validate",
        limits: {
          modelRequests: 1,
          toolCalls: 0,
          deadlineMs: 1000,
          maxInputBytes: 4000,
          maxOutputBytes: 4000,
          maxOutputTokens: 100,
        },
      });
    const before = AgentRevisions.atAdmission(SupportReplyAgentStateSchema, [], ai, {
      models: [capability("Ask for a concise reply")],
    });
    const after = AgentRevisions.atAdmission(SupportReplyAgentStateSchema, [], ai, {
      models: [capability("Ask for a detailed reply")],
    });
    expect(after.schema).toBe(before.schema);
    expect(after.policy).not.toBe(before.policy);
  });
});
