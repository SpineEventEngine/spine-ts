import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareGeneratedOutput, publishGeneratedTargets } from "./proto-workflow.mjs";

describe("proto-workflow", () => {
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
