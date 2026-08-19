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

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

describe("Wave 8 MessageBoard and Orders example migration", () => {
  it("uses only current Datastore construction and removes retired persistence facilities", () => {
    const sources = [
      "examples/orders/src/index.ts",
      "examples/message-board/app/src/deployment-config.ts",
      "examples/message-board/app/src/index.ts",
      "examples/message-board/app/src/application-server.ts",
      "examples/message-board/app/src/combined-server.ts",
      "examples/message-board/app/src/gateway-server.ts",
      "examples/message-board/web/test/interop/harness.mjs",
    ] as const;
    const retired = [
      "DatastoreStorageOptions",
      "DatastoreStorageFactory.create",
      "RemovalQuarantine",
      "removalQuarantine",
      "fingerprint:",
      "leaseMs:",
      "cleanupBatchSize:",
      "recordLimit:",
      "maxRecordBytes:",
      "MessageBoardSessionRevocations",
    ] as const;

    for (const source of sources) {
      const text = readFileSync(join(repositoryRoot, source), "utf8");
      for (const token of retired) expect(text, `${source}: ${token}`).not.toContain(token);
    }

    expect(
      readFileSync(
        join(repositoryRoot, "examples/message-board/app/src/deployment-config.ts"),
        "utf8",
      ),
    ).not.toContain("dispose:");

    expect(
      existsSync(join(repositoryRoot, "examples/message-board/app/src/delivery-quarantine.ts")),
    ).toBe(false);
    expect(
      existsSync(join(repositoryRoot, "examples/message-board/app/src/session-revocations.ts")),
    ).toBe(false);
  });
});
