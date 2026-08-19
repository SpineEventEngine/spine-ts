import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const applicationRoot = join(repositoryRoot, "examples/message-board/app");
const applicationPackage = JSON.parse(readFileSync(join(applicationRoot, "package.json"), "utf8"));

describe("MessageBoard packed runtime", () => {
  it("declares compiled runtime commands without a workspace build at startup", () => {
    expect(applicationPackage.scripts).toMatchObject({
      start: "node dist/src/local-application-server.js",
      "start:application": "node dist/src/application-server.js",
      "start:combined": "node dist/src/combined-server.js",
    });
    expect(applicationPackage.files).toContain("dist");
    expect(applicationPackage.scripts.start).not.toMatch(/pnpm|tsc|spine-proto/u);
  });
});
