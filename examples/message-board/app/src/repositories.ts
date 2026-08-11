import { clone } from "@bufbuild/protobuf";
import {
  EventRouting,
  GeneratedRegistryDiscovery,
  HandlerMetadataRegistry,
  Repository,
  type DescriptorMessageSchema,
  type EntityClass,
  type EntityHandlersMetadata,
} from "@spine-event-engine/server";
import {
  AnnouncementBoardViewSchema,
  BoardIdSchema,
  BoardMessageSchema,
  BoardMessageViewSchema,
  type BoardId,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { MessagePostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/events_pb.js";
import { fileURLToPath } from "node:url";

import type {
  AnnouncementBoardProjection,
  BoardMessageAggregate,
  BoardViewProjection,
} from "./index.js";

interface MessageBoardEntityTypes {
  readonly aggregate: typeof BoardMessageAggregate;
  readonly messages: typeof BoardViewProjection;
  readonly announcements: typeof AnnouncementBoardProjection;
}

interface MessageBoardRepositoryAssembly {
  readonly aggregate: Repository<typeof BoardMessageAggregate>;
  readonly messages: Repository<typeof BoardViewProjection>;
  readonly announcements: Repository<typeof AnnouncementBoardProjection>;
}

interface MessageBoardRepositoryContract {
  load(root: URL, entityTypes: MessageBoardEntityTypes): Promise<MessageBoardRepositoryAssembly>;
  handlers<Instance extends object, Schema extends DescriptorMessageSchema>(
    registry: HandlerMetadataRegistry,
    entityType: EntityClass<Instance>,
    schema: Schema,
  ): EntityHandlersMetadata<Instance, Schema>;
}

/**
 * Builds Message Board repositories from generated handlers and authored routes.
 */
export const MessageBoardRepositories: Readonly<MessageBoardRepositoryContract> = Object.freeze({
  async load(
    root: URL,
    entityTypes: MessageBoardEntityTypes,
  ): Promise<MessageBoardRepositoryAssembly> {
    const module = GeneratedRegistryDiscovery.conventionalModuleUrl(fileURLToPath(root));
    const metadata = await new GeneratedRegistryDiscovery().register({ modules: [module] });
    const aggregateHandlers = MessageBoardRepositories.handlers(
      metadata,
      entityTypes.aggregate,
      BoardMessageSchema,
    );
    const messageHandlers = MessageBoardRepositories.handlers(
      metadata,
      entityTypes.messages,
      BoardMessageViewSchema,
    );
    const announcementHandlers = MessageBoardRepositories.handlers(
      metadata,
      entityTypes.announcements,
      AnnouncementBoardViewSchema,
    );
    const announcementRouting = EventRouting.create<BoardId>().route(
      MessagePostedSchema,
      (event) =>
        event.board?.value === "announcements" ? [clone(BoardIdSchema, event.board)] : [],
    );
    return Object.freeze({
      aggregate: new Repository({
        entityType: entityTypes.aggregate,
        schema: BoardMessageSchema,
        handlers: aggregateHandlers,
        events: [MessagePostedSchema],
      }),
      messages: new Repository({
        entityType: entityTypes.messages,
        schema: BoardMessageViewSchema,
        handlers: messageHandlers,
      }),
      announcements: new Repository({
        entityType: entityTypes.announcements,
        schema: AnnouncementBoardViewSchema,
        handlers: announcementHandlers,
        eventRouting: announcementRouting,
      }),
    });
  },

  handlers<Instance extends object, Schema extends DescriptorMessageSchema>(
    registry: HandlerMetadataRegistry,
    entityType: EntityClass<Instance>,
    schema: Schema,
  ): EntityHandlersMetadata<Instance, Schema> {
    const handlers = registry
      .findByState(schema.typeName)
      .find((candidate) => candidate.entityType === entityType);
    if (handlers === undefined) {
      throw new Error(`Generated MessageBoard handlers are missing for ${schema.typeName}.`);
    }
    return handlers as EntityHandlersMetadata<Instance, Schema>;
  },
});
