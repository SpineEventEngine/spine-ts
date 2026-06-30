import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, expectTypeOf, it } from "vitest";
import { CommandSchema, file_spine_options } from "@spine-ts/proto";
import { serverEntityMetadataTestFixtures } from "../test-fixtures/entity-metadata-fixtures.js";

import {
  CommandRegistrationReadiness,
  defineEntityHandlers,
  HandlerMetadataRegistry,
  HandlerMetadataRegistryError,
  type CommandRegistrationAssigneeMetadata,
  type CommandRegistrationReadinessLookup,
} from "./index.js";

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

class TaskProjection {
  assignCreate(command: Message<"spine.core.Command">): void {
    void command;
  }

  assignArchive(command: Message<"AggregateState">): void {
    void command;
  }
}

class TaskAggregate {
  assignCreate(command: Message<"spine.core.Command">): void {
    void command;
  }
}

function createFixtureFileDescriptor(descriptorSetBase64: string, imports = [file_spine_options]) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Server command registration readiness fixture descriptor set is empty.");
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

describe("command registration readiness", () => {
  it("treats an empty handler registry as valid command readiness", () => {
    const readiness = CommandRegistrationReadiness.fromRegistry(new HandlerMetadataRegistry());

    expectTypeOf<CommandRegistrationReadiness>().toExtend<CommandRegistrationReadinessLookup>();
    expect(readiness.registeredCommandMessageFullTypeNames()).toEqual([]);
    expect(readiness.findCommandAssignee("spine.core.Command")).toBeUndefined();
    expect(Object.isFrozen(readiness.registeredCommandMessageFullTypeNames())).toBe(true);
  });

  it("lists registered command message full type names in deterministic order", () => {
    const handlers = defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
      builder.assign(AggregateStateSchema, "assignArchive"),
    ]);
    const readiness = CommandRegistrationReadiness.fromRegistry(
      new HandlerMetadataRegistry([handlers]),
    );

    expect(readiness.registeredCommandMessageFullTypeNames()).toEqual([
      "AggregateState",
      "spine.core.Command",
    ]);
  });

  it("finds the unique command assignee metadata for a command type", () => {
    const handlers = defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
    ]);
    const readiness = CommandRegistrationReadiness.fromEntityHandlers([handlers]);

    const assignee = readiness.findCommandAssignee(CommandSchema.typeName);

    expectTypeOf<
      NonNullable<typeof assignee>
    >().toEqualTypeOf<CommandRegistrationAssigneeMetadata>();
    expect(assignee).toMatchObject({
      commandFullTypeName: "spine.core.Command",
      entityType: TaskProjection,
      entity: {
        fullTypeName: "ProjectionState",
      },
      handler: {
        kind: "command-assignment",
        methodName: "assignCreate",
        messageFullTypeName: "spine.core.Command",
      },
    });
    expect(assignee?.registeredHandler.handler).toBe(handlers.commandAssignments[0]);
  });

  it("keeps duplicate command assignment failure owned by HandlerMetadataRegistry", () => {
    const first = defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
    ]);
    const second = defineEntityHandlers(TaskAggregate, AggregateStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
    ]);

    expect(() => CommandRegistrationReadiness.fromEntityHandlers([first, second])).toThrow(
      HandlerMetadataRegistryError,
    );
    expect(() => CommandRegistrationReadiness.fromEntityHandlers([first, second])).toThrow(
      /Duplicate command assignment for "spine\.core\.Command"/,
    );
  });

  it("returns frozen copy-safe command lists and assignee values", () => {
    const handlers = defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
    ]);
    const readiness = CommandRegistrationReadiness.fromEntityHandlers([handlers]);

    const firstList = readiness.registeredCommandMessageFullTypeNames();
    const secondList = readiness.registeredCommandMessageFullTypeNames();
    const firstAssignee = readiness.findCommandAssignee(CommandSchema.typeName);
    const secondAssignee = readiness.findCommandAssignee(CommandSchema.typeName);

    expect(firstList).toEqual(["spine.core.Command"]);
    expect(Object.isFrozen(firstList)).toBe(true);
    expect(firstList).not.toBe(secondList);
    expect(() => {
      (firstList as string[]).push("example.MutatedCommand");
    }).toThrow(TypeError);
    expect(readiness.registeredCommandMessageFullTypeNames()).toEqual(["spine.core.Command"]);

    expect(firstAssignee).toEqual(secondAssignee);
    expect(firstAssignee).not.toBe(secondAssignee);
    expect(Object.isFrozen(firstAssignee)).toBe(true);
    expect(() => {
      (firstAssignee as { commandFullTypeName: string }).commandFullTypeName =
        "example.MutatedCommand";
    }).toThrow(TypeError);
    expect(readiness.findCommandAssignee(CommandSchema.typeName)?.commandFullTypeName).toBe(
      "spine.core.Command",
    );
  });

  it("does not expose bus, service, dispatch, posting, routing, or acknowledgement members", () => {
    const readiness = CommandRegistrationReadiness.fromRegistry(new HandlerMetadataRegistry());

    expect(readiness).not.toHaveProperty("bus");
    expect(readiness).not.toHaveProperty("commandBus");
    expect(readiness).not.toHaveProperty("service");
    expect(readiness).not.toHaveProperty("commandService");
    expect(readiness).not.toHaveProperty("dispatch");
    expect(readiness).not.toHaveProperty("post");
    expect(readiness).not.toHaveProperty("route");
    expect(readiness).not.toHaveProperty("ack");
    expect(readiness).not.toHaveProperty("handle");
  });
});
