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
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
assert.equal(process.cwd(), root.replace(/\/$/, ""));
const operation = process.argv[2];
assert.ok(["entity-commit", "history-append-read", "history-maintenance"].includes(operation));
const pgUrl = process.env.SPINE_TS_POSTGRESQL_URL;
const mysqlUrl = process.env.SPINE_TS_MYSQL_URL;
assert.ok(Boolean(pgUrl) !== Boolean(mysqlUrl), "Select exactly one provider.");
const provider = pgUrl ? "storage-postgres" : "storage-mysql";
const require = createRequire(resolve(root, "packages", provider, "package.json"));
const { create, fromBinary, toBinary } = require("@bufbuild/protobuf");
const { TimestampSchema } = require("@bufbuild/protobuf/wkt");
const artifacts = [];
async function built(relative) {
  const path = resolve(root, relative);
  artifacts.push({
    path,
    sha256: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
  });
  return import(pathToFileURL(path).href);
}
const { StringifierRegistry, TypeRegistry, Identifiers, AnyMessages } = await built(
  "packages/core/dist/index.js",
);
const { RecordSpec, EventStore } = await built("packages/storage/dist/index.js");
const { EntityCommitStorageFactories } = await built("packages/storage/dist/provider.js");
const { EventSchema, EventIdSchema, VersionSchema } = await built(
  "packages/proto/dist/src/index.js",
);
const { EntityRecordSchema } = await built(
  "packages/proto/dist/generated/spine/server/entity/entity_pb.js",
);
const { TaskIdSchema, TaskListIdSchema } = await built(
  "examples/todo/dist/generated/spine/examples/todo/task_id_pb.js",
);
const { TaskCreatedSchema } = await built(
  "examples/todo/dist/generated/spine/examples/todo/task_events_pb.js",
);
const { TaskSchema } = await built("examples/todo/dist/generated/spine/examples/todo/tasks_pb.js");
const adapters = await built(`packages/${provider}/dist/index.js`);
const Factory = adapters.PostgresStorageFactory ?? adapters.MysqlStorageFactory;
const run = randomUUID().replaceAll("-", "");
const prefix = `trace_${run}`;
const stringifiers = new StringifierRegistry();
stringifiers.setTypeRegistry(
  new TypeRegistry([TaskIdSchema, TaskListIdSchema, TaskSchema, TaskCreatedSchema]),
);
const factory = await Factory.newBuilder()
  .setOptions({ url: pgUrl ?? mysqlUrl })
  .setStringifierRegistry(stringifiers)
  .setTableName(TaskSchema, `${prefix}_current`)
  .setTableName(TaskSchema, EntityRecordSchema, `${prefix}_states`)
  .setTableName(EventSchema, EventSchema, `${prefix}_diagnostics`)
  .setTableName(EventSchema, `${prefix}_events`)
  .build();
const context = { name: prefix, multitenant: false };
const id = `${run}_task`;
const taskId = create(TaskIdSchema, { value: id });
const listId = create(TaskListIdSchema, { value: `${run}_list` });
const packedId = Identifiers.pack(TaskIdSchema, taskId);
const time = (seconds) => create(TimestampSchema, { seconds: BigInt(seconds) });
const state = (version) =>
  create(TaskSchema, { id: taskId, title: `Task ${version}`, taskListId: listId });
const record = (version) =>
  create(EntityRecordSchema, {
    entityId: packedId,
    state: AnyMessages.pack(TaskSchema, state(version)),
    lifecycleFlags: { archived: false, deleted: false },
    version: create(VersionSchema, { number: version, timestamp: time(version) }),
  });
const event = (suffix, version) =>
  create(EventSchema, {
    id: create(EventIdSchema, { value: `${run}_${suffix}_${version}` }),
    context: {
      producerId: packedId,
      timestamp: time(version),
      version: create(VersionSchema, { number: version, timestamp: time(version) }),
    },
    message: AnyMessages.pack(
      TaskCreatedSchema,
      create(TaskCreatedSchema, { id: taskId, title: `Task ${version}`, taskListId: listId }),
    ),
  });
const input = {
  context,
  id: {
    clone: (value) => value,
    key: (value) => value,
    pack: (value) => Identifiers.pack(TaskIdSchema, create(TaskIdSchema, { value })),
    unpack: (packed) =>
      packed.typeUrl.endsWith(`/${TaskIdSchema.typeName}`)
        ? fromBinary(TaskIdSchema, packed.value).value
        : undefined,
  },
  columns: [],
  recordSpec: new RecordSpec({
    sourceType: TaskSchema,
    recordType: EntityRecordSchema,
    idKind: "string",
    extractId: (value) => fromBinary(TaskIdSchema, value.entityId.value).value,
  }),
  sourceType: TaskSchema,
  stateSchema: TaskSchema,
  stateHistory: true,
  eventHistory: true,
};
const commits = EntityCommitStorageFactories.create(factory, input);
// Same structural provider test seam used by the existing SQL integration tests.
const entity = factory.createEntityStorage(input);
const events = new EventStore(context, factory);
const mutation = (version) => ({
  context,
  entity: input,
  entityId: id,
  next: record(version),
  states: [record(version)],
  diagnostics: [event("diagnostic", version)],
  events: [event("delivery", version)],
});
let marker;
try {
  if (pgUrl) {
    marker = new (require("pg").Client)({ connectionString: pgUrl });
    await marker.connect();
  } else marker = await require("mysql2/promise").createConnection(mysqlUrl);
  await commits.commit(mutation(1));
  await entity.current.read(id);
  await entity.states.backward(id, 10);
  await entity.events.backward(id, 10);
  if (operation === "history-maintenance") {
    await entity.states.append(record(2));
    await entity.states.append(record(3));
    await entity.events.append(event("diagnostic", 2));
  }
  await marker.query(`SELECT 'spine_trace_begin_${operation.replaceAll("-", "_")}' AS marker`);
  if (operation === "entity-commit") await commits.commit(mutation(2));
  if (operation === "history-append-read") {
    await entity.states.append(record(2));
    await entity.events.append(event("diagnostic", 2));
    assert.equal((await entity.states.backward(id, 10)).length, 2);
    assert.equal((await entity.events.backward(id, 10)).length, 2);
    assert.deepEqual(await entity.states.stateAt(id, time(2)), state(2));
  }
  if (operation === "history-maintenance") {
    await entity.states.trim(id, 1);
    await entity.states.truncate(time(4));
    await entity.events.truncate(time(4));
  }
  await marker.query(`SELECT 'spine_trace_end_${operation.replaceAll("-", "_")}' AS marker`);
  if (operation === "entity-commit") {
    assert.deepEqual(
      toBinary(EntityRecordSchema, await entity.current.read(id)),
      toBinary(EntityRecordSchema, record(2)),
    );
    assert.equal((await entity.states.backward(id, 10)).length, 2);
    assert.equal((await entity.events.backward(id, 10)).length, 2);
    const saved = await events.read({ ids: [event("delivery", 2).id] });
    assert.equal(saved.length, 1);
    assert.deepEqual(toBinary(EventSchema, saved[0]), toBinary(EventSchema, event("delivery", 2)));
  }
  if (operation === "history-maintenance") {
    assert.deepEqual(await entity.states.backward(id, 10), []);
    assert.deepEqual(await entity.events.backward(id, 10), []);
    assert.deepEqual(
      toBinary(EntityRecordSchema, await entity.current.read(id)),
      toBinary(EntityRecordSchema, record(1)),
    );
  }
  process.stdout.write(
    `${JSON.stringify({ operation, provider, run, tablePrefix: prefix, artifacts, verified: true })}\n`,
  );
} finally {
  commits.close();
  entity.close();
  events.close();
  factory.close();
  if (marker) await marker.end();
}
