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

import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";

import { SignedSessions, type AuthenticatedPrincipal } from "../../src/index.js";

function keys() {
  return generateKeyPairSync("ec", { namedCurve: "prime256v1" });
}
function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (milliseconds: number) => (now += milliseconds) };
}
function token(key: ReturnType<typeof keys>["privateKey"], header: unknown, claims: unknown) {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const input = `${encodedHeader}.${encodedClaims}`;
  return signedInput(key, input);
}
function signedInput(key: KeyObject, input: string, signature?: Uint8Array) {
  const bytes =
    signature ??
    sign("sha256", Buffer.from(input), {
      key,
      dsaEncoding: "ieee-p1363",
    });
  return `${input}.${Buffer.from(bytes).toString("base64url")}`;
}
function without(value: Record<string, unknown>, name: string) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== name));
}
function headerOf(credential: { readonly value: string }) {
  const [header] = credential.value.split(".");
  if (header === undefined) throw new Error("missing JWT header");
  return JSON.parse(Buffer.from(header, "base64url").toString()) as Record<string, unknown>;
}

describe("SignedSessions", () => {
  it("issues an exact ES256 bearer JWT and resolves defensive principal copies", async () => {
    const time = clock();
    const key = keys();
    const sessions = new SignedSessions({
      issuer: "gateway",
      audience: "browser",
      activeKey: { kid: "key-1", privateKey: key.privateKey },
      clock: time,
      randomBytes: () => new Uint8Array(16).fill(7),
    });
    const attributes = { role: "writer" };
    const issued = await sessions.issue({ id: "principal", attributes });
    expect(issued).toMatchObject({ kind: "issued", credential: { kind: "bearer" } });
    if (issued.kind !== "issued") throw new Error("expected issued");
    const [header, payload, signature] = issued.credential.value.split(".");
    if (header === undefined || payload === undefined || signature === undefined)
      throw new Error("expected three JWT segments");
    expect([header, payload, signature]).toHaveLength(3);
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "ES256",
      typ: "JWT",
      kid: "key-1",
    });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toMatchObject({
      iss: "gateway",
      aud: "browser",
      sub: "principal",
      iat: 1000,
      nbf: 1000,
      exp: 29800,
    });
    expect(Buffer.from(signature, "base64url")).toHaveLength(64);
    attributes.role = "reader";
    expect((await sessions.resolve(issued.credential))?.principal).toEqual({
      id: "principal",
      attributes: { role: "writer" },
    });
  });

  it("fails closed for malformed tokens, claim confusion, signatures, and terminal state", async () => {
    const key = keys();
    const sessions = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "a", privateKey: key.privateKey },
    });
    const issued = await sessions.issue({ id: "principal" });
    if (issued.kind !== "issued") throw new Error("expected issued");
    for (const value of [
      "a.b",
      "a..b",
      `${issued.credential.value}.`,
      `${issued.credential.value.slice(0, -1)}${issued.credential.value.endsWith("x") ? "y" : "x"}`,
    ])
      await expect(sessions.resolve({ kind: "bearer", value })).resolves.toBeUndefined();
    await sessions.close();
    expect(await sessions.issue({ id: "principal" })).toEqual({
      kind: "rejected",
      reason: "closed",
    });
    expect(await sessions.resolve(issued.credential)).toBeUndefined();
  });

  it("rejects a non-canonical ES256 signature segment with altered unused base64url bits", async () => {
    const key = keys();
    const sessions = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "a", privateKey: key.privateKey },
    });
    const issued = await sessions.issue({ id: "principal" });
    if (issued.kind !== "issued") throw new Error("expected issued");
    const segments = issued.credential.value.split(".");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const [header, payload, signature] = segments;
    const lastCharacter = signature?.at(-1);
    if (
      header === undefined ||
      payload === undefined ||
      signature === undefined ||
      lastCharacter === undefined
    )
      throw new Error("expected a three-part JWT");
    const last = alphabet.indexOf(lastCharacter);
    const replacement = alphabet[(last & 0b11_0000) | ((last + 1) & 0b1111)];
    if (replacement === undefined) throw new Error("expected a replacement base64url character");
    const altered = `${signature.slice(0, -1)}${replacement}`;
    await expect(
      sessions.resolve({ kind: "bearer", value: `${header}.${payload}.${altered}` }),
    ).resolves.toBeUndefined();
  });

  it("retains the old public key through the finite rotation deadline and rejects excess capacity", async () => {
    const time = clock();
    const first = keys();
    const second = keys();
    const third = keys();
    const sessions = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "one", privateKey: first.privateKey },
      clock: time,
      ttlSeconds: 2,
      clockSkewSeconds: 1,
      maxKeys: 2,
    });
    const issued = await sessions.issue({ id: "principal" });
    if (issued.kind !== "issued") throw new Error("expected issued");
    expect(await sessions.rotate({ kid: "two", privateKey: second.privateKey })).toEqual({
      kind: "rotated",
    });
    expect(await sessions.resolve(issued.credential)).toBeDefined();
    time.advance(3_000);
    expect(await sessions.resolve(issued.credential)).toBeDefined();
    time.advance(1);
    expect(await sessions.resolve(issued.credential)).toBeUndefined();
    expect(await sessions.rotate({ kid: "one", privateKey: first.privateKey })).toEqual({
      kind: "rotated",
    });
    expect(await sessions.rotate({ kid: "three", privateKey: third.privateKey })).toEqual({
      kind: "rejected",
      reason: "key-capacity-exceeded",
    });
  });

  it("rejects invalid rotations atomically and preserves the active key", async () => {
    const first = keys();
    const second = keys();
    const wrongCurve = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
    const sessions = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "one", privateKey: first.privateKey },
      maxKeys: 1,
    });
    expect(await sessions.rotate({ kid: "one", privateKey: second.privateKey })).toEqual({
      kind: "rejected",
      reason: "duplicate-key",
    });
    expect(await sessions.rotate({ kid: "wrong", privateKey: wrongCurve.privateKey })).toEqual({
      kind: "rejected",
      reason: "invalid-key",
    });
    expect(await sessions.rotate({ kid: "two", privateKey: second.privateKey })).toEqual({
      kind: "rejected",
      reason: "key-capacity-exceeded",
    });
    const issued = await sessions.issue({ id: "principal" });
    if (issued.kind !== "issued") throw new Error("expected issued");
    expect(headerOf(issued.credential).kid).toBe("one");
  });

  it("preserves the active key when a retention deadline cannot be represented", async () => {
    const first = keys();
    const second = keys();
    const values = [1_000_000, 253_402_300_799_000, 1_000_000, 1_000_000];
    const sessions = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "one", privateKey: first.privateKey },
      clock: { now: () => values.shift() ?? 1_000_000 },
    });
    expect(await sessions.rotate({ kid: "two", privateKey: second.privateKey })).toEqual({
      kind: "rejected",
      reason: "clock-failure",
    });
    const issued = await sessions.issue({ id: "principal" });
    if (issued.kind !== "issued") throw new Error("expected issued");
    expect(headerOf(issued.credential).kid).toBe("one");
  });

  it("lets terminal close win reentrant randomness and rotation callbacks", async () => {
    const key = keys();
    const randomSessions = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "random", privateKey: key.privateKey },
      randomBytes: () => {
        void randomSessions.close();
        return new Uint8Array(16);
      },
    });
    expect(await randomSessions.issue({ id: "principal" })).toEqual({
      kind: "rejected",
      reason: "closed",
    });
    const failingRandom = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "random-failure", privateKey: key.privateKey },
      randomBytes: () => {
        void failingRandom.close();
        throw new Error("late entropy failure");
      },
    });
    expect(await failingRandom.issue({ id: "principal" })).toEqual({
      kind: "rejected",
      reason: "closed",
    });
    const invalidRandom = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "random-invalid", privateKey: key.privateKey },
      randomBytes: () => {
        void invalidRandom.close();
        return new Uint8Array(15);
      },
    });
    expect(await invalidRandom.issue({ id: "principal" })).toEqual({
      kind: "rejected",
      reason: "closed",
    });

    const next = keys();
    let calls = 0;
    const rotatingSessions = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "one", privateKey: key.privateKey },
      clock: {
        now: () => {
          calls += 1;
          if (calls === 2) void rotatingSessions.close();
          return 1_000_000;
        },
      },
    });
    expect(await rotatingSessions.rotate({ kid: "two", privateKey: next.privateKey })).toEqual({
      kind: "rejected",
      reason: "closed",
    });
    expect(await rotatingSessions.resolve({ kind: "bearer", value: "unused" })).toBeUndefined();
    const failingClock = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "clock-issue", privateKey: key.privateKey },
      clock: {
        now: () => {
          void failingClock.close();
          throw new Error("late clock failure");
        },
      },
    });
    expect(await failingClock.issue({ id: "principal" })).toEqual({
      kind: "rejected",
      reason: "closed",
    });
    const invalidRotationClock = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "clock-rotation", privateKey: key.privateKey },
      clock: {
        now: () => {
          void invalidRotationClock.close();
          return Number.NaN;
        },
      },
    });
    expect(await invalidRotationClock.rotate({ kid: "next", privateKey: next.privateKey })).toEqual(
      {
        kind: "rejected",
        reason: "closed",
      },
    );
  });

  it("gives initially retired keys the same finite retention deadline", async () => {
    const time = clock();
    const retired = keys();
    const active = keys();
    const issuer = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "retired", privateKey: retired.privateKey },
      clock: time,
      ttlSeconds: 2,
      clockSkewSeconds: 1,
    });
    const issued = await issuer.issue({ id: "principal" });
    if (issued.kind !== "issued") throw new Error("expected issued");
    const verifier = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "active", privateKey: active.privateKey },
      retiredKeys: [{ kid: "retired", publicKey: retired.publicKey }],
      clock: time,
      ttlSeconds: 2,
      clockSkewSeconds: 1,
    });
    expect(await verifier.resolve(issued.credential)).toBeDefined();
    time.advance(3_001);
    expect(await verifier.resolve(issued.credential)).toBeUndefined();
  });

  it("uses optional revocation without turning invalid logout into an oracle", async () => {
    const key = keys();
    const revoked = new Set<string>();
    const sessions = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "one", privateKey: key.privateKey },
      revocation: {
        kind: "supported",
        isRevoked: (jti) => Promise.resolve(revoked.has(jti)),
        revoke: (jti) => {
          revoked.add(jti);
          return Promise.resolve();
        },
      },
    });
    const issued = await sessions.issue({ id: "principal" });
    if (issued.kind !== "issued") throw new Error("expected issued");
    expect(await sessions.logout(issued.credential)).toEqual({ kind: "revoked" });
    expect(await sessions.resolve(issued.credential)).toBeUndefined();
    expect(await sessions.logout({ kind: "bearer", value: "not-a-token" })).toEqual({
      kind: "expiryOnly",
    });
  });

  it("distinguishes expiry-only logout from revocation failure without validating bad input", async () => {
    const key = keys();
    const base = {
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "one", privateKey: key.privateKey },
    };
    const expiryOnly = new SignedSessions(base);
    const issued = await expiryOnly.issue({ id: "principal" });
    if (issued.kind !== "issued") throw new Error("expected issued");
    expect(await expiryOnly.logout(issued.credential)).toEqual({ kind: "expiryOnly" });
    expect(await expiryOnly.resolve(issued.credential)).toBeDefined();

    let revokeCalls = 0;
    const unavailable = new SignedSessions({
      ...base,
      revocation: {
        kind: "supported",
        isRevoked: () => Promise.resolve(false),
        revoke: () => {
          revokeCalls += 1;
          throw new Error("store unavailable");
        },
      },
    });
    const unavailableToken = await unavailable.issue({ id: "principal" });
    if (unavailableToken.kind !== "issued") throw new Error("expected issued");
    expect(await unavailable.logout({ kind: "bearer", value: "invalid" })).toEqual({
      kind: "expiryOnly",
    });
    expect(revokeCalls).toBe(0);
    expect(await unavailable.logout(unavailableToken.credential)).toEqual({
      kind: "unavailable",
    });
    expect(revokeCalls).toBe(1);
  });

  it("fails closed on revocation lookup errors and terminal close races", async () => {
    const key = keys();
    const base = {
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "one", privateKey: key.privateKey },
    };
    const lookupFailure = new SignedSessions({
      ...base,
      revocation: {
        kind: "supported",
        isRevoked: () => {
          throw new Error("store unavailable");
        },
        revoke: () => Promise.resolve(),
      },
    });
    const failedLookupToken = await lookupFailure.issue({ id: "principal" });
    if (failedLookupToken.kind !== "issued") throw new Error("expected issued");
    expect(await lookupFailure.resolve(failedLookupToken.credential)).toBeUndefined();

    const resolving = new SignedSessions({
      ...base,
      revocation: {
        kind: "supported",
        isRevoked: async () => {
          await resolving.close();
          return false;
        },
        revoke: () => Promise.resolve(),
      },
    });
    const resolvingToken = await resolving.issue({ id: "principal" });
    if (resolvingToken.kind !== "issued") throw new Error("expected issued");
    expect(await resolving.resolve(resolvingToken.credential)).toBeUndefined();

    const loggingOut = new SignedSessions({
      ...base,
      revocation: {
        kind: "supported",
        isRevoked: () => Promise.resolve(false),
        revoke: async () => {
          await loggingOut.close();
          throw new Error("late failure");
        },
      },
    });
    const logoutToken = await loggingOut.issue({ id: "principal" });
    if (logoutToken.kind !== "issued") throw new Error("expected issued");
    expect(await loggingOut.logout(logoutToken.credential)).toEqual({ kind: "expiryOnly" });
    await expect(loggingOut.close()).resolves.toBeUndefined();
  });

  it("validates construction, principals, entropy, clocks, and issuance bounds", async () => {
    const key = keys();
    for (const options of [
      { issuer: "", audience: "aud" },
      { issuer: "issuer", audience: "" },
      { issuer: "issuer", audience: "aud", ttlSeconds: 0 },
      { issuer: "issuer", audience: "aud", clockSkewSeconds: -1 },
      { issuer: "issuer", audience: "aud", maxTokenCharacters: 0 },
      { issuer: "issuer", audience: "aud", maxKeys: 0 },
      { issuer: "issuer", audience: "aud", maxPrincipalIdCharacters: 0 },
      { issuer: "issuer", audience: "aud", maxAttributes: -1 },
      { issuer: "issuer", audience: "aud", maxAttributeCharacters: -1 },
    ])
      expect(
        () =>
          new SignedSessions({ ...options, activeKey: { kid: "key", privateKey: key.privateKey } }),
      ).toThrow();
    const other = keys();
    expect(
      () =>
        new SignedSessions({
          issuer: "issuer",
          audience: "aud",
          activeKey: { kid: "key", privateKey: key.privateKey },
          retiredKeys: [{ kid: "other", publicKey: other.publicKey }],
          maxKeys: 1,
        }),
    ).toThrow("maxKeys exceeded");
    expect(
      () =>
        new SignedSessions({
          issuer: "issuer",
          audience: "aud",
          activeKey: { kid: "key", privateKey: key.privateKey },
          retiredKeys: [{ kid: "key", publicKey: other.publicKey }],
        }),
    ).toThrow("duplicate kid");
    const wrongCurve = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
    expect(
      () =>
        new SignedSessions({
          issuer: "issuer",
          audience: "aud",
          activeKey: { kid: "wrong", privateKey: wrongCurve.privateKey },
        }),
    ).toThrow("P-256 private key required");
    const bytes = new Uint8Array(15).fill(4);
    const entropy = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "key", privateKey: key.privateKey },
      randomBytes: () => bytes,
    });
    expect(await entropy.issue({ id: "principal" })).toEqual({
      kind: "rejected",
      reason: "entropy-failure",
    });
    expect(bytes).toEqual(new Uint8Array(15));
    const bounded = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "key-2", privateKey: key.privateKey },
      maxPrincipalIdCharacters: 2,
      maxAttributes: 1,
      maxAttributeCharacters: 3,
    });
    for (const principal of [
      { id: "long" },
      { id: "ok", attributes: { a: "bc", d: "e" } },
      { id: "ok", attributes: { name: "long" } },
    ])
      expect(await bounded.issue(principal)).toEqual({
        kind: "rejected",
        reason: "principal-invalid",
      });
    const guardedAttributes = Object.defineProperty({}, "later", {
      enumerable: true,
      get: () => {
        throw new Error("must not inspect an attribute after the bound");
      },
    });
    const noAttributes = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "key-guard", privateKey: key.privateKey },
      maxAttributes: 0,
    });
    expect(await noAttributes.issue({ id: "ok", attributes: guardedAttributes })).toEqual({
      kind: "rejected",
      reason: "principal-invalid",
    });
    const hostilePrincipal: AuthenticatedPrincipal = {
      get id(): string {
        throw new Error("hostile principal");
      },
    };
    let hostileIssue: ReturnType<SignedSessions["issue"]> | undefined;
    expect(() => {
      hostileIssue = noAttributes.issue(hostilePrincipal);
    }).not.toThrow();
    await expect(hostileIssue).resolves.toEqual({
      kind: "rejected",
      reason: "principal-invalid",
    });
    const clockFailure = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "key-3", privateKey: key.privateKey },
      clock: { now: () => Number.NaN },
    });
    expect(await clockFailure.issue({ id: "ok" })).toEqual({
      kind: "rejected",
      reason: "clock-failure",
    });
  });

  it("rejects strict signed header, parser, and temporal claim confusion", async () => {
    const key = keys();
    const time = clock();
    const sessions = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "key", privateKey: key.privateKey },
      clock: time,
      ttlSeconds: 10,
      clockSkewSeconds: 1,
      maxTokenCharacters: 300,
    });
    const claims = {
      iss: "issuer",
      aud: "aud",
      sub: "principal",
      iat: 1000,
      nbf: 1000,
      exp: 1010,
      jti: "abcdefghijklmnopqrstuv",
    };
    for (const value of [
      "a".repeat(301),
      "@@@.@@@.@@@",
      token(key.privateKey, { alg: "none", typ: "JWT", kid: "key" }, claims),
      token(key.privateKey, { alg: "ES256", typ: "JWS", kid: "key" }, claims),
      token(key.privateKey, { alg: "ES256", typ: "JWT", kid: "key", x: true }, claims),
      token(key.privateKey, { alg: "ES256", typ: "JWT", kid: "unknown" }, claims),
      token(key.privateKey, { alg: "ES256", typ: "JWT", kid: "key" }, { ...claims, aud: "wrong" }),
      token(key.privateKey, { alg: "ES256", typ: "JWT", kid: "key" }, { ...claims, exp: 1011 }),
    ])
      await expect(sessions.resolve({ kind: "bearer", value })).resolves.toBeUndefined();
    const exact = token(key.privateKey, { alg: "ES256", typ: "JWT", kid: "key" }, claims);
    expect(await sessions.resolve({ kind: "cookie", value: exact })).toBeUndefined();
    expect(await sessions.resolve({ kind: "bearer", value: exact })).toMatchObject({
      principal: { id: "principal" },
    });
    time.advance(11_001);
    expect(await sessions.resolve({ kind: "bearer", value: exact })).toBeUndefined();
  });

  it("rejects every missing, extra, and wrong-type security claim", async () => {
    const key = keys();
    const sessions = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "key", privateKey: key.privateKey },
      clock: clock(),
      ttlSeconds: 10,
      clockSkewSeconds: 1,
    });
    const header = { alg: "ES256", typ: "JWT", kid: "key" };
    const claims: Record<string, unknown> = {
      iss: "issuer",
      aud: "aud",
      sub: "principal",
      iat: 1000,
      nbf: 1000,
      exp: 1010,
      jti: "abcdefghijklmnopqrstuv",
    };
    const invalid = [
      ...["iss", "aud", "sub", "iat", "nbf", "exp", "jti"].map((name) => without(claims, name)),
      { ...claims, extra: true },
      { ...claims, iss: 1 },
      { ...claims, aud: ["aud"] },
      { ...claims, sub: 1 },
      { ...claims, iat: "1000" },
      { ...claims, nbf: 1_000.5 },
      { ...claims, exp: null },
      { ...claims, jti: 1 },
      { ...claims, jti: "" },
      { ...claims, jti: "a" },
      { ...claims, attributes: [] },
      { ...claims, attributes: { role: 1 } },
    ];
    for (const candidate of invalid) {
      await expect(
        sessions.resolve({ kind: "bearer", value: token(key.privateKey, header, candidate) }),
      ).resolves.toBeUndefined();
    }
  });

  it("rejects malformed header JSON and every invalid signature length", async () => {
    const key = keys();
    const sessions = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "key", privateKey: key.privateKey },
      clock: clock(),
      ttlSeconds: 10,
    });
    const claims = {
      iss: "issuer",
      aud: "aud",
      sub: "principal",
      iat: 1000,
      nbf: 1000,
      exp: 1010,
      jti: "abcdefghijklmnopqrstuv",
    };
    const invalidHeaders = [
      null,
      [],
      "header",
      {},
      { alg: "ES256", typ: "JWT" },
      { alg: "ES256", typ: "JWT", kid: 1 },
      { alg: "ES256", typ: "JWT", kid: "" },
    ];
    for (const header of invalidHeaders) {
      await expect(
        sessions.resolve({
          kind: "bearer",
          value: token(key.privateKey, header, claims),
        }),
      ).resolves.toBeUndefined();
    }
    const encodedHeader = Buffer.from(
      JSON.stringify({ alg: "ES256", typ: "JWT", kid: "key" }),
    ).toString("base64url");
    const encodedClaims = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const input = `${encodedHeader}.${encodedClaims}`;
    for (const length of [0, 1, 63, 65]) {
      await expect(
        sessions.resolve({
          kind: "bearer",
          value: signedInput(key.privateKey, input, new Uint8Array(length)),
        }),
      ).resolves.toBeUndefined();
    }
    await expect(
      sessions.resolve({
        kind: "bearer",
        value: signedInput(key.privateKey, input, new Uint8Array(64).fill(1)),
      }),
    ).resolves.toBeUndefined();
  });

  it("applies issuer, audience, ordering, lifetime, and exact skew boundaries", async () => {
    const key = keys();
    const sessions = new SignedSessions({
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "key", privateKey: key.privateKey },
      clock: clock(),
      ttlSeconds: 10,
      clockSkewSeconds: 1,
    });
    const header = { alg: "ES256", typ: "JWT", kid: "key" };
    const base = {
      iss: "issuer",
      aud: "aud",
      sub: "principal",
      iat: 1000,
      nbf: 1000,
      exp: 1010,
      jti: "abcdefghijklmnopqrstuv",
    };
    for (const claims of [
      { ...base, iss: "other" },
      { ...base, aud: "other" },
      { ...base, iat: 1002, nbf: 1002 },
      { ...base, iat: 1001, nbf: 1000 },
      { ...base, exp: 1000 },
      { ...base, exp: 1011 },
      { ...base, iat: 989, nbf: 989, exp: 998 },
    ]) {
      await expect(
        sessions.resolve({ kind: "bearer", value: token(key.privateKey, header, claims) }),
      ).resolves.toBeUndefined();
    }
    for (const claims of [
      base,
      { ...base, iat: 1001, nbf: 1001 },
      { ...base, iat: 989, nbf: 989, exp: 999 },
    ]) {
      await expect(
        sessions.resolve({ kind: "bearer", value: token(key.privateKey, header, claims) }),
      ).resolves.toBeDefined();
    }
  });

  it("enforces token output size and exact skew boundaries", async () => {
    const key = keys();
    const time = clock();
    const options = {
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "key", privateKey: key.privateKey },
      clock: time,
      ttlSeconds: 10,
      clockSkewSeconds: 1,
    };
    const tooSmall = new SignedSessions({ ...options, maxTokenCharacters: 10 });
    expect(await tooSmall.issue({ id: "principal" })).toEqual({
      kind: "rejected",
      reason: "signing-failure",
    });
    const sessions = new SignedSessions(options);
    const header = { alg: "ES256", typ: "JWT", kid: "key" };
    const base = {
      iss: "issuer",
      aud: "aud",
      sub: "principal",
      iat: 1000,
      jti: "abcdefghijklmnopqrstuv",
    };
    const accepted = token(key.privateKey, header, { ...base, nbf: 1001, exp: 1010 });
    expect(await sessions.resolve({ kind: "bearer", value: accepted })).toBeDefined();
    const future = token(key.privateKey, header, { ...base, nbf: 1002, exp: 1010 });
    const expired = token(key.privateKey, header, { ...base, nbf: 1000, exp: 999 });
    const malformed = [
      token(key.privateKey, header, null),
      token(key.privateKey, header, []),
      token(key.privateKey, header, { ...base, nbf: "1000", exp: 1010 }),
      future,
      expired,
    ];
    for (const value of malformed)
      await expect(sessions.resolve({ kind: "bearer", value })).resolves.toBeUndefined();
  });

  it("fails closed for injected entropy failures", async () => {
    const key = keys();
    const base = {
      issuer: "issuer",
      audience: "aud",
      activeKey: { kid: "key", privateKey: key.privateKey },
    };
    const entropy = new SignedSessions({
      ...base,
      randomBytes: () => {
        throw new Error("entropy");
      },
    });
    expect(await entropy.issue({ id: "p" })).toEqual({
      kind: "rejected",
      reason: "entropy-failure",
    });
  });
});
