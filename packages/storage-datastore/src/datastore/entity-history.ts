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
import {
  AgentHistoryEntrySchema,
  type AgentHistoryEntry,
  type ModelPreference,
} from "@spine-event-engine/proto/agent";
import {
  AgentHistoryKeys,
  AgentHistoryRecords,
  AgentModelPreferences,
  type PreferencesRecord,
  type AgentCommitInput,
} from "@spine-event-engine/storage/provider";
import type { AgentHistoryRecord } from "@spine-event-engine/proto/generated/spine/server/agent/history_record_pb.js";
import { AnyPacker } from "@spine-event-engine/core";
import { type Timestamp } from "@bufbuild/protobuf/wkt";
import { EventSchema, type Event } from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { eventStoreRecordSpec, EventStoreGroups } from "@spine-event-engine/storage/provider";
import {
  disabledEventHistoryPort,
  disabledStateHistoryPort,
  eventHistorySpec,
  stateHistorySpec,
  EntityCommitSnapshots,
  type EntityCommitInput,
  type EntityCommitStorage,
  type EntityEventHistoryPort,
  type EntityRecordStorage,
  type EntityStateHistoryPort,
  type EntityStorageInput,
} from "@spine-event-engine/storage/provider";
import { RecordSpec, type RecordStorage } from "@spine-event-engine/storage";
import { TenantBoundary } from "@spine-event-engine/storage/provider";

import { DatastoreRecordStorage, type DatastorePageCursor } from "./record-storage.js";
import { AgentHistoryHash } from "./agent-history.js";
import { NativeTransactions, type NativeRow } from "./transaction-rows.js";
import type { Datastore } from "@google-cloud/datastore";

/**
 * Acquires one generated record family with its resolved Datastore layout.
 *
 * @typeParam I Record identifier type.
 * @typeParam R Stored Protobuf message type.
 * @param spec The generated record-family contract.
 * @param group The optional generated storage group.
 * @returns The opened record-storage handle.
 */
export type OpenEntityRecords = <I, R extends Message>(
  spec: RecordSpec<I, R>,
  group?: import("@spine-event-engine/storage").StorageGroup,
) => RecordStorage<I, R>;

type CommitStateRecords = RecordStorage<
  import("@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js").EntityStateKey,
  EntityRecord
>;
type CommitEventRecords = RecordStorage<import("@spine-event-engine/proto").EventId, Event>;

/**
 * Record families selected for one admitted Entity commit.
 *
 * @typeParam I Entity identifier type.
 */
type CommitFamilies<I> = [
  RecordStorage<I, EntityRecord>,
  CommitStateRecords | undefined,
  CommitEventRecords | undefined,
  CommitEventRecords | undefined,
];

/**
 * Groups native record families in one live Agent transaction.
 *
 * @typeParam I Typed Entity identifier.
 */
interface AgentCommitRows<I> {
  current: DatastoreRecordStorage<I, EntityRecord>;
  states?: DatastoreRecordStorage<unknown, EntityRecord>;
  diagnostics?: DatastoreRecordStorage<unknown, Event>;
  events?: DatastoreRecordStorage<unknown, Event>;
  history: DatastoreRecordStorage<string, AgentHistoryRecord>;
  preferences: DatastoreRecordStorage<string, PreferencesRecord>;
}

/**
 * Groups Entity current and optional history record families.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 */
export class DatastoreEntityStorage<I, S extends Message> {
  // prettier-ignore

  /**
   * Provides access to current Entity records.
   */
  readonly current: EntityRecordStorage<I>;

  /**
   * Provides access to retained Entity event history.
   */
  readonly events: EntityEventHistoryPort<I>;

  /**
   * Provides access to retained Entity state history.
   */
  readonly states: EntityStateHistoryPort<I, S>;

  readonly #records: readonly { close(): void }[];

  #open = true;

  /**
   * Creates storage handles for one Entity persistence contract.
   *
   * @param input The Entity persistence contract.
   * @param openRecords The function that opens each generated record family.
   */
  constructor(input: EntityStorageInput<I, S>, openRecords: OpenEntityRecords) {
    const current = openRecords(input.recordSpec);
    const states = input.stateHistory
      ? openRecords(
          stateHistorySpec(input.stateSchema).spec,
          stateHistorySpec(input.stateSchema).group,
        )
      : undefined;
    const events = input.eventHistory
      ? openRecords(
          eventHistorySpec(input.stateSchema).spec,
          eventHistorySpec(input.stateSchema).group,
        )
      : undefined;
    this.current = new CurrentStorage(input, current);
    this.states =
      states === undefined ? disabledStateHistoryPort() : new StateHistory(input, states);
    this.events =
      events === undefined ? disabledEventHistoryPort() : new EventHistory(input, events);
    this.#records = [current, states, events].filter((value) => value !== undefined);
  }

  /**
   * Closes all record-storage handles owned by this Entity storage.
   */
  close(): void {
    if (this.#open) {
      this.#open = false;
      const errors: unknown[] = [];
      for (const record of this.#records) {
        try {
          record.close();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length) throw new AggregateError(errors, "Datastore Entity records close failed.");
    }
  }

  /**
   * Returns whether this Entity storage remains open.
   *
   * @returns `true` when this storage accepts operations.
   */
  isOpen(): boolean {
    return this.#open;
  }
}

/**
 * Writes one Datastore Entity mutation in independent record order.
 */
export class DatastoreEntityCommitStorage implements EntityCommitStorage {
  #open = true;

  #current: RecordStorage<unknown, EntityRecord> | undefined;

  /**
   * Retained state-history records.
   */
  #states: CommitStateRecords | undefined;

  #diagnostics: CommitEventRecords | undefined;

  #events: CommitEventRecords | undefined;

  #history: DatastoreRecordStorage<string, AgentHistoryRecord> | undefined;

  #preferences: DatastoreRecordStorage<string, PreferencesRecord> | undefined;

  /**
   * Synchronous idle-close result, including any cleanup failure.
   */
  #idleOutcome: { error?: Error } | undefined;

  readonly #active = new Set<Promise<unknown>>();

  #closing: Promise<void> | undefined;

  /**
   * Creates commit storage for one Entity persistence contract.
   *
   * @param input Defines the Entity source and tenant boundary.
   * @param openRecords Opens each generated record family.
   * @param onClose Releases factory tracking after terminal cleanup.
   */
  constructor(
    private readonly input: EntityStorageInput<unknown, Message>,
    private readonly openRecords: OpenEntityRecords,
    private readonly onClose: () => void = () => undefined,
  ) {}

  /**
   * Writes histories and delivery Events before the current Entity record.
   *
   * A failed save may leave a completed prefix. One transient retry replays
   * captured records with the same versions and Event IDs.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state message type.
   * @param input Supplies the prepared Entity mutation.
   * @returns Completion after every requested record write.
   */
  commit<I, S extends Message>(input: EntityCommitInput<I, S>): Promise<void> {
    if (!this.#open) return Promise.reject(new Error("Entity commit storage is closed."));
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
   * Reads a detached current preference image from native storage.
   * @param entityId Typed Agent identifier.
   * @returns Complete selections or absent record.
   */
  readAgentPreferences(entityId: unknown): Promise<readonly ModelPreference[] | undefined> {
    if (!this.#open) return Promise.reject(new Error("Entity commit storage is closed."));
    return this.track(async () => {
      const key = AgentModelPreferences.key(this.input, entityId);
      const rows = this.agentRows();
      const slot = `v1:${AgentHistoryHash.value(AgentModelPreferences.text(key))}`;
      const found = await rows.preferences.read(slot);
      if (found === undefined) return undefined;
      AgentModelPreferences.requireIdentity(found, key);
      return AgentModelPreferences.copy(found.preferences);
    });
  }

  /**
   * Commits Agent state, final audit, and preferences in one native transaction.
   * @param input Captured live Agent transition.
   * @returns Completion after a conditional group commits.
   * @typeParam I Typed Agent identifier.
   * @typeParam S Generated Agent state.
   */
  commitAgent<I, S extends Message>(input: AgentCommitInput<I, S>): Promise<void> {
    if (!this.#open) return Promise.reject(new Error("Entity commit storage is closed."));
    return this.track(async () => {
      const id = this.input.id.clone(input.entityId);
      const key = AgentModelPreferences.key(this.input, id);
      const expected =
        input.expectedPreferences === undefined
          ? undefined
          : AgentModelPreferences.copy(input.expectedPreferences);
      const next = AgentModelPreferences.record(key, input.preferences);
      const mutation = input.entityCommit && EntityCommitSnapshots.capture(input.entityCommit);
      const history =
        input.historyEntries?.map((entry) => clone(AgentHistoryEntrySchema, entry)) ?? [];
      this.validateAgent(id, input.expectedVersion, mutation);
      const rows = this.agentRows(mutation as never);
      await this.agentTransaction(
        rows,
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
   * Acquires every missing native family before publishing retained references.
   * @param mutation Optional Entity mutation requiring history families.
   * @returns Native handles for one Agent commit.
   */
  private agentRows(mutation?: EntityCommitInput<unknown, Message>): AgentCommitRows<unknown> {
    const acquired: { close(): void }[] = [];
    try {
      const rows = this.acquireAgentRows(mutation, acquired);
      this.retainAgentRows(rows);
      return rows;
    } catch (error) {
      const failures = this.closeGroup(acquired);
      if (failures.length)
        throw new AggregateError(
          [error, ...failures],
          "Datastore Agent family acquisition failed.",
        );
      throw error;
    }
  }

  /**
   * Acquires only missing native Agent families without publishing partial acquisition.
   * @param mutation Optional Entity mutation.
   * @param acquired Collects newly opened handles for rollback.
   * @returns Complete native family group.
   */
  private acquireAgentRows(
    mutation: EntityCommitInput<unknown, Message> | undefined,
    acquired: { close(): void }[],
  ): AgentCommitRows<unknown> {
    const current = this.native(
      this.#current ?? this.openAgentRecord(this.input.recordSpec, undefined, acquired),
    );
    const { states, diagnostics, events } = this.agentMutationRows(mutation, acquired);
    const history =
      this.#history ??
      this.openAgentRecord(
        AgentHistoryRecords.spec((value) => AgentHistoryHash.value(value)),
        AgentHistoryRecords.group,
        acquired,
      );
    const preferences =
      this.#preferences ??
      this.openAgentRecord(
        AgentModelPreferences.spec((value) => AgentHistoryHash.value(value)),
        AgentModelPreferences.group,
        acquired,
      );
    return {
      current,
      states,
      diagnostics,
      events,
      history,
      preferences,
    } as AgentCommitRows<unknown>;
  }

  /**
   * Acquires mutation families needed by the admitted Agent turn.
   * @param mutation Optional changed Entity mutation.
   * @param acquired Newly opened handles retained for rollback.
   * @returns Optional mutation families.
   */
  private agentMutationRows(
    mutation: EntityCommitInput<unknown, Message> | undefined,
    acquired: { close(): void }[],
  ): Pick<AgentCommitRows<unknown>, "states" | "diagnostics" | "events"> {
    const stateLayout = stateHistorySpec(this.input.stateSchema);
    const eventLayout = eventHistorySpec(this.input.stateSchema);
    const states = mutation?.states?.length
      ? this.native(
          this.#states ?? this.openAgentRecord(stateLayout.spec, stateLayout.group, acquired),
        )
      : undefined;
    const diagnostics = mutation?.diagnostics?.length
      ? this.native(
          this.#diagnostics ?? this.openAgentRecord(eventLayout.spec, eventLayout.group, acquired),
        )
      : undefined;
    const events = mutation?.events?.length
      ? this.native(
          this.#events ??
            this.openAgentRecord(
              eventStoreRecordSpec,
              EventStoreGroups.forContext(this.input.context.name),
              acquired,
            ),
        )
      : undefined;
    return { states, diagnostics, events } as Pick<
      AgentCommitRows<unknown>,
      "states" | "diagnostics" | "events"
    >;
  }

  /**
   * Acquires one native record family and records its rollback obligation.
   * @param spec Declarative record layout.
   * @param group Optional physical family.
   * @param acquired Newly opened handles.
   * @returns Native record family.
   * @typeParam Id Typed record identifier.
   * @typeParam R Generated record.
   */
  private openAgentRecord<Id, R extends Message>(
    spec: RecordSpec<Id, R>,
    group: import("@spine-event-engine/storage").StorageGroup | undefined,
    acquired: { close(): void }[],
  ): DatastoreRecordStorage<Id, R> {
    const port = this.openRecords(spec, group);
    acquired.push(port);
    return this.native(port);
  }

  /**
   * Stores the complete acquired Agent group after every family succeeds.
   * @param rows Complete native family group.
   */
  private retainAgentRows(rows: AgentCommitRows<unknown>): void {
    this.#current ??= rows.current;
    this.#states ??= rows.states as CommitStateRecords | undefined;
    this.#diagnostics ??= rows.diagnostics as CommitEventRecords | undefined;
    this.#events ??= rows.events as CommitEventRecords | undefined;
    this.#history ??= rows.history;
    this.#preferences ??= rows.preferences;
  }

  /**
   * Checks the built-in native transaction capability.
   * @param port Selected record family.
   * @returns Native record family.
   * @typeParam Id Typed record identifier.
   * @typeParam R Generated record.
   */
  private native<Id, R extends Message>(port: RecordStorage<Id, R>): DatastoreRecordStorage<Id, R> {
    if (!(port instanceof DatastoreRecordStorage))
      throw new Error("Live Agent commit requires native Datastore transactions.");
    return port as DatastoreRecordStorage<Id, R>;
  }

  /**
   * Validates the Entity scope and exactly one next Version before I/O.
   * @param id Captured Agent ID.
   * @param version Initial Entity Version.
   * @param mutation Optional prepared Entity mutation.
   * @typeParam I Typed Entity identifier.
   * @typeParam S Generated Entity state.
   */
  private validateAgent<I, S extends Message>(
    id: unknown,
    version: number,
    mutation?: EntityCommitInput<I, S>,
  ): void {
    if (!Number.isSafeInteger(version) || version < 0)
      throw new TypeError("Agent commit requires a valid initial Entity Version.");
    if (mutation === undefined) return;
    this.validate(mutation);
    if (
      this.input.id.key(id) !== this.input.id.key(mutation.entityId) ||
      mutation.next.version?.number !== version + 1
    )
      throw new Error("Agent commit requires the same Entity ID and one new Version.");
  }

  /**
   * Executes a captured Agent transition in one native transaction.
   * @param rows Retained native families.
   * @param id Captured Agent ID.
   * @param version Initial Entity version.
   * @param expected Initial preference image.
   * @param next Complete replacement preferences.
   * @param mutation Optional Entity mutation.
   * @param history Final audit entries.
   * @typeParam I Typed Entity identifier.
   * @typeParam S Generated Entity state.
   * @returns Completion after the native transaction settles.
   */
  private async agentTransaction<I, S extends Message>(
    rows: AgentCommitRows<unknown>,
    id: unknown,
    version: number,
    expected: readonly ModelPreference[] | undefined,
    next: PreferencesRecord,
    mutation: EntityCommitInput<I, S> | undefined,
    history: readonly AgentHistoryEntry[],
  ): Promise<void> {
    const tx = rows.preferences.transaction();
    try {
      await tx.run();
      const staged: NativeRow[] = [];
      await this.agentLocked(tx, staged, rows, id, version, expected, next, mutation, history);
      NativeTransactions.validateRows(staged);
      for (const row of staged) tx.save(row);
      await tx.commit();
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      throw error;
    }
  }

  /**
   * Checks both current images and stages the complete final group.
   * @param tx Native transaction.
   * @param staged Rows saved only after all checks pass.
   * @param rows Retained native families.
   * @param id Captured Agent identifier.
   * @param version Initial Entity Version.
   * @param expected Initial preference image.
   * @param next Replacement preference record.
   * @param mutation Optional Entity mutation.
   * @param history Final audit entries.
   * @typeParam I Typed Entity identifier.
   * @typeParam S Generated Entity state.
   * @returns Completion after all conditional rows are staged.
   */
  private async agentLocked<I, S extends Message>(
    tx: ReturnType<Datastore["transaction"]>,
    staged: NativeRow[],
    rows: AgentCommitRows<unknown>,
    id: unknown,
    version: number,
    expected: readonly ModelPreference[] | undefined,
    next: PreferencesRecord,
    mutation: EntityCommitInput<I, S> | undefined,
    history: readonly AgentHistoryEntry[],
  ): Promise<void> {
    if (next.key === undefined) throw new Error("Agent preference identity is missing.");
    const slot = `v1:${AgentHistoryHash.value(AgentModelPreferences.text(next.key))}`;
    const prior = await this.agentRead(tx, rows.preferences, slot);
    if (prior !== undefined) AgentModelPreferences.requireIdentity(prior, next.key);
    if (!AgentModelPreferences.same(prior?.preferences, expected))
      throw new Error("Agent model preferences changed during the live turn.");
    const current = await this.agentRead(tx, rows.current, id);
    if ((current?.version?.number ?? 0) !== version)
      throw new Error("Agent initial Entity Version is no longer current.");
    for (const record of mutation?.states ?? [])
      await this.agentImmutable(tx, staged, this.requiredNative(rows.states), record);
    for (const event of mutation?.diagnostics ?? [])
      await this.agentImmutable(tx, staged, this.requiredNative(rows.diagnostics), event);
    for (const event of mutation?.events ?? [])
      await this.agentImmutable(tx, staged, this.requiredNative(rows.events), event);
    if (mutation !== undefined) staged.push(rows.current.transactionEntity(mutation.next));
    await this.appendAgentAudit(tx, staged, rows.history, id, history);
    staged.push(rows.preferences.transactionEntity(next));
  }

  /**
   * Records final Agent audit rows in the admitted native transaction.
   * @param history Final Agent audit entries.
   * @param id Captured typed Agent identifier.
   * @param staged Rows staged for atomic commit.
   * @param storage Retained provider record family.
   * @param tx Active native transaction.
   * @returns Completion after final audit rows are staged.
   */
  private async appendAgentAudit(
    tx: ReturnType<Datastore["transaction"]>,
    staged: NativeRow[],
    storage: DatastoreRecordStorage<string, AgentHistoryRecord>,
    id: unknown,
    history: readonly AgentHistoryEntry[],
  ): Promise<void> {
    for (const entry of history) {
      if (AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(entry)).length > 1500)
        throw new RangeError("Agent history order exceeds Datastore indexed-value capacity.");
      const record = AgentHistoryRecords.record(
        this.input.stateSchema.typeName,
        this.input.id.key(id),
        entry,
      );
      await this.agentImmutable(tx, staged, storage, record);
    }
  }

  /**
   * Reads a native row within the Agent transaction.
   * @param tx Active native transaction.
   * @param storage Retained record family.
   * @param id Typed record identifier.
   * @returns Decoded row or absence.
   * @typeParam Id Typed record identifier.
   * @typeParam R Generated record.
   */
  private async agentRead<Id, R extends Message>(
    tx: ReturnType<Datastore["transaction"]>,
    storage: DatastoreRecordStorage<Id, R>,
    id: Id,
  ): Promise<R | undefined> {
    const raw = NativeTransactions.first(
      (await tx.get(storage.transactionKey(id), { wrapNumbers: true })) as unknown,
    ) as Record<string | symbol, unknown> | undefined;
    return raw === undefined ? undefined : storage.decodeTransactionEntity(raw);
  }

  /**
   * Checks one immutable final record before staging it.
   * @param tx Active native transaction.
   * @param staged Collected native rows.
   * @param storage Retained record family.
   * @param record Proposed immutable record.
   * @typeParam Id Typed record identifier.
   * @typeParam R Generated record.
   * @returns Completion after the immutable row is checked and staged.
   */
  private async agentImmutable<Id, R extends Message>(
    tx: ReturnType<Datastore["transaction"]>,
    staged: NativeRow[],
    storage: DatastoreRecordStorage<Id, R>,
    record: R,
  ): Promise<void> {
    const raw = NativeTransactions.first(
      (await tx.get(storage.transactionEntity(record).key, { wrapNumbers: true })) as unknown,
    ) as Record<string | symbol, unknown> | undefined;
    if (raw === undefined) staged.push(storage.transactionEntity(record));
    else if (!storage.matchesTransactionEntity(raw, record))
      throw new Error("Immutable Agent history record has divergent content.");
  }

  /**
   * Checks an enabled native history family.
   * @param storage Optional native family.
   * @returns Enabled native record family.
   * @typeParam Id Typed record ID.
   * @typeParam R Generated record.
   */
  private requiredNative<Id, R extends Message>(
    storage: DatastoreRecordStorage<Id, R> | undefined,
  ): DatastoreRecordStorage<Id, R> {
    if (storage === undefined) throw new Error("Agent Entity history storage is disabled.");
    return storage;
  }

  /**
   * Persists an admitted captured mutation and one safe retry.
   *
   * @param prepared The immutable prepared mutation.
   * @returns Completion after the captured mutation is persisted.
   * @typeParam I Entity identifier or record type.
   * @typeParam S Generated Entity state message type.
   */
  private async persist<I, S extends Message>(prepared: EntityCommitInput<I, S>): Promise<void> {
    const [current, states, diagnostics, events] = this.openCommit(prepared);
    try {
      await this.apply(prepared, current, states, diagnostics, events);
    } catch (error) {
      if (!this.retryable(error)) throw error;
      await this.apply(prepared, current, states, diagnostics, events);
    }
  }

  /**
   * Acquires only missing requested families and rolls back a failed group.
   *
   * @param input The captured Entity persistence input.
   * @returns The retained records required by this commit.
   * @typeParam I Entity identifier or record type.
   * @typeParam S Generated Entity state message type.
   */
  private openCommit<I, S extends Message>(input: EntityCommitInput<I, S>): CommitFamilies<I> {
    const acquired: { close(): void }[] = [];
    try {
      const current = this.#current ?? this.openRecords(this.input.recordSpec);
      if (this.#current === undefined) acquired.push(current);
      const stateLayout = stateHistorySpec(this.input.stateSchema);
      const diagnosticLayout = eventHistorySpec(this.input.stateSchema);
      const states = input.states?.length
        ? (this.#states ?? this.openRecords(stateLayout.spec, stateLayout.group))
        : undefined;
      if (states !== undefined && this.#states === undefined) acquired.push(states);
      const diagnostics = input.diagnostics?.length
        ? (this.#diagnostics ?? this.openRecords(diagnosticLayout.spec, diagnosticLayout.group))
        : undefined;
      if (diagnostics !== undefined && this.#diagnostics === undefined) acquired.push(diagnostics);
      const events = input.events?.length
        ? (this.#events ??
          this.openRecords(
            eventStoreRecordSpec,
            EventStoreGroups.forContext(this.input.context.name),
          ))
        : undefined;
      if (events !== undefined && this.#events === undefined) acquired.push(events);
      this.#current = current;
      this.#states ??= states;
      this.#diagnostics ??= diagnostics;
      this.#events ??= events;
      return [current as RecordStorage<I, EntityRecord>, states, diagnostics, events];
    } catch (error) {
      const failures = this.closeGroup(acquired);
      if (failures.length)
        throw new AggregateError([error, ...failures], "Datastore family acquisition failed.");
      throw error;
    }
  }

  /**
   * Writes independent record families in Entity commit order.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state message type.
   * @param input Supplies immutable prepared records.
   * @param current Stores current Entity state.
   * @param states Stores state history when requested.
   * @param diagnostics Stores diagnostic Events when requested.
   * @param events Stores delivery Events when requested.
   * @returns Completion after every requested record write.
   */
  private async apply<I, S extends Message>(
    input: EntityCommitInput<I, S>,
    current: RecordStorage<I, EntityRecord>,
    states:
      | RecordStorage<
          import("@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js").EntityStateKey,
          EntityRecord
        >
      | undefined,
    diagnostics: RecordStorage<import("@spine-event-engine/proto").EventId, Event> | undefined,
    events: RecordStorage<import("@spine-event-engine/proto").EventId, Event> | undefined,
  ): Promise<void> {
    if (states !== undefined)
      for (const record of input.states ?? []) await immutable(states, record);
    if (diagnostics !== undefined)
      for (const event of input.diagnostics ?? []) await immutable(diagnostics, event);
    if (events !== undefined)
      for (const event of input.events ?? []) await immutable(events, event);
    const previous = await current.read(input.entityId);
    if (
      previous === undefined ||
      !same(toBinary(EntityRecordSchema, previous), toBinary(EntityRecordSchema, input.next))
    )
      await current.write(input.next);
  }

  /**
   * Determines whether a Datastore abort occurred through provider error causes.
   *
   * @param error Supplies the operation failure.
   * @returns Whether one captured-input replay is safe.
   */
  private retryable(error: unknown): boolean {
    let current = error;
    for (let depth = 0; depth < 4; depth += 1) {
      if (typeof current !== "object" || current === null) return false;
      const failure = current as { code?: unknown; cause?: unknown };
      if (failure.code === 10) return true;
      current = failure.cause;
    }
    return false;
  }

  /**
   * Closes this commit storage to further commits.
   *
   * @returns Completion after admitted work and record cleanup settle.
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
    this.assertIdle();
    if (this.#idleOutcome !== undefined) {
      if (this.#idleOutcome.error !== undefined) throw this.#idleOutcome.error;
      return;
    }
    this.#open = false;
    const failure = this.closeRetained();
    this.#idleOutcome = failure === undefined ? {} : { error: failure };
    this.onClose();
    if (failure !== undefined) throw failure;
  }

  /**
   * Rejects synchronous disposal while asynchronous work remains admitted.
   */
  assertIdle(): void {
    if (this.#active.size || (this.#closing !== undefined && this.#idleOutcome === undefined))
      throw new Error("Entity commit cannot close idle while work is active.");
  }

  /**
   * Waits for every admitted commit before completing close.
   *
   * @returns Completion after admitted work and cleanup settle.
   */
  private async drain(): Promise<void> {
    await Promise.allSettled([...this.#active]);
    const failure = this.closeRetained();
    this.onClose();
    if (failure !== undefined) throw failure;
  }

  /**
   * Closes every retained record once after admitted work settles.
   *
   * @returns A cleanup failure, if any.
   */
  private closeRetained(): Error | undefined {
    const ports = [
      this.#events,
      this.#diagnostics,
      this.#states,
      this.#history,
      this.#preferences,
      this.#current,
    ].filter((port) => port !== undefined);
    this.#events = undefined;
    this.#diagnostics = undefined;
    this.#states = undefined;
    this.#history = undefined;
    this.#preferences = undefined;
    this.#current = undefined;
    const failures = this.closeGroup(ports);
    if (failures.length === 1) return failures[0] as Error;
    return failures.length
      ? new AggregateError(failures, "Datastore commit close failed.")
      : undefined;
  }

  /**
   * Closes every newly acquired handle and collects cleanup failures.
   *
   * @param ports The acquired record handles.
   * @returns Cleanup failures from acquired handles.
   */
  private closeGroup(ports: readonly { close(): void }[]): unknown[] {
    const failures: unknown[] = [];
    for (const port of ports) {
      try {
        port.close();
      } catch (error) {
        failures.push(error);
      }
    }
    return failures;
  }

  /**
   * Validates the Entity, tenant, history, and Event boundaries of a commit.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input Supplies the proposed commit.
   */
  private validate<I, S extends Message>(input: EntityCommitInput<I, S>): void {
    if (
      input.entity.sourceType.typeName !== this.input.sourceType.typeName ||
      input.entity.stateSchema.typeName !== this.input.stateSchema.typeName ||
      TenantBoundary.of(input.context).key !== TenantBoundary.of(this.input.context).key ||
      TenantBoundary.of(input.entity.context).key !== TenantBoundary.of(this.input.context).key
    )
      throw new Error("Entity commit handle cannot commit another Entity source or tenant.");
    validateCommitEntityId(input);
    if ((input.states?.length ?? 0) > 0 && (!this.input.stateHistory || !input.entity.stateHistory))
      throw new Error("Entity commit cannot append state history when it is disabled.");
    if (
      (input.diagnostics?.length ?? 0) > 0 &&
      (!this.input.eventHistory || !input.entity.eventHistory)
    )
      throw new Error("Entity commit cannot append event history when it is disabled.");
    validateEvents(input.events ?? []);
  }
}

/**
 * Provides the current Entity records through one record-family handle.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 */
class CurrentStorage<I, S extends Message> implements EntityRecordStorage<I> {
  /**
   * Creates current-record access for one Entity storage contract.
   *
   * @param input Defines the Entity identity and columns.
   * @param records Provides current Entity record storage.
   */
  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: RecordStorage<I, EntityRecord>,
  ) {}

  /**
   * Reads one current Entity record.
   *
   * @param id Identifies the Entity.
   * @returns The current record, or undefined when none is stored.
   */
  read(id: I): Promise<EntityRecord | undefined> {
    return this.records.read(id);
  }

  /**
   * Stores the current record for its Entity.
   *
   * @param record Supplies the current Entity record.
   * @returns Completion after the record is stored.
   */
  async write(record: EntityRecord): Promise<void> {
    const id = record.entityId === undefined ? undefined : this.input.id.unpack(record.entityId);
    if (id === undefined)
      throw new Error("Entity current record ID does not match its Entity ID schema.");
    await this.records.write(record);
  }

  /**
   * Returns current Entity records and their configured columns.
   *
   * @param plan Specifies the normalized query.
   * @returns Matching Entity records and column values.
   */
  async query(plan: import("@spine-event-engine/storage").NormalizedQueryPlan<I>) {
    return (await this.records.queryPlanEntries(plan)).map((entry) => ({
      ...entry,
      columns: new Map(
        this.input.columns.map((column) => [column.name, column.valueIn(entry.record)]),
      ),
    }));
  }
}

/**
 * Provides retained Entity state history through one record-family handle.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 */
class StateHistory<I, S extends Message> implements EntityStateHistoryPort<I, S> {
  /**
   * Creates state-history access for one Entity storage contract.
   *
   * @param input Defines the Entity identity and state schema.
   * @param records Provides retained state-history records.
   */
  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: RecordStorage<
      import("@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js").EntityStateKey,
      EntityRecord
    >,
  ) {}

  /**
   * Stores one immutable state-history record.
   *
   * @param record Supplies the state-history record.
   * @returns Completion after the record is retained.
   */
  append(record: EntityRecord): Promise<void> {
    this.requireOpen();
    return immutable(this.records, record);
  }

  /**
   * Reads recent state-history records in reverse order.
   *
   * @param id Identifies the Entity.
   * @param depth Sets the maximum number of records to read.
   * @param from Sets an optional upper version bound.
   * @returns Matching records from newest to oldest.
   */
  async backward(id: I, depth: number, from?: bigint): Promise<readonly EntityRecord[]> {
    this.requireOpen();
    requireDepth(depth);
    return this.pages(
      [
        entityFilter(this.input, id),
        ...(from === undefined ? [] : [numberFilter("version", "<=", from)]),
      ],
      [
        { property: "version", direction: "desc" },
        { property: "created", direction: "desc" },
      ],
      depth,
    );
  }

  /**
   * Reads the Entity state recorded at or before a time.
   *
   * @param id Identifies the Entity.
   * @param time Sets the latest creation time to include.
   * @returns The matching state, or undefined when none exists.
   */
  async stateAt(id: I, time: Timestamp): Promise<S | undefined> {
    this.requireOpen();
    const page = await this.provider().queryProviderPage({
      filters: [entityFilter(this.input, id), timestampFilter("created", "<=", time)],
      order: [
        { property: "created", direction: "desc" },
        { property: "version", direction: "desc" },
      ],
      limit: 1,
    });
    const found = page.entries[0]?.record;
    return found?.state === undefined
      ? undefined
      : AnyPacker.unpack(found.state, this.input.stateSchema);
  }

  /**
   * Stores no more than the newest state-history records for an Entity.
   *
   * @param id Identifies the Entity.
   * @param keep Sets the number of newest records to retain.
   * @returns Completion after older records are removed.
   */
  async trim(id: I, keep: number): Promise<void> {
    this.requireOpen();
    requireKeep(keep);
    let retained = 0;
    let cursor: DatastorePageCursor | undefined;
    for (;;) {
      const page = await this.provider().queryProviderPage({
        filters: [entityFilter(this.input, id)],
        order: [
          { property: "version", direction: "desc" },
          { property: "created", direction: "desc" },
        ],
        limit: 128,
        ...(cursor === undefined ? {} : { cursor }),
      });
      const retainHere = Math.min(page.entries.length, Math.max(0, keep - retained));
      retained += retainHere;
      const removable = page.entries.slice(retainHere);
      await this.provider().deleteProviderEntries(removable);
      if (!page.hasMore) break;
      cursor = page.cursor;
    }
  }

  /**
   * Removes state-history records created before a time.
   *
   * @param time Sets the exclusive creation-time boundary.
   * @returns Completion after matching records are removed.
   */
  async truncate(time: Timestamp): Promise<void> {
    this.requireOpen();
    for (;;) {
      const page = await this.provider().queryProviderPage({
        filters: [timestampFilter("created", "<", time)],
        order: [
          { property: "created", direction: "asc" },
          { property: "version", direction: "asc" },
        ],
        limit: 128,
      });
      await this.provider().deleteProviderEntries(page.entries);
      if (!page.hasMore) break;
    }
  }

  /**
   * Closes the state-history record handle.
   */
  close(): void {
    this.records.close();
  }

  /**
   * Returns the Datastore provider for state-history queries.
   *
   * @returns The typed Datastore record-storage handle.
   */
  private provider(): DatastoreRecordStorage<
    import("@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js").EntityStateKey,
    EntityRecord
  > {
    return this.records as DatastoreRecordStorage<
      import("@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js").EntityStateKey,
      EntityRecord
    >;
  }

  /**
   * Rejects operations after the record handle closes.
   */
  private requireOpen(): void {
    if (!this.records.isOpen()) throw new Error("Entity history storage is closed.");
  }

  /**
   * Reads a bounded sequence of matching state-history pages.
   *
   * @param filters Specifies the Datastore filters.
   * @param order Specifies the Datastore sort order.
   * @param depth Sets the maximum number of records to read.
   * @returns Matching records in page order.
   */
  private async pages(
    filters: readonly import("./record-storage.js").DatastoreRangeFilter[],
    order: readonly { readonly property: string; readonly direction: "asc" | "desc" }[],
    depth: number,
  ): Promise<readonly EntityRecord[]> {
    const result: EntityRecord[] = [];
    let cursor: DatastorePageCursor | undefined;
    for (;;) {
      const page = await this.provider().queryProviderPage({
        filters,
        order,
        ...(cursor === undefined ? {} : { cursor }),
        limit: Math.min(128, depth - result.length),
      });
      result.push(...page.entries.map((entry) => clone(EntityRecordSchema, entry.record)));
      cursor = page.cursor;
      if (!page.hasMore || result.length === depth) break;
    }
    return result;
  }
}

/**
 * Provides retained Entity Event history through one record-family handle.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 */
class EventHistory<I, S extends Message> implements EntityEventHistoryPort<I> {
  /**
   * Creates Event-history access for one Entity storage contract.
   *
   * @param input Defines the Entity identity and state schema.
   * @param records Provides retained Event-history records.
   */
  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: RecordStorage<import("@spine-event-engine/proto").EventId, Event>,
  ) {}

  /**
   * Stores one immutable Entity Event-history record.
   *
   * @param event Supplies the Event-history record.
   * @returns Completion after the Event is retained.
   */
  append(event: Event): Promise<void> {
    this.requireOpen();
    return immutable(this.records, event);
  }

  /**
   * Reads recent Entity Events in reverse order.
   *
   * @param id Identifies the Entity.
   * @param depth Sets the maximum number of Events to read.
   * @param from Sets an optional upper version bound.
   * @returns Matching Events from newest to oldest.
   */
  async backward(id: I, depth: number, from?: bigint): Promise<readonly Event[]> {
    this.requireOpen();
    requireDepth(depth);
    const result: Event[] = [];
    let cursor: DatastorePageCursor | undefined;
    for (;;) {
      const page = await this.provider().queryProviderPage({
        filters: [
          entityFilter(this.input, id),
          ...(from === undefined ? [] : [numberFilter("version", "<=", from)]),
        ],
        order: [
          { property: "version", direction: "desc" },
          { property: "created", direction: "desc" },
        ],
        ...(cursor === undefined ? {} : { cursor }),
        limit: Math.min(128, depth - result.length),
      });
      result.push(...page.entries.map((entry) => clone(EventSchema, entry.record)));
      cursor = page.cursor;
      if (!page.hasMore || result.length === depth) break;
    }
    return result;
  }

  /**
   * Removes Entity Events created before a time.
   *
   * @param time Sets the exclusive creation-time boundary.
   * @returns Completion after matching Events are removed.
   */
  async truncate(time: Timestamp): Promise<void> {
    this.requireOpen();
    for (;;) {
      const page = await this.provider().queryProviderPage({
        filters: [timestampFilter("created", "<", time)],
        order: [
          { property: "created", direction: "asc" },
          { property: "version", direction: "asc" },
        ],
        limit: 128,
      });
      await this.provider().deleteProviderEntries(page.entries);
      if (!page.hasMore) break;
    }
  }

  /**
   * Closes the Event-history record handle.
   */
  close(): void {
    this.records.close();
  }

  /**
   * Returns the Datastore provider for Event-history queries.
   *
   * @returns The typed Datastore record-storage handle.
   */
  private provider(): DatastoreRecordStorage<import("@spine-event-engine/proto").EventId, Event> {
    return this.records as DatastoreRecordStorage<
      import("@spine-event-engine/proto").EventId,
      Event
    >;
  }

  /**
   * Rejects operations after the record handle closes.
   */
  private requireOpen(): void {
    if (!this.records.isOpen()) throw new Error("Entity history storage is closed.");
  }
}

/**
 * Stores a history record once and rejects divergent content for its ID.
 *
 * @typeParam I Record identifier type.
 * @typeParam R Stored Protobuf message type.
 * @param records Provides immutable history record storage.
 * @param record Supplies the history record to retain.
 * @returns Completion after the record is present.
 */
async function immutable<I, R extends Message>(
  records: RecordStorage<I, R>,
  record: R,
): Promise<void> {
  const id = records.recordSpec.idValueIn(record);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await records.compareAndSet(id, undefined, record)) return;
    const existing = await records.read(id);
    if (existing === undefined) continue;
    if (
      !same(
        toBinary(records.recordSpec.recordType, existing),
        toBinary(records.recordSpec.recordType, record),
      )
    )
      throw new Error("Immutable history record has divergent content.");
    return;
  }
  throw new Error("Immutable history record was not retained.");
}

function same(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function requireDepth(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error("History depth must be a positive safe integer.");
}
function requireKeep(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("History retention must be a non-negative safe integer.");
}

/**
 * Creates a Datastore filter for one Entity identifier.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 * @param input Defines the Entity ID schema.
 * @param id Identifies the Entity to match.
 * @returns The Datastore Entity ID filter.
 */
function entityFilter<I, S extends Message>(
  input: EntityStorageInput<I, S>,
  id: I,
): import("./record-storage.js").DatastoreRangeFilter {
  return { property: "entity_id", operator: "=", value: input.id.pack(id) };
}

function numberFilter(
  property: string,
  operator: "=" | "<" | "<=" | ">" | ">=",
  value: bigint,
): import("./record-storage.js").DatastoreRangeFilter {
  return { property, operator, value };
}

function timestampFilter(
  property: string,
  operator: "=" | "<" | "<=" | ">" | ">=",
  value: Timestamp,
): import("./record-storage.js").DatastoreRangeFilter {
  return { property, operator, value };
}
function validateEvents(events: readonly Event[]): void {
  const ids = events.map((event) => event.id?.value);
  if (
    ids.some((id) => id === undefined || id.trim().length === 0) ||
    new Set(ids).size !== ids.length
  )
    throw new Error("Entity commit requires non-blank unique delivery-event IDs.");
}

/**
 * Checks that current and history records identify the committed Entity.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 * @param input Supplies the Entity commit to check.
 */
function validateCommitEntityId<I, S extends Message>(input: EntityCommitInput<I, S>): void {
  const nextId =
    input.next.entityId === undefined ? undefined : input.entity.id.unpack(input.next.entityId);
  if (nextId === undefined || input.entity.id.key(nextId) !== input.entity.id.key(input.entityId))
    throw new Error("Entity commit current record ID does not match the committed Entity ID.");
  for (const record of input.states ?? []) {
    const stateId =
      record.entityId === undefined ? undefined : input.entity.id.unpack(record.entityId);
    if (
      stateId === undefined ||
      input.entity.id.key(stateId) !== input.entity.id.key(input.entityId)
    )
      throw new Error(
        "Entity commit state-history record ID does not match the committed Entity ID.",
      );
  }
  for (const event of input.diagnostics ?? []) {
    const producer = event.context?.producerId;
    const eventId = producer === undefined ? undefined : input.entity.id.unpack(producer);
    if (
      eventId === undefined ||
      input.entity.id.key(eventId) !== input.entity.id.key(input.entityId)
    )
      throw new Error("Entity commit diagnostic event ID does not match the committed Entity ID.");
  }
}
