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

import { create, toBinary } from "@bufbuild/protobuf";
import { AnySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AnyMessages, TypeUrls } from "@spine-event-engine/core";
import {
  BoardIdSchema,
  BoardMessageViewSchema,
  MessageIdSchema,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { UserIdSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/user_pb.js";
import {
  EntityStateWithVersionSchema,
  OrderBy_Direction,
  QueryResponseSchema,
} from "@spine-event-engine/proto/client";
import { describe, expect, it } from "vitest";

import { BoardView } from "../src/board-view.js";

describe("BoardView", () => {
  it("builds one oldest-first board query and matching topic", () => {
    const view = new BoardView("general");
    const query = view.query();
    const topic = view.topic();

    expect(query.id?.value).toBe("message-board-general");
    expect(query.format?.orderBy).toMatchObject([
      { column: "posted_at", direction: OrderBy_Direction.ASCENDING },
    ]);
    expect(topic.id?.value).toBe("message-board-general");
    expect(topic.target).toEqual(query.target);
  });

  it("filters another board and orders valid rows by time, nanos, and identifier", () => {
    const view = new BoardView("general");
    const response = create(QueryResponseSchema, {
      message: [
        create(EntityStateWithVersionSchema),
        entity("other", "ignored", 1n, 0),
        entity("general", "later", 2n, 0),
        entity("general", "same-b", 1n, 2),
        entity("general", "same-a", 1n, 2),
        rawEntity("general", "undated"),
      ],
    });

    expect(view.rows(response).map((row) => row.id?.value)).toEqual([
      "undated",
      "same-a",
      "same-b",
      "later",
    ]);

    expect(
      view
        .rows(
          create(QueryResponseSchema, {
            message: [rawEntity("general"), rawEntity("general", "identified")],
          }),
        )
        .map((row) => row.id?.value),
    ).toEqual([undefined, "identified"]);
  });
});

function entity(board: string, id: string, seconds = 0n, nanos = 0) {
  return create(EntityStateWithVersionSchema, {
    state: AnyMessages.pack(
      BoardMessageViewSchema,
      create(BoardMessageViewSchema, {
        id: create(MessageIdSchema, { value: id }),
        board: create(BoardIdSchema, { value: board }),
        author: create(UserIdSchema, { value: "ada" }),
        username: "Ada",
        text: id,
        postedAt: create(TimestampSchema, { seconds, nanos }),
      }),
    ),
  });
}

function rawEntity(board: string, id?: string) {
  const message = create(BoardMessageViewSchema, {
    ...(id === undefined ? {} : { id: create(MessageIdSchema, { value: id }) }),
    board: create(BoardIdSchema, { value: board }),
    author: create(UserIdSchema, { value: "ada" }),
    username: "Ada",
    text: id ?? "without an identifier",
  });
  return create(EntityStateWithVersionSchema, {
    state: create(AnySchema, {
      typeUrl: TypeUrls.derive(BoardMessageViewSchema),
      value: toBinary(BoardMessageViewSchema, message),
    }),
  });
}
