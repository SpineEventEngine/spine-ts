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

import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clearInterval, setInterval } from "node:timers";
import { pathToFileURL } from "node:url";
import process from "node:process";

import { create } from "@bufbuild/protobuf";
import { messageDesc } from "@bufbuild/protobuf/codegenv2";
import { RemoteDelivery } from "@spine-event-engine/delivery-client";
import { TypeRegistry } from "@spine-event-engine/core";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { TaskCreatedSchema } from "@spine-event-engine/example-todo/generated/spine/examples/todo/task_events_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "@spine-event-engine/example-todo/generated/spine/examples/todo/task_id_pb.js";
import { createTodoContext } from "@spine-event-engine/example-todo";
import {
  BoundedContext,
  EnvironmentType,
  EventRouting,
  InMemorySubscriptionRegistry,
  ManagedServerApplication,
  Projection,
  Server,
  ServerEnvironment,
  ThirdPartyContext,
  UniformAcrossAllShards,
} from "@spine-event-engine/server";
import { managedServerApplicationAccess } from "../../test-fixtures/internal.mjs";
import { UserIdSchema } from "@spine-event-engine/proto";
import * as FixtureSchemas from "../../test-fixtures/schemas.ts";

const endpoint = required("SPINE_MANAGED_REMOTE_DELIVERY_URL");
const thirdPartyDirectory = required("SPINE_T0210_THIRD_PARTY_DIRECTORY");
const isManagedChild = process.env.SPINE_MANAGED_SERVER_CHILD === "true";
const delivery = RemoteDelivery.connectTo({ endpoint });
const strategy = UniformAcrossAllShards.forNumber(2);
const ExternalStateSchema = projectionStateSchema();

class ExternalTaskProjection extends Projection {
  onExternalTaskCreated(event) {
    const id = event.id?.value;
    if (id === undefined) throw new Error("External TaskCreated event has no task ID.");
    this.update((draft) =>
      Object.assign(
        draft,
        create(ExternalStateSchema, { id, name: `external:${event.title}`, priority: 1 }),
      ),
    );
  }
}

if (isManagedChild) {
  process.env.NODE_ENV = "production";
  ServerEnvironment.when(EnvironmentType.Production).use({
    delivery,
    storageFactory: new InMemoryStorageFactory(),
    typeRegistry: new TypeRegistry([TaskCreatedSchema]),
  });
}

const managed = await ManagedServerApplication.run({
  processCount: 2,
  port: 0,
  moduleUrl: import.meta.url,
  createServer: async ({ host, port }) => {
    const registry = await generatedRegistryRoot();
    const server = Server.atPort(port, { host });
    server.add(
      await createTodoContext({
        deliveryStrategy: strategy,
        subscriptionRegistry: new InMemorySubscriptionRegistry(),
      }),
    );
    server.add(
      await BoundedContext.singleTenant("ExternalTasks")
        .withGeneratedRegistryRoot(registry.root)
        .withDeliveryStrategy(strategy)
        .withSubscriptionRegistry(new InMemorySubscriptionRegistry())
        .add(ExternalTaskProjection, {
          eventRouting: EventRouting.create().route(TaskCreatedSchema, (event) =>
            event.id?.value === undefined ? [] : [event.id.value],
          ),
        })
        .buildAsync(),
    );
    const thirdParty = await ThirdPartyContext.singleTenant("T0210ThirdParty");
    const running = await server.start();
    const close = running.close.bind(running);
    let timer;
    const importThirdParty = async () => {
      try {
        await rename(
          join(thirdPartyDirectory, "third-party-request"),
          join(thirdPartyDirectory, "third-party-claimed"),
        );
      } catch (error) {
        if (error?.code === "ENOENT") return;
        throw error;
      }
      clearInterval(timer);
      await thirdParty.emittedEvent(
        create(TaskCreatedSchema, {
          id: create(TaskIdSchema, { value: "t0210-third-party" }),
          taskListId: create(TaskListIdSchema, { value: "t0210-task-list" }),
          title: "t0210-third-party",
        }),
        create(UserIdSchema, { value: "t0210-third-party" }),
      );
    };
    timer = setInterval(() => {
      void importThirdParty();
    }, 10);
    running.close = async () => {
      clearInterval(timer);
      await thirdParty.close();
      await registry.clear();
      await close();
    };
    return running;
  },
  synchronize: async () => {
    await delivery.open();
  },
});

if (!isManagedChild) {
  let closing;
  const close = () => {
    closing ??= managed.close().then(
      () => process.send?.({ type: "drained" }),
      () => process.send?.({ type: "drain-error" }),
    );
    return closing;
  };
  process.send?.({
    type: "managed-ready",
    members: managedServerApplicationAccess.readyMembers(managed).map((member) => ({
      slot: member.slot,
      pid: member.pid,
    })),
    endpoint: managedServerApplicationAccess.coordinatorEndpoint(managed),
  });
  process.once("SIGTERM", () => {
    void close().finally(() => process.exit(0));
  });
}

async function generatedRegistryRoot() {
  const root = await mkdtemp("/tmp/spine-t0210-registry-");
  const directory = join(root, "generated/handler");
  const slot = `__spineT0210Registry_${process.pid}`;
  await mkdir(directory, { recursive: true });
  globalThis[slot] = {
    receivers: [
      {
        receiverKind: "entity",
        receiverType: ExternalTaskProjection,
        stateSchema: ExternalStateSchema,
        handlers: [
          {
            kind: "event-subscription",
            methodName: "onExternalTaskCreated",
            signalSchema: TaskCreatedSchema,
            emittedSchemas: [],
            parameterCount: 1,
            origin: "external",
          },
        ],
      },
    ],
  };
  await writeFile(
    join(directory, "generated-handler-registry.js"),
    `export const generatedHandlerRegistry = globalThis[${JSON.stringify(slot)}];\n`,
  );
  return {
    root: pathToFileURL(root),
    clear: async () => {
      Reflect.deleteProperty(globalThis, slot);
      await rm(root, { recursive: true, force: true });
    },
  };
}

function projectionStateSchema() {
  return messageDesc(FixtureSchemas.entityMetadataMainFile, 0);
}

function required(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`Missing ${name}.`);
  return value;
}
