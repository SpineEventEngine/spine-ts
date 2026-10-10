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
import { EventIdSchema, EventSchema, VersionSchema } from "@spine-event-engine/proto";
import {
  AgentExecutionCompletionSchema,
  AgentExecutionRecordSchema,
  AgentInvocationCountersSchema,
  AgentInvocationStatus,
  AgentOutgoingSignalSchema,
  AgentSavedDispatchPlanSchema,
  AgentSignalKeySchema,
  type AgentExecutionRecord,
  type AgentInvocationKey,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import type { AgentExecutionStorage } from "@spine-event-engine/storage/provider";
import { expect } from "vitest";

// prettier-ignore
import {
  SupportReplyDraftedSchema,
} from "../../../server/test-fixtures/generated/entity-metadata/support_agent_events_pb.js";
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
 * Exercises fenced renewal, history, completion and saved-output delivery on one provider.
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
  expect(claim.record.accepted).toEqual(source);
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
  expect(await storage.read(key)).toEqual(prior);
  await storage.update({
    key,
    token: "conformance-token",
    expectedRecordBytes: toBinary(AgentExecutionRecordSchema, prior),
    next,
    historyEntries: [
      conversation(randomUUID(), randomUUID(), create(TimestampSchema, { seconds: 101n })),
    ],
  });
  expect(await storage.read(key)).toEqual(next);
  await expect(
    storage.update({
      key,
      token: "conformance-token",
      expectedRecordBytes: toBinary(AgentExecutionRecordSchema, prior),
      next: prior,
    }),
  ).rejects.toThrow(/changed|expected|stale|image|current/i);
  expect(await storage.read(key)).toEqual(next);
  return next;
}

async function completedOutput<I, S extends Message>(
  storage: AgentExecutionStorage<I, S>,
  key: AgentInvocationKey,
  prior: AgentExecutionRecord,
): Promise<AgentExecutionRecord> {
  const id = create(EventIdSchema, { value: randomUUID() });
  const agent = create(SupportReplyAgentIdSchema, { ticketNumber: required(key.scope).agentKey });
  const reply = create(SupportReplyDraftedSchema, { agent, reply: "Please review." });
  const event = create(EventSchema, {
    id,
    message: create(AnySchema, {
      typeUrl: `type.spine.server.testing/${SupportReplyDraftedSchema.typeName}`,
      value: toBinary(SupportReplyDraftedSchema, reply),
    }),
  });
  const next = clone(AgentExecutionRecordSchema, prior);
  next.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED_PENDING_DELIVERY;
  next.completion = create(AgentExecutionCompletionSchema, {
    initialVersion: create(VersionSchema, { number: 0 }),
    resultingVersion: create(VersionSchema, { number: 0 }),
    outgoing: [create(AgentOutgoingSignalSchema, { signal: { case: "event", value: event } })],
  });
  const duplicated = clone(AgentExecutionRecordSchema, next);
  duplicated.completion?.outgoing.push(
    create(AgentOutgoingSignalSchema, {
      signal: { case: "event", value: event },
    }),
  );
  await expect(
    storage.complete({
      key,
      token: "conformance-token",
      expectedRecordBytes: toBinary(AgentExecutionRecordSchema, prior),
      next: duplicated,
    }),
  ).rejects.toThrow(/duplicate/i);
  expect(await storage.read(key)).toEqual(prior);
  await storage.complete({
    key,
    token: "conformance-token",
    expectedRecordBytes: toBinary(AgentExecutionRecordSchema, prior),
    next,
  });
  expect(await storage.read(key)).toEqual(next);
  await expect(
    storage.complete({
      key,
      token: "conformance-token",
      expectedRecordBytes: toBinary(AgentExecutionRecordSchema, prior),
      next,
    }),
  ).rejects.toThrow(/changed|expected|stale|image|current/i);
  expect(await storage.read(key)).toEqual(next);
  return next;
}

async function delivered<I, S extends Message>(
  storage: AgentExecutionStorage<I, S>,
  key: AgentInvocationKey,
  prior: AgentExecutionRecord,
): Promise<void> {
  const prepared = clone(AgentExecutionRecordSchema, prior);
  const outgoing = required(prepared.completion?.outgoing[0]);
  outgoing.plan = create(AgentSavedDispatchPlanSchema);
  await storage.update({
    key,
    token: "conformance-token",
    expectedRecordBytes: toBinary(AgentExecutionRecordSchema, prior),
    next: prepared,
  });
  expect(await storage.read(key)).toEqual(prepared);
  const changedPlan = clone(AgentExecutionRecordSchema, prepared);
  required(required(changedPlan.completion).outgoing[0]).plan = create(
    AgentSavedDispatchPlanSchema,
    { targets: [] },
  );
  required(required(changedPlan.completion).outgoing[0]).delivered = true;
  await expect(
    storage.update({
      key,
      token: "conformance-token",
      expectedRecordBytes: toBinary(AgentExecutionRecordSchema, prepared),
      next: changedPlan,
    }),
  ).rejects.toThrow(/immutable|one-time|delivered/i);
  expect(await storage.read(key)).toEqual(prepared);
  const event = outgoing.signal.case === "event" ? outgoing.signal.value : undefined;
  const signal = create(AgentSignalKeySchema, {
    id: { case: "event", value: required(event?.id) },
  });
  await expect(
    storage.markDelivered(key, "conformance-token", new Uint8Array(), [signal]),
  ).rejects.toThrow(/changed|expected|stale|image|current/i);
  expect(await storage.read(key)).toEqual(prepared);
  await storage.markDelivered(
    key,
    "conformance-token",
    toBinary(AgentExecutionRecordSchema, prepared),
    [signal],
  );
  expect((await storage.read(key))?.status).toBe(AgentInvocationStatus.AGENT_INVOCATION_COMPLETED);
}
