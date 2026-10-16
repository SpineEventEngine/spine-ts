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

import { clone, create, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorProtoSchema } from "@bufbuild/protobuf/wkt";
import { createHash } from "node:crypto";
import { AnyMessages, RejectionThrowable, type MessageSchema } from "@spine-event-engine/core";
import {
  CommandContextSchema,
  CommandSchema,
  EventContextSchema,
  EventSchema,
  RejectionEventContextSchema,
  type CommandContext,
  type EventContext,
  type Command,
  type Event,
} from "@spine-event-engine/proto";
import * as EntityLog from "@spine-event-engine/proto/generated/spine/system/server/entity_log_events_pb.js";
import {
  AgentSavedDispatchTargetSchema as SavedTargetSchema,
  AgentSavedTargetKind,
  type AgentSavedDispatchTarget,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";

import type { CommandDispatcher } from "../bus/command-dispatcher.js";
import type { EventDispatcher } from "../bus/event-dispatcher.js";
import { EventDispatcherOriginSchemas } from "../bus/event-dispatcher-origin-schemas.js";
import { SavedDispatcherBindings } from "../bus/saved-dispatcher-binding.js";
import type {
  GeneratedHandlerRecordInput,
  GeneratedStandaloneHandlerGroup,
} from "../handler/generated-handler-registry.js";
import { DeclaredRejections } from "../handler/declared-rejections.js";
import {
  EventHandlerFilters,
  type EventHandlerFilterPlan,
} from "../handler/event-handler-filter.js";
import { SignalMetadata } from "./signal-metadata.js";
import { SignalPublisher } from "./signal-publisher.js";

/**
 * Materializes generated standalone receivers without treating them as Entities.
 *
 * @internal
 */
export class StandaloneHandlerRuntime {
  readonly #publisher: SignalPublisher;

  readonly #metadata = new SignalMetadata();

  readonly #bindings: readonly Binding[];

  readonly #eventFilters: ReadonlyMap<string, EventHandlerFilterPlan<Binding>>;

  /**
   * Creates runtime bindings for registered standalone receivers.
   *
   * @param receivers Generated receiver groups with their application instances and publisher.
   */
  constructor(receivers: readonly StandaloneBinding[]) {
    this.#publisher = receivers[0]?.publisher ?? StandaloneHandlerRuntime.missingPublisher();
    this.#bindings = Object.freeze(
      receivers.flatMap(({ group, instance }) =>
        group.handlers.map((handler) => StandaloneHandlerRuntime.bind(group, instance, handler)),
      ),
    );
    this.#eventFilters = StandaloneHandlerRuntime.eventFilters(this.#bindings);
  }

  /**
   * Creates a dispatcher for standalone Command receptors.
   *
   * @returns The dispatcher, or `undefined` when no Command receptor is bound.
   */
  commandDispatcher(): CommandDispatcher | undefined {
    const bindings = this.#bindings.filter(
      (binding) =>
        binding.handler.kind === "command-assignment" ||
        binding.handler.kind === "command-substitution",
    );
    if (bindings.length === 0) return undefined;
    const dispatcher: CommandDispatcher = {
      messageSchemas: () => Object.freeze(StandaloneHandlerRuntime.schemas(bindings)),
      dispatch: async (command) => this.#dispatchCommand(command, bindings),
    };
    return SavedDispatcherBindings.command(dispatcher, {
      prepare: (command) => Promise.resolve(this.#prepareCommand(command, bindings)),
      matches: (target) => target.kind === AgentSavedTargetKind.AGENT_SAVED_STANDALONE_COMMAND,
      bind: (command, target) =>
        Promise.resolve().then(() => this.#bindCommand(command, target, bindings)),
    });
  }

  /**
   * Creates a dispatcher for standalone Event receptors.
   *
   * @returns The dispatcher, or `undefined` when no Event receptor is bound.
   */
  eventDispatcher(): EventDispatcher | undefined {
    const bindings = this.#bindings.filter(
      (binding) =>
        binding.handler.kind === "command-reaction" ||
        binding.handler.kind === "event-reaction" ||
        binding.handler.kind === "event-subscription",
    );
    if (bindings.length === 0) return undefined;
    const dispatcher: EventDispatcher = {
      messageSchemas: () => Object.freeze(StandaloneHandlerRuntime.schemas(bindings)),
      externalEventSchemas: () =>
        Object.freeze(
          StandaloneHandlerRuntime.schemas(
            bindings.filter(({ handler }) => handler.input.origin === "external"),
          ),
        ),
      dispatch: async (event) => this.#dispatchEvent(event, bindings),
    };
    const originAware = EventDispatcherOriginSchemas.define(
      dispatcher,
      StandaloneHandlerRuntime.schemas(
        bindings.filter(({ handler }) => handler.input.origin === "domestic"),
      ),
      StandaloneHandlerRuntime.schemas(
        bindings.filter(({ handler }) => handler.input.origin === "external"),
      ),
    );
    return SavedDispatcherBindings.event(originAware, {
      prepare: (event) => Promise.resolve(this.#prepareEvent(event, bindings)),
      matches: (target) => target.kind === AgentSavedTargetKind.AGENT_SAVED_STANDALONE_EVENT,
      bind: (event, target) =>
        Promise.resolve().then(() => this.#bindEvent(event, target, bindings)),
    });
  }

  /**
   * Creates a System Event Bus dispatcher for standalone state subscribers.
   *
   * @returns The dispatcher, or `undefined` when no state subscriber is bound.
   */
  stateDispatcher(): EventDispatcher | undefined {
    const bindings = this.#bindings.filter(({ handler }) => handler.kind === "state-subscription");
    if (bindings.length === 0) return undefined;
    return {
      messageSchemas: () => Object.freeze([EntityLog.EntityStateChangedSchema]),
      dispatch: async (event) => {
        const changed =
          event.message === undefined
            ? undefined
            : AnyMessages.unpack(event.message, EntityLog.EntityStateChangedSchema);
        if (changed?.newState === undefined) return;
        for (const binding of bindings) {
          const state = AnyMessages.unpack(changed.newState, binding.handler.input.schema);
          if (state !== undefined) {
            const output = await binding.invoke(
              state,
              StandaloneHandlerRuntime.eventContext(event),
            );
            await this.#publish(binding, output, event);
          }
        }
      },
    };
  }

  /**
   * Invokes matching Command handlers and publishes their declared results or rejections.
   *
   * @param command Command envelope containing the payload and invocation context.
   * @param bindings Registered Command receivers to consider.
   * @returns Completion of invocation and output submission, not downstream handling.
   */
  async #dispatchCommand(command: Command, bindings: readonly Binding[]): Promise<void> {
    if (command.message === undefined)
      throw new Error("Standalone command handler requires a message.");
    for (const binding of bindings) {
      const message = AnyMessages.unpack(command.message, binding.handler.input.schema);
      if (message === undefined) continue;
      let output: unknown;
      try {
        output = await binding.invoke(message, StandaloneHandlerRuntime.commandContext(command));
      } catch (error) {
        if (!RejectionThrowable.is(error)) throw error;
        DeclaredRejections.require(
          binding.handler.methodName,
          binding.handler.outcomes.thrown,
          error,
        );
        await this.#publishRejection(command, error);
        continue;
      }
      await this.#publish(binding, output, command);
    }
  }

  /**
   * Invokes standalone Event handlers selected by message type, origin, and filters.
   *
   * @param event Event envelope containing the payload and invocation context.
   * @param bindings Registered Event receivers to consider.
   * @returns Completion of invocation and output submission, not downstream handling.
   */
  async #dispatchEvent(event: Event, bindings: readonly Binding[]): Promise<void> {
    const packed = event.message;
    if (packed === undefined) throw new Error("Standalone event handler requires a message.");
    for (const selected of this.#selectedEventBindings(event, bindings)) {
      const message = AnyMessages.unpack(packed, selected.handler.input.schema);
      if (message === undefined) throw new Error("Selected standalone Event schema changed.");
      const output = await selected.invoke(message, StandaloneHandlerRuntime.eventContext(event));
      await this.#publish(selected, output, event);
    }
  }

  /**
   * Selects generated Event receptors once, including their declared field filters.
   */
  #selectedEventBindings(event: Event, bindings: readonly Binding[]): readonly Binding[] {
    if (event.message === undefined)
      throw new Error("Standalone event handler requires a message.");
    const origin = event.context?.external === true ? "external" : "domestic";
    const selected: Binding[] = [];
    for (const [key, filter] of this.#eventFilters) {
      const binding = bindings.find(
        (candidate) =>
          StandaloneHandlerRuntime.eventFilterKey(
            candidate.handler.input.schema.typeName,
            origin,
          ) === key,
      );
      if (binding === undefined) continue;
      const message = AnyMessages.unpack(event.message, binding.handler.input.schema);
      if (message === undefined) continue;
      selected.push(...filter.select(message));
    }
    return selected;
  }

  /**
   * Freezes matching generated Command receptors before saved output transport.
   */
  #prepareCommand(command: Command, bindings: readonly Binding[]): AgentSavedDispatchTarget {
    const packed = command.message;
    if (packed === undefined) throw new Error("Saved standalone Command needs a message.");
    const selected = bindings.filter(
      ({ handler }) => AnyMessages.unpack(packed, handler.input.schema) !== undefined,
    );
    return this.#savedTarget(
      AgentSavedTargetKind.AGENT_SAVED_STANDALONE_COMMAND,
      packed.typeUrl,
      bindings,
      selected,
    );
  }

  /**
   * Freezes Event filter selection before saved output transport.
   */
  #prepareEvent(event: Event, bindings: readonly Binding[]): AgentSavedDispatchTarget {
    if (event.message === undefined) throw new Error("Saved standalone Event needs a message.");
    return this.#savedTarget(
      AgentSavedTargetKind.AGENT_SAVED_STANDALONE_EVENT,
      event.message.typeUrl,
      bindings,
      this.#selectedEventBindings(event, bindings),
    );
  }

  /**
   * Checks a saved Command binding and returns only its original selected receptors.
   */
  #bindCommand(
    command: Command,
    target: AgentSavedDispatchTarget,
    bindings: readonly Binding[],
  ): Promise<() => Promise<void>> {
    const selected = this.#savedBindings(
      command.message?.typeUrl,
      target,
      bindings,
      AgentSavedTargetKind.AGENT_SAVED_STANDALONE_COMMAND,
    );
    return Promise.resolve(() => this.#dispatchCommand(command, selected));
  }

  /**
   * Checks a saved Event binding without reevaluating its field filters.
   */
  #bindEvent(
    event: Event,
    target: AgentSavedDispatchTarget,
    bindings: readonly Binding[],
  ): Promise<() => Promise<void>> {
    const selected = this.#savedBindings(
      event.message?.typeUrl,
      target,
      bindings,
      AgentSavedTargetKind.AGENT_SAVED_STANDALONE_EVENT,
    );
    const packed = event.message;
    if (packed === undefined) throw new Error("Saved standalone Event needs a message.");
    return Promise.resolve(async () => {
      for (const binding of selected) {
        const message = AnyMessages.unpack(packed, binding.handler.input.schema);
        if (message === undefined) throw new Error("Saved standalone Event schema changed.");
        const output = await binding.invoke(message, StandaloneHandlerRuntime.eventContext(event));
        await this.#publish(binding, output, event);
      }
    });
  }

  /**
   * Captures selected binding indices alongside a digest of all eligible declarations.
   */
  #savedTarget(
    kind: AgentSavedTargetKind,
    signalType: string,
    bindings: readonly Binding[],
    selected: readonly Binding[],
  ): AgentSavedDispatchTarget {
    const indices = selected.map((binding) => bindings.indexOf(binding));
    if (indices.includes(-1)) throw new Error("Standalone filter selected an unknown binding.");
    return create(SavedTargetSchema, {
      kind,
      signalType,
      bindingFingerprint: `${StandaloneHandlerRuntime.fingerprint(bindings)}:${indices.join(",")}`,
    });
  }

  /**
   * Rejects changed declarations and restores the exact saved selection.
   */
  #savedBindings(
    signalType: string | undefined,
    target: AgentSavedDispatchTarget,
    bindings: readonly Binding[],
    kind: AgentSavedTargetKind,
  ): readonly Binding[] {
    const prefix = `${StandaloneHandlerRuntime.fingerprint(bindings)}:`;
    if (
      signalType === undefined ||
      target.kind !== kind ||
      target.signalType !== signalType ||
      target.recipients.length !== 0 ||
      !target.bindingFingerprint.startsWith(prefix)
    )
      throw new Error("Saved standalone dispatcher binding changed before delivery.");
    const suffix = target.bindingFingerprint.slice(prefix.length);
    if (suffix === "") return [];
    const indices = suffix.split(",").map(Number);
    if (
      indices.some(
        (index) => !Number.isSafeInteger(index) || index < 0 || index >= bindings.length,
      ) ||
      new Set(indices).size !== indices.length ||
      indices.join(",") !== suffix
    )
      throw new Error("Saved standalone dispatcher selection is invalid.");
    return indices.map((index) => {
      const binding = bindings[index];
      if (binding === undefined) throw new Error("Saved standalone selection disappeared.");
      return binding;
    });
  }

  /**
   * Validates and packs one handler's entire result before submitting any output.
   *
   * @param binding Handler whose result and signal-kind rules apply.
   * @param output Optional, single, or ordered multiple handler results.
   * @param source Input signal from which output contexts are derived.
   * @returns Completion of output submission, without waiting for downstream handlers.
   */
  #publish(binding: Binding, output: unknown, source: Command | Event): Promise<void> {
    if (
      (binding.handler.kind === "event-subscription" ||
        binding.handler.kind === "state-subscription") &&
      output !== undefined
    ) {
      throw new Error(
        `Standalone subscriber "${binding.handler.methodName}" must not return signals.`,
      );
    }
    const values = StandaloneHandlerRuntime.#outputValues(output);
    if (!this.#canPublish(binding, values)) return Promise.resolve();
    if (
      binding.handler.kind === "command-substitution" ||
      binding.handler.kind === "command-reaction"
    ) {
      const commands = values.map((value) =>
        this.#commandOutput(this.#returnedSchema(binding, value), value, source),
      );
      for (const command of commands) void this.#publisher.publishCommand(command);
    } else {
      const events = values.map((value) =>
        this.#eventOutput(this.#returnedSchema(binding, value), value, source),
      );
      for (const event of events) void this.#publisher.publishEvent(event);
    }
    return Promise.resolve();
  }

  /**
   * Checks required-output and no-output rules for the invoked handler kind.
   *
   * @param binding Handler declaration supplying the output rules.
   * @param values Results after absent optional values have been omitted.
   * @returns False for a valid subscriber with no output; true for a producing handler.
   */
  #canPublish(binding: Binding, values: readonly unknown[]): boolean {
    const subscriber =
      binding.handler.kind === "event-subscription" ||
      binding.handler.kind === "state-subscription";
    if (subscriber && values.length !== 0)
      throw new Error(
        `Standalone subscriber "${binding.handler.methodName}" must not return signals.`,
      );
    if (
      !subscriber &&
      (binding.handler.kind === "command-assignment" ||
        binding.handler.kind === "command-substitution") &&
      values.length === 0
    )
      throw new Error(
        `Standalone ${binding.handler.kind} "${binding.handler.methodName}" must return a signal.`,
      );
    return !subscriber;
  }

  /**
   * Resolves one output against only the invoked handler's declared schemas.
   *
   * @param binding Handler declaration containing the permitted output schemas.
   * @param value Concrete result whose message type must be declared.
   * @returns The matching schema, or throws if the result is undeclared.
   */
  #returnedSchema(binding: Binding, value: unknown): MessageSchema {
    const schema = binding.handler.outcomes.returned.find(
      (candidate) =>
        typeof value === "object" &&
        value !== null &&
        "$typeName" in value &&
        value.$typeName === candidate.typeName,
    );
    if (schema === undefined)
      throw new Error(
        `Standalone handler "${binding.handler.methodName}" returned an undeclared signal.`,
      );
    return schema;
  }

  /**
   * Packs a produced Command before any result from the same invocation is published.
   *
   * @param schema Declared schema used to validate and pack the Command message.
   * @param value Concrete Command message returned by the handler.
   * @param source Input signal supplying the output context and origin.
   * @returns A new Command envelope ready for publication.
   */
  #commandOutput(schema: MessageSchema, value: unknown, source: Command | Event): Command {
    const metadata =
      "uuid" in (source.id ?? {})
        ? this.#metadata.commandFromCommand(source as Command)
        : this.#metadata.commandFromEvent(source as Event);
    return create(CommandSchema, {
      id: metadata.id,
      context: metadata.context,
      message: AnyMessages.pack(schema, value as never),
    });
  }

  /**
   * Packs a produced Event before any result from the same invocation is published.
   *
   * @param schema Declared schema used to validate and pack the Event message.
   * @param value Concrete Event message returned by the handler.
   * @param source Input signal supplying the output context and origin.
   * @returns A new Event envelope ready for publication.
   */
  #eventOutput(schema: MessageSchema, value: unknown, source: Command | Event): Event {
    const metadata =
      "uuid" in (source.id ?? {})
        ? this.#metadata.eventFromCommand(source as Command, {})
        : this.#metadata.eventFromEvent(source as Event, {});
    return create(EventSchema, {
      id: metadata.id,
      context: metadata.context,
      message: AnyMessages.pack(schema, value as never),
    });
  }

  /**
   * Publishes a declared rejection with the rejected Command and rejection details.
   *
   * @param command Command rejected by its handler.
   * @param rejection Declared domain rejection thrown during invocation.
   * @returns Completion of rejection publication.
   */
  async #publishRejection(command: Command, rejection: RejectionThrowable): Promise<void> {
    const metadata = this.#metadata.eventFromCommand(command, {});
    await this.#publisher.publishRejectionEvent(
      create(EventSchema, {
        id: metadata.id,
        message: AnyMessages.pack(rejection.schema, rejection.messageThrown()),
        context: create(EventContextSchema, {
          ...metadata.context,
          rejection: create(RejectionEventContextSchema, {
            command: clone(CommandSchema, command),
            stacktrace: rejection.stack ?? "",
          }),
        }),
      }),
    );
  }

  /**
   * Normalizes optional handler output into a list of values.
   *
   * @param output A handler result that may be absent, singular, or an array.
   * @returns An ordered list without undefined slots, or an empty list for undefined output.
   */
  static #outputValues(output: unknown): readonly unknown[] {
    return output === undefined
      ? []
      : Array.isArray(output)
        ? output.filter((value) => value !== undefined)
        : [output];
  }

  /**
   * Binds one generated handler declaration to its standalone application instance.
   *
   * @param group The generated receiver group.
   * @param instance The registered application instance.
   * @param handler The generated handler declaration.
   * @returns The immutable runtime binding.
   */
  static bind(
    group: GeneratedStandaloneHandlerGroup,
    instance: object,
    handler: GeneratedHandlerRecordInput,
  ): Binding {
    const method = (instance as Record<string, unknown>)[handler.methodName];
    if (typeof method !== "function")
      throw new TypeError(`Standalone receiver is missing method "${handler.methodName}".`);
    return Object.freeze({
      group,
      handler,
      invoke: (message: unknown, context: unknown): unknown =>
        Reflect.apply(
          method,
          instance,
          handler.parameterCount === 2 ? [message, context] : [message],
        ) as unknown,
    });
  }

  /**
   * Lists distinct signal schemas used by bindings.
   *
   * @param bindings The bindings to inspect.
   * @returns Distinct signal schemas in binding order.
   */
  static schemas(bindings: readonly Binding[]): readonly MessageSchema[] {
    return [
      ...new Map(
        bindings.map(({ handler }) => [handler.input.schema.typeName, handler.input.schema]),
      ).values(),
    ];
  }

  /**
   * Calculates a digest of ordered handler declarations and Protobuf schemas.
   *
   * @param bindings Ordered generated handler bindings.
   * @returns SHA-256 digest of declarations and descriptor bytes.
   */
  static fingerprint(bindings: readonly Binding[]): string {
    const digest = createHash("sha256");
    for (const { group, handler } of bindings) {
      digest.update(
        JSON.stringify({
          receiver: group.receiverType.name,
          kind: handler.kind,
          method: handler.methodName,
          signal: handler.input.schema.typeName,
          origin: handler.input.origin,
          where: handler.input.where,
          parameters: handler.parameterCount,
          returned: handler.outcomes.returned.map((schema) => schema.typeName),
          thrown: handler.outcomes.thrown.map((schema) => schema.typeName),
        }),
      );
      digest.update(toBinary(FileDescriptorProtoSchema, handler.input.schema.file.proto));
    }
    return digest.digest("hex");
  }

  /**
   * Builds Event filters for standalone Event receptors.
   *
   * @param bindings The bindings to organize.
   * @returns Filter plans keyed by signal schema and origin.
   */
  static eventFilters(
    bindings: readonly Binding[],
  ): ReadonlyMap<string, EventHandlerFilterPlan<Binding>> {
    const eventBindings = bindings.filter(
      ({ handler }) =>
        handler.kind === "command-reaction" ||
        handler.kind === "event-reaction" ||
        handler.kind === "event-subscription",
    );
    const grouped = Map.groupBy(eventBindings, ({ handler }) =>
      StandaloneHandlerRuntime.eventFilterKey(handler.input.schema.typeName, handler.input.origin),
    );
    return new Map(
      [...grouped].map(([typeName, candidates]) => [
        typeName,
        EventHandlerFilters.compile(
          candidates.map((binding) => ({
            value: binding,
            handler: binding.handler,
            schema: binding.handler.input.schema,
            ...(binding.handler.input.where === undefined
              ? {}
              : { where: binding.handler.input.where }),
          })),
        ),
      ]),
    );
  }

  /**
   * Copies a Command context or creates its generated default.
   *
   * @param command The Command that provides the context.
   * @returns An independent Command context.
   */
  static commandContext(command: Command): CommandContext {
    return command.context === undefined
      ? create(CommandContextSchema)
      : clone(CommandContextSchema, command.context);
  }

  /**
   * Copies an Event context or creates its generated default.
   *
   * @param event The Event that provides the context.
   * @returns An independent Event context.
   */
  static eventContext(event: Event): EventContext {
    return event.context === undefined
      ? create(EventContextSchema)
      : clone(EventContextSchema, event.context);
  }

  /**
   * Creates a key for one Event schema and origin.
   *
   * @param typeName The Event schema type name.
   * @param origin The required Event origin.
   * @returns The filter-map key.
   */
  static eventFilterKey(typeName: string, origin: "domestic" | "external"): string {
    return `${typeName}\u0000${origin}`;
  }

  /**
   * Throws for a missing publisher during invalid runtime construction.
   *
   * @returns This method never returns because it throws.
   */
  static missingPublisher(): SignalPublisher {
    throw new Error("Standalone handler runtime requires a SignalPublisher.");
  }
}

/**
 * Connects generated standalone metadata with its registered application instance.
 */
export interface StandaloneBinding {
  // prettier-ignore

  /**
   * The generated group for the standalone receiver.
   */
  readonly group: GeneratedStandaloneHandlerGroup;

  /**
   * The registered standalone application instance.
   */
  readonly instance: object;

  /**
   * Publishes signals produced by the bound receiver.
   */
  readonly publisher: SignalPublisher;
}

/**
 * Generated handler declaration paired with its bound application method.
 */
interface Binding {
  // prettier-ignore

  /**
   * Generated group containing the standalone receiver's declarations.
   */
  readonly group: GeneratedStandaloneHandlerGroup;

  /**
   * Generated declaration for the bound method.
   */
  readonly handler: GeneratedHandlerRecordInput;

  /**
   * Invokes the application method with the argument count declared in metadata.
   *
   * @param message Unpacked input signal or Entity state.
   * @param context Invocation context, passed only to a two-parameter method.
   * @returns The application's synchronous result or Promise.
   */
  readonly invoke: (message: unknown, context: unknown) => unknown;
}
