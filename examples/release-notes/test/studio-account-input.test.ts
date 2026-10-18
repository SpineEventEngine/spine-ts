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
import { validateAccountInput } from "../src/trusted/studio-account-input.js";

test("account operations accept only their fixed argument shape", () => {
  expect(validateAccountInput("models", "issued-client")).toBe("issued-client");
  expect(validateAccountInput("current-model", null)).toBeNull();
  expect(() => validateAccountInput("status", { token: "secret" })).toThrow(
    "Unexpected IPC argument",
  );
  expect(() => validateAccountInput("models", { token: "secret" })).toThrow(
    "Invalid account reference",
  );
  expect(() => validateAccountInput("reconnect", "issued-client")).toThrow("Unknown IPC command");
});

test("model selection rejects extra fields and invalid slugs", () => {
  expect(
    validateAccountInput("select-model", {
      clientId: "issued-client",
      model: "account-model",
    }),
  ).toEqual({ clientId: "issued-client", model: "account-model" });
  expect(() =>
    validateAccountInput("select-model", {
      clientId: "issued-client",
      model: "account-model",
      token: "secret",
    }),
  ).toThrow("Invalid model selection");
  expect(() =>
    validateAccountInput("select-model", {
      clientId: "issued-client",
      model: "../other",
    }),
  ).toThrow("Invalid model selection");
});
