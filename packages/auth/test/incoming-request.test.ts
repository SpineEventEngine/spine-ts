import { create, toBinary } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { TypeRegistry, packAny } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandSchema,
  UserIdSchema,
} from "@spine-event-engine/proto";
import {
  QuerySchema,
  SubscriptionSchema,
  TargetSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { describe, expect, it } from "vitest";

import { decodeIncomingRequest, transportFacts } from "../src/index.js";

describe("decodeIncomingRequest", () => {
  it("creates exhaustive request facts while keeping credentials out of transport diagnostics", () => {
    const context = create(ActorContextSchema);
    const command = create(CommandSchema, {
      context: create(CommandContextSchema, { actorContext: context }),
      message: create(AnySchema, {
        typeUrl: "type.example.test/Start",
        value: new Uint8Array([8, 1]),
      }),
    });
    const query = create(QuerySchema, { context });
    const subscription = create(SubscriptionSchema, { topic: create(TopicSchema, { context }) });
    const transport = transportFacts({
      service: "spine.client.CommandService",
      method: "Post",
      headers: {
        authorization: "Bearer not-for-policy",
        cookie: "session=not-for-policy",
        "x-request-id": "request-1",
        "x-untrusted": "not-for-policy",
      },
    });

    const requests = [
      decodeIncomingRequest({
        kind: "command",
        value: toBinary(CommandSchema, command),
        transport,
      }),
      decodeIncomingRequest({ kind: "query", value: toBinary(QuerySchema, query), transport }),
      decodeIncomingRequest({
        kind: "subscribe",
        value: toBinary(TopicSchema, subscription.topic!),
        transport,
      }),
      decodeIncomingRequest({
        kind: "activate",
        value: toBinary(SubscriptionSchema, subscription),
        transport,
      }),
      decodeIncomingRequest({
        kind: "cancel",
        value: toBinary(SubscriptionSchema, subscription),
        transport,
      }),
    ];

    expect(requests.map((request) => request?.kind)).toEqual([
      "command",
      "query",
      "subscribe",
      "activate",
      "cancel",
    ]);
    expect(requests[0]).toMatchObject({
      kind: "command",
      message: undefined,
      messageType: "type.example.test/Start",
    });
    expect(transport).toEqual({
      service: "spine.client.CommandService",
      method: "Post",
      requestId: "request-1",
    });
  });
});

describe("packed command decoding", () => {
  it("decodes a registered message but safely preserves unknown and malformed Any as type-url-only facts", () => {
    const context = create(ActorContextSchema);
    const transport = transportFacts({ service: "spine.client.CommandService", method: "Post" });
    const registered = create(CommandSchema, {
      context: create(CommandContextSchema, { actorContext: context }),
      message: packAny(UserIdSchema, create(UserIdSchema, { value: "user-1" }), {
        validate: false,
      }),
    });
    const unknown = create(CommandSchema, {
      context: create(CommandContextSchema, { actorContext: context }),
      message: create(AnySchema, {
        typeUrl: "type.example.test/Unknown",
        value: new Uint8Array([8, 1]),
      }),
    });
    const malformed = create(CommandSchema, {
      context: create(CommandContextSchema, { actorContext: context }),
      message: create(AnySchema, {
        typeUrl: "type.spine.io/spine.core.UserId",
        value: new Uint8Array([255]),
      }),
    });
    const registry = new TypeRegistry([UserIdSchema]);

    expect(
      decodeIncomingRequest({
        kind: "command",
        value: toBinary(CommandSchema, registered),
        transport,
        registry,
      }),
    ).toMatchObject({ kind: "command", message: { value: "user-1" } });
    expect(
      decodeIncomingRequest({
        kind: "command",
        value: toBinary(CommandSchema, unknown),
        transport,
        registry,
      }),
    ).toMatchObject({
      kind: "command",
      message: undefined,
      messageType: "type.example.test/Unknown",
    });
    expect(
      decodeIncomingRequest({
        kind: "command",
        value: toBinary(CommandSchema, malformed),
        transport,
        registry,
      }),
    ).toMatchObject({
      kind: "command",
      message: undefined,
      messageType: "type.spine.io/spine.core.UserId",
    });
  });
});

describe("outer envelope decoding", () => {
  it("rejects malformed bytes and preserves decoded target and context facts for non-command requests", () => {
    const queryContext = create(ActorContextSchema, { actor: { value: "query-actor" } });
    const topicContext = create(ActorContextSchema, { actor: { value: "topic-actor" } });
    const queryTarget = create(TargetSchema, {
      type: "type.example.test/Query",
      criterion: { case: "includeAll", value: true },
    });
    const topicTarget = create(TargetSchema, {
      type: "type.example.test/Topic",
      criterion: { case: "includeAll", value: true },
    });
    const query = create(QuerySchema, { context: queryContext, target: queryTarget });
    const topic = create(TopicSchema, { context: topicContext, target: topicTarget });
    const subscription = create(SubscriptionSchema, { topic });
    const transport = transportFacts({ service: "spine.client.QueryService", method: "Read" });

    expect(
      decodeIncomingRequest({ kind: "query", value: toBinary(QuerySchema, query), transport }),
    ).toMatchObject({
      kind: "query",
      target: { type: "type.example.test/Query", criterion: { case: "includeAll", value: true } },
      requestedContext: { actor: { value: "query-actor" } },
    });
    expect(
      decodeIncomingRequest({ kind: "subscribe", value: toBinary(TopicSchema, topic), transport }),
    ).toMatchObject({
      kind: "subscribe",
      target: { type: "type.example.test/Topic", criterion: { case: "includeAll", value: true } },
      requestedContext: { actor: { value: "topic-actor" } },
    });
    for (const kind of ["activate", "cancel"] as const) {
      expect(
        decodeIncomingRequest({
          kind,
          value: toBinary(SubscriptionSchema, subscription),
          transport,
        }),
      ).toMatchObject({
        kind,
        requestedContext: { actor: { value: "topic-actor" } },
      });
    }
    for (const kind of ["query", "subscribe", "activate", "cancel"] as const) {
      expect(
        decodeIncomingRequest({ kind, value: new Uint8Array([255]), transport }),
      ).toBeUndefined();
    }
  });
});

describe("fallback request facts", () => {
  it("uses safe empty facts for envelopes that omit optional context, target, topic, or packed message", () => {
    const transport = transportFacts({
      service: "spine.client.SubscriptionService",
      method: "Activate",
    });
    const command = decodeIncomingRequest({
      kind: "command",
      value: toBinary(CommandSchema, create(CommandSchema)),
      transport,
    });
    const query = decodeIncomingRequest({
      kind: "query",
      value: toBinary(QuerySchema, create(QuerySchema)),
      transport,
    });
    const subscription = create(SubscriptionSchema);

    expect(command).toMatchObject({
      kind: "command",
      message: undefined,
      messageType: "",
      requestedContext: { language: 0 },
    });
    expect(query).toMatchObject({
      kind: "query",
      target: { type: "" },
      requestedContext: { language: 0 },
    });
    expect(
      decodeIncomingRequest({
        kind: "subscribe",
        value: toBinary(TopicSchema, create(TopicSchema)),
        transport,
      }),
    ).toMatchObject({
      kind: "subscribe",
      target: { type: "" },
      requestedContext: { language: 0 },
    });
    for (const kind of ["activate", "cancel"] as const) {
      expect(
        decodeIncomingRequest({
          kind,
          value: toBinary(SubscriptionSchema, subscription),
          transport,
        }),
      ).toMatchObject({ kind, requestedContext: { language: 0 } });
    }
  });

  it("normalizes allowlisted headers while retaining optional transport facts", () => {
    expect(
      transportFacts({
        service: "spine.client.QueryService",
        method: "Read",
        origin: "https://example.test",
        peerAddress: "127.0.0.1",
        userAgent: "test-agent",
        headers: { "X-Request-Id": "request-2", "X-Correlation-Id": undefined },
      }),
    ).toEqual({
      service: "spine.client.QueryService",
      method: "Read",
      origin: "https://example.test",
      requestId: "request-2",
      peerAddress: "127.0.0.1",
      userAgent: "test-agent",
    });
    expect(
      transportFacts({ service: "spine.client.QueryService", method: "Read", headers: undefined }),
    ).toEqual({
      service: "spine.client.QueryService",
      method: "Read",
    });
  });
});
