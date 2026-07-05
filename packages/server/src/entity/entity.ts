import { fromBinary, toBinary, type MessageShape } from "@bufbuild/protobuf";

import {
  describeEntityMetadata,
  type DescriptorMessageSchema,
  type EntityMetadata,
} from "./entity-metadata.js";
import {
  EntityTransaction,
  type EntityTransactionCommitResult,
  type EntityTransactionLifecycleFlags,
  type EntityTransactionRejectedCommit,
  type EntityTransactionRollbackResult,
  type EntityTransactionUpdater,
  type EntityTransactionVersionMetadata,
} from "./entity-transaction.js";

/** Lifecycle flags carried by a common entity shell. */
export interface EntityLifecycleFlags {
  /** Whether the entity is archived. */
  readonly archived: boolean;
  /** Whether the entity is deleted. */
  readonly deleted: boolean;
}

/** Reason a {@link TransactionalEntity} transaction-scope operation failed. */
export type TransactionalEntityScopeErrorReason = "duplicate" | "missing";

/** Protected {@link TransactionalEntity} operation guarded by transaction scope. */
export type TransactionalEntityScopeOperation =
  | "archiveDraft"
  | "commitTransaction"
  | "currentDraft"
  | "draftLifecycleFlags"
  | "draftVersionMetadata"
  | "markDraftDeleted"
  | "restoreDraft"
  | "rollbackTransaction"
  | "startTransaction"
  | "unarchiveDraft"
  | "updateDraftState"
  | "updateDraftVersionMetadata";

/** Error thrown when a transactional entity draft helper is used outside its scope. */
export class TransactionalEntityScopeError extends Error {
  /** Scope failure reason. */
  readonly reason: TransactionalEntityScopeErrorReason;

  /** Operation rejected by the current transaction scope. */
  readonly operation: TransactionalEntityScopeOperation;

  /** Create a deterministic transaction-scope error. */
  constructor(
    reason: TransactionalEntityScopeErrorReason,
    operation: TransactionalEntityScopeOperation,
  ) {
    super(
      reason === "duplicate"
        ? `Cannot ${operation}: transactional entity already has an active transaction.`
        : `Cannot ${operation}: transactional entity requires an active transaction.`,
    );
    this.name = "TransactionalEntityScopeError";
    this.reason = reason;
    this.operation = operation;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

type EntityVersionMetadataPrimitive =
  string | number | boolean | bigint | symbol | null | undefined;

/** Plain snapshot data accepted as caller-owned entity version metadata. */
export type EntityVersionMetadata =
  EntityVersionMetadataPrimitive | readonly EntityVersionMetadata[] | object;

type NonPlainEntityVersionMetadata =
  | Date
  | RegExp
  | Error
  | Promise<unknown>
  | Map<unknown, unknown>
  | Set<unknown>
  | WeakMap<object, unknown>
  | WeakSet<object>
  | ArrayBuffer
  | SharedArrayBuffer
  | DataView
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

/** Recursive type-level validator for caller-owned plain entity version metadata. */
export type PlainEntityVersionMetadata<Version> = PlainEntityVersionMetadataAtDepth<Version, []>;

type PlainEntityVersionMetadataAtDepth<
  Version,
  Depth extends readonly unknown[],
> = Depth["length"] extends 20
  ? EntityVersionMetadata
  : Version extends EntityVersionMetadataPrimitive
    ? Version
    : Version extends (...args: never[]) => unknown
      ? never
      : Version extends NonPlainEntityVersionMetadata
        ? never
        : Version extends readonly (infer Element)[]
          ? readonly PlainEntityVersionMetadataAtDepth<Element, readonly [unknown, ...Depth]>[]
          : Version extends object
            ? {
                readonly [Key in keyof Version]: PlainEntityVersionMetadataAtDepth<
                  Version[Key],
                  readonly [unknown, ...Depth]
                >;
              }
            : never;

type EntityVersionMetadataInput<Version> = [Version] extends [EntityVersionMetadata]
  ? [EntityVersionMetadata] extends [Version]
    ? Version
    : PlainEntityVersionMetadata<Version>
  : PlainEntityVersionMetadata<Version>;

declare const process: {
  readonly getBuiltinModule: (specifier: "node:util") => {
    readonly types: {
      readonly isProxy: (value: object) => boolean;
    };
  };
};

const isProxy = process.getBuiltinModule("node:util").types.isProxy;

/** Initial values for constructing an {@link Entity}. */
export interface EntityOptions<
  Id,
  Schema extends DescriptorMessageSchema,
  Version = EntityVersionMetadata,
> {
  /** Stable entity identifier owned by the caller/domain type. */
  readonly id: Id;
  /** Generated Protobuf-ES schema describing the entity state. */
  readonly schema: Schema;
  /** Initial entity state snapshot. */
  readonly state: MessageShape<Schema>;
  /** Caller-owned plain version metadata snapshot. */
  readonly version: EntityVersionMetadataInput<Version>;
  /** Initial lifecycle flags. Defaults to active, not deleted. */
  readonly lifecycle?: Partial<EntityLifecycleFlags>;
}

/** Public entity family marker exposed by Spine server entity base classes. */
export type EntityFamily = "aggregate" | "projection" | "process-manager";

/**
 * Common in-memory OOP shell for one server-side entity state.
 *
 * The shell exposes identity, descriptor-derived metadata, cloned state
 * snapshots, caller-owned plain version metadata snapshots, and lifecycle flags. It does not
 * invoke handlers, create transactions, write repositories or storage, dispatch
 * messages, increment versions, route IDs, query read models, start buses, or
 * mutate process-wide runtime state.
 */
export abstract class Entity<
  Id,
  Schema extends DescriptorMessageSchema,
  Version = EntityVersionMetadata,
> {
  /** @hidden */
  declare protected static readonly spineTsEntityConstructor: true;

  readonly #id: Id;
  readonly #schema: Schema;
  readonly #metadata: EntityMetadata<Schema>;
  #state: MessageShape<Schema>;
  #version: Version;
  #lifecycle: EntityLifecycleFlags;
  #lifecycleFlagsChanged = false;

  /** Create an entity shell from caller-provided state and metadata inputs. */
  constructor(options: EntityOptions<Id, Schema, Version>) {
    this.#id = options.id;
    this.#schema = options.schema;
    this.#metadata = describeEntityMetadata(options.schema);
    this.#state = cloneState(options.schema, options.state);
    this.#version = cloneVersionMetadata(options.version) as Version;
    this.#lifecycle = {
      archived: options.lifecycle?.archived ?? false,
      deleted: options.lifecycle?.deleted ?? false,
    };
  }

  /** Stable entity identifier. */
  get id(): Id {
    return this.#id;
  }

  /** Generated Protobuf-ES schema describing this entity's state. */
  get schema(): Schema {
    return this.#schema;
  }

  /** Descriptor-derived metadata for this entity's state schema. */
  get metadata(): EntityMetadata<Schema> {
    return this.#metadata;
  }

  /** Current entity state snapshot. */
  get state(): MessageShape<Schema> {
    return cloneState(this.#schema, this.#state);
  }

  /** Caller-owned plain version metadata snapshot. */
  get version(): Version {
    return cloneVersionMetadata(this.#version);
  }

  /** Current lifecycle flag snapshot. */
  get lifecycle(): EntityLifecycleFlags {
    return {
      archived: this.#lifecycle.archived,
      deleted: this.#lifecycle.deleted,
    };
  }

  /** Whether the entity is archived. */
  get isArchived(): boolean {
    return this.#lifecycle.archived;
  }

  /** Whether the entity is deleted. */
  get isDeleted(): boolean {
    return this.#lifecycle.deleted;
  }

  /** Whether neither lifecycle flag marks the entity inactive. */
  get isActive(): boolean {
    return !this.isArchived && !this.isDeleted;
  }

  /** Whether lifecycle flags changed after construction. */
  get lifecycleFlagsChanged(): boolean {
    return this.#lifecycleFlagsChanged;
  }

  /** Replace stored state from future subclass/runtime code. */
  protected replaceState(state: MessageShape<Schema>): void {
    this.#state = cloneState(this.#schema, state);
  }

  /** Replace caller-owned plain version metadata from future subclass/runtime code. */
  protected replaceVersionMetadata(version: EntityVersionMetadataInput<Version>): void {
    this.#version = cloneVersionMetadata(version) as Version;
  }

  /** Replace lifecycle flags from future subclass/runtime code. */
  protected replaceLifecycleFlags(lifecycle: Partial<EntityLifecycleFlags>): void {
    const next = {
      archived: lifecycle.archived ?? this.#lifecycle.archived,
      deleted: lifecycle.deleted ?? this.#lifecycle.deleted,
    };

    if (next.archived !== this.#lifecycle.archived || next.deleted !== this.#lifecycle.deleted) {
      this.#lifecycle = next;
      this.#lifecycleFlagsChanged = true;
    }
  }
}

/**
 * Common in-memory entity shell with a protected scoped transaction draft.
 *
 * The transaction scope is backed by {@link EntityTransaction}. Subclasses can
 * start one active draft, mutate draft state/version/lifecycle through protected
 * helpers, and then commit or roll back the scope. Accepted commits replace this
 * entity's in-memory state, explicit version metadata, and lifecycle flags.
 * Rejected commits leave the transaction active so subclass code can correct the
 * draft or roll it back explicitly. This base does not write repositories,
 * emit events, dispatch handlers, increment versions, or manage global
 * transaction state.
 */
export abstract class TransactionalEntity<
  Id,
  Schema extends DescriptorMessageSchema,
  Version = EntityVersionMetadata,
> extends Entity<Id, Schema, Version> {
  #transaction: EntityTransaction<Schema, Version> | undefined;
  #lastRejectedCommit: EntityTransactionRejectedCommit<Schema, Version> | undefined;
  #stateChanged = false;

  /** Whether accepted transaction state changes or lifecycle flag changes are visible. */
  get changed(): boolean {
    return this.#stateChanged || this.lifecycleFlagsChanged;
  }

  /** Whether a protected transaction scope is currently active. */
  protected isTransactionInProgress(): boolean {
    return this.#transaction?.status === "active";
  }

  /**
   * Start a protected draft transaction from the entity's current snapshots.
   *
   * @throws {@link TransactionalEntityScopeError} when another transaction is active.
   */
  protected startTransaction(): void {
    if (this.isTransactionInProgress()) {
      throw new TransactionalEntityScopeError("duplicate", "startTransaction");
    }

    this.#lastRejectedCommit = undefined;
    const previousVersion = this.version;
    this.#transaction = new EntityTransaction({
      schema: this.schema,
      previous: this.state,
      version: {
        previous: previousVersion,
        draft: cloneVersionMetadata(previousVersion),
      },
      lifecycle: this.lifecycle,
    });
  }

  /**
   * Current draft state snapshot.
   *
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected currentDraft(): MessageShape<Schema> {
    return this.#requireTransaction("currentDraft").currentDraft;
  }

  /**
   * Current draft version metadata snapshot.
   *
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected draftVersionMetadata(): EntityTransactionVersionMetadata<Version> {
    const version = this.#requireTransaction("draftVersionMetadata").version;

    return {
      previous: cloneVersionMetadata(version.previous),
      draft: cloneVersionMetadata(version.draft),
    };
  }

  /**
   * Current draft lifecycle flag snapshot.
   *
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected draftLifecycleFlags(): EntityTransactionLifecycleFlags {
    return this.#requireTransaction("draftLifecycleFlags").lifecycle;
  }

  /**
   * Replace the buffered draft state with the updater result.
   *
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected updateDraftState(updater: EntityTransactionUpdater<Schema>): MessageShape<Schema> {
    return this.#requireTransaction("updateDraftState").update(updater);
  }

  /**
   * Replace the buffered draft version metadata. No version increments are computed.
   *
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected updateDraftVersionMetadata(
    draft: EntityVersionMetadataInput<Version>,
  ): EntityTransactionVersionMetadata<Version> {
    this.#requireTransaction("updateDraftVersionMetadata").updateVersionMetadata(
      cloneVersionMetadata(draft) as Version,
    );

    return this.draftVersionMetadata();
  }

  /**
   * Mark the buffered draft lifecycle as archived.
   *
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected archiveDraft(): EntityTransactionLifecycleFlags {
    return this.#requireTransaction("archiveDraft").archive();
  }

  /**
   * Mark the buffered draft lifecycle as not archived.
   *
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected unarchiveDraft(): EntityTransactionLifecycleFlags {
    return this.#requireTransaction("unarchiveDraft").unarchive();
  }

  /**
   * Mark the buffered draft lifecycle as deleted.
   *
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected markDraftDeleted(): EntityTransactionLifecycleFlags {
    return this.#requireTransaction("markDraftDeleted").markDeleted();
  }

  /**
   * Mark the buffered draft lifecycle as not deleted.
   *
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected restoreDraft(): EntityTransactionLifecycleFlags {
    return this.#requireTransaction("restoreDraft").restore();
  }

  /**
   * Commit the active draft transaction.
   *
   * Accepted commits apply state, version metadata, and lifecycle flags to this
   * entity and close the transaction. Rejected commits do not apply anything and
   * keep the transaction active for correction or explicit rollback.
   *
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected commitTransaction(): EntityTransactionCommitResult<Schema, Version> {
    const transaction = this.#requireTransaction("commitTransaction");
    const result = transaction.commit();

    if (result.status === "accepted") {
      if (
        result.previous === undefined ||
        !statesAreEqual(this.schema, result.previous, result.next)
      ) {
        this.#stateChanged = true;
      }
      this.replaceState(result.next);
      this.replaceVersionMetadata(result.version.committed as EntityVersionMetadataInput<Version>);
      this.replaceLifecycleFlags(result.lifecycle);
      this.#transaction = undefined;
      this.#lastRejectedCommit = undefined;
    } else {
      this.#lastRejectedCommit = result;
    }

    return cloneCommitResult(result);
  }

  /**
   * Roll back the active draft without applying state, version, or lifecycle changes.
   *
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected rollbackTransaction(): EntityTransactionRollbackResult<Schema, Version> {
    const result = this.#requireTransaction("rollbackTransaction").rollback();
    this.#transaction = undefined;
    this.#lastRejectedCommit = undefined;

    return result;
  }

  /** @internal Return a copy of the last rejected transaction commit, if any. */
  static rejectedCommitSnapshot(
    entity: object,
  ): EntityTransactionRejectedCommit<DescriptorMessageSchema> | undefined {
    if (!(entity instanceof TransactionalEntity)) {
      return undefined;
    }

    const rejected = entity.#lastRejectedCommit;
    return rejected === undefined
      ? undefined
      : (cloneCommitResult(rejected) as EntityTransactionRejectedCommit<DescriptorMessageSchema>);
  }

  #requireTransaction(
    operation: TransactionalEntityScopeOperation,
  ): EntityTransaction<Schema, Version> {
    const transaction = this.#transaction;
    if (transaction?.status !== "active") {
      throw new TransactionalEntityScopeError("missing", operation);
    }

    return transaction;
  }
}

/** @internal Framework-only transactional entity inspection used by repository execution. */
export interface TransactionalEntityAccess {
  /** Return the last rejected transaction commit for this entity, if any. */
  rejectedCommit(
    entity: object,
  ): EntityTransactionRejectedCommit<DescriptorMessageSchema> | undefined;
}

/** @internal Framework-only transactional entity inspection used by repository execution. */
export const transactionalEntityAccess: TransactionalEntityAccess = Object.freeze({
  rejectedCommit(
    entity: object,
  ): EntityTransactionRejectedCommit<DescriptorMessageSchema> | undefined {
    return TransactionalEntity.rejectedCommitSnapshot(entity);
  },
});

/**
 * Abstract aggregate family marker over the common transactional entity shell.
 *
 * This class intentionally adds only stable family identity. It does not add
 * command dispatch, event history, snapshots, repositories, idempotency guards,
 * or handler invocation.
 */
export abstract class Aggregate<
  Id,
  Schema extends DescriptorMessageSchema,
  Version = EntityVersionMetadata,
> extends TransactionalEntity<Id, Schema, Version> {
  /** Stable server entity family identity. */
  declare readonly entityFamily: "aggregate";

  /** Create an aggregate family shell from caller-provided state and metadata inputs. */
  constructor(options: EntityOptions<Id, Schema, Version>) {
    super(options);
    defineEntityFamilyMarker(this, "aggregate");
  }
}

/**
 * Abstract projection family marker over the common transactional entity shell.
 *
 * This class intentionally adds only stable family identity. It does not add
 * event subscriptions, event playing, repositories, version columns, query
 * clients, or handler invocation.
 */
export abstract class Projection<
  Id,
  Schema extends DescriptorMessageSchema,
  Version = EntityVersionMetadata,
> extends TransactionalEntity<Id, Schema, Version> {
  /** Stable server entity family identity. */
  declare readonly entityFamily: "projection";

  /** Create a projection family shell from caller-provided state and metadata inputs. */
  constructor(options: EntityOptions<Id, Schema, Version>) {
    super(options);
    defineEntityFamilyMarker(this, "projection");
  }
}

/**
 * Abstract process manager family marker over the common transactional entity shell.
 *
 * This class intentionally adds only stable family identity. It does not add
 * process workflow execution, command posting, query clients, repositories,
 * bounded-context injection, or handler invocation.
 */
export abstract class ProcessManager<
  Id,
  Schema extends DescriptorMessageSchema,
  Version = EntityVersionMetadata,
> extends TransactionalEntity<Id, Schema, Version> {
  /** Stable server entity family identity. */
  declare readonly entityFamily: "process-manager";

  /** Create a process manager family shell from caller-provided state and metadata inputs. */
  constructor(options: EntityOptions<Id, Schema, Version>) {
    super(options);
    defineEntityFamilyMarker(this, "process-manager");
  }
}

function defineEntityFamilyMarker(entity: object, family: EntityFamily): void {
  Object.defineProperty(entity, "entityFamily", {
    configurable: false,
    enumerable: false,
    value: family,
    writable: false,
  });
}

function cloneCommitResult<Schema extends DescriptorMessageSchema, Version>(
  result: EntityTransactionCommitResult<Schema, Version>,
): EntityTransactionCommitResult<Schema, Version> {
  if (result.status === "accepted") {
    return {
      ...result,
      version: {
        previous: cloneVersionMetadata(result.version.previous),
        committed: cloneVersionMetadata(result.version.committed),
      },
      lifecycle: {
        archived: result.lifecycle.archived,
        deleted: result.lifecycle.deleted,
      },
    };
  }

  return {
    ...result,
    version: {
      previous: cloneVersionMetadata(result.version.previous),
      draft: cloneVersionMetadata(result.version.draft),
    },
    lifecycle: {
      archived: result.lifecycle.archived,
      deleted: result.lifecycle.deleted,
    },
  };
}

function cloneState<Schema extends DescriptorMessageSchema>(
  schema: Schema,
  state: MessageShape<Schema>,
): MessageShape<Schema> {
  return fromBinary(schema, toBinary(schema, state, { writeUnknownFields: false }));
}

function statesAreEqual<Schema extends DescriptorMessageSchema>(
  schema: Schema,
  previous: MessageShape<Schema>,
  next: MessageShape<Schema>,
): boolean {
  const previousBinary = toBinary(schema, previous, { writeUnknownFields: false });
  const nextBinary = toBinary(schema, next, { writeUnknownFields: false });

  if (previousBinary.byteLength !== nextBinary.byteLength) {
    return false;
  }

  return previousBinary.every((byte, index) => byte === nextBinary[index]);
}

const maxVersionMetadataDepth = 1_000;

function cloneVersionMetadata<Version>(version: Version): Version {
  return clonePlainVersionMetadata(version, "$", new WeakSet(), 0) as Version;
}

function clonePlainVersionMetadata(
  value: unknown,
  path: string,
  stack: WeakSet<object>,
  depth: number,
): EntityVersionMetadata {
  if (depth > maxVersionMetadataDepth) {
    throw nonPlainVersionMetadataError(path, "excessive nesting depth");
  }

  if (value === null) {
    return value;
  }

  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
    case "undefined":
      return value;
    case "function":
      throw nonPlainVersionMetadataError(path, "function");
    case "object":
      return clonePlainVersionObject(value, path, stack, depth);
  }
}

function clonePlainVersionObject(
  value: object,
  path: string,
  stack: WeakSet<object>,
  depth: number,
): EntityVersionMetadata {
  if (isProxy(value)) {
    throw nonPlainVersionMetadataError(path, "Proxy");
  }
  if (ArrayBuffer.isView(value)) {
    throw nonPlainVersionMetadataError(path, getObjectKind(value));
  }
  if (value instanceof ArrayBuffer || isSharedArrayBuffer(value)) {
    throw nonPlainVersionMetadataError(path, getObjectKind(value));
  }
  if (stack.has(value)) {
    throw nonPlainVersionMetadataError(path, "cyclic object");
  }

  stack.add(value);
  try {
    if (Array.isArray(value)) {
      return clonePlainVersionArray(value, path, stack, depth);
    }

    if (!isPlainObject(value)) {
      throw nonPlainVersionMetadataError(path, getObjectKind(value));
    }

    const clone = Object.create(getObjectPrototype(value)) as Record<string, EntityVersionMetadata>;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const [symbolKey] = Object.getOwnPropertySymbols(descriptors);
    if (symbolKey !== undefined) {
      throw nonPlainVersionMetadataError(`${path}[${String(symbolKey)}]`, "symbol-keyed property");
    }

    for (const [key, descriptor] of Object.entries(descriptors)) {
      const childPath = `${path}.${key}`;
      if (!descriptor.enumerable) {
        throw nonPlainVersionMetadataError(childPath, "non-enumerable property");
      }
      if (!("value" in descriptor)) {
        throw nonPlainVersionMetadataError(childPath, "accessor property");
      }
      Object.defineProperty(clone, key, {
        configurable: true,
        enumerable: true,
        value: clonePlainVersionMetadata(descriptor.value, childPath, stack, depth + 1),
        writable: true,
      });
    }

    return clone;
  } finally {
    stack.delete(value);
  }
}

function clonePlainVersionArray(
  value: readonly unknown[],
  path: string,
  stack: WeakSet<object>,
  depth: number,
): readonly EntityVersionMetadata[] {
  if (getObjectPrototype(value) !== Array.prototype) {
    throw nonPlainVersionMetadataError(path, "Array");
  }

  const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value);
  const [symbolKey] = Object.getOwnPropertySymbols(descriptors);
  if (symbolKey !== undefined) {
    throw nonPlainVersionMetadataError(`${path}[${String(symbolKey)}]`, "symbol-keyed property");
  }

  const lengthDescriptor = descriptors.length;
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) {
    throw nonPlainVersionMetadataError(path, "array without data length");
  }

  const length = lengthDescriptor.value as number;
  const clone = new Array<EntityVersionMetadata>(length);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key === "length") {
      continue;
    }

    if (!isArrayElementKey(key, length)) {
      throw nonPlainVersionMetadataError(`${path}.${key}`, "custom array property");
    }
    if (!descriptor.enumerable) {
      throw nonPlainVersionMetadataError(`${path}[${key}]`, "non-enumerable property");
    }
    if (!("value" in descriptor)) {
      throw nonPlainVersionMetadataError(`${path}[${key}]`, "accessor property");
    }
  }

  for (let index = 0; index < length; index += 1) {
    const key = String(index);
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) {
      throw nonPlainVersionMetadataError(`${path}[${key}]`, "sparse array element");
    }

    Object.defineProperty(clone, index, {
      configurable: true,
      enumerable: true,
      value: clonePlainVersionMetadata(descriptor.value, `${path}[${key}]`, stack, depth + 1),
      writable: true,
    });
  }

  return clone;
}

function isArrayElementKey(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

function isPlainObject(value: object): boolean {
  const prototype = getObjectPrototype(value);
  return prototype === Object.prototype || prototype === null;
}

function getObjectPrototype(value: object): object | null {
  return Object.getPrototypeOf(value) as object | null;
}

function getObjectKind(value: object): string {
  if (value instanceof Date) {
    return "Date";
  }
  if (value instanceof Map) {
    return "Map";
  }
  if (value instanceof Set) {
    return "Set";
  }
  if (ArrayBuffer.isView(value)) {
    return "typed array";
  }
  if (value instanceof ArrayBuffer) {
    return "ArrayBuffer";
  }
  if (isSharedArrayBuffer(value)) {
    return "SharedArrayBuffer";
  }
  return "object";
}

function isSharedArrayBuffer(value: object): boolean {
  return typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer;
}

function nonPlainVersionMetadataError(path: string, kind: string): TypeError {
  return new TypeError(
    `Entity version metadata must be plain snapshot data; ${path} contains ${kind}.`,
  );
}
