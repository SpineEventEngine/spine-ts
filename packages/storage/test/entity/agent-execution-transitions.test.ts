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
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { CommandIdSchema, CommandSchema } from "@spine-event-engine/proto";
import {
  AgentExecutionCompletionSchema,
  AgentExecutionRecordSchema,
  AgentOutgoingCommandSchema,
  AgentSavedDispatchPlanSchema,
  AgentSavedDispatchTargetSchema,
  AgentSavedRepositoryFamily,
  AgentSavedTargetKind,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
// prettier-ignore
import {
  DraftSupportReplySchema,
} from "../../../server/test-fixtures/generated/entity-metadata/support_agent_commands_pb.js";
// prettier-ignore
import {
  SupportReplyAgentIdSchema,
} from "../../../server/test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import { describe, expect, it } from "vitest";

import { AgentExecutionTransitions } from "../../src/entity/agent-execution-transitions.js";
import { accepted } from "./agent-execution-fixtures.js";

function output(id = "reply-command-1") {
  const agent = create(SupportReplyAgentIdSchema, { ticketNumber: "T-transition" });
  return create(AgentOutgoingCommandSchema, {
    command: create(CommandSchema, {
      id: create(CommandIdSchema, { uuid: id }),
      message: create(AnySchema, {
        typeUrl: `type.spine.server.testing/${DraftSupportReplySchema.typeName}`,
        value: toBinary(DraftSupportReplySchema, create(DraftSupportReplySchema, { agent })),
      }),
    }),
  });
}

function completed() {
  return create(AgentExecutionRecordSchema, {
    accepted: accepted("transition-source"),
    completion: create(AgentExecutionCompletionSchema, { commands: [output()] }),
  });
}

function commandKey(id = "reply-command-1") {
  return create(CommandIdSchema, { uuid: id });
}

describe("saved Agent Command transitions", () => {
  it("accepts one immutable plan and rejects changed original Command or route", () => {
    const prior = completed();
    AgentExecutionTransitions.assertCompletion(prior);
    const prepared = clone(AgentExecutionRecordSchema, prior);
    const outgoing = prepared.completion?.commands[0];
    if (outgoing === undefined) throw new Error("Missing Command fixture.");
    outgoing.plan = create(AgentSavedDispatchPlanSchema);
    expect(() => {
      AgentExecutionTransitions.assertUpdate(prior, prepared);
    }).not.toThrow();
    const changedRoute = clone(AgentExecutionRecordSchema, prepared);
    changedRoute.completion?.commands[0]?.plan?.targets.push(
      create(AgentSavedDispatchTargetSchema, {
        kind: AgentSavedTargetKind.AGENT_SAVED_STANDALONE_COMMAND,
        signalType: DraftSupportReplySchema.typeName,
        bindingFingerprint: "new-binding",
      }),
    );
    expect(() => {
      AgentExecutionTransitions.assertUpdate(prepared, changedRoute);
    }).toThrow(/immutable/i);
    const changedCommand = clone(AgentExecutionRecordSchema, prepared);
    if (changedCommand.completion?.commands[0]?.command?.id !== undefined)
      changedCommand.completion.commands[0].command.id.uuid = "replacement";
    expect(() => {
      AgentExecutionTransitions.assertUpdate(prepared, changedCommand);
    }).toThrow(/only one-time/i);
  });

  it("requires a saved plan before acknowledging the original Command ID", () => {
    const record = completed();
    expect(() => {
      AgentExecutionTransitions.assertDelivery(record, [commandKey()]);
    }).toThrow(/plan/i);
    const outgoing = record.completion?.commands[0];
    if (outgoing === undefined) throw new Error("Missing Command fixture.");
    outgoing.plan = create(AgentSavedDispatchPlanSchema);
    expect(() => {
      AgentExecutionTransitions.assertDelivery(record, [commandKey()]);
    }).not.toThrow();
    expect(() => {
      AgentExecutionTransitions.assertDelivery(record, [commandKey("other")]);
    }).toThrow(/plan/i);
  });

  it("rejects invalid Command recipients without an Event route", () => {
    const saved = output();
    saved.plan = create(AgentSavedDispatchPlanSchema, {
      targets: [
        create(AgentSavedDispatchTargetSchema, {
          kind: AgentSavedTargetKind.AGENT_SAVED_REPOSITORY_COMMAND,
          signalType: DraftSupportReplySchema.typeName,
          bindingFingerprint: "selected-handler",
          receiverStateType: SupportReplyAgentIdSchema.typeName,
          repositoryFamily: AgentSavedRepositoryFamily.AGENT_SAVED_AGENT,
          recipients: [create(AnySchema)],
        }),
      ],
    });
    expect(() => {
      AgentExecutionTransitions.validatePlan(saved);
    }).toThrow(/invalid repository/i);
    const target = saved.plan.targets[0];
    if (target === undefined) throw new Error("Missing recipient fixture.");
    target.recipients[0] = create(AnySchema, {
      typeUrl: `type.spine.server.testing/${SupportReplyAgentIdSchema.typeName}`,
    });
    expect(() => {
      AgentExecutionTransitions.validatePlan(saved);
    }).not.toThrow();
    target.kind = AgentSavedTargetKind.AGENT_SAVED_STANDALONE_COMMAND;
    expect(() => {
      AgentExecutionTransitions.validatePlan(saved);
    }).toThrow(/invalid repository/i);
  });

  it("rejects delivered, planned, duplicate and blank original Command IDs at completion", () => {
    const record = completed();
    const outgoing = record.completion?.commands[0];
    if (outgoing === undefined) throw new Error("Missing Command fixture.");
    outgoing.delivered = true;
    expect(() => {
      AgentExecutionTransitions.assertCompletion(record);
    }).toThrow(/undelivered/i);
    outgoing.delivered = false;
    outgoing.plan = create(AgentSavedDispatchPlanSchema);
    expect(() => {
      AgentExecutionTransitions.assertCompletion(record);
    }).toThrow(/without a plan/i);
    outgoing.plan = undefined;
    record.completion?.commands.push(output());
    expect(() => {
      AgentExecutionTransitions.assertCompletion(record);
    }).toThrow(/duplicate/i);
    record.completion?.commands.pop();
    if (outgoing.command?.id !== undefined) outgoing.command.id.uuid = "";
    expect(() => {
      AgentExecutionTransitions.assertCompletion(record);
    }).toThrow(/nonempty/i);
  });

  it("cannot install completion or remove a prepared Command through an ordinary update", () => {
    const record = create(AgentExecutionRecordSchema, { accepted: accepted("source") });
    const installed = clone(AgentExecutionRecordSchema, record);
    installed.completion = create(AgentExecutionCompletionSchema);
    expect(() => {
      AgentExecutionTransitions.assertUpdate(record, installed);
    }).toThrow(/conditional commit/i);
    const prepared = completed();
    const command = prepared.completion?.commands[0];
    if (command === undefined) throw new Error("Missing Command fixture.");
    command.plan = create(AgentSavedDispatchPlanSchema);
    const removed = clone(AgentExecutionRecordSchema, prepared);
    removed.completion = undefined;
    expect(() => {
      AgentExecutionTransitions.assertUpdate(prepared, removed);
    }).toThrow(/cannot be replaced/i);
    const unplanned = clone(AgentExecutionRecordSchema, prepared);
    if (unplanned.completion?.commands[0] !== undefined)
      unplanned.completion.commands[0].plan = undefined;
    expect(() => {
      AgentExecutionTransitions.assertUpdate(prepared, unplanned);
    }).toThrow(/immutable/i);
  });

  it.each([
    { signalType: "", bindingFingerprint: "handler" },
    { signalType: DraftSupportReplySchema.typeName, bindingFingerprint: "" },
    {
      signalType: DraftSupportReplySchema.typeName,
      bindingFingerprint: "handler",
      receiverStateType: "unexpected.State",
    },
    {
      signalType: DraftSupportReplySchema.typeName,
      bindingFingerprint: "handler",
      repositoryFamily: AgentSavedRepositoryFamily.AGENT_SAVED_AGENT,
    },
  ])("rejects an incomplete standalone Command binding: %j", (fields) => {
    const command = output();
    command.plan = create(AgentSavedDispatchPlanSchema, {
      targets: [
        create(AgentSavedDispatchTargetSchema, {
          kind: AgentSavedTargetKind.AGENT_SAVED_STANDALONE_COMMAND,
          ...fields,
        }),
      ],
    });
    expect(() => {
      AgentExecutionTransitions.validatePlan(command);
    }).toThrow(/dispatcher/i);
  });
});
