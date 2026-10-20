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
import { AnyMessages, TypeUrls } from "@spine-event-engine/core";
import type { EventStore } from "@spine-event-engine/storage";
import {
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  MessageIdSchema,
  VersionSchema,
} from "@spine-event-engine/proto";
import { EntityOption_Kind } from "@spine-event-engine/proto/generated/spine/options_pb.js";
import { EntityCreatedSchema } from "@spine-event-engine/proto/generated/spine/system/server/entity_log_events_pb.js";
import { describe, expect, it, vi } from "vitest";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { TaskCreatedSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";
import { TaskSchema } from "../../../../examples/todo/generated/spine/examples/todo/tasks_pb.js";

import { CommandBus } from "../../src/bus/command-bus.js";
import { eventBusAccess } from "../../src/bus/event-bus.js";
import { SignalPublisher } from "../../src/runtime/signal-publisher.js";

describe("stored Event publication", () => {
  it("dispatches a committed Event once after recipient failure", async () => {
    const dispatch = vi.fn(() => {
      throw new Error("recipient unavailable");
    });
    const events = eventBusAccess.createForgettingBus([
      { messageSchemas: () => [TaskCreatedSchema], dispatch },
    ]);
    const publisher = new SignalPublisher(new CommandBus(), events, events, "Tasks");

    await expect(
      publisher.publishCommittedEvent(committedEvent("committed-1")),
    ).resolves.toBeUndefined();
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("does not append or dispatch a System Event again after partial fanout", async () => {
    const append = vi.fn<EventStore["acceptThenAppend"]>(async (event, accept) => {
      await accept(event);
      return event;
    });
    const store = { acceptThenAppend: append } as unknown as EventStore;
    const first = vi.fn(() => Promise.resolve());
    const second = vi.fn(() => {
      throw new Error("recipient unavailable");
    });
    const system = eventBusAccess.createSystemBus(store, [
      { messageSchemas: () => [EntityCreatedSchema], dispatch: first },
      { messageSchemas: () => [EntityCreatedSchema], dispatch: second },
    ]);
    const publisher = new SignalPublisher(new CommandBus(), system, system, "Tasks");

    await expect(publisher.publishSystemEvent(systemCreatedEvent())).resolves.toBeUndefined();
    expect(append).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it("contains an append failure without dispatching the System Event", async () => {
    const append = vi.fn(() => Promise.reject(new Error("storage unavailable")));
    const store = { acceptThenAppend: append } as unknown as EventStore;
    const dispatch = vi.fn(() => Promise.resolve());
    const system = eventBusAccess.createSystemBus(store, [
      { messageSchemas: () => [EntityCreatedSchema], dispatch },
    ]);
    const publisher = new SignalPublisher(new CommandBus(), system, system, "Tasks");

    await expect(publisher.publishSystemEvent(systemCreatedEvent())).resolves.toBeUndefined();
    expect(append).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("logs one contained failure without recipient details", async () => {
    const error = vi.fn();
    const withMetadata = vi.fn(() => ({ error }));
    const events = eventBusAccess.createForgettingBus([
      {
        messageSchemas: () => [TaskCreatedSchema],
        dispatch: () => {
          throw new Error("private recipient detail");
        },
      },
    ]);
    const publisher = new SignalPublisher(new CommandBus(), events, events, "Tasks");
    publisher.installLogger({ withMetadata } as never);

    await publisher.publishCommittedEvent(committedEvent("logged-event"));
    expect(withMetadata).toHaveBeenCalledOnce();
    expect(withMetadata).toHaveBeenCalledWith({
      contextName: "Tasks",
      eventId: "logged-event",
      eventType: TypeUrls.derive(TaskCreatedSchema),
      operation: "signal_publisher.handle",
      reasonCode: "handled_failure",
      errorName: "Error",
    });
    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith("Produced signal handling failed.");
    expect(JSON.stringify([withMetadata.mock.calls, error.mock.calls])).not.toContain(
      "private recipient detail",
    );
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

function systemCreatedEvent() {
  const entityId = create(TaskIdSchema, { value: "task-1" });
  return create(EventSchema, {
    id: create(EventIdSchema, { value: "created-task-1" }),
    message: AnyMessages.pack(
      EntityCreatedSchema,
      create(EntityCreatedSchema, {
        entity: create(MessageIdSchema, {
          id: AnyMessages.pack(TaskIdSchema, entityId),
          typeUrl: TypeUrls.derive(TaskSchema),
        }),
        kind: EntityOption_Kind.AGGREGATE,
      }),
    ),
  });
}
