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

const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "true";
const gatewayPort = Number(process.env.MESSAGE_BOARD_TEST_GATEWAY_PORT ?? "8090");
const gatewayUrl = `http://127.0.0.1:${String(gatewayPort)}`;
const webPort = Number(process.env.MESSAGE_BOARD_TEST_WEB_PORT ?? "5173");
const webUrl = `http://127.0.0.1:${String(webPort)}`;

export default defineConfig({
  testDir: ".",
  tsconfig: "./tsconfig.json",
  use: { baseURL: webUrl },
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
      env: { VITE_MESSAGE_BOARD_GATEWAY_URL: gatewayUrl },
      port: webPort,
      reuseExistingServer,
    },
  ],
});
