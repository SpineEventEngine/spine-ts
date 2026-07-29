import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  ChatMessageViewSchema,
  ChatRoomIdSchema,
  MessageIdSchema,
  type ChatMessageView,
} from "@spine-event-engine/chat-model/generated/spine/example/chat/v1/chat_pb.js";
import { PostMessageSchema } from "@spine-event-engine/chat-model/generated/spine/example/chat/v1/commands_pb.js";
import { UserIdSchema } from "@spine-event-engine/users-model/generated/spine/example/users/v1/users_pb.js";
import {
  SpineClientProvider,
  useEntityQuery,
  useEntitySubscription,
  useSubscriptionDelivery,
  useSubscriptionLifecycle,
} from "@spine-event-engine/client-react";
import type { ClientRequest, SubscriptionLifecycle } from "@spine-event-engine/client-web";
import { deriveTypeUrl, packAny, unpackAny } from "@spine-event-engine/core";
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

/** Application-owned browser session state. Actor data is informational, never a credential. */
export type BrowserChatSession =
  | Readonly<{ readonly status: "guest"; readonly signIn: () => Promise<BrowserChatSession> }>
  | Readonly<{
      readonly status: "signedIn";
      readonly actor: string;
      readonly signIn: () => Promise<BrowserChatSession>;
    }>;

/** Props for the deliberately small browser Chat fixture. */
export interface ChatBrowserAppProps {
  readonly session: BrowserChatSession;
  readonly request: ClientRequest;
  readonly room: string;
  readonly createMessageId?: () => string;
}

/**
 * Browser Chat fixture using public client-web and client-react contracts.
 * Subscription updates are hints only: the room Query is the authoritative state.
 */
export function ChatBrowserApp(props: ChatBrowserAppProps): ReactElement {
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
}

function ChatRoom({
  room,
  request,
  session,
  createMessageId = defaultMessageId,
}: ChatBrowserAppProps & {
  readonly session: Extract<BrowserChatSession, { readonly status: "signedIn" }>;
}): ReactElement {
  const [recovered, setRecovered] = useState<QueryResponse | undefined>(undefined);
  const [refreshed, setRefreshed] = useState<QueryResponse | undefined>(undefined);
  const [text, setText] = useState("");
  const [postError, setPostError] = useState<unknown>();
  const [posting, setPosting] = useState(false);
  const pendingPost = useRef<ReturnType<typeof postMessage> | undefined>(undefined);
  const refreshInFlight = useRef(false);
  const refreshPending = useRef(false);
  const refreshController = useRef<AbortController | undefined>(undefined);
  const refreshGeneration = useRef(0);
  const postController = useRef<AbortController | undefined>(undefined);
  const postGeneration = useRef(0);
  const query = useEntityQuery(() => createRoomQuery(room), [room]);
  const subscription = useEntitySubscription(createRoomTopic(room), () => createRoomQuery(room), [
    room,
  ]);
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
          const response = await request.send(createRoomQuery(room), { signal: controller.signal });
          if (generation !== refreshGeneration.current) return;
          setRefreshed(response);
          setRecovered(undefined);
        } while (refreshPending.current);
      } catch {
        // A hint refresh is best effort; unmount and client cancellation are intentionally silent.
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
      pendingPost.current ?? postMessage(room, session.actor, text.trim(), createMessageId());
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
  const rows = response === undefined ? [] : roomRows(response, room);
  return createElement(
    "main",
    undefined,
    createElement("h1", undefined, `Chat: ${room}`),
    lifecycleNotice(lifecycle),
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
}

function lifecycleNotice(lifecycle: SubscriptionLifecycle | undefined): ReactElement | undefined {
  if (lifecycle?.state === "gapPossible" || lifecycle?.state === "resynchronizing")
    return createElement(
      "p",
      { role: "status" },
      "Updates may be incomplete; refreshing messages.",
    );
  if (lifecycle?.state === "failed")
    return createElement("p", { role: "alert" }, "Message updates disconnected.");
  return undefined;
}

/** Build the room-filtered Projection query used for every authoritative refresh. */
export function createRoomQuery(room: string): Query {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: `chat-room-${room}` }),
    context: create(ActorContextSchema),
    target: create(TargetSchema, {
      type: deriveTypeUrl(ChatMessageViewSchema),
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
                  value: packAny(ChatRoomIdSchema, create(ChatRoomIdSchema, { value: room })),
                }),
              ],
            }),
          ],
        }),
      },
    }),
  });
}

/** Build the room-specific Projection topic; Chat messages are never event topics. */
export function createRoomTopic(room: string): Topic {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: `chat-room-${room}` }),
    context: create(ActorContextSchema),
    target: createRoomQuery(room).target,
  });
}

/** Decode only ChatMessageView Projection entities matching the selected room. */
export function roomRows(response: QueryResponse, room: string): readonly ChatMessageView[] {
  return response.message.flatMap((entry) => {
    if (entry.state === undefined) return [];
    const row = unpackAny(entry.state, ChatMessageViewSchema);
    return row?.room?.value === room ? [row] : [];
  });
}

function postMessage(room: string, actor: string, text: string, id: string) {
  return create(PostMessageSchema, {
    id: create(MessageIdSchema, { value: id }),
    room: create(ChatRoomIdSchema, { value: room }),
    author: create(UserIdSchema, { value: actor }),
    text,
    postedAt: create(TimestampSchema, { seconds: BigInt(Math.floor(Date.now() / 1_000)) }),
  });
}

function defaultMessageId(): string {
  return crypto.randomUUID();
}
