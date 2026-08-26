import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { frameworkPackageNames } from "./package-artifacts.mjs";
import { createPublicationWorkspace } from "./release-cli.mjs";

const root = new URL("..", import.meta.url).pathname;

async function localRegistry() {
  const records = new Map();
  const requests = [];
  const server = createServer((request, response) => {
    const name = decodeURIComponent((request.url ?? "").slice(1));
    requests.push({ method: request.method, name });
    if (request.method === "GET") {
      const record = records.get(name);
      response.writeHead(record === undefined ? 404 : 200, { "content-type": "application/json" });
      response.end(JSON.stringify(record ?? {}));
      return;
    }
    if (request.method !== "PUT") {
      response.writeHead(405).end();
      return;
    }
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) request.destroy();
    });
    request.on("end", () => {
      try {
        const record = JSON.parse(body);
        if (
          record.name !== name ||
          typeof record.versions !== "object" ||
          typeof record["dist-tags"] !== "object" ||
          typeof record._attachments !== "object"
        )
          throw new Error("invalid package document");
        records.set(name, record);
        response.writeHead(201, { "content-type": "application/json" }).end("{}");
      } catch {
        response.writeHead(400).end("{}");
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return { records, requests, server, url: "http://127.0.0.1:" + port };
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

  it("publishes staged selected packages and resumes a true partial release locally", async () => {
    const fixture = mkdtempSync(join(tmpdir(), "spine-lerna-registry-"));
    const registry = await localRegistry();
    const source = join(fixture, "source");
    const suffix = Date.now();
    const base = "@t0221/base-" + suffix;
    const dependent = "@t0221/dependent-" + suffix;
    const omitted = "@t0221/omitted-" + suffix;
    const freshBase = "@t0221/fresh-base-" + suffix;
    const freshDependent = "@t0221/fresh-dependent-" + suffix;
    const freshOmitted = "@t0221/fresh-omitted-" + suffix;
    const entries = [
      ["base", base, {}, {}],
      [
        "dependent",
        dependent,
        { dependencies: { [base]: "workspace:*" } },
        { dependencies: { [base]: "1.0.0" } },
      ],
      ["omitted", omitted, {}, {}],
      ["fresh-base", freshBase, {}, {}],
      [
        "fresh-dependent",
        freshDependent,
        { dependencies: { [freshBase]: "workspace:*" } },
        { dependencies: { [freshBase]: "1.0.0" } },
      ],
      ["fresh-omitted", freshOmitted, {}, {}],
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
      writeFileSync(join(packageDirectory, ".publish", "selected-marker.txt"), name);
      return { path: "packages/" + directory + "/package.json", manifest };
    });
    const workspace = async (directory, names) => {
      createPublicationWorkspace({
        destination: directory,
        entries,
        selectedNames: names,
        mkdir: (path) => mkdirSync(path, { recursive: true }),
        write: writeFileSync,
        copy: (from, target) => cpSync(join(source, from), target, { recursive: true }),
      });
      return await new Promise((resolve) => {
        const child = spawn(
          join(root, "node_modules/.bin/lerna"),
          [
            "publish",
            "from-package",
            "--contents",
            ".publish",
            "--concurrency",
            "1",
            "--ignore-scripts",
            "--no-git-reset",
            "--dist-tag",
            "snapshot",
            "--registry",
            registry.url,
            "--git-head",
            "0000000000000000000000000000000000000000",
            "--yes",
          ],
          { cwd: directory },
        );
        let output = "";
        child.stdout.on("data", (chunk) => (output += chunk));
        child.stderr.on("data", (chunk) => (output += chunk));
        child.on("close", (status) => resolve({ status, stdout: output, stderr: "" }));
      });
    };
    try {
      const fresh = await workspace(join(fixture, "fresh"), [freshBase, freshDependent]);
      expect(fresh.status).toBe(0);
      expect(
        registry.requests.filter(({ method }) => method === "PUT").map(({ name }) => name),
      ).toEqual([freshBase, freshDependent]);
      expect(registry.requests.some(({ name }) => name === freshOmitted)).toBe(false);
      registry.requests.length = 0;
      const first = await workspace(join(fixture, "base-only"), [base]);
      expect(first.status).toBe(0);
      registry.requests.length = 0;
      const partial = await workspace(join(fixture, "partial"), [base, dependent]);
      expect(partial.status).toBe(0);
      expect(
        registry.requests.filter(({ method }) => method === "PUT").map(({ name }) => name),
      ).toEqual([dependent]);
      expect(registry.requests.some(({ name }) => name === omitted)).toBe(false);
      const attachment = Object.values(registry.records.get(dependent)._attachments)[0].data;
      const tar = gunzipSync(Buffer.from(attachment, "base64")).toString("utf8");
      expect(tar).toContain("selected-marker.txt");
      expect(tar).toContain('"' + base + '":"1.0.0"');
      registry.requests.length = 0;
      const rerun = await workspace(join(fixture, "rerun"), [base, dependent]);
      expect(rerun.status).toBe(0);
      expect(rerun.stdout + rerun.stderr).toContain("No unpublished release found");
      expect(registry.requests.filter(({ method }) => method === "PUT")).toEqual([]);
    } finally {
      registry.server.close();
      rmSync(fixture, { force: true, recursive: true });
    }
  }, 30_000);
});
