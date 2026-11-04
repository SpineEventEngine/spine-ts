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

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";

import {
  createOidcProvider,
  discoverOidcProvider,
  type ProviderFetch,
} from "../../src/providers/index.js";

const issuer = "https://issuer.example/oidc";
const callbackUri = "https://app.example/callback?fixed=one%20two";

describe("OIDC over a local HTTP server", () => {
  it("uses exact custom discovery, one token POST, and cached JWKS for a signed identity", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const key = await exportJWK(publicKey);
    Object.assign(key, { kid: "test-key", alg: "RS256", use: "sig" });
    const token = await new SignJWT({ nonce: "nonce", email: "user@example.test" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "JWT" })
      .setIssuer(issuer)
      .setAudience("browser-app")
      .setSubject("user-42")
      .setIssuedAt(1)
      .setExpirationTime(2_000_000_000)
      .sign(privateKey);
    const paths: string[] = [];
    let tokenPosts = 0;
    const handleRequest = async (request: IncomingMessage, response: ServerResponse) => {
      paths.push(request.url ?? "");
      const path = request.url ?? "";
      if (path === "/custom/discovery?tenant=a%2Fb") {
        json(response, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/keys`,
        });
      } else if (path === "/oidc/token") {
        tokenPosts += 1;
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
        const body = new URLSearchParams(Buffer.concat(chunks).toString());
        if (
          request.method !== "POST" ||
          body.get("redirect_uri") !== callbackUri ||
          body.get("code") !== "code"
        ) {
          response.writeHead(400).end();
          return;
        }
        json(response, { id_token: token });
      } else if (path === "/oidc/keys") {
        json(response, { keys: [key] });
      } else {
        response.writeHead(404).end();
      }
    };
    const server = createServer((request, response) => {
      void handleRequest(request, response).catch(() => {
        response.writeHead(500).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Expected TCP server.");
      const nativeFetch = fetch;
      const transport: ProviderFetch = (url, init) => {
        const target = new URL(url);
        return nativeFetch(
          `http://127.0.0.1:${String(address.port)}${target.pathname}${target.search}`,
          init,
        );
      };
      const configured = await discoverOidcProvider({
        issuer,
        clientId: "browser-app",
        fetch: transport,
        discoveryEndpoint: "https://metadata.example/custom/discovery?tenant=a%2Fb",
        clock: () => 1_000,
      });
      expect(configured).toBeDefined();
      if (configured === undefined) throw new Error("Expected discovered provider.");
      expect(paths).toEqual(["/custom/discovery?tenant=a%2Fb"]);
      expect(tokenPosts).toBe(0);
      const input = {
        code: "code",
        clientId: "browser-app",
        callbackUri,
        providerCodeVerifier: "v".repeat(43),
        expectedNonce: "nonce",
        signal: new AbortController().signal,
      };
      await expect(configured.provider.exchangeAuthorizationCode(input)).resolves.toEqual({
        issuer,
        subject: "user-42",
        claims: { email: "user@example.test" },
      });
      await expect(configured.provider.exchangeAuthorizationCode(input)).resolves.toBeDefined();
      expect(tokenPosts).toBe(2);
      expect(paths).toEqual([
        "/custom/discovery?tenant=a%2Fb",
        "/oidc/token",
        "/oidc/keys",
        "/oidc/token",
      ]);
      vi.stubGlobal("fetch", transport);
      try {
        const defaultTransport = await discoverOidcProvider({
          issuer,
          clientId: "browser-app",
          discoveryEndpoint: "https://metadata.example/custom/discovery?tenant=a%2Fb",
          clock: () => 1_000,
        });
        expect(defaultTransport).toBeDefined();
        await expect(
          defaultTransport?.provider.exchangeAuthorizationCode(input),
        ).resolves.toBeDefined();
        expect(tokenPosts).toBe(3);
        expect(paths.slice(-3)).toEqual([
          "/custom/discovery?tenant=a%2Fb",
          "/oidc/token",
          "/oidc/keys",
        ]);
      } finally {
        vi.unstubAllGlobals();
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      );
    }
  });

  it("rejects a mismatched discovered issuer before any token request", async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      json(response, {
        issuer: "https://different.example",
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/keys`,
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Expected TCP server.");
      const transport: ProviderFetch = (url, init) => {
        const target = new URL(url);
        return fetch(
          `http://127.0.0.1:${String(address.port)}${target.pathname}${target.search}`,
          init,
        );
      };
      await expect(
        discoverOidcProvider({ issuer, clientId: "browser-app", fetch: transport }),
      ).resolves.toBeUndefined();
      expect(requests).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      );
    }
  });

  it("sends one token POST on refusal and at most one when the caller aborts", async () => {
    let posts = 0;
    let mode: "refuse" | "wait" = "refuse";
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const server = createServer((_request, response) => {
      posts += 1;
      if (mode === "refuse") {
        response
          .writeHead(400, { "content-type": "application/json" })
          .end('{"error":"invalid_grant"}');
      } else {
        entered();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Expected TCP server.");
      const transport: ProviderFetch = (url, init) => {
        const target = new URL(url);
        return fetch(`http://127.0.0.1:${String(address.port)}${target.pathname}`, init);
      };
      const configured = createOidcProvider({
        issuer,
        authorizationEndpoint: `${issuer}/authorize`,
        tokenEndpoint: `${issuer}/token`,
        jwksEndpoint: `${issuer}/keys`,
        clientId: "browser-app",
        fetch: transport,
        timeoutMilliseconds: 200,
      });
      const request = {
        code: "code",
        clientId: "browser-app",
        callbackUri,
        providerCodeVerifier: "v".repeat(43),
        expectedNonce: "nonce",
      };
      await expect(
        configured.provider.exchangeAuthorizationCode({
          ...request,
          signal: new AbortController().signal,
        }),
      ).resolves.toBeUndefined();
      expect(posts).toBe(1);
      mode = "wait";
      const controller = new AbortController();
      const exchange = configured.provider.exchangeAuthorizationCode({
        ...request,
        signal: controller.signal,
      });
      await waiting;
      controller.abort();
      await expect(exchange).resolves.toBeUndefined();
      expect(posts).toBe(2);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      );
    }
  });
});

/**
 * Writes one JSON response from the local provider.
 * @param response HTTP response to complete.
 * @param value JSON value.
 */
function json(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { "content-type": "application/json", "cache-control": "max-age=60" });
  response.end(JSON.stringify(value));
}
