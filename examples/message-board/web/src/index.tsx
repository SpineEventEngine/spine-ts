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

import { SpineClientProvider } from "@spine-event-engine/client-react";
import type { ClientRequest, SubscriptionLifecycle } from "@spine-event-engine/client-web";
import { CircleCheck, WifiOff } from "lucide-react";
import { type ReactElement } from "react";

import { useBoardSync } from "./board-sync.js";
import { Alert } from "./components/ui/alert.js";
import { Button } from "./components/ui/button.js";
import { Card, CardContent, CardHeader } from "./components/ui/card.js";
import { MessageList } from "./message-list.js";
import { PostForm } from "./post-form.js";

/**
 * Supplies the MessageBoard browser application.
 */
export interface MessageBoardAppProps {
  // prettier-ignore

  /**
   * Identifies the display name carried in public-demo request contexts.
   */
  readonly actor: string;

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
  return (
    <SpineClientProvider request={props.request}>
      <Board {...props} key={props.board} />
    </SpineClientProvider>
  );
};

const Board = function Board({
  board,
  request,
  actor,
  createMessageId,
}: MessageBoardAppProps): ReactElement {
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
        actor={actor}
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
