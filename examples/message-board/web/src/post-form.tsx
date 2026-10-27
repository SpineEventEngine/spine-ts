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

import { create } from "@bufbuild/protobuf";
import type { Event } from "@spine-event-engine/proto";
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
import { MessagePostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/events_pb.js";
import { MessageAlreadyPostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/rejections_pb.js";
import { AnyPacker } from "@spine-event-engine/core";
import type { ClientRequest, Subscription } from "@spine-event-engine/client-web";
import { Send } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  type Dispatch,
  type SetStateAction,
  type RefObject,
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
   * Identifies the public-demo actor.
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
   * Notifies the board after a successful post.
   */
  readonly onPosted: () => void;
}

/**
 * Renders and submits the server-validated message form.
 *
 * @param props The board, actor, request, identifier source, and post-success callback.
 * @returns The MessageBoard post form.
 */
export const PostForm = (props: PostFormProps): ReactElement => {
  const [username, setUsername] = useState("");
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<PostFeedbackValue>({ fields: {} });
  const [posting, setPosting] = useState(false);
  const tracking = PostFormActions.useTracking();
  const post = () =>
    PostFormActions.post(
      props,
      { username, text, posting },
      {
        setText,
        setFeedback,
        setPosting,
        ...tracking,
      },
    );
  return (
    <PostFormViews.Form
      username={username}
      text={text}
      feedback={feedback}
      posting={posting}
      usernameInput={tracking.usernameInput}
      messageInput={tracking.messageInput}
      setUsername={setUsername}
      setText={setText}
      post={post}
    />
  );
};

const PostFormActions = Object.freeze({
  /**
   * Captures the active post and cancels it when the form unmounts.
   *
   * @returns The form refs and mount-scoped cleanup.
   */
  useTracking() {
    const usernameInput = useRef<HTMLInputElement>(null);
    const messageInput = useRef<HTMLTextAreaElement>(null);
    const pendingPost = useRef<PostMessage | undefined>(undefined);
    const postController = useRef<AbortController | undefined>(undefined);
    const postSubscription = useRef<Subscription | undefined>(undefined);
    const postGeneration = useRef(0);
    useEffect(
      () => () => {
        postGeneration.current += 1;
        postController.current?.abort();
        void postSubscription.current?.cancel().catch(() => undefined);
      },
      [],
    );
    return {
      usernameInput,
      messageInput,
      pendingPost,
      postController,
      postSubscription,
      postGeneration,
    };
  },

  /**
   * Starts one retained post attempt.
   * @param props The request and board context.
   * @param values The current form values.
   * @param state The form controls and retained handles.
   */
  post(
    props: PostFormProps,
    values: PostFormValues,
    state: PostAttemptState & {
      postController: RefObject<AbortController | undefined>;
    },
  ): void {
    if (values.posting) return;
    const next =
      state.pendingPost.current ??
      new BoardPost(props.board, props.actor).create(
        values.username,
        values.text,
        (props.createMessageId ?? BoardPost.createId)(),
      );
    state.pendingPost.current = next;
    state.setPosting(true);
    state.setFeedback({ fields: {} });
    const controller = new AbortController();
    state.postController.current = controller;
    void new PostAttempt(props, next, controller, state.postGeneration.current, state).run();
  },
});

interface PostFormValues {
  readonly username: string;
  readonly text: string;
  readonly posting: boolean;
}

interface PostAttemptState {
  readonly setText: Dispatch<SetStateAction<string>>;
  readonly setFeedback: Dispatch<SetStateAction<PostFeedbackValue>>;
  readonly setPosting: Dispatch<SetStateAction<boolean>>;
  readonly usernameInput: RefObject<HTMLInputElement | null>;
  readonly messageInput: RefObject<HTMLTextAreaElement | null>;
  readonly pendingPost: RefObject<PostMessage | undefined>;
  readonly postSubscription: RefObject<Subscription | undefined>;
  readonly postGeneration: RefObject<number>;
}

/**
 * Observes one posted Command until a matching Event or rejection arrives.
 */
class PostAttempt {
  private accepted = false;

  private lateNotice = false;

  /**
   * Creates one form attempt for a Command and its observation state.
   * @param props The board form request and completion callback.
   * @param command The Command to post.
   * @param controller The attempt cancellation controller.
   * @param generation The current form generation.
   * @param state The form controls and retained handles.
   */
  constructor(
    private readonly props: PostFormProps,
    private readonly command: PostMessage,
    private readonly controller: AbortController,
    private readonly generation: number,
    private readonly state: PostAttemptState,
  ) {}

  /**
   * Checks whether this form still presents the attempt.
   * @returns Whether updates may change the form.
   */
  private get current(): boolean {
    return this.generation === this.state.postGeneration.current && !this.controller.signal.aborted;
  }

  /**
   * Posts after subscriptions are ready, then observes the matching result.
   * @returns Completion after the attempt ends.
   */
  async run(): Promise<void> {
    console.info("MessageBoard is sending a post command.", { board: this.props.board });
    try {
      const result = await this.props.request.postAndSubscribe(PostMessageSchema, this.command, {
        events: [MessagePostedSchema],
        rejections: [MessageAlreadyPostedSchema],
        signal: this.controller.signal,
        activationTimeoutMs: 5_000,
        firstUpdateTimeoutMs: 5_000,
        onFirstUpdateTimeout: () => this.notifyLate(),
      });
      if (!this.current) {
        if (result.kind === "accepted") await result.subscription.cancel().catch(() => undefined);
        return;
      }
      if (result.kind === "refused") {
        this.refuse(result.acknowledgement);
        return;
      }
      this.accepted = true;
      console.info("MessageBoard post command was accepted.", { board: this.props.board });
      this.state.postSubscription.current = result.subscription;
      if (!this.lateNotice)
        this.state.setFeedback({
          fields: {},
          general: "Message accepted; waiting for confirmation…",
        });
      await this.observe(result.subscription);
    } catch (error) {
      this.fail(error);
    }
  }

  /**
   * Notifies the form that admission succeeded but its first Event is late.
   */
  private notifyLate(): void {
    this.lateNotice = true;
    if (this.current)
      this.state.setFeedback({
        fields: {},
        general: "Still waiting for confirmation. Do not repost yet.",
      });
  }

  /**
   * Updates the form for a server admission refusal and focuses its first invalid field.
   * @param acknowledgement The refused admission acknowledgement.
   */
  private refuse(acknowledgement: Parameters<typeof PostFeedback.from>[0]): void {
    console.warn("MessageBoard post command was rejected.", { board: this.props.board });
    const feedback = PostFeedback.from(acknowledgement);
    this.state.setFeedback(feedback);
    if (Object.keys(feedback.fields).length > 0) this.state.pendingPost.current = undefined;
    if (feedback.fields.username !== undefined) this.state.usernameInput.current?.focus();
    else if (feedback.fields.text !== undefined) this.state.messageInput.current?.focus();
    this.state.setPosting(false);
  }

  /**
   * Reads admitted Event deliveries until a matching outcome appears.
   * @param subscription The continuing per-post Event handle.
   * @returns Completion after observation and explicit cancellation.
   */
  private async observe(subscription: Subscription): Promise<void> {
    try {
      for await (const delivery of subscription.updates) {
        if (!this.current) break;
        if (delivery.kind !== "update" || delivery.update.update.case !== "eventUpdates") continue;
        for (const event of delivery.update.update.value.event) if (this.consume(event)) return;
      }
      if (this.current) this.interrupted();
    } finally {
      await subscription.cancel().catch(() => undefined);
      if (this.state.postSubscription.current === subscription)
        this.state.postSubscription.current = undefined;
    }
  }

  /**
   * Applies one matching Event or rejection to the form.
   * @param event The delivered domain Event.
   * @returns Whether the Event completes this attempt.
   */
  private consume(event: Event): boolean {
    const posted =
      event.message === undefined
        ? undefined
        : AnyPacker.tryUnpack(event.message, MessagePostedSchema);
    if (posted?.id?.value === this.command.id?.value) {
      this.state.pendingPost.current = undefined;
      this.state.setText("");
      this.state.setFeedback({ fields: {} });
      this.state.setPosting(false);
      this.props.onPosted();
      return true;
    }
    const duplicate =
      event.message === undefined
        ? undefined
        : AnyPacker.tryUnpack(event.message, MessageAlreadyPostedSchema);
    if (duplicate?.id?.value !== this.command.id?.value) return false;
    this.state.pendingPost.current = undefined;
    this.state.setFeedback({ fields: {}, general: "This message was already posted." });
    this.state.setPosting(false);
    return true;
  }

  /**
   * Updates the form for interrupted observation without suggesting an automatic resend.
   */
  private interrupted(): void {
    this.state.setFeedback({
      fields: {},
      general: "Confirmation was interrupted. Check the board before retrying.",
    });
    this.state.setPosting(false);
  }

  /**
   * Updates the form for an uncertain transport or observation failure.
   * @param error The failed request or stream error.
   */
  private fail(error: unknown): void {
    if (!this.current) return;
    console.error("MessageBoard post command could not be sent.", {
      board: this.props.board,
      error,
    });
    this.state.setFeedback({
      fields: {},
      general: this.accepted
        ? "Confirmation was interrupted. Check the board before retrying."
        : "Posting could not be confirmed. Check the board before retrying.",
    });
    this.state.setPosting(false);
  }
}

interface PostFormViewProps {
  readonly username: string;
  readonly text: string;
  readonly feedback: PostFeedbackValue;
  readonly posting: boolean;
  readonly usernameInput: RefObject<HTMLInputElement | null>;
  readonly messageInput: RefObject<HTMLTextAreaElement | null>;
  readonly setUsername: Dispatch<SetStateAction<string>>;
  readonly setText: Dispatch<SetStateAction<string>>;
  readonly post: () => void;
}

/**
 * Renders the board form and delegates field controls to smaller components.
 * @param props The current form state and controls.
 * @returns The interactive post form.
 */
const PostFormViews = Object.freeze({
  /**
   * Sends the form on the documented keyboard shortcut.
   * @param event The textarea key event.
   * @param onPost Sends the current form.
   */
  shortcut(event: KeyboardEvent<HTMLTextAreaElement>, onPost: () => void): void {
    if (
      event.nativeEvent.isComposing ||
      event.key !== "Enter" ||
      (!event.metaKey && !event.ctrlKey)
    )
      return;
    event.preventDefault();
    onPost();
  },

  /**
   * Renders the board form and delegates field controls to smaller components.
   * @param props The current form state and controls.
   * @returns The interactive post form.
   */
  Form(props: PostFormViewProps): ReactElement {
    const onSubmit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      props.post();
    };
    return (
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Post a message</h2>
          <p className="text-sm text-muted-foreground">Both fields are required by the server.</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" noValidate onSubmit={onSubmit}>
            {props.feedback.general !== undefined && (
              <Alert role="alert" className="border-destructive/40 text-destructive">
                {props.feedback.general}
              </Alert>
            )}
            <PostFormViews.Username {...props} />
            <PostFormViews.Message {...props} />
            <div className="flex justify-end">
              <Button type="submit" disabled={props.posting}>
                <Send className="size-4" aria-hidden="true" />
                {props.posting ? "Posting…" : "Post message"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    );
  },

  /**
   * Renders the username input and server validation feedback.
   * @param props The current field state and controls.
   * @returns The username control.
   */
  Username(props: PostFormViewProps): ReactElement {
    const error = props.feedback.fields.username;
    return (
      <div className="space-y-2">
        <Label htmlFor="username">Username</Label>
        <Input
          ref={props.usernameInput}
          id="username"
          name="username"
          autoComplete="nickname"
          placeholder="How should people know you?"
          value={props.username}
          aria-invalid={error !== undefined}
          aria-describedby={error === undefined ? undefined : "username-error"}
          onChange={(event: ChangeEvent<HTMLInputElement>) => props.setUsername(event.target.value)}
        />
        {error !== undefined && (
          <p id="username-error" role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  },

  /**
   * Renders the message input, shortcut, and server validation feedback.
   * @param props The current field state and controls.
   * @returns The message control.
   */
  Message(props: PostFormViewProps): ReactElement {
    const error = props.feedback.fields.text;
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <Label htmlFor="message">Message</Label>
          <p id="message-hint" className="text-xs text-muted-foreground">
            ⌘↵ or Ctrl+Enter to post
          </p>
        </div>
        <Textarea
          ref={props.messageInput}
          id="message"
          name="message"
          placeholder="Share something with the board…"
          value={props.text}
          aria-invalid={error !== undefined}
          aria-describedby={error === undefined ? "message-hint" : "message-hint message-error"}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => props.setText(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) =>
            PostFormViews.shortcut(event, props.post)
          }
        />
        {error !== undefined && (
          <p id="message-error" role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  },
});

/**
 * Creates a post command for one board and public-demo actor.
 */
class BoardPost {
  // prettier-ignore

  /**
   * Creates a board-bound command factory.
   *
   * @param board The board that receives each command.
   * @param actor The public-demo actor that authors each command.
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
