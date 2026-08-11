import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import {
  AnyMessages,
  SignalEnvelopes,
  TypeUrls,
  type MessageSchema,
} from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  EventContextSchema,
  EventIdSchema,
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
  ProcessManager,
  Projection,
  Repository,
  SpineServices,
} from "../../src/index.js";
import {
  NativeAggregateStateSchema,
  NativeProcessManagerStateSchema,
  NativeProjectionStateSchema,
  type NativeAggregateState,
  type NativeProjectionState,
} from "../../test-fixtures/native-subscription-fixtures.js";

class NativeAggregate extends Aggregate<string, typeof NativeAggregateStateSchema, bigint> {
  assign(command: NativeAggregateState): NativeAggregateState {
    this.update((draft) =>
      Object.assign(
        draft,
        create(NativeAggregateStateSchema, {
          id: command.id,
          name: `${command.name} aggregate`,
          archived: false,
        }),
      ),
    );
    return create(NativeAggregateStateSchema, {
      id: command.id,
      name: `${command.name} aggregate`,
      archived: false,
    });
  }
}

class NativeProjection extends Projection<string, typeof NativeProjectionStateSchema, number> {
  project(event: NativeProjectionState): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(NativeProjectionStateSchema, {
          id: event.id,
          name: `${event.name} projection`,
          priority: event.priority + 1,
        }),
      ),
    );
  }
}

class NativeProcessManager extends ProcessManager<
  string,
  typeof NativeProcessManagerStateSchema,
  number
> {
  assign(command: NativeAggregateState): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(NativeProcessManagerStateSchema, {
          id: command.id,
          queue: `${command.name} command`,
        }),
      ),
    );
  }

  react(event: NativeProjectionState): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(NativeProcessManagerStateSchema, {
          id: event.id,
          queue: `${event.name} event`,
        }),
      ),
    );
  }
}

describe("native service subscriptions", () => {
  it("delivers an Aggregate commit through the registered command handler", async () => {
    const context = BoundedContext.multitenant("NativeAggregate")
      .add(
        new Repository({
          entityType: NativeAggregate,
          schema: NativeAggregateStateSchema,
          handlers: EntityHandlers.define(
            NativeAggregate,
            NativeAggregateStateSchema,
            (builder) => [builder.assign(NativeAggregateStateSchema, "assign")],
          ),
          events: [NativeAggregateStateSchema],
        }),
      )
      .build();

    try {
      const handlers = registeredSubscriptionHandlers(context);
      const iterator = handlers
        .activate(
          await handlers.subscribe(createEntityTopic(NativeAggregateStateSchema, "aggregate")),
        )
        [Symbol.asyncIterator]();
      const next = nextSubscriptionUpdate(iterator);
      await activationTurn();

      await context.commandBus().post(createAggregateCommand("aggregate-1", "Aggregate"));
      await context.eventBus().post(createAggregateEvent("aggregate-flush", "Flush"));

      await expectNativeState(next, NativeAggregateStateSchema, {
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
          schema: NativeProjectionStateSchema,
          handlers: EntityHandlers.define(
            NativeProjection,
            NativeProjectionStateSchema,
            (builder) => [builder.subscribe(NativeProjectionStateSchema, "project")],
          ),
        }),
      )
      .build();

    try {
      const handlers = registeredSubscriptionHandlers(context);
      const iterator = handlers
        .activate(
          await handlers.subscribe(createEntityTopic(NativeProjectionStateSchema, "projection")),
        )
        [Symbol.asyncIterator]();
      const next = nextSubscriptionUpdate(iterator);
      await activationTurn();

      await context.eventBus().post(createProjectionEvent("projection-1", "Projection"));

      await expectNativeState(next, NativeProjectionStateSchema, {
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
      await context.eventBus().post(createProjectionEvent("process-command-flush", "Flush"));

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

function createProcessManagerContext(name: string): BoundedContext {
  return BoundedContext.multitenant(name)
    .add(
      new Repository({
        entityType: NativeProcessManager,
        schema: NativeProcessManagerStateSchema,
        handlers: EntityHandlers.define(
          NativeProcessManager,
          NativeProcessManagerStateSchema,
          (builder) => [
            builder.assign(NativeAggregateStateSchema, "assign"),
            builder.react(NativeProjectionStateSchema, "react"),
          ],
        ),
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
  return SignalEnvelopes.command({
    id: create(CommandIdSchema, { uuid: `command-${id}` }),
    context: create(CommandContextSchema, { actorContext: createActorContext() }),
    schema: NativeAggregateStateSchema,
    message: create(NativeAggregateStateSchema, { id, name, archived: false }),
  });
}

function createProjectionEvent(id: string, name: string) {
  return SignalEnvelopes.event({
    id: create(EventIdSchema, { value: `event-${id}` }),
    context: create(EventContextSchema, {
      origin: { case: "importContext", value: createActorContext() },
      producerId: AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: id })),
    }),
    schema: NativeProjectionStateSchema,
    message: create(NativeProjectionStateSchema, { id, name, priority: 1 }),
  });
}

function createAggregateEvent(id: string, name: string) {
  return SignalEnvelopes.event({
    id: create(EventIdSchema, { value: `event-${id}` }),
    context: create(EventContextSchema, {
      origin: { case: "importContext", value: createActorContext() },
      producerId: AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: id })),
    }),
    schema: NativeAggregateStateSchema,
    message: create(NativeAggregateStateSchema, { id, name, archived: false }),
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
