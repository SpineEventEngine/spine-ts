/* global Buffer, URL, setTimeout */

import { BoundedContext } from "@spine-event-engine/server";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
  StringValueSchema,
} from "@bufbuild/protobuf/wkt";
import { deriveTypeUrl, packAny, packEvent, unpackAny } from "@spine-event-engine/core";
import {
  EventContextSchema,
  EventIdSchema,
  TenantIdSchema,
  ZoneIdSchema,
  file_spine_options,
} from "@spine-event-engine/proto";
import {
  QueryIdSchema,
  QuerySchema,
  TargetFiltersSchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import {
  Aggregate,
  Projection,
  Repository,
  defineEntityHandlers,
} from "@spine-event-engine/server";
import { readFileSync } from "node:fs";

const testingDescriptorSetBase64 = [
  ...readFileSync(
    new URL("./fixtures/entity-metadata-fixture.ts", import.meta.url),
    "utf8",
  ).matchAll(/"([^"]+)"/g),
]
  .map((match) => match[1])
  .join("");
const fixtureFile = descriptor(testingDescriptorSetBase64);
const ProjectionStateSchema = messageDesc(fixtureFile, 0);
const AggregateStateSchema = messageDesc(fixtureFile, 1);
const EventStateSchema = messageDesc(fixtureFile, 2);

class TaskAggregate extends Aggregate {
  assignTask(command) {
    return packEvent({
      id: create(EventIdSchema, { value: `event-${command.id}` }),
      context: create(EventContextSchema),
      schema: ProjectionStateSchema,
      message: state(command.id, command.name),
    });
  }
  applyTask(event) {
    this.startTransaction();
    this.update((draft) =>
      Object.assign(draft, create(AggregateStateSchema, { id: event.id, name: event.name })),
    );
    this.commitTransaction();
  }
}
class TaskProjection extends Projection {
  subscribeTask(event) {
    this.update((draft) =>
      Object.assign(draft, state(event.id, `${event.name} (projected)`, event.priority + 1)),
    );
  }
}

/** Register the runner-neutral BlackBox contract with any `(name, body)` test API. */
export function registerBlackBoxContract(test, testing) {
  const { BlackBox, BlackBoxClosedError, BlackBoxTimeoutError } = testing;
  test("posts a command then eventually sends a query and decodes its projection", async () => {
    const blackBox = await BlackBox.from(taskContext());
    try {
      const scope = blackBox.asGuest();
      const posted = await scope.post(
        AggregateStateSchema,
        create(AggregateStateSchema, { id: "task-1", name: "First" }),
      );
      if (posted.kind !== "ok") throw new Error("command was not accepted");
      const result = await blackBox.eventually(
        () => scope.send(query("task-1")),
        (candidate) => candidate.message.length === 1,
      );
      const first = unpackAny(result.message[0]?.state, ProjectionStateSchema);
      if (first?.name !== "First (projected)") throw new Error("projection was not immutable");
    } finally {
      await blackBox.close();
    }
  });

  test("activates a raw projection topic and decodes its update with the schema", async () => {
    const blackBox = await BlackBox.from(taskContext());
    try {
      const scope = blackBox.asGuest();
      const subscription = await scope.createSubscription(
        topic(ProjectionStateSchema),
        entityOptions(),
      );
      const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();
      await subscription.activate();
      const connecting = await lifecycle.next();
      const connected = await lifecycle.next();
      if (
        connecting.done ||
        connecting.value.state !== "connecting" ||
        connected.done ||
        connected.value.state !== "connected"
      ) {
        throw new Error("state subscription did not expose its lifecycle transitions");
      }
      const next = subscription.updates[Symbol.asyncIterator]().next();
      const posted = await scope.post(
        AggregateStateSchema,
        create(AggregateStateSchema, { id: "task-state", name: "State" }),
      );
      if (posted.kind !== "ok") throw new Error("command was not accepted");
      const update = await next;
      if (
        update.done ||
        update.value.kind !== "update" ||
        update.value.update.update.case !== "entityUpdates" ||
        unpackAny(update.value.update.update.value.update[0]?.kind.value, ProjectionStateSchema)
          ?.name !== "State (projected)"
      ) {
        throw new Error("state subscription did not decode the projection update");
      }
      await subscription.cancel();
      const closed = await lifecycle.next();
      if (!closed.done) throw new Error("canceled lifecycle stream did not finish iteration");
    } finally {
      await blackBox.close();
    }
  });

  test("releases explicitly canceled and returned raw subscriptions before BlackBox close", async () => {
    const blackBox = await BlackBox.from(taskContext());
    try {
      const scope = blackBox.asGuest();
      const canceled = await scope.createSubscription(
        topic(ProjectionStateSchema),
        entityOptions(),
      );
      await canceled.activate();
      const originalCancel = canceled.cancel.bind(canceled);
      let cancellations = 0;
      canceled.cancel = async () => {
        cancellations += 1;
        await originalCancel();
      };
      const canceledIterator = canceled.updates[Symbol.asyncIterator]();
      await canceled.cancel();
      const exhausted = await canceledIterator.next();
      if (!exhausted.done) throw new Error("canceled state stream did not finish iteration");
      if (cancellations !== 1)
        throw new Error("explicit cancellation was not observed exactly once");
      const returned = await scope.createSubscription(
        topic(ProjectionStateSchema),
        entityOptions(),
      );
      await returned.activate();
      const returnedCancel = returned.cancel.bind(returned);
      let returnedCancellations = 0;
      returned.cancel = async () => {
        returnedCancellations += 1;
        await returnedCancel();
      };
      await returned.updates[Symbol.asyncIterator]().return();
      await blackBox.close();
      if (cancellations !== 1)
        throw new Error("BlackBox close canceled an explicitly canceled subscription again");
      if (returnedCancellations !== 1)
        throw new Error("BlackBox close canceled a returned subscription again");
    } finally {
      await blackBox.close();
    }
  });

  test("activates a raw event topic and decodes its update with the schema", async () => {
    const blackBox = await BlackBox.from(eventContext());
    try {
      const scope = blackBox.asGuest();
      const events = await scope.createSubscription(topic(EventStateSchema), { kind: "event" });
      await events.activate();
      const iterator = events.updates[Symbol.asyncIterator]();
      const pending = iterator.next();
      const update = await emitUntil(pending, () =>
        scope.postEvent(EventStateSchema, create(EventStateSchema, { id: "event-1" })),
      );
      if (
        update.done ||
        update.value.kind !== "update" ||
        update.value.update.update.case !== "eventUpdates" ||
        unpackAny(update.value.update.update.value.event[0]?.message, EventStateSchema)?.id !==
          "event-1" ||
        update.value.update.update.value.event[0]?.context === undefined
      ) {
        throw new Error("event subscription did not decode an immutable event context");
      }
      const originalCancel = events.cancel.bind(events);
      let cancellations = 0;
      events.cancel = async () => {
        cancellations += 1;
        await originalCancel();
      };
      await assertRejects(iterator.throw(new Error("stop events")), /stop events/);
      await blackBox.close();
      if (cancellations !== 1) throw new Error("thrown event stream was canceled more than once");
    } finally {
      await blackBox.close();
    }
  });

  test("imports a multitenant direct event with the selected actor tenant and zone", async () => {
    const contexts = [];
    const tenant = create(TenantIdSchema, { kind: { case: "value", value: "tenant-a" } });
    const zone = create(ZoneIdSchema, { value: "Europe/Lisbon" });
    const blackBox = await BlackBox.from(capturingContext("Imported", contexts, true), {
      tenant,
      zoneId: zone,
    });
    tenant.kind = { case: "value", value: "mutated" };
    zone.value = "mutated";
    try {
      await blackBox
        .onBehalfOf("alice")
        .postEvent(EventStateSchema, create(EventStateSchema, { id: "imported" }));
      const context = await blackBox.eventually(
        () => contexts[0],
        (value) => value !== undefined,
      );
      const imported = context.origin.value;
      if (
        context.origin.case !== "importContext" ||
        imported.actor?.value !== "alice" ||
        imported.tenantId?.kind.value !== "tenant-a" ||
        imported.zoneId?.value !== "Europe/Lisbon" ||
        imported.timestamp?.seconds === 0n
      ) {
        throw new Error("import context did not retain the selected actor tenant and zone");
      }
    } finally {
      await blackBox.close();
    }
  });

  test("keeps concurrent guest and actor direct-event contexts isolated with one fixed tenant and zone", async () => {
    const contexts = [];
    const blackBox = await BlackBox.from(capturingContext("Concurrent", contexts, true), {
      tenant: "tenant-a",
      zoneId: "Europe/Lisbon",
    });
    try {
      await Promise.all([
        blackBox.asGuest().postEvent(EventStateSchema, create(EventStateSchema, { id: "guest" })),
        blackBox
          .onBehalfOf("bob")
          .postEvent(EventStateSchema, create(EventStateSchema, { id: "actor" })),
      ]);
      const captured = await blackBox.eventually(
        () => contexts,
        (value) => value.length === 2,
      );
      const actors = captured.map((context) => context.origin.value.actor?.value).sort();
      if (
        actors.join(",") !== "bob,guest" ||
        captured.some(
          (context) =>
            context.origin.value.tenantId?.kind.value !== "tenant-a" ||
            context.origin.value.zoneId?.value !== "Europe/Lisbon",
        )
      ) {
        throw new Error("concurrent actor scopes leaked their fixed tenant or zone");
      }
    } finally {
      await blackBox.close();
    }
  });

  test("cancels an active eventual wait with the stable close error", async () => {
    const blackBox = await BlackBox.from(BoundedContext.singleTenant("WaitClose").build());
    let reads = 0;
    const waiting = blackBox.eventually(
      () => {
        reads += 1;
        return false;
      },
      (value) => value,
      { timeoutMs: 1_000, intervalMs: 100 },
    );
    const rejected = assertFailure(() => waiting, BlackBoxClosedError);
    await Promise.resolve();
    await blackBox.close();
    await rejected;
    const afterClose = reads;
    await Promise.resolve();
    if (reads !== afterClose) throw new Error("eventual read ran after close");
  });

  test("lets close win over an eventual read that resolves after close starts", async () => {
    const blackBox = await BlackBox.from(BoundedContext.singleTenant("ReadClose").build());
    let resolveRead;
    const reading = blackBox.eventually(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
      () => true,
    );
    await Promise.resolve();
    const closing = blackBox.close();
    resolveRead("resolved after close");
    await assertRejects(reading, BlackBoxClosedError);
    await closing;
  });

  test("rejects every captured scope operation after close before work begins", async () => {
    const blackBox = await BlackBox.from(BoundedContext.singleTenant("ScopeClose").build());
    const scope = blackBox.asGuest();
    await blackBox.close();
    await assertFailure(
      () => scope.post(AggregateStateSchema, create(AggregateStateSchema)),
      BlackBoxClosedError,
    );
    await assertFailure(() => scope.send(query("missing")), BlackBoxClosedError);
    await assertFailure(
      () => scope.createSubscription(topic(ProjectionStateSchema), entityOptions()),
      BlackBoxClosedError,
    );
    await assertFailure(
      () => scope.postEvent(EventStateSchema, create(EventStateSchema, { id: "closed" })),
      BlackBoxClosedError,
    );
  });

  test("owns one ephemeral public client/server session and closes idempotently", async () => {
    const blackBox = await BlackBox.from(BoundedContext.singleTenant("Testing").build());
    if (blackBox.asGuest() === undefined) throw new Error("guest scope was not created");
    await Promise.all([blackBox.close(), blackBox.close()]);
    assertThrows(() => blackBox.asGuest(), "BlackBox is closed.");
  });

  test("rejects eventual waits with the stable timeout error", async () => {
    const blackBox = await BlackBox.from(BoundedContext.singleTenant("Timeout").build());
    try {
      await assertRejects(
        blackBox.eventually(
          () => 1,
          () => false,
          { timeoutMs: 1, intervalMs: 1 },
        ),
        BlackBoxTimeoutError,
      );
    } finally {
      await blackBox.close();
    }
  });

  test("requires positive integer eventual timing values", async () => {
    const invalid = [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY];
    for (const value of invalid) {
      await assertRejects(
        BlackBox.from(BoundedContext.singleTenant(`Invalid-${String(value)}`).build(), {
          timeoutMs: value,
        }),
        /timeoutMs must be a positive integer/,
      );
      await assertRejects(
        BlackBox.from(BoundedContext.singleTenant(`Interval-${String(value)}`).build(), {
          intervalMs: value,
        }),
        /intervalMs must be a positive integer/,
      );
    }
    const blackBox = await BlackBox.from(BoundedContext.singleTenant("ValidTiming").build());
    try {
      await assertRejects(
        blackBox.eventually(
          () => false,
          (value) => value,
          { timeoutMs: 0.5 },
        ),
        /timeoutMs must be a positive integer/,
      );
      await assertRejects(
        blackBox.eventually(
          () => false,
          (value) => value,
          { intervalMs: 0.5 },
        ),
        /intervalMs must be a positive integer/,
      );
    } finally {
      await blackBox.close();
    }
  });

  test("validates tenant mode before opening a listener", async () => {
    await assertRejects(
      BlackBox.from(BoundedContext.singleTenant("Single").build(), { tenant: "tenant" }),
      /single-tenant context rejects a tenant/,
    );
    await assertRejects(
      BlackBox.from(BoundedContext.multitenant("Multi").build()),
      /multitenant context requires a tenant/,
    );
    await assertRejects(
      BlackBox.from(BoundedContext.multitenant("EmptyStringTenant").build(), { tenant: "" }),
      /tenant must not be empty/,
    );
    await assertRejects(
      BlackBox.from(BoundedContext.multitenant("EmptyMessageTenant").build(), {
        tenant: create(TenantIdSchema),
      }),
      /tenant must not be empty/,
    );
    await assertRejects(
      BlackBox.from(BoundedContext.singleTenant("EmptyStringZone").build(), { zoneId: "" }),
      /zoneId must not be empty/,
    );
    await assertRejects(
      BlackBox.from(BoundedContext.singleTenant("EmptyMessageZone").build(), {
        zoneId: create(ZoneIdSchema),
      }),
      /zoneId must not be empty/,
    );
  });

  test("snapshots mutable options before a deferred context build", async () => {
    const contexts = [];
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const builder = {
      isMultitenant: () => true,
      buildAsync: async () => {
        await gate;
        return capturingContext("Deferred", contexts, true);
      },
    };
    const tenant = create(TenantIdSchema, { kind: { case: "value", value: "before" } });
    const zone = create(ZoneIdSchema, { value: "Europe/Lisbon" });
    const options = { tenant, zoneId: zone, timeoutMs: 25, intervalMs: 1 };
    const opening = BlackBox.from(builder, options);
    tenant.kind = { case: "value", value: "after" };
    zone.value = "after";
    options.timeoutMs = 0;
    options.intervalMs = 0;
    release();
    const blackBox = await opening;
    try {
      await blackBox
        .asGuest()
        .postEvent(EventStateSchema, create(EventStateSchema, { id: "deferred" }));
      const context = await blackBox.eventually(
        () => contexts[0],
        (value) => value !== undefined,
      );
      if (
        context.origin.value.tenantId?.kind.value !== "before" ||
        context.origin.value.zoneId?.value !== "Europe/Lisbon"
      ) {
        throw new Error("deferred build observed mutable options");
      }
    } finally {
      await blackBox.close();
    }
  });

  test("resolves one default zone for the BlackBox client and direct-event context", async () => {
    let resolutions = 0;
    const original = Intl.DateTimeFormat;
    Object.defineProperty(Intl, "DateTimeFormat", {
      configurable: true,
      value: () => ({
        resolvedOptions: () => ({
          timeZone: resolutions++ === 0 ? "Europe/Lisbon" : "America/New_York",
        }),
      }),
    });
    const contexts = [];
    try {
      const blackBox = await BlackBox.from(capturingContext("DefaultZone", contexts, false));
      try {
        await blackBox
          .asGuest()
          .postEvent(EventStateSchema, create(EventStateSchema, { id: "zone" }));
        const context = await blackBox.eventually(
          () => contexts[0],
          (value) => value !== undefined,
        );
        if (context.origin.value.zoneId?.value !== "Europe/Lisbon")
          throw new Error("direct event did not retain the first default zone");
        if (resolutions !== 1) throw new Error("BlackBox and its client resolved different zones");
      } finally {
        await blackBox.close();
      }
    } finally {
      Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, value: original });
    }
  });
}

function taskContext() {
  return BoundedContext.singleTenant("Tasks")
    .add(
      new Repository({
        entityType: TaskAggregate,
        schema: AggregateStateSchema,
        handlers: defineEntityHandlers(TaskAggregate, AggregateStateSchema, (builder) => [
          builder.assign(AggregateStateSchema, "assignTask"),
          builder.apply(ProjectionStateSchema, "applyTask"),
        ]),
      }),
    )
    .add(
      new Repository({
        entityType: TaskProjection,
        schema: ProjectionStateSchema,
        handlers: defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
          builder.subscribe(ProjectionStateSchema, "subscribeTask"),
        ]),
      }),
    )
    .build();
}
function eventContext() {
  return BoundedContext.singleTenant("Events")
    .addEventDispatcher({
      messageSchemas: () => [EventStateSchema],
      dispatch: () => Promise.resolve(),
    })
    .build();
}
function capturingContext(name, contexts, multitenant) {
  const builder = multitenant
    ? BoundedContext.multitenant(name)
    : BoundedContext.singleTenant(name);
  return builder
    .addEventDispatcher({
      messageSchemas: () => [EventStateSchema],
      dispatch: (event) => {
        contexts.push(event.context);
        return Promise.resolve();
      },
    })
    .build();
}
function query(id) {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: `q-${id}` }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(ProjectionStateSchema),
      criterion:
        id === undefined
          ? { case: "includeAll", value: true }
          : {
              case: "filters",
              value: create(TargetFiltersSchema, {
                idFilter: {
                  id: [packAny(StringValueSchema, create(StringValueSchema, { value: id }))],
                },
              }),
            },
    }),
  });
}
function entityOptions() {
  return { kind: "entity", authoritativeQuery: () => query() };
}
function topic(schema) {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: `topic-${schema.typeName}` }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(schema),
      criterion: { case: "includeAll", value: true },
    }),
  });
}
function state(id, name, priority = 1) {
  return create(ProjectionStateSchema, { id, name, priority });
}
function descriptor(base64) {
  const set = fromBinary(FileDescriptorSetSchema, Buffer.from(base64, "base64"));
  const file = set.file[0];
  if (file === undefined) throw new Error("fixture missing");
  return fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, file)).toString("base64"), [
    file_spine_options,
  ]);
}
async function emitUntil(pending, emit) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    await emit();
    const attempted = await Promise.race([
      pending.then((value) => ({ value })),
      new Promise((resolve) => setTimeout(resolve, 5)),
    ]);
    if (attempted !== undefined) return attempted.value;
  }
  throw new Error("Timed out waiting for event subscription update.");
}

function assertThrows(operation, message) {
  try {
    operation();
  } catch (error) {
    if (error instanceof Error && error.message === message) return;
    throw error;
  }
  throw new Error(`Expected throw: ${message}`);
}
async function assertRejects(promise, expected) {
  try {
    await promise;
  } catch (error) {
    if (typeof expected === "function" ? error instanceof expected : expected.test(String(error)))
      return;
    throw error;
  }
  throw new Error("Expected rejection.");
}
async function assertFailure(operation, expected) {
  try {
    await operation();
  } catch (error) {
    if (typeof expected === "function" ? error instanceof expected : expected.test(String(error)))
      return;
    throw error;
  }
  throw new Error("Expected failure.");
}
