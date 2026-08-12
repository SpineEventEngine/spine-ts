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

import { describe, expect, it } from "vitest";

import {
  OpaqueSessionCookies,
  OpaqueSessions,
  type AuthenticatedPrincipal,
} from "../../src/index.js";

function clock(start = 1_000) {
  let now = start;
  return { now: () => now, advance: (milliseconds: number) => (now += milliseconds) };
}

function random(...values: number[]) {
  return () => new Uint8Array(32).fill(values.shift() ?? 0);
}

describe("OpaqueSessions", () => {
  it("creates an opaque cookie credential and resolves defensive identity copies", async () => {
    const time = clock();
    const sessions = new OpaqueSessions({ clock: time, randomBytes: random(1) });
    const attributes = { role: "writer" };
    const created = await sessions.create({ id: "principal-1", attributes });

    expect(created).toMatchObject({ kind: "created", credential: { kind: "cookie" } });
    if (created.kind !== "created") throw new Error("expected a created session");
    expect(created.credential.value).toHaveLength(43);
    attributes.role = "reader";
    const resolved = await sessions.resolve(created.credential);
    expect(resolved?.principal).toEqual({ id: "principal-1", attributes: { role: "writer" } });
    expect(Object.isFrozen(resolved?.principal.attributes)).toBe(true);
  });

  it("expires, bounds capacity, rejects exhausted entropy, and closes terminally", async () => {
    const time = clock();
    const sessions = new OpaqueSessions({
      clock: time,
      randomBytes: random(1, 1, 1, 1),
      ttlMilliseconds: 10,
      maxSessions: 1,
      collisionAttempts: 3,
    });
    const first = await sessions.create({ id: "one" });
    expect(await sessions.create({ id: "two" })).toEqual({
      kind: "rejected",
      reason: "capacity-exceeded",
    });
    time.advance(10);
    expect(
      await sessions.resolve(
        first.kind === "created" ? first.credential : { kind: "cookie", value: "" },
      ),
    ).toBeUndefined();
    expect(await sessions.create({ id: "two" })).toMatchObject({ kind: "created" });

    const collisions = new OpaqueSessions({ randomBytes: random(2, 2, 2), collisionAttempts: 2 });
    await collisions.create({ id: "one" });
    expect(await collisions.create({ id: "two" })).toEqual({
      kind: "rejected",
      reason: "entropy-exhausted",
    });
    await collisions.close();
    expect(await collisions.create({ id: "three" })).toEqual({
      kind: "rejected",
      reason: "closed",
    });
  });

  it("rejects unsupported and expired rotation while zeroing generated random bytes", async () => {
    const time = clock();
    const generated = new Uint8Array(32).fill(9);
    const sessions = new OpaqueSessions({
      clock: time,
      randomBytes: () => generated,
      ttlMilliseconds: 1,
    });
    expect(await sessions.rotate({ kind: "bearer", value: "token" })).toEqual({
      kind: "rejected",
      reason: "unsupported-credential",
    });
    const created = await sessions.create({ id: "principal" });
    expect(generated).toEqual(new Uint8Array(32));
    if (created.kind !== "created") throw new Error("expected a created session");
    time.advance(1);
    expect(await sessions.rotate(created.credential)).toEqual({
      kind: "rejected",
      reason: "expired",
    });
  });

  it("rotates atomically and makes stale cookie replay and logout harmless", async () => {
    const sessions = new OpaqueSessions({ randomBytes: random(3, 4) });
    const created = await sessions.create({ id: "principal" });
    if (created.kind !== "created") throw new Error("expected a created session");
    const rotated = await sessions.rotate(created.credential);
    expect(rotated).toMatchObject({ kind: "rotated", credential: { kind: "cookie" } });
    if (rotated.kind !== "rotated") throw new Error("expected a rotated session");
    expect(await sessions.resolve(created.credential)).toBeUndefined();
    expect(await sessions.resolve(rotated.credential)).toMatchObject({
      principal: { id: "principal" },
    });
    expect(await sessions.logout(created.credential)).toEqual({ kind: "logged-out" });
    expect(await sessions.resolve(rotated.credential)).toBeDefined();
    expect(await sessions.logout(rotated.credential)).toEqual({ kind: "logged-out" });
    expect(await sessions.logout(rotated.credential)).toEqual({ kind: "logged-out" });
  });

  it("preserves the old session when rotation cannot obtain a distinct ID and closes every outcome", async () => {
    const sessions = new OpaqueSessions({ randomBytes: random(5, 5), collisionAttempts: 1 });
    const created = await sessions.create({ id: "principal" });
    if (created.kind !== "created") throw new Error("expected a created session");
    expect(await sessions.rotate(created.credential)).toEqual({
      kind: "rejected",
      reason: "entropy-exhausted",
    });
    expect(await sessions.resolve(created.credential)).toBeDefined();
    await sessions.close();
    expect(await sessions.resolve(created.credential)).toBeUndefined();
    expect(await sessions.rotate(created.credential)).toEqual({
      kind: "rejected",
      reason: "closed",
    });
    expect(await sessions.logout(created.credential)).toEqual({ kind: "logged-out" });
  });

  it("validates finite positive construction inputs and fixed random byte length", async () => {
    for (const options of [
      { ttlMilliseconds: 0 },
      { maxSessions: Number.POSITIVE_INFINITY },
      { collisionAttempts: -1 },
    ]) {
      expect(() => new OpaqueSessions(options)).toThrow("positive safe integer");
    }
    const shortBuffer = new Uint8Array(31).fill(9);
    const sessions = new OpaqueSessions({ randomBytes: () => shortBuffer });
    await expect(sessions.create({ id: "principal" })).resolves.toEqual({
      kind: "rejected",
      reason: "entropy-exhausted",
    });
    expect(shortBuffer).toEqual(new Uint8Array(31));
  });

  it("fails closed on invalid clocks and bounded entropy failures, including pre-epoch expiry", async () => {
    const throwing = new OpaqueSessions({
      clock: {
        now: () => {
          throw new Error("clock");
        },
      },
    });
    expect(await throwing.create({ id: "principal" })).toEqual({
      kind: "rejected",
      reason: "clock-failure",
    });
    expect(await throwing.resolve({ kind: "cookie", value: "a".repeat(43) })).toBeUndefined();
    const entropy = new OpaqueSessions({
      randomBytes: () => {
        throw new Error("entropy");
      },
    });
    expect(await entropy.create({ id: "principal" })).toEqual({
      kind: "rejected",
      reason: "entropy-exhausted",
    });
    const preEpoch = new OpaqueSessions({ clock: { now: () => -1 }, randomBytes: random(8) });
    const created = await preEpoch.create({ id: "principal" });
    expect(created).toMatchObject({
      kind: "created",
      session: { expiresAt: { nanos: 999_000_000 } },
    });
  });

  it("fails closed when the second create clock read throws", async () => {
    let reads = 0;
    const sessions = new OpaqueSessions({
      clock: {
        now: () => {
          reads += 1;
          if (reads === 4) throw new Error("second create read failed");
          return 1_000;
        },
      },
      randomBytes: random(9, 10),
    });

    const created = await sessions.create({ id: "principal" });
    if (created.kind !== "created") throw new Error("expected a created session");
    expect(await sessions.create({ id: "clock-failure" })).toEqual({
      kind: "rejected",
      reason: "clock-failure",
    });
    expect(await sessions.resolve(created.credential)).toBeUndefined();
    expect(await sessions.rotate(created.credential)).toEqual({
      kind: "rejected",
      reason: "closed",
    });
    expect(await sessions.create({ id: "after-clock-failure" })).toEqual({
      kind: "rejected",
      reason: "closed",
    });
  });

  it("fails closed when a maximum Timestamp clock plus TTL exceeds its range", async () => {
    let reads = 0;
    const sessions = new OpaqueSessions({
      clock: {
        now: () => {
          reads += 1;
          return reads <= 2 ? 253_402_300_799_997 : 253_402_300_799_998;
        },
      },
      randomBytes: random(11, 12),
      ttlMilliseconds: 2,
    });

    const created = await sessions.create({ id: "principal" });
    if (created.kind !== "created") throw new Error("expected a created session");
    expect(await sessions.create({ id: "clock-failure" })).toEqual({
      kind: "rejected",
      reason: "clock-failure",
    });
    expect(await sessions.resolve(created.credential)).toBeUndefined();
    expect(await sessions.rotate(created.credential)).toEqual({
      kind: "rejected",
      reason: "closed",
    });
    expect(await sessions.create({ id: "after-clock-failure" })).toEqual({
      kind: "rejected",
      reason: "closed",
    });
  });

  it("revalidates create and rotate state after reentrant randomness", async () => {
    let calls = 0;
    const sessions: OpaqueSessions = new OpaqueSessions({
      maxSessions: 1,
      randomBytes: () => {
        calls += 1;
        if (calls === 1) void sessions.create({ id: "nested" });
        return new Uint8Array(32).fill(calls);
      },
    });
    expect(await sessions.create({ id: "outer" })).toEqual({
      kind: "rejected",
      reason: "capacity-exceeded",
    });

    let rotationCalls = 0;
    const rotating: OpaqueSessions = new OpaqueSessions({
      randomBytes: () => {
        rotationCalls += 1;
        if (rotationCalls === 2) void rotating.logout(credential);
        return new Uint8Array(32).fill(rotationCalls);
      },
    });
    const created = await rotating.create({ id: "principal" });
    if (created.kind !== "created") throw new Error("expected a created session");
    const credential = created.credential;
    expect(await rotating.rotate(created.credential)).toEqual({
      kind: "rejected",
      reason: "not-found",
    });
  });

  it("does not insert a copied record when a reentrant principal getter closes the store", async () => {
    const sessions = new OpaqueSessions({ randomBytes: random(15) });
    const principal: AuthenticatedPrincipal = {
      get id(): string {
        void sessions.close();
        return "principal";
      },
    };

    await expect(sessions.create(principal)).resolves.toEqual({
      kind: "rejected",
      reason: "closed",
    });
  });

  it("rechecks capacity and expiry when random callbacks advance the clock", async () => {
    const time = clock();
    let calls = 0;
    let nested: ReturnType<OpaqueSessions["create"]> | undefined;
    const creating: OpaqueSessions = new OpaqueSessions({
      clock: time,
      maxSessions: 1,
      ttlMilliseconds: 1,
      randomBytes: () => {
        calls += 1;
        if (calls === 1) {
          nested = creating.create({ id: "nested" });
          time.advance(1);
        }
        return new Uint8Array(32).fill(calls);
      },
    });
    const outer = await creating.create({ id: "outer" });
    expect(outer).toMatchObject({
      kind: "created",
      session: { principal: { id: "outer" } },
    });
    if (nested === undefined || outer.kind !== "created")
      throw new Error("expected created sessions");
    const nestedResult = await nested;
    if (nestedResult.kind !== "created") throw new Error("expected a nested session");
    expect(await creating.resolve(nestedResult.credential)).toBeUndefined();
    expect(await creating.resolve(outer.credential)).toMatchObject({
      principal: { id: "outer" },
    });

    const rotationTime = clock();
    let rotationCalls = 0;
    const rotating: OpaqueSessions = new OpaqueSessions({
      clock: rotationTime,
      ttlMilliseconds: 1,
      randomBytes: () => {
        rotationCalls += 1;
        if (rotationCalls === 2) rotationTime.advance(1);
        return new Uint8Array(32).fill(rotationCalls);
      },
    });
    const created = await rotating.create({ id: "principal" });
    if (created.kind !== "created") throw new Error("expected a created session");
    expect(await rotating.rotate(created.credential)).toEqual({
      kind: "rejected",
      reason: "expired",
    });
    expect(await rotating.resolve(created.credential)).toBeUndefined();
  });

  it("rejects create and rotation after reentrant randomness closes the terminal store", async () => {
    const creating: OpaqueSessions = new OpaqueSessions({
      randomBytes: () => {
        void creating.close();
        return new Uint8Array(32).fill(11);
      },
    });
    expect(await creating.create({ id: "outer" })).toEqual({ kind: "rejected", reason: "closed" });
    expect(await creating.create({ id: "after-close" })).toEqual({
      kind: "rejected",
      reason: "closed",
    });

    let calls = 0;
    const rotating: OpaqueSessions = new OpaqueSessions({
      randomBytes: () => {
        calls += 1;
        if (calls === 2) void rotating.close();
        return new Uint8Array(32).fill(calls);
      },
    });
    const created = await rotating.create({ id: "principal" });
    if (created.kind !== "created") throw new Error("expected a created session");

    expect(await rotating.rotate(created.credential)).toEqual({
      kind: "rejected",
      reason: "closed",
    });
    expect(await rotating.resolve(created.credential)).toBeUndefined();
    expect(await rotating.create({ id: "after-close" })).toEqual({
      kind: "rejected",
      reason: "closed",
    });
  });

  it("uses synchronous call order for non-awaited rotation, logout, and resolution", async () => {
    const rotateTwice = new OpaqueSessions({ randomBytes: random(12, 13, 14) });
    const firstCreated = await rotateTwice.create({ id: "rotate-twice" });
    if (firstCreated.kind !== "created") throw new Error("expected a created session");
    const firstRotation = rotateTwice.rotate(firstCreated.credential);
    const secondRotation = rotateTwice.rotate(firstCreated.credential);
    const firstRotated = await firstRotation;
    expect(firstRotated).toMatchObject({ kind: "rotated", credential: { kind: "cookie" } });
    expect(await secondRotation).toEqual({ kind: "rejected", reason: "not-found" });
    if (firstRotated.kind !== "rotated") throw new Error("expected a rotated session");
    expect(await rotateTwice.resolve(firstCreated.credential)).toBeUndefined();
    expect(await rotateTwice.resolve(firstRotated.credential)).toMatchObject({
      principal: { id: "rotate-twice" },
    });

    const logoutThenRotate = new OpaqueSessions({ randomBytes: random(15, 16) });
    const secondCreated = await logoutThenRotate.create({ id: "logout-rotate" });
    if (secondCreated.kind !== "created") throw new Error("expected a created session");
    const logout = logoutThenRotate.logout(secondCreated.credential);
    const rejectedRotation = logoutThenRotate.rotate(secondCreated.credential);
    expect(await logout).toEqual({ kind: "logged-out" });
    expect(await rejectedRotation).toEqual({ kind: "rejected", reason: "not-found" });
    expect(await logoutThenRotate.resolve(secondCreated.credential)).toBeUndefined();

    const resolveThenRotate = new OpaqueSessions({ randomBytes: random(17, 18) });
    const thirdCreated = await resolveThenRotate.create({ id: "resolve-rotate" });
    if (thirdCreated.kind !== "created") throw new Error("expected a created session");
    const resolvedBeforeRotate = resolveThenRotate.resolve(thirdCreated.credential);
    const rotatedAfterResolve = resolveThenRotate.rotate(thirdCreated.credential);
    expect(await resolvedBeforeRotate).toMatchObject({ principal: { id: "resolve-rotate" } });
    const thirdRotated = await rotatedAfterResolve;
    expect(thirdRotated).toMatchObject({ kind: "rotated", credential: { kind: "cookie" } });
    if (thirdRotated.kind !== "rotated") throw new Error("expected a rotated session");
    expect(await resolveThenRotate.resolve(thirdCreated.credential)).toBeUndefined();
    expect(await resolveThenRotate.resolve(thirdRotated.credential)).toMatchObject({
      principal: { id: "resolve-rotate" },
    });

    const resolveThenLogout = new OpaqueSessions({ randomBytes: random(19) });
    const fourthCreated = await resolveThenLogout.create({ id: "resolve-logout" });
    if (fourthCreated.kind !== "created") throw new Error("expected a created session");
    const resolvedBeforeLogout = resolveThenLogout.resolve(fourthCreated.credential);
    const logoutAfterResolve = resolveThenLogout.logout(fourthCreated.credential);
    expect(await resolvedBeforeLogout).toMatchObject({ principal: { id: "resolve-logout" } });
    expect(await logoutAfterResolve).toEqual({ kind: "logged-out" });
    expect(await resolveThenLogout.resolve(fourthCreated.credential)).toBeUndefined();
  });
});

describe("OpaqueSessionCookies", () => {
  const secret = new Uint8Array(32).fill(7);
  const origin = "https://app.example.test";

  it("serializes frozen host-only cookies and accepts a valid CSRF-protected cookie request", () => {
    const cookies = new OpaqueSessionCookies({ csrfSecret: secret, origins: [origin] });
    const id = "a".repeat(43);
    const issued = cookies.issue(id);
    const cleared = cookies.clear();
    expect(issued).toEqual([
      `__Host-spine-session=${id}; Path=/; Secure; HttpOnly; SameSite=Lax`,
      `__Host-spine-csrf=${cookies.csrf(id)}; Path=/; Secure; SameSite=Lax`,
    ]);
    expect(cleared).toEqual([
      "__Host-spine-session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0",
      "__Host-spine-csrf=; Path=/; Secure; SameSite=Lax; Max-Age=0",
    ]);
    expect(Object.isFrozen(issued)).toBe(true);
    expect(Object.isFrozen(cleared)).toBe(true);
    expect(
      cookies.extract({
        cookie: `__Host-spine-session=${id}; __Host-spine-csrf=${cookies.csrf(id)}`,
        origin,
        "x-spine-csrf": cookies.csrf(id),
      }),
    ).toEqual({ kind: "cookie", value: id });
  });

  it("requires exact session ID length for derivation, issuance, and extraction", () => {
    const cookies = new OpaqueSessionCookies({ csrfSecret: secret, origins: [origin] });
    for (const id of ["a".repeat(42), "a".repeat(44), "=".repeat(43)]) {
      expect(() => cookies.csrf(id)).toThrow("43-character unpadded base64url session ID");
      expect(() => cookies.issue(id)).toThrow("43-character unpadded base64url session ID");
    }
    expect(
      cookies.extract({
        cookie: `__Host-spine-session=${"a".repeat(42)}; __Host-spine-csrf=${"a".repeat(43)}`,
      }),
    ).toEqual({ kind: "rejected", reason: "malformed-cookie" });
  });

  it("copies its secret, validates canonical custom configuration, and rejects terminal methods", async () => {
    const copiedSecret = new Uint8Array(32).fill(3);
    const cookies = new OpaqueSessionCookies({
      csrfSecret: copiedSecret,
      origins: ["https://app.example.test"],
      sessionCookieName: "__Host-session",
      csrfCookieName: "__Host-csrf",
    });
    const id = "a".repeat(43);
    const beforeMutation = cookies.csrf(id);
    copiedSecret.fill(9);
    expect(cookies.csrf(id)).toBe(beforeMutation);
    expect(cookies.issue(id)[0]).toMatch(/^__Host-session=/);
    expect(
      () => new OpaqueSessionCookies({ csrfSecret: new Uint8Array(31), origins: [origin] }),
    ).toThrow("at least 32 bytes");
    expect(() => new OpaqueSessionCookies({ csrfSecret: secret, origins: [`${origin}/`] })).toThrow(
      "canonical Origins",
    );
    expect(
      () =>
        new OpaqueSessionCookies({
          csrfSecret: secret,
          origins: [origin],
          sessionCookieName: "cookie",
        }),
    ).toThrow("valid __Host- cookie name");
    await cookies.close();
    for (const operation of [
      () => cookies.csrf(id),
      () => cookies.issue(id),
      () => cookies.clear(),
    ]) {
      expect(operation).toThrow("closed");
    }
  });

  it("gives present bearer headers precedence and rejects duplicate or malformed browser facts", () => {
    const cookies = new OpaqueSessionCookies({ csrfSecret: secret, origins: [origin] });
    expect(cookies.extract({ authorization: "Bearer abc" })).toEqual({
      kind: "bearer",
      value: "abc",
    });
    expect(cookies.extract({ authorization: ["Bearer abc", "Bearer def"] })).toEqual({
      kind: "rejected",
      reason: "duplicate-authorization",
    });
    expect(cookies.extract({ authorization: "Basic abc" })).toEqual({
      kind: "rejected",
      reason: "malformed-authorization",
    });
    expect(cookies.extract({ cookie: "__Host-spine-session=a; __Host-spine-session=b" })).toEqual({
      kind: "rejected",
      reason: "ambiguous-cookie",
    });
    expect(cookies.extract({ cookie: "bad,pair" })).toEqual({
      kind: "rejected",
      reason: "malformed-cookie",
    });
    expect(cookies.extract({})).toEqual({ kind: "rejected", reason: "missing-credential" });
    const id = "a".repeat(43);
    expect(
      cookies.extract({
        cookie: `__Host-spine-session=${id}; __Host-spine-csrf=${cookies.csrf(id)}`,
      }),
    ).toEqual({
      kind: "rejected",
      reason: "missing-origin",
    });
  });

  it("rejects invalid session encodings and duplicate Origins before resolving a cookie credential", () => {
    const cookies = new OpaqueSessionCookies({ csrfSecret: secret, origins: [origin] });
    expect(
      cookies.extract({
        cookie:
          "__Host-spine-session=a; __Host-spine-csrf=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).toEqual({ kind: "rejected", reason: "malformed-cookie" });
    const id = "a".repeat(43);
    expect(
      cookies.extract({
        cookie: `__Host-spine-session=${id}; __Host-spine-csrf=${cookies.csrf(id)}`,
        origin: [origin, origin],
        "x-spine-csrf": cookies.csrf(id),
      }),
    ).toEqual({ kind: "rejected", reason: "duplicate-origin" });
  });

  it("rejects noncanonical origins, duplicate CSRF headers, mismatches, and terminal use", async () => {
    const cookies = new OpaqueSessionCookies({ csrfSecret: secret, origins: [origin] });
    const id = "a".repeat(43);
    const cookie = `__Host-spine-session=${id}; __Host-spine-csrf=${cookies.csrf(id)}`;
    expect(
      cookies.extract({ cookie, origin: `${origin}/`, "x-spine-csrf": cookies.csrf(id) }),
    ).toEqual({
      kind: "rejected",
      reason: "forbidden-origin",
    });
    expect(
      cookies.extract({ cookie, origin, "x-spine-csrf": [cookies.csrf(id), cookies.csrf(id)] }),
    ).toEqual({
      kind: "rejected",
      reason: "duplicate-csrf",
    });
    expect(cookies.extract({ cookie, origin, "x-spine-csrf": "x".repeat(43) })).toEqual({
      kind: "rejected",
      reason: "csrf-mismatch",
    });
    await cookies.close();
    expect(cookies.extract({ authorization: "Bearer abc" })).toEqual({
      kind: "rejected",
      reason: "closed",
    });
  });

  it("bounds request parsing and accepts unrelated padded cookie values", () => {
    const cookies = new OpaqueSessionCookies({
      csrfSecret: secret,
      origins: [origin],
      maxHeaderValues: 1,
      maxHeaderCharacters: 40,
      maxCookiePairs: 1,
    });
    expect(cookies.extract({ authorization: ["Bearer one", "Bearer two"] })).toEqual({
      kind: "rejected",
      reason: "request-too-large",
    });
    expect(
      cookies.extract({ authorization: "Bearer this-token-is-too-long-for-the-limit" }),
    ).toEqual({
      kind: "rejected",
      reason: "request-too-large",
    });
    expect(cookies.extract({ cookie: "theme=a=b; language=en" })).toEqual({
      kind: "rejected",
      reason: "request-too-large",
    });
    const id = "a".repeat(43);
    const roomy = new OpaqueSessionCookies({
      csrfSecret: secret,
      origins: [origin],
      maxCookiePairs: 3,
    });
    expect(
      roomy.extract({
        cookie: `theme=a=b; __Host-spine-session=${id}; __Host-spine-csrf=${roomy.csrf(id)}`,
        origin,
        "x-spine-csrf": roomy.csrf(id),
      }),
    ).toEqual({ kind: "cookie", value: id });
  });

  it("charges own supplied header fields before inspecting values and stops at the limit", () => {
    const cookies = new OpaqueSessionCookies({
      csrfSecret: secret,
      origins: [origin],
      maxHeaderValues: 1,
    });
    const headers: Record<string, string | undefined> = { first: undefined };
    Object.defineProperty(headers, "second", {
      enumerable: true,
      get: () => {
        throw new Error("must not inspect values after the field limit");
      },
    });
    const inherited = { authorization: "Bearer ignored" };
    Object.setPrototypeOf(headers, inherited);
    expect(cookies.extract(headers)).toEqual({ kind: "rejected", reason: "request-too-large" });
  });
});
