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

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { modelSourceView } from "../src/generation/source-view.js";

describe("modelSourceView", () => {
  it("excludes live generated, stage, backup, and declaration trees while redirecting to stage", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-source-view-"));
    try {
      for (const path of [
        "src",
        "generated",
        ".generated.stage-1",
        ".generated.a.backup-1",
        "dist",
      ])
        mkdirSync(join(root, path));
      writeFileSync(join(root, "src/authored.ts"), "export interface Authored {}\n");
      writeFileSync(join(root, "generated/live.ts"), "export {};\n");
      writeFileSync(join(root, ".generated.stage-1/staged.ts"), "export {};\n");
      writeFileSync(join(root, ".generated.a.backup-1/backup.ts"), "export {};\n");
      writeFileSync(join(root, "dist/output.d.ts"), "export {};\n");
      const view = modelSourceView(root, "generated", join(root, ".generated.stage-x/output"));
      expect(view.authoredFiles).toEqual([join(root, "src/authored.ts")]);
      expect(view.stagedGeneratedRoot).toBe(join(root, ".generated.stage-x/output"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed beyond the bounded source-view directory depth", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-source-view-depth-"));
    try {
      let current = root;
      for (let depth = 0; depth <= 32; depth += 1) {
        current = join(current, "nested");
        mkdirSync(current);
      }
      expect(() =>
        modelSourceView(root, "generated", join(root, ".generated.stage-x/output")),
      ).toThrow("exceeds bounded traversal");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed beyond the bounded source-view entry count", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-source-view-entries-"));
    try {
      for (let entry = 0; entry <= 10_000; entry += 1)
        writeFileSync(join(root, `entry-${String(entry)}.txt`), "x\n");
      expect(() =>
        modelSourceView(root, "generated", join(root, ".generated.stage-x/output")),
      ).toThrow("exceeds bounded traversal");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
