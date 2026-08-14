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

import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  assertSourceViewCurrent,
  modelSourceView,
  SourceViewInputs,
} from "../src/generation/source-view.js";

describe("modelSourceView", () => {
  it("rejects non-regular TypeScript inputs before hashing", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-source-view-nonregular-"));
    try {
      execFileSync("mkfifo", [join(root, "blocked.ts")]);
      expect(() => SourceViewInputs.read(join(root, "blocked.ts"))).toThrow(
        "non-regular TypeScript input",
      );
      expect(() =>
        modelSourceView(root, "src/generated", join(root, ".generated.stage/output")),
      ).toThrow("non-regular TypeScript input");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("normalizes missing and symlinked source read failures", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-source-view-read-"));
    try {
      const authored = join(root, "authored.ts");
      writeFileSync(authored, "export interface Authored {}\n");
      expect(SourceViewInputs.read(authored).toString("utf8")).toContain("Authored");
      expect(() => SourceViewInputs.read(join(root, "missing.ts"))).toThrow(
        "non-regular TypeScript input",
      );
      symlinkSync(authored, join(root, "linked.ts"));
      expect(() =>
        modelSourceView(root, "src/generated", join(root, ".generated.stage/output")),
      ).toThrow("non-regular TypeScript input");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid TypeScript configuration before generation", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-source-view-invalid-config-"));
    try {
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ include: 1 }));
      expect(() =>
        modelSourceView(root, "src/generated", join(root, ".generated.stage/output")),
      ).toThrow("source view has invalid tsconfig.json");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("detects a recursively extended tsconfig byte mutation", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-source-view-tsconfig-"));
    try {
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ extends: "./base.json" }));
      writeFileSync(join(root, "base.json"), JSON.stringify({ compilerOptions: { strict: true } }));
      writeFileSync(join(root, "src/authored.ts"), "export interface Authored {}\n");
      const view = modelSourceView(root, "src/generated", join(root, ".generated.stage/output"));
      writeFileSync(
        join(root, "base.json"),
        JSON.stringify({ compilerOptions: { strict: false } }),
      );
      expect(() => {
        assertSourceViewCurrent(view);
      }).toThrow("source view changed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("excludes live generated, stage, backup, and declaration trees while redirecting to stage", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-source-view-"));
    try {
      writeFileSync(join(root, "tsconfig.json"), '{"compilerOptions":{"allowJs":true}}\n');
      for (const path of [
        "src",
        "src/dist",
        "src/generated",
        "src/.generated.stage-1",
        "src/.generated.a.backup",
        "dist",
      ])
        mkdirSync(join(root, path));
      writeFileSync(join(root, "src/authored.ts"), "export interface Authored {}\n");
      writeFileSync(join(root, "src/dist/local.ts"), "export interface Local {}\n");
      writeFileSync(join(root, "src/types.d.ts"), "export interface Declared {}\n");
      writeFileSync(join(root, "src/helper.js"), "export const helper = true;\n");
      writeFileSync(join(root, "src/generated/live.ts"), "export {};\n");
      writeFileSync(join(root, "src/.generated.stage-1/staged.ts"), "export {};\n");
      writeFileSync(join(root, "src/.generated.a.backup/backup.ts"), "export {};\n");
      writeFileSync(join(root, "dist/output.d.ts"), "export {};\n");
      const view = modelSourceView(
        root,
        "src/generated",
        join(root, "src/.generated.stage-x/output"),
      );
      expect(view.authoredFiles).toEqual([
        join(root, "src/authored.ts"),
        join(root, "src/dist/local.ts"),
      ]);
      expect(view.compilerFiles).toEqual([
        join(root, "src/authored.ts"),
        join(root, "src/dist/local.ts"),
        join(root, "src/helper.js"),
        join(root, "src/types.d.ts"),
      ]);
      expect(view.stagedGeneratedRoot).toBe(join(root, "src/.generated.stage-x/output"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed beyond the bounded source-view directory depth", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-source-view-depth-"));
    try {
      writeFileSync(join(root, "tsconfig.json"), "{}\n");
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
