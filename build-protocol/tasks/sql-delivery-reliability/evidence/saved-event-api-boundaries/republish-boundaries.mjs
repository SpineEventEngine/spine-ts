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
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const AbortController = globalThis.AbortController;
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
assert.equal(process.cwd(), root.replace(/\/$/, ""));
const artifacts = [];
async function load(path) {
  const absolute = resolve(root, path);
  const bytes = await readFile(absolute);
  artifacts.push({ path: absolute, sha256: createHash("sha256").update(bytes).digest("hex") });
  return import(pathToFileURL(absolute).href);
}
const require = createRequire(resolve(root, "packages/server/package.json"));
const { create, toBinary } = require("@bufbuild/protobuf");
const { BoundedContext } = await load("packages/server/dist/index.js");
await load("packages/server/dist/context/bounded-context.js");
await load("packages/server/dist/runtime/signal-publisher.js");
await load("packages/server/dist/bus/event-bus.js");
const { InMemorySubscriptionRegistry } = await load(
  "packages/server/dist/stand/subscription-registry.js",
);
const { EventStore } = await load("packages/storage/dist/index.js");
await load("packages/storage/dist/event/event-store.js");
const { AnyMessages } = await load("packages/core/dist/index.js");
const {
  ActorContextSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  TenantIdSchema,
  VersionSchema,
} = await load("packages/proto/dist/src/index.js");
const { TaskCreatedSchema } = await load(
  "examples/todo/dist/generated/spine/examples/todo/task_events_pb.js",
);
const { TaskIdSchema, TaskListIdSchema } = await load(
  "examples/todo/dist/generated/spine/examples/todo/task_id_pb.js",
);
const registry = JSON.parse(await readFile(new URL("../databases.json", import.meta.url), "utf8"));
const session = randomUUID().replaceAll("-", "");
const timeout = setTimeout(() => {
  process.stderr.write("Saved Event API boundary probe exceeded 90 seconds.\n");
  process.exit(1);
}, 90_000);
const results = [];
try {
  for (const record of registry.records) {
    const result = await verify(record);
    results.push(result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
  process.stdout.write(
    `${JSON.stringify({ session, pid: process.pid, node: process.version, artifacts, results, status: "PASS" })}\n`,
  );
} finally {
  clearTimeout(timeout);
}

async function verify(record) {
  const isPostgres = record.engine === "postgres";
  const module = isPostgres ? "storage-postgres" : "storage-mysql";
  const providerRequire = createRequire(resolve(root, `packages/${module}/package.json`));
  const adapters = await load(`packages/${module}/dist/index.js`);
  await load(
    isPostgres
      ? "packages/storage-postgres/dist/postgres/storage-factory.js"
      : "packages/storage-mysql/dist/mysql/storage-factory.js",
  );
  const Factory = adapters.PostgresStorageFactory ?? adapters.MysqlStorageFactory;
  const suffix = `${session.slice(0, 10)}_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const tableName = `repair_${suffix}`;
  const systemTableName = `repair_system_${suffix}`;
  const contextName = `SavedEventBoundary_${suffix}`;
  process.stderr.write(
    `${JSON.stringify({ provider: record.name, tenantDatabases: ["spine_tenant_a", "spine_tenant_b"], tableName, systemTableName })}\n`,
  );
  const tenants = ["tenant-a", "tenant-b"].map((value) =>
    create(TenantIdSchema, { kind: { case: "value", value } }),
  );
  const tenantRecordKeys = ["spine_tenant_a", "spine_tenant_b"];
  const context = { name: contextName, multitenant: true };
  const events = [
    makeEvent("shared-event-id", "tenant-a", suffix, "A"),
    makeEvent("shared-event-id", "tenant-b", suffix, "B"),
    makeEvent(`cancel-first-${suffix}`, "tenant-a", suffix, "cancel-first"),
    makeEvent(`cancel-second-${suffix}`, "tenant-a", suffix, "cancel-second"),
  ];
  const bytesByIdTenant = new Map(
    events.map((event) => [
      `${event.id.value}:${event.context.origin.value.tenantId.kind.value}`,
      toBinary(EventSchema, event),
    ]),
  );
  const captured = [];
  const contexts = [];
  const factories = [];
  const stores = [];
  const factory = await Factory.newBuilder()
    .setTenantOptions(
      tenants.map((tenantId, index) => ({
        tenantId,
        options: { url: record.urls[tenantRecordKeys[index]] },
      })),
    )
    .setTableName(EventSchema, tableName)
    .setTableName(EventSchema, EventSchema, systemTableName)
    .build();
  factories.push(factory);
  const store = new EventStore(context, factory);
  stores.push(store);
  for (const event of events) await store.append(event);
  const builder = BoundedContext.multitenant(contextName)
    .withStorageFactory(factory)
    .withSubscriptionRegistry(new InMemorySubscriptionRegistry());
  builder.addEventDispatcher({
    messageSchemas: () => [TaskCreatedSchema],
    dispatch: async (event) => {
      const raw = toBinary(EventSchema, event);
      captured.push({
        eventId: event.id.value,
        tenantId: event.context.origin.value.tenantId.kind.value,
        sha256: createHash("sha256").update(raw).digest("hex"),
        bytesBase64: Buffer.from(raw).toString("base64"),
      });
      if (event.id.value === `cancel-first-${suffix}`) cancellation.abort("stop after first");
    },
  });
  let boundedContext;
  try {
    boundedContext = builder.build();
  } catch (error) {
    store.close();
    factory.close();
    await dropTables(record, providerRequire, isPostgres, tableName, systemTableName);
    throw error;
  }
  contexts.push(boundedContext);
  const cancellation = new AbortController();

  try {
    const missing = await boundedContext.republishEvents({
      eventIds: [`missing-${suffix}`],
      tenantId: tenants[0],
    });
    assert.deepEqual(missing, [{ eventId: `missing-${suffix}`, status: "NOT_FOUND", attempts: 0 }]);

    captured.length = 0;
    const isolated = await boundedContext.republishEvents({
      eventIds: ["shared-event-id"],
      tenantId: tenants[0],
    });
    assert.deepEqual(isolated, [{ eventId: "shared-event-id", status: "ADMITTED", attempts: 1 }]);
    assert.deepEqual(
      captured.map(({ tenantId }) => tenantId),
      ["tenant-a"],
    );
    assert.deepEqual(
      Buffer.from(captured[0].bytesBase64, "base64"),
      Buffer.from(bytesByIdTenant.get("shared-event-id:tenant-a")),
    );
    const isolationDispatched = [...captured];

    const alreadyAborted = new AbortController();
    alreadyAborted.abort("already cancelled");
    const preCancelled = await boundedContext.republishEvents({
      eventIds: [`cancel-first-${suffix}`],
      tenantId: tenants[0],
      signal: alreadyAborted.signal,
    });
    assert.deepEqual(preCancelled, [
      { eventId: `cancel-first-${suffix}`, status: "CANCELLED", attempts: 0 },
    ]);

    captured.length = 0;
    const cancellationOutcomes = await boundedContext.republishEvents({
      eventIds: [`cancel-first-${suffix}`, `cancel-second-${suffix}`],
      tenantId: tenants[0],
      signal: cancellation.signal,
    });
    assert.deepEqual(cancellationOutcomes, [
      { eventId: `cancel-first-${suffix}`, status: "CANCELLED", attempts: 1 },
      { eventId: `cancel-second-${suffix}`, status: "CANCELLED", attempts: 0 },
    ]);
    assert.deepEqual(
      captured.map(({ eventId }) => eventId),
      [`cancel-first-${suffix}`],
    );

    return {
      provider: record.name,
      serverVersion: record.serverVersion,
      pid: process.pid,
      node: process.version,
      session,
      contextName,
      tableName,
      systemTableName,
      tenantDatabases: tenantRecordKeys,
      eventIds: events.map((event) => event.id.value),
      eventBytes: events.map((event) => ({
        id: event.id.value,
        tenantId: event.context.origin.value.tenantId.kind.value,
        sha256: createHash("sha256").update(toBinary(EventSchema, event)).digest("hex"),
        bytesBase64: Buffer.from(toBinary(EventSchema, event)).toString("base64"),
      })),
      calls: {
        missing: { eventIds: [`missing-${suffix}`], tenantId: "tenant-a", outcomes: missing },
        tenantIsolation: {
          eventIds: ["shared-event-id"],
          tenantId: "tenant-a",
          outcomes: isolated,
          dispatched: isolationDispatched,
        },
        alreadyAborted: {
          eventIds: [`cancel-first-${suffix}`],
          tenantId: "tenant-a",
          outcomes: preCancelled,
        },
        cancellationBetweenIds: {
          eventIds: [`cancel-first-${suffix}`, `cancel-second-${suffix}`],
          tenantId: "tenant-a",
          outcomes: cancellationOutcomes,
          dispatched: captured,
        },
      },
      cleanup: { status: "PASS", tablesDropped: [tableName, systemTableName] },
      osProcessRestart: false,
      recipientInboxDeduplication: false,
      status: "PASS",
    };
  } finally {
    const closures = await Promise.allSettled(contexts.map((item) => item.close()));
    for (const result of closures) {
      if (result.status !== "rejected") continue;
      process.stderr.write(`Context cleanup failed: ${String(result.reason)}\n`);
      process.exitCode = 1;
    }
    for (const item of stores) item.close();
    for (const item of factories) item.close();
    await dropTables(record, providerRequire, isPostgres, tableName, systemTableName);
  }

  function makeEvent(id, tenantId, token, title) {
    const taskId = create(TaskIdSchema, { value: `task-${token}-${tenantId}-${title}` });
    return create(EventSchema, {
      id: create(EventIdSchema, { value: id }),
      context: create(EventContextSchema, {
        producerId: AnyMessages.pack(TaskIdSchema, taskId),
        version: create(VersionSchema, { number: 1 }),
        origin: {
          case: "importContext",
          value: create(ActorContextSchema, {
            tenantId: tenants[tenantId === "tenant-a" ? 0 : 1],
          }),
        },
      }),
      message: AnyMessages.pack(
        TaskCreatedSchema,
        create(TaskCreatedSchema, {
          id: taskId,
          taskListId: create(TaskListIdSchema, { value: `list-${token}` }),
          title,
        }),
      ),
    });
  }
}

async function dropTables(record, providerRequire, isPostgres, tableName, systemTableName) {
  const quote = (name) => (isPostgres ? `"${name}"` : `\`${name}\``);
  for (const tenantKey of ["spine_tenant_a", "spine_tenant_b"]) {
    const driver = isPostgres
      ? new (providerRequire("pg").Client)({ connectionString: record.urls[tenantKey] })
      : await providerRequire("mysql2/promise").createConnection(record.urls[tenantKey]);
    if (isPostgres) await driver.connect();
    try {
      await driver.query(`DROP TABLE IF EXISTS ${quote(tableName)}`);
      await driver.query(`DROP TABLE IF EXISTS ${quote(systemTableName)}`);
      const remaining = isPostgres
        ? (
            await driver.query(
              "SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema() AND tablename = ANY($1::text[])",
              [[tableName, systemTableName]],
            )
          ).rows
        : (
            await driver.query(
              "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (?, ?)",
              [tableName, systemTableName],
            )
          )[0];
      assert.deepEqual(remaining, [], `Probe table cleanup failed in ${tenantKey}.`);
    } finally {
      await driver.end();
    }
  }
}
