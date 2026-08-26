import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { frameworkPackageNames } from "./package-artifacts.mjs";
import { createPublicationWorkspace } from "./release-cli.mjs";

const root = new URL("..", import.meta.url).pathname;

async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  return port;
}

async function waitForRegistry(registry) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(registry + "/-/ping")).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Local Verdaccio did not start");
}

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

  it("publishes only a strict selected workspace to pinned local Verdaccio", async () => {
    const fixture = mkdtempSync(join(tmpdir(), "spine-lerna-publish-"));
    const port = await unusedPort();
    const registry = "http://127.0.0.1:" + port;
    const source = join(fixture, "source");
    const selected = join(fixture, "selected");
    const dependentOnly = join(fixture, "dependent-only");
    const suffix = Date.now();
    const base = "@t0221/base-" + suffix;
    const dependent = "@t0221/dependent-" + suffix;
    const omitted = "@t0221/omitted-" + suffix;
    const entries = [
      ["base", base, {}, {}],
      [
        "dependent",
        dependent,
        { dependencies: { [base]: "workspace:*" } },
        { dependencies: { [base]: "1.0.0" } },
      ],
      ["omitted", omitted, {}, {}],
    ].map(([directory, name, rootExtra, stagedExtra]) => {
      const packageDirectory = join(source, "packages", directory);
      mkdirSync(join(packageDirectory, ".publish"), { recursive: true });
      const manifest = {
        name,
        version: "1.0.0",
        publishConfig: { access: "public" },
        ...rootExtra,
      };
      writeFileSync(join(packageDirectory, "package.json"), JSON.stringify(manifest));
      writeFileSync(
        join(packageDirectory, ".publish", "package.json"),
        JSON.stringify({ ...manifest, ...stagedExtra }),
      );
      writeFileSync(join(packageDirectory, ".publish", "selected-marker.txt"), name + "\n");
      return { path: "packages/" + directory + "/package.json", manifest };
    });
    writeFileSync(
      join(fixture, "verdaccio.yaml"),
      [
        "storage: " + join(fixture, "storage"),
        "auth:",
        "  htpasswd:",
        "    file: " + join(fixture, "htpasswd"),
        "    max_users: -1",
        "uplinks: {}",
        "packages:",
        "  '@*/*':",
        "    access: $all",
        "    publish: $all",
        "  '**':",
        "    access: $all",
        "    publish: $all",
      ].join("\n"),
    );
    const registryProcess = spawn(
      join(root, "node_modules/.bin/verdaccio"),
      ["--config", join(fixture, "verdaccio.yaml"), "--listen", "127.0.0.1:" + port],
      { stdio: "ignore" },
    );
    const makeWorkspace = (destination, names) =>
      createPublicationWorkspace({
        destination,
        entries,
        selectedNames: names,
        mkdir: (path) => mkdirSync(path, { recursive: true }),
        write: writeFileSync,
        copy: (from, target) => cpSync(join(source, from), target, { recursive: true }),
      });
    const publish = (workspace) =>
      spawnSync(
        join(root, "node_modules/.bin/lerna"),
        [
          "publish",
          "from-package",
          "--contents",
          ".publish",
          "--concurrency",
          "1",
          "--ignore-scripts",
          "--dist-tag",
          "snapshot",
          "--registry",
          registry,
          "--git-head",
          "0000000000000000000000000000000000000000",
          "--no-git-reset",
          "--yes",
        ],
        { cwd: workspace, encoding: "utf8" },
      );
    try {
      await waitForRegistry(registry);
      makeWorkspace(selected, [base, dependent]);
      const initial = publish(selected);
      expect(initial.status, initial.stdout + initial.stderr).toBe(0);
      expect(initial.stdout + initial.stderr).toMatch(new RegExp(base + "[\\s\\S]*" + dependent));
      expect(initial.stdout + initial.stderr).not.toContain(omitted);
      const tarball = await fetch(registry + "/" + base.replace("/", "%2f"));
      expect(tarball.ok).toBe(true);
      const packument = await tarball.json();
      expect(packument.versions["1.0.0"].dist.tarball).toContain(base);
      makeWorkspace(dependentOnly, [dependent]);
      const rerun = publish(dependentOnly);
      expect(rerun.status).toBe(0);
      expect(rerun.stdout + rerun.stderr).toContain("No unpublished release found");
      const omittedRead = await fetch(registry + "/" + omitted.replace("/", "%2f"));
      expect(omittedRead.status).toBe(404);
    } finally {
      registryProcess.kill("SIGTERM");
      rmSync(fixture, { force: true, recursive: true });
    }
  }, 30_000);
});
