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

const recordVersion = 1;
const recordTypeUrl = "type.spine-event-engine.gateway/DurableSubscriptionBinding";
const registryStorageKey = "spine.gateway.SubscriptionBinding:v1";

/**
 * Configures a durable browser-subscription registry.
 */
export interface DurableSubscriptionBindingsOptions {
  // prettier-ignore

  /**
   * Supplies the independently owned registry storage factory.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Identifies the application-local registry namespace.
   */
  readonly namespace: string;

  // prettier-ignore

  /**
   * Creates unique public subscription identifiers.
   *
   * @returns A unique public subscription identifier.
   */
  readonly nextId: () => string;

  /**
   * Disposes a private backend envelope after cancellation or expiry.
   */
  readonly dispose: OnBackendSubscription;

  /**
   * Limits one future ownership lease in milliseconds.
   */
  readonly leaseMs: number;

  /**
   * Limits one future expired-record cleanup batch.
   */
  readonly cleanupBatchSize: number;

  /**
   * Limits records admitted by this registry instance.
   */
  readonly recordLimit: number;

  /**
   * Limits encoded private records in bytes.
   */
  readonly maxRecordBytes: number;
}

/**
 * Stores private browser-subscription bindings in a supplied record store.
 *
 * The registry preserves bindings through one gateway restart. Later gateway
 * coordination extends this contract without changing the stored public ID.
 */
export class DurableSubscriptionBindings implements SubscriptionBindings {
  // prettier-ignore

  /**
   * Identifies durable registry capability for production host admission.
   */
  readonly durable = true;
  readonly #dispose: OnBackendSubscription;
  readonly #cleanupBatchSize: number;
  readonly #maxRecordBytes: number;
  readonly #nextId: () => string;
  readonly #recordLimit: number;
  readonly #storage: RecordStorage<string, Any>;
  readonly #reservations = new Set<SubscriptionCapacityReservation>();
  #closed = false;

  /**
   * Opens one namespaced registry handle without taking ownership of its factory.
   *
   * @param options Supplies bounded storage, identity, and disposal collaborators.
   */
  constructor(options: DurableSubscriptionBindingsOptions) {
    DurableBindingValues.options(options);
    this.#dispose = options.dispose;
    this.#cleanupBatchSize = options.cleanupBatchSize;
    this.#maxRecordBytes = options.maxRecordBytes;
    this.#nextId = options.nextId;
    this.#recordLimit = options.recordLimit;
    this.#storage = options.storageFactory.createRecordStorage(
      { name: `spine.gateway.${options.namespace}`, multitenant: false },
      DurableBindingValues.spec(options.maxRecordBytes),
    );
    if (!this.#storage.atomicCompareAndSet) {
      this.#storage.close();
      throw new Error("Subscription registry storage requires atomic compare-and-set.");
    }
  }

  // prettier-ignore

  /**
   * Acquires one local admission slot for a pending backend Subscribe operation.
   *
   * @returns Resolves to an exactly-once releasable reservation.
   */
  async reserveCapacity(): Promise<SubscriptionCapacityReservation> {
    this.#requireOpen();
    const records = await this.#storage.queryEntries({ limit: this.#recordLimit + 1 });
    if (records.length + this.#reservations.size >= this.#recordLimit)
      throw new Error("binding-capacity-exceeded");
    let released = false;
    const reservation: SubscriptionCapacityReservation = {
      release: () => {
        if (released) return;
        released = true;
        this.#reservations.delete(reservation);
      },
    };
    this.#reservations.add(reservation);
    return reservation;
  }

  /**
   * Creates one inactive private binding.
   *
   * @param input Supplies the backend envelope and mandatory owner facts.
   * @returns Resolves to the public binding identifier.
   */
  async create(input: {
    readonly backend: BackendSubscriptionEnvelope;
    readonly principalFingerprint: string;
    readonly tenant: string | undefined;
    readonly expiresAtMs: number;
    readonly reservation?: SubscriptionCapacityReservation;
  }): Promise<{ readonly id: string }> {
    this.#requireOpen();
    DurableBindingValues.createInput(input);
    const reservation = this.#reservation(input.reservation) ?? (await this.reserveCapacity());
    try {
      const id = this.#nextId();
      if (!DurableBindingValues.token(id)) throw new Error("subscription ID must be unique");
      const record = DurableBindingValues.write({
        id,
        backend: input.backend.bytes,
        principalFingerprint: input.principalFingerprint,
        tenant: input.tenant,
        expiresAtMs: input.expiresAtMs,
        lifecycle: "inactive",
        leaseUntilMs: 0,
        cancellationFence: 0,
        version: recordVersion,
      });
      if (record.value.byteLength > this.#maxRecordBytes)
        throw new Error("backend-envelope-too-large");
      if (!(await this.#storage.compareAndSet(id, undefined, record)))
        throw new Error("subscription ID must be unique");
      return Object.freeze({ id });
    } finally {
      reservation.release();
    }
  }

  /**
   * Activates one currently owned inactive binding.
   *
   * @param input Supplies public identity, mandatory ownership facts, and callback.
   * @returns Resolves to the activation transition.
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
    const stored = await this.#owned(input);
    if (stored?.lifecycle !== "inactive") return { kind: "denied" };
    const privateCopy = DurableBindingValues.envelope(stored.backend);
    try {
      await input.onBackend(privateCopy, input.signal);
      return { kind: "activated" };
    } finally {
      privateCopy.bytes.fill(0);
    }
  }

  /**
   * Cancels one currently owned binding and erases its private record.
   *
   * @param input Supplies public identity, mandatory ownership facts, and callback.
   * @returns Resolves to the cancellation transition.
   */
  async cancel(input: {
    readonly id: string;
    readonly principalFingerprint: string;
    readonly tenant: string | undefined;
    readonly nowMs: number;
    readonly onBackend: OnBackendSubscription;
  }): Promise<SubscriptionBindingTransition> {
    const owned = await this.#ownership(input);
    if (owned.kind === "absent") return { kind: "closed" };
    if (owned.kind === "denied") return { kind: "denied" };
    const stored = owned.binding;
    const record = await this.#storage.read(input.id);
    if (record === undefined) return { kind: "closed" };
    const privateCopy = DurableBindingValues.envelope(stored.backend);
    try {
      await input.onBackend(privateCopy, new AbortController().signal);
      if (!(await this.#storage.compareAndSet(input.id, record, undefined)))
        return { kind: "denied" };
      return { kind: "closed" };
    } finally {
      privateCopy.bytes.fill(0);
    }
  }

  /**
   * Removes expired bindings within the configured finite batch bound.
   *
   * @param nowMs Supplies the current Unix time in milliseconds.
   * @returns Resolves after one bounded cleanup pass.
   */
  async purgeExpired(nowMs: number): Promise<void> {
    this.#requireOpen();
    DurableBindingValues.time(nowMs, "Subscription expiry cleanup time");
    const records = await this.#storage.queryEntries({ limit: this.#cleanupBatchSize });
    for (const entry of records) {
      const stored = DurableBindingValues.read(entry.record, entry.id, this.#maxRecordBytes);
      if (stored.expiresAtMs > nowMs) continue;
      if (await this.#storage.compareAndSet(entry.id, entry.record, undefined)) {
        const privateCopy = DurableBindingValues.envelope(stored.backend);
        try {
          await this.#dispose(privateCopy, new AbortController().signal);
        } finally {
          privateCopy.bytes.fill(0);
        }
      }
    }
  }

  /**
   * Closes this registry handle without closing its supplied storage factory.
   *
   * @returns Completes after future registry operations are refused.
   */
  close(): Promise<void> {
    this.#closed = true;
    this.#reservations.clear();
    this.#storage.close();
    return Promise.resolve();
  }

  async #owned(input: {
    readonly id: string;
    readonly principalFingerprint: string;
    readonly tenant: string | undefined;
    readonly nowMs: number;
  }): Promise<StoredBinding | undefined> {
    const ownership = await this.#ownership(input);
    return ownership.kind === "owned" ? ownership.binding : undefined;
  }

  async #ownership(input: {
    readonly id: string;
    readonly principalFingerprint: string;
    readonly tenant: string | undefined;
    readonly nowMs: number;
  }): Promise<BindingOwnership> {
    this.#requireOpen();
    if (!DurableBindingValues.token(input.id)) return { kind: "absent" };
    DurableBindingValues.time(input.nowMs, "Subscription ownership time");
    const record = await this.#storage.read(input.id);
    if (record === undefined) return { kind: "absent" };
    const binding = DurableBindingValues.read(record, input.id, this.#maxRecordBytes);
    if (binding.expiresAtMs <= input.nowMs) return { kind: "absent" };
    if (
      binding.principalFingerprint !== input.principalFingerprint ||
      binding.tenant !== input.tenant
    )
      return { kind: "denied" };
    return { kind: "owned", binding };
  }

  #reservation(
    reservation: SubscriptionCapacityReservation | undefined,
  ): SubscriptionCapacityReservation | undefined {
    return reservation !== undefined && this.#reservations.has(reservation)
      ? reservation
      : undefined;
  }

  #requireOpen(): void {
    if (this.#closed) throw new Error("subscription bindings are closed");
  }
}

// prettier-ignore

/**
 * Determines whether bindings persist beyond one process.
 *
 * @param value Supplies the candidate subscription bindings.
 * @returns Whether the candidate declares durable registry capability.
 */
export function isDurableSubscriptionBindings(
  value: SubscriptionBindings | undefined,
): value is SubscriptionBindings & { readonly durable: true } {
  return value !== undefined && "durable" in value && value.durable === true;
}

/**
 * Validates private gateway records without exposing their backend envelopes.
 *
 * @internal
 */
export const DurableSubscriptionBindingRecords: Readonly<{
  validate(record: Any, expectedId?: string, maxBytes?: number): void;
}> = Object.freeze({
  validate(record: Any, expectedId?: string, maxBytes: number = Number.MAX_SAFE_INTEGER): void {
    DurableBindingValues.read(record, expectedId, maxBytes).backend.fill(0);
  },
});

interface StoredBinding {
  readonly id: string;
  readonly backend: Uint8Array;
  readonly principalFingerprint: string;
  readonly tenant: string | undefined;
  readonly expiresAtMs: number;
  readonly lifecycle: "inactive" | "active" | "closed";
  readonly leaseUntilMs: number;
  readonly cancellationFence: number;
  readonly encodedBytes: number;
  readonly version: number;
}

type BindingOwnership =
  | { readonly kind: "absent" }
  | { readonly kind: "denied" }
  | { readonly kind: "owned"; readonly binding: StoredBinding };

const DurableBindingValues = Object.freeze({
  createInput(input: {
    readonly backend: BackendSubscriptionEnvelope;
    readonly principalFingerprint: string;
    readonly expiresAtMs: number;
  }): void {
    if (!DurableBindingValues.token(input.principalFingerprint))
      throw new Error("subscription owner is required");
    DurableBindingValues.time(input.expiresAtMs, "Subscription expiry");
    if (input.backend.bytes.byteLength === 0) throw new Error("subscription backend is required");
  },
  envelope(bytes: Uint8Array): BackendSubscriptionEnvelope {
    return { kind: "backend-subscription-envelope", bytes: bytes.slice() };
  },
  options(options: DurableSubscriptionBindingsOptions): void {
    if (!DurableBindingValues.token(options.namespace))
      throw new Error("Subscription registry namespace must be non-blank.");
    for (const [name, value] of Object.entries({
      leaseMs: options.leaseMs,
      cleanupBatchSize: options.cleanupBatchSize,
      recordLimit: options.recordLimit,
      maxRecordBytes: options.maxRecordBytes,
    })) {
      if (
        !Number.isSafeInteger(value) ||
        value <= 0 ||
        (name === "recordLimit" && value === Number.MAX_SAFE_INTEGER)
      )
        throw new Error(`Subscription registry ${name} must be a positive safe integer.`);
    }
  },
  read(record: Any, expectedId: string | undefined, maxBytes: number): StoredBinding {
    if (record.typeUrl !== recordTypeUrl || record.value.byteLength > maxBytes)
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
    if (
      source.version !== recordVersion ||
      !DurableBindingValues.token(source.id) ||
      (expectedId !== undefined && source.id !== expectedId) ||
      !DurableBindingValues.token(source.principalFingerprint) ||
      (source.tenant !== undefined && typeof source.tenant !== "string") ||
      !DurableBindingValues.finite(source.expiresAtMs) ||
      !["inactive", "active", "closed"].includes(source.lifecycle as string) ||
      !DurableBindingValues.finite(source.leaseUntilMs) ||
      !DurableBindingValues.finite(source.cancellationFence) ||
      !DurableBindingValues.finite(source.encodedBytes) ||
      typeof source.backend !== "string"
    )
      throw new Error("Durable subscription registry record is invalid.");
    if (
      Buffer.from(source.backend, "base64").toString("base64") !== source.backend ||
      Buffer.byteLength(source.backend) !== source.encodedBytes
    )
      throw new Error("Durable subscription registry record is invalid.");
    const backend = Uint8Array.from(Buffer.from(source.backend, "base64"));
    if (backend.byteLength === 0)
      throw new Error("Durable subscription registry record is invalid.");
    return Object.freeze({
      id: source.id,
      backend,
      principalFingerprint: source.principalFingerprint,
      tenant: source.tenant,
      expiresAtMs: source.expiresAtMs,
      lifecycle: source.lifecycle as StoredBinding["lifecycle"],
      leaseUntilMs: source.leaseUntilMs,
      cancellationFence: source.cancellationFence,
      encodedBytes: source.encodedBytes,
      version: source.version,
    });
  },
  finite(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  },
  time(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a safe time.`);
  },
  token(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
  },
  spec(maxBytes: number): RecordSpec<string, Any> {
    return new RecordSpec<string, Any>({
      schema: AnySchema,
      storageKey: registryStorageKey,
      idKind: "string",
      extractId: (record) => DurableBindingValues.read(record, undefined, maxBytes).id,
    });
  },
  write(record: Omit<StoredBinding, "encodedBytes">): Any {
    const backend = Buffer.from(record.backend).toString("base64");
    return create(AnySchema, {
      typeUrl: recordTypeUrl,
      value: new TextEncoder().encode(
        JSON.stringify({
          ...record,
          backend,
          encodedBytes: Buffer.byteLength(backend),
        }),
      ),
    });
  },
});
