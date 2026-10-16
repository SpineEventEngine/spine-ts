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
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { VersionSchema } from "@spine-event-engine/proto";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import {
  AgentExecutionCompletionSchema,
  AgentExecutionRecordSchema,
  AgentInvocationStatus,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { AgentExecutionStorageFactories } from "@spine-event-engine/storage/provider";
import {
  AgentHistoryStorageFactories,
  EntityCommitStorageFactories,
} from "@spine-event-engine/storage/provider";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { accepted } from "../../storage/test/entity/agent-execution-fixtures.js";
import { providerEntityInput } from "../../storage/test/entity/agent-execution-provider-fixtures.js";
import { exerciseAgentExecutionLifecycle } from "../../storage/test/entity/agent-execution-provider-conformance.js";
import { conversation } from "../../storage/test/entity/agent-history-fixtures.js";
// prettier-ignore
import {
  SupportReplyAgentStateSchema,
} from "../../server/test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import { PostgresStorageFactory } from "../src/index.js";

const url = process.env.SPINE_TS_POSTGRESQL_URL;

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Required Agent execution test value is missing.");
  return value;
}

describe.runIf(url !== undefined)("PostgreSQL Agent execution", () => {
  it("retains original accepted work across factory reconstruction", async () => {
    const schema = `agent_execution_${randomUUID().replaceAll("-", "")}`;
    const pool = new Pool({ connectionString: url });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    try {
      const first = await PostgresStorageFactory.newBuilder()
        .setOptions({ url: required(url), schema })
        .build();
      const original = accepted(randomUUID(), `T-${randomUUID()}`);
      const input = {
        entity: providerEntityInput(),
        stateType: "spine.server.testing.SupportReplyAgentState",
      };
      const handle = AgentExecutionStorageFactories.create(first, input);
      const stored = await handle.admit(original);
      expect(toBinary(AgentExecutionRecordSchema, stored)).toEqual(
        toBinary(AgentExecutionRecordSchema, required(await handle.read(required(original.key)))),
      );
      handle.close();
      first.close();

      const reopened = await PostgresStorageFactory.newBuilder()
        .setOptions({ url: required(url), schema })
        .build();
      try {
        const after = AgentExecutionStorageFactories.create(reopened, input);
        expect(
          toBinary(AgentExecutionRecordSchema, required(await after.read(required(original.key)))),
        ).toEqual(toBinary(AgentExecutionRecordSchema, stored));
        await expect(after.admit(original)).resolves.toEqual(stored);
        await expect(after.pending({ count: 1 })).resolves.toMatchObject({
          records: [{ accepted: original }],
          hasMore: false,
        });
        const expiry = create(TimestampSchema, { seconds: 4_000_000_000n });
        const claimed = await after.claim(required(original.key), "pg-claim", expiry);
        expect(claimed).toMatchObject({ record: { claimToken: "pg-claim" } });
        await expect(
          after.claim(required(original.key), "pg-duplicate", expiry),
        ).resolves.toBeUndefined();
        const next = clone(AgentExecutionRecordSchema, required(claimed).record);
        next.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
        next.completion = create(AgentExecutionCompletionSchema, {
          initialVersion: create(VersionSchema, { number: 0 }),
          resultingVersion: create(VersionSchema, { number: 0 }),
        });
        await after.complete({
          key: required(original.key),
          token: "pg-claim",
          expectedRecordBytes: toBinary(AgentExecutionRecordSchema, required(claimed).record),
          next,
        });
        await expect(after.pending({ count: 1 })).resolves.toMatchObject({
          records: [],
          hasMore: false,
        });
        await expect(after.read(required(original.key))).resolves.toMatchObject({
          status: AgentInvocationStatus.AGENT_INVOCATION_COMPLETED,
        });
        const sharedSource = randomUUID();
        const prefix = accepted(sharedSource, `T-${randomUUID()}-é`);
        const extended = accepted(
          sharedSource,
          `${required(required(prefix.key).scope).agentKey}x`,
        );
        await after.admit(prefix);
        await after.admit(extended);
        const pageOne = await after.pending({ count: 1 });
        expect(
          required(required(required(required(pageOne.records[0]).accepted).key).scope).agentKey,
        ).toBe(required(required(prefix.key).scope).agentKey);
        expect(pageOne.hasMore).toBe(true);
        const pageTwo = await after.pending({
          count: 1,
          after: required(pageOne.after),
        });
        expect(
          required(required(required(required(pageTwo.records[0]).accepted).key).scope).agentKey,
        ).toBe(required(required(extended.key).scope).agentKey);
        const stale = accepted(randomUUID(), `T-${randomUUID()}`);
        await after.admit(stale);
        const id = input.entity.id.unpack(required(stale.recipientId));
        expect(id).toBeDefined();
        const commit = EntityCommitStorageFactories.create(reopened, input.entity);
        await commit.commit({
          context: input.entity.context,
          entity: input.entity,
          entityId: required(id),
          next: create(EntityRecordSchema, {
            entityId: stale.recipientId,
            state: create(AnySchema, {
              typeUrl: `type.spine.server.testing/${SupportReplyAgentStateSchema.typeName}`,
              value: toBinary(
                SupportReplyAgentStateSchema,
                create(SupportReplyAgentStateSchema, { id, proposedReply: "Existing" }),
              ),
            }),
            version: create(VersionSchema, { number: 1 }),
          }),
        });
        commit.close();
        const staleClaim = required(
          await after.claim(required(stale.key), "stale-claim", expiry),
        ).record;
        const staleNext = clone(AgentExecutionRecordSchema, staleClaim);
        staleNext.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
        staleNext.completion = create(AgentExecutionCompletionSchema, {
          initialVersion: create(VersionSchema, { number: 0 }),
          resultingVersion: create(VersionSchema, { number: 0 }),
        });
        const entry = conversation(
          randomUUID(),
          "pg-stale",
          create(TimestampSchema, { seconds: 101n }),
        );
        await expect(
          after.complete({
            key: required(stale.key),
            token: "stale-claim",
            expectedRecordBytes: toBinary(AgentExecutionRecordSchema, staleClaim),
            next: staleNext,
            historyEntries: [entry],
          }),
        ).rejects.toThrow(/Version/i);
        await expect(after.read(required(stale.key))).resolves.toEqual(staleClaim);
        const history = AgentHistoryStorageFactories.create(reopened, {
          context: input.entity.context,
          stateType: input.stateType,
          id: { key: (value: string) => value },
        });
        await expect(
          history.read({
            entityId: required(required(stale.key).scope).agentKey,
            view: { kind: "full" },
            count: 1,
            maxBytes: 100_000,
          }),
        ).resolves.toMatchObject({ entries: [] });
        history.close();
        const indexes = await pool.query<{ indexname: string; indexdef: string }>(
          "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname LIKE 'agent_execution_%'",
          [schema],
        );
        const definitions = Object.fromEntries(
          indexes.rows.map(({ indexname, indexdef }) => [indexname, indexdef]),
        );
        expect(definitions.agent_execution_pending).toContain(
          'state_digest, pending_key COLLATE "C"',
        );
        expect(definitions.agent_execution_instance).toContain(
          'scope_digest, status, order_key COLLATE "C"',
        );
        await exerciseAgentExecutionLifecycle(after);
        after.close();
      } finally {
        reopened.close();
      }
    } finally {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
    }
  }, 120_000);
});
