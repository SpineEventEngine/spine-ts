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

import { expect, it } from "vitest";
import { StudioIpcErrors } from "../src/trusted/studio-ipc-errors.js";

it("maps stale review, uncertain generation, history, and export failures without exposing raw data", async () => {
  await expect(
    StudioIpcErrors.execute("edit", () =>
      Promise.reject(new Error("The displayed draft Version is stale.")),
    ),
  ).rejects.toThrow("The draft changed. Read the current draft before trying again.");
  await expect(
    StudioIpcErrors.execute("generate", () =>
      Promise.reject(new Error("Bearer secret-token at /private/path")),
    ),
  ).rejects.toThrow(
    "We cannot confirm whether writing started. Check this draft; use Retry saved draft only if it appears.",
  );
  await expect(
    StudioIpcErrors.execute("generate", () =>
      Promise.reject(new Error("Generation inputs changed; read the current draft.")),
    ),
  ).rejects.toThrow("The draft changed before writing could start. Refresh it, then try again.");
  await expect(
    StudioIpcErrors.execute("history", () => Promise.reject(new Error("private history token"))),
  ).rejects.toThrow("Activity could not be loaded. Try again.");
  await expect(
    StudioIpcErrors.execute("export", () => Promise.reject(new Error("private destination"))),
  ).rejects.toThrow(
    "We cannot confirm whether the file was saved. Check the chosen location before exporting again.",
  );
  const safe = StudioIpcErrors.display(
    new Error(
      "Error invoking remote method: We cannot confirm whether writing started. Check this draft; use Retry saved draft only if it appears.",
    ),
    "fallback",
  );
  expect(safe).toContain("Retry saved draft");
  expect(StudioIpcErrors.display(new Error("Bearer secret-token"), "fallback")).toBe("fallback");
});

it("keeps non-Error failures private and returns the unchanged result on success", async () => {
  const result = { draft: "ready" };
  await expect(StudioIpcErrors.execute("session", () => Promise.resolve(result))).resolves.toBe(
    result,
  );
  expect(StudioIpcErrors.message("session", "Bearer secret-token")).toBe(
    "We could not confirm this action. Refresh the draft and try again.",
  );
  await expect(
    StudioIpcErrors.execute("select-account", () =>
      Promise.reject(new Error("Wait for the current account or generation action.")),
    ),
  ).rejects.toThrow("Writing is still in progress. Wait, or quit and stop it.");
  expect(StudioIpcErrors.display("Bearer secret-token", "Read current draft")).toBe(
    "Read current draft",
  );
});
