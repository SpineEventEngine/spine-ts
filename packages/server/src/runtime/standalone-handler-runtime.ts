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
import { AnyMessages, type MessageSchema } from "@spine-event-engine/core";
import { CommandSchema, EventSchema, type Command, type Event } from "@spine-event-engine/proto";
import * as EntityLog from "@spine-event-engine/proto/generated/spine/system/server/entity_log_events_pb.js";

import type { CommandDispatcher } from "../bus/command-dispatcher.js";
import type { EventDispatcher } from "../bus/event-dispatcher.js";
import type {
  GeneratedHandlerRecordInput,
  GeneratedStandaloneHandlerGroup,
} from "../handler/generated-handler-registry.js";
import {
  EventHandlerFilters,
  type EventHandlerFilterPlan,
} from "../handler/event-handler-filter.js";
import { SignalMetadata } from "./signal-metadata.js";
import { SignalPublisher } from "./signal-publisher.js";

/** Materializes generated standalone receivers without treating them as Entities. @internal */
export class StandaloneHandlerRuntime {
  readonly #publisher: SignalPublisher;
  readonly #metadata = new SignalMetadata();
  readonly #bindings: readonly Binding[];
  readonly #eventFilters: ReadonlyMap<string, EventHandlerFilterPlan<Binding>>;

  constructor(receivers: readonly StandaloneBinding[]) {
    this.#publisher = receivers[0]?.publisher ?? StandaloneHandlerRuntime.missingPublisher();
    this.#bindings = Object.freeze(
      receivers.flatMap(({ group, instance }) =>
        group.handlers.map((handler) => StandaloneHandlerRuntime.bind(group, instance, handler)),
      ),
    );
    this.#eventFilters = StandaloneHandlerRuntime.eventFilters(this.#bindings);
  }

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

  eventDispatcher(): EventDispatcher | undefined {
    const bindings = this.#bindings.filter(
      (binding) =>
        binding.handler.kind === "command-reaction" ||
        binding.handler.kind === "event-reaction" ||
        binding.handler.kind === "event-subscription",
    );
    if (bindings.length === 0) return undefined;
    return {
      messageSchemas: () => Object.freeze(StandaloneHandlerRuntime.schemas(bindings)),
      externalEventSchemas: () =>
        Object.freeze(
          StandaloneHandlerRuntime.schemas(
            bindings.filter(({ handler }) => handler.origin === "external"),
          ),
        ),
      dispatch: async (event) => this.#dispatchEvent(event, bindings),
    };
  }

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
          const state = AnyMessages.unpack(changed.newState, binding.handler.signalSchema);
          if (state !== undefined) {
            const output = await binding.invoke(state, event.context);
            await this.#publish(binding, output, event);
          }
        }
      },
    };
  }

  async #dispatchCommand(command: Command, bindings: readonly Binding[]): Promise<void> {
    if (command.message === undefined)
      throw new Error("Standalone command handler requires a message.");
    for (const binding of bindings) {
      const message = AnyMessages.unpack(command.message, binding.handler.signalSchema);
      if (message === undefined) continue;
      const output = await binding.invoke(message, command.context);
      await this.#publish(binding, output, command);
    }
  }

  async #dispatchEvent(event: Event, bindings: readonly Binding[]): Promise<void> {
    if (event.message === undefined)
      throw new Error("Standalone event handler requires a message.");
    for (const [typeName, filter] of this.#eventFilters) {
      const binding = bindings.find(
        (candidate) => candidate.handler.signalSchema.typeName === typeName,
      );
      if (binding === undefined) continue;
      const message = AnyMessages.unpack(event.message, binding.handler.signalSchema);
      if (message === undefined) continue;
      for (const selected of filter.select(message)) {
        const output = await selected.invoke(message, event.context);
        await this.#publish(selected, output, event);
      }
    }
  }

  #publish(binding: Binding, output: unknown, source: Command | Event): Promise<void> {
    const values =
      output === undefined || output === null ? [] : Array.isArray(output) ? output : [output];
    const required =
      binding.handler.kind === "command-assignment" ||
      binding.handler.kind === "command-substitution";
    if (required && values.length === 0)
      throw new Error(
        `Standalone ${binding.handler.kind} "${binding.handler.methodName}" must return a signal.`,
      );
    if (
      binding.handler.kind === "event-subscription" ||
      binding.handler.kind === "state-subscription"
    ) {
      if (values.length !== 0)
        throw new Error(
          `Standalone subscriber "${binding.handler.methodName}" must not return signals.`,
        );
      return Promise.resolve();
    }
    for (const [index, value] of values.entries()) {
      const schema = binding.handler.emittedSchemas.find(
        (candidate) => (value as { $typeName?: string }).$typeName === candidate.typeName,
      );
      if (schema === undefined)
        throw new Error(
          `Standalone handler "${binding.handler.methodName}" returned an undeclared signal.`,
        );
      if (
        binding.handler.kind === "command-substitution" ||
        binding.handler.kind === "command-reaction"
      ) {
        const metadata =
          "uuid" in (source.id ?? {})
            ? this.#metadata.commandFromCommand(source as Command, index + 1)
            : this.#metadata.commandFromEvent(source as Event, index + 1);
        void this.#publisher.publishCommand(
          create(CommandSchema, {
            id: metadata.id,
            context: metadata.context,
            message: AnyMessages.pack(schema, value as never),
          }),
        );
      } else {
        const metadata =
          "uuid" in (source.id ?? {})
            ? this.#metadata.eventFromCommand(source as Command, index + 1, {})
            : this.#metadata.eventFromEvent(source as Event, index + 1, {});
        void this.#publisher.publishEvent(
          create(EventSchema, {
            id: metadata.id,
            context: metadata.context,
            message: AnyMessages.pack(schema, value as never),
          }),
        );
      }
    }
    return Promise.resolve();
  }

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

  static schemas(bindings: readonly Binding[]): readonly MessageSchema[] {
    return [
      ...new Map(
        bindings.map(({ handler }) => [handler.signalSchema.typeName, handler.signalSchema]),
      ).values(),
    ];
  }

  static eventFilters(
    bindings: readonly Binding[],
  ): ReadonlyMap<string, EventHandlerFilterPlan<Binding>> {
    const eventBindings = bindings.filter(
      ({ handler }) =>
        handler.kind === "command-reaction" ||
        handler.kind === "event-reaction" ||
        handler.kind === "event-subscription",
    );
    const grouped = Map.groupBy(eventBindings, ({ handler }) => handler.signalSchema.typeName);
    return new Map(
      [...grouped].map(([typeName, candidates]) => [
        typeName,
        EventHandlerFilters.compile(
          candidates.map(({ handler, ...binding }) => ({
            value: Object.freeze({ handler, ...binding }),
            schema: handler.signalSchema,
            ...(handler.where === undefined ? {} : { where: handler.where }),
          })),
        ),
      ]),
    );
  }

  static missingPublisher(): SignalPublisher {
    throw new Error("Standalone handler runtime requires a SignalPublisher.");
  }
}

export interface StandaloneBinding {
  readonly group: GeneratedStandaloneHandlerGroup;
  readonly instance: object;
  readonly publisher: SignalPublisher;
}
interface Binding {
  readonly group: GeneratedStandaloneHandlerGroup;
  readonly handler: GeneratedHandlerRecordInput;
  readonly invoke: (message: unknown, context: unknown) => unknown;
}
