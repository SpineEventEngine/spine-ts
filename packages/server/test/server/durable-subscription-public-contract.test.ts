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

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("authenticated subscription public contract", () => {
  it("contains only the approved direct-record persistence model", async () => {
    const source = await readFile(
      new URL("../../src/browser/durable-subscription-bindings.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("GatewayAuthenticatedSubscriptionSchema");
    expect(source).not.toMatch(
      new RegExp(
        [
          "AnySchema|type\\.spine-event-engine\\.gateway|JSON\\.parse|JSON\\.stringify",
          "quotaId|cleanupId|admissionToken|reservationOwner|principalFingerprint",
          "leaseUntilMs|retryAfterMs|receipt|marker",
        ].join("|"),
      ),
    );
  });
});
