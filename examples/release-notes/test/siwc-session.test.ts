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

import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";

import { CredentialStore } from "../src/trusted/credential-store.js";
import { VercelAx } from "@spine-event-engine/ai-vercel-ax";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "fixture-key",
  alg: "RS256",
  use: "sig",
};

afterEach(() => {
  vi.useRealTimers();
});

function signedIdToken(
  clientId: string,
  nonce: string,
  changes: Record<string, unknown> = {},
  key = privateKey,
): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "fixture-key" })).toString(
    "base64url",
  );
  const claims = Buffer.from(
    JSON.stringify({
      iss: "https://auth.openai.com",
      aud: clientId,
      sub: "subject-1",
      nonce,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      ...changes,
    }),
  ).toString("base64url");
  const input = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(input);
  return `${input}.${signer.sign(key).toString("base64url")}`;
}

async function fixture(
  changes: Record<string, unknown> = {},
  tokenKey = privateKey,
  refreshClaims?: Record<string, unknown>,
  grantedScope = "openid offline_access resource.invoke chatgpt.tokens.use.direct",
  revokeFailure = false,
  onRefresh?: () => Promise<void>,
  onCodeGrant?: () => Promise<void>,
  failFirstCodeGrant: boolean | string = false,
  modelReply?: () => Promise<Response>,
  onRevoke?: (signal?: AbortSignal) => Promise<void>,
) {
  const store = new CredentialStore();
  let requests = 0;
  let codeGrants = 0;
  let refreshChanges: Record<string, unknown> = {};
  let codeGrantChanges: Record<string, unknown> = {};
  const revokedTokens: string[] = [];
  const transportSignals: AbortSignal[] = [];
  let pendingNonce = "";
  const fetcher: typeof fetch = (input, init) => {
    if (init?.signal) transportSignals.push(init.signal);
    const url = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
    requests += 1;
    if (url.endsWith("/.well-known/openid-configuration"))
      return Promise.resolve(
        Response.json({
          issuer: "https://auth.openai.com",
          authorization_endpoint: "https://auth.openai.com/api/accounts/authorize",
          token_endpoint: "https://auth.openai.com/api/accounts/oauth/token",
          jwks_uri: "https://auth.openai.com/jwks",
          revocation_endpoint: "https://auth.openai.com/revoke",
          response_types_supported: ["code"],
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      );
    if (url.endsWith("/jwks")) return Promise.resolve(Response.json({ keys: [jwk] }));
    if (url.endsWith("/v1/models")) {
      if (modelReply) return modelReply();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer renewed-access");
      return Promise.resolve(
        Response.json({
          models: [
            { slug: "account-model", display_name: "Account model", visibility: "list" },
            { slug: "hidden-model", display_name: "Hidden", visibility: "hidden" },
          ],
        }),
      );
    }
    if (url.endsWith("/revoke")) {
      revokedTokens.push(new URLSearchParams(init?.body as string).get("token") ?? "");
      if (revokeFailure) throw new Error("fixture network outage");
      return (onRevoke?.(init?.signal ?? undefined) ?? Promise.resolve()).then(
        () => new Response(null, { status: 200 }),
      );
    }
    if (url.endsWith("/api/accounts/oauth/token")) {
      const body = new URLSearchParams(init?.body as string);
      expect(body.get("client_id")).toBe("issued-client");
      expect(body.get("resource")).toBe("https://api.openai.com/v1");
      if (body.get("grant_type") === "refresh_token")
        return (onRefresh?.() ?? Promise.resolve()).then(() =>
          Response.json({
            access_token: "renewed-access",
            refresh_token: "renewed-refresh",
            token_type: "Bearer",
            expires_in: 3600,
            scope: grantedScope,
            ...(refreshClaims === undefined
              ? {}
              : { id_token: signedIdToken("issued-client", "", refreshClaims) }),
            ...refreshChanges,
          }),
        );
      codeGrants += 1;
      if (failFirstCodeGrant && codeGrants === 1)
        return Promise.resolve(
          Response.json(
            {
              error: typeof failFirstCodeGrant === "string" ? failFirstCodeGrant : "invalid_grant",
              error_description: "Bearer private-token at /private/path",
            },
            { status: 400 },
          ),
        );
      return (onCodeGrant?.() ?? Promise.resolve()).then(() =>
        Response.json({
          access_token: "access-secret",
          refresh_token: "refresh-secret",
          token_type: "Bearer",
          expires_in: 3600,
          scope: grantedScope,
          id_token: signedIdToken("issued-client", pendingNonce, changes, tokenKey),
          ...codeGrantChanges,
        }),
      );
    }
    throw new Error(`Unexpected fixture request: ${url}`);
  };
  const session = VercelAx.chatgptPlanSession({
    agentName: "Release Notes Studio",
    credentials: store,
    platformFetch: fetcher,
  });
  const pending = await session.begin("http://127.0.0.1:32500/auth/callback");
  const parameters = new URL(pending.authorizationUrl).searchParams;
  pendingNonce = parameters.get("nonce") ?? "";
  const callback = new URL(parameters.get("redirect_uri") ?? "");
  callback.searchParams.set("code", "authorization-code");
  callback.searchParams.set("state", parameters.get("state") ?? "");
  callback.searchParams.set("client_id", "issued-client");
  return {
    session,
    store,
    pending,
    callback,
    count: () => requests,
    revokedTokens,
    transportSignals,
    setRefreshChanges: (changes: Record<string, unknown>) => {
      refreshChanges = changes;
    },
    setCodeGrantChanges: (changes: Record<string, unknown>) => {
      codeGrantChanges = changes;
    },
    setNonce: (value: string) => {
      pendingNonce = value;
    },
  };
}

test("new registration validates a signed ID token and retains issued client identity", async () => {
  const { session, store, pending, callback } = await fixture();
  const authorization = new URL(pending.authorizationUrl);
  expect(authorization.searchParams.get("client_id")).toBe("dynamic_agent_client");
  expect(authorization.searchParams.get("ext_agent_host_id")).toBe(await store.hostId());
  expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
  const result = await session.complete(pending, callback);
  expect(result).toMatchObject({
    clientId: "issued-client",
    subject: "subject-1",
    planEnabled: true,
  });
  expect((await store.registration("issued-client"))?.refreshToken).toBe("refresh-secret");
});

test("a failed in-session clear keeps old plan tokens fenced until removal succeeds", async () => {
  const { session, store, pending, callback } = await fixture();
  await session.complete(pending, callback);
  const clear = store.clearTokens.bind(store);
  store.clearTokens = () => Promise.reject(new Error("credential clear failed"));
  await expect(session.signOut("issued-client")).rejects.toThrow("credential clear failed");
  expect((await store.registration("issued-client"))?.accessToken).toBe("access-secret");
  await expect(session.accessToken("issued-client")).rejects.toThrow("sign-out");
  store.clearTokens = clear;
  await session.signOut("issued-client");
  expect((await store.registration("issued-client"))?.accessToken).toBeUndefined();
});

test("invalid_grant retries within the same app session with fresh browser secrets", async () => {
  const { session, store, pending, callback, setNonce } = await fixture(
    {},
    privateKey,
    undefined,
    "openid offline_access resource.invoke chatgpt.tokens.use.direct",
    false,
    undefined,
    undefined,
    true,
  );
  await expect(session.complete(pending, callback)).rejects.toThrow();
  expect(await store.pendingClientIds()).toEqual(["issued-client"]);
  const retry = await session.begin(
    new URL(pending.authorizationUrl).searchParams.get("redirect_uri") ?? "",
    "issued-client",
  );
  const retryParameters = new URL(retry.authorizationUrl).searchParams;
  const originalParameters = new URL(pending.authorizationUrl).searchParams;
  expect(retryParameters.get("client_id")).toBe("issued-client");
  expect(retryParameters.get("state")).not.toBe(originalParameters.get("state"));
  expect(retryParameters.get("nonce")).not.toBe(originalParameters.get("nonce"));
  expect(retryParameters.get("code_challenge")).not.toBe(originalParameters.get("code_challenge"));
  expect(new URL(retry.authorizationUrl).searchParams.get("client_id")).toBe("issued-client");
  setNonce(retryParameters.get("nonce") ?? "");
  const retryCallback = new URL(retryParameters.get("redirect_uri") ?? "");
  retryCallback.searchParams.set("code", "fresh-code");
  retryCallback.searchParams.set("state", retryParameters.get("state") ?? "");
  retryCallback.searchParams.set("client_id", "issued-client");
  await expect(session.complete(retry, retryCallback)).resolves.toMatchObject({
    clientId: "issued-client",
    subject: "subject-1",
  });
  expect(await store.pendingClientIds()).toEqual([]);
});
