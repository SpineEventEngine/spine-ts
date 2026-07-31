import { create } from "@bufbuild/protobuf";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  BoardIdSchema,
  BoardMessageViewSchema,
  MessageIdSchema,
  type BoardMessageView,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { PostMessageSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/commands_pb.js";
import { UserIdSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/user_pb.js";
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
  OrderBySchema,
  OrderBy_Direction,
  QueryIdSchema,
  QuerySchema,
  ResponseFormatSchema,
  TargetFiltersSchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
  type Query,
  type QueryResponse,
  type Topic,
} from "@spine-event-engine/proto/client";
import { MessageCircle, Send, Sparkles } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
} from "react";

import { Alert } from "./components/ui/alert.js";
import { Avatar } from "./components/ui/avatar.js";
import { Button } from "./components/ui/button.js";
import { Card, CardContent, CardHeader } from "./components/ui/card.js";
import { Input } from "./components/ui/input.js";
import { Label } from "./components/ui/label.js";
import { Textarea } from "./components/ui/textarea.js";
import { PostFeedback, type PostFeedbackValue } from "./post-feedback.js";
import { RelativeTime } from "./relative-time.js";

/**
 * Describes the application-owned sign-in state shown by MessageBoard.
 */
export type BoardSession =
  | Readonly<{
      // prettier-ignore

      /**
       * Describes a visitor who has not signed in.
       */
      readonly status: "guest";

      /**
       * Starts application-owned sign-in.
       *
       * @returns The resulting MessageBoard session.
       */
      readonly signIn: () => Promise<BoardSession>;
    }>
  | Readonly<{
      // prettier-ignore

      /**
       * Describes a visitor who has signed in.
       */
      readonly status: "signedIn";

      /**
       * Identifies the trusted account that sends commands.
       */
      readonly actor: string;

      /**
       * Starts application-owned sign-in.
       *
       * @returns The resulting MessageBoard session.
       */
      readonly signIn: () => Promise<BoardSession>;
    }>;

/**
 * Supplies the MessageBoard browser application.
 */
export interface MessageBoardAppProps {
  // prettier-ignore

  /**
   * Supplies the application-owned sign-in boundary.
   */
  readonly session: BoardSession;

  /**
   * Sends commands, queries, and subscriptions to the server.
   */
  readonly request: ClientRequest;

  /**
   * Identifies the board displayed on the page.
   */
  readonly board: string;

  /**
   * Creates an identifier for a new message.
   *
   * @returns A new message identifier.
   */
  readonly createMessageId?: () => string;
}

/**
 * Renders the MessageBoard browser application.
 *
 * @param props The session, client request, and selected board.
 * @returns The MessageBoard user interface.
 */
export const MessageBoardApp = (props: MessageBoardAppProps): ReactElement => {
  const [session, setSession] = useState(props.session);
  const [signInError, setSignInError] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const signIn = () => {
    if (signingIn) return;
    const requestGeneration = ++generation.current;
    setSigningIn(true);
    setSignInError(false);
    void props.session.signIn().then(
      (next) => {
        if (requestGeneration !== generation.current) return;
        setSession(next);
        setSigningIn(false);
      },
      () => {
        if (requestGeneration !== generation.current) return;
        setSignInError(true);
        setSigningIn(false);
      },
    );
  };

  if (session.status === "guest") {
    return (
      <main className="grid min-h-screen place-items-center p-5">
        <Card className="w-full max-w-md overflow-hidden">
          <CardHeader className="bg-primary/5 text-center">
            <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
              <MessageCircle aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">MessageBoard</h1>
            <p className="text-sm text-muted-foreground">Sign in to read and share messages.</p>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {signInError && (
              <Alert role="alert" className="border-destructive/40 text-destructive">
                Sign-in failed. Please retry.
              </Alert>
            )}
            <Button type="button" className="w-full" disabled={signingIn} onClick={signIn}>
              {signingIn ? "Signing in…" : "Sign in"}
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <SpineClientProvider request={props.request}>
      <Board {...props} session={session} key={props.board} />
    </SpineClientProvider>
  );
};

const Board = function Board({
  board,
  request,
  session,
  createMessageId = BoardPost.createId,
}: MessageBoardAppProps & {
  readonly session: Extract<BoardSession, { readonly status: "signedIn" }>;
}): ReactElement {
  const view = new BoardView(board);
  const [recovered, setRecovered] = useState<QueryResponse>();
  const [refreshed, setRefreshed] = useState<QueryResponse>();
  const [username, setUsername] = useState("");
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<PostFeedbackValue>({ fields: {} });
  const [posting, setPosting] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const usernameInput = useRef<HTMLInputElement>(null);
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const pendingPost = useRef<ReturnType<BoardPost["create"]> | undefined>(undefined);
  const refreshInFlight = useRef(false);
  const refreshPending = useRef(false);
  const refreshController = useRef<AbortController | undefined>(undefined);
  const refreshGeneration = useRef(0);
  const postController = useRef<AbortController | undefined>(undefined);
  const postGeneration = useRef(0);
  const query = useEntityQuery(() => view.query(), [board]);
  const subscription = useEntitySubscription(view.topic(), () => view.query(), [board]);
  const lifecycle = useSubscriptionLifecycle(subscription);
  const delivery = useSubscriptionDelivery(subscription);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(
    () => () => {
      refreshGeneration.current += 1;
      refreshController.current?.abort();
      postGeneration.current += 1;
      postController.current?.abort();
    },
    [board],
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
        // Subscription hints are best effort; the lifecycle notice remains visible.
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
      pendingPost.current ??
      new BoardPost(board, session.actor).create(username, text, createMessageId());
    pendingPost.current = next;
    setPosting(true);
    setFeedback({ fields: {} });
    const controller = new AbortController();
    const generation = postGeneration.current;
    postController.current = controller;
    void request.post(PostMessageSchema, next, { signal: controller.signal }).then(
      (outcome) => {
        if (generation !== postGeneration.current) return;
        if (outcome.kind !== "ok") {
          const nextFeedback = PostFeedback.from(outcome);
          setFeedback(nextFeedback);
          if (Object.keys(nextFeedback.fields).length > 0) pendingPost.current = undefined;
          if (nextFeedback.fields.username !== undefined) usernameInput.current?.focus();
          else if (nextFeedback.fields.text !== undefined) messageInput.current?.focus();
          setPosting(false);
          return;
        }
        pendingPost.current = undefined;
        setUsername("");
        setText("");
        setFeedback({ fields: {} });
        setPosting(false);
      },
      () => {
        if (generation !== postGeneration.current) return;
        setFeedback({ fields: {}, general: "Message was not posted. Please retry." });
        setPosting(false);
      },
    );
  };

  const response = recovered ?? refreshed ?? (query.status === "success" ? query.value : undefined);
  const rows = response === undefined ? [] : view.rows(response);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
      <header className="flex items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Sparkles className="size-3.5" aria-hidden="true" />
            Live board
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">MessageBoard</h1>
          <p className="mt-1 text-muted-foreground">#{board}</p>
        </div>
        <div className="hidden items-center gap-2 rounded-full border bg-card/80 px-3 py-2 text-sm text-muted-foreground shadow-sm sm:flex">
          <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
          Connected
        </div>
      </header>

      <SubscriptionNotice lifecycle={lifecycle} />

      <Card aria-label="Messages" className="overflow-hidden">
        <CardHeader className="border-b bg-muted/35">
          <h2 className="text-lg font-semibold">Recent messages</h2>
          <p className="text-sm text-muted-foreground">Newest messages appear at the bottom.</p>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="grid min-h-52 place-items-center px-6 py-12 text-center">
              <div>
                <MessageCircle
                  className="mx-auto mb-3 size-10 text-muted-foreground/60"
                  aria-hidden="true"
                />
                <p className="font-medium">No messages yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Start the conversation below.</p>
              </div>
            </div>
          ) : (
            <ol aria-label="Messages" className="divide-y divide-border/70">
              {rows.map((row) => (
                <li key={row.id?.value ?? `${row.username}-${row.text}`}>
                  <article className="flex gap-3 px-5 py-5 transition-colors hover:bg-muted/30 sm:px-6">
                    <Avatar>{BoardMessages.initial(row.username)}</Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <h3 className="font-semibold">{row.username}</h3>
                        {row.postedAt !== undefined && (
                          <time
                            className="text-xs text-muted-foreground"
                            dateTime={timestampDate(row.postedAt).toISOString()}
                          >
                            {RelativeTime.format(timestampDate(row.postedAt), now)}
                          </time>
                        )}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words leading-7 text-foreground/90">
                        {row.text}
                      </p>
                    </div>
                  </article>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Post a message</h2>
          <p className="text-sm text-muted-foreground">Both fields are required by the server.</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" noValidate onSubmit={post}>
            {feedback.general !== undefined && (
              <Alert role="alert" className="border-destructive/40 text-destructive">
                {feedback.general}
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                ref={usernameInput}
                id="username"
                name="username"
                autoComplete="nickname"
                placeholder="How should people know you?"
                value={username}
                aria-invalid={feedback.fields.username !== undefined}
                aria-describedby={
                  feedback.fields.username === undefined ? undefined : "username-error"
                }
                onChange={(event: ChangeEvent<HTMLInputElement>) => setUsername(event.target.value)}
              />
              {feedback.fields.username !== undefined && (
                <p
                  id="username-error"
                  role="alert"
                  className="text-sm font-medium text-destructive"
                >
                  {feedback.fields.username}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="message">Message</Label>
              <Textarea
                ref={messageInput}
                id="message"
                name="message"
                placeholder="Share something with the board…"
                value={text}
                aria-invalid={feedback.fields.text !== undefined}
                aria-describedby={feedback.fields.text === undefined ? undefined : "message-error"}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)}
              />
              {feedback.fields.text !== undefined && (
                <p id="message-error" role="alert" className="text-sm font-medium text-destructive">
                  {feedback.fields.text}
                </p>
              )}
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={posting}>
                <Send className="size-4" aria-hidden="true" />
                {posting ? "Posting…" : "Post message"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
};

class BoardView {
  constructor(private readonly board: string) {}

  query(): Query {
    return create(QuerySchema, {
      id: create(QueryIdSchema, { value: `message-board-${this.board}` }),
      context: create(ActorContextSchema),
      target: create(TargetSchema, {
        type: TypeUrls.derive(BoardMessageViewSchema),
        criterion: {
          case: "filters",
          value: create(TargetFiltersSchema, {
            filter: [
              create(CompositeFilterSchema, {
                operator: CompositeFilter_CompositeOperator.ALL,
                filter: [
                  create(FilterSchema, {
                    fieldPath: { fieldName: ["board"] },
                    operator: Filter_Operator.EQUAL,
                    value: AnyMessages.pack(
                      BoardIdSchema,
                      create(BoardIdSchema, { value: this.board }),
                    ),
                  }),
                ],
              }),
            ],
          }),
        },
      }),
      format: create(ResponseFormatSchema, {
        orderBy: [
          create(OrderBySchema, {
            column: "posted_at",
            direction: OrderBy_Direction.ASCENDING,
          }),
        ],
      }),
    });
  }

  topic(): Topic {
    return create(TopicSchema, {
      id: create(TopicIdSchema, { value: `message-board-${this.board}` }),
      context: create(ActorContextSchema),
      target: this.query().target,
    });
  }

  rows(response: QueryResponse): readonly BoardMessageView[] {
    return response.message
      .flatMap((entry) => {
        if (entry.state === undefined) return [];
        const row = AnyMessages.unpack(entry.state, BoardMessageViewSchema);
        return row?.board?.value === this.board ? [row] : [];
      })
      .sort(BoardMessages.compare);
  }
}

class BoardPost {
  constructor(
    private readonly board: string,
    private readonly actor: string,
  ) {}

  static createId(): string {
    return crypto.randomUUID();
  }

  create(username: string, text: string, id: string) {
    return create(PostMessageSchema, {
      id: create(MessageIdSchema, { value: id }),
      board: create(BoardIdSchema, { value: this.board }),
      author: create(UserIdSchema, { value: this.actor }),
      username: username.trim(),
      text: text.trim(),
      postedAt: timestampFromDate(new Date()),
    });
  }
}

/**
 * Supplies deterministic presentation behavior for board messages.
 */
const BoardMessages = Object.freeze({
  compare(left: BoardMessageView, right: BoardMessageView): number {
    const leftTime = left.postedAt === undefined ? 0 : timestampDate(left.postedAt).getTime();
    const rightTime = right.postedAt === undefined ? 0 : timestampDate(right.postedAt).getTime();
    return leftTime - rightTime || (left.id?.value ?? "").localeCompare(right.id?.value ?? "");
  },

  initial(username: string): string {
    return username.trim().charAt(0).toLocaleUpperCase() || "?";
  },
});

const SubscriptionNotice = function SubscriptionNotice({
  lifecycle,
}: {
  readonly lifecycle: SubscriptionLifecycle | undefined;
}): ReactElement | undefined {
  if (lifecycle?.state === "gapPossible" || lifecycle?.state === "resynchronizing") {
    return <Alert role="status">Updates may be incomplete; refreshing messages.</Alert>;
  }
  if (lifecycle?.state === "failed") {
    return (
      <Alert role="alert" className="border-destructive/40 text-destructive">
        Message updates disconnected.
      </Alert>
    );
  }
  return undefined;
};
