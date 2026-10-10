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

import { randomUUID } from "node:crypto";
import { clone, create, toBinary } from "@bufbuild/protobuf";
import { AnySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema, VersionSchema } from "@spine-event-engine/proto";
import { StringifierRegistry, Time, TypeRegistry } from "@spine-event-engine/core";
import * as Execution from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { AgentExecutionStorageFactories } from "@spine-event-engine/storage/provider";
import { describe, expect, it } from "vitest";

import { accepted } from "../../storage/test/entity/agent-execution-fixtures.js";
import { providerEntityInput } from "../../storage/test/entity/agent-execution-provider-fixtures.js";
import { exerciseAgentExecutionLifecycle } from "../../storage/test/entity/agent-execution-provider-conformance.js";
import { HistoryDatastoreBackend } from "./datastore/entity-history-fixture.js";
import { DatastoreStorageFactory } from "../src/index.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
} from "../../server/test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
// prettier-ignore
import {
  SupportReplyDraftedSchema,
} from "../../server/test-fixtures/generated/entity-metadata/support_agent_events_pb.js";
// prettier-ignore
import {
  DraftSupportReplySchema,
} from "../../server/test-fixtures/generated/entity-metadata/support_agent_commands_pb.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Required Agent execution test value is missing.");
  return value;
}

describe("Datastore Agent execution provider boundary", () => {
  it("keeps the original invocation across reconstruction and fences a second claim", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();
    const input = {
      entity: providerEntityInput(),
      stateType: "spine.server.testing.SupportReplyAgentState",
    };
    const storage = AgentExecutionStorageFactories.create(factory, input);
    const source = accepted(randomUUID(), `T-${randomUUID()}`);
    const key = required(source.key);
    try {
      await storage.admit(source);
      expect((await storage.pending({ count: 1 })).records[0]?.accepted).toEqual(source);
      const expiry = create(TimestampSchema, { seconds: 4_000_000_000n });
      await expect(storage.claim(key, "", expiry)).rejects.toThrow(/future expiry and token/i);
      await expect(
        storage.claim(key, "stale-token", create(TimestampSchema, { seconds: 1n })),
      ).rejects.toThrow(/future expiry and token/i);
      const first = required(await storage.claim(key, "first-token", expiry));
      expect(first.record.claimToken).toBe("first-token");
      expect(await storage.claim(key, "second-token", expiry)).toBeUndefined();
      expect(
        await storage.renew(
          key,
          "wrong-token",
          create(TimestampSchema, { seconds: 4_000_000_001n }),
        ),
      ).toBe(false);
      await expect(
        storage.markDelivered(
          key,
          "first-token",
          toBinary(Execution.AgentExecutionRecordSchema, first.record),
          [],
        ),
      ).rejects.toThrow(/completion is missing/i);
      expect((await storage.read(key))?.status).toBe(first.record.status);
      await exerciseAgentExecutionLifecycle(storage);
      storage.close();
      await expect(storage.read(key)).rejects.toThrow(/closed/i);
      const reopened = AgentExecutionStorageFactories.create(factory, input);
      try {
        expect((await reopened.read(key))?.claimToken).toBe("first-token");
      } finally {
        reopened.close();
      }
    } finally {
      storage.close();
      factory.close();
    }
  });

  it("retries native contention, preserves immutable admission, and promotes a waiting source", async () => {
    const backend = new HistoryDatastoreBackend();
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(backend.client() as never)
      .build();
    const storage = AgentExecutionStorageFactories.create(factory, {
      entity: providerEntityInput(),
      stateType: "spine.server.testing.SupportReplyAgentState",
    });
    const first = accepted("00000000-0000-0000-0000-000000000001", "T-same-instance");
    const second = accepted("00000000-0000-0000-0000-000000000002", "T-same-instance");
    const other = accepted("00000000-0000-0000-0000-000000000003", "T-other-instance");
    const firstKey = required(first.key);
    const secondKey = required(second.key);
    const expiry = create(TimestampSchema, { seconds: 4_000_000_000n });
    try {
      backend.abortedTransactions = 1;
      expect((await storage.admit(first)).accepted).toEqual(first);
      expect(backend.rollbacks).toBeGreaterThan(1);
      expect(await storage.admit(first)).toEqual(await storage.read(firstKey));
      const changed = clone(Execution.AgentAcceptedInvocationSchema, first);
      required(changed.handlers[0]).methodName = "different-handler";
      await expect(storage.admit(changed)).rejects.toThrow(/immutable/i);
      await storage.admit(second);
      await storage.admit(other);
      const page = await storage.pending({ count: 1 });
      expect(page.records.map((record) => record.accepted?.key)).toEqual([first.key]);
      expect(page.hasMore).toBe(true);
      await expect(storage.pending({ count: 0 })).rejects.toThrow(/count/i);
      const wrongCursor = clone(
        Execution.AgentExecutionScopeSchema,
        required(required(page.after).key.scope),
      );
      wrongCursor.stateType = "spine.server.testing.OtherAgentState";
      await expect(
        storage.pending({
          count: 1,
          after: {
            ...required(page.after),
            key: { ...required(page.after).key, scope: wrongCursor },
          },
        }),
      ).rejects.toThrow(/another state type/i);
      const followingPage = await storage.pending({ count: 1, after: required(page.after) });
      expect(followingPage.records.map((record) => record.accepted?.key)).toEqual([other.key]);
      expect(followingPage.hasMore).toBe(false);
      const exhausted = await storage.pending({ count: 1, after: required(followingPage.after) });
      expect(exhausted.records).toEqual([]);
      expect(exhausted.hasMore).toBe(false);
      expect(await storage.claim(secondKey, "early", expiry)).toBeUndefined();
      const claimed = required(await storage.claim(firstKey, "first", expiry));
      expect(claimed.record.claimToken).toBe("first");
      expect(await storage.claim(firstKey, "second", expiry)).toBeUndefined();
      expect(await storage.claim(secondKey, "waiting", expiry)).toBeUndefined();
      expect(await storage.renew(firstKey, "first", expiry)).toBe(false);
      expect(
        await storage.renew(
          firstKey,
          "first",
          create(TimestampSchema, { seconds: 4_000_000_001n }),
        ),
      ).toBe(true);
      expect((await storage.read(firstKey))?.claimExpiresAt?.seconds).toBe(4_000_000_001n);
      const terminated = clone(
        Execution.AgentExecutionRecordSchema,
        required(await storage.read(firstKey)),
      );
      terminated.status = Execution.AgentInvocationStatus.AGENT_INVOCATION_TERMINATED;
      await storage.update({
        key: firstKey,
        token: "first",
        expectedRecordBytes: toBinary(
          Execution.AgentExecutionRecordSchema,
          required(await storage.read(firstKey)),
        ),
        next: terminated,
      });
      expect((await storage.read(firstKey))?.status).toBe(
        Execution.AgentInvocationStatus.AGENT_INVOCATION_TERMINATED,
      );
      const afterTermination = await storage.pending({ count: 2 });
      expect(afterTermination.records.map((record) => record.accepted?.key)).toEqual([
        other.key,
        second.key,
      ]);
      expect(afterTermination.hasMore).toBe(false);
      expect((await storage.claim(secondKey, "promoted", expiry))?.record.claimToken).toBe(
        "promoted",
      );
      expect(await storage.claim(firstKey, "obsolete", expiry)).toBeUndefined();
      const completed = clone(
        Execution.AgentExecutionRecordSchema,
        required(await storage.read(secondKey)),
      );
      completed.status = Execution.AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
      completed.completion = create(Execution.AgentExecutionCompletionSchema, {
        initialVersion: create(VersionSchema, { number: 0 }),
        resultingVersion: create(VersionSchema, { number: 0 }),
      });
      await storage.complete({
        key: secondKey,
        token: "promoted",
        expectedRecordBytes: toBinary(
          Execution.AgentExecutionRecordSchema,
          required(await storage.read(secondKey)),
        ),
        next: completed,
      });
      expect((await storage.read(secondKey))?.status).toBe(
        Execution.AgentInvocationStatus.AGENT_INVOCATION_COMPLETED,
      );
    } finally {
      storage.close();
      factory.close();
    }
  });

  it("expires a lease using fresh provider time and rejects the former token", async () => {
    let now = create(TimestampSchema, { seconds: 1_000n });
    const previous = Time.setProvider({ currentTime: () => now });
    const backend = new HistoryDatastoreBackend();
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(backend.client() as never)
      .build();
    const storage = AgentExecutionStorageFactories.create(factory, {
      entity: providerEntityInput(),
      stateType: "spine.server.testing.SupportReplyAgentState",
    });
    const source = accepted(randomUUID(), `T-${randomUUID()}`);
    const key = required(source.key);
    try {
      await storage.admit(source);
      const first = required(
        await storage.claim(key, "expired", create(TimestampSchema, { seconds: 1_001n })),
      );
      now = create(TimestampSchema, { seconds: 1_002n });
      expect(
        await storage.renew(key, "expired", create(TimestampSchema, { seconds: 1_003n })),
      ).toBe(false);
      await expect(
        storage.update({
          key,
          token: "expired",
          expectedRecordBytes: toBinary(Execution.AgentExecutionRecordSchema, first.record),
          next: clone(Execution.AgentExecutionRecordSchema, first.record),
        }),
      ).rejects.toThrow(/claim|current/i);
      const recovered = required(
        await storage.claim(key, "recovered", create(TimestampSchema, { seconds: 1_003n })),
      );
      expect(recovered.record.claimToken).toBe("recovered");
      expect(recovered.record.status).toBe(Execution.AgentInvocationStatus.AGENT_INVOCATION_ACTIVE);
      await expect(
        storage.markDelivered(
          key,
          "expired",
          toBinary(Execution.AgentExecutionRecordSchema, first.record),
          [],
        ),
      ).rejects.toThrow(/claim|current/i);
      expect((await storage.read(key))?.claimToken).toBe("recovered");
    } finally {
      storage.close();
      factory.close();
      Time.setProvider(previous);
    }
  });

  it("rejects incomplete or divergent completion without changing the retained claim", async () => {
    const backend = new HistoryDatastoreBackend();
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(backend.client() as never)
      .build();
    const storage = AgentExecutionStorageFactories.create(factory, {
      entity: providerEntityInput(),
      stateType: "spine.server.testing.SupportReplyAgentState",
    });
    const source = accepted(randomUUID(), `T-${randomUUID()}`);
    const key = required(source.key);
    try {
      await storage.admit(source);
      const prior = required(
        await storage.claim(
          key,
          "completion-token",
          create(TimestampSchema, { seconds: 4_000_000_000n }),
        ),
      ).record;
      const expectedRecordBytes = toBinary(Execution.AgentExecutionRecordSchema, prior);
      const candidate = clone(Execution.AgentExecutionRecordSchema, prior);
      candidate.status = Execution.AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
      for (const [next, message] of [
        [candidate, /both Versions/i],
        [
          create(Execution.AgentExecutionRecordSchema, {
            ...candidate,
            completion: create(Execution.AgentExecutionCompletionSchema, {
              initialVersion: create(VersionSchema, { number: 0 }),
              resultingVersion: create(VersionSchema, { number: 1 }),
            }),
          }),
          /exactly one Version or a no-op/i,
        ],
      ] as const) {
        await expect(
          storage.complete({ key, token: "completion-token", expectedRecordBytes, next }),
        ).rejects.toThrow(message);
        expect(
          toBinary(Execution.AgentExecutionRecordSchema, required(await storage.read(key))),
        ).toEqual(expectedRecordBytes);
      }
      const wrongSource = clone(Execution.AgentExecutionRecordSchema, candidate);
      wrongSource.completion = create(Execution.AgentExecutionCompletionSchema, {
        initialVersion: create(VersionSchema, { number: 0 }),
        resultingVersion: create(VersionSchema, { number: 0 }),
      });
      required(required(wrongSource.accepted).handlers[0]).methodName = "changed";
      await expect(
        storage.complete({
          key,
          token: "completion-token",
          expectedRecordBytes,
          next: wrongSource,
        }),
      ).rejects.toThrow(/immutable/i);
      expect(
        toBinary(Execution.AgentExecutionRecordSchema, required(await storage.read(key))),
      ).toEqual(expectedRecordBytes);
    } finally {
      storage.close();
      factory.close();
    }
  });

  it("commits typed Entity state, diagnostic history, and a domain Event with execution", async () => {
    const backend = new HistoryDatastoreBackend();
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(
      new TypeRegistry([
        SupportReplyAgentIdSchema,
        SupportReplyAgentStateSchema,
        SupportReplyDraftedSchema,
      ]),
    );
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(backend.client() as never)
      .setStringifierRegistry(stringifiers)
      .build();
    const entity = { ...providerEntityInput(), stateHistory: true, eventHistory: true };
    const storage = AgentExecutionStorageFactories.create(factory, {
      entity,
      stateType: SupportReplyAgentStateSchema.typeName,
    });
    const source = accepted(randomUUID(), `T-${randomUUID()}`);
    const key = required(source.key);
    const id = required(entity.id.unpack(required(source.recipientId)));
    try {
      await storage.admit(source);
      const prior = required(
        await storage.claim(
          key,
          "entity-token",
          create(TimestampSchema, { seconds: 4_000_000_000n }),
        ),
      ).record;
      const next = clone(Execution.AgentExecutionRecordSchema, prior);
      next.status = Execution.AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
      next.completion = create(Execution.AgentExecutionCompletionSchema, {
        initialVersion: create(VersionSchema, { number: 0 }),
        resultingVersion: create(VersionSchema, { number: 1 }),
      });
      const current = create(EntityRecordSchema, {
        entityId: source.recipientId,
        state: create(AnySchema, {
          typeUrl: `type.spine.server.testing/${SupportReplyAgentStateSchema.typeName}`,
          value: toBinary(
            SupportReplyAgentStateSchema,
            create(SupportReplyAgentStateSchema, { id, proposedReply: "A reply" }),
          ),
        }),
        version: create(VersionSchema, {
          number: 1,
          timestamp: create(TimestampSchema, { seconds: 101n }),
        }),
      });
      const diagnostic = create(EventSchema, {
        id: create(EventIdSchema, { value: randomUUID() }),
        context: {
          producerId: source.recipientId,
          version: create(VersionSchema, { number: 1 }),
          timestamp: create(TimestampSchema, { seconds: 101n }),
        },
      });
      const event = create(EventSchema, {
        id: create(EventIdSchema, { value: randomUUID() }),
        message: create(AnySchema, {
          typeUrl: `type.spine.server.testing/${SupportReplyDraftedSchema.typeName}`,
          value: toBinary(
            SupportReplyDraftedSchema,
            create(SupportReplyDraftedSchema, { agent: id, reply: "A reply" }),
          ),
        }),
      });
      const commit = {
        context: entity.context,
        entity,
        entityId: id,
        next: current,
        states: [current],
        diagnostics: [diagnostic],
        events: [event],
      };
      const expectedRecordBytes = toBinary(Execution.AgentExecutionRecordSchema, prior);
      const beforeRejectedCommits = backend.entities.size;
      const anotherId = entity.id.clone(id);
      anotherId.ticketNumber = "T-another-recipient";
      await expect(
        storage.complete({
          key,
          token: "entity-token",
          expectedRecordBytes,
          next,
          entityCommit: { ...commit, entityId: anotherId },
        }),
      ).rejects.toThrow(/scope differs/i);
      const wrongVersion = clone(EntityRecordSchema, current);
      wrongVersion.version = create(VersionSchema, { number: 2 });
      await expect(
        storage.complete({
          key,
          token: "entity-token",
          expectedRecordBytes,
          next,
          entityCommit: { ...commit, next: wrongVersion },
        }),
      ).rejects.toThrow(/exactly one Version/i);
      expect(backend.entities.size).toBe(beforeRejectedCommits);
      expect((await storage.read(key))?.status).toBe(
        Execution.AgentInvocationStatus.AGENT_INVOCATION_ACTIVE,
      );
      await storage.complete({
        key,
        token: "entity-token",
        expectedRecordBytes,
        next,
        entityCommit: commit,
      });
      const persisted = factory.createEntityStorage(entity);
      try {
        expect(await persisted.current.read(id)).toMatchObject({
          entityId: { typeUrl: required(source.recipientId).typeUrl },
          state: { typeUrl: required(current.state).typeUrl },
          version: { number: 1 },
        });
        expect(await persisted.states.backward(id, 1)).toMatchObject([{ version: { number: 1 } }]);
        expect(await persisted.events.backward(id, 1)).toMatchObject([{ id: diagnostic.id }]);
        expect((await storage.read(key))?.status).toBe(
          Execution.AgentInvocationStatus.AGENT_INVOCATION_COMPLETED,
        );
      } finally {
        persisted.close();
      }
      const following = accepted(randomUUID(), required(key.scope).agentKey);
      const followingKey = required(following.key);
      await storage.admit(following);
      const followingPrior = required(
        await storage.claim(
          followingKey,
          "later-token",
          create(TimestampSchema, { seconds: 4_000_000_000n }),
        ),
      ).record;
      const followingNext = clone(Execution.AgentExecutionRecordSchema, followingPrior);
      followingNext.status = Execution.AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
      followingNext.completion = create(Execution.AgentExecutionCompletionSchema, {
        initialVersion: create(VersionSchema, { number: 0 }),
        resultingVersion: create(VersionSchema, { number: 0 }),
      });
      const followingBytes = toBinary(Execution.AgentExecutionRecordSchema, followingPrior);
      await expect(
        storage.complete({
          key: followingKey,
          token: "later-token",
          expectedRecordBytes: followingBytes,
          next: followingNext,
        }),
      ).rejects.toThrow(/initial Entity Version is no longer current/i);
      required(followingNext.completion).initialVersion = create(VersionSchema, { number: 1 });
      required(followingNext.completion).resultingVersion = create(VersionSchema, { number: 1 });
      await storage.complete({
        key: followingKey,
        token: "later-token",
        expectedRecordBytes: followingBytes,
        next: followingNext,
      });
      expect((await storage.read(followingKey))?.status).toBe(
        Execution.AgentInvocationStatus.AGENT_INVOCATION_COMPLETED,
      );
    } finally {
      storage.close();
      factory.close();
    }
  });

  it("rejects Entity completion when the typed recipient is invalid or histories are disabled", async () => {
    const backend = new HistoryDatastoreBackend();
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(backend.client() as never)
      .build();
    const entity = providerEntityInput();
    const storage = AgentExecutionStorageFactories.create(factory, {
      entity,
      stateType: SupportReplyAgentStateSchema.typeName,
    });
    try {
      const invalidSource = clone(
        Execution.AgentAcceptedInvocationSchema,
        accepted(randomUUID(), "T-invalid-id"),
      );
      invalidSource.recipientId = create(AnySchema, {
        typeUrl: "type.spine.server.testing/OtherId",
      });
      const invalidKey = required(invalidSource.key);
      await storage.admit(invalidSource);
      const invalidPrior = required(
        await storage.claim(
          invalidKey,
          "invalid-id",
          create(TimestampSchema, { seconds: 4_000_000_000n }),
        ),
      ).record;
      const invalidNext = clone(Execution.AgentExecutionRecordSchema, invalidPrior);
      invalidNext.status = Execution.AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
      invalidNext.completion = create(Execution.AgentExecutionCompletionSchema, {
        initialVersion: create(VersionSchema, { number: 0 }),
        resultingVersion: create(VersionSchema, { number: 0 }),
      });
      await expect(
        storage.complete({
          key: invalidKey,
          token: "invalid-id",
          expectedRecordBytes: toBinary(Execution.AgentExecutionRecordSchema, invalidPrior),
          next: invalidNext,
        }),
      ).rejects.toThrow(/recipient ID has the wrong type/i);
      const source = accepted(randomUUID(), "T-disabled-history");
      const key = required(source.key);
      const id = required(entity.id.unpack(required(source.recipientId)));
      await storage.admit(source);
      const prior = required(
        await storage.claim(
          key,
          "disabled-history",
          create(TimestampSchema, { seconds: 4_000_000_000n }),
        ),
      ).record;
      const next = clone(Execution.AgentExecutionRecordSchema, prior);
      next.status = Execution.AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
      next.completion = create(Execution.AgentExecutionCompletionSchema, {
        initialVersion: create(VersionSchema, { number: 0 }),
        resultingVersion: create(VersionSchema, { number: 1 }),
      });
      const current = create(EntityRecordSchema, {
        entityId: source.recipientId,
        state: create(AnySchema, {
          typeUrl: `type.spine.server.testing/${SupportReplyAgentStateSchema.typeName}`,
          value: toBinary(
            SupportReplyAgentStateSchema,
            create(SupportReplyAgentStateSchema, { id }),
          ),
        }),
        version: create(VersionSchema, { number: 1 }),
      });
      const diagnostic = create(EventSchema, {
        id: create(EventIdSchema, { value: randomUUID() }),
        context: { producerId: source.recipientId, version: create(VersionSchema, { number: 1 }) },
      });
      const base = {
        key,
        token: "disabled-history",
        expectedRecordBytes: toBinary(Execution.AgentExecutionRecordSchema, prior),
        next,
      };
      const commit = { context: entity.context, entity, entityId: id, next: current };
      const size = backend.entities.size;
      await expect(
        storage.complete({ ...base, entityCommit: { ...commit, states: [current] } }),
      ).rejects.toThrow(/state history is disabled/i);
      await expect(
        storage.complete({ ...base, entityCommit: { ...commit, diagnostics: [diagnostic] } }),
      ).rejects.toThrow(/diagnostic history is disabled/i);
      expect(backend.entities.size).toBe(size);
      expect((await storage.read(key))?.status).toBe(
        Execution.AgentInvocationStatus.AGENT_INVOCATION_ACTIVE,
      );
    } finally {
      storage.close();
      factory.close();
    }
  });

  it("rejects indexed and payload values beyond Datastore capacity before admission writes", async () => {
    const backend = new HistoryDatastoreBackend();
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(backend.client() as never)
      .build();
    const entity = providerEntityInput();
    const storage = AgentExecutionStorageFactories.create(factory, {
      entity,
      stateType: SupportReplyAgentStateSchema.typeName,
    });
    try {
      await expect(storage.admit(accepted("x".repeat(800), "T-long-order"))).rejects.toThrow(
        /indexed value exceeds Datastore capacity/i,
      );
      await expect(storage.admit(accepted("short-id", `T-${"x".repeat(800)}`))).rejects.toThrow(
        /head key exceeds Datastore indexed-value capacity/i,
      );
      const oversizedCommand = accepted(randomUUID(), "T-large-record");
      if (oversizedCommand.signal.case !== "command")
        throw new Error("Expected typed Command fixture.");
      required(oversizedCommand.signal.value.message).value = toBinary(
        DraftSupportReplySchema,
        create(DraftSupportReplySchema, {
          agent: required(entity.id.unpack(required(oversizedCommand.recipientId))),
          question: "q".repeat(1_000_000),
        }),
      );
      await expect(storage.admit(oversizedCommand)).rejects.toThrow(
        /record exceeds Datastore entity payload capacity/i,
      );
      expect(backend.entities.size).toBe(0);
    } finally {
      storage.close();
      factory.close();
    }
  });
});
