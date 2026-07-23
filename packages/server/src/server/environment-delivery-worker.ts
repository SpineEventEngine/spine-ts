import type { StorageContext, StorageFactory } from "@spine-ts/storage";

import type { ContextDeliveryDescriptor, DeliveryTenantScope } from "../context/bounded-context.js";
import {
  deliveryRunWorker,
  type DeliveryRunObligation,
  type DeliveryRunOwner,
  type DeliveryRunScope,
  type DeliveryRunWorker,
} from "../delivery/delivery-run-coordinator.js";
import { DeliveryBuilder, UniformAcrossAllShards } from "../delivery/delivery-builder.js";
import { Delivery, type OnDeliveryMessage } from "../delivery/delivery.js";
import type { DeliveryOperationOptions } from "../delivery/delivery-ports.js";
import { DeliverySupervisor, type DeliveryShardUpdate } from "../delivery/delivery-supervisor.js";
import type { DeliveryWorkerEvidence } from "../delivery/delivery-worker.js";
import { DeliveryWorker } from "../delivery/delivery-worker.js";
import { ShardIndex } from "../delivery/shard-index.js";

/** @internal One exact descriptor/storage/tenant runtime in an environment generation. */
export interface EnvironmentDeliveryRuntime {
  readonly owner: DeliveryRunOwner;
  readonly descriptor: ContextDeliveryDescriptor;
  readonly storageFactory: StorageFactory;
  readonly tenant: DeliveryTenantScope;
  readonly context: StorageContext;
  readonly scopes: readonly DeliveryRunScope[];
}

/** @internal Generation worker plus failed-registration owner retirement. */
export interface EnvironmentGenerationWorker extends DeliveryRunWorker {
  add(runtime: EnvironmentDeliveryRuntime): void;
  notify?(scope: DeliveryRunScope): void;
  stopOwners(ownerKeys: readonly string[]): void;
  awaitOwnersSettled(ownerKeys: readonly string[]): Promise<void>;
  retireOwners(ownerKeys: readonly string[]): Promise<void>;
}

/** @internal Routes each owner-partitioned obligation to its exact runtime worker. */
export class EnvironmentDeliveryWorker implements EnvironmentGenerationWorker {
  readonly #workers = new Map<string, DeliveryRunWorker>();
  readonly #supervisors = new Map<string, RuntimeDeliverySupervisor>();
  readonly #stoppedWorkers = new Set<string>();
  readonly #stoppedSupervisors = new Set<string>();
  readonly #stoppedOwners = new Set<string>();
  readonly #createWorker: (runtime: EnvironmentDeliveryRuntime) => DeliveryRunWorker;

  constructor(options: EnvironmentDeliveryWorkerOptions = {}) {
    this.#createWorker = options.createWorker ?? createDeliveryWorker;
  }

  add(runtime: EnvironmentDeliveryRuntime): void {
    if (this.#workers.has(runtime.owner.key)) {
      throw new Error("Environment delivery owner is already configured.");
    }
    const worker = this.#createWorker(runtime);
    const supervisor = createDeliverySupervisor(runtime);
    this.#workers.set(runtime.owner.key, worker);
    this.#supervisors.set(runtime.owner.key, supervisor);
    void supervisor.start();
  }

  start(
    obligation: DeliveryRunObligation,
    shards: readonly ShardIndex[],
  ): Promise<DeliveryWorkerEvidence> {
    const owner = soleOwner(obligation.scopes);
    const worker = this.#workers.get(owner.key);
    if (worker === undefined) {
      return Promise.reject(new Error("Environment delivery owner is not configured."));
    }
    return worker.start(obligation, shards).then(async (evidence) => {
      await this.#requiredSupervisor(owner.key).start();
      return evidence;
    });
  }

  notify(scope: DeliveryRunScope): void {
    if (this.#stoppedSupervisors.has(scope.owner.key)) {
      return;
    }
    this.#requiredSupervisor(scope.owner.key).notify(scope.ready.shard);
  }

  stop(): void {
    const failures: unknown[] = [];
    for (const [key, worker] of this.#workers) {
      if (this.#stoppedOwners.has(key)) {
        continue;
      }
      this.#stopOwner(key, worker, this.#requiredSupervisor(key), failures);
    }
    throwFailures(failures, "Environment delivery worker stop failed.");
  }

  async awaitSettled(): Promise<void> {
    await Promise.all([
      ...Array.from(this.#workers.values(), (worker) => worker.awaitSettled()),
      ...Array.from(this.#supervisors.values(), (supervisor) => supervisor.awaitSettled()),
    ]);
  }

  async retire(): Promise<void> {
    const settled = await Promise.allSettled([
      ...Array.from(this.#workers.values(), (worker) => attempt(() => worker.retire())),
      ...Array.from(this.#supervisors.values(), (supervisor) => attempt(() => supervisor.retire())),
    ]);
    const failures: unknown[] = [];
    for (const result of settled) {
      if (result.status === "rejected") {
        failures.push(result.reason as unknown);
      }
    }
    throwFailures(failures, "Environment delivery worker retirement failed.");
  }

  stopOwners(ownerKeys: readonly string[]): void {
    const selected = ownerKeys.map((key) => {
      const worker = this.#workers.get(key);
      if (worker === undefined) {
        throw new Error("Environment delivery owner is not configured.");
      }
      return { key, worker, supervisor: this.#requiredSupervisor(key) };
    });
    const failures: unknown[] = [];
    for (const { key, worker, supervisor } of selected) {
      if (this.#stoppedOwners.has(key)) {
        continue;
      }
      this.#stopOwner(key, worker, supervisor, failures);
    }
    throwFailures(failures, "Environment registration worker stop failed.");
  }

  async awaitOwnersSettled(ownerKeys: readonly string[]): Promise<void> {
    const selected = ownerKeys.map((key) => ({
      worker: this.#requiredWorker(key),
      supervisor: this.#requiredSupervisor(key),
    }));
    await Promise.all(
      selected.flatMap(({ worker, supervisor }) => [
        worker.awaitSettled(),
        supervisor.awaitSettled(),
      ]),
    );
  }

  async retireOwners(ownerKeys: readonly string[]): Promise<void> {
    const selected = ownerKeys.map((key) => ({
      key,
      worker: this.#requiredWorker(key),
      supervisor: this.#requiredSupervisor(key),
    }));
    const retired = await Promise.allSettled(
      selected.flatMap(({ worker, supervisor }) => [
        attempt(() => worker.retire()),
        attempt(() => supervisor.retire()),
      ]),
    );
    for (const { key } of selected) {
      this.#workers.delete(key);
      this.#supervisors.delete(key);
      this.#stoppedWorkers.delete(key);
      this.#stoppedSupervisors.delete(key);
      this.#stoppedOwners.delete(key);
    }
    const failures = retired.flatMap((result) =>
      result.status === "rejected" ? [result.reason as unknown] : [],
    );
    throwFailures(failures, "Environment registration worker retirement failed.");
  }

  #requiredWorker(key: string): DeliveryRunWorker {
    const worker = this.#workers.get(key);
    if (worker === undefined) {
      throw new Error("Environment delivery owner is not configured.");
    }
    return worker;
  }

  #requiredSupervisor(key: string): RuntimeDeliverySupervisor {
    const supervisor = this.#supervisors.get(key);
    if (supervisor === undefined) {
      throw new Error("Environment delivery owner is not configured.");
    }
    return supervisor;
  }

  #stopOwner(
    key: string,
    worker: DeliveryRunWorker,
    supervisor: RuntimeDeliverySupervisor,
    failures: unknown[],
  ): void {
    if (!this.#stoppedWorkers.has(key)) {
      try {
        worker.stop();
        this.#stoppedWorkers.add(key);
      } catch (error) {
        failures.push(error);
      }
    }
    if (!this.#stoppedSupervisors.has(key)) {
      try {
        supervisor.stop();
        this.#stoppedSupervisors.add(key);
      } catch (error) {
        failures.push(error);
      }
    }
    if (this.#stoppedWorkers.has(key) && this.#stoppedSupervisors.has(key)) {
      this.#stoppedOwners.add(key);
    }
  }
}

interface EnvironmentDeliveryWorkerOptions {
  readonly createWorker?: (runtime: EnvironmentDeliveryRuntime) => DeliveryRunWorker;
}

function createDeliveryWorker(runtime: EnvironmentDeliveryRuntime): DeliveryRunWorker {
  const delivery = new Delivery({
    context: runtime.context,
    storageFactory: runtime.storageFactory,
  });
  const worker = new DeliveryWorker({
    delivery,
    shards: uniqueShards(runtime.scopes),
    node: runtime.context.name,
    onMessage: (message) => runtime.descriptor.replay(message, runtime.tenant.tenantId),
  });
  return deliveryRunWorker(worker);
}

function createDeliverySupervisor(runtime: EnvironmentDeliveryRuntime): RuntimeDeliverySupervisor {
  const shards = uniqueShards(runtime.scopes);
  if (shards.length === 0) {
    throw new Error("Environment delivery supervisor requires at least one shard.");
  }
  const groups = new Map<number, ShardIndex[]>();
  for (const shard of shards) {
    const group = groups.get(shard.ofTotal) ?? [];
    group.push(shard);
    groups.set(shard.ofTotal, group);
  }
  return new RuntimeDeliverySupervisor(
    [...groups].map(([shardCount, exactShards]) => {
      const delivery = new DeliveryBuilder()
        .withContext(runtime.context)
        .withStorageFactory(runtime.storageFactory)
        .withStrategy(UniformAcrossAllShards.forNumber(shardCount))
        .withNode(runtime.context.name)
        .build();
      return new RuntimeDeliverySupervisorGroup({
        delivery,
        shards: exactShards,
        onMessage: (message) => runtime.descriptor.replay(message, runtime.tenant.tenantId),
      });
    }),
  );
}

class RuntimeDeliverySupervisor {
  readonly #groups: readonly RuntimeDeliverySupervisorGroup[];

  constructor(groups: readonly RuntimeDeliverySupervisorGroup[]) {
    this.#groups = Object.freeze([...groups]);
  }

  async start(): Promise<void> {
    await Promise.all(this.#groups.map((group) => group.start()));
  }

  notify(shard: ShardIndex): void {
    this.#groups.find((group) => group.shardCount === shard.ofTotal)?.notify(shard);
  }

  stop(): void {
    const failures: unknown[] = [];
    for (const group of this.#groups) {
      try {
        group.stop();
      } catch (error) {
        failures.push(error);
      }
    }
    throwFailures(failures, "Environment delivery supervisor stop failed.");
  }

  async awaitSettled(): Promise<void> {
    const settled = await Promise.allSettled(this.#groups.map((group) => group.awaitSettled()));
    throwFailures(
      settled.flatMap((result) => (result.status === "rejected" ? [result.reason as unknown] : [])),
      "Environment delivery supervisor settlement failed.",
    );
  }

  async retire(): Promise<void> {
    const settled = await Promise.allSettled(
      this.#groups.map((group) => attempt(() => group.retire())),
    );
    throwFailures(
      settled.flatMap((result) => (result.status === "rejected" ? [result.reason as unknown] : [])),
      "Environment delivery supervisor retirement failed.",
    );
  }
}

class RuntimeDeliverySupervisorGroup {
  readonly #source: LocalDeliverySource;
  readonly #supervisor: DeliverySupervisor;
  readonly shardCount: number;
  #start: Promise<void> | undefined;
  #stopped = false;
  #close: Promise<void> | undefined;

  constructor(options: {
    readonly delivery: ReturnType<DeliveryBuilder["build"]>;
    readonly shards: readonly ShardIndex[];
    readonly onMessage: OnDeliveryMessage;
  }) {
    const first = options.shards[0];
    if (first === undefined) {
      throw new Error("Environment delivery supervisor group requires at least one shard.");
    }
    this.shardCount = first.ofTotal;
    this.#source = new LocalDeliverySource(options.shards);
    this.#supervisor = new DeliverySupervisor({
      source: this.#source,
      delivery: options.delivery,
      onMessage: options.onMessage,
    });
  }

  start(): Promise<void> {
    if (this.#stopped) {
      return Promise.reject(new Error("Environment delivery supervisor is stopped."));
    }
    if (this.#start === undefined) {
      this.#start = this.#supervisor.start().then(() => {
        this.#source.enableRecovery();
      });
    }
    return this.#start;
  }

  notify(shard: ShardIndex): void {
    if (this.#stopped) return;
    void this.start().then(() => {
      this.#supervisor.notify(shard);
    });
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#close = this.#supervisor.close();
    void this.#close.catch(() => undefined);
  }

  async awaitSettled(): Promise<void> {
    await this.#start;
    await this.#close;
  }

  async retire(): Promise<void> {
    this.stop();
    await this.awaitSettled();
  }
}

class LocalDeliverySource {
  readonly #shards: readonly ShardIndex[];
  #recoveryEnabled = false;

  constructor(shards: readonly ShardIndex[]) {
    this.#shards = shards;
  }

  enableRecovery(): void {
    this.#recoveryEnabled = true;
  }

  shardSnapshot(): Promise<readonly DeliveryShardUpdate[]> {
    return Promise.resolve(
      this.#recoveryEnabled
        ? this.#shards.map((shard) => ({ shard, status: "NOT_PICKED" as const, messages: 1 }))
        : [],
    );
  }

  observeShardUpdates(options?: DeliveryOperationOptions): AsyncIterable<never> {
    return updatesUntilAborted(options?.signal);
  }

  releaseExpired(): Promise<readonly unknown[]> {
    return Promise.resolve([]);
  }
}

function updatesUntilAborted(signal: AbortSignal | undefined): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<never> {
      return {
        next: () =>
          new Promise<IteratorResult<never>>((resolve) => {
            if (signal?.aborted) {
              resolve({ done: true, value: undefined as never });
              return;
            }
            signal?.addEventListener(
              "abort",
              () => {
                resolve({ done: true, value: undefined as never });
              },
              { once: true },
            );
          }),
      };
    },
  };
}

function soleOwner(scopes: readonly DeliveryRunScope[]): DeliveryRunOwner {
  const first = scopes[0]?.owner;
  if (first === undefined || scopes.some(({ owner }) => owner.key !== first.key)) {
    throw new Error("Environment delivery obligation requires exactly one owner.");
  }
  return first;
}

function uniqueShards(scopes: readonly DeliveryRunScope[]): readonly ShardIndex[] {
  const shards = new Map<string, ShardIndex>();
  for (const { ready } of scopes) {
    shards.set(ready.shard.key(), ready.shard);
  }
  return Object.freeze([...shards.values()]);
}

function throwFailures(failures: readonly unknown[], message: string): void {
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, message);
  }
}

async function attempt(action: () => Promise<void>): Promise<void> {
  await action();
}
