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

import { expect, test } from "vitest";

import { electronCipher, validateIpc } from "../src/trusted/electron-security.js";

test("credentials require available OS-backed Electron encryption", () => {
  const available = {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`cipher-${String(text.length)}`),
    decryptString: (bytes: Buffer) => (bytes.length > 0 ? "secret" : ""),
  };
  expect(electronCipher(available).encrypt("secret").toString()).not.toContain("secret");
  expect(electronCipher(available).decrypt(Buffer.from("cipher-6"))).toBe("secret");
  expect(() => electronCipher({ ...available, isEncryptionAvailable: () => false })).toThrow();
});

test("IPC rejects an unexpected sender and structured arguments", () => {
  const good = {
    senderId: 4,
    frameUrl: "file:///app/renderer.html",
    expectedSenderId: 4,
    expectedFrameUrl: "file:///app/renderer.html",
  };
  expect(validateIpc(good, "models", "issued-client")).toBe("issued-client");
  expect(() => validateIpc({ ...good, senderId: 5 }, "models", "issued-client")).toThrow();
  expect(() => validateIpc(good, "models", { token: "secret" })).toThrow();
  expect(() => validateIpc(good, "arbitrary-channel", "issued-client")).toThrow();
});

test("model selection accepts only a bounded client and model pair", () => {
  const context = {
    senderId: 4,
    frameUrl: "file:///app/renderer.html",
    expectedSenderId: 4,
    expectedFrameUrl: "file:///app/renderer.html",
  };
  expect(
    validateIpc(context, "select-model", { clientId: "issued-client", model: "account-model" }),
  ).toEqual({ clientId: "issued-client", model: "account-model" });
  expect(() =>
    validateIpc(context, "select-model", {
      clientId: "issued-client",
      model: "account-model",
      token: "secret",
    }),
  ).toThrow();
  expect(() =>
    validateIpc(context, "select-model", { clientId: "issued-client", model: "../other" }),
  ).toThrow();
});
