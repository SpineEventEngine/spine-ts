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
import { AnyPacker, TypeUrls } from "@spine-event-engine/core";
import { ActorContextSchema } from "@spine-event-engine/proto";
import {
  QueryIdSchema,
  QuerySchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { ServerTests } from "@spine-event-engine/server/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReadBoardMessage } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/board_queries_app_query.js";
import {
  AnnouncementBoardViewSchema,
  BoardIdSchema,
  BoardMessageViewSchema,
  MessageIdSchema,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { UserIdSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/user_pb.js";
import { PostMessageSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/commands_pb.js";
import { MessagePostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/events_pb.js";
import { ComposedBoardApplication } from "../src/index.js";
import { ReadBoardMessageHandler } from "../src/board-query-handler.js";

describe("multi-package Message Board", () => {
  afterEach(async () => ServerTests.resetEnvironment());

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
          board: create(BoardIdSchema, { value: "board-1" }),
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
      expect(internal.message?.text).toBe("BC: Hello");
      expect(internal.message?.username).toBe("Public reader");

      const external = await client.asGuest().query(query);
      expect(external.message[0]?.message?.text).toBe("Server: Result: BC: Hello");
      expect(external.message[0]?.message?.username).toBe("Public reader");
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
        text: "Server: BC: A real event",
        username: "Public reader",
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
        username: "Public writer",
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
      expect(trusted.message?.text).toBe("BC: Restricted details");
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
        expect(result.message[0]?.message?.text).toBe("Server: Result: BC: For verified readers");
      });
      expect(authenticate).toHaveBeenCalledWith(expect.objectContaining({ method: "Execute" }));
    } finally {
      await events.cancel();
      await client.close();
      await running.close();
    }
  });
});
