import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectMarkdownRelativeLinks,
  collectRuntimeExportSpecifiers,
  runReleaseReadiness,
} from "./check-release-readiness.mjs";

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function initializeRepository(repoRoot) {
  execFileSync("git", ["init", "--quiet"], { cwd: repoRoot });
}

describe("check-release-readiness", () => {
  it("enumerates fixed and both generated Proto wildcard export spellings", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "release-readiness-"));
    const packageRoot = join(repoRoot, "packages", "proto");
    mkdirSync(join(packageRoot, "dist", "generated", "spine", "core"), {
      recursive: true,
    });
    writeJson(join(packageRoot, "package.json"), {
      name: "@example/proto",
      exports: {
        ".": "./dist/index.js",
        "./generated/*": "./dist/generated/*.js",
        "./generated/*.js": "./dist/generated/*.js",
      },
    });
    writeFileSync(join(packageRoot, "dist", "index.js"), "export {};\n");
    writeFileSync(
      join(packageRoot, "dist", "generated", "spine", "core", "command_pb.js"),
      "export {};\n",
    );

    expect(collectRuntimeExportSpecifiers(repoRoot)).toEqual([
      {
        packageDirectory: "packages/proto",
        specifier: "@example/proto",
      },
      {
        packageDirectory: "packages/proto",
        specifier: "@example/proto/generated/spine/core/command_pb",
      },
      {
        packageDirectory: "packages/proto",
        specifier: "@example/proto/generated/spine/core/command_pb.js",
      },
    ]);
  });

  it("collects only relative Markdown links outside fenced code and strips suffixes", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "release-readiness-"));
    initializeRepository(repoRoot);
    mkdirSync(join(repoRoot, "docs"), { recursive: true });
    writeFileSync(
      join(repoRoot, "docs", "README.md"),
      [
        "[kept](guide.md#section)",
        "[kept too](../AGENTS.md?raw=1)",
        "[url](https://example.test/guide.md)",
        "[anchor](#local)",
        "[absolute evidence](/private/tmp/old-evidence.md)",
        "[scheme](mailto:team@example.test)",
        "```md",
        "[ignored](missing.md)",
        "```",
      ].join("\n"),
    );
    execFileSync("git", ["add", "docs/README.md"], { cwd: repoRoot });

    expect(collectMarkdownRelativeLinks(repoRoot)).toEqual([
      {
        sourcePath: "docs/README.md",
        targetPath: "../AGENTS.md",
      },
      {
        sourcePath: "docs/README.md",
        targetPath: "guide.md",
      },
    ]);
  });

  it("reports a tracked broken Markdown source and target after package self-import succeeds", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "release-readiness-"));
    const packageRoot = join(repoRoot, "packages", "runtime");
    initializeRepository(repoRoot);
    mkdirSync(join(packageRoot, "dist"), { recursive: true });
    mkdirSync(join(repoRoot, "docs"), { recursive: true });
    writeJson(join(packageRoot, "package.json"), {
      name: "@example/runtime",
      type: "module",
      exports: {
        ".": "./dist/index.js",
      },
    });
    writeFileSync(join(packageRoot, "dist", "index.js"), "export const ready = true;\n");
    writeFileSync(join(repoRoot, "docs", "README.md"), "[missing](missing.md)\n");
    execFileSync("git", ["add", "docs/README.md"], { cwd: repoRoot });

    let failure;

    try {
      runReleaseReadiness(repoRoot);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain("Broken Markdown link: docs/README.md -> missing.md");
    expect(failure.message).not.toContain("Broken package export");
  });
});
