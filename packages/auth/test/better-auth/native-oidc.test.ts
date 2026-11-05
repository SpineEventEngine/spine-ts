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

import { createServer } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  InMemoryStorageFactory,
  StorageGroup,
  type RecordStorage,
} from "@spine-event-engine/storage";
import type {
  BetterAuthAccountRecord,
  BetterAuthUserRecord,
  BetterAuthSessionRecord,
  BetterAuthVerificationRecord,
} from "@spine-event-engine/proto/auth";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it, vi } from "vitest";

import {
  BetterAuthIntegration,
  PersistentBetterAuthStore,
  genericOAuth,
} from "../../src/better-auth/index.js";

/**
 * Builds the exact admitted callback URL for a provider test.
 *
 * @param code Test authorization code.
 * @param state Native state returned by the social start.
 * @returns Exact provider callback URL.
 */
function callbackUrl(code: string, state: string | null): string {
  const url = new URL("http://localhost:3000/auth/callback/company");
  url.searchParams.set("code", code);
  url.searchParams.set("state", state ?? "");
  return url.href;
}

describe("native OIDC startup", () => {
  it.each([
    "missing-endpoint",
    "changed-issuer",
    "changed-algorithms",
    "http-failure",
    "null-body",
    "empty-algorithms",
    "invalid-jwks",
    "invalid-endpoint",
  ] as const)("rejects %s discovery before exposing native routes", async (mode) => {
    let issuer = "";
    let reads = 0;
    const provider = createServer((request, response) => {
      if (request.url !== "/metadata/custom") {
        response.writeHead(404).end();
        return;
      }
      reads++;
      if (mode === "http-failure") {
        response.writeHead(503).end();
        return;
      }
      response.setHeader("content-type", "application/json");
      if (mode === "null-body") {
        response.end("null");
        return;
      }
      response.end(
        JSON.stringify({
          issuer: mode === "changed-issuer" && reads === 2 ? `${issuer}/other` : issuer,
          authorization_endpoint: `${issuer}/authorize`,
          ...(mode === "missing-endpoint"
            ? {}
            : {
                token_endpoint:
                  mode === "invalid-endpoint"
                    ? "ftp://unsafe.example.test/token"
                    : `${issuer}/token`,
              }),
          jwks_uri:
            mode === "invalid-jwks"
              ? "ftp://unsafe.example.test/keys"
              : `${issuer}/keys/nonconventional.json`,
          id_token_signing_alg_values_supported:
            mode === "empty-algorithms"
              ? []
              : [mode === "changed-algorithms" && reads === 2 ? "ES256" : "RS256"],
        }),
      );
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const address = provider.address();
    if (address === null || typeof address === "string")
      throw new Error("Provider did not listen.");
    issuer = `http://127.0.0.1:${String(address.port)}`;
    const factory = new InMemoryStorageFactory();
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better_auth_oidc_reject"),
      models: ["user", "account", "session", "verification"],
    });
    try {
      await expect(
        BetterAuthIntegration.create({
          store,
          routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
          options: {
            baseURL: "http://localhost:3000",
            basePath: "/auth",
            secret: "native-oidc-secret-at-least-32-characters",
            trustedOrigins: ["http://localhost:3000"],
            plugins: [
              genericOAuth({
                config: [
                  {
                    providerId: "company",
                    discoveryUrl: `${issuer}/metadata/custom`,
                    clientId: "client",
                    tokenEndpointAuth: { method: "none" },
                    pkce: true,
                    requireIdTokenVerification: true,
                    disableSignUp: true,
                    overrideUserInfo: false,
                  },
                ],
              }),
            ],
          },
          onPrincipal: (user) => Promise.resolve({ id: user.id }),
        }),
      ).rejects.toThrow(/OIDC|discovery|metadata/u);
      expect(reads).toBe(mode === "changed-issuer" || mode === "changed-algorithms" ? 2 : 1);
    } finally {
      await store.close();
      await factory.close();
      provider.close();
      await once(provider, "close");
    }
  });

  it.each(["none", "client_secret_basic", "client_secret_post"] as const)(
    "consumes one Spine state with %s client authentication and one prelinked session",
    async (method) => {
      const { privateKey, publicKey } = await generateKeyPair("RS256");
      const { privateKey: wrongPrivateKey } = await generateKeyPair("RS256");
      const jwk = {
        ...(await exportJWK(publicKey)),
        kid: "selected-key",
        alg: "RS256",
        use: "sig",
      };
      let issuer = "";
      let tokenRequests = 0;
      let keyRequests = 0;
      const pending = new Map<string, { challenge: string; nonce: string }>();
      let observedAuthorization: string | undefined;
      let observedClientId: string | null = null;
      let observedClientSecret: string | null = null;
      let tokenMode:
        | "valid"
        | "missing"
        | "failure"
        | "audience"
        | "issuer"
        | "signature"
        | "nonce"
        | "wrong-sub"
        | "userinfo-failure"
        | "userinfo-null"
        | "userinfo-no-sub"
        | "userinfo" = "valid";
      let userinfoRequests = 0;
      let tokenHold: Promise<void> | undefined;
      let tokenStarted: (() => void) | undefined;
      let keyHold: Promise<void> | undefined;
      let keyStarted: (() => void) | undefined;
      let userinfoHold: Promise<void> | undefined;
      let userinfoStarted: (() => void) | undefined;
      // Node's server observes rejected request handlers through the fixture's route assertions.
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      const provider = createServer(async (request, response) => {
        if (request.url === "/metadata/custom") {
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify({
              issuer,
              authorization_endpoint: `${issuer}/authorize`,
              token_endpoint: `${issuer}/token`,
              jwks_uri: `${issuer}/keys/nonconventional.json`,
              userinfo_endpoint: `${issuer}/userinfo`,
              id_token_signing_alg_values_supported: ["RS256"],
            }),
          );
          return;
        }
        if (request.url === "/keys/nonconventional.json") {
          keyRequests++;
          response.setHeader("content-type", "application/json");
          if (keyHold !== undefined) {
            response.writeHead(200);
            response.write(" ");
            keyStarted?.();
            await keyHold;
          }
          response.end(JSON.stringify({ keys: [jwk] }));
          return;
        }
        if (request.url === "/token") {
          tokenRequests++;
          let body = "";
          for await (const part of request) body += String(part);
          const form = new URLSearchParams(body);
          const selected = pending.get(form.get("code") ?? "");
          observedAuthorization = request.headers.authorization;
          observedClientId = form.get("client_id");
          observedClientSecret = form.get("client_secret");
          if (
            createHash("sha256")
              .update(form.get("code_verifier") ?? "")
              .digest("base64url") !== selected?.challenge
          ) {
            response.writeHead(400).end();
            return;
          }
          if (tokenMode === "failure") {
            response.writeHead(503).end();
            return;
          }
          const idToken = await new SignJWT({
            nonce: tokenMode === "nonce" ? "wrong-nonce" : selected.nonce,
            ...([
              "wrong-sub",
              "userinfo",
              "userinfo-failure",
              "userinfo-null",
              "userinfo-no-sub",
            ].includes(tokenMode)
              ? {}
              : { email: "ada@example.test", email_verified: true, name: "Provider changed" }),
          })
            .setProtectedHeader({ alg: "RS256", kid: "selected-key" })
            .setIssuer(tokenMode === "issuer" ? `${issuer}/other` : issuer)
            .setAudience(tokenMode === "audience" ? "other-client" : "client")
            .setSubject("subject-1")
            .setIssuedAt()
            .setExpirationTime("1h")
            .sign(tokenMode === "signature" ? wrongPrivateKey : privateKey);
          response.setHeader("content-type", "application/json");
          if (tokenHold !== undefined) {
            response.writeHead(200);
            response.write(" ");
            tokenStarted?.();
            await tokenHold;
          }
          response.end(
            JSON.stringify({
              access_token: "access",
              token_type: "Bearer",
              expires_in: 3600,
              ...(tokenMode === "missing" ? {} : { id_token: idToken }),
            }),
          );
          return;
        }
        if (request.url === "/userinfo") {
          userinfoRequests++;
          if (tokenMode === "userinfo-failure") {
            response.writeHead(503).end();
            return;
          }
          response.setHeader("content-type", "application/json");
          if (userinfoHold !== undefined) {
            response.writeHead(200);
            response.write(" ");
            userinfoStarted?.();
            await userinfoHold;
          }
          if (tokenMode === "userinfo-null") {
            response.end("null");
            return;
          }
          response.end(
            JSON.stringify({
              ...(tokenMode === "userinfo-no-sub"
                ? {}
                : { sub: tokenMode === "wrong-sub" ? "other-subject" : "subject-1" }),
              email: "ada@example.test",
              email_verified: true,
              name: "Ada",
            }),
          );
          return;
        }
        response.writeHead(404).end();
      });
      provider.listen(0, "127.0.0.1");
      await once(provider, "listening");
      const address = provider.address();
      if (address === null || typeof address === "string")
        throw new Error("Provider did not listen.");
      issuer = `http://127.0.0.1:${String(address.port)}`;
      const factory = new InMemoryStorageFactory();
      const acquired = vi.spyOn(factory, "createRecordStorage");
      const external = method === "client_secret_post";
      let directoryMode: "ready" | "missing" | "failure" = "ready";
      let directoryHold: Promise<void> | undefined;
      let directoryStarted: (() => void) | undefined;
      const created = new Date();
      const user = {
        id: "user-1",
        name: "Ada",
        email: "ada@example.test",
        emailVerified: true,
        createdAt: created,
        updatedAt: created,
      };
      const store = await PersistentBetterAuthStore.create({
        storageFactory: factory,
        group: new StorageGroup("better_auth_oidc_callback"),
        models: external
          ? ["account", "session", "verification"]
          : ["user", "account", "session", "verification"],
        ...(external
          ? {
              users: {
                findById: async (id: string) => {
                  if (directoryMode === "failure") throw new Error("Directory unavailable.");
                  if (directoryHold !== undefined) {
                    directoryStarted?.();
                    await directoryHold;
                  }
                  return directoryMode === "missing" || id !== user.id ? undefined : user;
                },
              },
            }
          : {}),
      });
      await store.provision({
        ...(external ? {} : { users: [user] }),
        accounts: [
          {
            userId: "user-1",
            accountId: "subject-1",
            providerId: "company",
            createdAt: created,
            updatedAt: created,
          },
        ],
      });
      const rawErrors = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const auth = await BetterAuthIntegration.create({
          store,
          routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
          options: {
            baseURL: "http://localhost:3000",
            basePath: "/auth",
            secret: "native-oidc-secret-at-least-32-characters",
            trustedOrigins: ["http://localhost:3000"],
            plugins: [
              genericOAuth({
                config: [
                  {
                    providerId: "company",
                    discoveryUrl: `${issuer}/metadata/custom`,
                    clientId: "client",
                    tokenEndpointAuth: { method },
                    ...(method === "none" ? {} : { clientSecret: "selected-secret" }),
                    pkce: true,
                    requireIdTokenVerification: true,
                    disableSignUp: true,
                    overrideUserInfo: false,
                  },
                ],
              }),
            ],
          },
          onPrincipal: (user) => Promise.resolve({ id: user.id }),
        });
        try {
          const start = auth.routes.find((route) => route.path === "/auth/sign-in/social");
          const callback = auth.routes.find((route) => route.path === "/auth/callback/company");
          if (start === undefined || callback === undefined)
            throw new Error("Native routes missing.");
          const started = await start.onRequest(
            new Request("http://localhost:3000/auth/sign-in/social", {
              method: "POST",
              headers: { origin: "http://localhost:3000", "content-type": "application/json" },
              body: JSON.stringify({
                provider: "company",
                callbackURL:
                  method === "none"
                    ? "http://localhost:3000/done?error=application"
                    : "http://localhost:3000/done",
              }),
            }),
            new AbortController().signal,
          );
          expect(started.status).toBe(200);
          const redirect = new URL(((await started.json()) as { url: string }).url);
          pending.set("issued", {
            challenge: redirect.searchParams.get("code_challenge") ?? "",
            nonce: redirect.searchParams.get("nonce") ?? "",
          });
          expect(pending.get("issued")?.challenge).not.toBe("");
          const cookie = started.headers
            .getSetCookie()
            .map((line) => line.split(";")[0])
            .join("; ");
          const url = callbackUrl("issued", redirect.searchParams.get("state"));
          const verification = acquired.mock.results[external ? 2 : 3]?.value as RecordStorage<
            string,
            BetterAuthVerificationRecord
          >;
          const prematureConsume = vi.spyOn(verification, "compareAndSet");
          const withoutCookie = await callback.onRequest(
            new Request(url),
            new AbortController().signal,
          );
          expect(withoutCookie.status).toBe(401);
          expect(withoutCookie.headers.has("location")).toBe(false);
          const wrongCookie = cookie.replace(/=[^;]*/u, "=forged");
          const forged = await callback.onRequest(
            new Request(url, { headers: { cookie: wrongCookie } }),
            new AbortController().signal,
          );
          expect(forged.status).toBe(401);
          const wrongState = await callback.onRequest(
            new Request(callbackUrl("issued", "unissued-state"), { headers: { cookie } }),
            new AbortController().signal,
          );
          expect(wrongState.status).toBe(401);
          expect(wrongState.headers.has("location")).toBe(false);
          const brokenRead = vi
            .spyOn(verification, "read")
            .mockRejectedValueOnce(new Error("Verification read unavailable."));
          try {
            const unavailable = await callback.onRequest(
              new Request(url, { headers: { cookie } }),
              new AbortController().signal,
            );
            expect(unavailable.status).toBe(503);
            expect(unavailable.headers.has("location")).toBe(false);
          } finally {
            brokenRead.mockRestore();
          }
          expect(prematureConsume).not.toHaveBeenCalled();
          prematureConsume.mockRestore();
          expect(tokenRequests).toBe(0);
          const accepted = await callback.onRequest(
            new Request(url, { headers: { cookie } }),
            new AbortController().signal,
          );
          const acceptedLocation = new URL(
            accepted.headers.get("location") ?? "",
            "http://localhost:3000",
          );
          expect({
            status: accepted.status,
            hasLocation: accepted.headers.has("location"),
            path: acceptedLocation.pathname,
            error: acceptedLocation.searchParams.get("error"),
            tokenRequests,
            keyRequests,
          }).toEqual({
            status: 302,
            hasLocation: true,
            path: "/done",
            error: method === "none" ? "application" : null,
            tokenRequests: 1,
            keyRequests: 1,
          });
          expect(tokenRequests).toBe(1);
          expect(keyRequests).toBe(1);
          if (method === "client_secret_basic") {
            expect(observedAuthorization).toBe(
              `Basic ${Buffer.from("client:selected-secret").toString("base64")}`,
            );
            expect(observedClientSecret).toBeNull();
          } else if (method === "client_secret_post") {
            expect(observedAuthorization).toBeUndefined();
            expect(observedClientId).toBe("client");
            expect(observedClientSecret).toBe("selected-secret");
          } else {
            expect(observedAuthorization).toBeUndefined();
            expect(observedClientSecret).toBeNull();
          }
          const sessionCookie = accepted.headers
            .getSetCookie()
            .map((line) => line.split(";")[0] ?? "")
            .find((line) => line.includes("session_token="));
          if (sessionCookie === undefined)
            throw new Error("Native callback omitted Session cookie.");
          expect(
            (await auth.sessions.resolve({ kind: "cookie", value: sessionCookie }))?.principal.id,
          ).toBe("user-1");
          if (!external) {
            const users = acquired.mock.results[0]?.value as RecordStorage<
              string,
              BetterAuthUserRecord
            >;
            expect((await users.read("user-1"))?.name).toBe("Ada");
          }
          const replay = await callback.onRequest(
            new Request(url, { headers: { cookie } }),
            new AbortController().signal,
          );
          expect(replay.status).toBe(401);
          expect(replay.headers.has("location")).toBe(false);
          expect(
            replay.headers.getSetCookie().some((line) => line.includes("session_token=")),
          ).toBe(false);
          expect(tokenRequests).toBe(1);

          const sessions = acquired.mock.results[external ? 1 : 2]?.value as RecordStorage<
            string,
            BetterAuthSessionRecord
          >;
          if (external) {
            const beforeDirectory = (await sessions.queryEntries({})).length;
            for (const unavailable of ["missing", "failure"] as const) {
              directoryMode = unavailable;
              const directoryStart = await start.onRequest(
                new Request("http://localhost:3000/auth/sign-in/social", {
                  method: "POST",
                  headers: { origin: "http://localhost:3000", "content-type": "application/json" },
                  body: JSON.stringify({
                    provider: "company",
                    callbackURL: "http://localhost:3000/done",
                  }),
                }),
                new AbortController().signal,
              );
              const destination = new URL(((await directoryStart.json()) as { url: string }).url);
              pending.set(unavailable, {
                challenge: destination.searchParams.get("code_challenge") ?? "",
                nonce: destination.searchParams.get("nonce") ?? "",
              });
              const stateCookie = directoryStart.headers
                .getSetCookie()
                .map((line) => line.split(";")[0])
                .join("; ");
              const denied = await callback.onRequest(
                new Request(callbackUrl(unavailable, destination.searchParams.get("state")), {
                  headers: { cookie: stateCookie },
                }),
                new AbortController().signal,
              );
              expect(denied.status, unavailable).toBe(unavailable === "failure" ? 503 : 401);
              expect(denied.headers.has("location"), unavailable).toBe(false);
              expect(
                denied.headers.getSetCookie().some((line) => line.includes("session_token=")),
              ).toBe(false);
              expect((await sessions.queryEntries({})).length).toBe(beforeDirectory);
              expect(rawErrors).not.toHaveBeenCalled();
            }
            directoryMode = "ready";
            let enteredDirectory!: () => void;
            let releaseDirectory!: () => void;
            const directoryReading = new Promise<void>((resolve) => {
              enteredDirectory = resolve;
            });
            directoryHold = new Promise<void>((resolve) => {
              releaseDirectory = resolve;
            });
            directoryStarted = enteredDirectory;
            try {
              const delayedStart = await start.onRequest(
                new Request("http://localhost:3000/auth/sign-in/social", {
                  method: "POST",
                  headers: { origin: "http://localhost:3000", "content-type": "application/json" },
                  body: JSON.stringify({
                    provider: "company",
                    callbackURL: "http://localhost:3000/done",
                  }),
                }),
                new AbortController().signal,
              );
              const delayedRedirect = new URL(((await delayedStart.json()) as { url: string }).url);
              pending.set("directory-cancel", {
                challenge: delayedRedirect.searchParams.get("code_challenge") ?? "",
                nonce: delayedRedirect.searchParams.get("nonce") ?? "",
              });
              const delayedCookie = delayedStart.headers
                .getSetCookie()
                .map((line) => line.split(";")[0])
                .join("; ");
              const controller = new AbortController();
              const delayed = callback.onRequest(
                new Request(
                  callbackUrl("directory-cancel", delayedRedirect.searchParams.get("state")),
                  { headers: { cookie: delayedCookie } },
                ),
                controller.signal,
              );
              await directoryReading;
              controller.abort();
              releaseDirectory();
              expect((await delayed).status).toBe(503);
              expect((await sessions.queryEntries({})).length).toBe(beforeDirectory);
            } finally {
              releaseDirectory();
              directoryHold = undefined;
              directoryStarted = undefined;
            }
          }
          if (method === "none") {
            const beforeInvalid = (await sessions.queryEntries({})).length;
            for (const failure of [
              "missing",
              "failure",
              "audience",
              "issuer",
              "signature",
              "nonce",
              "wrong-sub",
              "userinfo-failure",
              "userinfo-null",
              "userinfo-no-sub",
            ] as const) {
              tokenMode = failure;
              const invalidStart = await start.onRequest(
                new Request("http://localhost:3000/auth/sign-in/social", {
                  method: "POST",
                  headers: { origin: "http://localhost:3000", "content-type": "application/json" },
                  body: JSON.stringify({
                    provider: "company",
                    callbackURL: "http://localhost:3000/done",
                    ...(failure === "audience"
                      ? { errorCallbackURL: "http://localhost:3000/login-failed" }
                      : {}),
                  }),
                }),
                new AbortController().signal,
              );
              const invalidRedirect = new URL(((await invalidStart.json()) as { url: string }).url);
              pending.set(failure, {
                challenge: invalidRedirect.searchParams.get("code_challenge") ?? "",
                nonce: invalidRedirect.searchParams.get("nonce") ?? "",
              });
              const invalidCookie = invalidStart.headers
                .getSetCookie()
                .map((line) => line.split(";")[0])
                .join("; ");
              const invalid = await callback.onRequest(
                new Request(callbackUrl(failure, invalidRedirect.searchParams.get("state")), {
                  headers: { cookie: invalidCookie },
                }),
                new AbortController().signal,
              );
              expect(invalid.status, failure).toBe(
                failure === "audience" ? 302 : failure.startsWith("userinfo-") ? 503 : 401,
              );
              if (failure === "audience") {
                expect(new URL(invalid.headers.get("location") ?? "").pathname).toBe(
                  "/login-failed",
                );
              } else {
                expect(invalid.headers.has("location"), failure).toBe(false);
              }
              expect(
                invalid.headers.getSetCookie().some((line) => line.includes("session_token=")),
                failure,
              ).toBe(false);
              expect((await sessions.queryEntries({})).length, failure).toBe(beforeInvalid);
            }
            tokenMode = "valid";
            expect(userinfoRequests).toBe(4);
            expect(rawErrors).not.toHaveBeenCalled();
            let startedUserinfo!: () => void;
            let releaseUserinfo!: () => void;
            const readingUserinfo = new Promise<void>((resolve) => {
              startedUserinfo = resolve;
            });
            userinfoHold = new Promise<void>((resolve) => {
              releaseUserinfo = resolve;
            });
            userinfoStarted = startedUserinfo;
            try {
              tokenMode = "userinfo";
              const infoStart = await start.onRequest(
                new Request("http://localhost:3000/auth/sign-in/social", {
                  method: "POST",
                  headers: { origin: "http://localhost:3000", "content-type": "application/json" },
                  body: JSON.stringify({
                    provider: "company",
                    callbackURL: "http://localhost:3000/done",
                  }),
                }),
                new AbortController().signal,
              );
              const infoRedirect = new URL(((await infoStart.json()) as { url: string }).url);
              pending.set("userinfo-cancel", {
                challenge: infoRedirect.searchParams.get("code_challenge") ?? "",
                nonce: infoRedirect.searchParams.get("nonce") ?? "",
              });
              const infoCookie = infoStart.headers
                .getSetCookie()
                .map((line) => line.split(";")[0])
                .join("; ");
              const infoController = new AbortController();
              const infoResult = callback.onRequest(
                new Request(
                  callbackUrl("userinfo-cancel", infoRedirect.searchParams.get("state")),
                  { headers: { cookie: infoCookie } },
                ),
                infoController.signal,
              );
              await readingUserinfo;
              infoController.abort();
              releaseUserinfo();
              expect((await infoResult).status).toBe(503);
              expect((await sessions.queryEntries({})).length).toBe(beforeInvalid);
            } finally {
              releaseUserinfo();
              userinfoHold = undefined;
              userinfoStarted = undefined;
              tokenMode = "valid";
            }
            let startedToken!: () => void;
            let releaseToken!: () => void;
            const tokenReading = new Promise<void>((resolve) => {
              startedToken = resolve;
            });
            tokenHold = new Promise<void>((resolve) => {
              releaseToken = resolve;
            });
            tokenStarted = startedToken;
            try {
              const cancelledStart = await start.onRequest(
                new Request("http://localhost:3000/auth/sign-in/social", {
                  method: "POST",
                  headers: { origin: "http://localhost:3000", "content-type": "application/json" },
                  body: JSON.stringify({
                    provider: "company",
                    callbackURL: "http://localhost:3000/done",
                  }),
                }),
                new AbortController().signal,
              );
              const cancelledRedirect = new URL(
                ((await cancelledStart.json()) as { url: string }).url,
              );
              pending.set("cancelled", {
                challenge: cancelledRedirect.searchParams.get("code_challenge") ?? "",
                nonce: cancelledRedirect.searchParams.get("nonce") ?? "",
              });
              const cancelledCookie = cancelledStart.headers
                .getSetCookie()
                .map((line) => line.split(";")[0])
                .join("; ");
              const cancelledSignal = new AbortController();
              const cancelled = callback.onRequest(
                new Request(callbackUrl("cancelled", cancelledRedirect.searchParams.get("state")), {
                  headers: { cookie: cancelledCookie },
                }),
                cancelledSignal.signal,
              );
              await tokenReading;
              cancelledSignal.abort();
              releaseToken();
              const refused = await cancelled;
              expect(refused.status).toBe(503);
              expect(refused.headers.getSetCookie()).toHaveLength(0);
              expect((await sessions.queryEntries({})).length).toBe(beforeInvalid);
            } finally {
              releaseToken();
              tokenHold = undefined;
              tokenStarted = undefined;
            }

            for (const abort of ["none", "first", "second", "both"] as const) {
              const beforeKeys = keyRequests;
              const beforePairSessions = (await sessions.queryEntries({})).length;
              let startedKeys!: () => void;
              let releaseKeys!: () => void;
              const bothKeys = new Promise<void>((resolve) => {
                startedKeys = resolve;
              });
              keyHold = new Promise<void>((resolve) => {
                releaseKeys = resolve;
              });
              keyStarted = () => {
                if (keyRequests === beforeKeys + 2) startedKeys();
              };
              try {
                const paired: { url: string; cookie: string }[] = [];
                for (const code of [`pair-${abort}-one`, `pair-${abort}-two`]) {
                  const begun = await start.onRequest(
                    new Request("http://localhost:3000/auth/sign-in/social", {
                      method: "POST",
                      headers: {
                        origin: "http://localhost:3000",
                        "content-type": "application/json",
                      },
                      body: JSON.stringify({
                        provider: "company",
                        callbackURL: "http://localhost:3000/done",
                      }),
                    }),
                    new AbortController().signal,
                  );
                  const destination = new URL(((await begun.json()) as { url: string }).url);
                  pending.set(code, {
                    challenge: destination.searchParams.get("code_challenge") ?? "",
                    nonce: destination.searchParams.get("nonce") ?? "",
                  });
                  paired.push({
                    url: callbackUrl(code, destination.searchParams.get("state")),
                    cookie: begun.headers
                      .getSetCookie()
                      .map((line) => line.split(";")[0])
                      .join("; "),
                  });
                }
                const first = paired[0];
                const second = paired[1];
                if (first === undefined || second === undefined)
                  throw new Error("Paired callbacks absent.");
                const firstSignal = new AbortController();
                const secondSignal = new AbortController();
                const firstResult = callback.onRequest(
                  new Request(first.url, { headers: { cookie: first.cookie } }),
                  firstSignal.signal,
                );
                const secondResult = callback.onRequest(
                  new Request(second.url, { headers: { cookie: second.cookie } }),
                  secondSignal.signal,
                );
                let timer!: ReturnType<typeof setTimeout>;
                try {
                  await Promise.race([
                    bothKeys,
                    new Promise<never>((_resolve, reject) => {
                      timer = setTimeout(() => {
                        reject(new Error("Two independent JWKS requests did not start."));
                      }, 2_000);
                    }),
                  ]);
                } finally {
                  clearTimeout(timer);
                }
                if (abort === "first" || abort === "both") firstSignal.abort();
                if (abort === "second" || abort === "both") secondSignal.abort();
                releaseKeys();
                const firstResponse = await firstResult;
                const secondResponse = await secondResult;
                expect([firstResponse.status, secondResponse.status]).toEqual(
                  abort === "none"
                    ? [302, 302]
                    : abort === "first"
                      ? [503, 302]
                      : abort === "second"
                        ? [302, 503]
                        : [503, 503],
                );
                for (const response of [firstResponse, secondResponse]) {
                  if (response.status === 302)
                    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/done");
                  else
                    expect(
                      response.headers
                        .getSetCookie()
                        .some((line) => line.includes("session_token=")),
                    ).toBe(false);
                }
                expect((await sessions.queryEntries({})).length).toBe(
                  beforePairSessions + (abort === "none" ? 2 : abort === "both" ? 0 : 1),
                );
              } finally {
                releaseKeys();
                keyHold = undefined;
                keyStarted = undefined;
              }
            }
            const freshStart = await start.onRequest(
              new Request("http://localhost:3000/auth/sign-in/social", {
                method: "POST",
                headers: { origin: "http://localhost:3000", "content-type": "application/json" },
                body: JSON.stringify({
                  provider: "company",
                  callbackURL: "http://localhost:3000/done",
                }),
              }),
              new AbortController().signal,
            );
            const freshRedirect = new URL(((await freshStart.json()) as { url: string }).url);
            pending.set("fresh-after-aborts", {
              challenge: freshRedirect.searchParams.get("code_challenge") ?? "",
              nonce: freshRedirect.searchParams.get("nonce") ?? "",
            });
            const freshCookie = freshStart.headers
              .getSetCookie()
              .map((line) => line.split(";")[0])
              .join("; ");
            const freshResponse = await callback.onRequest(
              new Request(
                callbackUrl("fresh-after-aborts", freshRedirect.searchParams.get("state")),
                {
                  headers: { cookie: freshCookie },
                },
              ),
              new AbortController().signal,
            );
            expect(freshResponse.status).toBe(302);
          }

          const raceStart = await start.onRequest(
            new Request("http://localhost:3000/auth/sign-in/social", {
              method: "POST",
              headers: { origin: "http://localhost:3000", "content-type": "application/json" },
              body: JSON.stringify({
                provider: "company",
                callbackURL: "http://localhost:3000/done",
              }),
            }),
            new AbortController().signal,
          );
          const raceRedirect = new URL(((await raceStart.json()) as { url: string }).url);
          pending.set("race", {
            challenge: raceRedirect.searchParams.get("code_challenge") ?? "",
            nonce: raceRedirect.searchParams.get("nonce") ?? "",
          });
          const raceCookie = raceStart.headers
            .getSetCookie()
            .map((line) => line.split(";")[0])
            .join("; ");
          const raceUrl = callbackUrl("race", raceRedirect.searchParams.get("state"));
          const beforeRaceTokens = tokenRequests;
          const raceStorage = acquired.mock.results[external ? 2 : 3]?.value as RecordStorage<
            string,
            BetterAuthVerificationRecord
          >;
          const originalRaceRead = raceStorage.read.bind(raceStorage);
          const originalRaceCas = raceStorage.compareAndSet.bind(raceStorage);
          let racingReads = 0;
          let secondReleased = false;
          let secondConsumeHeld = false;
          let enteredBoth!: () => void;
          let enteredCas!: () => void;
          let enteredSecondConsume!: () => void;
          let releaseFirst!: () => void;
          let releaseSecond!: () => void;
          let releaseCas!: () => void;
          let releaseSecondConsume!: () => void;
          const bothReading = new Promise<void>((resolve) => {
            enteredBoth = resolve;
          });
          const casPending = new Promise<void>((resolve) => {
            enteredCas = resolve;
          });
          const secondConsumePending = new Promise<void>((resolve) => {
            enteredSecondConsume = resolve;
          });
          const heldFirst = new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          const heldSecond = new Promise<void>((resolve) => {
            releaseSecond = resolve;
          });
          const heldCas = new Promise<void>((resolve) => {
            releaseCas = resolve;
          });
          const heldSecondConsume = new Promise<void>((resolve) => {
            releaseSecondConsume = resolve;
          });
          const raceRead = vi.spyOn(raceStorage, "read").mockImplementation(async (id) => {
            const row = await originalRaceRead(id);
            const reading = ++racingReads;
            if (reading === 1) await heldFirst;
            if (reading === 2) {
              enteredBoth();
              await heldSecond;
            }
            if (reading > 2 && secondReleased && !secondConsumeHeld) {
              secondConsumeHeld = true;
              enteredSecondConsume();
              await heldSecondConsume;
            }
            return row;
          });
          const raceCas = vi
            .spyOn(raceStorage, "compareAndSet")
            .mockImplementation(async (id, expected, next) => {
              if (next === undefined) {
                enteredCas();
                await heldCas;
              }
              return originalRaceCas(id, expected, next);
            });
          const firstResult = callback.onRequest(
            new Request(raceUrl, { headers: { cookie: raceCookie } }),
            new AbortController().signal,
          );
          const secondResult = callback.onRequest(
            new Request(raceUrl, { headers: { cookie: raceCookie } }),
            new AbortController().signal,
          );
          let raced: Response[];
          try {
            await bothReading;
            releaseFirst();
            await casPending;
            secondReleased = true;
            releaseSecond();
            await secondConsumePending;
            releaseCas();
            const winner = await firstResult;
            releaseSecondConsume();
            raced = [winner, await secondResult];
          } finally {
            releaseFirst();
            releaseSecond();
            releaseCas();
            releaseSecondConsume();
            raceRead.mockRestore();
            raceCas.mockRestore();
          }
          expect({
            success: raced.filter(
              (response) =>
                new URL(response.headers.get("location") ?? "", "http://localhost:3000")
                  .pathname === "/done",
            ).length,
            tokenRequests,
          }).toEqual({ success: 1, tokenRequests: beforeRaceTokens + 1 });
          expect(raced.map((response) => response.status).sort()).toEqual([302, 401]);
          expect(
            raced.filter((response) =>
              response.headers.getSetCookie().some((line) => line.includes("session_token=")),
            ),
          ).toHaveLength(1);
          const loser = raced.find((response) => response.status === 401);
          expect(loser?.headers.has("location")).toBe(false);
          expect(
            loser?.headers
              .getSetCookie()
              .some((line) => line.includes("state=") && line.includes("Max-Age=0")),
          ).toBe(true);
          expect(
            (await raceStorage.queryEntries({})).some(
              (entry) =>
                entry.record.identifier ===
                `auth-state:${raceRedirect.searchParams.get("state") ?? ""}`,
            ),
          ).toBe(false);

          const lateStart = await start.onRequest(
            new Request("http://localhost:3000/auth/sign-in/social", {
              method: "POST",
              headers: { origin: "http://localhost:3000", "content-type": "application/json" },
              body: JSON.stringify({
                provider: "company",
                callbackURL: "http://localhost:3000/done",
              }),
            }),
            new AbortController().signal,
          );
          const lateRedirect = new URL(((await lateStart.json()) as { url: string }).url);
          pending.set("late-consume", {
            challenge: lateRedirect.searchParams.get("code_challenge") ?? "",
            nonce: lateRedirect.searchParams.get("nonce") ?? "",
          });
          const lateCookie = lateStart.headers
            .getSetCookie()
            .map((line) => line.split(";")[0])
            .join("; ");
          const lateUrl = callbackUrl("late-consume", lateRedirect.searchParams.get("state"));
          const scopes = new AsyncLocalStorage<"first" | "second">();
          const reads = { first: 0, second: 0 };
          let enteredInitial!: () => void;
          let releaseInitial!: () => void;
          let enteredLateConsume!: () => void;
          let releaseLateConsume!: () => void;
          const bothInitial = new Promise<void>((resolve) => {
            enteredInitial = resolve;
          });
          const initialGate = new Promise<void>((resolve) => {
            releaseInitial = resolve;
          });
          const lateConsume = new Promise<void>((resolve) => {
            enteredLateConsume = resolve;
          });
          const consumeGate = new Promise<void>((resolve) => {
            releaseLateConsume = resolve;
          });
          let physicalLateRead = false;
          const lateRead = vi.spyOn(raceStorage, "read").mockImplementation(async (id) => {
            const scope = scopes.getStore();
            if (scope === undefined) return originalRaceRead(id);
            const count = ++reads[scope];
            if (count === 1) {
              const row = await originalRaceRead(id);
              if (reads.first === 1 && reads.second === 1) enteredInitial();
              await initialGate;
              return row;
            }
            if (scope === "second" && count === 2) {
              enteredLateConsume();
              await consumeGate;
              physicalLateRead = true;
            }
            return originalRaceRead(id);
          });
          const beforeLateTokens = tokenRequests;
          const beforeLateSessions = (await sessions.queryEntries({})).length;
          const firstLate = scopes.run("first", () =>
            callback.onRequest(
              new Request(lateUrl, { headers: { cookie: lateCookie } }),
              new AbortController().signal,
            ),
          );
          const secondLate = scopes.run("second", () =>
            callback.onRequest(
              new Request(lateUrl, { headers: { cookie: lateCookie } }),
              new AbortController().signal,
            ),
          );
          let lateResults: Response[];
          try {
            await bothInitial;
            releaseInitial();
            await lateConsume;
            const winner = await firstLate;
            expect(physicalLateRead).toBe(false);
            releaseLateConsume();
            lateResults = [winner, await secondLate];
          } finally {
            releaseInitial();
            releaseLateConsume();
            lateRead.mockRestore();
          }
          expect(reads.first).toBeGreaterThanOrEqual(3);
          expect(reads.second).toBe(2);
          expect(physicalLateRead).toBe(true);
          expect(lateResults.map((response) => response.status).sort()).toEqual([302, 401]);
          expect(lateResults[1]?.headers.has("location")).toBe(false);
          expect(
            lateResults.filter((response) =>
              response.headers.getSetCookie().some((line) => line.includes("session_token=")),
            ),
          ).toHaveLength(1);
          expect(tokenRequests).toBe(beforeLateTokens + 1);
          expect((await sessions.queryEntries({})).length).toBe(beforeLateSessions + 1);
          expect(
            (await raceStorage.queryEntries({})).some(
              (entry) =>
                entry.record.identifier ===
                `auth-state:${lateRedirect.searchParams.get("state") ?? ""}`,
            ),
          ).toBe(false);

          if (method === "none") {
            const heldStart = await start.onRequest(
              new Request("http://localhost:3000/auth/sign-in/social", {
                method: "POST",
                headers: { origin: "http://localhost:3000", "content-type": "application/json" },
                body: JSON.stringify({
                  provider: "company",
                  callbackURL: "http://localhost:3000/done",
                }),
              }),
              new AbortController().signal,
            );
            const heldRedirect = new URL(((await heldStart.json()) as { url: string }).url);
            pending.set("held-state", {
              challenge: heldRedirect.searchParams.get("code_challenge") ?? "",
              nonce: heldRedirect.searchParams.get("nonce") ?? "",
            });
            const heldCookie = heldStart.headers
              .getSetCookie()
              .map((line) => line.split(";")[0])
              .join("; ");
            const heldUrl = callbackUrl("held-state", heldRedirect.searchParams.get("state"));
            const verifications = acquired.mock.results[3]?.value as RecordStorage<
              string,
              BetterAuthVerificationRecord
            >;
            const read = verifications.read.bind(verifications);
            let reads = 0;
            let enteredRead!: () => void;
            let releaseRead!: () => void;
            const reading = new Promise<void>((resolve) => {
              enteredRead = resolve;
            });
            const heldRead = new Promise<void>((resolve) => {
              releaseRead = resolve;
            });
            const readSpy = vi.spyOn(verifications, "read").mockImplementation(async (id) => {
              const result = await read(id);
              if (++reads === 3) {
                enteredRead();
                await heldRead;
              }
              return result;
            });
            const cas = vi.spyOn(verifications, "compareAndSet");
            const controller = new AbortController();
            try {
              const cancelled = callback.onRequest(
                new Request(heldUrl, { headers: { cookie: heldCookie } }),
                controller.signal,
              );
              await reading;
              controller.abort();
              releaseRead();
              expect((await cancelled).status).toBe(503);
              expect(cas).not.toHaveBeenCalled();
            } finally {
              releaseRead();
              readSpy.mockRestore();
              cas.mockRestore();
            }
            const beforeRetry = tokenRequests;
            const retried = await callback.onRequest(
              new Request(heldUrl, { headers: { cookie: heldCookie } }),
              new AbortController().signal,
            );
            expect(retried.status).toBe(302);
            expect(tokenRequests).toBe(beforeRetry + 1);

            const failedStart = await start.onRequest(
              new Request("http://localhost:3000/auth/sign-in/social", {
                method: "POST",
                headers: { origin: "http://localhost:3000", "content-type": "application/json" },
                body: JSON.stringify({
                  provider: "company",
                  callbackURL: "http://localhost:3000/done",
                }),
              }),
              new AbortController().signal,
            );
            const failedRedirect = new URL(((await failedStart.json()) as { url: string }).url);
            pending.set("failed-state", {
              challenge: failedRedirect.searchParams.get("code_challenge") ?? "",
              nonce: failedRedirect.searchParams.get("nonce") ?? "",
            });
            const failedCookie = failedStart.headers
              .getSetCookie()
              .map((line) => line.split(";")[0])
              .join("; ");
            const failedUrl = callbackUrl("failed-state", failedRedirect.searchParams.get("state"));
            const beforeFailure = tokenRequests;
            const originalFailedRead = verifications.read.bind(verifications);
            let failedReads = 0;
            const readFailure = vi.spyOn(verifications, "read").mockImplementation(async (id) => {
              const row = await originalFailedRead(id);
              if (++failedReads === 3) throw new Error("State consume read unavailable.");
              return row;
            });
            const absentCas = vi.spyOn(verifications, "compareAndSet");
            try {
              const unavailable = await callback.onRequest(
                new Request(failedUrl, { headers: { cookie: failedCookie } }),
                new AbortController().signal,
              );
              expect(unavailable.status).toBe(503);
              expect(unavailable.headers.has("location")).toBe(false);
              expect(absentCas).not.toHaveBeenCalled();
              expect(tokenRequests).toBe(beforeFailure);
            } finally {
              readFailure.mockRestore();
              absentCas.mockRestore();
            }
            const storageFailure = vi
              .spyOn(verifications, "compareAndSet")
              .mockRejectedValueOnce(new Error("Verification storage unavailable."));
            try {
              const unavailable = await callback.onRequest(
                new Request(failedUrl, { headers: { cookie: failedCookie } }),
                new AbortController().signal,
              );
              expect(unavailable.status).toBe(503);
              expect(unavailable.headers.has("location")).toBe(false);
              expect(
                unavailable.headers.getSetCookie().some((line) => line.includes("session_token=")),
              ).toBe(false);
              expect(tokenRequests).toBe(beforeFailure);
              expect(rawErrors).not.toHaveBeenCalled();
            } finally {
              storageFailure.mockRestore();
            }
            const recovered = await callback.onRequest(
              new Request(failedUrl, { headers: { cookie: failedCookie } }),
              new AbortController().signal,
            );
            expect(recovered.status).toBe(302);
            expect(tokenRequests).toBe(beforeFailure + 1);

            const committingStart = await start.onRequest(
              new Request("http://localhost:3000/auth/sign-in/social", {
                method: "POST",
                headers: { origin: "http://localhost:3000", "content-type": "application/json" },
                body: JSON.stringify({
                  provider: "company",
                  callbackURL: "http://localhost:3000/done",
                }),
              }),
              new AbortController().signal,
            );
            const committingRedirect = new URL(
              ((await committingStart.json()) as { url: string }).url,
            );
            pending.set("committing", {
              challenge: committingRedirect.searchParams.get("code_challenge") ?? "",
              nonce: committingRedirect.searchParams.get("nonce") ?? "",
            });
            const committingCookie = committingStart.headers
              .getSetCookie()
              .map((line) => line.split(";")[0])
              .join("; ");
            const committingUrl = callbackUrl(
              "committing",
              committingRedirect.searchParams.get("state"),
            );
            const originalCas = verifications.compareAndSet.bind(verifications);
            let casEntered!: () => void;
            let releaseCas!: () => void;
            const committing = new Promise<void>((resolve) => {
              casEntered = resolve;
            });
            const heldCas = new Promise<void>((resolve) => {
              releaseCas = resolve;
            });
            const commitSpy = vi
              .spyOn(verifications, "compareAndSet")
              .mockImplementation(async (id, expected, next) => {
                const result = await originalCas(id, expected, next);
                if (next === undefined && result) {
                  casEntered();
                  await heldCas;
                }
                return result;
              });
            const committingSignal = new AbortController();
            const beforeCommitTokens = tokenRequests;
            try {
              const cancelled = callback.onRequest(
                new Request(committingUrl, { headers: { cookie: committingCookie } }),
                committingSignal.signal,
              );
              await committing;
              committingSignal.abort();
              releaseCas();
              expect((await cancelled).status).toBe(503);
              expect(tokenRequests).toBe(beforeCommitTokens);
            } finally {
              releaseCas();
              commitSpy.mockRestore();
            }
            expect(
              (await verifications.queryEntries({})).some(
                (entry) =>
                  entry.record.identifier ===
                  `auth-state:${committingRedirect.searchParams.get("state") ?? ""}`,
              ),
            ).toBe(false);
            const consumed = await callback.onRequest(
              new Request(committingUrl, { headers: { cookie: committingCookie } }),
              new AbortController().signal,
            );
            expect(consumed.status).toBe(401);
            expect(tokenRequests).toBe(beforeCommitTokens);
          }

          const before = (await sessions.queryEntries({})).length;
          let entered!: () => void;
          let release!: () => void;
          const writing = new Promise<void>((resolve) => {
            entered = resolve;
          });
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          const original = sessions.compareAndSet.bind(sessions);
          const paused = vi
            .spyOn(sessions, "compareAndSet")
            .mockImplementation(async (id, expected, next) => {
              const committed = await original(id, expected, next);
              if (expected === undefined && next !== undefined) {
                entered();
                await held;
              }
              return committed;
            });
          try {
            const next = await start.onRequest(
              new Request("http://localhost:3000/auth/sign-in/social", {
                method: "POST",
                headers: { origin: "http://localhost:3000", "content-type": "application/json" },
                body: JSON.stringify({
                  provider: "company",
                  callbackURL: "http://localhost:3000/done",
                }),
              }),
              new AbortController().signal,
            );
            const second = new URL(((await next.json()) as { url: string }).url);
            pending.set("second", {
              challenge: second.searchParams.get("code_challenge") ?? "",
              nonce: second.searchParams.get("nonce") ?? "",
            });
            const secondCookie = next.headers
              .getSetCookie()
              .map((line) => line.split(";")[0])
              .join("; ");
            const controller = new AbortController();
            const late = callback.onRequest(
              new Request(callbackUrl("second", second.searchParams.get("state")), {
                headers: { cookie: secondCookie },
              }),
              controller.signal,
            );
            await writing;
            controller.abort();
            release();
            const refused = await late;
            expect(refused.status).toBe(503);
            expect(refused.headers.getSetCookie()).toHaveLength(0);
            expect((await sessions.queryEntries({})).length).toBe(before);
          } finally {
            release();
            paused.mockRestore();
          }
          if (method === "none") {
            const verifications = acquired.mock.results[3]?.value as RecordStorage<
              string,
              BetterAuthVerificationRecord
            >;
            const expiredStart = await start.onRequest(
              new Request("http://localhost:3000/auth/sign-in/social", {
                method: "POST",
                headers: { origin: "http://localhost:3000", "content-type": "application/json" },
                body: JSON.stringify({
                  provider: "company",
                  callbackURL: "http://localhost:3000/done",
                }),
              }),
              new AbortController().signal,
            );
            const expiredRedirect = new URL(((await expiredStart.json()) as { url: string }).url);
            const expiredState = expiredRedirect.searchParams.get("state") ?? "";
            const physical = (await verifications.queryEntries({})).find(
              (entry) => entry.record.identifier === `auth-state:${expiredState}`,
            );
            if (physical === undefined) throw new Error("Native Verification row absent.");
            expect(
              await verifications.compareAndSet(physical.id, physical.record, {
                ...physical.record,
                expiresAt: timestampFromDate(new Date(0)),
              }),
            ).toBe(true);
            const expiredCookie = expiredStart.headers
              .getSetCookie()
              .map((line) => line.split(";")[0])
              .join("; ");
            const beforeExpired = tokenRequests;
            const expired = await callback.onRequest(
              new Request(callbackUrl("expired", expiredState), {
                headers: { cookie: expiredCookie },
              }),
              new AbortController().signal,
            );
            expect(expired.status).toBe(401);
            expect(tokenRequests).toBe(beforeExpired);
            expect(await verifications.read(physical.id)).toBeDefined();
            await store.purgeExpired(timestampFromDate(new Date(0)));
            expect(await verifications.read(physical.id)).toBeUndefined();

            const accounts = acquired.mock.results[1]?.value as RecordStorage<
              string,
              BetterAuthAccountRecord
            >;
            const account = (await accounts.queryEntries({}))[0];
            if (account === undefined) throw new Error("Prelinked Account absent in fixture.");
            expect(await accounts.compareAndSet(account.id, account.record, undefined)).toBe(true);
            const unknownStart = await start.onRequest(
              new Request("http://localhost:3000/auth/sign-in/social", {
                method: "POST",
                headers: { origin: "http://localhost:3000", "content-type": "application/json" },
                body: JSON.stringify({
                  provider: "company",
                  callbackURL: "http://localhost:3000/done",
                }),
              }),
              new AbortController().signal,
            );
            const unknownRedirect = new URL(((await unknownStart.json()) as { url: string }).url);
            pending.set("unknown-account", {
              challenge: unknownRedirect.searchParams.get("code_challenge") ?? "",
              nonce: unknownRedirect.searchParams.get("nonce") ?? "",
            });
            const unknownCookie = unknownStart.headers
              .getSetCookie()
              .map((line) => line.split(";")[0])
              .join("; ");
            const beforeUnknown = (await sessions.queryEntries({})).length;
            const unknown = await callback.onRequest(
              new Request(
                callbackUrl("unknown-account", unknownRedirect.searchParams.get("state")),
                {
                  headers: { cookie: unknownCookie },
                },
              ),
              new AbortController().signal,
            );
            expect(unknown.status).toBe(401);
            expect(unknown.headers.has("location")).toBe(false);
            expect(
              unknown.headers.getSetCookie().some((line) => line.includes("session_token=")),
            ).toBe(false);
            expect((await sessions.queryEntries({})).length).toBe(beforeUnknown);
            expect(rawErrors).not.toHaveBeenCalled();
          }
          if (method === "none") {
            let startedCloseToken!: () => void;
            let releaseCloseToken!: () => void;
            const tokenReading = new Promise<void>((resolve) => {
              startedCloseToken = resolve;
            });
            tokenHold = new Promise<void>((resolve) => {
              releaseCloseToken = resolve;
            });
            tokenStarted = startedCloseToken;
            try {
              const closingStart = await start.onRequest(
                new Request("http://localhost:3000/auth/sign-in/social", {
                  method: "POST",
                  headers: { origin: "http://localhost:3000", "content-type": "application/json" },
                  body: JSON.stringify({
                    provider: "company",
                    callbackURL: "http://localhost:3000/done",
                  }),
                }),
                new AbortController().signal,
              );
              const closingRedirect = new URL(((await closingStart.json()) as { url: string }).url);
              pending.set("closing", {
                challenge: closingRedirect.searchParams.get("code_challenge") ?? "",
                nonce: closingRedirect.searchParams.get("nonce") ?? "",
              });
              const closingCookie = closingStart.headers
                .getSetCookie()
                .map((line) => line.split(";")[0])
                .join("; ");
              const beforeClose = (await sessions.queryEntries({})).length;
              const closingCallback = callback.onRequest(
                new Request(callbackUrl("closing", closingRedirect.searchParams.get("state")), {
                  headers: { cookie: closingCookie },
                }),
                new AbortController().signal,
              );
              await tokenReading;
              const close = auth.close();
              releaseCloseToken();
              expect((await closingCallback).status).toBe(503);
              await close;
              expect((await sessions.queryEntries({})).length).toBe(beforeClose);
            } finally {
              releaseCloseToken();
              tokenHold = undefined;
              tokenStarted = undefined;
            }

            const closingAuth = await BetterAuthIntegration.create({
              store,
              routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
              options: {
                baseURL: "http://localhost:3000",
                basePath: "/auth",
                secret: "native-oidc-secret-at-least-32-characters",
                trustedOrigins: ["http://localhost:3000"],
                plugins: [
                  genericOAuth({
                    config: [
                      {
                        providerId: "company",
                        discoveryUrl: `${issuer}/metadata/custom`,
                        clientId: "client",
                        tokenEndpointAuth: { method: "none" },
                        pkce: true,
                        requireIdTokenVerification: true,
                        disableSignUp: true,
                        overrideUserInfo: false,
                      },
                    ],
                  }),
                ],
              },
              onPrincipal: (resolved) => Promise.resolve({ id: resolved.id }),
            });
            try {
              const closeStart = closingAuth.routes.find(
                (route) => route.path === "/auth/sign-in/social",
              );
              const closeCallback = closingAuth.routes.find(
                (route) => route.path === "/auth/callback/company",
              );
              if (closeStart === undefined || closeCallback === undefined)
                throw new Error("Closing integration omitted native routes.");
              const begun = await closeStart.onRequest(
                new Request("http://localhost:3000/auth/sign-in/social", {
                  method: "POST",
                  headers: { origin: "http://localhost:3000", "content-type": "application/json" },
                  body: JSON.stringify({
                    provider: "company",
                    callbackURL: "http://localhost:3000/done",
                  }),
                }),
                new AbortController().signal,
              );
              const destination = new URL(((await begun.json()) as { url: string }).url);
              const closeCookie = begun.headers
                .getSetCookie()
                .map((line) => line.split(";")[0])
                .join("; ");
              const verification = acquired.mock.results[3]?.value as RecordStorage<
                string,
                BetterAuthVerificationRecord
              >;
              const originalCloseCas = verification.compareAndSet.bind(verification);
              let enteredCloseCas!: () => void;
              let releaseCloseCas!: () => void;
              const startedCloseCas = new Promise<void>((resolve) => {
                enteredCloseCas = resolve;
              });
              const heldCloseCas = new Promise<void>((resolve) => {
                releaseCloseCas = resolve;
              });
              const closeCas = vi
                .spyOn(verification, "compareAndSet")
                .mockImplementation(async (id, expected, next) => {
                  const committed = await originalCloseCas(id, expected, next);
                  if (next === undefined && committed) {
                    enteredCloseCas();
                    await heldCloseCas;
                  }
                  return committed;
                });
              try {
                const beforeCloseTokens = tokenRequests;
                const pendingCallback = closeCallback.onRequest(
                  new Request(callbackUrl("closing-cas", destination.searchParams.get("state")), {
                    headers: { cookie: closeCookie },
                  }),
                  new AbortController().signal,
                );
                await startedCloseCas;
                const closing = closingAuth.close();
                let drained = false;
                void closing.then(() => {
                  drained = true;
                });
                await Promise.resolve();
                expect(drained).toBe(false);
                releaseCloseCas();
                expect((await pendingCallback).status).toBe(503);
                await closing;
                expect(tokenRequests).toBe(beforeCloseTokens);
              } finally {
                releaseCloseCas();
                closeCas.mockRestore();
              }
            } finally {
              await closingAuth.close();
            }
          }
        } finally {
          await auth.close();
        }
      } finally {
        rawErrors.mockRestore();
        await store.close();
        await factory.close();
        provider.close();
        await once(provider, "close");
      }
    },
  );

  it("publishes only exact initialized provider routes and resolved state cookie", async () => {
    let discoveryReads = 0;
    let issuer = "";
    let releaseDiscovery!: () => void;
    let firstDiscovery!: () => void;
    const discoveryStarted = new Promise<void>((resolve) => {
      firstDiscovery = resolve;
    });
    const discoveryGate = new Promise<void>((resolve) => {
      releaseDiscovery = resolve;
    });
    // The held discovery request is released in the test's finally path.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    const provider = createServer(async (request, response) => {
      if (request.url !== "/metadata/custom") {
        response.writeHead(404).end();
        return;
      }
      discoveryReads++;
      if (discoveryReads === 1) {
        firstDiscovery();
        await discoveryGate;
      }
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/keys/nonconventional.json`,
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      );
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const address = provider.address();
    if (address === null || typeof address === "string")
      throw new Error("Provider did not listen.");
    issuer = `http://127.0.0.1:${String(address.port)}`;
    const factory = new InMemoryStorageFactory();
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better_auth_oidc_startup"),
      models: ["user", "account", "session", "verification"],
    });
    try {
      let published = false;
      const creation = BetterAuthIntegration.create({
        store,
        routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
        options: {
          baseURL: "http://localhost:3000",
          basePath: "/auth",
          secret: "native-oidc-secret-at-least-32-characters",
          trustedOrigins: ["http://localhost:3000"],
          advanced: {
            useSecureCookies: true,
            cookiePrefix: "company",
            cookies: { state: { name: "login-flow" } },
          },
          plugins: [
            genericOAuth({
              config: [
                {
                  providerId: "company",
                  discoveryUrl: `${issuer}/metadata/custom`,
                  clientId: "client",
                  tokenEndpointAuth: { method: "none" },
                  pkce: true,
                  requireIdTokenVerification: true,
                  disableSignUp: true,
                  overrideUserInfo: false,
                },
                {
                  providerId: "department",
                  discoveryUrl: `${issuer}/metadata/custom`,
                  clientId: "department-client",
                  tokenEndpointAuth: { method: "none" },
                  pkce: true,
                  requireIdTokenVerification: true,
                  disableSignUp: true,
                  overrideUserInfo: false,
                },
              ],
            }),
          ],
        },
        onPrincipal: (user) => Promise.resolve({ id: user.id }),
      }).then((integration) => {
        published = true;
        return integration;
      });
      await discoveryStarted;
      expect(published).toBe(false);
      releaseDiscovery();
      const auth = await creation;
      try {
        expect(auth.routes.map((route) => route.path)).toContain("/auth/sign-in/social");
        expect(auth.routes.map((route) => route.path)).toContain("/auth/callback/company");
        expect(auth.routes.map((route) => route.path)).toContain("/auth/callback/department");
        expect(
          auth.routes.find((route) => route.path === "/auth/callback/company")?.allowMissingOrigin,
        ).toBe(true);
        const declared = auth.routes.find((route) => route.path === "/auth/callback/company")
          ?.admission.stateCookieNames;
        expect(declared?.some((name) => name.includes("login-flow"))).toBe(true);
        expect(discoveryReads).toBe(4);
        const start = auth.routes.find((route) => route.path === "/auth/sign-in/social");
        if (start === undefined) throw new Error("Native social route missing.");
        const response = await start.onRequest(
          new Request("http://localhost:3000/auth/sign-in/social", {
            method: "POST",
            headers: { origin: "http://localhost:3000", "content-type": "application/json" },
            body: JSON.stringify({
              provider: "company",
              callbackURL: "http://localhost:3000/done",
            }),
          }),
          new AbortController().signal,
        );
        expect(response.status).toBe(200);
        expect(
          response.headers
            .getSetCookie()
            .some((line) => declared?.some((name) => line.startsWith(`${name}=`))),
        ).toBe(true);
        expect(discoveryReads).toBe(4);
      } finally {
        await auth.close();
      }
    } finally {
      await store.close();
      await factory.close();
      releaseDiscovery();
      provider.close();
      await once(provider, "close");
    }
  });
});
