import type { StorageContext, StorageFactory } from "@spine-event-engine/storage";

import type { ContextDeliveryDescriptor, DeliveryTenantScope } from "../context/bounded-context.js";
import {
  deliveryRunWorkers,
  type DeliveryRunObligation,
  type DeliveryRunOwner,
  type DeliveryRunScope,
  type DeliveryRunWorker,
} from "../delivery/delivery-run-coordinator.js";
import { DeliveryBuilder, UniformAcrossAllShards } from "../delivery/delivery-builder.js";
import type { DeliveryInbox, DeliveryWorkRegistry } from "../delivery/delivery-ports.js";
import { Delivery, type OnDeliveryMessage } from "../delivery/delivery.js";
import type { DeliveryOperationOptions } from "../delivery/delivery-ports.js";
import { DeliverySupervisor, type DeliveryShardUpdate } from "../delivery/delivery-supervisor.js";
import type { DeliveryWorkerEvidence } from "../delivery/delivery-worker.js";
import { DeliveryWorker } from "../delivery/delivery-worker.js";
import { ShardIndex } from "../delivery/shard-index.js";

/**
 * Defines one descriptor, storage, and tenant runtime in an environment generation.
 *
 * @internal
 */
export interface EnvironmentDeliveryRuntime {
  // prettier-ignore

  /**
   * Identifies the delivery owner.
   */
  readonly owner: DeliveryRunOwner;

  /**
   * Supplies the context delivery endpoint.
   */
  readonly descriptor: ContextDeliveryDescriptor;

  /**
   * Creates durable storage for the runtime.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Identifies the tenant served by the runtime.
   */
  readonly tenant: DeliveryTenantScope;

  /**
   * Names the storage context used by the runtime.
   */
  readonly context: StorageContext;

  /**
   * Lists scopes assigned to the runtime.
   */
  readonly scopes: readonly DeliveryRunScope[];
}

/**
 * Defines generation-worker operations, including failed-owner retirement.
 *
 * @internal
 */
export interface EnvironmentGenerationWorker extends DeliveryRunWorker {
  // prettier-ignore

  /**
   * Adds one delivery runtime.
   * @param runtime Supplies the runtime to add.
   */
  add(runtime: EnvironmentDeliveryRuntime): void;

  /**
   * Notifies the worker about new work.
   * @param scope Identifies the changed scope.
   */
  notify?(scope: DeliveryRunScope): void;

  /**
   * Stops work owned by supplied owners.
   * @param ownerKeys Identifies owners to stop.
   */
  stopOwners(ownerKeys: readonly string[]): void;

  /**
   * Awaits active work for supplied owners.
   *
   * @param ownerKeys Identifies owners to await.
   * @returns A promise that resolves after selected owner work settles.
   */
  awaitOwnersSettled(ownerKeys: readonly string[]): Promise<void>;

  /**
   * Closes workers for supplied owners.
   *
   * @param ownerKeys Identifies owners to retire.
   * @returns A promise that settles after selected owners retire.
   */
  retireOwners(ownerKeys: readonly string[]): Promise<void>;
}

/**
 * Routes each owner-partitioned obligation to its exact runtime worker.
 *
 * @internal
 */
export class EnvironmentDeliveryWorker implements EnvironmentGenerationWorker {
  readonly #workers = new Map<string, DeliveryRunWorker>();
  readonly #supervisors = new Map<string, RuntimeDeliverySupervisor>();
  readonly #stoppedWorkers = new Set<string>();
  readonly #stoppedSupervisors = new Set<string>();
  readonly #stoppedOwners = new Set<string>();
  readonly #createWorker: (
    runtime: EnvironmentDeliveryRuntime,
    ports?: EnvironmentDeliveryPorts,
  ) => DeliveryRunWorker;
  readonly #ports:
    { readonly inbox: DeliveryInbox; readonly workRegistry: DeliveryWorkRegistry } | undefined;

  /**
   * Creates an environment delivery worker.
   *
   * @param options Optionally supplies a worker factory for lifecycle tests.
   */
  constructor(options: EnvironmentDeliveryWorkerOptions = {}) {
    this.#createWorker = options.createWorker ?? EnvironmentDeliveryValues.createWorker;
    this.#ports = options.ports;
  }

  /**
   * Adds one owner-specific delivery runtime.
   * @param runtime Supplies the runtime to configure.
   */
  add(runtime: EnvironmentDeliveryRuntime): void {
    if (this.#workers.has(runtime.owner.key)) {
      throw new Error("Environment delivery owner is already configured.");
    }
    const worker = this.#createWorker(runtime, this.#ports);
    const supervisor = EnvironmentDeliveryValues.createSupervisor(runtime, this.#ports);
    this.#workers.set(runtime.owner.key, worker);
    this.#supervisors.set(runtime.owner.key, supervisor);
    void supervisor.start();
  }

  /**
   * Starts selected shards for one owner-specific obligation.
   *
   * @param obligation Supplies the finite delivery obligation.
   * @param shards Selects shards to run.
   * @returns Evidence produced by the worker.
   */
  start(
    obligation: DeliveryRunObligation,
    shards: readonly ShardIndex[],
  ): Promise<DeliveryWorkerEvidence> {
    const owner = EnvironmentDeliveryValues.soleOwner(obligation.scopes);
    const worker = this.#workers.get(owner.key);
    if (worker === undefined) {
      return Promise.reject(new Error("Environment delivery owner is not configured."));
    }
    return worker.start(obligation, shards).then(async (evidence) => {
      await this.#requiredSupervisor(owner.key).start();
      return evidence;
    });
  }

  /**
   * Notifies a running supervisor about new work.
   * @param scope Identifies the changed scope.
   */
  notify(scope: DeliveryRunScope): void {
    if (this.#stoppedSupervisors.has(scope.owner.key)) {
      return;
    }
    this.#requiredSupervisor(scope.owner.key).notify(scope.ready.shard);
  }

  /**
   * Stops every configured owner and aggregates failures.
   */
  stop(): void {
    const failures: unknown[] = [];
    for (const [key, worker] of this.#workers) {
      if (this.#stoppedOwners.has(key)) {
        continue;
      }
      this.#stopOwner(key, worker, this.#requiredSupervisor(key), failures);
    }
    EnvironmentDeliveryValues.throwFailures(failures, "Environment delivery worker stop failed.");
  }

  /**
   * Awaits every configured worker and supervisor.
   *
   * @returns A promise that resolves after all configured work settles.
   */
  async awaitSettled(): Promise<void> {
    await Promise.all([
      ...Array.from(this.#workers.values(), (worker) => worker.awaitSettled()),
      ...Array.from(this.#supervisors.values(), (supervisor) => supervisor.awaitSettled()),
    ]);
  }

  /**
   * Closes every configured worker and supervisor.
   *
   * @returns A promise that settles after all configured resources retire.
   */
  async retire(): Promise<void> {
    const settled = await Promise.allSettled([
      ...Array.from(this.#workers.values(), (worker) =>
        EnvironmentDeliveryValues.attempt(() => worker.retire()),
      ),
      ...Array.from(this.#supervisors.values(), (supervisor) =>
        EnvironmentDeliveryValues.attempt(() => supervisor.retire()),
      ),
    ]);
    const failures: unknown[] = [];
    for (const result of settled) {
      if (result.status === "rejected") {
        failures.push(result.reason as unknown);
      }
    }
    EnvironmentDeliveryValues.throwFailures(
      failures,
      "Environment delivery worker retirement failed.",
    );
  }

  /**
   * Stops selected owners and aggregates failures.
   * @param ownerKeys Identifies owners to stop.
   */
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
    EnvironmentDeliveryValues.throwFailures(
      failures,
      "Environment registration worker stop failed.",
    );
  }

  /**
   * Awaits selected owners.
   *
   * @param ownerKeys Identifies owners to await.
   * @returns A promise that resolves after selected owner work settles.
   */
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

  /**
   * Closes selected owners and releases local state.
   *
   * @param ownerKeys Identifies owners to retire.
   * @returns A promise that settles after selected owners retire.
   */
  async retireOwners(ownerKeys: readonly string[]): Promise<void> {
    const selected = ownerKeys.map((key) => ({
      key,
      worker: this.#requiredWorker(key),
      supervisor: this.#requiredSupervisor(key),
    }));
    const retired = await Promise.allSettled(
      selected.flatMap(({ worker, supervisor }) => [
        EnvironmentDeliveryValues.attempt(() => worker.retire()),
        EnvironmentDeliveryValues.attempt(() => supervisor.retire()),
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
    EnvironmentDeliveryValues.throwFailures(
      failures,
      "Environment registration worker retirement failed.",
    );
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
  readonly createWorker?: (
    runtime: EnvironmentDeliveryRuntime,
    ports?: EnvironmentDeliveryPorts,
  ) => DeliveryRunWorker;
  readonly ports?: EnvironmentDeliveryPorts;
}
interface EnvironmentDeliveryPorts {
  readonly inbox: DeliveryInbox;
  readonly workRegistry: DeliveryWorkRegistry;
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
    EnvironmentDeliveryValues.throwFailures(
      failures,
      "Environment delivery supervisor stop failed.",
    );
  }

  async awaitSettled(): Promise<void> {
    const settled = await Promise.allSettled(this.#groups.map((group) => group.awaitSettled()));
    EnvironmentDeliveryValues.throwFailures(
      settled.flatMap((result) => (result.status === "rejected" ? [result.reason as unknown] : [])),
      "Environment delivery supervisor settlement failed.",
    );
  }

  async retire(): Promise<void> {
    const settled = await Promise.allSettled(
      this.#groups.map((group) => EnvironmentDeliveryValues.attempt(() => group.retire())),
    );
    EnvironmentDeliveryValues.throwFailures(
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
    return EnvironmentDeliveryValues.updatesUntilAborted(options?.signal);
  }

  releaseExpired(): Promise<readonly unknown[]> {
    return Promise.resolve([]);
  }
}

/**
 *
 * @internal Groups private delivery-runtime assembly and failure operations.
 */
const EnvironmentDeliveryValues = Object.freeze({
  createWorker(
    runtime: EnvironmentDeliveryRuntime,
    ports?: EnvironmentDeliveryPorts,
  ): DeliveryRunWorker {
    const delivery = new Delivery({
      context: runtime.context,
      storageFactory: runtime.storageFactory,
      ...(ports ?? {}),
    });
    const worker = new DeliveryWorker({
      delivery,
      shards: EnvironmentDeliveryValues.uniqueShards(runtime.scopes),
      node: runtime.context.name,
      onMessage: (message) => runtime.descriptor.replay(message, runtime.tenant.tenantId),
    });
    return deliveryRunWorkers.worker(worker);
  },
  createSupervisor(
    runtime: EnvironmentDeliveryRuntime,
    ports?: EnvironmentDeliveryPorts,
  ): RuntimeDeliverySupervisor {
    const shards = EnvironmentDeliveryValues.uniqueShards(runtime.scopes);
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
        const builder = new DeliveryBuilder()
          .withContext(runtime.context)
          .withStorageFactory(runtime.storageFactory)
          .withStrategy(UniformAcrossAllShards.forNumber(shardCount))
          .withNode(runtime.context.name);
        if (ports !== undefined)
          builder.withInbox(ports.inbox).withWorkRegistry(ports.workRegistry);
        const delivery = builder.build();
        return new RuntimeDeliverySupervisorGroup({
          delivery,
          shards: exactShards,
          onMessage: (message) => runtime.descriptor.replay(message, runtime.tenant.tenantId),
        });
      }),
    );
  },
  updatesUntilAborted(signal: AbortSignal | undefined): AsyncIterable<never> {
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
  },
  soleOwner(scopes: readonly DeliveryRunScope[]): DeliveryRunOwner {
    const first = scopes[0]?.owner;
    if (first === undefined || scopes.some(({ owner }) => owner.key !== first.key)) {
      throw new Error("Environment delivery obligation requires exactly one owner.");
    }
    return first;
  },
  uniqueShards(scopes: readonly DeliveryRunScope[]): readonly ShardIndex[] {
    const shards = new Map<string, ShardIndex>();
    for (const { ready } of scopes) {
      shards.set(ready.shard.key(), ready.shard);
    }
    return Object.freeze([...shards.values()]);
  },
  throwFailures(failures: readonly unknown[], message: string): void {
    if (failures.length === 1) {
      throw failures[0];
    }
    if (failures.length > 1) {
      throw new AggregateError(failures, message);
    }
  },
  async attempt(action: () => Promise<void>): Promise<void> {
    await action();
  },
});
