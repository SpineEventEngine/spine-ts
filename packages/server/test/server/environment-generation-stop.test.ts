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
  readonly targets: string[] = [];
  starts = 0;
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
    this.#events.push(`${this.#name}:stop`);
  }
  awaitSettled(): Promise<void> {
    this.#events.push(`${this.#name}:await`);
    return Promise.resolve();
  }
  retire(): Promise<void> {
    this.#events.push(`${this.#name}:retire`);
    return Promise.resolve();
  }
  stopOwners(_keys: readonly string[]): void {}
  awaitOwnersSettled(_keys: readonly string[]): Promise<void> {
    return Promise.resolve();
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
