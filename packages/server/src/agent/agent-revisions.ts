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
import { toBinary } from "@bufbuild/protobuf";
import { FileDescriptorProtoSchema } from "@bufbuild/protobuf/wkt";
import type { AiRegistry } from "@spine-event-engine/ai";
import {
  mcpDefinition,
  mcpRegistrations,
  registryOptions,
} from "@spine-event-engine/ai/spi/runtime";
import type { MessageSchema } from "@spine-event-engine/core";
import type { DescriptorMessageSchema } from "../entity/entity-metadata.js";
import type { RegisteredHandlerMetadata } from "../handler/handler-metadata.js";
import type { RepositoryAiOptions } from "../repository/repository.js";

/**
 * Exact generated-schema and effective-policy revisions at Agent admission.
 */
export interface AgentAdmissionRevisions {
  /**
   * Digest of the selected state, signal, and capability descriptors.
   */
  readonly schema: string;

  /**
   * Digest of effective registry and repository capability policy.
   */
  readonly policy: string;
}

interface AgentRevisionsAccess {
  /**
   * Calculates admission revisions from generated descriptors and configured policy.
   *
   * @param state Generated Agent state descriptor.
   * @param handlers Selected original handler bindings.
   * @param ai Effective Bounded Context AI registry.
   * @param repository Repository capability configuration.
   * @returns Revisions compared when accepted work resumes.
   */
  atAdmission(
    state: DescriptorMessageSchema,
    handlers: readonly RegisteredHandlerMetadata[],
    ai: AiRegistry,
    repository: RepositoryAiOptions,
  ): AgentAdmissionRevisions;
}

/**
 * Derives restart comparison keys without retaining application callbacks.
 */
export const AgentRevisions: AgentRevisionsAccess = Object.freeze({
  /**
   * Computes descriptor and effective-policy digests for accepted work.
   *
   * @param state Generated Agent state descriptor.
   * @param handlers Selected handler bindings in execution order.
   * @param ai Effective Bounded Context AI registry.
   * @param repository Repository capability configuration.
   * @returns Revisions persisted for recovery comparison.
   */
  atAdmission(
    state: DescriptorMessageSchema,
    handlers: readonly RegisteredHandlerMetadata[],
    ai: AiRegistry,
    repository: RepositoryAiOptions,
  ): AgentAdmissionRevisions {
    const schemas: MessageSchema[] = [
      state,
      ...handlers.map((entry) => entry.handler.schema),
      ...repository.models.flatMap((model) => [model.definition.input, model.definition.output]),
    ];
    const files = new Map(schemas.map((schema) => [schema.file.proto.name, schema.file.proto]));
    const schemaHash = createHash("sha256");
    for (const name of [...files.keys()].sort()) {
      schemaHash.update(name);
      const file = files.get(name);
      if (file === undefined) throw new Error("Agent descriptor disappeared during admission.");
      schemaHash.update(toBinary(FileDescriptorProtoSchema, file));
    }
    return Object.freeze({
      schema: schemaHash.digest("hex"),
      policy: createHash("sha256")
        .update(JSON.stringify(policyShape(ai, repository)))
        .digest("hex"),
    });
  },
});

/**
 * Selects serializable policy fields while callback revisions remain in codeRevision.
 * @param ai Effective registry.
 * @param repository Repository capabilities and narrowing policy.
 * @returns Ordered policy value for a deterministic digest.
 */
function policyShape(ai: AiRegistry, repository: RepositoryAiOptions): object {
  const options = registryOptions(ai);
  return {
    defaults: options.defaultModels,
    limits: options.invocationLimits,
    concurrency: options.concurrentOperations,
    queued: options.queuedOperations,
    hookTimeoutMs: options.hookTimeoutMs,
    repositoryDefaults: repository.defaultModels,
    allowedModels: repository.allowedModels,
    invocationLimits: repository.invocationLimits,
    mcpServers: mcpPolicies(ai),
    models: repository.models.map(({ definition }) => ({
      name: definition.name,
      version: definition.version,
      kind: definition.kind,
      input: definition.input.typeName,
      output: definition.output.typeName,
      limits: definition.limits,
      validationVersion: definition.validation?.version,
      ...(definition.kind === "generation"
        ? {
            instructions: definition.instructions,
            outputMode: definition.outputMode,
            tools: definition.tools,
          }
        : {
            questions: definition.questions,
            mappingVersion: definition.mapping.version,
            requireProbabilities: definition.requireProbabilities,
            requireIndependentQuestions: definition.requireIndependentQuestions,
          }),
    })),
  };
}

/**
 * Hashes static server policy without evaluating scoped credential callbacks.
 * @param ai Effective AI registry with registered tool servers.
 * @returns Deterministically ordered serializable server policies.
 */
function mcpPolicies(ai: AiRegistry): readonly object[] {
  return mcpRegistrations(ai)
    .map((registration) => {
      const server = mcpDefinition(registration);
      const transport =
        server.transport.kind === "streamable-http"
          ? { kind: server.transport.kind, url: server.transport.url }
          : {
              kind: server.transport.kind,
              executable: server.transport.executable,
              args: server.transport.args,
              cwd: server.transport.cwd,
            };
      return {
        id: server.id,
        revision: server.revision,
        transport,
        tools: Object.entries(server.tools)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, policy]) => ({
            name,
            effect: policy.effect,
            timeoutMs: policy.timeoutMs,
            maxArgumentBytes: policy.maxArgumentBytes,
            maxResultBytes: policy.maxResultBytes,
          })),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}
