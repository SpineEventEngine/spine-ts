import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = new URL("..", import.meta.url).pathname;

function readJson(path) {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
}

describe("package metadata", () => {
  it("keeps standalone commands self-sufficient while verify publishes generated output once", () => {
    const rootPackage = readJson("package.json");

    expect(rootPackage.scripts["typecheck:build"]).toMatch(/^pnpm proto:generate && /);
    expect(rootPackage.scripts.lint).toMatch(/^pnpm proto:generate && /);
    expect(rootPackage.scripts["docs:api"]).toMatch(/^pnpm proto:generate && /);
    expect(rootPackage.scripts["docs:check"]).toMatch(/^pnpm proto:generate && /);

    const verify = rootPackage.scripts.verify;
    const generatedVerify = rootPackage.scripts["verify:generated"];

    expect(verify.match(/pnpm proto:generate/gu)).toHaveLength(1);
    expect(verify).toContain("pnpm verify:generated");
    expect(generatedVerify).toContain("pnpm typecheck:generated");
    expect(generatedVerify).toContain("pnpm lint:generated");
    expect(generatedVerify).toContain("pnpm test:generated");
    expect(generatedVerify).toContain("pnpm test:coverage:generated");
    expect(generatedVerify).toContain("pnpm docs:check:generated");
    expect(generatedVerify).toContain("pnpm proto:check-generated");
    expect(generatedVerify).not.toContain("pnpm proto:generate");
  });

  it("exports exactly the curated Proto contract entrypoints", () => {
    const protoPackage = readJson("packages/proto/package.json");

    expect(protoPackage.exports).toEqual({
      ".": {
        types: "./dist/src/index.d.ts",
        default: "./dist/src/index.js",
      },
      "./client": {
        types: "./dist/src/client/index.d.ts",
        default: "./dist/src/client/index.js",
      },
      "./delivery": {
        types: "./dist/src/delivery/index.d.ts",
        default: "./dist/src/delivery/index.js",
      },
      "./delivery-server": {
        types: "./dist/src/delivery-server/index.d.ts",
        default: "./dist/src/delivery-server/index.js",
      },
    });
  });
});
