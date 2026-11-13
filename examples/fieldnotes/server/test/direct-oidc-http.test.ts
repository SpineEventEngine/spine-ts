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
import { createServer } from "node:http";
import { createOidcProvider, type ProviderFetch } from "@spine-event-engine/auth";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { expect, it } from "vitest";
import { FieldnotesHost } from "../src/fieldnotes-host.js";
import type { FieldnotesSettings } from "../src/host-settings.js";

const origin = "https://localhost:3000";
const issuer = "https://issuer.example/oidc";
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

it("exchanges a signed local OIDC code through the real auth routes", async () => {
  const keys = await generateKeyPair("RS256");
  const jwk = await exportJWK(keys.publicKey);
  Object.assign(jwk, { kid: "fieldnotes-test", alg: "RS256", use: "sig" });
  let expectedNonce = "";
  let providerChallenge = "";
  let tokenPosts = 0;
  let acceptedProviderRequest = false;
  let keysRequested = false;
  let providerChecks: Record<string, boolean> = {};
  const provider = createServer((request, response) => {
    void (async () => {
      if (request.url === "/oidc/keys") {
        keysRequested = true;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      if (request.url !== "/oidc/token" || request.method !== "POST") {
        response.writeHead(404).end();
        return;
      }
      tokenPosts += 1;
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
      const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      const verifier = body.get("code_verifier") ?? "";
      const actualChallenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
      providerChecks = {
        code: body.get("code") === "signed-code",
        redirect: body.get("redirect_uri") === `${origin}/auth/google/callback`,
        challenge: actualChallenge === providerChallenge,
        basicPresent: request.headers.authorization?.startsWith("Basic ") ?? false,
      };
      if (Object.values(providerChecks).some((ok) => !ok)) {
        response.writeHead(400).end();
        return;
      }
      acceptedProviderRequest = true;
      const signed = await new SignJWT({ nonce: expectedNonce })
        .setProtectedHeader({ alg: "RS256", kid: "fieldnotes-test", typ: "JWT" })
        .setIssuer(issuer)
        .setAudience("client-id")
        .setSubject("signed-user")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(keys.privateKey);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ id_token: signed }));
    })().catch(() => response.writeHead(500).end());
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  let host: FieldnotesHost | undefined;
  try {
    const address = provider.address();
    if (address === null || typeof address === "string")
      throw new Error("OIDC fixture has no port.");
    const transport: ProviderFetch = (url, init) => {
      const parsed = new URL(url);
      return fetch(
        `http://127.0.0.1:${String(address.port)}${parsed.pathname}${parsed.search}`,
        init,
      );
    };
    const configured = createOidcProvider({
      issuer,
      authorizationEndpoint: `${issuer}/authorize`,
      tokenEndpoint: `${issuer}/token`,
      jwksEndpoint: `${issuer}/keys`,
      clientId: "client-id",
      clientSecret: "client-secret",
      clientAuthentication: "client_secret_basic",
      fetch: transport,
    });
    host = await FieldnotesHost.open(settings(), {
      storageFactory: new InMemoryStorageFactory(),
      authentication: { mode: "google", clientId: "client-id", clientSecret: "client-secret" },
      googleProvider: configured,
    });
    const base = host.gateway.baseUrl;
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: { origin, "content-type": "application/json", "x-fieldnotes-auth": "1" },
        body: JSON.stringify(body),
      });
    const browserVerifier = "b".repeat(43);
    const browserChallenge = createHash("sha256")
      .update(browserVerifier, "ascii")
      .digest("base64url");
    const started = await post("/auth/google/start", { codeChallenge: browserChallenge });
    expect(started.status).toBe(200);
    const start: unknown = await started.json();
    if (
      typeof start !== "object" ||
      start === null ||
      !("authorizationUrl" in start) ||
      typeof start.authorizationUrl !== "string"
    )
      throw new Error("OIDC start response lacks an authorization URL.");
    const authorization = new URL(start.authorizationUrl);
    expectedNonce = authorization.searchParams.get("nonce") ?? "";
    providerChallenge = authorization.searchParams.get("code_challenge") ?? "";
    expect(expectedNonce).not.toBe("");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    const state = authorization.searchParams.get("state");
    if (!state) throw new Error("OIDC state is missing.");
    const callback = await fetch(
      `${base}/auth/google/callback?state=${encodeURIComponent(state)}&code=signed-code&iss=${encodeURIComponent(issuer)}`,
      { redirect: "manual" },
    );
    expect(
      callback.status,
      JSON.stringify({ tokenPosts, acceptedProviderRequest, keysRequested, providerChecks }),
    ).toBe(303);
    const completion = callback.headers.get("location");
    if (!completion) throw new Error("OIDC completion Location is missing.");
    const grant = new URL(completion).hash.slice("#grant=".length);
    const issued = await post("/auth/google/exchange", { grant, codeVerifier: browserVerifier });
    expect(issued.status).toBe(200);
    expect(issued.headers.getSetCookie()).toHaveLength(2);
    expect(tokenPosts).toBe(1);
  } finally {
    await host?.close();
    provider.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      provider.close((error) => {
        if (error) reject(error);
        else resolve();
      }),
    );
  }
});
