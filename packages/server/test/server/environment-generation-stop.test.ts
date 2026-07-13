import { InMemoryStorageFactory } from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import type { ContextDeliveryDescriptor } from "../../src/context/bounded-context.js";
import { DeliveryReadiness, type DeliveryReady } from "../../src/context/local-inbox-handoff.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import type { DeliveryRunObligation } from "../../src/delivery/delivery-run-coordinator.js";
import type { DeliveryWorkerEvidence } from "../../src/delivery/delivery-worker.js";
import {
  EnvironmentAttachments,
  type EnvironmentGenerationWorker,
} from "../../src/server/environment-attachment.js";
import type { EnvironmentDeliveryRuntime } from "../../src/server/environment-delivery-worker.js";
import { ServerEnvironment, serverEnvironmentAccess } from "../../src/server/server-environment.js";

describe("environment generation stop", () => {
  it("admits a queued attachment before selecting stop survivors", async () => {
    const oldWorker = new ControlledWorker([], "queued-old");
    const candidateWorker = new ControlledWorker([], "queued-candidate");
    const candidateGate = Promise.withResolvers<void>();
    candidateWorker.gates.push(candidateGate.promise);
    const workers = [oldWorker, candidateWorker];
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
    });
    const target = descriptor(
      "QueuedAttach",
      "type.example.dev/QueuedAttach",
      new InMemoryStorageFactory(),
    );

    const attaching = attachments.attach({ ownership: "caller", descriptors: [target.value] });
    const stopping = attachments.stopDelivery();
    let stopSettled = false;
    void stopping.then(() => {
      stopSettled = true;
    });
    const handle = await attaching;
    const oldGeneration = handle.generation;
    await Promise.resolve();

    expect(stopSettled).toBe(false);
    await until(() => candidateWorker.starts === 1);
    expect(handle.generation).toBe(oldGeneration);
    candidateGate.resolve();
    await stopping;
    expect(handle.generation).not.toBe(oldGeneration);
    expect(factoryCalls).toBe(2);
    await attachments.detach(handle);
  });

  it("serially refuses a queued stop after unsafe last detach takes recovery ownership", async () => {
    const worker = new ControlledWorker([], "queued-detach");
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const target = descriptor(
      "QueuedDetach",
      "type.example.dev/QueuedDetach",
      new InMemoryStorageFactory(),
    );
    const handle = await attachments.attach({ ownership: "caller", descriptors: [target.value] });
    worker.awaitFailures.push(new Error("queued detach quiescence failed"));

    const detaching = attachments.detach(handle);
    const stopping = attachments.stopDelivery();
    await expect(detaching).rejects.toBeDefined();
    await expect(stopping).rejects.toThrow(
      "Environment generation detach requires an explicit retry.",
    );
    expect(worker.retireCalls).toBe(0);

    await attachments.retryDetach(handle);
    await expect(attachments.stopDelivery()).resolves.toBeUndefined();
  });

  it("refuses stop while rejected non-last detach owns a live registration", async () => {
    const oldWorker = new ControlledWorker([], "non-last-old");
    const candidateWorker = new ControlledWorker([], "non-last-candidate");
    const workers = [oldWorker, candidateWorker];
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
    });
    const storage = new InMemoryStorageFactory();
    const first = descriptor("NonLastFirst", "type.example.dev/NonLastFirst", storage);
    const second = descriptor("NonLastSecond", "type.example.dev/NonLastSecond", storage);
    const firstHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [first.value],
    });
    const secondHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [second.value],
    });
    const oldGeneration = secondHandle.generation;
    oldWorker.awaitOwnerFailures.push(new Error("non-last detach quiescence failed"));

    await expect(attachments.detach(firstHandle)).rejects.toThrow(
      "non-last detach quiescence failed",
    );
    expect(attachments.activeRegistrationCount).toBe(2);
    const generationRetirementCalls = [
      oldWorker.stopCalls,
      oldWorker.awaitCalls,
      oldWorker.retireCalls,
    ];

    await expect(attachments.stopDelivery()).rejects.toThrow(
      "Environment generation detach requires an explicit retry.",
    );
    expect(attachments.activeRegistrationCount).toBe(2);
    expect(factoryCalls).toBe(1);
    expect([oldWorker.stopCalls, oldWorker.awaitCalls, oldWorker.retireCalls]).toEqual(
      generationRetirementCalls,
    );
    second.readiness.claim(second.ready);
    await until(() => second.notifications === 1);

    await attachments.retryDetach(firstHandle);
    expect(attachments.activeRegistrationCount).toBe(1);
    await attachments.stopDelivery();
    expect(secondHandle.generation).not.toBe(oldGeneration);
    expect(factoryCalls).toBe(2);
    await attachments.detach(secondHandle);
  });

  it("retries one retained stop after candidate construction fails without repeating old retirement", async () => {
    const events: string[] = [];
    const oldWorker = new ControlledWorker(events, "old");
    const candidateWorker = new ControlledWorker(events, "candidate");
    const constructionFailure = new Error("candidate construction failed");
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        factoryCalls += 1;
        if (factoryCalls === 1) return oldWorker;
        if (factoryCalls === 2) throw constructionFailure;
        if (factoryCalls === 3) return candidateWorker;
        throw new Error("Unexpected generation worker.");
      },
    });
    const storage = new InMemoryStorageFactory();
    const first = descriptor("RetryFirst", "type.example.dev/RetryFirst", storage);
    const second = descriptor("RetrySecond", "type.example.dev/RetrySecond", storage);
    const firstHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [first.value],
    });
    const secondHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [second.value],
    });

    const initial = attachments.stopDelivery();
    await expect(initial).rejects.toBe(constructionFailure);
    const retiredBeforeRetry = [oldWorker.stopCalls, oldWorker.awaitCalls, oldWorker.retireCalls];
    const oldGeneration = firstHandle.generation;
    await expect(attachments.detach(firstHandle)).rejects.toThrow(
      "Environment delivery stop requires an explicit retry.",
    );
    await expect(attachments.retryDetach(firstHandle)).rejects.toThrow(
      "Environment delivery stop requires an explicit retry.",
    );
    expect(attachments.activeRegistrationCount).toBe(2);
    expect(firstHandle.generation).toBe(oldGeneration);
    expect(secondHandle.generation).toBe(oldGeneration);
    await expect(attachments.stopDelivery()).rejects.toThrow(
      "Environment delivery stop requires an explicit retry.",
    );
    expect([oldWorker.stopCalls, oldWorker.awaitCalls, oldWorker.retireCalls]).toEqual(
      retiredBeforeRetry,
    );
    expect(factoryCalls).toBe(2);
    const retry = attachments.retryDeliveryStop();
    expect(attachments.retryDeliveryStop()).toBe(retry);
    await retry;

    expect(oldWorker.stopCalls).toBe(1);
    expect(oldWorker.awaitCalls).toBe(1);
    expect(oldWorker.retireCalls).toBe(1);
    expect(factoryCalls).toBe(3);
    expect(firstHandle.generation).toBe(secondHandle.generation);
    await attachments.detach(firstHandle);
    await attachments.detach(secondHandle);
  });

  it("retains a queued detach while a rejected stop owns its frozen survivor", async () => {
    const oldWorker = new ControlledWorker([], "queued-stop-old");
    const candidateWorker = new ControlledWorker([], "queued-stop-candidate");
    const constructionFailure = new Error("queued candidate construction failed");
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        factoryCalls += 1;
        if (factoryCalls === 1) return oldWorker;
        if (factoryCalls === 2) throw constructionFailure;
        if (factoryCalls === 3) return candidateWorker;
        throw new Error("Unexpected generation worker.");
      },
    });
    const storage = new InMemoryStorageFactory();
    const first = descriptor("QueuedStopFirst", "type.example.dev/QueuedStopFirst", storage);
    const second = descriptor("QueuedStopSecond", "type.example.dev/QueuedStopSecond", storage);
    const firstHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [first.value],
    });
    const secondHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [second.value],
    });
    const oldGeneration = firstHandle.generation;

    const stopping = attachments.stopDelivery();
    const detaching = attachments.detach(firstHandle);
    await expect(stopping).rejects.toBe(constructionFailure);
    await expect(detaching).rejects.toThrow(
      "Environment delivery stop requires an explicit retry.",
    );
    await expect(attachments.retryDetach(firstHandle)).rejects.toThrow(
      "Environment delivery stop requires an explicit retry.",
    );
    expect(attachments.activeRegistrationCount).toBe(2);
    expect(firstHandle.generation).toBe(oldGeneration);
    expect(secondHandle.generation).toBe(oldGeneration);
    expect(factoryCalls).toBe(2);
    expect([oldWorker.stopCalls, oldWorker.awaitCalls, oldWorker.retireCalls]).toEqual([1, 1, 1]);

    await attachments.retryDeliveryStop();
    expect(firstHandle.generation).toBe(secondHandle.generation);
    expect(firstHandle.generation).not.toBe(oldGeneration);
    expect(factoryCalls).toBe(3);
    await attachments.retryDetach(firstHandle);
    expect(attachments.activeRegistrationCount).toBe(1);
    await attachments.detach(secondHandle);
  });

  it("refuses stop while failed-start rollback owns the generation", async () => {
    const worker = new ControlledWorker([], "rollback");
    worker.startFailures.push(new Error("startup failed"));
    worker.awaitFailures.push(new Error("rollback quiescence failed"));
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const target = descriptor(
      "RollbackOwner",
      "type.example.dev/RollbackOwner",
      new InMemoryStorageFactory(),
    );
    await expect(
      attachments.attach({ ownership: "caller", descriptors: [target.value] }),
    ).rejects.toBeDefined();
    const calls = [worker.stopCalls, worker.awaitCalls, worker.retireCalls];

    await expect(attachments.stopDelivery()).rejects.toThrow(
      "Environment generation rollback requires an explicit retry.",
    );
    expect([worker.stopCalls, worker.awaitCalls, worker.retireCalls]).toEqual(calls);
    await attachments.retryFailedStart();
    await expect(attachments.stopDelivery()).resolves.toBeUndefined();
  });

  it("refuses stop while unsafe last-detach recovery owns the generation", async () => {
    const worker = new ControlledWorker([], "detach");
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const target = descriptor(
      "DetachOwner",
      "type.example.dev/DetachOwner",
      new InMemoryStorageFactory(),
    );
    const handle = await attachments.attach({ ownership: "caller", descriptors: [target.value] });
    worker.awaitFailures.push(new Error("detach quiescence failed"));
    await expect(attachments.detach(handle)).rejects.toBeDefined();
    const calls = [worker.stopCalls, worker.awaitCalls, worker.retireCalls];

    await expect(attachments.stopDelivery()).rejects.toThrow(
      "Environment generation detach requires an explicit retry.",
    );
    expect([worker.stopCalls, worker.awaitCalls, worker.retireCalls]).toEqual(calls);
    await attachments.retryDetach(handle);
    await expect(attachments.stopDelivery()).resolves.toBeUndefined();
  });

  it("keeps routes closed and handle generations old until sequential candidate recovery publishes", async () => {
    const events: string[] = [];
    const oldWorker = new ControlledWorker(events, "old");
    const candidateWorker = new ControlledWorker(events, "candidate");
    const firstGate = Promise.withResolvers<void>();
    const secondGate = Promise.withResolvers<void>();
    const readinessGate = Promise.withResolvers<void>();
    candidateWorker.gates.push(firstGate.promise, secondGate.promise, readinessGate.promise);
    const workers = [oldWorker, candidateWorker];
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) throw new Error("Unexpected generation worker.");
        return worker;
      },
    });
    const storage = new InMemoryStorageFactory();
    const first = descriptor("BarrierFirst", "type.example.dev/BarrierFirst", storage);
    const second = descriptor("BarrierSecond", "type.example.dev/BarrierSecond", storage);
    const firstHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [first.value],
    });
    const secondHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [second.value],
    });
    const oldGeneration = firstHandle.generation;
    const stopping = attachments.stopDelivery();
    let stopSettled = false;
    void stopping.then(() => {
      stopSettled = true;
    });
    expect(attachments.stopDelivery()).toBe(stopping);
    await expect(attachments.retryDeliveryStop()).rejects.toThrow(
      "Environment has no failed delivery stop to retry.",
    );
    await until(() => candidateWorker.starts === 1);
    expect(firstHandle.generation).toBe(oldGeneration);
    expect(secondHandle.generation).toBe(oldGeneration);
    first.readiness.claim(first.ready);
    await Promise.resolve();
    expect(candidateWorker.starts).toBe(1);
    firstGate.resolve();
    await until(() => candidateWorker.starts === 2);
    expect(firstHandle.generation).toBe(oldGeneration);
    expect(secondHandle.generation).toBe(oldGeneration);
    secondGate.resolve();
    await until(() => candidateWorker.starts === 3);
    expect(firstHandle.generation).not.toBe(oldGeneration);
    expect(secondHandle.generation).toBe(firstHandle.generation);
    expect(stopSettled).toBe(false);
    readinessGate.resolve();
    await stopping;
    expect(stopSettled).toBe(true);
    expect(candidateWorker.targets.slice(0, 2).sort()).toEqual([
      "type.example.dev/BarrierFirst",
      "type.example.dev/BarrierSecond",
    ]);
    expect(events.indexOf("old:retire")).toBeLessThan(events.indexOf("candidate:start"));
    expect(factoryCalls).toBe(2);
    await attachments.detach(firstHandle);
    await attachments.detach(secondHandle);
  });

  it("replaces one live multi-registration generation while preserving handle identity", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const first = descriptor("First", "type.example.dev/First", storageFactory);
    const second = descriptor("Second", "type.example.dev/Second", storageFactory);
    const environment = ServerEnvironment.local({ storageFactory });

    const firstHandle = await serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [first.value],
    });
    const secondHandle = await serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [second.value],
    });
    const oldGeneration = firstHandle.generation;

    const firstStop = serverEnvironmentAccess.stopDelivery(environment);
    const secondStop = serverEnvironmentAccess.stopDelivery(environment);

    expect(secondStop).toBe(firstStop);
    await firstStop;
    expect(firstHandle.generation).not.toBe(oldGeneration);
    expect(secondHandle.generation).toBe(firstHandle.generation);
    first.readiness.claim(first.ready);
    await Promise.resolve();
    expect(first.notifications).toBe(1);
    await expect(serverEnvironmentAccess.detach(environment, firstHandle)).resolves.toBeUndefined();
    await expect(
      serverEnvironmentAccess.detach(environment, secondHandle),
    ).resolves.toBeUndefined();
  });
});

function descriptor(
  name: string,
  targetTypeUrl: string,
  storageFactory: InMemoryStorageFactory,
): {
  readonly value: ContextDeliveryDescriptor;
  readonly readiness: DeliveryReadiness;
  readonly ready: DeliveryReady;
  readonly notifications: number;
} {
  const readiness = new DeliveryReadiness();
  const ready: DeliveryReady = Object.freeze({
    label: "UPDATE_SUBSCRIBER",
    targetTypeUrl,
    shard: ShardIndex.single(),
  });
  const context = Object.freeze({ name, multitenant: false });
  let notifications = 0;
  const value: ContextDeliveryDescriptor = Object.freeze({
    storageFactory,
    startupScopes: () => Promise.resolve(Object.freeze([Object.freeze({})])),
    storageContext: () => context,
    endpoints: () => Object.freeze([ready]),
    onReady: (onReady) => readiness.onReady(onReady),
    transition: (scopes, onReady, options) =>
      readiness.transition(
        scopes,
        (candidate) => {
          notifications += 1;
          return onReady(candidate);
        },
        options,
      ),
    replay: () => Promise.resolve(),
  });
  return {
    value,
    readiness,
    ready,
    get notifications() {
      return notifications;
    },
  };
}

class ControlledWorker implements EnvironmentGenerationWorker {
  readonly gates: Promise<void>[] = [];
  readonly startFailures: Error[] = [];
  readonly awaitFailures: Error[] = [];
  readonly awaitOwnerFailures: Error[] = [];
  readonly targets: string[] = [];
  starts = 0;
  stopCalls = 0;
  awaitCalls = 0;
  retireCalls = 0;
  readonly #events: string[];
  readonly #name: string;
  constructor(events: string[], name: string) {
    this.#events = events;
    this.#name = name;
  }
  add(_runtime: EnvironmentDeliveryRuntime): void {}
  start(
    obligation: DeliveryRunObligation,
    shards: readonly ShardIndex[],
  ): Promise<DeliveryWorkerEvidence> {
    this.starts += 1;
    this.#events.push(`${this.#name}:start`);
    this.targets.push(...obligation.scopes.map((scope) => scope.ready.targetTypeUrl));
    const failure = this.startFailures.shift();
    if (failure !== undefined) return Promise.reject(failure);
    const gate = this.gates.shift() ?? Promise.resolve();
    return gate.then(() => ({
      obligation,
      shards: Object.freeze(
        shards.map((shard) => ({
          status: "fulfilled" as const,
          shard,
          obligation,
          run: {
            status: "IDLE" as const,
            runs: 1,
            processed: 0,
            accepted: 0,
            delivered: 0,
            failed: 0,
            failures: Object.freeze([]),
          },
          progress: {
            runs: 1,
            processed: 0,
            accepted: 0,
            delivered: 0,
            failed: 0,
            failures: Object.freeze([]),
          },
        })),
      ),
    }));
  }
  stop(): void {
    this.stopCalls += 1;
    this.#events.push(`${this.#name}:stop`);
  }
  awaitSettled(): Promise<void> {
    this.awaitCalls += 1;
    this.#events.push(`${this.#name}:await`);
    const failure = this.awaitFailures.shift();
    return failure === undefined ? Promise.resolve() : Promise.reject(failure);
  }
  retire(): Promise<void> {
    this.retireCalls += 1;
    this.#events.push(`${this.#name}:retire`);
    return Promise.resolve();
  }
  stopOwners(_keys: readonly string[]): void {}
  awaitOwnersSettled(_keys: readonly string[]): Promise<void> {
    const failure = this.awaitOwnerFailures.shift();
    return failure === undefined ? Promise.resolve() : Promise.reject(failure);
  }
  retireOwners(_keys: readonly string[]): Promise<void> {
    return Promise.resolve();
  }
}

async function until(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Condition was not observed.");
}
