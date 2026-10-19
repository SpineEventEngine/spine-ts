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

import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AgentHistoryEntrySchema } from "@spine-event-engine/proto/agent";
import { describe, expect, it } from "vitest";

import { AgentHistoryKeys, type AgentHistoryOrderKey } from "../../src/entity/agent-history.js";

function key(
  seconds: bigint,
  nanos: number,
  category: AgentHistoryOrderKey["category"],
  recordId: string,
): AgentHistoryOrderKey {
  return { occurredAt: create(TimestampSchema, { seconds, nanos }), category, recordId };
}

describe("Agent history order", () => {
  it("uses full timestamp, category, and unsigned UTF-8 ID order in its sortable index", () => {
    const ordered = [
      key(253402300799n, 999999999, "conversation", "a"),
      key(1n, 1000001, "conversation", "a"),
      key(1n, 1000000, "conversation", "a"),
      key(1n, 1000000, "system", "a"),
      key(1n, 1000000, "domain", "a"),
      key(1n, 1000000, "domain", "aa"),
      key(1n, 1000000, "domain", "z"),
      key(1n, 1000000, "domain", "é"),
      key(-62135596800n, 0, "domain", "a"),
    ];
    const values = ordered.map((entry) => AgentHistoryKeys.indexValue(entry));
    expect([...values].sort()).toEqual(values);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (previous === undefined || current === undefined)
        throw new Error("Missing order fixture.");
      expect(AgentHistoryKeys.compare(previous, current)).toBeLessThan(0);
    }
    expect(AgentHistoryKeys.indexValue(key(1n, 0, "domain", "a"))).not.toBe(
      AgentHistoryKeys.indexValue(key(1n, 0, "domain", "aa")),
    );
  });

  it("rejects timestamps outside the complete Protobuf range", () => {
    expect(() => AgentHistoryKeys.indexValue(key(-62135596801n, 0, "domain", "a"))).toThrow();
    expect(() => AgentHistoryKeys.indexValue(key(253402300800n, 0, "domain", "a"))).toThrow();
    expect(() => AgentHistoryKeys.indexValue(key(0n, 1000000000, "domain", "a"))).toThrow();
    expect(() => AgentHistoryKeys.indexValue(key(0n, -1, "domain", "a"))).toThrow();
  });

  it("requires a complete entry and immutable identity before indexing", () => {
    expect(() => AgentHistoryKeys.fromEntry(create(AgentHistoryEntrySchema))).toThrow();
    expect(() => AgentHistoryKeys.indexValue(key(0n, 0, "domain", ""))).toThrow();
    const invalidCategory = { ...key(0n, 0, "domain", "a"), category: "other" };
    expect(() => AgentHistoryKeys.indexValue(invalidCategory as AgentHistoryOrderKey)).toThrow();
  });
});
