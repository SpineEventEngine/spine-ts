import { create } from "@bufbuild/protobuf";
import { packAny } from "@spine-event-engine/core";
import { MessageSchema } from "@spine-event-engine/chat-model/generated/spine/example/chat/v1/chat_pb.js";
import { UserIdSchema } from "@spine-event-engine/users-model/generated/spine/example/users/v1/users_pb.js";
import { describe, expect, it } from "vitest";

import { typeRegistry, unpackChatValue } from "../src/index.js";

describe("Chat application model registry", () => {
  it("transitively decodes both Chat and Users model values", () => {
    const user = create(UserIdSchema, { value: "ada" });
    const message = create(MessageSchema, { author: user, text: "hello" });

    expect(unpackChatValue(packAny(UserIdSchema, user))?.$typeName).toBe(UserIdSchema.typeName);
    expect(unpackChatValue(packAny(MessageSchema, message))?.$typeName).toBe(MessageSchema.typeName);
    expect(typeRegistry.findByFullName(UserIdSchema.typeName)?.schema).toBe(UserIdSchema);
    expect(typeRegistry.findByFullName(MessageSchema.typeName)?.schema).toBe(MessageSchema);
  });
});
