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

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import {
  BetterAuthAccountRecordSchema,
  BetterAuthSessionRecordSchema,
  BetterAuthUserRecordSchema,
  BetterAuthVerificationRecordSchema,
} from "@spine-event-engine/proto/auth";
import { StorageGroup } from "@spine-event-engine/storage";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { betterAuth } from "better-auth";
import type { AdapterFactory } from "better-auth/adapters";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it, vi } from "vitest";

import {
  BetterAuthIntegration,
  PersistentBetterAuthStore,
  genericOAuth,
} from "../../src/better-auth/index.js";
import { nativeFactoryFor } from "../../src/better-auth/persistent-store.js";

const postgres = process.env.SPINE_TS_POSTGRESQL_URL;

describe.skipIf(postgres === undefined)("native OIDC across Node processes", () => {
  it("allows one cookie-validated callback to consume shared state and issue a Session", async () => {
    if (postgres === undefined) throw new Error("PostgreSQL URL is required.");
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const key = { ...(await exportJWK(publicKey)), kid: "process-key", alg: "RS256", use: "sig" };
    const pending = new Map<string, { challenge: string; nonce: string }>();
    const gates: ServerResponse[] = [];
    let issuer = "";
    let tokenRequests = 0;
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    const provider = createServer(async (request, response) => {
      if (request.url === "/metadata/custom") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/keys.json`,
            userinfo_endpoint: `${issuer}/userinfo`,
            id_token_signing_alg_values_supported: ["RS256"],
          }),
        );
        return;
      }
      if (request.url === "/gate") {
        gates.push(response);
        if (gates.length === 2) for (const gate of gates) gate.writeHead(200).end();
        return;
      }
      if (request.url === "/keys.json") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ keys: [key] }));
        return;
      }
      if (request.url === "/token") {
        tokenRequests++;
        let body = "";
        for await (const part of request) body += String(part);
        const form = new URLSearchParams(body);
        const selected = pending.get(form.get("code") ?? "");
        if (
          !selected?.challenge ||
          createHash("sha256")
            .update(form.get("code_verifier") ?? "")
            .digest("base64url") !== selected.challenge
        ) {
          response.writeHead(400).end();
          return;
        }
        const idToken = await new SignJWT({
          nonce: selected.nonce,
          email: "ada@example.test",
          email_verified: true,
          name: "Ada",
        })
          .setProtectedHeader({ alg: "RS256", kid: "process-key" })
          .setIssuer(issuer)
          .setAudience("client")
          .setSubject("subject-1")
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(privateKey);
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            access_token: "access",
            token_type: "Bearer",
            expires_in: 3600,
            id_token: idToken,
          }),
        );
        return;
      }
      if (request.url === "/userinfo") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            sub: "subject-1",
            email: "ada@example.test",
            email_verified: true,
            name: "Ada",
          }),
        );
        return;
      }
      response.writeHead(404).end();
    });
    let factory: PostgresStorageFactory | undefined;
    let store: PersistentBetterAuthStore | undefined;
    let integration: BetterAuthIntegration | undefined;
    let expectedCloseFailure: Error | undefined;
    let observedCloseFailure: unknown;
    let unexpectedCloseFailure: Error | undefined;
    const closeOrder: string[] = [];
    try {
      provider.listen(0, "127.0.0.1");
      await once(provider, "listening");
      const address = provider.address();
      if (address === null || typeof address === "string")
        throw new Error("Provider did not listen.");
      issuer = `http://127.0.0.1:${String(address.port)}`;
      const registry = new StringifierRegistry();
      registry.setTypeRegistry(
        new TypeRegistry([
          BetterAuthUserRecordSchema,
          BetterAuthAccountRecordSchema,
          BetterAuthSessionRecordSchema,
          BetterAuthVerificationRecordSchema,
        ]),
      );
      factory = await PostgresStorageFactory.newBuilder()
        .setOptions({ url: postgres })
        .setStringifierRegistry(registry)
        .build();
      const group = new StorageGroup(
        `orders_better_auth_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      );
      store = await PersistentBetterAuthStore.create({
        storageFactory: factory,
        group,
        models: ["user", "account", "session", "verification"],
      });
      const now = new Date();
      await store.provision({
        users: [
          {
            id: "user-1",
            name: "Ada",
            email: "ada@example.test",
            emailVerified: true,
            createdAt: now,
            updatedAt: now,
          },
        ],
        accounts: [
          {
            userId: "user-1",
            providerId: "company",
            accountId: "subject-1",
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
      integration = await BetterAuthIntegration.create({
        store,
        routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
        options: {
          baseURL: "http://localhost:3000",
          basePath: "/auth",
          secret: "native-process-oidc-secret-at-least-32-characters",
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
      });
      const start = integration.routes.find((route) => route.path === "/auth/sign-in/social");
      if (start === undefined) throw new Error("Native start route was absent.");
      const started = await start.onRequest(
        new Request("http://localhost:3000/auth/sign-in/social", {
          method: "POST",
          headers: { origin: "http://localhost:3000", "content-type": "application/json" },
          body: JSON.stringify({ provider: "company", callbackURL: "http://localhost:3000/done" }),
        }),
        new AbortController().signal,
      );
      expect(started.status).toBe(200);
      const redirect = new URL(((await started.json()) as { url: string }).url);
      pending.set("process-race", {
        challenge: redirect.searchParams.get("code_challenge") ?? "",
        nonce: redirect.searchParams.get("nonce") ?? "",
      });
      const cookie = started.headers
        .getSetCookie()
        .map((line) => line.split(";")[0])
        .join("; ");
      const callback = new URL("http://localhost:3000/auth/callback/company");
      callback.searchParams.set("code", "process-race");
      callback.searchParams.set("state", redirect.searchParams.get("state") ?? "");
      const child = fileURLToPath(new URL("./fresh-process-oidc-callback.mjs", import.meta.url));
      const args = [child, group.name, issuer, callback.href, cookie];
      const first = promisify(execFile)(process.execPath, args, {
        env: process.env,
        timeout: 20_000,
      });
      const second = promisify(execFile)(process.execPath, args, {
        env: process.env,
        timeout: 20_000,
      });
      const results = await Promise.all([first, second]);
      expect(gates).toHaveLength(2);
      expect(results.map((result) => Number(result.stdout.trim())).sort()).toEqual([302, 401]);
      expect(tokenRequests).toBe(1);
      const native = betterAuth({
        database: nativeFactoryFor(store) as AdapterFactory<Parameters<typeof betterAuth>[0]>,
        secret: "native-process-oidc-secret-at-least-32-characters",
        baseURL: "http://localhost:3000",
        advanced: { database: { validateSchema: false } },
      });
      const adapter = (await native.$context).adapter;
      expect(await adapter.count({ model: "session" })).toBe(1);
      expect(
        await adapter.findMany({
          model: "verification",
          where: [
            {
              field: "identifier",
              value: `auth-state:${redirect.searchParams.get("state") ?? ""}`,
            },
          ],
          sortBy: { field: "createdAt", direction: "desc" },
          limit: 1,
        }),
      ).toHaveLength(0);
      const close = integration.close.bind(integration);
      expectedCloseFailure = new Error("injected integration close failure");
      const failure = expectedCloseFailure;
      vi.spyOn(integration, "close").mockImplementationOnce(async () => {
        closeOrder.push("integration");
        await close();
        throw failure;
      });
      const closeStore = store.close.bind(store);
      vi.spyOn(store, "close").mockImplementationOnce(async () => {
        closeOrder.push("store");
        await closeStore();
      });
      const closeFactory = factory.close.bind(factory);
      vi.spyOn(factory, "close").mockImplementationOnce(async () => {
        closeOrder.push("factory");
        await closeFactory();
      });
    } finally {
      try {
        try {
          await integration?.close();
        } finally {
          try {
            await store?.close();
          } finally {
            try {
              await factory?.close();
            } finally {
              try {
                for (const gate of gates) if (!gate.writableEnded) gate.writeHead(503).end();
              } finally {
                if (provider.listening)
                  await new Promise<void>((resolve, reject) =>
                    provider.close((error) => {
                      if (error) reject(error);
                      else resolve();
                    }),
                  );
                closeOrder.push("provider");
              }
            }
          }
        }
      } catch (error) {
        if (error === expectedCloseFailure) observedCloseFailure = error;
        else
          unexpectedCloseFailure =
            error instanceof Error
              ? error
              : new Error("Native proof cleanup failed.", { cause: error });
      }
    }
    if (unexpectedCloseFailure !== undefined) throw unexpectedCloseFailure;
    expect(observedCloseFailure).toBe(expectedCloseFailure);
    expect(closeOrder).toEqual(["integration", "store", "factory", "provider"]);
    expect(provider.listening).toBe(false);
  }, 30_000);
});
