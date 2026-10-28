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

import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AnyPacker, SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import { CommandIdSchema, MessageIdSchema, type Event } from "@spine-event-engine/proto";
import {
  AgentHistoryEntrySchema,
  AgentModelSelectionChangedSchema,
  AgentInvocationTerminatedSchema,
  AiModelKind,
  ModelRefSchema,
} from "@spine-event-engine/proto/agent";
import type { AgentHistoryEntry } from "@spine-event-engine/proto/agent";
import type { AgentHistoryStorage } from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";
import { AgentLiveAudit } from "../../src/agent/agent-live-audit.js";
import { AgentLiveInteractionEvents } from "../../src/agent/agent-live-interaction-events.js";
import { SignalMetadata } from "../../src/runtime/signal-metadata.js";
import { DraftSupportReplySchema } from "../../test-fixtures/generated/entity-metadata/support_agent_commands_pb.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
} from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";

const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-audit" });
const recipient = AnyPacker.pack(SupportReplyAgentIdSchema, id);
const metadata = new SignalMetadata({
  timeProvider: { currentTime: () => create(TimestampSchema, { seconds: 1_800_200_000n }) },
});
const source = SignalEnvelopes.command({
  schema: DraftSupportReplySchema,
  message: create(DraftSupportReplySchema, { agent: id, question: "Audit?" }),
  context: metadata.commandContext({}),
});
const invocation = {
  source: { case: "command" as const, value: source },
  recipientId: recipient,
  stateType: SupportReplyAgentStateSchema.typeName,
};
const payload = create(AgentModelSelectionChangedSchema, {
  agent: create(MessageIdSchema, {
    id: recipient,
    typeUrl: TypeUrls.derive(SupportReplyAgentStateSchema),
  }),
  sourceSignal: create(MessageIdSchema, {
    id: AnyPacker.pack(CommandIdSchema, source.id ?? create(CommandIdSchema)),
    typeUrl: TypeUrls.derive(DraftSupportReplySchema),
  }),
  kind: AiModelKind.GENERATION,
  selectedModel: create(ModelRefSchema, { name: { value: "support" }, revision: { value: "v1" } }),
  changedAt: create(TimestampSchema, { seconds: 1_800_200_000n }),
});

describe("live Agent audit", () => {
  it("saves conversation and original System row atomically before publishing", async () => {
    const order: string[] = [];
    const appendAll = vi.fn((_id: string, rows: readonly AgentHistoryEntry[]) => {
      expect(rows).toHaveLength(2);
      expect(rows[1]?.item.case).toBe("systemEvent");
      order.push("append");
      return Promise.resolve();
    });
    const history = { capacity: {}, appendAll } as unknown as AgentHistoryStorage<string>;
    const published: Event[] = [];
    const audit = new AgentLiveAudit(
      invocation,
      SupportReplyAgentStateSchema,
      "T-audit",
      "T-audit",
      history,
      metadata,
      () => {
        order.push("register");
      },
      (event) => {
        published.push(event);
        order.push("publish");
        return Promise.resolve();
      },
    );
    const earlier = create(AgentHistoryEntrySchema, {
      occurredAt: payload.changedAt,
      item: {
        case: "systemEvent",
        value: AgentLiveInteractionEvents.envelope(
          invocation,
          metadata,
          recipient,
          AgentModelSelectionChangedSchema,
          payload,
        ),
      },
    });
    await audit.save(AgentModelSelectionChangedSchema, payload, [earlier]);
    expect(order).toEqual(["register", "append", "publish"]);
    expect(published).toHaveLength(1);
    const saved = appendAll.mock.calls[0]?.[1][1];
    expect(saved?.item.case === "systemEvent" ? saved.item.value : undefined).toBe(published[0]);
  });

  it("does not publish when the atomic history group rejects", async () => {
    const history = {
      capacity: {},
      appendAll: () => Promise.reject(new Error("history failed")),
    } as unknown as AgentHistoryStorage<string>;
    const publish = vi.fn(() => Promise.resolve());
    const audit = new AgentLiveAudit(
      invocation,
      SupportReplyAgentStateSchema,
      "T-audit",
      "T-audit",
      history,
      metadata,
      () => undefined,
      publish,
    );
    await expect(audit.save(AgentModelSelectionChangedSchema, payload)).rejects.toThrow(
      "history failed",
    );
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not append a termination fact after its live session is lost", async () => {
    const appendAll = vi.fn(() => Promise.resolve());
    const history = { capacity: {}, appendAll } as unknown as AgentHistoryStorage<string>;
    const publish = vi.fn(() => Promise.resolve());
    const lost = new Error("session lost");
    const audit = new AgentLiveAudit(
      invocation,
      SupportReplyAgentStateSchema,
      "T-audit",
      "T-audit",
      history,
      metadata,
      () => undefined,
      publish,
      () => Promise.reject(lost),
    );
    await expect(audit.save(AgentModelSelectionChangedSchema, payload)).rejects.toBe(lost);
    expect(appendAll).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("retains the committed audit fact when System publication fails", async () => {
    const retained: AgentHistoryEntry[] = [];
    const history = {
      capacity: {},
      appendAll: (_id: string, entries: readonly AgentHistoryEntry[]) => {
        retained.push(...entries);
        return Promise.resolve();
      },
    } as unknown as AgentHistoryStorage<string>;
    const failed = new Error("System publication failed");
    const audit = new AgentLiveAudit(
      invocation,
      SupportReplyAgentStateSchema,
      "T-audit",
      "T-audit",
      history,
      metadata,
      () => undefined,
      () => Promise.reject(failed),
    );
    await expect(audit.save(AgentModelSelectionChangedSchema, payload)).rejects.toBe(failed);
    expect(retained).toHaveLength(1);
    expect(retained[0]?.item.case).toBe("systemEvent");
  });

  it.each(["append", "publish"])("preserves model denial when audit %s fails", async (phase) => {
    const failure = new Error(`${phase} failed`);
    const appendAll = vi.fn(() =>
      phase === "append" ? Promise.reject(failure) : Promise.resolve(),
    );
    const history = { capacity: {}, appendAll } as unknown as AgentHistoryStorage<string>;
    const denial = new Error("Selected model use denied");
    const audit = new AgentLiveAudit(
      invocation,
      SupportReplyAgentStateSchema,
      "T-audit",
      "T-audit",
      history,
      metadata,
      () => undefined,
      () => (phase === "publish" ? Promise.reject(failure) : Promise.resolve()),
    );
    const fact = create(AgentInvocationTerminatedSchema, {
      agent: payload.agent,
      sourceSignal: payload.sourceSignal,
      reason: "MODEL_USE_DENIED",
      terminatedAt: payload.changedAt,
    });
    await expect(audit.saveDenial(fact, denial)).rejects.toMatchObject({
      errors: [denial, failure],
    });
    expect(appendAll).toHaveBeenCalledOnce();
  });
});
