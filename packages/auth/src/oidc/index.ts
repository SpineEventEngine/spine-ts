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

import { Time } from "@spine-event-engine/core/time";
import {
  createHash,
  randomBytes as nodeRandomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  OidcLoginGrantSchema,
  OidcLoginTransactionSchema,
  type OidcLoginGrant,
  type OidcLoginTransaction,
} from "@spine-event-engine/proto/auth";
import { Configuration, buildAuthorizationUrl, calculatePKCECodeChallenge } from "openid-client";

import type { AuthenticatedPrincipal, RequestCredential, ResolvedSession } from "../index.js";
import { MemoryOidcFlowStore, type OidcFlowStore } from "./flow-store.js";
import { OidcFlowKeys } from "./records.js";
import { SessionRecords } from "../sessions/session-record.js";
import type {
  ApplicationSessionIssue,
  ApplicationSessionIssuer,
  ExternalIdentity,
  IdentityMapping,
  OidcFlowCallbackInput,
  OidcFlowCallbackResult,
  OidcFlowClock,
  OidcFlowExchangeInput,
  OidcFlowExchangeResult,
  OidcFlowOptions,
  OidcFlowRandom,
  OidcFlowStartInput,
  OidcFlowStartResult,
  OidcVerifiedIdentityProvider,
  ResolvedApplicationIdentity,
} from "./contracts.js";

export type * from "./contracts.js";

const RANDOM_BYTES = 32;
const DEFAULT_TRANSACTION_TTL = 5 * 60 * 1_000;
const DEFAULT_GRANT_TTL = 60 * 1_000;
const DEFAULT_CAPACITY = 1_000;
const DEFAULT_COLLISION_ATTEMPTS = 3;
const DEFAULT_TIMEOUT = 30 * 1_000;
const DEFAULT_MAX_URL = 4_096;
const MAX_TIMESTAMP_MILLISECONDS = 253_402_300_799_999;
const base64Url32 = /^[A-Za-z0-9_-]{43}$/;
const RFC7636_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;

/**
 * Bounded, framework-neutral authorization-code transaction manager.
 *
 * It manages finite start, callback, and one-time application-session exchange
 * transitions; HTTP endpoints and provider discovery remain application work.
 */
export class OidcFlow {
  readonly #store: OidcFlowStore;

  readonly #localStore: MemoryOidcFlowStore | undefined;

  readonly #authorizationEndpoint: URL;

  readonly #callbackUri: string;

  readonly #clientId: string;

  readonly #scopes: readonly string[];

  readonly #allowedPostLoginRedirects: ReadonlySet<string>;

  readonly #provider: OidcVerifiedIdentityProvider;

  readonly #providerIssuer: string;

  readonly #identityMapping: IdentityMapping;

  readonly #sessionIssuer: ApplicationSessionIssuer;

  readonly #clock: OidcFlowClock;

  readonly #random: OidcFlowRandom;

  readonly #transactionTtlMilliseconds: number;

  readonly #grantTtlMilliseconds: number;

  readonly #collisionAttempts: number;

  readonly #operationTimeoutMilliseconds: number;

  readonly #maxAuthorizationUrlLength: number;

  readonly #transactions = new Map<string, Transaction>();

  readonly #grants = new Map<string, number>();

  readonly #callbacks = new Set<AbortController>();

  readonly #rawCollaborators = new Set<Promise<unknown>>();

  #lateIssuerFailure: { readonly reason: unknown } | undefined;

  #closed = false;

  #active = 0;

  #drained: (() => void) | undefined;

  #closing: Promise<void> | undefined;

  /**
   * Creates a bounded authorization-code flow.
   * @param options The trusted provider, callback, transaction, grant, and session settings.
   */
  constructor(options: OidcFlowOptions) {
    const settings = OidcFlowValues.settings(options);
    this.#authorizationEndpoint = settings.authorizationEndpoint;
    this.#callbackUri = options.callbackUri;
    this.#clientId = settings.clientId;
    this.#scopes = settings.scopes;
    this.#allowedPostLoginRedirects = settings.redirects;
    this.#provider = options.provider;
    this.#providerIssuer = options.provider.issuer;
    this.#identityMapping = options.identityMapping;
    this.#sessionIssuer = options.sessionIssuer;
    this.#clock = options.clock ?? { now: () => Time.currentTimeMillis() };
    this.#random = options.randomBytes ?? nodeRandomBytes;
    const limits = OidcFlowValues.limits(options);
    this.#transactionTtlMilliseconds = limits.transactionTtlMilliseconds;
    this.#grantTtlMilliseconds = limits.grantTtlMilliseconds;
    this.#collisionAttempts = limits.collisionAttempts;
    this.#operationTimeoutMilliseconds = limits.operationTimeoutMilliseconds;
    this.#maxAuthorizationUrlLength = limits.maxAuthorizationUrlLength;
    this.#localStore = this.#selectMemoryStore(options, limits);
    const selectedStore = options.store ?? this.#localStore;
    if (selectedStore === undefined) throw new Error("OIDC flow store is unavailable.");
    this.#store = selectedStore;
    if (typeof this.#store.flowId !== "string" || this.#store.flowId.trim().length === 0)
      throw new TypeError("OIDC flow store must provide a nonempty flow identity.");
  }

  /**
   * Selects process-local storage only when no store was injected.
   * @param options Flow configuration and optional injected store.
   * @param limits Validated memory capacity settings.
   * @returns A local store, or undefined when the caller supplied one.
   */
  #selectMemoryStore(
    options: OidcFlowOptions,
    limits: ReturnType<typeof OidcFlowValues.limits>,
  ): MemoryOidcFlowStore | undefined {
    if (options.store !== undefined) {
      if (options.maxTransactions !== undefined || options.maxGrants !== undefined)
        throw new TypeError("Memory-only OIDC capacity options require the default store.");
      return undefined;
    }
    return new MemoryOidcFlowStore(
      randomUUID(),
      () => OidcFlowValues.timestamp(this.#clock.now()),
      limits.maxTransactions,
      limits.maxGrants,
    );
  }

  /**
   * Starts one finite authorization-code transaction without exposing any application credential.
   * @param input The browser challenge and post-login redirect.
   * @param signal Optional host request cancellation; ordinary abort rejects with its reason.
   * @returns The authorization URL and state, or a rejection.
   */
  async start(input: OidcFlowStartInput, signal?: AbortSignal): Promise<OidcFlowStartResult> {
    return this.#run(() => this.#start(input, signal));
  }

  /**
   * Validates a start request and retries bounded entropy collisions.
   * @param input Browser challenge and allowed redirect.
   * @returns A persisted start or a rejected attempt.
   */
  async #start(input: OidcFlowStartInput, signal?: AbortSignal): Promise<OidcFlowStartResult> {
    if (this.#isClosed()) return OidcFlowValues.rejected("closed");
    signal?.throwIfAborted();
    const request = OidcFlowValues.snapshotStartInput(input);
    if (
      request === undefined ||
      !OidcFlowValues.validStartInput(request, this.#allowedPostLoginRedirects)
    )
      return OidcFlowValues.rejected("invalid-input");
    const now = this.#now();
    if (now === undefined || this.#isClosed()) return OidcFlowValues.rejected("closed");
    this.#sweepExpired(now);
    if (this.#localStore?.transactionsFull()) return OidcFlowValues.rejected("capacity-exceeded");
    for (let attempt = 0; attempt < this.#collisionAttempts; attempt += 1) {
      const material = this.#transactionMaterial();
      if (material === undefined) {
        if (this.#isClosed()) return OidcFlowValues.rejected("closed");
        continue;
      }
      try {
        const result = await this.#attemptStart(material, request, signal);
        if (result !== undefined) return result;
      } finally {
        material.bytes.forEach((bytes) => bytes.fill(0));
      }
    }
    return OidcFlowValues.rejected("entropy-exhausted");
  }

  /**
   * Persists one fully bound transaction before returning its authorization URL.
   * @param material Fresh state, nonce, and verifier bytes.
   * @param request Validated browser start request.
   * @returns A start result, or undefined after a collision.
   */
  async #attemptStart(
    material: TransactionMaterial,
    request: OidcFlowStartInput,
    signal?: AbortSignal,
  ): Promise<OidcFlowStartResult | undefined> {
    const current = this.#now();
    if (current === undefined) return OidcFlowValues.rejected("closed");
    this.#sweepExpired(current);
    if (this.#isClosed()) return OidcFlowValues.rejected("closed");
    if (this.#localStore?.transactionsFull()) return OidcFlowValues.rejected("capacity-exceeded");
    if (this.#transactions.has(material.state) || this.#transactionMaterialInUse(material))
      return undefined;
    const expiry = OidcFlowValues.expiryAt(current, this.#transactionTtlMilliseconds);
    if (expiry === undefined) {
      this.#failClosed();
      return OidcFlowValues.rejected("clock-failure");
    }
    const verifier = Buffer.from(material.providerVerifierBytes).toString("base64url");
    const authorizationUrl = await this.#authorizationUrl(material.state, material.nonce, verifier);
    signal?.throwIfAborted();
    if (authorizationUrl === undefined) return OidcFlowValues.rejected("invalid-input");
    const record = this.#transactionRecord(material, request, verifier, expiry);
    if (!(await this.#store.insertTransaction(record, signal))) {
      signal?.throwIfAborted();
      return undefined;
    }
    if (signal?.aborted || this.#isClosed()) {
      await this.#compensate(() => this.#store.consumeTransaction(record), signal);
      return OidcFlowValues.rejected("closed");
    }
    this.#retainTransaction(material, expiry);
    return Object.freeze({ kind: "started", authorizationUrl, expiresAt: expiry });
  }

  /**
   * Removes a confirmed undisclosed write when its exact record remains.
   * @param remove Conditional deletion of the exact inserted record.
   * @param signal Optional caller cancellation signal.
   * @returns Completion after confirmed compensation.
   */
  async #compensate(remove: () => Promise<boolean>, signal?: AbortSignal): Promise<void> {
    try {
      await remove();
    } catch (error) {
      throw new AggregateError(
        [signal?.aborted ? signal.reason : new Error("OIDC flow closed."), error],
        "OIDC confirmed-write compensation failed.",
      );
    }
    signal?.throwIfAborted();
  }

  /**
   * Builds one complete domain transaction from validated material.
   * @param material Fresh state and nonce.
   * @param request Validated browser start request.
   * @param verifier Provider PKCE verifier.
   * @param expiry Exact transaction deadline in milliseconds.
   * @returns Complete typed transaction.
   */
  #transactionRecord(
    material: TransactionMaterial,
    request: OidcFlowStartInput,
    verifier: string,
    expiry: number,
  ): OidcLoginTransaction {
    return create(OidcLoginTransactionSchema, {
      lookupDigest: OidcFlowKeys.digest(this.#store.flowId, material.state),
      flowId: this.#store.flowId,
      providerIssuer: this.#providerIssuer,
      clientId: this.#clientId,
      callbackUri: this.#callbackUri,
      nonce: material.nonce,
      providerCodeVerifier: verifier,
      browserCodeChallenge: request.browserCodeChallenge,
      postLoginRedirect: request.postLoginRedirect,
      whenExpires: OidcFlowValues.timestamp(expiry),
    });
  }

  /**
   * Retains only local entropy-collision tracking after confirmed persistence.
   * @param material Fresh state and verifier bytes.
   * @param expiry Exact transaction deadline in milliseconds.
   */
  #retainTransaction(material: TransactionMaterial, expiry: number): void {
    const verifier = Buffer.from(material.providerVerifierBytes).toString("base64url");
    this.#transactions.set(material.state, {
      nonce: material.nonce,
      verifierChallenge: OidcFlowValues.sha256Base64Url(verifier),
      expiresAt: expiry,
    });
  }

  /**
   * Processes a callback state before provider verification or mapping.
   * A rejected callback never restores its transaction.
   * @param input The callback state and provider response.
   * @param signal Optional host request cancellation; a consumed state remains consumed.
   * @returns The callback result, including a one-time grant when accepted.
   */
  async callback(
    input: OidcFlowCallbackInput,
    signal?: AbortSignal,
  ): Promise<OidcFlowCallbackResult> {
    return this.#run(() => this.#callback(input, signal));
  }

  /**
   * Consumes accepted state before invoking external identity collaborators.
   * @param input Provider callback value.
   * @returns A grant or a rejected callback.
   */
  async #callback(
    input: OidcFlowCallbackInput,
    signal?: AbortSignal,
  ): Promise<OidcFlowCallbackResult> {
    const accepted = await this.#consumeCallback(input, signal);
    if ("kind" in accepted) return accepted;
    const { transaction, callback } = accepted;
    if (callback.error !== undefined) return OidcFlowValues.callbackRejected("provider-error");
    signal?.throwIfAborted();
    const mapped = await this.#mapCallback(callback.code, transaction, signal);
    if ("kind" in mapped) return mapped;
    return this.#createGrant(mapped, transaction, signal);
  }

  /**
   * Validates binding and expiry before atomically consuming a transaction.
   * @param input Browser callback input.
   * @returns Accepted transaction and code or a rejection.
   */
  async #consumeCallback(
    input: OidcFlowCallbackInput,
    signal?: AbortSignal,
  ): Promise<ConsumedTransaction | OidcFlowCallbackResult> {
    if (this.#isClosed()) return OidcFlowValues.callbackRejected("closed");
    signal?.throwIfAborted();
    const state = OidcFlowValues.snapshotCallbackState(input);
    if (state === undefined) return OidcFlowValues.callbackRejected("invalid-input");
    const now = this.#now();
    if (now === undefined || this.#isClosed()) return OidcFlowValues.callbackRejected("closed");
    const transaction = await this.#store.readTransaction(
      OidcFlowKeys.digest(this.#store.flowId, state),
      signal,
    );
    signal?.throwIfAborted();
    if (transaction === undefined) return OidcFlowValues.callbackRejected("not-found");
    if (this.#isClosed()) return OidcFlowValues.callbackRejected("closed");
    const current = this.#now();
    if (current === undefined || this.#isClosed()) return OidcFlowValues.callbackRejected("closed");
    const callback = OidcFlowValues.snapshotCallbackInput(input);
    if (callback === undefined || !OidcFlowValues.validCallbackInput(callback))
      return OidcFlowValues.callbackRejected("invalid-input");
    const invalid = this.#callbackValidity(transaction, callback, current);
    if (invalid !== undefined) return invalid;
    if (this.#isClosed()) return OidcFlowValues.callbackRejected("closed");
    if (!(await this.#store.consumeTransaction(transaction, signal))) {
      signal?.throwIfAborted();
      return OidcFlowValues.callbackRejected("not-found");
    }
    return this.#settleConsumedCallback(state, transaction, callback, signal);
  }

  /**
   * Rechecks expiry after a confirmed one-use transaction consumption.
   * @param state Browser state whose local collision fact can be discarded.
   * @param transaction Complete consumed transaction.
   * @param callback Validated callback facts.
   * @param signal Optional host request cancellation.
   * @returns Accepted callback or a terminal rejection without state restoration.
   */
  #settleConsumedCallback(
    state: string,
    transaction: OidcLoginTransaction,
    callback: ValidCallbackInputSnapshot,
    signal?: AbortSignal,
  ): ConsumedTransaction | OidcFlowCallbackResult {
    this.#transactions.delete(state);
    signal?.throwIfAborted();
    const consumedAt = this.#now();
    if (consumedAt === undefined || this.#isClosed())
      return OidcFlowValues.callbackRejected("closed");
    if (this.#expired(transaction, consumedAt)) return OidcFlowValues.callbackRejected("expired");
    return { transaction, callback };
  }

  /**
   * Checks exact expiry and provider binding before transaction consumption.
   * @param transaction Persisted state snapshot.
   * @param callback Validated callback facts.
   * @param current Trusted time sampled after storage read.
   * @returns Rejection when invalid, otherwise undefined.
   */
  #callbackValidity(
    transaction: OidcLoginTransaction,
    callback: ValidCallbackInputSnapshot,
    current: number,
  ): OidcFlowCallbackResult | undefined {
    if (this.#expired(transaction, current)) return OidcFlowValues.callbackRejected("expired");
    if (callback.responseIssuer !== undefined && callback.responseIssuer !== this.#providerIssuer)
      return OidcFlowValues.callbackRejected("issuer-mismatch");
    if (!this.#matchesTransaction(transaction))
      return OidcFlowValues.callbackRejected("issuer-mismatch");
    return undefined;
  }

  /**
   * Compares a trusted time against a record's exact deadline.
   * @param record Persisted transaction or grant being checked.
   * @param current Trusted milliseconds after the latest awaited transition.
   * @returns Whether the record has reached its deadline.
   */
  #expired(record: OidcLoginTransaction | OidcLoginGrant, current: number): boolean {
    return (
      SessionRecords.compare(OidcFlowValues.timestamp(current), OidcFlowKeys.expiry(record)) >= 0
    );
  }

  /**
   * Checks a persisted transaction against the current trusted provider configuration.
   * @param transaction Persisted callback binding.
   * @returns Whether issuer, client, and exact callback URI still match.
   */
  #matchesTransaction(transaction: OidcLoginTransaction): boolean {
    return (
      transaction.providerIssuer === this.#providerIssuer &&
      transaction.clientId === this.#clientId &&
      transaction.callbackUri === this.#callbackUri
    );
  }

  /**
   * Verifies a consumed provider code and maps its verified external identity.
   * @param code Provider authorization code.
   * @param transaction Consumed transaction binding and nonce.
   * @returns Resolved application identity or a rejected callback.
   */
  async #mapCallback(
    code: string,
    transaction: OidcLoginTransaction,
    signal?: AbortSignal,
  ): Promise<ResolvedApplicationIdentity | OidcFlowCallbackResult> {
    signal?.throwIfAborted();
    const identity = await this.#runBounded(
      (bounded) =>
        this.#provider.exchangeAuthorizationCode({
          code,
          clientId: this.#clientId,
          callbackUri: this.#callbackUri,
          providerCodeVerifier: transaction.providerCodeVerifier,
          expectedNonce: transaction.nonce,
          signal: bounded,
        }),
      signal,
    );
    signal?.throwIfAborted();
    if (this.#isClosed()) return OidcFlowValues.callbackRejected("closed");
    const verified = this.#verifiedIdentity(identity);
    if (verified === undefined) return OidcFlowValues.callbackRejected("verification-failed");
    const resolved = await this.#runBounded(
      (bounded) => this.#identityMapping.resolve(verified, bounded),
      signal,
    );
    signal?.throwIfAborted();
    if (this.#isClosed()) return OidcFlowValues.callbackRejected("closed");
    const mapped = OidcFlowValues.snapshotResolvedIdentity(resolved, verified);
    return mapped ?? OidcFlowValues.callbackRejected("mapping-failed");
  }

  /**
   * Validates a provider identity without exposing hostile getter failures.
   * @param identity Provider result.
   * @returns Verified identity or undefined.
   */
  #verifiedIdentity(identity: unknown): ExternalIdentity | undefined {
    try {
      return OidcFlowValues.validExternalIdentity(identity, this.#providerIssuer);
    } catch {
      return undefined;
    }
  }

  /**
   * Builds and persists a one-use application grant after identity mapping.
   * @param mapped Validated mapped identity.
   * @param transaction Consumed transaction binding.
   * @returns Grant or rejection.
   */
  async #createGrant(
    mapped: ResolvedApplicationIdentity,
    transaction: OidcLoginTransaction,
    signal?: AbortSignal,
  ): Promise<OidcFlowCallbackResult> {
    signal?.throwIfAborted();
    const current = this.#now();
    if (current === undefined || this.#isClosed()) return OidcFlowValues.callbackRejected("closed");
    this.#sweepGrants(current);
    if (this.#localStore?.grantsFull()) return OidcFlowValues.callbackRejected("capacity-exceeded");
    const expiry = OidcFlowValues.expiryAt(current, this.#grantTtlMilliseconds);
    if (expiry === undefined) {
      this.#failClosed();
      return OidcFlowValues.callbackRejected("clock-failure");
    }
    const grant = this.#nextGrant();
    if (
      grant === undefined ||
      this.#isClosed() ||
      this.#localStore?.grantsFull() ||
      this.#grants.has(grant)
    )
      return OidcFlowValues.callbackRejected(this.#isClosed() ? "closed" : "entropy-exhausted");
    return this.#persistGrant(grant, mapped, transaction, expiry, signal);
  }

  /**
   * Persists a grant and compensates only a confirmed insertion after closure.
   * @param grant Random browser grant value.
   * @param mapped Validated mapped identity.
   * @param transaction Consumed transaction binding.
   * @param expiry Exact grant deadline in milliseconds.
   * @returns Grant or rejection.
   */
  async #persistGrant(
    grant: string,
    mapped: ResolvedApplicationIdentity,
    transaction: OidcLoginTransaction,
    expiry: number,
    signal?: AbortSignal,
  ): Promise<OidcFlowCallbackResult> {
    const record = this.#grantRecord(grant, mapped, transaction, expiry);
    if (!(await this.#store.insertGrant(record, signal))) {
      signal?.throwIfAborted();
      return OidcFlowValues.callbackRejected("entropy-exhausted");
    }
    if (signal?.aborted || this.#isClosed()) {
      await this.#compensate(() => this.#store.consumeGrant(record), signal);
      return OidcFlowValues.callbackRejected("closed");
    }
    this.#grants.set(grant, expiry);
    return Object.freeze({
      kind: "granted",
      grant,
      postLoginRedirect: transaction.postLoginRedirect,
      expiresAt: expiry,
    });
  }

  /**
   * Builds a typed application grant bound to the consumed transaction.
   * @param grant Random browser grant value.
   * @param mapped Validated mapped identity.
   * @param transaction Consumed transaction binding.
   * @param expiry Exact grant deadline in milliseconds.
   * @returns Complete typed grant record.
   */
  #grantRecord(
    grant: string,
    mapped: ResolvedApplicationIdentity,
    transaction: OidcLoginTransaction,
    expiry: number,
  ): OidcLoginGrant {
    return create(OidcLoginGrantSchema, {
      lookupDigest: OidcFlowKeys.digest(this.#store.flowId, grant),
      flowId: this.#store.flowId,
      principal: SessionRecords.principal(mapped.principal),
      browserCodeChallenge: transaction.browserCodeChallenge,
      postLoginRedirect: transaction.postLoginRedirect,
      whenExpires: OidcFlowValues.timestamp(expiry),
    });
  }

  /**
   * Validates and consumes a grant before issuing an application session.
   * All failures deliberately have the same result to avoid grant enumeration.
   * @param input The grant and browser PKCE proof.
   * @param signal Optional host request cancellation; a consumed grant remains consumed.
   * @returns The issued application session or an enumeration-safe rejection.
   */
  async exchange(
    input: OidcFlowExchangeInput,
    signal?: AbortSignal,
  ): Promise<OidcFlowExchangeResult> {
    return this.#run(() => this.#exchange(input, signal));
  }

  /**
   * Issues a session only after winning grant consumption.
   * @param input Browser grant and verifier.
   * @returns An issued session or enumeration-safe rejection.
   */
  async #exchange(
    input: OidcFlowExchangeInput,
    signal?: AbortSignal,
  ): Promise<OidcFlowExchangeResult> {
    const grant = await this.#consumeGrant(input, signal);
    if (grant === undefined) return OidcFlowValues.exchangeRejected();
    signal?.throwIfAborted();
    const issued = await this.#runBounded(
      (bounded) => this.#sessionIssuer.issue(OidcFlowKeys.principal(grant), bounded),
      signal,
      true,
    );
    signal?.throwIfAborted();
    const safeIssue = OidcFlowValues.snapshotSessionIssue(issued);
    if (this.#isClosed() || safeIssue === undefined) return OidcFlowValues.exchangeRejected();
    return Object.freeze({
      kind: "issued",
      credential: safeIssue.credential,
      session: safeIssue.session,
    });
  }

  /**
   * Validates binding, expiry, and browser proof before one atomic grant deletion.
   * @param input Browser grant and verifier.
   * @returns Consumed grant or undefined after rejection.
   */
  async #consumeGrant(
    input: OidcFlowExchangeInput,
    signal?: AbortSignal,
  ): Promise<OidcLoginGrant | undefined> {
    if (this.#isClosed()) return undefined;
    signal?.throwIfAborted();
    const request = OidcFlowValues.snapshotGrantExchangeInput(input);
    if (request === undefined || !OidcFlowValues.validGrant(request.grant)) return undefined;
    const now = this.#now();
    if (now === undefined) return undefined;
    const grant = await this.#store.readGrant(
      OidcFlowKeys.digest(this.#store.flowId, request.grant),
      signal,
    );
    signal?.throwIfAborted();
    if (grant === undefined) return undefined;
    if (this.#isClosed()) return undefined;
    const current = this.#now();
    if (current === undefined || this.#isClosed()) return undefined;
    const verifier = OidcFlowValues.snapshotBrowserCodeVerifier(input);
    if (!this.#validGrantProof(grant, verifier, current)) return undefined;
    if (this.#isClosed()) return undefined;
    if (!(await this.#store.consumeGrant(grant, signal))) {
      signal?.throwIfAborted();
      return undefined;
    }
    this.#grants.delete(request.grant);
    signal?.throwIfAborted();
    const consumedAt = this.#now();
    if (consumedAt === undefined || this.#isClosed() || this.#expired(grant, consumedAt))
      return undefined;
    return grant;
  }

  /**
   * Checks exact grant expiry and browser PKCE proof before consumption.
   * @param grant Persisted grant snapshot.
   * @param verifier Browser supplied verifier.
   * @param current Trusted time sampled after storage read.
   * @returns Whether the grant may be consumed.
   */
  #validGrantProof(grant: OidcLoginGrant, verifier: unknown, current: number): boolean {
    if (
      SessionRecords.compare(OidcFlowValues.timestamp(current), OidcFlowKeys.expiry(grant)) >= 0 ||
      verifier === undefined ||
      !OidcFlowValues.validBrowserCodeVerifier(verifier)
    )
      return false;
    return OidcFlowValues.constantTimeEquals(
      OidcFlowValues.sha256Base64Url(verifier),
      grant.browserCodeChallenge,
    );
  }

  /**
   * Closes the flow after admitted work and original collaborator promises settle.
   *
   * An injected store and factory remain open. A late distinct issuer failure
   * rejects this close operation; repeated calls retain that result.
   *
   * @returns Completion after raw work drains and local memory closes.
   */
  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    this.#closed = true;
    this.#clearTransactions();
    this.#grants.clear();
    this.#callbacks.forEach((controller) => {
      controller.abort();
    });
    this.#callbacks.clear();
    this.#closing = this.#finishClose();
    return this.#closing;
  }

  /**
   * Removes eligible records through the selected flow store.
   *
   * @param cutoff Trusted current-or-earlier exact deadline.
   * @param signal Optional cancellation.
   * @returns Confirmed transaction and grant removals in this pass.
   */
  purgeExpired(
    cutoff: Timestamp,
    signal?: AbortSignal,
  ): Promise<{ transactions: number; grants: number }> {
    if (this.#isClosed()) return Promise.reject(new Error("OIDC flow is closed."));
    return this.#run(() => this.#store.purgeExpired(cutoff, signal));
  }

  /**
   * Waits for admitted work, then releases only internally selected memory.
   *
   * @returns Completion after all admitted operations settle.
   */
  async #finishClose(): Promise<void> {
    if (this.#active > 0) await new Promise<void>((resolve) => (this.#drained = resolve));
    while (this.#rawCollaborators.size > 0) await Promise.allSettled([...this.#rawCollaborators]);
    let closeFailure: unknown;
    try {
      await this.#localStore?.close();
    } catch (error) {
      closeFailure = error;
    }
    if (this.#lateIssuerFailure !== undefined && closeFailure !== undefined)
      throw new AggregateError(
        [this.#lateIssuerFailure.reason, closeFailure],
        "OIDC flow close failed.",
      );
    if (this.#lateIssuerFailure !== undefined) throw this.#lateIssuerFailure.reason;
    // A store may reject with a non-Error reason; preserve its exact failure.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (closeFailure !== undefined) throw closeFailure;
  }

  /**
   * Fences admitted asynchronous flow work against closure.
   *
   * @typeParam T Operation result.
   * @param work Operation body.
   * @returns Completion of admitted work.
   */
  async #run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#closed) return work();
    this.#active += 1;
    try {
      return await work();
    } finally {
      this.#active -= 1;
      if (this.#active === 0) this.#drained?.();
    }
  }

  #isClosed(): boolean {
    return this.#closed;
  }

  /**
   * Builds one S256 authorization URL with the maintained OIDC client library.
   *
   * @param state Random state retained in the transaction.
   * @param nonce Random ID-token nonce.
   * @param providerVerifier Provider PKCE verifier.
   * @returns Bounded URL, if representable under configured limits.
   */
  async #authorizationUrl(
    state: string,
    nonce: string,
    providerVerifier: string,
  ): Promise<string | undefined> {
    const endpoint = new URL(this.#authorizationEndpoint);
    for (const name of [
      "response_type",
      "client_id",
      "redirect_uri",
      "scope",
      "state",
      "nonce",
      "code_challenge",
      "code_challenge_method",
    ])
      endpoint.searchParams.delete(name);
    const config = new Configuration(
      { issuer: this.#providerIssuer, authorization_endpoint: endpoint.toString() },
      this.#clientId,
    );
    const url = buildAuthorizationUrl(config, {
      response_type: "code",
      client_id: this.#clientId,
      redirect_uri: this.#callbackUri,
      scope: this.#scopes.join(" "),
      state,
      nonce,
      code_challenge: await calculatePKCECodeChallenge(providerVerifier),
      code_challenge_method: "S256",
    });
    const serialized = url.toString();
    return serialized.length <= this.#maxAuthorizationUrlLength ? serialized : undefined;
  }

  #transactionMaterial(): TransactionMaterial | undefined {
    const bytes: Uint8Array[] = [];
    try {
      const stateBytes = this.#random(RANDOM_BYTES);
      bytes.push(stateBytes);
      if (!(stateBytes instanceof Uint8Array) || stateBytes.byteLength !== RANDOM_BYTES)
        return undefined;
      const nonceBytes = this.#random(RANDOM_BYTES);
      bytes.push(nonceBytes);
      if (!(nonceBytes instanceof Uint8Array) || nonceBytes.byteLength !== RANDOM_BYTES)
        return undefined;
      const verifierBytes = this.#random(RANDOM_BYTES);
      bytes.push(verifierBytes);
      if (!(verifierBytes instanceof Uint8Array) || verifierBytes.byteLength !== RANDOM_BYTES)
        return undefined;
      return {
        state: Buffer.from(stateBytes).toString("base64url"),
        nonce: Buffer.from(nonceBytes).toString("base64url"),
        providerVerifierBytes: verifierBytes,
        bytes,
      };
    } catch {
      return undefined;
    } finally {
      if (bytes.length !== 3) bytes.forEach((value) => value.fill(0));
    }
  }

  /**
   * Runs one collaborator under the configured timeout and request signal.
   * @typeParam T The successful callback result.
   * @param operation The callback to run with a cancellation signal.
   * @param signal Optional host request cancellation.
   * @param issuer Whether distinct issuer failures must remain observable.
   * @returns The callback result, or undefined after timeout or closure.
   */
  async #runBounded<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
    issuer = false,
  ): Promise<T | undefined> {
    if (this.#isClosed()) return undefined;
    signal?.throwIfAborted();
    const controller = new AbortController();
    const onAbort = () => {
      controller.abort(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    this.#callbacks.add(controller);
    const timer = setTimeout(() => {
      controller.abort();
    }, this.#operationTimeoutMilliseconds);
    try {
      return await this.#awaitBounded(operation, controller.signal, issuer);
    } catch (error) {
      if (issuer) throw error;
      return undefined;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      this.#callbacks.delete(controller);
      controller.abort();
    }
  }

  /**
   * Races a tracked original collaborator with its cancellation signal.
   * @typeParam T Collaborator result.
   * @param operation Collaborator invoked with bounded signal.
   * @param signal Bounded cancellation signal.
   * @param issuer Whether distinct issuer failures remain observable.
   * @returns Collaborator result or undefined after cancellation.
   */
  #awaitBounded<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
    issuer: boolean,
  ): Promise<T | undefined> {
    const returned: CollaboratorSettlement = { done: false };
    const raw = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return operation(signal);
    });
    const observed = this.#observeRaw(raw, signal, issuer, returned);
    this.#trackRaw(observed);
    return Promise.race([observed, this.#aborted(signal)]).then((outcome) => {
      returned.done = true;
      if (outcome === undefined) {
        if (returned.failure !== undefined) this.#lateIssuerFailure ??= returned.failure;
        return undefined;
      }
      if (outcome.kind === "failed") throw outcome.reason;
      return outcome.kind === "value" ? outcome.value : undefined;
    });
  }

  /**
   * Resolves when a bounded collaborator signal aborts.
   * @param signal Bounded cancellation signal.
   * @returns Undefined once cancelled.
   */
  #aborted(signal: AbortSignal): Promise<undefined> {
    return new Promise((resolve) => {
      if (signal.aborted) resolve(undefined);
      else
        signal.addEventListener(
          "abort",
          () => {
            resolve(undefined);
          },
          { once: true },
        );
    });
  }

  /**
   * Tracks the original collaborator promise until it really settles.
   * @typeParam T Collaborator result.
   * @param raw Original collaborator promise.
   */
  #trackRaw<T>(raw: Promise<T>): void {
    this.#rawCollaborators.add(raw);
    void raw.then(
      () => {
        this.#rawCollaborators.delete(raw);
      },
      () => {
        this.#rawCollaborators.delete(raw);
      },
    );
  }

  /**
   * Preserves a late issuer failure after a caller-facing timeout or abort.
   * @typeParam T Collaborator result.
   * @param raw Original collaborator promise.
   * @param signal Exact cancellation reason supplied to the collaborator.
   * @param issuer Whether this is a durable session issuer.
   * @param returned Caller-facing settlement and any issuer rejection.
   * @returns The tagged collaborator outcome.
   */
  #observeRaw<T>(
    raw: Promise<T>,
    signal: AbortSignal,
    issuer: boolean,
    returned: CollaboratorSettlement,
  ): Promise<CollaboratorOutcome<T>> {
    return raw.then(
      (value) => ({ kind: "value", value }),
      (error: unknown) => {
        if (!issuer || (signal.aborted && error === signal.reason))
          return { kind: "declined" } as const;
        const failure = { reason: error };
        if (returned.done) this.#lateIssuerFailure ??= failure;
        else returned.failure = failure;
        return { kind: "failed", reason: error } as const;
      },
    );
  }

  #nextGrant(): string | undefined {
    for (let attempt = 0; attempt < this.#collisionAttempts; attempt += 1) {
      let bytes: Uint8Array | undefined;
      try {
        bytes = this.#random(RANDOM_BYTES);
        if (!(bytes instanceof Uint8Array) || bytes.byteLength !== RANDOM_BYTES) continue;
        const grant = Buffer.from(bytes).toString("base64url");
        if (!this.#grants.has(grant)) return grant;
      } catch {
        // A bounded retry handles entropy faults without retaining partial material.
      } finally {
        bytes?.fill(0);
      }
    }
    return undefined;
  }

  #transactionMaterialInUse(material: TransactionMaterial): boolean {
    const verifier = Buffer.from(material.providerVerifierBytes).toString("base64url");
    const challenge = OidcFlowValues.sha256Base64Url(verifier);
    return [...this.#transactions.values()].some(
      (transaction) =>
        transaction.nonce === material.nonce || transaction.verifierChallenge === challenge,
    );
  }

  #now(): number | undefined {
    try {
      const now = this.#clock.now();
      if (!OidcFlowValues.validTimestamp(now)) throw new Error("invalid clock");
      return now;
    } catch {
      this.#failClosed();
      return undefined;
    }
  }

  #sweepExpired(now: number): void {
    for (const [state, transaction] of this.#transactions)
      if (now >= transaction.expiresAt) this.#transactions.delete(state);
  }

  #sweepGrants(now: number): void {
    for (const [grant, expiresAt] of this.#grants) if (now >= expiresAt) this.#grants.delete(grant);
  }

  #clearTransactions(): void {
    this.#transactions.clear();
  }

  #failClosed(): void {
    this.#closed = true;
    this.#clearTransactions();
    this.#grants.clear();
    this.#callbacks.forEach((controller) => {
      controller.abort();
    });
    this.#callbacks.clear();
  }
}

/**
 * The selected result of a bounded collaborator call.
 * @typeParam T The collaborator's successful value.
 */
type CollaboratorOutcome<T> =
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "declined" }
  | { readonly kind: "failed"; readonly reason: unknown };

/**
 * The caller-facing race state and any issuer failure awaiting attribution.
 */
interface CollaboratorSettlement {
  done: boolean;
  failure?: { readonly reason: unknown };
}

interface ConsumedTransaction {
  readonly transaction: OidcLoginTransaction;
  readonly callback: ValidCallbackInputSnapshot;
}

interface Transaction {
  readonly nonce: string;
  readonly verifierChallenge: string;
  readonly expiresAt: number;
}

interface TransactionMaterial {
  readonly state: string;
  readonly nonce: string;
  readonly providerVerifierBytes: Uint8Array;
  readonly bytes: readonly Uint8Array[];
}

/**
 * Captures OIDC callback input before validation derives an immutable result.
 */
interface CallbackInputSnapshot {
  readonly code: unknown;
  readonly error: unknown;
  readonly responseIssuer: unknown;
}

type ValidCallbackInputSnapshot =
  | {
      readonly code: string;
      readonly error: undefined;
      readonly responseIssuer: string | undefined;
    }
  | {
      readonly code: undefined;
      readonly error: string;
      readonly responseIssuer: string | undefined;
    };

const OidcFlowValues = Object.freeze({
  /**
   * Validates trusted OIDC endpoints, client identity, callbacks, and redirects.
   * @param options The flow configuration to validate.
   * @returns Validated endpoint and scope settings.
   */
  settings(options: OidcFlowOptions) {
    const authorizationEndpoint = OidcFlowValues.strictHttpsUrl(
      options.authorizationEndpoint,
      "authorizationEndpoint",
    );
    OidcFlowValues.strictHttpsUrl(options.callbackUri, "callbackUri");
    const clientId = OidcFlowValues.nonEmpty(options.clientId, "clientId");
    const scopes = OidcFlowValues.validScopes(options.scopes);
    const redirects = OidcFlowValues.validRedirects(options.allowedPostLoginRedirects);
    validateProvider(options.provider);
    OidcFlowValues.validateFunction(
      (options.identityMapping as unknown as Record<string, unknown>).resolve,
      "identityMapping.resolve",
    );
    OidcFlowValues.validateFunction(
      (options.sessionIssuer as unknown as Record<string, unknown>).issue,
      "sessionIssuer.issue",
    );
    return { authorizationEndpoint, clientId, scopes, redirects };
  },

  /**
   * Validates finite capacities and deadlines for one OIDC flow.
   * @param options The flow configuration to validate.
   * @returns Positive transaction, grant, retry, and URL limits.
   */
  limits(options: OidcFlowOptions) {
    return {
      transactionTtlMilliseconds: OidcFlowValues.positiveSafeInteger(
        options.transactionTtlMilliseconds ?? DEFAULT_TRANSACTION_TTL,
        "transactionTtlMilliseconds",
      ),
      grantTtlMilliseconds: OidcFlowValues.positiveSafeInteger(
        options.grantTtlMilliseconds ?? DEFAULT_GRANT_TTL,
        "grantTtlMilliseconds",
      ),
      maxTransactions: OidcFlowValues.positiveSafeInteger(
        options.maxTransactions ?? DEFAULT_CAPACITY,
        "maxTransactions",
      ),
      maxGrants: OidcFlowValues.positiveSafeInteger(
        options.maxGrants ?? DEFAULT_CAPACITY,
        "maxGrants",
      ),
      collisionAttempts: OidcFlowValues.positiveSafeInteger(
        options.collisionAttempts ?? DEFAULT_COLLISION_ATTEMPTS,
        "collisionAttempts",
      ),
      operationTimeoutMilliseconds: OidcFlowValues.positiveSafeInteger(
        options.operationTimeoutMilliseconds ?? DEFAULT_TIMEOUT,
        "operationTimeoutMilliseconds",
      ),
      maxAuthorizationUrlLength: OidcFlowValues.positiveSafeInteger(
        options.maxAuthorizationUrlLength ?? DEFAULT_MAX_URL,
        "maxAuthorizationUrlLength",
      ),
    };
  },

  /**
   * Creates a rejected authorization start result.
   * @param reason The rejection reason.
   * @returns The rejected start outcome.
   */
  rejected(
    reason:
      "invalid-input" | "capacity-exceeded" | "entropy-exhausted" | "clock-failure" | "closed",
  ): OidcFlowStartResult {
    return Object.freeze({ kind: "rejected", reason });
  },

  /**
   * Creates a rejected provider callback result.
   * @param reason The rejection reason.
   * @returns The rejected callback outcome.
   */
  callbackRejected(
    reason:
      | "invalid-input"
      | "not-found"
      | "expired"
      | "provider-error"
      | "issuer-mismatch"
      | "verification-failed"
      | "mapping-failed"
      | "capacity-exceeded"
      | "entropy-exhausted"
      | "clock-failure"
      | "closed",
  ): OidcFlowCallbackResult {
    return Object.freeze({ kind: "rejected", reason });
  },

  /**
   * Creates a rejected application-session exchange result.
   * @returns The rejected exchange outcome.
   */
  exchangeRejected(): OidcFlowExchangeResult {
    return Object.freeze({ kind: "rejected" });
  },

  /**
   * Validates and parses a strict HTTPS endpoint.
   * @param value The HTTPS endpoint URL to validate.
   * @param name The endpoint option named in validation errors.
   * @returns The parsed HTTPS URL.
   */
  strictHttpsUrl(value: string, name: string): URL {
    const url = OidcFlowValues.parseUrl(value, name);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "")
      throw new TypeError(`${name} must be an exact HTTPS URL without credentials or fragment`);
    return url;
  },

  /**
   * Parses a callback or redirect URL under the flow policy.
   * @param value The callback or redirect URL to parse.
   * @param name The callback or redirect URL option named in validation errors.
   * @returns The parsed URL.
   */
  parseUrl(value: string, name: string): URL {
    if (typeof value !== "string" || value.length === 0 || value.length > 4_096)
      throw new TypeError(`${name} must be a bounded non-empty URL`);
    try {
      return new URL(value);
    } catch {
      throw new TypeError(`${name} must be a URL`);
    }
  },

  /**
   * Checks scope count, format, and uniqueness.
   * @param scopes The requested OAuth scope list.
   * @returns The validated scope list.
   */
  validScopes(scopes: unknown): readonly string[] {
    if (!Array.isArray(scopes) || scopes.length === 0 || scopes.length > 64)
      throw new TypeError("scopes must be a non-empty bounded list");
    const copy = scopes.map((scope) => {
      if (typeof scope !== "string" || scope.length === 0 || scope.length > 256 || /\s/.test(scope))
        throw new TypeError("scopes must contain bounded non-empty tokens");
      return scope;
    });
    if (new Set(copy).size !== copy.length || !copy.includes("openid"))
      throw new TypeError("scopes must be unique and include openid");
    return Object.freeze(copy);
  },

  /**
   * Validates the allowed post-login redirect set.
   * @param redirects The configured post-login redirect URLs.
   * @returns The validated redirect set.
   */
  validRedirects(redirects: unknown): ReadonlySet<string> {
    if (!Array.isArray(redirects) || redirects.length === 0 || redirects.length > 1_000)
      throw new TypeError("allowedPostLoginRedirects must be a non-empty bounded list");
    const copy = redirects.map((redirect) => {
      if (typeof redirect !== "string")
        throw new TypeError("allowedPostLoginRedirects entries must be strings");
      const url = OidcFlowValues.strictHttpsUrl(redirect, "allowedPostLoginRedirects entry");
      return url.toString();
    });
    if (new Set(copy).size !== copy.length)
      throw new TypeError("allowedPostLoginRedirects must be unique");
    return new Set(copy);
  },

  /**
   * Checks a start request against allowed redirects and scope bounds.
   * @param input The caller or provider input to validate.
   * @param redirects The configured post-login redirect URLs.
   * @returns Whether the start request is valid.
   */
  validStartInput(
    input: { readonly browserCodeChallenge: unknown; readonly postLoginRedirect: unknown },
    redirects: ReadonlySet<string>,
  ): input is OidcFlowStartInput {
    if (
      typeof input.browserCodeChallenge !== "string" ||
      !base64Url32.test(input.browserCodeChallenge)
    )
      return false;
    if (typeof input.postLoginRedirect !== "string" || input.postLoginRedirect.length > 4_096)
      return false;
    try {
      return redirects.has(
        OidcFlowValues.strictHttpsUrl(input.postLoginRedirect, "postLoginRedirect").toString(),
      );
    } catch {
      return false;
    }
  },

  /**
   * Copies a validated start request for transaction retention.
   * @param input The caller or provider input to validate.
   * @returns The detached start request, or undefined when invalid.
   */
  snapshotStartInput(
    input: unknown,
  ): { readonly browserCodeChallenge: unknown; readonly postLoginRedirect: unknown } | undefined {
    try {
      if (!OidcFlowValues.plainRecord(input)) return undefined;
      return Object.freeze({
        browserCodeChallenge: input.browserCodeChallenge,
        postLoginRedirect: input.postLoginRedirect,
      });
    } catch {
      return undefined;
    }
  },

  /**
   * Copies the returned state from a provider callback.
   * @param input The caller or provider input to validate.
   * @returns The copied state, or undefined when invalid.
   */
  snapshotCallbackState(input: unknown): string | undefined {
    try {
      if (!OidcFlowValues.plainRecord(input)) return undefined;
      const state = input.state;
      return OidcFlowValues.validGrant(state) ? state : undefined;
    } catch {
      return undefined;
    }
  },

  /**
   * Copies and validates the complete provider callback.
   * @param input The caller or provider input to validate.
   * @returns The copied callback, or undefined when invalid.
   */
  snapshotCallbackInput(input: unknown): CallbackInputSnapshot | undefined {
    try {
      if (!OidcFlowValues.plainRecord(input)) return undefined;
      return Object.freeze({
        code: input.code,
        error: input.error,
        responseIssuer: input.responseIssuer,
      });
    } catch {
      return undefined;
    }
  },

  /**
   * Checks callback state, code, issuer, and provider error fields.
   * @param input The caller or provider input to validate.
   * @returns Whether the callback fields are valid.
   */
  validCallbackInput(input: CallbackInputSnapshot): input is ValidCallbackInputSnapshot {
    const codeValid = typeof input.code === "string" && OidcFlowValues.boundedNonEmpty(input.code);
    const errorValid =
      typeof input.error === "string" && OidcFlowValues.boundedNonEmpty(input.error);
    if (codeValid === errorValid) return false;
    if (input.responseIssuer === undefined) return true;
    return (
      typeof input.responseIssuer === "string" &&
      input.responseIssuer.length <= 4_096 &&
      OidcFlowValues.isStrictHttpsUrl(input.responseIssuer)
    );
  },

  /**
   * Checks whether an application grant string is well formed.
   * @param value The application grant string to validate.
   * @returns Whether the grant is valid.
   */
  validGrant(value: unknown): value is string {
    return typeof value === "string" && base64Url32.test(value);
  },

  /**
   * Copies a validated application-grant exchange request.
   * @param input The caller or provider input to validate.
   * @returns The copied exchange input, or undefined when invalid.
   */
  snapshotGrantExchangeInput(input: unknown): { readonly grant: unknown } | undefined {
    try {
      if (!OidcFlowValues.plainRecord(input)) return undefined;
      return Object.freeze({ grant: input.grant });
    } catch {
      return undefined;
    }
  },

  /**
   * Copies a browser PKCE verifier from a start request.
   * @param input The caller or provider input to validate.
   * @returns The copied PKCE verifier, or undefined when invalid.
   */
  snapshotBrowserCodeVerifier(input: unknown): unknown {
    try {
      if (!OidcFlowValues.plainRecord(input)) return undefined;
      return input.browserCodeVerifier;
    } catch {
      return undefined;
    }
  },

  /**
   * Checks an RFC 7636 browser PKCE verifier.
   * @param value The browser PKCE verifier to validate.
   * @returns Whether the verifier satisfies RFC 7636.
   */
  validBrowserCodeVerifier(value: unknown): value is string {
    return typeof value === "string" && RFC7636_VERIFIER.test(value);
  },

  /**
   * Checks a verified external identity against the expected issuer.
   * @param identity The verified external identity.
   * @param issuer The issuer supplied to this operation.
   * @returns Whether identity and issuer fields are valid.
   */
  validExternalIdentity(identity: unknown, issuer: string): ExternalIdentity | undefined {
    try {
      if (!OidcFlowValues.plainRecord(identity)) return undefined;
      const actualIssuer = identity.issuer;
      const subject = identity.subject;
      const claims = identity.claims;
      if (actualIssuer !== issuer || !OidcFlowValues.boundedNonEmpty(subject)) return undefined;
      const copiedClaims =
        claims === undefined ? undefined : OidcFlowValues.copyBoundedRecord(claims, true);
      if (claims !== undefined && copiedClaims === undefined) return undefined;
      return Object.freeze({
        issuer,
        subject,
        ...(copiedClaims === undefined ? {} : { claims: copiedClaims }),
      });
    } catch {
      return undefined;
    }
  },

  /**
   * Copies the external identity accepted for application mapping.
   * @param identity The verified external identity.
   * @param expected The expected issuer or identity context.
   * @returns The detached external identity, or undefined when invalid.
   */
  snapshotResolvedIdentity(
    identity: unknown,
    expected: ExternalIdentity,
  ): ResolvedApplicationIdentity | undefined {
    try {
      if (
        identity === undefined ||
        identity === null ||
        typeof identity !== "object" ||
        Array.isArray(identity)
      )
        return undefined;
      const candidate = identity as ResolvedApplicationIdentity;
      const externalIdentity = candidate.externalIdentity;
      const principal = candidate.principal;
      if (!OidcFlowValues.plainRecord(externalIdentity) || !OidcFlowValues.plainRecord(principal))
        return undefined;
      const issuer = externalIdentity.issuer;
      const subject = externalIdentity.subject;
      const claims = externalIdentity.claims;
      const id = principal.id;
      const attributes = principal.attributes;
      if (
        issuer !== expected.issuer ||
        subject !== expected.subject ||
        !OidcFlowValues.boundedNonEmpty(id)
      )
        return undefined;
      const copiedClaims =
        claims === undefined ? undefined : OidcFlowValues.copyBoundedRecord(claims, true);
      const copiedAttributes =
        attributes === undefined ? undefined : OidcFlowValues.copyBoundedRecord(attributes, false);
      if (
        (claims !== undefined && copiedClaims === undefined) ||
        (attributes !== undefined && copiedAttributes === undefined)
      )
        return undefined;
      const mappedClaims = copiedClaims ?? {};
      const expectedClaims = expected.claims ?? {};
      const mappedClaimEntries = Object.entries(mappedClaims);
      if (
        mappedClaimEntries.length !== Object.keys(expectedClaims).length ||
        mappedClaimEntries.some(([name, value]) => expectedClaims[name] !== value)
      )
        return undefined;
      const snapshot: ResolvedApplicationIdentity = {
        externalIdentity: expected,
        principal: Object.freeze({
          id,
          ...(copiedAttributes === undefined ? {} : { attributes: copiedAttributes }),
        }),
      };
      return Object.freeze(snapshot);
    } catch {
      return undefined;
    }
  },

  /**
   * Copies an identity attribute record under size and token limits.
   * @param value The identity attributes or claims to copy.
   * @param rejectTokens Whether token-like attribute names are forbidden.
   * @returns The copied attributes, or undefined when bounds fail.
   */
  copyBoundedRecord(
    value: unknown,
    rejectTokens: boolean,
  ): Readonly<Record<string, string>> | undefined {
    if (!OidcFlowValues.plainRecord(value)) return undefined;
    const entries = Object.entries(value);
    if (entries.length > 32) return undefined;
    let characters = 0;
    const copy: Record<string, string> = {};
    for (const [name, item] of entries) {
      if (
        !OidcFlowValues.boundedNonEmpty(name) ||
        !OidcFlowValues.boundedNonEmpty(item) ||
        (rejectTokens && OidcFlowValues.tokenLikeClaim(name))
      )
        return undefined;
      characters += name.length + item.length;
      if (characters > 4_096) return undefined;
      Object.defineProperty(copy, name, {
        value: item,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return Object.freeze(copy);
  },

  /**
   * Checks the mapped application principal and its attributes.
   * @param principal The mapped application principal.
   * @returns Whether the principal satisfies application bounds.
   */
  validPrincipal(principal: unknown): principal is AuthenticatedPrincipal {
    const candidate = principal as AuthenticatedPrincipal;
    if (
      principal === null ||
      typeof principal !== "object" ||
      !OidcFlowValues.boundedNonEmpty(candidate.id)
    )
      return false;
    const attributes = candidate.attributes;
    if (attributes === undefined) return true;
    let characters = 0;
    const entries = Object.entries(attributes);
    if (entries.length > 32) return false;
    return entries.every(([name, value]) => {
      if (!OidcFlowValues.boundedNonEmpty(name) || !OidcFlowValues.boundedNonEmpty(value))
        return false;
      characters += name.length + value.length;
      return characters <= 4_096;
    });
  },

  /**
   * Checks the session issuer response and expiry.
   * @param issue The application session issuer result.
   * @returns Whether the issued session is valid.
   */
  validSessionIssue(issue: unknown): issue is ApplicationSessionIssue {
    if (!OidcFlowValues.plainRecord(issue)) return false;
    const credential = issue.credential;
    const session = issue.session;
    if (!OidcFlowValues.plainRecord(credential) || !OidcFlowValues.plainRecord(session))
      return false;
    return (
      (credential.kind === "bearer" || credential.kind === "cookie") &&
      OidcFlowValues.boundedNonEmpty(credential.value) &&
      OidcFlowValues.validPrincipal(session.principal) &&
      OidcFlowValues.validSessionTimestamp(session.expiresAt)
    );
  },

  /**
   * Copies an accepted session issue result.
   * @param issue The application session issuer result.
   * @returns The copied session issue, or undefined when invalid.
   */
  snapshotSessionIssue(
    issue: unknown,
  ): { readonly credential: RequestCredential; readonly session: ResolvedSession } | undefined {
    try {
      const rawIssue = issue as ApplicationSessionIssue | undefined;
      const credential = rawIssue?.credential;
      const session = rawIssue?.session;
      const principal = session?.principal;
      const expiry = session?.expiresAt;
      const attributes = principal?.attributes;
      if (attributes !== undefined && !OidcFlowValues.plainRecord(attributes)) return undefined;
      const snapshot = {
        credential:
          credential === undefined ? undefined : { kind: credential.kind, value: credential.value },
        session:
          principal === undefined || expiry === undefined
            ? undefined
            : {
                principal: {
                  id: principal.id,
                  attributes: attributes === undefined ? undefined : { ...attributes },
                },
                expiresAt: { seconds: expiry.seconds, nanos: expiry.nanos },
              },
      };
      if (!OidcFlowValues.validSessionIssue(snapshot)) return undefined;
      return Object.freeze({
        credential: Object.freeze(snapshot.credential),
        session: OidcFlowValues.copyResolvedSession(snapshot.session),
      });
    } catch {
      return undefined;
    }
  },

  /**
   * Checks a session expiry against the Protobuf timestamp range.
   * @param value The session Timestamp message to validate.
   * @returns Whether the expiry is representable.
   */
  validSessionTimestamp(value: unknown): value is Timestamp {
    if (!OidcFlowValues.plainRecord(value)) return false;
    return (
      typeof value.seconds === "bigint" &&
      value.seconds >= -62_135_596_800n &&
      value.seconds <= 253_402_300_799n &&
      typeof value.nanos === "number" &&
      Number.isSafeInteger(value.nanos) &&
      value.nanos >= 0 &&
      value.nanos < 1_000_000_000
    );
  },

  /**
   * Copies a resolved session and its principal.
   * @param session The resolved session to copy.
   * @returns The detached resolved session.
   */
  copyResolvedSession(session: ResolvedSession): ResolvedSession {
    const attributes = session.principal.attributes;
    const principal = Object.freeze({
      id: session.principal.id,
      ...(attributes === undefined ? {} : { attributes: Object.freeze({ ...attributes }) }),
    });
    return Object.freeze({
      principal,
      expiresAt: create(TimestampSchema, {
        seconds: session.expiresAt.seconds,
        nanos: session.expiresAt.nanos,
      }),
    });
  },

  /**
   * Checks a bounded non-empty string value.
   * @param value The string to check for length and content.
   * @returns The bounded string, or undefined when invalid.
   */
  boundedNonEmpty(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= 4_096;
  },

  /**
   * Checks whether a value is a plain record.
   * @param value The unknown value to test for plain-record shape.
   * @returns Whether the value is a plain record.
   */
  plainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Reflect.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  },

  /**
   * Checks whether an attribute name is reserved for token claims.
   * @param name The identity attribute name to check.
   * @returns Whether the name is reserved for token claims.
   */
  tokenLikeClaim(name: string): boolean {
    return /(^|[_-])(access[_-]?token|refresh[_-]?token|id[_-]?token|token)([_-]|$)/iu.test(name);
  },

  /**
   * Checks a candidate URL against strict HTTPS rules.
   * @param value The URL string to check for strict HTTPS form.
   * @returns Whether the candidate is a strict HTTPS URL.
   */
  isStrictHttpsUrl(value: string): boolean {
    try {
      OidcFlowValues.strictHttpsUrl(value, "issuer");
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Validates a non-empty named option.
   * @param value The option string to validate.
   * @param name The string option named in validation errors.
   * @returns The validated non-empty value.
   */
  nonEmpty(value: string, name: string): string {
    if (typeof value !== "string" || value.length === 0 || value.length > 4_096)
      throw new TypeError(`${name} must be a bounded non-empty string`);
    return value;
  },

  /**
   * Validates the trusted provider contract and issuer.
   * @param provider The configured identity provider.
   */
  validateProvider(provider: unknown): asserts provider is OidcVerifiedIdentityProvider {
    if (!OidcFlowValues.plainRecord(provider)) throw new TypeError("provider is required");
    if (typeof provider.issuer !== "string") throw new TypeError("provider.issuer is required");
    OidcFlowValues.strictHttpsUrl(provider.issuer, "provider.issuer");
    OidcFlowValues.validateFunction(
      provider.exchangeAuthorizationCode,
      "provider.exchangeAuthorizationCode",
    );
  },

  /**
   * Validates a callable integration hook.
   * @param value The integration callback to validate.
   * @param name The callback option named in validation errors.
   */
  validateFunction(value: unknown, name: string): void {
    if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
  },

  /**
   * Validates a positive safe integer option.
   * @param value The positive integer option to validate.
   * @param name The integer option named in validation errors.
   * @returns The validated positive safe integer.
   */
  positiveSafeInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new TypeError(`${name} must be a positive safe integer`);
    return value;
  },

  /**
   * Checks whether epoch milliseconds fit the supported timestamp range.
   * @param value The Unix epoch milliseconds to check against Protobuf bounds.
   * @returns Whether the timestamp is representable.
   */
  validTimestamp(value: number): boolean {
    return (
      Number.isSafeInteger(value) &&
      value >= -62_135_596_800_000 &&
      value <= MAX_TIMESTAMP_MILLISECONDS
    );
  },

  /**
   * Calculates a safe expiry deadline from a clock reading and TTL.
   * @param now The current Unix epoch time in milliseconds.
   * @param ttl The permitted lifetime in milliseconds.
   * @returns The safe expiry time, or undefined if it overflows.
   */
  expiryAt(now: number, ttl: number): number | undefined {
    const value = now + ttl;
    return OidcFlowValues.validTimestamp(value) ? value : undefined;
  },

  /**
   * Converts safe epoch milliseconds to an exact Protobuf deadline.
   *
   * @param milliseconds Valid Unix epoch milliseconds.
   * @returns Timestamp without negative-time truncation.
   */
  timestamp(milliseconds: number): Timestamp {
    const seconds = Math.floor(milliseconds / 1_000);
    return create(TimestampSchema, {
      seconds: BigInt(seconds),
      nanos: (milliseconds - seconds * 1_000) * 1_000_000,
    });
  },

  /**
   * Creates a URL-safe SHA-256 challenge from PKCE material.
   * @param value The ASCII PKCE verifier material to hash.
   * @returns The URL-safe SHA-256 digest.
   */
  sha256Base64Url(value: string): string {
    // Node's synchronous hash keeps start() atomic and avoids retaining the verifier buffer.
    return createHash("sha256").update(value, "ascii").digest("base64url");
  },

  /**
   * Compares secret strings without content-dependent early exit.
   * @param left The first secret value.
   * @param right The second secret value.
   * @returns Whether the secret strings are equal.
   */
  constantTimeEquals(left: string, right: string): boolean {
    const leftBytes = Buffer.from(left, "ascii");
    const rightBytes = Buffer.from(right, "ascii");
    try {
      return (
        leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes)
      );
    } finally {
      leftBytes.fill(0);
      rightBytes.fill(0);
    }
  },
});

const validateProvider: (provider: unknown) => asserts provider is OidcVerifiedIdentityProvider =
  OidcFlowValues.validateProvider;
