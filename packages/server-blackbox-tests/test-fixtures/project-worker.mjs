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
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import process from "node:process";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { create, equals, toBinary } from "@bufbuild/protobuf";
import { AnyMessages, StringifierRegistry, TypeRegistry, TypeUrls } from "@spine-event-engine/core";
import { RemoteDelivery } from "@spine-event-engine/delivery-client";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  CommandSchema,
  EventSchema,
  UserIdSchema,
} from "@spine-event-engine/proto";
import { CommandService } from "@spine-event-engine/proto/client";
import {
  EnvironmentType,
  InboxStorage,
  Server,
  ServerEnvironment,
  ShardIndex,
} from "@spine-event-engine/server";
import { EventStore } from "@spine-event-engine/storage";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { MysqlStorageFactory } from "@spine-event-engine/storage-mysql";

import { CreateProjectSchema } from "../dist/generated/spine/server/testing/project_commands_pb.js";
import { ProjectCreatedSchema } from "../dist/generated/spine/server/testing/project_events_pb.js";
import {
  PlanningStateSchema,
  PlanningIdSchema,
  OrganizationIdSchema,
  PortfolioIdSchema,
  PortfolioStateSchema,
  ProjectIdSchema,
  ProjectProjectionStateSchema,
  ProjectStateSchema,
  StaffingIdSchema,
  StaffingStateSchema,
} from "../dist/generated/spine/server/testing/project_workflow_pb.js";
import { projectWorkflow, projectWorkflowIds } from "../dist/test-fixtures/project-workflow.js";
import { fileLogger } from "./file-logger.mjs";

let running;
let factory;
let context;
let settings;
let delivery;
let commandClient;

process.on("message", (request) => {
  void handle(request).then(
    (result) => process.send?.({ requestId: request.requestId, ok: true, result }),
    (error) => process.send?.({ requestId: request.requestId, ok: false, error: String(error) }),
  );
});

async function handle(request) {
  switch (request.kind) {
    case "start":
      return start(request);
    case "post":
      return post(request);
    case "inspect":
      return inspect(request);
    case "inspectDelivery":
      return inspectDelivery();
    case "close":
      await close();
      return { closed: true };
    default:
      throw new Error(`Unsupported worker request ${String(request.kind)}.`);
  }
}

async function start(request) {
  settings = request.settings;
  const Factory = settings.engine === "postgres" ? PostgresStorageFactory : MysqlStorageFactory;
  const stringifiers = new StringifierRegistry();
  stringifiers.setTypeRegistry(
    new TypeRegistry([
      OrganizationIdSchema,
      ProjectIdSchema,
      PlanningIdSchema,
      StaffingIdSchema,
      PortfolioIdSchema,
      CreateProjectSchema,
      ProjectCreatedSchema,
      ProjectStateSchema,
      PlanningStateSchema,
      StaffingStateSchema,
      PortfolioStateSchema,
      ProjectProjectionStateSchema,
    ]),
  );
  factory = await Factory.newBuilder()
    .setOptions({ url: settings.url })
    .setStringifierRegistry(stringifiers)
    .build();
  const environmentSettings = { logger: fileLogger(settings.logPath) };
  if (settings.deliveryEndpoint !== undefined) {
    delivery = RemoteDelivery.connectTo({ endpoint: settings.deliveryEndpoint });
    environmentSettings.delivery = delivery;
    ServerEnvironment.when(EnvironmentType.Local).use(environmentSettings);
    await delivery.open();
  } else {
    ServerEnvironment.when(EnvironmentType.Local).use(environmentSettings);
  }
  context = projectWorkflow(
    settings.contextName,
    (entry) => {
      appendFileSync(
        settings.entryLog,
        `${JSON.stringify({ ...entry, pid: process.pid, at: Date.now() })}\n`,
        { flush: true },
      );
    },
    factory,
    settings.shards,
  );
  running = await Server.atPort(0).add(context).start();
  commandClient = createClient(CommandService, createGrpcTransport({ baseUrl: running.baseUrl }));
  return {
    pid: process.pid,
    endpoint: running.baseUrl,
    configuredShards: settings.shards,
    artifacts: settings.artifactPaths.map((path) => ({
      path,
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    })),
  };
}

async function post(request) {
  if (running === undefined) throw new Error("Worker is not ready.");
  const ids = projectWorkflowIds(settings.organization, request.number ?? settings.number);
  const command = create(CommandSchema, {
    id: create(CommandIdSchema, { uuid: request.commandId }),
    context: create(CommandContextSchema, {
      actorContext: create(ActorContextSchema, {
        actor: create(UserIdSchema, { value: "matrix-actor" }),
      }),
    }),
    message: AnyMessages.pack(
      CreateProjectSchema,
      create(CreateProjectSchema, { project: ids.project, name: `roadmap-${ids.project.number}` }),
    ),
  });
  const ack = await commandClient.post(command, { timeoutMs: 10_000 });
  return {
    commandId: request.commandId,
    number: request.number ?? settings.number,
    ackStatus: ack.status?.status ?? "missing",
  };
}

async function inspect(request) {
  if (context === undefined) throw new Error("Worker is not ready.");
  const numbers = request.numbers ?? [settings.number];
  const projects = [];
  for (const number of numbers) {
    const ids = projectWorkflowIds(settings.organization, number);
    const expectedName = `roadmap-${number}`;
    const [project, planning, staffing, portfolio, projection] = await Promise.all([
      context.stand().read(ProjectStateSchema, ids.project),
      context.stand().read(PlanningStateSchema, ids.planning),
      context.stand().read(StaffingStateSchema, ids.staffing),
      context.stand().read(PortfolioStateSchema, ids.portfolio),
      context.stand().read(ProjectProjectionStateSchema, ids.project),
    ]);
    projects.push({
      number,
      states: {
        project:
          project?.name === expectedName &&
          project.status === "created" &&
          project.id !== undefined &&
          equals(ProjectIdSchema, project.id, ids.project),
        planning:
          planning?.projectName === expectedName &&
          planning.id !== undefined &&
          equals(PlanningIdSchema, planning.id, ids.planning),
        staffing:
          staffing?.projectName === expectedName &&
          staffing.id !== undefined &&
          equals(StaffingIdSchema, staffing.id, ids.staffing),
        portfolio:
          portfolio?.name === expectedName &&
          portfolio.id !== undefined &&
          equals(PortfolioIdSchema, portfolio.id, ids.portfolio),
        projection:
          projection?.name === expectedName &&
          projection.id !== undefined &&
          equals(ProjectIdSchema, projection.id, ids.project),
      },
    });
  }
  const store = new EventStore({ name: settings.contextName, multitenant: false }, factory);
  const events = await store.read();
  store.close();
  const created = events.filter(
    (event) => event.message?.typeUrl === TypeUrls.derive(ProjectCreatedSchema),
  );
  return {
    projects,
    events: created.map((event) => {
      const payload = AnyMessages.unpack(event.message, ProjectCreatedSchema);
      const binary = toBinary(EventSchema, event);
      return {
        id: event.id?.value,
        typeUrl: event.message?.typeUrl,
        number: payload?.project?.number,
        organization: payload?.organization?.code,
        name: payload?.name,
        sha256: createHash("sha256").update(binary).digest("hex"),
        binaryBase64: Buffer.from(binary).toString("base64"),
      };
    }),
  };
}

async function inspectDelivery() {
  if (factory === undefined || settings === undefined) throw new Error("Worker is not ready.");
  const inbox =
    delivery?.inbox ??
    new InboxStorage({
      context: { name: settings.contextName, multitenant: false },
      storageFactory: factory,
    });
  const shardIndices = Array.from(
    { length: settings.shards },
    (_, index) => new ShardIndex(index, settings.shards),
  );
  const single = ShardIndex.single();
  if (!shardIndices.some((shard) => shard.key() === single.key())) shardIndices.push(single);
  const shards = await Promise.all(
    shardIndices.map(async (shard) => {
      try {
        const messages = await inbox.read(shard, { limit: 1_000 });
        return {
          shard: shard.key(),
          count: messages.length,
          truncated: messages.length === 1_000,
          rows: messages.map((message) => ({
            messageId: message.id.value,
            signalId: message.signalId,
            targetTypeUrl: message.inboxId.targetTypeUrl,
            status: message.status,
            whenReceivedSeconds: String(message.whenReceived.seconds),
            whenReceivedNanos: message.whenReceived.nanos,
            version: String(message.version),
          })),
          statuses: messages.reduce((counts, message) => {
            counts[message.status] = (counts[message.status] ?? 0) + 1;
            return counts;
          }, {}),
        };
      } catch (error) {
        return { shard: shard.key(), error: String(error) };
      }
    }),
  );
  const observations =
    delivery === undefined
      ? undefined
      : await delivery.source
          .shardSnapshot()
          .then((updates) =>
            updates.map((update) => ({
              shard: update.shard.key(),
              status: update.status,
              messages: update.messages,
            })),
          )
          .catch((error) => ({ error: String(error) }));
  return { shards, observations };
}

async function close() {
  if (running !== undefined) await running.close();
  if (delivery !== undefined) await delivery.close();
  if (factory !== undefined) factory.close();
}
