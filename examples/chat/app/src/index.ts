import { clone, create } from "@bufbuild/protobuf";
import {
  Aggregate,
  Assign,
  BoundedContext,
  Projection,
  Server,
  Subscribe,
  type RunningServer,
} from "@spine-event-engine/server";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import type { StorageFactory } from "@spine-event-engine/storage";

import {
  ChatMessageSchema,
  ChatMessageViewSchema,
  MessageIdSchema,
  type ChatMessage,
  type ChatMessageView,
  type MessageId,
} from "@spine-event-engine/example-chat-model/generated/spine/example/chat/v1/chat_pb.js";
import { type PostMessage } from "@spine-event-engine/example-chat-model/generated/spine/example/chat/v1/commands_pb.js";
import {
  MessagePostedSchema,
  type MessagePosted,
} from "@spine-event-engine/example-chat-model/generated/spine/example/chat/v1/events_pb.js";
import { ChatMessageValidation } from "./message-validation.js";
import { MessageAlreadyPosted } from "./rejections.js";

export { typeRegistry } from "./model-registry.js";
export { chatProtoModule } from "@spine-event-engine/example-chat-model";
export { ChatAuthorizationPolicy, ChatContextResolver } from "./chat-policy.js";

const messageValidation = new ChatMessageValidation();

/** Command-side state for one bounded chat message identified by `MessageId`. */
export class ChatMessageAggregate extends Aggregate<MessageId, typeof ChatMessageSchema> {
  /** Persists one message and publishes its read-side input event.
   *
   * @param command - The validated command that supplies message fields.
   * @returns The event that creates the corresponding Projection row.
   */
  @Assign
  postMessage(command: PostMessage): MessagePosted {
    messageValidation.validate({
      id: command.id?.value,
      room: command.room?.value,
      author: command.author?.value,
      text: command.text,
      postedAt: command.postedAt,
    });
    // The handler generator accepts synchronous `@Assign` methods only. The
    // aggregate's visible state is the only application-level existence fact.
    if (this.state.room !== undefined) {
      throw MessageAlreadyPosted.create({ id: this.id });
    }
    const id = clone(MessageIdSchema, this.id);
    this.update((draft) =>
      Object.assign(
        draft,
        create(ChatMessageSchema, {
          id,
          room: command.room,
          author: command.author,
          text: command.text,
          postedAt: command.postedAt,
        }),
      ),
    );
    return create(MessagePostedSchema, {
      id,
      room: command.room,
      author: command.author,
      text: command.text,
      postedAt: command.postedAt,
    });
  }
}

/** Full-visible read-side entity for one chat message. */
export class ChatMessageViewProjection extends Projection<MessageId, typeof ChatMessageViewSchema> {
  /** Materializes each posted message as its own Projection row.
   *
   * @param event - The event whose message fields become the row state.
   */
  @Subscribe
  onMessagePosted(event: MessagePosted): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ChatMessageViewSchema, {
          id: clone(MessageIdSchema, event.id ?? this.id),
          room: event.room,
          author: event.author,
          text: event.text,
          postedAt: event.postedAt,
        }),
      ),
    );
  }
}

/** Optional listener overrides; host defaults to loopback and port defaults to an ephemeral port. */
export interface ChatServerOptions {
  /** Selects the network interface that receives Chat requests. */
  readonly host?: string;
  /** Selects the TCP port that receives Chat requests. */
  readonly port?: number;
}

/** Owns assembly and local startup for the Chat application. */
export class ChatApplication {
  /** Builds the single-tenant Chat context with in-memory storage by default.
   *
   * @param storageFactory - The storage backend that records Chat state and events.
   * @returns The assembled Chat bounded context.
   */
  async createContext(
    storageFactory: StorageFactory = new InMemoryStorageFactory(),
  ): Promise<BoundedContext> {
    return BoundedContext.singleTenant("Chat")
      .withStorageFactory(storageFactory)
      .withGeneratedRegistryRoot(new URL("..", import.meta.url))
      .add(ChatMessageAggregate)
      .add(ChatMessageViewProjection)
      .buildAsync();
  }

  /** Starts the Chat server with in-memory storage.
   *
   * @param options - Optional loopback host and ephemeral-port overrides.
   * @returns The running server, which callers must close when finished.
   */
  async start(options: ChatServerOptions = {}): Promise<RunningServer> {
    return Server.atPort(options.port ?? 0, {
      host: options.host ?? "127.0.0.1",
      services: { subscriptionLimit: 1_000 },
    })
      .add(await this.createContext())
      .start();
  }
}

export type { ChatMessage, ChatMessageView };
