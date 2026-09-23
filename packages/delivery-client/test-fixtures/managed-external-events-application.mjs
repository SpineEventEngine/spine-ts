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
import { RemoteDelivery } from "@spine-event-engine/delivery-client";
import { TypeRegistry } from "@spine-event-engine/core";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
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
import { UserIdSchema } from "@spine-event-engine/proto";
import { ProjectCreatedSchema } from "@spine-event-engine/server-test-fixtures/entity/project_events_pb.js";
import { ProjectOverviewStateSchema } from "@spine-event-engine/server-test-fixtures/entity/project_states_pb.js";
import { managedServerApplicationAccess } from "@spine-event-engine/server-test-fixtures/internal";
import { createManagedProjectContext } from "./managed-project-context.mjs";

const endpoint = required("SPINE_MANAGED_REMOTE_DELIVERY_URL");
const thirdPartyDirectory = required("SPINE_T0210_THIRD_PARTY_DIRECTORY");
const isManagedChild = process.env.SPINE_MANAGED_SERVER_CHILD === "true";
const delivery = RemoteDelivery.connectTo({ endpoint });
const strategy = UniformAcrossAllShards.forNumber(2);
const ExternalStateSchema = ProjectOverviewStateSchema;

class ExternalProjectProjection extends Projection {
  onExternalProjectCreated(event) {
    const id = event.id;
    if (id.length === 0) throw new Error("External ProjectCreated event has no project ID.");
    this.update((draft) =>
      Object.assign(
        draft,
        create(ExternalStateSchema, { id, name: `external:${event.name}`, priority: 1 }),
      ),
    );
  }
}

if (isManagedChild) {
  process.env.NODE_ENV = "production";
  ServerEnvironment.when(EnvironmentType.Production).use({
    delivery,
    storageFactory: new InMemoryStorageFactory(),
    typeRegistry: new TypeRegistry([ProjectCreatedSchema]),
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
      await createManagedProjectContext({
        deliveryStrategy: strategy,
        subscriptionRegistry: new InMemorySubscriptionRegistry(),
      }),
    );
    server.add(
      await BoundedContext.singleTenant("ExternalProjects")
        .withGeneratedRegistryRoot(registry.root)
        .withDeliveryStrategy(strategy)
        .withSubscriptionRegistry(new InMemorySubscriptionRegistry())
        .add(ExternalProjectProjection, {
          eventRouting: EventRouting.create().route(ProjectCreatedSchema, (event) => [event.id]),
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
        create(ProjectCreatedSchema, {
          id: "t0210-third-party",
          name: "t0210-third-party",
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
        receiverType: ExternalProjectProjection,
        stateSchema: ExternalStateSchema,
        handlers: [
          {
            kind: "event-subscription",
            methodName: "onExternalProjectCreated",
            input: { schema: ProjectCreatedSchema, origin: "external" },
            outcomes: { returned: [], thrown: [] },
            parameterCount: 1,
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

function required(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`Missing ${name}.`);
  return value;
}
