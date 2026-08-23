import { describe, expect, it } from "vitest";

import { productionDependencyProblems } from "./check-production-dependencies.mjs";

describe("production dependency policy", () => {
  it.each([
    [
      "direct unresolved",
      "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      uuid: 9.0.1\npackages: {}\nsnapshots: {}",
      "unresolved production dependency",
    ],
    [
      "array importers",
      "lockfileVersion: '9.0'\nimporters: []\npackages: {}\nsnapshots: {}",
      "importers must be a mapping",
    ],
  ])("fails closed for %s", (_name, lockfile, message) => {
    expect(() => productionDependencyProblems(lockfile)).toThrow(message);
  });
  it("rejects vulnerable resolved brace-expansion and uuid versions", () => {
    expect(
      productionDependencyProblems(
        [
          "lockfileVersion: '9.0'",
          "importers:",
          "  .:",
          "    dependencies:",
          "      brace-expansion: 2.1.3",
          "      uuid: 9.0.1",
          "packages:",
          "  brace-expansion@2.1.3:",
          "  uuid@9.0.1:",
          "snapshots:",
          "  brace-expansion@2.1.3: {}",
          "  uuid@9.0.1: {}",
        ].join("\n"),
      ),
    ).toEqual([
      "Production lockfile resolves vulnerable brace-expansion@2.1.3.",
      "Production lockfile resolves vulnerable uuid@9.0.1.",
    ]);
  });

  it("accepts fixed production dependency resolutions", () => {
    expect(
      productionDependencyProblems(
        [
          "lockfileVersion: '9.0'",
          "importers:",
          "  .:",
          "    dependencies:",
          "      brace-expansion: 2.1.4",
          "      uuid: 11.1.1",
          "packages:",
          "  brace-expansion@2.1.4:",
          "  uuid@11.1.1:",
          "snapshots:",
          "  brace-expansion@2.1.4: {}",
          "  uuid@11.1.1: {}",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("fails closed for malformed lockfile schema", () => {
    expect(() => productionDependencyProblems("lockfileVersion: '9.0'\n")).toThrow(
      "missing importers",
    );
  });

  it("ignores dev-only vulnerable dependencies but follows production transitively", () => {
    expect(
      productionDependencyProblems(
        [
          "lockfileVersion: '9.0'",
          "importers:",
          "  .:",
          "    dependencies:",
          "      app: 1.0.0",
          "    devDependencies:",
          "      uuid: 9.0.1",
          "packages:",
          "  app@1.0.0:",
          "    dependencies:",
          "      uuid: 9.0.1",
          "  uuid@9.0.1: {}",
          "snapshots:",
          "  app@1.0.0:",
          "    dependencies:",
          "      uuid: 9.0.1",
          "  uuid@9.0.1: {}",
        ].join("\n"),
      ),
    ).toEqual(["Production lockfile resolves vulnerable uuid@9.0.1."]);
  });

  it("parses quoted package keys and accepts a fixed optional dependency", () => {
    expect(
      productionDependencyProblems(
        [
          "lockfileVersion: '9.0'",
          "importers:",
          "  .:",
          "    optionalDependencies:",
          "      brace-expansion: 2.1.4",
          "packages:",
          "  'brace-expansion@2.1.4': {}",
          "snapshots:",
          "  'brace-expansion@2.1.4': {}",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("rejects an unresolved transitive production dependency", () => {
    expect(() =>
      productionDependencyProblems(
        "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      app: 1.0.0\npackages:\n  app@1.0.0: {}\nsnapshots:\n  app@1.0.0:\n    dependencies:\n      uuid: 9.0.1",
      ),
    ).toThrow("unresolved production dependency uuid@9.0.1");
  });

  it("skips valid workspace links and resolves registry aliases", () => {
    expect(
      productionDependencyProblems(
        "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      local: link:../local\n      wrap-ansi-cjs: wrap-ansi@7.0.0\npackages:\n  wrap-ansi@7.0.0: {}\nsnapshots:\n  wrap-ansi@7.0.0: {}",
      ),
    ).toEqual([]);
  });

  it.each([
    ["uuid: 9.0.1", "uuid@9.0.1", ["Production lockfile resolves vulnerable uuid@9.0.1."]],
    ["uuid: 11.1.1", "uuid@11.1.1", []],
  ])("checks peer-qualified exact snapshots", (dependency, key, expected) => {
    expect(
      productionDependencyProblems(
        `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      app: 1.0.0(peer@1.0.0)\npackages:\n  app@1.0.0: {}\n  ${key}: {}\nsnapshots:\n  app@1.0.0(peer@1.0.0):\n    dependencies:\n      ${dependency}\n  ${key}: {}`,
      ),
    ).toEqual(expected);
  });
});
