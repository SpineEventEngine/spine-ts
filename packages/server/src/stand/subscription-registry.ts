/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { clone, ScalarType, toBinary } from "@bufbuild/protobuf";
import { SUBSCRIPTION_ACTIVATION_HANDSHAKE_MS } from "@spine-event-engine/core/internal/subscription-lifecycle";
import {
  SubscriptionIdSchema,
  SubscriptionSchema,
  SubscriptionStatus,
  type Subscription,
  type SubscriptionId,
  type SubscriptionRecord,
} from "@spine-event-engine/proto/client";
import {
  ColumnTypes,
  RecordColumn,
  RecordSpec,
  type RecordStorage,
  type StorageContext,
  type StorageFactory,
} from "@spine-event-engine/storage";

import { StandSubscriptionRecords } from "./subscription-records.js";

const cleanupPageSize = 25;

/**
 * Describes one canonical durable subscription lifecycle entry.
 */
interface StandSubscriptionEntryBase {
  // prettier-ignore

  /**
   * Provides the subscription definition.
   */
  readonly subscription: Subscription;

  /**
   * Records when the definition was created, in milliseconds since Unix epoch.
   */
  readonly createdAt: number;
}

/**
 * Describes a pending subscription definition with its activation deadline.
 */
export type StandPendingSubscriptionEntry = Readonly<
  StandSubscriptionEntryBase & {
    // prettier-ignore

    /**
     * Identifies a definition awaiting activation.
     */
    readonly phase: "pending";

    /**
     * Records the required activation deadline in milliseconds since Unix epoch.
     */
    readonly pendingUntil: number;
  }
>;

/**
 * Describes an active subscription definition without an activation deadline.
 */
export type StandActiveSubscriptionEntry = Readonly<
  StandSubscriptionEntryBase & {
    // prettier-ignore

    /**
     * Identifies a definition that is active.
     */
    readonly phase: "active";

    /**
     * Forbids an activation deadline once the definition is active.
     */
    readonly pendingUntil?: never;
  }
>;

/**
 * Describes one canonical durable subscription lifecycle entry.
 */
export type StandSubscriptionEntry = StandPendingSubscriptionEntry | StandActiveSubscriptionEntry;

/**
 * Reports whether create stored a definition or found its identical predecessor.
 */
export type StandCreateResult = Readonly<{
  // prettier-ignore

  /**
   * Identifies the creation outcome.
   */
  kind: "created" | "existing";

  /**
   * Provides the created or existing lifecycle entry.
   */
  entry: StandSubscriptionEntry;
}>;

/**
 * Reports the result of activating a durable subscription definition.
 */
export type StandActivateResult =
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies an activation or an already-active definition.
       */
      kind: "activated" | "active";

      /**
       * Provides the active lifecycle entry.
       */
      entry: StandSubscriptionEntry;
    }>
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies an absent or expired definition.
       */
      kind: "missing" | "expired";
    }>;

/**
 * Identifies the outcome of deleting a durable subscription definition.
 */
export type StandDeleteResult = "deleted" | "missing";

/**
 * Describes one finite cleanup pass.
 */
export interface StandCleanupResult {
  // prettier-ignore

  /**
   * Counts examined expired pending definitions.
   */
  readonly scanned: number;

  /**
   * Counts definitions physically deleted by this pass.
   */
  readonly deleted: number;

  /**
   * Indicates that one observed expired definition remains for a later pass.
   */
  readonly more: boolean;
}

/**
 * Reports an ID reused with distinct subscription content.
 */
export class StandConflictError extends Error {
  // prettier-ignore

  /**
   * Creates an error for the conflicting subscription ID.
   *
   * @param id Identifies the conflicting subscription.
   */
  constructor(readonly id: string) {
    super(`Stand subscription "${id}" already exists with different content.`);
    this.name = "StandConflictError";
  }
}

/**
 * Stores subscription definitions independently from listener delivery.
 */
export interface StandSubscriptionRegistry {
  // prettier-ignore

  /**
   * Indicates whether definitions survive a process restart.
   */
  readonly persistent: boolean;

  /**
   * Creates a pending definition or returns its identical predecessor.
   *
   * @param subscription Provides the definition to create.
   * @returns Resolves to the creation outcome.
   */
  create(subscription: Subscription): Promise<StandCreateResult>;

  /**
   * Activates the definition identified by an explicit subscription ID.
   *
   * @param id Identifies the definition to activate.
   * @returns Resolves to the activation outcome.
   */
  activate(id: SubscriptionId): Promise<StandActivateResult>;

  /**
   * Deletes the definition identified by an explicit subscription ID.
   *
   * @param id Identifies the definition to delete.
   * @returns Resolves to the deletion outcome.
   */
  delete(id: SubscriptionId): Promise<StandDeleteResult>;

  /**
   * Gets an isolated current definition, when it exists.
   *
   * @param id Identifies the definition to read.
   * @returns Resolves to the definition when present.
   */
  get(id: SubscriptionId): Promise<StandSubscriptionEntry | undefined>;

  /**
   * Returns isolated definitions in identifier order.
   *
   * @returns Resolves to the ordered definitions.
   */
  snapshot(): Promise<readonly StandSubscriptionEntry[]>;

  /**
   * Deletes one bounded page of expired pending definitions.
   *
   * @returns Resolves to the cleanup result.
   */
  cleanup(): Promise<StandCleanupResult>;

  /**
   * Closes the registry and releases its resources.
   *
   * @returns Resolves after resources are released.
   */
  close(): Promise<void>;
}

/**
 * Keeps subscription definitions in process memory.
 */
export class InMemorySubscriptionRegistry implements StandSubscriptionRegistry {
  // prettier-ignore

  /**
   * Indicates that in-memory definitions do not survive restart.
   */
  readonly persistent = false;
  readonly #entries = new Map<string, StandSubscriptionEntry>();
  #closed = false;

  /**
   * Creates or finds one in-memory pending definition.
   *
   * @param subscription Provides the definition to create.
   * @returns Resolves to the creation outcome.
   */
  async create(subscription: Subscription): Promise<StandCreateResult> {
    await Promise.resolve();
    this.#open();
    const id = subscriptionId(subscription);
    const existing = this.#entries.get(id);
    if (existing !== undefined) {
      if (!sameSubscription(existing.subscription, subscription)) throw new StandConflictError(id);
      return Promise.resolve({ kind: "existing", entry: copy(existing) });
    }
    const createdAt = Date.now();
    const entry = freeze({
      subscription: clone(SubscriptionSchema, subscription),
      phase: "pending" as const,
      createdAt,
      pendingUntil: createdAt + SUBSCRIPTION_ACTIVATION_HANDSHAKE_MS,
    });
    this.#entries.set(id, entry);
    return Promise.resolve({ kind: "created", entry: copy(entry) });
  }

  /**
   * Activates an unexpired in-memory pending definition.
   *
   * @param value Identifies the definition to activate.
   * @returns Resolves to the activation outcome.
   */
  async activate(value: SubscriptionId): Promise<StandActivateResult> {
    await Promise.resolve();
    this.#open();
    const id = idValue(value);
    const entry = this.#entries.get(id);
    if (entry === undefined) return Promise.resolve({ kind: "missing" });
    if (entry.phase === "active") return Promise.resolve({ kind: "active", entry: copy(entry) });
    if (expiresAt(entry) <= Date.now()) {
      this.#entries.delete(id);
      return Promise.resolve({ kind: "expired" });
    }
    const active = freeze({
      subscription: entry.subscription,
      phase: "active" as const,
      createdAt: entry.createdAt,
    });
    this.#entries.set(id, active);
    return Promise.resolve({ kind: "activated", entry: copy(active) });
  }

  /**
   * Deletes an in-memory definition, when present.
   *
   * @param value Identifies the definition to delete.
   * @returns Resolves to the deletion outcome.
   */
  async delete(value: SubscriptionId): Promise<StandDeleteResult> {
    await Promise.resolve();
    this.#open();
    return Promise.resolve(this.#entries.delete(idValue(value)) ? "deleted" : "missing");
  }

  /**
   * Gets an isolated in-memory definition, when present.
   *
   * @param value Identifies the definition to read.
   * @returns Resolves to the definition when present.
   */
  async get(value: SubscriptionId): Promise<StandSubscriptionEntry | undefined> {
    await Promise.resolve();
    this.#open();
    const entry = this.#entries.get(idValue(value));
    return Promise.resolve(entry === undefined ? undefined : copy(entry));
  }

  /**
   * Returns isolated in-memory definitions in identifier order.
   *
   * @returns Resolves to the ordered definitions.
   */
  async snapshot(): Promise<readonly StandSubscriptionEntry[]> {
    await Promise.resolve();
    this.#open();
    return Promise.resolve(
      [...this.#entries.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, entry]) => copy(entry)),
    );
  }

  /**
   * Deletes a bounded page of expired in-memory pending definitions.
   *
   * @returns Resolves to the cleanup result.
   */
  async cleanup(): Promise<StandCleanupResult> {
    await Promise.resolve();
    this.#open();
    const candidates = [...this.#entries.entries()]
      .filter(([, entry]) => entry.phase === "pending")
      .sort(
        ([leftId, left], [rightId, right]) =>
          expiresAt(left) - expiresAt(right) || leftId.localeCompare(rightId),
      )
      .slice(0, cleanupPageSize + 1);
    const page = candidates
      .slice(0, cleanupPageSize)
      .filter(([, entry]) => expiresAt(entry) <= Date.now());
    for (const [id] of page) this.#entries.delete(id);
    return Promise.resolve({
      scanned: page.length,
      deleted: page.length,
      more:
        candidates.length > cleanupPageSize &&
        expiresAt(candidates[cleanupPageSize]?.[1] ?? fail("cleanup candidate is missing.")) <=
          Date.now(),
    });
  }

  /**
   * Closes the in-memory registry and discards its definitions.
   *
   * @returns Resolves after definitions are discarded.
   */
  async close(): Promise<void> {
    await Promise.resolve();
    this.#closed = true;
    this.#entries.clear();
    return Promise.resolve();
  }

  #open(): void {
    if (this.#closed) throw new Error("Stand subscription registry is closed.");
  }
}

/**
 * Stores one approved SubscriptionRecord per explicit subscription ID.
 */
export class StorageSubscriptionRegistry implements StandSubscriptionRegistry {
  // prettier-ignore

  /**
   * Indicates that the backing storage owns durable definitions.
   */
  readonly persistent = true;
  readonly #storage: RecordStorage<SubscriptionId, SubscriptionRecord>;
  #closed = false;

  /**
   * Creates a registry backed by one compare-and-set-capable record handle.
   *
   * @param context Identifies the storage namespace.
   * @param storageFactory Creates the registry record handle.
   */
  constructor(context: StorageContext, storageFactory: StorageFactory) {
    this.#storage = storageFactory.createRecordStorage(
      context,
      new RecordSpec<SubscriptionId, SubscriptionRecord>({
        recordType: StandSubscriptionRecords.schema,
        idSchema: SubscriptionIdSchema,
        extractId: (record) => record.id ?? fail("Stand subscription record is invalid."),
        columns: [
          new RecordColumn(
            "status",
            ColumnTypes.fromField(StandSubscriptionRecords.schema.field.status),
            (record) => record.status,
          ),
          new RecordColumn(
            "when_activation_expires",
            ColumnTypes.scalar(ScalarType.INT64),
            (record) =>
              record.whenActivationExpires === undefined
                ? Number.MAX_SAFE_INTEGER
                : time(record.whenActivationExpires),
          ),
        ],
      }),
    );
    if (!this.#storage.atomicCompareAndSet) {
      this.#storage.close();
      throw new Error("Stand subscription storage must support atomic compare-and-set.");
    }
  }

  /**
   * Creates a pending durable definition or finds its identical predecessor.
   *
   * @param subscription Provides the definition to create.
   * @returns Resolves to the creation outcome.
   */
  async create(subscription: Subscription): Promise<StandCreateResult> {
    this.#open();
    const value = subscriptionId(subscription);
    const recordId = subscription.id;
    if (recordId === undefined) throw new TypeError("Stand subscription ID must be non-blank.");
    for (;;) {
      const current = await this.#storage.read(recordId);
      if (current !== undefined) {
        const entry = StandSubscriptionRecords.read(current, value);
        if (!sameSubscription(entry.subscription, subscription))
          throw new StandConflictError(value);
        return { kind: "existing", entry: copy(entry) };
      }
      const createdAt = Date.now();
      const entry = freeze({
        subscription: clone(SubscriptionSchema, subscription),
        phase: "pending" as const,
        createdAt,
        pendingUntil: createdAt + SUBSCRIPTION_ACTIVATION_HANDSHAKE_MS,
      });
      const next = StandSubscriptionRecords.write(entry);
      try {
        if (await this.#storage.compareAndSet(recordId, undefined, next))
          return { kind: "created", entry: copy(entry) };
      } catch (error) {
        const observed = await this.#storage.read(recordId);
        if (observed !== undefined) {
          const observedEntry = StandSubscriptionRecords.read(observed, value);
          if (sameSubscription(observedEntry.subscription, subscription))
            return { kind: "created", entry: copy(observedEntry) };
        }
        throw error;
      }
    }
  }

  /**
   * Activates an unexpired durable pending definition.
   *
   * @param value Identifies the definition to activate.
   * @returns Resolves to the activation outcome.
   */
  async activate(value: SubscriptionId): Promise<StandActivateResult> {
    this.#open();
    const id = idValue(value);
    for (;;) {
      const current = await this.#storage.read(value);
      if (current === undefined) return { kind: "missing" };
      const entry = StandSubscriptionRecords.read(current, id);
      if (entry.phase === "active") return { kind: "active", entry: copy(entry) };
      if (expiresAt(entry) <= Date.now()) {
        if (await this.#storage.compareAndSet(value, current, undefined))
          return { kind: "expired" };
        continue;
      }
      const active = freeze({
        subscription: entry.subscription,
        phase: "active" as const,
        createdAt: entry.createdAt,
      });
      if (await this.#storage.compareAndSet(value, current, StandSubscriptionRecords.write(active)))
        return { kind: "activated", entry: copy(active) };
    }
  }

  /**
   * Deletes a durable definition after observing its current record.
   *
   * @param value Identifies the definition to delete.
   * @returns Resolves to the deletion outcome.
   */
  async delete(value: SubscriptionId): Promise<StandDeleteResult> {
    this.#open();
    for (;;) {
      const current = await this.#storage.read(value);
      if (current === undefined) return "missing";
      if (await this.#storage.compareAndSet(value, current, undefined)) return "deleted";
    }
  }

  /**
   * Gets an isolated durable definition, when present.
   *
   * @param value Identifies the definition to read.
   * @returns Resolves to the definition when present.
   */
  async get(value: SubscriptionId): Promise<StandSubscriptionEntry | undefined> {
    this.#open();
    const id = idValue(value);
    const record = await this.#storage.read(value);
    return record === undefined ? undefined : copy(StandSubscriptionRecords.read(record, id));
  }

  /**
   * Returns isolated durable definitions in identifier order.
   *
   * @returns Resolves to the ordered definitions.
   */
  async snapshot(): Promise<readonly StandSubscriptionEntry[]> {
    this.#open();
    const rows = await this.#storage.queryEntries({ sort: [{ field: "id" }] });
    return rows.map((row) => copy(StandSubscriptionRecords.read(row.record, idValue(row.id))));
  }

  /**
   * Deletes a bounded page of expired durable pending definitions.
   *
   * @returns Resolves to the cleanup result.
   */
  async cleanup(): Promise<StandCleanupResult> {
    this.#open();
    const rows = await this.#storage.queryEntries({
      filters: [{ column: "status", value: SubscriptionStatus.PENDING }],
      sort: [{ field: "when_activation_expires" }, { field: "id" }],
      limit: cleanupPageSize + 1,
    });
    const candidates = rows.map((row) => ({
      row,
      entry: StandSubscriptionRecords.read(row.record, idValue(row.id)),
    }));
    const page = candidates
      .slice(0, cleanupPageSize)
      .filter((candidate) => expiresAt(candidate.entry) <= Date.now());
    let deleted = 0;
    for (const { row } of page)
      if (await this.#storage.compareAndSet(row.id, row.record, undefined)) deleted += 1;
    const lookahead = candidates[cleanupPageSize];
    return {
      scanned: page.length,
      deleted,
      more: lookahead !== undefined && expiresAt(lookahead.entry) <= Date.now(),
    };
  }

  /**
   * Closes the durable storage handle once.
   *
   * @returns Resolves after the handle closes.
   */
  async close(): Promise<void> {
    await Promise.resolve();
    if (!this.#closed) {
      this.#closed = true;
      this.#storage.close();
    }
  }

  #open(): void {
    if (this.#closed) throw new Error("Stand subscription registry is closed.");
  }
}

function idValue(id: SubscriptionId): string {
  if (typeof id.value !== "string" || id.value.trim() === "")
    throw new TypeError("Stand subscription ID must be non-blank.");
  return id.value;
}

function subscriptionId(subscription: Subscription): string {
  const topicId = subscription.topic?.id?.value;
  if (subscription.id === undefined || typeof topicId !== "string" || topicId.trim() === "")
    throw new TypeError("Stand subscription ID and topic ID must be non-blank.");
  return idValue(subscription.id);
}

function expiresAt(entry: StandSubscriptionEntry): number {
  if (entry.phase !== "pending") throw new Error("Stand subscription record is invalid.");
  return entry.pendingUntil;
}

function copy(entry: StandSubscriptionEntry): StandSubscriptionEntry {
  return freeze({ ...entry, subscription: clone(SubscriptionSchema, entry.subscription) });
}

function freeze(entry: StandSubscriptionEntry): StandSubscriptionEntry {
  return Object.freeze(entry);
}

function sameSubscription(left: Subscription, right: Subscription): boolean {
  const leftBytes = toBinary(SubscriptionSchema, left);
  const rightBytes = toBinary(SubscriptionSchema, right);
  return (
    leftBytes.length === rightBytes.length &&
    leftBytes.every((value, index) => value === rightBytes[index])
  );
}

function time(value: { readonly seconds: bigint; readonly nanos: number }): number {
  return Number(value.seconds) * 1000 + Math.floor(value.nanos / 1_000_000);
}

function fail(message: string): never {
  throw new Error(message);
}
