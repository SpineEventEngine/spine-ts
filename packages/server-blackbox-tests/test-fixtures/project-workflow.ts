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

import { Buffer } from "node:buffer";
import { create, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { TypeUrls } from "@spine-event-engine/core";
import {
  Aggregate,
  BoundedContext,
  EventRouting,
  HandlerRegistryIngestor,
  ProcessManager,
  Projection,
  Repository,
  UniformAcrossAllShards,
  type EntityHandlersMetadata,
} from "@spine-event-engine/server";
import type { GeneratedHandlerRegistry } from "@spine-event-engine/server/spi/handler-registry";
import type { StorageFactory } from "@spine-event-engine/storage";

import {
  CreateProjectSchema,
  type CreateProject,
} from "../generated/spine/server/testing/project_commands_pb.js";
import {
  ProjectCreatedSchema,
  type ProjectCreated,
} from "../generated/spine/server/testing/project_events_pb.js";
import {
  OrganizationIdSchema,
  PlanningIdSchema,
  PlanningStateSchema,
  PortfolioIdSchema,
  PortfolioStateSchema,
  ProjectIdSchema,
  ProjectProjectionStateSchema,
  ProjectStateSchema,
  StaffingIdSchema,
  StaffingStateSchema,
  type PlanningId,
  type PortfolioId,
  type ProjectId,
  type StaffingId,
} from "../generated/spine/server/testing/project_workflow_pb.js";

/**
 * Distinct domain identifiers used by one Project workflow.
 */
export interface ProjectWorkflowIds {
  /**
   * Identifies the Aggregate.
   */
  readonly project: ProjectId;

  /**
   * Identifies the planning ProcessManager.
   */
  readonly planning: PlanningId;

  /**
   * Identifies the staffing ProcessManager.
   */
  readonly staffing: StaffingId;

  /**
   * Identifies the portfolio Projection.
   */
  readonly portfolio: PortfolioId;
}

/**
 * An actual handler method entry, recorded before its effects.
 */
export interface ProjectHandlerEntry {
  /**
   * Names the entered method.
   */
  readonly method: "create" | "planning" | "staffing" | "portfolio" | "projection";

  /**
   * Joins the entry to a submitted Project Command and its original Event.
   */
  readonly correlation: string;

  /**
   * Names the receiving Entity type.
   */
  readonly receiver:
    "Project" | "ProjectPlanning" | "ProjectStaffing" | "Portfolio" | "ProjectProjection";

  /**
   * The generated domain identifier schema of the actual receiving Entity.
   */
  readonly recipientTypeUrl: string;

  /**
   * Binary bytes of the receiving Entity identifier at method entry.
   */
  readonly recipientIdBase64: string;
}

/**
 * Creates domain-correct, distinct identifiers for one Project workflow.
 *
 * @param organizationCode Identifies the organization.
 * @param number Identifies its Project and corresponding recipient records.
 * @returns The distinct domain identifiers.
 */
export function projectWorkflowIds(organizationCode: string, number: number): ProjectWorkflowIds {
  const organization = create(OrganizationIdSchema, { code: organizationCode });
  return {
    project: create(ProjectIdSchema, { organization, number }),
    planning: create(PlanningIdSchema, { organization, number }),
    staffing: create(StaffingIdSchema, { organization, number }),
    portfolio: create(PortfolioIdSchema, { organization, number }),
  };
}

/**
 * Returns a stable domain correlation shared by the Command and its original Event.
 *
 * @param project Identifies the Project.
 * @returns The correlation key.
 */
export function projectCorrelation(project: ProjectId): string {
  return `${project.organization?.code ?? ""}:${String(project.number)}`;
}

/**
 * Resolves distinct recipient IDs from the original Project Event.
 *
 * @param event Carries the original Project ID.
 * @returns The corresponding recipient IDs.
 */
function recipientIds(event: ProjectCreated): ProjectWorkflowIds {
  const project = event.project;
  if (project?.organization === undefined) throw new Error("ProjectCreated requires a ProjectId.");
  return projectWorkflowIds(project.organization.code, project.number);
}

/**
 * Selects the generated handler metadata for the requested Entity type.
 *
 * @typeParam Instance The Entity handler instance.
 * @typeParam Schema The Entity state schema.
 * @param generated Contains compiled handler metadata.
 * @param entityType Identifies the Entity implementation.
 * @param stateSchema Identifies the Entity state.
 * @returns Matching handler metadata.
 */
function handlersFor<Instance extends object, Schema extends GenMessage<Message>>(
  generated: ReturnType<HandlerRegistryIngestor["ingest"]>,
  entityType: object,
  stateSchema: Schema,
): EntityHandlersMetadata<Instance, Schema> {
  const handlers = generated.find(
    (candidate) =>
      candidate.entityType === entityType && candidate.entity.fullTypeName === stateSchema.typeName,
  );
  if (handlers === undefined) throw new Error("Project handler metadata is missing.");
  return handlers as EntityHandlersMetadata<Instance, Schema>;
}

/**
 * Builds the compiled process fixture from generated Project domain messages.
 *
 * The entry callback must synchronously persist its record when used for crash evidence.
 *
 * @param name Names this diagnostic context.
 * @param onEntry Records each actual handler entry and may hold a selected handler before its effect.
 * @param storageFactory Persists records in the selected test database.
 * @param shards Selects the delivery shard count.
 * @returns The configured bounded context.
 */
export function projectWorkflow(
  name: string,
  onEntry: (entry: ProjectHandlerEntry) => void | Promise<void>,
  storageFactory?: StorageFactory,
  shards = 1,
): BoundedContext {
  const recordEntry = onEntry;

  /**
   * Handles Project Commands.
   */
  class Project extends Aggregate<ProjectId, typeof ProjectStateSchema> {
    /**
     * Handles the domain CreateProject Command and produces its original Event.
     */
    async create(command: CreateProject): Promise<ProjectCreated> {
      const project = command.project;
      if (project?.organization === undefined) throw new Error("ProjectId is required.");
      await recordEntry({
        method: "create",
        receiver: "Project",
        correlation: projectCorrelation(project),
        recipientTypeUrl: TypeUrls.derive(ProjectIdSchema),
        recipientIdBase64: Buffer.from(toBinary(ProjectIdSchema, this.id)).toString("base64"),
      });
      this.update((draft) =>
        Object.assign(draft, { id: project, name: command.name, status: "created" }),
      );
      return create(ProjectCreatedSchema, {
        organization: project.organization,
        project,
        name: command.name,
      });
    }
  }

  /**
   * Tracks planning work derived from ProjectCreated.
   */
  class ProjectPlanning extends ProcessManager<PlanningId, typeof PlanningStateSchema> {
    /**
     * Records a planning handler entry and its resulting state.
     */
    async react(event: ProjectCreated): Promise<void> {
      if (event.project === undefined) throw new Error("ProjectCreated requires a ProjectId.");
      await recordEntry({
        method: "planning",
        receiver: "ProjectPlanning",
        correlation: projectCorrelation(event.project),
        recipientTypeUrl: TypeUrls.derive(PlanningIdSchema),
        recipientIdBase64: Buffer.from(toBinary(PlanningIdSchema, this.id)).toString("base64"),
      });
      this.update((draft) => Object.assign(draft, { id: this.id, projectName: event.name }));
    }
  }

  /**
   * Tracks staffing work derived from ProjectCreated.
   */
  class ProjectStaffing extends ProcessManager<StaffingId, typeof StaffingStateSchema> {
    /**
     * Records a staffing handler entry and its resulting state.
     */
    async react(event: ProjectCreated): Promise<void> {
      if (event.project === undefined) throw new Error("ProjectCreated requires a ProjectId.");
      await recordEntry({
        method: "staffing",
        receiver: "ProjectStaffing",
        correlation: projectCorrelation(event.project),
        recipientTypeUrl: TypeUrls.derive(StaffingIdSchema),
        recipientIdBase64: Buffer.from(toBinary(StaffingIdSchema, this.id)).toString("base64"),
      });
      this.update((draft) => Object.assign(draft, { id: this.id, projectName: event.name }));
    }
  }

  /**
   * Projects ProjectCreated into a portfolio view.
   */
  class Portfolio extends Projection<PortfolioId, typeof PortfolioStateSchema> {
    /**
     * Records a portfolio projection entry and its resulting state.
     */
    async subscribe(event: ProjectCreated): Promise<void> {
      if (event.project === undefined) throw new Error("ProjectCreated requires a ProjectId.");
      await recordEntry({
        method: "portfolio",
        receiver: "Portfolio",
        correlation: projectCorrelation(event.project),
        recipientTypeUrl: TypeUrls.derive(PortfolioIdSchema),
        recipientIdBase64: Buffer.from(toBinary(PortfolioIdSchema, this.id)).toString("base64"),
      });
      this.update((draft) => Object.assign(draft, { id: this.id, name: event.name }));
    }
  }

  /**
   * Projects ProjectCreated into a Project view.
   */
  class ProjectProjection extends Projection<ProjectId, typeof ProjectProjectionStateSchema> {
    /**
     * Records a Project projection entry and its resulting state.
     */
    async subscribe(event: ProjectCreated): Promise<void> {
      if (event.project === undefined) throw new Error("ProjectCreated requires a ProjectId.");
      await recordEntry({
        method: "projection",
        receiver: "ProjectProjection",
        correlation: projectCorrelation(event.project),
        recipientTypeUrl: TypeUrls.derive(ProjectIdSchema),
        recipientIdBase64: Buffer.from(toBinary(ProjectIdSchema, this.id)).toString("base64"),
      });
      this.update((draft) => Object.assign(draft, { id: this.id, name: event.name }));
    }
  }

  const receivers: GeneratedHandlerRegistry = {
    receivers: [
      {
        receiverKind: "entity",
        receiverType: Project,
        stateSchema: ProjectStateSchema,
        handlers: [
          {
            kind: "command-assignment",
            methodName: "create",
            input: { schema: CreateProjectSchema, origin: "domestic" },
            outcomes: { returned: [ProjectCreatedSchema], thrown: [] },
            parameterCount: 1,
          },
        ],
      },
      {
        receiverKind: "entity",
        receiverType: ProjectPlanning,
        stateSchema: PlanningStateSchema,
        handlers: [
          {
            kind: "event-reaction",
            methodName: "react",
            input: { schema: ProjectCreatedSchema, origin: "domestic" },
            outcomes: { returned: [], thrown: [] },
            parameterCount: 1,
          },
        ],
      },
      {
        receiverKind: "entity",
        receiverType: ProjectStaffing,
        stateSchema: StaffingStateSchema,
        handlers: [
          {
            kind: "event-reaction",
            methodName: "react",
            input: { schema: ProjectCreatedSchema, origin: "domestic" },
            outcomes: { returned: [], thrown: [] },
            parameterCount: 1,
          },
        ],
      },
      {
        receiverKind: "entity",
        receiverType: Portfolio,
        stateSchema: PortfolioStateSchema,
        handlers: [
          {
            kind: "event-subscription",
            methodName: "subscribe",
            input: { schema: ProjectCreatedSchema, origin: "domestic" },
            outcomes: { returned: [], thrown: [] },
            parameterCount: 1,
          },
        ],
      },
      {
        receiverKind: "entity",
        receiverType: ProjectProjection,
        stateSchema: ProjectProjectionStateSchema,
        handlers: [
          {
            kind: "event-subscription",
            methodName: "subscribe",
            input: { schema: ProjectCreatedSchema, origin: "domestic" },
            outcomes: { returned: [], thrown: [] },
            parameterCount: 1,
          },
        ],
      },
    ],
  };
  const generated = new HandlerRegistryIngestor().ingest(receivers);
  const builder = BoundedContext.singleTenant(name)
    .withDeliveryStrategy(UniformAcrossAllShards.forNumber(shards))
    .add(
      new Repository({
        entityType: Project,
        schema: ProjectStateSchema,
        handlers: handlersFor<Project, typeof ProjectStateSchema>(
          generated,
          Project,
          ProjectStateSchema,
        ),
        events: [ProjectCreatedSchema],
      }),
    )
    .add(
      new Repository({
        entityType: ProjectPlanning,
        schema: PlanningStateSchema,
        handlers: handlersFor<ProjectPlanning, typeof PlanningStateSchema>(
          generated,
          ProjectPlanning,
          PlanningStateSchema,
        ),
        eventRouting: EventRouting.create<PlanningId>().route(ProjectCreatedSchema, (event) => [
          recipientIds(event).planning,
        ]),
      }),
    )
    .add(
      new Repository({
        entityType: ProjectStaffing,
        schema: StaffingStateSchema,
        handlers: handlersFor<ProjectStaffing, typeof StaffingStateSchema>(
          generated,
          ProjectStaffing,
          StaffingStateSchema,
        ),
        eventRouting: EventRouting.create<StaffingId>().route(ProjectCreatedSchema, (event) => [
          recipientIds(event).staffing,
        ]),
      }),
    )
    .add(
      new Repository({
        entityType: Portfolio,
        schema: PortfolioStateSchema,
        handlers: handlersFor<Portfolio, typeof PortfolioStateSchema>(
          generated,
          Portfolio,
          PortfolioStateSchema,
        ),
        eventRouting: EventRouting.create<PortfolioId>().route(ProjectCreatedSchema, (event) => [
          recipientIds(event).portfolio,
        ]),
      }),
    )
    .add(
      new Repository({
        entityType: ProjectProjection,
        schema: ProjectProjectionStateSchema,
        handlers: handlersFor<ProjectProjection, typeof ProjectProjectionStateSchema>(
          generated,
          ProjectProjection,
          ProjectProjectionStateSchema,
        ),
      }),
    );
  if (storageFactory !== undefined) builder.withStorageFactory(storageFactory);
  return builder.build();
}
