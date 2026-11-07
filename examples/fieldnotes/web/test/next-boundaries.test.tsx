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

import { createServer } from "node:http";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import Page from "../src/app/page";
import { GET as authGet, POST as authPost } from "../src/app/auth/[...path]/route";
import { POST as spinePost } from "../src/app/spine/[...path]/route";

afterEach(() => { vi.unstubAllEnvs(); });

it("renders a public loading page without serializing server identity secrets", () => {
  vi.stubEnv("FIELDNOTES_AUTH_MODE", "google");
  vi.stubEnv("FIELDNOTES_GOOGLE_CLIENT_SECRET", "server-only-secret");
  const html = renderToStaticMarkup(Page());
  expect(html).toContain("Checking your session");
  expect(html).not.toContain("server-only-secret");
  expect(html).not.toContain("Saved places");
});

it("routes only fixed auth and Connect segments through the loopback relay", async () => {
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url ?? "");
    if (request.url?.startsWith("/auth/google/callback")) {
      response.writeHead(303, { location: "https://localhost:3000/auth/complete#grant=one-use" }).end();
    } else response.writeHead(200, { "content-type": "application/connect+proto" }).end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Loopback relay unavailable.");
  vi.stubEnv("FIELDNOTES_UPSTREAM_ORIGIN", `http://127.0.0.1:${String(address.port)}`);
  vi.stubEnv("FIELDNOTES_PUBLIC_ORIGIN", "https://localhost:3000");
  try {
    const session = await authPost(new Request("https://localhost:3000/auth/session", {
      method: "POST", headers: { origin: "https://localhost:3000",
        "content-type": "application/json", "x-fieldnotes-auth": "1" }, body: "{}",
    }), { params: Promise.resolve({ path: ["session"] }) });
    expect(session.status).toBe(200);
    const callback = await authGet(new Request("https://localhost:3000/auth/google/callback?code=one"),
      { params: Promise.resolve({ path: ["google", "callback"] }) });
    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toBe("https://localhost:3000/auth/complete#grant=one-use");
    const connect = await spinePost(new Request(
      "https://localhost:3000/spine/spine.client.SubscriptionService/Activate", {
        method: "POST", headers: { origin: "https://localhost:3000",
          "content-type": "application/connect+proto" }, body: new Uint8Array([0]),
      }), { params: Promise.resolve({ path: ["spine.client.SubscriptionService", "Activate"] }) });
    expect(connect.status).toBe(200);
    expect(await connect.text()).toBe("ok");
    expect(paths).toEqual(["/auth/session", "/auth/google/callback?code=one",
      "/spine.client.SubscriptionService/Activate"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => {
      if (error) reject(error);
      else resolve();
    }));
  }
});
