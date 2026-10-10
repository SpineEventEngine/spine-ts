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
import { createPool, type RowDataPacket } from "mysql2/promise";
import { clone, create, toBinary } from "@bufbuild/protobuf";
import { AnySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { VersionSchema } from "@spine-event-engine/proto";
import { AgentHistoryEntrySchema } from "@spine-event-engine/proto/agent";
import {
  AgentExecutionCompletionSchema,
  AgentExecutionHeadSchema,
  AgentExecutionRecordSchema,
  AgentInvocationStatus,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import {
  AgentExecutionStorageFactories,
  AgentExecutionSizes,
  AgentHistoryStorageFactories,
  EntityCommitStorageFactories,
} from "@spine-event-engine/storage/provider";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { describe, expect, it } from "vitest";

import { accepted } from "../../storage/test/entity/agent-execution-fixtures.js";
import { providerEntityInput } from "../../storage/test/entity/agent-execution-provider-fixtures.js";
import { exerciseAgentExecutionLifecycle } from "../../storage/test/entity/agent-execution-provider-conformance.js";
import { conversation } from "../../storage/test/entity/agent-history-fixtures.js";
// prettier-ignore
import {
  SupportReplyAgentStateSchema,
} from "../../server/test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import { MysqlStorageFactory } from "../src/index.js";

const url = process.env.SPINE_TS_MYSQL_URL;

interface IndexRow extends RowDataPacket {
  name: string;
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Required Agent execution test value is missing.");
  return value;
}

describe.runIf(url !== undefined)("MySQL Agent execution", () => {
  it("retains accepted work and completes a no-op under a native transaction", async () => {
    const table = `agent_execution_${randomUUID().replaceAll("-", "")}`;
    const head = `agent_head_${randomUUID().replaceAll("-", "")}`;
    const builder = () =>
      MysqlStorageFactory.newBuilder()
        .setOptions({ url: required(url) })
        .setTableName(AgentExecutionRecordSchema, AgentExecutionRecordSchema, table)
        .setTableName(AgentExecutionHeadSchema, AgentExecutionHeadSchema, head);
    const first = await builder().build();
    const input = {
      entity: providerEntityInput(),
      stateType: "spine.server.testing.SupportReplyAgentState",
    };
    const original = accepted(randomUUID(), `T-${randomUUID()}`);
    const key = required(original.key);
    try {
      const storage = AgentExecutionStorageFactories.create(first, input);
      const stored = await storage.admit(original);
      expect(toBinary(AgentExecutionRecordSchema, stored)).toEqual(
        toBinary(AgentExecutionRecordSchema, required(await storage.read(key))),
      );
      storage.close();
    } finally {
      first.close();
    }
    const reopened = await builder().build();
    const pool = createPool(required(url));
    try {
      const storage = AgentExecutionStorageFactories.create(reopened, input);
      expect(storage.capacity).toMatchObject({
        executionRecordBytes: 65_535,
        executionHeadBytes: 65_535,
        historyRecordBytes: 65_535,
      });
      await expect(storage.admit(original)).resolves.toMatchObject({ accepted: original });
      await expect(storage.pending({ count: 1 })).resolves.toMatchObject({
        hasMore: false,
        records: [{ accepted: original }],
      });
      const claim = await storage.claim(
        key,
        "mysql-token",
        create(TimestampSchema, { seconds: 4_000_000_000n }),
      );
      expect(claim?.record.claimToken).toBe("mysql-token");
      const claimed = required(claim).record;
      const next = clone(AgentExecutionRecordSchema, claimed);
      next.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
      next.completion = create(AgentExecutionCompletionSchema, {
        initialVersion: create(VersionSchema, { number: 0 }),
        resultingVersion: create(VersionSchema, { number: 0 }),
      });
      await storage.complete({
        key,
        token: "mysql-token",
        expectedRecordBytes: toBinary(AgentExecutionRecordSchema, claimed),
        next,
      });
      await expect(storage.pending({ count: 1 })).resolves.toMatchObject({ records: [] });
      const concurrent = accepted(randomUUID(), `T-${randomUUID()}`);
      const concurrentKey = required(concurrent.key);
      const other = AgentExecutionStorageFactories.create(reopened, input);
      const admitted = await Promise.all([storage.admit(concurrent), other.admit(concurrent)]);
      expect(admitted[0]).toEqual(admitted[1]);
      const expiry = create(TimestampSchema, { seconds: 4_000_000_000n });
      const claims = await Promise.all([
        storage.claim(concurrentKey, "mysql-first", expiry),
        other.claim(concurrentKey, "mysql-second", expiry),
      ]);
      expect(claims.filter((claim) => claim !== undefined)).toHaveLength(1);
      other.close();
      const stale = accepted(randomUUID(), `T-${randomUUID()}`);
      const staleKey = required(stale.key);
      await storage.admit(stale);
      const id = required(input.entity.id.unpack(required(stale.recipientId)));
      const commit = EntityCommitStorageFactories.create(reopened, input.entity);
      await commit.commit({
        context: input.entity.context,
        entity: input.entity,
        entityId: id,
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
      const staleClaim = required(await storage.claim(staleKey, "mysql-stale", expiry)).record;
      const staleNext = clone(AgentExecutionRecordSchema, staleClaim);
      staleNext.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
      staleNext.completion = create(AgentExecutionCompletionSchema, {
        initialVersion: create(VersionSchema, { number: 0 }),
        resultingVersion: create(VersionSchema, { number: 0 }),
      });
      const entry = conversation(
        randomUUID(),
        "mysql-stale",
        create(TimestampSchema, { seconds: 101n }),
      );
      const oversized = clone(AgentHistoryEntrySchema, entry);
      if (
        oversized.item.case !== "conversationRecord" ||
        oversized.item.value.content === undefined
      )
        throw new Error("Conversation fixture lacks typed content.");
      oversized.item.value.content.value = new Uint8Array(65_536);
      expect(AgentExecutionSizes.history(required(staleKey.scope), oversized)).toBeGreaterThan(
        required(storage.capacity.historyRecordBytes),
      );
      await expect(
        storage.update({
          key: staleKey,
          token: "mysql-stale",
          expectedRecordBytes: toBinary(AgentExecutionRecordSchema, staleClaim),
          next: clone(AgentExecutionRecordSchema, staleClaim),
          historyEntries: [oversized],
        }),
      ).rejects.toThrow(/history record exceeds MySQL BLOB capacity/i);
      await expect(storage.read(staleKey)).resolves.toEqual(staleClaim);
      await expect(
        storage.complete({
          key: staleKey,
          token: "mysql-stale",
          expectedRecordBytes: toBinary(AgentExecutionRecordSchema, staleClaim),
          next: staleNext,
          historyEntries: [entry],
        }),
      ).rejects.toThrow(/Version/i);
      await expect(storage.read(staleKey)).resolves.toEqual(staleClaim);
      const history = AgentHistoryStorageFactories.create(reopened, {
        context: input.entity.context,
        stateType: input.stateType,
        id: { key: (value: string) => value },
      });
      await expect(
        history.read({
          entityId: required(staleKey.scope).agentKey,
          view: { kind: "full" },
          count: 1,
          maxBytes: 100_000,
        }),
      ).resolves.toMatchObject({ entries: [] });
      history.close();
      const collision = accepted(randomUUID(), `T-${randomUUID()}`);
      const collisionKey = required(collision.key);
      const collisionId = required(input.entity.id.unpack(required(collision.recipientId)));
      const originalEntry = conversation(
        "mysql-collision",
        "c-1",
        create(TimestampSchema, { seconds: 201n }),
      );
      const changedEntry = conversation(
        "mysql-collision",
        "c-1",
        create(TimestampSchema, { seconds: 202n }),
      );
      const retained = AgentHistoryStorageFactories.create(reopened, {
        context: input.entity.context,
        stateType: input.stateType,
        id: { key: (value: string) => value },
      });
      await retained.append(required(collisionKey.scope).agentKey, originalEntry);
      await storage.admit(collision);
      const collisionClaim = required(
        await storage.claim(collisionKey, "mysql-collision-token", expiry),
      ).record;
      const collisionNext = clone(AgentExecutionRecordSchema, collisionClaim);
      collisionNext.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
      collisionNext.completion = create(AgentExecutionCompletionSchema, {
        initialVersion: create(VersionSchema, { number: 0 }),
        resultingVersion: create(VersionSchema, { number: 1 }),
      });
      const nextCurrent = create(EntityRecordSchema, {
        entityId: collision.recipientId,
        state: create(AnySchema, {
          typeUrl: `type.spine.server.testing/${SupportReplyAgentStateSchema.typeName}`,
          value: toBinary(
            SupportReplyAgentStateSchema,
            create(SupportReplyAgentStateSchema, { id: collisionId, proposedReply: "New" }),
          ),
        }),
        version: create(VersionSchema, { number: 1 }),
      });
      await expect(
        storage.complete({
          key: collisionKey,
          token: "mysql-collision-token",
          expectedRecordBytes: toBinary(AgentExecutionRecordSchema, collisionClaim),
          next: collisionNext,
          historyEntries: [changedEntry],
          entityCommit: {
            context: input.entity.context,
            entity: input.entity,
            entityId: collisionId,
            next: nextCurrent,
          },
        }),
      ).rejects.toThrow(/immutable/i);
      const current = reopened.createRecordStorage(input.entity.context, input.entity.recordSpec);
      await expect(current.read(collisionId)).resolves.toBeUndefined();
      await expect(storage.read(collisionKey)).resolves.toEqual(collisionClaim);
      current.close();
      retained.close();
      const [indexes] = await pool.query<IndexRow[]>(
        "SELECT index_name AS name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=?",
        [head],
      );
      expect(indexes.map((row) => row.name)).toContain("agent_execution_pending");
      await exerciseAgentExecutionLifecycle(storage);
      storage.close();
    } finally {
      reopened.close();
      await pool.query(`DROP TABLE IF EXISTS \`${table}\``);
      await pool.query(`DROP TABLE IF EXISTS \`${head}\``);
      await pool.end();
    }
  }, 120_000);
});
