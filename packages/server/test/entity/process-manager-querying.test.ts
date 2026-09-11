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
import { AnyMessages, EntityColumn, EntityQuery } from "@spine-event-engine/core";
import { GeneratedEntityColumns } from "@spine-event-engine/core/codegen";
import {
  ActorContextSchema,
  CommandSchema,
  CommandContextSchema,
  CommandIdSchema,
  TenantIdSchema,
  UserIdSchema,
  ZoneIdSchema,
} from "@spine-event-engine/proto";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  Aggregate,
  BoundedContext,
  type DescriptorMessageSchema,
  EntityHandlers,
  ProcessManager,
  Projection,
  Repository,
} from "../../src/index.js";
import { processManagerQueryAccess } from "../../src/entity/entity.js";
import { HandlerMetadataValues } from "../../src/handler/handler-metadata.js";
import { QueryReader } from "../../src/services/query-reader.js";
import {
  type ProjectOverviewState,
  ProjectOverviewStateSchema,
} from "../../test-fixtures/generated/entity-metadata/project_states_pb.js";
import { ProcessManagerStateSchema } from "../../test-fixtures/generated/entity-metadata/visibility_pb.js";
import {
  type ProjectCreated as ProjectionEvent,
  ProjectCreatedSchema as ProjectionEventSchema,
} from "../../test-fixtures/generated/repository-routing/project_events_pb.js";
import {
  type CreateReviewProject,
  CreateReviewProjectSchema,
} from "../../test-fixtures/generated/validation-refusal/project_commands_pb.js";

const projectionColumns = EntityColumn.register(
  ProjectOverviewStateSchema,
  GeneratedEntityColumns.define(ProjectOverviewStateSchema, {
    name: { field: ProjectOverviewStateSchema.field.name, comparison: "ordering" },
    priority: { field: ProjectOverviewStateSchema.field.priority, comparison: "ordering" },
  }),
);
const selectedProjectionColumns: Pick<typeof projectionColumns, "priority"> = projectionColumns;

class QueryProjection extends Projection<string, typeof ProjectOverviewStateSchema, number> {
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

class QueryProcessManager extends ProcessManager<string, typeof ProcessManagerStateSchema, number> {
  static results: readonly ProjectOverviewState[] = [];
  static predicate: unknown;
  static failure: unknown;

  static reset(): void {
    this.results = [];
    this.predicate = undefined;
    this.failure = undefined;
  }

  query() {
    return this.select(ProjectOverviewStateSchema, projectionColumns);
  }

  async assign(command: CreateReviewProject): Promise<ProjectionEvent> {
    const query = this.query();
    try {
      if (QueryProcessManager.predicate !== undefined) {
        query.where(QueryProcessManager.predicate as never);
      }
      QueryProcessManager.results =
        command.name === "all"
          ? await query.all()
          : await query
              .byId(command.id)
              .where(EntityQuery.eq(projectionColumns.name, command.name))
              .read();
    } catch (error) {
      QueryProcessManager.failure = error;
      throw error;
    }
    this.update((draft) => {
      draft.queue = `read ${String(QueryProcessManager.results.length)}`;
    });
    return create(ProjectionEventSchema, {
      id: command.id,
      name: QueryProcessManager.results[0]?.name ?? "none",
      priority: QueryProcessManager.results[0]?.priority ?? 0,
    });
  }
}

abstract class QueryTypeFixture extends ProcessManager<
  string,
  typeof ProcessManagerStateSchema,
  number
> {
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

function processManagerRepository(): Repository<typeof QueryProcessManager> {
  return new Repository({
    entityType: QueryProcessManager,
    schema: ProcessManagerStateSchema,
    handlers: HandlerMetadataValues.defineArity(
      QueryProcessManager,
      ProcessManagerStateSchema,
      (builder) => [builder.assign(CreateReviewProjectSchema, "assign")],
      [
        {
          kind: "command-assignment",
          methodName: "assign",
          parameterCount: 1,
          origin: "domestic",
          emittedSchemas: [ProjectionEventSchema],
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
  it("offers a typed, read-only query only during handler execution", async () => {
    const manager = new QueryProcessManager({
      id: "process-1",
      schema: ProcessManagerStateSchema,
      state: create(ProcessManagerStateSchema, { id: "process-1", queue: "waiting" }),
      version: 1,
      lifecycle: { archived: false, deleted: false },
    });

    expect(() => manager.query()).toThrow(
      "Process Manager queries are available only during repository handler execution.",
    );

    const release = processManagerQueryAccess.bind(
      manager,
      () => Promise.resolve(Object.freeze([])),
      create(ActorContextSchema),
    );
    const query = manager
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
    expectTypeOf<Aggregate<string, typeof ProjectOverviewStateSchema, number>>().not.toHaveProperty(
      "select",
    );
    expect(() => query.limit(1_001)).toThrow("Process Manager query limit may be at most 1000.");

    release();
    await expect(query.read()).rejects.toThrow(
      "Process Manager queries are available only during repository handler execution.",
    );
  });

  it("caps an unlimited read at 1,000 states", async () => {
    const manager = new QueryProcessManager({
      id: "process-1",
      schema: ProcessManagerStateSchema,
      state: create(ProcessManagerStateSchema, { id: "process-1", queue: "waiting" }),
      version: 1,
      lifecycle: { archived: false, deleted: false },
    });
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
      manager,
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

    await expect(manager.query().all()).resolves.toHaveLength(1_000);
    release();
  });

  it("reads only projection state from the active tenant", async () => {
    QueryProcessManager.reset();
    const context = BoundedContext.multitenant("ProcessManagerQueries")
      .add(projectionRepository())
      .add(processManagerRepository())
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
      expect(QueryProcessManager.results).toEqual([
        create(ProjectOverviewStateSchema, { id: "shared", name: "A", priority: 1 }),
      ]);

      await context.commandBus().post(queryCommand("shared", "B", "tenant-b"));
      expect(QueryProcessManager.results).toEqual([
        create(ProjectOverviewStateSchema, { id: "shared", name: "B", priority: 2 }),
      ]);
    } finally {
      await context.close();
    }
  });

  it("passes the signal actor, tenant, and zone to the query", async () => {
    QueryProcessManager.reset();
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
    QueryProcessManager.reset();
    QueryProcessManager.predicate = predicate;
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
      expect(QueryProcessManager.failure).toMatchObject({ message });
      expect(reads).toBe(0);
    } finally {
      observation.close();
      await context.close();
    }
  });

  it("includes archived state, excludes deleted state, and returns clones", async () => {
    QueryProcessManager.reset();
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
      expect(QueryProcessManager.results.map((state) => state.name).sort()).toEqual([
        "archived",
        "live",
      ]);
      const live = QueryProcessManager.results.find((state) => state.id === "live");
      if (live === undefined) throw new Error("Expected live query result.");
      live.name = "changed by handler";

      await context.commandBus().post(queryCommand("manager", "all"));
      expect(QueryProcessManager.results.find((state) => state.id === "live")).toEqual(
        create(ProjectOverviewStateSchema, { id: "live", name: "live", priority: 1 }),
      );
    } finally {
      await context.close();
    }
  });
});
