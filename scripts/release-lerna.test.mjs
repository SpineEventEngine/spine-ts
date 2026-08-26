import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;

describe("Lerna workspace discovery", () => {
  it("uses the pnpm workspace for externally versioned publication without Nx tasks", () => {
    expect(JSON.parse(readFileSync(join(root, "lerna.json"), "utf8"))).toEqual({
      version: "independent",
      npmClient: "pnpm",
      useNx: false,
    });
  });

  it("discovers all workspace packages while retaining the exact 18 public package boundary", () => {
    const result = spawnSync("pnpm", ["exec", "lerna", "list", "--all", "--json"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const packages = JSON.parse(result.stdout);
    expect(packages).toHaveLength(25);
    expect(packages.filter((entry) => entry.private)).toHaveLength(7);
    expect(packages.filter((entry) => !entry.private)).toHaveLength(18);
  });
});
