import { describe, expect, expectTypeOf, it } from "vitest";

import {
  type AsyncCloseable,
  type PublishTransportHandler,
  type PublishTransportOperation,
  type RequestTransportHandler,
  type RequestTransportOperation,
  type SignalTransport,
  type TransportDeliveryAttempt,
  type TransportDeliveryAttemptInput,
  type TransportDeliveryFailureClassification,
  type TransportDeliveryResult,
  type TransportDeliveryResultInput,
  type TransportDeliveryStatus,
  type TransportLifecycleParticipant,
  type TransportLifecycleSnapshotInput,
  type TransportLifecycleState,
  type TransportParticipantIdentity,
  type TransportParticipantIdentityInput,
  type TransportReadinessState,
  type TransportSignalKind,
  type TransportWorkerRegistration,
  type TransportWorkerRegistrationInput,
  classifyTransportDeliveryFailure,
  createTransportDeliveryAttempt,
  createTransportDeliveryResult,
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

  it("creates delivery attempts from logical subscriptions and worker identities", () => {
    const attempt = createTransportDeliveryAttempt({
      deliveryId: "command-abc-123",
      targetId: "task-42",
      attemptNumber: 2,
      subscription: {
        subscriberId: "delivery-a",
        mode: "competing-consumer",
        topic: {
          signalKind: "delivery",
          messageTypeUrl: "type.spine.io/example.TaskDelivery",
          semanticTags: ["aggregate"],
        },
      },
      worker: {
        participantKind: "worker",
        participantId: "delivery-a",
        workerRole: "delivery-worker",
      },
    });

    expect(attempt).toEqual({
      deliveryId: "command-abc-123",
      targetId: "task-42",
      attemptNumber: 2,
      subscription: {
        subscriberId: "delivery-a",
        mode: "competing-consumer",
        topic: {
          signalKind: "delivery",
          messageTypeUrl: "type.spine.io/example.TaskDelivery",
          semanticTags: ["aggregate"],
          routing: {
            signalKind: "delivery",
            messageTypeUrl: "type.spine.io/example.TaskDelivery",
            semanticTags: ["aggregate"],
            routingKey: "delivery:type.spine.io%2Fexample.TaskDelivery:aggregate",
          },
        },
        descriptorKey:
          "delivery:type.spine.io%2Fexample.TaskDelivery:aggregate#competing-consumer#delivery-a",
      },
      worker: {
        participantKind: "worker",
        participantId: "delivery-a",
        participantKey: "worker#delivery-worker#delivery-a",
        workerRole: "delivery-worker",
      },
      attemptKey:
        "delivery:type.spine.io%2Fexample.TaskDelivery:aggregate#competing-consumer#delivery-a#worker#delivery-worker#delivery-a#command-abc-123#task-42#2",
    });
    expect(attempt).not.toHaveProperty("endpoint");
    expect(attempt).not.toHaveProperty("socketType");
    expect(attempt).not.toHaveProperty("inboxRecord");
    expect(Object.isFrozen(attempt)).toBe(true);
  });

  it("rejects forged delivery attempt keys and mismatched delivery workers", () => {
    const attempt = createTransportDeliveryAttempt({
      deliveryId: "command-abc-123",
      targetId: "task-42",
      attemptNumber: 1,
      subscription: {
        subscriberId: "delivery-a",
        topic: {
          signalKind: "delivery",
          messageTypeUrl: "type.spine.io/example.TaskDelivery",
        },
      },
      worker: {
        participantKind: "worker",
        participantId: "delivery-a",
        workerRole: "delivery-worker",
      },
    });

    expect(() =>
      createTransportDeliveryAttempt({
        ...attempt,
        attemptKey: "forged",
      }),
    ).toThrow(/attemptKey/);
    expect(() =>
      createTransportDeliveryAttempt({
        deliveryId: "command-abc-123",
        targetId: "task-42",
        attemptNumber: 1,
        subscription: {
          subscriberId: "delivery-a",
          topic: {
            signalKind: "delivery",
            messageTypeUrl: "type.spine.io/example.TaskDelivery",
          },
        },
        worker: {
          participantKind: "worker",
          participantId: "delivery-b",
          workerRole: "delivery-worker",
        },
      }),
    ).toThrow(/must match subscription subscriberId/);
    expect(() =>
      createTransportDeliveryAttempt({
        deliveryId: "command-abc-123",
        targetId: "task-42",
        attemptNumber: Number.MAX_SAFE_INTEGER + 1,
        subscription: {
          subscriberId: "delivery-a",
          topic: {
            signalKind: "delivery",
            messageTypeUrl: "type.spine.io/example.TaskDelivery",
          },
        },
        worker: {
          participantKind: "worker",
          participantId: "delivery-a",
          workerRole: "delivery-worker",
        },
      }),
    ).toThrow(/safe positive integer/);
  });

  it("classifies delivery failures with retry eligibility and allowlisted details", () => {
    const failure = classifyTransportDeliveryFailure({
      failureKind: "transient",
      failureCode: "TEMPORARY_STORAGE_UNAVAILABLE",
      details: {
        stage: "pickup",
        attempt: 3,
        retryable: true,
        reason: "temporary backpressure",
        code: "BACKPRESSURE",
        endpoint: "ipc://leaked",
        errorMessage: "database password leaked",
        stackTrace: "process stack",
        endpointUrl: "ipc://leaked",
        socketPath: "/tmp/leaked.sock",
        payloadPreview: "raw payload bytes",
        host: "internal-host",
        message: "contains payload bytes",
        nested: { payload: "secret" },
        stack: "process stack",
        processId: 12345,
      },
    });
    const duplicate = classifyTransportDeliveryFailure({
      failureKind: "duplicate",
      failureCode: "DUPLICATE_DELIVERY",
      details: new Error("raw runtime error"),
    });

    expect(failure).toEqual({
      failureKind: "transient",
      retryEligibility: "eligible",
      failureCode: "TEMPORARY_STORAGE_UNAVAILABLE",
      details: {
        attempt: 3,
        code: "BACKPRESSURE",
        reason: "temporary backpressure",
        retryable: true,
        stage: "pickup",
      },
    });
    expect(duplicate).toEqual({
      failureKind: "duplicate",
      retryEligibility: "ineligible",
      failureCode: "DUPLICATE_DELIVERY",
      details: {},
    });
    expect(failure.details).not.toHaveProperty("endpoint");
    expect(failure.details).not.toHaveProperty("errorMessage");
    expect(failure.details).not.toHaveProperty("stackTrace");
    expect(failure.details).not.toHaveProperty("endpointUrl");
    expect(failure.details).not.toHaveProperty("socketPath");
    expect(failure.details).not.toHaveProperty("payloadPreview");
    expect(failure.details).not.toHaveProperty("host");
    expect(failure.details).not.toHaveProperty("message");
    expect(failure.details).not.toHaveProperty("stack");
    expect(failure).not.toHaveProperty("error");
    expect(Object.isFrozen(failure)).toBe(true);
    expect(Object.isFrozen(failure.details)).toBe(true);
  });

  it("derives delivery result status from retry boundary data", () => {
    const attempt = createTransportDeliveryAttempt({
      deliveryId: "command-abc-123",
      targetId: "task-42",
      attemptNumber: 1,
      subscription: {
        subscriberId: "delivery-a",
        topic: {
          signalKind: "delivery",
          messageTypeUrl: "type.spine.io/example.TaskDelivery",
        },
      },
      worker: {
        participantKind: "worker",
        participantId: "delivery-a",
        workerRole: "delivery-worker",
      },
    });
    const retryableResult = createTransportDeliveryResult({
      attempt,
      outcome: "failed",
      failure: {
        failureKind: "transient",
        failureCode: "TEMPORARY_STORAGE_UNAVAILABLE",
      },
    });
    const terminalResult = createTransportDeliveryResult({
      attempt,
      outcome: "failed",
      failure: {
        failureKind: "permanent",
        failureCode: "MALFORMED_ENVELOPE",
        details: { stage: "decode" },
      },
    });
    const deliveredResult = createTransportDeliveryResult({
      attempt,
      outcome: "delivered",
    });

    expect(retryableResult.status).toBe("failed");
    expect(retryableResult.retryEligibility).toBe("eligible");
    expect(terminalResult.status).toBe("failed");
    expect(terminalResult.retryEligibility).toBe("ineligible");
    expect(deliveredResult).toEqual({
      attempt,
      outcome: "delivered",
      status: "delivered",
      retryEligibility: "ineligible",
      resultKey: `${attempt.attemptKey}#delivered`,
    });
    expect(() =>
      createTransportDeliveryResult({
        attempt,
        outcome: "failed",
        status: "delivered" as never,
        failure: {
          failureKind: "transient",
          failureCode: "TEMPORARY_STORAGE_UNAVAILABLE",
        },
      }),
    ).toThrow(/status/);
    expect(() =>
      createTransportDeliveryResult({
        attempt,
        outcome: "delivered",
        failure: {
          failureKind: "transient",
          failureCode: "TEMPORARY_STORAGE_UNAVAILABLE",
        } as never,
      }),
    ).toThrow(/must not include failure/);
    expect(retryableResult).not.toHaveProperty("retryTimer");
    expect(retryableResult).not.toHaveProperty("workerSchedule");
    expect(Object.isFrozen(retryableResult)).toBe(true);
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

  it("keeps simple logical ids valid", () => {
    expect(() =>
      createTransportSubscription({
        subscriberId: "projection_worker",
        topic: {
          signalKind: "query",
          messageTypeUrl: "type.spine.io/example.TaskById",
        },
      }),
    ).not.toThrow();
    expect(() =>
      createTransportParticipantIdentity({
        participantKind: "worker",
        participantId: "worker01",
        workerRole: "projection-worker",
      }),
    ).not.toThrow();
  });

  it("rejects endpoint-shaped, path-shaped, host-shaped, pid-only, and dotted logical ids", () => {
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
        participantKind: "sidecar" as never,
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
    expectTypeOf<TransportWorkerRegistrationInput["worker"]>().toEqualTypeOf<
      TransportParticipantIdentityInput<"worker">
    >();
    expectTypeOf<TransportDeliveryStatus>().toEqualTypeOf<
      "to-deliver" | "delivered" | "failed"
    >();
    expectTypeOf<TransportDeliveryAttemptInput["attemptNumber"]>().toEqualTypeOf<number>();
    expectTypeOf<TransportDeliveryAttempt>().toExtend<{
      readonly attemptKey: string;
      readonly subscription: object;
      readonly worker: object;
    }>();
    expectTypeOf<TransportDeliveryFailureClassification>().toExtend<{
      readonly retryEligibility: "eligible" | "ineligible";
      readonly details: Readonly<Record<string, string | number | boolean | null>>;
    }>();
    expectTypeOf<TransportDeliveryResult>().toExtend<{
      readonly attempt: TransportDeliveryAttempt;
      readonly status: TransportDeliveryStatus;
      readonly resultKey: string;
    }>();
    expectTypeOf<TransportDeliveryResultInput>().toExtend<
      | {
          readonly outcome: "delivered";
          readonly failure?: never;
        }
      | {
          readonly outcome: "failed";
          readonly failure:
            | TransportDeliveryFailureClassification
            | Parameters<typeof classifyTransportDeliveryFailure>[0];
        }
    >();
    expectTypeOf<TransportLifecycleSnapshotInput<"broker">["participant"]>().toEqualTypeOf<
      TransportParticipantIdentityInput<"broker">
    >();
    expectTypeOf<TransportLifecycleSnapshotInput<"worker">["participant"]>().toEqualTypeOf<
      TransportParticipantIdentityInput<"worker">
    >();
    expectTypeOf<TransportLifecycleParticipant>().toExtend<AsyncCloseable>();
    expectTypeOf<TransportLifecycleParticipant["state"]>().toEqualTypeOf<TransportLifecycleState>();
    expectTypeOf<
      TransportLifecycleParticipant["readiness"]
    >().toEqualTypeOf<TransportReadinessState>();
  });
});

const deliveryAttemptInputForTypeTests = {
  deliveryId: "command-abc-123",
  targetId: "task-42",
  attemptNumber: 1,
  subscription: {
    subscriberId: "delivery-a",
    topic: {
      signalKind: "delivery",
      messageTypeUrl: "type.spine.io/example.TaskDelivery",
    },
  },
  worker: {
    participantKind: "worker",
    participantId: "delivery-a",
    workerRole: "delivery-worker",
  },
} as const satisfies TransportDeliveryAttemptInput<"delivery">;

const deliveredResultInputForTypeTest = {
  attempt: deliveryAttemptInputForTypeTests,
  outcome: "delivered",
} as const satisfies TransportDeliveryResultInput<"delivery">;

const failedResultInputForTypeTest = {
  attempt: deliveryAttemptInputForTypeTests,
  outcome: "failed",
  failure: {
    failureKind: "transient",
    failureCode: "TEMPORARY_STORAGE_UNAVAILABLE",
  },
} as const satisfies TransportDeliveryResultInput<"delivery">;

const brokerIdentityInputForTypeTest = {
  participantKind: "broker",
  participantId: "broker-a",
} as const satisfies TransportParticipantIdentityInput<"broker">;

const workerIdentityInputForTypeTest = {
  participantKind: "worker",
  participantId: "delivery-a",
  workerRole: "delivery-worker",
} as const satisfies TransportParticipantIdentityInput<"worker">;

void deliveredResultInputForTypeTest;
void failedResultInputForTypeTest;
void brokerIdentityInputForTypeTest;
void workerIdentityInputForTypeTest;

const deliveredResultInputWithFailureForTypeTest: TransportDeliveryResultInput<"delivery"> = {
  attempt: deliveryAttemptInputForTypeTests,
  outcome: "delivered",
  failure: {
    // @ts-expect-error delivered results must not carry failure data.
    failureKind: "transient",
    failureCode: "TEMPORARY_STORAGE_UNAVAILABLE",
  },
};

// @ts-expect-error failed results must carry failure data.
const failedResultInputWithoutFailureForTypeTest: TransportDeliveryResultInput<"delivery"> = {
  attempt: deliveryAttemptInputForTypeTests,
  outcome: "failed",
};

const brokerIdentityInputWithWorkerRoleForTypeTest: TransportParticipantIdentityInput<"broker"> = {
  participantKind: "broker",
  participantId: "broker-a",
  // @ts-expect-error broker identity inputs must not declare workerRole.
  workerRole: "system-worker",
};

// @ts-expect-error worker identity inputs must declare workerRole.
const workerIdentityInputWithoutWorkerRoleForTypeTest: TransportParticipantIdentityInput<"worker"> =
  {
    participantKind: "worker",
    participantId: "delivery-a",
  };

void deliveredResultInputWithFailureForTypeTest;
void failedResultInputWithoutFailureForTypeTest;
void brokerIdentityInputWithWorkerRoleForTypeTest;
void workerIdentityInputWithoutWorkerRoleForTypeTest;
