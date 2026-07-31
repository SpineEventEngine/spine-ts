import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  ChatMessageViewSchema,
  ChatRoomIdSchema,
  MessageIdSchema,
} from "@spine-event-engine/example-chat-model/generated/spine/examples/chat/chat_pb.js";
import { AnyMessages } from "@spine-event-engine/core";
import { UserIdSchema } from "@spine-event-engine/example-chat-model/generated/spine/examples/chat/users_pb.js";
import { createRoot } from "react-dom/client";

import { ChatBrowserApp, type BrowserChatSession } from "./index.js";

class ChatBrowserFixture {
  private readonly lifecycle = new FixtureQueue<{
    readonly state: "gapPossible";
    readonly generation: number;
  }>();
  private readonly updates = new FixtureQueue<unknown>();
  private readonly lateQuery = Promise.withResolvers<ReturnType<ChatBrowserFixture["response"]>>();
  private activeSubscription = false;
  private queries = 0;
  private authoritativeQuery: (() => unknown) | undefined;

  readonly request = {
    send: async () => {
      this.queries += 1;
      return this.queries === 1 ? this.response("initial fixture message") : this.lateQuery.promise;
    },
    post: async () => ({ kind: "ok" as const }),
    createSubscription: async (_topic: unknown, options: { authoritativeQuery: () => unknown }) => {
      this.authoritativeQuery = options.authoritativeQuery;
      return {
        activate: async () => {
          this.activeSubscription = true;
        },
        cancel: async () => {
          this.activeSubscription = false;
          this.lifecycle.close();
          this.updates.close();
        },
        lifecycle: this.lifecycle.values,
        updates: this.updates.values,
      };
    },
  };

  gap(): void {
    this.lifecycle.push({ state: "gapPossible", generation: 1 });
  }

  recover(): void {
    this.authoritativeQuery?.();
    this.updates.push({
      kind: "resynchronization",
      response: this.response("recovered fixture message"),
    });
  }

  active(): boolean {
    return this.activeSubscription;
  }

  queryCount(): number {
    return this.queries;
  }

  resolveLate(): void {
    this.lateQuery.resolve(this.response("late fixture message"));
  }

  private response(text: string) {
    return {
      message: [
        {
          state: AnyMessages.pack(
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
}

class FixtureQueue<T> {
  private readonly pending: ((result: IteratorResult<T>) => void)[] = [];
  private closed = false;

  readonly values: AsyncIterable<T> = {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<IteratorResult<T>>((resolve) => {
          if (this.closed) resolve({ done: true, value: undefined as never });
          else this.pending.push(resolve);
        }),
    }),
  };

  push(value: T): void {
    this.pending.shift()?.({ done: false, value });
  }

  close(): void {
    this.closed = true;
    for (const resolve of this.pending.splice(0))
      resolve({ done: true, value: undefined as never });
  }
}

const fixture = new ChatBrowserFixture();
const session: BrowserChatSession = {
  status: "signedIn",
  actor: "browser-fixture",
  signIn: async () => session,
};
const root = createRoot(document.getElementById("root")!);

root.render(<ChatBrowserApp room="general" request={fixture.request as never} session={session} />);

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
  gap: () => fixture.gap(),
  recover: () => fixture.recover(),
  teardown: () => root.unmount(),
  active: () => fixture.active(),
  queryCount: () => fixture.queryCount(),
  resolveLate: () => fixture.resolveLate(),
});
