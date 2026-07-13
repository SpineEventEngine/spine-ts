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
  EnvironmentAttachments,
  EnvironmentRegistrations,
  RegistrationReadiness,
  startupObligations,
  type EnvironmentGenerationWorker,
} from "../../src/server/environment-attachment.js";
import {
  DeliveryRunCoordinator,
  type DeliveryRunObligation,
  type DeliveryRunScope,
  type DeliveryRunWorker,
} from "../../src/delivery/delivery-run-coordinator.js";
import type { DeliveryWorkerEvidence } from "../../src/delivery/delivery-worker.js";
import {
  EnvironmentDeliveryWorker,
  type EnvironmentDeliveryRuntime,
} from "../../src/server/environment-delivery-worker.js";
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

  it("removes one failed registration and clears only an empty retired generation", () => {
    const registrations = new EnvironmentRegistrations();
    const first = registrations.claim("caller");
    const second = registrations.claim("caller");

    expect(registrations.remove(second.token)).toBe(1);
    expect(() => registrations.remove(second.token)).toThrow(
      "Environment registration is not active.",
    );
    expect(registrations.count).toBe(1);
    expect(() => {
      registrations.clear(first.generation);
    }).toThrow("Environment generation still has live registrations.");

    expect(registrations.remove(first.token)).toBe(0);
    registrations.clear(first.generation);
    const fresh = registrations.claim("caller");

    expect(fresh.generation).not.toBe(first.generation);
    expect(registrations.count).toBe(1);
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
  it("constructs production delivery from the captured runtime storage factory", async () => {
    const capturedStorageFactory = new InMemoryStorageFactory();
    const target = descriptor(
      "CapturedFactory",
      "type.example.dev/CapturedFactory",
      capturedStorageFactory,
    );
    const lateAccessorFailure = new Error("descriptor storage factory was read late");
    let lateAccessorCalls = 0;
    const guardedDescriptor: ContextDeliveryDescriptor = Object.freeze({
      get storageFactory(): ContextDeliveryDescriptor["storageFactory"] {
        lateAccessorCalls += 1;
        throw lateAccessorFailure;
      },
      startupScopes: target.value.startupScopes.bind(target.value),
      storageContext: target.value.storageContext.bind(target.value),
      endpoints: target.value.endpoints.bind(target.value),
      onReady: target.value.onReady.bind(target.value),
      transition: target.value.transition.bind(target.value),
      replay: target.value.replay.bind(target.value),
    });
    const scope = runScope("captured-factory-owner", target.ready);
    const worker = new EnvironmentDeliveryWorker();

    expect(() => {
      worker.add({
        owner: scope.owner,
        descriptor: guardedDescriptor,
        storageFactory: capturedStorageFactory,
        tenant: {},
        context: target.context,
        scopes: [scope],
      });
    }).not.toThrow();
    expect(lateAccessorCalls).toBe(0);
    await new Delivery({
      context: target.context,
      storageFactory: capturedStorageFactory,
    }).inbox.receive(message(target.ready, "captured-row"));

    await worker.start(Object.freeze({ scopes: Object.freeze([scope]) }), [target.ready.shard]);
    expect(target.replayed).toEqual(["captured-row"]);
    expect(lateAccessorCalls).toBe(0);
    worker.stop();
    await worker.awaitSettled();
    await worker.retire();
  });

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
      storageFactory: firstStorage,
      tenant: {},
      context: first.context,
      scopes: [firstScope],
    });
    worker.add({
      owner: secondScope.owner,
      descriptor: second.value,
      storageFactory: secondStorage,
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
        storageFactory: firstStorage,
        tenant: {},
        context: first.context,
        scopes: [firstScope],
      });
    }).toThrow("Environment delivery owner is already configured.");

    expect(() => {
      worker.stopOwners(["missing-owner"]);
    }).toThrow("Environment delivery owner is not configured.");
    worker.stopOwners([firstScope.owner.key]);
    worker.stopOwners([firstScope.owner.key]);
    await worker.awaitOwnersSettled([firstScope.owner.key]);
    await worker.retireOwners([firstScope.owner.key]);
    await expect(worker.start(firstObligation, [first.ready.shard])).rejects.toThrow(
      "Environment delivery owner is not configured.",
    );
    await expect(worker.retireOwners(["missing-owner"])).rejects.toThrow(
      "Environment delivery owner is not configured.",
    );
    expect(() => worker.start({ scopes: [] }, [])).toThrow(
      "Environment delivery obligation requires exactly one owner.",
    );
    expect(() => worker.start({ scopes: [firstScope, secondScope] }, [])).toThrow(
      "Environment delivery obligation requires exactly one owner.",
    );

    await worker.start(secondObligation, [second.ready.shard]);
    expect(second.replayed).toEqual(["second-row"]);
    worker.stop();
    await worker.awaitSettled();
    await worker.retire();
  });

  it("skips a selected owner already stopped before whole-generation stop", async () => {
    const firstRuntimeWorker = new LifecycleWorker();
    const secondRuntimeWorker = new LifecycleWorker();
    const fixture = environmentDeliveryWorkerFixture(firstRuntimeWorker, secondRuntimeWorker);
    const { worker } = fixture;
    const first = descriptor(
      "StopOnceFirst",
      "type.example.dev/StopOnceFirst",
      new InMemoryStorageFactory(),
    );
    const second = descriptor(
      "StopOnceSecond",
      "type.example.dev/StopOnceSecond",
      new InMemoryStorageFactory(),
    );
    const firstScope = runScope("stop-once-first", first.ready);
    const secondScope = runScope("stop-once-second", second.ready);
    fixture.add(first, firstScope);
    fixture.add(second, secondScope);

    worker.stopOwners([firstScope.owner.key]);
    worker.stop();

    expect(firstRuntimeWorker.stopCalls).toBe(1);
    expect(secondRuntimeWorker.stopCalls).toBe(1);
    await worker.awaitSettled();
    await worker.retire();
  });

  it("retires every selected owner before reporting multiple owner cleanup failures", async () => {
    const firstRuntimeWorker = new LifecycleWorker();
    const secondRuntimeWorker = new LifecycleWorker();
    const firstFailure = new Error("first retirement failed");
    const secondFailure = new Error("second retirement failed");
    const releaseSecondRetirement = Promise.withResolvers<undefined>();
    firstRuntimeWorker.retireFailures.push(firstFailure);
    secondRuntimeWorker.retireFailures.push(secondFailure);
    secondRuntimeWorker.retireGates.push(releaseSecondRetirement.promise);
    const fixture = environmentDeliveryWorkerFixture(firstRuntimeWorker, secondRuntimeWorker);
    const { worker } = fixture;
    const first = descriptor(
      "RetireFailureFirst",
      "type.example.dev/RetireFailureFirst",
      new InMemoryStorageFactory(),
    );
    const second = descriptor(
      "RetireFailureSecond",
      "type.example.dev/RetireFailureSecond",
      new InMemoryStorageFactory(),
    );
    const firstScope = runScope("retire-failure-first", first.ready);
    const secondScope = runScope("retire-failure-second", second.ready);
    fixture.add(first, firstScope);
    fixture.add(second, secondScope);

    const retiring = worker.retireOwners([firstScope.owner.key, secondScope.owner.key]);
    let settled = false;
    void retiring.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseSecondRetirement.resolve(undefined);
    const aggregate = await retiring.catch((error: unknown) => error);
    expect(aggregate).toBeInstanceOf(AggregateError);
    expect((aggregate as AggregateError).errors).toEqual([firstFailure, secondFailure]);
    expect((aggregate as AggregateError).errors[0]).toBe(firstFailure);
    expect((aggregate as AggregateError).errors[1]).toBe(secondFailure);

    expect(firstRuntimeWorker.retireCalls).toBe(1);
    expect(secondRuntimeWorker.retireCalls).toBe(1);
    await expect(worker.retireOwners([firstScope.owner.key])).rejects.toThrow(
      "Environment delivery owner is not configured.",
    );
  });

  it("preserves a selected owner's exact retirement failure after retiring its routing state", async () => {
    const runtimeWorker = new LifecycleWorker();
    const failure = new Error("selected retirement failed");
    runtimeWorker.retireFailures.push(failure);
    const fixture = environmentDeliveryWorkerFixture(runtimeWorker);
    const { worker } = fixture;
    const selected = descriptor(
      "SelectedRetireFailure",
      "type.example.dev/SelectedRetireFailure",
      new InMemoryStorageFactory(),
    );
    const selectedScope = runScope("selected-retire-failure", selected.ready);
    fixture.add(selected, selectedScope);

    await expect(worker.retireOwners([selectedScope.owner.key])).rejects.toBe(failure);
    await expect(worker.retireOwners([selectedScope.owner.key])).rejects.toThrow(
      "Environment delivery owner is not configured.",
    );
  });

  it("awaits every generation worker retirement before reporting cleanup failures", async () => {
    const firstRuntimeWorker = new LifecycleWorker();
    const secondRuntimeWorker = new LifecycleWorker();
    const firstFailure = new Error("first generation retirement failed");
    const secondFailure = new Error("second generation retirement failed");
    const releaseSecondRetirement = Promise.withResolvers<undefined>();
    firstRuntimeWorker.retireFailures.push(firstFailure);
    secondRuntimeWorker.retireFailures.push(secondFailure);
    secondRuntimeWorker.retireGates.push(releaseSecondRetirement.promise);
    const fixture = environmentDeliveryWorkerFixture(firstRuntimeWorker, secondRuntimeWorker);
    const { worker } = fixture;
    const first = descriptor(
      "GenerationRetireFailureFirst",
      "type.example.dev/GenerationRetireFailureFirst",
      new InMemoryStorageFactory(),
    );
    const second = descriptor(
      "GenerationRetireFailureSecond",
      "type.example.dev/GenerationRetireFailureSecond",
      new InMemoryStorageFactory(),
    );
    const firstScope = runScope("generation-retire-failure-first", first.ready);
    const secondScope = runScope("generation-retire-failure-second", second.ready);
    fixture.add(first, firstScope);
    fixture.add(second, secondScope);

    const retiring = worker.retire();
    let settled = false;
    void retiring.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseSecondRetirement.resolve(undefined);
    const aggregate = await retiring.catch((error: unknown) => error);
    expect(aggregate).toBeInstanceOf(AggregateError);
    expect((aggregate as AggregateError).errors).toEqual([firstFailure, secondFailure]);
    expect((aggregate as AggregateError).errors[0]).toBe(firstFailure);
    expect((aggregate as AggregateError).errors[1]).toBe(secondFailure);

    expect(firstRuntimeWorker.retireCalls).toBe(1);
    expect(secondRuntimeWorker.retireCalls).toBe(1);
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

describe("non-last registration detach", () => {
  it("detaches a zero-scope registration once while preserving its sibling", async () => {
    const worker = new LifecycleWorker();
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const empty = descriptor(
      "EmptyRegistration",
      "type.example.dev/EmptyRegistration",
      new InMemoryStorageFactory(),
      { tenants: [] },
    );
    const sibling = descriptor(
      "EmptyRegistrationSibling",
      "type.example.dev/EmptyRegistrationSibling",
      new InMemoryStorageFactory(),
    );
    const emptyHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [empty.value],
    });
    worker.enqueue("IDLE");
    await attachments.attach({ ownership: "caller", descriptors: [sibling.value] });
    const siblingActive = Promise.withResolvers<LifecycleOutcome>();
    worker.enqueue(siblingActive.promise);
    await sibling.readiness.claim(sibling.ready).complete(() => Promise.resolve());
    await until(() => worker.starts === 2);

    const detaching = attachments.detach(emptyHandle);
    let detachResolved = false;
    void detaching.then(() => {
      detachResolved = true;
    });
    await flushMicrotasks();
    expect(detachResolved).toBe(true);
    expect(attachments.detach(emptyHandle)).toBe(detaching);
    await expect(attachments.retryDetach(emptyHandle)).resolves.toBeUndefined();

    expect(activeRegistrationCount(attachments)).toBe(1);
    expect(worker.stoppedOwners).toEqual([[]]);
    expect(worker.awaitedOwners).toEqual([[]]);
    expect(worker.retiredOwners).toEqual([[]]);
    siblingActive.resolve("IDLE");
    await flushMicrotasks();
  });

  it("detaches one registration after selected-owner quiescence and keeps its sibling usable", async () => {
    const events: string[] = [];
    const worker = new LifecycleWorker(events);
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const departing = descriptor(
      "DetachDeparting",
      "type.example.dev/DetachDeparting",
      new InMemoryStorageFactory(),
    );
    const sibling = descriptor(
      "DetachSibling",
      "type.example.dev/DetachSibling",
      new InMemoryStorageFactory(),
    );
    worker.enqueue("IDLE", "IDLE");
    const departingHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [departing.value],
    });
    await attachments.attach({ ownership: "caller", descriptors: [sibling.value] });

    await attachments.detach(departingHandle);

    expect(worker.stoppedOwners).toEqual([["environment-owner-1"]]);
    expect(worker.awaitedOwners).toEqual([["environment-owner-1"]]);
    expect(worker.retiredOwners).toEqual([["environment-owner-1"]]);
    expect(activeRegistrationCount(attachments)).toBe(1);
    expect(configuredOwnerCount(attachments)).toBe(1);
    expect(configuredScopeCount(attachments)).toBe(1);
    const startsAfterDetach = worker.starts;
    await departing.readiness.claim(departing.ready).complete(() => Promise.resolve());
    await Promise.resolve();
    expect(worker.starts).toBe(startsAfterDetach);

    worker.enqueue("IDLE");
    await sibling.readiness.claim(sibling.ready).complete(() => Promise.resolve());
    await until(() => worker.starts === startsAfterDetach + 1);
  });

  it("reports notification rejection once after the selected-owner barrier", async () => {
    const events: string[] = [];
    const reported: unknown[][] = [];
    const worker = new LifecycleWorker(events);
    const attachments = new EnvironmentAttachments({
      createWorker: () => worker,
      report(causes) {
        events.push("report");
        reported.push([...causes]);
        return Promise.resolve();
      },
    });
    const departing = descriptor(
      "DetachRejected",
      "type.example.dev/DetachRejected",
      new InMemoryStorageFactory(),
    );
    const sibling = descriptor(
      "DetachRejectedSibling",
      "type.example.dev/DetachRejectedSibling",
      new InMemoryStorageFactory(),
    );
    const rejection = new Error("active notification rejected");
    worker.enqueue("IDLE", "IDLE");
    const departingHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [departing.value],
    });
    await attachments.attach({ ownership: "caller", descriptors: [sibling.value] });
    const active = Promise.withResolvers<LifecycleOutcome>();
    worker.enqueue(active.promise);

    await departing.readiness.claim(departing.ready).complete(() => Promise.resolve());
    await until(() => worker.starts === 3);
    const detaching = attachments.detach(departingHandle);
    await flushMicrotasks();
    expect(reported).toEqual([]);
    active.resolve({ rejected: rejection });

    await detaching;

    expect(reported).toEqual([[rejection]]);
    expect(events.slice(2)).toEqual([
      "start",
      "stopOwners",
      "awaitOwners",
      "report",
      "retireOwners",
    ]);
  });

  it("fixes non-last classification and reserves one live sibling across unsafe retry", async () => {
    const worker = new LifecycleWorker();
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const departing = descriptor(
      "ReservedDeparting",
      "type.example.dev/ReservedDeparting",
      new InMemoryStorageFactory(),
    );
    const sibling = descriptor(
      "ReservedSibling",
      "type.example.dev/ReservedSibling",
      new InMemoryStorageFactory(),
    );
    worker.enqueue("IDLE", "IDLE");
    const departingHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [departing.value],
    });
    const siblingHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [sibling.value],
    });
    const stopFailure = new Error("departing stop failed");
    worker.stopOwnerFailures.push(stopFailure);

    await expect(attachments.detach(departingHandle)).rejects.toBe(stopFailure);
    await expect(attachments.detach(siblingHandle)).rejects.toThrow(
      "Environment attachment cannot detach the reserved live registration.",
    );

    await attachments.retryDetach(departingHandle);

    expect(activeRegistrationCount(attachments)).toBe(1);
    expect(worker.stoppedOwners).toEqual([["environment-owner-1"], ["environment-owner-1"]]);
    expect(worker.retiredOwners).toEqual([["environment-owner-1"]]);
  });

  it("validates opaque environment ownership and coalesces duplicate handle detach", async () => {
    const environment = ServerEnvironment.local();
    const foreignEnvironment = ServerEnvironment.local();
    const first = descriptor(
      "HandleFirst",
      "type.example.dev/HandleFirst",
      new InMemoryStorageFactory(),
    );
    const sibling = descriptor(
      "HandleSibling",
      "type.example.dev/HandleSibling",
      new InMemoryStorageFactory(),
    );
    const foreign = descriptor(
      "HandleForeign",
      "type.example.dev/HandleForeign",
      new InMemoryStorageFactory(),
    );
    const firstHandle = await serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [first.value],
    });
    const siblingHandle = await serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [sibling.value],
    });
    const foreignHandle = await serverEnvironmentAccess.attach(foreignEnvironment, {
      ownership: "caller",
      descriptors: [foreign.value],
    });
    const forged = Object.freeze({
      // eslint-disable-next-line @typescript-eslint/no-misused-spread -- Intentional nominal copy.
      ...firstHandle,
      records: () => firstHandle.records(),
    });

    // @ts-expect-error Structural copies are not environment attachment handles.
    await expect(serverEnvironmentAccess.detach(environment, forged)).rejects.toThrow(
      "Environment attachment handle is not owned by this environment.",
    );
    await expect(serverEnvironmentAccess.detach(environment, foreignHandle)).rejects.toThrow(
      "Environment attachment handle is not owned by this environment.",
    );
    await expect(serverEnvironmentAccess.retryDetach(environment, foreignHandle)).rejects.toThrow(
      "Environment attachment handle is not owned by this environment.",
    );
    await expect(
      serverEnvironmentAccess.retryDetach(foreignEnvironment, foreignHandle),
    ).rejects.toThrow("Environment attachment has no failed detach to retry.");
    await expect(serverEnvironmentAccess.retryDetach(environment, siblingHandle)).rejects.toThrow(
      "Environment attachment has no failed detach to retry.",
    );

    const detaching = serverEnvironmentAccess.detach(environment, firstHandle);
    expect(serverEnvironmentAccess.detach(environment, firstHandle)).toBe(detaching);
    await expect(serverEnvironmentAccess.retryDetach(environment, firstHandle)).rejects.toThrow(
      "Environment attachment detach has not rejected.",
    );
    await detaching;
    await expect(serverEnvironmentAccess.detach(environment, firstHandle)).resolves.toBeUndefined();
    await expect(
      serverEnvironmentAccess.retryDetach(environment, firstHandle),
    ).resolves.toBeUndefined();
  });

  it.each(["stop", "await"] as const)(
    "retries only unfinished selected-owner phases after %s failure",
    async (phase) => {
      const worker = new LifecycleWorker();
      const failure = new Error(`${phase} failed`);
      const attachments = new EnvironmentAttachments({ createWorker: () => worker });
      const departing = descriptor(
        `RetryDeparting-${phase}`,
        `type.example.dev/RetryDeparting-${phase}`,
        new InMemoryStorageFactory(),
      );
      const sibling = descriptor(
        `RetrySibling-${phase}`,
        `type.example.dev/RetrySibling-${phase}`,
        new InMemoryStorageFactory(),
      );
      worker.enqueue("IDLE", "IDLE");
      const handle = await attachments.attach({
        ownership: "caller",
        descriptors: [departing.value],
      });
      await attachments.attach({ ownership: "caller", descriptors: [sibling.value] });
      if (phase === "stop") {
        worker.stopOwnerFailures.push(failure);
      } else {
        worker.awaitOwnerFailures.push(failure);
      }

      await expect(attachments.detach(handle)).rejects.toBe(failure);
      expect(activeRegistrationCount(attachments)).toBe(2);
      expect(worker.retiredOwners).toEqual([]);

      await attachments.retryDetach(handle);

      expect(worker.stopOwnerCalls).toBe(phase === "stop" ? 2 : 1);
      expect(worker.awaitOwnerCalls).toBe(phase === "stop" ? 1 : 2);
      expect(worker.retiredOwners).toEqual([["environment-owner-1"]]);
      expect(activeRegistrationCount(attachments)).toBe(1);
    },
  );

  it.each(["report", "retire"] as const)(
    "propagates one post-barrier %s failure after safe cleanup without repeating it on retry",
    async (phase) => {
      const worker = new LifecycleWorker();
      const failure = new Error(`${phase} failed`);
      let reportCalls = 0;
      const attachments = new EnvironmentAttachments({
        createWorker: () => worker,
        report() {
          reportCalls += 1;
          return phase === "report" ? Promise.reject(failure) : Promise.resolve();
        },
      });
      const departing = descriptor(
        `CleanupDeparting-${phase}`,
        `type.example.dev/CleanupDeparting-${phase}`,
        new InMemoryStorageFactory(),
      );
      const sibling = descriptor(
        `CleanupSibling-${phase}`,
        `type.example.dev/CleanupSibling-${phase}`,
        new InMemoryStorageFactory(),
      );
      const rejection = new Error("notification rejected");
      worker.enqueue("IDLE", "IDLE", { rejected: rejection });
      const handle = await attachments.attach({
        ownership: "caller",
        descriptors: [departing.value],
      });
      await attachments.attach({ ownership: "caller", descriptors: [sibling.value] });
      await departing.readiness.claim(departing.ready).complete(() => Promise.resolve());
      await until(() => worker.starts === 3);
      await flushMicrotasks();
      if (phase === "retire") {
        worker.retireOwnerFailures.push(failure);
      }

      await expect(attachments.detach(handle)).rejects.toBe(failure);
      expect(activeRegistrationCount(attachments)).toBe(1);
      expect(worker.retiredOwners).toEqual([["environment-owner-1"]]);

      await expect(attachments.retryDetach(handle)).resolves.toBeUndefined();
      expect(reportCalls).toBe(1);
      expect(worker.retiredOwners).toEqual([["environment-owner-1"]]);
    },
  );

  it("aggregates post-barrier failures in report, worker, coordinator order", async () => {
    const worker = new LifecycleWorker();
    const reportFailure = new Error("report failed");
    const retireFailure = new Error("retire failed");
    const coordinatorFailure = new Error("coordinator cleanup failed");
    const attachments = new EnvironmentAttachments({
      createWorker: () => worker,
      report: () => Promise.reject(reportFailure),
    });
    const departing = descriptor(
      "AggregateDeparting",
      "type.example.dev/AggregateDeparting",
      new InMemoryStorageFactory(),
    );
    const sibling = descriptor(
      "AggregateSibling",
      "type.example.dev/AggregateSibling",
      new InMemoryStorageFactory(),
    );
    worker.enqueue("IDLE", "IDLE", { rejected: new Error("notification rejected") });
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [departing.value],
    });
    await attachments.attach({ ownership: "caller", descriptors: [sibling.value] });
    await departing.readiness.claim(departing.ready).complete(() => Promise.resolve());
    await until(() => worker.starts === 3);
    await flushMicrotasks();
    worker.retireOwnerFailures.push(retireFailure);
    const removeOwners = vi
      .spyOn(DeliveryRunCoordinator.prototype, "removeOwners")
      .mockRejectedValueOnce(coordinatorFailure);

    await expect(attachments.detach(handle)).rejects.toMatchObject({
      errors: [reportFailure, retireFailure, coordinatorFailure],
    });
    expect(activeRegistrationCount(attachments)).toBe(2);
    await expect(attachments.retryDetach(handle)).resolves.toBeUndefined();
    expect(activeRegistrationCount(attachments)).toBe(1);
    expect(removeOwners).toHaveBeenCalledTimes(2);
    expect(worker.retiredOwners).toEqual([["environment-owner-1"]]);
    removeOwners.mockRestore();
  });

  it("retries failed coordinator cleanup without repeating report or worker retirement", async () => {
    const worker = new LifecycleWorker();
    const coordinatorFailure = new Error("coordinator cleanup failed");
    let reportCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker: () => worker,
      report() {
        reportCalls += 1;
        return Promise.resolve();
      },
    });
    const departing = descriptor(
      "CoordinatorCleanupDeparting",
      "type.example.dev/CoordinatorCleanupDeparting",
      new InMemoryStorageFactory(),
    );
    const sibling = descriptor(
      "CoordinatorCleanupSibling",
      "type.example.dev/CoordinatorCleanupSibling",
      new InMemoryStorageFactory(),
    );
    const rejection = new Error("notification rejected");
    worker.enqueue("IDLE", "IDLE", { rejected: rejection });
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [departing.value],
    });
    await attachments.attach({ ownership: "caller", descriptors: [sibling.value] });
    await departing.readiness.claim(departing.ready).complete(() => Promise.resolve());
    await until(() => worker.starts === 3);
    await flushMicrotasks();
    const removeOwners = vi
      .spyOn(DeliveryRunCoordinator.prototype, "removeOwners")
      .mockRejectedValueOnce(coordinatorFailure);

    await expect(attachments.detach(handle)).rejects.toBe(coordinatorFailure);
    expect(activeRegistrationCount(attachments)).toBe(2);
    expect(reportCalls).toBe(1);
    expect(worker.retiredOwners).toEqual([["environment-owner-1"]]);

    await attachments.retryDetach(handle);

    expect(removeOwners).toHaveBeenCalledTimes(2);
    expect(reportCalls).toBe(1);
    expect(worker.retiredOwners).toEqual([["environment-owner-1"]]);
    expect(activeRegistrationCount(attachments)).toBe(1);
    removeOwners.mockRestore();
  });

  it("consumes cause-less PARKED work without reporting it", async () => {
    const worker = new LifecycleWorker();
    let reportCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker: () => worker,
      report() {
        reportCalls += 1;
        return Promise.resolve();
      },
    });
    const departing = descriptor(
      "ParkedDeparting",
      "type.example.dev/ParkedDeparting",
      new InMemoryStorageFactory(),
    );
    const sibling = descriptor(
      "ParkedSibling",
      "type.example.dev/ParkedSibling",
      new InMemoryStorageFactory(),
    );
    worker.enqueue("FAILED", "IDLE");
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [departing.value],
    });
    await attachments.attach({ ownership: "caller", descriptors: [sibling.value] });
    expect(handle.records()).toEqual([
      expect.objectContaining({ hasCause: false, occurrences: 0 }),
    ]);

    await attachments.detach(handle);

    expect(reportCalls).toBe(0);
    expect(activeRegistrationCount(attachments)).toBe(1);
  });

  it("includes a dynamically joined owner in selected-owner detach phases", async () => {
    const worker = new LifecycleWorker();
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const departing = descriptor(
      "DynamicDetachDeparting",
      "type.example.dev/DynamicDetachDeparting",
      new InMemoryStorageFactory(),
      { tenants: ["tenant-initial"] },
    );
    const sibling = descriptor(
      "DynamicDetachSibling",
      "type.example.dev/DynamicDetachSibling",
      new InMemoryStorageFactory(),
    );
    worker.enqueue("IDLE", "IDLE", "IDLE");
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [departing.value],
    });
    await attachments.attach({ ownership: "caller", descriptors: [sibling.value] });
    const dynamicReady = Object.freeze({ ...departing.ready, tenantId: "tenant-dynamic" });
    await departing.readiness.claim(dynamicReady).complete(() => Promise.resolve());
    await until(() => worker.starts === 3);

    await attachments.detach(handle);

    expect(worker.stoppedOwners).toEqual([["environment-owner-1", "environment-owner-3"]]);
    expect(worker.awaitedOwners).toEqual([["environment-owner-1", "environment-owner-3"]]);
    expect(worker.retiredOwners).toEqual([["environment-owner-1", "environment-owner-3"]]);
    expect(configuredOwnerCount(attachments)).toBe(1);
  });

  it("retains terminal generation faults across barrier retry without unsafe cleanup", async () => {
    const worker = new LifecycleWorker();
    const failure = new Error("terminal worker invariant failed");
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const departing = descriptor(
      "FaultedDetachDeparting",
      "type.example.dev/FaultedDetachDeparting",
      new InMemoryStorageFactory(),
    );
    const sibling = descriptor(
      "FaultedDetachSibling",
      "type.example.dev/FaultedDetachSibling",
      new InMemoryStorageFactory(),
    );
    worker.enqueue("IDLE", "IDLE");
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [departing.value],
    });
    await attachments.attach({ ownership: "caller", descriptors: [sibling.value] });
    worker.startFailures.push(failure);
    await departing.readiness.claim(departing.ready).complete(() => Promise.resolve());
    await until(() => worker.starts === 3);
    await flushMicrotasks();

    await expect(attachments.detach(handle)).rejects.toBe(failure);
    await expect(attachments.retryDetach(handle)).rejects.toBe(failure);

    expect(worker.stopOwnerCalls).toBe(1);
    expect(worker.awaitOwnerCalls).toBe(1);
    expect(worker.retiredOwners).toEqual([]);
    expect(activeRegistrationCount(attachments)).toBe(2);
  });
});

describe("ordinary last registration detach", () => {
  it("retires a sole zero-scope registration as a no-record generation", async () => {
    const worker = new LifecycleWorker();
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const empty = descriptor(
      "EmptyLastDetach",
      "type.example.dev/EmptyLastDetach",
      new InMemoryStorageFactory(),
      { tenants: [] },
    );
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [empty.value],
    });

    await expect(attachments.detach(handle)).resolves.toBeUndefined();

    expect(activeRegistrationCount(attachments)).toBe(0);
    expect(configuredOwnerCount(attachments)).toBe(0);
    expect(worker.stopCalls).toBe(0);
    expect(worker.awaitCalls).toBe(0);
    expect(worker.retireCalls).toBe(0);
  });

  it("retires the sole generation in D-0085 order and admits one fresh generation", async () => {
    const events: string[] = [];
    const rejection = new Error("last generation notification rejected");
    const reported: unknown[][] = [];
    const firstWorker = new LifecycleWorker(events);
    const freshWorker = new LifecycleWorker(events);
    const workers = [firstWorker, freshWorker];
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) {
          throw new Error("Unexpected delivery generation.");
        }
        return worker;
      },
      report(causes) {
        events.push("report");
        reported.push([...causes]);
        return Promise.resolve();
      },
    });
    const retiring = descriptor(
      "LastDetach",
      "type.example.dev/LastDetach",
      new InMemoryStorageFactory(),
    );
    const fresh = descriptor(
      "LastDetachFresh",
      "type.example.dev/LastDetachFresh",
      new InMemoryStorageFactory(),
    );
    firstWorker.enqueue("IDLE", { rejected: rejection });
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [retiring.value],
    });
    await retiring.readiness.claim(retiring.ready).complete(() => Promise.resolve());
    await until(() => firstWorker.starts === 2);
    await flushMicrotasks();

    await attachments.detach(handle);

    expect(events).toEqual(["start", "start", "stop", "await", "report", "retire"]);
    expect(reported).toEqual([[rejection]]);
    expect(activeRegistrationCount(attachments)).toBe(0);
    expect(configuredOwnerCount(attachments)).toBe(0);
    expect(configuredScopeCount(attachments)).toBe(0);
    await retiring.readiness.claim(retiring.ready).complete(() => Promise.resolve());
    await flushMicrotasks();
    expect(firstWorker.starts).toBe(2);

    freshWorker.enqueue("IDLE");
    const freshHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [fresh.value],
    });

    expect(freshHandle.generation).not.toBe(handle.generation);
    expect(factoryCalls).toBe(2);
    expect(firstWorker.starts).toBe(2);
    expect(freshWorker.starts).toBe(1);
  });

  it.each(["report", "retire"] as const)(
    "clears the safe sole slot after %s failure and permits one fresh generation",
    async (failureKind) => {
      const events: string[] = [];
      const rejection = new Error("last generation rejected");
      const failure = new Error(`${failureKind} failed`);
      const firstWorker = new LifecycleWorker(events);
      const freshWorker = new LifecycleWorker(events);
      if (failureKind === "retire") {
        firstWorker.retireFailures.push(failure);
      }
      const workers = [firstWorker, freshWorker];
      let factoryCalls = 0;
      let reportCalls = 0;
      const attachments = new EnvironmentAttachments({
        createWorker() {
          const worker = workers[factoryCalls];
          factoryCalls += 1;
          if (worker === undefined) {
            throw new Error("Unexpected delivery generation.");
          }
          return worker;
        },
        report() {
          reportCalls += 1;
          events.push("report");
          return failureKind === "report" ? Promise.reject(failure) : Promise.resolve();
        },
      });
      const retiring = descriptor(
        `LastDetach-${failureKind}`,
        `type.example.dev/LastDetach-${failureKind}`,
        new InMemoryStorageFactory(),
      );
      const fresh = descriptor(
        `LastDetachFresh-${failureKind}`,
        `type.example.dev/LastDetachFresh-${failureKind}`,
        new InMemoryStorageFactory(),
      );
      firstWorker.enqueue("IDLE", { rejected: rejection });
      const handle = await attachments.attach({
        ownership: "caller",
        descriptors: [retiring.value],
      });
      await retiring.readiness.claim(retiring.ready).complete(() => Promise.resolve());
      await until(() => firstWorker.starts === 2);
      await flushMicrotasks();

      await expect(attachments.detach(handle)).rejects.toBe(failure);

      expect(events).toEqual(["start", "start", "stop", "await", "report", "retire"]);
      expect(activeRegistrationCount(attachments)).toBe(0);
      expect(configuredOwnerCount(attachments)).toBe(0);
      await expect(attachments.retryDetach(handle)).resolves.toBeUndefined();
      expect(reportCalls).toBe(1);
      expect(firstWorker.stopCalls).toBe(1);
      expect(firstWorker.awaitCalls).toBe(1);
      expect(firstWorker.retireCalls).toBe(1);

      freshWorker.enqueue("IDLE");
      const freshHandle = await attachments.attach({
        ownership: "caller",
        descriptors: [fresh.value],
      });

      expect(freshHandle.generation).not.toBe(handle.generation);
      expect(factoryCalls).toBe(2);
    },
  );

  it("retains an unsafe sole slot and retries quiescence without duplicate stop", async () => {
    const events: string[] = [];
    const rejection = new Error("last detach rejected work");
    const quiescenceFailure = new Error("last detach quiescence unavailable");
    const firstWorker = new LifecycleWorker(events);
    const freshWorker = new LifecycleWorker(events);
    const workers = [firstWorker, freshWorker];
    let factoryCalls = 0;
    let reportCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) {
          throw new Error("Unexpected delivery generation.");
        }
        return worker;
      },
      report() {
        reportCalls += 1;
        events.push("report");
        return Promise.resolve();
      },
    });
    const retiring = descriptor(
      "UnsafeLastDetach",
      "type.example.dev/UnsafeLastDetach",
      new InMemoryStorageFactory(),
    );
    const fresh = descriptor(
      "UnsafeLastDetachFresh",
      "type.example.dev/UnsafeLastDetachFresh",
      new InMemoryStorageFactory(),
    );
    firstWorker.enqueue("IDLE", { rejected: rejection });
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [retiring.value],
    });
    await retiring.readiness.claim(retiring.ready).complete(() => Promise.resolve());
    await until(() => firstWorker.starts === 2);
    await flushMicrotasks();
    firstWorker.awaitFailures.push(quiescenceFailure);

    await expect(attachments.detach(handle)).rejects.toMatchObject({
      cause: quiescenceFailure,
    });
    await flushMicrotasks();

    expect(events).toEqual(["start", "start", "stop", "await"]);
    expect(activeRegistrationCount(attachments)).toBe(1);
    expect(configuredOwnerCount(attachments)).toBe(1);
    expect(reportCalls).toBe(0);
    expect(firstWorker.retireCalls).toBe(0);

    await attachments.retryDetach(handle);

    expect(events).toEqual(["start", "start", "stop", "await", "await", "report", "retire"]);
    expect(firstWorker.stopCalls).toBe(1);
    expect(firstWorker.awaitCalls).toBe(2);
    expect(reportCalls).toBe(1);
    expect(firstWorker.retireCalls).toBe(1);
    expect(activeRegistrationCount(attachments)).toBe(0);
    await expect(attachments.retryDetach(handle)).resolves.toBeUndefined();
    expect(firstWorker.stopCalls).toBe(1);
    expect(firstWorker.retireCalls).toBe(1);

    freshWorker.enqueue("IDLE");
    const freshHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [fresh.value],
    });

    expect(freshHandle.generation).not.toBe(handle.generation);
    expect(factoryCalls).toBe(2);
  });
});

describe("attachment and last-detach linearization", () => {
  it("defers a queued registration claim and descriptor work until serial admission", async () => {
    const worker = new LifecycleWorker();
    worker.enqueue("IDLE", "IDLE");
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        factoryCalls += 1;
        return worker;
      },
    });
    const first = descriptor(
      "ClaimGateFirst",
      "type.example.dev/ClaimGateFirst",
      new InMemoryStorageFactory(),
    );
    const second = descriptor(
      "ClaimGateSecond",
      "type.example.dev/ClaimGateSecond",
      new InMemoryStorageFactory(),
    );
    const releaseFirst = Promise.withResolvers<undefined>();
    let firstAdmitted = false;
    const gatedFirst: ContextDeliveryDescriptor = Object.freeze({
      ...first.value,
      async startupScopes() {
        firstAdmitted = true;
        await releaseFirst.promise;
        return first.value.startupScopes();
      },
    });

    const firstAttach = attachments.attach({ ownership: "caller", descriptors: [gatedFirst] });
    await until(() => firstAdmitted);
    const secondAttach = attachments.attach({
      ownership: "caller",
      descriptors: [second.value],
    });
    await flushMicrotasks();

    expect(activeRegistrationCount(attachments)).toBe(1);
    expect(second.enumerations).toBe(0);
    expect(second.storageContexts).toBe(0);
    expect(factoryCalls).toBe(1);

    releaseFirst.resolve(undefined);
    await expect(Promise.all([firstAttach, secondAttach])).resolves.toHaveLength(2);
    expect(activeRegistrationCount(attachments)).toBe(2);
    expect(second.enumerations).toBe(1);
  });

  it("captures ownership and an immutable descriptor snapshot when attach is called", async () => {
    const worker = new LifecycleWorker();
    worker.enqueue("IDLE", "IDLE");
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const gate = descriptor(
      "SnapshotGate",
      "type.example.dev/SnapshotGate",
      new InMemoryStorageFactory(),
    );
    const captured = descriptor(
      "SnapshotCaptured",
      "type.example.dev/SnapshotCaptured",
      new InMemoryStorageFactory(),
    );
    const mutated = descriptor(
      "SnapshotMutated",
      "type.example.dev/SnapshotMutated",
      new InMemoryStorageFactory(),
    );
    const replacement = descriptor(
      "SnapshotReplacement",
      "type.example.dev/SnapshotReplacement",
      new InMemoryStorageFactory(),
    );
    const releaseGate = Promise.withResolvers<undefined>();
    let gateAdmitted = false;
    const gatedDescriptor: ContextDeliveryDescriptor = Object.freeze({
      ...gate.value,
      async startupScopes() {
        gateAdmitted = true;
        await releaseGate.promise;
        return gate.value.startupScopes();
      },
    });
    const firstAttach = attachments.attach({
      ownership: "caller",
      descriptors: [gatedDescriptor],
    });
    await until(() => gateAdmitted);
    const descriptors: ContextDeliveryDescriptor[] = [captured.value];
    const options: {
      ownership: "caller" | "server";
      descriptors: ContextDeliveryDescriptor[];
    } = { ownership: "caller", descriptors };

    const queuedAttach = attachments.attach(options);
    descriptors[0] = mutated.value;
    options.ownership = "server";
    options.descriptors = [replacement.value];
    releaseGate.resolve(undefined);
    const [firstHandle, queuedHandle] = await Promise.all([firstAttach, queuedAttach]);

    expect(queuedHandle.generation).toBe(firstHandle.generation);
    expect(captured.enumerations).toBe(1);
    expect(mutated.enumerations).toBe(0);
    expect(replacement.enumerations).toBe(0);
  });

  it("clears an empty server-owned slot after initial worker construction throws", async () => {
    const failure = new Error("initial worker construction failed");
    const worker = new LifecycleWorker();
    worker.enqueue("IDLE");
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        factoryCalls += 1;
        if (factoryCalls === 1) {
          throw failure;
        }
        return worker;
      },
    });
    const failed = descriptor(
      "WorkerConstructionFailure",
      "type.example.dev/WorkerConstructionFailure",
      new InMemoryStorageFactory(),
    );
    const recovered = descriptor(
      "WorkerConstructionRecovery",
      "type.example.dev/WorkerConstructionRecovery",
      new InMemoryStorageFactory(),
    );

    await expect(
      attachments.attach({ ownership: "server", descriptors: [failed.value] }),
    ).rejects.toBe(failure);
    expect(activeRegistrationCount(attachments)).toBe(0);
    expect(failed.enumerations).toBe(0);

    await expect(
      attachments.attach({ ownership: "caller", descriptors: [recovered.value] }),
    ).resolves.toBeDefined();
    expect(factoryCalls).toBe(2);
    expect(activeRegistrationCount(attachments)).toBe(1);
    expect(recovered.enumerations).toBe(1);
  });

  it("lets an attachment admitted before detach make the departing handle non-last", async () => {
    const worker = new LifecycleWorker();
    worker.enqueue("IDLE", "IDLE");
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const departing = descriptor(
      "AttachBeforeDetachDeparting",
      "type.example.dev/AttachBeforeDetachDeparting",
      new InMemoryStorageFactory(),
    );
    const sibling = descriptor(
      "AttachBeforeDetachSibling",
      "type.example.dev/AttachBeforeDetachSibling",
      new InMemoryStorageFactory(),
    );
    const departingHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [departing.value],
    });
    const releaseSibling = Promise.withResolvers<undefined>();
    let siblingAdmitted = false;
    const gatedSibling: ContextDeliveryDescriptor = Object.freeze({
      ...sibling.value,
      async startupScopes() {
        siblingAdmitted = true;
        await releaseSibling.promise;
        return sibling.value.startupScopes();
      },
    });

    const siblingAttach = attachments.attach({
      ownership: "caller",
      descriptors: [gatedSibling],
    });
    await until(() => siblingAdmitted);
    const detaching = attachments.detach(departingHandle);
    releaseSibling.resolve(undefined);
    const siblingHandle = await siblingAttach;
    await detaching;

    expect(siblingHandle.generation).toBe(departingHandle.generation);
    expect(activeRegistrationCount(attachments)).toBe(1);
    expect(worker.stopCalls).toBe(0);
    expect(worker.stoppedOwners).toEqual([["environment-owner-1"]]);

    worker.enqueue("IDLE");
    await sibling.readiness.claim(sibling.ready).complete(() => Promise.resolve());
    await until(() => worker.starts === 3);
  });

  it("queues an attachment behind safe last retirement and makes one fresh generation", async () => {
    const events: string[] = [];
    const oldWorker = new LifecycleWorker(events);
    const freshWorker = new LifecycleWorker(events);
    const workers = [oldWorker, freshWorker];
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) {
          throw new Error("Unexpected delivery generation.");
        }
        return worker;
      },
    });
    const retiring = descriptor(
      "DetachFirstRetiring",
      "type.example.dev/DetachFirstRetiring",
      new InMemoryStorageFactory(),
    );
    const fresh = descriptor(
      "DetachFirstFresh",
      "type.example.dev/DetachFirstFresh",
      new InMemoryStorageFactory(),
    );
    oldWorker.enqueue("IDLE");
    const staleHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [retiring.value],
    });
    const quiescence = Promise.withResolvers<undefined>();
    oldWorker.awaitGates.push(quiescence.promise);

    const detaching = attachments.detach(staleHandle);
    await until(() => oldWorker.awaitCalls === 1);
    freshWorker.enqueue("IDLE", "IDLE");
    const attaching = attachments.attach({ ownership: "caller", descriptors: [fresh.value] });
    await flushMicrotasks();
    expect(fresh.enumerations).toBe(0);
    expect(fresh.storageContexts).toBe(0);
    expect(factoryCalls).toBe(1);
    expect(activeRegistrationCount(attachments)).toBe(1);

    quiescence.resolve(undefined);
    await detaching;
    const freshHandle = await attaching;

    expect(freshHandle.generation).not.toBe(staleHandle.generation);
    expect(factoryCalls).toBe(2);
    expect(events.indexOf("retire")).toBeLessThan(events.lastIndexOf("start"));
    await expect(attachments.detach(staleHandle)).resolves.toBeUndefined();
    expect(activeRegistrationCount(attachments)).toBe(1);

    await fresh.readiness.claim(fresh.ready).complete(() => Promise.resolve());
    await until(() => freshWorker.starts === 2);
  });

  it("blocks queued attachment after unsafe last detach until explicit detach retry", async () => {
    const oldWorker = new LifecycleWorker();
    const freshWorker = new LifecycleWorker();
    const workers = [oldWorker, freshWorker];
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) {
          throw new Error("Unexpected delivery generation.");
        }
        return worker;
      },
    });
    const retiring = descriptor(
      "UnsafeRaceRetiring",
      "type.example.dev/UnsafeRaceRetiring",
      new InMemoryStorageFactory(),
    );
    const blocked = descriptor(
      "UnsafeRaceBlocked",
      "type.example.dev/UnsafeRaceBlocked",
      new InMemoryStorageFactory(),
    );
    oldWorker.enqueue("IDLE");
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [retiring.value],
    });
    const quiescence = Promise.withResolvers<undefined>();
    oldWorker.awaitGates.push(quiescence.promise);

    const detaching = attachments.detach(handle);
    await until(() => oldWorker.awaitCalls === 1);
    const attaching = attachments.attach({ ownership: "caller", descriptors: [blocked.value] });
    const failure = new Error("last detach did not quiesce");
    quiescence.reject(failure);

    await expect(detaching).rejects.toMatchObject({ cause: failure });
    await expect(attaching).rejects.toThrow(
      "Environment generation detach requires an explicit retry.",
    );
    expect(blocked.enumerations).toBe(0);
    expect(blocked.storageContexts).toBe(0);
    expect(blocked.transitions).toBe(0);
    expect(factoryCalls).toBe(1);
    expect(activeRegistrationCount(attachments)).toBe(1);
    await expect(attachments.retryFailedStart()).rejects.toThrow(
      "Environment has no failed-start rollback to retry.",
    );
    await expect(
      attachments.attach({ ownership: "caller", descriptors: [blocked.value] }),
    ).rejects.toThrow("Environment generation detach requires an explicit retry.");
    expect(blocked.enumerations).toBe(0);
    expect(factoryCalls).toBe(1);
    expect(oldWorker.awaitCalls).toBe(1);

    await attachments.retryDetach(handle);
    freshWorker.enqueue("IDLE");
    const freshHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [blocked.value],
    });
    expect(freshHandle.generation).not.toBe(handle.generation);
    expect(factoryCalls).toBe(2);
    expect(oldWorker.stopCalls).toBe(1);
    expect(oldWorker.awaitCalls).toBe(2);
  });

  it.each(["report", "retire"] as const)(
    "admits a queued fresh generation after replacement-safe %s failure",
    async (failureKind) => {
      const events: string[] = [];
      const failure = new Error(`${failureKind} failed after replacement safety`);
      const oldWorker = new LifecycleWorker(events);
      const freshWorker = new LifecycleWorker(events);
      if (failureKind === "retire") {
        oldWorker.retireFailures.push(failure);
      }
      const workers = [oldWorker, freshWorker];
      let factoryCalls = 0;
      const attachments = new EnvironmentAttachments({
        createWorker() {
          const worker = workers[factoryCalls];
          factoryCalls += 1;
          if (worker === undefined) {
            throw new Error("Unexpected delivery generation.");
          }
          return worker;
        },
        report() {
          events.push("report");
          return failureKind === "report" ? Promise.reject(failure) : Promise.resolve();
        },
      });
      const retiring = descriptor(
        `SafeFailureRetiring-${failureKind}`,
        `type.example.dev/SafeFailureRetiring-${failureKind}`,
        new InMemoryStorageFactory(),
      );
      const fresh = descriptor(
        `SafeFailureFresh-${failureKind}`,
        `type.example.dev/SafeFailureFresh-${failureKind}`,
        new InMemoryStorageFactory(),
      );
      const rejection = new Error("active rejection before safe failure");
      oldWorker.enqueue("IDLE", { rejected: rejection });
      const handle = await attachments.attach({
        ownership: "caller",
        descriptors: [retiring.value],
      });
      await retiring.readiness.claim(retiring.ready).complete(() => Promise.resolve());
      await until(() => oldWorker.starts === 2);
      await flushMicrotasks();
      const quiescence = Promise.withResolvers<undefined>();
      oldWorker.awaitGates.push(quiescence.promise);

      const detaching = attachments.detach(handle);
      await until(() => oldWorker.awaitCalls === 1);
      freshWorker.enqueue("IDLE");
      const attaching = attachments.attach({ ownership: "caller", descriptors: [fresh.value] });
      await flushMicrotasks();
      expect(fresh.enumerations).toBe(0);
      expect(factoryCalls).toBe(1);

      quiescence.resolve(undefined);
      await expect(detaching).rejects.toBe(failure);
      const freshHandle = await attaching;

      expect(freshHandle.generation).not.toBe(handle.generation);
      expect(factoryCalls).toBe(2);
      expect(activeRegistrationCount(attachments)).toBe(1);
      expect(events.indexOf("retire")).toBeLessThan(events.lastIndexOf("start"));
    },
  );

  it("keeps failed-start rollback retry separate from detach retry", async () => {
    const worker = new LifecycleWorker();
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const sibling = descriptor(
      "RetryEntrySibling",
      "type.example.dev/RetryEntrySibling",
      new InMemoryStorageFactory(),
    );
    const failed = descriptor(
      "RetryEntryFailed",
      "type.example.dev/RetryEntryFailed",
      new InMemoryStorageFactory(),
    );
    worker.enqueue("IDLE", { rejected: new Error("failed start") });
    const siblingHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [sibling.value],
    });
    worker.awaitOwnerFailures.push(new Error("failed-start rollback did not quiesce"));

    await expect(
      attachments.attach({ ownership: "caller", descriptors: [failed.value] }),
    ).rejects.toBeInstanceOf(AggregateError);
    expect(worker.awaitOwnerCalls).toBe(1);

    await expect(attachments.retryDetach(siblingHandle)).rejects.toThrow(
      "Environment attachment has no failed detach to retry.",
    );
    expect(worker.awaitOwnerCalls).toBe(1);

    await attachments.retryFailedStart();
    expect(worker.awaitOwnerCalls).toBe(2);
    expect(activeRegistrationCount(attachments)).toBe(1);
  });

  it("blocks sibling detach until failed-start rollback is explicitly retried", async () => {
    const worker = new LifecycleWorker();
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const sibling = descriptor(
      "RetrySeparationSibling",
      "type.example.dev/RetrySeparationSibling",
      new InMemoryStorageFactory(),
    );
    const failed = descriptor(
      "RetrySeparationFailed",
      "type.example.dev/RetrySeparationFailed",
      new InMemoryStorageFactory(),
    );
    worker.enqueue("IDLE", { rejected: new Error("failed start") });
    const siblingHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [sibling.value],
    });
    worker.awaitOwnerFailures.push(new Error("failed-start rollback did not quiesce"));

    await expect(
      attachments.attach({ ownership: "caller", descriptors: [failed.value] }),
    ).rejects.toBeInstanceOf(AggregateError);
    expect(worker.awaitOwnerCalls).toBe(1);
    expect(worker.stopCalls).toBe(0);
    expect(worker.awaitCalls).toBe(0);
    expect(worker.retireCalls).toBe(0);

    await expect(attachments.detach(siblingHandle)).rejects.toThrow(
      "Environment generation rollback requires an explicit retry.",
    );
    expect(worker.stopCalls).toBe(0);
    expect(worker.awaitCalls).toBe(0);
    expect(worker.retireCalls).toBe(0);

    await expect(attachments.retryDetach(siblingHandle)).rejects.toThrow(
      "Environment attachment has no failed detach to retry.",
    );
    expect(worker.awaitOwnerCalls).toBe(1);

    await attachments.retryFailedStart();
    expect(worker.awaitOwnerCalls).toBe(2);
    expect(activeRegistrationCount(attachments)).toBe(1);
    expect(worker.stopCalls).toBe(0);
    expect(worker.retireCalls).toBe(0);

    await attachments.detach(siblingHandle);
    expect(activeRegistrationCount(attachments)).toBe(0);
    expect(worker.stopCalls).toBe(1);
    expect(worker.awaitCalls).toBe(1);
    expect(worker.retireCalls).toBe(1);
  });

  it("blocks a queued sibling detach when failed-start rollback wins serial admission", async () => {
    const worker = new LifecycleWorker();
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const sibling = descriptor(
      "QueuedDetachSibling",
      "type.example.dev/QueuedDetachSibling",
      new InMemoryStorageFactory(),
    );
    const failed = descriptor(
      "QueuedDetachFailed",
      "type.example.dev/QueuedDetachFailed",
      new InMemoryStorageFactory(),
    );
    const startup = Promise.withResolvers<LifecycleOutcome>();
    worker.enqueue("IDLE", startup.promise);
    const siblingHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [sibling.value],
    });
    const failedAttach = attachments.attach({ ownership: "caller", descriptors: [failed.value] });
    await until(() => worker.starts === 2);
    worker.awaitOwnerFailures.push(new Error("queued rollback did not quiesce"));

    const detaching = attachments.detach(siblingHandle);
    expect(attachments.detach(siblingHandle)).toBe(detaching);
    startup.resolve({ rejected: new Error("queued attachment failed") });

    await expect(failedAttach).rejects.toBeInstanceOf(AggregateError);
    await expect(detaching).rejects.toThrow(
      "Environment generation rollback requires an explicit retry.",
    );
    expect(worker.stopCalls).toBe(0);
    expect(worker.awaitCalls).toBe(0);
    expect(worker.retireCalls).toBe(0);
    await expect(attachments.retryDetach(siblingHandle)).rejects.toThrow(
      "Environment attachment has no failed detach to retry.",
    );

    await attachments.retryFailedStart();
    await attachments.detach(siblingHandle);
    expect(activeRegistrationCount(attachments)).toBe(0);
    expect(worker.stopCalls).toBe(1);
    expect(worker.awaitCalls).toBe(1);
    expect(worker.retireCalls).toBe(1);
  });

  it("preserves a rejected detach while failed-start rollback blocks its queued retry", async () => {
    const worker = new LifecycleWorker();
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const departing = descriptor(
      "QueuedRetryDeparting",
      "type.example.dev/QueuedRetryDeparting",
      new InMemoryStorageFactory(),
    );
    const sibling = descriptor(
      "QueuedRetrySibling",
      "type.example.dev/QueuedRetrySibling",
      new InMemoryStorageFactory(),
    );
    const failed = descriptor(
      "QueuedRetryFailed",
      "type.example.dev/QueuedRetryFailed",
      new InMemoryStorageFactory(),
    );
    const startup = Promise.withResolvers<LifecycleOutcome>();
    worker.enqueue("IDLE", "IDLE", startup.promise);
    const departingHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [departing.value],
    });
    await attachments.attach({ ownership: "caller", descriptors: [sibling.value] });
    const detachFailure = new Error("original detach stop failed");
    worker.stopOwnerFailures.push(detachFailure);
    const originalDetach = attachments.detach(departingHandle);
    await expect(originalDetach).rejects.toBe(detachFailure);

    const failedAttach = attachments.attach({ ownership: "caller", descriptors: [failed.value] });
    await until(() => worker.starts === 3);
    worker.awaitOwnerFailures.push(new Error("queued retry rollback did not quiesce"));
    const blockedRetry = attachments.retryDetach(departingHandle);
    startup.resolve({ rejected: new Error("queued retry attachment failed") });

    await expect(failedAttach).rejects.toBeInstanceOf(AggregateError);
    await expect(blockedRetry).rejects.toThrow(
      "Environment generation rollback requires an explicit retry.",
    );
    expect(worker.stopOwnerCalls).toBe(2);
    expect(worker.stopCalls).toBe(0);
    expect(worker.retireCalls).toBe(0);
    expect(attachments.detach(departingHandle)).toBe(originalDetach);
    await expect(attachments.retryDetach(departingHandle)).rejects.toThrow(
      "Environment generation rollback requires an explicit retry.",
    );

    await attachments.retryFailedStart();
    await attachments.retryDetach(departingHandle);
    expect(activeRegistrationCount(attachments)).toBe(1);
    expect(worker.stopOwnerCalls).toBe(3);
    expect(worker.stopCalls).toBe(0);
    expect(worker.retireCalls).toBe(0);
  });
});

describe("failed attachment rollback", () => {
  it("reclaims dynamic owners admitted by a failing open registration while preserving its sibling", async () => {
    const worker = new LifecycleWorker();
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const sibling = descriptor(
      "DynamicOwnerSibling",
      "type.example.dev/DynamicOwnerSibling",
      new InMemoryStorageFactory(),
    );
    const failed = descriptor(
      "DynamicOwnerFailed",
      "type.example.dev/DynamicOwnerFailed",
      new InMemoryStorageFactory(),
      { tenants: ["tenant-initial"] },
    );
    const replacement = descriptor(
      "DynamicOwnerReplacement",
      "type.example.dev/DynamicOwnerReplacement",
      new InMemoryStorageFactory(),
    );
    const startup = Promise.withResolvers<LifecycleOutcome>();
    const startupFailure = new Error("dynamic owner startup failed");
    worker.enqueue("IDLE", startup.promise, "IDLE");
    await attachments.attach({ ownership: "caller", descriptors: [sibling.value] });

    const failedAttach = attachments.attach({ ownership: "caller", descriptors: [failed.value] });
    await until(() => worker.starts === 2);
    const dynamicReady = Object.freeze({ ...failed.ready, tenantId: "tenant-dynamic" });
    await failed.readiness.claim(dynamicReady).complete(() => Promise.resolve());
    await failed.readiness.claim(dynamicReady).complete(() => Promise.resolve());

    expect(worker.addedOwners).toEqual([
      "environment-owner-1",
      "environment-owner-2",
      "environment-owner-3",
    ]);
    expect(configuredOwnerCount(attachments)).toBe(3);
    expect(configuredScopeCount(attachments)).toBe(3);

    startup.resolve({ rejected: startupFailure });
    await expect(failedAttach).rejects.toBe(startupFailure);

    expect(worker.stoppedOwners).toEqual([["environment-owner-2", "environment-owner-3"]]);
    expect(worker.awaitedOwners).toEqual([["environment-owner-2", "environment-owner-3"]]);
    expect(worker.retiredOwners).toEqual([["environment-owner-2", "environment-owner-3"]]);
    expect(configuredOwnerCount(attachments)).toBe(1);
    expect(configuredScopeCount(attachments)).toBe(1);
    expect(unresolvedReportedDomainCount(attachments)).toBe(1);

    const startsAfterRollback = worker.starts;
    await failed.readiness.claim(dynamicReady).complete(() => Promise.resolve());
    await failed.readiness
      .claim({ ...failed.ready, tenantId: "tenant-after-failure" })
      .complete(() => Promise.resolve());
    await Promise.resolve();
    expect(worker.starts).toBe(startsAfterRollback);
    expect(worker.addedOwners).toHaveLength(3);

    worker.enqueue("IDLE", "IDLE");
    await sibling.readiness.claim(sibling.ready).complete(() => Promise.resolve());
    await until(() => worker.starts === startsAfterRollback + 1);
    const replacementHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [replacement.value],
    });
    expect(replacementHandle.startup.scopes.map(({ scope }) => scope.owner.key)).toEqual([
      "environment-owner-1",
      "environment-owner-4",
    ]);
    expect(configuredOwnerCount(attachments)).toBe(2);
    expect(configuredScopeCount(attachments)).toBe(2);
  });

  it("quiesces a failed shared owner before report and retirement while preserving its sibling", async () => {
    const events: string[] = [];
    const reported: unknown[][] = [];
    const worker = new LifecycleWorker(events);
    const attachments = new EnvironmentAttachments({
      createWorker: () => worker,
      report: (causes) => {
        events.push("report");
        reported.push([...causes]);
        return Promise.resolve();
      },
    });
    const sibling = descriptor(
      "SiblingLive",
      "type.example.dev/SharedRollback",
      new InMemoryStorageFactory(),
    );
    const rejected = descriptor(
      "RejectedOverlap",
      "type.example.dev/SharedRollback",
      new InMemoryStorageFactory(),
    );
    const blocker = descriptor(
      "BlockedOverlap",
      "type.example.dev/SharedRollback",
      new InMemoryStorageFactory(),
    );
    const disjoint = descriptor(
      "DisjointLive",
      "type.example.dev/DisjointRollback",
      new InMemoryStorageFactory(),
    );
    const rejection = new Error("attaching registration rejected");
    const freshRejection = new Error("fresh distinct-owner rejection");

    worker.enqueue("FAILED", { rejected: rejection });
    const siblingHandle = await attachments.attach({
      ownership: "caller",
      descriptors: [sibling.value],
    });
    await expect(
      attachments.attach({ ownership: "caller", descriptors: [rejected.value] }),
    ).rejects.toBe(rejection);

    expect(worker.stopCalls).toBe(0);
    expect(worker.retiredOwners).toEqual([["environment-owner-2"]]);
    expect(events).toEqual([
      "start",
      "start",
      "stopOwners",
      "awaitOwners",
      "report",
      "retireOwners",
    ]);
    expect(reported).toEqual([[rejection]]);
    expect(siblingHandle.records()).toEqual([
      expect.objectContaining({ hasCause: false, occurrences: 0 }),
    ]);

    await rejected.readiness.claim(rejected.ready).complete(() => Promise.resolve());
    await Promise.resolve();
    expect(worker.starts).toBe(2);

    worker.enqueue("IDLE", { rejected: freshRejection }, "IDLE");
    await sibling.readiness.claim(sibling.ready).complete(() => Promise.resolve());
    await until(() => worker.starts === 3);

    let blocked: unknown;
    try {
      await attachments.attach({ ownership: "caller", descriptors: [blocker.value] });
    } catch (error) {
      blocked = error;
    }
    expect(blocked).toBe(freshRejection);

    await expect(
      attachments.attach({ ownership: "caller", descriptors: [disjoint.value] }),
    ).resolves.toBeDefined();
    expect(siblingHandle.records()).toEqual([
      expect.objectContaining({ hasCause: false, occurrences: 0 }),
    ]);
  });

  it.each(["stop", "await"] as const)(
    "retains a failed shared rollback when selected-owner %s cannot prove safety",
    async (failureKind) => {
      const events: string[] = [];
      const reported: unknown[][] = [];
      const worker = new LifecycleWorker(events);
      const safetyFailure = new Error(`${failureKind} selected owner failed`);
      if (failureKind === "stop") {
        worker.stopOwnerFailures.push(safetyFailure);
      } else {
        worker.awaitOwnerFailures.push(safetyFailure);
      }
      const attachments = new EnvironmentAttachments({
        createWorker: () => worker,
        report: (causes) => {
          events.push("report");
          reported.push([...causes]);
          return Promise.resolve();
        },
      });
      const sibling = descriptor(
        `SharedSibling-${failureKind}`,
        `type.example.dev/SharedSafety-${failureKind}`,
        new InMemoryStorageFactory(),
      );
      const failed = descriptor(
        `SharedFailed-${failureKind}`,
        `type.example.dev/SharedSafety-${failureKind}`,
        new InMemoryStorageFactory(),
      );
      const replacement = descriptor(
        `SharedReplacement-${failureKind}`,
        `type.example.dev/SharedReplacement-${failureKind}`,
        new InMemoryStorageFactory(),
      );
      worker.enqueue("IDLE", { rejected: new Error("shared startup rejected") });
      await attachments.attach({ ownership: "caller", descriptors: [sibling.value] });

      await expect(
        attachments.attach({ ownership: "caller", descriptors: [failed.value] }),
      ).rejects.toBeInstanceOf(AggregateError);
      expect(reported).toEqual([]);
      expect(worker.retiredOwners).toEqual([]);
      expect(configuredOwnerCount(attachments)).toBe(2);
      expect(events).not.toContain("report");
      await expect(
        attachments.attach({ ownership: "caller", descriptors: [replacement.value] }),
      ).rejects.toThrow("Environment generation rollback requires an explicit retry.");

      await attachments.retryFailedStart();
      expect(worker.stopOwnerCalls).toBe(failureKind === "stop" ? 2 : 1);
      expect(worker.awaitOwnerCalls).toBe(failureKind === "stop" ? 1 : 2);
      expect(reported).toHaveLength(1);
      expect(worker.retiredOwners).toEqual([["environment-owner-2"]]);
      expect(configuredOwnerCount(attachments)).toBe(1);

      worker.enqueue("IDLE");
      await expect(
        attachments.attach({ ownership: "caller", descriptors: [replacement.value] }),
      ).resolves.toBeDefined();
    },
  );

  it.each(["report", "retire"] as const)(
    "clears an inert sole generation after %s failure and admits one fresh generation",
    async (failureKind) => {
      const startFailure = new Error("sole startup rejected");
      const cleanupFailure = new Error(`${failureKind} failed`);
      const workers: LifecycleWorker[] = [];
      const events: string[] = [];
      const failed = descriptor(
        `Sole-${failureKind}`,
        `type.example.dev/Sole-${failureKind}`,
        new InMemoryStorageFactory(),
      );
      const fresh = descriptor(
        `Fresh-${failureKind}`,
        `type.example.dev/Fresh-${failureKind}`,
        new InMemoryStorageFactory(),
      );

      const firstWorker = new LifecycleWorker(events);
      firstWorker.enqueue({ rejected: startFailure });
      if (failureKind === "retire") {
        firstWorker.retireFailures.push(cleanupFailure);
      }
      workers.push(firstWorker);
      let factoryCall = 0;
      const controlled = new EnvironmentAttachments({
        createWorker() {
          const selected = workers[factoryCall];
          factoryCall += 1;
          return selected ?? new LifecycleWorker();
        },
        report: () => {
          events.push("report");
          return failureKind === "report" ? Promise.reject(cleanupFailure) : Promise.resolve();
        },
      });

      await expect(
        controlled.attach({ ownership: "caller", descriptors: [failed.value] }),
      ).rejects.toMatchObject({ errors: [startFailure, cleanupFailure] });
      expect(firstWorker.events).toEqual(["start", "stop", "await", "report", "retire"]);
      await failed.readiness.claim(failed.ready).complete(() => Promise.resolve());
      await Promise.resolve();
      expect(firstWorker.starts).toBe(1);

      const freshWorker = new LifecycleWorker();
      freshWorker.enqueue("IDLE");
      workers.push(freshWorker);
      const handle = await controlled.attach({
        ownership: "caller",
        descriptors: [fresh.value],
      });

      expect(handle.generation).toBeDefined();
      expect(factoryCall).toBe(2);
      expect(firstWorker.starts).toBe(1);
      expect(freshWorker.starts).toBe(1);
    },
  );

  it("retains an unsafe sole slot and resumes the same rollback without duplicate stop", async () => {
    const startFailure = new Error("sole startup rejected");
    const quiescenceFailure = new Error("await quiescence failed");
    const events: string[] = [];
    const workers: LifecycleWorker[] = [];
    const firstWorker = new LifecycleWorker(events);
    firstWorker.enqueue({ rejected: startFailure });
    firstWorker.awaitFailures.push(quiescenceFailure);
    workers.push(firstWorker);
    let factoryCalls = 0;
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls] ?? new LifecycleWorker(events);
        factoryCalls += 1;
        return worker;
      },
      report: () => {
        events.push("report");
        return Promise.resolve();
      },
    });
    const failed = descriptor(
      "UnsafeSole",
      "type.example.dev/UnsafeSole",
      new InMemoryStorageFactory(),
    );
    const replacement = descriptor(
      "RejectedReplacement",
      "type.example.dev/RejectedReplacement",
      new InMemoryStorageFactory(),
    );

    await expect(
      attachments.attach({ ownership: "caller", descriptors: [failed.value] }),
    ).rejects.toMatchObject({ errors: [startFailure, expect.any(Error)] });
    expect(events).toEqual(["start", "stop", "await"]);
    expect(factoryCalls).toBe(1);

    await expect(
      attachments.attach({ ownership: "caller", descriptors: [replacement.value] }),
    ).rejects.toThrow("Environment generation rollback requires an explicit retry.");
    expect(replacement.enumerations).toBe(0);
    expect(factoryCalls).toBe(1);

    await attachments.retryFailedStart();
    expect(events).toEqual(["start", "stop", "await", "await", "report", "retire"]);
    expect(firstWorker.stopCalls).toBe(1);
    expect(firstWorker.awaitCalls).toBe(2);
    expect(firstWorker.retireCalls).toBe(1);

    const freshWorker = new LifecycleWorker(events);
    freshWorker.enqueue("IDLE");
    workers.push(freshWorker);
    const fresh = await attachments.attach({
      ownership: "caller",
      descriptors: [replacement.value],
    });

    expect(fresh.generation).toBeDefined();
    expect(factoryCalls).toBe(2);
    expect(freshWorker.starts).toBe(1);
  });

  it("coalesces simultaneous failed-start retries around one in-flight operation", async () => {
    const startFailure = new Error("coalesced startup rejected");
    const worker = new LifecycleWorker();
    worker.enqueue({ rejected: startFailure });
    worker.awaitFailures.push(new Error("first quiescence failed"));
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const failed = descriptor(
      "CoalescedRetry",
      "type.example.dev/CoalescedRetry",
      new InMemoryStorageFactory(),
    );
    await expect(
      attachments.attach({ ownership: "caller", descriptors: [failed.value] }),
    ).rejects.toBeInstanceOf(AggregateError);

    const settle = Promise.withResolvers<undefined>();
    worker.awaitGates.push(settle.promise);
    const first = attachments.retryFailedStart();
    const second = attachments.retryFailedStart();

    expect(second).toBe(first);
    settle.resolve(undefined);
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(worker.stopCalls).toBe(1);
    expect(worker.awaitCalls).toBe(2);
    expect(worker.retireCalls).toBe(1);
  });

  it("keeps a queued follower outside unsafe failed-start retirement before one fresh attach", async () => {
    const events: string[] = [];
    const oldWorker = new LifecycleWorker(events);
    const freshWorker = new LifecycleWorker(events);
    const workers = [oldWorker, freshWorker];
    let factoryCalls = 0;
    oldWorker.enqueue({ rejected: new Error("queued predecessor rejected") });
    oldWorker.awaitFailures.push(new Error("queued predecessor did not quiesce"));
    const attachments = new EnvironmentAttachments({
      createWorker() {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (worker === undefined) {
          throw new Error("Unexpected environment generation.");
        }
        return worker;
      },
      report: () => {
        events.push("report");
        return Promise.resolve();
      },
    });
    const predecessor = descriptor(
      "QueuedPredecessor",
      "type.example.dev/QueuedPredecessor",
      new InMemoryStorageFactory(),
    );
    const queued = descriptor(
      "QueuedFollower",
      "type.example.dev/QueuedFollower",
      new InMemoryStorageFactory(),
    );

    const first = attachments.attach({ ownership: "caller", descriptors: [predecessor.value] });
    const second = attachments.attach({ ownership: "caller", descriptors: [queued.value] });

    await expect(first).rejects.toBeInstanceOf(AggregateError);
    await expect(second).rejects.toThrow(
      "Environment generation rollback requires an explicit retry.",
    );
    expect(queued.enumerations).toBe(0);
    expect(queued.storageContexts).toBe(0);
    expect(queued.transitions).toBe(0);
    expect(oldWorker.starts).toBe(1);
    expect(activeRegistrationCount(attachments)).toBe(0);

    oldWorker.awaitFailures.push(new Error("promoted generation did not quiesce"));
    const firstRetry = attachments.retryFailedStart();
    const secondRetry = attachments.retryFailedStart();
    expect(secondRetry).toBe(firstRetry);
    await expect(Promise.all([firstRetry, secondRetry])).rejects.toThrow(
      "Delivery run coordinator could not establish quiescence.",
    );
    expect(oldWorker.events).toEqual(["start", "stop", "await", "await"]);

    await attachments.retryFailedStart();
    expect(activeRegistrationCount(attachments)).toBe(0);
    expect(oldWorker.events).toEqual([
      "start",
      "stop",
      "await",
      "await",
      "await",
      "report",
      "retire",
    ]);
    expect(oldWorker.stopOwnerCalls).toBe(0);
    expect(oldWorker.awaitOwnerCalls).toBe(0);
    expect(oldWorker.stopCalls).toBe(1);
    expect(oldWorker.awaitCalls).toBe(3);
    expect(oldWorker.retireCalls).toBe(1);
    expect(oldWorker.retiredOwners).toEqual([]);

    freshWorker.enqueue("IDLE");
    const attached = await attachments.attach({ ownership: "caller", descriptors: [queued.value] });
    expect(activeRegistrationCount(attachments)).toBe(1);
    expect(attached.generation).toBeDefined();
    expect(queued.enumerations).toBe(1);
    expect(factoryCalls).toBe(2);
    expect(oldWorker.addedOwners).toEqual(["environment-owner-1"]);
    expect(freshWorker.addedOwners).toEqual(["environment-owner-1"]);
    expect(events.indexOf("retire")).toBeLessThan(events.lastIndexOf("start"));

    await predecessor.readiness.claim(predecessor.ready).complete(() => Promise.resolve());
    await Promise.resolve();
    expect(oldWorker.starts).toBe(1);
    expect(freshWorker.starts).toBe(1);
  });

  it("bounds repeated reported failures to one stable storage/context/readiness domain", async () => {
    const worker = new LifecycleWorker();
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const sharedType = "type.example.dev/BoundedReportedFailure";
    const sharedFactory = new InMemoryStorageFactory();
    const sibling = descriptor(
      "BoundedSibling",
      "type.example.dev/BoundedSibling",
      new InMemoryStorageFactory(),
    );
    worker.enqueue("IDLE");
    await attachments.attach({ ownership: "caller", descriptors: [sibling.value] });

    for (let attempt = 0; attempt < 2048; attempt += 1) {
      const failed = descriptor("BoundedFailure", sharedType, sharedFactory);
      worker.enqueue({ rejected: new Error(`failure-${attempt.toString()}`) });
      await expect(
        attachments.attach({ ownership: "caller", descriptors: [failed.value] }),
      ).rejects.toBeInstanceOf(Error);
    }

    expect(unresolvedReportedDomainCount(attachments)).toBe(1);
    expect(configuredOwnerCount(attachments)).toBe(1);

    const recovered = descriptor("BoundedFailure", sharedType, sharedFactory);
    worker.enqueue("IDLE");
    const handle = await attachments.attach({
      ownership: "caller",
      descriptors: [recovered.value],
    });
    expect(handle.startup.scopes.map(({ scope }) => scope.ready.targetTypeUrl)).toEqual([
      sibling.ready.targetTypeUrl,
      recovered.ready.targetTypeUrl,
    ]);
    expect(handle.startup.pending).toEqual([]);
    expect(unresolvedReportedDomainCount(attachments)).toBe(0);
    expect(configuredOwnerCount(attachments)).toBe(2);
  });

  it("reclaims failed owner state after inert selected-worker retirement cleanup failure", async () => {
    const events: string[] = [];
    const worker = new LifecycleWorker(events);
    const cleanupFailure = new Error("selected owner cleanup failed");
    worker.retireOwnerFailures.push(cleanupFailure);
    const attachments = new EnvironmentAttachments({
      createWorker: () => worker,
      report: () => {
        events.push("report");
        return Promise.resolve();
      },
    });
    const sharedFactory = new InMemoryStorageFactory();
    const sibling = descriptor(
      "CleanupSibling",
      "type.example.dev/CleanupSibling",
      new InMemoryStorageFactory(),
    );
    const failed = descriptor(
      "CleanupStableContext",
      "type.example.dev/CleanupStableFailure",
      sharedFactory,
    );
    const blocked = descriptor(
      "CleanupStableContext",
      "type.example.dev/CleanupStableFailure",
      sharedFactory,
    );
    const startFailure = new Error("cleanup-path startup failed");
    worker.enqueue("IDLE", { rejected: startFailure });
    await attachments.attach({ ownership: "caller", descriptors: [sibling.value] });

    await expect(
      attachments.attach({ ownership: "caller", descriptors: [failed.value] }),
    ).rejects.toMatchObject({ errors: [startFailure, cleanupFailure] });
    expect(events).toEqual([
      "start",
      "start",
      "stopOwners",
      "awaitOwners",
      "report",
      "retireOwners",
    ]);
    expect(configuredOwnerCount(attachments)).toBe(1);
    expect(unresolvedReportedDomainCount(attachments)).toBe(1);

    const retiredScope = runScope("environment-owner-2", failed.ready);
    await expect(worker.start({ scopes: [retiredScope] }, [failed.ready.shard])).rejects.toThrow(
      "Lifecycle worker owner is permanently retired.",
    );

    worker.enqueue({ rejected: new Error("fresh cleanup-path rejection") });
    await expect(
      attachments.attach({ ownership: "caller", descriptors: [blocked.value] }),
    ).rejects.toEqual(
      new Error("Startup recovery is blocked by an unresolved shared delivery obligation."),
    );
    expect(configuredOwnerCount(attachments)).toBe(1);
    expect(unresolvedReportedDomainCount(attachments)).toBe(1);
  });

  it("does not inherit or resolve stable failure state across distinct factory objects", async () => {
    const worker = new LifecycleWorker();
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const sharedType = "type.example.dev/OwnerQualifiedReportedFailure";
    const failedFactory = new InMemoryStorageFactory();
    const distinctFactory = new InMemoryStorageFactory();
    const sibling = descriptor(
      "OwnerQualifiedSibling",
      "type.example.dev/OwnerQualifiedSibling",
      new InMemoryStorageFactory(),
    );
    const failed = descriptor("EqualStorageContext", sharedType, failedFactory);
    const successful = descriptor("EqualStorageContext", sharedType, distinctFactory);
    const freshFailure = descriptor("EqualStorageContext", sharedType, distinctFactory);
    const original = new Error("owner-qualified reported failure");
    const fresh = new Error("distinct owner fresh failure");
    worker.enqueue("IDLE", { rejected: original });
    await attachments.attach({ ownership: "caller", descriptors: [sibling.value] });
    await expect(
      attachments.attach({ ownership: "caller", descriptors: [failed.value] }),
    ).rejects.toBe(original);
    expect(unresolvedReportedDomainCount(attachments)).toBe(1);

    worker.enqueue("IDLE");
    await expect(
      attachments.attach({ ownership: "caller", descriptors: [successful.value] }),
    ).resolves.toBeDefined();
    expect(unresolvedReportedDomainCount(attachments)).toBe(1);

    worker.enqueue({ rejected: fresh });
    await expect(
      attachments.attach({ ownership: "caller", descriptors: [freshFailure.value] }),
    ).rejects.toBe(fresh);
    expect(unresolvedReportedDomainCount(attachments)).toBe(2);
  });

  it("blocks then resolves a matching replacement in the same stable storage domain", async () => {
    const worker = new LifecycleWorker();
    const attachments = new EnvironmentAttachments({ createWorker: () => worker });
    const storageFactory = new InMemoryStorageFactory();
    const type = "type.example.dev/StableReportedFailure";
    const sibling = descriptor(
      "StableSibling",
      "type.example.dev/StableSibling",
      new InMemoryStorageFactory(),
    );
    const failed = descriptor("StableStorageContext", type, storageFactory);
    const blocked = descriptor("StableStorageContext", type, storageFactory);
    const resolved = descriptor("StableStorageContext", type, storageFactory);
    const original = new Error("stable original rejection");
    const fresh = new Error("stable fresh rejection");
    worker.enqueue("IDLE", { rejected: original });
    await attachments.attach({ ownership: "caller", descriptors: [sibling.value] });
    await expect(
      attachments.attach({ ownership: "caller", descriptors: [failed.value] }),
    ).rejects.toBe(original);
    expect(unresolvedReportedDomainCount(attachments)).toBe(1);

    worker.enqueue({ rejected: fresh });
    let blocker: unknown;
    try {
      await attachments.attach({ ownership: "caller", descriptors: [blocked.value] });
    } catch (error) {
      blocker = error;
    }
    expect(blocker).toEqual(
      new Error("Startup recovery is blocked by an unresolved shared delivery obligation."),
    );
    expect(blocker).not.toBeInstanceOf(AggregateError);
    expect(blocker).not.toHaveProperty("cause");
    expect(unresolvedReportedDomainCount(attachments)).toBe(1);

    worker.enqueue("IDLE");
    await expect(
      attachments.attach({ ownership: "caller", descriptors: [resolved.value] }),
    ).resolves.toBeDefined();
    expect(unresolvedReportedDomainCount(attachments)).toBe(0);
  });
});

function unresolvedReportedDomainCount(attachments: EnvironmentAttachments): number {
  return (
    attachments as EnvironmentAttachments & { readonly unresolvedReportedDomainCount: number }
  ).unresolvedReportedDomainCount;
}

function activeRegistrationCount(attachments: EnvironmentAttachments): number {
  return (attachments as EnvironmentAttachments & { readonly activeRegistrationCount: number })
    .activeRegistrationCount;
}

function configuredOwnerCount(attachments: EnvironmentAttachments): number {
  return (attachments as EnvironmentAttachments & { readonly configuredOwnerCount: number })
    .configuredOwnerCount;
}

function configuredScopeCount(attachments: EnvironmentAttachments): number {
  return (attachments as EnvironmentAttachments & { readonly configuredScopeCount: number })
    .configuredScopeCount;
}

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
      if (options.tenants === undefined) {
        return context;
      }
      if (scope.tenantId === undefined) {
        throw new Error("The multitenant test descriptor requires a tenant ID.");
      }
      return Object.freeze({ name, multitenant: true, tenantId: scope.tenantId });
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

function environmentDeliveryWorkerFixture(...runtimeWorkers: readonly DeliveryRunWorker[]) {
  let nextWorker = 0;
  const WorkerWithOptions = EnvironmentDeliveryWorker as unknown as new (options: {
    readonly createWorker: (runtime: EnvironmentDeliveryRuntime) => DeliveryRunWorker;
  }) => EnvironmentDeliveryWorker;
  const worker = new WorkerWithOptions({
    createWorker() {
      const selected = runtimeWorkers[nextWorker];
      nextWorker += 1;
      if (selected === undefined) {
        throw new Error("Unexpected runtime worker creation.");
      }
      return selected;
    },
  });

  return {
    worker,
    add(descriptor: TestDescriptor, scope: DeliveryRunScope): void {
      worker.add({
        owner: scope.owner,
        descriptor: descriptor.value,
        storageFactory: descriptor.value.storageFactory,
        tenant: {},
        context: descriptor.context,
        scopes: [scope],
      });
    },
  };
}

type LifecycleOutcome = "FAILED" | "IDLE" | { readonly rejected: Error };
type LifecycleResult = LifecycleOutcome | Promise<LifecycleOutcome>;

class LifecycleWorker implements EnvironmentGenerationWorker {
  readonly #results: LifecycleResult[] = [];
  readonly #events: string[];
  readonly #activeOwners = new Set<string>();
  readonly awaitFailures: Error[] = [];
  readonly awaitGates: Promise<void>[] = [];
  readonly retireFailures: Error[] = [];
  readonly retireGates: Promise<void>[] = [];
  readonly stopOwnerFailures: Error[] = [];
  readonly awaitOwnerFailures: Error[] = [];
  readonly retireOwnerFailures: Error[] = [];
  readonly startFailures: Error[] = [];
  readonly retiredOwners: string[][] = [];
  readonly stoppedOwners: string[][] = [];
  readonly awaitedOwners: string[][] = [];
  readonly addedOwners: string[] = [];
  starts = 0;
  stopCalls = 0;
  awaitCalls = 0;
  retireCalls = 0;
  stopOwnerCalls = 0;
  awaitOwnerCalls = 0;

  constructor(events: string[] = []) {
    this.#events = events;
  }

  get events(): readonly string[] {
    return this.#events;
  }

  enqueue(...results: LifecycleResult[]): void {
    this.#results.push(...results);
  }

  add(runtime: EnvironmentDeliveryRuntime): void {
    this.#activeOwners.add(runtime.owner.key);
    this.addedOwners.push(runtime.owner.key);
  }

  start(
    obligation: DeliveryRunObligation,
    shards: readonly ShardIndex[],
  ): Promise<DeliveryWorkerEvidence> {
    if (obligation.scopes.some(({ owner }) => !this.#activeOwners.has(owner.key))) {
      return Promise.reject(new Error("Lifecycle worker owner is permanently retired."));
    }
    this.starts += 1;
    this.#events.push("start");
    const startFailure = this.startFailures.shift();
    if (startFailure !== undefined) {
      throw startFailure;
    }
    const queued = this.#results.shift();
    if (queued === undefined) {
      return Promise.reject(new Error("Missing lifecycle worker result."));
    }
    return Promise.resolve(queued).then((result) => ({
      obligation,
      shards: Object.freeze(
        shards.map((shard) =>
          typeof result === "string"
            ? {
                status: "fulfilled" as const,
                shard,
                obligation,
                run: lifecycleRun(result),
                progress: lifecycleProgress(),
              }
            : {
                status: "rejected" as const,
                shard,
                obligation,
                cause: result.rejected,
                progress: lifecycleProgress(),
              },
        ),
      ),
    }));
  }

  stop(): void {
    this.stopCalls += 1;
    this.#events.push("stop");
  }

  awaitSettled(): Promise<void> {
    this.awaitCalls += 1;
    this.#events.push("await");
    const failure = this.awaitFailures.shift();
    if (failure !== undefined) {
      return Promise.reject(failure);
    }
    return this.awaitGates.shift() ?? Promise.resolve();
  }

  retire(): Promise<void> {
    this.retireCalls += 1;
    this.#events.push("retire");
    const failure = this.retireFailures.shift();
    const gate = this.retireGates.shift();
    return (gate ?? Promise.resolve()).then(() => {
      if (failure !== undefined) {
        throw failure;
      }
    });
  }

  stopOwners(ownerKeys: readonly string[]): void {
    this.stoppedOwners.push([...ownerKeys]);
    this.stopOwnerCalls += 1;
    this.#events.push("stopOwners");
    const failure = this.stopOwnerFailures.shift();
    if (failure !== undefined) {
      throw failure;
    }
  }

  awaitOwnersSettled(ownerKeys: readonly string[]): Promise<void> {
    this.awaitedOwners.push([...ownerKeys]);
    this.awaitOwnerCalls += 1;
    this.#events.push("awaitOwners");
    const failure = this.awaitOwnerFailures.shift();
    return failure === undefined ? Promise.resolve() : Promise.reject(failure);
  }

  retireOwners(ownerKeys: readonly string[]): Promise<void> {
    this.#events.push("retireOwners");
    this.retiredOwners.push([...ownerKeys]);
    for (const ownerKey of ownerKeys) {
      this.#activeOwners.delete(ownerKey);
    }
    const failure = this.retireOwnerFailures.shift();
    return failure === undefined ? Promise.resolve() : Promise.reject(failure);
  }
}

function lifecycleProgress() {
  return Object.freeze({
    runs: 1,
    processed: 0,
    accepted: 0,
    delivered: 0,
    failed: 0,
    failures: Object.freeze([]),
  });
}

function lifecycleRun(status: "FAILED" | "IDLE") {
  return Object.freeze({ status, ...lifecycleProgress() });
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

async function flushMicrotasks(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await Promise.resolve();
  }
}
