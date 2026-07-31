import { create } from "@bufbuild/protobuf";
import {
  Aggregate,
  Assign,
  BoundedContext,
  ProcessManager,
  Projection,
  Server,
  Subscribe,
  type RunningServer,
} from "@spine-event-engine/server";

export { projectManagementProtoModule } from "../generated/proto-module.js";

import {
  type CreateProject,
  type CreateTask,
  type EnrollPerson,
} from "../generated/spine/examples/projects/commands_pb.js";
import {
  ProjectSchema,
  TaskSchema,
  PersonSchema,
} from "../generated/spine/examples/projects/entities_pb.js";
import {
  ProjectCreatedSchema,
  TaskCreatedSchema,
  PersonEnrolledSchema,
  type PersonEnrolled,
  type ProjectCreated,
  type TaskCreated,
} from "../generated/spine/examples/projects/events_pb.js";
import {
  ActivityFeedSchema,
  AssignmentManagerSchema,
  AssignmentViewSchema,
  AssigneeWorkloadSchema,
  AuditManagerSchema,
  AuditViewSchema,
  CapacityViewSchema,
  CleanupManagerSchema,
  CleanupViewSchema,
  DueDateManagerSchema,
  DueDateViewSchema,
  NotificationManagerSchema,
  PersonIndexSchema,
  PriorityCountersSchema,
  ProgressViewSchema,
  ProjectIndexSchema,
  ProjectLifecycleManagerSchema,
  ProjectLifecycleViewSchema,
  ProjectSummarySchema,
  StatusCountersSchema,
  StatusManagerSchema,
  SubscriptionFanoutManagerSchema,
  SubscriptionFanoutViewSchema,
  TaskDependencyManagerSchema,
  TaskDependencyViewSchema,
  TaskIndexSchema,
  TaskListSchema,
  TenantViewSchema,
  UserViewSchema,
  WorkloadManagerSchema,
} from "../generated/spine/examples/projects/read_models_pb.js";

/**
 * Project aggregate used by the load scenario.
 */
export class ProjectAggregate extends Aggregate<string, typeof ProjectSchema> {
  // prettier-ignore

  /**
   * Creates a project and emits its creation event.
   *
   * @param command The requested project creation.
   * @returns The event recording the created project.
   */
  @Assign
  createProject(command: CreateProject): ProjectCreated {
    this.update((draft) =>
      Object.assign(draft, create(ProjectSchema, { id: this.id, name: command.name })),
    );
    return create(ProjectCreatedSchema, { id: this.id, name: command.name });
  }
}

/**
 * Task aggregate retained to model the fixed three-aggregate topology.
 */
export class TaskAggregate extends Aggregate<string, typeof TaskSchema> {
  // prettier-ignore

  /**
   * Creates a task and emits its creation event.
   *
   * @param command The requested task creation.
   * @returns The event recording the created task.
   */
  @Assign
  createTask(command: CreateTask): TaskCreated {
    this.update((draft) =>
      Object.assign(draft, create(TaskSchema, { id: this.id, projectId: command.projectId })),
    );
    return create(TaskCreatedSchema, { id: this.id, projectId: command.projectId });
  }
}

/**
 * Person aggregate retained to model the fixed three-aggregate topology.
 */
export class PersonAggregate extends Aggregate<string, typeof PersonSchema> {
  // prettier-ignore

  /**
   * Registers a person and emits its enrollment event.
   *
   * @param command The requested person enrollment.
   * @returns The event recording the enrolled person.
   */
  @Assign
  enrollPerson(command: EnrollPerson): PersonEnrolled {
    this.update((draft) =>
      Object.assign(draft, create(PersonSchema, { id: this.id, displayName: command.displayName })),
    );
    return create(PersonEnrolledSchema, { id: this.id, displayName: command.displayName });
  }
}

/**
 * Represents a fixed-topology row that records a triggering project's ID and name.
 */
export class ProjectSummaryProjection extends Projection<string, typeof ProjectSummarySchema> {
  // prettier-ignore

  /**
   * Records a triggering project's ID and name in the fixed-topology row.
   *
   * @param event The event that supplies the project data.
   */
  @Subscribe onProjectCreated(event: ProjectCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(ProjectSummarySchema, { id: event.id, name: event.name })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a triggering task's project ID and task ID.
 */
export class TaskListProjection extends Projection<string, typeof TaskListSchema> {
  // prettier-ignore

  /**
   * Records a triggering task's project ID and task ID in the fixed-topology row.
   *
   * @param event The event that supplies the task data.
   */
  @Subscribe onTaskCreated(event: TaskCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(TaskListSchema, { id: event.projectId, name: event.id })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a triggering task's project ID and task ID.
 */
export class StatusCountersProjection extends Projection<string, typeof StatusCountersSchema> {
  // prettier-ignore

  /**
   * Records a triggering task's project ID and task ID in the fixed-topology row.
   *
   * @param event The event that supplies the task data.
   */
  @Subscribe onTaskCreated(event: TaskCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(StatusCountersSchema, { id: event.projectId, name: event.id })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a triggering task's project ID and task ID.
 */
export class PriorityCountersProjection extends Projection<string, typeof PriorityCountersSchema> {
  // prettier-ignore

  /**
   * Records a triggering task's project ID and task ID in the fixed-topology row.
   *
   * @param event The event that supplies the task data.
   */
  @Subscribe onTaskCreated(event: TaskCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(PriorityCountersSchema, { id: event.projectId, name: event.id })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a triggering task's project ID and task ID.
 */
export class AssigneeWorkloadProjection extends Projection<string, typeof AssigneeWorkloadSchema> {
  // prettier-ignore

  /**
   * Records a triggering task's project ID and task ID in the fixed-topology row.
   *
   * @param event The event that supplies the task data.
   */
  @Subscribe onTaskCreated(event: TaskCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(AssigneeWorkloadSchema, { id: event.projectId, name: event.id })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a triggering project's ID and name.
 */
export class ActivityFeedProjection extends Projection<string, typeof ActivityFeedSchema> {
  // prettier-ignore

  /**
   * Records a triggering project's ID and name in the fixed-topology row.
   *
   * @param event The event that supplies the project data.
   */
  @Subscribe onProjectCreated(event: ProjectCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(ActivityFeedSchema, { id: event.id, name: event.name })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a triggering project's ID and name.
 */
export class TenantViewProjection extends Projection<string, typeof TenantViewSchema> {
  // prettier-ignore

  /**
   * Records a triggering project's ID and name in the fixed-topology row.
   *
   * @param event The event that supplies the project data.
   */
  @Subscribe onProjectCreated(event: ProjectCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(TenantViewSchema, { id: event.id, name: event.name })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a triggering project's ID and name.
 */
export class UserViewProjection extends Projection<string, typeof UserViewSchema> {
  // prettier-ignore

  /**
   * Records a triggering project's ID and name in the fixed-topology row.
   *
   * @param event The event that supplies the project data.
   */
  @Subscribe onProjectCreated(event: ProjectCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(UserViewSchema, { id: event.id, name: event.name })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a triggering task's project ID and task ID.
 */
export class DueDateViewProjection extends Projection<string, typeof DueDateViewSchema> {
  // prettier-ignore

  /**
   * Records a triggering task's project ID and task ID in the fixed-topology row.
   *
   * @param event The event that supplies the task data.
   */
  @Subscribe onTaskCreated(event: TaskCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(DueDateViewSchema, { id: event.projectId, name: event.id })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a triggering task's project ID and task ID.
 */
export class AssignmentViewProjection extends Projection<string, typeof AssignmentViewSchema> {
  // prettier-ignore

  /**
   * Records a triggering task's project ID and task ID in the fixed-topology row.
   *
   * @param event The event that supplies the task data.
   */
  @Subscribe onTaskCreated(event: TaskCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(AssignmentViewSchema, { id: event.projectId, name: event.id })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a triggering project's ID and name.
 */
export class ProjectLifecycleViewProjection extends Projection<
  string,
  typeof ProjectLifecycleViewSchema
> {
  // prettier-ignore

  /**
   * Records a triggering project's ID and name in the fixed-topology row.
   *
   * @param event The event that supplies the project data.
   */
  @Subscribe onProjectCreated(event: ProjectCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(ProjectLifecycleViewSchema, { id: event.id, name: event.name })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a triggering task's project ID and task ID.
 */
export class TaskDependencyViewProjection extends Projection<
  string,
  typeof TaskDependencyViewSchema
> {
  // prettier-ignore

  /**
   * Records a triggering task's project ID and task ID in the fixed-topology row.
   *
   * @param event The event that supplies the task data.
   */
  @Subscribe onTaskCreated(event: TaskCreated): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(TaskDependencyViewSchema, { id: event.projectId, name: event.id }),
      ),
    );
  }
}

/**
 * Represents a fixed-topology row that records a triggering project's ID and name.
 */
export class AuditViewProjection extends Projection<string, typeof AuditViewSchema> {
  // prettier-ignore

  /**
   * Records a triggering project's ID and name in the fixed-topology row.
   *
   * @param event The event that supplies the project data.
   */
  @Subscribe onProjectCreated(event: ProjectCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(AuditViewSchema, { id: event.id, name: event.name })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a triggering project's ID and name.
 */
export class SubscriptionFanoutViewProjection extends Projection<
  string,
  typeof SubscriptionFanoutViewSchema
> {
  // prettier-ignore

  /**
   * Records a triggering project's ID and name in the fixed-topology row.
   *
   * @param event The event that supplies the project data.
   */
  @Subscribe onProjectCreated(event: ProjectCreated): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(SubscriptionFanoutViewSchema, { id: event.id, name: event.name }),
      ),
    );
  }
}

/**
 * Represents a fixed-topology row that records a triggering project's ID and name.
 */
export class CleanupViewProjection extends Projection<string, typeof CleanupViewSchema> {
  // prettier-ignore

  /**
   * Records a triggering project's ID and name in the fixed-topology row.
   *
   * @param event The event that supplies the project data.
   */
  @Subscribe onProjectCreated(event: ProjectCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(CleanupViewSchema, { id: event.id, name: event.name })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a triggering project's ID and name.
 */
export class ProjectIndexProjection extends Projection<string, typeof ProjectIndexSchema> {
  // prettier-ignore

  /**
   * Records a triggering project's ID and name in the fixed-topology row.
   *
   * @param event The event that supplies the project data.
   */
  @Subscribe onProjectCreated(event: ProjectCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(ProjectIndexSchema, { id: event.id, name: event.name })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a triggering task's project ID and task ID.
 */
export class TaskIndexProjection extends Projection<string, typeof TaskIndexSchema> {
  // prettier-ignore

  /**
   * Records a triggering task's project ID and task ID in the fixed-topology row.
   *
   * @param event The event that supplies the task data.
   */
  @Subscribe onTaskCreated(event: TaskCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(TaskIndexSchema, { id: event.projectId, name: event.id })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a triggering person's ID and display name.
 */
export class PersonIndexProjection extends Projection<string, typeof PersonIndexSchema> {
  // prettier-ignore

  /**
   * Records a triggering person's ID and display name in the fixed-topology row.
   *
   * @param event The event that supplies the person data.
   */
  @Subscribe onPersonEnrolled(event: PersonEnrolled): void {
    this.update((draft) =>
      Object.assign(draft, create(PersonIndexSchema, { id: event.id, name: event.displayName })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a triggering person's ID and display name.
 */
export class CapacityViewProjection extends Projection<string, typeof CapacityViewSchema> {
  // prettier-ignore

  /**
   * Records a triggering person's ID and display name in the fixed-topology row.
   *
   * @param event The event that supplies the person data.
   */
  @Subscribe onPersonEnrolled(event: PersonEnrolled): void {
    this.update((draft) =>
      Object.assign(draft, create(CapacityViewSchema, { id: event.id, name: event.displayName })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a triggering task's project ID and task ID.
 */
export class ProgressViewProjection extends Projection<string, typeof ProgressViewSchema> {
  // prettier-ignore

  /**
   * Records a triggering task's project ID and task ID in the fixed-topology row.
   *
   * @param event The event that supplies the task data.
   */
  @Subscribe onTaskCreated(event: TaskCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(ProgressViewSchema, { id: event.projectId, name: event.id })),
    );
  }
}

/**
 * Represents a fixed-topology process manager with a generic update counter.
 */
export class AssignmentManager extends ProcessManager<string, typeof AssignmentManagerSchema> {
  // prettier-ignore

  /**
   * Updates the generic counter by incrementing it for a task-created event.
   *
   * @param event The task-created event that triggers the update.
   */
  @Subscribe onTaskCreated(event: TaskCreated): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(AssignmentManagerSchema, { id: this.id, updates: draft.updates + 1 }),
      ),
    );
    void event;
  }
}

/**
 * Represents a fixed-topology process manager with a generic update counter.
 */
export class DueDateManager extends ProcessManager<string, typeof DueDateManagerSchema> {
  // prettier-ignore

  /**
   * Updates the generic counter by incrementing it for a task-created event.
   *
   * @param event The task-created event that triggers the update.
   */
  @Subscribe onTaskCreated(event: TaskCreated): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(DueDateManagerSchema, { id: this.id, updates: draft.updates + 1 }),
      ),
    );
    void event;
  }
}

/**
 * Represents a fixed-topology process manager with a generic update counter.
 */
export class StatusManager extends ProcessManager<string, typeof StatusManagerSchema> {
  // prettier-ignore

  /**
   * Updates the generic counter by incrementing it for a task-created event.
   *
   * @param event The task-created event that triggers the update.
   */
  @Subscribe onTaskCreated(event: TaskCreated): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(StatusManagerSchema, { id: this.id, updates: draft.updates + 1 }),
      ),
    );
    void event;
  }
}

/**
 * Represents a fixed-topology process manager with a generic update counter.
 */
export class NotificationManager extends ProcessManager<string, typeof NotificationManagerSchema> {
  // prettier-ignore

  /**
   * Updates the generic counter by incrementing it for a project-created event.
   *
   * @param event The project-created event that triggers the update.
   */
  @Subscribe onProjectCreated(event: ProjectCreated): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(NotificationManagerSchema, { id: this.id, updates: draft.updates + 1 }),
      ),
    );
    void event;
  }
}

/**
 * Represents a fixed-topology process manager with a generic update counter.
 */
export class WorkloadManager extends ProcessManager<string, typeof WorkloadManagerSchema> {
  // prettier-ignore

  /**
   * Updates the generic counter by incrementing it for a task-created event.
   *
   * @param event The task-created event that triggers the update.
   */
  @Subscribe onTaskCreated(event: TaskCreated): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(WorkloadManagerSchema, { id: this.id, updates: draft.updates + 1 }),
      ),
    );
    void event;
  }
}

/**
 * Represents a fixed-topology process manager with a generic update counter.
 */
export class ProjectLifecycleManager extends ProcessManager<
  string,
  typeof ProjectLifecycleManagerSchema
> {
  // prettier-ignore

  /**
   * Updates the generic counter by incrementing it for a project-created event.
   *
   * @param event The project-created event that triggers the update.
   */
  @Subscribe onProjectCreated(event: ProjectCreated): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectLifecycleManagerSchema, { id: this.id, updates: draft.updates + 1 }),
      ),
    );
    void event;
  }
}

/**
 * Represents a fixed-topology process manager with a generic update counter.
 */
export class TaskDependencyManager extends ProcessManager<
  string,
  typeof TaskDependencyManagerSchema
> {
  // prettier-ignore

  /**
   * Updates the generic counter by incrementing it for a task-created event.
   *
   * @param event The task-created event that triggers the update.
   */
  @Subscribe onTaskCreated(event: TaskCreated): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(TaskDependencyManagerSchema, { id: this.id, updates: draft.updates + 1 }),
      ),
    );
    void event;
  }
}

/**
 * Represents a fixed-topology process manager with a generic update counter.
 */
export class AuditManager extends ProcessManager<string, typeof AuditManagerSchema> {
  // prettier-ignore

  /**
   * Updates the generic counter by incrementing it for a project-created event.
   *
   * @param event The project-created event that triggers the update.
   */
  @Subscribe onProjectCreated(event: ProjectCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(AuditManagerSchema, { id: this.id, updates: draft.updates + 1 })),
    );
    void event;
  }
}

/**
 * Represents a fixed-topology process manager with a generic update counter.
 */
export class SubscriptionFanoutManager extends ProcessManager<
  string,
  typeof SubscriptionFanoutManagerSchema
> {
  // prettier-ignore

  /**
   * Updates the generic counter by incrementing it for a project-created event.
   *
   * @param event The project-created event that triggers the update.
   */
  @Subscribe onProjectCreated(event: ProjectCreated): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(SubscriptionFanoutManagerSchema, { id: this.id, updates: draft.updates + 1 }),
      ),
    );
    void event;
  }
}

/**
 * Represents a fixed-topology process manager with a generic update counter.
 */
export class CleanupManager extends ProcessManager<string, typeof CleanupManagerSchema> {
  // prettier-ignore

  /**
   * Updates the generic counter by incrementing it for a person-enrolled event.
   *
   * @param event The person-enrolled event that triggers the update.
   */
  @Subscribe onPersonEnrolled(event: PersonEnrolled): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(CleanupManagerSchema, { id: this.id, updates: draft.updates + 1 }),
      ),
    );
    void event;
  }
}

interface TopologyEntry {
  readonly name: string;
  readonly command?: string;
  readonly event: string;
  readonly behavior?: string;
}

/**
 * Durable inventory of the example's intentionally fixed domain topology.
 */
export const projectManagementTopology: {
  readonly aggregates: readonly TopologyEntry[];
  readonly projections: readonly TopologyEntry[];
  readonly processManagers: readonly TopologyEntry[];
} = {
  aggregates: [
    { name: "ProjectAggregate", command: "CreateProject", event: "ProjectCreated" },
    { name: "TaskAggregate", command: "CreateTask", event: "TaskCreated" },
    { name: "PersonAggregate", command: "EnrollPerson", event: "PersonEnrolled" },
  ],
  projections: [
    ...[
      "ProjectSummaryProjection",
      "ActivityFeedProjection",
      "TenantViewProjection",
      "UserViewProjection",
      "ProjectLifecycleViewProjection",
      "AuditViewProjection",
      "SubscriptionFanoutViewProjection",
      "CleanupViewProjection",
      "ProjectIndexProjection",
    ].map((name) => ({ name, event: "ProjectCreated", behavior: "materializes project id/name" })),
    ...[
      "TaskListProjection",
      "StatusCountersProjection",
      "PriorityCountersProjection",
      "AssigneeWorkloadProjection",
      "DueDateViewProjection",
      "AssignmentViewProjection",
      "TaskDependencyViewProjection",
      "TaskIndexProjection",
      "ProgressViewProjection",
    ].map((name) => ({
      name,
      event: "TaskCreated",
      behavior: "materializes project/task correlation",
    })),
    ...["PersonIndexProjection", "CapacityViewProjection"].map((name) => ({
      name,
      event: "PersonEnrolled",
      behavior: "materializes person identity",
    })),
  ],
  processManagers: [
    { name: "AssignmentManager", event: "TaskCreated", behavior: "increments workflow updates" },
    { name: "DueDateManager", event: "TaskCreated", behavior: "increments workflow updates" },
    { name: "StatusManager", event: "TaskCreated", behavior: "increments workflow updates" },
    {
      name: "NotificationManager",
      event: "ProjectCreated",
      behavior: "increments workflow updates",
    },
    { name: "WorkloadManager", event: "TaskCreated", behavior: "increments workflow updates" },
    {
      name: "ProjectLifecycleManager",
      event: "ProjectCreated",
      behavior: "increments workflow updates",
    },
    {
      name: "TaskDependencyManager",
      event: "TaskCreated",
      behavior: "increments workflow updates",
    },
    { name: "AuditManager", event: "ProjectCreated", behavior: "increments workflow updates" },
    {
      name: "SubscriptionFanoutManager",
      event: "ProjectCreated",
      behavior: "increments workflow updates",
    },
    { name: "CleanupManager", event: "PersonEnrolled", behavior: "increments workflow updates" },
  ],
} as const;

/**
 * Creates the fixed project-management topology with in-memory storage.
 *
 * @returns The assembled bounded context.
 */
export async function createProjectManagementContext(): Promise<BoundedContext> {
  return BoundedContext.singleTenant("ProjectManagement")
    .withGeneratedRegistryRoot(new URL("..", import.meta.url))
    .add(ProjectAggregate)
    .add(TaskAggregate)
    .add(PersonAggregate)
    .add(ProjectSummaryProjection)
    .add(TaskListProjection)
    .add(StatusCountersProjection)
    .add(PriorityCountersProjection)
    .add(AssigneeWorkloadProjection)
    .add(ActivityFeedProjection)
    .add(TenantViewProjection)
    .add(UserViewProjection)
    .add(DueDateViewProjection)
    .add(AssignmentViewProjection)
    .add(ProjectLifecycleViewProjection)
    .add(TaskDependencyViewProjection)
    .add(AuditViewProjection)
    .add(SubscriptionFanoutViewProjection)
    .add(CleanupViewProjection)
    .add(ProjectIndexProjection)
    .add(TaskIndexProjection)
    .add(PersonIndexProjection)
    .add(CapacityViewProjection)
    .add(ProgressViewProjection)
    .add(AssignmentManager)
    .add(DueDateManager)
    .add(StatusManager)
    .add(NotificationManager)
    .add(WorkloadManager)
    .add(ProjectLifecycleManager)
    .add(TaskDependencyManager)
    .add(AuditManager)
    .add(SubscriptionFanoutManager)
    .add(CleanupManager)
    .buildAsync();
}

/**
 * Configures the local project-management server.
 */
export interface ProjectManagementServerOptions {
  // prettier-ignore

  /**
   * Specifies the network host to bind.
   */
  readonly host?: string;

  /**
   * Specifies the network port to bind.
   */
  readonly port?: number;
}

/**
 * Represents a running project-management server.
 */
export type ProjectManagementServer = RunningServer;

/**
 * Starts the local gRPC-compatible server used by smoke and load clients.
 *
 * @param options The network binding options for the server.
 * @returns The running project-management server.
 */
export async function startProjectManagementServer(
  options: ProjectManagementServerOptions = {},
): Promise<ProjectManagementServer> {
  return Server.atPort(options.port ?? 0, { host: options.host ?? "127.0.0.1" })
    .add(await createProjectManagementContext())
    .start();
}
