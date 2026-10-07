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
import {
  ProposedSupportReplySchema,
  SupportTicketFactsSchema,
} from "../../server/test-fixtures/generated/entity-metadata/support_ai_types_pb.js";
import { AiModel, AiRegistry, Mcp, ModelRef } from "../src/index.js";
import { createBackendRegistration } from "../src/spi/adapter.js";
import {
  backendDefinition,
  freezeRegistry,
  registryOptions,
  selectDeployment,
} from "../src/spi/runtime.js";

const limits = {
  operations: 2,
  modelRequests: 3,
  toolCalls: 0,
  recordedReads: 2,
  deadlineMs: 1000,
  totalInputBytes: 3000,
  totalOutputBytes: 3000,
  maxRecoveryBytes: 3000,
};
const capability = AiModel.define({
  name: "draft-support-reply",
  version: "v1",
  kind: "generation",
  input: SupportTicketFactsSchema,
  output: ProposedSupportReplySchema,
  instructions: "Draft a response",
  outputMode: "prompt-and-validate",
  limits: {
    modelRequests: 2,
    toolCalls: 0,
    deadlineMs: 900,
    maxInputBytes: 2000,
    maxOutputBytes: 2000,
    maxOutputTokens: 80,
  },
});
function deployment(name: string) {
  return createBackendRegistration({
    ref: ModelRef.of(name, "v1"),
    kind: "generation",
    supports: () => true,
    resolveIdentity: () => ({ provider: "local", account: "test", endpoint: "local", model: name }),
    authorizeUse: () => true,
    connect: (_scope, identity) => ({ model: {}, identity }),
    execute: () => Promise.reject(new Error("unused backend")),
  });
}

describe("application AI registry", () => {
  it("rejects fabricated registrations and invalid limits", () => {
    const registry = AiRegistry.create({
      defaultModels: {},
      invocationLimits: limits,
      concurrentOperations: 1,
      queuedOperations: 0,
    });
    expect(() =>
      registry.register({ ref: ModelRef.of("fake", "v1"), kind: "generation" } as never),
    ).toThrow("factory");
    expect(() =>
      AiRegistry.create({
        defaultModels: {},
        invocationLimits: { ...limits, totalOutputBytes: 0 },
        concurrentOperations: 1,
        queuedOperations: 0,
      }),
    ).toThrow("totalOutputBytes");
  });

  it("compares Proto references by value, applies precedence, and freezes configuration", () => {
    const app = deployment("app");
    const repo = deployment("repo");
    const instance = deployment("instance");
    const registry = AiRegistry.create({
      defaultModels: { generation: ModelRef.of("app", "v1") },
      invocationLimits: limits,
      concurrentOperations: 1,
      queuedOperations: 0,
    })
      .register(app)
      .register(repo)
      .register(instance);
    const selected = selectDeployment(registry, {
      kind: "generation",
      models: [capability],
      repositoryDefault: ModelRef.of("repo", "v1"),
      instancePreference: ModelRef.of("instance", "v1"),
      allowedModels: [ModelRef.of("instance", "v1")],
    });
    expect(selected.ref.name?.value).toBe("instance");
    expect(() =>
      selectDeployment(registry, {
        kind: "generation",
        models: [capability],
        repositoryDefault: ModelRef.of("repo", "v1"),
        allowedModels: [ModelRef.of("instance", "v1")],
      }),
    ).toThrow("allowed");
    freezeRegistry(registry);
    expect(() => registry.register(deployment("late"))).toThrow("frozen");
  });

  it("keeps a frozen default stable when internal options are observed", () => {
    const registry = AiRegistry.create({
      defaultModels: { generation: ModelRef.of("app", "v1") },
      invocationLimits: limits,
      concurrentOperations: 1,
      queuedOperations: 0,
    })
      .register(deployment("app"))
      .register(deployment("other"));
    freezeRegistry(registry);
    const defaultRef = registryOptions(registry).defaultModels.generation;
    expect(defaultRef).toBeDefined();
    expect(() => {
      if (defaultRef?.name) defaultRef.name.value = "other";
    }).toThrow();
    const selected = selectDeployment(registry, { kind: "generation", models: [capability] });
    expect(selected.ref.name?.value).toBe("app");
  });

  it("rejects unsupported deployment kind or capability before use", () => {
    const registry = AiRegistry.create({
      defaultModels: {},
      invocationLimits: limits,
      concurrentOperations: 1,
      queuedOperations: 0,
    }).register(
      createBackendRegistration({
        ...deployment("unused"),
        ref: ModelRef.of("unsupported", "v1"),
        kind: "generation",
        supports: () => false,
        resolveIdentity: () => ({
          provider: "local",
          account: "test",
          endpoint: "local",
          model: "unsupported",
        }),
        authorizeUse: () => true,
        connect: (_scope, identity) => ({ model: {}, identity }),
        execute: () => Promise.reject(new Error("unused backend")),
      }),
    );
    expect(() =>
      selectDeployment(registry, {
        kind: "generation",
        models: [capability],
        repositoryDefault: ModelRef.of("unsupported", "v1"),
      }),
    ).toThrow("capability");
  });
  it("validates and snapshots explicit MCP connection and tool policy", () => {
    const tools = {
      lookup: {
        effect: "read" as const,
        timeoutMs: 500,
        maxArgumentBytes: 100,
        maxResultBytes: 200,
        authorize: () => true,
      },
    };
    const server = Mcp.server({
      id: "support-knowledge",
      revision: "v1",
      transport: { kind: "streamable-http", url: "https://example.test/mcp" },
      authorizeConnect: () => true,
      tools,
    });
    tools.lookup.maxResultBytes = 1000;
    expect(server.id).toBe("support-knowledge");
    expect(() =>
      AiRegistry.create({
        defaultModels: {},
        invocationLimits: limits,
        concurrentOperations: 1,
        queuedOperations: 0,
      }).registerTools({ id: "fake" } as never),
    ).toThrow("factory");
    expect(() =>
      Mcp.server({
        id: "bad",
        revision: "v1",
        transport: { kind: "streamable-http", url: "https://secret@example.test/mcp" },
        authorizeConnect: () => true,
        tools,
      }),
    ).toThrow("credentials");
  });

  it("rejects malformed adapter registrations and preserves a copied reference", () => {
    const ref = ModelRef.of("original", "v1");
    const config = {
      ref,
      kind: "generation" as const,
      supports: () => true,
      resolveIdentity: () => ({ provider: "p", account: "a", endpoint: "e", model: "m" }),
      authorizeUse: () => true,
      connect: (_scope: never, identity: never) => ({ model: {}, identity }),
      execute: () => Promise.reject(new Error("unused backend")),
    };
    expect(() => createBackendRegistration({ ...config, kind: "other" as never })).toThrow("kind");
    expect(() => createBackendRegistration({ ...config, supports: undefined } as never)).toThrow(
      "supports",
    );
    expect(() => createBackendRegistration({ ...config, connect: undefined } as never)).toThrow(
      "connect",
    );
    const registration = createBackendRegistration(config);
    if (!ref.name) throw new Error("ModelRef factory omitted name");
    ref.name.value = "mutated";
    expect(registration.ref.name?.value).toBe("original");
    expect(backendDefinition(registration).ref.name?.value).toBe("original");
    expect(() => backendDefinition({ ...registration })).toThrow("factory");
  });

  it("requires valid defaults and bounded registry configuration before freeze", () => {
    const options = {
      defaultModels: { generation: ModelRef.of("missing", "v1") },
      invocationLimits: limits,
      concurrentOperations: 2,
      queuedOperations: 1,
    };
    const registry = AiRegistry.create(options);
    expect(() => {
      freezeRegistry(registry);
    }).toThrow("default");
    const mismatch = AiRegistry.create({
      ...options,
      defaultModels: {
        decision: ModelRef.of("generation", "v1"),
      },
    }).register(deployment("generation"));
    expect(() => {
      freezeRegistry(mismatch);
    }).toThrow("compatible");
    options.invocationLimits.operations = 100;
    expect(registryOptions(registry).invocationLimits.operations).toBe(2);
    expect(() => AiRegistry.create({ ...options, hookTimeoutMs: 1001 })).toThrow("hookTimeoutMs");
    expect(() => AiRegistry.create({ ...options, concurrentOperations: 0 })).toThrow(
      "concurrentOperations",
    );
    expect(() => AiRegistry.create({ ...options, queuedOperations: -1 })).toThrow(
      "queuedOperations",
    );
    expect(() =>
      AiRegistry.create({ ...options, invocationLimits: { ...limits, maxRecoveryBytes: 0 } }),
    ).toThrow("maxRecoveryBytes");
  });

  it("rejects absent, mismatched, unregistered and unsupported selections", () => {
    const registry = AiRegistry.create({
      defaultModels: {},
      invocationLimits: limits,
      concurrentOperations: 1,
      queuedOperations: 0,
    }).register(deployment("valid"));
    expect(() => selectDeployment(registry, { kind: "generation", models: [capability] })).toThrow(
      "default",
    );
    expect(() =>
      selectDeployment(registry, {
        kind: "decision",
        models: [capability],
        repositoryDefault: ModelRef.of("valid", "v1"),
      }),
    ).toThrow("kind");
    expect(() =>
      selectDeployment(registry, {
        kind: "generation",
        models: [capability],
        repositoryDefault: ModelRef.of("missing", "v1"),
      }),
    ).toThrow("registered");
    expect(() =>
      selectDeployment(registry, {
        kind: "generation",
        models: [],
        contextDefault: ModelRef.of("valid", "v1"),
      }),
    ).toThrow("capability");
    expect(
      selectDeployment(registry, {
        kind: "generation",
        models: [capability],
        contextDefault: ModelRef.of("valid", "v1"),
      }).ref.name?.value,
    ).toBe("valid");
    expect(() =>
      selectDeployment(registry, { kind: "unknown" as never, models: [capability] }),
    ).toThrow("kind");
    freezeRegistry(registry);
    expect(() =>
      registry.registerTools(
        Mcp.server({
          id: "x",
          revision: "v1",
          transport: { kind: "stdio", executable: "/bin/x", args: [] },
          authorizeConnect: () => true,
          tools: {
            t: {
              effect: "read",
              timeoutMs: 1,
              maxArgumentBytes: 1,
              maxResultBytes: 1,
              authorize: () => true,
            },
          },
        }),
      ),
    ).toThrow("frozen");
  });
});
