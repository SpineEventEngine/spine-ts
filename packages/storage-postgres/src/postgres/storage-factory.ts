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
import { TenantBoundary, type TenantCatalog } from "@spine-event-engine/storage/provider";
import { EntityCommitStorageFactories } from "@spine-event-engine/storage/provider";
import { Pool, type PoolConfig, type PoolClient } from "pg";

import { PostgresStorageConfigurationError, PostgresStorageConnectionError } from "./errors.js";
import { PostgresRecordStorage, type PostgresRecordLifecycle } from "./record-storage.js";
import { PostgresEntityStorage } from "./entity-history.js";
import { PostgresEntityCommitStorage } from "./entity-commit.js";
import { PostgresTableResolver } from "./table-resolver.js";
import { PostgresTableSpecs } from "./table-spec.js";

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
 * Describes one resolved PostgreSQL record-family table.
 */
export interface PostgresTableSpec<I, R extends Message> {
  // prettier-ignore

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
  readonly postgresType: string;

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
   * Sets custom reversible message stringifiers used by IDs and columns.
   *
   * @param registry The schema-bound stringifier registry.
   * @returns This builder.
   */
  setStringifierRegistry(registry: StringifierRegistry): this;

  /**
   * Sets the ungrouped table name for a record-family source type.
   *
   * @param sourceType Identifies the ungrouped family source Protobuf type.
   * @param name Specifies the physical table name.
   * @returns This builder.
   */
  setTableName<S extends Message>(sourceType: GenMessage<S>, name: string): this;

  /**
   * Sets the grouped table name for a source and record type.
   *
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
   * @returns The initialized factory.
   */
  build(): Promise<PostgresStorageFactory>;
}

/**
 * Provides the PostgreSQL storage-factory public contract.
 */
export class PostgresStorageFactory extends StorageFactory {
  readonly #handles = new Set<{ close(): void }>();
  readonly #databases: ReadonlyMap<string | symbol, PostgresDatabase>;
  readonly #catalog: TenantCatalog;
  #closed: Promise<void> | undefined;

  private constructor(
    databases: readonly PostgresDatabase[],
    private readonly resolver: PostgresTableResolver,
    private readonly operation: PostgresCreateOperationFactory | undefined,
    private readonly stringifiers: StringifierRegistry,
  ) {
    super();
    this.#databases = new Map(databases.map((database) => [database.boundary.key, database]));
    this.#catalog = new PostgresTenantCatalog(databases.map(({ boundary }) => boundary));
    EntityCommitStorageFactories.register(this, {
      createEntityCommitStorage: (input) => this.createEntityCommitStorage(input),
    });
  }

  /**
   * Creates a PostgreSQL storage factory builder.
   *
   * @returns A new builder.
   */
  static newBuilder(): PostgresStorageFactoryBuilder {
    return new Builder((entries, resolver, operation, stringifiers) =>
      PostgresStorageFactory.connect(entries, resolver, operation, stringifiers),
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
   * Closes the factory and begins idempotent PostgreSQL pool draining.
   */
  override close(): void {
    this.#closed ??= this.drain();
    void this.#closed.catch(() => undefined);
  }

  /**
   * Creates a record-storage handle for the selected PostgreSQL tenant.
   *
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
    return this.createPostgresRecordStorage(context, recordSpec, group);
  }

  private createPostgresRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): PostgresRecordStorage<I, R> {
    const table = this.resolver.resolve(
      recordSpec.sourceType.typeName,
      group?.name,
      undefined,
      recordSpec.recordType.typeName,
    );
    const spec = PostgresTableSpecs.resolvedPostgresTableSpec({
      tableName: table.tableName,
      sourceType: recordSpec.sourceType,
      recordType: recordSpec.recordType,
      idType: recordSpec.idType,
      ...(group === undefined ? {} : { groupName: group.name }),
      declaredColumns: recordSpec.columns,
    });
    const database = this.database(context);
    const handle = new PostgresRecordStorage(
      context,
      recordSpec,
      spec,
      this.connections(database),
      () => this.#handles.delete(handle),
      this.operation === undefined ? undefined : createOperation(this.operation, spec),
      this.stringifiers,
    );
    this.#handles.add(handle);
    return handle;
  }

  /**
   * Creates the internal Entity-current and history storage seam.
   *
   * @param input Supplies the Entity storage configuration.
   * @returns A factory-managed PostgreSQL Entity handle.
   */
  createEntityStorage<I, S extends Message>(
    input: import("@spine-event-engine/storage/provider").EntityStorageInput<I, S>,
  ): PostgresEntityStorage<I, S> {
    if (!this.isOpen()) throw new Error("StorageFactory is closed.");
    const registration = {} as { handle: PostgresEntityStorage<I, S> };
    const handle = new PostgresEntityStorage(
      input,
      this.createPostgresRecordStorage(input.context, input.recordSpec),
      (spec, group) => this.createPostgresRecordStorage(input.context, spec, group),
      () => this.#handles.delete(registration.handle),
    );
    registration.handle = handle;
    this.#handles.add(handle);
    return handle;
  }

  private createEntityCommitStorage<I, S extends Message>(
    input: import("@spine-event-engine/storage/provider").EntityStorageInput<I, S>,
  ): PostgresEntityCommitStorage<I, S> {
    if (!this.isOpen()) throw new Error("StorageFactory is closed.");
    const registration = {} as { handle: PostgresEntityCommitStorage<I, S> };
    const database = this.database(input.context);
    const handle = new PostgresEntityCommitStorage(
      input,
      (spec, group) => this.createPostgresRecordStorage(input.context, spec, group),
      this.connections(database),
      () => this.#handles.delete(registration.handle),
    );
    registration.handle = handle;
    this.#handles.add(handle);
    return handle;
  }

  private async drain(): Promise<void> {
    super.close();
    for (const handle of this.#handles) handle.close();
    await this.#catalog.close();
    await Promise.all([...this.#databases.values()].map(({ pool }) => pool.end()));
  }

  private static async connect(
    entries: readonly PostgresDatabaseConfig[],
    resolver = new PostgresTableResolver(),
    operation?: PostgresCreateOperationFactory,
    stringifiers = new StringifierRegistry(),
  ): Promise<PostgresStorageFactory> {
    const connected: PostgresDatabase[] = [];
    try {
      for (const entry of entries) connected.push(await PostgresStorageFactory.prove(entry));
      return new PostgresStorageFactory(connected, resolver, operation, stringifiers);
    } catch (error) {
      await Promise.all(connected.map(({ pool }) => pool.end().catch(() => undefined)));
      if (error instanceof PostgresStorageConfigurationError) throw error;
      throw new PostgresStorageConnectionError("Unable to connect to PostgreSQL.");
    }
  }

  private static async prove(entry: PostgresDatabaseConfig): Promise<PostgresDatabase> {
    const pool = new Pool(entry.poolOptions);
    try {
      const client = await pool.connect();
      try {
        const schema = await PostgresSchemas.resolve(client, entry.schema);
        await PostgresSchemas.assertUsable(client, schema);
        return { boundary: entry.boundary, pool, schema, databaseName: entry.databaseName };
      } finally {
        client.release();
      }
    } catch (error) {
      await pool.end().catch(() => undefined);
      throw error;
    }
  }

  private database(context: StorageContext): PostgresDatabase {
    const boundary = TenantBoundary.of(context);
    const database = this.#databases.get(boundary.key);
    if (database !== undefined) return database;
    throw new PostgresStorageConfigurationError(
      boundary.single
        ? "PostgreSQL storage is configured for multiple tenants."
        : "PostgreSQL storage has no configured database for the requested tenant.",
    );
  }

  private connections(database: PostgresDatabase): PostgresRecordLifecycle {
    return {
      databaseName: database.databaseName,
      schema: database.schema,
      acquire: () => database.pool.connect(),
    };
  }
}

class Builder implements PostgresStorageFactoryBuilder {
  #options: PostgresStorageFactoryOptions | undefined;
  #tenantOptions: readonly PostgresTenantStorageOptions[] | undefined;
  #operationFactory: PostgresCreateOperationFactory | undefined;
  #stringifiers = new StringifierRegistry();
  readonly #resolver = new PostgresTableResolver();

  setOptions(options: PostgresStorageFactoryOptions): this {
    this.#options = {
      ...options,
      ...(options.tls === undefined ? {} : { tls: { ...options.tls } }),
    };
    return this;
  }

  setTenantOptions(entries: readonly PostgresTenantStorageOptions[]): this {
    this.#tenantOptions = entries.map(({ tenantId, options }) => ({
      tenantId,
      options: { ...options, ...(options.tls === undefined ? {} : { tls: { ...options.tls } }) },
    }));
    return this;
  }

  setStringifierRegistry(registry: StringifierRegistry): this {
    this.#stringifiers = new StringifierRegistry(registry);
    return this;
  }

  setTableName<S extends Message>(sourceType: GenMessage<S>, name: string): this;
  setTableName<S extends Message, R extends Message>(
    sourceType: GenMessage<S>,
    recordType: GenMessage<R>,
    name: string,
  ): this;
  setTableName(...args: unknown[]): this {
    this.#resolver.setRecordName(
      (args[0] as GenMessage<Message>).typeName,
      args[args.length - 1] as string,
    );
    return this;
  }

  useOperationFactory(factory: PostgresCreateOperationFactory): this {
    this.#operationFactory = factory;
    return this;
  }

  constructor(
    private readonly connect: (
      entries: readonly PostgresDatabaseConfig[],
      resolver: PostgresTableResolver,
      operation: PostgresCreateOperationFactory | undefined,
      stringifiers: StringifierRegistry,
    ) => Promise<PostgresStorageFactory>,
  ) {}

  build(): Promise<PostgresStorageFactory> {
    try {
      if (this.#options === undefined && this.#tenantOptions === undefined)
        throw new PostgresStorageConfigurationError("PostgreSQL storage options are required.");
      if (this.#options !== undefined && this.#tenantOptions !== undefined)
        throw new PostgresStorageConfigurationError(
          "Configure either single-tenant or multitenant PostgreSQL storage, not both.",
        );
      const entries =
        this.#options === undefined
          ? PostgresConfigurations.multitenant(this.#tenantOptions ?? [])
          : [PostgresConfigurations.single(this.#options)];
      return this.connect(entries, this.#resolver, this.#operationFactory, this.#stringifiers);
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new PostgresStorageConfigurationError("PostgreSQL storage configuration is invalid."),
      );
    }
  }
}

interface PostgresDatabase {
  readonly boundary: TenantBoundary;
  readonly pool: Pool;
  readonly schema: string;
  readonly databaseName: string;
}

interface PostgresDatabaseConfig {
  readonly boundary: TenantBoundary;
  readonly poolOptions: PoolConfig;
  readonly schema: string | undefined;
  readonly target: string;
  readonly databaseName: string;
}

class PostgresTenantCatalog implements TenantCatalog {
  constructor(private readonly boundaries: readonly TenantBoundary[]) {}

  all(): Promise<readonly TenantBoundary[]> {
    return Promise.resolve(this.boundaries);
  }

  keep(boundary: TenantBoundary): Promise<void> {
    if (!this.boundaries.some(({ key }) => key === boundary.key)) {
      return Promise.reject(
        new PostgresStorageConfigurationError("PostgreSQL tenant is not configured."),
      );
    }
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

const PostgresConfigurations = Object.freeze({
  single(options: PostgresStorageFactoryOptions): PostgresDatabaseConfig {
    return PostgresConfigurations.parse(TenantBoundary.single, options);
  },

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

  positive(value: number | undefined): boolean {
    return value === undefined || (Number.isInteger(value) && value > 0);
  },
});

function createOperation<I, R extends Message>(
  operation: PostgresCreateOperationFactory,
  table: PostgresTableSpec<I, R>,
): () => string {
  return () => operation(table).sql;
}

const PostgresSchemas = Object.freeze({
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

  async assertUsable(client: PoolClient, schema: string): Promise<void> {
    const result = await client.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = $1 " +
        "AND LOWER(column_name) IN ('_scope', '_revision') LIMIT 1",
      [schema],
    );
    if ((result.rowCount ?? 0) > 0) {
      throw new PostgresStorageConfigurationError(
        "The configured database contains the retired storage layout.",
      );
    }
  },
});
