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

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { parseCookie, stringifySetCookie } from "cookie";

import type { RequestCredential } from "../index.js";
import { SessionRecords } from "./session-record.js";

/**
 * Header input whose own-property arrays preserve observable duplicate values.
 */
export type OpaqueSessionHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

/**
 * Construction options for strict opaque-session browser cookie handling.
 */
export interface OpaqueSessionCookiesOptions {
  // prettier-ignore

  /**
   * HMAC key copied on construction; it needs at least 32 bytes and the owned copy is zeroed on `close()`.
   */
  readonly csrfSecret: Uint8Array;

  /**
   * One or more non-empty canonical Origins matched byte-for-byte on cookie requests.
   */
  readonly origins: readonly string[];

  /**
   * Distinct valid `__Host-` session-cookie name; defaults to `__Host-spine-session`.
   */
  readonly sessionCookieName?: string;

  /**
   * Distinct valid `__Host-` CSRF-cookie name; defaults to `__Host-spine-csrf`.
   */
  readonly csrfCookieName?: string;

  /**
   * Maximum observable own header fields and array values. Defaults to 32.
   */
  readonly maxHeaderValues?: number;

  /**
   * Maximum total header characters. Defaults to 16,384.
   */
  readonly maxHeaderCharacters?: number;

  /**
   * Maximum cookie pairs. Defaults to 64.
   */
  readonly maxCookiePairs?: number;

  /**
   * Browser SameSite policy; defaults to `lax`. Secure and CSRF rules still apply to `none`.
   */
  readonly sameSite?: "lax" | "strict" | "none";

  /**
   * Whether issued cookies carry the supplied session deadline; defaults to false.
   */
  readonly persistent?: boolean;
}

/**
 * Rejection result from strict browser credential extraction.
 */
export interface OpaqueCredentialRejection {
  // prettier-ignore

  /**
   * Identifies the rejected extraction result.
   */
  readonly kind: "rejected";

  /**
   * Explains why the credential was rejected.
   */
  readonly reason:
    | "missing-credential"
    | "duplicate-authorization"
    | "simultaneous-credential"
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

/**
 * Result of extracting a bearer or CSRF-protected opaque-cookie credential.
 */
export type OpaqueCredentialExtraction = RequestCredential | OpaqueCredentialRejection;

/**
 * Strict, framework-neutral helper whose `close()` zeroes the copied CSRF secret.
 */
export class OpaqueSessionCookies {
  /**
   * Immutable header and cookie names used by the browser host's raw admission.
   */
  readonly admission: Readonly<{
    readonly csrfHeaderNames: readonly string[];
    readonly credentialCookieNames: readonly string[];
    readonly stateCookieNames: readonly string[];
  }>;

  private readonly secret: Uint8Array;

  private readonly origins: ReadonlySet<string>;

  private readonly sessionName: string;

  private readonly csrfName: string;

  private readonly maxHeaderValues: number;

  private readonly maxHeaderCharacters: number;

  private readonly maxCookiePairs: number;

  private readonly sameSite: "lax" | "strict" | "none";

  private readonly persistent: boolean;

  private closed = false;

  /**
   * Creates strict cookie extraction with copied CSRF key material.
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
    this.admission = CookieValues.admission(this.sessionName, this.csrfName);
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
    this.sameSite = options.sameSite ?? "lax";
    if (!["lax", "strict", "none"].includes(this.sameSite))
      throw new Error("sameSite must be lax, strict, or none");
    this.persistent = options.persistent ?? false;
    if (typeof this.persistent !== "boolean") throw new Error("persistent must be a boolean");
  }

  /**
   * Creates the CSRF value bound to the entire issued opaque credential.
   * @param credential The complete sealed credential protected by the CSRF value.
   * @returns The derived CSRF value.
   */
  csrf(credential: string): string {
    this.open();
    if (!CookieValues.validCredential(credential))
      throw new Error("credential must be a nonempty sealed value without control characters");
    return createHmac("sha256", this.secret).update(credential, "utf8").digest("base64url");
  }

  /**
   * Creates the immutable pair of host-only cookies for an issued or rotated session.
   * @param credential The complete issued opaque credential.
   * @param expiresAt The actual authoritative session deadline.
   * @returns The session and CSRF Set-Cookie values.
   */
  issue(credential: string, expiresAt: Timestamp): readonly string[] {
    const csrf = this.csrf(credential);
    const expires = this.persistent ? CookieValues.expiryDate(expiresAt) : undefined;
    return Object.freeze([
      stringifySetCookie({
        name: this.sessionName,
        value: credential,
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: this.sameSite,
        ...(expires === undefined ? {} : { expires }),
      }),
      stringifySetCookie({
        name: this.csrfName,
        value: csrf,
        path: "/",
        secure: true,
        sameSite: this.sameSite,
        ...(expires === undefined ? {} : { expires }),
      }),
    ]);
  }

  /**
   * Creates the immutable pair of host-only cookie removals.
   * @returns The expired session and CSRF Set-Cookie values.
   */
  clear(): readonly string[] {
    this.open();
    return Object.freeze([
      stringifySetCookie({
        name: this.sessionName,
        value: "",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: this.sameSite,
        maxAge: 0,
      }),
      stringifySetCookie({
        name: this.csrfName,
        value: "",
        path: "/",
        secure: true,
        sameSite: this.sameSite,
        maxAge: 0,
      }),
    ]);
  }

  /**
   * Rejects simultaneous primary credentials, then reads a bearer or checked cookie credential.
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
    if (
      authorization.length === 1 &&
      CookieValues.primaryPresent(values.get("cookie") ?? [], this.sessionName)
    )
      return CookieValues.rejection("simultaneous-credential");
    if (authorization.length === 1) return CookieValues.bearer(CookieValues.only(authorization));
    return this.cookieCredential(values);
  }

  /**
   * Reads a browser credential while representing no primary credential as absence.
   * @param request Immutable raw headers with method and request-local parsed URL.
   * @returns A credential, terminal rejection, or undefined absence.
   */
  read(request: {
    readonly headers: OpaqueSessionHeaders;
    readonly method: string;
    readonly url: URL;
  }): Promise<RequestCredential | OpaqueCredentialRejection | undefined> {
    const result = this.extract(request.headers);
    return Promise.resolve(
      result.kind === "rejected" && result.reason === "missing-credential" ? undefined : result,
    );
  }

  /**
   * Closes the extractor, zeroes its HMAC secret, and rejects later operations.
   * @returns Completes after the secret is cleared.
   */
  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    this.secret.fill(0);
    return Promise.resolve();
  }

  /**
   * Validates origin and CSRF after the selected cookie pair has been parsed.
   * @param values Duplicate-preserving normalized request headers.
   * @returns Admitted cookie credential or a terminal rejection.
   */
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

  /**
   * Rejects methods that require the copied CSRF key after closure.
   */
  private open(): void {
    if (this.closed) throw new Error("OpaqueSessionCookies is closed");
  }
}

/**
 * Reasons a duplicate-preserving cookie parse can reject a request.
 */
type CookieParseReason =
  "missing-credential" | "malformed-cookie" | "ambiguous-cookie" | "request-too-large";

/**
 * Parsed authentication and CSRF cookie pair or its terminal rejection.
 */
type CookiePair =
  { readonly session: string; readonly csrf: string } | { readonly reason: CookieParseReason };

/**
 * Parses and validates cookie values used by {@link OpaqueSessionCookies}.
 */
const CookieValues = Object.freeze({
  /**
   * Captures the validated standard browser admission names as immutable data.
   * @param sessionName Configured primary cookie name.
   * @param csrfName Configured supporting CSRF cookie name.
   * @returns Frozen data declaration for the host's raw admission.
   */
  admission(sessionName: string, csrfName: string) {
    return Object.freeze({
      csrfHeaderNames: Object.freeze(["x-spine-csrf"]),
      credentialCookieNames: Object.freeze([sessionName]),
      stateCookieNames: Object.freeze([csrfName]),
    });
  },

  /**
   * Checks whether any Cookie field contains the selected primary credential.
   * @param headers Raw Cookie fields that may be legally split.
   * @param sessionName Configured authentication cookie name.
   * @returns Whether a primary cookie is present, including an empty value.
   */
  primaryPresent(headers: readonly string[], sessionName: string): boolean {
    return headers.some((header) => Object.hasOwn(parseCookie(header), sessionName));
  },

  /**
   * Collects own request header fields without losing duplicate values.
   *
   * @param headers Original header object.
   * @param maxValues Existing field and value count limit.
   * @param maxCharacters Existing total character limit.
   * @returns Normalized duplicate-preserving values, or undefined when a limit is exceeded.
   */
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

  /**
   * Reads one Bearer authorization field without accepting malformed syntax.
   *
   * @param value One Authorization field value.
   * @returns Bearer credential or terminal malformed-authorization rejection.
   */
  bearer(value: string): OpaqueCredentialExtraction {
    const match = /^bearer ([\x21-\x7e]+)$/i.exec(value);
    return match === null
      ? CookieValues.rejection("malformed-authorization")
      : Object.freeze({ kind: "bearer" as const, value: CookieValues.only(match.slice(1)) });
  },

  /**
   * Reads an unambiguous credential and CSRF pair across Cookie fields.
   * @param headers Raw Cookie field values in arrival order.
   * @param sessionName Selected authentication cookie name.
   * @param csrfName Selected CSRF cookie name.
   * @param maxPairs Existing total cookie-pair limit.
   * @returns Decoded pair or a terminal parsing rejection.
   */
  parseCookies(
    headers: readonly string[],
    sessionName: string,
    csrfName: string,
    maxPairs: number,
  ): CookiePair {
    const found = new Map<string, string>();
    let count = 0;
    for (const header of headers) {
      const result = CookieValues.readCookieHeader(
        header,
        found,
        sessionName,
        csrfName,
        maxPairs - count,
      );
      if ("reason" in result) return result;
      count += result.count;
    }
    const session = found.get(sessionName);
    const csrf = found.get(csrfName);
    if (session === undefined && csrf === undefined) return { reason: "missing-credential" };
    if (
      session === undefined ||
      csrf === undefined ||
      !CookieValues.validCredential(session) ||
      !CookieValues.validCsrf(csrf)
    ) {
      return { reason: "malformed-cookie" };
    }
    return { session, csrf };
  },

  /**
   * Validates one raw Cookie field before using cookie v2 decoded values.
   * @param header One original Cookie field.
   * @param found Selected names already seen in this request.
   * @param sessionName Selected authentication cookie name.
   * @param csrfName Selected CSRF cookie name.
   * @param remaining Remaining count under the existing pair limit.
   * @returns Count accepted from the field or a terminal rejection.
   */
  readCookieHeader(
    header: string,
    found: Map<string, string>,
    sessionName: string,
    csrfName: string,
    remaining: number,
  ): { readonly count: number } | { readonly reason: CookieParseReason } {
    if (CookieValues.hasForbiddenCookieCharacter(header)) return { reason: "malformed-cookie" };
    const decoded = parseCookie(header);
    let count = 0;
    for (const pair of header.split(";")) {
      count += 1;
      if (count > remaining) return { reason: "request-too-large" };
      const index = pair.indexOf("=");
      if (index <= 0) return { reason: "malformed-cookie" };
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (!CookieValues.validCookiePair(name, value)) return { reason: "malformed-cookie" };
      if (name === sessionName || name === csrfName) {
        if (found.has(name)) return { reason: "ambiguous-cookie" };
        found.set(name, decoded[name] ?? "");
      }
    }
    return { count };
  },

  /**
   * Reads exactly one value for a required request header.
   *
   * @typeParam T Specific rejection reason.
   * @param values Normalized duplicate-preserving fields.
   * @param name Lowercase header name.
   * @param missing Rejection when the header is absent.
   * @param duplicate Rejection when the header repeats.
   * @returns Selected value or the configured rejection.
   */
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

  /**
   * Gets the required first value from a validated singleton field.
   *
   * @param values Values already known to contain one entry.
   * @returns The single field value.
   */
  only(values: readonly string[]): string {
    const value = values[0];
    if (value === undefined) throw new Error("expected one header value");
    return value;
  },

  /**
   * Checks raw Cookie fields for controls and commas.
   *
   * @param value Raw Cookie field.
   * @returns Whether the field has forbidden characters.
   */
  hasForbiddenCookieCharacter(value: string): boolean {
    for (const character of value) {
      const code = character.charCodeAt(0);
      if (code <= 31 || code === 127 || character === ",") return true;
    }
    return false;
  },

  /**
   * Validates an exact canonical request Origin.
   *
   * @param origin Candidate Origin.
   * @returns The canonical Origin or an error for malformed input.
   */
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

  /**
   * Validates a secure host-prefixed cookie name.
   *
   * @param value Candidate name.
   * @param name Option name for errors.
   * @returns The validated host cookie name.
   */
  validCookieName(value: string, name: string): string {
    if (!value.startsWith("__Host-") || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value)) {
      throw new Error(`${name} must be a valid __Host- cookie name`);
    }
    return value;
  },

  /**
   * Validates an existing finite request limit.
   *
   * @param value Candidate limit.
   * @param name Option name for errors.
   * @returns The positive safe integer.
   */
  positiveSafeInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive safe integer`);
    }
    return value;
  },

  /**
   * Checks one raw Cookie name and value for safe field syntax.
   *
   * @param name Raw cookie name.
   * @param value Raw cookie value.
   * @returns Whether both components contain allowed field characters.
   */
  validCookiePair(name: string, value: string): boolean {
    return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) && /^[\x21-\x7e]+$/.test(value);
  },

  /**
   * Checks the unpadded base64url alphabet for CSRF tokens.
   *
   * @param value Candidate CSRF encoding.
   * @returns Whether the characters and length can represent unpadded base64url.
   */
  base64url(value: string): boolean {
    return /^[A-Za-z0-9_-]+$/.test(value) && value.length % 4 !== 1;
  },

  /**
   * Checks the fixed SHA-256 CSRF encoding.
   *
   * @param value Candidate CSRF value.
   * @returns Whether it is a 43-character unpadded base64url digest.
   */
  validCsrf(value: string): boolean {
    return value.length === 43 && CookieValues.base64url(value);
  },

  /**
   * Checks an opaque credential without assuming a fixed sealed length.
   *
   * @param value Candidate complete credential.
   * @returns Whether it is nonempty and free of control characters.
   */
  validCredential(value: string): boolean {
    if (value.length === 0) return false;
    for (const character of value) {
      const code = character.charCodeAt(0);
      if (code <= 31 || code === 127) return false;
    }
    return true;
  },

  /**
   * Converts the authoritative exact deadline to cookie date precision.
   * @param expiresAt Issued session deadline.
   * @returns Browser cookie expiry derived from that deadline.
   */
  expiryDate(expiresAt: Timestamp): Date {
    const deadline = SessionRecords.deadline(expiresAt);
    return new Date(Number(deadline.seconds) * 1_000 + Math.floor(deadline.nanos / 1_000_000));
  },

  /**
   * Compares equal-length CSRF values in constant time.
   *
   * @param expected Derived CSRF digest.
   * @param supplied Browser-supplied CSRF digest.
   * @returns Whether the values match.
   */
  sameCsrf(expected: string, supplied: string): boolean {
    if (expected.length !== supplied.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
  },

  /**
   * Creates a frozen terminal credential rejection.
   *
   * @param reason Specific rejection reason.
   * @returns The rejected extraction outcome.
   */
  rejection(reason: OpaqueCredentialRejection["reason"]): OpaqueCredentialRejection {
    return Object.freeze({ kind: "rejected" as const, reason });
  },
});
