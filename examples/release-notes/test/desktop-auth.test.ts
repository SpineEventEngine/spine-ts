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

import { expect, test } from "vitest";

import { DesktopAuth } from "../src/trusted/desktop-auth.js";

test("browser sign-in sends no credential or authorization URL to renderer status", async () => {
  const session = {
    begin: (redirectUri: string) =>
      Promise.resolve({
        redirectUri,
        authorizationUrl: `https://auth.openai.com/secret-hint?redirect_uri=${encodeURIComponent(redirectUri)}`,
        state: "state",
        nonce: "nonce",
        verifier: "verifier",
      }),
    complete: () =>
      Promise.resolve({ clientId: "issued-client", subject: "subject-1", planEnabled: true }),
    models: () => Promise.resolve([{ slug: "account-model", displayName: "Account Model" }]),
    signOut: () => Promise.resolve(true),
  };
  const store = {
    pendingClientIds: () => Promise.resolve([]),
    registrations: () =>
      Promise.resolve([
        {
          clientId: "issued-client",
          subject: "subject-1",
          issuer: "https://auth.openai.com",
          scopes: ["chatgpt.tokens.use.direct"],
          accessToken: "access-secret",
          refreshToken: "refresh-secret",
          idToken: "id-secret",
        },
      ]),
  };
  const auth = new DesktopAuth(session, store, async (url) => {
    expect(url).toContain("auth.openai.com");
    const callbackUri = new URL(url).searchParams.get("redirect_uri");
    expect(callbackUri).toBeTruthy();
    await fetch(`${String(callbackUri)}?state=state&code=code&client_id=issued-client`);
  });
  expect(await auth.signIn()).toMatchObject({
    selectedClientId: "issued-client",
    planEnabled: true,
  });
  const visible = JSON.stringify(await auth.status());
  expect(visible).toContain("issued-client");
  expect(visible).not.toContain("access-secret");
  expect(visible).not.toContain("refresh-secret");
  expect(visible).not.toContain("id-secret");
  expect(visible).not.toContain("secret-hint");
  expect(await auth.models("issued-client")).toEqual([
    { slug: "account-model", displayName: "Account Model" },
  ]);
  expect(await auth.signOut("issued-client")).toMatchObject({
    revocationConfirmed: true,
    status: { planEnabled: false },
  });
  await expect(auth.models("issued-client")).rejects.toThrow();
  await auth.close();
});

test("closing the app cancels an outstanding browser callback", async () => {
  const session = {
    begin: (redirectUri: string) =>
      Promise.resolve({
        redirectUri,
        authorizationUrl: "https://auth.openai.com/authorize",
        state: "state",
        nonce: "nonce",
        verifier: "verifier",
      }),
    complete: () =>
      Promise.resolve({ clientId: "issued-client", subject: "subject-1", planEnabled: true }),
    models: () => Promise.resolve([]),
    signOut: () => Promise.resolve(true),
  };
  const auth = new DesktopAuth(
    session,
    { registrations: () => Promise.resolve([]), pendingClientIds: () => Promise.resolve([]) },
    () => Promise.resolve(),
  );
  const awaiting = auth.signIn();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await auth.close();
  await expect(awaiting).rejects.toThrow();
});

test("a second sign-in is rejected while the first callback listener is opening", async () => {
  let releaseOpen:
    | ((listener: { redirectUri: string; wait(): Promise<URL>; close(): Promise<void> }) => void)
    | undefined;
  const opening = new Promise<{
    redirectUri: string;
    wait(): Promise<URL>;
    close(): Promise<void>;
  }>((resolve) => {
    releaseOpen = resolve;
  });
  let browserOpens = 0;
  const auth = new DesktopAuth(
    {
      begin: () =>
        Promise.resolve({
          authorizationUrl: "https://auth.openai.com/authorize",
          redirectUri: "http://127.0.0.1/auth/callback",
          state: "state",
          nonce: "nonce",
          verifier: "verifier",
        }),
      complete: () =>
        Promise.resolve({ clientId: "issued-client", subject: "subject-1", planEnabled: true }),
      models: () => Promise.resolve([]),
      signOut: () => Promise.resolve(true),
    },
    { registrations: () => Promise.resolve([]), pendingClientIds: () => Promise.resolve([]) },
    () => {
      browserOpens += 1;
      return Promise.resolve();
    },
    () => opening,
  );
  const first = auth.signIn();
  await expect(auth.signIn()).rejects.toThrow("unavailable");
  const closing = auth.close();
  releaseOpen?.({
    redirectUri: "http://127.0.0.1/auth/callback",
    wait: () => new Promise(() => undefined),
    close: () => Promise.resolve(),
  });
  await closing;
  await expect(first).rejects.toThrow("canceled");
  expect(browserOpens).toBe(0);
});

test("failed first grant exposes only its issued client for controlled retry", async () => {
  const auth = new DesktopAuth(
    {
      begin: () => Promise.reject(new Error("unused")),
      complete: () => Promise.reject(new Error("unused")),
      models: () => Promise.resolve([]),
      signOut: () => Promise.resolve(true),
    },
    {
      registrations: () => Promise.resolve([]),
      pendingClientIds: () => Promise.resolve(["issued-client"]),
    },
    () => Promise.resolve(),
  );
  expect(await auth.status()).toEqual({
    accounts: [],
    planEnabled: false,
    pendingClientIds: ["issued-client"],
  });
});

test("closing during code exchange passes an invalidation guard into grant persistence", async () => {
  let releaseGrant: (() => void) | undefined;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    releaseGrant = resolve;
  });
  let checkedGuard = false;
  const auth = new DesktopAuth(
    {
      begin: (redirectUri) =>
        Promise.resolve({
          authorizationUrl: "https://auth.openai.com/authorize",
          redirectUri,
          state: "state",
          nonce: "nonce",
          verifier: "verifier",
        }),
      complete: async (_pending, _callback, isCurrent) => {
        markStarted?.();
        if (typeof isCurrent !== "function") throw new Error("Missing cancellation guard.");
        await barrier;
        checkedGuard = true;
        if (!isCurrent()) throw new Error("Authorization attempt was canceled.");
        return { clientId: "issued-client", subject: "subject-1", planEnabled: true };
      },
      models: () => Promise.resolve([]),
      signOut: () => Promise.resolve(true),
    },
    { registrations: () => Promise.resolve([]), pendingClientIds: () => Promise.resolve([]) },
    () => Promise.resolve(),
    () =>
      Promise.resolve({
        redirectUri: "http://127.0.0.1/auth/callback",
        wait: () =>
          Promise.resolve(new URL("http://127.0.0.1/auth/callback?state=state&code=code")),
        close: () => Promise.resolve(),
      }),
  );
  const completing = auth.signIn();
  await started;
  await auth.close();
  releaseGrant?.();
  await expect(completing).rejects.toThrow("canceled");
  expect(checkedGuard).toBe(true);
});

test("closing while authorization begins never opens the browser or selects a late account", async () => {
  let releaseBegin: (() => void) | undefined;
  let markBegin: (() => void) | undefined;
  const began = new Promise<void>((resolve) => {
    markBegin = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    releaseBegin = resolve;
  });
  let opened = 0;
  const auth = new DesktopAuth(
    {
      begin: async (redirectUri) => {
        markBegin?.();
        await barrier;
        return {
          authorizationUrl: "https://auth.openai.com/authorize",
          redirectUri,
          state: "state",
          nonce: "nonce",
          verifier: "verifier",
        };
      },
      complete: () => Promise.reject(new Error("unexpected exchange")),
      models: () => Promise.resolve([]),
      signOut: () => Promise.resolve(true),
    },
    { registrations: () => Promise.resolve([]), pendingClientIds: () => Promise.resolve([]) },
    () => {
      opened += 1;
      return Promise.resolve();
    },
    () =>
      Promise.resolve({
        redirectUri: "http://127.0.0.1/auth/callback",
        wait: () => Promise.reject(new Error("unexpected callback")),
        close: () => Promise.resolve(),
      }),
  );
  const signingIn = auth.signIn();
  await began;
  await auth.close();
  releaseBegin?.();
  await expect(signingIn).rejects.toThrow("canceled");
  expect(opened).toBe(0);
  expect(await auth.status()).toMatchObject({ planEnabled: false });
});

test("unknown account actions leave the selected registration and subject label intact", async () => {
  let signOutCalls = 0;
  const auth = new DesktopAuth(
    {
      begin: () => Promise.reject(new Error("unused")),
      complete: () => Promise.reject(new Error("unused")),
      models: () => Promise.resolve([]),
      signOut: () => {
        signOutCalls += 1;
        return Promise.resolve(true);
      },
    },
    {
      registrations: () =>
        Promise.resolve([
          {
            clientId: "client-a",
            subject: "subject-a",
            issuer: "https://auth.openai.com",
            scopes: ["chatgpt.tokens.use.direct"],
            accessToken: "secret",
          },
        ]),
      pendingClientIds: () => Promise.resolve([]),
    },
    () => Promise.resolve(),
  );
  expect(await auth.selectAccount("client-a")).toMatchObject({ selectedClientId: "client-a" });
  await expect(auth.selectAccount("client-b")).rejects.toThrow();
  await expect(auth.signOut("client-b")).rejects.toThrow();
  expect(signOutCalls).toBe(0);
  expect(await auth.status()).toMatchObject({
    selectedClientId: "client-a",
    planEnabled: true,
    accounts: [expect.objectContaining({ clientId: "client-a", subject: "subject-a" })],
  });
  await auth.close();
});

test("a completed code exchange arriving after close never selects its account", async () => {
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let releaseGrant: (() => void) | undefined;
  const pendingGrant = new Promise<void>((resolve) => {
    releaseGrant = resolve;
  });
  const auth = new DesktopAuth(
    {
      begin: (redirectUri) =>
        Promise.resolve({
          authorizationUrl: "https://auth.openai.com/authorize",
          redirectUri,
          state: "state",
          nonce: "nonce",
          verifier: "verifier",
        }),
      complete: async () => {
        markStarted?.();
        await pendingGrant;
        return { clientId: "issued-client", subject: "subject", planEnabled: true };
      },
      models: () => Promise.resolve([]),
      signOut: () => Promise.resolve(true),
    },
    { registrations: () => Promise.resolve([]), pendingClientIds: () => Promise.resolve([]) },
    () => Promise.resolve(),
    () =>
      Promise.resolve({
        redirectUri: "http://127.0.0.1/auth/callback",
        wait: () =>
          Promise.resolve(new URL("http://127.0.0.1/auth/callback?state=state&code=code")),
        close: () => Promise.resolve(),
      }),
  );
  const signingIn = auth.signIn();
  await started;
  await auth.close();
  releaseGrant?.();
  await expect(signingIn).rejects.toThrow("canceled");
  expect(await auth.status()).toMatchObject({ planEnabled: false });
});
