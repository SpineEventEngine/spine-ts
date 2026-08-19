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

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const beginnerModules = [
  "examples/message-board/app/src/application-entry.ts",
  "examples/message-board/app/src/combined-entry.ts",
  "examples/message-board/app/src/deployment-config.ts",
  "examples/message-board/app/src/gateway-entry.ts",
  "examples/message-board/app/src/index.ts",
  "examples/message-board/app/src/managed-entry.ts",
  "examples/todo/src/managed-deployment.ts",
  "examples/todo/src/managed-entry.ts",
  "packages/deployment-gce/examples/application.ts",
  "packages/deployment-gce/examples/deployment-settings.ts",
  "packages/deployment-gce/examples/gateway.ts",
  "packages/deployment-gke/examples/application.ts",
  "packages/deployment-gke/examples/deployment-settings.ts",
  "packages/deployment-gke/examples/gateway.ts",
] as const;

describe("deployment example source documentation", () => {
  it.each(beginnerModules)("orients a beginner before code begins in %s", async (path) => {
    const source = await readFile(path, "utf8");
    const afterLicense = source.slice(source.indexOf("*/") + 2);

    expect(afterLicense).toMatch(/^\s*\/\*\*[\s\S]+?\*\/\s*(?:import|export)\b/u);
  });
});
