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
import { FieldnotesBrowserAuth } from "../src/browser-auth";

it("bootstraps a cookie session through the exact JSON and CSRF gates", async () => {
  const requests: Request[] = [];
  const auth = new FieldnotesBrowserAuth(
    async (request) => {
      await Promise.resolve();
      requests.push(request);
      return Response.json({ authenticated: true, mode: "google", principal: { id: "same" } });
    },
    () => "__Host-spine-csrf=signed-token; other=ignored",
    new Map(),
    "https://localhost:3000",
  );
  expect(await auth.session()).toEqual({ id: "same" });
  expect(new URL(requests[0]?.url ?? "").pathname).toBe("/auth/session");
  expect(requests[0]?.method).toBe("POST");
  expect(requests[0]?.headers.get("x-fieldnotes-auth")).toBe("1");
  expect(requests[0]?.headers.get("x-spine-csrf")).toBe("signed-token");
  expect(requests[0]?.headers.get("content-type")).toBe("application/json");
});

it("keeps the Google verifier only through one navigation and exchanges the one-use grant", async () => {
  const retained = new Map<string, string>();
  const requests: Request[] = [];
  const auth = new FieldnotesBrowserAuth(
    async (request) => {
      await Promise.resolve();
      requests.push(request);
      if (request.url.endsWith("/auth/google/start"))
        return Response.json({
          authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=s",
        });
      return Response.json({ authenticated: true, mode: "google" });
    },
    () => "",
    retained,
    "https://localhost:3000",
  );
  expect((await auth.startGoogle()).origin).toBe("https://accounts.google.com");
  expect(retained.size).toBe(1);
  const started = (await requests[0]?.json()) as { codeChallenge: string };
  expect(started.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(await auth.completeGoogle("#grant=one-use")).toBe(true);
  expect(retained.size).toBe(0);
  const exchanged = (await requests[1]?.json()) as { grant: string; codeVerifier: string };
  expect(exchanged.grant).toBe("one-use");
  expect(exchanged.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  expect(await auth.completeGoogle("#grant=one-use")).toBe(false);
  expect(requests).toHaveLength(2);
});

it("drops a failed callback verifier and reports an unsuccessful logout", async () => {
  const retained = new Map([["fieldnotes.google.verifier", "stale-verifier"]]);
  const auth = new FieldnotesBrowserAuth(
    () => Promise.resolve(new Response(null, { status: 503 })),
    () => "__Host-spine-csrf=signed-token",
    retained,
    "https://localhost:3000",
  );
  expect(await auth.completeGoogle("#result=failed")).toBe(false);
  expect(retained.size).toBe(0);
  expect(await auth.logout()).toBe(false);
});

it("drops a pending Google verifier on browser cancellation", () => {
  const retained = new Map([[FieldnotesBrowserAuth.verifierKey, "pending-secret"]]);
  const auth = new FieldnotesBrowserAuth(
    () => Promise.resolve(new Response()),
    () => "",
    retained,
    "https://localhost:3000",
  );
  auth.clearPendingGoogle();
  expect(retained.size).toBe(0);
});

it("rejects invalid Google destinations and clears every pending PKCE verifier", async () => {
  const responses = [
    Response.json({ authorizationUrl: "http://accounts.google.com/o/oauth2/v2/auth" }),
    Response.json({ authorizationUrl: "https://attacker.example/oauth" }),
    Response.json({ wrongField: "https://accounts.google.com" }),
    new Response(null, { status: 503 }),
  ];
  for (const response of responses) {
    const retained = new Map<string, string>();
    const fetcher = vi.fn(() => Promise.resolve(response));
    const auth = new FieldnotesBrowserAuth(fetcher, () => "", retained, "https://localhost:3000");
    await expect(auth.startGoogle()).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(retained.size).toBe(0);
  }
});

it("never exchanges duplicate, extra or missing callback grants", async () => {
  for (const fragment of ["#grant=first&grant=second", "#grant=first&extra=one", "#grant="]) {
    const retained = new Map([[FieldnotesBrowserAuth.verifierKey, "pending-verifier"]]);
    const fetcher = vi.fn(() => Promise.resolve(new Response()));
    const auth = new FieldnotesBrowserAuth(fetcher, () => "", retained, "https://localhost:3000");
    await expect(auth.completeGoogle(fragment)).resolves.toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(retained.size).toBe(0);
  }
  const fetcher = vi.fn(() => Promise.resolve(new Response()));
  const auth = new FieldnotesBrowserAuth(fetcher, () => "", new Map(), "https://localhost:3000");
  await expect(auth.completeGoogle("#grant=stolen")).resolves.toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects malformed app-session identity and exchanges Firebase only through the app route", async () => {
  const requests: Request[] = [];
  const auth = new FieldnotesBrowserAuth(
    (request) => {
      requests.push(request);
      return Promise.resolve(
        request.url.endsWith("/auth/session")
          ? Response.json({ principal: { id: "" } })
          : new Response(null, { status: 200 }),
      );
    },
    () => "__Host-spine-csrf=one; __Host-spine-csrf=two",
    new Map(),
    "https://localhost:3000",
  );
  await expect(auth.session()).rejects.toThrow("Session response is invalid.");
  await expect(auth.exchangeFirebase("provider-id-token")).resolves.toBe(true);
  expect(new URL(requests[1]?.url ?? "").pathname).toBe("/auth/firebase/exchange");
  expect(requests[1]?.headers.has("x-spine-csrf")).toBe(false);
});
