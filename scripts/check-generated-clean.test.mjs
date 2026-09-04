import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkMessageBoardRegistryFresh,
  generatedTargetsForCheck,
  runGeneratedClean,
} from "./check-generated-clean.mjs";

const scriptPath = new URL("./check-generated-clean.mjs", import.meta.url).pathname;

function createFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "spine-generated-clean-"));

  run("git", ["init"], repoRoot);
  run("git", ["config", "user.email", "test@example.invalid"], repoRoot);
  run("git", ["config", "user.name", "Test User"], repoRoot);
  writeFileSync(join(repoRoot, ".gitignore"), "packages/proto/generated/\n");
  mkdirSync(join(repoRoot, "packages/proto/generated/spine/core"), { recursive: true });
  writeFileSync(
    join(repoRoot, "packages/proto/generated/spine/core/command_pb.ts"),
    "export const command = 'fresh';\n",
  );
  run("git", ["add", "."], repoRoot);
  run("git", ["commit", "-m", "fixture"], repoRoot);

  return repoRoot;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr}${result.stdout}`);
  }

  return result;
}

function runChecker(repoRoot, expectedGeneratedRoot) {
  return spawnSync(
    process.execPath,
    [scriptPath, "--repo-root", repoRoot, "--expected-generated-root", expectedGeneratedRoot],
    {
      encoding: "utf8",
    },
  );
}

function stageCurrentOutputs(repoRoot) {
  const stageRoot = mkdtempSync(join(tmpdir(), "spine-current-generated-"));
  const stagedTargets = generatedTargetsForCheck().map((target, index) => {
    const currentRoot = join(repoRoot, target.displayPath);
    const stagedOutputRoot = join(stageRoot, String(index));
    cpSync(currentRoot, stagedOutputRoot, { recursive: true });

    return { target, stagedOutputRoot };
  });

  return {
    stageGeneratedTargets: () => ({ status: 0, stagedTargets }),
    stageMessageBoardRegistry: () => undefined,
    cleanupStagedTargets: () => rmSync(stageRoot, { recursive: true, force: true }),
  };
}

function fixtureGeneratedRoots() {
  return generatedTargetsForCheck()
    .map((target) => target.displayPath)
    .filter((path) => path !== "packages/proto/generated");
}

function createCompositionFixture(compositionSource = "process.exit(1);\n") {
  const repoRoot = mkdtempSync(join(tmpdir(), "spine-check-generated-clean-"));
  run("git", ["init"], repoRoot);
  mkdirSync(join(repoRoot, "node_modules/.bin"), { recursive: true });
  const bin = join(repoRoot, "node_modules/.bin");
  const bufScript = join(bin, "buf-fixture.mjs");
  writeFileSync(
    bufScript,
    `
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const template = readFileSync(process.argv.at(-1), "utf8");
const output = template.match(/^\\s*out:\\s*(.+)$/mu)?.[1];
if (output === undefined) process.exit(1);
mkdirSync(output, { recursive: true });
writeFileSync(new URL("proof.ts", \`file://\${output}/\`), "export {};\\n");
`,
  );
  const buf = join(bin, process.platform === "win32" ? "buf.cmd" : "buf");
  writeFileSync(
    buf,
    process.platform === "win32"
      ? '@node "%~dp0\\buf-fixture.mjs" %*\r\n'
      : '#!/usr/bin/env node\nimport("./buf-fixture.mjs");\n',
  );
  if (process.platform !== "win32") chmodSync(buf, 0o755);
  const plugin = join(bin, process.platform === "win32" ? "test.cmd" : "test");
  writeFileSync(
    plugin,
    process.platform === "win32" ? "@exit /b 0\r\n" : "#!/usr/bin/env node\nprocess.exit(0);\n",
  );
  chmodSync(plugin, 0o755);
  const cli = join(repoRoot, "packages/proto-tools/dist/src/cli/spine-proto.js");
  mkdirSync(dirname(cli), { recursive: true });
  writeFileSync(cli, compositionSource);
  writeFileSync(
    join(repoRoot, "buf.gen.yaml"),
    "version: v2\nplugins:\n  - local: test\n    out: packages/proto/generated\n",
  );
  mkdirSync(join(repoRoot, "packages/proto/generated"), { recursive: true });
  writeFileSync(join(repoRoot, ".gitignore"), "packages/proto/generated/\n");
  const chat = join(repoRoot, "examples/message-board/app");
  mkdirSync(join(chat, "src"), { recursive: true });
  writeFileSync(join(chat, "package.json"), '{"name":"@example/chat"}\n');
  writeFileSync(join(chat, "spine-proto.json"), '{"formatVersion":1,"mode":"application"}\n');
  return repoRoot;
}

describe("check-generated-clean", () => {
  it("compares already-generated outputs with freshly staged generation", () => {
    const repoRoot = createFixture();
    const generatedRoots = fixtureGeneratedRoots();

    for (const generatedRoot of generatedRoots) {
      mkdirSync(join(repoRoot, generatedRoot), { recursive: true });
    }
    writeFileSync(
      join(repoRoot, ".gitignore"),
      [
        "packages/proto/generated/",
        ...generatedRoots.map((generatedRoot) => `${generatedRoot}/`),
      ].join("\n"),
    );

    expect(
      runGeneratedClean(
        ["--repo-root", repoRoot, "--current-output"],
        stageCurrentOutputs(repoRoot),
      ),
    ).toBe(0);
  });

  it("allows only the committed generation marker in an otherwise ignored generated root", () => {
    const repoRoot = createFixture();
    const marker = join(repoRoot, "packages/proto/generated/.spine-proto-generation.json");
    writeFileSync(marker, '{"generationId":"fixture-generation"}\n');
    run("git", ["add", "-f", marker], repoRoot);
    run("git", ["commit", "-m", "generation marker"], repoRoot);
    const generatedRoots = fixtureGeneratedRoots();
    for (const generatedRoot of generatedRoots) {
      mkdirSync(join(repoRoot, generatedRoot), { recursive: true });
    }
    writeFileSync(
      join(repoRoot, ".gitignore"),
      [
        "packages/proto/generated/",
        ...generatedRoots.map((generatedRoot) => `${generatedRoot}/`),
      ].join("\n"),
    );

    expect(
      runGeneratedClean(
        ["--repo-root", repoRoot, "--current-output"],
        stageCurrentOutputs(repoRoot),
      ),
    ).toBe(0);
  });

  it("rejects current output that differs from its freshly staged generation", () => {
    const repoRoot = createFixture();
    const expectedRoot = mkdtempSync(join(tmpdir(), "spine-current-generated-"));
    try {
      const generatedRoots = fixtureGeneratedRoots();
      for (const generatedRoot of generatedRoots)
        mkdirSync(join(repoRoot, generatedRoot), { recursive: true });
      writeFileSync(
        join(repoRoot, ".gitignore"),
        ["packages/proto/generated/", ...generatedRoots.map((root) => `${root}/`)].join("\n"),
      );
      mkdirSync(join(expectedRoot, "spine/core"), { recursive: true });
      writeFileSync(
        join(expectedRoot, "spine/core/command_pb.ts"),
        "export const command = 'fresh';\n",
      );
      writeFileSync(
        join(repoRoot, "packages/proto/generated/spine/core/command_pb.ts"),
        "export const command = 'stale';\n",
      );

      expect(
        runGeneratedClean(["--repo-root", repoRoot, "--current-output"], {
          stageGeneratedTargets: () => ({
            status: 0,
            stagedTargets: [
              {
                target: { displayPath: "packages/proto/generated" },
                stagedOutputRoot: expectedRoot,
              },
            ],
          }),
          stageMessageBoardRegistry: () => undefined,
          cleanupStagedTargets: () => undefined,
        }),
      ).toBe(1);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(expectedRoot, { recursive: true, force: true });
    }
  });

  it("compares every atomic model output by default", () => {
    expect(generatedTargetsForCheck().map((target) => target.displayPath)).toEqual([
      "packages/proto/generated",
      "packages/server-blackbox-tests/generated",
      "examples/todo/generated",
      "examples/projects/generated",
      "examples/orders/generated",
      "examples/message-board/model/generated",
      "examples/message-board/app/generated",
    ]);
  });

  it("detects a changed generated MessageBoard registry", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-chat-registry-freshness-"));
    const target = join(root, "model-registry.ts");
    const staged = join(root, "staged-model-registry.ts");
    writeFileSync(target, "previous registry\n");
    writeFileSync(staged, "next registry\n");

    expect(checkMessageBoardRegistryFresh({ target, staged })).toBe(1);
    writeFileSync(target, "next registry\n");
    expect(checkMessageBoardRegistryFresh({ target, staged })).toBe(0);
  });

  it("cleans staged roots when direct MessageBoard registry composition fails", () => {
    const repoRoot = createCompositionFixture();

    const result = spawnSync(process.execPath, [scriptPath, "--repo-root", repoRoot], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(repoRoot, "node_modules/.bin")}${delimiter}${process.env.PATH ?? ""}`,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("MessageBoard model registry composition failed");
    expect(
      readdirSync(join(repoRoot, "packages/proto")).some((name) => name.startsWith(".generated-")),
    ).toBe(false);
    expect(
      readdirSync(join(repoRoot, "examples/message-board")).some((name) =>
        name.startsWith(".generated-"),
      ),
    ).toBe(false);
    expect(
      readdirSync(join(repoRoot, "examples/message-board/app/src")).some((name) =>
        name.startsWith(".generated-"),
      ),
    ).toBe(false);
  });

  it("cleans every staged root after a stale output failure", () => {
    const repoRoot = createCompositionFixture(
      'import { mkdirSync, writeFileSync } from "node:fs";\nmkdirSync("src", { recursive: true });\nwriteFileSync("src/model-registry.ts", "/*\\n * Generated by Spine TypeScript. Do not edit manually.\\n * Source Proto: spine/examples/message-board/message.proto\\n */\\n\\n/**\\n * Generated from Proto: spine/examples/message-board/message.proto.\\n */\\nexport const registry = {};\\n");\n',
    );
    writeFileSync(
      join(repoRoot, "packages/proto/generated/proof.ts"),
      "/*\n * Generated by Spine TypeScript. Do not edit manually.\n * Source Proto: proof.proto\n */\n\nexport {};\n",
    );
    writeFileSync(
      join(repoRoot, "examples/message-board/app/src/model-registry.ts"),
      "stale registry\n",
    );

    const result = spawnSync(process.execPath, [scriptPath, "--repo-root", repoRoot], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(repoRoot, "node_modules/.bin")}${delimiter}${process.env.PATH ?? ""}`,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Generated MessageBoard model registry is stale.");
    expect(
      readdirSync(join(repoRoot, "packages/proto")).some((name) => name.startsWith(".generated-")),
    ).toBe(false);
    expect(
      readdirSync(join(repoRoot, "examples/message-board")).some((name) =>
        name.startsWith(".generated-"),
      ),
    ).toBe(false);
    expect(
      readdirSync(join(repoRoot, "examples/message-board/app/src")).some((name) =>
        name.startsWith(".generated-"),
      ),
    ).toBe(false);
  });

  it("cleans every staged root after a stale generated-output diff", () => {
    const repoRoot = createCompositionFixture(
      'import { mkdirSync, writeFileSync } from "node:fs";\nmkdirSync("src", { recursive: true });\nwriteFileSync("src/model-registry.ts", "/*\\n * Generated by Spine TypeScript. Do not edit manually.\\n * Source Proto: spine/examples/message-board/message.proto\\n */\\n\\n/**\\n * Generated from Proto: spine/examples/message-board/message.proto.\\n */\\nexport const registry = {};\\n");\n',
    );
    writeFileSync(
      join(repoRoot, "packages/proto/generated/stale.ts"),
      "export const stale = true;\n",
    );

    const result = spawnSync(process.execPath, [scriptPath, "--repo-root", repoRoot], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(repoRoot, "node_modules/.bin")}${delimiter}${process.env.PATH ?? ""}`,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Generated proto output is stale.");
    expect(result.stderr).toContain("unexpected: stale.ts");
    expect(
      readdirSync(join(repoRoot, "packages/proto")).some((name) => name.startsWith(".generated-")),
    ).toBe(false);
    expect(
      readdirSync(join(repoRoot, "examples/message-board")).some((name) =>
        name.startsWith(".generated-"),
      ),
    ).toBe(false);
    expect(
      readdirSync(join(repoRoot, "examples/message-board/app/src")).some((name) =>
        name.startsWith(".generated-"),
      ),
    ).toBe(false);
  });
  it("rejects symlinked generated output", () => {
    const repoRoot = createFixture();
    const linkedOutput = join(repoRoot, "linked-generated");
    const expectedOutput = mkdtempSync(join(tmpdir(), "spine-expected-generated-"));

    mkdirSync(linkedOutput, { recursive: true });
    rmSync(join(repoRoot, "packages/proto/generated"), { recursive: true });
    symlinkSync(linkedOutput, join(repoRoot, "packages/proto/generated"), "dir");
    mkdirSync(join(expectedOutput, "spine/core"), { recursive: true });
    writeFileSync(
      join(expectedOutput, "spine/core/command_pb.ts"),
      "export const command = 'fresh';\n",
    );

    const result = runChecker(repoRoot, expectedOutput);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Generated directory must not be a symlink");
  });

  it("rejects symlinked generated output ancestors", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-generated-clean-"));
    const linkedProtoRoot = mkdtempSync(join(tmpdir(), "spine-linked-proto-"));
    const expectedOutput = mkdtempSync(join(tmpdir(), "spine-expected-generated-"));

    run("git", ["init"], repoRoot);
    writeFileSync(join(repoRoot, ".gitignore"), "packages/proto/generated/\n");
    mkdirSync(join(repoRoot, "packages"), { recursive: true });
    mkdirSync(join(linkedProtoRoot, "generated/spine/core"), { recursive: true });
    writeFileSync(
      join(linkedProtoRoot, "generated/spine/core/command_pb.ts"),
      "export const command = 'fresh';\n",
    );
    mkdirSync(join(expectedOutput, "spine/core"), { recursive: true });
    writeFileSync(
      join(expectedOutput, "spine/core/command_pb.ts"),
      "export const command = 'fresh';\n",
    );
    symlinkSync(linkedProtoRoot, join(repoRoot, "packages/proto"), "dir");

    const result = runChecker(repoRoot, expectedOutput);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Generated path ancestor must not be a symlink: packages/proto",
    );
  });

  it("rejects stale or orphaned generated output compared with clean generation", () => {
    const repoRoot = createFixture();
    const expectedOutput = mkdtempSync(join(tmpdir(), "spine-expected-generated-"));

    writeFileSync(
      join(repoRoot, "packages/proto/generated/spine/core/command_pb.ts"),
      "export const command = 'stale';\n",
    );
    writeFileSync(
      join(repoRoot, "packages/proto/generated/spine/core/orphan_pb.ts"),
      "export const orphan = true;\n",
    );
    mkdirSync(join(expectedOutput, "spine/core"), { recursive: true });
    writeFileSync(
      join(expectedOutput, "spine/core/command_pb.ts"),
      "export const command = 'fresh';\n",
    );

    const result = runChecker(repoRoot, expectedOutput);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Generated proto output is stale.");
    expect(result.stderr).toContain("changed: spine/core/command_pb.ts");
    expect(result.stderr).toContain("unexpected: spine/core/orphan_pb.ts");
  });

  it("rejects generated trees beyond the bounded traversal depth", () => {
    const repoRoot = createFixture();
    const expectedOutput = mkdtempSync(join(tmpdir(), "spine-expected-generated-"));
    let nested = join(repoRoot, "packages/proto/generated");
    for (let depth = 0; depth <= 64; depth += 1) {
      nested = join(nested, `level-${depth}`);
      mkdirSync(nested);
    }
    mkdirSync(join(expectedOutput, "spine/core"), { recursive: true });
    writeFileSync(
      join(expectedOutput, "spine/core/command_pb.ts"),
      "export const command = 'fresh';\n",
    );

    const result = runChecker(repoRoot, expectedOutput);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("depth exceeds 64");
  });

  it("rejects generated trees beyond the bounded entry count", () => {
    const repoRoot = createFixture();
    const expectedOutput = mkdtempSync(join(tmpdir(), "spine-expected-generated-"));
    const generatedRoot = join(repoRoot, "packages/proto/generated");
    for (let index = 0; index <= 1_000; index += 1)
      writeFileSync(join(generatedRoot, `entry-${index}.ts`), "export {};\n");
    mkdirSync(join(expectedOutput, "spine/core"), { recursive: true });
    writeFileSync(
      join(expectedOutput, "spine/core/command_pb.ts"),
      "export const command = 'fresh';\n",
    );

    const result = runChecker(repoRoot, expectedOutput);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("entry count exceeds 1000");
  });
});
