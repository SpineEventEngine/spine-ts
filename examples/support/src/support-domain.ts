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
import type { AiRegistry } from "@spine-event-engine/ai";
import {
  Agent,
  Aggregate,
  Assign,
  BoundedContext,
  type BoundedContextBuilder,
  Projection,
  Subscribe,
} from "@spine-event-engine/server";

import {
  DraftSupportReplySchema,
  type DraftSupportReply,
  type OpenSupportTicket,
} from "../generated/spine/examples/support/commands_pb.js";
import {
  SupportTicketOpenedSchema,
  SupportReplySuggestedSchema,
  SupportReplyFailedSchema,
  type SupportReplySuggested,
  type SupportReplyFailed,
  type SupportTicketOpened,
} from "../generated/spine/examples/support/events_pb.js";
import {
  SupportTicketStateSchema,
  SupportDraftStateSchema,
  SupportReviewStateSchema,
} from "../generated/spine/examples/support/states_pb.js";
import type { SupportTicketId } from "../generated/spine/examples/support/types_pb.js";
import { draftSupportReply } from "./model.js";

export { draftSupportReply } from "./model.js";

/**
 * Records warehouse facts as a support ticket.
 */
export class SupportTicket extends Aggregate<SupportTicketId, typeof SupportTicketStateSchema> {
  // prettier-ignore

  /**
   * Opens a ticket with the employee's original incident facts.
   *
   * @param command Ticket identity and reported facts.
   * @returns The ticket-opened domain Event.
   */
  @Assign open(command: OpenSupportTicket): SupportTicketOpened {
    this.update((state) => {
      state.id = this.id;
      state.request = command.request;
    });
    return create(SupportTicketOpenedSchema, { id: this.id, request: command.request });
  }
}

/**
 * Drafts one reply per accepted request and retains the latest validated proposal.
 */
export class SupportDraftAgent extends Agent<SupportTicketId, typeof SupportDraftStateSchema> {
  // prettier-ignore

  /**
   * Invokes the bounded model and emits a reviewable outcome for this ticket.
   *
   * @param command Current facts and explicit conversation identity.
   * @returns A proposed reply or a failure preserving the submitted facts.
   */
  @Assign async draft(command: DraftSupportReply): Promise<SupportReplySuggested | SupportReplyFailed> {
    if (command.conversation === undefined || command.request === undefined)
      throw new TypeError("A draft requires ticket facts and a conversation.");
    const result = await this.ai.invoke(draftSupportReply, {
      call: "draft-support-reply",
      conversation: command.conversation,
      input: command,
    });
    if (!result.ok) return create(SupportReplyFailedSchema, {
      id: this.id, request: command.request, conversation: command.conversation,
      operation: result.operationId,
    });
    this.update((state) => {
      state.id = this.id;
      state.request = command.request;
      state.reply = result.value;
      state.conversation = command.conversation;
    });
    return create(SupportReplySuggestedSchema, {
      id: this.id, request: command.request, reply: result.value,
      conversation: command.conversation, operation: result.operationId,
    });
  }
}

/**
 * Exposes the latest draft outcome for a support person's review.
 */
export class SupportReview extends Projection<SupportTicketId, typeof SupportReviewStateSchema> {
  // prettier-ignore

  /**
   * Updates the review state with a validated draft without sending it.
   *
   * @param event Proposal containing its exact request and conversation.
   */
  @Subscribe onReplySuggested(event: SupportReplySuggested): void {
    this.update((state) => {
      state.id = event.id;
      state.request = event.request;
      state.reply = event.reply;
      state.conversation = event.conversation;
      state.hasDraft = true;
      state.latestRequestFailed = false;
    });
  }

  // prettier-ignore

  /**
   * Records that the latest request has no usable draft.
   *
   * @param event Failure containing its exact request and conversation.
   */
  @Subscribe onReplyFailed(event: SupportReplyFailed): void {
    this.update((state) => {
      state.id = event.id;
      state.request = event.request;
      state.conversation = event.conversation;
      state.hasDraft = state.reply !== undefined;
      state.latestRequestFailed = true;
    });
  }
}

/**
 * Configures the real generated repositories and explicit model deployment.
 */
export const SupportContext: Readonly<{
  /**
   * Declares the Support Bounded Context with the configured AI registry.
   */
  create(ai: AiRegistry): BoundedContextBuilder;
}> = Object.freeze({
  /**
   * Declares the local support Bounded Context for an Application.
   *
   * @param ai Authenticated registry with a generation default.
   * @returns Support Bounded Context builder with Agent audit retention.
   */
  create(ai: AiRegistry): BoundedContextBuilder {
    const builder = BoundedContext.singleTenant("WarehouseSupport")

      .withAi(ai)
      .persistSystemEvents()
      .add(SupportTicket)
      .add(SupportDraftAgent, {
        ai: { models: [draftSupportReply] },
      })
      .add(SupportReview);
    return builder;
  },
});

/**
 * Identifies the Command schema used by the drafting Agent.
 */
export const SupportDraftCommand: typeof DraftSupportReplySchema = DraftSupportReplySchema;
