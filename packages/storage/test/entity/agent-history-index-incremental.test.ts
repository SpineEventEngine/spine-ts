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
import { AgentHistoryIndex } from "../../src/memory/agent-history-index.js";
import { conversation, occurredAt } from "./agent-history-fixtures.js";

const counts = vi.hoisted(() => ({ decodes: 0 }));

vi.mock("@bufbuild/protobuf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bufbuild/protobuf")>();
  return {
    ...actual,
    fromBinary: (...args: Parameters<typeof actual.fromBinary>) => {
      counts.decodes += 1;
      return actual.fromBinary(...args);
    },
  };
});

describe("incremental in-memory Agent history index", () => {
  it("does not decode previously retained rows when preparing another append", () => {
    const index = new AgentHistoryIndex();
    index.append(conversation("prior", "conversation", occurredAt(1n)));
    counts.decodes = 0;
    index.withEntries([conversation("new", "conversation", occurredAt(2n))]);
    expect(counts.decodes).toBe(0);
  });
});
