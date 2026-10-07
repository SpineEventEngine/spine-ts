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

import { create, toJsonString } from "@bufbuild/protobuf";
import { createHash } from "node:crypto";
import { experimental_decide } from "ai";
import type { Experimental_DecisionModelV4Question as ProviderQuestion } from "@ai-sdk/provider";
import { AnyMessages } from "@spine-event-engine/core";
import type { AiAnswer, AiDecisionResult, AiFailure, AiQuestion } from "@spine-event-engine/ai";
import type {
  AiBackendExecution,
  AiBackendOutcome,
  AiAttemptTicket,
  AiCandidateAdmission,
} from "@spine-event-engine/ai/spi/adapter";
import {
  AiContentDigestSchema,
  AiDiagnosticIdSchema,
  AiOutcome,
  AiTokenCountSchema,
  AiUsageSchema,
  DecisionAlternativeKeySchema,
  DecisionAnswerSchema,
  DecisionChoiceSchema,
  DecisionDistributionSchema,
  DecisionProbabilitySchema,
  DecisionQuestionIdSchema,
  DecisionQuestionKind,
  DecisionQuestionSchema,
  DecisionRequestSchema,
  DecisionResponseSchema,
  DecisionRoundingSchema,
  type DecisionAnswer,
} from "@spine-event-engine/proto/agent";
import { providerConnection } from "./factory.js";
import { scheduleBoundedDeadline } from "./deadline.js";

/**
 * @param question Application decision contract.
 * @returns Published provider question.
 */
const providerQuestion = (question: AiQuestion): ProviderQuestion => {
  if (question.type === "choice")
    return { type: "choice", instructions: question.instructions, criteria: question.criteria };
  if (question.type === "score")
    return { type: "score", instructions: question.instructions, criteria: question.criteria };
  return { type: "boolean", instructions: question.instructions };
};

/**
 * @param question Application question.
 * @param id Question identity.
 * @returns Domain request content.
 */
const questionContent = (question: AiQuestion, id: string) =>
  create(DecisionQuestionSchema, {
    id: create(DecisionQuestionIdSchema, { value: id }),
    kind:
      question.type === "choice"
        ? DecisionQuestionKind.CHOICE
        : question.type === "score"
          ? DecisionQuestionKind.SCORE
          : DecisionQuestionKind.BOOLEAN,
    instructions: question.instructions,
    ...(question.type === "choice"
      ? {
          choices: Object.entries(question.criteria).map(([key, description]) =>
            create(DecisionChoiceSchema, {
              key: create(DecisionAlternativeKeySchema, { value: key }),
              description,
            }),
          ),
        }
      : {}),
    ...(question.type === "score" ? { rubric: [...question.criteria] } : {}),
  });

/**
 * @param request Typed decision execution.
 * @returns Materialized journal request.
 */
const requestContent = (request: AiBackendExecution) => {
  if (request.definition.kind !== "decision") throw new TypeError("Decision capability required");
  const questions = Object.entries(request.definition.questions).map(([id, question]) =>
    questionContent(question, id),
  );
  const encoded = JSON.stringify({
    input: toJsonString(request.definition.input, request.input),
    questions,
  });
  return create(DecisionRequestSchema, {
    input: AnyMessages.pack(request.definition.input, request.input),
    questions,
    digest: create(AiContentDigestSchema, {
      value: createHash("sha256").update(encoded).digest("hex"),
    }),
  });
};

/**
 * @param answer Provider answer.
 * @param id Application question ID.
 * @returns Received domain answer.
 */
const answerContent = (answer: AiAnswer, id: string): DecisionAnswer => {
  const key = (value: string) => create(DecisionAlternativeKeySchema, { value });
  const kind =
    answer.type === "choice"
      ? DecisionQuestionKind.CHOICE
      : answer.type === "score"
        ? DecisionQuestionKind.SCORE
        : DecisionQuestionKind.BOOLEAN;
  const value =
    answer.type === "choice"
      ? { case: "choice" as const, value: key(answer.choice) }
      : answer.type === "score"
        ? { case: "score" as const, value: answer.score }
        : { case: "booleanProbability" as const, value: answer.probability };
  const probabilities = answer.type === "boolean" ? undefined : answer.probabilities;
  return create(DecisionAnswerSchema, {
    id: create(DecisionQuestionIdSchema, { value: id }),
    kind,
    value,
    ...(probabilities
      ? {
          distribution: create(DecisionDistributionSchema, {
            probabilities: Object.entries(probabilities).map(([alternative, probability]) =>
              create(DecisionProbabilitySchema, { key: key(alternative), probability }),
            ),
          }),
        }
      : {}),
  });
};

/**
 * @param usage Published provider counts.
 * @returns Semantic known counts only.
 */
const semanticUsage = (
  usage: { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined,
) => {
  if (!usage || (usage.inputTokens === undefined && usage.outputTokens === undefined))
    return undefined;
  return create(AiUsageSchema, {
    ...(usage.inputTokens !== undefined
      ? { inputTokens: create(AiTokenCountSchema, { value: BigInt(usage.inputTokens) }) }
      : {}),
    ...(usage.outputTokens !== undefined
      ? { outputTokens: create(AiTokenCountSchema, { value: BigInt(usage.outputTokens) }) }
      : {}),
  });
};

/**
 * @param precision Provider-declared decimals.
 * @returns Present semantic precision only.
 */
const semanticRounding = (
  precision:
    { probabilityDecimals?: number | undefined; scoreDecimals?: number | undefined } | undefined,
) => {
  if (
    !precision ||
    (precision.probabilityDecimals === undefined && precision.scoreDecimals === undefined)
  )
    return undefined;
  return create(DecisionRoundingSchema, {
    ...(precision.probabilityDecimals === undefined
      ? {}
      : { probabilityDecimals: precision.probabilityDecimals }),
    ...(precision.scoreDecimals === undefined ? {} : { scoreDecimals: precision.scoreDecimals }),
  });
};

/**
 * Identifies this adapter's bounded decision deadline without inspecting provider text.
 */
class DecisionDeadlineError extends Error {}

/**
 * @param pending SDK decision.
 * @param request Runtime cancellation and Time.
 * @param ticket Earlier physical attempt deadline.
 * @typeParam T Published provider decision result.
 * @returns Decision before deadline.
 */
const awaitDecision = async <T>(
  pending: Promise<T>,
  request: AiBackendExecution,
  ticket: AiAttemptTicket,
): Promise<T> => {
  const { control } = request;
  const remaining = ticket.deadlineEpochMs - control.nowEpochMs();
  if (!Number.isFinite(remaining) || remaining <= 0)
    throw new DecisionDeadlineError("Decision deadline exceeded");
  let cancelTimer!: () => void;
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => {
      reject(new Error("Decision cancelled"));
    };
    control.signal.addEventListener("abort", abort, { once: true });
    cancelTimer = scheduleBoundedDeadline(ticket.deadlineEpochMs, control.nowEpochMs, () => {
      reject(new DecisionDeadlineError("Decision deadline exceeded"));
    });
  });
  try {
    return await Promise.race([pending, cancelled]);
  } finally {
    cancelTimer();
    control.signal.removeEventListener("abort", abort);
  }
};

/**
 * Builds the received decision content, including provider precision.
 * @param request Selected execution.
 * @param decision Published provider result.
 * @param admission Definitive runtime validation.
 * @param failure Recorded safe diagnostic when invalid.
 * @returns Complete journal response.
 */
const decisionResponse = (
  request: AiBackendExecution,
  decision: Awaited<ReturnType<typeof experimental_decide>>,
  admission: AiCandidateAdmission,
  failure: AiFailure | undefined,
) => {
  if (request.definition.kind !== "decision") throw new TypeError("Decision capability required");
  const usage = semanticUsage(decision.usage);
  const rounding = semanticRounding(decision.rounding);
  return create(DecisionResponseSchema, {
    answers: Object.entries(decision.answers).map(([id, answer]) => answerContent(answer, id)),
    outcome: admission.ok ? AiOutcome.ADMITTED : AiOutcome.INVALID_OUTPUT,
    ...(admission.ok
      ? { admittedOutput: AnyMessages.pack(request.definition.output, admission.value) }
      : {}),
    ...(failure
      ? { diagnosticId: create(AiDiagnosticIdSchema, { value: failure.diagnosticId }) }
      : {}),
    ...(usage ? { usage } : {}),
    ...(rounding ? { rounding } : {}),
  });
};

/**
 * Applies definitive runtime validation and journals the provider decision.
 * @param request Selected execution.
 * @param decision Published provider result.
 * @param ticket Durable attempt.
 * @returns Admitted result after the journal barrier.
 */
const decide = async (
  request: AiBackendExecution,
  decision: Awaited<ReturnType<typeof experimental_decide>>,
  ticket: AiAttemptTicket,
): Promise<AiBackendOutcome> => {
  if (request.definition.kind !== "decision") throw new TypeError("Decision capability required");
  const result: AiDecisionResult = { answers: decision.answers };
  const admission = await request.control.admitDecision(
    result,
    request.definition,
    request.input,
    decision.rounding,
  );
  const failure = admission.ok
    ? undefined
    : await request.control.recordFailure("INVALID_OUTPUT", false);
  const response = decisionResponse(request, decision, admission, failure);
  const bytes = providerConnection(request.model).receivedBytes(ticket.id);
  await request.control.finishAttempt({
    ticketId: ticket.id,
    response,
    ...(bytes === undefined ? {} : { receivedBytes: bytes }),
    ...(response.usage ? { usage: response.usage } : {}),
    ...(!admission.ok ? { issues: admission.issues } : {}),
  });
  if (admission.ok) return { ok: true, value: admission.value };
  if (!failure) throw new Error("Decision diagnostic was not recorded");
  return { ok: false, failure };
};

/**
 * @param request Active decision.
 * @param ticket Begun attempt.
 * @param code Safe failure category.
 * @param retryable Whether a new signal may retry.
 * @returns Safely classified provider failure.
 */
const providerFailure = async (
  request: AiBackendExecution,
  ticket: AiAttemptTicket,
  code: AiFailure["code"] = "UNAVAILABLE",
  retryable = true,
): Promise<AiBackendOutcome> => {
  const failure = await request.control.recordFailure(code, retryable);
  const bytes = providerConnection(request.model).receivedBytes(ticket.id);
  await request.control.finishAttempt({
    ticketId: ticket.id,
    ...(bytes === undefined ? {} : { receivedBytes: bytes }),
    response: create(DecisionResponseSchema, {
      outcome: AiOutcome.FAILED,
      diagnosticId: create(AiDiagnosticIdSchema, { value: failure.diagnosticId }),
    }),
  });
  return { ok: false, failure };
};

/**
 * Sends a no-retry provider decision and preserves journal failures.
 * @param request Selected decision execution.
 * @param ticket Durable physical attempt.
 * @returns Admitted or classified provider outcome.
 */
const providerDecision = async (
  request: AiBackendExecution,
  ticket: AiAttemptTicket,
): Promise<AiBackendOutcome> => {
  if (request.definition.kind !== "decision") throw new TypeError("Decision capability required");
  const model = providerConnection(request.model).model;
  if (!("doDecide" in model) && !("doEvaluate" in model))
    throw new TypeError("V4 decision model required");
  const questions = Object.fromEntries(
    Object.entries(request.definition.questions).map(([id, question]) => [
      id,
      providerQuestion(question),
    ]),
  );
  const state = toJsonString(request.definition.input, request.input);
  let result: Awaited<ReturnType<typeof experimental_decide>>;
  try {
    if (request.control.nowEpochMs() >= ticket.deadlineEpochMs)
      throw new DecisionDeadlineError("Decision deadline exceeded");
    result = await awaitDecision(
      experimental_decide({ model, state, questions, maxRetries: 0, abortSignal: ticket.signal }),
      request,
      ticket,
    );
  } catch (error) {
    if (request.control.signal.aborted || !request.control.hasAuthority()) throw error;
    if (
      error instanceof DecisionDeadlineError ||
      request.control.nowEpochMs() >= ticket.deadlineEpochMs
    )
      return providerFailure(request, ticket, "DEADLINE_EXCEEDED", false);
    return providerFailure(request, ticket);
  }
  return decide(request, result, ticket);
};

/**
 * Executes one non-generative Jev decision without SDK retries.
 * @param request Authenticated capability and fenced runtime controls.
 * @returns Admitted mapped Proto or safe recorded failure.
 */
export const executeDecision = async (request: AiBackendExecution): Promise<AiBackendOutcome> => {
  if (request.definition.kind !== "decision") throw new TypeError("Decision capability required");
  const connection = providerConnection(request.model);
  if (!("doDecide" in connection.model) && !("doEvaluate" in connection.model))
    throw new TypeError("V4 decision model required");
  const supported = new Set(connection.model.supportedQuestionTypes);
  if (Object.values(request.definition.questions).some((question) => !supported.has(question.type)))
    throw new TypeError("Decision question kind is unsupported by provider");
  const ticket = await request.control.beginAttempt({
    kind: "decision",
    content: requestContent(request),
  });
  if (ticket.signal.aborted) return providerFailure(request, ticket, "CANCELLED", false);
  if (request.control.nowEpochMs() >= ticket.deadlineEpochMs)
    return providerFailure(request, ticket, "DEADLINE_EXCEEDED", false);
  try {
    connection.gate.admit(ticket);
  } catch (error) {
    // The ticket signal can change while gate admission reads the clock.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (ticket.signal.aborted) return providerFailure(request, ticket, "CANCELLED", false);
    if (request.control.nowEpochMs() >= ticket.deadlineEpochMs)
      return providerFailure(request, ticket, "DEADLINE_EXCEEDED", false);
    throw error;
  }
  try {
    return await providerDecision(request, ticket);
  } finally {
    connection.gate.revoke();
  }
};
