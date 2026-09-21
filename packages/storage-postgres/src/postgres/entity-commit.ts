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

import { PostgresStorageOperationError, PostgresTransactionErrors } from "./errors.js";
import {
  PostgresRecordStorage,
  type PostgresRecordExecutor,
  type PostgresRecordLifecycle,
} from "./record-storage.js";

/**
 * Acquires fresh clients for a complete Entity transaction and one safe retry.
 */
class PostgresEntityCommitCoordinator {
  constructor(private readonly lifecycle: PostgresRecordLifecycle) {}
  async commit<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const client = await this.lifecycle.acquire();
      try {
        await client.query("BEGIN");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (attempt === 0 && PostgresTransactionErrors.retryable(error)) continue;
        throw PostgresCommitErrors.operation(error);
      } finally {
        client.release();
      }
    }
    throw new Error("Unreachable PostgreSQL Entity commit retry.");
  }
}

type OpenRecords = <I, R extends Message>(
  spec: RecordSpec<I, R>,
  group?: StorageGroup,
) => PostgresRecordStorage<I, R>;

/**
 * Opens and closes the exact record families participating in one commit.
 */
class PostgresCommitRecords<I, S extends Message> {
  readonly current: PostgresRecordExecutor<I, EntityRecord>;
  readonly states: PostgresRecordExecutor<EntityStateKey, EntityRecord> | undefined;
  readonly diagnostics: PostgresRecordExecutor<EventId, Event> | undefined;
  readonly events: PostgresRecordExecutor<EventId, Event> | undefined;
  readonly #handles: PostgresRecordStorage<unknown, Message>[];
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
  async prepare(): Promise<void> {
    for (const handle of this.#handles) await handle.prepare();
  }
  close(): void {
    for (const handle of this.#handles) handle.close();
  }
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
  same(left: EntityRecord | undefined, right: EntityRecord | undefined): boolean {
    return left === undefined || right === undefined
      ? left === right
      : Buffer.compare(toBinary(EntityRecordSchema, left), toBinary(EntityRecordSchema, right)) ===
          0;
  },
  sameBoundary(left: object, right: object): boolean {
    return TenantBoundary.of(left as never).key === TenantBoundary.of(right as never).key;
  },
});

const PostgresCommitErrors = Object.freeze({
  operation(error: unknown): PostgresStorageOperationError {
    return error instanceof PostgresStorageOperationError
      ? error
      : new PostgresStorageOperationError("PostgreSQL Entity commit failed.");
  },
});
