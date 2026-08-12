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

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function resolveEntrypoint(specifier: string) {
  return spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `await import(${JSON.stringify(specifier)});`],
    { cwd: resolve("packages/proto"), encoding: "utf8" },
  );
}

describe("@spine-event-engine/proto package entrypoints", () => {
  it("exposes the root groups plus canonical sources, compiled generated modules, and manifest", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve("packages/proto/package.json"), "utf8"),
    ) as { exports: Record<string, unknown> };

    expect(Object.keys(packageJson.exports).sort()).toEqual(
      [
        ".",
        "./auth",
        "./client",
        "./delivery",
        "./delivery-server",
        "./deployment",
        "./spine-proto-manifest.json",
        "./proto/*",
        "./generated/*.js",
      ].sort(),
    );
  });

  it("resolves every supported package entrypoint and rejects private paths", () => {
    for (const supported of [
      "@spine-event-engine/proto",
      "@spine-event-engine/proto/auth",
      "@spine-event-engine/proto/client",
      "@spine-event-engine/proto/delivery",
      "@spine-event-engine/proto/delivery-server",
      "@spine-event-engine/proto/deployment",
      "@spine-event-engine/proto/generated/proto-module.js",
    ]) {
      expect(resolveEntrypoint(supported).status, supported).toBe(0);
    }

    for (const privatePath of ["@spine-event-engine/proto/runtime"]) {
      const result = resolveEntrypoint(privatePath);
      expect(result.status, privatePath).toBe(1);
      expect(result.stderr).toContain("ERR_PACKAGE_PATH_NOT_EXPORTED");
    }
  });

  it("resolves manifest-derived schema and module specifiers without appending a second suffix", () => {
    const manifest = JSON.parse(
      readFileSync(resolve("packages/proto/spine-proto-manifest.json"), "utf8"),
    ) as { generatedExports: Record<string, string> };

    const generatedExports = [
      manifest.generatedExports["spine/core/ack.proto"],
      "generated/proto-module.js",
    ].filter((generatedExport): generatedExport is string => generatedExport !== undefined);
    expect(generatedExports).toHaveLength(2);

    for (const generatedExport of generatedExports) {
      const specifier = `@spine-event-engine/proto/${generatedExport}`;
      expect(resolveEntrypoint(specifier).status, specifier).toBe(0);
      expect(
        existsSync(
          resolve(
            "packages/proto/dist/generated",
            `${generatedExport.slice("generated/".length, -3)}.d.ts`,
          ),
        ),
      ).toBe(true);
    }
  });

  it("keeps end-user guides and the Todo smoke runner on supported imports", () => {
    for (const consumerPath of [
      "docs/USER_GUIDE.md",
      "examples/todo/USER_GUIDE.md",
      "examples/todo/scripts/smoke.mjs",
    ]) {
      const contents = readFileSync(resolve(consumerPath), "utf8");
      expect(contents, consumerPath).not.toContain("@spine-event-engine/proto/generated/");
    }
  });
});
