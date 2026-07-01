import { create, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { deriveTypeUrl, packCommand } from "@spine-ts/core";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  UserIdSchema,
  file_spine_options,
} from "@spine-ts/proto";
import { describe, expect, it } from "vitest";
import { fromBinary, toBinary } from "@bufbuild/protobuf";

import { CommandBus, type CommandDispatcher } from "../../src/index.js";
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

  it("rejects posting commands without a registered dispatcher", async () => {
    const bus = new CommandBus();

    await expect(bus.post(createProjectionCommand("command-2"))).rejects.toThrow(
      `No command dispatcher registered for "${deriveTypeUrl(ProjectionStateSchema)}".`,
    );
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
