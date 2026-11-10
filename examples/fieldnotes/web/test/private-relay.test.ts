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
import { afterEach, expect, it } from "vitest";
import { FieldnotesProxy } from "../src/private-relay";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
});

it("passes a Connect stream incrementally and cancels its upstream on reader close", async () => {
  let upstreamClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    upstreamClosed = resolve;
  });
  let received: Record<string, string | string[] | undefined> = {};
  const server = createServer((request, response) => {
    received = request.headers;
    response.setHeader("content-type", "application/connect+proto");
    response.write("first");
    response.on("close", upstreamClosed);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Listener unavailable.");
  const proxy = new FieldnotesProxy({
    FIELDNOTES_UPSTREAM_ORIGIN: `http://127.0.0.1:${String(address.port)}`,
    FIELDNOTES_PUBLIC_ORIGIN: "https://localhost:3000",
  });
  const result = await proxy.forward(
    new Request("https://localhost:3000/spine/spine.client.SubscriptionService/Activate", {
      method: "POST",
      headers: {
        origin: "https://localhost:3000",
        cookie: "session=private",
        "content-type": "application/connect+proto",
        "x-spine-reader-proof": "forged",
      },
      body: new Uint8Array([0]),
    }),
    "spine",
    ["spine.client.SubscriptionService", "Activate"],
  );
  expect(result.status).toBe(200);
  const reader = result.body?.getReader();
  if (reader === undefined) throw new Error("Response stream is missing.");
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toBe("first");
  expect(first.done).toBe(false);
  expect(received.origin).toBe("https://localhost:3000");
  expect(received.cookie).toBe("session=private");
  expect(received["x-spine-reader-proof"]).toBeUndefined();
  await reader.cancel();
  await closed;
});

it("relays an exact callback redirect and distinct cookies without following it", async () => {
  let origin: string | undefined;
  const server = createServer((request, response) => {
    origin = request.headers.origin;
    response.writeHead(303, {
      location: "https://localhost:3000/auth/complete#grant=single-use",
      "set-cookie": ["a=1; Secure", "b=2; Secure"],
    });
    response.end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Listener unavailable.");
  const proxy = new FieldnotesProxy({
    FIELDNOTES_UPSTREAM_ORIGIN: `http://127.0.0.1:${String(address.port)}`,
    FIELDNOTES_PUBLIC_ORIGIN: "https://localhost:3000",
  });
  const result = await proxy.forward(
    new Request("https://localhost:3000/auth/google/callback?state=s&code=c"),
    "auth",
    ["google", "callback"],
  );
  expect(result.status).toBe(303);
  expect(result.headers.get("location")).toBe(
    "https://localhost:3000/auth/complete#grant=single-use",
  );
  expect(result.headers.getSetCookie()).toEqual(["a=1; Secure", "b=2; Secure"]);
  expect(result.headers.get("cache-control")).toBe("no-store");
  expect(origin).toBeUndefined();
});

it("rejects unknown paths and caller-selected upstreams before contacting a host", async () => {
  expect(
    () =>
      new FieldnotesProxy({
        FIELDNOTES_UPSTREAM_ORIGIN: "https://foreign.example",
        FIELDNOTES_PUBLIC_ORIGIN: "https://localhost:3000",
      }),
  ).toThrow();
  const proxy = new FieldnotesProxy({
    FIELDNOTES_UPSTREAM_ORIGIN: "http://127.0.0.1:4242",
    FIELDNOTES_PUBLIC_ORIGIN: "https://localhost:3000",
  });
  expect(
    (await proxy.forward(new Request("https://localhost:3000/auth/other"), "auth", ["other"]))
      .status,
  ).toBe(404);
  expect(
    (
      await proxy.forward(
        new Request("https://localhost:3000/spine/spine.client.QueryService/Execute", {
          method: "POST",
        }),
        "spine",
        ["spine.client.QueryService", "Execute"],
      )
    ).status,
  ).toBe(404);
  const aborted = new AbortController();
  aborted.abort();
  const cancelled = await proxy.forward(
    new Request("https://localhost:3000/auth/session", {
      method: "POST",
      signal: aborted.signal,
    }),
    "auth",
    ["session"],
  );
  expect(cancelled.status).toBe(502);
});

it("admits only canonical methods and paths without forwarding unexpected query data", async () => {
  const proxy = new FieldnotesProxy({
    FIELDNOTES_UPSTREAM_ORIGIN: "http://127.0.0.1:4242",
    FIELDNOTES_PUBLIC_ORIGIN: "https://localhost:3000",
  });
  const refusal = async (url: string, area: "auth" | "spine", path: string[], method = "POST") =>
    (await proxy.forward(new Request(url, { method }), area, path)).status;
  expect(await refusal("https://localhost:3000/auth/session", "auth", [])).toBe(404);
  expect(await refusal("https://localhost:3000/auth/session", "auth", ["..", "session"])).toBe(404);
  expect(await refusal("https://localhost:3000/auth/session", "auth", ["sess%69on"])).toBe(404);
  expect(await refusal("https://localhost:3000/auth/session", "auth", ["session"], "GET")).toBe(
    404,
  );
  expect(
    await refusal("https://localhost:3000/auth/google/callback", "auth", ["google", "callback"]),
  ).toBe(404);
  expect(
    await refusal("https://localhost:3000/auth/session?code=private", "auth", ["session"]),
  ).toBe(400);
  expect(
    await refusal(
      "https://localhost:3000/spine/spine.client.QueryService/Read",
      "spine",
      ["spine.client.QueryService", "Read"],
      "GET",
    ),
  ).toBe(404);
  expect(
    () =>
      new FieldnotesProxy({
        FIELDNOTES_UPSTREAM_ORIGIN: "http://127.0.0.1:4242/hidden",
        FIELDNOTES_PUBLIC_ORIGIN: "http://localhost:3000",
      }),
  ).toThrow();
});

it("refuses callback redirects outside the fixed fragment-only completion page", async () => {
  let destination = "https://evil.example/auth/complete#grant=private";
  const server = createServer((_request, response) => {
    response.writeHead(303, { location: destination, "set-cookie": "session=private; Secure" });
    response.end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Listener unavailable.");
  const proxy = new FieldnotesProxy({
    FIELDNOTES_UPSTREAM_ORIGIN: `http://127.0.0.1:${String(address.port)}`,
    FIELDNOTES_PUBLIC_ORIGIN: "https://localhost:3000",
  });
  for (const unsafe of [
    "https://evil.example/auth/complete#grant=private",
    "https://localhost:3000/other#grant=private",
    "https://localhost:3000/auth/complete?code=private#grant=private",
    "https://localhost:3000/auth/complete#access_token=private",
  ]) {
    destination = unsafe;
    const result = await proxy.forward(
      new Request("https://localhost:3000/auth/google/callback?state=s&code=c"),
      "auth",
      ["google", "callback"],
    );
    expect(result.status).toBe(502);
    expect(result.headers.getSetCookie()).toEqual([]);
    expect(result.headers.get("location")).toBeNull();
  }
});

it("keeps empty private responses unbuffered and refuses a callback without Location", async () => {
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/auth/google/callback")) response.writeHead(303).end();
    else response.writeHead(204, { "x-private-proof": "internal" }).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Listener unavailable.");
  const proxy = new FieldnotesProxy({
    FIELDNOTES_UPSTREAM_ORIGIN: `http://127.0.0.1:${String(address.port)}`,
    FIELDNOTES_PUBLIC_ORIGIN: "https://localhost:3000",
  });
  const empty = await proxy.forward(
    new Request("https://localhost:3000/auth/logout", { method: "POST" }),
    "auth",
    ["logout"],
  );
  expect(empty.status).toBe(204);
  expect(empty.body).toBeNull();
  expect(empty.headers.has("x-private-proof")).toBe(false);
  const missingLocation = await proxy.forward(
    new Request("https://localhost:3000/auth/google/callback"),
    "auth",
    ["google", "callback"],
  );
  expect(missingLocation.status).toBe(502);
  expect(missingLocation.headers.get("location")).toBeNull();
});
