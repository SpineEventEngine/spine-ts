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

import { toBinary, type Message } from "@bufbuild/protobuf";
import type { Event, EventId } from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import type { EntityStateKey } from "@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js";
import { type RecordSpec, type StorageGroup } from "@spine-event-engine/storage";
import {
  TenantBoundary,
  eventHistorySpec,
  eventStoreRecordSpec,
  stateHistorySpec,
  type EntityCommitInput,
  type EntityCommitResult,
  type EntityCommitStorage,
  type EntityStorageInput,
} from "@spine-event-engine/storage/provider";
import type { PoolClient } from "pg";

import {
  PostgresRollbackErrors,
  PostgresStorageOperationError,
  PostgresTransactionErrors,
} from "./errors.js";
import {
  PostgresRecordStorage,
  type PostgresRecordExecutor,
  type PostgresRecordLifecycle,
} from "./record-storage.js";

/**
 * Acquires fresh clients for a complete Entity transaction and one safe retry.
 */
class PostgresEntityCommitCoordinator {
  /**
   * Creates a coordinator for one tenant-bound record lifecycle.
   *
   * @param lifecycle Acquires transaction clients for the selected database.
   */
  constructor(private readonly lifecycle: PostgresRecordLifecycle) {}

  /**
   * Commits one complete Entity change with one serialization retry.
   *
   * @typeParam T Result returned by the transaction work.
   * @param work Applies the Entity commit on an acquired client.
   * @returns The committed work result.
   */
  async commit<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const client = await this.lifecycle.acquire();
      let discard: Error | undefined;
      try {
        await client.query("BEGIN");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          discard = PostgresRollbackErrors.discard(error);
        }
        if (attempt === 0 && PostgresTransactionErrors.retryable(error)) continue;
        throw PostgresCommitErrors.operation(error);
      } finally {
        client.release(discard);
      }
    }
    throw new Error("Unreachable PostgreSQL Entity commit retry.");
  }
}

/**
 * Opens one PostgreSQL record family used by an Entity commit.
 *
 * @typeParam I Record identifier type.
 * @typeParam R Stored Protobuf record type.
 */
type OpenRecords = <I, R extends Message>(
  spec: RecordSpec<I, R>,
  group?: StorageGroup,
) => PostgresRecordStorage<I, R>;

/**
 * Opens and closes the exact record families participating in one commit.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 */
class PostgresCommitRecords<I, S extends Message> {
  readonly current: PostgresRecordExecutor<I, EntityRecord>;

  readonly states: PostgresRecordExecutor<EntityStateKey, EntityRecord> | undefined;

  readonly diagnostics: PostgresRecordExecutor<EventId, Event> | undefined;

  readonly events: PostgresRecordExecutor<EventId, Event> | undefined;

  readonly #handles: PostgresRecordStorage<unknown, Message>[];

  /**
   * Opens the current record family and each enabled immutable family.
   *
   * @param input Describes the Entity commit and enabled histories.
   * @param open Opens one record family.
   */
  constructor(input: EntityCommitInput<I, S>, open: OpenRecords) {
    const current = open(input.entity.recordSpec);
    const handles: PostgresRecordStorage<unknown, Message>[] = [current as never];
    this.current = current.historyExecutor();
    this.states = input.states?.length ? this.openState(input, open, handles) : undefined;
    this.diagnostics = input.diagnostics?.length
      ? this.openDiagnostic(input, open, handles)
      : undefined;
    this.events = input.events?.length ? this.openEvents(open, handles) : undefined;
    this.#handles = handles;
  }

  /**
   * Prepares every record family before the transaction begins.
   *
   * @returns Completion after all required tables are ready.
   */
  async prepare(): Promise<void> {
    for (const handle of this.#handles) await handle.prepare();
  }

  /**
   * Closes every temporary record-family handle.
   */
  close(): void {
    for (const handle of this.#handles) handle.close();
  }

  /**
   * Opens the Entity state-history record family.
   *
   * @param input Describes the Entity state schema.
   * @param open Opens one record family.
   * @param handles Collects handles that must close after the commit.
   * @returns The state-history transaction executor.
   */
  private openState(
    input: EntityCommitInput<I, S>,
    open: OpenRecords,
    handles: PostgresRecordStorage<unknown, Message>[],
  ): PostgresRecordExecutor<EntityStateKey, EntityRecord> {
    const layout = stateHistorySpec(input.entity.stateSchema);
    const handle = open(layout.spec, layout.group);
    handles.push(handle as never);
    return handle.historyExecutor();
  }

  /**
   * Opens the Entity diagnostic-event history record family.
   *
   * @param input Describes the Entity state schema.
   * @param open Opens one record family.
   * @param handles Collects handles that must close after the commit.
   * @returns The diagnostic-history transaction executor.
   */
  private openDiagnostic(
    input: EntityCommitInput<I, S>,
    open: OpenRecords,
    handles: PostgresRecordStorage<unknown, Message>[],
  ): PostgresRecordExecutor<EventId, Event> {
    const layout = eventHistorySpec(input.entity.stateSchema);
    const handle = open(layout.spec, layout.group);
    handles.push(handle as never);
    return handle.historyExecutor();
  }

  /**
   * Opens the shared event-store record family.
   *
   * @param open Opens one record family.
   * @param handles Collects handles that must close after the commit.
   * @returns The event-store transaction executor.
   */
  private openEvents(
    open: OpenRecords,
    handles: PostgresRecordStorage<unknown, Message>[],
  ): PostgresRecordExecutor<EventId, Event> {
    const handle = open(eventStoreRecordSpec);
    handles.push(handle as never);
    return handle.historyExecutor();
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

  readonly #coordinator: PostgresEntityCommitCoordinator;

  /**
   * Creates a PostgreSQL Entity commit handle for one Entity storage boundary.
   *
   * @param entity Defines the captured Entity source, state, and tenant scope.
   * @param open Opens temporary current and history record-family handles.
   * @param lifecycle Acquires transaction clients for the captured database.
   * @param onClose Removes this handle from the factory's live-handle set.
   */
  constructor(
    private readonly entity: EntityStorageInput<I, S>,
    private readonly open: OpenRecords,
    lifecycle: PostgresRecordLifecycle,
    private readonly onClose: () => void,
  ) {
    this.#coordinator = new PostgresEntityCommitCoordinator(lifecycle);
  }

  /**
   * Commits one current Entity record and its optional immutable records.
   *
   * @typeParam Id Entity identifier type supplied by the commit.
   * @typeParam State Entity state message type supplied by the commit.
   * @param input Defines the expected and next current records plus histories.
   * @returns Whether PostgreSQL committed the mutation or found a conflict.
   */
  async commit<Id, State extends Message>(
    input: EntityCommitInput<Id, State>,
  ): Promise<EntityCommitResult> {
    this.validate(input);
    const records = new PostgresCommitRecords(input, this.open);
    try {
      await records.prepare();
      return await this.#coordinator.commit((client) => this.apply(client, input, records));
    } finally {
      records.close();
    }
  }

  /**
   * Closes this handle to new commits while allowing started work to settle.
   */
  close(): void {
    if (this.#open) {
      this.#open = false;
      this.onClose();
    }
  }

  /**
   * Applies one validated Entity commit on an active transaction.
   *
   * @typeParam Id Entity identifier type supplied by the commit.
   * @typeParam State Entity state message type supplied by the commit.
   * @param client PostgreSQL transaction client.
   * @param input Defines the Entity records to commit.
   * @param records Provides the prepared record families.
   * @returns Whether records were committed or conflicted.
   */
  private async apply<Id, State extends Message>(
    client: PoolClient,
    input: EntityCommitInput<Id, State>,
    records: PostgresCommitRecords<Id, State>,
  ): Promise<EntityCommitResult> {
    await this.locks(client, input, records);
    const current = await records.current.read(client, input.entityId, "for-update");
    if (
      !PostgresCommitValues.same(current, input.expected) &&
      !PostgresCommitValues.same(current, input.next)
    )
      return "conflict";
    await this.preflight(client, input, records);
    await this.append(client, input, records);
    if (!PostgresCommitValues.same(current, input.next))
      await records.current.write(client, input.next);
    return "committed";
  }

  /**
   * Acquires locks for each mutable or append-only family in the commit.
   *
   * @typeParam Id Entity identifier type supplied by the commit.
   * @typeParam State Entity state message type supplied by the commit.
   * @param client PostgreSQL transaction client.
   * @param input Defines the Entity records to commit.
   * @param records Provides the prepared record families.
   * @returns Completion after all transaction locks are acquired.
   */
  private async locks<Id, State extends Message>(
    client: PoolClient,
    input: EntityCommitInput<Id, State>,
    records: PostgresCommitRecords<Id, State>,
  ): Promise<void> {
    if (records.states)
      await client.query("SELECT pg_advisory_xact_lock_shared($1)", [
        records.states.lock("history-family", records.states.table()),
      ]);
    if (records.diagnostics)
      await client.query("SELECT pg_advisory_xact_lock_shared($1)", [
        records.diagnostics.lock("history-family", records.diagnostics.table()),
      ]);
    await client.query("SELECT pg_advisory_xact_lock($1)", [
      records.current.lock(
        "entity-mutation",
        input.entity.sourceType.typeName,
        this.entity.id.key(input.entityId as never),
      ),
    ]);
  }

  /**
   * Verifies that every immutable record can be appended.
   *
   * @typeParam Id Entity identifier type supplied by the commit.
   * @typeParam State Entity state message type supplied by the commit.
   * @param client PostgreSQL transaction client.
   * @param input Defines the immutable records to verify.
   * @param records Provides the prepared record families.
   * @returns Completion after all immutable checks pass.
   */
  private async preflight<Id, State extends Message>(
    client: PoolClient,
    input: EntityCommitInput<Id, State>,
    records: PostgresCommitRecords<Id, State>,
  ): Promise<void> {
    for (const record of input.states ?? []) await records.states?.assertImmutable(client, record);
    for (const record of input.diagnostics ?? [])
      await records.diagnostics?.assertImmutable(client, record);
    for (const record of input.events ?? []) await records.events?.assertImmutable(client, record);
  }

  /**
   * Stores every immutable history and event-store record.
   *
   * @typeParam Id Entity identifier type supplied by the commit.
   * @typeParam State Entity state message type supplied by the commit.
   * @param client PostgreSQL transaction client.
   * @param input Defines the immutable records to append.
   * @param records Provides the prepared record families.
   * @returns Completion after all records are appended.
   */
  private async append<Id, State extends Message>(
    client: PoolClient,
    input: EntityCommitInput<Id, State>,
    records: PostgresCommitRecords<Id, State>,
  ): Promise<void> {
    for (const record of input.states ?? []) await records.states?.appendImmutable(client, record);
    for (const record of input.diagnostics ?? [])
      await records.diagnostics?.appendImmutable(client, record);
    for (const record of input.events ?? []) await records.events?.appendImmutable(client, record);
  }

  /**
   * Validates the commit against the Entity boundary captured by this handle.
   *
   * @typeParam Id Entity identifier type supplied by the commit.
   * @typeParam State Entity state message type supplied by the commit.
   * @param input Defines the Entity records to validate.
   */
  private validate<Id, State extends Message>(input: EntityCommitInput<Id, State>): void {
    if (!this.#open) throw new PostgresStorageOperationError("Entity commit storage is closed.");
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
    for (const record of [input.expected, input.next, ...(input.states ?? [])]) {
      if (record === undefined) continue;
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

const PostgresCommitErrors = Object.freeze({
  /**
   * Converts an internal commit failure to the stable provider error.
   *
   * @param error Failure raised during the Entity commit.
   * @returns Stable public commit error.
   */
  operation(error: unknown): PostgresStorageOperationError {
    return error instanceof PostgresStorageOperationError
      ? error
      : new PostgresStorageOperationError("PostgreSQL Entity commit failed.");
  },
});
