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
import { AnyPacker } from "@spine-event-engine/core";
import { ConversationIdSchema } from "@spine-event-engine/proto/agent";
import type { CallModel } from "@spine-event-engine/proto/generated/spine/agent/commands_pb.js";
import type { ModelReplied } from "@spine-event-engine/proto/generated/spine/agent/events_pb.js";
import { Agent, Command, React } from "@spine-event-engine/server";

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
  /**
   * Handler invocations within this process, used by crash-recovery assertions.
   */
  static draftCalls = 0;

  // prettier-ignore

  /**
   * Prepares one model Command from the accepted support question.
   *
   * @param command Original accepted support question.
   * @returns Model Command to submit after the Agent saves its request.
   */
  @Command draft(command: DraftRecoverySupportReply): CallModel {
    SupportRecoveryAgent.draftCalls += 1;
    const conversation = create(ConversationIdSchema, {
      value: `support-recovery-${this.id.ticketNumber}`,
    });
    return this.modelCommands.create(recoveryReplyModel, {
      conversation,
      input: command,
    });
  }

  /**
   * Records a completed proposal and emits it for human review.
   *
   * @param event The typed reply to the prepared model Command.
   * @returns Reply proposed for human review.
   */
  @React replied(event: ModelReplied): SupportReplyDrafted {
    const proposal = event.output && AnyPacker.tryUnpack(event.output, SupportReplyProposalSchema);
    if (proposal === undefined) throw new Error("Support reply proposal was not usable.");
    this.update((state) => {
      state.id = this.id;
      state.proposedReply = proposal.replyText;
    });
    return create(SupportReplyDraftedSchema, {
      agent: this.id,
      reply: proposal.replyText,
    });
  }
}
