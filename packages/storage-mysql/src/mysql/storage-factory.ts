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

import { createPool, type Pool, type PoolConnection } from "mysql2/promise";
import { toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { StringifierRegistry } from "@spine-event-engine/core";
import {
  StorageFactory,
  type RecordStorage,
  type RecordSpec,
  type StorageContext,
  type StorageGroup,
} from "@spine-event-engine/storage";
import {
  TenantBoundary,
  TenantCatalogReads,
  StoragePreparations,
  stateHistorySpec,
  eventHistorySpec,
  type TenantCatalog,
  type TenantCatalogCursor,
  type TenantCatalogPage,
  type TenantCatalogRead,
  type StoragePreparationMode,
  type EntityStoragePreparationInput,
  type AgentHistoryStorageInput,
} from "@spine-event-engine/storage/provider";
import { AgentExecutionRecords, AgentHistoryRecords } from "@spine-event-engine/storage/provider";
import {
  EntityCommitStorageFactories,
  EntityCommitSnapshots,
  type EntityCommitStorage,
} from "@spine-event-engine/storage/provider";
import { AgentHistoryStorageFactories } from "@spine-event-engine/storage/provider";
import {
  AgentExecutionStorageFactories,
  type AgentExecutionStorageInput,
} from "@spine-event-engine/storage/provider";
import type { EntityStorageInput } from "@spine-event-engine/storage/provider";
import { eventStoreRecordSpec } from "@spine-event-engine/storage/provider";
import type { Event, TenantId } from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";

import {
  MysqlRecordStorage,
  MysqlTableInitializer,
  type MysqlRecordLifecycle,
} from "./record-storage.js";
import { MysqlTableResolver } from "./table-resolver.js";
import { MysqlEntityStorage } from "./entity-history.js";
import { MysqlAgentHistory, AgentHistoryHash, AgentHistoryIndexes } from "./agent-history.js";
import { MysqlAgentExecution } from "./agent-execution.js";
import { MysqlAgentTransaction } from "./agent-transaction.js";
import { resolvedMysqlTableSpec, type MysqlTableSpec } from "./table-spec.js";
import { MysqlStorageOperationError, MysqlStorageSchemaError, mysqlError } from "./errors.js";

export type { MysqlColumnSpec, MysqlTableSpec } from "./table-spec.js";

/**
 * Configures a MySQL storage connection pool.
 */
export interface MysqlStorageOptions {
  // prettier-ignore

  /**
   * Specifies the MySQL URL, including its database name.
   */
  readonly url: string;

  /**
   * Limits concurrently open pool connections.
   */
  readonly connectionLimit?: number;

  /**
   * Limits connection establishment time in milliseconds.
   */
  readonly connectTimeoutMs?: number;

  /**
   * Configures TLS for pool connections.
   */
  readonly tls?: {
    // prettier-ignore

    /**
     * Provides the certificate authority certificate.
     */
    readonly ca?: string;

    /**
     * Provides the client certificate.
     */
    readonly cert?: string;

    /**
     * Provides the client private key.
     */
    readonly key?: string;

    /**
     * Controls server certificate verification.
     */
    readonly rejectUnauthorized?: boolean;
  };
}

/**
 * Assigns one complete generated tenant to one MySQL database.
 */
export interface MysqlTenantStorageOptions {
  // prettier-ignore

  /**
   * Identifies the tenant that owns the database.
   */
  readonly tenantId: TenantId;

  /**
   * Configures the tenant's MySQL database and pool.
   */
  readonly options: MysqlStorageOptions;
}

/**
 * Resolves application-provided tenant database settings on first use.
 *
 * @param tenantId Complete generated tenant identity.
 * @returns Connection options for that tenant.
 */
export type MysqlTenantResolver = (
  tenantId: TenantId,
) => MysqlStorageOptions | Promise<MysqlStorageOptions>;

/**
 * Describes SQL that creates one resolved record-family table.
 */
export interface MysqlCreateOperation {
  // prettier-ignore

  /**
   * Contains the create-table SQL statement.
   */
  readonly sql: string;
}

/**
 * Creates a create-table operation for one resolved record family.
 *
 * @param table Describes the resolved table layout.
 * @returns Returns the create-table operation.
 * @typeParam I Record identifier type.
 * @typeParam R Stored Protobuf message type.
 */
export type CreateOperationFactory = <I, R extends Message>(
  table: MysqlTableSpec<I, R>,
) => MysqlCreateOperation;

/**
 * Configures and builds a MySQL storage factory.
 */
export interface MysqlStorageFactoryBuilder {
  // prettier-ignore

  /**
   * Sets the MySQL connection options.
   *
   * @param options Specifies the MySQL connection options.
   * @returns Returns this builder.
   */
  setOptions(options: MysqlStorageOptions): this;

  /**
   * Sets the complete multitenant database registry.
   *
   * @param entries Assign generated tenants to distinct physical databases.
   * @returns Returns this builder.
   */
  setTenantOptions(entries: readonly MysqlTenantStorageOptions[]): this;

  /**
   * Sets an asynchronous tenant destination resolver without invoking it during build.
   *
   * @param resolver Resolves one complete generated tenant ID.
   * @returns This builder.
   */
  setTenantResolver(resolver: MysqlTenantResolver): this;

  /**
   * Sets custom reversible message stringifiers used by IDs and columns.
   *
   * @param registry The schema-bound stringifier registry.
   * @returns Returns this builder.
   */
  setStringifierRegistry(registry: StringifierRegistry): this;

  /**
   * Sets the ungrouped table name for a record-family source type.
   *
   * For Entity current storage, this is the Entity state type, not the stored
   * `EntityRecord` envelope.
   *
   * @param sourceType Identifies the ungrouped family source Protobuf type.
   * @param name Specifies the physical table name.
   * @returns Returns this builder.
   * @typeParam S Source Protobuf message type.
   */
  setTableName<S extends Message>(sourceType: GenMessage<S>, name: string): this;

  /**
   * Sets the grouped table name for a source and record type.
   *
   * @param sourceType Identifies the source Protobuf type.
   * @param recordType Identifies the record Protobuf type.
   * @param name Specifies the physical table name.
   * @returns Returns this builder.
   * @typeParam S Source Protobuf message type.
   * @typeParam R Stored Protobuf record type.
   */
  setTableName<S extends Message, R extends Message>(
    sourceType: GenMessage<S>,
    recordType: GenMessage<R>,
    name: string,
  ): this;

  /**
   * Sets the create-table operation factory.
   *
   * @param factory Creates SQL for resolved record-family tables.
   * @returns Returns this builder.
   */
  useOperationFactory(factory: CreateOperationFactory): this;

  /**
   * Builds a logical MySQL storage factory without opening a connection.
   *
   * @returns A locally validated logical factory without an open connection.
   */
  build(): Promise<MysqlStorageFactory>;
}

/**
 * Reports invalid MySQL storage configuration.
 */
export class MysqlStorageConfigurationError extends Error {}

/**
 * Reports MySQL connection failures.
 */
export class MysqlStorageConnectionError extends Error {}

/**
 * Reports incompatible MySQL record-family schemas.
 */
export { MysqlStorageSchemaError } from "./errors.js";

/**
 * Reports invalid MySQL storage data.
 */
export { MysqlStorageDataError } from "./errors.js";

/**
 * Reports sanitized MySQL storage operation failures.
 */
export { MysqlStorageOperationError } from "./errors.js";

/**
 * Pages the configured MySQL tenant databases without materializing the catalog.
 */
class MysqlTenantCatalog implements TenantCatalog {
  readonly #cursorIdentity = {};

  /**
   * Checks fixed configured membership without invoking a resolver.
   *
   * @param boundary Complete tenant boundary to inspect.
   * @returns Whether the boundary is explicitly configured.
   */
  contains(boundary: TenantBoundary): Promise<boolean> {
    return Promise.resolve(this.byTenant.has(boundary.key));
  }

  /**
   * Stores configured database mappings for bounded catalog pages.
   *
   * @param databases Configured databases in deterministic order.
   * @param byTenant Exact boundary-to-database lookup.
   */
  constructor(
    private readonly databases: readonly MysqlDatabaseConfig[],
    private readonly byTenant: ReadonlyMap<string | symbol, MysqlDatabaseConfig>,
  ) {}

  /**
   * Returns every configured boundary for legacy catalog callers.
   *
   * @returns All configured tenant boundaries.
   */
  all(): Promise<readonly TenantBoundary[]> {
    return Promise.resolve(this.databases.map(({ boundary }) => boundary));
  }

  /**
   * Reads one bounded configured-database page.
   *
   * @param request Page size, cancellation, and continuation.
   * @returns The selected complete tenant boundaries.
   */
  page(request: TenantCatalogRead): Promise<TenantCatalogPage> {
    return Promise.resolve().then(() => {
      TenantCatalogReads.require(request);
      const after = request.after;
      if (after !== undefined && !(after instanceof MysqlTenantCursor))
        throw new TypeError("MySQL tenant catalog continuation is invalid.");
      const cursor = after?.state(this.#cursorIdentity);
      const length = cursor?.length ?? this.databases.length;
      const start = cursor?.index ?? 0;
      const end = Math.min(length, start + request.count);
      const boundaries = this.databases.slice(start, end).map(({ boundary }) => boundary);
      request.signal.throwIfAborted();
      return {
        boundaries,
        ...(end < length
          ? { after: new MysqlTenantCursor(this.#cursorIdentity, end, length) }
          : {}),
        hasMore: end < length,
      };
    });
  }

  /**
   * Checks that this factory has a database for the supplied boundary.
   *
   * @param boundary Complete tenant boundary to verify.
   * @returns Completion when that tenant is configured.
   */
  keep(boundary: TenantBoundary): Promise<void> {
    return this.byTenant.has(boundary.key)
      ? Promise.resolve()
      : Promise.reject(
          new MysqlStorageConfigurationError("MySQL storage has no configured tenant."),
        );
  }

  /**
   * Closes the catalog without releasing a separate resource.
   *
   * @returns Completion of the catalog close.
   */
  close(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Immutable continuation issued by one configured MySQL catalog.
 */
class MysqlTenantCursor implements TenantCatalogCursor {
  readonly [Symbol.toStringTag] = "TenantCatalogCursor" as const;

  readonly #identity: object;

  readonly #index: number;

  readonly #length: number;

  /**
   * Captures one configured-database sweep position.
   *
   * @param identity Private catalog issuance identity.
   * @param index Next database position.
   * @param length Fixed database count for this sweep.
   */
  constructor(identity: object, index: number, length: number) {
    this.#identity = identity;
    this.#index = index;
    this.#length = length;
    Object.freeze(this);
  }

  /**
   * Verifies issuance before exposing the fixed sweep position.
   *
   * @param identity Private identity of the reading catalog.
   * @returns Fixed database count and next position.
   */
  state(identity: object): { index: number; length: number } {
    if (this.#identity !== identity)
      throw new TypeError("MySQL tenant catalog continuation is invalid.");
    return { index: this.#index, length: this.#length };
  }
}

/**
 * Provides MySQL record-family storage.
 */
export class MysqlStorageFactory extends StorageFactory {
  readonly #handles = new Set<{ close(): void }>();

  readonly #commits = new Set<MysqlEntityCommitStorage<unknown, Message>>();

  readonly #resolver: MysqlTableResolver;

  readonly #databases = new Map<string | symbol, MysqlDatabase>();

  readonly #configs: ReadonlyMap<string | symbol, MysqlDatabaseConfig>;

  readonly #pending = new Map<string | symbol, Promise<MysqlDatabase>>();

  readonly #work = new Set<Promise<unknown>>();

  readonly #tenantTargets = new Map<string, string | symbol>();

  readonly #families = new Map<string, string | symbol>();

  readonly #prepared = new Map<string | symbol, Map<string, MysqlPreparedRequirement>>();

  readonly #bindings = new Map<string | symbol, MysqlDatabaseConfig>();

  readonly #bindingPending = new Map<string | symbol, Promise<MysqlDatabaseConfig>>();

  #sharedCheck: Promise<void> | undefined;

  readonly #catalog: TenantCatalog;

  /**
   * Whether this record family is closed.
   */
  #closed: Promise<void> | undefined;

  /**
   * Creates a logical factory from locally validated settings.
   *
   * @param configs Supplies configured database settings.
   * @param tenantResolver Resolves dynamic tenant settings when configured.
   * @param resolver Resolves record-family table names.
   * @param createOperation Creates optional table SQL.
   * @param stringifiers Converts message-valued IDs and columns.
   */
  private constructor(
    configs: readonly MysqlDatabaseConfig[],
    private readonly tenantResolver: MysqlTenantResolver | undefined,
    resolver = new MysqlTableResolver(),
    private readonly createOperation?: CreateOperationFactory,
    private readonly stringifiers = new StringifierRegistry(),
  ) {
    super();
    this.#resolver = resolver;
    this.#configs = new Map(configs.map((config) => [config.boundary.key, config]));
    for (const config of configs)
      if (!config.boundary.single) this.#tenantTargets.set(config.target, config.boundary.key);
    const tenants = configs.filter(({ boundary }) => !boundary.single);
    this.#catalog = new MysqlTenantCatalog(tenants, this.#configs);
    EntityCommitStorageFactories.register(this, {
      createEntityCommitStorage: (input) => this.createEntityCommitStorage(input),
    });
    StoragePreparations.register(this, {
      prepareRecord: (context, spec, group, mode) => this.prepareRecord(context, spec, group, mode),
      prepareEntity: (input, mode) => this.prepareEntity(input, mode),
      prepareAgentHistory: (input, mode) => this.prepareAgentHistory(input, mode),
    });
    this.registerAgentHistory();
    this.registerAgentExecution();
  }

  /**
   * Registers the required provider-only Agent history capability.
   */
  private registerAgentHistory(): void {
    AgentHistoryStorageFactories.register(this, {
      createAgentHistoryStorage: (input) => {
        if (!this.isOpen()) throw new Error("StorageFactory is closed.");
        return new MysqlAgentHistory(
          input,
          this.createMysqlRecordStorage(
            input.context,
            AgentHistoryRecords.spec((value) => AgentHistoryHash.value(value)),
            AgentHistoryRecords.group,
          ),
          this.admitPublic,
        );
      },
    });
  }

  /**
   * Registers durable Agent execution over the selected tenant database.
   */
  private registerAgentExecution(): void {
    AgentExecutionStorageFactories.register(this, {
      createAgentExecutionStorage: (input) => this.createAgentExecution(input),
    });
  }

  /**
   * Opens all record families required by fenced Agent completion.
   *
   * @param input Requested fenced execution change.
   * @returns Tenant-scoped Agent execution storage handle.
   * @typeParam I Typed entity identifier.
   * @typeParam S Generated Entity state.
   */
  private createAgentExecution<I, S extends Message>(
    input: AgentExecutionStorageInput<I, S>,
  ): MysqlAgentExecution<I, S> {
    if (!this.isOpen()) throw new Error("StorageFactory is closed.");
    const boundary = this.database(input.entity.context);
    const context = input.entity.context;
    const digest = (value: string) => AgentHistoryHash.value(value);
    return new MysqlAgentExecution(
      input,
      {
        invocation: this.createMysqlRecordStorage(
          context,
          AgentExecutionRecords.invocationSpec(digest),
          AgentExecutionRecords.invocationGroup,
          boundary,
        ),
        head: this.createMysqlRecordStorage(
          context,
          AgentExecutionRecords.headSpec(digest),
          AgentExecutionRecords.headGroup,
          boundary,
        ),
        history: this.createMysqlRecordStorage(
          context,
          AgentHistoryRecords.spec(digest),
          AgentHistoryRecords.group,
          boundary,
        ),
        entity: this.createEntityStorage(input.entity),
        events: this.createMysqlRecordStorage(context, eventStoreRecordSpec, undefined, boundary),
      },
      new MysqlAgentTransaction(this.connections(boundary)),
      this.admitPublic,
    );
  }

  /**
   * Creates a MySQL storage factory builder.
   *
   * @returns Returns a new builder.
   */
  static newBuilder(): MysqlStorageFactoryBuilder {
    return new Builder(
      (entries, tenantResolver, resolver, operation, stringifiers) =>
        new MysqlStorageFactory(entries, tenantResolver, resolver, operation, stringifiers),
    );
  }

  /**
   * Returns the provider-owned configured tenant catalog.
   *
   * @returns The factory-owned tenant catalog.
   */
  tenantCatalog(): TenantCatalog {
    return this.#catalog;
  }

  /**
   * Checks the shared destination without creating tables or retaining a temporary pool.
   *
   * @returns Completion after a read-only connection probe.
   */
  override checkConnection(): Promise<void> {
    if (!this.isOpen()) return Promise.reject(new Error("StorageFactory is closed."));
    const shared = this.#configs.get(TenantBoundary.single.key);
    if (shared === undefined)
      return Promise.reject(
        new MysqlStorageConfigurationError("Shared MySQL options are required."),
      );
    return (this.#sharedCheck ??= this.admitPublic(() => this.checkShared(shared)).catch(
      (error: unknown) => {
        this.#sharedCheck = undefined;
        throw error;
      },
    ));
  }

  /**
   * Checks the shared database using a retained runtime or disposable temporary pool.
   *
   * @param config Validated shared connection settings.
   * @returns Completion after the read-only probe and any temporary cleanup.
   */
  private async checkShared(config: MysqlDatabaseConfig): Promise<void> {
    const runtime = this.#databases.get(config.boundary.key);
    const pool = runtime?.pool ?? createPool(config.poolOptions);
    let failure: Error | undefined;
    try {
      const connection = await pool.getConnection();
      try {
        await connection.query("SELECT 1");
      } finally {
        connection.release();
      }
    } catch (error) {
      failure = new MysqlStorageConnectionError("Unable to connect to MySQL.", { cause: error });
    }
    if (runtime === undefined) await this.closeCheckedPool(pool, failure);
    else if (failure !== undefined) throw failure;
  }

  /**
   * Closes a temporary pool while retaining probe and cleanup failures.
   *
   * @param pool Temporary pool.
   * @param failure Prior probe failure, when present.
   * @returns Completion after disposal or combined failure.
   */
  private async closeCheckedPool(pool: Pool, failure?: Error): Promise<void> {
    let cleanup: unknown;
    try {
      await pool.end();
    } catch (error) {
      cleanup = error;
    }
    if (failure !== undefined && cleanup !== undefined)
      throw new AggregateError([failure, cleanup], "MySQL connection and cleanup failed.");
    if (failure !== undefined) throw failure;
    if (cleanup !== undefined) throw new Error("MySQL pool cleanup failed.", { cause: cleanup });
  }

  /**
   * Closes all storage handles and the connection pool.
   *
   * @returns Completion after handles and the pool close.
   */
  override close(): Promise<void> {
    this.fenceClose();
    if (this.#closed !== undefined) return this.#closed;
    const commits = [...this.#commits].map((handle) => handle.close());
    return (this.#closed = this.drain(commits));
  }

  /**
   * Closes independent handles and pools after admitted commit work.
   *
   * @param commits The admitted commit completions.
   * @returns Completion after admitted work and cleanup settle.
   */
  private async drain(commits: readonly Promise<void>[]): Promise<void> {
    const errors: unknown[] = [];
    for (const result of await Promise.allSettled(commits))
      if (result.status === "rejected") errors.push(result.reason);
    await Promise.allSettled([...this.#work, ...this.#pending.values(), this.#sharedCheck]);
    for (const handle of [...this.#handles]) {
      try {
        handle.close();
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await this.#catalog.close();
    } catch (error) {
      errors.push(error);
    }
    for (const result of await Promise.allSettled(
      [...this.#databases.values()].map(({ pool }) => pool.end()),
    ))
      if (result.status === "rejected") errors.push(result.reason);
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, "MySQL factory close failed.");
  }

  /**
   * Creates storage for one resolved record family.
   *
   * @param context Provides the storage context.
   * @param spec Describes the record family.
   * @param group Identifies an optional storage group.
   * @typeParam I Record identifier type.
   * @typeParam R Stored Protobuf message type.
   * @returns The record-family storage handle.
   */
  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): RecordStorage<I, R> {
    return this.createMysqlRecordStorage(context, spec, group, this.database(context), true, true);
  }

  /**
   * Creates a record-family handle for its tenant database.
   *
   * @typeParam I Record identifier type.
   * @typeParam R Stored Protobuf message type.
   * @param context Supplies the storage and tenant context.
   * @param spec Defines the record family.
   * @param group Selects a grouped history family, when present.
   * @param boundary Captures the tenant database selection.
   * @returns The opened MySQL record-storage handle.
   * @param tracked Whether the factory tracks this public handle.
   * @param publicHandle Whether calls use the public intake fence.
   */
  private createMysqlRecordStorage<I, R extends Message>(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    group?: StorageGroup,
    boundary = this.database(context),
    tracked = true,
    publicHandle = false,
  ): MysqlRecordStorage<I, R> {
    const tableSpec = this.tableSpec(spec, group);
    const table = { tableName: tableSpec.tableName };
    const operation = this.createOperation;
    const create = operation === undefined ? undefined : () => operation(tableSpec).sql;
    const handle = new MysqlRecordStorage(
      context,
      spec,
      table,
      this.connections(boundary, tableSpec),
      () => this.#handles.delete(handle),
      create,
      tableSpec,
      this.stringifiers,
      publicHandle,
    );
    if (tracked) this.#handles.add(handle);
    return handle;
  }

  /**
   * Resolves the physical declaration shared by ordinary use and preparation.
   * @typeParam I Typed record identifier.
   * @typeParam R Stored record type.
   * @param spec Record declaration.
   * @param group Optional physical group.
   * @returns Canonical MySQL table declaration.
   */
  private tableSpec<I, R extends Message>(
    spec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): MysqlTableSpec<I, R> {
    const name = this.#resolver.resolve(
      spec.sourceType.typeName,
      group?.name,
      undefined,
      spec.recordType.typeName,
    ).tableName;
    return resolvedMysqlTableSpec({
      tableName: name,
      sourceType: spec.sourceType,
      recordType: spec.recordType,
      idType: spec.idType,
      declaredColumns: spec.columns,
      ...(group === undefined ? {} : { groupName: group.name }),
    });
  }

  /**
   * Admits explicit record preparation through factory closure.
   * @typeParam I Typed record identifier.
   * @typeParam R Stored record type.
   * @param context Complete storage scope.
   * @param spec Record declaration.
   * @param group Optional physical group.
   * @param mode Creation or read-only inspection.
   * @returns Completion after physical compatibility.
   */
  private prepareRecord<I, R extends Message>(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    group: StorageGroup | undefined,
    mode: StoragePreparationMode,
  ): Promise<void> {
    return this.admitPublic(() => this.prepareRecordAdmitted(context, spec, group, mode));
  }

  /**
   * Prepares a record within an existing admitted operation.
   * @typeParam I Typed record identifier.
   * @typeParam R Stored record type.
   * @param context Complete storage scope.
   * @param spec Record declaration.
   * @param group Optional physical group.
   * @param mode Creation or read-only inspection.
   * @returns Completion after physical compatibility.
   */
  private prepareRecordAdmitted<I, R extends Message>(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    group: StorageGroup | undefined,
    mode: StoragePreparationMode,
  ): Promise<void> {
    return this.prepareTable(this.database(context), this.tableSpec(spec, group), mode);
  }

  /**
   * Prepares current Entity storage and enabled history families.
   * @typeParam I Typed Entity identifier.
   * @typeParam S Entity state type.
   * @param input Declarative Entity requirements.
   * @param mode Creation or read-only inspection.
   * @returns Completion after all enabled families are compatible.
   */
  private prepareEntity<I, S extends Message>(
    input: EntityStoragePreparationInput<I, S>,
    mode: StoragePreparationMode,
  ): Promise<void> {
    return this.admitPublic(async () => {
      if (!this.sameEntityColumns(input))
        throw new MysqlStorageSchemaError("Entity query columns differ from current records.");
      await this.prepareRecordAdmitted(input.context, input.recordSpec, undefined, mode);
      if (input.stateHistory) {
        const history = stateHistorySpec(input.stateSchema);
        await this.prepareRecordAdmitted(input.context, history.spec, history.group, mode);
      }
      if (input.eventHistory) {
        const history = eventHistorySpec(input.stateSchema);
        await this.prepareRecordAdmitted(input.context, history.spec, history.group, mode);
      }
    });
  }

  /**
   * Compares actual query columns with the current record declaration.
   * @typeParam I Typed Entity identifier.
   * @typeParam S Entity state type.
   * @param input Declarative Entity requirements.
   * @returns Whether column names and physical types match.
   */
  private sameEntityColumns<I, S extends Message>(
    input: EntityStoragePreparationInput<I, S>,
  ): boolean {
    const signature = (columns: typeof input.columns) =>
      JSON.stringify(
        columns
          .map((column) => [
            column.name,
            column.type.kind === "message"
              ? column.type.message.typeName
              : JSON.stringify(column.type),
          ])
          .sort(([a], [b]) => String(a).localeCompare(String(b))),
      );
    return signature(input.columns) === signature(input.recordSpec.columns);
  }

  /**
   * Prepares the surviving Agent audit table and fixed native indexes.
   * @typeParam I Typed Agent identifier.
   * @param input Agent scope and state type.
   * @param mode Creation or read-only inspection.
   * @returns Completion after all audit structures are compatible.
   */
  private prepareAgentHistory<I>(
    input: AgentHistoryStorageInput<I>,
    mode: StoragePreparationMode,
  ): Promise<void> {
    return this.admitPublic(async () => {
      TenantBoundary.of(input.context);
      if (input.stateType.trim().length === 0) throw new TypeError("Agent state type is required.");
      const spec = AgentHistoryRecords.spec((value) => AgentHistoryHash.value(value));
      await this.prepareRecordAdmitted(input.context, spec, AgentHistoryRecords.group, mode);
      const boundary = this.database(input.context);
      const table = this.tableSpec(spec, AgentHistoryRecords.group);
      for (const [name, columns] of AgentHistoryIndexes)
        await this.prepareAuditIndex(boundary, table, name, columns, mode);
    });
  }

  /**
   * Creates MySQL storage for one Entity family.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state message type.
   * @param input Configures the Entity storage families.
   * @returns The MySQL Entity storage handle.
   * @param lazy Whether optional families are acquired on first use.
   * @param tracked Whether the factory tracks this public handle.
   */
  private createEntityStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
    tracked = true,
    lazy = false,
  ): MysqlEntityStorage<I, S> {
    const boundary = this.database(input.context);
    const registration = {} as { handle: { close(): void } };
    const handle = new MysqlEntityStorage(
      input,
      (spec, group) => this.createMysqlRecordStorage(input.context, spec, group, boundary, tracked),
      () => this.#handles.delete(registration.handle),
      lazy,
      this.admitPublic,
    );
    registration.handle = handle;
    if (tracked) this.#handles.add(handle);
    return handle;
  }

  /**
   * Creates ordered independent Entity persistence. A later failed write may
   * leave completed records on every supported table engine.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state message type.
   * @param input Configures the Entity storage families.
   * @returns The Entity commit storage handle.
   */
  private createEntityCommitStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): EntityCommitStorage {
    if (!this.isOpen()) throw new Error("StorageFactory is closed.");
    const boundary = this.database(input.context);
    const registration = {} as { handle: { close(): void } };
    const handle = new MysqlEntityCommitStorage(
      input,
      () => this.createEntityStorage(input, false, true),
      () =>
        this.createMysqlRecordStorage(
          input.context,
          eventStoreRecordSpec,
          undefined,
          boundary,
          false,
        ),
      () => this.#commits.delete(registration.handle as MysqlEntityCommitStorage<unknown, Message>),
    );
    registration.handle = handle;
    this.#commits.add(handle as MysqlEntityCommitStorage<unknown, Message>);
    return handle;
  }

  /**
   * Creates the connection lifecycle for one tenant database.
   *
   * @param boundary Captured tenant database selection.
   * @param table Optional physical family for preparation and collision checks.
   * @returns The connection acquisition and release operations.
   * @typeParam I Typed record identifier.
   * @typeParam R Stored record message.
   */
  private connections<I, R extends Message>(
    boundary: TenantBoundary,
    table?: MysqlTableSpec<I, R>,
  ): MysqlRecordLifecycle {
    return {
      acquire: async () => {
        const database = await this.resolveDatabase(boundary);
        if (table !== undefined) this.assertFamily(boundary, table.tableName, database.target);
        return database.pool.getConnection();
      },
      ...(table === undefined
        ? {}
        : {
            prepare: async () => {
              await this.resolveDatabase(boundary);
              await this.prepareTable(boundary, table, "create");
            },
            prepareIndex: (name: string, columns: readonly string[]) =>
              this.resolveDatabase(boundary).then(() =>
                this.prepareAuditIndex(boundary, table, name, columns, "create"),
              ),
          }),
      track: (work) => this.track(work),
      publicOpen: () => this.isOpen(),
      release: (connection: PoolConnection) => {
        connection.release();
      },
    };
  }

  /**
   * Prepares one compatible physical requirement across handles and explicit preparation.
   *
   * @typeParam I Typed record identifier.
   * @typeParam R Stored record message.
   * @param boundary Captured tenant scope.
   * @param table Canonical physical declaration.
   * @param mode Creation or read-only check.
   * @returns Shared readiness or a retryable failure.
   */
  private prepareTable<I, R extends Message>(
    boundary: TenantBoundary,
    table: MysqlTableSpec<I, R>,
    mode: StoragePreparationMode,
  ): Promise<void> {
    const create = this.createOperation;
    return this.prepareRequirement(boundary, table.tableName, this.tableSignature(table), () =>
      this.attemptPreparation(boundary, table.tableName, (connection) =>
        new MysqlTableInitializer(
          { tableName: table.tableName },
          table,
          create === undefined ? undefined : () => create(table).sql,
        ).prepare(connection, mode),
      ),
    );
  }

  /**
   * Prepares one complete Agent audit index requirement.
   *
   * @typeParam I Typed record identifier.
   * @typeParam R Stored record message.
   * @param boundary Captured tenant scope.
   * @param table Canonical audit table declaration.
   * @param name Fixed native index name.
   * @param columns Ordered index columns.
   * @param mode Creation or read-only check.
   * @returns Shared readiness or retryable failure.
   */
  private prepareAuditIndex<I, R extends Message>(
    boundary: TenantBoundary,
    table: MysqlTableSpec<I, R>,
    name: string,
    columns: readonly string[],
    mode: StoragePreparationMode,
  ): Promise<void> {
    return this.prepareRequirement(
      boundary,
      `${table.tableName}\0${name}`,
      JSON.stringify(columns),
      () =>
        this.attemptPreparation(boundary, table.tableName, (connection) =>
          new MysqlTableInitializer({ tableName: table.tableName }, table).ensureHistoryIndex(
            connection,
            name,
            columns,
            mode,
          ),
        ),
    );
  }

  /**
   * Records pending work and successful physical evidence.
   *
   * @param boundary Captured tenant scope.
   * @param key Physical table or index identity.
   * @param signature Complete requirement declaration.
   * @param run One physical attempt.
   * @returns Shared completion.
   */
  private prepareRequirement(
    boundary: TenantBoundary,
    key: string,
    signature: string,
    run: () => Promise<void>,
  ): Promise<void> {
    const entries = this.#prepared.get(boundary.key) ?? new Map<string, MysqlPreparedRequirement>();
    this.#prepared.set(boundary.key, entries);
    const prior = entries.get(key);
    if (prior !== undefined && prior.signature !== signature)
      return Promise.reject(new MysqlStorageSchemaError("MySQL table definition conflicts."));
    if (prior?.ready) return Promise.resolve();
    if (prior?.pending !== undefined) return prior.pending;
    const entry: MysqlPreparedRequirement = { signature, ready: false, pending: undefined };
    entries.set(key, entry);
    entry.pending = Promise.resolve()
      .then(run)
      .then(
        () => {
          entry.ready = true;
        },
        (error: unknown) => {
          entries.delete(key);
          throw error;
        },
      )
      .finally(() => {
        entry.pending = undefined;
      });
    return entry.pending;
  }

  /**
   * Captures physical columns independently of declaration ordering.
   *
   * @typeParam I Typed record identifier.
   * @typeParam R Stored record message.
   * @param table Canonical physical table declaration.
   * @returns Stable structural signature.
   */
  private tableSignature<I, R extends Message>(table: MysqlTableSpec<I, R>): string {
    const id = table.idType as string | GenMessage<Message>;
    return JSON.stringify([
      table.sourceType.typeName,
      table.recordType.typeName,
      typeof id === "string" ? id : id.typeName,
      table.groupName ?? null,
      table.primaryKey,
      [...table.columns]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((column) => [
          column.name,
          column.mysqlType,
          column.nullable,
          column.defaultSql ?? null,
        ]),
    ]);
  }

  /**
   * Acquires an existing runtime pool or a released temporary pool for one attempt.
   *
   * @param boundary Captured tenant scope.
   * @param tableName Physical family name for collision checks.
   * @param work Physical inspection or creation on one connection.
   * @returns Completion including temporary cleanup.
   */
  private async attemptPreparation(
    boundary: TenantBoundary,
    tableName: string,
    work: (connection: PoolConnection) => Promise<void>,
  ): Promise<void> {
    const binding = await this.resolveBinding(boundary);
    const runtime = this.#databases.get(boundary.key);
    const pool = runtime?.pool ?? createPool(binding.poolOptions);
    let failure: Error | undefined;
    try {
      await this.performPreparation(pool, boundary, tableName, binding.target, work);
    } catch (error) {
      failure =
        error instanceof Error ? error : new Error("MySQL preparation failed.", { cause: error });
    }
    if (runtime === undefined) await this.closeCheckedPool(pool, failure);
    else if (failure !== undefined) throw failure;
  }

  /**
   * Performs one physical requirement on a released connection.
   * @param pool Bound or temporary pool.
   * @param boundary Captured tenant scope.
   * @param tableName Physical table identity.
   * @param target Validated destination identity.
   * @param work Physical inspection or creation.
   * @returns Completion after releasing the connection.
   */
  private async performPreparation(
    pool: Pool,
    boundary: TenantBoundary,
    tableName: string,
    target: string,
    work: (connection: PoolConnection) => Promise<void>,
  ): Promise<void> {
    const connection = await pool.getConnection().catch((error: unknown) => {
      throw new MysqlStorageConnectionError("Unable to connect to MySQL.", { cause: error });
    });
    try {
      this.assertFamily(boundary, tableName, target);
      try {
        await work(connection);
      } catch (error) {
        throw mysqlError(
          MysqlStorageSchemaError,
          "MySQL record-family schema is incompatible.",
          error,
        );
      }
    } finally {
      connection.release();
    }
  }

  /**
   * Records an admitted operation through factory shutdown.
   *
   * @typeParam T Operation result type.
   * @param work Admitted operation promise.
   * @returns The original operation outcome.
   */
  private track<T>(work: Promise<T>): Promise<T> {
    this.#work.add(work);
    void work.then(
      () => this.#work.delete(work),
      () => this.#work.delete(work),
    );
    return work;
  }

  /**
   * Admits complete public work before invoking configurable callbacks.
   *
   * @typeParam T Operation result.
   * @param work Complete public operation.
   * @returns Its tracked result.
   */
  private admitPublic = <T>(work: () => Promise<T>): Promise<T> => {
    if (!this.isOpen()) return Promise.reject(new Error("StorageFactory is closed."));
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    void this.track(promise);
    try {
      void work().then(resolve, reject);
    } catch (error) {
      reject(error);
    }
    return promise;
  };

  /**
   * Resolves the database configured for a storage context.
   *
   * @param context Supplies the storage and tenant context.
   * @returns The configured tenant database.
   */
  private database(context: StorageContext): TenantBoundary {
    const boundary = TenantBoundary.of(context);
    if (this.#configs.has(boundary.key) || (!boundary.single && this.tenantResolver !== undefined))
      return boundary;
    throw new MysqlStorageConfigurationError(
      "MySQL storage has no configured database for the requested tenant.",
    );
  }

  /**
   * Resolves and retains one tenant database, coalescing concurrent first uses.
   *
   * @param boundary Captured tenant boundary.
   * @returns The retained database and pool.
   */
  private resolveDatabase(boundary: TenantBoundary): Promise<MysqlDatabase> {
    const ready = this.#databases.get(boundary.key);
    if (ready !== undefined) return Promise.resolve(ready);
    const pending = this.#pending.get(boundary.key);
    if (pending !== undefined) return pending;
    const attempt = Promise.resolve()
      .then(() => this.bindDatabase(boundary))
      .then((database) => {
        this.#databases.set(boundary.key, database);
        return database;
      })
      .finally(() => this.#pending.delete(boundary.key));
    this.#pending.set(boundary.key, attempt);
    return attempt;
  }

  /**
   * Resolves one proven destination for preparation without retaining a pool.
   * @param boundary Captured tenant scope.
   * @returns Stable settings after a read-only connection probe.
   */
  private resolveBinding(boundary: TenantBoundary): Promise<MysqlDatabaseConfig> {
    const runtime = this.#databases.get(boundary.key);
    if (runtime !== undefined) return Promise.resolve(runtime.config);
    const bound = this.#bindings.get(boundary.key);
    if (bound !== undefined) return Promise.resolve(bound);
    const runtimePending = this.#pending.get(boundary.key);
    if (runtimePending !== undefined) return runtimePending.then((database) => database.config);
    const pending = this.#bindingPending.get(boundary.key);
    if (pending !== undefined) return pending;
    const attempt = this.bindTemporary(boundary)
      .then((config) => {
        this.#bindings.set(boundary.key, config);
        return config;
      })
      .finally(() => this.#bindingPending.delete(boundary.key));
    this.#bindingPending.set(boundary.key, attempt);
    return attempt;
  }

  /**
   * Checks one selected destination and releases its temporary pool.
   * @param boundary Captured tenant scope.
   * @returns Proven settings after cleanup succeeds.
   */
  private async bindTemporary(boundary: TenantBoundary): Promise<MysqlDatabaseConfig> {
    const config = await this.configFor(boundary);
    const reserved = this.reserveTenantTarget(config);
    let pool: Pool | undefined;
    let failure: Error | undefined;
    try {
      pool = createPool(config.poolOptions);
      const connection = await pool.getConnection();
      try {
        await connection.query("SELECT 1");
      } finally {
        connection.release();
      }
    } catch (error) {
      failure = new MysqlStorageConnectionError("Unable to connect to MySQL.", { cause: error });
    }
    try {
      if (pool !== undefined) await this.closeCheckedPool(pool, failure);
      else if (failure !== undefined) throw failure;
    } catch (error) {
      if (reserved) this.#tenantTargets.delete(config.target);
      throw error;
    }
    return config;
  }

  /**
   * Reads configured or application-resolved settings for a captured tenant.
   *
   * @param boundary Captured tenant boundary.
   * @returns Locally validated database settings.
   */
  private async configFor(boundary: TenantBoundary): Promise<MysqlDatabaseConfig> {
    const fixed = this.#configs.get(boundary.key);
    if (fixed !== undefined) return fixed;
    if (boundary.tenantId === undefined || this.tenantResolver === undefined)
      throw new MysqlStorageConfigurationError("MySQL tenant is not configured.");
    return MysqlConfigurations.parse(boundary, await this.tenantResolver(boundary.tenantId));
  }

  /**
   * Opens a runtime pool only after its selected database responds to a read-only probe.
   *
   * @param boundary Captured tenant boundary.
   * @returns The retained database and pool.
   */
  private async bindDatabase(boundary: TenantBoundary): Promise<MysqlDatabase> {
    const bound =
      this.#bindings.get(boundary.key) ?? (await this.#bindingPending.get(boundary.key));
    if (bound !== undefined)
      return {
        boundary,
        pool: createPool(bound.poolOptions),
        databaseName: bound.databaseName,
        target: bound.target,
        config: bound,
      };
    const config = await this.configFor(boundary);
    const reserved = this.reserveTenantTarget(config);
    let pool: Pool | undefined;
    try {
      pool = createPool(config.poolOptions);
      const connection = await pool.getConnection();
      try {
        await connection.query("SELECT 1");
      } finally {
        connection.release();
      }
      this.#bindings.set(boundary.key, config);
      return { boundary, pool, databaseName: config.databaseName, target: config.target, config };
    } catch (error) {
      if (reserved) this.#tenantTargets.delete(config.target);
      const failure = new MysqlStorageConnectionError("Unable to connect to MySQL.", {
        cause: error,
      });
      if (pool !== undefined) await this.closeCheckedPool(pool, failure);
      throw failure;
    }
  }

  /**
   * Rejects two distinct tenants mapped to the same physical database.
   *
   * @param config Validated selected database.
   * @returns Whether this attempt installed a new reservation.
   */
  private reserveTenantTarget(config: MysqlDatabaseConfig): boolean {
    if (config.boundary.single) return false;
    const prior = this.#tenantTargets.get(config.target);
    if (prior !== undefined && prior !== config.boundary.key)
      throw new MysqlStorageConfigurationError(
        "MySQL tenants must use distinct physical databases.",
      );
    if (prior !== undefined) return false;
    this.#tenantTargets.set(config.target, config.boundary.key);
    return true;
  }

  /**
   * Rejects shared and tenant record families mapped to the same unpartitioned table.
   *
   * @param boundary Captured storage boundary.
   * @param tableName Physical table name.
   * @param target Normalized database target.
   */
  private assertFamily(boundary: TenantBoundary, tableName: string, target: string): void {
    const key = `${target}\0${tableName}`;
    const prior = this.#families.get(key);
    if (prior !== undefined && prior !== boundary.key)
      throw new MysqlStorageConfigurationError("Shared and tenant MySQL tables collide.");
    this.#families.set(key, boundary.key);
  }
}

/**
 * Collects MySQL storage settings before opening database pools.
 */
class Builder implements MysqlStorageFactoryBuilder {
  #options: MysqlStorageOptions | undefined;

  #tenantOptions: readonly MysqlTenantStorageOptions[] | undefined;

  #tenantResolver: MysqlTenantResolver | undefined;

  readonly #resolver = new MysqlTableResolver();

  #operation: CreateOperationFactory | undefined;

  #stringifiers = new StringifierRegistry();

  /**
   * Creates a builder with its storage-factory connection function.
   *
   * @param assemble Constructs a logical factory from locally validated settings.
   */
  constructor(
    private readonly assemble: (
      entries: readonly MysqlDatabaseConfig[],
      tenantResolver: MysqlTenantResolver | undefined,
      resolver: MysqlTableResolver,
      operation: CreateOperationFactory | undefined,
      stringifiers: StringifierRegistry,
    ) => MysqlStorageFactory,
  ) {}

  // prettier-ignore

  /**
   * Sets the MySQL connection options.
   *
   * @param options Specifies the MySQL connection options.
   * @returns Returns this builder.
   */
  setOptions(options: MysqlStorageOptions): this {
    this.#options = { ...options, ...(options.tls === undefined ? {} : { tls: { ...options.tls } }) };
    return this;
  }

  /**
   * Sets the complete multitenant database registry.
   *
   * @param entries Assign generated tenants to distinct physical databases.
   * @returns Returns this builder.
   */
  setTenantOptions(entries: readonly MysqlTenantStorageOptions[]): this {
    this.#tenantOptions = entries.map(({ tenantId, options }) => ({
      tenantId,
      options: { ...options, ...(options.tls === undefined ? {} : { tls: { ...options.tls } }) },
    }));
    return this;
  }

  /**
   * Registers a tenant settings resolver without invoking it during build.
   *
   * @param resolver Resolves one complete generated tenant ID.
   * @returns This builder.
   */
  setTenantResolver(resolver: MysqlTenantResolver): this {
    this.#tenantResolver = resolver;
    return this;
  }

  /**
   * Sets custom reversible message stringifiers used by IDs and columns.
   *
   * @param registry The schema-bound stringifier registry.
   * @returns Returns this builder.
   */
  setStringifierRegistry(registry: StringifierRegistry): this {
    this.#stringifiers = new StringifierRegistry(registry);
    return this;
  }

  /**
   * Sets the ungrouped table name for a record-family source type.
   *
   * For Entity current storage, this is the Entity state type, not the stored
   * `EntityRecord` envelope.
   *
   * @param sourceType Identifies the ungrouped family source Protobuf type.
   * @param name Specifies the physical table name.
   * @returns Returns this builder.
   * @typeParam S Source Protobuf message type.
   */
  setTableName<S extends Message>(sourceType: GenMessage<S>, name: string): this;

  /**
   * Sets the grouped table name for a source and record type.
   *
   * @param sourceType Identifies the source Protobuf type.
   * @param recordType Identifies the record Protobuf type.
   * @param name Specifies the physical table name.
   * @returns Returns this builder.
   * @typeParam S Source Protobuf message type.
   * @typeParam R Stored Protobuf record type.
   */
  setTableName<S extends Message, R extends Message>(
    sourceType: GenMessage<S>,
    recordType: GenMessage<R>,
    name: string,
  ): this;

  /**
   * Sets a configured table name.
   *
   * @param args Provides the record-only or grouped registration arguments.
   * @returns Returns this builder.
   */
  setTableName(...args: unknown[]): this {
    if (args.length === 2) {
      const [source, name] = args as [GenMessage<Message>, string];
      this.#resolver.setRecordName(source.typeName, name);
    } else {
      const [source, record, name] = args as [GenMessage<Message>, GenMessage<Message>, string];
      this.#resolver.setGroupName(source.typeName, record.typeName, name);
    }
    return this;
  }

  /**
   * Sets the create-table operation factory.
   *
   * @param factory Creates SQL for resolved record-family tables.
   * @returns Returns this builder.
   */
  useOperationFactory(factory: CreateOperationFactory): this {
    this.#operation = factory;
    return this;
  }

  /**
   * Builds a logical MySQL storage factory without opening a connection.
   *
   * @returns A locally validated logical factory without an open connection.
   */
  build(): Promise<MysqlStorageFactory> {
    try {
      if (this.#options === undefined)
        throw new MysqlStorageConfigurationError("MySQL storage options are required.");
      if (this.#tenantOptions !== undefined && this.#tenantResolver !== undefined)
        throw new MysqlStorageConfigurationError(
          "Configure either tenant options or a tenant resolver, not both.",
        );
      const entries = [
        MysqlConfigurations.single(this.#options),
        ...(this.#tenantOptions === undefined
          ? []
          : MysqlConfigurations.multitenant(this.#tenantOptions)),
      ];
      return Promise.resolve(
        this.assemble(
          entries,
          this.#tenantResolver,
          this.#resolver,
          this.#operation,
          this.#stringifiers,
        ),
      );
    } catch (error) {
      if (error instanceof Error) return Promise.reject(error);
      return Promise.reject(
        new MysqlStorageConfigurationError("MySQL builder configuration is invalid.", {
          cause: error,
        }),
      );
    }
  }
}

interface MysqlDatabase {
  readonly boundary: TenantBoundary;
  readonly databaseName: string;
  readonly target: string;
  readonly pool: Pool;
  readonly config: MysqlDatabaseConfig;
}

interface MysqlDatabaseConfig {
  readonly boundary: TenantBoundary;
  readonly databaseName: string;
  readonly poolOptions: Parameters<typeof createPool>[0];
  readonly target: string;
}

/**
 * Caches only a successful physical proof or one pending attempt.
 */
interface MysqlPreparedRequirement {
  readonly signature: string;
  ready: boolean;
  pending: Promise<void> | undefined;
}

const MysqlConfigurations = Object.freeze({
  /**
   * Creates a database configuration for single-tenant storage.
   *
   * @param options Supplies the MySQL connection options.
   * @returns The single-tenant database configuration.
   */
  single(options: MysqlStorageOptions): MysqlDatabaseConfig {
    return MysqlConfigurations.parse(TenantBoundary.single, options);
  },

  /**
   * Creates database configurations for multitenant storage.
   *
   * @param entries Supplies tenant IDs and their database options.
   * @returns The tenant database configurations.
   */
  multitenant(entries: readonly MysqlTenantStorageOptions[]): readonly MysqlDatabaseConfig[] {
    if (entries.length === 0) {
      throw new MysqlStorageConfigurationError("Multitenant MySQL storage requires tenants.");
    }
    const configured = entries.map(({ tenantId, options }) =>
      MysqlConfigurations.parse(TenantBoundary.from(tenantId), options),
    );
    const tenants = new Set<string | symbol>();
    const targets = new Set<string>();
    for (const entry of configured) {
      if (tenants.has(entry.boundary.key)) {
        throw new MysqlStorageConfigurationError("MySQL storage has a duplicate tenant.");
      }
      if (targets.has(entry.target)) {
        throw new MysqlStorageConfigurationError(
          "MySQL tenants must use distinct physical databases.",
        );
      }
      tenants.add(entry.boundary.key);
      targets.add(entry.target);
    }
    return configured;
  },

  /**
   * Validates and resolves one tenant database configuration.
   *
   * @param boundary Identifies the tenant boundary.
   * @param options Supplies the MySQL connection options.
   * @returns The resolved database configuration.
   */
  parse(boundary: TenantBoundary, options: MysqlStorageOptions): MysqlDatabaseConfig {
    let url: URL;
    try {
      url = new URL(options.url);
    } catch {
      throw new MysqlStorageConfigurationError("MySQL storage requires a valid URL.");
    }
    if (url.protocol !== "mysql:" || url.pathname.length <= 1) {
      throw new MysqlStorageConfigurationError("MySQL storage URL requires a database.");
    }
    const databaseName = decodeURIComponent(url.pathname.slice(1));
    const port = url.port === "" ? 3306 : Number(url.port);
    return {
      boundary,
      databaseName,
      target: `${url.hostname.toLowerCase()}:${String(port)}/${databaseName.toLowerCase()}`,
      poolOptions: {
        host: url.hostname,
        ...(url.port === "" ? {} : { port }),
        database: databaseName,
        supportBigNumbers: true,
        bigNumberStrings: true,
        ...(url.username === "" ? {} : { user: decodeURIComponent(url.username) }),
        ...(url.password === "" ? {} : { password: decodeURIComponent(url.password) }),
        ...(options.connectionLimit === undefined
          ? {}
          : { connectionLimit: options.connectionLimit }),
        ...(options.connectTimeoutMs === undefined
          ? {}
          : { connectTimeout: options.connectTimeoutMs }),
        ...(options.tls === undefined ? {} : { ssl: options.tls }),
      },
    };
  },
});

/**
 * Writes one MySQL Entity mutation in independent record order.
 *
 * @typeParam I Captured Entity identifier type.
 * @typeParam S Captured Entity state type.
 */
type MysqlDeliveryStorage = MysqlRecordStorage<
  import("@spine-event-engine/proto").EventId,
  import("@spine-event-engine/proto").Event
>;

/**
 * Commits one MySQL Entity scope through retained record families.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Generated Entity state message type.
 */
class MysqlEntityCommitStorage<I, S extends Message> implements EntityCommitStorage {
  #open = true;

  /**
   * Retained Entity record families.
   */
  #storage: MysqlEntityStorage<I, S> | undefined;

  #events: MysqlDeliveryStorage | undefined;

  #idleOutcome: { error?: Error } | undefined;

  /**
   * Commit completions admitted before the close fence.
   */
  readonly #active = new Set<Promise<void>>();

  #closing: Promise<void> | undefined;

  /**
   * Creates a commit handle for one Entity scope.
   *
   * @param entity Defines the captured Entity scope.
   * @param openStorage Opens the current and history families.
   * @param openEvents Opens delivery Event storage.
   * @param onClose Removes the handle from factory tracking.
   */
  constructor(
    private readonly entity: EntityStorageInput<I, S>,
    private readonly openStorage: () => MysqlEntityStorage<I, S>,
    private readonly openEvents: () => MysqlRecordStorage<
      import("@spine-event-engine/proto").EventId,
      import("@spine-event-engine/proto").Event
    >,
    private readonly onClose: () => void,
  ) {}

  /**
   * Writes associated immutable records before current state.
   *
   * @typeParam Id Committed Entity identifier type.
   * @typeParam State Committed Entity state type.
   * @param input Supplies the affected Entity and immutable records.
   * @returns Completion after the provider commit.
   */
  commit<Id, State extends Message>(
    input: import("@spine-event-engine/storage/provider").EntityCommitInput<Id, State>,
  ): Promise<void> {
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
   */
  private track(action: () => Promise<void>): Promise<void> {
    let complete!: () => void;
    let fail!: (error: unknown) => void;
    const work = new Promise<void>((resolve, reject) => {
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
   * Persists an admitted captured mutation and one safe retry.
   *
   * @param prepared The immutable prepared mutation.
   * @returns Completion after the captured mutation is persisted.
   * @typeParam Id Entity identifier or record type.
   * @typeParam State Generated Entity state message type.
   */
  private async persist<Id, State extends Message>(
    prepared: import("@spine-event-engine/storage/provider").EntityCommitInput<Id, State>,
  ): Promise<void> {
    let storage: MysqlEntityStorage<I, S>;
    let events: MysqlDeliveryStorage | undefined;
    try {
      [storage, events] = this.openCommit(prepared);
      await storage.prepare();
      await events?.prepare();
      try {
        await this.apply(prepared, storage, events);
      } catch (error) {
        if (!this.retryable(error)) throw error;
        await this.apply(prepared, storage, events);
      }
    } catch (error) {
      throw mysqlError(MysqlStorageOperationError, "MySQL Entity commit failed.", error);
    }
  }

  /**
   * Opens only the record families required by this commit.
   *
   * @param input The captured Entity persistence input.
   * @returns The retained records required by this commit.
   * @typeParam Id Entity identifier or record type.
   * @typeParam State Generated Entity state message type.
   */
  private openCommit<Id, State extends Message>(
    input: import("@spine-event-engine/storage/provider").EntityCommitInput<Id, State>,
  ): [MysqlEntityStorage<I, S>, MysqlDeliveryStorage | undefined] {
    const storage = this.#storage ?? this.openStorage();
    let freshEvents: MysqlDeliveryStorage | undefined;
    try {
      if (input.events?.length && this.#events === undefined) freshEvents = this.openEvents();
      storage.ensure(Boolean(input.states?.length), Boolean(input.diagnostics?.length));
      this.#storage ??= storage;
      this.#events ??= freshEvents;
      return [storage, input.events?.length ? this.#events : undefined];
    } catch (error) {
      const failures: unknown[] = [];
      try {
        freshEvents?.close();
      } catch (cleanup) {
        failures.push(cleanup);
      }
      if (this.#storage === undefined)
        try {
          storage.close();
        } catch (cleanup) {
          failures.push(cleanup);
        }
      if (failures.length)
        throw new AggregateError([error, ...failures], "MySQL family acquisition failed.");
      throw error;
    }
  }

  /**
   * Determines whether a MySQL deadlock occurred through safe provider error wrappers.
   *
   * @param error Supplies the operation failure.
   * @returns Whether one captured-input retry is safe.
   */
  private retryable(error: unknown): boolean {
    let current = error;
    for (let depth = 0; depth < 4; depth += 1) {
      if (typeof current !== "object" || current === null) return false;
      const failure = current as { code?: unknown; errno?: unknown; cause?: unknown };
      if (failure.code === "ER_LOCK_DEADLOCK" || failure.errno === 1213) return true;
      current = failure.cause;
    }
    return false;
  }

  /**
   * Applies immutable rows before current state, retaining a completed prefix.
   *
   * @typeParam Id Committed Entity identifier type.
   * @typeParam State Committed Entity state type.
   * @param input Supplies the affected records.
   * @param storage Provides current Entity storage.
   * @param events Provides delivery Event storage.
   * @returns Completion after associated records and current state are written.
   */
  private async apply<Id, State extends Message>(
    input: import("@spine-event-engine/storage/provider").EntityCommitInput<Id, State>,
    storage: MysqlEntityStorage<I, S>,
    events:
      | MysqlRecordStorage<
          import("@spine-event-engine/proto").EventId,
          import("@spine-event-engine/proto").Event
        >
      | undefined,
  ): Promise<void> {
    for (const state of input.states ?? []) await storage.states.append(state);
    for (const diagnostic of input.diagnostics ?? []) await storage.events.append(diagnostic);
    for (const event of input.events ?? []) await events?.writeImmutable(event);
    const current = await storage.current.read(input.entityId as unknown as I);
    if (!sameEntity(current, input.next)) await storage.current.write(input.next);
  }

  /**
   * Validates the commit against this handle's Entity scope and configured histories.
   *
   * @typeParam Id Committed Entity identifier type.
   * @typeParam State Committed Entity state type.
   * @param input Supplies the Entity and Event records to validate.
   */
  private validate<Id, State extends Message>(
    input: import("@spine-event-engine/storage/provider").EntityCommitInput<Id, State>,
  ): void {
    if (!this.#open) throw new MysqlStorageOperationError("Entity commit storage is closed.");
    if (input.entity.sourceType.typeName !== this.entity.sourceType.typeName)
      throw new MysqlStorageOperationError("Entity commit source type is incompatible.");
    if (!this.accepts(input))
      throw new MysqlStorageOperationError("Entity commit context is incompatible.");
    if (!this.entity.stateHistory && (input.states?.length ?? 0) > 0)
      throw new MysqlStorageOperationError("Entity state history is disabled.");
    if (!this.entity.eventHistory && (input.diagnostics?.length ?? 0) > 0)
      throw new MysqlStorageOperationError("Entity event history is disabled.");
    this.validateRows(input);
    this.validateEventIds(input.diagnostics, "diagnostic");
    this.validateEventIds(input.events, "delivery");
  }

  /**
   * Rejects current and state-history rows for another Entity before I/O.
   *
   * @typeParam Id Committed Entity identifier type.
   * @typeParam State Committed Entity state type.
   * @param input Supplies the rows and requested Entity identifier.
   */
  private validateRows<Id, State extends Message>(
    input: import("@spine-event-engine/storage/provider").EntityCommitInput<Id, State>,
  ): void {
    for (const record of [input.next, ...(input.states ?? [])]) {
      const decoded =
        record.entityId === undefined ? undefined : input.entity.id.unpack(record.entityId);
      if (
        decoded === undefined ||
        input.entity.id.key(decoded) !== input.entity.id.key(input.entityId)
      )
        throw new MysqlStorageOperationError(
          "Entity commit record does not identify the requested Entity.",
        );
    }
  }

  /**
   * Rejects missing, blank, or repeated IDs in one Event family before I/O.
   *
   * @param events Supplies diagnostic or delivery Events.
   * @param family Identifies the Event family in a safe failure message.
   */
  private validateEventIds(events: readonly Event[] | undefined, family: string): void {
    const ids = events?.map((event) => event.id?.value) ?? [];
    if (ids.some((id) => id === undefined || id.trim() === "") || new Set(ids).size !== ids.length)
      throw new MysqlStorageOperationError(
        `Entity commit requires non-blank unique ${family} event IDs.`,
      );
  }

  /**
   * Closes this commit handle after work already started settles.
   *
   * @returns Completion after retained resources are closed.
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
    const failure = this.closeRetained();
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
    const failure = this.closeRetained();
    if (failure !== undefined) throw failure;
  }

  /**
   * Closes every retained record family and collects cleanup failures.
   *
   * @returns A cleanup failure, if any.
   */
  private closeRetained(): Error | undefined {
    const errors: unknown[] = [];
    for (const port of [this.#events, this.#storage]) {
      try {
        port?.close();
      } catch (error) {
        errors.push(error);
      }
    }
    this.#events = undefined;
    this.#storage = undefined;
    try {
      this.onClose();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) return errors[0] as Error;
    return errors.length ? new AggregateError(errors, "MySQL commit close failed.") : undefined;
  }

  /**
   * Checks the captured tenant boundary for one commit input.
   *
   * @typeParam Id Committed Entity identifier type.
   * @typeParam State Committed Entity state type.
   * @param input Supplies the requested context.
   * @returns Whether the context matches this handle.
   */
  private accepts<Id, State extends Message>(
    input: import("@spine-event-engine/storage/provider").EntityCommitInput<Id, State>,
  ): boolean {
    return (
      input.context.multitenant === this.entity.context.multitenant &&
      TenantBoundary.of(input.context).key === TenantBoundary.of(this.entity.context).key &&
      input.entity.context.multitenant === this.entity.context.multitenant &&
      TenantBoundary.of(input.entity.context).key === TenantBoundary.of(this.entity.context).key
    );
  }
}
function sameEntity(left: EntityRecord | undefined, right: EntityRecord | undefined): boolean {
  return left === undefined || right === undefined
    ? left === right
    : Buffer.compare(toBinary(EntityRecordSchema, left), toBinary(EntityRecordSchema, right)) === 0;
}
