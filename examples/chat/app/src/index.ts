import { clone, create, type Message as ProtoMessage } from "@bufbuild/protobuf";
import { unpackAnyUsing, packAny } from "@spine-event-engine/core";
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
import {
  UserIdSchema,
  type UserId,
} from "@spine-event-engine/example-chat-users-model/generated/spine/example/users/v1/users_pb.js";

import { typeRegistry } from "./model-registry.js";
import { validateChatMessageInput } from "./message-validation.js";
import { MessageAlreadyPosted } from "./rejections.js";

export { typeRegistry } from "./model-registry.js";
export { chatProtoModule } from "@spine-event-engine/example-chat-model";
export { ChatAuthorizationPolicy, ChatContextResolver } from "./chat-policy.js";

/** Command-side state for one bounded chat message identified by `MessageId`. */
export class ChatMessageAggregate extends Aggregate<MessageId, typeof ChatMessageSchema> {
  /** Persist one message and publish its read-side input event. */
  @Assign
  postMessage(command: PostMessage): MessagePosted {
    validateChatMessageInput({
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
  /** Materialize each posted message as its own Projection row. */
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

/** Builds the single-tenant Chat context with in-memory storage by default. */
export async function createChatContext(
  storageFactory: StorageFactory = new InMemoryStorageFactory(),
): Promise<BoundedContext> {
  return BoundedContext.singleTenant("Chat")
    .withStorageFactory(storageFactory)
    .withGeneratedRegistryRoot(new URL("..", import.meta.url))
    .add(ChatMessageAggregate)
    .add(ChatMessageViewProjection)
    .buildAsync();
}

/** Optional listener overrides; host defaults to loopback and port defaults to an ephemeral port. */
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

export type { ChatMessage, ChatMessageView };
