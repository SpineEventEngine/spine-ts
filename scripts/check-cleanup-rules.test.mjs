import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { baselineObservesStructureEntry } from "./check-cleanup-rules.mjs";

const scriptPath = new URL("./check-cleanup-rules.mjs", import.meta.url).pathname;

function createFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "spine-cleanup-rules-"));

  run("git", ["init"], repoRoot);
  run("git", ["config", "user.email", "test@example.invalid"], repoRoot);
  run("git", ["config", "user.name", "Test User"], repoRoot);
  writeFileSync(join(repoRoot, ".gitignore"), "packages/*/generated/\n");
  mkdirSync(join(repoRoot, "packages/demo/src"), { recursive: true });
  writeFileSync(join(repoRoot, "packages/demo/package.json"), '{"name":"demo"}\n');
  writeFileSync(
    join(repoRoot, "packages/demo/src/index.ts"),
    [
      "export type OnDone = () => void;",
      "export function register(onDone: OnDone, callback: () => void): void {",
      "  onDone();",
      "  callback();",
      "}",
      "",
    ].join("\n"),
  );
  writeStructureLedger(repoRoot, "standalone-function-necessities", "T-0080H", [
    {
      rule: "standalone-function",
      file: "packages/demo/src/index.ts",
      kind: "function-declaration",
      identity: "register()#1",
      name: "register",
      reason:
        "JavaScript callback identity requires register to remain the registration entry point.",
    },
  ]);
  run("git", ["add", "."], repoRoot);
  run("git", ["commit", "-m", "fixture"], repoRoot);

  return repoRoot;
}

function writeExampleSource(repoRoot, source) {
  mkdirSync(join(repoRoot, "examples/todo/src"), { recursive: true });
  writeFileSync(join(repoRoot, "examples/todo/src/index.ts"), source);
  const names = [...source.matchAll(/^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(
    ([, name]) => name,
  );
  writeStructureLedger(
    repoRoot,
    "standalone-function-necessities",
    "T-0080L",
    names.map((name) => ({
      rule: "standalone-function",
      file: "examples/todo/src/index.ts",
      kind: "function-declaration",
      identity: `${name}()#1`,
      name,
      disposition: "necessity",
      reason: `TypeScript fixture boundary requires ${name} to remain an explicit standalone declaration.`,
    })),
  );
}

function writeStructureLedger(repoRoot, directory, partition, entries) {
  mkdirSync(join(repoRoot, "build-protocol", directory), { recursive: true });
  writeFileSync(
    join(repoRoot, "build-protocol", directory, `${partition}.json`),
    `${JSON.stringify(
      entries.map((entry) =>
        directory === "standalone-function-necessities"
          ? { disposition: "necessity", ...entry }
          : entry,
      ),
      null,
      2,
    )}\n`,
  );
}

function registerNecessity() {
  return {
    rule: "standalone-function",
    file: "packages/demo/src/index.ts",
    kind: "function-declaration",
    identity: "register()#1",
    name: "register",
    disposition: "necessity",
    reason:
      "JavaScript callback identity requires register to remain the exported registration entry point.",
  };
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr}${result.stdout}`);
  }

  return result;
}

function runChecker(repoRoot) {
  return spawnSync(process.execPath, [scriptPath, "--repo-root", repoRoot], {
    encoding: "utf8",
  });
}

function trackManyVirtualFiles(repoRoot) {
  const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: repoRoot,
    encoding: "utf8",
    input: "fixture\n",
  });

  if (blob.status !== 0) {
    throw new Error(`git hash-object failed:\n${blob.stderr}${blob.stdout}`);
  }

  const objectId = blob.stdout.trim();
  const entries = Array.from({ length: 25000 }, (_, index) => {
    const number = String(index).padStart(5, "0");
    const path = `assets/tracked-${number}-with-a-long-enough-name-to-exercise-buffer.txt`;
    return `100644 ${objectId}\t${path}`;
  });
  const index = spawnSync("git", ["update-index", "--index-info"], {
    cwd: repoRoot,
    encoding: "utf8",
    input: `${entries.join("\n")}\n`,
  });

  if (index.status !== 0) {
    throw new Error(`git update-index failed:\n${index.stderr}${index.stdout}`);
  }

  run("git", ["commit", "--quiet", "-m", "many tracked files"], repoRoot);
}

describe("check-cleanup-rules", () => {
  it("accepts package source when generated output is ignored and tests live outside src", () => {
    const repoRoot = createFixture();
    mkdirSync(join(repoRoot, "packages/demo/test"), { recursive: true });
    writeFileSync(
      join(repoRoot, "packages/demo/test/index.test.ts"),
      "import '../src/index.js';\n",
    );

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("handles tracked-file lists larger than Node's default sync buffer", () => {
    const repoRoot = createFixture();
    trackManyVirtualFiles(repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("rejects the old generated and test layouts", () => {
    const repoRoot = createFixture();
    mkdirSync(join(repoRoot, "packages/demo/src/generated"), { recursive: true });
    writeFileSync(
      join(repoRoot, "packages/demo/src/generated/demo_pb.ts"),
      "export const x = 1;\n",
    );
    writeFileSync(join(repoRoot, "packages/demo/src/index.test.ts"), "import './index.js';\n");
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "old layout"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("tracked generated files under package src");
    expect(result.stderr).toContain("package test files under src");
  });

  it("rejects generated output that is tracked or not ignored", () => {
    const repoRoot = createFixture();
    writeFileSync(join(repoRoot, ".gitignore"), "\n");
    mkdirSync(join(repoRoot, "packages/demo/generated"), { recursive: true });
    writeFileSync(join(repoRoot, "packages/demo/generated/demo_pb.ts"), "export const x = 1;\n");
    run("git", ["add", "-f", "packages/demo/generated/demo_pb.ts", ".gitignore"], repoRoot);
    run("git", ["commit", "-m", "tracked generated"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("tracked generated files under packages/*/generated");
    expect(result.stderr).toContain("generated directories not ignored by Git");
  });

  it("rejects long lines, callback names, callback types, and long semantic names", () => {
    const repoRoot = createFixture();
    writeFileSync(
      join(repoRoot, "packages/demo/src/index.ts"),
      [
        "export type FinishedCallback = () => void;",
        "export function register(done: FinishedCallback): void {",
        "  const repeatedSemanticNameWithTooManyParts = '1234567890'.repeat(13) + " +
          "'this line deliberately crosses the one hundred twenty character limit';",
        "  console.log(repeatedSemanticNameWithTooManyParts, done);",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "bad names"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("lines longer than 120 characters");
    expect(result.stderr).toContain("callback type names must start with On");
    expect(result.stderr).toContain("callback names must start with on");
    expect(result.stderr).toContain("semantic name components exceed 4");
  });

  it("checks every authored declaration binding member and import alias in package and example sources", () => {
    const repoRoot = createFixture();
    writeFileSync(
      join(repoRoot, "packages/demo/src/index.ts"),
      [
        "import { source as importedSemanticNameWithTooManyParts } from './source.js';",
        "export namespace NamespaceSemanticNameWithTooManyParts {",
        "  export enum EnumSemanticNameWithTooManyParts {",
        "    EnumMemberSemanticNameWithTooManyParts,",
        "  }",
        "}",
        "export interface InterfaceSemanticNameWithTooManyParts {",
        "  propertySemanticNameWithTooManyParts: string;",
        "  methodSemanticNameWithTooManyParts(parameterSemanticNameWithTooManyParts: string): void;",
        "  get accessorSemanticNameWithTooManyParts(): string;",
        "}",
        "const { destructuredSemanticNameWithTooManyParts } = { destructuredSemanticNameWithTooManyParts: '' };",
        "void importedSemanticNameWithTooManyParts;",
        "void destructuredSemanticNameWithTooManyParts;",
        "",
      ].join("\n"),
    );
    writeFileSync(join(repoRoot, "packages/demo/src/source.ts"), "export const source = '';\n");
    writeExampleSource(repoRoot, "export const EXAMPLE_AUTHORED_NAME_WITH_FIVE_PARTS = '';\n");
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "complete semantic names"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("importedSemanticNameWithTooManyParts");
    expect(result.stderr).toContain("EnumMemberSemanticNameWithTooManyParts");
    expect(result.stderr).toContain("parameterSemanticNameWithTooManyParts");
    expect(result.stderr).toContain("EXAMPLE_AUTHORED_NAME_WITH_FIVE_PARTS");
  });

  it("counts acronym digit and underscore components while excluding only generated provenance", () => {
    const repoRoot = createFixture();
    writeFileSync(
      join(repoRoot, "packages/demo/src/index.ts"),
      [
        "export const HTTP2WireValueNamePart = '';",
        "export const authored_name_with_five_parts = '';",
        "export const GENERATED_NAME_WITH_FIVE_PARTS = '';",
        "",
      ].join("\n"),
    );
    mkdirSync(join(repoRoot, "packages/demo/generated"), { recursive: true });
    writeFileSync(
      join(repoRoot, "packages/demo/generated/demo_pb.ts"),
      "export const GENERATED_NAME_WITH_FIVE_PARTS = '';\n",
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "semantic components"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("HTTP2WireValueNamePart");
    expect(result.stderr).toContain("authored_name_with_five_parts");
    expect(result.stderr).toContain("GENERATED_NAME_WITH_FIVE_PARTS");
  });

  it("requires one exact specific necessity for every standalone declaration including nested functions", () => {
    const repoRoot = createFixture();
    writeFileSync(
      join(repoRoot, "packages/demo/src/index.ts"),
      [
        "export function requiredFrameworkBoundary(): void {",
        "  function nestedCallbackIdentity(): void {}",
        "  nestedCallbackIdentity();",
        "}",
        "export const namedObject = { ownedBehavior(): void {} };",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "standalone functions"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("standalone functions require exact necessity dispositions");
    expect(result.stderr).toContain("requiredFrameworkBoundary()#1");
    expect(result.stderr).toContain("nestedCallbackIdentity()#1");
    expect(result.stderr).not.toContain("ownedBehavior()");
  });

  it("rejects stale duplicate broadened and owned-behavior structure ledger entries", () => {
    const repoRoot = createFixture();
    writeFileSync(
      join(repoRoot, "packages/demo/src/index.ts"),
      [
        "export function register(onDone: () => void): void { onDone(); }",
        "export const namedObject = { ownedBehavior(): void {} };",
        "",
      ].join("\n"),
    );
    writeStructureLedger(repoRoot, "typescript-structure-debt", "T-0080H", [
      {
        rule: "semantic-name",
        file: "packages/demo/src/index.ts",
        kind: "variable",
        identity: "variable:missingName#1",
        name: "missingName",
        disposition: "compatibility-exception",
        reason: "Wire contract requires the exact authored spelling.",
        sourceContract: "Spine JVM io.spine.fixture.MissingName immutable wire contract.",
      },
    ]);
    writeStructureLedger(repoRoot, "standalone-function-necessities", "T-0080H", [
      {
        rule: "standalone-function",
        file: "packages/demo/src/index.ts",
        kind: "object-method",
        identity: "namedObject.ownedBehavior()",
        name: "namedObject.ownedBehavior()",
        reason:
          "JavaScript callback identity requires namedObject.ownedBehavior() to remain this declaration.",
      },
    ]);
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "invalid structure ledgers"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("stale semantic-name exception");
    expect(result.stderr).toContain(
      "standalone necessity is already owned by a class or named object",
    );
  });

  it("distinguishes exact migration debt from a specific retained-function necessity", () => {
    const repoRoot = createFixture();
    writeFileSync(
      join(repoRoot, "packages/demo/src/index.ts"),
      "export function retainedBoundary(): void {}\n",
    );
    writeStructureLedger(repoRoot, "standalone-function-necessities", "T-0080H", [
      {
        rule: "standalone-function",
        file: "packages/demo/src/index.ts",
        kind: "function-declaration",
        identity: "retainedBoundary()#1",
        name: "retainedBoundary",
        disposition: "necessity",
        reason:
          "TypeScript fixture boundary requires retainedBoundary to remain the explicit standalone declaration.",
      },
    ]);
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "migration debt"], repoRoot);

    const migration = runChecker(repoRoot);
    expect(migration.status).toBe(0);

    writeStructureLedger(repoRoot, "standalone-function-necessities", "T-0080H", [
      {
        rule: "standalone-function",
        file: "packages/demo/src/index.ts",
        kind: "function-declaration",
        identity: "retainedBoundary()#1",
        name: "retainedBoundary",
        disposition: "necessity",
        reason: "legacy helper",
      },
    ]);
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "generic necessity"], repoRoot);

    const generic = runChecker(repoRoot);
    expect(generic.status).toBe(1);
    expect(generic.stderr).toContain("Generic standalone necessity reason");
  });

  it("rejects forged post-baseline semantic and standalone migration debt while accepting exact baseline debt", () => {
    const repoRoot = createFixture();
    const baselineSource = [
      "export function register(onDone: OnDone, callback: () => void): void {",
      "  onDone();",
      "  callback();",
      "}",
      "export const baselineSemanticNameWithFiveParts = '';",
      "export function baselineBoundary(): void {}",
      "",
    ].join("\n");
    writeFileSync(join(repoRoot, "packages/demo/src/index.ts"), baselineSource);
    writeStructureLedger(repoRoot, "typescript-structure-debt", "T-0080H", [
      {
        rule: "semantic-name",
        file: "packages/demo/src/index.ts",
        kind: "variable",
        identity: "variable:baselineSemanticNameWithFiveParts#1",
        name: "baselineSemanticNameWithFiveParts",
        disposition: "compatibility-exception",
        reason: "Fixture copied wire spelling requires this exact authored name.",
        sourceContract: "Spine JVM io.spine.fixture.BaselineSemanticName immutable wire contract.",
      },
    ]);
    writeStructureLedger(repoRoot, "standalone-function-necessities", "T-0080H", [
      registerNecessity(),
      {
        rule: "standalone-function",
        file: "packages/demo/src/index.ts",
        kind: "function-declaration",
        identity: "baselineBoundary()#1",
        name: "baselineBoundary",
        disposition: "necessity",
        reason:
          "TypeScript fixture boundary requires baselineBoundary to remain the explicit standalone declaration.",
      },
    ]);
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "baseline structure debt"], repoRoot);

    expect(
      baselineObservesStructureEntry(
        {
          rule: "semantic-name",
          file: "packages/demo/src/index.ts",
          kind: "variable",
          identity: "variable:baselineSemanticNameWithFiveParts#1",
        },
        baselineSource,
      ),
    ).toBe(true);

    writeFileSync(
      join(repoRoot, "packages/demo/src/index.ts"),
      baselineSource.replace(
        "export function baselineBoundary(): void {}",
        "export function baselineBoundary(): void {}\nexport const baselineSemanticNameWithFiveParts = '';\nexport function baselineBoundary(): void {}",
      ),
    );
    writeStructureLedger(repoRoot, "typescript-structure-debt", "T-0080H", [
      {
        rule: "semantic-name",
        file: "packages/demo/src/index.ts",
        kind: "variable",
        identity: "variable:baselineSemanticNameWithFiveParts#2",
        name: "baselineSemanticNameWithFiveParts",
        disposition: "compatibility-exception",
        reason: "Fixture copied wire spelling requires this exact authored name.",
        sourceContract: "Spine JVM io.spine.fixture.BaselineSemanticName immutable wire contract.",
      },
    ]);
    writeStructureLedger(repoRoot, "standalone-function-necessities", "T-0080H", [
      registerNecessity(),
      {
        rule: "standalone-function",
        file: "packages/demo/src/index.ts",
        kind: "function-declaration",
        identity: "baselineBoundary()#2",
        name: "baselineBoundary",
        disposition: "necessity",
        reason:
          "TypeScript fixture boundary requires baselineBoundary to remain the explicit standalone declaration.",
      },
    ]);

    expect(
      baselineObservesStructureEntry(
        {
          rule: "semantic-name",
          file: "packages/demo/src/index.ts",
          kind: "variable",
          identity: "variable:baselineSemanticNameWithFiveParts#2",
        },
        baselineSource,
      ),
    ).toBe(false);
  });

  it("requires a concrete immutable source contract for semantic compatibility exceptions", () => {
    const repoRoot = createFixture();
    writeFileSync(
      join(repoRoot, "packages/demo/src/index.ts"),
      "export const copiedWireSemanticNameWithFiveParts = '';\n",
    );
    const entry = {
      rule: "semantic-name",
      file: "packages/demo/src/index.ts",
      kind: "variable",
      identity: "variable:copiedWireSemanticNameWithFiveParts#1",
      name: "copiedWireSemanticNameWithFiveParts",
      disposition: "compatibility-exception",
      reason: "Copied wire spelling must remain compatible with the source schema.",
    };
    writeStructureLedger(repoRoot, "typescript-structure-debt", "T-0080H", [entry]);
    writeStructureLedger(repoRoot, "standalone-function-necessities", "T-0080H", []);
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "compatibility exception"], repoRoot);

    expect(runChecker(repoRoot).stderr).toContain("Invalid semantic compatibility source contract");

    writeStructureLedger(repoRoot, "typescript-structure-debt", "T-0080H", [
      { ...entry, sourceContract: "Spine JVM wire contract" },
    ]);
    expect(runChecker(repoRoot).stderr).toContain("Invalid semantic compatibility source contract");

    writeStructureLedger(repoRoot, "typescript-structure-debt", "T-0080H", [
      {
        ...entry,
        sourceContract:
          "Spine JVM io.spine.compat.CopiedWireSemanticNameWithFiveParts immutable wire contract.",
      },
    ]);
    expect(runChecker(repoRoot).status).toBe(0);
  });

  it("checks .cts import-equals aliases and authored generated-looking names but excludes generated paths", () => {
    const repoRoot = createFixture();
    writeFileSync(
      join(repoRoot, "packages/demo/src/index.cts"),
      "import generatedXSemanticNameWithFiveParts = require('./source.cjs');\nexport { generatedXSemanticNameWithFiveParts };\n",
    );
    writeFileSync(
      join(repoRoot, "packages/demo/src/index.ts"),
      "export const file_spine_X_semantic_name_with_five_parts = '';\nexport const UPPERCASE_AUTHORED_NAME_WITH_FIVE_PARTS = '';\n",
    );
    mkdirSync(join(repoRoot, "packages/demo/generated"), { recursive: true });
    writeFileSync(
      join(repoRoot, "packages/demo/generated/generated.ts"),
      "export const GENERATED_OUTPUT_NAME_WITH_FIVE_PARTS = '';\n",
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "authored names"], repoRoot);

    const result = runChecker(repoRoot);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("generatedXSemanticNameWithFiveParts");
    expect(result.stderr).toContain("file_spine_X_semantic_name_with_five_parts");
    expect(result.stderr).toContain("UPPERCASE_AUTHORED_NAME_WITH_FIVE_PARTS");
    expect(result.stderr).not.toContain("GENERATED_OUTPUT_NAME_WITH_FIVE_PARTS");
  });

  it("requires declaration-specific necessity reasons and preserves exact identities across unrelated lines", () => {
    const repoRoot = createFixture();
    writeFileSync(
      join(repoRoot, "packages/demo/src/index.ts"),
      ["", "", "export function retainedBoundary(): void {}", ""].join("\n"),
    );
    const entry = {
      rule: "standalone-function",
      file: "packages/demo/src/index.ts",
      kind: "function-declaration",
      identity: "retainedBoundary()#1",
      name: "retainedBoundary",
      disposition: "necessity",
    };
    for (const reason of [
      "JavaScript",
      "TypeScript",
      "callback identity",
      "framework boundary",
      "Spine JVM",
    ]) {
      writeStructureLedger(repoRoot, "standalone-function-necessities", "T-0080H", [
        { ...entry, reason },
      ]);
      expect(runChecker(repoRoot).stderr).toContain("Generic standalone necessity reason");
    }
    writeStructureLedger(repoRoot, "standalone-function-necessities", "T-0080H", [
      {
        ...entry,
        reason:
          "JavaScript callback identity requires retainedBoundary to remain the named listener registration function.",
      },
    ]);
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "necessity identity"], repoRoot);
    expect(runChecker(repoRoot).status).toBe(0);

    writeStructureLedger(repoRoot, "standalone-function-necessities", "T-0080H", []);
    const first = runChecker(repoRoot);
    expect(first.stderr).toContain("packages/demo/src/index.ts:3 retainedBoundary()#1");
    writeFileSync(
      join(repoRoot, "packages/demo/src/index.ts"),
      ["", "", "", "", "export function retainedBoundary(): void {}", ""].join("\n"),
    );
    const moved = runChecker(repoRoot);
    expect(moved.stderr).toContain("packages/demo/src/index.ts:5 retainedBoundary()#1");
  });

  it("keeps ordinary fixture necessity records independent of the production baseline", () => {
    const repoRoot = createFixture();
    writeStructureLedger(repoRoot, "standalone-function-necessities", "T-0080H", [
      {
        rule: "standalone-function",
        file: "packages/demo/src/index.ts",
        kind: "function-declaration",
        identity: "register()#1",
        name: "register",
        disposition: "necessity",
        reason:
          "TypeScript fixture boundary requires register to remain the explicit standalone declaration.",
      },
    ]);
    const result = spawnSync(process.execPath, [scriptPath, "--repo-root", repoRoot], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
  });

  it("rejects baseline overrides so operational checks cannot bypass the pinned baseline", () => {
    const repoRoot = createFixture();
    const result = spawnSync(
      process.execPath,
      [scriptPath, "--repo-root", repoRoot, "--structure-baseline", "HEAD"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--structure-baseline is forbidden");
  });

  it("escapes tracked filenames with control characters in diagnostics", () => {
    const repoRoot = createFixture();
    writeFileSync(
      join(repoRoot, "packages/demo/src", "bad\nname.ts"),
      [
        "export const longLine = " +
          "'this line deliberately crosses the one hundred twenty character limit'.repeat(2);",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(repoRoot, "packages/demo/src", "bidi\u202ename.ts"),
      [
        "export const anotherLongLine = " +
          "'this line deliberately crosses the one hundred twenty character limit'.repeat(2);",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(repoRoot, "packages/demo/src", "tag\u{e0061}variant\u{e0100}.ts"),
      [
        "export const astralLongLine = " +
          "'this line deliberately crosses the one hundred twenty character limit'.repeat(2);",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "control path"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("bad\\nname.ts");
    expect(result.stderr).toContain("bidi\\u{202e}name.ts");
    expect(result.stderr).toContain("tag\\u{e0061}variant\\u{e0100}.ts");
    expect(result.stderr).not.toContain("bad\nname.ts");
    expect(result.stderr).not.toContain("bidi\u202ename.ts");
    expect(result.stderr).not.toContain("tag\u{e0061}variant\u{e0100}.ts");
  });

  it("rejects reuse of inherited long-name exceptions in new locations", () => {
    const repoRoot = createFixture();
    writeFileSync(
      join(repoRoot, "packages/demo/src/index.ts"),
      [
        "export function createServerRuntimeRoutingPlan(): void {",
        "  return undefined;",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "reused inherited name"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("semantic name components exceed 4");
    expect(result.stderr).toContain("packages/demo/src/index.ts");
  });

  it("rejects inline callback parameter names without rejecting generic callback", () => {
    const repoRoot = createFixture();
    writeFileSync(
      join(repoRoot, "packages/demo/src/index.ts"),
      [
        "export function register(done: () => void, callback: () => void): void {",
        "  done();",
        "  callback();",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "inline callback"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("callback names must start with on");
    expect(result.stderr).toContain("done");
    expect(result.stderr).not.toContain("callback:");
  });

  it("rejects new flat package source files beyond explicit entry files", () => {
    const repoRoot = createFixture();
    writeFileSync(join(repoRoot, "packages/demo/src/feature.ts"), "export const value = 1;\n");
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "flat source"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("package src files must not grow flat");
    expect(result.stderr).toContain("packages/demo/src/feature.ts");
  });

  it("includes package tests in line-length enforcement", () => {
    const repoRoot = createFixture();
    mkdirSync(join(repoRoot, "packages/demo/test"), { recursive: true });
    writeFileSync(
      join(repoRoot, "packages/demo/test/index.test.ts"),
      ["const longTestLine = '" + "x".repeat(121) + "';", "void longTestLine;", ""].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "long test line"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("lines longer than 120 characters");
    expect(result.stderr).toContain("packages/demo/test/index.test.ts");
  });

  it("rejects forbidden end-user example handler patterns", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { packCommand, packEvent } from "@spine-event-engine/core";',
        'import { EventIdSchema, type Command, type Event } from "@spine-event-engine/proto";',
        "import { Apply, Assign, Command, React, Subscribe,",
        '  materializeDecoratedEntityHandlers } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "class DemoAggregate {",
        "  @Assign(TaskCommand)",
        "  assignTask(command: TaskCommand): Event {",
        "    const id = requireTaskId(command.id);",
        "    this.startTransaction();",
        "    this.commitTransaction();",
        "    this.rollbackTransaction();",
        "    return packEvent({ id: EventIdSchema });",
        "  }",
        "",
        "  @Command(TaskCommand)",
        "  commandTask(command: TaskCommand): Command {",
        "    return packCommand({});",
        "  }",
        "",
        "  @React(TaskCreated)",
        "  reactToTask(event: TaskCreated): Event {",
        "    return packEvent({ id: EventIdSchema });",
        "  }",
        "",
        "  @Subscribe(TaskCreated)",
        "  onTask(event: TaskCreated): void {}",
        "",
        "  @Apply",
        "  applyTask(event: TaskCreated): void {}",
        "}",
        "",
        "materializeDecoratedEntityHandlers(DemoAggregate);",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "example violations"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("end-user example source uses forbidden API patterns");
    expect(result.stderr).toContain("@Assign(...)");
    expect(result.stderr).toContain("@Command(...)");
    expect(result.stderr).toContain("@React(...)");
    expect(result.stderr).toContain("@Subscribe(...)");
    expect(result.stderr).toContain("@Apply");
    expect(result.stderr).toContain("startTransaction");
    expect(result.stderr).toContain("commitTransaction");
    expect(result.stderr).toContain("rollbackTransaction");
    expect(result.stderr).toContain("packEvent");
    expect(result.stderr).toContain("packCommand");
    expect(result.stderr).toContain("EventIdSchema");
    expect(result.stderr).toContain("materializeDecoratedEntityHandlers");
    expect(result.stderr).toContain("handler return type Event");
    expect(result.stderr).toContain("handler return type Command");
    expect(result.stderr).toContain('command target validation "id"');
  });

  it("rejects direct defineEntityHandlers imports in example source", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { defineEntityHandlers } from "@spine-event-engine/server";',
        "",
        "class DemoAggregate {}",
        "defineEntityHandlers(DemoAggregate);",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "direct define handlers"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("end-user example source uses forbidden API patterns");
    expect(result.stderr).toContain("defineEntityHandlers");
    expect(result.stderr).not.toContain("materializeDecoratedEntityHandlers");
  });

  it("rejects namespace defineEntityHandlers access in example source", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import * as server from "@spine-event-engine/server";',
        "",
        "class DemoAggregate {}",
        "server.defineEntityHandlers(DemoAggregate);",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "namespace define handlers"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("end-user example source uses forbidden API patterns");
    expect(result.stderr).toContain("defineEntityHandlers");
    expect(result.stderr).not.toContain("materializeDecoratedEntityHandlers");
  });

  it("rejects aliased defineEntityHandlers imports in example source", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { defineEntityHandlers as defineHandlers } from "@spine-event-engine/server";',
        "",
        "class DemoAggregate {}",
        "defineHandlers(DemoAggregate);",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "aliased define handlers"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("end-user example source uses forbidden API patterns");
    expect(result.stderr).toContain("defineEntityHandlers");
    expect(result.stderr).not.toContain("materializeDecoratedEntityHandlers");
  });

  it("rejects destructured defineEntityHandlers aliases in example source", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import * as server from "@spine-event-engine/server";',
        "",
        "const { defineEntityHandlers: defineHandlers } = server;",
        "class DemoAggregate {}",
        "defineHandlers(DemoAggregate);",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "destructured define handlers"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("end-user example source uses forbidden API patterns");
    expect(result.stderr).toContain("defineEntityHandlers");
    expect(result.stderr).not.toContain("materializeDecoratedEntityHandlers");
  });

  it("rejects import-equals defineEntityHandlers aliases in .cts example source", () => {
    const repoRoot = createFixture();
    mkdirSync(join(repoRoot, "examples/todo/src"), { recursive: true });
    writeFileSync(
      join(repoRoot, "examples/todo/src/state.cts"),
      [
        'import Server = require("@spine-event-engine/server");',
        "import DefineHandlers = Server.defineEntityHandlers;",
        "",
        "class DemoAggregate {}",
        "DefineHandlers(DemoAggregate);",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "commonjs define handlers"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("end-user example source uses forbidden API patterns");
    expect(result.stderr).toContain("defineEntityHandlers");
    expect(result.stderr).not.toContain("materializeDecoratedEntityHandlers");
  });

  it("rejects local bare defineEntityHandlers calls in example source", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        "function defineEntityHandlers(entityType: unknown): void {",
        "  void entityType;",
        "}",
        "",
        "class DemoAggregate {}",
        "defineEntityHandlers(DemoAggregate);",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "local define handlers"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("end-user example source uses forbidden API patterns");
    expect(result.stderr).toContain("defineEntityHandlers");
    expect(result.stderr).not.toContain("materializeDecoratedEntityHandlers");
  });

  it("accepts bare decorators with generated-message return types in example source", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign, Subscribe } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    return command.created;",
        "  }",
        "",
        "  @Subscribe",
        "  onTask(event: TaskCreated): void {",
        "    void event;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "example valid"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("rejects missing and invalid handler return type annotations", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign, Command, React, Subscribe } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand) {",
        "    return command.created;",
        "  }",
        "",
        "  @Command",
        "  commandTask(command: TaskCommand) {",
        "    return command;",
        "  }",
        "",
        "  @React",
        "  reactToTask(event: TaskCreated) {",
        "    return event;",
        "  }",
        "",
        "  @Subscribe",
        "  onTask(event: TaskCreated): TaskCreated {",
        "    return event;",
        "  }",
        "",
        "  @Assign",
        "  assignVoid(command: TaskCommand): void {",
        "    void command;",
        "  }",
        "",
        "  @Command",
        "  commandUndefined(command: TaskCommand): undefined {",
        "    void command;",
        "    return undefined;",
        "  }",
        "",
        "  @React",
        "  reactNever(event: TaskCreated): never {",
        "    throw new Error(String(event));",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "missing return types"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@Assign handler return type annotation");
    expect(result.stderr).toContain("@Command handler return type annotation");
    expect(result.stderr).toContain("@React handler return type annotation");
    expect(result.stderr).toContain("@Subscribe handler return type void");
    expect(result.stderr).toContain("handler return type generated domain");
  });

  it("rejects handlers without explicit first parameter type annotations", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign, Command, React, Subscribe } from "@spine-event-engine/server";',
        'import type { NotifyOwner, TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command): TaskCreated {",
        "    return command.created;",
        "  }",
        "",
        "  @Command",
        "  commandTask(): NotifyOwner {",
        "    return {} as NotifyOwner;",
        "  }",
        "",
        "  @React",
        "  reactToTask(event): TaskCreated {",
        "    return event;",
        "  }",
        "",
        "  @Subscribe",
        "  onTask(event): void {",
        "    void event;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "missing parameter types"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@Assign handler first parameter type annotation");
    expect(result.stderr).toContain("@Command handler first parameter type annotation");
    expect(result.stderr).toContain("@React handler first parameter type annotation");
    expect(result.stderr).toContain("@Subscribe handler first parameter type annotation");
  });

  it("accepts one- and two-argument bare handler signatures in example source", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign, Command, React, Subscribe } from "@spine-event-engine/server";',
        'import type { NotifyOwner, TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "interface CommandContext {",
        "  readonly tenant: string;",
        "}",
        "",
        "interface EventContext {",
        "  readonly tenant: string;",
        "}",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    return command.created;",
        "  }",
        "",
        "  @Command",
        "  commandTask(event: TaskCreated, context: EventContext): NotifyOwner {",
        "    void context;",
        "    return event.notify;",
        "  }",
        "",
        "  @React",
        "  reactToTask(event: TaskCreated, context: EventContext): TaskCreated {",
        "    void context;",
        "    return event;",
        "  }",
        "",
        "  @Subscribe",
        "  onTask(event: TaskCreated, context: CommandContext): void {",
        "    void event;",
        "    void context;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "explicit parameter types"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("rejects aliased and qualified forbidden handler return types", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import type * as Proto from "@spine-event-engine/proto";',
        'import type { Command as FrameworkCommand, Event as FrameworkEvent } from "@spine-event-engine/proto";',
        'import { Assign, Command, React } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "type LegacyEvent = FrameworkEvent;",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): LegacyEvent {",
        "    return command.created as LegacyEvent;",
        "  }",
        "",
        "  @Command",
        "  routeTask(command: TaskCommand): FrameworkCommand {",
        "    return command as FrameworkCommand;",
        "  }",
        "",
        "  @React",
        "  reactToTask(event: TaskCreated): Proto.Event {",
        "    return event as Proto.Event;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "aliased returns"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("handler return type LegacyEvent");
    expect(result.stderr).toContain("handler return type FrameworkCommand");
    expect(result.stderr).toContain("handler return type Proto.Event");
  });

  it("rejects import-type framework envelope return types", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "",
        "class DemoAggregate {",
        "  @Assign",
        '  assignTask(command: TaskCommand): import("@spine-event-engine/proto").Event {',
        '    return command as import("@spine-event-engine/proto").Event;',
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "import type returns"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("handler return type spine proto Event");
    expect(result.stderr).not.toContain('import("@spine-event-engine/proto").Event');
  });

  it("rejects chained import-equals framework envelope aliases", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type Proto = require("@spine-event-engine/proto");',
        "import type LegacyEvent = Proto.Event;",
        "import type FrameworkEvent = LegacyEvent;",
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): FrameworkEvent {",
        "    return command as FrameworkEvent;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "chained import equals proto member"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("handler return type FrameworkEvent");
  });

  it("rejects block-local framework envelope return aliases", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { Event as FrameworkEvent } from "@spine-event-engine/proto";',
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "",
        "function localScope(): void {",
        "  type LegacyEvent = FrameworkEvent;",
        "",
        "  class DemoAggregate {",
        "    @Assign",
        "    assignTask(command: TaskCommand): LegacyEvent {",
        "      return command as LegacyEvent;",
        "    }",
        "  }",
        "",
        "  void DemoAggregate;",
        "}",
        "",
        "void localScope;",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "block local envelope alias"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("handler return type LegacyEvent");
  });

  it("does not echo raw return-type source in forbidden handler diagnostics", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import type { Event } from "@spine-event-engine/proto";',
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): Event</* do-not-log */ { token: string }> {",
        "    return command as Event;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "generic event return"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("handler return type Event");
    expect(result.stderr).not.toContain("do-not-log");
    expect(result.stderr).not.toContain("token: string");
  });

  it("rejects framework envelope return types inside containers", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import type { Command, Event } from "@spine-event-engine/proto";',
        'import { Assign, Command as OnCommand, React } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "type LegacyReturns = Event | undefined;",
        "type CommandList = ReadonlyArray<Command>;",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignOne(command: TaskCommand): Event[] {",
        "    return [command as Event];",
        "  }",
        "",
        "  @React",
        "  reactOne(event: TaskCreated): readonly [Event] {",
        "    return [event as Event];",
        "  }",
        "",
        "  @Assign",
        "  assignLegacy(command: TaskCommand): LegacyReturns {",
        "    return command as Event;",
        "  }",
        "",
        "  @OnCommand",
        "  commandTask(command: TaskCommand): CommandList {",
        "    return [command as Command];",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "container envelope returns"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("handler return type Event");
    expect(result.stderr).toContain("handler return type LegacyReturns");
    expect(result.stderr).toContain("handler return type CommandList");
  });

  it("reports long alias chains without overflowing the stack", () => {
    const repoRoot = createFixture();
    const aliases = Array.from({ length: 400 }, (_, index) =>
      index === 0 ? "type Alias0 = Event;" : `type Alias${index} = Alias${index - 1};`,
    );
    writeExampleSource(
      repoRoot,
      [
        'import type { Event } from "@spine-event-engine/proto";',
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "",
        ...aliases,
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): Alias399 {",
        "    return command as Event;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "long alias chain"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("handler return type too deep to audit");
    expect(result.stderr).not.toContain("Maximum call stack");
  });

  it("reports too-deep safe alias chains without claiming a framework envelope", () => {
    const repoRoot = createFixture();
    const aliases = Array.from({ length: 400 }, (_, index) =>
      index === 0 ? "type Alias0 = TaskCreated;" : `type Alias${index} = Alias${index - 1};`,
    );
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        ...aliases,
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): Alias399 {",
        "    return command.created;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "safe long alias chain"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("handler return type too deep to audit");
    expect(result.stderr).not.toContain("handler return type framework envelope");
  });

  it("rejects aliased framework-owned helper imports in example source", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { packEvent as emit } from "@spine-event-engine/core";',
        'import * as core from "@spine-event-engine/core";',
        'import { EventIdSchema as EID } from "@spine-event-engine/proto";',
        'import * as proto from "@spine-event-engine/proto";',
        'import { materializeDecoratedEntityHandlers as materialize } from "@spine-event-engine/server";',
        'import * as server from "@spine-event-engine/server";',
        "",
        "emit({});",
        "core.packCommand({});",
        "void EID;",
        "void proto.EventIdSchema;",
        "materialize(class Demo {});",
        "server.materializeDecoratedEntityHandlers(class Other {});",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "aliased framework helpers"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("packEvent");
    expect(result.stderr).toContain("packCommand");
    expect(result.stderr).toContain("EventIdSchema");
    expect(result.stderr).toContain("materializeDecoratedEntityHandlers");
  });

  it("rejects property aliases of framework helpers", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import * as core from "@spine-event-engine/core";',
        'import * as proto from "@spine-event-engine/proto";',
        "",
        "const emit = core.packEvent;",
        "const eid = proto.EventIdSchema;",
        "const helpers = { emit: core.packEvent, eid: proto.EventIdSchema };",
        "",
        "emit({});",
        "void eid;",
        "helpers.emit({});",
        "void helpers.eid;",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "property helper aliases"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("packEvent");
    expect(result.stderr).toContain("EventIdSchema");
  });

  it("rejects object-held namespace aliases of framework helpers", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import * as core from "@spine-event-engine/core";',
        'import * as proto from "@spine-event-engine/proto";',
        "",
        "const container = { core, proto };",
        "const { core: heldCore, proto: heldProto } = container;",
        "",
        "container.core.packEvent({});",
        "void container.proto.EventIdSchema;",
        "heldCore.packCommand({});",
        "void heldProto.EventIdSchema;",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "object held namespace aliases"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("packEvent");
    expect(result.stderr).toContain("packCommand");
    expect(result.stderr).toContain("EventIdSchema");
  });

  it("rejects locally declared decorated-handler materialization in example source", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "",
        "export function materializeDecoratedEntityHandlers(entityType: unknown): void {",
        "  void entityType;",
        "}",
        "",
        "materializeDecoratedEntityHandlers(class DemoAggregate {});",
        "void (undefined as unknown as TaskCommand);",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "local materializer"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("materializeDecoratedEntityHandlers");
  });

  it("rejects generated registry discovery and metadata imports in example source", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { GeneratedRegistryDiscovery } from "@spine-event-engine/server";',
        'import type { EntityHandlersMetadata, HandlerMetadataRegistry } from "@spine-event-engine/server";',
        "",
        "type LocalMetadata = EntityHandlersMetadata;",
        "type LocalRegistry = HandlerMetadataRegistry;",
        "void LocalMetadata;",
        "void LocalRegistry;",
        "void GeneratedRegistryDiscovery;",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "generated registry imports"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("GeneratedRegistryDiscovery");
    expect(result.stderr).toContain("EntityHandlersMetadata");
    expect(result.stderr).toContain("HandlerMetadataRegistry");
  });

  it("rejects string-literal access to generated registry internals through server namespaces", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import * as server from "@spine-event-engine/server";',
        "",
        'const Discovery = server["GeneratedRegistryDiscovery"];',
        'const Registry = server["HandlerMetadataRegistry"];',
        'void server["EntityHandlersMetadata"];',
        "void Discovery;",
        "void Registry;",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "string literal internals"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("GeneratedRegistryDiscovery");
    expect(result.stderr).toContain("EntityHandlersMetadata");
    expect(result.stderr).toContain("HandlerMetadataRegistry");
  });

  it("rejects destructured framework helpers from local namespace aliases", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import * as core from "@spine-event-engine/core";',
        'import * as proto from "@spine-event-engine/proto";',
        'import * as server from "@spine-event-engine/server";',
        "",
        "const c = core;",
        "const p = proto;",
        "const s = server;",
        "const { packEvent: emit } = c;",
        "const { EventIdSchema: eid } = p;",
        "const { materializeDecoratedEntityHandlers: materialize } = s;",
        "",
        "emit({});",
        "void eid;",
        "materialize(class Demo {});",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "destructured namespace helpers"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("packEvent");
    expect(result.stderr).toContain("EventIdSchema");
    expect(result.stderr).toContain("materializeDecoratedEntityHandlers");
  });

  it("rejects qualified and aliased schema-bearing decorators", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign as LegacyAssign } from "@spine-event-engine/server";',
        'import * as spine from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "class DemoAggregate {",
        "  @LegacyAssign(TaskCommand)",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    return command.created;",
        "  }",
        "",
        "  @spine.Assign(TaskCommand)",
        "  assignOther(command: TaskCommand): TaskCreated {",
        "    return command.created;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "qualified decorators"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@Assign(...)");
    expect(result.stderr).toContain("examples/todo/src/index.ts:6");
    expect(result.stderr).toContain("examples/todo/src/index.ts:11");
  });

  it("accepts local decorators with Spine-like names", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function Assign(_schema: unknown) {",
        "  return function decorate(_value: unknown): void {};",
        "}",
        "",
        "class DemoAggregate {",
        "  @Assign(TaskCommand)",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    return command.created;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    writeStructureLedger(repoRoot, "standalone-function-necessities", "T-0080L", [
      {
        rule: "standalone-function",
        file: "examples/todo/src/index.ts",
        kind: "function-declaration",
        identity: "Assign()#1",
        name: "Assign",
        reason:
          "TypeScript decorator callback identity requires Assign to remain this exact declaration.",
      },
    ]);
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "local decorator"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("accepts local decorators shadowing type-only Spine imports", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import type { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function Assign(_schema: unknown) {",
        "  return function decorate(_value: unknown): void {};",
        "}",
        "",
        "class DemoAggregate {",
        "  @Assign(TaskCommand)",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    return command.created;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    writeStructureLedger(repoRoot, "standalone-function-necessities", "T-0080L", [
      {
        rule: "standalone-function",
        file: "examples/todo/src/index.ts",
        kind: "function-declaration",
        identity: "Assign()#1",
        name: "Assign",
        reason:
          "TypeScript decorator callback identity requires Assign to remain this exact declaration.",
      },
    ]);
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "type only local decorator"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("accepts local decorators shadowing Spine imports in an inner scope", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function localScope(): void {",
        "  function Assign(_schema: unknown) {",
        "    return function decorate(_value: unknown): void {};",
        "  }",
        "",
        "  class DemoAggregate {",
        "    @Assign(TaskCommand)",
        "    assignTask(command: TaskCommand): TaskCreated {",
        "      return command.created;",
        "    }",
        "  }",
        "",
        "  void DemoAggregate;",
        "}",
        "",
        "void localScope;",
        "",
      ].join("\n"),
    );
    writeStructureLedger(repoRoot, "standalone-function-necessities", "T-0080L", [
      {
        rule: "standalone-function",
        file: "examples/todo/src/index.ts",
        kind: "function-declaration",
        identity: "localScope()#1",
        name: "localScope",
        reason: "TypeScript fixture boundary requires localScope to remain this exact local scope.",
      },
      {
        rule: "standalone-function",
        file: "examples/todo/src/index.ts",
        kind: "function-declaration",
        identity: "localScope/Assign()#1",
        name: "Assign",
        reason:
          "TypeScript decorator callback identity requires Assign to remain this exact declaration.",
      },
    ]);
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "inner local decorator"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("accepts parameter decorators shadowing Spine imports in an inner scope", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function localScope(Assign: (schema: unknown) => unknown): void {",
        "  class DemoAggregate {",
        "    @Assign(TaskCommand)",
        "    assignTask(command: TaskCommand): TaskCreated {",
        "      return command.created;",
        "    }",
        "  }",
        "",
        "  void DemoAggregate;",
        "}",
        "",
        "void localScope;",
        "",
      ].join("\n"),
    );
    writeStructureLedger(repoRoot, "standalone-function-necessities", "T-0080L", [
      {
        rule: "standalone-function",
        file: "examples/todo/src/index.ts",
        kind: "function-declaration",
        identity: "localScope()#1",
        name: "localScope",
        reason: "TypeScript fixture boundary requires localScope to remain this exact local scope.",
      },
    ]);
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "parameter local decorator"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("rejects local value aliases of Spine decorators", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign as SpineAssign } from "@spine-event-engine/server";',
        'import type { Event } from "@spine-event-engine/proto";',
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "",
        "const Assign = SpineAssign;",
        "",
        "class DemoAggregate {",
        "  @Assign(TaskCommand)",
        "  assignTask(command: TaskCommand): Event {",
        "    return command as Event;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "local decorator alias"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@Assign(...)");
    expect(result.stderr).toContain("handler return type Event");
  });

  it("rejects object-literal aliases of Spine decorators", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign as SpineAssign } from "@spine-event-engine/server";',
        'import type { Event } from "@spine-event-engine/proto";',
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "",
        "const decorators = { Assign: SpineAssign };",
        "",
        "class DemoAggregate {",
        "  @decorators.Assign(TaskCommand)",
        "  assignTask(command: TaskCommand): Event {",
        "    return command as Event;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "object decorator alias"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@Assign(...)");
    expect(result.stderr).toContain("handler return type Event");
  });

  it("rejects destructured object-literal aliases of Spine decorators", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign as SpineAssign } from "@spine-event-engine/server";',
        'import type { Event } from "@spine-event-engine/proto";',
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "",
        "const decorators = { Assign: SpineAssign };",
        "const { Assign } = decorators;",
        "",
        "class DemoAggregate {",
        "  @Assign(TaskCommand)",
        "  assignTask(command: TaskCommand): Event {",
        "    return command as Event;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "destructured object decorator alias"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@Assign(...)");
    expect(result.stderr).toContain("handler return type Event");
  });

  it("accepts type-only core helper imports", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { type packEvent } from "@spine-event-engine/core";',
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "type PackEventType = typeof packEvent;",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    return command.created;",
        "  }",
        "}",
        "",
        "void (undefined as unknown as PackEventType);",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "type only core helper"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("rejects local primitive handler return aliases", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign, Command } from "@spine-event-engine/server";',
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "",
        "type Event = string;",
        "type Command = string;",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): Event {",
        "    return command.title;",
        "  }",
        "",
        "  @Command",
        "  routeTask(command: TaskCommand): Command {",
        "    return command.title;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "local type names"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("handler return type generated domain");
  });

  it("rejects capitalized non-message handler returns", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignDate(command: TaskCommand): Date {",
        "    return new Date(command.timestamp);",
        "  }",
        "",
        "  @Assign",
        "  assignTuple(command: TaskCommand): readonly [Date] {",
        "    return [new Date(command.timestamp)];",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "capitalized non messages"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("handler return type generated domain");
  });

  it("rejects generated command returns from event-emitting handlers", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign, React } from "@spine-event-engine/server";',
        'import type { CreateTask, TaskCommand, TaskCreated } from "../generated/example_pb.js";',
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): CreateTask {",
        "    return command.create;",
        "  }",
        "",
        "  @React",
        "  reactTask(event: TaskCreated): CreateTask {",
        "    return event.create;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "command returned as event"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("handler return type generated domain event");
  });

  it("rejects generated event returns from command-producing handlers", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Command } from "@spine-event-engine/server";',
        'import type { CreateTask, TaskCreated } from "../generated/example_pb.js";',
        "",
        "class DemoProcess {",
        "  @Command",
        "  whenTaskCreated(event: TaskCreated): TaskCreated {",
        "    return event;",
        "  }",
        "",
        "  @Command",
        "  whenCreatedAgain(event: TaskCreated): CreateTask {",
        "    return event.create;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "event returned as command"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("handler return type generated domain command");
  });

  it("rejects generated non-signal returns with command-like names", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Command } from "@spine-event-engine/server";',
        'import type { CreateTaskView, TaskCreated } from "../generated/example_pb.js";',
        "",
        "class DemoProcess {",
        "  @Command",
        "  whenTaskCreated(event: TaskCreated): CreateTaskView {",
        "    return event.view;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "non signal return"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("handler return type generated domain command");
  });

  it("accepts aliases of generated-message return types", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign, Command } from "@spine-event-engine/server";',
        'import type { NotifyOwner, TaskCommand, TaskCreated } from "../generated/example_pb.js";',
        "",
        "type Created = TaskCreated;",
        "type Notify = NotifyOwner;",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): Created {",
        "    return command.created;",
        "  }",
        "",
        "  @Command",
        "  routeTask(command: TaskCommand): readonly [Notify, ...Notify[]] {",
        "    return [command.notify];",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "generated aliases"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("accepts generated namespace and value imports in handler return types", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import { TaskCompleted } from "../generated/example_pb.js";',
        'import type * as Todo from "../generated/example_pb.js";',
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): Todo.TaskCreated {",
        "    return command.created;",
        "  }",
        "",
        "  @Assign",
        "  complete(command: TaskCommand): TaskCompleted {",
        "    return command.completed;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "generated namespace returns"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("accepts local aliases shadowing framework envelope names with generated messages", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import type { Event } from "@spine-event-engine/proto";',
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCommand, TaskCreated } from "../generated/example_pb.js";',
        "",
        "function localScope(): void {",
        "  type Event = TaskCreated;",
        "",
        "  class DemoAggregate {",
        "    @Assign",
        "    assignTask(command: TaskCommand): Event {",
        "      return command.created;",
        "    }",
        "  }",
        "",
        "  void DemoAggregate;",
        "}",
        "",
        "void localScope;",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "shadowed event alias"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("rejects local aliases shadowing generated imports with non-message types", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCommand, TaskCreated } from "../generated/example_pb.js";',
        "",
        "function localScope(): void {",
        "  type TaskCreated = string;",
        "",
        "  class DemoAggregate {",
        "    @Assign",
        "    assignTask(command: TaskCommand): TaskCreated {",
        "      return command.title;",
        "    }",
        "  }",
        "",
        "  void DemoAggregate;",
        "}",
        "",
        "void localScope;",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "shadowed generated alias"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("handler return type generated domain");
  });

  it("accepts labeled non-empty tuple handler returns", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCommand, TaskCreated } from "../generated/example_pb.js";',
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): readonly [first: TaskCreated, ...rest: TaskCreated[]] {",
        "    return [command.created, ...command.items];",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "labeled tuple"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("rejects rest-only tuple handler returns", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCommand, TaskCreated } from "../generated/example_pb.js";',
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): readonly [...TaskCreated[]] {",
        "    return command.items;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "rest only tuple"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("handler return type generated domain");
  });

  it("rejects non-domain types from the Spine proto namespace", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import type * as Proto from "@spine-event-engine/proto";',
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): Proto.UserId {",
        "    return command.userId;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "proto namespace non envelope"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("handler return type generated domain");
  });

  it("rejects unknown qualified handler return types", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { Event } from "@spine-event-engine/proto";',
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "",
        "namespace Hidden {",
        "  export type Leaked = Event;",
        "}",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): Hidden.Leaked {",
        "    return command as Hidden.Leaked;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "unknown qualified return"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("handler return type generated domain");
  });

  it("rejects local recursive handler return aliases", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "",
        "type A = B;",
        "type B = A;",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): A {",
        "    return command.value as A;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "recursive local aliases"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("handler return type generated domain");
  });

  it("rejects manual command target validation in command handlers", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign, React } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function requireTarget(value: string): string {",
        "  return value;",
        "}",
        "function taskId(value: string): string {",
        "  return value;",
        "}",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(task: TaskCommand): TaskCreated {",
        "    requireTarget(task.target);",
        "    return task.id as unknown as TaskCreated;",
        "  }",
        "",
        "  @Assign",
        "  assignOther(command: TaskCommand): TaskCreated {",
        "    requireTarget(command.id);",
        "    taskId(command.id);",
        "    return command.created;",
        "  }",
        "",
        "  @React",
        "  reactToTask(event: TaskCreated): TaskCreated {",
        "    const id = event.id;",
        "    return event;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "manual target extraction"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('command target validation "target"');
    expect(result.stderr).toContain('command target validation "id"');
    expect(result.stderr).not.toContain("event.id");
  });

  it("rejects computed command target field validation", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function requireTarget(value: string): string {",
        "  return value;",
        "}",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): TaskCreated {",
        '    const id = requireTarget(command["id"]);',
        '    const target = requireTarget(command["target"]);',
        "    return { id, target } as TaskCreated;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "computed command id"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('command target validation "id"');
    expect(result.stderr).toContain('command target validation "target"');
  });

  it("rejects command target validation through wrapped command expressions", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function requireTarget(value: string): string {",
        "  return value;",
        "}",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    requireTarget(command!.id);",
        "    requireTarget((command).target);",
        "    requireTarget((command as TaskCommand).id);",
        "    return command.created;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "wrapped command validation"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('command target validation "id"');
    expect(result.stderr).toContain('command target validation "target"');
  });

  it("rejects command target validation through local aliases", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function requireTarget(value: string): string {",
        "  return value;",
        "}",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    const id = command.id;",
        "    const { target } = command;",
        "    requireTarget(id);",
        "    requireTarget(target);",
        "    return command.created;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "aliased command validation"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('command target validation "id"');
    expect(result.stderr).toContain('command target validation "target"');
  });

  it("rejects command target validation through chained local aliases", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function requireTarget(value: string): string {",
        "  return value;",
        "}",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    const commandId = command.id;",
        "    const id = commandId;",
        "    requireTarget(id);",
        "    return command.created;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "chained target alias"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('command target validation "id"');
  });

  it("rejects command target validation through object aliases", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function requireTarget(value: string): string {",
        "  return value;",
        "}",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    const route = { id: command.id };",
        "    requireTarget(route.id);",
        "    return command.created;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "object target alias"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('command target validation "id"');
  });

  it("rejects command target validation through command object aliases", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function requireTarget(value: string): string {",
        "  return value;",
        "}",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    const c = command;",
        "    const route = { id: command.id };",
        "    const { id } = route;",
        "    requireTarget(c.id);",
        "    requireTarget(id);",
        "    return command.created;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "command object alias"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('command target validation "id"');
  });

  it("rejects target validation from destructured command parameters", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function requireTarget(value: string): string {",
        "  return value;",
        "}",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask({ id }: TaskCommand): TaskCreated {",
        "    requireTarget(id);",
        "    return { id } as TaskCreated;",
        "  }",
        "",
        "  @Assign",
        "  assignAgain(command: TaskCommand): TaskCreated {",
        '    const { ["id"]: target } = command;',
        "    requireTarget(target);",
        "    return { id: target } as TaskCreated;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "destructured command target"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('command target validation "id"');
  });

  it("rejects command target validation through object-wrapped commands", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function requireTarget(value: string): string {",
        "  return value;",
        "}",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    const holder = { command };",
        "    requireTarget(holder.command.id);",
        "    return command.created;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "wrapped command"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('command target validation "id"');
  });

  it("rejects command-transforming @Command target validation", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Command } from "@spine-event-engine/server";',
        'import type { NotifyOwner, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function requireTarget(value: string): string {",
        "  return value;",
        "}",
        "",
        "class DemoProcess {",
        "  @Command",
        "  routeTask(command: TaskCommand): NotifyOwner {",
        "    requireTarget(command.id);",
        "    return command.notify;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "command transform target validation"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('command target validation "id"');
  });

  it("rejects command-transforming @Command target validation for real command names", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Command } from "@spine-event-engine/server";',
        'import type * as Todo from "../generated/example_pb.js";',
        'import type { CreateTask, NotifyOwner, ShipTask, TaskCommand } from "../generated/example_pb.js";',
        "",
        "type Incoming = TaskCommand;",
        "",
        "function requireTarget(value: string): string {",
        "  return value;",
        "}",
        "",
        "class DemoProcess {",
        "  @Command",
        "  routeCreate(command: CreateTask): NotifyOwner {",
        "    requireTarget(command.id);",
        "    return command.notify;",
        "  }",
        "",
        "  @Command",
        "  routeNamespaced(command: Todo.CreateTask): NotifyOwner {",
        "    requireTarget(command.id);",
        "    return command.notify;",
        "  }",
        "",
        "  @Command",
        "  routeAlias(command: Incoming): NotifyOwner {",
        "    requireTarget(command.id);",
        "    return command.notify;",
        "  }",
        "",
        "  @Command",
        "  routeShip(command: ShipTask): NotifyOwner {",
        "    requireTarget(command.id);",
        "    return command.notify;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "real command name target validation"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('command target validation "id"');
  });

  it("rejects target validation after inner shadow scope exits", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function requireTarget(value: string): string {",
        "  return value;",
        "}",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    const id = command.id;",
        "    {",
        "      {",
        "        const id = command.title;",
        "        void id;",
        "      }",
        "      requireTarget(id);",
        "    }",
        "    return command.created;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "restored target alias"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('command target validation "id"');
  });

  it("allows shadowed command target aliases in nested blocks", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function validate(value: string): void {",
        "  void value;",
        "}",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    const id = command.id;",
        "    {",
        "      const id = command.title;",
        "      validate(id);",
        "    }",
        "    return { id } as TaskCreated;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "shadowed target alias"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("allows nested blocks to shadow the command parameter name", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function validate(value: string): void {",
        "  void value;",
        "}",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    {",
        "      const command = { id: 'local' };",
        "      validate(command.id);",
        "    }",
        "    return command.created;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "shadowed command block"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("allows command-producing event handlers to read event ids", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Command } from "@spine-event-engine/server";',
        'import type { NotifyOwner, TaskCreated } from "../generated/example_pb.js";',
        "",
        "class DemoProcess {",
        "  @Command",
        "  whenTaskCreated(event: TaskCreated): NotifyOwner {",
        "    return { id: event.id } as NotifyOwner;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "command-producing event handler"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("allows command handlers to read target fields as domain data", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): TaskCreated {",
        '    const sameId = command["id"];',
        "    const { id } = command;",
        "    return { id, sameId } as TaskCreated;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "destructured command id"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("allows nested callbacks to rebind the command parameter name", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    return command.items.map((command) => command.id)[0].created;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "shadowed command"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("allows nested callbacks to rebind command target alias names", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function validate(value: string): void {",
        "  void value;",
        "}",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    const id = command.id;",
        "    command.items.map((id) => validate(id));",
        "    return { id } as TaskCreated;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "shadowed target callback"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("allows nested callbacks to destructure command target alias names", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function validate(value: string): void {",
        "  void value;",
        "}",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    const id = command.id;",
        "    command.items.map(({ id }) => validate(id));",
        "    return { id } as TaskCreated;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "destructured target callback"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("still checks unshadowed target aliases in mixed-shadow callbacks", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function requireTarget(value: string): string {",
        "  return value;",
        "}",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    const id = command.id;",
        "    const target = command.target;",
        "    command.items.map((id) => requireTarget(target));",
        "    command.items.map((command) => requireTarget(id));",
        "    return { id } as TaskCreated;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "mixed callback shadow"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('command target validation "target"');
    expect(result.stderr).toContain('command target validation "id"');
  });

  it("allows nested callbacks to shadow object target aliases", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function validate(value: string): void {",
        "  void value;",
        "}",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    const route = { id: command.id };",
        "    command.items.map((route) => validate(route.id));",
        "    return command.created;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "shadowed object target"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("accepts ordinary command business field reads in command handlers", () => {
    const repoRoot = createFixture();
    writeExampleSource(
      repoRoot,
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "",
        "function validate(value: string): void {",
        "  void value;",
        "}",
        "",
        "class DemoAggregate {",
        "  @Assign",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    const title = command.title;",
        "    const assigneeId = command.assigneeId;",
        "    const grid = command.grid;",
        "    validate(command.deadline);",
        "    return { ...command.created, title, assigneeId, grid };",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "business field reads"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("rejects tracked example symlinks that resolve outside the repo root", () => {
    const repoRoot = createFixture();
    const externalRoot = mkdtempSync(join(tmpdir(), "spine-cleanup-rules-external-"));
    writeFileSync(join(externalRoot, "outside.ts"), "export const leaked = true;\n");
    mkdirSync(join(repoRoot, "examples/todo/src"), { recursive: true });
    symlinkSync(join(externalRoot, "outside.ts"), join(repoRoot, "examples/todo/src/linked.ts"));
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "outside symlink"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "example source symlinks must resolve within the repository root",
    );
    expect(result.stderr).toContain("examples/todo/src/linked.ts");
    expect(result.stderr).not.toContain("leaked");
  });

  it("rejects tracked authored-code symlinks that resolve outside the repo root", () => {
    const repoRoot = createFixture();
    const externalRoot = mkdtempSync(join(tmpdir(), "spine-cleanup-rules-external-"));
    writeFileSync(join(externalRoot, "outside.ts"), "export const leakedSecretName = true;\n");
    symlinkSync(join(externalRoot, "outside.ts"), join(repoRoot, "packages/demo/src/linked.ts"));
    mkdirSync(join(repoRoot, "scripts"), { recursive: true });
    symlinkSync(join(externalRoot, "outside.ts"), join(repoRoot, "scripts/linked.mjs"));
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "outside authored symlink"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "authored code symlinks must resolve within the repository root",
    );
    expect(result.stderr).toContain("packages/demo/src/linked.ts");
    expect(result.stderr).toContain("scripts/linked.mjs");
    expect(result.stderr).not.toContain("leakedSecretName");
  });

  it("does not traverse package src symlinks while checking package tests", () => {
    const repoRoot = createFixture();
    const externalRoot = mkdtempSync(join(tmpdir(), "spine-cleanup-rules-external-"));
    mkdirSync(join(externalRoot, "src"), { recursive: true });
    writeFileSync(join(externalRoot, "src/index.test.ts"), "export const leakedTest = true;\n");
    rmSync(join(repoRoot, "packages/demo/src"), { recursive: true, force: true });
    rmSync(join(repoRoot, "build-protocol/standalone-function-necessities/T-0080H.json"), {
      force: true,
    });
    symlinkSync(join(externalRoot, "src"), join(repoRoot, "packages/demo/src"));
    run("git", ["add", "-A", "."], repoRoot);
    run("git", ["commit", "-m", "src symlink"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
    expect(result.stderr).not.toContain("leakedTest");
  });

  it("rejects tracked broken example symlinks as cleanup failures", () => {
    const repoRoot = createFixture();
    mkdirSync(join(repoRoot, "examples/todo/src"), { recursive: true });
    symlinkSync(
      join(repoRoot, "examples/todo/src/missing.ts"),
      join(repoRoot, "examples/todo/src/linked.ts"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "broken symlink"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "example source symlinks must resolve within the repository root",
    );
    expect(result.stderr).toContain("examples/todo/src/linked.ts cannot be resolved");
    expect(result.stderr).not.toContain("ENOENT");
  });

  it("scans .tsx, .mts, and .cts example source files", () => {
    const repoRoot = createFixture();
    mkdirSync(join(repoRoot, "examples/todo/src"), { recursive: true });
    writeFileSync(
      join(repoRoot, "examples/todo/src/view.tsx"),
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "class ViewAggregate {",
        "  @Assign(TaskCommand)",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    return command.created;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(repoRoot, "examples/todo/src/route.mts"),
      [
        'import { Apply } from "@spine-event-engine/server";',
        'import type { TaskCreated } from "../generated/example_pb.js";',
        "class RouteAggregate {",
        "  @Apply",
        "  applyTask(event: TaskCreated): void {",
        "    void event;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(repoRoot, "examples/todo/src/state.cts"),
      [
        'import { Command } from "@spine-event-engine/server";',
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "class StateAggregate {",
        "  @Command(TaskCommand)",
        "  routeTask(command: TaskCommand): TaskCommand {",
        "    return command;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "other source extensions"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("examples/todo/src/view.tsx:4 @Assign(...)");
    expect(result.stderr).toContain("examples/todo/src/route.mts:4 @Apply");
    expect(result.stderr).toContain("examples/todo/src/state.cts:4 @Command(...)");
  });

  it("recognizes import-equals framework imports in .cts example source", () => {
    const repoRoot = createFixture();
    mkdirSync(join(repoRoot, "examples/todo/src"), { recursive: true });
    writeFileSync(
      join(repoRoot, "examples/todo/src/state.cts"),
      [
        'import Server = require("@spine-event-engine/server");',
        'import Proto = require("@spine-event-engine/proto");',
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "class StateAggregate {",
        "  @Server.Assign(TaskCommand)",
        "  routeTask(command: TaskCommand): Proto.Event {",
        "    return command as Proto.Event;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "commonjs source imports"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@Assign(...)");
    expect(result.stderr).toContain("handler return type Proto.Event");
  });

  it("recognizes type-only import-equals proto aliases in .cts example source", () => {
    const repoRoot = createFixture();
    mkdirSync(join(repoRoot, "examples/todo/src"), { recursive: true });
    writeFileSync(
      join(repoRoot, "examples/todo/src/state.cts"),
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type Proto = require("@spine-event-engine/proto");',
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "class StateAggregate {",
        "  @Assign",
        "  routeTask(command: TaskCommand): Proto.Event {",
        "    return command as Proto.Event;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "type only commonjs proto"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("handler return type Proto.Event");
  });

  it("recognizes type-only import-equals proto member aliases in .cts example source", () => {
    const repoRoot = createFixture();
    mkdirSync(join(repoRoot, "examples/todo/src"), { recursive: true });
    writeFileSync(
      join(repoRoot, "examples/todo/src/state.cts"),
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type Proto = require("@spine-event-engine/proto");',
        "import type LegacyEvent = Proto.Event;",
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "class StateAggregate {",
        "  @Assign",
        "  routeTask(command: TaskCommand): LegacyEvent {",
        "    return command as LegacyEvent;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "type only commonjs proto member"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("handler return type LegacyEvent");
  });

  it("recognizes import-equals member aliases in .cts example source", () => {
    const repoRoot = createFixture();
    mkdirSync(join(repoRoot, "examples/todo/src"), { recursive: true });
    writeFileSync(
      join(repoRoot, "examples/todo/src/state.cts"),
      [
        'import Server = require("@spine-event-engine/server");',
        'import Proto = require("@spine-event-engine/proto");',
        "import Assign = Server.Assign;",
        "import LegacyEvent = Proto.Event;",
        "import Materialize = Server.materializeDecoratedEntityHandlers;",
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "class StateAggregate {",
        "  @Assign(TaskCommand)",
        "  routeTask(command: TaskCommand): LegacyEvent {",
        "    return command as LegacyEvent;",
        "  }",
        "}",
        "Materialize(StateAggregate);",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "commonjs member aliases"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@Assign(...)");
    expect(result.stderr).toContain("handler return type LegacyEvent");
    expect(result.stderr).toContain("materializeDecoratedEntityHandlers");
  });

  it("recognizes import-equals member aliases declared before namespaces", () => {
    const repoRoot = createFixture();
    mkdirSync(join(repoRoot, "examples/todo/src"), { recursive: true });
    writeFileSync(
      join(repoRoot, "examples/todo/src/state.cts"),
      [
        "import Assign = Server.Assign;",
        "import LegacyEvent = Proto.Event;",
        'import Server = require("@spine-event-engine/server");',
        'import Proto = require("@spine-event-engine/proto");',
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "class StateAggregate {",
        "  @Assign(TaskCommand)",
        "  routeTask(command: TaskCommand): LegacyEvent {",
        "    return command as LegacyEvent;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "early commonjs member aliases"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@Assign(...)");
    expect(result.stderr).toContain("handler return type LegacyEvent");
  });

  it("recognizes import-equals namespace aliases in .cts example source", () => {
    const repoRoot = createFixture();
    mkdirSync(join(repoRoot, "examples/todo/src"), { recursive: true });
    writeFileSync(
      join(repoRoot, "examples/todo/src/state.cts"),
      [
        'import Core = require("@spine-event-engine/core");',
        'import Server = require("@spine-event-engine/server");',
        'import Proto = require("@spine-event-engine/proto");',
        "import C = Core;",
        "import S = Server;",
        "import P = Proto;",
        'import type { TaskCommand } from "../generated/example_pb.js";',
        "class StateAggregate {",
        "  @S.Assign(TaskCommand)",
        "  routeTask(command: TaskCommand): P.Event {",
        "    return command as P.Event;",
        "  }",
        "}",
        "C.packEvent({});",
        "S.materializeDecoratedEntityHandlers(StateAggregate);",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "commonjs namespace aliases"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@Assign(...)");
    expect(result.stderr).toContain("handler return type P.Event");
    expect(result.stderr).toContain("packEvent");
    expect(result.stderr).toContain("materializeDecoratedEntityHandlers");
  });

  it("terminates when import-equals aliases conflict", () => {
    const repoRoot = createFixture();
    mkdirSync(join(repoRoot, "examples/todo/src"), { recursive: true });
    writeFileSync(
      join(repoRoot, "examples/todo/src/state.cts"),
      [
        'import Server = require("@spine-event-engine/server");',
        "import Alias = Server.Assign;",
        "import Alias = Server.Command;",
        'import type { TaskCommand, TaskCreated } from "../generated/example_pb.js";',
        "class StateAggregate {",
        "  @Alias(TaskCommand)",
        "  routeTask(command: TaskCommand): TaskCreated {",
        "    return command.created;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "conflicting commonjs aliases"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@Assign(...)");
  });

  it("scans nested example source folders", () => {
    const repoRoot = createFixture();
    mkdirSync(join(repoRoot, "examples/group/todo/src"), { recursive: true });
    writeFileSync(
      join(repoRoot, "examples/group/todo/src/index.ts"),
      [
        'import { Assign } from "@spine-event-engine/server";',
        'import type { TaskCreated, TaskCommand } from "../generated/example_pb.js";',
        "class NestedAggregate {",
        "  @Assign(TaskCommand)",
        "  assignTask(command: TaskCommand): TaskCreated {",
        "    return command.created;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "nested example"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("examples/group/todo/src/index.ts:4 @Assign(...)");
  });
});
