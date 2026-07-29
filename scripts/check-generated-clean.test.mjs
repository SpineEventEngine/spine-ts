import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkChatRegistryFresh, generatedTargetsForCheck } from "./check-generated-clean.mjs";

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

function createCompositionFixture(compositionSource = "process.exit(1);\n") {
  const repoRoot = mkdtempSync(join(tmpdir(), "spine-check-generated-clean-"));
  run("git", ["init"], repoRoot);
  mkdirSync(join(repoRoot, "node_modules/.bin"), { recursive: true });
  const buf = join(repoRoot, "node_modules/.bin/buf");
  writeFileSync(
    buf,
    `#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const template = readFileSync(process.argv.at(-1), "utf8");
const output = template.match(/^\\s*out:\\s*(.+)$/mu)?.[1];
if (output === undefined) process.exit(1);
mkdirSync(output, { recursive: true });
writeFileSync(new URL("proof.ts", \`file://\${output}/\`), "export {};\\n");
`,
  );
  chmodSync(buf, 0o755);
  const plugin = join(repoRoot, "node_modules/.bin/test");
  writeFileSync(plugin, "#!/usr/bin/env node\nprocess.exit(0);\n");
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
  const chat = join(repoRoot, "examples/chat/app");
  mkdirSync(join(chat, "src"), { recursive: true });
  writeFileSync(join(chat, "package.json"), '{"name":"@example/chat"}\n');
  writeFileSync(join(chat, "spine-proto.json"), '{"formatVersion":1,"mode":"application"}\n');
  return repoRoot;
}

describe("check-generated-clean", () => {
  it("compares every atomic model output by default", () => {
    expect(generatedTargetsForCheck().map((target) => target.displayPath)).toEqual([
      "packages/proto/generated",
      "examples/todo/generated",
      "examples/project-management/generated",
      "examples/datastore-orders/generated",
      "examples/chat/users-model/generated",
      "examples/chat/model/generated",
      "examples/chat/app/generated",
    ]);
  });

  it("detects a changed generated Chat registry", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-chat-registry-freshness-"));
    const target = join(root, "model-registry.ts");
    const staged = join(root, "staged-model-registry.ts");
    writeFileSync(target, "previous registry\n");
    writeFileSync(staged, "next registry\n");

    expect(checkChatRegistryFresh({ target, staged })).toBe(1);
    writeFileSync(target, "next registry\n");
    expect(checkChatRegistryFresh({ target, staged })).toBe(0);
  });

  it("cleans staged roots when direct Chat registry composition fails", () => {
    const repoRoot = createCompositionFixture();

    const result = spawnSync(process.execPath, [scriptPath, "--repo-root", repoRoot], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(repoRoot, "node_modules/.bin")}:${process.env.PATH ?? ""}`,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Chat model registry composition failed");
    expect(
      readdirSync(join(repoRoot, "packages/proto")).some((name) => name.startsWith(".generated-")),
    ).toBe(false);
    expect(
      readdirSync(join(repoRoot, "examples/chat")).some((name) => name.startsWith(".generated-")),
    ).toBe(false);
    expect(
      readdirSync(join(repoRoot, "examples/chat/app/src")).some((name) =>
        name.startsWith(".generated-"),
      ),
    ).toBe(false);
  });

  it("cleans every staged root after a stale output failure", () => {
    const repoRoot = createCompositionFixture(
      'import { mkdirSync, writeFileSync } from "node:fs";\nmkdirSync("src", { recursive: true });\nwriteFileSync("src/model-registry.ts", "fresh registry\\n");\n',
    );
    writeFileSync(join(repoRoot, "examples/chat/app/src/model-registry.ts"), "stale registry\n");

    const result = spawnSync(process.execPath, [scriptPath, "--repo-root", repoRoot], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(repoRoot, "node_modules/.bin")}:${process.env.PATH ?? ""}`,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Generated Chat model registry is stale.");
    expect(
      readdirSync(join(repoRoot, "packages/proto")).some((name) => name.startsWith(".generated-")),
    ).toBe(false);
    expect(
      readdirSync(join(repoRoot, "examples/chat")).some((name) => name.startsWith(".generated-")),
    ).toBe(false);
    expect(
      readdirSync(join(repoRoot, "examples/chat/app/src")).some((name) =>
        name.startsWith(".generated-"),
      ),
    ).toBe(false);
  });

  it("cleans every staged root after a stale generated-output diff", () => {
    const repoRoot = createCompositionFixture(
      'import { mkdirSync, writeFileSync } from "node:fs";\nmkdirSync("src", { recursive: true });\nwriteFileSync("src/model-registry.ts", "fresh registry\\n");\n',
    );
    writeFileSync(
      join(repoRoot, "packages/proto/generated/stale.ts"),
      "export const stale = true;\n",
    );

    const result = spawnSync(process.execPath, [scriptPath, "--repo-root", repoRoot], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(repoRoot, "node_modules/.bin")}:${process.env.PATH ?? ""}`,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Generated proto output is stale.");
    expect(result.stderr).toContain("unexpected: stale.ts");
    expect(
      readdirSync(join(repoRoot, "packages/proto")).some((name) => name.startsWith(".generated-")),
    ).toBe(false);
    expect(
      readdirSync(join(repoRoot, "examples/chat")).some((name) => name.startsWith(".generated-")),
    ).toBe(false);
    expect(
      readdirSync(join(repoRoot, "examples/chat/app/src")).some((name) =>
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
});
