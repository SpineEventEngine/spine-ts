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
import { AnyPacker } from "@spine-event-engine/core";
import {
  AnnouncementBoardViewSchema,
  BoardIdSchema,
  MessageIdSchema,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import {
  EntityStateUpdateSchema,
  EntityUpdatesSchema,
  SubscriptionUpdateSchema,
} from "@spine-event-engine/proto/client";
import { describe, expect, it } from "vitest";
import { AnnouncementPayloads } from "../src/announcement-sync.js";

describe("announcement updates", () => {
  it("applies a state and removes it only by announcement BoardId", () => {
    const id = create(BoardIdSchema, { value: "announcements" });
    const state = create(AnnouncementBoardViewSchema, {
      id,
      message: create(MessageIdSchema, { value: "post-1" }),
      text: "Notice",
    });
    const update = create(SubscriptionUpdateSchema, {
      update: {
        case: "entityUpdates",
        value: create(EntityUpdatesSchema, {
          update: [
            create(EntityStateUpdateSchema, {
              id: AnyPacker.pack(BoardIdSchema, id),
              kind: { case: "state", value: AnyPacker.pack(AnnouncementBoardViewSchema, state) },
            }),
          ],
        }),
      },
    });
    expect(AnnouncementPayloads.reconcile(undefined, update)).toMatchObject({ text: "Notice" });
    const removal = create(SubscriptionUpdateSchema, {
      update: {
        case: "entityUpdates",
        value: create(EntityUpdatesSchema, {
          update: [
            create(EntityStateUpdateSchema, {
              id: AnyPacker.pack(BoardIdSchema, id),
              kind: { case: "noLongerMatching", value: true },
            }),
          ],
        }),
      },
    });
    expect(AnnouncementPayloads.reconcile(state, removal)).toBeUndefined();
    const wrongId = create(SubscriptionUpdateSchema, {
      update: {
        case: "entityUpdates",
        value: create(EntityUpdatesSchema, {
          update: [
            create(EntityStateUpdateSchema, {
              id: AnyPacker.pack(MessageIdSchema, create(MessageIdSchema, { value: "post-1" })),
              kind: { case: "noLongerMatching", value: true },
            }),
          ],
        }),
      },
    });
    expect(AnnouncementPayloads.reconcile(state, wrongId)).toBe("recover");
  });

  it("requests recovery for an empty or foreign announcement update", () => {
    const previous = create(AnnouncementBoardViewSchema, {
      id: create(BoardIdSchema, { value: "announcements" }),
      text: "Current notice",
    });
    expect(AnnouncementPayloads.reconcile(previous, create(SubscriptionUpdateSchema))).toBe(
      "recover",
    );
    const empty = create(SubscriptionUpdateSchema, {
      update: { case: "entityUpdates", value: create(EntityUpdatesSchema) },
    });
    expect(AnnouncementPayloads.reconcile(previous, empty)).toBe("recover");
    const foreign = create(SubscriptionUpdateSchema, {
      update: {
        case: "entityUpdates",
        value: create(EntityUpdatesSchema, {
          update: [
            create(EntityStateUpdateSchema, {
              id: AnyPacker.pack(BoardIdSchema, create(BoardIdSchema, { value: "general" })),
              kind: { case: "noLongerMatching", value: true },
            }),
          ],
        }),
      },
    });
    expect(AnnouncementPayloads.reconcile(previous, foreign)).toBe("recover");
    expect(previous.text).toBe("Current notice");
  });

  it("rejects an announcement state with a mismatched identity or unsupported change", () => {
    const id = create(BoardIdSchema, { value: "announcements" });
    const state = create(AnnouncementBoardViewSchema, {
      id: create(BoardIdSchema, { value: "general" }),
      text: "Foreign notice",
    });
    const update = (change: ReturnType<typeof create<typeof EntityStateUpdateSchema>>) =>
      create(SubscriptionUpdateSchema, {
        update: {
          case: "entityUpdates",
          value: create(EntityUpdatesSchema, { update: [change] }),
        },
      });
    expect(
      AnnouncementPayloads.reconcile(
        undefined,
        update(
          create(EntityStateUpdateSchema, {
            id: AnyPacker.pack(BoardIdSchema, id),
            kind: { case: "state", value: AnyPacker.pack(AnnouncementBoardViewSchema, state) },
          }),
        ),
      ),
    ).toBe("recover");
    expect(
      AnnouncementPayloads.reconcile(
        undefined,
        update(create(EntityStateUpdateSchema, { id: AnyPacker.pack(BoardIdSchema, id) })),
      ),
    ).toBe("recover");
  });
});
