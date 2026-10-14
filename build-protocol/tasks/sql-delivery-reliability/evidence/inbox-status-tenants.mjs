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
const root = fileURLToPath(new URL("../../../../", import.meta.url));
assert.equal(process.cwd(), root.replace(/\/$/, ""));
const require = createRequire(resolve(root, "packages/server/package.json"));
const { create } = require("@bufbuild/protobuf");
const { TimestampSchema } = require("@bufbuild/protobuf/wkt");
const load = (path) => import(pathToFileURL(resolve(root, path)).href);
const { AnyMessages, StringifierRegistry, TypeRegistry, TypeUrls } = await load(
  "packages/core/dist/index.js",
);
const { EventIdSchema, EventSchema, TenantIdSchema } = await load(
  "packages/proto/dist/src/index.js",
);
const { InboxStorage } = await load("packages/server/dist/delivery/inbox-storage.js");
const { InboxRecords, inboxRecordSpec } = await load(
  "packages/server/dist/delivery/inbox-records.js",
);
const { ShardIndex } = await load("packages/server/dist/delivery/shard-index.js");
const { TaskCreatedSchema } = await load(
  "examples/todo/dist/generated/spine/examples/todo/task_events_pb.js",
);
const { TaskIdSchema, TaskListIdSchema } = await load(
  "examples/todo/dist/generated/spine/examples/todo/task_id_pb.js",
);
const { TaskListSchema } = await load(
  "examples/todo/dist/generated/spine/examples/todo/task_list_pb.js",
);
const statuses = ["TO_DELIVER", "SCHEDULED", "DELIVERED", "TO_CATCH_UP"];
const registry = JSON.parse(await readFile(new URL("databases.json", import.meta.url), "utf8"));
const run = randomUUID().replaceAll("-", "");
const shard = new ShardIndex(0, 8);
const tenants = ["a", "b"].map((value) =>
  create(TenantIdSchema, { kind: { case: "value", value } }),
);
function message(index, tenantIndex) {
  const taskListId = create(TaskListIdSchema, { value: `list-${tenantIndex}` });
  const eventId = create(EventIdSchema, { value: `event-${index}` });
  const event = create(EventSchema, {
    id: eventId,
    message: AnyMessages.pack(
      TaskCreatedSchema,
      create(TaskCreatedSchema, {
        id: create(TaskIdSchema, { value: `task-${index}` }),
        taskListId,
        title: `Tenant ${tenantIndex} task ${index}`,
      }),
    ),
  });
  return {
    id: { value: `status-${String(index).padStart(2, "0")}`, shard },
    inboxId: {
      targetId: AnyMessages.pack(TaskListIdSchema, taskListId),
      targetTypeUrl: TypeUrls.derive(TaskListSchema),
    },
    tenantId: tenants[tenantIndex],
    signalId: eventId.value,
    signal: AnyMessages.pack(EventSchema, event, { validate: false }),
    label: "UPDATE_SUBSCRIBER",
    status: statuses[(index + tenantIndex) % statuses.length],
    shard,
    whenReceived: create(TimestampSchema, { seconds: 1782979200n + BigInt(Math.floor(index / 4)) }),
    version: BigInt((Math.floor(index / 2) % 2) + 1),
  };
}
const ids = (rows) => rows.map((row) => row.id.value);
async function verify(record) {
  const stringifiers = new StringifierRegistry();
  stringifiers.setTypeRegistry(new TypeRegistry([TaskListIdSchema]));
  const contextName = `status_${run}`;
  let factory;
  if (record.engine === "memory") {
    const { InMemoryStorageFactory } = await load("packages/storage/dist/index.js");
    factory = new InMemoryStorageFactory();
  } else {
    const module = record.engine === "postgres" ? "storage-postgres" : "storage-mysql";
    const adapters = await load(`packages/${module}/dist/index.js`);
    const Factory = adapters.PostgresStorageFactory ?? adapters.MysqlStorageFactory;
    factory = await Factory.newBuilder()
      .setTenantOptions(
        tenants.map((tenantId, index) => ({
          tenantId,
          options: { url: record.urls[index === 0 ? "spine_tenant_a" : "spine_tenant_b"] },
        })),
      )
      .setStringifierRegistry(stringifiers)
      .setTableName(inboxRecordSpec.sourceType, contextName)
      .build();
  }
  const allMessages = tenants.map((_, i) => Array.from({ length: 12 }, (_, j) => message(j, i)));
  let assertions = 0;
  try {
    for (let t = 0; t < 2; t++) {
      const context = { name: contextName, multitenant: true, tenantId: tenants[t] };
      const inbox = new InboxStorage({ context, storageFactory: factory });
      assert.deepEqual(await inbox.read(shard), []);
      assertions++;
      for (const row of [...allMessages[t]].reverse()) await inbox.write(row);
    }
    for (let t = 0; t < 2; t++) {
      const context = { name: contextName, multitenant: true, tenantId: tenants[t] };
      const inbox = new InboxStorage({ context, storageFactory: factory });
      const rows = allMessages[t];
      assert.deepEqual(ids(await inbox.read(shard)), ids(rows));
      assertions++;
      for (let mask = 0; mask < 16; mask++) {
        const selected = statuses.filter((_, i) => mask & (1 << i));
        const expected = rows.filter((row) => selected.includes(row.status));
        const actual = await inbox.read(shard, { statuses: selected });
        assert.deepEqual(ids(actual), ids(expected));
        assertions++;
        for (const row of actual) {
          const target = AnyMessages.unpack(row.inboxId.targetId, TaskListIdSchema);
          assert.equal(target.value, `list-${t}`);
          assertions++;
        }
        assert.deepEqual(
          ids(
            await inbox.read(shard, { statuses: [...selected, ...selected], offset: 1, limit: 2 }),
          ),
          ids(expected.slice(1, 3)),
        );
        assertions++;
      }
      for (const invalid of ["INVALID", "toString", "constructor", "__proto__"]) {
        await assert.rejects(inbox.read(shard, { statuses: [invalid] }), /status/i);
        assertions++;
      }
      const first = rows[0];
      const records = factory.createRecordStorage(context, inboxRecordSpec);
      try {
        await records.delete(inboxRecordSpec.idValueIn(InboxRecords.write(first)));
      } finally {
        records.close();
      }
      const after = {
        messageId: first.id.value,
        whenReceived: first.whenReceived,
        version: first.version,
      };
      assert.deepEqual(
        ids(await inbox.read(shard, { statuses, after, limit: 3 })),
        ids(rows.slice(1, 4)),
      );
      assertions++;
      const other = new InboxStorage({
        context: { ...context, tenantId: tenants[1 - t] },
        storageFactory: factory,
      });
      if (t === 0) {
        assert.equal((await other.readMessage(first.id))?.id.value, first.id.value);
        assertions++;
      }
    }
    return {
      provider: record.name,
      version: record.serverVersion ?? "memory",
      assertions,
      status: "PASS",
    };
  } finally {
    for (let t = 0; t < 2; t++) {
      const context = { name: contextName, multitenant: true, tenantId: tenants[t] };
      const records = factory.createRecordStorage(context, inboxRecordSpec);
      try {
        for (const row of allMessages[t])
          await records.delete(inboxRecordSpec.idValueIn(InboxRecords.write(row)));
      } finally {
        records.close();
      }
    }
    factory.close();
  }
}
const results = [];
for (const record of [{ name: "memory", engine: "memory" }, ...registry.records]) {
  const result = await verify(record);
  results.push(result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
const paths = [
  "packages/server/dist/delivery/inbox-storage.js",
  "packages/storage-postgres/dist/index.js",
  "packages/storage-mysql/dist/index.js",
];
const artifacts = await Promise.all(
  paths.map(async (path) => ({
    path: resolve(root, path),
    sha256: createHash("sha256")
      .update(await readFile(resolve(root, path)))
      .digest("hex"),
  })),
);
process.stdout.write(
  `${JSON.stringify({ run, pid: process.pid, node: process.version, artifacts, results })}\n`,
);
