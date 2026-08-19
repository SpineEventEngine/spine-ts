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

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  createNativeGatewayServices,
  InMemorySubscriptionBindings,
  SubscriptionGateway,
  UnaryGateway,
  type AuthenticatedPrincipal,
  type Clock,
  type IncomingRequest,
} from "@spine-event-engine/auth";
import type { HandlerContext } from "@connectrpc/connect";
import {
  BoardMessageViewSchema,
  BoardIdSchema,
  MessageIdSchema,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { PostMessageSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/commands_pb.js";
import { UserIdSchema as BoardUserIdSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/user_pb.js";
import { AnyMessages } from "@spine-event-engine/core";
import {
  AckSchema,
  ActorContextSchema,
  CommandContextSchema,
  CommandSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@spine-event-engine/proto";
import {
  CompositeFilter_CompositeOperator,
  CompositeFilterSchema,
  Filter_Operator,
  FilterSchema,
  QueryService,
  QuerySchema,
  SubscriptionSchema,
  TargetFiltersSchema,
  TargetSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { TypeUrls } from "@spine-event-engine/core";
import { describe, expect, it } from "vitest";

import { BoardAccessPolicy, BoardContextResolver } from "../src/board-access.js";
import { typeRegistry } from "../src/model-registry.js";

const principal: AuthenticatedPrincipal = {
  id: "ada",
  attributes: { boards: "board-a" },
};

describe("MessageBoard gateway policy", () => {
  it("composes native services with the MessageBoard registry, policy, and trusted context", async () => {
    const policy = new BoardAccessPolicy();
    const contexts = new BoardContextResolver();
    const trustedPrincipal = { id: "ada", attributes: { boards: "board-a", tenant: "tenant-a" } };
    const clock: Clock = { now: () => create(TimestampSchema, { seconds: 42n }) };
    const forwarded: {
      readonly service: string;
      readonly method: string;
      readonly value: Uint8Array;
    }[] = [];
    const unary = new UnaryGateway({
      registry: typeRegistry,
      maxRequestBytes: 10_000,
      sessions: {
        resolve: () =>
          Promise.resolve({
            principal: trustedPrincipal,
            expiresAt: create(TimestampSchema, { seconds: 99n }),
          }),
      },
      authorize: policy.authorize.bind(policy),
      contexts,
      clock,
      forward: (request) => {
        forwarded.push(request);
        return Promise.resolve(
          request.method === "Read"
            ? toBinary(QueryService.method.read.output, create(QueryService.method.read.output))
            : toBinary(AckSchema, create(AckSchema)),
        );
      },
    });
    let nextId = 0;
    const subscriptionWires: Uint8Array[] = [];
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => `message board-${String(++nextId)}`,
      dispose: () => Promise.resolve(),
    });
    const subscriptions = new SubscriptionGateway({
      bindings,
      sessions: {
        resolve: () =>
          Promise.resolve({
            principal: trustedPrincipal,
            expiresAt: create(TimestampSchema, { seconds: 99n }),
          }),
      },
      authorize: policy.authorize.bind(policy),
      contexts,
      clock,
      creator: {
        subscribe: (wire) => {
          subscriptionWires.push(wire.bytes.slice());
          return Promise.resolve();
        },
        activate: () => Promise.resolve(),
        cancel: () => Promise.resolve(),
      },
    });
    const services = createNativeGatewayServices({
      unary,
      subscriptions,
      requests: {
        // Mirrors BrowserServer's missing-Authorization sentinel; PublicBoardAdmission ignores it.
        credential: () => ({ kind: "bearer", value: "" }),
        transport: () => ({ service: "ignored", method: "ignored" }),
      },
    });
    const handler = nativeContext();
    const nativePost = (
      author: string,
      board: string,
      context: typeof matchingContext = matchingContext,
    ) =>
      services.command.post(
        create(CommandSchema, {
          context: create(CommandContextSchema, {
            actorContext: context(),
          }),
          message: AnyMessages.pack(
            PostMessageSchema,
            create(PostMessageSchema, {
              id: create(MessageIdSchema, { value: "native" }),
              board: create(BoardIdSchema, { value: board }),
              author: create(BoardUserIdSchema, { value: author }),
              username: "Ada",
              text: "hello",
              postedAt: create(TimestampSchema, { seconds: 1n }),
            }),
          ),
        }),
        handler,
      );

    await expect(nativePost("ada", "board-a")).resolves.toEqual(create(AckSchema));
    await expect(nativePost("ada", "board-a", hostileContext)).rejects.toMatchObject({ code: 3 });
    await expect(nativePost("mallory", "board-a")).rejects.toMatchObject({ code: 7 });
    await expect(nativePost("ada", "board-b")).rejects.toMatchObject({ code: 7 });
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).not.toHaveProperty("credential");
    expect(forwarded[0]).not.toHaveProperty("registry");
    const rewritten = fromBinary(CommandSchema, forwarded[0]?.value ?? new Uint8Array());
    expect(rewritten.context?.actorContext).toMatchObject({
      actor: { value: "ada" },
      tenantId: { kind: { case: "value", value: "tenant-a" } },
      timestamp: { seconds: 42n },
    });
    await expect(
      services.subscription.subscribe(createBoardTopic("board-a"), handler),
    ).resolves.toMatchObject({ id: { value: "message board-1" } });
    await expect(
      services.subscription.subscribe(createBoardTopic("board-b"), handler),
    ).rejects.toMatchObject({ code: 7 });
    await expect(
      services.subscription.subscribe(createBoardTopic("board-a", hostileContext), handler),
    ).rejects.toMatchObject({ code: 7 });
    const mixedNestedSubscribe = nestedBoardRequest(
      "subscribe",
      create(CompositeFilterSchema, {
        operator: CompositeFilter_CompositeOperator.EITHER,
        compositeFilter: [
          boardComposite(CompositeFilter_CompositeOperator.ALL, ["board-a"]),
          boardComposite(CompositeFilter_CompositeOperator.ALL, ["board-b"]),
        ],
      }),
    );
    if (mixedNestedSubscribe.kind !== "subscribe")
      throw new Error("Expected subscription request.");
    await expect(
      services.subscription.subscribe(
        create(TopicSchema, {
          ...mixedNestedSubscribe.topic,
          context: matchingContext(),
        }),
        handler,
      ),
    ).rejects.toMatchObject({ code: 7 });
    expect(subscriptionWires).toHaveLength(1);
    expect(
      fromBinary(SubscriptionSchema, subscriptionWires[0] ?? new Uint8Array()).topic?.context,
    ).toMatchObject({
      actor: { value: "ada" },
      tenantId: { kind: { case: "value", value: "tenant-a" } },
      timestamp: { seconds: 42n },
    });
    await subscriptions.close();
    const nativeQuery = (
      board: string,
      additionalRooms: readonly string[] = [],
      context: typeof matchingContext = matchingContext,
    ) => {
      const request = boardRequest(
        "query",
        board,
        CompositeFilter_CompositeOperator.EITHER,
        additionalRooms,
      );
      if (request.kind !== "query") throw new Error("Expected query request.");
      return services.query.read(
        create(QuerySchema, {
          ...request.query,
          context: context(),
        }),
        handler,
      );
    };
    await expect(nativeQuery("board-a")).resolves.toEqual(create(QueryService.method.read.output));
    expect(forwarded).toHaveLength(2);
    expect(fromBinary(QuerySchema, forwarded[1]?.value ?? new Uint8Array()).context).toMatchObject({
      actor: { value: "ada" },
      tenantId: { kind: { case: "value", value: "tenant-a" } },
      timestamp: { seconds: 42n },
    });
    await expect(nativeQuery("board-a", [], hostileContext)).rejects.toMatchObject({ code: 3 });
    expect(forwarded).toHaveLength(2);
    await expect(nativeQuery("board-a", ["board-b"])).rejects.toMatchObject({ code: 7 });
    await expect(nativeQuery("board-b")).rejects.toMatchObject({ code: 7 });
    expect(forwarded).toHaveLength(2);
  });

  it("admits only an authenticated author's post in an authorized board", async () => {
    const policy = new BoardAccessPolicy();

    await expect(policy.authorize(principal, commandRequest("ada", "board-a"))).resolves.toBe(true);
    await expect(policy.authorize(principal, commandRequest("mallory", "board-a"))).resolves.toBe(
      false,
    );
    await expect(policy.authorize(principal, commandRequest("ada", "board-b"))).resolves.toBe(
      false,
    );
  });

  it("admits only board-scoped MessageBoard Projection queries and subscriptions", async () => {
    const policy = new BoardAccessPolicy();

    await expect(policy.authorize(principal, boardRequest("query", "board-a"))).resolves.toBe(true);
    await expect(policy.authorize(principal, boardRequest("subscribe", "board-a"))).resolves.toBe(
      true,
    );
    await expect(policy.authorize(principal, boardRequest("query", "board-b"))).resolves.toBe(
      false,
    );
    await expect(policy.authorize(principal, boardRequest("subscribe", "board-b"))).resolves.toBe(
      false,
    );
  });

  it("requires a compositional authorized-board guarantee for ALL and EITHER filters", async () => {
    const policy = new BoardAccessPolicy();
    const mixedAll = boardRequest("query", "board-a", CompositeFilter_CompositeOperator.ALL, [
      "board-b",
    ]);
    const mixedEither = boardRequest(
      "subscribe",
      "board-a",
      CompositeFilter_CompositeOperator.EITHER,
      ["board-b"],
    );
    const unknownOnly = boardRequest("query", "board-b");

    await expect(policy.authorize(principal, mixedAll)).resolves.toBe(true);
    await expect(policy.authorize(principal, mixedEither)).resolves.toBe(false);
    await expect(policy.authorize(principal, unknownOnly)).resolves.toBe(false);
  });

  it("applies the authorized-board guarantee recursively to nested filters", async () => {
    const policy = new BoardAccessPolicy();
    const authorized = boardComposite(CompositeFilter_CompositeOperator.ALL, ["board-a"]);
    const unauthorized = boardComposite(CompositeFilter_CompositeOperator.ALL, ["board-b"]);

    await expect(
      policy.authorize(
        principal,
        nestedBoardRequest(
          "query",
          create(CompositeFilterSchema, {
            operator: CompositeFilter_CompositeOperator.ALL,
            compositeFilter: [authorized],
          }),
        ),
      ),
    ).resolves.toBe(true);
    await expect(
      policy.authorize(
        principal,
        nestedBoardRequest(
          "subscribe",
          create(CompositeFilterSchema, {
            operator: CompositeFilter_CompositeOperator.EITHER,
            compositeFilter: [authorized, unauthorized],
          }),
        ),
      ),
    ).resolves.toBe(false);
    await expect(
      policy.authorize(
        principal,
        nestedBoardRequest(
          "query",
          create(CompositeFilterSchema, {
            operator: CompositeFilter_CompositeOperator.EITHER,
            compositeFilter: [authorized, authorized],
          }),
        ),
      ),
    ).resolves.toBe(true);
    await expect(
      policy.authorize(
        principal,
        nestedBoardRequest(
          "query",
          create(CompositeFilterSchema, {
            operator: CompositeFilter_CompositeOperator.ALL,
            filter: authorized.filter,
            compositeFilter: [
              create(CompositeFilterSchema, {
                operator: CompositeFilter_CompositeOperator.EITHER,
                compositeFilter: [authorized, unauthorized],
              }),
            ],
          }),
        ),
      ),
    ).resolves.toBe(true);
  });

  it("accepts exactly eight composites and denies a ninth", async () => {
    const policy = new BoardAccessPolicy();
    await expect(policy.authorize(principal, boardRequestWithComposites(8))).resolves.toBe(true);
    await expect(policy.authorize(principal, boardRequestWithComposites(9))).resolves.toBe(false);
  });

  it("stops the parent traversal when a nested child exhausts the composite budget", async () => {
    const policy = new BoardAccessPolicy();
    let nested = boardComposite(CompositeFilter_CompositeOperator.ALL, ["board-a"]);
    for (let index = 0; index < 8; index += 1) {
      nested = create(CompositeFilterSchema, {
        operator: CompositeFilter_CompositeOperator.ALL,
        compositeFilter: [nested],
      });
    }

    await expect(policy.authorize(principal, nestedBoardRequest("query", nested))).resolves.toBe(
      false,
    );
  });

  it("accepts sixteen simple filters and denies a seventeenth", async () => {
    const policy = new BoardAccessPolicy();
    await expect(
      policy.authorize(
        principal,
        nestedBoardRequest(
          "query",
          boardComposite(CompositeFilter_CompositeOperator.ALL, Array(16).fill("board-a")),
        ),
      ),
    ).resolves.toBe(true);
    await expect(
      policy.authorize(
        principal,
        nestedBoardRequest(
          "query",
          boardComposite(CompositeFilter_CompositeOperator.ALL, Array(17).fill("board-a")),
        ),
      ),
    ).resolves.toBe(false);
  });

  it("denies a wide tree without visiting siblings after budget exhaustion", async () => {
    const policy = new BoardAccessPolicy();
    const poison = create(CompositeFilterSchema);
    Object.defineProperty(poison, "filter", {
      get: () => {
        throw new Error("budget-exhausted sibling was visited");
      },
    });
    const request = boardRequestWithComposites(9, poison);

    await expect(policy.authorize(principal, request)).resolves.toBe(false);
  });

  it("fails closed for unscoped and unsupported requests while allowing bound lifecycle calls", async () => {
    const policy = new BoardAccessPolicy();
    const context = create(ActorContextSchema);
    const subscription = create(SubscriptionSchema);
    const transport = { service: "spine.client.SubscriptionService", method: "Activate" };
    const authorizedQuery = boardRequest("query", "board-a");
    if (authorizedQuery.kind !== "query") throw new Error("Expected query request.");
    const nonFilterTarget = create(TargetSchema, {
      type: TypeUrls.derive(BoardMessageViewSchema),
      criterion: { case: "includeAll", value: true },
    });
    const unsupportedCommand = {
      kind: "command" as const,
      command: create(CommandSchema),
      message: undefined,
      messageType: "example.Unknown",
      requestedContext: create(ActorContextSchema),
      transport,
    } as unknown as IncomingRequest;

    await expect(
      policy.authorize(principal, {
        kind: "activate",
        subscription,
        requestedContext: context,
        transport,
      }),
    ).resolves.toBe(true);
    await expect(
      policy.authorize(principal, {
        kind: "cancel",
        subscription,
        requestedContext: context,
        transport: { ...transport, method: "Cancel" },
      }),
    ).resolves.toBe(true);
    await expect(policy.authorize({ id: "ada" }, commandRequest("ada", "board-a"))).resolves.toBe(
      false,
    );
    await expect(policy.authorize(principal, unsupportedCommand)).resolves.toBe(false);
    await expect(
      policy.authorize(principal, {
        ...authorizedQuery,
        query: create(QuerySchema, { target: create(TargetSchema, { type: "example.Other" }) }),
        target: create(TargetSchema, { type: "example.Other" }),
      }),
    ).resolves.toBe(false);
    await expect(
      policy.authorize(principal, {
        ...authorizedQuery,
        query: create(QuerySchema, { target: nonFilterTarget }),
        target: nonFilterTarget,
      }),
    ).resolves.toBe(false);
  });

  it("fails closed for empty, unrelated, and incomplete filter constraints", async () => {
    const policy = new BoardAccessPolicy();
    const incomplete = create(FilterSchema, {
      fieldPath: { fieldName: ["board"] },
      operator: Filter_Operator.EQUAL,
    });
    const unrelated = create(FilterSchema, {
      fieldPath: { fieldName: ["author"] },
      value: AnyMessages.pack(BoardIdSchema, create(BoardIdSchema, { value: "board-a" })),
      operator: Filter_Operator.EQUAL,
    });
    const nonEquality = create(FilterSchema, {
      fieldPath: { fieldName: ["board"] },
      value: AnyMessages.pack(BoardIdSchema, create(BoardIdSchema, { value: "board-a" })),
      operator: Filter_Operator.GREATER_THAN,
    });

    for (const filter of [undefined, incomplete, unrelated, nonEquality]) {
      const composite = create(CompositeFilterSchema, {
        operator: CompositeFilter_CompositeOperator.ALL,
        ...(filter === undefined ? {} : { filter: [filter] }),
      });
      await expect(
        policy.authorize(principal, nestedBoardRequest("query", composite)),
      ).resolves.toBe(false);
    }
  });

  it("fails closed when a malformed filter cannot be inspected", async () => {
    const policy = new BoardAccessPolicy();
    const malformed = create(CompositeFilterSchema, {
      operator: CompositeFilter_CompositeOperator.ALL,
    });
    Object.defineProperty(malformed, "filter", {
      get: () => {
        throw new Error("malformed filter");
      },
    });

    await expect(policy.authorize(principal, nestedBoardRequest("query", malformed))).resolves.toBe(
      false,
    );
  });

  it("derives the trusted actor, tenant, and gateway clock timestamp from the principal", async () => {
    const resolver = new BoardContextResolver();
    const clock: Clock = { now: () => create(TimestampSchema, { seconds: 42n }) };

    await expect(
      resolver.resolve(
        { ...principal, attributes: { boards: "board-a", tenant: "tenant-a" } },
        boardRequest("query", "board-a"),
        clock,
      ),
    ).resolves.toEqual({
      actor: create(UserIdSchema, { value: "ada" }),
      tenant: create(TenantIdSchema, { kind: { case: "value", value: "tenant-a" } }),
      timestamp: create(TimestampSchema, { seconds: 42n }),
    });
    await expect(
      resolver.resolve(principal, boardRequest("query", "board-a"), clock),
    ).resolves.toEqual({
      actor: create(UserIdSchema, { value: "ada" }),
      timestamp: create(TimestampSchema, { seconds: 42n }),
    });
  });
});

function nativeContext(signal = new AbortController().signal): HandlerContext {
  return { signal } as unknown as HandlerContext;
}

function createBoardTopic(board: string, context: typeof matchingContext = matchingContext) {
  const request = boardRequest("subscribe", board);
  if (request.kind !== "subscribe") throw new Error("Expected subscription request.");
  return create(TopicSchema, {
    ...request.topic,
    context: context(),
  });
}

function matchingContext() {
  return create(ActorContextSchema, {
    actor: create(UserIdSchema, { value: "ada" }),
    tenantId: create(TenantIdSchema, { kind: { case: "value", value: "tenant-a" } }),
  });
}

function hostileContext() {
  return create(ActorContextSchema, {
    actor: create(UserIdSchema, { value: "mallory" }),
    tenantId: create(TenantIdSchema, { kind: { case: "value", value: "tenant-z" } }),
  });
}

function commandRequest(author: string, board: string): IncomingRequest {
  return {
    kind: "command",
    command: create(CommandSchema),
    message: create(PostMessageSchema, {
      id: create(MessageIdSchema, { value: "message-1" }),
      board: create(BoardIdSchema, { value: board }),
      author: create(BoardUserIdSchema, { value: author }),
      username: "Ada",
      text: "hello",
      postedAt: create(TimestampSchema, { seconds: 1n }),
    }),
    messageType: PostMessageSchema.typeName,
    requestedContext: create(ActorContextSchema),
    transport: { service: "spine.client.CommandService", method: "Post" },
  };
}

function boardRequest(
  kind: "query" | "subscribe",
  board: string,
  operator = CompositeFilter_CompositeOperator.ALL,
  additionalRooms: readonly string[] = [],
): IncomingRequest {
  const target = create(TargetSchema, {
    type: TypeUrls.derive(BoardMessageViewSchema),
    criterion: {
      case: "filters",
      value: create(TargetFiltersSchema, {
        filter: [
          create(CompositeFilterSchema, {
            operator,
            filter: [board, ...additionalRooms].map((candidate) =>
              create(FilterSchema, {
                fieldPath: { fieldName: ["board"] },
                value: AnyMessages.pack(BoardIdSchema, create(BoardIdSchema, { value: candidate })),
                operator: Filter_Operator.EQUAL,
              }),
            ),
          }),
        ],
      }),
    },
  });
  const context = create(ActorContextSchema);
  return kind === "query"
    ? {
        kind,
        query: create(QuerySchema, { target, context }),
        target,
        requestedContext: context,
        transport: { service: "spine.client.QueryService", method: "Read" },
      }
    : {
        kind,
        topic: create(TopicSchema, { target, context }),
        target,
        requestedContext: context,
        transport: { service: "spine.client.SubscriptionService", method: "Subscribe" },
      };
}

function boardRequestWithComposites(
  count: number,
  afterBudget?: ReturnType<typeof boardComposite>,
): IncomingRequest {
  const composites = Array.from({ length: count }, () =>
    boardComposite(CompositeFilter_CompositeOperator.ALL, ["board-a"]),
  );
  if (afterBudget !== undefined) composites.push(afterBudget);
  const target = create(TargetSchema, {
    type: TypeUrls.derive(BoardMessageViewSchema),
    criterion: {
      case: "filters",
      value: create(TargetFiltersSchema, { filter: composites }),
    },
  });
  const context = create(ActorContextSchema);
  return {
    kind: "query",
    query: create(QuerySchema, { target, context }),
    target,
    requestedContext: context,
    transport: { service: "spine.client.QueryService", method: "Read" },
  };
}

function boardComposite(operator: CompositeFilter_CompositeOperator, boards: readonly string[]) {
  return create(CompositeFilterSchema, {
    operator,
    filter: boards.map((board) =>
      create(FilterSchema, {
        fieldPath: { fieldName: ["board"] },
        value: AnyMessages.pack(BoardIdSchema, create(BoardIdSchema, { value: board })),
        operator: Filter_Operator.EQUAL,
      }),
    ),
  });
}

function nestedBoardRequest(
  kind: "query" | "subscribe",
  composite: ReturnType<typeof boardComposite>,
): IncomingRequest {
  const target = create(TargetSchema, {
    type: TypeUrls.derive(BoardMessageViewSchema),
    criterion: {
      case: "filters",
      value: create(TargetFiltersSchema, { filter: [composite] }),
    },
  });
  const context = create(ActorContextSchema);
  return kind === "query"
    ? {
        kind,
        query: create(QuerySchema, { target, context }),
        target,
        requestedContext: context,
        transport: { service: "spine.client.QueryService", method: "Read" },
      }
    : {
        kind,
        topic: create(TopicSchema, { target, context }),
        target,
        requestedContext: context,
        transport: { service: "spine.client.SubscriptionService", method: "Subscribe" },
      };
}
