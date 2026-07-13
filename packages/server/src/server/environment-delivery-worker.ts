import type { StorageContext, StorageFactory } from "@spine-ts/storage";

import type { ContextDeliveryDescriptor, DeliveryTenantScope } from "../context/bounded-context.js";
import {
  deliveryRunWorker,
  type DeliveryRunObligation,
  type DeliveryRunOwner,
  type DeliveryRunScope,
  type DeliveryRunWorker,
} from "../delivery/delivery-run-coordinator.js";
import { Delivery } from "../delivery/delivery.js";
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
  stopOwners(ownerKeys: readonly string[]): void;
  awaitOwnersSettled(ownerKeys: readonly string[]): Promise<void>;
  retireOwners(ownerKeys: readonly string[]): Promise<void>;
}

/** @internal Routes each owner-partitioned obligation to its exact runtime worker. */
export class EnvironmentDeliveryWorker implements EnvironmentGenerationWorker {
  readonly #workers = new Map<string, DeliveryRunWorker>();
  readonly #stoppedOwners = new Set<string>();
  readonly #createWorker: (runtime: EnvironmentDeliveryRuntime) => DeliveryRunWorker;

  constructor(options: EnvironmentDeliveryWorkerOptions = {}) {
    this.#createWorker = options.createWorker ?? createDeliveryWorker;
  }

  add(runtime: EnvironmentDeliveryRuntime): void {
    if (this.#workers.has(runtime.owner.key)) {
      throw new Error("Environment delivery owner is already configured.");
    }
    this.#workers.set(runtime.owner.key, this.#createWorker(runtime));
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
    return worker.start(obligation, shards);
  }

  stop(): void {
    const failures: unknown[] = [];
    for (const [key, worker] of this.#workers) {
      if (this.#stoppedOwners.has(key)) {
        continue;
      }
      try {
        worker.stop();
        this.#stoppedOwners.add(key);
      } catch (error) {
        failures.push(error);
      }
    }
    throwFailures(failures, "Environment delivery worker stop failed.");
  }

  async awaitSettled(): Promise<void> {
    await Promise.all(Array.from(this.#workers.values(), (worker) => worker.awaitSettled()));
  }

  async retire(): Promise<void> {
    const settled = await Promise.allSettled(
      Array.from(this.#workers.values(), (worker) => worker.retire()),
    );
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
      return { key, worker };
    });
    for (const { key, worker } of selected) {
      if (this.#stoppedOwners.has(key)) {
        continue;
      }
      worker.stop();
      this.#stoppedOwners.add(key);
    }
  }

  async awaitOwnersSettled(ownerKeys: readonly string[]): Promise<void> {
    const selected = ownerKeys.map((key) => ({ worker: this.#requiredWorker(key) }));
    await Promise.all(selected.map(({ worker }) => worker.awaitSettled()));
  }

  async retireOwners(ownerKeys: readonly string[]): Promise<void> {
    const selected = ownerKeys.map((key) => ({ key, worker: this.#requiredWorker(key) }));
    const retired = await Promise.allSettled(selected.map(({ worker }) => worker.retire()));
    for (const { key } of selected) {
      this.#workers.delete(key);
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
