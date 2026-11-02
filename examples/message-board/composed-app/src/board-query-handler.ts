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
import { AppQueryHandler, type AppQueryContext } from "@spine-event-engine/server";
import {
  ReadBoardMessage,
  ReadBoardStats,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/board_queries_app_query.js";
import {
  AnnouncementBoardViewQuery,
  BoardMessageViewQuery,
  BoardStatisticsViewQuery,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_query.js";
import {
  BoardStatisticsSchema,
  BoardIdSchema,
  type AnnouncementBoardView,
  type BoardStatisticsView,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";

/**
 * Reads one message through the Server's scoped Bounded Context read route.
 */
export class ReadBoardMessageHandler extends AppQueryHandler<
  ReadBoardMessage.Query,
  ReadBoardMessage.Response
> {
  /**
   * Resolves the requested message and returns the paired response type.
   *
   * @param query The validated domain query.
   * @param context The active Server read capability.
   * @returns The visible message, when present.
   */
  async execute(
    query: ReadBoardMessage.Query,
    context: AppQueryContext,
  ): Promise<ReadBoardMessage.Response> {
    const states = await context
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Server validates the required field before dispatch.
      .select(BoardMessageViewQuery.create().byId(query.message!).build())
      .read();
    return create(ReadBoardMessage.responseSchema, { message: states[0] });
  }
}

/**
 * Combines visible lifetime statistics from the two supplying Bounded Contexts.
 */
export class ReadBoardStatsHandler extends AppQueryHandler<
  ReadBoardStats.Query,
  ReadBoardStats.Response
> {
  /**
   * Reads both cumulative views through their Bounded Context policies.
   *
   * @param query The selected message board.
   * @param context The active Server read capability.
   * @returns Visible summaries without contributor membership arrays.
   */
  async execute(
    query: ReadBoardStats.Query,
    context: AppQueryContext,
  ): Promise<ReadBoardStats.Response> {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Server validates the required field before dispatch.
    const board = query.board!;
    const [messages, announcements] = await Promise.all([
      context.select(BoardStatisticsViewQuery.create().byId(board).build()).read(),
      context
        .select(
          AnnouncementBoardViewQuery.create()
            .byId(create(BoardIdSchema, { value: "announcements" }))
            .build(),
        )
        .read(),
    ]);
    return create(ReadBoardStats.responseSchema, {
      board: boardStatisticsFromView(messages[0]),
      announcements: boardStatisticsFromView(announcements[0]),
    });
  }
}

/**
 * Copies public lifetime totals without contributor identifiers.
 *
 * @param view Supplies one cumulative Projection state when present.
 * @returns The public statistics response value, or undefined when no view exists.
 */
const boardStatisticsFromView = (view: BoardStatisticsView | AnnouncementBoardView | undefined) =>
  view === undefined
    ? undefined
    : create(BoardStatisticsSchema, {
        board: view.id,
        messageCount: view.messageCount,
        authorCount: view.authorCount,
        firstPostedAt: view.firstPostedAt,
      });
