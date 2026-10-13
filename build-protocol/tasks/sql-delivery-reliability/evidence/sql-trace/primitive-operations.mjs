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
assert.equal(process.cwd(), root.replace(/\/$/, ""), "Run in the isolated worktree root.");
const operation = process.argv[2];
const allowed = [
  "record-read",
  "record-write",
  "record-delete",
  "record-query",
  "record-batch",
  "record-cas",
];
assert.ok(allowed.includes(operation), "Select a supported primitive operation.");
const pgUrl = process.env.SPINE_TS_POSTGRESQL_URL;
const mysqlUrl = process.env.SPINE_TS_MYSQL_URL;
assert.ok(Boolean(pgUrl) !== Boolean(mysqlUrl), "Select exactly one SQL provider.");
const provider = pgUrl ? "storage-postgres" : "storage-mysql";
const require = createRequire(resolve(root, "packages", provider, "package.json"));
const { create, ScalarType } = require("@bufbuild/protobuf");
const { StringValueSchema } = require("@bufbuild/protobuf/wkt");
const artifacts = [];
async function built(name) {
  const path = resolve(root, "packages", name, "dist/index.js");
  artifacts.push({
    path,
    sha256: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
  });
  return import(pathToFileURL(path).href);
}
const { StringifierRegistry, TypeRegistry } = await built("core");
const { RecordSpec, RecordColumn, ColumnTypes, StorageGroup } = await built("storage");
const adapters = await built(provider);
const Factory = adapters.PostgresStorageFactory ?? adapters.MysqlStorageFactory;
const stringifiers = new StringifierRegistry();
stringifiers.setTypeRegistry(new TypeRegistry([StringValueSchema]));
const factory = await Factory.newBuilder()
  .setOptions({ url: pgUrl ?? mysqlUrl })
  .setStringifierRegistry(stringifiers)
  .build();
const run = randomUUID().replaceAll("-", "");
const spec = new RecordSpec({
  recordType: StringValueSchema,
  idKind: "string",
  extractId: (record) => record.value.split(":")[0],
  columns: [
    new RecordColumn("value", ColumnTypes.scalar(ScalarType.STRING), (record) => record.value),
  ],
});
const storage = factory.createRecordStorage(
  { name: `sql_trace_${run}`, multitenant: false },
  spec,
  new StorageGroup(`sql_trace_${run}`),
);
const value = (text) => create(StringValueSchema, { value: text });
let marker;
try {
  if (pgUrl) {
    marker = new (require("pg").Client)({ connectionString: pgUrl });
    await marker.connect();
  } else {
    marker = await require("mysql2/promise").createConnection(mysqlUrl);
  }
  await storage.write(value("a:initial"));
  await storage.read("a");
  await marker.query(`SELECT 'spine_trace_begin_${operation.replaceAll("-", "_")}' AS marker`);
  let result;
  switch (operation) {
    case "record-read":
      result = await storage.read("a");
      break;
    case "record-write":
      await storage.write(value("a:updated"));
      break;
    case "record-delete":
      result = await storage.delete("a");
      break;
    case "record-query":
      result = await storage.query({
        filters: [{ column: "value", value: "a:initial" }],
        sort: [{ field: "value" }],
        limit: 1,
      });
      break;
    case "record-batch":
      await storage.writeAll([value("b:first"), value("c:second")]);
      break;
    case "record-cas":
      result = [
        await storage.compareAndSet("a", value("a:initial"), value("a:updated")),
        await storage.compareAndSet("a", value("a:initial"), value("a:unexpected")),
      ];
      break;
  }
  await marker.query(`SELECT 'spine_trace_end_${operation.replaceAll("-", "_")}' AS marker`);
  if (operation === "record-read") assert.deepEqual(result, value("a:initial"));
  if (operation === "record-write") assert.deepEqual(await storage.read("a"), value("a:updated"));
  if (operation === "record-delete") {
    assert.equal(result, true);
    assert.equal(await storage.read("a"), undefined);
  }
  if (operation === "record-query") assert.deepEqual(result, [value("a:initial")]);
  if (operation === "record-batch") {
    assert.deepEqual(await storage.read("b"), value("b:first"));
    assert.deepEqual(await storage.read("c"), value("c:second"));
  }
  if (operation === "record-cas") {
    assert.deepEqual(result, [true, false]);
    assert.deepEqual(await storage.read("a"), value("a:updated"));
  }
  process.stdout.write(
    `${JSON.stringify({ operation, provider, run, artifacts, verified: true })}\n`,
  );
} finally {
  storage.close();
  factory.close();
  if (marker) await marker.end();
}
