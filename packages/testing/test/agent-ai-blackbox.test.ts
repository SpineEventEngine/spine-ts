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

import { create, equals, type Message } from "@bufbuild/protobuf";
import { createHash } from "node:crypto";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AiModel, AiRegistry, Mcp, ModelRef } from "@spine-event-engine/ai";
import {
  createBackendRegistration,
  type AiMcpProtocolControl,
} from "@spine-event-engine/ai/spi/adapter";
import { AnyMessages, EntityQuery, Time } from "@spine-event-engine/core";
import { EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import { QuerySchema } from "@spine-event-engine/proto/client";
import {
  AgentHistoryCursorSchema,
  AgentAiOperationStartedSchema,
  AgentModelAttemptStartedSchema,
  AgentModelAttemptFinishedSchema,
  AgentAiResultAdmittedSchema,
  AgentAiOperationFailedSchema,
  AgentToolCallStartedSchema,
  AgentToolCallFinishedSchema,
  AgentModelSelectionChangedSchema,
  AgentInvocationTerminatedSchema,
  AiContentDigestSchema,
  AiModelKind,
  AiOutcome,
  ConversationIdSchema,
  GenerationRequestSchema,
  GenerationResponseSchema,
  ToolRequestSchema,
  ToolResponseSchema,
  type AgentHistoryEntry,
} from "@spine-event-engine/proto/agent";
import {
  Aggregate,
  Agent,
  BoundedContext,
  EntityHandlers,
  Projection,
  Repository,
} from "@spine-event-engine/server";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { agentHistoryView } from "@spine-event-engine/server/testing";
import type {
  AgentExecutionCapacity,
  AgentExecutionStorage,
  AgentExecutionStorageInput,
} from "@spine-event-engine/storage/provider";
// prettier-ignore
import {
  AgentProjectionReadResultSchema,
  AgentInvocationStatus,
  type AgentExecutionRecord,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { describe, expect, it } from "vitest";
import { AiTestBackend, BlackBox } from "../src/index.js";
import { HandlerMetadataValues } from "../../server/dist/handler/handler-metadata.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
  type SupportReplyAgentId,
} from "../test-fixtures/generated/support_agent_states_pb.js";
import {
  DraftSupportReplySchema,
  type DraftSupportReply,
} from "../test-fixtures/generated/support_agent_commands_pb.js";
import {
  SupportReplyDraftFailedSchema,
  SupportReplyProposedSchema,
} from "../test-fixtures/generated/support_agent_events_pb.js";
import {
  ProposedSupportReplySchema,
  SupportReplyFactsSchema,
} from "../test-fixtures/generated/support_ai_types_pb.js";
import {
  ProjectCreatedSchema,
  type ProjectCreated,
} from "../test-fixtures/generated/project_events_pb.js";
import {
  CreateProjectSchema,
  type CreateProject,
} from "../test-fixtures/generated/project_commands_pb.js";
import {
  ProjectOverviewSchema,
  ProjectSchema,
} from "../test-fixtures/generated/project_states_pb.js";

const proposal = AiModel.define({
  name: "draft-support-reply",
  version: "v1",
  kind: "generation",
  input: SupportReplyFactsSchema,
  output: ProposedSupportReplySchema,
  instructions: "Draft a reply for human review.",
  outputMode: "prompt-and-validate",
  limits: {
    modelRequests: 1,
    toolCalls: 0,
    deadlineMs: 1000,
    maxInputBytes: 4000,
    maxOutputBytes: 4000,
    maxOutputTokens: 100,
  },
});

const toolProposal = AiModel.define({
  name: "draft-support-reply-with-lookup",
  version: "v1",
  kind: "generation",
  input: SupportReplyFactsSchema,
  output: ProposedSupportReplySchema,
  instructions: "Draft a reply after looking up the ticket.",
  outputMode: "prompt-and-validate",
  tools: [{ server: "knowledge", tool: "lookup" }],
  limits: {
    modelRequests: 2,
    toolCalls: 1,
    deadlineMs: 2_000,
    maxInputBytes: 4_000,
    maxOutputBytes: 4_000,
    maxOutputTokens: 100,
  },
});
const alternateRef = ModelRef.of("support-alternate", "v1");

class DraftingAgent extends Agent<SupportReplyAgentId, typeof SupportReplyAgentStateSchema> {
  static calls = 0;
  static failure: unknown;
  static admitted = 0;
  static historyReadCount = 0;
  static projectionReadCount = 0;

  async draft(command: DraftSupportReply) {
    DraftingAgent.calls++;
    if (command.agent === undefined) throw new Error("Draft requires a ticket Agent ID.");
    if (command.question === "Throw transient") throw new Error("temporary handler failure");
    if (command.question === "Inspect history") {
      const page = await this.fullHistory({ pageSize: 2 });
      DraftingAgent.historyReadCount = page.items.length;
    }
    if (command.question === "Inspect projection") {
      const query = EntityQuery.describe({
        schema: ProjectOverviewSchema,
        columns: {},
        idField: "id",
      })
        .byId("project-1")
        .build();
      const states = await this.select(query).read();
      DraftingAgent.projectionReadCount = states.length;
    }
    if (command.question === "Prefer alternate") {
      try {
        this.ai.select(AiModelKind.GENERATION, alternateRef);
      } catch (error) {
        DraftingAgent.failure = error;
        throw error;
      }
    }
    const model = command.question === "Use knowledge" ? toolProposal : proposal;
    const invoke = (call: string) =>
      this.ai
        .invoke(model, {
          call,
          conversation: create(ConversationIdSchema, { value: "ticket-conversation" }),
          input: create(SupportReplyFactsSchema, {
            ticketNumber: command.agent?.ticketNumber ?? "",
            question: command.question,
            ticketRevision: 1n,
          }),
        })
        .catch((error: unknown) => {
          DraftingAgent.failure = error;
          throw error;
        });
    if (command.question === "Two sequential") await invoke("first");
    const result = await invoke(command.question === "Two sequential" ? "second" : "draft");
    if (!result.ok)
      return create(SupportReplyDraftFailedSchema, {
        agent: this.id,
        reasonCode: result.failure.code,
      });
    DraftingAgent.admitted++;
    this.update((state) =>
      Object.assign(state, {
        id: this.id,
        proposedReply: result.value.reply,
      }),
    );
    return create(SupportReplyProposedSchema, {
      agent: this.id,
      reply: result.value.reply,
    });
  }
}

class ProjectOverview extends Projection<string, typeof ProjectOverviewSchema> {
  static applied = 0;

  projectCreated(event: ProjectCreated): void {
    this.update((state) =>
      Object.assign(state, {
        id: event.id,
        name: event.name,
        priority: event.priority,
      }),
    );
    ProjectOverview.applied++;
  }
}

class ProjectAggregate extends Aggregate<string, typeof ProjectSchema> {
  registerProject(command: CreateProject): ProjectCreated {
    this.update((state) => Object.assign(state, { id: command.id, name: command.name }));
    return create(ProjectCreatedSchema, {
      id: command.id,
      name: command.name,
      priority: 1,
    });
  }
}

class RecordingExecutionFactory extends InMemoryStorageFactory {
  readLast?: () => Promise<AgentExecutionRecord | undefined>;
  readonly historyWrites: AgentHistoryEntry[] = [];

  constructor(private readonly limits: AgentExecutionCapacity = {}) {
    super();
  }

  protected override createAgentExecutionStorage<I, S extends Message>(
    input: AgentExecutionStorageInput<I, S>,
  ): AgentExecutionStorage<I, S> {
    const storage = super.createAgentExecutionStorage(input);
    Object.defineProperty(storage, "capacity", { value: this.limits });
    const admit = storage.admit.bind(storage);
    const update = storage.update.bind(storage);
    storage.update = async (input) => {
      await update(input);
      this.historyWrites.push(...(input.historyEntries ?? []));
    };
    storage.admit = async (accepted) => {
      const record = await admit(accepted);
      const key = accepted.key;
      if (key !== undefined) this.readLast = () => storage.read(key);
      return record;
    };
    return storage;
  }
}

function draftingRepository() {
  return new Repository({
    entityType: DraftingAgent,
    schema: SupportReplyAgentStateSchema,
    agentCodeRevision: "drafting-v1",
    ai: { models: [proposal, toolProposal] },
    handlers: HandlerMetadataValues.defineArity(
      DraftingAgent,
      SupportReplyAgentStateSchema,
      (builder) => [builder.assign(DraftSupportReplySchema, "draft")],
      [
        {
          kind: "command-assignment",
          methodName: "draft",
          parameterCount: 1,
          origin: "domestic",
          outcomes: {
            returned: [SupportReplyProposedSchema, SupportReplyDraftFailedSchema],
            thrown: [],
          },
        },
      ],
    ),
    events: [SupportReplyProposedSchema, SupportReplyDraftFailedSchema],
  });
}

async function configuredBox(
  backend: AiTestBackend,
  limits: AgentExecutionCapacity = {},
  alternate?: AiTestBackend,
  projection = false,
  sequential = false,
  recoveryBytes = 24_000,
) {
  let registry = AiRegistry.create({
    defaultModels: { generation: backend.registration.ref },
    invocationLimits: {
      operations: sequential ? 2 : 1,
      modelRequests: sequential ? 2 : 1,
      toolCalls: 0,
      recordedReads: 1,
      deadlineMs: 1000,
      totalInputBytes: 8000,
      totalOutputBytes: 8000,
      maxRecoveryBytes: recoveryBytes,
    },
    concurrentOperations: 1,
    queuedOperations: 0,
  }).register(backend.registration);
  if (alternate !== undefined) registry = registry.register(alternate.registration);
  const factory = new RecordingExecutionFactory(limits);
  const repository = draftingRepository();
  const builder = BoundedContext.singleTenant("AiSupport")
    .withAi(registry)
    .persistSystemEvents()
    .withStorageFactory(factory)
    .add(repository);
  if (projection) {
    builder.add(
      new Repository({
        entityType: ProjectAggregate,
        schema: ProjectSchema,
        handlers: HandlerMetadataValues.defineArity(
          ProjectAggregate,
          ProjectSchema,
          (handlers) => [handlers.assign(CreateProjectSchema, "registerProject")],
          [
            {
              kind: "command-assignment",
              methodName: "registerProject",
              parameterCount: 1,
              origin: "domestic",
              outcomes: { returned: [ProjectCreatedSchema], thrown: [] },
            },
          ],
        ),
        events: [ProjectCreatedSchema],
      }),
    );
    builder.add(
      new Repository({
        entityType: ProjectOverview,
        schema: ProjectOverviewSchema,
        handlers: EntityHandlers.define(ProjectOverview, ProjectOverviewSchema, (handlers) => [
          handlers.subscribe(ProjectCreatedSchema, "projectCreated"),
        ]),
      }),
    );
  }
  const context = builder.build();
  const blackBox = await BlackBox.from(context);
  return { blackBox, context, factory, repository };
}

async function postDraft(blackBox: BlackBox) {
  const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-47" });
  return blackBox
    .asGuest()
    .post(
      DraftSupportReplySchema,
      create(DraftSupportReplySchema, { agent: id, question: "Where is my order?" }),
    );
}

async function configuredToolBox(closeFailure?: "throw" | "never") {
  const sequence: string[] = [];
  const endpoint = "https://knowledge.test/mcp";
  let protocolControl: AiMcpProtocolControl | undefined;
  const protocol = {
    identity: {
      serverId: "knowledge",
      revision: "v1",
      endpoint: `sha256:${createHash("sha256").update(endpoint).digest("hex")}`,
    },
    discover: () =>
      Promise.resolve([
        { name: "lookup", description: "Look up a ticket", inputSchemaJson: '{"type":"object"}' },
      ]),
    validateArguments: (_name: string, argumentsJson: string) => {
      const parsed: unknown = JSON.parse(argumentsJson);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
        throw new TypeError("Tool arguments must be an object.");
    },
    call: async (_name: string, _arguments: string, call: { toolCallId: string }) => {
      if (protocolControl === undefined) throw new Error("Protocol control was not connected.");
      const ticket = await protocolControl.reserveMessage({
        phase: "call",
        method: "tools/call",
        toolCallId: call.toolCallId,
        inputBytes: 20,
        maxOutputBytes: 256,
      });
      protocolControl.onReceived(ticket.id, 20);
      await protocolControl.finishMessage(ticket.id, 20);
      sequence.push("tool-call");
      return { content: [{ kind: "text" as const, text: "Ticket found" }], isError: false };
    },
    close: () => {
      if (closeFailure === "throw") return Promise.reject(new Error("private cleanup detail"));
      if (closeFailure === "never") return new Promise<void>(() => undefined);
      return Promise.resolve();
    },
  };
  const registration = createBackendRegistration({
    ref: ModelRef.of("tool-scripted", "v1"),
    kind: "generation",
    supports: () => true,
    resolveIdentity: () => ({
      provider: "fixture",
      account: "support",
      endpoint: "local",
      model: "tool-scripted",
    }),
    authorizeUse: () => true,
    connect: (_scope, identity) => ({ model: {}, identity }),
    mcp: {
      connect: async ({ control }) => {
        protocolControl = control;
        const ticket = await control.reserveMessage({
          phase: "setup",
          method: "initialize",
          inputBytes: 12,
          maxOutputBytes: 256,
        });
        control.onReceived(ticket.id, 12);
        await control.finishMessage(ticket.id, 12);
        return protocol;
      },
    },
    execute: async (execution) => {
      if (execution.definition.kind !== "generation")
        throw new Error("The fixture only supports generation.");
      const prepared = create(GenerationRequestSchema, {
        input: AnyMessages.pack(execution.definition.input, execution.input),
        instructions: execution.definition.instructions,
        outputSchemaJson: "{}",
        promptJson: JSON.stringify({ tools: execution.advertisedTools }),
        digest: create(AiContentDigestSchema, { value: "0".repeat(64) }),
      });
      const first = await execution.control.beginAttempt({ kind: "generation", content: prepared });
      if ("kind" in first) throw new Error("Unexpected saved model replay in fresh fixture.");
      await execution.control.reserveTransport(first.id, 128, 1024);
      await execution.control.finishAttempt({
        ticketId: first.id,
        receivedBytes: 64,
        response: create(GenerationResponseSchema, {
          outcome: AiOutcome.TOOL_REQUESTED,
          toolCalls: [{ providerCallId: "model-call-1", toolName: "tool_0", argumentsJson: "{}" }],
        }),
      });
      sequence.push("model-proposal");
      const tool = await execution.control.callTool({
        ticketId: first.id,
        providerCallId: "model-call-1",
        server: "knowledge",
        tool: "lookup",
        argumentsJson: "{}",
      });
      if (tool.outcome !== AiOutcome.ADMITTED) throw new Error("Tool was not admitted.");
      const second = await execution.control.beginAttempt({
        kind: "generation",
        content: prepared,
      });
      if ("kind" in second) throw new Error("Unexpected saved model replay in fresh fixture.");
      await execution.control.reserveTransport(second.id, 128, 1024);
      const output = create(ProposedSupportReplySchema, { reply: "Ticket found; we can help." });
      await execution.control.finishAttempt({
        ticketId: second.id,
        receivedBytes: 64,
        response: create(GenerationResponseSchema, {
          rawOutput: '{"reply":"Ticket found; we can help."}',
          outcome: AiOutcome.ADMITTED,
          admittedOutput: AnyMessages.pack(ProposedSupportReplySchema, output),
        }),
      });
      return { ok: true as const, value: output };
    },
  });
  const tools = Mcp.server({
    id: "knowledge",
    revision: "v1",
    transport: { kind: "streamable-http", url: endpoint },
    authorizeConnect: () => true,
    tools: {
      lookup: {
        effect: "read",
        timeoutMs: 1_000,
        maxArgumentBytes: 256,
        maxResultBytes: 1_024,
        authorize: () => true,
      },
    },
  });
  const registry = AiRegistry.create({
    defaultModels: { generation: registration.ref },
    invocationLimits: {
      operations: 1,
      modelRequests: 2,
      toolCalls: 1,
      recordedReads: 0,
      deadlineMs: 3_000,
      totalInputBytes: 16_384,
      totalOutputBytes: 16_384,
      maxRecoveryBytes: 32_768,
    },
    concurrentOperations: 1,
    queuedOperations: 0,
  })
    .register(registration)
    .registerTools(tools);
  const factory = new RecordingExecutionFactory();
  const repository = draftingRepository();
  const context = BoundedContext.singleTenant("AiToolSupport")
    .withAi(registry)
    .persistSystemEvents()
    .withStorageFactory(factory)
    .add(repository)
    .build();
  return {
    blackBox: await BlackBox.from(context, { timeoutMs: 5_000 }),
    factory,
    repository,
    sequence,
  };
}

describe("Agent scripted execution through BlackBox", () => {
  it("keeps a saved result when MCP cleanup fails and records a safe diagnostic", async () => {
    const { blackBox, factory } = await configuredToolBox("throw");
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-47" });
    try {
      const posted = await blackBox
        .asGuest()
        .post(
          DraftSupportReplySchema,
          create(DraftSupportReplySchema, { agent: id, question: "Use knowledge" }),
        );
      expect(posted.kind).toBe("ok");
      await blackBox.eventually(
        () => blackBox.assertEvents(),
        (events) => events.length === 1,
      );
      const record = await factory.readLast?.();
      const operation = record?.journal.find((entry) => entry.evidence.case === "operation");
      expect(operation?.evidence.case).toBe("operation");
      if (operation?.evidence.case !== "operation") throw new Error("Expected saved operation.");
      expect(operation.evidence.value.result.case).toBe("admittedOutput");
      expect(operation.evidence.value.diagnostics).toHaveLength(1);
    } finally {
      await blackBox.close();
    }
  });

  it("keeps a saved result when MCP cleanup never settles", async () => {
    const { blackBox, factory } = await configuredToolBox("never");
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-48" });
    try {
      const posted = await blackBox
        .asGuest()
        .post(
          DraftSupportReplySchema,
          create(DraftSupportReplySchema, { agent: id, question: "Use knowledge" }),
        );
      expect(posted.kind).toBe("ok");
      await blackBox.eventually(
        () => blackBox.assertEvents(),
        (events) => events.length === 1,
      );
      const record = await factory.readLast?.();
      const operation = record?.journal.find((entry) => entry.evidence.case === "operation");
      expect(operation?.evidence.case).toBe("operation");
      if (operation?.evidence.case !== "operation") throw new Error("Expected saved operation.");
      expect(operation.evidence.value.result.case).toBe("admittedOutput");
      expect(operation.evidence.value.diagnostics).toHaveLength(1);
    } finally {
      await blackBox.close();
    }
  });

  it("saves an in-handler indexed history read before returning its page", async () => {
    DraftingAgent.historyReadCount = 0;
    const backend = AiTestBackend.create({
      ref: ModelRef.of("support-scripted", "v1"),
      kind: "generation",
    });
    backend
      .forModel(proposal)
      .respondWith(
        create(ProposedSupportReplySchema, { reply: "I inspected the ticket history." }),
      );
    const { blackBox, factory, repository } = await configuredBox(backend);
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-47" });
    try {
      const posted = await blackBox
        .asGuest()
        .post(
          DraftSupportReplySchema,
          create(DraftSupportReplySchema, { agent: id, question: "Inspect history" }),
        );
      expect(posted.kind).toBe("ok");
      await blackBox.eventually(
        () => blackBox.assertEvents(),
        (events) => events.length === 1,
      );
      expect(DraftingAgent.historyReadCount).toBeGreaterThan(0);
      const retained = await factory.readLast?.();
      const read = retained?.journal.find((entry) => entry.evidence.case === "read");
      expect(read?.evidence.case).toBe("read");
      const history = await blackBox.readAgentHistory(repository, id, { pageSize: 10 });
      expect(history.items.some((entry) => entry.item.case === "systemEvent")).toBe(true);
    } finally {
      await blackBox.close();
    }
  });

  it("journals an Agent read through a registered Projection route", async () => {
    ProjectOverview.applied = 0;
    DraftingAgent.projectionReadCount = 0;
    const backend = AiTestBackend.create({
      ref: ModelRef.of("support-scripted", "v1"),
      kind: "generation",
    });
    backend.forModel(proposal).respondWith(
      create(ProposedSupportReplySchema, {
        reply: "Project is ready.",
      }),
    );
    const { blackBox, factory } = await configuredBox(backend, {}, undefined, true);
    try {
      expect(
        (
          await blackBox
            .asGuest()
            .post(
              CreateProjectSchema,
              create(CreateProjectSchema, { id: "project-1", name: "Support project" }),
            )
        ).kind,
      ).toBe("ok");
      await blackBox.eventually(
        () => blackBox.assertEvents(),
        (events) => events.length === 1,
      );
      await blackBox.eventually(
        () => ProjectOverview.applied,
        (count) => count === 1,
      );
      expect(
        (
          await blackBox.asGuest().post(
            DraftSupportReplySchema,
            create(DraftSupportReplySchema, {
              agent: create(SupportReplyAgentIdSchema, { ticketNumber: "T-47" }),
              question: "Inspect projection",
            }),
          )
        ).kind,
      ).toBe("ok");
      await blackBox.eventually(
        () => blackBox.assertEvents(),
        (events) => events.length === 2,
      );
      expect(DraftingAgent.projectionReadCount).toBe(1);
      const saved = await factory.readLast?.();
      const read = saved?.journal.find((entry) => entry.evidence.case === "read");
      if (read?.evidence.case !== "read") throw new Error("Expected a saved Projection read.");
      expect(read.evidence.value.readName).toBe("query:0");
      const request = read.evidence.value.request;
      const result = read.evidence.value.result;
      if (request === undefined || result === undefined)
        throw new Error("Expected typed saved Projection request and result.");
      expect(AnyMessages.unpack(request, QuerySchema)?.target?.type).toBeDefined();
      const states = AnyMessages.unpack(result, AgentProjectionReadResultSchema)?.states;
      expect(states).toHaveLength(1);
      if (states?.[0] === undefined) throw new Error("Expected the saved Project overview.");
      expect(AnyMessages.unpack(states[0], ProjectOverviewSchema)?.name).toBe("Support project");
      backend.assertSatisfied();
    } finally {
      await blackBox.close();
    }
  });

  it("runs two awaited named model calls in one accepted handler", async () => {
    DraftingAgent.calls = 0;
    const backend = AiTestBackend.create({
      ref: ModelRef.of("support-scripted", "v1"),
      kind: "generation",
    });
    const script = backend.forModel(proposal);
    script.respondWith(create(ProposedSupportReplySchema, { reply: "First draft" }));
    script.respondWith(create(ProposedSupportReplySchema, { reply: "Second draft" }));
    const { blackBox, factory } = await configuredBox(backend, {}, undefined, false, true);
    try {
      expect(
        (
          await blackBox.asGuest().post(
            DraftSupportReplySchema,
            create(DraftSupportReplySchema, {
              agent: create(SupportReplyAgentIdSchema, { ticketNumber: "T-47" }),
              question: "Two sequential",
            }),
          )
        ).kind,
      ).toBe("ok");
      const events = await blackBox.eventually(
        () => blackBox.assertEvents(),
        (produced) => produced.length === 1,
      );
      if (events[0]?.message === undefined) throw new Error("Expected final Agent output.");
      expect(AnyMessages.unpack(events[0].message, SupportReplyProposedSchema)?.reply).toBe(
        "Second draft",
      );
      expect(DraftingAgent.calls).toBe(1);
      expect(backend.requests()).toHaveLength(2);
      const saved = await factory.readLast?.();
      expect(saved?.journal.map((entry) => entry.evidence.case)).toEqual([
        "operation",
        "attempt",
        "operation",
        "attempt",
      ]);
      backend.assertSatisfied();
    } finally {
      await blackBox.close();
    }
  });

  it("applies a staged model preference only to the next accepted signal", async () => {
    DraftingAgent.failure = undefined;
    const primary = AiTestBackend.create({
      ref: ModelRef.of("support-scripted", "v1"),
      kind: "generation",
    });
    const alternate = AiTestBackend.create({ ref: alternateRef, kind: "generation" });
    primary
      .forModel(proposal)
      .respondWith(create(ProposedSupportReplySchema, { reply: "First reply" }));
    alternate
      .forModel(proposal)
      .respondWith(create(ProposedSupportReplySchema, { reply: "Second reply" }));
    const { blackBox, factory, repository } = await configuredBox(primary, {}, alternate);
    const agent = create(SupportReplyAgentIdSchema, { ticketNumber: "T-47" });
    try {
      const first = await blackBox
        .asGuest()
        .post(
          DraftSupportReplySchema,
          create(DraftSupportReplySchema, { agent, question: "Prefer alternate" }),
        );
      expect(first.kind).toBe("ok");
      await blackBox
        .eventually(
          () => blackBox.assertEvents(),
          (events) => events.length === 1,
        )
        .catch((error: unknown) => {
          if (DraftingAgent.failure instanceof Error) throw DraftingAgent.failure;
          throw error;
        });
      expect(primary.requests()).toHaveLength(1);
      expect(alternate.requests()).toHaveLength(0);
      const afterFirst = await factory.readLast?.();
      expect(afterFirst?.completion?.preferences[0]?.selection.case).toBe("model");
      const preferenceHistory = await blackBox.readAgentHistory(repository, agent, {
        pageSize: 20,
      });
      const preferenceEvents = preferenceHistory.items.flatMap((entry) =>
        entry.item.case === "systemEvent" &&
        entry.item.value.message?.typeUrl ===
          `type.spine.io/${AgentModelSelectionChangedSchema.typeName}`
          ? [entry.item.value]
          : [],
      );
      expect(preferenceEvents).toHaveLength(1);
      const originalPreference = preferenceEvents[0];
      if (originalPreference === undefined) throw new Error("Expected preference audit Event.");
      const preferenceId = originalPreference.id;
      if (preferenceId === undefined) throw new Error("Expected a preference System Event ID.");
      const [preferenceCopy] = await blackBox.eventually(
        () => blackBox.readSystemEvents([preferenceId]),
        (events) => events.length === 1,
      );
      expect(preferenceCopy).toBeDefined();
      if (preferenceCopy !== undefined)
        expect(equals(EventSchema, preferenceCopy, originalPreference)).toBe(true);
      const second = await blackBox
        .asGuest()
        .post(
          DraftSupportReplySchema,
          create(DraftSupportReplySchema, { agent, question: "After preference" }),
        );
      expect(second.kind).toBe("ok");
      await blackBox.eventually(
        () => blackBox.assertEvents(),
        (events) => events.length === 2,
      );
      expect(primary.requests()).toHaveLength(1);
      expect(alternate.requests()).toHaveLength(1);
    } finally {
      await blackBox.close();
    }
  });

  it("journals a model-proposed MCP lookup before returning the saved Agent result", async () => {
    DraftingAgent.calls = 0;
    const { blackBox, factory, repository, sequence } = await configuredToolBox();
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-47" });
    try {
      const posted = await blackBox
        .asGuest()
        .post(
          DraftSupportReplySchema,
          create(DraftSupportReplySchema, { agent: id, question: "Use knowledge" }),
        );
      expect(posted.kind).toBe("ok");
      const produced = await blackBox.eventually(
        () => blackBox.assertEvents(),
        (events) => events.length === 1,
      );
      const message = produced[0]?.message;
      if (message === undefined) throw new Error("Expected a saved Agent Event.");
      expect(AnyMessages.unpack(message, SupportReplyProposedSchema)?.reply).toBe(
        "Ticket found; we can help.",
      );
      expect(DraftingAgent.calls).toBe(1);
      expect(sequence).toEqual(["model-proposal", "tool-call"]);
      const saved = await factory.readLast?.();
      expect(saved?.journal.map((entry) => entry.evidence.case)).toEqual([
        "operation",
        "protocol",
        "attempt",
        "tool",
        "protocol",
        "attempt",
      ]);
      const page = await blackBox.readAgentHistory(repository, id, { pageSize: 20 });
      const conversation = page.items.filter((entry) => entry.item.case === "conversationRecord");
      expect(conversation).toHaveLength(6);
      const contents = conversation.flatMap((entry) =>
        entry.item.case === "conversationRecord" && entry.item.value.content !== undefined
          ? [entry.item.value.content]
          : [],
      );
      expect(contents.map((content) => content.typeUrl)).toContain(
        "type.spine.io/spine.ts.agent.ToolRequest",
      );
      expect(contents.map((content) => content.typeUrl)).toContain(
        "type.spine.io/spine.ts.agent.ToolResponse",
      );
      const request = contents
        .map((content) => AnyMessages.unpack(content, ToolRequestSchema))
        .find((message) => message !== undefined);
      const response = contents
        .map((content) => AnyMessages.unpack(content, ToolResponseSchema))
        .find((message) => message !== undefined);
      expect(request?.call?.value).toBeDefined();
      expect(response?.call?.value).toBe(request?.call?.value);
      const originals = page.items.flatMap((entry) =>
        entry.item.case === "systemEvent" ? [entry.item.value] : [],
      );
      const copies = await blackBox.eventually(
        () =>
          blackBox.readSystemEvents(
            originals.flatMap((event) => (event.id === undefined ? [] : [event.id])),
          ),
        (events) => events.length === originals.length,
      );
      for (const schema of [AgentToolCallStartedSchema, AgentToolCallFinishedSchema])
        expect(copies.map((event) => event.message?.typeUrl)).toContain(
          `type.spine.io/${schema.typeName}`,
        );
      expect(
        copies.every(
          (event, index) =>
            originals[index] !== undefined && equals(EventSchema, event, originals[index]),
        ),
      ).toBe(true);
    } finally {
      await blackBox.close();
    }
  });

  it("bounds audit reads to the context and validates opaque inputs", async () => {
    const backend = AiTestBackend.create({
      ref: ModelRef.of("support-scripted", "v1"),
      kind: "generation",
    });
    const { blackBox, repository } = await configuredBox(backend);
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-47" });
    try {
      expect(() => blackBox.readAgentHistory(draftingRepository(), id, { pageSize: 1 })).toThrow(
        "not registered",
      );
      await expect(
        blackBox.readAgentHistory(repository, id, {
          pageSize: 1,
          cursor: create(AgentHistoryCursorSchema, { value: "%%%" }),
        }),
      ).rejects.toThrow("cursor");
      await expect(
        blackBox.readSystemEvents([create(EventIdSchema, { value: "" })]),
      ).rejects.toThrow();
      expect(await blackBox.readSystemEvents([])).toEqual([]);
    } finally {
      await blackBox.close();
    }
    expect(() => blackBox.readAgentHistory(repository, id, { pageSize: 1 })).toThrow("closed");
    expect(() => blackBox.readSystemEvents([])).toThrow("closed");
  });

  it("returns a named scripted model result as a typed domain output", async () => {
    DraftingAgent.calls = 0;
    DraftingAgent.failure = undefined;
    DraftingAgent.admitted = 0;
    const backend = AiTestBackend.create({
      ref: ModelRef.of("support-scripted", "v1"),
      kind: "generation",
    });
    backend.forModel(proposal).respondWith(
      create(ProposedSupportReplySchema, {
        reply: "Your order is on its way.",
      }),
    );
    const { blackBox, context, factory, repository } = await configuredBox(backend);
    try {
      const posted = await postDraft(blackBox);
      expect(posted.kind).toBe("ok");
      const produced = await blackBox
        .eventually(
          () => blackBox.assertEvents(),
          (events) => events.length === 1,
        )
        .catch((error: unknown) => {
          if (DraftingAgent.failure instanceof Error) throw DraftingAgent.failure;
          throw new Error(
            `No Agent output after ${String(DraftingAgent.calls)} handler call(s), ` +
              `${String(backend.requests().length)} backend request(s), ` +
              `${String(DraftingAgent.admitted)} admitted result(s): ${String(error)}`,
          );
        });
      const message = produced[0]?.message;
      if (message === undefined) throw new Error("Expected the proposed support reply Event.");
      expect(AnyMessages.unpack(message, SupportReplyProposedSchema)?.reply).toBe(
        "Your order is on its way.",
      );
      expect(DraftingAgent.calls).toBe(1);
      expect(backend.requests()).toHaveLength(1);
      expect(backend.requests()[0]?.call).toBe("draft");
      const saved = await factory.readLast?.();
      expect(saved?.journal.map((entry) => entry.evidence.case)).toEqual(["operation", "attempt"]);
      expect(saved?.journal[0]?.evidence.case).toBe("operation");
      expect(saved?.journal[1]?.evidence.case).toBe("attempt");
      if (saved?.journal[0]?.evidence.case === "operation") {
        expect(saved.journal[0].evidence.value.callName).toBe("draft");
        expect(saved.journal[0].evidence.value.result.case).toBe("admittedOutput");
        const deadline = saved.journal[0].evidence.value.deadline;
        expect(deadline).toBeDefined();
        if (deadline !== undefined && saved.started?.deadline !== undefined)
          expect(deadline.seconds <= saved.started.deadline.seconds).toBe(true);
      }
      if (saved?.journal[1]?.evidence.case === "attempt") {
        expect(saved.journal[1].evidence.value.response.case).toBe("generationResponse");
        expect(saved.journal[1].evidence.value.inputBytes).toBeGreaterThan(0n);
      }
      const exchanges = factory.historyWrites.filter(
        (entry) => entry.item.case === "conversationRecord",
      );
      expect(exchanges).toHaveLength(2);
      expect(
        exchanges.map(
          (entry) => entry.item.case === "conversationRecord" && entry.item.value.content?.typeUrl,
        ),
      ).toEqual([
        "type.spine.io/spine.ts.agent.GenerationRequest",
        "type.spine.io/spine.ts.agent.GenerationResponse",
      ]);
      if (
        exchanges[0]?.item.case === "conversationRecord" &&
        exchanges[0].item.value.content !== undefined
      )
        expect(
          AnyMessages.unpack(exchanges[0].item.value.content, GenerationRequestSchema),
        ).toBeDefined();
      if (
        exchanges[1]?.item.case === "conversationRecord" &&
        exchanges[1].item.value.content !== undefined
      )
        expect(
          AnyMessages.unpack(exchanges[1].item.value.content, GenerationResponseSchema),
        ).toBeDefined();
      const agentId = create(SupportReplyAgentIdSchema, { ticketNumber: "T-47" });
      const retained = await blackBox.readAgentHistory(repository, agentId, { pageSize: 10 });
      const issued = context.registeredRepositories()[0];
      if (issued === undefined) throw new Error("Expected a registered Agent view.");
      expect((await agentHistoryView(context, issued, agentId, { pageSize: 10 })).items).toEqual(
        retained.items,
      );
      expect(
        retained.items.filter((entry) => entry.item.case === "conversationRecord"),
      ).toHaveLength(2);
      const first = await blackBox.readAgentHistory(repository, agentId, { pageSize: 1 });
      if (first.nextCursor === undefined) throw new Error("Expected an older audit page.");
      const next = await blackBox.readAgentHistory(repository, agentId, {
        pageSize: 1,
        cursor: first.nextCursor,
      });
      expect(next.items).toHaveLength(1);
      const systemIds = retained.items.flatMap((entry) =>
        entry.item.case === "systemEvent" && entry.item.value.id !== undefined
          ? [entry.item.value.id]
          : [],
      );
      expect(systemIds.length).toBeGreaterThan(0);
      const systemEvents = await blackBox.eventually(
        () => blackBox.readSystemEvents(systemIds),
        (events) => events.length === systemIds.length,
      );
      expect(systemEvents.map((event) => event.id?.value)).toEqual(systemIds.map((id) => id.value));
      const originalSystems = retained.items.flatMap((entry) =>
        entry.item.case === "systemEvent" ? [entry.item.value] : [],
      );
      const interactionTypes = new Set(systemEvents.map((event) => event.message?.typeUrl));
      for (const schema of [
        AgentAiOperationStartedSchema,
        AgentModelAttemptStartedSchema,
        AgentModelAttemptFinishedSchema,
        AgentAiResultAdmittedSchema,
      ])
        expect(interactionTypes.has(`type.spine.io/${schema.typeName}`)).toBe(true);
      expect(
        systemEvents.every(
          (event, index) =>
            originalSystems[index] !== undefined &&
            equals(EventSchema, event, originalSystems[index]),
        ),
      ).toBe(true);
      backend.assertSatisfied();
    } finally {
      await blackBox.close();
    }
  });

  it("returns a safe failure that the Agent emits as its own domain Event", async () => {
    DraftingAgent.calls = 0;
    DraftingAgent.failure = undefined;
    DraftingAgent.admitted = 0;
    const backend = AiTestBackend.create({
      ref: ModelRef.of("support-scripted", "v1"),
      kind: "generation",
    });
    backend.forModel(proposal).respondWithText("not JSON");
    const { blackBox, factory, repository } = await configuredBox(backend);
    try {
      expect((await postDraft(blackBox)).kind).toBe("ok");
      const events = await blackBox
        .eventually(
          () => blackBox.assertEvents(),
          (produced) => produced.length === 1,
        )
        .catch((error: unknown) => {
          if (DraftingAgent.failure instanceof Error) throw DraftingAgent.failure;
          throw new Error(String(error));
        });
      const message = events[0]?.message;
      if (message === undefined) throw new Error("Expected a support draft failure Event.");
      expect(AnyMessages.unpack(message, SupportReplyDraftFailedSchema)?.reasonCode).toBe(
        "INVALID_OUTPUT",
      );
      expect(DraftingAgent.calls).toBe(1);
      expect(backend.requests()).toHaveLength(1);
      const saved = await factory.readLast?.();
      if (saved?.journal[0]?.evidence.case !== "operation")
        throw new Error("Expected a saved named operation.");
      expect(saved.journal[0].evidence.value.result.case).toBe("failure");
      const operation = saved.journal[0].evidence.value;
      const failedAttempt = saved.journal.find(
        (entry) =>
          entry.evidence.case === "attempt" &&
          entry.evidence.value.response.case === "generationResponse",
      );
      if (
        failedAttempt?.evidence.case !== "attempt" ||
        failedAttempt.evidence.value.response.case !== "generationResponse"
      )
        throw new Error("Expected a saved failed model response.");
      expect(operation.diagnostics).toHaveLength(1);
      expect(operation.diagnostics[0]?.diagnostic?.value).toBe(
        failedAttempt.evidence.value.response.value.diagnosticId?.value,
      );
      const history = await blackBox.readAgentHistory(
        repository,
        create(SupportReplyAgentIdSchema, { ticketNumber: "T-47" }),
        { pageSize: 20 },
      );
      const original = history.items.flatMap((entry) =>
        entry.item.case === "systemEvent" ? [entry.item.value] : [],
      );
      const system = await blackBox.eventually(
        () =>
          blackBox.readSystemEvents(
            original.flatMap((event) => (event.id === undefined ? [] : [event.id])),
          ),
        (events) => events.length === original.length,
      );
      expect(system.map((event) => event.message?.typeUrl)).toContain(
        `type.spine.io/${AgentAiOperationFailedSchema.typeName}`,
      );
      expect(
        system.every(
          (event, index) =>
            original[index] !== undefined && equals(EventSchema, event, original[index]),
        ),
      ).toBe(true);
      backend.assertSatisfied();
    } finally {
      await blackBox.close();
    }
  });

  it("keeps a thrown handler draft pending until its saved deadline terminates it", async () => {
    DraftingAgent.calls = 0;
    const backend = AiTestBackend.create({
      ref: ModelRef.of("support-scripted", "v1"),
      kind: "generation",
    });
    const { blackBox, factory, repository } = await configuredBox(backend);
    let originalTime: ReturnType<typeof Time.setProvider> | undefined;
    try {
      expect(
        (
          await blackBox.asGuest().post(
            DraftSupportReplySchema,
            create(DraftSupportReplySchema, {
              agent: create(SupportReplyAgentIdSchema, { ticketNumber: "T-47" }),
              question: "Throw transient",
            }),
          )
        ).kind,
      ).toBe("ok");
      await blackBox.eventually(
        () => DraftingAgent.calls,
        (calls) => calls === 1,
      );
      const before = await factory.readLast?.();
      expect(before?.status).toBe(AgentInvocationStatus.AGENT_INVOCATION_ACTIVE);
      expect(before?.completion).toBeUndefined();
      expect(blackBox.assertEvents()).toEqual([]);
      const now = Time.currentTimeMillis();
      originalTime = Time.setProvider({
        currentTime: () =>
          create(TimestampSchema, {
            seconds: BigInt(Math.trunc((now + 31_000) / 1_000)),
            nanos: ((now + 31_000) % 1_000) * 1_000_000,
          }),
      });
      await blackBox.eventually(
        () => factory.readLast?.(),
        (record) => record?.status === AgentInvocationStatus.AGENT_INVOCATION_TERMINATED,
      );
      expect(blackBox.assertEvents()).toEqual([]);
      const history = await blackBox.readAgentHistory(
        repository,
        create(SupportReplyAgentIdSchema, { ticketNumber: "T-47" }),
        { pageSize: 20 },
      );
      const termination = history.items.flatMap((entry) =>
        entry.item.case === "systemEvent" &&
        entry.item.value.message?.typeUrl ===
          `type.spine.io/${AgentInvocationTerminatedSchema.typeName}`
          ? [entry.item.value]
          : [],
      );
      expect(termination).toHaveLength(1);
      const event = termination[0];
      if (event?.id === undefined || event.message === undefined)
        throw new Error("Expected a termination System Event.");
      expect(AnyMessages.unpack(event.message, AgentInvocationTerminatedSchema)?.reason).toBe(
        "DEADLINE_EXCEEDED",
      );
      const [copy] = await blackBox.readSystemEvents([event.id]);
      if (copy === undefined) throw new Error("Expected the persisted System copy.");
      expect(equals(EventSchema, copy, event)).toBe(true);
    } finally {
      if (originalTime) Time.setProvider(originalTime);
      await blackBox.close();
    }
  }, 15_000);

  it.each([128, 6_000])(
    "rejects a model fetch when %i-byte history cannot fit",
    async (maxBytes) => {
      DraftingAgent.calls = 0;
      DraftingAgent.failure = undefined;
      const backend = AiTestBackend.create({
        ref: ModelRef.of("support-scripted", "v1"),
        kind: "generation",
      });
      backend.forModel(proposal).respondWith(
        create(ProposedSupportReplySchema, {
          reply: "A reply that must not be requested.",
        }),
      );
      const { blackBox } = await configuredBox(backend, { historyRecordBytes: maxBytes });
      try {
        expect((await postDraft(blackBox)).kind).toBe("ok");
        const failure = await blackBox.eventually(
          () => DraftingAgent.failure,
          (value) => value instanceof Error,
        );
        expect(String(failure)).toContain("history");
        expect(backend.requests()).toHaveLength(0);
      } finally {
        await blackBox.close();
      }
    },
  );

  it("rejects model dispatch when credited evidence cannot fit recovery bytes", async () => {
    DraftingAgent.failure = undefined;
    const backend = AiTestBackend.create({
      ref: ModelRef.of("support-scripted", "v1"),
      kind: "generation",
    });
    backend.forModel(proposal).respondWith(
      create(ProposedSupportReplySchema, {
        reply: "Never fetched",
      }),
    );
    const { blackBox } = await configuredBox(backend, {}, undefined, false, false, 8_000);
    try {
      expect((await postDraft(blackBox)).kind).toBe("ok");
      const failure = await blackBox.eventually(
        () => DraftingAgent.failure,
        (value) => value instanceof Error,
      );
      expect(String(failure)).toContain("recovery bytes");
      expect(backend.requests()).toHaveLength(0);
    } finally {
      await blackBox.close();
    }
  });

  it.each([
    [{ executionRecordBytes: 6_000 }, "record"],
    [{ executionHeadBytes: 64 }, "head"],
    [{ transactionPayloadBytes: 8_000 }, "transaction"],
  ] as const)(
    "rejects before provider fetch when %s capacity is insufficient",
    async (capacity, reason) => {
      DraftingAgent.failure = undefined;
      const backend = AiTestBackend.create({
        ref: ModelRef.of("support-scripted", "v1"),
        kind: "generation",
      });
      backend.forModel(proposal).respondWith(
        create(ProposedSupportReplySchema, {
          reply: "Never fetched",
        }),
      );
      const { blackBox } = await configuredBox(backend, capacity);
      try {
        expect((await postDraft(blackBox)).kind).toBe("ok");
        const failure = await blackBox.eventually(
          () => DraftingAgent.failure,
          (value) => value instanceof Error,
        );
        expect(String(failure)).toContain(reason);
        expect(backend.requests()).toHaveLength(0);
      } finally {
        await blackBox.close();
      }
    },
  );
});
