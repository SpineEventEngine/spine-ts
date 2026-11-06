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

import {
  InMemoryStorageFactory,
  StorageGroup,
  type RecordStorage,
} from "@spine-event-engine/storage";
import type { BetterAuthSessionRecord } from "@spine-event-engine/proto/auth";
import { hashPassword } from "better-auth/crypto";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it, vi } from "vitest";

import {
  BetterAuthIntegration,
  PersistentBetterAuthStore,
  genericOAuth,
  type SupportedBetterAuthOptions,
} from "../../src/better-auth/index.js";
import { BetterAuthSettings } from "../../src/better-auth/settings.js";

const baseOptions = {
  baseURL: "http://localhost:3000",
  basePath: "/auth",
  secret: "native-integration-secret-32-characters",
  trustedOrigins: ["http://localhost:3000"],
  emailAndPassword: { enabled: true, disableSignUp: true },
  account: { accountLinking: { enabled: false } },
  session: { cookieCache: { enabled: false } },
  advanced: { database: { validateSchema: false } },
} as const;

const { emailAndPassword: passwordOptions, ...noPasswordOptions } = baseOptions;
void passwordOptions;
const { secret: defaultSecret, ...noSecretOptions } = baseOptions;
void defaultSecret;

const unsupportedCookieRole: SupportedBetterAuthOptions["advanced"] = {
  cookies: {
    // @ts-expect-error Unsupported native roles are rejected in the public declaration.
    unsupported: { name: "unsafe" },
  },
};
void unsupportedCookieRole;

describe("bounded Better Auth integration", () => {
  it("admits password login with complete external User email and ID lookups", async () => {
    const factory = new InMemoryStorageFactory();
    const acquired = vi.spyOn(factory, "createRecordStorage");
    let pauseEmail = false;
    let receivedEmailSignal: AbortSignal | undefined;
    let entered!: () => void;
    let release!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const user = {
      id: "directory-password",
      name: "Lin",
      email: "lin@example.test",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better_auth_directory_password"),
      models: ["account", "session"],
      users: {
        findById: (id) => Promise.resolve(id === user.id ? user : undefined),
        findByEmail: async (email, signal) => {
          if (pauseEmail) {
            receivedEmailSignal = signal;
            entered();
            await gate;
          }
          return email === user.email ? user : undefined;
        },
      },
    });
    await store.provision({
      accounts: [
        {
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: await hashPassword("directory-password-123"),
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      ],
    });
    const auth = await BetterAuthIntegration.create({
      store,
      routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
      options: baseOptions,
      onPrincipal: (resolved) => Promise.resolve({ id: resolved.id }),
    });
    try {
      const route = auth.routes.find((entry) => entry.path === "/auth/sign-in/email");
      if (route === undefined) throw new Error("External password route was not generated.");
      const response = await route.onRequest(
        new Request("http://localhost:3000/auth/sign-in/email", {
          method: "POST",
          headers: { origin: "http://localhost:3000", "content-type": "application/json" },
          body: JSON.stringify({ email: user.email, password: "directory-password-123" }),
        }),
        new AbortController().signal,
      );
      expect(response.status).toBe(200);
      const cookie = response.headers.get("set-cookie")?.split(";")[0];
      if (cookie === undefined) throw new Error("Native directory login omitted its cookie.");
      expect((await auth.sessions.resolve({ kind: "cookie", value: cookie }))?.principal.id).toBe(
        user.id,
      );
      const sessions = acquired.mock.results[1]?.value as RecordStorage<
        string,
        BetterAuthSessionRecord
      >;
      const before = (await sessions.queryEntries({})).length;
      pauseEmail = true;
      const controller = new AbortController();
      const late = route.onRequest(
        new Request("http://localhost:3000/auth/sign-in/email", {
          method: "POST",
          headers: { origin: "http://localhost:3000", "content-type": "application/json" },
          body: JSON.stringify({ email: user.email, password: "directory-password-123" }),
        }),
        controller.signal,
      );
      await reading;
      expect(receivedEmailSignal).not.toBe(controller.signal);
      expect(receivedEmailSignal?.aborted).toBe(false);
      controller.abort();
      expect(receivedEmailSignal?.aborted).toBe(true);
      release();
      const refused = await late;
      expect(refused.status).toBe(503);
      expect(refused.headers.get("set-cookie")).toBeNull();
      expect(await sessions.queryEntries({})).toHaveLength(before);
    } finally {
      release();
      await auth.close();
      await store.close();
      await factory.close();
    }
  });

  it("reconstructs only validated native OIDC configuration without running caller plugin code", () => {
    const config = {
      providerId: "company",
      discoveryUrl: "https://issuer.example.test/.well-known/openid-configuration",
      clientId: "test-client",
      clientSecret: "test-secret",
      tokenEndpointAuth: { method: "client_secret_basic" as const },
      scopes: ["openid", "email"],
      pkce: true as const,
      requireIdTokenVerification: true as const,
      disableSignUp: true as const,
      overrideUserInfo: false as const,
    };
    const native = genericOAuth({ config: [config] });
    const accepted = BetterAuthSettings.options({ ...baseOptions, plugins: [native] });
    expect(accepted.plugins?.[0]?.id).toBe("generic-oauth");
    expect(Object.hasOwn(accepted.plugins?.[0] ?? {}, "init")).toBe(false);
    config.scopes[0] = "changed";
    expect(accepted.plugins?.[0]?.options.config[0]?.scopes).toEqual(["openid", "email"]);
    expect(() =>
      BetterAuthSettings.options({
        ...baseOptions,
        plugins: [
          {
            id: "generic-oauth",
            options: { config: [{ ...config, getToken: () => undefined }] },
            init: () => {
              throw new Error("must not execute");
            },
          },
        ],
      }),
    ).toThrow(/Unsupported/u);
    expect(() =>
      BetterAuthSettings.options({
        ...baseOptions,
        plugins: [{ ...native, unsupportedPluginField: true }],
      }),
    ).toThrow(/Unsupported/u);
  });

  it("rejects unsafe native browser, secret, provider, and process-local policy values", () => {
    const provider = {
      providerId: "company",
      discoveryUrl: "https://issuer.example.test/.well-known/openid-configuration",
      clientId: "client",
      clientSecret: "secret",
      tokenEndpointAuth: { method: "client_secret_basic" },
      pkce: true,
      requireIdTokenVerification: true,
      disableSignUp: true,
      overrideUserInfo: false,
    };
    const withProvider = (config: unknown) => ({
      ...baseOptions,
      plugins: [{ id: "generic-oauth", options: { config: [config] } }],
    });
    const withAttributes = (attributes: unknown) => ({
      ...baseOptions,
      advanced: { defaultCookieAttributes: attributes },
    });
    const invalid: readonly [string, unknown][] = [
      ["missing origin", { ...baseOptions, trustedOrigins: [] }],
      ["credentialed URL", { ...baseOptions, baseURL: "https://user:pass@example.test" }],
      ["origin path", { ...baseOptions, trustedOrigins: ["https://example.test/path"] }],
      ["short secret", { ...baseOptions, secret: "short" }],
      [
        "duplicate secret version",
        {
          ...baseOptions,
          secret: undefined,
          secrets: [
            { version: 0, value: baseOptions.secret },
            { version: 0, value: baseOptions.secret },
          ],
        },
      ],
      ["invalid session age", { ...baseOptions, session: { expiresIn: -1 } }],
      ["native cache", { ...baseOptions, session: { cookieCache: { enabled: true } } }],
      [
        "password signup",
        { ...baseOptions, emailAndPassword: { enabled: true, disableSignUp: false } },
      ],
      [
        "password bound",
        {
          ...baseOptions,
          emailAndPassword: {
            enabled: true,
            disableSignUp: true,
            minPasswordLength: 0,
          },
        },
      ],
      [
        "password callback",
        {
          ...baseOptions,
          emailAndPassword: {
            enabled: true,
            disableSignUp: true,
            password: { verify: "unsafe" },
          },
        },
      ],
      ["account update", { ...baseOptions, account: { updateAccountOnSignIn: true } }],
      ["account linking", { ...baseOptions, account: { accountLinking: { enabled: true } } }],
      ["verification cleanup", { ...baseOptions, verification: { disableCleanup: false } }],
      ["cookie prefix", { ...baseOptions, advanced: { cookiePrefix: "bad space" } }],
      [
        "cookie name",
        { ...baseOptions, advanced: { cookies: { session_token: { name: "bad space" } } } },
      ],
      ["unknown cookie role", { ...baseOptions, advanced: { cookies: { unsupported: {} } } }],
      ["schema override", { ...baseOptions, advanced: { database: { validateSchema: true } } }],
      ["insecure cookie", { ...baseOptions, advanced: { useSecureCookies: false } }],
      ["HttpOnly", withAttributes({ httpOnly: false })],
      ["Secure", withAttributes({ secure: false })],
      ["cookie path", withAttributes({ path: "/auth" })],
      ["cookie domain", withAttributes({ domain: 0 })],
      ["cookie expiry", withAttributes({ expires: new Date("invalid") })],
      ["cookie age", withAttributes({ maxAge: -1 })],
      ["SameSite", withAttributes({ sameSite: "unsafe" })],
      ["partitioned", withAttributes({ partitioned: "yes" })],
      ["cookie role prefix", withAttributes({ prefix: "unsafe" })],
      ["rate enabled", { ...baseOptions, rateLimit: { enabled: "yes" } }],
      ["rate storage", { ...baseOptions, rateLimit: { storage: "database" } }],
      ["rate window", { ...baseOptions, rateLimit: { window: 0 } }],
      [
        "rate rule",
        { ...baseOptions, rateLimit: { customRules: { "/auth": { window: 0, max: 1 } } } },
      ],
      ["plugin list", { ...baseOptions, plugins: {} }],
      [
        "provider list",
        { ...baseOptions, plugins: [{ id: "generic-oauth", options: { config: [] } }] },
      ],
      ["provider ID", withProvider({ ...provider, providerId: "" })],
      ["provider client", withProvider({ ...provider, clientId: "" })],
      ["provider secret", withProvider({ ...provider, clientSecret: "" })],
      ["provider redirect", withProvider({ ...provider, redirectURI: "invalid" })],
      ["provider scopes", withProvider({ ...provider, scopes: [""] })],
      ["provider PKCE", withProvider({ ...provider, pkce: false })],
      ["provider email policy", withProvider({ ...provider, requireEmailVerification: "yes" })],
      ["provider auth", withProvider({ ...provider, tokenEndpointAuth: { method: "unsafe" } })],
      ["provider auth empty", withProvider({ ...provider, tokenEndpointAuth: {} })],
      [
        "provider auth missing method",
        withProvider({ ...provider, tokenEndpointAuth: { method: undefined } }),
      ],
      ["provider auth conflict", withProvider({ ...provider, authentication: "basic" })],
      ["provider missing secret", withProvider({ ...provider, clientSecret: undefined })],
      [
        "provider post missing secret",
        withProvider({
          ...provider,
          clientSecret: undefined,
          tokenEndpointAuth: { method: "client_secret_post" },
        }),
      ],
      [
        "duplicate provider across plugins",
        {
          ...baseOptions,
          plugins: [
            { id: "generic-oauth", options: { config: [provider] } },
            { id: "generic-oauth", options: { config: [provider] } },
          ],
        },
      ],
    ];
    for (const [label, value] of invalid)
      expect(() => BetterAuthSettings.options(value), label).toThrow();
    const valid = BetterAuthSettings.options({
      ...baseOptions,
      verification: { disableCleanup: true },
      advanced: {
        defaultCookieAttributes: {
          httpOnly: true,
          secure: true,
          path: "/",
          domain: "example.test",
          expires: new Date("2030-01-01T00:00:00.000Z"),
          maxAge: 60,
          sameSite: "Lax",
          partitioned: false,
          prefix: "host",
        },
      },
      rateLimit: {
        enabled: true,
        storage: "memory",
        window: 60,
        max: 10,
        customRules: { "/auth": { window: 5, max: 2 }, "/disabled": false },
      },
      plugins: [
        {
          id: "generic-oauth",
          options: {
            config: [
              {
                ...provider,
                scopes: ["openid"],
                redirectURI: "https://app.example.test/callback",
                requireEmailVerification: true,
              },
            ],
          },
        },
      ],
    });
    expect(valid.verification?.disableCleanup).toBe(true);
    expect(valid.rateLimit?.storage).toBe("memory");
  });

  it("rejects missing selected record families before native initialization", async () => {
    const factory = new InMemoryStorageFactory();
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better_auth_missing_models"),
      models: ["session"],
    });
    try {
      await expect(
        BetterAuthIntegration.create({
          store,
          routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
          options: baseOptions,
          onPrincipal: (user: { id: string }) => Promise.resolve({ id: user.id }),
        }),
      ).rejects.toThrow(/User and Account/u);
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it.each([
    ["Account", ["user", "session", "verification"]],
    ["Verification", ["user", "account", "session"]],
    ["User", ["account", "session", "verification"]],
  ] as const)("rejects OIDC without selected %s before discovery", async (_missing, models) => {
    const factory = new InMemoryStorageFactory();
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better_auth_oidc_missing_family"),
      models: [...models],
    });
    const discovery = vi.spyOn(globalThis, "fetch");
    try {
      await expect(
        BetterAuthIntegration.create({
          store,
          routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
          options: {
            ...noPasswordOptions,
            plugins: [
              genericOAuth({
                config: [
                  {
                    providerId: "company",
                    discoveryUrl: "https://issuer.example.test/.well-known/openid-configuration",
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
        }),
      ).rejects.toThrow(/OIDC|Account|Verification|User/u);
      expect(discovery).not.toHaveBeenCalled();
    } finally {
      discovery.mockRestore();
      await store.close();
      await factory.close();
    }
  });

  it("uses the native default path and fences pre-aborted routes and non-cookie reads", async () => {
    const factory = new InMemoryStorageFactory();
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better_auth_default_path"),
      models: ["session"],
      users: { findById: () => Promise.resolve(undefined) },
    });
    const auth = await BetterAuthIntegration.create({
      store,
      routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
      options: {
        baseURL: baseOptions.baseURL,
        secret: baseOptions.secret,
        trustedOrigins: baseOptions.trustedOrigins,
        account: baseOptions.account,
        session: baseOptions.session,
      },
      onPrincipal: (user) => Promise.resolve({ id: user.id }),
      login: { verify: () => Promise.resolve("unused") },
    });
    try {
      const route = auth.routes.find((entry) => entry.path === "/api/auth/sign-in/external");
      if (route === undefined) throw new Error("Default native route was absent.");
      const cancelled = new AbortController();
      cancelled.abort();
      const response = await route.onRequest(
        new Request("http://localhost:3000/api/auth/sign-in/external", {
          method: "POST",
          headers: { origin: "http://localhost:3000" },
        }),
        cancelled.signal,
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await auth.sessions.resolve({ kind: "bearer", value: "irrelevant" })).toBeUndefined();
      expect(
        await auth.sessions.resolve({ kind: "cookie", value: "" }, cancelled.signal),
      ).toBeUndefined();
    } finally {
      await auth.close();
      await store.close();
      await factory.close();
    }
  });

  it("captures the validated external verifier and principal mapper before initialization", async () => {
    const factory = new InMemoryStorageFactory();
    const user = {
      id: "captured-user",
      name: "Lin",
      email: "capture@example.test",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better_auth_captured_collaborators"),
      models: ["session"],
      users: { findById: (id) => Promise.resolve(id === user.id ? user : undefined) },
    });
    const verifier = {
      selected: user.id,
      verify() {
        return Promise.resolve(this.selected);
      },
    };
    const input = {
      store,
      routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
      options: { ...noPasswordOptions },
      login: verifier,
      onPrincipal: (value: typeof user) => Promise.resolve({ id: value.id }),
    };
    const pending = BetterAuthIntegration.create(input);
    input.login = { selected: "wrong-user", verify: () => Promise.resolve("wrong-user") };
    input.onPrincipal = () => Promise.resolve({ id: "wrong-principal" });
    const auth = await pending;
    verifier.verify = () => Promise.resolve("wrong-user");
    try {
      const route = auth.routes.find((entry) => entry.path === "/auth/sign-in/external");
      if (route === undefined) throw new Error("Captured external route was absent.");
      const response = await route.onRequest(
        new Request("http://localhost:3000/auth/sign-in/external", {
          method: "POST",
          headers: { origin: "http://localhost:3000" },
        }),
        new AbortController().signal,
      );
      expect(response.status).toBe(200);
      const cookie = response.headers.get("set-cookie")?.split(";")[0];
      if (cookie === undefined) throw new Error("Captured login omitted its cookie.");
      expect((await auth.sessions.resolve({ kind: "cookie", value: cookie }))?.principal.id).toBe(
        user.id,
      );
    } finally {
      await auth.close();
      await store.close();
      await factory.close();
    }
  });

  it("aborts a cooperative login verifier on integration close while the host stays live", async () => {
    const factory = new InMemoryStorageFactory();
    const acquired = vi.spyOn(factory, "createRecordStorage");
    const user = {
      id: "close-route-user",
      name: "Lin",
      email: "route@example.test",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better_auth_close_route"),
      models: ["session"],
      users: { findById: (id) => Promise.resolve(id === user.id ? user : undefined) },
    });
    let entered!: () => void;
    let release: (() => void) | undefined;
    let received: AbortSignal | undefined;
    const verifying = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const auth = await BetterAuthIntegration.create({
      store,
      routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
      options: { ...noPasswordOptions },
      onPrincipal: (value) => Promise.resolve({ id: value.id }),
      login: {
        verify: async (_request, signal) => {
          received = signal;
          entered();
          await new Promise<void>((resolve) => {
            release = resolve;
            signal.addEventListener(
              "abort",
              () => {
                resolve();
              },
              { once: true },
            );
          });
          return user.id;
        },
      },
    });
    const host = new AbortController();
    let active: Promise<Response> | undefined;
    try {
      const route = auth.routes.find((entry) => entry.path === "/auth/sign-in/external");
      if (route === undefined) throw new Error("External route was absent.");
      active = Promise.resolve(
        route.onRequest(
          new Request("http://localhost:3000/auth/sign-in/external", {
            method: "POST",
            headers: { origin: "http://localhost:3000" },
          }),
          host.signal,
        ),
      );
      void active.catch(() => undefined);
      await verifying;
      let drained = false;
      const closing = auth.close().then(() => {
        drained = true;
      });
      expect(drained).toBe(false);
      expect(host.signal.aborted).toBe(false);
      expect(received?.aborted).toBe(true);
      const response = await active;
      expect(response.status).toBe(503);
      expect(response.headers.get("set-cookie")).toBeNull();
      await closing;
      expect(drained).toBe(true);
      const sessions = acquired.mock.results[0]?.value as RecordStorage<
        string,
        BetterAuthSessionRecord
      >;
      expect(await sessions.queryEntries({})).toHaveLength(0);
    } finally {
      release?.();
      await active?.catch(() => undefined);
      await auth.close();
      await store.close();
      await factory.close();
    }
  });

  it("aborts a cooperative native renewal directory read on integration close", async () => {
    const factory = new InMemoryStorageFactory();
    const user = {
      id: "renewal-close-user",
      name: "Lin",
      email: "renewal@example.test",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    let delay = false;
    let entered!: () => void;
    let release: (() => void) | undefined;
    let received: AbortSignal | undefined;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better_auth_close_renewal"),
      models: ["session"],
      users: {
        findById: async (_id, signal) => {
          if (delay) {
            received = signal;
            entered();
            await new Promise<void>((resolve) => {
              release = resolve;
              received?.addEventListener(
                "abort",
                () => {
                  resolve();
                },
                { once: true },
              );
            });
          }
          return user;
        },
      },
    });
    const auth = await BetterAuthIntegration.create({
      store,
      routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
      options: { ...noPasswordOptions },
      onPrincipal: (value) => Promise.resolve({ id: value.id }),
      login: { verify: () => Promise.resolve(user.id) },
    });
    let active: Promise<Response> | undefined;
    try {
      const login = auth.routes.find((route) => route.path === "/auth/sign-in/external");
      const renewal = auth.routes.find((route) => route.path === "/auth/get-session");
      if (login === undefined || renewal === undefined)
        throw new Error("Native routes were absent.");
      const issued = await login.onRequest(
        new Request("http://localhost:3000/auth/sign-in/external", {
          method: "POST",
          headers: { origin: "http://localhost:3000" },
        }),
        new AbortController().signal,
      );
      const cookie = issued.headers.get("set-cookie")?.split(";")[0];
      if (cookie === undefined) throw new Error("Native renewal cookie was absent.");
      delay = true;
      const host = new AbortController();
      active = Promise.resolve(
        renewal.onRequest(
          new Request("http://localhost:3000/auth/get-session", {
            method: "GET",
            headers: { origin: "http://localhost:3000", cookie },
          }),
          host.signal,
        ),
      );
      void active.catch(() => undefined);
      await reading;
      const closing = auth.close();
      expect(host.signal.aborted).toBe(false);
      expect(received?.aborted).toBe(true);
      const response = await active;
      expect(response.status).toBe(503);
      expect(response.headers.getSetCookie()).toHaveLength(0);
      await closing;
    } finally {
      release?.();
      await active?.catch(() => undefined);
      await auth.close();
      await store.close();
      await factory.close();
    }
  });

  it("requires application route bounds and snapshots exact password routes", async () => {
    const factory = new InMemoryStorageFactory();
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better_auth_integration"),
      models: ["user", "account", "session"],
    });
    try {
      await expect(
        BetterAuthIntegration.create({
          store,
          options: baseOptions,
          onPrincipal: (user: { id: string }) => Promise.resolve({ id: user.id }),
        } as unknown as Parameters<typeof BetterAuthIntegration.create>[0]),
      ).rejects.toThrow(/routePolicy/u);
      for (const routePolicy of [
        { maxRequestBytes: 0, timeoutMs: 5_000 },
        { maxRequestBytes: 4_096, timeoutMs: 0 },
        { maxRequestBytes: 4_096, timeoutMs: 5_000, extra: true },
      ])
        await expect(
          BetterAuthIntegration.create({
            store,
            routePolicy,
            options: baseOptions,
            onPrincipal: (user) => Promise.resolve({ id: user.id }),
          }),
        ).rejects.toThrow(/routePolicy/u);
      let pluginInit = false;
      for (const options of [
        { ...baseOptions, secondaryStorage: {} },
        {
          ...baseOptions,
          plugins: [
            {
              id: "malicious",
              init: () => {
                pluginInit = true;
              },
            },
          ],
        },
        { ...baseOptions, session: { cookieCache: { enabled: true } } },
        { ...baseOptions, emailAndPassword: { enabled: true, disableSignUp: false } },
        { ...baseOptions, trustedOrigins: ["not-an-origin"] },
        {
          ...baseOptions,
          advanced: {
            cookies: {
              session_token: { name: "same.cookie" },
              state: { name: "same.cookie" },
            },
          },
        },
      ])
        await expect(
          BetterAuthIntegration.create({
            store,
            routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
            options: options as typeof baseOptions,
            onPrincipal: (user) => Promise.resolve({ id: user.id }),
          }),
        ).rejects.toThrow();
      expect(pluginInit).toBe(false);
      const zeroVersion = await BetterAuthIntegration.create({
        store,
        routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
        options: {
          ...noSecretOptions,
          secrets: [{ version: 0, value: baseOptions.secret }],
        },
        onPrincipal: (user) => Promise.resolve({ id: user.id }),
      });
      await zeroVersion.close();
      const names = {
        session_token: { name: "before.session" },
        state: { name: "before.state" },
      };
      const pending = BetterAuthIntegration.create({
        store,
        routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
        options: { ...baseOptions, advanced: { ...baseOptions.advanced, cookies: names } },
        onPrincipal: (user) => Promise.resolve({ id: user.id }),
      });
      names.session_token.name = "after.session";
      names.state.name = "after.state";
      const captured = await pending;
      expect(captured.credentials.admission.credentialCookieNames).toEqual(["before.session"]);
      expect(captured.credentials.admission.stateCookieNames).toContain("before.state");
      await captured.close();
      const secure = await BetterAuthIntegration.create({
        store,
        routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
        options: {
          ...baseOptions,
          baseURL: "https://app.example.test",
          trustedOrigins: ["https://app.example.test"],
          advanced: { useSecureCookies: true },
        },
        onPrincipal: (user) => Promise.resolve({ id: user.id }),
      });
      expect(secure.credentials.admission.credentialCookieNames).toEqual([
        "__Secure-better-auth.session_token",
      ]);
      await secure.close();
      const auth = await BetterAuthIntegration.create({
        store,
        routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
        options: baseOptions,
        onPrincipal: (user) => Promise.resolve({ id: user.id }),
      });
      try {
        expect(auth.routes.map((route) => [route.method, route.path])).toEqual([
          ["POST", "/auth/sign-in/email"],
          ["GET", "/auth/get-session"],
          ["POST", "/auth/sign-out"],
        ]);
        expect(Object.isFrozen(auth.routes)).toBe(true);
        expect(auth.routes.every((route) => Object.isFrozen(route))).toBe(true);
      } finally {
        await auth.close();
      }
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it("uses native password verification and authoritative session resolution", async () => {
    const factory = new InMemoryStorageFactory();
    const acquired = vi.spyOn(factory, "createRecordStorage");
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better_auth_password_bridge"),
      models: ["user", "account", "session"],
    });
    const current = new Date();
    await store.provision({
      users: [
        {
          id: "user-1",
          name: "Ada",
          email: "ada@example.test",
          emailVerified: true,
          createdAt: current,
          updatedAt: current,
        },
      ],
      accounts: [
        {
          userId: "user-1",
          accountId: "user-1",
          providerId: "credential",
          password: await hashPassword("correct-password-123"),
          createdAt: current,
          updatedAt: current,
        },
      ],
    });
    const auth = await BetterAuthIntegration.create({
      store,
      routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
      options: {
        ...baseOptions,
        session: {
          cookieCache: { enabled: false },
          expiresIn: 60,
          updateAge: 0,
        },
      },
      onPrincipal: (user) => Promise.resolve({ id: user.id }),
    });
    try {
      const route = auth.routes.find((entry) => entry.path === "/auth/sign-in/email");
      if (route === undefined) throw new Error("Password route was not generated.");
      const wrong = await route.onRequest(
        new Request("http://localhost:3000/auth/sign-in/email", {
          method: "POST",
          headers: { origin: "http://localhost:3000", "content-type": "application/json" },
          body: JSON.stringify({ email: "ada@example.test", password: "wrong-password-123" }),
        }),
        new AbortController().signal,
      );
      expect(wrong.status).toBe(401);
      expect(wrong.headers.get("set-cookie")).toBeNull();
      const login = await route.onRequest(
        new Request("http://localhost:3000/auth/sign-in/email", {
          method: "POST",
          headers: { origin: "http://localhost:3000", "content-type": "application/json" },
          body: JSON.stringify({ email: "ada@example.test", password: "correct-password-123" }),
        }),
        new AbortController().signal,
      );
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie")?.split(";")[0];
      expect(cookie).toBeDefined();
      if (cookie === undefined) throw new Error("Native login did not set a session cookie.");
      const credential = await auth.credentials.read({
        headers: { cookie },
        method: "POST",
        url: new URL("http://localhost:3000/spine/rpc"),
      });
      expect(credential).toEqual({ kind: "cookie", value: cookie });
      if (credential === undefined || credential.kind === "rejected")
        throw new Error("Native credential reader rejected a valid cookie.");
      expect((await auth.sessions.resolve(credential))?.principal.id).toBe("user-1");
      expect(await auth.sessions.resolve({ kind: "cookie", value: "invalid" })).toBeUndefined();
      const renewal = auth.routes.find((entry) => entry.path === "/auth/get-session");
      if (renewal === undefined) throw new Error("Native renewal route was not generated.");
      const storage = acquired.mock.results[2]?.value as RecordStorage<
        string,
        BetterAuthSessionRecord
      >;
      const writes = vi.spyOn(storage, "compareAndSet");
      const renewed = await renewal.onRequest(
        new Request("http://localhost:3000/auth/get-session", {
          method: "GET",
          headers: { origin: "http://localhost:3000", cookie },
        }),
        new AbortController().signal,
      );
      expect(renewed.status).toBe(200);
      expect(renewed.headers.getSetCookie()).not.toHaveLength(0);
      const cookieName = cookie.split("=")[0];
      if (cookieName === undefined) throw new Error("Native cookie name was absent.");
      expect(
        renewed.headers.getSetCookie().some((header) => header.startsWith(`${cookieName}=`)),
      ).toBe(true);
      expect(writes.mock.calls.some((call) => call[2] !== undefined)).toBe(true);
      expect(await auth.sessions.resolve(credential)).toBeDefined();
      const accountStorage = acquired.mock.results[1]?.value as RecordStorage<string, never>;
      const failedRead = vi
        .spyOn(accountStorage, "queryEntries")
        .mockRejectedValue(new Error("account query sentinel"));
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const previousWrites = writes.mock.calls.length;
      try {
        const unavailable = await route.onRequest(
          new Request("http://localhost:3000/auth/sign-in/email", {
            method: "POST",
            headers: { origin: "http://localhost:3000", "content-type": "application/json" },
            body: JSON.stringify({ email: "ada@example.test", password: "correct-password-123" }),
          }),
          new AbortController().signal,
        );
        expect(unavailable.status).toBe(503);
        expect(unavailable.headers.get("set-cookie")).toBeNull();
        expect(writes.mock.calls).toHaveLength(previousWrites);
        expect(logged.mock.calls).toHaveLength(0);
      } finally {
        failedRead.mockRestore();
        logged.mockRestore();
      }
      expect(
        await route.onRequest(
          new Request("http://localhost:3000/auth/spine/verified-token", {
            method: "POST",
          }),
          new AbortController().signal,
        ),
      ).toHaveProperty("status", 404);
    } finally {
      await auth.close();
      await store.close();
      await factory.close();
    }
  });

  it("accepts only the active native secret for signed session cookies", async () => {
    const factory = new InMemoryStorageFactory();
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better_auth_active_secret"),
      models: ["user", "account", "session"],
    });
    const now = new Date();
    await store.provision({
      users: [
        {
          id: "rotation-user",
          name: "Lin",
          email: "lin@example.test",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
      accounts: [
        {
          userId: "rotation-user",
          accountId: "rotation-user",
          providerId: "credential",
          password: await hashPassword("rotation-password-123"),
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    const active = { version: 0, value: "native-secret-first-at-least-32-characters" };
    const next = { version: 1, value: "native-secret-second-at-least-32-characters" };
    const input = (secrets: { version: number; value: string }[]) => ({
      store,
      routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
      options: { ...noSecretOptions, secrets },
      onPrincipal: (user: { id: string }) => Promise.resolve({ id: user.id }),
    });
    const before = await BetterAuthIntegration.create(input([active]));
    let after: BetterAuthIntegration | undefined;
    try {
      const login = before.routes.find((route) => route.path === "/auth/sign-in/email");
      if (login === undefined) throw new Error("Password route was not generated.");
      const response = await login.onRequest(
        new Request("http://localhost:3000/auth/sign-in/email", {
          method: "POST",
          headers: { origin: "http://localhost:3000", "content-type": "application/json" },
          body: JSON.stringify({ email: "lin@example.test", password: "rotation-password-123" }),
        }),
        new AbortController().signal,
      );
      const cookie = response.headers.get("set-cookie")?.split(";")[0];
      if (cookie === undefined) throw new Error("Native login omitted its cookie.");
      expect((await before.sessions.resolve({ kind: "cookie", value: cookie }))?.principal.id).toBe(
        "rotation-user",
      );
      after = await BetterAuthIntegration.create(input([next, active]));
      expect(await after.sessions.resolve({ kind: "cookie", value: cookie })).toBeUndefined();
      const nextLogin = after.routes.find((route) => route.path === "/auth/sign-in/email");
      if (nextLogin === undefined) throw new Error("Rotated password route was not generated.");
      const nextResponse = await nextLogin.onRequest(
        new Request("http://localhost:3000/auth/sign-in/email", {
          method: "POST",
          headers: { origin: "http://localhost:3000", "content-type": "application/json" },
          body: JSON.stringify({ email: "lin@example.test", password: "rotation-password-123" }),
        }),
        new AbortController().signal,
      );
      const nextCookie = nextResponse.headers.get("set-cookie")?.split(";")[0];
      if (nextCookie === undefined) throw new Error("Rotated native login omitted its cookie.");
      expect(
        (await after.sessions.resolve({ kind: "cookie", value: nextCookie }))?.principal.id,
      ).toBe("rotation-user");
      expect((await before.sessions.resolve({ kind: "cookie", value: cookie }))?.principal.id).toBe(
        "rotation-user",
      );
    } finally {
      await after?.close();
      await before.close();
      await store.close();
      await factory.close();
    }
  });

  it("resolves and strictly revokes an existing native session after integration restart", async () => {
    const factory = new InMemoryStorageFactory();
    const group = new StorageGroup("better_auth_native_restart");
    const user = {
      id: "restart-user",
      name: "Lin",
      email: "restart@example.test",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const users = { findById: (id: string) => Promise.resolve(id === user.id ? user : undefined) };
    const create = async (store: PersistentBetterAuthStore) =>
      BetterAuthIntegration.create({
        store,
        routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
        options: { ...noPasswordOptions },
        onPrincipal: (value) => Promise.resolve({ id: value.id }),
        login: { verify: () => Promise.resolve(user.id) },
      });
    const firstStore = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group,
      models: ["session"],
      users,
    });
    const first = await create(firstStore);
    let secondStore: PersistentBetterAuthStore | undefined;
    let second: BetterAuthIntegration | undefined;
    try {
      const login = first.routes.find((route) => route.path === "/auth/sign-in/external");
      if (login === undefined) throw new Error("External login route was not generated.");
      const issued = await login.onRequest(
        new Request("http://localhost:3000/auth/sign-in/external", {
          method: "POST",
          headers: { origin: "http://localhost:3000" },
        }),
        new AbortController().signal,
      );
      const cookie = issued.headers.get("set-cookie")?.split(";")[0];
      if (cookie === undefined) throw new Error("Native login omitted its cookie.");
      await first.close();
      await firstStore.close();
      secondStore = await PersistentBetterAuthStore.create({
        storageFactory: factory,
        group,
        models: ["session"],
        users,
        createMissingStructures: false,
      });
      second = await create(secondStore);
      expect((await second.sessions.resolve({ kind: "cookie", value: cookie }))?.principal.id).toBe(
        user.id,
      );
      const logout = second.routes.find((route) => route.path === "/auth/sign-out");
      if (logout === undefined) throw new Error("Strict logout route was not generated.");
      expect(
        (
          await logout.onRequest(
            new Request("http://localhost:3000/auth/sign-out", {
              method: "POST",
              headers: { origin: "http://localhost:3000", cookie },
            }),
            new AbortController().signal,
          )
        ).status,
      ).toBe(200);
      expect(await second.sessions.resolve({ kind: "cookie", value: cookie })).toBeUndefined();
    } finally {
      await second?.close();
      await secondStore?.close();
      await first.close();
      await firstStore.close();
      await factory.close();
    }
  });

  it("drains a pending native principal lookup and never returns a session after close", async () => {
    const factory = new InMemoryStorageFactory();
    const user = {
      id: "closing-user",
      name: "Lin",
      email: "closing@example.test",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better_auth_close_lookup"),
      models: ["session"],
      users: { findById: () => Promise.resolve(user) },
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const auth = await BetterAuthIntegration.create({
      store,
      routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
      options: { ...noPasswordOptions },
      login: { verify: () => Promise.resolve(user.id) },
      onPrincipal: async (resolved) => {
        entered();
        await gate;
        return { id: resolved.id };
      },
    });
    try {
      const route = auth.routes.find((item) => item.path === "/auth/sign-in/external");
      if (route === undefined) throw new Error("External login route was not generated.");
      const response = await route.onRequest(
        new Request("http://localhost:3000/auth/sign-in/external", {
          method: "POST",
          headers: { origin: "http://localhost:3000" },
        }),
        new AbortController().signal,
      );
      const cookie = response.headers.get("set-cookie")?.split(";")[0];
      if (cookie === undefined) throw new Error("Native login omitted its cookie.");
      const lifetime = new AbortController();
      const pending = auth.sessions.resolve({ kind: "cookie", value: cookie }, lifetime.signal);
      await reached;
      let closed = false;
      const closing = auth.close().then(() => {
        closed = true;
      });
      expect(closed).toBe(false);
      release();
      expect(await pending).toBeUndefined();
      await closing;
      expect(closed).toBe(true);
      expect(lifetime.signal.aborted).toBe(false);
    } finally {
      release();
      await auth.close();
      await store.close();
      await factory.close();
    }
  });

  it("reports durable native logout deletion failure without successful sign-out", async () => {
    const factory = new InMemoryStorageFactory();
    const acquired = vi.spyOn(factory, "createRecordStorage");
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better_auth_strict_logout"),
      models: ["user", "account", "session"],
    });
    const current = new Date();
    await store.provision({
      users: [
        {
          id: "user-1",
          name: "Ada",
          email: "ada@example.test",
          emailVerified: true,
          createdAt: current,
          updatedAt: current,
        },
      ],
      accounts: [
        {
          userId: "user-1",
          accountId: "user-1",
          providerId: "credential",
          password: await hashPassword("correct-password-123"),
          createdAt: current,
          updatedAt: current,
        },
      ],
    });
    const auth = await BetterAuthIntegration.create({
      store,
      routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
      options: baseOptions,
      onPrincipal: (user) => Promise.resolve({ id: user.id }),
    });
    try {
      const loginRoute = auth.routes.find((route) => route.path === "/auth/sign-in/email");
      const logoutRoute = auth.routes.find((route) => route.path === "/auth/sign-out");
      if (loginRoute === undefined || logoutRoute === undefined)
        throw new Error("Missing native route.");
      const response = await loginRoute.onRequest(
        new Request("http://localhost:3000/auth/sign-in/email", {
          method: "POST",
          headers: { origin: "http://localhost:3000", "content-type": "application/json" },
          body: JSON.stringify({ email: "ada@example.test", password: "correct-password-123" }),
        }),
        new AbortController().signal,
      );
      const cookie = response.headers.get("set-cookie")?.split(";")[0];
      if (cookie === undefined) throw new Error("Native login omitted its session cookie.");
      const storage = acquired.mock.results[2]?.value as RecordStorage<
        string,
        BetterAuthSessionRecord
      >;
      const operation = new AbortController();
      const active = await auth.sessions.resolve(
        { kind: "cookie", value: cookie },
        operation.signal,
      );
      expect(active?.invalidated?.aborted).toBe(false);
      const original = storage.compareAndSet.bind(storage);
      const deletion = vi
        .spyOn(storage, "compareAndSet")
        .mockImplementation((id, expected, next) => {
          if (next === undefined) throw new Error("durable logout failed");
          return original(id, expected, next);
        });
      const logout = await logoutRoute.onRequest(
        new Request("http://localhost:3000/auth/sign-out", {
          method: "POST",
          headers: { origin: "http://localhost:3000", cookie },
        }),
        new AbortController().signal,
      );
      expect(logout.status).toBe(503);
      expect(active?.invalidated?.aborted).toBe(true);
      expect((await auth.sessions.resolve({ kind: "cookie", value: cookie }))?.principal.id).toBe(
        "user-1",
      );
      deletion.mockRestore();
      const confirmed = await logoutRoute.onRequest(
        new Request("http://localhost:3000/auth/sign-out", {
          method: "POST",
          headers: { origin: "http://localhost:3000", cookie },
        }),
        new AbortController().signal,
      );
      expect(confirmed.status).toBe(200);
      expect(active?.invalidated?.aborted).toBe(true);
      expect(await auth.sessions.resolve({ kind: "cookie", value: cookie })).toBeUndefined();
    } finally {
      await auth.close();
      await store.close();
      await factory.close();
    }
  });

  it("does not resurrect a native Session when strict logout wins a renewal race", async () => {
    const factory = new InMemoryStorageFactory();
    const acquired = vi.spyOn(factory, "createRecordStorage");
    const user = {
      id: "race-user",
      name: "Ada",
      email: "race@example.test",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better_auth_renewal_logout_race"),
      models: ["session"],
      users: { findById: () => Promise.resolve(user) },
    });
    const auth = await BetterAuthIntegration.create({
      store,
      routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
      options: {
        ...noPasswordOptions,
        session: { cookieCache: { enabled: false }, expiresIn: 60, updateAge: 0 },
      },
      login: { verify: () => Promise.resolve(user.id) },
      onPrincipal: (resolved) => Promise.resolve({ id: resolved.id }),
    });
    try {
      const issue = auth.routes.find((route) => route.path === "/auth/sign-in/external");
      const renew = auth.routes.find((route) => route.path === "/auth/get-session");
      const logout = auth.routes.find((route) => route.path === "/auth/sign-out");
      if (issue === undefined || renew === undefined || logout === undefined)
        throw new Error("Native session routes were not generated.");
      const login = async () => {
        const response = await issue.onRequest(
          new Request("http://localhost:3000/auth/sign-in/external", {
            method: "POST",
            headers: { origin: "http://localhost:3000" },
          }),
          new AbortController().signal,
        );
        const cookie = response.headers.get("set-cookie")?.split(";")[0];
        if (cookie === undefined) throw new Error("Native login omitted its cookie.");
        return cookie;
      };
      const cookie = await login();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered!: () => void;
      const reached = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const storage = acquired.mock.results[0]?.value as RecordStorage<
        string,
        BetterAuthSessionRecord
      >;
      const original = storage.compareAndSet.bind(storage);
      const held = vi
        .spyOn(storage, "compareAndSet")
        .mockImplementation(async (id, expected, next) => {
          if (next !== undefined) {
            entered();
            await gate;
          }
          return original(id, expected, next);
        });
      const pending = renew.onRequest(
        new Request("http://localhost:3000/auth/get-session", {
          headers: { origin: "http://localhost:3000", cookie },
        }),
        new AbortController().signal,
      );
      try {
        await reached;
        const removed = await logout.onRequest(
          new Request("http://localhost:3000/auth/sign-out", {
            method: "POST",
            headers: { origin: "http://localhost:3000", cookie },
          }),
          new AbortController().signal,
        );
        expect(removed.status).toBe(200);
      } finally {
        release();
        held.mockRestore();
      }
      expect((await pending).status).not.toBe(200);
      expect(await auth.sessions.resolve({ kind: "cookie", value: cookie })).toBeUndefined();
      const nextCookie = await login();
      const firstRenewal = await renew.onRequest(
        new Request("http://localhost:3000/auth/get-session", {
          headers: { origin: "http://localhost:3000", cookie: nextCookie },
        }),
        new AbortController().signal,
      );
      expect(firstRenewal.status).toBe(200);
      const laterLogout = await logout.onRequest(
        new Request("http://localhost:3000/auth/sign-out", {
          method: "POST",
          headers: { origin: "http://localhost:3000", cookie: nextCookie },
        }),
        new AbortController().signal,
      );
      expect(laterLogout.status).toBe(200);
      expect(await auth.sessions.resolve({ kind: "cookie", value: nextCookie })).toBeUndefined();
    } finally {
      await auth.close();
      await store.close();
      await factory.close();
    }
  });

  it("requires trusted external proof before the native engine issues a session", async () => {
    const factory = new InMemoryStorageFactory();
    const current = new Date();
    const user = {
      id: "external-1",
      name: "Lin",
      email: "lin@example.test",
      emailVerified: true,
      createdAt: current,
      updatedAt: current,
    };
    let directoryMode: "present" | "absent" | "outage" | "incomplete" = "present";
    const outage = new Error("directory outage sentinel");
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better_auth_external_bridge"),
      models: ["session"],
      users: {
        findById: (id) =>
          Promise.resolve().then(() => {
            if (directoryMode === "outage") throw outage;
            if (directoryMode === "absent" || id !== user.id) return undefined;
            if (directoryMode === "incomplete")
              return { ...user, email: undefined } as unknown as typeof user;
            return user;
          }),
      },
    });
    const auth = await BetterAuthIntegration.create({
      store,
      routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
      options: { ...noPasswordOptions },
      onPrincipal: (resolved) => Promise.resolve({ id: resolved.id }),
      login: {
        verify: (request) =>
          Promise.resolve(request.headers.get("x-login-proof") === "trusted" ? user.id : undefined),
      },
    });
    try {
      const route = auth.routes.find((entry) => entry.path === "/auth/sign-in/external");
      if (route === undefined) throw new Error("External login route was not generated.");
      const untrusted = await route.onRequest(
        new Request("http://localhost:3000/auth/sign-in/external", {
          method: "POST",
          headers: { origin: "http://localhost:3000", "content-type": "application/json" },
          body: JSON.stringify({ userId: user.id }),
        }),
        new AbortController().signal,
      );
      expect(untrusted.status).toBe(401);
      expect(untrusted.headers.get("set-cookie")).toBeNull();
      const trusted = await route.onRequest(
        new Request("http://localhost:3000/auth/sign-in/external", {
          method: "POST",
          headers: { origin: "http://localhost:3000", "x-login-proof": "trusted" },
        }),
        new AbortController().signal,
      );
      expect(trusted.status).toBe(200);
      const cookie = trusted.headers.get("set-cookie")?.split(";")[0];
      if (cookie === undefined) throw new Error("Native external login omitted its cookie.");
      expect((await auth.sessions.resolve({ kind: "cookie", value: cookie }))?.principal.id).toBe(
        user.id,
      );
      directoryMode = "absent";
      expect(await auth.sessions.resolve({ kind: "cookie", value: cookie })).toBeUndefined();
      directoryMode = "outage";
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        await expect(auth.sessions.resolve({ kind: "cookie", value: cookie })).rejects.toThrow(
          /Failed to get session/u,
        );
        expect(
          logged.mock.calls.map((args) =>
            typeof args[0] === "string" ? args[0] : String(args[0]),
          ),
        ).toEqual([]);
      } finally {
        logged.mockRestore();
      }
      directoryMode = "incomplete";
      await expect(auth.sessions.resolve({ kind: "cookie", value: cookie })).rejects.toThrow();
    } finally {
      await auth.close();
      await store.close();
      await factory.close();
    }
  });

  it("does not disclose a password session committed after host cancellation", async () => {
    const factory = new InMemoryStorageFactory();
    const acquired = vi.spyOn(factory, "createRecordStorage");
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better_auth_cancelled_password"),
      models: ["user", "account", "session"],
    });
    const current = new Date();
    await store.provision({
      users: [
        {
          id: "user-1",
          name: "Ada",
          email: "ada@example.test",
          emailVerified: true,
          createdAt: current,
          updatedAt: current,
        },
      ],
      accounts: [
        {
          userId: "user-1",
          accountId: "user-1",
          providerId: "credential",
          password: "test-hash",
          createdAt: current,
          updatedAt: current,
        },
      ],
    });
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const verifying = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const auth = await BetterAuthIntegration.create({
      store,
      routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
      options: {
        ...baseOptions,
        emailAndPassword: {
          enabled: true,
          disableSignUp: true,
          password: {
            verify: async () => {
              entered();
              await gate;
              return true;
            },
          },
        },
      },
      onPrincipal: (user) => Promise.resolve({ id: user.id }),
    });
    try {
      const route = auth.routes.find((entry) => entry.path === "/auth/sign-in/email");
      if (route === undefined) throw new Error("Password route was not generated.");
      const controller = new AbortController();
      const pending = route.onRequest(
        new Request("http://localhost:3000/auth/sign-in/email", {
          method: "POST",
          headers: { origin: "http://localhost:3000", "content-type": "application/json" },
          body: JSON.stringify({ email: "ada@example.test", password: "correct-password-123" }),
        }),
        controller.signal,
      );
      await verifying;
      controller.abort(new Error("host cancelled"));
      release();
      const response = await pending;
      expect(response.status).toBe(503);
      expect(response.headers.get("set-cookie")).toBeNull();
      const storage = acquired.mock.results[2]?.value as RecordStorage<
        string,
        BetterAuthSessionRecord
      >;
      expect(await storage.queryEntries({})).toHaveLength(0);
    } finally {
      await auth.close();
      await store.close();
      await factory.close();
    }
  });

  it("retains an expired row when a native User lookup crosses the expiry instant", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2025-01-01T00:00:00.000Z");
    vi.setSystemTime(start);
    const factory = new InMemoryStorageFactory();
    const acquired = vi.spyOn(factory, "createRecordStorage");
    const user = {
      id: "external-1",
      name: "Lin",
      email: "lin@example.test",
      emailVerified: true,
      createdAt: start,
      updatedAt: start,
    };
    let pause = false;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better_auth_slow_user"),
      models: ["session"],
      users: {
        findById: async () => {
          if (pause) {
            entered();
            await gate;
          }
          return user;
        },
      },
      clock: () => timestampFromDate(new Date()),
    });
    const auth = await BetterAuthIntegration.create({
      store,
      routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
      options: {
        ...noPasswordOptions,
        session: {
          expiresIn: 1,
          updateAge: 1,
          cookieCache: { enabled: false },
        },
      },
      onPrincipal: (value) => Promise.resolve({ id: value.id }),
      login: { verify: () => Promise.resolve(user.id) },
    });
    try {
      const route = auth.routes.find((entry) => entry.path === "/auth/sign-in/external");
      if (route === undefined) throw new Error("External route was not generated.");
      const response = await route.onRequest(
        new Request("http://localhost:3000/auth/sign-in/external", {
          method: "POST",
          headers: { origin: "http://localhost:3000" },
        }),
        new AbortController().signal,
      );
      const cookie = response.headers.get("set-cookie")?.split(";")[0];
      if (cookie === undefined) throw new Error("Native session cookie was not issued.");
      pause = true;
      const pending = auth.sessions.resolve({ kind: "cookie", value: cookie });
      await reading;
      vi.setSystemTime(new Date(start.getTime() + 2_000));
      release();
      expect(await pending).toBeUndefined();
      const storage = acquired.mock.results[0]?.value as RecordStorage<
        string,
        BetterAuthSessionRecord
      >;
      expect(await storage.queryEntries({})).toHaveLength(1);
      expect(await store.purgeExpired(timestampFromDate(new Date()))).toBe(1);
      expect(await storage.queryEntries({})).toHaveLength(0);
    } finally {
      release();
      await auth.close();
      await store.close();
      await factory.close();
      vi.useRealTimers();
    }
  });

  it("uses the monitored lifetime for directory reads and drains logout and close", async () => {
    const factory = new InMemoryStorageFactory();
    const user = {
      id: "delayed-user",
      name: "Lin",
      email: "lin@example.test",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    let pause = false;
    let cooperative = false;
    let releaseCooperative: (() => void) | undefined;
    let observed: Promise<unknown> | undefined;
    let received: AbortSignal | undefined;
    let entered!: () => void;
    let release!: () => void;
    let reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better_auth_directory_abort"),
      models: ["session"],
      users: {
        findById: async (_id, signal) => {
          if (cooperative) {
            received = signal;
            entered();
            await new Promise<void>((resolve) => {
              releaseCooperative = resolve;
              signal?.addEventListener(
                "abort",
                () => {
                  resolve();
                },
                { once: true },
              );
            });
          }
          if (pause) {
            received = signal;
            entered();
            await gate;
          }
          return user;
        },
      },
    });
    const auth = await BetterAuthIntegration.create({
      store,
      routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
      options: { ...noPasswordOptions },
      onPrincipal: (value) => Promise.resolve({ id: value.id }),
      login: { verify: () => Promise.resolve(user.id) },
    });
    try {
      const route = auth.routes.find((entry) => entry.path === "/auth/sign-in/external");
      if (route === undefined) throw new Error("External route was not generated.");
      const issued = await route.onRequest(
        new Request("http://localhost:3000/auth/sign-in/external", {
          method: "POST",
          headers: { origin: "http://localhost:3000" },
        }),
        new AbortController().signal,
      );
      const cookie = issued.headers.get("set-cookie")?.split(";")[0];
      if (cookie === undefined) throw new Error("Native session cookie was not issued.");
      pause = true;
      const controller = new AbortController();
      const pending = auth.sessions.resolve({ kind: "cookie", value: cookie }, controller.signal);
      await reading;
      expect(received?.aborted).toBe(false);
      controller.abort();
      release();
      expect(await pending).toBeUndefined();
      expect(received).not.toBe(controller.signal);
      expect(received?.aborted).toBe(true);
      reading = new Promise<void>((resolve) => {
        entered = resolve;
      });
      pause = false;
      cooperative = true;
      const liveHost = new AbortController();
      const logoutRead = auth.sessions.resolve({ kind: "cookie", value: cookie }, liveHost.signal);
      observed = logoutRead.catch(() => undefined);
      await reading;
      const logout = auth.routes.find((entry) => entry.path === "/auth/sign-out");
      if (logout === undefined) throw new Error("Strict logout route was not generated.");
      const removed = await logout.onRequest(
        new Request("http://localhost:3000/auth/sign-out", {
          method: "POST",
          headers: { origin: "http://localhost:3000", cookie },
        }),
        new AbortController().signal,
      );
      expect(removed.status).toBe(200);
      expect(liveHost.signal.aborted).toBe(false);
      expect(received?.aborted).toBe(true);
      expect(await logoutRead).toBeUndefined();
      cooperative = false;
      const reissued = await route.onRequest(
        new Request("http://localhost:3000/auth/sign-in/external", {
          method: "POST",
          headers: { origin: "http://localhost:3000" },
        }),
        new AbortController().signal,
      );
      const secondCookie = reissued.headers.get("set-cookie")?.split(";")[0];
      if (secondCookie === undefined) throw new Error("Second native session cookie was absent.");
      reading = new Promise<void>((resolve) => {
        entered = resolve;
      });
      cooperative = true;
      const closingRead = auth.sessions.resolve({ kind: "cookie", value: secondCookie });
      observed = closingRead.catch(() => undefined);
      await reading;
      let drained = false;
      const closing = auth.close().then(() => {
        drained = true;
      });
      expect(drained).toBe(false);
      expect(received?.aborted).toBe(true);
      expect(await closingRead).toBeUndefined();
      await closing;
      expect(drained).toBe(true);
    } finally {
      release();
      releaseCooperative?.();
      await observed;
      await auth.close();
      await store.close();
      await factory.close();
    }
  });
});
