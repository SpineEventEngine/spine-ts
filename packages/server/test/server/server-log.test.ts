import { describe, expect, it, vi } from "vitest";

import { emitServerWarning } from "../../src/server/server-log.js";

describe("server logging containment", () => {
  it("emits only allowlisted bounded facts and omits secrets", () => {
    const warn = vi.fn();
    const logger = {
      withMetadata: vi.fn(() => ({ warn })),
    };

    emitServerWarning(logger as never, "retry_failed", {
      tenantId: "tenant-a",
      operation: "delivery.retry",
      reasonCode: "temporary_failure",
      count: 2,
      authorization: "Bearer secret",
      payload: { secret: true },
      actorId: "x".repeat(257),
    });

    expect(logger.withMetadata).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      operation: "delivery.retry",
      reasonCode: "temporary_failure",
      count: 2,
    });
    expect(warn).toHaveBeenCalledWith("retry_failed");
  });

  it("contains synchronous and promise-like logging failures", async () => {
    const sync = { withMetadata: () => ({ warn: () => { throw new Error("logger"); } }) };
    const async = {
      withMetadata: () => ({ warn: () => Promise.reject(new Error("logger")) }),
    };

    expect(() => emitServerWarning(sync as never, "retry_failed", {})).not.toThrow();
    expect(() => emitServerWarning(async as never, "retry_failed", {})).not.toThrow();
    await Promise.resolve();
  });
});
