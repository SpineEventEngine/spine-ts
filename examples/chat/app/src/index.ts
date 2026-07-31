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
} from "@spine-event-engine/example-chat-model/generated/spine/examples/chat/chat_pb.js";
import { type PostMessage } from "@spine-event-engine/example-chat-model/generated/spine/examples/chat/commands_pb.js";
import {
  MessagePostedSchema,
  type MessagePosted,
} from "@spine-event-engine/example-chat-model/generated/spine/examples/chat/events_pb.js";
import { MessageAlreadyPosted } from "@spine-event-engine/example-chat-model/generated/spine/examples/chat/rejections.js";

import { ChatAuthorizationPolicy, ChatContextResolver } from "./chat-policy.js";
import { LocalChatSession } from "./local-session.js";
import { typeRegistry } from "./model-registry.js";

export { typeRegistry } from "./model-registry.js";
export { chatProtoModule } from "@spine-event-engine/example-chat-model";
export { ChatAuthorizationPolicy, ChatContextResolver } from "./chat-policy.js";

/**
 * Command-side state for one bounded chat message identified by `MessageId`.
 */
export class ChatMessageAggregate extends Aggregate<MessageId, typeof ChatMessageSchema> {
  // prettier-ignore

  /**
   * Persists one message and publishes its read-side input event.
   *
   * @param command The validated command that supplies message fields.
   * @returns The event that creates the corresponding Projection row.
   */
  @Assign
  postMessage(command: PostMessage): MessagePosted {
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

/**
 * Full-visible read-side entity for one chat message.
 */
export class ChatMessageViewProjection extends Projection<MessageId, typeof ChatMessageViewSchema> {
  // prettier-ignore

  /**
   * Updates the Projection row for each posted message.
   *
   * @param event The event whose message fields become the row state.
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

/**
 * Optional listener overrides; host defaults to loopback and port defaults to an ephemeral port.
 */
export interface ChatServerOptions {
  // prettier-ignore

  /**
   * Selects the network interface that receives Chat requests.
   */
  readonly host?: string;

  /**
   * Selects the TCP port that receives Chat requests.
   */
  readonly port?: number;

  /**
   * Selects the sole browser origin admitted by the local gateway.
   */
  readonly webOrigin?: string;
}

/**
 * Assembles and starts the local Chat application.
 */
export class ChatApplication {
  // prettier-ignore

  /**
   * Builds the single-tenant Chat context with in-memory storage by default.
   *
   * @param storageFactory The storage backend that records Chat state and events.
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

  /**
   * Starts the Chat server with in-memory storage.
   *
   * @param options Optional loopback host and ephemeral-port overrides.
   * @returns The running server, which callers must close when finished.
   */
  async start(options: ChatServerOptions = {}): Promise<RunningServer> {
    return (await this.#server(options)).start();
  }

  /**
   * Starts the local Chat server with framework-owned process shutdown.
   *
   * @param options Optional loopback host and browser-origin overrides.
   * @returns The running server after the browser listener is ready.
   */
  async run(options: ChatServerOptions = {}): Promise<RunningServer> {
    return (await this.#server(options)).run();
  }

  async #server(options: ChatServerOptions): Promise<Server> {
    const policy = new ChatAuthorizationPolicy();
    return Server.atPort(options.port ?? 0, {
      host: options.host ?? "127.0.0.1",
      services: { subscriptionLimit: 1_000 },
      browser: {
        origins: [options.webOrigin ?? "http://127.0.0.1:5173"],
        registry: typeRegistry,
        sessions: LocalChatSession.resolver(),
        authorize: policy.authorize.bind(policy),
        contexts: new ChatContextResolver(),
        clock: LocalChatSession.clock,
        fingerprint: (principal) => principal.id,
      },
    }).add(await this.createContext());
  }
}

export type { ChatMessage, ChatMessageView };
