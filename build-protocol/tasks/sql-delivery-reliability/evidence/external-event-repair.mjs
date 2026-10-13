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
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
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
const { EventStore } = await load("packages/storage/dist/index.js");
const { AnyMessages } = await load("packages/core/dist/index.js");
const { ActorContextSchema, EventContextSchema, EventIdSchema, EventSchema, VersionSchema } =
  await load("packages/proto/dist/src/index.js");
const { TaskCreatedSchema } = await load(
  "examples/todo/dist/generated/spine/examples/todo/task_events_pb.js",
);
const { TaskIdSchema, TaskListIdSchema } = await load(
  "examples/todo/dist/generated/spine/examples/todo/task_id_pb.js",
);
const registry = JSON.parse(await readFile(new URL("databases.json", import.meta.url), "utf8"));
const timer = setTimeout(() => {
  process.stderr.write("External Event repair probe exceeded 90 seconds.\n");
  process.exit(1);
}, 90_000);
try {
  for (const record of registry.records) await verify(record);
  process.stdout.write(`${JSON.stringify({ artifacts, status: "PASS" })}\n`);
} finally {
  clearTimeout(timer);
}

async function verify(record) {
  const pg = record.engine === "postgres";
  const module = pg ? "storage-postgres" : "storage-mysql";
  const providerRequire = createRequire(resolve(root, `packages/${module}/package.json`));
  const adapters = await load(`packages/${module}/dist/index.js`);
  const Factory = adapters.PostgresStorageFactory ?? adapters.MysqlStorageFactory;
  const suffix = randomUUID().replaceAll("-", "");
  const tableName = `external_${suffix}`;
  const contextName = `ExternalRepair_${suffix}`;
  const boundary = { name: contextName, multitenant: false };
  const taskId = create(TaskIdSchema, { value: `task-${suffix}` });
  const event = create(EventSchema, {
    id: create(EventIdSchema, { value: `external-${suffix}` }),
    context: create(EventContextSchema, {
      external: true,
      producerId: AnyMessages.pack(TaskIdSchema, taskId),
      version: create(VersionSchema, { number: 1 }),
      origin: { case: "importContext", value: create(ActorContextSchema) },
    }),
    message: AnyMessages.pack(
      TaskCreatedSchema,
      create(TaskCreatedSchema, {
        id: taskId,
        title: "Externally created task",
        taskListId: create(TaskListIdSchema, { value: `list-${suffix}` }),
      }),
    ),
  });
  const original = toBinary(EventSchema, event);
  const observed = [];
  const contexts = [];
  const factories = [];
  const stores = [];
  let failing = true;
  const driver = pg
    ? new (providerRequire("pg").Client)({ connectionString: record.urls.spine_test })
    : await providerRequire("mysql2/promise").createConnection(record.urls.spine_test);
  if (pg) await driver.connect();
  try {
    const first = await open();
    await assert.rejects(first.context.eventBus().post(event), /injected external recipient fault/);
    assert.deepEqual(
      observed.map(({ recipient }) => recipient),
      ["first", "second"],
    );
    assert.deepEqual(toBinary(EventSchema, (await first.store.read())[0]), original);
    await first.context.close();
    failing = false;
    const recreated = await open();
    const outcome = await recreated.context.republishEvents({ eventIds: [event.id.value] });
    assert.deepEqual(outcome, [{ eventId: event.id.value, status: "ADMITTED", attempts: 1 }]);
    assert.deepEqual(
      observed.map(({ recipient }) => recipient),
      ["first", "second", "first", "second"],
    );
    const stored = await recreated.store.read();
    assert.equal(stored.length, 1);
    assert.deepEqual(toBinary(EventSchema, stored[0]), original);
    assert.ok(observed.every(({ id }) => id === event.id.value));
    process.stdout.write(
      `${JSON.stringify({
        provider: record.name,
        version: record.serverVersion,
        pid: process.pid,
        node: process.version,
        table: tableName,
        contextName,
        eventId: event.id.value,
        eventSha256: createHash("sha256").update(original).digest("hex"),
        observed,
        outcome,
        recreatedContext: true,
        osProcessRestart: false,
        recipientInboxDeduplication: false,
        commandPosts: 0,
        status: "PASS",
      })}\n`,
    );
  } finally {
    const closures = await Promise.allSettled(contexts.map((context) => context.close()));
    for (const result of closures) {
      if (result.status !== "rejected") continue;
      process.stderr.write(`Context cleanup failed: ${String(result.reason)}\n`);
      process.exitCode = 1;
    }
    for (const store of stores) store.close();
    for (const factory of factories) factory.close();
    try {
      await driver.query(`DROP TABLE IF EXISTS ${pg ? `"${tableName}"` : `\`${tableName}\``}`);
    } finally {
      await driver.end();
    }
  }

  async function open() {
    const factory = await Factory.newBuilder()
      .setOptions({ url: record.urls.spine_test })
      .setTableName(EventSchema, tableName)
      .build();
    factories.push(factory);
    const store = new EventStore(boundary, factory);
    stores.push(store);
    const builder = BoundedContext.singleTenant(contextName).withStorageFactory(factory);
    for (const recipient of ["first", "second"])
      builder.addEventDispatcher({
        messageSchemas: () => [TaskCreatedSchema],
        externalEventSchemas: () => [TaskCreatedSchema],
        dispatch: async (received) => {
          // Verify append-before-delivery through a fresh real provider read.
          const saved = (await store.read()).find(
            (candidate) => candidate.id?.value === received.id?.value,
          );
          assert.ok(saved, "The original Event must be saved before recipient dispatch.");
          assert.deepEqual(toBinary(EventSchema, saved), original);
          assert.deepEqual(toBinary(EventSchema, received), original);
          observed.push({ recipient, id: received.id.value, pid: process.pid });
          if (recipient === "second" && failing)
            throw new Error("injected external recipient fault");
        },
      });
    const context = builder.build();
    contexts.push(context);
    return { context, store };
  }
}
