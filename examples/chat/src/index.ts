import { create, type Message as ProtoMessage } from "@bufbuild/protobuf";
import { unpackAnyUsing, packAny } from "@spine-event-engine/core";
import { MessageSchema, type Message } from "@spine-event-engine/chat-model/generated/spine/example/chat/v1/chat_pb.js";
import { UserIdSchema, type UserId } from "@spine-event-engine/users-model/generated/spine/example/users/v1/users_pb.js";

import { typeRegistry } from "./model-registry.js";

export { typeRegistry } from "./model-registry.js";

/** Creates a chat message and demonstrates application-level model composition. */
export function postMessage(author: UserId, text: string): Message {
  return create(MessageSchema, { author, text });
}

/** Dynamically decodes registered application model values. */
export function unpackChatValue(value: Parameters<typeof unpackAnyUsing>[1]): ProtoMessage | undefined {
  return unpackAnyUsing(typeRegistry, value);
}

/** Packs a user identifier for use by a Chat application boundary. */
export function packUserId(user: UserId): Parameters<typeof unpackAnyUsing>[1] {
  return packAny(UserIdSchema, user);
}
