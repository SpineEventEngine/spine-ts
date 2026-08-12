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
