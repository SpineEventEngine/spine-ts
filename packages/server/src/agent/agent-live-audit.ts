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

import { create, type MessageShape } from "@bufbuild/protobuf";
import { type MessageSchema } from "@spine-event-engine/core";
import type { Event } from "@spine-event-engine/proto";
import {
  AgentHistoryEntrySchema,
  AgentInvocationTerminatedSchema,
  type AgentHistoryEntry,
  type AgentInvocationTerminated,
  type AgentOperationRef,
} from "@spine-event-engine/proto/agent";
import {
  AgentHistoryRecords,
  type AgentHistoryStorage,
} from "@spine-event-engine/storage/provider";
import type { SignalMetadata } from "../runtime/signal-metadata.js";
import { AgentLiveInteractionEvents } from "./agent-live-interaction-events.js";
import type {
  AgentLiveInvocation,
  AgentLiveModel,
  AgentOperationIdentity,
} from "./agent-live-inputs.js";

/**
 * Saves one original Agent System Event with its conversation rows before publication.
 * @typeParam Id Typed Agent identifier.
 */
export class AgentLiveAudit<Id> {
  /**
   * Binds the live invocation and retained indexed Agent history handle.
   * @param invocation Original typed source and recipient.
   * @param stateSchema Generated Agent state descriptor.
   * @param entityId Typed Agent identifier for history writes.
   * @param agentKey Canonical Agent storage key.
   * @param history Retained immutable audit storage.
   * @param metadata Signal ID, Time, and causal context service.
   * @param onRegisterSchema Registers the System payload type before publication.
   * @param onPublish Publishes the original Event after its audit group commits.

   * @param checkSession Callback that validates the current execution session.
  */
  constructor(
    private readonly invocation: AgentLiveInvocation,
    private readonly stateSchema: MessageSchema,
    private readonly entityId: Id,
    private readonly agentKey: string,
    private readonly history: AgentHistoryStorage<Id>,
    private readonly metadata: SignalMetadata,
    private readonly onRegisterSchema: (schema: MessageSchema) => void,
    private readonly onPublish: (event: Event) => Promise<void>,
    private readonly checkSession: () => Promise<void> = () => Promise.resolve(),
  ) {}

  /**
   * Validates one operation reference against the original typed Agent signal.
   * @param operation Required operation and conversation identities.
   * @param selected Authorized model chosen for this live turn.
   * @returns Complete generated audit reference.
   */
  reference(operation: AgentOperationIdentity, selected: AgentLiveModel): AgentOperationRef {
    return AgentLiveInteractionEvents.operationRef(
      this.invocation,
      operation,
      this.stateSchema,
      selected,
    );
  }

  /**
   * Commits the original System row with related conversation rows, then publishes it.
   * @typeParam Schema Generated System payload descriptor.
   * @param schema Generated System payload descriptor.
   * @param payload Typed payload to retain and publish.
   * @param history Related original conversation entries.
   * @returns Completion after persistence and System publication.
   */
  async save<Schema extends MessageSchema>(
    schema: Schema,
    payload: MessageShape<Schema>,
    history: readonly AgentHistoryEntry[] = [],
  ): Promise<void> {
    const event = AgentLiveInteractionEvents.envelope(
      this.invocation,
      this.metadata,
      this.invocation.recipientId,
      schema,
      payload,
    );
    const entries = [...history, this.entry(event)];
    const sizes = entries.map((entry) =>
      AgentHistoryRecords.bytes(this.invocation.stateType, this.agentKey, entry),
    );
    const capacity = this.history.capacity;
    const maxRecord = capacity.historyRecordBytes;
    if (maxRecord !== undefined && sizes.some((size) => size > maxRecord))
      throw new RangeError("Agent audit history row exceeds provider capacity.");
    if (
      capacity.transactionPayloadBytes !== undefined &&
      sizes.reduce((sum, size) => sum + size, 0) > capacity.transactionPayloadBytes
    )
      throw new RangeError("Agent audit history group exceeds provider capacity.");
    await this.checkSession();
    this.onRegisterSchema(schema);
    await this.history.appendAll(this.entityId, entries);
    await this.checkSession();
    await this.onPublish(event);
  }

  /**
   * Writes a definite model-use denial and preserves both denial and audit failure.
   * @param fact Source-correlated pre-handler termination fact.
   * @param denial Original model authorization failure.
   * @returns Completion after the fact is retained and published.
   */
  async saveDenial(fact: AgentInvocationTerminated, denial: Error): Promise<void> {
    try {
      await this.save(AgentInvocationTerminatedSchema, fact);
    } catch (failure) {
      throw new AggregateError([denial, failure], "Agent model denial audit failed.");
    }
  }

  /**
   * Wraps one original System Event in the indexed Agent history oneof.
   *
   * @param event Original typed Event envelope.
   * @returns The indexed history entry containing the original System Event.
   */
  private entry(event: Event): AgentHistoryEntry {
    const occurredAt = event.context?.timestamp;
    if (occurredAt === undefined) throw new Error("Agent audit Event requires Time.");
    return create(AgentHistoryEntrySchema, {
      occurredAt,
      item: { case: "systemEvent", value: event },
    });
  }
}
