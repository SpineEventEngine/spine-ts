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

import { createHash } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { Time } from "@spine-event-engine/core/time";
import { TokenRevocationSchema, type TokenRevocation } from "@spine-event-engine/proto/auth";
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

import type { SignedTokenRevocation } from "./signed.js";
import { SessionRecords } from "./session-record.js";

/**
 * Placement, token scope and explicit preparation for durable revocations.
 */
export interface PersistentTokenRevocationsOptions {
  // prettier-ignore

  /**
   * Factory supplying the selected revocation record handle.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Group shared by token-validating processes.
   */
  readonly group: StorageGroup;

  /**
   * Exact issuer used to scope every token identifier.
   */
  readonly issuer: string;

  /**
   * Exact single audience used to scope every token identifier.
   */
  readonly audience: string;

  /**
   * Whether to prepare the selected structure before returning; defaults to true.
   */
  readonly createMissingStructures?: boolean;

  /**
   * Returns trusted current time for revocation validity reads and maintenance.
   * Defaults to `Time.currentTime`; explicit purge cutoffs cannot exceed this time.
   * @returns Current exact time in the Protobuf Timestamp domain.
   */
  readonly clock?: () => Timestamp;
}

/**
 * Atomic scoped revocations retained through the last token-acceptance instant.
 */
export class PersistentTokenRevocations implements SignedTokenRevocation {
  /**
   * Declares immediate revocation capability to signed sessions.
   */
  readonly kind = "supported" as const;

  readonly #issuer: string;

  readonly #audience: string;

  readonly #scope: Uint8Array;

  readonly #storage: RecordStorage<string, TokenRevocation>;

  readonly #clock: () => Timestamp;

  #closed = false;

  #active = 0;

  #drained: (() => void) | undefined;

  #closing: Promise<void> | undefined;

  /**
   * Binds one acquired handle to its scope and trusted maintenance clock.
   * @param options Validated placement and scope.
   * @param storage Selected record handle.
   */
  private constructor(
    options: PersistentTokenRevocationsOptions,
    storage: RecordStorage<string, TokenRevocation>,
  ) {
    this.#issuer = options.issuer;
    this.#audience = options.audience;
    this.#scope = RevocationKeys.scope(options.issuer, options.audience);
    this.#storage = storage;
    this.#clock = options.clock ?? Time.currentTime;
  }

  /**
   * Acquires and optionally prepares the selected indexed record family.
   * With `createMissingStructures: false`, creation and later operations never
   * check or create physical structures. Missing structures fail through ordinary
   * storage operations. The default prepares the selected structure before return.
   * @param options Shared factory, group, scope and preparation policy.
   * @returns Ready revocation source, or a non-preparing handle when explicitly requested.
   */
  static async create(
    options: PersistentTokenRevocationsOptions,
  ): Promise<PersistentTokenRevocations> {
    RevocationKeys.nonempty(options.issuer, "issuer");
    RevocationKeys.nonempty(options.audience, "audience");
    const storage = options.storageFactory.createRecordStorage(context, spec, options.group, {
      prepareOnAccess: false,
    });
    try {
      if (!storage.atomicCompareAndSet)
        throw new Error("Token revocations require atomic compare-and-set.");
      if (options.createMissingStructures !== false)
        await StoragePreparations.for(options.storageFactory).prepareRecord(
          context,
          spec,
          options.group,
          "create",
        );
      return new PersistentTokenRevocations(options, storage);
    } catch (error) {
      try {
        storage.close();
      } catch (closeError) {
        throw new AggregateError([error, closeError], "Revocation preparation and cleanup failed.");
      }
      throw error;
    }
  }

  /**
   * Reads the exact scoped token identifier by primary key.
   * @param jti Token ID produced by the signed-session strategy.
   * @returns Whether the scoped revocation is still within its inclusive deadline.
   */
  isRevoked(jti: string): Promise<boolean> {
    return this.#run(async () => {
      const id = RevocationKeys.id(this.#issuer, this.#audience, jti);
      const found = await this.#storage.read(id);
      this.#checkOpen();
      if (
        found?.issuer !== this.#issuer ||
        found.audience !== this.#audience ||
        found.tokenId !== jti
      )
        return false;
      return (
        SessionRecords.compare(
          SessionRecords.deadline(this.#clock()),
          RevocationKeys.deadline(found),
        ) <= 0
      );
    });
  }

  /**
   * Stores the maximum full last-acceptance deadline through atomic CAS.
   * @param jti Token ID produced by the signed-session strategy.
   * @param expiresAt Inclusive last valid instant, already including strategy skew.
   * @returns Completion after a deadline no shorter than the supplied instant is stored.
   */
  revoke(jti: string, expiresAt: Timestamp): Promise<void> {
    return this.#run(async () => {
      const proposed = this.#record(jti, expiresAt);
      for (;;) {
        this.#checkOpen();
        const current = await this.#storage.read(proposed.id);
        this.#checkOpen();
        if (current !== undefined && RevocationKeys.compare(current, proposed) >= 0) return;
        const updated =
          current === undefined
            ? proposed
            : create(TokenRevocationSchema, { ...current, whenExpires: proposed.whenExpires });
        if (await this.#storage.compareAndSet(proposed.id, current, updated)) {
          this.#checkOpen();
          return;
        }
      }
    });
  }

  /**
   * Removes records strictly before an application-selected trusted cutoff.
   * A record at the cutoff remains, because its token is still valid there.
   * Concurrently extended records survive conditional deletion; a changed
   * candidate may require a later invocation. Failure or cancellation rejects
   * after any already completed removals.
   * @param cutoff Current-or-earlier exact maintenance cutoff.
   * @param signal Optional maintenance cancellation.
   * @returns Number of confirmed removals in this invocation.
   */
  purgeExpired(cutoff: Timestamp, signal?: AbortSignal): Promise<number> {
    return this.#run(async () => {
      const valid = SessionRecords.deadline(cutoff);
      signal?.throwIfAborted();
      if (SessionRecords.compare(valid, SessionRecords.deadline(this.#clock())) > 0)
        throw new RangeError("Purge cutoff cannot be later than the trusted clock.");
      return this.#purge(valid, signal);
    });
  }

  /**
   * Closes the selected handle after fencing and draining admitted work.
   * The shared factory remains open.
   * @returns Completion after the selected handle is closed.
   */
  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    this.#closed = true;
    this.#closing = this.#finishClose();
    return this.#closing;
  }

  /**
   * Builds one complete scoped record with its exact supplied deadline.
   * @param jti Token identifier to revoke.
   * @param expiresAt Full last-acceptance deadline.
   * @returns Complete persisted record.
   */
  #record(jti: string, expiresAt: Timestamp): TokenRevocation {
    return create(TokenRevocationSchema, {
      id: RevocationKeys.id(this.#issuer, this.#audience, jti),
      issuer: this.#issuer,
      audience: this.#audience,
      tokenId: jti,
      whenExpires: SessionRecords.deadline(expiresAt),
    });
  }

  /**
   * Completes closure after admitted storage operations settle.
   * @returns Completion after handle release.
   */
  async #finishClose(): Promise<void> {
    if (this.#active > 0) await new Promise<void>((resolve) => (this.#drained = resolve));
    this.#storage.close();
  }

  /**
   * Admits one operation while the handle is open and tracks its settlement.
   * @typeParam T Operation result.
   * @param work Storage operation to run.
   * @returns Settled operation result.
   */
  async #run<T>(work: () => Promise<T>): Promise<T> {
    this.#checkOpen();
    this.#active += 1;
    try {
      return await work();
    } finally {
      this.#active -= 1;
      if (this.#active === 0) this.#drained?.();
    }
  }

  /**
   * Rejects work after closure, including loops resumed from awaited storage.
   */
  #checkOpen(): void {
    if (this.#closed) throw new Error("Token revocations are closed.");
  }

  /**
   * Traverses flow-scoped indexed expiry groups before the cutoff.
   * @param cutoff Strict maintenance cutoff.
   * @param signal Optional cancellation.
   * @returns Number of confirmed removals.
   */
  async #purge(cutoff: Timestamp, signal?: AbortSignal): Promise<number> {
    const lower = RevocationKeys.lower(this.#scope);
    const upper = RevocationKeys.upper(this.#scope, cutoff);
    let completed: Uint8Array | undefined;
    let removed = 0;
    for (;;) {
      signal?.throwIfAborted();
      this.#checkOpen();
      const key = await this.#nextExpiry(lower, upper, completed);
      signal?.throwIfAborted();
      this.#checkOpen();
      if (key === undefined) return removed;
      const [count, raced] = await this.#purgeTie(key, cutoff, signal);
      removed += count;
      if (raced) return removed;
      completed = key;
    }
  }

  /**
   * Selects the next exact indexed expiry in this issuer/audience scope.
   * @param lower First possible key in scope.
   * @param upper Strict cutoff key in scope.
   * @param completed Last drained expiry key.
   * @returns Next candidate expiry key, if any.
   */
  async #nextExpiry(
    lower: Uint8Array,
    upper: Uint8Array,
    completed?: Uint8Array,
  ): Promise<Uint8Array | undefined> {
    const entries = await this.#storage.queryPlanEntries({
      predicate: {
        kind: "all",
        predicates: [
          { kind: "comparison", column: "expires_order", operator: "lessThan", value: upper },
          {
            kind: "comparison",
            column: "expires_order",
            operator: completed === undefined ? "greaterOrEqual" : "greaterThan",
            value: completed ?? lower,
          },
        ],
      },
      order: [{ column: "expires_order", direction: "asc" }],
      limit: 1,
    });
    const first = entries[0];
    return first === undefined ? undefined : RevocationKeys.order(first.record);
  }

  /**
   * Pages one exact expiry group by immutable storage ID.
   * @param key Selected exact expiry key.
   * @param cutoff Strict maintenance cutoff.
   * @param signal Optional cancellation.
   * @returns Removed count and whether a candidate changed concurrently.
   */
  async #purgeTie(
    key: Uint8Array,
    cutoff: Timestamp,
    signal?: AbortSignal,
  ): Promise<[number, boolean]> {
    let after: RecordContinuation<string> | undefined;
    let removed = 0;
    let raced = false;
    for (;;) {
      signal?.throwIfAborted();
      const entries = await this.#storage.queryEntries({
        filters: [{ column: "expires_order", value: key }],
        sort: [{ field: "id" }],
        limit: defaultQueryCandidateLimit,
        ...(after === undefined ? {} : { after }),
      });
      signal?.throwIfAborted();
      this.#checkOpen();
      if (entries.length === 0) return [removed, raced];
      for (const entry of entries) {
        const result = await this.#removeEligible(entry.record, cutoff, signal);
        if (result === true) removed += 1;
        if (result === false) raced = true;
      }
      const last = entries.at(-1);
      if (last === undefined) return [removed, raced];
      after = { id: last.id, values: [{ field: "id", value: last.id }] };
    }
  }

  /**
   * Conditionally removes one scoped record still strictly before the cutoff.
   * @param candidate Selected record snapshot.
   * @param cutoff Strict maintenance cutoff.
   * @param signal Optional cancellation.
   * @returns True if removed, false if changed, undefined if ineligible.
   */
  async #removeEligible(
    candidate: TokenRevocation,
    cutoff: Timestamp,
    signal?: AbortSignal,
  ): Promise<boolean | undefined> {
    signal?.throwIfAborted();
    this.#checkOpen();
    if (
      candidate.issuer !== this.#issuer ||
      candidate.audience !== this.#audience ||
      RevocationKeys.compareDeadline(candidate, cutoff) >= 0
    )
      return undefined;
    const removed = await this.#storage.compareAndSet(candidate.id, candidate, undefined);
    signal?.throwIfAborted();
    this.#checkOpen();
    return removed;
  }
}

/**
 * Exact scope, identity and expiry encodings for signed revocations.
 */
const RevocationKeys = Object.freeze({
  /**
   * Validates an identifier without imposing a new length policy.
   *
   * @param value Identifier supplied by the selected strategy or application.
   * @param name Error context.
   * @returns Validated identifier.
   */
  nonempty(value: string, name: string): string {
    if (typeof value !== "string" || value.length === 0)
      throw new TypeError(`${name} must be nonempty.`);
    return value;
  },

  /**
   * Creates the unambiguous issuer and audience scope digest.
   *
   * @param issuer Issuing service.
   * @param audience Recipient.
   * @returns Fixed scope prefix for indexed expiry.
   */
  scope(issuer: string, audience: string): Uint8Array {
    return createHash("sha256")
      .update(JSON.stringify([issuer, audience]))
      .digest();
  },

  /**
   * Creates the scoped token-ID digest for primary lookup.
   *
   * @param issuer Issuing service.
   * @param audience Recipient.
   * @param jti Token identifier.
   * @returns Fixed storage ID.
   */
  id(issuer: string, audience: string, jti: string): string {
    RevocationKeys.nonempty(jti, "jti");
    return createHash("sha256")
      .update(JSON.stringify([issuer, audience, jti]))
      .digest("hex");
  },

  /**
   * Encodes the first possible expiry in a scope.
   *
   * @param scope Fixed issuer/audience digest.
   * @returns Lower indexed bound.
   */
  lower(scope: Uint8Array): Uint8Array {
    return Buffer.concat([scope, Buffer.alloc(12)]);
  },

  /**
   * Encodes one exact deadline within a scope.
   *
   * @param scope Fixed issuer/audience digest.
   * @param cutoff Exact deadline.
   * @returns Indexed bound.
   */
  upper(scope: Uint8Array, cutoff: Timestamp): Uint8Array {
    return Buffer.concat([scope, SessionRecords.orderKey(cutoff)]);
  },

  /**
   * Encodes a record's scope and exact deadline for indexed ordering.
   *
   * @param record Complete scoped revocation.
   * @returns Indexed order key.
   */
  order(record: TokenRevocation): Uint8Array {
    return RevocationKeys.upper(
      RevocationKeys.scope(record.issuer, record.audience),
      RevocationKeys.deadline(record),
    );
  },

  /**
   * Reads one complete required deadline.
   *
   * @param record Revocation to check.
   * @returns Validated exact deadline.
   */
  deadline(record: TokenRevocation): Timestamp {
    if (record.whenExpires === undefined) throw new Error("Revocation has no deadline.");
    return SessionRecords.deadline(record.whenExpires);
  },

  /**
   * Compares two revocation records by exact deadline.
   *
   * @param left Current record.
   * @param right Proposed record.
   * @returns Exact timestamp ordering.
   */
  compare(left: TokenRevocation, right: TokenRevocation): number {
    return SessionRecords.compare(RevocationKeys.deadline(left), RevocationKeys.deadline(right));
  },

  /**
   * Compares a record's exact deadline with an application cutoff.
   *
   * @param record Current revocation.
   * @param cutoff Trusted maintenance cutoff.
   * @returns Exact timestamp ordering.
   */
  compareDeadline(record: TokenRevocation, cutoff: Timestamp): number {
    return SessionRecords.compare(RevocationKeys.deadline(record), cutoff);
  },
});

const context: StorageContext = { name: "__AUTH_TOKEN_REVOCATIONS__", multitenant: false };
const spec = new RecordSpec<string, TokenRevocation>({
  recordType: TokenRevocationSchema,
  idKind: "string",
  extractId: (record) => record.id,
  columns: [new RecordColumn("expires_order", ColumnTypes.fixedBytes(44), RevocationKeys.order)],
  indexes: [{ name: "expiry", columns: ["expires_order", "id"] }],
});
