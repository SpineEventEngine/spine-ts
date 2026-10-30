import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildOutputPaths,
  cleanBuildOutputs,
  restoreMetadataAdapters,
} from "./clean-build-outputs.mjs";

describe("cleanBuildOutputs", () => {
  it("covers every project referenced by the root build", () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const configuration = JSON.parse(readFileSync(resolve(repoRoot, "tsconfig.json"), "utf8"));
    const referencedOutputs = configuration.references.map(
      ({ path }) => `${path.replace(/^\.\//u, "")}/dist`,
    );

    expect(buildOutputPaths).toEqual(referencedOutputs);
  });

  it("cleans private fixture package outputs required by plain Node consumers", () => {
    expect(buildOutputPaths).toEqual(
      expect.arrayContaining([
        "packages/server/test-fixtures/dist",
        "packages/core/test-fixtures/dist",
        "packages/testing/test-fixtures/dist",
      ]),
    );
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

  it("restores both prior emitted adapters if the second publication fails", () => {
    const root = mkdtempSync(resolve(tmpdir(), "spine-adapter-restore-"));
    const generated = resolve(root, "examples/todo/generated");
    const output = resolve(root, "examples/todo/dist/generated");
    mkdirSync(generated, { recursive: true });
    mkdirSync(output, { recursive: true });
    writeFileSync(
      resolve(generated, "spine-dependencies.json"),
      JSON.stringify({
        formatVersion: 2,
        edges: [],
        inputs: [],
        runtime: [
          { path: "dist/generated/spine-dependencies.js", source: "new-js\n" },
          { path: "dist/generated/spine-dependencies.d.ts", source: "new-types\n" },
        ],
      }),
    );
    const javascript = resolve(output, "spine-dependencies.js");
    const declarations = resolve(output, "spine-dependencies.d.ts");
    writeFileSync(javascript, "old-js\n");
    writeFileSync(declarations, "old-types\n");
    let failed = false;

    expect(() =>
      restoreMetadataAdapters(root, {
        rename(from, to) {
          if (!failed && to === declarations && from.includes(".spine-dependencies-")) {
            failed = true;
            throw new Error("injected publication failure");
          }
          renameSync(from, to);
        },
      }),
    ).toThrow("injected publication failure");
    expect(readFileSync(javascript, "utf8")).toBe("old-js\n");
    expect(readFileSync(declarations, "utf8")).toBe("old-types\n");
  });

  it("restores both emitted adapter files from a fresh record", () => {
    const root = mkdtempSync(resolve(tmpdir(), "spine-adapter-restore-"));
    const generated = resolve(root, "examples/todo/generated");
    mkdirSync(generated, { recursive: true });
    writeFileSync(
      resolve(generated, "spine-dependencies.json"),
      JSON.stringify({
        formatVersion: 2,
        edges: [],
        inputs: [],
        runtime: [
          { path: "dist/generated/spine-dependencies.js", source: "exports.metadata = 1;\n" },
          { path: "dist/generated/spine-dependencies.d.ts", source: "export {};\n" },
        ],
      }),
    );

    restoreMetadataAdapters(root);
    expect(
      readFileSync(resolve(root, "examples/todo/dist/generated/spine-dependencies.js"), "utf8"),
    ).toBe("exports.metadata = 1;\n");
    expect(
      readFileSync(resolve(root, "examples/todo/dist/generated/spine-dependencies.d.ts"), "utf8"),
    ).toBe("export {};\n");
  });

  it("requires regeneration when an adapter input changes", () => {
    const root = mkdtempSync(resolve(tmpdir(), "spine-adapter-stale-"));
    const app = resolve(root, "examples/todo");
    const generated = resolve(app, "generated");
    mkdirSync(generated, { recursive: true });
    writeFileSync(resolve(app, "package.json"), "next\n");
    const prior = createHash("sha256").update("prior\n").digest("hex");
    writeFileSync(
      resolve(generated, "spine-dependencies.json"),
      JSON.stringify({
        formatVersion: 2,
        edges: [],
        inputs: [{ path: "package.json", hash: prior }],
        runtime: [],
      }),
    );

    expect(() => restoreMetadataAdapters(root)).toThrow(/regenerate handlers.*package.json/u);
  });

  it("requires regeneration when a previously absent optional participant is installed", () => {
    const root = mkdtempSync(resolve(tmpdir(), "spine-adapter-edge-"));
    const app = resolve(root, "examples/todo");
    const generated = resolve(app, "generated");
    mkdirSync(generated, { recursive: true });
    writeFileSync(
      resolve(app, "package.json"),
      '{"name":"app","optionalDependencies":{"model":"1"}}',
    );
    writeFileSync(
      resolve(generated, "spine-dependencies.json"),
      JSON.stringify({
        formatVersion: 2,
        inputs: [],
        edges: [{ requester: ".", name: "model", resolved: null }],
        runtime: [],
      }),
    );
    restoreMetadataAdapters(root);
    mkdirSync(resolve(app, "node_modules/model"), { recursive: true });
    writeFileSync(resolve(app, "node_modules/model/package.json"), '{"name":"model"}');

    expect(() => restoreMetadataAdapters(root)).toThrow(/regenerate handlers.*model/u);
  });

  it("rejects an unsafe recorded adapter path before publication", () => {
    const root = mkdtempSync(resolve(tmpdir(), "spine-adapter-unsafe-"));
    const generated = resolve(root, "examples/todo/generated");
    mkdirSync(generated, { recursive: true });
    writeFileSync(
      resolve(generated, "spine-dependencies.json"),
      JSON.stringify({
        formatVersion: 2,
        edges: [],
        inputs: [],
        runtime: [{ path: "../outside/spine-dependencies.js", source: "bad\n" }],
      }),
    );

    expect(() => restoreMetadataAdapters(root)).toThrow(/Unsafe generated dependency adapter/u);
  });

  it("rejects a bootstrap missing its adapter restoration record", () => {
    const root = mkdtempSync(resolve(tmpdir(), "spine-adapter-missing-"));
    const generated = resolve(root, "examples/todo/generated");
    mkdirSync(generated, { recursive: true });
    writeFileSync(resolve(generated, "spine-bootstrap.ts"), "export {};\n");

    expect(() => restoreMetadataAdapters(root)).toThrow(
      /Missing generated dependency adapter record/u,
    );
  });
});
