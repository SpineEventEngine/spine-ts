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
import { createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";

import type { AuthenticatedPrincipal, RequestCredential, ResolvedSession } from "../index.js";
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
 * It owns finite start, callback, and one-time application-session exchange
 * transitions; HTTP endpoints and provider discovery remain application work.
 */
export class OidcFlow {
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
  readonly #maxTransactions: number;
  readonly #maxGrants: number;
  readonly #collisionAttempts: number;
  readonly #operationTimeoutMilliseconds: number;
  readonly #maxAuthorizationUrlLength: number;
  readonly #transactions = new Map<string, Transaction>();
  readonly #grants = new Map<string, Grant>();
  readonly #callbacks = new Set<AbortController>();
  #closed = false;

  /**
   * Creates a bounded authorization-code flow.
   * @param options The trusted provider, callback, transaction, grant, and session settings.
   */
  constructor(options: OidcFlowOptions) {
    this.#authorizationEndpoint = OidcFlowValues.strictHttpsUrl(
      options.authorizationEndpoint,
      "authorizationEndpoint",
    );
    OidcFlowValues.strictHttpsUrl(options.callbackUri, "callbackUri");
    this.#callbackUri = options.callbackUri;
    this.#clientId = OidcFlowValues.nonEmpty(options.clientId, "clientId");
    this.#scopes = OidcFlowValues.validScopes(options.scopes);
    this.#allowedPostLoginRedirects = OidcFlowValues.validRedirects(
      options.allowedPostLoginRedirects,
    );
    validateProvider(options.provider);
    OidcFlowValues.validateFunction(
      (options.identityMapping as unknown as Record<string, unknown>).resolve,
      "identityMapping.resolve",
    );
    OidcFlowValues.validateFunction(
      (options.sessionIssuer as unknown as Record<string, unknown>).issue,
      "sessionIssuer.issue",
    );
    this.#provider = options.provider;
    this.#providerIssuer = options.provider.issuer;
    this.#identityMapping = options.identityMapping;
    this.#sessionIssuer = options.sessionIssuer;
    this.#clock = options.clock ?? { now: Date.now };
    this.#random = options.randomBytes ?? nodeRandomBytes;
    this.#transactionTtlMilliseconds = OidcFlowValues.positiveSafeInteger(
      options.transactionTtlMilliseconds ?? DEFAULT_TRANSACTION_TTL,
      "transactionTtlMilliseconds",
    );
    this.#grantTtlMilliseconds = OidcFlowValues.positiveSafeInteger(
      options.grantTtlMilliseconds ?? DEFAULT_GRANT_TTL,
      "grantTtlMilliseconds",
    );
    this.#maxTransactions = OidcFlowValues.positiveSafeInteger(
      options.maxTransactions ?? DEFAULT_CAPACITY,
      "maxTransactions",
    );
    this.#maxGrants = OidcFlowValues.positiveSafeInteger(
      options.maxGrants ?? DEFAULT_CAPACITY,
      "maxGrants",
    );
    this.#collisionAttempts = OidcFlowValues.positiveSafeInteger(
      options.collisionAttempts ?? DEFAULT_COLLISION_ATTEMPTS,
      "collisionAttempts",
    );
    this.#operationTimeoutMilliseconds = OidcFlowValues.positiveSafeInteger(
      options.operationTimeoutMilliseconds ?? DEFAULT_TIMEOUT,
      "operationTimeoutMilliseconds",
    );
    this.#maxAuthorizationUrlLength = OidcFlowValues.positiveSafeInteger(
      options.maxAuthorizationUrlLength ?? DEFAULT_MAX_URL,
      "maxAuthorizationUrlLength",
    );
  }

  /**
   * Starts one finite authorization-code transaction without exposing any application credential.
   * @param input The browser redirect and requested scopes.
   * @returns The authorization URL and state, or a rejection.
   */
  start(input: OidcFlowStartInput): OidcFlowStartResult {
    if (this.#isClosed()) return OidcFlowValues.rejected("closed");
    const request = OidcFlowValues.snapshotStartInput(input);
    if (
      request === undefined ||
      !OidcFlowValues.validStartInput(request, this.#allowedPostLoginRedirects)
    )
      return OidcFlowValues.rejected("invalid-input");
    const now = this.#now();
    if (now === undefined) return OidcFlowValues.rejected("closed");
    if (this.#closed) return OidcFlowValues.rejected("closed");
    this.#sweepExpired(now);
    if (this.#transactions.size >= this.#maxTransactions)
      return OidcFlowValues.rejected("capacity-exceeded");

    for (let attempt = 0; attempt < this.#collisionAttempts; attempt += 1) {
      const material = this.#transactionMaterial();
      if (material === undefined) {
        if (this.#isClosed()) return OidcFlowValues.rejected("closed");
        continue;
      }
      try {
        const current = this.#now();
        if (current === undefined) return OidcFlowValues.rejected("closed");
        this.#sweepExpired(current);
        if (this.#isClosed()) return OidcFlowValues.rejected("closed");
        if (this.#transactions.size >= this.#maxTransactions)
          return OidcFlowValues.rejected("capacity-exceeded");
        if (this.#transactions.has(material.state) || this.#transactionMaterialInUse(material))
          continue;
        const transactionExpiry = OidcFlowValues.expiryAt(
          current,
          this.#transactionTtlMilliseconds,
        );
        if (transactionExpiry === undefined) {
          this.#failClosed();
          return OidcFlowValues.rejected("clock-failure");
        }
        const authorizationUrl = this.#authorizationUrl(
          material.state,
          material.nonce,
          Buffer.from(material.providerVerifierBytes).toString("base64url"),
          request.browserCodeChallenge,
        );
        if (authorizationUrl === undefined) return OidcFlowValues.rejected("invalid-input");
        this.#transactions.set(material.state, {
          nonce: material.nonce,
          providerVerifier: Uint8Array.from(material.providerVerifierBytes),
          browserCodeChallenge: request.browserCodeChallenge,
          postLoginRedirect: request.postLoginRedirect,
          expiresAt: transactionExpiry,
        });
        return Object.freeze({ kind: "started", authorizationUrl, expiresAt: transactionExpiry });
      } finally {
        material.bytes.forEach((bytes) => bytes.fill(0));
      }
    }
    return OidcFlowValues.rejected("entropy-exhausted");
  }

  /**
   * Processes a callback state before provider verification or mapping.
   * A rejected callback never restores its transaction.
   * @param input The callback state and provider response.
   * @returns The callback result, including a one-time grant when accepted.
   */
  async callback(input: OidcFlowCallbackInput): Promise<OidcFlowCallbackResult> {
    if (this.#isClosed()) return OidcFlowValues.callbackRejected("closed");
    const state = OidcFlowValues.snapshotCallbackState(input);
    if (state === undefined) return OidcFlowValues.callbackRejected("invalid-input");
    const now = this.#now();
    if (now === undefined) return OidcFlowValues.callbackRejected("closed");
    if (this.#isClosed()) return OidcFlowValues.callbackRejected("closed");
    const transaction = this.#transactions.get(state);
    if (transaction === undefined) return OidcFlowValues.callbackRejected("not-found");
    this.#transactions.delete(state);
    const callback = OidcFlowValues.snapshotCallbackInput(input);
    if (callback === undefined || !OidcFlowValues.validCallbackInput(callback)) {
      transaction.providerVerifier.fill(0);
      return OidcFlowValues.callbackRejected("invalid-input");
    }
    if (now >= transaction.expiresAt) {
      transaction.providerVerifier.fill(0);
      return OidcFlowValues.callbackRejected("expired");
    }
    if (callback.error !== undefined) {
      transaction.providerVerifier.fill(0);
      return OidcFlowValues.callbackRejected("provider-error");
    }
    if (callback.responseIssuer !== undefined && callback.responseIssuer !== this.#providerIssuer) {
      transaction.providerVerifier.fill(0);
      return OidcFlowValues.callbackRejected("issuer-mismatch");
    }

    const providerVerifier = Buffer.from(transaction.providerVerifier).toString("base64url");
    transaction.providerVerifier.fill(0);
    const identity = await this.#runBounded((signal) =>
      this.#provider.exchangeAuthorizationCode({
        code: callback.code,
        clientId: this.#clientId,
        callbackUri: this.#callbackUri,
        providerCodeVerifier: providerVerifier,
        expectedNonce: transaction.nonce,
        signal,
      }),
    );
    if (this.#isClosed()) return OidcFlowValues.callbackRejected("closed");
    let verified: ExternalIdentity | undefined;
    try {
      verified = OidcFlowValues.validExternalIdentity(identity, this.#providerIssuer);
    } catch {
      verified = undefined;
    }
    if (verified === undefined) return OidcFlowValues.callbackRejected("verification-failed");
    const resolved = await this.#runBounded((signal) =>
      this.#identityMapping.resolve(verified, signal),
    );
    if (this.#isClosed()) return OidcFlowValues.callbackRejected("closed");
    const mapped = OidcFlowValues.snapshotResolvedIdentity(resolved, verified);
    if (mapped === undefined) return OidcFlowValues.callbackRejected("mapping-failed");

    const current = this.#now();
    if (current === undefined) return OidcFlowValues.callbackRejected("closed");
    this.#sweepGrants(current);
    if (this.#isClosed()) return OidcFlowValues.callbackRejected("closed");
    if (this.#grants.size >= this.#maxGrants)
      return OidcFlowValues.callbackRejected("capacity-exceeded");
    const expiry = OidcFlowValues.expiryAt(current, this.#grantTtlMilliseconds);
    if (expiry === undefined) {
      this.#failClosed();
      return OidcFlowValues.callbackRejected("clock-failure");
    }
    const grant = this.#nextGrant();
    if (grant === undefined)
      return OidcFlowValues.callbackRejected(this.#isClosed() ? "closed" : "entropy-exhausted");
    if (this.#isClosed() || this.#grants.size >= this.#maxGrants || this.#grants.has(grant))
      return OidcFlowValues.callbackRejected(this.#isClosed() ? "closed" : "entropy-exhausted");
    this.#grants.set(grant, {
      identity: mapped,
      browserCodeChallenge: transaction.browserCodeChallenge,
      postLoginRedirect: transaction.postLoginRedirect,
      expiresAt: expiry,
    });
    return Object.freeze({
      kind: "granted",
      grant,
      postLoginRedirect: transaction.postLoginRedirect,
      expiresAt: expiry,
    });
  }

  /**
   * Processes a grant before validating browser PKCE proof or issuing a session.
   * All failures deliberately have the same result to avoid grant-state enumeration.
   * @param input The grant and browser PKCE proof.
   * @returns The issued application session or an enumeration-safe rejection.
   */
  async exchange(input: OidcFlowExchangeInput): Promise<OidcFlowExchangeResult> {
    const grantRequest = OidcFlowValues.snapshotGrantExchangeInput(input);
    if (
      this.#isClosed() ||
      grantRequest === undefined ||
      !OidcFlowValues.validGrant(grantRequest.grant)
    )
      return OidcFlowValues.exchangeRejected();
    const now = this.#now();
    if (now === undefined) return OidcFlowValues.exchangeRejected();
    const grant = this.#grants.get(grantRequest.grant);
    if (grant === undefined) return OidcFlowValues.exchangeRejected();
    this.#grants.delete(grantRequest.grant);
    const browserCodeVerifier = OidcFlowValues.snapshotBrowserCodeVerifier(input);
    if (
      now >= grant.expiresAt ||
      browserCodeVerifier === undefined ||
      !OidcFlowValues.validBrowserCodeVerifier(browserCodeVerifier)
    )
      return OidcFlowValues.exchangeRejected();
    if (
      !OidcFlowValues.constantTimeEquals(
        OidcFlowValues.sha256Base64Url(browserCodeVerifier),
        grant.browserCodeChallenge,
      )
    )
      return OidcFlowValues.exchangeRejected();
    const issued = await this.#runBounded((signal) =>
      this.#sessionIssuer.issue(grant.identity.principal, signal),
    );
    const safeIssue = OidcFlowValues.snapshotSessionIssue(issued);
    if (this.#isClosed() || safeIssue === undefined) return OidcFlowValues.exchangeRejected();
    return Object.freeze({
      kind: "issued",
      credential: safeIssue.credential,
      session: safeIssue.session,
    });
  }

  /**
   * Closes the flow and discards retained OIDC transaction material.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#clearTransactions();
    this.#grants.clear();
    this.#callbacks.forEach((controller) => {
      controller.abort();
    });
    this.#callbacks.clear();
  }

  #isClosed(): boolean {
    return this.#closed;
  }

  #authorizationUrl(
    state: string,
    nonce: string,
    providerVerifier: string,
    browserCodeChallenge: string,
  ): string | undefined {
    // The provider verifier is deliberately not serialized. Its S256 challenge is.
    const url = new URL(this.#authorizationEndpoint);
    const parameters = url.searchParams;
    parameters.set("response_type", "code");
    parameters.set("client_id", this.#clientId);
    parameters.set("redirect_uri", this.#callbackUri);
    parameters.set("scope", this.#scopes.join(" "));
    parameters.set("state", state);
    parameters.set("nonce", nonce);
    parameters.set("code_challenge", OidcFlowValues.sha256Base64Url(providerVerifier));
    parameters.set("code_challenge_method", "S256");
    // The browser challenge is retained for the later, distinct application-session grant.
    void browserCodeChallenge;
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

  async #runBounded<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    const controller = new AbortController();
    this.#callbacks.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const aborted = new Promise<undefined>((resolve) => {
        controller.signal.addEventListener(
          "abort",
          () => {
            resolve(undefined);
          },
          { once: true },
        );
      });
      const timeout = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(undefined);
        }, this.#operationTimeoutMilliseconds);
      });
      return await Promise.race([operation(controller.signal), timeout, aborted]);
    } catch {
      return undefined;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      this.#callbacks.delete(controller);
      controller.abort();
    }
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
        transaction.nonce === material.nonce ||
        OidcFlowValues.sha256Base64Url(
          Buffer.from(transaction.providerVerifier).toString("base64url"),
        ) === challenge,
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
      if (now >= transaction.expiresAt) this.#dropTransaction(state, transaction);
  }

  #sweepGrants(now: number): void {
    for (const [grant, record] of this.#grants)
      if (now >= record.expiresAt) this.#grants.delete(grant);
  }

  #dropTransaction(state: string, transaction: Transaction): void {
    this.#transactions.delete(state);
    transaction.providerVerifier.fill(0);
  }

  #clearTransactions(): void {
    this.#transactions.forEach((transaction) => transaction.providerVerifier.fill(0));
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

interface Transaction {
  readonly nonce: string;
  readonly providerVerifier: Uint8Array;
  readonly browserCodeChallenge: string;
  readonly postLoginRedirect: string;
  readonly expiresAt: number;
}

interface TransactionMaterial {
  readonly state: string;
  readonly nonce: string;
  readonly providerVerifierBytes: Uint8Array;
  readonly bytes: readonly Uint8Array[];
}

interface Grant {
  readonly identity: ResolvedApplicationIdentity;
  readonly browserCodeChallenge: string;
  readonly postLoginRedirect: string;
  readonly expiresAt: number;
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
  rejected(
    reason:
      "invalid-input" | "capacity-exceeded" | "entropy-exhausted" | "clock-failure" | "closed",
  ): OidcFlowStartResult {
    return Object.freeze({ kind: "rejected", reason });
  },

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

  exchangeRejected(): OidcFlowExchangeResult {
    return Object.freeze({ kind: "rejected" });
  },

  strictHttpsUrl(value: string, name: string): URL {
    const url = OidcFlowValues.parseUrl(value, name);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "")
      throw new TypeError(`${name} must be an exact HTTPS URL without credentials or fragment`);
    return url;
  },

  parseUrl(value: string, name: string): URL {
    if (typeof value !== "string" || value.length === 0 || value.length > 4_096)
      throw new TypeError(`${name} must be a bounded non-empty URL`);
    try {
      return new URL(value);
    } catch {
      throw new TypeError(`${name} must be a URL`);
    }
  },

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

  snapshotCallbackState(input: unknown): string | undefined {
    try {
      if (!OidcFlowValues.plainRecord(input)) return undefined;
      const state = input.state;
      return OidcFlowValues.validGrant(state) ? state : undefined;
    } catch {
      return undefined;
    }
  },

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

  validGrant(value: unknown): value is string {
    return typeof value === "string" && base64Url32.test(value);
  },

  snapshotGrantExchangeInput(input: unknown): { readonly grant: unknown } | undefined {
    try {
      if (!OidcFlowValues.plainRecord(input)) return undefined;
      return Object.freeze({ grant: input.grant });
    } catch {
      return undefined;
    }
  },

  snapshotBrowserCodeVerifier(input: unknown): unknown {
    try {
      if (!OidcFlowValues.plainRecord(input)) return undefined;
      return input.browserCodeVerifier;
    } catch {
      return undefined;
    }
  },

  validBrowserCodeVerifier(value: unknown): value is string {
    return typeof value === "string" && RFC7636_VERIFIER.test(value);
  },

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

  boundedNonEmpty(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= 4_096;
  },

  plainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Reflect.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  },

  tokenLikeClaim(name: string): boolean {
    return /(^|[_-])(access[_-]?token|refresh[_-]?token|id[_-]?token|token)([_-]|$)/iu.test(name);
  },

  isStrictHttpsUrl(value: string): boolean {
    try {
      OidcFlowValues.strictHttpsUrl(value, "issuer");
      return true;
    } catch {
      return false;
    }
  },

  nonEmpty(value: string, name: string): string {
    if (typeof value !== "string" || value.length === 0 || value.length > 4_096)
      throw new TypeError(`${name} must be a bounded non-empty string`);
    return value;
  },

  validateProvider(provider: unknown): asserts provider is OidcVerifiedIdentityProvider {
    if (!OidcFlowValues.plainRecord(provider)) throw new TypeError("provider is required");
    if (typeof provider.issuer !== "string") throw new TypeError("provider.issuer is required");
    OidcFlowValues.strictHttpsUrl(provider.issuer, "provider.issuer");
    OidcFlowValues.validateFunction(
      provider.exchangeAuthorizationCode,
      "provider.exchangeAuthorizationCode",
    );
  },

  validateFunction(value: unknown, name: string): void {
    if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
  },

  positiveSafeInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new TypeError(`${name} must be a positive safe integer`);
    return value;
  },

  validTimestamp(value: number): boolean {
    return (
      Number.isSafeInteger(value) &&
      value >= -62_135_596_800_000 &&
      value <= MAX_TIMESTAMP_MILLISECONDS
    );
  },

  expiryAt(now: number, ttl: number): number | undefined {
    const value = now + ttl;
    return OidcFlowValues.validTimestamp(value) ? value : undefined;
  },

  sha256Base64Url(value: string): string {
    // Node's synchronous hash keeps start() atomic and avoids retaining the verifier buffer.
    return createHash("sha256").update(value, "ascii").digest("base64url");
  },

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
