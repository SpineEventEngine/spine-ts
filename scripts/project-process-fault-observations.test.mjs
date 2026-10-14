/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the
 * License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing permissions and limitations
 * under the License.
 */

import { describe, expect, it } from "vitest";

import { completeInboxRows } from "../packages/server-blackbox-tests/test-fixtures/project-process-fault-observations.mjs";

const complete = {
  shards: [
    {
      shard: "0/2",
      count: 1,
      truncated: false,
      rows: [{ messageId: "m1", signalId: "s1", status: "TO_DELIVER" }],
    },
    { shard: "1/2", count: 0, truncated: false, rows: [] },
    { shard: "0/1", count: 0, truncated: false, rows: [] },
  ],
};

describe("process-fault Inbox observations", () => {
  it("returns rows only from a complete expected shard set", () => {
    expect(completeInboxRows(complete, 2)).toEqual([
      { messageId: "m1", signalId: "s1", status: "TO_DELIVER" },
    ]);
  });

  it("rejects an error rather than treating failed reads as empty", () => {
    expect(() =>
      completeInboxRows(
        { shards: [{ shard: "0/2", error: "provider read failed" }, ...complete.shards.slice(1)] },
        2,
      ),
    ).toThrow(/provider read failed/u);
  });

  it("rejects missing, duplicated, truncated, and malformed observations", () => {
    for (const shards of [
      complete.shards.slice(1),
      [complete.shards[0], complete.shards[0], complete.shards[2]],
      [{ ...complete.shards[0], truncated: true }, ...complete.shards.slice(1)],
      [{ ...complete.shards[0], rows: undefined }, ...complete.shards.slice(1)],
      [{ ...complete.shards[0], count: 2 }, ...complete.shards.slice(1)],
      [
        { ...complete.shards[0], rows: [{ messageId: "", signalId: "s1", status: "TO_DELIVER" }] },
        ...complete.shards.slice(1),
      ],
    ]) {
      expect(() => completeInboxRows({ shards }, 2)).toThrow();
    }
  });
});
