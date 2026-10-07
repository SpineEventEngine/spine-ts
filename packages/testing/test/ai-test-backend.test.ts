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
import { createHash } from "node:crypto";
import { AnyMessages } from "@spine-event-engine/core";
import { AiModel, AiRegistry, ModelRef, type AiDecisionResult } from "@spine-event-engine/ai";
import {
  backendDefinition,
  type AiAttemptRequest,
  type AiBackendExecution,
  type AiExecutionControl,
} from "@spine-event-engine/ai/spi/adapter";
import { parseCandidate, selectDeployment } from "@spine-event-engine/ai/spi/runtime";
import {
  AiOperationIdSchema,
  AiTokenCountSchema,
  AiUsageSchema,
  AiOutcome,
  DecisionResponseSchema,
  GenerationResponseSchema,
} from "@spine-event-engine/proto/agent";
import { describe, expect, it, vi } from "vitest";
import {
  ProposedSupportReplySchema,
  SupportReplyFactsSchema,
} from "../test-fixtures/generated/support_ai_types_pb.js";
import { AiTestBackend } from "../src/index.js";

const limits = {
  modelRequests: 2,
  toolCalls: 0,
  deadlineMs: 1000,
  maxInputBytes: 4000,
  maxOutputBytes: 4000,
  maxOutputTokens: 100,
};
const decisionLimits = {
  modelRequests: 2,
  toolCalls: 0,
  deadlineMs: 1000,
  maxInputBytes: 4000,
  maxOutputBytes: 4000,
};

const generation = AiModel.define({
  name: "draft-support-reply",
  version: "v1",
  kind: "generation",
  input: SupportReplyFactsSchema,
  output: ProposedSupportReplySchema,
  instructions: "Draft a support reply",
  outputMode: "prompt-and-validate",
  limits,
});

const decision = AiModel.define({
  name: "review-support-reply",
  version: "v1",
  kind: "decision",
  input: SupportReplyFactsSchema,
  output: ProposedSupportReplySchema,
  questions: { safe: { type: "boolean", instructions: "Is the proposed reply safe?" } },
  mapping: {
    version: "v1",
    toMessage: () => create(ProposedSupportReplySchema, { reply: "Approved" }),
  },
  limits: decisionLimits,
});

const facts = create(SupportReplyFactsSchema, {
  ticketNumber: "T-47",
  question: "Where is my order?",
  ticketRevision: 9_007_199_254_740_993n,
});

function harness(backend: AiTestBackend, model = generation) {
  const controller = new AbortController();
  const attempts: unknown[] = [];
  const completions: unknown[] = [];
  const failures: string[] = [];
  const control = {
    signal: controller.signal,
    deadlineEpochMs: Date.now() + 1000,
    nowEpochMs: () => Date.now(),
    hasAuthority: () => true,
    beginAttempt: (request: unknown) => {
      attempts.push(request);
      return Promise.resolve({
        id: `ticket-${String(attempts.length)}`,
        maxInputBytes: 4000,
        maxOutputBytes: 4000,
        deadlineEpochMs: Date.now() + 1000,
        signal: controller.signal,
      });
    },
    reserveTransport: vi.fn(() => Promise.resolve()),
    onReceived: vi.fn(),
    finishAttempt: (completion: unknown) => {
      completions.push(completion);
      return Promise.resolve();
    },
    recordFailure: (code: string, retryableByNewSignal: boolean) => {
      failures.push(code);
      return Promise.resolve({
        code,
        retryableByNewSignal,
        diagnosticId: `runtime-${String(failures.length)}`,
      });
    },
    admitGeneration: (candidate: string) => parseCandidate(ProposedSupportReplySchema, candidate),
    admitDecision: (result: AiDecisionResult) =>
      result.answers.safe?.type === "boolean" && result.answers.safe.probability >= 0
        ? { ok: true as const, value: create(ProposedSupportReplySchema, { reply: "Approved" }) }
        : {
            ok: false as const,
            issues: [{ code: "INVALID_ANSWER", path: "safe", message: "Missing" }],
          },
    callTool: () => Promise.reject(new Error("No tool calls expected")),
  } as unknown as AiExecutionControl;
  const request = {
    operationId: create(AiOperationIdSchema, { value: "op-1" }),
    call: "draft-reply",
    scope: {} as AiBackendExecution["scope"],
    identity: { provider: "scripted", account: "test", endpoint: "local", model: "fixture" },
    model: backend,
    definition: model.definition,
    input: facts,
    control,
  } as AiBackendExecution;
  return { request, controller, attempts, completions, failures, control };
}

describe("AiTestBackend", () => {
  it("rejects saved response-kind and diagnostic changes without consuming scripts", async () => {
    const backend = AiTestBackend.create({ ref: ModelRef.of("fixture", "v1"), kind: "decision" });
    backend.forModel(decision).refuse();
    const run = harness(backend, decision);
    const admitted = create(GenerationResponseSchema, {
      outcome: AiOutcome.ADMITTED,
      admittedOutput: AnyMessages.pack(
        ProposedSupportReplySchema,
        create(ProposedSupportReplySchema, { reply: "Same output type" }),
      ),
    });
    const wrongKind = {
      ...run.request,
      control: {
        ...run.control,
        beginAttempt: () => Promise.resolve({ kind: "replay", id: "saved", response: admitted }),
      },
    } as AiBackendExecution;
    await expect(backendDefinition(backend.registration).execute(wrongKind)).rejects.toThrow(
      "changed request kind",
    );
    const wrongDiagnostic = {
      ...run.request,
      control: {
        ...run.control,
        beginAttempt: () =>
          Promise.resolve({
            kind: "replay",
            id: "saved",
            response: create(DecisionResponseSchema, {
              outcome: AiOutcome.FAILED,
              diagnosticId: { value: "original" },
            }),
            failure: { code: "UNAVAILABLE", diagnosticId: "changed", retryableByNewSignal: true },
          }),
      },
    } as AiBackendExecution;
    await expect(backendDefinition(backend.registration).execute(wrongDiagnostic)).rejects.toThrow(
      "cannot be reconstructed",
    );
    expect(run.control.reserveTransport).not.toHaveBeenCalled();
    expect(run.completions).toHaveLength(0);
    await backendDefinition(backend.registration).execute(harness(backend, decision).request);
    backend.assertSatisfied();
  });

  it.each([
    {
      model: generation,
      response: create(GenerationResponseSchema, {
        outcome: AiOutcome.INVALID_OUTPUT,
        diagnosticId: { value: "saved-invalid" },
        rawOutput: "bad",
      }),
      code: "INVALID_OUTPUT",
      retryable: false,
    },
    {
      model: generation,
      response: create(GenerationResponseSchema, {
        outcome: AiOutcome.FAILED,
        diagnosticId: { value: "saved-failed" },
      }),
      code: "UNAVAILABLE",
      retryable: true,
    },
    {
      model: decision,
      response: create(DecisionResponseSchema, {
        outcome: AiOutcome.INVALID_OUTPUT,
        diagnosticId: { value: "saved-invalid-decision" },
      }),
      code: "INVALID_OUTPUT",
      retryable: false,
    },
    {
      model: decision,
      response: create(DecisionResponseSchema, {
        outcome: AiOutcome.REFUSED,
        diagnosticId: { value: "saved-refused" },
      }),
      code: "REFUSED",
      retryable: false,
    },
  ])(
    "replays saved $code without consuming a fresh script",
    async ({ model, response, code, retryable }) => {
      const backend = AiTestBackend.create({
        ref: ModelRef.of("fixture", "v1"),
        kind: model.definition.kind,
      });
      backend.forModel(model).refuse();
      const run = harness(backend, model);
      const diagnosticId = response.diagnosticId?.value ?? "";
      const replay = {
        kind: "replay" as const,
        id: "saved-attempt",
        response,
        failure: { code, retryableByNewSignal: retryable, diagnosticId },
      };
      const request = {
        ...run.request,
        control: {
          ...run.control,
          beginAttempt: vi.fn(() => Promise.resolve(replay)),
        },
      } as AiBackendExecution;
      expect(await backendDefinition(backend.registration).execute(request)).toMatchObject({
        ok: false,
        failure: replay.failure,
      });
      expect(run.completions).toHaveLength(0);
      expect(run.control.reserveTransport).not.toHaveBeenCalled();
      const fresh = harness(backend, model);
      await backendDefinition(backend.registration).execute(fresh.request);
      backend.assertSatisfied();
    },
  );

  it("registers through the normal registry and validates typed output after barriers", async () => {
    const backend = AiTestBackend.create({ ref: ModelRef.of("fixture", "v1"), kind: "generation" });
    const response = create(ProposedSupportReplySchema, {
      reply: "Your order is on its way.",
      knowledgeRevision: 9_007_199_254_740_993n,
    });
    backend
      .forModel(generation)
      .respondWith(response)
      .withUsage(create(AiUsageSchema, { inputTokens: create(AiTokenCountSchema, { value: 8n }) }));
    const registry = AiRegistry.create({
      defaultModels: { generation: backend.registration.ref },
      invocationLimits: {
        operations: 1,
        modelRequests: 2,
        toolCalls: 0,
        recordedReads: 1,
        deadlineMs: 1000,
        totalInputBytes: 5000,
        totalOutputBytes: 5000,
        maxRecoveryBytes: 5000,
      },
      concurrentOperations: 1,
      queuedOperations: 0,
    }).register(backend.registration);
    expect(registry).toBeDefined();
    expect(selectDeployment(registry, { kind: "generation", models: [generation] })).toBe(
      backend.registration,
    );
    const registered = backendDefinition(backend.registration);
    const identity = await registered.resolveIdentity(
      {} as AiBackendExecution["scope"],
      {} as never,
    );
    expect(identity.model).toBe("fixture");
    expect(
      await registered.authorizeUse({} as AiBackendExecution["scope"], identity, {} as never),
    ).toBe(true);
    expect(
      (await registered.connect({} as AiBackendExecution["scope"], identity, {} as never)).model,
    ).toBe(backend);
    const run = harness(backend);
    const outcome = await backendDefinition(backend.registration).execute(run.request);
    expect(outcome).toEqual({ ok: true, value: response });
    expect(run.attempts).toHaveLength(1);
    expect(run.control.reserveTransport).toHaveBeenCalledOnce();
    expect(run.completions).toHaveLength(1);
    expect((run.completions[0] as { response: { outcome: AiOutcome } }).response.outcome).toBe(
      AiOutcome.ADMITTED,
    );
    expect(backend.requests()[0]).toMatchObject({
      modelName: "draft-support-reply",
      call: "draft-reply",
      attempt: 1,
    });
    expect(backend.requests()[0]?.inputJson).toContain("9007199254740993");
    expect(backend.requests()[0]?.toolNames).toEqual([]);
    backend.assertSatisfied();
  });

  it("reports an unscripted required correction after recording invalid output", async () => {
    const backend = AiTestBackend.create({ ref: ModelRef.of("fixture", "v1"), kind: "generation" });
    backend.forModel(generation).respondWithText("not JSON");
    const run = harness(backend);
    const outcome = await backendDefinition(backend.registration).execute(run.request);
    expect(outcome).toMatchObject({
      ok: false,
      failure: { code: "UNAVAILABLE", diagnosticId: "runtime-2" },
    });
    expect(run.attempts).toHaveLength(2);
    expect(backend.requests()[0]?.validationIssues[0]?.code).toBe("MALFORMED_JSON");
    expect(backend.requests()[1]).toMatchObject({
      attempt: 2,
      corrects: "ticket-1",
      correctionIssues: [{ code: "MALFORMED_JSON" }],
    });
    expect(() => {
      backend.assertSatisfied();
    }).toThrow("unexpected request");
  });

  it("corrects an invalid generation candidate within one bounded invocation", async () => {
    const backend = AiTestBackend.create({ ref: ModelRef.of("fixture", "v1"), kind: "generation" });
    backend
      .forModel(generation)
      .respondWithText("not JSON")
      .respondWithText('{"reply":"Corrected"}');
    const run = harness(backend);
    const outcome = await backendDefinition(backend.registration).execute(run.request);
    expect(outcome).toMatchObject({ ok: true, value: { reply: "Corrected" } });
    expect(run.attempts).toHaveLength(2);
    expect(run.completions).toMatchObject([
      { response: { outcome: AiOutcome.INVALID_OUTPUT, diagnosticId: { value: "runtime-1" } } },
      { response: { outcome: AiOutcome.ADMITTED } },
    ]);
    expect(backend.requests()[1]).toMatchObject({
      attempt: 2,
      corrects: "ticket-1",
      correctionIssues: [{ code: "MALFORMED_JSON" }],
    });
    const correction = run.attempts[1] as AiAttemptRequest;
    if (correction.kind !== "generation") throw new Error("Expected generation correction");
    const prompt = JSON.parse(correction.content.promptJson) as {
      correction?: { candidate?: string; issues?: { code: string }[] };
    };
    expect(prompt.correction).toMatchObject({
      candidate: "not JSON",
      issues: [{ code: "MALFORMED_JSON" }],
    });
    const digestInput = JSON.stringify({
      instructions: correction.content.instructions,
      outputSchemaJson: correction.content.outputSchemaJson,
      promptJson: correction.content.promptJson,
    });
    expect(correction.content.digest?.value).toBe(
      createHash("sha256").update(digestInput).digest("hex"),
    );
    backend.assertSatisfied();
  });

  it("does not consume a response or count dispatch when reservation fails", async () => {
    const backend = AiTestBackend.create({ ref: ModelRef.of("fixture", "v1"), kind: "generation" });
    backend.forModel(generation).respondWithText("{}");
    const run = harness(backend);
    const request = {
      ...run.request,
      control: {
        ...run.request.control,
        reserveTransport: () => Promise.reject(new Error("reservation failed")),
      },
    } as AiBackendExecution;
    await expect(backendDefinition(backend.registration).execute(request)).rejects.toThrow(
      "reservation failed",
    );
    expect(backend.requests()).toEqual([]);
    expect(() => {
      backend.assertSatisfied();
    }).toThrow("unused");
  });

  it("rejects prepared input beyond the capability byte budget before dispatch", async () => {
    const backend = AiTestBackend.create({ ref: ModelRef.of("fixture", "v1"), kind: "generation" });
    const run = harness(backend);
    const request = {
      ...run.request,
      definition: {
        ...generation.definition,
        limits: { ...generation.definition.limits, maxInputBytes: 1 },
      },
    } as AiBackendExecution;
    await expect(backendDefinition(backend.registration).execute(request)).rejects.toThrow(
      "prepared input exceeds",
    );
    expect(run.attempts).toEqual([]);
    expect(backend.requests()).toEqual([]);
  });

  it("bounds simulated received bytes before journaling provider text", async () => {
    const backend = AiTestBackend.create({ ref: ModelRef.of("fixture", "v1"), kind: "generation" });
    backend.forModel(generation).respondWithText(JSON.stringify({ reply: "X".repeat(5000) }));
    const run = harness(backend);
    const outcome = await backendDefinition(backend.registration).execute(run.request);
    expect(outcome).toMatchObject({ ok: false, failure: { code: "BUDGET_EXCEEDED" } });
    expect((run.completions[0] as { response: { rawOutput: string } }).response.rawOutput).toBe("");
    expect(run.control.onReceived).toHaveBeenCalledWith("ticket-1", 5012);
    backend.assertSatisfied();
  });

  it("reports all received bytes for an oversized decision", async () => {
    const backend = AiTestBackend.create({ ref: ModelRef.of("decision", "v1"), kind: "decision" });
    const answers = Object.fromEntries(
      Array.from({ length: 250 }, (_, index) => [
        `question-${String(index)}`,
        { type: "boolean" as const, probability: 0.5 },
      ]),
    );
    backend.forModel(decision).respondWithDecision({ answers });
    const run = harness(backend, decision);
    const outcome = await backendDefinition(backend.registration).execute(run.request);
    expect(outcome).toMatchObject({ ok: false, failure: { code: "BUDGET_EXCEEDED" } });
    expect(run.control.onReceived).toHaveBeenCalledWith(
      "ticket-1",
      Buffer.byteLength(JSON.stringify({ answers }), "utf8"),
    );
    backend.assertSatisfied();
  });

  it("copies queued response values and obtains failure IDs from the runtime", async () => {
    const backend = AiTestBackend.create({ ref: ModelRef.of("fixture", "v1"), kind: "generation" });
    const value = create(ProposedSupportReplySchema, { reply: "Original" });
    backend.forModel(generation).respondWith(value).failWith({
      code: "UNAVAILABLE",
      retryableByNewSignal: true,
      diagnosticId: "supplied-id",
    });
    value.reply = "Changed";
    const first = harness(backend);
    expect(await backendDefinition(backend.registration).execute(first.request)).toMatchObject({
      ok: true,
      value: { reply: "Original" },
    });
    const second = harness(backend);
    expect(await backendDefinition(backend.registration).execute(second.request)).toMatchObject({
      ok: false,
      failure: { diagnosticId: "runtime-1" },
    });
    backend.assertSatisfied();
  });

  it("rejects wrong-kind scripts and reports unused and unexpected requests", async () => {
    const backend = AiTestBackend.create({ ref: ModelRef.of("fixture", "v1"), kind: "generation" });
    expect(() => backend.forModel({} as never)).toThrow("AiModel.define");
    expect(() => backend.forModel(decision)).toThrow("kind");
    const scripts = backend.forModel(generation);
    const conflicting = AiModel.define({
      name: "draft-support-reply",
      version: "v1",
      kind: "generation",
      input: SupportReplyFactsSchema,
      output: ProposedSupportReplySchema,
      instructions: "Different revision body",
      outputMode: "prompt-and-validate",
      limits,
    });
    expect(() => backend.forModel(conflicting)).toThrow("different definition");
    expect(() => scripts.respondWithDecision({ answers: {} })).toThrow("Decision answer");
    scripts.respondWithText("{}");
    expect(() => {
      backend.assertSatisfied();
    }).toThrow("unused");
    const run = harness(backend);
    await backendDefinition(backend.registration).execute(run.request);
    const second = harness(backend);
    await backendDefinition(backend.registration).execute(second.request);
    expect(() => {
      backend.assertSatisfied();
    }).toThrow("unexpected");
  });

  it("admits scripted decision answers through the decision barrier", async () => {
    const backend = AiTestBackend.create({ ref: ModelRef.of("decision", "v1"), kind: "decision" });
    const scripts = backend.forModel(decision);
    expect(() =>
      scripts.respondWith(create(ProposedSupportReplySchema, { reply: "Wrong kind" })),
    ).toThrow("generation");
    expect(() => scripts.respondWithText("{}")).toThrow("generation");
    const answers: AiDecisionResult = { answers: { safe: { type: "boolean", probability: 0.9 } } };
    scripts.respondWithDecision(answers);
    const run = harness(backend, decision);
    const outcome = await backendDefinition(backend.registration).execute(run.request);
    expect(outcome).toMatchObject({ ok: true, value: { reply: "Approved" } });
    expect(run.attempts).toHaveLength(1);
    expect((run.completions[0] as { response: { outcome: AiOutcome } }).response.outcome).toBe(
      AiOutcome.ADMITTED,
    );
    backend.assertSatisfied();
  });

  it("journals decision validation errors, refusal, usage, and answer variants", async () => {
    const rich = AiModel.define({
      name: "route-support-reply",
      version: "v1",
      kind: "decision",
      input: SupportReplyFactsSchema,
      output: ProposedSupportReplySchema,
      questions: {
        lane: {
          type: "choice",
          instructions: "Select lane",
          criteria: { a: "Priority", b: "Normal" },
        },
        grade: { type: "score", instructions: "Grade reply", criteria: ["Poor", "Good"] },
      },
      mapping: {
        version: "v1",
        toMessage: () => create(ProposedSupportReplySchema, { reply: "Routed" }),
      },
      limits: decisionLimits,
    });
    const backend = AiTestBackend.create({ ref: ModelRef.of("decision", "v1"), kind: "decision" });
    const responses = backend.forModel(rich);
    expect(() => responses.withUsage(create(AiUsageSchema))).toThrow("queued response");
    const answers = {
      answers: {
        lane: { type: "choice", choice: "a", probabilities: { a: 0.8, b: 0.2 }, confidence: 0.8 },
        grade: {
          type: "score",
          score: 0.7,
          probabilities: { "0": 0.3, "1": 0.7 },
          confidence: 0.7,
        },
      },
    } satisfies AiDecisionResult;
    responses.respondWithDecision(answers).withUsage(
      create(AiUsageSchema, {
        inputTokens: create(AiTokenCountSchema, { value: 3n }),
      }),
    );
    answers.answers.lane.choice = "b";
    const run = harness(backend, rich);
    const richRequest = {
      ...run.request,
      control: {
        ...run.request.control,
        admitDecision: () => ({
          ok: true,
          value: create(ProposedSupportReplySchema, { reply: "Routed" }),
        }),
      },
    } as AiBackendExecution;
    expect(await backendDefinition(backend.registration).execute(richRequest)).toMatchObject({
      ok: true,
    });
    expect(
      (run.completions[0] as { response: { answers: { value: { case: string } }[] } }).response
        .answers[0]?.value.case,
    ).toBe("choice");
    expect(
      (run.completions[0] as { response: { answers: { value: { case: string } }[] } }).response
        .answers[1]?.value.case,
    ).toBe("score");
    responses.respondWithDecision({ answers: {} });
    const invalid = harness(backend, rich);
    expect(await backendDefinition(backend.registration).execute(invalid.request)).toMatchObject({
      ok: false,
      failure: { code: "INVALID_OUTPUT" },
    });
    expect(backend.requests().at(-1)?.validationIssues).toHaveLength(1);
    responses.refuse();
    const refused = harness(backend, rich);
    expect(await backendDefinition(backend.registration).execute(refused.request)).toMatchObject({
      ok: false,
      failure: { code: "REFUSED" },
    });
    expect((refused.completions[0] as { response: { outcome: AiOutcome } }).response.outcome).toBe(
      AiOutcome.REFUSED,
    );
    backend.assertSatisfied();
  });

  it("releases delayed responses and cancels an unreleased response", async () => {
    const backend = AiTestBackend.create({ ref: ModelRef.of("fixture", "v1"), kind: "generation" });
    const scripts = backend.forModel(generation);
    const gate = scripts.delay();
    scripts.respondWith(create(ProposedSupportReplySchema, { reply: "Ready" }));
    const run = harness(backend);
    const pending = backendDefinition(backend.registration).execute(run.request);
    await Promise.resolve();
    expect(run.attempts).toHaveLength(1);
    expect(() => {
      backend.assertSatisfied();
    }).toThrow("pending");
    gate.release();
    await expect(pending).resolves.toMatchObject({ ok: true });
    run.controller.abort();
    backend.assertSatisfied();
    const blocked = scripts.delay();
    scripts.respondWithText("{}");
    const cancelled = harness(backend);
    const waiting = backendDefinition(backend.registration).execute(cancelled.request);
    cancelled.controller.abort();
    await expect(waiting).rejects.toThrow("cancelled");
    expect(() => {
      backend.assertSatisfied();
    }).toThrow("pending");
    blocked.release();
  });

  it("reserves each gated response for its admitted request under concurrency", async () => {
    const backend = AiTestBackend.create({ ref: ModelRef.of("fixture", "v1"), kind: "generation" });
    const responses = backend.forModel(generation);
    const gate = responses.delay();
    responses.respondWith(create(ProposedSupportReplySchema, { reply: "First" }));
    responses.respondWith(create(ProposedSupportReplySchema, { reply: "Second" }));
    const first = harness(backend);
    const second = harness(backend);
    const waiting = backendDefinition(backend.registration).execute(first.request);
    await Promise.resolve();
    expect(() => {
      backend.assertSatisfied();
    }).toThrow("pending");
    const concurrent = backendDefinition(backend.registration).execute(second.request);
    await expect(concurrent).resolves.toMatchObject({ ok: true, value: { reply: "Second" } });
    expect(() => {
      backend.assertSatisfied();
    }).toThrow("pending");
    gate.release();
    await expect(waiting).resolves.toMatchObject({ ok: true, value: { reply: "First" } });
    backend.assertSatisfied();
  });
});
