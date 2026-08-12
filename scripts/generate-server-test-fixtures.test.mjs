import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderFixtureModule } from "./generate-server-test-fixtures.mjs";

const scriptPath = fileURLToPath(new URL("./generate-server-test-fixtures.mjs", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

describe("generate-server-test-fixtures", () => {
  it("renders the exact shared current-year header before generated TSDoc", () => {
    expect(renderFixtureModule(2027)).toMatch(
      /^\/\*\n \* Copyright 2027, CodeMatters\. All rights reserved\.[\s\S]*? \*\/\n\n\/\*\*/u,
    );
  });

  it("keeps checked-in descriptor blobs synchronized with readable proto sources", () => {
    const result = spawnSync(process.execPath, [scriptPath, "--check"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });
});
