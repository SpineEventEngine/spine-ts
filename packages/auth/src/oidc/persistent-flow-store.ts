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

import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { Time } from "@spine-event-engine/core/time";
import {
  OidcLoginGrantSchema,
  OidcLoginTransactionSchema,
  type OidcLoginGrant,
  type OidcLoginTransaction,
} from "@spine-event-engine/proto/auth";
import {
  ColumnTypes,
  defaultQueryCandidateLimit,
  RecordColumn,
  RecordSpec,
  type RecordContinuation,
  type RecordStorage,
  type StorageContext,
  type StorageFactory,
  type StorageGroup,
} from "@spine-event-engine/storage";
import { StoragePreparations } from "@spine-event-engine/storage/provider";

import type { OidcFlowStore } from "./flow-store.js";
import { OidcFlowKeys } from "./records.js";
import { SessionRecords } from "../sessions/session-record.js";

/**
 * One of the two distinct persisted component login record families.
 */
type FlowRecord = OidcLoginTransaction | OidcLoginGrant;

/**
 * Placement and preparation policy for one persistent component login flow.
 */
export interface PersistentOidcFlowOptions {
  // prettier-ignore

  /**
   * Factory supplying independent transaction and grant handles.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Group shared by all selected component login records.
   */
  readonly group: StorageGroup;

  /**
   * Application identity qualifying every state and grant lookup.
   */
  readonly flowId: string;

  /**
   * Whether to prepare both families before returning; defaults to true.
   */
  readonly createMissingStructures?: boolean;

  /**
   * Returns the latest allowed explicit maintenance cutoff.
   *
   * @returns Current exact time.
   */
  readonly clock?: () => Timestamp;
}

/**
 * Durable atomic transaction and grant transitions for one component login flow.
 */
export class PersistentOidcFlowStore implements OidcFlowStore {
  /**
   * Flow identity used to qualify persisted records and indexed expiry ranges.
   */
  readonly flowId: string;

  readonly #transactions: RecordStorage<string, OidcLoginTransaction>;

  readonly #grants: RecordStorage<string, OidcLoginGrant>;

  readonly #clock: () => Timestamp;

  #closed = false;

  #active = 0;

  #drained: (() => void) | undefined;

  #closing: Promise<void> | undefined;

  /**
   * Binds both independent handles and their trusted maintenance clock.
   *
   * @param flowId Application-selected flow identity.
   * @param transactions Transaction record handle.
   * @param grants Grant record handle.
   * @param clock Latest allowed maintenance cutoff.
   */
  private constructor(
    flowId: string,
    transactions: RecordStorage<string, OidcLoginTransaction>,
    grants: RecordStorage<string, OidcLoginGrant>,
    clock: () => Timestamp,
  ) {
    this.flowId = flowId;
    this.#transactions = transactions;
    this.#grants = grants;
    this.#clock = clock;
  }

  /**
   * Acquires two handles and completes selected physical preparation.
   *
   * @param options Flow placement and preparation policy.
   * @returns Ready persistent store, or an explicit non-preparing store.
   */
  static async create(options: PersistentOidcFlowOptions): Promise<PersistentOidcFlowStore> {
    if (typeof options.flowId !== "string" || options.flowId.trim().length === 0)
      throw new TypeError("flowId must be a nonempty string.");
    const handles: RecordStorage<string, FlowRecord>[] = [];
    try {
      const transactions = options.storageFactory.createRecordStorage(
        context,
        transactionSpec,
        options.group,
        { prepareOnAccess: false },
      );
      handles.push(transactions);
      const grants = options.storageFactory.createRecordStorage(context, grantSpec, options.group, {
        prepareOnAccess: false,
      });
      handles.push(grants);
      if (!transactions.atomicCompareAndSet || !grants.atomicCompareAndSet)
        throw new Error("OIDC flow storage requires atomic compare-and-set.");
      if (options.createMissingStructures !== false) await PersistentOidcFlowStore.prepare(options);
      return new PersistentOidcFlowStore(
        options.flowId,
        transactions,
        grants,
        options.clock ?? Time.currentTime,
      );
    } catch (error) {
      PersistentOidcFlowStore.releaseAfterFailure(handles, error);
    }
  }

  /**
   * Closes acquired handles while preserving the original construction failure.
   *
   * @param handles Handles acquired before failure.
   * @param error Original acquisition or preparation failure.
   * @returns Never returns; throws the original failure or an aggregate with close failures.
   */
  private static releaseAfterFailure(
    handles: readonly RecordStorage<string, FlowRecord>[],
    error: unknown,
  ): never {
    const failures: unknown[] = [error];
    for (const handle of handles) {
      try {
        handle.close();
      } catch (closeError) {
        failures.push(closeError);
      }
    }
    if (failures.length > 1)
      throw new AggregateError(failures, "OIDC flow preparation and handle cleanup failed.");
    throw error;
  }

  /**
   * Prepares both selected record families before factory completion.
   *
   * @param options Factory and group to prepare.
   * @returns Completion after both structures pass compatibility checks.
   */
  private static async prepare(options: PersistentOidcFlowOptions): Promise<void> {
    const provider = StoragePreparations.for(options.storageFactory);
    await provider.prepareRecord(context, transactionSpec, options.group, "create");
    await provider.prepareRecord(context, grantSpec, options.group, "create");
  }

  /**
   * @inheritdoc
   */
  insertTransaction(record: OidcLoginTransaction, signal?: AbortSignal): Promise<boolean> {
    return this.#run(async () => {
      this.#validate(record);
      signal?.throwIfAborted();
      const inserted = await this.#transactions.compareAndSet(
        record.lookupDigest,
        undefined,
        record,
      );
      if (!inserted) signal?.throwIfAborted();
      return inserted;
    });
  }

  /**
   * @inheritdoc
   */
  readTransaction(digest: string, signal?: AbortSignal): Promise<OidcLoginTransaction | undefined> {
    return this.#read(this.#transactions, digest, signal);
  }

  /**
   * @inheritdoc
   */
  consumeTransaction(expected: OidcLoginTransaction, signal?: AbortSignal): Promise<boolean> {
    return this.#consume(this.#transactions, expected, signal);
  }

  /**
   * @inheritdoc
   */
  insertGrant(record: OidcLoginGrant, signal?: AbortSignal): Promise<boolean> {
    return this.#run(async () => {
      this.#validate(record);
      signal?.throwIfAborted();
      const inserted = await this.#grants.compareAndSet(record.lookupDigest, undefined, record);
      if (!inserted) signal?.throwIfAborted();
      return inserted;
    });
  }

  /**
   * @inheritdoc
   */
  readGrant(digest: string, signal?: AbortSignal): Promise<OidcLoginGrant | undefined> {
    return this.#read(this.#grants, digest, signal);
  }

  /**
   * @inheritdoc
   */
  consumeGrant(expected: OidcLoginGrant, signal?: AbortSignal): Promise<boolean> {
    return this.#consume(this.#grants, expected, signal);
  }

  /**
   * @inheritdoc
   */
  purgeExpired(
    cutoff: Timestamp,
    signal?: AbortSignal,
  ): Promise<{ transactions: number; grants: number }> {
    return this.#run(async () => {
      const valid = SessionRecords.deadline(cutoff);
      signal?.throwIfAborted();
      if (SessionRecords.compare(valid, SessionRecords.deadline(this.#clock())) > 0)
        throw new RangeError("Purge cutoff cannot be later than the trusted clock.");
      const transactions = await this.#purgeFamily(this.#transactions, valid, signal);
      const grants = await this.#purgeFamily(this.#grants, valid, signal);
      return { transactions, grants };
    });
  }

  /**
   * @inheritdoc
   */
  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    this.#closed = true;
    this.#closing = this.#finishClose();
    return this.#closing;
  }

  /**
   * Closes both acquired handles after admitted work settles.
   *
   * @returns Completion after both close attempts.
   */
  async #finishClose(): Promise<void> {
    if (this.#active > 0) await new Promise<void>((resolve) => (this.#drained = resolve));
    const errors: unknown[] = [];
    for (const handle of [this.#transactions, this.#grants]) {
      try {
        handle.close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "OIDC flow handle close failed.");
  }

  /**
   * Admits work until closure and drains it before handle release.
   *
   * @typeParam T Operation result.
   * @param work Admitted asynchronous operation.
   * @returns Operation result.
   */
  async #run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#closed) throw new Error("OIDC flow store is closed.");
    this.#active += 1;
    try {
      return await work();
    } finally {
      this.#active -= 1;
      if (this.#active === 0) this.#drained?.();
    }
  }

  /**
   * Checks flow binding, digest shape and deadline before mutation.
   *
   * @param record Complete flow record.
   */
  #validate(record: FlowRecord): void {
    if (record.flowId !== this.flowId || !/^[0-9a-f]{64}$/.test(record.lookupDigest))
      throw new TypeError("OIDC flow record has an invalid identity.");
    OidcFlowKeys.expiry(record);
  }

  /**
   * Reads only a record belonging to this configured flow.
   *
   * @typeParam R Transaction or grant record.
   * @param storage Selected family handle.
   * @param digest Flow-qualified lookup digest.
   * @param signal Optional cancellation.
   * @returns Current record for this flow, if present.
   */
  #read<R extends FlowRecord>(
    storage: RecordStorage<string, R>,
    digest: string,
    signal?: AbortSignal,
  ): Promise<R | undefined> {
    return this.#run(async () => {
      signal?.throwIfAborted();
      const record = await storage.read(digest);
      signal?.throwIfAborted();
      return record?.flowId === this.flowId ? record : undefined;
    });
  }

  /**
   * Deletes only one expected complete record.
   *
   * @typeParam R Transaction or grant record.
   * @param storage Selected family handle.
   * @param expected Validated snapshot.
   * @param signal Optional cancellation.
   * @returns Whether this call consumed the record.
   */
  #consume<R extends FlowRecord>(
    storage: RecordStorage<string, R>,
    expected: R,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return this.#run(async () => {
      this.#validate(expected);
      signal?.throwIfAborted();
      const consumed = await storage.compareAndSet(expected.lookupDigest, expected, undefined);
      if (!consumed) signal?.throwIfAborted();
      return consumed;
    });
  }

  /**
   * Drains indexed expiry groups until no candidate remains or a CAS race occurs.
   *
   * @typeParam R Transaction or grant record.
   * @param storage Selected family handle.
   * @param cutoff Trusted maximum eligible deadline.
   * @param signal Optional cancellation.
   * @returns Count removed by this pass.
   */
  async #purgeFamily<R extends FlowRecord>(
    storage: RecordStorage<string, R>,
    cutoff: Timestamp,
    signal?: AbortSignal,
  ): Promise<number> {
    let completed: Uint8Array | undefined;
    let removed = 0;
    const cutoffKey = OidcFlowKeys.upperBound(this.flowId, cutoff);
    const lowerKey = OidcFlowKeys.lowerBound(this.flowId);
    for (;;) {
      signal?.throwIfAborted();
      const key = await this.#nextExpiry(storage, lowerKey, cutoffKey, completed);
      signal?.throwIfAborted();
      if (key === undefined) return removed;
      const [count, raced] = await this.#purgeTie(storage, key, cutoff, signal);
      removed += count;
      if (raced) return removed;
      completed = key;
    }
  }

  /**
   * Finds the next indexed exact expiry group.
   *
   * @typeParam R Transaction or grant record.
   * @param storage Selected family handle.
   * @param lowerKey First key in this flow's indexed range.
   * @param cutoffKey Encoded maximum deadline.
   * @param completed Last drained expiry group.
   * @returns Next expiry group, if present.
   */
  async #nextExpiry<R extends FlowRecord>(
    storage: RecordStorage<string, R>,
    lowerKey: Uint8Array,
    cutoffKey: Uint8Array,
    completed?: Uint8Array,
  ): Promise<Uint8Array | undefined> {
    const entries = await storage.queryPlanEntries({
      predicate: PersistentOidcFlowStore.expiryPredicate(lowerKey, cutoffKey, completed),
      order: [{ column: "expires_order", direction: "asc" }],
      limit: 1,
    });
    return entries[0] === undefined ? undefined : OidcFlowKeys.orderKey(entries[0].record);
  }

  /**
   * Pages one exact expiry group by immutable digest.
   *
   * @typeParam R Transaction or grant record.
   * @param storage Selected family handle.
   * @param key Encoded exact deadline.
   * @param cutoff Trusted maximum deadline.
   * @param signal Optional cancellation.
   * @returns Removed count and a concurrent-change marker.
   */
  async #purgeTie<R extends FlowRecord>(
    storage: RecordStorage<string, R>,
    key: Uint8Array,
    cutoff: Timestamp,
    signal?: AbortSignal,
  ): Promise<[number, boolean]> {
    let after: RecordContinuation<string> | undefined;
    let removed = 0;
    let raced = false;
    for (;;) {
      signal?.throwIfAborted();
      const entries = await storage.queryEntries({
        filters: [{ column: "expires_order", value: key }],
        sort: [{ field: "id" }],
        limit: defaultQueryCandidateLimit,
        ...(after === undefined ? {} : { after }),
      });
      signal?.throwIfAborted();
      if (entries.length === 0) return [removed, raced];
      for (const entry of entries) {
        const result = await this.#removeExpired(storage, entry.record, cutoff, signal);
        if (result === true) removed += 1;
        if (result === false) raced = true;
      }
      const last = entries.at(-1);
      if (last === undefined) return [removed, raced];
      after = { id: last.id, values: [{ field: "id", value: last.id }] };
    }
  }

  /**
   * Attempts one conditional deletion without retrying a concurrent change.
   * @typeParam R Transaction or grant record.
   * @param storage Selected family handle.
   * @param record Candidate snapshot from the indexed page.
   * @param cutoff Trusted maximum eligible deadline.
   * @param signal Optional cancellation.
   * @returns True when removed, false after a race, or undefined if ineligible.
   */
  async #removeExpired<R extends FlowRecord>(
    storage: RecordStorage<string, R>,
    record: R,
    cutoff: Timestamp,
    signal?: AbortSignal,
  ): Promise<boolean | undefined> {
    if (
      record.flowId !== this.flowId ||
      SessionRecords.compare(OidcFlowKeys.expiry(record), cutoff) > 0
    )
      return undefined;
    const removed = await storage.compareAndSet(record.lookupDigest, record, undefined);
    signal?.throwIfAborted();
    return removed;
  }

  /**
   * Builds the indexed range for one flow and cutoff without scanning other flows.
   *
   * @param lowerKey Start of this flow's range.
   * @param cutoffKey Last eligible exact expiry key.
   * @param completed Previously drained expiry key, if any.
   * @returns Provider-supported comparison predicate.
   */
  private static expiryPredicate(
    lowerKey: Uint8Array,
    cutoffKey: Uint8Array,
    completed?: Uint8Array,
  ) {
    return {
      kind: "all" as const,
      predicates: [
        {
          kind: "comparison" as const,
          column: "expires_order",
          operator: "lessOrEqual" as const,
          value: cutoffKey,
        },
        {
          kind: "comparison" as const,
          column: "expires_order",
          operator:
            completed === undefined ? ("greaterOrEqual" as const) : ("greaterThan" as const),
          value: completed ?? lowerKey,
        },
      ],
    };
  }
}

const context: StorageContext = { name: "__AUTH_OIDC_FLOW__", multitenant: false };
const transactionSpec = new RecordSpec<string, OidcLoginTransaction>({
  recordType: OidcLoginTransactionSchema,
  idKind: "string",
  extractId: (record) => record.lookupDigest,
  columns: [new RecordColumn("expires_order", ColumnTypes.fixedBytes(44), OidcFlowKeys.orderKey)],
  indexes: [{ name: "expiry", columns: ["expires_order", "id"] }],
});
const grantSpec = new RecordSpec<string, OidcLoginGrant>({
  recordType: OidcLoginGrantSchema,
  idKind: "string",
  extractId: (record) => record.lookupDigest,
  columns: [new RecordColumn("expires_order", ColumnTypes.fixedBytes(44), OidcFlowKeys.orderKey)],
  indexes: [{ name: "expiry", columns: ["expires_order", "id"] }],
});
