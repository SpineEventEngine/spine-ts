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

import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it, vi } from "vitest";

import { CapacityUsageReporter } from "../../src/server/capacity-usage-reporter.js";

const zero = { rows: 0, bytes: 0, shards: 0 };

describe("autonomous child usage reporting", () => {
  it("sends the newest detached snapshot after an earlier report completes", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const sent: { revision: bigint; rows: number }[] = [];
    const reporter = new CapacityUsageReporter(async (snapshot) => {
      sent.push({ revision: snapshot.revision, rows: snapshot.usage.rows });
      if (snapshot.revision === 1n) {
        entered.resolve(undefined);
        await release.promise;
      }
    });
    const mutable = { rows: 1, bytes: 10, shards: 1 };
    const first = reporter.publish({ revision: 1n, usage: mutable });
    await entered.promise;
    mutable.rows = 99;
    const second = reporter.publish({ revision: 2n, usage: zero });
    const older = reporter.publish({ revision: 1n, usage: mutable });
    release.resolve(undefined);
    await Promise.all([first, second, older]);
    expect(sent).toEqual([
      { revision: 1n, rows: 1 },
      { revision: 2n, rows: 0 },
    ]);
    reporter.close();
  });

  it.each([
    Code.InvalidArgument,
    Code.FailedPrecondition,
    Code.Unauthenticated,
    Code.PermissionDenied,
    Code.Unimplemented,
  ])("stops autonomous retries on definitive parent rejection %s", async (code) => {
    const send = vi.fn(() => Promise.reject(new ConnectError("refused", code)));
    const reporter = new CapacityUsageReporter(send);
    await expect(reporter.publish({ revision: 1n, usage: zero })).rejects.toMatchObject({ code });
    expect(send).toHaveBeenCalledOnce();
    reporter.close();
    await expect(reporter.publish({ revision: 2n, usage: zero })).rejects.toThrow("closed");
  });

  it("retries an unacknowledged expiry and sends the latest state", async () => {
    const reported: bigint[] = [];
    let attempts = 0;
    const reporter = new CapacityUsageReporter((snapshot) => {
      attempts++;
      reported.push(snapshot.revision);
      if (attempts === 1) throw new Error("reply lost");
      return Promise.resolve();
    });
    const first = reporter.publish({ revision: 2n, usage: zero });
    const second = reporter.publish({ revision: 3n, usage: zero });
    await Promise.all([first, second]);
    expect(reported).toEqual([3n, 3n]);
    reporter.close();
  });

  it("settles pending retry when the child closes", async () => {
    const reporter = new CapacityUsageReporter(() => Promise.reject(new Error("offline")));
    const reporting = reporter.publish({ revision: 1n, usage: zero });
    await Promise.resolve();
    reporter.close();
    await expect(reporting).rejects.toThrow("closed");
  });

  it("paces repeated immediate failures instead of spinning on microtasks", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const reporter = new CapacityUsageReporter(() => {
        calls++;
        return Promise.reject(new Error("offline"));
      });
      const reporting = reporter.publish({ revision: 1n, usage: zero });
      const rejected = expect(reporting).rejects.toThrow("closed");
      await Promise.resolve();
      await Promise.resolve();
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toBe(2);
      reporter.close();
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
});
