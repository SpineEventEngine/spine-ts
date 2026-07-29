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
  ChatMessageViewSchema,
  ChatRoomIdSchema,
  MessageIdSchema,
} from "@spine-event-engine/example-chat-model/generated/spine/example/chat/v1/chat_pb.js";
import { PostMessageSchema } from "@spine-event-engine/example-chat-model/generated/spine/example/chat/v1/commands_pb.js";
import { UserIdSchema as ChatUserIdSchema } from "@spine-event-engine/example-chat-users-model/generated/spine/example/users/v1/users_pb.js";
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

import { ChatAuthorizationPolicy, ChatContextResolver } from "../src/chat-policy.js";
import { typeRegistry } from "../src/model-registry.js";

const principal: AuthenticatedPrincipal = {
  id: "ada",
  attributes: { rooms: "room-a" },
};

describe("Chat gateway policy", () => {
  it("composes native services with the Chat registry, policy, and trusted context", async () => {
    const policy = new ChatAuthorizationPolicy();
    const contexts = new ChatContextResolver();
    const trustedPrincipal = { id: "ada", attributes: { rooms: "room-a", tenant: "tenant-a" } };
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
      nextId: () => `chat-${String(++nextId)}`,
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
      fingerprint: (candidate) => candidate.id,
      creator: {
        subscribe: (wire) => {
          subscriptionWires.push(wire.bytes.slice());
          return Promise.resolve({
            kind: "backend-subscription-envelope",
            bytes: wire.bytes.slice(),
          });
        },
        activate: () => Promise.resolve(),
        cancel: () => Promise.resolve(),
        dispose: () => Promise.resolve(),
      },
    });
    const services = createNativeGatewayServices({
      unary,
      subscriptions,
      requests: {
        credential: () => ({ kind: "bearer", value: "session" }),
        transport: () => ({ service: "ignored", method: "ignored" }),
      },
    });
    const handler = nativeContext();
    const nativePost = (
      author: string,
      room: string,
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
              room: create(ChatRoomIdSchema, { value: room }),
              author: create(ChatUserIdSchema, { value: author }),
              text: "hello",
              postedAt: create(TimestampSchema, { seconds: 1n }),
            }),
          ),
        }),
        handler,
      );

    await expect(nativePost("ada", "room-a")).resolves.toEqual(create(AckSchema));
    await expect(nativePost("ada", "room-a", hostileContext)).rejects.toMatchObject({ code: 3 });
    await expect(nativePost("mallory", "room-a")).rejects.toMatchObject({ code: 7 });
    await expect(nativePost("ada", "room-b")).rejects.toMatchObject({ code: 7 });
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
      services.subscription.subscribe(createRoomTopic("room-a"), handler),
    ).resolves.toMatchObject({ id: { value: "chat-1" } });
    await expect(
      services.subscription.subscribe(createRoomTopic("room-b"), handler),
    ).rejects.toMatchObject({ code: 7 });
    await expect(
      services.subscription.subscribe(createRoomTopic("room-a", hostileContext), handler),
    ).rejects.toMatchObject({ code: 7 });
    const mixedNestedSubscribe = nestedRoomRequest(
      "subscribe",
      create(CompositeFilterSchema, {
        operator: CompositeFilter_CompositeOperator.EITHER,
        compositeFilter: [
          roomComposite(CompositeFilter_CompositeOperator.ALL, ["room-a"]),
          roomComposite(CompositeFilter_CompositeOperator.ALL, ["room-b"]),
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
    expect(fromBinary(TopicSchema, subscriptionWires[0] ?? new Uint8Array()).context).toMatchObject(
      {
        actor: { value: "ada" },
        tenantId: { kind: { case: "value", value: "tenant-a" } },
        timestamp: { seconds: 42n },
      },
    );
    await subscriptions.close();
    const nativeQuery = (
      room: string,
      additionalRooms: readonly string[] = [],
      context: typeof matchingContext = matchingContext,
    ) => {
      const request = roomRequest(
        "query",
        room,
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
    await expect(nativeQuery("room-a")).resolves.toEqual(create(QueryService.method.read.output));
    expect(forwarded).toHaveLength(2);
    expect(fromBinary(QuerySchema, forwarded[1]?.value ?? new Uint8Array()).context).toMatchObject({
      actor: { value: "ada" },
      tenantId: { kind: { case: "value", value: "tenant-a" } },
      timestamp: { seconds: 42n },
    });
    await expect(nativeQuery("room-a", [], hostileContext)).rejects.toMatchObject({ code: 3 });
    expect(forwarded).toHaveLength(2);
    await expect(nativeQuery("room-a", ["room-b"])).rejects.toMatchObject({ code: 7 });
    await expect(nativeQuery("room-b")).rejects.toMatchObject({ code: 7 });
    expect(forwarded).toHaveLength(2);
  });

  it("admits only an authenticated author's post in an authorized room", async () => {
    const policy = new ChatAuthorizationPolicy();

    await expect(policy.authorize(principal, commandRequest("ada", "room-a"))).resolves.toBe(true);
    await expect(policy.authorize(principal, commandRequest("mallory", "room-a"))).resolves.toBe(
      false,
    );
    await expect(policy.authorize(principal, commandRequest("ada", "room-b"))).resolves.toBe(false);
  });

  it("admits only room-scoped Chat Projection queries and subscriptions", async () => {
    const policy = new ChatAuthorizationPolicy();

    await expect(policy.authorize(principal, roomRequest("query", "room-a"))).resolves.toBe(true);
    await expect(policy.authorize(principal, roomRequest("subscribe", "room-a"))).resolves.toBe(
      true,
    );
    await expect(policy.authorize(principal, roomRequest("query", "room-b"))).resolves.toBe(false);
    await expect(policy.authorize(principal, roomRequest("subscribe", "room-b"))).resolves.toBe(
      false,
    );
  });

  it("requires a compositional authorized-room guarantee for ALL and EITHER filters", async () => {
    const policy = new ChatAuthorizationPolicy();
    const mixedAll = roomRequest("query", "room-a", CompositeFilter_CompositeOperator.ALL, [
      "room-b",
    ]);
    const mixedEither = roomRequest(
      "subscribe",
      "room-a",
      CompositeFilter_CompositeOperator.EITHER,
      ["room-b"],
    );
    const unknownOnly = roomRequest("query", "room-b");

    await expect(policy.authorize(principal, mixedAll)).resolves.toBe(true);
    await expect(policy.authorize(principal, mixedEither)).resolves.toBe(false);
    await expect(policy.authorize(principal, unknownOnly)).resolves.toBe(false);
  });

  it("applies the authorized-room guarantee recursively to nested filters", async () => {
    const policy = new ChatAuthorizationPolicy();
    const authorized = roomComposite(CompositeFilter_CompositeOperator.ALL, ["room-a"]);
    const unauthorized = roomComposite(CompositeFilter_CompositeOperator.ALL, ["room-b"]);

    await expect(
      policy.authorize(
        principal,
        nestedRoomRequest(
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
        nestedRoomRequest(
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
        nestedRoomRequest(
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
        nestedRoomRequest(
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
    const policy = new ChatAuthorizationPolicy();
    await expect(policy.authorize(principal, roomRequestWithComposites(8))).resolves.toBe(true);
    await expect(policy.authorize(principal, roomRequestWithComposites(9))).resolves.toBe(false);
  });

  it("accepts sixteen simple filters and denies a seventeenth", async () => {
    const policy = new ChatAuthorizationPolicy();
    await expect(
      policy.authorize(
        principal,
        nestedRoomRequest(
          "query",
          roomComposite(CompositeFilter_CompositeOperator.ALL, Array(16).fill("room-a")),
        ),
      ),
    ).resolves.toBe(true);
    await expect(
      policy.authorize(
        principal,
        nestedRoomRequest(
          "query",
          roomComposite(CompositeFilter_CompositeOperator.ALL, Array(17).fill("room-a")),
        ),
      ),
    ).resolves.toBe(false);
  });

  it("denies a wide tree without visiting siblings after budget exhaustion", async () => {
    const policy = new ChatAuthorizationPolicy();
    const poison = create(CompositeFilterSchema);
    Object.defineProperty(poison, "filter", {
      get: () => {
        throw new Error("budget-exhausted sibling was visited");
      },
    });
    const request = roomRequestWithComposites(9, poison);

    await expect(policy.authorize(principal, request)).resolves.toBe(false);
  });

  it("fails closed for unscoped and unsupported requests while allowing bound lifecycle calls", async () => {
    const policy = new ChatAuthorizationPolicy();
    const context = create(ActorContextSchema);
    const subscription = create(SubscriptionSchema);
    const transport = { service: "spine.client.SubscriptionService", method: "Activate" };
    const authorizedQuery = roomRequest("query", "room-a");
    if (authorizedQuery.kind !== "query") throw new Error("Expected query request.");
    const nonFilterTarget = create(TargetSchema, {
      type: TypeUrls.derive(ChatMessageViewSchema),
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
    await expect(policy.authorize({ id: "ada" }, commandRequest("ada", "room-a"))).resolves.toBe(
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
    const policy = new ChatAuthorizationPolicy();
    const incomplete = create(FilterSchema, {
      fieldPath: { fieldName: ["room"] },
      operator: Filter_Operator.EQUAL,
    });
    const unrelated = create(FilterSchema, {
      fieldPath: { fieldName: ["author"] },
      value: AnyMessages.pack(ChatRoomIdSchema, create(ChatRoomIdSchema, { value: "room-a" })),
      operator: Filter_Operator.EQUAL,
    });
    const nonEquality = create(FilterSchema, {
      fieldPath: { fieldName: ["room"] },
      value: AnyMessages.pack(ChatRoomIdSchema, create(ChatRoomIdSchema, { value: "room-a" })),
      operator: Filter_Operator.GREATER_THAN,
    });

    for (const filter of [undefined, incomplete, unrelated, nonEquality]) {
      const composite = create(CompositeFilterSchema, {
        operator: CompositeFilter_CompositeOperator.ALL,
        ...(filter === undefined ? {} : { filter: [filter] }),
      });
      await expect(
        policy.authorize(principal, nestedRoomRequest("query", composite)),
      ).resolves.toBe(false);
    }
  });

  it("derives the trusted actor, tenant, and gateway clock timestamp from the principal", async () => {
    const resolver = new ChatContextResolver();
    const clock: Clock = { now: () => create(TimestampSchema, { seconds: 42n }) };

    await expect(
      resolver.resolve(
        { ...principal, attributes: { rooms: "room-a", tenant: "tenant-a" } },
        roomRequest("query", "room-a"),
        clock,
      ),
    ).resolves.toEqual({
      actor: create(UserIdSchema, { value: "ada" }),
      tenant: create(TenantIdSchema, { kind: { case: "value", value: "tenant-a" } }),
      timestamp: create(TimestampSchema, { seconds: 42n }),
    });
    await expect(
      resolver.resolve(principal, roomRequest("query", "room-a"), clock),
    ).resolves.toEqual({
      actor: create(UserIdSchema, { value: "ada" }),
      timestamp: create(TimestampSchema, { seconds: 42n }),
    });
  });
});

function nativeContext(signal = new AbortController().signal): HandlerContext {
  return { signal } as unknown as HandlerContext;
}

function createRoomTopic(room: string, context: typeof matchingContext = matchingContext) {
  const request = roomRequest("subscribe", room);
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

function commandRequest(author: string, room: string): IncomingRequest {
  return {
    kind: "command",
    command: create(CommandSchema),
    message: create(PostMessageSchema, {
      id: create(MessageIdSchema, { value: "message-1" }),
      room: create(ChatRoomIdSchema, { value: room }),
      author: create(ChatUserIdSchema, { value: author }),
      text: "hello",
      postedAt: create(TimestampSchema, { seconds: 1n }),
    }),
    messageType: PostMessageSchema.typeName,
    requestedContext: create(ActorContextSchema),
    transport: { service: "spine.client.CommandService", method: "Post" },
  };
}

function roomRequest(
  kind: "query" | "subscribe",
  room: string,
  operator = CompositeFilter_CompositeOperator.ALL,
  additionalRooms: readonly string[] = [],
): IncomingRequest {
  const target = create(TargetSchema, {
    type: TypeUrls.derive(ChatMessageViewSchema),
    criterion: {
      case: "filters",
      value: create(TargetFiltersSchema, {
        filter: [
          create(CompositeFilterSchema, {
            operator,
            filter: [room, ...additionalRooms].map((candidate) =>
              create(FilterSchema, {
                fieldPath: { fieldName: ["room"] },
                value: AnyMessages.pack(
                  ChatRoomIdSchema,
                  create(ChatRoomIdSchema, { value: candidate }),
                ),
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

function roomRequestWithComposites(
  count: number,
  afterBudget?: ReturnType<typeof roomComposite>,
): IncomingRequest {
  const composites = Array.from({ length: count }, () =>
    roomComposite(CompositeFilter_CompositeOperator.ALL, ["room-a"]),
  );
  if (afterBudget !== undefined) composites.push(afterBudget);
  const target = create(TargetSchema, {
    type: TypeUrls.derive(ChatMessageViewSchema),
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

function roomComposite(operator: CompositeFilter_CompositeOperator, rooms: readonly string[]) {
  return create(CompositeFilterSchema, {
    operator,
    filter: rooms.map((room) =>
      create(FilterSchema, {
        fieldPath: { fieldName: ["room"] },
        value: AnyMessages.pack(ChatRoomIdSchema, create(ChatRoomIdSchema, { value: room })),
        operator: Filter_Operator.EQUAL,
      }),
    ),
  });
}

function nestedRoomRequest(
  kind: "query" | "subscribe",
  composite: ReturnType<typeof roomComposite>,
): IncomingRequest {
  const target = create(TargetSchema, {
    type: TypeUrls.derive(ChatMessageViewSchema),
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
