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
import { createHash } from "node:crypto";
import { AiRegistry, Mcp } from "@spine-event-engine/ai";
import {
  McpServerIdSchema,
  McpToolNameSchema,
  ToolEffect,
  AiOperationIdSchema,
  ConversationIdSchema,
} from "@spine-event-engine/proto/agent";
import { describe, expect, it, vi } from "vitest";
import { AgentLiveBudget } from "../../src/agent/agent-live-budget.js";
import { AgentLiveMcpControls } from "../../src/agent/agent-live-mcp-controls.js";
import { AgentLiveMcpRuntime } from "../../src/agent/agent-live-mcp-runtime.js";
import type { AgentLiveAiAudit } from "../../src/agent/agent-live-ai-audit.js";

describe("live MCP controls", () => {
  it("reserves shared credit and tool count before asynchronous audit or dispatch", async () => {
    const auditGate = Promise.withResolvers<undefined>();
    const audit = {
      toolStarted: vi.fn(() => auditGate.promise),
      toolFinished: vi.fn(() => Promise.resolve()),
    } as unknown as AgentLiveAiAudit;
    const budget = new AgentLiveBudget({ toolCalls: 1, totalInputBytes: 30, totalOutputBytes: 20 });
    const controls = new AgentLiveMcpControls({
      scope: {} as never,
      registry: AiRegistry.create({ defaultModels: {} }),
      backend: {} as never,
      operation: {
        operation: create(AiOperationIdSchema, { value: "operation-1" }),
        conversation: create(ConversationIdSchema, { value: "conversation-1" }),
      },
      signal: new AbortController().signal,
      budget,
      audit,
      maxToolCalls: 1,
      onProposal: vi.fn(),
    });
    const call = {
      ticketId: "attempt-1",
      server: "knowledge",
      tool: "lookup",
      argumentsJson: "{}",
      providerCallId: "proposal-1",
    };
    const facts = {
      server: create(McpServerIdSchema, { value: "knowledge" }),
      tool: create(McpToolNameSchema, { value: "lookup" }),
      argumentsJson: "{}",
      effect: ToolEffect.READ,
    };
    const pending = controls.admitTool(call, facts);
    await expect(
      controls.admitTool({ ...call, providerCallId: "proposal-2" }, facts),
    ).rejects.toThrow("tool call budget");
    auditGate.resolve(undefined);
    const id = await pending;
    controls.markToolDispatched(id);
    expect(() => {
      controls.markToolDispatched(id);
    }).toThrow("already dispatched");
    const ticket = await controls.reserveMessage("knowledge", {
      phase: "call",
      method: "tools/call",
      toolCallId: id,
      inputBytes: 10,
      maxOutputBytes: 18,
    });
    expect(ticket.maxOutputBytes).toBe(18);
    controls.onReceived(ticket.id, 6);
    await controls.finishMessage(ticket.id, 6);
    expect(
      (
        await controls.reserveMessage("knowledge", {
          phase: "setup",
          method: "initialize",
          inputBytes: 5,
          maxOutputBytes: 18,
        })
      ).maxOutputBytes,
    ).toBe(14);
  });

  it("dispatches one accepted proposal through the selected protocol and persists its result", async () => {
    const protocol = {
      identity: {
        serverId: "knowledge",
        revision: "v1",
        endpoint: `sha256:${createHash("sha256").update("https://knowledge.test/mcp").digest("hex")}`,
      },
      discover: vi.fn(() =>
        Promise.resolve([
          { name: "lookup", description: "Find ticket", inputSchemaJson: '{"type":"object"}' },
        ]),
      ),
      validateArguments: vi.fn(),
      call: vi.fn(() =>
        Promise.resolve({
          content: [{ kind: "text" as const, text: "Found" }],
          isError: false,
        }),
      ),
      close: vi.fn(() => Promise.resolve()),
    };
    const registry = AiRegistry.create({ defaultModels: {} }).registerTools(
      Mcp.server({
        id: "knowledge",
        revision: "v1",
        authorizeConnect: () => true,
        transport: { kind: "streamable-http", url: "https://knowledge.test/mcp" },
        tools: {
          lookup: {
            effect: "read",
            timeoutMs: 1_000,
            maxArgumentBytes: 128,
            maxResultBytes: 128,
            authorize: () => true,
          },
        },
      }),
    );
    const toolStarted = vi.fn(() => Promise.resolve());
    const toolFinished = vi.fn(() => Promise.resolve());
    const audit = { toolStarted, toolFinished } as unknown as AgentLiveAiAudit;
    const controls = new AgentLiveMcpControls({
      scope: {} as never,
      registry,
      backend: { mcp: { connect: () => Promise.resolve(protocol) } } as never,
      operation: {
        operation: create(AiOperationIdSchema, { value: "operation-1" }),
        conversation: create(ConversationIdSchema, { value: "conversation-1" }),
      },
      signal: new AbortController().signal,
      budget: new AgentLiveBudget({ toolCalls: 1, totalInputBytes: 100, totalOutputBytes: 100 }),
      audit,
      maxToolCalls: 1,
      onProposal: (invocation) => {
        if (invocation.providerCallId !== "proposal-1") throw new Error("Unmatched proposal.");
      },
    });
    const runtime = new AgentLiveMcpRuntime(controls, [{ server: "knowledge", tool: "lookup" }]);
    const catalog = await runtime.prepare();
    expect(catalog).toHaveLength(1);
    const invocation = {
      ticketId: "attempt-1",
      server: "knowledge",
      tool: "lookup",
      argumentsJson: "{}",
      providerCallId: "proposal-1",
    };
    await expect(runtime.call(invocation)).resolves.toMatchObject({ text: ["Found"] });
    expect(protocol.call).toHaveBeenCalledTimes(1);
    expect(toolStarted).toHaveBeenCalledTimes(1);
    expect(toolFinished).toHaveBeenCalledTimes(1);
    await runtime.close();
    expect(protocol.close).toHaveBeenCalledTimes(1);
  });

  it("closes every connected server when a later discovery omits a configured tool", async () => {
    const locations = ["knowledge", "actions"] as const;
    const sessions = locations.map((id) => ({
      identity: {
        serverId: id,
        revision: "v1",
        endpoint: `sha256:${createHash("sha256").update(`https://${id}.test/mcp`).digest("hex")}`,
      },
      discover: vi.fn(() =>
        Promise.resolve(
          id === "knowledge"
            ? [{ name: "lookup", description: "Find ticket", inputSchemaJson: "{}" }]
            : [],
        ),
      ),
      validateArguments: vi.fn(),
      call: vi.fn(),
      close: vi.fn(() => Promise.resolve()),
    }));
    const registry = AiRegistry.create({ defaultModels: {} });
    for (const id of locations)
      registry.registerTools(
        Mcp.server({
          id,
          revision: "v1",
          authorizeConnect: () => true,
          transport: { kind: "streamable-http", url: `https://${id}.test/mcp` },
          tools: {
            [id === "knowledge" ? "lookup" : "submit"]: {
              effect: id === "knowledge" ? "read" : "write",
              timeoutMs: 1_000,
              maxArgumentBytes: 128,
              maxResultBytes: 128,
              authorize: () => true,
            },
          },
        }),
      );
    const connect = vi.fn(({ server }: { server: { id: string } }) =>
      Promise.resolve(sessions.find((session) => session.identity.serverId === server.id)),
    );
    const controls = new AgentLiveMcpControls({
      scope: {} as never,
      registry,
      backend: { mcp: { connect } } as never,
      operation: {
        operation: create(AiOperationIdSchema, { value: "operation-2" }),
        conversation: create(ConversationIdSchema, { value: "conversation-2" }),
      },
      signal: new AbortController().signal,
      budget: new AgentLiveBudget({ toolCalls: 2, totalInputBytes: 100, totalOutputBytes: 100 }),
      audit: { toolStarted: vi.fn(), toolFinished: vi.fn() } as unknown as AgentLiveAiAudit,
      maxToolCalls: 2,
      onProposal: vi.fn(),
    });
    const runtime = new AgentLiveMcpRuntime(controls, [
      { server: "knowledge", tool: "lookup" },
      { server: "actions", tool: "submit" },
    ]);

    await expect(runtime.prepare()).rejects.toMatchObject({ code: "UNSUPPORTED_CAPABILITY" });
    expect(connect).toHaveBeenCalledTimes(2);
    expect(sessions[0]?.close).toHaveBeenCalledTimes(1);
    expect(sessions[1]?.close).toHaveBeenCalledTimes(1);
    expect(sessions.flatMap((session) => session.call.mock.calls)).toEqual([]);
    await expect(runtime.prepare()).rejects.toThrow("closed");
    await runtime.close();
  });
});
