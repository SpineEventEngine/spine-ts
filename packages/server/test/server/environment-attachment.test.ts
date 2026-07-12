import { InMemoryStorageFactory, type StorageContext } from "@spine-ts/storage";
import { describe, expect, it, vi } from "vitest";

import type {
  ContextDeliveryDescriptor,
  DeliveryTenantScope,
} from "../../src/context/bounded-context.js";
import {
  DeliveryReadiness,
  type DeliveryReady,
  type OnDeliveryReady,
} from "../../src/context/local-inbox-handoff.js";
import { Delivery, type DeliveryEndpointMessage } from "../../src/delivery/delivery.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import { deliveryStorageFaults, onInboxQuery } from "../delivery/delivery-storage-fault-fixture.js";
import {
  EnvironmentRegistrations,
  RegistrationReadiness,
  startupObligations,
} from "../../src/server/environment-attachment.js";
import type { DeliveryRunScope } from "../../src/delivery/delivery-run-coordinator.js";
import { EnvironmentDeliveryWorker } from "../../src/server/environment-delivery-worker.js";
import { ServerEnvironment, serverEnvironmentAccess } from "../../src/server/server-environment.js";

describe("EnvironmentRegistrations", () => {
  it("shares one caller-owned generation and rejects every exclusive conflict before mutation", () => {
    const registrations = new EnvironmentRegistrations();

    const first = registrations.claim("caller");
    const second = registrations.claim("caller");

    expect(second.generation).toBe(first.generation);
    expect(second.token).not.toBe(first.token);
    expect(registrations.count).toBe(2);
    expect(() => registrations.claim("server")).toThrow(
      "Server-owned environment registration requires exclusive ownership.",
    );
    expect(registrations.count).toBe(2);

    const exclusive = new EnvironmentRegistrations();
    const owner = exclusive.claim("server");
    expect(() => exclusive.claim("server")).toThrow(
      "Server-owned environment registration requires exclusive ownership.",
    );
    expect(() => exclusive.claim("caller")).toThrow(
      "Server-owned environment registration requires exclusive ownership.",
    );
    expect(exclusive.count).toBe(1);
    expect(owner.generation).not.toBe(first.generation);
  });
});

describe("RegistrationReadiness", () => {
  it("fails closed for thousands of distinct unknown scopes without coordinator work", () => {
    const target = descriptor("Bounded", "type.example.dev/Bounded", new InMemoryStorageFactory());
    const configured = runScope("owner-bounded", target.ready);
    const prepare = vi.fn(() => configured);
    const routed = vi.fn();
    const readiness = new RegistrationReadiness(
      [{ descriptor: target.value, scopes: [configured] }],
      prepare,
      routed,
    );

    for (let index = 0; index < 4_096; index += 1) {
      readiness.notify(target.value, {
        ...target.ready,
        targetTypeUrl: `type.example.dev/Unknown-${index.toString()}`,
      });
    }
    readiness.notify(target.value, target.ready);

    expect(() => readiness.open([configured])).toThrow(
      "Registration readiness received an unconfigured scope.",
    );
    readiness.notify(target.value, target.ready);
    expect(prepare).not.toHaveBeenCalled();
    expect(routed).not.toHaveBeenCalled();
  });

  it("admits a dynamic zero-to-first runtime only after readiness is open", () => {
    const target = descriptor("Dynamic", "type.example.dev/Dynamic", new InMemoryStorageFactory());
    const dynamic = runScope("owner-dynamic", {
      ...target.ready,
      tenantId: "tenant-dynamic",
    });
    const routed: DeliveryRunScope[] = [];
    const readiness = new RegistrationReadiness(
      [{ descriptor: target.value, scopes: [] }],
      () => dynamic,
      (scope) => routed.push(scope),
    );

    expect(readiness.open([])).toEqual([]);
    readiness.notify(target.value, dynamic.ready);

    expect(routed).toEqual([dynamic]);
  });
});

describe("startup obligations", () => {
  it("keeps fulfilled PAUSED and SKIPPED outcomes parked without causes", () => {
    const paused = runScope("owner-paused", {
      label: "UPDATE_SUBSCRIBER",
      targetTypeUrl: "type.example.dev/Paused",
      shard: ShardIndex.single(),
    });
    const skipped = runScope("owner-skipped", {
      label: "UPDATE_SUBSCRIBER",
      targetTypeUrl: "type.example.dev/Skipped",
      shard: ShardIndex.single(),
    });

    const records = startupObligations("registration-status", [paused, skipped], {
      scopes: [
        { scope: paused, disposition: "PARKED" },
        { scope: skipped, disposition: "PARKED" },
      ],
      pending: [],
    }).records();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ hasCause: false, occurrences: 0 });
    expect(records[0]?.units).toHaveLength(2);
  });
});

describe("EnvironmentDeliveryWorker", () => {
  it("selects the exact owner when distinct storage runtimes have equal readiness", async () => {
    const firstStorage = new InMemoryStorageFactory();
    const secondStorage = new InMemoryStorageFactory();
    const first = descriptor("FirstOwner", "type.example.dev/Shared", firstStorage);
    const second = descriptor("SecondOwner", "type.example.dev/Shared", secondStorage);
    const firstScope = runScope("owner-first", first.ready);
    const secondScope = runScope("owner-second", second.ready);
    const worker = new EnvironmentDeliveryWorker();
    worker.add({
      owner: firstScope.owner,
      descriptor: first.value,
      tenant: {},
      context: first.context,
      scopes: [firstScope],
    });
    worker.add({
      owner: secondScope.owner,
      descriptor: second.value,
      tenant: {},
      context: second.context,
      scopes: [secondScope],
    });
    await new Delivery({ context: first.context, storageFactory: firstStorage }).inbox.receive(
      message(first.ready, "first-row"),
    );
    await new Delivery({ context: second.context, storageFactory: secondStorage }).inbox.receive(
      message(second.ready, "second-row"),
    );

    const firstObligation = Object.freeze({ scopes: Object.freeze([firstScope]) });
    await worker.start(firstObligation, [first.ready.shard]);
    expect(first.replayed).toEqual(["first-row"]);
    expect(second.replayed).toEqual([]);

    const secondObligation = Object.freeze({ scopes: Object.freeze([secondScope]) });
    await worker.start(secondObligation, [second.ready.shard]);
    expect(second.replayed).toEqual(["second-row"]);

    expect(() => {
      worker.add({
        owner: firstScope.owner,
        descriptor: first.value,
        tenant: {},
        context: first.context,
        scopes: [firstScope],
      });
    }).toThrow("Environment delivery owner is already configured.");
    worker.stop();
    await worker.awaitSettled();
    await worker.retire();
  });
});

describe("ServerEnvironment attachment", () => {
  it("serializes concurrent caller registration assembly", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const first = descriptor("First", "type.example.dev/First", storageFactory);
    const second = descriptor("Second", "type.example.dev/Second", storageFactory);
    const releaseFirst = Promise.withResolvers<undefined>();
    const events: string[] = [];
    const firstValue: ContextDeliveryDescriptor = Object.freeze({
      ...first.value,
      async startupScopes() {
        events.push("first-start");
        await releaseFirst.promise;
        events.push("first-finish");
        return first.value.startupScopes();
      },
    });
    const secondValue: ContextDeliveryDescriptor = Object.freeze({
      ...second.value,
      startupScopes() {
        events.push("second-start");
        return second.value.startupScopes();
      },
    });
    const environment = ServerEnvironment.local();

    const firstAttach = serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [firstValue],
    });
    const secondAttach = serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [secondValue],
    });
    await until(() => events.includes("first-start"));
    expect(events).toEqual(["first-start"]);

    releaseFirst.resolve(undefined);
    await Promise.all([firstAttach, secondAttach]);
    expect(events).toEqual(["first-start", "first-finish", "second-start"]);
  });

  it("recovers actual descriptor storage and shares one caller generation", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const first = descriptor("First", "type.example.dev/First", storageFactory);
    const second = descriptor("Second", "type.example.dev/Second", storageFactory);
    const delivery = new Delivery({ context: first.context, storageFactory });
    await delivery.inbox.receive(message(first.ready, "startup"));
    const environment = ServerEnvironment.local({ storageFactory });

    const firstHandle = await serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [first.value],
    });
    const secondHandle = await serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [second.value],
    });

    expect(first.replayed).toEqual(["startup"]);
    expect(secondHandle.generation).toBe(firstHandle.generation);
    expect(secondHandle.token).not.toBe(firstHandle.token);
  });

  it("rejects server-owned conflicts before descriptor enumeration", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const first = descriptor("First", "type.example.dev/First", storageFactory);
    const rejected = descriptor("Rejected", "type.example.dev/Rejected", storageFactory);
    const environment = ServerEnvironment.local({ storageFactory });

    await serverEnvironmentAccess.attach(environment, {
      ownership: "server",
      descriptors: [first.value],
    });
    await expect(
      serverEnvironmentAccess.attach(environment, {
        ownership: "caller",
        descriptors: [rejected.value],
      }),
    ).rejects.toThrow("Server-owned environment registration requires exclusive ownership.");

    expect(rejected.enumerations).toBe(0);
  });

  it("rejects a repeated descriptor before ownership or descriptor work", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const target = descriptor("Duplicate", "type.example.dev/Duplicate", storageFactory);
    const environment = ServerEnvironment.local({ storageFactory });

    await expect(
      serverEnvironmentAccess.attach(environment, {
        ownership: "caller",
        descriptors: [target.value, target.value],
      }),
    ).rejects.toThrow("Attachment requires unique context delivery descriptors.");

    expect(target.enumerations).toBe(0);
    expect(target.storageContexts).toBe(0);
    expect(target.transitions).toBe(0);
    expect(target.readyCallbacks).toBe(0);

    await expect(
      serverEnvironmentAccess.attach(environment, {
        ownership: "caller",
        descriptors: [target.value],
      }),
    ).resolves.toBeDefined();
    expect(target.enumerations).toBe(1);
    expect(target.storageContexts).toBe(1);
    expect(target.transitions).toBe(1);
  });

  it("awaits an older direct drain and transfers transition readiness exactly once", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const target = descriptor("Race", "type.example.dev/Race", storageFactory);
    const release = Promise.withResolvers<undefined>();
    const admitted = target.readiness.claim(target.ready).complete(() => release.promise);
    const environment = ServerEnvironment.local({ storageFactory });
    const attaching = serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [target.value],
    });
    await until(() => target.transitions === 1);
    const delivery = new Delivery({ context: target.context, storageFactory });
    await delivery.inbox.receive(message(target.ready, "buffered"));
    let directDrains = 0;
    const buffered = target.readiness.claim(target.ready).complete(() => {
      directDrains += 1;
      return Promise.resolve();
    });

    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(target.replayed).toEqual([]);
    expect(directDrains).toBe(0);

    release.resolve(undefined);
    await Promise.all([admitted, buffered, attaching]);
    expect(target.replayed).toEqual(["buffered"]);
    expect(directDrains).toBe(0);

    await delivery.inbox.receive(message(target.ready, "later"));
    await target.readiness.claim(target.ready).complete(() => {
      directDrains += 1;
      return Promise.resolve();
    });
    await until(() => target.replayed.length === 2);
    expect(target.replayed).toEqual(["buffered", "later"]);
    expect(directDrains).toBe(0);
  });

  it("fails a stalled-peer attachment closed after bounded unknown routed readiness", async () => {
    const peerStorage = new InMemoryStorageFactory();
    const transferredStorage = deliveryStorageFaults();
    const peer = descriptor("Peer", "type.example.dev/Peer", peerStorage);
    const transferred = descriptor(
      "Transferred",
      "type.example.dev/Transferred",
      transferredStorage.storageFactory,
    );
    const delivery = new Delivery({
      context: transferred.context,
      storageFactory: transferredStorage.storageFactory,
    });
    await delivery.inbox.receive(message(transferred.ready, "startup-row"));
    const releasePeer = Promise.withResolvers<undefined>();
    const admittedPeer = peer.readiness.claim(peer.ready).complete(() => releasePeer.promise);
    const attaching = serverEnvironmentAccess.attach(ServerEnvironment.local(), {
      ownership: "caller",
      descriptors: [peer.value, transferred.value],
    });

    await until(() => peer.transitions === 1 && transferred.completedTransitions === 1);
    expect(peer.completedTransitions).toBe(0);

    let exactDrains = 0;
    const unknown = Array.from({ length: 4_096 }, (_, index) =>
      transferred.readiness
        .claim({
          ...transferred.ready,
          tenantId: `unknown-${index.toString()}`,
        })
        .complete(() => {
          exactDrains += 1;
          return Promise.resolve();
        }),
    );
    await Promise.all(unknown);

    expect(transferred.readyCallbacks).toBe(4_096);
    expect(exactDrains).toBe(0);
    expect(transferredStorage.inboxQueries).toBe(0);
    expect(transferred.replayed).toEqual([]);

    releasePeer.resolve(undefined);
    await admittedPeer;
    await expect(attaching).rejects.toThrow(
      "Registration readiness received an unconfigured scope.",
    );
    expect(transferredStorage.inboxQueries).toBe(0);
    expect(transferred.replayed).toEqual([]);

    await delivery.inbox.receive(message(transferred.ready, "after-failure"));
    await transferred.readiness.claim(transferred.ready).complete(() => {
      exactDrains += 1;
      return Promise.resolve();
    });
    await Promise.resolve();

    expect(transferred.readyCallbacks).toBe(4_097);
    expect(exactDrains).toBe(0);
    expect(transferredStorage.inboxQueries).toBe(0);
    expect(transferred.replayed).toEqual([]);
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([
      { inboxId: { targetId: "startup-row" } },
      { inboxId: { targetId: "after-failure" } },
    ]);
  });

  it("recovers every configured tenant with exact tenant identity and actual storage", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const target = descriptor("Tenants", "type.example.dev/Tenants", storageFactory, {
      tenants: ["tenant-a", "tenant-b"],
    });
    for (const tenantId of ["tenant-a", "tenant-b"]) {
      const context = target.value.storageContext({ tenantId });
      const delivery = new Delivery({ context, storageFactory });
      await delivery.inbox.receive(message({ ...target.ready, tenantId }, tenantId));
    }

    const handle = await serverEnvironmentAccess.attach(ServerEnvironment.local(), {
      ownership: "caller",
      descriptors: [target.value],
    });

    expect(handle.startup.scopes.map(({ scope }) => scope.ready.tenantId)).toEqual([
      "tenant-a",
      "tenant-b",
    ]);
    expect(target.replayTenants).toEqual(["tenant-a", "tenant-b"]);
  });

  it("extends the configured domain for a newly persisted tenant after attachment", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const target = descriptor("Growing", "type.example.dev/Growing", storageFactory, {
      tenants: [],
    });
    await serverEnvironmentAccess.attach(ServerEnvironment.local(), {
      ownership: "caller",
      descriptors: [target.value],
    });
    expect(target.transitions).toBe(1);
    const ready = Object.freeze({ ...target.ready, tenantId: "tenant-b" });
    const delivery = new Delivery({
      context: target.value.storageContext({ tenantId: "tenant-b" }),
      storageFactory,
    });
    await delivery.inbox.receive(message(ready, "tenant-b-later"));

    await target.readiness.claim(ready).complete(() => Promise.resolve());
    await until(() => target.replayed.includes("tenant-b-later"));

    expect(target.replayTenants).toContain("tenant-b");
  });

  it("keeps fulfilled FAILED as cause-less parked startup without rejecting attachment", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const target = descriptor("Failed", "type.example.dev/Failed", storageFactory, {
      onReplay: () => Promise.reject(new Error("endpoint failed")),
    });
    const delivery = new Delivery({ context: target.context, storageFactory });
    await delivery.inbox.receive(message(target.ready, "failed"));

    const handle = await serverEnvironmentAccess.attach(
      ServerEnvironment.local({ storageFactory }),
      {
        ownership: "caller",
        descriptors: [target.value],
      },
    );

    expect(handle.startup.scopes).toMatchObject([{ disposition: "PARKED" }]);
    expect(handle.records()).toEqual([
      expect.objectContaining({ hasCause: false, occurrences: 0 }),
    ]);
  });

  it("does not blame or restart a distinct owner with equal shard facts", async () => {
    const failure = new Error("sibling storage rejected");
    let rejectedQueries = 0;
    const faulty = deliveryStorageFaults(
      onInboxQuery(() => {
        rejectedQueries += 1;
        throw failure;
      }),
    );
    const sibling = descriptor("Sibling", "type.example.dev/Sibling", faulty.storageFactory, {
      shard: new ShardIndex(0, 2),
    });
    const healthyStorage = new InMemoryStorageFactory();
    const attaching = descriptor("Attaching", "type.example.dev/Attaching", healthyStorage, {
      shard: new ShardIndex(0, 2),
    });
    const environment = ServerEnvironment.local();

    await expect(
      serverEnvironmentAccess.attach(environment, {
        ownership: "caller",
        descriptors: [sibling.value],
      }),
    ).rejects.toBe(failure);
    const handle = await serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [attaching.value],
    });

    const attached = handle.startup.scopes.find(
      ({ scope }) => scope.ready.targetTypeUrl === attaching.ready.targetTypeUrl,
    );
    expect(attached?.scope.ready).toEqual(attaching.ready);
    expect(attached?.disposition).toBe("IDLE");
    expect(rejectedQueries).toBe(1);
  });
});

interface TestDescriptor {
  readonly value: ContextDeliveryDescriptor;
  readonly context: StorageContext;
  readonly ready: DeliveryReady;
  readonly replayed: string[];
  readonly replayTenants: (string | undefined)[];
  readonly readiness: DeliveryReadiness;
  readonly enumerations: number;
  readonly storageContexts: number;
  readonly transitions: number;
  readonly completedTransitions: number;
  readonly readyCallbacks: number;
}

function descriptor(
  name: string,
  targetTypeUrl: string,
  storageFactory: ContextDeliveryDescriptor["storageFactory"],
  options: {
    readonly shard?: ShardIndex;
    readonly tenants?: readonly string[];
    readonly onReplay?: (message: DeliveryEndpointMessage) => Promise<void>;
  } = {},
): TestDescriptor {
  const context = Object.freeze({ name, multitenant: false });
  const ready = Object.freeze({
    label: "UPDATE_SUBSCRIBER" as const,
    targetTypeUrl,
    shard: options.shard ?? ShardIndex.single(),
  });
  const readiness = new DeliveryReadiness();
  const replayed: string[] = [];
  const replayTenants: (string | undefined)[] = [];
  const testDescriptor: {
    enumerations: number;
    storageContexts: number;
    transitions: number;
    completedTransitions: number;
    readyCallbacks: number;
  } = {
    enumerations: 0,
    storageContexts: 0,
    transitions: 0,
    completedTransitions: 0,
    readyCallbacks: 0,
  };
  const value: ContextDeliveryDescriptor = Object.freeze({
    storageFactory,
    startupScopes: () => {
      testDescriptor.enumerations += 1;
      return Promise.resolve(
        Object.freeze(
          options.tenants === undefined
            ? [Object.freeze({})]
            : options.tenants.map((tenantId) => Object.freeze({ tenantId })),
        ),
      );
    },
    storageContext: (scope: DeliveryTenantScope) => {
      testDescriptor.storageContexts += 1;
      return options.tenants === undefined
        ? context
        : Object.freeze({ name, multitenant: true, tenantId: scope.tenantId });
    },
    endpoints: () => Object.freeze([ready]),
    onReady: (onReady: OnDeliveryReady) => readiness.onReady(onReady),
    transition: async (
      scopes: readonly DeliveryReady[],
      onReady: OnDeliveryReady,
      transitionOptions?: { readonly allowEmpty?: boolean },
    ) => {
      testDescriptor.transitions += 1;
      await readiness.transition(
        scopes,
        (readyScope) => {
          testDescriptor.readyCallbacks += 1;
          return onReady(readyScope);
        },
        transitionOptions,
      );
      testDescriptor.completedTransitions += 1;
    },
    replay: (next: DeliveryEndpointMessage, tenantId?: string) => {
      replayed.push(next.signalId);
      replayTenants.push(tenantId);
      return options.onReplay?.(next) ?? Promise.resolve();
    },
  });
  return {
    value,
    context,
    ready,
    replayed,
    replayTenants,
    readiness,
    get enumerations() {
      return testDescriptor.enumerations;
    },
    get transitions() {
      return testDescriptor.transitions;
    },
    get storageContexts() {
      return testDescriptor.storageContexts;
    },
    get completedTransitions() {
      return testDescriptor.completedTransitions;
    },
    get readyCallbacks() {
      return testDescriptor.readyCallbacks;
    },
  };
}

function message(ready: DeliveryReady, signalId: string) {
  return {
    inboxId: { targetId: signalId, targetTypeUrl: ready.targetTypeUrl },
    signalId,
    label: ready.label,
    status: "TO_DELIVER" as const,
    shard: ready.shard,
    whenReceived: new Date(),
    version: 1n,
  };
}

function runScope(ownerKey: string, ready: DeliveryReady): DeliveryRunScope {
  return Object.freeze({ owner: Object.freeze({ key: ownerKey }), ready });
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Condition was not observed.");
}
