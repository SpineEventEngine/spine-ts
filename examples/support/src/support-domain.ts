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

import { create, equals } from "@bufbuild/protobuf";
import type { AiRegistry } from "@spine-event-engine/ai";
import { AnyPacker } from "@spine-event-engine/core";
import type { AiOperationId } from "@spine-event-engine/proto/agent";
import type { CallModel } from "@spine-event-engine/proto/generated/spine/agent/commands_pb.js";
import type { ModelReplied } from "@spine-event-engine/proto/generated/spine/agent/events_pb.js";
import type { ModelCallFailed } from "@spine-event-engine/proto/generated/spine/agent/rejections_pb.js";
import {
  Agent,
  Aggregate,
  Assign,
  BoundedContext,
  Command,
  type BoundedContextBuilder,
  Projection,
  React,
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
import {
  SupportRequestSchema,
  SupportReplySchema,
  type SupportTicketId,
} from "../generated/spine/examples/support/types_pb.js";
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
   * Creates a typed model Command after saving current ticket facts.
   *
   * @param command Current facts and explicit conversation identity.
   * @returns Model Command submitted after this Agent turn commits.
   */
  @Command draft(command: DraftSupportReply): CallModel {
    if (command.conversation === undefined || command.request === undefined)
      throw new TypeError("A draft requires ticket facts and a conversation.");
    const request = command.request;
    const conversation = command.conversation;
    this.update((state) => {
      const changed = state.request === undefined ||
        !equals(SupportRequestSchema, state.request, request) ||
        state.conversation?.value !== conversation.value;
      state.id = this.id;
      state.request = request;
      if (changed) state.reply = undefined;
      state.conversation = conversation;
    });
    return this.modelCommands.create(draftSupportReply, {
      conversation,
      input: command,
    });
  }

  // prettier-ignore

  /**
   * Admits a validated reply only for the current draft request.
   *
   * @param event Typed model reply for a prepared request.
   * @returns Reviewable reply when this request is still current.
   */
  @React async onReplied(event: ModelReplied): Promise<SupportReplySuggested | undefined> {
    const command = await this.originalRequest(event.call?.id);
    if (command.conversation?.value !== this.state.conversation?.value ||
        command.request === undefined || this.state.request === undefined ||
        !equals(SupportRequestSchema, command.request, this.state.request)) return undefined;
    const reply = event.output && AnyPacker.tryUnpack(event.output, SupportReplySchema);
    if (reply === undefined) throw new TypeError("Model reply has no validated support proposal.");
    this.update((state) => { state.reply = reply; });
    return create(SupportReplySuggestedSchema, {
      id: this.id, request: command.request, reply,
      conversation: command.conversation, operation: event.call?.id,
    });
  }

  // prettier-ignore

  /**
   * Records a failed model request without producing a stale proposal.
   *
   * @param rejection Declared failure of the original model Command.
   * @returns Failure for review when its request is still current.
   */
  @React async onFailed(rejection: ModelCallFailed): Promise<SupportReplyFailed | undefined> {
    const command = await this.originalRequest(rejection.call?.id);
    if (command.conversation?.value !== this.state.conversation?.value ||
        command.request === undefined || this.state.request === undefined ||
        !equals(SupportRequestSchema, command.request, this.state.request)) return undefined;
    return create(SupportReplyFailedSchema, {
      id: this.id, request: command.request, conversation: command.conversation,
      operation: rejection.call?.id,
    });
  }

  /**
   * Reads the exact request Command that prepared a model call.
   *
   * @param callId Typed identity carried by the model outcome.
   * @returns Original support draft request.
   */
  private async originalRequest(callId: AiOperationId | undefined): Promise<DraftSupportReply> {
    if (callId === undefined) throw new TypeError("Model outcome has no call identity.");
    const history = await this.modelCallHistory(callId);
    if (history?.source.case !== "command")
      throw new TypeError("Model request history has no original support Command.");
    const command =
      history.source.value.message &&
      AnyPacker.tryUnpack(history.source.value.message, DraftSupportReplySchema);
    if (command === undefined) throw new TypeError("Model request history has no support draft.");
    return command;
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
      const sameRequest = state.request !== undefined && event.request !== undefined &&
        equals(SupportRequestSchema, state.request, event.request) &&
        state.conversation?.value === event.conversation?.value;
      state.id = event.id;
      state.request = event.request;
      state.conversation = event.conversation;
      if (!sameRequest) state.reply = undefined;
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
