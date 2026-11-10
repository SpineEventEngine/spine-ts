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

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { connect } from "node:http2";
import { createServer } from "node:http";
import { connect as connectTcp, createServer as createTcpServer } from "node:net";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const caddyfile = fileURLToPath(new URL("../Caddyfile", import.meta.url));
const cert = process.env.FIELDNOTES_TEST_TLS_CERT;
const key = process.env.FIELDNOTES_TEST_TLS_KEY;
if (!cert || !key) throw new Error("Fieldnotes ingress test TLS fixture paths are required.");

async function freePort() {
  const server = createTcpServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForIngress(port, child) {
  while (child.exitCode === null) {
    const ready = await new Promise((resolve) => {
      const socket = connectTcp(port, "127.0.0.1");
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Caddy exited before its local ingress opened.");
}

test("Caddy redacts callback secrets and propagates HTTP/2 stream cancellation", { timeout: 15_000 }, async (t) => {
  const [publicPort, upstreamPort] = await Promise.all([freePort(), freePort()]);
  const origin = `https://127.0.0.1:${publicPort}`;
  let logs = "";
  const caddy = spawn("caddy", ["run", "--config", caddyfile], {
    env: {
      ...process.env,
      FIELDNOTES_PUBLIC_ORIGIN: origin,
      FIELDNOTES_BIND_ADDRESS: "127.0.0.1",
      FIELDNOTES_NEXT_ADDRESS: `127.0.0.1:${upstreamPort}`,
      FIELDNOTES_TLS_CERT: cert,
      FIELDNOTES_TLS_KEY: key,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  caddy.stderr.on("data", (chunk) => { logs += chunk.toString(); });
  t.after(async () => {
    if (caddy.exitCode !== null) return;
    caddy.kill("SIGTERM");
    await once(caddy, "exit");
  });
  await waitForIngress(publicPort, caddy);
  const client = connect(origin, { rejectUnauthorized: false });
  t.after(() => client.close());
  const callback = client.request({
    ":path": "/auth/google/callback?code=SECRET_CODE&state=SECRET_STATE",
    cookie: "session=SECRET_COOKIE",
  });
  const callbackStatus = new Promise((resolve) => callback.on("response", (headers) => resolve(headers[":status"])));
  callback.end();
  for await (const chunk of callback) { void chunk; }
  assert.equal(await callbackStatus, 502);
  assert.match(logs, /error|status/i);
  for (const secret of ["SECRET_CODE", "SECRET_STATE", "SECRET_COOKIE", "/auth/google/callback"])
    assert.equal(logs.includes(secret), false, `Caddy log exposed ${secret}.`);

  let upstreamClosed;
  const closed = new Promise((resolve) => { upstreamClosed = resolve; });
  const upstream = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write("data: open\n\n");
    response.on("close", () => upstreamClosed(!response.writableFinished));
  });
  upstream.listen(upstreamPort, "127.0.0.1");
  await once(upstream, "listening");
  t.after(async () => {
    upstream.closeAllConnections();
    await new Promise((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
  });
  const stream = client.request({ ":path": "/spine/stream" });
  stream.end();
  await once(stream, "data");
  stream.close();
  assert.equal(await closed, true, "Caddy kept the upstream stream after HTTP/2 cancellation.");
});
