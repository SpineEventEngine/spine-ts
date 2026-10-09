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
import { type Event } from "@spine-event-engine/proto";
import {
  AgentHistoryEntrySchema,
  AiModelKind,
  type AgentHistoryEntry,
  type AgentOperationRef,
} from "@spine-event-engine/proto/agent";
import {
  type AgentAcceptedInvocation,
  type AgentExecutionRecord,
  type AgentNamedOperation,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { AgentExecutionSizes } from "@spine-event-engine/storage/provider";
import type { SignalMetadata } from "../runtime/signal-metadata.js";
import { AgentExecutionSession } from "./agent-execution-session.js";
import { AgentInteractionEvents } from "./agent-interaction-events.js";

/**
 * Saves one original Agent interaction Event and posts it to the System Context.
 */
export class AgentInteractionAudit {
  /**
   * Binds interaction evidence to one accepted Agent invocation.
   *
   * @param session Fenced execution journal and history writer.
   * @param accepted Original accepted signal and recipient.
   * @param stateSchema Generated Agent state descriptor.
   * @param metadata Canonical signal metadata service.
   * @param onRegisterSchema Registers a System event payload descriptor.
   * @param onPublish Persists the System Context copy of an original Event.
   */
  constructor(
    private readonly session: AgentExecutionSession,
    private readonly accepted: AgentAcceptedInvocation,
    private readonly stateSchema: MessageSchema,
    private readonly metadata: SignalMetadata,
    private readonly onRegisterSchema: (schema: MessageSchema) => void,
    private readonly onPublish: (event: Event) => Promise<void>,
  ) {}

  /**
   * Creates a named call reference with its model fixed at invocation start.
   * @param operation Saved named operation.
   * @param kind Selected generation or decision kind.
   * @returns Reference with the accepted Agent, source, and model identities.
   */
  reference(operation: AgentNamedOperation, kind: AiModelKind): AgentOperationRef {
    const selected = this.session.record().started?.models.find((item) => item.kind === kind);
    if (selected === undefined) throw new Error("Agent audit requires a saved selected model.");
    return AgentInteractionEvents.operationRef(
      this.accepted,
      operation,
      this.stateSchema,
      selected,
    );
  }

  /**
   * Calculates an original typed System row size with this invocation's full scope.
   * @typeParam Schema Generated System event payload descriptor.
   * @param schema Payload descriptor.
   * @param payload Matching typed event payload.
   * @returns Encoded provider history-row size in bytes.
   */
  historyBytes<Schema extends MessageSchema>(
    schema: Schema,
    payload: MessageShape<Schema>,
  ): number {
    const scope = this.accepted.key?.scope;
    const id = this.accepted.recipientId;
    if (scope === undefined || id === undefined)
      throw new Error("Agent audit sizing requires accepted scope and recipient.");
    const event = AgentInteractionEvents.envelope(
      this.accepted,
      this.metadata,
      id,
      schema,
      payload,
    );
    const occurredAt = event.context?.timestamp;
    if (occurredAt === undefined) throw new Error("Agent audit sizing requires Time.");
    return AgentExecutionSizes.history(
      scope,
      create(AgentHistoryEntrySchema, {
        occurredAt,
        item: { case: "systemEvent", value: event },
      }),
    );
  }

  /**
   * Writes the original Event with its journal change before publication.
   *
   * @typeParam Schema Generated System event payload descriptor.
   * @param schema Payload descriptor.
   * @param payload Matching typed event payload.
   * @param change Journal mutation guarded by the current claim.
   * @param history Conversation rows included in the same fenced mutation.
   * @returns When the journal and System Context publication both complete.
   */
  async save<Schema extends MessageSchema>(
    schema: Schema,
    payload: MessageShape<Schema>,
    change: (record: AgentExecutionRecord) => AgentExecutionRecord,
    history: readonly AgentHistoryEntry[] = [],
  ): Promise<void> {
    const id = this.accepted.recipientId;
    if (id === undefined) throw new Error("Agent audit requires a typed recipient.");
    const event = AgentInteractionEvents.envelope(
      this.accepted,
      this.metadata,
      id,
      schema,
      payload,
    );
    const occurredAt = event.context?.timestamp;
    if (occurredAt === undefined) throw new Error("Agent audit Event requires Time.");
    this.onRegisterSchema(schema);
    await this.session.update(change, [
      ...history,
      create(AgentHistoryEntrySchema, {
        occurredAt,
        item: { case: "systemEvent", value: event },
      }),
    ]);
    await this.onPublish(event);
  }
}
