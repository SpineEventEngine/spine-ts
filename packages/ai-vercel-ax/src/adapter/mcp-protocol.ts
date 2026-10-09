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

import { createHash } from "node:crypto";
import { Ajv, type ValidateFunction } from "ajv";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type {
  AiMcpProtocolFactory,
  AiMcpProtocolSession,
  AiMcpToolDefinition,
  AiMcpToolResult,
  AiMcpResultContent,
} from "@spine-event-engine/ai/spi/adapter";
import { AiMcpSetupFailure } from "@spine-event-engine/ai/spi/adapter";
import { BoundedMcpHttpTransport } from "./mcp-http-transport.js";
import { BoundedMcpStdioTransport } from "./mcp-stdio-transport.js";
import { scheduleBoundedDeadline } from "./deadline.js";
import type { AiMcpProtocolControl } from "@spine-event-engine/ai/spi/adapter";

const maximumPages = 8;
const maximumTools = 64;
const maximumDescriptionBytes = 4_096;
const maximumSchemaBytes = 16_384;
const supportedSchemaKeys = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "description",
  "title",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
]);

/**
 * Connects the pinned SDK client through one bounded transport.
 * @param options Scoped MCP connection and runtime controls.
 * @returns Negotiated protocol session with credential-free identity.
 */
const connectMcp: AiMcpProtocolFactory["connect"] = async ({ server, resolved, control }) => {
  const { transport, endpoint } = connectionSettings({ server, resolved, control });
  let client: MCPClient;
  try {
    client = await createMCPClient({
      transport,
      maxRetries: 0,
      protocolVersionDiscovery: false,
      initializationOptions: { signal: control.signal },
    });
  } catch (error) {
    await transport.close();
    throw error;
  }
  return new VercelMcpSession(client, transport, control, server.id, server.revision, endpoint);
};

/**
 * Builds the bounded transport and credential-free configured endpoint identity.
 * @param options Scoped MCP connection and runtime controls.
 * @returns Transport and endpoint digest, without resolved credentials.
 */
const connectionSettings = ({
  server,
  resolved,
  control,
}: Pick<Parameters<AiMcpProtocolFactory["connect"]>[0], "server" | "resolved" | "control">) => {
  const configured = server.transport;
  const transport =
    configured.kind === "streamable-http"
      ? new BoundedMcpHttpTransport(configured.url, resolved.headers ?? {}, control)
      : new BoundedMcpStdioTransport(
          configured.executable,
          configured.args,
          configured.cwd,
          resolved.environment ?? {},
          control,
        );
  const fingerprint =
    configured.kind === "streamable-http"
      ? configured.url
      : JSON.stringify([configured.executable, configured.args, configured.cwd]);
  const endpoint = `sha256:${createHash("sha256").update(fingerprint).digest("hex")}`;
  return { transport, endpoint };
};

/**
 * Creates an MCP transport factory backed by the pinned Vercel client.
 * @returns Runtime-independent MCP transport factory using the pinned Vercel client.
 */
export const createMcpProtocolFactory = (): AiMcpProtocolFactory => ({ connect: connectMcp });

/**
 * One initialized SDK client with bounded discovery and local argument validation.
 */
class VercelMcpSession implements AiMcpProtocolSession {
  readonly identity;

  private validators = new Map<string, ValidateFunction>();

  private outputValidators = new Map<string, ValidateFunction>();

  /**
   * Binds the negotiated client to one credential-free configured identity.
   * @param client Initialized Vercel MCP client.
   * @param transport Bounded physical-message transport.
   * @param control Fenced runtime protocol controls.
   * @param serverId Configured server identifier.
   * @param revision Configured server revision.
   * @param endpoint Digest of the exact configured endpoint.
   */
  constructor(
    private readonly client: MCPClient,
    private readonly transport: BoundedMcpHttpTransport | BoundedMcpStdioTransport,
    private readonly control: AiMcpProtocolControl,
    serverId: string,
    revision: string,
    endpoint: string,
  ) {
    this.identity = Object.freeze({ serverId, revision, endpoint });
  }

  /**
   * Lists only explicitly permitted names with a finite page and schema budget.
   * @param allowedNames Registered names for this invocation.
   * @returns Accepted bounded definitions.
   */
  async discover(allowedNames: readonly string[]): Promise<readonly AiMcpToolDefinition[]> {
    this.validators.clear();
    this.outputValidators.clear();
    const pendingValidators = new Map<string, ValidateFunction>();
    const pendingOutputValidators = new Map<string, ValidateFunction>();
    const allowed = new Set(allowedNames);
    const result: AiMcpToolDefinition[] = [];
    const seen = new Set<string>();
    const cursors = new Set<string>();
    const ajv = new Ajv({ allErrors: false, strict: true, validateSchema: true });
    let cursor: string | undefined;
    for (let page = 0; page < maximumPages; page += 1) {
      const listing = await this.client.listTools({ params: cursor ? { cursor } : undefined });
      cursor = this.acceptPage(
        listing,
        allowed,
        seen,
        ajv,
        pendingValidators,
        pendingOutputValidators,
        result,
      );
      if (!cursor) {
        this.validators = pendingValidators;
        this.outputValidators = pendingOutputValidators;
        return Object.freeze(result);
      }
      if (cursors.has(cursor)) throw new AiMcpSetupFailure("UNSUPPORTED_CAPABILITY");
      cursors.add(cursor);
    }
    throw new AiMcpSetupFailure("UNSUPPORTED_CAPABILITY");
  }

  /**
   * Validates only a received discovery page, preserving listTools transport errors.
   *
   * @param listing SDK-decoded protocol page.
   * @param allowed Configured names.
   * @param seen Names from prior pages.
   * @param ajv Local schema compiler.
   * @param inputs Staged argument validators.
   * @param outputs Staged result validators.
   * @param result Staged model-visible definitions.
   * @returns Continuation cursor, if present.
   */
  private acceptPage(
    listing: Awaited<ReturnType<MCPClient["listTools"]>>,
    allowed: Set<string>,
    seen: Set<string>,
    ajv: Ajv,
    inputs: Map<string, ValidateFunction>,
    outputs: Map<string, ValidateFunction>,
    result: AiMcpToolDefinition[],
  ): string | undefined {
    try {
      if (listing.tools.length + seen.size > maximumTools)
        throw new Error("MCP discovery exceeds tool limit");
      collectTools(listing.tools, allowed, seen, ajv, inputs, outputs, result);
      return listing.nextCursor;
    } catch {
      throw new AiMcpSetupFailure("UNSUPPORTED_CAPABILITY");
    }
  }

  /**
   * Rejects unadvertised names and malformed arguments before any tool send.
   * @param name Discovered tool name.
   * @param canonicalJson Serialized argument object.
   */
  validateArguments(name: string, canonicalJson: string): void {
    const validate = this.validators.get(name);
    if (!validate) throw new Error("MCP tool was not advertised");
    if (Buffer.byteLength(canonicalJson) > maximumSchemaBytes)
      throw new Error("MCP arguments exceed local limit");
    let value: unknown;
    try {
      value = JSON.parse(canonicalJson);
    } catch {
      throw new Error("MCP arguments are not JSON");
    }
    if (!validate(value)) throw new Error("MCP arguments violate accepted schema");
  }

  /**
   * Calls one validated tool using a runtime-journaled tool-call ticket.
   * @param name Discovered tool name.
   * @param canonicalJson Locally validated argument object.
   * @param options Runtime call identity, cancellation and result limit.
   * @returns Bounded text or structured JSON result.
   */
  async call(
    name: string,
    canonicalJson: string,
    options: {
      toolCallId: string;
      signal: AbortSignal;
      deadlineEpochMs: number;
      maxResultBytes: number;
    },
  ): Promise<AiMcpToolResult> {
    this.validateArguments(name, canonicalJson);
    const args = JSON.parse(canonicalJson) as Record<string, unknown>;
    const deadline = new AbortController();
    const stopDeadline = scheduleBoundedDeadline(
      options.deadlineEpochMs,
      this.control.nowEpochMs,
      () => {
        deadline.abort();
      },
    );
    const signal = AbortSignal.any([options.signal, deadline.signal]);
    this.transport.setCallTicket(options.toolCallId, options.maxResultBytes);
    try {
      if (signal.aborted) throw new Error("MCP call deadline or cancellation");
      const result = await this.client.callTool({ name, arguments: args, options: { signal } });
      validateToolOutput(result, this.outputValidators.get(name));
      return convertResult(result, options.maxResultBytes);
    } finally {
      stopDeadline();
      if (signal.aborted) await this.transport.close();
      this.transport.clearCallTicket();
    }
  }

  /**
   * Closes the SDK session and active transport requests.
   * @returns Completion after SDK session and active transport requests close.
   */
  async close(): Promise<void> {
    await this.transport.close();
    await this.client.close();
  }
}

/**
 * Validates one discovery page without publishing a partial callable catalog.
 * @param tools Tool definitions from one protocol page.
 * @param allowed Explicitly registered names.
 * @param seen Names from prior pages.
 * @param ajv Local schema compiler.
 * @param inputs Staged argument validators.
 * @param outputs Staged result validators.
 * @param result Staged model-visible definitions.
 */
const collectTools = (
  tools: readonly {
    name: string;
    description?: string | undefined;
    inputSchema: unknown;
    outputSchema?: unknown;
  }[],
  allowed: Set<string>,
  seen: Set<string>,
  ajv: Ajv,
  inputs: Map<string, ValidateFunction>,
  outputs: Map<string, ValidateFunction>,
  result: AiMcpToolDefinition[],
): void => {
  for (const tool of tools) {
    if (seen.has(tool.name)) throw new Error("MCP discovery repeats tool name");
    seen.add(tool.name);
    if (!allowed.has(tool.name)) continue;
    const accepted = acceptTool(
      tool.name,
      tool.description ?? "",
      tool.inputSchema,
      tool.outputSchema,
      ajv,
    );
    inputs.set(tool.name, accepted.validator);
    if (accepted.outputValidator) outputs.set(tool.name, accepted.outputValidator);
    result.push(accepted.definition);
  }
};

/**
 * Accepts a bounded JSON Schema subset before its definition reaches a model.
 */
const acceptTool = (
  name: string,
  description: string,
  schema: unknown,
  outputSchema: unknown,
  ajv: Ajv,
): {
  definition: AiMcpToolDefinition;
  validator: ValidateFunction;
  outputValidator?: ValidateFunction;
} => {
  if (Buffer.byteLength(description) > maximumDescriptionBytes)
    throw new Error("MCP tool description exceeds limit");
  const normalized = withoutKnownDialect(schema);
  const schemaJson = JSON.stringify(canonicalJsonValue(normalized));
  if (!schemaJson || Buffer.byteLength(schemaJson) > maximumSchemaBytes)
    throw new Error("MCP tool schema exceeds limit");
  assertSchemaSubset(normalized, 0);
  const validator = ajv.compile(normalized as Record<string, unknown>);
  const output = compileOutputSchema(outputSchema, ajv);
  return {
    definition: Object.freeze({
      name,
      description,
      inputSchemaJson: schemaJson,
      ...(output === undefined ? {} : { outputSchemaJson: output.json }),
    }),
    validator,
    ...(output === undefined ? {} : { outputValidator: output.validator }),
  };
};

/**
 * Compiles a bounded advertised output schema without exposing untrusted schema text.
 * @param schema Advertised output schema, when supplied.
 * @param ajv Strict local JSON Schema compiler.
 * @returns Canonical schema text and validator, or absence when unadvertised.
 */
const compileOutputSchema = (
  schema: unknown,
  ajv: Ajv,
): { json: string; validator: ValidateFunction } | undefined => {
  if (schema === undefined) return undefined;
  try {
    const normalized = withoutKnownDialect(schema);
    const json = JSON.stringify(canonicalJsonValue(normalized));
    if (!json || Buffer.byteLength(json) > maximumSchemaBytes) throw new Error("schema size");
    assertSchemaSubset(normalized, 0);
    if ((normalized as Record<string, unknown>).type !== "object") throw new Error("schema root");
    return { json, validator: ajv.compile(normalized as Record<string, unknown>) };
  } catch {
    throw new Error("MCP output schema unsupported");
  }
};

/**
 * Drops only the SDK v2 root dialect marker for the shared supported subset.
 *
 * @param schema Advertised tool schema.
 * @returns Detached schema without its exact known dialect declaration.
 */
const withoutKnownDialect = (schema: unknown): unknown => {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return schema;
  const source = schema as Record<string, unknown>;
  if (!("$schema" in source)) return source;
  if (source.$schema !== "https://json-schema.org/draft/2020-12/schema")
    throw new Error("MCP schema dialect unsupported");
  const detached = { ...source };
  delete detached.$schema;
  return detached;
};

/**
 * Rejects a successful result that omits or violates its advertised structure.
 * @param result Bounded SDK call result from the untrusted server.
 * @param validator Compiled advertised output schema, when present.
 */
const validateToolOutput = (result: unknown, validator?: ValidateFunction): void => {
  if (!validator || typeof result !== "object" || result === null) return;
  const value = result as Record<string, unknown>;
  if (value.isError === true) return;
  if (value.structuredContent === undefined)
    throw new Error("MCP structured result required by output schema");
  if (!validator(value.structuredContent)) throw new Error("MCP result violates output schema");
};

/**
 * Returns recursively sorted object keys for equivalent discovery schemas.
 * @param value JSON value to canonicalize.
 * @returns The same JSON value with recursively sorted object keys.
 */
export const canonicalJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, part]) => [key, canonicalJsonValue(part)]),
  );
};

/**
 * Rejects remote references, extension headers and unbounded validator features.
 */
const assertSchemaSubset = (value: unknown, depth: number): void => {
  if (depth > 12) throw new Error("MCP schema nesting exceeds limit");
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("MCP schema must be an object");
  for (const [key, part] of Object.entries(value as Record<string, unknown>)) {
    if (!supportedSchemaKeys.has(key)) throw new Error(`MCP schema keyword ${key} unsupported`);
    if (key === "properties") {
      if (typeof part !== "object" || part === null || Array.isArray(part))
        throw new Error("MCP schema properties invalid");
      for (const nested of Object.values(part)) assertSchemaSubset(nested, depth + 1);
    }
    if (key === "items" || (key === "additionalProperties" && typeof part === "object"))
      assertSchemaSubset(part, depth + 1);
  }
};

/**
 * Converts supported MCP text and structured JSON without binary/resource output.
 */
const convertResult = (result: unknown, maxBytes: number): AiMcpToolResult => {
  if (typeof result !== "object" || result === null) throw new Error("MCP result invalid");
  const value = result as Record<string, unknown>;
  if (!Array.isArray(value.content)) throw new Error("MCP result content unsupported");
  const content: AiMcpResultContent[] = value.content.map((part: unknown) => {
    if (typeof part !== "object" || part === null) throw new Error("MCP content unsupported");
    const item = part as Record<string, unknown>;
    if (item.type !== "text" || typeof item.text !== "string")
      throw new Error("MCP binary or resource content unsupported");
    return { kind: "text" as const, text: item.text };
  });
  if (value.structuredContent !== undefined) {
    const json = JSON.stringify(value.structuredContent);
    if (!json) throw new Error("MCP structured result unsupported");
    content.push({ kind: "json", json });
  }
  if (Buffer.byteLength(JSON.stringify(content)) > maxBytes)
    throw new Error("MCP result exceeds byte limit");
  return Object.freeze({ content: Object.freeze(content), isError: value.isError === true });
};
