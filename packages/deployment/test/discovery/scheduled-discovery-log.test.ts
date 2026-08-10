import { describe, expect, it, vi } from "vitest";

import { scheduledDiscoveryLog } from "../../src/discovery/scheduled-discovery-log.js";

describe("scheduled discovery logging", () => {
  it("contains logger failures and emits only fixed safe output", async () => {
    const secret = "token password cookie authorization signing session CSRF OIDC";
    for (const logger of [
      {
        withMetadata: () => {
          throw new Error(secret);
        },
      },
      {
        withMetadata: () => ({
          warn: () => {
            throw new Error(secret);
          },
        }),
      },
      {
        withMetadata: () => ({
          warn: () => ({
            then: (_: unknown, reject: (e: Error) => void) => {
              reject(new Error(secret));
            },
          }),
        }),
      },
    ])
      expect(() => {
        scheduledDiscoveryLog.warn(logger as never);
      }).not.toThrow();
    const warn = vi.fn();
    const logger = { withMetadata: vi.fn(() => ({ warn })) };
    scheduledDiscoveryLog.warn(logger as never);
    expect(logger.withMetadata).toHaveBeenCalledWith({
      operation: "deployment.discovery.refresh",
      reasonCode: "failed",
    });
    expect(warn).toHaveBeenCalledWith("deployment.discovery.refresh_failed");
    expect(JSON.stringify(logger.withMetadata.mock.calls)).not.toContain(secret);
    expect(() => {
      scheduledDiscoveryLog.warn(undefined);
    }).not.toThrow();
    await Promise.resolve();
  });
});
