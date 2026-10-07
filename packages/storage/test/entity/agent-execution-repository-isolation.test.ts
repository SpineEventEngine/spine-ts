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
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AnyMessages, Time } from "@spine-event-engine/core";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
// prettier-ignore
import {
  AgentExecutionRecordSchema,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { describe, expect, it } from "vitest";
// prettier-ignore
import {
  SupportRecoveryStateSchema,
} from "../../../server-blackbox-tests/generated/spine/server/testing/support_recovery_states_pb.js";
// prettier-ignore
import {
  DraftRecoverySupportReplySchema,
} from "../../../server-blackbox-tests/generated/spine/server/testing/support_recovery_commands_pb.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
} from "../../../server/test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import { AgentExecutionStorageFactories } from "../../src/internal/agent-execution.js";
import { AgentHistoryStorageFactories } from "../../src/internal/agent-history.js";
import { InMemoryStorageFactory } from "../../src/memory/in-memory-storage-factory.js";
import { RecordSpec } from "../../src/record/record-spec.js";
import { accepted, entityInput } from "./agent-execution-fixtures.js";
import { conversation, scope as historyScope } from "./agent-history-fixtures.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Required fixture value is missing.");
  return value;
}

function recoveryInput() {
  const original = entityInput();
  return {
    ...original,
    sourceType: SupportRecoveryStateSchema,
    stateSchema: SupportRecoveryStateSchema,
    recordSpec: new RecordSpec({
      sourceType: SupportRecoveryStateSchema,
      recordType: EntityRecordSchema,
      idSchema: SupportReplyAgentIdSchema,
      extractId: (record) => required(original.id.unpack(required(record.entityId))),
    }),
  };
}

function recoveryAccepted() {
  const result = accepted("recovery-source", "shared-ticket");
  required(required(result.key).scope).stateType = SupportRecoveryStateSchema.typeName;
  if (result.signal.case !== "command") throw new Error("Expected fixture Command.");
  result.signal.value.message = AnyMessages.pack(
    DraftRecoverySupportReplySchema,
    create(DraftRecoverySupportReplySchema, {
      agent: create(SupportReplyAgentIdSchema, { ticketNumber: "shared-ticket" }),
      question: "When will my order arrive?",
    }),
  );
  const handler = required(result.handlers[0]);
  handler.receiverType = SupportRecoveryStateSchema.typeName;
  handler.signalType = DraftRecoverySupportReplySchema.typeName;
  return result;
}

describe("in-memory Agent repository separation", () => {
  it("discovers pending work only for the requested Agent state type", async () => {
    const factory = new InMemoryStorageFactory();
    const reply = AgentExecutionStorageFactories.create(factory, {
      entity: entityInput(),
      stateType: SupportReplyAgentStateSchema.typeName,
    });
    const recovery = AgentExecutionStorageFactories.create(factory, {
      entity: recoveryInput(),
      stateType: SupportRecoveryStateSchema.typeName,
    });
    try {
      const first = accepted("reply-source", "shared-ticket");
      const second = recoveryAccepted();
      await reply.admit(first);
      await recovery.admit(second);
      expect((await reply.pending({ count: 10 })).records.map((r) => r.accepted)).toEqual([first]);
      expect((await recovery.pending({ count: 10 })).records.map((r) => r.accepted)).toEqual([
        second,
      ]);
    } finally {
      reply.close();
      recovery.close();
      factory.close();
    }
  });

  it("keeps journal history in each Agent type's index for an identical typed ID", async () => {
    const previous = Time.setProvider({
      currentTime: () => create(TimestampSchema, { seconds: 100n }),
    });
    const factory = new InMemoryStorageFactory();
    const reply = AgentExecutionStorageFactories.create(factory, {
      entity: entityInput(),
      stateType: SupportReplyAgentStateSchema.typeName,
    });
    const recovery = AgentExecutionStorageFactories.create(factory, {
      entity: recoveryInput(),
      stateType: SupportRecoveryStateSchema.typeName,
    });
    const replyHistory = AgentHistoryStorageFactories.create(factory, historyScope);
    const recoveryHistory = AgentHistoryStorageFactories.create(factory, {
      ...historyScope,
      stateType: SupportRecoveryStateSchema.typeName,
    });
    try {
      const pairs = [
        {
          handle: reply,
          source: accepted("reply-source", "shared-ticket"),
          recordId: "reply-record",
        },
        { handle: recovery, source: recoveryAccepted(), recordId: "recovery-record" },
      ];
      for (const { handle, source, recordId } of pairs) {
        await handle.admit(source);
        const key = required(source.key);
        const record = required(
          await handle.claim(key, "claim", create(TimestampSchema, { seconds: 200n })),
        ).record;
        await handle.update({
          key,
          token: "claim",
          expectedRecordBytes: toBinary(AgentExecutionRecordSchema, record),
          next: clone(AgentExecutionRecordSchema, record),
          historyEntries: [
            conversation(recordId, "conversation", create(TimestampSchema, { seconds: 101n })),
          ],
        });
      }
      const request = {
        entityId: "shared-ticket",
        view: { kind: "full" as const },
        count: 10,
        maxBytes: 100_000,
      };
      const first = await replyHistory.read(request);
      const second = await recoveryHistory.read(request);
      expect(first.entries).toHaveLength(1);
      expect(second.entries).toHaveLength(1);
      expect(first.entries[0]?.item).toMatchObject({
        case: "conversationRecord",
        value: { id: { value: "reply-record" } },
      });
      expect(second.entries[0]?.item).toMatchObject({
        case: "conversationRecord",
        value: { id: { value: "recovery-record" } },
      });
    } finally {
      replyHistory.close();
      recoveryHistory.close();
      reply.close();
      recovery.close();
      factory.close();
      Time.setProvider(previous);
    }
  });
});
