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

// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://localhost:3000/"}

import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { FieldnotesBrowserAuth } from "../src/browser-auth";
import { FieldnotesBrowserLifecycle, type IdentityView } from "../src/browser-lifecycle";

afterEach(() => { vi.unstubAllGlobals(); window.sessionStorage.clear(); });

it("uses same-origin browser capabilities for bootstrap and clears a failed Google verifier", async () => {
  const requests: Request[] = [];
  const fetcher = vi.fn((request: Request) => {
    requests.push(request);
    const path = new URL(request.url).pathname;
    if (path === "/auth/session") return Promise.resolve(new Response(null, { status: 401 }));
    if (path === "/auth/google/start") return Promise.resolve(new Response(null, { status: 503 }));
    return Promise.resolve(new Response(null, { status: 200 }));
  });
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("ArrayBuffer", Buffer.alloc(0).buffer.constructor);
  expect(window.location.origin).toBe("https://localhost:3000");
  expect(globalThis.crypto.subtle).toBeDefined();
  window.sessionStorage.setItem(FieldnotesBrowserAuth.verifierKey, "old-verifier");
  const views: IdentityView[] = [];
  const lifecycle = new FieldnotesBrowserLifecycle({ mode: "google" }, (view) => views.push(view));
  await lifecycle.start();
  expect(views.at(-1)).toEqual({ phase: "signed-out", principal: null, error: null });
  await lifecycle.signIn();
  expect(views.at(-1)?.error).toMatch(/Sign-in failed/);
  expect(window.sessionStorage.getItem(FieldnotesBrowserAuth.verifierKey)).toBeNull();
  expect(requests.map((request) => new URL(request.url).pathname))
    .toEqual(["/auth/session", "/auth/google/start"]);
  expect(requests.every((request) => request.credentials === "same-origin")).toBe(true);
  await lifecycle.close();
});
