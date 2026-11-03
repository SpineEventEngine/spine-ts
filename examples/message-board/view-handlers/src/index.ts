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
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import type { EventContext } from "@spine-event-engine/proto";
import { Projection, Subscribe, Where, type External } from "@spine-event-engine/server";
import {
  AnnouncementBoardViewSchema,
  BoardIdSchema,
  BoardMessageViewSchema,
  BoardStatisticsViewSchema,
  MessageIdSchema,
  type BoardId,
  type MessageId,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { UserIdSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/user_pb.js";
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
 * Counts accepted posts and distinct domain authors for one message board.
 */
export class BoardStatisticsProjection extends Projection<
  BoardId,
  typeof BoardStatisticsViewSchema
> {
  // prettier-ignore

  /**
   * Records one accepted post using its Event occurrence time.
   *
   * @param event The accepted post.
   * @param context The server-authored Event context.
   */
  @Subscribe
  onMessagePosted(event: MessagePosted, context: EventContext): void {
    const author = event.author;
    const occurred = context.timestamp;
    if (author === undefined || occurred === undefined)
      throw new TypeError("Posted statistics require an author and Event timestamp.");
    this.update((draft) => {
      draft.id ??= clone(BoardIdSchema, event.board ?? this.id);
      draft.messageCount += 1n;
      if (!draft.authors.some((candidate) => candidate.value === author.value))
        draft.authors.push(clone(UserIdSchema, author));
      draft.authorCount = BigInt(draft.authors.length);
      const first = draft.firstPostedAt;
      if (first === undefined || occurred.seconds < first.seconds ||
          (occurred.seconds === first.seconds && occurred.nanos < first.nanos))
        draft.firstPostedAt = clone(TimestampSchema, occurred);
    });
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
   * @param context Accepted Event metadata and timestamp.
   * @param event The admitted message Event.
   */
  @Where({ eventField: "board", equals: '{"value":"announcements"}' })
  @Subscribe
  onAnnouncement(event: External<MessagePosted>, context: EventContext): void {
    const author = event.author;
    const occurred = context.timestamp;
    if (author === undefined || occurred === undefined)
      throw new TypeError("Announcement statistics require an author and Event timestamp.");
    this.update((draft) => {
      draft.id ??= clone(BoardIdSchema, event.board ?? this.id);
      draft.message = event.id;
      draft.text = event.text;
      draft.messageCount += 1n;
      if (!draft.authors.some((candidate) => candidate.value === author.value))
        draft.authors.push(clone(UserIdSchema, author));
      draft.authorCount = BigInt(draft.authors.length);
      const first = draft.firstPostedAt;
      if (first === undefined || occurred.seconds < first.seconds ||
          (occurred.seconds === first.seconds && occurred.nanos < first.nanos))
        draft.firstPostedAt = clone(TimestampSchema, occurred);
    });
  }
}
