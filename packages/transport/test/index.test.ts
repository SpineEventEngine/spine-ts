import { create } from "@bufbuild/protobuf";
import { CommandSchema, EventSchema, type Command, type Event } from "@spine-ts/proto";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  type AsyncCloseable,
  type PublishTransportHandler,
  type PublishTransportOperation,
  type RequestTransportHandler,
  type RequestTransportOperation,
  type SignalTransport,
  type TransportSignalEnvelope,
  type TransportSignalKind,
  type TransportTopic,
  createTransportSubscription,
  createTransportTopic,
  isTransportOperationKind,
  isTransportTopicKind,
} from "../src/index.js";

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
    expect(subscription).not.toHaveProperty("worker");
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

  it("keeps simple logical ids valid and endpoint-shaped ids invalid", () => {
    expect(() =>
      createTransportSubscription({
        subscriberId: "projection_worker",
        topic: {
          signalKind: "query",
          messageTypeUrl: "type.spine.io/example.TaskById",
        },
      }),
    ).not.toThrow();

    const invalidIds = [
      "ipc://broker",
      "tcp://127.0.0.1:5555",
      "/tmp/worker",
      "worker@host",
      "12345",
      "broker.local",
      "worker-01.prod",
      "127.0.0.1",
    ];

    for (const invalidId of invalidIds) {
      expect(() =>
        createTransportSubscription({
          subscriberId: invalidId,
          topic: {
            signalKind: "query",
            messageTypeUrl: "type.spine.io/example.TaskById",
          },
        }),
      ).toThrow(/logical-name format/);
    }
  });

  it("rejects unknown runtime signal kinds and subscription modes", () => {
    expect(() =>
      createTransportTopic({
        signalKind: "delivery" as TransportSignalKind,
        messageTypeUrl: "type.spine.io/example.TaskDelivery",
      }),
    ).toThrow(/signalKind/);
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

  it("exposes only adapter-agnostic operation, handler, and close type contracts", () => {
    expectTypeOf<TransportSignalKind>().toEqualTypeOf<
      "command" | "event" | "query" | "subscription" | "system"
    >();

    expectTypeOf<TransportSignalEnvelope<"command", { id: string }>>().toEqualTypeOf<Command>();
    expectTypeOf<TransportSignalEnvelope<"event", { id: string }>>().toEqualTypeOf<Event>();
    expectTypeOf<TransportSignalEnvelope<"system", { id: string }>>().toEqualTypeOf<{
      id: string;
    }>();
    expectTypeOf<TransportSignalEnvelope<"query", { id: string }>>().toEqualTypeOf<{
      id: string;
    }>();

    expectTypeOf<
      PublishTransportOperation<{ id: string }, "event">["envelope"]
    >().toEqualTypeOf<Event>();
    expectTypeOf<
      Parameters<PublishTransportHandler<{ id: string }, "event">>[0]["envelope"]
    >().toEqualTypeOf<Event>();
    expectTypeOf<
      Parameters<RequestTransportHandler<{ id: string }, unknown, "command">>[0]["envelope"]
    >().toEqualTypeOf<Command>();
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

    const commandTopic = createTransportTopic({
      signalKind: "command",
      messageTypeUrl: "type.spine.io/spine.core.Command",
    });
    const eventTopic = createTransportTopic({
      signalKind: "event",
      messageTypeUrl: "type.spine.io/spine.core.Event",
    });
    const systemTopic = createTransportTopic({
      signalKind: "system",
      messageTypeUrl: "type.spine.io/private.SystemMessage",
    });
    const commandOperation: PublishTransportOperation<{ id: string }, "command"> = {
      topic: commandTopic,
      envelope: create(CommandSchema),
    };
    const eventOperation: RequestTransportOperation<{ id: string }, "event"> = {
      topic: eventTopic,
      envelope: create(EventSchema),
    };
    const invalidCommandOperation: PublishTransportOperation<{ id: string }, "command"> = {
      topic: commandTopic,
      // @ts-expect-error command topics require the generated Command envelope.
      envelope: { id: "plain-command" },
    };
    const invalidEventOperation: RequestTransportOperation<{ id: string }, "event"> = {
      topic: eventTopic,
      // @ts-expect-error event topics require the generated Event envelope.
      envelope: { id: "plain-event" },
    };
    const validWidenedCommand: PublishTransportOperation<{ id: string }> = {
      topic: commandTopic,
      envelope: create(CommandSchema),
    };
    const validUnionSystem: RequestTransportOperation<{ id: string }, "event" | "system"> = {
      topic: systemTopic,
      envelope: { id: "plain-system" },
    };

    // @ts-expect-error a widened kind must keep a command topic correlated with Command.
    const invalidWidenedPublish: PublishTransportOperation<{ id: string }> = {
      topic: commandTopic,
      envelope: { id: "plain-command" },
    };
    // @ts-expect-error a union kind must keep an event topic correlated with Event.
    const invalidUnionRequest: RequestTransportOperation<{ id: string }, "event" | "system"> = {
      topic: eventTopic,
      envelope: { id: "plain-event" },
    };
    const assertExplicitGenericCalls = (transport: SignalTransport): void => {
      // @ts-expect-error explicit widened publish generics cannot bypass command correlation.
      void transport.publish<{ id: string }, TransportSignalKind>({
        topic: commandTopic,
        envelope: { id: "plain-command" },
      });
      // @ts-expect-error explicit union request generics cannot bypass event correlation.
      void transport.request<{ id: string }, unknown, "event" | "system">({
        topic: eventTopic,
        envelope: { id: "plain-event" },
      });
    };

    expectTypeOf(commandOperation.envelope).toEqualTypeOf<Command>();
    expectTypeOf(eventOperation.envelope).toEqualTypeOf<Event>();
    expectTypeOf(invalidCommandOperation.envelope).toEqualTypeOf<Command>();
    expectTypeOf(invalidEventOperation.envelope).toEqualTypeOf<Event>();
    expectTypeOf(validWidenedCommand.envelope).toEqualTypeOf<Command>();
    expectTypeOf(validUnionSystem.envelope).toEqualTypeOf<{ id: string }>();
    void invalidWidenedPublish;
    void invalidUnionRequest;
    void assertExplicitGenericCalls;
  });

  it("narrows widened and open operations and topics through fixed kind paths", () => {
    interface PrivateEnvelope {
      readonly id: string;
    }
    type OpenPublishOperation = PublishTransportOperation<PrivateEnvelope> & {
      readonly [key: string]: unknown;
      readonly operationRefinement: "open-operation";
    };
    type OpenTopic = TransportTopic & {
      readonly [key: string]: unknown;
      readonly topicRefinement: "open-topic";
    };
    type OpenDualValue = PublishTransportOperation<PrivateEnvelope> &
      TransportTopic & {
        readonly [key: string]: unknown;
        readonly dualRefinement: "dual";
      };

    const narrowPublish = (operation: PublishTransportOperation<PrivateEnvelope>): void => {
      if (operation.topic.signalKind === "command") {
        // @ts-expect-error a nested kind check does not narrow the complete operation union.
        expectTypeOf(operation.envelope).toEqualTypeOf<Command>();
      }
      if (isTransportOperationKind(operation, "command")) {
        expectTypeOf(operation.envelope).toEqualTypeOf<Command>();
      }
      if (isTransportOperationKind(operation, "system")) {
        expectTypeOf(operation.envelope).toEqualTypeOf<PrivateEnvelope>();
      }
    };
    const narrowRequest = (
      operation: RequestTransportOperation<PrivateEnvelope, "event" | "query">,
    ): void => {
      if (operation.topic.signalKind === "event") {
        // @ts-expect-error a nested kind check does not narrow the complete operation union.
        expectTypeOf(operation.envelope).toEqualTypeOf<Event>();
      }
      if (isTransportOperationKind(operation, "event")) {
        expectTypeOf(operation.envelope).toEqualTypeOf<Event>();
      }
      if (isTransportOperationKind(operation, "query")) {
        expectTypeOf(operation.envelope).toEqualTypeOf<PrivateEnvelope>();
      }
      // @ts-expect-error restricted operation kinds reject kinds outside their union.
      isTransportOperationKind(operation, "command");
    };
    const narrowTopic = (topic: TransportTopic): void => {
      if (topic.signalKind === "command") {
        // @ts-expect-error a nested kind check does not narrow the complete topic contract.
        expectTypeOf(topic.routing.signalKind).toEqualTypeOf<"command">();
      }
      if (isTransportTopicKind(topic, "command")) {
        expectTypeOf(topic.signalKind).toEqualTypeOf<"command">();
        expectTypeOf(topic.routing.signalKind).toEqualTypeOf<"command">();
      }
    };
    const rejectUnrelatedTopicKind = (topic: TransportTopic<"command" | "system">): void => {
      // @ts-expect-error restricted topic kinds reject kinds outside their union.
      isTransportTopicKind(topic, "event");
    };
    const rejectSubscription = (): void => {
      const subscription = createTransportSubscription({
        subscriberId: "projection-worker",
        topic: {
          signalKind: "event",
          messageTypeUrl: "type.spine.io/example.TaskCreated",
        },
      });

      // @ts-expect-error subscriptions are topic-only containers, not transport operations.
      isTransportOperationKind(subscription, "event");
    };
    const narrowOpenOperation = (operation: OpenPublishOperation): void => {
      if (isTransportOperationKind(operation, "command")) {
        expectTypeOf(operation.envelope).toEqualTypeOf<Command>();
        expectTypeOf(operation.operationRefinement).toEqualTypeOf<"open-operation">();
      }
    };
    const narrowOpenTopic = (topic: OpenTopic): void => {
      if (isTransportTopicKind(topic, "event")) {
        expectTypeOf(topic.signalKind).toEqualTypeOf<"event">();
        expectTypeOf(topic.routing.signalKind).toEqualTypeOf<"event">();
        expectTypeOf(topic.topicRefinement).toEqualTypeOf<"open-topic">();
      }
    };
    const narrowDualValue = (value: OpenDualValue): void => {
      if (isTransportOperationKind(value, "command")) {
        expectTypeOf(value.envelope).toEqualTypeOf<Command>();
        expectTypeOf(value.dualRefinement).toEqualTypeOf<"dual">();
      }
      if (isTransportTopicKind(value, "event")) {
        expectTypeOf(value.signalKind).toEqualTypeOf<"event">();
        expectTypeOf(value.routing.signalKind).toEqualTypeOf<"event">();
        expectTypeOf(value.dualRefinement).toEqualTypeOf<"dual">();
      }
    };

    void narrowPublish;
    void narrowRequest;
    void narrowTopic;
    void rejectUnrelatedTopicKind;
    void rejectSubscription;
    void narrowOpenOperation;
    void narrowOpenTopic;
    void narrowDualValue;
  });

  it("uses each fixed path for an open dual-shaped value without reading its envelope", () => {
    type OpenDualValue = PublishTransportOperation &
      TransportTopic & {
        readonly [key: string]: unknown;
        readonly dualRefinement: "dual";
      };
    const widenDualValue = (value: OpenDualValue): OpenDualValue => value;
    const eventTopic = createTransportTopic({
      signalKind: "event",
      messageTypeUrl: "type.spine.io/spine.core.Event",
    });
    const commandTopic = createTransportTopic({
      signalKind: "command",
      messageTypeUrl: "type.spine.io/spine.core.Command",
    });
    let envelopeReads = 0;
    const dualValue = widenDualValue(
      Object.freeze({
        ...eventTopic,
        topic: commandTopic,
        dualRefinement: "dual",
        get envelope(): Command {
          envelopeReads += 1;
          return create(CommandSchema);
        },
      }),
    );

    expect(isTransportOperationKind(dualValue, "command")).toBe(true);
    expect(isTransportOperationKind(dualValue, "event")).toBe(false);
    expect(isTransportTopicKind(dualValue, "event")).toBe(true);
    expect(isTransportTopicKind(dualValue, "command")).toBe(false);
    expect(envelopeReads).toBe(0);
  });

  it("classifies accepted topic and operation domains without inspecting envelopes", () => {
    const widenTopic = (value: TransportTopic) => value;
    const widenOperation = (value: PublishTransportOperation) => value;
    const commandTopic = createTransportTopic({
      signalKind: "command",
      messageTypeUrl: "type.spine.io/spine.core.Command",
    });
    const topic = widenTopic(commandTopic);
    let envelopeReads = 0;
    const command = create(CommandSchema);
    const operation = widenOperation(
      Object.freeze({
        topic: commandTopic,
        get envelope(): Command {
          envelopeReads += 1;
          return command;
        },
      }),
    );

    expect(isTransportTopicKind(topic, "command")).toBe(true);
    expect(isTransportTopicKind(topic, "event")).toBe(false);
    expect(isTransportOperationKind(operation, "command")).toBe(true);
    expect(isTransportOperationKind(operation, "event")).toBe(false);
    expect(envelopeReads).toBe(0);
    expect(operation.topic).toBe(topic);
    expect(Object.isFrozen(operation)).toBe(true);
    expect(Object.isFrozen(topic)).toBe(true);
  });
});
