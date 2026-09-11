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
import { messageDesc } from "@bufbuild/protobuf/codegenv2";
import { TypeUrls, AnyMessages } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandSchema,
  CommandContextSchema,
  CommandIdSchema,
  EventIdSchema,
  EventSchema,
  UserIdSchema,
} from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import { CommandBus, type CommandDispatcher } from "../../src/index.js";
import { commandBusAccess } from "../../src/bus/command-bus.js";
import { eventBusAccess } from "../../src/bus/event-bus.js";
import { CommandValidationError } from "../../src/bus/command-errors.js";
import { SignalPublisher } from "../../src/runtime/signal-publisher.js";
import * as FixtureSchemas from "../../test-fixtures/schemas.js";

type TaskCommand = Message<"TaskCommand"> & {
  id: string;
  name: string;
};

type ProcessManagerTaskCommand = Message<"ProcessManagerTaskCommand"> & {
  id: string;
  name: string;
};

type ValidatedTaskCommand = Message<"example.validation_refusal.ValidatedTaskCommand"> & {
  id: string;
  name: string;
};

const fileHandlerRegistryCommandsFixture = FixtureSchemas.handlerRegistryCommandsFile;
const TaskCommandSchema = messageDesc(
  fileHandlerRegistryCommandsFixture,
  2,
) as GenMessage<TaskCommand>;
const ProcessManagerTaskCommandSchema = messageDesc(
  fileHandlerRegistryCommandsFixture,
  3,
) as GenMessage<ProcessManagerTaskCommand>;
const fileValidationRefusalFixture = FixtureSchemas.validationRefusalCommandFile;
const ValidatedTaskCommandSchema = messageDesc(
  fileValidationRefusalFixture,
  1,
) as GenMessage<ValidatedTaskCommand>;

describe("CommandBus", () => {
  it("posts commands asynchronously to exactly one matching dispatcher", async () => {
    const observed: string[] = [];
    const matching = createCommandDispatcher([TaskCommandSchema], (command) => {
      observed.push(`matching:${command.id?.uuid ?? "missing"}`);
    });
    const other = createCommandDispatcher([ProcessManagerTaskCommandSchema], (command) => {
      observed.push(`other:${command.id?.uuid ?? "missing"}`);
    });
    const bus = new CommandBus([matching, other]);

    const completion = bus.post(createTaskCommand("command-1"));

    observed.push("after-post");
    expect(observed).toEqual(["after-post"]);

    await completion;

    expect(observed).toEqual(["after-post", "matching:command-1"]);
  });

  it("rejects duplicate command dispatcher registration for one command message type", () => {
    const first = createCommandDispatcher([TaskCommandSchema], () => undefined);
    const second = createCommandDispatcher([TaskCommandSchema], () => undefined);
    const bus = new CommandBus();

    bus.register(first);

    expect(() => bus.register(second)).toThrow(
      `Duplicate command dispatcher for "${TypeUrls.derive(TaskCommandSchema)}".`,
    );
  });

  it("can retry registering a command dispatcher after schema collection fails", async () => {
    const observed: string[] = [];
    let attempts = 0;
    const dispatcher: CommandDispatcher = {
      messageSchemas: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("command schema read failed");
        }
        return [TaskCommandSchema];
      },
      dispatch: (command) => {
        observed.push(`dispatch:${command.id?.uuid ?? "missing"}`);
        return Promise.resolve();
      },
    };
    const bus = new CommandBus();

    expect(() => bus.register(dispatcher)).toThrow("command schema read failed");
    expect(bus.register(dispatcher)).toBe(dispatcher);

    await bus.post(createTaskCommand("command-retry"));

    expect(observed).toEqual(["dispatch:command-retry"]);
  });

  it("deduplicates repeated schemas from one command dispatcher", async () => {
    const observed: string[] = [];
    const dispatcher = createCommandDispatcher(
      [TaskCommandSchema, TaskCommandSchema],
      (command) => {
        observed.push(`dispatch:${command.id?.uuid ?? "missing"}`);
      },
    );
    const bus = new CommandBus([dispatcher]);

    expect(bus.acceptedCommandTypes()).toEqual([TypeUrls.derive(TaskCommandSchema)]);

    await bus.post(createTaskCommand("command-deduplicated"));

    expect(observed).toEqual(["dispatch:command-deduplicated"]);
  });

  it("ignores registering the same command dispatcher twice", async () => {
    const observed: string[] = [];
    const dispatcher = createCommandDispatcher([TaskCommandSchema], (command) => {
      observed.push(`dispatch:${command.id?.uuid ?? "missing"}`);
    });
    const bus = new CommandBus([dispatcher]);

    expect(bus.register(dispatcher)).toBe(dispatcher);

    await bus.post(createTaskCommand("command-same-dispatcher"));

    expect(observed).toEqual(["dispatch:command-same-dispatcher"]);
  });

  it("does not register the same command dispatcher twice during reentrant schema collection", async () => {
    const observed: string[] = [];
    const bus = new CommandBus();
    let reentered = false;
    const dispatcher: CommandDispatcher = {
      messageSchemas: () => {
        if (!reentered) {
          reentered = true;
          bus.register(dispatcher);
        }
        return [TaskCommandSchema];
      },
      dispatch: (command) => {
        observed.push(`dispatch:${command.id?.uuid ?? "missing"}`);
        return Promise.resolve();
      },
    };

    bus.register(dispatcher);
    await bus.post(createTaskCommand("command-reentrant"));

    expect(observed).toEqual(["dispatch:command-reentrant"]);
  });

  it("rejects posting commands without a registered dispatcher", async () => {
    const bus = new CommandBus();

    await expect(bus.post(createTaskCommand("command-2"))).rejects.toThrow(
      `No command dispatcher registered for "${TypeUrls.derive(TaskCommandSchema)}".`,
    );
  });

  it("rejects commands without a message", async () => {
    const bus = new CommandBus();

    await expect(
      bus.post(
        create(CommandSchema, {
          id: create(CommandIdSchema, { uuid: "command-without-message" }),
        }),
      ),
    ).rejects.toThrow(/command.message.typeUrl/);
  });

  it("rejects commands with a blank message type URL", async () => {
    const command = createTaskCommand("command-blank-message");
    const bus = new CommandBus();

    if (command.message !== undefined) {
      command.message.typeUrl = "";
    }

    await expect(bus.post(command)).rejects.toThrow(/command.message.typeUrl/);
  });

  it("rejects invalid command payloads before a custom dispatcher runs", async () => {
    const observed: string[] = [];
    const dispatcher = createValidatedCommandDispatcher((command) => {
      observed.push(command.id?.uuid ?? "missing");
    });
    const bus = new CommandBus([dispatcher]);

    await expect(
      bus.post(createValidatedCommand("command-invalid", "task-invalid", "")),
    ).rejects.toBeInstanceOf(CommandValidationError);

    expect(observed).toEqual([]);
  });

  it("rejects incompatible command payload bytes before a custom dispatcher runs", async () => {
    const observed: string[] = [];
    const dispatcher = createValidatedCommandDispatcher((command) => {
      observed.push(command.id?.uuid ?? "missing");
    });
    const command = createValidatedCommand("command-incompatible", "task-incompatible", "name");
    const bus = new CommandBus([dispatcher]);

    if (command.message !== undefined) {
      command.message.value = new Uint8Array([255]);
    }

    await expect(bus.post(command)).rejects.toBeInstanceOf(CommandValidationError);

    expect(observed).toEqual([]);
  });

  it("keeps validation queued behind earlier command dispatch", async () => {
    const gate = createSignal();
    const observed: string[] = [];
    const dispatcher: CommandDispatcher = {
      messageSchemas: () => [TaskCommandSchema, ValidatedTaskCommandSchema],
      dispatch: async (command) => {
        observed.push(command.id?.uuid ?? "missing");
        if (command.id?.uuid === "command-blocking") {
          await gate.promise;
        }
      },
    };
    const bus = new CommandBus([dispatcher]);

    const first = bus.post(createTaskCommand("command-blocking"));
    const second = bus.post(createValidatedCommand("command-queued-invalid", "task-invalid", ""));
    let secondSettled = false;
    void second.then(
      () => {
        secondSettled = true;
      },
      () => {
        secondSettled = true;
      },
    );

    await waitUntil(() => observed.includes("command-blocking"));
    await waitForRuntimeTurn();

    expect(secondSettled).toBe(false);
    expect(observed).toEqual(["command-blocking"]);

    gate.resolve();
    await first;
    await expect(second).rejects.toBeInstanceOf(CommandValidationError);
    expect(observed).toEqual(["command-blocking"]);
  });

  it("rejects nested posts from active command dispatch", async () => {
    const observed: string[] = [];
    const context: { bus?: CommandBus } = {};
    const dispatcher = createCommandDispatcher([TaskCommandSchema], async (command) => {
      observed.push(`outer:${command.id?.uuid ?? "missing"}`);
      await expect(context.bus?.post(createTaskCommand("command-nested"))).rejects.toThrow(
        "Cannot enqueue runtime work from an active runtime work item.",
      );
      observed.push("after-rejection");
    });
    const bus = new CommandBus([dispatcher]);
    context.bus = bus;

    await bus.post(createTaskCommand("command-3"));

    expect(observed).toEqual(["outer:command-3", "after-rejection"]);
  });

  it("queues an internal follow-up command after active command dispatch", async () => {
    const observed: string[] = [];
    const context: { bus?: CommandBus } = {};
    const dispatcher = createCommandDispatcher([ValidatedTaskCommandSchema], (command) => {
      observed.push(command.id?.uuid ?? "missing");
      if (command.id?.uuid === "command-outer") {
        const bus = context.bus;
        if (bus === undefined) throw new Error("Expected command bus.");
        void commandBusAccess.postInternalFollowUp(
          bus,
          createValidatedCommand("command-follow-up", "task-follow-up", "Follow up"),
        );
      }
    });
    const bus = new CommandBus([dispatcher]);
    context.bus = bus;

    await bus.post(createValidatedCommand("command-outer", "task-outer", "Outer"));
    await commandBusAccess.drain(bus);

    expect(observed).toEqual(["command-outer", "command-follow-up"]);
  });

  it("contains one produced command failure while admitting its later sibling", async () => {
    const observed: string[] = [];
    const bus = new CommandBus([
      createValidatedCommandDispatcher((command) => {
        observed.push(command.id?.uuid ?? "missing");
        if (command.id?.uuid === "command-failing") {
          throw new Error("produced command failed");
        }
      }),
    ]);
    const events = eventBusAccess.createForgettingBus();
    const publisher = new SignalPublisher(bus, events, events, "Tasks");

    void publisher.publishCommand(
      createValidatedCommand("command-failing", "task-failing", "Failing"),
    );
    void publisher.publishCommand(createValidatedCommand("command-later", "task-later", "Later"));
    await publisher.drain();

    expect(observed).toEqual(["command-failing", "command-later"]);
  });

  it("does not observe rejection dispatch as committed produced output", async () => {
    const bus = new CommandBus();
    const events = eventBusAccess.createForgettingBus();
    const publisher = new SignalPublisher(bus, events, events, "Tasks");
    const observed: string[] = [];
    publisher.observe({ onEvent: (event) => observed.push(event.id?.value ?? "missing") });

    await publisher.publishRejectionEvent(
      create(EventSchema, { id: create(EventIdSchema, { value: "rejected" }) }),
    );
    await publisher.publishEvent(
      create(EventSchema, { id: create(EventIdSchema, { value: "committed" }) }),
    );
    await publisher.drain();

    expect(observed).toEqual(["committed"]);
  });

  it("allows an event-only observer while publishing a produced command", async () => {
    const observed: string[] = [];
    const bus = new CommandBus([
      createValidatedCommandDispatcher((command) => {
        observed.push(command.id?.uuid ?? "missing");
      }),
    ]);
    const events = eventBusAccess.createForgettingBus();
    const publisher = new SignalPublisher(bus, events, events, "Tasks");
    publisher.observe({ onEvent: () => observed.push("unexpected-event") });

    await publisher.publishCommand(
      createValidatedCommand("command-observed", "task-observed", "Observed"),
    );
    await publisher.drain();

    expect(observed).toEqual(["command-observed"]);
  });

  it("drains a gated produced command admitted while closing and contains post-finish rejection", async () => {
    const gate = createSignal();
    const observed: string[] = [];
    const bus = new CommandBus([
      createValidatedCommandDispatcher(async (command) => {
        observed.push(command.id?.uuid ?? "missing");
        await gate.promise;
      }),
    ]);
    const events = eventBusAccess.createForgettingBus();
    const publisher = new SignalPublisher(bus, events, events, "Tasks");

    publisher.beginClose();
    commandBusAccess.beginClose(bus);
    const child = publisher.publishCommand(
      createValidatedCommand("command-closing-child", "task-closing-child", "Closing child"),
    );
    await waitUntil(() => observed.length === 1);

    let drained = false;
    const drain = publisher.drain().then(() => {
      drained = true;
    });
    await waitForRuntimeTurn();
    expect(drained).toBe(false);

    gate.resolve();
    await Promise.all([child, drain]);
    expect(observed).toEqual(["command-closing-child"]);

    publisher.finishClose();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      await expect(
        publisher.publishCommand(
          createValidatedCommand("command-after-publisher-finish", "task-finished", "Finished"),
        ),
      ).rejects.toThrow("SignalPublisher is closed.");
      await waitForRuntimeTurn();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      await commandBusAccess.finishClose(bus);
    }
  });

  it("rejects public and internal command intake after close", async () => {
    const bus = new CommandBus();

    await bus.close();
    await bus.close();

    await expect(
      bus.post(createValidatedCommand("command-after-close", "task-after-close", "After close")),
    ).rejects.toThrow(/closed/);
    await expect(
      commandBusAccess.postInternal(
        bus,
        createValidatedCommand("command-internal-after-close", "task-after-close", "After close"),
      ),
    ).rejects.toThrow(/closed/);
    await expect(
      commandBusAccess.postInternalFollowUp(
        bus,
        createValidatedCommand("command-follow-up-after-close", "task-follow-up", "Follow up"),
      ),
    ).rejects.toThrow(/closed/);
  });

  it("aborts an assembling command bus without leaving its runtime open", async () => {
    const bus = new CommandBus();

    commandBusAccess.abortClose(bus);

    await expect(
      commandBusAccess.postInternalFollowUp(
        bus,
        createValidatedCommand("command-aborted", "task-aborted", "Aborted"),
      ),
    ).rejects.toThrow(/closed/);
  });

  it("rejects internal command-bus access for non-command-bus values", () => {
    const bus = {} as CommandBus;

    expect(() =>
      commandBusAccess.postInternal(
        bus,
        createValidatedCommand("command-internal", "task-internal", "Internal"),
      ),
    ).toThrow(/CommandBus instance/);
    expect(() =>
      commandBusAccess.postInternalFollowUp(
        bus,
        createValidatedCommand("command-follow-up", "task-follow-up", "Follow up"),
      ),
    ).toThrow(/CommandBus instance/);
    expect(() => {
      commandBusAccess.beginClose(bus);
    }).toThrow(/CommandBus instance/);
    expect(() => {
      void commandBusAccess.drain(bus);
    }).toThrow(/CommandBus instance/);
    expect(() => {
      void commandBusAccess.finishClose(bus);
    }).toThrow(/CommandBus instance/);
    expect(() => {
      commandBusAccess.abortClose(bus);
    }).toThrow(/CommandBus instance/);
    expect(() => commandBusAccess.acceptedWorkCount(bus)).toThrow(/CommandBus instance/);
  });
});

function createCommandDispatcher(
  schemas: readonly GenMessage<Message>[],
  onDispatch: (command: ReturnType<typeof createTaskCommand>) => void | Promise<void>,
): CommandDispatcher {
  return {
    messageSchemas: () => schemas,
    dispatch: (command) => Promise.resolve(onDispatch(command)),
  };
}

function createValidatedCommandDispatcher(
  onDispatch: (command: ReturnType<typeof createValidatedCommand>) => void | Promise<void>,
): CommandDispatcher {
  return {
    messageSchemas: () => [ValidatedTaskCommandSchema],
    dispatch: (command) => Promise.resolve(onDispatch(command)),
  };
}

function createTaskCommand(id: string) {
  return create(CommandSchema, {
    id: create(CommandIdSchema, { uuid: id }),
    context: create(CommandContextSchema, {
      actorContext: create(ActorContextSchema, {
        actor: create(UserIdSchema, { value: "user-1" }),
      }),
    }),
    message: AnyMessages.pack(
      TaskCommandSchema,
      create(TaskCommandSchema, { id: "task-1", name: "Task" }),
    ),
  });
}

function createValidatedCommand(id: string, aggregateId: string, name: string) {
  return create(CommandSchema, {
    id: create(CommandIdSchema, { uuid: id }),
    context: create(CommandContextSchema, {
      actorContext: create(ActorContextSchema, {
        actor: create(UserIdSchema, { value: "user-1" }),
      }),
    }),
    message: AnyMessages.pack(
      ValidatedTaskCommandSchema,
      create(ValidatedTaskCommandSchema, {
        id: aggregateId,
        name,
      }),
      { validate: false },
    ),
  });
}

function createSignal() {
  let resolve!: () => void;
  const promise = new Promise<void>((fulfill) => {
    resolve = () => {
      fulfill();
    };
  });

  return { promise, resolve };
}

async function waitForRuntimeTurn(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await waitForRuntimeTurn();
  }
}
