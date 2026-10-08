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
import { EventIdSchema, EventSchema, VersionSchema } from "@spine-event-engine/proto";
import { AiModelKind, ModelPreferenceSchema } from "@spine-event-engine/proto/agent";
import {
  AgentExecutionCompletionSchema,
  AgentExecutionHeadSchema,
  AgentExecutionRecordSchema,
  AgentOutgoingSignalSchema,
  AgentSavedDispatchPlanSchema,
  AgentSignalKeySchema,
  AgentInvocationCountersSchema,
  AgentInvocationStatus,
  type AgentExecutionHead,
  type AgentExecutionRecord,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { describe, expect, it, vi } from "vitest";
import { AgentExecutionRecords } from "@spine-event-engine/storage/provider";

import { accepted } from "../../storage/test/entity/agent-execution-fixtures.js";
import { providerEntityInput } from "../../storage/test/entity/agent-execution-provider-fixtures.js";
import { MysqlAgentExecution } from "../src/mysql/agent-execution.js";
import { AgentHistoryHash } from "../src/mysql/agent-history.js";
// prettier-ignore
import {
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

describe("MySQL Agent execution provider boundary", () => {
  it("reads one indexed candidate with a fixed continuation and validates index readiness", async () => {
    const entity = { ...providerEntityInput(), stateHistory: true, eventHistory: true };
    const source = accepted("mysql-boundary-source");
    const key = required(source.key);
    const eligibleAt = create(TimestampSchema, { seconds: 100n });
    const asOf = create(TimestampSchema, { seconds: 110n });
    const before = accepted("mysql-before-cursor", "T-before");
    const beforeKey = required(before.key);
    const beforeHead = create(AgentExecutionHeadSchema, {
      scope: beforeKey.scope,
      pending: beforeKey,
      eligibleAt,
    });
    const head = create(AgentExecutionHeadSchema, {
      scope: key.scope,
      pending: key,
      eligibleAt,
    });
    const lateHead = clone(AgentExecutionHeadSchema, head);
    lateHead.eligibleAt = create(TimestampSchema, { seconds: 120n });
    const wrongTypeHead = clone(AgentExecutionHeadSchema, head);
    required(wrongTypeHead.scope).stateType = "spine.server.testing.OtherAgentState";
    const record = create(AgentExecutionRecordSchema, {
      accepted: source,
      status: AgentInvocationStatus.AGENT_INVOCATION_ACCEPTED,
    });
    const historyPage = vi.fn<(sql: string, values: unknown[]) => Promise<AgentExecutionHead[]>>(
      (sql, values) => {
        expect(sql).toBe(
          "SELECT `bytes` FROM `agent_heads` WHERE `state_digest`=? AND " +
            "BINARY `state_type`=BINARY ? AND `pending_key`<? AND `pending_key`>? " +
            "ORDER BY `pending_key` ASC LIMIT ?",
        );
        expect(values).toEqual([
          AgentHistoryHash.value(required(key.scope).stateType),
          required(key.scope).stateType,
          AgentExecutionRecords.pendingLower(asOf),
          AgentExecutionRecords.pendingKey(eligibleAt, required(beforeKey.scope)),
          2,
        ]);
        return Promise.resolve(
          [beforeHead, head, lateHead, wrongTypeHead]
            .filter((candidate) => candidate.scope?.stateType === values[1])
            .filter((candidate) => {
              const index = AgentExecutionRecords.pendingKey(
                required(candidate.eligibleAt),
                required(candidate.scope),
              );
              return index < String(values[2]) && index > String(values[3]);
            })
            .sort((left, right) =>
              Buffer.compare(
                Buffer.from(
                  AgentExecutionRecords.pendingKey(required(left.eligibleAt), required(left.scope)),
                ),
                Buffer.from(
                  AgentExecutionRecords.pendingKey(
                    required(right.eligibleAt),
                    required(right.scope),
                  ),
                ),
              ),
            )
            .slice(0, Number(values[4])),
        );
      },
    );
    const prepare = vi.fn(() => Promise.resolve());
    const ensureHistoryIndex = vi.fn(() => Promise.resolve());
    const close = vi.fn();
    const withConnection = <T>(_connection: unknown, work: () => Promise<T>) => work();
    const invocationWrite = vi.fn(() => Promise.resolve());
    const headWrites: AgentExecutionHead[] = [];
    const headWrite = vi.fn((value: AgentExecutionHead) => {
      headWrites.push(clone(AgentExecutionHeadSchema, value));
      return Promise.resolve();
    });
    const writeImmutable = vi.fn(() => Promise.resolve());
    const appendStateImmutable = vi.fn(() => Promise.resolve());
    const appendDiagnosticImmutable = vi.fn(() => Promise.resolve());
    const writeCurrent = vi.fn(() => Promise.resolve());
    const writeEvent = vi.fn(() => Promise.resolve());
    const row = { prepare, ensureHistoryIndex, close, withConnection };
    const rows = {
      invocation: {
        ...row,
        tableName: "agent_invocations",
        read: vi.fn((): Promise<AgentExecutionRecord | undefined> => Promise.resolve(record)),
        readLocked: vi.fn((): Promise<AgentExecutionRecord | undefined> =>
          Promise.resolve(undefined),
        ),
        historyPage: vi.fn<(sql: string, values: unknown[]) => Promise<AgentExecutionRecord[]>>(
          () => Promise.resolve([]),
        ),
        write: invocationWrite,
        writeImmutable,
      },
      head: {
        ...row,
        tableName: "agent_heads",
        historyPage,
        readLocked: vi.fn((): Promise<AgentExecutionHead | undefined> =>
          Promise.resolve(undefined),
        ),
        write: headWrite,
      },
      history: { ...row, tableName: "agent_history" },
      entity: {
        ...row,
        tableNames: () => ["agent_current"],
        readCurrentLocked: vi.fn((): Promise<EntityRecord | undefined> =>
          Promise.resolve(undefined),
        ),
        commitCapability: () => ({ appendStateImmutable, appendDiagnosticImmutable }),
        current: { write: writeCurrent },
      },
      events: { ...row, tableName: "agent_events", writeImmutable: writeEvent },
    };
    const commit = vi.fn(
      <T>(
        _tables: readonly string[],
        _lock: string,
        work: (connection: object) => Promise<T>,
        _options: object,
      ) => {
        void _options;
        return work({});
      },
    );
    const storage = new MysqlAgentExecution(
      { entity, stateType: required(key.scope).stateType },
      rows as never,
      { commit } as never,
      "test_database",
    );
    try {
      const page = await storage.pending({
        count: 1,
        after: { asOf, key: { scope: required(beforeKey.scope), eligibleAt } },
      });
      expect(page.records).toEqual([record]);
      expect(page.after?.asOf).toEqual(asOf);
      expect(page.hasMore).toBe(false);
      expect(ensureHistoryIndex).toHaveBeenCalledWith("agent_execution_pending", [
        "state_digest",
        "pending_key",
      ]);
      expect(ensureHistoryIndex).toHaveBeenCalledWith("agent_execution_instance", [
        "scope_digest",
        "status",
        "order_key",
      ]);
      expect(page.after?.key.scope).toEqual(key.scope);
      await expect(storage.pending({ count: 128 })).rejects.toThrow(/count/i);
      expect(historyPage).toHaveBeenCalledTimes(1);
      const additional = accepted("mysql-admission-source");
      const admitted = await storage.admit(additional);
      expect(admitted.accepted).toEqual(additional);
      expect(writeImmutable).toHaveBeenCalledWith(
        expect.objectContaining({ accepted: additional }),
      );
      expect(headWrites.at(-1)?.pending).toEqual(additional.key);
      expect(commit).toHaveBeenCalledWith(
        expect.arrayContaining(["agent_invocations", "agent_heads", "agent_current"]),
        expect.any(String),
        expect.any(Function),
        { requireTransaction: true },
      );
      rows.invocation.readLocked.mockImplementation(() => Promise.resolve(admitted));
      rows.invocation.read.mockImplementation(() => Promise.resolve(admitted));
      const detached = required(await storage.read(required(additional.key)));
      detached.status = AgentInvocationStatus.AGENT_INVOCATION_TERMINATED;
      expect((await storage.read(required(additional.key)))?.status).toBe(
        AgentInvocationStatus.AGENT_INVOCATION_ACCEPTED,
      );
      const changed = accepted("mysql-admission-source");
      required(changed.handlers[0]).methodName = "different-handler";
      await expect(storage.admit(changed)).rejects.toThrow(/immutable/i);
      expect(writeImmutable).toHaveBeenCalledTimes(1);
      expect(await storage.admit(additional)).toEqual(admitted);
      const admittedHead = create(AgentExecutionHeadSchema, {
        scope: required(additional.key).scope,
        pending: additional.key,
        eligibleAt,
      });
      rows.head.readLocked.mockImplementation(() => Promise.resolve(admittedHead));
      rows.invocation.historyPage.mockImplementation((_sql, values: unknown[]) =>
        Promise.resolve(values[3] === "1" ? [admitted] : []),
      );
      const expiry = create(TimestampSchema, { seconds: 4_000_000_000n });
      await expect(storage.claim(required(additional.key), "", expiry)).rejects.toThrow(
        /future expiry and token/i,
      );
      await expect(
        storage.claim(
          required(additional.key),
          "stale-token",
          create(TimestampSchema, { seconds: 1n }),
        ),
      ).rejects.toThrow(/future expiry and token/i);
      const claimed = await storage.claim(required(additional.key), "mysql-boundary-token", expiry);
      expect(claimed?.record).toMatchObject({
        claimToken: "mysql-boundary-token",
        status: AgentInvocationStatus.AGENT_INVOCATION_ACTIVE,
      });
      expect(invocationWrite).toHaveBeenCalledWith(
        expect.objectContaining({ claimToken: "mysql-boundary-token" }),
      );
      rows.invocation.readLocked.mockImplementation(() =>
        Promise.resolve(required(claimed).record),
      );
      rows.head.readLocked.mockImplementation(() => Promise.resolve(required(headWrites.at(-1))));
      const writesBeforeRenew = invocationWrite.mock.calls.length;
      expect(
        await storage.renew(
          required(additional.key),
          "wrong-token",
          create(TimestampSchema, { seconds: 4_000_000_001n }),
        ),
      ).toBe(false);
      expect(await storage.renew(required(additional.key), "mysql-boundary-token", expiry)).toBe(
        false,
      );
      expect(invocationWrite).toHaveBeenCalledTimes(writesBeforeRenew);
      await expect(
        storage.markDelivered(
          required(additional.key),
          "mysql-boundary-token",
          toBinary(AgentExecutionRecordSchema, required(claimed).record),
          [],
        ),
      ).rejects.toThrow(/no completed output/i);
      expect(invocationWrite).toHaveBeenCalledTimes(writesBeforeRenew);
      const next = clone(AgentExecutionRecordSchema, required(claimed).record);
      next.counters = create(AgentInvocationCountersSchema, { operations: 1n });
      const writesBeforeReject = invocationWrite.mock.calls.length;
      await expect(
        storage.update({
          key: required(additional.key),
          token: "mysql-boundary-token",
          expectedRecordBytes: new Uint8Array(),
          next,
        }),
      ).rejects.toThrow(/expected record|current/i);
      expect(invocationWrite).toHaveBeenCalledTimes(writesBeforeReject);
      await storage.update({
        key: required(additional.key),
        token: "mysql-boundary-token",
        expectedRecordBytes: toBinary(AgentExecutionRecordSchema, required(claimed).record),
        next,
      });
      expect(invocationWrite).toHaveBeenCalledWith(next);
      rows.invocation.readLocked.mockImplementation(() => Promise.resolve(next));
      const completed = clone(AgentExecutionRecordSchema, next);
      completed.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
      completed.completion = create(AgentExecutionCompletionSchema, {
        initialVersion: create(VersionSchema, { number: 0 }),
        resultingVersion: create(VersionSchema, { number: 0 }),
        preferences: [
          create(ModelPreferenceSchema, {
            kind: AiModelKind.GENERATION,
            selection: { case: "inheritRepositoryDefault", value: create(EmptySchema) },
          }),
        ],
      });
      const completionWrites = invocationWrite.mock.calls.length;
      const missingCompletion = clone(AgentExecutionRecordSchema, completed);
      missingCompletion.completion = undefined;
      const changedVersion = clone(AgentExecutionRecordSchema, completed);
      required(changedVersion.completion).resultingVersion = create(VersionSchema, { number: 1 });
      const invalidStatus = clone(AgentExecutionRecordSchema, completed);
      invalidStatus.status = AgentInvocationStatus.AGENT_INVOCATION_ACTIVE;
      for (const [candidate, message] of [
        [missingCompletion, /both Versions/i],
        [changedVersion, /exactly one Version or a no-op/i],
        [invalidStatus, /completed status/i],
      ] as const) {
        await expect(
          storage.complete({
            key: required(additional.key),
            token: "mysql-boundary-token",
            expectedRecordBytes: toBinary(AgentExecutionRecordSchema, next),
            next: candidate,
          }),
        ).rejects.toThrow(message);
      }
      expect(invocationWrite).toHaveBeenCalledTimes(completionWrites);
      await storage.complete({
        key: required(additional.key),
        token: "mysql-boundary-token",
        expectedRecordBytes: toBinary(AgentExecutionRecordSchema, next),
        next: completed,
      });
      expect(invocationWrite).toHaveBeenCalledWith(completed);
      expect(headWrites.at(-1)?.pending).toBeUndefined();
      expect(headWrites.at(-1)?.preferences[0]?.kind).toBe(AiModelKind.GENERATION);
      const writesAfterCompletion = invocationWrite.mock.calls.length;
      rows.head.readLocked.mockImplementation(() => Promise.resolve(undefined));
      rows.invocation.readLocked.mockImplementation(() => Promise.resolve(admitted));
      expect(await storage.claim(required(additional.key), "missing-head", expiry)).toBeUndefined();
      rows.head.readLocked.mockImplementation(() => Promise.resolve(admittedHead));
      rows.invocation.readLocked.mockImplementation(() => Promise.resolve(undefined));
      expect(
        await storage.claim(required(additional.key), "missing-source", expiry),
      ).toBeUndefined();
      rows.invocation.readLocked.mockImplementation(() => Promise.resolve(completed));
      expect(await storage.claim(required(additional.key), "resolved", expiry)).toBeUndefined();
      rows.invocation.readLocked.mockImplementation(() => Promise.resolve(admitted));
      const leasedHead = clone(AgentExecutionHeadSchema, admittedHead);
      leasedHead.active = additional.key;
      leasedHead.claimExpiresAt = expiry;
      rows.head.readLocked.mockImplementation(() => Promise.resolve(leasedHead));
      expect(await storage.claim(required(additional.key), "leased", expiry)).toBeUndefined();
      const wrongHead = clone(AgentExecutionHeadSchema, admittedHead);
      required(wrongHead.scope).agentKey = "another-agent";
      rows.head.readLocked.mockImplementation(() => Promise.resolve(wrongHead));
      await expect(storage.claim(required(additional.key), "wrong-head", expiry)).rejects.toThrow(
        /physical ID|scope/i,
      );
      rows.head.readLocked.mockImplementation(() => Promise.resolve(admittedHead));
      const wrongRecord = clone(AgentExecutionRecordSchema, admitted);
      required(required(wrongRecord.accepted).key?.sourceSignal).id = required(key.sourceSignal).id;
      rows.invocation.readLocked.mockImplementation(() => Promise.resolve(wrongRecord));
      await expect(storage.claim(required(additional.key), "wrong-source", expiry)).rejects.toThrow(
        /physical ID|invocation/i,
      );
      expect(invocationWrite).toHaveBeenCalledTimes(writesAfterCompletion);
      const wrongStateHead = clone(AgentExecutionHeadSchema, admittedHead);
      required(wrongStateHead.scope).stateType = "spine.server.testing.AnotherAgentState";
      for (const corruptHead of [
        create(AgentExecutionHeadSchema, { scope: admittedHead.scope, eligibleAt }),
        wrongStateHead,
      ]) {
        historyPage.mockImplementation(() => Promise.resolve([corruptHead]));
        await expect(storage.pending({ count: 1 })).rejects.toThrow(
          /scope or candidate is invalid/i,
        );
      }
      expect(invocationWrite).toHaveBeenCalledTimes(writesAfterCompletion);
      const entitySource = accepted("mysql-entity-source", "T-entity");
      const entityKey = required(entitySource.key);
      const entityId = required(entity.id.unpack(required(entitySource.recipientId)));
      const active = create(AgentExecutionRecordSchema, {
        accepted: entitySource,
        status: AgentInvocationStatus.AGENT_INVOCATION_ACTIVE,
        claimToken: "entity-token",
        claimExpiresAt: expiry,
      });
      const activeHead = create(AgentExecutionHeadSchema, {
        scope: entityKey.scope,
        pending: entityKey,
        active: entityKey,
        claimToken: "entity-token",
        claimExpiresAt: expiry,
      });
      rows.invocation.readLocked.mockImplementation(() => Promise.resolve(active));
      rows.head.readLocked.mockImplementation(() => Promise.resolve(activeHead));
      rows.invocation.historyPage.mockImplementation(() => Promise.resolve([]));
      const finished = clone(AgentExecutionRecordSchema, active);
      finished.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
      finished.completion = create(AgentExecutionCompletionSchema, {
        initialVersion: create(VersionSchema, { number: 0 }),
        resultingVersion: create(VersionSchema, { number: 1 }),
      });
      const current = create(EntityRecordSchema, {
        entityId: entitySource.recipientId,
        state: create(AnySchema, {
          typeUrl: `type.spine.server.testing/${SupportReplyAgentStateSchema.typeName}`,
          value: toBinary(
            SupportReplyAgentStateSchema,
            create(SupportReplyAgentStateSchema, { id: entityId, proposedReply: "A reply" }),
          ),
        }),
        version: create(VersionSchema, {
          number: 1,
          timestamp: create(TimestampSchema, { seconds: 101n }),
        }),
      });
      const diagnostic = create(EventSchema, {
        id: create(EventIdSchema, { value: "mysql-diagnostic" }),
        context: {
          producerId: entitySource.recipientId,
          version: create(VersionSchema, { number: 1 }),
          timestamp: create(TimestampSchema, { seconds: 101n }),
        },
      });
      const event = create(EventSchema, {
        id: create(EventIdSchema, { value: "mysql-domain-event" }),
        message: create(AnySchema, {
          typeUrl: `type.spine.server.testing/${SupportReplyDraftedSchema.typeName}`,
          value: toBinary(
            SupportReplyDraftedSchema,
            create(SupportReplyDraftedSchema, { agent: entityId, reply: "A reply" }),
          ),
        }),
      });
      const entityCommit = {
        context: entity.context,
        entity,
        entityId,
        next: current,
        states: [current],
        diagnostics: [diagnostic],
        events: [event],
      };
      const expectedRecordBytes = toBinary(AgentExecutionRecordSchema, active);
      const beforeEntityWrites = invocationWrite.mock.calls.length;
      rows.entity.readCurrentLocked.mockImplementation(() =>
        Promise.resolve(
          create(EntityRecordSchema, { version: create(VersionSchema, { number: 2 }) }),
        ),
      );
      await expect(
        storage.complete({
          key: entityKey,
          token: "entity-token",
          expectedRecordBytes,
          next: finished,
          entityCommit,
        }),
      ).rejects.toThrow(/Version/i);
      rows.entity.readCurrentLocked.mockImplementation(() => Promise.resolve(undefined));
      const wrongId = entity.id.clone(entityId);
      wrongId.ticketNumber = "T-other";
      await expect(
        storage.complete({
          key: entityKey,
          token: "entity-token",
          expectedRecordBytes,
          next: finished,
          entityCommit: { ...entityCommit, entityId: wrongId },
        }),
      ).rejects.toThrow(/scope differs/i);
      expect(invocationWrite).toHaveBeenCalledTimes(beforeEntityWrites);
      expect(writeCurrent).not.toHaveBeenCalled();
      await storage.complete({
        key: entityKey,
        token: "entity-token",
        expectedRecordBytes,
        next: finished,
        entityCommit,
      });
      expect(appendStateImmutable).toHaveBeenCalledWith(current);
      expect(appendDiagnosticImmutable).toHaveBeenCalledWith(diagnostic);
      expect(writeEvent).toHaveBeenCalledWith(event);
      expect(writeCurrent).toHaveBeenCalledWith(current);
      expect(invocationWrite).toHaveBeenCalledWith(finished);
      expect(commit).toHaveBeenLastCalledWith(
        expect.arrayContaining(["agent_invocations", "agent_current", "agent_events"]),
        expect.any(String),
        expect.any(Function),
        { requireTransaction: true },
      );
      rows.head.readLocked.mockImplementation(() =>
        Promise.resolve(
          create(AgentExecutionHeadSchema, {
            scope: entityKey.scope,
            pending: entityKey,
            active: entityKey,
            claimToken: "entity-token",
            claimExpiresAt: expiry,
          }),
        ),
      );
      const disabled = new MysqlAgentExecution(
        { entity: providerEntityInput(), stateType: required(entityKey.scope).stateType },
        rows as never,
        { commit } as never,
        "test_database",
      );
      try {
        const beforeDisabled = invocationWrite.mock.calls.length;
        await expect(
          disabled.complete({
            key: entityKey,
            token: "entity-token",
            expectedRecordBytes,
            next: finished,
            entityCommit: { ...entityCommit, states: [current], diagnostics: [] },
          }),
        ).rejects.toThrow(/state history is disabled/i);
        await expect(
          disabled.complete({
            key: entityKey,
            token: "entity-token",
            expectedRecordBytes,
            next: finished,
            entityCommit: { ...entityCommit, states: [], diagnostics: [diagnostic] },
          }),
        ).rejects.toThrow(/diagnostic history is disabled/i);
        expect(invocationWrite).toHaveBeenCalledTimes(beforeDisabled);
      } finally {
        disabled.close();
      }
      historyPage.mockImplementation(() => Promise.resolve([admittedHead]));
      rows.invocation.read.mockImplementation(() => Promise.resolve(undefined));
      expect(await storage.pending({ count: 1 })).toMatchObject({
        records: [],
        after: { key: { scope: admittedHead.scope } },
      });
      const headWithoutEligibility = clone(AgentExecutionHeadSchema, admittedHead);
      headWithoutEligibility.eligibleAt = undefined;
      historyPage.mockImplementation(() => Promise.resolve([headWithoutEligibility]));
      rows.invocation.read.mockImplementation(() => Promise.resolve(admitted));
      expect(await storage.pending({ count: 1 })).toMatchObject({
        records: [admitted],
        hasMore: false,
      });
      expect((await storage.pending({ count: 1 })).after).toBeUndefined();
      rows.head.readLocked.mockImplementation(() => Promise.resolve(undefined));
      rows.invocation.readLocked.mockImplementation(() => Promise.resolve(undefined));
      const writesBeforeCapacity = writeImmutable.mock.calls.length;
      await expect(storage.admit(accepted("x".repeat(1_500), "T-index-order"))).rejects.toThrow(
        /complete MySQL index capacity/i,
      );
      await expect(storage.admit(accepted("short-id", `T-${"x".repeat(1_500)}`))).rejects.toThrow(
        /head key exceeds complete MySQL index capacity/i,
      );
      const oversizedCommand = accepted("mysql-large-payload", "T-large-payload");
      if (oversizedCommand.signal.case !== "command")
        throw new Error("Expected typed Command fixture.");
      const commandMessage = required(oversizedCommand.signal.value.message);
      commandMessage.value = toBinary(
        DraftSupportReplySchema,
        create(DraftSupportReplySchema, {
          agent: required(entity.id.unpack(required(oversizedCommand.recipientId))),
          question: "q".repeat(70_000),
        }),
      );
      await expect(storage.admit(oversizedCommand)).rejects.toThrow(/MySQL BLOB capacity/i);
      expect(writeImmutable).toHaveBeenCalledTimes(writesBeforeCapacity);
      const deliverSource = accepted("mysql-delivery-source", "T-delivery");
      const deliverKey = required(deliverSource.key);
      const firstEvent = create(EventSchema, {
        id: create(EventIdSchema, { value: "mysql-output-one" }),
        message: event.message,
      });
      const secondEvent = create(EventSchema, {
        id: create(EventIdSchema, { value: "mysql-output-two" }),
        message: event.message,
      });
      const delivered = create(AgentExecutionRecordSchema, {
        accepted: deliverSource,
        status: AgentInvocationStatus.AGENT_INVOCATION_COMPLETED_PENDING_DELIVERY,
        claimToken: "delivery-token",
        claimExpiresAt: expiry,
        completion: create(AgentExecutionCompletionSchema, {
          initialVersion: create(VersionSchema, { number: 0 }),
          resultingVersion: create(VersionSchema, { number: 0 }),
          outgoing: [firstEvent, secondEvent].map((signal) =>
            create(AgentOutgoingSignalSchema, {
              signal: { case: "event", value: signal },
              plan: create(AgentSavedDispatchPlanSchema),
            }),
          ),
        }),
      });
      const deliverHead = create(AgentExecutionHeadSchema, {
        scope: deliverKey.scope,
        active: deliverKey,
        claimToken: "delivery-token",
        claimExpiresAt: expiry,
      });
      let persistedDelivery = clone(AgentExecutionRecordSchema, delivered);
      rows.invocation.readLocked.mockImplementation(() =>
        Promise.resolve(clone(AgentExecutionRecordSchema, persistedDelivery)),
      );
      invocationWrite.mockImplementation((...args: unknown[]) => {
        persistedDelivery = clone(AgentExecutionRecordSchema, args[0] as AgentExecutionRecord);
        return Promise.resolve();
      });
      rows.head.readLocked.mockImplementation(() => Promise.resolve(deliverHead));
      rows.invocation.historyPage.mockImplementation(() => Promise.resolve([]));
      const firstSignal = create(AgentSignalKeySchema, {
        id: { case: "event", value: required(firstEvent.id) },
      });
      const secondSignal = create(AgentSignalKeySchema, {
        id: { case: "event", value: required(secondEvent.id) },
      });
      const beforeDeliveryBytes = toBinary(AgentExecutionRecordSchema, persistedDelivery);
      await storage.markDelivered(deliverKey, "delivery-token", beforeDeliveryBytes, [firstSignal]);
      expect(persistedDelivery.status).toBe(
        AgentInvocationStatus.AGENT_INVOCATION_COMPLETED_PENDING_DELIVERY,
      );
      expect(persistedDelivery.completion?.outgoing.map((item) => item.delivered)).toEqual([
        true,
        false,
      ]);
      expect(
        persistedDelivery.completion?.outgoing.map((item) =>
          item.signal.case === "event" ? item.signal.value.id?.value : undefined,
        ),
      ).toEqual([required(firstEvent.id).value, required(secondEvent.id).value]);
      const firstStoredBytes = toBinary(AgentExecutionRecordSchema, persistedDelivery);
      await expect(
        storage.markDelivered(deliverKey, "delivery-token", beforeDeliveryBytes, [secondSignal]),
      ).rejects.toThrow(/expected record|current/i);
      expect(toBinary(AgentExecutionRecordSchema, persistedDelivery)).toEqual(firstStoredBytes);
      await storage.markDelivered(deliverKey, "delivery-token", firstStoredBytes, [secondSignal]);
      expect(persistedDelivery.status).toBe(AgentInvocationStatus.AGENT_INVOCATION_COMPLETED);
      expect(persistedDelivery.completion?.outgoing.map((item) => item.delivered)).toEqual([
        true,
        true,
      ]);
      expect(delivered.completion?.outgoing.map((item) => item.delivered)).toEqual([false, false]);
    } finally {
      storage.close();
    }
    await expect(storage.read(required(key))).rejects.toThrow(/closed/i);
  });
});
