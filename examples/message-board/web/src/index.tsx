import { SpineClientProvider } from "@spine-event-engine/client-react";
import type { ClientRequest, SubscriptionLifecycle } from "@spine-event-engine/client-web";
import { CircleCheck, MessageCircle, WifiOff } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement } from "react";

import { useBoardSync } from "./board-sync.js";
import { Alert } from "./components/ui/alert.js";
import { Button } from "./components/ui/button.js";
import { Card, CardContent, CardHeader } from "./components/ui/card.js";
import { MessageList } from "./message-list.js";
import { PostForm } from "./post-form.js";

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
            <h1 className="text-2xl font-bold tracking-tight">Message Board</h1>
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
  createMessageId,
}: MessageBoardAppProps & {
  readonly session: Extract<BoardSession, { readonly status: "signedIn" }>;
}): ReactElement {
  const synchronized = useBoardSync(board, request);
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Message Board</h1>
        </div>
        <SubscriptionBadge lifecycle={synchronized.lifecycle} />
      </header>

      <MessageList rows={synchronized.rows} />
      <PostForm
        board={board}
        actor={session.actor}
        request={request}
        {...(createMessageId === undefined ? {} : { createMessageId })}
        onPosted={synchronized.onPosted}
      />
    </main>
  );
};

const SubscriptionBadge = function SubscriptionBadge({
  lifecycle,
}: {
  readonly lifecycle: SubscriptionLifecycle | undefined;
}): ReactElement {
  const updating = lifecycle?.state === "connected";
  return (
    <div
      role="status"
      className={
        updating
          ? "inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-2 text-sm font-medium text-primary"
          : "inline-flex items-center gap-2 rounded-full bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-300"
      }
    >
      {updating ? (
        <CircleCheck className="size-4" aria-hidden="true" />
      ) : (
        <WifiOff className="size-4" aria-hidden="true" />
      )}
      {updating ? "Updating live" : "No live updates"}
    </div>
  );
};
