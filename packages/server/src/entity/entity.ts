import { clone, fromBinary, toBinary, type Message, type MessageShape } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import {
  type ConstraintViolation,
  type Event,
  ValidationErrorSchema,
} from "@spine-event-engine/proto";
import type { EntityEventStorage, EntityStateHistoryStorage } from "@spine-event-engine/storage";

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
  type EntityTransactionMutator,
  type EntityTransactionVersionMetadata,
} from "./entity-transaction.js";
import type { StateTransitionResult } from "./entity-transition-validation.js";

type RejectedCommitSnapshot = EntityTransactionRejectedCommit<
  DescriptorMessageSchema,
  EntityVersionMetadata
>;

const rejectedCommits = new WeakMap<object, RejectedCommitSnapshot>();

/**
 * Lifecycle flags carried by a common entity shell.
 */
export interface EntityLifecycleFlags {
  // prettier-ignore

  /**
   * Whether the entity is archived.
   */
  readonly archived: boolean;

  /**
   * Whether the entity is deleted.
   */
  readonly deleted: boolean;
}

/**
 * Reason a {@link TransactionalEntity} transaction-scope operation failed.
 */
export type EntityScopeReason = "duplicate" | "missing";

/**
 * Protected {@link TransactionalEntity} operation guarded by transaction scope.
 */
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
  | "tryUpdate"
  | "update"
  | "updateDraftVersionMetadata";

/**
 * Error thrown when a transactional entity draft helper is used outside its scope.
 */
export class TransactionalEntityScopeError extends Error {
  // prettier-ignore

  /**
   * Scope failure reason.
   */
  readonly reason: EntityScopeReason;

  /**
   * Operation rejected by the current transaction scope.
   */
  readonly operation: TransactionalEntityScopeOperation;

  /**
   * Creates a deterministic transaction-scope error.
   *
   * @param reason Scope failure reason.
   * @param operation Operation rejected by the scope.
   */
  constructor(reason: EntityScopeReason, operation: TransactionalEntityScopeOperation) {
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

/**
 * Plain snapshot data accepted as caller-owned entity version metadata.
 */
export type EntityVersionMetadata =
  EntityVersionMetadataPrimitive | readonly EntityVersionMetadata[] | object;

type NonPlainVersion =
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

/**
 * Recursive type-level validator for caller-owned plain entity version metadata.
 */
export type PlainEntityVersionMetadata<Version> = PlainVersionAtDepth<Version, []>;

type PlainVersionAtDepth<Version, Depth extends readonly unknown[]> = Depth["length"] extends 20
  ? EntityVersionMetadata
  : Version extends EntityVersionMetadataPrimitive
    ? Version
    : Version extends (...args: never[]) => unknown
      ? never
      : Version extends NonPlainVersion
        ? never
        : Version extends readonly (infer Element)[]
          ? readonly PlainVersionAtDepth<Element, readonly [unknown, ...Depth]>[]
          : Version extends object
            ? {
                readonly [Key in keyof Version]: PlainVersionAtDepth<
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

/**
 * Initial values for constructing an {@link Entity}.
 */
export interface EntityOptions<
  Id,
  Schema extends DescriptorMessageSchema,
  Version = EntityVersionMetadata,
> {
  // prettier-ignore

  /**
   * Stable entity identifier owned by the caller/domain type.
   */
  readonly id: Id;

  /**
   * Generated Protobuf-ES schema describing the entity state.
   */
  readonly schema: Schema;

  /**
   * Initial entity state snapshot.
   */
  readonly state: MessageShape<Schema>;

  /**
   * Caller-owned plain version metadata snapshot.
   */
  readonly version: EntityVersionMetadataInput<Version>;

  /**
   * Initial lifecycle flags. Defaults to active, not deleted.
   */
  readonly lifecycle?: Partial<EntityLifecycleFlags>;
}

/**
 * Public entity family marker exposed by Spine server entity base classes.
 */
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
  // prettier-ignore

  /**
   * @hidden
   */
  declare protected static readonly spineTsEntityConstructor: true;

  readonly #id: Id;
  readonly #schema: Schema;
  readonly #metadata: EntityMetadata<Schema>;
  #state: MessageShape<Schema>;
  #version: Version;
  #lifecycle: EntityLifecycleFlags;
  #lifecycleFlagsChanged = false;

  /**
   * Creates an entity shell from caller-provided state and metadata inputs.
   *
   * @param options Identity, schema, state, version, and lifecycle inputs.
   */
  constructor(options: EntityOptions<Id, Schema, Version>) {
    this.#id = options.id;
    this.#schema = options.schema;
    this.#metadata = describeEntityMetadata(options.schema);
    this.#state = EntitySnapshots.clone(options.schema, options.state);
    this.#version = EntityVersions.clone(options.version) as Version;
    this.#lifecycle = {
      archived: options.lifecycle?.archived ?? false,
      deleted: options.lifecycle?.deleted ?? false,
    };
  }

  /**
   * Gets the stable entity identifier.
   *
   * @returns The caller-owned entity identifier.
   */
  get id(): Id {
    return this.#id;
  }

  /**
   * Gets the generated Protobuf-ES schema describing this entity's state.
   *
   * @returns The generated state schema.
   */
  get schema(): Schema {
    return this.#schema;
  }

  /**
   * Gets descriptor-derived metadata for this entity's state schema.
   *
   * @returns The frozen descriptor metadata.
   */
  get metadata(): EntityMetadata<Schema> {
    return this.#metadata;
  }

  /**
   * Gets the current entity state snapshot.
   *
   * @returns A cloned state snapshot.
   */
  get state(): MessageShape<Schema> {
    return EntitySnapshots.clone(this.#schema, this.#state);
  }

  /**
   * Gets the caller-owned plain version metadata snapshot.
   *
   * @returns A validated clone of the version metadata.
   */
  get version(): Version {
    return EntityVersions.clone(this.#version);
  }

  /**
   * Gets the current lifecycle flag snapshot.
   *
   * @returns The archived and deleted flags.
   */
  get lifecycle(): EntityLifecycleFlags {
    return {
      archived: this.#lifecycle.archived,
      deleted: this.#lifecycle.deleted,
    };
  }

  /**
   * Determines whether the entity is archived.
   *
   * @returns `true` when the entity is archived.
   */
  get isArchived(): boolean {
    return this.#lifecycle.archived;
  }

  /**
   * Determines whether the entity is deleted.
   *
   * @returns `true` when the entity is deleted.
   */
  get isDeleted(): boolean {
    return this.#lifecycle.deleted;
  }

  /**
   * Determines whether neither lifecycle flag marks the entity inactive.
   *
   * @returns `true` when the entity is active.
   */
  get isActive(): boolean {
    return !this.isArchived && !this.isDeleted;
  }

  /**
   * Determines whether lifecycle flags changed after construction.
   *
   * @returns `true` when lifecycle flags changed.
   */
  get lifecycleFlagsChanged(): boolean {
    return this.#lifecycleFlagsChanged;
  }

  /**
   * Replaces stored state from framework-owned subclass or runtime code.
   *
   * @param state Next entity state snapshot.
   */
  protected replaceState(state: MessageShape<Schema>): void {
    this.#state = EntitySnapshots.clone(this.#schema, state);
  }

  /**
   * Replaces caller-owned version metadata from framework-owned subclass or runtime code.
   *
   * @param version Next caller-owned version metadata.
   */
  protected replaceVersionMetadata(version: EntityVersionMetadataInput<Version>): void {
    this.#version = EntityVersions.clone(version) as Version;
  }

  /**
   * Replaces lifecycle flags from framework-owned subclass or runtime code.
   *
   * @param lifecycle Lifecycle flag changes to apply.
   */
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

  /**
   * Reads the newest retained state at or before `time`.
   *
   * This diagnostic facility is repository-bound and is not a remote API.
   *
   * @param time Timestamp of the requested state snapshot.
   * @returns The retained state snapshot, if one exists.
   */
  protected stateAt(time: Timestamp): Promise<Readonly<MessageShape<Schema>> | undefined> {
    return entityHistoryAccess.stateAt(this, time) as Promise<
      Readonly<MessageShape<Schema>> | undefined
    >;
  }

  /**
   * Reads retained states in descending version order.
   *
   * @param depth Maximum number of retained states to read.
   * @returns Retained state snapshots in descending version order.
   */
  protected stateHistoryBackward(
    depth: number,
  ): Promise<readonly Readonly<MessageShape<Schema>>[]> {
    return entityHistoryAccess.states(this, depth) as Promise<
      readonly Readonly<MessageShape<Schema>>[]
    >;
  }

  /**
   * Gets application-managed state-history retention.
   *
   * @returns State-history storage for this entity.
   */
  protected stateHistoryStorage(): EntityStateHistoryStorage<Id, MessageShape<Schema>> {
    return entityHistoryAccess.stateMaintenance(this) as EntityStateHistoryStorage<
      Id,
      MessageShape<Schema>
    >;
  }
}

interface BoundEntityHistory {
  readonly stateAt: (time: Timestamp) => Promise<unknown>;
  readonly states: (depth: number) => Promise<readonly unknown[]>;
  readonly events: (depth: number) => Promise<readonly Readonly<Event>[]>;
  readonly stateMaintenance: EntityStateHistoryStorage<unknown, Message>;
  readonly eventMaintenance: EntityEventStorage<unknown>;
}

const boundEntityHistories = new WeakMap<object, BoundEntityHistory>();

interface EntityHistoryAccess {
  bind(entity: object, binding: BoundEntityHistory): void;
  stateAt(entity: object, time: Timestamp): Promise<unknown>;
  states(entity: object, depth: number): Promise<readonly unknown[]>;
  events(entity: object, depth: number): Promise<readonly Readonly<Event>[]>;
  stateMaintenance(entity: object): EntityStateHistoryStorage<unknown, Message>;
  eventMaintenance(entity: object): EntityEventStorage<unknown>;
}

/**
 * Provides repository-only history binding.
 *
 * @internal
 */
export const entityHistoryAccess: EntityHistoryAccess = Object.freeze({
  bind(entity: object, binding: BoundEntityHistory): void {
    boundEntityHistories.set(entity, binding);
  },
  stateAt(entity: object, time: Timestamp): Promise<unknown> {
    return EntityHistory.require(entity).stateAt(time);
  },
  states(entity: object, depth: number): Promise<readonly unknown[]> {
    return EntityHistory.require(entity).states(EntityHistory.depth(depth));
  },
  events(entity: object, depth: number): Promise<readonly Readonly<Event>[]> {
    return EntityHistory.require(entity).events(EntityHistory.depth(depth));
  },
  stateMaintenance(entity: object): EntityStateHistoryStorage<unknown, Message> {
    return EntityHistory.require(entity).stateMaintenance;
  },
  eventMaintenance(entity: object): EntityEventStorage<unknown> {
    return EntityHistory.require(entity).eventMaintenance;
  },
});

/**
 * Validates repository-bound history lookups.
 */
const EntityHistory = Object.freeze({
  require(entity: object): BoundEntityHistory {
    const binding = boundEntityHistories.get(entity);
    if (binding === undefined) {
      throw new Error("Entity history is available only from repository execution.");
    }
    return binding;
  },

  depth(depth: number): number {
    if (!Number.isSafeInteger(depth) || depth <= 0) {
      throw new RangeError("Entity history depth must be a positive safe integer.");
    }
    return depth;
  },
});

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
  #stateChanged = false;

  /**
   * Determines whether accepted transaction state or lifecycle changes are visible.
   *
   * @returns `true` when the entity differs from its initial state.
   */
  get changed(): boolean {
    return this.#stateChanged || this.lifecycleFlagsChanged;
  }

  /**
   * Determines whether a protected transaction scope is currently active.
   *
   * @returns `true` when an active transaction scope exists.
   */
  protected isTransactionInProgress(): boolean {
    return this.#transaction?.status === "active";
  }

  /**
   * Starts a protected draft transaction from the entity's current snapshots.
   *
   * @throws {@link TransactionalEntityScopeError} when another transaction is active.
   */
  protected startTransaction(): void {
    if (this.isTransactionInProgress()) {
      throw new TransactionalEntityScopeError("duplicate", "startTransaction");
    }

    const previousVersion = this.version;
    this.#transaction = new EntityTransaction({
      schema: this.schema,
      previous: this.state,
      version: {
        previous: previousVersion,
        draft: EntityVersions.clone(previousVersion),
      },
      lifecycle: this.lifecycle,
    });
  }

  /**
   * Gets the current draft state snapshot.
   *
   * @returns A cloned current draft state snapshot.
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected currentDraft(): MessageShape<Schema> {
    return this.#requireTransaction("currentDraft").currentDraft;
  }

  /**
   * Gets the current draft version metadata snapshot.
   *
   * @returns Cloned previous and draft version metadata.
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected draftVersionMetadata(): EntityTransactionVersionMetadata<Version> {
    const version = this.#requireTransaction("draftVersionMetadata").version;

    return {
      previous: EntityVersions.clone(version.previous),
      draft: EntityVersions.clone(version.draft),
    };
  }

  /**
   * Gets the current draft lifecycle flag snapshot.
   *
   * @returns Current archived and deleted draft flags.
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected draftLifecycleFlags(): EntityTransactionLifecycleFlags {
    return this.#requireTransaction("draftLifecycleFlags").lifecycle;
  }

  /**
   * Updates the buffered draft state in place.
   *
   * @param mutator Changes the active draft state.
   * @returns A cloned snapshot of the updated draft state.
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected update(mutator: EntityTransactionMutator<Schema>): MessageShape<Schema> {
    return this.#requireTransaction("update").update(mutator);
  }

  /**
   * Tries to update and validate a scratch draft, applying it only when valid.
   *
   * Validation failures return immutable constraint violations. Other errors
   * propagate and leave the active draft unchanged.
   *
   * @param mutator Changes the scratch draft state.
   * @returns Immutable constraint violations, or an empty array when the update applies.
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected tryUpdate(mutator: EntityTransactionMutator<Schema>): readonly ConstraintViolation[] {
    return this.#requireTransaction("tryUpdate").tryUpdate(mutator);
  }

  /**
   * Updates the buffered draft version metadata without computing version increments.
   *
   * @param draft Caller-owned version metadata for the active draft.
   * @returns Cloned previous and draft version metadata.
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected updateDraftVersionMetadata(
    draft: EntityVersionMetadataInput<Version>,
  ): EntityTransactionVersionMetadata<Version> {
    this.#requireTransaction("updateDraftVersionMetadata").updateVersionMetadata(
      EntityVersions.clone(draft) as Version,
    );

    return this.draftVersionMetadata();
  }

  /**
   * Marks the buffered draft lifecycle as archived.
   *
   * @returns The archived and deleted draft flags.
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected archiveDraft(): EntityTransactionLifecycleFlags {
    return this.#requireTransaction("archiveDraft").archive();
  }

  /**
   * Marks the buffered draft lifecycle as not archived.
   *
   * @returns The archived and deleted draft flags.
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected unarchiveDraft(): EntityTransactionLifecycleFlags {
    return this.#requireTransaction("unarchiveDraft").unarchive();
  }

  /**
   * Marks the buffered draft lifecycle as deleted.
   *
   * @returns The archived and deleted draft flags.
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected markDraftDeleted(): EntityTransactionLifecycleFlags {
    return this.#requireTransaction("markDraftDeleted").markDeleted();
  }

  /**
   * Marks the buffered draft lifecycle as not deleted.
   *
   * @returns The archived and deleted draft flags.
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected restoreDraft(): EntityTransactionLifecycleFlags {
    return this.#requireTransaction("restoreDraft").restore();
  }

  /**
   * Commits the active draft transaction.
   *
   * Accepted commits apply state, version metadata, and lifecycle flags to this
   * entity and close the transaction. Rejected commits do not apply anything and
   * keep the transaction active for correction or explicit rollback.
   *
   * @returns A cloned accepted or rejected transaction result.
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected commitTransaction(): EntityTransactionCommitResult<Schema, Version> {
    const transaction = this.#requireTransaction("commitTransaction");
    const result = transaction.commit();

    if (result.status === "accepted") {
      if (
        result.previous === undefined ||
        !EntitySnapshots.equal(this.schema, result.previous, result.next)
      ) {
        this.#stateChanged = true;
      }
      this.replaceState(result.next);
      this.replaceVersionMetadata(result.version.committed as EntityVersionMetadataInput<Version>);
      this.replaceLifecycleFlags(result.lifecycle);
      this.#transaction = undefined;
      rejectedCommits.delete(this);
    } else {
      rejectedCommits.set(this, EntityCommits.clone(result) as RejectedCommitSnapshot);
    }

    return EntityCommits.clone(result);
  }

  /**
   * Rolls back the active draft without applying state, version, or lifecycle changes.
   *
   * @returns A cloned rollback result containing the discarded draft snapshots.
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected rollbackTransaction(): EntityTransactionRollbackResult<Schema, Version> {
    const result = this.#requireTransaction("rollbackTransaction").rollback();
    this.#transaction = undefined;

    return result;
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

/**
 * Framework-only transaction operations used by repository execution.
 */
export interface TransactionalEntityAccess {
  // prettier-ignore

  /**
   * Starts a framework-owned transaction scope for an entity.
   *
   * @param entity Transactional entity object to start.
   */
  start(entity: object): void;

  /**
   * Executes a framework-owned transaction commit for an entity.
   *
   * @param entity Transactional entity object to commit.
   * @returns The transaction commit result.
   */
  commit(entity: object): EntityTransactionCommitResult<DescriptorMessageSchema>;

  /**
   * Executes a framework-owned transaction rollback for an entity, if possible.
   *
   * @param entity Transactional entity object to roll back.
   */
  rollback(entity: object): void;

  /**
   * Returns the last rejected transaction commit for this entity, if any.
   *
   * @param entity Transactional entity object to inspect.
   * @returns A cloned rejected result, if one exists.
   */
  rejectedCommit(
    entity: object,
  ): EntityTransactionRejectedCommit<DescriptorMessageSchema> | undefined;
}

/**
 * Exposes framework-only transaction operations for repository execution.
 *
 * @internal
 */
export const transactionalEntityAccess: TransactionalEntityAccess = Object.freeze({
  start(entity: object): void {
    TransactionAccess.call(entity, "startTransaction");
  },

  commit(entity: object): EntityTransactionCommitResult<DescriptorMessageSchema> {
    return TransactionAccess.call(
      entity,
      "commitTransaction",
    ) as EntityTransactionCommitResult<DescriptorMessageSchema>;
  },

  rollback(entity: object): void {
    try {
      TransactionAccess.call(entity, "rollbackTransaction");
    } catch (error) {
      if (!TransactionAccess.isMissing(error)) {
        throw error;
      }
    }
  },

  rejectedCommit(
    entity: object,
  ): EntityTransactionRejectedCommit<DescriptorMessageSchema> | undefined {
    const rejected = rejectedCommits.get(entity);
    return rejected === undefined
      ? undefined
      : (EntityCommits.clone(rejected) as EntityTransactionRejectedCommit<DescriptorMessageSchema>);
  },
});

/**
 * Bridges repository code to protected transactional entity methods.
 */
const TransactionAccess = Object.freeze({
  call(entity: object, methodName: string): unknown {
    const method = (entity as Record<string, unknown>)[methodName];

    if (typeof method !== "function") {
      throw new TypeError(`Transactional entity access requires "${methodName}".`);
    }

    return Reflect.apply(method, entity, []);
  },

  isMissing(error: unknown): boolean {
    return error instanceof TransactionalEntityScopeError && error.reason === "missing";
  },
});

/**
 * Abstract aggregate family marker over the common transactional entity shell.
 *
 * This class intentionally adds only stable family identity. It does not add
 * command dispatch, snapshots, repositories, idempotency guards, or handler
 * invocation. Repository-bound diagnostic event-history reads are declared
 * below for the Aggregate family.
 */
export abstract class Aggregate<
  Id,
  Schema extends DescriptorMessageSchema,
  Version = EntityVersionMetadata,
> extends TransactionalEntity<Id, Schema, Version> {
  // prettier-ignore

  /**
   * Stable server entity family identity.
   */
  declare readonly entityFamily: "aggregate";

  /**
   * Creates an aggregate family shell from caller-provided state and metadata inputs.
   *
   * @param options Identity, schema, state, version, and lifecycle inputs.
   */
  constructor(options: EntityOptions<Id, Schema, Version>) {
    super(options);
    EntityFamilies.mark(this, "aggregate");
  }

  /**
   * Reads retained diagnostic events in descending producer-version order.
   *
   * @param depth Maximum number of retained events to read.
   * @returns Retained events in descending producer-version order.
   */
  protected eventHistoryBackward(depth: number): Promise<readonly Readonly<Event>[]> {
    return entityHistoryAccess.events(this, depth);
  }

  /**
   * Tests retained diagnostic events in descending producer-version order.
   *
   * @param depth Maximum number of retained events to inspect.
   * @param predicate Tests each retained event.
   * @returns `true` when a retained event matches the predicate.
   */
  protected async eventHistoryContains(
    depth: number,
    predicate: (event: Readonly<Event>) => boolean,
  ): Promise<boolean> {
    return (await this.eventHistoryBackward(depth)).some(predicate);
  }

  /**
   * Gets application-managed diagnostic event-history retention.
   *
   * @returns Event-history storage for this entity.
   */
  protected eventStorage(): EntityEventStorage<Id> {
    return entityHistoryAccess.eventMaintenance(this) as EntityEventStorage<Id>;
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
  // prettier-ignore

  /**
   * Stable server entity family identity.
   */
  declare readonly entityFamily: "projection";

  /**
   * Creates a projection family shell from caller-provided state and metadata inputs.
   *
   * @param options Identity, schema, state, version, and lifecycle inputs.
   */
  constructor(options: EntityOptions<Id, Schema, Version>) {
    super(options);
    EntityFamilies.mark(this, "projection");
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
  // prettier-ignore

  /**
   * Stable server entity family identity.
   */
  declare readonly entityFamily: "process-manager";

  /**
   * Creates a process manager family shell from caller-provided state and metadata inputs.
   *
   * @param options Identity, schema, state, version, and lifecycle inputs.
   */
  constructor(options: EntityOptions<Id, Schema, Version>) {
    super(options);
    EntityFamilies.mark(this, "process-manager");
  }

  /**
   * Reads retained diagnostic events when this repository enabled Process Manager event history.
   *
   * @param depth Maximum number of retained events to read.
   * @returns Retained events in descending producer-version order.
   */
  protected eventHistoryBackward(depth: number): Promise<readonly Readonly<Event>[]> {
    return entityHistoryAccess.events(this, depth);
  }

  /**
   * Tests retained diagnostic events when this repository enabled Process Manager event history.
   *
   * @param depth Maximum number of retained events to inspect.
   * @param predicate Tests each retained event.
   * @returns `true` when a retained event matches the predicate.
   */
  protected async eventHistoryContains(
    depth: number,
    predicate: (event: Readonly<Event>) => boolean,
  ): Promise<boolean> {
    return (await this.eventHistoryBackward(depth)).some(predicate);
  }

  /**
   * Gets application-managed Process Manager diagnostic event-history retention.
   *
   * @returns Event-history storage for this Process Manager.
   */
  protected eventStorage(): EntityEventStorage<Id> {
    return entityHistoryAccess.eventMaintenance(this) as EntityEventStorage<Id>;
  }
}

/**
 * Marks immutable entity families.
 */
const EntityFamilies = Object.freeze({
  mark(entity: object, family: EntityFamily): void {
    Object.defineProperty(entity, "entityFamily", {
      configurable: false,
      enumerable: false,
      value: family,
      writable: false,
    });
  },
});

/**
 * Creates entity-state snapshots and compares state bytes.
 */
const EntitySnapshots = Object.freeze({
  clone<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    state: MessageShape<Schema>,
  ): MessageShape<Schema> {
    return fromBinary(schema, toBinary(schema, state, { writeUnknownFields: false }));
  },

  equal<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    previous: MessageShape<Schema>,
    next: MessageShape<Schema>,
  ): boolean {
    const previousBinary = toBinary(schema, previous, { writeUnknownFields: false });
    const nextBinary = toBinary(schema, next, { writeUnknownFields: false });
    return (
      previousBinary.byteLength === nextBinary.byteLength &&
      previousBinary.every((byte, index) => byte === nextBinary[index])
    );
  },
});

/**
 * Creates immutable transaction-result snapshots.
 */
const EntityCommits = Object.freeze({
  clone<Schema extends DescriptorMessageSchema, Version>(
    result: EntityTransactionCommitResult<Schema, Version>,
  ): EntityTransactionCommitResult<Schema, Version> {
    if (result.status === "accepted") {
      return {
        ...result,
        version: {
          previous: EntityVersions.clone(result.version.previous),
          committed: EntityVersions.clone(result.version.committed),
        },
        lifecycle: { archived: result.lifecycle.archived, deleted: result.lifecycle.deleted },
        validation: this.validation(result.validation) as typeof result.validation,
      };
    }

    return {
      ...result,
      version: {
        previous: EntityVersions.clone(result.version.previous),
        draft: EntityVersions.clone(result.version.draft),
      },
      lifecycle: { archived: result.lifecycle.archived, deleted: result.lifecycle.deleted },
      validation: this.validation(result.validation) as typeof result.validation,
    };
  },

  validation(validation: StateTransitionResult): StateTransitionResult {
    if (validation.valid) {
      return { valid: true, violations: [], error: undefined };
    }
    const error = clone(ValidationErrorSchema, validation.error);
    return {
      valid: false,
      violations: error.constraintViolation as [ConstraintViolation, ...ConstraintViolation[]],
      error,
    };
  },
});

const maxVersionMetadataDepth = 1_000;

/**
 * Validates and clones caller-provided plain version metadata.
 */
const EntityVersions = Object.freeze({
  clone<Version>(version: Version): Version {
    return this.value(version, "$", new WeakSet(), 0) as Version;
  },

  value(
    value: unknown,
    path: string,
    stack: WeakSet<object>,
    depth: number,
  ): EntityVersionMetadata {
    if (depth > maxVersionMetadataDepth) {
      throw this.error(path, "excessive nesting depth");
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
        throw this.error(path, "function");
      case "object":
        return this.object(value, path, stack, depth);
    }
  },

  object(
    value: object,
    path: string,
    stack: WeakSet<object>,
    depth: number,
  ): EntityVersionMetadata {
    if (isProxy(value)) throw this.error(path, "Proxy");
    if (ArrayBuffer.isView(value)) throw this.error(path, this.kind(value));
    if (value instanceof ArrayBuffer || this.isSharedBuffer(value)) {
      throw this.error(path, this.kind(value));
    }
    if (stack.has(value)) throw this.error(path, "cyclic object");

    stack.add(value);
    try {
      if (Array.isArray(value)) return this.array(value, path, stack, depth);
      if (!this.isPlainObject(value)) throw this.error(path, this.kind(value));

      const clone = Object.create(this.prototype(value)) as Record<string, EntityVersionMetadata>;
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const [symbolKey] = Object.getOwnPropertySymbols(descriptors);
      if (symbolKey !== undefined) {
        throw this.error(`${path}[${String(symbolKey)}]`, "symbol-keyed property");
      }
      for (const [key, descriptor] of Object.entries(descriptors)) {
        const childPath = `${path}.${key}`;
        if (!descriptor.enumerable) throw this.error(childPath, "non-enumerable property");
        if (!("value" in descriptor)) throw this.error(childPath, "accessor property");
        Object.defineProperty(clone, key, {
          configurable: true,
          enumerable: true,
          value: this.value(descriptor.value, childPath, stack, depth + 1),
          writable: true,
        });
      }
      return clone;
    } finally {
      stack.delete(value);
    }
  },

  array(
    value: readonly unknown[],
    path: string,
    stack: WeakSet<object>,
    depth: number,
  ): readonly EntityVersionMetadata[] {
    if (this.prototype(value) !== Array.prototype) throw this.error(path, "Array");
    const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value);
    const [symbolKey] = Object.getOwnPropertySymbols(descriptors);
    if (symbolKey !== undefined) {
      throw this.error(`${path}[${String(symbolKey)}]`, "symbol-keyed property");
    }
    const lengthDescriptor = descriptors.length;
    if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) {
      throw this.error(path, "array without data length");
    }
    const length = lengthDescriptor.value as number;
    const clone = new Array<EntityVersionMetadata>(length);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === "length") continue;
      if (!this.isArrayKey(key, length))
        throw this.error(`${path}.${key}`, "custom array property");
      if (!descriptor.enumerable) throw this.error(`${path}[${key}]`, "non-enumerable property");
      if (!("value" in descriptor)) throw this.error(`${path}[${key}]`, "accessor property");
    }
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor)) {
        throw this.error(`${path}[${key}]`, "sparse array element");
      }
      Object.defineProperty(clone, index, {
        configurable: true,
        enumerable: true,
        value: this.value(descriptor.value, `${path}[${key}]`, stack, depth + 1),
        writable: true,
      });
    }
    return clone;
  },

  isArrayKey(key: string, length: number): boolean {
    const index = Number(key);
    return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
  },

  isPlainObject(value: object): boolean {
    const prototype = this.prototype(value);
    return prototype === Object.prototype || prototype === null;
  },

  prototype(value: object): object | null {
    return Object.getPrototypeOf(value) as object | null;
  },

  kind(value: object): string {
    if (value instanceof Date) return "Date";
    if (value instanceof Map) return "Map";
    if (value instanceof Set) return "Set";
    if (ArrayBuffer.isView(value)) return "typed array";
    if (value instanceof ArrayBuffer) return "ArrayBuffer";
    if (this.isSharedBuffer(value)) return "SharedArrayBuffer";
    return "object";
  },

  isSharedBuffer(value: object): boolean {
    return typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer;
  },

  error(path: string, kind: string): TypeError {
    return new TypeError(
      `Entity version metadata must be plain snapshot data; ${path} contains ${kind}.`,
    );
  },
});
