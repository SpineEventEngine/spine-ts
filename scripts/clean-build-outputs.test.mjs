import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildOutputPaths, cleanBuildOutputs } from "./clean-build-outputs.mjs";

describe("cleanBuildOutputs", () => {
  it("covers every project referenced by the root build", () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const configuration = JSON.parse(readFileSync(resolve(repoRoot, "tsconfig.json"), "utf8"));
    const referencedOutputs = configuration.references.map(
      ({ path }) => `${path.replace(/^\.\//u, "")}/dist`,
    );

    expect(buildOutputPaths).toEqual(referencedOutputs);
  });

  it("removes the generated output of every root TypeScript project", () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const removed = [];

    cleanBuildOutputs({
      exists: () => true,
      status: () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
      remove: (target) => removed.push(target),
    });

    expect(removed).toEqual(buildOutputPaths.map((path) => resolve(repoRoot, path)));
  });

  it("fails closed when an output target is not a real directory", () => {
    expect(() =>
      cleanBuildOutputs({
        exists: () => true,
        status: () => ({ isDirectory: () => false, isSymbolicLink: () => false }),
        remove: () => expect.unreachable(),
      }),
    ).toThrow(/must be a directory/u);
  });
});
