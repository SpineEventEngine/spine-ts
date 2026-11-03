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

import { generateKeyPairSync, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardAdmission } from "../src/signed-admission.js";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const environment = {
  MESSAGE_BOARD_SESSION_PRIVATE_KEY_PEM: privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString(),
  MESSAGE_BOARD_SESSION_KEY_ID: "admin-test-key",
  MESSAGE_BOARD_SESSION_ISSUER: "board-admin-test",
  MESSAGE_BOARD_SESSION_AUDIENCE: "board-browser-test",
  MESSAGE_BOARD_READER_PROOF_KEY_BASE64: randomBytes(32).toString("base64"),
};

describe("administrative Message Board credential issuance", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it.each([
    [{ MESSAGE_BOARD_ACCOUNT_ID: undefined, MESSAGE_BOARD_ACCOUNT_BOARDS: "general" }],
    [{ MESSAGE_BOARD_ACCOUNT_ID: "  ", MESSAGE_BOARD_ACCOUNT_BOARDS: "general" }],
    [{ MESSAGE_BOARD_ACCOUNT_ID: "ada", MESSAGE_BOARD_ACCOUNT_BOARDS: undefined }],
    [{ MESSAGE_BOARD_ACCOUNT_ID: "ada", MESSAGE_BOARD_ACCOUNT_BOARDS: "  " }],
  ])("refuses incomplete account configuration", async (account) => {
    for (const [name, value] of Object.entries({ ...environment, ...account }))
      vi.stubEnv(name, value);
    await expect(import("../src/issue-board-session.js")).rejects.toThrow(
      "MESSAGE_BOARD_ACCOUNT_ID and MESSAGE_BOARD_ACCOUNT_BOARDS are required.",
    );
  });

  it.each([
    [undefined, "false"],
    ["true", "true"],
  ])("issues a credential with the configured restricted-reader grant", async (grant, expected) => {
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    vi.stubEnv("MESSAGE_BOARD_ACCOUNT_ID", "ada");
    vi.stubEnv("MESSAGE_BOARD_ACCOUNT_BOARDS", "general,restricted");
    vi.stubEnv("MESSAGE_BOARD_ACCOUNT_CAN_READ_RESTRICTED", grant);
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await import("../src/issue-board-session.js");
    const credential = String(output.mock.calls[0]?.[0]).trim();
    expect(credential).not.toBe("");
    const admission = BoardAdmission.signed(environment);
    try {
      const resolved = await admission.sessions.resolve({ kind: "bearer", value: credential });
      expect(resolved?.principal).toMatchObject({
        id: "ada",
        attributes: { boards: "general,restricted", canReadRestricted: expected },
      });
    } finally {
      await admission.sessions.close();
    }
  });
});
