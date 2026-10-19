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

import { clone, toBinary } from "@bufbuild/protobuf";
import type { CommandId } from "@spine-event-engine/proto";
import {
  AgentExecutionRecordSchema,
  AgentSavedDispatchPlanSchema as SavedDispatchPlanSchema,
  AgentSavedTargetKind,
  AgentSavedRepositoryFamily,
  type AgentExecutionRecord,
  type AgentOutgoingCommand,
  type AgentSavedDispatchTarget,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";

/**
 * Enforces immutable saved output envelopes and one-time route preparation.
 */
export const AgentExecutionTransitions = {
  /**
   * Rejects an initial completion that claims transport acceptance or a saved route.
   *
   * @param record Persisted Agent execution record.
   */
  assertCompletion(record: AgentExecutionRecord): void {
    const originalIds = new Set<string>();
    for (const output of record.completion?.commands ?? []) {
      if (output.command === undefined || output.delivered || output.plan !== undefined)
        throw new Error("Agent completion requires an undelivered original output without a plan.");
      const original = this.originalId(output);
      if (originalIds.has(original))
        throw new Error("Agent completion has duplicate outgoing IDs.");
      originalIds.add(original);
    }
  },

  /**
   * Reads the complete typed ID of one original outgoing envelope.
   *
   * @param output Original outgoing Command envelope.
   * @returns Kind and nonempty source ID.
   */
  originalId(output: AgentOutgoingCommand): string {
    const id = output.command?.id?.uuid;
    if (!id?.trim()) throw new Error("Agent outgoing original ID must be nonempty.");
    return `command:${id}`;
  },

  /**
   * Accepts only absent-to-present saved-plan installation after completion.
   *
   * @param next Proposed next execution record.
   * @param prior Previously persisted execution record.
   */
  assertUpdate(prior: AgentExecutionRecord, next: AgentExecutionRecord): void {
    if (prior.completion === undefined) {
      if (next.completion !== undefined)
        throw new Error(
          "Agent execution update cannot install completion outside conditional commit.",
        );
      return;
    }
    if (next.completion?.commands.length !== prior.completion.commands.length)
      throw new Error("Agent saved outputs cannot be replaced.");
    const masked = clone(AgentExecutionRecordSchema, next);
    const priorCompletion = prior.completion;
    const maskedCompletion = masked.completion;
    if (maskedCompletion === undefined) throw new Error("Agent completion is missing.");
    for (let i = 0; i < prior.completion.commands.length; i += 1) {
      const old = priorCompletion.commands[i];
      const current = next.completion.commands[i];
      const maskedOutput = maskedCompletion.commands[i];
      if (old === undefined || current === undefined || maskedOutput === undefined)
        throw new Error("Agent saved output is missing.");
      if (old.plan !== undefined && !this.samePlan(old, current))
        throw new Error("Agent saved output plan is immutable.");
      if (old.plan === undefined && current.plan !== undefined) this.validatePlan(current);
      maskedOutput.plan = old.plan;
    }
    if (!this.sameRecord(prior, masked))
      throw new Error("Completed Agent execution permits only one-time output plan installation.");
  },

  /**
   * Validates a persisted plan before acknowledging each selected original ID.
   *
   * @param record Persisted Agent execution record.
   * @param signals Original outgoing Command identities.
   */
  assertDelivery(record: AgentExecutionRecord, signals: readonly CommandId[]): void {
    for (const signal of signals) {
      const output = record.completion?.commands.find((item) => this.matches(item, signal));
      if (output?.plan === undefined)
        throw new Error("Agent output cannot be acknowledged before its saved plan exists.");
    }
  },

  /**
   * Checks complete binding identities and typed repository recipients.
   *
   * @param output Saved outgoing signal.
   */
  validatePlan(output: AgentOutgoingCommand): void {
    if (output.delivered) throw new Error("Agent delivered output cannot install a route plan.");
    for (const target of output.plan?.targets ?? []) this.validateTarget(output, target);
  },

  /**
   * Rejects a target that cannot be rebound to the original output kind.
   *
   * @param output Saved outgoing signal.
   * @param target Prepared delivery target.
   */
  validateTarget(output: AgentOutgoingCommand, target: AgentSavedDispatchTarget): void {
    const repository = target.kind === AgentSavedTargetKind.AGENT_SAVED_REPOSITORY_COMMAND;
    if (
      !target.signalType.trim() ||
      !target.bindingFingerprint.trim() ||
      (target.kind !== AgentSavedTargetKind.AGENT_SAVED_REPOSITORY_COMMAND &&
        target.kind !== AgentSavedTargetKind.AGENT_SAVED_STANDALONE_COMMAND)
    )
      throw new Error("Agent saved dispatcher does not match the original output.");
    if (
      repository
        ? !target.receiverStateType.trim() ||
          target.repositoryFamily === AgentSavedRepositoryFamily.AGENT_SAVED_FAMILY_UNSPECIFIED ||
          target.recipients.some((id) => !id.typeUrl.trim())
        : target.receiverStateType !== "" ||
          target.repositoryFamily !== AgentSavedRepositoryFamily.AGENT_SAVED_FAMILY_UNSPECIFIED ||
          target.recipients.length > 0
    )
      throw new Error("Agent saved dispatcher has invalid repository or standalone identity.");
  },

  /**
   * Compares complete original plan bytes after installation.
   *
   * @param left First value in the comparison.
   * @param right Second value in the comparison.
   * @returns Whether both saved dispatch plans have identical bytes.
   */
  samePlan(left: AgentOutgoingCommand, right: AgentOutgoingCommand): boolean {
    if (left.plan === undefined || right.plan === undefined) return left.plan === right.plan;
    const a = toBinary(SavedDispatchPlanSchema, left.plan);
    const b = toBinary(SavedDispatchPlanSchema, right.plan);
    return a.length === b.length && a.every((byte, index) => byte === b[index]);
  },

  /**
   * Compares every execution field after masking the newly installed plans.
   *
   * @param left First value in the comparison.
   * @param right Second value in the comparison.
   * @returns Whether both execution records have identical bytes.
   */
  sameRecord(left: AgentExecutionRecord, right: AgentExecutionRecord): boolean {
    const a = toBinary(AgentExecutionRecordSchema, left);
    const b = toBinary(AgentExecutionRecordSchema, right);
    return a.length === b.length && a.every((byte, index) => byte === b[index]);
  },

  /**
   * Matches a selected typed original Command ID.
   *
   * @param output Saved outgoing Command.
   * @param signal Original Command identity.
   * @returns Whether the saved output has the original Command identity.
   */
  matches(output: AgentOutgoingCommand, signal: CommandId): boolean {
    return output.command?.id?.uuid === signal.uuid;
  },
};
