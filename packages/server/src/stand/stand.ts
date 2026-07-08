import { clone, type Message, type MessageShape } from "@bufbuild/protobuf";
import { deriveTypeUrl, type MessageSchema } from "@spine-ts/core";
import { VersionSchema, type Version } from "@spine-ts/proto";
import {
  RecordColumn,
  RecordSpec,
  type RecordQuery,
  type RecordStorage,
  type StorageContext,
} from "@spine-ts/storage";
import type { StorageFactory } from "@spine-ts/storage";

/** Options for constructing a direct read-side Stand. */
export interface StandOptions {
  /** Base storage context owned by the enclosing bounded context. */
  readonly context: StorageContext;
  /** Storage factory used for read-side state records. */
  readonly storageFactory: StorageFactory;
}

/** Options for registering an entity state schema with the Stand. */
export interface StandRegisterOptions {
  /** Generated local property name for the entity ID field. Defaults to the schema's first field. */
  readonly idField?: string;
  /** Queryable columns materialized for this state type. */
  readonly columns?: readonly RecordColumn<Message>[];
}

/** Tenant and version metadata accepted when recording an entity state update. */
export interface StandUpdateOptions {
  /** Tenant slice for multitenant stands. */
  readonly tenantId?: string;
  /** Version associated with the updated state in this Stand instance's in-memory map. */
  readonly version?: Version;
}

/** Tenant metadata accepted when reading one entity state. */
export interface StandReadOptions {
  /** Tenant slice for multitenant stands. */
  readonly tenantId?: string;
}

/** Stored state plus metadata returned by versioned Stand reads. */
export interface StandReadResult<Schema extends MessageSchema = MessageSchema> {
  /** Latest entity state. */
  readonly state: MessageShape<Schema>;
  /** Version from this Stand instance's in-memory, process-local metadata map when supplied. */
  readonly version?: Version;
}

/** Tenant metadata accepted when subscribing to entity updates. */
export interface StandSubscribeOptions {
  /** Tenant slice for multitenant stands. */
  readonly tenantId?: string;
}

/** Direct in-process entity state update delivered by the Stand. */
export interface StandUpdate<Schema extends MessageSchema = MessageSchema> {
  /** Type URL of the entity state schema. */
  readonly typeUrl: string;
  /** Entity ID extracted from the state. */
  readonly id: unknown;
  /** Updated entity state. */
  readonly state: MessageShape<Schema>;
  /** Version associated with the updated state when supplied. */
  readonly version?: Version;
  /** Tenant slice for multitenant stands. */
  readonly tenantId?: string;
}

/** Explicit cleanup handle returned by direct Stand subscriptions. */
export interface StandSubscription {
  /** Whether this subscription has already been unsubscribed. */
  readonly closed: boolean;
  /** Stop future deliveries. Safe to call more than once. */
  unsubscribe(): void;
}

/** Error thrown when direct Stand access targets an unregistered state type. */
export class StandStateTypeError extends Error {
  /** Rejected state type URL. */
  readonly typeUrl: string;
  /** Stand operation that required a known state type. */
  readonly operation: string;

  constructor(typeUrl: string, operation: string) {
    super(`Stand cannot ${operation} unknown entity state type "${typeUrl}".`);
    this.name = "StandStateTypeError";
    this.typeUrl = typeUrl;
    this.operation = operation;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface Subscriber<Schema extends MessageSchema = MessageSchema> {
  readonly tenantKey: string;
  readonly callback: (update: StandUpdate<Schema>) => void;
}

interface Registration<Schema extends MessageSchema = MessageSchema> {
  readonly schema: Schema;
  readonly typeUrl: string;
  readonly idField: string;
  readonly recordSpec: RecordSpec<unknown, Message>;
  readonly subscribers: Set<Subscriber<Schema>>;
}

/**
 * Direct read-side access point for storage-backed entity states and updates.
 *
 * Entity states are stored through the configured `StorageFactory`. Version
 * metadata is held in this `Stand` instance's in-memory, process-local map and
 * is not persisted by the current slice.
 */
export class Stand {
  readonly #context: StorageContext;
  readonly #storageFactory: StorageFactory;
  readonly #registrations = new Map<string, Registration>();
  readonly #versions = new Map<string, Version>();
  readonly #inFlight = new Set<Promise<void>>();
  #closing = false;
  #closed = false;
  #closedPromise: Promise<void> | undefined;

  constructor(options: StandOptions) {
    this.#context = cloneStorageContext(options.context);
    this.#storageFactory = options.storageFactory;
  }

  /** Register one known entity state schema. Re-registering the same schema is idempotent. */
  register(schema: MessageSchema, options: StandRegisterOptions = {}): void {
    this.#requireOpen();
    const typeUrl = deriveTypeUrl(schema);
    if (this.#registrations.has(typeUrl)) {
      return;
    }

    const idField = options.idField ?? schema.fields[0]?.localName;
    if (idField === undefined || idField.trim().length === 0) {
      throw new Error(`Stand state "${schema.typeName}" requires an entity ID field.`);
    }

    this.#registrations.set(
      typeUrl,
      Object.freeze({
        schema,
        typeUrl,
        idField,
        recordSpec: createStandRecordSpec(schema, idField, options.columns ?? []),
        subscribers: new Set<Subscriber>(),
      }),
    );
  }

  /** Type URLs of state schemas known to this Stand, in registration order. */
  stateTypes(): readonly string[] {
    this.#requireOpen();
    return Object.freeze([...this.#registrations.keys()]);
  }

  /** Read the latest state for one entity ID. */
  async read<Schema extends MessageSchema>(
    schema: Schema,
    id: unknown,
    options: StandReadOptions = {},
  ): Promise<MessageShape<Schema> | undefined> {
    const result = await this.readVersioned(schema, id, options);

    return result?.state;
  }

  /** Read the latest state and caller-supplied version metadata for one entity ID. */
  async readVersioned<Schema extends MessageSchema>(
    schema: Schema,
    id: unknown,
    options: StandReadOptions = {},
  ): Promise<StandReadResult<Schema> | undefined> {
    const finish = this.#beginOperation();

    try {
      const registration = this.#registration(schema, "read");
      const tenantId = this.#tenantId(options.tenantId);
      const storage = this.#openStorage(registration, tenantId);

      try {
        const stored = await storage.read(id);
        if (stored === undefined) {
          return undefined;
        }
        return this.#readResult(registration, stored as MessageShape<Schema>, tenantId);
      } finally {
        storage.close();
      }
    } finally {
      finish();
    }
  }

  /** Read all latest states and caller-supplied version metadata in storage query order. */
  async readAllVersioned<Schema extends MessageSchema>(
    schema: Schema,
    options: StandReadOptions = {},
  ): Promise<readonly StandReadResult<Schema>[]> {
    return this.queryVersioned(schema, {}, options);
  }

  /** Query latest states and caller-supplied version metadata in storage query order. */
  async queryVersioned<Schema extends MessageSchema>(
    schema: Schema,
    query: RecordQuery<unknown> = {},
    options: StandReadOptions = {},
  ): Promise<readonly StandReadResult<Schema>[]> {
    const finish = this.#beginOperation();

    try {
      const registration = this.#registration(schema, "read");
      const tenantId = this.#tenantId(options.tenantId);
      const storage = this.#openStorage(registration, tenantId);

      try {
        const stored = await storage.queryEntries(query);
        return stored.map((entry) =>
          this.#readResult(registration, entry.record as MessageShape<Schema>, tenantId, entry.id),
        );
      } finally {
        storage.close();
      }
    } finally {
      finish();
    }
  }

  /**
   * Clear all stored states and process-local version metadata for one known state schema.
   *
   * `BoundedContext.catchUpReadSide()` uses this to reset one projection state
   * type before replay for the selected tenant slice.
   */
  async clear(schema: MessageSchema, options: StandReadOptions = {}): Promise<number> {
    const finish = this.#beginOperation();

    try {
      const registration = this.#registration(schema, "clear");
      const tenantId = this.#tenantId(options.tenantId);
      const storage = this.#openStorage(registration, tenantId);

      try {
        const ids = await storage.index();
        for (const id of ids) {
          await storage.delete(id);
        }
        this.#clearVersions(registration.typeUrl, tenantId);
        return ids.length;
      } finally {
        storage.close();
      }
    } finally {
      finish();
    }
  }

  /** Record one latest entity state and deliver an in-process update to matching subscribers. */
  async update<Schema extends MessageSchema>(
    schema: Schema,
    state: MessageShape<Schema>,
    options: StandUpdateOptions = {},
  ): Promise<void> {
    const finish = this.#beginOperation();

    try {
      const registration = this.#registration(schema, "update");
      const tenantId = this.#tenantId(options.tenantId);
      const stateCopy = clone(schema, state);
      const id = readStateId(stateCopy, registration);
      const storage = this.#openStorage(registration, tenantId);

      try {
        await storage.write(stateCopy);
      } finally {
        storage.close();
      }
      const key = versionKey(registration.typeUrl, tenantId, id);
      if (options.version === undefined) {
        this.#versions.delete(key);
      } else {
        this.#versions.set(key, clone(VersionSchema, options.version));
      }
      this.#notify(registration, {
        id,
        state: stateCopy,
        tenantId,
        version: options.version,
      });
    } finally {
      finish();
    }
  }

  /** Subscribe directly to in-process updates for one known state schema. */
  subscribe<Schema extends MessageSchema>(
    schema: Schema,
    callback: (update: StandUpdate<Schema>) => void,
    options: StandSubscribeOptions = {},
  ): StandSubscription {
    this.#requireOpen();
    const registration = this.#registration(schema, "subscribe");
    const tenantKey = this.#tenantKey(options.tenantId);
    const subscriber: Subscriber<Schema> = Object.freeze({ tenantKey, callback });
    let closed = false;
    registration.subscribers.add(subscriber);

    return Object.freeze({
      get closed() {
        return closed;
      },
      unsubscribe() {
        if (!closed) {
          closed = true;
          registration.subscribers.delete(subscriber);
        }
      },
    });
  }

  /**
   * Close direct subscriptions and reject later Stand operations.
   *
   * Close is idempotent. New operations are rejected once close begins, and the
   * close promise waits for already accepted direct reads/updates to finish
   * before clearing subscriptions and version metadata.
   */
  close(): Promise<void> {
    this.#closedPromise ??= this.#closeOnce();
    return this.#closedPromise;
  }

  async #closeOnce(): Promise<void> {
    this.#closing = true;
    await Promise.all([...this.#inFlight]);
    this.#versions.clear();
    for (const registration of this.#registrations.values()) {
      registration.subscribers.clear();
    }
    this.#closed = true;
  }

  #registration<Schema extends MessageSchema>(
    schema: Schema,
    operation: string,
  ): Registration<Schema> {
    this.#requireOpen();
    const typeUrl = deriveTypeUrl(schema);
    const registration = this.#registrations.get(typeUrl);
    if (registration === undefined) {
      throw new StandStateTypeError(typeUrl, operation);
    }

    return registration as Registration<Schema>;
  }

  #openStorage(
    registration: Registration,
    tenantId: string | undefined,
  ): RecordStorage<unknown, Message> {
    return this.#storageFactory.createRecordStorage(
      this.#storageContext(tenantId),
      registration.recordSpec,
    );
  }

  #readResult<Schema extends MessageSchema>(
    registration: Registration<Schema>,
    state: MessageShape<Schema>,
    tenantId: string | undefined,
    idOverride?: unknown,
  ): StandReadResult<Schema> {
    const id = idOverride ?? registration.recordSpec.idValueIn(state);
    const version = this.#versions.get(versionKey(registration.typeUrl, tenantId, id));

    return Object.freeze({
      state: clone(registration.schema, state),
      ...(version === undefined ? {} : { version: clone(VersionSchema, version) }),
    });
  }

  #notify<Schema extends MessageSchema>(
    registration: Registration<Schema>,
    input: {
      readonly id: unknown;
      readonly state: MessageShape<Schema>;
      readonly tenantId: string | undefined;
      readonly version: Version | undefined;
    },
  ): void {
    const errors: unknown[] = [];
    const tenantKey = this.#tenantKey(input.tenantId);
    const subscribers = [...registration.subscribers].filter(
      (subscriber) => subscriber.tenantKey === tenantKey,
    );

    for (const subscriber of subscribers) {
      try {
        subscriber.callback(createUpdate(registration, input));
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, "Stand subscriber delivery failed.");
    }
  }

  #tenantKey(tenantId: string | undefined): string {
    return this.#tenantId(tenantId) ?? "__single__";
  }

  #tenantId(tenantId: string | undefined): string | undefined {
    if (!this.#context.multitenant) {
      if (tenantId !== undefined) {
        throw new Error(`Single-tenant Stand "${this.#context.name}" does not accept tenantId.`);
      }
      return undefined;
    }

    if (tenantId === undefined || tenantId.trim().length === 0) {
      throw new Error(`Multitenant Stand "${this.#context.name}" requires tenantId.`);
    }

    return tenantId;
  }

  #clearVersions(typeUrl: string, tenantId: string | undefined): void {
    const prefix = `${typeUrl}\n${tenantId ?? ""}\n`;

    for (const key of this.#versions.keys()) {
      if (key.startsWith(prefix)) {
        this.#versions.delete(key);
      }
    }
  }

  #storageContext(tenantId: string | undefined): StorageContext {
    return Object.freeze({
      ...this.#context,
      ...(tenantId === undefined ? {} : { tenantId }),
    });
  }

  #requireOpen(): void {
    if (this.#closing || this.#closed) {
      throw new Error("Stand is closed.");
    }
  }

  #beginOperation(): () => void {
    this.#requireOpen();
    let finish: (() => void) | undefined;
    const operation = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.#inFlight.add(operation);

    return () => {
      this.#inFlight.delete(operation);
      finish?.();
    };
  }
}

function createStandRecordSpec(
  schema: MessageSchema,
  idField: string,
  columns: readonly RecordColumn<Message>[],
): RecordSpec<unknown, Message> {
  return new RecordSpec<unknown, Message>({
    schema,
    extractId: (record) =>
      readStateId(record, {
        idField,
        schema,
        typeUrl: deriveTypeUrl(schema),
      }),
    columns,
  });
}

function createUpdate<Schema extends MessageSchema>(
  registration: Registration<Schema>,
  input: {
    readonly id: unknown;
    readonly state: MessageShape<Schema>;
    readonly tenantId: string | undefined;
    readonly version: Version | undefined;
  },
): StandUpdate<Schema> {
  const version = input.version === undefined ? undefined : clone(VersionSchema, input.version);

  return Object.freeze({
    typeUrl: registration.typeUrl,
    id: cloneValue(input.id),
    state: clone(registration.schema, input.state),
    ...(version === undefined ? {} : { version }),
    ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
  });
}

function readStateId(
  state: Message,
  registration: Pick<Registration, "schema" | "typeUrl" | "idField">,
): unknown {
  const id = readRecordField(state, registration.idField);

  if (id === undefined || id === null) {
    throw new Error(`Stand state "${registration.schema.typeName}" requires ID field.`);
  }

  return id;
}

function readRecordField(record: Message, localName: string): unknown {
  return (record as Record<string, unknown>)[localName];
}

function cloneValue(value: unknown): unknown {
  return typeof value === "object" && value !== null ? structuredClone(value) : value;
}

function versionKey(typeUrl: string, tenantId: string | undefined, id: unknown): string {
  return `${typeUrl}\n${tenantId ?? ""}\n${idKey(id)}`;
}

function idKey(id: unknown): string {
  if (
    typeof id === "string" ||
    typeof id === "number" ||
    typeof id === "boolean" ||
    typeof id === "bigint"
  ) {
    return `${typeof id}:${id.toString()}`;
  }

  return `json:${JSON.stringify(id)}`;
}

function cloneStorageContext(context: StorageContext): StorageContext {
  return Object.freeze({ ...context });
}

declare function structuredClone<T>(value: T): T;
