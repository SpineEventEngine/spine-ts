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

import { clone, create, fromBinary, toBinary, type MessageShape } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  ConstraintViolationSchema,
  VersionSchema,
  type ConstraintViolation,
  type Version,
} from "@spine-event-engine/proto";

import type { DescriptorMessageSchema } from "./entity-metadata.js";
import {
  type StateTransitionResult,
  validateEntityStateTransition,
} from "./entity-transition-validation.js";

/**
 * Lifecycle flags carried by an entity transaction draft and result.
 */
export interface EntityTransactionLifecycleFlags {
  // prettier-ignore

  /**
   * Whether the draft entity state is archived.
   */
  readonly archived: boolean;

  /**
   * Whether the draft entity state is deleted.
   */
  readonly deleted: boolean;
}

/**
 * Spine Version values captured before a transaction commits.
 */
export interface EntityTransactionVersionMetadata {
  // prettier-ignore

  /**
   * Version of the Entity before this transaction.
   */
  readonly previous: Version;

  /**
   * Version copied into the initial draft.
   */
  readonly draft: Version;
}

/**
 * Spine Version values before and after an accepted commit.
 */
export interface CommittedVersionMetadata {
  // prettier-ignore

  /**
   * Version of the Entity before this transaction.
   */
  readonly previous: Version;

  /**
   * Version calculated by the accepted commit.
   */
  readonly committed: Version;
}

/**
 * Visible lifecycle status of an entity transaction.
 */
export type EntityTransactionStatus = "active" | "committed" | "rolled-back";

/**
 * Transaction operation guarded by active-status checks.
 */
export type EntityTransactionOperation =
  | "archive"
  | "commit"
  | "markDeleted"
  | "requireActive"
  | "restore"
  | "rollback"
  | "tryUpdate"
  | "unarchive"
  | "update";

/**
 * Draft lifecycle reason that prevents active-only entity state mutation.
 */
export type DraftStateReason = "archived" | "deleted";

/**
 * Updates an entity-state draft in place.
 *
 * @typeParam Schema Generated schema describing the mutable draft state.
 * @param draft Live or scratch state draft to mutate synchronously.
 */
export type EntityTransactionMutator<Schema extends DescriptorMessageSchema> = (
  draft: MessageShape<Schema>,
) => void;

const noConstraintViolations: readonly ConstraintViolation[] = Object.freeze([]);

/**
 * Options for creating an {@link EntityTransaction}.
 *
 * @typeParam Schema Generated schema describing the Entity state.
 */
export interface EntityTransactionOptions<Schema extends DescriptorMessageSchema> {
  // prettier-ignore

  /**
   * Generated Protobuf-ES schema describing the entity state.
   */
  readonly schema: Schema;

  /**
   * Previous committed entity state, absent for creation transactions.
   */
  readonly previous: MessageShape<Schema> | undefined;

  /**
   * Initial draft state. Defaults to a clone of `previous`, or an empty state for creations.
   */
  readonly draft?: MessageShape<Schema>;

  /**
   * Spine Version snapshots supplied by framework transaction code.
   */
  readonly version: EntityTransactionVersionMetadata;

  /**
   * Draft lifecycle flags. Defaults to active, not deleted.
   */
  readonly lifecycle?: Partial<EntityTransactionLifecycleFlags>;
}

/**
 * Result returned when a transaction commit is accepted.
 *
 * @typeParam Schema Generated schema describing the committed Entity state.
 */
export interface EntityTransactionAcceptedCommit<Schema extends DescriptorMessageSchema> {
  // prettier-ignore

  /**
   * Commit result discriminator.
   */
  readonly status: "accepted";

  /**
   * Previous committed state snapshot.
   */
  readonly previous: MessageShape<Schema> | undefined;

  /**
   * Accepted next state snapshot.
   */
  readonly next: MessageShape<Schema>;

  /**
   * Accepted commit version metadata.
   */
  readonly version: CommittedVersionMetadata;

  /**
   * Lifecycle flags accepted with the committed state.
   */
  readonly lifecycle: EntityTransactionLifecycleFlags;

  /**
   * Successful transition validation result.
   */
  readonly validation: StateTransitionResult & { readonly valid: true };
}

/**
 * Result returned when a transaction commit is rejected by validation.
 *
 * @typeParam Schema Generated schema describing the rejected Entity state.
 */
export interface EntityTransactionRejectedCommit<Schema extends DescriptorMessageSchema> {
  // prettier-ignore

  /**
   * Commit result discriminator.
   */
  readonly status: "rejected";

  /**
   * Previous committed state snapshot.
   */
  readonly previous: MessageShape<Schema> | undefined;

  /**
   * Rejected draft state snapshot.
   */
  readonly next: MessageShape<Schema>;

  /**
   * Draft version metadata that was not accepted.
   */
  readonly version: EntityTransactionVersionMetadata;

  /**
   * Lifecycle flags that were not accepted.
   */
  readonly lifecycle: EntityTransactionLifecycleFlags;

  /**
   * Failed transition validation result with validator violations.
   */
  readonly validation: StateTransitionResult & { readonly valid: false };
}

/**
 * Structured result returned by {@link EntityTransaction.commit}.
 *
 * @typeParam Schema Generated schema describing the transaction's state.
 */
export type EntityTransactionCommitResult<Schema extends DescriptorMessageSchema> =
  EntityTransactionAcceptedCommit<Schema> | EntityTransactionRejectedCommit<Schema>;

/**
 * Structured result returned by {@link EntityTransaction.rollback}.
 *
 * @typeParam Schema Generated schema describing the discarded draft state.
 */
export interface EntityTransactionRollbackResult<Schema extends DescriptorMessageSchema> {
  // prettier-ignore

  /**
   * Rollback result discriminator.
   */
  readonly status: "rolled-back";

  /**
   * Previous committed state snapshot.
   */
  readonly previous: MessageShape<Schema> | undefined;

  /**
   * Draft state snapshot that was discarded.
   */
  readonly draft: MessageShape<Schema>;

  /**
   * Draft version metadata that was discarded.
   */
  readonly version: EntityTransactionVersionMetadata;

  /**
   * Lifecycle flags that were discarded.
   */
  readonly lifecycle: EntityTransactionLifecycleFlags;
}

/**
 * Error thrown when transaction methods are called after commit or rollback.
 */
export class EntityTransactionStateError extends Error {
  // prettier-ignore

  /**
   * Transaction status that rejected the operation.
   */
  readonly status: EntityTransactionStatus;

  /**
   * Operation rejected by the transaction status.
   */
  readonly operation: EntityTransactionOperation;

  /**
   * Creates a deterministic closed-transaction error.
   *
   * @param status Status that made the operation unavailable.
   * @param operation Operation that was rejected.
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
  // prettier-ignore

  /**
   * Draft lifecycle reason that rejected active-only mutation.
   */
  readonly reason: DraftStateReason;

  /**
   * Creates a deterministic draft lifecycle guard error.
   *
   * @param reason Draft lifecycle reason that prevented mutation.
   */
  constructor(reason: DraftStateReason) {
    super(`Cannot mutate active entity state while the draft is ${reason}.`);
    this.name = "DraftStateError";
    this.reason = reason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Framework transaction over one buffered Entity state draft.
 *
 * The transaction manages only in-memory draft and result data. It does not invoke
 * handlers, write repositories, apply snapshots, dispatch messages, start
 * buses, or participate in async-local/global transaction state.
 *
 * @typeParam Schema Generated schema describing the Entity state.
 */
export class EntityTransaction<Schema extends DescriptorMessageSchema> {
  readonly #schema: Schema;

  readonly #previous: MessageShape<Schema> | undefined;

  readonly #initialDraft: MessageShape<Schema>;

  #draft: MessageShape<Schema>;

  #status: EntityTransactionStatus = "active";

  #version: EntityTransactionVersionMetadata;

  #lifecycle: EntityTransactionLifecycleFlags;

  readonly #initialLifecycle: EntityTransactionLifecycleFlags;

  /**
   * Creates a transaction over previous state and a buffered draft.
   *
   * @param options State, version, and lifecycle inputs for the transaction.
   */
  constructor(options: EntityTransactionOptions<Schema>) {
    this.#schema = options.schema;
    this.#previous =
      options.previous === undefined
        ? undefined
        : TransactionDrafts.clone(options.schema, options.previous);
    this.#draft = TransactionDrafts.clone(
      options.schema,
      options.draft ?? options.previous ?? create(options.schema),
    );
    this.#initialDraft = TransactionDrafts.clone(options.schema, this.#draft);
    this.#version = {
      previous: clone(VersionSchema, options.version.previous),
      draft: clone(VersionSchema, options.version.draft),
    };
    this.#lifecycle = {
      archived: options.lifecycle?.archived ?? false,
      deleted: options.lifecycle?.deleted ?? false,
    };
    this.#initialLifecycle = this.lifecycle;
  }

  /**
   * Gets the current lifecycle status of the transaction.
   *
   * @returns The active, committed, or rolled-back status.
   */
  get status(): EntityTransactionStatus {
    return this.#status;
  }

  /**
   * Gets the previous committed state snapshot, absent for creation transactions.
   *
   * @returns A cloned prior state, if one exists.
   */
  get previous(): MessageShape<Schema> | undefined {
    return this.#previous === undefined
      ? undefined
      : TransactionDrafts.clone(this.#schema, this.#previous);
  }

  /**
   * Gets the current draft state snapshot.
   *
   * @returns A cloned draft state.
   */
  get currentDraft(): MessageShape<Schema> {
    return TransactionDrafts.clone(this.#schema, this.#draft);
  }

  /**
   * Gets independent copies of the initial Spine Version values.
   *
   * @returns Previous and initial draft Version snapshots.
   */
  get version(): EntityTransactionVersionMetadata {
    return {
      previous: clone(VersionSchema, this.#version.previous),
      draft: clone(VersionSchema, this.#version.draft),
    };
  }

  /**
   * Gets lifecycle flags carried by the current draft.
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
   * @param mutator Synchronous operation that changes the live draft.
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
   * @param mutator Synchronous operation that changes a scratch draft.
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
   * Validates and commits the current draft at this transaction boundary.
   *
   * Ordinary entity state validation failures are returned as rejected commit
   * results with validator violations. They do not throw and do not mark the
   * transaction committed. A no-op skips validation and preserves the version.
   *
   * @param producedEvents Whether handling returned Events, requiring a version advance.
   * @returns An accepted commit or a validation-rejected result.
   */
  commit(producedEvents = false): EntityTransactionCommitResult<Schema> {
    this.#requireActiveStatus("commit");

    const previous = this.previous;
    const next = this.currentDraft;
    const validation = this.#changed(next, producedEvents)
      ? validateEntityStateTransition({ schema: this.#schema, previous, next })
      : { valid: true as const, violations: [] as const, error: undefined };

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
    const committed = this.#commitVersion(next, producedEvents);

    return {
      status: "accepted",
      previous,
      next,
      version: {
        previous: clone(VersionSchema, this.#version.previous),
        committed,
      },
      lifecycle: this.lifecycle,
      validation,
    };
  }

  /**
   * Advances the Entity version once for a visible change or produced Events.
   *
   * @param next Accepted state.
   * @param producedEvents Whether the handler produced Events.
   * @returns The committed Spine Version.
   */
  #commitVersion(next: MessageShape<Schema>, producedEvents: boolean): Version {
    const version = this.#version.previous;
    if (!this.#changed(next, producedEvents)) {
      return clone(VersionSchema, version);
    }
    const milliseconds = Date.now();
    return create(VersionSchema, {
      number: version.number + 1,
      timestamp: create(TimestampSchema, {
        seconds: BigInt(Math.floor(milliseconds / 1_000)),
        nanos: (milliseconds % 1_000) * 1_000_000,
      }),
    });
  }

  /**
   * Tests whether a dispatch produced Events or changed state or lifecycle.
   *
   * @param next Draft state to compare with the initial state.
   * @param producedEvents Whether the handler produced Events.
   * @returns `true` when the dispatch requires a new Version.
   */
  #changed(next: MessageShape<Schema>, producedEvents: boolean): boolean {
    return (
      producedEvents ||
      !TransactionDrafts.equal(this.#schema, this.#initialDraft, next) ||
      this.#lifecycle.archived !== this.#initialLifecycle.archived ||
      this.#lifecycle.deleted !== this.#initialLifecycle.deleted
    );
  }

  /**
   * Returns unaccepted draft evidence and closes the transaction.
   *
   * Rollback does not validate or accept state. It only closes this in-memory
   * transaction so future updates or commits are rejected deterministically.
   *
   * @returns The discarded draft and prior-state evidence.
   */
  rollback(): EntityTransactionRollbackResult<Schema> {
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

  /**
   * Updates lifecycle flags while the transaction is active.
   *
   * @param operation Lifecycle operation used in an out-of-scope error.
   * @param updates Flags to replace in the draft.
   */
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

  /**
   * Checks transaction status and lifecycle before state mutation.
   *
   * @param operation State mutation being attempted.
   */
  #requireActiveForStateMutation(operation: "tryUpdate" | "update"): void {
    this.#requireActiveStatus(operation);
    this.#requireDraftAllowsStateMutation();
  }

  /**
   * Rejects operations after commit or rollback.
   *
   * @param operation Operation being attempted on the transaction.
   */
  #requireActiveStatus(operation: EntityTransactionOperation): void {
    if (this.#status !== "active") {
      throw new EntityTransactionStateError(this.#status, operation);
    }
  }

  /**
   * Rejects state changes while the draft is archived or deleted.
   */
  #requireDraftAllowsStateMutation(): void {
    if (this.#lifecycle.archived) {
      throw new DraftStateError("archived");
    }
    if (this.#lifecycle.deleted) {
      throw new DraftStateError("deleted");
    }
  }
}

/**
 * Reports an asynchronous state mutator where synchronous mutation is required.
 */
class AsyncMutatorError extends TypeError {
  /**
   * Creates the error raised when a state mutator returns a thenable.
   */
  constructor() {
    super("Entity state mutators must be synchronous.");
    this.name = "AsyncMutatorError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Clones transaction state, applies synchronous mutation, and captures immutable validation snapshots.
 */
const TransactionDrafts = Object.freeze({
  /**
   * Copies a draft through its schema, omitting unknown wire fields.
   *
   * @typeParam Schema Generated schema describing the state.
   * @param schema Schema used for encoding and decoding.
   * @param state State message to copy.
   * @returns An independent copy of the known state fields.
   */
  clone<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    state: MessageShape<Schema>,
  ): MessageShape<Schema> {
    return fromBinary(schema, toBinary(schema, state, { writeUnknownFields: false }));
  },

  /**
   * Compares the encoded known fields of two drafts.
   *
   * @typeParam Schema Generated schema shared by both drafts.
   * @param schema Schema used to encode the drafts.
   * @param left First draft to compare.
   * @param right Second draft to compare.
   * @returns True when both drafts encode to the same known fields.
   */
  equal<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    left: MessageShape<Schema>,
    right: MessageShape<Schema>,
  ): boolean {
    const first = toBinary(schema, left, { writeUnknownFields: false });
    const second = toBinary(schema, right, { writeUnknownFields: false });
    return first.length === second.length && first.every((value, index) => value === second[index]);
  },

  /**
   * Applies a synchronous mutator and rejects a returned thenable.
   *
   * @typeParam Schema Generated schema describing the draft.
   * @param mutator Operation that changes the draft in place.
   * @param draft Mutable state supplied to the operation.
   */
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

  /**
   * Tests whether a mutator result exposes a callable then method.
   *
   * @param value Result returned by a state mutator.
   * @returns True for Promises and other thenable objects or functions.
   */
  isThenable(value: unknown): value is PromiseLike<unknown> {
    return (
      ((typeof value === "object" && value !== null) || typeof value === "function") &&
      typeof (value as { readonly then?: unknown }).then === "function"
    );
  },

  /**
   * Marks a validation snapshot and its reachable values as frozen once each.
   *
   * @typeParam Value Validation snapshot type preserved by this operation.
   * @param value Snapshot or nested value to freeze.
   * @param seen Previously visited objects, used to stop cycles.
   * @returns The frozen input value.
   */
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

/**
 * Creates a transaction with inferred schema state typing.
 *
 * @typeParam Schema Generated schema describing the transaction's state.
 * @param options State, version, and lifecycle inputs for the transaction.
 * @returns A new isolated entity transaction.
 */
export function createEntityTransaction<Schema extends DescriptorMessageSchema>(
  options: EntityTransactionOptions<Schema>,
): EntityTransaction<Schema> {
  return new EntityTransaction(options);
}
