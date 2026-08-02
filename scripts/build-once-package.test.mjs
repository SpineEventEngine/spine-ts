import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const applicationRoot = join(repositoryRoot, "examples/message-board/app");
const applicationPackage = JSON.parse(readFileSync(join(applicationRoot, "package.json"), "utf8"));

describe("MessageBoard packed runtime", () => {
  it("ships compiled runtime entrypoints without a workspace build at startup", () => {
    expect(applicationPackage.private).not.toBe(true);
    expect(applicationPackage.scripts).toMatchObject({
      "start:application": "node dist/src/application-entry.js",
      "start:combined": "node dist/src/combined-entry.js",
    });
    expect(applicationPackage.files).toContain("dist");
    expect(existsSync(join(applicationRoot, "src/application-entry.ts"))).toBe(true);
    expect(existsSync(join(applicationRoot, "src/combined-entry.ts"))).toBe(true);
  });
});
