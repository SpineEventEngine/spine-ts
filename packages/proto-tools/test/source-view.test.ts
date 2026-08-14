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

import { mkdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  assertViewRecordCurrent,
  assertSourceViewCurrent,
  modelSourceView,
  readViewRecord,
  SourceViewInputs,
  writeViewRecord,
} from "../src/generation/source-view.js";

describe("modelSourceView", () => {
  it("persists and revalidates a canonical live source view from an outer stage", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-source-view-publication-"));
    const live = join(root, "live-model");
    const stage = join(root, "stage-model");
    try {
      mkdirSync(join(live, "src"), { recursive: true });
      mkdirSync(join(live, "generated"), { recursive: true });
      mkdirSync(join(stage, "generated"), { recursive: true });
      writeFileSync(join(live, "tsconfig.json"), '{"include":["src/**/*.ts"]}\n');
      writeFileSync(join(live, "src/authored.ts"), "export interface Authored {}\n");
      const view = modelSourceView(live, "generated", join(stage, "generated"));

      writeViewRecord(stage, view);
      const record = readViewRecord(stage, live, join(live, "generated"));
      expect(record.livePackageRoot).toBe(realpathSync(live));
      expect(record.liveGeneratedRoot).toBe(join(realpathSync(live), "generated"));
      expect(() => {
        assertViewRecordCurrent(record);
      }).not.toThrow();

      writeFileSync(join(live, "src/authored.ts"), "export interface Changed {}\n");
      expect(() => {
        assertViewRecordCurrent(record);
      }).toThrow("source view changed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects malformed or non-regular root publication records", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-source-view-record-invalid-"));
    const live = join(root, "live-model");
    const stage = join(root, "stage-model");
    const record = join(stage, ".spine-source-view-publication.json");
    try {
      mkdirSync(join(live, "generated"), { recursive: true });
      mkdirSync(stage);
      for (const value of [
        {},
        { formatVersion: 2 },
        {
          formatVersion: 1,
          inventoryDigest: "not-a-digest",
          liveGeneratedRoot: join(live, "generated"),
          livePackageRoot: live,
        },
        {
          formatVersion: 1,
          inventoryDigest: "0".repeat(64),
          liveGeneratedRoot: join(root, "other"),
          livePackageRoot: live,
        },
      ]) {
        writeFileSync(record, `${JSON.stringify(value)}\n`);
        expect(() => readViewRecord(stage, live, join(live, "generated"))).toThrow(
          "invalid source-view publication record",
        );
      }
      writeFileSync(record, "{\n");
      expect(() => readViewRecord(stage, live, join(live, "generated"))).toThrow(
        "invalid source-view publication record",
      );
      writeFileSync(record, "null\n");
      expect(() => readViewRecord(stage, live, join(live, "generated"))).toThrow(
        "invalid source-view publication record",
      );
      writeFileSync(record, " ".repeat(16 * 1024 + 1));
      expect(() => readViewRecord(stage, live, join(live, "generated"))).toThrow(
        "invalid source-view publication record",
      );
      rmSync(record);
      expect(() => readViewRecord(stage, live, join(live, "generated"))).toThrow(
        "invalid source-view publication record",
      );
      execFileSync("mkfifo", [record]);
      expect(() => readViewRecord(stage, live, join(live, "generated"))).toThrow(
        "invalid source-view publication record",
      );
      rmSync(record);
      symlinkSync(join(live, "tsconfig.json"), record);
      expect(() => readViewRecord(stage, live, join(live, "generated"))).toThrow(
        "invalid source-view publication record",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(["add", "remove", "rename", "config"])(
    "detects a live source-view %s mutation after its record is written",
    (mutation) => {
      const root = mkdtempSync(join(tmpdir(), "spine-source-view-record-mutation-"));
      const live = join(root, "live-model");
      const stage = join(root, "stage-model");
      try {
        mkdirSync(join(live, "src"), { recursive: true });
        mkdirSync(join(live, "generated"), { recursive: true });
        mkdirSync(join(stage, "generated"), { recursive: true });
        writeFileSync(join(live, "tsconfig.json"), '{"include":["src/**/*.ts"]}\n');
        const authored = join(live, "src/authored.ts");
        writeFileSync(authored, "export interface Authored {}\n");
        const view = modelSourceView(live, "generated", join(stage, "generated"));
        writeViewRecord(stage, view);
        const record = readViewRecord(stage, live, join(live, "generated"));
        if (mutation === "add") writeFileSync(join(live, "src/added.ts"), "export {}\n");
        if (mutation === "remove") rmSync(authored);
        if (mutation === "rename") renameSync(authored, join(live, "src/renamed.ts"));
        if (mutation === "config")
          writeFileSync(join(live, "tsconfig.json"), '{"include":["src/renamed.ts"]}\n');
        expect(() => {
          assertViewRecordCurrent(record);
        }).toThrow("source view changed");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

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
      symlinkSync(join(root, "src/authored.ts"), join(root, "src/ignored-link.txt"));
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
      mkdirSync(join(root, "src/.generated-root-transaction/generated"), { recursive: true });
      writeFileSync(join(root, "src/authored.ts"), "export interface Authored {}\n");
      writeFileSync(join(root, "src/dist/local.ts"), "export interface Local {}\n");
      writeFileSync(join(root, "src/types.d.ts"), "export interface Declared {}\n");
      writeFileSync(join(root, "src/helper.js"), "export const helper = true;\n");
      writeFileSync(join(root, "src/generated/live.ts"), "export {};\n");
      writeFileSync(join(root, "src/.generated.stage-1/staged.ts"), "export {};\n");
      writeFileSync(join(root, "src/.generated.a.backup/backup.ts"), "export {};\n");
      writeFileSync(
        join(root, "src/.generated-root-transaction/generated/staged.ts"),
        "export {};\n",
      );
      writeFileSync(join(root, "dist/output.d.ts"), "export {};\n");
      const view = modelSourceView(
        root,
        "src/generated",
        join(root, "src/.generated.stage-x/output"),
      );
      expect(view.authoredFiles).toEqual([
        join(realpathSync(root), "src/authored.ts"),
        join(realpathSync(root), "src/dist/local.ts"),
      ]);
      expect(view.compilerFiles).toEqual([
        join(realpathSync(root), "src/authored.ts"),
        join(realpathSync(root), "src/dist/local.ts"),
        join(realpathSync(root), "src/helper.js"),
        join(realpathSync(root), "src/types.d.ts"),
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
