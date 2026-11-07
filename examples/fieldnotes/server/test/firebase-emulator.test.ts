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
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  signOut,
} from "firebase/auth";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { ServerTests } from "@spine-event-engine/server/testing";
import { afterEach, expect, it } from "vitest";
import { FieldnotesHost } from "../src/fieldnotes-host.js";
import type { FieldnotesSettings } from "../src/host-settings.js";

const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const projectId = "demo-fieldnotes";
const origin = "https://localhost:3000";

afterEach(async () => ServerTests.resetEnvironment());

it.skipIf(emulator === undefined)(
  "exchanges an official browser SDK Google emulator token through Admin and the real gateway",
  async () => {
    if (emulator === undefined) throw new Error("Firebase Auth Emulator host is required.");
    const app = initializeApp(
      { apiKey: "demo-fieldnotes-key", authDomain: `${projectId}.firebaseapp.com`, projectId },
      `fieldnotes-emulator-${randomUUID()}`,
    );
    const browserAuth = getAuth(app);
    connectAuthEmulator(browserAuth, `http://${emulator}`, { disableWarnings: true });
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
    let host: FieldnotesHost | undefined;
    try {
      const identity = randomUUID();
      const credential = GoogleAuthProvider.credential(
        JSON.stringify({
          sub: `local-google-${identity}`,
          email: `fieldnotes-${identity}@example.test`,
        }),
      );
      const signedIn = await signInWithCredential(browserAuth, credential);
      const idToken = await signedIn.user.getIdToken();
      host = await FieldnotesHost.open(settings, {
        storageFactory: new InMemoryStorageFactory(),
        authentication: { mode: "firebase", projectId, recentLoginMilliseconds: 300_000 },
      });
      const response = await fetch(`${host.gateway.baseUrl}/auth/firebase/exchange`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-fieldnotes-auth": "1",
        },
        body: JSON.stringify({ idToken }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.getSetCookie()).toHaveLength(2);
    } finally {
      await host?.close();
      await signOut(browserAuth);
      await deleteApp(app);
    }
  },
);
