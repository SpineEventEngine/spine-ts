import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import type { DeliveryLoopProgress, DeliveryLoopRun } from "../../src/delivery/delivery-loop.js";
import {
  DeliveryRunCoordinator,
  DeliveryRunQuiescenceError,
  deliveryRunWorkers,
  type DeliveryRunObligation,
  type DeliveryRunScope,
  type DeliveryRunWorker,
} from "../../src/delivery/delivery-run-coordinator.js";
import type {
  DeliveryShardEvidence,
  DeliveryWorkerEvidence,
} from "../../src/delivery/delivery-worker.js";
import { DeliveryWorker } from "../../src/delivery/delivery-worker.js";
import { Delivery } from "../../src/delivery/delivery.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";

describe("DeliveryRunCoordinator", () => {
  it("rejects constructing a delivery generation without a canonical scope", () => {
    const worker = new FakeRunWorker([]);

    expect(() => new DeliveryRunCoordinator({ scopes: [], worker })).toThrow(
      "Delivery run coordinator requires at least one configured scope.",
    );
  });

  it("rejects extending a generation after retirement permanently closes admission", async () => {
    const initial = scope("initial", 0, 2);
    const later = scope("later", 1, 2);
    const worker = new FakeRunWorker([]);
    const coordinator = new DeliveryRunCoordinator({ scopes: [initial], worker });

    await coordinator.retire(() => Promise.resolve());

    expect(() => {
      coordinator.configure([later]);
    }).toThrow("Delivery run coordinator admission is closed.");
    expect(worker.stopCalls).toBe(1);
    expect(worker.retireCalls).toBe(1);
  });

  it("keeps an owner barrier open for successor work admitted as active work settles", async () => {
    const activeEvidence = deferred<DeliveryWorkerEvidence>();
    const successorEvidence = deferred<DeliveryWorkerEvidence>();
    const selected = ownedScope("selected-owner", "selected", 0, 2);
    const sibling = ownedScope("sibling-owner", "sibling", 1, 2);
    const worker = new FakeRunWorker(
      [activeEvidence.promise, successorEvidence.promise],
      [],
      () => {
        coordinator.notify(sibling);
      },
    );
    const coordinator = new DeliveryRunCoordinator({ scopes: [selected, sibling], worker });

    const started = coordinator.start([selected]);
    await until(() => worker.starts.length === 1);
    const barrier = coordinator.awaitOwnersBarrier([selected.owner.key]);
    activeEvidence.resolve(
      workerEvidence(entry(worker.starts, 0).obligation, fulfilled(0, 2, "IDLE")),
    );
    await until(() => worker.starts.length === 2);
    let barrierSettled = false;
    void barrier.then(() => {
      barrierSettled = true;
    });
    await Promise.resolve();
    expect(barrierSettled).toBe(false);

    successorEvidence.resolve(
      workerEvidence(entry(worker.starts, 1).obligation, fulfilled(1, 2, "IDLE")),
    );
    await barrier;
    await started;
    expect(coordinator.settlement().scopes).toEqual(
      expect.arrayContaining([expect.objectContaining({ scope: sibling, disposition: "IDLE" })]),
    );
  });

  it("isolates equal readiness facts by generation-local owner", async () => {
    const first = ownedScope("owner-a", "shared", 0, 1);
    const second = ownedScope("owner-b", "shared", 0, 1);
    const firstFailure = new Error("first owner failed");
    const worker = new FakeRunWorker([
      (obligation) => workerEvidence(obligation, rejected(0, 1, firstFailure)),
      (obligation) => workerEvidence(obligation, fulfilled(0, 1, "IDLE")),
    ]);
    const coordinator = new DeliveryRunCoordinator({ scopes: [first, second], worker });

    const settlement = await coordinator.start([first, second]);

    expect(worker.starts).toHaveLength(2);
    expect(worker.maxConcurrent).toBe(1);
    expect(entry(worker.starts, 0).obligation.scopes).toEqual([first]);
    expect(entry(worker.starts, 1).obligation.scopes).toEqual([second]);
    expect(settlement.scopes).toEqual([
      expect.objectContaining({
        scope: first,
        disposition: "REJECTED",
        cause: firstFailure,
      }),
      expect.objectContaining({ scope: second, disposition: "IDLE" }),
    ]);
  });

  it("admits later configured scopes into the same generation", async () => {
    const first = scope("first", 0, 2);
    const second = scope("second", 1, 2);
    const worker = new FakeRunWorker([
      (obligation) => workerEvidence(obligation, fulfilled(0, 2, "IDLE")),
      (obligation) => workerEvidence(obligation, fulfilled(1, 2, "IDLE")),
    ]);
    const coordinator = new DeliveryRunCoordinator({ scopes: [first], worker });

    await coordinator.start([first]);
    coordinator.configure([second]);
    await coordinator.start([second]);

    expect(worker.starts).toHaveLength(2);
    expect(entry(worker.starts, 1).obligation.scopes).toEqual([second]);
  });

  it("removes one active owner's configured and settled scopes while preserving its sibling", async () => {
    const selectedRun = deferred<DeliveryWorkerEvidence>();
    const siblingRun = deferred<DeliveryWorkerEvidence>();
    const siblingAgain = deferred<DeliveryWorkerEvidence>();
    const selected = ownedScope("selected-owner", "selected", 0, 1);
    const sibling = ownedScope("sibling-owner", "sibling", 0, 1);
    const worker = new FakeRunWorker([
      selectedRun.promise,
      siblingRun.promise,
      siblingAgain.promise,
    ]);
    const coordinator = new DeliveryRunCoordinator({ scopes: [selected, sibling], worker });
    const removing = Promise.resolve().then(() => coordinator.removeOwners([selected.owner.key]));
    const initial = coordinator.start([selected, sibling]);
    await until(() => worker.starts.length === 1);
    selectedRun.resolve(
      workerEvidence(entry(worker.starts, 0).obligation, fulfilled(0, 1, "IDLE")),
    );
    await until(() => worker.starts.length === 2);
    siblingRun.resolve(workerEvidence(entry(worker.starts, 1).obligation, fulfilled(0, 1, "IDLE")));

    await initial;
    await removing;
    expect(coordinator.settlement().scopes).toEqual([
      expect.objectContaining({ scope: sibling, disposition: "IDLE" }),
    ]);
    expect(coordinator.configuredScopeCount).toBe(1);
    await expect(coordinator.start([selected])).rejects.toThrow(
      "Delivery run scope is not configured.",
    );

    const later = coordinator.start([sibling]);
    await until(() => worker.starts.length === 3);
    siblingAgain.resolve(
      workerEvidence(entry(worker.starts, 2).obligation, fulfilled(0, 1, "IDLE")),
    );
    await later;
  });

  it("removes selected pending readiness without disturbing active sibling work", async () => {
    const siblingRun = deferred<DeliveryWorkerEvidence>();
    const selected = ownedScope("pending-owner", "pending", 0, 1);
    const sibling = ownedScope("active-sibling", "active", 0, 1);
    const worker = new FakeRunWorker([
      siblingRun.promise,
      (obligation) => workerEvidence(obligation, fulfilled(0, 1, "IDLE")),
    ]);
    const coordinator = new DeliveryRunCoordinator({ scopes: [selected, sibling], worker });
    const active = coordinator.start([sibling]);
    coordinator.notify(selected);
    const removing = Promise.resolve().then(() => coordinator.removeOwners([selected.owner.key]));
    siblingRun.resolve(workerEvidence(entry(worker.starts, 0).obligation, fulfilled(0, 1, "IDLE")));

    await active;
    await removing;
    expect(worker.starts).toHaveLength(1);
    expect(coordinator.settlement()).toEqual({
      scopes: [expect.objectContaining({ scope: sibling, disposition: "IDLE" })],
      pending: [],
    });
    expect(coordinator.configuredScopeCount).toBe(1);
  });

  it("serializes starts and losslessly merges repeated disjoint readiness", async () => {
    const first = deferred<DeliveryWorkerEvidence>();
    const second = deferred<DeliveryWorkerEvidence>();
    const worker = new FakeRunWorker([first.promise, second.promise]);
    const scopes = [scope("first", 0, 3), scope("second", 1, 3), scope("third", 2, 3)];
    const coordinator = new DeliveryRunCoordinator({ scopes, worker });

    const settled = coordinator.start([entry(scopes, 0)]);
    coordinator.notify(entry(scopes, 1));
    coordinator.notify(entry(scopes, 2));
    coordinator.notify(cloneScope(entry(scopes, 1)));

    expect(worker.starts).toHaveLength(1);
    expect(entry(worker.starts, 0).obligation.scopes).toEqual([scopes[0]]);

    first.resolve(workerEvidence(entry(worker.starts, 0).obligation, fulfilled(0, 3, "IDLE")));
    await until(() => worker.starts.length === 2);

    expect(entry(worker.starts, 1).obligation.scopes).toEqual([scopes[1], scopes[2]]);
    expect(entry(worker.starts, 1).shards.map((shard) => shard.key())).toEqual(["1/3", "2/3"]);
    second.resolve(
      workerEvidence(
        entry(worker.starts, 1).obligation,
        fulfilled(1, 3, "IDLE"),
        fulfilled(2, 3, "IDLE"),
      ),
    );

    await settled;
    expect(worker.maxConcurrent).toBe(1);
  });

  it("publishes active work before a synchronous worker notification can reenter", async () => {
    const first = deferred<DeliveryWorkerEvidence>();
    const second = deferred<DeliveryWorkerEvidence>();
    const scopes = [scope("first", 0, 2), scope("second", 1, 2)];
    let notified = false;
    const worker = new FakeRunWorker([first.promise, second.promise], [], undefined, () => {
      if (!notified) {
        notified = true;
        coordinator.notify(entry(scopes, 1));
      }
    });
    const coordinator = new DeliveryRunCoordinator({ scopes, worker });

    const settled = coordinator.start([entry(scopes, 0)]);

    await until(() => worker.starts.length === 1);
    expect(worker.maxConcurrent).toBe(1);
    expect(worker.starts).toHaveLength(1);
    first.resolve(workerEvidence(entry(worker.starts, 0).obligation, fulfilled(0, 2, "IDLE")));
    await until(() => worker.starts.length === 2);
    second.resolve(workerEvidence(entry(worker.starts, 1).obligation, fulfilled(1, 2, "IDLE")));
    await settled;
  });

  it("pumps readiness accepted between drain settlement and active finalization", async () => {
    const scopes = [scope("first", 0, 2), scope("second", 1, 2)];
    let onStartSettled = () => undefined;
    const worker = new FakeRunWorker(
      [
        (obligation) => workerEvidence(obligation, fulfilled(0, 2, "IDLE")),
        (obligation) => workerEvidence(obligation, fulfilled(1, 2, "IDLE")),
      ],
      [],
      () => {
        onStartSettled();
      },
    );
    const coordinator = new DeliveryRunCoordinator({ scopes, worker });
    onStartSettled = () => {
      coordinator.notify(entry(scopes, 1));
    };

    await coordinator.start([entry(scopes, 0)]);
    await until(() => worker.starts.length === 2);

    expect(entry(worker.starts, 1).obligation.scopes).toEqual([scopes[1]]);
    expect(worker.maxConcurrent).toBe(1);
  });

  it("does not re-admit retired PAUSED compatibility evidence", async () => {
    const scopes = Array.from({ length: 5 }, (_, index) =>
      scope(`target-${String(index)}`, index, 5),
    );
    const worker = new FakeRunWorker([
      (obligation) =>
        workerEvidence(
          obligation,
          fulfilled(0, 5, "PAUSED"),
          fulfilled(1, 5, "FAILED"),
          fulfilled(2, 5, "SKIPPED"),
          fulfilled(3, 5, "STOPPED"),
          fulfilled(4, 5, "IDLE"),
        ),
      (obligation) => workerEvidence(obligation, fulfilled(0, 5, "IDLE")),
    ]);
    const coordinator = new DeliveryRunCoordinator({ scopes, worker });

    const settlement = await coordinator.start(scopes);

    expect(worker.starts).toHaveLength(1);
    expect(entry(worker.starts, 0).shards.map((shard) => shard.index)).toEqual([0, 1, 2, 3, 4]);
    expect(settlement.scopes.map(({ disposition }) => disposition)).toEqual([
      undefined,
      "PARKED",
      "PARKED",
      "STOPPED",
      "IDLE",
    ]);
  });

  it("parks rejected overlap while preserving disjoint pending readiness", async () => {
    const first = deferred<DeliveryWorkerEvidence>();
    const second = deferred<DeliveryWorkerEvidence>();
    const third = deferred<DeliveryWorkerEvidence>();
    const failure = new Error("shard failed");
    const worker = new FakeRunWorker([first.promise, second.promise, third.promise]);
    const scopes = [scope("first", 0, 3), scope("second", 1, 3), scope("third", 2, 3)];
    const coordinator = new DeliveryRunCoordinator({ scopes, worker });

    const settled = coordinator.start([entry(scopes, 0), entry(scopes, 1)]);
    coordinator.notify(cloneScope(entry(scopes, 0)));
    coordinator.notify(entry(scopes, 2));
    first.resolve(
      workerEvidence(
        entry(worker.starts, 0).obligation,
        rejected(0, 3, failure, { delivered: 2 }),
        fulfilled(1, 3, "IDLE"),
      ),
    );
    await until(() => worker.starts.length === 2);

    expect(entry(worker.starts, 1).obligation.scopes).toEqual([scopes[2]]);
    second.resolve(workerEvidence(entry(worker.starts, 1).obligation, fulfilled(2, 3, "IDLE")));
    const settlement = await settled;

    expect(settlement.scopes[0]).toMatchObject({
      scope: scopes[0],
      disposition: "REJECTED",
      cause: failure,
      progress: { delivered: 2 },
    });
    expect(settlement.scopes[0]?.cause).toBe(failure);
    expect(settlement.scopes[1]).toMatchObject({ disposition: "IDLE" });
    expect(settlement.scopes[2]).toMatchObject({ disposition: "IDLE" });

    const reconsidered = coordinator.start([cloneScope(entry(scopes, 0))]);
    await until(() => worker.starts.length === 3);
    expect(entry(worker.starts, 2).obligation.scopes).toEqual([scopes[0]]);
    third.resolve(workerEvidence(entry(worker.starts, 2).obligation, fulfilled(0, 3, "IDLE")));
    await reconsidered;
  });

  it("contains an immediately rejected worker promise without self-restart", async () => {
    const failure = new Error("worker start failed");
    const worker = new FakeRunWorker([Promise.reject(failure)]);
    const configured = scope("first", 0, 1);
    const coordinator = new DeliveryRunCoordinator({ scopes: [configured], worker });

    const settlement = await coordinator.start([configured]);

    expect(worker.starts).toHaveLength(1);
    expect(settlement.scopes).toMatchObject([{ disposition: "REJECTED", cause: failure }]);
    await Promise.resolve();
    expect(worker.starts).toHaveLength(1);
  });

  it("normalizes a non-Error worker start throw into one stable coordinator fault", async () => {
    const configured = scope("first", 0, 1);
    const worker: DeliveryRunWorker = {
      get start(): DeliveryRunWorker["start"] {
        // Deliberately emulate an invalid external worker implementation.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "worker start rejected";
      },
      stop() {
        // The malformed start never creates active worker resources.
      },
      awaitSettled: () => Promise.resolve(),
      retire: () => Promise.resolve(),
    };
    const coordinator = new DeliveryRunCoordinator({ scopes: [configured], worker });

    const first = await coordinator.start([configured]).catch((reason: unknown) => reason);
    const second = await coordinator.start([configured]).catch((reason: unknown) => reason);

    expect(first).toEqual(new Error("worker start rejected"));
    expect(second).toBe(first);
  });

  it("notifies a settlement observer once when rejected start evidence is recorded, never on reads", async () => {
    const failure = new Error("worker start failed");
    const configured = scope("first", 0, 1);
    const observed: unknown[] = [];
    const worker = new FakeRunWorker([Promise.reject(failure)]);
    const coordinator = new DeliveryRunCoordinator({
      scopes: [configured],
      worker,
      onSettlement: (settlement) => observed.push(settlement),
    });

    await coordinator.start([configured]);
    coordinator.settlement();
    coordinator.settlement();

    expect(observed).toEqual([
      expect.objectContaining({
        scope: configured,
        disposition: "REJECTED",
        cause: failure,
      }),
    ]);
  });

  it("emits only meaningful settlement changes", async () => {
    const failure = new Error("worker start failed");
    const changedFailure = new Error("worker start failed");
    const configured = scope("first", 0, 1);
    const observed: unknown[] = [];
    const worker = new FakeRunWorker([
      (obligation) => workerEvidence(obligation, rejected(0, 1, failure, { delivered: 1 })),
      (obligation) => workerEvidence(obligation, rejected(0, 1, failure, { delivered: 1 })),
      (obligation) => workerEvidence(obligation, rejected(0, 1, failure, { delivered: 2 })),
      (obligation) => workerEvidence(obligation, rejected(0, 1, changedFailure, { delivered: 2 })),
      (obligation) => workerEvidence(obligation, fulfilled(0, 1, "IDLE")),
    ]);
    const coordinator = new DeliveryRunCoordinator({
      scopes: [configured],
      worker,
      onSettlement: (settlement) => observed.push(settlement),
    });

    await coordinator.start([configured]);
    await coordinator.start([configured]);
    await coordinator.start([configured]);
    await coordinator.start([configured]);
    await coordinator.start([configured]);

    expect(observed).toMatchObject([
      { disposition: "REJECTED", cause: failure, progress: { delivered: 1 } },
      { disposition: "REJECTED", cause: failure, progress: { delivered: 2 } },
      { disposition: "REJECTED", cause: changedFailure, progress: { delivered: 2 } },
      { disposition: "IDLE", progress: { delivered: 0 } },
    ]);
  });

  it("faults the coordinator when its settlement observer violates an invariant", async () => {
    const failure = new Error("observer invariant failed");
    const configured = scope("first", 0, 1);
    const worker = new FakeRunWorker([
      (obligation) => workerEvidence(obligation, fulfilled(0, 1, "IDLE")),
    ]);
    const coordinator = new DeliveryRunCoordinator({
      scopes: [configured],
      worker,
      onSettlement() {
        throw failure;
      },
    });

    await expect(coordinator.start([configured])).rejects.toBe(failure);
    await expect(coordinator.start([configured])).rejects.toBe(failure);
    await expect(coordinator.awaitOwnersBarrier([configured.owner.key])).rejects.toBe(failure);
  });

  it("faults synchronously and consumes rejection when a settlement observer returns a promise", async () => {
    const asynchronousFailure = new Error("asynchronous observer failed");
    const configured = scope("first", 0, 1);
    const worker = new FakeRunWorker([
      (obligation) => workerEvidence(obligation, fulfilled(0, 1, "IDLE")),
    ]);
    const coordinator = new DeliveryRunCoordinator({
      scopes: [configured],
      worker,
      async onSettlement() {
        await Promise.resolve();
        throw asynchronousFailure;
      },
    });

    await expect(coordinator.start([configured])).rejects.toThrow(
      "Delivery run settlement observer must complete synchronously.",
    );
    await flushMicrotasks();
    await expect(coordinator.awaitOwnersBarrier([configured.owner.key])).rejects.toThrow(
      "Delivery run settlement observer must complete synchronously.",
    );
  });

  it("resolves an empty-owner barrier without waiting for active sibling work", async () => {
    const siblingActive = deferred<DeliveryWorkerEvidence>();
    const sibling = ownedScope("sibling-owner", "sibling", 0, 1);
    const worker = new FakeRunWorker([siblingActive.promise]);
    const coordinator = new DeliveryRunCoordinator({ scopes: [sibling], worker });
    const running = coordinator.start([sibling]);
    let barrierResolved = false;

    void coordinator.awaitOwnersBarrier([]).then(() => {
      barrierResolved = true;
    });
    await flushMicrotasks();

    expect(barrierResolved).toBe(true);
    siblingActive.resolve(
      workerEvidence(entry(worker.starts, 0).obligation, fulfilled(0, 1, "IDLE")),
    );
    await running;
  });

  it("barriers a selected owner through active and admitted successor work without removing siblings", async () => {
    const selectedActive = deferred<DeliveryWorkerEvidence>();
    const siblingActive = deferred<DeliveryWorkerEvidence>();
    const selected = ownedScope("selected-owner", "selected", 0, 1);
    const sibling = ownedScope("sibling-owner", "sibling", 0, 1);
    const worker = new FakeRunWorker([selectedActive.promise, siblingActive.promise]);
    const coordinator = new DeliveryRunCoordinator({ scopes: [selected, sibling], worker });

    const running = coordinator.start([selected]);
    coordinator.notify(sibling);
    const barrier = coordinator.awaitOwnersBarrier([selected.owner.key]);
    selectedActive.resolve(
      workerEvidence(entry(worker.starts, 0).obligation, fulfilled(0, 1, "IDLE")),
    );
    await until(() => worker.starts.length === 2);
    siblingActive.resolve(
      workerEvidence(entry(worker.starts, 1).obligation, fulfilled(0, 1, "IDLE")),
    );

    await Promise.all([running, barrier]);
    expect(coordinator.settlement()).toEqual({
      scopes: [
        expect.objectContaining({ scope: selected, disposition: "IDLE" }),
        expect.objectContaining({ scope: sibling, disposition: "IDLE" }),
      ],
      pending: [],
    });
    expect(coordinator.configuredScopeCount).toBe(2);
  });

  it("propagates an observer invariant fault through an active selected-owner barrier", async () => {
    const active = deferred<DeliveryWorkerEvidence>();
    const failure = new Error("observer invariant failed");
    const selected = ownedScope("selected-owner", "selected", 0, 1);
    const worker = new FakeRunWorker([active.promise]);
    const coordinator = new DeliveryRunCoordinator({
      scopes: [selected],
      worker,
      onSettlement() {
        throw failure;
      },
    });

    const running = coordinator.start([selected]);
    const barrier = coordinator.awaitOwnersBarrier([selected.owner.key]);
    active.resolve(workerEvidence(entry(worker.starts, 0).obligation, fulfilled(0, 1, "IDLE")));

    await expect(running).rejects.toBe(failure);
    await expect(barrier).rejects.toBe(failure);
  });

  it("keeps a synchronous worker start throw fatal", async () => {
    const failure = new Error("worker lifecycle invariant failed");
    const configured = scope("first", 0, 1);
    const worker = new FakeRunWorker([]);
    worker.startFailure = failure;
    const coordinator = new DeliveryRunCoordinator({ scopes: [configured], worker });

    await expect(coordinator.start([configured])).rejects.toBe(failure);

    expect(coordinator.settlement().scopes).toEqual([]);
    await expect(coordinator.start([configured])).rejects.toBe(failure);
  });

  it("leaves readiness received during the one successor pending for an external start", async () => {
    const first = deferred<DeliveryWorkerEvidence>();
    const second = deferred<DeliveryWorkerEvidence>();
    const third = deferred<DeliveryWorkerEvidence>();
    const worker = new FakeRunWorker([first.promise, second.promise, third.promise]);
    const scopes = [scope("first", 0, 3), scope("second", 1, 3), scope("third", 2, 3)];
    const coordinator = new DeliveryRunCoordinator({ scopes, worker });

    const initial = coordinator.start([entry(scopes, 0)]);
    coordinator.notify(entry(scopes, 1));
    first.resolve(workerEvidence(entry(worker.starts, 0).obligation, fulfilled(0, 3, "IDLE")));
    await until(() => worker.starts.length === 2);

    coordinator.notify(entry(scopes, 2));
    second.resolve(workerEvidence(entry(worker.starts, 1).obligation, fulfilled(1, 3, "IDLE")));
    await initial;

    expect(worker.starts).toHaveLength(2);
    expect(coordinator.settlement().pending).toEqual([scopes[2]]);

    const later = coordinator.start([entry(scopes, 2)]);
    await until(() => worker.starts.length === 3);
    third.resolve(workerEvidence(entry(worker.starts, 2).obligation, fulfilled(2, 3, "IDLE")));
    await later;
  });

  it("bounds retained settlement by the configured canonical scope domain", async () => {
    const configured = scope("first", 0, 1);
    const worker = new FakeRunWorker(
      Array.from(
        { length: 20 },
        () => (obligation: DeliveryRunObligation) =>
          workerEvidence(obligation, fulfilled(0, 1, "IDLE")),
      ),
    );
    const coordinator = new DeliveryRunCoordinator({ scopes: [configured], worker });

    for (let index = 0; index < 20; index += 1) {
      await coordinator.start([cloneScope(configured)]);
    }

    expect(coordinator.settlement().scopes).toHaveLength(1);
    await expect(coordinator.start([scope("unknown", 0, 1)])).rejects.toThrow(
      "Delivery run scope is not configured.",
    );
  });

  it("validates a mixed admission before mutating pending scopes", async () => {
    const scopes = [scope("first", 0, 2), scope("second", 1, 2)];
    const worker = new FakeRunWorker([
      (obligation) => workerEvidence(obligation, fulfilled(1, 2, "IDLE")),
    ]);
    const coordinator = new DeliveryRunCoordinator({ scopes, worker });

    await expect(coordinator.start([entry(scopes, 0), scope("unknown", 0, 2)])).rejects.toThrow(
      "Delivery run scope is not configured.",
    );
    await coordinator.start([entry(scopes, 1)]);

    expect(worker.starts).toHaveLength(1);
    expect(entry(worker.starts, 0).obligation.scopes).toEqual([scopes[1]]);
  });

  it("surfaces evidence-processing failures without classifying worker rejection", async () => {
    const configured = scope("first", 0, 1);
    const worker = new FakeRunWorker([
      (obligation) => malformedWorkerEvidence(obligation, configured.ready.shard),
    ]);
    const coordinator = new DeliveryRunCoordinator({ scopes: [configured], worker });

    await expect(coordinator.start([configured])).rejects.toThrow(TypeError);

    expect(coordinator.settlement().scopes).toEqual([]);
  });

  it("surfaces a notify-only invariant fault at the next observable start", async () => {
    const configured = scope("first", 0, 1);
    const worker = new FakeRunWorker([
      (obligation) => malformedWorkerEvidence(obligation, configured.ready.shard),
      (obligation) => workerEvidence(obligation, fulfilled(0, 1, "IDLE")),
    ]);
    const coordinator = new DeliveryRunCoordinator({ scopes: [configured], worker });

    coordinator.notify(configured);
    await until(() => worker.starts.length === 1);
    await flushMicrotasks();

    await expect(coordinator.start([configured])).rejects.toThrow(TypeError);
    expect(worker.starts).toHaveLength(1);
  });

  it("retires after a notify-only fault and aggregates every final failure", async () => {
    const configured = scope("first", 0, 1);
    const events: string[] = [];
    const reportingFailure = new Error("reporting failed");
    const cleanupFailure = new Error("cleanup failed");
    const worker = new FakeRunWorker(
      [(obligation) => malformedWorkerEvidence(obligation, configured.ready.shard)],
      events,
    );
    worker.retireFailure = cleanupFailure;
    const coordinator = new DeliveryRunCoordinator({ scopes: [configured], worker });

    coordinator.notify(configured);
    await until(() => worker.starts.length === 1);
    await flushMicrotasks();
    const thrown = await coordinator
      .retire(() => {
        events.push("report");
        return Promise.reject(reportingFailure);
      })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([
      expect.any(TypeError),
      reportingFailure,
      cleanupFailure,
    ]);
    expect(events).toEqual(["stop", "await", "report", "retire"]);
    expect(coordinator.replacementSafe).toBe(true);
    expect(coordinator.retired).toBe(true);
  });

  it.each(["top-level", "shard"] as const)(
    "rejects %s obligation identity mismatch",
    async (kind) => {
      const configured = scope("first", 0, 1);
      const worker = new FakeRunWorker([
        (obligation) => identityMismatchEvidence(kind, obligation, configured.ready.shard),
      ]);
      const coordinator = new DeliveryRunCoordinator({ scopes: [configured], worker });

      await expect(coordinator.start([configured])).rejects.toThrow(
        kind === "top-level"
          ? "Delivery worker evidence obligation does not match the current obligation."
          : "Delivery worker shard obligation does not match the current obligation.",
      );
      expect(coordinator.settlement().scopes).toEqual([]);
    },
  );

  it.each(["missing", "duplicate", "foreign"] as const)(
    "rejects %s shard evidence outside the exact requested domain",
    async (kind) => {
      const scopes = [scope("first", 0, 2), scope("second", 1, 2)];
      const worker = new FakeRunWorker([
        (obligation) => shardDomainMismatchEvidence(kind, obligation),
      ]);
      const coordinator = new DeliveryRunCoordinator({ scopes, worker });

      await expect(coordinator.start(scopes)).rejects.toThrow(
        "Delivery worker evidence does not match the requested shard domain.",
      );
      expect(coordinator.settlement().scopes).toEqual([]);
    },
  );

  it("retires in stop, quiescence, report, and cleanup order", async () => {
    const events: string[] = [];
    const worker = new FakeRunWorker([], events);
    const coordinator = new DeliveryRunCoordinator({ scopes: [scope("first", 0, 1)], worker });

    await coordinator.retire(() => {
      events.push("report");
      return Promise.resolve();
    });

    expect(events).toEqual(["stop", "await", "report", "retire"]);
    expect(coordinator.replacementSafe).toBe(true);
    expect(coordinator.retired).toBe(true);
  });

  it("publishes retirement before a synchronous stop callback can reenter", async () => {
    const events: string[] = [];
    let reentered = false;
    let reentrant: Promise<void> | undefined;
    const onReport = () => {
      events.push("report");
      return Promise.resolve();
    };
    const worker = new FakeRunWorker([], events, undefined, undefined, () => {
      if (!reentered) {
        reentered = true;
        reentrant = coordinator.retire(onReport);
      }
    });
    const coordinator = new DeliveryRunCoordinator({
      scopes: [scope("first", 0, 1)],
      worker,
    });

    const retiring = coordinator.retire(onReport);
    if (reentrant === undefined) {
      throw new Error("Synchronous stop callback did not reenter retirement.");
    }
    await Promise.all([retiring, reentrant]);

    expect(events).toEqual(["stop", "await", "report", "retire"]);
    expect(worker.stopCalls).toBe(1);
    expect(worker.retireCalls).toBe(1);
    expect(reentrant).toBe(retiring);
  });

  it("stops before awaiting an active start and reports only after it settles", async () => {
    const active = deferred<DeliveryWorkerEvidence>();
    const events: string[] = [];
    const configured = scope("first", 0, 1);
    const worker = new FakeRunWorker([active.promise], events);
    const coordinator = new DeliveryRunCoordinator({ scopes: [configured], worker });
    const running = coordinator.start([configured]);
    const retiring = coordinator.retire(() => {
      events.push("report");
      return Promise.resolve();
    });

    await Promise.resolve();
    expect(events).toEqual(["stop"]);
    expect(coordinator.replacementSafe).toBe(false);

    active.resolve(workerEvidence(entry(worker.starts, 0).obligation, fulfilled(0, 1, "STOPPED")));
    await running;
    await retiring;

    expect(events).toEqual(["stop", "await", "report", "retire"]);
    expect(coordinator.replacementSafe).toBe(true);
  });

  it("withholds replacement safety while reporting is still pending", async () => {
    const reporting = deferred<undefined>();
    const worker = new FakeRunWorker([]);
    const coordinator = new DeliveryRunCoordinator({ scopes: [scope("first", 0, 1)], worker });
    let reportingStarted = false;

    const retiring = coordinator.retire(() => {
      reportingStarted = true;
      return reporting.promise;
    });
    await until(() => reportingStarted);

    expect(coordinator.replacementSafe).toBe(false);

    reporting.resolve(undefined);
    await retiring;
    expect(coordinator.replacementSafe).toBe(true);
  });

  it("attempts cleanup and remains replacement-safe when reporting rejects", async () => {
    const events: string[] = [];
    const reportingFailure = new Error("reporting failed");
    const worker = new FakeRunWorker([], events);
    const coordinator = new DeliveryRunCoordinator({ scopes: [scope("first", 0, 1)], worker });

    await expect(
      coordinator.retire(() => {
        events.push("report");
        return Promise.reject(reportingFailure);
      }),
    ).rejects.toBe(reportingFailure);

    expect(events).toEqual(["stop", "await", "report", "retire"]);
    expect(coordinator.replacementSafe).toBe(true);
    expect(coordinator.retired).toBe(true);
  });

  it("preserves cleanup failure after proven quiescence", async () => {
    const cleanupFailure = new Error("cleanup failed");
    const worker = new FakeRunWorker([]);
    worker.retireFailure = cleanupFailure;
    const coordinator = new DeliveryRunCoordinator({ scopes: [scope("first", 0, 1)], worker });

    await expect(coordinator.retire(() => Promise.resolve())).rejects.toBe(cleanupFailure);

    expect(coordinator.replacementSafe).toBe(true);
    expect(coordinator.retired).toBe(true);
  });

  it("aggregates reporting and cleanup failures after attempting both", async () => {
    const reportingFailure = new Error("reporting failed");
    const cleanupFailure = new Error("cleanup failed");
    const worker = new FakeRunWorker([]);
    worker.retireFailure = cleanupFailure;
    const coordinator = new DeliveryRunCoordinator({ scopes: [scope("first", 0, 1)], worker });

    const thrown = await coordinator
      .retire(() => Promise.reject(reportingFailure))
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([reportingFailure, cleanupFailure]);
    expect(coordinator.replacementSafe).toBe(true);
    expect(coordinator.retired).toBe(true);
  });

  it("retains a final rejection without repeating retirement phases", async () => {
    const events: string[] = [];
    const cleanupFailure = new Error("cleanup failed");
    const worker = new FakeRunWorker([], events);
    worker.retireFailure = cleanupFailure;
    const coordinator = new DeliveryRunCoordinator({ scopes: [scope("first", 0, 1)], worker });
    let reports = 0;
    const onReport = () => {
      reports += 1;
      events.push("report");
      return Promise.resolve();
    };

    await expect(coordinator.retire(onReport)).rejects.toBe(cleanupFailure);
    await expect(coordinator.retire(onReport)).rejects.toBe(cleanupFailure);

    expect(events).toEqual(["stop", "await", "report", "retire"]);
    expect(reports).toBe(1);
    expect(worker.stopCalls).toBe(1);
    expect(worker.retireCalls).toBe(1);
    expect(coordinator.replacementSafe).toBe(true);
    expect(coordinator.retired).toBe(true);
  });

  it("retries unsafe quiescence without repeating stop or later phases", async () => {
    const events: string[] = [];
    const failure = new Error("quiescence unavailable");
    const worker = new FakeRunWorker([], events);
    worker.awaitFailures.push(failure);
    const coordinator = new DeliveryRunCoordinator({ scopes: [scope("first", 0, 1)], worker });
    const onReport = () => {
      events.push("report");
      return Promise.resolve();
    };

    const first = await coordinator.retire(onReport).catch((error: unknown) => error);

    expect(first).toBeInstanceOf(DeliveryRunQuiescenceError);
    expect((first as DeliveryRunQuiescenceError).cause).toBe(failure);
    expect(coordinator.replacementSafe).toBe(false);
    expect(coordinator.retired).toBe(false);
    expect(events).toEqual(["stop", "await"]);

    await coordinator.retire(onReport);

    expect(events).toEqual(["stop", "await", "await", "report", "retire"]);
    expect(coordinator.replacementSafe).toBe(true);
    expect(coordinator.retired).toBe(true);
  });

  it("retries a throwing stop before any later retirement phase", async () => {
    const events: string[] = [];
    const failure = new Error("stop failed");
    const worker = new FakeRunWorker([], events);
    worker.stopFailures.push(failure);
    const coordinator = new DeliveryRunCoordinator({ scopes: [scope("first", 0, 1)], worker });
    const onReport = () => {
      events.push("report");
      return Promise.resolve();
    };

    const first = await coordinator.retire(onReport).catch((error: unknown) => error);

    expect(first).toBeInstanceOf(DeliveryRunQuiescenceError);
    expect((first as DeliveryRunQuiescenceError).cause).toBe(failure);
    expect(coordinator.replacementSafe).toBe(false);
    expect(coordinator.retired).toBe(false);
    expect(events).toEqual(["stop"]);

    await coordinator.retire(onReport);

    expect(events).toEqual(["stop", "stop", "await", "report", "retire"]);
    expect(worker.stopCalls).toBe(2);
    expect(worker.retireCalls).toBe(1);
    expect(coordinator.replacementSafe).toBe(true);
  });

  it("makes completed retirement idempotent and closes later admission", async () => {
    const worker = new FakeRunWorker([]);
    const configured = scope("first", 0, 1);
    const coordinator = new DeliveryRunCoordinator({ scopes: [configured], worker });
    let reports = 0;
    const onReport = () => {
      reports += 1;
      return Promise.resolve();
    };

    await coordinator.retire(onReport);
    await coordinator.retire(onReport);
    coordinator.notify(configured);

    expect(reports).toBe(1);
    expect(worker.stopCalls).toBe(1);
    expect(worker.retireCalls).toBe(1);
    expect(worker.starts).toHaveLength(0);
    await expect(coordinator.start([configured])).rejects.toThrow(
      "Delivery run coordinator admission is closed.",
    );
  });

  it("awaits active work through the real T-0036 worker adapter", async () => {
    const delivery = createDelivery();
    const configured = scope("first", 0, 1);
    const worker = new DeliveryWorker({
      delivery,
      shards: [configured.ready.shard],
      onMessage: () => undefined,
    });
    const adapter = deliveryRunWorkers.worker(worker);
    const obligation = Object.freeze({ scopes: Object.freeze([configured]) });
    const running = adapter.start(obligation, [configured.ready.shard]);
    await running;
    await expect(adapter.awaitSettled()).resolves.toBeUndefined();
  });

  it("permanently closes real worker starts during adapter retirement", async () => {
    const configured = scope("first", 0, 1);
    const worker = new DeliveryWorker({
      delivery: createDelivery(),
      shards: [configured.ready.shard],
      onMessage: () => undefined,
    });
    const adapter = deliveryRunWorkers.worker(worker);

    adapter.stop();
    await adapter.awaitSettled();
    await adapter.retire();

    expect(() =>
      adapter.start(Object.freeze({ scopes: Object.freeze([configured]) }), [
        configured.ready.shard,
      ]),
    ).toThrow("DeliveryWorker is permanently retired.");
    expect(() => worker.start()).toThrow("DeliveryWorker is permanently retired.");
  });
});

type WorkerResult =
  Promise<DeliveryWorkerEvidence> | ((obligation: DeliveryRunObligation) => DeliveryWorkerEvidence);

class FakeRunWorker implements DeliveryRunWorker {
  readonly starts: {
    readonly obligation: DeliveryRunObligation;
    readonly shards: readonly ShardIndex[];
  }[] = [];
  readonly awaitFailures: Error[] = [];
  readonly stopFailures: Error[] = [];
  readonly #results: WorkerResult[];
  readonly #events: string[];
  #onStartSettled: (() => void) | undefined;
  readonly #onStart: (() => void) | undefined;
  readonly #onStop: (() => void) | undefined;
  #active = 0;
  maxConcurrent = 0;
  stopCalls = 0;
  retireCalls = 0;
  retireFailure: Error | undefined;
  startFailure: Error | undefined;

  constructor(
    results: WorkerResult[],
    events: string[] = [],
    onStartSettled?: () => void,
    onStart?: () => void,
    onStop?: () => void,
  ) {
    this.#results = [...results];
    this.#events = events;
    this.#onStartSettled = onStartSettled;
    this.#onStart = onStart;
    this.#onStop = onStop;
  }

  start(
    obligation: DeliveryRunObligation,
    shards: readonly ShardIndex[],
  ): Promise<DeliveryWorkerEvidence> {
    if (this.startFailure !== undefined) {
      throw this.startFailure;
    }
    this.starts.push({ obligation, shards });
    this.#active += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.#active);
    this.#onStart?.();
    const result = this.#results.shift();
    if (result === undefined) {
      throw new Error("Missing fake worker result.");
    }
    const promise = typeof result === "function" ? Promise.resolve(result(obligation)) : result;
    const observed = promise.finally(() => {
      this.#active -= 1;
    });
    const onStartSettled = this.#onStartSettled;
    this.#onStartSettled = undefined;
    if (onStartSettled !== undefined) {
      void observed.then(
        () => {
          queueMicrotask(() => {
            queueMicrotask(onStartSettled);
          });
        },
        () => undefined,
      );
    }
    return observed;
  }

  stop(): void {
    this.stopCalls += 1;
    this.#events.push("stop");
    this.#onStop?.();
    const failure = this.stopFailures.shift();
    if (failure !== undefined) {
      throw failure;
    }
  }

  awaitSettled(): Promise<void> {
    this.#events.push("await");
    const failure = this.awaitFailures.shift();
    if (failure !== undefined) {
      return Promise.reject(failure);
    }
    return Promise.resolve();
  }

  retire(): Promise<void> {
    this.retireCalls += 1;
    this.#events.push("retire");
    if (this.retireFailure !== undefined) {
      return Promise.reject(this.retireFailure);
    }
    return Promise.resolve();
  }
}

function scope(
  targetTypeUrl: string,
  index: number,
  ofTotal: number,
  ownerKey = "owner",
): DeliveryRunScope {
  return Object.freeze({
    owner: Object.freeze({ key: ownerKey }),
    ready: Object.freeze({
      tenantId: `tenant-${targetTypeUrl}`,
      label: "UPDATE_SUBSCRIBER",
      targetTypeUrl,
      shard: new ShardIndex(index, ofTotal),
    }),
  });
}

function ownedScope(
  ownerKey: string,
  targetTypeUrl: string,
  index: number,
  ofTotal: number,
): DeliveryRunScope {
  return scope(targetTypeUrl, index, ofTotal, ownerKey);
}

function cloneScope(value: DeliveryRunScope): DeliveryRunScope {
  return Object.freeze({
    owner: Object.freeze({ key: value.owner.key }),
    ready: Object.freeze({
      ...(value.ready.tenantId === undefined ? {} : { tenantId: value.ready.tenantId }),
      label: value.ready.label,
      targetTypeUrl: value.ready.targetTypeUrl,
      shard: new ShardIndex(value.ready.shard.index, value.ready.shard.ofTotal),
    }),
  });
}

function fulfilled(
  index: number,
  ofTotal: number,
  status: DeliveryLoopRun["status"],
): (obligation: DeliveryRunObligation) => DeliveryShardEvidence {
  return (obligation) =>
    Object.freeze({
      status: "fulfilled",
      shard: new ShardIndex(index, ofTotal),
      obligation,
      run: loopRun(status),
      progress: loopProgress(),
    });
}

function rejected(
  index: number,
  ofTotal: number,
  cause: unknown,
  overrides: Partial<DeliveryLoopProgress> = {},
): (obligation: DeliveryRunObligation) => DeliveryShardEvidence {
  return (obligation) =>
    Object.freeze({
      status: "rejected",
      shard: new ShardIndex(index, ofTotal),
      obligation,
      cause,
      progress: loopProgress(overrides),
    });
}

function workerEvidence(
  obligation: DeliveryRunObligation,
  ...factories: readonly ((obligation: DeliveryRunObligation) => DeliveryShardEvidence)[]
): DeliveryWorkerEvidence {
  return Object.freeze({
    obligation,
    shards: Object.freeze(factories.map((factory) => factory(obligation))),
  });
}

function malformedWorkerEvidence(
  obligation: DeliveryRunObligation,
  shard: ShardIndex,
): DeliveryWorkerEvidence {
  return Object.freeze({
    obligation,
    shards: Object.freeze([
      Object.freeze({
        status: "fulfilled",
        shard,
        obligation,
        run: loopRun("IDLE"),
        progress: Object.freeze({ ...loopProgress(), failures: undefined }),
      }),
    ]),
  }) as unknown as DeliveryWorkerEvidence;
}

function identityMismatchEvidence(
  kind: "top-level" | "shard",
  obligation: DeliveryRunObligation,
  shard: ShardIndex,
): DeliveryWorkerEvidence {
  const foreign = Object.freeze({ scopes: obligation.scopes });
  return Object.freeze({
    obligation: kind === "top-level" ? foreign : obligation,
    shards: Object.freeze([
      Object.freeze({
        status: "fulfilled",
        shard,
        obligation: kind === "shard" ? foreign : obligation,
        run: loopRun("IDLE"),
        progress: loopProgress(),
      }),
    ]),
  });
}

function shardDomainMismatchEvidence(
  kind: "missing" | "duplicate" | "foreign",
  obligation: DeliveryRunObligation,
): DeliveryWorkerEvidence {
  const requested = [fulfilledEvidence(obligation, new ShardIndex(0, 2))];
  if (kind === "duplicate") {
    requested.push(fulfilledEvidence(obligation, new ShardIndex(0, 2)));
  }
  if (kind === "foreign") {
    requested.push(fulfilledEvidence(obligation, new ShardIndex(0, 3)));
  }
  return Object.freeze({ obligation, shards: Object.freeze(requested) });
}

function fulfilledEvidence(
  obligation: DeliveryRunObligation,
  shard: ShardIndex,
): DeliveryShardEvidence {
  return Object.freeze({
    status: "fulfilled",
    shard,
    obligation,
    run: loopRun("IDLE"),
    progress: loopProgress(),
  });
}

function loopRun(status: DeliveryLoopRun["status"]): DeliveryLoopRun {
  return Object.freeze({
    status,
    runs: 1,
    processed: 0,
    accepted: 0,
    delivered: 0,
    failed: status === "FAILED" ? 1 : 0,
    failures: Object.freeze([]),
  });
}

function loopProgress(overrides: Partial<DeliveryLoopProgress> = {}): DeliveryLoopProgress {
  return Object.freeze({
    runs: 1,
    processed: 0,
    accepted: 0,
    delivered: 0,
    failed: 0,
    failures: Object.freeze([]),
    ...overrides,
  });
}

function createDelivery(): Delivery {
  return new Delivery({
    context: { name: "Tasks", multitenant: false },
    storageFactory: new InMemoryStorageFactory(),
  });
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error("Condition was not reached.");
}

async function flushMicrotasks(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await Promise.resolve();
  }
}

function entry<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`Missing fixture entry at index ${String(index)}.`);
  }
  return value;
}
