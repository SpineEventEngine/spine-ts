import { describe, expect, it } from "vitest";

import { LocalBoardSession } from "../src/local-session.js";

describe("LocalBoardSession", () => {
  it("accepts the bearer used by the local browser entrypoint", async () => {
    const session = await LocalBoardSession.resolver().resolve({
      kind: "bearer",
      value: "message-board-local-fixture",
    });

    expect(session?.principal).toEqual({
      id: "ada",
      attributes: { boards: "general" },
    });
  });

  it("keeps the local development session valid for eight hours", async () => {
    const session = await LocalBoardSession.resolver().resolve({
      kind: "bearer",
      value: "message-board-local-fixture",
    });

    expect(session?.expiresAt.seconds).toBeGreaterThanOrEqual(
      LocalBoardSession.clock.now().seconds + 8n * 60n * 60n - 1n,
    );
  });

  it("rejects credentials that do not match the local bearer", async () => {
    await expect(
      LocalBoardSession.resolver().resolve({ kind: "bearer", value: "wrong" }),
    ).resolves.toBeUndefined();
  });
});
