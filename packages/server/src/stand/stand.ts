import { clone, create, type Message, type MessageShape } from "@bufbuild/protobuf";
import { type MessageSchema, TypeUrls } from "@spine-event-engine/core";
import { VersionSchema, type Version } from "@spine-event-engine/proto";
import {
  RecordColumn,
  RecordMask,
  RecordQuery,
  type NormalizedQueryPlan,
  type StorageContext,
} from "@spine-event-engine/storage";
import type { StorageFactory } from "@spine-event-engine/storage";
import type {
  EntityRecordStorage,
  EntityStorageInput,
} from "@spine-event-engine/storage/internal/entity-history";
import { entityStorageDescriptor } from "../entity/entity-storage-descriptor.js";

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
  /** Version persisted with the updated state. */
  readonly version?: Version;
  /** Durable entity lifecycle. Internal repository callers supply this from the entity transaction. */
  readonly lifecycle?: { readonly archived: boolean; readonly deleted: boolean };
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
  /** Durable version supplied with the latest update. */
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
  /**
   * Cloned snapshot of the stored state before this update.
   *
   * Omitted when no previous state existed. Safe for subscribers to retain or
   * mutate after delivery.
   */
  readonly previousState?: MessageShape<Schema>;
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
  /** Stops future deliveries. Safe to call more than once. */
  unsubscribe(): void;
}

/** Error thrown when direct Stand access targets an unregistered state type. */
export class StandStateTypeError extends Error {
  /** Rejected state type URL. */
  readonly typeUrl: string;
  /** Stand operation that required a known state type. */
  readonly operation: string;

  /** Creates an error for an operation targeting an unknown state type.
   *
   * @param typeUrl - The rejected state type URL.
   * @param operation - The operation requiring a registered state type.
   */
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
  readonly columns: readonly RecordColumn<Message>[];
  readonly subscribers: Set<Subscriber<Schema>>;
}

/**
 * Direct read-side access point for storage-backed entity states and updates.
 *
 * Entity states are queried through the shared durable current-record seam.
 */
export class Stand {
  readonly #context: StorageContext;
  readonly #storageFactory: StorageFactory;
  readonly #registrations = new Map<string, Registration>();
  readonly #entityHandles = new Map<
    string,
    { readonly current: EntityRecordStorage<unknown, Message>; close(): void }
  >();
  readonly #inFlight = new Set<Promise<void>>();
  #closing = false;
  #closed = false;
  #closedPromise: Promise<void> | undefined;

  /** Creates a direct read-side Stand.
   *
   * @param options - The storage context and factory used for state records.
   */
  constructor(options: StandOptions) {
    this.#context = Stand.#cloneContext(options.context);
    this.#storageFactory = options.storageFactory;
    deferredUpdates.set(this, (schema, state, updateOptions) =>
      this.#deferUpdate(schema, state, updateOptions),
    );
    currentReads.set(this, (schema, id, readOptions) => this.#readCurrent(schema, id, readOptions));
  }

  /** Registers one entity state schema. Re-registering the same schema is idempotent.
   *
   * @param schema - The entity state schema to register.
   * @param options - The ID field and materialized columns for the state type.
   */
  register(schema: MessageSchema, options: StandRegisterOptions = {}): void {
    this.#requireOpen();
    const typeUrl = TypeUrls.derive(schema);
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
        columns:
          options.columns ??
          schema.fields.map(
            (field) =>
              new RecordColumn(
                field.localName,
                (state) => (state as Record<string, unknown>)[field.localName],
                "protobuf",
              ),
          ),
        subscribers: new Set<Subscriber>(),
      }),
    );
  }

  /** Returns known state type URLs in registration order.
   *
   * @returns The registered state type URLs.
   */
  stateTypes(): readonly string[] {
    this.#requireOpen();
    return Object.freeze([...this.#registrations.keys()]);
  }

  /** Reads the latest state for one entity ID.
   *
   * @param schema - The registered entity state schema.
   * @param id - The entity ID to read.
   * @param options - The tenant slice to read.
   * @returns The latest state, or undefined when no live record exists.
   */
  async read<Schema extends MessageSchema>(
    schema: Schema,
    id: unknown,
    options: StandReadOptions = {},
  ): Promise<MessageShape<Schema> | undefined> {
    const result = await this.readVersioned(schema, id, options);

    return result?.state;
  }

  /** Reads the latest state and its supplied version metadata for one entity ID.
   *
   * @param schema - The registered entity state schema.
   * @param id - The entity ID to read.
   * @param options - The tenant slice to read.
   * @returns The current state and version, or undefined when no live record exists.
   */
  async readVersioned<Schema extends MessageSchema>(
    schema: Schema,
    id: unknown,
    options: StandReadOptions = {},
  ): Promise<StandReadResult<Schema> | undefined> {
    const finish = this.#beginOperation();

    try {
      const registration = this.#registration(schema, "read");
      const tenantId = this.#tenantId(options.tenantId);
      {
        const stored = await this.#openCurrent(registration, tenantId).read(id);
        if (stored === undefined || stored.deleted) {
          return undefined;
        }
        return this.#currentResult(registration, stored);
      }
    } finally {
      finish();
    }
  }

  /** Reads all latest states and version metadata in storage query order.
   *
   * @param schema - The registered entity state schema.
   * @param options - The tenant slice to read.
   * @returns The current states and versions in query order.
   */
  async readAllVersioned<Schema extends MessageSchema>(
    schema: Schema,
    options: StandReadOptions = {},
  ): Promise<readonly StandReadResult<Schema>[]> {
    return this.queryVersioned(schema, {}, options);
  }

  /** Finds latest states and version metadata in storage query order.
   *
   * @param schema - The registered entity state schema.
   * @param query - The legacy record query to apply.
   * @param options - The tenant slice to read.
   * @returns The matching current states and versions.
   */
  async queryVersioned<Schema extends MessageSchema>(
    schema: Schema,
    query: RecordQuery<unknown> = {},
    options: StandReadOptions = {},
  ): Promise<readonly StandReadResult<Schema>[]> {
    const finish = this.#beginOperation();

    try {
      const registration = this.#registration(schema, "read");
      const tenantId = this.#tenantId(options.tenantId);
      {
        const stored = await this.#openCurrent(registration, tenantId).query(
          Stand.#legacyPlan(query),
        );
        const results = stored.map((entry) =>
          this.#entryResult(registration, entry.record, query.mask),
        );
        return results.filter((result): result is StandReadResult<Schema> => result !== undefined);
      }
    } finally {
      finish();
    }
  }

  /** Finds latest states through a normalized plan and retains versions.
   *
   * @param schema - The registered entity state schema.
   * @param plan - The normalized storage query plan to apply.
   * @param options - The tenant slice to read.
   * @returns The matching current states and versions.
   */
  async queryPlanVersioned<Schema extends MessageSchema>(
    schema: Schema,
    plan: NormalizedQueryPlan<unknown>,
    options: StandReadOptions = {},
  ): Promise<readonly StandReadResult<Schema>[]> {
    const finish = this.#beginOperation();
    try {
      const registration = this.#registration(schema, "read");
      const tenantId = this.#tenantId(options.tenantId);
      {
        const stored = await this.#openCurrent(registration, tenantId).query(
          Stand.#normalizePlan(plan),
        );
        const results = stored.map((entry) =>
          this.#entryResult(registration, entry.record, plan.mask?.paths),
        );
        return results.filter((result): result is StandReadResult<Schema> => result !== undefined);
      }
    } finally {
      finish();
    }
  }

  /**
   * Clears all stored states and durable version metadata for one known state schema.
   *
   * `BoundedContext.catchUpReadSide()` uses this to reset one projection state
   * type before replay for the selected tenant slice.
   *
   * @param schema - The registered entity state schema to clear.
   * @param options - The tenant slice to clear.
   * @returns The number of state records marked deleted.
   */
  async clear(schema: MessageSchema, options: StandReadOptions = {}): Promise<number> {
    const finish = this.#beginOperation();

    try {
      const registration = this.#registration(schema, "clear");
      const tenantId = this.#tenantId(options.tenantId);
      {
        const entries = await this.#openCurrent(registration, tenantId).query({
          candidateLimit: 10_000,
        });
        const ids = entries.map((entry) => entry.id);
        const current = this.#openCurrent(registration, tenantId);
        for (const id of ids) {
          const stored = await current.read(id);
          if (stored !== undefined) await current.write({ ...stored, deleted: true });
        }
        return ids.length;
      }
    } finally {
      finish();
    }
  }

  /** Records one latest entity state and delivers an update to matching subscribers.
   *
   * @param schema - The registered entity state schema.
   * @param state - The latest entity state to store.
   * @param options - The tenant, version, and lifecycle metadata to store.
   * @returns A promise that resolves after the state update is stored.
   */
  async update<Schema extends MessageSchema>(
    schema: Schema,
    state: MessageShape<Schema>,
    options: StandUpdateOptions = {},
  ): Promise<void> {
    const deferred = await standAccess.deferUpdate(this, schema, state, options);
    deferred.notify();
  }

  async #deferUpdate<Schema extends MessageSchema>(
    schema: Schema,
    state: MessageShape<Schema>,
    options: StandUpdateOptions,
  ): Promise<DeferredStandUpdate> {
    const finish = this.#beginOperation();
    try {
      const registration = this.#registration(schema, "update");
      const tenantId = this.#tenantId(options.tenantId);
      const stateCopy = clone(schema, state);
      const id = Stand.#readStateId(stateCopy, registration);
      const previousState = this.#hasTenantSubscribers(registration, tenantId)
        ? ((await this.#openCurrent(registration, tenantId).read(id))?.state as
            MessageShape<Schema> | undefined)
        : undefined;
      const subscribers = [...this.#tenantSubscribers(registration, this.#tenantKey(tenantId))];
      await this.#openCurrent(registration, tenantId).write({
        id,
        state: stateCopy,
        version: BigInt(options.version?.number ?? 0),
        archived: options.lifecycle?.archived ?? false,
        deleted: options.lifecycle?.deleted ?? false,
      });
      let settled = false;
      const settle = () => {
        if (!settled) {
          settled = true;
          finish();
        }
      };
      return Object.freeze({
        cancel: settle,
        notify: () => {
          try {
            this.#notify(
              registration,
              {
                id,
                previousState,
                state: stateCopy,
                tenantId,
                version: options.version,
              },
              subscribers,
            );
          } finally {
            settle();
          }
        },
      });
    } catch (error) {
      finish();
      throw error;
    }
  }

  /** Repository-only full current-record read, including lifecycle metadata. */
  async #readCurrent<Schema extends MessageSchema>(
    schema: Schema,
    id: unknown,
    options: StandReadOptions,
  ): Promise<StandCurrentRecord<Schema> | undefined> {
    const finish = this.#beginOperation();
    try {
      const registration = this.#registration(schema, "read");
      const tenantId = this.#tenantId(options.tenantId);
      const stored = await this.#openCurrent(registration, tenantId).read(id);
      if (stored === undefined) return undefined;
      return Object.freeze({
        state: clone(schema, stored.state as MessageShape<Schema>),
        version: stored.version,
        archived: stored.archived,
        deleted: stored.deleted,
      });
    } finally {
      finish();
    }
  }

  /** Subscribes to in-process updates for one registered state schema.
   *
   * @param schema - The registered entity state schema.
   * @param callback - The function receiving matching state updates.
   * @param options - The tenant slice to subscribe to.
   * @returns A handle that stops future callback delivery.
   */
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
   * Closes direct subscriptions and rejects later Stand operations.
   *
   * Close is idempotent. New operations are rejected once close begins, and the
   * close promise waits for already accepted direct reads/updates to finish
   * before clearing subscriptions and version metadata.
   * @returns A promise that settles after the stand closes.
   *
   */
  close(): Promise<void> {
    this.#closedPromise ??= this.#closeOnce();
    return this.#closedPromise;
  }

  async #closeOnce(): Promise<void> {
    this.#closing = true;
    await Promise.all([...this.#inFlight]);
    for (const registration of this.#registrations.values()) {
      registration.subscribers.clear();
    }
    for (const handle of this.#entityHandles.values()) {
      handle.close();
    }
    this.#entityHandles.clear();
    this.#closed = true;
  }

  #registration<Schema extends MessageSchema>(
    schema: Schema,
    operation: string,
  ): Registration<Schema> {
    this.#requireOpen();
    const typeUrl = TypeUrls.derive(schema);
    const registration = this.#registrations.get(typeUrl);
    if (registration === undefined) {
      throw new StandStateTypeError(typeUrl, operation);
    }

    return registration as Registration<Schema>;
  }

  #openCurrent(
    registration: Registration,
    tenantId: string | undefined,
  ): EntityRecordStorage<unknown, Message> {
    const key = `${registration.typeUrl}\u0000${tenantId ?? ""}`;
    const existing = this.#entityHandles.get(key);
    if (existing !== undefined) return existing.current;
    const handle = Stand.#openStorage(
      this.#storageFactory,
      entityStorageDescriptor(
        this.#storageContext(tenantId),
        registration.schema,
        registration.idField,
        registration.columns,
      ),
    );
    this.#entityHandles.set(key, handle);
    return handle.current;
  }

  #entryResult<Schema extends MessageSchema>(
    registration: Registration<Schema>,
    current: { readonly state: Message; readonly version: bigint; readonly deleted: boolean },
    maskPaths?: readonly string[],
  ): StandReadResult<Schema> | undefined {
    if (current.deleted) return undefined;
    const version =
      current.version === 0n
        ? undefined
        : create(VersionSchema, { number: Number(current.version) });

    return Object.freeze({
      state: Object.assign(
        create(registration.schema),
        RecordMask.apply(
          clone(registration.schema, current.state as MessageShape<Schema>),
          maskPaths,
        ),
      ),
      ...(version === undefined ? {} : { version: clone(VersionSchema, version) }),
    });
  }

  #currentResult<Schema extends MessageSchema>(
    registration: Registration<Schema>,
    current: { readonly state: Message; readonly version: bigint; readonly deleted: boolean },
  ): StandReadResult<Schema> | undefined {
    return this.#entryResult(registration, current);
  }

  #notify<Schema extends MessageSchema>(
    registration: Registration<Schema>,
    input: {
      readonly id: unknown;
      readonly previousState: MessageShape<Schema> | undefined;
      readonly state: MessageShape<Schema>;
      readonly tenantId: string | undefined;
      readonly version: Version | undefined;
    },
    captured?: readonly Subscriber<Schema>[],
  ): void {
    const errors: unknown[] = [];
    const tenantKey = this.#tenantKey(input.tenantId);
    const subscribers = captured ?? this.#tenantSubscribers(registration, tenantKey);

    for (const subscriber of subscribers) {
      try {
        subscriber.callback(Stand.#createUpdate(registration, input));
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

  #hasTenantSubscribers(registration: Registration, tenantId: string | undefined): boolean {
    const tenantKey = this.#tenantKey(tenantId);

    for (const subscriber of registration.subscribers) {
      if (subscriber.tenantKey === tenantKey) {
        return true;
      }
    }

    return false;
  }

  #tenantSubscribers<Schema extends MessageSchema>(
    registration: Registration<Schema>,
    tenantKey: string,
  ): Subscriber<Schema>[] {
    return [...registration.subscribers].filter((subscriber) => subscriber.tenantKey === tenantKey);
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

  static #createUpdate<Schema extends MessageSchema>(
    registration: Registration<Schema>,
    input: {
      readonly id: unknown;
      readonly previousState: MessageShape<Schema> | undefined;
      readonly state: MessageShape<Schema>;
      readonly tenantId: string | undefined;
      readonly version: Version | undefined;
    },
  ): StandUpdate<Schema> {
    const version = input.version === undefined ? undefined : clone(VersionSchema, input.version);
    return Object.freeze({
      typeUrl: registration.typeUrl,
      id: Stand.#cloneValue(input.id),
      ...(input.previousState === undefined
        ? {}
        : { previousState: clone(registration.schema, input.previousState) }),
      state: clone(registration.schema, input.state),
      ...(version === undefined ? {} : { version }),
      ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
    });
  }

  static #readStateId(
    state: Message,
    registration: Pick<Registration, "schema" | "typeUrl" | "idField">,
  ): unknown {
    const id = (state as Record<string, unknown>)[registration.idField];
    if (id === undefined || id === null) {
      throw new Error(`Stand state "${registration.schema.typeName}" requires ID field.`);
    }
    return id;
  }

  static #cloneValue(value: unknown): unknown {
    return typeof value === "object" && value !== null ? globalThis.structuredClone(value) : value;
  }

  static #legacyPlan(query: RecordQuery<unknown>): NormalizedQueryPlan<unknown> {
    RecordQuery.validate(query);
    if (query.after !== undefined) {
      throw new Error("Stand query continuations require the normalized entity query API.");
    }
    const predicates = [
      ...(query.ids === undefined ? [] : [{ kind: "ids" as const, ids: query.ids }]),
      ...(query.filters ?? []).map((filter) => ({
        kind: "comparison" as const,
        column: filter.column,
        operator: "equal" as const,
        value: filter.value,
      })),
    ];
    return {
      ...(predicates.length === 0
        ? {}
        : {
            predicate:
              predicates.length === 1 ? predicates[0] : { kind: "all" as const, predicates },
          }),
      ...(query.sort === undefined
        ? {}
        : {
            order: query.sort
              .map((sort) => ({ field: sort.field, direction: sort.direction ?? "asc" }))
              .map(({ field, direction }) => ({ column: field, direction })),
          }),
      ...(query.mask === undefined ? {} : { mask: { paths: query.mask } }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      candidateLimit: 10_000,
    };
  }

  static #normalizePlan(plan: NormalizedQueryPlan<unknown>): NormalizedQueryPlan<unknown> {
    const normalize = (
      predicate: NonNullable<NormalizedQueryPlan<unknown>["predicate"]>,
    ): NonNullable<NormalizedQueryPlan<unknown>["predicate"]> => {
      if (predicate.kind === "comparison" && predicate.column === "version") {
        const value = predicate.value;
        return typeof value === "object" &&
          value !== null &&
          "number" in value &&
          typeof value.number === "number"
          ? { ...predicate, value: BigInt(value.number) }
          : predicate;
      }
      if (predicate.kind === "all" || predicate.kind === "either") {
        return { ...predicate, predicates: predicate.predicates.map(normalize) };
      }
      return predicate;
    };
    return plan.predicate === undefined ? plan : { ...plan, predicate: normalize(plan.predicate) };
  }

  static #openStorage<I, S extends Message>(
    factory: StorageFactory,
    input: EntityStorageInput<I, S>,
  ): { readonly current: EntityRecordStorage<I, S>; close(): void } {
    const candidate = factory as StorageFactory & Partial<EntityStorageFactory>;
    if (candidate.createEntityStorage === undefined) {
      throw new Error("StorageFactory does not provide the required entity-record storage seam.");
    }
    return candidate.createEntityStorage(input);
  }

  static #cloneContext(context: StorageContext): StorageContext {
    return Object.freeze({ ...context });
  }
}

interface EntityStorageFactory {
  createEntityStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): {
    readonly current: EntityRecordStorage<I, S>;
    close(): void;
  };
}

interface DeferredStandUpdate {
  notify(): void;
  cancel(): void;
}

interface StandCurrentRecord<Schema extends MessageSchema> {
  readonly state: MessageShape<Schema>;
  readonly version: bigint;
  readonly archived: boolean;
  readonly deleted: boolean;
}

interface StandAccess {
  readCurrent<Schema extends MessageSchema>(
    stand: Stand,
    schema: Schema,
    id: unknown,
    options: StandReadOptions,
  ): Promise<StandCurrentRecord<Schema> | undefined>;
  deferUpdate<Schema extends MessageSchema>(
    stand: Stand,
    schema: Schema,
    state: MessageShape<Schema>,
    options: StandUpdateOptions,
  ): Promise<DeferredStandUpdate>;
}

/**
 * Defines the repository-only persistence seam that defers subscriber delivery.
 *
 * @internal
 */
export const standAccess: StandAccess = Object.freeze({
  readCurrent<Schema extends MessageSchema>(
    stand: Stand,
    schema: Schema,
    id: unknown,
    options: StandReadOptions,
  ): Promise<StandCurrentRecord<Schema> | undefined> {
    const read = currentReads.get(stand);
    if (read === undefined) throw new TypeError("Stand current read requires a Stand instance.");
    return read(schema, id, options);
  },
  deferUpdate<Schema extends MessageSchema>(
    stand: Stand,
    schema: Schema,
    state: MessageShape<Schema>,
    options: StandUpdateOptions,
  ): Promise<DeferredStandUpdate> {
    const deferred = deferredUpdates.get(stand);
    if (deferred === undefined)
      throw new TypeError("Stand deferred update requires a Stand instance.");
    return deferred(schema, state, options);
  },
});

const deferredUpdates = new WeakMap<
  Stand,
  <Schema extends MessageSchema>(
    schema: Schema,
    state: MessageShape<Schema>,
    options: StandUpdateOptions,
  ) => Promise<DeferredStandUpdate>
>();

const currentReads = new WeakMap<
  Stand,
  <Schema extends MessageSchema>(
    schema: Schema,
    id: unknown,
    options: StandReadOptions,
  ) => Promise<StandCurrentRecord<Schema> | undefined>
>();
