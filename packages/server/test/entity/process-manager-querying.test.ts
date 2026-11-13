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

import { Time } from "@spine-event-engine/core/time";
import { create, type MessageShape } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  AnyPacker,
  EntityColumn,
  EntityQuery,
  Identifiers,
  TypeUrls,
} from "@spine-event-engine/core";
import { GeneratedEntityColumns } from "@spine-event-engine/core/codegen";
import {
  ActorContextSchema,
  CommandSchema,
  CommandContextSchema,
  CommandIdSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  RejectionEventContextSchema,
  TenantIdSchema,
  UserIdSchema,
  VersionSchema,
  ZoneIdSchema,
} from "@spine-event-engine/proto";
import { describe, expect, expectTypeOf, it, onTestFinished, vi } from "vitest";
import { InMemoryStorageBackend, InMemoryStorageFactory } from "@spine-event-engine/storage";

import {
  Aggregate,
  Application,
  BoundedContext,
  type BoundedContextBuilder,
  type DescriptorMessageSchema,
  EntityHandlers,
  type EntityHandlersMetadata,
  type EntityOptions,
  ProcessManager,
  Projection,
  Repository,
  EventRouting,
  HandlerRegistryIngestor,
  Server,
  type ServerQueryExecutionContext,
  AppQueryHandler,
  type AppQueryContext,
  SingleProcessServerRuntime,
} from "../../src/index.js";
import { ServerEnvironment, serverEnvironmentAccess } from "../../src/server/server-environment.js";
import { applicationAccess } from "../../src/server/application.js";
import { EnvironmentType } from "../../src/server/environment.js";
import { processManagerQueryAccess } from "../../src/entity/entity.js";
import { TestTenantIndex } from "../tenant-index-fixture.js";
import {
  registerSpineMetadata,
  spineMetadataTestAccess,
} from "../../src/handler/spine-metadata-inventory.js";
import {
  GetProjectOverview_ResponseSchema,
  type GetProjectOverview_Query,
  type GetProjectOverview_Response,
} from "../../test-fixtures/generated/repository-routing/project_queries_pb.js";
import { ProjectIdSchema } from "../../test-fixtures/generated/repository-routing/project_identifiers_pb.js";
import { GetProjectOverview } from "../../test-fixtures/generated/repository-routing/project_queries_app_query.js";
import { HandlerMetadataValues } from "../../src/handler/handler-metadata.js";
import { QueryReader } from "../../src/services/query-reader.js";
import { ReadSideFilter, type ReadSideContext } from "../../src/stand/read-side-filter.js";
import { serverTestFixturesProtoModule } from "../../test-fixtures/generated/proto-module.js";
void serverTestFixturesProtoModule;
import { RegisteredTargets } from "../../src/services/registered-targets.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import {
  type ProjectState,
  ProjectStateSchema,
  type ProjectOverviewState,
  ProjectOverviewStateSchema,
  ProjectOverviewIdSchema,
  type ProjectProfileState,
  ProjectProfileStateSchema,
} from "../../test-fixtures/generated/entity-metadata/project_states_pb.js";
import {
  ProjectOverviewStateQuery,
  ProjectPortfolioStateQuery,
} from "../../test-fixtures/generated/entity-metadata/project_states_query.js";
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
import {
  type ReviewRejected,
  ReviewRejectedSchema,
} from "../../test-fixtures/generated/handler-registry/rejections_pb.js";

const closePhase = vi.hoisted(() => ({
  failBuild: undefined as ((builder: unknown) => boolean) | undefined,
  pauseBuild: undefined as ((builder: unknown) => Promise<void> | undefined) | undefined,
  failAdapter: false,
}));

vi.mock("@connectrpc/connect-node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect-node")>();
  return {
    ...actual,
    connectNodeAdapter(...args: Parameters<typeof actual.connectNodeAdapter>) {
      if (closePhase.failAdapter) throw new Error("HTTP adapter construction failed");
      return actual.connectNodeAdapter(...args);
    },
  };
});

vi.mock("../../src/context/bounded-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/context/bounded-context.js")>();
  return {
    ...actual,
    boundedContextAccess: {
      ...actual.boundedContextAccess,
      assemble(...args: Parameters<typeof actual.boundedContextAccess.assemble>) {
        if (closePhase.failBuild?.(args[0])) throw new Error("context build failed");
        const pause = closePhase.pauseBuild?.(args[0]);
        return pause === undefined
          ? actual.boundedContextAccess.assemble(...args)
          : pause.then(() => actual.boundedContextAccess.assemble(...args));
      },
    },
  };
});

async function buildApplication(
  builders: readonly BoundedContextBuilder[],
  factory?: InMemoryStorageFactory,
): Promise<Application> {
  const index = new TestTenantIndex();
  for (const value of ["tenant-a", "tenant-b", "SINGLE_TENANT"]) {
    await index.keep(create(TenantIdSchema, { kind: { case: "value", value } }));
  }
  const environment = ServerEnvironment.newBuilder()
    .under(EnvironmentType.Local, (configuration) => {
      configuration.use(factory === undefined ? {} : { storageFactory: factory });
    })
    .build();
  const builder = Application.newBuilder().setServerEnvironment(environment).setTenantIndex(index);
  for (const entry of builders) builder.add(entry);
  const application = await builder.build();
  onTestFinished(() => application.close());
  return application;
}

function requireContext(application: Application, position: number): BoundedContext {
  const context = application.contexts()[position];
  if (context === undefined) throw new Error(`Expected Bounded Context ${String(position)}.`);
  return context;
}

const projectionColumns = EntityColumn.register(
  ProjectOverviewStateSchema,
  GeneratedEntityColumns.define(ProjectOverviewStateSchema, {
    name: { field: ProjectOverviewStateSchema.field.name, comparison: "ordering" },
    priority: { field: ProjectOverviewStateSchema.field.priority, comparison: "ordering" },
    attachment: { field: ProjectOverviewStateSchema.field.attachment, comparison: "equality" },
  }),
);
const equivalentProjectionSchema = { ...ProjectOverviewStateSchema };
const selectedProjectionColumns: Pick<typeof projectionColumns, "priority"> = projectionColumns;
const sharedQuery = ProjectOverviewStateQuery.create()
  .name()
  .is("ready")
  .orderBy("priority", "desc")
  .limit(1)
  .build();
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

class ProjectProfile extends Projection<string, typeof ProjectProfileStateSchema> {}

class MaskedProjectLookup extends ProcessManager<string, typeof ProcessManagerStateSchema> {
  static results: readonly ProjectProfileState[] = [];
  static failure: unknown;

  async assign(command: CreateReviewProject): Promise<ProjectionEvent> {
    try {
      MaskedProjectLookup.results = await this.select(ProjectProfileStateSchema, {})
        .byId(command.id)
        .read();
    } catch (error) {
      MaskedProjectLookup.failure = error;
      throw error;
    }
    return create(ProjectionEventSchema, { id: command.id, name: "masked" });
  }
}

class PausedProjectLookup extends ProcessManager<string, typeof ProcessManagerStateSchema> {
  static onEntered: (() => void) | undefined;
  static wait: Promise<void> | undefined;
  static results: readonly ProjectOverviewState[] = [];

  async assign(command: CreateReviewProject): Promise<ProjectionEvent> {
    PausedProjectLookup.onEntered?.();
    await PausedProjectLookup.wait;
    PausedProjectLookup.results = await this.select(ProjectOverviewStateSchema, projectionColumns)
      .byId(command.id)
      .read();
    return create(ProjectionEventSchema, { id: command.id, name: "resumed" });
  }
}

class RejectionProjectLookup extends ProcessManager<string, typeof ProcessManagerStateSchema> {
  static results: readonly ProjectOverviewState[] = [];

  async onRejected(rejection: ReviewRejected): Promise<CreateReviewProject | undefined> {
    RejectionProjectLookup.results = await this.select(
      ProjectOverviewStateSchema,
      projectionColumns,
    )
      .byId(rejection.id)
      .read();
    this.update((draft) => {
      draft.queue = `rejected ${String(RejectionProjectLookup.results.length)}`;
    });
    return undefined;
  }
}

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

  queryShared(query: typeof sharedQuery = sharedQuery) {
    return this.select(query);
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
          .all();
      } else if (command.name === "shared") {
        ProjectLookup.results = await this.select(sharedQuery).read();
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

class ScopedAppQueryHandler extends AppQueryHandler<
  GetProjectOverview_Query,
  GetProjectOverview_Response
> {
  static contexts: AppQueryContext[] = [];

  execute(query: GetProjectOverview_Query, context: AppQueryContext): GetProjectOverview_Response {
    ScopedAppQueryHandler.contexts.push(context);
    return create(GetProjectOverview_ResponseSchema, {
      project: { id: query.project?.value ?? "", name: "From App Query" },
    });
  }
}

class ScopedAppQueryManager extends ProcessManager<string, typeof ProcessManagerStateSchema> {
  static instance: ScopedAppQueryManager | undefined;
  static result: GetProjectOverview_Response | undefined;
  static failure: unknown;

  constructor(
    options: EntityOptions<string, typeof ProcessManagerStateSchema>,
    private readonly ask: (
      query: GetProjectOverview_Query,
      context: ServerQueryExecutionContext,
    ) => Promise<GetProjectOverview_Response>,
  ) {
    super(options);
    ScopedAppQueryManager.instance = this;
  }

  async assign(command: CreateReviewProject): Promise<ProjectionEvent> {
    try {
      ScopedAppQueryManager.result = await this.ask(
        create(GetProjectOverview.querySchema, {
          project: create(ProjectIdSchema, { value: command.id }),
        }),
        { actorContext: this.currentActorContext },
      );
    } catch (error) {
      ScopedAppQueryManager.failure = error;
      throw error;
    }
    return create(ProjectionEventSchema, { id: command.id, name: "queried" });
  }

  afterHandler(): unknown {
    return this.currentActorContext;
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

function maskedLookupRepository(): Repository<typeof MaskedProjectLookup> {
  return new Repository({
    entityType: MaskedProjectLookup,
    schema: ProcessManagerStateSchema,
    handlers: HandlerMetadataValues.defineArity(
      MaskedProjectLookup,
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

function pausedLookupRepository(): Repository<typeof PausedProjectLookup> {
  return new Repository({
    entityType: PausedProjectLookup,
    schema: ProcessManagerStateSchema,
    handlers: HandlerMetadataValues.defineArity(
      PausedProjectLookup,
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

function rejectionLookupRepository(): Repository<typeof RejectionProjectLookup> {
  const handlers = new HandlerRegistryIngestor().ingest({
    receivers: [
      {
        receiverKind: "entity",
        receiverType: RejectionProjectLookup,
        stateSchema: ProcessManagerStateSchema,
        handlers: [
          {
            kind: "command-reaction",
            methodName: "onRejected",
            input: { schema: ReviewRejectedSchema, origin: "domestic" },
            outcomes: { returned: [CreateReviewProjectSchema], thrown: [] },
            parameterCount: 1,
          },
        ],
      },
    ],
  })[0] as EntityHandlersMetadata<RejectionProjectLookup, typeof ProcessManagerStateSchema>;
  return new Repository({
    entityType: RejectionProjectLookup,
    schema: ProcessManagerStateSchema,
    handlers,
    eventRouting: EventRouting.create<string>().route(ReviewRejectedSchema, (rejection) => [
      rejection.id,
    ]),
  });
}

function profileRepository(): Repository<typeof ProjectProfile> {
  return new Repository({
    entityType: ProjectProfile,
    schema: ProjectProfileStateSchema,
    handlers: EntityHandlers.define(ProjectProfile, ProjectProfileStateSchema, () => []),
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
    message: AnyPacker.pack(
      CreateReviewProjectSchema,
      create(CreateReviewProjectSchema, { id, name }),
    ),
  });
}

async function queryDeliveryIdle(application: Application): Promise<void> {
  await serverEnvironmentAccess.whenDeliveryIdle(applicationAccess.environment(application));
}

async function startPausedQueryServer(order: "target-first" | "handler-first") {
  const builders = [
    BoundedContext.singleTenant("PausedProjects").add(projectionRepository()),
    BoundedContext.singleTenant("PausedWorkflows").add(pausedLookupRepository()),
  ];
  const application = await buildApplication(
    order === "target-first" ? builders : [...builders].reverse(),
  );
  const projects = application
    .contexts()
    .find((context) => context.name.value === "PausedProjects");
  const workflows = application
    .contexts()
    .find((context) => context.name.value === "PausedWorkflows");
  if (projects === undefined || workflows === undefined) throw new Error("Missing query contexts.");
  await projects
    .stand()
    .update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, { id: "project-1", name: "ready", priority: 1 }),
    );
  return {
    projects,
    workflows,
    running: await Server.atPort(0).setApplication(application).start(),
  };
}

function reviewRejectionEvent(id: string) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: `rejected-${id}` }),
    context: create(EventContextSchema, {
      producerId: Identifiers.pack("string", id),
      timestamp: create(TimestampSchema, { seconds: 1n }),
      version: create(VersionSchema, { number: 1 }),
      rejection: create(RejectionEventContextSchema, {
        command: queryCommand(id, "review"),
      }),
    }),
    message: AnyPacker.pack(ReviewRejectedSchema, create(ReviewRejectedSchema, { id })),
  });
}

describe("Process Manager querying", () => {
  it("injects a Server App Query into a real scoped handler without inventing principal facts", async () => {
    ScopedAppQueryHandler.contexts = [];
    ScopedAppQueryManager.instance = undefined;
    ScopedAppQueryManager.result = undefined;
    ScopedAppQueryManager.failure = undefined;
    registerSpineMetadata(
      {
        receivers: [],
        appQueries: [
          {
            handlerType: ScopedAppQueryHandler,
            queryTypeName: GetProjectOverview.querySchema.typeName,
            querySchema: GetProjectOverview.querySchema,
            responseSchema: GetProjectOverview.responseSchema,
          },
        ],
      },
      "test:scoped-app-query",
    );
    const server = new Server({ appQueries: [new ScopedAppQueryHandler()] });
    const application = await buildApplication([
      BoundedContext.multiTenant("ScopedAppQueryWorkflows").add(
        new Repository({
          entityType: ScopedAppQueryManager,
          schema: ProcessManagerStateSchema,
          handlers: HandlerMetadataValues.defineArity(
            ScopedAppQueryManager,
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
          onCreate: (options) =>
            new ScopedAppQueryManager(options, (q, context) => server.query(q, context)),
        }),
      ),
    ]);
    const workflows = requireContext(application, 0);
    server.setApplication(application);
    const running = await server.start();
    try {
      const command = queryCommand("project-1", "scoped", "tenant-a");
      if (command.context?.actorContext === undefined)
        throw new Error("Expected complete command actor fixture.");
      command.context.actorContext.timestamp = create(TimestampSchema, { seconds: 1n });
      await workflows.commandBus().post(command);
      await vi.waitFor(() => {
        expect(ScopedAppQueryManager.result?.project?.name ?? ScopedAppQueryManager.failure).toBe(
          "From App Query",
        );
      });
      const context = ScopedAppQueryHandler.contexts[0];
      expect(context?.actorContext.actor?.value).toBe("query-user");
      expect(context?.actorContext.tenantId?.kind).toMatchObject({
        case: "value",
        value: "tenant-a",
      });
      expect(context?.principal).toBeUndefined();
      expect(context?.authorityFacts).toBeUndefined();
      expect(() => ScopedAppQueryManager.instance?.afterHandler()).toThrow(/only during/u);
      expect(() =>
        context?.select(ProjectOverviewStateQuery.create().byId("project-1").build()),
      ).toThrow(/only during/u);
    } finally {
      await running.close();
      spineMetadataTestAccess.clear();
    }
  });

  it("copies a generated message ID from the canonical first field", () => {
    const id = create(ProjectOverviewIdSchema, { value: "portfolio-1" });
    const query = ProjectPortfolioStateQuery.create().byId(id).build();
    id.value = "changed";
    expect(query.buildPlan().predicate).toMatchObject({
      kind: "ids",
      ids: [{ value: "portfolio-1" }],
    });
    expect(query.build().context).toBeUndefined();
    expect(() =>
      ProjectPortfolioStateQuery.create()
        .byId("wrong" as never)
        .build(),
    ).toThrow(/wrong type/u);
    type Id = Parameters<ReturnType<typeof ProjectPortfolioStateQuery.create>["byId"]>[0];
    type RejectsStringId = string extends Id ? false : true;
    const rejectsStringId: RejectsStringId = true;
    expect(rejectsStringId).toBe(true);
  });
  it.each(["local", "foreign"])(
    "retains complete camelCase state on the %s registered route",
    async (route) => {
      MaskedProjectLookup.results = [];
      MaskedProjectLookup.failure = undefined;
      const workflowBuilder = BoundedContext.singleTenant(`MaskedWorkflows-${route}`).add(
        maskedLookupRepository(),
      );
      if (route === "local") workflowBuilder.add(profileRepository());
      const application = await buildApplication([
        workflowBuilder,
        ...(route === "foreign"
          ? [BoundedContext.singleTenant(`MaskedProjects-${route}`).add(profileRepository())]
          : []),
      ]);
      const workflows = requireContext(application, 0);
      const projects = route === "foreign" ? requireContext(application, 1) : undefined;
      const target = projects ?? workflows;
      await target
        .stand()
        .update(
          ProjectProfileStateSchema,
          create(ProjectProfileStateSchema, { id: "project-1", mutableNote: "visible" }),
        );
      const running = await Server.atPort(0).setApplication(application).start();

      try {
        await workflows.commandBus().post(queryCommand("project-1", "masked"));
        await vi.waitFor(() => {
          expect(MaskedProjectLookup.failure).toBeUndefined();
          expect(MaskedProjectLookup.results).toHaveLength(1);
        });
        expect(MaskedProjectLookup.results[0]?.mutableNote).toBe("visible");
      } finally {
        await running.close();
      }
    },
  );

  it("finds a registered Entity in another context of the same server", async () => {
    ProjectLookup.reset();
    const observed: ReadSideContext[] = [];
    class ObserveRead extends ReadSideFilter<typeof ProjectOverviewStateSchema> {
      constructor() {
        super(ProjectOverviewStateSchema);
      }
      filter(state: ProjectOverviewState, context: ReadSideContext): ProjectOverviewState {
        observed.push(context);
        return state;
      }
    }
    const application = await buildApplication([
      BoundedContext.singleTenant("Projects")
        .add(projectionRepository())
        .addReadSideFilter(new ObserveRead()),
      BoundedContext.singleTenant("Workflows").add(processManagerRepository()),
    ]);
    const projects = requireContext(application, 0);
    const workflows = requireContext(application, 1);
    await projects
      .stand()
      .update(
        ProjectOverviewStateSchema,
        create(ProjectOverviewStateSchema, { id: "project-1", name: "ready", priority: 1 }),
      );
    const running = await Server.atPort(0).setApplication(application).start();

    try {
      await workflows.commandBus().post(queryCommand("project-1", "ready"));
      await vi.waitFor(() => {
        expect(ProjectLookup.failure).toBeUndefined();
        expect(ProjectLookup.results).toEqual([
          create(ProjectOverviewStateSchema, { id: "project-1", name: "ready", priority: 1 }),
        ]);
      });
      expect(observed[0]?.operation.kind).toBe("query");
      expect(observed[0]?.actorContext?.actor?.value).toBe("query-user");
      expect(observed[0]?.principal).toBeUndefined();
      expect(observed[0]?.producingContext).toBe(projects);
      await workflows.commandBus().post(queryCommand("missing", "ready"));
      await vi.waitFor(() => {
        expect(ProjectLookup.results).toEqual([]);
      });
      expect(ProjectLookup.failure).toBeUndefined();
    } finally {
      await running.close();
    }
  });

  it("starts two endpoints for one Application without interrupting shared queries", async () => {
    ProjectLookup.reset();
    const application = await buildApplication([
      BoundedContext.singleTenant("ConcurrentWorkflows").add(processManagerRepository()),
      BoundedContext.singleTenant("ConcurrentFirstProjects").add(projectionRepository()),
    ]);
    const workflows = requireContext(application, 0);
    const firstProjects = requireContext(application, 1);
    await firstProjects
      .stand()
      .update(
        ProjectOverviewStateSchema,
        create(ProjectOverviewStateSchema, { id: "shared", name: "first", priority: 1 }),
      );
    const [first, second] = await Promise.all([
      Server.atPort(0).setApplication(application).start(),
      Server.atPort(0).setApplication(application).start(),
    ]);
    try {
      await first.close();
      await workflows.commandBus().post(queryCommand("shared", "first"));
      await vi.waitFor(() => {
        expect(ProjectLookup.results[0]?.name).toBe("first");
      });
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });

  it.each(["before-builder", "after-builder"])(
    "reserves Application builders %s before awaiting a delayed builder",
    async (position) => {
      ProjectLookup.reset();
      const workflowsBuilder = BoundedContext.singleTenant(`PendingWorkflows-${position}`).add(
        processManagerRepository(),
      );
      const originalBuilder = BoundedContext.singleTenant(`PendingProjects-${position}`).add(
        projectionRepository(),
      );
      const intruderBuilder = BoundedContext.singleTenant(`PendingIntruder-${position}`).add(
        profileRepository(),
      );
      const delayed = BoundedContext.singleTenant(`DelayedBuilder-${position}`);
      const building = Promise.withResolvers<undefined>();
      const released = Promise.withResolvers<undefined>();
      closePhase.pauseBuild = (builder) => {
        if (builder !== delayed) return undefined;
        building.resolve(undefined);
        return released.promise;
      };
      let intruderBuilds = 0;
      closePhase.failBuild = (builder) => {
        if (builder !== intruderBuilder) return false;
        intruderBuilds += 1;
        return true;
      };
      const firstBuild = buildApplication(
        position === "before-builder"
          ? [workflowsBuilder, delayed, originalBuilder]
          : [delayed, workflowsBuilder, originalBuilder],
      );
      await building.promise;
      const secondEnvironment = ServerEnvironment.newBuilder().build();
      const secondBuild = Application.newBuilder()
        .setServerEnvironment(secondEnvironment)
        .add(workflowsBuilder)
        .add(intruderBuilder)
        .build();

      try {
        await expect(secondBuild).rejects.toThrow(/already used|claimed/);
        expect(intruderBuilds).toBe(0);
        released.resolve(undefined);
        const application = await firstBuild;
        const workflows = application
          .contexts()
          .find((context) => context.name.value.startsWith("PendingWorkflows"));
        const original = application
          .contexts()
          .find((context) => context.name.value.startsWith("PendingProjects"));
        if (workflows === undefined || original === undefined)
          throw new Error("Expected the reserved query contexts.");
        await original
          .stand()
          .update(
            ProjectOverviewStateSchema,
            create(ProjectOverviewStateSchema, { id: "shared", name: "original", priority: 1 }),
          );
        const running = await Server.atPort(0).setApplication(application).start();
        try {
          await workflows.commandBus().post(queryCommand("shared", "original"));
          await vi.waitFor(() => {
            expect(ProjectLookup.results[0]?.name).toBe("original");
          });
        } finally {
          await running.close();
        }
      } finally {
        closePhase.pauseBuild = undefined;
        closePhase.failBuild = undefined;
        released.resolve(undefined);
        await secondEnvironment.close();
      }
    },
  );

  it("retries failed second-Server cleanup without closing the live context", async () => {
    ProjectLookup.reset();
    const application = await buildApplication([
      BoundedContext.singleTenant("RetainedWorkflows").add(processManagerRepository()),
      BoundedContext.singleTenant("RetainedProjects").add(projectionRepository()),
      BoundedContext.singleTenant("UnusedProjects").add(profileRepository()),
    ]);
    const workflows = requireContext(application, 0);
    const original = requireContext(application, 1);
    await original
      .stand()
      .update(
        ProjectOverviewStateSchema,
        create(ProjectOverviewStateSchema, { id: "shared", name: "original", priority: 1 }),
      );
    const first = await Server.atPort(0).setApplication(application).start();
    let closes = 0;
    closePhase.failAdapter = true;
    const second = Server.atPort(0)
      .setApplication(application)
      .addResource({
        close() {
          closes += 1;
          if (closes === 1) throw new Error("resource close failed");
        },
      });

    try {
      await expect(second.start()).rejects.toThrow(/cleanup/);
      expect(closes).toBe(1);
      await expect(second.start()).rejects.toThrow(/deferred cleanup completed/);
      expect(closes).toBe(2);
      await workflows.commandBus().post(queryCommand("shared", "original"));
      await vi.waitFor(() => {
        expect(ProjectLookup.results[0]?.name).toBe("original");
      });
      expect(
        RegisteredTargets.forStand(workflows.stand())?.find(
          TypeUrls.derive(ProjectOverviewStateSchema),
        )?.context,
      ).toBe(original);
    } finally {
      closePhase.failAdapter = false;
      await first.close();
    }
  });

  it("rejects a live context before invoking a later failing builder", async () => {
    ProjectLookup.reset();
    const workflowsBuilder = BoundedContext.singleTenant("BuildGuardWorkflows").add(
      processManagerRepository(),
    );
    const application = await buildApplication([
      workflowsBuilder,
      BoundedContext.singleTenant("BuildGuardProjects").add(projectionRepository()),
    ]);
    const workflows = requireContext(application, 0);
    const projects = requireContext(application, 1);
    await projects
      .stand()
      .update(
        ProjectOverviewStateSchema,
        create(ProjectOverviewStateSchema, { id: "shared", name: "ready", priority: 1 }),
      );
    const running = await Server.atPort(0).setApplication(application).start();
    const failing = BoundedContext.singleTenant("BuildGuardFailure");
    let buildAttempts = 0;
    closePhase.failBuild = (builder) => {
      if (builder !== failing) return false;
      buildAttempts += 1;
      return true;
    };

    try {
      const secondEnvironment = ServerEnvironment.newBuilder().build();
      try {
        await expect(
          Application.newBuilder()
            .setServerEnvironment(secondEnvironment)
            .add(workflowsBuilder)
            .add(failing)
            .build(),
        ).rejects.toThrow(/already used/);
      } finally {
        await secondEnvironment.close();
      }
      expect(buildAttempts).toBe(0);
      await workflows.commandBus().post(queryCommand("shared", "ready"));
      await vi.waitFor(() => {
        expect(ProjectLookup.results[0]?.name).toBe("ready");
      });
    } finally {
      closePhase.failBuild = undefined;
      await running.close();
    }
  });

  it("retains partial Application cleanup until a failed context close retries", async () => {
    const environment = ServerEnvironment.newBuilder().build();
    const broken = BoundedContext.singleTenant("PartialBuildBroken");
    const builder = Application.newBuilder()
      .setServerEnvironment(environment)
      .add(BoundedContext.singleTenant("PartialBuildProjects").add(projectionRepository()))
      .add(broken);
    closePhase.failBuild = (candidate) => candidate === broken;
    const originalClose: unknown = Reflect.get(BoundedContext.prototype, "close");
    if (typeof originalClose !== "function") throw new Error("Expected Bounded Context close.");
    let closes = 0;
    const projectRef: { current?: BoundedContext } = {};
    const closeSpy = vi.spyOn(BoundedContext.prototype, "close").mockImplementation(function (
      this: BoundedContext,
    ) {
      if (this.name.value === "PartialBuildProjects") {
        projectRef.current = this;
        closes += 1;
        if (closes === 1) return Promise.reject(new Error("context cleanup failed"));
      }
      return Reflect.apply(originalClose, this, []) as Promise<void>;
    });

    try {
      await expect(builder.build()).rejects.toThrow(/cleanup/);
      expect(closes).toBe(1);
      await expect(builder.close()).resolves.toBeUndefined();
      expect(closes).toBe(2);
      const projectContext = projectRef.current;
      if (projectContext === undefined) throw new Error("Expected the partial Bounded Context.");
      await expect(
        projectContext.stand().readAllVersioned(ProjectOverviewStateSchema),
      ).rejects.toThrow("Stand is closed.");
      const reused = await buildApplication([
        BoundedContext.singleTenant("PartialBuildProjects").add(projectionRepository()),
      ]);
      expect(requireContext(reused, 0).stand().stateTypes()).toContain(
        TypeUrls.derive(ProjectOverviewStateSchema),
      );
    } finally {
      closePhase.failBuild = undefined;
      closeSpy.mockRestore();
      await environment.close();
    }
  });

  it("releases routes and closes contexts after service option validation fails", async () => {
    const application = await buildApplication([
      BoundedContext.singleTenant("InvalidServiceProjects").add(projectionRepository()),
    ]);
    const projects = requireContext(application, 0);
    let closes = 0;
    const server = Server.atPort(0, { services: { subscriptionLimit: 0 } })
      .setApplication(application)
      .addResource({
        close() {
          closes += 1;
        },
      });

    await expect(server.start()).rejects.toThrow(/subscriptionLimit/);
    expect(closes).toBe(1);
    expect(RegisteredTargets.forStand(projects.stand())).toBeDefined();
    await application.close();
    expect(RegisteredTargets.forStand(projects.stand())).toBeUndefined();
    await expect(projects.stand().readAllVersioned(ProjectOverviewStateSchema)).rejects.toThrow(
      "Stand is closed.",
    );
  });

  it("retries adapter-construction cleanup without repeating completed phases", async () => {
    const application = await buildApplication([
      BoundedContext.singleTenant("AdapterFailureProjects").add(projectionRepository()),
    ]);
    const projects = requireContext(application, 0);
    let closes = 0;
    closePhase.failAdapter = true;
    const server = Server.atPort(0)
      .setApplication(application)
      .addResource({
        close() {
          closes += 1;
          if (closes === 1) throw new Error("resource cleanup failed");
        },
      });

    try {
      await expect(server.start()).rejects.toThrow(/cleanup/);
      expect(closes).toBe(1);
      expect(RegisteredTargets.forStand(projects.stand())).toBeDefined();
      await expect(server.start()).rejects.toThrow(/deferred cleanup completed/);
      expect(closes).toBe(2);
      expect(RegisteredTargets.forStand(projects.stand())).toBeDefined();
      await application.close();
      expect(RegisteredTargets.forStand(projects.stand())).toBeUndefined();
    } finally {
      closePhase.failAdapter = false;
    }
  });

  it("releases routes after a completed Server close", async () => {
    const application = await buildApplication([
      BoundedContext.singleTenant("ReleasedProjects").add(projectionRepository()),
    ]);
    const context = requireContext(application, 0);
    const running = await Server.atPort(0).setApplication(application).start();
    expect(RegisteredTargets.forStand(context.stand())).toBeDefined();

    await running.close();

    expect(RegisteredTargets.forStand(context.stand())).toBeDefined();
    await application.close();
    expect(RegisteredTargets.forStand(context.stand())).toBeUndefined();
  });

  it("delivers retained Process Manager work with a foreign state read after restart", async () => {
    ProjectLookup.reset();
    const backend = new InMemoryStorageBackend();
    const createdVersions: number[] = [];
    const buildContexts = async () => {
      const application = await buildApplication(
        [
          BoundedContext.singleTenant("RestartProjects").add(projectionRepository()),
          BoundedContext.singleTenant("RestartWorkflows").add(
            processManagerRepository(identityNameFilter, createdVersions),
          ),
        ],
        new InMemoryStorageFactory(backend),
      );
      return {
        application,
        projects: requireContext(application, 0),
        workflows: requireContext(application, 1),
      };
    };
    const first = await buildContexts();
    await first.projects
      .stand()
      .update(
        ProjectOverviewStateSchema,
        create(ProjectOverviewStateSchema, { id: "project-1", name: "ready", priority: 1 }),
      );
    const initial = await Server.atPort(0).setApplication(first.application).start();
    await first.workflows.commandBus().post(queryCommand("project-1", "ready"));
    await vi.waitFor(async () => {
      const current = await first.workflows.stand().read(ProcessManagerStateSchema, "project-1");
      expect(current?.queue).toBe("read 1");
    });
    await initial.close();
    ProjectLookup.reset();

    const pending = queryCommand("project-1", "ready", undefined, "retained");
    const delivery = serverEnvironmentAccess.coreDelivery(
      applicationAccess.environment(first.application),
    );
    await delivery.inbox.receive({
      inboxId: {
        targetId: Identifiers.pack("string", "project-1"),
        targetTypeUrl: TypeUrls.derive(ProcessManagerStateSchema),
      },
      signalId: pending.id?.uuid ?? "missing-command-id",
      signal: AnyPacker.pack(CommandSchema, pending),
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
      shard: ShardIndex.single(),
      whenReceived: Time.currentTime(),
      version: 1n,
    });
    await first.application.close();
    const restarted = await buildContexts();
    const running = await Server.atPort(0).setApplication(restarted.application).start();

    try {
      await vi.waitFor(() => {
        expect(ProjectLookup.results).toEqual([
          create(ProjectOverviewStateSchema, { id: "project-1", name: "ready", priority: 1 }),
        ]);
      });
      expect(ProjectLookup.failure).toBeUndefined();
      expect(createdVersions).toEqual([0, 1]);
    } finally {
      await running.close();
    }
  });

  it("reads a foreign state while reacting to a rejected review command", async () => {
    RejectionProjectLookup.results = [];
    const application = await buildApplication([
      BoundedContext.singleTenant("RejectedProjects").add(projectionRepository()),
      BoundedContext.singleTenant("RejectedWorkflows").add(rejectionLookupRepository()),
    ]);
    const projects = requireContext(application, 0);
    const workflows = requireContext(application, 1);

    await projects
      .stand()
      .update(
        ProjectOverviewStateSchema,
        create(ProjectOverviewStateSchema, { id: "project-1", name: "ready", priority: 1 }),
      );
    const running = await Server.atPort(0).setApplication(application).start();

    try {
      await workflows.eventBus().post(reviewRejectionEvent("project-1"));
      await vi.waitFor(() => {
        expect(RejectionProjectLookup.results[0]?.name).toBe("ready");
      });
      await expect(
        workflows.stand().read(ProcessManagerStateSchema, "project-1"),
      ).resolves.toMatchObject({ queue: "rejected 1" });
    } finally {
      await running.close();
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
      const projectRef: { context?: BoundedContext } = {};
      const results: ProjectOverviewState[][] = [];
      const projectBuilder =
        BoundedContext.singleTenant("ClosingProjects").add(projectionRepository());
      const workflowBuilder = BoundedContext.singleTenant("ClosingWorkflows").addCommandDispatcher({
        messageSchemas: () => [CreateReviewProjectSchema],
        async dispatch() {
          enter();
          await released;
          const projects = projectRef.context;
          if (projects === undefined) throw new Error("Expected query Bounded Context.");
          const states = await projects.stand().readAllVersioned(ProjectOverviewStateSchema);
          results.push(states.map((result) => result.state));
        },
      });
      const application = await buildApplication(
        order === "target-first"
          ? [projectBuilder, workflowBuilder]
          : [workflowBuilder, projectBuilder],
      );
      const projects = application
        .contexts()
        .find((context) => context.name.value === "ClosingProjects");
      const workflows = application
        .contexts()
        .find((context) => context.name.value === "ClosingWorkflows");
      if (projects === undefined || workflows === undefined)
        throw new Error("Expected both query Bounded Contexts.");
      projectRef.context = projects;
      await projects
        .stand()
        .update(
          ProjectOverviewStateSchema,
          create(ProjectOverviewStateSchema, { id: "project-1", name: "ready", priority: 1 }),
        );
      const running = await Server.atPort(0).setApplication(application).start();
      const unrelatedRuntime = new SingleProcessServerRuntime();
      await unrelatedRuntime.start();

      try {
        const posting = workflows
          .commandBus()
          .post(queryCommand("project-1", "ready"))
          .then(
            () => undefined,
            (error: unknown) => error,
          );
        await entered;
        const contexts = order === "target-first" ? [projects, workflows] : [workflows, projects];
        const closing = Promise.all(contexts.map((context) => context.close()));
        expect(() => projects.stand().stateTypes()).not.toThrow();
        await expect(projects.stand().readAllVersioned(ProjectOverviewStateSchema)).rejects.toThrow(
          "Bounded Context is closing.",
        );
        await expect(
          unrelatedRuntime.enqueue(async () => {
            await projects.stand().readAllVersioned(ProjectOverviewStateSchema);
          }),
        ).rejects.toThrow("Bounded Context is closing.");
        release();
        expect(await posting).toBeUndefined();
        await closing;
        await running.close();
        expect(results).toEqual([
          [create(ProjectOverviewStateSchema, { id: "project-1", name: "ready", priority: 1 })],
        ]);
      } finally {
        release();
        await running.close();
        await unrelatedRuntime.close();
      }
    },
  );

  it.each(["target-first", "handler-first"] as const)(
    "completes a paused Process Manager select during %s shutdown",
    async (order) => {
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const resumed = new Promise<void>((resolve) => {
        release = resolve;
      });
      PausedProjectLookup.onEntered = enter;
      PausedProjectLookup.wait = resumed;
      PausedProjectLookup.results = [];
      const { projects, workflows, running } = await startPausedQueryServer(order);

      try {
        const posting = workflows.commandBus().post(queryCommand("project-1", "paused"));
        await entered;
        const closing = running.close();
        expect(() => projects.stand().stateTypes()).not.toThrow();
        release();
        await posting;
        await vi.waitFor(() => {
          expect(PausedProjectLookup.results[0]?.name).toBe("ready");
        });
        await closing;
      } finally {
        PausedProjectLookup.onEntered = undefined;
        PausedProjectLookup.wait = undefined;
        release();
        await running.close();
      }
    },
  );

  it("reads the same named tenant in a multitenant destination", async () => {
    ProjectLookup.reset();
    const application = await buildApplication([
      BoundedContext.multiTenant("TenantProjects").add(projectionRepository()),
      BoundedContext.multiTenant("TenantWorkflows").add(processManagerRepository()),
    ]);
    const projects = requireContext(application, 0);
    const workflows = requireContext(application, 1);

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
    const running = await Server.atPort(0).setApplication(application).start();

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
    const application = await buildApplication([
      BoundedContext.singleTenant("AggregateProjects").add(
        new Repository({
          entityType: ProjectAggregate,
          schema: ProjectStateSchema,
          handlers: EntityHandlers.define(ProjectAggregate, ProjectStateSchema, () => []),
        }),
      ),
      BoundedContext.singleTenant("AggregateWorkflows").add(processManagerRepository()),
    ]);
    const projects = requireContext(application, 0);
    const workflows = requireContext(application, 1);

    await projects
      .stand()
      .update(ProjectStateSchema, create(ProjectStateSchema, { id: "project-1", name: "ready" }));
    const running = await Server.atPort(0).setApplication(application).start();

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
    const application = await buildApplication([
      BoundedContext.singleTenant("ReviewProjects").add(
        new Repository({
          entityType: ProjectReview,
          schema: ProjectReviewStateSchema,
          handlers: EntityHandlers.define(ProjectReview, ProjectReviewStateSchema, () => []),
        }),
      ),
      BoundedContext.singleTenant("ReviewWorkflows").add(processManagerRepository()),
    ]);
    const reviews = requireContext(application, 0);
    const workflows = requireContext(application, 1);

    await reviews
      .stand()
      .update(
        ProjectReviewStateSchema,
        create(ProjectReviewStateSchema, { id: "project-1", queue: "ready" }),
      );
    const running = await Server.atPort(0).setApplication(application).start();

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
    const application = await buildApplication([
      BoundedContext.singleTenant("EquivalentProjects").add(projectionRepository()),
      BoundedContext.singleTenant("EquivalentWorkflows").add(processManagerRepository()),
    ]);
    const projects = requireContext(application, 0);
    const workflows = requireContext(application, 1);

    await projects
      .stand()
      .update(
        ProjectOverviewStateSchema,
        create(ProjectOverviewStateSchema, { id: "project-1", name: "ready", priority: 1 }),
      );
    const running = await Server.atPort(0).setApplication(application).start();

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

  it("validates foreign query fields against the registered target", async () => {
    const application = await buildApplication([
      BoundedContext.singleTenant("ValidatedProjects").add(projectionRepository()),
    ]);
    const projects = requireContext(application, 0);
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
      });
    }).not.toThrow();
    expect(() => {
      targets.validate(target, { predicate: comparison("other") });
    }).toThrow('Query column "other" is not registered');
    expect(() => {
      targets.validate(target, { order: [{ column: "other", direction: "asc" }] });
    }).toThrow('Query column "other" is not registered');
  });

  it("preserves compound filters, ordering, limit, and detached results across contexts", async () => {
    ProjectLookup.reset();
    const application = await buildApplication([
      BoundedContext.singleTenant("QueryOptionsProjects").add(projectionRepository()),
      BoundedContext.singleTenant("QueryOptionsWorkflows").add(processManagerRepository()),
    ]);
    const projects = requireContext(application, 0);
    const workflows = requireContext(application, 1);

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
    const running = await Server.atPort(0).setApplication(application).start();

    try {
      await workflows.commandBus().post(queryCommand("two", "compound"));
      await vi.waitFor(() => {
        expect(ProjectLookup.results).toHaveLength(1);
      });
      expect(ProjectLookup.results[0]?.name).toBe("ready");
      expect(ProjectLookup.results[0]?.priority).toBe(2);
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

  it("executes a context-free generated query in a foreign Process Manager read", async () => {
    ProjectLookup.reset();
    const application = await buildApplication([
      BoundedContext.singleTenant("SharedQueryProjects").add(projectionRepository()),
      BoundedContext.singleTenant("SharedQueryWorkflows").add(processManagerRepository()),
    ]);
    const projects = requireContext(application, 0);
    const workflows = requireContext(application, 1);

    await projects
      .stand()
      .update(
        ProjectOverviewStateSchema,
        create(ProjectOverviewStateSchema, { id: "shared", name: "ready", priority: 2 }),
      );
    const running = await Server.atPort(0).setApplication(application).start();
    try {
      await workflows.commandBus().post(queryCommand("shared", "shared"));
      await vi.waitFor(() => {
        expect(ProjectLookup.results).toHaveLength(1);
      });
      expect(ProjectLookup.results[0]?.id).toBe("shared");
      expect(sharedQuery.build().context).toBeUndefined();
    } finally {
      await running.close();
    }
  });

  it("uses SINGLE_TENANT in a multitenant destination", async () => {
    ProjectLookup.reset();
    const application = await buildApplication([
      BoundedContext.multiTenant("TenantProjects").add(projectionRepository()),
      BoundedContext.singleTenant("SingleWorkflows").add(processManagerRepository()),
    ]);
    const projects = requireContext(application, 0);
    const workflows = requireContext(application, 1);

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
    const running = await Server.atPort(0).setApplication(application).start();

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
    await expect(
      buildApplication([
        BoundedContext.singleTenant(first).add(projectionRepository()),
        BoundedContext.singleTenant(second).add(projectionRepository()),
      ]),
    ).rejects.toThrow(new RegExp(`ProjectOverviewState.*${first}.*${second}`));
    const application = await buildApplication([
      BoundedContext.singleTenant(second).add(projectionRepository()),
    ]);
    const reused = requireContext(application, 0);
    expect(() => reused.stand().stateTypes()).not.toThrow();
  });

  it("retries failed Server cleanup after a separate startup failure", async () => {
    const application = await buildApplication([
      BoundedContext.singleTenant("RetryProjectsOne").add(projectionRepository()),
      BoundedContext.singleTenant("RetryProjectsTwo").add(profileRepository()),
    ]);
    let closes = 0;
    const server = Server.atPort(0)
      .setApplication(application)
      .addResource({
        close() {
          closes += 1;
          if (closes === 1) throw new Error("resource close failed");
        },
      })
      .addListenerLifecycle({
        start() {
          throw new Error("listener startup failed");
        },
        close() {
          // This listener has no acquired resources.
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
    const causes = (error: unknown): readonly unknown[] =>
      error instanceof AggregateError ? error.errors.flatMap(causes) : [error];
    const messages = causes(rejected).map((error) =>
      error instanceof Error ? error.message : String(error),
    );
    expect(messages).toContain("listener startup failed");
    expect(messages).toContain("resource close failed");
    expect(closes).toBe(1);
    await expect(server.start()).rejects.toThrow(/deferred cleanup completed/);
    expect(closes).toBe(2);
  });

  it("does not discover targets attached to another Server", async () => {
    ProjectLookup.reset();
    const projectsApplication = await buildApplication([
      BoundedContext.singleTenant("OtherProjects").add(projectionRepository()),
    ]);
    const workflowsApplication = await buildApplication([
      BoundedContext.singleTenant("LocalWorkflows").add(processManagerRepository()),
    ]);
    const workflows = requireContext(workflowsApplication, 0);
    const projectsServer = await Server.atPort(0).setApplication(projectsApplication).start();
    const workflowsServer = await Server.atPort(0).setApplication(workflowsApplication).start();
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
    const application = await buildApplication([
      BoundedContext.singleTenant("HiddenProjects").add(
        new Repository({
          entityType: ProjectQueue,
          schema: ProjectQueueStateSchema,
          handlers: EntityHandlers.define(ProjectQueue, ProjectQueueStateSchema, () => []),
        }),
      ),
      BoundedContext.singleTenant("VisibleWorkflows").add(hiddenLookupRepository()),
    ]);
    const workflows = requireContext(application, 1);

    const running = await Server.atPort(0).setApplication(application).start();
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
    const application = await buildApplication([
      BoundedContext.singleTenant("SingleProjects").add(projectionRepository()),
      BoundedContext.multiTenant("TenantWorkflows").add(processManagerRepository()),
    ]);
    const workflows = requireContext(application, 1);

    let reads = 0;
    const observation = QueryReader.observe(() => {
      reads += 1;
    });
    const running = await Server.atPort(0).setApplication(application).start();

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
      "Entity queries are available only during repository handler execution.",
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
    const manyIds = Array.from({ length: 1_001 }, (_, index) => `item-${String(index)}`);
    await expect(
      lookup
        .query()
        .byId(...manyIds)
        .read(),
    ).rejects.toThrow("Entity query ID filter may contain at most 1000 IDs.");
    const detached = ProjectOverviewStateQuery.create()
      .byId(...manyIds)
      .build();
    await expect(lookup.queryShared(detached).read()).rejects.toThrow(
      "Entity query ID filter may contain at most 1000 IDs.",
    );

    release();
    await expect(query.read()).rejects.toThrow(
      "Entity queries are available only during repository handler execution.",
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
    const application = await buildApplication([
      BoundedContext.multiTenant("ProcessManagerQueries")
        .add(projectionRepository())
        .add(processManagerRepository(nameFilter, createdVersions)),
    ]);
    const context = requireContext(application, 0);
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
      await queryDeliveryIdle(application);
      expect(ProjectLookup.results).toEqual([
        create(ProjectOverviewStateSchema, { id: "shared", name: "A", priority: 1 }),
      ]);

      await context.commandBus().post(queryCommand("shared", "B", "tenant-b"));
      await queryDeliveryIdle(application);
      expect(ProjectLookup.results).toEqual([
        create(ProjectOverviewStateSchema, { id: "shared", name: "B", priority: 2 }),
      ]);

      await context.commandBus().post(queryCommand("shared", "A", "tenant-a", "restored"));
      await queryDeliveryIdle(application);
      expect(ProjectLookup.results).toEqual([
        create(ProjectOverviewStateSchema, { id: "shared", name: "A", priority: 1 }),
      ]);
      expect(createdVersions).toEqual([0, 0, 1]);
      expect(matchedNames).toEqual(["A", "B", "A"]);

      await context
        .stand()
        .update(
          ProjectOverviewStateSchema,
          create(ProjectOverviewStateSchema, { id: "shared-query", name: "ready", priority: 4 }),
          { tenantId: tenantA },
        );
      await context
        .stand()
        .update(
          ProjectOverviewStateSchema,
          create(ProjectOverviewStateSchema, { id: "shared-query", name: "ready", priority: 7 }),
          { tenantId: tenantB },
        );
      await context.commandBus().post(queryCommand("shared-query", "shared", "tenant-a"));
      await queryDeliveryIdle(application);
      expect(ProjectLookup.results[0]?.priority).toBe(4);
      await context.commandBus().post(queryCommand("shared-query", "shared", "tenant-b"));
      await queryDeliveryIdle(application);
      expect(ProjectLookup.results[0]?.priority).toBe(7);
      expect(sharedQuery.build().context).toBeUndefined();
    } finally {
      await context.close();
    }
  });

  it("passes the signal actor, tenant, and zone to the query", async () => {
    ProjectLookup.reset();
    const application = await buildApplication([
      BoundedContext.multiTenant("ProcessManagerQueries")
        .add(projectionRepository())
        .add(processManagerRepository()),
    ]);
    const context = requireContext(application, 0);
    const observed: unknown[] = [];
    const observation = QueryReader.observe((query) => observed.push(query));
    const command = queryCommand("shared", "A", "tenant-a");
    if (command.context?.actorContext === undefined) throw new Error("Actor context is missing.");
    command.context.actorContext.zoneId = create(ZoneIdSchema, { value: "Europe/Lisbon" });

    try {
      await context.commandBus().post(command);
      await queryDeliveryIdle(application);
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
  ])("validates a $name predicate before reading storage", async ({ predicate, message }) => {
    ProjectLookup.reset();
    ProjectLookup.predicate = predicate;
    const application = await buildApplication([
      BoundedContext.singleTenant("ProcessManagerQueries")
        .add(projectionRepository())
        .add(processManagerRepository()),
    ]);
    const context = requireContext(application, 0);
    let reads = 0;
    const observation = QueryReader.observe(() => {
      reads += 1;
    });

    try {
      await expect(
        context.commandBus().post(queryCommand("query-id", "invalid")),
      ).resolves.toBeUndefined();
      await queryDeliveryIdle(application);
      expect(ProjectLookup.failure).toBeInstanceOf(Error);
      expect((ProjectLookup.failure as Error).message).toBe(message);
      expect(reads).toBe(0);
    } finally {
      observation.close();
      await context.close();
    }
  });

  it("includes archived state, excludes deleted state, and returns clones", async () => {
    ProjectLookup.reset();
    const application = await buildApplication([
      BoundedContext.singleTenant("ProcessManagerQueries")
        .add(projectionRepository())
        .add(processManagerRepository()),
    ]);
    const context = requireContext(application, 0);

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
      await queryDeliveryIdle(application);
      expect(ProjectLookup.results.map((state) => state.name).sort()).toEqual(["archived", "live"]);
      const live = ProjectLookup.results.find((state) => state.id === "live");
      if (live === undefined) throw new Error("Expected live query result.");
      live.name = "changed by handler";

      await context.commandBus().post(queryCommand("manager", "all"));
      await queryDeliveryIdle(application);
      expect(ProjectLookup.results.find((state) => state.id === "live")).toEqual(
        create(ProjectOverviewStateSchema, { id: "live", name: "live", priority: 1 }),
      );
    } finally {
      await context.close();
    }
  });
});
