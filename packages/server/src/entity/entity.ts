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

import {
  clone,
  create,
  fromBinary,
  toBinary,
  type Message,
  type MessageShape,
} from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import {
  EntityQuery,
  type EntityColumn,
  type EntityColumnOperator,
  type EntityQueryMaskPath,
  type EntityQueryIdentifier,
  type EntityQueryPredicateFor,
  type EntityPredicate,
  type EntityQueryBuilder,
} from "@spine-event-engine/core";
import type { EntityQueryPlan } from "@spine-event-engine/core/spi/entity-query-plan";
import {
  type ConstraintViolation,
  type Event,
  type Version,
  VersionSchema,
  ActorContextSchema,
  type ActorContext,
  ValidationErrorSchema,
} from "@spine-event-engine/proto";
import type { Query } from "@spine-event-engine/proto/client";
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
} from "./entity-transaction.js";
import type { StateTransitionResult } from "./entity-transition-validation.js";

type RejectedCommitSnapshot = EntityTransactionRejectedCommit<DescriptorMessageSchema>;

/**
 * Descriptor-backed columns available to a Process Manager query.
 *
 * @typeParam Schema State schema containing the queried columns.
 */
type ProcessManagerQueryColumns<Schema extends DescriptorMessageSchema> = Readonly<
  Record<string, EntityColumn<Schema>>
>;

/**
 * Reads states using the invoking handler's actor and tenant.
 *
 * @typeParam Schema State schema selected by the query.
 * @param plan Compiled filters and ordering for the query.
 * @param schema Generated schema used to decode matching states.
 * @param query Query message carrying the actor and selected state fields.
 * @returns Matching state snapshots from the read side.
 */
type ProcessManagerQueryExecutor = <Schema extends DescriptorMessageSchema>(
  plan: EntityQueryPlan,
  schema: Schema,
  query: Query,
) => Promise<readonly MessageShape<Schema>[]>;

interface ProcessManagerQueryCapability {
  readonly actorContext: ActorContext;

  readonly execute: ProcessManagerQueryExecutor;

  active: boolean;
}

const processManagerQueries = new WeakMap<object, ProcessManagerQueryCapability>();

/**
 * Binds the repository-scoped query capability for one Process Manager invocation.
 *
 * @internal
 */
export const processManagerQueryAccess: Readonly<{
  bind(
    entity: object,
    execute: ProcessManagerQueryCapability["execute"],
    actorContext: ActorContext,
  ): () => void;
  require(entity: object): ProcessManagerQueryCapability;
}> = Object.freeze({
  /**
   * Enables read-side queries for the duration of one handler invocation.
   *
   * @param entity Process Manager receiving the query capability.
   * @param execute Repository operation that runs queries.
   * @param actorContext Actor and tenant of the incoming signal.
   * @returns A function that disables and removes this capability.
   */
  bind(
    entity: object,
    execute: ProcessManagerQueryCapability["execute"],
    actorContext: ActorContext,
  ): () => void {
    const capability: ProcessManagerQueryCapability = {
      execute,
      actorContext: clone(ActorContextSchema, actorContext),
      active: true,
    };
    processManagerQueries.set(entity, capability);
    return () => {
      capability.active = false;
      processManagerQueries.delete(entity);
    };
  },

  /**
   * Gets the query capability of a currently executing Process Manager.
   *
   * @param entity Process Manager attempting a query.
   * @returns The active repository query capability.
   */
  require(entity: object): ProcessManagerQueryCapability {
    const capability = processManagerQueries.get(entity);
    if (capability?.active !== true) {
      throw new Error(
        "Process Manager queries are available only during repository handler execution.",
      );
    }
    return capability;
  },
});

/**
 * A repository-scoped, read-only Entity query issued by a Process Manager.
 *
 * @typeParam Schema State schema read by the query.
 * @typeParam Columns Registered descriptor-backed columns for `Schema`.
 */
export class ProcessManagerQuery<
  Schema extends DescriptorMessageSchema,
  Columns extends ProcessManagerQueryColumns<Schema>,
> {
  readonly #entity: object;

  readonly #schema: Schema;

  readonly #builder: EntityQueryBuilder<Schema, Columns>;

  /**
   * Creates the repository-scoped query facade.
   *
   * @internal
   * @param entity Process Manager using this query capability.
   * @param schema State schema read by this query.
   * @param builder Typed query builder used to create the wire query.
   */
  constructor(entity: object, schema: Schema, builder: EntityQueryBuilder<Schema, Columns>) {
    this.#entity = entity;
    this.#schema = schema;
    this.#builder = builder;
  }

  /**
   * Adds the supplied Entity IDs to the query target.
   *
   * @param ids Entity IDs to include.
   * @returns This query for fluent configuration.
   */
  byId(...ids: readonly EntityQueryIdentifier<Schema>[]): this {
    this.#builder.byId(...ids);
    return this;
  }

  /**
   * Adds a typed state predicate to the query.
   *
   * @typeParam Predicate Comparison supported by the registered columns.
   * @param predicate Predicate evaluated against registered state columns.
   * @returns This query for fluent configuration.
   */
  where<Predicate extends EntityPredicate>(
    predicate: EntityQueryPredicateFor<Schema, Columns, Predicate>,
  ): this {
    this.#builder.where(predicate);
    return this;
  }

  /**
   * Sets the state fields returned by the server.
   *
   * @param paths Generated state-field property names to include.
   * @returns This query for fluent configuration.
   */
  mask(...paths: readonly EntityQueryMaskPath<Schema>[]): this {
    this.#builder.mask(...paths);
    return this;
  }

  /**
   * Sets the ordering for matching states by one registered column.
   *
   * @typeParam Column Registered column supplying the ordered values.
   * @param column Registered orderable column used for sorting.
   * @param direction Optional sort direction, ascending by default.
   * @returns This query for fluent configuration.
   */
  orderBy<Column extends Columns[keyof Columns]>(
    column: "greaterThan" extends EntityColumnOperator<Column> ? Column : never,
    direction: "asc" | "desc" = "asc",
  ): this {
    this.#builder.orderBy(column, direction);
    return this;
  }

  /**
   * Sets the returned-state limit to at most 1,000 entries.
   *
   * @param value Maximum number of states to return.
   * @returns This query for fluent configuration.
   */
  limit(value: number): this {
    if (value > 1_000) {
      throw new TypeError("Process Manager query limit may be at most 1000.");
    }
    this.#builder.limit(value);
    return this;
  }

  /**
   * Reads matching state snapshots from the eventually consistent query projection.
   *
   * @returns Readonly state snapshots, subject to the configured result limit.
   */
  async read(): Promise<readonly MessageShape<Schema>[]> {
    const capability = processManagerQueryAccess.require(this.#entity);
    const states = await capability.execute(
      this.#builder.buildPlan(),
      this.#schema,
      this.#builder.build(),
    );
    return Object.freeze(states.slice(0, 1_000));
  }

  /**
   * Reads the first state snapshot for one Entity ID.
   *
   * @param id Entity ID to read.
   * @returns The eventually consistent state snapshot, or `undefined` when it is absent.
   */
  async findById(id: EntityQueryIdentifier<Schema>): Promise<MessageShape<Schema> | undefined> {
    const states = await this.byId(id).read();
    return states[0];
  }

  /**
   * Reads every matching state snapshot within the configured result limit.
   *
   * This can be more expensive than an ID-targeted read because the projection must evaluate all
   * matching states.
   *
   * @returns Readonly eventually consistent state snapshots.
   */
  async all(): Promise<readonly MessageShape<Schema>[]> {
    return await this.read();
  }
}

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
  | "markDraftDeleted"
  | "restoreDraft"
  | "rollbackTransaction"
  | "startTransaction"
  | "unarchiveDraft"
  | "tryUpdate"
  | "update";

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

/**
 * Initial values for constructing an {@link Entity}.
 *
 * @typeParam Id Domain identifier type.
 * @typeParam Schema Generated schema describing the Entity state.
 */
export interface EntityOptions<Id, Schema extends DescriptorMessageSchema> {
  // prettier-ignore

  /**
   * Stable domain identifier for the Entity.
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
   * Restored Spine Version; fresh Entities start at zero.
   */
  readonly version?: Version;

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
 * Identity, state, version, and lifecycle of one server-side Entity.
 *
 * The shell exposes identity, descriptor-derived metadata, cloned state
 * snapshots, Spine Version snapshots, and lifecycle flags. It does not
 * invoke handlers, create transactions, write repositories or storage, dispatch
 * messages, increment versions, route IDs, query read models, start buses, or
 * mutate process-wide runtime state.
 *
 * @typeParam Id Domain identifier type.
 * @typeParam Schema Generated schema describing the Entity state.
 */
export abstract class Entity<Id, Schema extends DescriptorMessageSchema> {
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
  constructor(options: EntityOptions<Id, Schema>) {
    this.#id = options.id;
    this.#schema = options.schema;
    this.#metadata = describeEntityMetadata(options.schema);
    this.#state = EntitySnapshots.clone(options.schema, options.state);
    this.#version = clone(VersionSchema, options.version ?? create(VersionSchema));
    this.#lifecycle = {
      archived: options.lifecycle?.archived ?? false,
      deleted: options.lifecycle?.deleted ?? false,
    };
  }

  /**
   * Gets the stable entity identifier.
   *
   * @returns The domain identifier supplied during construction.
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
   * Gets the current Spine Version without exposing the stored message.
   *
   * @returns A copy of the version number and timestamp.
   */
  get version(): Version {
    return clone(VersionSchema, this.#version);
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
   * Replaces stored state when framework transaction code accepts a draft.
   *
   * @param state Next entity state snapshot.
   */
  protected replaceState(state: MessageShape<Schema>): void {
    this.#state = EntitySnapshots.clone(this.#schema, state);
  }

  /**
   * Applies the Version calculated by a framework transaction.
   *
   * @param version Accepted version number and timestamp.
   */
  protected replaceVersion(version: Version): void {
    this.#version = clone(VersionSchema, version);
  }

  /**
   * Applies lifecycle flags accepted by framework transaction code.
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
  /**
   * Attaches repository history access to an Entity instance.
   *
   * @param entity Instance whose retained history will be read.
   * @param binding Repository operations for that Entity's history.
   */
  bind(entity: object, binding: BoundEntityHistory): void;

  /**
   * Reads the latest retained state at or before a time.
   *
   * @param entity Entity whose state is requested.
   * @param time Latest allowed state timestamp.
   * @returns The retained state, or undefined if no state matches.
   */
  stateAt(entity: object, time: Timestamp): Promise<unknown>;

  /**
   * Reads retained states in descending version order.
   *
   * @param entity Entity whose history is requested.
   * @param depth Maximum number of states to read.
   * @returns Retained state snapshots, newest first.
   */
  states(entity: object, depth: number): Promise<readonly unknown[]>;

  /**
   * Reads retained diagnostic Events, newest producer version first.
   *
   * @param entity Entity that produced the Events.
   * @param depth Maximum number of Events to read.
   * @returns Retained diagnostic Events.
   */
  events(entity: object, depth: number): Promise<readonly Readonly<Event>[]>;

  /**
   * Gets the repository's state-history storage for retention operations.
   *
   * @param entity Entity whose history is maintained.
   * @returns The state-history storage bound to that Entity.
   */
  stateMaintenance(entity: object): EntityStateHistoryStorage<unknown, Message>;

  /**
   * Gets the repository's diagnostic Event storage for retention operations.
   *
   * @param entity Entity whose diagnostic Events are maintained.
   * @returns The Event-history storage bound to that Entity.
   */
  eventMaintenance(entity: object): EntityEventStorage<unknown>;
}

/**
 * Provides repository-only history binding.
 *
 * @internal
 */
export const entityHistoryAccess: EntityHistoryAccess = Object.freeze({
  /**
   * Associates an Entity instance with its repository history operations.
   *
   * @param entity Entity instance loaded by the repository.
   * @param binding Operations bound to that Entity's history.
   */
  bind(entity: object, binding: BoundEntityHistory): void {
    boundEntityHistories.set(entity, binding);
  },
  /**
   * Reads the most recent retained state no later than the requested time.
   *
   * @param entity Entity whose state is requested.
   * @param time Latest allowed state timestamp.
   * @returns The retained state, or undefined when none matches.
   */
  stateAt(entity: object, time: Timestamp): Promise<unknown> {
    return EntityHistory.require(entity).stateAt(time);
  },
  /**
   * Reads retained states after checking the history read limit.
   *
   * @param entity Entity whose history is requested.
   * @param depth Maximum number of states to return.
   * @returns Retained states in descending version order.
   */
  states(entity: object, depth: number): Promise<readonly unknown[]> {
    return EntityHistory.require(entity).states(EntityHistory.depth(depth));
  },
  /**
   * Reads diagnostic Events after checking the history read limit.
   *
   * @param entity Entity that produced the Events.
   * @param depth Maximum number of Events to return.
   * @returns Retained Events in descending producer-version order.
   */
  events(entity: object, depth: number): Promise<readonly Readonly<Event>[]> {
    return EntityHistory.require(entity).events(EntityHistory.depth(depth));
  },
  /**
   * Gets the state-history storage attached by the repository.
   *
   * @param entity Entity whose retained states are maintained.
   * @returns Its state-history storage.
   */
  stateMaintenance(entity: object): EntityStateHistoryStorage<unknown, Message> {
    return EntityHistory.require(entity).stateMaintenance;
  },
  /**
   * Gets diagnostic Event storage attached by the repository.
   *
   * @param entity Entity whose retained Events are maintained.
   * @returns Its diagnostic Event storage.
   */
  eventMaintenance(entity: object): EntityEventStorage<unknown> {
    return EntityHistory.require(entity).eventMaintenance;
  },
});

/**
 * Validates repository-bound history lookups.
 */
const EntityHistory = Object.freeze({
  /**
   * Gets history operations installed during repository execution.
   *
   * @param entity Entity instance whose binding is required.
   * @returns Its repository history operations.
   */
  require(entity: object): BoundEntityHistory {
    const binding = boundEntityHistories.get(entity);
    if (binding === undefined) {
      throw new Error("Entity history is available only from repository execution.");
    }
    return binding;
  },

  /**
   * Rejects history read limits that are not positive safe integers.
   *
   * @param depth Requested history read limit.
   * @returns The validated limit.
   */
  depth(depth: number): number {
    if (!Number.isSafeInteger(depth) || depth <= 0) {
      throw new RangeError("Entity history depth must be a positive safe integer.");
    }
    return depth;
  },
});

/**
 * Entity base with one active transaction draft.
 *
 * The transaction scope is backed by {@link EntityTransaction}. Subclasses can
 * start one active draft, mutate draft state and lifecycle through protected
 * helpers, and then commit or roll back the scope. Accepted commits replace this
 * Entity's state, framework-calculated Spine Version, and lifecycle flags.
 * Rejected commits leave the transaction active so subclass code can correct the
 * draft or roll it back explicitly. This base does not write repositories,
 * emit events, dispatch handlers, or manage global
 * transaction state.
 *
 * @typeParam Id Domain identifier type.
 * @typeParam Schema Generated schema describing the Entity state.
 */
export abstract class TransactionalEntity<
  Id,
  Schema extends DescriptorMessageSchema,
> extends Entity<Id, Schema> {
  #transaction: EntityTransaction<Schema> | undefined;

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
        draft: clone(VersionSchema, previousVersion),
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
   * Accepted commits apply state, Spine Version, and lifecycle flags to this
   * entity and close the transaction. Rejected commits do not apply anything and
   * keep the transaction active for correction or explicit rollback.
   *
   * @param producedEvents Whether handling returned Events, requiring a version advance.
   * @returns A cloned accepted or rejected transaction result.
   * @throws {@link TransactionalEntityScopeError} when no transaction is active.
   */
  protected commitTransaction(producedEvents = false): EntityTransactionCommitResult<Schema> {
    const transaction = this.#requireTransaction("commitTransaction");
    const result = transaction.commit(producedEvents);

    if (result.status === "accepted") {
      if (
        result.previous === undefined ||
        !EntitySnapshots.equal(this.schema, result.previous, result.next)
      ) {
        this.#stateChanged = true;
      }
      this.replaceState(result.next);
      this.replaceVersion(result.version.committed);
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
  protected rollbackTransaction(): EntityTransactionRollbackResult<Schema> {
    const result = this.#requireTransaction("rollbackTransaction").rollback();
    this.#transaction = undefined;

    return result;
  }

  /**
   * Gets the active transaction or rejects an out-of-scope operation.
   *
   * @param operation Draft operation being attempted.
   * @returns The currently active transaction.
   */
  #requireTransaction(operation: TransactionalEntityScopeOperation): EntityTransaction<Schema> {
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
   * Starts a transaction scope for repository execution.
   *
   * @param entity Transactional entity object to start.
   */
  start(entity: object): void;

  /**
   * Commits the transaction after repository handler execution.
   *
   * @param entity Transactional entity object to commit.
   * @param producedEvents Whether the handler returned Events.
   * @returns The transaction commit result.
   */
  commit(
    entity: object,
    producedEvents?: boolean,
  ): EntityTransactionCommitResult<DescriptorMessageSchema>;

  /**
   * Rolls back the Entity's active transaction, if one exists.
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
  /**
   * Starts the Entity's protected transaction before invoking its handler.
   *
   * @param entity Entity about to handle a signal.
   */
  start(entity: object): void {
    TransactionAccess.call(entity, "startTransaction");
  },

  /**
   * Commits the handler's draft and records whether it returned Events.
   *
   * @param entity Entity whose handler has completed.
   * @param producedEvents Whether handling returned domain Events.
   * @returns The accepted or validation-rejected transaction result.
   */
  commit(
    entity: object,
    producedEvents = false,
  ): EntityTransactionCommitResult<DescriptorMessageSchema> {
    return TransactionAccess.call(
      entity,
      "commitTransaction",
      producedEvents,
    ) as EntityTransactionCommitResult<DescriptorMessageSchema>;
  },

  /**
   * Rolls back an active draft, ignoring a transaction that has already closed.
   *
   * @param entity Entity whose handling failed or was rejected.
   */
  rollback(entity: object): void {
    try {
      TransactionAccess.call(entity, "rollbackTransaction");
    } catch (error) {
      if (!TransactionAccess.isMissing(error)) {
        throw error;
      }
    }
  },

  /**
   * Reads the validation failure retained for the Entity's latest rejected commit.
   *
   * @param entity Entity whose rejected result is requested.
   * @returns A copy of the rejected result, or undefined when none is retained.
   */
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
  /**
   * Invokes a protected transaction method from repository code.
   *
   * @param entity Instance receiving the method call.
   * @param methodName Transaction method to invoke.
   * @param args Arguments passed to the transaction method.
   * @returns The method's result.
   */
  call(entity: object, methodName: string, ...args: readonly unknown[]): unknown {
    const method = (entity as Record<string, unknown>)[methodName];

    if (typeof method !== "function") {
      throw new TypeError(`Transactional entity access requires "${methodName}".`);
    }

    return Reflect.apply(method, entity, args);
  },

  /**
   * Tests whether an operation failed because no transaction was active.
   *
   * @param error Failure returned by a transaction operation.
   * @returns True only for a missing transaction scope.
   */
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
 *
 * @typeParam Id Domain identifier type.
 * @typeParam Schema Generated schema describing the Aggregate state.
 */
export abstract class Aggregate<
  Id,
  Schema extends DescriptorMessageSchema,
> extends TransactionalEntity<Id, Schema> {
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
  constructor(options: EntityOptions<Id, Schema>) {
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
 *
 * @typeParam Id Domain identifier type.
 * @typeParam Schema Generated schema describing the Projection state.
 */
export abstract class Projection<
  Id,
  Schema extends DescriptorMessageSchema,
> extends TransactionalEntity<Id, Schema> {
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
  constructor(options: EntityOptions<Id, Schema>) {
    super(options);
    EntityFamilies.mark(this, "projection");
  }
}

/**
 * Abstract process manager family marker over the common transactional entity shell.
 *
 * This class adds a protected, handler-scoped, read-only Projection query
 * capability. It does not add command posting, repositories, bounded-context
 * injection, or handler invocation.
 *
 * @typeParam Id Domain identifier type.
 * @typeParam Schema Generated schema describing the Process Manager state.
 */
export abstract class ProcessManager<
  Id,
  Schema extends DescriptorMessageSchema,
> extends TransactionalEntity<Id, Schema> {
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
  constructor(options: EntityOptions<Id, Schema>) {
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

  /**
   * Starts a typed, eventually consistent read-side query during handler execution.
   *
   * The repository binds this capability only while it invokes a Process Manager
   * handler. Reads use that signal's actor and tenant; they cannot mutate state
   * or select a different tenant.
   *
   * @typeParam QuerySchema Generated Projection state schema to query.
   * @typeParam Columns Descriptor-backed columns available for that schema.
   * @param schema Projection state schema to query.
   * @param columns Generated descriptor-backed columns for `schema`.
   * @returns A read-only Entity query.
   */
  protected select<
    QuerySchema extends DescriptorMessageSchema,
    Columns extends ProcessManagerQueryColumns<QuerySchema>,
  >(schema: QuerySchema, columns: Columns): ProcessManagerQuery<QuerySchema, Columns> {
    const capability = processManagerQueryAccess.require(this);
    return new ProcessManagerQuery(
      this,
      schema,
      EntityQuery.select({ schema, columns, context: capability.actorContext }),
    );
  }
}

/**
 * Marks immutable entity families.
 */
const EntityFamilies = Object.freeze({
  /**
   * Sets an immutable family marker on an Entity instance.
   *
   * @param entity Instance being constructed.
   * @param family Aggregate, Projection, or Process Manager family marker.
   */
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
  /**
   * Copies state through its schema, discarding unknown wire fields.
   *
   * @typeParam Schema Generated schema describing the state.
   * @param schema Schema used for encoding and decoding.
   * @param state State snapshot to copy.
   * @returns An independent state message containing known fields.
   */
  clone<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    state: MessageShape<Schema>,
  ): MessageShape<Schema> {
    return fromBinary(schema, toBinary(schema, state, { writeUnknownFields: false }));
  },

  /**
   * Compares the encoded known fields of two state snapshots.
   *
   * @typeParam Schema Generated schema shared by both snapshots.
   * @param schema Schema used to encode the states.
   * @param previous State before handling.
   * @param next State after handling.
   * @returns True when their encoded known fields are identical.
   */
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
 * Copies transaction version, lifecycle, and validation snapshots.
 */
const EntityCommits = Object.freeze({
  /**
   * Copies version, lifecycle, and validation messages in a transaction result.
   *
   * @typeParam Schema Generated schema describing the transaction's state.
   * @param result Accepted or rejected transaction result.
   * @returns A result with independent version and validation metadata.
   */
  clone<Schema extends DescriptorMessageSchema>(
    result: EntityTransactionCommitResult<Schema>,
  ): EntityTransactionCommitResult<Schema> {
    if (result.status === "accepted") {
      return {
        ...result,
        version: {
          previous: clone(VersionSchema, result.version.previous),
          committed: clone(VersionSchema, result.version.committed),
        },
        lifecycle: { archived: result.lifecycle.archived, deleted: result.lifecycle.deleted },
        validation: this.validation(result.validation) as typeof result.validation,
      };
    }

    return {
      ...result,
      version: {
        previous: clone(VersionSchema, result.version.previous),
        draft: clone(VersionSchema, result.version.draft),
      },
      lifecycle: { archived: result.lifecycle.archived, deleted: result.lifecycle.deleted },
      validation: this.validation(result.validation) as typeof result.validation,
    };
  },

  /**
   * Copies validation errors without exposing the stored violation messages.
   *
   * @param validation State-transition validation result.
   * @returns An independent valid result or cloned validation error.
   */
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
