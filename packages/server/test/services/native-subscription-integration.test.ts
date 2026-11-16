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
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AnyPacker, TypeUrls, type MessageSchema } from "@spine-event-engine/core";
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
import { describe, expect, it, onTestFinished } from "vitest";

import {
  Aggregate,
  Application,
  type BoundedContextBuilder,
  BoundedContext,
  EntityHandlers,
  HandlerRegistryIngestor,
  ProcessManager,
  Projection,
  Repository,
  SpineServices,
  type EntityHandlersMetadata,
} from "../../src/index.js";
import { ServerEnvironment } from "../../src/server/server-environment.js";
import { EnvironmentType } from "../../src/server/environment.js";
import { TestTenantIndex, requireTenantDirectory } from "../tenant-index-fixture.js";
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
  type ReviewTaskAssigned,
  ReviewTaskAssignedSchema,
} from "../../test-fixtures/generated/handler-registry/events_pb.js";
import { ProjectIdSchema } from "../../test-fixtures/generated/repository-routing/project_identifiers_pb.js";
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

interface TestSetup {
  readonly applications: Application[];
  readonly index: TestTenantIndex;
}

function createTestSetup(): TestSetup {
  const setup: TestSetup = { applications: [], index: new TestTenantIndex() };
  onTestFinished(async () => {
    for (const application of setup.applications.reverse()) await application.close();
  });
  return setup;
}

async function buildContext(
  builder: BoundedContextBuilder,
  setup: TestSetup,
): Promise<BoundedContext> {
  const environment = ServerEnvironment.newBuilder()
    .under(EnvironmentType.Local, () => undefined)
    .build();
  const application = await Application.newBuilder()
    .setServerEnvironment(environment)
    .setTenantIndex(setup.index)
    .add(builder)
    .build();
  setup.applications.push(application);
  const [context] = application.contexts();
  if (context === undefined) throw new Error("Expected a Bounded Context.");
  return context;
}

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
  project(event: ReviewTaskAssigned): void {
    const id = event.id;
    this.update((draft) =>
      Object.assign(
        draft,
        create(NativeProjectOverviewStateSchema, {
          id,
          name: `${event.name} projection`,
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

  react(event: ReviewTaskAssigned): undefined {
    this.update((draft) =>
      Object.assign(
        draft,
        create(NativeProcessManagerStateSchema, {
          id: event.id,
          queue: `${event.name} event`,
        }),
      ),
    );
    return undefined;
  }
}

describe("native service subscriptions", () => {
  it("acknowledges an attached idle subscription before any business update", async () => {
    const setup = createTestSetup();
    const context = await buildContext(
      BoundedContext.multiTenant("NativeIdleAck").add(
        new Repository({
          entityType: NativeAggregate,
          schema: NativeProjectStateSchema,
          handlers: nativeAggregateHandlers(),
          events: [TaskCreatedSchema],
        }),
      ),
      setup,
    );

    try {
      await requireTenantDirectory(context.tenantIndex).keep(
        create(TenantIdSchema, { kind: { case: "value", value: "tenant-native" } }),
      );
      const handlers = registeredSubscriptionHandlers(setup);
      const subscription = await handlers.subscribe(
        createEntityTopic(NativeProjectStateSchema, "idle-ack"),
      );
      const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first.done).toBe(false);
      const acknowledgement = first.value as SubscriptionUpdate | undefined;
      expect(acknowledgement?.subscription?.id?.value).toBe(subscription.id?.value);
      expect(acknowledgement?.response?.status?.status.case).toBe("ok");
      expect(acknowledgement?.update.case).toBeUndefined();
      await iterator.return?.();
    } finally {
      await context.close();
    }
  });

  it("delivers an Aggregate commit through the registered command handler", async () => {
    const setup = createTestSetup();
    const context = await buildContext(
      BoundedContext.multiTenant("NativeAggregate").add(
        new Repository({
          entityType: NativeAggregate,
          schema: NativeProjectStateSchema,
          handlers: nativeAggregateHandlers(),
          events: [TaskCreatedSchema],
        }),
      ),
      setup,
    );

    try {
      await requireTenantDirectory(context.tenantIndex).keep(
        create(TenantIdSchema, { kind: { case: "value", value: "tenant-native" } }),
      );
      const handlers = registeredSubscriptionHandlers(setup);
      const iterator = handlers
        .activate(
          await handlers.subscribe(createEntityTopic(NativeProjectStateSchema, "aggregate")),
        )
        [Symbol.asyncIterator]();
      await nextSubscriptionAck(iterator);
      const next = nextSubscriptionUpdate(iterator);

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
    const setup = createTestSetup();
    const context = await buildContext(
      BoundedContext.multiTenant("NativeProjection").add(
        new Repository({
          entityType: NativeProjection,
          schema: NativeProjectOverviewStateSchema,
          handlers: EntityHandlers.define(
            NativeProjection,
            NativeProjectOverviewStateSchema,
            (builder) => [builder.subscribe(ReviewTaskAssignedSchema, "project")],
          ),
        }),
      ),
      setup,
    );

    try {
      await requireTenantDirectory(context.tenantIndex).keep(
        create(TenantIdSchema, { kind: { case: "value", value: "tenant-native" } }),
      );
      const handlers = registeredSubscriptionHandlers(setup);
      const iterator = handlers
        .activate(
          await handlers.subscribe(
            createEntityTopic(NativeProjectOverviewStateSchema, "projection"),
          ),
        )
        [Symbol.asyncIterator]();
      await nextSubscriptionAck(iterator);
      const next = nextSubscriptionUpdate(iterator);

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
    const setup = createTestSetup();
    const context = await createProcessManagerContext("NativeProcessManagerCommand", setup);

    try {
      await requireTenantDirectory(context.tenantIndex).keep(
        create(TenantIdSchema, { kind: { case: "value", value: "tenant-native" } }),
      );
      const handlers = registeredSubscriptionHandlers(setup);
      const iterator = handlers
        .activate(
          await handlers.subscribe(
            createEntityTopic(NativeProcessManagerStateSchema, "process-command"),
          ),
        )
        [Symbol.asyncIterator]();
      await nextSubscriptionAck(iterator);
      const next = nextSubscriptionUpdate(iterator);

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
    const setup = createTestSetup();
    const context = await createProcessManagerContext("NativeProcessManagerEvent", setup);

    try {
      await requireTenantDirectory(context.tenantIndex).keep(
        create(TenantIdSchema, { kind: { case: "value", value: "tenant-native" } }),
      );
      const handlers = registeredSubscriptionHandlers(setup);
      const iterator = handlers
        .activate(
          await handlers.subscribe(
            createEntityTopic(NativeProcessManagerStateSchema, "process-event"),
          ),
        )
        [Symbol.asyncIterator]();
      await nextSubscriptionAck(iterator);
      const next = nextSubscriptionUpdate(iterator);

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
            input: { schema: ReviewTaskAssignedSchema, origin: "domestic" },
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

function createProcessManagerContext(name: string, setup: TestSetup): Promise<BoundedContext> {
  return buildContext(
    BoundedContext.multiTenant(name).add(
      new Repository({
        entityType: NativeProcessManager,
        schema: NativeProcessManagerStateSchema,
        handlers: nativeProcessManagerHandlers(),
        events: [TaskAssignedSchema],
      }),
    ),
    setup,
  );
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
    message: AnyPacker.pack(AssignReviewTaskSchema, create(AssignReviewTaskSchema, { id, name })),
  });
}

function createProjectionEvent(id: string, name: string) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: `event-${id}` }),
    context: create(EventContextSchema, {
      origin: { case: "importContext", value: createActorContext() },
      producerId: AnyPacker.pack(ProjectIdSchema, create(ProjectIdSchema, { value: id })),
    }),
    message: AnyPacker.pack(
      ReviewTaskAssignedSchema,
      create(ReviewTaskAssignedSchema, { id, name }),
    ),
  });
}

function createProjectionTriggerEvent(id: string, title: string) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: `event-${id}` }),
    context: create(EventContextSchema, {
      origin: { case: "importContext", value: createActorContext() },
      producerId: AnyPacker.pack(ProjectIdSchema, create(ProjectIdSchema, { value: id })),
    }),
    message: AnyPacker.pack(
      ReviewTaskAssignedSchema,
      create(ReviewTaskAssignedSchema, { id, name: title }),
    ),
  });
}

function createAggregateEvent(id: string, name: string) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: `event-${id}` }),
    context: create(EventContextSchema, {
      origin: { case: "importContext", value: createActorContext() },
      producerId: AnyPacker.pack(TaskIdSchema, create(TaskIdSchema, { value: id })),
    }),
    message: AnyPacker.pack(
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
    timestamp: create(TimestampSchema, { seconds: 1n }),
  });
}

function registeredSubscriptionHandlers(setup: TestSetup) {
  let handlers:
    | {
        subscribe(topic: Topic): Subscription | Promise<Subscription>;
        activate(subscription: Subscription): AsyncIterable<SubscriptionUpdate>;
      }
    | undefined;
  const application = setup.applications.at(-1);
  if (application === undefined) throw new Error("Expected a test Application.");
  const services = new SpineServices({ application });

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
  expect(AnyPacker.tryUnpack(state.value, schema)).toEqual(create(schema, expected));
}

async function nextSubscriptionUpdate(
  iterator: AsyncIterator<SubscriptionUpdate>,
): Promise<SubscriptionUpdate> {
  const next = await iterator.next();
  if (next.done) throw new Error("Expected an active subscription update.");
  return next.value;
}

async function nextSubscriptionAck(iterator: AsyncIterator<SubscriptionUpdate>): Promise<void> {
  const ack = await nextSubscriptionUpdate(iterator);
  expect(ack.response?.status?.status.case).toBe("ok");
  expect(ack.update.case).toBeUndefined();
}
