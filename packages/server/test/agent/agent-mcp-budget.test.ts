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
  return { budget, record: () => record, withProposal, historyWrites, controller };
}

function protocol(record: AgentExecutionRecord): AgentProtocolEvidence {
  const evidence = record.journal[0]?.evidence;
  if (evidence?.case !== "protocol") throw new Error("Expected a protocol reservation.");
  return evidence.value;
}

describe("Agent MCP protocol budget", () => {
  it("rejects invalid physical bounds and a call without an intent before journaling", async () => {
    const { budget, record } = fixture();
    const setup = {
      phase: "setup" as const,
      method: "initialize",
      inputBytes: 1,
      maxOutputBytes: 1,
    };
    await expect(budget.reserveMessage(" ", setup)).rejects.toThrow("nonblank");
    await expect(budget.reserveMessage("lookup", { ...setup, method: " " })).rejects.toThrow(
      "nonblank",
    );
    await expect(budget.reserveMessage("lookup", { ...setup, inputBytes: -1 })).rejects.toThrow(
      "bounds",
    );
    await expect(budget.reserveMessage("lookup", { ...setup, maxOutputBytes: 0 })).rejects.toThrow(
      "bounds",
    );
    await expect(
      budget.reserveMessage("lookup", { ...setup, toolCallId: "unexpected" }),
    ).rejects.toThrow("intent");
    await expect(budget.reserveMessage("lookup", { ...setup, phase: "call" })).rejects.toThrow(
      "intent",
    );
    expect(record().journal).toHaveLength(0);
  });

  it("rejects a receipt that disagrees with observed bytes and preserves credit", async () => {
    const { budget, record } = fixture();
    const ticket = await budget.reserveMessage("lookup", {
      phase: "setup",
      method: "initialize",
      inputBytes: 1,
      maxOutputBytes: 5,
    });
    expect(() => {
      budget.onReceived(ticket.id, -1);
    }).toThrow("invalid");
    budget.onReceived(ticket.id, 2);
    await expect(budget.finishMessage(ticket.id, 3)).rejects.toThrow("disagree");
    expect(protocol(record()).settled).toBe(false);
    await budget.finishMessage(ticket.id, 2);
    expect(protocol(record()).receivedBytes).toBe(2n);
    await expect(budget.finishMessage(ticket.id, 2)).rejects.toThrow("settled");
  });

  it("rejects an invalid complete receipt while retaining the original reservation", async () => {
    const { budget, record } = fixture();
    const ticket = await budget.reserveMessage("lookup", {
      phase: "setup",
      method: "initialize",
      inputBytes: 1,
      maxOutputBytes: 5,
    });
    await expect(budget.finishMessage(ticket.id, -1)).rejects.toThrow("reserved bytes");
    await expect(budget.finishMessage(ticket.id, 6)).rejects.toThrow("reserved bytes");
    expect(protocol(record()).settled).toBe(false);
    await budget.finishMessage(ticket.id, 0);
    expect(protocol(record()).receivedBytes).toBe(0n);
  });

  it("checks invocation recovery and provider transaction capacity before setup sends", async () => {
    const tooSmall = fixture();
    const bounds = tooSmall.record().started?.bounds;
    if (bounds === undefined) throw new Error("Expected invocation bounds.");
    bounds.maxRecoveryBytes = 1n;
    const setup = {
      phase: "setup" as const,
      method: "initialize",
      inputBytes: 1,
      maxOutputBytes: 1,
    };
    await expect(tooSmall.budget.reserveMessage("lookup", setup)).rejects.toThrow("recovery bytes");
    expect(tooSmall.record().journal).toHaveLength(0);

    const transaction = fixture(12n, 10n, { transactionPayloadBytes: 1 });
    await expect(transaction.budget.reserveMessage("lookup", setup)).rejects.toThrow(
      "transaction payload",
    );
    expect(transaction.record().journal).toHaveLength(0);
  });

  it("rejects unknown physical tickets and input credit exhaustion", async () => {
    const { budget, record } = fixture(1n, 10n);
    expect(() => {
      budget.onReceived("unknown", 1);
    }).toThrow("unknown");
    await expect(budget.finishMessage("unknown", 1)).rejects.toThrow("unknown");
    await budget.reserveMessage("lookup", {
      phase: "setup",
      method: "initialize",
      inputBytes: 1,
      maxOutputBytes: 1,
    });
    await expect(
      budget.reserveMessage("lookup", {
        phase: "setup",
        method: "tools/list",
        inputBytes: 1,
        maxOutputBytes: 1,
      }),
    ).rejects.toMatchObject({ reason: "TOOL_BUDGET_EXCEEDED" });
    expect(record().journal).toHaveLength(1);
  });

  it("rejects missing proposals and unspecified tool effects without writing history", async () => {
    const { budget, record, withProposal, historyWrites } = fixture();
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
    await expect(budget.journalToolIntent(invocation, request, 1)).rejects.toThrow("proposal");
    withProposal();
    await expect(
      budget.journalToolIntent({ ...invocation, providerCallId: "other" }, request, 1),
    ).rejects.toThrow("proposal");
    await expect(
      budget.journalToolIntent(
        invocation,
        { ...request, effect: ToolEffect.TOOL_EFFECT_UNSPECIFIED },
        1,
      ),
    ).rejects.toThrow("effect");
    expect(record().journal).toHaveLength(1);
    expect(historyWrites).toHaveLength(0);
  });

  it("enforces both operation and invocation tool counts before another intent", async () => {
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
      effect: ToolEffect.READ,
    };
    await expect(budget.journalToolIntent(invocation, request, 0)).rejects.toMatchObject({
      reason: "TOOL_BUDGET_EXCEEDED",
    });
    const first = await budget.journalToolIntent(invocation, request, 1);
    expect(first.kind).toBe("new");
    const proposal = record().journal[0];
    if (
      proposal?.evidence.case !== "attempt" ||
      proposal.evidence.value.response.case !== "generationResponse"
    )
      throw new Error("Expected generation proposal.");
    const proposedCall = proposal.evidence.value.response.value.toolCalls[0];
    if (proposedCall === undefined) throw new Error("Expected a saved tool proposal.");
    proposedCall.providerCallId = "provider-2";
    await expect(
      budget.journalToolIntent({ ...invocation, providerCallId: "provider-2" }, request, 2),
    ).rejects.toMatchObject({ reason: "TOOL_BUDGET_EXCEEDED" });
    expect(record().journal.filter((entry) => entry.evidence.case === "tool")).toHaveLength(1);
    expect(historyWrites).toHaveLength(1);
  });

  it("rejects changed recovered tool policy before any second history row", async () => {
    const { budget, withProposal, historyWrites } = fixture();
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
    await budget.journalToolIntent(invocation, request, 1);
    for (const changed of [
      { ...request, server: create(McpServerIdSchema, { value: "other" }) },
      { ...request, tool: create(McpToolNameSchema, { value: "other" }) },
      { ...request, effect: ToolEffect.READ },
    ]) {
      await expect(budget.journalToolIntent(invocation, changed, 1)).rejects.toMatchObject({
        reason: "REPLAY_DIVERGENCE",
      });
    }
    expect(historyWrites).toHaveLength(1);
  });

  it("rejects premature or repeated tool completion without changing its saved response", async () => {
    const { budget, record, withProposal } = fixture();
    withProposal();
    const first = await budget.journalToolIntent(
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
        effect: ToolEffect.READ,
      },
      1,
    );
    if (first.kind !== "new") throw new Error("Expected a tool intent.");
    await expect(
      budget.finishTool(
        first.callId,
        create(ToolResponseSchema, {
          call: { value: "other" },
          outcome: AiOutcome.ADMITTED,
        }),
        [],
      ),
    ).rejects.toThrow("pending intent");
    const response = create(ToolResponseSchema, {
      call: { value: first.callId },
      outcome: AiOutcome.ADMITTED,
    });
    await budget.finishTool(first.callId, response, []);
    await expect(budget.finishTool(first.callId, response, [])).rejects.toThrow("pending intent");
    await expect(budget.markToolDispatched(first.callId)).rejects.toThrow("completed");
    expect(record().journal.filter((entry) => entry.evidence.case === "tool")).toHaveLength(1);
  });

  it("allows one physical write reservation and refuses a repeated send", async () => {
    const { budget, record, withProposal } = fixture(20n, 10n);
    withProposal();
    const first = await budget.journalToolIntent(
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
    );
    if (first.kind !== "new") throw new Error("Expected saved write intent.");
    await budget.markToolDispatched(first.callId);
    const request = {
      phase: "call" as const,
      method: "tools/call",
      toolCallId: first.callId,
      inputBytes: 1,
      maxOutputBytes: 2,
    };
    await budget.reserveMessage("lookup", request);
    await expect(budget.reserveMessage("lookup", request)).rejects.toThrow(
      "already has a physical reservation",
    );
    expect(record().journal.filter((entry) => entry.evidence.case === "protocol")).toHaveLength(1);
  });

  it("rejects dispatch marking for an unknown logical tool call", async () => {
    const { budget, record } = fixture();
    await expect(budget.markToolDispatched("unknown")).rejects.toThrow("call ID is unknown");
    expect(record().journal).toHaveLength(0);
  });

  it("reuses one dispatched read intent after recovery but reserves a fresh physical send", async () => {
    const { budget, record, withProposal } = fixture(20n, 10n);
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
      effect: ToolEffect.READ,
    };
    const first = await budget.journalToolIntent(invocation, request, 1);
    if (first.kind !== "new") throw new Error("Expected a read intent.");
    await budget.markToolDispatched(first.callId);
    const send = (callId: string) =>
      budget.reserveMessage("lookup", {
        phase: "call",
        method: "tools/call",
        toolCallId: callId,
        inputBytes: 1,
        maxOutputBytes: 2,
      });
    const original = await send(first.callId);
    await budget.finishMessage(original.id);
    const recovered = await budget.journalToolIntent(invocation, request, 1);
    expect(recovered).toEqual(first);
    if (recovered.kind !== "new") throw new Error("Expected the saved read intent.");
    const retried = await send(recovered.callId);
    expect(retried.id).not.toBe(original.id);
    expect(record().journal.filter((entry) => entry.evidence.case === "tool")).toHaveLength(1);
    expect(record().journal.filter((entry) => entry.evidence.case === "protocol")).toHaveLength(2);
  });

  it("rejects changed recovered tool arguments before another send or history row", async () => {
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
    await budget.journalToolIntent(invocation, request, 1);
    await expect(
      budget.journalToolIntent(invocation, { ...request, argumentsJson: '{"changed":true}' }, 1),
    ).rejects.toMatchObject({ reason: "REPLAY_DIVERGENCE" });
    expect(record().journal.filter((entry) => entry.evidence.case === "tool")).toHaveLength(1);
    expect(historyWrites).toHaveLength(1);
  });

  it("does not reserve a physical message after the handler loses authority", async () => {
    const { budget, record, controller } = fixture();
    controller.abort();
    await expect(
      budget.reserveMessage("lookup", {
        phase: "setup",
        method: "initialize",
        inputBytes: 1,
        maxOutputBytes: 1,
      }),
    ).rejects.toThrow("deadline expired");
    expect(record().journal).toHaveLength(0);
  });

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

  it("classifies exhausted physical-message credit before another send", async () => {
    const { budget, record } = fixture(20n, 7n);
    await budget.reserveMessage("lookup", {
      phase: "setup",
      method: "initialize",
      inputBytes: 1,
      maxOutputBytes: 7,
    });
    await expect(
      budget.reserveMessage("lookup", {
        phase: "setup",
        method: "tools/list",
        inputBytes: 1,
        maxOutputBytes: 1,
      }),
    ).rejects.toMatchObject({ reason: "TOOL_BUDGET_EXCEEDED" });
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
