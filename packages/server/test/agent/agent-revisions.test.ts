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

import { AiRegistry, Mcp } from "@spine-event-engine/ai";
import { describe, expect, it } from "vitest";
import { SupportReplyAgentStateSchema } from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
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

function registry(revision: string, resultBytes: number, url = "https://example.test/mcp") {
  return AiRegistry.create({
    defaultModels: {},
    invocationLimits: limits,
    concurrentOperations: 1,
    queuedOperations: 0,
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
      },
    }),
  );
}

describe("Agent MCP admission revision", () => {
  it("changes when registered server revision or tool policy changes", () => {
    const policy = (ai: AiRegistry) =>
      AgentRevisions.atAdmission(SupportReplyAgentStateSchema, [], ai, { models: [] }).policy;
    expect(policy(registry("v1", 100))).not.toBe(policy(registry("v2", 100)));
    expect(policy(registry("v1", 100))).not.toBe(policy(registry("v1", 200)));
    expect(policy(registry("v1", 100))).not.toBe(
      policy(registry("v1", 100, "https://example.test/other")),
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
