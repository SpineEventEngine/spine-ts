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

  constructor(options: {
    readonly scopes: readonly DeliveryRunScope[];
    readonly worker: DeliveryRunWorker;
  }) {
    this.#worker = options.worker;
    for (const candidate of options.scopes) {
      const scope = cloneScope(candidate);
      this.#configured.set(scopeKey(scope), scope);
    }
    if (this.#configured.size === 0) {
      throw new Error("Delivery run coordinator requires at least one configured scope.");
    }
  }

  get replacementSafe(): boolean {
    return this.#finalized;
  }

  get retired(): boolean {
    return this.#finalized;
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
    const attempted = new Set(shards.map((shard) => shard.key()));
    for (const scope of scopes) {
      if (attempted.has(scope.shard.key())) {
        this.#settled.set(scopeKey(scope), rejectedSettlement(scope, cause));
      }
    }
    this.#parkPending(attempted);
  }

  #recordEvidence(
    scopes: readonly DeliveryRunScope[],
    evidence: DeliveryWorkerEvidence,
  ): ReadonlySet<string> {
    const rejected = new Set<string>();
    for (const shardEvidence of evidence.shards) {
      const shardKey = shardEvidence.shard.key();
      if (shardEvidence.status === "rejected") {
        rejected.add(shardKey);
      }
      for (const scope of scopes) {
        if (scope.shard.key() === shardKey) {
          this.#settled.set(scopeKey(scope), shardSettlement(scope, shardEvidence));
        }
      }
    }
    return rejected;
  }

  #parkPending(rejected: ReadonlySet<string>): void {
    for (const [key, scope] of this.#pending) {
      if (rejected.has(scope.shard.key())) {
        this.#pending.delete(key);
      }
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

/** @internal Canonical tenant, endpoint, and shard identity admitted for one generation. */
export type DeliveryRunScope = DeliveryReady;

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
  for (const { shard } of scopes) {
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
    ...(scope.tenantId === undefined ? {} : { tenantId: scope.tenantId }),
    label: scope.label,
    targetTypeUrl: scope.targetTypeUrl,
    shard: new ShardIndex(scope.shard.index, scope.shard.ofTotal),
  });
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

function cloneProgress(progress: DeliveryLoopProgress): DeliveryLoopProgress {
  return Object.freeze({ ...progress, failures: Object.freeze([...progress.failures]) });
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
    throw new AggregateError(failures, "Delivery run retirement failed.");
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
