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
  DraftKnowledgeSupportReplySchema as DraftSchema,
  type DraftKnowledgeSupportReply,
} from "../../generated/spine/server/testing/support_recovery_commands_pb.js";
import {
  SupportReplyDraftedSchema,
  type SupportReplyDrafted,
} from "../../generated/spine/server/testing/support_agent_events_pb.js";
// prettier-ignore
import {
  SupportLookupRecoveryStateSchema as LookupStateSchema,
} from "../../generated/spine/server/testing/support_recovery_states_pb.js";
// prettier-ignore
import {
  SupportDraftProjectionStateQuery as DraftProjectionQuery,
} from "../../generated/spine/server/testing/support_recovery_states_query.js";
import { SupportReplyProposalSchema } from "../../generated/spine/server/testing/support_recovery_types_pb.js";
import type { SupportReplyAgentId } from "../../generated/spine/server/testing/support_agent_states_pb.js";

/**
 * Drafts a support reply with one read-only ticket lookup.
 */
export const lookupRecoveryModel: AiCapability<
  typeof DraftSchema,
  typeof SupportReplyProposalSchema
> = AiModel.define({
  name: "support-lookup-recovery",
  version: "1",
  kind: "generation",
  input: DraftSchema,
  output: SupportReplyProposalSchema,
  outputMode: "prompt-and-validate",
  instructions: "Look up this support ticket, then draft a reply for human review.",
  tools: [{ server: "support-service", tool: "lookup" }],
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
 * Retains the original prior draft read when a ticket lookup resumes.
 */
export class SupportLookupRecoveryAgent extends Agent<
  SupportReplyAgentId,
  typeof LookupStateSchema
> {
  // prettier-ignore

  /**
   * Creates a reply from the recorded prior draft and read-only lookup.
   * @param command Original customer question for this ticket.
   * @returns Reply proposed for human review.
   */
  @Assign async draft(command: DraftKnowledgeSupportReply): Promise<SupportReplyDrafted> {
    const query = DraftProjectionQuery.create().byId(this.id).build();
    const previous = (await this.select(query).read())[0]?.proposedReply ?? "none";
    const conversation = create(ConversationIdSchema, {
      value: `support-lookup-${this.id.ticketNumber}`,
    });
    const result = await this.ai.invoke(lookupRecoveryModel, {
      call: "support-lookup-recovery",
      conversation,
      input: command,
    });
    if (!result.ok) throw new Error("Support ticket lookup did not produce a usable reply.");
    const reply = `${result.value.replyText} Earlier draft: ${previous}`;
    this.update((state) => {
      state.id = this.id;
      state.proposedReply = reply;
    });
    return create(SupportReplyDraftedSchema, { agent: this.id, reply });
  }
}
