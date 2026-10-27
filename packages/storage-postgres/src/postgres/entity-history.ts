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

import { type Message } from "@bufbuild/protobuf";
import { AnyPacker } from "@spine-event-engine/core";
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

import { PostgresStorageDataError, PostgresStorageErrors } from "./errors.js";
import {
  PostgresRecordStorage,
  type OnPublicOperation,
  type PostgresRecordExecutor,
} from "./record-storage.js";
import type { PostgresParameter } from "./parameter.js";

/**
 * Opens one grouped PostgreSQL record family for an Entity history.
 *
 * @typeParam I Record identifier type.
 * @typeParam R Stored Protobuf record type.
 */
type OpenRecords = <I, R extends Message>(
  spec: import("@spine-event-engine/storage").RecordSpec<I, R>,
  group?: import("@spine-event-engine/storage").StorageGroup,
) => PostgresRecordStorage<I, R>;

/**
 * Describes PostgreSQL-backed Entity record-family handles.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
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
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
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
   * @param onAdmit Admits complete public Entity operations before callbacks.
   */
  constructor(
    input: EntityStorageInput<I, S>,
    private readonly records: PostgresRecordStorage<I, EntityRecord>,
    open: OpenRecords,
    private readonly onClose: () => void,
    private readonly onAdmit: OnPublicOperation,
  ) {
    this.current = new PostgresCurrentStorage(input, records, onAdmit);
    const states = input.stateHistory ? stateHistorySpec(input.stateSchema) : undefined;
    this.states =
      states === undefined
        ? disabledStateHistoryPort<I, S>()
        : new PostgresStates(input, open(states.spec, states.group), onAdmit);
    const events = input.eventHistory ? eventHistorySpec(input.stateSchema) : undefined;
    this.events =
      events === undefined
        ? disabledEventHistoryPort<I>()
        : new PostgresEvents(input, open(events.spec, events.group), onAdmit);
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

/**
 * Stores and reads the state history for one Entity type.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 */
class PostgresStates<I, S extends Message> implements EntityStateHistoryPort<I, S> {
  readonly #executor: PostgresRecordExecutor<EntityStateKey, EntityRecord>;

  #open = true;

  /**
   * Creates a state-history port around one grouped record family.
   *
   * @param input Supplies Entity identity and state-schema definitions.
   * @param records Stores immutable Entity state records.
   * @param onAdmit Admits complete public history operations.
   */
  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: PostgresRecordStorage<EntityStateKey, EntityRecord>,
    private readonly onAdmit: OnPublicOperation,
  ) {
    this.#executor = records.historyExecutor();
  }

  /**
   * Stores one immutable Entity state record.
   *
   * @param record Entity state record to append.
   * @returns Completion after PostgreSQL stores the record.
   */
  append(record: EntityRecord): Promise<void> {
    return this.onAdmit(() => {
      if (!this.#open) return Promise.reject(new Error("Entity state history is closed."));
      return this.records.writeImmutable(record).catch((error: unknown) => {
        throw PostgresStorageErrors.operation(error);
      });
    });
  }

  /**
   * Reads Entity states backward from an optional version.
   *
   * @param entityId Entity whose history is read.
   * @param depth Maximum number of states to return.
   * @param startingFromVersion Optional inclusive starting version.
   * @returns Entity state records in descending version order.
   */
  backward(
    entityId: I,
    depth: number,
    startingFromVersion?: bigint,
  ): Promise<readonly EntityRecord[]> {
    return this.onAdmit(() => this.backwardAdmitted(entityId, depth, startingFromVersion));
  }

  /**
   * Reads an admitted state-history page.
   * @param entityId Entity whose history is read.
   * @param depth Maximum number of states to return.
   * @param startingFromVersion Optional inclusive version.
   * @returns Entity state records in descending version order.
   */
  private async backwardAdmitted(
    entityId: I,
    depth: number,
    startingFromVersion?: bigint,
  ): Promise<readonly EntityRecord[]> {
    this.assertOpen();
    HistoryValues.assertDepth(depth);
    await this.#executor.prepare();
    return this.#executor
      .using((client) =>
        this.#executor.query(
          client,
          this.backwardSql(startingFromVersion),
          this.backwardValues(entityId, depth, startingFromVersion),
        ),
      )
      .catch((error: unknown) => {
        throw PostgresStorageErrors.operation(error);
      });
  }

  /**
   * Reads the Entity state active at a given time.
   *
   * @param entityId Entity whose state is read.
   * @param time Inclusive state timestamp.
   * @returns Decoded state, or `undefined` when no state existed.
   */
  stateAt(entityId: I, time: Timestamp): Promise<S | undefined> {
    return this.onAdmit(() => this.stateAtAdmitted(entityId, time));
  }

  /**
   * Reads an admitted Entity state at a timestamp.
   * @param entityId Entity whose state is read.
   * @param time Inclusive state timestamp.
   * @returns Decoded state, or absence.
   */
  private async stateAtAdmitted(entityId: I, time: Timestamp): Promise<S | undefined> {
    this.assertOpen();
    await this.#executor.prepare();
    const records = await this.#executor
      .using((client) =>
        this.#executor.query(client, this.stateAtSql(), [
          this.entityValue(entityId),
          HistoryValues.nanos(time),
          1,
        ]),
      )
      .catch((error: unknown) => {
        throw PostgresStorageErrors.operation(error);
      });
    const record = records[0];
    if (record?.state === undefined) return undefined;
    try {
      return AnyPacker.unpack(record.state, this.input.stateSchema);
    } catch (error) {
      throw new PostgresStorageDataError("Stored PostgreSQL state data is invalid.", {
        cause: error,
      });
    }
  }

  /**
   * Removes all but the requested number of recent states for one Entity.
   *
   * @param entityId Entity whose history is trimmed.
   * @param keepMostRecent Number of newest states to retain.
   * @returns Completion after all older pages are deleted.
   */
  trim(entityId: I, keepMostRecent: number): Promise<void> {
    return this.onAdmit(() => this.trimAdmitted(entityId, keepMostRecent));
  }

  /**
   * Removes older admitted Entity state history.
   * @param entityId Entity whose history is trimmed.
   * @param keepMostRecent Number of newest states to retain.
   * @returns Completion after all older pages are deleted.
   */
  private async trimAdmitted(entityId: I, keepMostRecent: number): Promise<void> {
    this.assertOpen();
    HistoryValues.assertKeep(keepMostRecent);
    await this.#executor
      .using(async (client) => {
        let cursor = await this.trimBoundary(client, entityId, keepMostRecent);
        let includeCursor = true;
        while (cursor !== undefined && this.#open) {
          cursor = await this.trimPage(client, entityId, cursor, includeCursor);
          includeCursor = false;
        }
      })
      .catch((error: unknown) => {
        throw PostgresStorageErrors.operation(error);
      });
  }

  /**
   * Deletes state-history records older than a timestamp.
   *
   * @param olderThan Exclusive history cutoff.
   * @returns Completion after all matching pages are deleted.
   */
  truncate(olderThan: Timestamp): Promise<void> {
    return this.onAdmit(() => this.truncateAdmitted(olderThan));
  }

  /**
   * Deletes admitted Entity state history.
   * @param olderThan Exclusive history cutoff.
   * @returns Completion after all matching pages are deleted.
   */
  private async truncateAdmitted(olderThan: Timestamp): Promise<void> {
    this.assertOpen();
    await this.#executor
      .using(async (client) => {
        const cutoff = HistoryValues.nanos(olderThan);
        const highWater = await this.highWater(client, cutoff);
        if (highWater !== undefined)
          while (this.#open && (await this.truncatePage(client, cutoff, highWater))) {
            // Each completed page remains deleted if a later page fails.
          }
      })
      .catch((error: unknown) => {
        throw PostgresStorageErrors.operation(error);
      });
  }

  /**
   * Closes this state-history port.
   */
  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.records.close();
  }

  /**
   * Builds the backward state-history query.
   *
   * @param startingFromVersion Optional inclusive starting version.
   * @returns Parameterized PostgreSQL query text.
   */
  private backwardSql(startingFromVersion: bigint | undefined): string {
    const continuation = startingFromVersion === undefined ? "" : ' AND "version" <= $2';
    const limit = startingFromVersion === undefined ? 2 : 3;
    return [
      `SELECT "bytes" FROM ${this.#executor.table()} WHERE "entity_id" = $1${continuation}`,
      'ORDER BY "version" DESC, "created" DESC',
      `LIMIT $${String(limit)}`,
    ].join(" ");
  }

  /**
   * Builds bind values for a backward state-history query.
   *
   * @param id Entity identifier.
   * @param depth Maximum number of states.
   * @param version Optional inclusive starting version.
   * @returns PostgreSQL bind values in query order.
   */
  private backwardValues(
    id: I,
    depth: number,
    version: bigint | undefined,
  ): readonly PostgresParameter[] {
    return version === undefined
      ? [this.entityValue(id), depth]
      : [this.entityValue(id), version, depth];
  }

  /**
   * Builds the point-in-time state query.
   *
   * @returns Parameterized PostgreSQL query text.
   */
  private stateAtSql(): string {
    return [
      `SELECT "bytes" FROM ${this.#executor.table()} WHERE "entity_id" = $1 AND "created" <= $2`,
      'ORDER BY "created" DESC, "version" DESC LIMIT $3',
    ].join(" ");
  }

  /**
   * Converts an Entity identifier to its stored column value.
   *
   * @param id Entity identifier.
   * @returns PostgreSQL-bound identifier value.
   */
  private entityValue(id: I): PostgresParameter {
    return this.#executor.column("entity_id", this.input.id.pack(id));
  }

  /**
   * Rejects state-history work after this port has closed.
   */
  private assertOpen(): void {
    if (!this.#open) throw new Error("Entity state history is closed.");
  }

  /**
   * Deletes one bounded page of old states for an Entity.
   *
   * @param client Acquired PostgreSQL client.
   * @param id Entity identifier.
   * @param cursor Last retained or deleted history key.
   * @param includeCursor Whether the page includes the supplied cursor.
   * @returns The next page cursor, or `undefined` after the final page.
   */
  private async trimPage(
    client: import("pg").PoolClient,
    id: I,
    cursor: HistoryKey,
    includeCursor: boolean,
  ): Promise<HistoryKey | undefined> {
    const rows = await client.query<HistoryRow>(this.trimSql(includeCursor), [
      this.entityValue(id),
      ...cursor,
      128,
    ]);
    const keys = rows.rows.map(({ ID }) => ID);
    await this.deleteKeys(client, keys);
    const last = rows.rows.at(-1);
    return keys.length === 128 && last !== undefined
      ? [last.version, last.created, last.ID]
      : undefined;
  }

  /**
   * Deletes one bounded page below a timestamp and stable high-water key.
   *
   * @param client Acquired PostgreSQL client.
   * @param olderThan Exclusive timestamp cutoff in nanoseconds.
   * @param highWater Last key admitted when truncation began.
   * @returns Whether another full page may remain.
   */
  private async truncatePage(
    client: import("pg").PoolClient,
    olderThan: bigint,
    highWater: HistoryKey,
  ): Promise<boolean> {
    const keys = await this.keys(client, this.truncateSql(), [olderThan, ...highWater, 128]);
    await this.deleteKeys(client, keys);
    return keys.length === 128;
  }

  /**
   * Reads record identifiers for one bounded deletion page.
   *
   * @param client Acquired PostgreSQL client.
   * @param sql Parameterized key query.
   * @param values PostgreSQL bind values.
   * @returns Stored record identifiers.
   */
  private async keys(
    client: import("pg").PoolClient,
    sql: string,
    values: readonly PostgresParameter[],
  ): Promise<readonly PostgresParameter[]> {
    return (await client.query<{ readonly ID: PostgresParameter }>(sql, [...values])).rows.map(
      ({ ID }) => ID,
    );
  }

  /**
   * Deletes records identified by one bounded key page.
   *
   * @param client Acquired PostgreSQL client.
   * @param keys Stored record identifiers.
   * @returns Completion after the deletion query.
   */
  private deleteKeys(
    client: import("pg").PoolClient,
    keys: readonly PostgresParameter[],
  ): Promise<void> {
    if (keys.length === 0) return Promise.resolve();
    const binds = keys.map((_, index) => `$${String(index + 1)}`).join(", ");
    return client
      .query(`DELETE FROM ${this.#executor.table()} WHERE "ID" IN (${binds})`, [...keys])
      .then(() => undefined);
  }

  /**
   * Builds one state-history trim-page query.
   *
   * @param includeCursor Whether the supplied cursor belongs to the page.
   * @returns Parameterized PostgreSQL query text.
   */
  private trimSql(includeCursor: boolean): string {
    return [
      `SELECT "version", "created", "ID" FROM ${this.#executor.table()} WHERE "entity_id" = $1`,
      `AND ("version", "created", "ID") ${includeCursor ? "<=" : "<"} ($2, $3, $4)`,
      'ORDER BY "version" DESC, "created" DESC, "ID" DESC LIMIT $5',
    ].join(" ");
  }

  /**
   * Finds the first state-history key that trimming may delete.
   *
   * @param client Acquired PostgreSQL client.
   * @param id Entity identifier.
   * @param keep Number of newest states to retain.
   * @returns First deletable key, or `undefined` when nothing must be removed.
   */
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

  /**
   * Builds one state-history truncation-page query.
   *
   * @returns Parameterized PostgreSQL query text.
   */
  private truncateSql(): string {
    return [
      `SELECT "ID" FROM ${this.#executor.table()} WHERE "created" < $1`,
      'AND ("created", "version", "ID") <= ($2, $3, $4)',
      'ORDER BY "created" ASC, "version" ASC, "ID" ASC LIMIT $5',
    ].join(" ");
  }

  /**
   * Captures the last state key eligible when truncation begins.
   *
   * @param client Acquired PostgreSQL client.
   * @param olderThan Exclusive timestamp cutoff in nanoseconds.
   * @returns Stable high-water key, or `undefined` when nothing is eligible.
   */
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

/**
 * Stores and reads the event history for one Entity type.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type used to derive the history family.
 */
class PostgresEvents<I, S extends Message> implements EntityEventHistoryPort<I> {
  readonly #executor: PostgresRecordExecutor<EventId, Event>;

  #open = true;

  /**
   * Creates an event-history port around one grouped record family.
   *
   * @param input Supplies Entity identity and state-schema definitions.
   * @param records Stores immutable Entity events.
   * @param onAdmit Admits complete public event-history operations.
   */
  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: PostgresRecordStorage<EventId, Event>,
    private readonly onAdmit: OnPublicOperation,
  ) {
    this.#executor = records.historyExecutor();
  }

  /**
   * Stores one immutable Entity event.
   *
   * @param record Event to append.
   * @returns Completion after PostgreSQL stores the event.
   */
  append(record: Event): Promise<void> {
    return this.onAdmit(() => {
      if (!this.#open) return Promise.reject(new Error("Entity event history is closed."));
      return this.records.writeImmutable(record).catch((error: unknown) => {
        throw PostgresStorageErrors.operation(error);
      });
    });
  }

  /**
   * Reads Entity events backward from an optional version.
   *
   * @param id Entity identifier.
   * @param depth Maximum number of events to return.
   * @param version Optional inclusive starting version.
   * @returns Events in descending version order.
   */
  backward(id: I, depth: number, version?: bigint): Promise<readonly Event[]> {
    return this.onAdmit(() => this.backwardAdmitted(id, depth, version));
  }

  /**
   * Reads an admitted Entity event-history page.
   * @param id Entity identifier.
   * @param depth Maximum number of events to return.
   * @param version Optional inclusive starting version.
   * @returns Events in descending version order.
   */
  private async backwardAdmitted(
    id: I,
    depth: number,
    version?: bigint,
  ): Promise<readonly Event[]> {
    this.assertOpen();
    HistoryValues.assertDepth(depth);
    await this.#executor.prepare();
    return this.#executor
      .using((client) =>
        this.#executor.query(
          client,
          this.backwardSql(version),
          this.backwardValues(id, depth, version),
        ),
      )
      .catch((error: unknown) => {
        throw PostgresStorageErrors.operation(error);
      });
  }

  /**
   * Deletes Entity events older than a timestamp.
   *
   * @param olderThan Exclusive history cutoff.
   * @returns Completion after all matching pages are deleted.
   */
  truncate(olderThan: Timestamp): Promise<void> {
    return this.onAdmit(() => this.truncateAdmitted(olderThan));
  }

  /**
   * Deletes admitted Entity event history.
   * @param olderThan Exclusive history cutoff.
   * @returns Completion after all matching pages are deleted.
   */
  private async truncateAdmitted(olderThan: Timestamp): Promise<void> {
    this.assertOpen();
    await this.#executor
      .using(async (client) => {
        const cutoff = HistoryValues.nanos(olderThan);
        const highWater = await this.highWater(client, cutoff);
        if (highWater !== undefined)
          while (this.#open && (await this.deletePage(client, cutoff, highWater))) {
            // Each completed page remains deleted if a later page fails.
          }
      })
      .catch((error: unknown) => {
        throw PostgresStorageErrors.operation(error);
      });
  }

  /**
   * Closes this event-history port.
   */
  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.records.close();
  }

  /**
   * Builds the backward event-history query.
   *
   * @param version Optional inclusive starting version.
   * @returns Parameterized PostgreSQL query text.
   */
  private backwardSql(version: bigint | undefined): string {
    const continuation = version === undefined ? "" : ' AND "version" <= $2';
    const limit = version === undefined ? 2 : 3;
    return [
      `SELECT "bytes" FROM ${this.#executor.table()} WHERE "entity_id" = $1${continuation}`,
      'ORDER BY "version" DESC, "created" DESC',
      `LIMIT $${String(limit)}`,
    ].join(" ");
  }

  /**
   * Builds bind values for a backward event-history query.
   *
   * @param id Entity identifier.
   * @param depth Maximum number of events.
   * @param version Optional inclusive starting version.
   * @returns PostgreSQL bind values in query order.
   */
  private backwardValues(
    id: I,
    depth: number,
    version: bigint | undefined,
  ): readonly PostgresParameter[] {
    const entity = this.#executor.column("entity_id", this.input.id.pack(id));
    return version === undefined ? [entity, depth] : [entity, version, depth];
  }

  /**
   * Rejects event-history work after this port has closed.
   */
  private assertOpen(): void {
    if (!this.#open) throw new Error("Entity event history is closed.");
  }

  /**
   * Captures the last event key eligible when truncation begins.
   *
   * @param client Acquired PostgreSQL client.
   * @param olderThan Exclusive timestamp cutoff in nanoseconds.
   * @returns Stable high-water key, or `undefined` when nothing is eligible.
   */
  private async highWater(
    client: import("pg").PoolClient,
    olderThan: bigint,
  ): Promise<HistoryKey | undefined> {
    const result = await client.query<HistoryRow>(this.highWaterSql(), [olderThan, 1]);
    const key = result.rows[0];
    return key === undefined ? undefined : [key.created, key.version, key.ID];
  }

  /**
   * Deletes one bounded page below a timestamp and stable high-water key.
   *
   * @param client Acquired PostgreSQL client.
   * @param olderThan Exclusive timestamp cutoff in nanoseconds.
   * @param highWater Last key admitted when truncation began.
   * @returns Whether another full page may remain.
   */
  private async deletePage(
    client: import("pg").PoolClient,
    olderThan: bigint,
    highWater: HistoryKey,
  ): Promise<boolean> {
    const keys = await this.keys(client, [olderThan, ...highWater, 128]);
    await this.deleteKeys(client, keys);
    return keys.length === 128;
  }

  /**
   * Reads event identifiers for one bounded deletion page.
   *
   * @param client Acquired PostgreSQL client.
   * @param values PostgreSQL bind values.
   * @returns Stored event identifiers.
   */
  private keys(
    client: import("pg").PoolClient,
    values: readonly PostgresParameter[],
  ): Promise<readonly PostgresParameter[]> {
    return client
      .query<{ readonly ID: PostgresParameter }>(this.deleteSql(), [...values])
      .then(({ rows }) => rows.map(({ ID }) => ID));
  }

  /**
   * Deletes events identified by one bounded key page.
   *
   * @param client Acquired PostgreSQL client.
   * @param keys Stored event identifiers.
   * @returns Completion after the deletion query.
   */
  private deleteKeys(
    client: import("pg").PoolClient,
    keys: readonly PostgresParameter[],
  ): Promise<void> {
    if (keys.length === 0) return Promise.resolve();
    const binds = keys.map((_, index) => `$${String(index + 1)}`).join(", ");
    return client
      .query(`DELETE FROM ${this.#executor.table()} WHERE "ID" IN (${binds})`, [...keys])
      .then(() => undefined);
  }

  /**
   * Builds the event high-water query.
   *
   * @returns Parameterized PostgreSQL query text.
   */
  private highWaterSql(): string {
    return [
      `SELECT "created", "version", "ID" FROM ${this.#executor.table()} WHERE "created" < $1`,
      'ORDER BY "created" DESC, "version" DESC, "ID" DESC LIMIT $2',
    ].join(" ");
  }

  /**
   * Builds one event-history deletion-page query.
   *
   * @returns Parameterized PostgreSQL query text.
   */
  private deleteSql(): string {
    return [
      `SELECT "ID" FROM ${this.#executor.table()} WHERE "created" < $1`,
      'AND ("created", "version", "ID") <= ($2, $3, $4)',
      'ORDER BY "created" ASC, "version" ASC, "ID" ASC LIMIT $5',
    ].join(" ");
  }
}

const HistoryValues = Object.freeze({
  /**
   * Validates a requested history read depth.
   *
   * @param value Requested history depth.
   */
  assertDepth(value: number): void {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error("Entity history depth must be a positive finite integer.");
  },

  /**
   * Validates a requested state retention count.
   *
   * @param value Number of newest states to keep.
   */
  assertKeep(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("Entity state history retention must be a non-negative safe integer.");
  },

  /**
   * Converts a Protobuf timestamp to epoch nanoseconds.
   *
   * @param value Protobuf timestamp.
   * @returns Epoch nanoseconds.
   */
  nanos(value: Timestamp): bigint {
    return value.seconds * 1_000_000_000n + BigInt(value.nanos || 0);
  },
});

type HistoryKey = readonly [PostgresParameter, PostgresParameter, PostgresParameter];
interface HistoryRow {
  readonly created: PostgresParameter;
  readonly version: PostgresParameter;
  readonly ID: PostgresParameter;
}

/**
 * Adapts current Entity records to the provider Entity-storage contract.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type used for materialized columns.
 */
class PostgresCurrentStorage<I, S extends Message> implements EntityRecordStorage<I> {
  /**
   * Creates current Entity storage around one record family.
   *
   * @param input Supplies materialized Entity columns.
   * @param records Stores current Entity records.
   * @param onAdmit Admits complete public current-record operations.
   */
  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: RecordStorage<I, EntityRecord>,
    private readonly onAdmit: OnPublicOperation,
  ) {}

  /**
   * Reads one current Entity record.
   *
   * @param id Entity identifier.
   * @returns The current record, or `undefined` when absent.
   */
  read(id: I): Promise<EntityRecord | undefined> {
    return this.onAdmit(() => this.records.read(id));
  }

  /**
   * Writes one current Entity record.
   *
   * @param record Current Entity record.
   * @returns Completion after PostgreSQL stores the record.
   */
  write(record: EntityRecord): Promise<void> {
    return this.onAdmit(() => this.records.write(record));
  }

  /**
   * Executes one normalized current-Entity query.
   *
   * @param plan Normalized storage query plan.
   * @returns Matching records with materialized column values.
   */
  async query(
    plan: NormalizedQueryPlan<I>,
  ): Promise<readonly NormalizedQueryEntry<I, EntityRecord>[]> {
    return this.onAdmit(async () => {
      const entries = await this.records.queryPlanEntries(plan);
      return entries.map((entry) => ({
        id: entry.id,
        record: entry.record,
        columns: new Map(
          this.input.columns.map((column) => [column.name, column.valueIn(entry.record)]),
        ),
      }));
    });
  }
}
