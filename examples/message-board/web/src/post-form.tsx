import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  PostMessageSchema,
  type PostMessage,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/commands_pb.js";
import {
  BoardIdSchema,
  MessageIdSchema,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { UserIdSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/user_pb.js";
import type { ClientRequest } from "@spine-event-engine/client-web";
import { Send } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
} from "react";

import { Alert } from "./components/ui/alert.js";
import { Button } from "./components/ui/button.js";
import { Card, CardContent, CardHeader } from "./components/ui/card.js";
import { Input } from "./components/ui/input.js";
import { Label } from "./components/ui/label.js";
import { Textarea } from "./components/ui/textarea.js";
import { PostFeedback, type PostFeedbackValue } from "./post-feedback.js";

/**
 * Supplies command context and refresh behavior for the post form.
 */
export interface PostFormProps {
  // prettier-ignore

  /**
   * Identifies the board that receives the message.
   */
  readonly board: string;

  /**
   * Identifies the authenticated actor.
   */
  readonly actor: string;

  /**
   * Sends the post command to the server.
   */
  readonly request: ClientRequest;

  /**
   * Creates an identifier for a new message.
   *
   * @returns A new message identifier.
   */
  readonly createMessageId?: () => string;

  /**
   * Refreshes authoritative board state after a successful post.
   */
  readonly onPosted: () => void;
}

/**
 * Renders and submits the server-validated message form.
 *
 * @param props The board, actor, request, identifier source, and refresh callback.
 * @returns The MessageBoard post form.
 */
export const PostForm = ({
  board,
  actor,
  request,
  createMessageId = BoardPost.createId,
  onPosted,
}: PostFormProps): ReactElement => {
  const [username, setUsername] = useState("");
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<PostFeedbackValue>({ fields: {} });
  const [posting, setPosting] = useState(false);
  const usernameInput = useRef<HTMLInputElement>(null);
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const pendingPost = useRef<ReturnType<BoardPost["create"]> | undefined>(undefined);
  const postController = useRef<AbortController | undefined>(undefined);
  const postGeneration = useRef(0);

  useEffect(
    () => () => {
      postGeneration.current += 1;
      postController.current?.abort();
    },
    [],
  );

  const post = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (posting) return;
    const next =
      pendingPost.current ?? new BoardPost(board, actor).create(username, text, createMessageId());
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
        onPosted();
      },
      () => {
        if (generation !== postGeneration.current) return;
        setFeedback({ fields: {}, general: "Message was not posted. Please retry." });
        setPosting(false);
      },
    );
  };

  return (
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
              <p id="username-error" role="alert" className="text-sm font-medium text-destructive">
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
  );
};

/**
 * Creates a post command for one board and signed-in actor.
 */
class BoardPost {
  /**
   * Creates a board-bound command factory.
   *
   * @param board The board that receives each command.
   * @param actor The signed-in actor that authors each command.
   */
  constructor(
    private readonly board: string,
    private readonly actor: string,
  ) {}

  /**
   * Creates an identifier for a new message.
   *
   * @returns A random UUID.
   */
  static createId(): string {
    return crypto.randomUUID();
  }

  /**
   * Creates a post command from the current form values.
   *
   * @param username The username entered in the form.
   * @param text The message entered in the form.
   * @param id The identifier reserved for this posting attempt.
   * @returns The command sent to the MessageBoard server.
   */
  create(username: string, text: string, id: string): PostMessage {
    return create(PostMessageSchema, {
      id: create(MessageIdSchema, { value: id }),
      board: create(BoardIdSchema, { value: this.board }),
      author: create(UserIdSchema, { value: this.actor }),
      username,
      text,
      postedAt: timestampFromDate(new Date()),
    });
  }
}
