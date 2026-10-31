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

import { clone, create } from "@bufbuild/protobuf";
import { Projection, Subscribe, Where, type External } from "@spine-event-engine/server";
import {
  AnnouncementBoardViewSchema,
  BoardIdSchema,
  BoardMessageViewSchema,
  MessageIdSchema,
  type BoardId,
  type MessageId,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import type { MessagePosted } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/events_pb.js";

/**
 * Materializes each message as a queryable Projection row.
 */
export class BoardViewProjection extends Projection<MessageId, typeof BoardMessageViewSchema> {
  // prettier-ignore

  /**
   * Copies one posted message into its read-side row.
   *
   * @param event The admitted message Event.
   */
  @Subscribe
  onMessagePosted(event: MessagePosted): void {
    this.update((draft) =>
      Object.assign(draft, create(BoardMessageViewSchema, {
        id: clone(MessageIdSchema, event.id ?? this.id),
        board: event.board,
        author: event.author,
        username: event.username,
        text: event.text,
        postedAt: event.postedAt,
      })),
    );
  }
}

/**
 * Maintains the latest posted message for the announcements board.
 */
export class AnnouncementBoardProjection extends Projection<
  BoardId,
  typeof AnnouncementBoardViewSchema
> {
  // prettier-ignore

  /**
   * Updates the board-wide announcement selected by generated Event-field metadata.
   *
   * @param event The admitted message Event.
   */
  @Where({ eventField: "board", equals: '{"value":"announcements"}' })
  @Subscribe
  onAnnouncement(event: External<MessagePosted>): void {
    this.update((draft) =>
      Object.assign(draft, create(AnnouncementBoardViewSchema, {
        id: clone(BoardIdSchema, event.board ?? this.id),
        message: event.id,
        text: event.text,
      })),
    );
  }
}
