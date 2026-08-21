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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("keeps handler tooling independent of the Server runtime package", () => {
  const toolingPackage = JSON.parse(
    readFileSync(join(process.cwd(), "packages/proto-tools/package.json"), "utf8"),
  ) as { readonly dependencies?: Readonly<Record<string, string>> };
  const serverPackage = JSON.parse(
    readFileSync(join(process.cwd(), "packages/server/package.json"), "utf8"),
  ) as {
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly exports?: Readonly<Record<string, unknown>>;
  };

  expect(toolingPackage.dependencies?.["@spine-event-engine/server"]).toBeUndefined();
  expect(toolingPackage.dependencies?.typescript).toBe("6.0.3");
  expect(serverPackage.dependencies?.typescript).toBeUndefined();
  expect(serverPackage.exports?.["./internal/handler-codegen"]).toBeUndefined();
  expect(serverPackage.exports?.["./internal/generated-handler-registry"]).toBeUndefined();
  expect(serverPackage.exports?.["./spi/handler-registry"]).toBeDefined();
});
