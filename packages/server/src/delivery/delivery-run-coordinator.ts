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

/** Serializes finite worker starts for one delivery generation. */
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
  #retirementFailure: RetirementFailure | undefined;
  readonly #onSettlement: ((settlement: DeliveryScopeSettlement) => unknown) | undefined;

  /**
   * Creates a coordinator for configured generation scopes.
   *
   * @param options The scopes, worker seam, and optional settlement observer.
   */
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

  /**
   * Updates this live generation with later registered canonical scopes.
   *
   * @param scopes The canonical scopes to configure.
   */
  configure(scopes: readonly DeliveryRunScope[]): void {
    if (!this.#accepting) {
      throw new Error("Delivery run coordinator admission is closed.");
    }
    this.#configure(scopes);
  }

  /**
   * Returns whether the coordinator has finalized safely for replacement.
   *
   * @returns Whether replacement is safe.
   */
  get replacementSafe(): boolean {
    return this.#finalized;
  }

  /**
   * Returns whether the coordinator has finalized retirement.
   *
   * @returns Whether retirement is complete.
   */
  get retired(): boolean {
    return this.#finalized;
  }

  /**
   * Returns the current generation-local canonical scope count.
   *
   * @returns The configured scope count.
   */
  get configuredScopeCount(): number {
    return this.#configured.size;
  }

  /**
   * Starts the configured scopes and resolves their latest settlement.
   *
   * @param scopes The scopes to admit.
   * @returns The resulting settlement.
   */
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
      return Promise.reject(DeliveryRunValues.error(error));
    }
    const active = this.#ensureActive();
    return active.then(() => this.settlement());
  }

  /**
   * Notifies the coordinator that one configured scope is ready.
   *
   * @param scope The ready scope.
   */
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

  /**
   * Removes quiesced, permanently retired owner state without disturbing siblings.
   *
   * @param ownerKeys The owner keys to remove.
   * @returns A promise that resolves after the selected owner state is removed.
   */
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

  /**
   * Awaits retained work that could still start selected owners without reclaiming evidence.
   *
   * @param ownerKeys The owner keys whose work must settle.
   * @returns A promise that resolves after selected owners cannot start retained work.
   */
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

  /**
   * Returns immutable evidence for configured and pending scopes.
   *
   * @returns The current generation settlement.
   */
  settlement(): DeliveryRunSettlement {
    const scopes: DeliveryScopeSettlement[] = [];
    for (const key of this.#configured.keys()) {
      const settled = this.#settled.get(key);
      if (settled !== undefined) {
        scopes.push(DeliveryRunValues.cloneSettlement(settled));
      }
    }
    return Object.freeze({
      scopes: Object.freeze(scopes),
      pending: Object.freeze(Array.from(this.#pending.values(), DeliveryRunValues.cloneScope)),
    });
  }

  /**
   * Closes this coordinator after reporting its terminal settlement.
   *
   * @param onReport The terminal settlement reporter.
   * @returns A promise that settles after retirement and terminal reporting complete.
   */
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

  /**
   * Returns causes only from this coordinator's exact current retirement failure.
   *
   * @param reason The observed retirement reason.
   * @returns The matching causes, when present.
   */
  takeRetirementFailureCauses(reason: unknown): readonly unknown[] | undefined {
    const failure = this.#retirementFailure;
    if (failure === undefined || !Object.is(failure.reason, reason)) {
      return undefined;
    }
    this.#retirementFailure = undefined;
    return failure.causes;
  }

  #admit(scopes: readonly DeliveryRunScope[]): void {
    const admitted = scopes.map((candidate) => {
      const configured = this.#configured.get(DeliveryRunValues.scopeKey(candidate));
      if (configured === undefined) {
        throw new Error("Delivery run scope is not configured.");
      }
      return configured;
    });
    for (const configured of admitted) {
      this.#pending.set(DeliveryRunValues.scopeKey(configured), configured);
    }
  }

  #configure(scopes: readonly DeliveryRunScope[]): void {
    for (const candidate of scopes) {
      const scope = DeliveryRunValues.cloneScope(candidate);
      this.#configured.set(DeliveryRunValues.scopeKey(scope), scope);
    }
  }

  #ensureActive(admissionLimit = 2): Promise<void> {
    if (this.#active !== undefined) {
      return this.#active;
    }
    const gate = Promise.withResolvers<undefined>();
    let admissions = 0;
    const draining = gate.promise.catch((cause: unknown) => {
      const fault = DeliveryRunValues.error(cause);
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
    const obligation = DeliveryRunValues.obligation(scopes);
    let shards = DeliveryRunValues.shards(scopes);
    while (shards.length > 0) {
      let evidence: DeliveryWorkerEvidence;
      const started = this.#worker.start(obligation, shards);
      try {
        evidence = await started;
      } catch (cause) {
        this.#recordStartFailure(scopes, shards, cause);
        return;
      }
      DeliveryRunValues.validateEvidence(obligation, shards, evidence);
      const rejected = this.#recordEvidence(scopes, evidence);
      this.#parkPending(rejected);
      if (!this.#accepting) {
        return;
      }
      shards = DeliveryRunValues.pausedShards(evidence);
    }
  }

  #recordStartFailure(
    scopes: readonly DeliveryRunScope[],
    shards: readonly ShardIndex[],
    cause: unknown,
  ): void {
    const owner = DeliveryRunValues.requiredOwner(scopes);
    const attempted = new Set(shards.map((shard) => shard.key()));
    for (const scope of scopes) {
      if (attempted.has(scope.ready.shard.key())) {
        this.#recordSettlement(scope, DeliveryRunValues.rejectedSettlement(scope, cause));
      }
    }
    this.#parkPending(
      new Set(Array.from(attempted, (key) => DeliveryRunValues.ownerShardKey(owner, key))),
    );
  }

  #recordEvidence(
    scopes: readonly DeliveryRunScope[],
    evidence: DeliveryWorkerEvidence,
  ): ReadonlySet<string> {
    const owner = DeliveryRunValues.requiredOwner(scopes);
    const rejected = new Set<string>();
    for (const shardEvidence of evidence.shards) {
      const shardKey = shardEvidence.shard.key();
      if (shardEvidence.status === "rejected") {
        rejected.add(DeliveryRunValues.ownerShardKey(owner, shardKey));
      }
      for (const scope of scopes) {
        if (scope.ready.shard.key() === shardKey) {
          this.#recordSettlement(scope, DeliveryRunValues.shardSettlement(scope, shardEvidence));
        }
      }
    }
    return rejected;
  }

  #parkPending(rejected: ReadonlySet<string>): void {
    for (const [key, scope] of this.#pending) {
      if (rejected.has(DeliveryRunValues.ownerShardKey(scope.owner, scope.ready.shard.key()))) {
        this.#pending.delete(key);
      }
    }
  }

  #recordSettlement(scope: DeliveryRunScope, settlement: DeliveryScopeSettlement): void {
    const key = DeliveryRunValues.scopeKey(scope);
    const previous = this.#settled.get(key);
    this.#settled.set(key, settlement);
    if (previous !== undefined && DeliveryRunValues.sameSettlement(previous, settlement)) {
      return;
    }
    const observed = this.#onSettlement?.(DeliveryRunValues.cloneSettlement(settlement));
    if (DeliveryRunValues.isPromiseLike(observed)) {
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
    const failure = DeliveryRunValues.retirementFailure(failures);
    if (failure !== undefined) {
      this.#retirementFailure = failure;
      throw failure.reason;
    }
  }
}

interface RetirementFailure {
  readonly reason: unknown;
  readonly causes: readonly unknown[];
}

/** Identifies one generation-local runtime owner. */
export interface DeliveryRunOwner {
  /** Holds the stable owner key. */
  readonly key: string;
}

/** Describes owner-qualified readiness admitted for one generation. */
export interface DeliveryRunScope {
  /** Identifies the scope owner. */
  readonly owner: DeliveryRunOwner;
  /** Holds the canonical readiness facts. */
  readonly ready: DeliveryReady;
}

/** Describes a finite worker obligation for one canonical scope union. */
export interface DeliveryRunObligation extends DeliveryWorkerObligation {
  /** Lists the admitted canonical scopes. */
  readonly scopes: readonly DeliveryRunScope[];
}

/** Defines the generation worker seam used by the bounded run coordinator. */
export interface DeliveryRunWorker {
  /**
   * Starts the requested shards for one obligation.
   *
   * @param obligation The generation obligation.
   * @param shards The shards to start.
   * @returns The worker evidence.
   */
  start(
    obligation: DeliveryRunObligation,
    shards: readonly ShardIndex[],
  ): Promise<DeliveryWorkerEvidence>;
  /** Stops loop admission irreversibly. */
  stop(): void;
  /** Awaits active work without interrupting it.
   * @returns A promise that resolves after active work settles.
   */
  awaitSettled(): Promise<void>;
  /**
   * Closes after a completed stop and proven settlement. Permanently closes every
   * worker start entry before settling, even when inert-resource cleanup fails.
   * @returns A promise that settles after the worker retires.
   */
  retire(): Promise<void>;
}

/** Describes the latest bounded disposition for one configured canonical scope. */
export interface DeliveryScopeSettlement {
  /** Holds the configured scope. */
  readonly scope: DeliveryRunScope;
  /** Names the latest scope disposition. */
  readonly disposition: "IDLE" | "PARKED" | "REJECTED" | "STOPPED";
  /** Holds the rejection cause, when present. */
  readonly cause?: unknown;
  /** Holds the last safe loop progress, when present. */
  readonly progress?: DeliveryLoopProgress;
}

/** Describes bounded generation evidence retained by the coordinator. */
export interface DeliveryRunSettlement {
  /** Lists settled configured scopes. */
  readonly scopes: readonly DeliveryScopeSettlement[];
  /** Lists scopes still pending admission. */
  readonly pending: readonly DeliveryRunScope[];
}

/** Reports retirement that failed before quiescence. */
export class DeliveryRunQuiescenceError extends Error {
  /** Holds the failure that prevented quiescence. */
  override readonly cause: unknown;

  /**
   * Creates a quiescence error.
   *
   * @param cause The failure that prevented quiescence.
   */
  constructor(cause: unknown) {
    super("Delivery run coordinator could not establish quiescence.");
    this.name = "DeliveryRunQuiescenceError";
    this.cause = cause;
  }
}

/** Adapts workers for package-owned delivery generations. */
export interface DeliveryRunWorkers {
  /**
   * Creates a generation coordinator seam for one worker.
   *
   * @param worker The worker to adapt.
   * @returns The generation worker seam.
   */
  worker(worker: DeliveryWorker): DeliveryRunWorker;
}

/** Adapts workers for package-owned delivery generations. */
export const deliveryRunWorkers: DeliveryRunWorkers = Object.freeze({
  /** Adapts one worker to the generation coordinator seam. */
  worker(worker: DeliveryWorker): DeliveryRunWorker {
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
  },
});

/** Groups internal coordinator snapshot, settlement, and validation operations. */
const DeliveryRunValues = Object.freeze({
  obligation(scopes: readonly DeliveryRunScope[]): DeliveryRunObligation {
    return Object.freeze({
      scopes: Object.freeze(scopes.map((scope) => DeliveryRunValues.cloneScope(scope))),
    });
  },
  shards(scopes: readonly DeliveryRunScope[]): readonly ShardIndex[] {
    const shards = new Map<string, ShardIndex>();
    for (const { shard } of scopes.map(({ ready }) => ready))
      shards.set(shard.key(), new ShardIndex(shard.index, shard.ofTotal));
    return Object.freeze(Array.from(shards.values()));
  },
  pausedShards(evidence: DeliveryWorkerEvidence): readonly ShardIndex[] {
    return Object.freeze(
      evidence.shards.flatMap((result) =>
        result.status === "fulfilled" && result.run.status === "PAUSED"
          ? [new ShardIndex(result.shard.index, result.shard.ofTotal)]
          : [],
      ),
    );
  },
  validateEvidence(
    obligation: DeliveryRunObligation,
    requested: readonly ShardIndex[],
    evidence: DeliveryWorkerEvidence,
  ): void {
    if (evidence.obligation !== obligation)
      throw new Error("Delivery worker evidence obligation does not match the current obligation.");
    const requestedKeys = new Set(requested.map((shard) => shard.key()));
    const seen = new Set<string>();
    for (const shard of evidence.shards) {
      if (shard.obligation !== obligation)
        throw new Error("Delivery worker shard obligation does not match the current obligation.");
      const key = shard.shard.key();
      if (!requestedKeys.has(key) || seen.has(key))
        throw new Error("Delivery worker evidence does not match the requested shard domain.");
      seen.add(key);
    }
    if (seen.size !== requestedKeys.size)
      throw new Error("Delivery worker evidence does not match the requested shard domain.");
  },
  shardSettlement(
    scope: DeliveryRunScope,
    evidence: DeliveryShardEvidence,
  ): DeliveryScopeSettlement {
    if (evidence.status === "rejected")
      return this.rejectedSettlement(scope, evidence.cause, evidence.progress);
    return Object.freeze({
      scope,
      disposition: this.disposition(evidence.run.status),
      progress: this.cloneProgress(evidence.progress),
    });
  },
  rejectedSettlement(
    scope: DeliveryRunScope,
    cause: unknown,
    progress?: DeliveryLoopProgress,
  ): DeliveryScopeSettlement {
    return Object.freeze({
      scope,
      disposition: "REJECTED",
      cause,
      progress: this.cloneProgress(progress ?? this.emptyProgress()),
    });
  },
  disposition(status: DeliveryLoopStatus): DeliveryScopeSettlement["disposition"] {
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
  },
  cloneSettlement(settlement: DeliveryScopeSettlement): DeliveryScopeSettlement {
    return Object.freeze({
      scope: this.cloneScope(settlement.scope),
      disposition: settlement.disposition,
      ...(settlement.cause === undefined ? {} : { cause: settlement.cause }),
      ...(settlement.progress === undefined
        ? {}
        : { progress: this.cloneProgress(settlement.progress) }),
    });
  },
  cloneScope(scope: DeliveryRunScope): DeliveryRunScope {
    return Object.freeze({
      owner: Object.freeze({ key: scope.owner.key }),
      ready: Object.freeze({
        ...(scope.ready.tenantId === undefined ? {} : { tenantId: scope.ready.tenantId }),
        label: scope.ready.label,
        targetTypeUrl: scope.ready.targetTypeUrl,
        shard: new ShardIndex(scope.ready.shard.index, scope.ready.shard.ofTotal),
      }),
    });
  },
  scopeKey(scope: DeliveryRunScope): string {
    return JSON.stringify([
      scope.owner.key,
      scope.ready.tenantId ?? null,
      scope.ready.label,
      scope.ready.targetTypeUrl,
      scope.ready.shard.index,
      scope.ready.shard.ofTotal,
    ]);
  },
  ownerShardKey(owner: DeliveryRunOwner, shardKey: string): string {
    return JSON.stringify([owner.key, shardKey]);
  },
  requiredOwner(scopes: readonly DeliveryRunScope[]): DeliveryRunOwner {
    const owner = scopes[0]?.owner;
    if (owner === undefined) throw new Error("Delivery run admission requires at least one scope.");
    return owner;
  },
  cloneProgress(progress: DeliveryLoopProgress): DeliveryLoopProgress {
    return Object.freeze({ ...progress, failures: Object.freeze([...progress.failures]) });
  },
  sameSettlement(previous: DeliveryScopeSettlement, next: DeliveryScopeSettlement): boolean {
    return (
      previous.disposition === next.disposition &&
      Object.is(previous.cause, next.cause) &&
      this.sameProgress(previous.progress, next.progress)
    );
  },
  sameProgress(
    previous: DeliveryLoopProgress | undefined,
    next: DeliveryLoopProgress | undefined,
  ): boolean {
    if (previous === undefined || next === undefined) return previous === next;
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
  },
  emptyProgress(): DeliveryLoopProgress {
    return Object.freeze({
      runs: 0,
      processed: 0,
      accepted: 0,
      delivered: 0,
      failed: 0,
      failures: Object.freeze([]),
    });
  },
  retirementFailure(failures: readonly unknown[]): RetirementFailure | undefined {
    if (failures.length === 0) return undefined;
    const causes = Object.freeze([...failures]);
    return Object.freeze({
      reason:
        causes.length === 1
          ? causes[0]
          : new AggregateError(causes, "Delivery run retirement failed."),
      causes,
    });
  },
  error(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
  },
  isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return (
      ((typeof value === "object" && value !== null) || typeof value === "function") &&
      typeof (value as { readonly then?: unknown }).then === "function"
    );
  },
});
