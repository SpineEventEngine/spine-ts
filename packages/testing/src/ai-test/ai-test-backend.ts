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
import type { MessageSchema } from "@spine-event-engine/core";
import type {
  AiDecisionResult,
  AiFailure,
  AiModel as TypedModel,
  AiModelDefinition,
  ModelRef,
} from "@spine-event-engine/ai";
import {
  createBackendRegistration,
  type AiBackendExecution,
  type AiBackendOutcome,
  type AiBackendRegistration,
} from "@spine-event-engine/ai/spi/adapter";
import { isAiModel } from "@spine-event-engine/ai/spi/runtime";
import type { AiUsage } from "@spine-event-engine/proto/agent";
import { ScriptedAttempts, type ScriptQueue, type RequestRecord } from "./scripted-attempts.js";

/**
 * One actual physical request recorded at the scripted backend boundary.
 */
export interface AiTestRequest {
  /**
   * Application capability name.
   */
  readonly modelName: string;

  /**
   * Named Agent call supplied by the runtime.
   */
  readonly call: string;

  /**
   * One-based physical request number for the logical operation.
   */
  readonly attempt: number;

  /**
   * Bounded ProtoJSON of the application facts prepared for the backend.
   */
  readonly inputJson: string;

  /**
   * Correction target when this physical request corrects a prior attempt.
   */
  readonly corrects?: string;

  /**
   * Actual local validation issues observed for this response.
   */
  readonly validationIssues: readonly {
    readonly code: string;
    readonly path: string;
    readonly message: string;
  }[];

  /**
   * Issues supplied to this corrective attempt from its preceding response.
   */
  readonly correctionIssues: readonly {
    readonly code: string;
    readonly path: string;
    readonly message: string;
  }[];

  /**
   * Permitted tool names advertised by this generation capability.
   */
  readonly toolNames: readonly string[];
}

/**
 * Externally released pause on one scripted physical request.
 */
export interface AiTestGate {
  /**
   * Completes the paused response once.
   */
  release(): void;
}

/**
 * Response queue for one factory-created application capability.
 *
 * @typeParam O Generated output descriptor.
 */
export interface AiTestResponses<O extends MessageSchema> {
  /**
   * Queues typed output, serialized before the runtime parses and validates it.
   *
   * @param value Typed generation output.
   * @returns This response queue.
   */
  respondWith(value: MessageShape<O>): this;

  /**
   * Queues exact raw text for output and correction testing.
   *
   * @param text Exact provider candidate.
   * @returns This response queue.
   */
  respondWithText(text: string): this;

  /**
   * Queues provider decision answers for normal decision admission.
   *
   * @param result Provider answers keyed by question ID.
   * @returns This response queue.
   */
  respondWithDecision(result: AiDecisionResult): this;

  /**
   * Queues a safe failure category; runtime allocates the diagnostic ID.
   *
   * @param failure Safe category and retry policy; its diagnostic ID is ignored.
   * @returns This response queue.
   */
  failWith(failure: AiFailure): this;

  /**
   * Queues a provider refusal; runtime allocates its diagnostic ID.
   *
   * @returns This response queue.
   */
  refuse(): this;

  /**
   * Applies known provider usage to the most recently queued response.
   *
   * @param usage Present token counts, defensively copied.
   * @returns This response queue.
   */
  withUsage(usage: AiUsage): this;

  /**
   * Queues a pause before the next response until release or cancellation.
   *
   * @returns The gate controlling this pause.
   */
  delay(): AiTestGate;
}

/**
 * Scripted external model dependency registered by the normal AI registry.
 */
export class AiTestBackend {
  /**
   * Normal factory-proven deployment registration.
   */
  readonly registration: AiBackendRegistration;

  readonly #queues = new Map<string, ScriptQueue>();

  readonly #records: RequestRecord[] = [];

  /**
   * Creates the factory-proven registration for this scripted deployment.
   *
   * @param ref Credential-free deployment reference.
   * @param kind Generation or decision backend kind.
   */
  private constructor(ref: ModelRef, kind: "generation" | "decision") {
    this.registration = createBackendRegistration({
      ref,
      kind,
      supports: (definition) => definition.kind === kind,
      resolveIdentity: () => ({
        provider: "scripted",
        account: "test",
        endpoint: "local",
        model: this.registration.ref.name?.value ?? "",
      }),
      authorizeUse: () => true,
      connect: (_scope, identity) => ({ model: this, identity }),
      execute: (request) => this.execute(request),
    });
  }

  /**
   * Creates a network-free deployment selected by normal registry rules.
   *
   * @param options Deployment reference and API kind.
   * @returns Factory-proven scripted backend.
   */
  static create(options: {
    readonly ref: ModelRef;
    readonly kind: "generation" | "decision";
  }): AiTestBackend {
    return new AiTestBackend(options.ref, options.kind);
  }

  /**
   * Queues responses for a factory-created capability of this deployment kind.
   *
   * @typeParam I Generated input descriptor.
   * @typeParam O Generated output descriptor.
   * @param model Factory-created capability.
   * @returns Queue writer for this capability.
   */
  forModel<I extends MessageSchema, O extends MessageSchema>(
    model: TypedModel<I, O>,
  ): AiTestResponses<O> {
    if (!isAiModel(model))
      throw new TypeError("Scripted capability must come from AiModel.define().");
    const candidate = model.definition;
    if (candidate.kind !== this.registration.kind)
      throw new TypeError("Scripted response kind does not match backend kind.");
    const key = ScriptedAttempts.key(candidate.name, candidate.version);
    let queue = this.#queues.get(key);
    if (queue === undefined) {
      queue = {
        definition: candidate as unknown as AiModelDefinition<MessageSchema, MessageSchema>,
        scripts: [],
      };
      this.#queues.set(key, queue);
    } else if (queue.definition !== candidate) {
      throw new TypeError("Scripted capability revision already has a different definition.");
    }
    return ScriptedAttempts.responses(queue, candidate.output);
  }

  /**
   * Returns immutable snapshots of actual backend dispatches.
   *
   * @returns Physical request observations.
   */
  requests(): readonly AiTestRequest[] {
    return Object.freeze(
      this.#records
        .filter((record) => record.dispatched)
        .map((record) => ScriptedAttempts.snapshot(record)),
    );
  }

  /**
   * Checks for unused scripts, unexpected requests, and pending dispatches.
   */
  assertSatisfied(): void {
    const unused = [...this.#queues.values()].reduce(
      (count, queue) => count + queue.scripts.length,
      0,
    );
    const unexpected = this.#records.filter((record) => record.unexpected).length;
    const pending = this.#records.filter((record) => record.dispatched && !record.settled).length;
    if (unused || unexpected || pending)
      throw new Error(
        `Scripted AI backend: ${String(unused)} unused response(s), ` +
          `${String(unexpected)} unexpected request(s), ${String(pending)} pending request(s).`,
      );
  }

  /**
   * Executes bounded generation corrections through runtime journal and validation barriers.
   *
   * @param request Selected authenticated backend invocation.
   * @returns Admitted output or runtime-recorded failure.
   */
  private async execute(request: AiBackendExecution): Promise<AiBackendOutcome> {
    const key = ScriptedAttempts.key(request.definition.name, request.definition.version);
    const candidate = this.#queues.get(key);
    const queue = candidate?.definition === request.definition ? candidate : undefined;
    const operation = request.operationId.value;
    let prior = this.#records.findLast(
      (candidate) => candidate.operation === operation && candidate.dispatched,
    );
    for (;;) {
      const record = ScriptedAttempts.record(request, (prior?.attempt ?? 0) + 1, prior);
      this.#records.push(record);
      const outcome = await ScriptedAttempts.execute(request, record, queue);
      record.settled = true;
      if (
        outcome.ok ||
        request.definition.kind !== "generation" ||
        outcome.failure.code !== "INVALID_OUTPUT" ||
        record.attempt >= request.definition.limits.modelRequests
      )
        return outcome;
      prior = record;
    }
  }
}
