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
import { AnyMessages } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  VersionSchema,
  type TenantId,
} from "@spine-event-engine/proto";
import {
  EventStore,
  InMemoryStorageFactory,
  type RecordSpec,
  type RecordStorage,
  type StorageContext,
  type StorageGroup,
} from "@spine-event-engine/storage";
import { describe, expect, it, vi } from "vitest";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { TaskCreatedSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";

import { BoundedContext, Server, type EventDispatcher } from "../../src/index.js";
import { boundedContextAccess } from "../../src/context/bounded-context.js";
import { tenant } from "../tenant-fixture.js";

describe("known committed Event repair", () => {
  it("returns ordered exact-ID outcomes and retries one failed recipient without changing the Event", async () => {
    const factory = new InMemoryStorageFactory();
    const observed: string[] = [];
    const dispatcher: EventDispatcher = {
      messageSchemas: () => [TaskCreatedSchema],
      dispatch: (event) => {
        observed.push(event.id?.value ?? "missing");
        if (observed.length === 1) throw new Error("temporary recipient fault");
        return Promise.resolve();
      },
    };
    const context = BoundedContext.singleTenant("RepairTasks")
      .withStorageFactory(factory)
      .addEventDispatcher(dispatcher)
      .build();
    const store = new EventStore({ name: "RepairTasks", multitenant: false }, factory);
    await store.append(committedEvent("repair-1"));

    await expect(
      context.republishEvents({ eventIds: ["missing-id", "repair-1"] }),
    ).resolves.toMatchObject([
      { eventId: "missing-id", status: "NOT_FOUND" },
      { eventId: "repair-1", status: "ADMITTED", attempts: 2 },
    ]);
    expect(observed).toEqual(["repair-1", "repair-1"]);
    await expect(store.read()).resolves.toHaveLength(1);
    await context.close();
  });

  it("validates the bounded exact-ID list before any repair dispatch", async () => {
    const context = BoundedContext.singleTenant("RepairValidation").build();
    await expect(context.republishEvents({ eventIds: [] })).rejects.toThrow();
    await expect(context.republishEvents({ eventIds: [" "] })).rejects.toThrow();
    await expect(context.republishEvents({ eventIds: ["a", "a"] })).rejects.toThrow();
    await expect(
      context.republishEvents({
        eventIds: Array.from({ length: 101 }, (_, index) => String(index)),
      }),
    ).rejects.toThrow();
    await expect(
      context.republishEvents({ eventIds: ["a"], tenantId: tenant("tenant-a") }),
    ).rejects.toThrow();
    await context.close();
  });

  it("requires a tenant for multitenant repair and never reads another tenant's ID", async () => {
    const factory = new InMemoryStorageFactory();
    const observed: string[] = [];
    const context = BoundedContext.multitenant("TenantRepair")
      .withStorageFactory(factory)
      .addEventDispatcher({
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: (event) => {
          observed.push(event.id?.value ?? "missing");
          return Promise.resolve();
        },
      })
      .build();
    const tenantA = tenant("tenant-a");
    const tenantB = tenant("tenant-b");
    const store = new EventStore(
      { name: "TenantRepair", multitenant: true, tenantId: tenantA },
      factory,
    );
    await store.append(committedEvent("tenant-event", tenantA));

    await expect(context.republishEvents({ eventIds: ["tenant-event"] })).rejects.toThrow();
    await expect(
      context.republishEvents({ eventIds: ["tenant-event"], tenantId: tenantB }),
    ).resolves.toMatchObject([{ eventId: "tenant-event", status: "NOT_FOUND" }]);
    expect(observed).toEqual([]);
    await context.close();
  });

  it("reports cancellation for remaining IDs and rejects repair after close", async () => {
    const factory = new InMemoryStorageFactory();
    const controller = new AbortController();
    const context = BoundedContext.singleTenant("CancelledRepair")
      .withStorageFactory(factory)
      .addEventDispatcher({
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: () => {
          controller.abort();
          throw new Error("recipient fault");
        },
      })
      .build();
    const store = new EventStore({ name: "CancelledRepair", multitenant: false }, factory);
    await store.appendAll([committedEvent("first"), committedEvent("second")]);
    await expect(
      context.republishEvents({ eventIds: ["first", "second"], signal: controller.signal }),
    ).resolves.toMatchObject([
      { eventId: "first", status: "CANCELLED" },
      { eventId: "second", status: "CANCELLED" },
    ]);
    await context.close();
    await expect(context.republishEvents({ eventIds: ["first"] })).rejects.toThrow(/closed/i);
  });

  it("reports exhaustion without exposing recipient details, retaining partial recipient effects", async () => {
    const factory = new InMemoryStorageFactory();
    let firstRecipientCalls = 0;
    let failedRecipientCalls = 0;
    const context = BoundedContext.singleTenant("PartialRepair")
      .withStorageFactory(factory)
      .addEventDispatcher({
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: () => {
          firstRecipientCalls += 1;
          return Promise.resolve();
        },
      })
      .addEventDispatcher({
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: () => {
          failedRecipientCalls += 1;
          throw new Error("private recipient detail");
        },
      })
      .build();
    const store = new EventStore({ name: "PartialRepair", multitenant: false }, factory);
    await store.append(committedEvent("partial-event"));

    const result = await context.republishEvents({ eventIds: ["partial-event"] });
    expect(result).toEqual([{ eventId: "partial-event", status: "FAILED", attempts: 3 }]);
    expect(firstRecipientCalls).toBe(3);
    expect(failedRecipientCalls).toBe(3);
    expect(JSON.stringify(result)).not.toContain("private recipient detail");
    await context.close();
  });

  it("cancels an entered dispatch during close and leaves subsequent IDs unattempted", async () => {
    const factory = new InMemoryStorageFactory();
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const seen: string[] = [];
    const context = BoundedContext.singleTenant("ClosingRepair")
      .withStorageFactory(factory)
      .addEventDispatcher({
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: async (event) => {
          seen.push(event.id?.value ?? "missing");
          entered.resolve(undefined);
          await release.promise;
        },
      })
      .build();
    const store = new EventStore({ name: "ClosingRepair", multitenant: false }, factory);
    await store.appendAll([committedEvent("entered"), committedEvent("unattempted")]);

    const repair = context.republishEvents({ eventIds: ["entered", "unattempted"] });
    await entered.promise;
    const closed = context.close();
    release.resolve(undefined);
    await expect(repair).resolves.toEqual([
      { eventId: "entered", status: "CANCELLED", attempts: 1 },
      { eventId: "unattempted", status: "CANCELLED", attempts: 0 },
    ]);
    await expect(closed).resolves.toBeUndefined();
    expect(seen).toEqual(["entered"]);
  });

  it("cancels an entered exact-ID read without waiting for the storage query", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    class PausedReadFactory extends InMemoryStorageFactory {
      pause = false;

      protected override onCreateRecordStorage<I, R extends Message>(
        context: StorageContext,
        spec: RecordSpec<I, R>,
        group?: StorageGroup,
      ): RecordStorage<I, R> {
        const storage = super.onCreateRecordStorage(context, spec, group);
        if (!this.pause) return storage;
        return new Proxy(storage, {
          get(target, property, receiver) {
            if (property === "query")
              return async (...args: Parameters<typeof target.query>) => {
                entered.resolve(undefined);
                await release.promise;
                return target.query(...args);
              };
            const value: unknown = Reflect.get(target, property, receiver);
            if (typeof value === "function") {
              const bound: unknown = value.bind(target);
              return bound;
            }
            return value;
          },
        });
      }
    }
    const factory = new PausedReadFactory();
    const context = BoundedContext.singleTenant("ReadCancellation")
      .withStorageFactory(factory)
      .build();
    const store = new EventStore({ name: "ReadCancellation", multitenant: false }, factory);
    await store.append(committedEvent("paused-read"));
    factory.pause = true;
    const controller = new AbortController();
    const repair = context.republishEvents({
      eventIds: ["paused-read"],
      signal: controller.signal,
    });
    await entered.promise;
    controller.abort();
    try {
      await expect(
        Promise.race([
          repair,
          new Promise((resolve) =>
            setTimeout(() => {
              resolve("timed-out");
            }, 25),
          ),
        ]),
      ).resolves.toEqual([{ eventId: "paused-read", status: "CANCELLED", attempts: 0 }]);
    } finally {
      release.resolve(undefined);
      await context.close();
    }
  });

  it("bounds close while a repaired recipient never settles", async () => {
    const factory = new InMemoryStorageFactory();
    const entered = Promise.withResolvers<undefined>();
    const context = BoundedContext.singleTenant("RepairShutdownBound")
      .withStorageFactory(factory)
      .withShutdownTimeout(20)
      .addEventDispatcher({
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: () => {
          entered.resolve(undefined);
          return new Promise<undefined>(() => undefined);
        },
      })
      .build();
    const store = new EventStore({ name: "RepairShutdownBound", multitenant: false }, factory);
    await store.append(committedEvent("never-settles"));

    const repair = context.republishEvents({ eventIds: ["never-settles"] });
    await entered.promise;
    const close = context.close();
    const result = await Promise.race([
      close.then(
        () => "closed",
        () => "failed",
      ),
      new Promise<string>((resolve) =>
        setTimeout(() => {
          resolve("timed-out");
        }, 100),
      ),
    ]);
    expect(result).toBe("failed");
    await expect(close).rejects.toBeInstanceOf(AggregateError);
    expect(context.close()).toBe(close);
    await expect(repair).resolves.toEqual([
      { eventId: "never-settles", status: "CANCELLED", attempts: 1 },
    ]);
  });

  it("validates the configured shutdown budget", () => {
    const builder = BoundedContext.singleTenant("ShutdownValidation");
    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])
      expect(() => builder.withShutdownTimeout(invalid)).toThrow(RangeError);
  });

  it("keeps the first begin-close deadline across a later close call", async () => {
    const context = BoundedContext.singleTenant("SharedCloseDeadline")
      .withShutdownTimeout(10)
      .build();
    boundedContextAccess.beginClose(context);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const error = await context.close().then(
      () => {
        throw new Error("Expected the initial deadline to expire.");
      },
      (failure: unknown) => failure as AggregateError,
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toContainEqual(expect.objectContaining({ code: "SHUTDOWN_TIMEOUT" }));
  });

  it("clears graceful close timers once all work settles", async () => {
    vi.useFakeTimers();
    try {
      const context = BoundedContext.singleTenant("GracefulCloseTimers").build();
      await context.close();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fences queued ordinary Event work after the deadline without releasing its queue early", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const seen: string[] = [];
    const context = BoundedContext.singleTenant("QueuedShutdown")
      .withShutdownTimeout(20)
      .addEventDispatcher({
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: async (event) => {
          seen.push(event.id?.value ?? "missing");
          if (event.id?.value === "blocked") {
            entered.resolve(undefined);
            await release.promise;
          }
        },
      })
      .build();
    const first = context.eventBus().post(committedEvent("blocked"));
    await entered.promise;
    const second = context.eventBus().post(committedEvent("queued"));
    const firstRejected = expect(first).rejects.toThrow();
    const secondRejected = expect(second).rejects.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    await expect(context.close()).rejects.toBeInstanceOf(AggregateError);
    expect(seen).toEqual(["blocked"]);
    release.resolve(undefined);
    await firstRejected;
    await secondRejected;
    expect(seen).toEqual(["blocked"]);
  });

  it("uses the same deadline in server split-close and still closes independent resources", async () => {
    const factory = new InMemoryStorageFactory();
    const entered = Promise.withResolvers<undefined>();
    const context = BoundedContext.singleTenant("ServerRepairShutdown")
      .withStorageFactory(factory)
      .withShutdownTimeout(20)
      .addEventDispatcher({
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: () => {
          entered.resolve(undefined);
          return new Promise<undefined>(() => undefined);
        },
      })
      .build();
    const store = new EventStore({ name: "ServerRepairShutdown", multitenant: false }, factory);
    await store.append(committedEvent("server-hung"));
    let resourceClosed = false;
    const server = await Server.atPort(0)
      .add(context)
      .addResource({
        close: () => {
          resourceClosed = true;
        },
      })
      .start();
    const repair = context.republishEvents({ eventIds: ["server-hung"] });
    await entered.promise;

    const closeError = await server.close().then(
      () => {
        throw new Error("Expected server close timeout.");
      },
      (error: unknown) => error as AggregateError,
    );
    expect(closeError).toBeInstanceOf(AggregateError);
    expect(closeError.errors).toHaveLength(2);
    expect(resourceClosed).toBe(true);
    await expect(repair).resolves.toEqual([
      { eventId: "server-hung", status: "CANCELLED", attempts: 1 },
    ]);
    await expect(context.close()).rejects.toBeInstanceOf(AggregateError);
  });
});

function committedEvent(value: string, tenantId?: TenantId) {
  const taskId = create(TaskIdSchema, { value: "task-1" });
  return create(EventSchema, {
    id: create(EventIdSchema, { value }),
    context: create(EventContextSchema, {
      producerId: AnyMessages.pack(TaskIdSchema, taskId),
      version: create(VersionSchema, { number: 1 }),
      ...(tenantId === undefined
        ? {}
        : { origin: { case: "importContext", value: createActorContext(tenantId) } }),
    }),
    message: AnyMessages.pack(
      TaskCreatedSchema,
      create(TaskCreatedSchema, {
        id: taskId,
        title: "Task",
        taskListId: create(TaskListIdSchema, { value: "list-1" }),
      }),
    ),
  });
}

function createActorContext(tenantId: TenantId) {
  return create(ActorContextSchema, { tenantId });
}
