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

import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { AnyMessages, TypeUrls, type MessageSchema } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  type CommandContext,
  CommandContextSchema,
  CommandIdSchema,
  CommandSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@spine-event-engine/proto";
import { SubscriptionService } from "@spine-event-engine/proto/client";
import {
  type Subscription,
  type SubscriptionUpdate,
  TargetSchema,
  type Topic,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { describe, expect, it } from "vitest";

import {
  Aggregate,
  BoundedContext,
  EntityHandlers,
  HandlerRegistryIngestor,
  ProcessManager,
  Projection,
  Repository,
  SpineServices,
  type EntityHandlersMetadata,
} from "../../src/index.js";
import {
  NativeProjectStateSchema,
  NativeProcessManagerStateSchema,
  NativeProjectOverviewStateSchema,
} from "../../test-fixtures/native-subscription-fixtures.js";
import {
  type AssignReviewTask,
  AssignReviewTaskSchema,
} from "../../test-fixtures/generated/handler-registry/commands_pb.js";
import {
  type TaskAssigned,
  TaskAssignedSchema,
  TaskCreatedSchema,
  type TaskCreated,
} from "../../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";

class NativeAggregate extends Aggregate<string, typeof NativeProjectStateSchema> {
  assign(command: AssignReviewTask): TaskCreated {
    this.update((draft) =>
      Object.assign(
        draft,
        create(NativeProjectStateSchema, {
          id: command.id,
          name: `${command.name} aggregate`,
          archived: false,
        }),
      ),
    );
    return create(TaskCreatedSchema, {
      id: create(TaskIdSchema, { value: command.id }),
      title: `${command.name} aggregate`,
      taskListId: create(TaskListIdSchema, { value: command.id }),
    });
  }
}

class NativeProjection extends Projection<string, typeof NativeProjectOverviewStateSchema> {
  project(event: TaskCreated): void {
    const id = event.id?.value ?? "";
    this.update((draft) =>
      Object.assign(
        draft,
        create(NativeProjectOverviewStateSchema, {
          id,
          name: `${event.title} projection`,
          priority: 2,
        }),
      ),
    );
  }
}

class NativeProcessManager extends ProcessManager<string, typeof NativeProcessManagerStateSchema> {
  assign(command: AssignReviewTask, context: CommandContext): TaskAssigned {
    this.update((draft) =>
      Object.assign(
        draft,
        create(NativeProcessManagerStateSchema, {
          id: command.id,
          queue: `${command.name} command`,
        }),
      ),
    );
    const assignee = context.actorContext?.actor;
    if (assignee === undefined) throw new Error("Expected the assigning actor.");
    return create(TaskAssignedSchema, {
      id: create(TaskIdSchema, { value: command.id }),
      taskListId: create(TaskListIdSchema, { value: command.id }),
      assignee,
    });
  }

  react(event: TaskCreated): undefined {
    this.update((draft) =>
      Object.assign(
        draft,
        create(NativeProcessManagerStateSchema, {
          id: event.id?.value ?? "",
          queue: `${event.title} event`,
        }),
      ),
    );
    return undefined;
  }
}

describe("native service subscriptions", () => {
  it("delivers an Aggregate commit through the registered command handler", async () => {
    const context = BoundedContext.multitenant("NativeAggregate")
      .add(
        new Repository({
          entityType: NativeAggregate,
          schema: NativeProjectStateSchema,
          handlers: nativeAggregateHandlers(),
          events: [TaskCreatedSchema],
        }),
      )
      .build();

    try {
      const handlers = registeredSubscriptionHandlers(context);
      const iterator = handlers
        .activate(
          await handlers.subscribe(createEntityTopic(NativeProjectStateSchema, "aggregate")),
        )
        [Symbol.asyncIterator]();
      const next = nextSubscriptionUpdate(iterator);
      await activationTurn();

      await context.commandBus().post(createAggregateCommand("aggregate-1", "Aggregate"));
      await context.eventBus().post(createAggregateEvent("aggregate-flush", "Flush"));

      await expectNativeState(next, NativeProjectStateSchema, {
        id: "aggregate-1",
        name: "Aggregate aggregate",
        archived: false,
      });
      await iterator.return?.();
    } finally {
      await context.close();
    }
  });

  it("delivers a Projection commit through the registered event handler", async () => {
    const context = BoundedContext.multitenant("NativeProjection")
      .add(
        new Repository({
          entityType: NativeProjection,
          schema: NativeProjectOverviewStateSchema,
          handlers: EntityHandlers.define(
            NativeProjection,
            NativeProjectOverviewStateSchema,
            (builder) => [builder.subscribe(TaskCreatedSchema, "project")],
          ),
        }),
      )
      .build();

    try {
      const handlers = registeredSubscriptionHandlers(context);
      const iterator = handlers
        .activate(
          await handlers.subscribe(
            createEntityTopic(NativeProjectOverviewStateSchema, "projection"),
          ),
        )
        [Symbol.asyncIterator]();
      const next = nextSubscriptionUpdate(iterator);
      await activationTurn();

      await context.eventBus().post(createProjectionTriggerEvent("projection-1", "Projection"));

      await expectNativeState(next, NativeProjectOverviewStateSchema, {
        id: "projection-1",
        name: "Projection projection",
        priority: 2,
      });
      await iterator.return?.();
    } finally {
      await context.close();
    }
  });

  it("delivers a Process Manager command commit through the registered command handler", async () => {
    const context = createProcessManagerContext("NativeProcessManagerCommand");

    try {
      const handlers = registeredSubscriptionHandlers(context);
      const iterator = handlers
        .activate(
          await handlers.subscribe(
            createEntityTopic(NativeProcessManagerStateSchema, "process-command"),
          ),
        )
        [Symbol.asyncIterator]();
      const next = nextSubscriptionUpdate(iterator);
      await activationTurn();

      await context.commandBus().post(createAggregateCommand("process-command-1", "Process"));

      await expectNativeState(next, NativeProcessManagerStateSchema, {
        id: "process-command-1",
        queue: "Process command",
      });
      await iterator.return?.();
    } finally {
      await context.close();
    }
  });

  it("delivers a Process Manager event commit through the registered event handler", async () => {
    const context = createProcessManagerContext("NativeProcessManagerEvent");

    try {
      const handlers = registeredSubscriptionHandlers(context);
      const iterator = handlers
        .activate(
          await handlers.subscribe(
            createEntityTopic(NativeProcessManagerStateSchema, "process-event"),
          ),
        )
        [Symbol.asyncIterator]();
      const next = nextSubscriptionUpdate(iterator);
      await activationTurn();

      await context.eventBus().post(createProjectionEvent("process-event-1", "Process"));

      await expectNativeState(next, NativeProcessManagerStateSchema, {
        id: "process-event-1",
        queue: "Process event",
      });
      await iterator.return?.();
    } finally {
      await context.close();
    }
  });
});

/**
 * Materializes the Native Aggregate assignment and its declared Event result.
 *
 * @returns Handler metadata for the Native Aggregate.
 */
function nativeAggregateHandlers(): EntityHandlersMetadata<
  NativeAggregate,
  typeof NativeProjectStateSchema
> {
  const handlers = new HandlerRegistryIngestor().ingest({
    receivers: [
      {
        receiverKind: "entity",
        receiverType: NativeAggregate,
        stateSchema: NativeProjectStateSchema,
        handlers: [
          {
            kind: "command-assignment",
            methodName: "assign",
            input: { schema: AssignReviewTaskSchema, origin: "domestic" },
            outcomes: { returned: [TaskCreatedSchema], thrown: [] },
            parameterCount: 1,
          },
        ],
      },
    ],
  })[0];
  if (handlers === undefined) throw new Error("Expected Native Aggregate handlers.");
  return handlers as EntityHandlersMetadata<NativeAggregate, typeof NativeProjectStateSchema>;
}

/**
 * Registers the Process Manager assignment outcome and state-only Event reaction.
 *
 * @returns Generated handler metadata for the native Process Manager.
 */
function nativeProcessManagerHandlers(): EntityHandlersMetadata<
  NativeProcessManager,
  typeof NativeProcessManagerStateSchema
> {
  const handlers = new HandlerRegistryIngestor().ingest({
    receivers: [
      {
        receiverKind: "entity",
        receiverType: NativeProcessManager,
        stateSchema: NativeProcessManagerStateSchema,
        handlers: [
          {
            kind: "command-assignment",
            methodName: "assign",
            input: { schema: AssignReviewTaskSchema, origin: "domestic" },
            outcomes: { returned: [TaskAssignedSchema], thrown: [] },
            parameterCount: 2,
          },
          {
            kind: "event-reaction",
            methodName: "react",
            input: { schema: TaskCreatedSchema, origin: "domestic" },
            outcomes: { returned: [], thrown: [] },
            parameterCount: 1,
          },
        ],
      },
    ],
  })[0];
  if (handlers === undefined) throw new Error("Expected Native Process Manager handlers.");
  return handlers as EntityHandlersMetadata<
    NativeProcessManager,
    typeof NativeProcessManagerStateSchema
  >;
}

function createProcessManagerContext(name: string): BoundedContext {
  return BoundedContext.multitenant(name)
    .add(
      new Repository({
        entityType: NativeProcessManager,
        schema: NativeProcessManagerStateSchema,
        handlers: nativeProcessManagerHandlers(),
        events: [TaskAssignedSchema],
      }),
    )
    .build();
}

function createEntityTopic(schema: MessageSchema, id: string): Topic {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: `topic-${id}` }),
    context: createActorContext(),
    target: create(TargetSchema, {
      type: TypeUrls.derive(schema),
      criterion: { case: "includeAll", value: true },
    }),
  });
}

function createAggregateCommand(id: string, name: string) {
  return create(CommandSchema, {
    id: create(CommandIdSchema, { uuid: `command-${id}` }),
    context: create(CommandContextSchema, { actorContext: createActorContext() }),
    message: AnyMessages.pack(AssignReviewTaskSchema, create(AssignReviewTaskSchema, { id, name })),
  });
}

function createProjectionEvent(id: string, name: string) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: `event-${id}` }),
    context: create(EventContextSchema, {
      origin: { case: "importContext", value: createActorContext() },
      producerId: AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: id })),
    }),
    message: AnyMessages.pack(
      TaskCreatedSchema,
      create(TaskCreatedSchema, {
        id: create(TaskIdSchema, { value: id }),
        title: name,
        taskListId: create(TaskListIdSchema, { value: id }),
      }),
    ),
  });
}

function createProjectionTriggerEvent(id: string, title: string) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: `event-${id}` }),
    context: create(EventContextSchema, {
      origin: { case: "importContext", value: createActorContext() },
      producerId: AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: id })),
    }),
    message: AnyMessages.pack(
      TaskCreatedSchema,
      create(TaskCreatedSchema, {
        id: create(TaskIdSchema, { value: id }),
        title,
        taskListId: create(TaskListIdSchema, { value: id }),
      }),
    ),
  });
}

function createAggregateEvent(id: string, name: string) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: `event-${id}` }),
    context: create(EventContextSchema, {
      origin: { case: "importContext", value: createActorContext() },
      producerId: AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: id })),
    }),
    message: AnyMessages.pack(
      TaskCreatedSchema,
      create(TaskCreatedSchema, {
        id: create(TaskIdSchema, { value: id }),
        title: name,
        taskListId: create(TaskListIdSchema, { value: id }),
      }),
    ),
  });
}

function createActorContext() {
  return create(ActorContextSchema, {
    actor: create(UserIdSchema, { value: "native-user" }),
    tenantId: create(TenantIdSchema, { kind: { case: "value", value: "tenant-native" } }),
  });
}

function registeredSubscriptionHandlers(context: BoundedContext) {
  let handlers:
    | {
        subscribe(topic: Topic): Subscription | Promise<Subscription>;
        activate(subscription: Subscription): AsyncIterable<SubscriptionUpdate>;
      }
    | undefined;
  const services = new SpineServices({ contexts: [context] });

  services.register({
    service(schema: unknown, implementation: unknown) {
      if (schema === SubscriptionService) {
        handlers = implementation as typeof handlers;
      }
      return this;
    },
  } as never);

  if (handlers === undefined) {
    throw new Error("SubscriptionService handlers were not registered.");
  }

  return handlers;
}

async function expectNativeState<Schema extends MessageSchema>(
  next: Promise<SubscriptionUpdate>,
  schema: Schema,
  expected: MessageInitShape<Schema>,
): Promise<void> {
  const delivered = await next;
  const state =
    delivered.update.case === "entityUpdates" ? delivered.update.value.update[0]?.kind : undefined;

  expect(state?.case).toBe("state");
  if (state?.case !== "state") {
    throw new Error("Expected a native EntityStateChanged subscription update.");
  }
  expect(AnyMessages.unpack(state.value, schema)).toEqual(create(schema, expected));
}

async function nextSubscriptionUpdate(
  iterator: AsyncIterator<SubscriptionUpdate>,
): Promise<SubscriptionUpdate> {
  const next = await iterator.next();
  if (next.done) throw new Error("Expected an active subscription update.");
  return next.value;
}

function activationTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 25));
}
