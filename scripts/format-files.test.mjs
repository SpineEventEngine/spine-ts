import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { selectFormatFiles, formatCandidateFiles } from "./format-files.mjs";

describe("format-files", () => {
  it("selects formatter-supported paths and skips generated output", () => {
    expect(
      selectFormatFiles([
        "package.json",
        ".prettierrc.json",
        "docs/USER_GUIDE.md",
        "packages/core/src/index.ts",
        "packages/proto/generated/spine/core/command_pb.ts",
        "examples/todo/generated/task_pb.ts",
        "examples/todo/src/index.test.ts",
        "packages/proto/proto/spine/README.md",
        "scripts/proto-workflow.mjs",
        "build-protocol/work-logs/T-0016a.md",
        "src/out-of-scope.ts",
      ]),
    ).toEqual([
      ".prettierrc.json",
      "build-protocol/work-logs/T-0016a.md",
      "docs/USER_GUIDE.md",
      "examples/todo/src/index.test.ts",
      "package.json",
      "packages/core/src/index.ts",
      "packages/proto/proto/spine/README.md",
      "scripts/proto-workflow.mjs",
    ]);
  });

  it("includes nonignored new files, skips deleted and ignored paths, and surfaces failures", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-format-files-"));
    try {
      execFileSync("git", ["init"], { cwd: repoRoot });
      execFileSync("git", ["config", "user.email", "tests@spine.io"], { cwd: repoRoot });
      execFileSync("git", ["config", "user.name", "Spine Tests"], { cwd: repoRoot });
      mkdirSync(join(repoRoot, "scripts"));
      mkdirSync(join(repoRoot, "examples", "todo", "generated"), { recursive: true });
      writeFileSync(join(repoRoot, ".gitignore"), "scripts/ignored.mjs\n");
      writeFileSync(join(repoRoot, "scripts/kept.mjs"), "export const kept = true;\n");
      writeFileSync(join(repoRoot, "scripts/deleted.mjs"), "export const deleted = true;\n");
      symlinkSync("missing.mjs", join(repoRoot, "scripts/linked.mjs"));
      execFileSync("git", ["add", "."], { cwd: repoRoot });
      execFileSync("git", ["commit", "-m", "fixture"], { cwd: repoRoot });
      rmSync(join(repoRoot, "scripts/deleted.mjs"));
      writeFileSync(join(repoRoot, "scripts/new.mjs"), "export const newFile=true;\n");
      writeFileSync(join(repoRoot, "scripts/ignored.mjs"), "export const ignored=true;\n");
      writeFileSync(
        join(repoRoot, "examples/todo/generated/state.ts"),
        "export const generated=true;\n",
      );

      const candidates = formatCandidateFiles(repoRoot);
      expect(candidates).toContain("scripts/kept.mjs");
      expect(candidates).toContain("scripts/linked.mjs");
      expect(candidates).toContain("scripts/new.mjs");
      expect(candidates).not.toContain("scripts/deleted.mjs");
      expect(candidates).not.toContain("scripts/ignored.mjs");
      expect(selectFormatFiles(candidates)).toContain("scripts/linked.mjs");
      expect(selectFormatFiles(candidates)).toContain("scripts/new.mjs");
      expect(selectFormatFiles(candidates)).not.toContain("examples/todo/generated/state.ts");

      const failure = Object.assign(new Error("status denied"), { code: "EACCES" });
      expect(() =>
        formatCandidateFiles(repoRoot, () => {
          throw failure;
        }),
      ).toThrow(failure);
      const outsideGit = mkdtempSync(join(tmpdir(), "spine-format-nongit-"));
      try {
        expect(() => formatCandidateFiles(outsideGit)).toThrow(/Formatter file listing failed/);
      } finally {
        rmSync(outsideGit, { recursive: true, force: true });
      }
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
