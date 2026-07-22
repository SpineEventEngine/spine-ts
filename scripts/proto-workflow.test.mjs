import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanupStagedTargets,
  generateTargets,
  prepareGeneratedOutput,
  publishGeneratedTargets,
  stageGeneratedTargets,
  writeStagedTemplate,
} from "./proto-workflow.mjs";

describe("proto-workflow", () => {
  it("keeps frozen-source lint ignores scoped away from authored modules", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-lint-scope-"));
    const modulePaths = [
      "proto",
      "examples/todo/proto",
      "examples/project-management/proto",
      "examples/datastore-orders/proto",
    ];

    for (const modulePath of modulePaths) {
      mkdirSync(join(repoRoot, modulePath), { recursive: true });
    }

    writeFileSync(join(repoRoot, "buf.yaml"), readFileSync("buf.yaml", "utf8"));
    const frozenHealthRoot = join(repoRoot, "proto/grpc/health/v1");
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

  it("mirrors staged generated files into an existing generated root", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-proto-workflow-"));
    const generatedRoot = join(repoRoot, "packages/proto/generated");
    const stageRoot = join(repoRoot, "packages/proto/.generated-test");
    const stagedOutputRoot = join(stageRoot, "output");
    const orphanedDirectory = join(generatedRoot, "orphaned");
    let observedGeneratedRootDuringPublish = false;

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

    expect(observedGeneratedRootDuringPublish).toBe(true);
    expect(existsSync(generatedRoot)).toBe(true);
    expect(readFileSync(join(generatedRoot, "message.txt"), "utf8")).toBe("next output\n");
    expect(existsSync(orphanedDirectory)).toBe(false);
    expect(existsSync(join(stageRoot, "previous"))).toBe(false);
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
