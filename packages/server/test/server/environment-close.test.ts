import { InMemoryStorageFactory } from "@spine-ts/storage";
import { describe, expect, it, vi } from "vitest";

import type { ContextDeliveryDescriptor } from "../../src/context/bounded-context.js";
import {
  DeliveryReadiness,
  type DeliveryReady,
  type OnDeliveryReady,
} from "../../src/context/local-inbox-handoff.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
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

    await Promise.resolve();
    expect(closeSettled).toBe(false);
    releaseAttach.resolve(undefined);
    const attachment = await attaching;

    await expect(closing).rejects.toThrow("ServerEnvironment cannot close while it is in use.");

    expect(delivery.close).not.toHaveBeenCalled();
    await expect(
      serverEnvironmentAccess.attach(environment, {
        ownership: "caller",
        descriptors: [],
      }),
    ).resolves.toBeDefined();
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
