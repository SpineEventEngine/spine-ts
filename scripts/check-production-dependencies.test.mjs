import { describe, expect, it } from "vitest";

import { productionDependencyProblems } from "./check-production-dependencies.mjs";

describe("production dependency policy", () => {
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
});
