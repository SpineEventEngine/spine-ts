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

import { create, isMessage } from "@bufbuild/protobuf";
import { createHash } from "node:crypto";
import { AiModel, AiRegistry, Mcp, ModelRef } from "@spine-event-engine/ai";
import {
  createBackendRegistration,
  type AiBackendExecution,
  type AiMcpProtocolControl,
} from "@spine-event-engine/ai/spi/adapter";
import { AnyPacker, SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { ActorContextSchema, CommandIdSchema, MessageIdSchema } from "@spine-event-engine/proto";
import {
  AiModelKind,
  ConversationIdSchema,
  GenerationResponseSchema,
  AiOutcome,
  GenerationRequestSchema,
  AiContentDigestSchema,
  AiDiagnosticIdSchema,
  ModelToolCallSchema,
  AgentToolCallFinishedSchema,
  AgentModelAttemptStartedSchema,
  ToolResponseSchema,
  type AgentHistoryEntry,
  type ToolResponse,
} from "@spine-event-engine/proto/agent";
import type { AgentHistoryStorage } from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";
import { AgentLiveAiRuntime } from "../../src/agent/agent-live-ai-runtime.js";
import { AgentLiveBudget } from "../../src/agent/agent-live-budget.js";
import { AgentLiveAudit } from "../../src/agent/agent-live-audit.js";
import { SignalMetadata } from "../../src/runtime/signal-metadata.js";
import { AgentModelSelection } from "../../src/agent/agent-model-selection.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
} from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import { DraftSupportReplySchema } from "../../test-fixtures/generated/entity-metadata/support_agent_commands_pb.js";
import {
  ProposedSupportReplySchema,
  SupportTicketFactsSchema,
  SupportTicketNumberSchema,
} from "../../test-fixtures/generated/entity-metadata/support_ai_types_pb.js";

const model = AiModel.define({
  name: "live-support",
  version: "v1",
  kind: "generation",
  input: SupportTicketFactsSchema,
  output: ProposedSupportReplySchema,
  instructions: "Draft a support reply.",
  outputMode: "prompt-and-validate",
  limits: { modelRequests: 1, toolCalls: 0, maxInputBytes: 1_024, maxOutputBytes: 1_024 },
});
const ref = ModelRef.of("live-support-backend", "v1");

describe("live Agent AI execution", () => {
  it("executes the same named call anew for two accepted signals and enforces physical credit", async () => {
    const physicalRequests = vi.fn();
    const execute = vi.fn(async (execution: AiBackendExecution) => {
      if (!isMessage(execution.input, SupportTicketFactsSchema))
        throw new TypeError("Expected support ticket facts.");
      const request = await execution.control.beginAttempt({
        kind: "generation",
        content: create(GenerationRequestSchema, {
          input: AnyPacker.pack(SupportTicketFactsSchema, execution.input),
          instructions: "Draft a support reply.",
          outputSchemaJson: "{}",
          promptJson: "{}",
          digest: create(AiContentDigestSchema, { value: "a".repeat(64) }),
        }),
      });
      physicalRequests();
      await execution.control.reserveTransport(request.id, 20, 80);
      execution.control.onReceived(request.id, 24);
      if (execution.input.customerQuestion === "Unavailable") {
        const failure = await execution.control.recordFailure("UNAVAILABLE", true);
        await execution.control.finishAttempt({
          ticketId: request.id,
          receivedBytes: 24,
          response: create(GenerationResponseSchema, {
            outcome: AiOutcome.FAILED,
            diagnosticId: create(AiDiagnosticIdSchema, { value: failure.diagnosticId }),
          }),
        });
        return { ok: false as const, failure };
      }
      await execution.control.finishAttempt({
        ticketId: request.id,
        receivedBytes: 24,
        response: create(GenerationResponseSchema, { outcome: AiOutcome.ADMITTED }),
      });
      return {
        ok: true as const,
        value: create(ProposedSupportReplySchema, { replyText: "Ready" }),
      };
    });
    const registry = AiRegistry.create({ defaultModels: { generation: ref } });
    registry.register(
      createBackendRegistration({
        ref,
        kind: "generation",
        supports: () => true,
        resolveIdentity: () => ({
          provider: "test",
          account: "support",
          endpoint: "local",
          model: "v1",
        }),
        authorizeUse: () => true,
        connect: (_scope, identity) => ({ model: {}, identity }),
        execute,
      }),
    );
    const scope = {
      actor: create(ActorContextSchema),
      tenant: { kind: "single-tenant" as const },
      agent: create(MessageIdSchema, {
        id: AnyPacker.pack(
          SupportReplyAgentIdSchema,
          create(SupportReplyAgentIdSchema, { ticketNumber: "T-live" }),
        ),
        typeUrl: TypeUrls.derive(SupportReplyAgentIdSchema),
      }),
      source: create(MessageIdSchema, {
        id: AnyPacker.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "source-live" })),
        typeUrl: TypeUrls.derive(DraftSupportReplySchema),
      }),
    };
    const selected = await AgentModelSelection.selectLiveKind(
      registry,
      { models: [model] },
      scope,
      [],
      new AbortController().signal,
      undefined,
      "generation",
    );
    const input = create(SupportTicketFactsSchema, {
      ticketNumber: create(SupportTicketNumberSchema, { value: "T-live" }),
      customerQuestion: "Help?",
    });
    const request = {
      call: "draft",
      conversation: create(ConversationIdSchema, { value: "support" }),
      input,
    };
    const metadata = new SignalMetadata({
      timeProvider: {
        currentTime: () => create(TimestampSchema, { seconds: 1_800_300_000n }),
      },
    });
    const agentId = create(SupportReplyAgentIdSchema, { ticketNumber: "T-live" });
    const source = SignalEnvelopes.command({
      schema: DraftSupportReplySchema,
      message: create(DraftSupportReplySchema, { agent: agentId, question: "Help?" }),
      context: metadata.commandContext({}),
    });
    const written: string[] = [];
    const auditFailure = new Error("attempt start history unavailable");
    let rejectAttemptStart = false;
    const history = {
      capacity: {},
      appendAll: (_id: unknown, entries: readonly AgentHistoryEntry[]) => {
        if (
          rejectAttemptStart &&
          entries.some(
            (entry) =>
              entry.item.case === "systemEvent" &&
              entry.item.value.message?.typeUrl === TypeUrls.derive(AgentModelAttemptStartedSchema),
          )
        )
          return Promise.reject(auditFailure);
        written.push(...entries.map((entry) => entry.item.case ?? ""));
        return Promise.resolve();
      },
    } as unknown as AgentHistoryStorage<unknown>;
    const audit = new AgentLiveAudit(
      {
        source: { case: "command", value: source },
        recipientId: AnyPacker.pack(SupportReplyAgentIdSchema, agentId),
        stateType: SupportReplyAgentStateSchema.typeName,
      },
      SupportReplyAgentStateSchema,
      agentId,
      "T-live",
      history,
      metadata,
      () => undefined,
      () => Promise.resolve(),
    );
    const make = () =>
      new AgentLiveAiRuntime(
        registry,
        { models: [model] },
        scope,
        new Map([[AiModelKind.GENERATION, selected]]),
        new AgentLiveBudget({ modelRequests: 1, totalOutputBytes: 80 }),
        new AbortController().signal,
        undefined,
        () => undefined,
        audit,
      );
    const first = make();
    await expect(first.invoke(model, request)).resolves.toMatchObject({ ok: true });
    first.finish();
    first.close();
    const second = make();
    await expect(second.invoke(model, request)).resolves.toMatchObject({ ok: true });
    const failed = make();
    await expect(
      failed.invoke(model, {
        ...request,
        input: create(SupportTicketFactsSchema, { ...input, customerQuestion: "Unavailable" }),
      }),
    ).resolves.toMatchObject({ ok: false, failure: { code: "UNAVAILABLE" } });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(physicalRequests).toHaveBeenCalledTimes(3);
    expect(written.filter((kind) => kind === "systemEvent")).toHaveLength(12);
    expect(written.filter((kind) => kind === "conversationRecord")).toHaveLength(6);

    rejectAttemptStart = true;
    await expect(make().invoke(model, request)).rejects.toBe(auditFailure);
    expect(execute).toHaveBeenCalledTimes(4);
    expect(physicalRequests).toHaveBeenCalledTimes(3);
  });

  it("connects only a completed model proposal to the configured MCP tool", async () => {
    const mcpModel = AiModel.define({
      name: "live-support-mcp",
      version: "v1",
      kind: "generation",
      input: SupportTicketFactsSchema,
      output: ProposedSupportReplySchema,
      instructions: "Draft a support reply with the knowledge tool.",
      outputMode: "prompt-and-validate",
      tools: [{ server: "knowledge", tool: "lookup" }],
      limits: { modelRequests: 1, toolCalls: 1, maxInputBytes: 1_024, maxOutputBytes: 1_024 },
    });
    const protocol = {
      identity: {
        serverId: "knowledge",
        revision: "v1",
        endpoint: `sha256:${createHash("sha256").update("https://knowledge.test/mcp").digest("hex")}`,
      },
      discover: () =>
        Promise.resolve([
          { name: "lookup", description: "Find ticket", inputSchemaJson: '{"type":"object"}' },
        ]),
      validateArguments: () => undefined,
      call: vi.fn(() =>
        Promise.resolve({
          content: [{ kind: "text" as const, text: "Found" }],
          isError: false,
        }),
      ),
      close: () => Promise.resolve(),
    };
    const execute = vi.fn(async (execution: AiBackendExecution) => {
      expect(execution.advertisedTools).toHaveLength(1);
      const attempt = await execution.control.beginAttempt({
        kind: "generation",
        content: create(GenerationRequestSchema, {
          input: AnyPacker.pack(SupportTicketFactsSchema, execution.input as never),
          instructions: "Draft",
          outputSchemaJson: "{}",
          promptJson: "{}",
          digest: create(AiContentDigestSchema, { value: "a".repeat(64) }),
        }),
      });
      await execution.control.reserveTransport(attempt.id, 20, 80);
      const proposal = create(ModelToolCallSchema, {
        providerCallId: "proposal-1",
        toolName: "tool_0",
        argumentsJson: "{}",
      });
      await execution.control.finishAttempt({
        ticketId: attempt.id,
        receivedBytes: 10,
        response: create(GenerationResponseSchema, {
          outcome: AiOutcome.TOOL_REQUESTED,
          toolCalls: [proposal],
        }),
      });
      const call = {
        ticketId: attempt.id,
        server: "knowledge",
        tool: "lookup",
        providerToolName: "tool_0",
        argumentsJson: "{}",
        providerCallId: "proposal-1",
      };
      await expect(
        execution.control.callTool({ ...call, providerCallId: "absent" }),
      ).rejects.toThrow("absent from the completed model response");
      await expect(
        execution.control.callTool({ ...call, providerToolName: "tool_1" }),
      ).rejects.toThrow("absent from the completed model response");
      await expect(
        execution.control.callTool({ ...call, argumentsJson: '{"other":1}' }),
      ).rejects.toThrow("absent from the completed model response");
      await expect(execution.control.callTool({ ...call, tool: "other" })).resolves.toMatchObject({
        outcome: AiOutcome.FAILED,
      });
      await expect(execution.control.callTool(call)).resolves.toMatchObject({ text: ["Found"] });
      return {
        ok: true as const,
        value: create(ProposedSupportReplySchema, { replyText: "Ready" }),
      };
    });
    const registry = AiRegistry.create({ defaultModels: { generation: ref } });
    registry.registerTools(
      Mcp.server({
        id: "knowledge",
        revision: "v1",
        transport: { kind: "streamable-http", url: "https://knowledge.test/mcp" },
        authorizeConnect: () => true,
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
    registry.register(
      createBackendRegistration({
        ref,
        kind: "generation",
        supports: () => true,
        resolveIdentity: () => ({
          provider: "test",
          account: "support",
          endpoint: "local",
          model: "v1",
        }),
        authorizeUse: () => true,
        connect: (_scope, identity) => ({ model: {}, identity }),
        execute,
        mcp: { connect: () => Promise.resolve(protocol) },
      }),
    );
    const scope = {
      actor: create(ActorContextSchema),
      tenant: { kind: "single-tenant" as const },
      agent: create(MessageIdSchema, {
        id: AnyPacker.pack(
          SupportReplyAgentIdSchema,
          create(SupportReplyAgentIdSchema, { ticketNumber: "T-live" }),
        ),
        typeUrl: TypeUrls.derive(SupportReplyAgentIdSchema),
      }),
      source: create(MessageIdSchema, {
        id: AnyPacker.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "source-live" })),
        typeUrl: TypeUrls.derive(DraftSupportReplySchema),
      }),
    };
    const selected = await AgentModelSelection.selectLiveKind(
      registry,
      { models: [mcpModel] },
      scope,
      [],
      new AbortController().signal,
      undefined,
      "generation",
    );
    const metadata = new SignalMetadata({
      timeProvider: {
        currentTime: () => create(TimestampSchema, { seconds: 1_800_300_000n }),
      },
    });
    const agentId = create(SupportReplyAgentIdSchema, { ticketNumber: "T-live" });
    const source = SignalEnvelopes.command({
      schema: DraftSupportReplySchema,
      message: create(DraftSupportReplySchema, { agent: agentId, question: "Help?" }),
      context: metadata.commandContext({}),
    });
    const saved = vi.fn(() => Promise.resolve());
    const history = { capacity: {}, appendAll: saved } as unknown as AgentHistoryStorage<unknown>;
    const audit = new AgentLiveAudit(
      {
        source: { case: "command", value: source },
        recipientId: AnyPacker.pack(SupportReplyAgentIdSchema, agentId),
        stateType: SupportReplyAgentStateSchema.typeName,
      },
      SupportReplyAgentStateSchema,
      agentId,
      "T-live",
      history,
      metadata,
      () => undefined,
      () => Promise.resolve(),
    );
    const runtime = new AgentLiveAiRuntime(
      registry,
      { models: [mcpModel] },
      scope,
      new Map([[AiModelKind.GENERATION, selected]]),
      new AgentLiveBudget({ modelRequests: 1, toolCalls: 1, totalOutputBytes: 1_024 }),
      new AbortController().signal,
      undefined,
      () => undefined,
      audit,
    );
    await expect(
      runtime.invoke(mcpModel, {
        call: "draft",
        conversation: create(ConversationIdSchema, { value: "support" }),
        input: create(SupportTicketFactsSchema, {
          ticketNumber: create(SupportTicketNumberSchema, { value: "T-live" }),
          customerQuestion: "Help?",
        }),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(protocol.call).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalled();
  });

  it("persists failed read and uncertain write tool outcomes without dispatching either again", async () => {
    const toolModel = AiModel.define({
      name: "live-support-failed-tools",
      version: "v1",
      kind: "generation",
      input: SupportTicketFactsSchema,
      output: ProposedSupportReplySchema,
      instructions: "Use the configured support tools.",
      outputMode: "prompt-and-validate",
      tools: [
        { server: "knowledge", tool: "lookup" },
        { server: "knowledge", tool: "submit" },
      ],
      limits: { modelRequests: 1, toolCalls: 2, maxInputBytes: 1_024, maxOutputBytes: 1_024 },
    });
    let protocolControl: AiMcpProtocolControl | undefined;
    const protocol = {
      identity: {
        serverId: "knowledge",
        revision: "v1",
        endpoint: `sha256:${createHash("sha256").update("https://knowledge.test/mcp").digest("hex")}`,
      },
      discover: () =>
        Promise.resolve([
          { name: "lookup", description: "Read ticket", inputSchemaJson: "{}" },
          { name: "submit", description: "Submit reply", inputSchemaJson: "{}" },
        ]),
      validateArguments: () => undefined,
      call: vi.fn(async (_tool: string, _args: string, send: { toolCallId: string }) => {
        if (protocolControl === undefined) throw new Error("MCP control was not connected.");
        await protocolControl.reserveMessage({
          phase: "call",
          method: "tools/call",
          toolCallId: send.toolCallId,
          inputBytes: 1,
          maxOutputBytes: 20,
        });
        throw new Error("Provider detail must not become a successful tool result.");
      }),
      close: vi.fn(() => Promise.resolve()),
    };
    const results: ToolResponse[] = [];
    const execute = vi.fn(async (execution: AiBackendExecution) => {
      expect(execution.advertisedTools).toHaveLength(2);
      const attempt = await execution.control.beginAttempt({
        kind: "generation",
        content: create(GenerationRequestSchema, {
          input: AnyPacker.pack(SupportTicketFactsSchema, execution.input as never),
          instructions: "Use tools",
          outputSchemaJson: "{}",
          promptJson: "{}",
          digest: create(AiContentDigestSchema, { value: "b".repeat(64) }),
        }),
      });
      await execution.control.reserveTransport(attempt.id, 20, 80);
      await execution.control.finishAttempt({
        ticketId: attempt.id,
        receivedBytes: 10,
        response: create(GenerationResponseSchema, {
          outcome: AiOutcome.TOOL_REQUESTED,
          toolCalls: [
            create(ModelToolCallSchema, {
              providerCallId: "read-1",
              toolName: "tool_0",
              argumentsJson: "{}",
            }),
            create(ModelToolCallSchema, {
              providerCallId: "write-1",
              toolName: "tool_1",
              argumentsJson: "{}",
            }),
          ],
        }),
      });
      for (const [tool, providerToolName, providerCallId] of [
        ["lookup", "tool_0", "read-1"],
        ["submit", "tool_1", "write-1"],
      ] as const)
        results.push(
          await execution.control.callTool({
            ticketId: attempt.id,
            server: "knowledge",
            tool,
            providerToolName,
            argumentsJson: "{}",
            providerCallId,
          }),
        );
      return {
        ok: true as const,
        value: create(ProposedSupportReplySchema, { replyText: "Ready" }),
      };
    });
    const registry = AiRegistry.create({ defaultModels: { generation: ref } });
    registry.registerTools(
      Mcp.server({
        id: "knowledge",
        revision: "v1",
        transport: { kind: "streamable-http", url: "https://knowledge.test/mcp" },
        authorizeConnect: () => true,
        tools: {
          lookup: {
            effect: "read",
            timeoutMs: 1_000,
            maxArgumentBytes: 128,
            maxResultBytes: 20,
            authorize: () => true,
          },
          submit: {
            effect: "write",
            timeoutMs: 1_000,
            maxArgumentBytes: 128,
            maxResultBytes: 20,
            authorize: () => true,
          },
        },
      }),
    );
    registry.register(
      createBackendRegistration({
        ref,
        kind: "generation",
        supports: () => true,
        resolveIdentity: () => ({
          provider: "test",
          account: "support",
          endpoint: "local",
          model: "v1",
        }),
        authorizeUse: () => true,
        connect: (_scope, identity) => ({ model: {}, identity }),
        execute,
        mcp: {
          connect: ({ control }) => {
            protocolControl = control;
            return Promise.resolve(protocol);
          },
        },
      }),
    );
    const agentId = create(SupportReplyAgentIdSchema, { ticketNumber: "T-failed-tools" });
    const scope = {
      actor: create(ActorContextSchema),
      tenant: { kind: "single-tenant" as const },
      agent: create(MessageIdSchema, {
        id: AnyPacker.pack(SupportReplyAgentIdSchema, agentId),
        typeUrl: TypeUrls.derive(SupportReplyAgentIdSchema),
      }),
      source: create(MessageIdSchema, {
        id: AnyPacker.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "source-tools" })),
        typeUrl: TypeUrls.derive(DraftSupportReplySchema),
      }),
    };
    const selected = await AgentModelSelection.selectLiveKind(
      registry,
      { models: [toolModel] },
      scope,
      [],
      new AbortController().signal,
      undefined,
      "generation",
    );
    const metadata = new SignalMetadata({
      timeProvider: { currentTime: () => create(TimestampSchema, { seconds: 1_800_300_000n }) },
    });
    const source = SignalEnvelopes.command({
      schema: DraftSupportReplySchema,
      message: create(DraftSupportReplySchema, { agent: agentId, question: "Help?" }),
      context: metadata.commandContext({}),
    });
    const saved: AgentHistoryEntry[] = [];
    const history = {
      capacity: {},
      appendAll: (_id: unknown, entries: readonly AgentHistoryEntry[]) => {
        saved.push(...entries);
        return Promise.resolve();
      },
    } as unknown as AgentHistoryStorage<unknown>;
    const audit = new AgentLiveAudit(
      {
        source: { case: "command", value: source },
        recipientId: AnyPacker.pack(SupportReplyAgentIdSchema, agentId),
        stateType: SupportReplyAgentStateSchema.typeName,
      },
      SupportReplyAgentStateSchema,
      agentId,
      "T-failed-tools",
      history,
      metadata,
      () => undefined,
      () => Promise.resolve(),
    );
    const budget = new AgentLiveBudget({
      modelRequests: 1,
      toolCalls: 2,
      totalOutputBytes: 130,
    });
    const runtime = new AgentLiveAiRuntime(
      registry,
      { models: [toolModel] },
      scope,
      new Map([[AiModelKind.GENERATION, selected]]),
      budget,
      new AbortController().signal,
      undefined,
      () => undefined,
      audit,
    );
    await expect(
      runtime.invoke(toolModel, {
        call: "draft",
        conversation: create(ConversationIdSchema, { value: "support" }),
        input: create(SupportTicketFactsSchema, {
          ticketNumber: create(SupportTicketNumberSchema, { value: "T-failed-tools" }),
          customerQuestion: "Help?",
        }),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(results.map((result) => result.outcome)).toEqual([AiOutcome.FAILED, AiOutcome.UNKNOWN]);
    expect(results.every((result) => result.diagnosticId?.value)).toBe(true);
    expect(protocol.call).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(protocol.close).toHaveBeenCalledTimes(1);
    const finished = saved
      .flatMap((entry) =>
        entry.item.case === "systemEvent"
          ? [AnyPacker.tryUnpack(entry.item.value.message, AgentToolCallFinishedSchema)]
          : [],
      )
      .filter((event) => event !== undefined);
    expect(finished.map((event) => event.outcome)).toEqual([AiOutcome.FAILED, AiOutcome.UNKNOWN]);
    const responses = saved
      .flatMap((entry) =>
        entry.item.case === "conversationRecord"
          ? [AnyPacker.tryUnpack(entry.item.value.content, ToolResponseSchema)]
          : [],
      )
      .filter((response) => response !== undefined);
    expect(responses.map((response) => response.outcome)).toEqual([
      AiOutcome.FAILED,
      AiOutcome.UNKNOWN,
    ]);
    expect(budget.reservePhysical(1, 81, "protocol").maxOutputBytes).toBe(80);
  });
});
