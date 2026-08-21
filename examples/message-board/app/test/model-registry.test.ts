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

import { create, type MessageShape } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  Client,
  type Subscription,
  type SubscriptionDelivery,
} from "@spine-event-engine/client-node";
import { TypeUrls, AnyMessages } from "@spine-event-engine/core";
import {
  BoardMessageSchema,
  BoardMessageViewSchema,
  AnnouncementBoardViewSchema,
  BoardIdSchema,
  MessageIdSchema,
  type BoardId,
  type BoardMessageView,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { PostMessageSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/commands_pb.js";
import { MessagePostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/events_pb.js";
import { MessageAlreadyPostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/rejections_pb.js";
import {
  UserIdSchema,
  type UserId,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/user_pb.js";
import { ActorContextSchema, ErrorSchema, ValidationErrorSchema } from "@spine-event-engine/proto";
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
import { BoundedContext, Server } from "@spine-event-engine/server";
import { EventStore, InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it, vi } from "vitest";

const browserHost = vi.hoisted(() => ({ open: vi.fn(), run: vi.fn() }));

vi.mock("@spine-event-engine/server/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spine-event-engine/server/browser")>();
  browserHost.open.mockImplementation(actual.BrowserServer.open);
  browserHost.run.mockImplementation(actual.BrowserServer.run);
  return { ...actual, BrowserServer: { open: browserHost.open, run: browserHost.run } };
});

import { MessageBoardApplication, BoardMessageAggregate, typeRegistry } from "../dist/src/index.js";

describe("MessageBoard Projection backend", () => {
  const application = new MessageBoardApplication();

  it("decodes every MessageBoard model value from the single model package", () => {
    const user = create(UserIdSchema, { value: "ada" });
    const message = create(BoardMessageSchema, {
      id: create(MessageIdSchema, { value: "message-1" }),
      board: create(BoardIdSchema, { value: "board-1" }),
      author: user,
      username: "Ada",
      text: "hello",
      postedAt: create(TimestampSchema, { seconds: 1n }),
    });
    expect(
      AnyMessages.unpackUsing(typeRegistry, AnyMessages.pack(BoardMessageSchema, message))
        ?.$typeName,
    ).toBe(BoardMessageSchema.typeName);
    expect(AnyMessages.unpackUsing(typeRegistry, AnyMessages.pack(UserIdSchema, user))).toEqual(
      user,
    );
    expect(typeRegistry.findByFullName(UserIdSchema.typeName)?.schema).toBe(UserIdSchema);
  });

  it("starts an in-memory server on loopback by default", async () => {
    const server = await application.start();
    try {
      expect(new URL(server.baseUrl).hostname).toBe("127.0.0.1");
    } finally {
      await server.close();
    }
  });

  it("assembles every supported application server mode", async () => {
    const start = vi.fn().mockResolvedValue({ host: "127.0.0.1", baseUrl: "http://started", close: async () => undefined });
    const run = vi.fn().mockResolvedValue({ baseUrl: "http://running" });
    const add = vi.fn(function (this: unknown) {
      return this;
    });
    const atPort = vi.spyOn(Server, "atPort").mockReturnValue({ add, run, start } as never);
    const storage = new InMemoryStorageFactory();
    try {
      browserHost.open.mockResolvedValueOnce({ baseUrl: "http://started" });
      browserHost.run.mockImplementationOnce(async (native: { run(): Promise<unknown> }) =>
        await native.run(),
      );
      browserHost.run.mockImplementationOnce(async (native: { run(): Promise<unknown> }) =>
        await native.run(),
      );
      await expect(application.start({ host: "127.0.0.2", port: 1 })).resolves.toEqual({
        baseUrl: "http://started",
      });
      await expect(application.run()).resolves.toEqual({ baseUrl: "http://running" });
      await expect(application.runApplication({ port: 2 }, storage)).resolves.toEqual({
        baseUrl: "http://running",
      });
      await expect(
        application.runCombined({ port: 3, webOrigin: "https://board.example.com" }, storage),
      ).resolves.toEqual({ baseUrl: "http://running" });

      expect(atPort).toHaveBeenCalledTimes(4);
      expect(start).toHaveBeenCalledOnce();
      expect(run).toHaveBeenCalledTimes(3);
      expect(add).toHaveBeenCalledTimes(4);
    } finally {
      atPort.mockRestore();
      storage.close();
    }
  });

  it("persists a message-valued aggregate ID as the event producer ID", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const context = await application.createContext(storageFactory);
    const server = await Server.atPort(0, { host: "127.0.0.1" }).add(context).start();
    const client = Client.connectTo(server.baseUrl);
    const eventStore = new EventStore({ name: "MessageBoard", multitenant: false }, storageFactory);
    try {
      await expect(
        client
          .asGuest()
          .post(
            PostMessageSchema,
            post("producer-id", "board-a", create(UserIdSchema, { value: "ada" }), "hello"),
          ),
      ).resolves.toEqual({ kind: "ok" });
      const event = (await waitForStoredEvents(eventStore, 1))[0];
      const producerId = event?.context?.producerId;
      if (producerId === undefined) throw new Error("Expected stored event producer ID.");
      expect(AnyMessages.unpack(producerId, MessageIdSchema)).toEqual(
        create(MessageIdSchema, { value: "producer-id" }),
      );
    } finally {
      await closeResources([
        () => {
          eventStore.close();
        },
        () => client.close(),
        () => server.close(),
      ]);
    }
  });

  it("creates one board-filtered Projection row and subscription update per message", async () => {
    const context = await application.createContext();
    const server = await Server.atPort(0, { host: "127.0.0.1" }).add(context).start();
    const client = Client.connectTo(server.baseUrl);
    const author = create(UserIdSchema, { value: "ada" });
    let subscription: Subscription | undefined;
    try {
      subscription = await client.asGuest().createSubscription(createBoardTopic("board-a"), {
        kind: "entity",
        authoritativeQuery: () => createBoardQuery("board-a"),
      });
      await subscription.activate();
      const updates = subscription.updates[Symbol.asyncIterator]();
      const update = updates.next();
      await expect(
        client.asGuest().post(PostMessageSchema, post("message-a", "board-a", author, "hello")),
      ).resolves.toEqual({ kind: "ok" });
      const rows = await readRows(() => client.asGuest().send(createBoardQuery("board-a")));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: { value: "message-a" },
        board: { value: "board-a" },
        text: "hello",
      });
      await expect(nextView(update)).resolves.toMatchObject({
        id: { value: "message-a" },
        board: { value: "board-a" },
      });
      const foreignRoomUpdate = updates.next();
      await expect(
        client.asGuest().post(PostMessageSchema, post("message-b", "board-b", author, "private")),
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

  it("routes only matching announcements to the board-wide Projection", async () => {
    const context = await application.createContext();
    const server = await Server.atPort(0, { host: "127.0.0.1" }).add(context).start();
    const client = Client.connectTo(server.baseUrl);
    const author = create(UserIdSchema, { value: "ada" });
    try {
      await expect(
        client.asGuest().post(PostMessageSchema, post("general-1", "general", author, "hello")),
      ).resolves.toEqual({ kind: "ok" });
      await expect(
        client
          .asGuest()
          .post(
            PostMessageSchema,
            post("announcement-1", "announcements", author, "System maintenance"),
          ),
      ).resolves.toEqual({ kind: "ok" });

      await expect(
        waitForAnnouncement(context, create(BoardIdSchema, { value: "announcements" })),
      ).resolves.toMatchObject({
        state: {
          id: { value: "announcements" },
          message: { value: "announcement-1" },
          text: "System maintenance",
        },
      });
      await expect(
        context
          .stand()
          .readVersioned(AnnouncementBoardViewSchema, create(BoardIdSchema, { value: "general" })),
      ).resolves.toBeUndefined();
    } finally {
      await closeResources([() => client.close(), () => server.close()]);
    }
  });

  it("rejects a reused MessageId without overwriting its Projection", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const context = await application.createContext(storageFactory);
    const server = await Server.atPort(0, { host: "127.0.0.1" }).add(context).start();
    const client = Client.connectTo(server.baseUrl);
    const eventStore = new EventStore({ name: "MessageBoard", multitenant: false }, storageFactory);
    const author = create(UserIdSchema, { value: "ada" });
    let subscription: Subscription | undefined;
    try {
      subscription = await client.asGuest().createSubscription(createBoardTopic("board-a"), {
        kind: "entity",
        authoritativeQuery: () => createBoardQuery("board-a"),
      });
      await subscription.activate();
      const updates = subscription.updates[Symbol.asyncIterator]();
      const firstUpdate = updates.next();
      await expect(
        client.asGuest().post(PostMessageSchema, post("duplicate", "board-a", author, "first")),
      ).resolves.toEqual({ kind: "ok" });
      await expect(
        context
          .stand()
          .readVersioned(BoardMessageSchema, create(MessageIdSchema, { value: "duplicate" })),
      ).resolves.toMatchObject({
        state: { board: { value: "board-a" }, text: "first" },
        version: { number: 1 },
      });
      await expect(nextView(firstUpdate)).resolves.toMatchObject({ id: { value: "duplicate" } });
      const rejectedUpdate = updates.next();
      await expect(
        client.asGuest().post(PostMessageSchema, post("duplicate", "board-b", author, "second")),
      ).resolves.toEqual({ kind: "ok" });
      const events = await waitForStoredEvents(eventStore, 2);
      const normalEvents = events.filter((event) => event.context?.rejection === undefined);
      expect(normalEvents).toHaveLength(1);
      const message = normalEvents[0]?.message;
      if (message === undefined) throw new Error("Expected stored message.");
      const winner = AnyMessages.unpack(message, MessagePostedSchema);
      expect(winner?.text).toBe("first");
      const producerId = normalEvents[0]?.context?.producerId;
      if (producerId === undefined) throw new Error("Expected stored event producer ID.");
      expect(AnyMessages.unpack(producerId, MessageIdSchema)).toEqual(
        create(MessageIdSchema, { value: "duplicate" }),
      );
      expect(
        events.filter(
          (event) => event.message?.typeUrl === TypeUrls.derive(MessageAlreadyPostedSchema),
        ),
      ).toHaveLength(1);
      await expectNoView(rejectedUpdate);
      await expect(
        context
          .stand()
          .readVersioned(BoardMessageSchema, create(MessageIdSchema, { value: "duplicate" })),
      ).resolves.toMatchObject({ state: { board: { value: "board-a" }, text: "first" } });
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
    const context = await application.createContext(storageFactory);
    const server = await Server.atPort(0, { host: "127.0.0.1" }).add(context).start();
    const client = Client.connectTo(server.baseUrl);
    const eventStore = new EventStore({ name: "MessageBoard", multitenant: false }, storageFactory);
    const author = create(UserIdSchema, { value: "ada" });
    let subscription: Subscription | undefined;
    try {
      subscription = await client.asGuest().createSubscription(createBoardTopic("board-a"), {
        kind: "entity",
        authoritativeQuery: () => createBoardQuery("board-a"),
      });
      await subscription.activate();
      const updates = subscription.updates[Symbol.asyncIterator]();
      const firstUpdate = updates.next();
      const results = await Promise.all([
        client.asGuest().post(PostMessageSchema, post("raced", "board-a", author, "first")),
        client.asGuest().post(PostMessageSchema, post("raced", "board-a", author, "second")),
      ]);
      expect(results).toEqual([{ kind: "ok" }, { kind: "ok" }]);
      const events = await waitForStoredEvents(eventStore, 2);
      const normalEvents = events.filter((event) => event.context?.rejection === undefined);
      expect(normalEvents).toHaveLength(1);
      const message = normalEvents[0]?.message;
      if (message === undefined) throw new Error("Expected stored message.");
      const winner = AnyMessages.unpack(message, MessagePostedSchema);
      expect(["first", "second"]).toContain(winner?.text);
      expect(
        events.filter(
          (event) => event.message?.typeUrl === TypeUrls.derive(MessageAlreadyPostedSchema),
        ),
      ).toHaveLength(1);
      await expect(nextView(firstUpdate)).resolves.toMatchObject({ id: { value: "raced" } });
      await expectNoView(updates.next());
      await expect(
        context
          .stand()
          .readVersioned(BoardMessageSchema, create(MessageIdSchema, { value: "raced" })),
      ).resolves.toMatchObject({
        state: { board: { value: "board-a" }, text: winner?.text },
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

  it("rejects a missing required MessageId before invoking the MessageBoard handler", async () => {
    const handler = vi.spyOn(BoardMessageAggregate.prototype, "postMessage");
    let subscription: Subscription | undefined;
    let client: ReturnType<typeof Client.connectTo> | undefined;
    let server: Awaited<ReturnType<Server["start"]>> | undefined;
    try {
      const context = await application.createContext();
      server = await Server.atPort(0, { host: "127.0.0.1" }).add(context).start();
      client = Client.connectTo(server.baseUrl);
      subscription = await client.asGuest().createSubscription(createBoardTopic("valid-board"), {
        kind: "entity",
        authoritativeQuery: () => createBoardQuery("valid-board"),
      });
      await subscription.activate();
      const rejectedUpdate = subscription.updates[Symbol.asyncIterator]().next();
      const outcome = await client.asGuest().post(
        PostMessageSchema,
        create(PostMessageSchema, {
          board: create(BoardIdSchema, { value: "valid-board" }),
          author: create(UserIdSchema, { value: "ada" }),
          username: "Ada",
          text: "hello",
          postedAt: create(TimestampSchema, { seconds: 1n }),
        }),
      );
      expect(outcome).toMatchObject({
        kind: "error",
        error: { type: "COMMAND_VALIDATION_ERROR" },
      });
      if (outcome.kind !== "error") throw new Error("Expected a validation error.");
      if (outcome.error.$typeName !== ErrorSchema.typeName)
        throw new Error("Expected a Spine error.");
      const validationError = outcome.error as MessageShape<typeof ErrorSchema>;
      if (validationError.details === undefined)
        throw new Error("Expected validation error details.");
      expect(
        AnyMessages.unpack(
          validationError.details,
          ValidationErrorSchema,
        )?.constraintViolation.some((violation) => violation.fieldPath?.fieldName[0] === "id"),
      ).toBe(true);
      expect(handler).not.toHaveBeenCalled();
      await expectNoView(rejectedUpdate);
      await expect(
        context
          .stand()
          .readVersioned(BoardMessageSchema, create(MessageIdSchema, { value: "valid-message" })),
      ).resolves.toBeUndefined();
    } finally {
      handler.mockRestore();
      await closeResources([
        () => subscription?.cancel(),
        () => client?.close(),
        () => server?.close(),
      ]);
    }
  });
});

function post(
  id: string,
  board: string,
  author: UserId,
  text: string,
  postedAt = create(TimestampSchema, { seconds: 1n }),
) {
  return create(PostMessageSchema, {
    id: create(MessageIdSchema, { value: id }),
    board: create(BoardIdSchema, { value: board }),
    author,
    username: "Ada",
    text,
    postedAt,
  });
}
function createBoardQuery(board: string): Query {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: `messages-${board}` }),
    target: create(TargetSchema, {
      type: TypeUrls.derive(BoardMessageViewSchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, {
          filter: [
            create(CompositeFilterSchema, {
              operator: CompositeFilter_CompositeOperator.ALL,
              filter: [
                create(FilterSchema, {
                  fieldPath: { fieldName: ["board"] },
                  value: AnyMessages.pack(BoardIdSchema, create(BoardIdSchema, { value: board })),
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
function createBoardTopic(board: string) {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: `topic-${board}` }),
    target: createBoardQuery(board).target,
    context: create(ActorContextSchema),
  });
}
async function readRows(
  read: () => Promise<{ readonly message: readonly { readonly state?: unknown }[] }>,
): Promise<readonly BoardMessageView[]> {
  for (let attempts = 0; attempts < 250; attempts += 1) {
    const response = await read();
    const rows = response.message.flatMap((entry) =>
      entry.state === undefined
        ? []
        : [
            AnyMessages.unpack(
              entry.state as Parameters<typeof AnyMessages.unpack>[0],
              BoardMessageViewSchema,
            ),
          ].filter((row): row is BoardMessageView => row !== undefined),
    );
    if (rows.length === 1) return rows;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Board projection was not visible.");
}
async function nextView(
  next: Promise<IteratorResult<SubscriptionDelivery>>,
): Promise<BoardMessageView> {
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
    const kind = update.update.update.value.update[0]?.kind;
    const value = kind?.case === "state" ? kind.value : undefined;
    const row = value === undefined ? undefined : AnyMessages.unpack(value, BoardMessageViewSchema);
    if (row === undefined) throw new Error("Expected BoardMessageView.");
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

async function waitForAnnouncement(context: BoundedContext, id: BoardId) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const record = await context.stand().readVersioned(AnnouncementBoardViewSchema, id);
    if (record !== undefined) return record;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return context.stand().readVersioned(AnnouncementBoardViewSchema, id);
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
    throw new AggregateError(failures, "MessageBoard integration cleanup failed.");
  }
}
