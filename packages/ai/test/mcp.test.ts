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

import { describe, expect, it } from "vitest";
import { AiRegistry, Mcp } from "../src/index.js";
import { mcpDefinition } from "../src/spi/runtime.js";

const policy = {
  effect: "read" as const,
  timeoutMs: 100,
  maxArgumentBytes: 100,
  maxResultBytes: 100,
  authorize: () => true,
};
const base = {
  id: "lookup",
  revision: "v1",
  authorizeConnect: () => true,
  tools: { search: policy },
};
const limits = {
  operations: 1,
  modelRequests: 1,
  toolCalls: 1,
  recordedReads: 0,
  deadlineMs: 1000,
  totalInputBytes: 100,
  totalOutputBytes: 100,
  maxRecoveryBytes: 100,
};

describe("MCP connection and authorization configuration", () => {
  it("accepts fixed stdio configuration and copies mutable arrays and policies", () => {
    const args = ["--safe"];
    const server = Mcp.server({
      ...base,
      transport: { kind: "stdio", executable: "/usr/bin/tool", cwd: "/tmp", args },
    });
    args.push("--unsafe");
    const config = mcpDefinition(server);
    expect(config.transport).toMatchObject({ kind: "stdio", args: ["--safe"] });
    expect(Object.isFrozen(config.tools.search)).toBe(true);
    expect(() => mcpDefinition({ ...server })).toThrow("factory");
    const registry = AiRegistry.create({
      defaultModels: {},
      invocationLimits: limits,
      concurrentOperations: 1,
      queuedOperations: 0,
    }).registerTools(server);
    expect(() => registry.registerTools(server)).toThrow("Duplicate");
  });

  it("retains deferred scoped header and environment callbacks", () => {
    const headers = () => ({ Authorization: "scoped" });
    const remote = Mcp.server({
      ...base,
      transport: {
        kind: "streamable-http",
        url: "https://example.test/mcp",
        headers,
      },
    });
    expect(mcpDefinition(remote).transport).toMatchObject({ headers });
    const environment = () => ({ TOKEN: "scoped" });
    const local = Mcp.server({
      ...base,
      id: "local",
      transport: {
        kind: "stdio",
        executable: "C:\\tools\\mcp.exe",
        args: [],
        environment,
      },
    });
    expect(mcpDefinition(local).transport).toMatchObject({ environment });
  });

  it("rejects malformed HTTP and stdio transport before a connection", () => {
    const server = (transport: unknown) => Mcp.server({ ...base, transport } as never);
    expect(() => server({ kind: "streamable-http", url: "relative" })).toThrow("absolute");
    expect(() => server({ kind: "streamable-http", url: "ftp://example.test" })).toThrow("HTTP");
    expect(() => server({ kind: "streamable-http", url: "https://x.test/mcp#frag" })).toThrow(
      "fragment",
    );
    expect(() => server({ kind: "stdio", executable: "relative", args: [] })).toThrow("absolute");
    expect(() =>
      server({ kind: "stdio", executable: "/bin/x", cwd: "relative", args: [] }),
    ).toThrow("cwd");
    expect(() => server({ kind: "stdio", executable: "/bin/x", args: [4] })).toThrow("args");
    expect(() => server({ kind: "pipe" })).toThrow("unsupported");
  });

  it("rejects missing callbacks, tools, and unbounded tool policies", () => {
    const server = (update: object) =>
      Mcp.server({
        ...base,
        transport: { kind: "streamable-http", url: "https://x.test" },
        ...update,
      } as never);
    expect(() => server({ authorizeConnect: undefined })).toThrow("authorizeConnect");
    expect(() => server({ tools: {} })).toThrow("tools");
    expect(() => server({ tools: { search: { ...policy, effect: "execute" } } })).toThrow("effect");
    expect(() => server({ tools: { search: { ...policy, authorize: undefined } } })).toThrow(
      "authorize",
    );
    expect(() => server({ tools: { search: { ...policy, timeoutMs: 0 } } })).toThrow("timeoutMs");
    expect(() => server({ tools: { search: { ...policy, maxArgumentBytes: 0 } } })).toThrow(
      "maxArgumentBytes",
    );
    expect(() => server({ tools: { search: { ...policy, maxResultBytes: 0 } } })).toThrow(
      "maxResultBytes",
    );
  });
});
