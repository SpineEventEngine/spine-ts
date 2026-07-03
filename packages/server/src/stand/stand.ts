import { clone, type Message, type MessageShape } from "@bufbuild/protobuf";
import { deriveTypeUrl, type MessageSchema } from "@spine-ts/core";
import { VersionSchema, type Version } from "@spine-ts/proto";
import {
  RecordColumn,
  RecordSpec,
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
  /** Queryable state columns to expose through the backing record storage. */
  readonly columns?: readonly StandColumn[];
}

/** One queryable Stand state column. */
export interface StandColumn {
  /** Storage column name. */
  readonly name: string;
  /** Generated local property name read from the state message. */
  readonly field: string;
}

/** Tenant and version metadata accepted when recording an entity state update. */
export interface StandUpdateOptions {
  /** Tenant slice for multitenant stands. */
  readonly tenantId?: string;
  /** Version associated with the updated state. */
  readonly version?: Version;
}

/** Tenant metadata accepted when reading one entity state. */
export interface StandReadOptions {
  /** Tenant slice for multitenant stands. */
  readonly tenantId?: string;
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
  readonly storages: Map<string, RecordStorage<unknown, Message>>;
  readonly subscribers: Set<Subscriber<Schema>>;
}

/** Direct read-side access point for storage-backed entity states and updates. */
export class Stand {
  readonly #context: StorageContext;
  readonly #storageFactory: StorageFactory;
  readonly #registrations = new Map<string, Registration>();

  constructor(options: StandOptions) {
    this.#context = cloneStorageContext(options.context);
    this.#storageFactory = options.storageFactory;
  }

  /** Register one known entity state schema. Re-registering the same schema is idempotent. */
  register(schema: MessageSchema, options: StandRegisterOptions = {}): void {
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
        storages: new Map<string, RecordStorage<unknown, Message>>(),
        subscribers: new Set<Subscriber>(),
      }),
    );
  }

  /** Type URLs of state schemas known to this Stand, in registration order. */
  stateTypes(): readonly string[] {
    return Object.freeze([...this.#registrations.keys()]);
  }

  /** Read the latest state for one entity ID. */
  async read<Schema extends MessageSchema>(
    schema: Schema,
    id: unknown,
    options: StandReadOptions = {},
  ): Promise<MessageShape<Schema> | undefined> {
    const registration = this.#registration(schema, "read");
    const stored = await this.#storage(registration, options.tenantId).read(id);

    return stored === undefined ? undefined : clone(schema, stored as MessageShape<Schema>);
  }

  /** Record one latest entity state and deliver an in-process update to matching subscribers. */
  async update<Schema extends MessageSchema>(
    schema: Schema,
    state: MessageShape<Schema>,
    options: StandUpdateOptions = {},
  ): Promise<void> {
    const registration = this.#registration(schema, "update");
    const tenantId = this.#tenantId(options.tenantId);
    const stateCopy = clone(schema, state);
    const id = readStateId(stateCopy, registration);

    await this.#storage(registration, tenantId).write(stateCopy);
    this.#notify(registration, {
      id,
      state: stateCopy,
      tenantId,
      version: options.version,
    });
  }

  /** Subscribe directly to in-process updates for one known state schema. */
  subscribe<Schema extends MessageSchema>(
    schema: Schema,
    callback: (update: StandUpdate<Schema>) => void,
    options: StandSubscribeOptions = {},
  ): StandSubscription {
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

  #registration<Schema extends MessageSchema>(
    schema: Schema,
    operation: string,
  ): Registration<Schema> {
    const typeUrl = deriveTypeUrl(schema);
    const registration = this.#registrations.get(typeUrl);
    if (registration === undefined) {
      throw new StandStateTypeError(typeUrl, operation);
    }

    return registration as Registration<Schema>;
  }

  #storage(
    registration: Registration,
    tenantId: string | undefined,
  ): RecordStorage<unknown, Message> {
    const key = this.#tenantKey(tenantId);
    let storage = registration.storages.get(key);

    if (storage === undefined) {
      storage = this.#storageFactory.createRecordStorage(
        this.#storageContext(tenantId),
        registration.recordSpec,
      );
      registration.storages.set(key, storage);
    }

    return storage;
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

    for (const subscriber of registration.subscribers) {
      if (subscriber.tenantKey !== tenantKey) {
        continue;
      }

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

  #storageContext(tenantId: string | undefined): StorageContext {
    return Object.freeze({
      ...this.#context,
      ...(tenantId === undefined ? {} : { tenantId }),
    });
  }
}

function createStandRecordSpec(
  schema: MessageSchema,
  idField: string,
  columns: readonly StandColumn[],
): RecordSpec<unknown, Message> {
  return new RecordSpec<unknown, Message>({
    schema,
    extractId: (record) =>
      readStateId(record, {
        idField,
        schema,
        typeUrl: deriveTypeUrl(schema),
      }),
    columns: columns.map(
      (column) => new RecordColumn(column.name, (record) => readRecordField(record, column.field)),
    ),
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

function cloneStorageContext(context: StorageContext): StorageContext {
  return Object.freeze({ ...context });
}

declare function structuredClone<T>(value: T): T;
