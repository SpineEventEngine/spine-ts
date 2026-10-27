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

import { fromBinary, ScalarType, toBinary, type Message } from "@bufbuild/protobuf";
import { StringifierRegistry } from "@spine-event-engine/core";
import {
  ColumnMappings,
  defaultQueryCandidateLimit,
  RecordQuery,
  RecordStorage,
  type ColumnMapping,
  type NormalizedQueryPlan,
  type NormalizedQueryPredicate,
  type RecordEntry,
  type RecordSpec,
  type StorageContext,
  type StorageQueryCapabilities,
} from "@spine-event-engine/storage";
import type { PoolClient } from "pg";
import { createHash } from "node:crypto";

import { PostgresColumnMapping } from "./column-mapping.js";
import {
  PostgresStorageDataError,
  PostgresStorageOperationError,
  PostgresClientDisposal,
} from "./errors.js";
import { PostgresIdColumn } from "./id-column.js";
import type { PostgresParameter } from "./parameter.js";
import type { PostgresTableSpec } from "./storage-factory.js";
import { PostgresTableInitializer } from "./table-initializer.js";

const maximumNormalizedPlanBinds = 1_000;

/**
 * Admits one complete public provider operation before application callbacks run.
 * @internal
 * @typeParam T The operation result.
 * @param work The admitted operation.
 * @returns The operation outcome.
 */
export type OnPublicOperation = <T>(work: () => Promise<T>) => Promise<T>;

/**
 * Manages PostgreSQL clients for one record-family handle.
 */
export interface PostgresRecordLifecycle {
  /**
   * Resolves the selected database and its server-selected schema.
   *
   * @returns Completion after binding.
   */
  resolve(): Promise<void>;

  /**
   * Records one admitted asynchronous operation through factory close.
   *
   * @typeParam T The operation result.
   * @param work The admitted operation promise.
   * @returns The same operation outcome.
   */
  track<T>(work: Promise<T>): Promise<T>;

  /**
   * Checks the factory fence for public record operations.
   *
   * @returns Whether a new public operation may start.
   */
  publicOpen(): boolean;

  /**
   * Names the selected database for advisory coordination.
   */
  readonly databaseName: string;

  /**
   * Names the resolved schema.
   */
  readonly schema: string;

  /**
   * Acquires an available PostgreSQL client.
   *
   * @returns A client that the caller releases.
   */
  acquire(): Promise<PoolClient>;
}

/**
 * Performs package-local bounded operations for one PostgreSQL record family.
 *
 * This capability deliberately stays outside the package root: Entity history
 * uses it to keep its SQL on the PostgreSQL provider.
 *
 * @typeParam I Record identifier type.
 * @typeParam R The stored Protobuf record type.
 */
export interface PostgresRecordExecutor<I, R extends Message> {
  /**
   * Prepares the backing table before acquiring an operation client.
   * @returns A promise that resolves when the table is compatible.
   */
  prepare(): Promise<void>;

  /**
   * Executes Agent record mutations on one rollback-capable transaction client.
   *
   * @typeParam T Result of the transaction work.
   * @param work Operations to run on the transaction client.
   * @returns Result after transaction commit.
   */
  transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T>;

  /**
   * Reads a record on the Agent transaction client.
   *
   * @param client Active transaction client.
   * @param id Typed record ID.
   * @param lock Whether to lock the selected row.
   * @returns Stored record when present.
   */
  read(client: PoolClient, id: I, lock?: "for-update"): Promise<R | undefined>;

  /**
   * Checks an immutable record on the Agent transaction client.
   *
   * @param client Active transaction client.
   * @param record Proposed immutable record.
   * @returns Completion after collision validation.
   */
  assertImmutable(client: PoolClient, record: R): Promise<void>;

  /**
   * Writes an immutable record on the Agent transaction client.
   *
   * @param client Active transaction client.
   * @param record Immutable record to append.
   * @returns Completion after insertion or identical retry.
   */
  appendImmutable(client: PoolClient, record: R): Promise<void>;

  /**
   * Writes a record on the Agent transaction client.
   *
   * @param client Active transaction client.
   * @param record Record to write.
   * @returns Completion after the write.
   */
  write(client: PoolClient, record: R): Promise<void>;

  /**
   * Calculates an Agent transaction lock identity.
   *
   * @param domain Lock namespace within the provider.
   * @param identity Components of the lock identity.
   * @returns Stable advisory lock key.
   */
  lock(domain: string, ...identity: readonly string[]): bigint;

  /**
   * Returns bounded work on one acquired PostgreSQL client.
   *
   * @typeParam T The value returned by the client work.
   * @param work Performs work with the acquired client.
   * @returns The work result.
   */
  using<T>(work: (client: PoolClient) => Promise<T>): Promise<T>;

  /**
   * Decodes records returned by one bounded PostgreSQL statement.
   * @param client Provides the acquired client.
   * @param sql Supplies bounded provider SQL.
   * @param values Supplies bound SQL values.
   * @returns Decoded records.
   */
  query(
    client: PoolClient,
    sql: string,
    values: readonly PostgresParameter[],
  ): Promise<readonly R[]>;

  /**
   * Converts one declared column value to its PostgreSQL representation.
   * @param name Names the declared column.
   * @param value Supplies the logical column value.
   * @returns The PostgreSQL parameter value.
   */
  column(name: string, value: unknown): PostgresParameter;

  /**
   * Returns the fully qualified backing table identifier.
   * @returns The validated table identifier.
   */
  table(): string;
}

/**
 * Stores one record family in one qualified PostgreSQL table.
 *
 * @typeParam I The storage identifier type.
 * @typeParam R The stored Protobuf record type.
 */
export class PostgresRecordStorage<I, R extends Message> extends RecordStorage<I, R> {
  /**
   * Reports that compare-and-set uses a conditional SQL mutation.
   */
  override readonly atomicCompareAndSet = true;

  readonly #idColumn: PostgresIdColumn<I>;

  readonly #columns: ColumnMapping<PostgresParameter>;

  #initializer: PostgresTableInitializer | undefined;

  #binding: Promise<void> | undefined;

  #table: PostgresTableSpec<I, R> | undefined;

  /**
   * Creates a PostgreSQL record-family handle.
   *
   * @param context Identifies the storage boundary for this handle.
   * @param spec Defines the record type, ID type, and declared columns.
   * @param tableNameValue Supplies the locally resolved physical table name.
   * @param onSchema Builds the physical layout after schema resolution.
   * @param lifecycle Acquires clients for the selected database and schema.
   * @param onClose Removes this handle from the factory's live set.
   * @param create Optionally supplies custom create-table SQL.
   * @param stringifiers Converts message IDs and columns reversibly.
   */
  constructor(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    private readonly tableNameValue: string,
    private readonly onSchema: (schema: string) => PostgresTableSpec<I, R>,
    private readonly lifecycle: PostgresRecordLifecycle,
    private readonly onClose: () => void,
    private readonly create?: (table: PostgresTableSpec<I, R>) => string,
    stringifiers: StringifierRegistry = new StringifierRegistry(),
  ) {
    super(context, spec);
    this.#idColumn = new PostgresIdColumn(spec.idType, stringifiers);
    this.#columns = new PostgresColumnMapping(stringifiers);
  }

  /**
   * Returns the bound layout after preparation.
   *
   * @returns The resolved physical layout.
   */
  private get table(): PostgresTableSpec<I, R> {
    if (this.#table === undefined) throw new Error("PostgreSQL record table is not bound.");
    return this.#table;
  }

  /**
   * Returns the resolved physical table name.
   *
   * @returns The physical table name without its schema.
   */
  get tableName(): string {
    return this.tableNameValue;
  }

  /**
   * Prepares this table before a record operation.
   *
   * @returns A promise that resolves after compatible initialization.
   */
  prepare(): Promise<void> {
    return this.admit(() => this.prepareInternal());
  }

  /**
   * Prepares an already admitted operation, including after the factory fence.
   *
   * @returns Completion after table preparation.
   */
  private prepareInternal(): Promise<void> {
    return this.lifecycle.track(Promise.resolve().then(() => this.prepareBound()));
  }

  /**
   * Binds the destination and prepares its physical table.
   *
   * @returns Completion after physical table preparation.
   */
  private async prepareBound(): Promise<void> {
    this.#binding ??= this.bind().catch((error: unknown) => {
      this.#binding = undefined;
      throw error;
    });
    await this.#binding;
    if (this.#initializer === undefined) throw new Error("PostgreSQL table is not bound.");
    await this.#initializer.prepare();
  }

  /**
   * Resolves the database before constructing the schema-bound initializer.
   *
   * @returns Completion after the initializer is available.
   */
  private async bind(): Promise<void> {
    await this.lifecycle.resolve();
    const table = this.onSchema(this.lifecycle.schema);
    this.#table = table;
    const create = this.create;
    this.#initializer = new PostgresTableInitializer(
      this.lifecycle,
      table.schema,
      table as never,
      create === undefined ? undefined : () => create(table),
    );
  }

  /**
   * Opens package-local bounded history operations for this record family.
   *
   * @internal
   * @returns PostgreSQL-only history execution capabilities.
   */
  historyExecutor(): PostgresRecordExecutor<I, R> {
    return {
      prepare: () => this.prepare(),
      transaction: (work) => this.transaction(work),
      using: (work) => this.using(work),
      read: (client, id, lock) => this.readOn(client, id, lock === "for-update"),
      assertImmutable: async (client, record) => {
        const existing = await this.readOn(client, this.recordSpec.idValueIn(record));
        if (existing !== undefined && !this.same(existing, record))
          throw new PostgresStorageOperationError("PostgreSQL immutable record collides.");
      },
      appendImmutable: (client, record) => this.appendImmutableOn(client, record),
      write: (client, record) => this.writeOn(client, record),
      query: (client, sql, values) => this.historyEntries(client, sql, values),
      column: (name, value) => this.historyColumn(name, value),
      table: () => this.qualified(),
      lock: (domain, ...identity) => this.historyKey(domain, identity),
    };
  }

  /**
   * Closes this handle and unregisters it from the factory.
   */
  override close(): void {
    if (!this.isOpen()) return;
    super.close();
    this.onClose();
  }

  /**
   * Registers a complete public operation before invoking record callbacks.
   *
   * @typeParam T The operation result.
   * @param work Performs the public record operation.
   * @returns The complete admitted outcome.
   */
  private admit<T>(work: () => Promise<T>): Promise<T> {
    if (!this.isOpen() || !this.lifecycle.publicOpen())
      return Promise.reject(new Error("PostgreSQL record storage is closed."));
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    void this.lifecycle.track(promise);
    try {
      void work().then(resolve, reject);
    } catch (error) {
      reject(error);
    }
    return promise;
  }

  /**
   * Deletes one public record under the factory admission fence.
   * @inheritdoc
   */
  override delete(id: I): Promise<boolean> {
    return this.admit(() => super.delete(id));
  }

  /**
   * Reads one public record under the factory admission fence.
   * @inheritdoc
   */
  override read(id: I): Promise<R | undefined> {
    return this.admit(() => super.read(id));
  }

  /**
   * Indexes public records under the factory admission fence.
   * @inheritdoc
   */
  override index(query: RecordQuery<I> = {}): Promise<readonly I[]> {
    return this.admit(() => super.index(query));
  }

  /**
   * Queries public records under the factory admission fence.
   * @inheritdoc
   */
  override query(query: RecordQuery<I> = {}): Promise<readonly R[]> {
    return this.admit(() => super.query(query));
  }

  /**
   * Queries public record entries under the factory admission fence.
   * @inheritdoc
   */
  override queryEntries(query: RecordQuery<I> = {}): Promise<readonly RecordEntry<I, R>[]> {
    return this.admit(() => super.queryEntries(query));
  }

  /**
   * Queries a normalized plan under the factory admission fence.
   * @inheritdoc
   */
  override queryPlan(plan: NormalizedQueryPlan<I>): Promise<readonly R[]> {
    return this.admit(async () =>
      (await super.queryPlanEntries(plan)).map((entry) => entry.record),
    );
  }

  /**
   * Queries normalized entries under the factory admission fence.
   * @inheritdoc
   */
  override queryPlanEntries(plan: NormalizedQueryPlan<I>): Promise<readonly RecordEntry<I, R>[]> {
    return this.admit(() => super.queryPlanEntries(plan));
  }

  /**
   * Writes a public record under the factory admission fence.
   * @inheritdoc
   */
  override write(record: R): Promise<void> {
    return this.admit(() => super.write(record));
  }

  /**
   * Compares and sets a public record under the factory admission fence.
   * @inheritdoc
   */
  override compareAndSet(id: I, expected: R | undefined, next: R | undefined): Promise<boolean> {
    return this.admit(() => super.compareAndSet(id, expected, next));
  }

  /**
   * Writes a public batch under the factory admission fence.
   * @inheritdoc
   */
  override writeAll(records: Iterable<R>): Promise<void> {
    return this.admit(() => super.writeAll(records));
  }

  /**
   * Writes an immutable record or confirms an identical existing payload.
   *
   * @param record Provides the immutable record to store.
   * @returns A promise that resolves when the payload is stored or confirmed.
   */
  writeImmutable(record: R): Promise<void> {
    return this.admit(() => this.using((client) => this.appendImmutableOn(client, record))).catch(
      (error: unknown) => {
        throw operationError(error);
      },
    );
  }

  /**
   * Checks whether an immutable record is absent or byte-identical.
   *
   * @param record Provides the immutable record to inspect.
   * @returns A promise that rejects when the stored payload differs.
   */
  async assertImmutable(record: R): Promise<void> {
    const existing = await this.admit(() => super.read(this.recordSpec.idValueIn(record)));
    if (existing === undefined || this.same(existing, record)) return;
    throw new PostgresStorageOperationError("PostgreSQL immutable record collides.");
  }

  /**
   * Deletes one record by storage ID.
   *
   * @param id Identifies the record to delete.
   * @returns Whether a stored record was deleted.
   */
  protected async deleteRecord(id: I): Promise<boolean> {
    return this.using(async (client) => this.deleteOn(client, id)).catch((error: unknown) => {
      throw operationError(error);
    });
  }

  /**
   * Reads one record by storage ID.
   *
   * @param id Identifies the record to read.
   * @returns The decoded record, when present.
   */
  protected readRecord(id: I): Promise<R | undefined> {
    return this.using((client) => this.readOn(client, id));
  }

  /**
   * Returns query records from one parameterized PostgreSQL statement.
   *
   * @param query Defines IDs, filters, order, continuation, and bounds.
   * @returns The decoded records admitted by the query.
   */
  protected async queryRecordEntries(query: RecordQuery<I>): Promise<readonly RecordEntry<I, R>[]> {
    if (query.ids?.length === 0) return [];
    return this.using((client) => this.entries(client, this.recordQuery(query)));
  }

  /**
   * Returns complete normalized-plan pushdown capabilities.
   *
   * @returns The normalized query features implemented by this storage.
   */
  protected override queryCapabilities(): StorageQueryCapabilities {
    return {
      comparisons: ["equal", "greaterThan", "lessThan", "greaterOrEqual", "lessOrEqual"],
      features: ["either", "nested", "order", "limit"],
    };
  }

  /**
   * Executes a normalized plan as one parameterized statement.
   *
   * @param plan Defines the validated normalized predicate and bounds.
   * @returns The decoded records admitted by the plan.
   */
  protected override async queryPlanRecordEntries(
    plan: NormalizedQueryPlan<I>,
  ): Promise<readonly RecordEntry<I, R>[]> {
    this.validatePlan(plan);
    return this.using((client) => this.entries(client, this.planQuery(plan)));
  }

  /**
   * Checks plan columns and bind count before connecting to PostgreSQL.
   *
   * @param plan The normalized query definition.
   */
  private validatePlan(plan: NormalizedQueryPlan<I>): void {
    for (const item of plan.order ?? []) this.column(item.column);
    const visit = (predicate: NormalizedQueryPredicate<I>): void => {
      if (predicate.kind === "comparison") this.column(predicate.column);
      if (predicate.kind === "all" || predicate.kind === "either")
        for (const child of predicate.predicates) visit(child);
    };
    if (plan.predicate !== undefined) visit(plan.predicate);
    if (!plan.exhaustive && this.predicateBindCount(plan.predicate) >= maximumNormalizedPlanBinds)
      throw new PostgresStorageOperationError(
        "PostgreSQL normalized query exceeds the 1000-parameter bind budget.",
      );
  }

  /**
   * Compares and conditionally mutates one row with a raw-byte SQL guard.
   *
   * @param id Identifies the record slot.
   * @param expected Specifies the current materialized record required to write.
   * @param next Specifies the replacement record, or absence for deletion.
   * @returns Whether the current stored payload matched the expected payload.
   */
  protected async compareAndSetRecord(
    id: I,
    expected: Materialized<I, R> | undefined,
    next: Materialized<I, R> | undefined,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await this.using((client) => this.casOnce(client, id, expected, next));
      if (result !== undefined) return result;
    }
    throw new PostgresStorageOperationError(
      "PostgreSQL record compare-and-set contention exceeded.",
    );
  }

  /**
   * Writes all supplied materialized records independently in source order.
   *
   * @param records Provides the materialized records to write.
   * @returns A promise that resolves after all writes complete.
   */
  protected async writeAllRecords(records: readonly Materialized<I, R>[]): Promise<void> {
    for (const record of records) await this.writeRecord(record);
  }

  /**
   * Writes one materialized record.
   *
   * @param record Provides the materialized record to write.
   * @returns A promise that resolves after PostgreSQL applies the upsert.
   */
  protected writeRecord(record: Materialized<I, R>): Promise<void> {
    return this.using((client) => this.writeOn(client, record.record)).catch((error: unknown) => {
      throw operationError(error);
    });
  }

  /**
   * Applies one compare-and-set attempt using a conditional statement.
   *
   * @param client Provides the operation client.
   * @param id Identifies the guarded record.
   * @param expected Supplies the required current materialization.
   * @param next Supplies the replacement or requests deletion when absent.
   * @returns Whether the current record matched, or undefined after a guard miss.
   */
  private async casOnce(
    client: PoolClient,
    id: I,
    expected: Materialized<I, R> | undefined,
    next: Materialized<I, R> | undefined,
  ): Promise<boolean | undefined> {
    const raw = await this.rawOn(client, id);
    const current = raw === undefined ? undefined : this.decode(raw);
    if (!this.same(current, expected?.record)) return false;
    if (next === undefined) {
      if (raw === undefined) return true;
      const deleted = await client.query(
        `DELETE FROM ${this.qualified()} WHERE "ID" = $1 AND "bytes" = $2`,
        [this.id(id), raw],
      );
      return deleted.rowCount === 1 ? true : undefined;
    }
    if (this.same(current, next.record)) return true;
    if (raw === undefined) {
      const inserted = await client.query(
        `${this.insertSql()} ON CONFLICT ("ID") DO NOTHING`,
        this.values(next.record, id),
      );
      return inserted.rowCount === 1 ? true : undefined;
    }
    const changed = await client.query(this.casUpdateSql(), [
      this.id(id),
      raw,
      ...this.values(next.record, id).slice(1),
    ]);
    return changed.rowCount === 1 ? true : undefined;
  }

  /**
   * Reads the exact bytes used as a conditional-mutation guard.
   * @param client Provides the operation client.
   * @param id Identifies the row.
   * @returns Stored bytes, if present.
   */
  private async rawOn(client: PoolClient, id: I): Promise<Uint8Array | undefined> {
    const result = await client.query<Row>(
      `SELECT "bytes" FROM ${this.qualified()} WHERE "ID" = $1`,
      [this.id(id)],
    );
    return result.rows[0] === undefined ? undefined : bytes(result.rows[0].bytes);
  }

  /**
   * Decodes one stored record with the provider's data-error boundary.
   * @param raw Supplies exact stored bytes.
   * @returns Decoded Protobuf record.
   */
  private decode(raw: Uint8Array): R {
    try {
      return fromBinary(this.recordSpec.recordType, raw);
    } catch (error) {
      throw new PostgresStorageDataError("Stored PostgreSQL record data is invalid.", {
        cause: error,
      });
    }
  }

  /**
   * Builds a conditional update that changes bytes and materialized columns together.
   * @returns Parameterized update SQL.
   */
  private casUpdateSql(): string {
    const names = ["bytes", ...this.recordSpec.columns.map(({ name }) => name)];
    const assignments = names.map((name, index) => `${quote(name)} = $${String(index + 3)}`);
    return `UPDATE ${this.qualified()} SET ${assignments.join(", ")} WHERE "ID" = $1 AND "bytes" = $2`;
  }

  /**
   * Executes work with one prepared and automatically released client.
   *
   * @typeParam T The value returned by the client work.
   * @param work Performs the client work.
   * @returns The value returned by the work.
   */
  private using<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.lifecycle.track(this.usePrepared(work));
  }

  /**
   * Executes one prepared record operation on a released client.
   *
   * @typeParam T The operation result.
   * @param work Performs the client operation.
   * @returns The operation result.
   */
  private async usePrepared<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    await this.prepareInternal();
    const client = await this.lifecycle.acquire();
    let discard = false;
    try {
      return await work(client);
    } catch (error) {
      discard = PostgresClientDisposal.required(error);
      throw operationError(error);
    } finally {
      client.release(
        discard ? new Error("PostgreSQL client discarded after provider failure.") : undefined,
      );
    }
  }

  /**
   * Executes Agent-scoped record work under one PostgreSQL transaction.
   *
   * @typeParam T Result of the transaction work.
   * @param work Operations to run on the acquired client.
   * @returns Result after commit.
   */
  private transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.lifecycle.track(this.transactionPrepared(work));
  }

  /**
   * Executes one prepared Agent transaction on a released client.
   *
   * @typeParam T The transaction result.
   * @param work Performs work on the transaction client.
   * @returns The committed result.
   */
  private async transactionPrepared<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    await this.prepareInternal();
    const client = await this.lifecycle.acquire();
    let releaseFailure: Error | undefined;
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        releaseFailure = new Error("PostgreSQL Agent transaction rollback failed.");
      }
      throw error;
    } finally {
      client.release(releaseFailure);
    }
  }

  /**
   * Calculates a stable Agent advisory key in this database and schema.
   *
   * @param domain Lock namespace within the provider.
   * @param identity Components of the lock identity.
   * @returns Stable advisory lock key.
   */
  private historyKey(domain: string, identity: readonly string[]): bigint {
    return createHash("sha256")
      .update(`spine-postgres-${domain}\0`)
      .update(this.lifecycle.databaseName)
      .update("\0")
      .update(this.lifecycle.schema)
      .update("\0")
      .update(identity.join("\0"))
      .digest()
      .readBigInt64BE();
  }

  /**
   * Reads and decodes one record on the supplied client.
   *
   * @param client Provides the active client.
   * @param id Identifies the record.
   * @param locked Whether to lock the selected row in the Agent transaction.
   * @returns The decoded record, when present.
   */
  private async readOn(client: PoolClient, id: I, locked = false): Promise<R | undefined> {
    const result = await client.query<Row>(
      `SELECT "bytes" FROM ${this.qualified()} WHERE "ID" = $1${locked ? " FOR UPDATE" : ""}`,
      [this.id(id)],
    );
    if (result.rows[0] === undefined) return undefined;
    try {
      return fromBinary(this.recordSpec.recordType, bytes(result.rows[0].bytes));
    } catch (error) {
      throw new PostgresStorageDataError("Stored PostgreSQL record data is invalid.", {
        cause: error,
      });
    }
  }

  /**
   * Executes a compiled query and decodes its record entries.
   *
   * @param client Provides the active client.
   * @param query Supplies the compiled SQL and bind values.
   * @returns The decoded record entries.
   */
  private async entries(
    client: PoolClient,
    query: Compiled,
  ): Promise<readonly RecordEntry<I, R>[]> {
    const result = await client.query<Row>(query.sql, [...query.values]);
    try {
      return result.rows.map((row) => ({
        id: this.#idColumn.read(row.ID),
        record: fromBinary(this.recordSpec.recordType, bytes(row.bytes)),
      }));
    } catch (error) {
      throw new PostgresStorageDataError("Stored PostgreSQL record data is invalid.", {
        cause: error,
      });
    }
  }

  /**
   * Writes one record on a caller-managed client.
   *
   * @param client Provides the acquired client.
   * @param record Supplies the record to write.
   * @returns A promise that resolves after the upsert.
   */
  private async writeOn(client: PoolClient, record: R): Promise<void> {
    const id = this.recordSpec.idValueIn(record);
    await client.query(this.upsertSql(), this.values(record, id));
  }

  /**
   * Deletes one record on a caller-managed client.
   *
   * @param client Provides the acquired client.
   * @param id Identifies the record.
   * @returns Whether PostgreSQL deleted a row.
   */
  private async deleteOn(client: PoolClient, id: I): Promise<boolean> {
    return (await client.query(this.deleteSql(), [this.id(id)])).rowCount === 1;
  }

  /**
   * Stores an immutable record or confirms an identical existing record.
   *
   * @param client Provides the acquired client.
   * @param record Supplies the immutable record.
   * @returns A promise that resolves after insertion or identity confirmation.
   */
  private async appendImmutableOn(client: PoolClient, record: R): Promise<void> {
    const id = this.recordSpec.idValueIn(record);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const inserted = await client.query(this.immutableSql(), this.values(record));
      if (inserted.rowCount === 1) return;
      const existing = await this.readOn(client, id);
      if (existing === undefined) continue;
      if (this.same(existing, record)) return;
      throw new PostgresStorageOperationError("PostgreSQL immutable record collides.");
    }
    throw new PostgresStorageOperationError("PostgreSQL immutable record contention exceeded.");
  }

  /**
   * Executes provider SQL and decodes its record rows.
   *
   * @param client Provides the active client.
   * @param sql Supplies parameterized SQL.
   * @param values Supply the bind values.
   * @returns The decoded records.
   */
  private async historyEntries(
    client: PoolClient,
    sql: string,
    values: readonly PostgresParameter[],
  ): Promise<readonly R[]> {
    const result = await client.query<Row>(sql, [...values]);
    try {
      return result.rows.map((row) => fromBinary(this.recordSpec.recordType, bytes(row.bytes)));
    } catch (error) {
      throw new PostgresStorageDataError("Stored PostgreSQL record data is invalid.", {
        cause: error,
      });
    }
  }

  /**
   * Converts one declared history column value to its database representation.
   *
   * @param name Names the declared column.
   * @param value Supplies its logical value.
   * @returns The PostgreSQL parameter value.
   */
  private historyColumn(name: string, value: unknown): PostgresParameter {
    const column = this.recordSpec.columns.find((candidate) => candidate.name === name);
    if (column === undefined)
      throw new PostgresStorageOperationError(`PostgreSQL history column is not declared: ${name}`);
    return ColumnMappings.value(this.#columns, column.type, value);
  }

  /**
   * Encodes one record as ordered table-column values.
   *
   * @param record Supplies the record to encode.
   * @param id Identifies the record.
   * @returns Values ordered for the generated insert statement.
   */
  private values(record: R, id = this.recordSpec.idValueIn(record)): PostgresParameter[] {
    const materialized = this.recordSpec.materialize(record);
    return [
      this.id(id),
      toBinary(this.recordSpec.recordType, record),
      ...this.recordSpec.columns.map((column) =>
        ColumnMappings.value(this.#columns, column.type, materialized.columns.get(column.name)),
      ),
    ];
  }

  /**
   * Builds parameterized PostgreSQL SQL for a record query.
   *
   * @param query Defines filters, ordering, continuation, and bounds.
   * @returns The compiled statement.
   */
  private recordQuery(query: RecordQuery<I>): Compiled {
    const bind = new Binds();
    const clauses = this.recordClauses(query, bind);
    const order = this.recordOrder(query);
    if (query.after !== undefined) clauses.push(this.continuation(query, bind));
    let sql = `SELECT "ID", "bytes" FROM ${this.qualified()}${where(clauses)} ORDER BY ${order}`;
    if (query.limit !== undefined) sql += ` LIMIT ${bind.add(query.limit)}`;
    if (query.offset !== undefined)
      sql +=
        query.limit === undefined
          ? this.offsetSql(bind, query.offset)
          : ` OFFSET ${bind.add(query.offset)}`;
    return bind.done(sql);
  }

  /**
   * Builds one bounded statement for a normalized query plan.
   *
   * @param plan Supplies the normalized plan.
   * @returns The compiled statement.
   */
  private planQuery(plan: NormalizedQueryPlan<I>): Compiled {
    const bind = new Binds();
    const safePredicate = plan.exhaustive
      ? this.exhaustivePredicate(plan.predicate)
      : plan.predicate;
    const scanAll =
      plan.exhaustive && this.predicateBindCount(safePredicate) >= maximumNormalizedPlanBinds;
    const predicate =
      safePredicate === undefined || scanAll ? "" : ` WHERE ${this.predicate(safePredicate, bind)}`;
    if (bind.values.length >= maximumNormalizedPlanBinds)
      throw new PostgresStorageOperationError(
        "PostgreSQL normalized query exceeds the 1000-parameter bind budget.",
      );
    const order = [
      ...(plan.order ?? []).map(
        (item) =>
          `${this.column(item.column)} ${item.direction === "desc" ? "DESC NULLS LAST" : "ASC NULLS FIRST"}`,
      ),
      '"ID" ASC',
    ].join(", ");
    const limit = plan.exhaustive
      ? plan.limit
      : Math.min(
          plan.limit ?? Number.MAX_SAFE_INTEGER,
          (plan.candidateLimit ?? defaultQueryCandidateLimit) + 1,
        );
    const exactLimit =
      !plan.exhaustive ||
      (!scanAll && safePredicate === plan.predicate && this.exhaustiveOrderMatches(plan));
    const limitClause = limit !== undefined && exactLimit ? ` LIMIT ${bind.add(limit)}` : "";
    return bind.done(
      `SELECT "ID", "bytes" FROM ${this.qualified()}${predicate} ORDER BY ${order}` + limitClause,
    );
  }

  /**
   * Returns only exhaustive predicates whose PostgreSQL result cannot differ from
   * the shared evaluator through text collation or NULL comparison semantics.
   *
   * @param predicate Predicate to inspect for safe narrowing.
   * @returns A safe necessary condition, or undefined for a complete scan.
   */
  private exhaustivePredicate(
    predicate: NormalizedQueryPredicate<I> | undefined,
  ): NormalizedQueryPredicate<I> | undefined {
    if (predicate === undefined) return undefined;
    if (predicate.kind === "ids") {
      const sqlType = this.table.columns.find((column) => column.name === "ID")?.postgresType;
      return (sqlType === "INT" && this.recordSpec.idType === "int32") ||
        (sqlType === "BIGINT" && this.recordSpec.idType === "int64")
        ? predicate
        : undefined;
    }
    if (predicate.kind === "comparison") {
      return this.exhaustiveComparisonSafe(predicate) ? predicate : undefined;
    }
    const children = predicate.predicates.map((child) => this.exhaustivePredicate(child));
    if (predicate.kind === "either")
      return children.every((child, index) => child === predicate.predicates[index])
        ? predicate
        : undefined;
    const retained = children.filter(
      (child): child is NormalizedQueryPredicate<I> => child !== undefined,
    );
    if (retained.length === 0) return undefined;
    return children.every((child, index) => child === predicate.predicates[index])
      ? predicate
      : { kind: "all", predicates: retained };
  }

  /**
   * Checks one comparison against both physical and logical column types.
   *
   * @param predicate Comparison to consider for SQL narrowing.
   * @returns Whether PostgreSQL and the evaluator compare its values alike.
   */
  private exhaustiveComparisonSafe(
    predicate: Extract<NormalizedQueryPredicate<I>, { kind: "comparison" }>,
  ): boolean {
    this.column(predicate.column);
    const sqlType = this.table.columns.find(
      (column) => column.name === predicate.column,
    )?.postgresType;
    const value = predicate.value;
    return (
      this.columnSemanticsMatch(predicate.column, sqlType) &&
      (sqlType === "BOOLEAN"
        ? predicate.operator === "equal" && typeof value === "boolean"
        : sqlType === "BIGINT"
          ? typeof value === "bigint"
          : typeof value === "number" && Number.isSafeInteger(value))
    );
  }

  /**
   * Checks whether numeric SQL ordering and the ID tie-break match the evaluator.
   *
   * @param plan Exhaustive plan with an application limit.
   * @returns Whether SQL may select the final limited prefix.
   */
  private exhaustiveOrderMatches(plan: NormalizedQueryPlan<I>): boolean {
    const idType = this.table.columns.find((column) => column.name === "ID")?.postgresType;
    if (!(
      (idType === "INT" && this.recordSpec.idType === "int32") ||
      (idType === "BIGINT" && this.recordSpec.idType === "int64")
    ))
      return false;
    return (plan.order ?? []).every((item) => {
      const sqlType = this.table.columns.find(
        (column) => column.name === item.column,
      )?.postgresType;
      return (
        (sqlType === "INT" || sqlType === "BIGINT") &&
        this.columnSemanticsMatch(item.column, sqlType)
      );
    });
  }

  /**
   * Checks that a physical numeric or Boolean column preserves its logical value type.
   *
   * @param column Declared query column.
   * @param sqlType Physical PostgreSQL column type.
   * @returns Whether SQL comparison can agree with the shared evaluator.
   */
  private columnSemanticsMatch(column: string, sqlType: string | undefined): boolean {
    const type = this.recordSpec.columns.find((candidate) => candidate.name === column)?.type;
    if (sqlType === "INT" && type?.kind === "enum") return true;
    if (type?.kind !== "scalar") return false;
    if (sqlType === "BOOLEAN") return type.scalar === ScalarType.BOOL;
    if (sqlType === "INT")
      return [ScalarType.INT32, ScalarType.SINT32, ScalarType.SFIXED32].includes(type.scalar);
    return (
      sqlType === "BIGINT" &&
      !type.longAsString &&
      [ScalarType.INT64, ScalarType.SINT64, ScalarType.SFIXED64].includes(type.scalar)
    );
  }

  /**
   * Calculates predicate parameters before selecting a complete scan.
   *
   * @param predicate Predicate tree whose leaves contribute bound values.
   * @returns Number of SQL parameters required by the predicate.
   */
  private predicateBindCount(predicate: NormalizedQueryPredicate<I> | undefined): number {
    if (predicate === undefined) return 0;
    if (predicate.kind === "ids") return predicate.ids.length;
    if (predicate.kind === "comparison") return 1;
    return predicate.predicates.reduce((count, child) => count + this.predicateBindCount(child), 0);
  }

  /**
   * Builds predicates for IDs and declared-column equality filters.
   *
   * @param query Supplies the record query.
   * @param bind Collects parameter values.
   * @returns SQL predicate fragments.
   */
  private recordClauses(query: RecordQuery<I>, bind: Binds): string[] {
    const clauses: string[] = [];
    if (query.ids !== undefined)
      clauses.push(`"ID" IN (${query.ids.map((id) => bind.add(this.id(id))).join(", ")})`);
    for (const filter of query.filters ?? []) {
      const column = this.column(filter.column === "id" ? "ID" : filter.column);
      const accepted = RecordQuery.acceptedValues(filter);
      const alternatives = accepted.map(
        (value) => `${column} IS NOT DISTINCT FROM ${bind.add(this.value(filter.column, value))}`,
      );
      clauses.push(
        accepted.length === 0
          ? "1=0"
          : accepted.length === 1
            ? (alternatives[0] ?? "1=0")
            : `(${alternatives.join(" OR ")})`,
      );
    }
    return clauses;
  }

  /**
   * Builds deterministic ordering for one record query.
   *
   * @param query Supplies the requested sort order.
   * @returns The PostgreSQL order expression.
   */
  private recordOrder(query: RecordQuery<I>): string {
    return [
      ...(query.sort ?? []).map(
        (item) =>
          this.column(item.field === "id" ? "ID" : item.field) +
          ` ${item.direction === "desc" ? "DESC NULLS LAST" : "ASC NULLS FIRST"}`,
      ),
      '"ID" ASC',
    ].join(", ");
  }

  /**
   * Builds the continuation predicate for one record query.
   *
   * @param query Supplies the sort order and continuation values.
   * @param bind Collects parameter values.
   * @returns The continuation predicate.
   */
  private continuation(query: RecordQuery<I>, bind: Binds): string {
    const sort = query.sort ?? [];
    const after = query.after;
    if (after === undefined) return "FALSE";
    const terms: string[] = [];
    for (let index = 0; index < sort.length; index += 1) {
      const current = sort[index];
      if (current === undefined) continue;
      const field = current.field === "id" ? "ID" : current.field;
      const prefix = sort
        .slice(0, index)
        .map(
          (item, previous) =>
            `${this.column(item.field === "id" ? "ID" : item.field)} ` +
            `IS NOT DISTINCT FROM ${bind.add(this.value(item.field, after.values[previous]?.value))}`,
        );
      const value = this.value(field, field === "ID" ? after.id : after.values[index]?.value);
      terms.push(
        `(${[
          ...prefix,
          this.afterTerm(this.column(field), current.direction ?? "asc", value, bind),
        ].join(" AND ")})`,
      );
    }
    const equal = sort.map(
      (item, index) =>
        `${this.column(item.field === "id" ? "ID" : item.field)} ` +
        `IS NOT DISTINCT FROM ${bind.add(this.value(item.field, after.values[index]?.value))}`,
    );
    terms.push(`(${[...equal, `"ID" > ${bind.add(this.id(after.id))}`].join(" AND ")})`);
    return `(${terms.join(" OR ")})`;
  }

  /**
   * Builds one direction-aware continuation comparison.
   *
   * @param column Supplies the quoted column name.
   * @param direction Supplies the requested sort direction.
   * @param value Supplies the continuation value.
   * @param bind Collects parameter values.
   * @returns The comparison expression.
   */
  private afterTerm(
    column: string,
    direction: string,
    value: PostgresParameter,
    bind: Binds,
  ): string {
    if (value === null) return direction === "desc" ? "FALSE" : `${column} IS NOT NULL`;
    return `(${column} IS NOT NULL AND ${column} ${direction === "desc" ? "<" : ">"} ${bind.add(value)})`;
  }

  /**
   * Builds SQL for one normalized query predicate recursively.
   *
   * @param predicate Supplies the normalized predicate.
   * @param bind Collects parameter values.
   * @returns The parameterized SQL predicate.
   */
  private predicate(predicate: NormalizedQueryPredicate<I>, bind: Binds): string {
    if (predicate.kind === "ids")
      return `"ID" IN (${predicate.ids.map((id) => bind.add(this.id(id))).join(", ")})`;
    if (predicate.kind === "comparison")
      return (
        `${this.column(predicate.column)} ${operator(predicate.operator)} ` +
        bind.add(this.value(predicate.column, predicate.value))
      );
    const joiner = predicate.kind === "all" ? " AND " : " OR ";
    return `(${predicate.predicates.map((child) => this.predicate(child, bind)).join(joiner)})`;
  }

  /**
   * Validates and quotes one queryable column name.
   *
   * @param name Names the requested column.
   * @returns The quoted PostgreSQL identifier.
   */
  private column(name: string): string {
    if (name === "ID") return '"ID"';
    if (!this.recordSpec.columns.some((column) => column.name === name))
      throw new PostgresStorageOperationError(`PostgreSQL query column is not declared: ${name}`);
    return quote(name);
  }

  /**
   * Converts one query value to its database representation.
   *
   * @param name Names the ID or declared column.
   * @param value Supplies the logical value.
   * @returns The PostgreSQL parameter value.
   */
  private value(name: string, value: unknown): PostgresParameter {
    if (name === "id" || name === "ID") return this.id(value as I);
    const column = this.recordSpec.columns.find((candidate) => candidate.name === name);
    if (column === undefined)
      throw new PostgresStorageOperationError(`PostgreSQL query column is not declared: ${name}`);
    return ColumnMappings.value(this.#columns, column.type, value);
  }

  /**
   * Converts one record ID to its database representation.
   *
   * @param id Supplies the logical ID.
   * @returns The PostgreSQL parameter value.
   */
  private id(id: I): PostgresParameter {
    try {
      return this.#idColumn.value(id);
    } catch (error) {
      throw operationError(error);
    }
  }

  /**
   * Compares two optional records by their Protobuf bytes.
   *
   * @param left Supplies the first record.
   * @param right Supplies the second record.
   * @returns Whether both records are absent or byte-identical.
   */
  private same(left: R | undefined, right: R | undefined): boolean {
    return left === undefined || right === undefined
      ? left === right
      : Buffer.from(toBinary(this.recordSpec.recordType, left)).equals(
          Buffer.from(toBinary(this.recordSpec.recordType, right)),
        );
  }

  /**
   * Returns the quoted schema-qualified table name.
   *
   * @returns The qualified PostgreSQL identifier.
   */
  private qualified(): string {
    return `${quote(this.lifecycle.schema)}.${quote(this.table.tableName)}`;
  }

  /**
   * Builds the delete statement for this record family.
   *
   * @returns Parameterized delete SQL.
   */
  private deleteSql(): string {
    return `DELETE FROM ${this.qualified()} WHERE "ID" = $1`;
  }

  /**
   * Builds the conflict-tolerant immutable insert statement.
   *
   * @returns Parameterized immutable-insert SQL.
   */
  private immutableSql(): string {
    return `${this.insertSql()} ON CONFLICT ("ID") DO NOTHING`;
  }

  /**
   * Builds the upsert statement for this record family.
   *
   * @returns Parameterized upsert SQL.
   */
  private upsertSql(): string {
    const names = ["ID", "bytes", ...this.recordSpec.columns.map(({ name }) => name)];
    const updates = names.slice(1).map((name) => `${quote(name)}=EXCLUDED.${quote(name)}`);
    return `${this.insertSql()} ON CONFLICT ("ID") DO UPDATE SET ${updates.join(", ")}`;
  }

  /**
   * Builds the base insert statement for this record family.
   *
   * @returns Parameterized insert SQL.
   */
  private insertSql(): string {
    const names = ["ID", "bytes", ...this.recordSpec.columns.map(({ name }) => name)];
    const columns = names.map(quote).join(", ");
    const values = names.map((_, index) => `$${String(index + 1)}`).join(", ");
    return `INSERT INTO ${this.qualified()} (${columns}) VALUES (${values})`;
  }

  /**
   * Builds PostgreSQL's unbounded-limit form for an offset-only query.
   *
   * @param bind Collects parameter values.
   * @param offset Supplies the requested row offset.
   * @returns The limit and offset clause.
   */
  private offsetSql(bind: Binds, offset: number): string {
    return ` LIMIT ${bind.add(9_223_372_036_854_775_807n)} OFFSET ${bind.add(offset)}`;
  }
}

/**
 * Represents one record after its declared columns are materialized.
 *
 * @typeParam I The record identifier type.
 * @typeParam R The Protobuf record type.
 */
type Materialized<I, R extends Message> = ReturnType<RecordSpec<I, R>["materialize"]>;

/**
 * Represents one raw record row returned by PostgreSQL.
 */
interface Row {
  readonly ID: unknown;
  readonly bytes: Uint8Array | Buffer;
}

/**
 * Contains parameterized SQL and its ordered bind values.
 */
interface Compiled {
  readonly sql: string;
  readonly values: readonly PostgresParameter[];
}

/**
 * Allocates PostgreSQL placeholders and collects their values.
 */
class Binds {
  readonly values: PostgresParameter[] = [];

  /**
   * Adds one bind value.
   *
   * @param value Supplies the value.
   * @returns Its one-based PostgreSQL placeholder.
   */
  add(value: PostgresParameter): string {
    this.values.push(value);
    return `$${String(this.values.length)}`;
  }

  /**
   * Completes one compiled statement.
   *
   * @param sql Supplies SQL containing the allocated placeholders.
   * @returns The statement and collected values.
   */
  done(sql: string): Compiled {
    return { sql, values: this.values };
  }
}

/**
 * Quotes one PostgreSQL identifier.
 *
 * @param value Supplies the identifier.
 * @returns The safely quoted identifier.
 */
function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Joins predicate fragments into an optional where clause.
 *
 * @param clauses Supply predicate fragments.
 * @returns An empty string or a complete where clause.
 */
function where(clauses: readonly string[]): string {
  return clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`;
}

/**
 * Copies a PostgreSQL binary value into a plain byte array.
 *
 * @param value Supplies the returned binary value.
 * @returns A plain byte array.
 */
function bytes(value: Uint8Array | Buffer): Uint8Array {
  return new Uint8Array(value);
}

/**
 * Converts a normalized comparison name to PostgreSQL SQL.
 *
 * @param value Supplies the normalized comparison name.
 * @returns Its SQL operator.
 */
function operator(value: string): string {
  return (
    (
      {
        equal: "IS NOT DISTINCT FROM",
        greaterThan: ">",
        lessThan: "<",
        greaterOrEqual: ">=",
        lessOrEqual: "<=",
      } as Record<string, string>
    )[value] ??
    (() => {
      throw new PostgresStorageOperationError("PostgreSQL query operator is invalid.");
    })()
  );
}

/**
 * Converts an arbitrary failure to the package's record-operation error.
 *
 * @param error Supplies the failure.
 * @returns The preserved or normalized storage error.
 */
function operationError(error: unknown): PostgresStorageOperationError {
  return error instanceof PostgresStorageOperationError || error instanceof PostgresStorageDataError
    ? error
    : new PostgresStorageOperationError("PostgreSQL record operation failed.", { cause: error });
}
