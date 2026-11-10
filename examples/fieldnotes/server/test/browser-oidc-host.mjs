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

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { createOidcProvider } from "@spine-event-engine/auth";
import { ServerTests } from "@spine-event-engine/server/testing";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { fieldnotesProtoModule } from "@spine-event-engine/example-fieldnotes-model";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Pool } from "pg";
import { FieldnotesHost } from "../dist/src/fieldnotes-host.js";

const webOrigin = "https://127.0.0.1:45112";
const issuer = "https://accounts.google.com";
const fixturePort = 45110;
const gatewayPort = 45111;
const keys = await generateKeyPair("RS256");
const jwk = await exportJWK(keys.publicKey);
Object.assign(jwk, { kid: "browser-test", alg: "RS256", use: "sig" });
const authorizations = new Map();
const authenticationMode = process.env.FIELDNOTES_BROWSER_AUTH_MODE === "firebase" ? "firebase" : "google";
let interruptedStreams = 0;

const fixture = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${fixturePort}`);
    if (url.pathname === "/oidc/keys") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (url.pathname === "/test/authorize") {
      const state = url.searchParams.get("state");
      const nonce = url.searchParams.get("nonce");
      const challenge = url.searchParams.get("code_challenge");
      if (!state || !nonce || !challenge) { response.writeHead(400).end(); return; }
      authorizations.set(state, { nonce, challenge });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ callback: `${webOrigin}/auth/google/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(state)}&iss=${encodeURIComponent(issuer)}` }));
      return;
    }
    if (url.pathname === "/test/shutdown" && request.method === "POST") {
      await releaseResources();
      response.writeHead(204).end();
      return;
    }
    if (url.pathname === "/test/cancellation") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ interruptedStreams }));
      return;
    }
    if (url.pathname !== "/oidc/token" || request.method !== "POST") {
      response.writeHead(404).end(); return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    const state = body.get("code") ?? "";
    const pending = authorizations.get(state);
    const verifier = body.get("code_verifier") ?? "";
    const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
    if (!pending || pending.challenge !== challenge ||
        body.get("redirect_uri") !== `${webOrigin}/auth/google/callback` ||
        !request.headers.authorization?.startsWith("Basic ")) {
      response.writeHead(400).end(); return;
    }
    authorizations.delete(state);
    const signed = await new SignJWT({ nonce: pending.nonce })
      .setProtectedHeader({ alg: "RS256", kid: "browser-test", typ: "JWT" })
      .setIssuer(issuer).setAudience("browser-client").setSubject("browser-author")
      .setIssuedAt().setExpirationTime("5m").sign(keys.privateKey);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ id_token: signed }));
  })().catch(() => response.writeHead(500).end());
});
await new Promise((resolve) => fixture.listen(fixturePort, "127.0.0.1", resolve));
const transport = (url, init) => {
  const parsed = new URL(url);
  return fetch(`http://127.0.0.1:${fixturePort}${parsed.pathname}${parsed.search}`, init);
};
const provider = createOidcProvider({
  issuer, authorizationEndpoint: `${issuer}/o/oauth2/v2/auth`,
  tokenEndpoint: `${issuer}/oidc/token`, jwksEndpoint: `${issuer}/oidc/keys`,
  clientId: "browser-client", clientSecret: "browser-secret",
  clientAuthentication: "client_secret_basic", fetch: transport,
});
const databaseUrl = process.env.FIELDNOTES_DATABASE_URL;
const schema = databaseUrl ? `fieldnotes_browser_${randomUUID().replaceAll("-", "")}` : undefined;
const admin = databaseUrl ? new Pool({ connectionString: databaseUrl }) : undefined;
let schemaCreated = false;
let factory;
if (admin && schema && databaseUrl) {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  const stringifiers = new StringifierRegistry();
  stringifiers.setTypeRegistry(TypeRegistry.from(fieldnotesProtoModule));
  factory = await PostgresStorageFactory.newBuilder()
    .setOptions({ url: databaseUrl, schema }).setStringifierRegistry(stringifiers).build();
}
const host = await FieldnotesHost.open({
  postgresUrl: databaseUrl ?? "postgres://localhost/fieldnotes-browser-unused",
  publicOrigin: webOrigin,
  sessionPassword: randomBytes(32).toString("base64url"),
  csrfSecret: randomBytes(32), readerProofSecret: randomBytes(32),
  sessionTtlMilliseconds: 3_600_000, authRouteTimeoutMs: 10_000,
  authRouteMaxBytes: 65_536,
}, {
  storageFactory: factory ?? new InMemoryStorageFactory(), gatewayPort,
  authentication: authenticationMode === "firebase" ?
    { mode: "firebase", projectId: "demo-fieldnotes", recentLoginMilliseconds: 300_000 } :
    { mode: "google", clientId: "browser-client", clientSecret: "browser-secret" },
  ...(authenticationMode === "google" ? { googleProvider: provider } : {}),
});
const relay = createServer((request, response) => {
  const upstream = httpRequest(`${host.gateway.baseUrl}${request.url ?? "/"}`, {
    method: request.method,
    headers: { ...request.headers, host: `127.0.0.1:${gatewayPort}` },
  }, (received) => {
    response.writeHead(received.statusCode ?? 502, received.headers);
    received.pipe(response);
    received.once("close", () => {
      if (!received.complete) interruptedStreams++;
    });
  });
  response.once("close", () => { if (!response.writableFinished) upstream.destroy(); });
  upstream.once("error", () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  request.pipe(upstream);
});
await new Promise((resolve) => relay.listen(45114, "127.0.0.1", resolve));

let releasePromise;

function releaseResources() {
  releasePromise ??= releaseHostResources();
  return releasePromise;
}

async function releaseHostResources() {
  const failures = [];
  let released = true;
  for (const close of [() => {
    relay.closeAllConnections();
    return new Promise((resolve, reject) => relay.close((error) => error ? reject(error) : resolve()));
  }, () => host.close(), () => ServerTests.resetEnvironment()]) {
    try { await close(); } catch (error) { failures.push(error); released = false; }
  }
  if (admin) {
    if (schemaCreated && released && schema) {
      try { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } catch (error) { failures.push(error); }
    }
    try { await admin.end(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, "Fieldnotes browser fixture cleanup failed.");
}
async function shutdown() {
  const failures = [];
  try { await releaseResources(); } catch (error) { failures.push(error); }
  fixture.closeAllConnections();
  try {
    await new Promise((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve()));
  } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, "Fieldnotes browser fixture shutdown failed.");
}
process.once("SIGINT", () => { void shutdown().then(() => process.exit(), () => process.exit(1)); });
process.once("SIGTERM", () => { void shutdown().then(() => process.exit(), () => process.exit(1)); });
