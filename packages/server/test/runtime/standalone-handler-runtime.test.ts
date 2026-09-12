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
import { AnyMessages, RejectionThrowable, TypeUrls } from "@spine-event-engine/core";
import { CommandSchema, EventSchema, type Event } from "@spine-event-engine/proto";
import * as EntityLog from "@spine-event-engine/proto/generated/spine/system/server/entity_log_events_pb.js";
import { describe, expect, it } from "vitest";

import {
  AbstractAssignee,
  AbstractCommander,
  AbstractEventReactor,
  AbstractEventSubscriber,
} from "../../src/handler/standalone.js";
import type { GeneratedStandaloneHandlerGroup } from "../../src/handler/generated-handler-registry.js";
import { StandaloneHandlerRuntime } from "../../src/runtime/standalone-handler-runtime.js";
import { EventDispatcherRegistry } from "../../src/bus/event-dispatcher-registry.js";
import {
  ProjectStateSchema,
  type ProjectState,
} from "../../test-fixtures/generated/entity-metadata/project_states_pb.js";
import {
  AssignReviewTaskSchema,
  type AssignReviewTask,
} from "../../test-fixtures/generated/handler-registry/commands_pb.js";
import {
  ReviewTaskAssignedSchema,
  type ReviewTaskAssigned,
} from "../../test-fixtures/generated/handler-registry/events_pb.js";
import { ReviewRejectedSchema } from "../../test-fixtures/generated/handler-registry/rejections_pb.js";

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

  subscribe(state: ProjectState): void {
    this.states.push(state.id);
  }
}

class UndeclaredOutputReceiver extends AbstractEventReactor {
  react(): ProjectState {
    return create(ProjectStateSchema, { id: "unexpected", name: "Unexpected" });
  }
}

class EmptyCommandReceiver extends AbstractCommander {
  substitute(): undefined {
    return undefined;
  }
}

class RejectingAssignee extends AbstractAssignee {
  assign(): ReviewTaskAssigned {
    throw RejectionThrowable.create(ReviewRejectedSchema, { id: "rejected" });
  }
}

class IncompleteEventSubscriber extends AbstractEventSubscriber {
  subscribe(): void {
    return undefined;
  }
}

class ContextSubscriber extends AbstractEventSubscriber {
  context: unknown;

  subscribe(_event: ReviewTaskAssigned, context: unknown): void {
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
  react(): readonly ReviewTaskAssigned[] {
    return [create(ReviewTaskAssignedSchema, { id: "produced", name: "Produced" })];
  }
}

class RejectionCommander extends AbstractCommander {
  calls = 0;
  react(): AssignReviewTask {
    this.calls += 1;
    return create(AssignReviewTaskSchema, { id: "commander", name: "commander" });
  }
}

class RejectionReactor extends AbstractEventReactor {
  calls = 0;
  react(): ReviewTaskAssigned {
    this.calls += 1;
    return create(ReviewTaskAssignedSchema, { id: "reactor", name: "reactor" });
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

  substitute(_command: AssignReviewTask, context: unknown): AssignReviewTask {
    this.context = context;
    return create(AssignReviewTaskSchema, { id: "context-command", name: "context-command" });
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
          input: { schema: ReviewTaskAssignedSchema, origin },
          outcomes: { returned: [], thrown: [] },
          parameterCount: 1 as const,
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

    for (const handler of registry.find(TypeUrls.derive(ReviewTaskAssignedSchema), false)) {
      await handler.dispatch(
        create(EventSchema, {
          id: { value: "domestic" },
          message: AnyMessages.pack(ReviewTaskAssignedSchema, create(ReviewTaskAssignedSchema)),
        }),
      );
    }
    for (const handler of registry.find(TypeUrls.derive(ReviewTaskAssignedSchema), true)) {
      await handler.dispatch(
        create(EventSchema, {
          id: { value: "external" },
          context: { external: true },
          message: AnyMessages.pack(ReviewTaskAssignedSchema, create(ReviewTaskAssignedSchema)),
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
      returnedSchemas: readonly GenMessage<Message>[],
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
          input: { schema: ReviewRejectedSchema, origin: "domestic" as const },
          outcomes: { returned: returnedSchemas, thrown: [] },
          parameterCount: 1 as const,
        },
      ],
    });
    const dispatcher = new StandaloneHandlerRuntime([
      {
        group: reaction(RejectionCommander, "react", [AssignReviewTaskSchema]),
        instance: commander,
        publisher,
      },
      {
        group: reaction(RejectionReactor, "react", [ReviewTaskAssignedSchema]),
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
          input: {
            schema: ReviewTaskAssignedSchema,
            origin: "domestic",
            where: { eventField: "name", equals: "selected" },
          },
          outcomes: { returned: [], thrown: [] },
          parameterCount: 1,
        },
        {
          kind: "event-subscription",
          methodName: "fallback",
          input: { schema: ReviewTaskAssignedSchema, origin: "domestic" },
          outcomes: { returned: [], thrown: [] },
          parameterCount: 1,
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
        message: AnyMessages.pack(
          ReviewTaskAssignedSchema,
          create(ReviewTaskAssignedSchema, { name: "selected" }),
        ),
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
          input: {
            schema: ReviewTaskAssignedSchema,
            origin: "external",
            where: { eventField: "name", equals: "external" },
          },
          outcomes: { returned: [], thrown: [] },
          parameterCount: 1,
        },
      ],
    };
    const dispatcher = new StandaloneHandlerRuntime([
      { group, instance: receiver, publisher: {} as never },
    ]).eventDispatcher();
    if (dispatcher === undefined) throw new Error("Expected standalone Event dispatcher.");

    expect(dispatcher.externalEventSchemas?.()).toEqual([ReviewTaskAssignedSchema]);
    await dispatcher.dispatch(
      create(EventSchema, {
        id: { value: "external-event" },
        context: { external: true },
        message: AnyMessages.pack(
          ReviewTaskAssignedSchema,
          create(ReviewTaskAssignedSchema, { name: "external" }),
        ),
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
          input: { schema: ProjectStateSchema, origin: "domestic" },
          outcomes: { returned: [], thrown: [] },
          parameterCount: 1,
        },
      ],
    };
    const dispatcher = new StandaloneHandlerRuntime([
      { group, instance: receiver, publisher: {} as never },
    ]).stateDispatcher();
    if (dispatcher === undefined) throw new Error("Expected standalone state dispatcher.");

    await dispatcher.dispatch(
      stateChanged(ProjectStateSchema, create(ProjectStateSchema, { id: "matching", name: "A" })),
    );
    await dispatcher.dispatch(
      stateChanged(
        ReviewTaskAssignedSchema,
        create(ReviewTaskAssignedSchema, { id: "mismatch", name: "B" }),
      ),
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
          input: { schema: ReviewTaskAssignedSchema, origin: "domestic" },
          outcomes: { returned: [ReviewTaskAssignedSchema], thrown: [] },
          parameterCount: 1,
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
          message: AnyMessages.pack(ReviewTaskAssignedSchema, create(ReviewTaskAssignedSchema)),
        }),
      ),
    ).rejects.toThrow('Standalone handler "react" returned an undeclared signal.');
  });

  it("publishes a declared rejection thrown by a standalone command assignee", async () => {
    const published: Event[] = [];
    const dispatcher = rejectingAssigneeDispatcher([ReviewRejectedSchema], (event) => {
      published.push(event);
      return Promise.resolve();
    });

    await dispatcher.dispatch(reviewAssignmentCommand("declared-rejection"));

    expect(published).toHaveLength(1);
    const [event] = published;
    if (event?.message === undefined) throw new Error("Expected a published rejection Event.");
    expect(AnyMessages.unpack(event.message, ReviewRejectedSchema)).toEqual(
      create(ReviewRejectedSchema, { id: "rejected" }),
    );
    expect(event.context?.rejection?.command?.id?.uuid).toBe("declared-rejection");
  });

  it("rejects an undeclared rejection thrown by a standalone command assignee", async () => {
    const dispatcher = rejectingAssigneeDispatcher([], () => Promise.resolve());

    await expect(
      dispatcher.dispatch(reviewAssignmentCommand("undeclared-rejection")),
    ).rejects.toThrow(
      `Handler "assign" threw undeclared rejection "${ReviewRejectedSchema.typeName}".`,
    );
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
                  input: { schema: ReviewTaskAssignedSchema, origin: "domestic" },
                  outcomes: { returned: [], thrown: [] },
                  parameterCount: 1,
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
          input: { schema: AssignReviewTaskSchema, origin: "domestic" },
          outcomes: { returned: [AssignReviewTaskSchema], thrown: [] },
          parameterCount: 1,
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
          input: { schema: ReviewTaskAssignedSchema, origin: "domestic" },
          outcomes: { returned: [], thrown: [] },
          parameterCount: 1,
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
          input: { schema: AssignReviewTaskSchema, origin: "domestic" },
          outcomes: { returned: [AssignReviewTaskSchema], thrown: [] },
          parameterCount: 1,
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
          message: AnyMessages.pack(AssignReviewTaskSchema, create(AssignReviewTaskSchema)),
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
          input: { schema: ReviewTaskAssignedSchema, origin: "domestic" },
          outcomes: { returned: [], thrown: [] },
          parameterCount: 2,
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
          input: { schema: AssignReviewTaskSchema, origin: "domestic" },
          outcomes: { returned: [AssignReviewTaskSchema], thrown: [] },
          parameterCount: 2,
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
      message: AnyMessages.pack(ReviewTaskAssignedSchema, create(ReviewTaskAssignedSchema)),
    });

    await dispatcher.dispatch(event);
    await commandDispatcher.dispatch(
      create(CommandSchema, {
        id: { uuid: "context-command" },
        message: AnyMessages.pack(AssignReviewTaskSchema, create(AssignReviewTaskSchema)),
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
      message: AnyMessages.pack(ReviewTaskAssignedSchema, create(ReviewTaskAssignedSchema)),
    });
    const contextualCommand = create(CommandSchema, {
      id: { uuid: "contextual-command" },
      context: {},
      message: AnyMessages.pack(AssignReviewTaskSchema, create(AssignReviewTaskSchema)),
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
          input: { schema: ReviewTaskAssignedSchema, origin: "domestic" },
          outcomes: { returned: [ReviewTaskAssignedSchema], thrown: [] },
          parameterCount: 1,
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
          message: AnyMessages.pack(ReviewTaskAssignedSchema, create(ReviewTaskAssignedSchema)),
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
          input: { schema: ReviewTaskAssignedSchema, origin: "domestic" },
          outcomes: { returned: [ReviewTaskAssignedSchema], thrown: [] },
          parameterCount: 1,
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
        message: AnyMessages.pack(ReviewTaskAssignedSchema, create(ReviewTaskAssignedSchema)),
      }),
    );

    expect(published).toHaveLength(1);
  });
});

function rejectingAssigneeDispatcher(
  thrown: readonly GenMessage<Message>[],
  publishRejectionEvent: (event: Event) => Promise<void>,
) {
  const group: GeneratedStandaloneHandlerGroup = {
    receiverKind: "standalone",
    receiverType: RejectingAssignee,
    handlers: [
      {
        kind: "command-assignment",
        methodName: "assign",
        input: { schema: AssignReviewTaskSchema, origin: "domestic" },
        outcomes: { returned: [ReviewTaskAssignedSchema], thrown },
        parameterCount: 1,
      },
    ],
  };
  const dispatcher = new StandaloneHandlerRuntime([
    {
      group,
      instance: new RejectingAssignee(),
      publisher: { publishRejectionEvent } as never,
    },
  ]).commandDispatcher();
  if (dispatcher === undefined) throw new Error("Expected standalone Command dispatcher.");
  return dispatcher;
}

function reviewAssignmentCommand(uuid: string) {
  return create(CommandSchema, {
    id: { uuid },
    message: AnyMessages.pack(AssignReviewTaskSchema, create(AssignReviewTaskSchema)),
  });
}

function stateChanged(schema: GenMessage<Message>, state: Message) {
  return create(EventSchema, {
    id: { value: "state-change" },
    message: AnyMessages.pack(
      EntityLog.EntityStateChangedSchema,
      create(EntityLog.EntityStateChangedSchema, {
        entity: {
          id: AnyMessages.pack(ReviewTaskAssignedSchema, create(ReviewTaskAssignedSchema)),
          typeUrl: schema.typeName,
        },
        newState: AnyMessages.pack(schema, state as never),
        signalId: [
          {
            id: AnyMessages.pack(ReviewTaskAssignedSchema, create(ReviewTaskAssignedSchema)),
            typeUrl: ReviewTaskAssignedSchema.typeName,
          },
        ],
      }),
    ),
  });
}
