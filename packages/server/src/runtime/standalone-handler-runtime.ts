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

import { clone, create } from "@bufbuild/protobuf";
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

import type { CommandDispatcher } from "../bus/command-dispatcher.js";
import type { EventDispatcher } from "../bus/event-dispatcher.js";
import { EventDispatcherOriginSchemas } from "../bus/event-dispatcher-origin-schemas.js";
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
    return {
      messageSchemas: () => Object.freeze(StandaloneHandlerRuntime.schemas(bindings)),
      dispatch: async (command) => this.#dispatchCommand(command, bindings),
    };
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
    return EventDispatcherOriginSchemas.define(
      dispatcher,
      StandaloneHandlerRuntime.schemas(
        bindings.filter(({ handler }) => handler.input.origin === "domestic"),
      ),
      StandaloneHandlerRuntime.schemas(
        bindings.filter(({ handler }) => handler.input.origin === "external"),
      ),
    );
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
    if (event.message === undefined)
      throw new Error("Standalone event handler requires a message.");
    const origin = event.context?.external === true ? "external" : "domestic";
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
      for (const selected of filter.select(message)) {
        const output = await selected.invoke(message, StandaloneHandlerRuntime.eventContext(event));
        await this.#publish(selected, output, event);
      }
    }
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
          candidates.map(({ handler, ...binding }) => ({
            value: Object.freeze({ handler, ...binding }),
            schema: handler.input.schema,
            ...(handler.input.where === undefined ? {} : { where: handler.input.where }),
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
