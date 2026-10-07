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
  DraftRecoverySupportReplySchema as DraftRecoverySchema,
  type DraftRecoverySupportReply,
} from "../../generated/spine/server/testing/support_recovery_commands_pb.js";
import {
  SupportReplyDraftedSchema,
  type SupportReplyDrafted,
} from "../../generated/spine/server/testing/support_agent_events_pb.js";
import { SupportRecoveryStateSchema } from "../../generated/spine/server/testing/support_recovery_states_pb.js";
import { SupportReplyProposalSchema } from "../../generated/spine/server/testing/support_recovery_types_pb.js";
import type { SupportReplyAgentId } from "../../generated/spine/server/testing/support_agent_states_pb.js";

/**
 * Bounded generation capability whose typed result is a support proposal.
 */
export const recoveryReplyModel: AiCapability<
  typeof DraftRecoverySchema,
  typeof SupportReplyProposalSchema
> = AiModel.define({
  name: "support-recovery-reply",
  version: "1",
  kind: "generation",
  input: DraftRecoverySchema,
  output: SupportReplyProposalSchema,
  outputMode: "prompt-and-validate",
  instructions: "Propose a short support reply for human review from the supplied question.",
  limits: {
    modelRequests: 1,
    toolCalls: 0,
    deadlineMs: 90_000,
    maxInputBytes: 8_000,
    maxOutputBytes: 8_000,
    maxOutputTokens: 1_000,
  },
});

/**
 * Drafts one typed support proposal while retaining its original ticket identity.
 */
export class SupportRecoveryAgent extends Agent<
  SupportReplyAgentId,
  typeof SupportRecoveryStateSchema
> {
  // prettier-ignore

  /**
   * Converts the saved model proposal into one domain Event after recovery.
   * @param command Original accepted support question.
   * @returns Reply proposed for human review.
   */
  @Assign async draft(command: DraftRecoverySupportReply): Promise<SupportReplyDrafted> {
    const conversation = create(ConversationIdSchema, {
      value: `support-recovery-${this.id.ticketNumber}`,
    });
    const result = await this.ai.invoke(recoveryReplyModel, {
      call: "support-recovery-reply",
      conversation,
      input: command,
    });
    if (!result.ok) throw new Error("Support reply proposal was not usable.");
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
