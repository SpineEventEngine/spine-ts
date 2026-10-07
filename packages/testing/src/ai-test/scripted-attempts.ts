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

import { clone, create, toBinary, toJsonString, type MessageShape } from "@bufbuild/protobuf";
import { createHash } from "node:crypto";
import { AnyMessages, type MessageSchema } from "@spine-event-engine/core";
import type {
  AiAnswer,
  AiDecisionResult,
  AiFailure,
  AiModelDefinition,
  AiValidationIssue,
} from "@spine-event-engine/ai";
import {
  assertAiOutcomeContext,
  deriveOutputSchema,
  type AiCandidateAdmission,
  type AiAttemptRequest,
  type AiAttemptReplay,
  type AiAttemptTicket,
  type AiBackendExecution,
  type AiBackendOutcome,
} from "@spine-event-engine/ai/spi/adapter";
import {
  AiAttemptIdSchema,
  AiContentDigestSchema,
  AiDiagnosticIdSchema,
  AiOutcome,
  AiUsageSchema,
  DecisionAnswerSchema,
  DecisionAlternativeKeySchema,
  DecisionDistributionSchema,
  DecisionProbabilitySchema,
  DecisionQuestionIdSchema,
  DecisionQuestionKind,
  DecisionQuestionSchema,
  DecisionChoiceSchema,
  DecisionRequestSchema,
  DecisionResponseSchema,
  GenerationRequestSchema,
  GenerationResponseSchema,
  type AiContentDigest,
  type AiUsage,
  type DecisionAnswer,
  type DecisionDistribution,
  type DecisionQuestion,
  type DecisionResponse,
  type GenerationResponse,
} from "@spine-event-engine/proto/agent";
import type { AiTestGate, AiTestRequest, AiTestResponses } from "./ai-test-backend.js";

interface FailureScript {
  readonly kind: "failure";
  readonly code: AiFailure["code"];
  readonly retryable: boolean;
  usage?: AiUsage;
}
interface TextScript {
  readonly kind: "text";
  readonly text: string;
  usage?: AiUsage;
}
interface DecisionScript {
  readonly kind: "decision";
  readonly result: AiDecisionResult;
  usage?: AiUsage;
}
interface DelayScript {
  readonly kind: "delay";
  readonly gate: Gate;
}

/**
 * One queued simulated provider response or release gate.
 */
export type Script = FailureScript | TextScript | DecisionScript | DelayScript;
type DecisionQuestionDefinition = Extract<
  AiModelDefinition<MessageSchema, MessageSchema>,
  { kind: "decision" }
>["questions"][string];

/**
 * Queued behavior for one factory-created capability.
 */
export interface ScriptQueue {
  /**
   * Validated immutable capability declaration.
   */
  readonly definition: Readonly<AiModelDefinition<MessageSchema, MessageSchema>>;

  /**
   * Responses not yet consumed by physical requests.
   */
  readonly scripts: Script[];
}

/**
 * Mutable internal observation copied by the public snapshot method.
 */
export interface RequestRecord extends AiTestRequest {
  /**
   * Runtime operation identity used for attempt numbering.
   */
  readonly operation: string;

  /**
   * Runtime-assigned attempt identity after the begin barrier.
   */
  ticketId?: string;

  /**
   * Whether the reservation barrier admitted physical dispatch.
   */
  dispatched?: boolean;

  /**
   * Whether an admitted request reached a terminal scripted outcome.
   */
  settled?: boolean;

  /**
   * Whether no scripted response matched the admitted request.
   */
  unexpected?: boolean;

  /**
   * Local validation issues saved after response admission.
   */
  validationIssues: readonly AiValidationIssue[];

  /**
   * Exact previous generation text used to prepare a correction request.
   */
  candidateText?: string;

  /**
   * Candidate text copied from the prior invalid attempt.
   */
  correctionCandidate?: string;
}

/**
 * Renders the exact scripted generation input and correction feedback.
 * @param record Physical request observation.
 * @returns Persistable prepared prompt JSON.
 */
const generationPrompt = (record: RequestRecord): string =>
  JSON.stringify({
    input: record.inputJson,
    ...(record.correctionCandidate !== undefined
      ? { correction: { candidate: record.correctionCandidate, issues: record.correctionIssues } }
      : {}),
  });

interface ScriptedAttemptOps {
  /**
   * Returns a capability key without conflating revisions.
   *
   * @param name Name for this operation.
   * @param version Version for this operation.
   * @returns Revision-qualified capability key.
   */
  key(name: string, version: string): string;

  /**
   * Returns the scripted responses result.
   *
   * @typeParam O Generated output descriptor.
   * @param queue Queue for this operation.
   * @param output Output for this operation.
   * @returns Queue writer for this capability.
   */
  responses<O extends MessageSchema>(queue: ScriptQueue, output: O): AiTestResponses<O>;

  /**
   * Returns the scripted record result.
   *
   * @param request Request for this operation.
   * @param attempt Attempt for this operation.
   * @param prior Prior for this operation.
   * @returns Mutable internal request record.
   */
  record(request: AiBackendExecution, attempt: number, prior?: RequestRecord): RequestRecord;

  /**
   * Returns the scripted snapshot result.
   *
   * @param record Record for this operation.
   * @returns Immutable physical-request observation.
   */
  snapshot(record: RequestRecord): AiTestRequest;

  /**
   * Returns the scripted execute result.
   *
   * @param request Request for this operation.
   * @param record Record for this operation.
   * @param queue Queue for this operation.
   * @returns Admitted output or recorded failure.
   */
  execute(
    request: AiBackendExecution,
    record: RequestRecord,
    queue?: ScriptQueue,
  ): Promise<AiBackendOutcome>;

  /**
   * Restores a saved response without consuming a queued physical script.
   * @param request Selected scripted execution.
   * @param saved Durable response and matching original failure.
   * @returns Saved admitted output or exact recorded failure.
   */
  replay(request: AiBackendExecution, saved: AiAttemptReplay): AiBackendOutcome;

  /**
   * Checks saved failure correlation before reuse.
   * @param response Saved terminal response.
   * @param failure Original persisted failure, when available.
   * @returns Exact saved failure.
   */
  replayFailure(response: AiAttemptReplay["response"], failure?: AiFailure): AiBackendOutcome;

  /**
   * Returns the scripted prepare result.
   *
   * @param request Request for this operation.
   * @param record Record for this operation.
   * @returns Typed model-facing request.
   */
  prepare(request: AiBackendExecution, record: RequestRecord): AiAttemptRequest;

  /**
   * Returns the scripted question result.
   *
   * @param id Id for this operation.
   * @param question Question for this operation.
   * @returns Typed question record.
   */
  question(id: string, question: DecisionQuestionDefinition): DecisionQuestion;

  /**
   * Returns the SHA-256 digest of content.
   *
   * @param value Value for this operation.
   * @returns SHA-256 content digest.
   */
  digest(value: string): AiContentDigest;

  /**
   * Returns the scripted failure result.
   *
   * @param request Request for this operation.
   * @param ticket Ticket for this operation.
   * @param code Code for this operation.
   * @param retryable Retryable for this operation.
   * @param usage Usage for this operation.
   * @returns Runtime-recorded safe failure.
   */
  failure(
    request: AiBackendExecution,
    ticket: AiAttemptTicket,
    code: AiFailure["code"],
    retryable: boolean,
    usage?: AiUsage,
  ): Promise<AiBackendOutcome>;

  /**
   * Validates and journals one generation candidate.
   *
   * @param request Request for this operation.
   * @param ticket Ticket for this operation.
   * @param record Record for this operation.
   * @param script Script for this operation.
   * @returns Validated output or recorded failure.
   */
  generation(
    request: AiBackendExecution,
    ticket: AiAttemptTicket,
    record: RequestRecord,
    script: TextScript,
  ): Promise<AiBackendOutcome>;

  /**
   * Validates and journals one non-generative decision.
   *
   * @param request Request for this operation.
   * @param ticket Ticket for this operation.
   * @param record Record for this operation.
   * @param script Script for this operation.
   * @returns Validated output or recorded failure.
   */
  decision(
    request: AiBackendExecution,
    ticket: AiAttemptTicket,
    record: RequestRecord,
    script: DecisionScript,
  ): Promise<AiBackendOutcome>;

  /**
   * Builds one provider answer for the decision journal.
   *
   * @param id Id for this operation.
   * @param answer Answer for this operation.
   * @returns Typed provider answer.
   */
  answer(id: string, answer: AiAnswer): DecisionAnswer;

  /**
   * Maps one answer kind to its Proto oneof.
   *
   * @param answer Answer for this operation.
   * @returns Typed answer oneof.
   */
  answerValue(answer: AiAnswer): DecisionAnswer["value"];

  /**
   * Builds a provider answer distribution.
   *
   * @param probabilities Probabilities for this operation.
   * @returns Typed full distribution.
   */
  distribution(probabilities: Readonly<Record<string, number>>): DecisionDistribution;

  /**
   * Builds a generation response for the journal.
   *
   * @param request Request for this operation.
   * @param script Script for this operation.
   * @param admitted Admitted for this operation.
   * @param failure Failure for this operation.
   * @returns Journal-ready generation response.
   */
  generationReply(
    request: AiBackendExecution,
    script: TextScript,
    admitted: AiCandidateAdmission,
    failure?: AiFailure,
  ): GenerationResponse;

  /**
   * Builds a decision response for the journal.
   *
   * @param request Request for this operation.
   * @param script Script for this operation.
   * @param admitted Admitted for this operation.
   * @param failure Failure for this operation.
   * @returns Journal-ready decision response.
   */
  decisionReply(
    request: AiBackendExecution,
    script: DecisionScript,
    admitted: AiCandidateAdmission,
    failure?: AiFailure,
  ): DecisionResponse;
}

/**
 * One externally released response gate.
 */
class Gate implements AiTestGate {
  #release!: () => void;

  readonly #ready = new Promise<void>((resolve) => {
    this.#release = resolve;
  });

  /**
   * Completes the pending response.
   */
  release(): void {
    this.#release();
  }

  /**
   * Awaits gate release or cancellation.
   *
   * @param signal Signal for this operation.
   * @returns Completion after release or cancellation.
   */
  async wait(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error("Scripted AI request cancelled.");
    let abort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => {
        reject(new Error("Scripted AI request cancelled."));
      };
      signal.addEventListener("abort", abort, { once: true });
    });
    try {
      await Promise.race([this.#ready, cancelled]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
}

/**
 * Writes detached scripted responses for one validated capability.
 *
 * @typeParam O Generated output descriptor.
 */
class QueueResponses<O extends MessageSchema> implements AiTestResponses<O> {
  readonly #queue: ScriptQueue;

  readonly #output: O;

  /**
   * Creates a queue writer for a capability.
   *
   * @param queue Queue for this operation.
   * @param output Output for this operation.
   */
  constructor(queue: ScriptQueue, output: O) {
    this.#queue = queue;
    this.#output = output;
  }

  /**
   * Queues a serialized typed generation candidate.
   *
   * @param value Value for this operation.
   * @returns This response queue.
   */
  respondWith(value: MessageShape<O>): this {
    this.requireKind("generation");
    this.#queue.scripts.push({ kind: "text", text: toJsonString(this.#output, value) });
    return this;
  }

  /**
   * Queues exact raw generation text.
   *
   * @param text Text for this operation.
   * @returns This response queue.
   */
  respondWithText(text: string): this {
    this.requireKind("generation");
    this.#queue.scripts.push({ kind: "text", text });
    return this;
  }

  /**
   * Queues defensively copied decision answers.
   *
   * @param result Result for this operation.
   * @returns This response queue.
   */
  respondWithDecision(result: AiDecisionResult): this {
    this.requireKind("decision");
    this.#queue.scripts.push({ kind: "decision", result: structuredClone(result) });
    return this;
  }

  /**
   * Queues a safe failure category without retaining its supplied ID.
   *
   * @param failure Failure for this operation.
   * @returns This response queue.
   */
  failWith(failure: AiFailure): this {
    this.#queue.scripts.push({
      kind: "failure",
      code: failure.code,
      retryable: failure.retryableByNewSignal,
    });
    return this;
  }

  /**
   * Queues a provider refusal.
   *
   * @returns This response queue.
   */
  refuse(): this {
    this.#queue.scripts.push({ kind: "failure", code: "REFUSED", retryable: false });
    return this;
  }

  /**
   * Attaches immutable usage to the latest response.
   *
   * @param usage Usage for this operation.
   * @returns This response queue.
   */
  withUsage(usage: AiUsage): this {
    const last = this.#queue.scripts.at(-1);
    if (last === undefined || last.kind === "delay")
      throw new TypeError("Usage requires a queued response.");
    last.usage = clone(AiUsageSchema, usage);
    return this;
  }

  /**
   * Queues one externally released response pause.
   *
   * @returns The release gate.
   */
  delay(): AiTestGate {
    const gate = new Gate();
    this.#queue.scripts.push({ kind: "delay", gate });
    return gate;
  }

  /**
   * Validates the scripted response kind.
   *
   * @param kind Kind for this operation.
   */
  private requireKind(kind: "generation" | "decision"): void {
    if (this.#queue.definition.kind !== kind)
      throw new TypeError(
        `${kind === "generation" ? "Typed generation response" : "Decision answer"} requires a ${kind} backend.`,
      );
  }
}

/**
 * Constructs scripted requests and crosses the same runtime barriers as adapters.
 */
export const ScriptedAttempts: ScriptedAttemptOps = Object.freeze({
  /**
   * Returns a capability key without conflating revisions.
   *
   * @param name Name for this operation.
   * @param version Version for this operation.
   * @returns Revision-qualified capability key.
   */
  key(name: string, version: string): string {
    return `${String(name.length)}:${name}${String(version.length)}:${version}`;
  },

  /**
   * Creates a queue writer with defensive snapshots.
   *
   * @typeParam O Generated output descriptor.
   * @param queue Queue for this operation.
   * @param output Output for this operation.
   * @returns Queue writer for this capability.
   */
  responses<O extends MessageSchema>(queue: ScriptQueue, output: O): AiTestResponses<O> {
    return new QueueResponses(queue, output);
  },

  /**
   * Records bounded prepared input and advertised tool names.
   *
   * @param request Request for this operation.
   * @param attempt Attempt for this operation.
   * @param prior Prior for this operation.
   * @returns Mutable internal request record.
   */
  record(request: AiBackendExecution, attempt: number, prior?: RequestRecord): RequestRecord {
    const inputJson = toJsonString(request.definition.input, request.input);
    if (Buffer.byteLength(inputJson, "utf8") > request.definition.limits.maxInputBytes)
      throw new RangeError("Scripted prepared input exceeds the capability byte limit.");
    return {
      operation: request.operationId.value,
      modelName: request.definition.name,
      call: request.call,
      attempt,
      inputJson,
      ...(prior?.ticketId ? { corrects: prior.ticketId } : {}),
      ...(prior?.candidateText !== undefined ? { correctionCandidate: prior.candidateText } : {}),
      validationIssues: [],
      correctionIssues: prior?.validationIssues.map((issue) => ({ ...issue })) ?? [],
      toolNames:
        request.definition.kind === "generation"
          ? Object.freeze(
              (request.definition.tools ?? []).map((tool) => `${tool.server}/${tool.tool}`),
            )
          : Object.freeze([]),
    };
  },

  /**
   * Returns an immutable observation without sharing queued objects.
   *
   * @param record Record for this operation.
   * @returns Immutable physical-request observation.
   */
  snapshot(record: RequestRecord): AiTestRequest {
    return Object.freeze({
      modelName: record.modelName,
      call: record.call,
      attempt: record.attempt,
      inputJson: record.inputJson,
      ...(record.corrects ? { corrects: record.corrects } : {}),
      validationIssues: Object.freeze(
        record.validationIssues.map((issue) => Object.freeze({ ...issue })),
      ),
      correctionIssues: Object.freeze(
        record.correctionIssues.map((issue) => Object.freeze({ ...issue })),
      ),
      toolNames: Object.freeze([...record.toolNames]),
    });
  },

  /**
   * Executes one physical scripted request after durable reservation.
   *
   * @param request Request for this operation.
   * @param record Record for this operation.
   * @param queue Queue for this operation.
   * @returns Admitted output or recorded failure.
   */
  async execute(
    request: AiBackendExecution,
    record: RequestRecord,
    queue?: ScriptQueue,
  ): Promise<AiBackendOutcome> {
    const prepared = this.prepare(request, record);
    const ticket = await request.control.beginAttempt(prepared);
    record.ticketId = ticket.id;
    if ("kind" in ticket) {
      record.validationIssues = ticket.issues ?? [];
      return this.replay(request, ticket);
    }
    const bytes = toBinary(
      prepared.kind === "generation" ? GenerationRequestSchema : DecisionRequestSchema,
      prepared.content,
    ).length;
    await request.control.reserveTransport(ticket.id, bytes, ticket.maxOutputBytes);
    record.dispatched = true;
    let script = queue?.scripts.shift();
    const gates: Gate[] = [];
    while (script?.kind === "delay") {
      gates.push(script.gate);
      script = queue?.scripts.shift();
    }
    for (const gate of gates) await gate.wait(ticket.signal);
    if (!script) {
      record.unexpected = true;
      return this.failure(request, ticket, "UNAVAILABLE", true);
    }
    if (script.kind === "failure")
      return this.failure(request, ticket, script.code, script.retryable, script.usage);
    if (script.kind === "text") return this.generation(request, ticket, record, script);
    return this.decision(request, ticket, record, script);
  },

  /**
   * Restores a saved typed response without consuming a queued physical script.
   * @param request Selected scripted execution.
   * @param saved Durable response and matching original failure, if any.
   * @returns Saved admitted output or exact recorded failure.
   */
  replay(request: AiBackendExecution, saved: AiAttemptReplay): AiBackendOutcome {
    const response = saved.response;
    if (
      request.definition.kind === "generation" &&
      response.$typeName !== "spine.ts.agent.GenerationResponse"
    )
      throw new Error("Saved scripted response has a changed request kind.");
    if (
      request.definition.kind === "decision" &&
      response.$typeName !== "spine.ts.agent.DecisionResponse"
    )
      throw new Error("Saved scripted response has a changed request kind.");
    assertAiOutcomeContext(response);
    if (response.outcome !== AiOutcome.ADMITTED) return this.replayFailure(response, saved.failure);
    if (!response.admittedOutput) throw new Error("Saved scripted output is missing.");
    const value = AnyMessages.unpack(response.admittedOutput, request.definition.output);
    if (!value) throw new Error("Saved scripted response has a changed output type.");
    return { ok: true, value };
  },

  /**
   * Requires the original persisted failure category and matching diagnostic.
   * @param response Saved terminal response.
   * @param failure Original persisted failure, when available.
   * @returns Exact failure without inventing retryability.
   */
  replayFailure(response: AiAttemptReplay["response"], failure?: AiFailure): AiBackendOutcome {
    if (
      ![AiOutcome.INVALID_OUTPUT, AiOutcome.FAILED, AiOutcome.REFUSED].includes(response.outcome) ||
      !failure ||
      response.diagnosticId?.value !== failure.diagnosticId
    )
      throw new Error("Saved scripted failure cannot be reconstructed.");
    if (response.outcome === AiOutcome.INVALID_OUTPUT && failure.code !== "INVALID_OUTPUT")
      throw new Error("Saved scripted failure category changed.");
    if (response.outcome === AiOutcome.REFUSED && failure.code !== "REFUSED")
      throw new Error("Saved scripted failure category changed.");
    if (
      response.outcome === AiOutcome.FAILED &&
      (failure.code === "INVALID_OUTPUT" || failure.code === "REFUSED")
    )
      throw new Error("Saved scripted failure category changed.");
    return { ok: false, failure };
  },

  /**
   * Materializes the exact typed generation or decision request.
   *
   * @param request Request for this operation.
   * @param record Record for this operation.
   * @returns Typed model-facing request.
   */
  prepare(request: AiBackendExecution, record: RequestRecord): AiAttemptRequest {
    const definition = request.definition;
    const input = AnyMessages.pack(definition.input, request.input);
    if (definition.kind === "decision") {
      const questions = Object.entries(definition.questions).map(([id, question]) =>
        this.question(id, question),
      );
      const digest = this.digest(JSON.stringify({ input: record.inputJson, questions }));
      return {
        kind: "decision",
        content: create(DecisionRequestSchema, { input, questions, digest }),
      };
    }
    const outputSchemaJson = JSON.stringify(deriveOutputSchema(definition.output));
    const promptJson = generationPrompt(record);
    const digest = this.digest(
      JSON.stringify({ instructions: definition.instructions, outputSchemaJson, promptJson }),
    );
    return {
      kind: "generation",
      content: create(GenerationRequestSchema, {
        input,
        instructions: definition.instructions,
        outputSchemaJson,
        promptJson,
        digest,
        ...(record.corrects
          ? { corrects: create(AiAttemptIdSchema, { value: record.corrects }) }
          : {}),
      }),
    };
  },

  /**
   * Creates one declared decision question.
   *
   * @param id Id for this operation.
   * @param question Question for this operation.
   * @returns Typed question record.
   */
  question(id: string, question: DecisionQuestionDefinition): DecisionQuestion {
    const kind =
      question.type === "choice"
        ? DecisionQuestionKind.CHOICE
        : question.type === "score"
          ? DecisionQuestionKind.SCORE
          : DecisionQuestionKind.BOOLEAN;
    return create(DecisionQuestionSchema, {
      id: create(DecisionQuestionIdSchema, { value: id }),
      kind,
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
  },

  /**
   * Returns the SHA-256 digest of content.
   *
   * @param value Value for this operation.
   * @returns SHA-256 content digest.
   */
  digest(value: string): AiContentDigest {
    return create(AiContentDigestSchema, {
      value: createHash("sha256").update(value).digest("hex"),
    });
  },

  /**
   * Records safe failure with a runtime-assigned diagnostic ID.
   *
   * @param request Request for this operation.
   * @param ticket Ticket for this operation.
   * @param code Code for this operation.
   * @param retryable Retryable for this operation.
   * @param usage Usage for this operation.
   * @returns Runtime-recorded safe failure.
   */
  async failure(
    request: AiBackendExecution,
    ticket: AiAttemptTicket,
    code: AiFailure["code"],
    retryable: boolean,
    usage?: AiUsage,
  ): Promise<AiBackendOutcome> {
    const failure = await request.control.recordFailure(code, retryable);
    const response =
      request.definition.kind === "generation"
        ? create(GenerationResponseSchema, {
            outcome: code === "REFUSED" ? AiOutcome.REFUSED : AiOutcome.FAILED,
            diagnosticId: create(AiDiagnosticIdSchema, { value: failure.diagnosticId }),
            ...(usage ? { usage } : {}),
          })
        : create(DecisionResponseSchema, {
            outcome: code === "REFUSED" ? AiOutcome.REFUSED : AiOutcome.FAILED,
            diagnosticId: create(AiDiagnosticIdSchema, { value: failure.diagnosticId }),
            ...(usage ? { usage } : {}),
          });
    await request.control.finishAttempt({
      ticketId: ticket.id,
      response,
      ...(usage ? { usage } : {}),
    });
    return { ok: false, failure };
  },

  /**
   * Validates and journals one generation candidate.
   *
   * @param request Request for this operation.
   * @param ticket Ticket for this operation.
   * @param record Record for this operation.
   * @param script Script for this operation.
   * @returns Validated output or recorded failure.
   */
  async generation(
    request: AiBackendExecution,
    ticket: AiAttemptTicket,
    record: RequestRecord,
    script: TextScript,
  ): Promise<AiBackendOutcome> {
    if (request.definition.kind !== "generation")
      throw new TypeError("Generation script used for decision backend.");
    const bytes = Buffer.byteLength(script.text, "utf8");
    request.control.onReceived(ticket.id, bytes);
    if (bytes > ticket.maxOutputBytes)
      return this.failure(request, ticket, "BUDGET_EXCEEDED", false, script.usage);
    record.candidateText = script.text;
    const admitted = await request.control.admitGeneration(
      script.text,
      request.definition,
      request.input,
    );
    record.validationIssues = admitted.ok ? [] : admitted.issues;
    const failure = admitted.ok
      ? undefined
      : await request.control.recordFailure("INVALID_OUTPUT", false);
    const response = this.generationReply(request, script, admitted, failure);
    await request.control.finishAttempt({
      ticketId: ticket.id,
      receivedBytes: bytes,
      response,
      ...(!admitted.ok ? { issues: admitted.issues } : {}),
      ...(script.usage ? { usage: script.usage } : {}),
    });
    if (admitted.ok) return { ok: true, value: admitted.value };
    if (failure === undefined) throw new Error("Scripted failure diagnostic was not recorded.");
    return { ok: false, failure };
  },

  /**
   * Validates and journals one non-generative decision.
   *
   * @param request Request for this operation.
   * @param ticket Ticket for this operation.
   * @param record Record for this operation.
   * @param script Script for this operation.
   * @returns Validated output or recorded failure.
   */
  async decision(
    request: AiBackendExecution,
    ticket: AiAttemptTicket,
    record: RequestRecord,
    script: DecisionScript,
  ): Promise<AiBackendOutcome> {
    if (request.definition.kind !== "decision")
      throw new TypeError("Decision script used for generation backend.");
    const text = JSON.stringify(script.result);
    const bytes = Buffer.byteLength(text, "utf8");
    request.control.onReceived(ticket.id, bytes);
    if (bytes > ticket.maxOutputBytes)
      return this.failure(request, ticket, "BUDGET_EXCEEDED", false, script.usage);
    const admitted = await request.control.admitDecision(
      script.result,
      request.definition,
      request.input,
    );
    record.validationIssues = admitted.ok ? [] : admitted.issues;
    const failure = admitted.ok
      ? undefined
      : await request.control.recordFailure("INVALID_OUTPUT", false);
    const response = this.decisionReply(request, script, admitted, failure);
    await request.control.finishAttempt({
      ticketId: ticket.id,
      receivedBytes: bytes,
      response,
      ...(!admitted.ok ? { issues: admitted.issues } : {}),
      ...(script.usage ? { usage: script.usage } : {}),
    });
    if (admitted.ok) return { ok: true, value: admitted.value };
    if (failure === undefined) throw new Error("Scripted failure diagnostic was not recorded.");
    return { ok: false, failure };
  },

  /**
   * Builds a generation response for the journal.
   *
   * @param request Request for this operation.
   * @param script Script for this operation.
   * @param admitted Admitted for this operation.
   * @param failure Failure for this operation.
   * @returns Journal-ready generation response.
   */
  generationReply(
    request: AiBackendExecution,
    script: TextScript,
    admitted: AiCandidateAdmission,
    failure?: AiFailure,
  ): GenerationResponse {
    return create(GenerationResponseSchema, {
      rawOutput: script.text,
      outcome: admitted.ok ? AiOutcome.ADMITTED : AiOutcome.INVALID_OUTPUT,
      ...(admitted.ok
        ? { admittedOutput: AnyMessages.pack(request.definition.output, admitted.value) }
        : {}),
      ...(failure
        ? { diagnosticId: create(AiDiagnosticIdSchema, { value: failure.diagnosticId }) }
        : {}),
      ...(script.usage ? { usage: script.usage } : {}),
      digest: this.digest(script.text),
    });
  },

  /**
   * Builds a decision response for the journal.
   *
   * @param request Request for this operation.
   * @param script Script for this operation.
   * @param admitted Admitted for this operation.
   * @param failure Failure for this operation.
   * @returns Journal-ready decision response.
   */
  decisionReply(
    request: AiBackendExecution,
    script: DecisionScript,
    admitted: AiCandidateAdmission,
    failure?: AiFailure,
  ): DecisionResponse {
    return create(DecisionResponseSchema, {
      answers: Object.entries(script.result.answers).map(([id, answer]) => this.answer(id, answer)),
      outcome: admitted.ok ? AiOutcome.ADMITTED : AiOutcome.INVALID_OUTPUT,
      ...(admitted.ok
        ? { admittedOutput: AnyMessages.pack(request.definition.output, admitted.value) }
        : {}),
      ...(failure
        ? { diagnosticId: create(AiDiagnosticIdSchema, { value: failure.diagnosticId }) }
        : {}),
      ...(script.usage ? { usage: script.usage } : {}),
    });
  },

  /**
   * Builds one provider answer for the decision journal.
   *
   * @param id Id for this operation.
   * @param answer Answer for this operation.
   * @returns Typed provider answer.
   */
  answer(id: string, answer: AiAnswer): DecisionAnswer {
    const kind =
      answer.type === "choice"
        ? DecisionQuestionKind.CHOICE
        : answer.type === "score"
          ? DecisionQuestionKind.SCORE
          : DecisionQuestionKind.BOOLEAN;
    const value = this.answerValue(answer);
    const probabilities = answer.type === "boolean" ? undefined : answer.probabilities;
    return create(DecisionAnswerSchema, {
      id: create(DecisionQuestionIdSchema, { value: id }),
      kind,
      value,
      ...(probabilities ? { distribution: this.distribution(probabilities) } : {}),
      ...(answer.type !== "boolean" && answer.confidence !== undefined
        ? { confidence: answer.confidence }
        : {}),
    });
  },

  /**
   * Maps one answer kind to its Proto oneof.
   *
   * @param answer Answer for this operation.
   * @returns Typed answer oneof.
   */
  answerValue(answer: AiAnswer): DecisionAnswer["value"] {
    if (answer.type === "choice")
      return {
        case: "choice",
        value: create(DecisionAlternativeKeySchema, { value: answer.choice }),
      };
    if (answer.type === "score") return { case: "score", value: answer.score };
    return { case: "booleanProbability", value: answer.probability };
  },

  /**
   * Builds a provider answer distribution.
   *
   * @param probabilities Probabilities for this operation.
   * @returns Typed full distribution.
   */
  distribution(probabilities: Readonly<Record<string, number>>): DecisionDistribution {
    return create(DecisionDistributionSchema, {
      probabilities: Object.entries(probabilities).map(([key, probability]) =>
        create(DecisionProbabilitySchema, {
          key: create(DecisionAlternativeKeySchema, { value: key }),
          probability,
        }),
      ),
    });
  },
});
