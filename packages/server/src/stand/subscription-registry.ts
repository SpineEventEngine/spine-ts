import { clone, create, toBinary } from "@bufbuild/protobuf";
import { randomUUID } from "node:crypto";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import {
  SubscriptionSchema,
  type Subscription,
  type SubscriptionId,
} from "@spine-event-engine/proto/client";
import {
  RecordSpec,
  RecordColumn,
  type RecordStorage,
  type StorageContext,
  type StorageFactory,
} from "@spine-event-engine/storage";
// prettier-ignore
import type {
  StandSubscriptionRecord,
} from "@spine-event-engine/proto/generated/spine/system/server/stand_subscription_pb.js";
import { SubscriptionPhase } from "@spine-event-engine/proto/generated/spine/system/server/stand_subscription_pb.js";

import { StandSubscriptionRecords } from "./subscription-records.js";

/**
 *
 * Defines internal capacity and cleanup bounds shared by Stand registries.
 *
 * @internal
 */
export const standSubscriptionLimits: Readonly<{
  maximum: number;
  cleanupPageSize: number;
}> = Object.freeze({ maximum: 100, cleanupPageSize: 25 });
const pendingMilliseconds = 30_000;

type DeepReadonly<Value> = Value extends (...args: never[]) => unknown
  ? Value
  : Value extends ArrayBuffer | ArrayBufferView
    ? Value
    : Value extends readonly (infer Item)[]
      ? readonly DeepReadonly<Item>[]
      : Value extends object
        ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
        : Value;

/**
 * A durable Stand subscription definition.
 */
export interface StandSubscriptionEntry {
  // prettier-ignore

  /**
   * Stores the canonical subscription definition.
   */
  readonly subscription: DeepReadonly<Subscription>;

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
   * @throws TypeError When the subscription ID or topic ID is blank.
   * @throws StandCapacityError When the configured admitted-definition limit is exhausted.
   * @throws StandConflictError When the ID already has different canonical content.
   * @throws Error When the registry is closed or durable data is malformed.
   */
  create(subscription: Subscription): Promise<StandCreateResult>;

  /**
   * Activates a pending definition.
   *
   * @param id Identifies the definition to activate.
   * @returns Resolves to the activation result.
   * @throws TypeError When the generated ID is blank.
   * @throws Error When the registry is closed or durable data is malformed.
   */
  activate(id: SubscriptionId): Promise<StandActivateResult>;

  /**
   * Deletes a definition when its revision matches.
   *
   * @param id Identifies the definition to delete.
   * @param expectedRevision Limits deletion to the observed revision.
   * @returns Resolves to the deletion result.
   * @throws TypeError When the generated ID is blank.
   * @throws RangeError When an expected revision is negative.
   * @throws Error When the registry is closed or durable data is malformed.
   */
  delete(id: SubscriptionId, expectedRevision?: bigint): Promise<StandDeleteResult>;

  /**
   * Finds one definition.
   *
   * @param id Identifies the definition to find.
   * @returns Resolves to a clone or undefined.
   * @throws TypeError When the generated ID is blank.
   * @throws Error When the registry is closed or durable data is malformed.
   */
  get(id: SubscriptionId): Promise<StandSubscriptionEntry | undefined>;

  /**
   * Lists bounded definitions in deterministic identifier order.
   *
   * @returns Resolves to cloned definitions.
   * @throws Error When the registry is closed or durable data is malformed.
   */
  snapshot(): Promise<readonly StandSubscriptionEntry[]>;

  /**
   * Deletes one bounded page of expired pending definitions.
   *
   * @returns Resolves to cleanup work counts.
   * @throws Error When the registry is closed or durable data is malformed.
   */
  cleanup(): Promise<StandCleanupResult>;

  /**
   * Closes the registry after admitted operations settle.
   *
   * @returns Resolves after closure completes.
   * @throws Error When durable storage cannot close.
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
  constructor(limit: number = standSubscriptionLimits.maximum) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > standSubscriptionLimits.maximum) {
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
      const page = expired.slice(0, standSubscriptionLimits.cleanupPageSize);
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
    requireTopicId(subscription);
    return subscriptionIdValue(subscription.id);
  }

  static #clone(entry: StandSubscriptionEntry): StandSubscriptionEntry {
    return InMemorySubscriptionRegistry.#freezeEntry({
      ...entry,
      subscription: clone(SubscriptionSchema, entry.subscription as Subscription),
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
  readonly #stage: RecordStorage<string, StandSubscriptionRecord>;
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
    limit: number = standSubscriptionLimits.maximum,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > standSubscriptionLimits.maximum) {
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
        columns: [
          new RecordColumn(
            "admitted",
            (record: StandSubscriptionRecord) => record.revision > 0n,
            "boolean",
          ),
          new RecordColumn(
            "pending",
            (record: StandSubscriptionRecord) => record.phase === SubscriptionPhase.PENDING,
            "boolean",
          ),
          new RecordColumn(
            "pendingUntil",
            (record: StandSubscriptionRecord) =>
              record.pendingUntil === undefined
                ? Number.MAX_SAFE_INTEGER
                : Number(record.pendingUntil.seconds) * 1000 +
                  Math.floor(record.pendingUntil.nanos / 1_000_000),
            "number",
          ),
        ],
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
    this.#stage = storageFactory.createRecordStorage(
      context,
      new RecordSpec<string, StandSubscriptionRecord>({
        schema: StandSubscriptionRecords.schema,
        storageKey: "spine.server.StandSubscriptionRecord:staging",
        idKind: "string",
        extractId: () => stageSlot,
      }),
    );
    if (
      !this.#storage.atomicCompareAndSet ||
      !this.#control.atomicCompareAndSet ||
      !this.#stage.atomicCompareAndSet
    ) {
      this.#storage.close();
      this.#control.close();
      this.#stage.close();
      throw new Error("Stand subscription storage must support atomic compare-and-set.");
    }
  }

  /**
   * Creates a durable definition or returns its canonical equivalent.
   *
   * @param subscription Defines the subscription to retain.
   * @returns Resolves to the creation result.
   */
  async create(subscription: Subscription): Promise<StandCreateResult> {
    return await this.#operation(async () => {
      const id = StorageSubscriptionRegistry.#id(subscription);
      for (;;) {
        await this.#recover();
        const existing = await this.#storage.read(id);
        if (existing !== undefined) {
          const entry = StandSubscriptionRecords.read(existing, id);
          if (entry.revision === 0n) continue;
          if (!sameSubscription(entry.subscription, subscription)) throw new StandConflictError(id);
          return Object.freeze({
            kind: "existing" as const,
            entry: StorageSubscriptionRegistry.#clone(entry),
          });
        }
        const control = await this.#controlState();
        if (control.count >= this.#limit) throw new StandCapacityError(this.#limit);
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
        const staged = controlWithOperation(
          control,
          {
            kind: "create",
            id,
            expectedDigest: digest,
            resultDigest: digest,
            generation: generationToken(next),
            token: randomUUID(),
            stagedAt: Date.now(),
            expectedRevision: 1,
            resultRevision: 1,
          },
          control.count + 1,
        );
        if (!(await this.#control.compareAndSet(controlSlot, control.record, writeControl(staged))))
          continue;
        if (!(await this.#stage.compareAndSet(stageSlot, undefined, next))) {
          await this.#settle(staged, writeControl(staged));
          continue;
        }
        await this.#settle(staged, writeControl(staged));
        const settled = await this.#storage.read(id);
        const operation = staged.operation;
        if (operation === undefined)
          throw new Error("Malformed Stand subscription control record.");
        if (settled !== undefined && matchesOperation(settled, operation, "result"))
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
  async activate(subscriptionId: SubscriptionId): Promise<StandActivateResult> {
    return await this.#operation(async () => {
      const id = registryId(subscriptionId);
      for (;;) {
        await this.#recover();
        const control = await this.#controlState();
        const record = await this.#storage.read(id);
        if (record === undefined) return Object.freeze({ kind: "missing" as const });
        const entry = StandSubscriptionRecords.read(record, id);
        if (entry.revision === 0n) return Object.freeze({ kind: "missing" as const });
        if (entry.phase === "active")
          return Object.freeze({
            kind: "active" as const,
            entry: StorageSubscriptionRegistry.#clone(entry),
          });
        if (entry.pendingUntil !== undefined && entry.pendingUntil <= Date.now()) {
          await this.#deleteCurrent(id, record);
          return Object.freeze({ kind: "expired" as const });
        }
        const active = StandSubscriptionRecords.write(
          {
            subscription: entry.subscription,
            phase: "active",
            createdAt: entry.createdAt,
            revision: entry.revision + 1n,
          },
          record.generation,
        );
        const staged = controlWithOperation(control, {
          kind: "activate",
          id,
          expectedDigest: recordDigest(record),
          resultDigest: recordDigest(active),
          generation: generationToken(record),
          token: randomUUID(),
          stagedAt: Date.now(),
          expectedRevision: Number(entry.revision),
          resultRevision: Number(entry.revision + 1n),
        });
        if (await this.#control.compareAndSet(controlSlot, control.record, writeControl(staged))) {
          await this.#settle(staged, writeControl(staged));
          return Object.freeze({
            kind: "activated" as const,
            entry: StorageSubscriptionRegistry.#clone(StandSubscriptionRecords.read(active, id)),
          });
        }
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
    subscriptionId: SubscriptionId,
    expectedRevision?: bigint,
  ): Promise<StandDeleteResult> {
    return await this.#operation(async () => {
      const id = registryId(subscriptionId);
      if (expectedRevision !== undefined && expectedRevision < 1n)
        throw new RangeError("Stand subscription revision must be positive.");
      for (;;) {
        await this.#recover();
        const control = await this.#controlState();
        const record = await this.#storage.read(id);
        if (record === undefined) return "missing";
        const entry = StandSubscriptionRecords.read(record, id);
        if (entry.revision === 0n) return "missing";
        if (expectedRevision !== undefined && expectedRevision !== entry.revision) return "changed";
        if (control.count < 1) throw new Error("Malformed Stand subscription control record.");
        const staged = controlWithOperation(control, {
          kind: "delete",
          id,
          expectedDigest: recordDigest(record),
          generation: generationToken(record),
          token: randomUUID(),
          stagedAt: Date.now(),
          expectedRevision: Number(entry.revision),
        });
        if (!(await this.#control.compareAndSet(controlSlot, control.record, writeControl(staged))))
          continue;
        await this.#settle(staged, writeControl(staged));
        return "deleted";
      }
    });
  }

  /**
   * Finds one durable definition.
   *
   * @param subscriptionId Identifies the definition to find.
   * @returns Resolves to a clone or undefined.
   */
  async get(subscriptionId: SubscriptionId): Promise<StandSubscriptionEntry | undefined> {
    return await this.#operation(async () => {
      const id = registryId(subscriptionId);
      await this.#recover();
      const record = await this.#storage.read(id);
      if (record === undefined) return undefined;
      if (StandSubscriptionRecords.read(record, id).revision === 0n) return undefined;
      return StorageSubscriptionRegistry.#clone(StandSubscriptionRecords.read(record, id));
    });
  }

  /**
   * Lists durable definitions in identifier order.
   *
   * @returns Resolves to cloned definitions.
   */
  async snapshot(): Promise<readonly StandSubscriptionEntry[]> {
    return await this.#operation(async () => {
      for (;;) {
        await this.#recover();
        const control = await this.#controlState();
        const rows = await this.#definitions();
        const current = await this.#control.read(controlSlot);
        if (current === undefined || !sameAny(current, control.record)) continue;
        return Object.freeze(
          rows.map((row) =>
            StorageSubscriptionRegistry.#clone(StandSubscriptionRecords.read(row.record, row.id)),
          ),
        );
      }
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
      const reservations = await this.#storage.queryEntries({
        filters: [
          { column: "admitted", value: false },
          { column: "pending", value: true },
        ],
        sort: [{ field: "pendingUntil" }, { field: "id" }],
        limit: 26,
      });
      const pending = await this.#storage.queryEntries({
        filters: [
          { column: "admitted", value: true },
          { column: "pending", value: true },
        ],
        sort: [{ field: "pendingUntil" }, { field: "id" }],
        limit: 26,
      });
      const expired = [...reservations, ...pending].filter((row) => {
        const entry = StandSubscriptionRecords.read(row.record, row.id);
        return (
          entry.phase === "pending" && entry.pendingUntil !== undefined && entry.pendingUntil <= now
        );
      });
      expired.sort((left, right) => {
        const leftEntry = StandSubscriptionRecords.read(left.record, left.id);
        const rightEntry = StandSubscriptionRecords.read(right.record, right.id);
        return (
          (leftEntry.pendingUntil ?? 0) - (rightEntry.pendingUntil ?? 0) ||
          left.id.localeCompare(right.id)
        );
      });
      const page = expired.slice(0, standSubscriptionLimits.cleanupPageSize);
      for (const row of page) {
        const entry = StandSubscriptionRecords.read(row.record, row.id);
        if (entry.revision > 0n && (await this.#deleteCurrent(row.id, row.record))) deleted += 1;
      }
      return Object.freeze({
        scanned: page.length,
        deleted,
        more: expired.length > page.length,
      });
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
    if (this.#activeOperations === 0) {
      try {
        this.#closeHandles();
        this.#closePromise = Promise.resolve();
      } catch (error) {
        this.#closePromise = Promise.reject(
          error instanceof Error ? error : new Error("Stand subscription registry close failed."),
        );
      }
      return this.#closePromise;
    }
    const settled = new Promise<void>((resolve) => {
      this.#closeWaiter = resolve;
    });
    this.#closePromise = settled.then(() => {
      this.#closeHandles();
    });
    return this.#closePromise;
  }

  #closeHandles(): void {
    const errors: unknown[] = [];
    for (const storage of [this.#storage, this.#control, this.#stage]) {
      try {
        storage.close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Stand subscription registry close failed.");
    }
  }

  static #id(subscription: Subscription): string {
    const id = subscription.id?.value;
    if (typeof id !== "string" || id.trim() === "")
      throw new TypeError("Stand subscription ID must be non-blank.");
    requireTopicId(subscription);
    return id;
  }

  static #clone(entry: StandSubscriptionEntry): StandSubscriptionEntry {
    return Object.freeze({
      ...entry,
      subscription: deepFreeze(clone(SubscriptionSchema, entry.subscription as Subscription)),
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
      filters: [{ column: "admitted", value: true }],
      sort: [{ field: "id" }],
      limit: this.#limit + 1,
    });
    if (rows.length > this.#limit) throw new Error("Malformed Stand subscription control record.");
    for (const row of rows) {
      if (StandSubscriptionRecords.read(row.record, row.id).revision < 1n)
        throw new Error("Malformed Stand subscription control record.");
    }
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
        const initial: Control = { version: 2, state: "clean", revision: 1, count: rows.length };
        if (await this.#control.compareAndSet(controlSlot, undefined, writeControl(initial))) {
          await this.#discardOrphanStage();
          await this.#discardLegacyReservation();
          return;
        }
        continue;
      }
      const control = readControl(record, this.#limit);
      if (control.operation === undefined) {
        if ((await this.#definitions()).length !== control.count) {
          throw new Error("Malformed Stand subscription control record.");
        }
        await this.#discardOrphanStage();
        await this.#discardLegacyReservation();
        return;
      }
      await this.#settle(control, record);
    }
  }

  async #settle(control: Control, controlRecord: Any): Promise<void> {
    const operation = control.operation;
    if (operation === undefined) throw new Error("Malformed Stand subscription control record.");
    const currentControl = await this.#control.read(controlSlot);
    if (currentControl === undefined || !sameAny(currentControl, controlRecord)) return;
    if (operation.kind === "create") {
      await this.#settleCreate(control, controlRecord, operation);
      return;
    }
    const current = await this.#storage.read(operation.id);
    const expected = current !== undefined && matchesOperation(current, operation, "expected");
    const result = current !== undefined && matchesOperation(current, operation, "result");
    if (control.state === "staged") {
      if (expected) {
        const next = this.#operationResult(current, operation);
        if (!(await this.#storage.compareAndSet(operation.id, current, next))) return;
        await this.#settle(control, controlRecord);
        return;
      }
      if (!result && !(current === undefined && operation.resultDigest === undefined))
        throw new Error("Malformed Stand subscription control record.");
      const committed = controlCommitted(control);
      if (await this.#control.compareAndSet(controlSlot, controlRecord, writeControl(committed)))
        await this.#settle(committed, writeControl(committed));
      return;
    }
    if (!result && !(current === undefined && operation.resultDigest === undefined))
      throw new Error("Malformed Stand subscription control record.");
    const clean = controlWithOperation(control);
    if (!(await this.#control.compareAndSet(controlSlot, controlRecord, writeControl(clean))))
      return;
  }

  async #settleCreate(
    control: Control,
    controlRecord: Any,
    operation: ControlOperation,
  ): Promise<void> {
    const staged = await this.#stage.read(stageSlot);
    if (staged !== undefined && !matchesOperation(staged, operation, "result")) {
      await this.#discardMismatchedStage(controlRecord, staged);
      await this.#rollbackCreate(control, controlRecord);
      return;
    }
    if (control.state === "staged") {
      await this.#promoteStagedCreate(control, controlRecord, operation, staged);
      return;
    }
    await this.#cleanupCommittedCreate(control, controlRecord, operation, staged);
  }

  async #promoteStagedCreate(
    control: Control,
    controlRecord: Any,
    operation: ControlOperation,
    staged: StandSubscriptionRecord | undefined,
  ): Promise<void> {
    if (staged === undefined) {
      const remaining = operation.stagedAt + stageRecoveryMilliseconds - Date.now();
      if (remaining > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, remaining));
        await this.#settleCreate(control, controlRecord, operation);
        return;
      }
      await this.#rollbackCreate(control, controlRecord);
      return;
    }
    const current = await this.#storage.read(operation.id);
    if (current === undefined) {
      if (!(await this.#holdsControl(controlRecord))) return;
      if (!(await this.#storage.compareAndSet(operation.id, undefined, staged))) return;
      await this.#settleCreate(control, controlRecord, operation);
      return;
    }
    if (!matchesOperation(current, operation, "result"))
      throw new Error("Malformed Stand subscription control record.");
    const committed = controlCommitted(control);
    if (await this.#control.compareAndSet(controlSlot, controlRecord, writeControl(committed)))
      await this.#settleCreate(committed, writeControl(committed), operation);
  }

  async #cleanupCommittedCreate(
    control: Control,
    controlRecord: Any,
    operation: ControlOperation,
    staged: StandSubscriptionRecord | undefined,
  ): Promise<void> {
    if (staged !== undefined) {
      if (!(await this.#holdsControl(controlRecord))) return;
      if (!(await this.#stage.compareAndSet(stageSlot, staged, undefined))) return;
      await this.#settleCreate(control, controlRecord, operation);
      return;
    }
    const current = await this.#storage.read(operation.id);
    if (current === undefined || !matchesOperation(current, operation, "result"))
      throw new Error("Malformed Stand subscription control record.");
    await this.#control.compareAndSet(
      controlSlot,
      controlRecord,
      writeControl(controlWithOperation(control)),
    );
  }

  async #discardMismatchedStage(
    controlRecord: Any,
    staged: StandSubscriptionRecord,
  ): Promise<void> {
    if (!(await this.#holdsControl(controlRecord))) return;
    await this.#stage.compareAndSet(stageSlot, staged, undefined);
  }

  async #rollbackCreate(control: Control, controlRecord: Any): Promise<void> {
    if (!(await this.#holdsControl(controlRecord))) return;
    const rolledBack = controlWithOperation(control, undefined, control.count - 1);
    await this.#control.compareAndSet(controlSlot, controlRecord, writeControl(rolledBack));
  }

  async #holdsControl(controlRecord: Any): Promise<boolean> {
    const current = await this.#control.read(controlSlot);
    return current !== undefined && sameAny(current, controlRecord);
  }

  async #discardOrphanStage(): Promise<void> {
    const stage = await this.#stage.read(stageSlot);
    if (stage !== undefined) await this.#stage.compareAndSet(stageSlot, stage, undefined);
  }

  async #discardLegacyReservation(): Promise<void> {
    const rows = await this.#storage.queryEntries({
      filters: [{ column: "admitted", value: false }],
      sort: [{ field: "id" }],
      limit: 1,
    });
    const row = rows[0];
    if (row === undefined) return;
    const entry = StandSubscriptionRecords.read(row.record, row.id);
    if (entry.revision !== 0n) throw new Error("Malformed Stand subscription control record.");
    await this.#storage.compareAndSet(row.id, row.record, undefined);
  }

  #operationResult(
    current: StandSubscriptionRecord,
    operation: ControlOperation,
  ): StandSubscriptionRecord | undefined {
    if (operation.kind === "delete" || operation.kind === "discard") return undefined;
    const entry = StandSubscriptionRecords.read(current, operation.id);
    if (operation.kind === "create")
      return StandSubscriptionRecords.write(
        { ...entry, revision: BigInt(operation.resultRevision ?? -1) },
        current.generation,
      );
    return StandSubscriptionRecords.write(
      {
        subscription: entry.subscription,
        phase: "active",
        createdAt: entry.createdAt,
        revision: BigInt(operation.resultRevision ?? -1),
      },
      current.generation,
    );
  }

  async #deleteCurrent(id: string, record: StandSubscriptionRecord): Promise<boolean> {
    for (;;) {
      await this.#recover();
      const control = await this.#controlState();
      const current = await this.#storage.read(id);
      if (current === undefined || recordDigest(current) !== recordDigest(record)) return false;
      if (control.count < 1) throw new Error("Malformed Stand subscription control record.");
      const staged = controlWithOperation(control, {
        kind: "delete",
        id,
        expectedDigest: recordDigest(record),
        generation: generationToken(record),
        token: randomUUID(),
        stagedAt: Date.now(),
        expectedRevision: Number(StandSubscriptionRecords.read(record, id).revision),
      });
      if (!(await this.#control.compareAndSet(controlSlot, control.record, writeControl(staged))))
        continue;
      await this.#settle(staged, writeControl(staged));
      return true;
    }
  }
}

const controlSlot = "control";
const stageSlot = "stage";
const controlTypeUrl = "type.spine.io/stand.subscription.control.v1";
const stageRecoveryMilliseconds = 25;
interface ControlOperation {
  readonly kind: "create" | "activate" | "delete" | "discard";
  readonly id: string;
  readonly expectedDigest: string;
  readonly resultDigest?: string;
  readonly generation: string;
  readonly token: string;
  readonly stagedAt: number;
  readonly expectedRevision: number;
  readonly resultRevision?: number;
}
interface Control {
  readonly version: 2;
  readonly state: "clean" | "staged" | "committed";
  readonly revision: number;
  readonly count: number;
  readonly operation?: ControlOperation;
}
interface ControlState extends Control {
  readonly record: Any;
}

function controlWithOperation(
  control: Control,
  operation?: ControlOperation,
  count: number = control.count,
): Control {
  return Object.freeze({
    version: 2,
    state: operation === undefined ? "clean" : "staged",
    revision: control.revision + 1,
    count,
    ...(operation === undefined ? {} : { operation }),
  });
}

function controlCommitted(control: Control): Control {
  if (control.operation === undefined)
    throw new Error("Malformed Stand subscription control record.");
  return Object.freeze({
    ...control,
    state: "committed" as const,
    revision: control.revision + 1,
    count: committedCount(control),
  });
}

function committedCount(control: Control): number {
  switch (control.operation?.kind) {
    case "create":
      return control.count;
    case "delete":
      return control.count - 1;
    default:
      return control.count;
  }
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
    const control = value as {
      version?: unknown;
      state?: unknown;
      revision?: unknown;
      count?: unknown;
      operation?: unknown;
    };
    if (
      control.version !== 2 ||
      (control.state !== "clean" && control.state !== "staged" && control.state !== "committed") ||
      !Number.isSafeInteger(control.revision) ||
      (control.revision as number) < 1 ||
      !Number.isSafeInteger(control.count) ||
      (control.count as number) < 0 ||
      (control.count as number) > limit
    )
      throw Error();
    if (control.state === "clean" && control.operation === undefined)
      return Object.freeze({
        version: 2 as const,
        state: "clean" as const,
        revision: control.revision as number,
        count: control.count as number,
      });
    if (control.state === "clean" || control.operation === undefined) throw Error();
    const operation = control.operation as {
      kind?: unknown;
      id?: unknown;
      expectedDigest?: unknown;
      resultDigest?: unknown;
      generation?: unknown;
      token?: unknown;
      stagedAt?: unknown;
      expectedRevision?: unknown;
      resultRevision?: unknown;
    };
    if (
      (operation.kind !== "create" &&
        operation.kind !== "activate" &&
        operation.kind !== "delete" &&
        operation.kind !== "discard") ||
      typeof operation.id !== "string" ||
      operation.id.trim() === "" ||
      typeof operation.expectedDigest !== "string" ||
      !/^[0-9a-f]{16}$/.test(operation.expectedDigest) ||
      typeof operation.generation !== "string" ||
      !/^[0-9a-f]{32}$/.test(operation.generation) ||
      typeof operation.token !== "string" ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(operation.token) ||
      !Number.isSafeInteger(operation.stagedAt) ||
      (operation.stagedAt as number) < 0 ||
      !Number.isSafeInteger(operation.expectedRevision) ||
      (operation.expectedRevision as number) < 0 ||
      (operation.resultDigest !== undefined &&
        (typeof operation.resultDigest !== "string" ||
          !/^[0-9a-f]{16}$/.test(operation.resultDigest))) ||
      (operation.resultRevision !== undefined &&
        (!Number.isSafeInteger(operation.resultRevision) ||
          (operation.resultRevision as number) < 1)) ||
      ((operation.kind === "create" || operation.kind === "activate") &&
        (operation.resultDigest === undefined || operation.resultRevision === undefined)) ||
      ((operation.kind === "delete" || operation.kind === "discard") &&
        (operation.resultDigest !== undefined || operation.resultRevision !== undefined))
    )
      throw Error();
    const validOperation = operation as ControlOperation;
    return Object.freeze({
      version: 2 as const,
      state: control.state,
      revision: control.revision as number,
      count: control.count as number,
      operation: Object.freeze({
        kind: validOperation.kind,
        id: validOperation.id,
        expectedDigest: validOperation.expectedDigest,
        ...(validOperation.resultDigest === undefined
          ? {}
          : { resultDigest: validOperation.resultDigest }),
        generation: validOperation.generation,
        token: validOperation.token,
        stagedAt: validOperation.stagedAt,
        expectedRevision: validOperation.expectedRevision,
        ...(validOperation.resultRevision === undefined
          ? {}
          : { resultRevision: validOperation.resultRevision }),
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

function generationToken(record: StandSubscriptionRecord): string {
  return Buffer.from(record.generation).toString("hex");
}

function sameAny(left: Any, right: Any): boolean {
  const leftBytes = toBinary(AnySchema, left);
  const rightBytes = toBinary(AnySchema, right);
  return (
    leftBytes.length === rightBytes.length &&
    leftBytes.every((byte, index) => byte === rightBytes[index])
  );
}

function matchesOperation(
  record: StandSubscriptionRecord,
  operation: ControlOperation,
  stage: "expected" | "result",
): boolean {
  const digest = stage === "expected" ? operation.expectedDigest : operation.resultDigest;
  const revision = stage === "expected" ? operation.expectedRevision : operation.resultRevision;
  return (
    digest !== undefined &&
    revision !== undefined &&
    recordDigest(record) === digest &&
    generationToken(record) === operation.generation &&
    record.revision === BigInt(revision)
  );
}

function sameSubscription(
  left: DeepReadonly<Subscription>,
  right: DeepReadonly<Subscription>,
): boolean {
  const leftBytes = toBinary(SubscriptionSchema, left as Subscription);
  const rightBytes = toBinary(SubscriptionSchema, right as Subscription);
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
  return subscriptionIdValue(entry.subscription.id as SubscriptionId);
}

function registryId(id: SubscriptionId): string {
  return subscriptionIdValue(id);
}

function requireTopicId(subscription: DeepReadonly<Subscription>): void {
  const topicId = subscription.topic?.id?.value;
  if (typeof topicId !== "string" || topicId.trim() === "")
    throw new TypeError("Stand subscription topic ID must be non-blank.");
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  if (ArrayBuffer.isView(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
