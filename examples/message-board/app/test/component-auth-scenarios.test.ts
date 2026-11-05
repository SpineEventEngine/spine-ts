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
import { createHash } from "node:crypto";
import { once } from "node:events";

import {
  OidcFlow,
  OpaqueSessions,
  SignedSessions,
  createOidcProvider,
  type ConfiguredOidcProvider,
} from "@spine-event-engine/auth";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it, vi } from "vitest";

import { ComponentAuthScenarios } from "../src/component-auth-scenarios.js";

const password = "message-board-example-seal-password-at-least-32-characters";
const fixtureProvider: ConfiguredOidcProvider = {
  authorizationEndpoint: "https://fixture.example.test/authorize",
  recommendedScopes: ["openid"],
  provider: {
    issuer: "https://fixture.example.test",
    exchangeAuthorizationCode: ({ code }) =>
      Promise.resolve(
        code === "local-code"
          ? { issuer: "https://fixture.example.test", subject: "fixture-user" }
          : undefined,
      ),
  },
};

describe("Message Board component authentication examples", () => {
  it("issues, resolves, logs out and explicitly maintains opaque sessions", async () => {
    expect(await ComponentAuthScenarios.opaque(password)).toEqual({
      resolved: true,
      revoked: true,
      removed: 0,
    });
  });

  it("closes partial opaque setup when the application password is invalid", async () => {
    const closed = vi.spyOn(InMemoryStorageFactory.prototype, "close");
    try {
      await expect(ComponentAuthScenarios.opaque("short")).rejects.toThrow();
      expect(closed).toHaveBeenCalledOnce();
    } finally {
      closed.mockRestore();
    }
  });

  it("reports a refused opaque issuance without returning a credential", async () => {
    const issue = vi
      .spyOn(OpaqueSessions.prototype, "issue")
      .mockResolvedValue({ kind: "rejected", reason: "capacity-exceeded" });
    try {
      await expect(ComponentAuthScenarios.opaque(password)).rejects.toThrow(/not issued/u);
    } finally {
      issue.mockRestore();
    }
  });

  it("issues, verifies and revokes a signed session with explicit maintenance", async () => {
    expect(await ComponentAuthScenarios.signed()).toEqual({
      resolved: true,
      revoked: true,
      removed: 0,
    });
  });

  it("reports a refused signed issuance without returning a credential", async () => {
    const issue = vi
      .spyOn(SignedSessions.prototype, "issue")
      .mockResolvedValue({ kind: "rejected", reason: "principal-invalid" });
    try {
      await expect(ComponentAuthScenarios.signed()).rejects.toThrow(/not issued/u);
    } finally {
      issue.mockRestore();
    }
  });

  it("persists a component OIDC transaction and grant before issuing one session", async () => {
    expect(
      await ComponentAuthScenarios.oidc(fixtureProvider, password, (authorizationUrl) =>
        Promise.resolve({
          code: "local-code",
          state: new URL(authorizationUrl).searchParams.get("state") ?? "",
          responseIssuer: fixtureProvider.provider.issuer,
        }),
      ),
    ).toEqual({
      issued: true,
      replayRejected: true,
      resolved: true,
      removed: { transactions: 0, grants: 0 },
    });
  });

  it("consumes an invalid callback state without invoking its provider", async () => {
    const exchange = vi.spyOn(fixtureProvider.provider, "exchangeAuthorizationCode");
    try {
      await expect(
        ComponentAuthScenarios.oidc(fixtureProvider, password, () =>
          Promise.resolve({ state: "unissued-state", code: "local-code" }),
        ),
      ).rejects.toThrow(/callback was not granted/u);
      expect(exchange).not.toHaveBeenCalled();
    } finally {
      exchange.mockRestore();
    }
  });

  it("does not hand off a refused OIDC start", async () => {
    const started = vi
      .spyOn(OidcFlow.prototype, "start")
      .mockResolvedValue({ kind: "rejected", reason: "invalid-input" });
    const handoff = vi.fn(() => Promise.resolve({ state: "unused", code: "unused" }));
    try {
      await expect(ComponentAuthScenarios.oidc(fixtureProvider, password, handoff)).rejects.toThrow(
        /not persisted/u,
      );
      expect(handoff).not.toHaveBeenCalled();
    } finally {
      started.mockRestore();
    }
  });

  it("does not return a credential when application session issuance refuses a grant", async () => {
    const issue = vi
      .spyOn(OpaqueSessions.prototype, "issue")
      .mockResolvedValue({ kind: "rejected", reason: "capacity-exceeded" });
    try {
      await expect(
        ComponentAuthScenarios.oidc(fixtureProvider, password, (url) =>
          Promise.resolve({
            state: new URL(url).searchParams.get("state") ?? "",
            code: "local-code",
          }),
        ),
      ).rejects.toThrow(/not issued/u);
    } finally {
      issue.mockRestore();
    }
  });

  it("uses the authorization URL to complete a real local token and JWKS exchange", async () => {
    const issuer = "https://issuer.example.test";
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const key = { ...(await exportJWK(publicKey)), kid: "example-key", alg: "RS256", use: "sig" };
    let challenge = "";
    let nonce = "";
    let tokenPosts = 0;
    let tokenAccepted = false;
    let keyRequests = 0;
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    const server = createServer(async (request, response) => {
      if (request.url === "/token") {
        tokenPosts++;
        let body = "";
        for await (const part of request) body += String(part);
        const fields = new URLSearchParams(body);
        if (
          fields.get("code") !== "local-code" ||
          createHash("sha256")
            .update(fields.get("code_verifier") ?? "")
            .digest("base64url") !== challenge
        ) {
          response.writeHead(400).end();
          return;
        }
        tokenAccepted = true;
        const idToken = await new SignJWT({ nonce })
          .setProtectedHeader({ alg: "RS256", kid: "example-key", typ: "JWT" })
          .setIssuer(issuer)
          .setAudience("message-board-client")
          .setSubject("verified-user")
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(privateKey);
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ id_token: idToken }));
        return;
      }
      if (request.url === "/keys") {
        keyRequests++;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ keys: [key] }));
        return;
      }
      response.writeHead(404).end();
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("Provider did not listen.");
      const configured = createOidcProvider({
        issuer,
        authorizationEndpoint: `${issuer}/authorize`,
        tokenEndpoint: `${issuer}/token`,
        jwksEndpoint: `${issuer}/keys`,
        clientId: "message-board-client",
        fetch: (url, init) => {
          const target = new URL(url);
          return fetch(`http://127.0.0.1:${String(address.port)}${target.pathname}`, init);
        },
      });
      const result = await ComponentAuthScenarios.oidc(configured, password, (url) => {
        const query = new URL(url).searchParams;
        nonce = query.get("nonce") ?? "";
        challenge = query.get("code_challenge") ?? "";
        return Promise.resolve({
          code: "local-code",
          state: query.get("state") ?? "",
          responseIssuer: issuer,
        });
      });
      expect(result).toMatchObject({ issued: true, replayRejected: true, resolved: true });
      expect(tokenPosts).toBe(1);
      expect(tokenAccepted).toBe(true);
      expect(keyRequests).toBe(1);
    } finally {
      if (server.listening)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          }),
        );
    }
  });
});
