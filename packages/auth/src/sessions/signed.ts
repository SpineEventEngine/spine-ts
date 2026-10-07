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
import { create } from "@bufbuild/protobuf";
import {
  KeyObject,
  createPrivateKey,
  createPublicKey,
  randomBytes as nodeRandomBytes,
  sign,
  verify,
} from "node:crypto";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";

import type {
  AuthenticatedPrincipal,
  BearerCredential,
  RequestCredential,
  ResolvedSession,
  SessionResolver,
} from "../index.js";

/**
 * Clock used by signed sessions; values are Unix epoch milliseconds.
 */
export interface SignedSessionClock {
  // prettier-ignore

  /**
   * Returns a safe Unix epoch millisecond in the Protobuf Timestamp range.
   * Invalid values and exceptions fail closed.
   * @returns The current milliseconds.
   */
  now(): number;
}

/**
 * Creates 16 random bytes for a JWT ID.
 * @param length The required 16-byte length.
 * @returns The generated identifier bytes.
 */
export type SignedSessionRandom = (length: 16) => Uint8Array;

/**
 * An active P-256 signing key.
 */
export interface SignedSessionSigningKey {
  // prettier-ignore

  /**
   * Non-empty local key ID of at most 256 characters.
   */
  readonly kid: string;

  /**
   * Caller-owned P-256 private `KeyObject`; the strategy imports an owned copy.
   */
  readonly privateKey: KeyObject;
}

/**
 * A P-256 public key retained for tokens issued before rotation.
 */
export interface SignedSessionVerificationKey {
  // prettier-ignore

  /**
   * Non-empty local key ID of at most 256 characters.
   */
  readonly kid: string;

  /**
   * Caller-owned P-256 public `KeyObject`; the strategy imports an owned copy.
   */
  readonly publicKey: KeyObject;
}

/**
 * Optional application-owned, durable token revocation capability.
 */
export interface SignedTokenRevocation {
  // prettier-ignore

  /**
   * Discriminator which makes immediate revocation support explicit.
   */
  readonly kind: "supported";

  /**
   * Checks whether the exact 16-byte token ID is revoked.
   * @param jti The token identifier to check.
   * @returns Whether the token is revoked.
   */
  isRevoked(jti: string): Promise<boolean>;

  /**
   * Stores the exact token ID through its Protobuf Timestamp expiry.
   * The application owns persistence, cleanup, availability, and atomicity.
   * @param jti The token identifier to retain.
   * @param expiresAt The expiry after which retention may end.
   * @returns Completes after the token ID is retained.
   */
  revoke(jti: string, expiresAt: Timestamp): Promise<void>;
}

/**
 * Finite configuration for locally-issued ES256 bearer sessions.
 */
export interface SignedSessionsOptions {
  // prettier-ignore

  /**
   * Exact non-empty token issuer, at most 256 characters.
   */
  readonly issuer: string;

  /**
   * Exact non-empty single token audience, at most 256 characters.
   */
  readonly audience: string;

  /**
   * Initial active P-256 signing key.
   */
  readonly activeKey: SignedSessionSigningKey;

  /**
   * Initially retired P-256 verification keys; defaults to none.
   * Each is retained for `ttlSeconds + clockSkewSeconds` after construction.
   */
  readonly retiredKeys?: readonly SignedSessionVerificationKey[];

  /**
   * Optional application-owned immediate-revocation capability; defaults to expiry-only.
   */
  readonly revocation?: SignedTokenRevocation;

  /**
   * Unix-millisecond clock; defaults to `Time.currentTimeMillis`.
   */
  readonly clock?: SignedSessionClock;

  /**
   * Random callback called with 16 and required to return 16 bytes; defaults to Node crypto.
   */
  readonly randomBytes?: SignedSessionRandom;

  /**
   * Positive safe token lifetime in seconds; defaults to 28,800.
   */
  readonly ttlSeconds?: number;

  /**
   * Non-negative safe temporal tolerance in seconds; defaults to 60.
   */
  readonly clockSkewSeconds?: number;

  /**
   * Positive safe input and output token character bound; defaults to 8,192.
   */
  readonly maxTokenCharacters?: number;

  /**
   * Positive safe active-plus-retired key bound; defaults to 16.
   */
  readonly maxKeys?: number;

  /**
   * Positive safe principal-ID character bound; defaults to 256.
   */
  readonly maxPrincipalIdCharacters?: number;

  /**
   * Non-negative safe attribute count bound; defaults to 32.
   */
  readonly maxAttributes?: number;

  /**
   * Non-negative safe total attribute name/value character bound; defaults to 4,096.
   */
  readonly maxAttributeCharacters?: number;
}

/**
 * Result of issuing a signed session.
 *
 * Rejections distinguish terminal close, clock/entropy/signing failure, and
 * a principal outside the configured finite bounds.
 */
export type SignedSessionIssueResult =
  | {
      // prettier-ignore

      /**
       * Identifies successful token issuance.
       */
      readonly kind: "issued";

      /**
       * Provides the issued bearer credential.
       */
      readonly credential: BearerCredential;

      /**
       * Provides the session represented by the credential.
       */
      readonly session: ResolvedSession;
    }
  | {
      // prettier-ignore

      /**
       * Identifies rejected token issuance.
       */
      readonly kind: "rejected";

      /**
       * Explains why token issuance was rejected.
       */
      readonly reason:
        "closed" | "clock-failure" | "entropy-failure" | "principal-invalid" | "signing-failure";
    };

/**
 * Result of atomically changing the active signing key.
 *
 * A rejection never changes the active key or verification ring.
 */
export type SignedSessionRotationResult =
  | {
      // prettier-ignore

      /**
       * Identifies successful signing-key rotation.
       */
      readonly kind: "rotated";
    }
  | {
      // prettier-ignore

      /**
       * Identifies rejected signing-key rotation.
       */
      readonly kind: "rejected";

      /**
       * Explains why signing-key rotation was rejected.
       */
      readonly reason:
        "closed" | "clock-failure" | "invalid-key" | "duplicate-key" | "key-capacity-exceeded";
    };

/**
 * Enumeration-safe result of a signed-session logout.
 *
 * `expiryOnly` means no immediate revocation guarantee exists, while
 * `unavailable` means the configured revocation store failed.
 */
export interface SignedSessionLogoutResult {
  // prettier-ignore

  /**
   * Reports the immediate-revocation outcome.
   */
  readonly kind: "revoked" | "expiryOnly" | "unavailable";
}

type IssueRejectionReason =
  "closed" | "clock-failure" | "entropy-failure" | "principal-invalid" | "signing-failure";

interface VerificationKey {
  readonly publicKey: KeyObject;
  readonly expiresAt?: number;
}
interface ActiveSigningKey {
  readonly kid: string;
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
}
interface Claims {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly iat: number;
  readonly nbf: number;
  readonly exp: number;
  readonly jti: string;
  readonly attributes?: Readonly<Record<string, string>>;
}

/**
 * Finite, local ES256/JWT application sessions. This class has no remote key
 * discovery, persistence, OIDC behavior, or authorization policy. It imports
 * owned key copies, but Node does not expose explicit `KeyObject` zeroing.
 */
export class SignedSessions implements SessionResolver {
  readonly #issuer: string;

  readonly #audience: string;

  readonly #clock: SignedSessionClock;

  readonly #random: SignedSessionRandom;

  readonly #ttl: number;

  readonly #skew: number;

  readonly #maxToken: number;

  readonly #maxKeys: number;

  readonly #maxId: number;

  readonly #maxAttributes: number;

  readonly #maxAttributeChars: number;

  #active: ActiveSigningKey | undefined;

  #keys = new Map<string, VerificationKey>();

  #revocation: SignedTokenRevocation | undefined;

  #closed = false;

  /**
   * Creates signed sessions with copied finite configuration and P-256 keys.
   * @param options The issuer, key ring, limits, clock, entropy, and revocation settings.
   */
  constructor(options: SignedSessionsOptions) {
    const settings = SignedSessionValues.settings(options);
    this.#issuer = settings.issuer;
    this.#audience = settings.audience;
    this.#ttl = settings.ttl;
    this.#skew = settings.skew;
    this.#maxToken = settings.maxToken;
    this.#maxKeys = settings.maxKeys;
    this.#maxId = settings.maxId;
    this.#maxAttributes = settings.maxAttributes;
    this.#maxAttributeChars = settings.maxAttributeChars;
    this.#clock = options.clock ?? { now: () => Time.currentTimeMillis() };
    this.#random = options.randomBytes ?? nodeRandomBytes;
    this.#revocation = options.revocation;
    const retainedUntil = SignedSessionValues.retiredRetention(
      options,
      this.#maxKeys,
      this.#clock,
      this.#ttl,
      this.#skew,
    );
    this.#active = SignedSessionValues.signing(options.activeKey);
    this.#keys.set(this.#active.kid, { publicKey: this.#active.publicKey });
    for (const key of options.retiredKeys ?? []) {
      const copied = SignedSessionValues.verification(key);
      if (this.#keys.has(copied.kid)) throw new Error("duplicate kid");
      this.#keys.set(
        copied.kid,
        retainedUntil === undefined
          ? { publicKey: copied.publicKey }
          : { publicKey: copied.publicKey, expiresAt: retainedUntil },
      );
    }
  }

  /**
   * Creates one compact ES256 bearer token inside configured identity bounds.
   * @param principal The authenticated principal to encode.
   * @returns The issuance outcome and, when accepted, credential and session.
   */
  issue(principal: AuthenticatedPrincipal): Promise<SignedSessionIssueResult> {
    if (this.#isClosed()) return Promise.resolve(SignedSessionValues.rejected("closed"));
    const now = this.#now();
    if (typeof now !== "number")
      return Promise.resolve(
        SignedSessionValues.rejected(now.kind === "closed" ? "closed" : "clock-failure"),
      );
    if (this.#isClosed()) return Promise.resolve(SignedSessionValues.rejected("closed"));
    this.#sweep(now);
    let copied: AuthenticatedPrincipal | undefined;
    try {
      copied = SignedSessionValues.principalCopy(
        principal,
        this.#maxId,
        this.#maxAttributes,
        this.#maxAttributeChars,
      );
    } catch {
      return Promise.resolve(SignedSessionValues.rejected("principal-invalid"));
    }
    if (copied === undefined)
      return Promise.resolve(SignedSessionValues.rejected("principal-invalid"));
    const jti = this.#jti();
    if (jti === undefined)
      return Promise.resolve(
        this.#isClosed()
          ? SignedSessionValues.rejected("closed")
          : SignedSessionValues.rejected("entropy-failure"),
      );
    if (this.#isClosed()) return Promise.resolve(SignedSessionValues.rejected("closed"));
    const again = this.#now();
    if (typeof again !== "number")
      return Promise.resolve(
        SignedSessionValues.rejected(again.kind === "closed" ? "closed" : "clock-failure"),
      );
    if (this.#isClosed()) return Promise.resolve(SignedSessionValues.rejected("closed"));
    const iat = Math.floor(again / 1000);
    const exp = iat + this.#ttl;
    if (!Number.isSafeInteger(exp) || !SignedSessionValues.timeValid(exp * 1000))
      return Promise.resolve(SignedSessionValues.rejected("clock-failure"));
    const claims: Claims = {
      iss: this.#issuer,
      aud: this.#audience,
      sub: copied.id,
      iat,
      nbf: iat,
      exp,
      jti,
      ...(copied.attributes === undefined ? {} : { attributes: copied.attributes }),
    };
    try {
      const token = this.#token(claims);
      if (token.length > this.#maxToken)
        return Promise.resolve(SignedSessionValues.rejected("signing-failure"));
      if (this.#isClosed()) return Promise.resolve(SignedSessionValues.rejected("closed"));
      return Promise.resolve({
        kind: "issued",
        credential: Object.freeze({ kind: "bearer", value: token }),
        session: SignedSessionValues.session(copied, exp),
      });
    } catch {
      return Promise.resolve(SignedSessionValues.rejected("signing-failure"));
    }
  }

  /**
   * Resolves one locally verifiable bearer credential.
   *
   * Cookie credentials and every malformed, invalid, expired, revoked, or
   * unavailable-revocation result return `undefined`.
   * @param credential The credential to resolve.
   * @returns The verified session, or undefined when it cannot be trusted.
   */
  async resolve(credential: RequestCredential): Promise<ResolvedSession | undefined> {
    if (this.#isClosed() || credential.kind !== "bearer") return undefined;
    const claims = this.#verifiedClaims(credential.value);
    if (claims === undefined) return undefined;
    if (this.#revocation !== undefined)
      try {
        if (await this.#revocation.isRevoked(claims.jti)) return undefined;
      } catch {
        return undefined;
      }
    if (this.#isClosed()) return undefined;
    return SignedSessionValues.session(
      {
        id: claims.sub,
        ...(claims.attributes === undefined ? {} : { attributes: claims.attributes }),
      },
      claims.exp,
    );
  }

  /**
   * Updates the active P-256 key atomically.
   *
   * The previous verifier remains through the configured token lifetime plus
   * clock skew, subject to the finite key bound.
   * @param next The next active signing key.
   * @returns The rotation outcome.
   */
  rotate(next: SignedSessionSigningKey): Promise<SignedSessionRotationResult> {
    if (this.#isClosed()) return Promise.resolve(SignedSessionValues.rotation("closed"));
    const now = this.#now();
    if (typeof now !== "number")
      return Promise.resolve(
        SignedSessionValues.rotation(now.kind === "closed" ? "closed" : "clock-failure"),
      );
    if (this.#isClosed()) return Promise.resolve(SignedSessionValues.rotation("closed"));
    this.#sweep(now);
    let copy: { kid: string; privateKey: KeyObject; publicKey: KeyObject };
    try {
      copy = SignedSessionValues.signing(next);
    } catch {
      return Promise.resolve(SignedSessionValues.rotation("invalid-key"));
    }
    if (this.#keys.has(copy.kid))
      return Promise.resolve(SignedSessionValues.rotation("duplicate-key"));
    if (this.#keys.size + 1 > this.#maxKeys)
      return Promise.resolve(SignedSessionValues.rotation("key-capacity-exceeded"));
    const again = this.#now();
    if (typeof again !== "number")
      return Promise.resolve(
        SignedSessionValues.rotation(again.kind === "closed" ? "closed" : "clock-failure"),
      );
    if (this.#isClosed()) return Promise.resolve(SignedSessionValues.rotation("closed"));
    let expiresAt: number;
    try {
      expiresAt = SignedSessionValues.retentionDeadline(again, this.#ttl, this.#skew);
    } catch {
      return Promise.resolve(SignedSessionValues.rotation("clock-failure"));
    }
    const active = this.#active;
    if (active === undefined) return Promise.resolve(SignedSessionValues.rotation("closed"));
    this.#keys.set(active.kid, {
      publicKey: active.publicKey,
      expiresAt,
    });
    this.#active = copy;
    this.#keys.set(copy.kid, { publicKey: copy.publicKey });
    return Promise.resolve({ kind: "rotated" });
  }

  /**
   * Sends a logout request without revealing invalid-token state.
   *
   * Immediate revocation requires `SignedTokenRevocation`; otherwise valid and
   * invalid input both report `expiryOnly`.
   * @param credential The credential to revoke when valid.
   * @returns The enumeration-safe logout outcome.
   */
  async logout(credential: RequestCredential): Promise<SignedSessionLogoutResult> {
    const resolved = await this.#claimsForLogout(credential);
    if (resolved === undefined) return { kind: "expiryOnly" };
    if (this.#revocation === undefined) return { kind: "expiryOnly" };
    try {
      await this.#revocation.revoke(resolved.jti, SignedSessionValues.timestamp(resolved.exp));
      return this.#closed ? { kind: "expiryOnly" } : { kind: "revoked" };
    } catch {
      return this.#closed ? { kind: "expiryOnly" } : { kind: "unavailable" };
    }
  }

  /**
   * Closes the resolver and clears active, verification-key, and revocation references.
   * Node `KeyObject` memory cannot be explicitly zeroed.
   * @returns Completes after resolver references are cleared.
   */
  close(): Promise<void> {
    this.#closed = true;
    this.#keys.clear();
    this.#active = undefined;
    this.#revocation = undefined;
    return Promise.resolve();
  }

  #claimsForLogout(credential: RequestCredential): Promise<Claims | undefined> {
    if (credential.kind !== "bearer" || this.#isClosed()) return Promise.resolve(undefined);
    return Promise.resolve(this.#verifiedClaims(credential.value));
  }

  #verifiedClaims(value: string): Claims | undefined {
    const parsed = this.#parse(value);
    if (parsed === undefined) return undefined;
    const now = this.#now();
    if (typeof now !== "number" || this.#isClosed()) return undefined;
    this.#sweep(now);
    const key = this.#keys.get(parsed.kid);
    if (key === undefined || (key.expiresAt !== undefined && now > key.expiresAt)) return undefined;
    try {
      if (
        !verify(
          "sha256",
          Buffer.from(parsed.input),
          { key: key.publicKey, dsaEncoding: "ieee-p1363" },
          parsed.signature,
        )
      )
        return undefined;
    } catch {
      return undefined;
    }
    return SignedSessionValues.validClaims(
      parsed.claims,
      this.#issuer,
      this.#audience,
      this.#ttl,
      this.#skew,
      now,
      this.#maxId,
      this.#maxAttributes,
      this.#maxAttributeChars,
    );
  }

  #token(claims: Claims): string {
    const active = this.#active;
    if (active === undefined) throw new Error("SignedSessions is closed");
    const header = SignedSessionValues.encode({ alg: "ES256", typ: "JWT", kid: active.kid });
    const payload = SignedSessionValues.encode(claims);
    const input = `${header}.${payload}`;
    const signature = sign("sha256", Buffer.from(input), {
      key: active.privateKey,
      dsaEncoding: "ieee-p1363",
    });
    if (signature.byteLength !== 64) throw new Error("invalid ES256 signature");
    return `${input}.${Buffer.from(signature).toString("base64url")}`;
  }

  #jti(): string | undefined {
    let bytes: Uint8Array | undefined;
    try {
      bytes = this.#random(16);
      if (bytes.byteLength !== 16) return undefined;
      return Buffer.from(bytes).toString("base64url");
    } catch {
      return undefined;
    } finally {
      bytes?.fill(0);
    }
  }

  #now(): number | { readonly kind: "closed" | "failure" } {
    try {
      const value = this.#clock.now();
      if (!Number.isSafeInteger(value) || !SignedSessionValues.timeValid(value)) throw new Error();
      return value;
    } catch {
      if (this.#isClosed()) return { kind: "closed" };
      void this.close();
      return { kind: "failure" };
    }
  }

  #isClosed(): boolean {
    return this.#closed;
  }

  #sweep(now: number): void {
    for (const [kid, key] of this.#keys)
      if (key.expiresAt !== undefined && now > key.expiresAt) this.#keys.delete(kid);
  }

  #parse(
    value: string,
  ): { kid: string; input: string; signature: Buffer; claims: unknown } | undefined {
    if (typeof value !== "string" || value.length === 0 || value.length > this.#maxToken)
      return undefined;
    const segments = value.split(".");
    if (
      segments.length !== 3 ||
      segments.some((segment) => !SignedSessionValues.base64url(segment))
    )
      return undefined;
    const [encodedHeader, encodedClaims, encodedSignature] = segments as [string, string, string];
    try {
      const header = SignedSessionValues.json(encodedHeader);
      if (
        !SignedSessionValues.plain(header) ||
        header.alg !== "ES256" ||
        header.typ !== "JWT" ||
        typeof header.kid !== "string" ||
        Object.keys(header).length !== 3 ||
        !SignedSessionValues.validKid(header.kid)
      )
        return undefined;
      const signature = Buffer.from(encodedSignature, "base64url");
      if (signature.byteLength !== 64 || signature.toString("base64url") !== encodedSignature)
        return undefined;
      return {
        kid: header.kid,
        input: `${encodedHeader}.${encodedClaims}`,
        signature,
        claims: SignedSessionValues.json(encodedClaims),
      };
    } catch {
      return undefined;
    }
  }
}

/**
 * Validates, serializes, and constructs finite signed-session values.
 */
const SignedSessionValues = Object.freeze({
  /**
   * Validates the issuer, audience, and finite token limits before key installation.
   * @param options The signed-session configuration.
   * @returns Copied and bounded settings for a signed session.
   */
  settings(options: SignedSessionsOptions) {
    return {
      issuer: SignedSessionValues.boundedString(options.issuer, "issuer"),
      audience: SignedSessionValues.boundedString(options.audience, "audience"),
      ttl: SignedSessionValues.positive(options.ttlSeconds ?? 28_800, "ttlSeconds"),
      skew: SignedSessionValues.nonnegative(options.clockSkewSeconds ?? 60, "clockSkewSeconds"),
      maxToken: SignedSessionValues.positive(
        options.maxTokenCharacters ?? 8_192,
        "maxTokenCharacters",
      ),
      maxKeys: SignedSessionValues.positive(options.maxKeys ?? 16, "maxKeys"),
      maxId: SignedSessionValues.positive(
        options.maxPrincipalIdCharacters ?? 256,
        "maxPrincipalIdCharacters",
      ),
      maxAttributes: SignedSessionValues.nonnegative(options.maxAttributes ?? 32, "maxAttributes"),
      maxAttributeChars: SignedSessionValues.nonnegative(
        options.maxAttributeCharacters ?? 4_096,
        "maxAttributeCharacters",
      ),
    };
  },

  /**
   * Checks retired-key capacity and computes their shared retention deadline.
   * @param options The configured retired keys.
   * @param maxKeys The maximum ring size including the active key.
   * @param clock The effective session clock.
   * @param ttl The token lifetime in seconds.
   * @param skew The accepted clock skew in seconds.
   * @returns The retention deadline, or no deadline when no retired keys exist.
   */
  retiredRetention(
    options: SignedSessionsOptions,
    maxKeys: number,
    clock: SignedSessionClock,
    ttl: number,
    skew: number,
  ): number | undefined {
    if ((options.retiredKeys?.length ?? 0) + 1 > maxKeys) throw new Error("maxKeys exceeded");
    return options.retiredKeys === undefined || options.retiredKeys.length === 0
      ? undefined
      : SignedSessionValues.retentionDeadline(SignedSessionValues.clockValue(clock), ttl, skew);
  },

  /**
   * Creates a rejected token-issue result.
   * @param reason The reason for rejecting the operation.
   * @returns The rejected issue outcome.
   */
  rejected(reason: IssueRejectionReason): SignedSessionIssueResult {
    return { kind: "rejected", reason };
  },

  /**
   * Creates a rejected key-rotation result.
   * @param reason The reason for rejecting the operation.
   * @returns The rejected rotation outcome.
   */
  rotation(
    reason: "closed" | "clock-failure" | "invalid-key" | "duplicate-key" | "key-capacity-exceeded",
  ): SignedSessionRotationResult {
    return { kind: "rejected", reason };
  },

  /**
   * Copies and validates a P-256 private signing key.
   * @param key The key material to copy and validate.
   * @returns The copied private and public key pair.
   */
  signing(key: SignedSessionSigningKey) {
    const kid = SignedSessionValues.boundedString(key.kid, "kid");
    if (
      key.privateKey.type !== "private" ||
      key.privateKey.asymmetricKeyType !== "ec" ||
      key.privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    )
      throw new Error("P-256 private key required");
    const der = key.privateKey.export({ type: "pkcs8", format: "der" });
    let privateKey: KeyObject;
    try {
      privateKey = createPrivateKey({ key: der, type: "pkcs8", format: "der" });
    } finally {
      der.fill(0);
    }
    const publicKey = createPublicKey(privateKey);
    return { kid, privateKey, publicKey };
  },

  /**
   * Copies and validates a P-256 public verification key.
   * @param key The key material to copy and validate.
   * @returns The copied public verification key.
   */
  verification(key: SignedSessionVerificationKey) {
    const kid = SignedSessionValues.boundedString(key.kid, "kid");
    if (
      key.publicKey.type !== "public" ||
      key.publicKey.asymmetricKeyType !== "ec" ||
      key.publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    )
      throw new Error("P-256 public key required");
    const der = key.publicKey.export({ type: "spki", format: "der" });
    try {
      return { kid, publicKey: createPublicKey({ key: der, type: "spki", format: "der" }) };
    } finally {
      der.fill(0);
    }
  },

  /**
   * Validates a positive safe integer limit.
   * @param value The positive integer limit to validate.
   * @param name The named setting in a validation error.
   * @returns The validated positive limit.
   */
  positive(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error(`${name} must be a positive safe integer`);
    return value;
  },

  /**
   * Validates a non-negative safe integer limit.
   * @param value The non-negative integer limit to validate.
   * @param name The named setting in a validation error.
   * @returns The validated non-negative limit.
   */
  nonnegative(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error(`${name} must be a non-negative safe integer`);
    return value;
  },

  /**
   * Validates a non-empty bounded key or identity string.
   * @param value The signing key or identity string to validate.
   * @param name The named setting in a validation error.
   * @returns The validated string.
   */
  boundedString(value: string, name: string): string {
    if (typeof value !== "string" || value.length === 0 || value.length > 256)
      throw new Error(`${name} must be a non-empty string of at most 256 characters`);
    return value;
  },

  /**
   * Checks the signing-key identifier length.
   * @param value The signing-key identifier to check.
   * @returns Whether the key identifier length is valid.
   */
  validKid(value: string): boolean {
    return value.length > 0 && value.length <= 256;
  },

  /**
   * Checks the URL-safe base64 alphabet and length.
   * @param value The encoded string to check for URL-safe base64.
   * @returns Whether the string is URL-safe base64.
   */
  base64url(value: string): boolean {
    return value.length > 0 && /^[A-Za-z0-9_-]+$/.test(value) && value.length % 4 !== 1;
  },

  /**
   * Encodes a JSON value as URL-safe base64.
   * @param value The JSON value to encode.
   * @returns The encoded JSON string.
   */
  encode(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
  },

  /**
   * Decodes bounded URL-safe base64 JSON.
   * @param value The URL-safe base64 JSON string to decode.
   * @returns The decoded JSON value.
   */
  json(value: string): unknown {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.byteLength > 16_384) throw new Error();
    return JSON.parse(decoded.toString("utf8"));
  },

  /**
   * Checks whether a value is a plain object.
   * @param value The unknown value to test for plain-record shape.
   * @returns Whether the value is a plain record.
   */
  plain(value: unknown): value is Record<string, unknown> {
    return (
      typeof value === "object" &&
      value !== null &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  },

  /**
   * Copies a principal under identifier and attribute bounds.
   * @param value The principal data to copy under configured bounds.
   * @param maxId The maximum principal identifier length.
   * @param maxAttributes The maximum attribute count.
   * @param maxChars The maximum combined attribute characters.
   * @returns The immutable principal, or undefined when bounds fail.
   */
  principalCopy(
    value: AuthenticatedPrincipal,
    maxId: number,
    maxAttributes: number,
    maxChars: number,
  ): AuthenticatedPrincipal | undefined {
    if (typeof value.id !== "string" || value.id.length === 0 || value.id.length > maxId)
      return undefined;
    if (value.attributes === undefined) return Object.freeze({ id: value.id });
    if (!SignedSessionValues.plain(value.attributes)) return undefined;
    const entries: [string, string][] = [];
    let characters = 0;
    for (const name in value.attributes) {
      if (!Object.prototype.hasOwnProperty.call(value.attributes, name)) continue;
      if (entries.length === maxAttributes) return undefined;
      const attribute = value.attributes[name];
      if (typeof attribute !== "string") return undefined;
      characters += name.length + attribute.length;
      if (characters > maxChars) return undefined;
      entries.push([name, attribute]);
    }
    return Object.freeze({
      id: value.id,
      attributes: Object.freeze(Object.fromEntries(entries)),
    });
  },

  /**
   * Validates signed token claims, time limits, and principal bounds.
   * @param value The decoded signed-token claims to validate.
   * @param issuer The required token issuer.
   * @param audience The required token audience.
   * @param ttl The maximum token lifetime in seconds.
   * @param skew The accepted clock skew in seconds.
   * @param now The current epoch milliseconds.
   * @param maxId The maximum principal identifier length.
   * @param maxAttributes The maximum attribute count.
   * @param maxChars The maximum combined attribute characters.
   * @returns Validated claims, or undefined when verification fails.
   */
  validClaims(
    value: unknown,
    issuer: string,
    audience: string,
    ttl: number,
    skew: number,
    now: number,
    maxId: number,
    maxAttributes: number,
    maxChars: number,
  ): Claims | undefined {
    if (
      !SignedSessionValues.plain(value) ||
      Object.keys(value).some(
        (key) => !["iss", "aud", "sub", "iat", "nbf", "exp", "jti", "attributes"].includes(key),
      )
    )
      return undefined;
    const { iss, aud, sub, iat, nbf, exp, jti, attributes } = value;
    if (
      iss !== issuer ||
      aud !== audience ||
      typeof iat !== "number" ||
      typeof nbf !== "number" ||
      typeof exp !== "number" ||
      typeof jti !== "string" ||
      ![iat, nbf, exp].every(Number.isSafeInteger) ||
      exp <= nbf ||
      nbf < iat ||
      exp - iat > ttl ||
      nbf * 1000 > now + skew * 1000 ||
      exp * 1000 < now - skew * 1000 ||
      !SignedSessionValues.validJti(jti)
    )
      return undefined;
    const principal = SignedSessionValues.principalCopy(
      {
        id: sub as string,
        ...(attributes === undefined ? {} : { attributes: attributes as Record<string, string> }),
      },
      maxId,
      maxAttributes,
      maxChars,
    );
    if (!principal) return undefined;
    return {
      iss,
      aud,
      sub: principal.id,
      iat,
      nbf,
      exp,
      jti,
      ...(principal.attributes === undefined ? {} : { attributes: principal.attributes }),
    };
  },

  /**
   * Creates a Protobuf timestamp from epoch seconds.
   * @param seconds The timestamp seconds.
   * @returns The Protobuf timestamp.
   */
  timestamp(seconds: number): Timestamp {
    return create(TimestampSchema, { seconds: BigInt(seconds) });
  },

  /**
   * Creates a resolved session with a detached principal.
   * @param principal The principal to copy.
   * @param seconds The timestamp seconds.
   * @returns The detached resolved session.
   */
  session(principal: AuthenticatedPrincipal, seconds: number): ResolvedSession {
    const copied = SignedSessionValues.principalCopy(
      principal,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
    );
    if (copied === undefined) throw new Error("invalid principal");
    return Object.freeze({
      principal: copied,
      expiresAt: SignedSessionValues.timestamp(seconds),
    });
  },

  /**
   * Checks whether epoch milliseconds fit a Protobuf timestamp.
   * @param milliseconds The candidate epoch milliseconds.
   * @returns Whether the instant is representable.
   */
  timeValid(milliseconds: number): boolean {
    const seconds = Math.floor(milliseconds / 1000);
    return seconds >= -62_135_596_800 && seconds <= 253_402_300_799;
  },

  /**
   * Checks a token identifier against expected random encoding.
   * @param value The token identifier to check.
   * @returns Whether the token identifier has the expected shape.
   */
  validJti(value: string): boolean {
    return value.length === 22 && SignedSessionValues.base64url(value);
  },

  /**
   * Reads a safe signed-session clock value.
   * @param clock The configured millisecond clock.
   * @returns The validated epoch milliseconds.
   */
  clockValue(clock: SignedSessionClock): number {
    const value = clock.now();
    if (!Number.isSafeInteger(value) || !SignedSessionValues.timeValid(value))
      throw new Error("invalid clock");
    return value;
  },

  /**
   * Calculates when a retired signing key may be removed.
   * @param now The current epoch milliseconds.
   * @param ttl The maximum token lifetime in seconds.
   * @param skew The accepted clock skew in seconds.
   * @returns The safe retired-key deadline.
   */
  retentionDeadline(now: number, ttl: number, skew: number): number {
    const seconds = ttl + skew;
    const milliseconds = seconds * 1_000;
    const deadline = now + milliseconds;
    if (
      !Number.isSafeInteger(seconds) ||
      !Number.isSafeInteger(milliseconds) ||
      !SignedSessionValues.timeValid(deadline)
    )
      throw new Error("retention deadline exceeds Timestamp range");
    return deadline;
  },
});
