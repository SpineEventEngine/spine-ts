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
import { Agent, Assign, Command, React, Throws } from "@spine-event-engine/server";

import {
  type DraftSupportReply,
  ReviewSupportReplySchema,
  type ReviewSupportReply,
} from "../../generated/spine/server/testing/support_agent_commands_pb.js";
import {
  SupportReplyDraftedSchema,
  type SupportReplyDrafted,
  type SupportTicketUpdated,
} from "../../generated/spine/server/testing/support_agent_events_pb.js";
import { SupportReplyUnavailable } from "../../generated/spine/server/testing/support_agent_rejections.js";
import type * as ReplyMessages from "../../generated/spine/server/testing/support_agent_rejections_pb.js";
import {
  type SupportReplyAgentId,
  SupportReplyAgentStateSchema as AgentStateSchema,
} from "../../generated/spine/server/testing/support_agent_states_pb.js";

/**
 * Drafts support replies and sends each proposal to a human review step.
 */
export class SupportReplyAgent extends Agent<SupportReplyAgentId, typeof AgentStateSchema> {
  /**
   * Counts injected later-handler failures observed by the BlackBox fixture.
   */
  static failedReactions = 0;

  /**
   * Counts rejected draft requests delivered back to the Agent.
   */
  static rejectionsSeen = 0;

  /**
   * Creates a reply draft from the incoming customer question.
   *
   * @param command Reply request for this support ticket.
   * @returns The proposed reply Event.
   */
  @Assign
  @Throws(SupportReplyUnavailable)
  draft(command: DraftSupportReply): SupportReplyDrafted {
    if (command.question === "reject") {
      throw SupportReplyUnavailable.create({ agent: this.id });
    }
    const reply = `Answer: ${command.question}`;
    this.update((state) => Object.assign(state, { id: this.id, proposedReply: reply }));
    return create(SupportReplyDraftedSchema, { agent: this.id, reply });
  }

  /**
   * Starts a fresh draft when the customer adds a question.
   *
   * @param event Incoming customer update.
   * @returns A proposed reply or `undefined` for an ignored update.
   */
  @React
  onTicketUpdated(event: SupportTicketUpdated): SupportReplyDrafted | undefined {
    if (event.question === "ignore") return undefined;
    const reply = `Answer: ${event.question}`;
    this.update((state) => Object.assign(state, { id: this.id, proposedReply: reply }));
    return create(SupportReplyDraftedSchema, { agent: this.id, reply });
  }

  /**
   * Updates the draft produced earlier in the same handler set.
   *
   * @param event Incoming customer update.
   * @returns The revised reply or `undefined` for an ignored update.
   */
  @React
  onReviewNeeded(event: SupportTicketUpdated): SupportReplyDrafted | undefined {
    if (event.question === "fail") {
      SupportReplyAgent.failedReactions += 1;
      throw new Error("Review preparation failed.");
    }
    if (event.question === "ignore") return undefined;
    const reply = `${this.currentDraft().proposedReply} [review]`;
    this.update((state) => Object.assign(state, { proposedReply: reply }));
    return create(SupportReplyDraftedSchema, { agent: this.id, reply });
  }

  /**
   * Observes a declared reply rejection without changing Agent state.
   *
   * @param rejection The rejected draft request.
   */
  @React
  onReplyUnavailable(rejection: ReplyMessages.SupportReplyUnavailable): undefined {
    void rejection;
    SupportReplyAgent.rejectionsSeen += 1;
    return undefined;
  }

  /**
   * Returns a human review request after Event reactions complete.
   *
   * @param event Incoming customer update.
   * @returns A typed review Command for this support ticket.
   */
  @Command
  requestReview(event: SupportTicketUpdated): ReviewSupportReply {
    void event;
    return create(ReviewSupportReplySchema, { agent: this.id });
  }
}
