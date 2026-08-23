import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectAssetExportTargets,
  collectLegacyNamespaceReferences,
  collectMarkdownRelativeLinks,
  collectRuntimeExportSpecifiers,
  collectUserFacingDocumentationProblems,
  collectUserFacingMarkdownFiles,
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

  it("ignores an untracked scratch file with a legacy package scope", () => {
    withTempRepository((repoRoot) => {
      writeRuntimePackage(repoRoot);
      execFileSync("git", ["add", "packages/runtime"], { cwd: repoRoot });
      writeFileSync(join(repoRoot, "scratch.md"), `Temporary note: ${"@spine-" + "ts/"}core\n`);

      expect(() => runReleaseReadiness(repoRoot)).not.toThrow();
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

  it("enumerates static package assets without treating them as JavaScript imports", () => {
    withTempRepository((repoRoot) => {
      const packageRoot = join(repoRoot, "packages", "proto");
      mkdirSync(join(packageRoot, "proto", "spine"), { recursive: true });
      writeJson(join(packageRoot, "package.json"), {
        name: "@example/proto",
        exports: {
          ".": "./dist/index.js",
          "./spine-proto-manifest.json": "./spine-proto-manifest.json",
          "./proto/*": "./proto/*",
        },
      });
      writeJson(join(packageRoot, "spine-proto-manifest.json"), { schemaVersion: 1 });
      writeFileSync(join(packageRoot, "proto", "spine", "command.proto"), 'syntax = "proto3";\n');

      expect(collectRuntimeExportSpecifiers(repoRoot)).toEqual([
        {
          packageDirectory: "packages/proto",
          specifier: "@example/proto",
        },
      ]);
      expect(collectAssetExportTargets(repoRoot)).toEqual([
        {
          packageDirectory: "packages/proto",
          subpath: "./proto/spine/command.proto",
          target: "./proto/spine/command.proto",
        },
        {
          packageDirectory: "packages/proto",
          subpath: "./spine-proto-manifest.json",
          target: "./spine-proto-manifest.json",
        },
      ]);
    });
  });

  it("reports a missing fixed package asset export", () => {
    withTempRepository((repoRoot) => {
      const packageRoot = join(repoRoot, "packages", "assets");
      mkdirSync(packageRoot, { recursive: true });
      writeJson(join(packageRoot, "package.json"), {
        name: "@example/assets",
        exports: {
          "./manifest.json": "./missing-manifest.json",
        },
      });

      expect(() => runReleaseReadiness(repoRoot)).toThrow(
        "Broken package asset export: packages/assets: ./manifest.json -> ./missing-manifest.json",
      );
    });
  });

  it("collects supported inline and reference-definition targets outside code", () => {
    withTempRepository((repoRoot) => {
      mkdirSync(join(repoRoot, "docs"), { recursive: true });
      mkdirSync(join(repoRoot, "docs", "api", "reference"), { recursive: true });
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

  it("discovers reader documentation while excluding protocol and protected records", () => {
    withTempRepository((repoRoot) => {
      mkdirSync(join(repoRoot, "docs"), { recursive: true });
      mkdirSync(join(repoRoot, "docs", "api", "reference"), { recursive: true });
      mkdirSync(join(repoRoot, "build-protocol"), { recursive: true });
      writeFileSync(join(repoRoot, "README.md"), "# Reader\n");
      writeFileSync(join(repoRoot, "docs", "GUIDE.md"), "# Guide\n");
      writeFileSync(join(repoRoot, "docs", "DRAFT.md"), "# Draft\n");
      writeFileSync(join(repoRoot, "docs", "api", "reference", "generated.md"), "# Generated\n");
      writeFileSync(join(repoRoot, "build-protocol", "TASK.md"), "# Internal\n");
      writeFileSync(join(repoRoot, "human-review-1-jul.md"), "# Protected\n");
      execFileSync(
        "git",
        ["add", "README.md", "docs/GUIDE.md", "build-protocol/TASK.md", "human-review-1-jul.md"],
        { cwd: repoRoot },
      );

      expect(collectUserFacingMarkdownFiles(repoRoot)).toEqual([
        "README.md",
        "docs/DRAFT.md",
        "docs/GUIDE.md",
      ]);
    });
  });

  it("reports internal history and stale example topology in reader documentation", () => {
    withTempRepository((repoRoot) => {
      mkdirSync(join(repoRoot, "docs"), { recursive: true });
      writeFileSync(
        join(repoRoot, "docs", "GUIDE.md"),
        "Wave 4 moved examples/datastore-orders, T-0007b, and spine.example.orders.v1.\n",
      );
      execFileSync("git", ["add", "docs/GUIDE.md"], { cwd: repoRoot });

      expect(collectUserFacingDocumentationProblems(repoRoot)).toEqual([
        "docs/GUIDE.md:1: internal execution-history term: T-0007b",
        "docs/GUIDE.md:1: internal execution-history term: Wave 4",
        "docs/GUIDE.md:1: stale example topology: examples/datastore-orders",
        "docs/GUIDE.md:1: stale owned example namespace: spine.example.orders.v1",
      ]);
    });
  });

  it("reports false Chat ownership and private-package registry installation", () => {
    withTempRepository((repoRoot) => {
      writeFileSync(
        join(repoRoot, "README.md"),
        "The Chat model declares Users. Run `pnpm add @spine-event-engine/core`.\n",
      );
      execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
      expect(collectUserFacingDocumentationProblems(repoRoot)).toEqual([
        "README.md:1: false Chat multi-model association: Chat model declares Users",
        "README.md:1: misleading private-package registry installation: pnpm add @spine-event-engine/core",
      ]);
    });
  });

  it("allows explicit experimental snapshot package installation", () => {
    withTempRepository((repoRoot) => {
      writeFileSync(
        join(repoRoot, "README.md"),
        "Run pnpm add @spine-event-engine/core@2.0.0-snapshot.3.\n",
      );
      execFileSync("git", ["add", "README.md"], { cwd: repoRoot });

      expect(collectUserFacingDocumentationProblems(repoRoot)).toEqual([]);
    });
  });

  it("allows adapter and storage snapshot tokens on one install line", () => {
    withTempRepository((repoRoot) => {
      writeFileSync(
        join(repoRoot, "README.md"),
        "pnpm add @spine-event-engine/storage-datastore@snapshot @spine-event-engine/storage@snapshot\npnpm add @spine-event-engine/storage-rdbms@snapshot @spine-event-engine/storage@snapshot\n",
      );
      execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
      expect(collectUserFacingDocumentationProblems(repoRoot)).toEqual([]);
    });
  });

  it("rejects retired delivery observer and batch APIs in reader documentation", () => {
    withTempRepository((repoRoot) => {
      writeFileSync(
        join(repoRoot, "README.md"),
        [
          "The retired `onPage` callback stopped a delivery.",
          "The old `withBatchSize` builder setting is unavailable.",
          "`onStarted` follows pickup in the old prose.",
          "`onSkipped` was another retired observer hook.",
          "`onFailure` was another retired observer hook.",
          "`onCompleted` with a summary is retired.",
          "`DeliveryPage` and `DeliveryInboxWork` are removed types.",
        ].join("\n"),
      );
      execFileSync("git", ["add", "README.md"], { cwd: repoRoot });

      expect(collectUserFacingDocumentationProblems(repoRoot)).toEqual([
        "README.md:1: retired delivery page callback: onPage",
        "README.md:2: retired delivery batch-size builder: withBatchSize",
        "README.md:3: retired delivery started hook: onStarted",
        "README.md:4: retired delivery skipped hook: onSkipped",
        "README.md:5: retired delivery failure hook: onFailure",
        "README.md:6: retired delivery completed hook: onCompleted",
        "README.md:7: retired delivery inbox-work type: DeliveryInboxWork",
        "README.md:7: retired delivery page type: DeliveryPage",
      ]);
    });
  });

  it("allows retired names only in reviewed historical documentation paths", () => {
    withTempRepository((repoRoot) => {
      mkdirSync(join(repoRoot, "docs"), { recursive: true });
      writeFileSync(
        join(repoRoot, "README.md"),
        [
          "<!-- release-readiness: historical-or-migration -->",
          "The old `onPage` callback is unavailable.",
        ].join("\n"),
      );
      writeFileSync(
        join(repoRoot, "docs", "firestore-storage-extension-analysis.md"),
        "The historical migration replaces `onPage` and `DeliveryPage`.\n",
      );
      execFileSync("git", ["add", "README.md", "docs/firestore-storage-extension-analysis.md"], {
        cwd: repoRoot,
      });

      expect(collectUserFacingDocumentationProblems(repoRoot)).toEqual([
        "README.md:2: retired delivery page callback: onPage",
      ]);
    });
  });

  it("accepts an IPv4 listen address without treating it as a placeholder version", () => {
    withTempRepository((repoRoot) => {
      writeFileSync(join(repoRoot, "README.md"), "Listen on `0.0.0.0`.\n");
      execFileSync("git", ["add", "README.md"], { cwd: repoRoot });

      expect(collectUserFacingDocumentationProblems(repoRoot)).toEqual([]);
    });
  });

  it("accepts behavioral ordering and ordinary model vocabulary", () => {
    withTempRepository((repoRoot) => {
      writeFileSync(
        join(repoRoot, "README.md"),
        "Uses the first declared field, then later dispatches Users and Tasks through values.slice().\n",
      );
      execFileSync("git", ["add", "README.md"], { cwd: repoRoot });

      expect(collectUserFacingDocumentationProblems(repoRoot)).toEqual([]);
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
