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

import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { BetterAuthIntegration } from "@spine-event-engine/auth/better-auth";
import { describe, expect, it, vi } from "vitest";

import { BetterAuthOidcScenario } from "../src/better-auth-oidc-scenario.js";

describe("Message Board prelinked native OIDC example", () => {
  it("uses real local discovery, PKCE, token, JWKS, and a prelinked Account", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "board-key", alg: "RS256", use: "sig" };
    let issuer = "";
    let challenge = "";
    let nonce = "";
    let tokenPosts = 0;
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    const provider = createServer(async (request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/metadata") {
        response.end(
          JSON.stringify({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/keys`,
            id_token_signing_alg_values_supported: ["RS256"],
          }),
        );
      } else if (request.url === "/keys") {
        response.end(JSON.stringify({ keys: [jwk] }));
      } else if (request.url === "/token") {
        tokenPosts++;
        let form = "";
        for await (const chunk of request) form += String(chunk);
        const fields = new URLSearchParams(form);
        if (
          fields.get("code") !== "board-code" ||
          createHash("sha256")
            .update(fields.get("code_verifier") ?? "")
            .digest("base64url") !== challenge
        ) {
          response.writeHead(400).end();
          return;
        }
        const idToken = await new SignJWT({
          nonce,
          email: "ada@example.test",
          email_verified: true,
        })
          .setProtectedHeader({ alg: "RS256", kid: "board-key" })
          .setIssuer(issuer)
          .setAudience("board-client")
          .setSubject("board-subject")
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(privateKey);
        response.end(
          JSON.stringify({
            access_token: "local-access",
            token_type: "Bearer",
            expires_in: 3600,
            id_token: idToken,
          }),
        );
      } else response.writeHead(404).end();
    });
    try {
      provider.listen(0, "127.0.0.1");
      await once(provider, "listening");
      const address = provider.address();
      if (address === null || typeof address === "string")
        throw new Error("Local provider did not listen.");
      issuer = `http://127.0.0.1:${String(address.port)}`;
      const result = await BetterAuthOidcScenario.prelinked(
        "message-board-native-secret-at-least-32-characters",
        `${issuer}/metadata`,
        (authorizationUrl) => {
          const parameters = new URL(authorizationUrl).searchParams;
          nonce = parameters.get("nonce") ?? "";
          challenge = parameters.get("code_challenge") ?? "";
          return Promise.resolve(
            new URL(
              `http://localhost:3000/auth/callback/company?code=board-code&state=${encodeURIComponent(parameters.get("state") ?? "")}`,
            ),
          );
        },
      );
      expect(result).toEqual({ resolved: true, replayRejected: true, loggedOut: true, removed: 0 });
      expect(tokenPosts).toBe(1);
      await expect(
        BetterAuthOidcScenario.prelinked(
          "message-board-native-secret-at-least-32-characters",
          `${issuer}/metadata`,
          () =>
            Promise.resolve(
              new URL("http://localhost:3000/auth/callback/company?code=board-code&state=unissued"),
            ),
        ),
      ).rejects.toThrow(/callback was not accepted/u);
      expect(tokenPosts).toBe(1);

      const create = BetterAuthIntegration.create.bind(BetterAuthIntegration);
      const failedStart = vi.spyOn(BetterAuthIntegration, "create").mockImplementation((input) =>
        create(input).then((auth) => {
          Object.defineProperty(auth, "routes", {
            value: auth.routes.map((route) =>
              route.path === "/auth/sign-in/social"
                ? { ...route, onRequest: () => new Response(null, { status: 503 }) }
                : route,
            ),
          });
          return auth;
        }),
      );
      try {
        await expect(
          BetterAuthOidcScenario.prelinked(
            "message-board-native-secret-at-least-32-characters",
            `${issuer}/metadata`,
            () => Promise.resolve(new URL("http://localhost:3000/auth/callback/company")),
          ),
        ).rejects.toThrow(/start failed/u);
        expect(tokenPosts).toBe(1);
      } finally {
        failedStart.mockRestore();
      }

      const missingCookie = vi.spyOn(BetterAuthIntegration, "create").mockImplementation((input) =>
        create(input).then((auth) => {
          Object.defineProperty(auth, "routes", {
            value: auth.routes.map((route) =>
              route.path === "/auth/callback/company"
                ? {
                    ...route,
                    onRequest: async (request: Request, signal: AbortSignal) => {
                      const response = await route.onRequest(request, signal);
                      const headers = new Headers(response.headers);
                      headers.delete("set-cookie");
                      return new Response(response.body, { status: response.status, headers });
                    },
                  }
                : route,
            ),
          });
          return auth;
        }),
      );
      try {
        await expect(
          BetterAuthOidcScenario.prelinked(
            "message-board-native-secret-at-least-32-characters",
            `${issuer}/metadata`,
            (url) => {
              const parameters = new URL(url).searchParams;
              nonce = parameters.get("nonce") ?? "";
              challenge = parameters.get("code_challenge") ?? "";
              return Promise.resolve(
                new URL(
                  `http://localhost:3000/auth/callback/company?code=board-code&state=${encodeURIComponent(parameters.get("state") ?? "")}`,
                ),
              );
            },
          ),
        ).rejects.toThrow(/session cookie was absent/u);
        expect(tokenPosts).toBe(2);
      } finally {
        missingCookie.mockRestore();
      }

      for (const missingPath of ["/auth/sign-out", "/auth/callback/company"]) {
        const missingRoute = vi.spyOn(BetterAuthIntegration, "create").mockImplementation((input) =>
          create(input).then((auth) => {
            Object.defineProperty(auth, "routes", {
              value: auth.routes.filter((route) => route.path !== missingPath),
            });
            return auth;
          }),
        );
        try {
          await expect(
            BetterAuthOidcScenario.prelinked(
              "message-board-native-secret-at-least-32-characters",
              `${issuer}/metadata`,
              () => Promise.reject(new Error("Browser handoff must not run.")),
            ),
          ).rejects.toThrow(/absent/u);
          expect(tokenPosts).toBe(2);
        } finally {
          missingRoute.mockRestore();
        }
      }
    } finally {
      if (provider.listening)
        await new Promise<void>((resolve, reject) =>
          provider.close((error) => {
            if (error) reject(error);
            else resolve();
          }),
        );
    }
  });
});
