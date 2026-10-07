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
import { AnyMessages, TypeUrls } from "@spine-event-engine/core";
import {
  ActorContextSchema, CommandSchema, EventContextSchema, EventSchema,
  RejectionEventContextSchema,
} from "@spine-event-engine/proto";
import {
  AgentAcceptedInvocationSchema,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { describe, expect, it } from "vitest";
import { AgentModelSelection } from "../../src/agent/agent-model-selection.js";
import { ProjectStateSchema } from "../../test-fixtures/generated/entity-metadata/project_states_pb.js";
import { ProjectIdSchema } from "../../test-fixtures/generated/repository-routing/project_identifiers_pb.js";
import { AssignReviewTaskSchema } from "../../test-fixtures/generated/handler-registry/commands_pb.js";
import { ReviewTaskAssignedSchema } from "../../test-fixtures/generated/handler-registry/events_pb.js";

describe("Agent model authorization scope", () => {
  it("identifies the actual handled Command and Event types", () => {
    const recipientId = AnyMessages.pack(ProjectIdSchema,
      create(ProjectIdSchema, { value: "project-1" }));
    const actor = create(ActorContextSchema);
    const command = create(CommandSchema, {
      id: { uuid: "command-1" },
      message: AnyMessages.pack(AssignReviewTaskSchema,
        create(AssignReviewTaskSchema, { id: "project-1" })),
    });
    const event = create(EventSchema, {
      id: { value: "event-1" },
      message: AnyMessages.pack(ReviewTaskAssignedSchema,
        create(ReviewTaskAssignedSchema, { id: "project-1" })),
    });
    const accepted = (signal: "command" | "event") => create(AgentAcceptedInvocationSchema, {
      recipientId,
      actor,
      signal: signal === "command" ? { case: "command", value: command } : { case: "event", value: event },
    });
    expect(AgentModelSelection.scope(accepted("command"), ProjectStateSchema).source.typeUrl)
      .toBe(TypeUrls.derive(AssignReviewTaskSchema));
    expect(AgentModelSelection.scope(accepted("event"), ProjectStateSchema).source.typeUrl)
      .toBe(TypeUrls.derive(ReviewTaskAssignedSchema));
    const rejection = accepted("event");
    if (rejection.signal.case !== "event") throw new Error("Expected Event signal.");
    rejection.signal.value.context = create(EventContextSchema, {
      rejection: create(RejectionEventContextSchema, { command }),
    });
    expect(AgentModelSelection.scope(rejection, ProjectStateSchema).source.typeUrl)
      .toBe(TypeUrls.derive(ReviewTaskAssignedSchema));
    const incomplete = accepted("command");
    if (incomplete.signal.case !== "command") throw new Error("Expected Command signal.");
    incomplete.signal.value.message = undefined;
    expect(() => AgentModelSelection.scope(incomplete, ProjectStateSchema))
      .toThrow("payload type");
  });
});
