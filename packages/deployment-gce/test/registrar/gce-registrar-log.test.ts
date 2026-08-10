import { describe, expect, it, vi } from "vitest";
import { gceRegistrarLog } from "../../src/registrar/gce-registrar-log.js";
describe("GCE renewal logging", () => {
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
        gceRegistrarLog.warnRenewal(logger as never);
      }).not.toThrow();
    const warn = vi.fn();
    const logger = { withMetadata: vi.fn(() => ({ warn })) };
    gceRegistrarLog.warnRenewal(logger as never);
    expect(logger.withMetadata).toHaveBeenCalledWith({
      operation: "deployment.gce.registrar.renew",
      reasonCode: "failed",
    });
    expect(warn).toHaveBeenCalledWith("deployment.gce.registrar.renew_failed");
    expect(JSON.stringify(logger.withMetadata.mock.calls)).not.toContain(secret);
    await Promise.resolve();
    await Promise.resolve();
  });
});
