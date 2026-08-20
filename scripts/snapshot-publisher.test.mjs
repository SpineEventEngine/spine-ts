import { describe, expect, it } from "vitest";

import { runSnapshotPublication } from "./snapshot-publisher.mjs";

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
});
