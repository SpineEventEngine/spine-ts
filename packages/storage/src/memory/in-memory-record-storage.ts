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

import type { RecordEntry } from "../record/record-storage.js";
import type { RecordQuery } from "../record/record-query.js";
import type { RecordSpec } from "../record/record-spec.js";
import { RecordStorage } from "../record/record-storage.js";
import type { StorageContext } from "../storage/storage.js";
import type { NormalizedQueryPlan, StorageQueryCapabilities } from "../query/query-policy.js";
import { defaultQueryCandidateLimit } from "../query/query-execution.js";
import { TenantRecords } from "./tenant-records.js";
import { TenantBoundary } from "../internal/tenancy.js";

/**
 * In-memory record storage with per-tenant slices when the context is multitenant.
 */
export class InMemoryRecordStorage<I, R extends Message> extends RecordStorage<I, R> {
  // prettier-ignore

  /**
   * Declares atomic conditional mutations for compatible in-memory handles.
   */
  override readonly atomicCompareAndSet = true;
  readonly #records: () => TenantRecords<I, R>;

  /**
   * Creates an in-memory record storage.
   * @param context Supplies the storage and tenant context.
   * @param recordSpec Supplies the record materialization specification.
   * @param tenantRecords Supplies shared tenant records when factory-owned.
   */
  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    tenantRecords?: () => TenantRecords<I, R>,
  ) {
    super(context, recordSpec);
    const localTenants = new Map<string | symbol, TenantRecords<I, R>>();
    this.#records = tenantRecords ?? (() => this.localRecords(localTenants));
  }

  /**
   * Deletes the record at one storage slot.
   * @param id The storage slot identifier.
   * @returns Whether a record was deleted.
   */
  protected deleteRecord(id: I): Promise<boolean> {
    return Promise.resolve(this.records().delete(id));
  }

  /**
   * Compares and conditionally replaces the record at one storage slot.
   * @param id The storage slot identifier.
   * @param expected The expected materialized record.
   * @param next The replacement materialized record, if any.
   * @returns Whether the conditional mutation was applied.
   */
  protected compareAndSetRecord(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
    return Promise.resolve(this.records().compareAndSet(id, expected, next));
  }

  /**
   * Returns records matching a query.
   * @param query The record query.
   * @returns The matching storage entries.
   */
  protected override queryRecordEntries(
    query: RecordQuery<I>,
  ): Promise<readonly RecordEntry<I, R>[]> {
    return Promise.resolve(this.records().queryEntries(this.recordSpec, query));
  }

  /**
   * Returns the supported in-memory query capabilities.
   * @returns The supported query capabilities.
   */
  protected override queryCapabilities(): StorageQueryCapabilities {
    return {
      comparisons: ["equal", "greaterThan", "lessThan", "greaterOrEqual", "lessOrEqual"],
      features: ["either", "nested", "order", "mask", "limit"],
    };
  }

  /**
   * Returns candidate records for a normalized query plan.
   * @param plan The normalized query plan.
   * @returns The candidate storage entries.
   */
  protected override queryPlanRecordEntries(
    plan: NormalizedQueryPlan<I>,
  ): Promise<readonly RecordEntry<I, R>[]> {
    return Promise.resolve(
      this.records().queryEntries(this.recordSpec, {
        limit: (plan.candidateLimit ?? defaultQueryCandidateLimit) + 1,
      }),
    );
  }

  /**
   * Reads the record at one storage slot.
   * @param id The storage slot identifier.
   * @returns The stored record, if present.
   */
  protected readRecord(id: I): Promise<R | undefined> {
    return Promise.resolve(this.records().read(id));
  }

  /**
   * Writes materialized records.
   * @param records The materialized records to write.
   * @returns Completes when the records are written.
   */
  protected writeAllRecords(
    records: readonly ReturnType<RecordSpec<I, R>["materialize"]>[],
  ): Promise<void> {
    this.records().writeAll(records);
    return Promise.resolve();
  }

  /**
   * Writes one materialized record.
   * @param record The materialized record to write.
   * @returns Completes when the record is written.
   */
  protected writeRecord(record: ReturnType<RecordSpec<I, R>["materialize"]>): Promise<void> {
    this.records().write(record);
    return Promise.resolve();
  }

  private records(): TenantRecords<I, R> {
    return this.#records();
  }

  private localRecords(
    tenantRecords: Map<string | symbol, TenantRecords<I, R>>,
  ): TenantRecords<I, R> {
    const tenantKey = this.tenantKey();
    let records = tenantRecords.get(tenantKey);

    if (records === undefined) {
      records = new TenantRecords<I, R>();
      tenantRecords.set(tenantKey, records);
    }

    return records;
  }

  private tenantKey(): string | symbol {
    return TenantBoundary.of(this.context).key;
  }
}
