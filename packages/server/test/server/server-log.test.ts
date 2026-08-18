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

import { describe, expect, it, vi } from "vitest";

import { emitServerError, emitServerWarning } from "../../src/server/server-log.js";

describe("server logging containment", () => {
  it("retains only bounded managed replica lifecycle facts", () => {
    const warn = vi.fn();
    const logger = { withMetadata: vi.fn(() => ({ warn })) };
    emitServerWarning(logger as never, "managed", {
      operation: "managed_replica.replace",
      reasonCode: "unexpected_exit",
      slot: "1",
      incarnation: "incarnation",
      attempt: "2",
      delay: "250",
      payload: "must-not-log",
    });
    expect(logger.withMetadata).toHaveBeenCalledWith({
      operation: "managed_replica.replace",
      reasonCode: "unexpected_exit",
      slot: "1",
      incarnation: "incarnation",
      attempt: "2",
      delay: "250",
    });
  });
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

  it("omits invalid bounded counters and invalid framework codes", () => {
    const warn = vi.fn();
    const logger = { withMetadata: vi.fn(() => ({ warn })) };

    emitServerWarning(logger as never, "retry_failed", {
      count: -1,
      operation: "not valid",
      reasonCode: "X".repeat(65),
    });

    expect(logger.withMetadata).toHaveBeenCalledWith({});
    expect(warn).toHaveBeenCalledWith("retry_failed");
  });

  it("omits a non-integer counter while retaining valid framework facts", () => {
    const warn = vi.fn();
    const logger = { withMetadata: vi.fn(() => ({ warn })) };

    emitServerWarning(logger as never, "retry_failed", {
      count: 1.5,
      operation: "delivery.retry",
      reasonCode: "temporary_failure",
    });

    expect(logger.withMetadata).toHaveBeenCalledWith({
      operation: "delivery.retry",
      reasonCode: "temporary_failure",
    });
  });

  it("contains synchronous and promise-like logging failures", async () => {
    const sync = {
      withMetadata: () => ({
        warn: () => {
          throw new Error("logger");
        },
      }),
    };
    const async = {
      withMetadata: () => ({ warn: () => Promise.reject(new Error("logger")) }),
    };
    const callableThenable = Object.assign(() => undefined, {
      then: vi.fn((_: unknown, reject: (reason: Error) => void) => {
        reject(new Error("logger"));
      }),
    });
    const callable = {
      withMetadata: () => ({ warn: () => callableThenable }),
    };

    expect(() => {
      emitServerWarning(sync as never, "retry_failed", {});
    }).not.toThrow();
    expect(() => {
      emitServerWarning(async as never, "retry_failed", {});
    }).not.toThrow();
    expect(() => {
      emitServerWarning(callable as never, "retry_failed", {});
    }).not.toThrow();
    await Promise.resolve();
    expect(callableThenable.then).toHaveBeenCalledOnce();
  });

  it("uses the same contained path for error records", () => {
    const error = vi.fn();
    const logger = { withMetadata: vi.fn(() => ({ error })) };

    emitServerError(logger as never, "delivery_terminated", {
      operation: "delivery.run",
      reasonCode: "terminated",
    });

    expect(logger.withMetadata).toHaveBeenCalledWith({
      operation: "delivery.run",
      reasonCode: "terminated",
    });
    expect(error).toHaveBeenCalledWith("delivery_terminated");
  });
});
