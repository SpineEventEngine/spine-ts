/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import process from "node:process";
import { createInterface } from "node:readline";
import { setTimeout } from "node:timers";

if (process.env.MCP_SPAM_STDERR) process.stderr.write("x".repeat(200_000));
if (process.env.MCP_UNSOLICITED_STDOUT)
  process.stdout.write('{"jsonrpc":"2.0","id":1,"result":{}}\n');
if (process.env.MCP_IGNORE_SIGTERM) process.on("SIGTERM", () => undefined);
let toolCalls = 0;

for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  const result =
    request.method === "initialize"
      ? {
          protocolVersion: "2025-11-25",
          capabilities: { tools: {} },
          serverInfo: { name: "fixture", version: "1" },
        }
      : request.method === "tools/list"
        ? {
            tools: [
              {
                name: "lookup",
                description: "Lookup",
                inputSchema: {
                  type: "object",
                  properties: { ticket: { type: "string" } },
                  required: ["ticket"],
                  additionalProperties: false,
                },
              },
            ],
          }
        : {
            content: [
              {
                type: "text",
                text: process.env.MCP_REPORT_PID ? String(process.pid) : "from stdio",
              },
            ],
            isError: false,
          };
  if (request.method === "tools/call" && process.env.MCP_DELAY_MS) {
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.MCP_DELAY_MS)));
  }
  if (request.method === "tools/call" && process.env.MCP_DELAY_AFTER_FIRST && ++toolCalls > 1) {
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.MCP_DELAY_AFTER_FIRST)));
  }
  if (request.method === "tools/call" && process.env.MCP_OVERSIZE_OUTPUT) {
    process.stdout.write(`${"x".repeat(5_000)}\n`);
  } else if (request.method === "tools/call" && process.env.MCP_MALFORMED_OUTPUT) {
    process.stdout.write("{\n");
  } else if (request.method === "tools/call" && process.env.MCP_TRUNCATE_OUTPUT) {
    process.stdout.write("{", () => process.exit(0));
  } else if (request.method === "tools/call" && process.env.MCP_WRONG_ID) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: "wrong", result })}\n`);
  } else if (request.method === "tools/call" && process.env.MCP_EXTRA_OUTPUT) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\nextra\n`);
  } else if (request.method === "tools/call" && process.env.MCP_FRAGMENT_OUTPUT) {
    const output = `${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`;
    process.stdout.write(output.slice(0, 10));
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.stdout.write(output.slice(10));
  } else {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
  }
}
