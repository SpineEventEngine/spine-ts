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
import { PostgresAgentExecution } from "../src/postgres/agent-execution.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Required Agent execution test value is missing.");
  return value;
}

describe("PostgreSQL Agent execution provider boundary", () => {
  it("reads one binary ordered candidate through the required native indexes", async () => {
    const source = accepted("postgres-boundary-source");
    const key = required(source.key);
    const eligibleAt = create(TimestampSchema, { seconds: 100n });
    const asOf = create(TimestampSchema, { seconds: 110n });
    const head = create(AgentExecutionHeadSchema, { scope: key.scope, pending: key, eligibleAt });
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
    >(() => Promise.resolve([head]));
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
    headRow.read.mockImplementation(() => Promise.resolve(undefined));
    const storage = new PostgresAgentExecution(
      { entity: providerEntityInput(), stateType: required(key.scope).stateType },
      { historyExecutor: () => invocation, close } as never,
      { historyExecutor: () => headRow, close } as never,
      { historyExecutor: () => executor("agent_history"), close } as never,
      { historyExecutor: () => executor("agent_current"), close } as never,
      (() => undefined) as never,
    );
    try {
      const page = await storage.pending({
        count: 1,
        after: { asOf, key: { scope: required(key.scope), eligibleAt } },
      });
      expect(page.records).toEqual([record]);
      expect(page.after?.asOf).toEqual(asOf);
      expect(page.hasMore).toBe(false);
      expect(query).toHaveBeenCalledWith(
        client,
        expect.stringContaining('"pending_key" COLLATE "C" > $4'),
        expect.arrayContaining([required(key.scope).stateType, 2]),
      );
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
      await storage.complete({
        key: required(additional.key),
        token: "postgres-boundary-token",
        expectedRecordBytes: toBinary(AgentExecutionRecordSchema, next),
        next: completed,
      });
      expect(invocationWrite).toHaveBeenCalledWith(client, completed);
      expect(headWrites.at(-1)?.pending).toBeUndefined();
      expect(headWrites.at(-1)?.preferences[0]?.kind).toBe(AiModelKind.GENERATION);
    } finally {
      storage.close();
    }
    await expect(storage.read(required(key))).rejects.toThrow(/closed/i);
  });
});
