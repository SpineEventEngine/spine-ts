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

import { clone, create, type Message } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AiModel, AiRegistry } from "@spine-event-engine/ai";
import { AnyMessages, Time, TypeUrls } from "@spine-event-engine/core";
import { ActorContextSchema, CommandIdSchema, MessageIdSchema } from "@spine-event-engine/proto";
import { ConversationIdSchema } from "@spine-event-engine/proto/agent";
import {
  AgentAcceptedInvocationSchema,
  AgentExecutionRecordSchema,
  AgentExecutionScopeSchema,
  AgentExecutionStartSchema,
  AgentInvocationKeySchema,
  AgentInvocationStatus,
  AgentSignalKeySchema,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import type { AgentExecutionStorage } from "@spine-event-engine/storage/provider";
import { describe, expect, it } from "vitest";
import { AgentAiRuntime } from "../../src/agent/agent-ai-runtime.js";
import { AgentExecutionSession } from "../../src/agent/agent-execution-session.js";
import { SupportReplyAgentIdSchema } from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import { DraftSupportReplySchema } from "../../test-fixtures/generated/entity-metadata/support_agent_commands_pb.js";
import {
  ProposedSupportReplySchema,
  SupportTicketFactsSchema,
  SupportTicketNumberSchema,
} from "../../test-fixtures/generated/entity-metadata/support_ai_types_pb.js";

const model = AiModel.define({
  name: "propose-support-reply",
  version: "v1",
  kind: "generation",
  input: SupportTicketFactsSchema,
  output: ProposedSupportReplySchema,
  instructions: "Propose a support reply.",
  outputMode: "prompt-and-validate",
  limits: {
    modelRequests: 1,
    toolCalls: 0,
    deadlineMs: 1_000,
    maxInputBytes: 2_000,
    maxOutputBytes: 2_000,
    maxOutputTokens: 100,
  },
});

describe("Agent named call sequencing", () => {
  it("rejects overlap before a second operation is admitted", async () => {
    const ticket = create(SupportReplyAgentIdSchema, { ticketNumber: "T-1" });
    const key = create(AgentInvocationKeySchema, {
      scope: create(AgentExecutionScopeSchema, {
        stateType: "support.SupportAgent",
        agentKey: "T-1",
      }),
      sourceSignal: create(AgentSignalKeySchema, {
        id: { case: "command", value: create(CommandIdSchema, { uuid: "source-1" }) },
      }),
    });
    let stored = create(AgentExecutionRecordSchema, {
      accepted: create(AgentAcceptedInvocationSchema, { key }),
      status: AgentInvocationStatus.AGENT_INVOCATION_ACTIVE,
      claimToken: "claim",
      started: create(AgentExecutionStartSchema, {
        deadline: create(TimestampSchema, { seconds: Time.currentTime().seconds + 60n }),
      }),
    });
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const port: Pick<
      AgentExecutionStorage<unknown, Message>,
      "capacity" | "update" | "renew" | "read" | "complete" | "markDelivered"
    > = {
      capacity: {},
      update: async ({ next }) => {
        await blocked;
        stored = clone(AgentExecutionRecordSchema, next);
      },
      renew: () => Promise.resolve(false),
      read: () => Promise.resolve(clone(AgentExecutionRecordSchema, stored)),
      complete: () => Promise.resolve(),
      markDelivered: () => Promise.resolve(),
    };
    const session = new AgentExecutionSession(port, stored, "claim");
    const reference = create(MessageIdSchema, {
      id: AnyMessages.pack(SupportReplyAgentIdSchema, ticket),
      typeUrl: TypeUrls.derive(SupportReplyAgentIdSchema),
    });
    const source = create(MessageIdSchema, {
      id: AnyMessages.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "source-1" })),
      typeUrl: TypeUrls.derive(DraftSupportReplySchema),
    });
    expect(source.typeUrl).toBe(TypeUrls.derive(DraftSupportReplySchema));
    expect(source.id?.typeUrl).not.toBe(reference.id?.typeUrl);
    const runtime = new AgentAiRuntime(
      AiRegistry.create({
        defaultModels: {},
        invocationLimits: {
          operations: 2,
          modelRequests: 2,
          toolCalls: 0,
          recordedReads: 0,
          deadlineMs: 1_000,
          totalInputBytes: 4_000,
          totalOutputBytes: 4_000,
          maxRecoveryBytes: 8_000,
        },
        concurrentOperations: 1,
        queuedOperations: 0,
      }),
      { models: [model] },
      {
        actor: create(ActorContextSchema),
        tenant: { kind: "single-tenant" },
        agent: reference,
        source,
      },
      session,
      0,
      undefined,
    );
    const input = create(SupportTicketFactsSchema, {
      ticketNumber: create(SupportTicketNumberSchema, { value: "T-1" }),
      customerQuestion: "Where is my order?",
    });
    const conversation = create(ConversationIdSchema, { value: "ticket-1" });
    const first = runtime.invoke(model, { call: "first", conversation, input });
    const second = runtime.invoke(model, { call: "second", conversation, input });
    await expect(second).rejects.toThrow("sequential");
    expect(() => {
      runtime.finish();
    }).toThrow("pending");
    runtime.close();
    await expect(runtime.invoke(model, { call: "escaped", conversation, input })).rejects.toThrow(
      "closed",
    );
    if (release !== undefined) release();
    await expect(first).rejects.toThrow("closed");
    expect(stored.journal.filter((entry) => entry.evidence.case === "operation")).toHaveLength(1);
  });
});
