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
  type EnvironmentGenerationWorker,
} from "./environment-delivery-worker.js";

export type { EnvironmentGenerationWorker } from "./environment-delivery-worker.js";

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

/** @internal Construction seams for deterministic package lifecycle tests. */
export interface EnvironmentAttachmentsOptions {
  readonly createWorker?: () => EnvironmentGenerationWorker;
  readonly report?: (causes: readonly unknown[]) => Promise<void>;
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

  /** @internal Remove one failed attachment without disturbing sibling claims. */
  remove(token: string): number {
    if (!this.#claims.delete(token)) {
      throw new Error("Environment registration is not active.");
    }
    return this.#claims.size;
  }

  /** @internal Release an empty generation only after its retirement is safe. */
  clear(generation: EnvironmentGeneration): void {
    if (this.#claims.size > 0) {
      throw new Error("Environment generation still has live registrations.");
    }
    if (this.#generation !== generation) {
      throw new Error("Environment generation is not current.");
    }
    this.#generation = undefined;
    this.#ownership = undefined;
  }
}

/** @internal One ServerEnvironment's serialized generation attachment owner. */
export class EnvironmentAttachments {
  readonly #registrations = new EnvironmentRegistrations();
  readonly #generations = new Map<EnvironmentGeneration, DeliveryGeneration>();
  readonly #createWorker: () => EnvironmentGenerationWorker;
  readonly #report: (causes: readonly unknown[]) => Promise<void>;
  #serial = Promise.resolve();
  #failedRollback: FailedStartRollback | undefined;

  constructor(options: EnvironmentAttachmentsOptions = {}) {
    this.#createWorker = options.createWorker ?? (() => new EnvironmentDeliveryWorker());
    this.#report = options.report ?? (() => Promise.resolve());
  }

  attach(options: EnvironmentAttachOptions): Promise<EnvironmentAttachmentHandle> {
    if (this.#failedRollback !== undefined) {
      return Promise.reject(
        new Error("Environment generation rollback requires an explicit retry."),
      );
    }
    let claim: EnvironmentRegistrationClaim;
    try {
      claim = this.#registrations.claim(options.ownership);
    } catch (error) {
      return Promise.reject(asError(error));
    }
    let generation = this.#generations.get(claim.generation);
    if (generation === undefined) {
      generation = new DeliveryGeneration(this.#createWorker(), this.#report);
      this.#generations.set(claim.generation, generation);
    }
    const attaching = this.#serial.then(() =>
      this.#attachRegistration(generation, claim, options.descriptors),
    );
    this.#serial = attaching.then(
      () => undefined,
      () => undefined,
    );
    return attaching;
  }

  retryFailedStart(): Promise<void> {
    const rollback = this.#failedRollback;
    if (rollback === undefined) {
      return Promise.reject(new Error("Environment has no failed-start rollback to retry."));
    }
    const retrying = this.#serial.then(() => this.#continueRollback(rollback));
    this.#serial = retrying.then(
      () => undefined,
      () => undefined,
    );
    return retrying;
  }

  async #attachRegistration(
    generation: DeliveryGeneration,
    claim: EnvironmentRegistrationClaim,
    descriptors: readonly ContextDeliveryDescriptor[],
  ): Promise<EnvironmentAttachmentHandle> {
    try {
      return await generation.attach(claim, descriptors);
    } catch (startError) {
      const remaining = this.#registrations.remove(claim.token);
      try {
        if (remaining > 0) {
          await generation.rollbackRegistration(claim.token);
        } else {
          const rollback = { claim, generation };
          this.#failedRollback = rollback;
          await this.#continueRollback(rollback);
        }
      } catch (rollbackError) {
        throw failedStartError(startError, rollbackError);
      }
      throw startError;
    }
  }

  async #continueRollback(rollback: FailedStartRollback): Promise<void> {
    try {
      await rollback.generation.retireFailedRegistration(rollback.claim.token);
    } finally {
      if (rollback.generation.replacementSafe) {
        this.#generations.delete(rollback.claim.generation);
        this.#registrations.clear(rollback.claim.generation);
        if (this.#failedRollback === rollback) {
          this.#failedRollback = undefined;
        }
      }
    }
  }
}

interface FailedStartRollback {
  readonly claim: EnvironmentRegistrationClaim;
  readonly generation: DeliveryGeneration;
}

interface GenerationRegistration {
  readonly readiness: RegistrationReadiness;
  readonly scopes: readonly DeliveryRunScope[];
  readonly ownerKeys: readonly string[];
}

interface ReportedFailure {
  readonly domain: ReadonlySet<string>;
  readonly obligations: ParkedDeliveryObligations;
}

class DeliveryGeneration {
  readonly #worker: EnvironmentGenerationWorker;
  readonly #report: (causes: readonly unknown[]) => Promise<void>;
  readonly #descriptors = new WeakSet<ContextDeliveryDescriptor>();
  readonly #runtimes = new WeakMap<
    ContextDeliveryDescriptor,
    Map<string, EnvironmentDeliveryRuntime>
  >();
  readonly #obligations = new Map<string, ParkedDeliveryObligations>();
  readonly #registrations = new Map<string, GenerationRegistration>();
  readonly #reportedFailures: ReportedFailure[] = [];
  readonly #configuredOwners = new Set<string>();
  #coordinator: DeliveryRunCoordinator | undefined;
  #nextOwner = 0;
  #retiredWithoutCoordinator = false;

  constructor(
    worker: EnvironmentGenerationWorker,
    report: (causes: readonly unknown[]) => Promise<void>,
  ) {
    this.#worker = worker;
    this.#report = report;
  }

  get replacementSafe(): boolean {
    return this.#coordinator?.replacementSafe ?? this.#retiredWithoutCoordinator;
  }

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
    this.#registrations.set(claim.token, {
      readiness,
      scopes: registration.scopes,
      ownerKeys: Object.freeze(registration.runtimes.map(({ owner }) => owner.key)),
    });
    await this.#transition(registration, readiness);
    return await this.#recover(claim, readiness.open(registration.scopes));
  }

  async rollbackRegistration(token: string): Promise<void> {
    const state = this.#registrations.get(token);
    state?.readiness.fail();
    const failures: unknown[] = [];
    try {
      await this.#consumeRegistration(token, false);
    } catch (error) {
      failures.push(error);
    }
    if (state !== undefined) {
      try {
        await this.#worker.retireOwners(state.ownerKeys);
      } catch (error) {
        failures.push(error);
      }
    }
    this.#registrations.delete(token);
    throwFailures(failures, "Environment registration rollback failed.");
  }

  async retireFailedRegistration(token: string): Promise<void> {
    this.#registrations.get(token)?.readiness.fail();
    if (this.#coordinator === undefined) {
      await this.#consumeRegistration(token, true);
      this.#registrations.delete(token);
      this.#retiredWithoutCoordinator = true;
      return;
    }
    await this.#coordinator.retire(async () => {
      await this.#consumeRegistration(token, true);
      this.#registrations.delete(token);
    });
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
    const blocked = this.#hasReportedOverlap(startup);
    const settlement = await this.#start(startup);
    const obligations = this.#recordObligations(claim.token, startup, settlement);
    throwRejected(obligations?.records() ?? [], blocked);
    return handle(claim, settlement, obligations);
  }

  async #consumeRegistration(token: string, consumeGeneration: boolean): Promise<void> {
    const state = this.#registrations.get(token);
    const obligations = this.#obligations.get(token);
    if (state === undefined || obligations === undefined) {
      return;
    }
    const units = state.scopes.map(scopeKey);
    const causes = obligations.report([
      { owner: { kind: "registration", token }, obligation: "startup", units },
    ]);
    let reportFailure: unknown;
    try {
      if (causes.length > 0) {
        await this.#report(causes);
      }
    } catch (error) {
      reportFailure = error;
    }
    obligations.removeRegistration(token);
    if (consumeGeneration) {
      this.#obligations.delete(token);
    } else if (obligations.records().length > 0) {
      this.#reportedFailures.push({
        domain: new Set(state.scopes.map(({ ready }) => readyKey(ready))),
        obligations,
      });
    }
    if (reportFailure !== undefined) {
      throw asError(reportFailure);
    }
  }

  #hasReportedOverlap(scopes: readonly DeliveryRunScope[]): boolean {
    const domain = new Set(scopes.map(({ ready }) => readyKey(ready)));
    return this.#reportedFailures.some(
      ({ domain: failed, obligations }) =>
        intersects(domain, failed) &&
        obligations.records().some((record) => record.hasCause && record.reportedSinceResolution),
    );
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

  fail(): void {
    this.#mode = "failed";
    this.#buffered.clear();
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

function throwRejected(records: readonly ParkedDeliveryObligationRecord[], blocked: boolean): void {
  const causes = records.flatMap((record) => (record.hasCause ? [record.cause] : []));
  if (blocked) {
    causes.push(
      new Error("Startup recovery is blocked by an unresolved shared delivery obligation."),
    );
  }
  if (causes.length === 1) {
    throw causes[0];
  }
  if (causes.length > 1) {
    throw new AggregateError(causes, "Environment attachment startup recovery failed.");
  }
}

function intersects(first: ReadonlySet<string>, second: ReadonlySet<string>): boolean {
  for (const value of first) {
    if (second.has(value)) {
      return true;
    }
  }
  return false;
}

function failedStartError(startError: unknown, rollbackError: unknown): AggregateError {
  const rollbackErrors: readonly unknown[] =
    rollbackError instanceof AggregateError
      ? (rollbackError.errors as readonly unknown[])
      : [rollbackError];
  return new AggregateError(
    [asError(startError), ...rollbackErrors.map(asError)],
    "Environment attachment failed and rollback also failed.",
  );
}

function throwFailures(failures: readonly unknown[], message: string): void {
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, message);
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
