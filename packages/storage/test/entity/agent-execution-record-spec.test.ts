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
import { EventIdSchema } from "@spine-event-engine/proto";
import {
  AgentExecutionHeadSchema,
  AgentExecutionRecordSchema,
  AgentExecutionScopeSchema,
  AgentInboxOrderSchema,
  AgentSignalKeySchema,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { describe, expect, it } from "vitest";

import { AgentExecutionRecords } from "../../src/entity/agent-execution-record-spec.js";
import { accepted } from "./agent-execution-fixtures.js";

function order(seconds: bigint, nanos: number, id: string) {
  return create(AgentInboxOrderSchema, {
    receivedAt: create(TimestampSchema, { seconds, nanos }),
    inboxVersion: 1n,
    sourceSignal: create(AgentSignalKeySchema, {
      id: { case: "event", value: create(EventIdSchema, { value: id }) },
    }),
  });
}

describe("Agent execution physical keys", () => {
  it("orders complete Timestamp and UTF-8 source identities without truncation", () => {
    const a = AgentExecutionRecords.order(order(1n, 999_999_998, "a"));
    const b = AgentExecutionRecords.order(order(1n, 999_999_999, "a"));
    const c = AgentExecutionRecords.order(order(2n, 0, "a"));
    const unicode = AgentExecutionRecords.order(order(2n, 0, "é"));
    expect([a, b, c, unicode]).toEqual([...new Set([a, b, c, unicode])].sort());
    expect(AgentExecutionRecords.order(order(2n, 0, "prefix"))).not.toBe(
      AgentExecutionRecords.order(order(2n, 0, "prefix-long")),
    );
  });

  it("separates complete state type and Agent keys", () => {
    const first = create(AgentExecutionScopeSchema, { stateType: "a", agentKey: "bc" });
    const second = create(AgentExecutionScopeSchema, { stateType: "ab", agentKey: "c" });
    expect(AgentExecutionRecords.scope(first)).not.toBe(AgentExecutionRecords.scope(second));
  });

  it("materializes full invocation and head indexes from the original accepted work", () => {
    const invocation = accepted("prefix-é", "T-ä");
    const record = create(AgentExecutionRecordSchema, { accepted: invocation });
    const scope = invocation.key?.scope;
    const key = invocation.key;
    const order = invocation.order;
    if (scope === undefined || key === undefined || order === undefined)
      throw new Error("Accepted fixture lacks Agent identity or order.");
    const head = create(AgentExecutionHeadSchema, {
      scope,
      pending: key,
      pendingOrder: order,
      eligibleAt: create(TimestampSchema, { seconds: 101n, nanos: 2 }),
    });
    const digest = (text: string) => `digest:${text}`;
    const invocationRow = AgentExecutionRecords.invocationSpec(digest).materialize(record);
    const headRow = AgentExecutionRecords.headSpec(digest).materialize(head);
    const eligibleAt = head.eligibleAt;
    if (eligibleAt === undefined) throw new Error("Head fixture lacks eligibility time.");
    expect(invocationRow.id).toBe(digest(AgentExecutionRecords.invocation(key)));
    expect([...invocationRow.columns]).toEqual([
      ["state_type", scope.stateType],
      ["agent_key", scope.agentKey],
      ["scope_digest", digest(AgentExecutionRecords.scope(scope))],
      ["status", "0"],
      ["order_key", AgentExecutionRecords.order(order)],
    ]);
    expect(headRow.id).toBe(digest(AgentExecutionRecords.scope(scope)));
    expect([...headRow.columns]).toEqual([
      ["state_type", scope.stateType],
      ["agent_key", scope.agentKey],
      ["scope_digest", digest(AgentExecutionRecords.scope(scope))],
      ["state_digest", digest(scope.stateType)],
      ["pending_key", AgentExecutionRecords.pendingKey(eligibleAt, scope)],
    ]);
    head.pending = undefined;
    head.pendingOrder = undefined;
    head.eligibleAt = undefined;
    expect(
      AgentExecutionRecords.headSpec(digest).materialize(head).columns.get("pending_key"),
    ).toBe("~");
  });

  it("rejects partial discovery metadata and incomplete invocation records", () => {
    const invocation = accepted("source");
    const scope = invocation.key?.scope;
    if (scope === undefined) throw new Error("Accepted fixture lacks Agent scope.");
    const head = create(AgentExecutionHeadSchema, { scope, pending: invocation.key });
    expect(() => AgentExecutionRecords.headSpec((value) => value).materialize(head)).toThrow(
      /incomplete discovery metadata/i,
    );
    const record = create(AgentExecutionRecordSchema, { accepted: invocation });
    const acceptedRecord = record.accepted;
    if (acceptedRecord === undefined) throw new Error("Record fixture lacks accepted work.");
    acceptedRecord.order = undefined;
    expect(() =>
      AgentExecutionRecords.invocationSpec((value) => value).materialize(record),
    ).toThrow(/Inbox order/i);
  });

  it("keeps eligibility before the fixed as-of boundary and orders full UTF-8 scopes", () => {
    const time = create(TimestampSchema, { seconds: 101n, nanos: 2 });
    const first = create(AgentExecutionScopeSchema, { stateType: "a", agentKey: "é" });
    const second = create(AgentExecutionScopeSchema, { stateType: "a", agentKey: "ê" });
    expect(
      AgentExecutionRecords.pendingKey(time, first) <
        AgentExecutionRecords.pendingKey(time, second),
    ).toBe(true);
    expect(
      AgentExecutionRecords.pendingKey(time, first) > AgentExecutionRecords.pendingLower(time),
    ).toBe(true);
    expect(
      AgentExecutionRecords.pendingKey(
        create(TimestampSchema, { seconds: 101n, nanos: 1 }),
        first,
      ) < AgentExecutionRecords.pendingLower(time),
    ).toBe(true);
  });
});
