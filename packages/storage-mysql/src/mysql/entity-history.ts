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

import { create, fromBinary, type Message } from "@bufbuild/protobuf";
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

interface EntityFamilyCommitCapability<I> {
  prepare(): Promise<void>;
  tableNames(): readonly string[];
  withConnection<T>(
    connection: import("mysql2/promise").PoolConnection,
    work: () => Promise<T>,
  ): Promise<T>;
  readCurrentLocked(id: I): Promise<EntityRecord | undefined>;
  preflightImmutable(states: readonly EntityRecord[], diagnostics: readonly Event[]): Promise<void>;
  appendStateImmutable(record: EntityRecord): Promise<void>;
  appendDiagnosticImmutable(record: Event): Promise<void>;
}

/**
 * Describes MySQL-backed Entity record-family handles.
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
 */
export class MysqlEntityStorage<I, S extends Message> implements MysqlEntityStorageHandle<I, S> {
  // prettier-ignore

  /**
   * Exposes current Entity records.
   */
  readonly current: EntityRecordStorage<I>;
  readonly #current: CurrentStorage<I, S>;
  readonly #states: States<I, S> | undefined;
  readonly #events: Events<I, S> | undefined;

  /**
   * Exposes Entity state history records.
   */
  readonly states: EntityStateHistoryPort<I, S>;

  /**
   * Exposes Entity event history records.
   */
  readonly events: EntityEventHistoryPort<I>;
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
    open: <Id, R extends Message>(
      spec: RecordSpec<Id, R>,
      group?: import("@spine-event-engine/storage").StorageGroup,
    ) => MysqlRecordStorage<Id, R>,
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
   * Reads the current Entity record while the coordinator owns its row lock.
   *
   * @param id Identifies the Entity.
   * @returns Resolves to the current record when present.
   */
  readCurrentLocked(id: I): Promise<EntityRecord | undefined> {
    return this.#current.readLocked(id);
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
   * Binds all Entity handles to one connection for work.
   *
   * @param connection Provides the coordinator-owned connection.
   * @param work Performs the bound storage work.
   * @returns Returns the work result.
   */
  async withConnection<T>(
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
   * Returns the physical tables used by the Entity families.
   *
   * @returns Returns the resolved table names.
   */
  tableNames(): readonly string[] {
    const result = [this.#current.tableName()];
    if (this.#states !== undefined) result.push(this.#states.tableName());
    if (this.#events !== undefined) result.push(this.#events.tableName());
    return result;
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
   * Checks immutable state and diagnostic records before a nontransactional write.
   *
   * @param states Lists state history records to check.
   * @param diagnostics Lists diagnostic history records to check.
   * @returns Resolves when every record is compatible.
   */
  async preflightImmutable(
    states: readonly EntityRecord[],
    diagnostics: readonly Event[],
  ): Promise<void> {
    for (const state of states) await this.#states?.assertImmutable(state);
    for (const diagnostic of diagnostics) await this.#events?.assertImmutable(diagnostic);
  }

  /**
   * Exposes the private MySQL operations required by atomic Entity commit.
   *
   * @internal
   * @returns Returns the private Entity-family commit capability.
   */
  commitCapability(): EntityFamilyCommitCapability<I> {
    return {
      prepare: () => this.prepare(),
      tableNames: () => this.tableNames(),
      withConnection: (connection, work) => this.withConnection(connection, work),
      readCurrentLocked: (id) => this.#current.readLocked(id),
      preflightImmutable: (states, diagnostics) => this.preflightImmutable(states, diagnostics),
      appendStateImmutable: (record) => this.#states?.appendImmutable(record) ?? Promise.resolve(),
      appendDiagnosticImmutable: (record) =>
        this.#events?.appendImmutable(record) ?? Promise.resolve(),
    };
  }
}
class CurrentStorage<I, S extends Message> implements EntityRecordStorage<I> {
  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: MysqlRecordStorage<I, EntityRecord>,
  ) {}
  read(id: I): Promise<EntityRecord | undefined> {
    return this.records.read(id);
  }
  readLocked(id: I): Promise<EntityRecord | undefined> {
    return this.records.readLocked(id);
  }
  write(record: EntityRecord): Promise<void> {
    return this.records.write(record);
  }
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
  withConnection<T>(
    connection: import("mysql2/promise").PoolConnection,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.records.withConnection(connection, work);
  }
  tableName(): string {
    return this.records.tableName;
  }
  prepare(): Promise<void> {
    return this.records.prepare();
  }
  close(): void {
    this.records.close();
  }
}
class States<I, S extends Message> implements EntityStateHistoryPort<I, S> {
  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: MysqlRecordStorage<EntityStateKey, EntityRecord>,
  ) {}
  append(record: EntityRecord): Promise<void> {
    return this.records.write(record);
  }
  appendImmutable(record: EntityRecord): Promise<void> {
    return this.records.writeImmutable(record);
  }
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
      : fromBinary(this.input.stateSchema, found.state.value);
  }
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
  close(): void {
    this.records.close();
  }
  withConnection<T>(
    connection: import("mysql2/promise").PoolConnection,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.records.withConnection(connection, work);
  }
  tableName(): string {
    return this.records.tableName;
  }
  assertImmutable(record: EntityRecord): Promise<void> {
    return this.records.assertImmutable(record);
  }
  prepare(): Promise<void> {
    return this.records.prepare();
  }
}
class Events<I, S extends Message> implements EntityEventHistoryPort<I> {
  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: MysqlRecordStorage<EventId, Event>,
  ) {}
  append(record: Event): Promise<void> {
    return this.records.write(record);
  }
  appendImmutable(record: Event): Promise<void> {
    return this.records.writeImmutable(record);
  }
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
  close(): void {
    this.records.close();
  }
  withConnection<T>(
    connection: import("mysql2/promise").PoolConnection,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.records.withConnection(connection, work);
  }
  tableName(): string {
    return this.records.tableName;
  }
  assertImmutable(record: Event): Promise<void> {
    return this.records.assertImmutable(record);
  }
  prepare(): Promise<void> {
    return this.records.prepare();
  }
}
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
function disabledEvents<I>(): EntityEventHistoryPort<I> {
  return {
    append: () => Promise.reject(new Error("Entity event history is disabled.")),
    backward: () => Promise.resolve([]),
    truncate: () => Promise.resolve(),
    close: () => undefined,
  };
}
function sameEntityId<I, S extends Message>(
  input: EntityStorageInput<I, S>,
  packed: NonNullable<EntityRecord["entityId"]>,
  expected: I,
): boolean {
  const decoded = input.id.unpack(packed);
  return decoded !== undefined && input.id.key(decoded) === input.id.key(expected);
}
