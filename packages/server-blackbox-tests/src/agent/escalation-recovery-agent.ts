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
import { AiModel, type AiModel as AiCapability } from "@spine-event-engine/ai";
import { ConversationIdSchema } from "@spine-event-engine/proto/agent";
import { Agent, Assign } from "@spine-event-engine/server";

import {
  EscalateRecoverySupportTicketSchema as EscalateSchema,
  type EscalateRecoverySupportTicket,
} from "../../generated/spine/server/testing/support_recovery_commands_pb.js";
import {
  SupportReplyDraftedSchema,
  type SupportReplyDrafted,
} from "../../generated/spine/server/testing/support_agent_events_pb.js";
// prettier-ignore
import {
  SupportEscalationRecoveryStateSchema as EscalationStateSchema,
} from "../../generated/spine/server/testing/support_recovery_states_pb.js";
import { SupportReplyProposalSchema } from "../../generated/spine/server/testing/support_recovery_types_pb.js";
import type { SupportReplyAgentId } from "../../generated/spine/server/testing/support_agent_states_pb.js";

/**
 * Typed support proposal that may call the write-capable escalation tool.
 */
export const escalationRecoveryModel: AiCapability<
  typeof EscalateSchema,
  typeof SupportReplyProposalSchema
> = AiModel.define({
  name: "support-escalation-recovery",
  version: "1",
  kind: "generation",
  input: EscalateSchema,
  output: SupportReplyProposalSchema,
  outputMode: "prompt-and-validate",
  instructions: "Escalate this support ticket, then propose a short reply for human review.",
  tools: [{ server: "support-service", tool: "escalate" }],
  limits: {
    modelRequests: 2,
    toolCalls: 1,
    deadlineMs: 90_000,
    maxInputBytes: 8_000,
    maxOutputBytes: 8_000,
    maxOutputTokens: 1_000,
  },
});

/**
 * Converts a safely resolved escalation into one support reply draft.
 */
export class SupportEscalationRecoveryAgent extends Agent<
  SupportReplyAgentId,
  typeof EscalationStateSchema
> {
  // prettier-ignore

  /**
   * Invokes the declared escalation tool through the model operation.
   * @param command Original ticket and customer question.
   * @returns Reply draft only when the tool outcome is known.
   */
  @Assign async escalate(command: EscalateRecoverySupportTicket): Promise<SupportReplyDrafted> {
    const conversation = create(ConversationIdSchema, {
      value: `support-escalation-${this.id.ticketNumber}`,
    });
    const result = await this.ai.invoke(escalationRecoveryModel, {
      call: "support-escalation-recovery",
      conversation,
      input: command,
    });
    if (!result.ok) throw new Error("Support escalation outcome is not usable.");
    this.update((state) => {
      state.id = this.id;
      state.proposedReply = result.value.replyText;
    });
    return create(SupportReplyDraftedSchema, {
      agent: this.id,
      reply: result.value.replyText,
    });
  }
}
