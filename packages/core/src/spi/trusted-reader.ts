/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Application identity established by a configured authentication port.
 */
export interface TrustedReaderPrincipal {
  /**
   * Application-defined identity, distinct from an ActorContext user ID.
   */
  readonly id: string;

  /**
   * Detached attributes returned by the configured authenticator.
   */
  readonly attributes?: Readonly<Record<string, string>>;
}

/**
 * JSON-compatible authority value returned by an application authority port.
 */
export type AuthorityFact =
  | string
  | number
  | boolean
  | null
  | readonly AuthorityFact[]
  | Readonly<{ [name: string]: AuthorityFact }>;

/**
 * Per-invocation identity and authority facts established by trusted ports.
 * Absence of a principal is valid for deliberately public admission.
 *
 * @internal
 */
export interface TrustedReaderContext {
  /**
   * Verified application principal when this invocation authenticated a reader.
   */
  readonly principal?: TrustedReaderPrincipal;

  /**
   * Application-provided authority facts, independent of provider credentials.
   */
  readonly authorityFacts?: Readonly<Record<string, AuthorityFact>>;
}

/**
 * Stable subscription identity; authority facts are deliberately excluded.
 */
export type ReaderIdentity =
  | Readonly<{
      /**
       * Distinguishes a verified principal from explicit anonymous admission.
       */
      kind: "principal";

      /**
       * Stable identifier retained across reconnects.
       */
      id: string;
    }>
  | Readonly<{
      /**
       * Marks a deliberately public reader without a principal.
       */
      kind: "anonymous";
    }>;

/**
 * Maps verified invocation facts to a stable subscription identity.
 */
export const ReaderIdentities: Readonly<{
  /**
   * Converts verified invocation facts to a stable subscription identity.
   *
   * @param reader The verified reader facts for this operation.
   * @returns The principal ID or explicit anonymous binding.
   */
  from(reader: TrustedReaderContext): ReaderIdentity;

  /**
   * Checks whether a verified reader matches a retained binding.
   *
   * @param expected Persisted identity, possibly absent in a legacy record.
   * @param actual Verified invocation identity.
   * @returns Whether this reader may continue the subscription.
   */
  matches(expected: ReaderIdentity | undefined, actual: ReaderIdentity): boolean;

  /**
   * Compares two optional retained reader identities.
   *
   * @param left First stored reader identity.
   * @param right Second stored reader identity.
   * @returns Whether both identities are equal, including legacy absence.
   */
  same(left: ReaderIdentity | undefined, right: ReaderIdentity | undefined): boolean;
}> = Object.freeze({
  /**
   * Selects the stable reader identity without persisting changing authority facts.
   *
   * @param reader Verified invocation context.
   * @returns Principal ID or explicit anonymous admission.
   */
  from(reader: TrustedReaderContext): ReaderIdentity {
    const snapshot = snapshotTrustedReader(reader);
    return snapshot.principal === undefined
      ? Object.freeze({ kind: "anonymous" })
      : Object.freeze({ kind: "principal", id: snapshot.principal.id });
  },

  /**
   * Rejects missing legacy bindings and any different principal.
   *
   * @param expected Persisted identity, possibly absent in a legacy record.
   * @param actual Verified invocation identity.
   * @returns Whether this reader may continue the subscription.
   */
  matches(expected: ReaderIdentity | undefined, actual: ReaderIdentity): boolean {
    return (
      expected?.kind === actual.kind &&
      (expected.kind === "anonymous" || (actual.kind === "principal" && expected.id === actual.id))
    );
  },

  /**
   * Compares two optional stored identities, including two absent legacy values.
   *
   * @param left First stored reader identity.
   * @param right Second stored reader identity.
   * @returns Whether both identities are equal, including legacy absence.
   */
  same(left: ReaderIdentity | undefined, right: ReaderIdentity | undefined): boolean {
    return left === undefined
      ? right === undefined
      : right !== undefined && ReaderIdentities.matches(left, right);
  },
});

/**
 * Snapshots verified reader data before it crosses asynchronous or process boundaries.
 *
 * @param reader Trusted result of authentication and authority resolution.
 * @returns Frozen detached facts without copying the transport credential.
 * @internal
 */
const TrustedReaderSnapshots = Object.freeze({
  /**
   * Copies verified reader facts into a frozen detached value.
   *
   * @param reader The verified reader facts for this operation.
   * @returns Detached principal and authority facts.
   */
  snapshot(reader: TrustedReaderContext): TrustedReaderContext {
    const principal = reader.principal;
    if (principal === undefined && reader.authorityFacts !== undefined)
      throw new Error("Public reader cannot carry authenticated authority facts.");
    if (principal !== undefined && (typeof principal.id !== "string" || !principal.id.trim()))
      throw new Error("Trusted reader principal ID must be non-blank.");
    const attributes =
      principal?.attributes === undefined
        ? undefined
        : TrustedReaderSnapshots.copyAttributes(principal.attributes);
    const authorityFacts =
      reader.authorityFacts === undefined
        ? undefined
        : TrustedReaderSnapshots.copyAuthorityFacts(reader.authorityFacts);
    return Object.freeze({
      ...(principal === undefined
        ? {}
        : {
            principal: Object.freeze({
              id: principal.id,
              ...(attributes === undefined ? {} : { attributes }),
            }),
          }),
      ...(authorityFacts === undefined ? {} : { authorityFacts }),
    });
  },

  /**
   * Snapshots a string-valued fact map without admitting inherited or non-string values.
   *
   * @param facts Trusted application fact map.
   * @returns Frozen own string entries.
   */
  copyAttributes(facts: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
    const entries: [string, string][] = [];
    for (const [name, value] of Object.entries(facts)) {
      if (typeof value !== "string") throw new Error("Trusted reader facts must be strings.");
      entries.push([name, value]);
    }
    return Object.freeze(Object.fromEntries(entries));
  },

  /**
   * Copies JSON-compatible authority facts while rejecting cycles and special objects.
   *
   * @param facts Trusted application authority facts; null is rejected at runtime.
   * @returns Frozen detached JSON fact tree.
   */
  copyAuthorityFacts(
    facts: Readonly<Record<string, AuthorityFact>> | null,
  ): Readonly<Record<string, AuthorityFact>> {
    const seen = new WeakSet<object>();
    const copy = (value: unknown): AuthorityFact => {
      if (value === null || typeof value === "string" || typeof value === "boolean") return value;
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value !== "object" || seen.has(value))
        throw new Error("Authority facts must be finite JSON values.");
      if (
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      )
        throw new Error("Authority facts must be plain JSON values.");
      seen.add(value);
      const copied = Array.isArray(value)
        ? value.map((entry: unknown) => copy(entry))
        : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copy(entry)]));
      seen.delete(value);
      return Object.freeze(copied);
    };
    if (facts === null || Array.isArray(facts) || typeof facts !== "object")
      throw new Error("Authority facts must be a JSON object.");
    return copy(facts) as Readonly<Record<string, AuthorityFact>>;
  },
});

/**
 * Public SPI alias for the grouped immutable reader snapshot operation.
 */
export const snapshotTrustedReader: (reader: TrustedReaderContext) => TrustedReaderContext =
  TrustedReaderSnapshots.snapshot;
