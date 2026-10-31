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

import { ReadSideFilter, type ReadSideContext } from "@spine-event-engine/server";
import {
  BoardMessageViewSchema,
  type BoardMessageView,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { ReadBoardMessage } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/board_queries_app_query.js";
import {
  MessagePostedSchema,
  type MessagePosted,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/events_pb.js";

/**
 * Applies the same message visibility rule at Bounded Context and Server boundaries.
 */
export class BoardVisibility extends ReadSideFilter<typeof BoardMessageViewSchema> {
  /**
   * Initializes inspection of messages nested in application results.
   */
  constructor() {
    super(BoardMessageViewSchema, { nested: true });
  }

  /**
   * Removes restricted messages without a verified grant and masks public names.
   *
   * @param message The detached domain Projection.
   * @param context Verified reader facts; ActorContext alone grants no access.
   * @returns The visible message, or null to remove it.
   */
  filter(message: BoardMessageView, context: ReadSideContext): BoardMessageView | null {
    if (message.board?.value === "restricted" && context.authorityFacts?.canReadRestricted !== true)
      return null;
    if (context.principal === undefined) message.username = "Public reader";
    return message;
  }
}

/**
 * Labels every message read through the messages Bounded Context.
 */
export class BoardContextLabel extends ReadSideFilter<typeof BoardMessageViewSchema> {
  /**
   * Initializes filtering against the message Projection schema.
   */
  constructor() {
    super(BoardMessageViewSchema);
  }

  /**
   * Marks the detached message as having passed the messages Bounded Context.
   *
   * @param message The mutable detached Projection view.
   * @returns The labeled view.
   */
  filter(message: BoardMessageView): BoardMessageView {
    message.text = `BC: ${message.text}`;
    return message;
  }
}

/**
 * Labels nested message views at the Server egress boundary.
 */
export class ServerMessageLabel extends ReadSideFilter<typeof BoardMessageViewSchema> {
  /**
   * Initializes nested inspection of messages in application responses.
   */
  constructor() {
    super(BoardMessageViewSchema, { nested: true });
  }

  /**
   * Marks each nested message returned by the Server.
   *
   * @param message The mutable detached message view.
   * @returns The Server-labeled message.
   */
  filter(message: BoardMessageView): BoardMessageView {
    message.text = `Server: ${message.text}`;
    return message;
  }
}

/**
 * Labels a complete application result at the Server boundary.
 */
export class ResultLabel extends ReadSideFilter<typeof ReadBoardMessage.responseSchema> {
  /**
   * Initializes filtering against the paired application response schema.
   */
  constructor() {
    super(ReadBoardMessage.responseSchema);
  }

  /**
   * Marks a surviving message as part of a complete application result.
   *
   * @param response The mutable detached application response.
   * @returns The labeled response.
   */
  filter(response: ReadBoardMessage.Response): ReadBoardMessage.Response {
    if (response.message !== undefined) response.message.text = `Result: ${response.message.text}`;
    return response;
  }
}

/**
 * Removes restricted Event payloads before delivery to readers without a grant.
 */
export class PublishedEventVisibility extends ReadSideFilter<typeof MessagePostedSchema> {
  /**
   * Initializes filtering of the domain payload without changing the Event envelope.
   */
  constructor() {
    super(MessagePostedSchema);
  }

  /**
   * Returns only Event payloads admitted by the current verified reader facts.
   *
   * @param event The detached domain Event payload.
   * @param context The active reader's verified authority facts.
   * @returns A visible payload or null for suppression.
   */
  filter(event: MessagePosted, context: ReadSideContext): MessagePosted | null {
    if (event.board?.value === "restricted" && context.authorityFacts?.canReadRestricted !== true)
      return null;
    if (context.principal === undefined) event.username = "Public writer";
    return event;
  }
}
