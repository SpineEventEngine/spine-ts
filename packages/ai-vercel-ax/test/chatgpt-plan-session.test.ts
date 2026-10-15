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

import { ModelRef, type AiScope } from "@spine-event-engine/ai";
import { backendDefinition, type AiExecutionControl } from "@spine-event-engine/ai/spi/adapter";
import {
  VercelAx,
  type ChatgptPlanCredentialStore,
  type ChatgptPlanRegistration,
} from "../src/index.js";

class TestCredentialStore implements ChatgptPlanCredentialStore {
  private readonly entries: Map<string, ChatgptPlanRegistration>;
  private readonly pending: Set<string>;

  constructor(entries = new Map<string, ChatgptPlanRegistration>(), pending = new Set<string>()) {
    this.entries = entries;
    this.pending = pending;
  }

  hostId(): Promise<string> {
    return Promise.resolve("urn:uuid:test-host");
  }
  registrations(): Promise<readonly ChatgptPlanRegistration[]> {
    return Promise.resolve([...this.entries.values()]);
  }
  registration(clientId: string): Promise<ChatgptPlanRegistration | undefined> {
    const entry = this.entries.get(clientId);
    return Promise.resolve(entry);
  }
  pendingClientIds(): Promise<readonly string[]> {
    return Promise.resolve([...this.pending]);
  }
  stageIssuedClient(clientId: string): Promise<void> {
    this.pending.add(clientId);
    return Promise.resolve();
  }
  save(registration: ChatgptPlanRegistration): Promise<void> {
    this.entries.set(registration.clientId, registration);
    this.pending.delete(registration.clientId);
    return Promise.resolve();
  }
  clearTokens(clientId: string): Promise<void> {
    const existing = this.entries.get(clientId);
    if (existing !== undefined)
      this.entries.set(clientId, {
        clientId: existing.clientId,
        issuer: existing.issuer,
        subject: existing.subject,
        ...(existing.email === undefined ? {} : { email: existing.email }),
      });
    return Promise.resolve();
  }
  reopen(): TestCredentialStore {
    return new TestCredentialStore(this.entries, this.pending);
  }
}

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
  const store = new TestCredentialStore();
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
    agentName: "Test plan app",
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
    reopen: () => {
      const saved = store.reopen();
      return {
        store: saved,
        session: VercelAx.chatgptPlanSession({
          agentName: "Test plan app",
          credentials: saved,
          platformFetch: fetcher,
        }),
      };
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

test("account picker returns only verified identities and derives plan permission from stored grants", async () => {
  const store = new TestCredentialStore();
  await store.save({
    clientId: "plan-client",
    issuer: "https://auth.openai.com",
    subject: "plan-subject",
    email: "plan@example.test",
    scopes: ["chatgpt.tokens.use.direct"],
    accessToken: "stored-plan-token",
  });
  await store.save({
    clientId: "identity-client",
    issuer: "https://auth.openai.com",
    subject: "identity-subject",
    accessToken: "identity-only-token",
  });
  await store.save({
    clientId: "unverified-client",
    issuer: "https://auth.openai.com",
    subject: "",
  });
  await store.stageIssuedClient("pending-client");
  expect(() => VercelAx.chatgptPlanSession({ agentName: " ", credentials: store })).toThrow(
    "agentName must be nonblank",
  );
  const session = VercelAx.chatgptPlanSession({ agentName: "Account picker", credentials: store });
  expect(await session.accounts()).toEqual([
    {
      clientId: "plan-client",
      subject: "plan-subject",
      email: "plan@example.test",
      planEnabled: true,
    },
    { clientId: "identity-client", subject: "identity-subject", planEnabled: false },
  ]);
  expect(await session.pendingClientIds()).toEqual(["pending-client"]);
});

test("session model rejects unknown clients and models outside the account catalog", async () => {
  const { session, pending, callback } = await fixture();
  await session.complete(pending, callback);
  await session.accessToken("issued-client", Date.now() + 10_000_000);
  const selected = {
    ref: ModelRef.of("plan", "account-model"),
    model: "account-model",
    authorizeUse: () => true,
  };
  await expect(session.model({ ...selected, clientId: "unknown-client" })).rejects.toThrow(
    "permission is not available",
  );
  await expect(
    session.model({ ...selected, clientId: "issued-client", model: "unlisted-model" }),
  ).rejects.toThrow("Model is not available to this account");
});

test("one browser grant uses its caller cancellation signal across discovery and token exchange", async () => {
  const { session, pending, callback, transportSignals } = await fixture();
  const controller = new AbortController();
  await session.complete(pending, callback, () => true, controller.signal);
  expect(transportSignals.length).toBeGreaterThanOrEqual(2);
  expect(transportSignals.every((signal) => signal === controller.signal)).toBe(true);
});

test("an already-cancelled grant remains available without staging its issued client", async () => {
  const { session, store, pending, callback } = await fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(session.complete(pending, callback, undefined, controller.signal)).rejects.toThrow(
    "canceled",
  );
  expect(await store.pendingClientIds()).toEqual([]);
  await expect(session.complete(pending, callback)).resolves.toMatchObject({
    clientId: "issued-client",
  });
});

test("a grant canceled during persistence clears a late credential write", async () => {
  const { session, store, pending, callback } = await fixture();
  const controller = new AbortController();
  const started = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const save = store.save.bind(store);
  store.save = async (registration) => {
    started.resolve(undefined);
    await release.promise;
    await save(registration);
  };
  const completing = session.complete(pending, callback, undefined, controller.signal);
  await started.promise;
  controller.abort();
  release.resolve(undefined);
  await expect(completing).rejects.toThrow("canceled");
  expect((await store.registration("issued-client"))?.accessToken).toBeUndefined();
});

test("a signed ID token with the issued client in an audience array completes sign-in", async () => {
  const { session, store, pending, callback } = await fixture({ aud: ["issued-client"] });
  await expect(session.complete(pending, callback)).resolves.toMatchObject({
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

test("refresh rotates both tokens and lists only account-visible models", async () => {
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

test("session model binds the issued client, verified subject, catalog, and current grant", async () => {
  const { session, store, pending, callback } = await fixture();
  await session.complete(pending, callback);
  await session.accessToken("issued-client", Date.now() + 10_000_000);
  const authorizeUse = vi.fn(() => true);
  const registration = await session.model({
    ref: ModelRef.of("plan", "account-model"),
    clientId: "issued-client",
    model: "account-model",
    authorizeUse,
  });
  const binding = backendDefinition(registration);
  const scope = {} as AiScope;
  const execution = { signal: new AbortController().signal };
  const identity = await binding.resolveIdentity(scope, execution);
  expect(identity).toEqual({
    provider: "openai-chatgpt-plan",
    account: "issued-client:subject-1",
    endpoint: "https://api.openai.com/v1",
    model: "account-model",
  });
  expect(await binding.authorizeUse(scope, identity, execution)).toBe(true);
  expect(authorizeUse).toHaveBeenCalledOnce();
  const control: AiExecutionControl = {
    signal: execution.signal,
    nowEpochMs: () => Date.now(),
    hasAuthority: () => true,
    beginAttempt: vi.fn(),
    reserveTransport: vi.fn(),
    onReceived: vi.fn(),
    finishAttempt: vi.fn(),
    recordFailure: vi.fn(),
    admitGeneration: vi.fn(),
    admitDecision: vi.fn(),
    callTool: vi.fn(),
  };
  const connection = await binding.connect(scope, identity, control);
  expect(connection.identity).toEqual(identity);
  expect(connection.model).toBeDefined();
  const saved = await store.registration("issued-client");
  if (!saved) throw new Error("Expected saved verified registration.");
  await store.save({ ...saved, subject: "different-subject" });
  expect(await binding.authorizeUse(scope, identity, execution)).toBe(false);
  await expect(binding.connect(scope, identity, control)).rejects.toThrow("changed");
});

test("session model rejects a credential fetched after application selection changes", async () => {
  const started = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const { session, store, pending, callback } = await fixture(
    {},
    privateKey,
    undefined,
    "openid offline_access resource.invoke chatgpt.tokens.use.direct",
    false,
    () => {
      started.resolve(undefined);
      return release.promise;
    },
  );
  await session.complete(pending, callback);
  const saved = await store.registration("issued-client");
  if (!saved) throw new Error("Expected saved verified registration.");
  await store.save({ ...saved, accessToken: "renewed-access" });
  let selected = true;
  const registration = await session.model({
    ref: ModelRef.of("plan", "account-model"),
    clientId: "issued-client",
    model: "account-model",
    authorizeUse: () => selected,
  });
  await store.save({ ...saved, expiresAt: 0 });
  const binding = backendDefinition(registration);
  const scope = {} as AiScope;
  const execution = {
    signal: new AbortController().signal,
    hasAuthority: () => true,
    nowEpochMs: () => Date.now(),
  } as AiExecutionControl;
  const identity = await binding.resolveIdentity(scope, execution);
  const connecting = binding.connect(scope, identity, execution);
  await started.promise;
  selected = false;
  release.resolve(undefined);
  await expect(connecting).rejects.toThrow("changed");
});

test("a model withdrawn from the account catalog cannot connect after registration", async () => {
  let catalogs = 0;
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
        Response.json({
          models:
            ++catalogs === 1
              ? [{ slug: "account-model", display_name: "Account model", visibility: "list" }]
              : [],
        }),
      ),
  );
  await session.complete(pending, callback);
  const registration = await session.model({
    ref: ModelRef.of("plan", "account-model"),
    clientId: "issued-client",
    model: "account-model",
    authorizeUse: () => true,
  });
  const binding = backendDefinition(registration);
  const scope = {} as AiScope;
  const execution = { signal: new AbortController().signal };
  const identity = await binding.resolveIdentity(scope, execution);
  await expect(
    binding.connect(scope, identity, {
      signal: execution.signal,
      hasAuthority: () => true,
      nowEpochMs: () => Date.now(),
    } as AiExecutionControl),
  ).rejects.toThrow("Model is not available to this account.");
  expect(catalogs).toBe(2);
});

test("a signed refreshed ID token accepts the issued client in an audience array", async () => {
  const { session, store, pending, callback } = await fixture({}, privateKey, {
    aud: ["issued-client"],
  });
  await session.complete(pending, callback);
  await expect(session.accessToken("issued-client", Date.now() + 10_000_000)).resolves.toBe(
    "renewed-access",
  );
  expect((await store.registration("issued-client"))?.refreshToken).toBe("renewed-refresh");
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

test("reads a metadata-rich catalog above 256 KB and keeps list-visible order", async () => {
  const models = Array.from({ length: 900 }, (_, index) => ({
    slug: `model-${String(index)}`,
    display_name: `Model ${String(index)}`,
    visibility: index % 2 === 0 ? "list" : "hidden",
    description: "Catalog metadata ".repeat(20),
  }));
  const payload = JSON.stringify({ models });
  expect(Buffer.byteLength(payload)).toBeGreaterThan(256_000);
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
      Promise.resolve(new Response(payload, { headers: { "content-type": "application/json" } })),
  );
  await session.complete(pending, callback);
  await expect(session.models("issued-client")).resolves.toEqual(
    models
      .filter((model) => model.visibility === "list")
      .map((model) => ({
        slug: model.slug,
        displayName: model.display_name,
      })),
  );
});

test("reads a catalog beyond former body, entry, and field limits", async () => {
  const slug = "s".repeat(129);
  const displayName = "N".repeat(257);
  const models = Array.from({ length: 1_001 }, (_, index) => ({
    slug: index === 0 ? slug : `hidden-${String(index)}`,
    display_name: index === 0 ? displayName : "Hidden",
    visibility: index === 0 ? "list" : "hidden",
    description: index === 0 ? "x".repeat(8 * 1024 * 1024) : "",
  }));
  const payload = JSON.stringify({ models });
  expect(Buffer.byteLength(payload)).toBeGreaterThan(8 * 1024 * 1024);
  const { session, pending, callback } = await fixture(
    {},
    privateKey,
    undefined,
    "openid offline_access resource.invoke chatgpt.tokens.use.direct",
    false,
    undefined,
    undefined,
    false,
    () => Promise.resolve(new Response(payload)),
  );
  await session.complete(pending, callback);
  await expect(session.models("issued-client")).resolves.toEqual([{ slug, displayName }]);
});

test("a catalog fetch still completes after the former deadline", async () => {
  const started = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<Response>();
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
      started.resolve(undefined);
      return release.promise;
    },
  );
  await session.complete(pending, callback);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const result = session.models("issued-client").then(
    (models) => ({ models }),
    (error: unknown) => ({ error }),
  );
  await started.promise;
  await vi.advanceTimersByTimeAsync(10_001);
  release.resolve(
    Response.json({
      models: [{ slug: "ready", display_name: "Ready", visibility: "list" }],
    }),
  );
  expect(await result).toEqual({ models: [{ slug: "ready", displayName: "Ready" }] });
});

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
  ["HTTP status", () => new Response("private provider text", { status: 403 })],
  ["invalid shape", () => Response.json({ models: "private provider text" })],
] as const)(
  "catalog %s returns a safe error without leaking provider content",
  async (_reason, failure) => {
    const { session, pending, callback } = await fixture(
      {},
      privateKey,
      undefined,
      "openid offline_access resource.invoke chatgpt.tokens.use.direct",
      false,
      undefined,
      undefined,
      false,
      () => Promise.resolve(failure()),
    );
    await session.complete(pending, callback);
    await expect(session.models("issued-client")).rejects.toThrow(
      "Account model catalog is unavailable.",
    );
  },
);

test("catalog credential failure requires sign-in before any model fetch", async () => {
  const { session, pending, callback, setCodeGrantChanges } = await fixture();
  setCodeGrantChanges({ refresh_token: undefined, expires_in: undefined });
  await session.complete(pending, callback);
  await expect(session.models("issued-client")).rejects.toThrow("sign-in is required");
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

test("canceling a stalled remote revocation still clears local tokens", async () => {
  const started = Promise.withResolvers<AbortSignal | undefined>();
  const { session, store, pending, callback } = await fixture(
    {},
    privateKey,
    undefined,
    "openid offline_access resource.invoke chatgpt.tokens.use.direct",
    false,
    undefined,
    undefined,
    false,
    undefined,
    (signal) => {
      started.resolve(signal);
      return new Promise(() => undefined);
    },
  );
  await session.complete(pending, callback);
  const controller = new AbortController();
  const signingOut = session.signOut("issued-client", controller.signal);
  const transportSignal = await started.promise;
  controller.abort();
  expect(await signingOut).toBe(false);
  expect(transportSignal?.aborted).toBe(true);
  expect((await store.registration("issued-client"))?.accessToken).toBeUndefined();
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

test("a delayed credential read cannot return a token after sign-out finishes", async () => {
  const { session, store, pending, callback } = await fixture();
  await session.complete(pending, callback);
  const readStarted = Promise.withResolvers<undefined>();
  const releaseRead = Promise.withResolvers<undefined>();
  const registration = store.registration.bind(store);
  let delayNext = true;
  store.registration = async (clientId) => {
    const saved = await registration(clientId);
    if (delayNext) {
      delayNext = false;
      readStarted.resolve(undefined);
      await releaseRead.promise;
    }
    return saved;
  };
  const token = session.accessToken("issued-client");
  await readStarted.promise;
  await session.signOut("issued-client");
  releaseRead.resolve(undefined);
  await expect(token).rejects.toThrow();
  expect((await store.registration("issued-client"))?.accessToken).toBeUndefined();
});

test("sign-out waits for every overlapping grant write before clearing tokens", async () => {
  const { session, store, pending, callback, setNonce } = await fixture();
  const second = await session.begin(
    new URL(pending.authorizationUrl).searchParams.get("redirect_uri") ?? "",
  );
  const parameters = new URL(second.authorizationUrl).searchParams;
  const secondCallback = new URL(parameters.get("redirect_uri") ?? "");
  secondCallback.searchParams.set("code", "second-code");
  secondCallback.searchParams.set("state", parameters.get("state") ?? "");
  secondCallback.searchParams.set("client_id", "issued-client");
  const firstWrite = Promise.withResolvers<undefined>();
  const releaseFirst = Promise.withResolvers<undefined>();
  const save = store.save.bind(store);
  let saveCalls = 0;
  store.save = async (registration) => {
    saveCalls += 1;
    if (saveCalls === 1) {
      firstWrite.resolve(undefined);
      await releaseFirst.promise;
    }
    await save(registration);
  };
  setNonce(new URL(pending.authorizationUrl).searchParams.get("nonce") ?? "");
  const firstCompletion = session.complete(pending, callback);
  await firstWrite.promise;
  setNonce(parameters.get("nonce") ?? "");
  await session.complete(second, secondCallback);
  const clear = vi.spyOn(store, "clearTokens");
  const signOutRead = vi.spyOn(store, "registration");
  const signingOut = session.signOut("issued-client");
  let earlyReadCount = 0;
  let earlyClearCount = 0;
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    earlyReadCount = signOutRead.mock.calls.length;
    earlyClearCount = clear.mock.calls.length;
  } finally {
    releaseFirst.resolve(undefined);
  }
  await expect(firstCompletion).rejects.toThrow("canceled");
  await signingOut;
  expect(earlyReadCount).toBe(0);
  expect(earlyClearCount).toBe(0);
  expect(clear).toHaveBeenCalledTimes(1);
  expect((await store.registration("issued-client"))?.accessToken).toBeUndefined();
});

test("canceling sign-out aborts a stalled refresh and clears its last saved grant", async () => {
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
  const controller = new AbortController();
  const signingOut = session.signOut("issued-client", controller.signal);
  controller.abort();
  releaseRefresh?.();
  await expect(refreshing).rejects.toThrow();
  expect(await signingOut).toBe(false);
  expect(revokedTokens).toEqual([]);
  expect((await store.registration("issued-client"))?.refreshToken).toBeUndefined();
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
  const retry = await session.begin(
    new URL(pending.authorizationUrl).searchParams.get("redirect_uri") ?? "",
    "issued-client",
  );
  const retryParameters = new URL(retry.authorizationUrl).searchParams;
  setNonce(retryParameters.get("nonce") ?? "");
  const retryCallback = new URL(retryParameters.get("redirect_uri") ?? "");
  retryCallback.searchParams.set("code", "reconnect-code");
  retryCallback.searchParams.set("state", retryParameters.get("state") ?? "");
  retryCallback.searchParams.set("client_id", "issued-client");
  const completing = session.complete(retry, retryCallback);
  await started;
  const signingOut = session.signOut("issued-client");
  releaseGrant?.();
  await expect(completing).rejects.toThrow();
  await signingOut;
  expect((await store.registration("issued-client"))?.accessToken).toBeUndefined();
});

test("a failed credential clear keeps old plan tokens fenced until removal succeeds", async () => {
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

test("sign-out clears a reconnect grant that completed before it began", async () => {
  const { session, store, pending, callback, setNonce, revokedTokens } = await fixture();
  await session.complete(pending, callback);
  const retry = await session.begin(
    new URL(pending.authorizationUrl).searchParams.get("redirect_uri") ?? "",
    "issued-client",
  );
  const retryParameters = new URL(retry.authorizationUrl).searchParams;
  setNonce(retryParameters.get("nonce") ?? "");
  const retryCallback = new URL(retryParameters.get("redirect_uri") ?? "");
  retryCallback.searchParams.set("code", "reconnect-code");
  retryCallback.searchParams.set("state", retryParameters.get("state") ?? "");
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
  const beginning = session.begin(
    new URL(pending.authorizationUrl).searchParams.get("redirect_uri") ?? "",
    "issued-client",
  );
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
  const retry = await restarted.session.begin(
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
  await expect(restarted.session.complete(retry, retryCallback)).resolves.toMatchObject({
    clientId: "issued-client",
    subject: "subject-1",
  });
  expect(await restarted.store.pendingClientIds()).toEqual([]);
});

test("failed code exchange preserves the staged client for retry", async () => {
  const { session, pending, callback } = await fixture(
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
  const unknown = await fixture(
    {},
    privateKey,
    undefined,
    "openid offline_access resource.invoke chatgpt.tokens.use.direct",
    false,
    undefined,
    undefined,
    "private_custom_code",
  );
  await expect(unknown.session.complete(unknown.pending, unknown.callback)).rejects.toThrow();
  expect(await unknown.store.pendingClientIds()).toEqual(["issued-client"]);
});

test("identity mismatch and persistence failure reject browser grants", async () => {
  const invalid = await fixture();
  await invalid.store.save({
    clientId: "issued-client",
    issuer: "https://auth.openai.com",
    subject: "other-subject",
  });
  await expect(invalid.session.complete(invalid.pending, invalid.callback)).rejects.toThrow();
  const unavailable = await fixture();
  vi.spyOn(unavailable.store, "save").mockRejectedValue(new Error("private storage path"));
  await expect(
    unavailable.session.complete(unavailable.pending, unavailable.callback),
  ).rejects.toThrow();
});

test("a mismatched issued client callback stops before token exchange", async () => {
  const { session, pending, callback, count } = await fixture();
  await session.complete(pending, callback);
  const reconnect = await session.begin(
    new URL(pending.authorizationUrl).searchParams.get("redirect_uri") ?? "",
    "issued-client",
  );
  const parameters = new URL(reconnect.authorizationUrl).searchParams;
  const wrongCallback = new URL(parameters.get("redirect_uri") ?? "");
  wrongCallback.searchParams.set("code", "reconnect-code");
  wrongCallback.searchParams.set("state", parameters.get("state") ?? "");
  wrongCallback.searchParams.set("client_id", "different-client");
  const before = count();
  await expect(session.complete(reconnect, wrongCallback)).rejects.toThrow();
  expect(count()).toBe(before);
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
