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

import "../generated/spine-bootstrap.js";

import { BoardMessageAggregate } from "@spine-event-engine/example-message-board-command-handlers";
import {
  AnnouncementBoardProjection,
  BoardStatisticsProjection,
  BoardViewProjection,
} from "@spine-event-engine/example-message-board-view-handlers";
import { clone } from "@bufbuild/protobuf";
import {
  Application,
  BoundedContext,
  EventRouting,
  Server,
  type ServerEnvironment,
  type StandSubscriptionRegistry,
  type SpineServicesOptions,
} from "@spine-event-engine/server";
import {
  BoardIdSchema,
  type BoardId,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { MessagePostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/events_pb.js";

import { ReadBoardStatsHandler } from "./board-query-handler.js";
import {
  AggregateAuthorRedaction,
  AggregateVisibility,
  AnnouncementDisclosure,
  AnnouncementVisibility,
  BoardStatisticsDisclosure,
  BoardStatisticsVisibility,
  BoardVisibility,
  EventAuthorRedaction,
  MessageAuthorRedaction,
  PublishedEventVisibility,
} from "./read-policies.js";

/**
 * Exposes the two Bounded Contexts and Server assembled by this application.
 */
export interface ComposedBoard {
  /**
   * Keeps both Bounded Contexts and their shared facilities active.
   */
  readonly application: Application;

  /**
   * Contains message commands and their Projection rows from separate packages.
   */
  readonly messages: BoundedContext;

  /**
   * Contains the announcements Projection from the view package.
   */
  readonly announcements: BoundedContext;

  /**
   * Registers the application query handler and final read policies.
   */
  readonly server: Server;
}

/**
 * Settings supplied by the already configured application startup boundary.
 */
export interface ComposedBoardOptions {
  /**
   * Selects the native listener host.
   */
  readonly host?: string;

  /**
   * Selects the native listener port.
   */
  readonly port?: number;

  /**
   * Creates separate registries for the two Bounded Contexts.
   *
   * @returns A fresh registry for one Bounded Context.
   */
  readonly registryFactory?: () => StandSubscriptionRegistry;
}

/**
 * Builds the two contexts and their application Server from generated metadata.
 */
export class ComposedBoardApplication {
  /**
   * Stores a configured native authentication port separately from actor metadata.
   *
   * @param readerAdmission A host-supplied verifier for direct native readers.
   */
  constructor(private readonly readerAdmission?: SpineServicesOptions["readerAdmission"]) {}

  /**
   * Builds contexts from dependency handlers and registers the selected query handler.
   *
   * @param environment Configured facilities for both Bounded Contexts.
   * @param options Context and listener settings.
   * @returns The locally configured contexts and Server.
   */
  async create(
    environment: ServerEnvironment,
    options: ComposedBoardOptions = {},
  ): Promise<ComposedBoard> {
    let server: Server;
    try {
      server = this.#server(options);
    } catch (error) {
      return ComposedBoardApplication.closeAfterFailure(error, () => environment.close());
    }
    const application = await ComposedBoardApplication.buildApplication(environment, options);
    const [messages, announcements] = application.contexts();
    if (messages === undefined || announcements === undefined) {
      return ComposedBoardApplication.closeAfterFailure(
        new Error("Expected both Message Board Bounded Contexts."),
        () => application.close(),
      );
    }
    try {
      server.setApplication(application);
    } catch (error) {
      return ComposedBoardApplication.closeAfterFailure(error, () => application.close());
    }
    return {
      application,
      messages,
      announcements,
      server,
    };
  }

  /**
   * Builds both Bounded Contexts after native options have been validated.
   *
   * @param environment Selected Message Board facilities.
   * @param options Bounded Context options.
   * @returns Assembled Application.
   */
  private static async buildApplication(
    environment: ServerEnvironment,
    options: ComposedBoardOptions,
  ): Promise<Application> {
    const builder = Application.newBuilder().setServerEnvironment(environment);
    try {
      return await builder
        .add(BoardContextBuilders.messages(options))
        .add(BoardContextBuilders.announcements(options))
        .build();
    } catch (error) {
      return ComposedBoardApplication.closeAfterFailure(error, async () => {
        await builder.close();
        await environment.close();
      });
    }
  }

  /**
   * Closes a partially assembled Message Board while retaining the original failure.
   *
   * @param error The assembly failure.
   * @param close Closes the acquired environment or Application.
   * @returns Never, because assembly failed.
   */
  private static async closeAfterFailure(
    error: unknown,
    close: () => Promise<void>,
  ): Promise<never> {
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], "Message Board assembly cleanup failed.");
    }
    throw error;
  }

  /**
   * Configures one native endpoint for the assembled Application.
   *
   * @param application Shared Message Board Application.
   * @param options Native listener and registry settings.
   * @returns The native Server builder.
   */
  #server(options: ComposedBoardOptions): Server {
    return Server.atPort(options.port ?? 0, {
      host: options.host ?? "127.0.0.1",
      appQueries: [new ReadBoardStatsHandler()],
      ...(this.readerAdmission === undefined
        ? {}
        : { services: { readerAdmission: this.readerAdmission } }),
      readSideFilters: [
        new AggregateAuthorRedaction(),
        new MessageAuthorRedaction(),
        new EventAuthorRedaction(),
        new BoardStatisticsDisclosure(),
        new AnnouncementDisclosure(),
      ],
    });
  }
}

const BoardContextBuilders = Object.freeze({
  /**
   * Builds the message context with its cumulative board Projection.
   *
   * @param options Supplies registry configuration.
   * @returns The configured messages context builder.
   */
  messages(options: ComposedBoardOptions) {
    const routing = EventRouting.create<BoardId>().route(MessagePostedSchema, (event) =>
      event.board === undefined ? [] : [clone(BoardIdSchema, event.board)],
    );
    const builder = BoundedContext.singleTenant("ComposedMessages")
      .add(BoardMessageAggregate)
      .add(BoardViewProjection)
      .add(BoardStatisticsProjection, { eventRouting: routing })
      .addReadSideFilter(new AggregateVisibility())
      .addReadSideFilter(new BoardVisibility())
      .addReadSideFilter(new BoardStatisticsVisibility())
      .addReadSideFilter(new PublishedEventVisibility());
    if (options.registryFactory !== undefined)
      builder.withSubscriptionRegistry(options.registryFactory());
    return builder;
  },

  /**
   * Builds the separate announcement Projection context.
   *
   * @param options Supplies registry configuration.
   * @returns The configured announcements context builder.
   */
  announcements(options: ComposedBoardOptions) {
    const routing = EventRouting.create<BoardId>().route(MessagePostedSchema, (event) =>
      event.board?.value === "announcements" ? [clone(BoardIdSchema, event.board)] : [],
    );
    const builder = BoundedContext.singleTenant("ComposedAnnouncements")
      .add(AnnouncementBoardProjection, { eventRouting: routing })
      .addReadSideFilter(new AnnouncementVisibility());
    if (options.registryFactory !== undefined)
      builder.withSubscriptionRegistry(options.registryFactory());
    return builder;
  },
});

export { ReadBoardStatsHandler } from "./board-query-handler.js";
