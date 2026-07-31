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
  BoardMessageSchema,
  BoardMessageViewSchema,
  MessageIdSchema,
  type BoardMessage,
  type BoardMessageView,
  type MessageId,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { type PostMessage } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/commands_pb.js";
import {
  MessagePostedSchema,
  type MessagePosted,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/events_pb.js";
import { MessageAlreadyPosted } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/rejections.js";

import { BoardAccessPolicy, BoardContextResolver } from "./board-access.js";
import { LocalBoardSession } from "./local-session.js";
import { typeRegistry } from "./model-registry.js";

export { typeRegistry } from "./model-registry.js";
export { messageBoardProtoModule } from "@spine-event-engine/example-message-board-model";
export { BoardAccessPolicy, BoardContextResolver } from "./board-access.js";

/**
 * Applies commands to one message identified by `MessageId`.
 */
export class BoardMessageAggregate extends Aggregate<MessageId, typeof BoardMessageSchema> {
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
    if (this.state.board !== undefined) {
      throw MessageAlreadyPosted.create({ id: this.id });
    }
    const id = clone(MessageIdSchema, this.id);
    this.update((draft) =>
      Object.assign(
        draft,
        create(BoardMessageSchema, {
          id,
          board: command.board,
          author: command.author,
          username: command.username,
          text: command.text,
          postedAt: command.postedAt,
        }),
      ),
    );
    return create(MessagePostedSchema, {
      id,
      board: command.board,
      author: command.author,
      username: command.username,
      text: command.text,
      postedAt: command.postedAt,
    });
  }
}

/**
 * Builds the messages displayed on a board.
 */
export class BoardViewProjection extends Projection<MessageId, typeof BoardMessageViewSchema> {
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
        create(BoardMessageViewSchema, {
          id: clone(MessageIdSchema, event.id ?? this.id),
          board: event.board,
          author: event.author,
          username: event.username,
          text: event.text,
          postedAt: event.postedAt,
        }),
      ),
    );
  }
}

/**
 * Configures the MessageBoard server listener and browser origin.
 */
export interface BoardServerOptions {
  // prettier-ignore

  /**
   * Selects the network interface that receives MessageBoard requests.
   */
  readonly host?: string;

  /**
   * Selects the TCP port that receives MessageBoard requests.
   */
  readonly port?: number;

  /**
   * Selects the sole browser origin admitted by the local gateway.
   */
  readonly webOrigin?: string;
}

/**
 * Starts the local MessageBoard application.
 */
export class MessageBoardApplication {
  // prettier-ignore

  /**
   * Builds the single-tenant MessageBoard context with in-memory storage by default.
   *
   * @param storageFactory The storage backend that records MessageBoard state and events.
   * @returns The assembled MessageBoard bounded context.
   */
  async createContext(
    storageFactory: StorageFactory = new InMemoryStorageFactory(),
  ): Promise<BoundedContext> {
    return BoundedContext.singleTenant("MessageBoard")
      .withStorageFactory(storageFactory)
      .withGeneratedRegistryRoot(new URL("..", import.meta.url))
      .add(BoardMessageAggregate)
      .add(BoardViewProjection)
      .buildAsync();
  }

  /**
   * Starts the MessageBoard server with in-memory storage.
   *
   * @param options Optional loopback host and ephemeral-port overrides.
   * @returns The running server, which callers must close when finished.
   */
  async start(options: BoardServerOptions = {}): Promise<RunningServer> {
    return (await this.#server(options)).start();
  }

  /**
   * Starts the local MessageBoard server with framework-owned process shutdown.
   *
   * @param options Optional loopback host and browser-origin overrides.
   * @returns The running server after the browser listener is ready.
   */
  async run(options: BoardServerOptions = {}): Promise<RunningServer> {
    return (await this.#server(options)).run();
  }

  async #server(options: BoardServerOptions): Promise<Server> {
    const policy = new BoardAccessPolicy();
    return Server.atPort(options.port ?? 0, {
      host: options.host ?? "127.0.0.1",
      services: { subscriptionLimit: 1_000 },
      browser: {
        origins: [options.webOrigin ?? "http://127.0.0.1:5173"],
        registry: typeRegistry,
        sessions: LocalBoardSession.resolver(),
        authorize: policy.authorize.bind(policy),
        contexts: new BoardContextResolver(),
        clock: LocalBoardSession.clock,
        fingerprint: (principal) => principal.id,
      },
    }).add(await this.createContext());
  }
}

export type { BoardMessage, BoardMessageView };
