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

import { afterEach, describe, expect, it, vi } from "vitest";

const originalArgv = process.argv;
const secret = "message-board-native-secret-at-least-32-characters";

afterEach(() => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("Message Board executable authentication and tenant commands", () => {
  it.each(["single", "single-explicit", "external", "persistent"])(
    "runs the %s tenant command",
    async (mode) => {
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      process.argv = ["node", "tenant-scenarios-cli.js", mode];
      await import("../src/tenant-scenarios-cli.js");
      expect(console.log).toHaveBeenCalledOnce();
    },
  );

  it.each(["opaque", "signed", "oidc-fixture"])(
    "runs the %s component credential command",
    async (mode) => {
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      vi.stubEnv("SESSION_SEAL_PASSWORD", secret);
      process.argv = ["node", "component-auth-cli.js", mode];
      await import("../src/component-auth-cli.js");
      expect(console.log).toHaveBeenCalledOnce();
    },
  );

  it.each(["password", "external-fixture"])("runs the %s native command", async (mode) => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubEnv("BETTER_AUTH_SECRET", secret);
    process.argv = ["node", "better-auth-cli.js", mode];
    await import("../src/better-auth-cli.js");
    expect(console.log).toHaveBeenCalledOnce();
  });

  it("runs the local HTTP prelinked OIDC command", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubEnv("BETTER_AUTH_SECRET", secret);
    process.argv = ["node", "better-auth-oidc-cli.js"];
    await import("../src/better-auth-oidc-cli.js");
    expect(console.log).toHaveBeenCalledOnce();
  });

  it.each(["other", undefined])(
    "rejects tenant command %s before environment startup",
    async (mode) => {
      process.argv =
        mode === undefined
          ? ["node", "tenant-scenarios-cli.js"]
          : ["node", "tenant-scenarios-cli.js", mode];
      await expect(import("../src/tenant-scenarios-cli.js")).rejects.toThrow(/Choose single/u);
    },
  );

  it.each(["other", undefined])("rejects component command %s", async (mode) => {
    process.argv =
      mode === undefined
        ? ["node", "component-auth-cli.js"]
        : ["node", "component-auth-cli.js", mode];
    await expect(import("../src/component-auth-cli.js")).rejects.toThrow(/Choose opaque/u);
  });

  it("requires a component session seal password", async () => {
    vi.stubEnv("SESSION_SEAL_PASSWORD", undefined);
    process.argv = ["node", "component-auth-cli.js", "opaque"];
    await expect(import("../src/component-auth-cli.js")).rejects.toThrow(/SESSION_SEAL_PASSWORD/u);
  });

  it("rejects an unselected native command", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", secret);
    process.argv = ["node", "better-auth-cli.js", "other"];
    await expect(import("../src/better-auth-cli.js")).rejects.toThrow(/Choose password/u);
  });

  it("requires a native signing secret before starting either native command", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", undefined);
    process.argv = ["node", "better-auth-cli.js", "password"];
    await expect(import("../src/better-auth-cli.js")).rejects.toThrow(/BETTER_AUTH_SECRET/u);
    vi.resetModules();
    process.argv = ["node", "better-auth-oidc-cli.js"];
    await expect(import("../src/better-auth-oidc-cli.js")).rejects.toThrow(/BETTER_AUTH_SECRET/u);
  });

  it("does not report successful tenant admission when the selected directory fails", async () => {
    const { TenantScenarios } = await import("../src/tenant-scenarios.js");
    vi.spyOn(TenantScenarios, "external").mockResolvedValue({
      registered: false,
      unknownRejected: true,
    });
    process.argv = ["node", "tenant-scenarios-cli.js", "external"];
    await expect(import("../src/tenant-scenarios-cli.js")).rejects.toThrow(/membership/u);
  });

  it("does not report successful tenant admission when unknown membership was accepted", async () => {
    const { TenantScenarios } = await import("../src/tenant-scenarios.js");
    vi.spyOn(TenantScenarios, "external").mockResolvedValue({
      registered: true,
      unknownRejected: false,
    });
    process.argv = ["node", "tenant-scenarios-cli.js", "external"];
    await expect(import("../src/tenant-scenarios-cli.js")).rejects.toThrow(/membership/u);
  });

  it("does not report successful native login when a credential remains valid after logout", async () => {
    const { BetterAuthScenarios } = await import("../src/better-auth-scenarios.js");
    vi.spyOn(BetterAuthScenarios, "password").mockResolvedValue({
      refused: true,
      resolved: true,
      loggedOut: false,
      removed: 0,
    });
    vi.stubEnv("BETTER_AUTH_SECRET", secret);
    process.argv = ["node", "better-auth-cli.js", "password"];
    await expect(import("../src/better-auth-cli.js")).rejects.toThrow(/lifecycle failed/u);
  });

  it("does not report successful native login when invalid proof was accepted", async () => {
    const { BetterAuthScenarios } = await import("../src/better-auth-scenarios.js");
    vi.spyOn(BetterAuthScenarios, "password").mockResolvedValue({
      refused: false,
      resolved: true,
      loggedOut: true,
      removed: 0,
    });
    vi.stubEnv("BETTER_AUTH_SECRET", secret);
    process.argv = ["node", "better-auth-cli.js", "password"];
    await expect(import("../src/better-auth-cli.js")).rejects.toThrow(/lifecycle failed/u);
  });

  it("does not report local OIDC success without a provider token exchange", async () => {
    const { BetterAuthOidcScenario } = await import("../src/better-auth-oidc-scenario.js");
    vi.spyOn(BetterAuthOidcScenario, "prelinked").mockResolvedValue({
      resolved: true,
      replayRejected: true,
      loggedOut: true,
      removed: 0,
    });
    vi.stubEnv("BETTER_AUTH_SECRET", secret);
    process.argv = ["node", "better-auth-oidc-cli.js"];
    await expect(import("../src/better-auth-oidc-cli.js")).rejects.toThrow(/lifecycle failed/u);
  });

  it.each(["opaque", "signed", "oidc-fixture"])(
    "does not report a false %s component success",
    async (mode) => {
      const { ComponentAuthScenarios } = await import("../src/component-auth-scenarios.js");
      if (mode === "opaque")
        vi.spyOn(ComponentAuthScenarios, "opaque").mockResolvedValue({
          resolved: false,
          revoked: true,
          removed: 0,
        });
      else if (mode === "signed")
        vi.spyOn(ComponentAuthScenarios, "signed").mockResolvedValue({
          resolved: false,
          revoked: true,
          removed: 0,
        });
      else
        vi.spyOn(ComponentAuthScenarios, "oidc").mockResolvedValue({
          issued: false,
          replayRejected: true,
          resolved: true,
          removed: { transactions: 0, grants: 0 },
        });
      vi.stubEnv("SESSION_SEAL_PASSWORD", secret);
      process.argv = ["node", "component-auth-cli.js", mode];
      await expect(import("../src/component-auth-cli.js")).rejects.toThrow(/lifecycle failed/u);
    },
  );
});
