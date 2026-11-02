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

import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { Client } from "@spine-event-engine/client-node";
import { AnyPacker, Time, TypeUrls } from "@spine-event-engine/core";
import { ActorContextSchema } from "@spine-event-engine/proto";
import {
  QueryIdSchema,
  QuerySchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { EnvironmentType, ServerEnvironment } from "@spine-event-engine/server";
import { ServerTests } from "@spine-event-engine/server/testing";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ReadBoardMessage,
  ReadBoardStats,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/board_queries_app_query.js";
import {
  AnnouncementBoardViewSchema,
  BoardIdSchema,
  BoardMessageSchema,
  BoardMessageViewSchema,
  BoardStatisticsViewSchema,
  MessageIdSchema,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { UserIdSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/user_pb.js";
import { PostMessageSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/commands_pb.js";
import { MessagePostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/events_pb.js";
import { ComposedBoardApplication } from "../src/index.js";
import { ReadBoardMessageHandler } from "../src/board-query-handler.js";

describe("multi-package Message Board", () => {
  beforeEach(async () => {
    ServerEnvironment.when(EnvironmentType.Local).use({
      storageFactory: new InMemoryStorageFactory(),
    });
    await ServerEnvironment.instance().completeSetup();
  });
  afterEach(async () => ServerTests.resetEnvironment());

  it("reports cumulative per-board posts and distinct authors from accepted Events", async () => {
    const application = await new ComposedBoardApplication().create();
    const running = await application.server.start();
    const client = Client.connectTo(running.baseUrl);
    try {
      for (const [id, board, author, username] of [
        ["first", "general", "user-1", "Old name"],
        ["second", "general", "user-1", "New name"],
        ["third", "general", "user-2", "Another author"],
        ["fourth", "announcements", "user-2", "Another author"],
      ] as const) {
        await expect(
          client.asGuest().post(
            PostMessageSchema,
            create(PostMessageSchema, {
              id: create(MessageIdSchema, { value: id }),
              board: create(BoardIdSchema, { value: board }),
              author: create(UserIdSchema, { value: author }),
              username,
              text: id,
              postedAt: create(TimestampSchema, { seconds: 1n }),
            }),
          ),
        ).resolves.toEqual({ kind: "ok" });
      }
      const query = create(ReadBoardStats.querySchema, {
        board: create(BoardIdSchema, { value: "general" }),
      });
      const actorContext = create(ActorContextSchema, {
        actor: { value: "reader-1" },
        timestamp: create(TimestampSchema, { seconds: 1n }),
      });
      await vi.waitFor(async () => {
        const result = await application.server.query(query, { actorContext });
        expect(result.board?.messageCount).toBe(3n);
        expect(result.board?.authorCount).toBe(2n);
        expect(result.announcements?.messageCount).toBe(1n);
        expect(result.announcements?.authorCount).toBe(1n);
        expect(result.board?.firstPostedAt?.seconds).toBeGreaterThan(1n);
      });
    } finally {
      await client.close();
      await running.close();
    }
  });

  it("retains the earliest accepted Event time when announcements arrive out of timestamp order", async () => {
    const application = await new ComposedBoardApplication().create();
    const running = await application.server.start();
    const client = Client.connectTo(running.baseUrl);
    let seconds = 30n;
    const previousTime = Time.setProvider({
      currentTime: () => create(TimestampSchema, { seconds }),
    });
    const query = create(ReadBoardStats.querySchema, {
      board: create(BoardIdSchema, { value: "announcements" }),
    });
    const actorContext = create(ActorContextSchema, {
      actor: { value: "reader" },
      timestamp: create(TimestampSchema, { seconds: 1n }),
    });
    try {
      for (const [index, [id, author, occurred]] of (
        [
          ["later", "writer-1", 30n],
          ["earlier", "writer-1", 10n],
          ["last", "writer-2", 20n],
        ] as const
      ).entries()) {
        seconds = occurred;
        await expect(
          client.asGuest().post(
            PostMessageSchema,
            create(PostMessageSchema, {
              id: create(MessageIdSchema, { value: id }),
              board: create(BoardIdSchema, { value: "announcements" }),
              author: create(UserIdSchema, { value: author }),
              username: author,
              text: id,
              postedAt: create(TimestampSchema, { seconds: 1n }),
            }),
          ),
        ).resolves.toEqual({ kind: "ok" });
        await vi.waitFor(async () => {
          const response = await application.server.query(query, { actorContext });
          expect(response.board?.messageCount).toBe(BigInt(index + 1));
          expect(response.announcements?.messageCount).toBe(BigInt(index + 1));
        });
      }
      await vi.waitFor(async () => {
        const response = await application.server.query(query, { actorContext });
        expect(response.board?.messageCount).toBe(3n);
        expect(response.board?.authorCount).toBe(2n);
        expect(response.board?.firstPostedAt?.seconds).toBe(10n);
        expect(response.announcements?.messageCount).toBe(3n);
        expect(response.announcements?.authorCount).toBe(2n);
        expect(response.announcements?.firstPostedAt?.seconds).toBe(10n);
      });
      await expect(
        application.announcements
          .stand()
          .read(AnnouncementBoardViewSchema, create(BoardIdSchema, { value: "announcements" })),
      ).resolves.toMatchObject({ text: "last" });
    } finally {
      Time.setProvider(previousTime);
      try {
        await client.close();
      } finally {
        await running.close();
      }
    }
  });

  it("hides restricted totals without a verified grant and strips contributor directories", async () => {
    const application = await new ComposedBoardApplication().create();
    const running = await application.server.start();
    const client = Client.connectTo(running.baseUrl);
    try {
      await client.asGuest().post(
        PostMessageSchema,
        create(PostMessageSchema, {
          id: create(MessageIdSchema, { value: "restricted-stat" }),
          board: create(BoardIdSchema, { value: "restricted" }),
          author: create(UserIdSchema, { value: "private-writer" }),
          username: "Private writer",
          text: "Hidden",
          postedAt: create(TimestampSchema, { seconds: 1n }),
        }),
      );
      const query = create(ReadBoardStats.querySchema, {
        board: create(BoardIdSchema, { value: "restricted" }),
      });
      const actorContext = create(ActorContextSchema, {
        actor: { value: "private-writer" },
        timestamp: create(TimestampSchema, { seconds: 1n }),
      });
      await vi.waitFor(async () => {
        const trusted = await application.server.query(query, {
          actorContext,
          principal: { id: "verified-reader" },
          authorityFacts: { canReadRestricted: true },
        });
        expect(trusted.board?.messageCount).toBe(1n);
        expect(trusted.board?.authorCount).toBe(1n);
      });
      await expect(
        application.server.query(query, {
          actorContext,
          authorityFacts: { canReadRestricted: true },
        }),
      ).rejects.toThrow("Public reader cannot carry authenticated authority facts");
      expect(
        (
          await application.server.query(query, {
            actorContext,
            principal: { id: "verified-reader" },
          })
        ).board,
      ).toBeUndefined();
      const response = await client.asGuest().query(query);
      expect(response.message[0]?.board).toBeUndefined();
      const rows = await client.asGuest().send(
        create(QuerySchema, {
          id: create(QueryIdSchema, { value: "statistics-directory" }),
          target: create(TargetSchema, {
            type: TypeUrls.derive(BoardStatisticsViewSchema),
            criterion: { case: "includeAll", value: true },
          }),
        }),
      );
      expect(rows.message).toHaveLength(0);
    } finally {
      await client.close();
      await running.close();
    }
  });

  it("assembles handlers from separate packages and applies BC then Server policy to typed App Queries", async () => {
    const application = await new ComposedBoardApplication().create();
    const running = await application.server.start();
    const client = Client.connectTo(running.baseUrl);
    try {
      const id = create(MessageIdSchema, { value: "message-1" });
      await application.messages.stand().update(
        BoardMessageViewSchema,
        create(BoardMessageViewSchema, {
          id,
          board: create(BoardIdSchema, { value: "general" }),
          author: create(UserIdSchema, { value: "author-1" }),
          username: "A writer",
          text: "Hello",
          postedAt: create(TimestampSchema, { seconds: 1n }),
        }),
      );
      await application.messages.stand().update(
        BoardMessageSchema,
        create(BoardMessageSchema, {
          id,
          board: create(BoardIdSchema, { value: "general" }),
          author: create(UserIdSchema, { value: "author-1" }),
          username: "A writer",
          text: "Hello",
          postedAt: create(TimestampSchema, { seconds: 1n }),
        }),
      );
      const query = create(ReadBoardMessage.querySchema, { message: id });
      const internal: ReadBoardMessage.Response = await application.server.query(query, {
        actorContext: create(ActorContextSchema, {
          actor: { value: "reader-1" },
          timestamp: create(TimestampSchema, { seconds: 1n }),
        }),
      });
      expect(internal.message?.text).toBe("Hello");
      expect(internal.message?.username).toBe("A writer");

      const external = await client.asGuest().query(query);
      expect(external.message[0]?.message?.text).toBe("Hello");
      expect(external.message[0]?.message?.username).toBe("Anonymous");
      const aggregate = await client.asGuest().send(
        create(QuerySchema, {
          id: create(QueryIdSchema, { value: "public-aggregate" }),
          target: create(TargetSchema, {
            type: TypeUrls.derive(BoardMessageSchema),
            criterion: { case: "includeAll", value: true },
          }),
        }),
      );
      expect(aggregate.message).toHaveLength(1);
      const state = aggregate.message[0]?.state;
      expect(state).toBeDefined();
      if (state === undefined) throw new Error("Expected aggregate state.");
      expect(AnyPacker.unpack(state, BoardMessageSchema).username).toBe("Anonymous");
    } finally {
      await client.close();
      await running.close();
    }
  });

  it("delivers real Entity and Event RPC subscriptions from handlers in dependency packages", async () => {
    const application = await new ComposedBoardApplication().create();
    const running = await application.server.start();
    const client = Client.connectTo(running.baseUrl);
    const target = create(TargetSchema, {
      type: TypeUrls.derive(BoardMessageViewSchema),
      criterion: { case: "includeAll", value: true },
    });
    const entity = await client.asGuest().createSubscription(
      create(TopicSchema, {
        id: create(TopicIdSchema, { value: "board-messages" }),
        target,
      }),
      {
        kind: "entity",
        authoritativeQuery: () =>
          create(QuerySchema, {
            id: create(QueryIdSchema, { value: "board-messages-query" }),
            target,
          }),
      },
    );
    const events = await client
      .asGuest()
      .createSubscription([MessagePostedSchema], { kind: "event" });
    try {
      await entity.activate();
      await events.activate();
      const entityUpdate = entity.updates[Symbol.asyncIterator]().next();
      const eventUpdate = events.updates[Symbol.asyncIterator]().next();
      await expect(
        client.asGuest().post(
          PostMessageSchema,
          create(PostMessageSchema, {
            id: create(MessageIdSchema, { value: "subscription-message" }),
            board: create(BoardIdSchema, { value: "announcements" }),
            author: create(UserIdSchema, { value: "author-1" }),
            username: "A writer",
            text: "A real event",
            postedAt: create(TimestampSchema, { seconds: 1n }),
          }),
        ),
      ).resolves.toEqual({ kind: "ok" });
      const entityDelivery = await entityUpdate;
      if (
        entityDelivery.done ||
        entityDelivery.value.kind !== "update" ||
        entityDelivery.value.update.update.case !== "entityUpdates"
      )
        throw new Error("Expected a domain Entity update.");
      const state = entityDelivery.value.update.update.value.update[0]?.kind;
      if (state?.case !== "state") throw new Error("Expected the Projection state.");
      expect(AnyPacker.unpack(state.value, BoardMessageViewSchema)).toMatchObject({
        text: "A real event",
        username: "Anonymous",
      });
      const eventDelivery = await eventUpdate;
      if (
        eventDelivery.done ||
        eventDelivery.value.kind !== "update" ||
        eventDelivery.value.update.update.case !== "eventUpdates"
      )
        throw new Error("Expected a domain Event update.");
      const payload = eventDelivery.value.update.update.value.event[0]?.message;
      if (payload === undefined) throw new Error("Expected a posted-message payload.");
      expect(AnyPacker.unpack(payload, MessagePostedSchema)).toMatchObject({
        text: "A real event",
        username: "Anonymous",
      });
      await vi.waitFor(async () => {
        expect(
          await application.announcements
            .stand()
            .read(AnnouncementBoardViewSchema, create(BoardIdSchema, { value: "announcements" })),
        ).toMatchObject({ text: "A real event", message: { value: "subscription-message" } });
      });
    } finally {
      await entity.cancel();
      await events.cancel();
      await client.close();
      await running.close();
    }
  });

  it("removes restricted messages for public reads and admits verified authority facts", async () => {
    const application = await new ComposedBoardApplication().create();
    const running = await application.server.start();
    const client = Client.connectTo(running.baseUrl);
    try {
      const id = create(MessageIdSchema, { value: "restricted-message" });
      await application.messages.stand().update(
        BoardMessageViewSchema,
        create(BoardMessageViewSchema, {
          id,
          board: create(BoardIdSchema, { value: "restricted" }),
          author: create(UserIdSchema, { value: "author-1" }),
          username: "A writer",
          text: "Restricted details",
          postedAt: create(TimestampSchema, { seconds: 1n }),
        }),
      );
      await application.messages.stand().update(
        BoardMessageSchema,
        create(BoardMessageSchema, {
          id,
          board: create(BoardIdSchema, { value: "restricted" }),
          author: create(UserIdSchema, { value: "author-1" }),
          username: "A writer",
          text: "Restricted details",
          postedAt: create(TimestampSchema, { seconds: 1n }),
        }),
      );
      const query = create(ReadBoardMessage.querySchema, { message: id });
      const actorContext = create(ActorContextSchema, {
        actor: { value: "reader-1" },
        timestamp: create(TimestampSchema, { seconds: 1n }),
      });
      expect((await application.server.query(query, { actorContext })).message).toBeUndefined();
      const trusted = await application.server.query(query, {
        actorContext,
        principal: { id: "reader-1" },
        authorityFacts: { canReadRestricted: true },
      });
      expect(trusted.message?.text).toBe("Restricted details");
      expect(trusted.message?.username).toBe("A writer");
      const publicResult = await client.asGuest().query(query);
      expect(publicResult.message).toHaveLength(1);
      expect(publicResult.message[0]?.message).toBeUndefined();
      const entityResult = await client.asGuest().send(
        create(QuerySchema, {
          id: create(QueryIdSchema, { value: "restricted-rows" }),
          target: create(TargetSchema, {
            type: TypeUrls.derive(BoardMessageViewSchema),
            criterion: { case: "includeAll", value: true },
          }),
        }),
      );
      expect(entityResult.message).toHaveLength(0);
      const aggregateResult = await client.asGuest().send(
        create(QuerySchema, {
          id: create(QueryIdSchema, { value: "restricted-aggregate" }),
          target: create(TargetSchema, {
            type: TypeUrls.derive(BoardMessageSchema),
            criterion: { case: "includeAll", value: true },
          }),
        }),
      );
      expect(aggregateResult.message).toHaveLength(0);
    } finally {
      await client.close();
      await running.close();
    }
  });

  it("rejects a missing required query field before invoking the application handler", async () => {
    const application = await new ComposedBoardApplication().create();
    const running = await application.server.start();
    const client = Client.connectTo(running.baseUrl);
    const execute = vi.spyOn(ReadBoardMessageHandler.prototype, "execute");
    try {
      const result = await client
        .asGuest()
        .query(create(ReadBoardMessage.querySchema))
        .catch((error: unknown) => error);
      expect(result).toBeInstanceOf(ConnectError);
      expect((result as ConnectError).code).toBe(Code.InvalidArgument);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      execute.mockRestore();
      await client.close();
      await running.close();
    }
  });

  it("suppresses restricted Event payloads while preserving the next public Event", async () => {
    const application = await new ComposedBoardApplication().create();
    const running = await application.server.start();
    const client = Client.connectTo(running.baseUrl);
    const events = await client
      .asGuest()
      .createSubscription([MessagePostedSchema], { kind: "event" });
    try {
      await events.activate();
      const next = events.updates[Symbol.asyncIterator]().next();
      for (const [id, board] of [
        ["hidden-event", "restricted"],
        ["visible-event", "general"],
      ] as const) {
        await expect(
          client.asGuest().post(
            PostMessageSchema,
            create(PostMessageSchema, {
              id: create(MessageIdSchema, { value: id }),
              board: create(BoardIdSchema, { value: board }),
              author: create(UserIdSchema, { value: "author-1" }),
              username: "A writer",
              text: id,
              postedAt: create(TimestampSchema, { seconds: 1n }),
            }),
          ),
        ).resolves.toEqual({ kind: "ok" });
      }
      const delivery = await next;
      if (
        delivery.done ||
        delivery.value.kind !== "update" ||
        delivery.value.update.update.case !== "eventUpdates"
      )
        throw new Error("Expected a public Event update.");
      const payload = delivery.value.update.update.value.event[0]?.message;
      if (payload === undefined) throw new Error("Expected the public Event payload.");
      expect(AnyPacker.unpack(payload, MessagePostedSchema).id?.value).toBe("visible-event");
    } finally {
      await events.cancel();
      await client.close();
      await running.close();
    }
  });

  it("uses a fixture native authentication port for restricted Event and App Query reads", async () => {
    const authenticate = vi.fn(() => ({
      principal: { id: "fixture-reader" },
      authorityFacts: { canReadRestricted: true },
    }));
    const application = await new ComposedBoardApplication({ direct: { authenticate } }).create();
    const running = await application.server.start();
    const client = Client.connectTo(running.baseUrl);
    const events = await client
      .asGuest()
      .createSubscription([MessagePostedSchema], { kind: "event" });
    try {
      await events.activate();
      const next = events.updates[Symbol.asyncIterator]().next();
      const id = create(MessageIdSchema, { value: "authenticated-event" });
      await expect(
        client.asGuest().post(
          PostMessageSchema,
          create(PostMessageSchema, {
            id,
            board: create(BoardIdSchema, { value: "restricted" }),
            author: create(UserIdSchema, { value: "author-1" }),
            username: "A writer",
            text: "For verified readers",
            postedAt: create(TimestampSchema, { seconds: 1n }),
          }),
        ),
      ).resolves.toEqual({ kind: "ok" });
      const delivery = await next;
      if (
        delivery.done ||
        delivery.value.kind !== "update" ||
        delivery.value.update.update.case !== "eventUpdates"
      )
        throw new Error("Expected a verified reader's Event update.");
      const payload = delivery.value.update.update.value.event[0]?.message;
      if (payload === undefined) throw new Error("Expected the restricted Event payload.");
      expect(AnyPacker.unpack(payload, MessagePostedSchema).username).toBe("A writer");
      await vi.waitFor(async () => {
        const result = await client
          .asGuest()
          .query(create(ReadBoardMessage.querySchema, { message: id }));
        expect(result.message[0]?.message?.text).toBe("For verified readers");
      });
      expect(authenticate).toHaveBeenCalledWith(expect.objectContaining({ method: "Execute" }));
    } finally {
      await events.cancel();
      await client.close();
      await running.close();
    }
  });
});
