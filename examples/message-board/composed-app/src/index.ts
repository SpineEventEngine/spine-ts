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
  BoundedContext,
  EventRouting,
  Server,
  type StandSubscriptionRegistry,
  type SpineServicesOptions,
} from "@spine-event-engine/server";
import {
  BoardIdSchema,
  type BoardId,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { MessagePostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/events_pb.js";

import { ReadBoardMessageHandler, ReadBoardStatsHandler } from "./board-query-handler.js";
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
   * @param options Context and listener settings.
   * @returns The locally configured contexts and Server.
   */
  async create(options: ComposedBoardOptions = {}): Promise<ComposedBoard> {
    const messagesBuilder = BoardContextBuilders.messages(options);
    const announcementsBuilder = BoardContextBuilders.announcements(options);
    let messages: BoundedContext | undefined;
    let announcements: BoundedContext | undefined;
    try {
      messages = await messagesBuilder.build();
      announcements = await announcementsBuilder.build();
      const server = new Server({
        ...(options.host === undefined ? {} : { host: options.host }),
        ...(options.port === undefined ? {} : { port: options.port }),
        contexts: [messages, announcements],
        appQueries: [new ReadBoardMessageHandler(), new ReadBoardStatsHandler()],
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
      return { messages, announcements, server };
    } catch (error) {
      await Promise.allSettled([announcements?.close(), messages?.close()]);
      throw error;
    }
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

export { ReadBoardMessageHandler, ReadBoardStatsHandler } from "./board-query-handler.js";
