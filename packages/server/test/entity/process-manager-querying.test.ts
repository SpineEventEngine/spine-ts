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

import { create, type MessageShape } from "@bufbuild/protobuf";
import { AnyMessages, EntityColumn, EntityQuery, TypeUrls } from "@spine-event-engine/core";
import { GeneratedEntityColumns } from "@spine-event-engine/core/codegen";
import {
  ActorContextSchema,
  CommandSchema,
  CommandContextSchema,
  CommandIdSchema,
  TenantIdSchema,
  UserIdSchema,
  VersionSchema,
  ZoneIdSchema,
} from "@spine-event-engine/proto";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";

import {
  Aggregate,
  BoundedContext,
  type DescriptorMessageSchema,
  EntityHandlers,
  type EntityOptions,
  ProcessManager,
  Projection,
  Repository,
  Server,
} from "../../src/index.js";
import { processManagerQueryAccess } from "../../src/entity/entity.js";
import { HandlerMetadataValues } from "../../src/handler/handler-metadata.js";
import { QueryReader } from "../../src/services/query-reader.js";
import { RegisteredTargets } from "../../src/services/registered-targets.js";
import {
  type ProjectState,
  ProjectStateSchema,
  type ProjectOverviewState,
  ProjectOverviewStateSchema,
} from "../../test-fixtures/generated/entity-metadata/project_states_pb.js";
import { ProcessManagerStateSchema } from "../../test-fixtures/generated/entity-metadata/visibility_pb.js";
import {
  type ProjectReviewState,
  ProjectReviewStateSchema,
  ProjectQueueStateSchema,
} from "../../test-fixtures/generated/repository-routing/project_states_pb.js";
import {
  type ProjectCreated as ProjectionEvent,
  ProjectCreatedSchema as ProjectionEventSchema,
} from "../../test-fixtures/generated/repository-routing/project_events_pb.js";
import {
  type CreateReviewProject,
  CreateReviewProjectSchema,
} from "../../test-fixtures/generated/validation-refusal/project_commands_pb.js";

const closePhase = vi.hoisted(() => ({
  onBegin: undefined as ((context: unknown) => void) | undefined,
}));

vi.mock("../../src/context/bounded-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/context/bounded-context.js")>();
  return {
    ...actual,
    boundedContextAccess: {
      ...actual.boundedContextAccess,
      beginClose(context: BoundedContext) {
        actual.boundedContextAccess.beginClose(context);
        closePhase.onBegin?.(context);
      },
    },
  };
});

const projectionColumns = EntityColumn.register(
  ProjectOverviewStateSchema,
  GeneratedEntityColumns.define(ProjectOverviewStateSchema, {
    name: { field: ProjectOverviewStateSchema.field.name, comparison: "ordering" },
    priority: { field: ProjectOverviewStateSchema.field.priority, comparison: "ordering" },
  }),
);
const equivalentProjectionSchema = { ...ProjectOverviewStateSchema };
const selectedProjectionColumns: Pick<typeof projectionColumns, "priority"> = projectionColumns;
const aggregateColumns = EntityColumn.register(
  ProjectStateSchema,
  GeneratedEntityColumns.define(ProjectStateSchema, {
    name: { field: ProjectStateSchema.field.name, comparison: "ordering" },
  }),
);
const queueColumns = EntityColumn.register(
  ProjectQueueStateSchema,
  GeneratedEntityColumns.define(ProjectQueueStateSchema, {
    queue: { field: ProjectQueueStateSchema.field.queue, comparison: "ordering" },
  }),
);
const reviewColumns = EntityColumn.register(
  ProjectReviewStateSchema,
  GeneratedEntityColumns.define(ProjectReviewStateSchema, {
    queue: { field: ProjectReviewStateSchema.field.queue, comparison: "ordering" },
  }),
);

class ProjectQueue extends ProcessManager<string, typeof ProjectQueueStateSchema> {}

class ProjectReview extends ProcessManager<string, typeof ProjectReviewStateSchema> {}

class HiddenLookup extends ProcessManager<string, typeof ProcessManagerStateSchema> {
  static failure: unknown;
  static completed = false;

  async assign(command: CreateReviewProject): Promise<ProjectionEvent> {
    try {
      await this.select(ProjectQueueStateSchema, queueColumns).all();
    } catch (error) {
      HiddenLookup.failure = error;
    } finally {
      HiddenLookup.completed = true;
    }
    return create(ProjectionEventSchema, { id: command.id, name: command.name });
  }
}

class QueryProjection extends Projection<string, typeof ProjectOverviewStateSchema> {
  subscribe(event: ProjectionEvent): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectOverviewStateSchema, {
          id: event.id,
          name: event.name,
          priority: event.priority,
        }),
      ),
    );
  }
}

interface ProjectionNameFilter {
  match(name: string): string;
}

const identityNameFilter: ProjectionNameFilter = { match: (name) => name };

class ProjectLookup extends ProcessManager<string, typeof ProcessManagerStateSchema> {
  static results: readonly ProjectOverviewState[] = [];
  static aggregateResults: readonly ProjectState[] = [];
  static reviewResults: readonly ProjectReviewState[] = [];
  static predicate: unknown;
  static failure: unknown;

  constructor(
    options: EntityOptions<string, typeof ProcessManagerStateSchema>,
    private readonly nameFilter: ProjectionNameFilter,
  ) {
    super(options);
  }

  static reset(): void {
    this.results = [];
    this.aggregateResults = [];
    this.reviewResults = [];
    this.predicate = undefined;
    this.failure = undefined;
  }

  query() {
    return this.select(ProjectOverviewStateSchema, projectionColumns);
  }

  async assign(command: CreateReviewProject): Promise<ProjectionEvent> {
    try {
      if (command.name === "aggregate") {
        ProjectLookup.aggregateResults = await this.select(ProjectStateSchema, aggregateColumns)
          .byId(command.id)
          .read();
      } else if (command.name === "review") {
        ProjectLookup.reviewResults = await this.select(ProjectReviewStateSchema, reviewColumns)
          .byId(command.id)
          .read();
      } else if (command.name === "equivalent") {
        ProjectLookup.results = await this.select(equivalentProjectionSchema, projectionColumns)
          .byId(command.id)
          .read();
      } else if (command.name === "compound") {
        ProjectLookup.results = await this.query()
          .where(
            EntityQuery.all(
              EntityQuery.either(
                EntityQuery.eq(projectionColumns.name, "ready"),
                EntityQuery.eq(projectionColumns.name, "waiting"),
              ),
              EntityQuery.gt(projectionColumns.priority, 0),
            ),
          )
          .orderBy(projectionColumns.priority, "desc")
          .limit(1)
          .mask("name")
          .all();
      } else {
        const query = this.query();
        if (ProjectLookup.predicate !== undefined) {
          query.where(ProjectLookup.predicate as never);
        }
        ProjectLookup.results =
          command.name === "all"
            ? await query.all()
            : await query
                .byId(command.id)
                .where(EntityQuery.eq(projectionColumns.name, this.nameFilter.match(command.name)))
                .read();
      }
    } catch (error) {
      ProjectLookup.failure = error;
      throw error;
    }
    this.update((draft) => {
      draft.queue = `read ${String(ProjectLookup.results.length)}`;
    });
    return create(ProjectionEventSchema, {
      id: command.id,
      name: ProjectLookup.results[0]?.name ?? "none",
      priority: ProjectLookup.results[0]?.priority ?? 0,
    });
  }
}

abstract class QueryTypeFixture extends ProcessManager<string, typeof ProcessManagerStateSchema> {
  protected verifySelectedColumn(): void {
    const query = this.select(ProjectOverviewStateSchema, selectedProjectionColumns);
    query.orderBy(selectedProjectionColumns.priority);
    // @ts-expect-error A column omitted from the selected collection cannot be ordered.
    query.orderBy(projectionColumns.name);
  }
}
void QueryTypeFixture;

function projectionRepository(): Repository<typeof QueryProjection> {
  return new Repository({
    entityType: QueryProjection,
    schema: ProjectOverviewStateSchema,
    handlers: EntityHandlers.define(QueryProjection, ProjectOverviewStateSchema, (builder) => [
      builder.subscribe(ProjectionEventSchema, "subscribe"),
    ]),
  });
}

function processManagerRepository(
  nameFilter: ProjectionNameFilter = identityNameFilter,
  createdVersions?: number[],
): Repository<typeof ProjectLookup> {
  return new Repository({
    entityType: ProjectLookup,
    schema: ProcessManagerStateSchema,
    handlers: HandlerMetadataValues.defineArity(
      ProjectLookup,
      ProcessManagerStateSchema,
      (builder) => [builder.assign(CreateReviewProjectSchema, "assign")],
      [
        {
          kind: "command-assignment",
          methodName: "assign",
          parameterCount: 1,
          origin: "domestic",
          outcomes: { returned: [ProjectionEventSchema], thrown: [] },
        },
      ],
    ),
    events: [ProjectionEventSchema],
    onCreate(options) {
      createdVersions?.push(options.version?.number ?? -1);
      return new ProjectLookup(options, nameFilter);
    },
  });
}

function hiddenLookupRepository(): Repository<typeof HiddenLookup> {
  return new Repository({
    entityType: HiddenLookup,
    schema: ProcessManagerStateSchema,
    handlers: HandlerMetadataValues.defineArity(
      HiddenLookup,
      ProcessManagerStateSchema,
      (builder) => [builder.assign(CreateReviewProjectSchema, "assign")],
      [
        {
          kind: "command-assignment",
          methodName: "assign",
          parameterCount: 1,
          origin: "domestic",
          outcomes: { returned: [ProjectionEventSchema], thrown: [] },
        },
      ],
    ),
    events: [ProjectionEventSchema],
  });
}

function queryCommand(id: string, name: string, tenant?: string, suffix?: string) {
  return create(CommandSchema, {
    id: create(CommandIdSchema, {
      uuid: `query-${id}-${name}${suffix === undefined ? "" : `-${suffix}`}`,
    }),
    context: create(CommandContextSchema, {
      actorContext: create(ActorContextSchema, {
        actor: create(UserIdSchema, { value: "query-user" }),
        ...(tenant === undefined
          ? {}
          : {
              tenantId: create(TenantIdSchema, {
                kind: { case: "value", value: tenant },
              }),
            }),
      }),
    }),
    message: AnyMessages.pack(
      CreateReviewProjectSchema,
      create(CreateReviewProjectSchema, { id, name }),
    ),
  });
}

describe("Process Manager querying", () => {
  it("finds a registered Entity in another context of the same server", async () => {
    ProjectLookup.reset();
    const projects = BoundedContext.singleTenant("Projects").add(projectionRepository()).build();
    const workflows = BoundedContext.singleTenant("Workflows")
      .add(processManagerRepository())
      .build();
    await projects
      .stand()
      .update(
        ProjectOverviewStateSchema,
        create(ProjectOverviewStateSchema, { id: "project-1", name: "ready", priority: 1 }),
      );
    const running = await Server.atPort(0).add(workflows).add(projects).start();

    try {
      await workflows.commandBus().post(queryCommand("project-1", "ready"));
      await vi.waitFor(() => {
        expect(ProjectLookup.failure).toBeUndefined();
        expect(ProjectLookup.results).toEqual([
          create(ProjectOverviewStateSchema, { id: "project-1", name: "ready", priority: 1 }),
        ]);
      });
      await workflows.commandBus().post(queryCommand("missing", "ready"));
      await vi.waitFor(() => {
        expect(ProjectLookup.results).toEqual([]);
      });
      expect(ProjectLookup.failure).toBeUndefined();
    } finally {
      await running.close();
    }
  });

  it("installs complete routes before recovery enumerates tenant work", async () => {
    const factory = new InMemoryStorageFactory();
    const projects = BoundedContext.multitenant("RecoverProjects")
      .withStorageFactory(factory)
      .add(projectionRepository())
      .build();
    const workflows = BoundedContext.multitenant("RecoverWorkflows")
      .withStorageFactory(factory)
      .add(processManagerRepository())
      .build();
    const catalog = factory.tenantCatalog();
    const originalAll = catalog.all.bind(catalog);
    let recoveryScopes = 0;
    const all = vi.spyOn(catalog, "all").mockImplementation(() => {
      recoveryScopes += 1;
      expect(
        RegisteredTargets.forStand(workflows.stand())?.find(
          TypeUrls.derive(ProjectOverviewStateSchema),
        )?.context,
      ).toBe(projects);
      return originalAll();
    });

    try {
      const running = await Server.atPort(0).add(workflows).add(projects).start();
      expect(recoveryScopes).toBeGreaterThan(0);
      await running.close();
    } finally {
      all.mockRestore();
    }
  });

  it.each(["target-first", "handler-first"])(
    "drains accepted cross-context handler reads during %s shutdown",
    async (order) => {
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const projects = BoundedContext.singleTenant("ClosingProjects")
        .add(projectionRepository())
        .build();
      const results: ProjectOverviewState[][] = [];
      const workflows = BoundedContext.singleTenant("ClosingWorkflows")
        .addCommandDispatcher({
          messageSchemas: () => [CreateReviewProjectSchema],
          async dispatch() {
            enter();
            await released;
            const states = await projects.stand().readAllVersioned(ProjectOverviewStateSchema);
            results.push(states.map((result) => result.state));
          },
        })
        .build();
      await projects
        .stand()
        .update(
          ProjectOverviewStateSchema,
          create(ProjectOverviewStateSchema, { id: "project-1", name: "ready", priority: 1 }),
        );
      const contexts = order === "target-first" ? [projects, workflows] : [workflows, projects];
      const server = Server.atPort(0);
      for (const context of contexts) server.add(context);
      const running = await server.start();
      let began!: () => void;
      const sourceClosing = new Promise<void>((resolve) => {
        began = resolve;
      });
      closePhase.onBegin = (context) => {
        if (context === workflows) began();
      };

      try {
        const posting = workflows
          .commandBus()
          .post(queryCommand("project-1", "ready"))
          .then(
            () => undefined,
            (error: unknown) => error,
          );
        await entered;
        const closing = running.close();
        await sourceClosing;
        expect(() => projects.stand().stateTypes()).not.toThrow();
        release();
        expect(await posting).toBeUndefined();
        await closing;
        expect(results).toEqual([
          [create(ProjectOverviewStateSchema, { id: "project-1", name: "ready", priority: 1 })],
        ]);
      } finally {
        closePhase.onBegin = undefined;
        release();
        await running.close();
      }
    },
  );

  it("reads the same named tenant in a multitenant destination", async () => {
    ProjectLookup.reset();
    const projects = BoundedContext.multitenant("TenantProjects")
      .add(projectionRepository())
      .build();
    const workflows = BoundedContext.multitenant("TenantWorkflows")
      .add(processManagerRepository())
      .build();
    await projects
      .stand()
      .update(
        ProjectOverviewStateSchema,
        create(ProjectOverviewStateSchema, { id: "shared", name: "A", priority: 1 }),
        { tenantId: create(TenantIdSchema, { kind: { case: "value", value: "tenant-a" } }) },
      );
    await projects
      .stand()
      .update(
        ProjectOverviewStateSchema,
        create(ProjectOverviewStateSchema, { id: "shared", name: "B", priority: 2 }),
        { tenantId: create(TenantIdSchema, { kind: { case: "value", value: "tenant-b" } }) },
      );
    const running = await Server.atPort(0).add(projects).add(workflows).start();

    try {
      await workflows.commandBus().post(queryCommand("shared", "B", "tenant-b"));
      await vi.waitFor(() => {
        expect(ProjectLookup.results).toEqual([
          create(ProjectOverviewStateSchema, { id: "shared", name: "B", priority: 2 }),
        ]);
      });
      expect(ProjectLookup.failure).toBeUndefined();
    } finally {
      await running.close();
    }
  });

  it("reads a query-visible Aggregate registered in another context", async () => {
    ProjectLookup.reset();
    class ProjectAggregate extends Aggregate<string, typeof ProjectStateSchema> {}
    const projects = BoundedContext.singleTenant("AggregateProjects")
      .add(
        new Repository({
          entityType: ProjectAggregate,
          schema: ProjectStateSchema,
          handlers: EntityHandlers.define(ProjectAggregate, ProjectStateSchema, () => []),
        }),
      )
      .build();
    const workflows = BoundedContext.singleTenant("AggregateWorkflows")
      .add(processManagerRepository())
      .build();
    await projects
      .stand()
      .update(ProjectStateSchema, create(ProjectStateSchema, { id: "project-1", name: "ready" }));
    const running = await Server.atPort(0).add(workflows).add(projects).start();

    try {
      await workflows.commandBus().post(queryCommand("project-1", "aggregate"));
      await vi.waitFor(() => {
        expect(ProjectLookup.aggregateResults).toHaveLength(1);
      });
      expect(ProjectLookup.aggregateResults[0]).toEqual(
        create(ProjectStateSchema, { id: "project-1", name: "ready" }),
      );
      expect(ProjectLookup.failure).toBeUndefined();
    } finally {
      await running.close();
    }
  });

  it("reads a query-visible Process Manager registered in another context", async () => {
    ProjectLookup.reset();
    const reviews = BoundedContext.singleTenant("ReviewProjects")
      .add(
        new Repository({
          entityType: ProjectReview,
          schema: ProjectReviewStateSchema,
          handlers: EntityHandlers.define(ProjectReview, ProjectReviewStateSchema, () => []),
        }),
      )
      .build();
    const workflows = BoundedContext.singleTenant("ReviewWorkflows")
      .add(processManagerRepository())
      .build();
    await reviews
      .stand()
      .update(
        ProjectReviewStateSchema,
        create(ProjectReviewStateSchema, { id: "project-1", queue: "ready" }),
      );
    const running = await Server.atPort(0).add(workflows).add(reviews).start();

    try {
      await workflows.commandBus().post(queryCommand("project-1", "review"));
      await vi.waitFor(() => {
        expect(ProjectLookup.reviewResults).toHaveLength(1);
      });
      expect(ProjectLookup.reviewResults[0]).toEqual(
        create(ProjectReviewStateSchema, { id: "project-1", queue: "ready" }),
      );
      expect(ProjectLookup.failure).toBeUndefined();
    } finally {
      await running.close();
    }
  });

  it("accepts an equivalent descriptor instance for a registered state type", async () => {
    ProjectLookup.reset();
    expect(equivalentProjectionSchema).not.toBe(ProjectOverviewStateSchema);
    const projects = BoundedContext.singleTenant("EquivalentProjects")
      .add(projectionRepository())
      .build();
    const workflows = BoundedContext.singleTenant("EquivalentWorkflows")
      .add(processManagerRepository())
      .build();
    await projects
      .stand()
      .update(
        ProjectOverviewStateSchema,
        create(ProjectOverviewStateSchema, { id: "project-1", name: "ready", priority: 1 }),
      );
    const running = await Server.atPort(0).add(workflows).add(projects).start();

    try {
      await workflows.commandBus().post(queryCommand("project-1", "equivalent"));
      await vi.waitFor(() => {
        expect(ProjectLookup.results).toHaveLength(1);
      });
      expect(ProjectLookup.results[0]?.name).toBe("ready");
      expect(ProjectLookup.failure).toBeUndefined();
    } finally {
      await running.close();
    }
  });

  it("validates foreign query fields against the registered target", () => {
    const projects = BoundedContext.singleTenant("ValidatedProjects")
      .add(projectionRepository())
      .build();
    const targets = new RegisteredTargets([projects]);
    const target = targets.find(TypeUrls.derive(ProjectOverviewStateSchema));
    if (target === undefined) throw new Error("Projection registration was not found.");
    const comparison = (column: string) => ({
      kind: "comparison" as const,
      column,
      operator: "equal" as const,
      value: "ready",
    });

    expect(() => {
      targets.validate(target, {
        predicate: {
          kind: "all",
          predicates: [
            comparison("name"),
            { kind: "either", predicates: [comparison("priority"), comparison("name")] },
          ],
        },
        order: [{ column: "priority", direction: "desc" }],
        mask: { paths: ["name"] },
      });
    }).not.toThrow();
    expect(() => {
      targets.validate(target, { predicate: comparison("other") });
    }).toThrow('Query column "other" is not registered');
    expect(() => {
      targets.validate(target, { order: [{ column: "other", direction: "asc" }] });
    }).toThrow('Query column "other" is not registered');
    expect(() => {
      targets.validate(target, { mask: { paths: ["other"] } });
    }).toThrow('Query mask field "other" is not registered');
  });

  it("preserves compound filters, ordering, limit, mask, and detached results across contexts", async () => {
    ProjectLookup.reset();
    const projects = BoundedContext.singleTenant("QueryOptionsProjects")
      .add(projectionRepository())
      .build();
    const workflows = BoundedContext.singleTenant("QueryOptionsWorkflows")
      .add(processManagerRepository())
      .build();
    for (const [id, name, priority] of [
      ["one", "waiting", 1],
      ["two", "ready", 2],
      ["three", "excluded", 3],
    ] as const) {
      await projects
        .stand()
        .update(
          ProjectOverviewStateSchema,
          create(ProjectOverviewStateSchema, { id, name, priority }),
        );
    }
    const running = await Server.atPort(0).add(workflows).add(projects).start();

    try {
      await workflows.commandBus().post(queryCommand("two", "compound"));
      await vi.waitFor(() => {
        expect(ProjectLookup.results).toHaveLength(1);
      });
      expect(ProjectLookup.results[0]?.name).toBe("ready");
      expect(ProjectLookup.results[0]?.priority).toBe(0);
      const first = ProjectLookup.results[0];
      if (first === undefined) throw new Error("The selected result was not returned.");
      first.name = "changed";
      await workflows.commandBus().post(queryCommand("two", "compound", undefined, "again"));
      await vi.waitFor(() => {
        expect(ProjectLookup.results[0]?.name).toBe("ready");
      });
      expect(ProjectLookup.failure).toBeUndefined();
    } finally {
      await running.close();
    }
  });

  it("uses SINGLE_TENANT in a multitenant destination", async () => {
    ProjectLookup.reset();
    const projects = BoundedContext.multitenant("TenantProjects")
      .add(projectionRepository())
      .build();
    const workflows = BoundedContext.singleTenant("SingleWorkflows")
      .add(processManagerRepository())
      .build();
    const singleTenant = create(TenantIdSchema, {
      kind: { case: "value", value: "SINGLE_TENANT" },
    });
    await projects
      .stand()
      .update(
        ProjectOverviewStateSchema,
        create(ProjectOverviewStateSchema, { id: "shared", name: "single", priority: 1 }),
        { tenantId: singleTenant },
      );
    const observed: unknown[] = [];
    const observation = QueryReader.observe((query) => observed.push(query));
    const running = await Server.atPort(0).add(workflows).add(projects).start();

    try {
      await workflows.commandBus().post(queryCommand("shared", "single"));
      await vi.waitFor(() => {
        expect(ProjectLookup.results).toHaveLength(1);
      });
      expect(ProjectLookup.results[0]?.name).toBe("single");
      expect(observed[0]).toMatchObject({ context: { tenantId: singleTenant } });
    } finally {
      observation.close();
      await running.close();
    }
  });

  it.each([
    ["FirstProjects", "SecondProjects"],
    ["SecondProjects", "FirstProjects"],
  ])("rejects duplicate state registration in %s then %s", async (first, second) => {
    const firstContext = BoundedContext.singleTenant(first).add(projectionRepository()).build();
    const secondContext = BoundedContext.singleTenant(second).add(projectionRepository()).build();
    let closedResources = 0;
    let startedLifecycles = 0;
    const server = Server.atPort(0)
      .add(firstContext)
      .add(secondContext)
      .addResource({
        close: () => {
          closedResources += 1;
        },
      })
      .addListenerLifecycle({
        start: () => {
          startedLifecycles += 1;
        },
        close: () => undefined,
      });

    await expect(server.start()).rejects.toThrow(
      new RegExp(`ProjectOverviewState.*${first}.*${second}`),
    );
    expect(closedResources).toBe(1);
    expect(startedLifecycles).toBe(0);
    await expect(firstContext.stand().readAllVersioned(ProjectOverviewStateSchema)).rejects.toThrow(
      "Stand is closed.",
    );
    await expect(
      secondContext.stand().readAllVersioned(ProjectOverviewStateSchema),
    ).rejects.toThrow("Stand is closed.");
  });

  it("retries failed cleanup after duplicate registration without starting delivery", async () => {
    const first = BoundedContext.singleTenant("RetryProjectsOne")
      .add(projectionRepository())
      .build();
    const second = BoundedContext.singleTenant("RetryProjectsTwo")
      .add(projectionRepository())
      .build();
    let closes = 0;
    const server = Server.atPort(0)
      .add(first)
      .add(second)
      .addResource({
        close() {
          closes += 1;
          if (closes === 1) throw new Error("resource close failed");
        },
      });

    let rejected: unknown;
    try {
      await server.start();
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toBeInstanceOf(AggregateError);
    if (!(rejected instanceof AggregateError)) throw new Error("Expected failed cleanup causes.");
    const messages = rejected.errors.map((error: unknown) =>
      error instanceof Error ? error.message : String(error),
    );
    expect(messages[0]).toContain("ProjectOverviewState");
    expect(messages[1]).toBe("resource close failed");
    expect(closes).toBe(1);
    await expect(server.start()).rejects.toThrow(/deferred cleanup completed/);
    expect(closes).toBe(2);
  });

  it("does not discover targets attached to another Server", async () => {
    ProjectLookup.reset();
    const projects = BoundedContext.singleTenant("OtherProjects")
      .add(projectionRepository())
      .build();
    const workflows = BoundedContext.singleTenant("LocalWorkflows")
      .add(processManagerRepository())
      .build();
    const projectsServer = await Server.atPort(0).add(projects).start();
    const workflowsServer = await Server.atPort(0).add(workflows).start();
    let reads = 0;
    const observation = QueryReader.observe(() => {
      reads += 1;
    });

    try {
      await workflows.commandBus().post(queryCommand("project-1", "ready"));
      await vi.waitFor(() => {
        expect(ProjectLookup.failure).toBeInstanceOf(Error);
      });
      expect((ProjectLookup.failure as Error).message).toContain("No bounded context registered");
      expect(reads).toBe(0);
    } finally {
      observation.close();
      await workflowsServer.close();
      await projectsServer.close();
    }
  });

  it("rejects a foreign Entity without query visibility before reading", async () => {
    HiddenLookup.failure = undefined;
    HiddenLookup.completed = false;
    const hidden = BoundedContext.singleTenant("HiddenProjects")
      .add(
        new Repository({
          entityType: ProjectQueue,
          schema: ProjectQueueStateSchema,
          handlers: EntityHandlers.define(ProjectQueue, ProjectQueueStateSchema, () => []),
        }),
      )
      .build();
    const workflows = BoundedContext.singleTenant("VisibleWorkflows")
      .add(hiddenLookupRepository())
      .build();
    const running = await Server.atPort(0).add(hidden).add(workflows).start();
    let reads = 0;
    const observation = QueryReader.observe(() => {
      reads += 1;
    });

    try {
      await workflows.commandBus().post(queryCommand("project-1", "ready"));
      await vi.waitFor(() => {
        expect(HiddenLookup.completed).toBe(true);
      });
      expect(HiddenLookup.failure).toBeInstanceOf(Error);
      expect((HiddenLookup.failure as Error).message).toMatch(/visibility|query/i);
      expect(reads).toBe(0);
    } finally {
      observation.close();
      await running.close();
    }
  });

  it("rejects a named tenant before reading a single-tenant target", async () => {
    ProjectLookup.reset();
    const projects = BoundedContext.singleTenant("SingleProjects")
      .add(projectionRepository())
      .build();
    const workflows = BoundedContext.multitenant("TenantWorkflows")
      .add(processManagerRepository())
      .build();
    let reads = 0;
    const observation = QueryReader.observe(() => {
      reads += 1;
    });
    const running = await Server.atPort(0).add(projects).add(workflows).start();

    try {
      await workflows.commandBus().post(queryCommand("project-1", "ready", "tenant-a"));
      await vi.waitFor(() => {
        expect(ProjectLookup.failure).toBeInstanceOf(Error);
      });
      expect((ProjectLookup.failure as Error).message).toMatch(/tenant/i);
      expect(ProjectLookup.results).toEqual([]);
      expect(reads).toBe(0);
    } finally {
      observation.close();
      await running.close();
    }
  });

  it("offers a typed, read-only query only during handler execution", async () => {
    const lookup = new ProjectLookup(
      {
        id: "process-1",
        schema: ProcessManagerStateSchema,
        state: create(ProcessManagerStateSchema, { id: "process-1", queue: "waiting" }),
        version: create(VersionSchema, { number: 1 }),
        lifecycle: { archived: false, deleted: false },
      },
      identityNameFilter,
    );

    expect(() => lookup.query()).toThrow(
      "Process Manager queries are available only during repository handler execution.",
    );

    const release = processManagerQueryAccess.bind(
      lookup,
      () => Promise.resolve(Object.freeze([])),
      create(ActorContextSchema),
    );
    const query = lookup
      .query()
      .byId("projection-1")
      .where(EntityQuery.eq(projectionColumns.name, "waiting"))
      .orderBy(projectionColumns.priority);

    // @ts-expect-error A number is not the selected string identifier.
    query.byId(1);
    // @ts-expect-error Equality-only lifecycle columns are not orderable.
    query.orderBy(projectionColumns.archived);
    expect(query).toHaveProperty("read");
    expect(query).toHaveProperty("findById");
    expect(query).toHaveProperty("all");
    expect(query).not.toHaveProperty("update");
    expect(query).not.toHaveProperty("stand");
    expect(query).not.toHaveProperty("tenant");
    expectTypeOf(query).not.toHaveProperty("update");
    expectTypeOf(query).not.toHaveProperty("tenant");
    expectTypeOf<Aggregate<string, typeof ProjectOverviewStateSchema>>().not.toHaveProperty(
      "select",
    );
    expect(() => query.limit(1_001)).toThrow("Process Manager query limit may be at most 1000.");

    release();
    await expect(query.read()).rejects.toThrow(
      "Process Manager queries are available only during repository handler execution.",
    );
  });

  it("caps an unlimited read at 1,000 states", async () => {
    const lookup = new ProjectLookup(
      {
        id: "process-1",
        schema: ProcessManagerStateSchema,
        state: create(ProcessManagerStateSchema, { id: "process-1", queue: "waiting" }),
        version: create(VersionSchema, { number: 1 }),
        lifecycle: { archived: false, deleted: false },
      },
      identityNameFilter,
    );
    const states = Object.freeze(
      Array.from({ length: 1_001 }, (_, index) =>
        create(ProjectOverviewStateSchema, {
          id: `state-${String(index)}`,
          name: "waiting",
          priority: index,
        }),
      ),
    );
    const release = processManagerQueryAccess.bind(
      lookup,
      <Schema extends DescriptorMessageSchema>(
        _plan: import("@spine-event-engine/core/spi/entity-query-plan").EntityQueryPlan,
        schema: Schema,
      ): Promise<readonly MessageShape<Schema>[]> => {
        if (schema.typeName !== ProjectOverviewStateSchema.typeName) {
          return Promise.reject(new Error("Expected a Projection query."));
        }
        return Promise.resolve(states as unknown as readonly MessageShape<Schema>[]);
      },
      create(ActorContextSchema),
    );

    await expect(lookup.query().all()).resolves.toHaveLength(1_000);
    release();
  });

  it("reads only projection state from the active tenant", async () => {
    ProjectLookup.reset();
    const matchedNames: string[] = [];
    const createdVersions: number[] = [];
    const nameFilter: ProjectionNameFilter = {
      match(name) {
        matchedNames.push(name);
        return name;
      },
    };
    const context = BoundedContext.multitenant("ProcessManagerQueries")
      .add(projectionRepository())
      .add(processManagerRepository(nameFilter, createdVersions))
      .build();
    const tenantA = create(TenantIdSchema, { kind: { case: "value", value: "tenant-a" } });
    const tenantB = create(TenantIdSchema, { kind: { case: "value", value: "tenant-b" } });

    try {
      await context
        .stand()
        .update(
          ProjectOverviewStateSchema,
          create(ProjectOverviewStateSchema, { id: "shared", name: "A", priority: 1 }),
          { tenantId: tenantA },
        );
      await context
        .stand()
        .update(
          ProjectOverviewStateSchema,
          create(ProjectOverviewStateSchema, { id: "shared", name: "B", priority: 2 }),
          { tenantId: tenantB },
        );

      await context.commandBus().post(queryCommand("shared", "A", "tenant-a"));
      expect(ProjectLookup.results).toEqual([
        create(ProjectOverviewStateSchema, { id: "shared", name: "A", priority: 1 }),
      ]);

      await context.commandBus().post(queryCommand("shared", "B", "tenant-b"));
      expect(ProjectLookup.results).toEqual([
        create(ProjectOverviewStateSchema, { id: "shared", name: "B", priority: 2 }),
      ]);

      await context.commandBus().post(queryCommand("shared", "A", "tenant-a", "restored"));
      expect(ProjectLookup.results).toEqual([
        create(ProjectOverviewStateSchema, { id: "shared", name: "A", priority: 1 }),
      ]);
      expect(createdVersions).toEqual([0, 0, 1]);
      expect(matchedNames).toEqual(["A", "B", "A"]);
    } finally {
      await context.close();
    }
  });

  it("passes the signal actor, tenant, and zone to the query", async () => {
    ProjectLookup.reset();
    const context = BoundedContext.multitenant("ProcessManagerQueries")
      .add(projectionRepository())
      .add(processManagerRepository())
      .build();
    const observed: unknown[] = [];
    const observation = QueryReader.observe((query) => observed.push(query));
    const command = queryCommand("shared", "A", "tenant-a");
    if (command.context?.actorContext === undefined) throw new Error("Actor context is missing.");
    command.context.actorContext.zoneId = create(ZoneIdSchema, { value: "Europe/Lisbon" });

    try {
      await context.commandBus().post(command);
      expect(observed).toHaveLength(1);
      expect(observed[0]).toMatchObject({
        context: {
          actor: create(UserIdSchema, { value: "query-user" }),
          tenantId: create(TenantIdSchema, {
            kind: { case: "value", value: "tenant-a" },
          }),
          zoneId: create(ZoneIdSchema, { value: "Europe/Lisbon" }),
        },
      });
    } finally {
      observation.close();
      await context.close();
    }
  });

  it.each([
    {
      name: "cyclic",
      predicate: (() => {
        const cyclic: { kind: "all"; predicates: unknown[] } = { kind: "all", predicates: [] };
        cyclic.predicates.push(cyclic);
        return cyclic;
      })(),
      message: "Entity query predicate must not contain cycles.",
    },
    {
      name: "too deep",
      predicate: Array.from({ length: 66 }).reduce<unknown>(
        (predicate) => ({ kind: "all", predicates: [predicate] }),
        EntityQuery.eq(projectionColumns.name, "depth"),
      ),
      message: "Entity query predicate exceeds maximum depth 64.",
    },
    {
      name: "too wide",
      predicate: {
        kind: "all",
        predicates: Array.from({ length: 10_001 }, () =>
          EntityQuery.eq(projectionColumns.name, "wide"),
        ),
      },
      message: "Entity query predicate exceeds maximum node count 10000.",
    },
  ])("rejects a $name predicate before reading storage", async ({ predicate, message }) => {
    ProjectLookup.reset();
    ProjectLookup.predicate = predicate;
    const context = BoundedContext.singleTenant("ProcessManagerQueries")
      .add(projectionRepository())
      .add(processManagerRepository())
      .build();
    let reads = 0;
    const observation = QueryReader.observe(() => {
      reads += 1;
    });

    try {
      await context.commandBus().post(queryCommand("query-id", "invalid"));
      expect(ProjectLookup.failure).toMatchObject({ message });
      expect(reads).toBe(0);
    } finally {
      observation.close();
      await context.close();
    }
  });

  it("includes archived state, excludes deleted state, and returns clones", async () => {
    ProjectLookup.reset();
    const context = BoundedContext.singleTenant("ProcessManagerQueries")
      .add(projectionRepository())
      .add(processManagerRepository())
      .build();

    try {
      await context
        .stand()
        .update(
          ProjectOverviewStateSchema,
          create(ProjectOverviewStateSchema, { id: "live", name: "live", priority: 1 }),
        );
      await context
        .stand()
        .update(
          ProjectOverviewStateSchema,
          create(ProjectOverviewStateSchema, { id: "archived", name: "archived", priority: 2 }),
          { lifecycle: { archived: true, deleted: false } },
        );
      await context
        .stand()
        .update(
          ProjectOverviewStateSchema,
          create(ProjectOverviewStateSchema, { id: "deleted", name: "deleted", priority: 3 }),
          { lifecycle: { archived: false, deleted: true } },
        );

      await context.commandBus().post(queryCommand("manager", "all", undefined, "second"));
      expect(ProjectLookup.results.map((state) => state.name).sort()).toEqual(["archived", "live"]);
      const live = ProjectLookup.results.find((state) => state.id === "live");
      if (live === undefined) throw new Error("Expected live query result.");
      live.name = "changed by handler";

      await context.commandBus().post(queryCommand("manager", "all"));
      expect(ProjectLookup.results.find((state) => state.id === "live")).toEqual(
        create(ProjectOverviewStateSchema, { id: "live", name: "live", priority: 1 }),
      );
    } finally {
      await context.close();
    }
  });
});
