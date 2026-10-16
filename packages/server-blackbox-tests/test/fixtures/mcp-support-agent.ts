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
import { AiModel } from "@spine-event-engine/ai";
import { ConversationIdSchema } from "@spine-event-engine/proto/agent";
import { Agent } from "@spine-event-engine/server";
import {
  DraftRecoverySupportReplySchema,
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
 * Generation capability that uses a registered ticket lookup before drafting.
 */
export const mcpSupportModel = AiModel.define({
  name: "support-mcp-reply",
  version: "1",
  kind: "generation",
  input: DraftRecoverySupportReplySchema,
  output: SupportReplyProposalSchema,
  outputMode: "prompt-and-validate",
  instructions: "Lookup the support ticket, then propose a reply for human review.",
  tools: [{ server: "knowledge", tool: "lookup" }],
  limits: {
    modelRequests: 3,
    toolCalls: 1,
    deadlineMs: 10_000,
    maxInputBytes: 8_000,
    maxOutputBytes: 8_000,
    maxOutputTokens: 200,
  },
});

/**
 * Generation capability without a wire token ceiling for ChatGPT plan Responses.
 */
export const chatgptPlanSupportModel = AiModel.define({
  name: "support-mcp-reply",
  version: "2",
  kind: "generation",
  input: DraftRecoverySupportReplySchema,
  output: SupportReplyProposalSchema,
  outputMode: "prompt-and-validate",
  instructions: "Lookup the support ticket, then propose a reply for human review.",
  tools: [{ server: "knowledge", tool: "lookup" }],
  limits: {
    modelRequests: 3,
    toolCalls: 1,
    deadlineMs: 10_000,
    maxInputBytes: 8_000,
    maxOutputBytes: 8_000,
  },
});

/**
 * Converts an MCP-assisted typed proposal into a support domain Event.
 */
export class McpSupportAgent extends Agent<SupportReplyAgentId, typeof SupportRecoveryStateSchema> {
  /**
   * Drafts one reply after the selected model completes its registered lookup.
   * @param command Accepted support ticket question.
   * @returns Drafted reply for human review.
   */
  async draft(command: DraftRecoverySupportReply): Promise<SupportReplyDrafted> {
    const result = await this.ai.invoke(mcpSupportModel, {
      call: "support-mcp-reply",
      conversation: create(ConversationIdSchema, { value: `support-${this.id.ticketNumber}` }),
      input: command,
    });
    if (!result.ok) {
      throw new Error(`Support proposal unavailable: ${result.failure.code}`);
    }
    this.update((state) => {
      state.id = this.id;
      state.proposedReply = result.value.replyText;
    });
    return create(SupportReplyDraftedSchema, { agent: this.id, reply: result.value.replyText });
  }
}

/**
 * Agent fixture that invokes the subscription capability through the public facade.
 */
export class ChatgptPlanSupportAgent extends Agent<
  SupportReplyAgentId,
  typeof SupportRecoveryStateSchema
> {
  /**
   * Drafts one reply after the selected model completes its registered lookup.
   *
   * @param command Accepted support ticket question.
   * @returns Drafted reply for human review.
   */
  async draft(command: DraftRecoverySupportReply): Promise<SupportReplyDrafted> {
    const result = await this.ai.invoke(chatgptPlanSupportModel, {
      call: "support-mcp-reply",
      conversation: create(ConversationIdSchema, { value: `support-${this.id.ticketNumber}` }),
      input: command,
    });
    if (!result.ok) throw new Error(`Support proposal unavailable: ${result.failure.code}`);
    this.update((state) => {
      state.id = this.id;
      state.proposedReply = result.value.replyText;
    });
    return create(SupportReplyDraftedSchema, { agent: this.id, reply: result.value.replyText });
  }
}
