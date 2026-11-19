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
import { AiModel, ModelRef } from "@spine-event-engine/ai";
import { AnyPacker, Time, TypeUrls } from "@spine-event-engine/core";
import { InternetDomainSchema, TenantIdSchema, VersionSchema } from "@spine-event-engine/proto";
import {
  AgentIdSchema,
  AiModelKind,
  AiOperationIdSchema,
  CallModelSchema,
  ConversationIdSchema,
  type ModelCall,
} from "@spine-event-engine/proto/agent";
import { describe, expect, it } from "vitest";
import { ModelCommandBindings, ModelCommandSession } from "../../src/agent/model-commands.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
} from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import {
  ProposedSupportReplySchema,
  SupportRoutingResultSchema,
  SupportTicketFactsSchema,
  SupportTicketNumberSchema,
} from "../../test-fixtures/generated/entity-metadata/support_ai_types_pb.js";

const definition = AiModel.define({
  name: "prepare-support-reply",
  version: "v1",
  kind: "generation",
  input: SupportTicketFactsSchema,
  output: ProposedSupportReplySchema,
  instructions: "Prepare a support reply.",
  outputMode: "prompt-and-validate",
  limits: {
    modelRequests: 1,
    toolCalls: 0,
    maxInputBytes: 1000,
    maxOutputBytes: 1000,
    maxOutputTokens: 100,
  },
});

const input = create(SupportTicketFactsSchema, {
  ticketNumber: create(SupportTicketNumberSchema, { value: "T-session" }),
  customerQuestion: "Where is my parcel?",
});
const conversation = create(ConversationIdSchema, { value: "support-session" });
const model = ModelRef.of("support-primary", "v1");

const decision = AiModel.define({
  name: "route-support-ticket",
  version: "v1",
  kind: "decision",
  input: SupportTicketFactsSchema,
  output: SupportRoutingResultSchema,
  limits: {
    modelRequests: 1,
    toolCalls: 0,
    maxInputBytes: 1000,
    maxOutputBytes: 1000,
  },
  questions: { safe: { type: "boolean", instructions: "Can support handle this ticket?" } },
  mapping: {
    version: "v1",
    toMessage: () => create(SupportRoutingResultSchema, { queue: { value: "support" } }),
  },
});

/**
 * Creates one session from a genuine Support Agent identity and model definition.
 *
 * @param selected Whether a deployment has been selected.
 * @param pending Previously committed calls.
 * @returns Handler-bound model Command capability.
 */
function session(selected = true, pending: readonly ModelCall[] = []) {
  const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-session" });
  return new ModelCommandSession({
    models: [definition],
    selected: selected
      ? new Map([[AiModelKind.GENERATION, { kind: AiModelKind.GENERATION, model }]])
      : new Map(),
    agent: create(AgentIdSchema, {
      stateTypeUrl: TypeUrls.derive(SupportReplyAgentStateSchema),
      entityId: AnyPacker.pack(SupportReplyAgentIdSchema, id),
    }),
    replyContext: "SupportSession",
    pending,
  });
}

describe("Agent model Command construction", () => {
  it("rejects an operation that was not registered for this Agent", () => {
    const other = AiModel.define({
      ...definition.definition,
      name: "unregistered-support-reply",
    });
    expect(() => session().create(other, { conversation, input })).toThrow("not registered");
  });

  it("reports a missing deployment only when a model Command is requested", () => {
    const commands = session(false);
    expect(commands.pendingCalls()).toEqual([]);
    expect(() => commands.create(definition, { conversation, input })).toThrow(
      "no selected deployment",
    );
  });

  it("accepts only the exact Command returned by this handler turn", () => {
    const first = session();
    const constructed = first.create(definition, { conversation, input });
    const altered = create(CallModelSchema, {
      ...constructed,
      model: ModelRef.of("different-deployment", "v1"),
    });
    expect(() => first.returned(altered)).toThrow("not constructed");
    expect(() => session().returned(constructed)).toThrow("not constructed");
    expect(() => first.returned(create(CallModelSchema))).toThrow("not constructed");
    expect(first.returned(constructed).id?.value).toBe(constructed.call?.id?.value);
  });

  it("captures a decision deployment with trusted tenant and loaded Version", () => {
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-decision" });
    const tenant = create(TenantIdSchema, {
      kind: { case: "domain", value: create(InternetDomainSchema, { value: "support.test" }) },
    });
    const version = create(VersionSchema, { number: 7, timestamp: Time.currentTime() });
    const commands = new ModelCommandSession({
      models: [decision],
      selected: new Map([
        [
          AiModelKind.DECISION,
          {
            kind: AiModelKind.DECISION,
            model: ModelRef.of("support-router", "v2"),
          },
        ],
      ]),
      agent: create(AgentIdSchema, {
        stateTypeUrl: TypeUrls.derive(SupportReplyAgentStateSchema),
        entityId: AnyPacker.pack(SupportReplyAgentIdSchema, id),
      }),
      replyContext: "SupportDecision",
      tenant,
      version,
      pending: [],
    });
    const request = commands.create(decision, { conversation, input });
    expect(request.model).toEqual(ModelRef.of("support-router", "v2"));
    expect(request.call).toMatchObject({
      replyContext: { value: "SupportDecision" },
      tenant,
      agentVersion: version,
      capability: { value: "route-support-ticket" },
      capabilityRevision: { value: "v1" },
    });
    expect(request.call?.agent?.entityId).toEqual(AnyPacker.pack(SupportReplyAgentIdSchema, id));
    expect(request.call?.whenRequested).toBeDefined();
    expect(commands.returned(request).id?.value).toBe(request.call?.id?.value);
    if (
      request.call?.agent === undefined ||
      request.call.tenant === undefined ||
      request.call.agentVersion === undefined ||
      request.model === undefined
    )
      throw new Error("Decision request omitted trusted metadata.");
    request.call.agent.stateTypeUrl = "type.spine.io/foreign.Agent";
    request.call.tenant.kind = {
      case: "domain",
      value: create(InternetDomainSchema, { value: "foreign.test" }),
    };
    request.call.agentVersion.number = 99;
    if (request.model.name === undefined) throw new Error("Decision deployment name is absent.");
    request.model.name.value = "foreign-model";
    const next = commands.create(decision, { conversation, input });
    expect(next.call?.agent?.stateTypeUrl).toBe(TypeUrls.derive(SupportReplyAgentStateSchema));
    expect(next.call?.tenant).toEqual(tenant);
    expect(next.call?.agentVersion).toEqual(version);
    expect(next.model).toEqual(ModelRef.of("support-router", "v2"));
  });

  it("allows abandonment only for a committed pending call", () => {
    const callId = create(AiOperationIdSchema, { value: "pending-call" });
    expect(() => {
      session().abandon(callId);
    }).toThrow("Only a pending model call");
    const pending = session().create(definition, { conversation, input }).call;
    if (pending?.id === undefined) throw new Error("Missing prepared call.");
    const commands = session(true, [pending]);
    commands.abandon(pending.id);
    expect(commands.abandoned()).toEqual([pending.id.value]);
  });

  it("rejects use of a captured capability after its handler has returned", () => {
    const commands = session();
    commands.close();
    expect(() => commands.create(definition, { conversation, input })).toThrow("closed");
    expect(() => {
      commands.abandon(create(AiOperationIdSchema, { value: "pending-call" }));
    }).toThrow("closed");
  });

  it("rejects model Command access outside an Agent handler binding", () => {
    const restoredAgent = {};
    expect(() => ModelCommandBindings.require(restoredAgent)).toThrow(
      "only during an Agent handler",
    );
    const release = ModelCommandBindings.bind(restoredAgent, session());
    expect(ModelCommandBindings.require(restoredAgent)).toBeDefined();
    release();
    expect(() => ModelCommandBindings.require(restoredAgent)).toThrow(
      "only during an Agent handler",
    );
  });
});
