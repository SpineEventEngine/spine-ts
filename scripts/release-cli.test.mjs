import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPublicationWorkspace,
  main,
  prepareRelease,
  recoverPublication,
  stageReleaseContents,
  supervisePublicationProcess,
} from "./release-cli.mjs";
import { frameworkPackageNames } from "./package-artifacts.mjs";

describe("release CLI", () => {
  it("retries only strict missing names after a delayed partial publication", async () => {
    const release = {
      tag: "snapshot",
      version: "2.0.0-snapshot.5",
      packages: [{ name: "@synthetic/base" }, { name: "@synthetic/dependent" }],
    };
    const attempts = [];
    const waits = [];
    const removed = [];
    const inspections = [
      { state: "partial", missingNames: ["@synthetic/dependent"] },
      { state: "complete", missingNames: [] },
    ];
    await expect(
      recoverPublication({
        release,
        initialNames: ["@synthetic/base", "@synthetic/dependent"],
        inspect: async () => inspections.shift(),
        wait: async (milliseconds) => waits.push(milliseconds),
        createWorkspace: async ({ selectedNames, destination }) => {
          attempts.push({ selectedNames, destination });
        },
        runLerna: async () => ({ status: 1, signal: null }),
        mkdtemp: (prefix) => prefix + attempts.length,
        remove: (directory) => removed.push(directory),
      }),
    ).resolves.toEqual({ status: 1, signal: null, recovered: true });
    expect(waits).toEqual([90_000, 180_000]);
    expect(attempts.map(({ selectedNames }) => selectedNames)).toEqual([
      ["@synthetic/base", "@synthetic/dependent"],
      ["@synthetic/dependent"],
    ]);
    expect(removed).toHaveLength(2);
  });

  it("does not invoke Lerna a fourth time after the final delayed inspection", async () => {
    const calls = [];
    await expect(
      recoverPublication({
        release: {
          tag: "snapshot",
          version: "2.0.0-snapshot.5",
          packages: [{ name: "@synthetic/base" }],
        },
        initialNames: ["@synthetic/base"],
        inspect: async () => ({ state: "partial", missingNames: ["@synthetic/base"] }),
        wait: async () => {},
        createWorkspace: async () => {},
        runLerna: async () => {
          calls.push("lerna");
          return { status: 1, signal: "SIGTERM" };
        },
        mkdtemp: (prefix) => prefix + calls.length,
        remove: () => {},
      }),
    ).rejects.toThrow("remaining packages: @synthetic/base; last status: 1; last signal: SIGTERM");
    expect(calls).toHaveLength(3);
  });

  it("retries a partial registry state even when Lerna exits successfully", async () => {
    const calls = [];
    const waits = [];
    const selections = [];
    const inspections = [
      { state: "partial", missingNames: ["@synthetic/dependent"] },
      { state: "complete", missingNames: [] },
    ];
    await expect(
      recoverPublication({
        release: {
          packages: [{ name: "@synthetic/base" }, { name: "@synthetic/dependent" }],
        },
        initialNames: ["@synthetic/base", "@synthetic/dependent"],
        inspect: async () => inspections.shift(),
        wait: async (milliseconds) => waits.push(milliseconds),
        createWorkspace: async ({ selectedNames }) => selections.push(selectedNames),
        runLerna: async () => {
          calls.push("lerna");
          return { status: 0, signal: null };
        },
        mkdtemp: (prefix) => prefix + calls.length,
        remove: () => {},
      }),
    ).resolves.toMatchObject({ recovered: true, status: 0 });
    expect(calls).toHaveLength(2);
    expect(selections).toEqual([
      ["@synthetic/base", "@synthetic/dependent"],
      ["@synthetic/dependent"],
    ]);
    expect(waits).toEqual([90_000, 180_000]);
  });

  it("fails closed when the delayed registry inspection reports a wrong tag after status zero", async () => {
    const runLerna = vi.fn(async () => ({ status: 0, signal: null }));
    await expect(
      recoverPublication({
        release: { packages: [{ name: "@synthetic/base" }] },
        initialNames: ["@synthetic/base"],
        inspect: async () => {
          throw new Error("selected tag");
        },
        wait: async () => {},
        createWorkspace: async () => {},
        runLerna,
        mkdtemp: () => "/temporary/workspace",
        remove: () => {},
      }),
    ).rejects.toThrow("selected tag");
    expect(runLerna).toHaveBeenCalledTimes(1);
  });

  it("accepts status zero only after a delayed exact complete inspection", async () => {
    const waits = [];
    await expect(
      recoverPublication({
        release: { packages: [{ name: "@synthetic/base" }] },
        initialNames: ["@synthetic/base"],
        inspect: async () => ({ state: "complete", missingNames: [] }),
        wait: async (milliseconds) => waits.push(milliseconds),
        createWorkspace: async () => {},
        runLerna: async () => ({ status: 0, signal: null }),
        mkdtemp: () => "/temporary/workspace",
        remove: () => {},
      }),
    ).resolves.toMatchObject({ status: 0 });
    expect(waits).toEqual([90_000]);
  });

  it("cleans the publication parent for SIGINT and preserves its exit code", async () => {
    const handlers = new Map();
    const removed = [];
    let parentCleanups = 0;
    await expect(
      recoverPublication({
        release: { packages: [{ name: "@synthetic/base" }] },
        initialNames: ["@synthetic/base"],
        inspect: async () => ({ state: "complete", missingNames: [] }),
        wait: async () => {},
        createWorkspace: async () => {},
        runLerna: async () => handlers.get("SIGINT")(),
        mkdtemp: () => "/temporary/workspace",
        remove: (directory) => removed.push(directory),
        cleanup: () => parentCleanups++,
        registerSignal: (signal, handler) => {
          handlers.set(signal, handler);
          return () => {};
        },
        exit: (code) => {
          expect(code).toBe(130);
          throw new Error("signal exit");
        },
      }),
    ).rejects.toThrow("signal exit");
    expect(removed).toContain("/temporary/workspace");
    expect(removed.filter((directory) => directory === "/temporary/workspace")).toHaveLength(1);
    expect(parentCleanups).toBe(1);
  });

  it("terminates a real running child before signal cleanup", async () => {
    const handlers = new Map();
    const removed = [];
    const wait = vi.fn();
    const inspect = vi.fn(async () => ({ state: "complete", missingNames: [] }));
    let closed = false;
    let closeSignal;
    const completion = recoverPublication({
      release: { packages: [{ name: "@synthetic/base" }] },
      initialNames: ["@synthetic/base"],
      inspect,
      wait,
      createWorkspace: async () => {},
      runLerna: ({ onChild }) =>
        supervisePublicationProcess({
          command: process.execPath,
          args: [
            "-e",
            "process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setInterval(() => {}, 1000)",
          ],
          cwd: process.cwd(),
          timeoutMs: 5_000,
          forceKillGraceMs: 20,
          spawnOptions: { stdio: "pipe" },
          onChild: ({ child, terminate }) => {
            onChild({ child, terminate });
            child.once("close", (_status, signal) => {
              closed = true;
              closeSignal = signal;
            });
            child.stdout.once("data", () => handlers.get("SIGINT")());
          },
        }),
      mkdtemp: () => "/temporary/workspace",
      remove: (directory) => removed.push(directory),
      cleanup: () => removed.push("/temporary/parent"),
      registerSignal: (signal, handler) => {
        handlers.set(signal, handler);
        return () => {};
      },
      exit: (code) => {
        expect(code).toBe(130);
        expect(closed).toBe(true);
        throw new Error("signal exit");
      },
    });
    await expect(completion).rejects.toThrow("signal exit");
    expect(removed).toEqual(["/temporary/workspace", "/temporary/parent"]);
    expect(wait).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(closeSignal).toBe("SIGKILL");
  });

  it("terminates and cleans a stalled publication child at its deadline", async () => {
    const removed = [];
    let closed = false;
    let closeSignal;
    await expect(
      recoverPublication({
        release: { packages: [{ name: "@synthetic/base" }] },
        initialNames: ["@synthetic/base"],
        inspect: async () => ({ state: "complete", missingNames: [] }),
        wait: async () => {},
        createWorkspace: async () => {},
        runLerna: ({ onChild }) =>
          (() => {
            let ready;
            const readyPromise = new Promise((resolveReady) => (ready = resolveReady));
            return supervisePublicationProcess({
              command: process.execPath,
              args: [
                "-e",
                "process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setInterval(() => {}, 1000)",
              ],
              cwd: process.cwd(),
              timeoutMs: 20,
              forceKillGraceMs: 20,
              spawnOptions: { stdio: "pipe" },
              onChild: ({ child, terminate }) => {
                onChild({ child, terminate });
                child.stdout.once("data", () => ready());
                child.once("close", (_status, signal) => {
                  closed = true;
                  closeSignal = signal;
                });
              },
              waitForStart: readyPromise,
            });
          })(),
        mkdtemp: () => "/temporary/workspace",
        remove: (directory) => removed.push(directory),
        cleanup: () => removed.push("/temporary/parent"),
      }),
    ).rejects.toThrow("timed out");
    expect(closed).toBe(true);
    expect(closeSignal).toBe("SIGKILL");
    expect(removed).toEqual(["/temporary/workspace", "/temporary/parent"]);
  });

  it("rejects invalid initial and delayed partial selections before Lerna", async () => {
    const runLerna = vi.fn(async () => ({ status: 1, signal: null }));
    const base = {
      release: { packages: [{ name: "@synthetic/base" }] },
      inspect: async () => ({ state: "partial", missingNames: [] }),
      wait: async () => {},
      createWorkspace: async () => {},
      runLerna,
      mkdtemp: () => "/temporary/workspace",
      remove: () => {},
    };
    await expect(recoverPublication({ ...base, initialNames: [] })).rejects.toThrow("selection");
    await expect(
      recoverPublication({ ...base, initialNames: ["@synthetic/base"] }),
    ).rejects.toThrow("selection");
    expect(runLerna).toHaveBeenCalledTimes(1);
  });

  it("cancels after workspace preparation before starting Lerna", async () => {
    const handlers = new Map();
    const runLerna = vi.fn();
    const wait = vi.fn();
    const inspect = vi.fn();
    const removed = [];
    await expect(
      recoverPublication({
        release: { packages: [{ name: "@synthetic/base" }] },
        initialNames: ["@synthetic/base"],
        createWorkspace: async () => handlers.get("SIGINT")(),
        runLerna,
        wait,
        inspect,
        mkdtemp: () => "/temporary/workspace",
        remove: (directory) => removed.push(directory),
        cleanup: () => removed.push("/temporary/parent"),
        registerSignal: (signal, handler) => {
          handlers.set(signal, handler);
          return () => {};
        },
        exit: (code) => {
          expect(code).toBe(130);
          throw new Error("signal exit");
        },
      }),
    ).rejects.toThrow("signal exit");
    expect(runLerna).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(removed).toEqual(["/temporary/workspace", "/temporary/parent"]);
  });

  it("cancels during convergence waiting without inspecting or retrying", async () => {
    const handlers = new Map();
    const runLerna = vi.fn(async () => ({ status: 1, signal: null }));
    const inspect = vi.fn();
    await expect(
      recoverPublication({
        release: { packages: [{ name: "@synthetic/base" }] },
        initialNames: ["@synthetic/base"],
        createWorkspace: async () => {},
        runLerna,
        wait: async (_milliseconds, signal) =>
          await new Promise((resolveWait) => {
            signal.addEventListener(
              "abort",
              () => {
                expect(signal.aborted).toBe(true);
                resolveWait();
              },
              { once: true },
            );
            handlers.get("SIGINT")();
          }),
        inspect,
        mkdtemp: () => "/temporary/workspace",
        remove: () => {},
        registerSignal: (signal, handler) => {
          handlers.set(signal, handler);
          return () => {};
        },
        exit: () => {
          throw new Error("signal exit");
        },
      }),
    ).rejects.toThrow("signal exit");
    expect(inspect).not.toHaveBeenCalled();
    expect(runLerna).toHaveBeenCalledTimes(1);
  });

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

  it("refuses publication recovery without its GitHub SHA and summary inputs", () => {
    const result = spawnSync(process.execPath, ["scripts/release-cli.mjs", "recover-publication"], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
      env: { ...process.env, GITHUB_SHA: undefined, GITHUB_STEP_SUMMARY: undefined },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("requires GITHUB_SHA and GITHUB_STEP_SUMMARY");
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
    expect(release).toMatchObject({ tag: "snapshot", version: "2.0.0-snapshot.11" });
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
