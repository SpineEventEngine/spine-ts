import { InMemoryStorageFactory } from "@spine-ts/storage";
import { describe, expect, it, vi } from "vitest";

import type { ContextDeliveryDescriptor } from "../../src/context/bounded-context.js";
import {
  DeliveryReadiness,
  type DeliveryReady,
  type OnDeliveryReady,
} from "../../src/context/local-inbox-handoff.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import {
  EnvironmentAttachments,
  type EnvironmentGenerationWorker,
} from "../../src/server/environment-attachment.js";
import { ServerEnvironment, serverEnvironmentAccess } from "../../src/server/server-environment.js";

describe("ServerEnvironment close", () => {
  it("queues close behind an attach and refuses without permanent admission or facility teardown", async () => {
    const delivery = { close: vi.fn() };
    const attachStarted = Promise.withResolvers<undefined>();
    const releaseAttach = Promise.withResolvers<undefined>();
    const environment = ServerEnvironment.local({ delivery, ownsDelivery: true });
    const attaching = serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [gatedDescriptor(attachStarted, releaseAttach)],
    });
    await attachStarted.promise;
    const closing = environment.close();
    let closeSettled = false;
    void closing.then(
      () => {
        closeSettled = true;
      },
      () => {
        closeSettled = true;
      },
    );
    const queuedDescriptors = countedDescriptors();
    const queuedAttaching = serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: queuedDescriptors,
    });
    const queuedEnumerationsBeforeAdmission = queuedDescriptors.enumerations;

    await Promise.resolve();
    expect(closeSettled).toBe(false);
    releaseAttach.resolve(undefined);
    const attachment = await attaching;

    await expect(closing).rejects.toThrow("ServerEnvironment cannot close while it is in use.");

    expect(delivery.close).not.toHaveBeenCalled();
    const queuedAttachment = await queuedAttaching;
    expect(queuedEnumerationsBeforeAdmission).toBe(0);
    expect(queuedDescriptors.enumerations).toBe(1);
    await serverEnvironmentAccess.detach(environment, queuedAttachment);
    await serverEnvironmentAccess.detach(environment, attachment);
  });

  it("rejects a close-first queued direct attach before claim, descriptor, or worker work", async () => {
    const environment = ServerEnvironment.local();
    const descriptors = countedDescriptors();
    const stopping = serverEnvironmentAccess.stopDelivery(environment);
    const closing = environment.close();
    const attaching = serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors,
    });

    await expect(closing).resolves.toBeUndefined();
    await expect(attaching).rejects.toThrow("ServerEnvironment is closed.");
    await expect(stopping).resolves.toBeUndefined();
    expect(descriptors.enumerations).toBe(0);
  });

  it("admits close after last detach before a queued direct attach performs work", async () => {
    const detachStarted = Promise.withResolvers<undefined>();
    const releaseDetach = Promise.withResolvers<undefined>();
    const worker: EnvironmentGenerationWorker = {
      add() {
        // This test worker accepts the one configured delivery owner.
      },
      start(obligation, shards) {
        const progress = Object.freeze({
          runs: 1,
          processed: 0,
          accepted: 0,
          delivered: 0,
          failed: 0,
          failures: Object.freeze([]),
        });
        return Promise.resolve({
          obligation,
          shards: Object.freeze(
            shards.map((shard) => ({
              status: "fulfilled" as const,
              shard,
              obligation,
              run: Object.freeze({ status: "IDLE" as const, ...progress }),
              progress,
            })),
          ),
        });
      },
      stop() {
        // The detach gate is the subsequent settlement phase.
      },
      awaitSettled() {
        detachStarted.resolve(undefined);
        return releaseDetach.promise;
      },
      retire: () => Promise.resolve(),
      stopOwners() {
        // This race performs whole-generation retirement only.
      },
      awaitOwnersSettled: () => Promise.resolve(),
      retireOwners: () => Promise.resolve(),
    };
    let workerConstructions = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        workerConstructions += 1;
        return worker;
      },
    });
    const startupStarted = Promise.withResolvers<undefined>();
    const releaseStartup = Promise.withResolvers<undefined>();
    releaseStartup.resolve(undefined);
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [gatedDescriptor(startupStarted, releaseStartup)],
    });
    const detaching = attachments.detach(handle);
    await detachStarted.promise;
    const closing = attachments.admitPermanentClose();
    const coalescedClosing = attachments.admitPermanentClose();
    const descriptors = countedDescriptors();
    const attaching = attachments.attach({ ownership: "caller", descriptors });

    releaseDetach.resolve(undefined);
    await expect(detaching).resolves.toBeUndefined();
    await expect(closing).resolves.toBeUndefined();
    await expect(coalescedClosing).resolves.toBeUndefined();
    await expect(attaching).rejects.toThrow("ServerEnvironment is closed.");
    expect(coalescedClosing).toBe(closing);
    expect(descriptors.enumerations).toBe(0);
    expect(attachments.activeRegistrationCount).toBe(0);
    expect(workerConstructions).toBe(1);
  });

  it("permanently closes an owner-free environment and rejects later lifecycle admission", async () => {
    const delivery = { close: vi.fn() };
    const environment = ServerEnvironment.local({ delivery, ownsDelivery: true });
    const first = environment.close();

    expect(environment.close()).toBe(first);
    await first;

    expect(delivery.close).toHaveBeenCalledTimes(1);
    await expect(
      serverEnvironmentAccess.attach(environment, { ownership: "caller", descriptors: [] }),
    ).rejects.toThrow("ServerEnvironment is closed.");
    await expect(serverEnvironmentAccess.stopDelivery(environment)).rejects.toThrow(
      "ServerEnvironment is closed.",
    );
    await expect(serverEnvironmentAccess.retryDeliveryStop(environment)).rejects.toThrow(
      "ServerEnvironment is closed.",
    );
    await expect(environment.close()).resolves.toBeUndefined();
    expect(delivery.close).toHaveBeenCalledTimes(1);
  });

  it("cancels a close-first provisional stop and settles its waiter while facilities remain pending", async () => {
    const facility = Promise.withResolvers<undefined>();
    const closeStarted = Promise.withResolvers<undefined>();
    const environment = ServerEnvironment.local({
      delivery: {
        close() {
          closeStarted.resolve(undefined);
          return facility.promise;
        },
      },
      ownsDelivery: true,
    });
    const closing = environment.close();
    let closeSettled = false;
    void closing.then(
      () => {
        closeSettled = true;
      },
      () => {
        closeSettled = true;
      },
    );
    const stopping = serverEnvironmentAccess.stopDelivery(environment);
    const waiting = serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [],
    });

    await closeStarted.promise;
    expect(closeSettled).toBe(false);
    await expect(stopping).rejects.toThrow("ServerEnvironment is closed.");
    await expect(waiting).rejects.toThrow("ServerEnvironment is closed.");
    await expect(serverEnvironmentAccess.stopDelivery(environment)).rejects.toThrow(
      "ServerEnvironment is closed.",
    );
    await expect(serverEnvironmentAccess.retryDeliveryStop(environment)).rejects.toThrow(
      "ServerEnvironment is closed.",
    );
    expect(closeSettled).toBe(false);
    await expect(
      serverEnvironmentAccess.attach(environment, { ownership: "caller", descriptors: [] }),
    ).rejects.toThrow("ServerEnvironment is closed.");

    facility.resolve(undefined);
    await expect(closing).resolves.toBeUndefined();
  });

  it("leaves a completed stop-first no-generation operation to settle its waiter normally", async () => {
    const environment = ServerEnvironment.local();
    const stopping = serverEnvironmentAccess.stopDelivery(environment);
    const waiting = serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [],
    });
    const closing = environment.close();

    await expect(closing).resolves.toBeUndefined();
    await expect(waiting).rejects.toThrow("ServerEnvironment is closed.");
    await expect(stopping).resolves.toBeUndefined();
  });

  it(
    "refuses permanent admission for a retained failed start until its exact retry " +
      "clears the generation",
    async () => {
      const startFailure = new Error("failed start");
      const rollbackFailure = new Error("failed-start rollback did not quiesce");
      const worker = failedStartWorker(startFailure, rollbackFailure);
      const attachments = new EnvironmentAttachments({ createWorker: () => worker });

      await expect(
        attachments.attach({
          ownership: "caller",
          descriptors: [gatedDescriptor(Promise.withResolvers(), resolvedGate())],
        }),
      ).rejects.toBeInstanceOf(AggregateError);
      expect(attachments.activeRegistrationCount).toBe(0);
      expect([worker.stopCalls, worker.awaitCalls, worker.retireCalls]).toEqual([1, 1, 0]);

      await expect(attachments.admitPermanentClose()).rejects.toThrow(
        "Environment generation rollback requires an explicit retry.",
      );
      expect(attachments.activeRegistrationCount).toBe(0);
      expect([worker.stopCalls, worker.awaitCalls, worker.retireCalls]).toEqual([1, 1, 0]);

      await attachments.retryFailedStart();
      expect([worker.stopCalls, worker.awaitCalls, worker.retireCalls]).toEqual([1, 2, 1]);
      await expect(attachments.admitPermanentClose()).resolves.toBeUndefined();
    },
  );

  it("refuses close during an unsafe last detach without changing its retry owner", async () => {
    const quiescenceFailure = new Error("last detach did not quiesce");
    const worker = lifecycleWorker([quiescenceFailure]);
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [gatedDescriptor(Promise.withResolvers(), resolvedGate())],
    });

    const detaching = attachments.detach(handle);
    await expect(detaching).rejects.toThrow(
      "Delivery run coordinator could not establish quiescence.",
    );
    const beforeClose = [worker.stopCalls, worker.awaitCalls, worker.retireCalls] as const;

    await expect(attachments.admitPermanentClose()).rejects.toThrow(
      "ServerEnvironment cannot close while it is in use.",
    );
    expect([worker.stopCalls, worker.awaitCalls, worker.retireCalls]).toEqual(beforeClose);
    expect(attachments.activeRegistrationCount).toBe(1);

    await expect(attachments.retryDetach(handle)).resolves.toBeUndefined();
    await expect(attachments.admitPermanentClose()).resolves.toBeUndefined();
  });

  it("refuses close during an incomplete reusable stop without changing its retry owner", async () => {
    const transitionFailure = new Error("candidate transition failed");
    const oldWorker = lifecycleWorker();
    const candidateWorker = lifecycleWorker();
    const workers = [oldWorker, candidateWorker];
    let workerIndex = 0;
    let transferAttempts = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[workerIndex];
        workerIndex += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
      transitionFaults: {
        onScopeTransfer() {
          transferAttempts += 1;
          if (transferAttempts === 1) throw transitionFailure;
        },
      },
    });
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [gatedDescriptor(Promise.withResolvers(), resolvedGate())],
    });

    await expect(attachments.stopDelivery()).rejects.toBe(transitionFailure);
    const generation = handle.generation;
    const beforeClose = [
      oldWorker.stopCalls,
      oldWorker.awaitCalls,
      oldWorker.retireCalls,
      candidateWorker.stopCalls,
      candidateWorker.awaitCalls,
      candidateWorker.retireCalls,
    ] as const;

    await expect(attachments.admitPermanentClose()).rejects.toThrow(
      "ServerEnvironment cannot close while it is in use.",
    );
    expect(handle.generation).toBe(generation);
    expect(attachments.activeRegistrationCount).toBe(1);
    expect([
      oldWorker.stopCalls,
      oldWorker.awaitCalls,
      oldWorker.retireCalls,
      candidateWorker.stopCalls,
      candidateWorker.awaitCalls,
      candidateWorker.retireCalls,
    ]).toEqual(beforeClose);

    await expect(attachments.retryDeliveryStop()).resolves.toBeUndefined();
    await expect(attachments.admitPermanentClose()).rejects.toThrow(
      "ServerEnvironment cannot close while it is in use.",
    );
    await attachments.detach(handle);
    await expect(attachments.admitPermanentClose()).resolves.toBeUndefined();
  });
});

function gatedDescriptor(
  started: PromiseWithResolvers<undefined>,
  release: PromiseWithResolvers<undefined>,
): ContextDeliveryDescriptor {
  const readiness = new DeliveryReadiness();
  const ready: DeliveryReady = Object.freeze({
    label: "UPDATE_SUBSCRIBER",
    targetTypeUrl: "type.example.dev/EnvironmentCloseGate",
    shard: ShardIndex.single(),
  });

  return Object.freeze({
    storageFactory: new InMemoryStorageFactory(),
    async startupScopes() {
      started.resolve(undefined);
      await release.promise;
      return Object.freeze([Object.freeze({})]);
    },
    storageContext() {
      return Object.freeze({ name: "environment-close-gate", multitenant: false });
    },
    endpoints: () => Object.freeze([ready]),
    onReady: (onReady: OnDeliveryReady) => readiness.onReady(onReady),
    transition: (
      scopes: readonly DeliveryReady[],
      onReady: OnDeliveryReady,
      options?: { readonly allowEmpty?: boolean },
    ) => readiness.transition(scopes, onReady, options),
    replay: () => Promise.resolve(),
  });
}

function countedDescriptors(): readonly ContextDeliveryDescriptor[] & {
  readonly enumerations: number;
} {
  let enumerations = 0;
  return Object.freeze({
    get enumerations() {
      return enumerations;
    },
    [Symbol.iterator]() {
      enumerations += 1;
      return [][Symbol.iterator]();
    },
    length: 0,
  }) as unknown as readonly ContextDeliveryDescriptor[] & { readonly enumerations: number };
}

function resolvedGate(): PromiseWithResolvers<undefined> {
  const gate = Promise.withResolvers<undefined>();
  gate.resolve(undefined);
  return gate;
}

function failedStartWorker(
  startFailure: Error,
  rollbackFailure: Error,
): EnvironmentGenerationWorker & {
  readonly stopCalls: number;
  readonly awaitCalls: number;
  readonly retireCalls: number;
} {
  let awaitFailure: Error | undefined = rollbackFailure;
  let stopCalls = 0;
  let awaitCalls = 0;
  let retireCalls = 0;
  return {
    get stopCalls() {
      return stopCalls;
    },
    get awaitCalls() {
      return awaitCalls;
    },
    get retireCalls() {
      return retireCalls;
    },
    add() {
      // The failed worker has no observable ownership side effects for this admission test.
    },
    start(obligation, shards) {
      return Promise.resolve({
        obligation,
        shards: Object.freeze(
          shards.map((shard) =>
            Object.freeze({
              status: "rejected" as const,
              shard,
              obligation,
              cause: startFailure,
              progress: Object.freeze({
                runs: 1,
                processed: 0,
                accepted: 0,
                delivered: 0,
                failed: 1,
                failures: Object.freeze([startFailure]),
              }),
            }),
          ),
        ),
      });
    },
    stop() {
      stopCalls += 1;
    },
    awaitSettled() {
      awaitCalls += 1;
      const failure = awaitFailure;
      awaitFailure = undefined;
      return failure === undefined ? Promise.resolve() : Promise.reject(failure);
    },
    retire() {
      retireCalls += 1;
      return Promise.resolve();
    },
    stopOwners() {
      // Failed-start generation retirement is the only rollback path under test.
    },
    awaitOwnersSettled() {
      return Promise.resolve();
    },
    retireOwners() {
      return Promise.resolve();
    },
  };
}

function lifecycleWorker(awaitFailures: readonly Error[] = []): EnvironmentGenerationWorker & {
  readonly stopCalls: number;
  readonly awaitCalls: number;
  readonly retireCalls: number;
} {
  const failures = [...awaitFailures];
  let stopCalls = 0;
  let awaitCalls = 0;
  let retireCalls = 0;
  return {
    get stopCalls() {
      return stopCalls;
    },
    get awaitCalls() {
      return awaitCalls;
    },
    get retireCalls() {
      return retireCalls;
    },
    add() {
      // The focused close tests only observe lifecycle ownership through counters.
    },
    start(obligation, shards) {
      const progress = Object.freeze({
        runs: 1,
        processed: 0,
        accepted: 0,
        delivered: 0,
        failed: 0,
        failures: Object.freeze([]),
      });
      return Promise.resolve({
        obligation,
        shards: Object.freeze(
          shards.map((shard) =>
            Object.freeze({
              status: "fulfilled" as const,
              shard,
              obligation,
              run: Object.freeze({ status: "IDLE" as const, ...progress }),
              progress,
            }),
          ),
        ),
      });
    },
    stop() {
      stopCalls += 1;
    },
    awaitSettled() {
      awaitCalls += 1;
      const failure = failures.shift();
      return failure === undefined ? Promise.resolve() : Promise.reject(failure);
    },
    retire() {
      retireCalls += 1;
      return Promise.resolve();
    },
    stopOwners() {
      // These close tests only use generation-wide retirement.
    },
    awaitOwnersSettled() {
      return Promise.resolve();
    },
    retireOwners() {
      return Promise.resolve();
    },
  };
}
