import type { ContextDeliveryDescriptor, DeliveryTenantScope } from "../context/bounded-context.js";
import type { DeliveryEndpoint, DeliveryReady } from "../context/local-inbox-handoff.js";
import {
  DeliveryRunCoordinator,
  type DeliveryRunOwner,
  type DeliveryRunScope,
  type DeliveryRunSettlement,
} from "../delivery/delivery-run-coordinator.js";
import {
  ParkedDeliveryObligations,
  type ParkedDeliveryObligationRecord,
} from "../delivery/parked-delivery-obligations.js";
import { ShardIndex } from "../delivery/shard-index.js";
import {
  EnvironmentDeliveryWorker,
  type EnvironmentDeliveryRuntime,
} from "./environment-delivery-worker.js";

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
  readonly #worker = new EnvironmentDeliveryWorker();
  readonly #descriptors = new WeakSet<ContextDeliveryDescriptor>();
  readonly #runtimes = new WeakMap<
    ContextDeliveryDescriptor,
    Map<string, EnvironmentDeliveryRuntime>
  >();
  readonly #obligations = new Map<string, ParkedDeliveryObligations>();
  readonly #configuredOwners = new Set<string>();
  #coordinator: DeliveryRunCoordinator | undefined;
  #nextOwner = 0;

  async attach(
    claim: EnvironmentRegistrationClaim,
    descriptors: readonly ContextDeliveryDescriptor[],
  ): Promise<EnvironmentAttachmentHandle> {
    this.#requireFresh(descriptors);
    const registration = await assembleRegistration(descriptors, (descriptor, tenant) =>
      this.#runtime(descriptor, tenant),
    );
    for (const runtime of registration.runtimes) {
      this.#addRuntime(runtime);
    }
    const readiness = this.#readiness(registration);
    await this.#transition(registration, readiness);
    return await this.#recover(claim, readiness.open(registration.scopes));
  }

  #readiness(registration: AssembledRegistration): RegistrationReadiness {
    return new RegistrationReadiness(
      registration.descriptors,
      (descriptor, ready) => this.#prepareReady(descriptor, ready),
      (scope) => this.#coordinator?.notify(scope),
    );
  }

  async #transition(
    registration: AssembledRegistration,
    readiness: RegistrationReadiness,
  ): Promise<void> {
    await Promise.all(
      registration.descriptors.map(({ descriptor, scopes }) =>
        descriptor.transition(
          scopes.map(({ ready }) => ready),
          (ready) => {
            readiness.notify(descriptor, ready);
          },
          { allowEmpty: true },
        ),
      ),
    );
  }

  async #recover(
    claim: EnvironmentRegistrationClaim,
    startup: readonly DeliveryRunScope[],
  ): Promise<EnvironmentAttachmentHandle> {
    const settlement = await this.#start(startup);
    const obligations = this.#recordObligations(claim.token, startup, settlement);
    throwRejected(obligations?.records() ?? []);
    return handle(claim, settlement, obligations);
  }

  async #start(startup: readonly DeliveryRunScope[]): Promise<DeliveryRunSettlement> {
    return startup.length === 0 || this.#coordinator === undefined
      ? emptySettlement()
      : await this.#coordinator.start(startup);
  }

  #recordObligations(
    token: string,
    startup: readonly DeliveryRunScope[],
    settlement: DeliveryRunSettlement,
  ): ParkedDeliveryObligations | undefined {
    const obligations =
      startup.length === 0 ? undefined : startupObligations(token, startup, settlement);
    if (obligations !== undefined) {
      this.#obligations.set(token, obligations);
    }
    return obligations;
  }

  #prepareReady(descriptor: ContextDeliveryDescriptor, ready: DeliveryReady): DeliveryRunScope {
    const tenant: DeliveryTenantScope =
      ready.tenantId === undefined
        ? Object.freeze({})
        : Object.freeze({ tenantId: ready.tenantId });
    const runtime = this.#runtime(descriptor, tenant);
    this.#addRuntime(runtime);
    const scope = runtime.scopes.find(
      ({ ready: candidate }) => readyKey(candidate) === readyKey(ready),
    );
    if (scope === undefined) {
      throw new Error("Environment readiness is outside the descriptor endpoint domain.");
    }
    return scope;
  }

  #addRuntime(runtime: EnvironmentDeliveryRuntime): void {
    if (this.#configuredOwners.has(runtime.owner.key)) {
      return;
    }
    this.#worker.add(runtime);
    this.#configuredOwners.add(runtime.owner.key);
    if (this.#coordinator === undefined) {
      this.#coordinator = new DeliveryRunCoordinator({
        scopes: runtime.scopes,
        worker: this.#worker,
      });
    } else {
      this.#coordinator.configure(runtime.scopes);
    }
  }

  #runtime(
    descriptor: ContextDeliveryDescriptor,
    tenant: DeliveryTenantScope,
  ): EnvironmentDeliveryRuntime {
    const tenantKey = tenant.tenantId ?? "\u0000";
    const existing = this.#runtimes.get(descriptor)?.get(tenantKey);
    if (existing !== undefined) {
      return existing;
    }
    this.#nextOwner += 1;
    const owner = Object.freeze({ key: `environment-owner-${this.#nextOwner.toString()}` });
    const runtime = Object.freeze({
      owner,
      descriptor,
      tenant,
      context: descriptor.storageContext(tenant),
      scopes: Object.freeze(
        descriptor.endpoints().map((endpoint) => readyScope(owner, endpoint, tenant)),
      ),
    });
    const runtimes =
      this.#runtimes.get(descriptor) ?? new Map<string, EnvironmentDeliveryRuntime>();
    runtimes.set(tenantKey, runtime);
    this.#runtimes.set(descriptor, runtimes);
    return runtime;
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

/** @internal Finite attachment-local bridge from descriptor transition to one generation. */
export class RegistrationReadiness {
  readonly #canonical = new WeakMap<
    ContextDeliveryDescriptor,
    ReadonlyMap<string, DeliveryRunScope>
  >();
  readonly #onPrepare: (
    descriptor: ContextDeliveryDescriptor,
    ready: DeliveryReady,
  ) => DeliveryRunScope;
  readonly #onNotify: (scope: DeliveryRunScope) => void;
  readonly #buffered = new Map<string, DeliveryRunScope>();
  #mode: "waiting" | "open" | "failed" = "waiting";
  #invalid = false;

  constructor(
    descriptors: readonly {
      readonly descriptor: ContextDeliveryDescriptor;
      readonly scopes: readonly DeliveryRunScope[];
    }[],
    onPrepare: (descriptor: ContextDeliveryDescriptor, ready: DeliveryReady) => DeliveryRunScope,
    onNotify: (scope: DeliveryRunScope) => void,
  ) {
    for (const { descriptor, scopes } of descriptors) {
      this.#canonical.set(
        descriptor,
        new Map(scopes.map((scope) => [readyKey(scope.ready), scope])),
      );
    }
    this.#onPrepare = onPrepare;
    this.#onNotify = onNotify;
  }

  notify(descriptor: ContextDeliveryDescriptor, ready: DeliveryReady): void {
    if (this.#mode === "failed") {
      return;
    }
    if (this.#mode === "open") {
      try {
        const scope = this.#onPrepare(descriptor, ready);
        this.#onNotify(scope);
      } catch {
        this.#mode = "failed";
      }
      return;
    }
    const scope = this.#canonical.get(descriptor)?.get(readyKey(ready));
    if (scope === undefined) {
      this.#invalid = true;
      return;
    }
    this.#buffered.set(scopeKey(scope), scope);
  }

  open(startup: readonly DeliveryRunScope[]): readonly DeliveryRunScope[] {
    if (this.#mode !== "waiting") {
      throw new Error("Registration readiness can only open once.");
    }
    if (this.#invalid) {
      this.#mode = "failed";
      this.#buffered.clear();
      throw new Error("Registration readiness received an unconfigured scope.");
    }
    const scopes = new Map<string, DeliveryRunScope>();
    for (const scope of startup) {
      scopes.set(scopeKey(scope), scope);
    }
    for (const scope of this.#buffered.values()) {
      scopes.set(scopeKey(scope), scope);
    }
    this.#buffered.clear();
    this.#mode = "open";
    return Object.freeze([...scopes.values()]);
  }
}

interface AssembledRegistration {
  readonly scopes: readonly DeliveryRunScope[];
  readonly runtimes: readonly EnvironmentDeliveryRuntime[];
  readonly descriptors: readonly {
    readonly descriptor: ContextDeliveryDescriptor;
    readonly scopes: readonly DeliveryRunScope[];
  }[];
}

async function assembleRegistration(
  descriptors: readonly ContextDeliveryDescriptor[],
  runtimeFor: (
    descriptor: ContextDeliveryDescriptor,
    tenant: DeliveryTenantScope,
  ) => EnvironmentDeliveryRuntime,
): Promise<AssembledRegistration> {
  const scopes = new Map<string, DeliveryRunScope>();
  const runtimes: EnvironmentDeliveryRuntime[] = [];
  const assembled: AssembledRegistration["descriptors"][number][] = [];
  for (const descriptor of descriptors) {
    const descriptorScopes: DeliveryRunScope[] = [];
    const tenants = await descriptor.startupScopes();
    const endpoints = descriptor.endpoints();
    for (const tenant of tenants) {
      const runtime = runtimeFor(descriptor, tenant);
      const runtimeScopes = runtime.scopes;
      if (runtimeScopes.length > 0) {
        runtimes.push(runtime);
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

/** @internal Converts one finite startup settlement into registration-scoped parked evidence. */
export function startupObligations(
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

function throwRejected(records: readonly ParkedDeliveryObligationRecord[]): void {
  const causes = records.flatMap((record) => (record.hasCause ? [record.cause] : []));
  if (causes.length === 1) {
    throw causes[0];
  }
  if (causes.length > 1) {
    throw new AggregateError(causes, "Environment attachment startup recovery failed.");
  }
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

function readyScope(
  owner: DeliveryRunOwner,
  endpoint: DeliveryEndpoint,
  tenant: DeliveryTenantScope,
): DeliveryRunScope {
  return Object.freeze({
    owner,
    ready: Object.freeze({
      ...(tenant.tenantId === undefined ? {} : { tenantId: tenant.tenantId }),
      label: endpoint.label,
      targetTypeUrl: endpoint.targetTypeUrl,
      shard: new ShardIndex(endpoint.shard.index, endpoint.shard.ofTotal),
    }),
  });
}

function scopeKey(scope: DeliveryRunScope): string {
  return JSON.stringify([
    scope.owner.key,
    scope.ready.tenantId ?? null,
    scope.ready.label,
    scope.ready.targetTypeUrl,
    scope.ready.shard.index,
    scope.ready.shard.ofTotal,
  ]);
}

function readyKey(scope: DeliveryReady): string {
  return JSON.stringify([
    scope.tenantId ?? null,
    scope.label,
    scope.targetTypeUrl,
    scope.shard.index,
    scope.shard.ofTotal,
  ]);
}

function emptySettlement(): DeliveryRunSettlement {
  return Object.freeze({ scopes: Object.freeze([]), pending: Object.freeze([]) });
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
