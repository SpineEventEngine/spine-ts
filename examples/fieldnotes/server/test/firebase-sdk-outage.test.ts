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

import { randomBytes, randomUUID } from "node:crypto";
import { Agent } from "node:https";
import { deleteApp, initializeApp, type Credential } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { Time } from "@spine-event-engine/core";
import { ServerTests } from "@spine-event-engine/server/testing";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { generateKeyPair, SignJWT } from "jose";
import { afterEach, expect, it, vi } from "vitest";
import { FieldnotesHost } from "../src/fieldnotes-host.js";
import type { FieldnotesSettings } from "../src/host-settings.js";

const projectId = "demo-fieldnotes";
const origin = "https://localhost:3000";

afterEach(async () => ServerTests.resetEnvironment());

it("returns 503 when official Admin cannot fetch signing certificates", async () => {
  const priorEmulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  Reflect.deleteProperty(process.env, "FIREBASE_AUTH_EMULATOR_HOST");
  const hosts: string[] = [];
  const agent = new Agent({
    lookup: (hostname, _options, onLookup) => {
      hosts.push(hostname);
      onLookup(Object.assign(new Error("local lookup failed"), { code: "ENOTFOUND" }), "", 4);
    },
  });
  const getAccessToken = vi.fn(() => Promise.reject(new Error("credential must not be read")));
  const credential: Credential = { getAccessToken };
  const app = initializeApp({ projectId, credential, httpAgent: agent }, `outage-${randomUUID()}`);
  let host: FieldnotesHost | undefined;
  try {
    const auth = getAuth(app);
    const verify = vi.spyOn(auth, "verifyIdToken");
    const now = Math.floor(Time.currentTimeMillis() / 1_000);
    const { privateKey } = await generateKeyPair("RS256");
    const token = await new SignJWT({
      auth_time: now,
      firebase: { sign_in_provider: "google.com" },
    })
      .setProtectedHeader({ alg: "RS256", kid: "local-test-key" })
      .setIssuer(`https://securetoken.google.com/${projectId}`)
      .setAudience(projectId)
      .setSubject("local-user")
      .setIssuedAt(now)
      .setExpirationTime(now + 3_600)
      .sign(privateKey);
    const settings: FieldnotesSettings = {
      postgresUrl: "postgres://localhost/fieldnotes",
      publicOrigin: origin,
      sessionPassword: randomBytes(32).toString("base64url"),
      csrfSecret: randomBytes(32),
      readerProofSecret: randomBytes(32),
      sessionTtlMilliseconds: 3_600_000,
      authRouteTimeoutMs: 10_000,
      authRouteMaxBytes: 65_536,
    };
    host = await FieldnotesHost.open(settings, {
      storageFactory: new InMemoryStorageFactory(),
      authentication: { mode: "firebase", projectId, recentLoginMilliseconds: 300_000 },
      firebaseVerifier: auth,
    });
    const issue = vi.spyOn(host.sessions, "issue");
    const base = host.gateway.baseUrl;
    const post = (idToken: string) =>
      fetch(`${base}/auth/firebase/exchange`, {
        method: "POST",
        headers: { origin, "content-type": "application/json", "x-fieldnotes-auth": "1" },
        body: JSON.stringify({ idToken }),
      });
    const unavailable = await post(token);
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toBe("no-store");
    expect(unavailable.headers.getSetCookie()).toHaveLength(0);
    expect(hosts).toContain("www.googleapis.com");
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(verify).toHaveBeenCalledExactlyOnceWith(token, true);
    await expect(verify.mock.results[0]?.value).rejects.toMatchObject({
      code: "auth/argument-error",
    });
    const malformed = await post("malformed");
    expect(malformed.status).toBe(503);
    expect(malformed.headers.getSetCookie()).toHaveLength(0);
    expect(issue).not.toHaveBeenCalled();
  } finally {
    try {
      await host?.close();
    } finally {
      await deleteApp(app);
      agent.destroy();
      if (priorEmulator === undefined)
        Reflect.deleteProperty(process.env, "FIREBASE_AUTH_EMULATOR_HOST");
      else process.env.FIREBASE_AUTH_EMULATOR_HOST = priorEmulator;
    }
  }
});
