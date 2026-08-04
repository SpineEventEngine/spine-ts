import { clone, create, toBinary } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import {
  SubscriptionSchema,
  type Subscription,
  type SubscriptionId,
} from "@spine-event-engine/proto/client";
import {
  RecordSpec,
  type RecordStorage,
  type StorageContext,
  type StorageFactory,
} from "@spine-event-engine/storage";
// prettier-ignore
import type {
  StandSubscriptionRecord,
} from "@spine-event-engine/proto/generated/spine/system/server/stand_subscription_pb.js";

import { StandSubscriptionRecords } from "./subscription-records.js";

const defaultLimit = 100;
const pendingMilliseconds = 30_000;

/**
 * A durable Stand subscription definition.
 */
export interface StandSubscriptionEntry {
  // prettier-ignore

  /**
   * Stores the canonical subscription definition.
   */
  readonly subscription: Subscription;

  /**
   * Identifies the current lifecycle phase.
   */
  readonly phase: "pending" | "active";

  /**
   * Records the creation time in milliseconds since the Unix epoch.
   */
  readonly createdAt: number;

  /**
   * Records the pending activation deadline in milliseconds.
   */
  readonly pendingUntil?: number;

  /**
   * Coordinates lifecycle changes.
   */
  readonly revision: bigint;
}

/**
 * Result returned after a create attempt.
 */
export type StandCreateResult =
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies a newly created definition.
       */
      kind: "created";

      /**
       * Stores the created definition.
       */
      entry: StandSubscriptionEntry;
    }>
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies an idempotently existing definition.
       */
      kind: "existing";

      /**
       * Stores the existing definition.
       */
      entry: StandSubscriptionEntry;
    }>;

/**
 * Result returned after an activate attempt.
 */
export type StandActivateResult =
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies a transitioned definition.
       */
      kind: "activated";

      /**
       * Stores the active definition.
       */
      entry: StandSubscriptionEntry;
    }>
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies an already-active definition.
       */
      kind: "active";

      /**
       * Stores the active definition.
       */
      entry: StandSubscriptionEntry;
    }>
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies an absent definition.
       */
      kind: "missing";
    }>
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies a physically removed expired definition.
       */
      kind: "expired";
    }>;

/**
 * Result returned after a delete attempt.
 */
export type StandDeleteResult = "deleted" | "missing" | "changed";

// Compatibility aliases retained only while the durable implementation is converted.
type StandSubscriptionCreateResult = StandCreateResult;
type StandSubscriptionActivateResult = StandActivateResult;
type StandSubscriptionDeleteResult = StandDeleteResult;

/**
 * Reports the work performed by one bounded expired-pending cleanup page.
 */
export interface StandCleanupResult {
  // prettier-ignore

  /**
   * Counts expired pending entries inspected in this page.
   */
  readonly scanned: number;

  /**
   * Counts expired pending entries physically deleted in this page.
   */
  readonly deleted: number;

  /**
   * Reports whether another expired pending page remains.
   */
  readonly more: boolean;
}

/**
 * Reports capacity exhaustion while admitting a definition.
 */
export class StandCapacityError extends Error {
  // prettier-ignore

  /**
   * Creates the capacity failure.
   * @param limit The configured admission limit.
   */
  constructor(readonly limit: number) {
    super(`Stand subscription capacity of ${String(limit)} is exhausted.`);
    this.name = "StandCapacityError";
  }
}

/**
 * Reports an ID reused with distinct subscription content.
 */
export class StandConflictError extends Error {
  // prettier-ignore

  /**
   * Creates the conflict failure.
   * @param id The conflicting subscription ID.
   */
  constructor(readonly id: string) {
    super(`Stand subscription "${id}" already exists with different content.`);
    this.name = "StandConflictError";
  }
}

/**
 * Stores Stand subscription definitions independently from listener delivery.
 */
export interface StandSubscriptionRegistry {
  // prettier-ignore

  /**
   * Reports whether definitions survive process restarts.
   */
  readonly persistent: boolean;

  /**
   * Creates a definition or returns its canonical equivalent.
   *
   * @param subscription Defines the subscription to retain.
   * @returns Resolves to the creation result.
   */
  create(subscription: Subscription): Promise<StandCreateResult>;

  /**
   * Activates a pending definition.
   *
   * @param id Identifies the definition to activate.
   * @returns Resolves to the activation result.
   */
  activate(id: SubscriptionId): Promise<StandActivateResult>;

  /**
   * Deletes a definition when its revision matches.
   *
   * @param id Identifies the definition to delete.
   * @param expectedRevision Limits deletion to the observed revision.
   * @returns Resolves to the deletion result.
   */
  delete(id: SubscriptionId, expectedRevision?: bigint): Promise<StandDeleteResult>;

  /**
   * Finds one definition.
   *
   * @param id Identifies the definition to find.
   * @returns Resolves to a clone or undefined.
   */
  get(id: SubscriptionId): Promise<StandSubscriptionEntry | undefined>;

  /**
   * Lists bounded definitions in deterministic identifier order.
   *
   * @returns Resolves to cloned definitions.
   */
  snapshot(): Promise<readonly StandSubscriptionEntry[]>;

  /**
   * Deletes one bounded page of expired pending definitions.
   *
   * @returns Resolves to cleanup work counts.
   */
  cleanup(): Promise<StandCleanupResult>;

  /**
   * Closes the registry after admitted operations settle.
   *
   * @returns Resolves after closure completes.
   */
  close(): Promise<void>;
}

/**
 * Keeps bounded subscription definitions in process memory.
 */
export class InMemorySubscriptionRegistry implements StandSubscriptionRegistry {
  // prettier-ignore

  /**
   * Reports that this registry is process-local.
   */
  readonly persistent = false;
  readonly #entries = new Map<string, StandSubscriptionEntry>();
  readonly #limit: number;
  #closed = false;
  #activeOperations = 0;
  #closePromise: Promise<void> | undefined;
  #finishClose: (() => void) | undefined;

  /**
   * Creates an in-memory registry.
   * @param limit Maximum number of definitions, from one through 100.
   */
  constructor(limit: number = defaultLimit) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > defaultLimit) {
      throw new RangeError(
        "Stand subscription limit must be a positive safe integer no greater than 100.",
      );
    }
    this.#limit = limit;
  }

  /**
   * Creates a process-local definition.
   *
   * @param subscription Defines the subscription to retain.
   * @returns Resolves to the creation result.
   */
  create(subscription: Subscription): Promise<StandCreateResult> {
    return this.#operation(() => {
      const id = InMemorySubscriptionRegistry.#subscriptionId(subscription);
      const existing = this.#entries.get(id);
      if (existing !== undefined) {
        if (!sameSubscription(existing.subscription, subscription))
          throw new StandConflictError(id);
        return Object.freeze({
          kind: "existing" as const,
          entry: InMemorySubscriptionRegistry.#clone(existing),
        });
      }
      if (this.#entries.size >= this.#limit) throw new StandCapacityError(this.#limit);
      const createdAt = Date.now();
      const entry = InMemorySubscriptionRegistry.#freezeEntry({
        subscription: clone(SubscriptionSchema, subscription),
        phase: "pending",
        createdAt,
        pendingUntil: createdAt + pendingMilliseconds,
        revision: 1n,
      });
      StandSubscriptionRecords.write(entry);
      this.#entries.set(id, entry);
      return Object.freeze({
        kind: "created" as const,
        entry: InMemorySubscriptionRegistry.#clone(entry),
      });
    });
  }

  /**
   * Activates a pending process-local definition.
   *
   * @param id Identifies the definition to activate.
   * @returns Resolves to the activation result.
   */
  activate(id: SubscriptionId): Promise<StandActivateResult> {
    return this.#operation(() => {
      const value = subscriptionIdValue(id);
      const entry = this.#entries.get(value);
      if (entry === undefined) return Object.freeze({ kind: "missing" as const });
      if (entry.phase === "active")
        return Object.freeze({
          kind: "active" as const,
          entry: InMemorySubscriptionRegistry.#clone(entry),
        });
      if (entry.pendingUntil !== undefined && entry.pendingUntil <= Date.now()) {
        this.#entries.delete(value);
        return Object.freeze({ kind: "expired" as const });
      }
      const active = InMemorySubscriptionRegistry.#freezeEntry({
        subscription: entry.subscription,
        phase: "active",
        createdAt: entry.createdAt,
        revision: entry.revision + 1n,
      });
      this.#entries.set(value, active);
      return Object.freeze({
        kind: "activated" as const,
        entry: InMemorySubscriptionRegistry.#clone(active),
      });
    });
  }

  /**
   * Deletes a process-local definition.
   *
   * @param id Identifies the definition to delete.
   * @param expectedRevision Limits deletion to the observed revision.
   * @returns Resolves to the deletion result.
   */
  delete(id: SubscriptionId, expectedRevision?: bigint): Promise<StandDeleteResult> {
    return this.#operation(() => {
      const value = subscriptionIdValue(id);
      if (expectedRevision !== undefined && expectedRevision < 1n)
        throw new RangeError("Stand subscription revision must be positive.");
      const entry = this.#entries.get(value);
      if (entry === undefined) return "missing";
      if (expectedRevision !== undefined && expectedRevision !== entry.revision) return "changed";
      this.#entries.delete(value);
      return "deleted";
    });
  }

  /**
   * Finds a process-local definition.
   *
   * @param id Identifies the definition to find.
   * @returns Resolves to a clone or undefined.
   */
  get(id: SubscriptionId): Promise<StandSubscriptionEntry | undefined> {
    return this.#operation(() => {
      const entry = this.#entries.get(subscriptionIdValue(id));
      return entry === undefined ? undefined : InMemorySubscriptionRegistry.#clone(entry);
    });
  }

  /**
   * Lists process-local definitions in identifier order.
   *
   * @returns Resolves to cloned definitions.
   */
  snapshot(): Promise<readonly StandSubscriptionEntry[]> {
    return this.#operation(() =>
      Object.freeze(
        [...this.#entries.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([, entry]) => InMemorySubscriptionRegistry.#clone(entry)),
      ),
    );
  }

  /**
   * Deletes one page of expired pending process-local definitions.
   *
   * @returns Resolves to cleanup work counts.
   */
  cleanup(): Promise<StandCleanupResult> {
    return this.#operation(() => {
      const now = Date.now();
      const expired = [...this.#entries.entries()]
        .filter(
          ([, entry]) =>
            entry.phase === "pending" &&
            entry.pendingUntil !== undefined &&
            entry.pendingUntil <= now,
        )
        .sort(([left], [right]) => left.localeCompare(right));
      const page = expired.slice(0, 25);
      for (const [id] of page) this.#entries.delete(id);
      return Object.freeze({
        scanned: page.length,
        deleted: page.length,
        more: expired.length > page.length,
      });
    });
  }

  /**
   * Closes this registry after admitted operations settle.
   *
   * @returns Resolves after closure completes.
   */
  close(): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise;
    this.#closed = true;
    this.#closePromise = new Promise<void>((resolve) => {
      this.#finishClose = resolve;
    });
    if (this.#activeOperations === 0) this.#completeClose();
    return this.#closePromise;
  }

  static #subscriptionId(subscription: Subscription): string {
    if (subscription.id === undefined)
      throw new TypeError("Stand subscription ID must be non-blank.");
    if (subscription.topic === undefined)
      throw new TypeError("Stand subscription topic must be present.");
    return subscriptionIdValue(subscription.id);
  }

  static #clone(entry: StandSubscriptionEntry): StandSubscriptionEntry {
    return InMemorySubscriptionRegistry.#freezeEntry({
      ...entry,
      subscription: clone(SubscriptionSchema, entry.subscription),
    });
  }

  static #freezeEntry(entry: StandSubscriptionEntry): StandSubscriptionEntry {
    return Object.freeze({ ...entry, subscription: deepFreeze(entry.subscription) });
  }

  #operation<T>(action: () => T | Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("Stand subscription registry is closed."));
    this.#activeOperations += 1;
    return Promise.resolve()
      .then(action)
      .finally(() => {
        this.#activeOperations -= 1;
        if (this.#closed && this.#activeOperations === 0) this.#completeClose();
      });
  }

  #completeClose(): void {
    this.#entries.clear();
    this.#finishClose?.();
    this.#finishClose = undefined;
  }
}

/**
 * Stores one durable subscription definition per storage key.
 */
export class StorageSubscriptionRegistry implements StandSubscriptionRegistry {
  // prettier-ignore

  /**
   * Reports that this registry stores definitions durably.
   */
  readonly persistent = true;
  readonly #storage: RecordStorage<string, StandSubscriptionRecord>;
  readonly #control: RecordStorage<string, Any>;
  readonly #limit: number;
  #closed = false;
  #activeOperations = 0;
  #closePromise: Promise<void> | undefined;
  #closeWaiter: (() => void) | undefined;

  /**
   * Creates a storage-backed registry for one bounded-context storage scope.
   * @param context Scopes definition rows to the context and tenant mode.
   * @param storageFactory Opens the durable record handle.
   * @param limit Maximum admitted definitions.
   */
  constructor(
    context: StorageContext,
    storageFactory: StorageFactory,
    limit: number = defaultLimit,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > defaultLimit) {
      throw new RangeError(
        "Stand subscription limit must be a positive safe integer no greater than 100.",
      );
    }
    this.#limit = limit;
    this.#storage = storageFactory.createRecordStorage(
      context,
      new RecordSpec<string, StandSubscriptionRecord>({
        schema: StandSubscriptionRecords.schema,
        storageKey: "spine.server.StandSubscriptionRecord:definition",
        idKind: "string",
        extractId: (record: StandSubscriptionRecord) =>
          subscriptionEntryId(StandSubscriptionRecords.read(record)),
      }),
    );
    this.#control = storageFactory.createRecordStorage(
      context,
      new RecordSpec<string, Any>({
        schema: AnySchema,
        storageKey: "spine.server.StandSubscriptionRecord:control",
        idKind: "string",
        extractId: () => controlSlot,
      }),
    );
    if (!this.#storage.atomicCompareAndSet || !this.#control.atomicCompareAndSet) {
      this.#storage.close();
      this.#control.close();
      throw new Error("Stand subscription storage must support atomic compare-and-set.");
    }
  }

  /**
   * Creates a durable definition or returns its canonical equivalent.
   *
   * @param subscription Defines the subscription to retain.
   * @returns Resolves to the creation result.
   */
  async create(subscription: Subscription): Promise<StandSubscriptionCreateResult> {
    return await this.#operation(async () => {
      const id = StorageSubscriptionRegistry.#id(subscription);
      const createdAt = Date.now();
      const proposed: StandSubscriptionEntry = Object.freeze({
        subscription: clone(SubscriptionSchema, subscription),
        phase: "pending",
        createdAt,
        pendingUntil: createdAt + pendingMilliseconds,
        revision: 1n,
      });
      const next = StandSubscriptionRecords.write(proposed);
      const digest = recordDigest(next);
      for (;;) {
        await this.#recover();
        const existing = await this.#storage.read(id);
        if (existing !== undefined) {
          const entry = StandSubscriptionRecords.read(existing, id);
          if (!sameSubscription(entry.subscription, subscription)) throw new StandConflictError(id);
          return Object.freeze({
            kind: "existing" as const,
            entry: StorageSubscriptionRegistry.#clone(entry),
          });
        }
        const control = await this.#controlState();
        if (control.count >= this.#limit) throw new StandCapacityError(this.#limit);
        const staged = controlWithOperation(control, control.count + 1, {
          kind: "create",
          id,
          digest,
        });
        if (!(await this.#control.compareAndSet(controlSlot, control.record, writeControl(staged))))
          continue;
        if (!(await this.#storage.compareAndSet(id, undefined, next))) {
          await this.#recover();
          continue;
        }
        await this.#recover();
        return Object.freeze({
          kind: "created" as const,
          entry: StorageSubscriptionRegistry.#clone(proposed),
        });
      }
    });
  }

  /**
   * Activates a durable pending definition.
   *
   * @param subscriptionId Identifies the definition to activate.
   * @returns Resolves to the activation result.
   */
  async activate(
    subscriptionId: SubscriptionId | string,
  ): Promise<StandSubscriptionActivateResult> {
    return await this.#operation(async () => {
      const id = registryId(subscriptionId);
      for (;;) {
        await this.#recover();
        const record = await this.#storage.read(id);
        if (record === undefined) return Object.freeze({ kind: "missing" as const });
        const entry = StandSubscriptionRecords.read(record, id);
        if (entry.phase === "active")
          return Object.freeze({
            kind: "active" as const,
            entry: StorageSubscriptionRegistry.#clone(entry),
          });
        if (entry.pendingUntil !== undefined && entry.pendingUntil <= Date.now()) {
          await this.#deleteCurrent(id, record);
          return Object.freeze({ kind: "expired" as const });
        }
        const active: StandSubscriptionEntry = Object.freeze({
          subscription: entry.subscription,
          phase: "active",
          createdAt: entry.createdAt,
          revision: entry.revision + 1n,
        });
        const control = await this.#controlState();
        const staged = controlWithOperation(control, control.count, {
          kind: "activate",
          id,
          digest: recordDigest(record),
        });
        if (!(await this.#control.compareAndSet(controlSlot, control.record, writeControl(staged))))
          continue;
        if (await this.#storage.compareAndSet(id, record, StandSubscriptionRecords.write(active))) {
          await this.#recover();
          return Object.freeze({
            kind: "activated" as const,
            entry: StorageSubscriptionRegistry.#clone(active),
          });
        }
        await this.#recover();
      }
    });
  }

  /**
   * Deletes a durable definition when its revision matches.
   *
   * @param subscriptionId Identifies the definition to delete.
   * @param expectedRevision Limits deletion to the observed revision.
   * @returns Resolves to the deletion result.
   */
  async delete(
    subscriptionId: SubscriptionId | string,
    expectedRevision?: bigint,
  ): Promise<StandSubscriptionDeleteResult> {
    return await this.#operation(async () => {
      const id = registryId(subscriptionId);
      for (;;) {
        await this.#recover();
        const record = await this.#storage.read(id);
        if (record === undefined) return "missing";
        const entry = StandSubscriptionRecords.read(record, id);
        if (expectedRevision !== undefined && expectedRevision !== entry.revision) return "changed";
        const control = await this.#controlState();
        if (control.count < 1) throw new Error("Malformed Stand subscription control record.");
        const staged = controlWithOperation(control, control.count, {
          kind: "delete",
          id,
          digest: recordDigest(record),
        });
        if (!(await this.#control.compareAndSet(controlSlot, control.record, writeControl(staged))))
          continue;
        const deleted = await this.#storage.compareAndSet(id, record, undefined);
        await this.#recover();
        return deleted ? "deleted" : "changed";
      }
    });
  }

  /**
   * Finds one durable definition.
   *
   * @param subscriptionId Identifies the definition to find.
   * @returns Resolves to a clone or undefined.
   */
  async get(subscriptionId: SubscriptionId | string): Promise<StandSubscriptionEntry | undefined> {
    return await this.#operation(async () => {
      const id = registryId(subscriptionId);
      await this.#recover();
      const record = await this.#storage.read(id);
      return record === undefined
        ? undefined
        : StorageSubscriptionRegistry.#clone(StandSubscriptionRecords.read(record, id));
    });
  }

  /**
   * Lists durable definitions in identifier order.
   *
   * @returns Resolves to cloned definitions.
   */
  async snapshot(): Promise<readonly StandSubscriptionEntry[]> {
    return await this.#operation(async () => {
      await this.#recover();
      return Object.freeze(
        (await this.#definitions()).map((row) =>
          StorageSubscriptionRegistry.#clone(StandSubscriptionRecords.read(row.record, row.id)),
        ),
      );
    });
  }

  /**
   * Deletes one bounded page of expired durable pending definitions.
   *
   * @returns Resolves to cleanup work counts.
   */
  async cleanup(): Promise<StandCleanupResult> {
    return await this.#operation(async () => {
      await this.#recover();
      let deleted = 0;
      const now = Date.now();
      const expired = (await this.#definitions()).filter((row) => {
        const entry = StandSubscriptionRecords.read(row.record, row.id);
        return (
          entry.phase === "pending" && entry.pendingUntil !== undefined && entry.pendingUntil <= now
        );
      });
      const page = expired.slice(0, 25);
      for (const row of page) if (await this.#deleteCurrent(row.id, row.record)) deleted += 1;
      return Object.freeze({ scanned: page.length, deleted, more: expired.length > page.length });
    });
  }

  /**
   * Closes durable storage after admitted operations settle.
   *
   * @returns Resolves after closure completes.
   */
  close(): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise;
    this.#closed = true;
    this.#closePromise = new Promise<void>((resolve) => {
      this.#closeWaiter = resolve;
      if (this.#activeOperations === 0) resolve();
    }).then(() => {
      this.#storage.close();
      this.#control.close();
    });
    return this.#closePromise;
  }

  static #id(subscription: Subscription): string {
    const id = subscription.id?.value;
    if (typeof id !== "string" || id.trim() === "")
      throw new TypeError("Stand subscription ID must be non-blank.");
    return id;
  }

  static #clone(entry: StandSubscriptionEntry): StandSubscriptionEntry {
    return Object.freeze({
      ...entry,
      subscription: deepFreeze(clone(SubscriptionSchema, entry.subscription)),
    });
  }

  #requireOpen(): void {
    if (this.#closed) throw new Error("Stand subscription registry is closed.");
  }

  async #operation<T>(action: () => Promise<T>): Promise<T> {
    this.#requireOpen();
    this.#activeOperations += 1;
    try {
      return await action();
    } finally {
      this.#activeOperations -= 1;
      if (this.#closed && this.#activeOperations === 0) this.#closeWaiter?.();
    }
  }

  async #definitions() {
    const rows = await this.#storage.queryEntries({
      sort: [{ field: "id" }],
      limit: this.#limit + 1,
    });
    if (rows.length > this.#limit) throw new Error("Malformed Stand subscription control record.");
    for (const row of rows) StandSubscriptionRecords.read(row.record, row.id);
    return rows;
  }

  async #controlState(): Promise<ControlState> {
    const record = await this.#control.read(controlSlot);
    if (record === undefined) throw new Error("Stand subscription control record is missing.");
    return { record, ...readControl(record, this.#limit) };
  }

  async #recover(): Promise<void> {
    for (;;) {
      const record = await this.#control.read(controlSlot);
      if (record === undefined) {
        const rows = await this.#definitions();
        const initial: Control = { revision: 1, count: rows.length };
        if (await this.#control.compareAndSet(controlSlot, undefined, writeControl(initial)))
          return;
        continue;
      }
      const control = readControl(record, this.#limit);
      if (control.operation === undefined) {
        if ((await this.#definitions()).length !== control.count) {
          throw new Error("Malformed Stand subscription control record.");
        }
        return;
      }
      const current = await this.#storage.read(control.operation.id);
      const matches = current !== undefined && recordDigest(current) === control.operation.digest;
      if (current !== undefined && !matches && control.operation.kind !== "activate")
        throw new Error("Malformed Stand subscription control record.");
      let next: Control;
      if (control.operation.kind === "create") {
        next = controlWithOperation(control, matches ? control.count : control.count - 1);
      } else if (control.operation.kind === "activate") {
        if (current === undefined) throw new Error("Malformed Stand subscription control record.");
        if (!matches) {
          const entry = StandSubscriptionRecords.read(current, control.operation.id);
          if (entry.phase !== "active")
            throw new Error("Malformed Stand subscription control record.");
        }
        next = controlWithOperation(control, control.count);
      } else {
        if (
          matches &&
          !(await this.#storage.compareAndSet(control.operation.id, current, undefined))
        )
          continue;
        next = controlWithOperation(control, control.count - 1);
      }
      if (next.count < 0) throw new Error("Malformed Stand subscription control record.");
      if (await this.#control.compareAndSet(controlSlot, record, writeControl(next))) return;
    }
  }

  async #deleteCurrent(id: string, record: StandSubscriptionRecord): Promise<boolean> {
    for (;;) {
      const control = await this.#controlState();
      if (control.count < 1) throw new Error("Malformed Stand subscription control record.");
      const staged = controlWithOperation(control, control.count, {
        kind: "delete",
        id,
        digest: recordDigest(record),
      });
      if (!(await this.#control.compareAndSet(controlSlot, control.record, writeControl(staged))))
        continue;
      const deleted = await this.#storage.compareAndSet(id, record, undefined);
      await this.#recover();
      return deleted;
    }
  }
}

const controlSlot = "control";
const controlTypeUrl = "type.spine.io/stand.subscription.control.v1";
interface ControlOperation {
  readonly kind: "create" | "activate" | "delete";
  readonly id: string;
  readonly digest: string;
}
interface Control {
  readonly revision: number;
  readonly count: number;
  readonly operation?: ControlOperation;
}
interface ControlState extends Control {
  readonly record: Any;
}

function controlWithOperation(
  control: Control,
  count: number,
  operation?: ControlOperation,
): Control {
  return Object.freeze({
    revision: control.revision + 1,
    count,
    ...(operation === undefined ? {} : { operation }),
  });
}

function writeControl(control: Control): Any {
  return create(AnySchema, {
    typeUrl: controlTypeUrl,
    value: new TextEncoder().encode(JSON.stringify(control)),
  });
}

function readControl(record: Any, limit: number): Control {
  try {
    if (record.typeUrl !== controlTypeUrl) throw Error();
    const value: unknown = JSON.parse(new TextDecoder().decode(record.value));
    if (typeof value !== "object" || value === null) throw Error();
    const control = value as { revision?: unknown; count?: unknown; operation?: unknown };
    if (
      !Number.isSafeInteger(control.revision) ||
      (control.revision as number) < 1 ||
      !Number.isSafeInteger(control.count) ||
      (control.count as number) < 0 ||
      (control.count as number) > limit
    )
      throw Error();
    if (control.operation === undefined)
      return Object.freeze({
        revision: control.revision as number,
        count: control.count as number,
      });
    const operation = control.operation as { kind?: unknown; id?: unknown; digest?: unknown };
    if (
      (operation.kind !== "create" &&
        operation.kind !== "activate" &&
        operation.kind !== "delete") ||
      typeof operation.id !== "string" ||
      operation.id.trim() === "" ||
      typeof operation.digest !== "string" ||
      !/^[0-9a-f]{16}$/.test(operation.digest)
    )
      throw Error();
    return Object.freeze({
      revision: control.revision as number,
      count: control.count as number,
      operation: Object.freeze({
        kind: operation.kind,
        id: operation.id,
        digest: operation.digest,
      }),
    });
  } catch {
    throw new Error("Malformed Stand subscription control record.");
  }
}

function recordDigest(record: StandSubscriptionRecord): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of toBinary(StandSubscriptionRecords.schema, record)) {
    hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

function sameSubscription(left: Subscription, right: Subscription): boolean {
  const leftBytes = toBinary(SubscriptionSchema, left);
  const rightBytes = toBinary(SubscriptionSchema, right);
  return (
    leftBytes.length === rightBytes.length &&
    leftBytes.every((byte, index) => byte === rightBytes[index])
  );
}

function subscriptionIdValue(id: SubscriptionId): string {
  if (typeof id.value !== "string" || id.value.trim() === "")
    throw new TypeError("Stand subscription ID must be non-blank.");
  return id.value;
}

function subscriptionEntryId(entry: StandSubscriptionEntry): string {
  if (entry.subscription.id === undefined) throw new Error("Stand subscription record is invalid.");
  return subscriptionIdValue(entry.subscription.id);
}

function registryId(id: SubscriptionId | string): string {
  if (typeof id === "string") {
    if (id.trim() === "") throw new TypeError("Stand subscription ID must be non-blank.");
    return id;
  }
  return subscriptionIdValue(id);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
