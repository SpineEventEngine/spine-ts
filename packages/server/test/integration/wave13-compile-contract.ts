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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "vitest";

const serverRoot = fileURLToPath(new URL("../..", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));

/** Compiles a temporary package consumer and reports its complete diagnostics. */
export function expectWave13ContractToCompile(source: string): void {
  const directory = mkdtempSync(join(serverRoot, ".wave13-contract-"));
  try {
    writeFileSync(join(directory, "contract.ts"), source, "utf8");
    writeFileSync(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        extends: join(repositoryRoot, "tsconfig.base.json"),
        compilerOptions: {
          composite: false,
          lib: ["ES2024", "DOM", "DOM.Iterable", "decorators"],
          noEmit: true,
          rootDir: directory,
          skipLibCheck: true,
          types: ["node"],
        },
        include: ["contract.ts"],
      }),
      "utf8",
    );
    const result = spawnSync(
      process.execPath,
      [
        join(repositoryRoot, "node_modules/typescript/bin/tsc"),
        "-p",
        join(directory, "tsconfig.json"),
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    expect(
      result.status,
      `Wave 13 compile-consumer contract failed:\n${result.stdout}${result.stderr}`,
    ).toBe(0);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}
