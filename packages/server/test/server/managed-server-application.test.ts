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

import { describe, expect, it } from "vitest";

import { ManagedServerApplication } from "../../src/index.js";

describe("ManagedServerApplication", () => {
  it.each([undefined, 0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid explicit process count %s without deriving a machine default",
    async (processCount) => {
      await expect(
        ManagedServerApplication.run({
          processCount: processCount as number,
          moduleUrl: import.meta.url,
          host: "127.0.0.1",
          port: 0,
          createServer: async () => ({
            host: "127.0.0.1",
            port: 1,
            baseUrl: "http://127.0.0.1:1",
            close: async () => {},
          }),
        }),
      ).rejects.toThrow("processCount");
    },
  );
});
