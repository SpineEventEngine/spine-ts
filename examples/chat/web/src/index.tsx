import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  ChatMessageViewSchema,
  ChatRoomIdSchema,
  MessageIdSchema,
  type ChatMessageView,
} from "@spine-event-engine/example-chat-model/generated/spine/example/chat/v1/chat_pb.js";
import { PostMessageSchema } from "@spine-event-engine/example-chat-model/generated/spine/example/chat/v1/commands_pb.js";
import { UserIdSchema } from "@spine-event-engine/example-chat-users-model/generated/spine/example/users/v1/users_pb.js";
import {
  SpineClientProvider,
  useEntityQuery,
  useEntitySubscription,
  useSubscriptionDelivery,
  useSubscriptionLifecycle,
} from "@spine-event-engine/client-react";
import type { ClientRequest, SubscriptionLifecycle } from "@spine-event-engine/client-web";
import { AnyMessages, TypeUrls } from "@spine-event-engine/core";
import { ActorContextSchema } from "@spine-event-engine/proto";
import {
  CompositeFilterSchema,
  CompositeFilter_CompositeOperator,
  FilterSchema,
  Filter_Operator,
  QueryIdSchema,
  QuerySchema,
  TargetFiltersSchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
  type Query,
  type QueryResponse,
  type Topic,
} from "@spine-event-engine/proto/client";
import {
  createElement,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
} from "react";

/** Describes application-owned browser session state. Actor data is informational, never a credential. */
export type BrowserChatSession =
  | Readonly<{
      /** Describes the unauthenticated session state. */
      readonly status: "guest";
      /** Starts application-owned sign-in. @returns Resolves to the resulting session. */
      readonly signIn: () => Promise<BrowserChatSession>;
    }>
  | Readonly<{
      /** Describes the authenticated session state. */
      readonly status: "signedIn";
      /** Identifies the informational actor shown in posted messages. */
      readonly actor: string;
      /** Starts application-owned sign-in. @returns Resolves to the resulting session. */
      readonly signIn: () => Promise<BrowserChatSession>;
    }>;

/** Defines props for the deliberately small browser Chat fixture. */
export interface ChatBrowserAppProps {
  /** Supplies the application-owned session boundary. */
  readonly session: BrowserChatSession;
  /** Supplies the public browser client request. */
  readonly request: ClientRequest;
  /** Identifies the room displayed by this fixture. */
  readonly room: string;
  /** Creates a message identifier for a new post. @returns Returns the identifier. */
  readonly createMessageId?: () => string;
}

/**
 * Renders the browser Chat fixture using public client-web and client-react contracts.
 *
 * @param props Supplies the session, request, and selected room.
 * @returns Returns the fixture user interface.
 */
export const ChatBrowserApp = function ChatBrowserApp(props: ChatBrowserAppProps): ReactElement {
  const [session, setSession] = useState(props.session);
  const [signInError, setSignInError] = useState<unknown>();
  const [signingIn, setSigningIn] = useState(false);
  const signInGeneration = useRef(0);
  useEffect(
    () => () => {
      signInGeneration.current += 1;
    },
    [],
  );
  const signIn = () => {
    if (signingIn) return;
    const generation = ++signInGeneration.current;
    setSigningIn(true);
    setSignInError(undefined);
    void props.session.signIn().then(
      (next) => {
        if (generation !== signInGeneration.current) return;
        setSession(next);
        setSigningIn(false);
      },
      (error: unknown) => {
        if (generation !== signInGeneration.current) return;
        setSignInError(error);
        setSigningIn(false);
      },
    );
  };
  if (session.status === "guest")
    return createElement(
      "main",
      undefined,
      createElement("p", undefined, "Sign in to join Chat."),
      signInError === undefined
        ? undefined
        : createElement("p", { role: "alert" }, "Sign-in failed. Please retry."),
      createElement(
        "button",
        { type: "button", disabled: signingIn, onClick: signIn },
        signingIn ? "Signing in…" : "Sign in",
      ),
    );
  return createElement(
    SpineClientProvider,
    { request: props.request },
    createElement(ChatRoom, { ...props, session, key: props.room }),
  );
};

const ChatRoom = function ChatRoom({
  room,
  request,
  session,
  createMessageId = ChatPost.createId,
}: ChatBrowserAppProps & {
  readonly session: Extract<BrowserChatSession, { readonly status: "signedIn" }>;
}): ReactElement {
  const view = new ChatRoomView(room);
  const [recovered, setRecovered] = useState<QueryResponse | undefined>(undefined);
  const [refreshed, setRefreshed] = useState<QueryResponse | undefined>(undefined);
  const [text, setText] = useState("");
  const [postError, setPostError] = useState<unknown>();
  const [posting, setPosting] = useState(false);
  const pendingPost = useRef<ReturnType<ChatPost["create"]> | undefined>(undefined);
  const refreshInFlight = useRef(false);
  const refreshPending = useRef(false);
  const refreshController = useRef<AbortController | undefined>(undefined);
  const refreshGeneration = useRef(0);
  const postController = useRef<AbortController | undefined>(undefined);
  const postGeneration = useRef(0);
  const query = useEntityQuery(() => view.query(), [room]);
  const subscription = useEntitySubscription(view.topic(), () => view.query(), [room]);
  const lifecycle = useSubscriptionLifecycle(subscription);
  const delivery = useSubscriptionDelivery(subscription);
  useEffect(
    () => () => {
      refreshGeneration.current += 1;
      refreshController.current?.abort();
      postGeneration.current += 1;
      postController.current?.abort();
    },
    [room],
  );
  const queueRefresh = () => {
    if (refreshInFlight.current) {
      refreshPending.current = true;
      return;
    }
    refreshInFlight.current = true;
    const controller = new AbortController();
    const generation = refreshGeneration.current;
    refreshController.current = controller;
    void (async () => {
      try {
        do {
          refreshPending.current = false;
          const response = await request.send(view.query(), { signal: controller.signal });
          if (generation !== refreshGeneration.current) return;
          setRefreshed(response);
          setRecovered(undefined);
        } while (refreshPending.current);
      } catch {
        // Hint refreshes are best effort; unmount and client cancellation are intentionally silent.
      } finally {
        if (generation === refreshGeneration.current) {
          refreshInFlight.current = false;
          refreshController.current = undefined;
        }
      }
    })();
  };
  useEffect(() => {
    if (lifecycle?.state === "gapPossible") queueRefresh();
  }, [lifecycle]);
  useEffect(() => {
    if (delivery?.kind === "resynchronization") setRecovered(delivery.response);
    if (delivery?.kind === "update") queueRefresh();
  }, [delivery]);
  const post = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (posting) return;
    const next =
      pendingPost.current ?? new ChatPost(room, session.actor).create(text, createMessageId());
    if (next.text.length === 0) return;
    pendingPost.current = next;
    setPosting(true);
    setPostError(undefined);
    const controller = new AbortController();
    const generation = postGeneration.current;
    postController.current = controller;
    void request.post(PostMessageSchema, next, { signal: controller.signal }).then(
      (outcome) => {
        if (generation !== postGeneration.current) return;
        if (outcome.kind !== "ok") {
          setPostError(outcome);
          setPosting(false);
          return;
        }
        pendingPost.current = undefined;
        setText("");
        setPosting(false);
      },
      (error: unknown) => {
        if (generation !== postGeneration.current) return;
        setPostError(error);
        setPosting(false);
      },
    );
  };
  const response = recovered ?? refreshed ?? (query.status === "success" ? query.value : undefined);
  const rows = response === undefined ? [] : view.rows(response);
  return createElement(
    "main",
    undefined,
    createElement("h1", undefined, `Chat: ${room}`),
    createElement(ChatSubscriptionNotice, { lifecycle }),
    postError === undefined
      ? undefined
      : createElement("p", { role: "alert" }, "Message was not posted. Please retry."),
    createElement(
      "ul",
      { "aria-label": "Messages" },
      rows.map((row) => createElement("li", { key: row.id?.value ?? row.text }, row.text)),
    ),
    createElement(
      "form",
      { onSubmit: post },
      createElement(
        "label",
        undefined,
        "Message",
        createElement("input", {
          value: text,
          onChange: (event: ChangeEvent<HTMLInputElement>) => setText(event.target.value),
        }),
      ),
      createElement("button", { type: "submit", disabled: posting }, posting ? "Posting…" : "Post"),
    ),
  );
};

class ChatRoomView {
  constructor(private readonly room: string) {}

  query(): Query {
    return create(QuerySchema, {
      id: create(QueryIdSchema, { value: `chat-room-${this.room}` }),
      context: create(ActorContextSchema),
      target: create(TargetSchema, {
        type: TypeUrls.derive(ChatMessageViewSchema),
        criterion: {
          case: "filters",
          value: create(TargetFiltersSchema, {
            filter: [
              create(CompositeFilterSchema, {
                operator: CompositeFilter_CompositeOperator.ALL,
                filter: [
                  create(FilterSchema, {
                    fieldPath: { fieldName: ["room"] },
                    operator: Filter_Operator.EQUAL,
                    value: AnyMessages.pack(
                      ChatRoomIdSchema,
                      create(ChatRoomIdSchema, { value: this.room }),
                    ),
                  }),
                ],
              }),
            ],
          }),
        },
      }),
    });
  }

  topic(): Topic {
    return create(TopicSchema, {
      id: create(TopicIdSchema, { value: `chat-room-${this.room}` }),
      context: create(ActorContextSchema),
      target: this.query().target,
    });
  }

  rows(response: QueryResponse): readonly ChatMessageView[] {
    return response.message.flatMap((entry) => {
      if (entry.state === undefined) return [];
      const row = AnyMessages.unpack(entry.state, ChatMessageViewSchema);
      return row?.room?.value === this.room ? [row] : [];
    });
  }
}

class ChatPost {
  constructor(
    private readonly room: string,
    private readonly actor: string,
  ) {}

  static createId(): string {
    return crypto.randomUUID();
  }

  create(text: string, id: string) {
    return create(PostMessageSchema, {
      id: create(MessageIdSchema, { value: id }),
      room: create(ChatRoomIdSchema, { value: this.room }),
      author: create(UserIdSchema, { value: this.actor }),
      text: text.trim(),
      postedAt: create(TimestampSchema, { seconds: BigInt(Math.floor(Date.now() / 1_000)) }),
    });
  }
}

const ChatSubscriptionNotice = function ChatSubscriptionNotice({
  lifecycle,
}: {
  readonly lifecycle: SubscriptionLifecycle | undefined;
}): ReactElement | undefined {
  if (lifecycle?.state === "gapPossible" || lifecycle?.state === "resynchronizing")
    return createElement(
      "p",
      { role: "status" },
      "Updates may be incomplete; refreshing messages.",
    );
  if (lifecycle?.state === "failed")
    return createElement("p", { role: "alert" }, "Message updates disconnected.");
  return undefined;
};
