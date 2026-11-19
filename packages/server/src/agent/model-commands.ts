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

import { clone, create, equals, type MessageShape } from "@bufbuild/protobuf";
import { randomUUID } from "node:crypto";
import { AnyPacker, Time, Validate, type MessageSchema } from "@spine-event-engine/core";
import { isAiModel } from "@spine-event-engine/ai/spi/runtime";
import type { AiModel } from "@spine-event-engine/ai";
import {
  BoundedContextNameSchema,
  type Command,
  type Version,
  type TenantId,
} from "@spine-event-engine/proto";
import {
  AiOperationIdSchema,
  AiModelKind,
  CallModelSchema,
  ConversationIdSchema,
  ModelCallSchema,
  type AgentId,
  type AiOperationId,
  type CallModel,
  type ConversationId,
  type ModelCall,
} from "@spine-event-engine/proto/agent";
import type { AgentLiveModel } from "./agent-live-inputs.js";
import type { AgentSource } from "./agent-live-inputs.js";

/**
 * Original prepared model Command and the signal that caused its construction.
 */
export interface ModelCallHistory {
  /**
   * Exact prepared Command envelope, including identity and causation.
   */
  readonly command: Command;

  /**
   * Decoded typed model Command payload.
   */
  readonly request: CallModel;

  /**
   * Complete Command or Event envelope that triggered the Agent turn.
   */
  readonly source: AgentSource;
}

/**
 * Constructs typed model Commands during one Agent handler invocation.
 */
export interface AgentModelCommands {
  /**
   * Reads detached copies of calls pending at this Agent handler's entry.
   *
   * @returns Pending calls visible while this handler runs.
   */
  pendingCalls(): readonly ModelCall[];

  /**
   * Creates a request for a registered model definition without submitting it.
   *
   * @typeParam I Generated input descriptor.
   * @typeParam O Generated output descriptor.
   * @param definition Registered model capability.
   * @param request Conversation and typed input for this operation.
   * @returns A Command payload that may be returned by the handler.
   */
  create<I extends MessageSchema, O extends MessageSchema>(
    definition: AiModel<I, O>,
    request: { readonly conversation: ConversationId; readonly input: MessageShape<I> },
  ): CallModel;

  /**
   * Records abandonment of a previously pending call during this Agent turn.
   *
   * @param callId Logical model call identifier.
   */
  abandon(callId: AiOperationId): void;
}

/**
 * Trusted facts used to construct model Commands for one loaded Agent turn.
 */
export interface ModelCommandSessionInput {
  /**
   * Registered model definitions for the Agent repository.
   */
  readonly models: readonly AiModel<MessageSchema, MessageSchema>[];

  /**
   * Selected deployments captured before invoking the handler.
   */
  readonly selected: ReadonlyMap<number, AgentLiveModel>;

  /**
   * Complete typed Agent identity.
   */
  readonly agent: AgentId;

  /**
   * Bounded Context receiving model outcomes.
   */
  readonly replyContext: string;

  /**
   * Trusted tenant identity, when present.
   */
  readonly tenant?: TenantId;

  /**
   * Saved Entity version at handler entry, when present.
   */
  readonly version?: Version;

  /**
   * Calls pending at handler entry.
   */
  readonly pending: readonly ModelCall[];
}

/**
 * Retains constructed requests and explicit abandonment until the Agent commit.
 */
export class ModelCommandSession implements AgentModelCommands {
  readonly #created = new Map<string, CallModel>();

  readonly #abandoned = new Set<string>();

  #open = true;

  /**
   * Captures the loaded Agent identity and selected deployments.
   *
   * @param input Trusted runtime facts for this turn.
   */
  constructor(private readonly input: ModelCommandSessionInput) {}

  /**
   * Copies pending calls so application changes cannot mutate loaded attributes.
   *
   * @returns Calls pending when this Agent handler started.
   */
  pendingCalls(): readonly ModelCall[] {
    return this.input.pending.map((call) => clone(ModelCallSchema, call));
  }

  /**
   * Creates one detached, typed CallModel payload.
   *
   * @typeParam I Generated input descriptor.
   * @typeParam O Generated output descriptor.
   * @param definition Registered operation.
   * @param request Conversation and typed input.
   * @returns Detached model Command payload.
   */
  create<I extends MessageSchema, O extends MessageSchema>(
    definition: AiModel<I, O>,
    request: { readonly conversation: ConversationId; readonly input: MessageShape<I> },
  ): CallModel {
    this.requireOpen();
    if (!isAiModel(definition) || !this.input.models.includes(definition))
      throw new TypeError("Model Command definition is not registered for this Agent.");
    Validate.check(ConversationIdSchema, request.conversation);
    Validate.check(definition.definition.input, request.input);
    const kind =
      definition.definition.kind === "generation" ? AiModelKind.GENERATION : AiModelKind.DECISION;
    const selected = this.input.selected.get(kind);
    if (selected === undefined) throw new Error("Model Command has no selected deployment.");
    const id = randomUUID();
    const call = create(ModelCallSchema, {
      id: create(AiOperationIdSchema, { value: id }),
      replyContext: create(BoundedContextNameSchema, { value: this.input.replyContext }),
      ...(this.input.tenant === undefined ? {} : { tenant: this.input.tenant }),
      agent: this.input.agent,
      ...(this.input.version === undefined ? {} : { agentVersion: this.input.version }),
      capability: { value: definition.definition.name },
      capabilityRevision: { value: definition.definition.version },
      conversation: clone(ConversationIdSchema, request.conversation),
      whenRequested: Time.currentTime(),
    });
    const command = create(CallModelSchema, {
      call,
      model: selected.model,
      input: AnyPacker.pack(definition.definition.input, request.input),
    });
    this.#created.set(id, clone(CallModelSchema, command));
    return command;
  }

  /**
   * Records an explicit abandonment for a call pending at handler entry.
   *
   * @param callId Logical model call identifier.
   */
  abandon(callId: AiOperationId): void {
    this.requireOpen();
    Validate.check(AiOperationIdSchema, callId);
    if (!this.input.pending.some((call) => call.id?.value === callId.value))
      throw new TypeError("Only a pending model call can be abandoned.");
    this.#abandoned.add(callId.value);
  }

  /**
   * Verifies that a returned model Command was constructed during this turn.
   *
   * @param value Returned model Command payload.
   * @returns Its validated call metadata.
   */
  returned(value: CallModel): ModelCall {
    const id = value.call?.id?.value;
    const constructed = id === undefined ? undefined : this.#created.get(id);
    if (
      constructed === undefined ||
      value.call === undefined ||
      !equals(CallModelSchema, value, constructed)
    )
      throw new TypeError("Returned CallModel was not constructed by this Agent turn.");
    return clone(ModelCallSchema, value.call);
  }

  /**
   * Lists the call IDs explicitly abandoned during this turn.
   *
   * @returns Pending call IDs marked for abandonment.
   */
  abandoned(): readonly string[] {
    return [...this.#abandoned];
  }

  /**
   * Closes this handler-bound construction capability.
   */
  close(): void {
    this.#open = false;
  }

  /**
   * Rejects use after the Agent handler returns.
   */
  private requireOpen(): void {
    if (!this.#open) throw new Error("Model Command capability is closed.");
  }
}

const bindings = new WeakMap<object, AgentModelCommands>();

interface ModelCommandBindingAccess {
  /**
   * Binds a session to the current Agent invocation.
   *
   * @param agent Restored Agent.
   * @param commands Current model Command session.
   * @returns Callback that clears the binding.
   */
  bind(agent: object, commands: AgentModelCommands): () => void;

  /**
   * Returns the construction capability for the active Agent handler.
   *
   * @param agent Restored Agent.
   * @returns Current model Command session.
   */
  require(agent: object): AgentModelCommands;
}

/**
 * Binds model Command construction to a restored Agent only during a handler.
 */
export const ModelCommandBindings: ModelCommandBindingAccess = Object.freeze({
  /**
   * Binds a session to the current Agent invocation.
   *
   * @param agent Restored Agent.
   * @param commands Current model Command session.
   * @returns Callback that clears the binding.
   */
  bind(agent: object, commands: AgentModelCommands): () => void {
    if (bindings.has(agent)) throw new Error("Agent model Commands are already bound.");
    bindings.set(agent, commands);
    return () => bindings.delete(agent);
  },

  /**
   * Returns the construction capability for the active Agent handler.
   *
   * @param agent Restored Agent.
   * @returns Current model Command session.
   */
  require(agent: object): AgentModelCommands {
    const commands = bindings.get(agent);
    if (commands === undefined)
      throw new Error("Model Commands are available only during an Agent handler.");
    return commands;
  },
});
