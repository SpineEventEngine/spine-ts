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
import { create } from "@bufbuild/protobuf";
import { Pool } from "pg";
import { StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import {
  Aggregate,
  BoundedContext,
  EnvironmentType,
  Repository,
  ServerEnvironment,
  type BoundedContext as BuiltContext,
} from "@spine-event-engine/server";
import { ServerTests } from "@spine-event-engine/server/testing";
import type { StorageFactory } from "@spine-event-engine/storage";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { afterEach, expect, it } from "vitest";

import {
  ProjectIdSchema,
  ProjectStateSchema,
  type ProjectId,
} from "../generated/spine/server/testing/project_workflow_pb.js";
import { projectWorkflowIds } from "../test-fixtures/project-workflow.js";

const url = process.env.SPINE_TS_POSTGRESQL_URL;

/**
 * Provides a domain-correct Project state registration for the native proof.
 */
class Project extends Aggregate<ProjectId, typeof ProjectStateSchema> {}

afterEach(async () => ServerTests.resetEnvironment());

/**
 * Attempts every native test resource close and reports all cleanup failures.
 *
 * @param closes Resource cleanup operations to attempt.
 */
async function closeNativeResources(closes: readonly (() => Promise<void> | undefined)[]) {
  const failures: unknown[] = [];
  for (const close of closes)
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  if (failures.length > 0) throw new AggregateError(failures, "Native preparation cleanup failed.");
}

it.skipIf(url === undefined)(
  "prepares a real PostgreSQL context through public runtime and environment APIs",
  async () => {
    if (url === undefined) throw new Error("PostgreSQL task URL is required.");
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(new TypeRegistry([ProjectIdSchema, ProjectStateSchema]));
    const schema = `native_prep_${randomUUID().replaceAll("-", "")}`;
    const cleanup = new Pool({ connectionString: url });
    let created = false;
    let factory: StorageFactory | undefined;
    let environment: ServerEnvironment | undefined;
    let context: BuiltContext | undefined;
    try {
      await cleanup.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      factory = await PostgresStorageFactory.newBuilder()
        .setOptions({ url, schema })
        .setStringifierRegistry(stringifiers)
        .build();
      ServerEnvironment.when(EnvironmentType.Local).use({ storageFactory: factory });
      environment = ServerEnvironment.instance();
      await environment.completeSetup();
      const name = `NativePrep_${randomUUID().replaceAll("-", "")}`;
      context = await BoundedContext.singleTenant(name)
        .add(new Repository({ entityType: Project, schema: ProjectStateSchema }))
        .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
      await context.runtime.createStorageStructures();
      await environment.checkStructureCompatibility();
      const id = projectWorkflowIds(name, 1).project;
      await context.stand().update(
        ProjectStateSchema,
        create(ProjectStateSchema, {
          id,
          name: "native-prepared",
          status: "created",
        }),
      );
      await expect(context.stand().read(ProjectStateSchema, id)).resolves.toMatchObject({
        name: "native-prepared",
        status: "created",
      });
    } finally {
      await closeNativeResources([
        () => context?.close(),
        () => environment?.close() ?? factory?.close(),
        async () => {
          if (!created) return;
          await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`);
          const result = await cleanup.query<{ name: string | null }>(
            "SELECT to_regnamespace($1)::text AS name",
            [schema],
          );
          expect(result.rows[0]?.name).toBeNull();
        },
        () => cleanup.end(),
      ]);
    }
  },
);
