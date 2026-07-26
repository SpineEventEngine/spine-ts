import { clone, create, type Message as ProtoMessage } from "@bufbuild/protobuf";
import { unpackAnyUsing, packAny } from "@spine-event-engine/core";
import {
  Aggregate,
  Assign,
  BoundedContext,
  Server,
  type EventDispatcher,
  type RunningServer,
} from "@spine-event-engine/server";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import type { StorageFactory } from "@spine-event-engine/storage";

import {
  ChatIdSchema,
  ChatSchema,
  MessageSchema,
  type ChatId,
  type Message,
} from "@spine-event-engine/chat-model/generated/spine/example/chat/v1/chat_pb.js";
import { type PostMessage } from "@spine-event-engine/chat-model/generated/spine/example/chat/v1/commands_pb.js";
import {
  MessagePostedSchema,
  type MessagePosted,
} from "@spine-event-engine/chat-model/generated/spine/example/chat/v1/events_pb.js";
import {
  UserIdSchema,
  type UserId,
} from "@spine-event-engine/users-model/generated/spine/example/users/v1/users_pb.js";

import { typeRegistry } from "./model-registry.js";

export { typeRegistry } from "./model-registry.js";
export { chatProtoModule } from "@spine-event-engine/chat-model";

const chatEventEndpoint: EventDispatcher = Object.freeze({
  messageSchemas: () => [MessagePostedSchema],
  dispatch: () => Promise.resolve(),
});

/** Aggregate state and behavior for one chat identified by `ChatId`. */
export class ChatAggregate extends Aggregate<ChatId, typeof ChatSchema> {
  /** Add one message to the Chat and publish its matching domain event. */
  @Assign
  postMessage(command: PostMessage): MessagePosted {
    const id = clone(ChatIdSchema, this.id);
    const message = create(MessageSchema, { author: command.author, text: command.text });
    this.update((draft) =>
      Object.assign(draft, create(ChatSchema, { id, messages: [...draft.messages, message] })),
    );
    return create(MessagePostedSchema, { id, author: command.author, text: command.text });
  }
}

/** Builds the single-tenant Chat context with in-memory storage by default. */
export async function createChatContext(
  storageFactory: StorageFactory = new InMemoryStorageFactory(),
): Promise<BoundedContext> {
  return BoundedContext.singleTenant("Chat")
    .withStorageFactory(storageFactory)
    .withGeneratedRegistryRoot(new URL("..", import.meta.url))
    .add(ChatAggregate)
    .addEventDispatcher(chatEventEndpoint)
    .buildAsync();
}

export interface ChatServerOptions {
  readonly host?: string;
  readonly port?: number;
}

/** Starts the runnable Chat server using an in-memory storage backend. */
export async function startChatServer(options: ChatServerOptions = {}): Promise<RunningServer> {
  return Server.atPort(options.port ?? 0, {
    host: options.host ?? "127.0.0.1",
    services: { subscriptionLimit: 1_000 },
  })
    .add(await createChatContext())
    .start();
}

/** Creates a neutral Chat message for application-level model composition. */
export function postMessage(author: UserId, text: string): Message {
  return create(MessageSchema, { author, text });
}

/** Dynamically decodes registered application model values. */
export function unpackChatValue(
  value: Parameters<typeof unpackAnyUsing>[1],
): ProtoMessage | undefined {
  return unpackAnyUsing(typeRegistry, value);
}

/** Packs a user identifier for use by a Chat application boundary. */
export function packUserId(user: UserId): Parameters<typeof unpackAnyUsing>[1] {
  return packAny(UserIdSchema, user);
}
