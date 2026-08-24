import { describe, expect, it } from "vitest";

import { main } from "./release-cli.mjs";

describe("release CLI", () => {
  it("rejects publication outside the exact official Actions push context", async () => {
    await expect(main({ argv: ["node", "cli", "publish"], environment: {} })).rejects.toThrow(
      "permitted only",
    );
  });
});
