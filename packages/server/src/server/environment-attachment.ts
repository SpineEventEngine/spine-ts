import type { StorageContext, StorageFactory } from "@spine-ts/storage";

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
import { EnvironmentDeliveryRecords } from "./environment-delivery-records.js";

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

class AttachedEnvironmentRegistration implements EnvironmentRegistrationClaim {
  readonly startup: DeliveryRunSettlement;
  readonly token: string;
  readonly #binding: RegistrationBinding;
  readonly #records: () => readonly ParkedDeliveryObligationRecord[];

  constructor(
    claim: EnvironmentRegistrationClaim,
    binding: RegistrationBinding,
    startup: DeliveryRunSettlement,
    records: () => readonly ParkedDeliveryObligationRecord[],
  ) {
    this.token = claim.token;
    this.#binding = binding;
    this.startup = startup;
    this.#records = records;
    Object.freeze(this);
  }

  get generation(): EnvironmentGeneration {
    return this.#binding.generation;
  }

  records(): readonly ParkedDeliveryObligationRecord[] {
    return this.#records();
  }
}

/** @internal Nominal successful attachment used by later detach/stop/server slices. */
export type EnvironmentAttachmentHandle = AttachedEnvironmentRegistration;

/** @internal Construction seams for deterministic package lifecycle tests. */
export interface EnvironmentAttachmentsOptions {
  readonly createWorker?: () => EnvironmentGenerationWorker;
  readonly report?: (causes: readonly unknown[]) => Promise<void>;
  readonly transitionFaults?: {
    readonly onRoutePrepare?: (descriptor: ContextDeliveryDescriptor) => void;
    readonly onScopeTransfer?: (
      descriptor: ContextDeliveryDescriptor,
      sources: readonly TransitionScopeSource[],
    ) => void;
  };
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

  get generation(): EnvironmentGeneration | undefined {
    return this.#generation;
  }

  replace(generation: EnvironmentGeneration): EnvironmentGeneration {
    if (this.#generation === undefined) {
      throw new Error("Environment generation is not current.");
    }
    const previous = this.#generation;
    this.#generation = generation;
    return previous;
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
  readonly #transitionFaults: EnvironmentAttachmentsOptions["transitionFaults"];
  readonly #handles = new WeakMap<EnvironmentAttachmentHandle, AttachedHandle>();
  readonly #attached = new Map<string, AttachedHandle>();
  readonly #nonLastDetachTokens = new Set<string>();
  #serial = Promise.resolve();
  #failedRollback: FailedStartRollback | undefined;
  #failedLastDetach: AttachedHandle | undefined;
  #stop: GenerationStop | undefined;

  constructor(options: EnvironmentAttachmentsOptions = {}) {
    this.#createWorker = options.createWorker ?? (() => new EnvironmentDeliveryWorker());
    this.#report = options.report ?? (() => Promise.resolve());
    this.#transitionFaults = options.transitionFaults;
  }

  /** @internal Bounded diagnostic cardinality for focused lifecycle verification. */
  get unresolvedReportedDomainCount(): number {
    let count = 0;
    for (const generation of this.#generations.values()) {
      count += generation.unresolvedReportedDomainCount;
    }
    return count;
  }

  /** @internal Exact live registration cardinality for lifecycle invariants. */
  get activeRegistrationCount(): number {
    return this.#registrations.count;
  }

  /** @internal Current configured ephemeral owner cardinality across the live generation. */
  get configuredOwnerCount(): number {
    let count = 0;
    for (const generation of this.#generations.values()) {
      count += generation.configuredOwnerCount;
    }
    return count;
  }

  /** @internal Current generation-local canonical scope cardinality. */
  get configuredScopeCount(): number {
    let count = 0;
    for (const generation of this.#generations.values()) {
      count += generation.configuredScopeCount;
    }
    return count;
  }

  attach(options: EnvironmentAttachOptions): Promise<EnvironmentAttachmentHandle> {
    const gate = Promise.withResolvers<EnvironmentAttachmentHandle>();
    const snapshotDescriptors = this.#stop === undefined;
    const waiter: AttachmentWaiter = {
      options: Object.freeze({
        ownership: options.ownership,
        descriptors: snapshotDescriptors
          ? Object.freeze([...options.descriptors])
          : options.descriptors,
      }),
      gate,
      snapshotDescriptors,
      status: "queued",
    };
    this.#queueAttachment(waiter);
    return gate.promise;
  }

  #queueAttachment(waiter: AttachmentWaiter): void {
    waiter.status = "queued";
    const attaching = this.#serial.then(async () => {
      const stop = this.#stop;
      if (stop?.admitted === true && !stop.completed) {
        waiter.status = "waiting";
        stop.waiters.push(waiter);
        return;
      }
      const admittedOptions: EnvironmentAttachOptions = Object.freeze({
        ownership: waiter.options.ownership,
        descriptors: waiter.snapshotDescriptors
          ? waiter.options.descriptors
          : Object.freeze([...waiter.options.descriptors]),
      });
      const attachment = await this.#startQueuedAttachment(admittedOptions);
      waiter.status = "complete";
      waiter.gate.resolve(attachment);
    });
    this.#serial = attaching.then(
      () => undefined,
      () => undefined,
    );
    void attaching.catch((error: unknown) => {
      waiter.status = "complete";
      waiter.gate.reject(error);
    });
  }

  #releaseStopWaiters(stop: GenerationStop): void {
    if (stop.waitersReleased) return;
    stop.waitersReleased = true;
    for (const waiter of stop.waiters) {
      if (waiter.status === "waiting") {
        this.#queueAttachment(waiter);
      }
    }
    stop.waiters.length = 0;
  }

  async #startQueuedAttachment(
    options: EnvironmentAttachOptions,
  ): Promise<EnvironmentAttachmentHandle> {
    if (this.#failedRollback !== undefined) {
      throw explicitRetryError();
    }
    if (this.#failedLastDetach !== undefined) {
      throw detachRetryRequiredError();
    }
    const claim = this.#registrations.claim(options.ownership);
    let generation = this.#generations.get(claim.generation);
    if (generation === undefined) {
      try {
        generation = new DeliveryGeneration(this.#createWorker(), this.#report);
      } catch (error) {
        if (this.#registrations.remove(claim.token) === 0) {
          this.#registrations.clear(claim.generation);
        }
        throw error;
      }
      this.#generations.set(claim.generation, generation);
    }
    const binding: RegistrationBinding = { generation: claim.generation };
    const attachment = await this.#attachRegistration(
      generation,
      claim,
      options.descriptors,
      binding,
    );
    this.#handles.set(attachment, {
      claim,
      generation,
      binding,
      descriptors: options.descriptors,
      operation: undefined,
      claimRemoved: false,
      detachKind: undefined,
      generationCleared: false,
    });
    this.#attached.set(claim.token, this.#handles.get(attachment)!);
    return attachment;
  }

  stopDelivery(): Promise<void> {
    const current = this.#stop;
    if (current !== undefined) {
      if (current.status === "rejected") {
        return Promise.reject(deliveryStopRetryRequiredError());
      }
      return current.promise;
    }
    const stop: GenerationStop = {
      admitted: false,
      generation: undefined,
      old: undefined,
      survivors: undefined,
      routes: undefined,
      oldRetired: false,
      oldRetirement: { status: "pending" },
      candidateGeneration: undefined,
      candidate: undefined,
      routeUnits: undefined,
      routeSnapshots: undefined,
      routePrepared: 0,
      scopes: new TransitionScopes(),
      published: false,
      reopened: undefined,
      drained: false,
      waiters: [],
      waitersReleased: false,
      completed: false,
      promise: Promise.resolve(),
      status: "running",
      retrying: false,
    };
    this.#stop = stop;
    return this.#queueStop(stop, false);
  }

  #queueStop(stop: GenerationStop, retrying: boolean): Promise<void> {
    stop.status = "running";
    stop.retrying = retrying;
    const gate = Promise.withResolvers<void>();
    stop.promise = gate.promise;
    const admission = this.#serial.then(() => {
      void this.#continueStop(stop).then(gate.resolve, gate.reject);
    });
    this.#serial = admission.then(
      () => undefined,
      () => undefined,
    );
    void admission.catch(gate.reject);
    void stop.promise.then(
      () => {
        stop.status = "complete";
        if (this.#stop === stop) {
          this.#stop = undefined;
        }
      },
      () => {
        if (stop.completed) {
          stop.status = "complete";
          if (this.#stop === stop) {
            this.#stop = undefined;
          }
        } else {
          stop.status = "rejected";
        }
      },
    );
    return stop.promise;
  }

  retryDeliveryStop(): Promise<void> {
    const stop = this.#stop;
    if (stop?.status === "running" && stop.retrying) {
      return stop.promise;
    }
    if (stop === undefined || stop.status !== "rejected") {
      return Promise.reject(new Error("Environment has no failed delivery stop to retry."));
    }
    return this.#queueStop(stop, true);
  }

  async #continueStop(stop: GenerationStop): Promise<void> {
    if (!stop.admitted) {
      if (this.#failedRollback !== undefined) {
        this.#refuseStop(stop, explicitRetryError());
      }
      if (this.#failedLastDetach !== undefined) {
        this.#refuseStop(stop, detachRetryRequiredError());
      }
      if (this.#failedNonLastDetachOwnsRegistration()) {
        this.#refuseStop(stop, detachRetryRequiredError());
      }
      const generation = this.#registrations.generation;
      if (generation === undefined) {
        return;
      }
      const old = this.#generations.get(generation);
      if (old === undefined) {
        this.#refuseStop(stop, new Error("Environment generation is not current."));
      }
      stop.generation = generation;
      stop.old = old;
      stop.survivors = Object.freeze([...this.#attached.values()]);
      stop.admitted = true;
    }
    const old = stop.old!;
    const survivors = stop.survivors!;
    if (stop.routes === undefined) {
      stop.routes = Object.freeze(
        survivors.map((survivor) =>
          old.closeRegistration(survivor.claim.token, (descriptor, ready) => {
            stop.scopes.buffer(survivor.claim.token, descriptor, ready);
          }),
        ),
      );
      old.captureTransition(stop.scopes);
    }
    if (!stop.oldRetired) {
      const retirement = await old.retire();
      if (retirement.status === "failed") {
        if (!old.replacementSafe) {
          throw retirement.reason;
        }
        stop.oldRetirement = {
          status: "retained",
          reason: retirement.reason,
          causes: retirement.causes,
        };
      }
      stop.oldRetired = true;
    }
    try {
      stop.routeUnits ??= Object.freeze(
        survivors.flatMap((survivor, registration) =>
          survivor.descriptors.map((descriptor) => ({
            survivor,
            descriptor,
            readiness: stop.routes![registration]!,
          })),
        ),
      );
      if (stop.routeSnapshots === undefined) {
        const snapshots: DeliveryDescriptorSnapshot[] = [];
        for (const route of stop.routeUnits) {
          snapshots.push(await snapshotDescriptor(route.descriptor));
        }
        stop.routeSnapshots = Object.freeze(snapshots);
      }
      if (stop.candidate === undefined) {
        const candidate = new DeliveryGeneration(this.#createWorker(), this.#report);
        stop.candidateGeneration = Object.freeze({ generation: true });
        stop.candidate = candidate;
      }
      const candidate = stop.candidate;
      const candidateGeneration = stop.candidateGeneration!;
      while (stop.routePrepared < stop.routeUnits.length) {
        const route = stop.routeUnits[stop.routePrepared]!;
        const snapshot = stop.routeSnapshots[stop.routePrepared]!;
        this.#transitionFaults?.onRoutePrepare?.(route.descriptor);
        const scopes = await candidate.prepareTransferredRoute(
          Object.freeze({ token: route.survivor.claim.token, generation: candidateGeneration }),
          snapshot,
          route.readiness,
        );
        stop.scopes.capture(route.survivor.claim.token, route.descriptor, scopes, "startup");
        stop.routePrepared += 1;
      }
      let transfer = stop.scopes.nextPending();
      while (transfer !== undefined) {
        const version = stop.scopes.begin(transfer);
        const settling = candidate.recoverTransferred(
          transfer.token,
          transfer.descriptor,
          transfer.ready,
        );
        let fault: FailurePresence = { status: "none" };
        try {
          this.#transitionFaults?.onScopeTransfer?.(
            transfer.descriptor,
            stop.scopes.sources(transfer),
          );
        } catch (error) {
          fault = { status: "retained", reason: error };
        }
        const failures: unknown[] = [];
        try {
          await settling;
        } catch (error) {
          failures.push(error);
        }
        if (fault.status === "retained") {
          failures.push(fault.reason);
        }
        if (failures.length > 0) {
          stop.scopes.reject(transfer);
          throwCurrentAggregation(failures);
        }
        stop.scopes.complete(transfer, version);
        transfer = stop.scopes.nextPending();
      }
      if (!stop.published) {
        this.#generations.delete(stop.generation!);
        this.#generations.set(candidateGeneration, candidate);
        this.#registrations.replace(candidateGeneration);
        for (const survivor of survivors) {
          survivor.generation = candidate;
          survivor.binding.generation = candidateGeneration;
        }
        stop.published = true;
      }
      if (stop.reopened === undefined) {
        const reopened: DeliveryRunScope[] = [];
        for (const survivor of survivors) {
          reopened.push(...candidate.openRegistration(survivor.claim.token));
        }
        stop.reopened = Object.freeze(reopened);
      }
      if (!stop.drained) {
        await candidate.recoverReopened(stop.reopened);
        stop.drained = true;
      }
    } catch (error) {
      const failures = [...this.#takeOldRetirementCauses(stop), ...currentAggregationCauses(error)];
      throwFailures(failures, "Environment delivery stop transition failed.");
    }
    stop.completed = true;
    this.#releaseStopWaiters(stop);
    if (stop.oldRetirement.status === "retained") {
      const { reason } = stop.oldRetirement;
      stop.oldRetirement = { status: "emitted" };
      throw reason;
    }
  }

  #takeOldRetirementCauses(stop: GenerationStop): readonly unknown[] {
    if (stop.oldRetirement.status !== "retained") {
      return Object.freeze([]);
    }
    const { causes } = stop.oldRetirement;
    stop.oldRetirement = { status: "emitted" };
    return causes;
  }

  #refuseStop(stop: GenerationStop, error: Error): never {
    if (this.#stop === stop) {
      this.#stop = undefined;
    }
    throw error;
  }

  detach(attachment: EnvironmentAttachmentHandle): Promise<void> {
    const attached = this.#handles.get(attachment);
    if (attached === undefined) {
      return Promise.reject(
        new Error("Environment attachment handle is not owned by this environment."),
      );
    }
    if (attached.operation !== undefined) {
      return attached.operation.promise;
    }
    if (this.#rejectedStopOwns(attached)) {
      return Promise.reject(deliveryStopRetryRequiredError());
    }
    if (this.#failedRollback !== undefined) {
      return Promise.reject(explicitRetryError());
    }
    return this.#queueDetach(attached);
  }

  retryDetach(attachment: EnvironmentAttachmentHandle): Promise<void> {
    const attached = this.#handles.get(attachment);
    if (attached === undefined) {
      return Promise.reject(
        new Error("Environment attachment handle is not owned by this environment."),
      );
    }
    if (this.#rejectedStopOwns(attached)) {
      return Promise.reject(deliveryStopRetryRequiredError());
    }
    const operation = attached.operation;
    if (operation === undefined) {
      return Promise.reject(new Error("Environment attachment has no failed detach to retry."));
    }
    if (operation.status === "running") {
      return Promise.reject(new Error("Environment attachment detach has not rejected."));
    }
    if (
      operation.status === "complete" ||
      !attached.generation.hasRegistration(attached.claim.token)
    ) {
      operation.status = "complete";
      return Promise.resolve();
    }
    if (this.#failedRollback !== undefined) {
      return Promise.reject(explicitRetryError());
    }
    return this.#queueDetach(attached, operation);
  }

  #queueDetach(attached: AttachedHandle, previousOperation?: DetachHandleOperation): Promise<void> {
    const detaching = this.#serial.then(() => {
      if (this.#incompleteStopOwns(attached)) {
        throw deliveryStopRetryRequiredError();
      }
      if (this.#failedRollback !== undefined) {
        attached.operation = previousOperation;
        throw explicitRetryError();
      }
      return this.#detachRegistration(attached);
    });
    const operation: DetachHandleOperation = { promise: detaching, status: "running" };
    attached.operation = operation;
    this.#serial = detaching.then(
      () => undefined,
      () => undefined,
    );
    void detaching.then(
      () => {
        operation.status = "complete";
      },
      () => {
        operation.status = "rejected";
      },
    );
    return detaching;
  }

  #failedNonLastDetachOwnsRegistration(): boolean {
    for (const attached of this.#attached.values()) {
      if (
        attached.detachKind === "non-last" &&
        attached.operation?.status !== "complete" &&
        attached.generation.hasRegistration(attached.claim.token)
      ) {
        return true;
      }
    }
    return false;
  }

  #rejectedStopOwns(attached: AttachedHandle): boolean {
    const stop = this.#stop;
    return (
      stop?.status === "rejected" && stop.admitted && stop.survivors?.includes(attached) === true
    );
  }

  #incompleteStopOwns(attached: AttachedHandle): boolean {
    const stop = this.#stop;
    return stop?.admitted === true && !stop.drained && stop.survivors?.includes(attached) === true;
  }

  async #detachRegistration(attached: AttachedHandle): Promise<void> {
    if (attached.detachKind === undefined) {
      const liveRegistrations = this.#registrations.count - this.#nonLastDetachTokens.size;
      if (this.#registrations.count === 1) {
        attached.detachKind = "last";
      } else if (liveRegistrations <= 1) {
        throw new Error("Environment attachment cannot detach the reserved live registration.");
      } else {
        attached.detachKind = "non-last";
        this.#nonLastDetachTokens.add(attached.claim.token);
      }
    }
    if (attached.detachKind === "last") {
      try {
        await attached.generation.retireRegistration(attached.claim.token);
      } catch (error) {
        if (!attached.generation.replacementSafe) {
          this.#failedLastDetach = attached;
        }
        throw error;
      } finally {
        if (attached.generation.replacementSafe) {
          this.#clearRetiredGeneration(attached);
        }
      }
      return;
    }
    try {
      await attached.generation.detachRegistration(attached.claim.token);
    } finally {
      if (!attached.generation.hasRegistration(attached.claim.token) && !attached.claimRemoved) {
        this.#registrations.remove(attached.claim.token);
        this.#attached.delete(attached.claim.token);
        this.#nonLastDetachTokens.delete(attached.claim.token);
        attached.claimRemoved = true;
      }
    }
  }

  #clearRetiredGeneration(attached: AttachedHandle): void {
    if (!attached.claimRemoved) {
      this.#registrations.remove(attached.claim.token);
      attached.claimRemoved = true;
    }
    if (!attached.generationCleared) {
      this.#generations.delete(attached.binding.generation);
      this.#registrations.clear(attached.binding.generation);
      this.#attached.delete(attached.claim.token);
      attached.generationCleared = true;
    }
    if (this.#failedLastDetach === attached) {
      this.#failedLastDetach = undefined;
    }
  }

  retryFailedStart(): Promise<void> {
    const rollback = this.#failedRollback;
    if (rollback === undefined) {
      return Promise.reject(new Error("Environment has no failed-start rollback to retry."));
    }
    if (rollback.retry !== undefined) {
      return rollback.retry;
    }
    const retry = this.#serial.then(() => {
      if (this.#registrations.count === 0) {
        rollback.mode = "generation";
      }
      return this.#continueRollback(rollback);
    });
    rollback.retry = retry;
    this.#serial = retry.then(
      () => undefined,
      () => undefined,
    );
    void retry.catch(() => {
      if (this.#failedRollback === rollback) {
        rollback.retry = undefined;
      }
    });
    return retry;
  }

  async #attachRegistration(
    generation: DeliveryGeneration,
    claim: EnvironmentRegistrationClaim,
    descriptors: readonly ContextDeliveryDescriptor[],
    binding: RegistrationBinding,
  ): Promise<EnvironmentAttachmentHandle> {
    try {
      return await generation.attach(claim, descriptors, false, binding);
    } catch (startError) {
      const remaining = this.#registrations.remove(claim.token);
      const rollback: FailedStartRollback = {
        claim,
        generation,
        mode: remaining === 0 ? "generation" : "registration",
        inFlight: undefined,
        retry: undefined,
      };
      this.#failedRollback = rollback;
      try {
        await this.#continueRollback(rollback);
      } catch (rollbackError) {
        throw failedStartError(startError, rollbackError);
      }
      throw startError;
    }
  }

  #continueRollback(rollback: FailedStartRollback): Promise<undefined> {
    if (rollback.inFlight !== undefined) {
      return rollback.inFlight;
    }
    const gate = Promise.withResolvers<undefined>();
    rollback.inFlight = gate.promise;
    void this.#performRollback(rollback).then(
      () => {
        this.#completeRollback(rollback);
        gate.resolve(undefined);
      },
      (error: unknown) => {
        if (this.#rollbackSafe(rollback)) {
          this.#completeRollback(rollback);
        } else {
          rollback.inFlight = undefined;
        }
        gate.reject(error);
      },
    );
    return gate.promise;
  }

  async #performRollback(rollback: FailedStartRollback): Promise<void> {
    if (rollback.mode === "generation") {
      await rollback.generation.retireFailedRegistration(rollback.claim.token);
    } else {
      await rollback.generation.rollbackRegistration(rollback.claim.token);
    }
  }

  #rollbackSafe(rollback: FailedStartRollback): boolean {
    return rollback.mode === "generation"
      ? rollback.generation.replacementSafe
      : !rollback.generation.hasRegistration(rollback.claim.token);
  }

  #completeRollback(rollback: FailedStartRollback): void {
    if (rollback.mode === "generation") {
      this.#generations.delete(rollback.claim.generation);
      this.#registrations.clear(rollback.claim.generation);
    }
    this.#failedRollback = undefined;
  }
}

interface FailedStartRollback {
  readonly claim: EnvironmentRegistrationClaim;
  readonly generation: DeliveryGeneration;
  mode: "registration" | "generation";
  inFlight: Promise<undefined> | undefined;
  retry: Promise<undefined> | undefined;
}

interface AttachedHandle {
  readonly claim: EnvironmentRegistrationClaim;
  generation: DeliveryGeneration;
  readonly binding: RegistrationBinding;
  readonly descriptors: readonly ContextDeliveryDescriptor[];
  operation: DetachHandleOperation | undefined;
  claimRemoved: boolean;
  detachKind: "non-last" | "last" | undefined;
  generationCleared: boolean;
}

interface RegistrationBinding {
  generation: EnvironmentGeneration;
}

interface AttachmentWaiter {
  readonly options: EnvironmentAttachOptions;
  readonly gate: PromiseWithResolvers<EnvironmentAttachmentHandle>;
  readonly snapshotDescriptors: boolean;
  status: "queued" | "waiting" | "complete";
}

interface GenerationStop {
  admitted: boolean;
  generation: EnvironmentGeneration | undefined;
  old: DeliveryGeneration | undefined;
  survivors: readonly AttachedHandle[] | undefined;
  routes: readonly RegistrationReadiness[] | undefined;
  oldRetired: boolean;
  oldRetirement: OldRetirementResult;
  candidateGeneration: EnvironmentGeneration | undefined;
  candidate: DeliveryGeneration | undefined;
  routeUnits: readonly StopRoute[] | undefined;
  routeSnapshots: readonly DeliveryDescriptorSnapshot[] | undefined;
  routePrepared: number;
  readonly scopes: TransitionScopes;
  published: boolean;
  reopened: readonly DeliveryRunScope[] | undefined;
  drained: boolean;
  readonly waiters: AttachmentWaiter[];
  waitersReleased: boolean;
  completed: boolean;
  promise: Promise<void>;
  status: "running" | "rejected" | "complete";
  retrying: boolean;
}

type OldRetirementResult =
  | { readonly status: "pending" }
  | {
      readonly status: "retained";
      readonly reason: unknown;
      readonly causes: readonly unknown[];
    }
  | { readonly status: "emitted" };

type FailurePresence =
  { readonly status: "none" } | { readonly status: "retained"; readonly reason: unknown };

type GenerationRetirementResult =
  | { readonly status: "succeeded" }
  | {
      readonly status: "failed";
      readonly reason: unknown;
      readonly causes: readonly unknown[];
    };

interface StopRoute {
  readonly survivor: AttachedHandle;
  readonly descriptor: ContextDeliveryDescriptor;
  readonly readiness: RegistrationReadiness;
}

type TransitionScopeSource = "configured" | "startup" | "buffered" | "retained";

interface TransitionScopeUnit {
  readonly token: string;
  readonly descriptor: ContextDeliveryDescriptor;
  readonly ready: DeliveryReady;
  readonly provenance: Set<TransitionScopeSource>;
  version: number;
  transferredVersion: number;
  inFlightVersion: number | undefined;
  dirtyDuringFlight: boolean;
  queued: boolean;
  pendingNext: TransitionScopeUnit | undefined;
}

class TransitionScopes {
  readonly #registrations = new Map<
    string,
    Map<ContextDeliveryDescriptor, Map<string, TransitionScopeUnit>>
  >();
  #pendingHead: TransitionScopeUnit | undefined;
  #pendingTail: TransitionScopeUnit | undefined;

  capture(
    token: string,
    descriptor: ContextDeliveryDescriptor,
    scopes: readonly DeliveryRunScope[],
    source: TransitionScopeSource,
  ): void {
    for (const scope of scopes) {
      this.#record(token, descriptor, scope.ready, source, false);
    }
  }

  buffer(token: string, descriptor: ContextDeliveryDescriptor, ready: DeliveryReady): void {
    this.#record(token, descriptor, ready, "buffered", true);
  }

  nextPending(): TransitionScopeUnit | undefined {
    return this.#pendingHead;
  }

  begin(unit: TransitionScopeUnit): number {
    if (
      this.#pendingHead !== unit ||
      !unit.queued ||
      unit.inFlightVersion !== undefined ||
      unit.transferredVersion >= unit.version
    ) {
      throw new Error("Environment transition scope is not pending.");
    }
    this.#pendingHead = unit.pendingNext;
    if (this.#pendingHead === undefined) {
      this.#pendingTail = undefined;
    }
    unit.queued = false;
    unit.pendingNext = undefined;
    unit.inFlightVersion = unit.version;
    unit.dirtyDuringFlight = false;
    return unit.inFlightVersion;
  }

  complete(unit: TransitionScopeUnit, version: number): void {
    if (unit.inFlightVersion !== version) {
      throw new Error("Environment transition scope checkpoint is not current.");
    }
    unit.transferredVersion = version;
    unit.inFlightVersion = undefined;
    unit.dirtyDuringFlight = false;
    if (unit.transferredVersion < unit.version) {
      this.#enqueue(unit);
    }
  }

  reject(unit: TransitionScopeUnit): void {
    unit.inFlightVersion = undefined;
    unit.dirtyDuringFlight = false;
    this.#enqueue(unit, true);
  }

  sources(unit: TransitionScopeUnit): readonly TransitionScopeSource[] {
    return Object.freeze(transitionSourceOrder.filter((source) => unit.provenance.has(source)));
  }

  #record(
    token: string,
    descriptor: ContextDeliveryDescriptor,
    ready: DeliveryReady,
    source: TransitionScopeSource,
    dirty: boolean,
  ): void {
    const descriptors =
      this.#registrations.get(token) ??
      new Map<ContextDeliveryDescriptor, Map<string, TransitionScopeUnit>>();
    const scopes = descriptors.get(descriptor) ?? new Map<string, TransitionScopeUnit>();
    let unit = scopes.get(readyKey(ready));
    if (unit === undefined) {
      unit = {
        token,
        descriptor,
        ready,
        provenance: new Set(),
        version: 1,
        transferredVersion: 0,
        inFlightVersion: undefined,
        dirtyDuringFlight: false,
        queued: false,
        pendingNext: undefined,
      };
      scopes.set(readyKey(ready), unit);
      descriptors.set(descriptor, scopes);
      this.#registrations.set(token, descriptors);
      this.#enqueue(unit);
    } else if (dirty) {
      if (unit.inFlightVersion !== undefined && !unit.dirtyDuringFlight) {
        unit.version += 1;
        unit.dirtyDuringFlight = true;
      } else if (unit.inFlightVersion === undefined && unit.transferredVersion === unit.version) {
        unit.version += 1;
        this.#enqueue(unit);
      }
    }
    unit.provenance.add(source);
  }

  #enqueue(unit: TransitionScopeUnit, first = false): void {
    if (unit.queued) {
      return;
    }
    unit.queued = true;
    if (first) {
      unit.pendingNext = this.#pendingHead;
      this.#pendingHead = unit;
      this.#pendingTail ??= unit;
    } else if (this.#pendingTail === undefined) {
      unit.pendingNext = undefined;
      this.#pendingHead = unit;
      this.#pendingTail = unit;
    } else {
      unit.pendingNext = undefined;
      this.#pendingTail.pendingNext = unit;
      this.#pendingTail = unit;
    }
  }
}

const transitionSourceOrder: readonly TransitionScopeSource[] = Object.freeze([
  "configured",
  "startup",
  "buffered",
  "retained",
]);

interface DetachHandleOperation {
  promise: Promise<void>;
  status: "running" | "rejected" | "complete";
}

interface GenerationRegistration {
  readonly readiness: RegistrationReadiness;
  startupScopes: readonly DeliveryRunScope[];
  readonly ownership: RegistrationOwnership;
  descriptors: readonly ContextDeliveryDescriptor[];
  readonly scopeDescriptors: Map<string, ContextDeliveryDescriptor>;
  rollback?: RegistrationRollback;
  detach?: RegistrationDetach;
}

interface RegistrationRollback {
  stopped: boolean;
  quiescent: boolean;
}

interface RegistrationDetach {
  stopped: boolean;
  quiescent: boolean;
  barrier: boolean;
  recordsConsumed: boolean;
  causes: readonly unknown[];
  reportAttempted: boolean;
  workerRetirementAttempted: boolean;
  coordinatorRemoved: boolean;
}

class RegistrationOwnership {
  readonly #scopes = new Map<string, DeliveryRunScope>();
  readonly #ownerKeys = new Set<string>();

  add(runtime: EnvironmentDeliveryRuntime): void {
    this.#ownerKeys.add(runtime.owner.key);
    for (const scope of runtime.scopes) {
      this.#scopes.set(scopeKey(scope), scope);
    }
  }

  get scopes(): readonly DeliveryRunScope[] {
    return Object.freeze([...this.#scopes.values()]);
  }

  get ownerKeys(): readonly string[] {
    return Object.freeze([...this.#ownerKeys]);
  }
}

class DeliveryGeneration {
  readonly #worker: EnvironmentGenerationWorker;
  readonly #report: (causes: readonly unknown[]) => Promise<void>;
  readonly #descriptors = new WeakSet<ContextDeliveryDescriptor>();
  readonly #runtimes = new WeakMap<
    ContextDeliveryDescriptor,
    Map<string, EnvironmentDeliveryRuntime>
  >();
  readonly #deliveryRecords = new EnvironmentDeliveryRecords();
  readonly #registrations = new Map<string, GenerationRegistration>();
  readonly #reportedFailures = new ReportedFailures();
  readonly #overlapDomains = new Map<string, string>();
  readonly #configuredOwners = new Set<string>();
  #factoryIds = new WeakMap<StorageFactory, number>();
  #nextFactory = 0;
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

  get unresolvedReportedDomainCount(): number {
    return this.#reportedFailures.size;
  }

  get configuredOwnerCount(): number {
    return this.#configuredOwners.size;
  }

  get configuredScopeCount(): number {
    return this.#coordinator?.configuredScopeCount ?? 0;
  }

  hasRegistration(token: string): boolean {
    return this.#registrations.has(token);
  }

  async attach(
    claim: EnvironmentRegistrationClaim,
    descriptors: readonly ContextDeliveryDescriptor[],
    transferred = false,
    binding: RegistrationBinding = { generation: claim.generation },
    transferredReadiness?: RegistrationReadiness,
  ): Promise<EnvironmentAttachmentHandle> {
    this.#requireFresh(descriptors);
    const registration = await assembleRegistration(
      descriptors,
      (descriptor, tenant, context, endpoints, storageFactory) =>
        this.#runtimeFromSnapshot(descriptor, tenant, context, endpoints, storageFactory),
    );
    const ownership = new RegistrationOwnership();
    for (const runtime of registration.runtimes) {
      this.#addRuntime(runtime);
      ownership.add(runtime);
    }
    this.#deliveryRecords.register(claim.token, ownership.scopes);
    const readiness = transferredReadiness ?? this.#readiness(registration, ownership, claim.token);
    if (transferredReadiness !== undefined) {
      readiness.rebind(
        (descriptor, ready) => this.#prepareReady(descriptor, ready, ownership, claim.token),
        (scope) => this.#coordinator?.notify(scope),
      );
    }
    this.#registrations.set(claim.token, {
      readiness,
      startupScopes: registration.scopes,
      ownership,
      descriptors,
      scopeDescriptors: registrationScopeDescriptors(registration),
    });
    if (!transferred) {
      await this.#transition(registration, readiness);
    }
    return await this.#recover(
      claim,
      binding,
      transferred ? registration.scopes : readiness.open(registration.scopes),
    );
  }

  async prepareTransferredRoute(
    claim: EnvironmentRegistrationClaim,
    snapshot: DeliveryDescriptorSnapshot,
    readiness: RegistrationReadiness,
  ): Promise<readonly DeliveryRunScope[]> {
    const descriptor = snapshot.descriptor;
    this.#validateFreshDescriptors([descriptor]);
    const registration = assembleRegistrationSnapshots(
      [snapshot],
      (candidate, tenant, context, endpoints, storageFactory) =>
        this.#runtimeFromSnapshot(candidate, tenant, context, endpoints, storageFactory),
    );
    let state = this.#registrations.get(claim.token);
    if (state === undefined) {
      state = {
        readiness,
        startupScopes: Object.freeze([]),
        ownership: new RegistrationOwnership(),
        descriptors: Object.freeze([]),
        scopeDescriptors: new Map(),
      };
      this.#registrations.set(claim.token, state);
    }
    for (const runtime of registration.runtimes) {
      this.#addRuntime(runtime);
      state.ownership.add(runtime);
    }
    this.#deliveryRecords.register(claim.token, registration.scopes);
    for (const scope of registration.scopes) {
      state.scopeDescriptors.set(scopeKey(scope), descriptor);
    }
    state.startupScopes = appendScopes(state.startupScopes, registration.scopes);
    state.descriptors = Object.freeze([...state.descriptors, descriptor]);
    readiness.rebindDescriptor(
      descriptor,
      (candidate, ready) => this.#prepareReady(candidate, ready, state!.ownership, claim.token),
      (scope) => this.#coordinator?.notify(scope),
    );
    this.#descriptors.add(descriptor);
    return registration.scopes;
  }

  async recoverTransferred(
    token: string,
    descriptor: ContextDeliveryDescriptor,
    ready: DeliveryReady,
  ): Promise<void> {
    const state = this.#registrations.get(token);
    if (state === undefined) {
      throw new Error("Environment registration is not active.");
    }
    const scope = this.#prepareReady(descriptor, ready, state.ownership, token);
    const domains = [this.#overlapDomain(scope)];
    const previouslyBlocked = this.#reportedFailures.overlaps(domains);
    const settlement = await this.#start([scope]);
    this.#reportedFailures.resolve(this.#resolvedDomains([scope], settlement));
    const blocked = previouslyBlocked && this.#reportedFailures.overlaps(domains);
    throwRejected(this.#deliveryRecords.registrationRecords(token), blocked);
  }

  async rollbackRegistration(token: string): Promise<void> {
    const state = this.#registrations.get(token);
    if (state === undefined) {
      return;
    }
    state.readiness.fail();
    const ownerKeys = state.ownership.ownerKeys;
    const scopes = state.ownership.scopes;
    const rollback = (state.rollback ??= { stopped: false, quiescent: false });
    if (!rollback.stopped) {
      this.#worker.stopOwners(ownerKeys);
      rollback.stopped = true;
    }
    if (!rollback.quiescent) {
      await this.#worker.awaitOwnersSettled(ownerKeys);
      rollback.quiescent = true;
    }
    const failures: unknown[] = [];
    try {
      await this.#consumeRegistration(token, false);
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.#worker.retireOwners(ownerKeys);
    } catch (error) {
      failures.push(error);
    }
    let reclaimed = false;
    try {
      await this.#coordinator?.removeOwners(ownerKeys);
      reclaimed = true;
    } catch (error) {
      failures.push(error);
    }
    if (reclaimed) {
      for (const ownerKey of ownerKeys) {
        this.#configuredOwners.delete(ownerKey);
      }
      this.#forgetScopes(scopes);
    }
    this.#registrations.delete(token);
    throwFailures(failures, "Environment registration rollback failed.");
  }

  async detachRegistration(token: string): Promise<void> {
    const state = this.#registrations.get(token);
    if (state === undefined) {
      return;
    }
    state.readiness.fail();
    const ownerKeys = state.ownership.ownerKeys;
    const scopes = state.ownership.scopes;
    const detach = (state.detach ??= {
      stopped: false,
      quiescent: false,
      barrier: false,
      recordsConsumed: false,
      causes: Object.freeze([]),
      reportAttempted: false,
      workerRetirementAttempted: false,
      coordinatorRemoved: false,
    });
    if (!detach.stopped) {
      this.#worker.stopOwners(ownerKeys);
      detach.stopped = true;
    }
    if (!detach.quiescent) {
      await this.#worker.awaitOwnersSettled(ownerKeys);
      detach.quiescent = true;
    }
    if (!detach.barrier) {
      await this.#coordinator?.awaitOwnersBarrier(ownerKeys);
      detach.barrier = true;
    }
    const failures: unknown[] = [];
    if (!detach.recordsConsumed) {
      try {
        detach.causes = this.#deliveryRecords.detach(token);
        detach.recordsConsumed = true;
      } catch (error) {
        failures.push(error);
      }
    }
    if (detach.recordsConsumed && !detach.reportAttempted) {
      detach.reportAttempted = true;
      try {
        if (detach.causes.length > 0) {
          await this.#report(detach.causes);
        }
      } catch (error) {
        failures.push(error);
      }
    }
    if (!detach.workerRetirementAttempted) {
      detach.workerRetirementAttempted = true;
      try {
        await this.#worker.retireOwners(ownerKeys);
      } catch (error) {
        failures.push(error);
      }
    }
    if (!detach.coordinatorRemoved) {
      try {
        if (ownerKeys.length > 0) {
          await this.#coordinator?.removeOwners(ownerKeys);
        }
        detach.coordinatorRemoved = true;
      } catch (error) {
        failures.push(error);
      }
    }
    if (detach.coordinatorRemoved) {
      for (const ownerKey of ownerKeys) {
        this.#configuredOwners.delete(ownerKey);
      }
      this.#forgetScopes(scopes);
      for (const descriptor of state.descriptors) {
        this.#descriptors.delete(descriptor);
        this.#runtimes.delete(descriptor);
      }
      this.#registrations.delete(token);
    }
    throwFailures(failures, "Environment registration detach failed.");
  }

  async retireRegistration(token: string): Promise<void> {
    this.#registrations.get(token)?.readiness.fail();
    if (this.#coordinator === undefined) {
      try {
        await this.#consumeRegistration(token, true);
      } finally {
        this.#registrations.delete(token);
        this.#retiredWithoutCoordinator = true;
        this.#dropRetiredState();
      }
      return;
    }
    try {
      await this.#coordinator.retire(async () => {
        try {
          await this.#consumeRegistration(token, true);
        } finally {
          this.#registrations.delete(token);
        }
      });
    } finally {
      if (this.replacementSafe) {
        this.#dropRetiredState();
      }
    }
  }

  async retire(): Promise<GenerationRetirementResult> {
    const token = this.#registrations.keys().next().value as string | undefined;
    if (token === undefined) {
      this.#retiredWithoutCoordinator = true;
      return Object.freeze({ status: "succeeded" });
    }
    const coordinator = this.#coordinator;
    try {
      if (coordinator === undefined) {
        await this.#consumeRegistration(token, true);
        this.#retiredWithoutCoordinator = true;
      } else {
        await coordinator.retire(() => this.#consumeRegistration(token, true));
      }
    } catch (reason) {
      return Object.freeze({
        status: "failed",
        reason,
        causes: coordinator?.takeRetirementFailureCauses(reason) ?? Object.freeze([reason]),
      });
    }
    this.#registrations.clear();
    this.#dropRetiredState();
    return Object.freeze({ status: "succeeded" });
  }

  captureTransition(capture: TransitionScopes): void {
    const pending = this.#coordinator?.settlement().pending ?? Object.freeze([]);
    const retained = this.#deliveryRecords.retainedScopeSnapshot(pending);
    for (const [token, state] of this.#registrations) {
      this.#captureScopes(
        token,
        state,
        this.#deliveryRecords.configuredScopes(token),
        "configured",
        capture,
      );
      this.#captureScopes(token, state, state.startupScopes, "startup", capture);
      this.#captureScopes(
        token,
        state,
        retained.get(token) ?? Object.freeze([]),
        "retained",
        capture,
      );
    }
  }

  closeRegistration(
    token: string,
    onBuffered: (descriptor: ContextDeliveryDescriptor, ready: DeliveryReady) => void,
  ): RegistrationReadiness {
    const state = this.#registrations.get(token);
    if (state === undefined) {
      throw new Error("Environment registration is not active.");
    }
    state.readiness.prepareTransition(onBuffered);
    return state.readiness;
  }

  openRegistration(token: string): readonly DeliveryRunScope[] {
    const state = this.#registrations.get(token);
    if (state === undefined) {
      throw new Error("Environment registration is not active.");
    }
    return state.readiness.open([]);
  }

  async recoverReopened(scopes: readonly DeliveryRunScope[]): Promise<void> {
    await this.#start(scopes);
  }

  async retireFailedRegistration(token: string): Promise<void> {
    await this.retireRegistration(token);
  }

  #readiness(
    registration: AssembledRegistration,
    ownership: RegistrationOwnership,
    token: string,
  ): RegistrationReadiness {
    return new RegistrationReadiness(
      registration.descriptors,
      (descriptor, ready) => this.#prepareReady(descriptor, ready, ownership, token),
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
    binding: RegistrationBinding,
    startup: readonly DeliveryRunScope[],
  ): Promise<EnvironmentAttachmentHandle> {
    const domains = startup.map((scope) => this.#overlapDomain(scope));
    const previouslyBlocked = this.#reportedFailures.overlaps(domains);
    const settlement = await this.#start(startup);
    this.#reportedFailures.resolve(this.#resolvedDomains(startup, settlement));
    const blocked = previouslyBlocked && this.#reportedFailures.overlaps(domains);
    const startupRecords = this.#deliveryRecords.registrationRecords(claim.token);
    throwRejected(startupRecords, blocked);
    return handle(claim, binding, settlement, () => startupRecords);
  }

  async #consumeRegistration(token: string, consumeGeneration: boolean): Promise<void> {
    const state = this.#registrations.get(token);
    if (state === undefined) {
      return;
    }
    const causes = consumeGeneration
      ? this.#deliveryRecords.retire()
      : this.#deliveryRecords.rollback(token);
    let reportFailure: FailurePresence = { status: "none" };
    try {
      if (causes.length > 0) {
        await this.#report(causes);
      }
    } catch (error) {
      reportFailure = { status: "retained", reason: error };
    }
    if (!consumeGeneration) {
      const unresolved = new Set(
        this.#deliveryRecords
          .records()
          .filter(({ hasCause, reportedSinceResolution }) => hasCause && reportedSinceResolution)
          .flatMap(({ units: recordUnits }) => recordUnits),
      );
      this.#reportedFailures.record(
        state.startupScopes.flatMap((scope) =>
          unresolved.has(scopeKey(scope)) ? [this.#overlapDomain(scope)] : [],
        ),
      );
    }
    if (reportFailure.status === "retained") {
      throw reportFailure.reason;
    }
  }

  async #start(startup: readonly DeliveryRunScope[]): Promise<DeliveryRunSettlement> {
    return startup.length === 0 || this.#coordinator === undefined
      ? emptySettlement()
      : await this.#coordinator.start(startup);
  }

  #prepareReady(
    descriptor: ContextDeliveryDescriptor,
    ready: DeliveryReady,
    ownership: RegistrationOwnership,
    token: string,
  ): DeliveryRunScope {
    const tenant: DeliveryTenantScope =
      ready.tenantId === undefined
        ? Object.freeze({})
        : Object.freeze({ tenantId: ready.tenantId });
    const runtime = this.#runtime(descriptor, tenant);
    this.#addRuntime(runtime);
    ownership.add(runtime);
    this.#deliveryRecords.register(token, runtime.scopes);
    const state = this.#registrations.get(token);
    for (const configured of runtime.scopes) {
      state?.scopeDescriptors.set(scopeKey(configured), descriptor);
    }
    const scope = runtime.scopes.find(
      ({ ready: candidate }) => readyKey(candidate) === readyKey(ready),
    );
    if (scope === undefined) {
      throw new Error("Environment readiness is outside the descriptor endpoint domain.");
    }
    return scope;
  }

  #captureScopes(
    token: string,
    state: GenerationRegistration,
    scopes: readonly DeliveryRunScope[],
    source: TransitionScopeSource,
    capture: TransitionScopes,
  ): void {
    for (const scope of scopes) {
      const descriptor = state.scopeDescriptors.get(scopeKey(scope));
      if (descriptor === undefined) {
        throw new Error("Environment transition scope has no descriptor route.");
      }
      capture.capture(token, descriptor, [scope], source);
    }
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
        onSettlement: (settlement) => {
          this.#deliveryRecords.observe(settlement);
        },
      });
    } else {
      this.#coordinator.configure(runtime.scopes);
    }
  }

  #runtime(
    descriptor: ContextDeliveryDescriptor,
    tenant: DeliveryTenantScope,
  ): EnvironmentDeliveryRuntime {
    const existing = this.#existingRuntime(descriptor, tenant);
    if (existing !== undefined) {
      return existing;
    }
    return this.#runtimeFromSnapshot(
      descriptor,
      tenant,
      descriptor.storageContext(tenant),
      descriptor.endpoints(),
      descriptor.storageFactory,
    );
  }

  #runtimeFromSnapshot(
    descriptor: ContextDeliveryDescriptor,
    tenant: DeliveryTenantScope,
    context: StorageContext,
    endpoints: readonly DeliveryEndpoint[],
    storageFactory: StorageFactory,
  ): EnvironmentDeliveryRuntime {
    const existing = this.#existingRuntime(descriptor, tenant);
    if (existing !== undefined) {
      return existing;
    }
    const tenantKey = tenant.tenantId ?? "\u0000";
    this.#nextOwner += 1;
    const owner = Object.freeze({ key: `environment-owner-${this.#nextOwner.toString()}` });
    const runtime = Object.freeze({
      owner,
      descriptor,
      storageFactory,
      tenant,
      context,
      scopes: Object.freeze(endpoints.map((endpoint) => readyScope(owner, endpoint, tenant))),
    });
    for (const scope of runtime.scopes) {
      this.#overlapDomains.set(
        scopeKey(scope),
        this.#stableDomain(storageFactory, context, scope.ready),
      );
    }
    const runtimes =
      this.#runtimes.get(descriptor) ?? new Map<string, EnvironmentDeliveryRuntime>();
    runtimes.set(tenantKey, runtime);
    this.#runtimes.set(descriptor, runtimes);
    return runtime;
  }

  #existingRuntime(
    descriptor: ContextDeliveryDescriptor,
    tenant: DeliveryTenantScope,
  ): EnvironmentDeliveryRuntime | undefined {
    return this.#runtimes.get(descriptor)?.get(tenant.tenantId ?? "\u0000");
  }

  #stableDomain(factory: StorageFactory, context: StorageContext, ready: DeliveryReady): string {
    let factoryId = this.#factoryIds.get(factory);
    if (factoryId === undefined) {
      this.#nextFactory += 1;
      factoryId = this.#nextFactory;
      this.#factoryIds.set(factory, factoryId);
    }
    return JSON.stringify([
      factoryId,
      context.name,
      context.multitenant,
      context.tenantId ?? null,
      readyKey(ready),
    ]);
  }

  #overlapDomain(scope: DeliveryRunScope): string {
    const domain = this.#overlapDomains.get(scopeKey(scope));
    if (domain === undefined) {
      throw new Error("Environment overlap domain is not configured.");
    }
    return domain;
  }

  #resolvedDomains(
    startup: readonly DeliveryRunScope[],
    settlement: DeliveryRunSettlement,
  ): readonly string[] {
    const current = new Set(startup.map(scopeKey));
    return settlement.scopes.flatMap(({ scope, disposition }) =>
      current.has(scopeKey(scope)) && disposition !== "REJECTED"
        ? [this.#overlapDomain(scope)]
        : [],
    );
  }

  #forgetScopes(scopes: readonly DeliveryRunScope[]): void {
    for (const scope of scopes) {
      this.#overlapDomains.delete(scopeKey(scope));
    }
  }

  #dropRetiredState(): void {
    this.#reportedFailures.clear();
    this.#overlapDomains.clear();
    this.#factoryIds = new WeakMap<StorageFactory, number>();
    this.#nextFactory = 0;
  }

  #requireFresh(descriptors: readonly ContextDeliveryDescriptor[]): void {
    for (const descriptor of this.#validateFreshDescriptors(descriptors)) {
      this.#descriptors.add(descriptor);
    }
  }

  #validateFreshDescriptors(
    descriptors: readonly ContextDeliveryDescriptor[],
  ): ReadonlySet<ContextDeliveryDescriptor> {
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
    return unique;
  }
}

/** @internal Finite attachment-local bridge from descriptor transition to one generation. */
export class RegistrationReadiness {
  readonly #descriptors: readonly ContextDeliveryDescriptor[];
  readonly #canonical = new WeakMap<
    ContextDeliveryDescriptor,
    ReadonlyMap<string, DeliveryRunScope>
  >();
  readonly #destinations = new WeakMap<ContextDeliveryDescriptor, ReadinessDestination>();
  readonly #buffered = new Map<ContextDeliveryDescriptor, Map<string, DeliveryReady>>();
  #onTransition:
    ((descriptor: ContextDeliveryDescriptor, ready: DeliveryReady) => void) | undefined;
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
    this.#descriptors = Object.freeze(descriptors.map(({ descriptor }) => descriptor));
    for (const { descriptor, scopes } of descriptors) {
      this.#canonical.set(
        descriptor,
        new Map(scopes.map((scope) => [readyKey(scope.ready), scope])),
      );
      this.#destinations.set(descriptor, { onPrepare, onNotify });
    }
  }

  notify(descriptor: ContextDeliveryDescriptor, ready: DeliveryReady): void {
    if (this.#mode === "failed") {
      return;
    }
    if (this.#mode === "open") {
      try {
        const destination = this.#destinations.get(descriptor);
        if (destination === undefined) {
          throw new Error("Registration readiness descriptor is not configured.");
        }
        const scope = destination.onPrepare(descriptor, ready);
        destination.onNotify(scope);
      } catch {
        this.#mode = "failed";
      }
      return;
    }
    if (this.#onTransition !== undefined) {
      try {
        const snapshot = cloneReady(ready);
        this.#onTransition(descriptor, snapshot);
        this.#buffer(descriptor, snapshot);
      } catch {
        this.#invalid = true;
      }
      return;
    }
    const scope = this.#canonical.get(descriptor)?.get(readyKey(ready));
    if (scope === undefined) {
      this.#invalid = true;
      return;
    }
    this.#buffer(descriptor, cloneReady(scope.ready));
  }

  fail(): void {
    this.#mode = "failed";
    this.#buffered.clear();
    this.#onTransition = undefined;
  }

  prepareTransition(
    onBuffered: (descriptor: ContextDeliveryDescriptor, ready: DeliveryReady) => void,
  ): void {
    if (this.#mode !== "open") {
      throw new Error("Registration readiness is not open.");
    }
    this.#onTransition = onBuffered;
    this.#mode = "waiting";
  }

  rebind(
    onPrepare: (descriptor: ContextDeliveryDescriptor, ready: DeliveryReady) => DeliveryRunScope,
    onNotify: (scope: DeliveryRunScope) => void,
  ): void {
    for (const descriptor of this.#descriptors) {
      this.rebindDescriptor(descriptor, onPrepare, onNotify);
    }
  }

  rebindDescriptor(
    descriptor: ContextDeliveryDescriptor,
    onPrepare: (descriptor: ContextDeliveryDescriptor, ready: DeliveryReady) => DeliveryRunScope,
    onNotify: (scope: DeliveryRunScope) => void,
  ): void {
    if (this.#mode !== "waiting") {
      throw new Error("Registration readiness is not prepared for transition.");
    }
    this.#destinations.set(descriptor, { onPrepare, onNotify });
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
    for (const [descriptor, readies] of this.#buffered) {
      const destination = this.#destinations.get(descriptor);
      if (destination === undefined) {
        throw new Error("Registration readiness descriptor is not configured.");
      }
      for (const ready of readies.values()) {
        const scope = destination.onPrepare(descriptor, ready);
        scopes.set(scopeKey(scope), scope);
      }
    }
    this.#buffered.clear();
    this.#onTransition = undefined;
    this.#mode = "open";
    return Object.freeze([...scopes.values()]);
  }

  #buffer(descriptor: ContextDeliveryDescriptor, ready: DeliveryReady): void {
    const readies = this.#buffered.get(descriptor) ?? new Map<string, DeliveryReady>();
    readies.set(readyKey(ready), ready);
    this.#buffered.set(descriptor, readies);
  }
}

interface ReadinessDestination {
  readonly onPrepare: (
    descriptor: ContextDeliveryDescriptor,
    ready: DeliveryReady,
  ) => DeliveryRunScope;
  readonly onNotify: (scope: DeliveryRunScope) => void;
}

interface AssembledRegistration {
  readonly scopes: readonly DeliveryRunScope[];
  readonly runtimes: readonly EnvironmentDeliveryRuntime[];
  readonly descriptors: readonly {
    readonly descriptor: ContextDeliveryDescriptor;
    readonly scopes: readonly DeliveryRunScope[];
  }[];
}

interface DeliveryDescriptorSnapshot {
  readonly descriptor: ContextDeliveryDescriptor;
  readonly storageFactory: StorageFactory;
  readonly startup: readonly DeliveryRuntimeSnapshot[];
  readonly endpoints: readonly DeliveryEndpoint[];
}

interface DeliveryRuntimeSnapshot {
  readonly tenant: DeliveryTenantScope;
  readonly context: StorageContext;
}

async function assembleRegistration(
  descriptors: readonly ContextDeliveryDescriptor[],
  runtimeFor: (
    descriptor: ContextDeliveryDescriptor,
    tenant: DeliveryTenantScope,
    context: StorageContext,
    endpoints: readonly DeliveryEndpoint[],
    storageFactory: StorageFactory,
  ) => EnvironmentDeliveryRuntime,
): Promise<AssembledRegistration> {
  const snapshots: DeliveryDescriptorSnapshot[] = [];
  for (const descriptor of descriptors) {
    snapshots.push(await snapshotDescriptor(descriptor));
  }
  return assembleRegistrationSnapshots(snapshots, runtimeFor);
}

async function snapshotDescriptor(
  descriptor: ContextDeliveryDescriptor,
): Promise<DeliveryDescriptorSnapshot> {
  const storageFactory = descriptor.storageFactory;
  const tenants = await descriptor.startupScopes();
  const endpoints = Object.freeze(
    descriptor.endpoints().map((endpoint) =>
      Object.freeze({
        label: endpoint.label,
        targetTypeUrl: endpoint.targetTypeUrl,
        shard: new ShardIndex(endpoint.shard.index, endpoint.shard.ofTotal),
      }),
    ),
  );
  const startup = tenants.map((tenant) => {
    const capturedTenant: DeliveryTenantScope = Object.freeze({
      ...(tenant.tenantId === undefined ? {} : { tenantId: tenant.tenantId }),
    });
    const context = descriptor.storageContext(capturedTenant);
    return Object.freeze({
      tenant: capturedTenant,
      context: Object.freeze({
        name: context.name,
        multitenant: context.multitenant,
        ...(context.tenantId === undefined ? {} : { tenantId: context.tenantId }),
      }),
    });
  });
  return Object.freeze({
    descriptor,
    storageFactory,
    startup: Object.freeze(startup),
    endpoints,
  });
}

function assembleRegistrationSnapshots(
  snapshots: readonly DeliveryDescriptorSnapshot[],
  runtimeFor: (
    descriptor: ContextDeliveryDescriptor,
    tenant: DeliveryTenantScope,
    context: StorageContext,
    endpoints: readonly DeliveryEndpoint[],
    storageFactory: StorageFactory,
  ) => EnvironmentDeliveryRuntime,
): AssembledRegistration {
  const scopes = new Map<string, DeliveryRunScope>();
  const runtimes: EnvironmentDeliveryRuntime[] = [];
  const assembled: AssembledRegistration["descriptors"][number][] = [];
  for (const { descriptor, storageFactory, startup, endpoints } of snapshots) {
    const descriptorScopes: DeliveryRunScope[] = [];
    for (const { tenant, context } of startup) {
      const runtime = runtimeFor(descriptor, tenant, context, endpoints, storageFactory);
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

function registrationScopeDescriptors(
  registration: AssembledRegistration,
): Map<string, ContextDeliveryDescriptor> {
  const descriptors = new Map<string, ContextDeliveryDescriptor>();
  for (const { descriptor, scopes } of registration.descriptors) {
    for (const scope of scopes) {
      descriptors.set(scopeKey(scope), descriptor);
    }
  }
  return descriptors;
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
  if (blocked) {
    throw new Error("Startup recovery is blocked by an unresolved shared delivery obligation.");
  }
  const causes = records.flatMap((record) => (record.hasCause ? [record.cause] : []));
  if (causes.length === 1) {
    throw causes[0];
  }
  if (causes.length > 1) {
    throw new AggregateError(causes, "Environment attachment startup recovery failed.");
  }
}

class ReportedFailures {
  readonly #domains = new Set<string>();

  get size(): number {
    return this.#domains.size;
  }

  record(domains: readonly string[]): void {
    for (const domain of domains) {
      this.#domains.add(domain);
    }
  }

  overlaps(domains: readonly string[]): boolean {
    return domains.some((domain) => this.#domains.has(domain));
  }

  resolve(domains: readonly string[]): void {
    for (const domain of domains) {
      this.#domains.delete(domain);
    }
  }

  clear(): void {
    this.#domains.clear();
  }
}

function explicitRetryError(): Error {
  return new Error("Environment generation rollback requires an explicit retry.");
}

function detachRetryRequiredError(): Error {
  return new Error("Environment generation detach requires an explicit retry.");
}

function deliveryStopRetryRequiredError(): Error {
  return new Error("Environment delivery stop requires an explicit retry.");
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

const currentAggregationFailure = Symbol("currentAggregationFailure");

interface CurrentAggregationFailure {
  readonly [currentAggregationFailure]: true;
  readonly causes: readonly unknown[];
}

function throwCurrentAggregation(failures: readonly unknown[]): never {
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw Object.freeze({
      [currentAggregationFailure]: true,
      causes: Object.freeze([...failures]),
    });
  }
  throw new Error("Environment transition aggregation requires at least one failure.");
}

function currentAggregationCauses(error: unknown): readonly unknown[] {
  if (
    typeof error === "object" &&
    error !== null &&
    currentAggregationFailure in error &&
    (error as Partial<CurrentAggregationFailure>)[currentAggregationFailure] === true
  ) {
    return (error as CurrentAggregationFailure).causes;
  }
  return Object.freeze([error]);
}

function handle(
  claim: EnvironmentRegistrationClaim,
  binding: RegistrationBinding,
  startup: DeliveryRunSettlement,
  records: () => readonly ParkedDeliveryObligationRecord[],
): EnvironmentAttachmentHandle {
  return new AttachedEnvironmentRegistration(claim, binding, startup, records);
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

function appendScopes(
  existing: readonly DeliveryRunScope[],
  added: readonly DeliveryRunScope[],
): readonly DeliveryRunScope[] {
  const scopes = new Map(existing.map((scope) => [scopeKey(scope), scope]));
  for (const scope of added) {
    scopes.set(scopeKey(scope), scope);
  }
  return Object.freeze([...scopes.values()]);
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

function cloneReady(ready: DeliveryReady): DeliveryReady {
  return Object.freeze({
    ...(ready.tenantId === undefined ? {} : { tenantId: ready.tenantId }),
    label: ready.label,
    targetTypeUrl: ready.targetTypeUrl,
    shard: new ShardIndex(ready.shard.index, ready.shard.ofTotal),
  });
}

function emptySettlement(): DeliveryRunSettlement {
  return Object.freeze({ scopes: Object.freeze([]), pending: Object.freeze([]) });
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
