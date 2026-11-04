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

import { clone, equals } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import {
  OidcLoginGrantSchema,
  OidcLoginTransactionSchema,
  type OidcLoginGrant,
  type OidcLoginTransaction,
} from "@spine-event-engine/proto/auth";

import { OidcFlowKeys } from "./records.js";
import { SessionRecords } from "../sessions/session-record.js";

/**
 * Atomic one-use transitions for one application-selected OIDC login flow.
 */
export interface OidcFlowStore {
  /**
   * Flow identity used to qualify state and grant digests.
   */
  readonly flowId: string;

  /**
   * Creates a transaction only if its qualified digest is absent.
   *
   * @param record Complete transaction with this flow identity.
   * @param signal Optional cancellation.
   * @returns True for confirmed insertion, false for confirmed no mutation.
   */
  insertTransaction(record: OidcLoginTransaction, signal?: AbortSignal): Promise<boolean>;

  /**
   * Reads a transaction by its qualified digest.
   *
   * @param digest Flow-qualified lookup digest.
   * @param signal Optional cancellation.
   * @returns Complete current transaction, if present for this flow.
   */
  readTransaction(digest: string, signal?: AbortSignal): Promise<OidcLoginTransaction | undefined>;

  /**
   * Deletes only the complete expected transaction before external exchange.
   *
   * @param expected Validated transaction snapshot.
   * @param signal Optional cancellation.
   * @returns True for one winning consumption, false for no mutation.
   */
  consumeTransaction(expected: OidcLoginTransaction, signal?: AbortSignal): Promise<boolean>;

  /**
   * Creates a one-use application grant only if its digest is absent.
   *
   * @param record Complete grant with this flow identity.
   * @param signal Optional cancellation.
   * @returns True for confirmed insertion, false for confirmed no mutation.
   */
  insertGrant(record: OidcLoginGrant, signal?: AbortSignal): Promise<boolean>;

  /**
   * Reads a grant by its qualified digest.
   *
   * @param digest Flow-qualified lookup digest.
   * @param signal Optional cancellation.
   * @returns Complete current grant, if present for this flow.
   */
  readGrant(digest: string, signal?: AbortSignal): Promise<OidcLoginGrant | undefined>;

  /**
   * Deletes only the complete expected grant before session issuance.
   *
   * @param expected Validated grant snapshot.
   * @param signal Optional cancellation.
   * @returns True for one winning consumption, false for no mutation.
   */
  consumeGrant(expected: OidcLoginGrant, signal?: AbortSignal): Promise<boolean>;

  /**
   * Removes expired records using the selected store's maintenance policy.
   *
   * @param cutoff Trusted current-or-earlier deadline.
   * @param signal Optional cancellation.
   * @returns Confirmed transaction and grant removals in this pass.
   */
  purgeExpired(
    cutoff: Timestamp,
    signal?: AbortSignal,
  ): Promise<{
    transactions: number;
    grants: number;
  }>;

  /**
   * Closes new work and drains admitted work; an injected factory remains open.
   *
   * @returns Completion after the store releases its acquired resources.
   */
  close(): Promise<void>;
}

/**
 * Process-local atomic transitions for one component login flow.
 */
export class MemoryOidcFlowStore implements OidcFlowStore {
  /**
   * Flow identity used in this process-local record family.
   */
  readonly flowId: string;

  readonly #transactions = new Map<string, OidcLoginTransaction>();

  readonly #grants = new Map<string, OidcLoginGrant>();

  readonly #clock: () => Timestamp;

  readonly #maxTransactions: number;

  readonly #maxGrants: number;

  #closed = false;

  /**
   * Binds a flow identity, trusted clock and process-local capacity policy.
   *
   * @param flowId Identity qualifying all state and grant digests.
   * @param clock Latest allowed maintenance cutoff.
   * @param maxTransactions Existing memory transaction bound.
   * @param maxGrants Existing memory grant bound.
   */
  constructor(flowId: string, clock: () => Timestamp, maxTransactions: number, maxGrants: number) {
    if (
      !flowId ||
      !Number.isSafeInteger(maxTransactions) ||
      maxTransactions <= 0 ||
      !Number.isSafeInteger(maxGrants) ||
      maxGrants <= 0
    )
      throw new TypeError("Invalid process-local OIDC flow configuration.");
    this.flowId = flowId;
    this.#clock = clock;
    this.#maxTransactions = maxTransactions;
    this.#maxGrants = maxGrants;
  }

  /**
   * Checks current process-local transaction capacity.
   *
   * @returns Whether another transaction needs explicit maintenance.
   */
  transactionsFull(): boolean {
    return this.#transactions.size >= this.#maxTransactions;
  }

  /**
   * Checks current process-local grant capacity.
   *
   * @returns Whether another grant needs explicit maintenance.
   */
  grantsFull(): boolean {
    return this.#grants.size >= this.#maxGrants;
  }

  /**
   * @inheritdoc
   */
  insertTransaction(record: OidcLoginTransaction, signal?: AbortSignal): Promise<boolean> {
    this.#check(record, signal);
    if (this.transactionsFull() || this.#transactions.has(record.lookupDigest))
      return Promise.resolve(false);
    this.#transactions.set(record.lookupDigest, clone(OidcLoginTransactionSchema, record));
    return Promise.resolve(true);
  }

  /**
   * @inheritdoc
   */
  readTransaction(digest: string, signal?: AbortSignal): Promise<OidcLoginTransaction | undefined> {
    this.#check(undefined, signal);
    const record = this.#transactions.get(digest);
    return Promise.resolve(
      record === undefined ? undefined : clone(OidcLoginTransactionSchema, record),
    );
  }

  /**
   * @inheritdoc
   */
  consumeTransaction(expected: OidcLoginTransaction, signal?: AbortSignal): Promise<boolean> {
    this.#check(expected, signal);
    const current = this.#transactions.get(expected.lookupDigest);
    if (current === undefined || !equals(OidcLoginTransactionSchema, current, expected))
      return Promise.resolve(false);
    this.#transactions.delete(expected.lookupDigest);
    return Promise.resolve(true);
  }

  /**
   * @inheritdoc
   */
  insertGrant(record: OidcLoginGrant, signal?: AbortSignal): Promise<boolean> {
    this.#check(record, signal);
    if (this.grantsFull() || this.#grants.has(record.lookupDigest)) return Promise.resolve(false);
    this.#grants.set(record.lookupDigest, clone(OidcLoginGrantSchema, record));
    return Promise.resolve(true);
  }

  /**
   * @inheritdoc
   */
  readGrant(digest: string, signal?: AbortSignal): Promise<OidcLoginGrant | undefined> {
    this.#check(undefined, signal);
    const record = this.#grants.get(digest);
    return Promise.resolve(record === undefined ? undefined : clone(OidcLoginGrantSchema, record));
  }

  /**
   * @inheritdoc
   */
  consumeGrant(expected: OidcLoginGrant, signal?: AbortSignal): Promise<boolean> {
    this.#check(expected, signal);
    const current = this.#grants.get(expected.lookupDigest);
    if (current === undefined || !equals(OidcLoginGrantSchema, current, expected))
      return Promise.resolve(false);
    this.#grants.delete(expected.lookupDigest);
    return Promise.resolve(true);
  }

  /**
   * @inheritdoc
   */
  purgeExpired(
    cutoff: Timestamp,
    signal?: AbortSignal,
  ): Promise<{ transactions: number; grants: number }> {
    this.#check(undefined, signal);
    const valid = SessionRecords.deadline(cutoff);
    if (SessionRecords.compare(valid, SessionRecords.deadline(this.#clock())) > 0)
      throw new RangeError("Purge cutoff cannot be later than the trusted clock.");
    const transactions = this.#purge(this.#transactions, valid, signal);
    const grants = this.#purge(this.#grants, valid, signal);
    return Promise.resolve({ transactions, grants });
  }

  /**
   * @inheritdoc
   */
  close(): Promise<void> {
    this.#closed = true;
    this.#transactions.clear();
    this.#grants.clear();
    return Promise.resolve();
  }

  /**
   * Checks lifecycle, cancellation and flow binding.
   *
   * @param record Optional record being mutated.
   * @param signal Optional cancellation.
   */
  #check(record?: OidcLoginTransaction | OidcLoginGrant, signal?: AbortSignal): void {
    if (this.#closed) throw new Error("OIDC flow store is closed.");
    signal?.throwIfAborted();
    if (record !== undefined) {
      if (record.flowId !== this.flowId) throw new TypeError("OIDC flow identity differs.");
      OidcFlowKeys.expiry(record);
    }
  }

  /**
   * Removes expired records from one local family.
   *
   * @typeParam R Transaction or grant record.
   * @param records Selected local family.
   * @param cutoff Trusted maximum deadline.
   * @param signal Optional cancellation.
   * @returns Number removed in this invocation.
   */
  #purge<R extends OidcLoginTransaction | OidcLoginGrant>(
    records: Map<string, R>,
    cutoff: Timestamp,
    signal?: AbortSignal,
  ): number {
    let removed = 0;
    for (const [key, record] of records) {
      signal?.throwIfAborted();
      if (SessionRecords.compare(OidcFlowKeys.expiry(record), cutoff) <= 0) {
        records.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}
