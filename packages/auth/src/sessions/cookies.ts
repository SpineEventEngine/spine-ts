import { createHmac, timingSafeEqual } from "node:crypto";

import type { RequestCredential } from "../index.js";

/** Header input whose own-property arrays preserve observable duplicate values. */
export type OpaqueSessionHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;
/** Construction options for strict opaque-session browser cookie handling. */
export interface OpaqueSessionCookiesOptions {
  /** HMAC key copied on construction; it needs at least 32 bytes and the owned copy is zeroed on `close()`. */
  readonly csrfSecret: Uint8Array;
  /** One or more non-empty canonical Origins matched byte-for-byte on cookie requests. */
  readonly origins: readonly string[];
  /** Distinct valid `__Host-` session-cookie name; defaults to `__Host-spine-session`. */
  readonly sessionCookieName?: string;
  /** Distinct valid `__Host-` CSRF-cookie name; defaults to `__Host-spine-csrf`. */
  readonly csrfCookieName?: string;
  /** Maximum observable own header fields and array values. Defaults to 32. */
  readonly maxHeaderValues?: number;
  /** Maximum total header characters. Defaults to 16,384. */
  readonly maxHeaderCharacters?: number;
  /** Maximum cookie pairs. Defaults to 64. */
  readonly maxCookiePairs?: number;
}
/** Rejection result from strict browser credential extraction. */
export interface OpaqueCredentialRejection {
  /** Identifies the rejected extraction result. */
  readonly kind: "rejected";
  /** Explains why the credential was rejected. */
  readonly reason:
    | "missing-credential"
    | "duplicate-authorization"
    | "malformed-authorization"
    | "malformed-cookie"
    | "ambiguous-cookie"
    | "missing-origin"
    | "duplicate-origin"
    | "forbidden-origin"
    | "missing-csrf"
    | "duplicate-csrf"
    | "csrf-mismatch"
    | "request-too-large"
    | "closed";
}
/** Result of extracting a bearer or CSRF-protected opaque-cookie credential. */
export type OpaqueCredentialExtraction = RequestCredential | OpaqueCredentialRejection;

/** Strict, framework-neutral helper whose `close()` zeroes the copied CSRF secret. */
export class OpaqueSessionCookies {
  private readonly secret: Uint8Array;
  private readonly origins: ReadonlySet<string>;
  private readonly sessionName: string;
  private readonly csrfName: string;
  private readonly maxHeaderValues: number;
  private readonly maxHeaderCharacters: number;
  private readonly maxCookiePairs: number;
  private closed = false;

  /** Creates strict cookie extraction with copied CSRF key material.
   * @param options The cookie names, trusted origins, bounds, and CSRF secret.
   */
  constructor(options: OpaqueSessionCookiesOptions) {
    if (options.csrfSecret.byteLength < 32)
      throw new Error("csrfSecret must contain at least 32 bytes");
    this.secret = new Uint8Array(options.csrfSecret);
    this.origins = new Set(options.origins.map(CookieValues.validOrigin));
    if (this.origins.size === 0) throw new Error("origins must contain at least one valid Origin");
    this.sessionName = CookieValues.validCookieName(
      options.sessionCookieName ?? "__Host-spine-session",
      "sessionCookieName",
    );
    this.csrfName = CookieValues.validCookieName(
      options.csrfCookieName ?? "__Host-spine-csrf",
      "csrfCookieName",
    );
    if (this.sessionName === this.csrfName)
      throw new Error("sessionCookieName and csrfCookieName must be distinct");
    this.maxHeaderValues = CookieValues.positiveSafeInteger(
      options.maxHeaderValues ?? 32,
      "maxHeaderValues",
    );
    this.maxHeaderCharacters = CookieValues.positiveSafeInteger(
      options.maxHeaderCharacters ?? 16_384,
      "maxHeaderCharacters",
    );
    this.maxCookiePairs = CookieValues.positiveSafeInteger(
      options.maxCookiePairs ?? 64,
      "maxCookiePairs",
    );
  }

  /** Creates the fixed-length unpadded base64url CSRF value for one session ID.
   * @param sessionId The session identifier protected by the CSRF value.
   * @returns The derived CSRF value.
   */
  csrf(sessionId: string): string {
    this.open();
    if (!CookieValues.validSessionId(sessionId)) {
      throw new Error("sessionId must be a 43-character unpadded base64url session ID");
    }
    return createHmac("sha256", this.secret).update(sessionId, "utf8").digest("base64url");
  }

  /** Creates the immutable pair of host-only cookies for a newly issued session.
   * @param sessionId The issued opaque session identifier.
   * @returns The session and CSRF Set-Cookie values.
   */
  issue(sessionId: string): readonly string[] {
    const csrf = this.csrf(sessionId);
    return Object.freeze([
      `${this.sessionName}=${sessionId}; Path=/; Secure; HttpOnly; SameSite=Lax`,
      `${this.csrfName}=${csrf}; Path=/; Secure; SameSite=Lax`,
    ]);
  }

  /** Creates the immutable pair of host-only cookie removals.
   * @returns The expired session and CSRF Set-Cookie values.
   */
  clear(): readonly string[] {
    this.open();
    return Object.freeze([
      `${this.sessionName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
      `${this.csrfName}=; Path=/; Secure; SameSite=Lax; Max-Age=0`,
    ]);
  }

  /** Reads bearer credentials first, otherwise a fully checked cookie credential.
   * @param headers The request headers to inspect.
   * @returns The admitted credential or its rejection reason.
   */
  extract(headers: OpaqueSessionHeaders): OpaqueCredentialExtraction {
    if (this.closed) return CookieValues.rejection("closed");
    const values = CookieValues.headerValues(
      headers,
      this.maxHeaderValues,
      this.maxHeaderCharacters,
    );
    if (values === undefined) return CookieValues.rejection("request-too-large");
    const authorization = values.get("authorization") ?? [];
    if (authorization.length > 1) return CookieValues.rejection("duplicate-authorization");
    if (authorization.length === 1) return CookieValues.bearer(CookieValues.only(authorization));
    return this.cookieCredential(values);
  }

  /** Closes the extractor, zeroes its HMAC secret, and rejects later operations. */
  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    this.secret.fill(0);
    return Promise.resolve();
  }

  private cookieCredential(
    values: ReadonlyMap<string, readonly string[]>,
  ): OpaqueCredentialExtraction {
    const cookies = values.get("cookie") ?? [];
    const parsed = CookieValues.parseCookies(
      cookies,
      this.sessionName,
      this.csrfName,
      this.maxCookiePairs,
    );
    if ("reason" in parsed) return CookieValues.rejection(parsed.reason);
    const origin = CookieValues.one(values, "origin", "missing-origin", "duplicate-origin");
    if ("reason" in origin) return CookieValues.rejection(origin.reason);
    if (!this.origins.has(origin.value)) return CookieValues.rejection("forbidden-origin");
    const supplied = CookieValues.one(values, "x-spine-csrf", "missing-csrf", "duplicate-csrf");
    if ("reason" in supplied) return CookieValues.rejection(supplied.reason);
    const expected = this.csrf(parsed.session);
    if (
      !CookieValues.validCsrf(supplied.value) ||
      !CookieValues.sameCsrf(expected, supplied.value) ||
      !CookieValues.sameCsrf(expected, parsed.csrf)
    ) {
      return CookieValues.rejection("csrf-mismatch");
    }
    return Object.freeze({ kind: "cookie" as const, value: parsed.session });
  }

  private open(): void {
    if (this.closed) throw new Error("OpaqueSessionCookies is closed");
  }
}

/** Owns strict cookie parsing and validation values used only by {@link OpaqueSessionCookies}. */
const CookieValues = Object.freeze({
  headerValues(
    headers: OpaqueSessionHeaders,
    maxValues: number,
    maxCharacters: number,
  ): Map<string, string[]> | undefined {
    const result = new Map<string, string[]>();
    let count = 0;
    let characters = 0;
    for (const name in headers) {
      if (!Object.prototype.hasOwnProperty.call(headers, name)) continue;
      if (count === maxValues || characters + name.length > maxCharacters) return undefined;
      count += 1;
      characters += name.length;
      const supplied = headers[name];
      if (supplied === undefined) continue;
      const key = name.toLowerCase();
      const current = result.get(key) ?? [];
      if (typeof supplied === "string") {
        if (characters + supplied.length > maxCharacters) return undefined;
        characters += supplied.length;
        current.push(supplied);
      } else {
        for (const [index, value] of supplied.entries()) {
          if (index > 0 && count === maxValues) return undefined;
          if (characters + value.length > maxCharacters) return undefined;
          if (index > 0) count += 1;
          characters += value.length;
          current.push(value);
        }
      }
      result.set(key, current);
    }
    return result;
  },

  bearer(value: string): OpaqueCredentialExtraction {
    const match = /^bearer ([\x21-\x7e]+)$/i.exec(value);
    return match === null
      ? CookieValues.rejection("malformed-authorization")
      : Object.freeze({ kind: "bearer" as const, value: CookieValues.only(match.slice(1)) });
  },

  parseCookies(
    headers: readonly string[],
    sessionName: string,
    csrfName: string,
    maxPairs: number,
  ):
    | { readonly session: string; readonly csrf: string }
    | {
        readonly reason:
          "missing-credential" | "malformed-cookie" | "ambiguous-cookie" | "request-too-large";
      } {
    const found = new Map<string, string[]>();
    let count = 0;
    for (const header of headers) {
      if (CookieValues.hasForbiddenCookieCharacter(header)) return { reason: "malformed-cookie" };
      for (const pair of header.split(";")) {
        count += 1;
        if (count > maxPairs) return { reason: "request-too-large" };
        const index = pair.indexOf("=");
        if (index <= 0) return { reason: "malformed-cookie" };
        const name = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (!CookieValues.validCookiePair(name, value)) return { reason: "malformed-cookie" };
        if (name === sessionName || name === csrfName) {
          if (found.has(name)) return { reason: "ambiguous-cookie" };
          found.set(name, [value]);
        }
      }
    }
    const session = found.get(sessionName) ?? [];
    const csrf = found.get(csrfName) ?? [];
    if (session.length === 0 && csrf.length === 0) return { reason: "missing-credential" };
    if (session.length > 1 || csrf.length > 1) return { reason: "ambiguous-cookie" };
    if (
      session.length !== 1 ||
      csrf.length !== 1 ||
      !CookieValues.validSessionId(CookieValues.only(session)) ||
      !CookieValues.validCsrf(CookieValues.only(csrf))
    ) {
      return { reason: "malformed-cookie" };
    }
    return { session: CookieValues.only(session), csrf: CookieValues.only(csrf) };
  },

  one<T extends OpaqueCredentialRejection["reason"]>(
    values: ReadonlyMap<string, readonly string[]>,
    name: string,
    missing: T,
    duplicate: T,
  ): { readonly value: string } | { readonly reason: T } {
    const entries = values.get(name) ?? [];
    if (entries.length === 0) return { reason: missing };
    if (entries.length !== 1) return { reason: duplicate };
    return { value: CookieValues.only(entries) };
  },

  only(values: readonly string[]): string {
    const value = values[0];
    if (value === undefined) throw new Error("expected one header value");
    return value;
  },

  hasForbiddenCookieCharacter(value: string): boolean {
    for (const character of value) {
      const code = character.charCodeAt(0);
      if (code <= 31 || code === 127 || character === ",") return true;
    }
    return false;
  },

  validOrigin(origin: string): string {
    try {
      const url = new URL(origin);
      if (
        (url.protocol !== "https:" && url.protocol !== "http:") ||
        url.username !== "" ||
        url.password !== "" ||
        url.pathname !== "/" ||
        url.search !== "" ||
        url.hash !== "" ||
        url.origin !== origin
      ) {
        throw new Error();
      }
      return origin;
    } catch {
      throw new Error("origins must contain only canonical Origins");
    }
  },

  validCookieName(value: string, name: string): string {
    if (!value.startsWith("__Host-") || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value)) {
      throw new Error(`${name} must be a valid __Host- cookie name`);
    }
    return value;
  },

  positiveSafeInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive safe integer`);
    }
    return value;
  },

  validCookiePair(name: string, value: string): boolean {
    return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) && /^[\x21-\x7e]+$/.test(value);
  },

  base64url(value: string): boolean {
    return /^[A-Za-z0-9_-]+$/.test(value) && value.length % 4 !== 1;
  },

  validCsrf(value: string): boolean {
    return value.length === 43 && CookieValues.base64url(value);
  },

  validSessionId(value: string): boolean {
    return value.length === 43 && CookieValues.base64url(value);
  },

  sameCsrf(expected: string, supplied: string): boolean {
    if (expected.length !== supplied.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
  },

  rejection(reason: OpaqueCredentialRejection["reason"]): OpaqueCredentialRejection {
    return Object.freeze({ kind: "rejected" as const, reason });
  },
});
