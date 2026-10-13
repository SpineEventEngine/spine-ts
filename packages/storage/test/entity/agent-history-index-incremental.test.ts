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

import { create, toBinary } from "@bufbuild/protobuf";
import { AgentHistoryEntrySchema, ConversationIdSchema } from "@spine-event-engine/proto/agent";
import { describe, expect, it, vi } from "vitest";
import { AgentHistoryKeys } from "../../src/entity/agent-history.js";
import { AgentHistoryIndex } from "../../src/memory/agent-history-index.js";
import { conversation, event, occurredAt } from "./agent-history-fixtures.js";

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

  it("pages every indexed category without a byte ceiling and restores only an applied batch", () => {
    const index = new AgentHistoryIndex();
    const first = conversation("first", "thread", occurredAt(1n));
    const second = event("system", occurredAt(2n), true);
    const third = event("domain", occurredAt(3n), false);
    index.append(first);
    const update = index.withEntries([third, second]);
    update.restore();
    update.apply();
    update.apply();

    const newest = index.read({ kind: "full" }, undefined, 1, undefined);
    expect(newest.entries).toEqual([third]);
    expect(newest.hasMore).toBe(true);
    const next = index.read({ kind: "full" }, AgentHistoryKeys.fromEntry(third), 2, undefined);
    expect(next.entries).toEqual([second, first]);
    expect(next.hasMore).toBe(false);
    expect(index.read({ kind: "system" }, undefined, 2, undefined).entries).toEqual([second]);
    expect(index.read({ kind: "domain" }, undefined, 2, undefined).entries).toEqual([third]);
    expect(
      index.read(
        { kind: "conversation", conversation: create(ConversationIdSchema, { value: "thread" }) },
        undefined,
        2,
        undefined,
      ).entries,
    ).toEqual([first]);

    update.restore();
    update.restore();
    expect(index.read({ kind: "full" }, undefined, 2, undefined).entries).toEqual([first]);
    expect(index.read({ kind: "system" }, undefined, 2, undefined).entries).toEqual([]);
  });

  it("deduplicates exact records but rejects a changed record with the same identity", () => {
    const index = new AgentHistoryIndex();
    const original = event("same", occurredAt(1n), false);
    index.append(original);
    index.withEntries([original, original]).apply();
    expect(index.read({ kind: "full" }, undefined, 2, undefined).entries).toEqual([original]);
    expect(() => index.withEntries([event("same", occurredAt(2n), false)])).toThrow(
      "conflicts with immutable content",
    );
    expect(index.read({ kind: "full" }, undefined, 2, undefined).entries).toEqual([original]);
  });

  it("honors an explicit page byte allowance without losing the next older entry", () => {
    const index = new AgentHistoryIndex();
    const older = event("older", occurredAt(1n), false);
    const newer = event("newer", occurredAt(2n), false);
    index.append(older);
    index.append(newer);
    const newestBytes = index.read({ kind: "full" }, undefined, 1, undefined).entries[0];
    expect(newestBytes).toEqual(newer);
    const exact = AgentHistoryKeys.fromEntry(newer);
    const byteSize = toBinary(AgentHistoryEntrySchema, newer).length;
    expect(index.read({ kind: "full" }, undefined, 2, byteSize)).toMatchObject({
      entries: [newer],
      hasMore: true,
    });
    expect(index.read({ kind: "full" }, exact, 2, undefined).entries).toEqual([older]);
    expect(() => index.read({ kind: "full" }, undefined, 2, byteSize - 1)).toThrow(
      "first entry exceeds maxBytes",
    );
  });
});
