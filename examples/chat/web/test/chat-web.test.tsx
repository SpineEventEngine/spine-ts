// @vitest-environment jsdom
import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  ChatMessageViewSchema,
  ChatRoomIdSchema,
  MessageIdSchema,
} from "@spine-event-engine/example-chat-model/generated/spine/examples/chat/chat_pb.js";
import { UserIdSchema } from "@spine-event-engine/example-chat-model/generated/spine/examples/chat/users_pb.js";
import { AnyMessages } from "@spine-event-engine/core";
import type {
  ClientOperationOptions,
  ClientOutcome,
  ClientRequest,
} from "@spine-event-engine/client-web";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatBrowserApp, type BrowserChatSession } from "../src/index.js";

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

describe("ChatBrowserApp", () => {
  afterEach(cleanup);

  it("keeps sign-in application-owned before it starts Chat client work", async () => {
    const signIn = vi.fn(async () => signedInSession());
    const request = requestFixture();
    render(
      createElement(ChatBrowserApp, { session: guestSession(signIn), request, room: "general" }),
    );

    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(request.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
  });

  it("shows a rejected sign-in and permits a successful retry", async () => {
    const request = requestFixture();
    const signIn = vi
      .fn<() => Promise<BrowserChatSession>>()
      .mockRejectedValueOnce(new Error("sign-in unavailable"))
      .mockResolvedValueOnce(signedInSession());
    render(
      createElement(ChatBrowserApp, { session: guestSession(signIn), request, room: "general" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
  });

  it("does not publish a late sign-in completion after unmount", async () => {
    const deferred = Promise.withResolvers<BrowserChatSession>();
    const request = requestFixture();
    const rendered = render(
      createElement(ChatBrowserApp, {
        session: guestSession(() => deferred.promise),
        request,
        room: "general",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    rendered.unmount();
    deferred.resolve(signedInSession());
    await Promise.resolve();
    expect(request.send).not.toHaveBeenCalled();
  });

  it("posts a PostMessage command and renders only the selected room query", async () => {
    const request = requestFixture();
    render(createElement(ChatBrowserApp, { session: signedInSession(), request, room: "general" }));

    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    await screen.findByText("general message");
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello room" } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(1));
    expect(request.post.mock.calls[0]?.[0].typeName).toBe("spine.examples.chat.PostMessage");
    expect(screen.getByText("general message")).toBeTruthy();
    expect(screen.queryByText("other room message")).toBeNull();
  });

  it("shows a lifecycle gap and performs an authoritative room re-query", async () => {
    const request = requestFixture();
    render(createElement(ChatBrowserApp, { session: signedInSession(), request, room: "general" }));
    await waitFor(() => expect(request.subscription.activate).toHaveBeenCalledTimes(1));
    request.subscription.emitLifecycle({ state: "gapPossible", generation: 1 });
    await waitFor(() =>
      expect(screen.getByText("Updates may be incomplete; refreshing messages.")).toBeTruthy(),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(2));
  });

  it("renders one authoritative recovery response without a duplicate room Query", async () => {
    const request = requestFixture();
    render(createElement(ChatBrowserApp, { session: signedInSession(), request, room: "general" }));
    await waitFor(() => expect(request.subscription.activate).toHaveBeenCalledTimes(1));
    request.subscription.authoritativeQuery?.();
    request.subscription.emitRecovery(responseRows("recovered message"));
    await screen.findByText("recovered message");
    expect(request.subscription.authoritativeQuery).toHaveBeenCalledTimes(1);
    expect(request.send).toHaveBeenCalledTimes(1);
  });

  it("coalesces raw update hints into one in-flight refresh and one follow-up", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(createElement(ChatBrowserApp, { session: signedInSession(), request, room: "general" }));
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

  it("does not start a second raw-hint refresh until the deferred first refresh settles", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(createElement(ChatBrowserApp, { session: signedInSession(), request, room: "general" }));
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
      createElement(ChatBrowserApp, { session: signedInSession(), request, room: "general" }),
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

  it("keeps the initial room state when a best-effort hint refresh rejects", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(createElement(ChatBrowserApp, { session: signedInSession(), request, room: "general" }));
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    request.query.resolveAt(0, responseRows("initial"));
    await screen.findByText("initial");
    request.subscription.emitUpdate();
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(2));
    request.query.rejectAt(1, new Error("hint unavailable"));
    await Promise.resolve();
    expect(screen.getByText("initial")).toBeTruthy();
  });

  it("supersedes recovered state with a later normal room refresh", async () => {
    const request = requestFixture({ queuedQueries: true });
    render(createElement(ChatBrowserApp, { session: signedInSession(), request, room: "general" }));
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
      createElement(ChatBrowserApp, {
        session: signedInSession(),
        request,
        room: "general",
        createMessageId: () => "message-1",
      }),
    );
    await screen.findByText("general message");
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: " keep this " } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    fireEvent.submit(screen.getByRole("textbox", { name: "Message" }).closest("form")!);
    await screen.findByRole("alert");
    expect(request.post).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("textbox", { name: "Message" }) as HTMLInputElement).value).toBe(
      " keep this ",
    );
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(2));
    const first = postPayload(request.post.mock.calls[0]?.[1]);
    const second = postPayload(request.post.mock.calls[1]?.[1]);
    expect(second).toMatchObject(first);
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Message" }) as HTMLInputElement).value).toBe(""),
    );
  });

  it("does not post a blank message", async () => {
    const request = requestFixture();
    render(createElement(ChatBrowserApp, { session: signedInSession(), request, room: "general" }));
    await screen.findByText("general message");
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    expect(request.post).not.toHaveBeenCalled();
  });

  it("shows a failed subscription lifecycle notice", async () => {
    const request = requestFixture();
    render(createElement(ChatBrowserApp, { session: signedInSession(), request, room: "general" }));
    await waitFor(() => expect(request.subscription.activate).toHaveBeenCalledTimes(1));
    request.subscription.emitLifecycle({
      state: "failed",
      generation: 1,
      error: new Error("closed"),
    });
    await screen.findByText("Message updates disconnected.");
  });

  it("retries a resolved command rejection with its original payload", async () => {
    const request = requestFixture({ postResultFailure: true });
    render(
      createElement(ChatBrowserApp, {
        session: signedInSession(),
        request,
        room: "general",
        createMessageId: () => "message-result-failure",
      }),
    );
    await screen.findByText("general message");
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "retry result" } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(2));
    expect(request.post.mock.calls[1]?.[1]).toMatchObject(request.post.mock.calls[0]?.[1] as {});
  });

  it("aborts a deferred post and suppresses its late completion after unmount", async () => {
    const request = requestFixture({ deferredPost: true });
    const rendered = render(
      createElement(ChatBrowserApp, { session: signedInSession(), request, room: "general" }),
    );
    await screen.findByText("general message");
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "late post" } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(1));
    const options = postedOptions(request.post, 0);
    rendered.unmount();
    expect(options.signal.aborted).toBe(true);
    request.postDeferred.resolve({ kind: "ok" });
    await Promise.resolve();
    expect(screen.queryByText("Message was not posted. Please retry.")).toBeNull();
  });

  it("abandons room A work and starts room B with clean room-owned state", async () => {
    const request = requestFixture({ queuedQueries: true, deferredPost: true });
    const rendered = render(
      createElement(ChatBrowserApp, { session: signedInSession(), request, room: "room-a" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    request.query.resolveAt(0, responseRoomRows("room-a initial", "room-a"));
    await screen.findByText("room-a initial");
    const oldSubscription = request.subscription;
    request.subscription.emitUpdate();
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(2));
    const refreshOptions = calledOptions(request.send, 1);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "old message" } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(1));
    const postOptions = postedOptions(request.post, 0);

    rendered.rerender(
      createElement(ChatBrowserApp, { session: signedInSession(), request, room: "room-b" }),
    );

    expect(refreshOptions.signal.aborted).toBe(true);
    expect(postOptions.signal.aborted).toBe(true);
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(3));
    expect(oldSubscription.cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Post" })).not.toHaveProperty("disabled", true);
    expect((screen.getByRole("textbox", { name: "Message" }) as HTMLInputElement).value).toBe("");
    request.query.resolveAt(2, responseRoomRows("room-b initial", "room-b"));
    await screen.findByText("room-b initial");
    expect(screen.queryByText("room-a initial")).toBeNull();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "new message" } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(request.post).toHaveBeenCalledTimes(2));
    request.subscription.emitUpdate();
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(4));
  });

  it("publishes neither late query state nor retained subscription after unmount", async () => {
    const request = requestFixture({ deferredQuery: true });
    const rendered = render(
      createElement(ChatBrowserApp, { session: signedInSession(), request, room: "general" }),
    );
    await waitFor(() => expect(request.send).toHaveBeenCalledTimes(1));
    rendered.unmount();
    request.query.resolve(responseRows("late message"));
    await waitFor(() => expect(request.subscription.cancel).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("late message")).toBeNull();
  });
});

function guestSession(signIn: () => Promise<BrowserChatSession>): BrowserChatSession {
  return { status: "guest", signIn };
}

function signedInSession(): BrowserChatSession {
  return { status: "signedIn", actor: "ada", signIn: async () => signedInSession() };
}

function requestFixture(
  options: {
    deferredQuery?: boolean;
    queuedQueries?: boolean;
    postFailure?: boolean;
    postResultFailure?: boolean;
    deferredPost?: boolean;
  } = {},
) {
  const queries = [Promise.withResolvers<ReturnType<typeof responseRows>>()];
  const postDeferred = Promise.withResolvers<ClientOutcome>();
  const subscriptions: ReturnType<typeof subscriptionFixture>[] = [];
  return {
    send: vi.fn<FixtureSend>(() => {
      if (options.deferredQuery) return queries[0]!.promise;
      if (options.queuedQueries) {
        const current = queries.at(-1)!;
        queries.push(Promise.withResolvers<ReturnType<typeof responseRows>>());
        return current.promise;
      }
      return Promise.resolve(responseRows("general message", "other room message"));
    }),
    post: fixturePost(options, postDeferred),
    createSubscription: vi.fn(async (_topic, options) => {
      const subscription = subscriptionFixture();
      subscriptions.push(subscription);
      subscription.authoritativeQuery = vi.fn<() => unknown>(options.authoritativeQuery);
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
    message: texts.map((text) => ({ state: AnyMessages.pack(ChatMessageViewSchema, view(text)) })),
  } as never;
}

function responseRoomRows(text: string, room: string) {
  return {
    message: [{ state: AnyMessages.pack(ChatMessageViewSchema, view(text, room)) }],
  } as never;
}

function view(text: string, room = text.startsWith("other") ? "other" : "general") {
  return create(ChatMessageViewSchema, {
    id: create(MessageIdSchema, { value: text }),
    room: create(ChatRoomIdSchema, { value: room }),
    author: create(UserIdSchema, { value: "ada" }),
    text,
    postedAt: create(TimestampSchema, { seconds: 1n }),
  });
}

function subscriptionFixture() {
  const lifecycle = queue<never>();
  const updates = queue<never>();
  return {
    activate: vi.fn(async () => undefined),
    cancel: vi.fn(async () => {
      lifecycle.close();
      updates.close();
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
    emitUpdate() {
      updates.push({ kind: "update", update: {} } as never);
    },
  };
}

function fixturePost(
  options: {
    readonly deferredPost?: boolean;
    readonly postResultFailure?: boolean;
    readonly postFailure?: boolean;
  },
  deferred: PromiseWithResolvers<ClientOutcome>,
) {
  let attempts = 0;
  return vi.fn<FixturePost>(() => {
    attempts += 1;
    if (options.deferredPost) return deferred.promise;
    if (options.postResultFailure && attempts === 1)
      return Promise.resolve({ kind: "rejection", rejection: {} as never });
    if (options.postFailure && attempts === 1) return Promise.reject(new Error("post unavailable"));
    return Promise.resolve({ kind: "ok" });
  });
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
  let closed = false;
  return {
    values: {
      [Symbol.asyncIterator]() {
        return {
          next: () =>
            new Promise<IteratorResult<T>>((resolve) => {
              if (closed) resolve({ done: true, value: undefined as never });
              else pending.push(resolve);
            }),
        };
      },
    } as AsyncIterable<T>,
    push(value: T) {
      pending.shift()?.({ done: false, value });
    },
    close() {
      closed = true;
      for (const resolve of pending.splice(0)) resolve({ done: true, value: undefined as never });
    },
  };
}
