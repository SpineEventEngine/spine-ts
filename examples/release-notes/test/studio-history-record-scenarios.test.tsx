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

// @vitest-environment jsdom
import { create, createRegistry, toJson, type MessageShape } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AnyPacker, type MessageSchema } from "@spine-event-engine/core";
import { CommandSchema, EventSchema, VersionSchema } from "@spine-event-engine/proto";
import {
  AgentHistoryEntrySchema,
  AiCapabilityNameSchema,
  AiCapabilityRevisionSchema,
  AiOperationIdSchema,
  CallModelSchema,
  ModelCallSchema,
  ModelRepliedSchema,
  ModelCallFailedSchema,
  ModelRequestRecordSchema,
  ModelSubmissionAttemptRecordSchema,
  ModelOutcomeHandledRecordSchema,
  ModelCallAbandonedRecordSchema,
  AiContentDigestSchema,
  AiDiagnosticIdSchema,
  AiOutcome,
  AiToolCallIdSchema,
  ConversationIdSchema,
  ConversationRecordIdSchema,
  ConversationRecordSchema,
  GenerationRequestSchema,
  GenerationResponseSchema,
  McpServerIdSchema,
  McpToolNameSchema,
  ModelNameSchema,
  ModelRefSchema,
  ModelRevisionSchema,
  ToolEffect,
  ToolRequestSchema,
} from "@spine-event-engine/proto/agent";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
  ReleaseDraftOpenedSchema,
  ReleaseGenerationRequestedSchema,
} from "../generated/spine/examples/releasenotes/events_pb.js";
import {
  GitCommitIdSchema,
  ReleaseComparisonPolicy,
  ReleaseComparisonSchema,
  ReleaseDraftIdSchema,
  ReleaseGenerationIdSchema,
  ReleaseInstructionSchema,
  ReleaseModelSelectionSchema,
  ReleaseTitleSchema,
  RepositorySelectionIdSchema,
} from "../generated/spine/examples/releasenotes/types_pb.js";
import {
  historyAge,
  historyKey,
  historyMerge,
  historyRecord,
} from "../src/studio-history-record.js";
import { HistoryDrawer } from "../src/studio-history-view.js";

test("prepared, attempted, handled, and abandoned model calls have distinct timeline records", () => {
  const whenRequested = create(TimestampSchema, { seconds: 1791979260n });
  const call = create(ModelCallSchema, {
    id: create(AiOperationIdSchema, { value: "call-7" }),
    capability: create(AiCapabilityNameSchema, { value: "draft-release-notes" }),
    capabilityRevision: create(AiCapabilityRevisionSchema, { value: "1" }),
    conversation: create(ConversationIdSchema, { value: "release-7" }),
    whenRequested,
  });
  const payload = create(CallModelSchema, {
    call,
    model: create(ModelRefSchema, {
      name: create(ModelNameSchema, { value: "release-model" }),
      revision: create(ModelRevisionSchema, { value: "1" }),
    }),
    input: AnyPacker.pack(
      ReleaseGenerationRequestedSchema,
      create(ReleaseGenerationRequestedSchema),
    ),
  });
  const command = create(CommandSchema, {
    id: { uuid: "command-7" },
    message: AnyPacker.pack(CallModelSchema, payload),
  });
  const source = create(EventSchema, {
    id: { value: "source-7" },
    message: AnyPacker.pack(
      ReleaseGenerationRequestedSchema,
      create(ReleaseGenerationRequestedSchema),
    ),
  });
  const outcome = create(EventSchema, {
    message: AnyPacker.pack(ModelRepliedSchema, create(ModelRepliedSchema, { call })),
  });
  const entries = [
    create(AgentHistoryEntrySchema, {
      whenOccurred: whenRequested,
      item: {
        case: "modelRequest",
        value: create(ModelRequestRecordSchema, {
          request: command,
          source: { case: "event", value: source },
        }),
      },
    }),
    create(AgentHistoryEntrySchema, {
      whenOccurred: create(TimestampSchema, { seconds: 1791979320n }),
      item: {
        case: "submissionAttempt",
        value: create(ModelSubmissionAttemptRecordSchema, {
          id: "attempt-7",
          command,
          whenAttempted: create(TimestampSchema, { seconds: 1791979320n }),
        }),
      },
    }),
    create(AgentHistoryEntrySchema, {
      whenOccurred: create(TimestampSchema, { seconds: 1791979380n }),
      item: {
        case: "handledOutcome",
        value: create(ModelOutcomeHandledRecordSchema, {
          id: "handled-7",
          call: call.id,
          conversation: call.conversation,
          outcome,
          whenHandled: create(TimestampSchema, { seconds: 1791979380n }),
        }),
      },
    }),
    create(AgentHistoryEntrySchema, {
      whenOccurred: create(TimestampSchema, { seconds: 1791979440n }),
      item: {
        case: "abandonment",
        value: create(ModelCallAbandonedRecordSchema, {
          id: "abandoned-7",
          call: call.id,
          conversation: call.conversation,
          source: { case: "event", value: source },
          whenAbandoned: create(TimestampSchema, { seconds: 1791979440n }),
        }),
      },
    }),
  ].map((entry) =>
    toJson(AgentHistoryEntrySchema, entry, {
      registry: createRegistry(
        CallModelSchema,
        ReleaseGenerationRequestedSchema,
        ModelRepliedSchema,
      ),
    }),
  );
  expect(entries.map(historyKey)).toEqual([
    "request:command-7",
    "submissionAttempt:attempt-7",
    "handledOutcome:handled-7",
    "abandonment:abandoned-7",
  ]);
  expect(historyMerge(entries, entries)).toHaveLength(4);
  expect(entries.map((entry) => historyRecord(entry).title)).toEqual([
    "Model request prepared",
    "Model submission attempted",
    "Model reply handled",
    "Model call abandoned",
  ]);
  expect(historyRecord(entries[0]).occurredAt).toBe("2026-10-14T12:01:00Z");
  expect(historyRecord(entries[0]).exact).toContain("ReleaseGenerationRequested");
  expect(historyRecord(entries[1]).preview).toContain("draft-release-notes@1");
  expect(historyRecord(entries[2]).preview).toContain("call-7");
  expect(historyRecord(entries[3]).detail).toContain("source-7");
  const failed = create(AgentHistoryEntrySchema, {
    whenOccurred: whenRequested,
    item: {
      case: "handledOutcome",
      value: create(ModelOutcomeHandledRecordSchema, {
        id: "handled-8",
        call: call.id,
        conversation: call.conversation,
        outcome: create(EventSchema, {
          message: AnyPacker.pack(ModelCallFailedSchema, create(ModelCallFailedSchema, { call })),
        }),
        whenHandled: whenRequested,
      }),
    },
  });
  const rejected = toJson(AgentHistoryEntrySchema, failed, {
    registry: createRegistry(ModelCallFailedSchema),
  });
  expect(historyRecord(rejected).title).toBe("Model failure handled");
});
const id = create(ReleaseDraftIdSchema, { value: "draft" });
const title = create(ReleaseTitleSchema, { value: "October release" });
const comparison = create(ReleaseComparisonSchema, {
  repository: create(RepositorySelectionIdSchema, { value: "selected" }),
  base: create(GitCommitIdSchema, { value: "a".repeat(40) }),
  target: create(GitCommitIdSchema, { value: "b".repeat(40) }),
  policy: ReleaseComparisonPolicy.SELECTED_NET_TREE,
});
const recorded = <S extends MessageSchema>(schema: S, content: MessageShape<S>, identity: string) =>
  toJson(
    AgentHistoryEntrySchema,
    create(AgentHistoryEntrySchema, {
      whenOccurred: create(TimestampSchema, { seconds: 1791979200n }),
      item: {
        case: "conversationRecord",
        value: create(ConversationRecordSchema, {
          id: create(ConversationRecordIdSchema, { value: identity }),
          content: AnyPacker.pack(schema, content),
        }),
      },
    }),
    { registry: createRegistry(schema, ReleaseGenerationRequestedSchema) },
  );

afterEach(cleanup);

test("the prepared request shows actual instructions and typed release input while retaining recorded fields", () => {
  const input = create(ReleaseGenerationRequestedSchema, {
    id,
    generation: create(ReleaseGenerationIdSchema, { value: "generation" }),
    inputVersion: create(VersionSchema, {
      number: 1,
      timestamp: create(TimestampSchema, { seconds: 1791979200n }),
    }),
    comparison,
    audience: "Release managers",
    instruction: create(ReleaseInstructionSchema, { value: "Focus on migration" }),
    conversation: create(ConversationIdSchema, { value: "conversation" }),
    selection: create(ReleaseModelSelectionSchema, {
      registration: "registered",
      account: "account",
      model: create(ModelRefSchema, {
        name: create(ModelNameSchema, { value: "model" }),
        revision: create(ModelRevisionSchema, { value: "revision" }),
      }),
    }),
    inputDigest: "a".repeat(64),
    title,
  });
  const request = create(GenerationRequestSchema, {
    input: AnyPacker.pack(ReleaseGenerationRequestedSchema, input),
    instructions: "Write for release managers.",
    outputSchemaJson: '{"type":"object"}',
    promptJson: '{"messages":["hello"]}',
    digest: create(AiContentDigestSchema, { value: "b".repeat(64) }),
  });
  const entry = recorded(GenerationRequestSchema, request, "request");
  const view = historyRecord(entry);
  expect(view.kind).toBe("App");
  expect(view.title).toBe("Request");
  expect(view.exact).toContain("Write for release managers.");
  expect(view.exact).toContain("Release managers");
  expect(view.exact).toContain("Focus on migration");
  expect(view.detail).toContain("promptJson");
  expect(view.detail).toContain("outputSchemaJson");
});

test("MCP call and domain event show their labels and full saved records", async () => {
  const call = create(ToolRequestSchema, {
    call: create(AiToolCallIdSchema, { value: "call" }),
    server: create(McpServerIdSchema, { value: "git" }),
    tool: create(McpToolNameSchema, { value: "changed_files" }),
    argumentsJson: '{"from":"base","to":"target"}',
    effect: ToolEffect.READ,
  });
  const toolEntry = recorded(ToolRequestSchema, call, "call");
  const opened = create(ReleaseDraftOpenedSchema, {
    id,
    title,
    comparison,
    audience: "Release managers",
  });
  const domainEntry = toJson(
    AgentHistoryEntrySchema,
    create(AgentHistoryEntrySchema, {
      whenOccurred: create(TimestampSchema, { seconds: 1791979260n }),
      item: {
        case: "domainEvent",
        value: create(EventSchema, {
          id: { value: "event" },
          message: AnyPacker.pack(ReleaseDraftOpenedSchema, opened),
        }),
      },
    }),
    { registry: createRegistry(ReleaseDraftOpenedSchema) },
  );
  expect(historyRecord(toolEntry)).toMatchObject({
    kind: "Tool",
    speaker: "MCP",
    title: "Call",
    preview: "Run changed_files",
  });
  expect(historyRecord(domainEntry)).toMatchObject({
    kind: "Domain",
    speaker: "App",
    title: "Release Draft Opened",
  });
  const copyMarkdown = vi.fn().mockResolvedValue(undefined);
  render(
    <HistoryDrawer
      releases={[{ id: "draft", title: "October release" }]}
      currentId="draft"
      bridge={{
        history: vi.fn().mockResolvedValue({ items: [toolEntry, domainEntry] }),
        copyMarkdown,
      }}
      onClose={() => undefined}
    />,
  );
  const region = screen.getByRole("region", { name: "October release history" });
  expect(await within(region).findByText("Run changed_files")).toBeTruthy();
  expect(within(region).getByText("Release Draft Opened")).toBeTruthy();
  const domainRead = within(region).getAllByRole("button", { name: "Read full record" })[0];
  if (!domainRead) throw new Error("Expected domain record action");
  fireEvent.click(domainRead);
  const modal = screen.getByRole("dialog", { name: "Recorded detail" });
  expect(modal.textContent).toContain("Release managers");
  fireEvent.click(within(modal).getByRole("button", { name: "Copy" }));
  expect(copyMarkdown).toHaveBeenCalledWith(expect.stringContaining("ReleaseDraftOpened"));
});

test("release age uses calendar days, months, and years and tolerates a missing creation time", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  expect(historyAge("2026-10-08T12:00:00Z", now)).toBe("6d ago");
  expect(historyAge("2026-03-14T12:00:00Z", now)).toBe("7mo ago");
  expect(historyAge("2025-07-14T12:00:00Z", now)).toBe("1y 3mo ago");
  expect(historyAge("2025-10-14T12:00:00Z", now)).toBe("1y ago");
  expect(historyAge(undefined, now)).toBe("this session");
});

test("a failed model response without output exposes and copies its saved diagnostic record", async () => {
  const failure = create(GenerationResponseSchema, {
    outcome: AiOutcome.FAILED,
    diagnosticId: create(AiDiagnosticIdSchema, { value: "diagnostic-1" }),
  });
  const entry = recorded(GenerationResponseSchema, failure, "failure");
  const copyMarkdown = vi.fn().mockResolvedValue(undefined);
  render(
    <HistoryDrawer
      releases={[{ id: "draft", title: "October release" }]}
      currentId="draft"
      bridge={{ history: vi.fn().mockResolvedValue({ items: [entry] }), copyMarkdown }}
      onClose={() => undefined}
    />,
  );
  const read = await screen.findByRole("button", { name: "Read full record" });
  fireEvent.click(read);
  const modal = screen.getByRole("dialog", { name: "Recorded detail" });
  expect(modal.querySelector("pre")?.textContent).toContain("diagnostic-1");
  fireEvent.click(within(modal).getByRole("button", { name: "Copy" }));
  expect(copyMarkdown).toHaveBeenCalledWith(expect.stringContaining("diagnostic-1"));
});
