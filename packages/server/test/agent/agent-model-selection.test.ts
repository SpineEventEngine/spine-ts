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
import { AiModel, AiRegistry, ModelRef } from "@spine-event-engine/ai";
import { createBackendRegistration } from "@spine-event-engine/ai/spi/adapter";
import { AnyMessages, Time, TypeUrls } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandSchema,
  EventContextSchema,
  EventSchema,
  RejectionEventContextSchema,
} from "@spine-event-engine/proto";
import * as Records from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { AiModelKind, ModelPreferenceSchema } from "@spine-event-engine/proto/agent";
import { describe, expect, it, vi } from "vitest";
import { AgentModelSelection } from "../../src/agent/agent-model-selection.js";
import { ProjectStateSchema } from "../../test-fixtures/generated/entity-metadata/project_states_pb.js";
import { ProjectIdSchema } from "../../test-fixtures/generated/repository-routing/project_identifiers_pb.js";
import { AssignReviewTaskSchema } from "../../test-fixtures/generated/handler-registry/commands_pb.js";
import { ReviewTaskAssignedSchema } from "../../test-fixtures/generated/handler-registry/events_pb.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
} from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import { DraftSupportReplySchema } from "../../test-fixtures/generated/entity-metadata/support_agent_commands_pb.js";
import {
  ProposedSupportReplySchema,
  SupportRoutingResultSchema,
  SupportTicketFactsSchema,
} from "../../test-fixtures/generated/entity-metadata/support_ai_types_pb.js";

const proposal = AiModel.define({
  name: "support-model-selection",
  version: "v1",
  kind: "generation",
  input: SupportTicketFactsSchema,
  output: ProposedSupportReplySchema,
  instructions: "Prepare a support reply.",
  outputMode: "prompt-and-validate",
  limits: {
    modelRequests: 1,
    toolCalls: 0,
    deadlineMs: 1_000,
    maxInputBytes: 1_000,
    maxOutputBytes: 1_000,
    maxOutputTokens: 100,
  },
});

const routing = AiModel.define({
  name: "route-support-ticket",
  version: "v1",
  kind: "decision",
  input: SupportTicketFactsSchema,
  output: SupportRoutingResultSchema,
  limits: {
    modelRequests: 1,
    toolCalls: 0,
    deadlineMs: 1_000,
    maxInputBytes: 1_000,
    maxOutputBytes: 1_000,
  },
  questions: { safe: { type: "boolean", instructions: "Can support handle this ticket?" } },
  mapping: {
    version: "v1",
    toMessage: () => create(SupportRoutingResultSchema, { queue: { value: "support" } }),
  },
});

function supportScope() {
  const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-selection" });
  const command = create(CommandSchema, {
    id: { uuid: "selection-command" },
    message: AnyMessages.pack(
      DraftSupportReplySchema,
      create(DraftSupportReplySchema, { agent: id, question: "Where is my order?" }),
    ),
  });
  return AgentModelSelection.scope(
    create(Records.AgentAcceptedInvocationSchema, {
      recipientId: AnyMessages.pack(SupportReplyAgentIdSchema, id),
      actor: create(ActorContextSchema),
      signal: { case: "command", value: command },
    }),
    SupportReplyAgentStateSchema,
  );
}

function selectionRegistry(
  authorize: (model: string) => boolean | Promise<boolean>,
  resolveIdentity: (model: string) => Promise<void> | void = () => undefined,
) {
  const primary = ModelRef.of("support-primary", "v1");
  const preferred = ModelRef.of("support-preferred", "v1");
  const registry = AiRegistry.create({
    defaultModels: { generation: primary },
    invocationLimits: {
      operations: 1,
      modelRequests: 1,
      toolCalls: 0,
      recordedReads: 0,
      deadlineMs: 1_000,
      totalInputBytes: 4_000,
      totalOutputBytes: 4_000,
      maxRecoveryBytes: 8_000,
    },
    concurrentOperations: 1,
    queuedOperations: 0,
  });
  for (const [ref, name] of [
    [primary, "primary"],
    [preferred, "preferred"],
  ] as const)
    registry.register(
      createBackendRegistration({
        ref,
        kind: "generation",
        supports: () => true,
        resolveIdentity: async () => {
          await resolveIdentity(name);
          return { provider: "fixture", account: "support", endpoint: "memory", model: name };
        },
        authorizeUse: () => authorize(name),
        connect: (_scope, identity) => ({ model: {}, identity }),
        execute: () => Promise.reject(new Error("Selection must not dispatch a model request.")),
      }),
    );
  return { registry, primary, preferred };
}

describe("Agent model authorization scope", () => {
  it("uses the accepted support Command and claim-time preference before authorizing a deployment", async () => {
    const authorized = vi.fn(() => true);
    const { registry, preferred } = selectionRegistry(authorized);
    const selected = await AgentModelSelection.select(
      registry,
      { models: [proposal] },
      supportScope(),
      [
        create(ModelPreferenceSchema, {
          kind: AiModelKind.GENERATION,
          selection: { case: "model", value: preferred },
        }),
      ],
      new AbortController().signal,
      Time.currentTimeMillis() + 1_000,
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]?.model).toEqual(preferred);
    expect(selected[0]?.connection?.model?.value).toBe("preferred");
    expect(authorized).toHaveBeenCalledExactlyOnceWith("preferred");
  });

  it("rejects denied model use before a connection or model request", async () => {
    const authorized = vi.fn(() => false);
    const { registry } = selectionRegistry(authorized);
    await expect(
      AgentModelSelection.select(
        registry,
        { models: [proposal] },
        supportScope(),
        [],
        new AbortController().signal,
        Time.currentTimeMillis() + 1_000,
      ),
    ).rejects.toThrow("unauthorized");
    expect(authorized).toHaveBeenCalledOnce();
  });

  it("selects both configured kinds and honors the repository default before the context default", async () => {
    const { registry, preferred } = selectionRegistry(() => true);
    const decisionRef = ModelRef.of("support-decision", "v1");
    registry.register(
      createBackendRegistration({
        ref: decisionRef,
        kind: "decision",
        supports: () => true,
        resolveIdentity: () => ({
          provider: "fixture",
          account: "support",
          endpoint: "memory",
          model: "decision",
        }),
        authorizeUse: () => true,
        connect: (_scope, identity) => ({ model: {}, identity }),
        execute: () => Promise.reject(new Error("Selection must not dispatch a model request.")),
      }),
    );
    const selected = await AgentModelSelection.select(
      registry,
      {
        models: [proposal, routing],
        defaultModels: { generation: preferred, decision: decisionRef },
      },
      supportScope(),
      [],
      new AbortController().signal,
      Time.currentTimeMillis() + 1_000,
    );
    expect(selected.map((item) => item.kind)).toEqual([
      AiModelKind.GENERATION,
      AiModelKind.DECISION,
    ]);
    expect(selected.map((item) => item.model)).toEqual([preferred, decisionRef]);
  });

  it("rejects an expired accepted selection without authorizing its deployment", async () => {
    const authorized = vi.fn(() => true);
    const { registry } = selectionRegistry(authorized);
    await expect(
      AgentModelSelection.select(
        registry,
        { models: [proposal] },
        supportScope(),
        [],
        new AbortController().signal,
        Time.currentTimeMillis() - 1,
      ),
    ).rejects.toThrow("expired");
    expect(authorized).not.toHaveBeenCalled();
  });

  it("cancels a pending identity hook without authorizing late callback work", async () => {
    const authorized = vi.fn(() => true);
    const controller = new AbortController();
    const { registry } = selectionRegistry(authorized, () => new Promise<void>(() => undefined));
    const pending = AgentModelSelection.select(
      registry,
      { models: [proposal] },
      supportScope(),
      [],
      controller.signal,
      Time.currentTimeMillis() + 1_000,
    );
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(authorized).not.toHaveBeenCalled();
  });

  it("identifies the actual handled Command and Event types", () => {
    const recipientId = AnyMessages.pack(
      ProjectIdSchema,
      create(ProjectIdSchema, { value: "project-1" }),
    );
    const actor = create(ActorContextSchema);
    const command = create(CommandSchema, {
      id: { uuid: "command-1" },
      message: AnyMessages.pack(
        AssignReviewTaskSchema,
        create(AssignReviewTaskSchema, { id: "project-1" }),
      ),
    });
    const event = create(EventSchema, {
      id: { value: "event-1" },
      message: AnyMessages.pack(
        ReviewTaskAssignedSchema,
        create(ReviewTaskAssignedSchema, { id: "project-1" }),
      ),
    });
    const accepted = (signal: "command" | "event") =>
      create(Records.AgentAcceptedInvocationSchema, {
        recipientId,
        actor,
        signal:
          signal === "command"
            ? { case: "command", value: command }
            : { case: "event", value: event },
      });
    expect(AgentModelSelection.scope(accepted("command"), ProjectStateSchema).source.typeUrl).toBe(
      TypeUrls.derive(AssignReviewTaskSchema),
    );
    expect(AgentModelSelection.scope(accepted("event"), ProjectStateSchema).source.typeUrl).toBe(
      TypeUrls.derive(ReviewTaskAssignedSchema),
    );
    const rejection = accepted("event");
    if (rejection.signal.case !== "event") throw new Error("Expected Event signal.");
    rejection.signal.value.context = create(EventContextSchema, {
      rejection: create(RejectionEventContextSchema, { command }),
    });
    expect(AgentModelSelection.scope(rejection, ProjectStateSchema).source.typeUrl).toBe(
      TypeUrls.derive(ReviewTaskAssignedSchema),
    );
    const incomplete = accepted("command");
    if (incomplete.signal.case !== "command") throw new Error("Expected Command signal.");
    incomplete.signal.value.message = undefined;
    expect(() => AgentModelSelection.scope(incomplete, ProjectStateSchema)).toThrow("payload type");
  });
});
