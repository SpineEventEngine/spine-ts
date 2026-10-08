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
import { EmptySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { VersionSchema } from "@spine-event-engine/proto";
import { AiModelKind, ModelPreferenceSchema } from "@spine-event-engine/proto/agent";
import {
  AgentExecutionCompletionSchema,
  AgentExecutionHeadSchema,
  AgentExecutionRecordSchema,
  AgentInvocationCountersSchema,
  AgentInvocationStatus,
  type AgentExecutionHead,
  type AgentExecutionRecord,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { describe, expect, it, vi } from "vitest";

import { accepted } from "../../storage/test/entity/agent-execution-fixtures.js";
import { providerEntityInput } from "../../storage/test/entity/agent-execution-provider-fixtures.js";
import { MysqlAgentExecution } from "../src/mysql/agent-execution.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Required Agent execution test value is missing.");
  return value;
}

describe("MySQL Agent execution provider boundary", () => {
  it("reads one indexed candidate with a fixed continuation and validates index readiness", async () => {
    const source = accepted("mysql-boundary-source");
    const key = required(source.key);
    const eligibleAt = create(TimestampSchema, { seconds: 100n });
    const asOf = create(TimestampSchema, { seconds: 110n });
    const head = create(AgentExecutionHeadSchema, {
      scope: key.scope,
      pending: key,
      eligibleAt,
    });
    const record = create(AgentExecutionRecordSchema, {
      accepted: source,
      status: AgentInvocationStatus.AGENT_INVOCATION_ACCEPTED,
    });
    const historyPage = vi.fn<(sql: string, values: unknown[]) => Promise<AgentExecutionHead[]>>(
      () => Promise.resolve([head]),
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
    const row = { prepare, ensureHistoryIndex, close, withConnection };
    const rows = {
      invocation: {
        ...row,
        tableName: "agent_invocations",
        read: vi.fn(() => Promise.resolve(record)),
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
        readCurrentLocked: vi.fn(() => Promise.resolve(undefined)),
      },
      events: { ...row, tableName: "agent_events" },
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
      { entity: providerEntityInput(), stateType: required(key.scope).stateType },
      rows as never,
      { commit } as never,
      "test_database",
    );
    try {
      const page = await storage.pending({
        count: 1,
        after: { asOf, key: { scope: required(key.scope), eligibleAt } },
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
      expect(historyPage).toHaveBeenCalledWith(
        expect.stringContaining("BINARY `state_type`=BINARY ?"),
        expect.arrayContaining([required(key.scope).stateType, 2]),
      );
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
      await storage.complete({
        key: required(additional.key),
        token: "mysql-boundary-token",
        expectedRecordBytes: toBinary(AgentExecutionRecordSchema, next),
        next: completed,
      });
      expect(invocationWrite).toHaveBeenCalledWith(completed);
      expect(headWrites.at(-1)?.pending).toBeUndefined();
      expect(headWrites.at(-1)?.preferences[0]?.kind).toBe(AiModelKind.GENERATION);
    } finally {
      storage.close();
    }
    await expect(storage.read(required(key))).rejects.toThrow(/closed/i);
  });
});
