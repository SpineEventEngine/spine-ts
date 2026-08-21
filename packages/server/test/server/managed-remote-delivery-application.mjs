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

import { RemoteDelivery } from "@spine-event-engine/delivery-client";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { createTodoContext } from "@spine-event-engine/example-todo";
import { TaskListSchema } from "@spine-event-engine/example-todo/generated/spine/examples/todo/task_list_pb.js";
import {
  EnvironmentType,
  ManagedServerApplication,
  Server,
  ServerEnvironment,
  UniformAcrossAllShards,
} from "@spine-event-engine/server";
import { managedServerApplicationAccess } from "@spine-event-engine/server/testing";
import process from "node:process";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const endpoint = process.env.SPINE_MANAGED_REMOTE_DELIVERY_URL;
if (endpoint === undefined)
  throw new Error("Managed remote Delivery fixture requires an endpoint.");

const delivery = RemoteDelivery.connectTo({ endpoint });
const handlerGate = process.env.SPINE_MANAGED_HANDLER_GATE;
const isManagedChild = process.env.SPINE_MANAGED_SERVER_CHILD === "true";
// The application owns strategy selection; this fixture deliberately applies it
// without comparing or serializing its identity.
const strategy = UniformAcrossAllShards.forNumber(2);

class HandlerGateStorageFactory extends InMemoryStorageFactory {
  constructor(directory) {
    super();
    this.directory = directory;
  }

  createEntityCommitStorage(input) {
    const delegate = super.createEntityCommitStorage(input);
    return {
      commit: async (commit) => {
        if (commit.entity.stateSchema.typeName === TaskListSchema.typeName) {
          await writeFile(join(this.directory, "owner"), String(process.pid));
          await this.waitIfArmed();
        }
        return delegate.commit(commit);
      },
      close: () => delegate.close(),
    };
  }

  async waitIfArmed() {
    try {
      await rename(join(this.directory, "arm"), join(this.directory, "entered"));
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    while (!(await exists(join(this.directory, "release")))) await delay(5);
  }
}

async function exists(path) {
  return import("node:fs/promises")
    .then(({ access }) => access(path))
    .then(
      () => true,
      () => false,
    );
}

const storageFactory =
  !isManagedChild || handlerGate === undefined
    ? undefined
    : new HandlerGateStorageFactory(handlerGate);

if (isManagedChild) {
  ServerEnvironment.when(EnvironmentType.Local).use({ delivery });
}

const managed = await ManagedServerApplication.run({
  processCount: 2,
  port: 50_053,
  moduleUrl: import.meta.url,
  createServer: async ({ host, port }) => {
    const server = Server.atPort(port, { host });
    const { InMemorySubscriptionRegistry } = await import("@spine-event-engine/server");
    server.add(
      await createTodoContext({
        deliveryStrategy: strategy,
        subscriptionRegistry: new InMemorySubscriptionRegistry(),
        ...(storageFactory === undefined ? {} : { storageFactory }),
      }),
    );
    const running = await server.start();
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
  process.on("message", (message) => {
    if (message?.type === "members") {
      process.send?.({
        type: "managed-members",
        requestId: message.requestId,
        members: managedServerApplicationAccess.readyMembers(managed).map((member) => ({
          slot: member.slot,
          pid: member.pid,
        })),
      });
      return;
    }
    if (message?.type !== "drain") return;
    const drained = close();
    process.send?.({ type: "draining" });
    void drained;
  });
  process.once("SIGTERM", () => {
    void close().finally(() => process.exit(0));
  });
}
