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

import { fromBinary, type Message } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Event, EventId } from "@spine-event-engine/proto";
import type { EntityRecord } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import type { EntityStateKey } from "@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js";
import type {
  EntityEventHistoryPort,
  EntityRecordStorage,
  EntityStateHistoryPort,
  EntityStorageInput,
} from "@spine-event-engine/storage/provider";
import {
  disabledEventHistoryPort,
  disabledStateHistoryPort,
  eventHistorySpec,
  stateHistorySpec,
} from "@spine-event-engine/storage/provider";
import type {
  NormalizedQueryEntry,
  NormalizedQueryPlan,
  RecordStorage,
} from "@spine-event-engine/storage";

import {
  PostgresClientDisposal,
  PostgresStorageDataError,
  PostgresStorageOperationError,
} from "./errors.js";
import { PostgresRecordStorage, type PostgresRecordExecutor } from "./record-storage.js";

/**
 * Describes PostgreSQL-backed Entity record-family handles.
 */
export interface PostgresEntityStorageHandle<I, S extends Message> {
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
   * @returns Whether the handle is open.
   */
  isOpen(): boolean;

  /**
   * Closes the Entity record-family handles.
   */
  close(): void;
}

/**
 * Provides PostgreSQL-backed current Entity storage and optional disabled history ports.
 */
export class PostgresEntityStorage<I, S extends Message> implements PostgresEntityStorageHandle<
  I,
  S
> {
  /**
   * Exposes current Entity records.
   */
  readonly current: EntityRecordStorage<I>;

  /**
   * Exposes optional Entity state history.
   */
  readonly states: EntityStateHistoryPort<I, S>;

  /**
   * Exposes optional Entity event history.
   */
  readonly events: EntityEventHistoryPort<I>;
  #open = true;

  /**
   * Creates Entity ports around one current-record handle.
   *
   * @param input Supplies Entity identity and materialized column definitions.
   * @param records Stores current Entity record envelopes.
   * @param open Opens grouped PostgreSQL record families.
   * @param onClose Unregisters this Entity handle from its factory.
   */
  constructor(
    input: EntityStorageInput<I, S>,
    private readonly records: PostgresRecordStorage<I, EntityRecord>,
    open: <Id, R extends Message>(
      spec: import("@spine-event-engine/storage").RecordSpec<Id, R>,
      group?: import("@spine-event-engine/storage").StorageGroup,
    ) => PostgresRecordStorage<Id, R>,
    private readonly onClose: () => void,
  ) {
    this.current = new PostgresCurrentStorage(input, records);
    const states = input.stateHistory ? stateHistorySpec(input.stateSchema) : undefined;
    this.states =
      states === undefined
        ? disabledStateHistoryPort<I, S>()
        : new PostgresStates(input, open(states.spec, states.group));
    const events = input.eventHistory ? eventHistorySpec(input.stateSchema) : undefined;
    this.events =
      events === undefined
        ? disabledEventHistoryPort<I>()
        : new PostgresEvents(input, open(events.spec, events.group));
  }

  /**
   * Returns whether this Entity handle accepts operations.
   *
   * @returns Whether this handle remains open.
   */
  isOpen(): boolean {
    return this.#open;
  }

  /**
   * Closes the current-record handle and unregisters this Entity handle.
   */
  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.records.close();
    this.states.close();
    this.events.close();
    this.onClose();
  }
}

class PostgresStates<I, S extends Message> implements EntityStateHistoryPort<I, S> {
  readonly #executor: PostgresRecordExecutor<EntityStateKey, EntityRecord>;
  #open = true;

  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: PostgresRecordStorage<EntityStateKey, EntityRecord>,
  ) {
    this.#executor = records.historyExecutor();
  }

  append(record: EntityRecord): Promise<void> {
    if (!this.#open) return Promise.reject(new Error("Entity state history is closed."));
    return this.#executor.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock_shared($1)", [this.familyKey()]);
      await client.query("SELECT pg_advisory_xact_lock($1)", [this.entityKey(record.entityId)]);
      await this.#executor.appendImmutable(client, record);
    });
  }

  async backward(
    entityId: I,
    depth: number,
    startingFromVersion?: bigint,
  ): Promise<readonly EntityRecord[]> {
    this.assertOpen();
    HistoryValues.assertDepth(depth);
    await this.#executor.prepare();
    return this.#executor.transaction((client) =>
      this.#executor.query(
        client,
        this.backwardSql(startingFromVersion),
        this.backwardValues(entityId, depth, startingFromVersion),
      ),
    );
  }

  async stateAt(entityId: I, time: Timestamp): Promise<S | undefined> {
    this.assertOpen();
    await this.#executor.prepare();
    const records = await this.#executor.transaction((client) =>
      this.#executor.query(client, this.stateAtSql(), [
        this.entityValue(entityId),
        HistoryValues.nanos(time),
        1,
      ]),
    );
    const record = records[0];
    if (record?.state === undefined) return undefined;
    try {
      return fromBinary(this.input.stateSchema, record.state.value);
    } catch (error) {
      throw new PostgresStorageDataError("Stored PostgreSQL state data is invalid.", {
        cause: error,
      });
    }
  }

  async trim(entityId: I, keepMostRecent: number): Promise<void> {
    this.assertOpen();
    HistoryValues.assertKeep(keepMostRecent);
    await this.#executor.using(async (client) => {
      const [family, entity] = this.trimLocks(entityId);
      await client.query("SELECT pg_advisory_lock_shared($1)", [family]);
      await client.query("SELECT pg_advisory_lock($1)", [entity]);
      let operationFailure: unknown;
      try {
        const boundary = await this.trimBoundary(client, entityId, keepMostRecent);
        while (
          boundary !== undefined &&
          this.#open &&
          (await this.trimPage(client, entityId, boundary))
        ) {
          // The next page starts only while this history remains open.
        }
      } catch (error) {
        operationFailure = error;
        throw error;
      } finally {
        await PostgresSessionLocks.cleanup(
          client,
          [
            [entity, false],
            [family, true],
          ],
          operationFailure,
        );
      }
    });
  }

  async truncate(olderThan: Timestamp): Promise<void> {
    this.assertOpen();
    await this.#executor.using(async (client) => {
      const key = this.#executor.lock("history-family", this.#executor.table());
      await client.query("SELECT pg_advisory_lock($1)", [key]);
      let operationFailure: unknown;
      try {
        const cutoff = HistoryValues.nanos(olderThan);
        const highWater = await this.highWater(client, cutoff);
        if (highWater !== undefined)
          while (this.#open && (await this.truncatePage(client, cutoff, highWater))) {
            // The next page starts only while this history remains open.
          }
      } catch (error) {
        operationFailure = error;
      }
      const cleanup = await PostgresSessionLocks.unlock(client, key, false).catch(
        (error: unknown) => error,
      );
      if (cleanup instanceof Error) PostgresClientDisposal.mark(operationFailure ?? cleanup);
      if (operationFailure instanceof Error) throw operationFailure;
      if (operationFailure !== undefined)
        throw new PostgresStorageOperationError("PostgreSQL state history operation failed.");
      if (cleanup instanceof Error) throw cleanup;
    });
  }

  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.records.close();
  }

  private backwardSql(startingFromVersion: bigint | undefined): string {
    const continuation = startingFromVersion === undefined ? "" : ' AND "version" <= $2';
    const limit = startingFromVersion === undefined ? 2 : 3;
    return [
      `SELECT "bytes" FROM ${this.#executor.table()} WHERE "entity_id" = $1${continuation}`,
      'ORDER BY "version" DESC, "created" DESC',
      `LIMIT $${String(limit)}`,
    ].join(" ");
  }

  private backwardValues(id: I, depth: number, version: bigint | undefined): readonly unknown[] {
    return version === undefined
      ? [this.entityValue(id), depth]
      : [this.entityValue(id), version, depth];
  }

  private stateAtSql(): string {
    return [
      `SELECT "bytes" FROM ${this.#executor.table()} WHERE "entity_id" = $1 AND "created" <= $2`,
      'ORDER BY "created" DESC, "version" DESC LIMIT $3',
    ].join(" ");
  }

  private entityValue(id: I): unknown {
    return this.#executor.column("entity_id", this.input.id.pack(id));
  }

  private familyKey(): bigint {
    return this.#executor.lock("history-family", this.#executor.table());
  }

  private trimLocks(id: I): readonly [bigint, bigint] {
    return [
      this.familyKey(),
      this.#executor.lock(
        "entity-mutation",
        this.input.sourceType.typeName,
        this.entityIdentity(id),
      ),
    ];
  }

  private entityKey(entityId: EntityRecord["entityId"]): bigint {
    if (entityId === undefined) throw new Error("State history requires EntityRecord.entityId.");
    const id = this.input.id.unpack(entityId);
    if (id === undefined) throw new Error("State history EntityRecord ID does not match storage.");
    return this.#executor.lock(
      "entity-mutation",
      this.input.sourceType.typeName,
      this.entityIdentity(id),
    );
  }

  private entityIdentity(id: I): string {
    return this.input.id.key(id);
  }

  private assertOpen(): void {
    if (!this.#open) throw new Error("Entity state history is closed.");
  }

  private async trimPage(
    client: import("pg").PoolClient,
    id: I,
    boundary: HistoryKey,
  ): Promise<boolean> {
    await client.query("BEGIN");
    try {
      const keys = await this.keys(client, this.trimSql(), [
        this.entityValue(id),
        ...boundary,
        128,
      ]);
      await this.deleteKeys(client, keys);
      await client.query("COMMIT");
      return keys.length === 128;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }

  private async truncatePage(
    client: import("pg").PoolClient,
    olderThan: bigint,
    highWater: HistoryKey,
  ): Promise<boolean> {
    await client.query("BEGIN");
    try {
      const keys = await this.keys(client, this.truncateSql(), [olderThan, ...highWater, 128]);
      await this.deleteKeys(client, keys);
      await client.query("COMMIT");
      return keys.length === 128;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }

  private async keys(
    client: import("pg").PoolClient,
    sql: string,
    values: readonly unknown[],
  ): Promise<readonly unknown[]> {
    return (await client.query<{ readonly ID: unknown }>(sql, [...values])).rows.map(
      ({ ID }) => ID,
    );
  }

  private deleteKeys(client: import("pg").PoolClient, keys: readonly unknown[]): Promise<void> {
    if (keys.length === 0) return Promise.resolve();
    const binds = keys.map((_, index) => `$${String(index + 1)}`).join(", ");
    return client
      .query(`DELETE FROM ${this.#executor.table()} WHERE "ID" IN (${binds})`, [...keys])
      .then(() => undefined);
  }

  private trimSql(): string {
    return [
      `SELECT "ID" FROM ${this.#executor.table()} WHERE "entity_id" = $1`,
      'AND ("version", "created", "ID") < ($2, $3, $4)',
      'ORDER BY "version" DESC, "created" DESC, "ID" DESC LIMIT $5',
    ].join(" ");
  }

  private async trimBoundary(
    client: import("pg").PoolClient,
    id: I,
    keep: number,
  ): Promise<HistoryKey | undefined> {
    const result = await client.query<HistoryRow>(
      [
        `SELECT "version", "created", "ID" FROM ${this.#executor.table()} WHERE "entity_id" = $1`,
        'ORDER BY "version" DESC, "created" DESC, "ID" DESC LIMIT $3 OFFSET $2',
      ].join(" "),
      [this.entityValue(id), keep, 1],
    );
    const key = result.rows[0];
    return key === undefined ? undefined : [key.version, key.created, key.ID];
  }

  private truncateSql(): string {
    return [
      `SELECT "ID" FROM ${this.#executor.table()} WHERE "created" < $1`,
      'AND ("created", "version", "ID") <= ($2, $3, $4)',
      'ORDER BY "created" ASC, "version" ASC, "ID" ASC LIMIT $5',
    ].join(" ");
  }

  private async highWater(
    client: import("pg").PoolClient,
    olderThan: bigint,
  ): Promise<HistoryKey | undefined> {
    const result = await client.query<HistoryRow>(
      [
        `SELECT "created", "version", "ID" FROM ${this.#executor.table()} WHERE "created" < $1`,
        'ORDER BY "created" DESC, "version" DESC, "ID" DESC LIMIT $2',
      ].join(" "),
      [olderThan, 1],
    );
    const key = result.rows[0];
    return key === undefined ? undefined : [key.created, key.version, key.ID];
  }
}

class PostgresEvents<I, S extends Message> implements EntityEventHistoryPort<I> {
  readonly #executor: PostgresRecordExecutor<EventId, Event>;
  #open = true;

  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: PostgresRecordStorage<EventId, Event>,
  ) {
    this.#executor = records.historyExecutor();
  }

  append(record: Event): Promise<void> {
    if (!this.#open) return Promise.reject(new Error("Entity event history is closed."));
    return this.#executor.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock_shared($1)", [this.familyKey()]);
      await this.#executor.appendImmutable(client, record);
    });
  }

  async backward(id: I, depth: number, version?: bigint): Promise<readonly Event[]> {
    this.assertOpen();
    HistoryValues.assertDepth(depth);
    await this.#executor.prepare();
    return this.#executor.transaction((client) =>
      this.#executor.query(
        client,
        this.backwardSql(version),
        this.backwardValues(id, depth, version),
      ),
    );
  }

  async truncate(olderThan: Timestamp): Promise<void> {
    this.assertOpen();
    await this.#executor.using(async (client) => {
      const key = this.familyKey();
      await client.query("SELECT pg_advisory_lock($1)", [key]);
      let operationFailure: unknown;
      try {
        const cutoff = HistoryValues.nanos(olderThan);
        const highWater = await this.highWater(client, cutoff);
        if (highWater !== undefined)
          while (this.#open && (await this.deletePage(client, cutoff, highWater))) {
            // The next page starts only while this history remains open.
          }
      } catch (error) {
        operationFailure = error;
      }
      const cleanup = await PostgresSessionLocks.unlock(client, key, false).catch(
        (error: unknown) => error,
      );
      if (cleanup instanceof Error) PostgresClientDisposal.mark(operationFailure ?? cleanup);
      if (operationFailure instanceof Error) throw operationFailure;
      if (operationFailure !== undefined)
        throw new PostgresStorageOperationError("PostgreSQL event history operation failed.");
      if (cleanup instanceof Error) throw cleanup;
    });
  }

  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.records.close();
  }

  private backwardSql(version: bigint | undefined): string {
    const continuation = version === undefined ? "" : ' AND "version" <= $2';
    const limit = version === undefined ? 2 : 3;
    return [
      `SELECT "bytes" FROM ${this.#executor.table()} WHERE "entity_id" = $1${continuation}`,
      'ORDER BY "version" DESC, "created" DESC',
      `LIMIT $${String(limit)}`,
    ].join(" ");
  }

  private backwardValues(id: I, depth: number, version: bigint | undefined): readonly unknown[] {
    const entity = this.#executor.column("entity_id", this.input.id.pack(id));
    return version === undefined ? [entity, depth] : [entity, version, depth];
  }

  private familyKey(): bigint {
    return this.#executor.lock("history-family", this.#executor.table());
  }

  private assertOpen(): void {
    if (!this.#open) throw new Error("Entity event history is closed.");
  }

  private async highWater(
    client: import("pg").PoolClient,
    olderThan: bigint,
  ): Promise<HistoryKey | undefined> {
    const result = await client.query<HistoryRow>(this.highWaterSql(), [olderThan, 1]);
    const key = result.rows[0];
    return key === undefined ? undefined : [key.created, key.version, key.ID];
  }

  private async deletePage(
    client: import("pg").PoolClient,
    olderThan: bigint,
    highWater: HistoryKey,
  ): Promise<boolean> {
    await client.query("BEGIN");
    try {
      const keys = await this.keys(client, [olderThan, ...highWater, 128]);
      await this.deleteKeys(client, keys);
      await client.query("COMMIT");
      return keys.length === 128;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }

  private keys(
    client: import("pg").PoolClient,
    values: readonly unknown[],
  ): Promise<readonly unknown[]> {
    return client
      .query<{ readonly ID: unknown }>(this.deleteSql(), [...values])
      .then(({ rows }) => rows.map(({ ID }) => ID));
  }

  private deleteKeys(client: import("pg").PoolClient, keys: readonly unknown[]): Promise<void> {
    if (keys.length === 0) return Promise.resolve();
    const binds = keys.map((_, index) => `$${String(index + 1)}`).join(", ");
    return client
      .query(`DELETE FROM ${this.#executor.table()} WHERE "ID" IN (${binds})`, [...keys])
      .then(() => undefined);
  }

  private highWaterSql(): string {
    return [
      `SELECT "created", "version", "ID" FROM ${this.#executor.table()} WHERE "created" < $1`,
      'ORDER BY "created" DESC, "version" DESC, "ID" DESC LIMIT $2',
    ].join(" ");
  }

  private deleteSql(): string {
    return [
      `SELECT "ID" FROM ${this.#executor.table()} WHERE "created" < $1`,
      'AND ("created", "version", "ID") <= ($2, $3, $4)',
      'ORDER BY "created" ASC, "version" ASC, "ID" ASC LIMIT $5',
    ].join(" ");
  }
}

const HistoryValues = Object.freeze({
  assertDepth(value: number): void {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error("Entity history depth must be a positive finite integer.");
  },
  assertKeep(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("Entity state history retention must be a non-negative safe integer.");
  },
  nanos(value: Timestamp): bigint {
    return value.seconds * 1_000_000_000n + BigInt(value.nanos || 0);
  },
});

const PostgresSessionLocks = Object.freeze({
  async cleanup(
    client: import("pg").PoolClient,
    locks: readonly (readonly [bigint, boolean])[],
    operationFailure: unknown,
  ): Promise<void> {
    for (const [key, shared] of locks) {
      const cleanup = await this.unlock(client, key, shared).catch((error: unknown) => error);
      if (cleanup instanceof Error) {
        PostgresClientDisposal.mark(operationFailure ?? cleanup);
        if (operationFailure === undefined) throw cleanup;
      }
    }
  },
  async unlock(client: import("pg").PoolClient, key: bigint, shared: boolean): Promise<void> {
    try {
      const result = await client.query<{ readonly pg_advisory_unlock: boolean }>(
        shared ? "SELECT pg_advisory_unlock_shared($1)" : "SELECT pg_advisory_unlock($1)",
        [key],
      );
      if (result.rows[0]?.pg_advisory_unlock !== true)
        throw new PostgresStorageOperationError("PostgreSQL history cleanup failed.");
    } catch (error) {
      if (error instanceof PostgresStorageOperationError) throw error;
      throw new PostgresStorageOperationError("PostgreSQL history cleanup failed.");
    }
  },
});

type HistoryKey = readonly [unknown, unknown, unknown];
interface HistoryRow {
  readonly created: unknown;
  readonly version: unknown;
  readonly ID: unknown;
}

class PostgresCurrentStorage<I, S extends Message> implements EntityRecordStorage<I> {
  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: RecordStorage<I, EntityRecord>,
  ) {}

  read(id: I): Promise<EntityRecord | undefined> {
    return this.records.read(id);
  }

  write(record: EntityRecord): Promise<void> {
    return this.records.write(record);
  }

  async query(
    plan: NormalizedQueryPlan<I>,
  ): Promise<readonly NormalizedQueryEntry<I, EntityRecord>[]> {
    const entries = await this.records.queryPlanEntries(plan);
    return entries.map((entry) => ({
      id: entry.id,
      record: entry.record,
      columns: new Map(
        this.input.columns.map((column) => [column.name, column.valueIn(entry.record)]),
      ),
    }));
  }
}
