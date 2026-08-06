import { create } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import type {
  BackendSubscriptionEnvelope,
  OnBackendSubscription,
  SubscriptionBindingTransition,
  SubscriptionBindings,
  SubscriptionCapacityReservation,
} from "@spine-event-engine/auth";
import { RecordSpec, type RecordStorage, type StorageFactory } from "@spine-event-engine/storage";

const bindingType = "type.spine-event-engine.gateway/DurableSubscriptionBinding";
const quotaType = "type.spine-event-engine.gateway/SubscriptionBindingQuota";
const cleanupType = "type.spine-event-engine.gateway/SubscriptionBindingCleanup";
const quotaId = "!subscription-quota";
const cleanupId = "!subscription-cleanup";
const attempts = 8;

/**
 * Configures one durable, namespace-global subscription registry.
 */
export interface DurableSubscriptionBindingsOptions {
  // prettier-ignore

  /**
   * Stores durable registry records.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Names the shared registry.
   */
  readonly namespace: string;

  /**
   * Returns a public binding identifier.
   *
   * @returns The next public binding identifier.
   */
  readonly nextId: () => string;

  /**
   * Disposes one backend subscription.
   */
  readonly dispose: OnBackendSubscription;

  /**
   * Limits one durable ownership lease in milliseconds.
   */
  readonly leaseMs: number;

  /**
   * Limits records processed by one cleanup pass.
   */
  readonly cleanupBatchSize: number;

  /**
   * Limits bindings in the shared registry.
   */
  readonly recordLimit: number;

  /**
   * Limits encoded durable record bytes.
   */
  readonly maxRecordBytes: number;
}

interface Binding {
  readonly family: "binding";
  readonly id: string;
  readonly revision: number;
  readonly admissionToken: string;
  readonly lifecycle: "reserved" | "inactive" | "active" | "cancelling" | "retired";
  readonly fence: number;
  readonly reservationOwner?: string;
  readonly reservationUntilMs?: number;
  readonly principalFingerprint?: string;
  readonly topology?: string;
  readonly tenant?: string;
  readonly expiresAtMs?: number;
  readonly backend?: string;
  readonly backendBytes?: number;
  readonly ownerId?: string;
  readonly leaseUntilMs?: number | undefined;
  readonly reason?: "client" | "activation-end" | "expired" | undefined;
}
interface Quota {
  readonly family: "quota";
  readonly id: typeof quotaId;
  readonly revision: number;
  readonly used: number;
  readonly operation?: {
    readonly kind: "reserve" | "release" | "repair";
    readonly operationId: string;
    readonly bindingId?: string;
    readonly token?: string;
    readonly afterId?: string | undefined;
    readonly count?: number;
  };
}
interface Cleanup {
  readonly family: "cleanup";
  readonly id: typeof cleanupId;
  readonly revision: number;
  readonly ownerId?: string;
  readonly fence: number;
  readonly leaseUntilMs?: number | undefined;
  readonly afterId?: string | undefined;
  readonly failureCount: number;
  readonly retryAfterMs: number;
}
type Stored = Binding | Quota | Cleanup;

/**
 * Stores private bindings and their coordination facts in one record namespace.
 *
 * A record is durable coordination, not a durable stream: clients reconnect and
 * re-query entity state after a gateway restart and may observe update gaps.
 */
export class DurableSubscriptionBindings implements SubscriptionBindings {
  // prettier-ignore

  /**
   * Indicates that this registry uses durable coordination storage.
   */
  readonly durable = true;

  /**
   * Declares that durable records fence backend topology identity.
   */
  readonly topologyFencing = true;

  /**
   * Names the validated durable registry shared by standalone gateway replicas.
   */
  readonly namespace: string;
  readonly #storage: RecordStorage<string, Any>;
  readonly #dispose: OnBackendSubscription;
  readonly #nextId: () => string;
  readonly #leaseMs: number;
  readonly #cleanupBatchSize: number;
  readonly #recordLimit: number;
  readonly #maxRecordBytes: number;
  readonly #owner = crypto.randomUUID();
  readonly #reservations = new Map<
    SubscriptionCapacityReservation,
    { id: string; token: string; consumed: boolean }
  >();
  readonly #active = new Set<{
    id: string;
    controller: AbortController;
    timer: ReturnType<typeof setTimeout>;
    fence: number;
  }>();
  readonly #cancelling = new Map<string, Promise<SubscriptionBindingTransition>>();
  readonly #cancelControllers = new Map<string, AbortController>();
  readonly #cleanupControllers = new Set<AbortController>();
  readonly #running = new Set<Promise<unknown>>();
  #closed = false;

  /**
   * Opens a registry handle without taking ownership of the supplied factory.
   *
   * @param options Supplies finite storage, lease, and cleanup collaborators.
   */
  constructor(options: DurableSubscriptionBindingsOptions) {
    Values.options(options);
    this.namespace = options.namespace;
    this.#dispose = options.dispose;
    void this.#dispose;
    this.#nextId = options.nextId;
    this.#leaseMs = options.leaseMs;
    this.#cleanupBatchSize = options.cleanupBatchSize;
    this.#recordLimit = options.recordLimit;
    this.#maxRecordBytes = options.maxRecordBytes;
    this.#storage = options.storageFactory.createRecordStorage(
      { name: `spine.gateway.${options.namespace}`, multitenant: false },
      new RecordSpec({
        schema: AnySchema,
        storageKey: "spine.gateway.SubscriptionBinding:v4",
        idKind: "string",
        extractId: (record) => Values.id(record),
      }),
    );
    if (!this.#storage.atomicCompareAndSet) {
      this.#storage.close();
      throw new Error("Subscription registry storage requires atomic compare-and-set.");
    }
  }

  /**
   * Creates one namespace-global reservation with a public identifier.
   *
   * @returns The reservation that releases an unused slot.
   */
  async reserveCapacity(): Promise<SubscriptionCapacityReservation> {
    this.#open();
    const initialQuota = await this.#storage.read(quotaId);
    if (initialQuota === undefined) {
      // A namespace without a repair control row must fail closed before it
      // admits another slot. A durable repair deliberately counts malformed
      // slots without decoding them so corruption cannot create capacity.
      const existing = await this.#storage.queryEntries({ limit: this.#recordLimit + 2 });
      for (const row of existing) Values.read(row.record, row.id, this.#maxRecordBytes);
    }
    for (let count = 0; count < attempts; count += 1) {
      const quota = await this.#quota();
      if (quota.operation !== undefined) {
        await this.#complete(quota);
        continue;
      }
      if (quota.used >= this.#recordLimit) throw new Error("binding-capacity-exceeded");
      const id = this.#nextId();
      if (!Values.publicId(id)) throw new Error("subscription ID must be unique");
      const token = crypto.randomUUID();
      const operation = {
        kind: "reserve" as const,
        operationId: crypto.randomUUID(),
        bindingId: id,
        token,
      };
      const staged: Quota = { ...quota, revision: quota.revision + 1, operation };
      if (!(await this.#replaceQuota(quota, staged))) {
        const reread = await this.#quota();
        if (reread.operation?.operationId !== operation.operationId) continue;
      }
      await this.#complete(staged);
      const admitted = await this.#slot(id, token);
      if (admitted === undefined) continue;
      let released = false;
      const reservation: SubscriptionCapacityReservation = {
        release: async () => {
          if (released) return;
          released = true;
          if (!this.#reservations.delete(reservation)) return;
          await this.#release(id, token);
        },
      };
      this.#reservations.set(reservation, { id, token, consumed: false });
      return reservation;
    }
    throw new Error("binding-capacity-exceeded");
  }

  /**
   * Converts an owned reserved slot to an inactive private binding.
   *
   * @param input Supplies the private envelope, ownership facts, and optional slot.
   * @returns The public binding identifier.
   */
  async create(input: {
    readonly backend: BackendSubscriptionEnvelope;
    readonly principalFingerprint: string;
    readonly topology?: string;
    readonly tenant: string | undefined;
    readonly expiresAtMs: number;
    readonly reservation?: SubscriptionCapacityReservation;
  }): Promise<{ readonly id: string }> {
    this.#open();
    Values.input(input);
    const supplied =
      input.reservation === undefined ? undefined : this.#reservations.get(input.reservation);
    const acquired =
      supplied === undefined || input.reservation === undefined
        ? await this.reserveCapacity()
        : input.reservation;
    const internallyAcquired = acquired !== input.reservation;
    try {
      const held = this.#reservations.get(acquired);
      if (held === undefined || held.consumed) throw new Error("binding-capacity-exceeded");
      held.consumed = true;
      const row = await this.#storage.read(held.id);
      const old =
        row === undefined
          ? undefined
          : (Values.read(row, held.id, this.#maxRecordBytes) as Binding);
      if (old?.lifecycle !== "reserved" || old.admissionToken !== held.token)
        throw new Error("binding-capacity-exceeded");
      const next: Binding = {
        family: "binding",
        id: old.id,
        revision: old.revision + 1,
        admissionToken: old.admissionToken,
        lifecycle: "inactive",
        fence: 0,
        principalFingerprint: input.principalFingerprint,
        topology: input.topology ?? "legacy",
        ...(input.tenant === undefined ? {} : { tenant: input.tenant }),
        expiresAtMs: input.expiresAtMs,
        backend: Values.base64(input.backend.bytes),
        backendBytes: input.backend.bytes.byteLength,
      };
      if (!(await this.#cas(old.id, row, Values.write(next, this.#maxRecordBytes)))) {
        const applied = await this.#slot(old.id, held.token);
        const current = await this.#storage.read(old.id);
        if (applied !== undefined || current === undefined || !this.#sameBinding(current, next))
          throw new Error("binding-capacity-exceeded");
      }
      this.#reservations.delete(acquired);
      return Object.freeze({ id: old.id });
    } catch (error) {
      if (internallyAcquired) await acquired.release();
      throw error;
    }
  }

  /**
   * Activates an owned binding through one backend callback.
   *
   * @param input Supplies the binding, ownership facts, and activation callback.
   * @returns The activation outcome.
   */
  async activate(input: {
    readonly id: string;
    readonly principalFingerprint: string;
    readonly topology?: string;
    readonly tenant: string | undefined;
    readonly nowMs: number;
    readonly onBackend: OnBackendSubscription;
    readonly signal: AbortSignal;
  }): Promise<SubscriptionBindingTransition> {
    const task = this.#activate(input);
    this.#running.add(task);
    try {
      return await task;
    } finally {
      this.#running.delete(task);
    }
  }

  async #activate(input: {
    readonly id: string;
    readonly principalFingerprint: string;
    readonly topology?: string;
    readonly tenant: string | undefined;
    readonly nowMs: number;
    readonly onBackend: OnBackendSubscription;
    readonly signal: AbortSignal;
  }): Promise<SubscriptionBindingTransition> {
    if (input.signal.aborted) return { kind: "denied" };
    const claimed = await this.#claim(input, "active");
    if (claimed === undefined) return { kind: "denied" };
    const controller = new AbortController();
    const abort = () => {
      controller.abort();
    };
    input.signal.addEventListener("abort", abort, { once: true });
    const active = {
      id: input.id,
      controller,
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
      fence: claimed.fence,
    };
    this.#active.add(active);
    this.#scheduleRenew(active);
    try {
      await input.onBackend(Values.envelope(claimed), controller.signal, () =>
        this.#current(input.id, claimed.fence, "active", Date.now()),
      );
      if (!(await this.#current(input.id, claimed.fence, "active", input.nowMs)))
        return { kind: "denied" };
      await this.#finalizeActivation(claimed, input.nowMs);
      return { kind: "activated" };
    } finally {
      clearTimeout(active.timer);
      this.#active.delete(active);
      input.signal.removeEventListener("abort", abort);
    }
  }

  /**
   * Cancels an owned binding through one backend callback.
   *
   * @param input Supplies the binding, ownership facts, and cleanup callback.
   * @returns The cancellation outcome.
   */
  async cancel(input: {
    readonly id: string;
    readonly principalFingerprint: string;
    readonly topology?: string;
    readonly tenant: string | undefined;
    readonly nowMs: number;
    readonly onBackend: OnBackendSubscription;
  }): Promise<SubscriptionBindingTransition> {
    const pending = this.#cancelling.get(input.id);
    if (pending !== undefined) return pending;
    const task = this.#cancel(input);
    this.#cancelling.set(input.id, task);
    this.#running.add(task);
    try {
      return await task;
    } finally {
      if (this.#cancelling.get(input.id) === task) this.#cancelling.delete(input.id);
      this.#running.delete(task);
    }
  }

  async #cancel(input: {
    readonly id: string;
    readonly principalFingerprint: string;
    readonly tenant: string | undefined;
    readonly nowMs: number;
    readonly onBackend: OnBackendSubscription;
  }): Promise<SubscriptionBindingTransition> {
    const row = await this.#storage.read(input.id);
    if (row === undefined) return { kind: "closed" };
    const old = Values.read(row, input.id, this.#maxRecordBytes) as Binding;
    if (!this.#owned(old, input) || old.lifecycle === "reserved" || old.lifecycle === "retired")
      return { kind: "denied" };
    let next: Binding;
    if (
      old.lifecycle === "cancelling" &&
      old.ownerId === this.#owner &&
      (old.leaseUntilMs ?? 0) > input.nowMs
    ) {
      next = old;
    } else {
      if (old.lifecycle === "cancelling" && (old.leaseUntilMs ?? 0) > input.nowMs)
        return { kind: "denied" };
      next = this.#work(old, "cancelling", input.nowMs, "client");
      if (!(await this.#cas(input.id, row, Values.write(next, this.#maxRecordBytes)))) {
        const current = await this.#storage.read(input.id);
        if (current === undefined) return { kind: "closed" };
        if (!this.#sameBinding(current, next)) {
          const live = Values.read(current, input.id, this.#maxRecordBytes) as Binding;
          if (live.lifecycle === "cancelling" && (live.leaseUntilMs ?? 0) <= input.nowMs)
            return this.#cancel(input);
          return { kind: "denied" };
        }
      }
    }
    for (const active of this.#active) if (active.id === input.id) active.controller.abort();
    const controller = new AbortController();
    this.#cancelControllers.set(input.id, controller);
    try {
      await input.onBackend(Values.envelope(next), controller.signal, () =>
        this.#current(input.id, next.fence, "cancelling", Date.now()),
      );
    } catch {
      return { kind: "denied" };
    } finally {
      if (this.#cancelControllers.get(input.id) === controller)
        this.#cancelControllers.delete(input.id);
    }
    const current = await this.#storage.read(input.id);
    if (current === undefined) return { kind: "closed" };
    const live = Values.read(current, input.id, this.#maxRecordBytes) as Binding;
    if (live.lifecycle !== "cancelling" || live.fence !== next.fence) return { kind: "denied" };
    const retired: Binding = {
      family: "binding",
      id: live.id,
      revision: live.revision + 1,
      admissionToken: live.admissionToken,
      lifecycle: "retired",
      fence: live.fence,
    };
    if (!(await this.#cas(input.id, current, Values.write(retired, this.#maxRecordBytes)))) {
      const reread = await this.#storage.read(input.id);
      if (reread === undefined) return { kind: "closed" };
      if (!this.#sameBinding(reread, retired)) return { kind: "denied" };
    }
    await this.#release(retired.id, retired.admissionToken);
    return { kind: "closed" };
  }

  /**
   * Removes a finite page of expired reservations and bindings.
   *
   * @param nowMs Supplies the current time in milliseconds.
   * @returns Completes after one cleanup page is processed.
   */
  async purgeExpired(nowMs: number): Promise<void> {
    const task = this.#purgeExpired(nowMs);
    this.#running.add(task);
    try {
      await task;
    } finally {
      this.#running.delete(task);
    }
  }

  async #purgeExpired(nowMs: number): Promise<void> {
    this.#open();
    Values.time(nowMs);
    for (let count = 0; count < attempts; count += 1) {
      const control = await this.#cleanup();
      if (control.retryAfterMs > nowMs) return;
      if (
        control.ownerId !== undefined &&
        control.ownerId !== this.#owner &&
        (control.leaseUntilMs ?? 0) > nowMs
      )
        return;
      const claimed: Cleanup = {
        ...control,
        revision: control.revision + 1,
        ownerId: this.#owner,
        fence: control.fence + 1,
        leaseUntilMs: this.#until(nowMs),
      };
      if (!(await this.#replaceCleanup(control, claimed))) {
        const reread = await this.#cleanup();
        if (!this.#sameCleanup(reread, claimed)) continue;
      }
      try {
        await this.#clean(claimed, nowMs);
        return;
      } catch {
        await this.#failClean(claimed, nowMs);
        return;
      }
    }
  }

  /**
   * Stops local work without removing durable rows needed by a later handle.
   *
   * @returns Completes after local work is stopped.
   */
  async close(): Promise<void> {
    this.#closed = true;
    for (const active of this.#active) {
      clearTimeout(active.timer);
      active.controller.abort();
    }
    for (const controller of this.#cancelControllers.values()) controller.abort();
    for (const controller of this.#cleanupControllers) controller.abort();
    await Promise.allSettled(this.#running);
    this.#active.clear();
    this.#cancelling.clear();
    this.#cancelControllers.clear();
    this.#cleanupControllers.clear();
    this.#reservations.clear();
    this.#storage.close();
    await Promise.resolve();
  }

  async #claim(
    input: {
      readonly id: string;
      readonly principalFingerprint: string;
      readonly tenant: string | undefined;
      readonly nowMs: number;
    },
    lifecycle: "active",
  ): Promise<Binding | undefined> {
    this.#open();
    const row = await this.#storage.read(input.id);
    if (row === undefined) return undefined;
    const old = Values.read(row, input.id, this.#maxRecordBytes) as Binding;
    if (
      !this.#owned(old, input) ||
      (old.lifecycle !== "inactive" &&
        !(old.lifecycle === "active" && (old.leaseUntilMs ?? 0) <= input.nowMs))
    )
      return undefined;
    const next = this.#work(old, lifecycle, input.nowMs);
    if (await this.#cas(input.id, row, Values.write(next, this.#maxRecordBytes))) return next;
    const reread = await this.#storage.read(input.id);
    return reread !== undefined && this.#sameBinding(reread, next) ? next : undefined;
  }
  #work(
    old: Binding,
    lifecycle: "active" | "cancelling",
    nowMs: number,
    reason?: "client" | "activation-end" | "expired",
  ): Binding {
    return {
      ...old,
      revision: old.revision + 1,
      lifecycle,
      fence: old.fence + 1,
      ownerId: this.#owner,
      leaseUntilMs: this.#until(nowMs),
      reason,
    };
  }
  async #renew(active: {
    id: string;
    controller: AbortController;
    timer: ReturnType<typeof setTimeout>;
    fence: number;
  }): Promise<void> {
    const row = await this.#storage.read(active.id);
    if (row === undefined) {
      active.controller.abort();
      return;
    }
    const old = Values.read(row, active.id, this.#maxRecordBytes) as Binding;
    if (old.lifecycle !== "active" || old.ownerId !== this.#owner || old.fence !== active.fence) {
      active.controller.abort();
      return;
    }
    const next = { ...old, revision: old.revision + 1, leaseUntilMs: this.#until(Date.now()) };
    if (!(await this.#cas(active.id, row, Values.write(next, this.#maxRecordBytes)))) {
      if (!(await this.#current(active.id, active.fence, "active", Date.now()))) {
        active.controller.abort();
        return;
      }
    }
    if (this.#active.has(active) && !active.controller.signal.aborted) this.#scheduleRenew(active);
  }
  #scheduleRenew(active: {
    id: string;
    controller: AbortController;
    timer: ReturnType<typeof setTimeout>;
    fence: number;
  }): void {
    active.timer = setTimeout(
      () => void this.#renew(active),
      Math.max(1, Math.floor(this.#leaseMs / 2)),
    );
  }
  #until(nowMs: number): number {
    return Math.min(Number.MAX_SAFE_INTEGER, nowMs + this.#leaseMs);
  }
  async #current(
    id: string,
    fence: number,
    lifecycle: Binding["lifecycle"],
    nowMs: number,
  ): Promise<boolean> {
    const row = await this.#storage.read(id);
    if (row === undefined) return false;
    const value = Values.read(row, id, this.#maxRecordBytes) as Binding;
    return (
      value.lifecycle === lifecycle &&
      value.ownerId === this.#owner &&
      value.fence === fence &&
      Number(value.leaseUntilMs) > nowMs
    );
  }
  async #release(id: string, token: string): Promise<void> {
    for (let count = 0; count < attempts; count += 1) {
      const quota = await this.#quota();
      if (quota.operation !== undefined) {
        await this.#complete(quota);
        continue;
      }
      const operation = {
        kind: "release" as const,
        operationId: crypto.randomUUID(),
        bindingId: id,
        token,
      };
      const staged: Quota = { ...quota, revision: quota.revision + 1, operation };
      if (!(await this.#replaceQuota(quota, staged))) continue;
      await this.#complete(staged);
      return;
    }
  }
  #forgetReservation(id: string, token: string): void {
    for (const [reservation, held] of this.#reservations)
      if (held.id === id && held.token === token) this.#reservations.delete(reservation);
  }
  async #cleanup(): Promise<Cleanup> {
    const row = await this.#storage.read(cleanupId);
    if (row !== undefined) return Values.read(row, cleanupId, this.#maxRecordBytes) as Cleanup;
    const fresh: Cleanup = {
      family: "cleanup",
      id: cleanupId,
      revision: 1,
      fence: 0,
      failureCount: 0,
      retryAfterMs: 0,
    };
    await this.#cas(cleanupId, undefined, Values.write(fresh, this.#maxRecordBytes));
    const created = await this.#storage.read(cleanupId);
    if (created === undefined) throw new Error("Subscription cleanup was not created.");
    return Values.read(created, cleanupId, this.#maxRecordBytes) as Cleanup;
  }
  async #clean(claimed: Cleanup, nowMs: number): Promise<void> {
    let control = claimed;
    const limit = this.#cleanupBatchSize + 2;
    const rows = await this.#storage.queryEntries({
      sort: [{ field: "id" }],
      ...(control.afterId === undefined
        ? {}
        : {
            after: {
              id: control.afterId,
              values: [{ field: "id", value: control.afterId }],
            },
          }),
      limit,
    });
    let processed = 0;
    for (const row of rows) {
      if (row.id === quotaId || row.id === cleanupId) {
        control = await this.#advanceClean(control, row.id, false);
        continue;
      }
      control = await this.#renewCleanup(control, nowMs);
      const heartbeat = this.#heartbeatCleanup(control, nowMs);
      try {
        await this.#cleanBinding(row.id, nowMs, heartbeat.signal);
      } finally {
        control = await heartbeat.stop();
      }
      control = await this.#shortenCleanup(control, nowMs);
      processed += 1;
      control = await this.#advanceClean(control, row.id, false);
      if (processed === this.#cleanupBatchSize) return;
    }
    await this.#advanceClean(control, undefined, rows.length < limit);
  }
  async #cleanBinding(id: string, nowMs: number, signal: AbortSignal): Promise<void> {
    const row = await this.#storage.read(id);
    if (row === undefined) return;
    let binding: Binding;
    try {
      binding = Values.read(row, id, this.#maxRecordBytes) as Binding;
    } catch {
      return;
    }
    if (binding.lifecycle === "reserved" && (binding.reservationUntilMs ?? 0) <= nowMs) {
      this.#forgetReservation(binding.id, binding.admissionToken);
      await this.#release(binding.id, binding.admissionToken);
      return;
    }
    if (binding.lifecycle === "retired") {
      await this.#release(binding.id, binding.admissionToken);
      return;
    }
    if (
      (["inactive", "active"].includes(binding.lifecycle) && (binding.expiresAtMs ?? 0) <= nowMs) ||
      (binding.lifecycle === "cancelling" && (binding.leaseUntilMs ?? 0) <= nowMs)
    )
      await this.#cancelExpired(binding, row, nowMs, signal);
  }
  #heartbeatCleanup(
    initial: Cleanup,
    nowMs: number,
  ): {
    readonly signal: AbortSignal;
    stop(): Promise<Cleanup>;
  } {
    const controller = new AbortController();
    this.#cleanupControllers.add(controller);
    let current = initial;
    let stopped = false;
    let renewal = Promise.resolve();
    const renew = () => {
      renewal = renewal.then(async () => {
        if (stopped || controller.signal.aborted) return;
        current = await this.#renewCleanup(
          current,
          Math.max(nowMs, (current.leaseUntilMs ?? nowMs) - 1),
        );
      });
      void renewal.catch(() => {
        controller.abort();
      });
    };
    const timer = setInterval(renew, Math.max(1, Math.floor(this.#leaseMs / 2)));
    return {
      signal: controller.signal,
      stop: async () => {
        stopped = true;
        clearInterval(timer);
        await renewal;
        this.#cleanupControllers.delete(controller);
        return current;
      },
    };
  }
  async #renewCleanup(expected: Cleanup, nowMs: number): Promise<Cleanup> {
    const current = await this.#cleanup();
    if (
      current.ownerId !== this.#owner ||
      current.fence !== expected.fence ||
      (current.leaseUntilMs ?? 0) <= nowMs
    )
      throw new Error("Subscription cleanup lost its durable lease.");
    const next: Cleanup = {
      ...current,
      revision: current.revision + 1,
      leaseUntilMs: this.#until(Math.max(nowMs, current.leaseUntilMs ?? nowMs)),
    };
    if (await this.#replaceCleanup(current, next)) return next;
    const reread = await this.#cleanup();
    if (this.#sameCleanup(reread, next)) return reread;
    throw new Error("Subscription cleanup lost its durable lease.");
  }
  async #shortenCleanup(expected: Cleanup, nowMs: number): Promise<Cleanup> {
    const current = await this.#cleanup();
    if (current.ownerId !== this.#owner || current.fence !== expected.fence)
      throw new Error("Subscription cleanup lost its durable lease.");
    const next: Cleanup = {
      ...current,
      revision: current.revision + 1,
      leaseUntilMs: this.#until(nowMs),
    };
    if (await this.#replaceCleanup(current, next)) return next;
    const reread = await this.#cleanup();
    if (this.#sameCleanup(reread, next)) return reread;
    throw new Error("Subscription cleanup lost its durable lease.");
  }
  async #cancelExpired(old: Binding, row: Any, nowMs: number, signal: AbortSignal): Promise<void> {
    const next = this.#work(old, "cancelling", nowMs, "expired");
    if (!(await this.#cas(old.id, row, Values.write(next, this.#maxRecordBytes)))) {
      const reread = await this.#storage.read(old.id);
      if (reread === undefined || !this.#sameBinding(reread, next)) return;
    }
    await this.#dispose(Values.envelope(next), signal, () =>
      this.#current(next.id, next.fence, "cancelling", nowMs),
    );
    await this.#retire(next);
  }
  async #finalizeActivation(active: Binding, nowMs: number): Promise<void> {
    const row = await this.#storage.read(active.id);
    if (row === undefined) return;
    const current = Values.read(row, active.id, this.#maxRecordBytes) as Binding;
    if (
      current.lifecycle !== "active" ||
      current.ownerId !== this.#owner ||
      current.fence !== active.fence ||
      (current.leaseUntilMs ?? 0) <= nowMs
    )
      return;
    const cancelling = this.#work(current, "cancelling", nowMs, "activation-end");
    if (!(await this.#cas(active.id, row, Values.write(cancelling, this.#maxRecordBytes)))) {
      const reread = await this.#storage.read(active.id);
      if (reread === undefined || !this.#sameBinding(reread, cancelling)) return;
    }
    try {
      await this.#dispose(Values.envelope(cancelling), new AbortController().signal, () =>
        this.#current(cancelling.id, cancelling.fence, "cancelling", nowMs),
      );
    } catch {
      return;
    }
    await this.#retire(cancelling);
  }
  async #retire(expected: Binding): Promise<void> {
    const row = await this.#storage.read(expected.id);
    if (row === undefined) return;
    const current = Values.read(row, expected.id, this.#maxRecordBytes) as Binding;
    if (
      current.lifecycle !== "cancelling" ||
      current.ownerId !== this.#owner ||
      current.fence !== expected.fence
    )
      return;
    const retired: Binding = {
      family: "binding",
      id: current.id,
      revision: current.revision + 1,
      admissionToken: current.admissionToken,
      lifecycle: "retired",
      fence: current.fence,
    };
    if (!(await this.#cas(expected.id, row, Values.write(retired, this.#maxRecordBytes)))) {
      const reread = await this.#storage.read(expected.id);
      if (reread === undefined || !this.#sameBinding(reread, retired)) return;
    }
    await this.#release(retired.id, retired.admissionToken);
  }
  async #advanceClean(
    expected: Cleanup,
    afterId: string | undefined,
    reset: boolean,
  ): Promise<Cleanup> {
    const continuedAfterId = afterId ?? expected.afterId;
    const next: Cleanup = {
      family: "cleanup",
      id: cleanupId,
      revision: expected.revision + 1,
      fence: expected.fence,
      ownerId: this.#owner,
      leaseUntilMs: expected.leaseUntilMs,
      failureCount: reset ? 0 : expected.failureCount,
      retryAfterMs: 0,
      ...(reset || continuedAfterId === undefined ? {} : { afterId: continuedAfterId }),
    };
    if (await this.#replaceCleanup(expected, next)) return next;
    const reread = await this.#cleanup();
    if (this.#sameCleanup(reread, next)) return reread;
    throw new Error("Subscription cleanup lost its durable lease.");
  }
  async #failClean(expected: Cleanup, nowMs: number): Promise<void> {
    const current = await this.#cleanup();
    if (current.ownerId !== this.#owner || current.fence !== expected.fence) return;
    const failureCount = Math.min(31, current.failureCount + 1);
    const multiplier = 2 ** Math.min(4, failureCount - 1);
    const delay = Math.min(Number.MAX_SAFE_INTEGER - nowMs, this.#leaseMs * multiplier);
    const next: Cleanup = {
      family: "cleanup",
      id: cleanupId,
      revision: current.revision + 1,
      fence: current.fence,
      failureCount,
      retryAfterMs: nowMs + delay,
      afterId: current.afterId,
    };
    if (await this.#replaceCleanup(current, next)) return;
    const reread = await this.#cleanup();
    if (!this.#sameCleanup(reread, next)) return;
  }
  async #quota(): Promise<Quota> {
    const row = await this.#storage.read(quotaId);
    if (row !== undefined) return Values.read(row, quotaId, this.#maxRecordBytes) as Quota;
    const fresh: Quota = { family: "quota", id: quotaId, revision: 1, used: 0 };
    const encoded = Values.write(fresh, this.#maxRecordBytes);
    try {
      await this.#storage.compareAndSet(quotaId, undefined, encoded);
    } catch {
      // A provider may apply an atomic mutation before its request reports a
      // transport failure. The exact durable row below is the authority.
    }
    const created = await this.#storage.read(quotaId);
    if (created === undefined) throw new Error("Subscription quota was not created.");
    return Values.read(created, quotaId, this.#maxRecordBytes) as Quota;
  }
  async #repair(): Promise<void> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const quota = await this.#quota();
      if (quota.operation === undefined) {
        const staged: Quota = {
          ...quota,
          revision: quota.revision + 1,
          operation: { kind: "repair", operationId: crypto.randomUUID(), count: 0 },
        };
        await this.#replaceQuota(quota, staged);
        continue;
      }
      const operation = quota.operation;
      if (operation.kind !== "repair") return this.#complete(quota);
      const page = await this.#storage.queryEntries({
        sort: [{ field: "id" }],
        ...(operation.afterId === undefined
          ? {}
          : {
              after: { id: operation.afterId, values: [{ field: "id", value: operation.afterId }] },
            }),
        limit: this.#cleanupBatchSize,
      });
      const data = page.filter((entry) => entry.id !== quotaId && entry.id !== cleanupId);
      const count = (operation.count ?? 0) + data.length;
      const afterId = page.at(-1)?.id;
      const completed = page.length < this.#cleanupBatchSize;
      const next: Quota = completed
        ? { family: "quota", id: quotaId, revision: quota.revision + 1, used: count }
        : {
            family: "quota",
            id: quotaId,
            revision: quota.revision + 1,
            used: quota.used,
            operation: {
              kind: "repair",
              operationId: operation.operationId,
              count,
              afterId,
            },
          };
      if (await this.#replaceQuota(quota, next)) {
        if (completed) return;
        continue;
      }
      const reread = await this.#quota();
      if (reread.operation === undefined) return;
      if (reread.operation.operationId !== operation.operationId) continue;
    }
    throw new Error("Subscription quota repair did not converge.");
  }
  async #complete(quota: Quota): Promise<void> {
    const operation = quota.operation;
    if (operation === undefined) return;
    if (operation.kind === "repair") return this.#repair();
    if (operation.bindingId === undefined || operation.token === undefined)
      throw new Error("Subscription quota operation is invalid.");
    const { bindingId: id, token } = operation;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const current = await this.#quota();
      if (current.operation === undefined) return;
      if (current.operation.operationId !== operation.operationId) continue;
      const row = await this.#storage.read(id);
      if (operation.kind === "reserve") {
        if (row === undefined) {
          const slot: Binding = {
            family: "binding",
            id,
            revision: 1,
            admissionToken: token,
            lifecycle: "reserved",
            fence: 0,
            reservationOwner: this.#owner,
            reservationUntilMs: this.#until(Date.now()),
          };
          await this.#cas(id, undefined, Values.write(slot, this.#maxRecordBytes));
          continue;
        }
        const slot = Values.read(row, id, this.#maxRecordBytes) as Binding;
        if (slot.admissionToken !== token) throw new Error("binding-capacity-exceeded");
        const done: Quota = {
          family: "quota",
          id: quotaId,
          revision: current.revision + 1,
          used: current.used + 1,
        };
        if (await this.#replaceQuota(current, done)) return;
      } else {
        if (row !== undefined) {
          const slot = Values.read(row, id, this.#maxRecordBytes) as Binding;
          if (slot.admissionToken !== token || !["reserved", "retired"].includes(slot.lifecycle))
            return;
          await this.#cas(id, row, undefined);
          continue;
        }
        const done: Quota = {
          family: "quota",
          id: quotaId,
          revision: current.revision + 1,
          used: Math.max(0, current.used - 1),
        };
        if (await this.#replaceQuota(current, done)) return;
      }
    }
    throw new Error("Subscription quota operation did not converge.");
  }
  async #slot(id: string, token: string): Promise<Binding | undefined> {
    const row = await this.#storage.read(id);
    if (row === undefined) return undefined;
    const binding = Values.read(row, id, this.#maxRecordBytes) as Binding;
    return binding.lifecycle === "reserved" && binding.admissionToken === token
      ? binding
      : undefined;
  }
  #sameBinding(record: Any, expected: Binding): boolean {
    try {
      const actual = Values.read(record, expected.id, this.#maxRecordBytes) as Binding;
      return (
        actual.revision === expected.revision &&
        actual.admissionToken === expected.admissionToken &&
        actual.lifecycle === expected.lifecycle &&
        actual.fence === expected.fence &&
        actual.ownerId === expected.ownerId &&
        actual.leaseUntilMs === expected.leaseUntilMs &&
        actual.reason === expected.reason &&
        actual.backend === expected.backend &&
        actual.backendBytes === expected.backendBytes &&
        actual.expiresAtMs === expected.expiresAtMs &&
        actual.principalFingerprint === expected.principalFingerprint &&
        actual.topology === expected.topology &&
        actual.tenant === expected.tenant
      );
    } catch {
      return false;
    }
  }
  #sameCleanup(actual: Cleanup, expected: Cleanup): boolean {
    return (
      actual.revision === expected.revision &&
      actual.ownerId === expected.ownerId &&
      actual.fence === expected.fence &&
      actual.afterId === expected.afterId &&
      actual.retryAfterMs === expected.retryAfterMs
    );
  }
  async #replaceQuota(expected: Quota, next: Quota): Promise<boolean> {
    return this.#cas(
      quotaId,
      Values.write(expected, this.#maxRecordBytes),
      Values.write(next, this.#maxRecordBytes),
    );
  }
  async #replaceCleanup(expected: Cleanup, next: Cleanup): Promise<boolean> {
    return this.#cas(
      cleanupId,
      Values.write(expected, this.#maxRecordBytes),
      Values.write(next, this.#maxRecordBytes),
    );
  }
  async #cas(id: string, expected: Any | undefined, next: Any | undefined): Promise<boolean> {
    try {
      return await this.#storage.compareAndSet(id, expected, next);
    } catch {
      return false;
    }
  }
  #owned(
    binding: Binding,
    input: {
      readonly principalFingerprint: string;
      readonly topology?: string;
      readonly tenant: string | undefined;
      readonly nowMs: number;
    },
  ): boolean {
    return (
      binding.principalFingerprint === input.principalFingerprint &&
      binding.topology === (input.topology ?? "legacy") &&
      binding.tenant === input.tenant &&
      (binding.expiresAtMs ?? 0) > input.nowMs
    );
  }
  #open(): void {
    if (this.#closed) throw new Error("subscription bindings are closed");
  }
}

/**
 * Checks whether bindings are backed by durable coordination storage.
 *
 * @param value Supplies the optional binding store.
 * @returns Whether the store uses durable coordination storage.
 */
export function isDurableSubscriptionBindings(
  value: SubscriptionBindings | undefined,
): value is SubscriptionBindings & { readonly durable: true } {
  return value !== undefined && "durable" in value && value.durable === true;
}

/**
 * Validates durable registry records for tests and adapters.
 *
 * @internal
 */
export const DurableSubscriptionBindingRecords: Readonly<{
  validate(record: Any, expectedId?: string, maxBytes?: number): void;
}> = Object.freeze({
  validate(record: Any, expectedId?: string, maxBytes: number = Number.MAX_SAFE_INTEGER): void {
    Values.read(record, expectedId, maxBytes);
  },
});

const Values = Object.freeze({
  options(options: DurableSubscriptionBindingsOptions): void {
    for (const value of [
      options.leaseMs,
      options.cleanupBatchSize,
      options.recordLimit,
      options.maxRecordBytes,
    ])
      if (!Number.isSafeInteger(value) || value <= 0)
        throw new Error("Subscription registry options must be positive safe integers.");
    if (!options.namespace.trim())
      throw new Error("Subscription registry namespace must be non-blank.");
  },
  input(input: {
    readonly backend: BackendSubscriptionEnvelope;
    readonly principalFingerprint: string;
    readonly expiresAtMs: number;
  }): void {
    if (!input.principalFingerprint.trim() || input.backend.bytes.byteLength === 0)
      throw new Error("subscription owner and backend are required");
    this.time(input.expiresAtMs);
  },
  time(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("Subscription time must be a safe integer.");
  },
  publicId(value: string): boolean {
    return value.trim().length > 0 && !value.startsWith("!");
  },
  base64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("base64");
  },
  envelope(binding: Binding): BackendSubscriptionEnvelope {
    return {
      kind: "backend-subscription-envelope",
      bytes: Uint8Array.from(Buffer.from(String(binding.backend), "base64")),
    };
  },
  id(record: Any): string {
    return this.read(record, undefined, Number.MAX_SAFE_INTEGER).id;
  },
  write(value: Stored, maxBytes: number): Any {
    const typeUrl =
      value.family === "binding" ? bindingType : value.family === "quota" ? quotaType : cleanupType;
    const record = create(AnySchema, {
      typeUrl,
      value: new TextEncoder().encode(
        JSON.stringify({ version: value.family === "binding" ? 4 : 1, ...value }),
      ),
    });
    if (record.value.byteLength > maxBytes) throw new Error("backend-envelope-too-large");
    return record;
  },
  read(record: Any, expectedId: string | undefined, maxBytes: number): Stored {
    if (record.value.byteLength > maxBytes)
      throw new Error("Durable subscription registry record is invalid.");
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(record.value));
    } catch {
      throw new Error("Durable subscription registry record is invalid.");
    }
    if (value === null || typeof value !== "object")
      throw new Error("Durable subscription registry record is invalid.");
    const source = value as Record<string, unknown>;
    const family = source.family;
    const valid =
      (family === "binding" && record.typeUrl === bindingType && source.version === 4) ||
      (family === "quota" && record.typeUrl === quotaType && source.version === 1) ||
      (family === "cleanup" && record.typeUrl === cleanupType && source.version === 1);
    if (
      !valid ||
      typeof source.id !== "string" ||
      (source.id !== expectedId && expectedId !== undefined) ||
      !Number.isSafeInteger(source.revision) ||
      (source.revision as number) < 1
    )
      throw new Error("Durable subscription registry record is invalid.");
    if (family === "quota") {
      if (
        source.id !== quotaId ||
        !Number.isSafeInteger(source.used) ||
        (source.used as number) < 0
      )
        throw new Error("Durable subscription registry record is invalid.");
      return source as unknown as Quota;
    }
    if (family === "cleanup") {
      if (
        source.id !== cleanupId ||
        !Number.isSafeInteger(source.fence) ||
        (source.fence as number) < 0 ||
        !Number.isSafeInteger(source.failureCount) ||
        (source.failureCount as number) < 0 ||
        !Number.isSafeInteger(source.retryAfterMs) ||
        (source.retryAfterMs as number) < 0
      )
        throw new Error("Durable subscription registry record is invalid.");
      return source as unknown as Cleanup;
    }
    if (
      !this.publicId(source.id) ||
      !this.publicId(source.admissionToken as string) ||
      !["reserved", "inactive", "active", "cancelling", "retired"].includes(
        source.lifecycle as string,
      ) ||
      !Number.isSafeInteger(source.fence) ||
      (source.fence as number) < 0
    )
      throw new Error("Durable subscription registry record is invalid.");
    const binding = source as unknown as Binding;
    if (["inactive", "active", "cancelling"].includes(binding.lifecycle)) {
      if (
        !binding.principalFingerprint ||
        !binding.backend ||
        !Number.isSafeInteger(binding.backendBytes) ||
        Buffer.from(binding.backend, "base64").toString("base64") !== binding.backend ||
        Buffer.byteLength(binding.backend, "base64") !== binding.backendBytes ||
        !Number.isSafeInteger(binding.expiresAtMs)
      )
        throw new Error("Durable subscription registry record is invalid.");
    }
    if (
      ["active", "cancelling"].includes(binding.lifecycle) &&
      (!binding.ownerId || !Number.isSafeInteger(binding.leaseUntilMs))
    )
      throw new Error("Durable subscription registry record is invalid.");
    if (
      binding.lifecycle === "retired" &&
      (binding.backend !== undefined || binding.principalFingerprint !== undefined)
    )
      throw new Error("Durable subscription registry record is invalid.");
    return binding;
  },
});
