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
  BoardViewProjection,
} from "@spine-event-engine/example-message-board-view-handlers";
import { clone } from "@bufbuild/protobuf";
import {
  BoundedContext,
  EnvironmentType,
  EventRouting,
  Server,
  ServerEnvironment,
  type ServerOptions,
} from "@spine-event-engine/server";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import {
  BoardIdSchema,
  type BoardId,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { MessagePostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/events_pb.js";

import { ReadBoardMessageHandler } from "./board-query-handler.js";
import {
  BoardContextLabel,
  BoardVisibility,
  PublishedEventVisibility,
  ResultLabel,
  ServerMessageLabel,
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
 * Builds the two contexts and their application Server from generated metadata.
 */
export class ComposedBoardApplication {
  /**
   * Stores a configured native authentication port separately from actor metadata.
   *
   * @param readerAdmission A host-supplied verifier for direct native readers.
   */
  constructor(
    private readonly readerAdmission?: NonNullable<ServerOptions["services"]>["readerAdmission"],
  ) {}

  /**
   * Builds contexts from dependency handlers and registers the selected query handler.
   *
   * @returns The locally configured contexts and Server.
   */
  async create(): Promise<ComposedBoard> {
    ServerEnvironment.when(EnvironmentType.Local).use({
      storageFactory: new InMemoryStorageFactory(),
    });
    await ServerEnvironment.instance().completeSetup();
    const visibility = new BoardVisibility();
    const messages = await BoundedContext.singleTenant("ComposedMessages")
      .add(BoardMessageAggregate)
      .add(BoardViewProjection)
      .addReadSideFilter(new BoardContextLabel())
      .addReadSideFilter(visibility)
      .build();
    const announcementRouting = EventRouting.create<BoardId>().route(
      MessagePostedSchema,
      (event) =>
        event.board?.value === "announcements" ? [clone(BoardIdSchema, event.board)] : [],
    );
    const announcements = await BoundedContext.singleTenant("ComposedAnnouncements")
      .add(AnnouncementBoardProjection, { eventRouting: announcementRouting })
      .build();
    const server = new Server({
      contexts: [messages, announcements],
      appQueries: [new ReadBoardMessageHandler()],
      ...(this.readerAdmission === undefined
        ? {}
        : { services: { readerAdmission: this.readerAdmission } }),
      readSideFilters: [
        visibility,
        new ResultLabel(),
        new ServerMessageLabel(),
        new PublishedEventVisibility(),
      ],
    });
    return { messages, announcements, server };
  }
}

export { ReadBoardMessageHandler } from "./board-query-handler.js";
