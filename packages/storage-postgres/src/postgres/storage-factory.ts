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
import {
  DeliveryCleanupStorageFactories,
  EntityCommitStorageFactories,
} from "@spine-event-engine/storage/provider";
import { Pool, type PoolConfig, type PoolClient } from "pg";

import { PostgresStorageConfigurationError, PostgresStorageConnectionError } from "./errors.js";
import { PostgresRecordStorage, type PostgresRecordLifecycle } from "./record-storage.js";
import { PostgresEntityStorage } from "./entity-history.js";
import { PostgresEntityCommitStorage } from "./entity-commit.js";
import { PostgresDeliveryCleanupStorage } from "./delivery-cleanup.js";
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

  /**
   * Creates a connected factory from validated database resources.
   *
   * @param databases Supply the configured tenant databases.
   * @param resolver Resolves record families to physical table names.
   * @param operation Optionally creates custom table SQL.
   * @param stringifiers Convert message IDs and columns reversibly.
   */
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
    DeliveryCleanupStorageFactories.register(this, {
      createDeliveryCleanupStorage: () => this.createDeliveryCleanupStorage(),
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
    return this.createPostgresRecordStorage(context, recordSpec, group);
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
   */
  private createPostgresRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): PostgresRecordStorage<I, R> {
    const database = this.database(context);
    const table = this.resolver.resolve(
      recordSpec.sourceType.typeName,
      group?.name,
      undefined,
      recordSpec.recordType.typeName,
    );
    const spec = PostgresTableSpecs.resolvedPostgresTableSpec({
      schema: database.schema,
      tableName: table.tableName,
      sourceType: recordSpec.sourceType,
      recordType: recordSpec.recordType,
      idType: recordSpec.idType,
      ...(group === undefined ? {} : { groupName: group.name }),
      declaredColumns: recordSpec.columns,
    });
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
    );
    registration.handle = handle;
    this.#handles.add(handle);
    return handle;
  }

  /**
   * Creates the transaction coordinator for Entity current state and history.
   *
   * @typeParam I The Entity identifier type.
   * @typeParam S The Entity state message type.
   * @param input Supplies the Entity storage configuration.
   * @returns A factory-managed commit coordinator.
   */
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

  /**
   * Creates the provider's delivered-Inbox cleanup coordinator.
   *
   * @returns A factory-managed cleanup coordinator.
   */
  private createDeliveryCleanupStorage(): PostgresDeliveryCleanupStorage {
    if (!this.isOpen()) throw new Error("StorageFactory is closed.");
    const registration = {} as { handle: PostgresDeliveryCleanupStorage };
    const handle = new PostgresDeliveryCleanupStorage(
      (context, spec) => this.createPostgresRecordStorage(context, spec),
      (context) => this.connections(this.database(context)),
      () => this.#handles.delete(registration.handle),
    );
    registration.handle = handle;
    this.#handles.add(handle);
    return handle;
  }

  /**
   * Closes live handles, the tenant catalog, and all pools.
   *
   * @returns A promise that resolves after every pool closes.
   */
  private async drain(): Promise<void> {
    super.close();
    for (const handle of this.#handles) handle.close();
    await this.#catalog.close();
    await Promise.all([...this.#databases.values()].map(({ pool }) => pool.end()));
  }

  /**
   * Connects every configured database before exposing a factory.
   *
   * @param entries Supply validated database configurations.
   * @param resolver Resolves physical table names.
   * @param operation Optionally creates custom table SQL.
   * @param stringifiers Convert message values reversibly.
   * @returns The connected factory.
   */
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

  /**
   * Finds the configured database for a storage context.
   *
   * @param context Identifies the tenant boundary.
   * @returns The matching database resource.
   */
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

  /**
   * Exposes record-lifecycle operations for one database resource.
   *
   * @param database Supplies the connected database.
   * @returns Its package-local record lifecycle.
   */
  private connections(database: PostgresDatabase): PostgresRecordLifecycle {
    return {
      databaseName: database.databaseName,
      schema: database.schema,
      acquire: () => database.pool.connect(),
    };
  }
}

/**
 * Collects validated options before connecting a PostgreSQL storage factory.
 */
class Builder implements PostgresStorageFactoryBuilder {
  #options: PostgresStorageFactoryOptions | undefined;

  #tenantOptions: readonly PostgresTenantStorageOptions[] | undefined;

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
   * Creates a builder with its factory connection function.
   *
   * @param connect Connects validated database configurations.
   */
  constructor(
    private readonly connect: (
      entries: readonly PostgresDatabaseConfig[],
      resolver: PostgresTableResolver,
      operation: PostgresCreateOperationFactory | undefined,
      stringifiers: StringifierRegistry,
    ) => Promise<PostgresStorageFactory>,
  ) {}

  /**
   * Validates the selected mode and connects a factory.
   *
   * @returns The connected PostgreSQL storage factory.
   */
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

/**
 * Holds one connected tenant database resource.
 */
interface PostgresDatabase {
  readonly boundary: TenantBoundary;
  readonly pool: Pool;
  readonly schema: string;
  readonly databaseName: string;
}

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
  /**
   * Creates a catalog from configured tenant boundaries.
   *
   * @param boundaries Supply the configured boundaries.
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
 * Adapts a public create-table operation to the record handle callback.
 *
 * @typeParam I The storage identifier type.
 * @typeParam R The stored Protobuf record type.
 * @param operation Creates a public operation for a resolved table.
 * @param table Supplies the resolved table specification.
 * @returns A callback that returns the operation SQL.
 */
function createOperation<I, R extends Message>(
  operation: PostgresCreateOperationFactory,
  table: PostgresTableSpec<I, R>,
): () => string {
  return () => operation(table).sql;
}

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

  /**
   * Rejects schemas that contain the retired storage layout.
   *
   * @param client Provides a connected client.
   * @param schema Names the selected schema.
   * @returns A promise that resolves when the schema is usable.
   */
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
