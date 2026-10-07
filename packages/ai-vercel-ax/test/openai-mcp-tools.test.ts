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

import { createOpenAI } from "@ai-sdk/openai";
import { describe, expect, it, vi } from "vitest";

describe("pinned OpenAI Responses tool serialization", () => {
  it("sends the accepted MCP schema as a client function without provider-hosted MCP", async () => {
    let sent: unknown;
    const network = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected serialized provider request");
      sent = JSON.parse(init.body) as unknown;
      return Promise.resolve(
        new Response("data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        }),
      );
    });
    const openai = createOpenAI({ apiKey: "fixture-only", fetch: network });
    const model = openai.responses("gpt-4.1");
    const schema = {
      type: "object" as const,
      properties: { ticket: { type: "string" as const } },
      required: ["ticket"],
      additionalProperties: false,
    };
    const response = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Find ticket" }] }],
      tools: [
        {
          type: "function",
          name: "tool_0",
          description: "Lookup a support ticket",
          inputSchema: schema,
        },
      ],
      responseFormat: { type: "text" },
    });
    expect(sent).toMatchObject({
      tools: [
        {
          type: "function",
          name: "tool_0",
          description: "Lookup a support ticket",
          parameters: schema,
          strict: false,
        },
      ],
    });
    expect(network).toHaveBeenCalledTimes(1);
    await response.stream.cancel();
  });
});
