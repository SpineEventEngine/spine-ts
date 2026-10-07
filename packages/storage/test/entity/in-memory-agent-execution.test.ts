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

import { clone, create, toBinary } from "@bufbuild/protobuf";
import { AnySchema, EmptySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Time } from "@spine-event-engine/core";
import { AgentHistoryEntrySchema } from "@spine-event-engine/proto/agent";
import { AiModelKind, ModelPreferenceSchema } from "@spine-event-engine/proto/agent";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { EventIdSchema, EventSchema, VersionSchema } from "@spine-event-engine/proto";
import {
  AgentExecutionRecordSchema,
  AgentExecutionCompletionSchema,
  AgentInvocationCountersSchema,
  AgentInvocationStatus,
  AgentInvocationKeySchema,
  AgentOutgoingSignalSchema,
  AgentSavedDispatchPlanSchema,
  AgentSavedDispatchTargetSchema,
  AgentSavedTargetKind,
  AgentSignalKeySchema,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { describe, expect, it } from "vitest";

// prettier-ignore
import {
  SupportReplyDraftedSchema,
} from "../../../server/test-fixtures/generated/entity-metadata/support_agent_events_pb.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
} from "../../../server/test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import { AgentExecutionStorageFactories } from "../../src/internal/agent-execution.js";
import { AgentHistoryStorageFactories } from "../../src/internal/agent-history.js";
import { InMemoryStorageFactory } from "../../src/memory/in-memory-storage-factory.js";
import { accepted, entityInput } from "./agent-execution-fixtures.js";
import { conversation, scope as historyScope } from "./agent-history-fixtures.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Required Agent execution test value is missing.");
  return value;
}

describe("in-memory Agent execution", () => {
  it("pages eligible instance heads while later work behind a live claim stays hidden", async () => {
    let now = create(TimestampSchema, { seconds: 100n });
    const previous = Time.setProvider({ currentTime: () => now });
    const factory = new InMemoryStorageFactory();
    const handle = AgentExecutionStorageFactories.create(factory, {
      entity: entityInput(),
      stateType: "spine.server.testing.SupportReplyAgentState",
    });
    try {
      const a = accepted("a-first", "A");
      const b = accepted("b-first", "B");
      const c = accepted("c-first", "C");
      await handle.admit(a);
      await handle.admit(b);
      await handle.admit(c);
      now = create(TimestampSchema, { seconds: 101n });
      await handle.claim(required(a.key), "a-token", create(TimestampSchema, { seconds: 110n }));
      await handle.claim(required(b.key), "b-token", create(TimestampSchema, { seconds: 105n }));
      for (let version = 2n; version < 25n; version += 1n) {
        const behind = accepted(`a-later-${version.toString()}`, "A");
        required(behind.order).inboxVersion = version;
        await handle.admit(behind);
      }
      now = create(TimestampSchema, { seconds: 106n });
      const one = await handle.pending({ count: 1 });
      const two = await handle.pending({ count: 1, after: required(one.after) });
      expect(
        [
          one.records[0]?.accepted?.key?.scope?.agentKey,
          two.records[0]?.accepted?.key?.scope?.agentKey,
        ].sort(),
      ).toEqual(["B", "C"]);
      expect(two.hasMore).toBe(false);
    } finally {
      handle.close();
      Time.setProvider(previous);
    }
  });

  it("persists admission once and rejects changed source facts", async () => {
    const factory = new InMemoryStorageFactory();
    const handle = AgentExecutionStorageFactories.create(factory, {
      entity: entityInput(),
      stateType: "spine.server.testing.SupportReplyAgentState",
    });
    const original = accepted("source-1");
    await handle.admit(original);
    await expect(handle.admit(original)).resolves.toMatchObject({ accepted: original });
    const changed = accepted("source-1");
    required(changed.handlers[0]).methodName = "changed";
    await expect(handle.admit(changed)).rejects.toThrow(/immutable|different|mismatch/i);
    handle.close();
  });

  it("keeps accepted work isolated from unknown keys and a closed handle", async () => {
    const factory = new InMemoryStorageFactory();
    const input = {
      entity: entityInput(),
      stateType: "spine.server.testing.SupportReplyAgentState",
    };
    const handle = AgentExecutionStorageFactories.create(factory, input);
    const source = accepted("known-source");
    const key = required(source.key);
    const stored = await handle.admit(source);
    const unknown = required(accepted("unknown-source").key);
    expect(await handle.read(unknown)).toBeUndefined();
    expect(
      await handle.claim(
        unknown,
        "unknown-token",
        create(TimestampSchema, { seconds: 4_000_000_000n }),
      ),
    ).toBeUndefined();
    const wrongState = clone(AgentInvocationKeySchema, key);
    required(wrongState.scope).stateType = "spine.server.testing.OtherAgentState";
    expect(() => handle.read(wrongState)).toThrow(/state type/i);
    expect(await handle.read(key)).toEqual(stored);
    handle.close();
    expect(() => handle.read(key)).toThrow(/closed/i);
    const reopened = AgentExecutionStorageFactories.create(factory, input);
    try {
      expect(await reopened.read(key)).toEqual(stored);
      expect(
        (
          await reopened.claim(
            key,
            "reopened-token",
            create(TimestampSchema, { seconds: 4_000_000_000n }),
          )
        )?.record.claimToken,
      ).toBe("reopened-token");
    } finally {
      reopened.close();
    }
  });

  it("serializes one Agent instance and fences an expired claim", async () => {
    let now = create(TimestampSchema, { seconds: 100n });
    const previous = Time.setProvider({ currentTime: () => now });
    try {
      const factory = new InMemoryStorageFactory();
      const handle = AgentExecutionStorageFactories.create(factory, {
        entity: entityInput(),
        stateType: "spine.server.testing.SupportReplyAgentState",
      });
      const first = accepted("source-1");
      const second = accepted("source-2");
      required(second.order).inboxVersion = 2n;
      await handle.admit(first);
      await handle.admit(second);
      const key = required(first.key);
      const expiry = create(TimestampSchema, { seconds: 110n });
      const initial = await handle.claim(key, "token-1", expiry);
      expect(initial?.record.claimToken).toBe("token-1");
      await expect(handle.claim(key, "token-duplicate", expiry)).resolves.toBeUndefined();
      await expect(handle.claim(required(second.key), "token-2", expiry)).resolves.toBeUndefined();
      now = create(TimestampSchema, { seconds: 111n });
      await expect(
        handle.renew(key, "token-1", create(TimestampSchema, { seconds: 120n })),
      ).resolves.toBe(false);
      const replacement = await handle.claim(
        key,
        "token-3",
        create(TimestampSchema, { seconds: 130n }),
      );
      expect(replacement?.record.claimToken).toBe("token-3");
      await expect(
        handle.update({
          key,
          token: "token-1",
          expectedRecordBytes: toBinary(AgentExecutionRecordSchema, required(initial).record),
          next: required(initial).record,
        }),
      ).rejects.toThrow(/claim/i);
      handle.close();
    } finally {
      Time.setProvider(previous);
    }
  });

  it("keeps journal and history unchanged when the claimed lease expires", async () => {
    let now = create(TimestampSchema, { seconds: 100n });
    const previous = Time.setProvider({ currentTime: () => now });
    const factory = new InMemoryStorageFactory();
    const handle = AgentExecutionStorageFactories.create(factory, {
      entity: entityInput(),
      stateType: "spine.server.testing.SupportReplyAgentState",
    });
    const history = AgentHistoryStorageFactories.create(factory, historyScope);
    try {
      const source = accepted("expired-history");
      const key = required(source.key);
      await handle.admit(source);
      const claimed = required(
        await handle.claim(key, "expired-token", create(TimestampSchema, { seconds: 110n })),
      ).record;
      expect(claimed.claimExpiresAt?.seconds).toBe(110n);
      const entry = conversation(
        "expired-entry",
        "expired-conversation",
        create(TimestampSchema, { seconds: 101n }),
      );
      now = create(TimestampSchema, { seconds: 105n });
      await expect(
        handle.renew(key, "expired-token", create(TimestampSchema, { seconds: 112n })),
      ).resolves.toBe(true);
      const renewed = required(await handle.read(key));
      expect(renewed.claimExpiresAt?.seconds).toBe(112n);
      const next = clone(AgentExecutionRecordSchema, renewed);
      next.counters = create(AgentInvocationCountersSchema, { operations: 1n });
      now = create(TimestampSchema, { seconds: 110n });
      await expect(handle.pending({ count: 1 })).resolves.toMatchObject({ records: [] });
      now = create(TimestampSchema, { seconds: 112n });
      await expect(
        handle.update({
          key,
          token: "expired-token",
          expectedRecordBytes: toBinary(AgentExecutionRecordSchema, renewed),
          next,
          historyEntries: [entry],
        }),
      ).rejects.toThrow(/claim|current/i);
      expect(await handle.read(key)).toEqual(renewed);
      await expect(
        history.read({
          entityId: "T-execution",
          view: { kind: "full" },
          count: 1,
          maxBytes: 100_000,
        }),
      ).resolves.toMatchObject({ entries: [] });
      const reclaimed = required(
        await handle.claim(key, "new-token", create(TimestampSchema, { seconds: 120n })),
      );
      expect(reclaimed.record.claimToken).toBe("new-token");
      await handle.update({
        key,
        token: "new-token",
        expectedRecordBytes: toBinary(AgentExecutionRecordSchema, reclaimed.record),
        next: create(AgentExecutionRecordSchema, {
          ...reclaimed.record,
          counters: create(AgentInvocationCountersSchema, { operations: 1n }),
        }),
        historyEntries: [entry],
      });
      expect((await handle.read(key))?.counters?.operations).toBe(1n);
      expect(
        (
          await history.read({
            entityId: "T-execution",
            view: { kind: "full" },
            count: 1,
            maxBytes: 100_000,
          })
        ).entries,
      ).toEqual([entry]);
    } finally {
      history.close();
      handle.close();
      Time.setProvider(previous);
    }
  });

  it("releases a zero-output completion so the next accepted signal can start", async () => {
    const factory = new InMemoryStorageFactory();
    const handle = AgentExecutionStorageFactories.create(factory, {
      entity: entityInput(),
      stateType: "spine.server.testing.SupportReplyAgentState",
    });
    const first = accepted("source-complete-1");
    const second = accepted("source-complete-2");
    required(second.order).inboxVersion = 2n;
    await handle.admit(first);
    await handle.admit(second);
    const claim = await handle.claim(
      required(first.key),
      "complete-token",
      create(TimestampSchema, { seconds: 4_000_000_000n }),
    );
    expect(claim).toBeDefined();
    const next = clone(AgentExecutionRecordSchema, required(claim).record);
    next.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
    next.completion = create(AgentExecutionCompletionSchema, {
      initialVersion: create(VersionSchema, { number: 0 }),
      resultingVersion: create(VersionSchema, { number: 0 }),
    });
    await handle.complete({
      key: required(first.key),
      token: "complete-token",
      expectedRecordBytes: toBinary(AgentExecutionRecordSchema, required(claim).record),
      next,
    });
    await expect(
      handle.claim(
        required(second.key),
        "next-token",
        create(TimestampSchema, { seconds: 4_000_000_000n }),
      ),
    ).resolves.toMatchObject({ record: { claimToken: "next-token" } });
    handle.close();
  });

  it("publishes fenced journal and conversation history together", async () => {
    const factory = new InMemoryStorageFactory();
    const handle = AgentExecutionStorageFactories.create(factory, {
      entity: entityInput(),
      stateType: "spine.server.testing.SupportReplyAgentState",
    });
    const history = AgentHistoryStorageFactories.create(factory, historyScope);
    const source = accepted("source-history");
    await handle.admit(source);
    const claimed = required(
      await handle.claim(
        required(source.key),
        "history-token",
        create(TimestampSchema, { seconds: 4_000_000_000n }),
      ),
    ).record;
    const next = clone(AgentExecutionRecordSchema, claimed);
    next.counters = create(AgentInvocationCountersSchema, { operations: 1n });
    const entry = conversation(
      "record-history",
      "conversation-history",
      create(TimestampSchema, { seconds: 101n, nanos: 3 }),
    );
    await handle.update({
      key: required(source.key),
      token: "history-token",
      expectedRecordBytes: toBinary(AgentExecutionRecordSchema, claimed),
      next,
      historyEntries: [entry],
    });
    await expect(handle.read(required(source.key))).resolves.toMatchObject({
      counters: { operations: 1n },
    });
    const conflicted = clone(AgentExecutionRecordSchema, next);
    required(conflicted.counters).operations = 2n;
    const collision = conversation(
      "record-history",
      "conversation-history",
      create(TimestampSchema, { seconds: 102n }),
    );
    await expect(
      handle.update({
        key: required(source.key),
        token: "history-token",
        expectedRecordBytes: toBinary(AgentExecutionRecordSchema, next),
        next: conflicted,
        historyEntries: [collision],
      }),
    ).rejects.toThrow(/immutable/i);
    await expect(handle.read(required(source.key))).resolves.toMatchObject({
      counters: { operations: 1n },
    });
    const page = await history.read({
      entityId: "T-execution",
      view: { kind: "full" },
      count: 1,
      maxBytes: 100_000,
    });
    expect(page.entries).toHaveLength(1);
    expect(toBinary(AgentHistoryEntrySchema, required(page.entries[0]))).toEqual(
      toBinary(AgentHistoryEntrySchema, entry),
    );
    history.close();
    handle.close();
  });

  it("rejects a stale initial Entity Version without publishing completion or history", async () => {
    const factory = new InMemoryStorageFactory();
    const entity = entityInput();
    const current = factory.createEntityStorage(entity) as {
      current: { write(record: EntityRecord): Promise<void> };
    };
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-execution" });
    await current.current.write(
      create(EntityRecordSchema, {
        entityId: entity.id.pack(id),
        state: create(AnySchema, {
          typeUrl: `type.spine.server.testing/${SupportReplyAgentStateSchema.typeName}`,
          value: toBinary(
            SupportReplyAgentStateSchema,
            create(SupportReplyAgentStateSchema, { id, proposedReply: "Existing reply" }),
          ),
        }),
        version: create(VersionSchema, { number: 1 }),
      }),
    );
    const handle = AgentExecutionStorageFactories.create(factory, {
      entity,
      stateType: "spine.server.testing.SupportReplyAgentState",
    });
    const history = AgentHistoryStorageFactories.create(factory, historyScope);
    const source = accepted("source-stale-version");
    await handle.admit(source);
    const claimed = required(
      await handle.claim(
        required(source.key),
        "stale-token",
        create(TimestampSchema, { seconds: 4_000_000_000n }),
      ),
    ).record;
    const next = clone(AgentExecutionRecordSchema, claimed);
    next.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
    next.completion = create(AgentExecutionCompletionSchema, {
      initialVersion: create(VersionSchema, { number: 0 }),
      resultingVersion: create(VersionSchema, { number: 0 }),
    });
    await expect(
      handle.complete({
        key: required(source.key),
        token: "stale-token",
        expectedRecordBytes: toBinary(AgentExecutionRecordSchema, claimed),
        next,
        historyEntries: [
          conversation(
            "stale-history",
            "conversation-stale",
            create(TimestampSchema, { seconds: 103n }),
          ),
        ],
      }),
    ).rejects.toThrow(/Version/i);
    await expect(handle.read(required(source.key))).resolves.toEqual(claimed);
    await expect(
      history.read({
        entityId: "T-execution",
        view: { kind: "full" },
        count: 1,
        maxBytes: 100_000,
      }),
    ).resolves.toMatchObject({ entries: [] });
    history.close();
    handle.close();
  });

  it("retains pending output until its original Event ID is acknowledged", async () => {
    const factory = new InMemoryStorageFactory();
    const handle = AgentExecutionStorageFactories.create(factory, {
      entity: entityInput(),
      stateType: "spine.server.testing.SupportReplyAgentState",
    });
    const source = accepted("source-output");
    await handle.admit(source);
    const claimed = required(
      await handle.claim(
        required(source.key),
        "delivery-token",
        create(TimestampSchema, { seconds: 4_000_000_000n }),
      ),
    ).record;
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-execution" });
    const eventId = create(EventIdSchema, { value: "reply-drafted" });
    const event = create(EventSchema, {
      id: eventId,
      message: create(AnySchema, {
        typeUrl: `type.spine.server.testing/${SupportReplyDraftedSchema.typeName}`,
        value: toBinary(
          SupportReplyDraftedSchema,
          create(SupportReplyDraftedSchema, { agent: id, reply: "Please review." }),
        ),
      }),
    });
    const next = clone(AgentExecutionRecordSchema, claimed);
    next.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED_PENDING_DELIVERY;
    next.completion = create(AgentExecutionCompletionSchema, {
      initialVersion: create(VersionSchema, { number: 0 }),
      resultingVersion: create(VersionSchema, { number: 0 }),
      outgoing: [create(AgentOutgoingSignalSchema, { signal: { case: "event", value: event } })],
    });
    await handle.complete({
      key: required(source.key),
      token: "delivery-token",
      expectedRecordBytes: toBinary(AgentExecutionRecordSchema, claimed),
      next,
    });
    await expect(handle.pending({ count: 1 })).resolves.toMatchObject({
      records: [],
      hasMore: false,
    });
    const persisted = required(await handle.read(required(source.key)));
    const signal = create(AgentSignalKeySchema, { id: { case: "event", value: eventId } });
    await expect(
      handle.markDelivered(
        required(source.key),
        "delivery-token",
        toBinary(AgentExecutionRecordSchema, persisted),
        [signal],
      ),
    ).rejects.toThrow(/plan/i);
    const prepared = clone(AgentExecutionRecordSchema, persisted);
    required(required(prepared.completion).outgoing[0]).plan = create(AgentSavedDispatchPlanSchema);
    await handle.update({
      key: required(source.key),
      token: "delivery-token",
      expectedRecordBytes: toBinary(AgentExecutionRecordSchema, persisted),
      next: prepared,
    });
    const reopened = AgentExecutionStorageFactories.create(factory, {
      entity: entityInput(),
      stateType: "spine.server.testing.SupportReplyAgentState",
    });
    expect(
      (await reopened.read(required(source.key)))?.completion?.outgoing[0]?.plan?.targets,
    ).toEqual([]);
    reopened.close();
    const replanned = clone(AgentExecutionRecordSchema, prepared);
    required(required(required(replanned.completion).outgoing[0]).plan).targets.push(
      create(AgentSavedDispatchTargetSchema, {
        kind: AgentSavedTargetKind.AGENT_SAVED_STANDALONE_EVENT,
        signalType: SupportReplyDraftedSchema.typeName,
        bindingFingerprint: "different-handler",
      }),
    );
    await expect(
      handle.update({
        key: required(source.key),
        token: "delivery-token",
        expectedRecordBytes: toBinary(AgentExecutionRecordSchema, prepared),
        next: replanned,
      }),
    ).rejects.toThrow(/immutable/i);
    const changed = clone(AgentExecutionRecordSchema, prepared);
    required(required(changed.completion).outgoing[0]).signal = {
      case: "event",
      value: create(EventSchema, { id: eventId }),
    };
    await expect(
      handle.update({
        key: required(source.key),
        token: "delivery-token",
        expectedRecordBytes: toBinary(AgentExecutionRecordSchema, prepared),
        next: changed,
      }),
    ).rejects.toThrow(/only one-time|immutable/i);
    await handle.markDelivered(
      required(source.key),
      "delivery-token",
      toBinary(AgentExecutionRecordSchema, prepared),
      [signal],
    );
    await expect(handle.pending({ count: 1 })).resolves.toMatchObject({
      records: [],
      hasMore: false,
    });
    await expect(handle.read(required(source.key))).resolves.toMatchObject({
      status: AgentInvocationStatus.AGENT_INVOCATION_COMPLETED,
    });
    handle.close();
  });

  it("rejects a second completion after pending output is reclaimed", async () => {
    let now = create(TimestampSchema, { seconds: 100n });
    const previous = Time.setProvider({ currentTime: () => now });
    const factory = new InMemoryStorageFactory();
    const handle = AgentExecutionStorageFactories.create(factory, {
      entity: entityInput(),
      stateType: "spine.server.testing.SupportReplyAgentState",
    });
    try {
      const source = accepted("reclaimed-output");
      const key = required(source.key);
      await handle.admit(source);
      const first = required(
        await handle.claim(key, "first-token", create(TimestampSchema, { seconds: 110n })),
      );
      const agent = create(SupportReplyAgentIdSchema, { ticketNumber: "T-execution" });
      const drafted = create(SupportReplyDraftedSchema, { agent, reply: "Please review." });
      const event = create(EventSchema, {
        id: create(EventIdSchema, { value: "reclaimed-event" }),
        message: create(AnySchema, {
          typeUrl: `type.spine.server.testing/${SupportReplyDraftedSchema.typeName}`,
          value: toBinary(SupportReplyDraftedSchema, drafted),
        }),
      });
      const completed = clone(AgentExecutionRecordSchema, first.record);
      completed.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED_PENDING_DELIVERY;
      completed.completion = create(AgentExecutionCompletionSchema, {
        initialVersion: create(VersionSchema, { number: 0 }),
        resultingVersion: create(VersionSchema, { number: 0 }),
        outgoing: [create(AgentOutgoingSignalSchema, { signal: { case: "event", value: event } })],
      });
      await handle.complete({
        key,
        token: "first-token",
        expectedRecordBytes: toBinary(AgentExecutionRecordSchema, first.record),
        next: completed,
      });
      now = create(TimestampSchema, { seconds: 111n });
      const reclaimed = required(
        await handle.claim(key, "second-token", create(TimestampSchema, { seconds: 120n })),
      );
      const replacement = clone(AgentExecutionRecordSchema, reclaimed.record);
      replacement.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
      replacement.completion = create(AgentExecutionCompletionSchema, {
        initialVersion: create(VersionSchema, { number: 0 }),
        resultingVersion: create(VersionSchema, { number: 0 }),
      });
      await expect(
        handle.complete({
          key,
          token: "second-token",
          expectedRecordBytes: toBinary(AgentExecutionRecordSchema, reclaimed.record),
          next: replacement,
        }),
      ).rejects.toThrow(/active/i);
      expect(await handle.read(key)).toEqual(reclaimed.record);
      expect((await handle.read(key))?.completion?.outgoing).toHaveLength(1);
    } finally {
      handle.close();
      Time.setProvider(previous);
    }
  });

  it("copies stored and returned preferences across completion and claim", async () => {
    let now = create(TimestampSchema, { seconds: 100n });
    const previous = Time.setProvider({ currentTime: () => now });
    const factory = new InMemoryStorageFactory();
    const handle = AgentExecutionStorageFactories.create(factory, {
      entity: entityInput(),
      stateType: "spine.server.testing.SupportReplyAgentState",
    });
    try {
      const first = accepted("preference-first");
      const second = accepted("preference-second");
      required(second.order).inboxVersion = 2n;
      await handle.admit(first);
      await handle.admit(second);
      const claimed = required(
        await handle.claim(
          required(first.key),
          "first-token",
          create(TimestampSchema, { seconds: 110n }),
        ),
      );
      const next = clone(AgentExecutionRecordSchema, claimed.record);
      next.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
      const preference = create(ModelPreferenceSchema, {
        kind: AiModelKind.GENERATION,
        selection: { case: "inheritRepositoryDefault", value: create(EmptySchema) },
      });
      next.completion = create(AgentExecutionCompletionSchema, {
        initialVersion: create(VersionSchema, { number: 0 }),
        resultingVersion: create(VersionSchema, { number: 0 }),
        preferences: [preference],
      });
      await handle.complete({
        key: required(first.key),
        token: "first-token",
        expectedRecordBytes: toBinary(AgentExecutionRecordSchema, claimed.record),
        next,
      });
      preference.kind = AiModelKind.DECISION;
      const nextClaim = required(
        await handle.claim(
          required(second.key),
          "second-token",
          create(TimestampSchema, { seconds: 110n }),
        ),
      );
      expect(nextClaim.preferences[0]?.kind).toBe(AiModelKind.GENERATION);
      const returned = required(nextClaim.preferences[0]);
      returned.kind = AiModelKind.DECISION;
      now = create(TimestampSchema, { seconds: 111n });
      const reclaimed = required(
        await handle.claim(
          required(second.key),
          "third-token",
          create(TimestampSchema, { seconds: 120n }),
        ),
      );
      expect(reclaimed.preferences[0]?.kind).toBe(AiModelKind.GENERATION);
    } finally {
      handle.close();
      Time.setProvider(previous);
    }
  });
});
