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

// @vitest-environment jsdom
import { create } from "@bufbuild/protobuf";
import { AnyPacker } from "@spine-event-engine/core";
import { MessagePostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/events_pb.js";
import { BoardIdSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { EventSchema } from "@spine-event-engine/proto";
import {
  EntityUpdatesSchema,
  EventUpdatesSchema,
  SubscriptionUpdateSchema,
} from "@spine-event-engine/proto/client";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { MessageNotifications } from "../src/message-notifications.js";

afterEach(cleanup);

it("retains only the latest permitted Event while consuming every delivery", async () => {
  let consumed = 0;
  const request = {
    createSubscription: vi.fn(async () => ({
      activate: async () => undefined,
      cancel: async () => undefined,
      updates: (async function* () {
        for (let index = 0; index < 150; index++) {
          consumed++;
          yield {
            kind: "update",
            update: posted(index === 149 ? "other" : "general", `Post ${index}`),
          };
        }
      })(),
    })),
  };
  render(createElement(MessageNotifications, { board: "general", request: request as never }));
  await waitFor(() => expect(consumed).toBe(150));
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByText("Post 148")).toBeTruthy();
  expect(screen.queryByText("Post 0")).toBeNull();
});

it("cancels a late-created Event stream after unmount without activating it", async () => {
  const pending = Promise.withResolvers<unknown>();
  const activate = vi.fn(async () => undefined);
  const cancel = vi.fn(async () => undefined);
  const request = { createSubscription: vi.fn(() => pending.promise) };
  const mounted = render(
    createElement(MessageNotifications, { board: "general", request: request as never }),
  );
  await waitFor(() => expect(request.createSubscription).toHaveBeenCalledOnce());
  mounted.unmount();
  pending.resolve({ activate, cancel, updates: (async function* () {})() });
  await pending.promise;
  await waitFor(() => expect(cancel).toHaveBeenCalled());
  expect(activate).not.toHaveBeenCalled();
});

it("reports a disconnected Event stream and ignores malformed deliveries", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const cancel = vi.fn(async () => undefined);
  const request = {
    createSubscription: vi.fn(async () => ({
      activate: async () => undefined,
      cancel,
      updates: (async function* () {
        yield { kind: "resynchronization", response: { message: [] } };
        yield {
          kind: "update",
          update: create(SubscriptionUpdateSchema, {
            update: { case: "entityUpdates", value: create(EntityUpdatesSchema) },
          }),
        };
        yield {
          kind: "update",
          update: create(SubscriptionUpdateSchema, {
            update: {
              case: "eventUpdates",
              value: create(EventUpdatesSchema, { event: [create(EventSchema)] }),
            },
          }),
        };
        throw new Error("stream disconnected");
      })(),
    })),
  };
  render(createElement(MessageNotifications, { board: "general", request: request as never }));
  await screen.findByText("Live notifications are unavailable. Reload to reconnect.");
  expect(screen.queryByRole("listitem")).toBeNull();
  expect(warning).toHaveBeenCalledWith("Message notifications disconnected.", expect.any(Error));
  expect(cancel).toHaveBeenCalled();
});

function posted(board: string, text: string) {
  return create(SubscriptionUpdateSchema, {
    update: {
      case: "eventUpdates",
      value: create(EventUpdatesSchema, {
        event: [
          create(EventSchema, {
            message: AnyPacker.pack(
              MessagePostedSchema,
              create(MessagePostedSchema, {
                board: create(BoardIdSchema, { value: board }),
                text,
              }),
            ),
          }),
        ],
      }),
    },
  });
}
