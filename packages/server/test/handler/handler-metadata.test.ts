import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, expectTypeOf, it } from "vitest";
import { CommandSchema, EventSchema, file_spine_options } from "@spine-event-engine/proto";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

import {
  EntityHandlers,
  type DescriptorMessageSchema,
  describeEntityMetadata,
  HandlerMetadataError,
  HandlerMetadataRegistry,
  HandlerMetadataRegistryError,
  type HandlerRegistrationBuilder,
  type HandlerMethodName,
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

  commandFromCommand(command: Message<"spine.core.Command">): void {
    void command;
  }

  subscribeCreated(event: Message<"spine.core.Event">): void {
    void event;
  }

  reactToCreated(event: Message<"spine.core.Event">): void {
    void event;
  }

  applyCreated(event: Message<"spine.core.Event">): void {
    void event;
  }

  assignArchive(command: Message<"spine.core.Command">): void {
    void command;
  }

  commandFromArchive(command: Message<"spine.core.Command">): void {
    void command;
  }

  subscribeArchived(event: Message<"spine.core.Event">): void {
    void event;
  }

  reactToArchived(event: Message<"spine.core.Event">): void {
    void event;
  }

  applyArchived(event: Message<"spine.core.Event">): void {
    void event;
  }
}

class OtherProjection {
  assignCreate(command: Message<"spine.core.Command">): void {
    void command;
  }

  applyCreated(event: Message<"spine.core.Event">): void {
    void event;
  }
}

class ForeignProjection {
  foreignOnly(command: Message<"spine.core.Command">): void {
    void command;
  }
}

class PassiveProjection {
  static constructorCount = 0;
  static invocationCount = 0;

  constructor() {
    PassiveProjection.constructorCount += 1;
  }

  assignCreate(command: Message<"spine.core.Command">): void {
    void command;
    PassiveProjection.invocationCount += 1;
  }
}

class AccessorProjection {
  private static accessCount = 0;

  static get getterAccessCount(): number {
    return AccessorProjection.accessCount;
  }

  get accessorHandler(): () => void {
    AccessorProjection.accessCount += 1;
    return () => undefined;
  }
}

function createFixtureFileDescriptor(descriptorSetBase64: string, imports = [file_spine_options]) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Server handler metadata fixture descriptor set is empty.");
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

describe("handler metadata", () => {
  it("defines frozen explicit handler metadata in declaration order", () => {
    const entity = describeEntityMetadata(ProjectionStateSchema);

    const metadata = EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
      builder.command(CommandSchema, "commandFromCommand"),
      builder.subscribe(EventSchema, "subscribeCreated"),
      builder.react(EventSchema, "reactToCreated"),
      builder.apply(EventSchema, "applyCreated", { allowImport: true }),
    ]);

    expect(metadata.entity).toMatchObject({
      fullTypeName: entity.fullTypeName,
      kind: entity.kind,
      visibility: entity.visibility,
    });
    expect(metadata.entityType).toBe(TaskProjection);
    expect(metadata.handlers.map((handler) => handler.kind)).toEqual([
      "command-assignment",
      "command-reaction",
      "event-subscription",
      "event-reaction",
      "event-application",
    ]);
    expect(metadata.handlers.map((handler) => handler.methodName)).toEqual([
      "assignCreate",
      "commandFromCommand",
      "subscribeCreated",
      "reactToCreated",
      "applyCreated",
    ]);
    expect(metadata.handlers.map((handler) => handler.messageFullTypeName)).toEqual([
      "spine.core.Command",
      "spine.core.Command",
      "spine.core.Event",
      "spine.core.Event",
      "spine.core.Event",
    ]);
    expect(metadata.handlers.map((handler) => handler.parameterCount)).toEqual([1, 1, 1, 1, 1]);
    expect(metadata.commandAssignments[0]).toBe(metadata.handlers[0]);
    expect(metadata.commandReactions[0]).toBe(metadata.handlers[1]);
    expect(metadata.eventSubscriptions[0]).toBe(metadata.handlers[2]);
    expect(metadata.eventReactions[0]).toBe(metadata.handlers[3]);
    expect(metadata.eventApplications[0]).toBe(metadata.handlers[4]);
    expect(metadata.eventApplications[0]?.allowImport).toBe(true);

    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata.handlers)).toBe(true);
    expect(Object.isFrozen(metadata.handlers[0])).toBe(true);
    expect(Object.isFrozen(metadata.eventApplications)).toBe(true);
  });

  it("keeps explicit handler registration one-argument compatible by default", () => {
    type AssignParameters = Parameters<HandlerRegistrationBuilder<TaskProjection>["assign"]>;
    type SubscribeParameters = Parameters<HandlerRegistrationBuilder<TaskProjection>["subscribe"]>;

    expectTypeOf<AssignParameters["length"]>().toEqualTypeOf<2>();
    expectTypeOf<AssignParameters[0]>().toExtend<DescriptorMessageSchema>();
    expectTypeOf<typeof CommandSchema>().toExtend<AssignParameters[0]>();
    expectTypeOf<AssignParameters[1]>().toExtend<HandlerMethodName<TaskProjection>>();
    expectTypeOf<"assignCreate">().toExtend<AssignParameters[1]>();

    expectTypeOf<SubscribeParameters["length"]>().toEqualTypeOf<2>();
    expectTypeOf<SubscribeParameters[0]>().toExtend<DescriptorMessageSchema>();
    expectTypeOf<typeof EventSchema>().toExtend<SubscribeParameters[0]>();
    expectTypeOf<SubscribeParameters[1]>().toExtend<HandlerMethodName<TaskProjection>>();
    expectTypeOf<"subscribeCreated">().toExtend<SubscribeParameters[1]>();
  });

  it("rejects method names that do not exist on the entity prototype", () => {
    expect(() =>
      EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
        builder.assign(CommandSchema, "missingMethod" as never),
      ]),
    ).toThrow(HandlerMetadataError);
    expect(() =>
      EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
        builder.assign(CommandSchema, "missingMethod" as never),
      ]),
    ).toThrow(/normal class method syntax/);
  });

  it("documents that callable-name typing is narrower at runtime than TypeScript can express", () => {
    expectTypeOf<"accessorHandler">().toExtend<HandlerMethodName<AccessorProjection>>();
    expect(() =>
      EntityHandlers.define(AccessorProjection, ProjectionStateSchema, (builder) => [
        builder.assign(CommandSchema, "accessorHandler"),
      ]),
    ).toThrow(HandlerMetadataError);
    expect(() =>
      EntityHandlers.define(AccessorProjection, ProjectionStateSchema, (builder) => [
        builder.assign(CommandSchema, "accessorHandler"),
      ]),
    ).toThrow(/normal class method/);
    expect(AccessorProjection.getterAccessCount).toBe(0);
  });

  it("rejects inherited built-ins as handler method names", () => {
    expect(() =>
      EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
        builder.assign(CommandSchema, "toString" as never),
      ]),
    ).toThrow(HandlerMetadataError);
  });

  it("rejects constructor as a handler method name", () => {
    expect(() =>
      EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
        builder.assign(CommandSchema, "constructor" as never),
      ]),
    ).toThrow(HandlerMetadataError);
  });

  it("rejects handler records not created by the registration builder", () => {
    expect(() =>
      EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
        {
          ...builder.assign(CommandSchema, "assignCreate"),
        },
      ]),
    ).toThrow(/registration builder/);
  });

  it("rejects handler records created by another registration builder", () => {
    const foreignHandlers = EntityHandlers.define(
      ForeignProjection,
      ProjectionStateSchema,
      (builder) => [builder.assign(CommandSchema, "foreignOnly")],
    );
    const foreignHandler = foreignHandlers.handlers[0];

    expect(() =>
      EntityHandlers.define(TaskProjection, ProjectionStateSchema, () => [foreignHandler as never]),
    ).toThrow(/registration builder/);
  });
});

describe("handler metadata registry", () => {
  it("registers entity handler metadata and exposes frozen deterministic lookup views", () => {
    const projectionHandlers = EntityHandlers.define(
      TaskProjection,
      ProjectionStateSchema,
      (builder) => [
        builder.assign(CommandSchema, "assignCreate"),
        builder.apply(EventSchema, "applyCreated"),
      ],
    );
    const aggregateHandlers = EntityHandlers.define(
      TaskProjection,
      AggregateStateSchema,
      (builder) => [
        builder.command(CommandSchema, "commandFromArchive"),
        builder.subscribe(EventSchema, "subscribeArchived"),
        builder.react(EventSchema, "reactToArchived"),
        builder.apply(EventSchema, "applyArchived"),
      ],
    );

    const registry = new HandlerMetadataRegistry([projectionHandlers, aggregateHandlers]);

    expect(registry.listEntityHandlers()).toEqual([projectionHandlers, aggregateHandlers]);
    expect(registry.findByState("ProjectionState")).toEqual([projectionHandlers]);
    expect(registry.findByState("AggregateState")).toEqual([aggregateHandlers]);
    expect(registry.findHandlersByKind("event-application").map((entry) => entry.handler)).toEqual([
      projectionHandlers.eventApplications[0],
      aggregateHandlers.eventApplications[0],
    ]);
    expect(
      registry
        .findByMessage("spine.core.Event")
        .map((entry) => [entry.entity.fullTypeName, entry.handler.kind, entry.handler.methodName]),
    ).toEqual([
      ["ProjectionState", "event-application", "applyCreated"],
      ["AggregateState", "event-subscription", "subscribeArchived"],
      ["AggregateState", "event-reaction", "reactToArchived"],
      ["AggregateState", "event-application", "applyArchived"],
    ]);
    expect(registry.findCommandAssignment("spine.core.Command")?.handler).toBe(
      projectionHandlers.commandAssignments[0],
    );
    expect(registry.findEventApplication("ProjectionState", "spine.core.Event")?.handler).toBe(
      projectionHandlers.eventApplications[0],
    );

    expect(Object.isFrozen(registry.listEntityHandlers())).toBe(true);
    expect(Object.isFrozen(registry.listHandlers())).toBe(true);
    expect(Object.isFrozen(registry.findHandlersByKind("event-application"))).toBe(true);
    expect(Object.isFrozen(registry.findByMessage("spine.core.Event"))).toBe(true);
  });

  it("rejects duplicate command assignments in one caller-owned registry", () => {
    const first = EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
    ]);
    const second = EntityHandlers.define(OtherProjection, AggregateStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
    ]);

    expect(() => new HandlerMetadataRegistry([first, second])).toThrow(
      HandlerMetadataRegistryError,
    );
    expect(() => new HandlerMetadataRegistry([first, second])).toThrow(
      /Duplicate command assignment for "spine\.core\.Command"/,
    );
  });

  it("rejects duplicate event applications for the same entity state and event type", () => {
    const first = EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.apply(EventSchema, "applyCreated"),
    ]);
    const second = EntityHandlers.define(OtherProjection, ProjectionStateSchema, (builder) => [
      builder.apply(EventSchema, "applyCreated"),
    ]);

    expect(() => new HandlerMetadataRegistry([first, second])).toThrow(
      HandlerMetadataRegistryError,
    );
    expect(() => new HandlerMetadataRegistry([first, second])).toThrow(
      /Duplicate event application for entity "ProjectionState" and event "spine\.core\.Event"/,
    );
  });

  it("allows fan-out metadata for command reactions and event subscribers/reactors", () => {
    const first = EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.command(CommandSchema, "commandFromCommand"),
      builder.subscribe(EventSchema, "subscribeCreated"),
      builder.react(EventSchema, "reactToCreated"),
    ]);
    const second = EntityHandlers.define(TaskProjection, AggregateStateSchema, (builder) => [
      builder.command(CommandSchema, "commandFromArchive"),
      builder.subscribe(EventSchema, "subscribeArchived"),
      builder.react(EventSchema, "reactToArchived"),
    ]);

    const registry = new HandlerMetadataRegistry([first, second]);

    expect(registry.findHandlersByKind("command-reaction")).toHaveLength(2);
    expect(registry.findHandlersByKind("event-subscription")).toHaveLength(2);
    expect(registry.findHandlersByKind("event-reaction")).toHaveLength(2);
    expect(registry.findByMessage("spine.core.Command")).toHaveLength(2);
    expect(registry.findByMessage("spine.core.Event")).toHaveLength(4);
  });

  it("keeps registries caller-owned and does not instantiate or invoke handlers", () => {
    PassiveProjection.constructorCount = 0;
    PassiveProjection.invocationCount = 0;
    const first = EntityHandlers.define(PassiveProjection, ProjectionStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
    ]);
    const second = EntityHandlers.define(OtherProjection, AggregateStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
    ]);

    const firstRegistry = new HandlerMetadataRegistry([first]);
    const secondRegistry = new HandlerMetadataRegistry([second]);

    expect(firstRegistry.findCommandAssignment("spine.core.Command")?.entityType).toBe(
      PassiveProjection,
    );
    expect(secondRegistry.findCommandAssignment("spine.core.Command")?.entityType).toBe(
      OtherProjection,
    );
    expect(PassiveProjection.constructorCount).toBe(0);
    expect(PassiveProjection.invocationCount).toBe(0);
  });
});
