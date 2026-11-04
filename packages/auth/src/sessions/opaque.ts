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

import { create } from "@bufbuild/protobuf";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import { randomBytes as nodeRandomBytes } from "node:crypto";
import { sealData, unsealData } from "iron-session";
import {
  OpaqueSessionRecordSchema,
  type OpaqueSessionRecord,
} from "@spine-event-engine/proto/auth";

import { MemoryOpaqueSessionStore, type OpaqueSessionStore } from "./opaque-session-store.js";
import { SessionRecords } from "./session-record.js";
import type {
  AuthenticatedPrincipal,
  CookieCredential,
  RequestCredential,
  ResolvedSession,
  SessionResolver,
} from "../index.js";

/**
 * Trusted millisecond clock for exact application-session validity.
 */
export interface OpaqueSessionClock {
  // prettier-ignore

  /**
   * Reads a safe Unix epoch millisecond in the Protobuf Timestamp range.
   *
   * @returns Current milliseconds.
   */
  now(): number;
}

/**
 * Creates cryptographic bytes for a stable ID or credential generation.
 *
 * @param length Required byte count.
 * @returns Random bytes that the caller clears after use.
 */
export type OpaqueSessionRandom = (length: number) => Uint8Array;

/**
 * Required sealing and lifetime policy with optional replaceable storage.
 */
export interface OpaqueSessionsOptions {
  // prettier-ignore

  /**
   * Store selected for authoritative session transitions; omission selects memory.
   */
  readonly store?: OpaqueSessionStore;

  /**
   * Application and purpose binding authenticated into every seal.
   */
  readonly scope: string;

  /**
   * Iron-session secret or numeric version-to-secret rotation map.
   */
  readonly password: string | Readonly<Record<string, string>>;

  /**
   * Trusted application clock for exact expiry checks.
   */
  readonly clock: OpaqueSessionClock;

  /**
   * Positive safe lifetime in milliseconds.
   */
  readonly ttlMilliseconds: number;

  /**
   * Optional injected random source for session ID and generation.
   */
  readonly randomBytes?: OpaqueSessionRandom;

  /**
   * Existing bounded retry policy for random-ID collisions; defaults to three.
   */
  readonly collisionAttempts?: number;

  /**
   * Memory-only retained-session bound; defaults to 10,000.
   */
  readonly maxSessions?: number;
}

/**
 * Issuance outcome, including a sealed cookie on success.
 */
export type OpaqueSessionCreateResult =
  | {
      // prettier-ignore

      /**
       * Successful issuance through the selected store.
       */
      readonly kind: "created";

      /**
       * Sealed cookie credential.
       */
      readonly credential: CookieCredential;

      /**
       * Detached resolved session.
       */
      readonly session: ResolvedSession;
    }
  | {
      // prettier-ignore

      /**
       * Rejected issuance.
       */
      readonly kind: "rejected";

      /**
       * Application-level rejection reason.
       */
      readonly reason: "capacity-exceeded" | "entropy-exhausted" | "clock-failure" | "closed";
    };

/**
 * Rotation outcome, including a newly sealed cookie on success.
 */
export type OpaqueSessionRotateResult =
  | {
      // prettier-ignore

      /**
       * Successful atomic generation replacement.
       */
      readonly kind: "rotated";

      /**
       * Replacement sealed cookie credential.
       */
      readonly credential: CookieCredential;

      /**
       * Detached replacement session.
       */
      readonly session: ResolvedSession;
    }
  | {
      // prettier-ignore

      /**
       * Rejected rotation.
       */
      readonly kind: "rejected";

      /**
       * Application-level rejection reason.
       */
      readonly reason:
        | "not-found"
        | "expired"
        | "unsupported-credential"
        | "entropy-exhausted"
        | "clock-failure"
        | "closed";
    };

/**
 * Enumeration-safe logout acknowledgement.
 */
export interface OpaqueSessionLogoutResult {
  // prettier-ignore

  /**
   * Acknowledges logout without revealing session presence.
   */
  readonly kind: "logged-out";
}

/**
 * Sealed opaque credentials backed by atomic stable-reference transitions.
 */
export class OpaqueSessions implements SessionResolver {
  readonly #store: OpaqueSessionStore;

  readonly #internalStore: MemoryOpaqueSessionStore | undefined;

  readonly #scope: string;

  readonly #password: string | Record<string, string>;

  readonly #clock: OpaqueSessionClock;

  readonly #ttlMilliseconds: number;

  readonly #sealTtl: number;

  readonly #random: OpaqueSessionRandom;

  readonly #collisionAttempts: number;

  #closed = false;

  #active = 0;

  #drained: (() => void) | undefined;

  #closing: Promise<void> | undefined;

  /**
   * Binds already validated policy and an authoritative store.
   *
   * @param options Validated session policy.
   * @param store Selected atomic store.
   * @param internalStore Process-local store created by this strategy, if any.
   */
  private constructor(
    options: OpaqueSessionsOptions,
    store: OpaqueSessionStore,
    internalStore?: MemoryOpaqueSessionStore,
  ) {
    this.#store = store;
    this.#internalStore = internalStore;
    this.#scope = options.scope;
    this.#password = SessionPolicy.password(options.password);
    this.#clock = options.clock;
    this.#ttlMilliseconds = options.ttlMilliseconds;
    this.#sealTtl = Math.ceil(options.ttlMilliseconds / 1_000);
    this.#random = options.randomBytes ?? nodeRandomBytes;
    this.#collisionAttempts = options.collisionAttempts ?? 3;
  }

  /**
   * Validates sealing and lifetime policy before exposing a usable strategy.
   *
   * @param options Required application policy and optional store.
   * @returns Initialized opaque-session strategy.
   */
  static create(options: OpaqueSessionsOptions): Promise<OpaqueSessions> {
    return Promise.resolve().then(() => {
      if (typeof options.scope !== "string" || options.scope.length === 0)
        throw new TypeError("Opaque session scope must be nonempty.");
      SessionPolicy.password(options.password);
      SessionPolicy.positive(options.ttlMilliseconds, "ttlMilliseconds");
      SessionPolicy.positive(options.collisionAttempts ?? 3, "collisionAttempts");
      SessionPolicy.positive(options.maxSessions ?? 10_000, "maxSessions");
      if (options.store !== undefined && options.maxSessions !== undefined)
        throw new TypeError("maxSessions applies only when the memory store is selected.");
      const clock: unknown = options.clock;
      if (
        typeof clock !== "object" ||
        clock === null ||
        typeof Reflect.get(clock, "now") !== "function"
      )
        throw new TypeError("Session clock is required.");
      if (options.store !== undefined) return new OpaqueSessions(options, options.store);
      const memory = new MemoryOpaqueSessionStore(
        () => SessionPolicy.timestamp(options.clock.now()),
        options.maxSessions ?? 10_000,
      );
      return new OpaqueSessions(options, memory, memory);
    });
  }

  /**
   * Creates one sealed credential after an atomic absent insertion.
   *
   * @param principal Complete authenticated identity.
   * @param signal Optional cancellation.
   * @returns Issuance result; cancellation never returns a credential.
   */
  issue(
    principal: AuthenticatedPrincipal,
    signal?: AbortSignal,
  ): Promise<OpaqueSessionCreateResult> {
    if (this.#closed) return Promise.resolve({ kind: "rejected", reason: "closed" });
    return this.#run(() => this.#issue(principal, signal));
  }

  /**
   * Resolves only the current generation before its exact deadline.
   *
   * @param credentialInput Cookie credential to validate.
   * @param signal Optional cancellation.
   * @returns Detached session, or undefined for invalid or expired credentials.
   */
  resolve(
    credentialInput: RequestCredential,
    signal?: AbortSignal,
  ): Promise<ResolvedSession | undefined> {
    if (this.#closed || credentialInput.kind !== "cookie") return Promise.resolve(undefined);
    return this.#run(async () => {
      signal?.throwIfAborted();
      const seal = await this.#unseal(credentialInput.value);
      signal?.throwIfAborted();
      if (this.#closed) return undefined;
      if (seal === undefined || this.#expired(seal.expires)) return undefined;
      const record = await this.#store.read(seal.id, signal);
      signal?.throwIfAborted();
      if (this.#isClosed()) return undefined;
      if (
        record === undefined ||
        !this.#matches(record, seal) ||
        this.#expired(SessionRecords.expiry(record))
      )
        return undefined;
      return this.#resolved(record);
    });
  }

  /**
   * Creates a new generation before atomically replacing the current record.
   *
   * @param credentialInput Current cookie credential.
   * @param signal Optional cancellation.
   * @returns One winning replacement or a rejection.
   */
  rotate(
    credentialInput: RequestCredential,
    signal?: AbortSignal,
  ): Promise<OpaqueSessionRotateResult> {
    if (this.#closed) return Promise.resolve({ kind: "rejected", reason: "closed" });
    if (credentialInput.kind !== "cookie")
      return Promise.resolve({ kind: "rejected", reason: "unsupported-credential" });
    return this.#run(() => this.#rotate(credentialInput.value, signal));
  }

  /**
   * Removes the stable reference when the supplied seal is still live.
   *
   * @param credentialInput Cookie credential to revoke.
   * @param signal Optional cancellation.
   * @returns Enumeration-safe acknowledgement.
   */
  logout(
    credentialInput: RequestCredential,
    signal?: AbortSignal,
  ): Promise<OpaqueSessionLogoutResult> {
    if (this.#closed || credentialInput.kind !== "cookie")
      return Promise.resolve({ kind: "logged-out" });
    return this.#run(async () => {
      signal?.throwIfAborted();
      const seal = await this.#unseal(credentialInput.value);
      signal?.throwIfAborted();
      if (seal !== undefined && !this.#expired(seal.expires)) {
        await this.#store.revoke(seal.id, signal);
        signal?.throwIfAborted();
      }
      return { kind: "logged-out" };
    });
  }

  /**
   * Removes records at or before a trusted maintenance cutoff.
   *
   * @param cutoff Current-or-earlier exact deadline.
   * @param signal Optional maintenance cancellation.
   * @returns Number of conditionally removed records.
   */
  purgeExpired(cutoff: Timestamp, signal?: AbortSignal): Promise<number> {
    if (this.#closed) return Promise.reject(new Error("Session strategy is closed."));
    return this.#run(() => this.#store.purgeExpired(cutoff, signal));
  }

  /**
   * Closes new work and drains admitted work and compensation.
   *
   * @returns Repeatable close completion; injected stores remain open.
   */
  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    this.#closed = true;
    this.#closing = this.#finishClose();
    return this.#closing;
  }

  /**
   * Waits for admitted work and closes only internally created memory.
   *
   * @returns Completion after local resources are released.
   */
  async #finishClose(): Promise<void> {
    if (this.#active > 0) await new Promise<void>((resolve) => (this.#drained = resolve));
    await this.#internalStore?.close();
  }

  /**
   * Keeps asynchronous work admitted through all awaited transitions.
   *
   * @typeParam T Result produced by the admitted operation.
   * @param work Operation body.
   * @returns Operation outcome.
   */
  async #run<T>(work: () => Promise<T>): Promise<T> {
    this.#active += 1;
    try {
      return await work();
    } finally {
      this.#active -= 1;
      if (this.#active === 0) this.#drained?.();
    }
  }

  /**
   * Tries random stable references until an absent insert wins.
   *
   * @param principal Complete identity.
   * @param signal Optional cancellation.
   * @returns Issuance outcome.
   */
  async #issue(
    principal: AuthenticatedPrincipal,
    signal?: AbortSignal,
  ): Promise<OpaqueSessionCreateResult> {
    for (let attempt = 0; attempt < this.#collisionAttempts; attempt += 1) {
      signal?.throwIfAborted();
      if (this.#internalStore?.atCapacity())
        return { kind: "rejected", reason: "capacity-exceeded" };
      const candidate = this.#newRecord(principal);
      if (typeof candidate === "string") return { kind: "rejected", reason: candidate };
      const seal = await this.#seal(candidate);
      signal?.throwIfAborted();
      if (this.#closed) throw new Error("Session strategy closed.");
      let inserted = false;
      try {
        inserted = await this.#store.insert(candidate);
        if (signal?.aborted || this.#isClosed())
          throw signal?.reason ?? new Error("Session strategy closed.");
      } catch (error) {
        if (inserted && (signal?.aborted || this.#isClosed()))
          await this.#compensate(candidate, error);
        throw error;
      }
      if (inserted)
        return {
          kind: "created",
          credential: SessionPolicy.credential(seal),
          session: this.#resolved(candidate),
        };
    }
    return {
      kind: "rejected",
      reason: this.#internalStore?.atCapacity() ? "capacity-exceeded" : "entropy-exhausted",
    };
  }

  /**
   * Creates one complete candidate from trusted time and cryptographic bytes.
   *
   * @param principal Complete authenticated identity.
   * @returns Candidate record or a policy failure reason.
   */
  #newRecord(
    principal: AuthenticatedPrincipal,
  ): OpaqueSessionRecord | "clock-failure" | "entropy-exhausted" {
    const now = this.#now();
    if (now === undefined) return "clock-failure";
    const expires = this.#deadline(now);
    if (expires === undefined) return "clock-failure";
    const id = this.#randomValue();
    const generation = this.#randomValue();
    if (id === undefined || generation === undefined) return "entropy-exhausted";
    return create(OpaqueSessionRecordSchema, {
      id,
      generation,
      principal: SessionRecords.principal(principal),
      whenExpires: expires,
    });
  }

  /**
   * Removes only a newly issued expected record after late cancellation.
   *
   * @param record Candidate inserted session.
   * @param cause Cancellation or close failure.
   */
  async #compensate(record: OpaqueSessionRecord, cause: unknown): Promise<void> {
    try {
      await this.#store.remove(record);
    } catch (error) {
      throw new AggregateError([cause, error], "Session issuance compensation failed.");
    }
  }

  /**
   * Validates a current generation then performs one conditional replacement.
   *
   * @param credential Sealed cookie value.
   * @param signal Optional cancellation.
   * @returns Rotation outcome.
   */
  async #rotate(credential: string, signal?: AbortSignal): Promise<OpaqueSessionRotateResult> {
    signal?.throwIfAborted();
    const seal = await this.#unseal(credential);
    signal?.throwIfAborted();
    if (this.#closed) return { kind: "rejected", reason: "closed" };
    if (seal === undefined) return { kind: "rejected", reason: "not-found" };
    if (this.#expired(seal.expires)) return { kind: "rejected", reason: "expired" };
    const previous = await this.#store.read(seal.id, signal);
    signal?.throwIfAborted();
    if (this.#isClosed()) return { kind: "rejected", reason: "closed" };
    if (previous === undefined || !this.#matches(previous, seal))
      return { kind: "rejected", reason: "not-found" };
    if (this.#expired(SessionRecords.expiry(previous)))
      return { kind: "rejected", reason: "expired" };
    return this.#replace(previous, signal);
  }

  /**
   * Creates a new generation before the authoritative conditional update.
   *
   * @param previous Complete expected record.
   * @param signal Optional cancellation.
   * @returns Rotation outcome.
   */
  async #replace(
    previous: OpaqueSessionRecord,
    signal?: AbortSignal,
  ): Promise<OpaqueSessionRotateResult> {
    const candidate = this.#replacement(previous);
    if (typeof candidate === "string") return { kind: "rejected", reason: candidate };
    const next = candidate;
    const seal = await this.#seal(next);
    signal?.throwIfAborted();
    if (this.#closed) return { kind: "rejected", reason: "closed" };
    let replaced = false;
    try {
      replaced = await this.#store.replace(previous, next);
      if (signal?.aborted || this.#isClosed())
        throw signal?.reason ?? new Error("Session strategy closed.");
    } catch (error) {
      if (replaced && (signal?.aborted || this.#isClosed())) await this.#compensate(next, error);
      throw error;
    }
    return replaced
      ? {
          kind: "rotated",
          credential: SessionPolicy.credential(seal),
          session: this.#resolved(next),
        }
      : { kind: "rejected", reason: "not-found" };
  }

  /**
   * Creates a distinct generation with its exact replacement deadline.
   *
   * @param previous Current complete record.
   * @returns Replacement record or a policy failure reason.
   */
  #replacement(
    previous: OpaqueSessionRecord,
  ): OpaqueSessionRecord | "clock-failure" | "entropy-exhausted" {
    const now = this.#now();
    if (now === undefined) return "clock-failure";
    const expires = this.#deadline(now);
    if (expires === undefined) return "clock-failure";
    const generation = this.#randomValue();
    if (generation === undefined || generation === previous.generation) return "entropy-exhausted";
    return create(OpaqueSessionRecordSchema, { ...previous, generation, whenExpires: expires });
  }

  /**
   * Creates JSON-safe authenticated reference, generation, scope and deadline.
   *
   * @param record Complete record to bind.
   * @returns Iron-session seal.
   */
  #seal(record: OpaqueSessionRecord): Promise<string> {
    const expiry = SessionRecords.expiry(record);
    return sealData(
      {
        id: record.id,
        generation: record.generation,
        scope: this.#scope,
        seconds: expiry.seconds.toString(),
        nanos: expiry.nanos,
      },
      { password: this.#password, ttl: this.#sealTtl },
    );
  }

  /**
   * Unseals and validates a scoped JSON-safe payload.
   *
   * @param credential Candidate cookie value.
   * @returns Authenticated payload, if valid.
   */
  async #unseal(credential: string): Promise<SessionSeal | undefined> {
    const value: unknown = await unsealData(credential, {
      password: this.#password,
      ttl: this.#sealTtl,
    });
    if (typeof value !== "object" || value === null) return undefined;
    const fields = value as Record<string, unknown>;
    if (
      fields.scope !== this.#scope ||
      typeof fields.id !== "string" ||
      typeof fields.generation !== "string" ||
      typeof fields.seconds !== "string" ||
      typeof fields.nanos !== "number" ||
      !/^-?\d+$/.test(fields.seconds)
    )
      return undefined;
    try {
      return {
        id: fields.id,
        generation: fields.generation,
        expires: SessionRecords.deadline(
          create(TimestampSchema, {
            seconds: BigInt(fields.seconds),
            nanos: fields.nanos,
          }),
        ),
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Matches a seal to the current stored generation and exact expiry.
   *
   * @param record Current record.
   * @param seal Authenticated payload.
   * @returns Whether the payload still identifies this generation.
   */
  #matches(record: OpaqueSessionRecord, seal: SessionSeal): boolean {
    return (
      record.generation === seal.generation &&
      SessionRecords.compare(SessionRecords.expiry(record), seal.expires) === 0
    );
  }

  /**
   * Checks exact application expiry against the trusted clock.
   *
   * @param expires Exact authenticated deadline.
   * @returns Whether the deadline has arrived or clock failed.
   */
  #expired(expires: Timestamp): boolean {
    const now = this.#now();
    return now === undefined || SessionRecords.compare(expires, SessionPolicy.timestamp(now)) <= 0;
  }

  /**
   * Reads and validates a trusted clock value.
   *
   * @returns Safe milliseconds, if valid.
   */
  #now(): number | undefined {
    try {
      const value = this.#clock.now();
      if (!Number.isSafeInteger(value)) throw new Error("Invalid session clock.");
      SessionRecords.deadline(SessionPolicy.timestamp(value));
      return value;
    } catch {
      this.#closed = true;
      return undefined;
    }
  }

  /**
   * Reads closure after callbacks that can change lifecycle state.
   *
   * @returns Whether the strategy has closed.
   */
  #isClosed(): boolean {
    return this.#closed;
  }

  /**
   * Calculates one exact millisecond deadline without overflow.
   *
   * @param now Valid current milliseconds.
   * @returns Exact deadline if representable.
   */
  #deadline(now: number): Timestamp | undefined {
    const value = now + this.#ttlMilliseconds;
    if (!Number.isSafeInteger(value)) return undefined;
    try {
      return SessionRecords.deadline(SessionPolicy.timestamp(value));
    } catch {
      return undefined;
    }
  }

  /**
   * Generates and clears cryptographic bytes for an opaque reference.
   *
   * @returns Base64url random value when the source succeeds.
   */
  #randomValue(): string | undefined {
    let bytes: Uint8Array;
    try {
      bytes = this.#random(32);
    } catch {
      return undefined;
    }
    try {
      return bytes.byteLength === 32 ? Buffer.from(bytes).toString("base64url") : undefined;
    } finally {
      bytes.fill(0);
    }
  }

  /**
   * Copies authoritative stored identity and deadline for a caller.
   *
   * @param record Complete stored record.
   * @returns Detached resolved session.
   */
  #resolved(record: OpaqueSessionRecord): ResolvedSession {
    return Object.freeze({
      principal: SessionRecords.publicPrincipal(record),
      expiresAt: SessionRecords.expiry(record),
    });
  }
}

/**
 * Authenticated stable reference, generation, and exact application deadline.
 */
interface SessionSeal {
  readonly id: string;
  readonly generation: string;
  readonly expires: Timestamp;
}

/**
 * Validates session configuration and builds exact public values.
 */
const SessionPolicy = Object.freeze({
  /**
   * Validates a positive safe policy integer.
   *
   * @param value Candidate number.
   * @param name Option named in an error.
   * @returns Accepted number.
   */
  positive(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new RangeError(`${name} must be a positive safe integer.`);
    return value;
  },

  /**
   * Validates and snapshots every configured iron-session secret.
   *
   * @param value Secret or numeric version map.
   * @returns Detached validated configuration.
   */
  password(value: OpaqueSessionsOptions["password"]): string | Record<string, string> {
    if (typeof value === "string") {
      if (value.length < 32)
        throw new RangeError("Session password must have at least 32 characters.");
      return value;
    }
    const candidate: unknown = value;
    if (typeof candidate !== "object" || candidate === null || Object.keys(candidate).length === 0)
      throw new TypeError("Session password map must be nonempty.");
    const copy: Record<string, string> = {};
    for (const [key, secret] of Object.entries(candidate as Record<string, unknown>)) {
      if (!/^\d+$/.test(key) || !Number.isSafeInteger(Number(key)) || Number(key) <= 0)
        throw new TypeError("Session password IDs must be positive numeric integers.");
      if (typeof secret !== "string" || secret.length < 32)
        throw new RangeError("Every session password must have at least 32 characters.");
      copy[key] = secret;
    }
    return copy;
  },

  /**
   * Converts safe epoch milliseconds without losing subsecond precision.
   *
   * @param milliseconds Safe epoch millisecond value.
   * @returns Protobuf timestamp.
   */
  timestamp(milliseconds: number): Timestamp {
    const seconds = Math.floor(milliseconds / 1_000);
    return create(TimestampSchema, {
      seconds: BigInt(seconds),
      nanos: (milliseconds - seconds * 1_000) * 1_000_000,
    });
  },

  /**
   * Wraps a sealed value in an immutable cookie credential.
   *
   * @param value Iron-session seal.
   * @returns Cookie credential.
   */
  credential(value: string): CookieCredential {
    return Object.freeze({ kind: "cookie" as const, value });
  },
});
