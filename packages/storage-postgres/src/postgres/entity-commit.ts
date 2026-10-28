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

import { clone, toBinary, type Message } from "@bufbuild/protobuf";
import type { Event, EventId } from "@spine-event-engine/proto";
import {
  AgentHistoryEntrySchema,
  type AgentHistoryEntry,
  type ModelPreference,
} from "@spine-event-engine/proto/agent";
import type { AgentHistoryRecord } from "@spine-event-engine/proto/generated/spine/server/agent/history_record_pb.js";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import type { EntityStateKey } from "@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js";
import { type RecordSpec, type StorageGroup } from "@spine-event-engine/storage";
import {
  TenantBoundary,
  AgentHistoryRecords,
  AgentModelPreferences,
  type PreferencesRecord,
  EntityCommitSnapshots,
  eventHistorySpec,
  eventStoreRecordSpec,
  EventStoreGroups,
  stateHistorySpec,
  type AgentCommitInput,
  type EntityCommitInput,
  type EntityCommitStorage,
  type EntityStorageInput,
} from "@spine-event-engine/storage/provider";
import { AgentHistoryHash } from "./agent-history.js";
import { PostgresStorageErrors, PostgresStorageOperationError } from "./errors.js";
import { PostgresRecordStorage } from "./record-storage.js";
import type { PoolClient } from "pg";

/**
 * Acquires one PostgreSQL record family used by an Entity commit.
 *
 * @typeParam I Record identifier type.
 * @typeParam R Stored Protobuf record type.
 */
type OpenRecords = <I, R extends Message>(
  spec: RecordSpec<I, R>,
  group?: StorageGroup,
) => PostgresRecordStorage<I, R>;

/**
 * Stores current and optional record families across commits on one handle.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 */
class PostgresCommitRecords<I, S extends Message> {
  readonly current: PostgresRecordStorage<I, EntityRecord>;

  states: PostgresRecordStorage<EntityStateKey, EntityRecord> | undefined;

  diagnostics: PostgresRecordStorage<EventId, Event> | undefined;

  events: PostgresRecordStorage<EventId, Event> | undefined;

  history: PostgresRecordStorage<string, AgentHistoryRecord> | undefined;

  preferences: PostgresRecordStorage<string, PreferencesRecord> | undefined;

  readonly #handles: PostgresRecordStorage<unknown, Message>[];

  /**
   * Whether this record family is closed.
   */
  #closed = false;

  /**
   * Acquires the current record family for one Entity scope.
   *
   * @param open Opens one record family.
   * @param entity The Entity persistence contract.
   */
  constructor(entity: EntityStorageInput<I, S>, open: OpenRecords) {
    this.current = open(entity.recordSpec);
    this.#handles = [this.current as never];
  }

  /**
   * Acquires only missing requested families, rolling back a failed new group.
   *
   * @param input The captured Entity persistence input.
   * @param open Opens a generated record family.
   */
  ensure(input: EntityCommitInput<I, S>, open: OpenRecords): void {
    const acquired: PostgresRecordStorage<unknown, Message>[] = [];
    try {
      const states = input.states?.length
        ? (this.states ?? this.openState(input, open, acquired))
        : undefined;
      const diagnostics = input.diagnostics?.length
        ? (this.diagnostics ?? this.openDiagnostic(input, open, acquired))
        : undefined;
      const events = input.events?.length
        ? (this.events ?? this.openEvents(input, open, acquired))
        : undefined;
      this.states = states ?? this.states;
      this.diagnostics = diagnostics ?? this.diagnostics;
      this.events = events ?? this.events;
      this.#handles.push(...acquired);
    } catch (error) {
      const failures = this.closeGroup(acquired);
      if (failures.length)
        throw new AggregateError([error, ...failures], "PostgreSQL family acquisition failed.");
      throw error;
    }
  }

  /**
   * Stores the two Agent record families, rolling back only failed acquisition.
   * @param open Opens a private record family.
   */
  ensureAgent(open: OpenRecords): void {
    const acquired: PostgresRecordStorage<unknown, Message>[] = [];
    try {
      const history =
        this.history ??
        open(
          AgentHistoryRecords.spec((value) => AgentHistoryHash.value(value)),
          AgentHistoryRecords.group,
        );
      if (this.history === undefined) acquired.push(history as never);
      const preferences =
        this.preferences ??
        open(
          AgentModelPreferences.spec((value) => AgentHistoryHash.value(value)),
          AgentModelPreferences.group,
        );
      if (this.preferences === undefined) acquired.push(preferences as never);
      this.history = history;
      this.preferences = preferences;
      this.#handles.push(...acquired);
    } catch (error) {
      const failures = this.closeGroup(acquired);
      if (failures.length)
        throw new AggregateError(
          [error, ...failures],
          "PostgreSQL Agent family acquisition failed.",
        );
      throw error;
    }
  }

  /**
   * Prepares every record family before ordered writes begin.
   *
   * @returns Completion after all required tables are ready.
   */
  async prepare(): Promise<void> {
    for (const handle of this.#handles) await handle.prepare();
  }

  /**
   * Writes the fenced Entity mutation through the transaction's client.
   *
   * @param client Existing conditional-completion transaction client.
   * @param snapshot Captured immutable Entity mutation.
   * @param expectedVersion Version checked under the current-record lock.
   * @returns Completion after current and history records are written.
   */
  async applyConditional(
    client: PoolClient,
    snapshot: EntityCommitInput<I, S>,
    expectedVersion: number,
  ): Promise<void> {
    const current = await this.current
      .historyExecutor()
      .read(client, snapshot.entityId, "for-update");
    if ((current?.version?.number ?? 0) !== expectedVersion)
      throw new Error("Agent execution initial Entity Version is no longer current.");
    for (const state of snapshot.states ?? [])
      await this.states?.historyExecutor().appendImmutable(client, state);
    for (const diagnostic of snapshot.diagnostics ?? [])
      await this.diagnostics?.historyExecutor().appendImmutable(client, diagnostic);
    for (const event of snapshot.events ?? [])
      await this.events?.historyExecutor().appendImmutable(client, event);
    if (!PostgresCommitValues.same(current, snapshot.next))
      await this.current.historyExecutor().write(client, snapshot.next);
  }

  /**
   * Closes every retained record-family handle.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    const failures = this.closeGroup(this.#handles);
    if (failures.length === 1) throw failures[0] as Error;
    if (failures.length)
      throw new AggregateError(failures, "PostgreSQL commit records close failed.");
  }

  /**
   * Closes every newly acquired handle and collects cleanup failures.
   *
   * @param handles The acquired record handles.
   * @returns Cleanup failures from acquired handles.
   */
  private closeGroup(handles: readonly PostgresRecordStorage<unknown, Message>[]): unknown[] {
    const failures: unknown[] = [];
    for (const handle of handles) {
      try {
        handle.close();
      } catch (error) {
        failures.push(error);
      }
    }
    return failures;
  }

  /**
   * Acquires the Entity state-history record family.
   *
   * @param input Describes the Entity state schema.
   * @param open Opens one record family.
   * @param handles Collects handles that must close after the commit.
   * @returns The state-history record storage.
   */
  private openState(
    input: EntityCommitInput<I, S>,
    open: OpenRecords,
    handles: PostgresRecordStorage<unknown, Message>[],
  ): PostgresRecordStorage<EntityStateKey, EntityRecord> {
    const layout = stateHistorySpec(input.entity.stateSchema);
    const handle = open(layout.spec, layout.group);
    handles.push(handle as never);
    return handle;
  }

  /**
   * Acquires the Entity diagnostic-event history record family.
   *
   * @param input Describes the Entity state schema.
   * @param open Opens one record family.
   * @param handles Collects handles that must close after the commit.
   * @returns The diagnostic-history record storage.
   */
  private openDiagnostic(
    input: EntityCommitInput<I, S>,
    open: OpenRecords,
    handles: PostgresRecordStorage<unknown, Message>[],
  ): PostgresRecordStorage<EventId, Event> {
    const layout = eventHistorySpec(input.entity.stateSchema);
    const handle = open(layout.spec, layout.group);
    handles.push(handle as never);
    return handle;
  }

  /**
   * Acquires the shared event-store record family.
   *
   * @param input Supplies the context and Event family.
   * @param open Opens one record family.
   * @param handles Collects handles that must close after the commit.
   * @returns The event-store record storage.
   */
  private openEvents(
    input: EntityCommitInput<I, S>,
    open: OpenRecords,
    handles: PostgresRecordStorage<unknown, Message>[],
  ): PostgresRecordStorage<EventId, Event> {
    const handle = open(eventStoreRecordSpec, EventStoreGroups.forContext(input.context.name));
    handles.push(handle as never);
    return handle;
  }
}

/**
 * Represents a factory-tracked PostgreSQL Entity commit handle.
 *
 * @typeParam I Entity identifier type captured by this handle.
 * @typeParam S Entity state message type captured by this handle.
 */
export class PostgresEntityCommitStorage<I, S extends Message> implements EntityCommitStorage {
  #open = true;

  #records: PostgresCommitRecords<I, S> | undefined;

  /**
   * Synchronous idle-close result, including any cleanup failure.
   */
  #idleOutcome: { error?: Error } | undefined;

  readonly #active = new Set<Promise<unknown>>();

  #closing: Promise<void> | undefined;

  /**
   * Creates a PostgreSQL Entity commit handle for one Entity storage boundary.
   *
   * @param entity Defines the captured Entity source, state, and tenant scope.
   * @param open Opens current and optional history record-family handles.
   * @param onClose Removes this handle from the factory's live-handle set.
   */
  constructor(
    private readonly entity: EntityStorageInput<I, S>,
    private readonly open: OpenRecords,
    private readonly onClose: () => void,
  ) {}

  /**
   * Commits one current Entity record and its optional immutable records.
   *
   * @typeParam Id Entity identifier type supplied by the commit.
   * @typeParam State Entity state message type supplied by the commit.
   * @param input Defines the next current record plus histories.
   * @returns Completion after every requested record write.
   */
  commit<Id, State extends Message>(input: EntityCommitInput<Id, State>): Promise<void> {
    if (!this.#open)
      return Promise.reject(new PostgresStorageOperationError("Entity commit storage is closed."));
    return this.track(() => {
      this.validate(input);
      const prepared = EntityCommitSnapshots.capture(input);
      return this.persist(prepared);
    });
  }

  /**
   * Registers a commit before invoking provider construction callbacks.
   *
   * @param action The admitted provider operation.
   * @returns The admitted provider operation completion.
   * @typeParam T Result type of the admitted provider operation.
   */
  private track<T>(action: () => Promise<T>): Promise<T> {
    let complete!: (value: T) => void;
    let fail!: (error: unknown) => void;
    const work = new Promise<T>((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
    this.#active.add(work);
    void work.then(
      () => this.#active.delete(work),
      () => this.#active.delete(work),
    );
    try {
      action().then(complete, fail);
    } catch (error) {
      fail(error);
    }
    return work;
  }

  /**
   * Reads one detached preference image through the retained private family.
   * @param entityId Typed Agent identifier.
   * @returns Current complete image or absence.
   */
  readAgentPreferences(entityId: unknown): Promise<readonly ModelPreference[] | undefined> {
    if (!this.#open)
      return Promise.reject(new PostgresStorageOperationError("Entity commit storage is closed."));
    return this.track(async () => {
      const key = AgentModelPreferences.key(this.entity, entityId as I);
      const records = this.agentRecords();
      await records.prepare();
      const slot = `v1:${AgentHistoryHash.value(AgentModelPreferences.text(key))}`;
      const storage = records.preferences;
      if (storage === undefined) throw new Error("Agent preference storage is unavailable.");
      const found = await storage.read(slot);
      if (found === undefined) return undefined;
      AgentModelPreferences.requireIdentity(found, key);
      return AgentModelPreferences.copy(found.preferences);
    });
  }

  /**
   * Commits state, final audit, and complete preferences in one native transaction.
   * @param input Captured Agent transition and initial images.
   * @returns Completion after the conditional group commits.
   * @typeParam Id Typed Agent identifier.
   * @typeParam State Generated Agent state.
   */
  commitAgent<Id, State extends Message>(input: AgentCommitInput<Id, State>): Promise<void> {
    if (!this.#open)
      return Promise.reject(new PostgresStorageOperationError("Entity commit storage is closed."));
    return this.track(async () => {
      const id = this.entity.id.clone(input.entityId as unknown as I);
      const key = AgentModelPreferences.key(this.entity, id);
      const expected =
        input.expectedPreferences === undefined
          ? undefined
          : AgentModelPreferences.copy(input.expectedPreferences);
      const next = AgentModelPreferences.record(key, input.preferences);
      const mutation = input.entityCommit && EntityCommitSnapshots.capture(input.entityCommit);
      const history =
        input.historyEntries?.map((entry) => clone(AgentHistoryEntrySchema, entry)) ?? [];
      this.validateAgent(id, input.expectedVersion, mutation);
      const records = this.agentRecords();
      if (mutation !== undefined) records.ensure(mutation as never, this.open);
      await records.prepare();
      await this.commitAgentPrepared(
        records,
        id,
        input.expectedVersion,
        expected,
        next,
        mutation,
        history,
      );
    });
  }

  /**
   * Acquires the retained current, Agent audit, and preference families.
   *
   * @returns The retained family group.
   */
  private agentRecords(): PostgresCommitRecords<I, S> {
    const records = this.#records ?? new PostgresCommitRecords(this.entity, this.open);
    try {
      records.ensureAgent(this.open);
      this.#records ??= records;
      return records;
    } catch (error) {
      if (this.#records === undefined) {
        try {
          records.close();
        } catch (cleanup) {
          throw new AggregateError([error, cleanup], "PostgreSQL Agent family cleanup failed.");
        }
      }
      throw error;
    }
  }

  /**
   * Checks the captured Entity scope and next version before native writes.
   * @param id Captured Agent identifier.
   * @param version Initial Entity version.
   * @param mutation Optional prepared Entity mutation.
   * @typeParam Id Typed Agent identifier.
   * @typeParam State Generated Agent state.
   */
  private validateAgent<Id, State extends Message>(
    id: I,
    version: number,
    mutation?: EntityCommitInput<Id, State>,
  ): void {
    if (!Number.isSafeInteger(version) || version < 0)
      throw new TypeError("Agent commit requires a valid initial Entity Version.");
    if (mutation === undefined) return;
    this.validate(mutation);
    if (
      this.entity.id.key(id) !== this.entity.id.key(mutation.entityId as unknown as I) ||
      mutation.next.version?.number !== version + 1
    )
      throw new Error("Agent commit requires the same Entity ID and one new Version.");
  }

  /**
   * Applies one transaction lock even when preference and current rows are absent.
   * @param records Retained families.
   * @param id Captured Agent ID.
   * @param version Initial Entity version.
   * @param expected Initial preference image.
   * @param next Complete replacement record.
   * @param mutation Optional Entity mutation.
   * @param history Final audit entries.
   * @typeParam Id Typed Agent identifier.
   * @typeParam State Generated Agent state.
   * @returns Completion after the conditional Agent transaction commits.
   */
  private async commitAgentPrepared<Id, State extends Message>(
    records: PostgresCommitRecords<I, S>,
    id: I,
    version: number,
    expected: readonly ModelPreference[] | undefined,
    next: PreferencesRecord,
    mutation: EntityCommitInput<Id, State> | undefined,
    history: readonly AgentHistoryEntry[],
  ): Promise<void> {
    const preferenceStorage = records.preferences;
    const historyStorage = records.history;
    if (preferenceStorage === undefined || historyStorage === undefined || next.key === undefined)
      throw new Error("Agent commit storage is incomplete.");
    const preferences = preferenceStorage.historyExecutor();
    const key = next.key;
    const slot = `v1:${AgentHistoryHash.value(AgentModelPreferences.text(key))}`;
    await preferences.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [
        preferences.lock("agent-preferences", slot),
      ]);
      const prior = await preferences.read(client, slot, "for-update");
      if (prior !== undefined) AgentModelPreferences.requireIdentity(prior, key);
      if (!AgentModelPreferences.same(prior?.preferences, expected))
        throw new Error("Agent model preferences changed during the live turn.");
      if (mutation === undefined) {
        const current = await records.current.historyExecutor().read(client, id, "for-update");
        if ((current?.version?.number ?? 0) !== version)
          throw new Error("Agent initial Entity Version is no longer current.");
      } else await records.applyConditional(client, mutation as never, version);
      await this.appendAgentHistory(client, historyStorage, id, history);
      await preferences.write(client, next);
    });
  }

  /**
   * Adds final Agent audit through the admitted transaction client.
   * @param client Active native transaction.
   * @param storage Retained Agent history family.
   * @param id Captured Agent identifier.
   * @param history Final audit entries.
   * @returns Completion after final audit rows are appended.
   */
  private async appendAgentHistory(
    client: PoolClient,
    storage: PostgresRecordStorage<string, AgentHistoryRecord>,
    id: I,
    history: readonly AgentHistoryEntry[],
  ): Promise<void> {
    const executor = storage.historyExecutor();
    for (const entry of history)
      await executor.appendImmutable(
        client,
        AgentHistoryRecords.record(this.entity.stateSchema.typeName, this.entity.id.key(id), entry),
      );
  }

  /**
   * Persists an admitted captured mutation, including a safe retry.
   *
   * @param prepared The immutable prepared mutation.
   * @returns Completion after the captured mutation is persisted.
   * @typeParam Id Entity identifier or record type.
   * @typeParam State Generated Entity state message type.
   */
  private async persist<Id, State extends Message>(
    prepared: EntityCommitInput<Id, State>,
  ): Promise<void> {
    let records = this.#records as unknown as PostgresCommitRecords<Id, State> | undefined;
    let fresh = false;
    try {
      if (records === undefined) {
        records = new PostgresCommitRecords(
          this.entity,
          this.open,
        ) as unknown as PostgresCommitRecords<Id, State>;
        fresh = true;
      }
      records.ensure(prepared, this.open);
      this.#records ??= records as unknown as PostgresCommitRecords<I, S>;
      await records.prepare();
      try {
        await this.apply(prepared, records);
      } catch (error) {
        if (!this.retryable(error)) throw error;
        await this.apply(prepared, records);
      }
    } catch (error) {
      if (fresh && this.#records === undefined) {
        try {
          records?.close();
        } catch (cleanup) {
          throw new AggregateError([error, cleanup], "PostgreSQL commit acquisition failed.");
        }
      }
      throw PostgresStorageErrors.operation(error);
    }
  }

  /**
   * Prepares one Agent-fenced Entity mutation for its existing transaction client.
   *
   * @typeParam Id Typed Entity identifier.
   * @typeParam State Entity state message type.
   * @param input Changed Entity state and immutable history.
   * @returns A transaction-bound conditional mutation and its close callback.
   */
  async prepareAgentConditional<Id, State extends Message>(
    input: EntityCommitInput<Id, State>,
  ): Promise<{
    apply(client: PoolClient, expectedVersion: number): Promise<void>;
    close(): void;
  }> {
    this.validate(input);
    const snapshot = EntityCommitSnapshots.capture(input);
    const records = new PostgresCommitRecords(snapshot.entity, this.open);
    try {
      records.ensure(snapshot, this.open);
      await records.prepare();
    } catch (error) {
      records.close();
      throw error;
    }
    return {
      apply: (client, expectedVersion) =>
        records.applyConditional(client, snapshot, expectedVersion),
      close: () => {
        records.close();
      },
    };
  }

  /**
   * Determines whether a driver serialization failure occurred through provider error causes.
   *
   * @param error Supplies the operation failure.
   * @returns Whether one captured-input retry is safe.
   */
  private retryable(error: unknown): boolean {
    let current = error;
    for (let depth = 0; depth < 4; depth += 1) {
      if (typeof current !== "object" || current === null) return false;
      const failure = current as { code?: unknown; cause?: unknown };
      if (failure.code === "40P01" || failure.code === "40001") return true;
      current = failure.cause;
    }
    return false;
  }

  /**
   * Closes this handle to new commits while allowing started work to settle.
   *
   * @returns Completion after admitted work and retained records close.
   */
  close(): Promise<void> {
    this.#open = false;
    if (this.#idleOutcome !== undefined)
      return (this.#closing ??=
        this.#idleOutcome.error === undefined
          ? Promise.resolve()
          : Promise.reject(this.#idleOutcome.error));
    return (this.#closing ??= this.drain());
  }

  /**
   * Closes only when no commit remains admitted.
   */
  closeIdle(): void {
    if (this.#active.size) throw new Error("Entity commit cannot close idle while work is active.");
    if (this.#idleOutcome !== undefined) {
      if (this.#idleOutcome.error !== undefined) throw this.#idleOutcome.error;
      return;
    }
    if (this.#closing !== undefined) throw new Error("Entity commit close is in progress.");
    this.#open = false;
    const errors: unknown[] = [];
    try {
      this.#records?.close();
    } catch (error) {
      errors.push(error);
    }
    this.#records = undefined;
    try {
      this.onClose();
    } catch (error) {
      errors.push(error);
    }
    const failure =
      errors.length > 1 ? new AggregateError(errors) : (errors[0] as Error | undefined);
    this.#idleOutcome = failure === undefined ? {} : { error: failure };
    if (failure !== undefined) throw failure;
  }

  /**
   * Waits for admitted commits before releasing factory tracking.
   *
   * @returns Completion after admitted work and cleanup settle.
   */
  private async drain(): Promise<void> {
    await Promise.allSettled([...this.#active]);
    const errors: unknown[] = [];
    try {
      this.#records?.close();
    } catch (error) {
      errors.push(error);
    }
    this.#records = undefined;
    try {
      this.onClose();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) throw errors[0] as Error;
    if (errors.length) throw new AggregateError(errors, "PostgreSQL commit close failed.");
  }

  /**
   * Applies one validated Entity commit as ordered independent writes.
   *
   * @typeParam Id Entity identifier type supplied by the commit.
   * @typeParam State Entity state message type supplied by the commit.
   * @param input Defines the Entity records to commit.
   * @param records Provides the prepared record families.
   * @returns Completion after records are committed.
   */
  private async apply<Id, State extends Message>(
    input: EntityCommitInput<Id, State>,
    records: PostgresCommitRecords<Id, State>,
  ): Promise<void> {
    for (const record of input.states ?? []) await records.states?.writeImmutable(record);
    for (const record of input.diagnostics ?? []) await records.diagnostics?.writeImmutable(record);
    for (const record of input.events ?? []) await records.events?.writeImmutable(record);
    const current = await records.current.read(input.entityId);
    if (!PostgresCommitValues.same(current, input.next)) await records.current.write(input.next);
  }

  /**
   * Validates the commit against the Entity boundary captured by this handle.
   *
   * @typeParam Id Entity identifier type supplied by the commit.
   * @typeParam State Entity state message type supplied by the commit.
   * @param input Defines the Entity records to validate.
   */
  private validate<Id, State extends Message>(input: EntityCommitInput<Id, State>): void {
    if (input.entity.sourceType.typeName !== this.entity.sourceType.typeName)
      throw new PostgresStorageOperationError("Entity commit source type is incompatible.");
    if (input.entity.stateSchema.typeName !== this.entity.stateSchema.typeName)
      throw new PostgresStorageOperationError("Entity commit state schema is incompatible.");
    if (
      !PostgresCommitValues.sameBoundary(input.context, this.entity.context) ||
      !PostgresCommitValues.sameBoundary(input.entity.context, this.entity.context)
    )
      throw new PostgresStorageOperationError("Entity commit context is incompatible.");
    if (input.states?.length && !this.entity.stateHistory)
      throw new PostgresStorageOperationError("Entity state history is disabled.");
    if (input.diagnostics?.length && !this.entity.eventHistory)
      throw new PostgresStorageOperationError("Entity event history is disabled.");
    this.validateRows(input);
  }

  /**
   * Validates record identifiers inside one Entity commit.
   *
   * @typeParam Id Entity identifier type supplied by the commit.
   * @typeParam State Entity state message type supplied by the commit.
   * @param input Defines current and historical records to validate.
   */
  private validateRows<Id, State extends Message>(input: EntityCommitInput<Id, State>): void {
    for (const record of [input.next, ...(input.states ?? [])]) {
      const decoded = this.entity.id.unpack(record.entityId ?? ({} as never));
      if (
        decoded === undefined ||
        this.entity.id.key(decoded) !== this.entity.id.key(input.entityId as never)
      )
        throw new PostgresStorageOperationError(
          "Entity commit record does not identify the requested Entity.",
        );
    }
    this.validateEventIds(input.diagnostics, "diagnostic");
    this.validateEventIds(input.events, "delivery");
  }

  /**
   * Validates event identifiers for one immutable event family.
   *
   * @param events Events to validate when the family is enabled.
   * @param family Names the event family in validation errors.
   */
  private validateEventIds(events: readonly Event[] | undefined, family: string): void {
    const ids = events?.map((event) => event.id?.value) ?? [];
    if (ids.some((id) => id === undefined))
      throw new PostgresStorageOperationError(`Entity commit requires ${family} event IDs.`);
    if (ids.some((id) => id?.trim() === ""))
      throw new PostgresStorageOperationError(`Entity commit rejects blank ${family} event IDs.`);
    if (new Set(ids).size !== ids.length)
      throw new PostgresStorageOperationError(
        `Entity commit rejects duplicate ${family} event IDs.`,
      );
  }
}

const PostgresCommitValues = Object.freeze({
  /**
   * Compares two Entity records through their Protobuf wire representation.
   *
   * @param left Stored Entity record.
   * @param right Expected Entity record.
   * @returns Whether both records are absent or have identical wire bytes.
   */
  same(left: EntityRecord | undefined, right: EntityRecord | undefined): boolean {
    return left === undefined || right === undefined
      ? left === right
      : Buffer.compare(toBinary(EntityRecordSchema, left), toBinary(EntityRecordSchema, right)) ===
          0;
  },

  /**
   * Compares two complete storage tenant boundaries.
   *
   * @param left First storage context.
   * @param right Second storage context.
   * @returns Whether both contexts select the same tenant boundary.
   */
  sameBoundary(left: object, right: object): boolean {
    return TenantBoundary.of(left as never).key === TenantBoundary.of(right as never).key;
  },
});
