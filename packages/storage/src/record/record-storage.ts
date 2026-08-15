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

import type { Message } from "@bufbuild/protobuf";

import { RecordMask } from "./record-mask.js";
import { RecordQuery } from "./record-query.js";
import type { RecordReadOptions } from "./record-query.js";
import type { RecordSpec } from "./record-spec.js";
import type { Storage, StorageContext } from "../storage/storage.js";
import {
  defaultQueryCandidateLimit,
  QueryCandidateLimitError,
  StorageQueryEvaluator,
} from "../query/query-execution.js";
import { StorageQueryPolicy } from "../query/query-policy.js";
import type { NormalizedQueryPlan, StorageQueryCapabilities } from "../query/query-policy.js";

/**
 * Common record-oriented storage contract for identified Protobuf messages.
 */
export abstract class RecordStorage<I, R extends Message> implements Storage {
  // prettier-ignore

  /**
   * Declares whether this handle provides atomic compare-and-set mutations.
   *
   * The base contract defaults to `false`. An adapter sets this to `true` only
   * when its `compareAndSet()` implementation is atomic across compatible
   * handles. Registry and delivery code must reject a handle that leaves this
   * capability disabled rather than treating a failed conditional write as a
   * collision.
   */
  readonly atomicCompareAndSet: boolean = false;
  readonly #context: StorageContext;
  #open = true;
  readonly #recordSpec: RecordSpec<I, R>;

  /**
   * Creates storage for one context and record specification.
   * @param context The storage and tenant context.
   * @param recordSpec The records managed by this storage.
   */
  constructor(context: StorageContext, recordSpec: RecordSpec<I, R>) {
    this.#context = context;
    this.#recordSpec = recordSpec;
  }

  /**
   * Returns the context that scopes this storage and its tenant slices.
   * @returns The storage context.
   */
  protected get context(): StorageContext {
    return this.#context;
  }

  /**
   * Returns the declarative record specification for this storage.
   * @returns The managed record specification.
   */
  get recordSpec(): RecordSpec<I, R> {
    return this.#recordSpec;
  }

  /**
   * Closes this record storage. Future operations fail.
   */
  close(): void {
    this.#open = false;
  }

  /**
   * Returns whether this record storage still accepts operations.
   * @returns Whether the storage is open.
   */
  isOpen(): boolean {
    return this.#open;
  }

  /**
   * Deletes one stored record by actual storage slot ID.
   * @param id The storage slot identifier.
   * @returns Whether a record was deleted.
   */
  async delete(id: I): Promise<boolean> {
    this.requireOpen();
    return this.deleteRecord(this.#recordSpec.cloneId(id));
  }

  /**
   * Reads one record by actual storage slot ID, optionally applying a mask.
   * @param id The storage slot identifier.
   * @param options The read options.
   * @returns The matching record, if present.
   */
  async read(id: I, options: RecordReadOptions = {}): Promise<R | undefined> {
    this.requireOpen();
    const record = await this.readRecord(this.#recordSpec.cloneId(id));

    return record === undefined
      ? undefined
      : RecordMask.apply(this.#recordSpec.cloneRecord(record), options.mask);
  }

  /**
   * Reads matching logical record identifiers derived from stored record bodies
   * in deterministic query order.
   * @param query The record query.
   * @returns The matching logical identifiers.
   */
  async index(query: RecordQuery<I> = {}): Promise<readonly I[]> {
    this.requireOpen();
    RecordQuery.validate(query);
    const entries = await this.queryRecordEntries(query);

    return entries.map((entry) =>
      this.#recordSpec.cloneId(this.#recordSpec.idValueIn(entry.record)),
    );
  }

  /**
   * Processes records by actual storage slot IDs, columns, sorting,
   * continuations, limits, and optional masks.
   *
   * `RecordQuery.ids`, when present, filters storage slot IDs rather than
   * logical IDs derived from record bodies.
   * @param query The record query.
   * @returns The matching records.
   */
  async query(query: RecordQuery<I> = {}): Promise<readonly R[]> {
    this.requireOpen();
    RecordQuery.validate(query);
    const entries = await this.queryRecordEntries(query);

    return entries.map((entry) =>
      RecordMask.apply(this.#recordSpec.cloneRecord(entry.record), query.mask),
    );
  }

  /**
   * Processes stored records together with the actual storage slot IDs they
   * currently occupy in the requested sorted and continued order.
   *
   * `RecordQuery.ids`, when present, filters those storage slot IDs rather
   * than logical IDs derived from record bodies.
   * @param query The record query.
   * @returns The matching storage entries.
   */
  async queryEntries(query: RecordQuery<I> = {}): Promise<readonly RecordEntry<I, R>[]> {
    this.requireOpen();
    RecordQuery.validate(query);
    const entries = await this.queryRecordEntries(query);

    return entries.map((entry) =>
      Object.freeze({
        id: this.#recordSpec.cloneId(entry.id),
        record: RecordMask.apply(this.#recordSpec.cloneRecord(entry.record), query.mask),
      }),
    );
  }

  /**
   * Executes one provider-independent normalized query plan.
   * @param plan The validated normalized plan.
   * @returns The matching records.
   */
  async queryPlan(plan: NormalizedQueryPlan<I>): Promise<readonly R[]> {
    const entries = await this.queryPlanEntries(plan);
    return entries.map((entry) => entry.record);
  }

  /**
   * Executes a normalized plan and retains actual storage slot IDs.
   * @param plan The validated normalized plan.
   * @returns The matching storage entries.
   */
  async queryPlanEntries(plan: NormalizedQueryPlan<I>): Promise<readonly RecordEntry<I, R>[]> {
    this.requireOpen();
    StorageQueryPolicy.validate(plan, this.queryCapabilities());
    const candidates = await this.queryPlanRecordEntries(plan);
    const candidateLimit = plan.candidateLimit ?? defaultQueryCandidateLimit;
    if (candidates.length > candidateLimit) {
      throw new QueryCandidateLimitError(candidateLimit);
    }
    const materialized = candidates.map((entry) => {
      const stored = this.#recordSpec.materialize(entry.record);
      return { id: entry.id, record: stored.record, columns: stored.columns };
    });
    return StorageQueryEvaluator.evaluate(materialized, plan).map((entry) =>
      Object.freeze({
        id: this.#recordSpec.cloneId(entry.id),
        record: RecordMask.apply(this.#recordSpec.cloneRecord(entry.record), plan.mask?.paths),
      }),
    );
  }

  /**
   * Writes one record, replacing any previous value with the same ID.
   * @param record The record to write.
   * @returns Completes when the record is written.
   */
  async write(record: R): Promise<void> {
    this.requireOpen();
    await this.writeRecord(this.#recordSpec.materialize(record));
  }

  /**
   * Compares the current stored record for one ID with an expected value and
   * write or delete only when they still match.
   *
   * Implementations must apply this atomically across independently opened
   * storage handles that share the same logical backing store. Passing
   * `undefined` as `next` performs a conditional delete. A `false` result means
   * the current stored value did not match `expected`, so no mutation was
   * applied. The `id` argument names an actual storage slot, not a logical ID
   * derived from a record body. Adapters that cannot guarantee this behavior
   * are not valid for delivery leasing or deduplication.
   * @param id The storage slot identifier.
   * @param expected The expected current record.
   * @param next The record to write, or undefined to delete.
   * @returns Whether the conditional mutation was applied.
   */
  async compareAndSet(id: I, expected: R | undefined, next: R | undefined): Promise<boolean> {
    this.requireOpen();
    return this.compareAndSetRecord(
      this.#recordSpec.cloneId(id),
      expected === undefined ? undefined : this.#recordSpec.materialize(expected),
      next === undefined ? undefined : this.#recordSpec.materialize(next),
    );
  }

  /**
   * Writes records in order, materializing all values before persistence.
   * @param records The records to write.
   * @returns Completes when the records are written.
   */
  async writeAll(records: Iterable<R>): Promise<void> {
    this.requireOpen();
    const materializedRecords = [...records].map((record) => this.#recordSpec.materialize(record));
    await this.writeAllRecords(materializedRecords);
  }

  /**
   * Deletes the record at one storage slot.
   * @param id The storage slot identifier.
   * @returns Whether a record was deleted.
   */
  protected abstract deleteRecord(id: I): Promise<boolean>;

  /**
   * Returns stored records together with their actual storage slot IDs.
   *
   * Implementations must return `RecordEntry.id` as the concrete storage slot
   * identifier for the row or document that currently stores the record.
   * `RecordStorage.index()` derives logical record identifiers from
   * `RecordEntry.record`, so adapters must not substitute logical IDs into
   * `RecordEntry.id` here.
   * @param query The record query.
   * @returns The matching storage entries.
   */
  protected abstract queryRecordEntries(
    query: RecordQuery<I>,
  ): Promise<readonly RecordEntry<I, R>[]>;

  /**
   * Returns logical normalized features admitted before provider access.
   * @returns The supported query capabilities.
   */
  protected queryCapabilities(): StorageQueryCapabilities {
    return { comparisons: [], features: [] };
  }

  /**
   * Returns provider candidates for a normalized plan; shared evaluation applies the complete plan afterward.
   * @param plan The normalized query plan.
   * @returns The candidate storage entries.
   */
  protected queryPlanRecordEntries(
    plan: NormalizedQueryPlan<I>,
  ): Promise<readonly RecordEntry<I, R>[]> {
    if (plan.predicate !== undefined || (plan.order?.length ?? 0) > 0 || plan.limit !== undefined)
      return Promise.reject(
        new TypeError("Storage provider must implement normalized query-plan execution."),
      );
    return this.queryRecordEntries({
      limit: (plan.candidateLimit ?? defaultQueryCandidateLimit) + 1,
    });
  }

  /**
   * Reads the record at one storage slot.
   * @param id The storage slot identifier.
   * @returns The stored record, if present.
   */
  protected abstract readRecord(id: I): Promise<R | undefined>;

  /**
   * Compares and conditionally replaces the record at one storage slot.
   * @param id The storage slot identifier.
   * @param expected The expected materialized record.
   * @param next The replacement materialized record, if any.
   * @returns Whether the conditional mutation was applied.
   */
  protected abstract compareAndSetRecord(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean>;

  /**
   * Writes materialized records.
   * @param records The materialized records to write.
   * @returns Completes when the records are written.
   */
  protected abstract writeAllRecords(
    records: readonly ReturnType<RecordSpec<I, R>["materialize"]>[],
  ): Promise<void>;

  /**
   * Writes one materialized record.
   * @param record The materialized record to write.
   * @returns Completes when the record is written.
   */
  protected abstract writeRecord(
    record: ReturnType<RecordSpec<I, R>["materialize"]>,
  ): Promise<void>;

  private requireOpen(): void {
    if (!this.#open) {
      throw new Error("RecordStorage is closed.");
    }
  }
}

/**
 * One queried storage row or document.
 *
 * `id` is the actual storage slot identifier. `record` is the stored record
 * value whose logical identifier may differ and is derived through
 * `RecordSpec.idValueIn(...)`.
 */
export interface RecordEntry<I, R extends Message> {
  // prettier-ignore

  /**
   * Identifies the actual storage slot.
   */
  readonly id: I;

  /**
   * Holds the stored record value.
   */
  readonly record: R;
}
