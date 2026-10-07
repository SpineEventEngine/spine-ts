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
import { Datastore } from "@google-cloud/datastore";
import { clone, create, toBinary } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema, VersionSchema } from "@spine-event-engine/proto";
import { AgentHistoryEntrySchema } from "@spine-event-engine/proto/agent";
import { Time } from "@spine-event-engine/core";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { AgentHistoryStorageFactories } from "@spine-event-engine/storage/provider";
import { conversation } from "../../storage/test/entity/agent-history-fixtures.js";
// prettier-ignore
import {
  SupportReplyAgentStateSchema,
} from "../../server/test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
// prettier-ignore
import {
  SupportReplyDraftedSchema,
} from "../../server/test-fixtures/generated/entity-metadata/support_agent_events_pb.js";
import {
  AgentExecutionCompletionSchema,
  AgentOutgoingSignalSchema,
  AgentSavedDispatchPlanSchema,
  AgentSignalKeySchema,
  AgentExecutionRecordSchema,
  AgentInvocationStatus,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import {
  AgentExecutionSizes,
  AgentExecutionStorageFactories,
} from "@spine-event-engine/storage/provider";
import { describe, expect, it } from "vitest";

import { accepted } from "../../storage/test/entity/agent-execution-fixtures.js";
import { providerEntityInput } from "../../storage/test/entity/agent-execution-provider-fixtures.js";
import { exerciseAgentExecutionLifecycle } from "../../storage/test/entity/agent-execution-provider-conformance.js";
import { DatastoreStorageFactory } from "../src/index.js";

const emulatorHost = process.env.DATASTORE_EMULATOR_HOST;

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Required Agent execution test value is missing.");
  return value;
}

describe.runIf(emulatorHost !== undefined)("Datastore Agent execution", () => {
  it("retains a prepared empty output plan and fences its original Event", async () => {
    const client = new Datastore({ projectId: `spine-agent-plan-${randomUUID()}` });
    const input = {
      entity: providerEntityInput(),
      stateType: "spine.server.testing.SupportReplyAgentState",
    };
    const factory = DatastoreStorageFactory.newBuilder().setClient(client).build();
    const handle = AgentExecutionStorageFactories.create(factory, input);
    const source = accepted(randomUUID(), `T-${randomUUID()}`);
    const eventId = create(EventIdSchema, { value: randomUUID() });
    try {
      await handle.admit(source);
      const claim = required(
        await handle.claim(
          required(source.key),
          "plan-token",
          create(TimestampSchema, { seconds: 4_000_000_000n }),
        ),
      );
      const recipient = required(source.recipientId);
      const agent = required(input.entity.id.unpack(recipient));
      const event = create(EventSchema, {
        id: eventId,
        message: create(AnySchema, {
          typeUrl: `type.spine.server.testing/${SupportReplyDraftedSchema.typeName}`,
          value: toBinary(
            SupportReplyDraftedSchema,
            create(SupportReplyDraftedSchema, { agent, reply: "Please review." }),
          ),
        }),
      });
      const completed = clone(AgentExecutionRecordSchema, claim.record);
      completed.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED_PENDING_DELIVERY;
      completed.completion = create(AgentExecutionCompletionSchema, {
        initialVersion: create(VersionSchema, { number: 0 }),
        resultingVersion: create(VersionSchema, { number: 0 }),
        outgoing: [create(AgentOutgoingSignalSchema, { signal: { case: "event", value: event } })],
      });
      await handle.complete({
        key: required(source.key),
        token: "plan-token",
        expectedRecordBytes: toBinary(AgentExecutionRecordSchema, claim.record),
        next: completed,
      });
      const signal = create(AgentSignalKeySchema, { id: { case: "event", value: eventId } });
      await expect(
        handle.markDelivered(
          required(source.key),
          "plan-token",
          toBinary(AgentExecutionRecordSchema, completed),
          [signal],
        ),
      ).rejects.toThrow(/plan/i);
      const prepared = clone(AgentExecutionRecordSchema, completed);
      required(required(prepared.completion).outgoing[0]).plan = create(
        AgentSavedDispatchPlanSchema,
      );
      await handle.update({
        key: required(source.key),
        token: "plan-token",
        expectedRecordBytes: toBinary(AgentExecutionRecordSchema, completed),
        next: prepared,
      });
      handle.close();
      factory.close();
      const reopened = DatastoreStorageFactory.newBuilder().setClient(client).build();
      const recovery = AgentExecutionStorageFactories.create(reopened, input);
      try {
        expect(
          required(await recovery.read(required(source.key))).completion?.outgoing[0]?.plan
            ?.targets,
        ).toEqual([]);
        await recovery.markDelivered(
          required(source.key),
          "plan-token",
          toBinary(AgentExecutionRecordSchema, prepared),
          [signal],
        );
      } finally {
        recovery.close();
        reopened.close();
      }
    } finally {
      handle.close();
      factory.close();
    }
  }, 120_000);

  it("rejects stale Entity Version without publishing completion or history", async () => {
    const client = new Datastore({ projectId: `spine-agent-version-${randomUUID()}` });
    const factory = DatastoreStorageFactory.newBuilder().setClient(client).build();
    const entity = providerEntityInput();
    const input = { entity, stateType: "spine.server.testing.SupportReplyAgentState" };
    const source = accepted(randomUUID(), `T-${randomUUID()}`);
    const current = factory.createEntityStorage(entity);
    const recipient = required(source.recipientId);
    const id = required(entity.id.unpack(recipient));
    await current.current.write(
      create(EntityRecordSchema, {
        entityId: recipient,
        state: create(AnySchema, {
          typeUrl: `type.spine.server.testing/${SupportReplyAgentStateSchema.typeName}`,
          value: toBinary(
            SupportReplyAgentStateSchema,
            create(SupportReplyAgentStateSchema, { id, proposedReply: "Existing" }),
          ),
        }),
        version: create(VersionSchema, { number: 1 }),
      }),
    );
    current.close();
    const storage = AgentExecutionStorageFactories.create(factory, input);
    const history = AgentHistoryStorageFactories.create(factory, {
      context: entity.context,
      stateType: input.stateType,
      id: { key: (value: string) => value },
    });
    try {
      await storage.admit(source);
      const claim = required(
        await storage.claim(
          required(source.key),
          "version",
          create(TimestampSchema, { seconds: 4_000_000_000n }),
        ),
      );
      expect(storage.capacity).toMatchObject({
        executionRecordBytes: 1_000_000,
        executionHeadBytes: 1_000_000,
        historyRecordBytes: 1_000_000,
        transactionPayloadBytes: 9 * 1024 * 1024,
      });
      const oversized = clone(
        AgentHistoryEntrySchema,
        conversation(randomUUID(), "capacity", create(TimestampSchema, { seconds: 101n })),
      );
      if (
        oversized.item.case !== "conversationRecord" ||
        oversized.item.value.content === undefined
      )
        throw new Error("Conversation fixture lacks typed content.");
      oversized.item.value.content.value = new Uint8Array(1_000_000);
      expect(
        AgentExecutionSizes.history(required(required(source.key).scope), oversized),
      ).toBeGreaterThan(required(storage.capacity.historyRecordBytes));
      await expect(
        storage.update({
          key: required(source.key),
          token: "version",
          expectedRecordBytes: toBinary(AgentExecutionRecordSchema, claim.record),
          next: clone(AgentExecutionRecordSchema, claim.record),
          historyEntries: [oversized],
        }),
      ).rejects.toThrow(/history record exceeds Datastore entity payload capacity/i);
      await expect(storage.read(required(source.key))).resolves.toEqual(claim.record);
      const next = clone(AgentExecutionRecordSchema, claim.record);
      next.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
      next.completion = create(AgentExecutionCompletionSchema, {
        initialVersion: create(VersionSchema, { number: 0 }),
        resultingVersion: create(VersionSchema, { number: 0 }),
      });
      await expect(
        storage.complete({
          key: required(source.key),
          token: "version",
          expectedRecordBytes: toBinary(AgentExecutionRecordSchema, claim.record),
          next,
          historyEntries: [
            conversation(randomUUID(), "stale", create(TimestampSchema, { seconds: 101n })),
          ],
        }),
      ).rejects.toThrow(/Version/i);
      expect(
        toBinary(AgentExecutionRecordSchema, required(await storage.read(required(source.key)))),
      ).toEqual(toBinary(AgentExecutionRecordSchema, claim.record));
      await expect(
        history.read({
          entityId: required(source.key?.scope).agentKey,
          view: { kind: "full" },
          count: 1,
          maxBytes: 100_000,
        }),
      ).resolves.toMatchObject({ entries: [] });
    } finally {
      history.close();
      storage.close();
      factory.close();
    }
  }, 120_000);

  it("keeps a fixed sweep cutoff and observes the original head key", async () => {
    let now = create(TimestampSchema, { seconds: 1_000n, nanos: 1 });
    const previous = Time.setProvider({ currentTime: () => now });
    const client = new Datastore({ projectId: `spine-agent-sweep-${randomUUID()}` });
    const factory = DatastoreStorageFactory.newBuilder().setClient(client).build();
    const storage = AgentExecutionStorageFactories.create(factory, {
      entity: providerEntityInput(),
      stateType: "spine.server.testing.SupportReplyAgentState",
    });
    try {
      const first = accepted(randomUUID(), `T-${randomUUID()}`);
      await storage.admit(first);
      await expect(storage.pending({ count: 1 })).resolves.toMatchObject({ records: [] });
      now = create(TimestampSchema, { seconds: 1_000n, nanos: 2 });
      const observed = await storage.pending({ count: 1 });
      expect(observed.records).toHaveLength(1);
      expect(observed.after?.key.scope.agentKey).toBe(first.key?.scope?.agentKey);
      const second = accepted(randomUUID(), `T-${randomUUID()}`);
      await storage.admit(second);
      now = create(TimestampSchema, { seconds: 1_000n, nanos: 3 });
      await expect(storage.pending({ count: 1, after: required(observed.after) })).resolves.toMatchObject({
        records: [],
      });
      const fresh = await storage.pending({ count: 2 });
      expect(fresh.records).toHaveLength(2);
    } finally {
      storage.close();
      factory.close();
      Time.setProvider(previous);
    }
  }, 120_000);

  it("discovers one head per instance and promotes the earliest successor atomically", async () => {
    const client = new Datastore({ projectId: `spine-agent-head-${randomUUID()}` });
    const factory = DatastoreStorageFactory.newBuilder().setClient(client).build();
    const input = {
      entity: providerEntityInput(),
      stateType: "spine.server.testing.SupportReplyAgentState",
    };
    const storage = AgentExecutionStorageFactories.create(factory, input);
    const ticket = `T-${randomUUID()}`;
    const first = accepted("00000000-0000-0000-0000-000000000001", ticket);
    const second = accepted("00000000-0000-0000-0000-000000000002", ticket);
    const other = accepted(randomUUID(), `T-${randomUUID()}`);
    try {
      await storage.admit(first);
      await storage.admit(second);
      await storage.admit(other);
      const page = await storage.pending({ count: 1 });
      expect(page.records).toHaveLength(1);
      expect(page.hasMore).toBe(true);
      const following = await storage.pending({ count: 1, after: required(page.after) });
      expect(following.records).toHaveLength(1);
      expect(following.records[0]?.accepted?.key?.scope?.agentKey).not.toBe(
        page.records[0]?.accepted?.key?.scope?.agentKey,
      );
      const expiry = create(TimestampSchema, { seconds: 4_000_000_000n });
      await expect(
        storage.claim(required(second.key), "out-of-order", expiry),
      ).resolves.toBeUndefined();
      const claim = required(await storage.claim(required(first.key), "first", expiry));
      await expect(storage.claim(required(second.key), "blocked", expiry)).resolves.toBeUndefined();
      const next = clone(AgentExecutionRecordSchema, claim.record);
      next.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
      next.completion = create(AgentExecutionCompletionSchema, {
        initialVersion: create(VersionSchema, { number: 0 }),
        resultingVersion: create(VersionSchema, { number: 0 }),
      });
      await storage.complete({
        key: required(first.key),
        token: "first",
        expectedRecordBytes: toBinary(AgentExecutionRecordSchema, claim.record),
        next,
      });
      await expect(storage.claim(required(second.key), "successor", expiry)).resolves.toMatchObject(
        { record: { claimToken: "successor" } },
      );
      const heads = await client.runQuery(client.createQuery("spine_agent_execution_head"));
      expect(heads[0]).toHaveLength(2);
      await exerciseAgentExecutionLifecycle(storage);
    } finally {
      storage.close();
      factory.close();
    }
  }, 120_000);

  it("retains accepted work and a no-op completion across factory reconstruction", async () => {
    const client = new Datastore({ projectId: `spine-agent-execution-${randomUUID()}` });
    const input = {
      entity: providerEntityInput(),
      stateType: "spine.server.testing.SupportReplyAgentState",
    };
    const source = accepted(randomUUID(), `T-${randomUUID()}`);
    const key = required(source.key);
    const first = DatastoreStorageFactory.newBuilder().setClient(client).build();
    const handle = AgentExecutionStorageFactories.create(first, input);
    const stored = await handle.admit(source);
    expect(toBinary(AgentExecutionRecordSchema, stored)).toEqual(
      toBinary(AgentExecutionRecordSchema, required(await handle.read(key))),
    );
    handle.close();
    first.close();
    const reopened = DatastoreStorageFactory.newBuilder().setClient(client).build();
    try {
      const after = AgentExecutionStorageFactories.create(reopened, input);
      await expect(after.admit(source)).resolves.toEqual(stored);
      await expect(after.pending({ count: 1 })).resolves.toMatchObject({
        records: [{ accepted: source }],
      });
      const claim = required(
        await after.claim(
          key,
          "datastore-token",
          create(TimestampSchema, { seconds: 4_000_000_000n }),
        ),
      );
      const next = clone(AgentExecutionRecordSchema, claim.record);
      next.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
      next.completion = create(AgentExecutionCompletionSchema, {
        initialVersion: create(VersionSchema, { number: 0 }),
        resultingVersion: create(VersionSchema, { number: 0 }),
      });
      await after.complete({
        key,
        token: "datastore-token",
        expectedRecordBytes: toBinary(AgentExecutionRecordSchema, claim.record),
        next,
      });
      await expect(after.pending({ count: 1 })).resolves.toMatchObject({ records: [] });
      after.close();
    } finally {
      reopened.close();
    }
  }, 120_000);
});
