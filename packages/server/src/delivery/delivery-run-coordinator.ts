import type { DeliveryReady } from "../context/local-inbox-handoff.js";
import type { DeliveryLoopProgress, DeliveryLoopStatus } from "./delivery-loop.js";
import {
  type DeliveryShardEvidence,
  type DeliveryWorker,
  type DeliveryWorkerEvidence,
  type DeliveryWorkerObligation,
  deliveryWorkerAccess,
} from "./delivery-worker.js";
import { ShardIndex } from "./shard-index.js";

const synthesizedRetirementFailures = new WeakMap<AggregateError, readonly unknown[]>();

/** @internal Ordered causes owned by this coordinator's retirement aggregation. */
export function deliveryRunRetirementCauses(error: unknown): readonly unknown[] | undefined {
  return error instanceof AggregateError ? synthesizedRetirementFailures.get(error) : undefined;
}

/** @internal Serializes finite worker starts for one delivery generation. */
export class DeliveryRunCoordinator {
  readonly #worker: DeliveryRunWorker;
  readonly #configured = new Map<string, DeliveryRunScope>();
  readonly #pending = new Map<string, DeliveryRunScope>();
  readonly #settled = new Map<string, DeliveryScopeSettlement>();
  #active: Promise<void> | undefined;
  #accepting = true;
  #stopCalled = false;
  #fault: Error | undefined;
  #finalized = false;
  #onReport: ((settlement: DeliveryRunSettlement) => Promise<void>) | undefined;
  #retirement: Promise<void> | undefined;
  readonly #onSettlement: ((settlement: DeliveryScopeSettlement) => unknown) | undefined;

  constructor(options: {
    readonly scopes: readonly DeliveryRunScope[];
    readonly worker: DeliveryRunWorker;
    readonly onSettlement?: (settlement: DeliveryScopeSettlement) => unknown;
  }) {
    this.#worker = options.worker;
    this.#onSettlement = options.onSettlement;
    this.#configure(options.scopes);
    if (this.#configured.size === 0) {
      throw new Error("Delivery run coordinator requires at least one configured scope.");
    }
  }

  /** @internal Extend this live generation with later registered canonical scopes. */
  configure(scopes: readonly DeliveryRunScope[]): void {
    if (!this.#accepting) {
      throw new Error("Delivery run coordinator admission is closed.");
    }
    this.#configure(scopes);
  }

  get replacementSafe(): boolean {
    return this.#finalized;
  }

  get retired(): boolean {
    return this.#finalized;
  }

  /** @internal Current generation-local canonical scope cardinality. */
  get configuredScopeCount(): number {
    return this.#configured.size;
  }

  start(scopes: readonly DeliveryRunScope[]): Promise<DeliveryRunSettlement> {
    if (!this.#accepting) {
      return Promise.reject(new Error("Delivery run coordinator admission is closed."));
    }
    if (this.#fault !== undefined) {
      return Promise.reject(this.#fault);
    }
    try {
      this.#admit(scopes);
    } catch (error) {
      return Promise.reject(asError(error));
    }
    const active = this.#ensureActive();
    return active.then(() => this.settlement());
  }

  notify(scope: DeliveryRunScope): void {
    if (!this.#accepting || this.#fault !== undefined) {
      return;
    }
    try {
      this.#admit([scope]);
      void this.#ensureActive().catch(() => undefined);
    } catch {
      // Readiness notification cannot alter a completed durable write.
    }
  }

  /** @internal Reclaim quiesced, permanently retired owner state without disturbing siblings. */
  async removeOwners(ownerKeys: readonly string[]): Promise<void> {
    const owners = new Set(ownerKeys);
    this.#removePendingOwners(owners);
    await this.#active?.catch(() => undefined);
    this.#removePendingOwners(owners);
    for (const [key, scope] of this.#configured) {
      if (owners.has(scope.owner.key)) {
        this.#configured.delete(key);
      }
    }
    for (const [key, settlement] of this.#settled) {
      if (owners.has(settlement.scope.owner.key)) {
        this.#settled.delete(key);
      }
    }
  }

  /** @internal Await retained work that could still start selected owners without reclaiming evidence. */
  async awaitOwnersBarrier(ownerKeys: readonly string[]): Promise<void> {
    if (ownerKeys.length === 0) {
      return;
    }
    this.#requireHealthy();
    const owners = new Set(ownerKeys);
    this.#removePendingOwners(owners);
    const active = this.#active;
    await active;
    this.#requireHealthy();
    const successor = this.#active;
    if (successor !== undefined && successor !== active) {
      await successor;
      this.#requireHealthy();
    }
    this.#removePendingOwners(owners);
  }

  settlement(): DeliveryRunSettlement {
    const scopes: DeliveryScopeSettlement[] = [];
    for (const key of this.#configured.keys()) {
      const settled = this.#settled.get(key);
      if (settled !== undefined) {
        scopes.push(cloneSettlement(settled));
      }
    }
    return Object.freeze({
      scopes: Object.freeze(scopes),
      pending: Object.freeze(Array.from(this.#pending.values(), cloneScope)),
    });
  }

  retire(onReport: (settlement: DeliveryRunSettlement) => Promise<void>): Promise<void> {
    this.#onReport ??= onReport;
    if (this.#retirement !== undefined) {
      return this.#retirement;
    }

    const gate = Promise.withResolvers<undefined>();
    const retirement = gate.promise;
    this.#retirement = retirement;
    void this.#advanceRetirement().then(
      () => {
        gate.resolve(undefined);
      },
      (error: unknown) => {
        if (!this.#finalized) {
          this.#retirement = undefined;
        }
        gate.reject(error);
      },
    );
    return retirement;
  }

  #admit(scopes: readonly DeliveryRunScope[]): void {
    const admitted = scopes.map((candidate) => {
      const configured = this.#configured.get(scopeKey(candidate));
      if (configured === undefined) {
        throw new Error("Delivery run scope is not configured.");
      }
      return configured;
    });
    for (const configured of admitted) {
      this.#pending.set(scopeKey(configured), configured);
    }
  }

  #configure(scopes: readonly DeliveryRunScope[]): void {
    for (const candidate of scopes) {
      const scope = cloneScope(candidate);
      this.#configured.set(scopeKey(scope), scope);
    }
  }

  #ensureActive(admissionLimit = 2): Promise<void> {
    if (this.#active !== undefined) {
      return this.#active;
    }
    const gate = Promise.withResolvers<undefined>();
    let admissions = 0;
    const draining = gate.promise.catch((cause: unknown) => {
      const fault = asError(cause);
      this.#fault ??= fault;
      throw this.#fault;
    });
    const active = draining.finally(() => {
      if (this.#active === active) {
        this.#active = undefined;
        if (
          this.#accepting &&
          this.#fault === undefined &&
          this.#pending.size > 0 &&
          admissions < admissionLimit
        ) {
          return this.#ensureActive(admissionLimit - admissions);
        }
      }
    });
    this.#active = active;
    void this.#drainPending(admissionLimit).then((completed) => {
      admissions = completed;
      gate.resolve(undefined);
    }, gate.reject);
    return active;
  }

  async #drainPending(admissionLimit: number): Promise<number> {
    let completed = 0;
    for (let admission = 0; admission < admissionLimit; admission += 1) {
      if (!this.#accepting || this.#pending.size === 0) {
        return completed;
      }
      const admitted = Array.from(this.#pending.values());
      this.#pending.clear();
      await this.#runAdmission(admitted);
      completed += 1;
    }
    return completed;
  }

  async #runAdmission(scopes: readonly DeliveryRunScope[]): Promise<void> {
    const byOwner = new Map<string, DeliveryRunScope[]>();
    for (const scope of scopes) {
      const partition = byOwner.get(scope.owner.key) ?? [];
      partition.push(scope);
      byOwner.set(scope.owner.key, partition);
    }
    for (const partition of byOwner.values()) {
      await this.#runOwnerAdmission(partition);
    }
  }

  async #runOwnerAdmission(scopes: readonly DeliveryRunScope[]): Promise<void> {
    const obligation = runObligation(scopes);
    let shards = scopeShards(scopes);
    while (shards.length > 0) {
      let evidence: DeliveryWorkerEvidence;
      const started = this.#worker.start(obligation, shards);
      try {
        evidence = await started;
      } catch (cause) {
        this.#recordStartFailure(scopes, shards, cause);
        return;
      }
      validateWorkerEvidence(obligation, shards, evidence);
      const rejected = this.#recordEvidence(scopes, evidence);
      this.#parkPending(rejected);
      if (!this.#accepting) {
        return;
      }
      shards = pausedShards(evidence);
    }
  }

  #recordStartFailure(
    scopes: readonly DeliveryRunScope[],
    shards: readonly ShardIndex[],
    cause: unknown,
  ): void {
    const owner = requiredOwner(scopes);
    const attempted = new Set(shards.map((shard) => shard.key()));
    for (const scope of scopes) {
      if (attempted.has(scope.ready.shard.key())) {
        this.#recordSettlement(scope, rejectedSettlement(scope, cause));
      }
    }
    this.#parkPending(new Set(Array.from(attempted, (key) => ownerShardKey(owner, key))));
  }

  #recordEvidence(
    scopes: readonly DeliveryRunScope[],
    evidence: DeliveryWorkerEvidence,
  ): ReadonlySet<string> {
    const owner = requiredOwner(scopes);
    const rejected = new Set<string>();
    for (const shardEvidence of evidence.shards) {
      const shardKey = shardEvidence.shard.key();
      if (shardEvidence.status === "rejected") {
        rejected.add(ownerShardKey(owner, shardKey));
      }
      for (const scope of scopes) {
        if (scope.ready.shard.key() === shardKey) {
          this.#recordSettlement(scope, shardSettlement(scope, shardEvidence));
        }
      }
    }
    return rejected;
  }

  #parkPending(rejected: ReadonlySet<string>): void {
    for (const [key, scope] of this.#pending) {
      if (rejected.has(ownerShardKey(scope.owner, scope.ready.shard.key()))) {
        this.#pending.delete(key);
      }
    }
  }

  #recordSettlement(scope: DeliveryRunScope, settlement: DeliveryScopeSettlement): void {
    const key = scopeKey(scope);
    const previous = this.#settled.get(key);
    this.#settled.set(key, settlement);
    if (previous !== undefined && sameSettlement(previous, settlement)) {
      return;
    }
    const observed = this.#onSettlement?.(cloneSettlement(settlement));
    if (isPromiseLike(observed)) {
      void Promise.resolve(observed).catch(() => undefined);
      throw new Error("Delivery run settlement observer must complete synchronously.");
    }
  }

  #removePendingOwners(owners: ReadonlySet<string>): void {
    for (const [key, scope] of this.#pending) {
      if (owners.has(scope.owner.key)) {
        this.#pending.delete(key);
      }
    }
  }

  #requireHealthy(): void {
    if (this.#fault !== undefined) {
      throw this.#fault;
    }
  }

  async #advanceRetirement(): Promise<void> {
    if (!this.#stopCalled) {
      this.#accepting = false;
      try {
        this.#worker.stop();
      } catch (cause) {
        throw new DeliveryRunQuiescenceError(cause);
      }
      this.#stopCalled = true;
    }

    await this.#active?.catch(() => undefined);
    try {
      await this.#worker.awaitSettled();
    } catch (cause) {
      throw new DeliveryRunQuiescenceError(cause);
    }

    const failures: unknown[] = this.#fault === undefined ? [] : [this.#fault];
    try {
      await this.#onReport?.(this.settlement());
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.#worker.retire();
    } catch (error) {
      failures.push(error);
    }
    this.#finalized = true;
    throwFailures(failures);
  }
}

/** @internal One generation-local runtime owner. */
export interface DeliveryRunOwner {
  readonly key: string;
}

/** @internal Owner-qualified canonical readiness admitted for one generation. */
export interface DeliveryRunScope {
  readonly owner: DeliveryRunOwner;
  readonly ready: DeliveryReady;
}

/** @internal Finite package-owned worker obligation for one canonical scope union. */
export interface DeliveryRunObligation extends DeliveryWorkerObligation {
  readonly scopes: readonly DeliveryRunScope[];
}

/** @internal Generation worker seam used by the bounded run coordinator. */
export interface DeliveryRunWorker {
  start(
    obligation: DeliveryRunObligation,
    shards: readonly ShardIndex[],
  ): Promise<DeliveryWorkerEvidence>;
  /** Irreversibly stops loop admission. A throw means stop did not complete and must be retried. */
  stop(): void;
  /** Waits for active work to settle without interrupting it; rejection means quiescence is unproved. */
  awaitSettled(): Promise<void>;
  /**
   * Requires a completed stop and proven settlement. Permanently closes every
   * worker start entry before settling, even when inert-resource cleanup fails.
   */
  retire(): Promise<void>;
}

/** @internal Latest bounded disposition for one configured canonical scope. */
export interface DeliveryScopeSettlement {
  readonly scope: DeliveryRunScope;
  readonly disposition: "IDLE" | "PARKED" | "REJECTED" | "STOPPED";
  readonly cause?: unknown;
  readonly progress?: DeliveryLoopProgress;
}

/** @internal Bounded generation evidence retained by the coordinator. */
export interface DeliveryRunSettlement {
  readonly scopes: readonly DeliveryScopeSettlement[];
  readonly pending: readonly DeliveryRunScope[];
}

/** @internal Retirement failed before quiescence and the instance cannot be replaced. */
export class DeliveryRunQuiescenceError extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("Delivery run coordinator could not establish quiescence.");
    this.name = "DeliveryRunQuiescenceError";
    this.cause = cause;
  }
}

/** @internal Adapts a T-0036 worker to the generation coordinator seam. */
export function deliveryRunWorker(worker: DeliveryWorker): DeliveryRunWorker {
  return Object.freeze({
    start(obligation: DeliveryRunObligation, shards: readonly ShardIndex[]) {
      return deliveryWorkerAccess.start(worker, obligation, shards);
    },
    stop() {
      worker.stop();
    },
    awaitSettled() {
      return deliveryWorkerAccess.awaitSettled(worker);
    },
    retire() {
      return deliveryWorkerAccess.retire(worker);
    },
  });
}

function runObligation(scopes: readonly DeliveryRunScope[]): DeliveryRunObligation {
  return Object.freeze({ scopes: Object.freeze(scopes.map(cloneScope)) });
}

function scopeShards(scopes: readonly DeliveryRunScope[]): readonly ShardIndex[] {
  const shards = new Map<string, ShardIndex>();
  for (const { shard } of scopes.map(({ ready }) => ready)) {
    shards.set(shard.key(), new ShardIndex(shard.index, shard.ofTotal));
  }
  return Object.freeze(Array.from(shards.values()));
}

function pausedShards(evidence: DeliveryWorkerEvidence): readonly ShardIndex[] {
  return Object.freeze(
    evidence.shards.flatMap((result) =>
      result.status === "fulfilled" && result.run.status === "PAUSED"
        ? [new ShardIndex(result.shard.index, result.shard.ofTotal)]
        : [],
    ),
  );
}

function validateWorkerEvidence(
  obligation: DeliveryRunObligation,
  requested: readonly ShardIndex[],
  evidence: DeliveryWorkerEvidence,
): void {
  if (evidence.obligation !== obligation) {
    throw new Error("Delivery worker evidence obligation does not match the current obligation.");
  }

  const requestedKeys = new Set(requested.map((shard) => shard.key()));
  const seen = new Set<string>();
  for (const shard of evidence.shards) {
    if (shard.obligation !== obligation) {
      throw new Error("Delivery worker shard obligation does not match the current obligation.");
    }
    const key = shard.shard.key();
    if (!requestedKeys.has(key) || seen.has(key)) {
      throw new Error("Delivery worker evidence does not match the requested shard domain.");
    }
    seen.add(key);
  }
  if (seen.size !== requestedKeys.size) {
    throw new Error("Delivery worker evidence does not match the requested shard domain.");
  }
}

function shardSettlement(
  scope: DeliveryRunScope,
  evidence: DeliveryShardEvidence,
): DeliveryScopeSettlement {
  if (evidence.status === "rejected") {
    return rejectedSettlement(scope, evidence.cause, evidence.progress);
  }
  return Object.freeze({
    scope,
    disposition: disposition(evidence.run.status),
    progress: cloneProgress(evidence.progress),
  });
}

function rejectedSettlement(
  scope: DeliveryRunScope,
  cause: unknown,
  progress: DeliveryLoopProgress = emptyProgress(),
): DeliveryScopeSettlement {
  return Object.freeze({
    scope,
    disposition: "REJECTED",
    cause,
    progress: cloneProgress(progress),
  });
}

function disposition(status: DeliveryLoopStatus): DeliveryScopeSettlement["disposition"] {
  switch (status) {
    case "IDLE":
      return "IDLE";
    case "STOPPED":
      return "STOPPED";
    case "FAILED":
    case "SKIPPED":
    case "PAUSED":
      return "PARKED";
  }
}

function cloneSettlement(settlement: DeliveryScopeSettlement): DeliveryScopeSettlement {
  return Object.freeze({
    scope: cloneScope(settlement.scope),
    disposition: settlement.disposition,
    ...(settlement.cause === undefined ? {} : { cause: settlement.cause }),
    ...(settlement.progress === undefined ? {} : { progress: cloneProgress(settlement.progress) }),
  });
}

function cloneScope(scope: DeliveryRunScope): DeliveryRunScope {
  return Object.freeze({
    owner: Object.freeze({ key: scope.owner.key }),
    ready: Object.freeze({
      ...(scope.ready.tenantId === undefined ? {} : { tenantId: scope.ready.tenantId }),
      label: scope.ready.label,
      targetTypeUrl: scope.ready.targetTypeUrl,
      shard: new ShardIndex(scope.ready.shard.index, scope.ready.shard.ofTotal),
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

function ownerShardKey(owner: DeliveryRunOwner, shardKey: string): string {
  return JSON.stringify([owner.key, shardKey]);
}

function requiredOwner(scopes: readonly DeliveryRunScope[]): DeliveryRunOwner {
  const owner = scopes[0]?.owner;
  if (owner === undefined) {
    throw new Error("Delivery run admission requires at least one scope.");
  }
  return owner;
}

function cloneProgress(progress: DeliveryLoopProgress): DeliveryLoopProgress {
  return Object.freeze({ ...progress, failures: Object.freeze([...progress.failures]) });
}

function sameSettlement(previous: DeliveryScopeSettlement, next: DeliveryScopeSettlement): boolean {
  return (
    previous.disposition === next.disposition &&
    Object.is(previous.cause, next.cause) &&
    sameProgress(previous.progress, next.progress)
  );
}

function sameProgress(
  previous: DeliveryLoopProgress | undefined,
  next: DeliveryLoopProgress | undefined,
): boolean {
  if (previous === undefined || next === undefined) {
    return previous === next;
  }
  return (
    previous.runs === next.runs &&
    previous.processed === next.processed &&
    previous.accepted === next.accepted &&
    previous.delivered === next.delivered &&
    previous.failed === next.failed &&
    previous.failures.length === next.failures.length &&
    previous.failures.every(
      (failure, index) =>
        Object.is(failure.message, next.failures[index]?.message) &&
        Object.is(failure.error, next.failures[index]?.error),
    )
  );
}

function emptyProgress(): DeliveryLoopProgress {
  return Object.freeze({
    runs: 0,
    processed: 0,
    accepted: 0,
    delivered: 0,
    failed: 0,
    failures: Object.freeze([]),
  });
}

function throwFailures(failures: readonly unknown[]): void {
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    const causes = Object.freeze([...failures]);
    const aggregate = new AggregateError(causes, "Delivery run retirement failed.");
    synthesizedRetirementFailures.set(aggregate, causes);
    throw aggregate;
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    return false;
  }
  return typeof (value as { readonly then?: unknown }).then === "function";
}
