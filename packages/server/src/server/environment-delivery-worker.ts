import type { StorageContext } from "@spine-ts/storage";

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
  readonly tenant: DeliveryTenantScope;
  readonly context: StorageContext;
  readonly scopes: readonly DeliveryRunScope[];
}

/** @internal Routes each owner-partitioned obligation to its exact runtime worker. */
export class EnvironmentDeliveryWorker implements DeliveryRunWorker {
  readonly #workers = new Map<string, DeliveryRunWorker>();

  add(runtime: EnvironmentDeliveryRuntime): void {
    if (this.#workers.has(runtime.owner.key)) {
      throw new Error("Environment delivery owner is already configured.");
    }
    const delivery = new Delivery({
      context: runtime.context,
      storageFactory: runtime.descriptor.storageFactory,
    });
    const worker = new DeliveryWorker({
      delivery,
      shards: uniqueShards(runtime.scopes),
      node: runtime.context.name,
      onMessage: (message) => runtime.descriptor.replay(message, runtime.tenant.tenantId),
    });
    this.#workers.set(runtime.owner.key, deliveryRunWorker(worker));
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
    for (const worker of this.#workers.values()) {
      try {
        worker.stop();
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
    throwFailures(
      failures,
      "Environment delivery worker retirement failed.",
    );
  }
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
