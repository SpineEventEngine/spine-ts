import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  ChatMessageViewSchema,
  ChatRoomIdSchema,
  MessageIdSchema,
} from "@spine-event-engine/example-chat-model/generated/spine/example/chat/v1/chat_pb.js";
import { packAny } from "@spine-event-engine/core";
import { UserIdSchema } from "@spine-event-engine/example-chat-users-model/generated/spine/example/users/v1/users_pb.js";
import { createRoot } from "react-dom/client";

import { ChatBrowserApp, type BrowserChatSession } from "./index.js";

const lifecycle = asyncQueue<{ readonly state: "gapPossible"; readonly generation: number }>();
const updates = asyncQueue<unknown>();
let active = false;
let queryCount = 0;
let authoritativeQuery: (() => unknown) | undefined;
const lateQuery = Promise.withResolvers<ReturnType<typeof response>>();
const request = {
  send: async () => {
    queryCount += 1;
    return queryCount === 1 ? response("initial fixture message") : lateQuery.promise;
  },
  post: async () => ({ kind: "ok" as const }),
  createSubscription: async (_topic: unknown, options: { authoritativeQuery: () => unknown }) => {
    authoritativeQuery = options.authoritativeQuery;
    return {
      activate: async () => {
        active = true;
      },
      cancel: async () => {
        active = false;
        lifecycle.close();
        updates.close();
      },
      lifecycle: lifecycle.values,
      updates: updates.values,
    };
  },
};
const session: BrowserChatSession = {
  status: "signedIn",
  actor: "browser-fixture",
  signIn: async () => session,
};
const root = createRoot(document.getElementById("root")!);

root.render(<ChatBrowserApp room="general" request={request as never} session={session} />);

declare global {
  interface Window {
    chatBrowserFixture: {
      gap(): void;
      recover(): void;
      teardown(): void;
      active(): boolean;
      queryCount(): number;
      resolveLate(): void;
    };
  }
}

window.chatBrowserFixture = Object.freeze({
  gap: () => lifecycle.push({ state: "gapPossible", generation: 1 }),
  recover: () => {
    authoritativeQuery?.();
    updates.push({ kind: "resynchronization", response: response("recovered fixture message") });
  },
  teardown: () => root.unmount(),
  active: () => active,
  queryCount: () => queryCount,
  resolveLate: () => lateQuery.resolve(response("late fixture message")),
});

function response(text: string) {
  return {
    message: [
      {
        state: packAny(
          ChatMessageViewSchema,
          create(ChatMessageViewSchema, {
            id: create(MessageIdSchema, { value: text }),
            room: create(ChatRoomIdSchema, { value: "general" }),
            author: create(UserIdSchema, { value: "browser-fixture" }),
            text,
            postedAt: create(TimestampSchema, { seconds: 1n }),
          }),
        ),
      },
    ],
  };
}

function asyncQueue<T>() {
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
