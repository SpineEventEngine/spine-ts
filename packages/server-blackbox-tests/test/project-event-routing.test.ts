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

import {
  clone,
  create,
  fromBinary,
  toBinary,
  type Message,
  type MessageShape,
} from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  DescriptorProtoSchema,
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FieldDescriptorProtoSchema,
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
} from "@bufbuild/protobuf/wkt";
import { AnyMessages, SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import {
  CommandContextSchema,
  CommandIdSchema,
  file_spine_options,
} from "@spine-event-engine/proto";
import {
  QueryIdSchema,
  type QueryResponse,
  QuerySchema,
  TargetFiltersSchema,
  TargetSchema,
} from "@spine-event-engine/proto/client";
import {
  Aggregate,
  BoundedContext,
  type EntityHandlersMetadata,
  EventRouting,
  HandlerRegistryIngestor,
  ProcessManager,
  Projection,
  Repository,
} from "@spine-event-engine/server";
import type { GeneratedHandlerRegistry } from "@spine-event-engine/server/spi/handler-registry";
import { describe, expect, it } from "vitest";

import { BlackBox } from "@spine-event-engine/testing";
import { processManagerDescriptorBase64 } from "../test-fixtures/entity-metadata-fixtures.js";
import { testingDescriptorSetBase64 } from "../src/fixtures/main-descriptor.js";

type OrganizationId = Message<"OrganizationId"> & { code: string };
type ProjectId = Message<"ProjectId"> & { organization?: OrganizationId; number: number };
type PlanningId = Message<"PlanningId"> & { organization?: OrganizationId; number: number };
type StaffingId = Message<"StaffingId"> & { organization?: OrganizationId; number: number };
type PortfolioId = Message<"PortfolioId"> & { organization?: OrganizationId; number: number };
type CreateProject = Message<"CreateProject"> & { project?: ProjectId; name: string };
type ScheduleProject = Message<"ScheduleProject"> & { project?: ProjectId; status: string };
type ProjectCreated = Message<"ProjectCreated"> & {
  sourceProject?: ProjectId;
  project?: ProjectId;
  name: string;
};
type ProjectScheduled = Message<"ProjectScheduled"> & { project?: ProjectId; status: string };
type ProjectState = Message<"ProjectState"> & { id?: ProjectId; name: string; status: string };
type PlanningState = Message<"PlanningState"> & { id?: PlanningId; projectName: string };
type StaffingState = Message<"StaffingState"> & { id?: StaffingId; projectName: string };
type CoordinationState = Message<"CoordinationState"> & { id?: ProjectId; projectName: string };
type PortfolioState = Message<"PortfolioState"> & { id?: PortfolioId; name: string };
type ProjectProjectionState = Message<"ProjectProjectionState"> & { id?: ProjectId; name: string };

const sourceFile = (() => {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(testingDescriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];
  if (descriptor === undefined) throw new Error("Testing descriptor fixture is empty.");
  return descriptor;
})();
const processManagerSource = (() => {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(processManagerDescriptorBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0]?.messageType.find(
    (message) => message.name === "ProcessManagerState",
  );
  if (descriptor === undefined) throw new Error("Process Manager fixture is missing.");
  return descriptor;
})();

function schema<T extends Message>(
  file: Parameters<typeof messageDesc>[0],
  name: string,
): GenMessage<T> {
  const index = file.proto.messageType.findIndex((message) => message.name === name);
  if (index < 0) throw new Error(`Fixture message declaration "${name}" is missing.`);
  return messageDesc(file, index);
}

const projectFile = (() => {
  const descriptor = clone(FileDescriptorProtoSchema, sourceFile);
  const aggregate = descriptor.messageType.find((message) => message.name === "AggregateState");
  const projection = descriptor.messageType.find((message) => message.name === "ProjectionState");
  const originalId = projection?.field.find((field) => field.name === "id");
  if (aggregate === undefined || projection === undefined || originalId === undefined) {
    throw new Error("Project workflow source declarations are missing.");
  }
  descriptor.name = "project_event_routing.proto";
  const organizationId = clone(DescriptorProtoSchema, projection);
  organizationId.name = "OrganizationId";
  organizationId.options = undefined;
  organizationId.field = [
    create(FieldDescriptorProtoSchema, {
      name: "code",
      number: 1,
      label: FieldDescriptorProto_Label.OPTIONAL,
      type: FieldDescriptorProto_Type.STRING,
      jsonName: "code",
    }),
  ];
  const compositeId = (name: string) => {
    const id = clone(DescriptorProtoSchema, projection);
    id.name = name;
    id.options = undefined;
    id.field = [
      create(FieldDescriptorProtoSchema, {
        ...clone(FieldDescriptorProtoSchema, originalId),
        name: "organization",
        number: 1,
        label: FieldDescriptorProto_Label.OPTIONAL,
        type: FieldDescriptorProto_Type.MESSAGE,
        typeName: ".OrganizationId",
        jsonName: "organization",
      }),
      create(FieldDescriptorProtoSchema, {
        name: "number",
        number: 2,
        label: FieldDescriptorProto_Label.OPTIONAL,
        type: FieldDescriptorProto_Type.INT32,
        jsonName: "number",
      }),
    ];
    return id;
  };
  const withId = (source: typeof projection, name: string, idName: string) => {
    const message = clone(DescriptorProtoSchema, source);
    message.name = name;
    const id = message.field.find((field) => field.name === "id");
    if (id === undefined) throw new Error(`${name} has no ID field.`);
    id.type = FieldDescriptorProto_Type.MESSAGE;
    id.typeName = `.${idName}`;
    return message;
  };
  const withProject = (name: string) => {
    const message = withId(projection, name, "ProjectId");
    const project = message.field.find((field) => field.name === "id");
    if (project === undefined) throw new Error(`${name} has no project field.`);
    project.name = "project";
    project.jsonName = "project";
    return message;
  };
  const withProjectStatus = (name: string) => {
    const message = withProject(name);
    const status = message.field.find((field) => field.name === "name");
    if (status === undefined) throw new Error(`${name} has no status field.`);
    status.name = "status";
    status.jsonName = "status";
    return message;
  };
  const projectCreated = () => {
    const message = clone(DescriptorProtoSchema, projection);
    message.name = "ProjectCreated";
    message.options = undefined;
    const name = message.field.find((field) => field.name === "name");
    if (name === undefined) throw new Error("ProjectCreated has no name field.");
    name.number = 3;
    message.field = [
      create(FieldDescriptorProtoSchema, {
        ...clone(FieldDescriptorProtoSchema, originalId),
        name: "source_project",
        number: 1,
        label: FieldDescriptorProto_Label.OPTIONAL,
        type: FieldDescriptorProto_Type.MESSAGE,
        typeName: ".ProjectId",
        jsonName: "sourceProject",
      }),
      create(FieldDescriptorProtoSchema, {
        ...clone(FieldDescriptorProtoSchema, originalId),
        name: "project",
        number: 2,
        label: FieldDescriptorProto_Label.OPTIONAL,
        type: FieldDescriptorProto_Type.MESSAGE,
        typeName: ".ProjectId",
        jsonName: "project",
      }),
      name,
    ];
    return message;
  };
  const projectState = withId(aggregate, "ProjectState", "ProjectId");
  const stateStatus = projectState.field.find((field) => field.name === "archived");
  if (stateStatus === undefined) throw new Error("ProjectState has no status field.");
  stateStatus.name = "status";
  stateStatus.jsonName = "status";
  stateStatus.type = FieldDescriptorProto_Type.STRING;
  const processManagerState = (name: string, idName: string) => {
    const state = withId(processManagerSource, name, idName);
    const projectName = state.field.find((field) => field.name === "queue");
    if (projectName === undefined) throw new Error(`${name} has no project name field.`);
    projectName.name = "project_name";
    projectName.jsonName = "projectName";
    return state;
  };
  const event = projectCreated();
  const scheduled = withProjectStatus("ProjectScheduled");
  scheduled.options = undefined;
  const createProject = withProject("CreateProject");
  createProject.options = undefined;
  const scheduleProject = withProjectStatus("ScheduleProject");
  scheduleProject.options = undefined;
  descriptor.messageType = [
    organizationId,
    compositeId("ProjectId"),
    compositeId("PlanningId"),
    compositeId("StaffingId"),
    compositeId("PortfolioId"),
    createProject,
    scheduleProject,
    projectState,
    event,
    scheduled,
    processManagerState("PlanningState", "PlanningId"),
    processManagerState("StaffingState", "StaffingId"),
    processManagerState("CoordinationState", "ProjectId"),
    withId(projection, "PortfolioState", "PortfolioId"),
    withId(projection, "ProjectProjectionState", "ProjectId"),
  ];
  return fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [
    file_spine_options,
  ]);
})();

const OrganizationIdSchema = schema<OrganizationId>(projectFile, "OrganizationId");
const ProjectIdSchema = schema<ProjectId>(projectFile, "ProjectId");
const PlanningIdSchema = schema<PlanningId>(projectFile, "PlanningId");
const StaffingIdSchema = schema<StaffingId>(projectFile, "StaffingId");
const PortfolioIdSchema = schema<PortfolioId>(projectFile, "PortfolioId");
const CreateProjectSchema = schema<CreateProject>(projectFile, "CreateProject");
const ScheduleProjectSchema = schema<ScheduleProject>(projectFile, "ScheduleProject");
const ProjectCreatedSchema = schema<ProjectCreated>(projectFile, "ProjectCreated");
const ProjectScheduledSchema = schema<ProjectScheduled>(projectFile, "ProjectScheduled");
const ProjectStateSchema = schema<ProjectState>(projectFile, "ProjectState");
const PlanningStateSchema = schema<PlanningState>(projectFile, "PlanningState");
const StaffingStateSchema = schema<StaffingState>(projectFile, "StaffingState");
const CoordinationStateSchema = schema<CoordinationState>(projectFile, "CoordinationState");
const PortfolioStateSchema = schema<PortfolioState>(projectFile, "PortfolioState");
const ProjectProjectionStateSchema = schema<ProjectProjectionState>(
  projectFile,
  "ProjectProjectionState",
);

class Project extends Aggregate<ProjectId, typeof ProjectStateSchema, bigint> {
  create(command: CreateProject): ProjectCreated {
    const project = command.project;
    if (project === undefined) throw new Error("CreateProject requires a project.");
    this.update((draft) =>
      Object.assign(draft, { id: project, name: command.name, status: "created" }),
    );
    return create(ProjectCreatedSchema, {
      sourceProject: projectId("other-project", 999),
      project,
      name: command.name,
    });
  }

  schedule(command: ScheduleProject): ProjectScheduled {
    this.update((draft) => Object.assign(draft, { status: command.status }));
    return create(ProjectScheduledSchema, { project: this.id, status: command.status });
  }
}

class ProjectPlanning extends ProcessManager<PlanningId, typeof PlanningStateSchema, number> {
  react(event: ProjectCreated): void {
    this.update((draft) => Object.assign(draft, { id: this.id, projectName: event.name }));
  }
}
class ProjectStaffing extends ProcessManager<StaffingId, typeof StaffingStateSchema, number> {
  react(event: ProjectCreated): void {
    this.update((draft) => Object.assign(draft, { id: this.id, projectName: event.name }));
  }
}
class ProjectCoordinator extends ProcessManager<ProjectId, typeof CoordinationStateSchema, number> {
  command(event: ProjectCreated): ScheduleProject {
    this.update((draft) => Object.assign(draft, { id: this.id, projectName: event.name }));
    return create(ScheduleProjectSchema, { project: this.id, status: "scheduled" });
  }
}
class Portfolio extends Projection<PortfolioId, typeof PortfolioStateSchema, number> {
  subscribe(event: ProjectCreated): void {
    this.update((draft) => Object.assign(draft, { id: this.id, name: event.name }));
  }
}
class ProjectProjection extends Projection<ProjectId, typeof ProjectProjectionStateSchema, number> {
  subscribe(event: ProjectCreated): void {
    this.update((draft) => Object.assign(draft, { id: this.id, name: event.name }));
  }
}

const generatedHandlerRegistry: GeneratedHandlerRegistry = {
  version: 3,
  entities: [
    {
      entityType: Project,
      stateSchema: ProjectStateSchema,
      handlers: [
        {
          kind: "command-assignment",
          methodName: "create",
          signalSchema: CreateProjectSchema,
          emittedSchemas: [ProjectCreatedSchema],
          parameterCount: 1,
          origin: "domestic",
        },
        {
          kind: "command-assignment",
          methodName: "schedule",
          signalSchema: ScheduleProjectSchema,
          emittedSchemas: [ProjectScheduledSchema],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    },
    {
      entityType: ProjectPlanning,
      stateSchema: PlanningStateSchema,
      handlers: [
        {
          kind: "event-reaction",
          methodName: "react",
          signalSchema: ProjectCreatedSchema,
          emittedSchemas: [],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    },
    {
      entityType: ProjectStaffing,
      stateSchema: StaffingStateSchema,
      handlers: [
        {
          kind: "event-reaction",
          methodName: "react",
          signalSchema: ProjectCreatedSchema,
          emittedSchemas: [],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    },
    {
      entityType: ProjectCoordinator,
      stateSchema: CoordinationStateSchema,
      handlers: [
        {
          kind: "command-reaction",
          methodName: "command",
          signalSchema: ProjectCreatedSchema,
          emittedSchemas: [ScheduleProjectSchema],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    },
    {
      entityType: Portfolio,
      stateSchema: PortfolioStateSchema,
      handlers: [
        {
          kind: "event-subscription",
          methodName: "subscribe",
          signalSchema: ProjectCreatedSchema,
          emittedSchemas: [],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    },
    {
      entityType: ProjectProjection,
      stateSchema: ProjectProjectionStateSchema,
      handlers: [
        {
          kind: "event-subscription",
          methodName: "subscribe",
          signalSchema: ProjectCreatedSchema,
          emittedSchemas: [],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    },
  ],
};
const generatedHandlers = new HandlerRegistryIngestor().ingest(generatedHandlerRegistry);
function handlersFor<Instance extends object, Schema extends GenMessage<Message>>(
  entityType: object,
  stateSchema: Schema,
): EntityHandlersMetadata<Instance, Schema> {
  const handlers = generatedHandlers.find(
    (candidate) =>
      candidate.entityType === entityType && candidate.entity.fullTypeName === stateSchema.typeName,
  );
  if (handlers === undefined) throw new Error("Generated handler fixture is missing an Entity.");
  return handlers as EntityHandlersMetadata<Instance, Schema>;
}

function organization(code: string): OrganizationId {
  return create(OrganizationIdSchema, { code });
}
function projectId(code: string, number: number): ProjectId {
  return create(ProjectIdSchema, { organization: organization(code), number });
}
function planningId(code: string, number: number): PlanningId {
  return create(PlanningIdSchema, { organization: organization(code), number });
}
function staffingId(code: string, number: number): StaffingId {
  return create(StaffingIdSchema, { organization: organization(code), number });
}
function portfolioId(code: string, number: number): PortfolioId {
  return create(PortfolioIdSchema, { organization: organization(code), number });
}
function query<Id extends Message>(schema: GenMessage<Message>, idSchema: GenMessage<Id>, id: Id) {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: crypto.randomUUID() }),
    target: create(TargetSchema, {
      type: TypeUrls.derive(schema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, { idFilter: { id: [AnyMessages.pack(idSchema, id)] } }),
      },
    }),
  });
}
function queryState<Schema extends GenMessage<Message>>(
  response: QueryResponse,
  schema: Schema,
): MessageShape<Schema> {
  if (response.message.length !== 1) {
    throw new Error(
      `Expected one Query response state, received ${String(response.message.length)}.`,
    );
  }
  const state = response.message[0]?.state;
  if (state === undefined) throw new Error("Query response state is missing.");
  const unpacked = AnyMessages.unpack(state, schema);
  if (unpacked === undefined)
    throw new Error(`Query response does not contain ${schema.typeName}.`);
  return unpacked;
}
function projectRepository(): Repository<typeof Project> {
  return new Repository({
    entityType: Project,
    schema: ProjectStateSchema,
    handlers: handlersFor<Project, typeof ProjectStateSchema>(Project, ProjectStateSchema),
    events: [ProjectCreatedSchema, ProjectScheduledSchema],
  });
}
function planningRepository(
  eventRouting: EventRouting<PlanningId>,
): Repository<typeof ProjectPlanning> {
  return new Repository({
    entityType: ProjectPlanning,
    schema: PlanningStateSchema,
    handlers: handlersFor<ProjectPlanning, typeof PlanningStateSchema>(
      ProjectPlanning,
      PlanningStateSchema,
    ),
    eventRouting,
  });
}
function staffingRepository(
  eventRouting: EventRouting<StaffingId>,
): Repository<typeof ProjectStaffing> {
  return new Repository({
    entityType: ProjectStaffing,
    schema: StaffingStateSchema,
    handlers: handlersFor<ProjectStaffing, typeof StaffingStateSchema>(
      ProjectStaffing,
      StaffingStateSchema,
    ),
    eventRouting,
  });
}
function coordinationRepository(): Repository<typeof ProjectCoordinator> {
  return new Repository({
    entityType: ProjectCoordinator,
    schema: CoordinationStateSchema,
    handlers: handlersFor<ProjectCoordinator, typeof CoordinationStateSchema>(
      ProjectCoordinator,
      CoordinationStateSchema,
    ),
  });
}
function portfolioRepository(
  eventRouting: EventRouting<PortfolioId>,
): Repository<typeof Portfolio> {
  return new Repository({
    entityType: Portfolio,
    schema: PortfolioStateSchema,
    handlers: handlersFor<Portfolio, typeof PortfolioStateSchema>(Portfolio, PortfolioStateSchema),
    eventRouting,
  });
}
function projectProjectionRepository(): Repository<typeof ProjectProjection> {
  return new Repository({
    entityType: ProjectProjection,
    schema: ProjectProjectionStateSchema,
    handlers: handlersFor<ProjectProjection, typeof ProjectProjectionStateSchema>(
      ProjectProjection,
      ProjectProjectionStateSchema,
    ),
  });
}
function routeTo<Id extends Message>(id: Id): EventRouting<Id> {
  return EventRouting.create<Id>().route(ProjectCreatedSchema, () => [id]);
}
function context(
  portfolioRouting: EventRouting<PortfolioId>,
  planning: PlanningId,
  staffing: StaffingId,
): BoundedContext {
  return BoundedContext.singleTenant("project event routing")
    .add(projectRepository())
    .add(planningRepository(routeTo(planning)))
    .add(staffingRepository(routeTo(staffing)))
    .add(coordinationRepository())
    .add(portfolioRepository(portfolioRouting))
    .add(projectProjectionRepository())
    .build();
}
async function awaitProjectWorkflowStates(
  boundedContext: BoundedContext,
  project: ProjectId,
  planning: PlanningId,
  staffing: StaffingId,
  portfolio: PortfolioId,
  options: { readonly portfolioExpected: boolean } = { portfolioExpected: true },
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const [
      projectState,
      planningState,
      staffingState,
      coordinationState,
      portfolioState,
      projectionState,
    ] = await Promise.all([
      boundedContext.stand().read(ProjectStateSchema, project),
      boundedContext.stand().read(PlanningStateSchema, planning),
      boundedContext.stand().read(StaffingStateSchema, staffing),
      boundedContext.stand().read(CoordinationStateSchema, project),
      boundedContext.stand().read(PortfolioStateSchema, portfolio),
      boundedContext.stand().read(ProjectProjectionStateSchema, project),
    ]);
    if (
      projectState?.name === "roadmap" &&
      projectState.status === "scheduled" &&
      planningState !== undefined &&
      staffingState !== undefined &&
      coordinationState !== undefined &&
      (options.portfolioExpected ? portfolioState !== undefined : portfolioState === undefined) &&
      projectionState !== undefined
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for persisted project workflow states.");
}
async function createProject(boundedContext: BoundedContext, id: ProjectId): Promise<void> {
  await boundedContext.commandBus().post(
    SignalEnvelopes.command({
      id: create(CommandIdSchema, { uuid: crypto.randomUUID() }),
      context: create(CommandContextSchema),
      schema: CreateProjectSchema,
      message: create(CreateProjectSchema, { project: id, name: "roadmap" }),
    }),
  );
}
function ids() {
  return {
    project: projectId("org-a", 1),
    planning: planningId("org-a", 2),
    staffing: staffingId("org-a", 3),
    portfolio: portfolioId("org-a", 4),
  };
}
function expectProjectWorkflowIds(
  project: ProjectId,
  planning: PlanningId,
  staffing: StaffingId,
  portfolio: PortfolioId,
): void {
  expect(planning.$typeName).not.toBe(project.$typeName);
  expect(staffing.$typeName).not.toBe(project.$typeName);
  expect(portfolio.$typeName).not.toBe(project.$typeName);
  expect(planning.$typeName).not.toBe(staffing.$typeName);
  expect(planning.$typeName).not.toBe(portfolio.$typeName);
  expect(staffing.$typeName).not.toBe(portfolio.$typeName);
  expect(CreateProjectSchema.typeName).not.toBe(ProjectStateSchema.typeName);
  expect(ScheduleProjectSchema.typeName).not.toBe(ProjectStateSchema.typeName);
  expect(ProjectCreatedSchema.fields[0]?.localName).toBe("sourceProject");
  expect(ProjectCreatedSchema.fields[1]?.localName).toBe("project");
  for (const schema of [ProjectIdSchema, PlanningIdSchema, StaffingIdSchema, PortfolioIdSchema]) {
    expect(schema.fields[0]?.localName).toBe("organization");
    expect(schema.fields[0]?.message?.typeName).toBe(OrganizationIdSchema.typeName);
    expect(schema.fields[1]?.localName).toBe("number");
    expect(schema.fields[1]?.fieldKind).toBe("scalar");
  }
}

describe("project workflow Event routing", () => {
  it("updates custom- and producer-ID-routed persisted Entity states", async () => {
    const { project, planning, staffing, portfolio } = ids();
    expectProjectWorkflowIds(project, planning, staffing, portfolio);
    const boundedContext = context(routeTo(portfolio), planning, staffing);
    try {
      await createProject(boundedContext, project);
      await awaitProjectWorkflowStates(boundedContext, project, planning, staffing, portfolio);
      await expect(boundedContext.stand().read(ProjectStateSchema, project)).resolves.toMatchObject(
        {
          id: project,
          name: "roadmap",
          status: "scheduled",
        },
      );
      await expect(
        boundedContext.stand().read(PlanningStateSchema, planning),
      ).resolves.toMatchObject({
        id: planning,
        projectName: "roadmap",
      });
      await expect(
        boundedContext.stand().read(StaffingStateSchema, staffing),
      ).resolves.toMatchObject({
        id: staffing,
        projectName: "roadmap",
      });
      await expect(
        boundedContext.stand().read(CoordinationStateSchema, project),
      ).resolves.toMatchObject({
        id: project,
        projectName: "roadmap",
      });
      await expect(
        boundedContext.stand().read(PortfolioStateSchema, portfolio),
      ).resolves.toMatchObject({
        id: portfolio,
        name: "roadmap",
      });
      await expect(
        boundedContext.stand().read(ProjectProjectionStateSchema, project),
      ).resolves.toMatchObject({ id: project, name: "roadmap" });
    } finally {
      await boundedContext.close();
    }
  });

  it("suppresses only the portfolio with an empty custom Event route", async () => {
    const { project, planning, staffing, portfolio } = ids();
    const none = EventRouting.create<PortfolioId>().route(ProjectCreatedSchema, () => []);
    const boundedContext = context(none, planning, staffing);
    try {
      await createProject(boundedContext, project);
      await awaitProjectWorkflowStates(boundedContext, project, planning, staffing, portfolio, {
        portfolioExpected: false,
      });
      await expect(
        boundedContext.stand().read(PortfolioStateSchema, portfolio),
      ).resolves.toBeUndefined();
      await expect(boundedContext.stand().read(ProjectStateSchema, project)).resolves.toMatchObject(
        {
          id: project,
          name: "roadmap",
          status: "scheduled",
        },
      );
      await expect(
        boundedContext.stand().read(PlanningStateSchema, planning),
      ).resolves.toMatchObject({
        id: planning,
        projectName: "roadmap",
      });
      await expect(
        boundedContext.stand().read(StaffingStateSchema, staffing),
      ).resolves.toMatchObject({
        id: staffing,
        projectName: "roadmap",
      });
      await expect(
        boundedContext.stand().read(CoordinationStateSchema, project),
      ).resolves.toMatchObject({
        id: project,
        projectName: "roadmap",
      });
      await expect(
        boundedContext.stand().read(ProjectProjectionStateSchema, project),
      ).resolves.toMatchObject({ id: project, name: "roadmap" });
    } finally {
      await boundedContext.close();
    }
  });

  it("reaches the same persisted states through the public BlackBox API", async () => {
    const { project, planning, staffing, portfolio } = ids();
    const boundedContext = context(routeTo(portfolio), planning, staffing);
    const blackBox = await BlackBox.from(boundedContext);
    try {
      const scope = blackBox.asGuest();
      const posted = await scope.post(
        CreateProjectSchema,
        create(CreateProjectSchema, { project, name: "roadmap" }),
      );
      expect(posted.kind).toBe("ok");
      const results = await blackBox.eventually(
        () =>
          Promise.all([
            scope.send(query(ProjectStateSchema, ProjectIdSchema, project)),
            scope.send(query(PlanningStateSchema, PlanningIdSchema, planning)),
            scope.send(query(StaffingStateSchema, StaffingIdSchema, staffing)),
            scope.send(query(CoordinationStateSchema, ProjectIdSchema, project)),
            scope.send(query(PortfolioStateSchema, PortfolioIdSchema, portfolio)),
            scope.send(query(ProjectProjectionStateSchema, ProjectIdSchema, project)),
          ]),
        (candidate) => {
          const state = candidate[0].message[0]?.state;
          return (
            candidate.every((response) => response.message.length === 1) &&
            state !== undefined &&
            AnyMessages.unpack(state, ProjectStateSchema)?.status === "scheduled"
          );
        },
      );
      expect(queryState(results[0], ProjectStateSchema)).toMatchObject({
        id: project,
        name: "roadmap",
        status: "scheduled",
      });
      expect(queryState(results[1], PlanningStateSchema)).toMatchObject({
        id: planning,
        projectName: "roadmap",
      });
      expect(queryState(results[2], StaffingStateSchema)).toMatchObject({
        id: staffing,
        projectName: "roadmap",
      });
      expect(queryState(results[3], CoordinationStateSchema)).toMatchObject({
        id: project,
        projectName: "roadmap",
      });
      expect(queryState(results[4], PortfolioStateSchema)).toMatchObject({
        id: portfolio,
        name: "roadmap",
      });
      expect(queryState(results[5], ProjectProjectionStateSchema)).toMatchObject({
        id: project,
        name: "roadmap",
      });
    } finally {
      await blackBox.close();
    }
  });
});
