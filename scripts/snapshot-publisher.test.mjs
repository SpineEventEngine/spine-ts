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
});
