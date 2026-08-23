import { describe, expect, it } from "vitest";

import { productionDependencyProblems } from "./check-production-dependencies.mjs";

describe("production dependency policy", () => {
  it("rejects vulnerable resolved brace-expansion and uuid versions", () => {
    expect(
      productionDependencyProblems(
        [
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
});
