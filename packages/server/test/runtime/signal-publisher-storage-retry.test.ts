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

import { create, toBinary } from "@bufbuild/protobuf";
import { AnyMessages, TypeUrls } from "@spine-event-engine/core";
import {
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  VersionSchema,
} from "@spine-event-engine/proto";
import { describe, expect, it, vi } from "vitest";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { TaskCreatedSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";

import { CommandBus } from "../../src/bus/command-bus.js";
import { eventBusAccess } from "../../src/bus/event-bus.js";
import { SignalPublisher } from "../../src/runtime/signal-publisher.js";

describe("stored Event publication", () => {
  it("retries actual dispatch with one committed ID and envelope before reporting admission", async () => {
    const observed: Uint8Array[] = [];
    const events = eventBusAccess.createForgettingBus([
      {
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: (event) => {
          observed.push(toBinary(EventSchema, event));
          if (observed.length < 3) throw new Error("recipient unavailable");
          return Promise.resolve();
        },
      },
    ]);
    const publisher = new SignalPublisher(new CommandBus(), events, events, "Tasks");
    const event = committedEvent("stored-1");

    await expect(publisher.publishCommittedEvent(event)).resolves.toMatchObject({
      status: "ADMITTED",
      eventId: "stored-1",
      attempts: 3,
    });
    expect(observed).toHaveLength(3);
    expect(observed[1]).toEqual(observed[0]);
    expect(observed[2]).toEqual(observed[0]);
  });

  it("reports exhausted dispatch with the original cause after finite attempts", async () => {
    const failure = new Error("private recipient detail");
    let calls = 0;
    const events = eventBusAccess.createForgettingBus([
      {
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: () => {
          calls += 1;
          throw failure;
        },
      },
    ]);
    const publisher = new SignalPublisher(new CommandBus(), events, events, "Tasks");

    await expect(
      publisher.publishCommittedEvent(committedEvent("stored-2")),
    ).resolves.toMatchObject({
      status: "FAILED",
      eventId: "stored-2",
      attempts: 3,
      cause: failure,
    });
    expect(calls).toBe(3);
  });

  it("stops a stored dispatch retry when its signal is cancelled", async () => {
    const controller = new AbortController();
    let calls = 0;
    const events = eventBusAccess.createForgettingBus([
      {
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: () => {
          calls += 1;
          controller.abort();
          throw new Error("first recipient failure");
        },
      },
    ]);
    const publisher = new SignalPublisher(new CommandBus(), events, events, "Tasks");

    await expect(
      publisher.publishCommittedEvent(committedEvent("stored-3"), { signal: controller.signal }),
    ).resolves.toMatchObject({
      status: "CANCELLED",
      eventId: "stored-3",
      attempts: 1,
    });
    expect(calls).toBe(1);
  });

  it("does not attempt a pre-cancelled Event and preserves completed admission", async () => {
    let calls = 0;
    const events = eventBusAccess.createForgettingBus([
      {
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: () => {
          calls += 1;
          return Promise.resolve();
        },
      },
    ]);
    const publisher = new SignalPublisher(new CommandBus(), events, events, "Tasks");
    const controller = new AbortController();
    controller.abort(new Error("caller cancelled"));
    await expect(
      publisher.redispatchStored(committedEvent("not-attempted"), { signal: controller.signal }),
    ).resolves.toMatchObject({ status: "CANCELLED", attempts: 0 });
    expect(calls).toBe(0);

    const afterCompletion = new AbortController();
    const completed = await publisher.redispatchStored(committedEvent("completed"), {
      signal: afterCompletion.signal,
    });
    afterCompletion.abort();
    expect(completed).toMatchObject({ status: "ADMITTED", attempts: 1 });
    expect(calls).toBe(1);
  });

  it("stops partial fanout between recipients when cancellation wins", async () => {
    const controller = new AbortController();
    let secondRecipientCalls = 0;
    const events = eventBusAccess.createForgettingBus([
      {
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: () => {
          controller.abort(new Error("caller cancelled"));
          return Promise.resolve();
        },
      },
      {
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: () => {
          secondRecipientCalls += 1;
          return Promise.resolve();
        },
      },
    ]);
    const publisher = new SignalPublisher(new CommandBus(), events, events, "Tasks");

    await expect(
      publisher.redispatchStored(committedEvent("partial-cancel"), { signal: controller.signal }),
    ).resolves.toMatchObject({ status: "CANCELLED", attempts: 1 });
    expect(secondRecipientCalls).toBe(0);
  });

  it("keeps the FIFO queue behind an entered dispatch after caller cancellation", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const seen: string[] = [];
    const controller = new AbortController();
    const events = eventBusAccess.createForgettingBus([
      {
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: async (event) => {
          seen.push(event.id?.value ?? "missing");
          if (event.id?.value === "blocked") {
            entered.resolve(undefined);
            await release.promise;
          }
        },
      },
    ]);
    const publisher = new SignalPublisher(new CommandBus(), events, events, "Tasks");
    const first = publisher.redispatchStored(committedEvent("blocked"), {
      signal: controller.signal,
    });
    await entered.promise;
    const second = publisher.redispatchStored(committedEvent("later"));
    controller.abort(new Error("caller cancelled"));
    await expect(first).resolves.toMatchObject({ status: "CANCELLED", attempts: 1 });
    await Promise.resolve();
    expect(seen).toEqual(["blocked"]);
    release.resolve(undefined);
    await expect(second).resolves.toMatchObject({ status: "ADMITTED", attempts: 1 });
    expect(seen).toEqual(["blocked", "later"]);
  });

  it("observes a late recipient rejection after cancellation without retrying it", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const controller = new AbortController();
    let calls = 0;
    const events = eventBusAccess.createForgettingBus([
      {
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: async () => {
          calls += 1;
          entered.resolve(undefined);
          await release.promise;
        },
      },
    ]);
    const publisher = new SignalPublisher(new CommandBus(), events, events, "Tasks");
    const publication = publisher.redispatchStored(committedEvent("late-rejection"), {
      signal: controller.signal,
    });
    await entered.promise;
    controller.abort(new Error("caller cancelled"));
    await expect(publication).resolves.toMatchObject({ status: "CANCELLED", attempts: 1 });
    release.reject(new Error("late recipient failure"));
    await eventBusAccess.drain(events);
    expect(calls).toBe(1);
  });

  it("removes per-attempt abort listeners after success and cancellation", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const events = eventBusAccess.createForgettingBus([
      {
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: async () => {
          entered.resolve(undefined);
          await release.promise;
        },
      },
    ]);
    const publisher = new SignalPublisher(new CommandBus(), events, events, "Tasks");
    const publication = publisher.redispatchStored(committedEvent("listener-cleanup"), {
      signal: controller.signal,
    });
    await entered.promise;
    controller.abort();
    await expect(publication).resolves.toMatchObject({ status: "CANCELLED", attempts: 1 });
    expect(add).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    release.resolve(undefined);
    await eventBusAccess.drain(events);
  });

  it("contains a detached publication fenced before its scheduled dispatch", async () => {
    let calls = 0;
    const events = eventBusAccess.createForgettingBus([
      {
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: () => {
          calls += 1;
          return Promise.resolve();
        },
      },
    ]);
    const publisher = new SignalPublisher(new CommandBus(), events, events, "Tasks");
    const pending = publisher.publishSystemEvent(committedEvent("fenced-detached"));
    publisher.finishClose();

    await expect(pending).resolves.toBeUndefined();
    expect(calls).toBe(0);
    await expect(publisher.redispatchStored(committedEvent("fenced-stored"))).rejects.toThrow(
      "SignalPublisher is closed",
    );
  });

  it("reports a non-Error cancellation reason without retrying an entered recipient", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const controller = new AbortController();
    let calls = 0;
    const events = eventBusAccess.createForgettingBus([
      {
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: async () => {
          calls += 1;
          entered.resolve(undefined);
          await release.promise;
        },
      },
    ]);
    const publisher = new SignalPublisher(new CommandBus(), events, events, "Tasks");
    const pending = publisher.redispatchStored(committedEvent("string-cancellation"), {
      signal: controller.signal,
    });
    await entered.promise;
    controller.abort("caller cancelled");

    await expect(pending).resolves.toMatchObject({
      status: "CANCELLED",
      attempts: 1,
      cause: "caller cancelled",
    });
    release.resolve(undefined);
    await eventBusAccess.drain(events);
    expect(calls).toBe(1);
  });

  it("contains a throwing diagnostics sink after stored dispatch exhaustion", async () => {
    const events = eventBusAccess.createForgettingBus([
      {
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: () => {
          throw new Error("recipient failed");
        },
      },
    ]);
    const publisher = new SignalPublisher(new CommandBus(), events, events, "Tasks");
    publisher.installLogger({
      withMetadata: () => {
        throw new Error("logger failed");
      },
    } as never);

    await expect(
      publisher.redispatchStored(committedEvent("throwing-logger")),
    ).resolves.toMatchObject({
      status: "FAILED",
      attempts: 3,
    });
  });

  it("logs correlated allowlisted facts once without recipient details or an arbitrary error name", async () => {
    const withMetadata = vi.fn(() => ({ error: vi.fn() }));
    const events = eventBusAccess.createForgettingBus([
      {
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: () => {
          throw Object.assign(new Error("private recipient detail"), { name: "PrivateSqlTable" });
        },
      },
    ]);
    const publisher = new SignalPublisher(new CommandBus(), events, events, "Tasks");
    publisher.installLogger({ withMetadata } as never);

    await expect(
      publisher.publishCommittedEvent(committedEvent("logged-event")),
    ).resolves.toMatchObject({
      status: "FAILED",
      attempts: 3,
    });
    expect(withMetadata).toHaveBeenCalledOnce();
    expect(withMetadata).toHaveBeenCalledWith({
      contextName: "Tasks",
      eventId: "logged-event",
      eventType: TypeUrls.derive(TaskCreatedSchema),
      operation: "signal_publisher.handle",
      reasonCode: "handled_failure",
    });
    expect(JSON.stringify(withMetadata.mock.calls)).not.toContain("private recipient detail");
    expect(JSON.stringify(withMetadata.mock.calls)).not.toContain("PrivateSqlTable");
  });

  it("uses a safe unknown type when a contained Command failure has no envelope", () => {
    const withMetadata = vi.fn(() => ({ error: vi.fn() }));
    const events = eventBusAccess.createForgettingBus([]);
    const publisher = new SignalPublisher(new CommandBus(), events, events, "Tasks");
    publisher.installLogger({ withMetadata } as never);

    publisher.reportFailure("command", undefined, new Error("private command detail"));

    expect(withMetadata).toHaveBeenCalledWith({
      contextName: "Tasks",
      commandId: "unknown",
      commandType: "unknown",
      operation: "signal_publisher.handle",
      reasonCode: "handled_failure",
      errorName: "Error",
    });
    expect(JSON.stringify(withMetadata.mock.calls)).not.toContain("private command detail");
  });
});

function committedEvent(value: string) {
  const id = create(TaskIdSchema, { value: "task-1" });
  return create(EventSchema, {
    id: create(EventIdSchema, { value }),
    context: create(EventContextSchema, {
      producerId: AnyMessages.pack(TaskIdSchema, id),
      version: create(VersionSchema, { number: 1 }),
    }),
    message: AnyMessages.pack(
      TaskCreatedSchema,
      create(TaskCreatedSchema, {
        id,
        title: "Task",
        taskListId: create(TaskListIdSchema, { value: "list-1" }),
      }),
    ),
  });
}
