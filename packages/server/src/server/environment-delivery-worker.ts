/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { type StorageContext, type StorageFactory } from "@spine-event-engine/storage";
import { TenantBoundary } from "@spine-event-engine/storage/provider";
import { fromBinary } from "@bufbuild/protobuf";
import { CommandSchema, EventSchema } from "@spine-event-engine/proto";
import type { ILogLayer } from "loglayer";

import type { ContextDeliveryDescriptor, DeliveryTenantScope } from "../context/bounded-context.js";
import type { EnvironmentDeliveryPorts } from "../context/local-inbox-handoff.js";
import {
  deliveryRunWorkers,
  type DeliveryRunObligation,
  type DeliveryRunOwner,
  type DeliveryRunScope,
  type DeliveryRunWorker,
} from "../delivery/delivery-run-coordinator.js";
import { DeliveryBuilder, UniformAcrossAllShards } from "../delivery/delivery-builder.js";
import {
  Delivery,
  type DeliveryEndpointMessage,
  type OnDeliveryMessage,
} from "../delivery/delivery.js";
import type { DeliveryOperationOptions } from "../delivery/delivery-ports.js";
import { receptionObservation } from "../delivery/reception-observation.js";
import {
  DeliverySupervisor,
  deliverySupervisorAccess,
  type DeliveryShardUpdate,
  type DeliverySource,
} from "../delivery/delivery-supervisor.js";
import type { DeliveryWorkerEvidence } from "../delivery/delivery-worker.js";
import { DeliveryWorker } from "../delivery/delivery-worker.js";
import { ShardIndex } from "../delivery/shard-index.js";

const managedChild = process.env.SPINE_MANAGED_SERVER_CHILD === "true";
let cancelManagedDelivery = false;
let managedDeliveryActivated = !managedChild;
const waitingManagedSupervisors = new Set<() => void>();

/**
 * Controls private managed-child Delivery admission.
 *
 * @internal
 */
export const environmentDeliveryWorkerAccess: Readonly<{
  activateManagedChild(): void;
  cancelManagedChild(): void;
}> = Object.freeze({
  activateManagedChild(): void {
    managedDeliveryActivated = true;
    for (const start of waitingManagedSupervisors) start();
    waitingManagedSupervisors.clear();
  },
  cancelManagedChild(): void {
    cancelManagedDelivery = true;
    waitingManagedSupervisors.clear();
  },
});

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

  /**
   * Environment child available to downstream delivery containment owners.
   */
  readonly logger?: ILogLayer;
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

  readonly #supervisor: RuntimeDeliverySupervisor;

  readonly #stoppedWorkers = new Set<string>();

  readonly #stoppedSupervisors = new Set<string>();

  readonly #stoppedOwners = new Set<string>();

  readonly #createWorker: (
    runtime: EnvironmentDeliveryRuntime,
    ports?: EnvironmentDeliveryPorts,
    nodeId?: string,
  ) => DeliveryRunWorker;

  readonly #nodeId: string | undefined;

  readonly #ports: EnvironmentDeliveryPorts | undefined;

  /**
   * Creates an environment delivery worker.
   *
   * @param options Optionally supplies a worker factory for lifecycle tests.
   */
  constructor(options: EnvironmentDeliveryWorkerOptions = {}) {
    this.#createWorker = options.createWorker ?? EnvironmentDeliveryValues.createWorker;
    this.#ports = options.ports;
    this.#nodeId = options.nodeId;
    this.#supervisor = new RuntimeDeliverySupervisor(this.#ports, this.#nodeId);
  }

  /**
   * Adds one owner-specific delivery runtime.
   * @param runtime Supplies the runtime to configure.
   */
  add(runtime: EnvironmentDeliveryRuntime): void {
    if (this.#workers.has(runtime.owner.key)) {
      throw new Error("Environment delivery owner is already configured.");
    }
    const worker = this.#createWorker(runtime, this.#ports, this.#nodeId);
    this.#workers.set(runtime.owner.key, worker);
    try {
      this.#supervisor.add(runtime);
    } catch (error) {
      this.#workers.delete(runtime.owner.key);
      throw error;
    }
    void this.#supervisor.start();
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
      await this.#supervisor.start();
      return evidence;
    });
  }

  /**
   * Notifies a running supervisor about new work.
   * @param scope Identifies the changed scope.
   */
  notify(scope: DeliveryRunScope): void {
    this.#requiredWorker(scope.owner.key);
    this.#supervisor.notify(scope.owner.key, scope.ready.shard);
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
      this.#stopOwner(key, worker, failures);
    }
    try {
      this.#supervisor.stop();
    } catch (error) {
      failures.push(error);
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
      this.#supervisor.awaitSettled(),
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
      EnvironmentDeliveryValues.attempt(() => this.#supervisor.retire()),
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
      return { key, worker };
    });
    const failures: unknown[] = [];
    this.#supervisor.fenceOwners(ownerKeys);
    for (const { key, worker } of selected) {
      if (this.#stoppedOwners.has(key)) {
        continue;
      }
      this.#stopOwner(key, worker, failures);
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
    await Promise.all([
      ...ownerKeys.map((key) => this.#requiredWorker(key).awaitSettled()),
      this.#supervisor.awaitOwnersSettled(ownerKeys),
    ]);
  }

  /**
   * Closes selected owners and releases local state.
   *
   * @param ownerKeys Identifies owners to retire.
   * @returns A promise that settles after selected owners retire.
   */
  async retireOwners(ownerKeys: readonly string[]): Promise<void> {
    const selected = ownerKeys.map((key) => ({ key, worker: this.#requiredWorker(key) }));
    const retired = await Promise.allSettled(
      selected.map(({ worker }) => EnvironmentDeliveryValues.attempt(() => worker.retire())),
    );
    await this.#supervisor.retireOwners(ownerKeys);
    for (const { key } of selected) {
      this.#workers.delete(key);
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

  /**
   * Finds the configured worker for an owner key.
   *
   * @param key The worker or group key.
   * @returns The result of this delivery operation.
   */
  #requiredWorker(key: string): DeliveryRunWorker {
    const worker = this.#workers.get(key);
    if (worker === undefined) {
      throw new Error("Environment delivery owner is not configured.");
    }
    return worker;
  }

  /**
   * Stops one configured owner worker and collects failures.
   *
   * @param key The worker or group key.
   * @param worker The runtime delivery worker.
   * @param failures The failures to propagate.
   */
  #stopOwner(key: string, worker: DeliveryRunWorker, failures: unknown[]): void {
    if (!this.#stoppedWorkers.has(key)) {
      try {
        worker.stop();
        this.#stoppedWorkers.add(key);
      } catch (error) {
        failures.push(error);
      }
    }
    if (!this.#stoppedSupervisors.has(key)) {
      this.#stoppedSupervisors.add(key);
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
    nodeId?: string,
  ) => DeliveryRunWorker;
  readonly ports?: EnvironmentDeliveryPorts;
  readonly nodeId?: string;
}

/**
 * Coordinates supervisor groups for one environment generation.
 */
class RuntimeDeliverySupervisor {
  readonly #groups = new Map<string, RuntimeDeliverySupervisorGroup>();

  readonly #ports: EnvironmentDeliveryPorts | undefined;

  readonly #nodeId: string | undefined;

  /**
   * Creates the delivery component with its configured dependencies.
   *
   * @param ports The optional delivery ports.
   * @param nodeId The worker node identity.
   */
  constructor(ports?: EnvironmentDeliveryPorts, nodeId?: string) {
    this.#ports = ports;
    this.#nodeId = nodeId;
  }

  /**
   * Adds the configured delivery runtime or shards.
   *
   * @param runtime The configured context delivery runtime.
   */
  add(runtime: EnvironmentDeliveryRuntime): void {
    const grouped = new Map<number, ShardIndex[]>();
    for (const shard of EnvironmentDeliveryValues.uniqueShards(runtime.scopes)) {
      const shards = grouped.get(shard.ofTotal) ?? [];
      shards.push(shard);
      grouped.set(shard.ofTotal, shards);
    }
    if (grouped.size === 0) {
      throw new Error("Environment delivery supervisor requires at least one shard.");
    }
    for (const [shardCount, shards] of grouped) {
      const key = this.#groupKey(runtime.owner.key, shardCount);
      let group = this.#groups.get(key);
      if (group === undefined) {
        group = EnvironmentDeliveryValues.createSupervisorGroup(
          runtime,
          shards,
          this.#ports,
          this.#nodeId,
        );
        this.#groups.set(key, group);
      }
      group.add(runtime.owner.key, runtime, shards);
    }
  }

  /**
   * Removes an owner route from this runtime.
   *
   * @param ownerKey The configured owner key.
   */
  remove(ownerKey: string): void {
    for (const group of this.#groups.values()) group.remove(ownerKey);
  }

  /**
   * Starts the configured delivery worker or supervisor.
   *
   * @returns The result of this delivery operation.
   */
  async start(): Promise<void> {
    if (!managedDeliveryActivated) {
      waitingManagedSupervisors.add(() => {
        void this.start();
      });
      return;
    }
    if (cancelManagedDelivery) return;
    await Promise.all(Array.from(this.#groups.values(), (group) => group.start()));
  }

  /**
   * Notifies the selected delivery scope or shard.
   *
   * @param ownerKey The configured owner key.
   * @param shard The shard to process.
   */
  notify(ownerKey: string, shard: ShardIndex): void {
    this.#groups.get(this.#groupKey(ownerKey, shard.ofTotal))?.notify(shard);
  }

  /**
   * Marks the selected owners as unavailable for new route admission.
   *
   * @param ownerKeys The owner keys in this generation.
   */
  fenceOwners(ownerKeys: readonly string[]): void {
    for (const group of this.#groups.values()) group.fenceOwners(ownerKeys);
  }

  /**
   * Waits for admitted work for the selected owners to settle.
   *
   * @param ownerKeys The owner keys in this generation.
   * @returns The result of this delivery operation.
   */
  async awaitOwnersSettled(ownerKeys: readonly string[]): Promise<void> {
    await Promise.all(
      Array.from(this.#groups.values(), (group) => group.awaitOwnersSettled(ownerKeys)),
    );
  }

  /**
   * Closes the selected owners after admitted work settles.
   *
   * @param ownerKeys The owner keys in this generation.
   * @returns The result of this delivery operation.
   */
  async retireOwners(ownerKeys: readonly string[]): Promise<void> {
    for (const [key, group] of this.#groups) {
      await group.retireOwners(ownerKeys);
      if (group.empty) this.#groups.delete(key);
    }
  }

  /**
   * Stops admission and starts delivery shutdown.
   */
  stop(): void {
    const failures: unknown[] = [];
    for (const group of this.#groups.values()) {
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

  /**
   * Waits for the active delivery work to settle.
   *
   * @returns The result of this delivery operation.
   */
  async awaitSettled(): Promise<void> {
    const settled = await Promise.allSettled(
      Array.from(this.#groups.values(), (group) => group.awaitSettled()),
    );
    EnvironmentDeliveryValues.throwFailures(
      settled.flatMap((result) => (result.status === "rejected" ? [result.reason as unknown] : [])),
      "Environment delivery supervisor settlement failed.",
    );
  }

  /**
   * Closes this delivery worker after settling its work.
   *
   * @returns The result of this delivery operation.
   */
  async retire(): Promise<void> {
    const settled = await Promise.allSettled(
      Array.from(this.#groups.values(), (group) =>
        EnvironmentDeliveryValues.attempt(() => group.retire()),
      ),
    );
    EnvironmentDeliveryValues.throwFailures(
      settled.flatMap((result) => (result.status === "rejected" ? [result.reason as unknown] : [])),
      "Environment delivery supervisor retirement failed.",
    );
  }

  /**
   * Builds a stable supervisor-group key for one owner and shard total.
   *
   * @param ownerKey The configured owner key.
   * @param shardCount The shard total for this supervisor group.
   * @returns The result of this delivery operation.
   */
  #groupKey(ownerKey: string, shardCount: number): string {
    return this.#ports?.source === undefined
      ? `${ownerKey}/${String(shardCount)}`
      : `remote/${String(shardCount)}`;
  }
}

/**
 * Keeps admitted routes stable while one shard supervisor drains.
 */
class RuntimeDeliverySupervisorGroup {
  readonly #source: DeliverySource;

  readonly #supervisor: DeliverySupervisor;

  readonly #routes = new Map<string, RuntimeDeliveryRoute[]>();

  readonly #retiringOwners = new Set<string>();

  readonly #active = new Map<string, Set<Promise<void>>>();

  readonly #reserved: Map<string, Map<string, RuntimeDeliveryReservation>>;

  readonly shardCount: number;

  #start: Promise<void> | undefined;

  #stopped = false;

  #close: Promise<void> | undefined;

  /**
   * Creates the delivery component with its configured dependencies.
   *
   * @param options The delivery or cancellation options.
   */
  constructor(options: {
    readonly delivery: ReturnType<DeliveryBuilder["build"]>;
    readonly shards: readonly ShardIndex[];
    readonly source?: DeliverySource;
    readonly logger?: ILogLayer;
  }) {
    // `createSupervisorGroup()` rejects an empty shard collection before internal construction.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const first = options.shards[0]!;
    this.shardCount = first.ofTotal;
    this.#reserved = new Map<string, Map<string, RuntimeDeliveryReservation>>(
      options.shards.map((shard) => [shard.key(), new Map<string, RuntimeDeliveryReservation>()]),
    );
    this.#source =
      options.source === undefined
        ? new LocalDeliverySource(options.shards)
        : EnvironmentDeliveryValues.requireSource(options.source);
    this.#supervisor = new DeliverySupervisor({
      source: this.#source,
      delivery: options.delivery,
      onMessage: (message) => this.#route(message),
    });
    deliverySupervisorAccess.installAdmission(this.#supervisor, (message) => this.#accept(message));
    deliverySupervisorAccess.installMessageSettled(this.#supervisor, (message) => {
      this.#settleReservation(message);
    });
    deliverySupervisorAccess.installFinalization(this.#supervisor, (shard) => {
      this.#releaseUndeliveredReservations(shard);
    });
    if (options.logger !== undefined) {
      deliverySupervisorAccess.installLogger(this.#supervisor, options.logger);
    }
  }

  /**
   * Adds the configured delivery runtime or shards.
   *
   * @param ownerKey The configured owner key.
   * @param runtime The configured context delivery runtime.
   * @param shards The shards assigned to this runtime.
   */
  add(ownerKey: string, runtime: EnvironmentDeliveryRuntime, shards: readonly ShardIndex[]): void {
    if (this.#source instanceof LocalDeliverySource) this.#source.add(shards);
    for (const scope of runtime.scopes) {
      if (scope.ready.shard.ofTotal !== this.shardCount) continue;
      const key = RuntimeDeliverySupervisorGroup.key(scope.ready);
      const routes = this.#routes.get(key) ?? [];
      routes.push({
        ownerKey,
        descriptor: runtime.descriptor,
        tenant: runtime.tenant,
        tenantKey:
          runtime.tenant.tenantId === undefined
            ? undefined
            : String(TenantBoundary.from(runtime.tenant.tenantId).key),
      });
      this.#routes.set(key, routes);
    }
  }

  /**
   * Checks whether this supervisor group has configured routes.
   *
   * @returns The result of this delivery operation.
   */
  get empty(): boolean {
    return this.#routes.size === 0;
  }

  /**
   * Marks the selected owners as unavailable for new route admission.
   *
   * @param ownerKeys The owner keys in this generation.
   */
  fenceOwners(ownerKeys: readonly string[]): void {
    for (const ownerKey of ownerKeys) this.#retiringOwners.add(ownerKey);
  }

  /**
   * Waits for admitted work for the selected owners to settle.
   *
   * @param ownerKeys The owner keys in this generation.
   * @returns The result of this delivery operation.
   */
  async awaitOwnersSettled(ownerKeys: readonly string[]): Promise<void> {
    await Promise.all(
      Array.from(this.#reserved.values(), async (reservations) =>
        Promise.all(
          Array.from(reservations.values())
            .filter((reservation) => ownerKeys.includes(reservation.route.ownerKey))
            .map((reservation) => reservation.settled.promise),
        ),
      ),
    );
    await Promise.all(
      ownerKeys.map(async (ownerKey) => {
        const active = this.#active.get(ownerKey);
        if (active !== undefined) await Promise.allSettled(active);
      }),
    );
  }

  /**
   * Closes the selected owners after admitted work settles.
   *
   * @param ownerKeys The owner keys in this generation.
   * @returns The result of this delivery operation.
   */
  async retireOwners(ownerKeys: readonly string[]): Promise<void> {
    this.fenceOwners(ownerKeys);
    await this.awaitOwnersSettled(ownerKeys);
    for (const ownerKey of ownerKeys) this.remove(ownerKey);
    if (this.empty) await this.retire();
  }

  /**
   * Removes an owner route from this runtime.
   *
   * @param ownerKey The configured owner key.
   */
  remove(ownerKey: string): void {
    for (const [key, routes] of this.#routes) {
      const retained = routes.filter((route) => route.ownerKey !== ownerKey);
      if (retained.length === 0) this.#routes.delete(key);
      else this.#routes.set(key, retained);
    }
  }

  /**
   * Starts the configured delivery worker or supervisor.
   *
   * @returns The result of this delivery operation.
   */
  start(): Promise<void> {
    if (this.#stopped) {
      return Promise.reject(new Error("Environment delivery supervisor is stopped."));
    }
    if (this.#start === undefined) {
      this.#start = this.#supervisor.start().then(() => {
        if (this.#source instanceof LocalDeliverySource) this.#source.enableRecovery();
      });
    }
    return this.#start;
  }

  /**
   * Notifies the selected delivery scope or shard.
   *
   * @param shard The shard to process.
   */
  notify(shard: ShardIndex): void {
    if (this.#stopped) return;
    // spine-log-boundary: server.delivery_notify_start
    void this.start()
      .then(() => {
        this.#supervisor.notify(shard);
      })
      .catch(() => undefined);
  }

  /**
   * Stops admission and starts delivery shutdown.
   */
  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#close = this.#supervisor.close();
    // spine-log-boundary: server.delivery_supervisor_close
    void this.#close.catch(() => undefined);
  }

  /**
   * Waits for the active delivery work to settle.
   *
   * @returns The result of this delivery operation.
   */
  async awaitSettled(): Promise<void> {
    await this.#start;
    await this.#close;
  }

  /**
   * Closes this delivery worker after settling its work.
   *
   * @returns The result of this delivery operation.
   */
  async retire(): Promise<void> {
    this.stop();
    await this.awaitSettled();
  }

  /**
   * Accepts an Inbox message and reserves its exact route.
   *
   * @param message The persisted Inbox message.
   * @returns The result of this delivery operation.
   */
  #accept(message: DeliveryEndpointMessage): boolean {
    const route = this.#select(message);
    if (route !== undefined) {
      // `options.shards` initializes one private reservation map per supervised shard.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const reservations = this.#reserved.get(message.shard.key())!;
      const key = RuntimeDeliverySupervisorGroup.messageKey(message);
      if (reservations.has(key)) return false;
      reservations.set(key, {
        route,
        settled: Promise.withResolvers<undefined>(),
      });
    }
    return route !== undefined;
  }

  /**
   * Routes an admitted Inbox message to its reserved endpoint.
   *
   * @param message The persisted Inbox message.
   * @returns The result of this delivery operation.
   */
  #route(message: Parameters<OnDeliveryMessage>[0]): void | Promise<void> {
    receptionObservation.markManaged();
    const key = RuntimeDeliverySupervisorGroup.messageKey(message);
    // `Delivery` invokes the callback only after this group's admission reserved its route.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const reservations = this.#reserved.get(message.shard.key())!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const reservation = reservations.get(key)!;
    const route = reservation.route;
    const active = this.#active.get(route.ownerKey) ?? new Set<Promise<void>>();
    this.#active.set(route.ownerKey, active);
    const replay = Promise.resolve()
      .then(() => route.descriptor.replay(message, route.tenant.tenantId))
      .finally(() => {
        active.delete(replay);
        if (active.size === 0) this.#active.delete(route.ownerKey);
      });
    active.add(replay);
    return replay;
  }

  /**
   * Resolves and removes one reservation after its complete processing action.
   *
   * @param message The settled Inbox message.
   */
  #settleReservation(message: DeliveryEndpointMessage): void {
    // The constructor initializes a reservation map for every supervised shard.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const reservations = this.#reserved.get(message.shard.key())!;
    const key = RuntimeDeliverySupervisorGroup.messageKey(message);
    const reservation = reservations.get(key);
    if (reservation === undefined) return;
    reservations.delete(key);
    reservation.settled.resolve(undefined);
  }

  /**
   * Clears route reservations when a shard run finishes.
   *
   * @param shard The shard to process.
   */
  #releaseUndeliveredReservations(shard: ShardIndex): void {
    // `options.shards` initializes one private reservation map per supervised shard.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const reservations = this.#reserved.get(shard.key())!;
    for (const reservation of reservations.values()) {
      reservation.settled.resolve(undefined);
    }
    reservations.clear();
  }

  /**
   * Finds the configured route for an Inbox message.
   *
   * @param message The persisted Inbox message.
   * @returns The result of this delivery operation.
   */
  #select(message: DeliveryEndpointMessage): RuntimeDeliveryRoute | undefined {
    const key = RuntimeDeliverySupervisorGroup.key(message);
    const routes = this.#routes.get(key);
    const route = RuntimeDeliverySupervisorGroup.select(routes, message);
    return route === undefined || this.#retiringOwners.has(route.ownerKey) ? undefined : route;
  }

  /**
   * Finds the matching route for an Inbox message.
   *
   * @param routes The candidate routes.
   * @param message The persisted Inbox message.
   * @returns The result of this delivery operation.
   */
  static select(
    routes: readonly RuntimeDeliveryRoute[] | undefined,
    message: DeliveryEndpointMessage,
  ): RuntimeDeliveryRoute | undefined {
    if (routes === undefined || routes.length === 0) return undefined;
    const tenantKey = RuntimeDeliverySupervisorGroup.tenantKey(message);
    return routes.find((route) => route.tenantKey === tenantKey);
  }

  /**
   *
   * Finds the tenant boundary key from the delivery label's matching envelope.
   * `HANDLE_COMMAND` reads the Command actor tenant; Event labels read imported
   * or past-message Event origin tenants.
   *
   * @param message Contains the admitted delivery message.
   * @returns The tenant boundary key when the supported envelope carries one.
   */
  static tenantKey(message: DeliveryEndpointMessage): string | undefined {
    if (message.signal === undefined) return undefined;
    try {
      if (message.label === "HANDLE_COMMAND") {
        const tenantId = fromBinary(CommandSchema, message.signal.value).context?.actorContext
          ?.tenantId;
        return tenantId === undefined ? undefined : String(TenantBoundary.from(tenantId).key);
      }

      const origin = fromBinary(EventSchema, message.signal.value).context?.origin;
      if (origin?.case === "importContext") {
        const value = origin.value.tenantId;
        return value === undefined ? undefined : String(TenantBoundary.from(value).key);
      }
      if (origin?.case === "pastMessage") {
        const value = origin.value.actorContext?.tenantId;
        return value === undefined ? undefined : String(TenantBoundary.from(value).key);
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  /**
   * Builds a route key for one configured endpoint.
   *
   * @param route The configured route.
   * @returns The result of this delivery operation.
   */
  static key(
    route: Pick<DeliveryEndpointMessage, "label" | "shard"> & {
      readonly inboxId?: { readonly targetTypeUrl: string };
      readonly targetTypeUrl?: string;
    },
  ): string {
    const targetTypeUrl = route.inboxId?.targetTypeUrl ?? route.targetTypeUrl;
    if (targetTypeUrl === undefined)
      throw new Error("Environment delivery route has no target type.");
    return JSON.stringify([route.label, targetTypeUrl, route.shard.index, route.shard.ofTotal]);
  }

  /**
   * Builds an exact route-reservation key for one Inbox message.
   *
   * @param message The persisted Inbox message.
   * @returns The result of this delivery operation.
   */
  static messageKey(message: DeliveryEndpointMessage): string {
    return `${message.id.shard.key()}/${message.id.value}`;
  }
}

interface RuntimeDeliveryRoute {
  readonly ownerKey: string;
  readonly descriptor: ContextDeliveryDescriptor;
  readonly tenant: DeliveryTenantScope;
  readonly tenantKey: string | undefined;
}

interface RuntimeDeliveryReservation {
  readonly route: RuntimeDeliveryRoute;
  readonly settled: PromiseWithResolvers<undefined>;
}

/**
 * Supplies local shard recovery observations to the supervisor.
 */
class LocalDeliverySource {
  readonly #shards = new Map<string, ShardIndex>();

  #recoveryEnabled = false;

  /**
   * Creates the delivery component with its configured dependencies.
   *
   * @param shards The shards assigned to this runtime.
   */
  constructor(shards: readonly ShardIndex[]) {
    this.add(shards);
  }

  /**
   * Adds the configured delivery runtime or shards.
   *
   * @param shards The shards assigned to this runtime.
   */
  add(shards: readonly ShardIndex[]): void {
    for (const shard of shards) this.#shards.set(shard.key(), shard);
  }

  /**
   * Sets local shards as eligible for periodic recovery.
   */
  enableRecovery(): void {
    this.#recoveryEnabled = true;
  }

  /**
   * Returns the locally recoverable shard snapshot.
   *
   * @returns The result of this delivery operation.
   */
  shardSnapshot(): Promise<readonly DeliveryShardUpdate[]> {
    return Promise.resolve(
      this.#recoveryEnabled
        ? Array.from(this.#shards.values(), (shard) => ({
            shard,
            status: "NOT_PICKED" as const,
            messages: 1,
          }))
        : [],
    );
  }

  /**
   * Observes shard changes until the operation is cancelled.
   *
   * @param options The delivery or cancellation options.
   * @returns The result of this delivery operation.
   */
  observeShardUpdates(options?: DeliveryOperationOptions): AsyncIterable<never> {
    return EnvironmentDeliveryValues.updatesUntilAborted(options?.signal);
  }

  /**
   * Returns expired local ownership records.
   *
   * @returns The result of this delivery operation.
   */
  releaseExpired(): Promise<readonly unknown[]> {
    return Promise.resolve([]);
  }
}

/**
 * Groups private delivery-runtime assembly and failure operations.
 *
 * @internal
 */
const EnvironmentDeliveryValues = Object.freeze({
  /**
   * Validates a delivery source before use.
   *
   * @param source The source to validate.
   * @returns The validated delivery source.
   */
  requireSource(source: unknown): DeliverySource {
    if (
      source === null ||
      typeof source !== "object" ||
      typeof (source as DeliverySource).shardSnapshot !== "function" ||
      typeof (source as DeliverySource).observeShardUpdates !== "function" ||
      typeof (source as DeliverySource).releaseExpired !== "function"
    ) {
      throw new TypeError("Environment delivery source is invalid.");
    }
    return source as DeliverySource;
  },

  /**
   * Creates the worker that drains one context runtime.
   *
   * @param runtime The context runtime to serve.
   * @param ports Optional delivery ports.
   * @param nodeId Optional node identity.
   * @returns The configured worker.
   */
  createWorker(
    runtime: EnvironmentDeliveryRuntime,
    ports?: EnvironmentDeliveryPorts,
    nodeId?: string,
  ): DeliveryRunWorker {
    const delivery = new Delivery({
      context: runtime.context,
      storageFactory: runtime.storageFactory,
      node: nodeId ?? runtime.context.name,
      ...(ports ?? {}),
    });
    const worker = new DeliveryWorker({
      delivery,
      shards: EnvironmentDeliveryValues.uniqueShards(runtime.scopes),
      onMessage: (message) => runtime.descriptor.replay(message, runtime.tenant.tenantId),
    });
    return deliveryRunWorkers.worker(worker);
  },

  /**
   * Creates a supervisor group for shards with one total.
   *
   * @param runtime The context runtime to serve.
   * @param shards The assigned shards.
   * @param ports Optional delivery ports.
   * @param nodeId Optional node identity.
   * @returns The configured supervisor group.
   */
  createSupervisorGroup(
    runtime: EnvironmentDeliveryRuntime,
    shards: readonly ShardIndex[],
    ports?: EnvironmentDeliveryPorts,
    nodeId?: string,
  ): RuntimeDeliverySupervisorGroup {
    const first = shards[0];
    if (first === undefined) {
      throw new Error("Environment delivery supervisor requires at least one shard.");
    }
    const builder = new DeliveryBuilder()
      .withContext(runtime.context)
      .withStorageFactory(runtime.storageFactory)
      .withStrategy(UniformAcrossAllShards.forNumber(first.ofTotal))
      .withNode(nodeId ?? runtime.context.name);
    if (ports !== undefined) builder.withInbox(ports.inbox).withWorkRegistry(ports.workRegistry);
    return new RuntimeDeliverySupervisorGroup({
      delivery: builder.build(),
      shards,
      ...(ports?.source === undefined ? {} : { source: ports.source }),
      ...(runtime.logger === undefined ? {} : { logger: runtime.logger }),
    });
  },

  /**
   * Creates an update stream that finishes on cancellation.
   *
   * @param signal The optional cancellation signal.
   * @returns The cancellation-aware stream.
   */
  updatesUntilAborted(signal: AbortSignal | undefined): AsyncIterable<never> {
    return {
      /**
       * Returns the cancellation-aware update iterator.
       *
       * @returns The result of this delivery operation.
       */
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

  /**
   * Finds the sole owner shared by the supplied scopes.
   *
   * @param scopes The exact delivery scopes.
   * @returns Their shared owner.
   */
  soleOwner(scopes: readonly DeliveryRunScope[]): DeliveryRunOwner {
    const first = scopes[0]?.owner;
    if (first === undefined || scopes.some(({ owner }) => owner.key !== first.key)) {
      throw new Error("Environment delivery obligation requires exactly one owner.");
    }
    return first;
  },

  /**
   * Collects distinct shards from the supplied scopes.
   *
   * @param scopes The exact delivery scopes.
   * @returns Their distinct shards.
   */
  uniqueShards(scopes: readonly DeliveryRunScope[]): readonly ShardIndex[] {
    const shards = new Map<string, ShardIndex>();
    for (const { ready } of scopes) {
      shards.set(ready.shard.key(), ready.shard);
    }
    return Object.freeze([...shards.values()]);
  },

  /**
   * Throws collected failures without losing their identity.
   *
   * @param failures The failures to propagate.
   * @param message The aggregate message when several failures occurred.
   */
  throwFailures(failures: readonly unknown[], message: string): void {
    if (failures.length === 1) {
      throw failures[0];
    }
    if (failures.length > 1) {
      throw new AggregateError(failures, message);
    }
  },

  /**
   * Awaits one asynchronous cleanup action.
   *
   * @param action The action to await.
   * @returns Completion of that action.
   */
  async attempt(action: () => Promise<void>): Promise<void> {
    await action();
  },
});
