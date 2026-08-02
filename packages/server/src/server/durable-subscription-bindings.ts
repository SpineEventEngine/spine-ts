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
  readonly storageFactory: StorageFactory;
  readonly namespace: string;
  readonly nextId: () => string;
  readonly dispose: OnBackendSubscription;
  readonly leaseMs: number;
  readonly cleanupBatchSize: number;
  readonly recordLimit: number;
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
  readonly tenant?: string;
  readonly expiresAtMs?: number;
  readonly backend?: string;
  readonly backendBytes?: number;
  readonly ownerId?: string;
  readonly leaseUntilMs?: number;
  readonly reason?: "client" | "activation-end" | "expired";
}
interface Quota {
  readonly family: "quota";
  readonly id: typeof quotaId;
  readonly revision: number;
  readonly used: number;
  readonly operation?: {
    readonly kind: "repair";
    readonly afterId?: string;
    readonly count: number;
  };
}
interface Cleanup {
  readonly family: "cleanup";
  readonly id: typeof cleanupId;
  readonly revision: number;
  readonly ownerId?: string;
  readonly fence: number;
  readonly leaseUntilMs?: number;
  readonly afterId?: string;
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
  readonly durable = true;
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
    { id: string; token: string }
  >();
  readonly #active = new Map<
    string,
    { controller: AbortController; timer: ReturnType<typeof setTimeout>; fence: number }
  >();
  #closed = false;

  /**
   * Opens a registry handle without taking ownership of the supplied factory.
   *
   * @param options Supplies finite storage, lease, and cleanup collaborators.
   */
  constructor(options: DurableSubscriptionBindingsOptions) {
    Values.options(options);
    this.#dispose = options.dispose;
    this.#nextId = options.nextId;
    this.#leaseMs = options.leaseMs;
    this.#cleanupBatchSize = options.cleanupBatchSize;
    this.#recordLimit = options.recordLimit;
    this.#maxRecordBytes = options.maxRecordBytes;
    this.#storage = options.storageFactory.createRecordStorage(
      { name: `spine.gateway.${options.namespace}`, multitenant: false },
      new RecordSpec({
        schema: AnySchema,
        storageKey: "spine.gateway.SubscriptionBinding:v2",
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
   * Reserves one namespace-global slot and preallocates its public identifier.
   *
   * @returns Resolves to an asynchronously releasable reservation.
   */
  async reserveCapacity(): Promise<SubscriptionCapacityReservation> {
    this.#open();
    const existing = await this.#storage.queryEntries({ limit: this.#recordLimit + 2 });
    for (const row of existing) Values.read(row.record, row.id, this.#maxRecordBytes);
    for (let count = 0; count < attempts; count += 1) {
      const quota = await this.#quota();
      if (quota.operation !== undefined) {
        await this.#repair();
        continue;
      }
      if (quota.used >= this.#recordLimit) throw new Error("binding-capacity-exceeded");
      const id = this.#nextId();
      if (!Values.publicId(id)) throw new Error("subscription ID must be unique");
      const token = crypto.randomUUID();
      const binding: Binding = {
        family: "binding",
        id,
        revision: 1,
        admissionToken: token,
        lifecycle: "reserved",
        fence: 0,
        reservationOwner: this.#owner,
        reservationUntilMs: Number.MAX_SAFE_INTEGER,
      };
      if (
        !(await this.#storage.compareAndSet(
          id,
          undefined,
          Values.write(binding, this.#maxRecordBytes),
        ))
      )
        continue;
      const next: Quota = { ...quota, revision: quota.revision + 1, used: quota.used + 1 };
      if (
        !(await this.#storage.compareAndSet(
          quotaId,
          Values.write(quota, this.#maxRecordBytes),
          Values.write(next, this.#maxRecordBytes),
        ))
      ) {
        await this.#repair();
      }
      let released = false;
      const reservation: SubscriptionCapacityReservation = {
        release: async () => {
          if (released) return;
          released = true;
          this.#reservations.delete(reservation);
          await this.#release(id, token);
        },
      };
      this.#reservations.set(reservation, { id, token });
      return reservation;
    }
    throw new Error("binding-capacity-exceeded");
  }

  /**
   * Converts an owned reserved slot to an inactive private binding.
   */
  async create(input: {
    readonly backend: BackendSubscriptionEnvelope;
    readonly principalFingerprint: string;
    readonly tenant: string | undefined;
    readonly expiresAtMs: number;
    readonly reservation?: SubscriptionCapacityReservation;
  }): Promise<{ readonly id: string }> {
    this.#open();
    Values.input(input);
    const supplied =
      input.reservation === undefined ? undefined : this.#reservations.get(input.reservation);
    const reservation = supplied === undefined ? await this.reserveCapacity() : input.reservation!;
    const held = this.#reservations.get(reservation);
    if (held === undefined) throw new Error("binding-capacity-exceeded");
    const row = await this.#storage.read(held.id);
    const old =
      row === undefined ? undefined : (Values.read(row, held.id, this.#maxRecordBytes) as Binding);
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
      ...(input.tenant === undefined ? {} : { tenant: input.tenant }),
      expiresAtMs: input.expiresAtMs,
      backend: Values.base64(input.backend.bytes),
      backendBytes: input.backend.bytes.byteLength,
    };
    if (!(await this.#storage.compareAndSet(old.id, row, Values.write(next, this.#maxRecordBytes))))
      throw new Error("binding-capacity-exceeded");
    this.#reservations.delete(reservation);
    return Object.freeze({ id: old.id });
  }

  /**
   * Claims a finite lease before running one backend activation callback.
   */
  async activate(input: {
    readonly id: string;
    readonly principalFingerprint: string;
    readonly tenant: string | undefined;
    readonly nowMs: number;
    readonly onBackend: OnBackendSubscription;
    readonly signal: AbortSignal;
  }): Promise<SubscriptionBindingTransition> {
    if (input.signal.aborted) return { kind: "denied" };
    const claimed = await this.#claim(input, "active");
    if (claimed === undefined) return { kind: "denied" };
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () => void this.#renew(input.id, claimed.fence, controller),
      Math.max(1, Math.floor(this.#leaseMs / 2)),
    );
    this.#active.set(input.id, { controller, timer, fence: claimed.fence });
    try {
      await input.onBackend(Values.envelope(claimed), controller.signal, () =>
        this.#current(input.id, claimed.fence, "active", Date.now()),
      );
      return (await this.#current(input.id, claimed.fence, "active", input.nowMs))
        ? { kind: "activated" }
        : { kind: "denied" };
    } finally {
      clearTimeout(timer);
      this.#active.delete(input.id);
      input.signal.removeEventListener("abort", abort);
    }
  }

  /**
   * Fences cancellation before invoking the backend cleanup callback.
   */
  async cancel(input: {
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
    if (old.lifecycle === "active") this.#active.get(input.id)?.controller.abort();
    const next = this.#work(old, "cancelling", input.nowMs, "client");
    if (
      !(await this.#storage.compareAndSet(input.id, row, Values.write(next, this.#maxRecordBytes)))
    )
      return { kind: "denied" };
    try {
      await input.onBackend(Values.envelope(next), new AbortController().signal);
    } catch {
      return { kind: "denied" };
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
    if (
      !(await this.#storage.compareAndSet(
        input.id,
        current,
        Values.write(retired, this.#maxRecordBytes),
      ))
    )
      return { kind: "denied" };
    await this.#release(retired.id, retired.admissionToken);
    return { kind: "closed" };
  }

  /**
   * Cleans a finite page of expired reservations and bindings.
   */
  async purgeExpired(nowMs: number): Promise<void> {
    this.#open();
    Values.time(nowMs);
    const rows = await this.#storage.queryEntries({
      sort: [{ field: "id" }],
      limit: this.#cleanupBatchSize,
    });
    for (const row of rows) {
      if (row.id === quotaId || row.id === cleanupId) continue;
      let binding: Binding;
      try {
        binding = Values.read(row.record, row.id, this.#maxRecordBytes) as Binding;
      } catch {
        continue;
      }
      if (binding.lifecycle === "reserved" && (binding.reservationUntilMs ?? 0) <= nowMs)
        await this.#release(binding.id, binding.admissionToken);
      else if (binding.lifecycle === "inactive" && (binding.expiresAtMs ?? 0) <= nowMs) {
        if (await this.#storage.compareAndSet(binding.id, row.record, undefined))
          await this.#release(binding.id, binding.admissionToken);
      }
    }
  }

  /**
   * Stops local work without removing durable rows needed by a later handle.
   */
  async close(): Promise<void> {
    this.#closed = true;
    for (const active of this.#active.values()) {
      clearTimeout(active.timer);
      active.controller.abort();
    }
    this.#active.clear();
    this.#reservations.clear();
    this.#storage.close();
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
    return (await this.#storage.compareAndSet(
      input.id,
      row,
      Values.write(next, this.#maxRecordBytes),
    ))
      ? next
      : undefined;
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
      leaseUntilMs: nowMs + this.#leaseMs,
      ...(reason === undefined ? {} : { reason }),
    };
  }
  async #renew(id: string, fence: number, controller: AbortController): Promise<void> {
    const row = await this.#storage.read(id);
    if (row === undefined) return controller.abort();
    const old = Values.read(row, id, this.#maxRecordBytes) as Binding;
    if (old.lifecycle !== "active" || old.ownerId !== this.#owner || old.fence !== fence)
      return controller.abort();
    const next = { ...old, revision: old.revision + 1, leaseUntilMs: Date.now() + this.#leaseMs };
    if (!(await this.#storage.compareAndSet(id, row, Values.write(next, this.#maxRecordBytes))))
      controller.abort();
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
      (value.leaseUntilMs ?? 0) > nowMs
    );
  }
  async #release(id: string, token: string): Promise<void> {
    for (let count = 0; count < attempts; count += 1) {
      const row = await this.#storage.read(id);
      if (row !== undefined) {
        const binding = Values.read(row, id, this.#maxRecordBytes) as Binding;
        if (
          binding.admissionToken !== token ||
          !["reserved", "retired"].includes(binding.lifecycle)
        )
          return;
        if (!(await this.#storage.compareAndSet(id, row, undefined))) continue;
      }
      const quota = await this.#quota();
      if (quota.operation !== undefined) {
        await this.#repair();
        continue;
      }
      const next = { ...quota, revision: quota.revision + 1, used: Math.max(0, quota.used - 1) };
      if (
        await this.#storage.compareAndSet(
          quotaId,
          Values.write(quota, this.#maxRecordBytes),
          Values.write(next, this.#maxRecordBytes),
        )
      )
        return;
    }
  }
  async #quota(): Promise<Quota> {
    const row = await this.#storage.read(quotaId);
    if (row !== undefined) return Values.read(row, quotaId, this.#maxRecordBytes) as Quota;
    const fresh: Quota = { family: "quota", id: quotaId, revision: 1, used: 0 };
    await this.#storage.compareAndSet(
      quotaId,
      undefined,
      Values.write(fresh, this.#maxRecordBytes),
    );
    const created = await this.#storage.read(quotaId);
    if (created === undefined) throw new Error("Subscription quota was not created.");
    return Values.read(created, quotaId, this.#maxRecordBytes) as Quota;
  }
  async #repair(): Promise<void> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const quota = await this.#quota();
      const operation = quota.operation ?? { kind: "repair" as const, count: 0 };
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
      const count = operation.count + data.length;
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
              count,
              ...(afterId === undefined ? {} : { afterId }),
            },
          };
      if (
        await this.#storage.compareAndSet(
          quotaId,
          Values.write(quota, this.#maxRecordBytes),
          Values.write(next, this.#maxRecordBytes),
        )
      ) {
        if (completed) return;
        continue;
      }
    }
    throw new Error("Subscription quota repair did not converge.");
  }
  #owned(
    binding: Binding,
    input: {
      readonly principalFingerprint: string;
      readonly tenant: string | undefined;
      readonly nowMs: number;
    },
  ): boolean {
    return (
      binding.principalFingerprint === input.principalFingerprint &&
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
 */
export function isDurableSubscriptionBindings(
  value: SubscriptionBindings | undefined,
): value is SubscriptionBindings & { readonly durable: true } {
  return value !== undefined && "durable" in value && value.durable === true;
}

/** @internal */
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
      bytes: Uint8Array.from(Buffer.from(binding.backend ?? "", "base64")),
    };
  },
  id(record: Any): string {
    return (this.read(record, undefined, Number.MAX_SAFE_INTEGER) as Stored).id;
  },
  write(value: Stored, maxBytes: number): Any {
    const typeUrl =
      value.family === "binding" ? bindingType : value.family === "quota" ? quotaType : cleanupType;
    const record = create(AnySchema, {
      typeUrl,
      value: new TextEncoder().encode(
        JSON.stringify({ version: value.family === "binding" ? 2 : 1, ...value }),
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
      (family === "binding" && record.typeUrl === bindingType && source.version === 2) ||
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
        !Number.isSafeInteger(source.failureCount) ||
        !Number.isSafeInteger(source.retryAfterMs)
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
