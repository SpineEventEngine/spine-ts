import type { StorageContext } from "@spine-ts/storage";

import type { ContextDeliveryDescriptor, DeliveryTenantScope } from "../context/bounded-context.js";
import type { DeliveryEndpoint, DeliveryReady } from "../context/local-inbox-handoff.js";
import type { DeliveryLoopProgress, DeliveryLoopRun } from "../delivery/delivery-loop.js";
import {
  DeliveryRunCoordinator,
  deliveryRunWorker,
  type DeliveryRunObligation,
  type DeliveryRunScope,
  type DeliveryRunSettlement,
  type DeliveryRunWorker,
} from "../delivery/delivery-run-coordinator.js";
import { Delivery } from "../delivery/delivery.js";
import {
  ParkedDeliveryObligations,
  type ParkedDeliveryObligationRecord,
} from "../delivery/parked-delivery-obligations.js";
import type { DeliveryShardEvidence, DeliveryWorkerEvidence } from "../delivery/delivery-worker.js";
import { DeliveryWorker, deliveryWorkerAccess } from "../delivery/delivery-worker.js";
import { ShardIndex } from "../delivery/shard-index.js";

/** @internal Ownership relation for one package-internal environment registration. */
export type EnvironmentOwnership = "caller" | "server";

/** @internal Opaque identity of one current non-retired environment generation. */
export interface EnvironmentGeneration {
  readonly generation: true;
}

/** @internal Reserved registration identity used by later attachment lifecycle slices. */
export interface EnvironmentRegistrationClaim {
  readonly token: string;
  readonly generation: EnvironmentGeneration;
}

/** @internal Input assembled by future server lifecycle integration from built contexts. */
export interface EnvironmentAttachOptions {
  readonly ownership: EnvironmentOwnership;
  readonly descriptors: readonly ContextDeliveryDescriptor[];
}

/** @internal Opaque successful attachment used by later detach/stop/server slices. */
export interface EnvironmentAttachmentHandle extends EnvironmentRegistrationClaim {
  readonly startup: DeliveryRunSettlement;
  records(): readonly ParkedDeliveryObligationRecord[];
}

/** @internal Synchronous cardinality gate owned by one ServerEnvironment instance. */
export class EnvironmentRegistrations {
  readonly #claims = new Map<string, EnvironmentRegistrationClaim>();
  #generation: EnvironmentGeneration | undefined;
  #ownership: EnvironmentOwnership | undefined;
  #nextToken = 0;

  get count(): number {
    return this.#claims.size;
  }

  claim(ownership: EnvironmentOwnership): EnvironmentRegistrationClaim {
    if (
      (ownership === "server" && this.#claims.size > 0) ||
      (ownership === "caller" && this.#ownership === "server")
    ) {
      throw new Error("Server-owned environment registration requires exclusive ownership.");
    }

    this.#generation ??= Object.freeze({ generation: true });
    this.#ownership ??= ownership;
    this.#nextToken += 1;
    const claim = Object.freeze({
      token: `registration-${this.#nextToken.toString()}`,
      generation: this.#generation,
    });
    this.#claims.set(claim.token, claim);
    return claim;
  }
}

/** @internal One ServerEnvironment's serialized generation attachment owner. */
export class EnvironmentAttachments {
  readonly #registrations = new EnvironmentRegistrations();
  readonly #generations = new Map<EnvironmentGeneration, DeliveryGeneration>();
  #serial = Promise.resolve();

  attach(options: EnvironmentAttachOptions): Promise<EnvironmentAttachmentHandle> {
    let claim: EnvironmentRegistrationClaim;
    try {
      claim = this.#registrations.claim(options.ownership);
    } catch (error) {
      return Promise.reject(asError(error));
    }
    let generation = this.#generations.get(claim.generation);
    if (generation === undefined) {
      generation = new DeliveryGeneration();
      this.#generations.set(claim.generation, generation);
    }
    const attaching = this.#serial.then(() => generation.attach(claim, options.descriptors));
    this.#serial = attaching.then(
      () => undefined,
      () => undefined,
    );
    return attaching;
  }
}

class DeliveryGeneration {
  readonly #worker = new EnvironmentRunWorker();
  readonly #descriptors = new WeakSet<ContextDeliveryDescriptor>();
  readonly #runtimeTenants = new WeakMap<ContextDeliveryDescriptor, Set<string>>();
  readonly #obligations = new Map<string, ParkedDeliveryObligations>();
  #coordinator: DeliveryRunCoordinator | undefined;

  async attach(
    claim: EnvironmentRegistrationClaim,
    descriptors: readonly ContextDeliveryDescriptor[],
  ): Promise<EnvironmentAttachmentHandle> {
    this.#requireFresh(descriptors);
    const registration = await assembleRegistration(claim, descriptors);
    for (const runtime of registration.runtimes) {
      this.#addRuntime(runtime);
    }
    const readiness = new RegistrationReadiness(
      (descriptor, ready) => {
        this.#prepareReady(descriptor, ready);
      },
      (ready) => {
        this.#coordinator?.notify(ready);
      },
    );
    await Promise.all(
      registration.descriptors.map(({ descriptor, scopes }) =>
        descriptor.transition(
          scopes,
          (ready) => {
            readiness.notify(descriptor, ready);
          },
          { allowEmpty: true },
        ),
      ),
    );
    const startup = readiness.open(registration.scopes);
    const settlement =
      startup.length === 0 || this.#coordinator === undefined
        ? emptySettlement()
        : await this.#coordinator.start(startup);
    const obligations =
      startup.length === 0 ? undefined : startupObligations(claim.token, startup, settlement);
    if (obligations !== undefined) {
      this.#obligations.set(claim.token, obligations);
    }
    const causes = rejectedCauses(obligations?.records() ?? []);
    if (causes.length === 1) {
      throw causes[0];
    }
    if (causes.length > 1) {
      throw new AggregateError(causes, "Environment attachment startup recovery failed.");
    }
    return handle(claim, settlement, obligations);
  }

  #prepareReady(descriptor: ContextDeliveryDescriptor, ready: DeliveryReady): void {
    const tenant: DeliveryTenantScope =
      ready.tenantId === undefined
        ? Object.freeze({})
        : Object.freeze({ tenantId: ready.tenantId });
    const scopes = descriptor.endpoints().map((endpoint) => readyScope(endpoint, tenant));
    this.#addRuntime({
      descriptor,
      tenant,
      context: descriptor.storageContext(tenant),
      scopes: Object.freeze(scopes),
    });
  }

  #addRuntime(runtime: DescriptorRuntime): void {
    const tenantKey = runtime.tenant.tenantId ?? "\u0000";
    const tenants = this.#runtimeTenants.get(runtime.descriptor) ?? new Set<string>();
    if (tenants.has(tenantKey)) {
      return;
    }
    tenants.add(tenantKey);
    this.#runtimeTenants.set(runtime.descriptor, tenants);
    this.#worker.add(runtime);
    if (this.#coordinator === undefined) {
      this.#coordinator = new DeliveryRunCoordinator({
        scopes: runtime.scopes,
        worker: this.#worker,
      });
    } else {
      this.#coordinator.configure(runtime.scopes);
    }
  }

  #requireFresh(descriptors: readonly ContextDeliveryDescriptor[]): void {
    const unique = new Set<ContextDeliveryDescriptor>();
    for (const descriptor of descriptors) {
      if (unique.has(descriptor)) {
        throw new Error("Attachment requires unique context delivery descriptors.");
      }
      if (this.#descriptors.has(descriptor)) {
        throw new Error("Context delivery descriptor is already attached.");
      }
      unique.add(descriptor);
    }
    for (const descriptor of unique) {
      this.#descriptors.add(descriptor);
    }
  }
}

class RegistrationReadiness {
  readonly #onPrepare: (descriptor: ContextDeliveryDescriptor, ready: DeliveryReady) => void;
  readonly #onNotify: (ready: DeliveryReady) => void;
  readonly #buffered = new Map<
    string,
    { readonly descriptor: ContextDeliveryDescriptor; readonly ready: DeliveryReady }
  >();
  #open = false;

  constructor(
    onPrepare: (descriptor: ContextDeliveryDescriptor, ready: DeliveryReady) => void,
    onNotify: (ready: DeliveryReady) => void,
  ) {
    this.#onPrepare = onPrepare;
    this.#onNotify = onNotify;
  }

  notify(descriptor: ContextDeliveryDescriptor, ready: DeliveryReady): void {
    if (this.#open) {
      this.#onPrepare(descriptor, ready);
      this.#onNotify(ready);
    } else {
      this.#buffered.set(scopeKey(ready), { descriptor, ready });
    }
  }

  open(startup: readonly DeliveryRunScope[]): readonly DeliveryRunScope[] {
    const scopes = new Map<string, DeliveryRunScope>();
    for (const scope of startup) {
      scopes.set(scopeKey(scope), scope);
    }
    for (const { descriptor, ready } of this.#buffered.values()) {
      this.#onPrepare(descriptor, ready);
      scopes.set(scopeKey(ready), ready);
    }
    this.#buffered.clear();
    this.#open = true;
    return Object.freeze([...scopes.values()]);
  }
}

interface AssembledRegistration {
  readonly scopes: readonly DeliveryRunScope[];
  readonly runtimes: readonly DescriptorRuntime[];
  readonly descriptors: readonly {
    readonly descriptor: ContextDeliveryDescriptor;
    readonly scopes: readonly DeliveryRunScope[];
  }[];
}

interface DescriptorRuntime {
  readonly descriptor: ContextDeliveryDescriptor;
  readonly tenant: DeliveryTenantScope;
  readonly context: StorageContext;
  readonly scopes: readonly DeliveryRunScope[];
}

async function assembleRegistration(
  _claim: EnvironmentRegistrationClaim,
  descriptors: readonly ContextDeliveryDescriptor[],
): Promise<AssembledRegistration> {
  const scopes = new Map<string, DeliveryRunScope>();
  const runtimes: DescriptorRuntime[] = [];
  const assembled: AssembledRegistration["descriptors"][number][] = [];
  for (const descriptor of descriptors) {
    const descriptorScopes: DeliveryRunScope[] = [];
    const tenants = await descriptor.startupScopes();
    const endpoints = descriptor.endpoints();
    for (const tenant of tenants) {
      const runtimeScopes = endpoints.map((endpoint) => readyScope(endpoint, tenant));
      if (runtimeScopes.length > 0) {
        runtimes.push({
          descriptor,
          tenant,
          context: descriptor.storageContext(tenant),
          scopes: Object.freeze(runtimeScopes),
        });
      }
      for (const scope of runtimeScopes) {
        scopes.set(scopeKey(scope), scope);
        descriptorScopes.push(scope);
      }
    }
    if (endpoints.length > 0) {
      assembled.push({ descriptor, scopes: Object.freeze(descriptorScopes) });
    }
  }
  return {
    scopes: Object.freeze([...scopes.values()]),
    runtimes: Object.freeze(runtimes),
    descriptors: Object.freeze(assembled),
  };
}

class EnvironmentRunWorker implements DeliveryRunWorker {
  readonly #entries: RunEntry[] = [];

  add(runtime: DescriptorRuntime): void {
    const shards = uniqueShards(runtime.scopes);
    const delivery = new Delivery({
      context: runtime.context,
      storageFactory: runtime.descriptor.storageFactory,
    });
    const worker = new DeliveryWorker({
      delivery,
      shards,
      node: runtime.context.name,
      onMessage: (message) => runtime.descriptor.replay(message, runtime.tenant.tenantId),
    });
    this.#entries.push({
      scopes: new Set(runtime.scopes.map(scopeKey)),
      shards: new Set(shards.map((shard) => shard.key())),
      worker: deliveryRunWorker(worker),
    });
  }

  start(
    obligation: DeliveryRunObligation,
    shards: readonly ShardIndex[],
  ): Promise<DeliveryWorkerEvidence> {
    const obligationScopes = new Set(obligation.scopes.map(scopeKey));
    const requested = new Set(shards.map((shard) => shard.key()));
    const entries = this.#entries.filter(
      (entry) => intersects(entry.scopes, obligationScopes) && intersects(entry.shards, requested),
    );
    const starts = entries.map((entry) => {
      const selected = shards.filter((shard) => entry.shards.has(shard.key()));
      return entry.worker.start(obligation, selected);
    });
    return Promise.all(starts).then((evidence) => mergeEvidence(obligation, shards, evidence));
  }

  stop(): void {
    const failures: unknown[] = [];
    for (const { worker } of this.#entries) {
      try {
        worker.stop();
      } catch (error) {
        failures.push(error);
      }
    }
    throwFailures(failures, "Environment delivery worker stop failed.");
  }

  async awaitSettled(): Promise<void> {
    await Promise.all(this.#entries.map(({ worker }) => worker.awaitSettled()));
  }

  async retire(): Promise<void> {
    const settled = await Promise.allSettled(this.#entries.map(({ worker }) => worker.retire()));
    const failures: unknown[] = [];
    for (const result of settled) {
      if (result.status === "rejected") {
        failures.push(result.reason);
      }
    }
    throwFailures(failures, "Environment delivery worker retirement failed.");
  }
}

interface RunEntry {
  readonly scopes: ReadonlySet<string>;
  readonly shards: ReadonlySet<string>;
  readonly worker: DeliveryRunWorker;
}

function mergeEvidence(
  obligation: DeliveryRunObligation,
  shards: readonly ShardIndex[],
  evidence: readonly DeliveryWorkerEvidence[],
): DeliveryWorkerEvidence {
  return Object.freeze({
    obligation,
    shards: Object.freeze(
      shards.map((shard) =>
        mergeShard(
          obligation,
          shard,
          evidence.flatMap((item) => item.shards),
        ),
      ),
    ),
  });
}

function mergeShard(
  obligation: DeliveryRunObligation,
  shard: ShardIndex,
  evidence: readonly DeliveryShardEvidence[],
): DeliveryShardEvidence {
  const matching = evidence.filter((item) => item.shard.key() === shard.key());
  const rejected = matching.filter((item) => item.status === "rejected");
  const progress = addProgress(matching.map((item) => item.progress));
  if (rejected.length > 0) {
    const causes = rejected.map((item) => item.cause);
    return Object.freeze({
      status: "rejected",
      shard,
      obligation,
      cause:
        causes.length === 1
          ? causes[0]
          : new AggregateError(causes, "Environment delivery shard failed."),
      progress,
    });
  }
  const runs = matching.flatMap((item) => (item.status === "fulfilled" ? [item.run] : []));
  const run = addRuns(runs);
  return Object.freeze({ status: "fulfilled", shard, obligation, run, progress });
}

function addRuns(runs: readonly DeliveryLoopRun[]): DeliveryLoopRun {
  const progress = addProgress(runs);
  return Object.freeze({ status: deliveryWorkerAccess.status(runs), ...progress });
}

function addProgress(progress: readonly DeliveryLoopProgress[]): DeliveryLoopProgress {
  return Object.freeze({
    runs: sum(progress, "runs"),
    processed: sum(progress, "processed"),
    accepted: sum(progress, "accepted"),
    delivered: sum(progress, "delivered"),
    failed: sum(progress, "failed"),
    failures: Object.freeze(progress.flatMap((item) => item.failures)),
  });
}

function sum(progress: readonly DeliveryLoopProgress[], key: keyof DeliveryLoopProgress): number {
  return progress.reduce((total, item) => {
    const value = item[key];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
}

function startupObligations(
  token: string,
  scopes: readonly DeliveryRunScope[],
  settlement: DeliveryRunSettlement,
): ParkedDeliveryObligations {
  const units = scopes.map(scopeKey);
  const obligations = new ParkedDeliveryObligations({
    registrations: [{ token, obligations: [{ key: "startup", units }] }],
    generation: [{ key: "generation", units }],
  });
  const configured = new Set(units);
  for (const result of settlement.scopes) {
    const unit = scopeKey(result.scope);
    if (!configured.has(unit)) {
      continue;
    }
    const owner = { kind: "registration" as const, token };
    if (result.disposition === "REJECTED") {
      obligations.park(owner, "startup", [unit], result.cause);
    } else if (result.disposition === "PARKED") {
      obligations.parkFulfilledFailed(owner, "startup", [unit]);
    } else {
      obligations.fulfilled(owner, "startup", [unit]);
    }
  }
  return obligations;
}

function rejectedCauses(records: readonly ParkedDeliveryObligationRecord[]): readonly unknown[] {
  return Object.freeze(records.flatMap((record) => (record.hasCause ? [record.cause] : [])));
}

function handle(
  claim: EnvironmentRegistrationClaim,
  startup: DeliveryRunSettlement,
  obligations: ParkedDeliveryObligations | undefined,
): EnvironmentAttachmentHandle {
  return Object.freeze({
    ...claim,
    startup,
    records: () => obligations?.records() ?? Object.freeze([]),
  });
}

function readyScope(endpoint: DeliveryEndpoint, tenant: DeliveryTenantScope): DeliveryRunScope {
  return Object.freeze({
    ...(tenant.tenantId === undefined ? {} : { tenantId: tenant.tenantId }),
    label: endpoint.label,
    targetTypeUrl: endpoint.targetTypeUrl,
    shard: new ShardIndex(endpoint.shard.index, endpoint.shard.ofTotal),
  });
}

function uniqueShards(scopes: readonly DeliveryRunScope[]): readonly ShardIndex[] {
  const shards = new Map<string, ShardIndex>();
  for (const scope of scopes) {
    shards.set(scope.shard.key(), scope.shard);
  }
  return Object.freeze([...shards.values()]);
}

function scopeKey(scope: DeliveryRunScope): string {
  return JSON.stringify([
    scope.tenantId ?? null,
    scope.label,
    scope.targetTypeUrl,
    scope.shard.index,
    scope.shard.ofTotal,
  ]);
}

function intersects(first: ReadonlySet<string>, second: ReadonlySet<string>): boolean {
  for (const value of first) {
    if (second.has(value)) {
      return true;
    }
  }
  return false;
}

function emptySettlement(): DeliveryRunSettlement {
  return Object.freeze({ scopes: Object.freeze([]), pending: Object.freeze([]) });
}

function throwFailures(failures: readonly unknown[], message: string): void {
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, message);
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
