import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectLegacyNamespaceReferences,
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

function withTempRepository(callback) {
  const repoRoot = mkdtempSync(join(tmpdir(), "release-readiness-"));

  try {
    initializeRepository(repoRoot);
    return callback(repoRoot);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

function writeRuntimePackage(
  repoRoot,
  { exportTarget = "./dist/index.js", source = "export const ready = true;\n" } = {},
) {
  const packageRoot = join(repoRoot, "packages", "runtime");
  mkdirSync(join(packageRoot, "dist"), { recursive: true });
  writeJson(join(packageRoot, "package.json"), {
    name: "@example/runtime",
    type: "module",
    exports: {
      ".": exportTarget,
    },
  });

  if (source !== undefined) {
    writeFileSync(join(packageRoot, "dist", "index.js"), source);
  }
}

function captureFailure(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }

  return undefined;
}

describe("check-release-readiness", () => {
  it("removes a temporary repository after successful setup", () => {
    let repoRoot;

    withTempRepository((path) => {
      repoRoot = path;
      expect(existsSync(repoRoot)).toBe(true);
    });

    expect(existsSync(repoRoot)).toBe(false);
  });

  it("removes a temporary repository when setup fails", () => {
    let repoRoot;

    expect(() =>
      withTempRepository((path) => {
        repoRoot = path;
        throw new Error("fixture setup failed");
      }),
    ).toThrow("fixture setup failed");
    expect(existsSync(repoRoot)).toBe(false);
  });

  it("finds an old package scope in a live tracked source file", () => {
    withTempRepository((repoRoot) => {
      mkdirSync(join(repoRoot, "packages", "runtime", "src"), { recursive: true });
      writeFileSync(
        join(repoRoot, "packages", "runtime", "src", "index.ts"),
        `export { ready } from "${"@spine-" + "ts/"}core";\n`,
      );
      execFileSync("git", ["add", "packages/runtime/src/index.ts"], { cwd: repoRoot });

      expect(collectLegacyNamespaceReferences(repoRoot)).toEqual([
        `packages/runtime/src/index.ts:1: export { ready } from "${"@spine-" + "ts/"}core";`,
      ]);
    });
  });

  it("rejects a legacy package scope before accepting an otherwise valid runtime package", () => {
    withTempRepository((repoRoot) => {
      writeRuntimePackage(repoRoot);
      mkdirSync(join(repoRoot, "packages", "runtime", "src"), { recursive: true });
      writeFileSync(
        join(repoRoot, "packages", "runtime", "src", "index.ts"),
        `export { ready } from "${"@spine-" + "ts/"}core";\n`,
      );
      execFileSync("git", ["add", "packages/runtime"], { cwd: repoRoot });

      expect(() => runReleaseReadiness(repoRoot)).toThrow(
        `Legacy package namespace: packages/runtime/src/index.ts:1: export { ready } from "${
          "@spine-" + "ts/"
        }core";`,
      );
    });
  });

  it("enumerates fixed and both generated Proto wildcard export spellings", () => {
    withTempRepository((repoRoot) => {
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
  });

  it("collects supported inline and reference-definition targets outside code", () => {
    withTempRepository((repoRoot) => {
      mkdirSync(join(repoRoot, "docs"), { recursive: true });
      writeFileSync(
        join(repoRoot, "docs", "README.md"),
        [
          "[inline](guide.md#section)",
          '[inline with title](title.md "Title")',
          "[reference use][reference]",
          '[reference]: reference.md?raw=1 "Title"',
          "[angled]: <angled.md#section>",
          "`[ignored inline](missing-inline.md)`",
          "`[ignored reference]: missing-reference.md`",
          "[url](https://example.test/guide.md)",
          "[anchor](#local)",
          "[absolute evidence](/private/tmp/old-evidence.md)",
          "[scheme](mailto:team@example.test)",
          "```md",
          "[ignored fenced](missing-fenced.md)",
          "[ignored-fenced-reference]: missing-fenced-reference.md",
          "```",
        ].join("\n"),
      );
      execFileSync("git", ["add", "docs/README.md"], { cwd: repoRoot });

      expect(collectMarkdownRelativeLinks(repoRoot)).toEqual([
        {
          sourcePath: "docs/README.md",
          targetPath: "angled.md",
        },
        {
          sourcePath: "docs/README.md",
          targetPath: "guide.md",
        },
        {
          sourcePath: "docs/README.md",
          targetPath: "reference.md",
        },
        {
          sourcePath: "docs/README.md",
          targetPath: "title.md",
        },
      ]);
    });
  });

  it("reports a tracked broken Markdown source and target after package self-import succeeds", () => {
    withTempRepository((repoRoot) => {
      writeRuntimePackage(repoRoot);
      mkdirSync(join(repoRoot, "docs"), { recursive: true });
      writeFileSync(join(repoRoot, "docs", "README.md"), "[missing](missing.md)\n");
      execFileSync("git", ["add", "docs/README.md"], { cwd: repoRoot });

      const failure = captureFailure(() => runReleaseReadiness(repoRoot));

      expect(failure).toBeInstanceOf(Error);
      expect(failure.message).toContain("Broken Markdown link: docs/README.md -> missing.md");
      expect(failure.message).not.toContain("Broken package export");
    });
  });

  it("rejects a Markdown target that resolves outside the repository", () => {
    withTempRepository((repoRoot) => {
      writeRuntimePackage(repoRoot);
      mkdirSync(join(repoRoot, "docs"), { recursive: true });
      writeFileSync(join(repoRoot, "docs", "README.md"), "[outside](../../outside.md)\n");
      execFileSync("git", ["add", "docs/README.md"], { cwd: repoRoot });

      const failure = captureFailure(() => runReleaseReadiness(repoRoot));

      expect(failure).toBeInstanceOf(Error);
      expect(failure.message).toContain(
        "Escaping Markdown link: docs/README.md -> ../../outside.md",
      );
    });
  });

  it("reports package directory and specifier for a broken runtime export", () => {
    withTempRepository((repoRoot) => {
      writeRuntimePackage(repoRoot, {
        exportTarget: "./dist/missing.js",
        source: undefined,
      });

      const failure = captureFailure(() => runReleaseReadiness(repoRoot));

      expect(failure).toBeInstanceOf(Error);
      expect(failure.message).toContain(
        "Broken package export: packages/runtime: @example/runtime",
      );
    });
  });

  it("times out a non-terminating package export with an actionable diagnostic", () => {
    withTempRepository((repoRoot) => {
      writeRuntimePackage(repoRoot, {
        source: [
          'import { writeFileSync } from "node:fs";',
          'process.on("SIGTERM", () => {});',
          'writeFileSync(new URL("../../../import-ready", import.meta.url), "ready");',
          "setTimeout(() => process.exit(0), 1_000);",
          "await new Promise(() => {});",
        ].join("\n"),
      });
      const readinessMarker = join(repoRoot, "import-ready");
      const startedAt = Date.now();

      const failure = captureFailure(() => runReleaseReadiness(repoRoot, { importTimeoutMs: 250 }));

      expect(Date.now() - startedAt).toBeLessThan(600);
      expect(failure).toBeInstanceOf(Error);
      expect(failure.message).toContain(
        "Timed out package export after 250 ms: packages/runtime: @example/runtime",
      );
      expect(existsSync(readinessMarker)).toBe(true);
    });
  });
});
