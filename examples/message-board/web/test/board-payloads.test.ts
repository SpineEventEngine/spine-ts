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

import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  BoardIdSchema,
  BoardMessageViewSchema,
  MessageIdSchema,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { UserIdSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/user_pb.js";
import { AnyMessages } from "@spine-event-engine/core";
import {
  EntityStateUpdateSchema,
  EntityUpdatesSchema,
  EventUpdatesSchema,
  SubscriptionUpdateSchema,
  type EntityStateUpdate,
  type SubscriptionUpdate,
} from "@spine-event-engine/proto/client";
import { describe, expect, it } from "vitest";

import { BoardPayloads } from "../src/board-payloads.js";

describe("BoardPayloads", () => {
  it("decodes, checks, upserts, and orders state rows", () => {
    const result = BoardPayloads.apply(
      "general",
      [row("later", 2n), row("replace", 3n)],
      updates(state("earlier", 1n), state("replace", 4n)),
    );

    expect(result).toMatchObject({
      kind: "applied",
      rows: [
        expect.objectContaining({ text: "earlier" }),
        expect.objectContaining({ text: "later" }),
        expect.objectContaining({ text: "replace" }),
      ],
    });
    if (result.kind === "applied")
      expect(result.rows.map((value) => value.id?.value)).toEqual(["earlier", "later", "replace"]);
  });

  it("removes a decoded no-longer-matching identity idempotently", () => {
    const first = BoardPayloads.apply(
      "general",
      [row("keep"), row("remove")],
      updates(remove("remove")),
    );
    const second = BoardPayloads.apply(
      "general",
      first.kind === "applied" ? first.rows : [],
      updates(remove("remove")),
    );

    expect(first).toMatchObject({
      kind: "applied",
      rows: [expect.objectContaining({ text: "keep" })],
    });
    expect(second).toMatchObject({
      kind: "applied",
      rows: [expect.objectContaining({ text: "keep" })],
    });
  });

  it.each([
    [
      "wrong update",
      update({ update: { case: "eventUpdates", value: create(EventUpdatesSchema) } }),
      "wrong-update",
    ],
    ["empty update batch", updates(), "empty-batch"],
    [
      "missing identity",
      updates(create(EntityStateUpdateSchema, { kind: { case: "noLongerMatching", value: true } })),
      "missing-id",
    ],
    [
      "undecodable identity",
      updates(
        remove("bad", {
          id: AnyMessages.pack(BoardIdSchema, create(BoardIdSchema, { value: "general" })),
        }),
      ),
      "invalid-id",
    ],
    [
      "missing state",
      updates(
        create(EntityStateUpdateSchema, {
          id: messageId("missing"),
          kind: { case: "state", value: undefined as never },
        }),
      ),
      "missing-state",
    ],
    [
      "wrong state type",
      updates(
        state(
          "wrong",
          1n,
          AnyMessages.pack(BoardIdSchema, create(BoardIdSchema, { value: "general" })),
        ),
      ),
      "invalid-state",
    ],
    [
      "identity mismatch",
      updates(state("outer", 1n, AnyMessages.pack(BoardMessageViewSchema, row("inner", 1n)))),
      "identity-mismatch",
    ],
    [
      "foreign board",
      updates(
        state("foreign", 1n, AnyMessages.pack(BoardMessageViewSchema, row("foreign", 1n, "other"))),
      ),
      "foreign-board",
    ],
  ])("returns %s recovery without changing rows", (_name, update, reason) => {
    const rows = [row("kept")];

    expect(BoardPayloads.apply("general", rows, update)).toEqual({ kind: "recovery", reason });
    expect(rows.map((value) => value.id?.value)).toEqual(["kept"]);
  });

  it("validates every update before applying a batch", () => {
    const result = BoardPayloads.apply(
      "general",
      [row("kept")],
      updates(state("new"), remove("missing", { id: undefined })),
    );

    expect(result).toEqual({ kind: "recovery", reason: "missing-id" });
  });
});

function updates(...update: EntityStateUpdate[]): SubscriptionUpdate {
  return create(SubscriptionUpdateSchema, {
    update: { case: "entityUpdates", value: create(EntityUpdatesSchema, { update }) },
  });
}

function update(value: MessageInitShape<typeof SubscriptionUpdateSchema>): SubscriptionUpdate {
  return create(SubscriptionUpdateSchema, value);
}

function state(
  id: string,
  seconds = 1n,
  value = AnyMessages.pack(BoardMessageViewSchema, row(id, seconds)),
) {
  return create(EntityStateUpdateSchema, {
    id: messageId(id),
    kind: { case: "state", value },
  });
}

function remove(id: string, extra: Record<string, unknown> = {}) {
  return create(EntityStateUpdateSchema, {
    id: messageId(id),
    kind: { case: "noLongerMatching", value: true },
    ...extra,
  });
}

function messageId(value: string) {
  return AnyMessages.pack(MessageIdSchema, create(MessageIdSchema, { value }));
}

function row(id: string, seconds = 1n, board = "general") {
  return create(BoardMessageViewSchema, {
    id: create(MessageIdSchema, { value: id }),
    board: create(BoardIdSchema, { value: board }),
    author: create(UserIdSchema, { value: "ada" }),
    username: "Ada",
    text: id,
    postedAt: create(TimestampSchema, { seconds }),
  });
}
