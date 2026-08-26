import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { frameworkPackageNames } from "./package-artifacts.mjs";
import { createPublicationWorkspace } from "./release-cli.mjs";

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
    expect(
      packages
        .filter((entry) => !entry.private)
        .map(({ name }) => name)
        .sort(),
    ).toEqual([...frameworkPackageNames].sort());
  });

  it("honors a disposable non-Git workspace that contains only strict selected packages", () => {
    const fixture = mkdtempSync(join(tmpdir(), "spine-lerna-selection-"));
    const source = join(fixture, "source");
    const destination = join(fixture, "publication");
    const entries = [
      ["base", "@synthetic/base"],
      ["unselected", "@synthetic/unselected"],
    ].map(([directory, name]) => {
      const packageDirectory = join(source, "packages", directory);
      mkdirSync(join(packageDirectory, ".publish"), { recursive: true });
      const manifest = { name, version: "1.0.0", publishConfig: { access: "public" } };
      writeFileSync(join(packageDirectory, "package.json"), JSON.stringify(manifest));
      writeFileSync(join(packageDirectory, ".publish", "package.json"), JSON.stringify(manifest));
      return { path: "packages/" + directory + "/package.json", manifest };
    });
    try {
      createPublicationWorkspace({
        destination,
        entries,
        selectedNames: ["@synthetic/base"],
        mkdir: (path) => mkdirSync(path, { recursive: true }),
        write: writeFileSync,
        copy: (sourcePath, target) => cpSync(join(source, sourcePath), target, { recursive: true }),
      });
      const result = spawnSync(join(root, "node_modules/.bin/lerna"), ["list", "--all", "--json"], {
        cwd: destination,
        encoding: "utf8",
      });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).map(({ name }) => name)).toEqual(["@synthetic/base"]);
      expect(result.stdout).not.toContain("@synthetic/unselected");
    } finally {
      rmSync(fixture, { force: true, recursive: true });
    }
  });
});
