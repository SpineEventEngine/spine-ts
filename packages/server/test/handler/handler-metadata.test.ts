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

import { describe, expect, expectTypeOf, it } from "vitest";

import {
  EntityHandlers,
  type DescriptorMessageSchema,
  describeEntityMetadata,
  HandlerMetadataError,
  HandlerMetadataRegistry,
  HandlerMetadataRegistryError,
  type HandlerRegistrationBuilder,
  type HandlerMethodName,
  Projection,
} from "../../src/index.js";
import {
  type CreateProject,
  CreateProjectSchema,
} from "../../test-fixtures/generated/entity-metadata/project_commands_pb.js";
import {
  type ProjectCreated,
  ProjectCreatedSchema,
} from "../../test-fixtures/generated/entity-metadata/project_events_pb.js";
import {
  type ProjectOverviewState,
  ProjectOverviewStateSchema,
  ProjectStateSchema,
} from "../../test-fixtures/generated/entity-metadata/project_states_pb.js";

class TaskProjection {
  assignCreate(command: CreateProject): void {
    void command;
  }

  commandFromCommand(command: CreateProject): void {
    void command;
  }

  subscribeCreated(event: ProjectCreated): void {
    void event;
  }

  subscribeState(state: ProjectOverviewState): void {
    void state;
  }

  reactToCreated(event: ProjectCreated): void {
    void event;
  }

  applyCreated(event: ProjectCreated): void {
    void event;
  }

  assignArchive(command: CreateProject): void {
    void command;
  }

  commandFromArchive(command: CreateProject): void {
    void command;
  }

  subscribeArchived(event: ProjectCreated): void {
    void event;
  }

  reactToArchived(event: ProjectCreated): void {
    void event;
  }

  applyArchived(event: ProjectCreated): void {
    void event;
  }
}

class AssignedProjection extends Projection<string, typeof ProjectOverviewStateSchema, number> {
  assignCreate(command: CreateProject): void {
    void command;
  }
}

class OtherProjection {
  assignCreate(command: CreateProject): void {
    void command;
  }

  applyCreated(event: ProjectCreated): void {
    void event;
  }
}

class ForeignProjection {
  foreignOnly(command: CreateProject): void {
    void command;
  }
}

class PassiveProjection {
  static constructorCount = 0;
  static invocationCount = 0;

  constructor() {
    PassiveProjection.constructorCount += 1;
  }

  assignCreate(command: CreateProject): void {
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

describe("handler metadata", () => {
  it("rejects Projection command assignments from explicit metadata", () => {
    const entity = describeEntityMetadata(ProjectOverviewStateSchema);

    expect(() =>
      EntityHandlers.define(AssignedProjection, ProjectOverviewStateSchema, (builder) => [
        builder.assign(CreateProjectSchema, "assignCreate"),
      ]),
    ).toThrow(/Projection entities cannot use @Assign/i);

    const metadata = EntityHandlers.define(
      TaskProjection,
      ProjectOverviewStateSchema,
      (builder) => [
        builder.subscribe(ProjectCreatedSchema, "subscribeCreated"),
        builder.react(ProjectCreatedSchema, "reactToCreated"),
        builder.apply(ProjectCreatedSchema, "applyCreated", { allowImport: true }),
      ],
    );

    expect(metadata.entity).toMatchObject({
      fullTypeName: entity.fullTypeName,
      kind: entity.kind,
      visibility: entity.visibility,
    });
    expect(metadata.entityType).toBe(TaskProjection);
    expect(metadata.handlers.map((handler) => handler.kind)).toEqual([
      "event-subscription",
      "event-reaction",
      "event-application",
    ]);
    expect(metadata.handlers.map((handler) => handler.methodName)).toEqual([
      "subscribeCreated",
      "reactToCreated",
      "applyCreated",
    ]);
    expect(metadata.handlers.map((handler) => handler.messageFullTypeName)).toEqual([
      ProjectCreatedSchema.typeName,
      ProjectCreatedSchema.typeName,
      ProjectCreatedSchema.typeName,
    ]);
    expect(metadata.handlers.map((handler) => handler.parameterCount)).toEqual([1, 1, 1]);
    expect(metadata.commandAssignments).toEqual([]);
    expect(metadata.commandReactions).toEqual([]);
    expect(metadata.eventSubscriptions[0]).toBe(metadata.handlers[0]);
    expect(metadata.eventReactions[0]).toBe(metadata.handlers[1]);
    expect(metadata.eventApplications[0]).toBe(metadata.handlers[2]);
    expect(metadata.eventApplications[0]?.allowImport).toBe(true);

    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata.handlers)).toBe(true);
    expect(Object.isFrozen(metadata.handlers[0])).toBe(true);
    expect(Object.isFrozen(metadata.eventApplications)).toBe(true);
  });

  it("keeps Entity-state subscriptions out of Event subscription metadata", () => {
    const metadata = EntityHandlers.define(
      TaskProjection,
      ProjectOverviewStateSchema,
      (builder) => [
        builder.subscribe(ProjectCreatedSchema, "subscribeCreated"),
        builder.subscribe(ProjectOverviewStateSchema, "subscribeState"),
      ],
    );

    expect(metadata.handlers.map((handler) => handler.kind)).toEqual([
      "event-subscription",
      "state-subscription",
    ]);
    expect(metadata.eventSubscriptions.map((handler) => handler.methodName)).toEqual([
      "subscribeCreated",
    ]);
    expect(metadata.stateSubscriptions.map((handler) => handler.methodName)).toEqual([
      "subscribeState",
    ]);
  });

  it("keeps explicit handler registration one-argument compatible by default", () => {
    type AssignParameters = Parameters<HandlerRegistrationBuilder<TaskProjection>["assign"]>;
    type SubscribeParameters = Parameters<HandlerRegistrationBuilder<TaskProjection>["subscribe"]>;

    expectTypeOf<AssignParameters["length"]>().toEqualTypeOf<2>();
    expectTypeOf<AssignParameters[0]>().toExtend<DescriptorMessageSchema>();
    expectTypeOf<typeof CreateProjectSchema>().toExtend<AssignParameters[0]>();
    expectTypeOf<AssignParameters[1]>().toExtend<HandlerMethodName<TaskProjection>>();
    expectTypeOf<"assignCreate">().toExtend<AssignParameters[1]>();

    expectTypeOf<SubscribeParameters["length"]>().toEqualTypeOf<2>();
    expectTypeOf<SubscribeParameters[0]>().toExtend<DescriptorMessageSchema>();
    expectTypeOf<typeof ProjectCreatedSchema>().toExtend<SubscribeParameters[0]>();
    expectTypeOf<SubscribeParameters[1]>().toExtend<HandlerMethodName<TaskProjection>>();
    expectTypeOf<"subscribeCreated">().toExtend<SubscribeParameters[1]>();
  });

  it("rejects method names that do not exist on the entity prototype", () => {
    expect(() =>
      EntityHandlers.define(TaskProjection, ProjectOverviewStateSchema, (builder) => [
        builder.assign(CreateProjectSchema, "missingMethod" as never),
      ]),
    ).toThrow(HandlerMetadataError);
    expect(() =>
      EntityHandlers.define(TaskProjection, ProjectOverviewStateSchema, (builder) => [
        builder.assign(CreateProjectSchema, "missingMethod" as never),
      ]),
    ).toThrow(/normal class method syntax/);
  });

  it("documents that callable-name typing is narrower at runtime than TypeScript can express", () => {
    expectTypeOf<"accessorHandler">().toExtend<HandlerMethodName<AccessorProjection>>();
    expect(() =>
      EntityHandlers.define(AccessorProjection, ProjectOverviewStateSchema, (builder) => [
        builder.assign(CreateProjectSchema, "accessorHandler"),
      ]),
    ).toThrow(HandlerMetadataError);
    expect(() =>
      EntityHandlers.define(AccessorProjection, ProjectOverviewStateSchema, (builder) => [
        builder.assign(CreateProjectSchema, "accessorHandler"),
      ]),
    ).toThrow(/normal class method/);
    expect(AccessorProjection.getterAccessCount).toBe(0);
  });

  it("rejects inherited built-ins as handler method names", () => {
    expect(() =>
      EntityHandlers.define(TaskProjection, ProjectOverviewStateSchema, (builder) => [
        builder.assign(CreateProjectSchema, "toString" as never),
      ]),
    ).toThrow(HandlerMetadataError);
  });

  it("rejects constructor as a handler method name", () => {
    expect(() =>
      EntityHandlers.define(TaskProjection, ProjectOverviewStateSchema, (builder) => [
        builder.assign(CreateProjectSchema, "constructor" as never),
      ]),
    ).toThrow(HandlerMetadataError);
  });

  it("rejects handler records not created by the registration builder", () => {
    expect(() =>
      EntityHandlers.define(TaskProjection, ProjectOverviewStateSchema, (builder) => [
        {
          ...builder.assign(CreateProjectSchema, "assignCreate"),
        },
      ]),
    ).toThrow(/registration builder/);
  });

  it("rejects handler records created by another registration builder", () => {
    const foreignHandlers = EntityHandlers.define(
      ForeignProjection,
      ProjectOverviewStateSchema,
      (builder) => [builder.assign(CreateProjectSchema, "foreignOnly")],
    );
    const foreignHandler = foreignHandlers.handlers[0];

    expect(() =>
      EntityHandlers.define(TaskProjection, ProjectOverviewStateSchema, () => [
        foreignHandler as never,
      ]),
    ).toThrow(/registration builder/);
  });
});

describe("handler metadata registry", () => {
  it("registers entity handler metadata and exposes frozen deterministic lookup views", () => {
    const projectionHandlers = EntityHandlers.define(
      TaskProjection,
      ProjectOverviewStateSchema,
      (builder) => [
        builder.assign(CreateProjectSchema, "assignCreate"),
        builder.apply(ProjectCreatedSchema, "applyCreated"),
      ],
    );
    const aggregateHandlers = EntityHandlers.define(
      TaskProjection,
      ProjectStateSchema,
      (builder) => [
        builder.subscribe(ProjectCreatedSchema, "subscribeArchived"),
        builder.react(ProjectCreatedSchema, "reactToArchived"),
        builder.apply(ProjectCreatedSchema, "applyArchived"),
      ],
    );

    const registry = new HandlerMetadataRegistry([projectionHandlers, aggregateHandlers]);

    expect(registry.listEntityHandlers()).toEqual([projectionHandlers, aggregateHandlers]);
    expect(registry.findByState(ProjectOverviewStateSchema.typeName)).toEqual([projectionHandlers]);
    expect(registry.findByState(ProjectStateSchema.typeName)).toEqual([aggregateHandlers]);
    expect(registry.findHandlersByKind("event-application").map((entry) => entry.handler)).toEqual([
      projectionHandlers.eventApplications[0],
      aggregateHandlers.eventApplications[0],
    ]);
    expect(
      registry
        .findByMessage(ProjectCreatedSchema.typeName)
        .map((entry) => [entry.entity.fullTypeName, entry.handler.kind, entry.handler.methodName]),
    ).toEqual([
      [ProjectOverviewStateSchema.typeName, "event-application", "applyCreated"],
      [ProjectStateSchema.typeName, "event-subscription", "subscribeArchived"],
      [ProjectStateSchema.typeName, "event-reaction", "reactToArchived"],
      [ProjectStateSchema.typeName, "event-application", "applyArchived"],
    ]);
    expect(registry.findCommandAssignment(CreateProjectSchema.typeName)?.handler).toBe(
      projectionHandlers.commandAssignments[0],
    );
    expect(
      registry.findEventApplication(
        ProjectOverviewStateSchema.typeName,
        ProjectCreatedSchema.typeName,
      )?.handler,
    ).toBe(projectionHandlers.eventApplications[0]);

    expect(Object.isFrozen(registry.listEntityHandlers())).toBe(true);
    expect(Object.isFrozen(registry.listHandlers())).toBe(true);
    expect(Object.isFrozen(registry.findHandlersByKind("event-application"))).toBe(true);
    expect(Object.isFrozen(registry.findByMessage(ProjectCreatedSchema.typeName))).toBe(true);
  });

  it("rejects duplicate command assignments in one caller-owned registry", () => {
    const first = EntityHandlers.define(TaskProjection, ProjectOverviewStateSchema, (builder) => [
      builder.assign(CreateProjectSchema, "assignCreate"),
    ]);
    const second = EntityHandlers.define(OtherProjection, ProjectStateSchema, (builder) => [
      builder.assign(CreateProjectSchema, "assignCreate"),
    ]);

    expect(() => new HandlerMetadataRegistry([first, second])).toThrow(
      HandlerMetadataRegistryError,
    );
    expect(() => new HandlerMetadataRegistry([first, second])).toThrow(
      new RegExp(`Duplicate command assignment for "${CreateProjectSchema.typeName}"`),
    );
  });

  it("keeps @Command registrations out of the public registration builder", () => {
    expectTypeOf<HandlerRegistrationBuilder<TaskProjection>>().not.toHaveProperty("transform");
    expectTypeOf<HandlerRegistrationBuilder<TaskProjection>>().not.toHaveProperty("command");
  });

  it("rejects duplicate event applications for the same entity state and event type", () => {
    const first = EntityHandlers.define(TaskProjection, ProjectOverviewStateSchema, (builder) => [
      builder.apply(ProjectCreatedSchema, "applyCreated"),
    ]);
    const second = EntityHandlers.define(OtherProjection, ProjectOverviewStateSchema, (builder) => [
      builder.apply(ProjectCreatedSchema, "applyCreated"),
    ]);

    expect(() => new HandlerMetadataRegistry([first, second])).toThrow(
      HandlerMetadataRegistryError,
    );
    expect(() => new HandlerMetadataRegistry([first, second])).toThrow(
      new RegExp(
        `Duplicate event application for entity "${ProjectOverviewStateSchema.typeName}" and event "${ProjectCreatedSchema.typeName}"`,
      ),
    );
  });

  it("allows fan-out metadata for event subscribers and reactors", () => {
    const first = EntityHandlers.define(TaskProjection, ProjectOverviewStateSchema, (builder) => [
      builder.subscribe(ProjectCreatedSchema, "subscribeCreated"),
      builder.react(ProjectCreatedSchema, "reactToCreated"),
    ]);
    const second = EntityHandlers.define(TaskProjection, ProjectStateSchema, (builder) => [
      builder.subscribe(ProjectCreatedSchema, "subscribeArchived"),
      builder.react(ProjectCreatedSchema, "reactToArchived"),
    ]);

    const registry = new HandlerMetadataRegistry([first, second]);

    expect(registry.findHandlersByKind("event-subscription")).toHaveLength(2);
    expect(registry.findHandlersByKind("event-reaction")).toHaveLength(2);
    expect(registry.findByMessage(ProjectCreatedSchema.typeName)).toHaveLength(4);
  });

  it("keeps registries caller-owned and does not instantiate or invoke handlers", () => {
    PassiveProjection.constructorCount = 0;
    PassiveProjection.invocationCount = 0;
    const first = EntityHandlers.define(
      PassiveProjection,
      ProjectOverviewStateSchema,
      (builder) => [builder.assign(CreateProjectSchema, "assignCreate")],
    );
    const second = EntityHandlers.define(OtherProjection, ProjectStateSchema, (builder) => [
      builder.assign(CreateProjectSchema, "assignCreate"),
    ]);

    const firstRegistry = new HandlerMetadataRegistry([first]);
    const secondRegistry = new HandlerMetadataRegistry([second]);

    expect(firstRegistry.findCommandAssignment(CreateProjectSchema.typeName)?.entityType).toBe(
      PassiveProjection,
    );
    expect(secondRegistry.findCommandAssignment(CreateProjectSchema.typeName)?.entityType).toBe(
      OtherProjection,
    );
    expect(PassiveProjection.constructorCount).toBe(0);
    expect(PassiveProjection.invocationCount).toBe(0);
  });
});
