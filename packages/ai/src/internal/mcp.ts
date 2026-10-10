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

import type { McpServerDefinition, McpToolPolicy, McpTransport } from "./contracts.js";
import { nonblank, positiveInteger } from "./model.js";

const mcpServerBrand: unique symbol = Symbol("SpineMcpServer");
const mcpDefinitions = new WeakMap<object, McpServerDefinition>();

/**
 * Factory-created MCP server configuration accepted by the registry.
 */
export interface McpServerRegistration {
  /**
   * Private marker carried only by a factory-created MCP registration.
   */
  readonly [mcpServerBrand]: true;

  /**
   * Validated MCP server identifier.
   */
  readonly id: string;
}

/**
 * Copies an application-defined transport without retaining mutable arrays.
 * @param transport Streamable HTTP or local stdio configuration.
 * @returns Immutable transport options.
 */
const copyTransport = (transport: McpTransport): McpTransport => {
  if (transport.kind === "streamable-http") {
    let url: URL;
    try {
      url = new URL(nonblank(transport.url, "transport.url"));
    } catch {
      throw new TypeError("transport.url must be absolute HTTP URL");
    }
    if (!(["http:", "https:"] as string[]).includes(url.protocol))
      throw new TypeError("transport.url must be HTTP or HTTPS");
    if (url.username || url.password) throw new TypeError("transport.url cannot embed credentials");
    if (url.hash) throw new TypeError("transport.url cannot contain a fragment");
    return Object.freeze({
      kind: "streamable-http",
      url: url.href,
      ...(transport.headers ? { headers: transport.headers } : {}),
    });
  }
  const kind: unknown = transport.kind;
  if (kind !== "stdio") throw new TypeError("MCP transport kind is unsupported");
  const executable = nonblank(transport.executable, "transport.executable");
  if (!absolutePath(executable)) throw new TypeError("transport.executable must be absolute");
  if (transport.cwd && !absolutePath(transport.cwd))
    throw new TypeError("transport.cwd must be absolute");
  if (!Array.isArray(transport.args) || transport.args.some((arg) => typeof arg !== "string"))
    throw new TypeError("transport.args must be fixed strings");
  return Object.freeze({
    kind: "stdio",
    executable,
    args: Object.freeze(Array.from(transport.args, (argument: string) => argument)),
    ...(transport.cwd ? { cwd: transport.cwd } : {}),
    ...(transport.environment ? { environment: transport.environment } : {}),
  });
};

/**
 * Checks a configured executable or directory path.
 * @param path Application-supplied path.
 * @returns Whether the path is absolute on POSIX or Windows.
 */
const absolutePath = (path: string): boolean => {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path);
};

/**
 * Copies one bounded authorization policy.
 * @param name Advertised exact tool name.
 * @param policy Application policy.
 * @returns Frozen validated policy.
 */
const copyPolicy = (name: string, policy: McpToolPolicy): McpToolPolicy => {
  nonblank(name, "tool name");
  const effect: unknown = policy.effect;
  if (effect !== "read" && effect !== "write")
    throw new TypeError(`tool ${name} effect is unsupported`);
  if (typeof policy.authorize !== "function")
    throw new TypeError(`tool ${name} authorize is required`);
  return Object.freeze({
    effect: policy.effect,
    timeoutMs: positiveInteger(policy.timeoutMs, `tool ${name} timeoutMs`),
    maxArgumentBytes: positiveInteger(policy.maxArgumentBytes, `tool ${name} maxArgumentBytes`),
    maxResultBytes: positiveInteger(policy.maxResultBytes, `tool ${name} maxResultBytes`),
    authorize: policy.authorize,
  });
};

/**
 * Defines application-approved MCP servers without creating a connection.
 */
export const Mcp = {
  /**
   * Validates and snapshots explicit connection and tool policy.
   * @param definition Application MCP configuration.
   * @returns Factory-created registry entry.
   */
  server(definition: McpServerDefinition): McpServerRegistration {
    const id = nonblank(definition.id, "MCP server id");
    const revision = nonblank(definition.revision, "MCP server revision");
    if (typeof definition.authorizeConnect !== "function")
      throw new TypeError("authorizeConnect callback is required");
    const tools = Object.fromEntries(
      Object.entries(definition.tools).map(([name, policy]) => [name, copyPolicy(name, policy)]),
    );
    if (Object.keys(tools).length === 0) throw new TypeError("MCP server tools are required");
    const copy = Object.freeze({
      id,
      revision,
      transport: copyTransport(definition.transport),
      authorizeConnect: definition.authorizeConnect,
      tools: Object.freeze(tools),
    });
    const registration = Object.freeze({ [mcpServerBrand]: true as const, id });
    mcpDefinitions.set(registration, copy);
    return registration;
  },
};

/**
 * Reads a validated MCP policy after checking runtime provenance.
 * @param registration Candidate configuration.
 * @returns Original frozen settings.
 */
export const mcpDefinition = (registration: McpServerRegistration): McpServerDefinition => {
  const candidate: unknown = registration;
  const definition =
    typeof candidate === "object" && candidate !== null ? mcpDefinitions.get(candidate) : undefined;
  if (!definition) throw new TypeError("MCP registration must come from a factory");
  return definition;
};
