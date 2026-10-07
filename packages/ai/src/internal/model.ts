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

import { create } from "@bufbuild/protobuf";
import type { MessageShape } from "@bufbuild/protobuf";
import type { MessageSchema } from "@spine-event-engine/core";
import {
  ModelNameSchema,
  ModelRefSchema,
  ModelRevisionSchema,
  type ModelRef as ModelRefMessage,
} from "@spine-event-engine/proto/agent";
import type { AiLimits, AiModelDefinition, AiQuestion, AiToolRef } from "./contracts.js";
import { deriveOutputSchema } from "./schema.js";

const aiModelBrand: unique symbol = Symbol("SpineAiModel");
const models = new WeakSet<object>();

/**
 * Factory-created typed capability accepted by the Agent runtime.
 *
 * @typeParam I - Input message descriptor.
 * @typeParam O - Output message descriptor.
 */
export interface AiModel<I extends MessageSchema, O extends MessageSchema> {
  /**
   * Private marker carried only by a factory-created capability.
   */
  readonly [aiModelBrand]: true;

  /**
   * Validated immutable capability definition.
   */
  readonly definition: Readonly<AiModelDefinition<I, O>>;
}

/**
 * Checks whether a value came from the capability factory.
 * @param value Untrusted candidate.
 * @returns True only for an original factory result.
 */
export const isAiModel = (value: unknown): value is AiModel<MessageSchema, MessageSchema> => {
  return typeof value === "object" && value !== null && models.has(value);
};

/**
 * Validates a nonblank application-supplied identifier.
 * @param value Text to check.
 * @param field Field named in failures.
 * @returns Validated text without changing its identity.
 */
export const nonblank = (value: string, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new TypeError(`${field} must be nonblank`);
  return value;
};

/**
 * Validates a bounded safe integer.
 * @param value Number to check.
 * @param field Field named in failures.
 * @param allowZero Whether zero is valid.
 * @returns Validated integer.
 */
export const positiveInteger = (value: number, field: string, allowZero = false): number => {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1))
    throw new TypeError(
      `${field} must be a ${allowZero ? "nonnegative" : "positive"} safe integer`,
    );
  return value;
};

/**
 * Creates credential-free, semantically validated deployment references.
 */
export const ModelRef = {
  /**
   * Creates a canonical Protobuf deployment reference.
   * @param name Registry deployment name.
   * @param revision Configuration revision.
   * @returns New typed deployment reference.
   */
  of(name: string, revision: string): ModelRefMessage {
    return create(ModelRefSchema, {
      name: create(ModelNameSchema, { value: nonblank(name, "name") }),
      revision: create(ModelRevisionSchema, { value: nonblank(revision, "revision") }),
    });
  },
};

/**
 * Checks a Protobuf deployment reference by value.
 * @param candidate Reference supplied to registration or selection.
 * @returns Key formed from the model name and revision.
 */
export const modelRefKey = (candidate: ModelRefMessage): string => {
  const supplied: unknown = candidate;
  if (
    typeof supplied !== "object" ||
    supplied === null ||
    (supplied as { $typeName?: unknown }).$typeName !== ModelRefSchema.typeName
  )
    throw new TypeError("ModelRef must be a Protobuf deployment reference");
  const name = nonblank(candidate.name?.value ?? "", "ModelRef.name");
  const revision = nonblank(candidate.revision?.value ?? "", "ModelRef.revision");
  return `${String(name.length)}:${name}${String(revision.length)}:${revision}`;
};

/**
 * Copies validated operation limits.
 * @param limits Caller-supplied mutable limits.
 * @param kind Capability kind.
 * @returns Immutable bounded limits.
 */
const copyLimits = (limits: AiLimits, kind: "generation" | "decision"): AiLimits => {
  const supplied: unknown = limits;
  if (typeof supplied !== "object" || supplied === null) throw new TypeError("limits are required");
  const copy = {
    modelRequests: positiveInteger(limits.modelRequests, "modelRequests"),
    toolCalls: positiveInteger(limits.toolCalls, "toolCalls", true),
    deadlineMs: positiveInteger(limits.deadlineMs, "deadlineMs"),
    maxInputBytes: positiveInteger(limits.maxInputBytes, "maxInputBytes"),
    maxOutputBytes: positiveInteger(limits.maxOutputBytes, "maxOutputBytes"),
    ...(limits.maxOutputTokens !== undefined
      ? { maxOutputTokens: positiveInteger(limits.maxOutputTokens, "maxOutputTokens") }
      : {}),
  };
  if (kind === "generation" && copy.maxOutputTokens === undefined)
    throw new TypeError("generation maxOutputTokens is required");
  if (kind === "decision" && copy.maxOutputTokens !== undefined)
    throw new TypeError("decision maxOutputTokens is unsupported");
  if (kind === "decision" && copy.toolCalls !== 0)
    throw new TypeError("decision toolCalls must be zero");
  return Object.freeze(copy);
};

/**
 * Copies application tool references without retaining mutable arrays.
 * @param tools Configured references, if any.
 * @returns Immutable deduplicated references.
 */
const copyTools = (tools: readonly AiToolRef[] | undefined): readonly AiToolRef[] => {
  const keys = new Set<string>();
  return Object.freeze(
    (tools ?? []).map((tool) => {
      const server = nonblank(tool.server, "tool.server");
      const name = nonblank(tool.tool, "tool.tool");
      const key = `${String(server.length)}:${server}${String(name.length)}:${name}`;
      if (keys.has(key)) throw new TypeError("Duplicate tool reference");
      keys.add(key);
      return Object.freeze({ server, tool: name });
    }),
  );
};

/**
 * Copies one declared decision question.
 * @param id Question key.
 * @param question Caller-supplied question.
 * @returns Immutable question and criteria.
 */
const copyQuestion = (id: string, question: AiQuestion): AiQuestion => {
  nonblank(id, "question ID");
  const instructions = nonblank(question.instructions, `question ${id} instructions`);
  if (question.type === "boolean") return Object.freeze({ type: "boolean", instructions });
  if (question.type === "choice") {
    const criteria = Object.fromEntries(
      Object.entries(question.criteria).map(([key, meaning]) => [
        nonblank(key, `question ${id} choice`),
        nonblank(meaning, `question ${id} meaning`),
      ]),
    );
    if (Object.keys(criteria).length < 2) throw new TypeError(`question ${id} needs two choices`);
    return Object.freeze({ type: "choice", instructions, criteria: Object.freeze(criteria) });
  }
  const kind: unknown = question.type;
  if (kind !== "score") throw new TypeError(`question ${id} has unsupported kind`);
  const criteria = question.criteria.map((level) => nonblank(level, `question ${id} rubric`));
  if (criteria.length < 2) throw new TypeError(`question ${id} needs two rubric levels`);
  return Object.freeze({ type: "score", instructions, criteria: Object.freeze(criteria) });
};

/**
 * Copies and validates shared definition fields.
 *
 * @typeParam I - Input message descriptor.
 * @typeParam O - Output message descriptor.
 * @param definition Caller-supplied capability.
 * @returns Shared immutable values.
 */
const copyBase = <I extends MessageSchema, O extends MessageSchema>(
  definition: AiModelDefinition<I, O>,
) => {
  const input: unknown = definition.input;
  const output: unknown = definition.output;
  if (
    (input as { kind?: unknown } | undefined)?.kind !== "message" ||
    (output as { kind?: unknown } | undefined)?.kind !== "message"
  )
    throw new TypeError("input and output must be Protobuf message schemas");
  const validation = definition.validation;
  if (validation && (typeof validation.check !== "function" || !validation.version.trim()))
    throw new TypeError("validation needs a version and check callback");
  return {
    name: nonblank(definition.name, "name"),
    version: nonblank(definition.version, "version"),
    input: definition.input,
    output: definition.output,
    limits: copyLimits(definition.limits, definition.kind),
    ...(validation ? { validation: Object.freeze({ ...validation }) } : {}),
  };
};

/**
 * Copies one validated generation or decision declaration.
 *
 * @typeParam I - Input message descriptor.
 * @typeParam O - Output message descriptor.
 * @param definition Caller-supplied capability.
 * @returns Immutable definition snapshot.
 */
const copyDecision = <I extends MessageSchema, O extends MessageSchema>(
  definition: Extract<AiModelDefinition<I, O>, { kind: "decision" }>,
): AiModelDefinition<I, O> => {
  const mapping: unknown = definition.mapping;
  if (
    typeof mapping !== "object" ||
    mapping === null ||
    typeof (mapping as { toMessage?: unknown }).toMessage !== "function"
  )
    throw new TypeError("decision mapping is required");
  const questions = Object.fromEntries(
    Object.entries(definition.questions).map(([id, question]) => [id, copyQuestion(id, question)]),
  );
  if (Object.keys(questions).length === 0) throw new TypeError("decision questions are required");
  return Object.freeze({
    ...copyBase(definition),
    kind: "decision",
    questions: Object.freeze(questions),
    requireProbabilities: definition.requireProbabilities ?? false,
    requireIndependentQuestions: definition.requireIndependentQuestions ?? false,
    mapping: Object.freeze({
      version: nonblank(definition.mapping.version, "mapping.version"),
      toMessage: definition.mapping.toMessage,
    }),
  });
};

/**
 * Copies a validated capability definition.
 *
 * @typeParam I - Input message descriptor.
 * @typeParam O - Output message descriptor.
 * @param definition Caller-supplied capability.
 * @returns Immutable definition snapshot.
 */
const copyDefinition = <I extends MessageSchema, O extends MessageSchema>(
  definition: AiModelDefinition<I, O>,
): AiModelDefinition<I, O> => {
  if (definition.kind === "generation") {
    const mode: unknown = definition.outputMode;
    if (mode !== "native-schema" && mode !== "prompt-and-validate")
      throw new TypeError("outputMode is unsupported");
    deriveOutputSchema(definition.output);
    return Object.freeze({
      ...copyBase(definition),
      kind: "generation",
      instructions: nonblank(definition.instructions, "instructions"),
      outputMode: definition.outputMode,
      tools: copyTools(definition.tools),
    });
  }
  const kind: unknown = definition.kind;
  if (kind !== "decision") throw new TypeError("model kind is unsupported");
  return copyDecision(definition);
};

/**
 * Defines factory-created capabilities independent of model connections.
 */
export const AiModel = {
  /**
   * Validates and snapshots a typed application capability.
   *
   * @typeParam I - Input message descriptor.
   * @typeParam O - Output message descriptor.
   * @param definition Generation or decision configuration.
   * @returns Immutable factory-created capability.
   */
  define<I extends MessageSchema, O extends MessageSchema>(
    definition: AiModelDefinition<I, O>,
  ): AiModel<I, O> {
    const model = Object.freeze({
      [aiModelBrand]: true as const,
      definition: copyDefinition(definition),
    });
    models.add(model);
    return model;
  },
};

/**
 * Maps a validated decision result with its declared pure function.
 *
 * @typeParam I - Input message descriptor.
 * @typeParam O - Output message descriptor.
 * @param model Decision capability.
 * @param answers Validated answers.
 * @param input Validated typed input.
 * @returns Typed application output.
 */
export const mapDecision = <I extends MessageSchema, O extends MessageSchema>(
  model: AiModel<I, O>,
  answers: Parameters<
    Extract<AiModelDefinition<I, O>, { kind: "decision" }>["mapping"]["toMessage"]
  >[0],
  input: MessageShape<I>,
): MessageShape<O> => {
  const definition = model.definition;
  if (definition.kind !== "decision") throw new TypeError("decision capability required");
  return definition.mapping.toMessage(answers, input);
};
