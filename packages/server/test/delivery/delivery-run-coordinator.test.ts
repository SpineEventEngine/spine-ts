import { InMemoryStorageFactory } from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import type { DeliveryLoopProgress, DeliveryLoopRun } from "../../src/delivery/delivery-loop.js";
import {
  DeliveryRunCoordinator,
  DeliveryRunQuiescenceError,
  deliveryRunWorker,
  type DeliveryRunObligation,
  type DeliveryRunScope,
  type DeliveryRunWorker,
} from "../../src/delivery/delivery-run-coordinator.js";
import type {
  DeliveryShardEvidence,
  DeliveryWorkerEvidence,
} from "../../src/delivery/delivery-worker.js";
import { DeliveryWorker } from "../../src/delivery/delivery-worker.js";
import {
  Delivery,
  deliveryAccess,
  type DeliveryDrainOutcome,
  type DeliveryRun,
} from "../../src/delivery/delivery.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";

describe("DeliveryRunCoordinator", () => {
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

  it("continues only PAUSED shards from mixed per-shard evidence", async () => {
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

    expect(worker.starts).toHaveLength(2);
    expect(entry(worker.starts, 0).shards.map((shard) => shard.index)).toEqual([0, 1, 2, 3, 4]);
    expect(entry(worker.starts, 1).shards.map((shard) => shard.index)).toEqual([0]);
    expect(entry(worker.starts, 1).obligation).toBe(entry(worker.starts, 0).obligation);
    expect(settlement.scopes.map(({ disposition }) => disposition)).toEqual([
      "IDLE",
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
    const active = deferred<DeliveryDrainOutcome>();
    const delivery = createDelivery();
    const restore = deliveryAccess.replace(delivery, () => active.promise);
    const configured = scope("first", 0, 1);
    const worker = new DeliveryWorker({
      delivery,
      shards: [configured.shard],
      node: "worker-a",
      onMessage: () => undefined,
    });
    const adapter = deliveryRunWorker(worker);
    const obligation = Object.freeze({ scopes: Object.freeze([configured]) });
    const running = adapter.start(obligation, [configured.shard]);
    let settled = false;

    const awaiting = adapter.awaitSettled().then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);

    active.resolve(deliveryOutcome());
    await running;
    await awaiting;
    expect(settled).toBe(true);
    restore();
  });

  it("permanently closes real worker starts during adapter retirement", async () => {
    const configured = scope("first", 0, 1);
    const worker = new DeliveryWorker({
      delivery: createDelivery(),
      shards: [configured.shard],
      node: "worker-a",
      onMessage: () => undefined,
    });
    const adapter = deliveryRunWorker(worker);

    adapter.stop();
    await adapter.awaitSettled();
    await adapter.retire();

    expect(() =>
      adapter.start(Object.freeze({ scopes: Object.freeze([configured]) }), [configured.shard]),
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
  readonly #results: WorkerResult[];
  readonly #events: string[];
  #active = 0;
  maxConcurrent = 0;
  stopCalls = 0;
  retireCalls = 0;
  retireFailure: Error | undefined;

  constructor(results: WorkerResult[], events: string[] = []) {
    this.#results = [...results];
    this.#events = events;
  }

  start(
    obligation: DeliveryRunObligation,
    shards: readonly ShardIndex[],
  ): Promise<DeliveryWorkerEvidence> {
    this.starts.push({ obligation, shards });
    this.#active += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.#active);
    const result = this.#results.shift();
    if (result === undefined) {
      throw new Error("Missing fake worker result.");
    }
    const promise = typeof result === "function" ? Promise.resolve(result(obligation)) : result;
    return promise.finally(() => {
      this.#active -= 1;
    });
  }

  stop(): void {
    this.stopCalls += 1;
    this.#events.push("stop");
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

function scope(targetTypeUrl: string, index: number, ofTotal: number): DeliveryRunScope {
  return Object.freeze({
    tenantId: `tenant-${targetTypeUrl}`,
    label: "UPDATE_SUBSCRIBER",
    targetTypeUrl,
    shard: new ShardIndex(index, ofTotal),
  });
}

function cloneScope(value: DeliveryRunScope): DeliveryRunScope {
  return Object.freeze({
    ...(value.tenantId === undefined ? {} : { tenantId: value.tenantId }),
    label: value.label,
    targetTypeUrl: value.targetTypeUrl,
    shard: new ShardIndex(value.shard.index, value.shard.ofTotal),
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

function deliveryOutcome(): DeliveryDrainOutcome {
  return Object.freeze({
    run: Object.freeze({
      status: "DRAINED",
      processed: 0,
      accepted: 0,
      delivered: 0,
      failed: 0,
      failures: Object.freeze([]),
    }) satisfies DeliveryRun,
    resumeCursor: Object.freeze({}),
    exhaustedSkippedScan: false,
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

function entry<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`Missing fixture entry at index ${String(index)}.`);
  }
  return value;
}
