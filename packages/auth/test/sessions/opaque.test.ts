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

import { describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { parseCookie, parseSetCookie } from "cookie";

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
  it("does not admit a monitored stale generation after rotation", async () => {
    const sessions = await OpaqueSessions.create(options());
    const issued = await sessions.issue({ id: "principal" });
    if (issued.kind !== "created") throw new Error("expected issuance");
    const rotated = await sessions.rotate(issued.credential);
    if (rotated.kind !== "rotated") throw new Error("expected rotation");
    const lifetime = new AbortController();
    expect(await sessions.resolve(issued.credential, lifetime.signal)).toBeUndefined();
    expect((await sessions.resolve(rotated.credential, lifetime.signal))?.principal.id).toBe(
      "principal",
    );
    lifetime.abort();
    await sessions.close();
  });

  it("registers a lifetime before the authoritative read and stops it after logout", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    class PausedStore extends MemoryOpaqueSessionStore {
      override async read(id: string, signal?: AbortSignal) {
        const captured = await super.read(id, signal);
        entered.resolve(undefined);
        await release.promise;
        return captured;
      }
    }
    const sessions = await OpaqueSessions.create({ ...options(), store: new PausedStore() });
    const issued = await sessions.issue({ id: "principal" });
    if (issued.kind !== "created") throw new Error("expected issuance");
    const lifetime = new AbortController();
    const pending = sessions.resolve(issued.credential, lifetime.signal);
    await entered.promise;
    expect(await sessions.logout(issued.credential)).toEqual({ kind: "logged-out" });
    release.resolve(undefined);
    expect(await pending).toBeUndefined();
    await sessions.close();
  });

  it("stops local output while preserving a durable logout failure", async () => {
    class FailingRevoke extends MemoryOpaqueSessionStore {
      override revoke(): Promise<boolean> {
        return Promise.reject(new Error("store unavailable"));
      }
    }
    const sessions = await OpaqueSessions.create({ ...options(), store: new FailingRevoke() });
    const issued = await sessions.issue({ id: "principal" });
    if (issued.kind !== "created") throw new Error("expected issuance");
    const operation = new AbortController();
    const resolved = await sessions.resolve(issued.credential, operation.signal);
    await expect(sessions.logout(issued.credential)).rejects.toThrow("store unavailable");
    expect(resolved?.invalidated?.aborted).toBe(true);
    expect(await sessions.resolve(issued.credential)).toBeDefined();
    await sessions.close();
  });

  it("invalidates existing operations before close drains a paused authoritative read", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    let pause = false;
    class PausedStore extends MemoryOpaqueSessionStore {
      override async read(id: string, signal?: AbortSignal) {
        const captured = await super.read(id, signal);
        if (pause) {
          entered.resolve(undefined);
          await release.promise;
        }
        return captured;
      }
    }
    const sessions = await OpaqueSessions.create({ ...options(), store: new PausedStore() });
    const issued = await sessions.issue({ id: "principal" });
    if (issued.kind !== "created") throw new Error("expected issuance");
    const operation = new AbortController();
    const first = await sessions.resolve(issued.credential, operation.signal);
    pause = true;
    const pending = sessions.resolve(issued.credential, new AbortController().signal);
    await entered.promise;
    const closing = sessions.close();
    expect(first?.invalidated?.aborted).toBe(true);
    let settled = false;
    void closing.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release.resolve(undefined);
    expect(await pending).toBeUndefined();
    await closing;
  });

  it("invalidates a monitored session on logout and exact expiry, without monitoring one-shot reads", async () => {
    vi.useFakeTimers();
    try {
      const time = clock(1_000);
      const sessions = await OpaqueSessions.create({ ...options(time), ttlMilliseconds: 20 });
      const issued = await sessions.issue({ id: "principal" });
      if (issued.kind !== "created") throw new Error("expected issuance");
      expect((await sessions.resolve(issued.credential))?.invalidated).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
      const lifetime = new AbortController();
      const resolved = await sessions.resolve(issued.credential, lifetime.signal);
      expect(resolved?.invalidated?.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(1);
      await sessions.logout(issued.credential);
      expect(resolved?.invalidated?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      const second = await sessions.issue({ id: "second" });
      if (second.kind !== "created") throw new Error("expected issuance");
      const secondLifetime = new AbortController();
      const active = await sessions.resolve(second.credential, secondLifetime.signal);
      if (active === undefined) throw new Error("expected monitored session");
      expect(vi.getTimerCount()).toBe(1);
      active.expiresAt.seconds += 10_000n;
      time.advance(20);
      await vi.advanceTimersByTimeAsync(20);
      expect(active.invalidated?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      await sessions.close();
    } finally {
      vi.useRealTimers();
    }
  });

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
  const cookieDeadline = create(TimestampSchema, { seconds: 1_700_000_060n });

  it("binds CSRF to the whole sealed credential and round-trips cookie v2 syntax", async () => {
    const time = clock(1_700_000_000_000);
    const sessions = await OpaqueSessions.create(options(time));
    const issued = await sessions.issue({ id: "browser-user" });
    if (issued.kind !== "created") throw new Error("expected issued session");
    const cookies = new OpaqueSessionCookies({ csrfSecret: secret, origins: [origin] });
    const pair = cookies.issue(issued.credential.value, issued.session.expiresAt);
    const session = parseSetCookie(pair[0] ?? "");
    const csrf = parseSetCookie(pair[1] ?? "");
    expect(issued.credential.value.length).toBeGreaterThan(43);
    expect(session).toMatchObject({
      name: "__Host-spine-session",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
    });
    expect(csrf).toMatchObject({
      name: "__Host-spine-csrf",
      path: "/",
      secure: true,
      sameSite: "lax",
    });
    expect(session.expires).toBeUndefined();
    expect(csrf.expires).toBeUndefined();
    expect(csrf.httpOnly).toBeUndefined();
    expect(session.domain).toBeUndefined();
    const sessionField = pair[0]?.split(";")[0];
    const csrfField = pair[1]?.split(";")[0];
    if (sessionField === undefined || csrfField === undefined)
      throw new Error("cookie pair missing");
    expect(parseCookie(sessionField)["__Host-spine-session"]).toBe(issued.credential.value);
    expect(
      cookies.extract({
        cookie: [sessionField, csrfField],
        origin,
        "x-spine-csrf": cookies.csrf(issued.credential.value),
      }),
    ).toEqual({ kind: "cookie", value: issued.credential.value });
    await cookies.close();
    await sessions.close();
  });

  it("uses the issued deadline for persistent cookies and changes both values on reissue", async () => {
    const time = clock(1_700_000_000_000);
    const sessions = await OpaqueSessions.create(options(time));
    const first = await sessions.issue({ id: "one" });
    const second = await sessions.issue({ id: "two" });
    if (first.kind !== "created" || second.kind !== "created") throw new Error("expected sessions");
    const cookies = new OpaqueSessionCookies({
      csrfSecret: secret,
      origins: [origin],
      persistent: true,
      sameSite: "strict",
    });
    const firstPair = cookies.issue(first.credential.value, first.session.expiresAt);
    const secondPair = cookies.issue(second.credential.value, second.session.expiresAt);
    const expected = new Date(Number(first.session.expiresAt.seconds) * 1_000).toUTCString();
    for (const value of firstPair) {
      expect(value).toContain(`Expires=${expected}`);
      expect(value).toContain("SameSite=Strict");
      expect(value).not.toContain("Domain=");
    }
    expect(firstPair[0]).not.toBe(secondPair[0]);
    expect(firstPair[1]).not.toBe(secondPair[1]);
    const oldCsrf = cookies.csrf(first.credential.value);
    const mixedCookie = `__Host-spine-session=${second.credential.value}; __Host-spine-csrf=${oldCsrf}`;
    expect(
      cookies.extract({
        cookie: mixedCookie,
        origin,
        "x-spine-csrf": oldCsrf,
      }),
    ).toEqual({ kind: "rejected", reason: "csrf-mismatch" });
    const cleared = cookies.clear();
    expect(parseSetCookie(cleared[0] ?? "")).toMatchObject({
      name: "__Host-spine-session",
      path: "/",
      secure: true,
      httpOnly: true,
      maxAge: 0,
    });
    expect(parseSetCookie(cleared[1] ?? "")).toMatchObject({
      name: "__Host-spine-csrf",
      path: "/",
      secure: true,
      maxAge: 0,
    });
    await cookies.close();
    await sessions.close();
  });

  it("supports explicit SameSite=None while retaining Secure and rejects invalid policy", () => {
    const cookies = new OpaqueSessionCookies({
      csrfSecret: secret,
      origins: [origin],
      sameSite: "none",
    });
    const deadline = create(TimestampSchema, { seconds: 1_700_000_060n });
    const pair = cookies.issue("Fe26.2.test.sealed.reference", deadline);
    expect(pair.every((value) => value.includes("Secure") && value.includes("SameSite=None"))).toBe(
      true,
    );
    expect(
      () =>
        new OpaqueSessionCookies({
          csrfSecret: secret,
          origins: [origin],
          sameSite: "invalid" as never,
        }),
    ).toThrow("sameSite");
    expect(
      () =>
        new OpaqueSessionCookies({
          csrfSecret: secret,
          origins: [origin],
          persistent: "yes" as never,
        }),
    ).toThrow("persistent");
  });

  it("serializes frozen host-only cookies and accepts a valid CSRF-protected cookie request", () => {
    const cookies = new OpaqueSessionCookies({ csrfSecret: secret, origins: [origin] });
    const id = "a".repeat(43);
    const issued = cookies.issue(id, cookieDeadline);
    const cleared = cookies.clear();
    expect(issued).toEqual([
      `__Host-spine-session=${id}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      `__Host-spine-csrf=${cookies.csrf(id)}; Path=/; Secure; SameSite=Lax`,
    ]);
    expect(cleared.map((value) => parseSetCookie(value))).toMatchObject([
      {
        name: "__Host-spine-session",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "lax",
        maxAge: 0,
      },
      { name: "__Host-spine-csrf", path: "/", secure: true, sameSite: "lax", maxAge: 0 },
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

  it("rejects empty and control-bearing credentials without imposing the old ID length", () => {
    const cookies = new OpaqueSessionCookies({ csrfSecret: secret, origins: [origin] });
    for (const invalid of ["", "Fe26\nvalue", "Fe26\u0000value"]) {
      expect(() => cookies.csrf(invalid)).toThrow("nonempty sealed value");
      expect(() => cookies.issue(invalid, cookieDeadline)).toThrow("nonempty sealed value");
    }
    expect(
      cookies.extract({
        cookie: `__Host-spine-session=%0A; __Host-spine-csrf=${"a".repeat(43)}`,
      }),
    ).toEqual({ kind: "rejected", reason: "malformed-cookie" });
    expect(cookies.csrf("a".repeat(42))).toHaveLength(43);
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
    expect(cookies.issue(id, cookieDeadline)[0]).toMatch(/^__Host-session=/);
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
      () => cookies.issue(id, cookieDeadline),
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
    for (const cookie of ["missing-equals", "bad name=value"]) {
      expect(cookies.extract({ cookie })).toEqual({
        kind: "rejected",
        reason: "malformed-cookie",
      });
    }
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

  it("rejects bearer together with a primary session cookie, including an empty one", () => {
    const cookies = new OpaqueSessionCookies({ csrfSecret: secret, origins: [origin] });
    for (const value of ["sealed-value", ""]) {
      expect(
        cookies.extract({
          authorization: "Bearer bearer-value",
          cookie: `__Host-spine-session=${value}`,
        }),
      ).toEqual({ kind: "rejected", reason: "simultaneous-credential" });
    }
    expect(
      cookies.extract({
        authorization: "Bearer bearer-value",
        cookie: "__Host-spine-csrf=supporting-state",
      }),
    ).toEqual({ kind: "bearer", value: "bearer-value" });
  });

  it("exposes immutable configured admission names and reader absence separately", async () => {
    const cookies = new OpaqueSessionCookies({
      csrfSecret: secret,
      origins: [origin],
      sessionCookieName: "__Host-orders-session",
      csrfCookieName: "__Host-orders-csrf",
    });
    expect(cookies.admission).toEqual({
      csrfHeaderNames: ["x-spine-csrf"],
      credentialCookieNames: ["__Host-orders-session"],
      stateCookieNames: ["__Host-orders-csrf"],
    });
    expect(Object.isFrozen(cookies.admission)).toBe(true);
    expect(Object.isFrozen(cookies.admission.credentialCookieNames)).toBe(true);
    const request = { headers: {}, method: "POST", url: new URL("https://app.example.test/rpc") };
    await expect(cookies.read(request)).resolves.toBeUndefined();
    await expect(
      cookies.read({ ...request, headers: { authorization: ["Bearer a", "Bearer b"] } }),
    ).resolves.toEqual({ kind: "rejected", reason: "duplicate-authorization" });
  });

  it("rejects decoded control characters and duplicate Origins before resolving a cookie credential", () => {
    const cookies = new OpaqueSessionCookies({ csrfSecret: secret, origins: [origin] });
    expect(
      cookies.extract({
        cookie:
          "__Host-spine-session=%0A; __Host-spine-csrf=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
