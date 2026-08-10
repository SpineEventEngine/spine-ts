import { describe, expect, it, vi } from "vitest";
import { gkeDiscoveryLog } from "../../src/discovery/gke-log.js";
describe("GKE discovery logging", () => {
  it("contains logger failures and emits fixed safe output", async () => {
    const secret = "token password cookie authorization signing session CSRF OIDC";
    const cases = [
      undefined,
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
    ];
    for (const logger of cases)
      expect(() => {
        gkeDiscoveryLog.warn(logger as never);
      }).not.toThrow();
    const warn = vi.fn();
    const logger = { withMetadata: vi.fn(() => ({ warn })) };
    gkeDiscoveryLog.warn(logger as never);
    expect(logger.withMetadata).toHaveBeenCalledWith({
      operation: "deployment.gke.discovery.refresh",
      reasonCode: "failed",
    });
    expect(warn).toHaveBeenCalledWith("deployment.gke.discovery.refresh_failed");
    expect(JSON.stringify(logger.withMetadata.mock.calls)).not.toContain(secret);
    await Promise.resolve();
    await Promise.resolve();
  });
});
