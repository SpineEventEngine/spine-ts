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
  AnnouncementBoardViewSchema,
  BoardMessageViewSchema,
  BoardStatisticsViewSchema,
  type AnnouncementBoardView,
  type BoardMessageView,
  type BoardStatisticsView,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import {
  MessagePostedSchema,
  type MessagePosted,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/events_pb.js";

const visible = (board: string | undefined, context: ReadSideContext): boolean => {
  if (board === "general" || board === "announcements") return true;
  return (
    board === "restricted" &&
    context.principal !== undefined &&
    context.authorityFacts?.canReadRestricted === true
  );
};

/**
 * Admits message rows at the messages Bounded Context boundary.
 */
export class BoardVisibility extends ReadSideFilter<typeof BoardMessageViewSchema> {
  /**
   * Creates the board message read filter.
   */
  constructor() {
    super(BoardMessageViewSchema);
  }

  /**
   * Checks message board visibility.
   *
   * @param message Message view to inspect.
   * @param context Verified reader context.
   * @returns The filtered or redacted value.
   */
  filter(message: BoardMessageView, context: ReadSideContext): BoardMessageView | null {
    return visible(message.board?.value, context) ? message : null;
  }
}

/**
 * Admits a board's cumulative statistics at its supplying Bounded Context.
 */
export class BoardStatisticsVisibility extends ReadSideFilter<typeof BoardStatisticsViewSchema> {
  /**
   * Creates the board statistics read filter.
   */
  constructor() {
    super(BoardStatisticsViewSchema);
  }

  /**
   * Checks statistics board visibility.
   *
   * @param view Projection view to inspect.
   * @param context Verified reader context.
   * @returns The filtered or redacted value.
   */
  filter(view: BoardStatisticsView, context: ReadSideContext): BoardStatisticsView | null {
    return visible(view.id?.value, context) ? view : null;
  }
}

/**
 * Admits only the application's public announcement board.
 */
export class AnnouncementVisibility extends ReadSideFilter<typeof AnnouncementBoardViewSchema> {
  /**
   * Creates the announcement read filter.
   */
  constructor() {
    super(AnnouncementBoardViewSchema);
  }

  /**
   * Checks announcement board visibility.
   *
   * @param view Projection view to inspect.
   * @returns The filtered or redacted value.
   */
  filter(view: AnnouncementBoardView): AnnouncementBoardView | null {
    return view.id?.value === "announcements" ? view : null;
  }
}

/**
 * Suppresses Events from boards that the verified reader cannot inspect.
 */
export class PublishedEventVisibility extends ReadSideFilter<typeof MessagePostedSchema> {
  /**
   * Creates the published Event read filter.
   */
  constructor() {
    super(MessagePostedSchema);
  }

  /**
   * Checks published Event visibility.
   *
   * @param event Event payload to inspect.
   * @param context Verified reader context.
   * @returns The filtered or redacted value.
   */
  filter(event: MessagePosted, context: ReadSideContext): MessagePosted | null {
    return visible(event.board?.value, context) ? event : null;
  }
}

/**
 * Redacts public-reader names in root and nested message views at Server egress.
 */
export class MessageAuthorRedaction extends ReadSideFilter<typeof BoardMessageViewSchema> {
  /**
   * Creates the message author read filter.
   */
  constructor() {
    super(BoardMessageViewSchema, { nested: true });
  }

  /**
   * Updates public message author names.
   *
   * @param message Message view to inspect.
   * @param context Verified reader context.
   * @returns The filtered or redacted value.
   */
  filter(message: BoardMessageView, context: ReadSideContext): BoardMessageView {
    if (context.principal === undefined) message.username = "Anonymous";
    return message;
  }
}

/**
 * Redacts public-reader names in delivered Event payloads.
 */
export class EventAuthorRedaction extends ReadSideFilter<typeof MessagePostedSchema> {
  /**
   * Creates the Event author read filter.
   */
  constructor() {
    super(MessagePostedSchema);
  }

  /**
   * Updates public Event author names.
   *
   * @param event Event payload to inspect.
   * @param context Verified reader context.
   * @returns The filtered or redacted value.
   */
  filter(event: MessagePosted, context: ReadSideContext): MessagePosted {
    if (context.principal === undefined) event.username = "Anonymous";
    return event;
  }
}

/**
 * Removes internal contributor membership from direct statistics reads.
 */
export class BoardStatisticsDisclosure extends ReadSideFilter<typeof BoardStatisticsViewSchema> {
  /**
   * Creates the statistics disclosure read filter.
   */
  constructor() {
    super(BoardStatisticsViewSchema);
  }

  /**
   * Removes internal statistics contributors.
   *
   * @param view Projection view to inspect.
   * @returns The filtered or redacted value.
   */
  filter(view: BoardStatisticsView): BoardStatisticsView {
    view.authors = [];
    return view;
  }
}

/**
 * Removes internal contributor membership from direct announcement reads.
 */
export class AnnouncementDisclosure extends ReadSideFilter<typeof AnnouncementBoardViewSchema> {
  /**
   * Creates the announcement disclosure read filter.
   */
  constructor() {
    super(AnnouncementBoardViewSchema);
  }

  /**
   * Removes internal announcement contributors.
   *
   * @param view Projection view to inspect.
   * @returns The filtered or redacted value.
   */
  filter(view: AnnouncementBoardView): AnnouncementBoardView {
    view.authors = [];
    return view;
  }
}
