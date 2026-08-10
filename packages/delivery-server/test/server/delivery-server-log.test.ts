import { describe, expect, it, vi } from "vitest";
import { emitDeliveryServerError } from "../../src/server/delivery-server-log.js";
describe("delivery listener logging", () => {
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
          error: () => {
            throw new Error(secret);
          },
        }),
      },
      {
        withMetadata: () => ({
          error: () => ({
            then: (_: unknown, reject: (e: Error) => void) => {
              reject(new Error(secret));
            },
          }),
        }),
      },
    ];
    for (const logger of cases)
      expect(() => {
        emitDeliveryServerError(logger as never);
      }).not.toThrow();
    const error = vi.fn();
    const logger = { withMetadata: vi.fn(() => ({ error })) };
    emitDeliveryServerError(logger as never);
    expect(logger.withMetadata).toHaveBeenCalledWith({
      operation: "delivery.listener.start",
      reasonCode: "failed",
    });
    expect(error).toHaveBeenCalledWith("delivery.listener.start_failed");
    expect(JSON.stringify(logger.withMetadata.mock.calls)).not.toContain(secret);
    await Promise.resolve();
    await Promise.resolve();
  });
});
