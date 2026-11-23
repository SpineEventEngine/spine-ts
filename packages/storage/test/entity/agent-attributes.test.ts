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

import { clone, create } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { AnyPacker } from "@spine-event-engine/core";
import {
  AiModelKind,
  CallModelSchema,
  ModelCallSchema,
  ModelPreferenceSchema,
} from "@spine-event-engine/proto/agent";
// prettier-ignore
import {
  ActiveAgentRecordSchema,
} from "@spine-event-engine/proto/generated/spine/server/agent/active_agent_record_pb.js";
import { describe, expect, it } from "vitest";

// prettier-ignore
import {
  SupportReplyAgentIdSchema,
} from "../../../server/test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import { AgentAttributes } from "../../src/provider.js";
import { agentAttributes } from "./agent-live-fixtures.js";
import { modelRequest, occurredAt } from "./agent-history-fixtures.js";

describe("Agent attributes identity and pending calls", () => {
  it("uses the active Agent record name for the physical record type", () => {
    expect(AgentAttributes.spec((value) => value).recordType.typeName).toBe(
      "spine.server.agent.ActiveAgentRecord",
    );
    expect(AgentAttributes.group.name).toBe("spine_agent_attributes");
  });

  const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-history" });
  const agent = agentAttributes(id).agent;
  if (agent === undefined) throw new Error("Missing Agent identity fixture.");
  const request = modelRequest("call-1", occurredAt(1n));
  if (request.item.case !== "modelRequest" || request.item.value.request?.message === undefined)
    throw new Error("Expected a complete model request fixture.");
  const payload = AnyPacker.unpack(request.item.value.request.message, CallModelSchema);
  if (payload.call === undefined) throw new Error("Expected model call metadata.");
  const call = payload.call;

  it("keeps a detached complete image and distinguishes absent from empty attributes", () => {
    const original = agentAttributes(id, [], [call]);
    const copy = AgentAttributes.copy(original);
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    const mutableCall = clone(ModelCallSchema, call);
    const created = AgentAttributes.record(agent, [], [mutableCall]);
    if (mutableCall.id === undefined) throw new Error("Missing model call identity.");
    mutableCall.id.value = "changed-after-record";
    expect(created.pendingModelCalls[0]?.id?.value).toBe("call-1");
    expect(AgentAttributes.same(undefined, undefined)).toBe(true);
    expect(AgentAttributes.same(undefined, created)).toBe(false);
    expect(AgentAttributes.same(created, undefined)).toBe(false);
    expect(AgentAttributes.same(created, AgentAttributes.copy(created))).toBe(true);
    expect(AgentAttributes.same(created, agentAttributes(id))).toBe(false);
    const sameSizeDifferentCall = AgentAttributes.copy(created);
    if (sameSizeDifferentCall.pendingModelCalls[0]?.id === undefined)
      throw new Error("Missing model call identity.");
    sameSizeDifferentCall.pendingModelCalls[0].id.value = "call-2";
    expect(AgentAttributes.same(created, sameSizeDifferentCall)).toBe(false);
  });

  it("rejects duplicate pending IDs and calls targeting another typed Agent", () => {
    const valid = agentAttributes(id, [], [call]);
    const duplicate = clone(ActiveAgentRecordSchema, valid);
    duplicate.pendingModelCalls.push(clone(ModelCallSchema, call));
    expect(() => AgentAttributes.copy(duplicate)).toThrow("must be unique");
    const foreign = clone(ActiveAgentRecordSchema, valid);
    const another = create(SupportReplyAgentIdSchema, { ticketNumber: "T-another" });
    const foreignCall = foreign.pendingModelCalls[0];
    if (foreignCall === undefined) throw new Error("Missing pending call.");
    const anotherAgent = agentAttributes(another).agent;
    if (anotherAgent === undefined) throw new Error("Missing second Agent identity fixture.");
    foreignCall.agent = anotherAgent;
    expect(() => AgentAttributes.copy(foreign)).toThrow("different Agent identity");
    expect(() => {
      AgentAttributes.requireIdentity(valid, agent);
    }).not.toThrow();
    expect(() => {
      AgentAttributes.requireIdentity(valid, anotherAgent);
    }).toThrow("identity conflict");
  });

  it("rejects duplicate selection kinds and incomplete physical identity", () => {
    const preference = create(ModelPreferenceSchema, {
      kind: AiModelKind.GENERATION,
      selection: { case: "inheritRepositoryDefault", value: create(EmptySchema) },
    });
    const duplicate = create(ActiveAgentRecordSchema, {
      agent,
      modelPreferences: [preference, clone(ModelPreferenceSchema, preference)],
    });
    expect(() => AgentAttributes.copy(duplicate)).toThrow("unique supported kinds");
    const unsupported = clone(ActiveAgentRecordSchema, duplicate);
    unsupported.modelPreferences = [
      create(ModelPreferenceSchema, {
        kind: AiModelKind.AI_MODEL_KIND_UNSPECIFIED,
        selection: { case: "inheritRepositoryDefault", value: create(EmptySchema) },
      }),
    ];
    expect(() => AgentAttributes.copy(unsupported)).toThrow("Message validation failed");
    const decision = create(ModelPreferenceSchema, {
      kind: AiModelKind.DECISION,
      selection: { case: "inheritRepositoryDefault", value: create(EmptySchema) },
    });
    expect(
      AgentAttributes.copy(
        create(ActiveAgentRecordSchema, {
          agent,
          modelPreferences: [preference, decision],
        }),
      ).modelPreferences,
    ).toHaveLength(2);
    expect(() => AgentAttributes.text({ ...agent, stateTypeUrl: "" })).toThrow(
      "Message validation failed",
    );
    expect(() => AgentAttributes.text({ ...agent, entityId: undefined })).toThrow(
      "Message validation failed",
    );
    expect(() =>
      AgentAttributes.spec((value) => value).idValueIn({ ...duplicate, agent: undefined }),
    ).toThrow("require identity");
  });
});
