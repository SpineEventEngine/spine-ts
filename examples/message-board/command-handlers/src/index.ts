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
import { Aggregate, Assign, Throws } from "@spine-event-engine/server";
import {
  BoardMessageSchema,
  MessageIdSchema,
  type MessageId,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import type { PostMessage } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/commands_pb.js";
import {
  MessagePostedSchema,
  type MessagePosted,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/events_pb.js";
import { MessageAlreadyPosted } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/rejections.js";

/**
 * Applies a valid PostMessage command and publishes its domain Event.
 */
export class BoardMessageAggregate extends Aggregate<MessageId, typeof BoardMessageSchema> {
  // prettier-ignore

  /**
   * Records a new message and returns the Event used by read-side Projections.
   *
   * @param command The admitted message fields.
   * @returns The Event describing the posted message.
   */
  @Assign
  @Throws(MessageAlreadyPosted)
  postMessage(command: PostMessage): MessagePosted {
    if (this.state.board !== undefined) throw MessageAlreadyPosted.create({ id: this.id });
    const id = clone(MessageIdSchema, this.id);
    this.update((draft) =>
      Object.assign(draft, create(BoardMessageSchema, {
        id,
        board: command.board,
        author: command.author,
        username: command.username,
        text: command.text,
        postedAt: command.postedAt,
      })),
    );
    return create(MessagePostedSchema, {
      id,
      board: command.board,
      author: command.author,
      username: command.username,
      text: command.text,
      postedAt: command.postedAt,
    });
  }
}
