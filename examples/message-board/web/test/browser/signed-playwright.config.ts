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

import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const signing = {
  MESSAGE_BOARD_AUTH_MODE: "signed",
  MESSAGE_BOARD_SESSION_PRIVATE_KEY_PEM: readFileSync(
    new URL("./fixtures/test-only-private.pem", import.meta.url),
    "utf8",
  ),
  MESSAGE_BOARD_SESSION_KEY_ID: "browser-test-key",
  MESSAGE_BOARD_SESSION_ISSUER: "board-browser-test",
  MESSAGE_BOARD_SESSION_AUDIENCE: "board-browser",
  MESSAGE_BOARD_READER_PROOF_KEY_BASE64: randomBytes(32).toString("base64"),
};
const issuer = fileURLToPath(
  new URL("../../../app/dist/src/issue-board-session.js", import.meta.url),
);
function credential(id: string, boards: string, restricted: boolean): string {
  return execFileSync("node", [issuer], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...signing,
      MESSAGE_BOARD_ACCOUNT_ID: id,
      MESSAGE_BOARD_ACCOUNT_BOARDS: boards,
      MESSAGE_BOARD_ACCOUNT_CAN_READ_RESTRICTED: String(restricted),
    },
  }).trim();
}
process.env.MESSAGE_BOARD_TEST_GRANTED = credential(
  "ada",
  "general,restricted,announcements",
  true,
);
process.env.MESSAGE_BOARD_TEST_ORDINARY = credential("reader", "general,announcements", false);
const gatewayPort = 8091;
const webPort = 5174;
const gatewayUrl = `http://127.0.0.1:${String(gatewayPort)}`;
const webUrl = `https://127.0.0.1:${String(webPort)}`;
const tlsKey = fileURLToPath(new URL("./fixtures/test-only-edge-key.pem", import.meta.url));
const tlsCertificate = fileURLToPath(
  new URL("./fixtures/test-only-edge-cert.pem", import.meta.url),
);
export default defineConfig({
  testDir: ".",
  testMatch: "signed-board.spec.ts",
  use: { baseURL: webUrl, ignoreHTTPSErrors: true },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: `node --input-type=module --eval 'import { MessageBoardApplication } from "../app/dist/src/index.js"; await new MessageBoardApplication().run({ port: ${String(gatewayPort)}, webOrigin: "${webUrl}" });'`,
      cwd: "../..",
      port: gatewayPort,
      env: signing,
    },
    {
      command: `pnpm exec vite --host 127.0.0.1 --port ${String(webPort)}`,
      cwd: "../..",
      env: {
        VITE_MESSAGE_BOARD_GATEWAY_URL: webUrl,
        VITE_MESSAGE_BOARD_AUTH_MODE: "signed",
        MESSAGE_BOARD_INTERNAL_GATEWAY_URL: gatewayUrl,
        MESSAGE_BOARD_TLS_KEY_FILE: tlsKey,
        MESSAGE_BOARD_TLS_CERT_FILE: tlsCertificate,
      },
      url: webUrl,
      ignoreHTTPSErrors: true,
    },
  ],
});
