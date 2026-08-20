import { describe, expect, it } from "vitest";

import {
  installCleanupHandlers,
  prepareSnapshotPublication,
  runSnapshotPublication,
  waitForRegistryVisibility,
} from "./snapshot-publisher.mjs";

describe("snapshot publisher", () => {
  it("prepares by default without mutating the npm registry", async () => {
    const commands = [];

    await runSnapshotPublication({
      runner: async (command, args) => {
        commands.push([command, args]);
        return "";
      },
      packages: [],
    });

    expect(commands.some(([command, args]) => command === "npm" && args[0] === "publish")).toBe(
      false,
    );
  });

  it("reports the exact prepared artifact identity before cleanup", async () => {
    const artifact = { name: "@spine-event-engine/core", tarball: "core.tgz", integrity: "sha512-core" };
    await expect(runSnapshotPublication({ runner: async () => "", packages: [artifact] })).resolves.toMatchObject({
      prepared: 1,
      artifacts: [artifact],
    });
  });

  it("cleans up when preparation fails", async () => {
    const cleanup = [];
    await expect(runSnapshotPublication({
      runner: async () => "",
      prepare: async () => { throw new Error("packing failed"); },
      cleanup: async () => cleanup.push("cleanup"),
    })).rejects.toThrow("packing failed");
    expect(cleanup).toEqual(["cleanup"]);
  });

  it("runs preparation gates once before any publication command", async () => {
    const calls = [];
    await runSnapshotPublication({
      runner: async (command, args) => {
        calls.push(command + " " + args.join(" "));
        return "";
      },
      packages: [],
      prepare: async () => {
        calls.push("prepare");
        return [];
      },
    });
    expect(calls).toEqual(["npm whoami", "prepare"]);
  });

  it("checks the checkout, installs once, gates once, packs, and proves the exact tarballs", async () => {
    const calls = [];
    const tarballs = [{ name: "@spine-event-engine/core", tarball: "core.tgz" }];
    await expect(
      prepareSnapshotPublication({
        runner: async (command, args) => calls.push(command + " " + args.join(" ")),
        checkRoot: async () => calls.push("root"),
        checkClean: async () => calls.push("clean"),
        checkInventory: async () => calls.push("inventory"),
        packAndValidate: async () => {
          calls.push("pack");
          return tarballs;
        },
        verifyExternalConsumer: async (actual) => {
          expect(actual).toBe(tarballs);
          calls.push("consumer");
        },
      }),
    ).resolves.toBe(tarballs);
    expect(calls).toEqual([
      "root",
      "clean",
      "inventory",
      "pnpm install --frozen-lockfile",
      "pnpm verify:release",
      "pack",
      "consumer",
    ]);
  });

  it("skips only a tarball whose registry integrity matches its local SRI", async () => {
    const commands = [];

    const report = await runSnapshotPublication({
      runner: async (command, args) => {
        commands.push([command, args]);
        if (args[0] === "view") return "sha512-match";
        return "";
      },
      packages: [
        { name: "@spine-event-engine/core", tarball: "core.tgz", integrity: "sha512-match" },
      ],
      publish: true,
    });

    expect(report.skipped).toEqual(["@spine-event-engine/core"]);
    expect(commands.some(([command, args]) => command === "npm" && args[0] === "publish")).toBe(
      false,
    );
  });

  it("publishes only explicitly requested prebuilt tarballs with the snapshot tag", async () => {
    const commands = [];

    await runSnapshotPublication({
      runner: async (command, args) => {
        commands.push([command, args]);
        return "";
      },
      packages: ["core.tgz"],
      publish: true,
    });

    expect(commands).toEqual([
      ["npm", ["whoami"]],
      ["npm", ["publish", "core.tgz", "--access", "public", "--tag", "snapshot"]],
    ]);
  });

  it("publishes dependency-first and waits for each internal dependency", async () => {
    const calls = [];
    const report = await runSnapshotPublication({
      runner: async (command, args) => {
        calls.push(command + " " + args.join(" "));
        return "";
      },
      packages: [
        {
          name: "@spine-event-engine/server",
          tarball: "server.tgz",
          integrity: "sha512-server",
          dependencies: ["@spine-event-engine/core"],
        },
        { name: "@spine-event-engine/core", tarball: "core.tgz", integrity: "sha512-core" },
      ],
      publish: true,
      waitForVisibility: async (name, version) => calls.push("wait " + name + "@" + version),
    });

    expect(report.published).toEqual([
      "@spine-event-engine/core",
      "@spine-event-engine/server",
    ]);
    expect(calls).toContain("wait @spine-event-engine/core@2.0.0-snapshot.2");
    expect(calls.indexOf("npm publish core.tgz --access public --tag snapshot")).toBeLessThan(
      calls.indexOf("npm publish server.tgz --access public --tag snapshot"),
    );
  });

  it("cleans prepared artifacts when publication fails", async () => {
    const cleanups = [];
    await expect(
      runSnapshotPublication({
        runner: async (_command, args) => {
          if (args[0] === "publish") throw new Error("registry rejected artifact");
          return "";
        },
        packages: ["core.tgz"],
        publish: true,
        cleanup: async () => cleanups.push("cleanup"),
      }),
    ).rejects.toThrow("registry rejected artifact");
    expect(cleanups).toEqual(["cleanup"]);
  });

  it("cleans up and preserves conventional exit codes for interruption signals", async () => {
    const handlers = new Map();
    const calls = [];
    const dispose = installCleanupHandlers({
      signals: {
        on: (signal, handler) => handlers.set(signal, handler),
        off: (signal) => handlers.delete(signal),
      },
      cleanup: async () => calls.push("cleanup"),
      exit: (code) => calls.push("exit " + code),
    });
    await handlers.get("SIGINT")();
    dispose();
    expect(calls).toEqual(["cleanup", "exit 130"]);
    expect(handlers.size).toBe(0);
  });

  it("polls registry visibility after a not-found response", async () => {
    const calls = [];
    let attempts = 0;
    await waitForRegistryVisibility({
      runner: async () => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error("missing");
          error.status = 404;
          throw error;
        }
        return "2.0.0-snapshot.2";
      },
      sleep: async () => calls.push("sleep"),
      name: "@spine-event-engine/core",
      version: "2.0.0-snapshot.2",
    });
    expect(calls).toEqual(["sleep"]);
  });
});
