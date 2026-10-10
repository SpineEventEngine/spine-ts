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

import { createServer } from "node:http";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain } from "electron";

const scriptIndex = process.argv.findIndex((value) => value.endsWith("studio-ui-harness.mjs"));
const [appRoot, repository, exportPath, base, target] = process.argv.slice(scriptIndex + 1);
if (!appRoot || !repository || !exportPath || !base || !target)
  throw new Error("UI fixture paths and revisions are required.");
const packaged = async (path) => import(pathToFileURL(join(appRoot, path)).href);
const { ReleaseStudio } = await packaged("src/trusted/studio-service.mjs");
const { PlanModelSelection } = await packaged("src/trusted/plan-model-selection.mjs");
const { StudioDesktop } = await packaged("src/trusted/studio-desktop.mjs");
const { isStudioIpcCommand, validateStudioIpc } = await packaged("src/trusted/studio-ipc.mjs");
const { windowOptions } = await packaged("src/trusted/window-options.mjs");

let attempts = 0;
const server = createServer((request, response) => {
  void (async () => {
    if (request.headers.authorization !== "Bearer fixture-token")
      throw new Error("Missing plan token.");
    for await (const chunk of request) {
      void chunk;
    }
    response.setHeader("content-type", "text/event-stream");
    response.end(providerResponse(++attempts));
  })().catch(() => response.writeHead(500).end());
});

const account = {
  accounts: [{ clientId: "client", subject: "subject", planEnabled: true }],
  selectedClientId: "client",
  planEnabled: true,
  pendingClientIds: [],
};
const plan = new PlanModelSelection(
  { status: async () => account },
  {
    models: async () => [{ slug: "fixture-model", displayName: "Release writing model" }],
    accessToken: async () => "fixture-token",
  },
);

void app.whenReady().then(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Provider fixture unavailable.");
  const providerUrl = `http://127.0.0.1:${String(address.port)}/v1/responses`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return originalFetch(url === "https://api.openai.com/v1/responses" ? providerUrl : input, init);
  };

  const studio = await ReleaseStudio.start({
    gitExecutable: "/usr/bin/git",
    workerExecutable: process.execPath,
    workerPath: join(appRoot, "src/git-worker.mjs"),
    workerCwd: repository,
    registryRoot: pathToFileURL(`${appRoot}/`),
    plan,
  });
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [repository] });
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: exportPath });
  const rendererPath = join(appRoot, "renderer.html");
  const window = new BrowserWindow(windowOptions(join(appRoot, "preload.cjs")));
  ipcMain.handle("release-notes:command", async (event, command, argument) => {
    if (
      event.sender.id !== window.webContents.id ||
      event.senderFrame?.url !== pathToFileURL(rendererPath).href
    )
      throw new Error("Invalid sender.");
    if (isStudioIpcCommand(command))
      return StudioDesktop.action(window, studio, command, validateStudioIpc(command, argument));
    switch (command) {
      case "status":
        return account;
      case "models":
        return [{ slug: "fixture-model", displayName: "Release writing model" }];
      case "current-model":
        return { model: (await plan.activeBinding())?.model ?? "" };
      case "select-model":
        if (argument?.clientId !== "client" || argument.model !== "fixture-model")
          throw new Error("Invalid model selection.");
        await plan.selectDiscovered("client", "fixture-model");
        return { model: "fixture-model" };
      default:
        throw new Error("Unsupported fixture account action.");
    }
  });
  window.on("closed", () => {
    void studio.close().finally(() => server.close());
  });
  await window.loadFile(rendererPath);
});

function providerResponse(number) {
  const text = JSON.stringify({
    sections: [
      {
        heading: "Changes",
        entries: [
          {
            text: "CSV imports now check for a header row and explain which column is missing.",
            evidence: [{ commit: { value: target }, parent: { value: base }, path: "import.ts" }],
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
