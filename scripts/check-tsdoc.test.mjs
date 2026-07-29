import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = new URL("./check-tsdoc.mjs", import.meta.url).pathname;

function createFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "spine-tsdoc-"));

  run("git", ["init"], repoRoot);
  run("git", ["config", "user.email", "test@example.invalid"], repoRoot);
  run("git", ["config", "user.name", "Test User"], repoRoot);
  mkdirSync(join(repoRoot, "packages/demo/src"), { recursive: true });
  writeFileSync(join(repoRoot, "packages/demo/package.json"), '{"name":"demo"}\n');
  writeFileSync(join(repoRoot, "packages/demo/src/index.ts"), validSource());
  run("git", ["add", "."], repoRoot);
  run("git", ["commit", "--quiet", "-m", "fixture"], repoRoot);

  return repoRoot;
}

function validSource() {
  return [
    "/** Represents a documented item. */",
    "export interface Item {",
    "  /** Describes the item name. */",
    "  readonly name: string;",
    "}",
    "",
    "/** Creates an item from a name.\n * @param name The item name.\n * @returns The created item.\n */",
    "export function createsItem(name: string): Item {",
    "  return { name };",
    "}",
    "",
  ].join("\n");
}

function writeSource(repoRoot, path, source) {
  const target = join(repoRoot, path);
  mkdirSync(target.slice(0, target.lastIndexOf("/")), { recursive: true });
  writeFileSync(target, source);
}

function writeDebt(repoRoot, entries) {
  const path = join(repoRoot, "build-protocol/tsdoc-debt/T-0080H.json");
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr}${result.stdout}`);
  }
}

function track(repoRoot) {
  run("git", ["add", "."], repoRoot);
  run("git", ["commit", "--quiet", "-m", "source"], repoRoot);
}

function runChecker(repoRoot) {
  return spawnSync(process.execPath, [scriptPath, "--repo-root", repoRoot], { encoding: "utf8" });
}

describe("check-tsdoc", () => {
  it("accepts documented exported declarations and public members", () => {
    const result = runChecker(createFixture());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("TSDoc enforcement checks passed.");
  });

  it("rejects absent comments, incomplete parameter tags, and missing results", () => {
    const repoRoot = createFixture();
    writeSource(
      repoRoot,
      "packages/demo/src/index.ts",
      [
        "export function makesItem(name: string, count: number): string {",
        "  return `${name}:${count}`;",
        "}",
        "",
      ].join("\n"),
    );
    track(repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing-summary");
    expect(result.stderr).toContain("missing-param");
    expect(result.stderr).toContain("missing-returns");
    expect(result.stderr).toContain("packages/demo/src/index.ts :: makesItem");
  });

  it("checks nested example source while excluding generated and tests", () => {
    const repoRoot = createFixture();
    writeSource(repoRoot, "examples/chat/app/src/nested/entry.ts", "export const value = 1;\n");
    writeSource(
      repoRoot,
      "examples/chat/app/src/generated/value.ts",
      "export const ignored = 1;\n",
    );
    writeSource(repoRoot, "examples/chat/app/src/entry.test.ts", "export const ignored = 1;\n");
    track(repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("examples/chat/app/src/nested/entry.ts :: value");
    expect(result.stderr).not.toContain("generated/value.ts");
    expect(result.stderr).not.toContain("entry.test.ts");
  });

  it("requires third-person callable summaries and honest return tags", () => {
    const repoRoot = createFixture();
    writeSource(
      repoRoot,
      "packages/demo/src/index.ts",
      [
        "/** Create an item.\n * @param name The name.\n * @returns Nothing.\n */",
        "export async function createItem(name: string): Promise<void> {",
        "  void name;",
        "}",
        "",
      ].join("\n"),
    );
    track(repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("callable-summary");
    expect(result.stderr).toContain("void-returns");
  });

  it("covers constructors, accessors, overloads, and arrow exports", () => {
    const repoRoot = createFixture();
    writeSource(
      repoRoot,
      "packages/demo/src/index.ts",
      [
        "/** Represents a demo. */",
        "export class Demo {",
        "  constructor(readonly value: string) {}",
        "  get label(): string { return this.value; }",
        "}",
        "",
        "export function finds(value: string): string;",
        "/** Finds a value.\n * @param value The value.\n * @returns The found value.\n */",
        "export function finds(value: string): string { return value; }",
        "",
        "export const maps = (value: string): string => value;",
        "",
      ].join("\n"),
    );
    track(repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Demo.constructor");
    expect(result.stderr).toContain("Demo.label");
    expect(result.stderr).toContain("finds");
    expect(result.stderr).toContain("maps");
  });

  it("allows only exact observed debt and rejects stale debt", () => {
    const repoRoot = createFixture();
    writeSource(repoRoot, "packages/demo/src/index.ts", "export const value = 1;\n");
    writeDebt(repoRoot, [
      { rule: "missing-summary", file: "packages/demo/src/index.ts", name: "value" },
    ]);
    track(repoRoot);

    const accepted = runChecker(repoRoot);
    expect(accepted.status).toBe(0);

    writeDebt(repoRoot, [
      { rule: "missing-summary", file: "packages/demo/src/index.ts", name: "other" },
    ]);
    track(repoRoot);
    const stale = runChecker(repoRoot);
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain("stale-debt");
    expect(stale.stderr).toContain("missing-summary");
  });

  it("uses semantic return types for inferred void, Promise<void>, and non-void callables", () => {
    const repoRoot = createFixture();
    writeSource(
      repoRoot,
      "packages/demo/src/index.ts",
      [
        "/** Performs work. */",
        "export const performsWork = () => {};",
        "/** Performs async work. */",
        "export const performsAsyncWork = async () => {};",
        "/** Finds a value.\n * @returns The found value.\n */",
        "export const findsValue = () => 'value';",
        "",
      ].join("\n"),
    );
    track(repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
  });

  it("follows public barrel exports without requiring re-export comments", () => {
    const repoRoot = createFixture();
    writeSource(
      repoRoot,
      "packages/demo/src/thing.ts",
      "/** Represents a thing. */\nexport class Thing {}\n",
    );
    writeSource(repoRoot, "packages/demo/src/index.ts", "export { Thing } from './thing.js';\n");
    track(repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
  });

  it("checks declarations made public through a local export list", () => {
    const repoRoot = createFixture();
    writeSource(repoRoot, "packages/demo/src/index.ts", "class Hidden {}\nexport { Hidden };\n");
    track(repoRoot);
    const result = runChecker(repoRoot);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Hidden");
  });

  it("checks callable properties and public index call and construct signatures", () => {
    const repoRoot = createFixture();
    writeSource(
      repoRoot,
      "packages/demo/src/index.ts",
      [
        "/** Describes a callable contract. */",
        "export interface Contract {",
        "  run: (value: string) => string;",
        "  [name: string]: string;",
        "  (value: string): string;",
        "  new (value: string): Contract;",
        "}",
        "",
      ].join("\n"),
    );
    track(repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Contract.run");
    expect(result.stderr).toContain("Contract.index");
    expect(result.stderr).toContain("Contract.call");
    expect(result.stderr).toContain("Contract.construct");
  });

  it("gives overloads distinct stable identities and follows recursive destructuring", () => {
    const repoRoot = createFixture();
    writeSource(
      repoRoot,
      "packages/demo/src/index.ts",
      [
        "/** Finds a value.\n * @param first The first value.\n */",
        "export function finds(first: string): string;",
        "export function finds(second: number): string;",
        "/** Finds a value.\n * @param nested The nested values.\n * @returns A value.\n */",
        "export function finds({ nested: [first, { second }] }: { nested: [string, { second: string }] }): string {",
        "  return first + second;",
        "}",
        "",
      ].join("\n"),
    );
    track(repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("finds#1");
    expect(result.stderr).toContain("finds#2");
    expect(result.stderr).toContain("finds#3");
    expect(result.stderr).toContain("missing-param");
  });

  it("does not duplicate inherited documentation requirements", () => {
    const repoRoot = createFixture();
    writeSource(
      repoRoot,
      "packages/demo/src/index.ts",
      [
        "/** Represents a base. */",
        "export class Base {",
        "  /** Gets a value.\n   * @returns The value.\n   */",
        "  get value(): string { return 'value'; }",
        "}",
        "/** Represents a child. */",
        "export class Child extends Base {}",
        "",
      ].join("\n"),
    );
    track(repoRoot);

    expect(runChecker(repoRoot).status).toBe(0);
  });

  it("rejects placeholder tag descriptions and stale or duplicate tags", () => {
    const repoRoot = createFixture();
    writeSource(
      repoRoot,
      "packages/demo/src/index.ts",
      [
        "/** Finds a value.\n * @param value TODO\n * @param value The duplicate.\n * @param unused The unused value.\n * @returns TBD\n */",
        "export function finds(value: string): string { return value; }",
        "",
      ].join("\n"),
    );
    track(repoRoot);

    const result = runChecker(repoRoot);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("duplicate-or-malformed-param");
    expect(result.stderr).toContain("stale-param");
    expect(result.stderr).toContain("missing-returns-description");
  });

  it("confines broken and escaping symlink sources with escaped deterministic diagnostics", () => {
    const repoRoot = createFixture();
    const external = mkdtempSync(join(tmpdir(), "spine-tsdoc-external-"));
    writeFileSync(join(external, "escape.ts"), "export const escaped = 1;\n");
    symlinkSync(join(external, "escape.ts"), join(repoRoot, "packages/demo/src/escape\u202e.ts"));
    symlinkSync(join(repoRoot, "missing.ts"), join(repoRoot, "packages/demo/src/broken.ts"));
    run(
      "git",
      ["add", "-f", "packages/demo/src/escape\u202e.ts", "packages/demo/src/broken.ts"],
      repoRoot,
    );
    run("git", ["commit", "--quiet", "-m", "symlinks"], repoRoot);

    const result = runChecker(repoRoot);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("path-confinement");
    expect(result.stderr).toContain("\\u{202e}");
  });

  it("checks enums namespaces and anonymous default exports", () => {
    const repoRoot = createFixture();
    writeSource(
      repoRoot,
      "packages/demo/src/index.ts",
      [
        "/** Describes a state. */",
        "export enum State { Ready }",
        "/** Groups values. */",
        "export namespace Values { export const value = 1; }",
        "/** Represents a default item. */",
        "export default class {}",
        "",
      ].join("\n"),
    );
    track(repoRoot);
    const result = runChecker(repoRoot);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("State.Ready");
    expect(result.stderr).toContain("Values.value");
  });

  it("rejects malformed duplicate and wrong-partition debt entries", () => {
    const repoRoot = createFixture();
    writeDebt(repoRoot, [
      { rule: "missing-summary", file: "packages/demo/src/index.ts", name: "value" },
    ]);
    writeSource(repoRoot, "build-protocol/tsdoc-debt/T-0080D.json", "not json\n");
    track(repoRoot);
    const malformed = runChecker(repoRoot);
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain("Malformed TSDoc debt partition");
  });

  it("rejects duplicate and wrong-partition debt entries", () => {
    const duplicateRoot = createFixture();
    const entry = { rule: "missing-summary", file: "packages/demo/src/index.ts", name: "value" };
    writeSource(duplicateRoot, "packages/demo/src/index.ts", "export const value = 1;\n");
    writeDebt(duplicateRoot, [entry, entry]);
    track(duplicateRoot);
    expect(runChecker(duplicateRoot).stderr).toContain("Duplicate TSDoc debt entry");

    const wrongRoot = createFixture();
    writeSource(wrongRoot, "packages/demo/src/index.ts", "export const value = 1;\n");
    const wrongPath = join(wrongRoot, "build-protocol/tsdoc-debt/T-0080D.json");
    mkdirSync(wrongPath.slice(0, wrongPath.lastIndexOf("/")), { recursive: true });
    writeFileSync(wrongPath, `${JSON.stringify([entry])}\n`);
    track(wrongRoot);
    expect(runChecker(wrongRoot).stderr).toContain("Wrong TSDoc debt partition");
  });

  it("checks local and default exported bindings without requiring barrel comments", () => {
    const repoRoot = createFixture();
    writeSource(
      repoRoot,
      "packages/demo/src/index.ts",
      "const value = 1;\nconst callable = (name: string) => name;\nexport { value };\nexport default callable;\n",
    );
    track(repoRoot);
    const result = runChecker(repoRoot);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("value");
    expect(result.stderr).toContain("callable");
  });

  it("checks object API and class callable members including referenced implementations", () => {
    const repoRoot = createFixture();
    writeSource(
      repoRoot,
      "packages/demo/src/index.ts",
      [
        "const shared = (value: string): string => value;",
        "/** Provides operations. */",
        "export const api = { run(value: string): string { return value; }, map: (value: string): string => value };",
        "/** Represents a holder. */",
        "export class Holder { run = (value: string): string => value; map: (value: string) => string = shared; }",
        "",
      ].join("\n"),
    );
    track(repoRoot);
    const result = runChecker(repoRoot);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("api.run");
    expect(result.stderr).toContain("api.map");
    expect(result.stderr).toContain("Holder.run");
    expect(result.stderr).toContain("Holder.map");
  });

  it("uses construct and non-identifier property identities deterministically", () => {
    const repoRoot = createFixture();
    writeSource(
      repoRoot,
      "packages/demo/src/index.ts",
      [
        "/** Describes a contract. */",
        "export interface Contract { new (value: string): Contract; 'run-value': string; 1: string; }",
        "",
      ].join("\n"),
    );
    track(repoRoot);
    const result = runChecker(repoRoot);
    expect(result.stderr).toContain("Contract.construct(");
    expect(result.stderr).toContain("Contract.'run-value'");
    expect(result.stderr).toContain("Contract.1");
  });

  it("excludes spec and test-directory sources and accepts inheritDoc overrides", () => {
    const repoRoot = createFixture();
    writeSource(repoRoot, "packages/demo/src/value.spec.ts", "export const ignored = 1;\n");
    writeSource(repoRoot, "packages/demo/src/test/value.ts", "export const ignored = 1;\n");
    writeSource(
      repoRoot,
      "packages/demo/src/index.ts",
      [
        "/** Represents a base. */",
        "export class Base {\n/** Gets a value.\n * @returns The value.\n */\nget value(): string { return 'x'; }\n}",
        "/** Represents a child. */",
        "export class Child extends Base {\n/** @inheritDoc */\nget value(): string { return 'x'; }\n}",
        "",
      ].join("\n"),
    );
    track(repoRoot);
    expect(runChecker(repoRoot).status).toBe(0);
  });

  it("accepts common third-person framework verbs", () => {
    const repoRoot = createFixture();
    writeSource(
      repoRoot,
      "packages/demo/src/index.ts",
      "/** Dispatches a value.\n * @param value The value.\n */\nexport function dispatches(value: string): void {}\n",
    );
    track(repoRoot);
    expect(runChecker(repoRoot).status).toBe(0);
  });

  it("rejects unverified inheritDoc while accepting a documented implemented member", () => {
    const invalidRoot = createFixture();
    writeSource(
      invalidRoot,
      "packages/demo/src/index.ts",
      "/** @inheritDoc */\nexport function finds(value: string): string { return value; }\n",
    );
    track(invalidRoot);
    const invalid = runChecker(invalidRoot);
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("invalid-inheritdoc");
    expect(invalid.stderr).toContain("missing-summary");
    expect(invalid.stderr).toContain("missing-param");
    expect(invalid.stderr).toContain("missing-returns");

    const validRoot = createFixture();
    writeSource(
      validRoot,
      "packages/demo/src/index.ts",
      [
        "/** Describes a contract. */",
        "export interface Contract {",
        "  /** Finds a value.\n   * @param value The lookup value.\n   * @returns The found value.\n   */",
        "  finds(value: string): string;",
        "}",
        "/** Implements the documented contract. */",
        "export class Implementation implements Contract {",
        "  /** @inheritDoc */",
        "  finds(value: string): string { return value; }",
        "}",
        "",
      ].join("\n"),
    );
    track(validRoot);
    expect(runChecker(validRoot).status).toBe(0);
  });

  it("checks default expression exports and recursive object and type-literal APIs", () => {
    const repoRoot = createFixture();
    writeSource(
      repoRoot,
      "packages/demo/src/default-arrow.ts",
      ["export default (value: string): string => value;", ""].join("\n"),
    );
    writeSource(
      repoRoot,
      "packages/demo/src/default-object.ts",
      [
        "export default { nested: { maps: (value: string): string => value } };",
        "export type Mapper = (value: string) => string;",
        "export type Factory = new (value: string) => Mapper;",
        "export type Contract = { nested: { run: (value: string) => string; create: new (value: string) => Mapper } };",
        "",
      ].join("\n"),
    );
    track(repoRoot);
    const result = runChecker(repoRoot);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("default");
    expect(result.stderr).toContain("default.nested.maps");
    expect(result.stderr).toContain("Mapper");
    expect(result.stderr).toContain("Factory");
    expect(result.stderr).toContain("Contract.nested.run");
    expect(result.stderr).toContain("Contract.nested.create");
  });

  it("accepts a documented local callable exported through a default binding", () => {
    const repoRoot = createFixture();
    writeSource(
      repoRoot,
      "packages/demo/src/index.ts",
      [
        "/** Finds a value.\n * @param value The lookup value.\n * @returns The found value.\n */",
        "const finds = (value: string): string => value;",
        "export default finds;",
        "",
      ].join("\n"),
    );
    track(repoRoot);
    expect(runChecker(repoRoot).status).toBe(0);
  });

  it("gives indirect overloads and merged members distinct debt identities", () => {
    const repoRoot = createFixture();
    writeSource(
      repoRoot,
      "packages/demo/src/index.ts",
      [
        "function finds(value: string): string;",
        "function finds(value: number): string;",
        "function finds(value: string | number): string { return String(value); }",
        "interface Contract { run: string; }",
        "interface Contract { run: string; }",
        "export { finds, Contract };",
        "",
      ].join("\n"),
    );
    track(repoRoot);
    const result = runChecker(repoRoot);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("finds#1");
    expect(result.stderr).toContain("finds#2");
    expect(result.stderr).toContain("finds#3");
    expect(result.stderr).toContain("Contract#1.run");
    expect(result.stderr).toContain("Contract#2.run");

    writeDebt(repoRoot, [
      {
        rule: "missing-summary",
        file: "packages/demo/src/index.ts",
        name: "Contract#1:InterfaceDeclaration",
      },
    ]);
    track(repoRoot);
    const withOneDebtEntry = runChecker(repoRoot);
    expect(withOneDebtEntry.status).toBe(1);
    expect(withOneDebtEntry.stderr).toContain("Contract#2:InterfaceDeclaration");
  });

  it("orders non-ASCII diagnostics by ordinal code point", () => {
    const repoRoot = createFixture();
    writeSource(
      repoRoot,
      "packages/demo/src/index.ts",
      "export const é = 1;\nexport const z = 1;\n",
    );
    track(repoRoot);
    const result = runChecker(repoRoot);
    expect(result.status).toBe(1);
    expect(result.stderr.indexOf(":: z")).toBeLessThan(result.stderr.indexOf(":: é"));
  });
});
