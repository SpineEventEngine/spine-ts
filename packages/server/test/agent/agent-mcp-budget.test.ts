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

import { clone, create } from "@bufbuild/protobuf";
import { AnyMessages, Time } from "@spine-event-engine/core";
import {
  AiAttemptIdSchema,
  AiOperationIdSchema,
  AiOutcome,
  ConversationIdSchema,
  GenerationResponseSchema,
  McpServerIdSchema,
  McpToolNameSchema,
  ToolEffect,
  ToolRequestSchema,
  ToolResponseSchema,
} from "@spine-event-engine/proto/agent";
import {
  AgentAcceptedInvocationSchema,
  AgentAttemptEvidenceSchema,
  AgentExecutionJournalEntrySchema,
  AgentExecutionRecordSchema,
  AgentExecutionScopeSchema,
  AgentExecutionStartSchema,
  AgentInvocationKeySchema,
  AgentInvocationBoundsSchema,
  AgentNamedOperationSchema,
  type AgentExecutionRecord,
  type AgentProtocolEvidence,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import type { AgentExecutionCapacity } from "@spine-event-engine/storage/provider";
import { AgentExecutionSizes } from "@spine-event-engine/storage/provider";
import { describe, expect, it } from "vitest";
import { AgentMcpBudget } from "../../src/agent/agent-mcp-budget.js";

function fixture(input = 12n, output = 10n, capacity: AgentExecutionCapacity = {}) {
  let record = create(AgentExecutionRecordSchema, {
    accepted: create(AgentAcceptedInvocationSchema, {
      key: create(AgentInvocationKeySchema, {
        scope: create(AgentExecutionScopeSchema, { stateType: "support.Agent", agentKey: "A" }),
      }),
    }),
    started: create(AgentExecutionStartSchema, {
      bounds: create(AgentInvocationBoundsSchema, {
        totalInputBytes: input,
        totalOutputBytes: output,
        toolCalls: 1n,
        maxRecoveryBytes: 10_000n,
      }),
    }),
  });
  const operation = create(AgentNamedOperationSchema, {
    operation: create(AiOperationIdSchema, { value: "draft" }),
    conversation: create(ConversationIdSchema, { value: "conversation-1" }),
  });
  const controller = new AbortController();
  const historyWrites: import("@spine-event-engine/proto/agent").AgentHistoryEntry[] = [];
  const session = {
    signal: controller.signal,
    record: () => clone(AgentExecutionRecordSchema, record),
    update: (
      change: (current: AgentExecutionRecord) => AgentExecutionRecord,
      history: readonly import("@spine-event-engine/proto/agent").AgentHistoryEntry[] = [],
    ) => {
      record = change(clone(AgentExecutionRecordSchema, record));
      historyWrites.push(...history);
      return Promise.resolve(clone(AgentExecutionRecordSchema, record));
    },
    capacity: () => capacity,
    preferences: () => [],
  };
  const budget = new AgentMcpBudget(
    session,
    operation,
    Time.currentTimeMillis() + 10_000,
    undefined,
  );
  const withProposal = () => {
    record.journal.push(
      create(AgentExecutionJournalEntrySchema, {
        ordinal: 0n,
        evidence: {
          case: "attempt",
          value: create(AgentAttemptEvidenceSchema, {
            operation: operation.operation,
            attempt: create(AiAttemptIdSchema, { value: "attempt-1" }),
            response: {
              case: "generationResponse",
              value: create(GenerationResponseSchema, {
                outcome: AiOutcome.TOOL_REQUESTED,
                toolCalls: [
                  { providerCallId: "provider-1", toolName: "tool_0", argumentsJson: "{}" },
                ],
              }),
            },
          }),
        },
      }),
    );
  };
  return { budget, record: () => record, withProposal, historyWrites };
}

function protocol(record: AgentExecutionRecord): AgentProtocolEvidence {
  const evidence = record.journal[0]?.evidence;
  if (evidence?.case !== "protocol") throw new Error("Expected a protocol reservation.");
  return evidence.value;
}

describe("Agent MCP protocol budget", () => {
  it("persists setup credit before send and rejects a crossing response chunk", async () => {
    const { budget, record } = fixture();
    const ticket = await budget.reserveMessage("lookup", {
      phase: "setup",
      method: "initialize",
      inputBytes: 5,
      maxOutputBytes: 7,
    });
    expect(protocol(record()).inputBytes).toBe(5n);
    budget.onReceived(ticket.id, 4);
    expect(() => {
      budget.onReceived(ticket.id, 4);
    }).toThrow("reserved");
    await budget.finishMessage(ticket.id, 4);
    expect(protocol(record()).receivedBytes).toBe(4n);
    expect(protocol(record()).settled).toBe(true);
    expect(() => {
      budget.onReceived(ticket.id, 1);
    }).toThrow("settled");
  });

  it("retains unknown full credit and shares it with the next reservation", async () => {
    const { budget, record } = fixture();
    const ticket = await budget.reserveMessage("lookup", {
      phase: "setup",
      method: "initialize",
      inputBytes: 5,
      maxOutputBytes: 7,
    });
    budget.onReceived(ticket.id, 2);
    await budget.finishMessage(ticket.id);
    expect(protocol(record()).receivedBytes).toBeUndefined();
    await expect(
      budget.reserveMessage("lookup", {
        phase: "setup",
        method: "tools/list",
        inputBytes: 1,
        maxOutputBytes: 4,
      }),
    ).rejects.toThrow("output byte credit");
    expect(record().journal).toHaveLength(1);
  });

  it("charges a persisted known receipt instead of its old response allowance", async () => {
    const { budget, record } = fixture();
    const first = await budget.reserveMessage("lookup", {
      phase: "setup",
      method: "initialize",
      inputBytes: 1,
      maxOutputBytes: 7,
    });
    budget.onReceived(first.id, 2);
    await budget.finishMessage(first.id, 2);
    const second = await budget.reserveMessage("lookup", {
      phase: "setup",
      method: "tools/list",
      inputBytes: 1,
      maxOutputBytes: 4,
    });
    expect(second.id).toBeTruthy();
    expect(record().journal).toHaveLength(2);
  });

  it("rejects a call-phase send without its dispatched durable intent", async () => {
    const { budget, record } = fixture();
    await expect(
      budget.reserveMessage("lookup", {
        phase: "call",
        method: "tools/call",
        inputBytes: 1,
        maxOutputBytes: 2,
        toolCallId: "missing",
      }),
    ).rejects.toThrow("intent");
    expect(record().journal).toHaveLength(0);
  });

  it("never resends a dispatched write intent", async () => {
    const { budget, record, withProposal, historyWrites } = fixture();
    withProposal();
    const invocation = {
      ticketId: "attempt-1",
      providerCallId: "provider-1",
      server: "lookup",
      tool: "save",
      argumentsJson: "{}",
    };
    const request = {
      server: create(McpServerIdSchema, { value: "lookup" }),
      tool: create(McpToolNameSchema, { value: "save" }),
      argumentsJson: "{}",
      effect: ToolEffect.WRITE,
    };
    const first = await budget.journalToolIntent(invocation, request, 1);
    if (first.kind !== "new") throw new Error("Expected a new tool intent.");
    const written = historyWrites[0];
    if (written?.item.case !== "conversationRecord" || written.item.value.content === undefined)
      throw new Error("Expected a saved tool request conversation row.");
    expect(AnyMessages.unpack(written.item.value.content, ToolRequestSchema)?.call?.value).toBe(
      first.callId,
    );
    await budget.markToolDispatched(first.callId);
    const uncertain = await budget.journalToolIntent(invocation, request, 1);
    expect(uncertain.kind).toBe("unknown");
    const tool = record().journal.find((entry) => entry.evidence.case === "tool")?.evidence;
    if (tool?.case !== "tool") throw new Error("Expected a saved tool intent.");
    expect(tool.value.outcomeUnknown).toBe(true);
    expect(record().journal).toHaveLength(2);
    await expect(
      budget.finishTool(
        first.callId,
        create(ToolResponseSchema, {
          call: { value: first.callId },
          outcome: AiOutcome.ADMITTED,
          text: ["saved"],
        }),
        [],
      ),
    ).rejects.toThrow("unknown");
  });

  it("reuses a completed tool result without a second intent", async () => {
    const { budget, record, withProposal } = fixture();
    withProposal();
    const invocation = {
      ticketId: "attempt-1",
      providerCallId: "provider-1",
      server: "lookup",
      tool: "save",
      argumentsJson: "{}",
    };
    const request = {
      server: create(McpServerIdSchema, { value: "lookup" }),
      tool: create(McpToolNameSchema, { value: "save" }),
      argumentsJson: "{}",
      effect: ToolEffect.WRITE,
    };
    const first = await budget.journalToolIntent(invocation, request, 1);
    if (first.kind !== "new") throw new Error("Expected a new tool intent.");
    await budget.markToolDispatched(first.callId);
    await budget.finishTool(
      first.callId,
      create(ToolResponseSchema, {
        call: { value: first.callId },
        outcome: AiOutcome.ADMITTED,
        text: ["saved"],
      }),
      [],
    );
    const replay = await budget.journalToolIntent(invocation, request, 1);
    expect(replay.kind).toBe("replay");
    expect(record().journal).toHaveLength(2);
  });

  it("rejects a tool intent whose mandatory history exceeds provider capacity", async () => {
    const { budget, record, withProposal } = fixture(12n, 10n, { historyRecordBytes: 32 });
    withProposal();
    await expect(
      budget.journalToolIntent(
        {
          ticketId: "attempt-1",
          providerCallId: "provider-1",
          server: "lookup",
          tool: "save",
          argumentsJson: "{}",
        },
        {
          server: create(McpServerIdSchema, { value: "lookup" }),
          tool: create(McpToolNameSchema, { value: "save" }),
          argumentsJson: "{}",
          effect: ToolEffect.WRITE,
        },
        1,
      ),
    ).rejects.toThrow("history");
    expect(record().journal).toHaveLength(1);
  });

  it("rejects unjournalable full tool credit before a physical call", async () => {
    const limits = { executionRecordBytes: 10_000 };
    const { budget, record, withProposal } = fixture(2000n, 2000n, limits);
    withProposal();
    const invocation = {
      ticketId: "attempt-1",
      providerCallId: "provider-1",
      server: "lookup",
      tool: "save",
      argumentsJson: "{}",
    };
    const first = await budget.journalToolIntent(
      invocation,
      {
        server: create(McpServerIdSchema, { value: "lookup" }),
        tool: create(McpToolNameSchema, { value: "save" }),
        argumentsJson: "{}",
        effect: ToolEffect.WRITE,
      },
      1,
    );
    if (first.kind !== "new") throw new Error("Expected a new tool intent.");
    await budget.markToolDispatched(first.callId);
    limits.executionRecordBytes = AgentExecutionSizes.record(record()) + 250;
    await expect(
      budget.reserveMessage("lookup", {
        phase: "call",
        method: "tools/call",
        toolCallId: first.callId,
        inputBytes: 10,
        maxOutputBytes: 400,
      }),
    ).rejects.toThrow(/provider.*record/);
    expect(record().journal).toHaveLength(2);
  });

  it("checks the provider execution head before reserving a physical MCP send", async () => {
    const { budget, record } = fixture(100n, 100n, { executionHeadBytes: 1 });
    await expect(
      budget.reserveMessage("lookup", {
        phase: "setup",
        method: "initialize",
        inputBytes: 5,
        maxOutputBytes: 7,
      }),
    ).rejects.toThrow("head");
    expect(record().journal).toHaveLength(0);
  });
});
