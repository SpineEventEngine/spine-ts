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

import { AiModel, AiRegistry, Mcp } from "@spine-event-engine/ai";
import { describe, expect, it } from "vitest";
import { SupportReplyAgentStateSchema } from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import {
  ProposedSupportReplySchema,
  SupportTicketFactsSchema,
} from "../../test-fixtures/generated/entity-metadata/support_ai_types_pb.js";
import { AgentRevisions } from "../../src/agent/agent-revisions.js";

const limits = {
  operations: 1,
  modelRequests: 1,
  toolCalls: 1,
  recordedReads: 0,
  deadlineMs: 1000,
  totalInputBytes: 1000,
  totalOutputBytes: 1000,
  maxRecoveryBytes: 1000,
};

const proposal = AiModel.define({
  name: "revision-support-reply",
  version: "v1",
  kind: "generation",
  input: SupportTicketFactsSchema,
  output: ProposedSupportReplySchema,
  instructions: "Draft a support reply.",
  outputMode: "prompt-and-validate",
  tools: [{ server: "lookup", tool: "search" }],
  limits: {
    modelRequests: 1,
    toolCalls: 1,
    deadlineMs: 1_000,
    maxInputBytes: 1_000,
    maxOutputBytes: 1_000,
  },
});

function registry(
  revision: string,
  resultBytes: number,
  url = "https://example.test/mcp",
  concurrentOperations = 1,
  extraToolBytes = 100,
) {
  return AiRegistry.create({
    defaultModels: {},
    invocationLimits: limits,
    concurrentOperations,
    queuedOperations: concurrentOperations - 1,
  }).registerTools(
    Mcp.server({
      id: "lookup",
      revision,
      transport: { kind: "streamable-http", url },
      authorizeConnect: () => true,
      tools: {
        search: {
          effect: "read",
          timeoutMs: 100,
          maxArgumentBytes: 100,
          maxResultBytes: resultBytes,
          authorize: () => true,
        },
        archive: {
          effect: "read",
          timeoutMs: 100,
          maxArgumentBytes: 100,
          maxResultBytes: extraToolBytes,
          authorize: () => true,
        },
      },
    }),
  );
}

describe("Agent MCP admission revision", () => {
  it("changes when registered server revision or tool policy changes", () => {
    const policy = (ai: AiRegistry) =>
      AgentRevisions.atAdmission(SupportReplyAgentStateSchema, [], ai, { models: [proposal] })
        .policy;
    expect(policy(registry("v1", 100))).not.toBe(policy(registry("v2", 100)));
    expect(policy(registry("v1", 100))).not.toBe(policy(registry("v1", 200)));
    expect(policy(registry("v1", 100))).not.toBe(
      policy(registry("v1", 100, "https://example.test/other")),
    );
  });

  it("keeps accepted work compatible across capacity and unrelated tool changes", () => {
    const policy = (ai: AiRegistry) =>
      AgentRevisions.atAdmission(SupportReplyAgentStateSchema, [], ai, { models: [proposal] })
        .policy;
    expect(policy(registry("v1", 100))).toBe(policy(registry("v1", 100, undefined, 3)));
    expect(policy(registry("v1", 100))).toBe(policy(registry("v1", 100, undefined, 1, 200)));
    const extraServer = registry("v1", 100).registerTools(
      Mcp.server({
        id: "unrelated",
        revision: "v2",
        transport: { kind: "streamable-http", url: "https://example.test/extra" },
        authorizeConnect: () => true,
        tools: {
          inspect: {
            effect: "read",
            timeoutMs: 100,
            maxArgumentBytes: 100,
            maxResultBytes: 100,
            authorize: () => true,
          },
        },
      }),
    );
    expect(policy(registry("v1", 100))).toBe(policy(extraServer));
    expect(
      AgentRevisions.atAdmission(SupportReplyAgentStateSchema, [], registry("v1", 100), {
        models: [],
      }).policy,
    ).toBe(
      AgentRevisions.atAdmission(SupportReplyAgentStateSchema, [], registry("v2", 200), {
        models: [],
      }).policy,
    );
  });

  it("does not resolve credentials while hashing registered policy", () => {
    let callbacks = 0;
    const ai = AiRegistry.create({
      defaultModels: {},
      invocationLimits: limits,
      concurrentOperations: 1,
      queuedOperations: 0,
    }).registerTools(
      Mcp.server({
        id: "lookup",
        revision: "v1",
        transport: {
          kind: "streamable-http",
          url: "https://example.test/mcp",
          headers: () => {
            callbacks++;
            return { Authorization: "secret" };
          },
        },
        authorizeConnect: () => {
          callbacks++;
          return true;
        },
        tools: {
          search: {
            effect: "read",
            timeoutMs: 100,
            maxArgumentBytes: 100,
            maxResultBytes: 100,
            authorize: () => {
              callbacks++;
              return true;
            },
          },
        },
      }),
    );
    expect(
      AgentRevisions.atAdmission(SupportReplyAgentStateSchema, [], ai, { models: [] }).policy,
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(callbacks).toBe(0);
  });
});
