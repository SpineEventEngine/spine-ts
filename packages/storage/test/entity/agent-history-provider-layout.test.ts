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

import { clone, create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { AnyPacker, SignalEnvelopes } from "@spine-event-engine/core";
import { EventContextSchema } from "@spine-event-engine/proto";
import {
  AgentHistoryEntrySchema,
  AgentIdSchema,
  CallModelSchema,
  ModelCallAbandonedRecordSchema,
  ModelOutcomeHandledRecordSchema,
  ModelRepliedSchema,
} from "@spine-event-engine/proto/agent";
import { describe, expect, it } from "vitest";
// prettier-ignore
import {
  ProposedSupportReplySchema,
} from "../../../server/test-fixtures/generated/entity-metadata/support_ai_types_pb.js";

import { AgentHistoryKeys } from "../../src/entity/agent-history.js";
import { AgentHistoryPages } from "../../src/entity/agent-history-provider-page.js";
import { AgentHistoryRecords } from "../../src/entity/agent-history-record-spec.js";
import {
  conversation,
  event,
  modelRequest,
  occurredAt,
  scope,
  submissionAttempt,
} from "./agent-history-fixtures.js";

const digest = (value: string): string => `digest:${value}`;
const at = occurredAt(1_789_000_001n, 123_456_789);

function materialized(name: string, entry: ReturnType<typeof event>) {
  const record = AgentHistoryRecords.capture(scope.agent("ticket"), entry);
  const spec = AgentHistoryRecords.spec(digest);
  return spec.columns.find((column) => column.name === name)?.valueIn(record);
}

describe("Agent history provider layout", () => {
  it("stores direct entries with complete typed identity and indexed keys", () => {
    const domain = event("event-id", at, false);
    const record = AgentHistoryRecords.capture(scope.agent("ticket"), domain);
    const spec = AgentHistoryRecords.spec(digest);
    expect(record.agent).toEqual(scope.agent("ticket"));
    expect(domain.agent).toBeUndefined();
    expect(spec.idValueIn(record)).toBe(digest(AgentHistoryRecords.slot(record)));
    expect(spec.columns.some((column) => column.name === "state_type")).toBe(false);
    expect(materialized("agent_key", domain)).toBe(
      AgentHistoryRecords.scope(scope.agent("ticket")),
    );
    expect(materialized("scope_digest", domain)).toBe(
      digest(AgentHistoryRecords.scope(scope.agent("ticket"))),
    );
    expect(materialized("category", domain)).toBe("domain");
    expect(materialized("conversation_key", domain)).toBe("");
    expect(materialized("conversation_digest", domain)).toBe(digest(""));
    expect(materialized("order_key", domain)).toBe(
      AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(domain)),
    );
    const conversationEntry = conversation("record-id", "conversation-id", at);
    expect(materialized("conversation_key", conversationEntry)).toBe("conversation-id");
    expect(materialized("conversation_digest", conversationEntry)).toBe(digest("conversation-id"));
    expect(AgentHistoryRecords.slot(record)).not.toBe(
      AgentHistoryRecords.slot(AgentHistoryRecords.capture(scope.agent("other"), domain)),
    );
    expect(AgentHistoryRecords.slot(record)).not.toBe(
      AgentHistoryRecords.slot(
        AgentHistoryRecords.capture(
          { ...scope.agent("ticket"), stateTypeUrl: "type.spine.example/OtherAgentState" },
          domain,
        ),
      ),
    );
  });

  it("stamps absent identity and rejects different or missing stored identity", () => {
    const entry = event("event-id", at, false);
    const valid = AgentHistoryRecords.capture(scope.agent("ticket"), entry);
    expect(entry.agent).toBeUndefined();
    expect(AgentHistoryRecords.capture(scope.agent("ticket"), valid)).toEqual(valid);
    expect(() => AgentHistoryRecords.capture(scope.agent("other"), valid)).toThrow(
      "identity conflict",
    );
    expect(() => AgentHistoryRecords.slot({ ...valid, agent: undefined })).toThrow();
    expect(() =>
      AgentHistoryRecords.requireIdentity({ ...valid, agent: undefined }, scope.agent("ticket")),
    ).toThrow();
  });

  it("retains unknown entry and supplied identity fields while detaching input", () => {
    const agent = scope.agent("ticket");
    const unknown = Uint8Array.of(0xa0, 0x06, 0x01);
    const supplied = fromBinary(
      AgentIdSchema,
      Uint8Array.of(...toBinary(AgentIdSchema, agent), ...unknown),
    );
    const original = event("unknown", at, false);
    original.agent = supplied;
    const entry = fromBinary(
      AgentHistoryEntrySchema,
      Uint8Array.of(...toBinary(AgentHistoryEntrySchema, original), ...unknown),
    );
    const stored = AgentHistoryRecords.capture(agent, entry);
    expect(stored).not.toBe(entry);
    expect(toBinary(AgentHistoryEntrySchema, stored)).toEqual(
      toBinary(AgentHistoryEntrySchema, entry),
    );
    const storedAgent = stored.agent;
    if (storedAgent === undefined) throw new Error("Expected the captured Agent identity.");
    expect(toBinary(AgentIdSchema, storedAgent)).toEqual(toBinary(AgentIdSchema, supplied));
  });

  it("rejects incomplete conversation and Event identities before provider indexing", () => {
    const conversationEntry = conversation("record-id", "conversation-id", at);
    if (conversationEntry.item.case !== "conversationRecord")
      throw new Error("Expected conversation history.");
    conversationEntry.item.value.conversation = undefined;
    expect(() => AgentHistoryKeys.fromEntry(conversationEntry)).toThrow("ConversationId");

    const missingRecordId = conversation("record-id", "conversation-id", at);
    if (missingRecordId.item.case !== "conversationRecord")
      throw new Error("Expected conversation history.");
    missingRecordId.item.value.id = undefined;
    expect(() => AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(missingRecordId))).toThrow(
      "record ID",
    );

    const missingEventId = event("event-id", at, false);
    if (missingEventId.item.case !== "domainEvent") throw new Error("Expected domain Event.");
    missingEventId.item.value.id = undefined;
    expect(() => AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(missingEventId))).toThrow(
      "record ID",
    );
  });

  it("uses exact request identity across Agent scopes and model history categories", () => {
    const request = modelRequest("scoped-call", at);
    const attempted = submissionAttempt("first-attempt", request, at);
    const stored = AgentHistoryRecords.capture(scope.agent("ticket"), request);
    expect(AgentHistoryRecords.requestEntry(stored, scope.agent("ticket"), "scoped-call")).toEqual(
      stored,
    );
    expect(AgentHistoryRecords.slot(stored)).toBe(
      AgentHistoryRecords.requestSlot(scope.agent("ticket"), "scoped-call"),
    );
    expect(() => AgentHistoryRecords.requestSlot(scope.agent("ticket"), "")).toThrow();
    expect(() =>
      AgentHistoryRecords.requestEntry(stored, scope.agent("other"), "scoped-call"),
    ).toThrow("identity conflict");
    expect(() =>
      AgentHistoryRecords.requestEntry(
        stored,
        { ...scope.agent("ticket"), stateTypeUrl: "other.State" },
        "scoped-call",
      ),
    ).toThrow("identity conflict");
    expect(() =>
      AgentHistoryRecords.requestEntry(stored, scope.agent("ticket"), "another-call"),
    ).toThrow("identity conflict");
    expect(materialized("category", request)).toBe("request");
    expect(materialized("category", attempted)).toBe("attempt");
    expect(materialized("conversation_key", request)).toBe("");
    expect(materialized("conversation_key", attempted)).toBe("");
  });

  it("indexes handled replies and explicit abandonment without placing them in conversation history", () => {
    const request = modelRequest("outcome-call", at);
    if (request.item.case !== "modelRequest" || request.item.value.request?.message === undefined)
      throw new Error("Expected a complete request fixture.");
    const payload = AnyPacker.unpack(request.item.value.request.message, CallModelSchema);
    const call = payload.call;
    if (call?.id === undefined || call.conversation === undefined)
      throw new Error("Expected complete model call metadata.");
    const outcome = SignalEnvelopes.event({
      schema: ModelRepliedSchema,
      message: create(ModelRepliedSchema, {
        call,
        output: AnyPacker.pack(
          ProposedSupportReplySchema,
          create(ProposedSupportReplySchema, { replyText: "A reviewed answer." }),
        ),
        whenStarted: at,
        whenCompleted: at,
      }),
      context: create(EventContextSchema, { timestamp: at }),
    });
    const handledRecord = create(ModelOutcomeHandledRecordSchema, {
      id: "handled-1",
      call: call.id,
      conversation: call.conversation,
      outcome,
      whenHandled: at,
    });
    const handled = create(AgentHistoryEntrySchema, {
      whenOccurred: at,
      item: { case: "handledOutcome", value: handledRecord },
    });
    const source = request.item.value.source;
    const abandonedRecord = create(ModelCallAbandonedRecordSchema, {
      id: "abandoned-1",
      call: call.id,
      conversation: call.conversation,
      whenAbandoned: at,
      source,
    });
    const abandoned = create(AgentHistoryEntrySchema, {
      whenOccurred: at,
      item: { case: "abandonment", value: abandonedRecord },
    });
    expect(materialized("category", handled)).toBe("handled");
    expect(materialized("category", abandoned)).toBe("abandoned");
    expect(materialized("conversation_key", handled)).toBe("");
    expect(materialized("conversation_key", abandoned)).toBe("");
    expect(AgentHistoryKeys.fromEntry(handled).recordId).toBe("handled-1");
    expect(AgentHistoryKeys.fromEntry(abandoned).recordId).toBe("abandoned-1");
    expect(() =>
      AgentHistoryKeys.fromEntry({
        ...handled,
        item: {
          case: "handledOutcome",
          value: { ...handledRecord, call: undefined },
        },
      }),
    ).toThrow("call and conversation");
    expect(() =>
      AgentHistoryKeys.fromEntry({
        ...handled,
        item: {
          case: "handledOutcome",
          value: { ...handledRecord, outcome: undefined },
        },
      }),
    ).toThrow("complete Event");
    expect(() =>
      AgentHistoryKeys.fromEntry({
        ...abandoned,
        item: {
          case: "abandonment",
          value: { ...abandonedRecord, source: { case: undefined } },
        },
      }),
    ).toThrow("triggering signal");
    expect(() =>
      AgentHistoryKeys.fromEntry({ ...abandoned, whenOccurred: occurredAt(2n) }),
    ).toThrow("wrapper time");
    expect(() =>
      AgentHistoryKeys.fromEntry({
        ...handled,
        item: {
          case: "handledOutcome",
          value: { ...handledRecord, conversation: undefined },
        },
      }),
    ).toThrow("call and conversation");
    expect(() =>
      AgentHistoryKeys.fromEntry({
        ...abandoned,
        item: {
          case: "abandonment",
          value: { ...abandonedRecord, call: undefined },
        },
      }),
    ).toThrow("call and conversation");
  });

  it("rejects malformed prepared requests and submission attempts before indexing", () => {
    const request = modelRequest("guarded-call", at);
    const absentCall = clone(AgentHistoryEntrySchema, request);
    if (absentCall.item.case !== "modelRequest") throw new Error("Expected model request.");
    absentCall.item.value.request = undefined;
    expect(() => AgentHistoryKeys.fromEntry(absentCall)).toThrow("requires a CallModel Command");
    const absentSource = clone(AgentHistoryEntrySchema, request);
    if (absentSource.item.case !== "modelRequest") throw new Error("Expected model request.");
    absentSource.item.value.source = { case: undefined };
    expect(() => AgentHistoryKeys.fromEntry(absentSource)).toThrow("triggering signal");
    const wrongRequestTime = clone(AgentHistoryEntrySchema, request);
    wrongRequestTime.whenOccurred = occurredAt(2n);
    expect(() => AgentHistoryKeys.fromEntry(wrongRequestTime)).toThrow("wrapper time");
    const attempt = submissionAttempt("guarded-attempt", request, at);
    const missingAttempt = clone(AgentHistoryEntrySchema, attempt);
    if (missingAttempt.item.case !== "submissionAttempt") throw new Error("Expected attempt.");
    missingAttempt.item.value.command = undefined;
    expect(() => AgentHistoryKeys.fromEntry(missingAttempt)).toThrow(
      "requires a CallModel Command",
    );
    const wrongAttemptTime = clone(AgentHistoryEntrySchema, attempt);
    if (wrongAttemptTime.item.case !== "submissionAttempt") throw new Error("Expected attempt.");
    wrongAttemptTime.item.value.whenAttempted = occurredAt(2n);
    expect(() => AgentHistoryKeys.fromEntry(wrongAttemptTime)).toThrow("wrapper time");
    const wrongSubmissionTime = clone(AgentHistoryEntrySchema, attempt);
    if (wrongSubmissionTime.item.case !== "submissionAttempt") throw new Error("Expected attempt.");
    const attemptedCommand = wrongSubmissionTime.item.value.command;
    if (attemptedCommand?.message === undefined) throw new Error("Expected attempted Command.");
    const attemptedPayload = AnyPacker.unpack(attemptedCommand.message, CallModelSchema);
    attemptedPayload.whenSubmissionAttempted = occurredAt(2n);
    attemptedCommand.message = AnyPacker.pack(CallModelSchema, attemptedPayload);
    expect(() => AgentHistoryKeys.fromEntry(wrongSubmissionTime)).toThrow("wrapper time");
  });

  it("keeps non-ASCII record identities distinct and ordered in provider keys", () => {
    const first = event("résumé", at, false);
    const second = event("resume", at, false);
    const firstKey = AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(first));
    const secondKey = AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(second));
    expect(firstKey).not.toBe(secondKey);
    expect(
      AgentHistoryKeys.compare(
        AgentHistoryKeys.fromEntry(first),
        AgentHistoryKeys.fromEntry(second),
      ),
    ).toBe(Math.sign(firstKey.localeCompare(secondKey, "en")));
  });
});

describe("Agent history native query paging", () => {
  const first = event("first", occurredAt(1_789_000_002n), false);
  const second = event("second", at, true);
  const records = [
    AgentHistoryRecords.capture(scope.agent("ticket"), first),
    AgentHistoryRecords.capture(scope.agent("ticket"), second),
  ];

  it("uses an exclusive full-key cursor and returns independent bounded entries", async () => {
    const calls: [string | undefined, number][] = [];
    const page = await AgentHistoryPages.read(
      { count: 1, maxBytes: 10000 },
      scope.agent("ticket"),
      undefined,
      (after, limit) => {
        calls.push([after, limit]);
        return Promise.resolve(
          records
            .filter(
              (record) =>
                after === undefined ||
                AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(record)) > after,
            )
            .slice(0, limit)
            .map((record) => clone(AgentHistoryEntrySchema, record)),
        );
      },
    );
    expect(page.entries).toEqual([records[0]]);
    expect(page.hasMore).toBe(true);
    expect(calls).toEqual([[undefined, 2]]);
    expect(page.entries[0]).not.toBe(first);
    const boundary = AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(first));
    const next = await AgentHistoryPages.read(
      { count: 1, maxBytes: 10000 },
      scope.agent("ticket"),
      boundary,
      (after) =>
        Promise.resolve(
          records.filter(
            (record) =>
              AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(record)) > (after ?? ""),
          ),
        ),
    );
    expect(next.entries).toEqual([records[1]]);
    expect(next.hasMore).toBe(false);
  });

  it("stops at byte limits and rejects a first entry that cannot fit", async () => {
    const firstRecord = records[0];
    if (firstRecord === undefined) throw new Error("Expected the first history fixture.");
    const bytes = toBinary(AgentHistoryEntrySchema, firstRecord).length;
    const page = await AgentHistoryPages.read(
      { count: 2, maxBytes: bytes },
      scope.agent("ticket"),
      undefined,
      () => Promise.resolve(records),
    );
    expect(page.entries).toEqual([records[0]]);
    expect(page.hasMore).toBe(true);
    await expect(
      AgentHistoryPages.read(
        { count: 1, maxBytes: bytes - 1 },
        scope.agent("ticket"),
        undefined,
        () => Promise.resolve(records),
      ),
    ).rejects.toThrow("first entry exceeds maxBytes");
  });

  it("returns a complete entry larger than 1 MiB when no byte ceiling is supplied", async () => {
    const large = event("e".repeat(1_050_000), at, false);
    const record = AgentHistoryRecords.capture(scope.agent("ticket"), large);
    const page = await AgentHistoryPages.read({ count: 1 }, scope.agent("ticket"), undefined, () =>
      Promise.resolve([record]),
    );
    expect(page.entries).toHaveLength(1);
    const entry = page.entries[0];
    if (!entry) throw new Error("Expected a history entry");
    expect(entry.item.case).toBe("domainEvent");
    expect(toBinary(AgentHistoryEntrySchema, entry).length).toBeGreaterThan(1_048_576);
    expect(page.hasMore).toBe(false);
  });

  it("rejects invalid bounds and missing stored identity", async () => {
    await expect(
      AgentHistoryPages.read({ count: 0, maxBytes: 100 }, scope.agent("ticket"), undefined, () =>
        Promise.resolve([]),
      ),
    ).rejects.toThrow("positive safe integer");
    await expect(
      AgentHistoryPages.read({ count: 1, maxBytes: 0 }, scope.agent("ticket"), undefined, () =>
        Promise.resolve([]),
      ),
    ).rejects.toThrow("positive safe integer");
    const missing = {
      ...AgentHistoryRecords.capture(scope.agent("ticket"), first),
      agent: undefined,
    };
    await expect(
      AgentHistoryPages.read({ count: 1, maxBytes: 100 }, scope.agent("ticket"), undefined, () =>
        Promise.resolve([missing]),
      ),
    ).rejects.toThrow("identity conflict");
  });
});
