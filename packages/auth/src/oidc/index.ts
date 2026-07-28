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
const BASE64URL_32_BYTES = /^[A-Za-z0-9_-]{43}$/;
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

  constructor(options: OidcFlowOptions) {
    this.#authorizationEndpoint = strictHttpsUrl(
      options.authorizationEndpoint,
      "authorizationEndpoint",
    );
    strictHttpsUrl(options.callbackUri, "callbackUri");
    this.#callbackUri = options.callbackUri;
    this.#clientId = nonEmpty(options.clientId, "clientId");
    this.#scopes = validScopes(options.scopes);
    this.#allowedPostLoginRedirects = validRedirects(options.allowedPostLoginRedirects);
    validateProvider(options.provider);
    validateFunction(options.identityMapping.resolve, "identityMapping.resolve");
    validateFunction(options.sessionIssuer.issue, "sessionIssuer.issue");
    this.#provider = options.provider;
    this.#providerIssuer = options.provider.issuer;
    this.#identityMapping = options.identityMapping;
    this.#sessionIssuer = options.sessionIssuer;
    this.#clock = options.clock ?? { now: Date.now };
    this.#random = options.randomBytes ?? nodeRandomBytes;
    this.#transactionTtlMilliseconds = positiveSafeInteger(
      options.transactionTtlMilliseconds ?? DEFAULT_TRANSACTION_TTL,
      "transactionTtlMilliseconds",
    );
    this.#grantTtlMilliseconds = positiveSafeInteger(
      options.grantTtlMilliseconds ?? DEFAULT_GRANT_TTL,
      "grantTtlMilliseconds",
    );
    this.#maxTransactions = positiveSafeInteger(
      options.maxTransactions ?? DEFAULT_CAPACITY,
      "maxTransactions",
    );
    this.#maxGrants = positiveSafeInteger(options.maxGrants ?? DEFAULT_CAPACITY, "maxGrants");
    this.#collisionAttempts = positiveSafeInteger(
      options.collisionAttempts ?? DEFAULT_COLLISION_ATTEMPTS,
      "collisionAttempts",
    );
    this.#operationTimeoutMilliseconds = positiveSafeInteger(
      options.operationTimeoutMilliseconds ?? DEFAULT_TIMEOUT,
      "operationTimeoutMilliseconds",
    );
    this.#maxAuthorizationUrlLength = positiveSafeInteger(
      options.maxAuthorizationUrlLength ?? DEFAULT_MAX_URL,
      "maxAuthorizationUrlLength",
    );
  }

  /** Starts one finite authorization-code transaction without exposing any application credential. */
  start(input: OidcFlowStartInput): OidcFlowStartResult {
    if (this.#closed) return rejected("closed");
    if (!validStartInput(input, this.#allowedPostLoginRedirects)) return rejected("invalid-input");
    const now = this.#now();
    if (now === undefined) return rejected("closed");
    if (this.#closed) return rejected("closed");
    this.#sweepExpired(now);
    if (this.#transactions.size >= this.#maxTransactions) return rejected("capacity-exceeded");

    for (let attempt = 0; attempt < this.#collisionAttempts; attempt += 1) {
      const material = this.#transactionMaterial();
      if (material === undefined) {
        if (this.#closed) return rejected("closed");
        continue;
      }
      try {
        const current = this.#now();
        if (current === undefined) return rejected("closed");
        this.#sweepExpired(current);
        if (this.#closed) return rejected("closed");
        if (this.#transactions.size >= this.#maxTransactions) return rejected("capacity-exceeded");
        if (this.#transactions.has(material.state) || this.#transactionMaterialInUse(material))
          continue;
        const transactionExpiry = expiryAt(current, this.#transactionTtlMilliseconds);
        if (transactionExpiry === undefined) {
          this.#failClosed();
          return rejected("clock-failure");
        }
        const authorizationUrl = this.#authorizationUrl(
          material.state,
          material.nonce,
          Buffer.from(material.providerVerifierBytes).toString("base64url"),
          input.browserCodeChallenge,
        );
        if (authorizationUrl === undefined) return rejected("invalid-input");
        this.#transactions.set(material.state, {
          nonce: material.nonce,
          providerVerifier: Uint8Array.from(material.providerVerifierBytes),
          browserCodeChallenge: input.browserCodeChallenge,
          postLoginRedirect: input.postLoginRedirect,
          expiresAt: transactionExpiry,
        });
        return Object.freeze({ kind: "started", authorizationUrl, expiresAt: transactionExpiry });
      } finally {
        material.bytes.forEach((bytes) => bytes.fill(0));
      }
    }
    return rejected("entropy-exhausted");
  }

  /**
   * Atomically consumes a callback state before provider verification or mapping.
   * A rejected callback never restores its transaction.
   */
  async callback(input: OidcFlowCallbackInput): Promise<OidcFlowCallbackResult> {
    if (this.#closed) return callbackRejected("closed");
    if (!validCallbackState(input)) return callbackRejected("invalid-input");
    const now = this.#now();
    if (now === undefined) return callbackRejected("closed");
    if (this.#closed) return callbackRejected("closed");
    const transaction = this.#transactions.get(input.state);
    if (transaction === undefined) return callbackRejected("not-found");
    this.#transactions.delete(input.state);
    if (!validCallbackInput(input)) {
      transaction.providerVerifier.fill(0);
      return callbackRejected("invalid-input");
    }
    if (now >= transaction.expiresAt) {
      transaction.providerVerifier.fill(0);
      return callbackRejected("expired");
    }
    if (input.error !== undefined) {
      transaction.providerVerifier.fill(0);
      return callbackRejected("provider-error");
    }
    if (input.responseIssuer !== undefined && input.responseIssuer !== this.#providerIssuer) {
      transaction.providerVerifier.fill(0);
      return callbackRejected("issuer-mismatch");
    }

    const providerVerifier = Buffer.from(transaction.providerVerifier).toString("base64url");
    transaction.providerVerifier.fill(0);
    const identity = await this.#runBounded((signal) =>
      this.#provider.exchangeAuthorizationCode({
        code: input.code!,
        clientId: this.#clientId,
        callbackUri: this.#callbackUri,
        providerCodeVerifier: providerVerifier,
        expectedNonce: transaction.nonce,
        signal,
      }),
    );
    if (this.#closed) return callbackRejected("closed");
    let verified: ExternalIdentity | undefined;
    try {
      verified = validExternalIdentity(identity, this.#providerIssuer);
    } catch {
      verified = undefined;
    }
    if (verified === undefined) return callbackRejected("verification-failed");
    const resolved = await this.#runBounded((signal) =>
      this.#identityMapping.resolve(verified, signal),
    );
    if (this.#closed) return callbackRejected("closed");
    const mapped = snapshotResolvedIdentity(resolved, verified);
    if (mapped === undefined) return callbackRejected("mapping-failed");

    const current = this.#now();
    if (current === undefined) return callbackRejected("closed");
    this.#sweepGrants(current);
    if (this.#closed) return callbackRejected("closed");
    if (this.#grants.size >= this.#maxGrants) return callbackRejected("capacity-exceeded");
    const expiry = expiryAt(current, this.#grantTtlMilliseconds);
    if (expiry === undefined) {
      this.#failClosed();
      return callbackRejected("clock-failure");
    }
    const grant = this.#nextGrant();
    if (grant === undefined) return callbackRejected(this.#closed ? "closed" : "entropy-exhausted");
    if (this.#closed || this.#grants.size >= this.#maxGrants || this.#grants.has(grant))
      return callbackRejected(this.#closed ? "closed" : "entropy-exhausted");
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
   * Detaches a grant before validating browser PKCE proof or issuing a session.
   * All failures deliberately have the same result to avoid grant-state enumeration.
   */
  async exchange(input: OidcFlowExchangeInput): Promise<OidcFlowExchangeResult> {
    if (this.#closed || input === null || typeof input !== "object" || !validGrant(input.grant))
      return exchangeRejected();
    const now = this.#now();
    if (now === undefined) return exchangeRejected();
    const grant = this.#grants.get(input.grant);
    if (grant === undefined) return exchangeRejected();
    this.#grants.delete(input.grant);
    if (now >= grant.expiresAt || !validExchangeInput(input)) return exchangeRejected();
    if (!constantTimeEquals(sha256Base64Url(input.browserCodeVerifier), grant.browserCodeChallenge))
      return exchangeRejected();
    const issued = await this.#runBounded((signal) =>
      this.#sessionIssuer.issue(grant.identity.principal, signal),
    );
    const safeIssue = snapshotSessionIssue(issued);
    if (this.#closed || safeIssue === undefined) return exchangeRejected();
    return Object.freeze({
      kind: "issued",
      credential: safeIssue.credential,
      session: safeIssue.session,
    });
  }

  /** Terminally discards all retained OIDC transaction material. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#clearTransactions();
    this.#grants.clear();
    this.#callbacks.forEach((controller) => controller.abort());
    this.#callbacks.clear();
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
    parameters.set("code_challenge", sha256Base64Url(providerVerifier));
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
      const aborted = new Promise<undefined>((resolve) =>
        controller.signal.addEventListener("abort", () => resolve(undefined), { once: true }),
      );
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
    const challenge = sha256Base64Url(verifier);
    return [...this.#transactions.values()].some(
      (transaction) =>
        transaction.nonce === material.nonce ||
        sha256Base64Url(Buffer.from(transaction.providerVerifier).toString("base64url")) ===
          challenge,
    );
  }

  #now(): number | undefined {
    try {
      const now = this.#clock.now();
      if (!validTimestamp(now)) throw new Error("invalid clock");
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
    this.#callbacks.forEach((controller) => controller.abort());
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

function rejected(
  reason: "invalid-input" | "capacity-exceeded" | "entropy-exhausted" | "clock-failure" | "closed",
): OidcFlowStartResult {
  return Object.freeze({ kind: "rejected", reason });
}

function callbackRejected(
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
}

function exchangeRejected(): OidcFlowExchangeResult {
  return Object.freeze({ kind: "rejected" });
}

function strictHttpsUrl(value: string, name: string): URL {
  const url = parseUrl(value, name);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "")
    throw new TypeError(`${name} must be an exact HTTPS URL without credentials or fragment`);
  return url;
}

function parseUrl(value: string, name: string): URL {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096)
    throw new TypeError(`${name} must be a bounded non-empty URL`);
  try {
    return new URL(value);
  } catch {
    throw new TypeError(`${name} must be a URL`);
  }
}

function validScopes(scopes: readonly string[]): readonly string[] {
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
}

function validRedirects(redirects: readonly string[]): ReadonlySet<string> {
  if (!Array.isArray(redirects) || redirects.length === 0 || redirects.length > 1_000)
    throw new TypeError("allowedPostLoginRedirects must be a non-empty bounded list");
  const copy = redirects.map((redirect) => {
    const url = strictHttpsUrl(redirect, "allowedPostLoginRedirects entry");
    return url.toString();
  });
  if (new Set(copy).size !== copy.length)
    throw new TypeError("allowedPostLoginRedirects must be unique");
  return new Set(copy);
}

function validStartInput(input: OidcFlowStartInput, redirects: ReadonlySet<string>): boolean {
  if (input === null || typeof input !== "object") return false;
  if (
    typeof input.browserCodeChallenge !== "string" ||
    !BASE64URL_32_BYTES.test(input.browserCodeChallenge)
  )
    return false;
  if (typeof input.postLoginRedirect !== "string" || input.postLoginRedirect.length > 4_096)
    return false;
  try {
    return redirects.has(strictHttpsUrl(input.postLoginRedirect, "postLoginRedirect").toString());
  } catch {
    return false;
  }
}

function validCallbackState(input: OidcFlowCallbackInput): input is OidcFlowCallbackInput {
  if (input === null || typeof input !== "object") return false;
  return typeof input.state === "string" && BASE64URL_32_BYTES.test(input.state);
}

function validCallbackInput(
  input: OidcFlowCallbackInput,
): input is OidcFlowCallbackInput & { code: string } {
  const codeValid = typeof input.code === "string" && boundedNonEmpty(input.code);
  const errorValid = typeof input.error === "string" && boundedNonEmpty(input.error);
  if (codeValid === errorValid) return false;
  if (input.responseIssuer === undefined) return true;
  return (
    typeof input.responseIssuer === "string" &&
    input.responseIssuer.length <= 4_096 &&
    isStrictHttpsUrl(input.responseIssuer)
  );
}

function validGrant(value: unknown): value is string {
  return typeof value === "string" && BASE64URL_32_BYTES.test(value);
}

function validExchangeInput(input: OidcFlowExchangeInput): boolean {
  return (
    input !== null && typeof input === "object" && RFC7636_VERIFIER.test(input.browserCodeVerifier)
  );
}

function validExternalIdentity(
  identity: ExternalIdentity | undefined,
  issuer: string,
): ExternalIdentity | undefined {
  try {
    if (!plainRecord(identity)) return undefined;
    const actualIssuer = identity.issuer;
    const subject = identity.subject;
    const claims = identity.claims;
    if (actualIssuer !== issuer || !boundedNonEmpty(subject)) return undefined;
    const copiedClaims = claims === undefined ? undefined : copyBoundedRecord(claims, true);
    if (claims !== undefined && copiedClaims === undefined) return undefined;
    return Object.freeze({
      issuer,
      subject,
      ...(copiedClaims === undefined ? {} : { claims: copiedClaims }),
    });
  } catch {
    return undefined;
  }
}

function snapshotResolvedIdentity(
  identity: ResolvedApplicationIdentity | undefined,
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
    const externalIdentity = identity.externalIdentity;
    const principal = identity.principal;
    if (!plainRecord(externalIdentity) || !plainRecord(principal)) return undefined;
    const issuer = externalIdentity.issuer;
    const subject = externalIdentity.subject;
    const claims = externalIdentity.claims;
    const id = principal.id;
    const attributes = principal.attributes;
    if (issuer !== expected.issuer || subject !== expected.subject || !boundedNonEmpty(id))
      return undefined;
    const copiedClaims = claims === undefined ? undefined : copyBoundedRecord(claims, true);
    const copiedAttributes =
      attributes === undefined ? undefined : copyBoundedRecord(attributes, false);
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
}

function copyBoundedRecord(
  value: unknown,
  rejectTokens: boolean,
): Readonly<Record<string, string>> | undefined {
  if (!plainRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > 32) return undefined;
  let characters = 0;
  const copy: Record<string, string> = {};
  for (const [name, item] of entries) {
    if (!boundedNonEmpty(name) || !boundedNonEmpty(item) || (rejectTokens && tokenLikeClaim(name)))
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
}

function validPrincipal(principal: AuthenticatedPrincipal): boolean {
  if (principal === null || typeof principal !== "object" || !boundedNonEmpty(principal.id))
    return false;
  const attributes = principal.attributes;
  if (attributes === undefined) return true;
  let characters = 0;
  const entries = Object.entries(attributes);
  if (entries.length > 32) return false;
  return entries.every(([name, value]) => {
    if (!boundedNonEmpty(name) || !boundedNonEmpty(value)) return false;
    characters += name.length + value.length;
    return characters <= 4_096;
  });
}

function validSessionIssue(
  issue: ApplicationSessionIssue | undefined,
): issue is ApplicationSessionIssue {
  if (issue === undefined || issue === null || typeof issue !== "object") return false;
  const credential = issue.credential;
  const session = issue.session;
  return (
    credential !== null &&
    typeof credential === "object" &&
    (credential.kind === "bearer" || credential.kind === "cookie") &&
    boundedNonEmpty(credential.value) &&
    session !== null &&
    typeof session === "object" &&
    validPrincipal(session.principal) &&
    validSessionTimestamp(session.expiresAt)
  );
}

function snapshotSessionIssue(
  issue: ApplicationSessionIssue | undefined,
): { readonly credential: RequestCredential; readonly session: ResolvedSession } | undefined {
  try {
    const credential = issue?.credential;
    const session = issue?.session;
    const principal = session?.principal;
    const expiry = session?.expiresAt;
    const attributes = principal?.attributes;
    if (attributes !== undefined && !plainRecord(attributes)) return undefined;
    const candidate = {
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
    if (!validSessionIssue(candidate as ApplicationSessionIssue)) return undefined;
    return Object.freeze({
      credential: Object.freeze(candidate.credential!),
      session: copyResolvedSession(candidate.session! as ResolvedSession),
    });
  } catch {
    return undefined;
  }
}

function validSessionTimestamp(value: Timestamp): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.seconds === "bigint" &&
    value.seconds >= -62_135_596_800n &&
    value.seconds <= 253_402_300_799n &&
    Number.isSafeInteger(value.nanos) &&
    value.nanos >= 0 &&
    value.nanos < 1_000_000_000
  );
}

function copyResolvedSession(session: ResolvedSession): ResolvedSession {
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
}

function boundedNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4_096;
}

function plainRecord(value: unknown): value is Readonly<Record<string, string>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function tokenLikeClaim(name: string): boolean {
  return /(^|[_-])(access[_-]?token|refresh[_-]?token|id[_-]?token|token)([_-]|$)/iu.test(name);
}

function isStrictHttpsUrl(value: string): boolean {
  try {
    strictHttpsUrl(value, "issuer");
    return true;
  } catch {
    return false;
  }
}

function nonEmpty(value: string, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096)
    throw new TypeError(`${name} must be a bounded non-empty string`);
  return value;
}

function validateProvider(provider: OidcVerifiedIdentityProvider): void {
  if (provider === null || typeof provider !== "object")
    throw new TypeError("provider is required");
  strictHttpsUrl(provider.issuer, "provider.issuer");
  validateFunction(provider.exchangeAuthorizationCode, "provider.exchangeAuthorizationCode");
}

function validateFunction(value: unknown, name: string): void {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TypeError(`${name} must be a positive safe integer`);
  return value;
}

function validTimestamp(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= -62_135_596_800_000 &&
    value <= MAX_TIMESTAMP_MILLISECONDS
  );
}

function expiryAt(now: number, ttl: number): number | undefined {
  const value = now + ttl;
  return validTimestamp(value) ? value : undefined;
}

function sha256Base64Url(value: string): string {
  // Node's synchronous hash keeps start() atomic and avoids retaining the verifier buffer.
  return createHash("sha256").update(value, "ascii").digest("base64url");
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "ascii");
  const rightBytes = Buffer.from(right, "ascii");
  try {
    return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
  } finally {
    leftBytes.fill(0);
    rightBytes.fill(0);
  }
}
