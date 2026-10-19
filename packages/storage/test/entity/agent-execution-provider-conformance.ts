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
import { clone, create, toBinary, type Message } from "@bufbuild/protobuf";
import { AnySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { CommandIdSchema, CommandSchema, VersionSchema } from "@spine-event-engine/proto";
import {
  AgentAcceptedInvocationSchema,
  AgentExecutionCompletionSchema,
  AgentExecutionRecordSchema,
  AgentInvocationCountersSchema,
  AgentInvocationStatus,
  AgentOutgoingCommandSchema,
  AgentSavedDispatchPlanSchema,
  type AgentExecutionRecord,
  type AgentInvocationKey,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import type { AgentExecutionStorage } from "@spine-event-engine/storage/provider";
import { expect } from "vitest";

// prettier-ignore
import {
  DraftSupportReplySchema,
} from "../../../server/test-fixtures/generated/entity-metadata/support_agent_commands_pb.js";
// prettier-ignore
import {
  SupportReplyAgentIdSchema,
} from "../../../server/test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import { accepted } from "./agent-execution-fixtures.js";
import { conversation } from "./agent-history-fixtures.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Agent conformance fixture value is missing.");
  return value;
}

/**
 * Exercises fenced renewal, history, completion and saved-Command delivery on one provider.
 * @param storage Tenant-scoped Agent execution handle.
 * @returns Completion after persisted lifecycle assertions.
 * @typeParam I Typed Agent identifier.
 * @typeParam S Generated Agent state.
 */
export async function exerciseAgentExecutionLifecycle<I, S extends Message>(
  storage: AgentExecutionStorage<I, S>,
): Promise<void> {
  const source = accepted(randomUUID(), `T-${randomUUID()}`);
  const key = required(source.key);
  const claim = await claimed(storage, key, source);
  const updated = await journaled(storage, key, claim);
  const completed = await completedOutput(storage, key, updated);
  await delivered(storage, key, completed);
}

async function claimed<I, S extends Message>(
  storage: AgentExecutionStorage<I, S>,
  key: AgentInvocationKey,
  source: ReturnType<typeof accepted>,
): Promise<AgentExecutionRecord> {
  await storage.admit(source);
  const expiry = create(TimestampSchema, { seconds: 4_000_000_000n });
  const claim = required(await storage.claim(key, "conformance-token", expiry));
  expect(await storage.claim(key, "other-token", expiry)).toBeUndefined();
  expect(
    await storage.renew(
      key,
      "conformance-token",
      create(TimestampSchema, { seconds: 4_000_000_001n }),
    ),
  ).toBe(true);
  expect(
    await storage.renew(key, "other-token", create(TimestampSchema, { seconds: 4_000_000_002n })),
  ).toBe(false);
  const retained = required(await storage.read(key));
  expect(retained.claimExpiresAt?.seconds).toBe(4_000_000_001n);
  expect(toBinary(AgentAcceptedInvocationSchema, required(claim.record.accepted))).toEqual(
    toBinary(AgentAcceptedInvocationSchema, source),
  );
  return retained;
}

async function journaled<I, S extends Message>(
  storage: AgentExecutionStorage<I, S>,
  key: AgentInvocationKey,
  prior: AgentExecutionRecord,
): Promise<AgentExecutionRecord> {
  const next = clone(AgentExecutionRecordSchema, prior);
  next.counters = create(AgentInvocationCountersSchema, { operations: 1n });
  await expect(
    storage.update({
      key,
      token: "expired-token",
      expectedRecordBytes: toBinary(AgentExecutionRecordSchema, prior),
      next,
    }),
  ).rejects.toThrow(/claim|token/i);
  await expect(
    storage.update({
      key,
      token: "conformance-token",
      expectedRecordBytes: new Uint8Array(),
      next,
    }),
  ).rejects.toThrow(/changed|expected|stale|image/i);
  expect(toBinary(AgentExecutionRecordSchema, required(await storage.read(key)))).toEqual(
    toBinary(AgentExecutionRecordSchema, prior),
  );
  await storage.update({
    key,
    token: "conformance-token",
    expectedRecordBytes: toBinary(AgentExecutionRecordSchema, prior),
    next,
    historyEntries: [
      conversation(randomUUID(), randomUUID(), create(TimestampSchema, { seconds: 101n })),
    ],
  });
  expect(toBinary(AgentExecutionRecordSchema, required(await storage.read(key)))).toEqual(
    toBinary(AgentExecutionRecordSchema, next),
  );
  await expect(
    storage.update({
      key,
      token: "conformance-token",
      expectedRecordBytes: toBinary(AgentExecutionRecordSchema, prior),
      next: prior,
    }),
  ).rejects.toThrow(/changed|expected|stale|image|current/i);
  expect(toBinary(AgentExecutionRecordSchema, required(await storage.read(key)))).toEqual(
    toBinary(AgentExecutionRecordSchema, next),
  );
  return next;
}

async function completedOutput<I, S extends Message>(
  storage: AgentExecutionStorage<I, S>,
  key: AgentInvocationKey,
  prior: AgentExecutionRecord,
): Promise<AgentExecutionRecord> {
  const id = create(CommandIdSchema, { uuid: randomUUID() });
  const agent = create(SupportReplyAgentIdSchema, { ticketNumber: required(key.scope).agentKey });
  const draft = create(DraftSupportReplySchema, { agent, question: "Please review." });
  const command = create(CommandSchema, {
    id,
    message: create(AnySchema, {
      typeUrl: `type.spine.server.testing/${DraftSupportReplySchema.typeName}`,
      value: toBinary(DraftSupportReplySchema, draft),
    }),
  });
  const next = clone(AgentExecutionRecordSchema, prior);
  next.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED_PENDING_COMMANDS;
  next.completion = create(AgentExecutionCompletionSchema, {
    initialVersion: create(VersionSchema, { number: 0 }),
    resultingVersion: create(VersionSchema, { number: 0 }),
    commands: [create(AgentOutgoingCommandSchema, { command })],
  });
  const duplicated = clone(AgentExecutionRecordSchema, next);
  duplicated.completion?.commands.push(create(AgentOutgoingCommandSchema, { command }));
  await expect(
    storage.complete({
      key,
      token: "conformance-token",
      expectedRecordBytes: toBinary(AgentExecutionRecordSchema, prior),
      next: duplicated,
    }),
  ).rejects.toThrow(/duplicate/i);
  expect(toBinary(AgentExecutionRecordSchema, required(await storage.read(key)))).toEqual(
    toBinary(AgentExecutionRecordSchema, prior),
  );
  await storage.complete({
    key,
    token: "conformance-token",
    expectedRecordBytes: toBinary(AgentExecutionRecordSchema, prior),
    next,
  });
  expect(toBinary(AgentExecutionRecordSchema, required(await storage.read(key)))).toEqual(
    toBinary(AgentExecutionRecordSchema, next),
  );
  await expect(
    storage.complete({
      key,
      token: "conformance-token",
      expectedRecordBytes: toBinary(AgentExecutionRecordSchema, prior),
      next,
    }),
  ).rejects.toThrow(/changed|expected|stale|image|current/i);
  expect(toBinary(AgentExecutionRecordSchema, required(await storage.read(key)))).toEqual(
    toBinary(AgentExecutionRecordSchema, next),
  );
  return next;
}

async function delivered<I, S extends Message>(
  storage: AgentExecutionStorage<I, S>,
  key: AgentInvocationKey,
  prior: AgentExecutionRecord,
): Promise<void> {
  const prepared = clone(AgentExecutionRecordSchema, prior);
  const outgoing = required(prepared.completion?.commands[0]);
  outgoing.plan = create(AgentSavedDispatchPlanSchema);
  await storage.update({
    key,
    token: "conformance-token",
    expectedRecordBytes: toBinary(AgentExecutionRecordSchema, prior),
    next: prepared,
  });
  expect(toBinary(AgentExecutionRecordSchema, required(await storage.read(key)))).toEqual(
    toBinary(AgentExecutionRecordSchema, prepared),
  );
  const changedPlan = clone(AgentExecutionRecordSchema, prepared);
  required(required(changedPlan.completion).commands[0]).plan = create(
    AgentSavedDispatchPlanSchema,
    { targets: [] },
  );
  required(required(changedPlan.completion).commands[0]).delivered = true;
  await expect(
    storage.update({
      key,
      token: "conformance-token",
      expectedRecordBytes: toBinary(AgentExecutionRecordSchema, prepared),
      next: changedPlan,
    }),
  ).rejects.toThrow(/immutable|one-time|delivered/i);
  expect(toBinary(AgentExecutionRecordSchema, required(await storage.read(key)))).toEqual(
    toBinary(AgentExecutionRecordSchema, prepared),
  );
  const signal = required(outgoing.command?.id);
  await expect(
    storage.markDelivered(key, "conformance-token", new Uint8Array(), [signal]),
  ).rejects.toThrow(/changed|expected|stale|image|current/i);
  expect(toBinary(AgentExecutionRecordSchema, required(await storage.read(key)))).toEqual(
    toBinary(AgentExecutionRecordSchema, prepared),
  );
  await storage.markDelivered(
    key,
    "conformance-token",
    toBinary(AgentExecutionRecordSchema, prepared),
    [signal],
  );
  expect((await storage.read(key))?.status).toBe(AgentInvocationStatus.AGENT_INVOCATION_COMPLETED);
}
