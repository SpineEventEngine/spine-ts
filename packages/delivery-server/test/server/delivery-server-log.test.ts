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
import { deliveryServerLog } from "../../src/server/delivery-server-log.js";
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
        deliveryServerLog.error(logger as never);
      }).not.toThrow();
    const error = vi.fn();
    const logger = { withMetadata: vi.fn(() => ({ error })) };
    deliveryServerLog.error(logger as never);
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
