import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = new URL("..", import.meta.url).pathname;

function readJson(path) {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
}

describe("package metadata", () => {
  it("runs proto generation before commands that consume generated modules", () => {
    const rootPackage = readJson("package.json");

    expect(rootPackage.scripts["typecheck:build"]).toMatch(/^pnpm proto:generate && /);
    expect(rootPackage.scripts["docs:api"]).toMatch(/^pnpm proto:generate && /);
    expect(rootPackage.scripts["docs:check"]).toMatch(/^pnpm proto:generate && /);

    const verify = rootPackage.scripts.verify;
    expect(verify.indexOf("pnpm proto:generate")).toBeLessThan(verify.indexOf("pnpm typecheck"));
  });

  it("exports generated proto modules with extensionless and .js ESM subpaths", () => {
    const protoPackage = readJson("packages/proto/package.json");

    expect(protoPackage.exports["./generated/*"]).toEqual({
      types: "./dist/generated/*.d.ts",
      default: "./dist/generated/*.js",
    });
    expect(protoPackage.exports["./generated/*.js"]).toEqual({
      types: "./dist/generated/*.d.ts",
      default: "./dist/generated/*.js",
    });
  });
});
