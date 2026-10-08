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
import { PostgresAgentExecution } from "../src/postgres/agent-execution.js";
import { AgentHistoryHash } from "../src/postgres/agent-history.js";
// prettier-ignore
import {
  SupportReplyAgentStateSchema,
} from "../../server/test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
// prettier-ignore
import {
  SupportReplyDraftedSchema,
} from "../../server/test-fixtures/generated/entity-metadata/support_agent_events_pb.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Required Agent execution test value is missing.");
  return value;
}

describe("PostgreSQL Agent execution provider boundary", () => {
  it("reads one binary ordered candidate through the required native indexes", async () => {
    const entity = { ...providerEntityInput(), stateHistory: true, eventHistory: true };
    const source = accepted("postgres-boundary-source");
    const key = required(source.key);
    const eligibleAt = create(TimestampSchema, { seconds: 100n });
    const asOf = create(TimestampSchema, { seconds: 110n });
    const before = accepted("postgres-before-cursor", "T-before");
    const beforeKey = required(before.key);
    const beforeHead = create(AgentExecutionHeadSchema, {
      scope: beforeKey.scope,
      pending: beforeKey,
      eligibleAt,
    });
    const head = create(AgentExecutionHeadSchema, { scope: key.scope, pending: key, eligibleAt });
    const lateHead = clone(AgentExecutionHeadSchema, head);
    lateHead.eligibleAt = create(TimestampSchema, { seconds: 120n });
    const wrongTypeHead = clone(AgentExecutionHeadSchema, head);
    required(wrongTypeHead.scope).stateType = "spine.server.testing.OtherAgentState";
    const record = create(AgentExecutionRecordSchema, {
      accepted: source,
      status: AgentInvocationStatus.AGENT_INVOCATION_ACCEPTED,
    });
    const client = {
      query: vi.fn((_sql: string, values?: unknown[]) => {
        if (values?.[1] === "agent_execution_pending")
          return Promise.resolve({
            rows: [
              {
                definition:
                  'CREATE INDEX agent_execution_pending USING btree (state_digest, pending_key COLLATE "C")',
                indisvalid: true,
                indisready: true,
              },
            ],
          });
        if (values?.[1] === "agent_execution_instance")
          return Promise.resolve({
            rows: [
              {
                definition:
                  'CREATE INDEX agent_execution_instance USING btree (scope_digest, status, order_key COLLATE "C")',
                indisvalid: true,
                indisready: true,
              },
            ],
          });
        return Promise.resolve({ rows: [] });
      }),
    };
    const query = vi.fn<
      (
        native: typeof client,
        sql: string,
        values: unknown[],
      ) => Promise<(AgentExecutionHead | AgentExecutionRecord)[]>
    >((_native, sql, values) => {
      expect(sql).toBe(
        'SELECT "bytes" FROM "agent_heads" WHERE "state_digest" = $1 AND "state_type" = $2 ' +
          'AND "pending_key" COLLATE "C" < $3 AND "pending_key" COLLATE "C" > $4 ' +
          'ORDER BY "pending_key" COLLATE "C" LIMIT $5',
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
                AgentExecutionRecords.pendingKey(required(right.eligibleAt), required(right.scope)),
              ),
            ),
          )
          .slice(0, Number(values[4])),
      );
    });
    const close = vi.fn();
    let readAdmitted = false;
    const invocationWrite = vi.fn(() => Promise.resolve());
    const headWrites: AgentExecutionHead[] = [];
    const headWrite = vi.fn((_native: typeof client, value: AgentExecutionHead) => {
      headWrites.push(clone(AgentExecutionHeadSchema, value));
      return Promise.resolve();
    });
    const appendImmutable = vi.fn(() => Promise.resolve());
    const executor = (
      tableName: string,
      write: typeof invocationWrite | typeof headWrite = vi.fn(() => Promise.resolve()),
    ) => ({
      prepare: vi.fn(() => Promise.resolve()),
      using: async <T>(work: (native: typeof client) => Promise<T>) => work(client),
      transaction: async <T>(work: (native: typeof client) => Promise<T>) => work(client),
      table: () => `"${tableName}"`,
      query,
      read: vi.fn((): Promise<AgentExecutionRecord | AgentExecutionHead | undefined> =>
        Promise.resolve(readAdmitted ? undefined : record),
      ),
      lock: vi.fn(() => 17),
      write,
      appendImmutable,
    });
    const invocation = executor("agent_invocations", invocationWrite);
    const headRow = executor("agent_heads", headWrite);
    const currentRow = {
      ...executor("agent_current"),
      read: vi.fn((): Promise<EntityRecord | undefined> => Promise.resolve(undefined)),
    };
    headRow.read.mockImplementation(() => Promise.resolve(undefined));
    const applyConditional = vi.fn(() => Promise.resolve());
    const closePrepared = vi.fn();
    const closeCoordinator = vi.fn();
    const prepareConditional = vi.fn(() =>
      Promise.resolve({ apply: applyConditional, close: closePrepared }),
    );
    const commits = vi.fn(() => ({ prepareConditional, close: closeCoordinator }));
    const storage = new PostgresAgentExecution(
      { entity, stateType: required(key.scope).stateType },
      { historyExecutor: () => invocation, close } as never,
      { historyExecutor: () => headRow, close } as never,
      { historyExecutor: () => executor("agent_history"), close } as never,
      { historyExecutor: () => currentRow, close } as never,
      commits as never,
    );
    try {
      const page = await storage.pending({
        count: 1,
        after: { asOf, key: { scope: required(beforeKey.scope), eligibleAt } },
      });
      expect(page.records).toEqual([record]);
      expect(page.after?.asOf).toEqual(asOf);
      expect(page.hasMore).toBe(false);
      expect(page.after?.key.scope).toEqual(key.scope);
      await expect(storage.pending({ count: 128 })).rejects.toThrow(/count/i);
      expect(query).toHaveBeenCalledTimes(1);
      readAdmitted = true;
      const additional = accepted("postgres-admission-source");
      const admitted = await storage.admit(additional);
      expect(admitted.accepted).toEqual(additional);
      expect(appendImmutable).toHaveBeenCalledWith(
        client,
        expect.objectContaining({ accepted: additional }),
      );
      expect(headWrites.at(-1)?.pending).toEqual(additional.key);
      expect(client.query).toHaveBeenCalledWith("SELECT pg_advisory_xact_lock($1)", [17]);
      invocation.read.mockImplementation(() => Promise.resolve(admitted));
      const detached = required(await storage.read(required(additional.key)));
      detached.status = AgentInvocationStatus.AGENT_INVOCATION_TERMINATED;
      expect((await storage.read(required(additional.key)))?.status).toBe(
        AgentInvocationStatus.AGENT_INVOCATION_ACCEPTED,
      );
      const changed = accepted("postgres-admission-source");
      required(changed.handlers[0]).methodName = "different-handler";
      await expect(storage.admit(changed)).rejects.toThrow(/immutable/i);
      expect(appendImmutable).toHaveBeenCalledTimes(1);
      expect(await storage.admit(additional)).toEqual(admitted);
      const admittedHead = create(AgentExecutionHeadSchema, {
        scope: required(additional.key).scope,
        pending: additional.key,
        eligibleAt,
      });
      headRow.read.mockImplementation(() => Promise.resolve(admittedHead));
      query.mockImplementation((_client, _sql, values: unknown[]) =>
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
      const claimed = await storage.claim(
        required(additional.key),
        "postgres-boundary-token",
        expiry,
      );
      expect(claimed?.record).toMatchObject({
        claimToken: "postgres-boundary-token",
        status: AgentInvocationStatus.AGENT_INVOCATION_ACTIVE,
      });
      expect(invocationWrite).toHaveBeenCalledWith(
        client,
        expect.objectContaining({ claimToken: "postgres-boundary-token" }),
      );
      invocation.read.mockImplementation(() => Promise.resolve(required(claimed).record));
      headRow.read.mockImplementation(() => Promise.resolve(required(headWrites.at(-1))));
      const writesBeforeRenew = invocationWrite.mock.calls.length;
      expect(
        await storage.renew(
          required(additional.key),
          "wrong-token",
          create(TimestampSchema, { seconds: 4_000_000_001n }),
        ),
      ).toBe(false);
      expect(await storage.renew(required(additional.key), "postgres-boundary-token", expiry)).toBe(
        false,
      );
      expect(invocationWrite).toHaveBeenCalledTimes(writesBeforeRenew);
      await expect(
        storage.markDelivered(
          required(additional.key),
          "postgres-boundary-token",
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
          token: "postgres-boundary-token",
          expectedRecordBytes: new Uint8Array(),
          next,
        }),
      ).rejects.toThrow(/expected record|current/i);
      expect(invocationWrite).toHaveBeenCalledTimes(writesBeforeReject);
      await storage.update({
        key: required(additional.key),
        token: "postgres-boundary-token",
        expectedRecordBytes: toBinary(AgentExecutionRecordSchema, required(claimed).record),
        next,
      });
      expect(invocationWrite).toHaveBeenCalledWith(client, next);
      invocation.read.mockImplementation(() => Promise.resolve(next));
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
            token: "postgres-boundary-token",
            expectedRecordBytes: toBinary(AgentExecutionRecordSchema, next),
            next: candidate,
          }),
        ).rejects.toThrow(message);
      }
      expect(invocationWrite).toHaveBeenCalledTimes(completionWrites);
      await storage.complete({
        key: required(additional.key),
        token: "postgres-boundary-token",
        expectedRecordBytes: toBinary(AgentExecutionRecordSchema, next),
        next: completed,
      });
      expect(invocationWrite).toHaveBeenCalledWith(client, completed);
      expect(headWrites.at(-1)?.pending).toBeUndefined();
      expect(headWrites.at(-1)?.preferences[0]?.kind).toBe(AiModelKind.GENERATION);
      const writesAfterCompletion = invocationWrite.mock.calls.length;
      headRow.read.mockImplementation(() => Promise.resolve(undefined));
      invocation.read.mockImplementation(() => Promise.resolve(admitted));
      expect(await storage.claim(required(additional.key), "missing-head", expiry)).toBeUndefined();
      headRow.read.mockImplementation(() => Promise.resolve(admittedHead));
      invocation.read.mockImplementation(() => Promise.resolve(undefined));
      expect(
        await storage.claim(required(additional.key), "missing-source", expiry),
      ).toBeUndefined();
      invocation.read.mockImplementation(() => Promise.resolve(completed));
      expect(await storage.claim(required(additional.key), "resolved", expiry)).toBeUndefined();
      invocation.read.mockImplementation(() => Promise.resolve(admitted));
      const leasedHead = clone(AgentExecutionHeadSchema, admittedHead);
      leasedHead.active = additional.key;
      leasedHead.claimExpiresAt = expiry;
      headRow.read.mockImplementation(() => Promise.resolve(leasedHead));
      expect(await storage.claim(required(additional.key), "leased", expiry)).toBeUndefined();
      const wrongHead = clone(AgentExecutionHeadSchema, admittedHead);
      required(wrongHead.scope).agentKey = "another-agent";
      headRow.read.mockImplementation(() => Promise.resolve(wrongHead));
      await expect(storage.claim(required(additional.key), "wrong-head", expiry)).rejects.toThrow(
        /physical ID|scope/i,
      );
      headRow.read.mockImplementation(() => Promise.resolve(admittedHead));
      const wrongRecord = clone(AgentExecutionRecordSchema, admitted);
      required(required(wrongRecord.accepted).key?.sourceSignal).id = required(key.sourceSignal).id;
      invocation.read.mockImplementation(() => Promise.resolve(wrongRecord));
      await expect(storage.claim(required(additional.key), "wrong-source", expiry)).rejects.toThrow(
        /physical ID|invocation/i,
      );
      expect(invocationWrite).toHaveBeenCalledTimes(writesAfterCompletion);
      invocation.read.mockImplementation(() => Promise.resolve(admitted));
      const wrongStateHead = clone(AgentExecutionHeadSchema, admittedHead);
      required(wrongStateHead.scope).stateType = "spine.server.testing.AnotherAgentState";
      for (const corruptHead of [
        create(AgentExecutionHeadSchema, { scope: admittedHead.scope, eligibleAt }),
        wrongStateHead,
      ]) {
        query.mockImplementation(() => Promise.resolve([corruptHead]));
        await expect(storage.pending({ count: 1 })).rejects.toThrow(
          /scope or candidate is invalid/i,
        );
      }
      expect(invocationWrite).toHaveBeenCalledTimes(writesAfterCompletion);
      const entitySource = accepted("postgres-entity-source", "T-entity");
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
      invocation.read.mockImplementation(() => Promise.resolve(active));
      headRow.read.mockImplementation(() => Promise.resolve(activeHead));
      query.mockImplementation(() => Promise.resolve([]));
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
        id: create(EventIdSchema, { value: "postgres-diagnostic" }),
        context: {
          producerId: entitySource.recipientId,
          version: create(VersionSchema, { number: 1 }),
          timestamp: create(TimestampSchema, { seconds: 101n }),
        },
      });
      const event = create(EventSchema, {
        id: create(EventIdSchema, { value: "postgres-domain-event" }),
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
      const beforeConditionalFailure = invocationWrite.mock.calls.length;
      applyConditional.mockRejectedValueOnce(new Error("conditional Entity Version changed"));
      await expect(
        storage.complete({
          key: entityKey,
          token: "entity-token",
          expectedRecordBytes,
          next: finished,
          entityCommit,
        }),
      ).rejects.toThrow(/conditional Entity Version changed/i);
      expect(invocationWrite).toHaveBeenCalledTimes(beforeConditionalFailure);
      expect(closePrepared).toHaveBeenCalledTimes(1);
      expect(closeCoordinator).toHaveBeenCalledTimes(1);
      await storage.complete({
        key: entityKey,
        token: "entity-token",
        expectedRecordBytes,
        next: finished,
        entityCommit,
      });
      expect(prepareConditional).toHaveBeenCalledWith(entityCommit);
      expect(applyConditional).toHaveBeenCalledWith(client, 0);
      expect(invocationWrite).toHaveBeenCalledWith(client, finished);
      expect(closePrepared).toHaveBeenCalledTimes(2);
      expect(closeCoordinator).toHaveBeenCalledTimes(2);
      query.mockImplementation(() => Promise.resolve([admittedHead]));
      invocation.read.mockImplementation(() => Promise.resolve(undefined));
      expect(await storage.pending({ count: 1 })).toMatchObject({
        records: [],
        after: { key: { scope: admittedHead.scope } },
      });
      const headWithoutEligibility = clone(AgentExecutionHeadSchema, admittedHead);
      headWithoutEligibility.eligibleAt = undefined;
      query.mockImplementation(() => Promise.resolve([headWithoutEligibility]));
      invocation.read.mockImplementation(() => Promise.resolve(admitted));
      expect(await storage.pending({ count: 1 })).toMatchObject({
        records: [admitted],
        hasMore: false,
      });
      expect((await storage.pending({ count: 1 })).after).toBeUndefined();
      const later = accepted("postgres-later-source", "T-later");
      const laterKey = required(later.key);
      const laterActive = create(AgentExecutionRecordSchema, {
        accepted: later,
        status: AgentInvocationStatus.AGENT_INVOCATION_ACTIVE,
        claimToken: "later-token",
        claimExpiresAt: expiry,
      });
      const laterHead = create(AgentExecutionHeadSchema, {
        scope: laterKey.scope,
        pending: laterKey,
        active: laterKey,
        claimToken: "later-token",
        claimExpiresAt: expiry,
      });
      invocation.read.mockImplementation(() => Promise.resolve(laterActive));
      headRow.read.mockImplementation(() => Promise.resolve(laterHead));
      query.mockImplementation(() => Promise.resolve([]));
      const laterNext = clone(AgentExecutionRecordSchema, laterActive);
      laterNext.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
      laterNext.completion = create(AgentExecutionCompletionSchema, {
        initialVersion: create(VersionSchema, { number: 0 }),
        resultingVersion: create(VersionSchema, { number: 0 }),
      });
      const laterBytes = toBinary(AgentExecutionRecordSchema, laterActive);
      const writesBeforeStaleVersion = invocationWrite.mock.calls.length;
      currentRow.read.mockImplementation(() =>
        Promise.resolve(
          create(EntityRecordSchema, { version: create(VersionSchema, { number: 1 }) }),
        ),
      );
      await expect(
        storage.complete({
          key: laterKey,
          token: "later-token",
          expectedRecordBytes: laterBytes,
          next: laterNext,
        }),
      ).rejects.toThrow(/initial Entity Version is no longer current/i);
      expect(invocationWrite).toHaveBeenCalledTimes(writesBeforeStaleVersion);
      currentRow.read.mockImplementation(() => Promise.resolve(undefined));
      await storage.complete({
        key: laterKey,
        token: "later-token",
        expectedRecordBytes: laterBytes,
        next: laterNext,
      });
      expect(invocationWrite).toHaveBeenCalledWith(client, laterNext);
      const deliverSource = accepted("postgres-delivery-source", "T-delivery");
      const deliverKey = required(deliverSource.key);
      const firstEvent = create(EventSchema, {
        id: create(EventIdSchema, { value: "postgres-output-one" }),
        message: event.message,
      });
      const secondEvent = create(EventSchema, {
        id: create(EventIdSchema, { value: "postgres-output-two" }),
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
      invocation.read.mockImplementation(() =>
        Promise.resolve(clone(AgentExecutionRecordSchema, persistedDelivery)),
      );
      invocationWrite.mockImplementation((...args: unknown[]) => {
        persistedDelivery = clone(AgentExecutionRecordSchema, args[1] as AgentExecutionRecord);
        return Promise.resolve();
      });
      headRow.read.mockImplementation(() => Promise.resolve(deliverHead));
      query.mockImplementation(() => Promise.resolve([]));
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
