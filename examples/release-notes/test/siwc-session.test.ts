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
import { afterEach, expect, test, vi } from "vitest";

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
  vi.useRealTimers();
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
  modelReply?: () => Promise<Response>,
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
  let refreshChanges: Record<string, unknown> = {};
  let codeGrantChanges: Record<string, unknown> = {};
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
            ...refreshChanges,
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
          ...codeGrantChanges,
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
    setRefreshChanges: (changes: Record<string, unknown>) => {
      refreshChanges = changes;
    },
    setCodeGrantChanges: (changes: Record<string, unknown>) => {
      codeGrantChanges = changes;
    },
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

test("a verified grant without refresh or expiry retains identity but requires new sign-in for use", async () => {
  const { session, store, pending, callback, revokedTokens, setCodeGrantChanges } = await fixture();
  setCodeGrantChanges({ refresh_token: undefined, expires_in: undefined });
  expect((await session.complete(pending, callback)).planEnabled).toBe(true);
  expect(await store.registration("issued-client")).toMatchObject({
    clientId: "issued-client",
    subject: "subject-1",
    accessToken: "access-secret",
  });
  expect((await store.registration("issued-client"))?.refreshToken).toBeUndefined();
  await expect(session.accessToken("issued-client")).rejects.toThrow("sign-in is required");
  const reconnect = await session.begin("http://127.0.0.1:32500/auth/callback", "issued-client");
  const authorization = new URL(reconnect.authorizationUrl);
  expect(authorization.searchParams.get("id_token_hint")).toBeTruthy();
  expect(authorization.searchParams.has("login_hint")).toBe(false);
  expect(await session.signOut("issued-client")).toBe(true);
  expect(revokedTokens).toEqual([]);
});

test("a signed verified email becomes a reconnect hint without changing the account subject", async () => {
  const { session, pending, callback } = await fixture({ email: "verified@example.com" });
  expect(await session.complete(pending, callback)).toMatchObject({
    subject: "subject-1",
    email: "verified@example.com",
  });
  const reconnect = await session.begin("http://127.0.0.1:32500/auth/callback", "issued-client");
  const authorization = new URL(reconnect.authorizationUrl);
  expect(authorization.searchParams.get("login_hint")).toBe("verified@example.com");
});

test("unknown issued clients cannot reconnect or sign out another registration", async () => {
  const { session, store, pending, callback, revokedTokens } = await fixture();
  await session.complete(pending, callback);
  await expect(
    session.begin("http://127.0.0.1:32500/auth/callback", "unknown-client"),
  ).rejects.toThrow("Unknown registration");
  await expect(session.signOut("unknown-client")).rejects.toThrow("Unknown registration");
  expect(revokedTokens).toEqual([]);
  expect((await store.registration("issued-client"))?.accessToken).toBe("access-secret");
});

test.each([
  "https://127.0.0.1:32500/auth/callback",
  "http://localhost:32500/auth/callback",
  "http://127.0.0.1:32500/other",
])("never starts browser authorization at an invalid loopback destination: %s", async (url) => {
  const { session, store } = await fixture();
  await expect(session.begin(url)).rejects.toThrow("Invalid loopback callback");
  expect(await store.pendingClientIds()).toEqual([]);
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

test("concurrent plan-token reads share one refresh and install one verified rotation", async () => {
  const started = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  let refreshCalls = 0;
  const { session, store, pending, callback } = await fixture(
    {},
    privateKey,
    undefined,
    "openid offline_access resource.invoke chatgpt.tokens.use.direct",
    false,
    () => {
      refreshCalls++;
      started.resolve(undefined);
      return release.promise;
    },
  );
  await session.complete(pending, callback);
  const first = session.accessToken("issued-client", Date.now() + 10_000_000);
  await started.promise;
  const second = session.accessToken("issued-client", Date.now() + 10_000_000);
  release.resolve(undefined);
  expect(await Promise.all([first, second])).toEqual(["renewed-access", "renewed-access"]);
  expect(refreshCalls).toBe(1);
  expect(await store.registration("issued-client")).toMatchObject({
    accessToken: "renewed-access",
    refreshToken: "renewed-refresh",
  });
});

test("a renewal that omits scope retains the verified plan grant and validates a new identity token", async () => {
  const { session, store, pending, callback, setRefreshChanges } = await fixture(
    {},
    privateKey,
    {},
  );
  await session.complete(pending, callback);
  setRefreshChanges({ scope: undefined });
  expect(await session.accessToken("issued-client", Date.now() + 10_000_000)).toBe(
    "renewed-access",
  );
  const saved = await store.registration("issued-client");
  expect(saved).toMatchObject({
    subject: "subject-1",
    accessToken: "renewed-access",
    refreshToken: "renewed-refresh",
  });
  expect(saved?.scopes).toContain("chatgpt.tokens.use.direct");
});

test.each(["fetch", "body"])(
  "bounds a stalled model catalog %s and later accepts a healthy catalog",
  async (stall) => {
    let calls = 0;
    const started = Promise.withResolvers<undefined>();
    const heldFetch = Promise.withResolvers<Response>();
    const heldBody = Promise.withResolvers<undefined>();
    const { session, pending, callback } = await fixture(
      {},
      privateKey,
      undefined,
      "openid offline_access resource.invoke chatgpt.tokens.use.direct",
      false,
      undefined,
      undefined,
      false,
      () => {
        calls++;
        started.resolve(undefined);
        if (calls === 1 && stall === "fetch") return heldFetch.promise;
        if (calls === 1)
          return Promise.resolve(
            new Response(new ReadableStream({ pull: () => heldBody.promise })),
          );
        return Promise.resolve(
          Response.json({ models: [{ slug: "ready", display_name: "Ready", visibility: "list" }] }),
        );
      },
    );
    await session.complete(pending, callback);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const failed = expect(session.models("issued-client")).rejects.toThrow("catalog");
    await started.promise;
    await vi.advanceTimersByTimeAsync(10_001);
    await failed;
    expect(await session.models("issued-client")).toEqual([
      { slug: "ready", displayName: "Ready" },
    ]);
  },
);

test.each([
  [
    "response bytes",
    () =>
      Response.json({
        models: [{ slug: "x".repeat(300_000), display_name: "Huge", visibility: "list" }],
      }),
  ],
  [
    "entry count",
    () =>
      Response.json({
        models: Array.from({ length: 1_001 }, (_, index) => ({
          slug: `model-${String(index)}`,
          display_name: "Model",
          visibility: "list",
        })),
      }),
  ],
  [
    "field length",
    () =>
      Response.json({
        models: [{ slug: "x".repeat(129), display_name: "Long", visibility: "list" }],
      }),
  ],
] as const)(
  "rejects excessive catalog %s without poisoning later model discovery",
  async (_name, oversized) => {
    let calls = 0;
    const { session, pending, callback } = await fixture(
      {},
      privateKey,
      undefined,
      "openid offline_access resource.invoke chatgpt.tokens.use.direct",
      false,
      undefined,
      undefined,
      false,
      () =>
        Promise.resolve(
          ++calls === 1
            ? oversized()
            : Response.json({
                models: [{ slug: "ready", display_name: "Ready", visibility: "list" }],
              }),
        ),
    );
    await session.complete(pending, callback);
    await expect(session.models("issued-client")).rejects.toThrow("catalog");
    expect(await session.models("issued-client")).toEqual([
      { slug: "ready", displayName: "Ready" },
    ]);
  },
);

test.each([
  ["HTTP failure", () => new Response("private provider text", { status: 503 })],
  ["empty body", () => new Response(null, { status: 200 })],
] as const)("a catalog %s is safe and does not prevent a later retry", async (_reason, failure) => {
  let calls = 0;
  const { session, pending, callback } = await fixture(
    {},
    privateKey,
    undefined,
    "openid offline_access resource.invoke chatgpt.tokens.use.direct",
    false,
    undefined,
    undefined,
    false,
    () =>
      Promise.resolve(
        ++calls === 1
          ? failure()
          : Response.json({
              models: [{ slug: "ready", display_name: "Ready", visibility: "list" }],
            }),
      ),
  );
  await session.complete(pending, callback);
  await expect(session.models("issued-client")).rejects.toThrow("catalog is unavailable");
  expect(await session.models("issued-client")).toEqual([{ slug: "ready", displayName: "Ready" }]);
});

test.each([
  ["subject", { sub: "subject-2" }],
  ["issuer", { iss: "https://different.example.invalid" }],
  ["audience", { aud: "another-issued-client" }],
] as const)(
  "refresh rejects a different verified %s without replacing prior tokens",
  async (_name, claims) => {
    const { session, store, pending, callback } = await fixture({}, privateKey, claims);
    await session.complete(pending, callback);
    await expect(session.accessToken("issued-client", Date.now() + 10_000_000)).rejects.toThrow();
    expect((await store.registration("issued-client"))?.accessToken).toBe("access-secret");
  },
);

test.each([
  ["lost plan permission", { scope: "openid offline_access resource.invoke" }],
  ["missing rotated refresh token", { refresh_token: "" }],
  ["non-Bearer token", { token_type: "MAC" }],
  ["missing expiry", { expires_in: 0 }],
] as const)("%s leaves the prior verified grant unchanged", async (_reason, changed) => {
  const { session, store, pending, callback, setRefreshChanges } = await fixture();
  await session.complete(pending, callback);
  const before = await store.registration("issued-client");
  setRefreshChanges(changed);
  await expect(session.accessToken("issued-client", Date.now() + 10_000_000)).rejects.toThrow();
  expect(await store.registration("issued-client")).toEqual(before);
});

test.each([
  [
    "declined authorization",
    (callback: URL) => {
      callback.searchParams.set("error", "access_denied");
    },
  ],
  [
    "missing code",
    (callback: URL) => {
      callback.searchParams.delete("code");
    },
  ],
  [
    "wrong callback path",
    (callback: URL) => {
      callback.pathname = "/wrong";
    },
  ],
  [
    "wrong callback origin",
    (callback: URL) => {
      callback.hostname = "localhost";
    },
  ],
] as const)("%s cannot exchange or save a grant", async (_reason, change) => {
  const { session, store, pending, callback, count } = await fixture();
  change(callback);
  await expect(session.complete(pending, callback)).rejects.toThrow();
  expect(count()).toBe(0);
  expect((await store.registration("issued-client"))?.accessToken).toBeUndefined();
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
  await expect(session.signOut("issued-client")).rejects.toThrow("in progress");
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

test("a valid grant for an issued client cannot replace a different saved subject", async () => {
  const { session, store, pending, callback } = await fixture();
  await store.save({
    clientId: "issued-client",
    issuer: "https://auth.openai.com",
    subject: "prior-subject",
    accessToken: "prior-access",
  });
  await expect(session.complete(pending, callback)).rejects.toThrow("identity changed");
  expect(await store.registration("issued-client")).toMatchObject({
    subject: "prior-subject",
    accessToken: "prior-access",
  });
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
