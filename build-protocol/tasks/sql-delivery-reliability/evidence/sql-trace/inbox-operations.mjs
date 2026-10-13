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
assert.ok(["inbox-ack", "delivered-cleanup"].includes(operation));
const pgUrl = process.env.SPINE_TS_POSTGRESQL_URL;
const mysqlUrl = process.env.SPINE_TS_MYSQL_URL;
assert.ok(Boolean(pgUrl) !== Boolean(mysqlUrl), "Select exactly one provider.");
const provider = pgUrl ? "storage-postgres" : "storage-mysql";
const require = createRequire(resolve(root, "packages", provider, "package.json"));
const { create } = require("@bufbuild/protobuf");
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
const { StringifierRegistry, TypeRegistry, TypeUrls, AnyMessages } = await built(
  "packages/core/dist/index.js",
);
const { EventSchema, EventIdSchema } = await built("packages/proto/dist/src/index.js");
const { TaskIdSchema, TaskListIdSchema } = await built(
  "examples/todo/dist/generated/spine/examples/todo/task_id_pb.js",
);
const { TaskCreatedSchema } = await built(
  "examples/todo/dist/generated/spine/examples/todo/task_events_pb.js",
);
const { TaskListSchema } = await built(
  "examples/todo/dist/generated/spine/examples/todo/task_list_pb.js",
);
const { InboxStorage } = await built("packages/server/dist/delivery/inbox-storage.js");
const { inboxRecordSpec } = await built("packages/server/dist/delivery/inbox-records.js");
const { ShardIndex } = await built("packages/server/dist/delivery/shard-index.js");
const adapters = await built(`packages/${provider}/dist/index.js`);
const Factory = adapters.PostgresStorageFactory ?? adapters.MysqlStorageFactory;
const run = randomUUID().replaceAll("-", "");
const prefix = `trace_${run}`;
const stringifiers = new StringifierRegistry();
stringifiers.setTypeRegistry(
  new TypeRegistry([TaskIdSchema, TaskListIdSchema, TaskListSchema, TaskCreatedSchema]),
);
const factory = await Factory.newBuilder()
  .setOptions({ url: pgUrl ?? mysqlUrl })
  .setStringifierRegistry(stringifiers)
  .setTableName(inboxRecordSpec.sourceType, `${prefix}_inbox`)
  .build();
const context = { name: prefix, multitenant: false };
const inbox = new InboxStorage({
  context,
  storageFactory: factory,
  now: () => new Date("2026-10-13T00:00:00Z"),
});
const shard = ShardIndex.single();
const listId = create(TaskListIdSchema, { value: `${run}_list` });
const taskId = create(TaskIdSchema, { value: `${run}_task` });
const signalId = `${run}_event`;
const event = create(EventSchema, {
  id: create(EventIdSchema, { value: signalId }),
  message: AnyMessages.pack(
    TaskCreatedSchema,
    create(TaskCreatedSchema, { id: taskId, taskListId: listId, title: "Trace task" }),
  ),
});
const message = {
  id: { value: `${run}_inbox`, shard },
  inboxId: {
    targetId: AnyMessages.pack(TaskListIdSchema, listId),
    targetTypeUrl: TypeUrls.derive(TaskListSchema),
  },
  signalId,
  signal: AnyMessages.pack(EventSchema, event, { validate: false }),
  label: "UPDATE_SUBSCRIBER",
  status: operation === "inbox-ack" ? "TO_DELIVER" : "DELIVERED",
  shard,
  whenReceived: create(TimestampSchema, { seconds: 1n }),
  version: 1n,
};
let marker;
try {
  if (pgUrl) {
    marker = new (require("pg").Client)({ connectionString: pgUrl });
    await marker.connect();
  } else marker = await require("mysql2/promise").createConnection(mysqlUrl);
  assert.equal((await inbox.write(message)).outcome, "WRITTEN");
  const existing = await inbox.readMessage(message.id);
  assert.equal(existing.status, message.status);
  await marker.query(`SELECT 'spine_trace_begin_${operation.replaceAll("-", "_")}' AS marker`);
  const result =
    operation === "inbox-ack"
      ? await inbox.markDelivered(existing)
      : await inbox.removeDelivered(existing);
  await marker.query(`SELECT 'spine_trace_end_${operation.replaceAll("-", "_")}' AS marker`);
  if (operation === "inbox-ack") {
    assert.equal(result.status, "DELIVERED");
    assert.equal((await inbox.readMessage(message.id)).status, "DELIVERED");
  } else {
    assert.equal(result, true);
    assert.equal(await inbox.readMessage(message.id), undefined);
  }
  process.stdout.write(
    `${JSON.stringify({ operation, provider, run, tablePrefix: prefix, artifacts, verified: true })}\n`,
  );
} finally {
  factory.close();
  if (marker) await marker.end();
}
