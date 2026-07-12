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
import type {
  DeliveryRunObligation,
  DeliveryRunScope,
  DeliveryRunWorker,
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
    const runtimeWorkers: DeliveryRunWorker[] = [firstRuntimeWorker, secondRuntimeWorker];
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

    worker.stopOwners([firstScope.owner.key]);
    worker.stop();

    expect(firstRuntimeWorker.stopCalls).toBe(1);
    expect(secondRuntimeWorker.stopCalls).toBe(1);
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

describe("failed attachment rollback", () => {
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

  it("promotes a queued shared rollback to generation retirement before one fresh attach", async () => {
    const events: string[] = [];
    const oldWorker = new LifecycleWorker(events);
    const freshWorker = new LifecycleWorker(events);
    const workers = [oldWorker, freshWorker];
    let factoryCalls = 0;
    oldWorker.enqueue({ rejected: new Error("queued predecessor rejected") });
    oldWorker.awaitOwnerFailures.push(new Error("queued predecessor did not quiesce"));
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
    expect(oldWorker.events).toEqual(["start", "stopOwners", "awaitOwners", "stop", "await"]);

    await attachments.retryFailedStart();
    expect(activeRegistrationCount(attachments)).toBe(0);
    expect(oldWorker.events).toEqual([
      "start",
      "stopOwners",
      "awaitOwners",
      "stop",
      "await",
      "await",
      "report",
      "retire",
    ]);
    expect(oldWorker.stopOwnerCalls).toBe(1);
    expect(oldWorker.awaitOwnerCalls).toBe(1);
    expect(oldWorker.stopCalls).toBe(1);
    expect(oldWorker.awaitCalls).toBe(2);
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

type LifecycleResult = "FAILED" | "IDLE" | { readonly rejected: Error };

class LifecycleWorker implements EnvironmentGenerationWorker {
  readonly #results: LifecycleResult[] = [];
  readonly #events: string[];
  readonly awaitFailures: Error[] = [];
  readonly awaitGates: Promise<void>[] = [];
  readonly retireFailures: Error[] = [];
  readonly stopOwnerFailures: Error[] = [];
  readonly awaitOwnerFailures: Error[] = [];
  readonly retireOwnerFailures: Error[] = [];
  readonly retiredOwners: string[][] = [];
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
    this.addedOwners.push(runtime.owner.key);
  }

  start(
    obligation: DeliveryRunObligation,
    shards: readonly ShardIndex[],
  ): Promise<DeliveryWorkerEvidence> {
    this.starts += 1;
    this.#events.push("start");
    const result = this.#results.shift();
    if (result === undefined) {
      return Promise.reject(new Error("Missing lifecycle worker result."));
    }
    return Promise.resolve({
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
    });
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
    return failure === undefined ? Promise.resolve() : Promise.reject(failure);
  }

  stopOwners(ownerKeys: readonly string[]): void {
    void ownerKeys;
    this.stopOwnerCalls += 1;
    this.#events.push("stopOwners");
    const failure = this.stopOwnerFailures.shift();
    if (failure !== undefined) {
      throw failure;
    }
  }

  awaitOwnersSettled(ownerKeys: readonly string[]): Promise<void> {
    void ownerKeys;
    this.awaitOwnerCalls += 1;
    this.#events.push("awaitOwners");
    const failure = this.awaitOwnerFailures.shift();
    return failure === undefined ? Promise.resolve() : Promise.reject(failure);
  }

  retireOwners(ownerKeys: readonly string[]): Promise<void> {
    this.#events.push("retireOwners");
    this.retiredOwners.push([...ownerKeys]);
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
