import { importJWK, jwtVerify } from "jose";

import type {
  ExternalIdentity,
  OidcAuthorizationCodeExchange,
  OidcVerifiedIdentityProvider,
} from "../oidc/contracts.js";

const DEFAULT_LIMIT = 1_048_576;
const DEFAULT_TIMEOUT = 30_000;
const MAX_JWKS = 32;
const MAX_SCOPES = 32;
const MAX_CACHE_SECONDS = 86_400;
const ALGORITHMS = new Set(["RS256", "ES256"]);
interface Jwk {
  readonly kid?: string;
  readonly kty?: string;
  readonly alg?: string;
  readonly [name: string]: unknown;
}
interface PendingJwks {
  readonly promise: Promise<Jwk[] | undefined>;
  readonly controller: AbortController;
  waiters: number;
  settled: boolean;
}

/** Node-compatible HTTP function injected by provider adapters for deterministic transport. */
export type ProviderFetch = (input: string, init?: RequestInit) => Promise<Response>;
/** Token endpoint client authentication supported by the OIDC adapter. */
export type OidcClientAuthentication = "client_secret_basic" | "client_secret_post" | "none";
/** Exact, prevalidated OIDC metadata. */
export interface OidcProviderOptions {
  /** Exact HTTPS issuer expected in discovery and every verified ID token. */
  readonly issuer: string;
  /** Exact HTTPS endpoint to which the browser is redirected for authorization. */
  readonly authorizationEndpoint: string;
  /** Exact HTTPS endpoint used once to exchange an authorization code. */
  readonly tokenEndpoint: string;
  /** Exact HTTPS endpoint supplying at most 32 asymmetric signing keys. */
  readonly jwksEndpoint: string;
  /** OAuth client identifier, which must equal C3's exchange client ID. */
  readonly clientId: string;
  /** Provider secret required by either client-secret authentication mode. */
  readonly clientSecret?: string;
  /** Token endpoint authentication; defaults to the PKCE-only `none` mode. */
  readonly clientAuthentication?: OidcClientAuthentication;
  /** Node-compatible HTTP implementation; defaults to global `fetch`. */
  readonly fetch?: ProviderFetch;
  /** Finite provider-operation deadline in milliseconds; defaults to 30 seconds. */
  readonly timeoutMilliseconds?: number;
  /** Maximum bytes accepted for each provider response; defaults to 1 MiB. */
  readonly maxResponseBytes?: number;
  /** Millisecond Unix clock used for token time checks and JWKS expiry. */
  readonly clock?: () => number;
}
/** Ready-to-use OIDC facts consumed by {@link OidcFlow}. */
export interface ConfiguredOidcProvider {
  /** Exact provider authorization endpoint for `OidcFlowOptions`. */
  readonly authorizationEndpoint: string;
  /** Provider-recommended scopes which applications may deliberately customize. */
  readonly recommendedScopes: readonly string[];
  /** Verified-identity adapter for `OidcFlowOptions`. */
  readonly provider: OidcVerifiedIdentityProvider;
}
/** Options for GitHub OAuth's fresh authenticated-user adapter. */
export interface GitHubProviderOptions {
  /** GitHub OAuth application client identifier. */
  readonly clientId: string;
  /** GitHub OAuth application secret retained only by the adapter closure. */
  readonly clientSecret: string;
  /** One to 32 required OAuth scopes; defaults to `read:user`. */
  readonly scopes?: readonly string[];
  /** Node-compatible HTTP implementation; defaults to global `fetch`. */
  readonly fetch?: ProviderFetch;
  /** Finite exchange-and-lookup deadline; defaults to 30 seconds. */
  readonly timeoutMilliseconds?: number;
  /** Maximum bytes accepted for each GitHub response; defaults to 1 MiB. */
  readonly maxResponseBytes?: number;
  /** Exact GitHub REST API date version; defaults to `2022-11-28`. */
  readonly apiVersion?: string;
  /** Public GitHub or GitHub Enterprise browser origin. */
  readonly baseUrl?: string;
  /** Matching public/enterprise API base, including an enterprise API path. */
  readonly apiBaseUrl?: string;
  /** Request and retain one verified primary email through GitHub's `user:email` scope. */
  readonly includeVerifiedPrimaryEmail?: boolean;
}
/** Fetches and validates OpenID Connect discovery metadata before constructing an adapter. */
export async function discoverOidcProvider(
  options: Omit<OidcProviderOptions, "authorizationEndpoint" | "tokenEndpoint" | "jwksEndpoint"> & {
    /** Trusted HTTPS discovery URL; defaults under the configured issuer. */
    readonly discoveryEndpoint?: string;
  },
): Promise<ConfiguredOidcProvider | undefined> {
  try {
    const issuer = https(options.issuer);
    const discoveryEndpoint =
      options.discoveryEndpoint ?? `${issuer}/.well-known/openid-configuration`;
    const timeout = positive(options.timeoutMilliseconds ?? DEFAULT_TIMEOUT, "timeoutMilliseconds");
    const document = await boundedOperation(timeout, undefined, (signal) =>
      json(discoveryEndpoint, options.fetch ?? fetch, options, signal),
    );
    if (!plain(document) || document.issuer !== issuer) return undefined;
    return createOidcProvider({
      ...options,
      issuer,
      authorizationEndpoint: bounded(document.authorization_endpoint, "authorization_endpoint"),
      tokenEndpoint: bounded(document.token_endpoint, "token_endpoint"),
      jwksEndpoint: bounded(document.jwks_uri, "jwks_uri"),
    });
  } catch {
    return undefined;
  }
}
/** Creates an OIDC authorization-code verifier from explicitly trusted metadata. */
export function createOidcProvider(options: OidcProviderOptions): ConfiguredOidcProvider {
  const issuer = https(options.issuer);
  const authorizationEndpoint = https(options.authorizationEndpoint);
  const tokenEndpoint = https(options.tokenEndpoint);
  const jwksEndpoint = https(options.jwksEndpoint);
  const clientId = bounded(options.clientId, "clientId");
  const clientAuthentication = options.clientAuthentication ?? "none";
  if (
    !(["client_secret_basic", "client_secret_post", "none"] as const).includes(clientAuthentication)
  )
    throw new TypeError("clientAuthentication");
  const clientSecret =
    options.clientSecret === undefined ? undefined : bounded(options.clientSecret, "clientSecret");
  if (clientAuthentication !== "none" && clientSecret === undefined)
    throw new TypeError("clientSecret");
  const limit = positive(options.maxResponseBytes ?? DEFAULT_LIMIT, "maxResponseBytes");
  const timeout = positive(options.timeoutMilliseconds ?? DEFAULT_TIMEOUT, "timeoutMilliseconds");
  const http = options.fetch ?? fetch;
  const clock = options.clock ?? Date.now;
  let cachedKeys: { readonly keys: Jwk[]; readonly expiresAt: number } | undefined;
  let pendingKeys: PendingJwks | undefined;
  const loadKeys = async (refresh: boolean, signal: AbortSignal): Promise<Jwk[] | undefined> => {
    const now = safeNow(clock);
    if (!refresh && cachedKeys && cachedKeys.expiresAt > now) return cachedKeys.keys;
    let pending = pendingKeys;
    if (!pending) {
      const controller = new AbortController();
      const request = boundedOperation(timeout, controller.signal, async (requestSignal) => {
        const jwks = await jsonDocument(
          jwksEndpoint,
          http,
          { maxResponseBytes: limit },
          requestSignal,
        );
        const keys =
          plain(jwks.value) && Array.isArray(jwks.value.keys) && jwks.value.keys.length <= MAX_JWKS
            ? (jwks.value.keys.filter(plain) as Jwk[])
            : undefined;
        if (!keys) return undefined;
        cachedKeys = Object.freeze({
          keys,
          expiresAt: now + jwks.cacheMilliseconds,
        });
        return keys;
      });
      pending = {
        promise: request,
        controller,
        waiters: 0,
        settled: false,
      };
      pendingKeys = pending;
      const owned = pending;
      void request.then(
        () => {
          owned.settled = true;
          if (pendingKeys === owned) pendingKeys = undefined;
        },
        () => {
          owned.settled = true;
          if (pendingKeys === owned) pendingKeys = undefined;
        },
      );
    }
    pending.waiters++;
    try {
      return await waitForSignal(pending.promise, signal);
    } finally {
      pending.waiters--;
      if (pending.waiters === 0 && !pending.settled) pending.controller.abort();
    }
  };
  const provider: OidcVerifiedIdentityProvider = Object.freeze({
    issuer,
    async exchangeAuthorizationCode(input: OidcAuthorizationCodeExchange) {
      try {
        if (input.clientId !== clientId || !validExchange(input)) return undefined;
        const secret = clientSecret ?? "";
        return await boundedOperation(timeout, input.signal, async (signal) => {
          const body = new URLSearchParams({
            grant_type: "authorization_code",
            code: input.code,
            redirect_uri: input.callbackUri,
            client_id: clientId,
            code_verifier: input.providerCodeVerifier,
          });
          const headers = new Headers({
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded",
          });
          if (clientAuthentication === "client_secret_post") body.set("client_secret", secret);
          if (clientAuthentication === "client_secret_basic")
            headers.set(
              "authorization",
              `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
            );
          const token = await json(tokenEndpoint, http, { maxResponseBytes: limit }, signal, {
            method: "POST",
            redirect: "error",
            signal,
            headers,
            body,
          });
          const idToken = plain(token) ? string(token.id_token) : undefined;
          if (idToken === undefined) return undefined;
          const verified = await verifyToken(
            idToken,
            issuer,
            clientId,
            input.expectedNonce,
            clock,
            (refresh) => loadKeys(refresh, signal),
          );
          return verified;
        });
      } catch {
        return undefined;
      }
    },
  });
  return Object.freeze({
    authorizationEndpoint,
    recommendedScopes: Object.freeze(["openid"]),
    provider,
  });
}
/** Discovers Google's fixed official OpenID Connect configuration. */
export async function createGoogleProvider(
  options: Omit<
    OidcProviderOptions,
    "issuer" | "authorizationEndpoint" | "tokenEndpoint" | "jwksEndpoint"
  >,
): Promise<ConfiguredOidcProvider | undefined> {
  const {
    clientId,
    clientSecret,
    clientAuthentication,
    fetch: providerFetch,
    timeoutMilliseconds,
    maxResponseBytes,
    clock,
  } = options;
  const configured = await discoverOidcProvider({
    issuer: "https://accounts.google.com",
    clientId,
    ...(clientSecret === undefined ? {} : { clientSecret }),
    ...(clientAuthentication === undefined ? {} : { clientAuthentication }),
    ...(providerFetch === undefined ? {} : { fetch: providerFetch }),
    ...(timeoutMilliseconds === undefined ? {} : { timeoutMilliseconds }),
    ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
    ...(clock === undefined ? {} : { clock }),
  });
  return (
    configured &&
    Object.freeze({
      ...configured,
      recommendedScopes: Object.freeze(["openid", "profile", "email"]),
    })
  );
}
/** Creates GitHub OAuth code exchange with a fresh `/user` identity lookup. */
export function createGitHubProvider(options: GitHubProviderOptions): ConfiguredOidcProvider {
  const base = httpsBase(options.baseUrl ?? "https://github.com");
  const api = httpsBase(options.apiBaseUrl ?? "https://api.github.com");
  const publicEndpoints = base === "https://github.com" && api === "https://api.github.com";
  if (
    !publicEndpoints &&
    (base === "https://github.com" ||
      api === "https://api.github.com" ||
      new URL(base).origin !== new URL(api).origin)
  )
    throw new TypeError("GitHub origins must move together");
  const clientId = bounded(options.clientId, "clientId"),
    clientSecret = bounded(options.clientSecret, "clientSecret");
  if (options.scopes !== undefined && !Array.isArray(options.scopes)) throw new TypeError("scopes");
  if (
    options.includeVerifiedPrimaryEmail !== undefined &&
    typeof options.includeVerifiedPrimaryEmail !== "boolean"
  )
    throw new TypeError("includeVerifiedPrimaryEmail");
  const includeVerifiedPrimaryEmail = options.includeVerifiedPrimaryEmail === true;
  const suppliedScopes: readonly unknown[] = options.scopes ?? ["read:user"];
  const requiredScopes: string[] = [];
  for (const scope of suppliedScopes) {
    if (!validScope(scope)) throw new TypeError("scopes");
    if (!requiredScopes.includes(scope)) requiredScopes.push(scope);
  }
  if (includeVerifiedPrimaryEmail && !requiredScopes.includes("user:email"))
    requiredScopes.push("user:email");
  if (requiredScopes.length === 0 || requiredScopes.length > MAX_SCOPES)
    throw new TypeError("scopes");
  const apiVersion = options.apiVersion ?? "2022-11-28";
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(apiVersion)) throw new TypeError("apiVersion");
  const http = options.fetch ?? fetch,
    limit = positive(options.maxResponseBytes ?? DEFAULT_LIMIT, "maxResponseBytes"),
    timeout = positive(options.timeoutMilliseconds ?? DEFAULT_TIMEOUT, "timeoutMilliseconds");
  const provider: OidcVerifiedIdentityProvider = Object.freeze({
    issuer: base,
    async exchangeAuthorizationCode(input: OidcAuthorizationCodeExchange) {
      try {
        if (input.clientId !== clientId || !validExchange(input)) return undefined;
        return await boundedOperation(timeout, input.signal, async (signal) => {
          const token = await json(
            `${base}/login/oauth/access_token`,
            http,
            { maxResponseBytes: limit },
            signal,
            {
              method: "POST",
              redirect: "error",
              headers: {
                accept: "application/json",
                "content-type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                code: input.code,
                redirect_uri: input.callbackUri,
                code_verifier: input.providerCodeVerifier,
              }),
            },
          );
          if (
            !plain(token) ||
            !string(token.access_token) ||
            typeof token.token_type !== "string" ||
            token.token_type.toLowerCase() !== "bearer"
          )
            return undefined;
          const accessToken = string(token.access_token);
          if (accessToken === undefined) return undefined;
          const granted: string[] =
            typeof token.scope === "string" ? token.scope.split(/[ ,]+/).filter(Boolean) : [];
          if (requiredScopes.some((scope) => !granted.includes(scope))) return undefined;
          const user = await json(`${api}/user`, http, { maxResponseBytes: limit }, signal, {
            redirect: "error",
            headers: {
              accept: "application/json",
              authorization: `Bearer ${accessToken}`,
              "x-github-api-version": apiVersion,
            },
          });
          if (!plain(user) || !Number.isSafeInteger(user.id) || (user.id as number) <= 0)
            return undefined;
          const claims = Object.create(null) as Record<string, string>;
          if (includeVerifiedPrimaryEmail) {
            const emails = await json(
              `${api}/user/emails`,
              http,
              { maxResponseBytes: limit },
              signal,
              {
                redirect: "error",
                headers: {
                  accept: "application/json",
                  authorization: `Bearer ${accessToken}`,
                  "x-github-api-version": apiVersion,
                },
              },
            );
            if (!Array.isArray(emails) || emails.length > 64) return undefined;
            const primary = emails.filter(validPrimaryEmail);
            if (primary.length !== 1) return undefined;
            const email = primary[0];
            if (email === undefined) return undefined;
            Object.defineProperty(claims, "email", { value: email.email, enumerable: true });
          }
          return Object.freeze({
            issuer: base,
            subject: String(user.id),
            ...(Object.keys(claims).length ? { claims: Object.freeze(claims) } : {}),
          });
        });
      } catch {
        return undefined;
      }
    },
  });
  return Object.freeze({
    authorizationEndpoint: `${base}/login/oauth/authorize`,
    recommendedScopes: Object.freeze(requiredScopes),
    provider,
  });
}

async function verifyToken(
  token: string,
  issuer: string,
  clientId: string,
  nonce: string,
  clock: () => number,
  keys: (refresh: boolean) => Promise<Jwk[] | undefined>,
): Promise<ExternalIdentity | undefined> {
  const [encodedHeader] = token.split(".", 1);
  const header = encodedHeader ? parse64(encodedHeader) : undefined;
  if (!plain(header)) return undefined;
  const protectedHeader = header;
  const alg = string(protectedHeader.alg);
  if (!alg || !ALGORITHMS.has(alg) || typeof protectedHeader.crit !== "undefined") return undefined;
  const kid = string(protectedHeader.kid);
  if (!kid) return undefined;
  const candidates = (await keys(false))?.filter((key) => key.kid === kid) ?? [];
  let key = candidates.length === 1 ? candidates[0] : undefined;
  if (!key) {
    const refreshed = (await keys(true))?.filter((value) => value.kid === kid) ?? [];
    key = refreshed.length === 1 ? refreshed[0] : undefined;
  }
  if (!key || key.kty === "oct" || key.alg !== alg) return undefined;
  let claims: Record<string, unknown>;
  try {
    const verified = await jwtVerify(token, await importJWK(key as never, alg), {
      issuer,
      audience: clientId,
      algorithms: [alg],
      currentDate: new Date(clock()),
      typ: "JWT",
    });
    claims = verified.payload;
  } catch {
    return undefined;
  }
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    claims.nonce !== nonce ||
    typeof claims.sub !== "string" ||
    !claims.sub ||
    (audience.length > 1 && claims.azp !== clientId)
  )
    return undefined;
  const kept = Object.create(null) as Record<string, string>;
  for (const name of ["email", "name", "given_name", "family_name", "picture"])
    if (
      typeof claims[name] === "string" &&
      claims[name].length <= 512 &&
      (name !== "email" || validEmail(claims[name]))
    )
      Object.defineProperty(kept, name, { value: claims[name], enumerable: true });
  if (typeof claims.email_verified === "boolean")
    Object.defineProperty(kept, "email_verified", {
      value: String(claims.email_verified),
      enumerable: true,
    });
  return Object.freeze({ issuer, subject: claims.sub, claims: Object.freeze(kept) });
}
async function json(
  url: string,
  http: ProviderFetch,
  limits: Pick<OidcProviderOptions, "maxResponseBytes">,
  signal?: AbortSignal,
  init?: RequestInit,
): Promise<unknown> {
  return (await jsonDocument(url, http, limits, signal, init)).value;
}

async function jsonDocument(
  url: string,
  http: ProviderFetch,
  limits: Pick<OidcProviderOptions, "maxResponseBytes">,
  signal?: AbortSignal,
  init?: RequestInit,
): Promise<{ readonly value: unknown; readonly cacheMilliseconds: number }> {
  const request: RequestInit = {
    redirect: "error",
    headers: { accept: "application/json" },
    ...init,
  };
  if (signal !== undefined) request.signal = signal;
  if (signal?.aborted) throw new Error("response");
  const response = await http(https(url), request);
  if (signal?.aborted) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("response");
  }
  const limit = limits.maxResponseBytes ?? DEFAULT_LIMIT;
  if (
    !response.ok ||
    !response.headers.get("content-type")?.toLowerCase().includes("application/json") ||
    Number(response.headers.get("content-length") ?? 0) > limit
  ) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("response");
  }
  if (!response.body) throw new Error("response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let complete = false;
  try {
    for (;;) {
      const next = await abortableRead(reader, signal);
      if (next.done) {
        complete = true;
        break;
      }
      size += next.value.byteLength;
      if (size > limit) throw new Error("response");
      chunks.push(next.value);
    }
  } finally {
    if (!complete) void reader.cancel().catch(() => undefined);
    try {
      reader.releaseLock();
    } catch {
      // A hostile stream may keep a read pending after cancellation.
    }
  }
  if (signal?.aborted) throw new Error("response");
  const value = JSON.parse(
    Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"),
  ) as unknown;
  return Object.freeze({
    value,
    cacheMilliseconds: cacheMilliseconds(response.headers),
  });
}
function validExchange(input: OidcAuthorizationCodeExchange) {
  return [input.code, input.callbackUri, input.providerCodeVerifier, input.expectedNonce].every(
    (value) => typeof value === "string" && value.length > 0 && value.length <= 4096,
  );
}
function parse64(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}
function plain(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype
  );
}
function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 ? value : undefined;
}
function bounded(value: unknown, name: string): string {
  const result = string(value);
  if (!result) throw new TypeError(name);
  return result;
}
function validEmail(value: unknown): value is string {
  return (
    typeof value === "string" && value.length <= 320 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
  );
}
function validPrimaryEmail(value: unknown): value is { readonly email: string } {
  return (
    plain(value) && value.primary === true && value.verified === true && validEmail(value.email)
  );
}
function validScope(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !/\s/u.test(value);
}
function positive(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new TypeError(name);
  return value as number;
}
function https(value: string): string {
  const text = bounded(value, "URL");
  const url = new URL(text);
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new TypeError("HTTPS URL required");
  return text;
}

function httpsBase(value: string): string {
  https(value);
  const url = new URL(value);
  if (url.search) throw new TypeError("HTTPS base URL must not contain a query.");
  return value.replace(/\/+$/u, "");
}

async function boundedOperation<T>(
  timeoutMilliseconds: number,
  externalSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const signal =
    externalSignal === undefined
      ? controller.signal
      : AbortSignal.any([externalSignal, controller.signal]);
  let rejectAbort: ((reason: Error) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort?.(new Error("Provider operation aborted."));
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMilliseconds);
  try {
    if (signal.aborted) throw new Error("Provider operation aborted.");
    return await Promise.race([operation(signal), aborted]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

async function waitForSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("Provider operation aborted.");
  let rejectAbort: ((reason: Error) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort?.(new Error("Provider operation aborted."));
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function abortableRead(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal === undefined) return reader.read();
  if (signal.aborted) throw new Error("Provider operation aborted.");
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      void reader.cancel().catch(() => undefined);
      reject(new Error("Provider operation aborted."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    reader
      .read()
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener("abort", onAbort);
      });
  });
}

function safeNow(clock: () => number): number {
  const value = clock();
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("clock");
  return value;
}

function cacheMilliseconds(headers: Headers): number {
  const directives = (headers.get("cache-control") ?? "")
    .split(",")
    .map((directive) => directive.trim().toLowerCase());
  if (directives.includes("no-store") || directives.includes("no-cache")) return 0;
  const maxAge = directives
    .map((directive) => /^max-age=(\d+)$/u.exec(directive)?.[1])
    .find((value) => value !== undefined);
  if (maxAge === undefined) return 0;
  const seconds = Math.min(Number(maxAge), MAX_CACHE_SECONDS);
  const age = Math.max(0, Number(headers.get("age") ?? 0));
  if (!Number.isSafeInteger(seconds) || !Number.isFinite(age)) return 0;
  return Math.max(0, seconds - age) * 1000;
}
