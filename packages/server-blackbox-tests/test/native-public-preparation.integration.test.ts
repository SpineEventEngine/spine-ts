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
import { Pool } from "pg";
import {
  AnyPacker,
  SignalEnvelopes,
  StringifierRegistry,
  TypeRegistry,
  TypeUrls,
  Validate,
} from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandIdSchema,
  CommandContextSchema,
  EventContextSchema,
  EventSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@spine-event-engine/proto";
import {
  SubscriptionService,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
  type Subscription,
  type SubscriptionUpdate,
  type Topic,
} from "@spine-event-engine/proto/client";
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
import { boundedContextAccess } from "../../server/dist/context/bounded-context.js";
import { SpineServices } from "../../server/dist/services/spine-services.js";
import * as EntityLog from "@spine-event-engine/proto/generated/spine/system/server/entity_log_events_pb.js";

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

/**
 * Captures the in-process public SubscriptionService handlers.
 *
 * @param context Built context exposed by the service.
 * @returns Registered subscription procedures.
 */
function subscriptionHandlers(context: BuiltContext) {
  let handlers:
    | {
        subscribe(topic: Topic): Subscription | Promise<Subscription>;
        activate(subscription: Subscription): AsyncIterable<SubscriptionUpdate>;
        cancel(subscription: Subscription): unknown;
      }
    | undefined;
  new SpineServices({ contexts: [context] }).register({
    service(schema: unknown, implementation: unknown) {
      if (schema === SubscriptionService) handlers = implementation as typeof handlers;
      return this;
    },
  } as never);
  if (handlers === undefined) throw new Error("SubscriptionService handlers were not registered.");
  return handlers;
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
    let iterator: AsyncIterator<SubscriptionUpdate> | undefined;
    let handlers: ReturnType<typeof subscriptionHandlers> | undefined;
    let subscription: Subscription | undefined;
    let cancelled = false;
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
      handlers = subscriptionHandlers(context);
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
      subscription = await handlers.subscribe(topic);
      iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
      await expect(iterator.next()).resolves.toMatchObject({
        done: false,
        value: {
          subscription: { id: subscription.id },
          response: { status: { status: { case: "ok" } } },
        },
      });
      const registry = boundedContextAccess.subscriptionRegistry(context);
      expect(registry.persistent).toBe(true);
      const entityId = projectWorkflowIds(name, 1).project;
      let delivered: IteratorResult<SubscriptionUpdate> | undefined;
      let deliveryFailure: unknown;
      void iterator.next().then(
        (result) => {
          delivered = result;
        },
        (error: unknown) => {
          deliveryFailure = error;
        },
      );
      let tenantBCommand: ReturnType<typeof SignalEnvelopes.command> | undefined;
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
        if (tenantName === "tenant-b") tenantBCommand = command;
        await context.commandBus().post(command);
      }
      const tenantBState = await context.stand().read(ProjectStateSchema, entityId, {
        tenantId: tenantB,
      });
      expect(tenantBState).toMatchObject({ name: "tenant-b" });
      if (tenantBState === undefined || tenantBCommand?.id === undefined)
        throw new Error("Tenant B state and originating Command are required.");
      // Repost the persisted B transition as a System Event barrier. Its dispatch follows
      // the A transition on the same bus, while the tenant A stream ignores B's state.
      const markerMessage = Validate.check(
        EntityLog.EntityStateChangedSchema,
        create(EntityLog.EntityStateChangedSchema, {
          entity: {
            id: AnyPacker.pack(ProjectIdSchema, entityId),
            typeUrl: TypeUrls.derive(ProjectStateSchema),
          },
          newState: AnyPacker.pack(ProjectStateSchema, tenantBState),
          signalId: [
            {
              id: AnyPacker.pack(CommandIdSchema, tenantBCommand.id),
              typeUrl: TypeUrls.derive(CreateProjectSchema),
            },
          ],
        }),
      );
      const marker = SignalEnvelopes.event({
        context: create(EventContextSchema, {
          timestamp: create(TimestampSchema),
          origin: { case: "pastMessage", value: SignalEnvelopes.originFromCommand(tenantBCommand) },
          producerId: AnyPacker.pack(ProjectIdSchema, entityId),
        }),
        schema: EntityLog.EntityStateChangedSchema,
        message: markerMessage,
      });
      Validate.check(EventSchema, marker);
      await boundedContextAccess.postSystemEvent(context, marker);
      if (deliveryFailure !== undefined)
        throw new Error("Project subscription delivery failed.", { cause: deliveryFailure });
      if (delivered === undefined) throw new Error("Project subscription update did not arrive.");
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
      await closeNativeResources([
        async () => {
          if (handlers !== undefined && subscription !== undefined) {
            await handlers.cancel(subscription);
            cancelled = true;
          }
        },
        async () => {
          if (cancelled) await iterator?.return?.();
        },
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
    }
  },
);
