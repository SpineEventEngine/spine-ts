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

import { BetterAuthIntegration } from "@spine-event-engine/auth/better-auth";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it, vi } from "vitest";

import { BetterAuthScenarios } from "../src/better-auth-scenarios.js";

describe("Message Board Better Auth examples", () => {
  it("runs provisioned native password login, refusal, resolution, and logout", async () => {
    const result = await BetterAuthScenarios.password(
      "message-board-native-secret-at-least-32-characters",
      "correct-password-123",
    );
    expect(result).toEqual({ refused: true, resolved: true, loggedOut: true, removed: 0 });
  });

  it("uses an external User directory and application verifier before native session issuance", async () => {
    const verified = (request: Request) =>
      Promise.resolve(
        request.headers.get("authorization") === "Bearer local-proof" ? "board-user" : undefined,
      );
    const result = await BetterAuthScenarios.external(
      "message-board-native-secret-at-least-32-characters",
      verified,
      "local-proof",
    );
    expect(result).toEqual({ refused: true, resolved: true, loggedOut: true, removed: 0 });
  });

  it("closes selected native resources after invalid signing configuration", async () => {
    const closed = vi.spyOn(InMemoryStorageFactory.prototype, "close");
    try {
      await expect(BetterAuthScenarios.password("short", "correct-password-123")).rejects.toThrow();
      expect(closed).toHaveBeenCalledOnce();
    } finally {
      closed.mockRestore();
    }
  });

  it("refuses an external proof whose stable User ID is absent from the directory", async () => {
    await expect(
      BetterAuthScenarios.external(
        "message-board-native-secret-at-least-32-characters",
        () => Promise.resolve("absent-user"),
        "local-proof",
      ),
    ).rejects.toThrow(/login was not issued/u);
  });

  it("does not claim password success if the selected native login route is absent", async () => {
    const create = BetterAuthIntegration.create.bind(BetterAuthIntegration);
    const selected = vi.spyOn(BetterAuthIntegration, "create").mockImplementation((input) =>
      create(input).then((auth) => {
        Object.defineProperty(auth, "routes", {
          value: auth.routes.filter((route) => route.path !== "/auth/sign-in/email"),
        });
        return auth;
      }),
    );
    try {
      await expect(
        BetterAuthScenarios.password(
          "message-board-native-secret-at-least-32-characters",
          "correct-password-123",
        ),
      ).rejects.toThrow(/routes were absent/u);
    } finally {
      selected.mockRestore();
    }
  });
});
