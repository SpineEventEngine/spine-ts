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

import { createServer, type Server, type ServerResponse } from "node:http";

interface RpcRequest {
  readonly method?: string;
  readonly id?: string | number;
}

const stream = (events: readonly object[]): string =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

const toolProposal = (mode: "write" | "read"): string =>
  stream([
    {
      type: "response.created",
      response: { id: `${mode}-1`, created_at: 1, model: "fixture-model" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        type: "function_call",
        id: `${mode}-call-1`,
        call_id: `provider-${mode}-1`,
        name: "tool_0",
        arguments: '{"ticket":"T-WRITE"}',
      },
    },
    {
      type: "response.function_call_arguments.done",
      item_id: `${mode}-call-1`,
      output_index: 0,
      arguments: '{"ticket":"T-WRITE"}',
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "function_call",
        id: `${mode}-call-1`,
        call_id: `provider-${mode}-1`,
        name: "tool_0",
        arguments: '{"ticket":"T-WRITE"}',
        status: "completed",
      },
    },
    {
      type: "response.completed",
      response: {
        id: `${mode}-1`,
        status: "completed",
        usage: { input_tokens: 5, output_tokens: 3 },
      },
    },
  ]);

const lookupReply = (): string =>
  stream([
    {
      type: "response.created",
      response: { id: "lookup-2", created_at: 2, model: "fixture-model" },
    },
    {
      type: "response.output_text.delta",
      item_id: "lookup-message-2",
      delta: '{"replyText":"Ticket found; we can help."}',
    },
    {
      type: "response.completed",
      response: {
        id: "lookup-2",
        status: "completed",
        usage: { input_tokens: 8, output_tokens: 6 },
      },
    },
  ]);

function rpcReply(request: RpcRequest, mode: "write" | "read"): object | undefined {
  if (request.method === "initialize")
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "escalation-fixture", version: "1" },
      },
    };
  if (request.method === "tools/list")
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: [
          {
            name: mode === "write" ? "escalate" : "lookup",
            description:
              mode === "write" ? "Escalate a support ticket" : "Look up a support ticket",
            inputSchema: {
              type: "object",
              properties: { ticket: { type: "string" } },
              required: ["ticket"],
              additionalProperties: false,
            },
          },
        ],
      },
    };
  return undefined;
}

export interface ToolEndpoint {
  readonly base: string;
  readonly providerRequests: number;
  readonly writeCalls: number;
  readonly readCalls: number;
  waitForWrite(): Promise<void>;
  close(): Promise<void>;
}

export async function startToolEndpoint(mode: "write" | "read" = "write"): Promise<ToolEndpoint> {
  let providerRequests = 0;
  let writeCalls = 0;
  let readCalls = 0;
  let observeWrite!: () => void;
  const written = new Promise<void>((resolve) => {
    observeWrite = resolve;
  });
  const pending = new Set<ServerResponse>();
  const server: Server = createServer((request, response) => {
    void (async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of request) chunks.push(chunk as Uint8Array);
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (request.url === "/v1/responses") {
        providerRequests += 1;
        response.setHeader("content-type", "text/event-stream");
        response.end(mode === "read" && providerRequests > 1 ? lookupReply() : toolProposal(mode));
        return;
      }
      const rpc = body as RpcRequest;
      if (rpc.method === "tools/call") {
        if (mode === "write") {
          writeCalls += 1;
          pending.add(response);
          observeWrite();
        } else {
          readCalls += 1;
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: rpc.id,
              result: { content: [{ type: "text", text: "Ticket found" }], isError: false },
            }),
          );
        }
        return;
      }
      const reply = rpcReply(rpc, mode);
      if (reply === undefined) response.writeHead(202).end();
      else {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(reply));
      }
    })().catch(() => response.writeHead(500).end());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Tool fixture address unavailable.");
  return {
    base: `http://127.0.0.1:${String(address.port)}`,
    get providerRequests() {
      return providerRequests;
    },
    get writeCalls() {
      return writeCalls;
    },
    get readCalls() {
      return readCalls;
    },
    waitForWrite: () =>
      new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Physical MCP write was not sent."));
        }, 20_000);
        void written.then(() => {
          clearTimeout(timeout);
          resolve();
        });
      }),
    close: async () => {
      for (const response of pending) response.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
