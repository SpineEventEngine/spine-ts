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
  EntityCommitSnapshots,
  eventHistorySpec,
  eventStoreRecordSpec,
  stateHistorySpec,
  type EntityCommitInput,
  type EntityCommitStorage,
  type EntityStorageInput,
} from "@spine-event-engine/storage/provider";
import { PostgresStorageErrors, PostgresStorageOperationError } from "./errors.js";
import { PostgresRecordStorage } from "./record-storage.js";

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
  readonly current: PostgresRecordStorage<I, EntityRecord>;

  readonly states: PostgresRecordStorage<EntityStateKey, EntityRecord> | undefined;

  readonly diagnostics: PostgresRecordStorage<EventId, Event> | undefined;

  readonly events: PostgresRecordStorage<EventId, Event> | undefined;

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
    this.current = current;
    this.states = input.states?.length ? this.openState(input, open, handles) : undefined;
    this.diagnostics = input.diagnostics?.length
      ? this.openDiagnostic(input, open, handles)
      : undefined;
    this.events = input.events?.length ? this.openEvents(open, handles) : undefined;
    this.#handles = handles;
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
   * Opens the Entity diagnostic-event history record family.
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
   * Opens the shared event-store record family.
   *
   * @param open Opens one record family.
   * @param handles Collects handles that must close after the commit.
   * @returns The event-store record storage.
   */
  private openEvents(
    open: OpenRecords,
    handles: PostgresRecordStorage<unknown, Message>[],
  ): PostgresRecordStorage<EventId, Event> {
    const handle = open(eventStoreRecordSpec);
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

  /**
   * Creates a PostgreSQL Entity commit handle for one Entity storage boundary.
   *
   * @param entity Defines the captured Entity source, state, and tenant scope.
   * @param open Opens temporary current and history record-family handles.
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
  async commit<Id, State extends Message>(input: EntityCommitInput<Id, State>): Promise<void> {
    this.validate(input);
    const prepared = EntityCommitSnapshots.capture(input);
    const records = new PostgresCommitRecords(prepared, this.open);
    try {
      await records.prepare();
      try {
        await this.apply(prepared, records);
      } catch (error) {
        if (!this.retryable(error)) throw error;
        await this.apply(prepared, records);
      }
    } catch (error) {
      throw PostgresStorageErrors.operation(error);
    } finally {
      records.close();
    }
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
   */
  close(): void {
    if (this.#open) {
      this.#open = false;
      this.onClose();
    }
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
