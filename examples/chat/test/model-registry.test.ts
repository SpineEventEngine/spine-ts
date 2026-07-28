import { create } from "@bufbuild/protobuf";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  Client,
  type Subscription,
  type SubscriptionDelivery,
} from "@spine-event-engine/client-node";
import { deriveTypeUrl, packAny, unpackAny } from "@spine-event-engine/core";
import {
  ChatMessageSchema,
  ChatMessageViewSchema,
  ChatRoomIdSchema,
  MessageIdSchema,
  type ChatMessageView,
} from "@spine-event-engine/chat-model/generated/spine/example/chat/v1/chat_pb.js";
import { PostMessageSchema } from "@spine-event-engine/chat-model/generated/spine/example/chat/v1/commands_pb.js";
import { MessagePostedSchema } from "@spine-event-engine/chat-model/generated/spine/example/chat/v1/events_pb.js";
import { MessageAlreadyPostedSchema } from "@spine-event-engine/chat-model/generated/spine/example/chat/v1/rejections_pb.js";
import { ActorContextSchema } from "@spine-event-engine/proto";
import {
  CompositeFilter_CompositeOperator,
  CompositeFilterSchema,
  Filter_Operator,
  FilterSchema,
  QueryIdSchema,
  QuerySchema,
  TargetFiltersSchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
  type Query,
} from "@spine-event-engine/proto/client";
import { Server } from "@spine-event-engine/server";
import { EventStore, InMemoryStorageFactory } from "@spine-event-engine/storage";
import {
  UserIdSchema,
  type UserId,
} from "@spine-event-engine/users-model/generated/spine/example/users/v1/users_pb.js";
import { describe, expect, it } from "vitest";

import { createChatContext, packUserId, typeRegistry, unpackChatValue } from "../dist/src/index.js";

describe("Chat Projection backend", () => {
  it("transitively decodes Chat and Users model values", () => {
    const user = create(UserIdSchema, { value: "ada" });
    const message = create(ChatMessageSchema, {
      id: create(MessageIdSchema, { value: "message-1" }),
      room: create(ChatRoomIdSchema, { value: "room-1" }),
      author: user,
      text: "hello",
      postedAt: create(TimestampSchema, { seconds: 1n }),
    });
    expect(unpackChatValue(packAny(ChatMessageSchema, message))?.$typeName).toBe(
      ChatMessageSchema.typeName,
    );
    expect(unpackChatValue(packUserId(user))).toEqual(user);
    expect(typeRegistry.findByFullName(UserIdSchema.typeName)?.schema).toBe(UserIdSchema);
  });

  it("creates one room-filtered Projection row and subscription update per message", async () => {
    const context = await createChatContext();
    const server = await Server.atPort(0, { host: "127.0.0.1" }).add(context).start();
    const client = Client.connectTo(server.baseUrl);
    const author = create(UserIdSchema, { value: "ada" });
    let subscription: Subscription | undefined;
    try {
      subscription = await client.asGuest().createSubscription(createRoomTopic("room-a"), {
        kind: "entity",
        authoritativeQuery: () => createRoomQuery("room-a"),
      });
      await subscription.activate();
      const updates = subscription.updates[Symbol.asyncIterator]();
      const update = updates.next();
      await expect(
        client.asGuest().post(PostMessageSchema, post("message-a", "room-a", author, "hello")),
      ).resolves.toEqual({ kind: "ok" });
      const rows = await readRows(() => client.asGuest().send(createRoomQuery("room-a")));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: { value: "message-a" },
        room: { value: "room-a" },
        text: "hello",
      });
      await expect(nextView(update)).resolves.toMatchObject({
        id: { value: "message-a" },
        room: { value: "room-a" },
      });
      const foreignRoomUpdate = updates.next();
      await expect(
        client.asGuest().post(PostMessageSchema, post("message-b", "room-b", author, "private")),
      ).resolves.toEqual({ kind: "ok" });
      await expectNoView(foreignRoomUpdate);
    } finally {
      await closeResources([
        () => subscription?.cancel(),
        () => client.close(),
        () => server.close(),
      ]);
    }
  }, 15_000);

  it("rejects a reused MessageId without overwriting its Projection", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const context = await createChatContext(storageFactory);
    const server = await Server.atPort(0, { host: "127.0.0.1" }).add(context).start();
    const client = Client.connectTo(server.baseUrl);
    const eventStore = new EventStore({ name: "Chat", multitenant: false }, storageFactory);
    const author = create(UserIdSchema, { value: "ada" });
    let subscription: Subscription | undefined;
    try {
      subscription = await client.asGuest().createSubscription(createRoomTopic("room-a"), {
        kind: "entity",
        authoritativeQuery: () => createRoomQuery("room-a"),
      });
      await subscription.activate();
      const updates = subscription.updates[Symbol.asyncIterator]();
      const firstUpdate = updates.next();
      await expect(
        client.asGuest().post(PostMessageSchema, post("duplicate", "room-a", author, "first")),
      ).resolves.toEqual({ kind: "ok" });
      await expect(
        context
          .stand()
          .readVersioned(ChatMessageSchema, create(MessageIdSchema, { value: "duplicate" })),
      ).resolves.toMatchObject({
        state: { room: { value: "room-a" }, text: "first" },
        version: { number: 1 },
      });
      await expect(nextView(firstUpdate)).resolves.toMatchObject({ id: { value: "duplicate" } });
      const rejectedUpdate = updates.next();
      await expect(
        client.asGuest().post(PostMessageSchema, post("duplicate", "room-b", author, "second")),
      ).resolves.toEqual({ kind: "ok" });
      const events = await waitForStoredEvents(eventStore, 2);
      const normalEvents = events.filter((event) => event.context?.rejection === undefined);
      expect(normalEvents).toHaveLength(1);
      const winner = unpackAny(normalEvents[0]?.message, MessagePostedSchema);
      expect(winner?.text).toBe("first");
      expect(
        events.filter(
          (event) => event.message?.typeUrl === deriveTypeUrl(MessageAlreadyPostedSchema),
        ),
      ).toHaveLength(1);
      await expectNoView(rejectedUpdate);
      await expect(
        context
          .stand()
          .readVersioned(ChatMessageSchema, create(MessageIdSchema, { value: "duplicate" })),
      ).resolves.toMatchObject({ state: { room: { value: "room-a" }, text: "first" } });
    } finally {
      await closeResources([
        () => {
          eventStore.close();
        },
        () => subscription?.cancel(),
        () => client.close(),
        () => server.close(),
      ]);
    }
  });

  it("atomically rejects one of two concurrent posts sharing a MessageId", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const context = await createChatContext(storageFactory);
    const server = await Server.atPort(0, { host: "127.0.0.1" }).add(context).start();
    const client = Client.connectTo(server.baseUrl);
    const eventStore = new EventStore({ name: "Chat", multitenant: false }, storageFactory);
    const author = create(UserIdSchema, { value: "ada" });
    let subscription: Subscription | undefined;
    try {
      subscription = await client.asGuest().createSubscription(createRoomTopic("room-a"), {
        kind: "entity",
        authoritativeQuery: () => createRoomQuery("room-a"),
      });
      await subscription.activate();
      const updates = subscription.updates[Symbol.asyncIterator]();
      const firstUpdate = updates.next();
      const results = await Promise.all([
        client.asGuest().post(PostMessageSchema, post("raced", "room-a", author, "first")),
        client.asGuest().post(PostMessageSchema, post("raced", "room-a", author, "second")),
      ]);
      expect(results).toEqual([{ kind: "ok" }, { kind: "ok" }]);
      const events = await waitForStoredEvents(eventStore, 2);
      const normalEvents = events.filter((event) => event.context?.rejection === undefined);
      expect(normalEvents).toHaveLength(1);
      const winner = unpackAny(normalEvents[0]?.message, MessagePostedSchema);
      expect(["first", "second"]).toContain(winner?.text);
      expect(
        events.filter(
          (event) => event.message?.typeUrl === deriveTypeUrl(MessageAlreadyPostedSchema),
        ),
      ).toHaveLength(1);
      await expect(nextView(firstUpdate)).resolves.toMatchObject({ id: { value: "raced" } });
      await expectNoView(updates.next());
      await expect(
        context
          .stand()
          .readVersioned(ChatMessageSchema, create(MessageIdSchema, { value: "raced" })),
      ).resolves.toMatchObject({
        state: { room: { value: "room-a" }, text: winner?.text },
        version: { number: 1 },
      });
    } finally {
      await closeResources([
        () => {
          eventStore.close();
        },
        () => subscription?.cancel(),
        () => client.close(),
        () => server.close(),
      ]);
    }
  });

  const invalidPosts: readonly (readonly [string, InvalidPost])[] = [
    ["blank message ID", { id: "  " }],
    ["long message ID", { id: "x".repeat(129) }],
    ["blank room", { room: "  " }],
    ["long room", { room: "x".repeat(129) }],
    ["blank author", { author: "  " }],
    ["long author", { author: "x".repeat(129) }],
    ["blank text", { text: "  " }],
    ["long text", { text: "x".repeat(4_097) }],
    ["early timestamp", { time: create(TimestampSchema, { seconds: -62_135_596_801n }) }],
    ["late timestamp", { time: create(TimestampSchema, { seconds: 253_402_300_800n }) }],
    ["negative nanos", { time: create(TimestampSchema, { seconds: 1n, nanos: -1 }) }],
    ["large nanos", { time: create(TimestampSchema, { seconds: 1n, nanos: 1_000_000_000 }) }],
  ];
  it.each(invalidPosts)("rejects %s before state/event publication", async (_label, invalid) => {
    const context = await createChatContext();
    const server = await Server.atPort(0, { host: "127.0.0.1" }).add(context).start();
    const client = Client.connectTo(server.baseUrl);
    const id = invalid.id ?? "valid-message";
    let subscription: Subscription | undefined;
    try {
      subscription = await client.asGuest().createSubscription(createRoomTopic("valid-room"), {
        kind: "entity",
        authoritativeQuery: () => createRoomQuery("valid-room"),
      });
      await subscription.activate();
      const rejectedUpdate = subscription.updates[Symbol.asyncIterator]().next();
      const result = await client
        .asGuest()
        .post(
          PostMessageSchema,
          post(
            id,
            invalid.room ?? "valid-room",
            create(UserIdSchema, { value: invalid.author ?? "ada" }),
            invalid.text ?? "hello",
            invalid.time ?? create(TimestampSchema, { seconds: 1n }),
          ),
        );
      expect(result).toMatchObject({ kind: "error" });
      await expectNoView(rejectedUpdate);
      if (invalid.id === undefined)
        await expect(
          context.stand().readVersioned(ChatMessageSchema, create(MessageIdSchema, { value: id })),
        ).resolves.toBeUndefined();
    } finally {
      await closeResources([
        () => subscription?.cancel(),
        () => client.close(),
        () => server.close(),
      ]);
    }
  });
});

function post(
  id: string,
  room: string,
  author: UserId,
  text: string,
  postedAt = create(TimestampSchema, { seconds: 1n }),
) {
  return create(PostMessageSchema, {
    id: create(MessageIdSchema, { value: id }),
    room: create(ChatRoomIdSchema, { value: room }),
    author,
    text,
    postedAt,
  });
}
function createRoomQuery(room: string): Query {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: `messages-${room}` }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(ChatMessageViewSchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, {
          filter: [
            create(CompositeFilterSchema, {
              operator: CompositeFilter_CompositeOperator.ALL,
              filter: [
                create(FilterSchema, {
                  fieldPath: { fieldName: ["room"] },
                  value: packAny(ChatRoomIdSchema, create(ChatRoomIdSchema, { value: room })),
                  operator: Filter_Operator.EQUAL,
                }),
              ],
            }),
          ],
        }),
      },
    }),
    context: create(ActorContextSchema),
  });
}
function createRoomTopic(room: string) {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: `topic-${room}` }),
    target: createRoomQuery(room).target,
    context: create(ActorContextSchema),
  });
}
async function readRows(
  read: () => Promise<{ readonly message: readonly { readonly state?: unknown }[] }>,
): Promise<readonly ChatMessageView[]> {
  for (let attempts = 0; attempts < 250; attempts += 1) {
    const response = await read();
    const rows = response.message.flatMap((entry) =>
      entry.state === undefined
        ? []
        : [unpackAny(entry.state as Parameters<typeof unpackAny>[0], ChatMessageViewSchema)].filter(
            (row): row is ChatMessageView => row !== undefined,
          ),
    );
    if (rows.length === 1) return rows;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Room projection was not visible.");
}
async function nextView(
  next: Promise<IteratorResult<SubscriptionDelivery>>,
): Promise<ChatMessageView> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      next,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("Timed out waiting for Projection update."));
        }, 2_000);
      }),
    ]);
    const update = result.done ? undefined : result.value;
    if (update?.kind !== "update" || update.update.update.case !== "entityUpdates")
      throw new Error("Expected Projection update.");
    const value = update.update.update.value.update[0]?.kind.value;
    const row = value === undefined ? undefined : unpackAny(value, ChatMessageViewSchema);
    if (row === undefined) throw new Error("Expected ChatMessageView.");
    return row;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
async function expectNoView(next: Promise<IteratorResult<SubscriptionDelivery>>): Promise<void> {
  const result = await Promise.race([
    next.then(() => "update"),
    new Promise<"quiet">((resolve) => {
      setTimeout(() => {
        resolve("quiet");
      }, 150);
    }),
  ]);
  expect(result).toBe("quiet");
}

async function waitForStoredEvents(
  eventStore: EventStore,
  count: number,
): Promise<Awaited<ReturnType<EventStore["read"]>>> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    const events = await eventStore.read();
    if (events.length >= count) return events;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return eventStore.read();
}

async function closeResources(operations: readonly (() => unknown)[]): Promise<void> {
  const failures: unknown[] = [];
  for (const operation of operations) {
    try {
      await operation();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Chat integration cleanup failed.");
  }
}

interface InvalidPost {
  readonly id?: string;
  readonly room?: string;
  readonly author?: string;
  readonly text?: string;
  readonly time?: Timestamp;
}
