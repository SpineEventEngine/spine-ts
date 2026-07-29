import { create } from "@bufbuild/protobuf";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import { randomBytes as nodeRandomBytes } from "node:crypto";

import type {
  AuthenticatedPrincipal,
  CookieCredential,
  RequestCredential,
  ResolvedSession,
  SessionResolver,
} from "../index.js";

/** Clock used to evaluate opaque-session expiry. */
export interface OpaqueSessionClock {
  /**
   * Returns Unix epoch milliseconds as a safe integer in the Protobuf Timestamp
   * range. Throws and invalid values fail closed.
   */
  now(): number;
}
/** Random-byte source used to create opaque session identifiers. */
export type OpaqueSessionRandom = (length: number) => Uint8Array;
/** Construction options for the bounded in-memory opaque-session resolver. */
export interface OpaqueSessionsOptions {
  /** Millisecond clock; each value must be a safe integer in Timestamp range. */
  readonly clock?: OpaqueSessionClock;
  /**
   * Receives exactly `32` and returns exactly 32 random bytes per call.
   * Throwing or wrong-length results consume a bounded collision attempt, and
   * every returned mutable buffer is zeroed before this resolver returns.
   */
  readonly randomBytes?: OpaqueSessionRandom;
  /** Positive safe session lifetime in milliseconds; defaults to eight hours. */
  readonly ttlMilliseconds?: number;
  /** Positive safe retained-session bound; defaults to 10,000. */
  readonly maxSessions?: number;
  /** Positive safe ID-generation attempt bound; defaults to three. */
  readonly collisionAttempts?: number;
}
/** Result of creating an opaque session. */
export type OpaqueSessionCreateResult =
  | {
      readonly kind: "created";
      readonly credential: CookieCredential;
      readonly session: ResolvedSession;
    }
  | {
      readonly kind: "rejected";
      readonly reason: "capacity-exceeded" | "entropy-exhausted" | "clock-failure" | "closed";
    };
/** Result of rotating an opaque session. */
export type OpaqueSessionRotateResult =
  | {
      readonly kind: "rotated";
      readonly credential: CookieCredential;
      readonly session: ResolvedSession;
    }
  | {
      readonly kind: "rejected";
      readonly reason:
        | "not-found"
        | "expired"
        | "unsupported-credential"
        | "entropy-exhausted"
        | "clock-failure"
        | "closed";
    };
/** Enumeration-safe acknowledgement of an opaque-session logout request. */
export interface OpaqueSessionLogoutResult {
  readonly kind: "logged-out";
}

/**
 * A bounded, terminal in-memory store of random opaque application sessions.
 *
 * It is intentionally process-local: applications needing durable or shared
 * sessions provide another `SessionResolver` implementation.
 */
export class OpaqueSessions implements SessionResolver {
  private readonly records = new Map<string, SessionRecord>();
  private readonly clock: OpaqueSessionClock;
  private readonly random: OpaqueSessionRandom;
  private readonly ttlMilliseconds: number;
  private readonly maxSessions: number;
  private readonly collisionAttempts: number;
  private closed = false;

  constructor(options: OpaqueSessionsOptions = {}) {
    this.clock = options.clock ?? { now: Date.now };
    this.random = options.randomBytes ?? nodeRandomBytes;
    this.ttlMilliseconds = positiveSafeInteger(
      options.ttlMilliseconds ?? 8 * 60 * 60 * 1_000,
      "ttlMilliseconds",
    );
    this.maxSessions = positiveSafeInteger(options.maxSessions ?? 10_000, "maxSessions");
    this.collisionAttempts = positiveSafeInteger(
      options.collisionAttempts ?? 3,
      "collisionAttempts",
    );
  }

  /** Creates a new session unless the terminal or bounded store state rejects it. */
  create(principal: AuthenticatedPrincipal): Promise<OpaqueSessionCreateResult> {
    if (this.isClosed()) return Promise.resolve({ kind: "rejected", reason: "closed" });
    const now = this.now();
    if (now === undefined) return Promise.resolve({ kind: "rejected", reason: "clock-failure" });
    this.sweepExpired(now);
    if (this.records.size >= this.maxSessions)
      return Promise.resolve({ kind: "rejected", reason: "capacity-exceeded" });
    const id = this.nextId();
    if (id === undefined) return Promise.resolve({ kind: "rejected", reason: "entropy-exhausted" });
    const current = this.now();
    if (current === undefined)
      return Promise.resolve({ kind: "rejected", reason: "clock-failure" });
    this.sweepExpired(current);
    if (this.isClosed()) return Promise.resolve({ kind: "rejected", reason: "closed" });
    if (this.records.size >= this.maxSessions) {
      return Promise.resolve({ kind: "rejected", reason: "capacity-exceeded" });
    }
    if (this.records.has(id))
      return Promise.resolve({ kind: "rejected", reason: "entropy-exhausted" });
    const record = this.record(principal, current);
    if (record === undefined) return Promise.resolve({ kind: "rejected", reason: "clock-failure" });
    if (this.isClosed()) return Promise.resolve({ kind: "rejected", reason: "closed" });
    this.records.set(id, record);
    return Promise.resolve({
      kind: "created",
      credential: credential(id),
      session: resolved(record),
    });
  }

  /** Resolves one currently live cookie credential as a defensive copy. */
  resolve(credentialInput: RequestCredential): Promise<ResolvedSession | undefined> {
    if (this.closed || credentialInput.kind !== "cookie") return Promise.resolve(undefined);
    const now = this.now();
    if (now === undefined) return Promise.resolve(undefined);
    const record = this.live(credentialInput.value, now);
    return Promise.resolve(record === undefined ? undefined : resolved(record));
  }

  /** Rotates a live opaque credential without ever retaining both values. */
  rotate(credentialInput: RequestCredential): Promise<OpaqueSessionRotateResult> {
    if (this.isClosed()) return Promise.resolve({ kind: "rejected", reason: "closed" });
    if (credentialInput.kind !== "cookie")
      return Promise.resolve({ kind: "rejected", reason: "unsupported-credential" });
    const now = this.now();
    if (now === undefined) return Promise.resolve({ kind: "rejected", reason: "clock-failure" });
    const previous = this.records.get(credentialInput.value);
    if (previous === undefined) return Promise.resolve({ kind: "rejected", reason: "not-found" });
    if (this.expired(previous, now)) {
      this.records.delete(credentialInput.value);
      return Promise.resolve({ kind: "rejected", reason: "expired" });
    }
    const id = this.nextId();
    if (id === undefined) return Promise.resolve({ kind: "rejected", reason: "entropy-exhausted" });
    const current = this.now();
    if (current === undefined)
      return Promise.resolve({ kind: "rejected", reason: "clock-failure" });
    if (this.isClosed()) return Promise.resolve({ kind: "rejected", reason: "closed" });
    if (this.records.get(credentialInput.value) !== previous) {
      return Promise.resolve({ kind: "rejected", reason: "not-found" });
    }
    if (this.expired(previous, current)) {
      this.records.delete(credentialInput.value);
      return Promise.resolve({ kind: "rejected", reason: "expired" });
    }
    if (this.records.has(id))
      return Promise.resolve({ kind: "rejected", reason: "entropy-exhausted" });
    const record = this.record(previous.principal, current);
    if (record === undefined) return Promise.resolve({ kind: "rejected", reason: "clock-failure" });
    this.records.delete(credentialInput.value);
    this.records.set(id, record);
    return Promise.resolve({
      kind: "rotated",
      credential: credential(id),
      session: resolved(record),
    });
  }

  /** Deletes a cookie session when present without revealing whether it existed. */
  logout(credentialInput: RequestCredential): Promise<OpaqueSessionLogoutResult> {
    if (!this.closed && credentialInput.kind === "cookie")
      this.records.delete(credentialInput.value);
    return Promise.resolve({ kind: "logged-out" });
  }

  /** Terminally drops all retained session identity and record references. */
  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    this.records.clear();
    return Promise.resolve();
  }

  private isClosed(): boolean {
    return this.closed;
  }

  private record(principal: AuthenticatedPrincipal, now: number): SessionRecord | undefined {
    const expiresAt = now + this.ttlMilliseconds;
    if (!Number.isSafeInteger(expiresAt) || !timestampValid(expiresAt)) {
      this.failClosed();
      return undefined;
    }
    return { principal: copyPrincipal(principal), expiresAt };
  }

  private nextId(): string | undefined {
    for (let attempt = 0; attempt < this.collisionAttempts; attempt += 1) {
      let bytes: Uint8Array;
      try {
        bytes = this.random(32);
      } catch {
        continue;
      }
      try {
        if (bytes.byteLength !== 32) continue;
        const id = Buffer.from(bytes).toString("base64url");
        if (!this.records.has(id)) return id;
      } finally {
        bytes.fill(0);
      }
    }
    return undefined;
  }

  private live(id: string, now: number): SessionRecord | undefined {
    const record = this.records.get(id);
    if (record === undefined) return undefined;
    if (!this.expired(record, now)) return record;
    this.records.delete(id);
    return undefined;
  }

  private sweepExpired(now: number): void {
    for (const [id, record] of this.records) if (this.expired(record, now)) this.records.delete(id);
  }

  private expired(record: SessionRecord, now: number): boolean {
    return now >= record.expiresAt;
  }

  private now(): number | undefined {
    try {
      const value = this.clock.now();
      if (!Number.isSafeInteger(value) || !timestampValid(value)) throw new Error("invalid clock");
      return value;
    } catch {
      this.failClosed();
      return undefined;
    }
  }

  private failClosed(): void {
    this.closed = true;
    this.records.clear();
  }
}

interface SessionRecord {
  readonly principal: AuthenticatedPrincipal;
  readonly expiresAt: number;
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive safe integer`);
  return value;
}

function credential(value: string): CookieCredential {
  return Object.freeze({ kind: "cookie" as const, value });
}

function copyPrincipal(principal: AuthenticatedPrincipal): AuthenticatedPrincipal {
  if (typeof principal.id !== "string") throw new Error("principal.id must be a string");
  const attributes =
    principal.attributes === undefined ? undefined : Object.freeze({ ...principal.attributes });
  return Object.freeze(
    attributes === undefined ? { id: principal.id } : { id: principal.id, attributes },
  );
}

function resolved(record: SessionRecord): ResolvedSession {
  return Object.freeze({
    principal: copyPrincipal(record.principal),
    expiresAt: timestamp(record.expiresAt),
  });
}

function timestamp(milliseconds: number): Timestamp {
  const seconds = Math.floor(milliseconds / 1_000);
  return create(TimestampSchema, {
    seconds: BigInt(seconds),
    nanos: (milliseconds - seconds * 1_000) * 1_000_000,
  });
}

function timestampValid(milliseconds: number): boolean {
  const seconds = Math.floor(milliseconds / 1_000);
  return seconds >= -62_135_596_800 && seconds <= 253_402_300_799;
}
