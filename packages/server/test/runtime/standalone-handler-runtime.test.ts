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

import { create, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { AnyMessages, TypeUrls } from "@spine-event-engine/core";
import { CommandSchema, EventSchema } from "@spine-event-engine/proto";
import * as EntityLog from "@spine-event-engine/proto/generated/spine/system/server/entity_log_events_pb.js";
import { describe, expect, it } from "vitest";

import {
  AbstractCommander,
  AbstractEventReactor,
  AbstractEventSubscriber,
} from "../../src/handler/standalone.js";
import type { GeneratedStandaloneHandlerGroup } from "../../src/handler/generated-handler-registry.js";
import { StandaloneHandlerRuntime } from "../../src/runtime/standalone-handler-runtime.js";
import { EventDispatcherRegistry } from "../../src/bus/event-dispatcher-registry.js";
import { AggregateStateSchema } from "../../test-fixtures/generated/entity-metadata/main_pb.js";
import { TaskCommandSchema } from "../../test-fixtures/generated/handler-registry/commands_pb.js";
import { TaskEventSchema } from "../../test-fixtures/generated/handler-registry/events_pb.js";
import { ReviewRejectedSchema } from "../../test-fixtures/generated/handler-registry/rejections_pb.js";

type TaskEvent = Message<"TaskEvent"> & { id: string; name: string };
type TaskCommand = Message<"TaskCommand"> & { id: string; name: string };
type AggregateState = Message<"AggregateState"> & { id: string; name: string; archived: boolean };

class FilteredSubscriber extends AbstractEventSubscriber {
  readonly calls: string[] = [];

  selected(): void {
    this.calls.push("selected");
  }

  fallback(): void {
    this.calls.push("fallback");
  }
}

class StateSubscriber extends AbstractEventSubscriber {
  readonly states: string[] = [];

  subscribe(state: AggregateState): void {
    this.states.push(state.id);
  }
}

class UndeclaredOutputReceiver extends AbstractEventReactor {
  react(): AggregateState {
    return create(AggregateStateSchema, { id: "unexpected", name: "Unexpected" });
  }
}

class EmptyCommandReceiver extends AbstractCommander {
  substitute(): undefined {
    return undefined;
  }
}

class IncompleteEventSubscriber extends AbstractEventSubscriber {
  subscribe(): void {
    return undefined;
  }
}

class ContextSubscriber extends AbstractEventSubscriber {
  context: unknown;

  subscribe(_event: TaskEvent, context: unknown): void {
    void _event;
    this.context = context;
  }
}

class EmptyReactor extends AbstractEventReactor {
  react(): null {
    return null;
  }
}

class ProducingReactor extends AbstractEventReactor {
  react(): readonly TaskEvent[] {
    return [create(TaskEventSchema, { id: "produced", name: "Produced" })];
  }
}

class RejectionCommander extends AbstractCommander {
  calls = 0;
  react(): TaskCommand {
    this.calls += 1;
    return create(TaskCommandSchema, { id: "commander", name: "commander" });
  }
}

class RejectionReactor extends AbstractEventReactor {
  calls = 0;
  react(): TaskEvent {
    this.calls += 1;
    return create(TaskEventSchema, { id: "reactor", name: "reactor" });
  }
}

class RejectionSubscriber extends AbstractEventSubscriber {
  calls = 0;
  react(): void {
    this.calls += 1;
  }
}

class ContextCommander extends AbstractCommander {
  context: unknown;

  substitute(_command: TaskCommand, context: unknown): TaskCommand {
    this.context = context;
    return create(TaskCommandSchema, { id: "context-command", name: "context-command" });
  }
}

describe("StandaloneHandlerRuntime", () => {
  it("routes same-schema domestic and external handlers only on their matching origin", async () => {
    const domestic = new FilteredSubscriber();
    const external = new FilteredSubscriber();
    const group = (origin: "domestic" | "external") => ({
      receiverKind: "standalone" as const,
      receiverType: FilteredSubscriber,
      handlers: [
        {
          kind: "event-subscription" as const,
          methodName: "selected",
          signalSchema: TaskEventSchema,
          emittedSchemas: [],
          parameterCount: 1 as const,
          origin,
        },
      ],
    });
    const dispatcher = new StandaloneHandlerRuntime([
      { group: group("domestic"), instance: domestic, publisher: {} as never },
      { group: group("external"), instance: external, publisher: {} as never },
    ]).eventDispatcher();
    if (dispatcher === undefined) throw new Error("Expected standalone Event dispatcher.");
    const registry = new EventDispatcherRegistry();
    registry.register(dispatcher);

    for (const handler of registry.find(TypeUrls.derive(TaskEventSchema), false)) {
      await handler.dispatch(
        create(EventSchema, {
          id: { value: "domestic" },
          message: AnyMessages.pack(TaskEventSchema, create(TaskEventSchema)),
        }),
      );
    }
    for (const handler of registry.find(TypeUrls.derive(TaskEventSchema), true)) {
      await handler.dispatch(
        create(EventSchema, {
          id: { value: "external" },
          context: { external: true },
          message: AnyMessages.pack(TaskEventSchema, create(TaskEventSchema)),
        }),
      );
    }

    expect(domestic.calls).toEqual(["selected"]);
    expect(external.calls).toEqual(["selected"]);
  });
  it("routes rejection envelopes to commander, reactor, and subscriber handlers", async () => {
    const commander = new RejectionCommander();
    const reactor = new RejectionReactor();
    const subscriber = new RejectionSubscriber();
    const published: unknown[] = [];
    const publisher = {
      publishCommand: (signal: unknown) => {
        published.push(signal);
        return Promise.resolve();
      },
      publishEvent: (signal: unknown) => {
        published.push(signal);
        return Promise.resolve();
      },
    } as never;
    const reaction = (
      receiverType: GeneratedStandaloneHandlerGroup["receiverType"],
      methodName: string,
      emittedSchemas: readonly GenMessage<Message>[],
    ) => ({
      receiverKind: "standalone" as const,
      receiverType,
      handlers: [
        {
          kind:
            methodName === "react" && receiverType === RejectionSubscriber
              ? ("event-subscription" as const)
              : methodName === "react" && receiverType === RejectionReactor
                ? ("event-reaction" as const)
                : ("command-reaction" as const),
          methodName,
          signalSchema: ReviewRejectedSchema,
          emittedSchemas,
          parameterCount: 1 as const,
          origin: "domestic" as const,
        },
      ],
    });
    const dispatcher = new StandaloneHandlerRuntime([
      {
        group: reaction(RejectionCommander, "react", [TaskCommandSchema]),
        instance: commander,
        publisher,
      },
      {
        group: reaction(RejectionReactor, "react", [TaskEventSchema]),
        instance: reactor,
        publisher,
      },
      { group: reaction(RejectionSubscriber, "react", []), instance: subscriber, publisher },
    ]).eventDispatcher();
    if (dispatcher === undefined) throw new Error("Expected standalone Event dispatcher.");

    await dispatcher.dispatch(
      create(EventSchema, {
        id: { value: "rejection" },
        message: AnyMessages.pack(
          ReviewRejectedSchema,
          create(ReviewRejectedSchema, { id: "rejected" }),
        ),
      }),
    );

    expect(commander.calls).toBe(1);
    expect(reactor.calls).toBe(1);
    expect(subscriber.calls).toBe(1);
    expect(published).toHaveLength(2);
  });
  it("selects the matching @Where standalone event subscriber instead of its fallback", async () => {
    const receiver = new FilteredSubscriber();
    const group: GeneratedStandaloneHandlerGroup = {
      receiverKind: "standalone",
      receiverType: FilteredSubscriber,
      handlers: [
        {
          kind: "event-subscription",
          methodName: "selected",
          signalSchema: TaskEventSchema,
          emittedSchemas: [],
          parameterCount: 1,
          origin: "domestic",
          where: { eventField: "name", equals: "selected" },
        },
        {
          kind: "event-subscription",
          methodName: "fallback",
          signalSchema: TaskEventSchema,
          emittedSchemas: [],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    };
    const runtime = new StandaloneHandlerRuntime([
      { group, instance: receiver, publisher: {} as never },
    ]);
    const dispatcher = runtime.eventDispatcher();
    if (dispatcher === undefined) throw new Error("Expected standalone Event dispatcher.");

    await dispatcher.dispatch(
      create(EventSchema, {
        id: { value: "event-1" },
        message: AnyMessages.pack(TaskEventSchema, create(TaskEventSchema, { name: "selected" })),
      }),
    );

    expect(receiver.calls).toEqual(["selected"]);
  });

  it("advertises external standalone subscribers and preserves their @Where selection", async () => {
    const receiver = new FilteredSubscriber();
    const group: GeneratedStandaloneHandlerGroup = {
      receiverKind: "standalone",
      receiverType: FilteredSubscriber,
      handlers: [
        {
          kind: "event-subscription",
          methodName: "selected",
          signalSchema: TaskEventSchema,
          emittedSchemas: [],
          parameterCount: 1,
          origin: "external",
          where: { eventField: "name", equals: "external" },
        },
      ],
    };
    const dispatcher = new StandaloneHandlerRuntime([
      { group, instance: receiver, publisher: {} as never },
    ]).eventDispatcher();
    if (dispatcher === undefined) throw new Error("Expected standalone Event dispatcher.");

    expect(dispatcher.externalEventSchemas?.()).toEqual([TaskEventSchema]);
    await dispatcher.dispatch(
      create(EventSchema, {
        id: { value: "external-event" },
        context: { external: true },
        message: AnyMessages.pack(TaskEventSchema, create(TaskEventSchema, { name: "external" })),
      }),
    );
    expect(receiver.calls).toEqual(["selected"]);
  });

  it("invokes a state subscriber only for its exact new-state schema", async () => {
    const receiver = new StateSubscriber();
    const group: GeneratedStandaloneHandlerGroup = {
      receiverKind: "standalone",
      receiverType: StateSubscriber,
      handlers: [
        {
          kind: "state-subscription",
          methodName: "subscribe",
          signalSchema: AggregateStateSchema,
          emittedSchemas: [],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    };
    const dispatcher = new StandaloneHandlerRuntime([
      { group, instance: receiver, publisher: {} as never },
    ]).stateDispatcher();
    if (dispatcher === undefined) throw new Error("Expected standalone state dispatcher.");

    await dispatcher.dispatch(
      stateChanged(
        AggregateStateSchema,
        create(AggregateStateSchema, { id: "matching", name: "A" }),
      ),
    );
    await dispatcher.dispatch(
      stateChanged(TaskEventSchema, create(TaskEventSchema, { id: "mismatch", name: "B" })),
    );

    expect(receiver.states).toEqual(["matching"]);
    expect(dispatcher.messageSchemas()).toEqual([EntityLog.EntityStateChangedSchema]);
  });

  it("rejects an undeclared produced signal before it reaches the publisher", async () => {
    const group: GeneratedStandaloneHandlerGroup = {
      receiverKind: "standalone",
      receiverType: UndeclaredOutputReceiver,
      handlers: [
        {
          kind: "event-reaction",
          methodName: "react",
          signalSchema: TaskEventSchema,
          emittedSchemas: [TaskEventSchema],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    };
    const dispatcher = new StandaloneHandlerRuntime([
      { group, instance: new UndeclaredOutputReceiver(), publisher: {} as never },
    ]).eventDispatcher();
    if (dispatcher === undefined) throw new Error("Expected standalone Event dispatcher.");

    await expect(
      dispatcher.dispatch(
        create(EventSchema, {
          id: { value: "undeclared-output" },
          message: AnyMessages.pack(TaskEventSchema, create(TaskEventSchema)),
        }),
      ),
    ).rejects.toThrow('Standalone handler "react" returned an undeclared signal.');
  });

  it("rejects missing standalone methods and an empty runtime binding list", () => {
    expect(() => new StandaloneHandlerRuntime([])).toThrow(
      "Standalone handler runtime requires a SignalPublisher.",
    );
    expect(
      () =>
        new StandaloneHandlerRuntime([
          {
            group: {
              receiverKind: "standalone",
              receiverType: StateSubscriber,
              handlers: [
                {
                  kind: "event-subscription",
                  methodName: "missing",
                  signalSchema: TaskEventSchema,
                  emittedSchemas: [],
                  parameterCount: 1,
                  origin: "domestic",
                },
              ],
            },
            instance: new StateSubscriber(),
            publisher: {} as never,
          },
        ]),
    ).toThrow('Standalone receiver is missing method "missing".');
  });

  it("rejects incomplete Command and Event envelopes before handler invocation", async () => {
    const group: GeneratedStandaloneHandlerGroup = {
      receiverKind: "standalone",
      receiverType: EmptyCommandReceiver,
      handlers: [
        {
          kind: "command-substitution",
          methodName: "substitute",
          signalSchema: TaskCommandSchema,
          emittedSchemas: [TaskCommandSchema],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    };
    const eventGroup: GeneratedStandaloneHandlerGroup = {
      receiverKind: "standalone",
      receiverType: IncompleteEventSubscriber,
      handlers: [
        {
          kind: "event-subscription",
          methodName: "subscribe",
          signalSchema: TaskEventSchema,
          emittedSchemas: [],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    };
    const runtime = new StandaloneHandlerRuntime([
      { group, instance: new EmptyCommandReceiver(), publisher: {} as never },
      { group: eventGroup, instance: new IncompleteEventSubscriber(), publisher: {} as never },
    ]);
    const command = runtime.commandDispatcher();
    const event = runtime.eventDispatcher();
    if (command === undefined || event === undefined) throw new Error("Expected both dispatchers.");

    await expect(
      command.dispatch(create(CommandSchema, { id: { uuid: "missing-command" } })),
    ).rejects.toThrow("Standalone command handler requires a message.");
    await expect(
      event.dispatch(create(EventSchema, { id: { value: "missing-event" } })),
    ).rejects.toThrow("Standalone event handler requires a message.");
    expect(runtime.stateDispatcher()).toBeUndefined();
  });

  it("rejects empty Command output from a standalone commander", async () => {
    const group: GeneratedStandaloneHandlerGroup = {
      receiverKind: "standalone",
      receiverType: EmptyCommandReceiver,
      handlers: [
        {
          kind: "command-substitution",
          methodName: "substitute",
          signalSchema: TaskCommandSchema,
          emittedSchemas: [TaskCommandSchema],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    };
    const dispatcher = new StandaloneHandlerRuntime([
      { group, instance: new EmptyCommandReceiver(), publisher: {} as never },
    ]).commandDispatcher();
    if (dispatcher === undefined) throw new Error("Expected Command dispatcher.");

    await expect(
      dispatcher.dispatch(
        create(CommandSchema, {
          id: { uuid: "empty-output" },
          message: AnyMessages.pack(TaskCommandSchema, create(TaskCommandSchema)),
        }),
      ),
    ).rejects.toThrow('Standalone command-substitution "substitute" must return a signal.');
  });

  it("creates isolated default contexts for two-parameter Command and Event handlers", async () => {
    const receiver = new ContextSubscriber();
    const commander = new ContextCommander();
    const group: GeneratedStandaloneHandlerGroup = {
      receiverKind: "standalone",
      receiverType: ContextSubscriber,
      handlers: [
        {
          kind: "event-subscription",
          methodName: "subscribe",
          signalSchema: TaskEventSchema,
          emittedSchemas: [],
          parameterCount: 2,
          origin: "domestic",
        },
      ],
    };
    const commandGroup: GeneratedStandaloneHandlerGroup = {
      receiverKind: "standalone",
      receiverType: ContextCommander,
      handlers: [
        {
          kind: "command-substitution",
          methodName: "substitute",
          signalSchema: TaskCommandSchema,
          emittedSchemas: [TaskCommandSchema],
          parameterCount: 2,
          origin: "domestic",
        },
      ],
    };
    const publisher = { publishCommand: () => Promise.resolve() } as never;
    const runtime = new StandaloneHandlerRuntime([
      { group, instance: receiver, publisher },
      { group: commandGroup, instance: commander, publisher },
    ]);
    const dispatcher = runtime.eventDispatcher();
    const commandDispatcher = runtime.commandDispatcher();
    if (dispatcher === undefined || commandDispatcher === undefined)
      throw new Error("Expected standalone dispatchers.");
    const event = create(EventSchema, {
      id: { value: "context" },
      message: AnyMessages.pack(TaskEventSchema, create(TaskEventSchema)),
    });

    await dispatcher.dispatch(event);
    await commandDispatcher.dispatch(
      create(CommandSchema, {
        id: { uuid: "context-command" },
        message: AnyMessages.pack(TaskCommandSchema, create(TaskCommandSchema)),
      }),
    );

    expect(receiver.context).toMatchObject({
      $typeName: "spine.core.EventContext",
      external: false,
    });
    expect(commander.context).toMatchObject({ $typeName: "spine.core.CommandContext" });
    expect(event.context).toBeUndefined();

    const contextualEvent = create(EventSchema, {
      id: { value: "contextual-event" },
      context: { external: false },
      message: AnyMessages.pack(TaskEventSchema, create(TaskEventSchema)),
    });
    const contextualCommand = create(CommandSchema, {
      id: { uuid: "contextual-command" },
      context: {},
      message: AnyMessages.pack(TaskCommandSchema, create(TaskCommandSchema)),
    });
    await dispatcher.dispatch(contextualEvent);
    await commandDispatcher.dispatch(contextualCommand);
    (receiver.context as { external?: boolean }).external = true;
    (commander.context as { actorContext?: object }).actorContext = {};
    expect(receiver.context).not.toBe(contextualEvent.context);
    expect(commander.context).not.toBe(contextualCommand.context);
    expect(contextualEvent.context?.external).toBe(false);
    expect(contextualCommand.context?.actorContext).toBeUndefined();
  });

  it("allows a reactor to return no Event", async () => {
    const group: GeneratedStandaloneHandlerGroup = {
      receiverKind: "standalone",
      receiverType: EmptyReactor,
      handlers: [
        {
          kind: "event-reaction",
          methodName: "react",
          signalSchema: TaskEventSchema,
          emittedSchemas: [TaskEventSchema],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    };
    const dispatcher = new StandaloneHandlerRuntime([
      { group, instance: new EmptyReactor(), publisher: {} as never },
    ]).eventDispatcher();
    if (dispatcher === undefined) throw new Error("Expected Event dispatcher.");

    await expect(
      dispatcher.dispatch(
        create(EventSchema, {
          id: { value: "empty-reactor" },
          message: AnyMessages.pack(TaskEventSchema, create(TaskEventSchema)),
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("publishes an array of reactor Events with Event ancestry", async () => {
    const published: unknown[] = [];
    const group: GeneratedStandaloneHandlerGroup = {
      receiverKind: "standalone",
      receiverType: ProducingReactor,
      handlers: [
        {
          kind: "event-reaction",
          methodName: "react",
          signalSchema: TaskEventSchema,
          emittedSchemas: [TaskEventSchema],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    };
    const dispatcher = new StandaloneHandlerRuntime([
      {
        group,
        instance: new ProducingReactor(),
        publisher: {
          publishEvent: (event: unknown) => {
            published.push(event);
            return Promise.resolve();
          },
        } as never,
      },
    ]).eventDispatcher();
    if (dispatcher === undefined) throw new Error("Expected Event dispatcher.");

    await dispatcher.dispatch(
      create(EventSchema, {
        id: { value: "source-event" },
        message: AnyMessages.pack(TaskEventSchema, create(TaskEventSchema)),
      }),
    );

    expect(published).toHaveLength(1);
  });
});

function stateChanged(schema: GenMessage<Message>, state: Message) {
  return create(EventSchema, {
    id: { value: "state-change" },
    message: AnyMessages.pack(
      EntityLog.EntityStateChangedSchema,
      create(EntityLog.EntityStateChangedSchema, {
        entity: {
          id: AnyMessages.pack(TaskEventSchema, create(TaskEventSchema)),
          typeUrl: schema.typeName,
        },
        newState: AnyMessages.pack(schema, state as never),
        signalId: [
          {
            id: AnyMessages.pack(TaskEventSchema, create(TaskEventSchema)),
            typeUrl: TaskEventSchema.typeName,
          },
        ],
      }),
    ),
  });
}
