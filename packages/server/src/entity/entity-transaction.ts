import { clone, create, fromBinary, toBinary, type MessageShape } from "@bufbuild/protobuf";
import { ConstraintViolationSchema, type ConstraintViolation } from "@spine-ts/proto";

import type { DescriptorMessageSchema } from "./entity-metadata.js";
import {
  type EntityStateTransitionValidationResult,
  validateEntityStateTransition,
} from "./entity-transition-validation.js";

/** Lifecycle flags carried by an entity transaction draft and result. */
export interface EntityTransactionLifecycleFlags {
  /** Whether the draft entity state is archived. */
  readonly archived: boolean;
  /** Whether the draft entity state is deleted. */
  readonly deleted: boolean;
}

/** Explicit version metadata carried by an entity transaction draft. */
export interface EntityTransactionVersionMetadata<Version = unknown> {
  /** Caller-supplied previous committed version metadata. */
  readonly previous: Version;
  /** Caller-supplied draft version metadata. */
  readonly draft: Version;
}

/** Explicit version metadata returned by an accepted commit. */
export interface CommittedVersionMetadata<Version = unknown> {
  /** Caller-supplied previous committed version metadata. */
  readonly previous: Version;
  /** Draft metadata accepted by the commit boundary. */
  readonly committed: Version;
}

/** Visible lifecycle status of an entity transaction. */
export type EntityTransactionStatus = "active" | "committed" | "rolled-back";

/** Transaction operation guarded by active-status checks. */
export type EntityTransactionOperation =
  | "archive"
  | "commit"
  | "markDeleted"
  | "requireActive"
  | "restore"
  | "rollback"
  | "tryUpdate"
  | "unarchive"
  | "update"
  | "updateVersionMetadata";

/** Draft lifecycle reason that prevents active-only entity state mutation. */
export type DraftStateReason = "archived" | "deleted";

/** Function that mutates an entity-state draft in place. */
export type EntityTransactionMutator<Schema extends DescriptorMessageSchema> = (
  draft: MessageShape<Schema>,
) => void;

const noConstraintViolations: readonly ConstraintViolation[] = Object.freeze([]);

/** Options for creating an {@link EntityTransaction}. */
export interface EntityTransactionOptions<
  Schema extends DescriptorMessageSchema,
  Version = unknown,
> {
  /** Generated Protobuf-ES schema describing the entity state. */
  readonly schema: Schema;
  /** Previous committed entity state, absent for creation transactions. */
  readonly previous: MessageShape<Schema> | undefined;
  /** Initial draft state. Defaults to a clone of `previous`, or an empty state for creations. */
  readonly draft?: MessageShape<Schema>;
  /** Explicit version metadata to carry through draft, commit, and rollback results. */
  readonly version: EntityTransactionVersionMetadata<Version>;
  /** Draft lifecycle flags. Defaults to active, not deleted. */
  readonly lifecycle?: Partial<EntityTransactionLifecycleFlags>;
}

/** Result returned when a transaction commit is accepted. */
export interface EntityTransactionAcceptedCommit<
  Schema extends DescriptorMessageSchema,
  Version = unknown,
> {
  /** Commit result discriminator. */
  readonly status: "accepted";
  /** Previous committed state snapshot. */
  readonly previous: MessageShape<Schema> | undefined;
  /** Accepted next state snapshot. */
  readonly next: MessageShape<Schema>;
  /** Accepted commit version metadata. */
  readonly version: CommittedVersionMetadata<Version>;
  /** Lifecycle flags accepted with the committed state. */
  readonly lifecycle: EntityTransactionLifecycleFlags;
  /** Successful transition validation result. */
  readonly validation: EntityStateTransitionValidationResult & { readonly valid: true };
}

/** Result returned when a transaction commit is rejected by validation. */
export interface EntityTransactionRejectedCommit<
  Schema extends DescriptorMessageSchema,
  Version = unknown,
> {
  /** Commit result discriminator. */
  readonly status: "rejected";
  /** Previous committed state snapshot. */
  readonly previous: MessageShape<Schema> | undefined;
  /** Rejected draft state snapshot. */
  readonly next: MessageShape<Schema>;
  /** Draft version metadata that was not accepted. */
  readonly version: EntityTransactionVersionMetadata<Version>;
  /** Lifecycle flags that were not accepted. */
  readonly lifecycle: EntityTransactionLifecycleFlags;
  /** Failed transition validation result with validator violations. */
  readonly validation: EntityStateTransitionValidationResult & { readonly valid: false };
}

/** Structured result returned by {@link EntityTransaction.commit}. */
export type EntityTransactionCommitResult<
  Schema extends DescriptorMessageSchema,
  Version = unknown,
> =
  | EntityTransactionAcceptedCommit<Schema, Version>
  | EntityTransactionRejectedCommit<Schema, Version>;

/** Structured result returned by {@link EntityTransaction.rollback}. */
export interface EntityTransactionRollbackResult<
  Schema extends DescriptorMessageSchema,
  Version = unknown,
> {
  /** Rollback result discriminator. */
  readonly status: "rolled-back";
  /** Previous committed state snapshot. */
  readonly previous: MessageShape<Schema> | undefined;
  /** Draft state snapshot that was discarded. */
  readonly draft: MessageShape<Schema>;
  /** Draft version metadata that was discarded. */
  readonly version: EntityTransactionVersionMetadata<Version>;
  /** Lifecycle flags that were discarded. */
  readonly lifecycle: EntityTransactionLifecycleFlags;
}

/** Error thrown when transaction methods are called after commit or rollback. */
export class EntityTransactionStateError extends Error {
  /** Transaction status that rejected the operation. */
  readonly status: EntityTransactionStatus;

  /** Operation rejected by the transaction status. */
  readonly operation: EntityTransactionOperation;

  /** Create a deterministic closed-transaction error. */
  constructor(status: EntityTransactionStatus, operation: EntityTransactionOperation) {
    super(`Cannot ${operation} an entity transaction with status "${status}".`);
    this.name = "EntityTransactionStateError";
    this.status = status;
    this.operation = operation;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when active-only state mutation is attempted for an archived or
 * deleted draft.
 *
 * The error exposes only the deterministic draft lifecycle reason. It does not
 * include entity state payloads, IDs, or previous/draft values.
 */
export class DraftStateError extends Error {
  /** Draft lifecycle reason that rejected active-only mutation. */
  readonly reason: DraftStateReason;

  /** Create a deterministic draft lifecycle guard error. */
  constructor(reason: DraftStateReason) {
    super(`Cannot mutate active entity state while the draft is ${reason}.`);
    this.name = "DraftStateError";
    this.reason = reason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Framework-owned buffered transaction over one entity state draft.
 *
 * The transaction owns only in-memory draft/result data. It does not invoke
 * handlers, write repositories, apply snapshots, dispatch messages, start
 * buses, or participate in async-local/global transaction state.
 */
export class EntityTransaction<Schema extends DescriptorMessageSchema, Version = unknown> {
  readonly #schema: Schema;
  readonly #previous: MessageShape<Schema> | undefined;
  #draft: MessageShape<Schema>;
  #status: EntityTransactionStatus = "active";
  #version: EntityTransactionVersionMetadata<Version>;
  #lifecycle: EntityTransactionLifecycleFlags;

  /** Create a transaction over previous state and a buffered draft. */
  constructor(options: EntityTransactionOptions<Schema, Version>) {
    this.#schema = options.schema;
    this.#previous =
      options.previous === undefined ? undefined : cloneState(options.schema, options.previous);
    this.#draft = cloneState(
      options.schema,
      options.draft ?? options.previous ?? create(options.schema),
    );
    this.#version = {
      previous: options.version.previous,
      draft: options.version.draft,
    };
    this.#lifecycle = {
      archived: options.lifecycle?.archived ?? false,
      deleted: options.lifecycle?.deleted ?? false,
    };
  }

  /** Current lifecycle status of the transaction. */
  get status(): EntityTransactionStatus {
    return this.#status;
  }

  /** Previous committed state snapshot, absent for creation transactions. */
  get previous(): MessageShape<Schema> | undefined {
    return this.#previous === undefined ? undefined : cloneState(this.#schema, this.#previous);
  }

  /** Current draft state snapshot. */
  get currentDraft(): MessageShape<Schema> {
    return cloneState(this.#schema, this.#draft);
  }

  /** Explicit version metadata carried by the current draft. */
  get version(): EntityTransactionVersionMetadata<Version> {
    return { previous: this.#version.previous, draft: this.#version.draft };
  }

  /** Lifecycle flags carried by the current draft. */
  get lifecycle(): EntityTransactionLifecycleFlags {
    return { archived: this.#lifecycle.archived, deleted: this.#lifecycle.deleted };
  }

  /**
   * Require an active, non-archived, non-deleted draft for entity state mutation.
   *
   * This guard is intentionally local to the buffered transaction draft. It
   * does not query repositories, filter read-side results, or inspect storage.
   *
   * @throws {@link EntityTransactionStateError} when the transaction was already
   * committed or rolled back.
   * @throws {@link DraftStateError} when the active draft is
   * archived or deleted.
   */
  requireActive(): void {
    this.#requireActiveStatus("requireActive");
    this.#requireDraftAllowsStateMutation();
  }

  /**
   * Mutate the buffered draft in place.
   *
   * The mutator receives the live draft. The previous committed state is never
   * exposed as mutable transaction storage. Mutators must complete
   * synchronously; a returned thenable is rejected and cannot later mutate the
   * live draft. If a synchronous mutator throws after changing the draft, its
   * partial changes remain visible.
   */
  update(mutator: EntityTransactionMutator<Schema>): MessageShape<Schema> {
    this.#requireActiveForStateMutation("update");
    const before = cloneState(this.#schema, this.#draft);
    try {
      invokeSynchronousMutator(mutator, this.#draft);
    } catch (error) {
      if (error instanceof AsyncMutatorError) {
        this.#draft = before;
      }
      throw error;
    }

    return this.currentDraft;
  }

  /**
   * Mutate and validate a scratch draft, applying it only when it is valid.
   *
   * Validation failures are returned as an immutable violations list. Errors
   * thrown by the mutator propagate and leave the live draft unchanged.
   * Mutators must complete synchronously; returned thenables are rejected.
   */
  tryUpdate(mutator: EntityTransactionMutator<Schema>): readonly ConstraintViolation[] {
    this.#requireActiveForStateMutation("tryUpdate");
    const candidate = cloneState(this.#schema, this.#draft);
    invokeSynchronousMutator(mutator, candidate);

    const validation = validateEntityStateTransition({
      schema: this.#schema,
      previous: this.#previous,
      next: candidate,
    });
    if (!validation.valid) {
      return Object.freeze(
        validation.violations.map((violation) =>
          deepFreeze(clone(ConstraintViolationSchema, violation)),
        ),
      );
    }

    this.#draft = cloneState(this.#schema, candidate);
    return noConstraintViolations;
  }

  /**
   * Mark the buffered draft as archived.
   *
   * The helper changes only in-memory draft lifecycle metadata. It does not
   * persist lifecycle state, emit lifecycle events, or filter queries.
   */
  archive(): EntityTransactionLifecycleFlags {
    this.#replaceLifecycle("archive", { archived: true });

    return this.lifecycle;
  }

  /**
   * Mark the buffered draft as not archived.
   *
   * The helper changes only in-memory draft lifecycle metadata. It does not
   * persist lifecycle state, emit lifecycle events, or filter queries.
   */
  unarchive(): EntityTransactionLifecycleFlags {
    this.#replaceLifecycle("unarchive", { archived: false });

    return this.lifecycle;
  }

  /**
   * Mark the buffered draft as deleted.
   *
   * The helper changes only in-memory draft lifecycle metadata. It does not
   * persist lifecycle state, emit lifecycle events, or filter queries.
   */
  markDeleted(): EntityTransactionLifecycleFlags {
    this.#replaceLifecycle("markDeleted", { deleted: true });

    return this.lifecycle;
  }

  /**
   * Mark the buffered draft as not deleted.
   *
   * The helper changes only in-memory draft lifecycle metadata. It does not
   * persist lifecycle state, emit lifecycle events, or filter queries.
   */
  restore(): EntityTransactionLifecycleFlags {
    this.#replaceLifecycle("restore", { deleted: false });

    return this.lifecycle;
  }

  /**
   * Replace caller-owned explicit draft version metadata.
   *
   * This helper does not compute version increments, timestamps, producer
   * metadata, or event versions. It preserves the transaction's `Version`
   * generic and returns a snapshot of the previous/draft metadata pair.
   */
  updateVersionMetadata(draft: Version): EntityTransactionVersionMetadata<Version> {
    this.#requireActiveStatus("updateVersionMetadata");
    this.#version = {
      previous: this.#version.previous,
      draft,
    };

    return this.version;
  }

  /**
   * Validate and commit the current draft at this transaction boundary.
   *
   * Ordinary entity state validation failures are returned as rejected commit
   * results with validator violations. They do not throw and do not mark the
   * transaction committed.
   */
  commit(): EntityTransactionCommitResult<Schema, Version> {
    this.#requireActiveStatus("commit");

    const previous = this.previous;
    const next = this.currentDraft;
    const validation = validateEntityStateTransition({
      schema: this.#schema,
      previous,
      next,
    });

    if (!validation.valid) {
      return {
        status: "rejected",
        previous,
        next,
        version: this.version,
        lifecycle: this.lifecycle,
        validation,
      };
    }

    this.#status = "committed";

    return {
      status: "accepted",
      previous,
      next,
      version: {
        previous: this.#version.previous,
        committed: this.#version.draft,
      },
      lifecycle: this.lifecycle,
      validation,
    };
  }

  /**
   * Release the transaction and return the unaccepted draft evidence.
   *
   * Rollback does not validate or accept state. It only closes this in-memory
   * transaction so future updates or commits are rejected deterministically.
   */
  rollback(): EntityTransactionRollbackResult<Schema, Version> {
    this.#requireActiveStatus("rollback");
    this.#status = "rolled-back";

    return {
      status: "rolled-back",
      previous: this.previous,
      draft: this.currentDraft,
      version: this.version,
      lifecycle: this.lifecycle,
    };
  }

  #replaceLifecycle(
    operation: "archive" | "markDeleted" | "restore" | "unarchive",
    updates: Partial<EntityTransactionLifecycleFlags>,
  ): void {
    this.#requireActiveStatus(operation);
    this.#lifecycle = {
      archived: updates.archived ?? this.#lifecycle.archived,
      deleted: updates.deleted ?? this.#lifecycle.deleted,
    };
  }

  #requireActiveForStateMutation(operation: "tryUpdate" | "update"): void {
    this.#requireActiveStatus(operation);
    this.#requireDraftAllowsStateMutation();
  }

  #requireActiveStatus(operation: EntityTransactionOperation): void {
    if (this.#status !== "active") {
      throw new EntityTransactionStateError(this.#status, operation);
    }
  }

  #requireDraftAllowsStateMutation(): void {
    if (this.#lifecycle.archived) {
      throw new DraftStateError("archived");
    }
    if (this.#lifecycle.deleted) {
      throw new DraftStateError("deleted");
    }
  }
}

class AsyncMutatorError extends TypeError {
  constructor() {
    super("Entity state mutators must be synchronous.");
    this.name = "AsyncMutatorError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function invokeSynchronousMutator<Schema extends DescriptorMessageSchema>(
  mutator: EntityTransactionMutator<Schema>,
  draft: MessageShape<Schema>,
): void {
  const result = (mutator as (state: MessageShape<Schema>) => unknown)(draft);
  if (!isThenable(result)) {
    return;
  }

  void Promise.resolve(result).catch(() => undefined);
  throw new AsyncMutatorError();
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === "object" && value !== null) || typeof value === "function") &&
    typeof (value as { readonly then?: unknown }).then === "function"
  );
}

function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return value;
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);

  for (const child of Object.values(value)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

/** Create an {@link EntityTransaction} with inferred schema state typing. */
export function createEntityTransaction<Schema extends DescriptorMessageSchema, Version = unknown>(
  options: EntityTransactionOptions<Schema, Version>,
): EntityTransaction<Schema, Version> {
  return new EntityTransaction(options);
}

function cloneState<Schema extends DescriptorMessageSchema>(
  schema: Schema,
  state: MessageShape<Schema>,
): MessageShape<Schema> {
  return fromBinary(schema, toBinary(schema, state, { writeUnknownFields: false }));
}
