/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import {
  finalPublicSurfaceProblems,
  nativeServerRootDependencyProblems,
  packageExportInternalPathProblems,
  siblingPackageTreeReachProblems,
} from "./package-boundary-policy.mjs";

const repoRoot = new URL("..", import.meta.url).pathname;

it("does not publish package exports named internal", () => {
  expect(packageExportInternalPathProblems(repoRoot)).toEqual([]);
});

it("rejects a test fixture that resolves through a sibling package source tree", () => {
  const root = mkdtempSync(join(tmpdir(), "spine-package-boundary-"));
  try {
    for (const name of ["consumer", "sibling"]) {
      mkdirSync(join(root, "packages", name, "src"), { recursive: true });
      writeFileSync(
        join(root, "packages", name, "package.json"),
        JSON.stringify({ name: `@example/${name}` }),
      );
    }
    mkdirSync(join(root, "packages", "consumer", "test-fixtures"));
    writeFileSync(join(root, "packages", "sibling", "src", "api.ts"), "export const api = 1;\n");
    writeFileSync(
      join(root, "packages", "consumer", "test-fixtures", "app.ts"),
      'import { api } from "../../sibling/src/api.js";\nexport { api };\n',
    );
    writeFileSync(
      join(root, "packages", "consumer", "test-fixtures", "same-package.ts"),
      'import { api } from "../src/api.js";\nexport { api };\n',
    );
    writeFileSync(join(root, "packages", "consumer", "src", "api.ts"), "export const api = 1;\n");

    expect(siblingPackageTreeReachProblems(root)).toEqual([
      "packages/consumer/test-fixtures/app.ts reaches packages/sibling/src/api.ts",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("keeps tracked package tests and fixtures out of sibling implementation trees", () => {
  expect(siblingPackageTreeReachProblems(repoRoot)).toEqual([]);
});

it("keeps the native server root free of compiler and browser-auth runtime dependencies", () => {
  expect(nativeServerRootDependencyProblems(repoRoot)).toEqual([]);
});

it("declares the final named SPI and browser surfaces in an acyclic 18-package graph", () => {
  expect(finalPublicSurfaceProblems(repoRoot)).toEqual([]);
});
