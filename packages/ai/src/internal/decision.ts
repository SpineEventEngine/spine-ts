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

import type { MessageShape } from "@bufbuild/protobuf";
import { Validate, type MessageSchema } from "@spine-event-engine/core";
import type {
  AiAnswer,
  AiDecisionResult,
  AiModelDefinition,
  AiQuestion,
  AiValidationIssue,
} from "./contracts.js";
import type { AiModel } from "./model.js";
import { isAiModel } from "./model.js";

/**
 * Decimal precision declared by a decision provider; absent means no rounding allowance.
 */
export interface AiDistributionRounding {
  /**
   * Configured probability decimals for this contract.
   */
  readonly probabilityDecimals?: number;

  /**
   * Configured score decimals for this contract.
   */
  readonly scoreDecimals?: number;
}

/**
 * Validated mapped output or local decision issues.
 *
 * @typeParam O - Output message descriptor.
 */
export type AiDecisionAdmission<O extends MessageSchema> =
  | {
      /**
       * Indicates the mapped result was admitted.
       */
      readonly ok: true;

      /**
       * Validated typed application output.
       */
      readonly value: MessageShape<O>;
    }
  | {
      /**
       * Indicates local decision admission failed.
       */
      readonly ok: false;

      /**
       * Local validation defects.
       */
      readonly issues: readonly AiValidationIssue[];
    };

/**
 * @param path Question or distribution path. @param message Safe diagnostic. @returns Issue.
 */
const invalid = (path: string, message: string): AiValidationIssue => {
  return { code: "INVALID_DECISION", path, message };
};

/**
 * @param value Candidate probability. @returns Whether it is finite and inside [0,1].
 */
const probability = (value: number): boolean => {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
};

/**
 * Checks full distribution identity, values and sum against explicit rounding.
 * @param values Provider probabilities.
 * @param keys Declared alternatives.
 * @param path Question path.
 * @param error Aggregate error from declared decimal rounding.
 * @returns Local issues.
 */
const distribution = (
  values: Readonly<Record<string, number>> | undefined,
  keys: readonly string[],
  path: string,
  error: number,
): AiValidationIssue[] => {
  if (!values) return [invalid(path, "Full distribution required")];
  const actual = Object.keys(values);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key)))
    return [invalid(path, "Distribution keys must match declared alternatives")];
  const probabilities = actual.map((key) => values[key] ?? Number.NaN);
  if (probabilities.some((value) => !probability(value)))
    return [invalid(path, "Distribution probabilities must be finite and in [0,1]")];
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  return Math.abs(total - 1) <= error
    ? []
    : [invalid(path, "Distribution sum exceeds rounding allowance")];
};

/**
 * @param decimals Declared decimal places. @returns Half-unit rounding allowance.
 */
const halfUnit = (decimals: number | undefined): number =>
  decimals === undefined ? 0 : 0.5 * 10 ** -decimals;

/**
 * @param rounding Provider precision. @returns Checked precision.
 */
const checkedRounding = (rounding: AiDistributionRounding): AiDistributionRounding => {
  for (const [name, decimals] of Object.entries(rounding))
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 15)
      throw new TypeError(`${name} must be an integer in [0,15]`);
  return rounding;
};

/**
 * Checks a choice or score against its reported distribution.
 *
 * @param answer Choice or score answer.
 * @param keys Declared alternatives.
 * @param rounding Provider precision.
 * @param path Issue path.
 * @returns Coherence issues.
 */
const coherenceIssues = (
  answer: Extract<AiAnswer, { type: "choice" | "score" }>,
  keys: readonly string[],
  rounding: AiDistributionRounding,
  path: string,
): AiValidationIssue[] => {
  const values = answer.probabilities;
  if (!values) return [];
  if (answer.type === "choice") {
    const maximum = Math.max(...keys.map((key) => values[key] ?? -1));
    return (values[answer.choice] ?? -1) >= maximum
      ? []
      : [invalid(path, "Chosen alternative must have maximal probability")];
  }
  const mean = keys.reduce((sum, key, index) => sum + index * (values[key] ?? 0), 0);
  const error = keys.reduce(
    (sum, _, index) => sum + index * halfUnit(rounding.probabilityDecimals),
    halfUnit(rounding.scoreDecimals),
  );
  return Math.abs(answer.score - mean) <= error + Number.EPSILON
    ? []
    : [invalid(path, "Score differs from probability-weighted mean")];
};

/**
 * Checks confidence and any requested complete probability distribution.
 *
 * @param answer Choice or score answer.
 * @param keys Declared alternatives.
 * @param path Question path.
 * @param rounding Provider precision.
 * @param required Whether a distribution is required.
 * @returns Confidence and distribution issues.
 */
const answerDistributionIssues = (
  answer: Extract<AiAnswer, { type: "choice" | "score" }>,
  keys: readonly string[],
  path: string,
  rounding: AiDistributionRounding,
  required: boolean,
): AiValidationIssue[] => {
  const issues: AiValidationIssue[] = [];
  if (answer.confidence !== undefined && !probability(answer.confidence))
    issues.push(invalid(path, "Confidence must be in [0,1]"));
  if (answer.probabilities || required)
    issues.push(
      ...distribution(
        answer.probabilities,
        keys,
        path,
        keys.length * halfUnit(rounding.probabilityDecimals) + Number.EPSILON,
      ),
    );
  return issues;
};

/**
 * Validates one answer against a declared question.
 * @param answer Provider answer.
 * @param question Declared question.
 * @param path Question path.
 * @param rounding Aggregate rounding allowance.
 * @param requireProbabilities Whether full distributions are mandatory.
 * @returns Local issues.
 */
const answerIssues = (
  answer: AiAnswer | undefined,
  question: AiQuestion,
  path: string,
  rounding: AiDistributionRounding,
  requireProbabilities: boolean,
): AiValidationIssue[] => {
  if (answer?.type !== question.type) return [invalid(path, "Answer kind differs")];
  if (answer.type === "boolean")
    return probability(answer.probability) ? [] : [invalid(path, "Invalid boolean probability")];
  if (question.type === "boolean") return [invalid(path, "Answer kind differs")];
  const keys =
    question.type === "choice"
      ? Object.keys(question.criteria)
      : question.criteria.map((_, index) => String(index));
  const valueValid =
    answer.type === "choice"
      ? keys.includes(answer.choice)
      : typeof answer.score === "number" &&
        Number.isFinite(answer.score) &&
        answer.score >= 0 &&
        answer.score <= keys.length - 1;
  const issues = valueValid ? [] : [invalid(path, "Answer value is outside declared alternatives")];
  issues.push(...answerDistributionIssues(answer, keys, path, rounding, requireProbabilities));
  if (issues.length === 0) issues.push(...coherenceIssues(answer, keys, rounding, path));
  return issues;
};

/**
 * Checks all answer IDs and declared question kinds.
 *
 * @param questions Declared IDs and kinds.
 * @param result Provider answers.
 * @param rounding Provider precision.
 * @param required Whether full distributions are required.
 * @returns Answer issues.
 */
const answerSetIssues = (
  questions: Readonly<Record<string, AiQuestion>>,
  result: AiDecisionResult,
  rounding: AiDistributionRounding,
  required: boolean,
): AiValidationIssue[] => {
  const answers = result.answers;
  const IDs = Object.keys(questions);
  if (
    Object.keys(answers).length !== IDs.length ||
    Object.keys(answers).some((id) => !Object.hasOwn(questions, id))
  )
    return [invalid("answers", "Answer IDs must match declared questions")];
  return Object.entries(questions).flatMap(([id, question]) =>
    answerIssues(answers[id], question, `answers.${id}`, rounding, required),
  );
};

/**
 * Maps admitted answers to a typed application output.
 *
 * @typeParam I - Input message descriptor.
 * @typeParam O - Output message descriptor.
 * @param definition Declared decision mapping.
 * @param result Checked answers.
 * @param input Typed facts.
 * @returns Validated output or issues.
 */
const mappedOutput = <I extends MessageSchema, O extends MessageSchema>(
  definition: Extract<AiModelDefinition<I, O>, { kind: "decision" }>,
  result: AiDecisionResult,
  input: MessageShape<I>,
): AiDecisionAdmission<O> => {
  const value = definition.mapping.toMessage(result, input);
  const checked = Validate.message(definition.output, value);
  if (!checked.valid)
    return {
      ok: false,
      issues: checked.violations.map((entry) =>
        invalid(
          entry.fieldPath?.fieldName.join(".") ?? "$",
          entry.message?.withPlaceholders ?? "Invalid output",
        ),
      ),
    };
  const appIssues = definition.validation?.check(value, input) ?? [];
  return appIssues.length ? { ok: false, issues: appIssues } : { ok: true, value };
};

/**
 * Admits a decision without generating or correcting chat text.
 *
 * @typeParam I - Input message descriptor.
 * @typeParam O - Output message descriptor.
 * @param model Factory-created decision capability.
 * @param result Provider decision result.
 * @param input Validated application input.
 * @param rounding Explicit provider distribution rounding allowance.
 * @returns Validated mapped Protobuf output or issues.
 */
export const admitDecision = <I extends MessageSchema, O extends MessageSchema>(
  model: AiModel<I, O>,
  result: AiDecisionResult,
  input: MessageShape<I>,
  rounding: AiDistributionRounding,
): AiDecisionAdmission<O> => {
  const definition = model.definition;
  if (!isAiModel(model) || definition.kind !== "decision")
    throw new TypeError("Factory-created decision capability required");
  const issues = answerSetIssues(
    definition.questions,
    result,
    checkedRounding(rounding),
    definition.requireProbabilities ?? false,
  );
  if (issues.length) return { ok: false, issues };
  return mappedOutput(definition, result, input);
};
