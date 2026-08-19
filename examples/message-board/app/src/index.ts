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

/**
 * Defines the Message Board domain handlers and reusable application assembly.
 * Local and managed entrypoints both build their complete Bounded Context from this module.
 */

import { clone, create } from "@bufbuild/protobuf";
import type { SubscriptionBindings } from "@spine-event-engine/auth";
import {
  Aggregate,
  Assign,
  BoundedContext,
  EventRouting,
  Projection,
  Server,
  Subscribe,
  Where,
  type DeliveryStrategy,
  type RunningServer,
  type StandSubscriptionRegistry,
} from "@spine-event-engine/server";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import type { StorageFactory } from "@spine-event-engine/storage";

import {
  BoardMessageSchema,
  BoardMessageViewSchema,
  AnnouncementBoardViewSchema,
  BoardIdSchema,
  MessageIdSchema,
  type AnnouncementBoardView,
  type BoardId,
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
import { PublicBoardAdmission } from "./public-board-admission.js";
import { typeRegistry } from "./model-registry.js";

export { typeRegistry } from "./model-registry.js";
export { messageBoardProtoModule } from "@spine-event-engine/example-message-board-model";
export { BoardAccessPolicy, BoardContextResolver } from "./board-access.js";

/**
 * Applies commands to one message identified by `MessageId`.
 */
export class BoardMessageAggregate extends Aggregate<MessageId, typeof BoardMessageSchema, bigint> {
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
export class BoardViewProjection extends Projection<
  MessageId,
  typeof BoardMessageViewSchema,
  number
> {
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
 * Keeps the latest message for the public announcements board.
 */
export class AnnouncementBoardProjection extends Projection<
  BoardId,
  typeof AnnouncementBoardViewSchema,
  number
> {
  // prettier-ignore

  /**
   * Updates the board-wide announcement view from matching posted-message Events.
   *
   * @param event The announcement selected by generated Event-field metadata.
   */
  @Where({ eventField: "board", equals: '{"value":"announcements"}' })
  @Subscribe
  onAnnouncement(event: MessagePosted): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(AnnouncementBoardViewSchema, {
          id: clone(BoardIdSchema, event.board ?? this.id),
          message: event.id,
          text: event.text,
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

  /**
   * Supplies browser-subscription coordination.
   *
   * Production requires durable bindings. Local development may use an
   * in-memory implementation.
   */
  readonly bindings?: SubscriptionBindings;

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
   * @param deliveryStrategy Optionally selects Delivery shards for the context.
   * @param subscriptionRegistry Optionally supplies the context subscription registry.
   * @returns The assembled MessageBoard bounded context.
   */
  async createContext(
    storageFactory: StorageFactory = new InMemoryStorageFactory(),
    deliveryStrategy?: DeliveryStrategy,
    subscriptionRegistry?: StandSubscriptionRegistry,
  ): Promise<BoundedContext> {
    const announcementRouting = EventRouting.create<BoardId>().route(
      MessagePostedSchema,
      (event) =>
        event.board?.value === "announcements" ? [clone(BoardIdSchema, event.board)] : [],
    );
    const builder = BoundedContext.singleTenant("MessageBoard")
      .withStorageFactory(storageFactory)
      .withGeneratedRegistryRoot(new URL("..", import.meta.url))
      .add(BoardMessageAggregate)
      .add(BoardViewProjection)
      .add(AnnouncementBoardProjection, { eventRouting: announcementRouting });
    if (deliveryStrategy !== undefined) builder.withDeliveryStrategy(deliveryStrategy);
    if (subscriptionRegistry !== undefined) builder.withSubscriptionRegistry(subscriptionRegistry);
    return builder.buildAsync();
  }

  /**
   * Starts the MessageBoard server with in-memory storage.
   *
   * @param options Optional loopback host and ephemeral-port overrides.
   * @returns The running server, which callers must close when finished.
   */
  async start(options: BoardServerOptions = {}): Promise<RunningServer> {
    return (await this.#server(options, new InMemoryStorageFactory(), true)).start();
  }

  /**
   * Starts the local MessageBoard server with framework-owned process shutdown.
   *
   * @param options Optional loopback host and browser-origin overrides.
   * @returns The running server after the browser listener is ready.
   */
  async run(options: BoardServerOptions = {}): Promise<RunningServer> {
    return (await this.#server(options, new InMemoryStorageFactory(), true)).run();
  }

  /**
   * Starts the native MessageBoard application with an application-selected storage factory.
   *
   * @param options Network listener configuration.
   * @param storageFactory The MessageBoard storage factory selected by its deployment configuration.
   * @returns The running native application server.
   */
  async runApplication(
    options: BoardServerOptions,
    storageFactory: StorageFactory,
  ): Promise<RunningServer> {
    return (await this.#server(options, storageFactory, false)).run();
  }

  /**
   * Starts one native complete replica without installing process shutdown handlers.
   *
   * @param options Supplies the child listener configuration.
   * @param storageFactory Stores the replica state.
   * @param deliveryStrategy Selects Delivery shards for the replica.
   * @param subscriptionRegistry Holds volatile child subscription state.
   * @returns The started native application server.
   */
  async startManagedApplication(
    options: BoardServerOptions,
    storageFactory: StorageFactory,
    deliveryStrategy: DeliveryStrategy,
    subscriptionRegistry: StandSubscriptionRegistry,
  ): Promise<RunningServer> {
    return (
      await this.#server(options, storageFactory, false, deliveryStrategy, subscriptionRegistry)
    ).start();
  }

  /**
   * Starts the combined MessageBoard browser and native application server.
   *
   * @param options Network listener and browser configuration.
   * @param storageFactory The MessageBoard storage factory selected by its deployment configuration.
   * @returns The running combined server.
   */
  async runCombined(
    options: BoardServerOptions,
    storageFactory: StorageFactory,
  ): Promise<RunningServer> {
    return (await this.#server(options, storageFactory, true)).run();
  }

  async #server(
    options: BoardServerOptions,
    storageFactory: StorageFactory,
    browser: boolean,
    deliveryStrategy?: DeliveryStrategy,
    subscriptionRegistry?: StandSubscriptionRegistry,
  ): Promise<Server> {
    const policy = new BoardAccessPolicy();
    const server = Server.atPort(options.port ?? 0, {
      host: options.host ?? "127.0.0.1",
      services: { subscriptionLimit: 1_000 },
      ...(browser
        ? {
            browser: {
              origins: [options.webOrigin ?? "http://127.0.0.1:5173"],
              registry: typeRegistry,
              sessions: PublicBoardAdmission.resolver(),
              authorize: policy.authorize.bind(policy),
              contexts: new BoardContextResolver(),
              clock: PublicBoardAdmission.clock,
              ...(options.bindings === undefined ? {} : { bindings: options.bindings }),
            },
          }
        : {}),
    });
    return server.add(
      await this.createContext(storageFactory, deliveryStrategy, subscriptionRegistry),
    );
  }
}

export type { AnnouncementBoardView, BoardMessage, BoardMessageView };
