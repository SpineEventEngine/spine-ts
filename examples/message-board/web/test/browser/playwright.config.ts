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

import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "true";
const gatewayPort = Number(process.env.MESSAGE_BOARD_TEST_GATEWAY_PORT ?? "8090");
const gatewayUrl = `http://127.0.0.1:${String(gatewayPort)}`;
const webPort = Number(process.env.MESSAGE_BOARD_TEST_WEB_PORT ?? "5173");
const webUrl = `https://127.0.0.1:${String(webPort)}`;
const tlsKey = fileURLToPath(new URL("./fixtures/test-only-edge-key.pem", import.meta.url));
const tlsCertificate = fileURLToPath(
  new URL("./fixtures/test-only-edge-cert.pem", import.meta.url),
);

export default defineConfig({
  testDir: ".",
  testMatch: "message-board.spec.ts",
  tsconfig: "./tsconfig.json",
  use: { baseURL: webUrl, ignoreHTTPSErrors: true },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: [
    {
      command: `node --input-type=module --eval 'import { MessageBoardApplication } from "../app/dist/src/index.js"; await new MessageBoardApplication().run({ port: ${String(gatewayPort)}, webOrigin: "${webUrl}" });'`,
      cwd: "../..",
      port: gatewayPort,
      reuseExistingServer,
    },
    {
      command: `pnpm exec vite --host 127.0.0.1 --port ${String(webPort)}`,
      cwd: "../..",
      env: {
        VITE_MESSAGE_BOARD_GATEWAY_URL: webUrl,
        MESSAGE_BOARD_INTERNAL_GATEWAY_URL: gatewayUrl,
        MESSAGE_BOARD_TLS_KEY_FILE: tlsKey,
        MESSAGE_BOARD_TLS_CERT_FILE: tlsCertificate,
      },
      url: webUrl,
      ignoreHTTPSErrors: true,
      reuseExistingServer,
    },
  ],
});
