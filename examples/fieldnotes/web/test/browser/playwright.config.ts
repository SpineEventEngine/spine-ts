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

import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const hostFixture = fileURLToPath(
  new URL("../../../server/test/browser-oidc-host.mjs", import.meta.url),
);
const caddyfile = fileURLToPath(new URL("../../../deploy/Caddyfile", import.meta.url));
const publicOrigin = "https://127.0.0.1:45112";
const tlsKey = process.env.FIELDNOTES_TEST_TLS_KEY;
const tlsCert = process.env.FIELDNOTES_TEST_TLS_CERT;
const nextCommand = process.env.FIELDNOTES_BROWSER_NEXT_MODE === "production" ? "start" : "dev";
const authMode = process.env.FIELDNOTES_BROWSER_AUTH_MODE === "firebase" ? "firebase" : "google";
if (!tlsKey || !tlsCert) throw new Error("Fieldnotes browser test TLS paths are required.");

export default defineConfig({
  testDir: ".",
  testMatch: authMode === "firebase" ? "firebase-popup.spec.ts" : "oidc-workspace.spec.ts",
  use: {
    baseURL: publicOrigin,
    ignoreHTTPSErrors: true,
    launchOptions:
      process.env.FIELDNOTES_CHROMIUM_EXECUTABLE === undefined
        ? {}
        : { executablePath: process.env.FIELDNOTES_CHROMIUM_EXECUTABLE },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: `node ${hostFixture}`,
      cwd: webRoot,
      port: 45111,
      reuseExistingServer: process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "true",
      env: {
        FIELDNOTES_BROWSER_AUTH_MODE: authMode,
        ...(authMode === "firebase" ? { FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" } : {}),
      },
    },
    {
      command: `pnpm ${nextCommand} --port 45113`,
      cwd: webRoot,
      port: 45113,
      reuseExistingServer: process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "true",
      env: {
        FIELDNOTES_AUTH_MODE: authMode,
        FIELDNOTES_UPSTREAM_ORIGIN: "http://127.0.0.1:45114",
        FIELDNOTES_PUBLIC_ORIGIN: publicOrigin,
        ...(authMode === "firebase"
          ? {
              FIELDNOTES_FIREBASE_API_KEY: "demo-fieldnotes-key",
              FIELDNOTES_FIREBASE_AUTH_DOMAIN: "demo-fieldnotes.firebaseapp.com",
              FIELDNOTES_FIREBASE_PROJECT_ID: "demo-fieldnotes",
              FIELDNOTES_FIREBASE_EMULATOR_URL: "http://127.0.0.1:9099",
            }
          : {}),
      },
    },
    {
      command: `caddy run --config ${caddyfile}`,
      cwd: webRoot,
      url: publicOrigin,
      ignoreHTTPSErrors: true,
      reuseExistingServer: process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "true",
      env: {
        FIELDNOTES_PUBLIC_ORIGIN: publicOrigin,
        FIELDNOTES_BIND_ADDRESS: "127.0.0.1",
        FIELDNOTES_NEXT_ADDRESS: "127.0.0.1:45113",
        FIELDNOTES_TLS_KEY: tlsKey,
        FIELDNOTES_TLS_CERT: tlsCert,
      },
    },
  ],
});
