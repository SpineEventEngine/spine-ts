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

import { PostgresStorageConfigurationError, PostgresStorageOperationError } from "./errors.js";

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
  private constructor(private readonly configuration: PostgresFactoryConfiguration) {
    super();
  }

  /**
   * Creates a PostgreSQL storage factory builder.
   *
   * @returns A new builder.
   */
  static newBuilder(): PostgresStorageFactoryBuilder {
    return new Builder((configuration) => new PostgresStorageFactory(configuration));
  }

  /**
   * Rejects record-storage creation until the PostgreSQL runtime slice is available.
   *
   * @param _context Identifies the requested storage boundary.
   * @param _recordSpec Describes the requested record family.
   * @param _group Separates records that share a source type.
   * @returns Does not return because this contract-only factory has no record runtime.
   */
  protected override onCreateRecordStorage<I, R extends Message>(
    _context: StorageContext,
    _recordSpec: RecordSpec<I, R>,
    _group?: StorageGroup,
  ): RecordStorage<I, R> {
    void _context;
    void _recordSpec;
    void _group;
    throw new PostgresStorageOperationError("PostgreSQL record storage is not implemented.");
  }
}

class Builder implements PostgresStorageFactoryBuilder {
  #options: PostgresStorageFactoryOptions | undefined;
  #tenantOptions: readonly PostgresTenantStorageOptions[] | undefined;
  #operationFactory: PostgresCreateOperationFactory | undefined;
  #stringifiers = new StringifierRegistry();
  readonly #tableNames: unknown[][] = [];

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
    this.#tableNames.push(args);
    return this;
  }

  useOperationFactory(factory: PostgresCreateOperationFactory): this {
    this.#operationFactory = factory;
    return this;
  }

  constructor(
    private readonly create: (
      configuration: PostgresFactoryConfiguration,
    ) => PostgresStorageFactory,
  ) {}

  build(): Promise<PostgresStorageFactory> {
    if (this.#options === undefined && this.#tenantOptions === undefined) {
      return Promise.reject(
        new PostgresStorageConfigurationError("PostgreSQL storage options are required."),
      );
    }
    if (this.#options !== undefined && this.#tenantOptions !== undefined) {
      return Promise.reject(
        new PostgresStorageConfigurationError(
          "Configure either single-tenant or multitenant PostgreSQL storage, not both.",
        ),
      );
    }
    return Promise.resolve(
      this.create({
        options: this.#options,
        tenantOptions: this.#tenantOptions,
        operationFactory: this.#operationFactory,
        stringifiers: this.#stringifiers,
        tableNames: this.#tableNames,
      }),
    );
  }
}

interface PostgresFactoryConfiguration {
  readonly options: PostgresStorageFactoryOptions | undefined;
  readonly tenantOptions: readonly PostgresTenantStorageOptions[] | undefined;
  readonly operationFactory: PostgresCreateOperationFactory | undefined;
  readonly stringifiers: StringifierRegistry;
  readonly tableNames: readonly unknown[][];
}
