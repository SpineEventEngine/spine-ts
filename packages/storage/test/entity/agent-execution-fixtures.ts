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

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { AnySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { ActorContextSchema, CommandIdSchema, CommandSchema } from "@spine-event-engine/proto";
import {
  AgentAcceptedInvocationSchema,
  AgentCodeRevisionSchema,
  AgentExecutionScopeSchema,
  AgentHandlerBindingSchema,
  AgentHandlerKind,
  AgentHandlerOrigin,
  AgentInboxOrderSchema,
  AgentInvocationKeySchema,
  AgentPolicyRevisionSchema,
  AgentSchemaRevisionSchema,
  AgentSignalKeySchema,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";

import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
  type SupportReplyAgentId,
  type SupportReplyAgentState,
} from "../../../server/test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
// prettier-ignore
import {
  DraftSupportReplySchema,
} from "../../../server/test-fixtures/generated/entity-metadata/support_agent_commands_pb.js";
import type { EntityStorageInput } from "../../src/internal/entity-history.js";
import { RecordSpec } from "../../src/record/record-spec.js";

const idTypeUrl = `type.spine.server.testing/${SupportReplyAgentIdSchema.typeName}`;

/**
 * Builds a typed support Agent repository layout for provider execution checks.
 * @returns Complete Entity storage input.
 */
export function entityInput(): EntityStorageInput<SupportReplyAgentId, SupportReplyAgentState> {
  return {
    context: { name: "Support", multitenant: false },
    id: {
      clone: (id) => create(SupportReplyAgentIdSchema, { ticketNumber: id.ticketNumber }),
      key: (id) => id.ticketNumber,
      pack: (id) =>
        create(AnySchema, {
          typeUrl: idTypeUrl,
          value: toBinary(SupportReplyAgentIdSchema, id),
        }),
      unpack: (value) =>
        value.typeUrl === idTypeUrl
          ? fromBinary(SupportReplyAgentIdSchema, value.value)
          : undefined,
    },
    columns: [],
    recordSpec: new RecordSpec<SupportReplyAgentId, EntityRecord>({
      sourceType: SupportReplyAgentStateSchema,
      recordType: EntityRecordSchema,
      idSchema: SupportReplyAgentIdSchema,
      extractId: (record) => {
        if (record.entityId?.typeUrl !== idTypeUrl)
          throw new TypeError("Support Agent current record requires its typed ID.");
        return fromBinary(SupportReplyAgentIdSchema, record.entityId.value);
      },
    }),
    sourceType: SupportReplyAgentStateSchema,
    stateSchema: SupportReplyAgentStateSchema,
  };
}

/**
 * Builds original typed support Command work for Agent admission tests.
 * @param sourceId Original Command ID.
 * @param ticketNumber Typed Agent ticket identifier.
 * @returns Complete immutable accepted invocation.
 */
export function accepted(sourceId: string, ticketNumber = "T-execution") {
  const id = create(SupportReplyAgentIdSchema, { ticketNumber });
  const signal = create(AgentSignalKeySchema, {
    id: { case: "command", value: create(CommandIdSchema, { uuid: sourceId }) },
  });
  const command = create(CommandSchema, {
    id: create(CommandIdSchema, { uuid: sourceId }),
    message: create(AnySchema, {
      typeUrl: `type.spine.server.testing/${DraftSupportReplySchema.typeName}`,
      value: toBinary(
        DraftSupportReplySchema,
        create(DraftSupportReplySchema, { agent: id, question: "When will my order arrive?" }),
      ),
    }),
  });
  return create(AgentAcceptedInvocationSchema, {
    key: create(AgentInvocationKeySchema, {
      scope: create(AgentExecutionScopeSchema, {
        stateType: "spine.server.testing.SupportReplyAgentState",
        agentKey: ticketNumber,
      }),
      sourceSignal: signal,
    }),
    recipientId: create(AnySchema, {
      typeUrl: `type.spine.server.testing/${SupportReplyAgentIdSchema.typeName}`,
      value: toBinary(SupportReplyAgentIdSchema, id),
    }),
    signal: { case: "command", value: command },
    actor: create(ActorContextSchema),
    order: create(AgentInboxOrderSchema, {
      receivedAt: create(TimestampSchema, { seconds: 100n, nanos: 7 }),
      inboxVersion: 1n,
      sourceSignal: signal,
    }),
    handlers: [
      create(AgentHandlerBindingSchema, {
        ordinal: 0,
        receiverType: "spine.server.testing.SupportReplyAgentState",
        methodName: "draft",
        kind: AgentHandlerKind.AGENT_HANDLER_COMMAND_ASSIGNMENT,
        signalType: DraftSupportReplySchema.typeName,
        origin: AgentHandlerOrigin.AGENT_HANDLER_DOMESTIC,
        parameterCount: 1,
      }),
    ],
    codeRevision: create(AgentCodeRevisionSchema, { value: "build-1" }),
    schemaRevision: create(AgentSchemaRevisionSchema, { value: "schema-1" }),
    policyRevision: create(AgentPolicyRevisionSchema, { value: "policy-1" }),
  });
}
