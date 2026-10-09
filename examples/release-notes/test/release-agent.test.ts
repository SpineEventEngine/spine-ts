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

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { create } from "@bufbuild/protobuf";
import { AiRegistry, ModelRef } from "@spine-event-engine/ai";
import { VercelAx } from "@spine-event-engine/ai-vercel-ax";
import { AnyMessages } from "@spine-event-engine/core";
import {
  AiOutcome,
  ConversationIdSchema,
  GenerationResponseSchema,
} from "@spine-event-engine/proto/agent";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { BlackBox } from "@spine-event-engine/testing";
import { expect, it } from "vitest";

import {
  OpenReleaseDraftSchema,
  RequestReleaseGenerationSchema,
} from "../generated/spine/examples/releasenotes/commands_pb.js";
import {
  ReleaseGenerationAlreadyRequestedSchema,
  ReleaseGenerationFailedSchema,
  ReleaseNotesStagedSchema,
} from "../generated/spine/examples/releasenotes/events_pb.js";
import { ReleaseDraftStateSchema } from "../generated/spine/examples/releasenotes/states_pb.js";
import {
  GitCommitIdSchema,
  ReleaseComparisonPolicy,
  ReleaseComparisonSchema,
  ReleaseCommitSchema,
  ReleaseChangeSchema,
  ReleaseDraftIdSchema,
  ReleaseEvidenceCatalogSchema,
  ReleaseEvidenceSchema,
  ReleaseGenerationIdSchema,
  ReleaseInstructionSchema,
  ReleaseModelSelectionSchema,
  ReleaseTitleSchema,
  RepositorySelectionIdSchema,
} from "../generated/spine/examples/releasenotes/types_pb.js";
import { ReleaseNotesAgent, ReleaseNotesContext } from "../dist/src/domain/index.js";
import { GitReleaseComparison } from "../src/trusted/git-release.js";
import { ReleaseGitRegistration } from "../src/trusted/git-mcp-registration.js";

const stream = (events: readonly object[]) =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

function responses(number: number, base: string, target: string): string {
  const tool = number === 1;
  const argumentsJson = "{}";
  const text = JSON.stringify({
    sections: [
      {
        heading: "Changes",
        entries: [
          {
            text: "Changed release file.",
            evidence: [
              {
                commit: { value: target },
                parent: { value: base },
                path: number === 2 ? "unlisted.txt" : "notes.txt",
              },
            ],
          },
        ],
      },
    ],
  });
  const item = tool
    ? {
        type: "function_call",
        id: "fc-1",
        call_id: "provider-call-1",
        name: "tool_0",
        namespace: "spine_mcp",
        arguments: argumentsJson,
        status: "completed",
      }
    : {
        type: "message",
        id: `msg-${String(number)}`,
        role: "assistant",
        phase: "final_answer",
        content: [{ type: "output_text", text, annotations: [] }],
      };
  return stream([
    {
      type: "response.created",
      response: { id: `resp-${String(number)}`, created_at: number, model: "fixture-model" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        type: item.type,
        id: item.id,
        ...(tool
          ? {
              call_id: "provider-call-1",
              name: "tool_0",
              namespace: "spine_mcp",
              arguments: argumentsJson,
            }
          : {}),
      },
    },
    ...(tool
      ? [
          {
            type: "response.function_call_arguments.done",
            item_id: "fc-1",
            output_index: 0,
            arguments: argumentsJson,
          },
        ]
      : [
          {
            type: "response.output_text.delta",
            item_id: `msg-${String(number)}`,
            output_index: 0,
            content_index: 0,
            delta: text,
          },
        ]),
    { type: "response.output_item.done", output_index: 0, item },
    {
      type: "response.completed",
      response: {
        id: `resp-${String(number)}`,
        status: "completed",
        usage: { input_tokens: 10, output_tokens: 8 },
      },
    },
  ]);
}

it("uses the real Agent, plan Responses, and local Git tool before staging evidence-backed notes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spine-release-agent-"));
  const gitExecutable = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const git = (...args: string[]) =>
    execFileSync(gitExecutable, args, {
      cwd: directory,
      encoding: "utf8",
    }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Release Fixture");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(directory, "notes.txt"), "before\n");
  git("add", "notes.txt");
  git("commit", "--quiet", "-m", "Before");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(directory, "notes.txt"), "after\n");
  git("add", "notes.txt");
  git("commit", "--quiet", "-m", "Change notes");
  const target = git("rev-parse", "HEAD");
  const comparison = await GitReleaseComparison.open({
    repository: directory,
    gitExecutable,
    base,
    target,
  });
  const providerBodies: unknown[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of request) chunks.push(chunk as Uint8Array);
      providerBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
      response.setHeader("content-type", "text/event-stream");
      response.end(responses(providerBodies.length, base, target));
    })().catch(() => response.writeHead(500).end());
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local provider address.");
  const identity = {
    provider: "chatgpt-plan",
    account: "fixture-account",
    endpoint: `http://127.0.0.1:${String(address.port)}/v1`,
    model: "fixture-model",
  };
  const model = VercelAx.chatgptPlanModel({
    ref: ModelRef.of("release-plan", "v1"),
    resolveIdentity: () => identity,
    authorizeUse: () => true,
    connect: () => ({ accessToken: "fixture-token", identity }),
  });
  let comparisonAvailable = true;
  const tools = ReleaseGitRegistration.create({
    executable: process.execPath,
    workerPath: resolve("examples/release-notes/dist/src/git-worker.mjs"),
    cwd: directory,
    resolveComparison: () => (comparisonAvailable ? comparison : undefined),
  });
  const registry = AiRegistry.create({
    defaultModels: { generation: model.ref },
    invocationLimits: {
      operations: 1,
      modelRequests: 3,
      toolCalls: 6,
      recordedReads: 0,
      deadlineMs: 20_000,
      totalInputBytes: 256_000,
      totalOutputBytes: 1_000_000,
      maxRecoveryBytes: 1_000_000,
    },
    concurrentOperations: 1,
    queuedOperations: 0,
  })
    .register(model)
    .registerTools(tools);
  const context = await ReleaseNotesContext.create(registry, new InMemoryStorageFactory());
  const box = await BlackBox.from(context, { timeoutMs: 30_000 });
  const id = create(ReleaseDraftIdSchema, { value: "release-agent-1" });
  try {
    expect(
      (
        await box.asGuest().post(
          OpenReleaseDraftSchema,
          create(OpenReleaseDraftSchema, {
            id,
            title: create(ReleaseTitleSchema, { value: "October release" }),
            comparison: create(ReleaseComparisonSchema, {
              repository: create(RepositorySelectionIdSchema, { value: "selected-repository" }),
              base: create(GitCommitIdSchema, { value: base }),
              target: create(GitCommitIdSchema, { value: target }),
              policy: ReleaseComparisonPolicy.ANCESTOR_NET_TREE,
            }),
            audience: "SDK users",
          }),
        )
      ).kind,
    ).toBe("ok");
    await box.eventually(
      () => box.assertEvents(),
      (events) => events.length >= 1,
    );
    const opened = await context.stand().readVersioned(ReleaseDraftStateSchema, id);
    if (!opened?.version) throw new Error("Opened draft has no Entity Version.");
    const firstRequest = create(RequestReleaseGenerationSchema, {
      id,
      generation: create(ReleaseGenerationIdSchema, { value: "generation-1" }),
      expectedVersion: opened.version,
      catalog: create(ReleaseEvidenceCatalogSchema, {
        commits: [
          create(ReleaseCommitSchema, {
            id: create(GitCommitIdSchema, { value: target }),
            parents: [create(GitCommitIdSchema, { value: base })],
            subject: "Change notes",
          }),
        ],
        changes: [create(ReleaseChangeSchema, { path: "notes.txt", status: "M" })],
        evidence: [
          create(ReleaseEvidenceSchema, {
            commit: create(GitCommitIdSchema, { value: target }),
            parent: create(GitCommitIdSchema, { value: base }),
            path: "notes.txt",
            status: "M",
          }),
        ],
      }),
      instruction: create(ReleaseInstructionSchema, { value: "Explain changes" }),
      conversation: create(ConversationIdSchema, { value: "release-agent-conversation" }),
      selection: create(ReleaseModelSelectionSchema, {
        registration: "fixture-registration",
        account: "fixture-account",
        model: model.ref,
      }),
    });
    expect((await box.asGuest().post(RequestReleaseGenerationSchema, firstRequest)).kind).toBe(
      "ok",
    );
    const staged = await box.eventually(
      () =>
        box.assertEvents().flatMap((event) => {
          const value =
            event.message && AnyMessages.unpack(event.message, ReleaseNotesStagedSchema);
          return value ? [value] : [];
        }),
      (events) => events.length === 1,
    );
    expect(staged[0]?.document?.sections[0]?.entries[0]?.evidence[0]?.path).toBe("notes.txt");
    expect(providerBodies).toHaveLength(3);
    expect(JSON.stringify(providerBodies[1])).toContain('"type":"function_call_output"');
    const history = await box.readAgentHistory(ReleaseNotesAgent, id, { pageSize: 40 });
    const outcomes = history.items.flatMap((entry) => {
      if (entry.item.case !== "conversationRecord" || !entry.item.value.content) return [];
      const response = AnyMessages.unpack(entry.item.value.content, GenerationResponseSchema);
      return response ? [response.outcome] : [];
    });
    expect(outcomes).toEqual([
      AiOutcome.ADMITTED,
      AiOutcome.INVALID_OUTPUT,
      AiOutcome.TOOL_REQUESTED,
    ]);
    expect((await box.asGuest().post(RequestReleaseGenerationSchema, firstRequest)).kind).toBe(
      "ok",
    );
    const acknowledged = await box.eventually(
      () =>
        box.assertEvents().flatMap((event) => {
          const value =
            event.message &&
            AnyMessages.unpack(event.message, ReleaseGenerationAlreadyRequestedSchema);
          return value ? [value] : [];
        }),
      (events) => events.length === 1,
    );
    expect(acknowledged[0]?.generation?.value).toBe("generation-1");
    expect(providerBodies).toHaveLength(3);
    comparisonAvailable = false;
    const current = await context.stand().readVersioned(ReleaseDraftStateSchema, id);
    if (!current?.version) throw new Error("Staged draft has no Entity Version.");
    expect(
      (
        await box.asGuest().post(
          RequestReleaseGenerationSchema,
          create(RequestReleaseGenerationSchema, {
            id,
            generation: create(ReleaseGenerationIdSchema, { value: "generation-2" }),
            expectedVersion: current.version,
            catalog: create(ReleaseEvidenceCatalogSchema),
            instruction: create(ReleaseInstructionSchema, { value: "Revise notes" }),
            conversation: create(ConversationIdSchema, { value: "release-agent-conversation" }),
            selection: create(ReleaseModelSelectionSchema, {
              registration: "fixture-registration",
              account: "fixture-account",
              model: model.ref,
            }),
          }),
        )
      ).kind,
    ).toBe("ok");
    const failed = await box.eventually(
      () =>
        box.assertEvents().flatMap((event) => {
          const value =
            event.message && AnyMessages.unpack(event.message, ReleaseGenerationFailedSchema);
          return value ? [value] : [];
        }),
      (events) => events.length === 1,
    );
    expect(failed[0]?.generation?.value).toBe("generation-2");
    expect(failed[0]?.reason).toBe("AUTHENTICATION_REQUIRED");
    expect(failed[0]?.operation?.value).toBeTruthy();
    expect(providerBodies).toHaveLength(3);
  } finally {
    await box.close();
    await new Promise<void>((done) =>
      server.close(() => {
        done();
      }),
    );
    rmSync(directory, { recursive: true, force: true });
  }
}, 45_000);
