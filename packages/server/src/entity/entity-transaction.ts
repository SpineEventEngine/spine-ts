import { clone, create, fromBinary, toBinary, type MessageShape } from "@bufbuild/protobuf";
import { ConstraintViolationSchema, type ConstraintViolation } from "@spine-event-engine/proto";

import type { DescriptorMessageSchema } from "./entity-metadata.js";
import {
  type StateTransitionResult,
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

/** Updates an entity-state draft in place.
 *
 * @param draft - Live or scratch state draft to mutate synchronously.
 */
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
  readonly validation: StateTransitionResult & { readonly valid: true };
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
  readonly validation: StateTransitionResult & { readonly valid: false };
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

  /** Creates a deterministic closed-transaction error.
   *
   * @param status - Status that made the operation unavailable.
   * @param operation - Operation that was rejected.
   */
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

  /** Creates a deterministic draft lifecycle guard error.
   *
   * @param reason - Draft lifecycle reason that prevented mutation.
   */
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

  /** Creates a transaction over previous state and a buffered draft.
   *
   * @param options - State, version, and lifecycle inputs for the transaction.
   */
  constructor(options: EntityTransactionOptions<Schema, Version>) {
    this.#schema = options.schema;
    this.#previous =
      options.previous === undefined
        ? undefined
        : TransactionDrafts.clone(options.schema, options.previous);
    this.#draft = TransactionDrafts.clone(
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

  /** Gets the current lifecycle status of the transaction.
   *
   * @returns The active, committed, or rolled-back status.
   */
  get status(): EntityTransactionStatus {
    return this.#status;
  }

  /** Gets the previous committed state snapshot, absent for creation transactions.
   *
   * @returns A cloned prior state, if one exists.
   */
  get previous(): MessageShape<Schema> | undefined {
    return this.#previous === undefined
      ? undefined
      : TransactionDrafts.clone(this.#schema, this.#previous);
  }

  /** Gets the current draft state snapshot.
   *
   * @returns A cloned draft state.
   */
  get currentDraft(): MessageShape<Schema> {
    return TransactionDrafts.clone(this.#schema, this.#draft);
  }

  /** Gets explicit version metadata carried by the current draft.
   *
   * @returns The previous and draft version metadata.
   */
  get version(): EntityTransactionVersionMetadata<Version> {
    return { previous: this.#version.previous, draft: this.#version.draft };
  }

  /** Gets lifecycle flags carried by the current draft.
   *
   * @returns The current archived and deleted flags.
   */
  get lifecycle(): EntityTransactionLifecycleFlags {
    return { archived: this.#lifecycle.archived, deleted: this.#lifecycle.deleted };
  }

  /**
   * Ensures an active, non-archived, non-deleted draft for entity state mutation.
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
   * Updates the buffered draft in place.
   *
   * The mutator receives the live draft. The previous committed state is never
   * exposed as mutable transaction storage. Mutators must complete
   * synchronously; a returned thenable is rejected and cannot later mutate the
   * live draft. If a synchronous mutator throws after changing the draft, its
   * partial changes remain visible.
   *
   * @param mutator - Synchronous operation that changes the live draft.
   * @returns A cloned snapshot of the changed draft.
   */
  update(mutator: EntityTransactionMutator<Schema>): MessageShape<Schema> {
    this.#requireActiveForStateMutation("update");
    const before = TransactionDrafts.clone(this.#schema, this.#draft);
    try {
      TransactionDrafts.invoke(mutator, this.#draft);
    } catch (error) {
      if (error instanceof AsyncMutatorError) {
        this.#draft = before;
      }
      throw error;
    }

    return this.currentDraft;
  }

  /**
   * Validates and applies a scratch draft only when it is valid.
   *
   * Validation failures are returned as an immutable violations list. Errors
   * thrown by the mutator propagate and leave the live draft unchanged.
   * Mutators must complete synchronously; returned thenables are rejected.
   *
   * @param mutator - Synchronous operation that changes a scratch draft.
   * @returns An empty frozen list when applied, or validation violations.
   */
  tryUpdate(mutator: EntityTransactionMutator<Schema>): readonly ConstraintViolation[] {
    this.#requireActiveForStateMutation("tryUpdate");
    const candidate = TransactionDrafts.clone(this.#schema, this.#draft);
    TransactionDrafts.invoke(mutator, candidate);

    const validation = validateEntityStateTransition({
      schema: this.#schema,
      previous: this.#previous,
      next: candidate,
    });
    if (!validation.valid) {
      return Object.freeze(
        validation.violations.map((violation) =>
          TransactionDrafts.freeze(clone(ConstraintViolationSchema, violation)),
        ),
      );
    }

    this.#draft = TransactionDrafts.clone(this.#schema, candidate);
    return noConstraintViolations;
  }

  /**
   * Updates the buffered draft to archived.
   *
   * The helper changes only in-memory draft lifecycle metadata. It does not
   * persist lifecycle state, emit lifecycle events, or filter queries.
   *
   * @returns The changed lifecycle flags.
   */
  archive(): EntityTransactionLifecycleFlags {
    this.#replaceLifecycle("archive", { archived: true });

    return this.lifecycle;
  }

  /**
   * Updates the buffered draft to not archived.
   *
   * The helper changes only in-memory draft lifecycle metadata. It does not
   * persist lifecycle state, emit lifecycle events, or filter queries.
   *
   * @returns The changed lifecycle flags.
   */
  unarchive(): EntityTransactionLifecycleFlags {
    this.#replaceLifecycle("unarchive", { archived: false });

    return this.lifecycle;
  }

  /**
   * Updates the buffered draft to deleted.
   *
   * The helper changes only in-memory draft lifecycle metadata. It does not
   * persist lifecycle state, emit lifecycle events, or filter queries.
   *
   * @returns The changed lifecycle flags.
   */
  markDeleted(): EntityTransactionLifecycleFlags {
    this.#replaceLifecycle("markDeleted", { deleted: true });

    return this.lifecycle;
  }

  /**
   * Updates the buffered draft to not deleted.
   *
   * The helper changes only in-memory draft lifecycle metadata. It does not
   * persist lifecycle state, emit lifecycle events, or filter queries.
   *
   * @returns The changed lifecycle flags.
   */
  restore(): EntityTransactionLifecycleFlags {
    this.#replaceLifecycle("restore", { deleted: false });

    return this.lifecycle;
  }

  /**
   * Updates caller-owned explicit draft version metadata.
   *
   * This helper does not compute version increments, timestamps, producer
   * metadata, or event versions. It preserves the transaction's `Version`
   * generic and returns a snapshot of the previous/draft metadata pair.
   *
   * @param draft - Replacement caller-owned draft version metadata.
   * @returns The updated previous and draft metadata.
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
   * Validates and commits the current draft at this transaction boundary.
   *
   * Ordinary entity state validation failures are returned as rejected commit
   * results with validator violations. They do not throw and do not mark the
   * transaction committed.
   *
   * @returns An accepted commit or a validation-rejected result.
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
   * Returns unaccepted draft evidence and closes the transaction.
   *
   * Rollback does not validate or accept state. It only closes this in-memory
   * transaction so future updates or commits are rejected deterministically.
   *
   * @returns The discarded draft and prior-state evidence.
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

/** Owns cloning, synchronous mutation, and immutable validation snapshots for transactions. */
const TransactionDrafts = Object.freeze({
  clone<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    state: MessageShape<Schema>,
  ): MessageShape<Schema> {
    return fromBinary(schema, toBinary(schema, state, { writeUnknownFields: false }));
  },

  invoke<Schema extends DescriptorMessageSchema>(
    mutator: EntityTransactionMutator<Schema>,
    draft: MessageShape<Schema>,
  ): void {
    const result = (mutator as (state: MessageShape<Schema>) => unknown)(draft);
    if (!this.isThenable(result)) {
      return;
    }

    void Promise.resolve(result).catch(() => undefined);
    throw new AsyncMutatorError();
  },

  isThenable(value: unknown): value is PromiseLike<unknown> {
    return (
      ((typeof value === "object" && value !== null) || typeof value === "function") &&
      typeof (value as { readonly then?: unknown }).then === "function"
    );
  },

  freeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) {
      return value;
    }
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);

    for (const child of Object.values(value)) {
      this.freeze(child, seen);
    }
    return Object.freeze(value);
  },
});

/** Creates a transaction with inferred schema state typing.
 *
 * @param options - State, version, and lifecycle inputs for the transaction.
 * @returns A new isolated entity transaction.
 */
export function createEntityTransaction<Schema extends DescriptorMessageSchema, Version = unknown>(
  options: EntityTransactionOptions<Schema, Version>,
): EntityTransaction<Schema, Version> {
  return new EntityTransaction(options);
}
