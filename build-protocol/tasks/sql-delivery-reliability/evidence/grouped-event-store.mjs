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
const { create, clone, toBinary } = require("@bufbuild/protobuf");
const { EventStore, InMemoryStorageFactory, StorageGroup } = await load(
  "packages/storage/dist/index.js",
);
const { AnyMessages, TypeUrls } = await load("packages/core/dist/index.js");
const {
  ActorContextSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  MessageIdSchema,
  VersionSchema,
} = await load("packages/proto/dist/src/index.js");
const { EntityCreatedSchema } = await load(
  "packages/proto/dist/generated/spine/system/server/entity_log_events_pb.js",
);
const { EntityOption_Kind } = await load("packages/proto/dist/generated/spine/options_pb.js");
const { TaskSchema } = await load("examples/todo/dist/generated/spine/examples/todo/tasks_pb.js");
const { TaskCreatedSchema } = await load(
  "examples/todo/dist/generated/spine/examples/todo/task_events_pb.js",
);
const { TaskIdSchema, TaskListIdSchema } = await load(
  "examples/todo/dist/generated/spine/examples/todo/task_id_pb.js",
);
const registry = JSON.parse(await readFile(new URL("databases.json", import.meta.url), "utf8"));
const group = new StorageGroup("spine_system_events");
const timer = setTimeout(() => {
  process.stderr.write("Grouped Event store probe exceeded 120 seconds.\n");
  process.exit(1);
}, 120_000);
try {
  const memory = new InMemoryStorageFactory();
  try {
    await exercise(memory, "memory", "default");
  } finally {
    memory.close();
  }
  for (const record of registry.records) await verifySql(record);
  process.stdout.write(`${JSON.stringify({ artifacts, status: "PASS" })}\n`);
} finally {
  clearTimeout(timer);
}

async function verifySql(record) {
  const pg = record.engine === "postgres";
  const module = pg ? "storage-postgres" : "storage-mysql";
  const providerRequire = createRequire(resolve(root, `packages/${module}/package.json`));
  const adapters = await load(`packages/${module}/dist/index.js`);
  const Factory = adapters.PostgresStorageFactory ?? adapters.MysqlStorageFactory;
  const admin = pg
    ? new (providerRequire("pg").Client)({ connectionString: record.urls.spine_test })
    : await providerRequire("mysql2/promise").createConnection(record.urls.spine_test);
  if (pg) await admin.connect();
  try {
    for (const mode of ["default", "ungrouped-override", "both-overrides"]) {
      const database = `sqlrel_group_${randomUUID().replaceAll("-", "")}`;
      const quoted = pg ? `"${database}"` : `\`${database}\``;
      await admin.query(`CREATE DATABASE ${quoted}`);
      const url = new URL(record.urls.spine_test);
      url.pathname = `/${database}`;
      let factory;
      try {
        const builder = Factory.newBuilder().setOptions({ url: url.href });
        if (mode !== "default") builder.setTableName(EventSchema, "custom_domain_events");
        if (mode === "both-overrides")
          builder.setTableName(EventSchema, EventSchema, "custom_system_events");
        factory = await builder.build();
        await exercise(factory, record.name, mode);
        process.stdout.write(
          `${JSON.stringify({ provider: record.name, database, version: record.serverVersion, mode, status: "PASS" })}\n`,
        );
      } finally {
        if (factory) factory.close();
        await admin.query(`DROP DATABASE ${quoted}`);
      }
    }
  } finally {
    await admin.end();
  }
}

async function exercise(factory, provider, mode) {
  const boundary = { name: `GroupedEvents_${randomUUID()}`, multitenant: false };
  const domain = new EventStore(boundary, factory);
  const system = new EventStore(boundary, factory, group);
  const id = `shared-${randomUUID()}`;
  const domainEvent = envelope(id, false);
  const systemEvent = envelope(id, true);
  const extra = envelope(`system-only-${randomUUID()}`, true);
  let accepted = 0;
  try {
    await domain.append(domainEvent);
    assert.deepEqual(await system.read({ ids: [domainEvent.id] }), []);
    await system.accept(domainEvent);
    await system.append(systemEvent);
    await domain.append(clone(EventSchema, domainEvent));
    await system.appendAll([clone(EventSchema, systemEvent), extra]);
    await assert.rejects(domain.append(systemEvent), /unique event IDs/);
    await assert.rejects(system.append(domainEvent), /unique event IDs/);
    await assert.rejects(domain.accept(domainEvent), /unique event IDs/);
    await assert.rejects(system.accept(systemEvent), /unique event IDs/);
    await assert.rejects(
      system.acceptThenAppend(systemEvent, () => {
        accepted++;
      }),
    );
    assert.equal(accepted, 0, "A duplicate must reject before acceptance callback.");
    const strict = envelope(`strict-${randomUUID()}`, true);
    await system.acceptThenAppend(strict, () => {
      accepted++;
    });
    assert.equal(accepted, 1);
    assert.deepEqual(await domain.read({ ids: [extra.id, strict.id] }), []);
    assert.deepEqual(
      toBinary(EventSchema, (await domain.read({ ids: [domainEvent.id] }))[0]),
      toBinary(EventSchema, domainEvent),
    );
    assert.deepEqual(
      toBinary(EventSchema, (await system.read({ ids: [systemEvent.id] }))[0]),
      toBinary(EventSchema, systemEvent),
    );
    assert.equal((await domain.read()).length, 1);
    assert.equal((await system.read()).length, 3);
    process.stdout.write(
      `${JSON.stringify({ provider, mode, pid: process.pid, sameIdSeparateFamilies: true, immutableRetries: true, conflictingPayloadsRejected: true, strictDuplicateRejected: true, groupedOnlyInvisibleToDomain: true, actualAcceptanceCalls: accepted, status: "PASS" })}\n`,
    );
  } finally {
    domain.close();
    system.close();
  }
}

function envelope(id, system) {
  const taskId = create(TaskIdSchema, { value: `task-${id}` });
  const payload = system
    ? AnyMessages.pack(
        EntityCreatedSchema,
        create(EntityCreatedSchema, {
          entity: create(MessageIdSchema, {
            id: AnyMessages.pack(TaskIdSchema, taskId),
            typeUrl: TypeUrls.derive(TaskSchema),
          }),
          kind: EntityOption_Kind.AGGREGATE,
        }),
      )
    : AnyMessages.pack(
        TaskCreatedSchema,
        create(TaskCreatedSchema, {
          id: taskId,
          title: "Grouped storage verification",
          taskListId: create(TaskListIdSchema, { value: `list-${id}` }),
        }),
      );
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      producerId: AnyMessages.pack(TaskIdSchema, taskId),
      version: create(VersionSchema, { number: 1 }),
      origin: { case: "importContext", value: create(ActorContextSchema) },
    }),
    message: payload,
  });
}
