import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanupStagedTargets,
  generateTargets,
  prepareGeneratedOutput,
  publishGeneratedTargets,
  stageGeneratedTargets,
  writeStagedTemplate,
} from "./proto-workflow.mjs";
import { writeSpineProtoArtifacts } from "./generate-spine-proto-artifacts.mjs";

function workflowClaimOperations(claims, liveness) {
  return {
    create(path, content) {
      const name = basename(path);
      if (claims.has(name)) throw new Error("exists");
      claims.set(name, { content, kind: "regular" });
    },
    list() {
      return [...claims.keys()];
    },
    read(path) {
      return claims.get(basename(path)).content;
    },
    inspect(path) {
      return claims.get(basename(path)).kind;
    },
    remove(path) {
      claims.delete(basename(path));
    },
    liveness,
  };
}

describe("proto-workflow", () => {
  it("keeps frozen-source lint ignores scoped away from authored modules", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-lint-scope-"));
    const modulePaths = [
      "packages/proto/proto",
      "examples/todo/proto",
      "examples/project-management/proto",
      "examples/datastore-orders/proto",
    ];

    for (const modulePath of modulePaths) {
      mkdirSync(join(repoRoot, modulePath), { recursive: true });
    }

    writeFileSync(join(repoRoot, "buf.yaml"), readFileSync("buf.yaml", "utf8"));
    const frozenHealthRoot = join(repoRoot, "packages/proto/proto/grpc/health/v1");
    mkdirSync(frozenHealthRoot, { recursive: true });
    writeFileSync(
      join(frozenHealthRoot, "health.proto"),
      'syntax = "proto3";\npackage grpc.health.v1;\nservice Health {}\n',
    );
    const validExampleModules = [
      [
        "examples/project-management/proto/spine/example/project_management/v1",
        "project_management",
      ],
      ["examples/datastore-orders/proto/spine/example/datastore_orders/v1", "datastore_orders"],
    ];
    for (const [directory, packageSegment] of validExampleModules) {
      const absoluteDirectory = join(repoRoot, directory);
      mkdirSync(absoluteDirectory, { recursive: true });
      writeFileSync(
        join(absoluteDirectory, "fixture.proto"),
        `syntax = "proto3";\npackage spine.example.${packageSegment}.v1;\n`,
      );
    }

    const authoredRoot = join(repoRoot, "examples/todo/proto");
    const packageRoot = join(authoredRoot, "spine/example/todo/v1");
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(packageRoot, "service.proto"),
      'syntax = "proto3";\npackage spine.example.todo.v1;\nservice Todo {}\n',
    );
    writeFileSync(
      join(packageRoot, "first.proto"),
      'syntax = "proto3";\npackage spine.example.todo.v1;\noption java_multiple_files = true;\n',
    );
    writeFileSync(
      join(packageRoot, "second.proto"),
      'syntax = "proto3";\npackage spine.example.todo.v1;\n',
    );
    mkdirSync(join(authoredRoot, "alternate"), { recursive: true });
    writeFileSync(
      join(authoredRoot, "alternate/shared.proto"),
      'syntax = "proto3";\npackage spine.example.todo.v1;\n',
    );

    const result = spawnSync(
      join(process.cwd(), "node_modules/.bin/buf"),
      ["lint", "--error-format=json"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    const findings = `${result.stdout}\n${result.stderr}`
      .trim()
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));

    expect(result.status).not.toBe(0);
    expect(findings.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        "SERVICE_SUFFIX",
        "PACKAGE_DIRECTORY_MATCH",
        "PACKAGE_SAME_DIRECTORY",
        "PACKAGE_SAME_JAVA_MULTIPLE_FILES",
      ]),
    );
    expect(findings.every(({ path }) => path.startsWith("examples/todo/proto/"))).toBe(true);
  });

  it("stages every plugin output for a generated target", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const stageRoot = join(repoRoot, "packages/proto/.generated-test");
    const stagedOutputRoot = join(stageRoot, "generated");

    mkdirSync(stageRoot, { recursive: true });
    writeFileSync(
      join(repoRoot, "buf.gen.yaml"),
      "version: v2\nplugins:\n  - local: protoc-gen-es\n    out: packages/proto/generated\n" +
        "  - local: protoc-gen-spine-rejections\n    out: packages/proto/generated\n",
    );

    const stagedTemplate = writeStagedTemplate(
      { displayPath: "packages/proto/generated", templatePath: "buf.gen.yaml" },
      stagedOutputRoot,
      stageRoot,
      repoRoot,
    );

    expect(readFileSync(stagedTemplate, "utf8")).not.toContain("packages/proto/generated");
    expect(readFileSync(stagedTemplate, "utf8").match(/out: .*generated/g)).toHaveLength(2);
  });

  it("refuses to prepare generated output through a symlinked ancestor", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const linkedProtoRoot = mkdtempSync(join(tmpdir(), "spine-linked-proto-"));
    const externalGenerated = join(linkedProtoRoot, "generated");

    mkdirSync(join(repoRoot, "packages"), { recursive: true });
    mkdirSync(externalGenerated, { recursive: true });
    writeFileSync(join(externalGenerated, "keep.txt"), "external output\n");
    symlinkSync(linkedProtoRoot, join(repoRoot, "packages/proto"), "dir");

    expect(prepareGeneratedOutput(repoRoot)).toBe(1);
    expect(existsSync(externalGenerated)).toBe(true);
    expect(readFileSync(join(externalGenerated, "keep.txt"), "utf8")).toBe("external output\n");
  });

  it("keeps live generated output until replacement output is ready", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const packageGenerated = join(repoRoot, "packages/proto/generated");
    const todoGenerated = join(repoRoot, "examples/todo/generated");

    mkdirSync(packageGenerated, { recursive: true });
    mkdirSync(todoGenerated, { recursive: true });
    writeFileSync(join(packageGenerated, "keep.txt"), "package output\n");
    writeFileSync(join(todoGenerated, "keep.txt"), "todo output\n");

    expect(prepareGeneratedOutput(repoRoot)).toBe(0);
    expect(readFileSync(join(packageGenerated, "keep.txt"), "utf8")).toBe("package output\n");
    expect(readFileSync(join(todoGenerated, "keep.txt"), "utf8")).toBe("todo output\n");
  });

  it("publishes staged generated files by same-parent rename without exposing a partial tree", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const generatedRoot = join(repoRoot, "packages/proto/generated");
    const stageRoot = join(repoRoot, "packages/proto/.generated-test");
    const stagedOutputRoot = join(stageRoot, "output");
    const orphanedDirectory = join(generatedRoot, "orphaned");
    let observedGeneratedRootDuringPublish = true;

    mkdirSync(generatedRoot, { recursive: true });
    mkdirSync(orphanedDirectory, { recursive: true });
    mkdirSync(stagedOutputRoot, { recursive: true });
    writeFileSync(join(generatedRoot, "message.txt"), "previous output\n");
    writeFileSync(join(orphanedDirectory, "stale.txt"), "orphaned output\n");
    writeFileSync(join(stagedOutputRoot, "message.txt"), "next output\n");

    publishGeneratedTargets(
      [
        {
          generatedRoot,
          stagedOutputRoot,
          stageRoot,
          target: {
            displayPath: "packages/proto/generated",
          },
        },
      ],
      repoRoot,
      {
        afterBackup: () => {
          observedGeneratedRootDuringPublish = existsSync(generatedRoot);
        },
      },
    );

    expect(observedGeneratedRootDuringPublish).toBe(false);
    expect(existsSync(generatedRoot)).toBe(true);
    expect(readFileSync(join(generatedRoot, "message.txt"), "utf8")).toBe("next output\n");
    expect(existsSync(orphanedDirectory)).toBe(false);
    expect(readdirSync(join(repoRoot, "packages/proto"))).not.toContain(
      expect.stringMatching(/^\.generated\.backup-/u),
    );
  });

  it("rejects staged generated modules that do not exactly match owned Proto sources", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-artifacts-"));
    const packageRoot = join(repoRoot, "packages/proto");
    const protoRoot = join(packageRoot, "proto");
    const generatedRoot = join(packageRoot, "generated");
    mkdirSync(join(protoRoot, "model"), { recursive: true });
    mkdirSync(join(generatedRoot, "model"), { recursive: true });
    writeFileSync(
      join(packageRoot, "spine-proto.json"),
      JSON.stringify({
        formatVersion: 1,
        mode: "model",
        protoRoot: "proto",
        exportRoot: "generated",
        dependencies: [],
        moduleExport: "spineProtoModule",
      }),
    );
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({ name: "@example/proto", version: "1.0.0" }),
    );
    writeFileSync(join(protoRoot, "model/value.proto"), 'syntax = "proto3";');
    writeFileSync(join(generatedRoot, "model/extra_pb.ts"), "export {};\n");

    expect(() =>
      writeSpineProtoArtifacts(repoRoot, generatedRoot, join(packageRoot, "manifest.json")),
    ).toThrow("generated Protobuf modules must exactly match owned Proto sources");
    expect(existsSync(join(packageRoot, "manifest.json"))).toBe(false);
    expect(existsSync(join(generatedRoot, "proto-module.ts"))).toBe(false);
  });

  it("keeps live generated output when replacement output is not ready", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const generatedRoot = join(repoRoot, "packages/proto/generated");
    const stageRoot = join(repoRoot, "packages/proto/.generated-test");
    const stagedOutputRoot = join(stageRoot, "output");

    mkdirSync(generatedRoot, { recursive: true });
    mkdirSync(stageRoot, { recursive: true });
    writeFileSync(join(generatedRoot, "message.txt"), "previous output\n");

    expect(() =>
      publishGeneratedTargets(
        [
          {
            generatedRoot,
            stagedOutputRoot,
            stageRoot,
            target: {
              displayPath: "packages/proto/generated",
            },
          },
        ],
        repoRoot,
      ),
    ).toThrow();

    expect(existsSync(generatedRoot)).toBe(true);
    expect(readFileSync(join(generatedRoot, "message.txt"), "utf8")).toBe("previous output\n");
  });

  it("restores generated output when final publication fails", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const generatedRoot = join(repoRoot, "packages/proto/generated");
    const stageRoot = join(repoRoot, "packages/proto/.generated-test");
    const stagedOutputRoot = join(stageRoot, "output");

    mkdirSync(generatedRoot, { recursive: true });
    mkdirSync(stagedOutputRoot, { recursive: true });
    writeFileSync(join(generatedRoot, "message.txt"), "previous output\n");
    writeFileSync(join(stagedOutputRoot, "message.txt"), "next output\n");

    expect(() =>
      publishGeneratedTargets(
        [
          {
            generatedRoot,
            stagedOutputRoot,
            stageRoot,
            target: { displayPath: "packages/proto/generated" },
          },
        ],
        repoRoot,
        {
          beforeFinalize: () => {
            throw new Error("manifest replacement failed");
          },
        },
      ),
    ).toThrow("manifest replacement failed");

    expect(readFileSync(join(generatedRoot, "message.txt"), "utf8")).toBe("previous output\n");
  });

  it("restores prior output when the staged-root rename fails", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const generatedRoot = join(repoRoot, "packages/proto/generated");
    const stageRoot = join(repoRoot, "packages/proto/.generated-test");
    const stagedOutputRoot = join(stageRoot, "output");
    mkdirSync(generatedRoot, { recursive: true });
    mkdirSync(stagedOutputRoot, { recursive: true });
    writeFileSync(join(generatedRoot, "message.txt"), "previous output\n");
    writeFileSync(join(stagedOutputRoot, "message.txt"), "next output\n");

    expect(() =>
      publishGeneratedTargets(
        [
          {
            generatedRoot,
            stagedOutputRoot,
            stageRoot,
            target: { displayPath: "packages/proto/generated" },
          },
        ],
        repoRoot,
        {
          operations: {
            rename(from, to) {
              if (from === stagedOutputRoot && to === generatedRoot)
                throw new Error("staged rename failed");
              renameSync(from, to);
            },
          },
        },
      ),
    ).toThrow("staged rename failed");
    expect(readFileSync(join(generatedRoot, "message.txt"), "utf8")).toBe("previous output\n");
    expect(existsSync(join(repoRoot, ".spine-proto-publication.json"))).toBe(false);
  });

  it("removes first-publication output when finalization fails", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const generatedRoot = join(repoRoot, "packages/proto/generated");
    const stageRoot = join(repoRoot, "packages/proto/.generated-test");
    const stagedOutputRoot = join(stageRoot, "output");
    mkdirSync(stagedOutputRoot, { recursive: true });
    writeFileSync(join(stagedOutputRoot, "message.txt"), "first output\n");

    expect(() =>
      publishGeneratedTargets(
        [
          {
            generatedRoot,
            stagedOutputRoot,
            stageRoot,
            target: { displayPath: "packages/proto/generated" },
          },
        ],
        repoRoot,
        {
          beforeFinalize: () => {
            throw new Error("finalization failed");
          },
        },
      ),
    ).toThrow("finalization failed");
    expect(existsSync(generatedRoot)).toBe(false);
    expect(existsSync(join(repoRoot, ".spine-proto-publication.json"))).toBe(false);
  });

  it("retains a committed publication journal when cleanup fails and completes it on recovery", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const generatedRoot = join(repoRoot, "packages/proto/generated");
    const stageRoot = join(repoRoot, "packages/proto/.generated-test");
    const stagedOutputRoot = join(stageRoot, "output");
    const manifest = join(repoRoot, "packages/proto/spine-proto-manifest.json");
    const stagedManifest = join(stageRoot, "spine-proto-manifest.json");
    mkdirSync(generatedRoot, { recursive: true });
    mkdirSync(stagedOutputRoot, { recursive: true });
    writeFileSync(join(generatedRoot, "message.txt"), "previous output\n");
    writeFileSync(join(stagedOutputRoot, "message.txt"), "next output\n");
    writeFileSync(manifest, "previous manifest\n");
    writeFileSync(stagedManifest, "next manifest\n");
    let failCleanup = true;

    expect(() =>
      publishGeneratedTargets(
        [
          {
            generatedRoot,
            stagedOutputRoot,
            stageRoot,
            target: { displayPath: "packages/proto/generated" },
          },
        ],
        repoRoot,
        {
          manifest: {
            target: manifest,
            staged: stagedManifest,
            backup: join(repoRoot, "packages/proto/.spine-proto-manifest.backup-test"),
            hadPrevious: true,
            contents: "next manifest\n",
          },
          operations: {
            remove(path) {
              if (failCleanup && path.includes(".generated.backup-"))
                throw new Error("cleanup failed");
              rmSync(path, { recursive: true, force: true });
            },
          },
        },
      ),
    ).toThrow("cleanup failed");

    expect(readFileSync(join(generatedRoot, "message.txt"), "utf8")).toBe("next output\n");
    expect(readFileSync(manifest, "utf8")).toBe("next manifest\n");
    expect(existsSync(join(repoRoot, ".spine-proto-publication.json"))).toBe(true);

    failCleanup = false;
    publishGeneratedTargets([], repoRoot);
    expect(existsSync(join(repoRoot, ".spine-proto-publication.json"))).toBe(false);
    expect(readFileSync(join(generatedRoot, "message.txt"), "utf8")).toBe("next output\n");
    expect(readFileSync(manifest, "utf8")).toBe("next manifest\n");
  });

  it("rolls back a preparing partial swap even when the deterministic manifest is unchanged", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const packageRoot = join(repoRoot, "packages/proto");
    const generatedRoot = join(packageRoot, "generated");
    const stageRoot = join(packageRoot, ".generated-interrupted");
    const stagedOutputRoot = join(stageRoot, "generated");
    const backup = join(packageRoot, ".generated.backup-interrupted");
    const manifest = join(packageRoot, "spine-proto-manifest.json");
    const stagedManifest = join(stageRoot, "spine-proto-manifest.json");
    const manifestBackup = join(packageRoot, ".spine-proto-manifest.backup-interrupted");
    const contents = "unchanged manifest\n";
    mkdirSync(generatedRoot, { recursive: true });
    mkdirSync(backup, { recursive: true });
    mkdirSync(stagedOutputRoot, { recursive: true });
    writeFileSync(join(generatedRoot, "message.txt"), "new output\n");
    writeFileSync(join(backup, "message.txt"), "previous output\n");
    writeFileSync(manifest, contents);
    writeFileSync(stagedManifest, contents);
    writeFileSync(
      join(repoRoot, ".spine-proto-publication.json"),
      `${JSON.stringify({
        version: 1,
        state: "preparing",
        targets: [{ target: generatedRoot, staged: stagedOutputRoot, backup, hadPrevious: true }],
        manifest: {
          target: manifest,
          staged: stagedManifest,
          backup: manifestBackup,
          hadPrevious: true,
          contents,
        },
      })}\n`,
    );

    publishGeneratedTargets([], repoRoot);

    expect(readFileSync(join(generatedRoot, "message.txt"), "utf8")).toBe("previous output\n");
    expect(readFileSync(manifest, "utf8")).toBe(contents);
  });

  it("rejects a forged journal before it can touch paths outside generated targets", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const outside = join(repoRoot, "outside.txt");
    writeFileSync(outside, "keep\n");
    writeFileSync(
      join(repoRoot, ".spine-proto-publication.json"),
      `${JSON.stringify({
        version: 1,
        state: "committed",
        targets: [
          {
            target: outside,
            staged: join(repoRoot, "staged"),
            backup: join(repoRoot, "backup"),
            hadPrevious: true,
          },
        ],
      })}\n`,
    );

    expect(() => publishGeneratedTargets([], repoRoot)).toThrow("invalid publication journal");
    expect(readFileSync(outside, "utf8")).toBe("keep\n");
  });

  it("rejects a live second generator before it can touch its journal or staging", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const claims = new Map([
      [
        ".spine-proto-workflow.lock.live",
        { content: JSON.stringify({ pid: 77, token: "live" }), kind: "regular" },
      ],
    ]);
    writeFileSync(join(repoRoot, ".spine-proto-publication.json"), "first writer journal\n");

    expect(
      generateTargets({
        repoRoot,
        lockOperations: workflowClaimOperations(claims, () => "alive"),
      }),
    ).toBe(1);
    expect(readFileSync(join(repoRoot, ".spine-proto-publication.json"), "utf8")).toBe(
      "first writer journal\n",
    );
    expect(existsSync(join(repoRoot, "packages/proto/generated"))).toBe(false);
    expect([...claims.keys()]).toEqual([".spine-proto-workflow.lock.live"]);
  });

  it("acquires generate ownership before preparing live generated roots", () => {
    const source = readFileSync(new URL("./proto-workflow.mjs", import.meta.url), "utf8");
    const ownership = source.indexOf("lock = acquireWorkflowLock(root, options.lockOperations)");
    const preparation = source.indexOf("const prepareStatus = prepareGeneratedOutput(root);");

    expect(source).toContain('if (command === "generate") return generateTargets();');
    expect(ownership).toBeGreaterThanOrEqual(0);
    expect(preparation).toBeGreaterThan(ownership);
  });

  it.each([
    ["dead", "dead", "regular"],
    ["indeterminate", "indeterminate", "regular"],
    ["unsafe", "dead", "symlink"],
  ])("handles a %s workflow claim without touching another claim", (_name, liveness, kind) => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const claims = new Map([
      [
        ".spine-proto-workflow.lock.existing",
        { content: JSON.stringify({ pid: 78, token: "existing" }), kind },
      ],
    ]);

    const status = generateTargets({
      repoRoot,
      lockOperations: workflowClaimOperations(claims, () => liveness),
    });

    if (liveness === "dead" && kind === "regular") expect([...claims.keys()]).toEqual([]);
    else expect([...claims.keys()]).toEqual([".spine-proto-workflow.lock.existing"]);
    expect(status).toBe(1);
  });

  it("rejects a symlinked recovery backup before mutating a journal target", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const packageRoot = join(repoRoot, "packages/proto");
    const generatedRoot = join(packageRoot, "generated");
    const stageRoot = join(packageRoot, ".generated-poisoned");
    const stagedOutputRoot = join(stageRoot, "generated");
    const backup = join(packageRoot, ".generated.backup-poisoned");
    const external = mkdtempSync(join(tmpdir(), "spine-external-generated-"));
    mkdirSync(generatedRoot, { recursive: true });
    mkdirSync(stagedOutputRoot, { recursive: true });
    writeFileSync(join(generatedRoot, "message.txt"), "new output\n");
    symlinkSync(external, backup, "dir");
    writeFileSync(
      join(repoRoot, ".spine-proto-publication.json"),
      `${JSON.stringify({
        version: 1,
        state: "preparing",
        targets: [{ target: generatedRoot, staged: stagedOutputRoot, backup, hadPrevious: true }],
      })}\n`,
    );

    expect(() => publishGeneratedTargets([], repoRoot)).toThrow(
      "unsafe publication recovery entry",
    );
    expect(readFileSync(join(generatedRoot, "message.txt"), "utf8")).toBe("new output\n");
    rmSync(external, { recursive: true, force: true });
  });

  it("does not publish staged protobuf output when handler registry generation fails", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const packageGenerated = join(repoRoot, "packages/proto/generated");
    const todoGenerated = join(repoRoot, "examples/todo/generated");
    const projectGenerated = join(repoRoot, "examples/project-management/generated");
    const datastoreOrdersGenerated = join(repoRoot, "examples/datastore-orders/generated");
    const commands = [];

    mkdirSync(packageGenerated, { recursive: true });
    mkdirSync(todoGenerated, { recursive: true });
    mkdirSync(projectGenerated, { recursive: true });
    mkdirSync(datastoreOrdersGenerated, { recursive: true });
    mkdirSync(join(repoRoot, "examples/todo"), { recursive: true });
    mkdirSync(join(repoRoot, "examples/project-management"), { recursive: true });
    mkdirSync(join(repoRoot, "examples/datastore-orders"), { recursive: true });
    writeFileSync(
      join(repoRoot, "buf.gen.yaml"),
      "version: v2\nplugins:\n  - local: protoc-gen-es\n    out: packages/proto/generated\n",
    );
    writeFileSync(
      join(repoRoot, "examples/todo/buf.gen.yaml"),
      "version: v2\nplugins:\n  - local: protoc-gen-es\n    out: examples/todo/generated\n",
    );
    writeFileSync(
      join(repoRoot, "examples/project-management/buf.gen.yaml"),
      "version: v2\nplugins:\n  - local: protoc-gen-es\n    out: examples/project-management/generated\n",
    );
    writeFileSync(
      join(repoRoot, "examples/datastore-orders/buf.gen.yaml"),
      "version: v2\nplugins:\n  - local: protoc-gen-es\n    out: examples/datastore-orders/generated\n",
    );
    writeFileSync(join(packageGenerated, "message.txt"), "previous package output\n");
    writeFileSync(join(todoGenerated, "message.txt"), "previous todo output\n");

    const status = generateTargets({
      repoRoot,
      runCommand(label, _executable, args) {
        commands.push(label);

        if (label.startsWith("buf generate")) {
          const templatePath = args.at(-1);
          const outputPath = readFileSync(templatePath, "utf8").match(/^\s*out:\s*(.+)$/mu)?.[1];

          if (outputPath === undefined) {
            return 1;
          }

          mkdirSync(outputPath, { recursive: true });
          writeFileSync(join(outputPath, "message.txt"), `${label} staged output\n`);
          return 0;
        }

        return 1;
      },
    });

    expect(status).toBe(1);
    expect(commands).toEqual([
      "buf generate packages/proto/generated",
      "buf generate examples/todo/generated",
      "buf generate examples/project-management/generated",
      "buf generate examples/datastore-orders/generated",
      "todo handler registry generation",
    ]);
    expect(readFileSync(join(packageGenerated, "message.txt"), "utf8")).toBe(
      "previous package output\n",
    );
    expect(readFileSync(join(todoGenerated, "message.txt"), "utf8")).toBe("previous todo output\n");
  });

  it("stages generated output without publishing it", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const packageGenerated = join(repoRoot, "packages/proto/generated");
    const todoGenerated = join(repoRoot, "examples/todo/generated");
    const projectGenerated = join(repoRoot, "examples/project-management/generated");
    const datastoreOrdersGenerated = join(repoRoot, "examples/datastore-orders/generated");
    const commands = [];

    mkdirSync(packageGenerated, { recursive: true });
    mkdirSync(todoGenerated, { recursive: true });
    mkdirSync(projectGenerated, { recursive: true });
    mkdirSync(datastoreOrdersGenerated, { recursive: true });
    mkdirSync(join(repoRoot, "examples/todo"), { recursive: true });
    mkdirSync(join(repoRoot, "examples/project-management"), { recursive: true });
    mkdirSync(join(repoRoot, "examples/datastore-orders"), { recursive: true });
    writeFileSync(
      join(repoRoot, "buf.gen.yaml"),
      "version: v2\nplugins:\n  - local: protoc-gen-es\n    out: packages/proto/generated\n",
    );
    writeFileSync(
      join(repoRoot, "examples/todo/buf.gen.yaml"),
      "version: v2\nplugins:\n  - local: protoc-gen-es\n    out: examples/todo/generated\n",
    );
    writeFileSync(
      join(repoRoot, "examples/project-management/buf.gen.yaml"),
      "version: v2\nplugins:\n  - local: protoc-gen-es\n    out: examples/project-management/generated\n",
    );
    writeFileSync(
      join(repoRoot, "examples/datastore-orders/buf.gen.yaml"),
      "version: v2\nplugins:\n  - local: protoc-gen-es\n    out: examples/datastore-orders/generated\n",
    );
    writeFileSync(join(packageGenerated, "message.txt"), "previous package output\n");
    writeFileSync(join(todoGenerated, "message.txt"), "previous todo output\n");

    const staged = stageGeneratedTargets({
      repoRoot,
      runCommand(label, _executable, args) {
        commands.push(label);

        if (label.startsWith("buf generate")) {
          const templatePath = args.at(-1);
          const outputPath = readFileSync(templatePath, "utf8").match(/^\s*out:\s*(.+)$/mu)?.[1];

          if (outputPath === undefined) {
            return 1;
          }

          mkdirSync(outputPath, { recursive: true });
          writeFileSync(join(outputPath, "message.txt"), `${label} staged output\n`);
          return 0;
        }

        const outputPath = args[args.indexOf("--out") + 1];

        if (outputPath === undefined) {
          return 1;
        }

        mkdirSync(join(outputPath, ".."), { recursive: true });
        writeFileSync(outputPath, "export const generatedHandlerRegistry = { version: 1 };\n");
        return 0;
      },
    });

    try {
      expect(staged.status).toBe(0);
      expect(commands).toEqual([
        "buf generate packages/proto/generated",
        "buf generate examples/todo/generated",
        "buf generate examples/project-management/generated",
        "buf generate examples/datastore-orders/generated",
        "todo handler registry generation",
        "project-management handler registry generation",
        "datastore-orders handler registry generation",
      ]);
      expect(readFileSync(join(packageGenerated, "message.txt"), "utf8")).toBe(
        "previous package output\n",
      );
      expect(readFileSync(join(todoGenerated, "message.txt"), "utf8")).toBe(
        "previous todo output\n",
      );
      expect(
        readFileSync(join(staged.stagedTargets[0].stagedOutputRoot, "message.txt"), "utf8"),
      ).toBe("buf generate packages/proto/generated staged output\n");
      expect(
        existsSync(
          join(staged.stagedTargets[1].stagedOutputRoot, "handler/generated-handler-registry.ts"),
        ),
      ).toBe(true);
      expect(
        existsSync(
          join(staged.stagedTargets[2].stagedOutputRoot, "handler/generated-handler-registry.ts"),
        ),
      ).toBe(true);
      expect(
        existsSync(
          join(staged.stagedTargets[3].stagedOutputRoot, "handler/generated-handler-registry.ts"),
        ),
      ).toBe(true);
    } finally {
      cleanupStagedTargets(staged.stagedTargets);
    }
  });

  it("restores already-published roots when a later publish fails", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const packageGenerated = join(repoRoot, "packages/proto/generated");
    const todoGenerated = join(repoRoot, "examples/todo/generated");
    const packageStageRoot = join(repoRoot, "packages/proto/.generated-test");
    const todoStageRoot = join(repoRoot, "examples/todo/.generated-test");
    const packageStagedOutputRoot = join(packageStageRoot, "output");
    const todoStagedOutputRoot = join(todoStageRoot, "output");

    mkdirSync(packageGenerated, { recursive: true });
    mkdirSync(todoGenerated, { recursive: true });
    mkdirSync(packageStagedOutputRoot, { recursive: true });
    mkdirSync(todoStageRoot, { recursive: true });
    writeFileSync(join(packageGenerated, "message.txt"), "previous package output\n");
    writeFileSync(join(todoGenerated, "message.txt"), "previous todo output\n");
    writeFileSync(join(packageStagedOutputRoot, "message.txt"), "next package output\n");

    expect(() =>
      publishGeneratedTargets(
        [
          {
            generatedRoot: packageGenerated,
            stagedOutputRoot: packageStagedOutputRoot,
            stageRoot: packageStageRoot,
            target: {
              displayPath: "packages/proto/generated",
            },
          },
          {
            generatedRoot: todoGenerated,
            stagedOutputRoot: todoStagedOutputRoot,
            stageRoot: todoStageRoot,
            target: {
              displayPath: "examples/todo/generated",
            },
          },
        ],
        repoRoot,
      ),
    ).toThrow();

    expect(existsSync(packageGenerated)).toBe(true);
    expect(existsSync(todoGenerated)).toBe(true);
    expect(readFileSync(join(packageGenerated, "message.txt"), "utf8")).toBe(
      "previous package output\n",
    );
    expect(readFileSync(join(todoGenerated, "message.txt"), "utf8")).toBe("previous todo output\n");
  });

  it("refuses staged generated output containing symlinks", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const generatedRoot = join(repoRoot, "packages/proto/generated");
    const stageRoot = join(repoRoot, "packages/proto/.generated-test");
    const stagedOutputRoot = join(stageRoot, "output");
    const externalRoot = mkdtempSync(join(tmpdir(), "spine-external-generated-"));

    mkdirSync(generatedRoot, { recursive: true });
    mkdirSync(stagedOutputRoot, { recursive: true });
    writeFileSync(join(generatedRoot, "message.txt"), "previous output\n");
    writeFileSync(join(externalRoot, "message.txt"), "external output\n");
    symlinkSync(join(externalRoot, "message.txt"), join(stagedOutputRoot, "message.txt"));

    expect(() =>
      publishGeneratedTargets(
        [
          {
            generatedRoot,
            stagedOutputRoot,
            stageRoot,
            target: {
              displayPath: "packages/proto/generated",
            },
          },
        ],
        repoRoot,
      ),
    ).toThrow("Staged generated output must not contain symlinks");

    expect(existsSync(generatedRoot)).toBe(true);
    expect(readFileSync(join(generatedRoot, "message.txt"), "utf8")).toBe("previous output\n");

    rmSync(externalRoot, { recursive: true, force: true });
  });
});
