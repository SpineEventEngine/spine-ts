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
import { Buffer } from "node:buffer";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import process from "node:process";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL, URL } from "node:url";

const appRoot = process.argv[2];
if (!appRoot) throw new Error("Packaged app root is required.");
const { ReleaseStudio } = await import(
  pathToFileURL(join(appRoot, "src/trusted/studio-service.mjs")).href
);
const { PlanModelSelection } = await import(
  pathToFileURL(join(appRoot, "src/trusted/plan-model-selection.mjs")).href
);
const repository = mkdtempSync(join(tmpdir(), "spine-packaged-agent-"));
const git = (...args) =>
  execFileSync("/usr/bin/git", args, { cwd: repository, encoding: "utf8" }).trim();
const server = createServer((request, response) => {
  void (async () => {
    for await (const chunk of request) {
      void chunk;
    }
    response.setHeader("content-type", "text/event-stream");
    response.end(studioResponse(++attempts, base, target));
  })().catch(() => response.writeHead(500).end());
});
let attempts = 0;
let studio;
let base;
let target;
try {
  git("init", "--quiet");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(repository, "notes.txt"), "Before\n");
  git("add", "notes.txt");
  git("commit", "--quiet", "-m", "Base");
  base = git("rev-parse", "HEAD");
  writeFileSync(join(repository, "notes.txt"), "After\n");
  git("commit", "--quiet", "-am", "Release");
  target = git("rev-parse", "HEAD");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Provider fixture did not start.");
  const providerUrl = `http://127.0.0.1:${String(address.port)}/v1/responses`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return originalFetch(url === "https://api.openai.com/v1/responses" ? providerUrl : input, init);
  };
  const plan = new PlanModelSelection(
    {
      status: async () => ({
        accounts: [{ clientId: "client", subject: "subject", planEnabled: true }],
        selectedClientId: "client",
        planEnabled: true,
        pendingClientIds: [],
      }),
    },
    {
      models: async () => [{ slug: "fixture-model", displayName: "Fixture" }],
      accessToken: async () => "fixture-token",
    },
  );
  await plan.selectDiscovered("client", "fixture-model");
  studio = await ReleaseStudio.start({
    gitExecutable: "/usr/bin/git",
    workerExecutable: process.execPath,
    workerPath: join(appRoot, "src/git-worker.mjs"),
    workerCwd: repository,
    registryRoot: pathToFileURL(`${appRoot}/`),
    plan,
  });
  const comparison = await studio.compare(repository, base, target);
  const draft = await studio.openDraft(comparison.selectionId, "Packaged release", "SDK users");
  const generation = await studio.requestGeneration(draft.id, "Explain the change");
  let current = await studio.readDraft(draft.id);
  for (let index = 0; index < 100 && current.generationStatus !== "staged"; index++) {
    await setTimeout(20);
    current = await studio.readDraft(draft.id);
  }
  if (current.generationStatus !== "staged")
    throw new Error(`Generation ${current.generationStatus}`);
  const preview = await studio.preview(draft.id);
  const approved = await studio.approve(draft.id, preview.version, preview.markdown);
  const exported = await studio.prepareExport(draft.id, approved.version);
  if (
    Buffer.compare(Buffer.from(exported), Buffer.from(preview.markdown)) !== 0 ||
    (await studio.generationPhase(generation)) !== "completed" ||
    attempts !== 2
  )
    throw new Error("Packaged Agent workflow was not complete.");
  process.stdout.write(JSON.stringify({ staged: true, attempts, approved: true, exported: true }));
} finally {
  await studio?.close();
  server.close();
  rmSync(repository, { recursive: true, force: true });
}

function studioResponse(number, parent, commit) {
  const text = JSON.stringify({
    sections: [
      {
        heading: "Changes",
        entries: [
          {
            text: "Changed release file.",
            evidence: [{ commit: { value: commit }, parent: { value: parent }, path: "notes.txt" }],
          },
        ],
      },
    ],
  });
  const item =
    number === 1
      ? {
          type: "function_call",
          id: "fc-1",
          call_id: "provider-call-1",
          name: "tool_0",
          namespace: "spine_mcp",
          arguments: "{}",
          status: "completed",
        }
      : {
          type: "message",
          id: "msg-2",
          role: "assistant",
          phase: "final_answer",
          content: [{ type: "output_text", text, annotations: [] }],
        };
  const events = [
    {
      type: "response.created",
      response: { id: `resp-${String(number)}`, created_at: number, model: "fixture-model" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item:
        number === 1
          ? {
              type: "function_call",
              id: "fc-1",
              call_id: "provider-call-1",
              name: "tool_0",
              namespace: "spine_mcp",
              arguments: "{}",
            }
          : { type: "message", id: "msg-2" },
    },
    number === 1
      ? {
          type: "response.function_call_arguments.done",
          item_id: "fc-1",
          output_index: 0,
          arguments: "{}",
        }
      : {
          type: "response.output_text.delta",
          item_id: "msg-2",
          output_index: 0,
          content_index: 0,
          delta: text,
        },
    { type: "response.output_item.done", output_index: 0, item },
    {
      type: "response.completed",
      response: {
        id: `resp-${String(number)}`,
        status: "completed",
        usage: { input_tokens: 10, output_tokens: 8 },
      },
    },
  ];
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}
