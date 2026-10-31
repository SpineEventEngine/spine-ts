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

import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AnyPacker, TypeUrls } from "@spine-event-engine/core";
import { StringValueSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import {
  QueryIdSchema,
  QuerySchema,
  QueryService,
  TargetFiltersSchema,
  TargetSchema,
} from "@spine-event-engine/proto/client";
import {
  ActorContextSchema,
  ErrorSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@spine-event-engine/proto";
import { AppQuerySchema, type AppQuery } from "@spine-event-engine/proto/client";

import { AppQueryHandler, type AppQueryContext } from "../../src/handler/app-query-handler.js";
import {
  registerSpineMetadata,
  spineMetadataTestAccess,
  type AppQueryDescription,
} from "../../src/handler/spine-metadata-inventory.js";
import { Server, type ServerQueryExecutionContext } from "../../src/server/server.js";
import { BrowserServer, type StandaloneBrowserServerOptions } from "../../src/browser/index.js";
import { BoundedContext } from "../../src/context/bounded-context.js";
import { ProcessManager, Projection } from "../../src/entity/entity.js";
import { Repository } from "../../src/repository/repository.js";
import { EntityHandlers } from "../../src/handler/handler-metadata.js";
import { ServerEnvironment } from "../../src/server/server-environment.js";
import { resetServerEnvironmentForTest } from "../../src/testing/index.js";
import {
  GetProjectOverview_QuerySchema,
  GetProjectOverview_ResponseSchema,
  type GetProjectOverview_Query,
  type GetProjectOverview_Response,
} from "../../test-fixtures/generated/repository-routing/project_queries_pb.js";
import { ProjectIdSchema } from "../../test-fixtures/generated/repository-routing/project_identifiers_pb.js";
import {
  ProjectOverviewStateSchema,
  ProjectQueueStateSchema,
  type ProjectOverviewState,
} from "../../test-fixtures/generated/repository-routing/project_states_pb.js";
import {
  ProjectOverviewStateQuery,
  ProjectQueueStateQuery,
} from "../../test-fixtures/generated/repository-routing/project_states_query.js";
import { GetProjectOverview } from "../../test-fixtures/generated/repository-routing/project_queries_app_query.js";
import { serverTestFixturesProtoModule } from "../../test-fixtures/generated/proto-module.js";
import { ReadSideFilter, type ReadSideContext } from "../../src/stand/read-side-filter.js";

void serverTestFixturesProtoModule;

class ProjectOverviewHandler extends AppQueryHandler<
  GetProjectOverview_Query,
  GetProjectOverview_Response
> {
  /**
   * Returns the paired generated response for one valid project request.
   *
   * @param query Validated project lookup.
   * @param context Trusted read and identity scope.
   * @returns The paired Project Overview response.
   */
  execute(query: GetProjectOverview_Query, context: AppQueryContext): GetProjectOverview_Response {
    void context;
    return create(GetProjectOverview_ResponseSchema, {
      project: { id: query.project?.value ?? "", name: "Overview", priority: 2 },
    });
  }
}

class AlternateOverviewHandler extends ProjectOverviewHandler {}

class ReadOverviewHandler extends AppQueryHandler<
  GetProjectOverview_Query,
  GetProjectOverview_Response
> {
  /**
   * Reads the registered Project Overview projection for this request.
   *
   * @param query Validated project lookup.
   * @param context Current Server's trusted state-read capability.
   * @returns The paired result containing the matched projection.
   */
  async execute(
    query: GetProjectOverview_Query,
    context: AppQueryContext,
  ): Promise<GetProjectOverview_Response> {
    const states = await context
      .select(
        ProjectOverviewStateQuery.create()
          .byId(query.project?.value ?? "")
          .build(),
      )
      .read();
    return create(GetProjectOverview_ResponseSchema, { project: states[0] });
  }
}

class OverviewProjection extends Projection<string, typeof ProjectOverviewStateSchema> {}

class HiddenProjectQueue extends ProcessManager<string, typeof ProjectQueueStateSchema> {}

class HiddenReadOverviewHandler extends AppQueryHandler<
  GetProjectOverview_Query,
  GetProjectOverview_Response
> {
  async execute(query: GetProjectOverview_Query, context: AppQueryContext) {
    await context
      .select(
        ProjectQueueStateQuery.create()
          .byId(query.project?.value ?? "")
          .build(),
      )
      .read();
    return create(GetProjectOverview_ResponseSchema, {
      project: { id: query.project?.value ?? "" },
    });
  }
}

function registerOverview(handlerType: AppQueryDescription["handlerType"]): void {
  registerSpineMetadata(
    {
      receivers: [],
      appQueries: [
        {
          handlerType,
          queryTypeName: GetProjectOverview_QuerySchema.typeName,
          querySchema: GetProjectOverview_QuerySchema,
          responseSchema: GetProjectOverview_ResponseSchema,
        },
      ],
    },
    `test:${handlerType.name}`,
  );
}

function actorContext(): ActorContext {
  return create(ActorContextSchema, {
    actor: { value: "reader-1" },
    timestamp: create(TimestampSchema, { seconds: 1n }),
  });
}

function appQuery(project = "project-1"): AppQuery {
  return create(AppQuerySchema, {
    id: { value: "q-1" },
    context: actorContext(),
    message: AnyPacker.pack(
      GetProjectOverview_QuerySchema,
      create(GetProjectOverview_QuerySchema, {
        project: create(ProjectIdSchema, { value: project }),
      }),
    ),
  });
}

function entityQuery(project: string) {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: "q-public" }),
    context: actorContext(),
    target: create(TargetSchema, {
      type: TypeUrls.derive(ProjectOverviewStateSchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, {
          idFilter: {
            id: [AnyPacker.pack(StringValueSchema, create(StringValueSchema, { value: project }))],
          },
        }),
      },
    }),
  });
}

function directQuery(
  server: Server,
  input: AppQuery,
  reader: Omit<ServerQueryExecutionContext, "actorContext"> = {},
): Promise<GetProjectOverview_Response> {
  if (input.message === undefined || input.context === undefined)
    throw new Error("Complete App Query fixture required.");
  const request = AnyPacker.unpack(input.message, GetProjectOverview_QuerySchema);
  return server.query(request, { actorContext: input.context, ...reader });
}

function executeEnvelope(baseUrl: string, input: AppQuery) {
  const client = createClient(QueryService, createConnectTransport({ baseUrl, httpVersion: "2" }));
  return client.execute(input);
}

function rejectUnpairedRequestAtCompileTime(server: Server): void {
  // @ts-expect-error Entity state is not an application query with a paired R.
  void server.query(create(ProjectOverviewStateSchema), { actorContext: actorContext() });
}
void rejectUnpairedRequestAtCompileTime;

beforeEach(async () => {
  await resetServerEnvironmentForTest();
  await ServerEnvironment.instance().completeSetup();
});

afterEach(async () => {
  await resetServerEnvironmentForTest();
  spineMetadataTestAccess.clear();
});

describe("Server App Query execution", () => {
  it("keeps BC read policies separate for two registered state families", async () => {
    class Label extends ReadSideFilter<typeof ProjectOverviewStateSchema> {
      constructor(private readonly label: string) {
        super(ProjectOverviewStateSchema);
      }
      filter(state: ProjectOverviewState): ProjectOverviewState {
        state.name = this.label;
        return state;
      }
    }
    class QueueLabel extends ReadSideFilter<typeof ProjectQueueStateSchema> {
      constructor() {
        super(ProjectQueueStateSchema);
      }
      filter(
        state: import("../../test-fixtures/generated/repository-routing/project_states_pb.js").ProjectQueueState,
      ) {
        state.queue = "SecondProjects";
        return state;
      }
    }
    const first = await BoundedContext.singleTenant("FirstProjects")
      .add(
        new Repository({
          entityType: OverviewProjection,
          schema: ProjectOverviewStateSchema,
          handlers: EntityHandlers.define(OverviewProjection, ProjectOverviewStateSchema, () => []),
        }),
      )
      .addReadSideFilter(new Label("FirstProjects"))
      .build();
    try {
      const second = await BoundedContext.singleTenant("SecondProjects")
        .add(
          new Repository({
            entityType: HiddenProjectQueue,
            schema: ProjectQueueStateSchema,
            handlers: EntityHandlers.define(HiddenProjectQueue, ProjectQueueStateSchema, () => []),
          }),
        )
        .addReadSideFilter(new QueueLabel())
        .build();
      try {
        await first.stand().update(
          ProjectOverviewStateSchema,
          create(ProjectOverviewStateSchema, {
            id: "project-1",
            name: "Stored",
            priority: 1,
          }),
        );
        await second.stand().update(
          ProjectQueueStateSchema,
          create(ProjectQueueStateSchema, {
            id: "queue-1",
            queue: "Private",
          }),
        );
        expect((await first.stand().read(ProjectOverviewStateSchema, "project-1"))?.name).toBe(
          "FirstProjects",
        );
        expect((await second.stand().read(ProjectQueueStateSchema, "queue-1"))?.queue).toBe(
          "SecondProjects",
        );
      } finally {
        await second.close();
      }
    } finally {
      await first.close();
    }
  });

  it("isolates Server policy selection between two listeners", async () => {
    class Label extends ReadSideFilter<typeof GetProjectOverview_ResponseSchema> {
      constructor(private readonly label: string) {
        super(GetProjectOverview_ResponseSchema);
      }
      filter(result: GetProjectOverview_Response): GetProjectOverview_Response {
        if (result.project !== undefined) result.project.name = this.label;
        return result;
      }
    }
    registerOverview(ProjectOverviewHandler);
    const first = new Server({
      appQueries: [new ProjectOverviewHandler()],
      readSideFilters: [new Label("First")],
    });
    const second = new Server({
      appQueries: [new ProjectOverviewHandler()],
      readSideFilters: [new Label("Second")],
    });
    const left = await first.start();
    const right = await second.start();
    try {
      const output = await Promise.all([
        executeEnvelope(left.baseUrl, appQuery()),
        executeEnvelope(right.baseUrl, appQuery()),
      ]);
      const packed = output.map((response) => response.message[0]);
      if (packed.some((value) => value === undefined))
        throw new Error("Expected both paired responses.");
      expect(
        packed.map((value) => {
          if (value === undefined) throw new Error("Expected a paired response.");
          return AnyPacker.unpack(value, GetProjectOverview_ResponseSchema).project?.name;
        }),
      ).toEqual(["First", "Second"]);
    } finally {
      await right.close();
      await left.close();
    }
  });

  it("invokes one filter instance once at each installed BC and Server boundary", async () => {
    const calls: string[] = [];
    class Mark extends ReadSideFilter<typeof ProjectOverviewStateSchema> {
      constructor() {
        super(ProjectOverviewStateSchema);
      }
      filter(state: ProjectOverviewState, context: ReadSideContext): ProjectOverviewState {
        calls.push(context.operation.kind);
        state.name += " visible";
        return state;
      }
    }
    const policy = new Mark();
    const projects = await BoundedContext.singleTenant("TwoBoundaries")
      .add(
        new Repository({
          entityType: OverviewProjection,
          schema: ProjectOverviewStateSchema,
          handlers: EntityHandlers.define(OverviewProjection, ProjectOverviewStateSchema, () => []),
        }),
      )
      .addReadSideFilter(policy)
      .addReadSideFilter(policy)
      .build();
    await projects.stand().update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, {
        id: "project-1",
        name: "Stored",
        priority: 1,
      }),
    );
    const server = new Server({ contexts: [projects], readSideFilters: [policy, policy] });
    const running = await server.start();
    try {
      const client = createClient(
        QueryService,
        createConnectTransport({ baseUrl: running.baseUrl, httpVersion: "2" }),
      );
      const result = await client.read(entityQuery("project-1"));
      const packed = result.message[0]?.state;
      if (packed === undefined) throw new Error("Expected Entity result.");
      expect(AnyPacker.unpack(packed, ProjectOverviewStateSchema).name).toBe(
        "Stored visible visible",
      );
      expect(calls).toEqual(["query", "query"]);
      expect((await projects.stand().read(ProjectOverviewStateSchema, "project-1"))?.name).toBe(
        "Stored visible",
      );
    } finally {
      await running.close();
    }
  });

  it("fails a Server policy fault without exposing private details or returning raw R", async () => {
    class Fault extends ReadSideFilter<typeof GetProjectOverview_ResponseSchema> {
      constructor() {
        super(GetProjectOverview_ResponseSchema);
      }
      filter(): never {
        throw new Error("private policy secret");
      }
    }
    registerOverview(ProjectOverviewHandler);
    const server = new Server({
      appQueries: [new ProjectOverviewHandler()],
      readSideFilters: [new Fault()],
    });
    const running = await server.start();
    try {
      const error = await executeEnvelope(running.baseUrl, appQuery()).catch(
        (failure: unknown) => failure,
      );
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.Internal);
      expect((error as ConnectError).message).not.toContain("private policy secret");
    } finally {
      await running.close();
    }
  });

  it.each([
    [Code.Canceled, Code.Canceled],
    [Code.Unauthenticated, Code.Unauthenticated],
    [Code.PermissionDenied, Code.PermissionDenied],
    [Code.Unavailable, Code.Unavailable],
    [Code.InvalidArgument, Code.Internal],
  ])("sanitizes App Query policy status %s as %s", async (raised, expected) => {
    class Fault extends ReadSideFilter<typeof GetProjectOverview_ResponseSchema> {
      constructor() {
        super(GetProjectOverview_ResponseSchema);
      }
      filter(): never {
        throw new ConnectError("private policy secret", raised);
      }
    }
    registerOverview(ProjectOverviewHandler);
    const running = await new Server({
      appQueries: [new ProjectOverviewHandler()],
      readSideFilters: [new Fault()],
    }).start();
    try {
      const error = await executeEnvelope(running.baseUrl, appQuery()).catch(
        (failure: unknown) => failure,
      );
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(expected);
      expect((error as ConnectError).message).not.toContain("private policy secret");
    } finally {
      await running.close();
    }
  });

  it("preserves a sanitized child-read authorization status during App Query execution", async () => {
    class DenySource extends ReadSideFilter<typeof ProjectOverviewStateSchema> {
      constructor() {
        super(ProjectOverviewStateSchema);
      }
      filter(): never {
        throw new ConnectError("private child policy detail", Code.PermissionDenied);
      }
    }
    registerOverview(ReadOverviewHandler);
    const projects = await BoundedContext.singleTenant("DeniedProjectSource")
      .add(
        new Repository({
          entityType: OverviewProjection,
          schema: ProjectOverviewStateSchema,
          handlers: EntityHandlers.define(OverviewProjection, ProjectOverviewStateSchema, () => []),
        }),
      )
      .addReadSideFilter(new DenySource())
      .build();
    await projects.stand().update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, {
        id: "project-1",
        name: "Stored private",
        priority: 3,
      }),
    );
    const running = await new Server({
      contexts: [projects],
      appQueries: [new ReadOverviewHandler()],
    }).start();
    try {
      const error = await executeEnvelope(running.baseUrl, appQuery()).catch(
        (failure: unknown) => failure,
      );
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.PermissionDenied);
      expect((error as ConnectError).message).not.toContain("private child policy detail");
    } finally {
      await running.close();
    }
  });

  it("returns OK with no App Query message when a Server policy removes R", async () => {
    class RemoveResult extends ReadSideFilter<typeof GetProjectOverview_ResponseSchema> {
      constructor() {
        super(GetProjectOverview_ResponseSchema);
      }
      filter(): null {
        return null;
      }
    }
    registerOverview(ProjectOverviewHandler);
    const server = new Server({
      appQueries: [new ProjectOverviewHandler()],
      readSideFilters: [new RemoveResult()],
    });
    const running = await server.start();
    try {
      expect((await directQuery(server, appQuery())).project?.name).toBe("Overview");
      const response = await executeEnvelope(running.baseUrl, appQuery());
      expect(response.response?.status?.status.case).toBe("ok");
      expect(response.message).toEqual([]);
    } finally {
      await running.close();
    }
  });

  it("filters public Entity Query output at the Server boundary without changing stored state", async () => {
    class EgressPolicy extends ReadSideFilter<typeof ProjectOverviewStateSchema> {
      constructor() {
        super(ProjectOverviewStateSchema);
      }
      filter(state: ProjectOverviewState, context: ReadSideContext): ProjectOverviewState {
        expect(context.operation.kind).toBe("query");
        state.name = "Server visible";
        return state;
      }
    }
    const projects = await BoundedContext.singleTenant("PublicProjects")
      .add(
        new Repository({
          entityType: OverviewProjection,
          schema: ProjectOverviewStateSchema,
          handlers: EntityHandlers.define(OverviewProjection, ProjectOverviewStateSchema, () => []),
        }),
      )
      .build();
    await projects.stand().update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, {
        id: "project-1",
        name: "Stored private",
        priority: 3,
      }),
    );
    const server = new Server({ contexts: [projects], readSideFilters: [new EgressPolicy()] });
    const running = await server.start();
    try {
      const client = createClient(
        QueryService,
        createConnectTransport({ baseUrl: running.baseUrl, httpVersion: "2" }),
      );
      const response = await client.read(entityQuery("project-1"));
      expect(response.message).toHaveLength(1);
      const packed = response.message[0]?.state;
      if (packed === undefined) throw new Error("Expected Entity state result.");
      expect(AnyPacker.unpack(packed, ProjectOverviewStateSchema).name).toBe("Server visible");
      expect((await projects.stand().read(ProjectOverviewStateSchema, "project-1"))?.name).toBe(
        "Stored private",
      );
    } finally {
      await running.close();
    }
  });

  it.each([
    [Code.Canceled, Code.Canceled],
    [Code.Unauthenticated, Code.Unauthenticated],
    [Code.Unavailable, Code.Unavailable],
    [Code.InvalidArgument, Code.Internal],
  ])("sanitizes Entity Query policy status %s as %s", async (raised, expected) => {
    class Fault extends ReadSideFilter<typeof ProjectOverviewStateSchema> {
      constructor() {
        super(ProjectOverviewStateSchema);
      }
      filter(): never {
        throw new ConnectError("private Entity policy detail", raised);
      }
    }
    const projects = await BoundedContext.singleTenant("FaultedProjectReads")
      .add(
        new Repository({
          entityType: OverviewProjection,
          schema: ProjectOverviewStateSchema,
          handlers: EntityHandlers.define(OverviewProjection, ProjectOverviewStateSchema, () => []),
        }),
      )
      .build();
    await projects.stand().update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, {
        id: "project-1",
        name: "Stored private",
        priority: 3,
      }),
    );
    const running = await new Server({
      contexts: [projects],
      readSideFilters: [new Fault()],
    }).start();
    try {
      const client = createClient(
        QueryService,
        createConnectTransport({ baseUrl: running.baseUrl, httpVersion: "2" }),
      );
      const error = await client
        .read(entityQuery("project-1"))
        .catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(expected);
      expect((error as ConnectError).message).not.toContain("private Entity policy detail");
    } finally {
      await running.close();
    }
  });
  it("applies BC source policy before handler execution and Server result policy only at RPC egress", async () => {
    const seen: ReadSideContext[] = [];
    class SourcePolicy extends ReadSideFilter<typeof ProjectOverviewStateSchema> {
      constructor() {
        super(ProjectOverviewStateSchema);
      }
      filter(state: ProjectOverviewState, context: ReadSideContext): ProjectOverviewState {
        seen.push(context);
        state.name = "BC visible";
        return state;
      }
    }
    class EgressPolicy extends ReadSideFilter<typeof GetProjectOverview_ResponseSchema> {
      constructor() {
        super(GetProjectOverview_ResponseSchema);
      }
      filter(
        result: GetProjectOverview_Response,
        context: ReadSideContext,
      ): GetProjectOverview_Response {
        seen.push(context);
        if (result.project !== undefined) result.project.name = "Server visible";
        return result;
      }
    }
    registerOverview(ReadOverviewHandler);
    const projects = await BoundedContext.singleTenant("FilteredProjects")
      .add(
        new Repository({
          entityType: OverviewProjection,
          schema: ProjectOverviewStateSchema,
          handlers: EntityHandlers.define(OverviewProjection, ProjectOverviewStateSchema, () => []),
        }),
      )
      .addReadSideFilter(new SourcePolicy())
      .build();
    await projects.stand().update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, {
        id: "project-1",
        name: "Stored private",
        priority: 3,
      }),
    );
    const server = new Server({
      contexts: [projects],
      appQueries: [new ReadOverviewHandler()],
      readSideFilters: [new EgressPolicy()],
    });
    const running = await server.start();
    try {
      const local = await directQuery(server, appQuery());
      expect(local.project?.name).toBe("BC visible");
      const remote = await executeEnvelope(running.baseUrl, appQuery());
      const packed = remote.message[0];
      if (packed === undefined) throw new Error("Expected paired response.");
      expect(AnyPacker.unpack(packed, GetProjectOverview_ResponseSchema).project?.name).toBe(
        "Server visible",
      );
      expect(seen.map((context) => context.operation.kind)).toEqual([
        "query",
        "query",
        "app-query",
      ]);
      expect(seen[0]?.enclosingAppQuery?.id?.value).toBeTruthy();
      expect(seen[1]?.enclosingAppQuery?.id?.value).toBe("q-1");
      expect(seen[2]?.producingContext).toBeUndefined();
    } finally {
      await running.close();
    }
  });
  it("accepts generated Q directly and returns its paired R to application code", async () => {
    registerOverview(ProjectOverviewHandler);
    const server = new Server({ appQueries: [new ProjectOverviewHandler()] });
    const running = await server.start();
    try {
      const query = create(GetProjectOverview.querySchema, {
        project: create(ProjectIdSchema, { value: "project-typed" }),
      });
      const result: GetProjectOverview.Response = await server.query(query, {
        actorContext: actorContext(),
      });
      expect(result.project?.id).toBe("project-typed");
    } finally {
      await running.close();
    }
  });

  it("executes an explicitly registered generated handler through the Server capability", async () => {
    registerOverview(ProjectOverviewHandler);
    const server = new Server({ appQueries: [new ProjectOverviewHandler()] });
    const running = await server.start();
    const response = await directQuery(server, appQuery());

    expect(response.project?.name).toBe("Overview");
    await running.close();
  });

  it("keeps passive metadata unavailable until this Server selects an instance", async () => {
    registerOverview(ProjectOverviewHandler);
    const server = new Server();
    const running = await server.start();

    await expect(directQuery(server, appQuery())).rejects.toMatchObject({ code: 3 });

    await running.close();
  });

  it("rejects absent and duplicate handler metadata before listening", async () => {
    await expect(
      new Server({ appQueries: [new ProjectOverviewHandler()] }).start(),
    ).rejects.toThrow(/metadata.*missing/u);
    registerOverview(ProjectOverviewHandler);
    registerOverview(AlternateOverviewHandler);
    await expect(
      new Server({
        appQueries: [new ProjectOverviewHandler(), new AlternateOverviewHandler()],
      }).start(),
    ).rejects.toThrow(/Two App Query handlers/u);
  });

  it("rejects invalid root Q and unsupported Q before handler work", async () => {
    let calls = 0;
    class CountingOverviewHandler extends ProjectOverviewHandler {
      override execute(
        query: GetProjectOverview_Query,
        context: AppQueryContext,
      ): GetProjectOverview_Response {
        calls++;
        return super.execute(query, context);
      }
    }
    registerOverview(CountingOverviewHandler);
    const server = new Server({ appQueries: [new CountingOverviewHandler()] });
    const running = await server.start();
    const invalid = appQuery();
    invalid.message = AnyPacker.pack(
      GetProjectOverview_QuerySchema,
      create(GetProjectOverview_QuerySchema),
    );
    await expect(executeEnvelope(running.baseUrl, invalid)).rejects.toMatchObject({ code: 3 });
    const unsupported = appQuery();
    if (unsupported.message === undefined) throw new Error("Expected packed Query fixture.");
    unsupported.message.typeUrl = "type.spine.io/unknown.Other.Query";
    await expect(executeEnvelope(running.baseUrl, unsupported)).rejects.toMatchObject({ code: 3 });
    const malformed = appQuery();
    if (malformed.message === undefined) throw new Error("Expected packed Query fixture.");
    malformed.message.value = Uint8Array.of(255);
    const failure = await executeEnvelope(running.baseUrl, malformed).catch(
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ code: Code.InvalidArgument });
    expect((failure as ConnectError).findDetails(ErrorSchema)).toMatchObject([
      { type: "spine.client.QueryValidationError" },
    ]);
    expect((failure as ConnectError).metadata.get("spine-error-bin")).toBeTruthy();
    const malformedTyped = create(GetProjectOverview_QuerySchema, {
      project: create(ProjectIdSchema, { value: "project-1" }),
    });
    malformedTyped.project = "wrong runtime shape" as unknown as NonNullable<
      typeof malformedTyped.project
    >;
    await expect(
      server.query(malformedTyped, {
        actorContext: actorContext(),
      }),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    expect(calls).toBe(0);
    await running.close();
  });

  it("keeps different implementations of one Q isolated between Servers", async () => {
    class OtherOverviewHandler extends ProjectOverviewHandler {
      override execute(query: GetProjectOverview_Query): GetProjectOverview_Response {
        return create(GetProjectOverview_ResponseSchema, {
          project: { id: query.project?.value ?? "", name: "Other Server" },
        });
      }
    }
    registerOverview(ProjectOverviewHandler);
    registerOverview(OtherOverviewHandler);
    const first = new Server({ appQueries: [new ProjectOverviewHandler()] });
    const second = new Server({ appQueries: [new OtherOverviewHandler()] });
    const firstRunning = await first.start();
    const secondRunning = await second.start();
    try {
      expect((await directQuery(first, appQuery())).project?.name).toBe("Overview");
      expect((await directQuery(second, appQuery())).project?.name).toBe("Other Server");
    } finally {
      await secondRunning.close();
      await firstRunning.close();
    }
  });

  it("dispatches the captured Q when its caller mutates the envelope during an await", async () => {
    const seen: string[] = [];
    class CapturingOverviewHandler extends ProjectOverviewHandler {
      override execute(
        query: GetProjectOverview_Query,
        context: AppQueryContext,
      ): GetProjectOverview_Response {
        seen.push(query.project?.value ?? "missing");
        return super.execute(query, context);
      }
    }
    registerOverview(CapturingOverviewHandler);
    const server = new Server({ appQueries: [new CapturingOverviewHandler()] });
    const running = await server.start();
    const request = create(GetProjectOverview_QuerySchema, {
      project: create(ProjectIdSchema, { value: "project-before" }),
    });
    const pending = server.query(request, {
      actorContext: actorContext(),
    });
    if (request.project === undefined) throw new Error("Expected Project ID fixture.");
    request.project.value = "project-after";

    await pending;
    expect(seen).toEqual(["project-before"]);
    await running.close();
  });

  it("reads a registered projection through the handler's Server-bound scope", async () => {
    registerOverview(ReadOverviewHandler);
    const projects = await BoundedContext.singleTenant("OverviewProjects")
      .add(
        new Repository({
          entityType: OverviewProjection,
          schema: ProjectOverviewStateSchema,
          handlers: EntityHandlers.define(OverviewProjection, ProjectOverviewStateSchema, () => []),
        }),
      )
      .build();
    await projects
      .stand()
      .update(
        ProjectOverviewStateSchema,
        create(ProjectOverviewStateSchema, { id: "project-1", name: "Stored", priority: 3 }),
      );
    const server = new Server({ contexts: [projects], appQueries: [new ReadOverviewHandler()] });
    const running = await server.start();
    try {
      const response = await directQuery(server, appQuery());
      expect(response.project?.name).toBe("Stored");
      const wrongTenant = appQuery();
      if (wrongTenant.context === undefined) throw new Error("Expected ActorContext fixture.");
      wrongTenant.context.tenantId = create(TenantIdSchema, {
        kind: { case: "value", value: "unrelated" },
      });
      const failure = await directQuery(server, wrongTenant).catch((error: unknown) => error);
      expect((failure as ConnectError).findDetails(ErrorSchema)).toMatchObject([
        { type: "TENANT_INAPPLICABLE" },
      ]);
    } finally {
      await running.close();
    }
  });

  it("drains an accepted App Query before closing its projection and rejects late work", async () => {
    let entered!: () => void;
    let resume!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const waiting = new Promise<void>((resolve) => (resume = resolve));
    class PausedReadHandler extends ReadOverviewHandler {
      override async execute(query: GetProjectOverview_Query, context: AppQueryContext) {
        entered();
        await waiting;
        return super.execute(query, context);
      }
    }
    registerOverview(PausedReadHandler);
    const projects = await BoundedContext.singleTenant("ClosingProjects")
      .add(
        new Repository({
          entityType: OverviewProjection,
          schema: ProjectOverviewStateSchema,
          handlers: EntityHandlers.define(OverviewProjection, ProjectOverviewStateSchema, () => []),
        }),
      )
      .build();
    await projects
      .stand()
      .update(
        ProjectOverviewStateSchema,
        create(ProjectOverviewStateSchema, { id: "project-1", name: "Stored", priority: 3 }),
      );
    const server = new Server({ contexts: [projects], appQueries: [new PausedReadHandler()] });
    const running = await server.start();
    const pending = directQuery(server, appQuery());
    await started;
    let closed = false;
    const closing = running.close().then(() => {
      closed = true;
    });
    await expect(directQuery(server, appQuery())).rejects.toThrow("closed");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(closed).toBe(false);
    resume();
    expect((await pending).project?.name).toBe("Stored");
    await closing;
    expect(closed).toBe(true);
  });

  it("drains a canceled handler without making close fail", async () => {
    let entered!: () => void;
    let resume!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const waiting = new Promise<void>((resolve) => (resume = resolve));
    class CanceledHandler extends AppQueryHandler<
      GetProjectOverview_Query,
      GetProjectOverview_Response
    > {
      async execute(query: GetProjectOverview_Query, context: AppQueryContext) {
        entered();
        await waiting;
        void context;
        return create(GetProjectOverview_ResponseSchema, {
          project: { id: query.project?.value ?? "", name: "Too late" },
        });
      }
    }
    registerOverview(CanceledHandler);
    const server = new Server({ appQueries: [new CanceledHandler()] });
    const running = await server.start();
    const controller = new AbortController();
    const pending = directQuery(server, appQuery(), { signal: controller.signal });
    await started;
    const closing = running.close();
    controller.abort();
    resume();
    await expect(pending).rejects.toMatchObject({ code: Code.Canceled });
    await expect(closing).resolves.toBeUndefined();
  });

  it("waits for accepted native Execute handler work after its session closes", async () => {
    let entered!: () => void;
    let resume!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const waiting = new Promise<void>((resolve) => (resume = resolve));
    class NativePausedHandler extends AppQueryHandler<
      GetProjectOverview_Query,
      GetProjectOverview_Response
    > {
      async execute(query: GetProjectOverview_Query) {
        entered();
        await waiting;
        return create(GetProjectOverview_ResponseSchema, {
          project: { id: query.project?.value ?? "", name: "Complete" },
        });
      }
    }
    registerOverview(NativePausedHandler);
    const server = new Server({ appQueries: [new NativePausedHandler()] });
    const running = await server.start();
    const pending = executeEnvelope(running.baseUrl, appQuery()).catch((error: unknown) => error);
    await started;
    let closed = false;
    const closing = running.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(closed).toBe(false);
    resume();
    await closing;
    await pending;
    expect(closed).toBe(true);
  });

  it("keeps App Query admission closed after a retryable close failure", async () => {
    registerOverview(ProjectOverviewHandler);
    let attempts = 0;
    const server = new Server({ appQueries: [new ProjectOverviewHandler()] });
    server.addListenerLifecycle({
      start: () => undefined,
      close: () => {
        if (++attempts === 1) throw new Error("listener close failed");
      },
    });
    const running = await server.start();
    await expect(running.close()).rejects.toThrow("listener close failed");
    await expect(directQuery(server, appQuery())).rejects.toMatchObject({ code: Code.Unavailable });
    await running.close();
    expect(attempts).toBe(2);
  });

  it("keeps target tenant membership failures structured and never returns state", async () => {
    registerOverview(ReadOverviewHandler);
    const projects = await BoundedContext.multitenant("TenantProjects")
      .add(
        new Repository({
          entityType: OverviewProjection,
          schema: ProjectOverviewStateSchema,
          handlers: EntityHandlers.define(OverviewProjection, ProjectOverviewStateSchema, () => []),
        }),
      )
      .build();
    const server = new Server({ contexts: [projects], appQueries: [new ReadOverviewHandler()] });
    const running = await server.start();
    try {
      const required = await directQuery(server, appQuery()).catch((error: unknown) => error);
      expect((required as ConnectError).findDetails(ErrorSchema)).toMatchObject([
        { type: "TENANT_REQUIRED" },
      ]);
      const input = appQuery();
      if (input.context === undefined) throw new Error("Expected ActorContext fixture.");
      input.context.tenantId = create(TenantIdSchema, { kind: { case: "value", value: "absent" } });
      const failure = await directQuery(server, input).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ConnectError);
      expect(failure).toMatchObject({ code: Code.NotFound });
      expect((failure as ConnectError).findDetails(ErrorSchema)).toMatchObject([
        { type: "TENANT_UNKNOWN" },
      ]);
    } finally {
      await running.close();
    }
  });

  it("rejects a child read whose state is absent from this Server", async () => {
    registerOverview(ReadOverviewHandler);
    const server = new Server({ appQueries: [new ReadOverviewHandler()] });
    const running = await server.start();
    try {
      const failure = await directQuery(server, appQuery()).catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: Code.InvalidArgument });
      expect((failure as ConnectError).findDetails(ErrorSchema)).toMatchObject([
        { type: "spine.client.QueryValidationError" },
      ]);
    } finally {
      await running.close();
    }
  });

  it("denies a subscription-only source even when its context shares this Server", async () => {
    registerOverview(HiddenReadOverviewHandler);
    const queues = await BoundedContext.singleTenant("PrivateQueues")
      .add(
        new Repository({
          entityType: HiddenProjectQueue,
          schema: ProjectQueueStateSchema,
          handlers: EntityHandlers.define(HiddenProjectQueue, ProjectQueueStateSchema, () => []),
        }),
      )
      .build();
    const server = new Server({
      contexts: [queues],
      appQueries: [new HiddenReadOverviewHandler()],
    });
    const running = await server.start();
    try {
      await expect(directQuery(server, appQuery())).rejects.toMatchObject({
        code: Code.PermissionDenied,
      });
    } finally {
      await running.close();
    }
  });

  it("does not invent a target tenant membership check for a no-read handler", async () => {
    registerOverview(ProjectOverviewHandler);
    const server = new Server({ appQueries: [new ProjectOverviewHandler()] });
    const running = await server.start();
    try {
      const input = appQuery();
      if (input.context === undefined) throw new Error("Expected ActorContext fixture.");
      input.context.tenantId = create(TenantIdSchema, { kind: { case: "value", value: "unseen" } });
      expect((await directQuery(server, input)).project?.name).toBe("Overview");
    } finally {
      await running.close();
    }
  });

  it("executes through the direct app-node QueryService route", async () => {
    registerOverview(ProjectOverviewHandler);
    const server = new Server({ appQueries: [new ProjectOverviewHandler()] });
    const running = await server.start();
    try {
      const client = createClient(
        QueryService,
        createConnectTransport({ baseUrl: running.baseUrl, httpVersion: "2" }),
      );
      const response = await client.execute(appQuery());
      const packed = response.message[0];
      if (packed === undefined) throw new Error("Expected paired response fixture.");
      expect(AnyPacker.unpack(packed, GetProjectOverview_ResponseSchema).project?.name).toBe(
        "Overview",
      );
    } finally {
      await running.close();
    }
  });

  it("executes through a standalone public browser gateway without activating a handler there", async () => {
    registerOverview(ProjectOverviewHandler);
    const server = new Server({ appQueries: [new ProjectOverviewHandler()] });
    const running = await server.start();
    const browserOptions = {
      port: 0,
      origins: ["http://127.0.0.1:5173"],
      publicAccess: true,
      authorize: () => Promise.resolve(true),
      contexts: {
        resolve: () =>
          Promise.resolve({
            actor: create(UserIdSchema, { value: "reader-1" }),
            timestamp: create(TimestampSchema, { seconds: 1n }),
          }),
        resolveContext: () =>
          Promise.resolve({
            actor: create(UserIdSchema, { value: "reader-1" }),
            timestamp: create(TimestampSchema, { seconds: 1n }),
          }),
      },
      clock: { now: () => create(TimestampSchema, { seconds: 1n }) },
      backend: { baseUrl: running.baseUrl },
    } satisfies StandaloneBrowserServerOptions;
    const browser = await BrowserServer.open(undefined, browserOptions);
    try {
      const client = createClient(
        QueryService,
        createConnectTransport({ baseUrl: browser.baseUrl, httpVersion: "1.1" }),
      );
      const result = await client.execute(appQuery(), {
        headers: { origin: "http://127.0.0.1:5173" },
      });
      const packed = result.message[0];
      if (packed === undefined) throw new Error("Expected the paired project response.");
      expect(AnyPacker.unpack(packed, GetProjectOverview_ResponseSchema).project?.name).toBe(
        "Overview",
      );
    } finally {
      await browser.close();
      await running.close();
    }
  });

  it("detaches verified reader facts for the handler and keeps concurrent readers separate", async () => {
    const entered: string[] = [];
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    class FactsOverviewHandler extends AppQueryHandler<
      GetProjectOverview_Query,
      GetProjectOverview_Response
    > {
      async execute(
        query: GetProjectOverview_Query,
        context: AppQueryContext,
      ): Promise<GetProjectOverview_Response> {
        entered.push(context.principal?.id ?? "anonymous");
        await waiting;
        const roles = context.authorityFacts?.roles;
        return create(GetProjectOverview_ResponseSchema, {
          project: {
            id: query.project?.value ?? "",
            name: `${context.principal?.id ?? "anonymous"}:${JSON.stringify(roles)}`,
          },
        });
      }
    }
    registerOverview(FactsOverviewHandler);
    const server = new Server({ appQueries: [new FactsOverviewHandler()] });
    const running = await server.start();
    try {
      const firstRoles = ["reviewer"];
      const first = directQuery(server, appQuery("first"), {
        principal: { id: "reader-one" },
        authorityFacts: { roles: firstRoles },
      });
      const second = directQuery(server, appQuery("second"), {
        principal: { id: "reader-two" },
        authorityFacts: { roles: ["editor"] },
      });
      firstRoles.push("changed");
      release();
      const responses = await Promise.all([first, second]);
      expect(entered).toEqual(["reader-one", "reader-two"]);
      expect(responses.map((response) => response.project?.name)).toEqual([
        'reader-one:["reviewer"]',
        'reader-two:["editor"]',
      ]);
    } finally {
      release();
      await running.close();
    }
  });

  it("stops a canceled internal invocation before handler work", async () => {
    let calls = 0;
    class CancelOverviewHandler extends ProjectOverviewHandler {
      override execute(
        query: GetProjectOverview_Query,
        context: AppQueryContext,
      ): GetProjectOverview_Response {
        calls++;
        return super.execute(query, context);
      }
    }
    registerOverview(CancelOverviewHandler);
    const server = new Server({ appQueries: [new CancelOverviewHandler()] });
    const running = await server.start();
    try {
      const controller = new AbortController();
      controller.abort();
      await expect(
        directQuery(server, appQuery(), { signal: controller.signal }),
      ).rejects.toMatchObject({ code: Code.Canceled });
      expect(calls).toBe(0);
    } finally {
      await running.close();
    }
  });

  it("propagates cancellation into an active handler and rejects its late result", async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = new AbortController();
    let observed: AbortSignal | undefined;
    class WaitingOverviewHandler extends AppQueryHandler<
      GetProjectOverview_Query,
      GetProjectOverview_Response
    > {
      async execute(query: GetProjectOverview_Query, context: AppQueryContext) {
        observed = context.signal;
        entered();
        await waiting;
        return create(GetProjectOverview_ResponseSchema, {
          project: { id: query.project?.value ?? "", name: "Too late" },
        });
      }
    }
    registerOverview(WaitingOverviewHandler);
    const server = new Server({ appQueries: [new WaitingOverviewHandler()] });
    const running = await server.start();
    try {
      const pending = directQuery(server, appQuery(), { signal: controller.signal });
      await started;
      expect(observed).toBe(controller.signal);
      controller.abort();
      release();
      await expect(pending).rejects.toMatchObject({ code: Code.Canceled });
    } finally {
      release();
      await running.close();
    }
  });

  it("rejects a wrong paired response type instead of returning empty success", async () => {
    class WrongOverviewHandler extends ProjectOverviewHandler {
      override execute(): GetProjectOverview_Response {
        return create(GetProjectOverview_QuerySchema) as unknown as GetProjectOverview_Response;
      }
    }
    registerOverview(WrongOverviewHandler);
    const server = new Server({ appQueries: [new WrongOverviewHandler()] });
    const running = await server.start();
    try {
      await expect(directQuery(server, appQuery())).rejects.toMatchObject({ code: Code.Internal });
    } finally {
      await running.close();
    }
  });

  it("rejects an unserializable paired response as a technical failure", async () => {
    class BrokenOverviewHandler extends ProjectOverviewHandler {
      override execute(): GetProjectOverview_Response {
        const response = create(GetProjectOverview_ResponseSchema, {
          project: { id: "project-1", name: "Invalid field" },
        });
        Object.assign(response.project ?? {}, { priority: "not an integer" });
        return response;
      }
    }
    registerOverview(BrokenOverviewHandler);
    const server = new Server({ appQueries: [new BrokenOverviewHandler()] });
    const running = await server.start();
    try {
      await expect(directQuery(server, appQuery())).rejects.toMatchObject({ code: Code.Internal });
    } finally {
      await running.close();
    }
  });

  it("preserves an authentication status without leaking handler details", async () => {
    class DeniedOverviewHandler extends ProjectOverviewHandler {
      override execute(): GetProjectOverview_Response {
        throw new ConnectError("private credential", Code.Unauthenticated);
      }
    }
    registerOverview(DeniedOverviewHandler);
    const server = new Server({ appQueries: [new DeniedOverviewHandler()] });
    const running = await server.start();
    try {
      const failure = await directQuery(server, appQuery()).catch((error: unknown) => error);
      expect(failure).toMatchObject({
        code: Code.Unauthenticated,
        rawMessage: "App Query execution failed.",
      });
    } finally {
      await running.close();
    }
  });

  it("sanitizes unexpected handler transport errors without leaking private details", async () => {
    class FaultyOverviewHandler extends ProjectOverviewHandler {
      override execute(): GetProjectOverview_Response {
        throw new ConnectError("private backend key", Code.Internal, undefined, [
          {
            desc: GetProjectOverview_ResponseSchema,
            value: create(GetProjectOverview_ResponseSchema),
          },
        ]);
      }
    }
    registerOverview(FaultyOverviewHandler);
    const server = new Server({ appQueries: [new FaultyOverviewHandler()] });
    const running = await server.start();
    try {
      const failure = await directQuery(server, appQuery()).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ConnectError);
      expect(failure).toMatchObject({
        code: Code.Internal,
        rawMessage: "App Query execution failed.",
      });
      expect((failure as ConnectError).details).toHaveLength(0);
    } finally {
      await running.close();
    }
  });
});
