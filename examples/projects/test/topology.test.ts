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
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { TypeUrls, AnyMessages, SignalEnvelopes } from "@spine-event-engine/core";
import { UserIdSchema } from "@spine-event-engine/proto";
import { CommandService } from "@spine-event-engine/proto/client";
import { TargetFiltersSchema, TargetSchema } from "@spine-event-engine/proto/client";
import { QueryIdSchema, QuerySchema } from "@spine-event-engine/proto/client";
import { QueryService } from "@spine-event-engine/proto/client";
import { TopicIdSchema, TopicSchema } from "@spine-event-engine/proto/client";
import { SubscriptionService } from "@spine-event-engine/proto/client";
import { SignalMetadata } from "@spine-event-engine/server";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CreateProjectSchema } from "../generated/spine/examples/projects/commands_pb.js";
import { ProjectSummarySchema } from "../generated/spine/examples/projects/read_models_pb.js";

const metadata = new SignalMetadata();

describe("project-management load example", () => {
  it("provides the generated-domain runtime", () => {
    const modulePath = fileURLToPath(new URL("../dist/src/index.js", import.meta.url));

    expect(existsSync(modulePath)).toBe(true);
  });

  it("registers exactly three aggregates, twenty projections, and ten process managers", async () => {
    const { createProjectManagementContext, projectManagementTopology } =
      await import("../dist/src/index.js");
    expect(projectManagementTopology.aggregates).toHaveLength(3);
    expect(projectManagementTopology.projections).toHaveLength(20);
    expect(projectManagementTopology.processManagers).toHaveLength(10);
    expect(new Set(projectManagementTopology.projections.map((entry) => entry.event))).toEqual(
      new Set(["ProjectCreated", "TaskCreated", "PersonEnrolled"]),
    );
    const context = await createProjectManagementContext();
    try {
      const repositories = context.registeredRepositories();
      expect(repositories).toHaveLength(33);
      expect(
        repositories.filter((repository) => repository.entityFamily === "aggregate"),
      ).toHaveLength(3);
      expect(
        repositories.filter((repository) => repository.entityFamily === "projection"),
      ).toHaveLength(20);
      expect(
        repositories.filter((repository) => repository.entityFamily === "process-manager"),
      ).toHaveLength(10);
    } finally {
      await context.close();
    }
  });

  it("uses real local gRPC command, query, and subscription paths", async () => {
    const { startProjectManagementServer } = await import("../dist/src/index.js");
    const server = await startProjectManagementServer({ host: "127.0.0.1", port: 0 });
    const session = new Http2SessionManager(server.baseUrl);
    const transport = createGrpcTransport({ baseUrl: server.baseUrl, sessionManager: session });
    const commands = createClient(CommandService, transport);
    const queries = createClient(QueryService, transport);
    const subscriptions = createClient(SubscriptionService, transport);
    const id = "project-grpc";
    const actorContext = metadata.actorContext({
      actor: create(UserIdSchema, { value: "load-user" }),
    });
    const subscription = await subscriptions.subscribe(createTopic(id, actorContext));
    const controller = new AbortController();
    const updates = subscriptions
      .activate(subscription, { signal: controller.signal })
      [Symbol.asyncIterator]();
    const nextUpdate = updates.next();

    try {
      const acknowledgement = await commands.post(
        SignalEnvelopes.command({
          id: metadata.commandId("project-grpc-command"),
          context: metadata.commandContext({ actorContext }),
          schema: CreateProjectSchema,
          message: create(CreateProjectSchema, { id, name: "gRPC project" }),
        }),
      );
      expect(acknowledgement.status?.status.case).toBe("ok");

      const response = await readEventually(queries, id, actorContext);
      const summary = response.message
        .map((row) =>
          row.state === undefined ? undefined : AnyMessages.unpack(row.state, ProjectSummarySchema),
        )
        .find((candidate) => candidate?.id === id);
      expect(summary?.name).toBe("gRPC project");

      const update = await nextUpdate;
      expect(update.done).toBe(false);
    } finally {
      controller.abort();
      await updates.return?.();
      session.abort();
      await server.close();
    }
  }, 15_000);
});

async function readEventually(
  queries: ReturnType<typeof createClient<typeof QueryService>>,
  id: string,
  actorContext: ReturnType<typeof metadata.actorContext>,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await queries.read(createQuery(id, actorContext));
    if (response.response?.status?.status.case === "ok" && response.message.length > 0)
      return response;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`ProjectSummary ${id} was not visible within 5000ms.`);
}

function createQuery(id: string, actorContext: ReturnType<typeof metadata.actorContext>) {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: `query-${id}-${String(Date.now())}` }),
    target: create(TargetSchema, {
      type: TypeUrls.derive(ProjectSummarySchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, {
          idFilter: {
            id: [AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: id }))],
          },
        }),
      },
    }),
    context: actorContext,
  });
}

function createTopic(id: string, actorContext: ReturnType<typeof metadata.actorContext>) {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: `project-topic-${id}` }),
    target: create(TargetSchema, {
      type: TypeUrls.derive(ProjectSummarySchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, {
          idFilter: {
            id: [AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: id }))],
          },
        }),
      },
    }),
    context: actorContext,
  });
}
