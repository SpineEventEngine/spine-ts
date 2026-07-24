import { create, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { deriveTypeUrl, packAny, packCommand } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandSchema,
  CommandContextSchema,
  CommandIdSchema,
  UserIdSchema,
  file_spine_options,
} from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";
import { fromBinary, toBinary } from "@bufbuild/protobuf";

import { CommandBus, type CommandDispatcher } from "../../src/index.js";
import { commandBusAccess } from "../../src/bus/command-bus.js";
import { CommandValidationError } from "../../src/bus/command-errors.js";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

type ProjectionState = Message<"ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

type AggregateState = Message<"AggregateState"> & {
  id: string;
  name: string;
  archived: boolean;
};

type ValidatedTaskCommand = Message<"example.validation_refusal.ValidatedTaskCommand"> & {
  id: string;
  name: string;
};

function createFixtureFileDescriptor(descriptorSetBase64: string, imports = [file_spine_options]) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Command bus fixture descriptor set is empty.");
  }

  return fileDesc(
    Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"),
    imports,
  );
}

const fileEntityMetadataFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.main.descriptorSetBase64,
);
const ProjectionStateSchema = messageDesc(
  fileEntityMetadataFixture,
  0,
) as GenMessage<ProjectionState>;
const AggregateStateSchema = messageDesc(
  fileEntityMetadataFixture,
  1,
) as GenMessage<AggregateState>;
const fileValidationRefusalFixture = fileDesc(
  "CiB2YWxpZGF0aW9uLXJlZnVzYWwvY29tbWFuZC5wcm90bxIaZXhhbXBsZS52YWxpZGF0aW9uX3JlZnVz" +
    "YWwaE3NwaW5lL29wdGlvbnMucHJvdG8ibAoXVmFsaWRhdGVkQWdncmVnYXRlU3RhdGUSFAoCaWQYASAB" +
    "KAlCBICGJAFSAmlkEhIKBG5hbWUYAiABKAlSBG5hbWU6J/qKJAQIARAD2oskGwoZZXhhbXBsZS50YWdz" +
    "LkFnZ3JlZ2F0ZVRhZyJAChRWYWxpZGF0ZWRUYXNrQ29tbWFuZBIOCgJpZBgBIAEoCVICaWQSGAoEbmFt" +
    "ZRgCIAEoCUIEoIUkAVIEbmFtZWIGcHJvdG8z",
  [file_spine_options],
);
const ValidatedTaskCommandSchema = messageDesc(
  fileValidationRefusalFixture,
  1,
) as GenMessage<ValidatedTaskCommand>;

describe("CommandBus", () => {
  it("posts commands asynchronously to exactly one matching dispatcher", async () => {
    const observed: string[] = [];
    const matching = createCommandDispatcher([ProjectionStateSchema], (command) => {
      observed.push(`matching:${command.id?.uuid ?? "missing"}`);
    });
    const other = createCommandDispatcher([AggregateStateSchema], (command) => {
      observed.push(`other:${command.id?.uuid ?? "missing"}`);
    });
    const bus = new CommandBus([matching, other]);

    const completion = bus.post(createProjectionCommand("command-1"));

    observed.push("after-post");
    expect(observed).toEqual(["after-post"]);

    await completion;

    expect(observed).toEqual(["after-post", "matching:command-1"]);
  });

  it("rejects duplicate command dispatcher registration for one command message type", () => {
    const first = createCommandDispatcher([ProjectionStateSchema], () => undefined);
    const second = createCommandDispatcher([ProjectionStateSchema], () => undefined);
    const bus = new CommandBus();

    bus.register(first);

    expect(() => bus.register(second)).toThrow(
      `Duplicate command dispatcher for "${deriveTypeUrl(ProjectionStateSchema)}".`,
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
        return [ProjectionStateSchema];
      },
      dispatch: (command) => {
        observed.push(`dispatch:${command.id?.uuid ?? "missing"}`);
        return Promise.resolve();
      },
    };
    const bus = new CommandBus();

    expect(() => bus.register(dispatcher)).toThrow("command schema read failed");
    expect(bus.register(dispatcher)).toBe(dispatcher);

    await bus.post(createProjectionCommand("command-retry"));

    expect(observed).toEqual(["dispatch:command-retry"]);
  });

  it("deduplicates repeated schemas from one command dispatcher", async () => {
    const observed: string[] = [];
    const dispatcher = createCommandDispatcher(
      [ProjectionStateSchema, ProjectionStateSchema],
      (command) => {
        observed.push(`dispatch:${command.id?.uuid ?? "missing"}`);
      },
    );
    const bus = new CommandBus([dispatcher]);

    expect(bus.acceptedCommandTypes()).toEqual([deriveTypeUrl(ProjectionStateSchema)]);

    await bus.post(createProjectionCommand("command-deduplicated"));

    expect(observed).toEqual(["dispatch:command-deduplicated"]);
  });

  it("ignores registering the same command dispatcher twice", async () => {
    const observed: string[] = [];
    const dispatcher = createCommandDispatcher([ProjectionStateSchema], (command) => {
      observed.push(`dispatch:${command.id?.uuid ?? "missing"}`);
    });
    const bus = new CommandBus([dispatcher]);

    expect(bus.register(dispatcher)).toBe(dispatcher);

    await bus.post(createProjectionCommand("command-same-dispatcher"));

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
        return [ProjectionStateSchema];
      },
      dispatch: (command) => {
        observed.push(`dispatch:${command.id?.uuid ?? "missing"}`);
        return Promise.resolve();
      },
    };

    bus.register(dispatcher);
    await bus.post(createProjectionCommand("command-reentrant"));

    expect(observed).toEqual(["dispatch:command-reentrant"]);
  });

  it("rejects posting commands without a registered dispatcher", async () => {
    const bus = new CommandBus();

    await expect(bus.post(createProjectionCommand("command-2"))).rejects.toThrow(
      `No command dispatcher registered for "${deriveTypeUrl(ProjectionStateSchema)}".`,
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
    const command = createProjectionCommand("command-blank-message");
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
      messageSchemas: () => [ProjectionStateSchema, ValidatedTaskCommandSchema],
      dispatch: async (command) => {
        observed.push(command.id?.uuid ?? "missing");
        if (command.id?.uuid === "command-blocking") {
          await gate.promise;
        }
      },
    };
    const bus = new CommandBus([dispatcher]);

    const first = bus.post(createProjectionCommand("command-blocking"));
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
    const dispatcher = createCommandDispatcher([ProjectionStateSchema], async (command) => {
      observed.push(`outer:${command.id?.uuid ?? "missing"}`);
      await expect(context.bus?.post(createProjectionCommand("command-nested"))).rejects.toThrow(
        "Cannot enqueue runtime work from an active runtime work item.",
      );
      observed.push("after-rejection");
    });
    const bus = new CommandBus([dispatcher]);
    context.bus = bus;

    await bus.post(createProjectionCommand("command-3"));

    expect(observed).toEqual(["outer:command-3", "after-rejection"]);
  });

  it("rejects public and internal command intake after close", async () => {
    const bus = new CommandBus();

    await bus.close();
    await bus.close();

    await expect(bus.post(createProjectionCommand("command-after-close"))).rejects.toThrow(
      /closed/,
    );
    await expect(
      commandBusAccess.postInternal(bus, createProjectionCommand("command-internal-after-close")),
    ).rejects.toThrow(/closed/);
  });

  it("rejects internal command-bus access for non-command-bus values", () => {
    const bus = {} as CommandBus;

    expect(() =>
      commandBusAccess.postInternal(bus, createProjectionCommand("command-internal")),
    ).toThrow(/CommandBus instance/);
    expect(() => {
      commandBusAccess.beginClose(bus);
    }).toThrow(/CommandBus instance/);
    expect(() => commandBusAccess.drain(bus)).toThrow(/CommandBus instance/);
    expect(() => commandBusAccess.finishClose(bus)).toThrow(/CommandBus instance/);
    expect(() => commandBusAccess.acceptedWorkCount(bus)).toThrow(/CommandBus instance/);
  });
});

function createCommandDispatcher(
  schemas: readonly GenMessage<Message>[],
  onDispatch: (command: ReturnType<typeof createProjectionCommand>) => void | Promise<void>,
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

function createProjectionCommand(id: string) {
  return packCommand({
    id: create(CommandIdSchema, { uuid: id }),
    context: create(CommandContextSchema, {
      actorContext: create(ActorContextSchema, {
        actor: create(UserIdSchema, { value: "user-1" }),
      }),
    }),
    schema: ProjectionStateSchema,
    message: create(ProjectionStateSchema, {
      id: "task-1",
      name: "Task",
      priority: 1,
    }),
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
    message: packAny(
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
