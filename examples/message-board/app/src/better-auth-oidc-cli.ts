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
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { exportJWK, generateKeyPair, SignJWT } from "jose";

import { BetterAuthOidcScenario } from "./better-auth-oidc-scenario.js";

const secret = process.env.BETTER_AUTH_SECRET;
if (secret === undefined) throw new Error("BETTER_AUTH_SECRET is required.");
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "board-key", alg: "RS256", use: "sig" };
let issuer = "";
let challenge = "";
let nonce = "";
let tokenPosts = 0;

/**
 * Serves local test-only discovery, token, and JWKS responses.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Groups local test provider operations without global helpers.
class LocalOidcProvider {
  /**
   * Sends one local provider response.
   *
   * @param request Provider HTTP request.
   * @param response Provider HTTP response.
   * @returns Completion after the selected response is sent.
   */
  static async respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
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
      return;
    }
    if (request.url === "/keys") {
      response.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (request.url === "/token") return LocalOidcProvider.token(request, response);
    response.writeHead(404).end();
  }

  /**
   * Processes one local code after checking the provider PKCE verifier.
   *
   * @param request Provider token request.
   * @param response Provider token response.
   * @returns Completion after the token response is sent or refused.
   */
  static async token(request: IncomingMessage, response: ServerResponse): Promise<void> {
    tokenPosts++;
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const fields = new URLSearchParams(body);
    if (
      fields.get("code") !== "board-code" ||
      createHash("sha256")
        .update(fields.get("code_verifier") ?? "")
        .digest("base64url") !== challenge
    ) {
      response.writeHead(400).end();
      return;
    }
    const idToken = await new SignJWT({ nonce, email: "ada@example.test", email_verified: true })
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
  }
}

// eslint-disable-next-line @typescript-eslint/no-misused-promises
const provider = createServer((request, response) => LocalOidcProvider.respond(request, response));

provider.listen(0, "127.0.0.1");
await once(provider, "listening");
const address = provider.address();
if (address === null || typeof address === "string")
  throw new Error("Local provider did not listen.");
issuer = `http://127.0.0.1:${String(address.port)}`;
try {
  const result = await BetterAuthOidcScenario.prelinked(secret, `${issuer}/metadata`, (url) => {
    const query = new URL(url).searchParams;
    nonce = query.get("nonce") ?? "";
    challenge = query.get("code_challenge") ?? "";
    return Promise.resolve(
      new URL(
        `http://localhost:3000/auth/callback/company?code=board-code&state=${encodeURIComponent(query.get("state") ?? "")}`,
      ),
    );
  });
  if (!result.resolved || !result.replayRejected || !result.loggedOut || tokenPosts !== 1)
    throw new Error("Prelinked native OIDC lifecycle failed.");
  console.log("Local test-only provider: prelinked OIDC session issued once and logged out.");
} finally {
  provider.close();
  await once(provider, "close");
}
