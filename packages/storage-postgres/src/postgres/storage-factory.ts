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

import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { StringifierRegistry } from "@spine-event-engine/core";
import type { TenantId } from "@spine-event-engine/proto";
import {
  StorageFactory,
  type RecordSpec,
  type RecordStorage,
  type StorageContext,
  type StorageGroup,
} from "@spine-event-engine/storage";
import {
  TenantBoundary,
  TenantCatalogReads,
  type TenantCatalog,
  type TenantCatalogCursor,
  type TenantCatalogRead,
  type TenantCatalogPage,
} from "@spine-event-engine/storage/provider";
import {
  AgentExecutionRecords,
  AgentHistoryRecords,
  AgentModelPreferences,
  type AgentExecutionStorageInput,
} from "@spine-event-engine/storage/provider";
import {
  EntityCommitStorageFactories,
  AgentHistoryStorageFactories,
  AgentExecutionStorageFactories,
  StoragePreparations,
  stateHistorySpec,
  eventHistorySpec,
  type EntityStoragePreparationInput,
  type StoragePreparationMode,
} from "@spine-event-engine/storage/provider";
import type { AgentHistoryStorageInput } from "@spine-event-engine/storage/provider";
import { Pool, type PoolConfig, type PoolClient } from "pg";

import {
  PostgresStorageConfigurationError,
  PostgresStorageConnectionError,
  PostgresStorageSchemaError,
} from "./errors.js";
import {
  PostgresRecordStorage,
  type OnPublicOperation,
  type PostgresRecordLifecycle,
} from "./record-storage.js";
import { PostgresEntityStorage } from "./entity-history.js";
import { PostgresAgentHistory, AgentHistoryHash, PostgresAgentIndexes } from "./agent-history.js";
import { PostgresAgentExecution } from "./agent-execution.js";
import { PostgresEntityCommitStorage } from "./entity-commit.js";
import { PostgresTableResolver } from "./table-resolver.js";
import { PostgresTableSpecs } from "./table-spec.js";
import { PostgresTableInitializer } from "./table-initializer.js";
import type { PostgresDdlType } from "./data-type.js";

/**
 * Configures a PostgreSQL storage connection pool.
 */
export interface PostgresStorageFactoryOptions {
  // prettier-ignore

  /**
   * Specifies the PostgreSQL URL, including its database name.
   */
  readonly url: string;

  /**
   * Selects the PostgreSQL schema for Spine-managed tables.
   */
  readonly schema?: string;

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
 * Assigns one complete generated tenant to one PostgreSQL database.
 */
export interface PostgresTenantStorageOptions {
  // prettier-ignore

  /**
   * Identifies the tenant for the database.
   */
  readonly tenantId: TenantId;

  /**
   * Configures the tenant's PostgreSQL database and pool.
   */
  readonly options: PostgresStorageFactoryOptions;
}

/**
 * Resolves connection options for one complete generated tenant.
 *
 * @param tenantId The complete generated tenant identifier.
 * @returns Configured options or their asynchronous result.
 */
export type PostgresTenantResolver = (
  tenantId: TenantId,
) => PostgresStorageFactoryOptions | Promise<PostgresStorageFactoryOptions>;

/**
 * Describes one resolved PostgreSQL record-family table.
 *
 * @typeParam I The storage identifier type.
 * @typeParam R The stored Protobuf record type.
 */
export interface PostgresTableSpec<I, R extends Message> {
  // prettier-ignore

  /**
   * Names the resolved PostgreSQL schema.
   *
   * Custom DDL must safely quote this identifier and {@link tableName}, and
   * remain idempotent because initialization can run repeatedly.
   */
  readonly schema: string;

  /**
   * Names the physical table.
   */
  readonly tableName: string;

  /**
   * Identifies the record source Protobuf type.
   */
  readonly sourceType: GenMessage<Message>;

  /**
   * Identifies the stored record Protobuf type.
   */
  readonly recordType: GenMessage<R>;

  /**
   * Identifies the storage ID type.
   */
  readonly idType: I extends Message ? GenMessage<I> : string;

  /**
   * Names the optional storage group.
   */
  readonly groupName?: string;

  /**
   * Lists canonical table columns.
   */
  readonly columns: readonly PostgresColumnSpec[];

  /**
   * Lists primary-key column names in order.
   */
  readonly primaryKey: readonly string[];
}

/**
 * Describes one public PostgreSQL column in a resolved record-family table.
 */
export interface PostgresColumnSpec {
  // prettier-ignore

  /**
   * Names the physical column.
   */
  readonly name: string;

  /**
   * Specifies the canonical native PostgreSQL type.
   */
  readonly postgresType: PostgresDdlType;

  /**
   * Controls whether the column accepts null values.
   */
  readonly nullable: boolean;

  /**
   * Supplies an optional canonical SQL default expression.
   */
  readonly defaultSql?: string;
}

/**
 * Describes SQL that creates one resolved PostgreSQL record-family table.
 */
export interface PostgresCreateOperation {
  // prettier-ignore

  /**
   * Contains the create-table SQL statement.
   */
  readonly sql: string;
}

/**
 * Creates a create-table operation for one resolved record family.
 *
 * @typeParam I The storage identifier type.
 * @typeParam R The stored Protobuf record type.
 * @param table Describes the resolved table layout.
 * @returns The create-table operation.
 */
export type PostgresCreateOperationFactory = <I, R extends Message>(
  table: PostgresTableSpec<I, R>,
) => PostgresCreateOperation;

/**
 * Configures and builds a PostgreSQL storage factory.
 */
export interface PostgresStorageFactoryBuilder {
  // prettier-ignore

  /**
   * Sets the PostgreSQL connection options.
   *
   * @param options Specifies the PostgreSQL connection options.
   * @returns This builder.
   */
  setOptions(options: PostgresStorageFactoryOptions): this;

  /**
   * Sets the complete multitenant database registry.
   *
   * @param entries Assign generated tenants to distinct physical databases.
   * @returns This builder.
   */
  setTenantOptions(entries: readonly PostgresTenantStorageOptions[]): this;

  /**
   * Sets an application directory for tenant database settings.
   *
   * @param resolver Resolves one complete tenant identifier.
   * @returns This builder.
   */
  setTenantResolver(resolver: PostgresTenantResolver): this;

  /**
   * Sets custom reversible message stringifiers used by IDs and columns.
   *
   * @param registry The schema-bound stringifier registry.
   * @returns This builder.
   */
  setStringifierRegistry(registry: StringifierRegistry): this;

  /**
   * Sets the ungrouped table name for a record-family source type.
   *
   * @typeParam S The source Protobuf message type.
   * @param sourceType Identifies the ungrouped family source Protobuf type.
   * @param name Specifies the physical table name.
   * @returns This builder.
   */
  setTableName<S extends Message>(sourceType: GenMessage<S>, name: string): this;

  /**
   * Sets the grouped table name for a source and record type.
   *
   * @typeParam S The source Protobuf message type.
   * @typeParam R The record Protobuf message type.
   * @param sourceType Identifies the source Protobuf type.
   * @param recordType Identifies the record Protobuf type.
   * @param name Specifies the physical table name.
   * @returns This builder.
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
   * @returns This builder.
   */
  useOperationFactory(factory: PostgresCreateOperationFactory): this;

  /**
   * Builds a PostgreSQL storage factory.
   *
   * @returns A logical factory without a connection or schema probe.
   */
  build(): Promise<PostgresStorageFactory>;
}

/**
 * Provides the PostgreSQL storage-factory public contract.
 */
export class PostgresStorageFactory extends StorageFactory {
  readonly #handles = new Set<{ close(): void }>();

  readonly #commits = new Set<PostgresEntityCommitStorage<unknown, Message>>();

  readonly #databases = new Map<string | symbol, PostgresDatabase>();

  readonly #pending = new Map<string | symbol, Promise<PostgresDatabase>>();

  readonly #work = new Set<Promise<unknown>>();

  readonly #configs: ReadonlyMap<string | symbol, PostgresDatabaseConfig>;

  readonly #families = new Map<string, string | symbol>();

  readonly #tenantTargets = new Map<string, string | symbol>();

  readonly #tables = new Map<string | symbol, Map<string, PostgresPreparedTable>>();

  readonly #audits = new Map<string | symbol, Map<string, PostgresPreparedAudit>>();

  readonly #bindings = new Map<string | symbol, PostgresBoundDatabase>();

  readonly #bindingPending = new Map<string | symbol, Promise<PostgresBoundDatabase>>();

  #sharedCheck: Promise<void> | undefined;

  readonly #catalog: TenantCatalog;

  /**
   * Whether this record family is closed.
   */
  #closed: Promise<void> | undefined;

  /**
   * Creates a logical factory from locally validated settings.
   *
   * @param configs Supply the configured database settings.
   * @param tenantResolver Optionally resolves additional tenant settings.
   * @param resolver Resolves record families to physical table names.
   * @param operation Optionally creates custom table SQL.
   * @param stringifiers Convert message IDs and columns reversibly.
   */
  private constructor(
    configs: readonly PostgresDatabaseConfig[],
    private readonly tenantResolver: PostgresTenantResolver | undefined,
    private readonly resolver: PostgresTableResolver,
    private readonly operation: PostgresCreateOperationFactory | undefined,
    private readonly stringifiers: StringifierRegistry,
  ) {
    super();
    this.#configs = new Map(configs.map((config) => [config.boundary.key, config]));
    for (const config of configs)
      if (!config.boundary.single) this.#tenantTargets.set(config.target, config.boundary.key);
    const tenants = configs.filter(({ boundary }) => !boundary.single);
    this.#catalog = new PostgresTenantCatalog(tenants.map(({ boundary }) => boundary));
    this.registerPorts();
  }

  /**
   * Registers the built-in Entity and Agent provider ports.
   */
  private registerPorts(): void {
    StoragePreparations.register(this, {
      prepareRecord: (context, spec, group, mode) => this.prepareRecord(context, spec, group, mode),
      prepareEntity: (input, mode) => this.prepareEntity(input, mode),
      prepareAgentHistory: (input, mode) => this.prepareAgentHistory(input, mode),
      prepareAgentCommit: (input, mode) => this.prepareAgentCommit(input, mode),
    });
    EntityCommitStorageFactories.register(this, {
      createEntityCommitStorage: (input) => this.createEntityCommitStorage(input),
    });
    AgentHistoryStorageFactories.register(this, {
      createAgentHistoryStorage: (input) => {
        if (!this.isOpen()) throw new Error("StorageFactory is closed.");
        const spec = AgentHistoryRecords.spec((value) => AgentHistoryHash.value(value));
        return new PostgresAgentHistory(
          input,
          this.createPostgresRecordStorage(input.context, spec, AgentHistoryRecords.group),
          (work) => this.admitPublic(work),
          (mode) => this.prepareAudit(input.context, spec, mode),
        );
      },
    });
    AgentExecutionStorageFactories.register(this, {
      createAgentExecutionStorage: (input) => this.createAgentExecutionStorage(input),
    });
  }

  /**
   * Admits declarative preparation of one ordinary record family.
   * @typeParam I Record identifier type.
   * @typeParam R Stored record type.
   * @param context Captured storage boundary.
   * @param spec The physical record definition.
   * @param group Optional physical group.
   * @param mode Creation or read-only checking.
   * @returns Completion after compatible preparation.
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
   * Prepares a record family within an existing admission.
   * @typeParam I Record identifier type.
   * @typeParam R Stored record type.
   * @param context Captured storage boundary.
   * @param spec The physical record definition.
   * @param group Optional physical group.
   * @param mode Creation or read-only checking.
   * @returns Completion after compatible preparation.
   */
  private async prepareRecordAdmitted<I, R extends Message>(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    group: StorageGroup | undefined,
    mode: StoragePreparationMode,
  ): Promise<void> {
    const boundary = this.database(context);
    const name = this.resolver.resolve(
      spec.sourceType.typeName,
      group?.name,
      undefined,
      spec.recordType.typeName,
    ).tableName;
    const binding = await this.resolveBinding(boundary);
    const table = this.tableSpec(boundary, name, binding.schema, spec, group);
    const create = this.operation;
    await this.prepareTable(
      boundary,
      table as never,
      mode,
      create === undefined ? undefined : () => create(table).sql,
    );
  }

  /**
   * Prepares current Entity and enabled history families from declarations.
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input The declarative Entity requirements.
   * @param mode Creation or read-only checking.
   * @returns Completion after all requested families are compatible.
   */
  private prepareEntity<I, S extends Message>(
    input: EntityStoragePreparationInput<I, S>,
    mode: StoragePreparationMode,
  ): Promise<void> {
    return this.admitPublic(async () => {
      if (!this.sameEntityColumns(input))
        throw new PostgresStorageConfigurationError(
          "Entity query columns differ from current records.",
        );
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
   * Compares actual current Entity columns with declared query columns.
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input The declarative Entity requirements.
   * @returns Whether physical column declarations agree.
   */
  private sameEntityColumns<I, S extends Message>(
    input: EntityStoragePreparationInput<I, S>,
  ): boolean {
    const signature = (columns: typeof input.columns) =>
      JSON.stringify(
        columns
          .map((column) => [column.name, PostgresTableSpecs.postgresColumnType(column.type)])
          .sort(([a], [b]) => String(a).localeCompare(String(b))),
      );
    return signature(input.columns) === signature(input.recordSpec.columns);
  }

  /**
   * Prepares the mandatory Agent audit record family and indexes.
   * @typeParam I Agent identifier type.
   * @param input Agent state type and complete tenant scope.
   * @param mode Creation or read-only checking.
   * @returns Completion after table and index compatibility.
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
      await this.prepareAudit(input.context, spec, mode);
    });
  }

  /**
   * Prepares all live Agent state, audit, and preference requirements without a handle.
   * @param input Declarative Agent Entity layout.
   * @param mode Creation or read-only compatibility check.
   * @returns Completion after native table and audit-index checks.
   * @typeParam I Typed Agent identifier.
   * @typeParam S Generated Agent state.
   */
  private prepareAgentCommit<I, S extends Message>(
    input: EntityStoragePreparationInput<I, S>,
    mode: StoragePreparationMode,
  ): Promise<void> {
    return this.admitPublic(async () => {
      if (!this.sameEntityColumns(input))
        throw new PostgresStorageConfigurationError(
          "Entity query columns differ from current records.",
        );
      await this.prepareRecordAdmitted(input.context, input.recordSpec, undefined, mode);
      if (input.stateHistory) {
        const layout = stateHistorySpec(input.stateSchema);
        await this.prepareRecordAdmitted(input.context, layout.spec, layout.group, mode);
      }
      if (input.eventHistory) {
        const layout = eventHistorySpec(input.stateSchema);
        await this.prepareRecordAdmitted(input.context, layout.spec, layout.group, mode);
      }
      const audit = AgentHistoryRecords.spec((value) => AgentHistoryHash.value(value));
      await this.prepareRecordAdmitted(input.context, audit, AgentHistoryRecords.group, mode);
      await this.prepareAudit(input.context, audit, mode);
      await this.prepareRecordAdmitted(
        input.context,
        AgentModelPreferences.spec((value) => AgentHistoryHash.value(value)),
        AgentModelPreferences.group,
        mode,
      );
    });
  }

  /**
   * Prepares the three fixed Agent audit indexes for one physical table.
   *
   * @typeParam I Agent identifier type.
   * @typeParam R Audit record type.
   * @param context Captured Agent tenant scope.
   * @param spec Audit record declaration.
   * @param mode Creation or read-only check.
   * @returns Completion after all indexes match.
   */
  private async prepareAudit<I, R extends Message>(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    mode: StoragePreparationMode,
  ): Promise<void> {
    const boundary = this.database(context);
    const binding = await this.resolveBinding(boundary);
    const name = this.resolver.resolve(
      spec.sourceType.typeName,
      AgentHistoryRecords.group.name,
      undefined,
      spec.recordType.typeName,
    ).tableName;
    const key = `${binding.schema}\0${name}`;
    const entries = this.#audits.get(boundary.key) ?? new Map<string, PostgresPreparedAudit>();
    this.#audits.set(boundary.key, entries);
    const current = entries.get(key);
    if (current?.ready) return;
    if (current?.pending !== undefined) return current.pending;
    return this.startAudit(entries, key, boundary, binding, name, mode);
  }

  /**
   * Starts one Agent index attempt and removes failed evidence for retry.
   *
   * @param entries Audit readiness for the captured boundary.
   * @param key Physical audit table identity.
   * @param boundary Captured Agent tenant scope.
   * @param binding Resolved destination.
   * @param name Physical audit table name.
   * @param mode Creation or read-only check.
   * @returns Completion after index compatibility.
   */
  private startAudit(
    entries: Map<string, PostgresPreparedAudit>,
    key: string,
    boundary: TenantBoundary,
    binding: PostgresBoundDatabase,
    name: string,
    mode: StoragePreparationMode,
  ): Promise<void> {
    const entry: PostgresPreparedAudit = { ready: false, pending: undefined };
    entries.set(key, entry);
    entry.pending = this.attemptAudit(boundary, binding, name, mode)
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
   * Verifies or creates the Agent audit indexes with a released temporary pool when needed.
   *
   * @param boundary Captured Agent tenant scope.
   * @param binding Resolved destination and schema.
   * @param table Physical audit table name.
   * @param mode Creation or read-only check.
   * @returns Completion including temporary pool cleanup.
   */
  private async attemptAudit(
    boundary: TenantBoundary,
    binding: PostgresBoundDatabase,
    table: string,
    mode: StoragePreparationMode,
  ): Promise<void> {
    const runtime = this.#databases.get(boundary.key);
    const pool = runtime?.pool ?? new Pool(binding.config.poolOptions);
    const qualified = `"${binding.schema.replaceAll('"', '""')}"."${table.replaceAll('"', '""')}"`;
    let failure: Error | undefined;
    try {
      const client = await pool.connect();
      try {
        await PostgresAgentIndexes.prepare(client, qualified, mode);
      } finally {
        client.release();
      }
    } catch (error) {
      failure =
        error instanceof Error
          ? error
          : new Error("Agent index preparation failed.", { cause: error });
    }
    if (runtime === undefined) await this.closeCheckedPool(pool, failure);
    else if (failure !== undefined) throw failure;
  }

  /**
   * Opens native record families for one typed Agent repository.
   *
   * @param input Tenant scope, typed ID and generated state layout.
   * @returns Closeable Agent execution storage handle.
   * @typeParam I Typed Agent identifier.
   * @typeParam S Generated Agent state.
   */
  private createAgentExecutionStorage<I, S extends Message>(
    input: AgentExecutionStorageInput<I, S>,
  ): PostgresAgentExecution<I, S> {
    if (!this.isOpen()) throw new Error("StorageFactory is closed.");
    const context = input.entity.context;
    const digest = (value: string) => AgentHistoryHash.value(value);
    return new PostgresAgentExecution(
      input,
      this.createPostgresRecordStorage(
        context,
        AgentExecutionRecords.invocationSpec(digest),
        AgentExecutionRecords.invocationGroup,
      ),
      this.createPostgresRecordStorage(
        context,
        AgentExecutionRecords.headSpec(digest),
        AgentExecutionRecords.headGroup,
      ),
      this.createPostgresRecordStorage(
        context,
        AgentHistoryRecords.spec(digest),
        AgentHistoryRecords.group,
      ),
      this.createPostgresRecordStorage(context, input.entity.recordSpec),
      () => this.createEntityCommitStorage(input.entity, true),
      (work) => this.admitPublic(work),
    );
  }

  /**
   * Creates a PostgreSQL storage factory builder.
   *
   * @returns A new builder.
   */
  static newBuilder(): PostgresStorageFactoryBuilder {
    return new Builder(
      (entries, tenantResolver, resolver, operation, stringifiers) =>
        new PostgresStorageFactory(entries, tenantResolver, resolver, operation, stringifiers),
    );
  }

  /**
   * Returns the configured provider tenant catalog.
   *
   * @returns The configured tenant catalog.
   */
  tenantCatalog(): TenantCatalog {
    return this.#catalog;
  }

  /**
   * Checks the shared destination without creating tables or retaining a pool.
   *
   * @returns Completion after a read-only schema check.
   */
  override checkConnection(): Promise<void> {
    if (!this.isOpen()) return Promise.reject(new Error("StorageFactory is closed."));
    if (this.#sharedCheck !== undefined) return this.#sharedCheck;
    const shared = this.#configs.get(TenantBoundary.single.key);
    if (shared === undefined)
      return Promise.reject(new Error("Shared PostgreSQL options are missing."));
    this.#sharedCheck = Promise.resolve()
      .then(() => this.checkShared(shared))
      .catch((error: unknown) => {
        this.#sharedCheck = undefined;
        throw error;
      });
    return this.#sharedCheck;
  }

  /**
   * Checks the shared schema using an existing or temporary pool.
   *
   * @param config The shared connection settings.
   * @returns Completion after the read-only probe.
   */
  private async checkShared(config: PostgresDatabaseConfig): Promise<void> {
    const existing = this.#databases.get(config.boundary.key);
    const pool = existing?.pool ?? new Pool(config.poolOptions);
    let failure: Error | undefined;
    try {
      const client = await pool.connect();
      try {
        await PostgresSchemas.resolve(client, config.schema);
      } finally {
        client.release();
      }
    } catch (error) {
      failure =
        error instanceof PostgresStorageConfigurationError
          ? error
          : new PostgresStorageConnectionError("Unable to connect to PostgreSQL.", {
              cause: error,
            });
    }
    if (existing !== undefined) {
      if (failure !== undefined) throw failure;
      return;
    }
    await this.closeCheckedPool(pool, failure);
  }

  /**
   * Closes a temporary check pool without replacing a failed probe.
   *
   * @param pool The temporary pool to dispose.
   * @param failure The classified probe failure, if any.
   * @returns Completion after disposal or a preserved failure.
   */
  private async closeCheckedPool(pool: Pool, failure: Error | undefined): Promise<void> {
    try {
      await pool.end();
    } catch (error) {
      const cleanup = new PostgresStorageConnectionError("Unable to close PostgreSQL check pool.", {
        cause: error,
      });
      if (failure !== undefined)
        throw new AggregateError(
          [failure, cleanup],
          "PostgreSQL connection check and cleanup failed.",
        );
      throw cleanup;
    }
    if (failure !== undefined) throw failure;
  }

  /**
   * Closes the factory and begins idempotent PostgreSQL pool draining.
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
   * Creates a record-storage handle for the selected PostgreSQL tenant.
   *
   * @typeParam I The storage identifier type.
   * @typeParam R The stored Protobuf record type.
   * @param context Identifies the requested storage boundary.
   * @param recordSpec Describes the requested record family.
   * @param group Separates records that share a source type.
   * @returns A live handle bound to the resolved tenant table.
   */
  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): RecordStorage<I, R> {
    return this.createPostgresRecordStorage(context, recordSpec, group, true, true);
  }

  /**
   * Creates one PostgreSQL record handle and tracks it until closure.
   *
   * @typeParam I The storage identifier type.
   * @typeParam R The stored Protobuf record type.
   * @param context Identifies the storage boundary.
   * @param recordSpec Describes the record family.
   * @param group Optionally separates records sharing a source type.
   * @returns The live PostgreSQL record handle.
   * @param tracked Whether the factory tracks this public handle.
   * @param publicHandle Whether factory closure fences new work on this handle.
   */
  private createPostgresRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    group?: StorageGroup,
    tracked = true,
    publicHandle = false,
  ): PostgresRecordStorage<I, R> {
    const boundary = this.database(context);
    const table = this.resolver.resolve(
      recordSpec.sourceType.typeName,
      group?.name,
      undefined,
      recordSpec.recordType.typeName,
    );
    const operation = this.operation;
    const handle = new PostgresRecordStorage(
      context,
      recordSpec,
      table.tableName,
      (schema) => this.tableSpec(boundary, table.tableName, schema, recordSpec, group),
      this.connections(boundary, publicHandle),
      () => this.#handles.delete(handle),
      operation === undefined ? undefined : (resolved) => operation(resolved).sql,
      this.stringifiers,
    );
    if (tracked) this.#handles.add(handle);
    return handle;
  }

  /**
   * Builds a schema-bound layout after checking physical scope separation.
   *
   * @typeParam I The record ID type.
   * @typeParam R The stored record type.
   * @param boundary The captured tenant scope.
   * @param tableName The locally selected table name.
   * @param schema The server-selected schema.
   * @param recordSpec The declared record family.
   * @param group The optional group.
   * @returns The resolved physical layout.
   */
  private tableSpec<I, R extends Message>(
    boundary: TenantBoundary,
    tableName: string,
    schema: string,
    recordSpec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): PostgresTableSpec<I, R> {
    const table = PostgresTableSpecs.resolvedPostgresTableSpec({
      schema,
      tableName,
      sourceType: recordSpec.sourceType,
      recordType: recordSpec.recordType,
      idType: recordSpec.idType,
      ...(group === undefined ? {} : { groupName: group.name }),
      declaredColumns: recordSpec.columns,
    });
    this.assertFamily(boundary, tableName, schema);
    return table;
  }

  /**
   * Creates the internal Entity-current and history storage seam.
   *
   * @typeParam I The Entity identifier type.
   * @typeParam S The Entity state message type.
   * @param input Supplies the Entity storage configuration.
   * @returns A factory-managed PostgreSQL Entity handle.
   */
  private createEntityStorage<I, S extends Message>(
    input: import("@spine-event-engine/storage/provider").EntityStorageInput<I, S>,
  ): PostgresEntityStorage<I, S> {
    if (!this.isOpen()) throw new Error("StorageFactory is closed.");
    const registration = {} as { handle: PostgresEntityStorage<I, S> };
    const handle = new PostgresEntityStorage(
      input,
      this.createPostgresRecordStorage(input.context, input.recordSpec),
      (spec, group) => this.createPostgresRecordStorage(input.context, spec, group),
      () => this.#handles.delete(registration.handle),
      (work) => this.admitPublic(work),
    );
    registration.handle = handle;
    this.#handles.add(handle);
    return handle;
  }

  /**
   * Creates independent ordered Entity persistence for current state and history.
   *
   * @typeParam I The Entity identifier type.
   * @typeParam S The Entity state message type.
   * @param input Supplies the Entity storage configuration.
   * @param admitted Allows a previously admitted Agent operation to open its private commit port.
   * @returns A factory-managed Entity commit handle.
   */
  private createEntityCommitStorage<I, S extends Message>(
    input: import("@spine-event-engine/storage/provider").EntityStorageInput<I, S>,
    admitted = false,
  ): PostgresEntityCommitStorage<I, S> {
    if (!admitted && !this.isOpen()) throw new Error("StorageFactory is closed.");
    const registration = {} as { handle: PostgresEntityCommitStorage<I, S> };
    const handle = new PostgresEntityCommitStorage(
      input,
      (spec, group) => this.createPostgresRecordStorage(input.context, spec, group, false),
      () =>
        this.#commits.delete(registration.handle as PostgresEntityCommitStorage<unknown, Message>),
    );
    registration.handle = handle;
    if (!admitted) this.#commits.add(handle as PostgresEntityCommitStorage<unknown, Message>);
    return handle;
  }

  /**
   * Closes live handles, the tenant catalog, and all pools.
   *
   * @returns A promise that resolves after every pool closes.
   * @param commits The admitted commit completions.
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
    if (errors.length) throw new AggregateError(errors, "PostgreSQL factory close failed.");
  }

  /**
   * Opens one pool and proves its selected schema is usable.
   *
   * @param entry Supplies one database configuration.
   * @returns The connected database resource.
   */
  private static async prove(entry: PostgresDatabaseConfig): Promise<PostgresDatabase> {
    const pool = new Pool(entry.poolOptions);
    try {
      const client = await pool.connect();
      try {
        const schema = await PostgresSchemas.resolve(client, entry.schema);
        return {
          boundary: entry.boundary,
          pool,
          schema,
          target: entry.target,
          databaseName: entry.databaseName,
          config: entry,
        };
      } finally {
        client.release();
      }
    } catch (error) {
      await pool.end().catch(() => undefined);
      throw error;
    }
  }

  /**
   * Captures a configured or resolvable tenant boundary.
   *
   * @param context Identifies the tenant boundary.
   * @returns The validated boundary.
   */
  private database(context: StorageContext): TenantBoundary {
    const boundary = TenantBoundary.of(context);
    if (this.#configs.has(boundary.key) || (!boundary.single && this.tenantResolver !== undefined))
      return boundary;
    throw new PostgresStorageConfigurationError(
      boundary.single
        ? "PostgreSQL storage is configured for multiple tenants."
        : "PostgreSQL storage has no configured database for the requested tenant.",
    );
  }

  /**
   * Exposes record-lifecycle operations for one database resource.
   *
   * @param boundary Identifies the captured tenant scope.
   * @param publicHandle Whether the factory fence rejects new record calls.
   * @returns Its package-local record lifecycle.
   */
  private connections(boundary: TenantBoundary, publicHandle: boolean): PostgresRecordLifecycle {
    const database = (): PostgresDatabase => {
      const resolved = this.#databases.get(boundary.key);
      if (resolved === undefined) throw new Error("PostgreSQL database is not bound.");
      return resolved;
    };
    return {
      resolve: () => this.resolveDatabase(boundary).then(() => undefined),
      track: (work) => this.track(work),
      prepare: (table, customCreate) => this.prepareTable(boundary, table, "create", customCreate),
      publicOpen: () => !publicHandle || this.isOpen(),
      get databaseName() {
        return database().databaseName;
      },
      get schema() {
        return database().schema;
      },
      acquire: () => database().pool.connect(),
    };
  }

  /**
   * Records an admitted provider operation until it settles.
   *
   * @typeParam T The operation result.
   * @param work The admitted promise.
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
   * Prepares one canonical physical table requirement across handles and explicit preparation.
   *
   * @param boundary Captured storage boundary.
   * @param table Canonical physical table layout.
   * @param mode Creation or read-only compatibility checking.
   * @param customCreate Optional custom create SQL producer.
   * @returns Completion after compatible physical readiness.
   */
  private prepareTable(
    boundary: TenantBoundary,
    table: PostgresTableSpec<unknown, never>,
    mode: StoragePreparationMode,
    customCreate?: () => string,
  ): Promise<void> {
    const tables = this.#tables.get(boundary.key) ?? new Map<string, PostgresPreparedTable>();
    this.#tables.set(boundary.key, tables);
    const key = `${table.schema}\0${table.tableName}`;
    const signature = this.tableSignature(table);
    const current = tables.get(key);
    if (current !== undefined && current.signature !== signature)
      return Promise.reject(
        new PostgresStorageSchemaError("PostgreSQL table definition conflicts."),
      );
    if (current?.ready) return Promise.resolve();
    if (current?.pending !== undefined) return current.pending;
    return this.startTable(tables, key, signature, boundary, table, mode, customCreate);
  }

  /**
   * Starts one table attempt and removes failed evidence for retry.
   *
   * @param tables Readiness for the captured boundary.
   * @param key Physical table identity.
   * @param signature Canonical layout signature.
   * @param boundary Captured storage boundary.
   * @param table Canonical physical layout.
   * @param mode Creation or read-only check.
   * @param customCreate Optional create SQL producer.
   * @returns Completion after table compatibility.
   */
  private startTable(
    tables: Map<string, PostgresPreparedTable>,
    key: string,
    signature: string,
    boundary: TenantBoundary,
    table: PostgresTableSpec<unknown, never>,
    mode: StoragePreparationMode,
    customCreate?: () => string,
  ): Promise<void> {
    const entry: PostgresPreparedTable = { signature, ready: false, pending: undefined };
    tables.set(key, entry);
    const attempt = Promise.resolve().then(() =>
      this.attemptTable(boundary, table, mode, customCreate),
    );
    entry.pending = attempt
      .then(
        () => {
          entry.ready = true;
        },
        (error: unknown) => {
          tables.delete(key);
          throw error;
        },
      )
      .finally(() => {
        entry.pending = undefined;
      });
    return entry.pending;
  }

  /**
   * Captures the exact structural declarations for one physical table.
   * @param table Canonical physical table layout.
   * @returns Stable structural signature independent of column input order.
   */
  private tableSignature(table: PostgresTableSpec<unknown, never>): string {
    const idType = table.idType as string | GenMessage<Message>;
    return JSON.stringify([
      table.sourceType.typeName,
      table.recordType.typeName,
      typeof idType === "string" ? idType : idType.typeName,
      table.groupName ?? null,
      table.primaryKey,
      [...table.columns]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((column) => [
          column.name,
          column.postgresType,
          column.nullable,
          column.defaultSql ?? null,
        ]),
    ]);
  }

  /**
   * Prepares one physical table requirement with a released temporary or retained runtime pool.
   *
   * @param boundary Captured storage boundary.
   * @param table Canonical physical table layout.
   * @param mode Creation or read-only compatibility checking.
   * @param customCreate Optional custom create SQL producer.
   * @returns Completion after physical compatibility and cleanup.
   */
  private async attemptTable(
    boundary: TenantBoundary,
    table: PostgresTableSpec<unknown, never>,
    mode: StoragePreparationMode,
    customCreate?: () => string,
  ): Promise<void> {
    const runtime = this.#databases.get(boundary.key);
    const bound = this.#bindings.get(boundary.key);
    if (bound === undefined) throw new Error("PostgreSQL database is not bound.");
    const pool = runtime?.pool ?? new Pool(bound.config.poolOptions);
    let failure: Error | undefined;
    try {
      await new PostgresTableInitializer(
        { acquire: () => pool.connect(), lockIdentity: bound.config.target },
        table.schema,
        table,
        customCreate,
      ).prepare(mode);
    } catch (error) {
      failure =
        error instanceof Error
          ? error
          : new Error("PostgreSQL preparation failed.", { cause: error });
    }
    if (runtime === undefined) await this.closeCheckedPool(pool, failure);
    else if (failure !== undefined) throw failure;
  }

  /**
   * Admits a complete public wrapper operation before invoking application callbacks.
   *
   * @typeParam T The operation result.
   * @param work The public operation to run.
   * @returns The complete admitted outcome.
   */
  private admitPublic: OnPublicOperation = <T>(work: () => Promise<T>): Promise<T> => {
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
   * Resolves one physical destination once, retrying failed attempts.
   *
   * @param boundary The captured tenant scope.
   * @returns The retained database resource.
   */
  private resolveDatabase(boundary: TenantBoundary): Promise<PostgresDatabase> {
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
   * Resolves a destination for explicit preparation without retaining a pool.
   * @param boundary Captured storage boundary.
   * @returns Proven connection settings and server-selected schema.
   */
  private resolveBinding(boundary: TenantBoundary): Promise<PostgresBoundDatabase> {
    const runtime = this.#databases.get(boundary.key);
    if (runtime !== undefined)
      return Promise.resolve({ config: runtime.config, schema: runtime.schema });
    const bound = this.#bindings.get(boundary.key);
    if (bound !== undefined) return Promise.resolve(bound);
    const runtimePending = this.#pending.get(boundary.key);
    if (runtimePending !== undefined)
      return runtimePending.then((database) => ({
        config: database.config,
        schema: database.schema,
      }));
    const pending = this.#bindingPending.get(boundary.key);
    if (pending !== undefined) return pending;
    const attempt = this.bindTemporary(boundary)
      .then((result) => {
        this.#bindings.set(boundary.key, result);
        return result;
      })
      .finally(() => this.#bindingPending.delete(boundary.key));
    this.#bindingPending.set(boundary.key, attempt);
    return attempt;
  }

  /**
   * Checks one destination using a temporary pool and releases it on all paths.
   *
   * @param boundary Captured storage boundary.
   * @returns Stable connection settings and schema after cleanup succeeds.
   */
  private async bindTemporary(boundary: TenantBoundary): Promise<PostgresBoundDatabase> {
    const config = await this.configFor(boundary);
    const reserved = this.reserveTenantTarget(config);
    const pool = new Pool(config.poolOptions);
    let schema: string | undefined;
    let failure: Error | undefined;
    try {
      const client = await pool.connect();
      try {
        schema = await PostgresSchemas.resolve(client, config.schema);
      } finally {
        client.release();
      }
    } catch (error) {
      failure =
        error instanceof PostgresStorageConfigurationError
          ? error
          : new PostgresStorageConnectionError("Unable to connect to PostgreSQL.", {
              cause: error,
            });
    }
    try {
      await this.closeCheckedPool(pool, failure);
    } catch (error) {
      if (reserved) this.#tenantTargets.delete(config.target);
      throw error;
    }
    if (schema === undefined) throw new Error("PostgreSQL schema was not resolved.");
    return { config, schema };
  }

  /**
   * Resolves settings and proves the selected database without retaining failures.
   *
   * @param boundary The captured tenant scope.
   * @returns The connected database resource.
   */
  private async bindDatabase(boundary: TenantBoundary): Promise<PostgresDatabase> {
    const bound =
      this.#bindings.get(boundary.key) ?? (await this.#bindingPending.get(boundary.key));
    if (bound !== undefined)
      return {
        boundary,
        pool: new Pool(bound.config.poolOptions),
        schema: bound.schema,
        target: bound.config.target,
        databaseName: bound.config.databaseName,
        config: bound.config,
      };
    const config = await this.configFor(boundary);
    const reserved = this.reserveTenantTarget(config);
    try {
      const database = await PostgresStorageFactory.prove(config);
      this.#bindings.set(boundary.key, { config, schema: database.schema });
      return database;
    } catch (error) {
      if (reserved) this.#tenantTargets.delete(config.target);
      if (error instanceof PostgresStorageConfigurationError) throw error;
      throw new PostgresStorageConnectionError("Unable to connect to PostgreSQL.");
    }
  }

  /**
   * Reads configured or application-resolved settings for one captured tenant.
   * @param boundary Captured storage boundary.
   * @returns Validated database settings.
   */
  private async configFor(boundary: TenantBoundary): Promise<PostgresDatabaseConfig> {
    const fixed = this.#configs.get(boundary.key);
    if (fixed !== undefined) return fixed;
    if (boundary.tenantId === undefined || this.tenantResolver === undefined)
      throw new PostgresStorageConfigurationError("PostgreSQL tenant is not configured.");
    const options = await this.tenantResolver(boundary.tenantId);
    return PostgresConfigurations.parse(boundary, options);
  }

  /**
   * Records one physical tenant database before the first connection awaits.
   *
   * @param config The resolved tenant settings.
   * @returns Whether this attempt added the reservation.
   */
  private reserveTenantTarget(config: PostgresDatabaseConfig): boolean {
    if (config.boundary.single) return false;
    const prior = this.#tenantTargets.get(config.target);
    if (prior !== undefined && prior !== config.boundary.key)
      throw new PostgresStorageConfigurationError(
        "PostgreSQL tenants must use distinct physical databases.",
      );
    if (prior !== undefined) return false;
    this.#tenantTargets.set(config.target, config.boundary.key);
    return true;
  }

  /**
   * Rejects shared and tenant records mapped to one unpartitioned table.
   *
   * @param boundary The selected storage scope.
   * @param tableName The physical table name.
   * @param schema The resolved server schema.
   */
  private assertFamily(boundary: TenantBoundary, tableName: string, schema: string): void {
    const target =
      this.#databases.get(boundary.key)?.target ?? this.#bindings.get(boundary.key)?.config.target;
    if (target === undefined) throw new Error("PostgreSQL database is not bound.");
    const key = `${target}\0${schema}\0${tableName}`;
    const prior = this.#families.get(key);
    if (prior !== undefined && prior !== boundary.key)
      throw new PostgresStorageConfigurationError("Shared and tenant PostgreSQL tables collide.");
    this.#families.set(key, boundary.key);
  }
}

/**
 * Collects validated options before connecting a PostgreSQL storage factory.
 */
class Builder implements PostgresStorageFactoryBuilder {
  #options: PostgresStorageFactoryOptions | undefined;

  #tenantOptions: readonly PostgresTenantStorageOptions[] | undefined;

  #tenantResolver: PostgresTenantResolver | undefined;

  #operationFactory: PostgresCreateOperationFactory | undefined;

  #stringifiers = new StringifierRegistry();

  readonly #resolver = new PostgresTableResolver();

  /**
   * Sets the single-database connection options.
   *
   * @param options Specify the PostgreSQL connection.
   * @returns This builder.
   */
  setOptions(options: PostgresStorageFactoryOptions): this {
    this.#options = {
      ...options,
      ...(options.tls === undefined ? {} : { tls: { ...options.tls } }),
    };
    return this;
  }

  /**
   * Sets the complete tenant-to-database registry.
   *
   * @param entries Assign tenants to distinct databases.
   * @returns This builder.
   */
  setTenantOptions(entries: readonly PostgresTenantStorageOptions[]): this {
    this.#tenantOptions = entries.map(({ tenantId, options }) => ({
      tenantId,
      options: { ...options, ...(options.tls === undefined ? {} : { tls: { ...options.tls } }) },
    }));
    return this;
  }

  /**
   * Registers a tenant settings directory without querying it during build.
   *
   * @param resolver Resolves one generated tenant identifier.
   * @returns This builder.
   */
  setTenantResolver(resolver: PostgresTenantResolver): this {
    this.#tenantResolver = resolver;
    return this;
  }

  /**
   * Sets custom reversible message stringifiers.
   *
   * @param registry Supplies the schema-bound registry.
   * @returns This builder.
   */
  setStringifierRegistry(registry: StringifierRegistry): this {
    this.#stringifiers = new StringifierRegistry(registry);
    return this;
  }

  /**
   * Sets an ungrouped table name through this overload.
   *
   * @typeParam S The source Protobuf message type.
   * @param sourceType Identifies the record-family source.
   * @param name Specifies the physical table name.
   * @returns This builder.
   */
  setTableName<S extends Message>(sourceType: GenMessage<S>, name: string): this;

  /**
   * Sets a grouped table name through this overload.
   *
   * @typeParam S The source Protobuf message type.
   * @typeParam R The record Protobuf message type.
   * @param sourceType Identifies the source.
   * @param recordType Identifies the grouped record.
   * @param name Specifies the physical table name.
   * @returns This builder.
   */
  setTableName<S extends Message, R extends Message>(
    sourceType: GenMessage<S>,
    recordType: GenMessage<R>,
    name: string,
  ): this;

  /**
   * Applies either supported table-name overload.
   *
   * @param args Supply the overload arguments.
   * @returns This builder.
   */
  setTableName(...args: unknown[]): this {
    if (args.length === 2)
      this.#resolver.setRecordName((args[0] as GenMessage<Message>).typeName, args[1] as string);
    else
      this.#resolver.setGroupName(
        (args[0] as GenMessage<Message>).typeName,
        (args[1] as GenMessage<Message>).typeName,
        args[2] as string,
      );
    return this;
  }

  /**
   * Sets the custom create-table operation factory.
   *
   * @param factory Creates SQL for resolved table specifications.
   * @returns This builder.
   */
  useOperationFactory(factory: PostgresCreateOperationFactory): this {
    this.#operationFactory = factory;
    return this;
  }

  /**
   * Creates a builder with its local factory construction function.
   *
   * @param assemble Constructs a logical factory.
   */
  constructor(
    private readonly assemble: (
      entries: readonly PostgresDatabaseConfig[],
      tenantResolver: PostgresTenantResolver | undefined,
      resolver: PostgresTableResolver,
      operation: PostgresCreateOperationFactory | undefined,
      stringifiers: StringifierRegistry,
    ) => PostgresStorageFactory,
  ) {}

  /**
   * Validates static settings and assembles a logical factory.
   *
   * @returns The logical PostgreSQL storage factory without opening a connection.
   */
  build(): Promise<PostgresStorageFactory> {
    try {
      if (this.#options === undefined)
        throw new PostgresStorageConfigurationError("PostgreSQL storage options are required.");
      if (this.#tenantOptions !== undefined && this.#tenantResolver !== undefined)
        throw new PostgresStorageConfigurationError(
          "Configure either tenant options or a tenant resolver, not both.",
        );
      const entries = [
        PostgresConfigurations.single(this.#options),
        ...(this.#tenantOptions === undefined
          ? []
          : PostgresConfigurations.multitenant(this.#tenantOptions)),
      ];
      return Promise.resolve(
        this.assemble(
          entries,
          this.#tenantResolver,
          this.#resolver,
          this.#operationFactory,
          this.#stringifiers,
        ),
      );
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new PostgresStorageConfigurationError("PostgreSQL storage configuration is invalid."),
      );
    }
  }
}

/**
 * Holds one connected tenant database resource.
 */
interface PostgresDatabase {
  readonly boundary: TenantBoundary;
  readonly pool: Pool;
  readonly schema: string;
  readonly databaseName: string;
  readonly target: string;
  readonly config: PostgresDatabaseConfig;
}

/**
 * Remembers a proven destination without retaining its temporary pool.
 */
interface PostgresBoundDatabase {
  readonly config: PostgresDatabaseConfig;
  readonly schema: string;
}

/**
 * Records physical-family readiness for one canonical table definition.
 */
interface PostgresPreparedTable {
  readonly signature: string;
  ready: boolean;
  pending: Promise<void> | undefined;
}

/**
 * Remembers Agent audit index readiness without a variable layout signature.
 */
type PostgresPreparedAudit = Omit<PostgresPreparedTable, "signature">;

/**
 * Contains validated settings used to open one database pool.
 */
interface PostgresDatabaseConfig {
  readonly boundary: TenantBoundary;
  readonly poolOptions: PoolConfig;
  readonly schema: string | undefined;
  readonly target: string;
  readonly databaseName: string;
}

/**
 * Reports the immutable tenant boundaries configured by the factory.
 */
class PostgresTenantCatalog implements TenantCatalog {
  readonly #cursorIdentity = {};

  /**
   * Checks fixed configured membership without invoking a resolver.
   *
   * @param boundary Complete tenant boundary to inspect.
   * @returns Whether the boundary is explicitly configured.
   */
  contains(boundary: TenantBoundary): Promise<boolean> {
    return Promise.resolve(this.boundaries.some(({ key }) => key === boundary.key));
  }

  /**
   * Creates a catalog from configured tenant boundaries.
   *
   * @param boundaries Supply the enumerable configured boundaries.
   */
  constructor(private readonly boundaries: readonly TenantBoundary[]) {}

  /**
   * Returns every configured boundary.
   *
   * @returns The configured boundaries.
   */
  all(): Promise<readonly TenantBoundary[]> {
    return Promise.resolve(this.boundaries);
  }

  /**
   * Reads one finite page of configured tenants.
   *
   * @param request Bounded page and catalog continuation.
   * @returns A page without copying other configured boundaries.
   */
  page(request: TenantCatalogRead): Promise<TenantCatalogPage> {
    return Promise.resolve().then(() => {
      TenantCatalogReads.require(request);
      const after = request.after;
      if (after !== undefined && !(after instanceof PostgresTenantCursor))
        throw new TypeError("PostgreSQL tenant catalog continuation is invalid.");
      const cursor = after?.state(this.#cursorIdentity);
      const length = cursor?.length ?? this.boundaries.length;
      const start = cursor?.index ?? 0;
      const end = Math.min(length, start + request.count);
      const boundaries = this.boundaries.slice(start, end);
      request.signal.throwIfAborted();
      return {
        boundaries,
        ...(end < length
          ? { after: new PostgresTenantCursor(this.#cursorIdentity, end, length) }
          : {}),
        hasMore: end < length,
      };
    });
  }

  /**
   * Checks that a boundary belongs to this fixed catalog.
   *
   * @param boundary Supplies the boundary to confirm.
   * @returns A promise that resolves when the boundary is configured.
   */
  keep(boundary: TenantBoundary): Promise<void> {
    if (!this.boundaries.some(({ key }) => key === boundary.key)) {
      return Promise.reject(
        new PostgresStorageConfigurationError("PostgreSQL tenant is not configured."),
      );
    }
    return Promise.resolve();
  }

  /**
   * Closes the catalog, which holds no external resources.
   *
   * @returns An already resolved promise.
   */
  close(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Immutable continuation issued by one configured PostgreSQL catalog.
 */
class PostgresTenantCursor implements TenantCatalogCursor {
  readonly [Symbol.toStringTag] = "TenantCatalogCursor" as const;

  readonly #identity: object;

  readonly #index: number;

  readonly #length: number;

  /**
   * Captures one configured-boundary sweep position.
   *
   * @param identity Private catalog issuance identity.
   * @param index Next boundary position.
   * @param length Fixed boundary count for this sweep.
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
   * @returns Fixed boundary count and next position.
   */
  state(identity: object): { index: number; length: number } {
    if (this.#identity !== identity)
      throw new TypeError("PostgreSQL tenant catalog continuation is invalid.");
    return { index: this.#index, length: this.#length };
  }
}

/**
 * Validates public options and builds internal database configurations.
 */
const PostgresConfigurations = Object.freeze({
  /**
   * Builds the single-tenant database configuration.
   *
   * @param options Specify the database connection.
   * @returns The validated internal configuration.
   */
  single(options: PostgresStorageFactoryOptions): PostgresDatabaseConfig {
    return PostgresConfigurations.parse(TenantBoundary.single, options);
  },

  /**
   * Builds configurations for the complete tenant registry.
   *
   * @param entries Assign tenants to their databases.
   * @returns Validated internal configurations.
   */
  multitenant(entries: readonly PostgresTenantStorageOptions[]): readonly PostgresDatabaseConfig[] {
    if (entries.length === 0) {
      throw new PostgresStorageConfigurationError(
        "Multitenant PostgreSQL storage requires tenants.",
      );
    }
    const configured = entries.map(({ tenantId, options }) =>
      PostgresConfigurations.parse(TenantBoundary.from(tenantId), options),
    );
    PostgresConfigurations.assertDistinct(configured);
    return configured;
  },

  /**
   * Rejects duplicate tenants and shared physical database targets.
   *
   * @param entries Supply validated database configurations.
   */
  assertDistinct(entries: readonly PostgresDatabaseConfig[]): void {
    const tenants = new Set<string | symbol>();
    const targets = new Set<string>();
    for (const entry of entries) {
      if (tenants.has(entry.boundary.key)) {
        throw new PostgresStorageConfigurationError("PostgreSQL storage has a duplicate tenant.");
      }
      if (targets.has(entry.target)) {
        throw new PostgresStorageConfigurationError(
          "PostgreSQL tenants must use distinct physical databases.",
        );
      }
      tenants.add(entry.boundary.key);
      targets.add(entry.target);
    }
  },

  /**
   * Converts one public database configuration to pool settings.
   *
   * @param boundary Identifies the tenant boundary.
   * @param options Specify the database connection.
   * @returns The internal database configuration.
   */
  parse(boundary: TenantBoundary, options: PostgresStorageFactoryOptions): PostgresDatabaseConfig {
    const url = PostgresConfigurations.url(options.url);
    PostgresConfigurations.validate(options);
    const port = url.port === "" ? 5432 : Number(url.port);
    const database = decodeURIComponent(url.pathname.slice(1));
    return {
      boundary,
      schema: options.schema,
      target: `${url.hostname.toLowerCase()}:${String(port)}/${database.toLowerCase()}`,
      databaseName: database,
      poolOptions: {
        host: url.hostname,
        ...(url.port === "" ? {} : { port }),
        database,
        ...(url.username === "" ? {} : { user: decodeURIComponent(url.username) }),
        ...(url.password === "" ? {} : { password: decodeURIComponent(url.password) }),
        ...(options.connectionLimit === undefined ? {} : { max: options.connectionLimit }),
        ...(options.connectTimeoutMs === undefined
          ? {}
          : { connectionTimeoutMillis: options.connectTimeoutMs }),
        ...(options.tls === undefined ? {} : { ssl: options.tls }),
      },
    };
  },

  /**
   * Parses and validates a PostgreSQL database URL.
   *
   * @param value Supplies the configured URL.
   * @returns The parsed URL.
   */
  url(value: string): URL {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new PostgresStorageConfigurationError("PostgreSQL storage requires a valid URL.");
    }
    if (
      (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
      url.pathname.length <= 1 ||
      url.hash !== "" ||
      url.search !== ""
    ) {
      throw new PostgresStorageConfigurationError("PostgreSQL storage URL requires a database.");
    }
    return url;
  },

  /**
   * Validates scalar connection and schema options.
   *
   * @param options Supply the public configuration.
   */
  validate(options: PostgresStorageFactoryOptions): void {
    if (!PostgresConfigurations.positive(options.connectionLimit)) {
      throw new PostgresStorageConfigurationError("PostgreSQL connection limit is invalid.");
    }
    if (!PostgresConfigurations.positive(options.connectTimeoutMs)) {
      throw new PostgresStorageConfigurationError("PostgreSQL connection timeout is invalid.");
    }
    if (options.schema !== undefined && !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(options.schema)) {
      throw new PostgresStorageConfigurationError("PostgreSQL schema name is invalid.");
    }
  },

  /**
   * Checks whether an optional numeric setting is a positive integer.
   *
   * @param value Supplies the optional setting.
   * @returns Whether the setting is absent or valid.
   */
  positive(value: number | undefined): boolean {
    return value === undefined || (Number.isInteger(value) && value > 0);
  },
});

/**
 * Resolves and validates schemas used by connected pools.
 */
const PostgresSchemas = Object.freeze({
  /**
   * Resolves an explicit or connection-default schema.
   *
   * @param client Provides a connected client.
   * @param explicit Optionally names the configured schema.
   * @returns The existing schema name.
   */
  async resolve(client: PoolClient, explicit: string | undefined): Promise<string> {
    const schema = explicit ?? (await PostgresSchemas.current(client));
    const result = await client.query(
      "SELECT 1 FROM information_schema.schemata WHERE schema_name = $1",
      [schema],
    );
    if (result.rowCount !== 1)
      throw new PostgresStorageConfigurationError("PostgreSQL schema does not exist.");
    return schema;
  },

  /**
   * Reads and validates the connection's current schema.
   *
   * @param client Provides a connected client.
   * @returns The current schema name.
   */
  async current(client: PoolClient): Promise<string> {
    const result = await client.query<{ readonly schema: string | null }>(
      "SELECT current_schema() AS schema",
    );
    const schema = result.rows[0]?.schema;
    if (schema === null || schema === undefined || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(schema)) {
      throw new PostgresStorageConfigurationError("PostgreSQL schema is invalid.");
    }
    return schema;
  },
});
