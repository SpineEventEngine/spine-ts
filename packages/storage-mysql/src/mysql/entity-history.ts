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

import { create, type Message } from "@bufbuild/protobuf";
import { AnyPacker } from "@spine-event-engine/core";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Event, EventId } from "@spine-event-engine/proto";
import type { EntityRecord } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import {
  EntityStateKeySchema,
  type EntityStateKey,
} from "@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js";
import { RecordSpec } from "@spine-event-engine/storage";
import {
  eventHistorySpec,
  stateHistorySpec,
  type EntityEventHistoryPort,
  type EntityRecordStorage,
  type EntityStateHistoryPort,
  type EntityStorageInput,
} from "@spine-event-engine/storage/provider";
import type { NormalizedQueryEntry, NormalizedQueryPlan } from "@spine-event-engine/storage";
import { MysqlRecordStorage } from "./record-storage.js";

/**

 * Opens one MySQL record family for Entity storage.

 */
interface OpenRecords {
  /**
   * Creates a scoped record handle.
   *
   * @typeParam Id Record identifier type.
   * @typeParam R Stored record message type.
   * @param spec Defines the record family.
   * @param group Selects an optional history group.
   * @returns The MySQL record handle.
   */
  // eslint-disable-next-line @typescript-eslint/prefer-function-type -- Documented generic call signature.
  <Id, R extends Message>(
    spec: RecordSpec<Id, R>,
    group?: import("@spine-event-engine/storage").StorageGroup,
  ): MysqlRecordStorage<Id, R>;
}

/**
 * Describes MySQL-backed Entity record-family handles.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 */
export interface MysqlEntityStorageHandle<I, S extends Message> {
  // prettier-ignore

  /**
   * Exposes current Entity records.
   */
  readonly current: EntityRecordStorage<I>;

  /**
   * Exposes Entity state history records.
   */
  readonly states: EntityStateHistoryPort<I, S>;

  /**
   * Exposes Entity event history records.
   */
  readonly events: EntityEventHistoryPort<I>;

  /**
   * Returns whether this Entity storage handle accepts operations.
   *
   * @returns Returns whether the handle is open.
   */
  isOpen(): boolean;

  /**
   * Closes the history record-family handles.
   */
  close(): void;
}

/**
 * Provides MySQL-backed Entity current and history storage.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 */
export class MysqlEntityStorage<I, S extends Message> implements MysqlEntityStorageHandle<I, S> {
  // prettier-ignore

  /**
   * Exposes current Entity records.
   */
  readonly current: EntityRecordStorage<I>;

  /**

   * Current record-family handle.

   */
  readonly #current: CurrentStorage<I, S>;

  /**

   * Optional state-history handle.

   */
  readonly #states: States<I, S> | undefined;

  /**

   * Optional diagnostic-history handle.

   */
  readonly #events: Events<I, S> | undefined;

  /**
   * Exposes Entity state history records.
   */
  readonly states: EntityStateHistoryPort<I, S>;

  /**
   * Exposes Entity event history records.
   */
  readonly events: EntityEventHistoryPort<I>;

  /**

   * Whether this Entity storage accepts operations.

   */
  #open = true;

  /**
   * Creates MySQL-backed Entity storage handles.
   *
   * @param input Configures the Entity storage families.
   * @param open Opens one record-family storage handle.
   * @param onClose Removes this Entity handle from its factory.
   */
  constructor(
    input: EntityStorageInput<I, S>,
    open: OpenRecords,
    private readonly onClose: () => void = () => undefined,
  ) {
    this.#current = new CurrentStorage(input, open(input.recordSpec));
    this.current = this.#current;
    const states = input.stateHistory ? stateHistorySpec(input.stateSchema) : undefined;
    const events = input.eventHistory ? eventHistorySpec(input.stateSchema) : undefined;
    this.#states =
      states === undefined ? undefined : new States(input, open(states.spec, states.group));
    this.#events =
      events === undefined ? undefined : new Events(input, open(events.spec, events.group));
    this.states = this.#states ?? disabledStates();
    this.events = this.#events ?? disabledEvents();
  }

  /**
   * Returns whether this Entity storage handle accepts operations.
   *
   * @returns Returns whether the handle is open.
   */
  isOpen(): boolean {
    return this.#open;
  }

  /**
   * Closes the history record-family handles.
   */
  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#current.close();
    this.states.close();
    this.events.close();
    this.onClose();
  }

  /**
   * Prepares every Entity record-family table.
   *
   * @returns Resolves after the tables are ready.
   */
  async prepare(): Promise<void> {
    await this.#current.prepare();
    await this.#states?.prepare();
    await this.#events?.prepare();
  }

  /**
   * Returns physical Entity-family tables for an Agent transaction.
   *
   * @returns Current and configured history table names.
   */
  tableNames(): readonly string[] {
    return [
      this.#current.tableName(),
      ...(this.#states ? [this.#states.tableName()] : []),
      ...(this.#events ? [this.#events.tableName()] : []),
    ];
  }

  /**
   * Binds Entity-family work to the Agent transaction connection.
   *
   * @typeParam T Result of the bound work.
   * @param connection Active Agent transaction connection.
   * @param work Entity work to run on that connection.
   * @returns Result of the work.
   */
  withConnection<T>(
    connection: import("mysql2/promise").PoolConnection,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.#current.withConnection(connection, () =>
      this.#states === undefined
        ? this.#events === undefined
          ? work()
          : this.#events.withConnection(connection, work)
        : this.#states.withConnection(connection, () =>
            this.#events === undefined ? work() : this.#events.withConnection(connection, work),
          ),
    );
  }

  /**
   * Reads current Entity state with the Agent transaction lock.
   *
   * @param id Typed Entity ID.
   * @returns Current record when present.
   */
  readCurrentLocked(id: I): Promise<EntityRecord | undefined> {
    return this.#current.readLocked(id);
  }

  /**
   * Returns configured Entity history writers for the Agent transaction.
   *
   * @returns Transaction-bound immutable history appenders.
   */
  commitCapability(): {
    appendStateImmutable(record: EntityRecord): Promise<void>;
    appendDiagnosticImmutable(record: Event): Promise<void>;
  } {
    return {
      appendStateImmutable: (record: EntityRecord) =>
        this.#states?.append(record) ?? Promise.resolve(),
      appendDiagnosticImmutable: (record: Event) =>
        this.#events?.append(record) ?? Promise.resolve(),
    };
  }
}

/**
 * Provides current Entity records through a MySQL record family.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 */
class CurrentStorage<I, S extends Message> implements EntityRecordStorage<I> {
  /**
   * Connects the Entity layout to its current-record handle.
   *
   * @param input Defines the Entity layout.
   * @param records Stores current Entity records.
   */
  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: MysqlRecordStorage<I, EntityRecord>,
  ) {}

  /**
   * Returns the current-record table name.
   *
   * @returns Physical table name.
   */
  tableName(): string {
    return this.records.tableName;
  }

  /**
   * Executes current-record work on the Agent transaction connection.
   *
   * @typeParam T Result of the bound work.
   * @param connection Active Agent transaction connection.
   * @param work Current-record work to run.
   * @returns Result of the work.
   */
  withConnection<T>(
    connection: import("mysql2/promise").PoolConnection,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.records.withConnection(connection, work);
  }

  /**
   * Reads and locks one current Entity record.
   *
   * @param id Typed Entity ID.
   * @returns Current record when present.
   */
  readLocked(id: I): Promise<EntityRecord | undefined> {
    return this.records.readLocked(id);
  }

  /**
   * Reads the current record for an Entity ID.
   *
   * @param id Identifies the Entity.
   * @returns The current record when present.
   */
  read(id: I): Promise<EntityRecord | undefined> {
    return this.records.read(id);
  }

  /**
   * Writes the current Entity record.
   *
   * @param record Supplies the next current state.
   * @returns Completion after the write.
   */
  write(record: EntityRecord): Promise<void> {
    return this.records.write(record);
  }

  /**
   * Reads current records with a normalized provider plan.
   *
   * @param plan Supplies filters, ordering, and bounds.
   * @returns Matching records and mapped column values.
   */
  async query(
    plan: NormalizedQueryPlan<I>,
  ): Promise<readonly NormalizedQueryEntry<I, EntityRecord>[]> {
    const entries = await this.records.queryPlanEntries(plan);
    return entries.map((entry) => {
      if (entry.record.entityId === undefined) throw new Error("EntityRecord requires entityId.");
      const id = this.input.id.unpack(entry.record.entityId);
      if (id === undefined) throw new Error("EntityRecord ID does not match storage.");
      return {
        id,
        record: entry.record,
        columns: new Map(
          this.input.columns.map((column) => [column.name, column.valueIn(entry.record)]),
        ),
      };
    });
  }

  /**
   * Prepares the current record table.
   *
   * @returns Completion after table preparation.
   */
  prepare(): Promise<void> {
    return this.records.prepare();
  }

  /**

   * Closes the current record handle.

   */
  close(): void {
    this.records.close();
  }
}

/**
 * Provides retained Entity state history through immutable records.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 */
class States<I, S extends Message> implements EntityStateHistoryPort<I, S> {
  /**
   * Connects the Entity layout to its state-history handle.
   *
   * @param input Defines the Entity ID and state schemas.
   * @param records Stores immutable state-history records.
   */
  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: MysqlRecordStorage<EntityStateKey, EntityRecord>,
  ) {}

  /**
   * Returns the state-history table name.
   *
   * @returns Physical table name.
   */
  tableName(): string {
    return this.records.tableName;
  }

  /**
   * Executes state-history work on the Agent transaction connection.
   *
   * @typeParam T Result of the bound work.
   * @param connection Active Agent transaction connection.
   * @param work State-history work to run.
   * @returns Result of the work.
   */
  withConnection<T>(
    connection: import("mysql2/promise").PoolConnection,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.records.withConnection(connection, work);
  }

  /**
   * Writes one immutable state record.
   *
   * @param record Supplies the retained state.
   * @returns Completion after insertion or identical retry.
   */
  append(record: EntityRecord): Promise<void> {
    return this.records.writeImmutable(record);
  }

  /**
   * Reads retained states backward from an optional version.
   *
   * @param id Identifies the Entity.
   * @param depth Limits returned states.
   * @param startingFromVersion Includes states at or below this version.
   * @returns Matching states in descending version order.
   */
  async backward(
    id: I,
    depth: number,
    startingFromVersion?: bigint,
  ): Promise<readonly EntityRecord[]> {
    const all = await this.records.query({ sort: [{ field: "version", direction: "desc" }] });
    return all
      .filter(
        (record) =>
          record.entityId !== undefined &&
          sameEntityId(this.input, record.entityId, id) &&
          (startingFromVersion === undefined ||
            BigInt(record.version?.number ?? 0) <= startingFromVersion),
      )
      .slice(0, depth);
  }

  /**
   * Reads the latest state at or before a timestamp.
   *
   * @param id Identifies the Entity.
   * @param time Specifies the inclusive timestamp.
   * @returns Decoded state when present.
   */
  async stateAt(id: I, time: Timestamp): Promise<S | undefined> {
    const records = await this.backward(id, Number.MAX_SAFE_INTEGER);
    const found = records.find((record) => {
      const timestamp = record.version?.timestamp;
      return (
        timestamp !== undefined &&
        (timestamp.seconds < time.seconds ||
          (timestamp.seconds === time.seconds && timestamp.nanos <= time.nanos))
      );
    });
    return found?.state === undefined
      ? undefined
      : AnyPacker.unpack(found.state, this.input.stateSchema);
  }

  /**
   * Removes older states beyond the requested retained count.
   *
   * @param id Identifies the Entity.
   * @param keep Counts newest states to retain.
   * @returns Completion after independent deletions.
   */
  async trim(id: I, keep: number): Promise<void> {
    const records = await this.backward(id, Number.MAX_SAFE_INTEGER);
    for (const record of records.slice(keep)) {
      if (record.entityId !== undefined)
        await this.records.delete(
          create(EntityStateKeySchema, {
            entityId: record.entityId,
            version: record.version?.number ?? 0,
          }),
        );
    }
  }

  /**
   * Removes states older than a timestamp.
   *
   * @param olderThan Specifies the exclusive cutoff.
   * @returns Completion after independent deletions.
   */
  async truncate(olderThan: Timestamp): Promise<void> {
    const all = await this.records.query();
    for (const record of all) {
      const timestamp = record.version?.timestamp;
      if (
        timestamp !== undefined &&
        (timestamp.seconds < olderThan.seconds ||
          (timestamp.seconds === olderThan.seconds && timestamp.nanos < olderThan.nanos)) &&
        record.entityId !== undefined
      )
        await this.records.delete(
          create(EntityStateKeySchema, {
            entityId: record.entityId,
            version: record.version?.number ?? 0,
          }),
        );
    }
  }

  /**

   * Closes the state-history handle.

   */
  close(): void {
    this.records.close();
  }

  /**
   * Prepares the state-history table.
   *
   * @returns Completion after table preparation.
   */
  prepare(): Promise<void> {
    return this.records.prepare();
  }
}

/**
 * Provides retained diagnostic Event history through immutable records.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 */
class Events<I, S extends Message> implements EntityEventHistoryPort<I> {
  /**
   * Connects the Entity layout to its diagnostic-history handle.
   *
   * @param input Defines the Entity ID and state schemas.
   * @param records Stores immutable diagnostic Events.
   */
  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: MysqlRecordStorage<EventId, Event>,
  ) {}

  /**
   * Returns the diagnostic Event-history table name.
   *
   * @returns Physical table name.
   */
  tableName(): string {
    return this.records.tableName;
  }

  /**
   * Executes Event-history work on the Agent transaction connection.
   *
   * @typeParam T Result of the bound work.
   * @param connection Active Agent transaction connection.
   * @param work Event-history work to run.
   * @returns Result of the work.
   */
  withConnection<T>(
    connection: import("mysql2/promise").PoolConnection,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.records.withConnection(connection, work);
  }

  /**
   * Writes one immutable diagnostic Event.
   *
   * @param record Supplies the retained Event.
   * @returns Completion after insertion or identical retry.
   */
  append(record: Event): Promise<void> {
    return this.records.writeImmutable(record);
  }

  /**
   * Reads retained Events backward from an optional version.
   *
   * @param id Identifies the producer Entity.
   * @param depth Limits returned Events.
   * @param startingFromVersion Includes Events at or below this version.
   * @returns Matching Events in descending version order.
   */
  async backward(id: I, depth: number, startingFromVersion?: bigint): Promise<readonly Event[]> {
    const all = await this.records.query({ sort: [{ field: "version", direction: "desc" }] });
    return all
      .filter(
        (event) =>
          event.context?.producerId !== undefined &&
          sameEntityId(this.input, event.context.producerId, id) &&
          (startingFromVersion === undefined ||
            BigInt(event.context.version?.number ?? 0) <= startingFromVersion),
      )
      .slice(0, depth);
  }

  /**
   * Removes diagnostic Events older than a timestamp.
   *
   * @param olderThan Specifies the exclusive cutoff.
   * @returns Completion after independent deletions.
   */
  async truncate(olderThan: Timestamp): Promise<void> {
    const all = await this.records.query();
    for (const event of all) {
      const timestamp = event.context?.timestamp;
      if (
        event.id !== undefined &&
        timestamp !== undefined &&
        (timestamp.seconds < olderThan.seconds ||
          (timestamp.seconds === olderThan.seconds && timestamp.nanos < olderThan.nanos))
      )
        await this.records.delete(event.id);
    }
  }

  /**

   * Closes the diagnostic-history handle.

   */
  close(): void {
    this.records.close();
  }

  /**
   * Prepares the diagnostic-history table.
   *
   * @returns Completion after table preparation.
   */
  prepare(): Promise<void> {
    return this.records.prepare();
  }
}

/**
 * Creates a rejecting state-history port when retention is disabled.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 * @returns A disabled state-history port.
 */
function disabledStates<I, S extends Message>(): EntityStateHistoryPort<I, S> {
  return {
    append: () => Promise.reject(new Error("Entity state history is disabled.")),
    backward: () => Promise.resolve([]),
    stateAt: () => Promise.resolve(undefined),
    trim: () => Promise.resolve(),
    truncate: () => Promise.resolve(),
    close: () => undefined,
  };
}

/**
 * Creates a rejecting diagnostic-history port when retention is disabled.
 *
 * @typeParam I Entity identifier type.
 * @returns A disabled diagnostic-history port.
 */
function disabledEvents<I>(): EntityEventHistoryPort<I> {
  return {
    append: () => Promise.reject(new Error("Entity event history is disabled.")),
    backward: () => Promise.resolve([]),
    truncate: () => Promise.resolve(),
    close: () => undefined,
  };
}

/**
 * Compares a packed producer ID with an Entity identifier.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 * @param input Supplies the Entity ID codec.
 * @param packed Supplies the stored producer ID.
 * @param expected Supplies the requested Entity ID.
 * @returns Whether both IDs address the same Entity.
 */
function sameEntityId<I, S extends Message>(
  input: EntityStorageInput<I, S>,
  packed: NonNullable<EntityRecord["entityId"]>,
  expected: I,
): boolean {
  const decoded = input.id.unpack(packed);
  return decoded !== undefined && input.id.key(decoded) === input.id.key(expected);
}
