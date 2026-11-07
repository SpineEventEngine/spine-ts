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

import { expect, it, vi } from "vitest";
import { FieldnotesBrowserLifecycle, type IdentityView } from "../src/browser-lifecycle";

it("does not exchange a Firebase popup token that arrives after logout", async () => {
  let resolveToken!: (value: string) => void;
  const token = new Promise<string>((resolve) => { resolveToken = resolve; });
  const exchange = vi.fn(() => Promise.resolve(true));
  const views: IdentityView[] = [];
  const lifecycle = new FieldnotesBrowserLifecycle(
    { mode: "firebase", firebase: { apiKey: "public", authDomain: "local", projectId: "local" } },
    (view) => views.push(view),
    {
      auth: { session: () => Promise.resolve(null), startGoogle: () => Promise.resolve(new URL("https://accounts.google.com")), clearPendingGoogle: vi.fn(),
        exchangeFirebase: exchange, logout: () => Promise.resolve(true) },
      firebase: () => ({ googleToken: () => token, clear: () => Promise.resolve(undefined), close: () => Promise.resolve(undefined) }),
    },
  );
  const signingIn = lifecycle.signIn();
  await lifecycle.logout();
  resolveToken("late-token");
  await signingIn;
  expect(exchange).not.toHaveBeenCalled();
  expect(views.at(-1)?.phase).toBe("signed-out");
});

it("cancels pending Google navigation and does not start a duplicate flow", async () => {
  let resolveStart!: (value: URL) => void;
  const pending = new Promise<URL>((resolve) => { resolveStart = resolve; });
  const start = vi.fn(() => pending);
  const clearPendingGoogle = vi.fn();
  const navigate = vi.fn();
  const lifecycle = new FieldnotesBrowserLifecycle({ mode: "google" }, () => undefined, {
    auth: { session: () => Promise.resolve(null), startGoogle: start, clearPendingGoogle,
      exchangeFirebase: () => Promise.resolve(false), logout: () => Promise.resolve(true) },
    navigate,
  });
  const first = lifecycle.signIn();
  const second = lifecycle.signIn();
  expect(start).toHaveBeenCalledTimes(1);
  await lifecycle.logout();
  resolveStart(new URL("https://accounts.google.com/o/oauth2/v2/auth"));
  await Promise.all([first, second]);
  expect(navigate).not.toHaveBeenCalled();
  expect(clearPendingGoogle).toHaveBeenCalledOnce();
});

it("reports failed revocation and permits an explicit retry", async () => {
  const views: IdentityView[] = [];
  const logout = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const lifecycle = new FieldnotesBrowserLifecycle({ mode: "google" }, (view) => views.push(view), {
    auth: { session: () => Promise.resolve({ id: "same" }), startGoogle: () => Promise.resolve(new URL("https://accounts.google.com")), clearPendingGoogle: vi.fn(),
      exchangeFirebase: () => Promise.resolve(false), logout },
  });
  await lifecycle.start();
  await lifecycle.logout();
  expect(views.at(-1)?.error).toMatch(/could not be confirmed/);
  await lifecycle.logout();
  expect(views.at(-1)?.error).toBeNull();
  expect(logout).toHaveBeenCalledTimes(2);
});

it("mounts only a verified app session and reports an unavailable bootstrap", async () => {
  const views: IdentityView[] = [];
  const auth = {
    session: vi.fn().mockRejectedValueOnce(new Error("private failure")).mockResolvedValueOnce({ id: "author" }),
    startGoogle: () => Promise.resolve(new URL("https://accounts.google.com")),
    exchangeFirebase: () => Promise.resolve(false), logout: () => Promise.resolve(true),
    clearPendingGoogle: vi.fn(),
  };
  const lifecycle = new FieldnotesBrowserLifecycle({ mode: "google" }, (view) => views.push(view), { auth });
  await lifecycle.start();
  expect(views.at(-1)).toEqual({ phase: "signed-out", principal: null,
    error: "Session check failed. Please retry." });
  await lifecycle.start();
  expect(views.at(-1)).toEqual({ phase: "ready", principal: { id: "author" }, error: null });
  await lifecycle.close();
  expect(auth.clearPendingGoogle).toHaveBeenCalledOnce();
});

it("requires a host app session after Firebase popup exchange and tolerates SDK cleanup failure", async () => {
  const views: IdentityView[] = [];
  const clear = vi.fn().mockRejectedValue(new Error("SDK cleanup failed"));
  const auth = {
    session: () => Promise.resolve(null), startGoogle: () => Promise.resolve(new URL("https://accounts.google.com")),
    exchangeFirebase: () => Promise.resolve(true), logout: () => Promise.resolve(true),
    clearPendingGoogle: vi.fn(),
  };
  const lifecycle = new FieldnotesBrowserLifecycle(
    { mode: "firebase", firebase: { apiKey: "public", authDomain: "local", projectId: "local" } },
    (view) => views.push(view),
    { auth, firebase: () => ({ googleToken: () => Promise.resolve("firebase-token"), clear,
      close: () => Promise.resolve() }) },
  );
  await lifecycle.signIn();
  expect(clear).toHaveBeenCalledOnce();
  expect(views.at(-1)).toEqual({ phase: "signed-out", principal: null,
    error: "Sign-in failed. Please try again." });
  await lifecycle.logout();
  expect(views.at(-1)?.phase).toBe("signed-out");
});

it("holds a new sign-in until durable logout settles, then allows retry", async () => {
  let finishLogout!: (value: boolean) => void;
  const pending = new Promise<boolean>((resolve) => { finishLogout = resolve; });
  const startGoogle = vi.fn(() => Promise.resolve(new URL("https://accounts.google.com")));
  const session = vi.fn(() => Promise.resolve({ id: "author" }));
  const views: IdentityView[] = [];
  const lifecycle = new FieldnotesBrowserLifecycle({ mode: "google" }, (view) => views.push(view), {
    auth: { session, startGoogle,
      exchangeFirebase: () => Promise.resolve(false), logout: () => pending,
      clearPendingGoogle: vi.fn() },
    navigate: vi.fn(),
  });
  await lifecycle.start();
  const revoking = lifecycle.logout();
  await lifecycle.start();
  await lifecycle.signIn();
  expect(session).toHaveBeenCalledOnce();
  expect(startGoogle).not.toHaveBeenCalled();
  finishLogout(false);
  await revoking;
  expect(views.at(-1)?.error).toMatch(/could not be confirmed/);
  await lifecycle.signIn();
  expect(startGoogle).toHaveBeenCalledOnce();
});

it("reports a rejected revocation without restoring the private identity", async () => {
  const views: IdentityView[] = [];
  const lifecycle = new FieldnotesBrowserLifecycle({ mode: "google" }, (view) => views.push(view), {
    auth: { session: () => Promise.resolve({ id: "author" }),
      startGoogle: () => Promise.resolve(new URL("https://accounts.google.com")),
      exchangeFirebase: () => Promise.resolve(false),
      logout: () => Promise.reject(new Error("private revocation failed")),
      clearPendingGoogle: vi.fn() },
  });
  await lifecycle.start();
  await lifecycle.logout();
  expect(views.at(-1)?.principal).toBeNull();
  expect(views.at(-1)?.error).toMatch(/could not be confirmed/);
});

it("does not publish stale Firebase failure after logout overtakes SDK cleanup", async () => {
  let finishClear!: () => void;
  const clearPending = new Promise<void>((resolve) => { finishClear = resolve; });
  let clearStarted!: () => void;
  const enteredClear = new Promise<void>((resolve) => { clearStarted = resolve; });
  const views: IdentityView[] = [];
  const lifecycle = new FieldnotesBrowserLifecycle(
    { mode: "firebase", firebase: { apiKey: "public", authDomain: "local", projectId: "local" } },
    (view) => views.push(view),
    { auth: { session: () => Promise.resolve(null), startGoogle: () => Promise.resolve(new URL("https://accounts.google.com")),
      exchangeFirebase: () => Promise.resolve(false), logout: () => Promise.resolve(true),
      clearPendingGoogle: vi.fn() },
    firebase: () => ({ googleToken: () => Promise.resolve("token"), clear: () => { clearStarted(); return clearPending; },
      close: () => Promise.resolve() }) },
  );
  const signingIn = lifecycle.signIn();
  await enteredClear;
  const revoking = lifecycle.logout();
  finishClear();
  await Promise.all([signingIn, revoking]);
  expect(views.at(-1)).toEqual({ phase: "signed-out", principal: null, error: null });
});

it("publishes a verified Firebase app session and hides it before revocation completes", async () => {
  let finishLogout!: (value: boolean) => void;
  const revocation = new Promise<boolean>((resolve) => { finishLogout = resolve; });
  const views: IdentityView[] = [];
  const clear = vi.fn(() => Promise.resolve());
  const lifecycle = new FieldnotesBrowserLifecycle(
    { mode: "firebase", firebase: { apiKey: "public", authDomain: "local", projectId: "local" } },
    (view) => views.push(view),
    { auth: { session: () => Promise.resolve({ id: "verified-author" }),
      startGoogle: () => Promise.resolve(new URL("https://accounts.google.com")),
      exchangeFirebase: () => Promise.resolve(true), logout: () => revocation,
      clearPendingGoogle: vi.fn() },
    firebase: () => ({ googleToken: () => Promise.resolve("verified-token"), clear,
      close: () => Promise.resolve() }) },
  );
  await lifecycle.signIn();
  expect(views.at(-1)).toEqual({ phase: "ready", principal: { id: "verified-author" }, error: null });
  const loggingOut = lifecycle.logout();
  expect(views.at(-1)?.phase).toBe("signed-out");
  finishLogout(true);
  await loggingOut;
  expect(clear).toHaveBeenCalledOnce();
  expect(views.at(-1)?.principal).toBeNull();
});

it("does not restore a late bootstrap session after logout", async () => {
  let finishSession!: (value: { id: string }) => void;
  const pending = new Promise<{ id: string }>((resolve) => { finishSession = resolve; });
  const views: IdentityView[] = [];
  const lifecycle = new FieldnotesBrowserLifecycle({ mode: "google" }, (view) => views.push(view), {
    auth: { session: () => pending, startGoogle: () => Promise.resolve(new URL("https://accounts.google.com")),
      exchangeFirebase: () => Promise.resolve(false), logout: () => Promise.resolve(true),
      clearPendingGoogle: vi.fn() },
  });
  const starting = lifecycle.start();
  await lifecycle.logout();
  finishSession({ id: "stale-author" });
  await starting;
  expect(views.at(-1)).toEqual({ phase: "signed-out", principal: null, error: null });
});

it("starts no provider, session or revocation work after browser shell disposal", async () => {
  const session = vi.fn(() => Promise.resolve(null));
  const startGoogle = vi.fn(() => Promise.resolve(new URL("https://accounts.google.com")));
  const logout = vi.fn(() => Promise.resolve(true));
  const clearPendingGoogle = vi.fn();
  const lifecycle = new FieldnotesBrowserLifecycle({ mode: "google" }, () => undefined, {
    auth: { session, startGoogle, logout, clearPendingGoogle,
      exchangeFirebase: () => Promise.resolve(false) }, navigate: vi.fn(),
  });
  await lifecycle.close();
  await lifecycle.start();
  await lifecycle.signIn();
  await lifecycle.logout();
  expect(session).not.toHaveBeenCalled();
  expect(startGoogle).not.toHaveBeenCalled();
  expect(logout).not.toHaveBeenCalled();
  expect(clearPendingGoogle).toHaveBeenCalledOnce();
});
