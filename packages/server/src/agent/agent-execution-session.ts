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

import { clone, create, toBinary, type Message } from "@bufbuild/protobuf";
import { EmptySchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  AiModelKind,
  ModelPreferenceSchema,
  ModelRefSchema,
  type AgentHistoryEntry,
  type ModelPreference,
  type ModelRef,
} from "@spine-event-engine/proto/agent";
import {
  AgentExecutionRecordSchema,
  type AgentExecutionRecord,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import type {
  AgentExecutionCapacity,
  AgentExecutionStorage,
} from "@spine-event-engine/storage/provider";
import { AgentExecutionFault } from "./agent-execution-fault.js";

type SessionStorage = Pick<
  AgentExecutionStorage<unknown, Message>,
  "capacity" | "update" | "renew" | "read" | "complete" | "markDelivered"
>;
type Completion = Parameters<SessionStorage["complete"]>[0];
type Delivered = Parameters<SessionStorage["markDelivered"]>[3];

/**
 * Serializes one claimed Agent record's journal and lease images.
 */
export class AgentExecutionSession {
  readonly #controller = new AbortController();

  #record: AgentExecutionRecord;

  readonly #initialPreferences: readonly ModelPreference[];

  readonly #preferences: ModelPreference[];

  #queue: Promise<void> = Promise.resolve();

  /**
   * Creates a serialized mutation boundary for one exact provider claim.
   * @param storage Provider methods for this Agent repository.
   * @param record Record returned by the successful claim.
   * @param token Exclusive token required by later provider writes.
   * @param preferences Per-instance selections observed at claim time.
   */
  constructor(
    private readonly storage: SessionStorage,
    record: AgentExecutionRecord,
    private readonly token: string,
    preferences: readonly ModelPreference[] = [],
  ) {
    if (record.accepted?.key === undefined || record.claimToken !== token)
      throw new Error("Agent execution session requires its exact claimed record.");
    this.#record = clone(AgentExecutionRecordSchema, record);
    this.#initialPreferences = preferences.map((entry) => clone(ModelPreferenceSchema, entry));
    this.#preferences = this.#initialPreferences.map((entry) =>
      clone(ModelPreferenceSchema, entry),
    );
  }

  /**
   * Cancels callbacks after provider authority is lost.
   * @returns Cancellation signal shared with scoped work.
   */
  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  /**
   * Returns a defensive copy of the last provider-confirmed image.
   * @returns Independent execution record image.
   */
  record(): AgentExecutionRecord {
    return clone(AgentExecutionRecordSchema, this.#record);
  }

  /**
   * Returns per-instance selections observed at the claim boundary.
   * @returns Independent copies of current staged selections.
   */
  preferences(): readonly ModelPreference[] {
    return this.#preferences.map((entry) => clone(ModelPreferenceSchema, entry));
  }

  /**
   * Returns selections fixed when this invocation claimed its Agent.
   * @returns Independent copies of the claim-time selections.
   */
  initialPreferences(): readonly ModelPreference[] {
    return this.#initialPreferences.map((entry) => clone(ModelPreferenceSchema, entry));
  }

  /**
   * Sets one per-kind selection for conditional completion of this signal.
   * @param kind Generation or decision kind being selected.
   * @param model Chosen deployment, or undefined to inherit the repository default.
   */
  stagePreference(kind: AiModelKind, model: ModelRef | undefined): void {
    if (this.signal.aborted) throw new Error("Agent execution claim is no longer active.");
    if (kind !== AiModelKind.GENERATION && kind !== AiModelKind.DECISION)
      throw new TypeError("Agent model preference requires a supported kind.");
    const selection =
      model === undefined
        ? { case: "inheritRepositoryDefault" as const, value: create(EmptySchema) }
        : { case: "model" as const, value: clone(ModelRefSchema, model) };
    const next = create(ModelPreferenceSchema, { kind, selection });
    const index = this.#preferences.findIndex((entry) => entry.kind === kind);
    if (index < 0) this.#preferences.push(next);
    else this.#preferences[index] = next;
  }

  /**
   * Restores claim-time selections after a draft is rejected before completion.
   */
  discardPreferenceChanges(): void {
    this.#preferences.splice(
      0,
      this.#preferences.length,
      ...this.#initialPreferences.map((entry) => clone(ModelPreferenceSchema, entry)),
    );
  }

  /**
   * Returns fixed provider payload bounds for pre-dispatch reservations.
   * @returns Provider capacity for the current Agent repository.
   */
  capacity(): AgentExecutionCapacity {
    return this.storage.capacity;
  }

  /**
   * Updates the journal against the latest provider-confirmed image.
   * @param makeNext Pure transformation of the last confirmed record.
   * @param historyEntries Conversation and System records saved with this update.
   * @returns Independent image confirmed by the provider write.
   */
  update(
    makeNext: (record: AgentExecutionRecord) => AgentExecutionRecord,
    historyEntries: readonly AgentHistoryEntry[] = [],
  ): Promise<AgentExecutionRecord> {
    return this.#enqueue(async () => {
      const current = this.record();
      const expectedRecordBytes = toBinary(AgentExecutionRecordSchema, current);
      const next = makeNext(current);
      const key = current.accepted?.key;
      if (key === undefined) throw new Error("Claimed Agent record lost its accepted key.");
      await this.storage.update({
        key,
        token: this.token,
        expectedRecordBytes,
        next,
        historyEntries,
      });
      this.#record = clone(AgentExecutionRecordSchema, next);
      return this.record();
    });
  }

  /**
   * Updates the claim expiry and reloads the provider image before later fenced writes.
   * @param expiresAt Requested later claim expiry.
   * @returns Reloaded provider-confirmed record image.
   */
  renew(expiresAt: Timestamp): Promise<AgentExecutionRecord> {
    return this.#enqueue(async () => {
      const key = this.#record.accepted?.key;
      if (key === undefined) throw new Error("Claimed Agent record lost its accepted key.");
      if (!(await this.storage.renew(key, this.token, expiresAt)))
        throw new Error("Agent execution lost its provider claim during renewal.");
      const refreshed = await this.storage.read(key);
      if (refreshed?.claimToken !== this.token)
        throw new Error("Agent execution lost its provider claim after renewal.");
      this.#record = clone(AgentExecutionRecordSchema, refreshed);
      return this.record();
    });
  }

  /**
   * Commits Entity and execution results under the same serialized fence.
   * @param makeNext Pure transformation of the last confirmed record.
   * @param historyEntries History records committed with the Entity transition.
   * @param entityCommit Conditional state and output commit, when supplied.
   * @returns Independent image confirmed by the atomic completion.
   */
  complete(
    makeNext: (record: AgentExecutionRecord) => AgentExecutionRecord,
    historyEntries: NonNullable<Completion["historyEntries"]>,
    entityCommit?: Completion["entityCommit"],
  ): Promise<AgentExecutionRecord> {
    return this.#enqueue(async () => {
      const current = this.record();
      const expectedRecordBytes = toBinary(AgentExecutionRecordSchema, current);
      const key = current.accepted?.key;
      if (key === undefined) throw new Error("Claimed Agent record lost its accepted key.");
      const next = makeNext(current);
      await this.storage.complete({
        key,
        token: this.token,
        expectedRecordBytes,
        next,
        historyEntries,
        ...(entityCommit === undefined ? {} : { entityCommit }),
      });
      this.#record = clone(AgentExecutionRecordSchema, next);
      return this.record();
    });
  }

  /**
   * Marks saved output IDs delivered and reloads the provider image.
   * @param signals Original output IDs accepted by normal delivery.
   * @returns Reloaded provider-confirmed record image.
   */
  markDelivered(signals: Delivered): Promise<AgentExecutionRecord> {
    return this.#enqueue(async () => {
      const current = this.record();
      const key = current.accepted?.key;
      if (key === undefined) throw new Error("Claimed Agent record lost its accepted key.");
      await this.storage.markDelivered(
        key,
        this.token,
        toBinary(AgentExecutionRecordSchema, current),
        signals,
      );
      const refreshed = await this.storage.read(key);
      if (refreshed === undefined)
        throw new Error("Agent output record disappeared after delivery.");
      this.#record = clone(AgentExecutionRecordSchema, refreshed);
      return this.record();
    });
  }

  /**
   * Stops later queued mutations from using this claim.
   */
  stop(): void {
    this.#controller.abort();
  }

  /**
   * Serializes one fenced provider operation after preceding writes settle.
   * @typeParam Result Result returned by the provider operation.
   * @param work Provider mutation to run while the session remains active.
   * @returns Mutation result or a claim-loss rejection.
   */
  #enqueue<Result>(work: () => Promise<Result>): Promise<Result> {
    const task = this.#queue.then(async () => {
      if (this.signal.aborted) throw new Error("Agent execution claim is no longer active.");
      try {
        return await work();
      } catch (error) {
        if (!(error instanceof AgentExecutionFault)) this.stop();
        throw error;
      }
    });
    this.#queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }
}
