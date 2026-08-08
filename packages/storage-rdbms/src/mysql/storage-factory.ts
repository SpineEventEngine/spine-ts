import { createPool, type Pool, type PoolConnection } from "mysql2/promise";
import { toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import {
  StorageFactory,
  type RecordStorage,
  type RecordSpec,
  type StorageContext,
  type StorageGroup,
} from "@spine-event-engine/storage";
import {
  EntityCommitStorageFactories,
  type EntityCommitStorage,
} from "@spine-event-engine/storage/internal/entity-commit";
import type { EntityStorageInput } from "@spine-event-engine/storage/internal/entity-history";
import { eventStoreRecordSpec } from "@spine-event-engine/storage/internal/event-store";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";

import { MysqlRecordStorage, type MysqlRecordLifecycle } from "./record-storage.js";
import { MysqlTableResolver } from "./table-resolver.js";
import { MysqlEntityStorage } from "./entity-history.js";
import { mysqlEntityLockKey, MysqlEntityCommitCoordinator } from "./entity-commit.js";
import { resolvedMysqlTableSpec, type MysqlTableSpec } from "./table-spec.js";
import { MysqlStorageOperationError, mysqlError } from "./errors.js";

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
   * Sets the ungrouped table name for a record type.
   *
   * @param recordType Identifies the record Protobuf type.
   * @param name Specifies the physical table name.
   * @returns Returns this builder.
   */
  setTableName<R extends Message>(recordType: GenMessage<R>, name: string): this;

  /**
   * Sets the grouped table name for a source and record type.
   *
   * @param sourceType Identifies the source Protobuf type.
   * @param recordType Identifies the record Protobuf type.
   * @param name Specifies the physical table name.
   * @returns Returns this builder.
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
   * Builds an initialized MySQL storage factory.
   *
   * @returns Resolves to the initialized factory.
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
 * Provides MySQL record-family storage.
 */
export class MysqlStorageFactory extends StorageFactory {
  readonly #handles = new Set<{ close(): void }>();
  readonly #resolver: MysqlTableResolver;
  #closed: Promise<void> | undefined;
  private constructor(
    private readonly pool: Pool,
    private readonly databaseName: string,
    resolver = new MysqlTableResolver(),
    private readonly createOperation?: CreateOperationFactory,
  ) {
    super();
    this.#resolver = resolver;
    EntityCommitStorageFactories.register(this, {
      createEntityCommitStorage: (input) => this.createEntityCommitStorage(input),
    });
  }

  /**
   * Creates a MySQL storage factory builder.
   *
   * @returns Returns a new builder.
   */
  static newBuilder(): MysqlStorageFactoryBuilder {
    return new Builder((options, resolver, operation) =>
      MysqlStorageFactory.connect(options, resolver, operation),
    );
  }

  /**
   * Closes all storage handles and the connection pool.
   */
  override close(): void {
    this.#closed ??= (async () => {
      super.close();
      for (const handle of this.#handles) handle.close();
      await this.pool.end();
    })();
    void this.#closed;
  }

  /**
   * Creates storage for one resolved record family.
   *
   * @param context Provides the storage context.
   * @param spec Describes the record family.
   * @param group Identifies an optional storage group.
   * @returns Returns the record-family storage handle.
   */
  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): RecordStorage<I, R> {
    return this.createMysqlRecordStorage(context, spec, group);
  }
  private createMysqlRecordStorage<I, R extends Message>(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): MysqlRecordStorage<I, R> {
    const table = this.#resolver.resolve(
      spec.sourceType.typeName,
      group?.name,
      undefined,
      spec.recordType.typeName,
    );
    const tableSpec = resolvedMysqlTableSpec({
      tableName: table.tableName,
      sourceType: spec.sourceType,
      recordType: spec.recordType,
      idType: spec.idType,
      ...(group === undefined ? {} : { groupName: group.name }),
      declaredColumns: spec.columns,
    });
    const operation = this.createOperation;
    const create = operation === undefined ? undefined : () => operation(tableSpec).sql;
    const handle = new MysqlRecordStorage(
      context,
      spec,
      table,
      this.connections(),
      () => this.#handles.delete(handle),
      create,
      tableSpec,
    );
    this.#handles.add(handle);
    return handle;
  }

  /**
   * Creates MySQL storage for one Entity family.
   *
   * @param input Configures the Entity storage families.
   * @returns Returns the MySQL Entity storage handle.
   */
  private createEntityStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): MysqlEntityStorage<I, S> {
    const registration = {} as { handle: { close(): void } };
    const handle = new MysqlEntityStorage(
      input,
      (spec, group) => this.createMysqlRecordStorage(input.context, spec, group),
      () => this.#handles.delete(registration.handle),
    );
    registration.handle = handle;
    this.#handles.add(handle);
    return handle;
  }

  /**
   * Creates MySQL storage for atomic Entity commits.
   *
   * @param input Configures the Entity storage families.
   * @returns Returns the Entity commit storage handle.
   */
  private createEntityCommitStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): EntityCommitStorage {
    const registration = {} as { handle: { close(): void } };
    const handle = new MysqlEntityCommitStorage(
      input,
      () => this.createEntityStorage(input),
      () => this.createMysqlRecordStorage(input.context, eventStoreRecordSpec),
      new MysqlEntityCommitCoordinator(this.connections()),
      this.databaseName,
      () => this.#handles.delete(registration.handle),
    );
    registration.handle = handle;
    this.#handles.add(handle);
    return handle;
  }
  private connections(): MysqlRecordLifecycle {
    return {
      acquire: () => this.pool.getConnection(),
      release: (connection: PoolConnection) => {
        connection.release();
      },
    };
  }

  /**
   * Connects to MySQL and creates an initialized storage factory.
   *
   * @param options Specifies the MySQL connection options.
   * @param resolver Resolves configured record-family table names.
   * @param createOperation Creates optional table-creation SQL.
   * @internal
   * @returns Resolves to the initialized factory.
   */
  private static async connect(
    options: MysqlStorageOptions,
    resolver: MysqlTableResolver = new MysqlTableResolver(),
    createOperation?: CreateOperationFactory,
  ): Promise<MysqlStorageFactory> {
    let url: URL;
    try {
      url = new URL(options.url);
    } catch {
      throw new MysqlStorageConfigurationError("MySQL storage requires a valid URL.");
    }
    if (url.protocol !== "mysql:" || url.pathname.length <= 1)
      throw new MysqlStorageConfigurationError("MySQL storage URL requires a database.");
    const pool = createPool({
      host: url.hostname,
      ...(url.port === "" ? {} : { port: Number(url.port) }),
      database: decodeURIComponent(url.pathname.slice(1)),
      ...(url.username === "" ? {} : { user: decodeURIComponent(url.username) }),
      ...(url.password === "" ? {} : { password: decodeURIComponent(url.password) }),
      ...(options.connectionLimit === undefined
        ? {}
        : { connectionLimit: options.connectionLimit }),
      ...(options.connectTimeoutMs === undefined
        ? {}
        : { connectTimeout: options.connectTimeoutMs }),
      ...(options.tls === undefined ? {} : { ssl: options.tls }),
    });
    try {
      const connection = await pool.getConnection();
      connection.release();
      return new MysqlStorageFactory(
        pool,
        decodeURIComponent(url.pathname.slice(1)),
        resolver,
        createOperation,
      );
    } catch {
      await pool.end().catch(() => undefined);
      throw new MysqlStorageConnectionError("Unable to connect to MySQL.");
    }
  }
}
class Builder implements MysqlStorageFactoryBuilder {
  #options: MysqlStorageOptions | undefined;
  readonly #resolver = new MysqlTableResolver();
  #operation: CreateOperationFactory | undefined;
  constructor(
    private readonly connect: (
      options: MysqlStorageOptions,
      resolver: MysqlTableResolver,
      operation: CreateOperationFactory | undefined,
    ) => Promise<MysqlStorageFactory>,
  ) {}
  // prettier-ignore

  /**
   * Sets the MySQL connection options.
   *
   * @param options Specifies the MySQL connection options.
   * @returns Returns this builder.
   */
  setOptions(options: MysqlStorageOptions): this {
    this.#options = options;
    return this;
  }

  /**
   * Sets the ungrouped table name for a record type.
   *
   * @param recordType Identifies the record Protobuf type.
   * @param name Specifies the physical table name.
   * @returns Returns this builder.
   */
  setTableName<R extends Message>(recordType: GenMessage<R>, name: string): this;

  /**
   * Sets the grouped table name for a source and record type.
   *
   * @param sourceType Identifies the source Protobuf type.
   * @param recordType Identifies the record Protobuf type.
   * @param name Specifies the physical table name.
   * @returns Returns this builder.
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
      const [record, name] = args as [GenMessage<Message>, string];
      this.#resolver.setRecordName(record.typeName, name);
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
   * Builds an initialized MySQL storage factory.
   *
   * @returns Resolves to the initialized factory.
   */
  async build(): Promise<MysqlStorageFactory> {
    if (this.#options === undefined)
      throw new MysqlStorageConfigurationError("MySQL storage options are required.");
    return this.connect(this.#options, this.#resolver, this.#operation);
  }
}

class MysqlEntityCommitStorage<I, S extends Message> implements EntityCommitStorage {
  #open = true;
  constructor(
    private readonly entity: EntityStorageInput<I, S>,
    private readonly openStorage: () => MysqlEntityStorage<I, S>,
    private readonly openEvents: () => MysqlRecordStorage<
      import("@spine-event-engine/proto").EventId,
      import("@spine-event-engine/proto").Event
    >,
    private readonly coordinator: MysqlEntityCommitCoordinator,
    private readonly databaseName: string,
    private readonly onClose: () => void,
  ) {}
  async commit<Id, State extends Message>(
    input: import("@spine-event-engine/storage/internal/entity-commit").EntityCommitInput<
      Id,
      State
    >,
  ): Promise<import("@spine-event-engine/storage/internal/entity-commit").EntityCommitResult> {
    if (!this.#open) throw new MysqlStorageOperationError("Entity commit storage is closed.");
    if (input.entity.sourceType.typeName !== this.entity.sourceType.typeName)
      throw new MysqlStorageOperationError("Entity commit scope is incompatible.");
    if (!this.accepts(input))
      throw new MysqlStorageOperationError("Entity commit context is incompatible.");
    if (!this.entity.stateHistory && (input.states?.length ?? 0) > 0)
      throw new MysqlStorageOperationError("Entity state history is disabled.");
    if (!this.entity.eventHistory && (input.diagnostics?.length ?? 0) > 0)
      throw new MysqlStorageOperationError("Entity event history is disabled.");
    if ((input.events ?? []).some((event) => event.id === undefined))
      throw new MysqlStorageOperationError("Entity commit requires delivery-event IDs.");
    const storage = this.openStorage();
    const events = this.openEvents();
    try {
      const families = storage.commitCapability();
      await families.prepare();
      await events.prepare();
      const lockKey = mysqlEntityLockKey({
        databaseName: this.databaseName,
        contextName: this.entity.context.name,
        entityKey: input.entity.id.key(input.entityId),
        sourceTypeName: this.entity.sourceType.typeName,
        ...(this.entity.context.tenantId === undefined
          ? {}
          : { tenantId: this.entity.context.tenantId }),
      });
      return await this.coordinator.commit(
        [...families.tableNames(), events.tableName],
        lockKey,
        (connection, transactional) =>
          families.withConnection(connection, () =>
            events.withConnection(connection, async () => {
              const current = await families.readCurrentLockedKey(
                input.entity.id.key(input.entityId),
              );
              if (!sameEntity(current, input.expected) && !sameEntity(current, input.next))
                return "conflict";
              if (!transactional) {
                await families.preflightImmutable(input.states ?? [], input.diagnostics ?? []);
                for (const event of input.events ?? []) await events.assertImmutable(event);
              }
              for (const state of input.states ?? []) await families.appendStateImmutable(state);
              for (const diagnostic of input.diagnostics ?? [])
                await families.appendDiagnosticImmutable(diagnostic);
              for (const event of input.events ?? []) {
                if (event.id === undefined)
                  throw new MysqlStorageOperationError(
                    "Entity commit requires delivery-event IDs.",
                  );
                await events.writeImmutable(event);
              }
              if (!sameEntity(current, input.next)) await storage.current.write(input.next);
              return "committed";
            }),
          ),
      );
    } catch (error) {
      throw mysqlError(MysqlStorageOperationError, "MySQL Entity commit failed.", error);
    } finally {
      events.close();
      storage.close();
    }
  }
  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.onClose();
  }
  private accepts<Id, State extends Message>(
    input: import("@spine-event-engine/storage/internal/entity-commit").EntityCommitInput<
      Id,
      State
    >,
  ): boolean {
    return (
      input.context.name === this.entity.context.name &&
      input.context.multitenant === this.entity.context.multitenant &&
      input.context.tenantId === this.entity.context.tenantId
    );
  }
}
function sameEntity(left: EntityRecord | undefined, right: EntityRecord | undefined): boolean {
  return left === undefined || right === undefined
    ? left === right
    : Buffer.compare(toBinary(EntityRecordSchema, left), toBinary(EntityRecordSchema, right)) === 0;
}
