import { describe, expect, expectTypeOf, it } from "vitest";

import {
  type AsyncCloseable,
  type PublishTransportHandler,
  type PublishTransportOperation,
  type RequestTransportHandler,
  type RequestTransportOperation,
  type SignalTransport,
  type TransportLifecycleParticipant,
  type TransportLifecycleState,
  type TransportParticipantIdentity,
  type TransportParticipantIdentityInput,
  type TransportReadinessState,
  type TransportSignalKind,
  type TransportWorkerRegistration,
  createTransportParticipantIdentity,
  createTransportSubscription,
  createTransportLifecycleSnapshot,
  createTransportWorkerRegistration,
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

  it("creates stable broker and worker participant identities", () => {
    const broker = createTransportParticipantIdentity({
      participantKind: "broker",
      participantId: " local-broker ",
    });
    const worker = createTransportParticipantIdentity({
      participantKind: "worker",
      participantId: " projections ",
      workerRole: "projection-worker",
    });

    expect(broker).toEqual({
      participantKind: "broker",
      participantId: "local-broker",
      participantKey: "broker#local-broker",
    });
    expect(worker).toEqual({
      participantKind: "worker",
      participantId: "projections",
      participantKey: "worker#projection-worker#projections",
      workerRole: "projection-worker",
    });
    expect(broker).not.toHaveProperty("endpoint");
    expect(worker).not.toHaveProperty("socketType");
    expect(worker).not.toHaveProperty("processId");
    expect(Object.isFrozen(broker)).toBe(true);
    expect(Object.isFrozen(worker)).toBe(true);
  });

  it("creates deterministic worker registrations from transport subscriptions", () => {
    const registration = createTransportWorkerRegistration({
      worker: {
        participantKind: "worker",
        participantId: "projection-a",
        workerRole: "projection-worker",
      },
      subscriptions: [
        {
          subscriberId: "projection-a",
          topic: {
            signalKind: "event",
            messageTypeUrl: "type.spine.io/example.TaskCreated",
            semanticTags: ["projection", "tasks"],
          },
        },
        {
          subscriberId: "projection-a",
          mode: "competing-consumer",
          topic: {
            signalKind: "subscription",
            messageTypeUrl: "type.spine.io/example.TaskWatch",
          },
        },
      ],
    });

    expect(registration).toEqual({
      worker: {
        participantKind: "worker",
        participantId: "projection-a",
        participantKey: "worker#projection-worker#projection-a",
        workerRole: "projection-worker",
      },
      subscriptions: [
        {
          subscriberId: "projection-a",
          mode: "fan-out",
          topic: {
            signalKind: "event",
            messageTypeUrl: "type.spine.io/example.TaskCreated",
            semanticTags: ["projection", "tasks"],
            routing: {
              signalKind: "event",
              messageTypeUrl: "type.spine.io/example.TaskCreated",
              semanticTags: ["projection", "tasks"],
              routingKey: "event:type.spine.io%2Fexample.TaskCreated:projection,tasks",
            },
          },
          descriptorKey:
            "event:type.spine.io%2Fexample.TaskCreated:projection,tasks#fan-out#projection-a",
        },
        {
          subscriberId: "projection-a",
          mode: "competing-consumer",
          topic: {
            signalKind: "subscription",
            messageTypeUrl: "type.spine.io/example.TaskWatch",
            semanticTags: [],
            routing: {
              signalKind: "subscription",
              messageTypeUrl: "type.spine.io/example.TaskWatch",
              semanticTags: [],
              routingKey: "subscription:type.spine.io%2Fexample.TaskWatch",
            },
          },
          descriptorKey:
            "subscription:type.spine.io%2Fexample.TaskWatch#competing-consumer#projection-a",
        },
      ],
      signalKinds: ["event", "subscription"],
      registrationKey:
        "worker#projection-worker#projection-a#event:type.spine.io%2Fexample.TaskCreated:projection,tasks#fan-out#projection-a|subscription:type.spine.io%2Fexample.TaskWatch#competing-consumer#projection-a",
    });
    expect(registration.subscriptions[0]).not.toHaveProperty("frames");
    expect(registration).not.toHaveProperty("retries");
    expect(Object.isFrozen(registration)).toBe(true);
  });

  it("rebuilds lifecycle value objects from semantic fields and sorts worker subscriptions", () => {
    const rebuilt = createTransportWorkerRegistration({
      worker: {
        participantKind: "worker",
        participantId: "projection-a",
        participantKey: "worker#tampered",
        workerRole: "projection-worker",
      },
      subscriptions: [
        {
          descriptorKey: "tampered-z",
          mode: "competing-consumer",
          subscriberId: "projection-a",
          topic: {
            signalKind: "subscription",
            messageTypeUrl: "type.spine.io/example.TaskWatch",
            semanticTags: [],
            routing: {
              signalKind: "subscription",
              messageTypeUrl: "type.spine.io/example.TaskWatch",
              routingKey: "tampered",
              semanticTags: [],
            },
          },
        },
        {
          descriptorKey: "tampered-a",
          mode: "fan-out",
          subscriberId: "projection-a",
          topic: {
            signalKind: "event",
            messageTypeUrl: "type.spine.io/example.TaskCreated",
            semanticTags: ["projection"],
            routing: {
              signalKind: "event",
              messageTypeUrl: "type.spine.io/example.TaskCreated",
              routingKey: "tampered",
              semanticTags: ["projection"],
            },
          },
        },
      ],
    });

    expect(rebuilt.worker.participantKey).toBe("worker#projection-worker#projection-a");
    expect(rebuilt.subscriptions.map((subscription) => subscription.descriptorKey)).toEqual([
      "event:type.spine.io%2Fexample.TaskCreated:projection#fan-out#projection-a",
      "subscription:type.spine.io%2Fexample.TaskWatch#competing-consumer#projection-a",
    ]);
    expect(rebuilt.registrationKey).toBe(
      "worker#projection-worker#projection-a#event:type.spine.io%2Fexample.TaskCreated:projection#fan-out#projection-a|subscription:type.spine.io%2Fexample.TaskWatch#competing-consumer#projection-a",
    );
  });

  it("creates lifecycle snapshots with validated readiness and worker registrations", () => {
    const workerRegistration = createTransportWorkerRegistration({
      worker: {
        participantKind: "worker",
        participantId: "projection-a",
        workerRole: "projection-worker",
      },
      subscriptions: [
        {
          subscriberId: "projection-a",
          topic: {
            signalKind: "event",
            messageTypeUrl: "type.spine.io/example.TaskCreated",
          },
        },
      ],
    });
    const snapshot = createTransportLifecycleSnapshot({
      participant: workerRegistration.worker,
      state: "running",
      readiness: "ready",
      workerRegistrations: [workerRegistration],
    });

    expect(snapshot).toEqual({
      participant: {
        participantKind: "worker",
        participantId: "projection-a",
        participantKey: "worker#projection-worker#projection-a",
        workerRole: "projection-worker",
      },
      state: "running",
      readiness: "ready",
      workerRegistrations: [workerRegistration],
    });
    expect(snapshot).not.toHaveProperty("brokerEndpoint");
    expect(snapshot).not.toHaveProperty("childProcess");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.workerRegistrations)).toBe(true);
  });

  it("normalizes lifecycle snapshots from broker inputs without worker registrations", () => {
    const snapshot = createTransportLifecycleSnapshot({
      participant: {
        participantKind: "broker",
        participantId: " broker-a ",
      },
      state: "created",
      readiness: "pending",
    });

    expect(snapshot).toEqual({
      participant: {
        participantKind: "broker",
        participantId: "broker-a",
        participantKey: "broker#broker-a",
      },
      state: "created",
      readiness: "pending",
      workerRegistrations: [],
    });
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

  it("rejects endpoint-shaped, path-shaped, host-shaped, and pid-only logical ids", () => {
    const invalidIds = [
      "ipc://broker",
      "tcp://127.0.0.1:5555",
      "/tmp/worker",
      "worker@host",
      "12345",
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

      expect(() =>
        createTransportParticipantIdentity({
          participantKind: "worker",
          participantId: invalidId,
          workerRole: "projection-worker",
        }),
      ).toThrow(/logical-name format/);
    }
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

  it("rejects invalid lifecycle participant and snapshot combinations", () => {
    expect(() =>
      createTransportParticipantIdentity({
        participantKind: "broker",
        participantId: "broker-a",
        workerRole: "system-worker" as never,
      }),
    ).toThrow(/must not declare workerRole/);

    expect(() =>
      createTransportParticipantIdentity({
        participantKind: "sidecar" as TransportParticipantIdentityInput["participantKind"],
        participantId: "broker-a",
      }),
    ).toThrow(/participantKind/);

    expect(() =>
      createTransportParticipantIdentity({
        participantKind: "worker",
        participantId: "worker-a",
        workerRole: "queue-pump" as never,
      }),
    ).toThrow(/workerRole/);

    expect(() =>
      createTransportWorkerRegistration({
        worker: createTransportParticipantIdentity({
          participantKind: "broker",
          participantId: "broker-a",
        }) as never,
        subscriptions: [
          {
            subscriberId: "broker-a",
            topic: {
              signalKind: "event",
              messageTypeUrl: "type.spine.io/example.TaskCreated",
            },
          },
        ],
      }),
    ).toThrow(/must be a worker participant/);

    expect(() =>
      createTransportWorkerRegistration({
        worker: {
          participantKind: "worker",
          participantId: "projection-a",
          workerRole: "projection-worker",
        },
        subscriptions: [],
      }),
    ).toThrow(/subscriptions/);

    expect(() =>
      createTransportWorkerRegistration({
        worker: {
          participantKind: "worker",
          participantId: "projection-a",
          workerRole: "projection-worker",
        },
        subscriptions: [
          {
            subscriberId: "projection-b",
            topic: {
              signalKind: "event",
              messageTypeUrl: "type.spine.io/example.TaskCreated",
            },
          },
        ],
      }),
    ).toThrow(/must use the worker participantId as subscriberId/);

    expect(() =>
      createTransportLifecycleSnapshot({
        participant: createTransportParticipantIdentity({
          participantKind: "broker",
          participantId: "broker-a",
        }),
        state: "running",
        readiness: "ready",
        workerRegistrations: [
          createTransportWorkerRegistration({
            worker: {
              participantKind: "worker",
              participantId: "projection-a",
              workerRole: "projection-worker",
            },
            subscriptions: [
              {
                subscriberId: "projection-a",
                topic: {
                  signalKind: "event",
                  messageTypeUrl: "type.spine.io/example.TaskCreated",
                },
              },
            ],
          }),
        ],
      }),
    ).toThrow(/brokers must not include worker registrations/);

    expect(() =>
      createTransportLifecycleSnapshot({
        participant: {
          participantKind: "worker",
          participantId: "projection-a",
          workerRole: "projection-worker",
        },
        state: "steady" as TransportLifecycleState,
        readiness: "pending",
      }),
    ).toThrow(/state/);

    expect(() =>
      createTransportLifecycleSnapshot({
        participant: {
          participantKind: "worker",
          participantId: "projection-a",
          workerRole: "projection-worker",
        },
        state: "running",
        readiness: "warming" as TransportReadinessState,
      }),
    ).toThrow(/readiness/);

    expect(() =>
      createTransportLifecycleSnapshot({
        participant: createTransportParticipantIdentity({
          participantKind: "worker",
          participantId: "projection-a",
          workerRole: "projection-worker",
        }),
        state: "created",
        readiness: "ready",
      }),
    ).toThrow(/ready participants must be running/);

    expect(() =>
      createTransportLifecycleSnapshot({
        participant: createTransportParticipantIdentity({
          participantKind: "worker",
          participantId: "projection-a",
          workerRole: "projection-worker",
        }),
        state: "closed",
        readiness: "ready",
      }),
    ).toThrow(/ready participants must be running/);

    expect(() =>
      createTransportLifecycleSnapshot({
        participant: createTransportParticipantIdentity({
          participantKind: "worker",
          participantId: "projection-a",
          workerRole: "projection-worker",
        }),
        state: "running",
        readiness: "ready",
      }),
    ).toThrow(/must include at least one worker registration/);

    expect(() =>
      createTransportLifecycleSnapshot({
        participant: createTransportParticipantIdentity({
          participantKind: "worker",
          participantId: "projection-a",
          workerRole: "projection-worker",
        }),
        state: "running",
        readiness: "pending",
        workerRegistrations: [
          createTransportWorkerRegistration({
            worker: {
              participantKind: "worker",
              participantId: "projection-b",
              workerRole: "projection-worker",
            },
            subscriptions: [
              {
                subscriberId: "projection-b",
                topic: {
                  signalKind: "event",
                  messageTypeUrl: "type.spine.io/example.TaskCreated",
                },
              },
            ],
          }),
        ],
      }),
    ).toThrow(/worker registration participant must match snapshot participant/);
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
    expectTypeOf<TransportParticipantIdentity>().toExtend<{
      readonly participantKind: "broker" | "worker";
      readonly participantId: string;
      readonly participantKey: string;
    }>();
    expectTypeOf<TransportWorkerRegistration>().toExtend<{
      readonly worker: object;
      readonly subscriptions: readonly object[];
      readonly signalKinds: readonly TransportSignalKind[];
      readonly registrationKey: string;
    }>();
    expectTypeOf<TransportLifecycleParticipant>().toExtend<AsyncCloseable>();
    expectTypeOf<TransportLifecycleParticipant["state"]>().toEqualTypeOf<TransportLifecycleState>();
    expectTypeOf<
      TransportLifecycleParticipant["readiness"]
    >().toEqualTypeOf<TransportReadinessState>();
  });
});
