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
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

import { CredentialStore } from "../src/trusted/credential-store.js";
import { SiwcSession } from "../src/trusted/siwc-session.js";

const directories: string[] = [];
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "fixture-key",
  alg: "RS256",
  use: "sig",
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
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
  failFirstCodeGrant = false,
) {
  const directory = await mkdtemp(join(tmpdir(), "release-notes-siwc-"));
  directories.push(directory);
  const cipher = {
    encrypt: (value: string) => Buffer.from(Buffer.from(value).toString("base64url")),
    decrypt: (value: Uint8Array) =>
      Buffer.from(Buffer.from(value).toString(), "base64url").toString(),
  };
  const store = new CredentialStore(directory, cipher);
  let requests = 0;
  let codeGrants = 0;
  const revokedTokens: string[] = [];
  let pendingNonce = "";
  const fetcher: typeof fetch = (input, init) => {
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
      return Promise.resolve(new Response(null, { status: 200 }));
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
          }),
        );
      codeGrants += 1;
      if (failFirstCodeGrant && codeGrants === 1)
        return Promise.resolve(Response.json({ error: "invalid_grant" }, { status: 400 }));
      return (onCodeGrant?.() ?? Promise.resolve()).then(() =>
        Response.json({
          access_token: "access-secret",
          refresh_token: "refresh-secret",
          token_type: "Bearer",
          expires_in: 3600,
          scope: grantedScope,
          id_token: signedIdToken("issued-client", pendingNonce, changes, tokenKey),
        }),
      );
    }
    throw new Error(`Unexpected fixture request: ${url}`);
  };
  const session = new SiwcSession(store, fetcher);
  const pending = await session.begin("http://127.0.0.1:32500/auth/callback");
  pendingNonce = pending.nonce;
  const callback = new URL(pending.redirectUri);
  callback.searchParams.set("code", "authorization-code");
  callback.searchParams.set("state", pending.state);
  callback.searchParams.set("client_id", "issued-client");
  return {
    session,
    store,
    pending,
    callback,
    count: () => requests,
    revokedTokens,
    setNonce: (value: string) => {
      pendingNonce = value;
    },
    reopen: () => {
      const saved = new CredentialStore(directory, cipher);
      return { store: saved, session: new SiwcSession(saved, fetcher) };
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

test.each([
  ["wrong state", { state: "wrong" }, {}],
  ["wrong nonce", {}, { nonce: "wrong" }],
  ["wrong issuer", {}, { iss: "https://attacker.invalid" }],
  ["wrong audience", {}, { aud: "other-client" }],
  ["expired token", {}, { exp: 1 }],
])("rejects %s before saving tokens", async (_name, callbackChanges, tokenChanges) => {
  const { session, store, pending, callback, count } = await fixture(tokenChanges);
  for (const [key, value] of Object.entries(callbackChanges)) callback.searchParams.set(key, value);
  await expect(session.complete(pending, callback)).rejects.toThrow();
  expect((await store.registration("issued-client"))?.accessToken).toBeUndefined();
  if ("state" in callbackChanges) expect(count()).toBe(0);
});

test("rejects a forged ID-token signature even when its claims match", async () => {
  const forged = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const { session, store, pending, callback } = await fixture({}, forged);
  await expect(session.complete(pending, callback)).rejects.toThrow();
  expect((await store.registration("issued-client"))?.accessToken).toBeUndefined();
});

test("refresh rotates both tokens, preserves verified identity without a new ID token, and lists only account-visible models", async () => {
  const { session, store, pending, callback } = await fixture();
  await session.complete(pending, callback);
  const token = await session.accessToken("issued-client", Date.now() + 10_000_000);
  expect(token).toBe("renewed-access");
  expect(await store.registration("issued-client")).toMatchObject({
    subject: "subject-1",
    accessToken: "renewed-access",
    refreshToken: "renewed-refresh",
  });
  expect(await session.models("issued-client")).toEqual([
    { slug: "account-model", displayName: "Account model" },
  ]);
});

test("refresh rejects a different verified subject without replacing prior tokens", async () => {
  const { session, store, pending, callback } = await fixture({}, privateKey, { sub: "subject-2" });
  await session.complete(pending, callback);
  await expect(session.accessToken("issued-client", Date.now() + 10_000_000)).rejects.toThrow();
  expect((await store.registration("issued-client"))?.accessToken).toBe("access-secret");
});

test("sign-out revokes the refresh token and clears tokens while retaining the issued client", async () => {
  const { session, store, pending, callback } = await fixture();
  await session.complete(pending, callback);
  expect(await session.signOut("issued-client")).toBe(true);
  expect(await store.registration("issued-client")).toMatchObject({
    clientId: "issued-client",
    subject: "subject-1",
  });
  expect((await store.registration("issued-client"))?.refreshToken).toBeUndefined();
});

test("sign-out fences a concurrent refresh so no plan token can be returned or restored", async () => {
  let releaseRefresh: (() => void) | undefined;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const { session, store, pending, callback, revokedTokens } = await fixture(
    {},
    privateKey,
    undefined,
    "openid offline_access resource.invoke chatgpt.tokens.use.direct",
    false,
    () => {
      markStarted?.();
      return barrier;
    },
  );
  await session.complete(pending, callback);
  const refreshing = session.accessToken("issued-client", Date.now() + 10_000_000);
  await started;
  const signingOut = session.signOut("issued-client");
  releaseRefresh?.();
  await expect(refreshing).rejects.toThrow();
  await signingOut;
  expect(revokedTokens).toEqual(["renewed-refresh"]);
  expect((await store.registration("issued-client"))?.accessToken).toBeUndefined();
  await expect(session.accessToken("issued-client")).rejects.toThrow();
});

test("sign-out clears credentials when an in-flight refresh fails", async () => {
  let failRefresh: ((error: Error) => void) | undefined;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const barrier = new Promise<void>((_resolve, reject) => {
    failRefresh = reject;
  });
  const { session, store, pending, callback, revokedTokens } = await fixture(
    {},
    privateKey,
    undefined,
    "openid offline_access resource.invoke chatgpt.tokens.use.direct",
    false,
    () => {
      markStarted?.();
      return barrier;
    },
  );
  await session.complete(pending, callback);
  const refreshing = session.accessToken("issued-client", Date.now() + 10_000_000);
  await started;
  const signingOut = session.signOut("issued-client");
  failRefresh?.(new Error("refresh transport failed"));
  await expect(refreshing).rejects.toThrow();
  await signingOut;
  expect(revokedTokens).toEqual(["refresh-secret"]);
  expect((await store.registration("issued-client"))?.accessToken).toBeUndefined();
});

test("a closed browser attempt cannot save a late authorization-code grant", async () => {
  let releaseGrant: (() => void) | undefined;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    releaseGrant = resolve;
  });
  const { session, store, pending, callback } = await fixture(
    {},
    privateKey,
    undefined,
    "openid offline_access resource.invoke chatgpt.tokens.use.direct",
    false,
    undefined,
    () => {
      markStarted?.();
      return barrier;
    },
  );
  let active = true;
  const completing = session.complete(pending, callback, () => active);
  await started;
  active = false;
  releaseGrant?.();
  await expect(completing).rejects.toThrow("canceled");
  expect((await store.registration("issued-client"))?.accessToken).toBeUndefined();
});

test("reconnect cannot restore a grant after sign-out invalidates its attempt", async () => {
  let releaseGrant: (() => void) | undefined;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    releaseGrant = resolve;
  });
  let codeGrants = 0;
  const { session, store, pending, callback, setNonce } = await fixture(
    {},
    privateKey,
    undefined,
    "openid offline_access resource.invoke chatgpt.tokens.use.direct",
    false,
    undefined,
    () => {
      codeGrants += 1;
      if (codeGrants === 1) return Promise.resolve();
      markStarted?.();
      return barrier;
    },
  );
  await session.complete(pending, callback);
  const retry = await session.begin(pending.redirectUri, "issued-client");
  setNonce(retry.nonce);
  const retryCallback = new URL(retry.redirectUri);
  retryCallback.searchParams.set("code", "reconnect-code");
  retryCallback.searchParams.set("state", retry.state);
  retryCallback.searchParams.set("client_id", "issued-client");
  const completing = session.complete(retry, retryCallback);
  await started;
  const signingOut = session.signOut("issued-client");
  releaseGrant?.();
  await expect(completing).rejects.toThrow();
  await signingOut;
  expect((await store.registration("issued-client"))?.accessToken).toBeUndefined();
});

test("a failed encrypted clear keeps old plan tokens fenced until removal succeeds", async () => {
  const { session, store, pending, callback } = await fixture();
  await session.complete(pending, callback);
  const clear = store.clearTokens.bind(store);
  store.clearTokens = () => Promise.reject(new Error("disk rename failed"));
  await expect(session.signOut("issued-client")).rejects.toThrow("disk rename failed");
  expect((await store.registration("issued-client"))?.accessToken).toBe("access-secret");
  await expect(session.accessToken("issued-client")).rejects.toThrow("sign-out");
  store.clearTokens = clear;
  await session.signOut("issued-client");
  expect((await store.registration("issued-client"))?.accessToken).toBeUndefined();
});

test("sign-out clears a reconnect grant that completed before it began", async () => {
  const { session, store, pending, callback, setNonce, revokedTokens } = await fixture();
  await session.complete(pending, callback);
  const retry = await session.begin(pending.redirectUri, "issued-client");
  setNonce(retry.nonce);
  const retryCallback = new URL(retry.redirectUri);
  retryCallback.searchParams.set("code", "reconnect-code");
  retryCallback.searchParams.set("state", retry.state);
  retryCallback.searchParams.set("client_id", "issued-client");
  await session.complete(retry, retryCallback);
  await session.signOut("issued-client");
  expect(revokedTokens).toEqual(["refresh-secret"]);
  expect((await store.registration("issued-client"))?.accessToken).toBeUndefined();
});

test("sign-out during reconnect registration lookup invalidates that browser attempt", async () => {
  const { session, store, pending, callback } = await fixture();
  await session.complete(pending, callback);
  const registration = store.registration.bind(store);
  let releaseRead: (() => void) | undefined;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  let blocked = false;
  store.registration = async (clientId: string) => {
    if (!blocked) {
      blocked = true;
      markStarted?.();
      await barrier;
    }
    return await registration(clientId);
  };
  const beginning = session.begin(pending.redirectUri, "issued-client");
  await started;
  await session.signOut("issued-client");
  releaseRead?.();
  await expect(beginning).rejects.toThrow("canceled");
  expect((await store.registration("issued-client"))?.accessToken).toBeUndefined();
  await expect(session.accessToken("issued-client")).rejects.toThrow();
});

test("invalid_grant resumes with the issued client and fresh browser secrets", async () => {
  const { session, store, pending, callback, setNonce, reopen } = await fixture(
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
  const restarted = reopen();
  expect(await restarted.store.pendingClientIds()).toEqual(["issued-client"]);
  const retry = await restarted.session.begin(pending.redirectUri, "issued-client");
  expect(retry.clientId).toBe("issued-client");
  expect(retry.state).not.toBe(pending.state);
  expect(retry.nonce).not.toBe(pending.nonce);
  expect(retry.verifier).not.toBe(pending.verifier);
  expect(new URL(retry.authorizationUrl).searchParams.get("client_id")).toBe("issued-client");
  setNonce(retry.nonce);
  const retryCallback = new URL(retry.redirectUri);
  retryCallback.searchParams.set("code", "fresh-code");
  retryCallback.searchParams.set("state", retry.state);
  retryCallback.searchParams.set("client_id", "issued-client");
  await expect(restarted.session.complete(retry, retryCallback)).resolves.toMatchObject({
    clientId: "issued-client",
    subject: "subject-1",
  });
  expect(await restarted.store.pendingClientIds()).toEqual([]);
});

test("a mismatched issued client callback stops before token exchange", async () => {
  const { session, pending, callback, count } = await fixture();
  callback.searchParams.set("client_id", "different-client");
  await expect(
    session.complete({ ...pending, clientId: "issued-client" }, callback),
  ).rejects.toThrow();
  expect(count()).toBe(0);
});

test("identity sign-in without the plan grant remains connected but cannot access inference", async () => {
  const { session, pending, callback } = await fixture(
    {},
    privateKey,
    undefined,
    "openid profile email",
  );
  expect((await session.complete(pending, callback)).planEnabled).toBe(false);
  await expect(session.accessToken("issued-client")).rejects.toThrow();
});

test("sign-out reports uncertain remote revocation while clearing local credentials", async () => {
  const { session, store, pending, callback } = await fixture(
    {},
    privateKey,
    undefined,
    "openid offline_access resource.invoke chatgpt.tokens.use.direct",
    true,
  );
  await session.complete(pending, callback);
  expect(await session.signOut("issued-client")).toBe(false);
  expect((await store.registration("issued-client"))?.accessToken).toBeUndefined();
});
