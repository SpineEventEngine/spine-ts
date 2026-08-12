/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */
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
