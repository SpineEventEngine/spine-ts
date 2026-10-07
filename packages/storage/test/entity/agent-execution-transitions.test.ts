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
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { CommandIdSchema, EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import {
  AgentExecutionCompletionSchema,
  AgentExecutionRecordSchema,
  AgentOutgoingSignalSchema,
  AgentSavedDispatchPlanSchema,
  AgentSavedDispatchTargetSchema,
  AgentSavedRepositoryFamily,
  AgentSavedTargetKind,
  AgentSignalKeySchema,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { describe, expect, it } from "vitest";

import { AgentExecutionTransitions } from "../../src/entity/agent-execution-transitions.js";
import { accepted } from "./agent-execution-fixtures.js";

function output() {
  return create(AgentOutgoingSignalSchema, {
    signal: {
      case: "event",
      value: create(EventSchema, { id: create(EventIdSchema, { value: "event-1" }) }),
    },
  });
}

function completed() {
  return create(AgentExecutionRecordSchema, {
    accepted: accepted("transition-source"),
    completion: create(AgentExecutionCompletionSchema, { outgoing: [output()] }),
  });
}

describe("saved Agent output transitions", () => {
  it("accepts one immutable plan and rejects any changed envelope or route", () => {
    const prior = completed();
    AgentExecutionTransitions.assertCompletion(prior);
    const prepared = clone(AgentExecutionRecordSchema, prior);
    const outgoing = prepared.completion?.outgoing[0];
    if (outgoing === undefined) throw new Error("Transition fixture lacks outgoing Event.");
    outgoing.plan = create(AgentSavedDispatchPlanSchema);
    expect(() => {
      AgentExecutionTransitions.assertUpdate(prior, prepared);
    }).not.toThrow();
    const changed = clone(AgentExecutionRecordSchema, prepared);
    const changedOutput = changed.completion?.outgoing[0];
    if (changedOutput === undefined) throw new Error("Transition fixture lacks outgoing Event.");
    changedOutput.plan?.targets.push(
      create(AgentSavedDispatchTargetSchema, {
        kind: AgentSavedTargetKind.AGENT_SAVED_STANDALONE_EVENT,
        signalType: "spine.server.testing.SupportReplyDrafted",
        bindingFingerprint: "new-binding",
      }),
    );
    expect(() => {
      AgentExecutionTransitions.assertUpdate(prepared, changed);
    }).toThrow(/immutable/i);
    const changedEnvelope = clone(AgentExecutionRecordSchema, prepared);
    changedEnvelope.claimToken = "changed";
    expect(() => {
      AgentExecutionTransitions.assertUpdate(prepared, changedEnvelope);
    }).toThrow(/only one-time output plan installation/i);
  });

  it("requires the saved plan before acknowledging the original typed ID", () => {
    const record = completed();
    const original = create(AgentSignalKeySchema, {
      id: { case: "event", value: create(EventIdSchema, { value: "event-1" }) },
    });
    expect(() => {
      AgentExecutionTransitions.assertDelivery(record, [original]);
    }).toThrow(/plan/i);
    const outgoing = record.completion?.outgoing[0];
    if (outgoing === undefined) throw new Error("Transition fixture lacks outgoing Event.");
    outgoing.plan = create(AgentSavedDispatchPlanSchema);
    expect(() => {
      AgentExecutionTransitions.assertDelivery(record, [original]);
    }).not.toThrow();
    const other = create(AgentSignalKeySchema, {
      id: { case: "command", value: create(CommandIdSchema, { uuid: "event-1" }) },
    });
    expect(() => {
      AgentExecutionTransitions.assertDelivery(record, [other]);
    }).toThrow(/plan/i);
  });

  it("rejects a route with the wrong kind or incomplete repository recipient", () => {
    const saved = output();
    saved.plan = create(AgentSavedDispatchPlanSchema, {
      targets: [
        create(AgentSavedDispatchTargetSchema, {
          kind: AgentSavedTargetKind.AGENT_SAVED_REPOSITORY_COMMAND,
          signalType: "spine.server.testing.SupportReplyDrafted",
          bindingFingerprint: "selected-handler",
          receiverStateType: "spine.server.testing.SupportReplyAgentState",
          repositoryFamily: AgentSavedRepositoryFamily.AGENT_SAVED_AGENT,
          recipients: [
            create(AnySchema, { typeUrl: "type.spine.server.testing/SupportReplyAgentId" }),
          ],
        }),
      ],
    });
    expect(() => {
      AgentExecutionTransitions.validatePlan(saved);
    }).toThrow(/does not match/i);
    const target = saved.plan.targets[0];
    if (target === undefined) throw new Error("Transition fixture lacks route target.");
    target.kind = AgentSavedTargetKind.AGENT_SAVED_REPOSITORY_EVENT;
    target.recipients[0] = create(AnySchema);
    expect(() => {
      AgentExecutionTransitions.validatePlan(saved);
    }).toThrow(/invalid repository/i);
  });

  it("rejects completion when an output was already delivered or planned", () => {
    const record = completed();
    const outgoing = record.completion?.outgoing[0];
    if (outgoing === undefined) throw new Error("Transition fixture lacks outgoing Event.");
    outgoing.delivered = true;
    expect(() => {
      AgentExecutionTransitions.assertCompletion(record);
    }).toThrow(/undelivered/i);
    outgoing.delivered = false;
    outgoing.plan = create(AgentSavedDispatchPlanSchema);
    expect(() => {
      AgentExecutionTransitions.assertCompletion(record);
    }).toThrow(/without a plan/i);
  });

  it("rejects duplicate typed outgoing IDs and empty original IDs", () => {
    const record = completed();
    const first = record.completion?.outgoing[0];
    if (first === undefined) throw new Error("Transition fixture lacks outgoing Event.");
    record.completion?.outgoing.push(clone(AgentOutgoingSignalSchema, first));
    expect(() => {
      AgentExecutionTransitions.assertCompletion(record);
    }).toThrow(/duplicate/i);
    record.completion?.outgoing.pop();
    if (first.signal.case !== "event") throw new Error("Transition fixture requires an Event.");
    first.signal.value.id = create(EventIdSchema);
    expect(() => {
      AgentExecutionTransitions.assertCompletion(record);
    }).toThrow(/nonempty|empty/i);
  });
});
