import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";

import {
  assertPackagePresence,
  configureTrustedPublisher,
  parseArguments,
  publishNewPackage,
  resolveNewPackageTarget,
} from "./publish-new-package.mjs";

const repoRoot = new URL("..", import.meta.url).pathname;

describe("new package publication", () => {
  it("resolves a public package from the fixed release inventory", () => {
    expect(resolveNewPackageTarget(repoRoot, "packages/storage-postgres")).toEqual({
      archiveName: "spine-event-engine-storage-postgres-2.0.0-snapshot.13.tgz",
      directory: "packages/storage-postgres",
      name: "@spine-event-engine/storage-postgres",
      tag: "snapshot",
      version: "2.0.0-snapshot.13",
    });
    expect(() => resolveNewPackageTarget(repoRoot, "examples/todo")).toThrow(
      "public package directory",
    );
    expect(() => resolveNewPackageTarget(repoRoot, "packages/missing")).toThrow(
      "public package directory",
    );
  });

  it("parses normal, recovery, and help invocations", () => {
    expect(parseArguments(["packages/storage-postgres"])).toEqual({
      help: false,
      packageDirectory: "packages/storage-postgres",
      trustOnly: false,
    });
    expect(parseArguments(["--trust-only", "packages/storage-postgres"])).toEqual({
      help: false,
      packageDirectory: "packages/storage-postgres",
      trustOnly: true,
    });
    expect(parseArguments(["--help"])).toEqual({ help: true });
    expect(() => parseArguments([])).toThrow("package directory");
    expect(() => parseArguments(["--unknown", "packages/storage-postgres"])).toThrow(
      "Unknown option",
    );
  });

  it("distinguishes an absent package from an existing package and fails closed", async () => {
    await expect(
      assertPackagePresence("@synthetic/new", false, async () => ({ status: 404, ok: false })),
    ).resolves.toBeUndefined();
    await expect(
      assertPackagePresence("@synthetic/existing", true, async () => ({
        status: 200,
        ok: true,
        json: async () => ({ versions: {} }),
      })),
    ).resolves.toBeUndefined();
    await expect(
      assertPackagePresence("@synthetic/existing", false, async () => ({
        status: 200,
        ok: true,
        json: async () => ({ versions: {} }),
      })),
    ).rejects.toThrow("already exists");
    await expect(
      assertPackagePresence("@synthetic/new", true, async () => ({ status: 404, ok: false })),
    ).rejects.toThrow("does not exist");
    await expect(
      assertPackagePresence("@synthetic/new", false, async () => ({
        status: 503,
        ok: false,
      })),
    ).rejects.toThrow("ambiguous registry response");
  });

  it("fails closed when the registry does not answer before the timeout", async () => {
    await expect(
      assertPackagePresence("@synthetic/new", false, () => new Promise(() => {}), 5),
    ).rejects.toThrow("timed out");
  });

  it("verifies, prepares, publishes, configures trust, verifies, and logs out", async () => {
    const calls = [];
    const output = [];
    const target = resolveNewPackageTarget(repoRoot, "packages/storage-postgres");
    const temporaryDirectory = "/tmp/new-package-publication";
    await publishNewPackage({
      repoRoot,
      target,
      capture: (_command, args) =>
        args[0] === "view"
          ? JSON.stringify({ snapshot: target.version })
          : JSON.stringify({
              type: "github",
              repository: "SpineEventEngine/spine-ts",
              file: "publish.yml",
              environment: "gh-actions-environment",
              permissions: ["createPackage"],
            }),
      confirm: async (name) => name === target.name,
      fetchResponse: async () => ({ status: 404, ok: false }),
      makeTemporaryDirectory: () => temporaryDirectory,
      removeDirectory: (path) => calls.push({ kind: "remove", path }),
      pathExists: () => true,
      run: (command, args) => calls.push({ command, args }),
      write: (message) => output.push(message),
    });
    expect(calls).toContainEqual({ command: "pnpm", args: ["verify:publish"] });
    expect(calls).toContainEqual({
      command: process.execPath,
      args: ["scripts/release-cli.mjs", "prepare", "--output", join(temporaryDirectory, "release")],
    });
    expect(calls).toContainEqual({
      command: "npm",
      args: [
        "publish",
        join(temporaryDirectory, "release", target.archiveName),
        "--access",
        "public",
        "--tag",
        "snapshot",
        "--registry",
        "https://registry.npmjs.org/",
      ],
    });
    expect(calls).toContainEqual({
      command: "npm",
      args: [
        "trust",
        "github",
        target.name,
        "--repository",
        "SpineEventEngine/spine-ts",
        "--file",
        "publish.yml",
        "--environment",
        "gh-actions-environment",
        "--allow-publish",
        "--yes",
      ],
    });
    expect(calls.at(-2)).toEqual({
      command: "npm",
      args: ["logout", "--registry", "https://registry.npmjs.org/"],
    });
    expect(calls.at(-1)).toEqual({ kind: "remove", path: temporaryDirectory });
    expect(output.join("\n")).toContain("published and configured");
  });

  it("does nothing when confirmation is refused", async () => {
    const run = vi.fn();
    await expect(
      publishNewPackage({
        repoRoot,
        target: resolveNewPackageTarget(repoRoot, "packages/storage-postgres"),
        confirm: async () => false,
        fetchResponse: async () => ({ status: 404, ok: false }),
        run,
        write: () => {},
      }),
    ).rejects.toThrow("cancelled");
    expect(run).not.toHaveBeenCalled();
  });

  it("logs out and removes temporary artifacts when trust configuration fails", async () => {
    const calls = [];
    const temporaryDirectory = "/tmp/new-package-publication";
    await expect(
      publishNewPackage({
        repoRoot,
        target: resolveNewPackageTarget(repoRoot, "packages/storage-postgres"),
        confirm: async () => true,
        fetchResponse: async () => ({ status: 404, ok: false }),
        makeTemporaryDirectory: () => temporaryDirectory,
        removeDirectory: (path) => calls.push(["remove", path]),
        pathExists: () => true,
        run: (command, args) => {
          calls.push([command, ...args]);
          if (args[0] === "trust") throw new Error("trust failed");
        },
        write: () => {},
      }),
    ).rejects.toThrow("trust failed");
    expect(calls).toContainEqual(["npm", "logout", "--registry", "https://registry.npmjs.org/"]);
    expect(calls.at(-1)).toEqual(["remove", temporaryDirectory]);
  });

  it("does not change trust settings unless the intended version exists", async () => {
    const run = vi.fn();
    const target = resolveNewPackageTarget(repoRoot, "packages/storage-postgres");
    await expect(
      configureTrustedPublisher({
        target,
        confirm: async () => true,
        fetchResponse: async () => ({
          status: 200,
          ok: true,
          json: async () => ({ versions: { "2.0.0-snapshot.12": {} } }),
        }),
        run,
      }),
    ).rejects.toThrow(target.version);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a wrong release tag or trusted-publisher identity", async () => {
    const target = resolveNewPackageTarget(repoRoot, "packages/storage-postgres");
    const base = {
      target,
      confirm: async () => true,
      fetchResponse: async () => ({
        status: 200,
        ok: true,
        json: async () => ({ versions: { [target.version]: {} } }),
      }),
      run: () => {},
      write: () => {},
    };
    await expect(
      configureTrustedPublisher({
        ...base,
        capture: (_command, args) =>
          args[0] === "view"
            ? JSON.stringify({ snapshot: "2.0.0-snapshot.12" })
            : JSON.stringify({
                type: "github",
                repository: "SpineEventEngine/spine-ts",
                file: "publish.yml",
                environment: "gh-actions-environment",
                permissions: ["createPackage"],
              }),
      }),
    ).rejects.toThrow("release tag");
    await expect(
      configureTrustedPublisher({
        ...base,
        capture: (_command, args) =>
          args[0] === "view"
            ? JSON.stringify({ snapshot: target.version })
            : JSON.stringify({
                type: "github",
                repository: "another/repository",
                file: "publish.yml",
                environment: "gh-actions-environment",
                permissions: ["createPackage"],
              }),
      }),
    ).rejects.toThrow("trusted publisher");
  });

  it("logs out and removes temporary artifacts when interrupted", async () => {
    const calls = [];
    const handlers = new Map();
    const target = resolveNewPackageTarget(repoRoot, "packages/storage-postgres");
    await expect(
      publishNewPackage({
        repoRoot,
        target,
        capture: (_command, args) =>
          args[0] === "view" ? JSON.stringify({ snapshot: target.version }) : JSON.stringify([]),
        confirm: async () => true,
        exit: (code) => {
          throw new Error("exit " + code);
        },
        fetchResponse: async () => ({ status: 404, ok: false }),
        makeTemporaryDirectory: () => "/tmp/new-package-publication",
        pathExists: () => true,
        registerSignal: (signal, handler) => {
          handlers.set(signal, handler);
          return () => handlers.delete(signal);
        },
        removeDirectory: (path) => calls.push(["remove", path]),
        run: (command, args) => {
          calls.push([command, ...args]);
          if (args[0] === "publish") handlers.get("SIGINT")();
        },
        write: () => {},
      }),
    ).rejects.toThrow("exit 130");
    expect(calls.filter((call) => call[1] === "logout")).toHaveLength(1);
    expect(calls.filter((call) => call[0] === "remove")).toEqual([
      ["remove", "/tmp/new-package-publication"],
    ]);
  });
});
