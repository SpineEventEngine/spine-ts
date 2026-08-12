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
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { BoardMessageView } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { MessageCircle } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";

import { Avatar } from "./components/ui/avatar.js";
import { Card, CardContent, CardHeader } from "./components/ui/card.js";
import { RelativeTime } from "./relative-time.js";

/**
 * Supplies the messages shown on one board.
 */
export interface MessageListProps {
  // prettier-ignore

  /**
   * Contains rows ordered from oldest to newest.
   */
  readonly rows: readonly BoardMessageView[];
}

/**
 * Renders the authoritative messages for one board.
 *
 * @param props The ordered board rows.
 * @returns The message list or its empty state.
 */
export const MessageList = (props: MessageListProps): ReactElement => {
  const { rows } = props;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(clock);
  }, []);

  return (
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
                  <Avatar>{MessageRows.initial(row.username)}</Avatar>
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
  );
};

/**
 * Presents compact values derived from message rows.
 */
const MessageRows = Object.freeze({
  // prettier-ignore

  /**
   * Obtains the avatar initial for a username.
   *
   * @param username The displayed username.
   * @returns The uppercase first character, or a placeholder for blank input.
   */
  initial(username: string): string {
    return username.trim().charAt(0).toLocaleUpperCase() || "?";
  },
});
