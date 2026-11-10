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

import { createHash, randomBytes } from "node:crypto";
import { Time } from "@spine-event-engine/core";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { ServerTests } from "@spine-event-engine/server/testing";
import { AuthErrorCode, FirebaseAuthError } from "firebase-admin/auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FieldnotesHost } from "../src/fieldnotes-host.js";
import type { FieldnotesFirebaseClaims } from "../src/firebase-auth.js";
import { FieldnotesAuthRoutes } from "../src/auth-routes.js";
import type { FieldnotesSettings } from "../src/host-settings.js";

const origin = "https://localhost:3000";
const settings = (): FieldnotesSettings => ({
  postgresUrl: "postgres://localhost/fieldnotes",
  publicOrigin: origin,
  sessionPassword: randomBytes(32).toString("base64url"),
  csrfSecret: randomBytes(32),
  readerProofSecret: randomBytes(32),
  sessionTtlMilliseconds: 3_600_000,
  authRouteTimeoutMs: 10_000,
  authRouteMaxBytes: 65_536,
});

describe("Fieldnotes real Firebase auth routes", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await ServerTests.resetEnvironment();
  });

  it("releases finite bootstrap monitors while keeping the credential valid", async () => {
    const host = await FieldnotesHost.open(settings(), {
      storageFactory: new InMemoryStorageFactory(),
      authentication: {
        mode: "firebase",
        projectId: "demo-fieldnotes",
        recentLoginMilliseconds: 300_000,
      },
      firebaseVerifier: { verifyIdToken: vi.fn() },
    });
    const created = await host.sessions.issue({ id: "bootstrap-user" });
    if (created.kind !== "created") throw new Error("Expected a session.");
    const credential = created.credential.value;
    const csrf = host.cookies.csrf(credential);
    const original = host.sessions.resolve.bind(host.sessions);
    const monitored: AbortSignal[] = [];
    vi.spyOn(host.sessions, "resolve").mockImplementation(async (value, signal) => {
      const result = await original(value, signal);
      if (result?.invalidated) monitored.push(result.invalidated);
      return result;
    });
    const post = () =>
      fetch(`${host.gateway.baseUrl}/auth/session`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-fieldnotes-auth": "1",
          cookie: `__Host-spine-session=${credential}; __Host-spine-csrf=${csrf}`,
          "x-spine-csrf": csrf,
        },
        body: "{}",
      });
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect((await post()).status).toBe(200);
        expect(monitored).toHaveLength(attempt + 1);
        expect(monitored.every((signal) => signal.aborted)).toBe(true);
      }
      expect(await original({ kind: "cookie", value: credential })).toBeDefined();
      const routeSignal: AbortSignal[] = [];
      vi.spyOn(host.sessions, "resolve").mockImplementationOnce((_value, signal) => {
        if (signal) routeSignal.push(signal);
        return Promise.reject(new Error("read failed"));
      });
      expect((await post()).status).toBe(500);
      expect(routeSignal[0]?.aborted).toBe(true);
      const cancelled = new AbortController();
      const pendingSignals: AbortSignal[] = [];
      vi.spyOn(host.sessions, "resolve").mockImplementationOnce((_value, signal) => {
        if (signal) pendingSignals.push(signal);
        return new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => {
              reject(new Error("request aborted"));
            },
            { once: true },
          );
        });
      });
      const pending = fetch(`${host.gateway.baseUrl}/auth/session`, {
        method: "POST",
        signal: cancelled.signal,
        headers: {
          origin,
          "content-type": "application/json",
          "x-fieldnotes-auth": "1",
          cookie: `__Host-spine-session=${credential}; __Host-spine-csrf=${csrf}`,
          "x-spine-csrf": csrf,
        },
        body: "{}",
      }).catch(() => undefined);
      await vi.waitFor(() => {
        expect(pendingSignals).toHaveLength(1);
      });
      cancelled.abort();
      await pending;
      await vi.waitFor(() => {
        expect(pendingSignals[0]?.aborted).toBe(true);
      });
    } finally {
      await host.close();
    }
  });

  it.each([
    {
      error: new FirebaseAuthError({ code: AuthErrorCode.ID_TOKEN_REVOKED, message: "revoked" }),
      status: 401,
    },
    {
      error: new FirebaseAuthError({ code: AuthErrorCode.INTERNAL_ERROR, message: "service down" }),
      status: 503,
    },
    {
      error: new FirebaseAuthError({ code: AuthErrorCode.INVALID_ARGUMENT, message: "ambiguous" }),
      status: 503,
    },
  ])("maps Admin verification result to HTTP $status", async ({ error, status }) => {
    const host = await FieldnotesHost.open(settings(), {
      storageFactory: new InMemoryStorageFactory(),
      authentication: {
        mode: "firebase",
        projectId: "demo-fieldnotes",
        recentLoginMilliseconds: 300_000,
      },
      firebaseVerifier: { verifyIdToken: vi.fn().mockRejectedValue(error) },
    });
    try {
      const response = await fetch(`${host.gateway.baseUrl}/auth/firebase/exchange`, {
        method: "POST",
        headers: { origin, "content-type": "application/json", "x-fieldnotes-auth": "1" },
        body: JSON.stringify({ idToken: "candidate" }),
      });
      expect(response.status).toBe(status);
      expect(response.headers.getSetCookie()).toHaveLength(0);
      expect(response.headers.get("cache-control")).toBe("no-store");
    } finally {
      await host.close();
    }
  });

  it.each(["verified", "failed"])(
    "drains a %s deferred verifier after route cancellation before closing sessions",
    async (outcome) => {
      let release!: (value: FieldnotesFirebaseClaims) => void;
      let reject!: (reason: unknown) => void;
      const verification = new Promise<FieldnotesFirebaseClaims>((resolve, fail) => {
        release = resolve;
        reject = fail;
      });
      const verifier = { verifyIdToken: vi.fn(() => verification) };
      const host = await FieldnotesHost.open(settings(), {
        storageFactory: new InMemoryStorageFactory(),
        authentication: {
          mode: "firebase",
          projectId: "demo-fieldnotes",
          recentLoginMilliseconds: 300_000,
        },
        firebaseVerifier: verifier,
      });
      const issue = vi.spyOn(host.sessions, "issue");
      const closeSessions = vi.spyOn(host.sessions, "close");
      const closeRoutes = vi.spyOn(FieldnotesAuthRoutes.prototype, "close");
      const gateway = host.gateway;
      const closeGateway = gateway.close.bind(gateway);
      let gatewayStopped!: () => void;
      const stopped = new Promise<void>((resolve) => {
        gatewayStopped = resolve;
      });
      vi.spyOn(gateway, "close").mockImplementation(async () => {
        await closeGateway();
        gatewayStopped();
      });
      const request = fetch(`${host.gateway.baseUrl}/auth/firebase/exchange`, {
        method: "POST",
        headers: { origin, "content-type": "application/json", "x-fieldnotes-auth": "1" },
        body: JSON.stringify({ idToken: "candidate" }),
      }).catch(() => undefined);
      let closing: Promise<void> | undefined;
      let released = false;
      let closed = false;
      try {
        await vi.waitFor(() => {
          expect(verifier.verifyIdToken).toHaveBeenCalledTimes(1);
        });
        closing = host.close().then(() => {
          closed = true;
        });
        await stopped;
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(closeRoutes).toHaveBeenCalledTimes(1);
        expect(closeSessions).not.toHaveBeenCalled();
        expect(closed).toBe(false);
        released = true;
        if (outcome === "verified")
          release({
            uid: "late-user",
            aud: "demo-fieldnotes",
            iss: "https://securetoken.google.com/demo-fieldnotes",
            auth_time: Math.floor(Date.now() / 1000),
            firebase: { sign_in_provider: "google.com" },
          });
        else reject(new Error("provider unavailable"));
        await closing;
        await request;
        expect(closed).toBe(true);
        expect(closeSessions).toHaveBeenCalledTimes(1);
        expect(issue).not.toHaveBeenCalled();
      } finally {
        if (!released) reject(new Error("verification test released during cleanup"));
        await (closing ?? host.close());
        await request;
      }
    },
  );

  it("gates exchange, issues opaque cookies, reports session and revokes before logout", async () => {
    const claims = {
      uid: "firebase-user",
      aud: "demo-fieldnotes",
      iss: "https://securetoken.google.com/demo-fieldnotes",
      auth_time: Math.floor(Date.now() / 1000),
      firebase: { sign_in_provider: "google.com" },
    };
    const verifier = { verifyIdToken: vi.fn().mockResolvedValue(claims) };
    const host = await FieldnotesHost.open(settings(), {
      storageFactory: new InMemoryStorageFactory(),
      authentication: {
        mode: "firebase",
        projectId: "demo-fieldnotes",
        recentLoginMilliseconds: 300_000,
      },
      firebaseVerifier: verifier,
    });
    const base = host.gateway.baseUrl;
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-fieldnotes-auth": "1",
          ...headers,
        },
        body: JSON.stringify(body),
      });
    try {
      expect(
        (
          await post(
            "/auth/firebase/exchange",
            { idToken: "valid" },
            { origin: "https://foreign.test" },
          )
        ).status,
      ).toBe(403);
      expect(
        (await post("/auth/firebase/exchange", { idToken: "valid" }, { "x-fieldnotes-auth": "" }))
          .status,
      ).toBe(403);
      expect(verifier.verifyIdToken).not.toHaveBeenCalled();
      const issued = await post("/auth/firebase/exchange", { idToken: "valid" });
      expect(issued.status).toBe(200);
      expect(issued.headers.get("cache-control")).toBe("no-store");
      expect(issued.headers.getSetCookie()).toHaveLength(2);
      expect(verifier.verifyIdToken).toHaveBeenCalledExactlyOnceWith("valid", true);
      const cookies = issued.headers.getSetCookie();
      const credential = cookies[0]?.split(";", 1)[0]?.split("=", 2)[1];
      const csrf = cookies[1]?.split(";", 1)[0]?.split("=", 2)[1];
      if (!credential || !csrf) throw new Error("Issued cookies are missing.");
      const headers = {
        origin,
        cookie: `__Host-spine-session=${credential}; __Host-spine-csrf=${csrf}`,
        "x-spine-csrf": csrf,
      };
      const session = await post("/auth/session", {}, headers);
      expect(session.status).toBe(200);
      expect(await session.json()).toMatchObject({
        authenticated: true,
        mode: "firebase",
        principal: { id: JSON.stringify(["firebase-google", "demo-fieldnotes", "firebase-user"]) },
      });
      expect((await post("/auth/logout", {}, { cookie: headers.cookie })).status).toBe(401);
      const monitored = await host.sessions.resolve(
        { kind: "cookie", value: credential },
        new AbortController().signal,
      );
      expect(monitored?.invalidated?.aborted).toBe(false);
      const failure = vi
        .spyOn(host.sessions, "logout")
        .mockRejectedValueOnce(new Error("store failed"));
      const refused = await post("/auth/logout", {}, { ...headers });
      expect(refused.status).toBe(503);
      expect(refused.headers.getSetCookie()).toHaveLength(0);
      failure.mockRestore();
      expect((await post("/auth/session", {}, headers)).status).toBe(200);
      const logout = await post("/auth/logout", {}, { ...headers });
      expect(logout.status).toBe(200);
      expect(logout.headers.getSetCookie()).toHaveLength(2);
      expect(monitored?.invalidated?.aborted).toBe(true);
      expect((await post("/auth/session", {}, headers)).status).toBe(401);
    } finally {
      await host.close();
    }
  });
});

describe("Fieldnotes direct Google auth routes", () => {
  afterEach(async () => ServerTests.resetEnvironment());

  it("keeps the grant in a completion fragment and consumes it once with browser PKCE", async () => {
    const issuer = "https://issuer.example";
    const exchange = vi.fn().mockResolvedValue({ issuer, subject: "google-user" });
    const host = await FieldnotesHost.open(settings(), {
      storageFactory: new InMemoryStorageFactory(),
      authentication: { mode: "google", clientId: "client-id", clientSecret: "client-secret" },
      googleProvider: {
        authorizationEndpoint: `${issuer}/authorize`,
        recommendedScopes: ["openid"],
        provider: { issuer, exchangeAuthorizationCode: exchange },
      },
    });
    const base = host.gateway.baseUrl;
    const verifier = "v".repeat(43);
    const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: { origin, "content-type": "application/json", "x-fieldnotes-auth": "1" },
        body: JSON.stringify(body),
      });
    try {
      const missingHeader = await fetch(`${base}/auth/google/start`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ codeChallenge: challenge }),
      });
      expect(missingHeader.status).toBe(403);
      const started = await post("/auth/google/start", { codeChallenge: challenge });
      expect(started.status).toBe(200);
      const startBody: unknown = await started.json();
      if (
        typeof startBody !== "object" ||
        startBody === null ||
        !("authorizationUrl" in startBody) ||
        typeof startBody.authorizationUrl !== "string"
      )
        throw new Error("OIDC start response lacks an authorization URL.");
      const state = new URL(startBody.authorizationUrl).searchParams.get("state");
      if (!state) throw new Error("OIDC start did not return a state.");
      const callbackUrl = `${base}/auth/google/callback?state=${encodeURIComponent(state)}&code=code&iss=${encodeURIComponent(issuer)}`;
      const callback = await fetch(callbackUrl, { redirect: "manual" });
      expect(callback.status).toBe(303);
      const location = callback.headers.get("location");
      if (!location) throw new Error("OIDC callback did not redirect.");
      expect(location).toMatch(/^https:\/\/localhost:3000\/auth\/complete#grant=/);
      expect(new URL(location).search).toBe("");
      const grant = new URL(location).hash.slice("#grant=".length);
      const replay = await fetch(callbackUrl, { redirect: "manual" });
      expect(replay.status).toBe(303);
      expect(replay.headers.get("location")).toBe(`${origin}/auth/complete#result=failed`);
      expect(
        (await post("/auth/google/exchange", { grant, codeVerifier: "x".repeat(43) })).status,
      ).toBe(401);
      const issued = await post("/auth/google/exchange", { grant, codeVerifier: verifier });
      expect(issued.status).toBe(200);
      expect(issued.headers.getSetCookie()).toHaveLength(2);
      expect((await post("/auth/google/exchange", { grant, codeVerifier: verifier })).status).toBe(
        401,
      );
      expect(exchange).toHaveBeenCalledTimes(1);
      const deniedStart = await post("/auth/google/start", { codeChallenge: challenge });
      const deniedBody: unknown = await deniedStart.json();
      if (
        typeof deniedBody !== "object" ||
        deniedBody === null ||
        !("authorizationUrl" in deniedBody) ||
        typeof deniedBody.authorizationUrl !== "string"
      )
        throw new Error("Denied OIDC start did not return a state.");
      const deniedState = new URL(deniedBody.authorizationUrl).searchParams.get("state");
      const denied = await fetch(
        `${base}/auth/google/callback?state=${encodeURIComponent(deniedState ?? "")}&error=access_denied`,
        { redirect: "manual" },
      );
      expect(denied.headers.get("location")).toBe(`${origin}/auth/complete#result=failed`);
      expect(await host.purgeExpired(Time.currentTime())).toMatchObject({
        sessions: 0,
        google: { transactions: 0, grants: 0 },
      });
    } finally {
      await host.close();
    }
  });
});
