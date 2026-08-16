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

import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, expectTypeOf, it } from "vitest";
import { CommandSchema, file_spine_options } from "@spine-event-engine/proto";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

import {
  CommandRegistrationReadiness,
  EntityHandlers,
  HandlerMetadataRegistry,
  HandlerMetadataRegistryError,
  type CommandAssignmentHandlerMetadata,
  type CommandRegistrationAssigneeMetadata,
  type CommandRegistrationReadinessLookup,
  type EntityHandlersMetadata,
  type HandlerKind,
  type HandlerMetadata,
  type HandlerMetadataRegistryLookup,
  type RegisteredHandlerMetadata,
} from "../../src/index.js";

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
    expect(readiness.commandTypeNames()).toEqual([]);
    expect(readiness.findCommandAssignee("spine.core.Command")).toBeUndefined();
    expect(Object.isFrozen(readiness.commandTypeNames())).toBe(true);
  });

  it("rejects direct runtime construction without the package factory token", () => {
    const constructor = CommandRegistrationReadiness as unknown as new (
      authenticityToken: symbol,
      commandFullTypeNames: readonly string[],
      assigneesByTypeName: ReadonlyMap<string, CommandRegistrationAssigneeMetadata>,
    ) => CommandRegistrationReadiness;

    expect(() => {
      Reflect.construct(constructor, [Symbol("external"), [], new Map()]);
    }).toThrow(
      "CommandRegistrationReadiness instances must be created by the package factory methods.",
    );
  });

  it("lists registered command message full type names in deterministic order", () => {
    const handlers = EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
      builder.assign(AggregateStateSchema, "assignArchive"),
    ]);
    const readiness = CommandRegistrationReadiness.fromRegistry(
      new HandlerMetadataRegistry([handlers]),
    );

    expect(readiness.commandTypeNames()).toEqual(["AggregateState", "spine.core.Command"]);
  });

  it("orders command message names by locale-independent code units", () => {
    const registry = createRegistryLookupForCommandNames([
      "example.Command_Alpha",
      "example.Command0Alpha",
      "example.CommandAlpha",
      "example.Commandalpha",
    ]);

    const readiness = CommandRegistrationReadiness.fromRegistry(registry);

    expect(readiness.commandTypeNames()).toEqual([
      "example.Command0Alpha",
      "example.CommandAlpha",
      "example.Command_Alpha",
      "example.Commandalpha",
    ]);
  });

  it("finds the unique command assignee metadata for a command type", () => {
    const handlers = EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
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
    expect(assignee?.registeredHandler.handler).toEqual(handlers.commandAssignments[0]);
    expect(assignee?.registeredHandler.handler).not.toBe(handlers.commandAssignments[0]);
  });

  it("keeps duplicate command assignment failure owned by HandlerMetadataRegistry", () => {
    const first = EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
    ]);
    const second = EntityHandlers.define(TaskAggregate, AggregateStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
    ]);

    expect(() => CommandRegistrationReadiness.fromEntityHandlers([first, second])).toThrow(
      HandlerMetadataRegistryError,
    );
    expect(() => CommandRegistrationReadiness.fromEntityHandlers([first, second])).toThrow(
      /Duplicate command assignment for "spine\.core\.Command"/,
    );
  });

  it("rejects duplicate command assignments exposed by a custom registry lookup", () => {
    const first = EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
    ]);
    const second = EntityHandlers.define(TaskAggregate, AggregateStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
    ]);
    const firstAssignment = createRegisteredCommandAssignment(first);
    const secondAssignment = createRegisteredCommandAssignment(second);
    const lookup = {
      ...createRegistryLookupForAssignments([firstAssignment, secondAssignment]),
      findCommandAssignment: () => firstAssignment,
    } satisfies HandlerMetadataRegistryLookup;

    expect(() => CommandRegistrationReadiness.fromRegistry(lookup)).toThrow(
      HandlerMetadataRegistryError,
    );
    expect(() => CommandRegistrationReadiness.fromRegistry(lookup)).toThrow(
      /Duplicate command assignment for "spine\.core\.Command"/,
    );
  });

  it("returns frozen copy-safe command lists and assignee values", () => {
    const handlers = EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
    ]);
    const readiness = CommandRegistrationReadiness.fromEntityHandlers([handlers]);

    const firstList = readiness.commandTypeNames();
    const secondList = readiness.commandTypeNames();
    const firstAssignee = readiness.findCommandAssignee(CommandSchema.typeName);
    const secondAssignee = readiness.findCommandAssignee(CommandSchema.typeName);

    expect(firstList).toEqual(["spine.core.Command"]);
    expect(Object.isFrozen(firstList)).toBe(true);
    expect(firstList).not.toBe(secondList);
    expect(() => {
      (firstList as string[]).push("example.MutatedCommand");
    }).toThrow(TypeError);
    expect(readiness.commandTypeNames()).toEqual(["spine.core.Command"]);

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

  it("keeps returned nested assignee metadata from mutating later lookups", () => {
    const mutableHandler: CommandAssignmentHandlerMetadata = {
      kind: "command-assignment",
      schema: CommandSchema,
      descriptor: CommandSchema,
      messageFullTypeName: CommandSchema.typeName,
      methodName: "assignCreate",
      parameterCount: 1,
      origin: "domestic",
    };
    const mutableEntityHandlers: EntityHandlersMetadata = {
      entityType: TaskProjection,
      entity: createProjectionEntityMetadata(),
      handlers: [mutableHandler],
      commandAssignments: [mutableHandler],
      commandReactions: [],
      eventSubscriptions: [],
      stateSubscriptions: [],
      eventReactions: [],
      eventApplications: [],
    };
    const mutableRegisteredHandler: RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata> = {
      entityHandlers: mutableEntityHandlers,
      entityType: TaskProjection,
      entity: mutableEntityHandlers.entity,
      handler: mutableHandler,
    };
    const readiness = CommandRegistrationReadiness.fromRegistry(
      createRegistryLookupForAssignments([mutableRegisteredHandler]),
    );

    const assignee = readiness.findCommandAssignee(CommandSchema.typeName);
    const nestedCommandAssignment = assignee?.entityHandlers.commandAssignments[0];

    if (nestedCommandAssignment === undefined) {
      throw new Error("Expected command assignee metadata to include a nested command assignment.");
    }

    expect(Object.isFrozen(assignee?.handler)).toBe(true);
    expect(Object.isFrozen(assignee?.entityHandlers)).toBe(true);
    expect(Object.isFrozen(assignee?.entityHandlers.commandAssignments)).toBe(true);
    expect(Object.isFrozen(assignee?.registeredHandler)).toBe(true);
    expect(Object.isFrozen(assignee?.registeredHandler.handler)).toBe(true);
    expect(() => {
      (assignee?.handler as { methodName: string }).methodName = "mutatedHandler";
    }).toThrow(TypeError);
    expect(() => {
      (nestedCommandAssignment as { methodName: string }).methodName = "mutatedNestedHandler";
    }).toThrow(TypeError);
    expect(() => {
      (assignee?.registeredHandler.handler as { methodName: string }).methodName =
        "mutatedRegisteredHandler";
    }).toThrow(TypeError);

    expect(readiness.findCommandAssignee(CommandSchema.typeName)).toMatchObject({
      handler: { methodName: "assignCreate" },
      entityHandlers: {
        commandAssignments: [{ methodName: "assignCreate" }],
      },
      registeredHandler: {
        handler: { methodName: "assignCreate" },
      },
    });
  });

  it("keeps returned assignee schema and descriptor metadata from mutating later lookups", () => {
    const mutableSchema = { ...CommandSchema };
    const mutableDescriptor = { ...CommandSchema };
    const mutableHandler: CommandAssignmentHandlerMetadata = {
      kind: "command-assignment",
      schema: mutableSchema,
      descriptor: mutableDescriptor,
      messageFullTypeName: CommandSchema.typeName,
      methodName: "assignCreate",
      parameterCount: 1,
      origin: "domestic",
    };
    const mutableEntityHandlers: EntityHandlersMetadata = {
      entityType: TaskProjection,
      entity: createProjectionEntityMetadata(),
      handlers: [mutableHandler],
      commandAssignments: [mutableHandler],
      commandReactions: [],
      eventSubscriptions: [],
      stateSubscriptions: [],
      eventReactions: [],
      eventApplications: [],
    };
    const mutableRegisteredHandler: RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata> = {
      entityHandlers: mutableEntityHandlers,
      entityType: TaskProjection,
      entity: mutableEntityHandlers.entity,
      handler: mutableHandler,
    };
    const readiness = CommandRegistrationReadiness.fromRegistry(
      createRegistryLookupForAssignments([mutableRegisteredHandler]),
    );

    const assignee = readiness.findCommandAssignee(CommandSchema.typeName);

    expect(Object.isFrozen(assignee?.handler.schema)).toBe(true);
    expect(Object.isFrozen(assignee?.handler.descriptor)).toBe(true);
    expect(() => {
      (assignee?.handler.schema as { typeName: string }).typeName = "example.MutatedCommand";
    }).toThrow(TypeError);
    expect(() => {
      (assignee?.handler.descriptor as { typeName: string }).typeName =
        "example.MutatedCommandDescriptor";
    }).toThrow(TypeError);

    expect(readiness.findCommandAssignee(CommandSchema.typeName)).toMatchObject({
      handler: {
        schema: { typeName: CommandSchema.typeName },
        descriptor: { typeName: CommandSchema.typeName },
      },
    });
  });

  it("ignores caller-supplied entity semantic tags", () => {
    const handler: CommandAssignmentHandlerMetadata = {
      kind: "command-assignment",
      schema: CommandSchema,
      descriptor: CommandSchema,
      messageFullTypeName: CommandSchema.typeName,
      methodName: "assignCreate",
      parameterCount: 1,
      origin: "domestic",
    };
    const entityHandlers: EntityHandlersMetadata = {
      entityType: TaskProjection,
      entity: metadataWithTags(Object.freeze([null])),
      handlers: [handler],
      commandAssignments: [handler],
      commandReactions: [],
      eventSubscriptions: [],
      stateSubscriptions: [],
      eventReactions: [],
      eventApplications: [],
    };
    const registeredHandler: RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata> = {
      entityHandlers,
      entityType: TaskProjection,
      entity: entityHandlers.entity,
      handler,
    };

    expect(() =>
      CommandRegistrationReadiness.fromRegistry(
        createRegistryLookupForAssignments([registeredHandler]),
      ),
    ).not.toThrow();
  });

  it("preserves entity field metadata identity in returned assignee metadata", () => {
    const handlers = EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
    ]);
    const readiness = CommandRegistrationReadiness.fromEntityHandlers([handlers]);

    const assignee = readiness.findCommandAssignee(CommandSchema.typeName);

    expect(handlers.entity.idField).toBe(handlers.entity.firstFieldRoutingHint.field);
    expect(assignee?.entity.idField).toBe(assignee?.entity.firstFieldRoutingHint.field);
    expect(assignee?.registeredHandler.entity.idField).toBe(
      assignee?.registeredHandler.entity.firstFieldRoutingHint.field,
    );
    expect(assignee?.entityHandlers.entity.idField).toBe(
      assignee?.entityHandlers.entity.firstFieldRoutingHint.field,
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

function createRegistryLookupForCommandNames(
  commandFullTypeNames: readonly string[],
): HandlerMetadataRegistryLookup {
  const assignments = commandFullTypeNames.map((commandFullTypeName) => {
    const handler: CommandAssignmentHandlerMetadata = {
      kind: "command-assignment",
      schema: { ...CommandSchema, typeName: commandFullTypeName },
      descriptor: { ...CommandSchema, typeName: commandFullTypeName },
      messageFullTypeName: commandFullTypeName,
      methodName: "assignCreate",
      parameterCount: 1,
      origin: "domestic",
    };
    const entityHandlers: EntityHandlersMetadata = {
      entityType: TaskProjection,
      entity: createProjectionEntityMetadata(),
      handlers: [handler],
      commandAssignments: [handler],
      commandReactions: [],
      eventSubscriptions: [],
      stateSubscriptions: [],
      eventReactions: [],
      eventApplications: [],
    };

    return {
      entityHandlers,
      entityType: TaskProjection,
      entity: entityHandlers.entity,
      handler,
    } satisfies RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata>;
  });

  return createRegistryLookupForAssignments(assignments);
}

function createRegistryLookupForAssignments(
  assignments: readonly RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata>[],
): HandlerMetadataRegistryLookup {
  return {
    listEntityHandlers: () => assignments.map(({ entityHandlers }) => entityHandlers),
    listHandlers: () => assignments,
    findByState: (entityStateFullTypeName) =>
      assignments
        .map(({ entityHandlers }) => entityHandlers)
        .filter(({ entity }) => entity.fullTypeName === entityStateFullTypeName),
    findHandlersByKind: <Kind extends HandlerKind>(kind: Kind) =>
      (kind === "command-assignment" ? assignments : []) as readonly RegisteredHandlerMetadata<
        Extract<HandlerMetadata, { readonly kind: Kind }>
      >[],
    findByMessage: (messageFullTypeName) =>
      assignments.filter(({ handler }) => handler.messageFullTypeName === messageFullTypeName),
    findCommandAssignment: (commandFullTypeName) =>
      assignments.find(({ handler }) => handler.messageFullTypeName === commandFullTypeName),
    findEventApplication: () => undefined,
  };
}

function createRegisteredCommandAssignment(
  entityHandlers: EntityHandlersMetadata,
): RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata> {
  const handler = entityHandlers.commandAssignments[0];

  if (handler === undefined) {
    throw new Error("Expected command assignment metadata in test fixture.");
  }

  return {
    entityHandlers,
    entityType: entityHandlers.entityType,
    entity: entityHandlers.entity,
    handler,
  };
}

function createProjectionEntityMetadata(): EntityHandlersMetadata["entity"] {
  return EntityHandlers.define(TaskProjection, ProjectionStateSchema, () => []).entity;
}

function metadataWithTags(semanticTags: unknown): EntityHandlersMetadata["entity"] {
  return Object.freeze({
    ...createProjectionEntityMetadata(),
    semanticTags,
  });
}
