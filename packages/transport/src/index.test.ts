import { describe, expect, expectTypeOf, it } from "vitest";

import {
  type AsyncCloseable,
  type PublishTransportHandler,
  type PublishTransportOperation,
  type RequestTransportHandler,
  type RequestTransportOperation,
  type SignalTransport,
  type TransportSignalKind,
  createTransportSubscription,
  createTransportTopic,
} from "./index.js";

describe("@spine-ts/transport", () => {
  it("creates copy-safe topics with deterministic routing keys", () => {
    const semanticTags = ["tenant", "event", "tenant"] as const;
    const topic = createTransportTopic({
      signalKind: "event",
      messageTypeUrl: " type.spine.io/example.TaskCreated ",
      semanticTags,
    });
    const sameTopic = createTransportTopic({
      signalKind: "event",
      messageTypeUrl: "type.spine.io/example.TaskCreated",
      semanticTags: ["event", "tenant"],
    });
    const reorderedTopic = createTransportTopic({
      signalKind: "event",
      messageTypeUrl: "type.spine.io/example.TaskCreated",
      semanticTags: ["event.alpha", "event0", "event_Alpha"],
    });
    const reorderedSameTopic = createTransportTopic({
      signalKind: "event",
      messageTypeUrl: "type.spine.io/example.TaskCreated",
      semanticTags: ["event_Alpha", "event.alpha", "event0"],
    });

    expect(topic).toEqual({
      signalKind: "event",
      messageTypeUrl: "type.spine.io/example.TaskCreated",
      semanticTags: ["event", "tenant"],
      routing: {
        signalKind: "event",
        messageTypeUrl: "type.spine.io/example.TaskCreated",
        semanticTags: ["event", "tenant"],
        routingKey: "event:type.spine.io%2Fexample.TaskCreated:event,tenant",
      },
    });
    expect(topic.routing.routingKey).toBe(sameTopic.routing.routingKey);
    expect(topic.semanticTags).not.toBe(semanticTags);
    expect(topic.semanticTags).toEqual(["event", "tenant"]);
    expect(Object.isFrozen(topic)).toBe(true);
    expect(Object.isFrozen(topic.routing)).toBe(true);
    expect(reorderedTopic.semanticTags).toEqual(["event.alpha", "event0", "event_Alpha"]);
    expect(reorderedTopic.routing.routingKey).toBe(reorderedSameTopic.routing.routingKey);
  });

  it("creates copy-safe subscription descriptors with deterministic keys", () => {
    const subscription = createTransportSubscription({
      subscriberId: " projection-worker ",
      topic: {
        signalKind: "event",
        messageTypeUrl: "type.spine.io/example.TaskArchived",
        semanticTags: ["archived", "projection"],
      },
    });

    expect(subscription).toEqual({
      subscriberId: "projection-worker",
      mode: "fan-out",
      topic: {
        signalKind: "event",
        messageTypeUrl: "type.spine.io/example.TaskArchived",
        semanticTags: ["archived", "projection"],
        routing: {
          signalKind: "event",
          messageTypeUrl: "type.spine.io/example.TaskArchived",
          semanticTags: ["archived", "projection"],
          routingKey: "event:type.spine.io%2Fexample.TaskArchived:archived,projection",
        },
      },
      descriptorKey:
        "event:type.spine.io%2Fexample.TaskArchived:archived,projection#fan-out#projection-worker",
    });
    expect(subscription.topic).not.toHaveProperty("socketType");
    expect(subscription.topic).not.toHaveProperty("endpoint");
    expect(subscription).not.toHaveProperty("broker");
    expect(subscription).not.toHaveProperty("frames");
    expect(Object.isFrozen(subscription)).toBe(true);
  });

  it("rejects malformed routing inputs", () => {
    expect(() =>
      createTransportTopic({
        signalKind: "command",
        messageTypeUrl: " ",
      }),
    ).toThrow(/messageTypeUrl/);
    expect(() =>
      createTransportTopic({
        signalKind: "command",
        messageTypeUrl: "type.spine.io",
      }),
    ).toThrow(/prefix\/type\.name/);
    expect(() =>
      createTransportTopic({
        signalKind: "command",
        messageTypeUrl: "/example.TaskCreated",
      }),
    ).toThrow(/prefix\/type\.name/);
    expect(() =>
      createTransportTopic({
        signalKind: "command",
        messageTypeUrl: "type.spine.io/ example.TaskCreated",
      }),
    ).toThrow(/prefix\/type\.name/);

    expect(() =>
      createTransportSubscription({
        subscriberId: " ",
        topic: {
          signalKind: "query",
          messageTypeUrl: "type.spine.io/example.TaskById",
        },
      }),
    ).toThrow(/subscriberId/);
  });

  it("rejects unknown runtime signal kinds and subscription modes", () => {
    expect(() =>
      createTransportTopic({
        signalKind: "side-channel" as TransportSignalKind,
        messageTypeUrl: "type.spine.io/example.TaskCreated",
      }),
    ).toThrow(/signalKind/);

    expect(() =>
      createTransportSubscription({
        subscriberId: "projection-worker",
        mode: "round-robin" as never,
        topic: {
          signalKind: "event",
          messageTypeUrl: "type.spine.io/example.TaskCreated",
        },
      }),
    ).toThrow(/mode/);
    expect(() =>
      createTransportSubscription({
        subscriberId: "projection-worker",
        mode: "round-robin" as never,
        topic: {
          signalKind: "event",
          messageTypeUrl: "malformed-type-url",
        },
      }),
    ).toThrow(/mode/);
  });

  it("exposes adapter-agnostic operation, handler, and close type contracts", () => {
    expectTypeOf<TransportSignalKind>().toEqualTypeOf<
      "command" | "delivery" | "event" | "query" | "subscription" | "system"
    >();

    expectTypeOf<PublishTransportOperation<{ id: string }, "event">>().toExtend<{
      readonly topic: object;
      readonly envelope: { id: string };
    }>();
    expectTypeOf<RequestTransportOperation<{ id: string }, "query">>().toExtend<{
      readonly topic: object;
      readonly envelope: { id: string };
    }>();
    expectTypeOf<PublishTransportHandler<{ id: string }, "event">>().toEqualTypeOf<
      (operation: PublishTransportOperation<{ id: string }, "event">) => void | Promise<void>
    >();
    expectTypeOf<
      RequestTransportHandler<{ id: string }, { found: boolean }, "query">
    >().toEqualTypeOf<
      (
        operation: RequestTransportOperation<{ id: string }, "query">,
      ) => { found: boolean } | Promise<{ found: boolean }>
    >();
    expectTypeOf<AsyncCloseable["close"]>().returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf<SignalTransport["publish"]>().returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf<SignalTransport["request"]>().returns.resolves.toEqualTypeOf<unknown>();
  });
});
