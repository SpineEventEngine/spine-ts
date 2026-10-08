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
import {
  CommandIdSchema,
  CommandSchema,
  EventIdSchema,
  EventSchema,
} from "@spine-event-engine/proto";
import { Time } from "@spine-event-engine/core";
import {
  AgentExecutionCompletionSchema,
  AgentExecutionHeadSchema,
  AgentExecutionRecordSchema,
  AgentInvocationStatus,
  AgentOutgoingSignalSchema,
  AgentSignalKeySchema,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { describe, expect, it } from "vitest";

import { AgentExecutionValues } from "../../src/entity/agent-execution-values.js";
import { accepted } from "./agent-execution-fixtures.js";

describe("Agent execution value boundaries", () => {
  it("requires the configured state and the complete original source identity", () => {
    const source = accepted("source-id");
    const key = source.key;
    const scope = key?.scope;
    if (key === undefined || scope === undefined)
      throw new Error("Fixture lacks original invocation key.");
    expect(AgentExecutionValues.requiredKey(key, scope.stateType)).toBe(key);
    expect(() => AgentExecutionValues.requiredKey(key, "other.State")).toThrow(/configured state/i);
    key.sourceSignal = undefined;
    expect(() => AgentExecutionValues.requiredKey(key, scope.stateType)).toThrow(/source ID/i);
  });

  it("compares complete accepted images and clones independently", () => {
    const original = accepted("source-id");
    const same = accepted("source-id");
    const changed = accepted("other-id");
    expect(AgentExecutionValues.sameAccepted(original, same)).toBe(true);
    expect(AgentExecutionValues.sameAccepted(original, changed)).toBe(false);
    expect(AgentExecutionValues.sameAccepted(original, undefined)).toBe(false);
    expect(AgentExecutionValues.sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(
      false,
    );
    const record = create(AgentExecutionRecordSchema, { accepted: original });
    const copy = AgentExecutionValues.cloneRecord(record);
    copy.claimToken = "later-token";
    expect(record.claimToken).toBe("");
  });

  it("claims accepted, pending-delivery and expired active work at the full Timestamp edge", () => {
    const now = create(TimestampSchema, { seconds: 10n, nanos: 5 });
    const record = create(AgentExecutionRecordSchema, { accepted: accepted("source-id") });
    record.status = AgentInvocationStatus.AGENT_INVOCATION_ACCEPTED;
    expect(AgentExecutionValues.isPending(record, now)).toBe(true);
    record.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED_PENDING_DELIVERY;
    expect(AgentExecutionValues.isPending(record, now)).toBe(true);
    record.status = AgentInvocationStatus.AGENT_INVOCATION_ACTIVE;
    record.claimExpiresAt = create(TimestampSchema, { seconds: 10n, nanos: 6 });
    expect(AgentExecutionValues.isPending(record, now)).toBe(false);
    record.claimExpiresAt.nanos = 5;
    expect(AgentExecutionValues.isPending(record, now)).toBe(true);
    expect(
      AgentExecutionValues.compareTime(create(TimestampSchema, { seconds: 9n }), now),
    ).toBeLessThan(0);
    expect(AgentExecutionValues.compareText("a", "a")).toBe(0);
  });

  it("releases the claim and marks only the recorded typed output", () => {
    const source = accepted("source-id");
    const scope = source.key?.scope;
    const order = source.order;
    if (scope === undefined || order === undefined)
      throw new Error("Fixture lacks Agent scope or order.");
    const head = create(AgentExecutionHeadSchema, {
      scope,
      active: source.key,
      claimToken: "token",
    });
    AgentExecutionValues.release(head, order);
    expect(head.active).toBeUndefined();
    expect(head.claimToken).toBe("");
    expect(head.lastResolved).toEqual(order);
    const completion = create(AgentExecutionCompletionSchema, {
      outgoing: [
        create(AgentOutgoingSignalSchema, {
          signal: {
            case: "event",
            value: create(EventSchema, { id: create(EventIdSchema, { value: "event-id" }) }),
          },
        }),
      ],
    });
    const event = create(AgentSignalKeySchema, {
      id: { case: "event", value: create(EventIdSchema, { value: "event-id" }) },
    });
    const command = create(AgentSignalKeySchema, {
      id: { case: "command", value: create(CommandIdSchema, { uuid: "event-id" }) },
    });
    expect(() => {
      AgentExecutionValues.markSignal(completion, command);
    }).toThrow(/not recorded/i);
    AgentExecutionValues.markSignal(completion, event);
    expect(completion.outgoing[0]?.delivered).toBe(true);
  });

  it("offers earlier Inbox work without changing eligibility and promotes a successor", () => {
    const now = create(TimestampSchema, { seconds: 200n });
    const previous = Time.setProvider({ currentTime: () => now });
    try {
      const later = accepted("later");
      const earlier = accepted("earlier");
      const firstOrder = later.order;
      const secondOrder = earlier.order;
      const scope = later.key?.scope;
      if (firstOrder === undefined || secondOrder === undefined || scope === undefined)
        throw new Error("Fixture lacks Agent order or scope.");
      firstOrder.inboxVersion = 2n;
      secondOrder.inboxVersion = 1n;
      const head = create(AgentExecutionHeadSchema, { scope });
      AgentExecutionValues.offerCandidate(
        head,
        create(AgentExecutionRecordSchema, { accepted: later }),
      );
      const eligibleAt = head.eligibleAt;
      expect(eligibleAt).toEqual(now);
      AgentExecutionValues.offerCandidate(
        head,
        create(AgentExecutionRecordSchema, { accepted: earlier }),
      );
      expect(head.pending).toEqual(earlier.key);
      expect(head.eligibleAt).toEqual(eligibleAt);
      const expiry = create(TimestampSchema, { seconds: 300n });
      const activeHead = create(AgentExecutionHeadSchema, {
        scope,
        active: later.key,
        pending: later.key,
        pendingOrder: firstOrder,
        eligibleAt,
        claimExpiresAt: expiry,
      });
      AgentExecutionValues.offerCandidate(
        activeHead,
        create(AgentExecutionRecordSchema, { accepted: earlier }),
      );
      expect(activeHead.pending).toEqual(earlier.key);
      expect(activeHead.eligibleAt).toEqual(expiry);
      AgentExecutionValues.advanceCandidate(
        head,
        secondOrder,
        create(AgentExecutionRecordSchema, { accepted: later }),
      );
      expect(head.active).toBeUndefined();
      expect(head.pending).toEqual(later.key);
      expect(head.lastResolved).toEqual(secondOrder);
      expect(head.eligibleAt).toEqual(now);
      AgentExecutionValues.advanceCandidate(head, firstOrder, undefined);
      expect(head.pending).toBeUndefined();
      expect(head.eligibleAt).toBeUndefined();
    } finally {
      Time.setProvider(previous);
    }
  });
});

describe("Agent execution decoded record validation", () => {
  it("rejects a persisted record that lacks accepted scope or original order", () => {
    const record = create(AgentExecutionRecordSchema);
    expect(() => AgentExecutionValues.requiredAccepted(record)).toThrow(/accepted source facts/i);
    record.accepted = accepted("source");
    record.accepted.order = undefined;
    expect(() => AgentExecutionValues.requiredAccepted(record)).toThrow(/Inbox order/i);
    expect(() => AgentExecutionValues.requiredScope(undefined)).toThrow(/scope/i);
    expect(() => AgentExecutionValues.requiredHeadScope(create(AgentExecutionHeadSchema))).toThrow(
      /scope/i,
    );
    expect(() => AgentExecutionValues.requiredCompletion(record)).toThrow(/completion/i);
    expect(() => AgentExecutionValues.requiredKey(undefined, "support.State")).toThrow(
      /configured state/i,
    );
  });

  it("does not reclaim work without an active expired lease", () => {
    const record = create(AgentExecutionRecordSchema, {
      accepted: accepted("source"),
      status: AgentInvocationStatus.AGENT_INVOCATION_ACTIVE,
    });
    const now = create(TimestampSchema, { seconds: 100n });
    expect(AgentExecutionValues.isPending(record, now)).toBe(false);
    record.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
    expect(AgentExecutionValues.isPending(record, now)).toBe(false);
    record.status = AgentInvocationStatus.AGENT_INVOCATION_TERMINATED;
    expect(AgentExecutionValues.isPending(record, now)).toBe(false);
  });

  it("marks only the saved Command when an Event has equal ID text", () => {
    const record = create(AgentExecutionCompletionSchema, {
      outgoing: [
        create(AgentOutgoingSignalSchema, {
          signal: {
            case: "event",
            value: create(EventSchema, { id: create(EventIdSchema, { value: "same-id" }) }),
          },
        }),
        create(AgentOutgoingSignalSchema, {
          signal: {
            case: "command",
            value: create(CommandSchema, { id: create(CommandIdSchema, { uuid: "same-id" }) }),
          },
        }),
      ],
    });
    AgentExecutionValues.markSignal(
      record,
      create(AgentSignalKeySchema, {
        id: { case: "command", value: create(CommandIdSchema, { uuid: "same-id" }) },
      }),
    );
    expect(record.outgoing.map((item) => item.delivered)).toEqual([false, true]);
  });

  it("keeps the earlier pending signal when later work arrives", () => {
    const original = accepted("earlier");
    const later = accepted("later");
    if (later.order === undefined) throw new Error("Fixture requires order.");
    later.order.inboxVersion = 2n;
    const head = create(AgentExecutionHeadSchema, {
      scope: original.key?.scope,
      pending: original.key,
      pendingOrder: original.order,
      eligibleAt: create(TimestampSchema, { seconds: 100n }),
    });
    AgentExecutionValues.offerCandidate(
      head,
      create(AgentExecutionRecordSchema, { accepted: later }),
    );
    expect(head.pending).toEqual(original.key);
    expect(head.eligibleAt).toEqual(create(TimestampSchema, { seconds: 100n }));
  });
});
