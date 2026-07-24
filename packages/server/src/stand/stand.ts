import { clone, create, type Message, type MessageShape } from "@bufbuild/protobuf";
import { deriveTypeUrl, type MessageSchema } from "@spine-event-engine/core";
import { VersionSchema, type Version } from "@spine-event-engine/proto";
import {
  RecordColumn,
  RecordMask,
  RecordSpec,
  QueryCandidateLimitError,
  StorageQueryEvaluator,
  StorageQueryPolicy,
  type NormalizedQueryPlan,
  type RecordQuery,
  type RecordStorage,
  type StorageContext,
} from "@spine-event-engine/storage";
import type { StorageFactory } from "@spine-event-engine/storage";
import type {
  EntityRecordStorage,
  EntityStorageInput,
} from "@spine-event-engine/storage/internal/entity-history";

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
 * Entity states remain queryable through the configured record store while the
 * shared entity-record seam durably owns their version and lifecycle metadata.
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
        const stored = await this.#openCurrent(registration, tenantId).read(id);
        if (stored === undefined || stored.deleted) {
          return undefined;
        }
        return this.#currentResult(registration, stored);
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
        const results = await Promise.all(
          stored.map((entry) => this.#readResult(registration, tenantId, entry.id, query.mask)),
        );
        return results.filter((result): result is StandReadResult<Schema> => result !== undefined);
      } finally {
        storage.close();
      }
    } finally {
      finish();
    }
  }

  /** Query latest states through the canonical normalized plan and retain versions. */
  async queryPlanVersioned<Schema extends MessageSchema>(
    schema: Schema,
    plan: NormalizedQueryPlan<unknown>,
    options: StandReadOptions = {},
  ): Promise<readonly StandReadResult<Schema>[]> {
    const finish = this.#beginOperation();
    try {
      const registration = this.#registration(schema, "read");
      const tenantId = this.#tenantId(options.tenantId);
      const storage = this.#openStorage(registration, tenantId);
      try {
        const stored = usesSystemPlan(plan)
          ? await this.#querySystemPlan(registration, storage, tenantId, plan)
          : await storage.queryPlanEntries(plan);
        const results = await Promise.all(
          stored.map((entry) =>
            this.#readResult(registration, tenantId, entry.id, plan.mask?.paths),
          ),
        );
        return results.filter((result): result is StandReadResult<Schema> => result !== undefined);
      } finally {
        storage.close();
      }
    } finally {
      finish();
    }
  }

  async #querySystemPlan(
    registration: Registration,
    storage: RecordStorage<unknown, Message>,
    tenantId: string | undefined,
    plan: NormalizedQueryPlan<unknown>,
  ): Promise<readonly { readonly id: unknown; readonly record: Message }[]> {
    StorageQueryPolicy.validate(plan, {
      comparisons: ["equal", "greaterThan", "lessThan", "greaterOrEqual", "lessOrEqual"],
      features: ["either", "nested", "order", "mask", "limit"],
    });
    const candidates = await storage.queryEntries(
      plan.candidateLimit === undefined ? {} : { limit: plan.candidateLimit + 1 },
    );
    if (plan.candidateLimit !== undefined && candidates.length > plan.candidateLimit) {
      throw new QueryCandidateLimitError(plan.candidateLimit);
    }
    const currentEntries = await Promise.all(
      candidates.map(async (entry) => ({
        id: entry.id,
        current: await this.#openCurrent(registration, tenantId).read(entry.id),
      })),
    );
    const entries = currentEntries.flatMap(({ id, current }) => {
      if (current === undefined || current.deleted) return [];
      const materialized = registration.recordSpec.materialize(current.state);
      return {
        id,
        record: materialized.record,
        columns: new Map([
          ...materialized.columns,
          ["version", create(VersionSchema, { number: Number(current.version) })],
          ["archived", current.archived],
          ["deleted", current.deleted],
        ]),
      };
    });
    return StorageQueryEvaluator.evaluate(entries, plan).map((entry) => ({
      id: entry.id,
      record: RecordMask.apply(registration.recordSpec.cloneRecord(entry.record), plan.mask?.paths),
    }));
  }

  /**
   * Clear all stored states and durable version metadata for one known state schema.
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
        const current = this.#openCurrent(registration, tenantId);
        for (const id of ids) {
          const state = await storage.read(id);
          if (state !== undefined) {
            const stored = await current.read(id);
            await current.write({
              id,
              state,
              version: stored?.version ?? 0n,
              archived: stored?.archived ?? false,
              deleted: true,
            });
          }
          await storage.delete(id);
        }
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
      let previousState: MessageShape<Schema> | undefined;
      const previousStateObservable = this.#hasTenantSubscribers(registration, tenantId);

      try {
        const current = this.#openCurrent(registration, tenantId);
        if (previousStateObservable) {
          previousState = (await storage.read(id)) as MessageShape<Schema> | undefined;
        }
        // The query index is deliberately a temporary first write. A later
        // current-record failure leaves only a non-authoritative index row;
        // all reads resolve through current and therefore filter it out.
        await storage.write(stateCopy);
        await current.write({
          id,
          state: stateCopy,
          version: BigInt(options.version?.number ?? 0),
          archived: options.lifecycle?.archived ?? false,
          deleted: options.lifecycle?.deleted ?? false,
        });
      } finally {
        storage.close();
      }
      this.#notify(registration, {
        id,
        previousState,
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

  #openCurrent(
    registration: Registration,
    tenantId: string | undefined,
  ): EntityRecordStorage<unknown, Message> {
    const key = `${registration.typeUrl}\u0000${tenantId ?? ""}`;
    const existing = this.#entityHandles.get(key);
    if (existing !== undefined) return existing.current;
    const handle = openEntityStorage(this.#storageFactory, {
      context: this.#storageContext(tenantId),
      id: {
        clone: (id) => structuredClone(id),
        fingerprint: `${registration.schema.typeName}:stand-id:v1`,
        key: idKey,
      },
      layout: "spine-ts.stand.entity-record.v1",
      stateSchema: registration.schema,
      storageKey: `${registration.schema.typeName}:stand`,
    });
    this.#entityHandles.set(key, handle);
    return handle.current;
  }

  async #readResult<Schema extends MessageSchema>(
    registration: Registration<Schema>,
    tenantId: string | undefined,
    idOverride?: unknown,
    maskPaths?: readonly string[],
  ): Promise<StandReadResult<Schema> | undefined> {
    const id = idOverride;
    if (id === undefined) return undefined;
    const current = await this.#openCurrent(registration, tenantId).read(id);
    if (current === undefined || current.deleted) return undefined;
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
    if (current.deleted) return undefined;
    const version =
      current.version === 0n
        ? undefined
        : create(VersionSchema, { number: Number(current.version) });
    return Object.freeze({
      state: clone(registration.schema, current.state as MessageShape<Schema>),
      ...(version === undefined ? {} : { version: clone(VersionSchema, version) }),
    });
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
  ): void {
    const errors: unknown[] = [];
    const tenantKey = this.#tenantKey(input.tenantId);
    const subscribers = this.#tenantSubscribers(registration, tenantKey);

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
}

function createStandRecordSpec(
  schema: MessageSchema,
  idField: string,
  columns: readonly RecordColumn<Message>[],
): RecordSpec<unknown, Message> {
  return new RecordSpec<unknown, Message>({
    schema,
    storageKey: `${schema.typeName}:current`,
    idKind: "string",
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
    readonly previousState: MessageShape<Schema> | undefined;
    readonly state: MessageShape<Schema>;
    readonly tenantId: string | undefined;
    readonly version: Version | undefined;
  },
): StandUpdate<Schema> {
  const version = input.version === undefined ? undefined : clone(VersionSchema, input.version);

  return Object.freeze({
    typeUrl: registration.typeUrl,
    id: cloneValue(input.id),
    ...(input.previousState === undefined
      ? {}
      : { previousState: clone(registration.schema, input.previousState) }),
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

function usesSystemPlan(plan: NormalizedQueryPlan<unknown>): boolean {
  if (plan.order?.some((order) => isSystemColumn(order.column)) === true) return true;
  const pending = plan.predicate === undefined ? [] : [plan.predicate];
  while (pending.length > 0) {
    const predicate = pending.pop();
    if (predicate === undefined) break;
    if (predicate.kind === "comparison" && isSystemColumn(predicate.column)) return true;
    if (predicate.kind === "all" || predicate.kind === "either") {
      pending.push(...predicate.predicates);
    }
  }
  return false;
}

function isSystemColumn(column: string): boolean {
  return column === "version" || column === "archived" || column === "deleted";
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

interface EntityStorageFactory {
  createEntityStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): {
    readonly current: EntityRecordStorage<I, S>;
    close(): void;
  };
}

function openEntityStorage<I, S extends Message>(
  factory: StorageFactory,
  input: EntityStorageInput<I, S>,
): { readonly current: EntityRecordStorage<I, S>; close(): void } {
  const candidate = factory as StorageFactory & Partial<EntityStorageFactory>;
  if (candidate.createEntityStorage === undefined) {
    throw new Error("StorageFactory does not provide the required entity-record storage seam.");
  }
  return candidate.createEntityStorage(input);
}

function cloneStorageContext(context: StorageContext): StorageContext {
  return Object.freeze({ ...context });
}

declare function structuredClone<T>(value: T): T;
