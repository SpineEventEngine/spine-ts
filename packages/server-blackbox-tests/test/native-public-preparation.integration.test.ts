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
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { Pool } from "pg";
import {
  AnyPacker,
  SignalEnvelopes,
  StringifierRegistry,
  TypeRegistry,
  TypeUrls,
} from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandContextSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@spine-event-engine/proto";
import {
  SubscriptionService,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
  type SubscriptionUpdate,
} from "@spine-event-engine/proto/client";
import {
  Aggregate,
  BoundedContext,
  EnvironmentType,
  Repository,
  Server,
  ServerEnvironment,
  type BoundedContext as BuiltContext,
} from "@spine-event-engine/server";
import { ServerTests } from "@spine-event-engine/server/testing";
import type { StorageFactory } from "@spine-event-engine/storage";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { afterEach, expect, it, onTestFinished } from "vitest";

import {
  ProjectIdSchema,
  ProjectStateSchema,
  type ProjectId,
} from "../generated/spine/server/testing/project_workflow_pb.js";
import { CreateProjectSchema } from "../generated/spine/server/testing/project_commands_pb.js";
import {
  PlanningIdSchema,
  PlanningStateSchema,
  PortfolioIdSchema,
  PortfolioStateSchema,
  ProjectProjectionStateSchema,
  StaffingIdSchema,
  StaffingStateSchema,
} from "../generated/spine/server/testing/project_workflow_pb.js";
import { projectWorkflow, projectWorkflowIds } from "../test-fixtures/project-workflow.js";

const url = process.env.SPINE_TS_POSTGRESQL_URL;
const tenantAUrl = process.env.SPINE_TS_POSTGRESQL_TENANT_A_URL;
const tenantBUrl = process.env.SPINE_TS_POSTGRESQL_TENANT_B_URL;

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

it
  .skipIf(url === undefined || tenantAUrl === undefined || tenantBUrl === undefined)
  .each(["eager", "lazy"] as const)(
  "creates the first default PostgreSQL subscription for a multitenant context (%s)",
  async (mode) => {
    if (url === undefined || tenantAUrl === undefined || tenantBUrl === undefined)
      throw new Error("PostgreSQL shared and tenant task URLs are required.");
    const tenantA = create(TenantIdSchema, { kind: { case: "value", value: "native-a" } });
    const tenantB = create(TenantIdSchema, { kind: { case: "value", value: "native-b" } });
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(
      new TypeRegistry([
        ProjectIdSchema,
        ProjectStateSchema,
        PlanningIdSchema,
        PlanningStateSchema,
        StaffingIdSchema,
        StaffingStateSchema,
        PortfolioIdSchema,
        PortfolioStateSchema,
        ProjectProjectionStateSchema,
      ]),
    );
    const schema = `native_sub_${randomUUID().replaceAll("-", "")}`;
    const databases = [url, tenantAUrl, tenantBUrl];
    const pools = databases.map((connectionString) => new Pool({ connectionString }));
    const sharedPool = pools[0];
    if (sharedPool === undefined) throw new Error("Shared PostgreSQL pool is required.");
    const created: Pool[] = [];
    let factory: StorageFactory | undefined;
    let environment: ServerEnvironment | undefined;
    let context: BuiltContext | undefined;
    let running: Awaited<ReturnType<Server["start"]>> | undefined;
    let iterator: AsyncIterator<SubscriptionUpdate> | undefined;
    let cancelSubscription: (() => Promise<unknown>) | undefined;
    const activationAbort = new AbortController();
    let cleanupPromise: Promise<void> | undefined;
    const cleanup = (): Promise<void> => {
      cleanupPromise ??= closeNativeResources([
        () => {
          activationAbort.abort();
          return Promise.resolve();
        },
        async () => {
          await iterator?.return?.();
        },
        async () => {
          await cancelSubscription?.();
        },
        () => running?.close(),
        () => context?.close(),
        () => environment?.close() ?? factory?.close(),
        ...pools.map((pool) => async () => {
          if (!created.includes(pool)) return;
          await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
          const result = await pool.query<{ name: string | null }>(
            "SELECT to_regnamespace($1)::text AS name",
            [schema],
          );
          expect(result.rows[0]?.name).toBeNull();
        }),
        ...pools.map((pool) => () => pool.end()),
      ]);
      return cleanupPromise;
    };
    onTestFinished(cleanup);
    try {
      for (const pool of pools) {
        await pool.query(`CREATE SCHEMA "${schema}"`);
        created.push(pool);
      }
      factory = await PostgresStorageFactory.newBuilder()
        .setOptions({ url, schema })
        .setTenantOptions([
          { tenantId: tenantA, options: { url: tenantAUrl, schema } },
          { tenantId: tenantB, options: { url: tenantBUrl, schema } },
        ])
        .setStringifierRegistry(stringifiers)
        .build();
      ServerEnvironment.when(EnvironmentType.Local).use({ storageFactory: factory });
      environment = ServerEnvironment.instance();
      await environment.completeSetup();
      await environment.tenantIndex.keep(tenantA);
      await environment.tenantIndex.keep(tenantB);
      const name = `NativeSubscription_${randomUUID().replaceAll("-", "")}`;
      context = await projectWorkflow(name, () => undefined, {
        multitenant: true,
        build:
          mode === "lazy"
            ? { createStorageStructures: false, startSubscriptionMonitoring: false }
            : {},
      });
      running = await new Server({ contexts: [context], port: 0 }).start();
      const subscriptionClient = createClient(
        SubscriptionService,
        createGrpcTransport({ baseUrl: running.baseUrl }),
      );
      const topic = create(TopicSchema, {
        id: create(TopicIdSchema, { value: `t-${randomUUID()}` }),
        target: create(TargetSchema, {
          type: TypeUrls.derive(ProjectStateSchema),
          criterion: { case: "includeAll", value: true },
        }),
        context: create(ActorContextSchema, {
          tenantId: tenantA,
          actor: create(UserIdSchema, { value: "native-subscriber" }),
        }),
      });
      const accepted = await subscriptionClient.subscribe(topic);
      cancelSubscription = () => subscriptionClient.cancel(accepted);
      iterator = subscriptionClient
        .activate(accepted, { signal: activationAbort.signal })
        [Symbol.asyncIterator]();
      await expect(iterator.next()).resolves.toMatchObject({
        done: false,
        value: {
          subscription: { id: accepted.id },
          response: { status: { status: { case: "ok" } } },
        },
      });
      const entityId = projectWorkflowIds(name, 1).project;
      for (const [tenantId, tenantName] of [
        [tenantB, "tenant-b"],
        [tenantA, "tenant-a"],
      ] as const) {
        const command = SignalEnvelopes.command({
          context: create(CommandContextSchema, {
            actorContext: create(ActorContextSchema, {
              actor: create(UserIdSchema, { value: "native-command-actor" }),
              tenantId,
              timestamp: create(TimestampSchema),
            }),
          }),
          schema: CreateProjectSchema,
          message: create(CreateProjectSchema, { project: entityId, name: tenantName }),
        });
        await context.commandBus().post(command);
      }
      const delivered = await iterator.next();
      expect(delivered.done).toBe(false);
      const deliveredUpdate = delivered.done ? undefined : delivered.value;
      expect(deliveredUpdate?.update.case).toBe("entityUpdates");
      const update = deliveredUpdate?.update;
      const state = update?.case === "entityUpdates" ? update.value.update[0]?.kind : undefined;
      expect(state?.case).toBe("state");
      const project =
        state?.case === "state" ? AnyPacker.tryUnpack(state.value, ProjectStateSchema) : undefined;
      expect(project?.name).toBe("tenant-a");
      await expect(
        context.stand().read(ProjectStateSchema, entityId, { tenantId: tenantA }),
      ).resolves.toMatchObject({ name: "tenant-a" });
      await expect(
        context.stand().read(ProjectStateSchema, entityId, { tenantId: tenantB }),
      ).resolves.toMatchObject({ name: "tenant-b" });
      const tables = await Promise.all(
        pools.map((pool) =>
          pool.query<{ tablename: string }>(
            "SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename",
            [schema],
          ),
        ),
      );
      const sharedTables = tables[0];
      if (sharedTables === undefined) throw new Error("Shared PostgreSQL tables are required.");
      const sharedSubscriptionTables = sharedTables.rows.filter((row) =>
        row.tablename.includes("subscription"),
      );
      expect(sharedSubscriptionTables).toHaveLength(1);
      for (const tenantTables of tables.slice(1)) {
        expect(tenantTables.rows.some((row) => row.tablename.includes("subscription"))).toBe(false);
        expect(tenantTables.rows.length).toBeGreaterThan(0);
      }
      const subscriptionTable = sharedSubscriptionTables[0];
      if (subscriptionTable === undefined)
        throw new Error("Shared PostgreSQL subscription table is required.");
      const stored = await sharedPool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "${schema}"."${subscriptionTable.tablename.replaceAll('"', '""')}"`,
      );
      expect(stored.rows[0]?.count).toBe("1");
    } finally {
      await cleanup();
    }
  },
);
