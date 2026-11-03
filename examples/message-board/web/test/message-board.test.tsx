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
import { create, fromBinary, toBinary, type Message, type MessageShape } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  AnnouncementBoardViewSchema,
  BoardMessageViewSchema,
  BoardIdSchema,
  MessageIdSchema,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { UserIdSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/user_pb.js";
import { MessagePostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/events_pb.js";
import { MessageAlreadyPostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/rejections_pb.js";
import {
  PostMessageSchema,
  type PostMessage,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/commands_pb.js";
import { AnyPacker, TypeUrls } from "@spine-event-engine/core";
import {
  ConstraintViolationSchema,
  ErrorSchema,
  EventSchema,
  FieldPathSchema,
  TemplateStringSchema,
  ValidationErrorSchema,
} from "@spine-event-engine/proto";
import type {
  ClientOperationOptions,
  CommandAcknowledgement,
  ClientRequest,
  PostAndSubscribeOptions,
  PostAndSubscribeResult,
} from "@spine-event-engine/client-web";
import {
  EntityStateUpdateSchema,
  EntityStateWithVersionSchema,
  EntityUpdatesSchema,
  EventUpdatesSchema,
  QueryResponseSchema,
  SubscriptionUpdateSchema,
  type Query,
} from "@spine-event-engine/proto/client";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageBoardApp } from "../src/index.js";
import { ReadBoardStats } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/board_queries_app_query.js";

type FixtureOptions = ClientOperationOptions;
type FixtureSend = (
  query: Parameters<ClientRequest["send"]>[0],
  options?: FixtureOptions,
) => ReturnType<ClientRequest["send"]>;
type FixturePost = (
  schema: typeof PostMessageSchema,
  message: PostMessage,
  options: PostAndSubscribeOptions,
) => Promise<PostAndSubscribeResult>;
type FixtureSubscription = ReturnType<typeof subscriptionFixture> & {
  readonly kind: "event" | "message" | "announcement" | "other";
};

describe("MessageBoardApp", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("loads lifetime statistics through the typed App Query", async () => {
    const request = requestFixture();
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await waitFor(() =>
      expect(request.query).toHaveBeenCalledWith(
        expect.objectContaining({ $typeName: ReadBoardStats.querySchema.typeName }),
        expect.anything(),
      ),
    );
    await screen.findByRole("region", { name: "Board statistics" });
    expect(screen.getAllByText("No visible activity yet")).toHaveLength(2);
  });

  it("keeps the query result visible and reports a failed statistics Topic", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const request = requestFixture({ statsActivationFailure: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await screen.findByText("Live statistics updates are unavailable. Reload to reconnect.");
    expect(screen.getAllByText("No visible activity yet")).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith("Board statistics live updates failed.", expect.any(Error));
  });

  it("shows a permitted MessagePosted notification separately from Entity rows", async () => {
    const request = requestFixture();
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await waitFor(() => expect(request.eventSubscription.activate).toHaveBeenCalledOnce());
    request.eventSubscription.emitUpdate(
      eventUpdate(
        MessagePostedSchema,
        create(MessagePostedSchema, {
          id: create(MessageIdSchema, { value: "notice-1" }),
          board: create(BoardIdSchema, { value: "general" }),
          author: create(UserIdSchema, { value: "ada" }),
          username: "Anonymous",
          text: "A new public post",
          postedAt: create(TimestampSchema),
        }),
      ),
    );
    await screen.findByText("A new public post");
    expect(screen.getByRole("list", { name: "Messages" }).textContent).not.toContain(
      "A new public post",
    );
  });

  it("keeps the newer statistics result when an earlier request finishes after a reader switch", async () => {
    const first = requestFixture({ deferredStats: true });
    const second = requestFixture({ deferredStats: true });
    const rendered = render(
      createElement(MessageBoardApp, { actor: "ada", request: first, board: "general" }),
    );
    await waitFor(() => expect(first.query).toHaveBeenCalledOnce());
    rendered.rerender(
      createElement(MessageBoardApp, { actor: "reader", request: second, board: "general" }),
    );
    await waitFor(() => expect(second.query).toHaveBeenCalledOnce());
    second.statsDeferred.resolve({
      message: [
        create(ReadBoardStats.responseSchema, {
          board: {
            board: create(BoardIdSchema, { value: "general" }),
            messageCount: 2n,
            authorCount: 1n,
          },
        }),
      ],
    } as never);
    await screen.findByText(/2 messages/);
    await act(async () => {
      first.statsDeferred.resolve({
        message: [
          create(ReadBoardStats.responseSchema, {
            board: {
              board: create(BoardIdSchema, { value: "general" }),
              messageCount: 1n,
              authorCount: 1n,
            },
          }),
        ],
      } as never);
      await first.statsDeferred.promise;
    });
    expect(screen.getByRole("region", { name: "Board statistics" }).textContent).toContain(
      "2 messages",
    );
  });

  it("recovers a malformed announcement update with an authoritative read", async () => {
    const request = requestFixture();
    request.announcementSend.mockResolvedValueOnce(announcementResponse("Current notice"));
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await screen.findByText("Current notice");
    await waitFor(() => expect(request.announcementSubscription.activate).toHaveBeenCalledOnce());
    request.announcementSend.mockResolvedValueOnce(announcementResponse("Recovered notice"));
    request.announcementSubscription.emitUpdate(create(SubscriptionUpdateSchema));
    await screen.findByText("Recovered notice");
    expect(request.announcementSend).toHaveBeenCalledTimes(2);
  });

  it("keeps a newer announcement when an earlier recovery finishes late", async () => {
    const request = requestFixture();
    const pending = Promise.withResolvers<ReturnType<typeof announcementResponse>>();
    request.announcementSend.mockResolvedValueOnce(announcementResponse("Initial notice"));
    request.announcementSend.mockImplementationOnce(() => pending.promise as never);
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await screen.findByText("Initial notice");
    await waitFor(() => expect(request.announcementSubscription.activate).toHaveBeenCalledOnce());
    request.announcementSubscription.emitUpdate(create(SubscriptionUpdateSchema));
    await waitFor(() => expect(request.announcementSend).toHaveBeenCalledTimes(2));
    request.announcementSubscription.emitUpdate(announcementUpdate("Newer notice"));
    await screen.findByText("Newer notice");
    await act(async () => {
      pending.resolve(announcementResponse("Stale notice"));
      await pending.promise;
    });
    expect(screen.queryByText("Stale notice")).toBeNull();
    expect(screen.getByText("Newer notice")).toBeTruthy();
  });

  it("reports an announcement recovery failure and clears it on a later update", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const request = requestFixture();
    request.announcementSend.mockResolvedValueOnce(announcementResponse("Initial notice"));
    request.announcementSend.mockRejectedValueOnce(new Error("read failed"));
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await screen.findByText("Initial notice");
    await waitFor(() => expect(request.announcementSubscription.activate).toHaveBeenCalledOnce());
    request.announcementSubscription.emitUpdate(create(SubscriptionUpdateSchema));
    await screen.findByText("Announcements are unavailable. Reload to retry.");
    expect(warn).toHaveBeenCalledWith("Announcement recovery failed.", expect.any(Error));
    request.announcementSubscription.emitUpdate(announcementUpdate("Later notice"));
    await screen.findByText("Later notice");
    expect(screen.queryByText("Announcements are unavailable. Reload to retry.")).toBeNull();
  });

  it("applies an authoritative announcement resynchronization after an empty state", async () => {
    const request = requestFixture();
    request.announcementSend.mockResolvedValueOnce(
      create(QueryResponseSchema, { message: [create(EntityStateWithVersionSchema)] }),
    );
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await waitFor(() => expect(request.announcementSend).toHaveBeenCalledOnce());
    await waitFor(() => expect(request.announcementSubscription.activate).toHaveBeenCalledOnce());
    request.announcementSubscription.emitRecovery(announcementResponse("Resynchronized notice"));
    await screen.findByText("Resynchronized notice");
  });

  it("ignores a failed announcement recovery after the reader changes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const first = requestFixture();
    const second = requestFixture();
    const pending = Promise.withResolvers<ReturnType<typeof announcementResponse>>();
    first.announcementSend.mockResolvedValueOnce(announcementResponse("First notice"));
    first.announcementSend.mockImplementationOnce(() => pending.promise as never);
    second.announcementSend.mockResolvedValueOnce(announcementResponse("Second notice"));
    const mounted = render(
      createElement(MessageBoardApp, { actor: "ada", request: first, board: "general" }),
    );
    await screen.findByText("First notice");
    await waitFor(() => expect(first.announcementSubscription.activate).toHaveBeenCalledOnce());
    first.announcementSubscription.emitUpdate(create(SubscriptionUpdateSchema));
    await waitFor(() => expect(first.announcementSend).toHaveBeenCalledTimes(2));
    mounted.rerender(
      createElement(MessageBoardApp, { actor: "reader", request: second, board: "general" }),
    );
    await screen.findByText("Second notice");
    pending.reject(new Error("old reader unavailable"));
    await pending.promise.catch(() => undefined);
    expect(screen.getByText("Second notice")).toBeTruthy();
    expect(screen.queryByText("Announcements are unavailable. Reload to retry.")).toBeNull();
    expect(warn).not.toHaveBeenCalledWith("Announcement recovery failed.", expect.anything());
  });

  it("posts a PostMessage command and renders only the selected board query", async () => {
    const request = requestFixture();
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));

    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(1));
    await screen.findByText("general message");
    fillPost("Hello board");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.postCalls).toHaveBeenCalledTimes(1));
    expect(request.postCalls.mock.calls[0]?.[0].typeName).toBe(
      "spine.examples.messageboard.PostMessage",
    );
    expect((request.messageSend.mock.calls[0]?.[0] as Query).format?.orderBy).toEqual([
      expect.objectContaining({ column: "posted_at", direction: 1 }),
    ]);
    expect(request.postCalls.mock.calls[0]?.[1]).toMatchObject({
      username: "Ada",
      text: "Hello board",
    });
    await waitFor(() => {
      expect((screen.getByRole("textbox", { name: "Username" }) as HTMLInputElement).value).toBe(
        "Ada",
      );
      expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe(
        "",
      );
    });
    expect(screen.getByText("general message")).toBeTruthy();
    expect(screen.queryByText("other board message")).toBeNull();
  });

  it("keeps a post pending after its admission acknowledgement and late notice", async () => {
    const request = requestFixture({ deferredConfirmation: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await screen.findByText("general message");
    fillPost("Confirm me");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.postCalls).toHaveBeenCalledTimes(1));
    await screen.findByText("Message accepted; waiting for confirmation…");
    expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe(
      "Confirm me",
    );
    const options = request.postCalls.mock.calls[0]?.[2];
    await options?.onFirstUpdateTimeout?.(request.postSubscription);
    await screen.findByText("Still waiting for confirmation. Do not repost yet.");
    const message = request.postCalls.mock.calls[0]?.[1];
    if (message === undefined) throw new Error("Expected posted message.");
    request.postSubscription.emitUpdate(
      eventUpdate(
        MessagePostedSchema,
        create(MessagePostedSchema, {
          id: message.id,
          board: message.board,
          author: message.author,
          username: message.username,
          text: message.text,
          postedAt: message.postedAt,
        }),
      ),
    );
    await waitFor(() => expect(request.postSubscription.cancel).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe(
      "",
    );
  });

  it("ignores malformed and unrelated post outcomes until the matching Event arrives", async () => {
    const request = requestFixture({ deferredConfirmation: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await screen.findByText("general message");
    fillPost("Correlated outcome");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await screen.findByText("Message accepted; waiting for confirmation…");
    const command = request.postCalls.mock.calls[0]?.[1];
    if (command?.id === undefined) throw new Error("Expected posted message ID.");
    request.postSubscription.emitUpdate(create(SubscriptionUpdateSchema));
    request.postSubscription.emitUpdate(
      create(SubscriptionUpdateSchema, {
        update: {
          case: "eventUpdates",
          value: create(EventUpdatesSchema, { event: [create(EventSchema)] }),
        },
      }),
    );
    request.postSubscription.emitUpdate(
      eventUpdate(
        MessageAlreadyPostedSchema,
        create(MessageAlreadyPostedSchema, {
          id: create(MessageIdSchema, { value: "another-post" }),
        }),
      ),
    );
    await waitFor(() => expect(request.postSubscription.updatePulls).toHaveBeenCalledTimes(4));
    expect(screen.getByText("Message accepted; waiting for confirmation…")).toBeTruthy();
    expect(request.postSubscription.cancel).not.toHaveBeenCalled();
    request.postSubscription.emitUpdate(
      eventUpdate(
        MessagePostedSchema,
        create(MessagePostedSchema, {
          id: command.id,
          board: command.board,
          author: command.author,
          username: command.username,
          text: command.text,
          postedAt: command.postedAt,
        }),
      ),
    );
    await waitFor(() => expect(request.postSubscription.cancel).toHaveBeenCalledOnce());
    expect(screen.queryByText("Message accepted; waiting for confirmation…")).toBeNull();
  });

  it("shows a matching MessageAlreadyPosted rejection and cancels only its post stream", async () => {
    const request = requestFixture({ deferredConfirmation: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await screen.findByText("general message");
    fillPost("Duplicate");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await screen.findByText("Message accepted; waiting for confirmation…");
    const message = request.postCalls.mock.calls[0]?.[1];
    if (message?.id === undefined) throw new Error("Expected posted message ID.");
    request.postSubscription.emitUpdate(
      eventUpdate(
        MessageAlreadyPostedSchema,
        create(MessageAlreadyPostedSchema, { id: message.id }),
      ),
    );
    await screen.findByText("This message was already posted.");
    await waitFor(() => expect(request.postSubscription.cancel).toHaveBeenCalledTimes(1));
    expect(request.subscription.cancel).not.toHaveBeenCalled();
  });

  it("preserves an accepted post draft when confirmation ends without an outcome", async () => {
    const request = requestFixture({ deferredConfirmation: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await screen.findByText("general message");
    fillPost("Unconfirmed draft");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await screen.findByText("Message accepted; waiting for confirmation…");
    await request.postSubscription.cancel();
    await screen.findByText("Confirmation was interrupted. Check the board before retrying.");
    expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe(
      "Unconfirmed draft",
    );
    expect(request.postCalls).toHaveBeenCalledTimes(1);
  });

  it("re-queries authoritatively after a lifecycle gap", async () => {
    const request = requestFixture();
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await waitFor(() => expect(request.subscription.activate).toHaveBeenCalledTimes(1));
    request.subscription.emitLifecycle({ state: "gapPossible", generation: 1 });
    await screen.findByText("No live updates");
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(2));
  });

  it("renders one authoritative recovery response without a duplicate board Query", async () => {
    const request = requestFixture();
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await waitFor(() => expect(request.subscription.activate).toHaveBeenCalledTimes(1));
    request.subscription.authoritativeQuery?.();
    request.subscription.emitRecovery(responseRows("recovered message"));
    await screen.findByText("recovered message");
    expect(request.subscription.authoritativeQuery).toHaveBeenCalledTimes(1);
    expect(request.messageSend).toHaveBeenCalledTimes(1);
  });

  it("coalesces raw update hints into one in-flight refresh and one follow-up", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(1));
    request.queryDeferred.resolve(responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitUpdate();
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    request.subscription.emitUpdate();
    request.queryDeferred.resolveAt(1, responseRows("refresh one"));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(3));
    request.queryDeferred.resolveAt(2, responseRows("refresh two"));
    await screen.findByText("refresh two");
  });

  it("applies valid subscription payloads locally without another board query", async () => {
    const request = requestFixture({ initialRows: responseRows("initial") });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));

    await screen.findByText("initial");
    request.subscription.emitUpdate(stateUpdate(view("live", "general", 2n)));
    await screen.findByText("live");
    request.subscription.emitUpdate(removeUpdate("initial"));
    await waitFor(() => expect(screen.queryByText("initial")).toBeNull());

    expect(request.messageSend).toHaveBeenCalledTimes(1);
  });

  it("applies every payload from a burst before React renders", async () => {
    const request = requestFixture({ initialRows: responseRows("initial") });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await screen.findByText("initial");

    request.subscription.emitUpdate(stateUpdate(view("burst one", "general", 2n)));
    request.subscription.emitUpdate(stateUpdate(view("burst two", "general", 3n)));

    await screen.findByText("burst one");
    await screen.findByText("burst two");
    expect(request.messageSend).toHaveBeenCalledTimes(1);
  });

  it("coalesces malformed subscription payload recovery into one board query", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(1));
    request.queryDeferred.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");

    request.subscription.emitUpdate(create(SubscriptionUpdateSchema));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(2));
    request.subscription.emitUpdate(create(SubscriptionUpdateSchema));

    expect(request.messageSend).toHaveBeenCalledTimes(2);
  });

  it("replaces local rows from reconnect recovery and coalesces a gap query", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(1));
    request.queryDeferred.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitUpdate(stateUpdate(view("live")));
    await screen.findByText("live");

    request.subscription.emitRecovery(responseRows("reconnected"));
    await screen.findByText("reconnected");
    expect(screen.queryByText("live")).toBeNull();
    request.subscription.emitLifecycle({ state: "gapPossible", generation: 1 });
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(2));
    request.subscription.emitLifecycle({ state: "gapPossible", generation: 1 });

    expect(request.messageSend).toHaveBeenCalledTimes(2);
  });

  it("keeps a newer live payload when an older recovery query completes", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(1));
    request.queryDeferred.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitUpdate(create(SubscriptionUpdateSchema));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(2));
    request.subscription.emitUpdate(stateUpdate(view("live", "general", 2n)));
    await screen.findByText("live");

    request.queryDeferred.resolveAt(1, responseRows("stale recovery"));

    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(3));
    expect(screen.queryByText("stale recovery")).toBeNull();
    request.queryDeferred.resolveAt(2, responseRows("current recovery"));
    await screen.findByText("current recovery");
  });

  it("keeps reconnect recovery when an older ordinary recovery completes", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(1));
    request.queryDeferred.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitUpdate(create(SubscriptionUpdateSchema));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(2));

    request.subscription.emitRecovery(responseRows("reconnected"));
    await screen.findByText("reconnected");
    request.queryDeferred.resolveAt(1, responseRows("stale recovery"));
    await Promise.resolve();

    expect(screen.queryByText("stale recovery")).toBeNull();
    expect(screen.getByText("reconnected")).toBeTruthy();
  });

  it("coalesces multiple live payloads during one recovery into one follow-up query", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(1));
    request.queryDeferred.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitUpdate(create(SubscriptionUpdateSchema));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(2));
    request.subscription.emitUpdate(stateUpdate(view("live one", "general", 2n)));
    await screen.findByText("live one");
    request.subscription.emitUpdate(stateUpdate(view("live two", "general", 3n)));
    await screen.findByText("live two");

    request.queryDeferred.resolveAt(1, responseRows("stale recovery"));

    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(3));
    expect(request.messageSend).toHaveBeenCalledTimes(3);
  });

  it("ignores a board A recovery completion after switching boards", async () => {
    const request = requestFixture({ queuedQueries: true });
    const rendered = render(
      createElement(MessageBoardApp, { actor: "ada", request, board: "board-a" }),
    );
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(1));
    request.queryDeferred.resolveAt(0, responseBoardRows("board-a initial", "board-a"));
    await screen.findByText("board-a initial");
    request.subscription.emitUpdate(create(SubscriptionUpdateSchema));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(2));

    rendered.rerender(createElement(MessageBoardApp, { actor: "ada", request, board: "board-b" }));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(3));
    request.queryDeferred.resolveAt(1, responseBoardRows("board-a stale", "board-a"));
    request.queryDeferred.resolveAt(2, responseBoardRows("board-b current", "board-b"));

    await screen.findByText("board-b current");
    expect(screen.queryByText("board-a stale")).toBeNull();
  });

  it("ignores a recovery completion after unmount", async () => {
    const request = requestFixture({ queuedQueries: true });
    const rendered = render(
      createElement(MessageBoardApp, { actor: "ada", request, board: "general" }),
    );
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(1));
    request.queryDeferred.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitUpdate(create(SubscriptionUpdateSchema));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(2));
    const options = calledOptions(request.messageSend, 1);

    rendered.unmount();
    request.queryDeferred.resolveAt(1, responseRows("late recovery"));

    expect(options.signal.aborted).toBe(true);
    await Promise.resolve();
    expect(screen.queryByText("late recovery")).toBeNull();
  });

  it("keeps a post-success refresh queued when an earlier hint refresh rejects", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(1));
    request.queryDeferred.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitUpdate();
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(2));
    fillPost("posted after rejected refresh");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.postCalls).toHaveBeenCalledTimes(1));

    request.queryDeferred.rejectAt(1, new Error("hint unavailable"));

    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(3));
    request.queryDeferred.resolveAt(2, responseRows("posted after rejected refresh"));
    await screen.findByText("posted after rejected refresh");
  });

  it("does not start a second raw-hint refresh until the deferred first refresh settles", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(1));
    request.queryDeferred.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitUpdate();
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(2));
    request.subscription.emitUpdate();
    expect(request.messageSend).toHaveBeenCalledTimes(2);
    request.queryDeferred.resolveAt(1, responseRows("first refresh"));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(3));
    request.queryDeferred.resolveAt(2, responseRows("second refresh"));
    await screen.findByText("second refresh");
  });

  it("aborts an in-flight hint refresh on unmount and ignores its late result", async () => {
    const request = requestFixture({ queuedQueries: true });
    const rendered = render(
      createElement(MessageBoardApp, { actor: "ada", request, board: "general" }),
    );
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(1));
    request.queryDeferred.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitUpdate();
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(2));
    const options = calledOptions(request.messageSend, 1);
    rendered.unmount();
    expect(options.signal.aborted).toBe(true);
    request.queryDeferred.resolveAt(1, responseRows("late refresh"));
    await Promise.resolve();
    expect(screen.queryByText("late refresh")).toBeNull();
  });

  it("keeps the initial board state when a best-effort hint refresh rejects", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(1));
    request.queryDeferred.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitUpdate();
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(2));
    request.queryDeferred.rejectAt(1, new Error("hint unavailable"));
    await Promise.resolve();
    expect(screen.getByText("initial")).toBeTruthy();
  });

  it("supersedes recovered state with a later normal board refresh", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(1));
    request.queryDeferred.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitRecovery(responseRows("recovered"));
    await screen.findByText("recovered");
    request.subscription.emitUpdate();
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(2));
    request.queryDeferred.resolveAt(1, responseRows("fresh"));
    await screen.findByText("fresh");
    expect(screen.queryByText("recovered")).toBeNull();
  });

  it("retains one deterministic command payload after failure and retries it once", async () => {
    const request = requestFixture({ postFailure: true });
    render(
      createElement(MessageBoardApp, {
        actor: "ada",
        request,
        board: "general",
        createMessageId: () => "message-1",
      }),
    );
    await screen.findByText("general message");
    fillPost(" keep this ");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    fireEvent.submit(screen.getByRole("textbox", { name: "Message" }).closest("form")!);
    await screen.findByRole("alert");
    expect(request.postCalls).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe(
      " keep this ",
    );
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.postCalls).toHaveBeenCalledTimes(2));
    const first = postPayload(request.postCalls.mock.calls[0]?.[1]);
    const second = postPayload(request.postCalls.mock.calls[1]?.[1]);
    expect(second).toMatchObject(first);
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe(
        "",
      ),
    );
  });

  it("submits blank fields to the server instead of duplicating Proto validation", async () => {
    const request = requestFixture();
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await screen.findByText("general message");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.postCalls).toHaveBeenCalledTimes(1));
    expect(request.postCalls.mock.calls[0]?.[1]).toMatchObject({ username: "", text: "" });
  });

  it("preserves entered whitespace for server-owned validation", async () => {
    const request = requestFixture();
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await screen.findByText("general message");
    fillPost(" keep this text ", " Ada ");

    fireEvent.click(screen.getByRole("button", { name: "Post message" }));

    await waitFor(() => expect(request.postCalls).toHaveBeenCalledTimes(1));
    expect(request.postCalls.mock.calls[0]?.[1]).toMatchObject({
      username: " Ada ",
      text: " keep this text ",
    });
  });

  it("refreshes authoritative messages after a successful post while disconnected", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(1));
    request.queryDeferred.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    fillPost("posted without update");

    fireEvent.click(screen.getByRole("button", { name: "Post message" }));

    await waitFor(() => expect(request.postCalls).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(2));
    request.queryDeferred.resolveAt(1, responseRows("posted without update"));
    await screen.findByText("posted without update");
  });

  it("relies on a live payload after a successful post while connected", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const request = requestFixture({ queuedQueries: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(1));
    request.queryDeferred.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitLifecycle({ state: "connected", generation: 1 });
    await screen.findByText("Updating live");
    fillPost("posted live");

    fireEvent.click(screen.getByRole("button", { name: "Post message" }));

    await waitFor(() => expect(request.postCalls).toHaveBeenCalledTimes(1));
    expect(request.messageSend).toHaveBeenCalledTimes(1);
    request.subscription.emitUpdate(stateUpdate(view("posted live", "general", 2n)));
    await screen.findByText("posted live");
    expect(request.messageSend).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      "MessageBoard applied a server payload.",
      expect.objectContaining({ board: "general", rows: 2 }),
    );
  });

  it("refreshes when live updates disconnect before a successful post completes", async () => {
    const request = requestFixture({ queuedQueries: true, deferredPost: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(1));
    request.queryDeferred.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitLifecycle({ state: "connected", generation: 1 });
    await screen.findByText("Updating live");
    fillPost("disconnecting post");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.postCalls).toHaveBeenCalledTimes(1));
    request.subscription.emitLifecycle({
      state: "failed",
      generation: 1,
      error: new Error("lost"),
    });

    request.postDeferred.resolve({ kind: "ok" });

    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(2));
  });

  it("avoids refresh when live updates connect before a successful post completes", async () => {
    const request = requestFixture({ queuedQueries: true, deferredPost: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(1));
    request.queryDeferred.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    fillPost("connecting post");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.postCalls).toHaveBeenCalledTimes(1));
    request.subscription.emitLifecycle({ state: "connected", generation: 1 });
    await screen.findByText("Updating live");

    request.postDeferred.resolve({ kind: "ok" });

    await Promise.resolve();
    expect(request.messageSend).toHaveBeenCalledTimes(1);
  });

  it("does not refresh after a failed post", async () => {
    const request = requestFixture({ postFailure: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await screen.findByText("general message");
    fillPost("failed post");

    fireEvent.click(screen.getByRole("button", { name: "Post message" }));

    await screen.findByRole("alert");
    expect(request.messageSend).toHaveBeenCalledTimes(1);
  });

  it("shows the username and message errors returned by the server", async () => {
    const request = requestFixture({ validationFailure: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await screen.findByText("general message");

    fireEvent.click(screen.getByRole("button", { name: "Post message" }));

    expect(await screen.findByText("Enter a username.")).toBeTruthy();
    expect(screen.getByText("Enter a message.")).toBeTruthy();
    expect(screen.getByLabelText("Username").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Message").tagName).toBe("TEXTAREA");
    expect(document.activeElement).toBe(screen.getByLabelText("Username"));
  });

  it("renders shuffled messages from oldest to newest", async () => {
    const request = requestFixture({
      initialRows: responseViews([
        view("newest", "general", 3n),
        view("oldest", "general", 1n),
        view("middle", "general", 2n),
      ]),
    });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));

    await screen.findByText("newest");
    const messages = [...screen.getByRole("list", { name: "Messages" }).querySelectorAll("li")];
    expect(messages.map((item) => item.textContent)).toEqual([
      expect.stringContaining("oldest"),
      expect.stringContaining("middle"),
      expect.stringContaining("newest"),
    ]);
  });

  it("shows one lifecycle badge that only calls connected updates live", async () => {
    const request = requestFixture();
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await waitFor(() => expect(request.subscription.activate).toHaveBeenCalledTimes(1));
    expect(screen.getByText("No live updates")).toBeTruthy();
    request.subscription.emitLifecycle({ state: "connected", generation: 1 });
    await screen.findByText("Updating live");
    request.subscription.emitLifecycle({
      state: "failed",
      generation: 1,
      error: new Error("closed"),
    });
    await screen.findByText("No live updates");
    expect(screen.queryByText("Message updates disconnected.")).toBeNull();
    expect(screen.queryByText("Connected")).toBeNull();
  });

  it("narrates live subscription, server update, and command activity in the browser console", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const request = requestFixture();
    const rendered = render(
      createElement(MessageBoardApp, { actor: "ada", request, board: "general" }),
    );

    await waitFor(() => expect(request.subscription.activate).toHaveBeenCalledTimes(1));
    request.subscription.emitLifecycle({ state: "connecting", generation: 1, attempt: 0 });
    await waitFor(() => expect(info).toHaveBeenCalledTimes(2));
    request.subscription.emitLifecycle({ state: "connecting", generation: 2, attempt: 1 });
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    request.subscription.emitLifecycle({ state: "connected", generation: 2 });
    await waitFor(() => expect(info).toHaveBeenCalledTimes(3));
    request.subscription.emitUpdate();
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    const recovery = responseRows("recovered console message");
    request.subscription.emitRecovery(recovery);
    await waitFor(() => expect(info).toHaveBeenCalledTimes(4));
    request.subscription.emitLifecycle({
      state: "failed",
      generation: 2,
      error: new Error("network lost"),
    });
    await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    fillPost("console message");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.postCalls).toHaveBeenCalledTimes(1));
    rendered.unmount();

    expect(info).toHaveBeenCalledWith(
      "MessageBoard is activating live updates.",
      expect.objectContaining({ board: "general", target: expect.anything() }),
    );
    expect(info).toHaveBeenCalledWith(
      "MessageBoard live updates are connecting.",
      expect.objectContaining({ generation: 1 }),
    );
    expect(warn).toHaveBeenCalledWith(
      "MessageBoard live updates are reconnecting.",
      expect.objectContaining({ generation: 2 }),
    );
    expect(info).toHaveBeenCalledWith(
      "MessageBoard live updates are connected.",
      expect.objectContaining({ generation: 2 }),
    );
    expect(warn).toHaveBeenCalledWith(
      "MessageBoard is refreshing after an unusable live update.",
      expect.objectContaining({
        board: "general",
        target: expect.anything(),
        reason: "wrong-update",
      }),
    );
    expect(info).toHaveBeenCalledWith(
      "MessageBoard received authoritative board state after reconnecting.",
      expect.objectContaining({ board: "general", rows: 1 }),
    );
    expect(error).toHaveBeenCalledWith(
      "MessageBoard live updates failed.",
      expect.objectContaining({ generation: 2 }),
    );
    expect(info).toHaveBeenCalledWith("MessageBoard is sending a post command.", {
      board: "general",
    });
    expect(info).toHaveBeenCalledWith("MessageBoard post command was accepted.", {
      board: "general",
    });
    expect(info).toHaveBeenCalledWith(
      "MessageBoard is cancelling live updates.",
      expect.objectContaining({ board: "general" }),
    );
  });

  it("warns in the browser console when the server rejects a post command", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const request = requestFixture({ postResultFailure: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));

    await screen.findByText("general message");
    fillPost("rejected console message");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await screen.findByRole("alert");

    expect(warn).toHaveBeenCalledWith("MessageBoard post command was rejected.", {
      board: "general",
    });
  });

  it("reports a post transport failure in the browser console", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const request = requestFixture({ postFailure: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));

    await screen.findByText("general message");
    fillPost("failed console message");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await screen.findByRole("alert");

    expect(error).toHaveBeenCalledWith(
      "MessageBoard post command could not be sent.",
      expect.objectContaining({ board: "general" }),
    );
  });

  it("posts only on the platform shortcut and leaves composing Enter untouched", async () => {
    const request = requestFixture();
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await screen.findByText("general message");
    const message = screen.getByRole("textbox", { name: "Message" });
    expect(screen.getByText("⌘↵ or Ctrl+Enter to post")).toBeTruthy();

    fillPost("first shortcut");
    fireEvent.keyDown(message, { key: "Enter" });
    expect(request.postCalls).not.toHaveBeenCalled();
    fireEvent.keyDown(message, { key: "Enter", metaKey: true });
    await waitFor(() => expect(request.postCalls).toHaveBeenCalledTimes(1));

    fillPost("second shortcut");
    fireEvent.keyDown(message, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(request.postCalls).toHaveBeenCalledTimes(2));

    fillPost("composing shortcut");
    fireEvent.keyDown(message, { key: "Enter", ctrlKey: true, isComposing: true });
    expect(request.postCalls).toHaveBeenCalledTimes(2);
  });

  it("refreshes the authoritative board after shortcut posting with a failed subscription", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(createElement(MessageBoardApp, { actor: "ada", request, board: "general" }));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(1));
    request.queryDeferred.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    await waitFor(() => expect(request.subscription.activate).toHaveBeenCalledTimes(1));
    request.subscription.emitLifecycle({
      state: "failed",
      generation: 1,
      error: new Error("closed"),
    });
    await screen.findByText("No live updates");

    fillPost("posted without subscription update");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), {
      key: "Enter",
      metaKey: true,
    });

    await waitFor(() => expect(request.postCalls).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(2));
    request.queryDeferred.resolveAt(
      1,
      responseRows("initial", "posted without subscription update"),
    );
    await screen.findByText("posted without subscription update");
  });

  it("retries a resolved command rejection with its original payload", async () => {
    const request = requestFixture({ postResultFailure: true });
    render(
      createElement(MessageBoardApp, {
        actor: "ada",
        request,
        board: "general",
        createMessageId: () => "message-result-failure",
      }),
    );
    await screen.findByText("general message");
    fillPost("retry result");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.postCalls).toHaveBeenCalledTimes(2));
    expect(request.postCalls.mock.calls[1]?.[1]).toMatchObject(
      request.postCalls.mock.calls[0]?.[1] as {},
    );
  });

  it("aborts a deferred post and suppresses its late completion after unmount", async () => {
    const request = requestFixture({ deferredPost: true });
    const rendered = render(
      createElement(MessageBoardApp, { actor: "ada", request, board: "general" }),
    );
    await screen.findByText("general message");
    fillPost("late post");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.postCalls).toHaveBeenCalledTimes(1));
    const options = postedOptions(request.postCalls, 0);
    rendered.unmount();
    expect(options.signal.aborted).toBe(true);
    request.postDeferred.resolve({ kind: "ok" });
    await Promise.resolve();
    expect(screen.queryByText("Message was not posted. Please retry.")).toBeNull();
  });

  it("suppresses a late rejected post after unmount", async () => {
    const request = requestFixture({ deferredPost: true });
    const rendered = render(
      createElement(MessageBoardApp, { actor: "ada", request, board: "general" }),
    );
    await screen.findByText("general message");
    fillPost("late post");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.postCalls).toHaveBeenCalledTimes(1));
    rendered.unmount();
    request.postDeferred.reject(new Error("late post"));
    await Promise.resolve();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("abandons board A work and starts board B with clean board-owned state", async () => {
    const request = requestFixture({
      queuedQueries: true,
      deferredPost: true,
      retainCancelledSubscription: true,
    });
    const rendered = render(
      createElement(MessageBoardApp, { actor: "ada", request, board: "board-a" }),
    );
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(1));
    request.queryDeferred.resolveAt(0, responseBoardRows("board-a initial", "board-a"));
    await screen.findByText("board-a initial");
    const oldSubscription = request.subscription;
    request.subscription.emitUpdate();
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(2));
    const refreshOptions = calledOptions(request.messageSend, 1);
    fillPost("old message");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.postCalls).toHaveBeenCalledTimes(1));
    const postOptions = postedOptions(request.postCalls, 0);

    rendered.rerender(createElement(MessageBoardApp, { actor: "ada", request, board: "board-b" }));

    expect(refreshOptions.signal.aborted).toBe(true);
    expect(postOptions.signal.aborted).toBe(true);
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(3));
    expect(oldSubscription.cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Post message" })).not.toHaveProperty(
      "disabled",
      true,
    );
    expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe(
      "",
    );
    request.queryDeferred.resolveAt(2, responseBoardRows("board-b initial", "board-b"));
    await screen.findByText("board-b initial");
    expect(screen.queryByText("board-a initial")).toBeNull();
    oldSubscription.emitRecovery(responseBoardRows("retired board-a", "board-a"));
    await Promise.resolve();
    expect(screen.queryByText("retired board-a")).toBeNull();
    expect(screen.getByText("board-b initial")).toBeTruthy();
    fillPost("new message");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.postCalls).toHaveBeenCalledTimes(2));
    request.subscription.emitUpdate();
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(4));
  });

  it("publishes neither late query state nor retained subscription after unmount", async () => {
    const request = requestFixture({ deferredQuery: true });
    const rendered = render(
      createElement(MessageBoardApp, { actor: "ada", request, board: "general" }),
    );
    await waitFor(() => expect(request.messageSend).toHaveBeenCalledTimes(1));
    rendered.unmount();
    request.queryDeferred.resolve(responseRows("late message"));
    await waitFor(() => expect(request.subscription.cancel).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("late message")).toBeNull();
  });
});

function fillPost(text: string, username = "Ada"): void {
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: username } });
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: text } });
}

function requestFixture(
  fixtureOptions: {
    deferredQuery?: boolean;
    queuedQueries?: boolean;
    postFailure?: boolean;
    postResultFailure?: boolean;
    validationFailure?: boolean;
    initialRows?: ReturnType<typeof responseRows>;
    deferredPost?: boolean;
    retainCancelledSubscription?: boolean;
    deferredConfirmation?: boolean;
    deferredStats?: boolean;
    statsActivationFailure?: boolean;
  } = {},
) {
  const queries = [Promise.withResolvers<ReturnType<typeof responseRows>>()];
  const postDeferred = Promise.withResolvers<CommandAcknowledgement>();
  const statsDeferred = Promise.withResolvers<Awaited<ReturnType<ClientRequest["query"]>>>();
  const subscriptions: FixtureSubscription[] = [];
  const postSubscriptions: ReturnType<typeof subscriptionFixture>[] = [];
  const postCalls = fixturePost(fixtureOptions, postDeferred, postSubscriptions);
  const messageSend = vi.fn<FixtureSend>(() => {
    if (fixtureOptions.deferredQuery) return queries[0]!.promise;
    if (fixtureOptions.queuedQueries) {
      const current = queries.at(-1)!;
      queries.push(Promise.withResolvers<ReturnType<typeof responseRows>>());
      return current.promise;
    }
    return Promise.resolve(
      fixtureOptions.initialRows ?? responseRows("general message", "other board message"),
    );
  });
  const announcementSend = vi.fn<FixtureSend>(() => Promise.resolve({ message: [] } as never));
  return {
    messageSend,
    announcementSend,
    postCalls,
    statsDeferred,
    post: vi.fn<ClientRequest["post"]>(() => Promise.resolve({ kind: "ok" })),
    query: vi.fn<ClientRequest["query"]>(() =>
      fixtureOptions.deferredStats
        ? statsDeferred.promise
        : Promise.resolve({ message: [] } as never),
    ),
    send: vi.fn<FixtureSend>((query, options) => {
      const built = "build" in query ? query.build() : query;
      return built.target?.type === TypeUrls.derive(BoardMessageViewSchema)
        ? messageSend(built, options)
        : built.target?.type === TypeUrls.derive(AnnouncementBoardViewSchema)
          ? announcementSend(built, options)
          : Promise.resolve({ message: [] } as never);
    }),
    postAndSubscribe<Schema extends GenMessage<Message>>(
      schema: Schema,
      message: MessageShape<Schema>,
      options: PostAndSubscribeOptions,
    ): Promise<PostAndSubscribeResult> {
      if (schema.typeName !== PostMessageSchema.typeName)
        return Promise.reject(new TypeError("Fixture expects a PostMessage Command."));
      return postCalls(
        PostMessageSchema,
        fromBinary(PostMessageSchema, toBinary(schema, message)),
        options,
      );
    },
    createSubscription: vi.fn(async (topic, subscriptionOptions) => {
      const kind: FixtureSubscription["kind"] = Array.isArray(topic)
        ? "event"
        : topic.target?.type === TypeUrls.derive(BoardMessageViewSchema)
          ? "message"
          : topic.target?.type === TypeUrls.derive(AnnouncementBoardViewSchema)
            ? "announcement"
            : "other";
      const subscription = Object.assign(
        subscriptionFixture({
          cancelEnds: !(
            fixtureOptions.retainCancelledSubscription &&
            topic.target?.type === TypeUrls.derive(BoardMessageViewSchema)
          ),
        }),
        { kind },
      );
      subscriptions.push(subscription);
      if (subscription.kind === "other" && fixtureOptions.statsActivationFailure)
        subscription.activate.mockRejectedValue(new Error("statistics Topic unavailable"));
      subscription.authoritativeQuery = vi.fn<() => unknown>(
        subscriptionOptions.authoritativeQuery,
      );
      return subscription;
    }),
    get subscription() {
      return subscriptions.filter((item) => item.kind === "message").at(-1)!;
    },
    get eventSubscription() {
      return subscriptions.filter((item) => item.kind === "event").at(-1)!;
    },
    get announcementSubscription() {
      return subscriptions.filter((item) => item.kind === "announcement").at(-1)!;
    },
    get postSubscription() {
      return postSubscriptions.at(-1)!;
    },
    queryDeferred: {
      resolve(value: ReturnType<typeof responseRows>) {
        queries[0]!.resolve(value);
      },
      resolveAt(index: number, value: ReturnType<typeof responseRows>) {
        queries[index]!.resolve(value);
      },
      rejectAt(index: number, error: Error) {
        queries[index]!.reject(error);
      },
    },
    postDeferred,
  };
}

function responseRows(...texts: string[]) {
  return {
    message: texts.map((text) => ({ state: AnyPacker.pack(BoardMessageViewSchema, view(text)) })),
  } as never;
}

function announcementResponse(text: string) {
  return {
    message: [{ state: AnyPacker.pack(AnnouncementBoardViewSchema, announcementView(text)) }],
  } as never;
}

function announcementView(text: string) {
  return create(AnnouncementBoardViewSchema, {
    id: create(BoardIdSchema, { value: "announcements" }),
    message: create(MessageIdSchema, { value: text }),
    text,
  });
}

function announcementUpdate(text: string) {
  const view = announcementView(text);
  return create(SubscriptionUpdateSchema, {
    update: {
      case: "entityUpdates",
      value: create(EntityUpdatesSchema, {
        update: [
          create(EntityStateUpdateSchema, {
            id: AnyPacker.pack(BoardIdSchema, view.id!),
            kind: { case: "state", value: AnyPacker.pack(AnnouncementBoardViewSchema, view) },
          }),
        ],
      }),
    },
  });
}

function responseViews(rows: readonly ReturnType<typeof view>[]) {
  return {
    message: rows.map((row) => ({ state: AnyPacker.pack(BoardMessageViewSchema, row) })),
  } as never;
}

function responseBoardRows(text: string, board: string) {
  return {
    message: [{ state: AnyPacker.pack(BoardMessageViewSchema, view(text, board)) }],
  } as never;
}

function view(
  text: string,
  board = text.startsWith("other") ? "other" : "general",
  postedSeconds = 1n,
) {
  return create(BoardMessageViewSchema, {
    id: create(MessageIdSchema, { value: text }),
    board: create(BoardIdSchema, { value: board }),
    author: create(UserIdSchema, { value: "ada" }),
    username: "Ada",
    text,
    postedAt: create(TimestampSchema, { seconds: postedSeconds }),
  });
}

function stateUpdate(value: ReturnType<typeof view>) {
  return create(SubscriptionUpdateSchema, {
    update: {
      case: "entityUpdates",
      value: create(EntityUpdatesSchema, {
        update: [
          create(EntityStateUpdateSchema, {
            id: AnyPacker.pack(MessageIdSchema, value.id!),
            kind: { case: "state", value: AnyPacker.pack(BoardMessageViewSchema, value) },
          }),
        ],
      }),
    },
  });
}

function removeUpdate(id: string) {
  return create(SubscriptionUpdateSchema, {
    update: {
      case: "entityUpdates",
      value: create(EntityUpdatesSchema, {
        update: [
          create(EntityStateUpdateSchema, {
            id: AnyPacker.pack(MessageIdSchema, create(MessageIdSchema, { value: id })),
            kind: { case: "noLongerMatching", value: true },
          }),
        ],
      }),
    },
  });
}

function subscriptionFixture(options: { readonly cancelEnds?: boolean } = {}) {
  const lifecycle = queue<never>();
  const updates = queue<never>();
  return {
    activate: vi.fn(async () => undefined),
    cancel: vi.fn(async () => {
      if (options.cancelEnds !== false) {
        lifecycle.close();
        updates.close();
      }
    }),
    lifecycle: lifecycle.values,
    updates: updates.values,
    updatePulls: updates.nextRequested,
    authoritativeQuery: undefined as undefined | ReturnType<typeof vi.fn<() => unknown>>,
    emitLifecycle(value: unknown) {
      lifecycle.push(value as never);
    },
    emitRecovery(response: ReturnType<typeof responseRows>) {
      updates.push({ kind: "resynchronization", response } as never);
    },
    emitUpdate(update: unknown = create(SubscriptionUpdateSchema)) {
      updates.push({ kind: "update", update } as never);
    },
  };
}

function fixturePost(
  options: {
    readonly deferredPost?: boolean;
    readonly postResultFailure?: boolean;
    readonly validationFailure?: boolean;
    readonly postFailure?: boolean;
    readonly deferredConfirmation?: boolean;
  },
  deferred: PromiseWithResolvers<CommandAcknowledgement>,
  postSubscriptions: ReturnType<typeof subscriptionFixture>[],
) {
  let attempts = 0;
  return vi.fn<FixturePost>(async (_schema, message) => {
    attempts += 1;
    if (options.deferredPost)
      return postResult(
        await deferred.promise,
        message,
        postSubscriptions,
        options.deferredConfirmation,
      );
    if (options.validationFailure)
      return postResult(
        validationOutcome(),
        message,
        postSubscriptions,
        options.deferredConfirmation,
      );
    if (message.username.length === 0 || message.text.length === 0)
      return postResult(
        validationOutcome(),
        message,
        postSubscriptions,
        options.deferredConfirmation,
      );
    if (options.postResultFailure && attempts === 1)
      return postResult(
        { kind: "rejection", rejection: {} as never },
        message,
        postSubscriptions,
        options.deferredConfirmation,
      );
    if (options.postFailure && attempts === 1) throw new Error("post unavailable");
    return postResult({ kind: "ok" }, message, postSubscriptions, options.deferredConfirmation);
  });
}

function postResult(
  acknowledgement: CommandAcknowledgement,
  message: PostMessage,
  postSubscriptions: ReturnType<typeof subscriptionFixture>[],
  deferredConfirmation = false,
): PostAndSubscribeResult {
  if (acknowledgement.kind !== "ok") return { kind: "refused", acknowledgement };
  const subscription = subscriptionFixture();
  postSubscriptions.push(subscription);
  if (!deferredConfirmation)
    queueMicrotask(() =>
      subscription.emitUpdate(
        eventUpdate(
          MessagePostedSchema,
          create(MessagePostedSchema, {
            id: message.id,
            board: message.board,
            author: message.author,
            username: message.username,
            text: message.text,
            postedAt: message.postedAt,
          }),
        ),
      ),
    );
  return { kind: "accepted", acknowledgement, subscription };
}

function eventUpdate(
  schema: typeof MessagePostedSchema | typeof MessageAlreadyPostedSchema,
  message:
    | ReturnType<typeof create<typeof MessagePostedSchema>>
    | ReturnType<typeof create<typeof MessageAlreadyPostedSchema>>,
) {
  return create(SubscriptionUpdateSchema, {
    update: {
      case: "eventUpdates",
      value: create(EventUpdatesSchema, {
        event: [
          create(EventSchema, {
            message: AnyPacker.pack(schema as typeof MessagePostedSchema, message as never),
          }),
        ],
      }),
    },
  });
}

function validationOutcome(): CommandAcknowledgement {
  const details = create(ValidationErrorSchema, {
    constraintViolation: [
      create(ConstraintViolationSchema, {
        fieldPath: create(FieldPathSchema, { fieldName: ["username"] }),
        message: create(TemplateStringSchema, { withPlaceholders: "Enter a username." }),
      }),
      create(ConstraintViolationSchema, {
        fieldPath: create(FieldPathSchema, { fieldName: ["text"] }),
        message: create(TemplateStringSchema, { withPlaceholders: "Enter a message." }),
      }),
    ],
  });
  return {
    kind: "error",
    error: create(ErrorSchema, {
      type: "COMMAND_VALIDATION_ERROR",
      details: AnyPacker.pack(ValidationErrorSchema, details),
    }),
  };
}

function calledOptions(
  mock: ReturnType<typeof vi.fn<FixtureSend>>,
  index: number,
): FixtureOptions & { signal: AbortSignal } {
  const options = mock.mock.calls[index]?.[1];
  if (options?.signal === undefined)
    throw new Error("Expected request options with an AbortSignal.");
  return { signal: options.signal };
}

function postedOptions(
  mock: ReturnType<typeof vi.fn<FixturePost>>,
  index: number,
): FixtureOptions & { signal: AbortSignal } {
  const options = mock.mock.calls[index]?.[2];
  if (options?.signal === undefined) throw new Error("Expected post options with an AbortSignal.");
  return { signal: options.signal };
}

function postPayload(message: unknown): {
  readonly id: { readonly value: string };
  readonly text: string;
} {
  if (typeof message !== "object" || message === null)
    throw new Error("Expected a posted message.");
  const record = message as Record<string, unknown>;
  const id = record.id;
  if (typeof id !== "object" || id === null) throw new Error("Expected a posted message ID.");
  const identifier = (id as Record<string, unknown>).value;
  if (typeof identifier !== "string" || typeof record.text !== "string")
    throw new Error("Expected a posted message payload.");
  return { id: { value: identifier }, text: record.text };
}

function queue<T>() {
  const pending: ((result: IteratorResult<T>) => void)[] = [];
  const values: T[] = [];
  let closed = false;
  const nextRequested = vi.fn();
  return {
    nextRequested,
    values: {
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            nextRequested();
            return new Promise<IteratorResult<T>>((resolve) => {
              if (closed) resolve({ done: true, value: undefined as never });
              else if (values.length > 0) resolve({ done: false, value: values.shift()! });
              else pending.push(resolve);
            });
          },
        };
      },
    } as AsyncIterable<T>,
    push(value: T) {
      const resolve = pending.shift();
      if (resolve === undefined) values.push(value);
      else resolve({ done: false, value });
    },
    close() {
      closed = true;
      for (const resolve of pending.splice(0)) resolve({ done: true, value: undefined as never });
    },
  };
}
