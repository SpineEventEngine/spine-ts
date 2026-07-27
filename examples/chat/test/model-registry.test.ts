import { create } from "@bufbuild/protobuf";
import {
  Client,
  EntityQuery,
  type EventSubscription,
  type StateSubscription,
} from "@spine-event-engine/client-node";
import { packAny } from "@spine-event-engine/core";
import {
  ChatIdSchema,
  ChatSchema,
  MessageSchema,
} from "@spine-event-engine/chat-model/generated/spine/example/chat/v1/chat_pb.js";
import { PostMessageSchema } from "@spine-event-engine/chat-model/generated/spine/example/chat/v1/commands_pb.js";
import { MessagePostedSchema } from "@spine-event-engine/chat-model/generated/spine/example/chat/v1/events_pb.js";
import { ActorContextSchema } from "@spine-event-engine/proto";
import { Server } from "@spine-event-engine/server";
import { UserIdSchema } from "@spine-event-engine/users-model/generated/spine/example/users/v1/users_pb.js";
import { describe, expect, it } from "vitest";

import {
  createChatContext,
  packUserId,
  postMessage,
  typeRegistry,
  unpackChatValue,
} from "../dist/src/index.js";

describe("Chat application model registry", () => {
  it("transitively decodes both Chat and Users model values", () => {
    const user = create(UserIdSchema, { value: "ada" });
    const message = create(MessageSchema, { author: user, text: "hello" });

    expect(unpackChatValue(packAny(UserIdSchema, user))?.$typeName).toBe(UserIdSchema.typeName);
    expect(unpackChatValue(packAny(MessageSchema, message))?.$typeName).toBe(
      MessageSchema.typeName,
    );
    expect(typeRegistry.findByFullName(UserIdSchema.typeName)?.schema).toBe(UserIdSchema);
    expect(typeRegistry.findByFullName(MessageSchema.typeName)?.schema).toBe(MessageSchema);
  });

  it("creates and packs neutral Chat model values", () => {
    const user = create(UserIdSchema, { value: "ada" });
    expect(postMessage(user, "hello")).toEqual(
      create(MessageSchema, { author: user, text: "hello" }),
    );
    expect(unpackChatValue(packUserId(user))).toEqual(user);
  });

  it("posts Chat commands and observes the aggregate state and event through the public client", async () => {
    const context = await createChatContext();
    const server = await Server.atPort(0, { host: "127.0.0.1" }).add(context).start();
    const client = Client.connectTo(server.baseUrl);
    const chatId = create(ChatIdSchema, { value: "chat-1" });
    const author = create(UserIdSchema, { value: "ada" });
    let states: StateSubscription<typeof ChatSchema, typeof ChatIdSchema> | undefined;
    let events: EventSubscription<typeof MessagePostedSchema> | undefined;
    try {
      states = await client.asGuest().subscribeToState(ChatSchema, ChatIdSchema, {
        ids: [chatId],
      });
      events = await client.asGuest().subscribeToEvents(MessagePostedSchema);
      const stateUpdate = states[Symbol.asyncIterator]().next();
      const eventUpdate = events[Symbol.asyncIterator]().next();

      await expect(
        client
          .asGuest()
          .post(
            PostMessageSchema,
            create(PostMessageSchema, { id: chatId, author, text: "hello" }),
          ),
      ).resolves.toEqual({ kind: "ok" });

      await expect(context.stand().readVersioned(ChatSchema, chatId)).resolves.toMatchObject({
        state: { id: { value: "chat-1" }, messages: [{ text: "hello" }] },
      });

      const query = EntityQuery.select({
        schema: ChatSchema,
        columns: {} as never,
        context: create(ActorContextSchema),
      })
        .byId(chatId)
        .build();
      await expect(
        readEventually(() => client.asGuest().query(ChatSchema, query)),
      ).resolves.toMatchObject({
        kind: "ok",
        states: [{ state: { id: { value: "chat-1" }, messages: [{ text: "hello" }] } }],
      });
      await expect(withTimeout(stateUpdate, "filtered Chat state update")).resolves.toMatchObject({
        value: { kind: "state", state: { id: { value: "chat-1" } } },
      });
      await expect(withTimeout(eventUpdate, "MessagePosted event update")).resolves.toMatchObject({
        value: { message: { id: { value: "chat-1" }, text: "hello" } },
      });
    } finally {
      const cleanup: Promise<void>[] = [];
      if (states !== undefined) cleanup.push(states.cancel());
      if (events !== undefined) cleanup.push(events.cancel());
      await Promise.allSettled(cleanup);
      await withTimeout(client.close(), "Chat client shutdown");
      await withTimeout(server.close(), "Chat server shutdown");
    }
  }, 15_000);
});

async function readEventually<Result>(read: () => Promise<Result>): Promise<Result> {
  const deadline = Date.now() + 5_000;
  let lastResult: Result | undefined;
  while (Date.now() < deadline) {
    const result = await read();
    lastResult = result;
    if (
      typeof result === "object" &&
      result !== null &&
      "kind" in result &&
      result.kind === "ok" &&
      "states" in result &&
      Array.isArray(result.states) &&
      result.states.length > 0
    ) {
      return result;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
  throw new Error(`Chat state was not visible within 5000ms: ${JSON.stringify(lastResult)}.`);
}

async function withTimeout<Result>(work: Promise<Result>, label: string): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<Result>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Timed out waiting for ${label}.`));
        }, 2_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
