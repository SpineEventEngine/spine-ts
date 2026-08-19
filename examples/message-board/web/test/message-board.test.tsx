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
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  BoardMessageViewSchema,
  BoardIdSchema,
  MessageIdSchema,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { UserIdSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/user_pb.js";
import { AnyMessages } from "@spine-event-engine/core";
import {
  ConstraintViolationSchema,
  ErrorSchema,
  FieldPathSchema,
  TemplateStringSchema,
  ValidationErrorSchema,
} from "@spine-event-engine/proto";
import type {
  ClientOperationOptions,
  ClientOutcome,
  ClientRequest,
} from "@spine-event-engine/client-web";
import {
  EntityStateUpdateSchema,
  EntityUpdatesSchema,
  SubscriptionUpdateSchema,
  type Query,
} from "@spine-event-engine/proto/client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageBoardApp, type BoardSession } from "../src/index.js";

type FixtureOptions = ClientOperationOptions;
type FixtureSend = (
  query: Parameters<ClientRequest["send"]>[0],
  options?: FixtureOptions,
) => ReturnType<ClientRequest["send"]>;
type FixturePost = (
  schema: Parameters<ClientRequest["post"]>[0],
  message: Parameters<ClientRequest["post"]>[1],
  options?: FixtureOptions,
) => Promise<ClientOutcome>;

describe("MessageBoardApp", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("posts a PostMessage command and renders only the selected board query", async () => {
    const request = requestFixture();
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );

    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    await screen.findByText("general message");
    fillPost("Hello board");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(1));
    expect(request.post.mock.calls[0]?.[0].typeName).toBe(
      "spine.examples.messageboard.PostMessage",
    );
    expect((request.send.mock.calls[0]?.[0] as Query).format?.orderBy).toEqual([
      expect.objectContaining({ column: "posted_at", direction: 1 }),
    ]);
    expect(request.post.mock.calls[0]?.[1]).toMatchObject({ username: "Ada", text: "Hello board" });
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

  it("re-queries authoritatively after a lifecycle gap", async () => {
    const request = requestFixture();
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await waitFor(() => expect(request.subscription.activate).toHaveBeenCalledTimes(1));
    request.subscription.emitLifecycle({ state: "gapPossible", generation: 1 });
    await screen.findByText("No live updates");
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(2));
  });

  it("renders one authoritative recovery response without a duplicate board Query", async () => {
    const request = requestFixture();
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await waitFor(() => expect(request.subscription.activate).toHaveBeenCalledTimes(1));
    request.subscription.authoritativeQuery?.();
    request.subscription.emitRecovery(responseRows("recovered message"));
    await screen.findByText("recovered message");
    expect(request.subscription.authoritativeQuery).toHaveBeenCalledTimes(1);
    expect(request.send).toHaveBeenCalledTimes(1);
  });

  it("coalesces raw update hints into one in-flight refresh and one follow-up", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    request.query.resolve(responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitUpdate();
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    request.subscription.emitUpdate();
    request.query.resolveAt(1, responseRows("refresh one"));
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(3));
    request.query.resolveAt(2, responseRows("refresh two"));
    await screen.findByText("refresh two");
  });

  it("applies valid subscription payloads locally without another board query", async () => {
    const request = requestFixture({ initialRows: responseRows("initial") });
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );

    await screen.findByText("initial");
    request.subscription.emitUpdate(stateUpdate(view("live", "general", 2n)));
    await screen.findByText("live");
    request.subscription.emitUpdate(removeUpdate("initial"));
    await waitFor(() => expect(screen.queryByText("initial")).toBeNull());

    expect(request.send).toHaveBeenCalledTimes(1);
  });

  it("applies every payload from a burst before React renders", async () => {
    const request = requestFixture({ initialRows: responseRows("initial") });
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await screen.findByText("initial");

    request.subscription.emitUpdate(stateUpdate(view("burst one", "general", 2n)));
    request.subscription.emitUpdate(stateUpdate(view("burst two", "general", 3n)));

    await screen.findByText("burst one");
    await screen.findByText("burst two");
    expect(request.send).toHaveBeenCalledTimes(1);
  });

  it("coalesces malformed subscription payload recovery into one board query", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    request.query.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");

    request.subscription.emitUpdate(create(SubscriptionUpdateSchema));
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(2));
    request.subscription.emitUpdate(create(SubscriptionUpdateSchema));

    expect(request.send).toHaveBeenCalledTimes(2);
  });

  it("replaces local rows from reconnect recovery and coalesces a gap query", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    request.query.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitUpdate(stateUpdate(view("live")));
    await screen.findByText("live");

    request.subscription.emitRecovery(responseRows("reconnected"));
    await screen.findByText("reconnected");
    expect(screen.queryByText("live")).toBeNull();
    request.subscription.emitLifecycle({ state: "gapPossible", generation: 1 });
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(2));
    request.subscription.emitLifecycle({ state: "gapPossible", generation: 1 });

    expect(request.send).toHaveBeenCalledTimes(2);
  });

  it("keeps a newer live payload when an older recovery query completes", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    request.query.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitUpdate(create(SubscriptionUpdateSchema));
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(2));
    request.subscription.emitUpdate(stateUpdate(view("live", "general", 2n)));
    await screen.findByText("live");

    request.query.resolveAt(1, responseRows("stale recovery"));

    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(3));
    expect(screen.queryByText("stale recovery")).toBeNull();
    request.query.resolveAt(2, responseRows("current recovery"));
    await screen.findByText("current recovery");
  });

  it("keeps reconnect recovery when an older ordinary recovery completes", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    request.query.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitUpdate(create(SubscriptionUpdateSchema));
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(2));

    request.subscription.emitRecovery(responseRows("reconnected"));
    await screen.findByText("reconnected");
    request.query.resolveAt(1, responseRows("stale recovery"));
    await Promise.resolve();

    expect(screen.queryByText("stale recovery")).toBeNull();
    expect(screen.getByText("reconnected")).toBeTruthy();
  });

  it("coalesces multiple live payloads during one recovery into one follow-up query", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    request.query.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitUpdate(create(SubscriptionUpdateSchema));
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(2));
    request.subscription.emitUpdate(stateUpdate(view("live one", "general", 2n)));
    await screen.findByText("live one");
    request.subscription.emitUpdate(stateUpdate(view("live two", "general", 3n)));
    await screen.findByText("live two");

    request.query.resolveAt(1, responseRows("stale recovery"));

    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(3));
    expect(request.send).toHaveBeenCalledTimes(3);
  });

  it("ignores a board A recovery completion after switching boards", async () => {
    const request = requestFixture({ queuedQueries: true });
    const rendered = render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "board-a" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    request.query.resolveAt(0, responseBoardRows("board-a initial", "board-a"));
    await screen.findByText("board-a initial");
    request.subscription.emitUpdate(create(SubscriptionUpdateSchema));
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(2));

    rendered.rerender(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "board-b" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(3));
    request.query.resolveAt(1, responseBoardRows("board-a stale", "board-a"));
    request.query.resolveAt(2, responseBoardRows("board-b current", "board-b"));

    await screen.findByText("board-b current");
    expect(screen.queryByText("board-a stale")).toBeNull();
  });

  it("ignores a recovery completion after unmount", async () => {
    const request = requestFixture({ queuedQueries: true });
    const rendered = render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    request.query.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitUpdate(create(SubscriptionUpdateSchema));
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(2));
    const options = calledOptions(request.send, 1);

    rendered.unmount();
    request.query.resolveAt(1, responseRows("late recovery"));

    expect(options.signal.aborted).toBe(true);
    await Promise.resolve();
    expect(screen.queryByText("late recovery")).toBeNull();
  });

  it("keeps a post-success refresh queued when an earlier hint refresh rejects", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    request.query.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitUpdate();
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(2));
    fillPost("posted after rejected refresh");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(1));

    request.query.rejectAt(1, new Error("hint unavailable"));

    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(3));
    request.query.resolveAt(2, responseRows("posted after rejected refresh"));
    await screen.findByText("posted after rejected refresh");
  });

  it("does not start a second raw-hint refresh until the deferred first refresh settles", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    request.query.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitUpdate();
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(2));
    request.subscription.emitUpdate();
    expect(request.send).toHaveBeenCalledTimes(2);
    request.query.resolveAt(1, responseRows("first refresh"));
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(3));
    request.query.resolveAt(2, responseRows("second refresh"));
    await screen.findByText("second refresh");
  });

  it("aborts an in-flight hint refresh on unmount and ignores its late result", async () => {
    const request = requestFixture({ queuedQueries: true });
    const rendered = render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    request.query.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitUpdate();
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(2));
    const options = calledOptions(request.send, 1);
    rendered.unmount();
    expect(options.signal.aborted).toBe(true);
    request.query.resolveAt(1, responseRows("late refresh"));
    await Promise.resolve();
    expect(screen.queryByText("late refresh")).toBeNull();
  });

  it("keeps the initial board state when a best-effort hint refresh rejects", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    request.query.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitUpdate();
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(2));
    request.query.rejectAt(1, new Error("hint unavailable"));
    await Promise.resolve();
    expect(screen.getByText("initial")).toBeTruthy();
  });

  it("supersedes recovered state with a later normal board refresh", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    request.query.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitRecovery(responseRows("recovered"));
    await screen.findByText("recovered");
    request.subscription.emitUpdate();
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(2));
    request.query.resolveAt(1, responseRows("fresh"));
    await screen.findByText("fresh");
    expect(screen.queryByText("recovered")).toBeNull();
  });

  it("retains one deterministic command payload after failure and retries it once", async () => {
    const request = requestFixture({ postFailure: true });
    render(
      createElement(MessageBoardApp, {
        session: signedInSession(),
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
    expect(request.post).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe(
      " keep this ",
    );
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(2));
    const first = postPayload(request.post.mock.calls[0]?.[1]);
    const second = postPayload(request.post.mock.calls[1]?.[1]);
    expect(second).toMatchObject(first);
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe(
        "",
      ),
    );
  });

  it("submits blank fields to the server instead of duplicating Proto validation", async () => {
    const request = requestFixture();
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await screen.findByText("general message");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(1));
    expect(request.post.mock.calls[0]?.[1]).toMatchObject({ username: "", text: "" });
  });

  it("preserves entered whitespace for server-owned validation", async () => {
    const request = requestFixture();
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await screen.findByText("general message");
    fillPost(" keep this text ", " Ada ");

    fireEvent.click(screen.getByRole("button", { name: "Post message" }));

    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(1));
    expect(request.post.mock.calls[0]?.[1]).toMatchObject({
      username: " Ada ",
      text: " keep this text ",
    });
  });

  it("refreshes authoritative messages after a successful post while disconnected", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    request.query.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    fillPost("posted without update");

    fireEvent.click(screen.getByRole("button", { name: "Post message" }));

    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(2));
    request.query.resolveAt(1, responseRows("posted without update"));
    await screen.findByText("posted without update");
  });

  it("relies on a live payload after a successful post while connected", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const request = requestFixture({ queuedQueries: true });
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    request.query.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitLifecycle({ state: "connected", generation: 1 });
    await screen.findByText("Updating live");
    fillPost("posted live");

    fireEvent.click(screen.getByRole("button", { name: "Post message" }));

    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(1));
    expect(request.send).toHaveBeenCalledTimes(1);
    request.subscription.emitUpdate(stateUpdate(view("posted live", "general", 2n)));
    await screen.findByText("posted live");
    expect(request.send).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      "MessageBoard applied a server payload.",
      expect.objectContaining({ board: "general", rows: 2 }),
    );
  });

  it("refreshes when live updates disconnect before a successful post completes", async () => {
    const request = requestFixture({ queuedQueries: true, deferredPost: true });
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    request.query.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitLifecycle({ state: "connected", generation: 1 });
    await screen.findByText("Updating live");
    fillPost("disconnecting post");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(1));
    request.subscription.emitLifecycle({
      state: "failed",
      generation: 1,
      error: new Error("lost"),
    });

    request.postDeferred.resolve({ kind: "ok" });

    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(2));
  });

  it("avoids refresh when live updates connect before a successful post completes", async () => {
    const request = requestFixture({ queuedQueries: true, deferredPost: true });
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    request.query.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    fillPost("connecting post");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(1));
    request.subscription.emitLifecycle({ state: "connected", generation: 1 });
    await screen.findByText("Updating live");

    request.postDeferred.resolve({ kind: "ok" });

    await Promise.resolve();
    expect(request.send).toHaveBeenCalledTimes(1);
  });

  it("does not refresh after a failed post", async () => {
    const request = requestFixture({ postFailure: true });
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await screen.findByText("general message");
    fillPost("failed post");

    fireEvent.click(screen.getByRole("button", { name: "Post message" }));

    await screen.findByRole("alert");
    expect(request.send).toHaveBeenCalledTimes(1);
  });

  it("shows the username and message errors returned by the server", async () => {
    const request = requestFixture({ validationFailure: true });
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
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
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );

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
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
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
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
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
    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(1));
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
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );

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
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );

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
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await screen.findByText("general message");
    const message = screen.getByRole("textbox", { name: "Message" });
    expect(screen.getByText("⌘↵ or Ctrl+Enter to post")).toBeTruthy();

    fillPost("first shortcut");
    fireEvent.keyDown(message, { key: "Enter" });
    expect(request.post).not.toHaveBeenCalled();
    fireEvent.keyDown(message, { key: "Enter", metaKey: true });
    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(1));

    fillPost("second shortcut");
    fireEvent.keyDown(message, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(2));

    fillPost("composing shortcut");
    fireEvent.keyDown(message, { key: "Enter", ctrlKey: true, isComposing: true });
    expect(request.post).toHaveBeenCalledTimes(2);
  });

  it("refreshes the authoritative board after shortcut posting with a failed subscription", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    request.query.resolveAt(0, responseRows("initial"));
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

    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(2));
    request.query.resolveAt(1, responseRows("initial", "posted without subscription update"));
    await screen.findByText("posted without subscription update");
  });

  it("retries a resolved command rejection with its original payload", async () => {
    const request = requestFixture({ postResultFailure: true });
    render(
      createElement(MessageBoardApp, {
        session: signedInSession(),
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
    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(2));
    expect(request.post.mock.calls[1]?.[1]).toMatchObject(request.post.mock.calls[0]?.[1] as {});
  });

  it("aborts a deferred post and suppresses its late completion after unmount", async () => {
    const request = requestFixture({ deferredPost: true });
    const rendered = render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await screen.findByText("general message");
    fillPost("late post");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(1));
    const options = postedOptions(request.post, 0);
    rendered.unmount();
    expect(options.signal.aborted).toBe(true);
    request.postDeferred.resolve({ kind: "ok" });
    await Promise.resolve();
    expect(screen.queryByText("Message was not posted. Please retry.")).toBeNull();
  });

  it("suppresses a late rejected post after unmount", async () => {
    const request = requestFixture({ deferredPost: true });
    const rendered = render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await screen.findByText("general message");
    fillPost("late post");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
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
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "board-a" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    request.query.resolveAt(0, responseBoardRows("board-a initial", "board-a"));
    await screen.findByText("board-a initial");
    const oldSubscription = request.subscription;
    request.subscription.emitUpdate();
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(2));
    const refreshOptions = calledOptions(request.send, 1);
    fillPost("old message");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(1));
    const postOptions = postedOptions(request.post, 0);

    rendered.rerender(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "board-b" }),
    );

    expect(refreshOptions.signal.aborted).toBe(true);
    expect(postOptions.signal.aborted).toBe(true);
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(3));
    expect(oldSubscription.cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Post message" })).not.toHaveProperty(
      "disabled",
      true,
    );
    expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe(
      "",
    );
    request.query.resolveAt(2, responseBoardRows("board-b initial", "board-b"));
    await screen.findByText("board-b initial");
    expect(screen.queryByText("board-a initial")).toBeNull();
    oldSubscription.emitRecovery(responseBoardRows("retired board-a", "board-a"));
    await Promise.resolve();
    expect(screen.queryByText("retired board-a")).toBeNull();
    expect(screen.getByText("board-b initial")).toBeTruthy();
    fillPost("new message");
    fireEvent.click(screen.getByRole("button", { name: "Post message" }));
    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(2));
    request.subscription.emitUpdate();
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(4));
  });

  it("publishes neither late query state nor retained subscription after unmount", async () => {
    const request = requestFixture({ deferredQuery: true });
    const rendered = render(
      createElement(MessageBoardApp, { session: signedInSession(), request, board: "general" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    rendered.unmount();
    request.query.resolve(responseRows("late message"));
    await waitFor(() => expect(request.subscription.cancel).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("late message")).toBeNull();
  });
});

function guestSession(signIn: () => Promise<BoardSession>): BoardSession {
  return { status: "guest", signIn };
}

function signedInSession(): BoardSession {
  return { status: "signedIn", actor: "ada", signIn: async () => signedInSession() };
}

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
  } = {},
) {
  const queries = [Promise.withResolvers<ReturnType<typeof responseRows>>()];
  const postDeferred = Promise.withResolvers<ClientOutcome>();
  const subscriptions: ReturnType<typeof subscriptionFixture>[] = [];
  return {
    send: vi.fn<FixtureSend>(() => {
      if (fixtureOptions.deferredQuery) return queries[0]!.promise;
      if (fixtureOptions.queuedQueries) {
        const current = queries.at(-1)!;
        queries.push(Promise.withResolvers<ReturnType<typeof responseRows>>());
        return current.promise;
      }
      return Promise.resolve(
        fixtureOptions.initialRows ?? responseRows("general message", "other board message"),
      );
    }),
    post: fixturePost(fixtureOptions, postDeferred),
    createSubscription: vi.fn(async (_topic, subscriptionOptions) => {
      const subscription = subscriptionFixture({
        cancelEnds: !fixtureOptions.retainCancelledSubscription,
      });
      subscriptions.push(subscription);
      subscription.authoritativeQuery = vi.fn<() => unknown>(
        subscriptionOptions.authoritativeQuery,
      );
      return subscription;
    }),
    get subscription() {
      return subscriptions.at(-1)!;
    },
    query: {
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
    message: texts.map((text) => ({ state: AnyMessages.pack(BoardMessageViewSchema, view(text)) })),
  } as never;
}

function responseViews(rows: readonly ReturnType<typeof view>[]) {
  return {
    message: rows.map((row) => ({ state: AnyMessages.pack(BoardMessageViewSchema, row) })),
  } as never;
}

function responseBoardRows(text: string, board: string) {
  return {
    message: [{ state: AnyMessages.pack(BoardMessageViewSchema, view(text, board)) }],
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
            id: AnyMessages.pack(MessageIdSchema, value.id!),
            kind: { case: "state", value: AnyMessages.pack(BoardMessageViewSchema, value) },
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
            id: AnyMessages.pack(MessageIdSchema, create(MessageIdSchema, { value: id })),
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
  },
  deferred: PromiseWithResolvers<ClientOutcome>,
) {
  let attempts = 0;
  return vi.fn<FixturePost>(() => {
    attempts += 1;
    if (options.deferredPost) return deferred.promise;
    if (options.validationFailure) return Promise.resolve(validationOutcome());
    if (options.postResultFailure && attempts === 1)
      return Promise.resolve({ kind: "rejection", rejection: {} as never });
    if (options.postFailure && attempts === 1) return Promise.reject(new Error("post unavailable"));
    return Promise.resolve({ kind: "ok" });
  });
}

function validationOutcome(): ClientOutcome {
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
      details: AnyMessages.pack(ValidationErrorSchema, details),
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
  return {
    values: {
      [Symbol.asyncIterator]() {
        return {
          next: () =>
            new Promise<IteratorResult<T>>((resolve) => {
              if (closed) resolve({ done: true, value: undefined as never });
              else if (values.length > 0) resolve({ done: false, value: values.shift()! });
              else pending.push(resolve);
            }),
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
