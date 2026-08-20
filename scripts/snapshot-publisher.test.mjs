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
});
