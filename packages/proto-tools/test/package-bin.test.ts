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

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  bin: { "spine-proto": string };
};
const bin = packageJson.bin["spine-proto"];

describe("spine-proto package binary", () => {
  it("exists before build and is included in the packed package", () => {
    expect(existsSync(join(packageRoot, bin))).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(join(packageRoot, bin)).mode & 0o111).not.toBe(0);
    }

    const destination = mkdtempSync(join(tmpdir(), "spine-proto-pack-"));
    try {
      execFileSync(
        "pnpm",
        [
          "--dir",
          packageRoot,
          "pack",
          "--config.ignore-scripts=true",
          "--pack-destination",
          destination,
        ],
        { stdio: "pipe" },
      );
      const tarballs = readdirSync(destination).filter((file) => file.endsWith(".tgz"));
      expect(tarballs).toHaveLength(1);
      const tarballName = tarballs[0];
      if (tarballName === undefined) throw new Error("Expected one packed proto-tools tarball.");
      const tarball = join(destination, tarballName);
      const files = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" });

      expect(files).toContain(`package/${bin.slice(2)}\n`);
    } finally {
      rmSync(destination, { force: true, recursive: true });
    }
  });
});
