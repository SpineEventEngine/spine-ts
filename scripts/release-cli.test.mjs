import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPublicationWorkspace,
  main,
  prepareRelease,
  stageReleaseContents,
} from "./release-cli.mjs";
import { frameworkPackageNames } from "./package-artifacts.mjs";

describe("release CLI", () => {
  it.each(["publish", "verify-registry"])("rejects the removed %s command", (command) => {
    const result = spawnSync(process.execPath, ["scripts/release-cli.mjs", command], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_ACTIONS: undefined,
        GITHUB_EVENT_NAME: undefined,
        GITHUB_REPOSITORY: undefined,
        GITHUB_REF: undefined,
        GITHUB_SHA: undefined,
        GITHUB_WORKFLOW: undefined,
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Supported commands");
  });

  it("prints the policy-derived tag without a publication capability", async () => {
    const result = spawnSync(process.execPath, ["scripts/release-cli.mjs", "tag"], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("snapshot\n");
    await expect(main({ argv: ["node", "cli", "publish"], environment: {} })).rejects.toThrow(
      "Supported commands",
    );
  });

  it("routes each safe command through injected dependencies without public fetches", async () => {
    const release = {
      tag: "snapshot",
      version: "2.0.0-snapshot.5",
      packages: [{ name: "@synthetic/base" }],
    };
    const calls = [];
    const dependencies = {
      expectedModel: () => release,
      readManifests: (root) => {
        calls.push({ kind: "read", root });
        return [];
      },
      fetchResponse: "safe-fetch",
      verifyRegistry: (...args) => calls.push({ kind: "verify", args }),
      write: (text) => calls.push({ kind: "write", text }),
    };
    await main({ argv: ["node", "cli", "tag"], dependencies });
    await main({ argv: ["node", "cli", "preflight"], dependencies });
    await main({
      argv: ["node", "cli", "prepare", "--output", "relative-release"],
      dependencies: {
        ...dependencies,
        prepare: (options) => calls.push({ kind: "prepare", options }),
      },
    });
    expect(calls).toContainEqual({ kind: "write", text: "snapshot\n" });
    expect(calls.filter(({ kind }) => kind === "verify")).toEqual([
      { kind: "verify", args: [release, "safe-fetch"] },
    ]);
    expect(calls).toContainEqual({
      kind: "prepare",
      options: { check: false, output: "relative-release" },
    });
  });

  it("creates an isolated non-Git workspace from only the strict missing selection", () => {
    const writes = [];
    const copies = [];
    const directories = [];
    const entries = [
      {
        path: "packages/base/package.json",
        manifest: { name: "@synthetic/base", version: "1.0.0" },
      },
      {
        path: "packages/unselected/package.json",
        manifest: { name: "@synthetic/unselected", version: "1.0.0" },
      },
    ];
    createPublicationWorkspace({
      destination: "/owned/publication",
      entries,
      selectedNames: ["@synthetic/base"],
      mkdir: (path) => directories.push(path),
      write: (path, contents) => writes.push({ path, contents }),
      copy: (source, target) => copies.push({ source, target }),
    });
    expect(directories).toEqual([
      "/owned/publication/packages",
      "/owned/publication/packages/base",
    ]);
    expect(writes.map(({ path }) => path)).toEqual([
      "/owned/publication/package.json",
      "/owned/publication/pnpm-workspace.yaml",
      "/owned/publication/lerna.json",
      "/owned/publication/packages/base/package.json",
    ]);
    expect(copies).toEqual([
      {
        source: "packages/base/.publish",
        target: "/owned/publication/packages/base/.publish",
      },
    ]);
    for (const selection of [[], ["@synthetic/missing"], ["@synthetic/base", "@synthetic/base"]])
      expect(() =>
        createPublicationWorkspace({
          destination: "/owned/publication",
          entries,
          selectedNames: selection,
          mkdir: () => {},
          write: () => {},
          copy: () => {},
        }),
      ).toThrow("Publication workspace");
  });

  it("routes strict selection into a disposable workspace and fails closed before creation", async () => {
    const release = {
      tag: "snapshot",
      version: "2.0.0-snapshot.5",
      packages: [{ name: "@synthetic/base" }],
    };
    const calls = [];
    const output = join(tmpdir(), "spine-release-cli-workspace-" + Date.now());
    const dependencies = {
      expectedModel: () => release,
      fetchResponse: "safe-fetch",
      readManifests: () => [
        { path: "packages/base/package.json", manifest: { name: "@synthetic/base" } },
      ],
      createWorkspace: (options) => calls.push(options),
    };
    await main({
      argv: ["node", "cli", "prepare-publication-workspace", "--output", output],
      dependencies: { ...dependencies, verifyRegistry: () => ["@synthetic/base"] },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ selectedNames: ["@synthetic/base"] });
    for (const selection of [[], ["@other/package"], ["@synthetic/base", "@synthetic/base"]])
      await expect(
        main({
          argv: ["node", "cli", "prepare-publication-workspace", "--output", output],
          dependencies: { ...dependencies, verifyRegistry: () => selection },
        }),
      ).rejects.toThrow("Strict registry selection");
    await expect(
      main({ argv: ["node", "cli", "prepare-publication-workspace"], dependencies }),
    ).rejects.toThrow("requires --output");
  });

  it("routes checked preparation and rejects a missing output", async () => {
    const prepare = vi.fn();
    await main({ argv: ["node", "cli", "prepare", "--check"], dependencies: { prepare } });
    expect(prepare).toHaveBeenCalledWith({ check: true, output: undefined });
    await expect(main({ argv: ["node", "cli", "prepare"] })).rejects.toThrow("requires");
  });

  it("prepares and cleans the real checked staged release without registry mutation", async () => {
    const release = await main({ argv: ["node", "cli", "prepare", "--check"] });
    expect(release).toMatchObject({ tag: "snapshot", version: "2.0.0-snapshot.7" });
    expect(release.packages).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "@spine-event-engine/core" })]),
    );
  }, 30_000);

  it("packs once, proves the exact returned list, and cleans check output", () => {
    const removed = [];
    const expected = {
      tag: "snapshot",
      version: "2.0.0-snapshot.4",
      packages: frameworkPackageNames
        .map((name) => ({ name, dependencies: [] }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
    const packages = expected.packages.map(({ name }, index) => ({
      name,
      tarball: "/tmp/release/" + index + ".tgz",
      integrity: "sha512-YQ==",
      dependencies: [],
    }));
    prepareRelease({
      root: "root",
      check: true,
      mkdtemp: () => "/tmp/release",
      exists: () => false,
      mkdir: () => {},
      remove: (path) => removed.push(path),
      pack: () => packages,
      prove: ({ packages: actual }) => expect(actual).toBe(packages),
      expected,
    });
    expect(removed).toEqual(["/tmp/release"]);
  });

  it("does not delete an existing explicit output", () => {
    expect(() => prepareRelease({ output: "/existing", exists: () => true })).toThrow(
      "already exists",
    );
  });

  it("stages every packed package under its Lerna contents directory", () => {
    const runs = [];
    const destination = mkdtempSync(join(tmpdir(), "spine-release-stage-test-"));
    try {
      stageReleaseContents({
        destination,
        packages: [
          { name: "@synthetic/base", tarball: "/tmp/base.tgz" },
          { name: "@synthetic/dependent", tarball: "/tmp/dependent.tgz" },
        ],
        run: (command, args) => runs.push({ command, args }),
      });
      expect(runs).toEqual([
        {
          command: "tar",
          args: [
            "-xzf",
            "/tmp/base.tgz",
            "--strip-components=1",
            "-C",
            join(destination, "packages/base/.publish"),
          ],
        },
        {
          command: "tar",
          args: [
            "-xzf",
            "/tmp/dependent.tgz",
            "--strip-components=1",
            "-C",
            join(destination, "packages/dependent/.publish"),
          ],
        },
      ]);
    } finally {
      rmSync(destination, { force: true, recursive: true });
    }
  });

  it.each(["pack", "prove", "stage"])("removes owned output when %s fails", (phase) => {
    const removed = [];
    const expected = {
      tag: "snapshot",
      version: "2.0.0-snapshot.4",
      packages: frameworkPackageNames
        .map((name) => ({ name, dependencies: [] }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
    const packages = expected.packages.map(({ name }, index) => ({
      name,
      tarball: "/owned/" + index + ".tgz",
      integrity: "sha512-YQ==",
      dependencies: [],
    }));
    expect(() =>
      prepareRelease({
        output: "/owned",
        exists: () => false,
        mkdir: () => {},
        remove: (path) => removed.push(path),
        pack: () => {
          if (phase === "pack") throw new Error(phase);
          return packages;
        },
        prove: () => {
          if (phase === "prove") throw new Error(phase);
        },
        stage: () => {
          if (phase === "stage") throw new Error(phase);
        },
        expected,
      }),
    ).toThrow(phase);
    expect(removed).toEqual(["/owned"]);
  });

  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ])("cleans owned output for %s", (signal, code) => {
    const handlers = new Map();
    const removed = [];
    expect(() =>
      prepareRelease({
        output: "/owned",
        exists: () => false,
        mkdir: () => {},
        remove: (path) => removed.push(path),
        pack: () => {
          handlers.get(signal)();
          throw new Error("stop");
        },
        registerSignal: (name, handler) => {
          handlers.set(name, handler);
          return () => {};
        },
        exit: (actual) => {
          expect(actual).toBe(code);
          throw new Error("exit sentinel");
        },
      }),
    ).toThrow("exit sentinel");
    expect(handlers.has(signal)).toBe(true);
    expect(removed).toEqual(["/owned"]);
  });

  it("rejects prepare without an output mode", async () => {
    await expect(main({ argv: ["node", "cli", "prepare"], environment: {} })).rejects.toThrow(
      "requires --check or --output",
    );
  });
});
