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
import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";

import { OpaqueSessionCookies, OpaqueSessions, MemoryOpaqueSessionStore } from "../../src/index.js";

const password = "opaque session test password is at least 32 characters";

function clock(start = Date.now()) {
  let now = start;
  return { now: () => now, advance: (milliseconds: number) => (now += milliseconds) };
}

function options(time = clock()) {
  return { scope: "orders-browser", password, ttlMilliseconds: 60_000, clock: time };
}

describe("OpaqueSessions", () => {
  it("requires valid sealing policy before constructing", async () => {
    await expect(OpaqueSessions.create({ ...options(), password: "short" })).rejects.toThrow(
      "32 characters",
    );
    await expect(OpaqueSessions.create({ ...options(), scope: "" })).rejects.toThrow("scope");
    await expect(OpaqueSessions.create({ ...options(), ttlMilliseconds: 0 })).rejects.toThrow(
      "positive safe integer",
    );
    await expect(
      OpaqueSessions.create({ ...options(), password: { alpha: password } }),
    ).rejects.toThrow("numeric integers");
    await expect(
      OpaqueSessions.create({ ...options(), password: { "1": "short" } }),
    ).rejects.toThrow("32 characters");
    await expect(
      OpaqueSessions.create({ ...options(), clock: undefined as never }),
    ).rejects.toThrow("Session clock is required");
    await expect(
      OpaqueSessions.create({
        ...options(),
        maxSessions: 1,
        store: new MemoryOpaqueSessionStore(),
      }),
    ).rejects.toThrow("memory store");
  });

  it("keeps the memory-only capacity until explicit expiry maintenance", async () => {
    const time = clock(1_000);
    const sessions = await OpaqueSessions.create({
      ...options(time),
      ttlMilliseconds: 10,
      maxSessions: 1,
    });
    const first = await sessions.issue({ id: "one" });
    expect(first.kind).toBe("created");
    time.advance(10);
    expect(await sessions.issue({ id: "two" })).toEqual({
      kind: "rejected",
      reason: "capacity-exceeded",
    });
    expect(
      await sessions.purgeExpired(create(TimestampSchema, { seconds: 1n, nanos: 10_000_000 })),
    ).toBe(1);
    expect((await sessions.issue({ id: "two" })).kind).toBe("created");
    await sessions.close();
  });

  it("bounds entropy failures and clears each mutable random buffer", async () => {
    const generated = new Uint8Array(32).fill(9);
    const sessions = await OpaqueSessions.create({
      ...options(),
      randomBytes: () => generated,
      collisionAttempts: 1,
    });
    expect((await sessions.issue({ id: "one" })).kind).toBe("created");
    expect(generated).toEqual(new Uint8Array(32));
    const short = await OpaqueSessions.create({
      ...options(),
      randomBytes: () => new Uint8Array(31),
      collisionAttempts: 1,
    });
    expect(await short.issue({ id: "two" })).toEqual({
      kind: "rejected",
      reason: "entropy-exhausted",
    });
    const collided = await OpaqueSessions.create({
      ...options(),
      randomBytes: () => new Uint8Array(32).fill(1),
      collisionAttempts: 1,
    });
    expect((await collided.issue({ id: "first" })).kind).toBe("created");
    expect(await collided.issue({ id: "second" })).toEqual({
      kind: "rejected",
      reason: "entropy-exhausted",
    });
    await sessions.close();
    await short.close();
    await collided.close();
  });

  it("rejects unsupported and expired rotations", async () => {
    const time = clock();
    const sessions = await OpaqueSessions.create({ ...options(time), ttlMilliseconds: 10 });
    expect(await sessions.rotate({ kind: "bearer", value: "token" })).toEqual({
      kind: "rejected",
      reason: "unsupported-credential",
    });
    const issued = await sessions.issue({ id: "principal" });
    if (issued.kind !== "created") throw new Error("expected issuance");
    time.advance(10);
    expect(await sessions.rotate(issued.credential)).toEqual({
      kind: "rejected",
      reason: "expired",
    });
    await sessions.close();
  });

  it("keeps the prior generation when replacement entropy repeats", async () => {
    const sessions = await OpaqueSessions.create({
      ...options(),
      randomBytes: () => new Uint8Array(32).fill(4),
      collisionAttempts: 1,
    });
    const issued = await sessions.issue({ id: "principal" });
    if (issued.kind !== "created") throw new Error("expected issuance");
    expect(await sessions.rotate(issued.credential)).toEqual({
      kind: "rejected",
      reason: "entropy-exhausted",
    });
    expect(await sessions.resolve(issued.credential)).toBeDefined();
    await sessions.close();
  });

  it("fails closed after an invalid trusted-clock reading", async () => {
    const sessions = await OpaqueSessions.create({
      ...options(),
      clock: { now: () => Number.NaN },
    });
    expect(await sessions.issue({ id: "one" })).toEqual({
      kind: "rejected",
      reason: "clock-failure",
    });
    expect(await sessions.issue({ id: "two" })).toEqual({ kind: "rejected", reason: "closed" });
    await sessions.close();
  });

  it("fails closed when the trusted clock throws after prior issuance", async () => {
    let fails = false;
    const sessions = await OpaqueSessions.create({
      ...options(),
      clock: {
        now: () => {
          if (fails) throw new Error("clock unavailable");
          return Date.now();
        },
      },
    });
    const issued = await sessions.issue({ id: "principal" });
    if (issued.kind !== "created") throw new Error("expected issuance");
    fails = true;
    expect(await sessions.resolve(issued.credential)).toBeUndefined();
    expect(await sessions.issue({ id: "new" })).toEqual({ kind: "rejected", reason: "closed" });
    await sessions.close();
  });

  it("rejects deadlines beyond the full Timestamp range without issuing a seal", async () => {
    const maximum = 253_402_300_799_999;
    const time = clock(maximum - 500);
    const sessions = await OpaqueSessions.create({ ...options(time), ttlMilliseconds: 1_000 });
    expect(await sessions.issue({ id: "principal" })).toEqual({
      kind: "rejected",
      reason: "clock-failure",
    });
    await sessions.close();
  });

  it("rejects a rotation whose new deadline exceeds the Timestamp range", async () => {
    const maximum = 253_402_300_799_999;
    const time = clock(maximum - 1_500);
    const sessions = await OpaqueSessions.create({ ...options(time), ttlMilliseconds: 1_000 });
    const issued = await sessions.issue({ id: "principal" });
    if (issued.kind !== "created") throw new Error("expected issuance");
    time.advance(600);
    expect(await sessions.rotate(issued.credential)).toEqual({
      kind: "rejected",
      reason: "clock-failure",
    });
    expect(await sessions.resolve(issued.credential)).toBeDefined();
    await sessions.close();
  });

  it("copies principal attributes and refuses a tampered or unsupported credential", async () => {
    const sessions = await OpaqueSessions.create(options());
    const attributes = { role: "writer" };
    const issued = await sessions.issue({ id: "principal", attributes });
    if (issued.kind !== "created") throw new Error("expected issuance");
    attributes.role = "reader";
    expect((await sessions.resolve(issued.credential))?.principal).toEqual({
      id: "principal",
      attributes: { role: "writer" },
    });
    const tampered = `X${issued.credential.value.slice(1)}`;
    expect(await sessions.resolve({ kind: "cookie", value: tampered })).toBeUndefined();
    expect(
      await sessions.resolve({ kind: "bearer", value: issued.credential.value }),
    ).toBeUndefined();
    await sessions.close();
  });

  it("uses the exact deadline and keeps old expired logout from revoking a fresh login", async () => {
    const time = clock();
    const sessions = await OpaqueSessions.create({ ...options(time), ttlMilliseconds: 10 });
    const old = await sessions.issue({ id: "principal" });
    if (old.kind !== "created") throw new Error("expected issuance");
    time.advance(10);
    const fresh = await sessions.issue({ id: "principal" });
    if (fresh.kind !== "created") throw new Error("expected issuance");
    await sessions.logout(old.credential);
    expect(await sessions.resolve(fresh.credential)).toBeDefined();
    await sessions.close();
  });

  it("closes terminally and clears internally selected memory", async () => {
    const sessions = await OpaqueSessions.create(options());
    const issued = await sessions.issue({ id: "principal" });
    if (issued.kind !== "created") throw new Error("expected issuance");
    await sessions.close();
    expect(await sessions.issue({ id: "other" })).toEqual({ kind: "rejected", reason: "closed" });
    expect(await sessions.resolve(issued.credential)).toBeUndefined();
    expect(await sessions.rotate(issued.credential)).toEqual({
      kind: "rejected",
      reason: "closed",
    });
    expect(await sessions.logout(issued.credential)).toEqual({ kind: "logged-out" });
    await expect(sessions.purgeExpired(create(TimestampSchema, { seconds: 1n }))).rejects.toThrow(
      "closed",
    );
    await sessions.close();
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
