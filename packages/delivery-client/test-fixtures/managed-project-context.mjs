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

import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { create } from "@bufbuild/protobuf";
import { Aggregate, BoundedContext, EventRouting, Projection } from "@spine-event-engine/server";

import { CreateProjectSchema } from "@spine-event-engine/server-test-fixtures/entity/project_commands_pb.js";
import { ProjectCreatedSchema } from "@spine-event-engine/server-test-fixtures/entity/project_events_pb.js";
import {
  ProjectOverviewStateSchema,
  ProjectStateSchema,
} from "@spine-event-engine/server-test-fixtures/entity/project_states_pb.js";

/**
 *
 * Handles project creation in managed-server integration fixtures.
 */
class ManagedProjectAggregate extends Aggregate {
  /**
   *
   * Creates a project and records its creation event.
   */
  createProject(command) {
    this.update((draft) => {
      Object.assign(draft, create(ProjectStateSchema, { id: command.id, name: command.name }));
    });
    return create(ProjectCreatedSchema, { id: command.id, name: command.name });
  }
}

/**
 *
 * Builds the project view used by managed-server integration fixtures.
 */
class ManagedProjectProjection extends Projection {
  /**
   *
   * Applies a project creation event to the queryable project view.
   */
  onProjectCreated(event) {
    this.update((draft) => {
      Object.assign(
        draft,
        create(ProjectOverviewStateSchema, { id: event.id, name: event.name, priority: 1 }),
      );
    });
  }
}

/**
 * Creates a server-local project context for managed-server integration tests.
 *
 * @param options Facilities selected by the managed application fixture.
 * @returns The assembled project context.
 */
export async function createManagedProjectContext(options = {}) {
  const registry = await createRegistry(options.includeProjection === true);
  try {
    const builder = BoundedContext.singleTenant("ManagedProjects")
      .withGeneratedRegistryRoot(registry.root)
      .add(ManagedProjectAggregate);
    if (options.includeProjection === true) {
      builder.add(ManagedProjectProjection, {
        eventRouting: EventRouting.create().route(ProjectCreatedSchema, (event) => [event.id]),
      });
    }
    if (options.deliveryStrategy !== undefined) {
      builder.withDeliveryStrategy(options.deliveryStrategy);
    }
    if (options.subscriptionRegistry !== undefined) {
      builder.withSubscriptionRegistry(options.subscriptionRegistry);
    }
    if (options.storageFactory !== undefined) {
      builder.withStorageFactory(options.storageFactory);
    }
    return await builder.buildAsync();
  } finally {
    await registry.clear();
  }
}

/**
 *
 * Creates the generated-handler registry consumed by the fixture context.
 */
async function createRegistry(includeProjection) {
  const directory = await mkdtemp(join(tmpdir(), "spine-managed-projects-"));
  const moduleDirectory = join(directory, "generated/handler");
  const slot = `__spineManagedProjects_${randomUUID().replaceAll("-", "")}`;
  const receivers = [aggregateReceiver()];
  if (includeProjection) receivers.push(projectionReceiver());
  globalThis[slot] = { receivers };
  await mkdir(moduleDirectory, { recursive: true });
  await writeFile(
    join(moduleDirectory, "generated-handler-registry.js"),
    `export const generatedHandlerRegistry = globalThis[${JSON.stringify(slot)}];\n`,
  );
  return {
    root: pathToFileURL(directory),

    /**
     *
     * Removes the temporary registry module and its global value.
     */
    async clear() {
      Reflect.deleteProperty(globalThis, slot);
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/**
 *
 * Describes the aggregate command handler to the runtime.
 */
function aggregateReceiver() {
  return {
    receiverKind: "entity",
    receiverType: ManagedProjectAggregate,
    stateSchema: ProjectStateSchema,
    handlers: [
      {
        kind: "command-assignment",
        methodName: "createProject",
        input: { schema: CreateProjectSchema, origin: "domestic" },
        outcomes: { returned: [ProjectCreatedSchema], thrown: [] },
        parameterCount: 1,
      },
    ],
  };
}

/**
 *
 * Describes the projection event handler to the runtime.
 */
function projectionReceiver() {
  return {
    receiverKind: "entity",
    receiverType: ManagedProjectProjection,
    stateSchema: ProjectOverviewStateSchema,
    handlers: [
      {
        kind: "event-subscription",
        methodName: "onProjectCreated",
        input: { schema: ProjectCreatedSchema, origin: "domestic" },
        outcomes: { returned: [], thrown: [] },
        parameterCount: 1,
      },
    ],
  };
}
