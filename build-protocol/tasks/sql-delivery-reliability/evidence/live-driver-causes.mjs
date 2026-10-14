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
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
assert.equal(process.cwd(), root.replace(/\/$/, ""));
const load = (path) => import(pathToFileURL(resolve(root, path)).href);
const { RecordSpec } = await load("packages/storage/dist/index.js");
const registry = JSON.parse(await readFile(new URL("databases.json", import.meta.url), "utf8"));
const timer = setTimeout(() => {
  process.stderr.write("Driver cause probe exceeded 60 seconds.\n");
  process.exit(1);
}, 60000);
try {
  for (const record of registry.records) await verify(record);
} finally {
  clearTimeout(timer);
}
async function verify(record) {
  const pg = record.engine === "postgres";
  const module = pg ? "storage-postgres" : "storage-mysql";
  const require = createRequire(resolve(root, `packages/${module}/package.json`));
  const { create } = require("@bufbuild/protobuf");
  const { StringValueSchema } = require("@bufbuild/protobuf/wkt");
  const spec = new RecordSpec({
    recordType: StringValueSchema,
    idKind: "string",
    extractId: (record) => record.value,
  });
  const name = `cause_${randomUUID().replaceAll("-", "")}`;
  const trigger = `${name}_trigger`;
  const fn = `${name}_fn`;
  const marker = `private_driver_detail_${name}`;
  const adapters = await load(`packages/${module}/dist/index.js`);
  const Factory = adapters.PostgresStorageFactory ?? adapters.MysqlStorageFactory;
  const factory = await Factory.newBuilder()
    .setOptions({ url: record.urls.spine_test })
    .setTableName(spec.sourceType, name)
    .build();
  const storage = factory.createRecordStorage({ name, multitenant: false }, spec);
  const driver = pg
    ? new (require("pg").Client)({ connectionString: record.urls.spine_test })
    : await require("mysql2/promise").createConnection(record.urls.spine_test);
  if (pg) await driver.connect();
  const table = pg ? `"${name}"` : `\`${name}\``;
  const value = (text) => create(StringValueSchema, { value: text });
  async function removeFault() {
    if (pg) {
      await driver.query(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}`);
      await driver.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    } else await driver.query(`DROP TRIGGER IF EXISTS \`${trigger}\``);
  }
  let setup = false;
  try {
    await storage.write(value("warm"));
    setup = true;
    if (pg) {
      await driver.query(
        `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '${marker}' USING ERRCODE = 'P0001'; END; $$`,
      );
      await driver.query(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
      );
    } else
      await driver.query(
        `CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON ${table} FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${marker}', MYSQL_ERRNO = 1644`,
      );
    let caught;
    try {
      await storage.write(value("failed"));
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof Error, "Provider write must fail.");
    assert.ok(
      caught.cause instanceof Error,
      "Original driver failure must remain an internal cause.",
    );
    assert.ok(caught.cause.message.includes(marker), "Cause retains original diagnostic text.");
    assert.equal(caught.message.includes(marker), false, "Outer provider message remains stable.");
    assert.equal(caught.cause.code, pg ? "P0001" : "ER_SIGNAL_EXCEPTION");
    if (!pg) assert.equal(caught.cause.errno, 1644);
    assert.equal(await storage.read("failed"), undefined);
    await removeFault();
    await storage.write(value("failed"));
    assert.deepEqual(await storage.read("failed"), value("failed"));
    process.stdout.write(
      `${JSON.stringify({ provider: record.name, version: record.serverVersion, pid: process.pid, node: process.version, table: name, errorType: caught.name, outerMessage: caught.message, causeType: caught.cause.name, driverCode: caught.cause.code, originalDiagnosticRetained: true, outerDiagnosticOmitted: true, retryAfterFaultRemoval: "PASS", status: "PASS" })}\n`,
    );
  } finally {
    try {
      if (setup) {
        await removeFault();
        await driver.query(`DROP TABLE IF EXISTS ${table}`);
      }
    } finally {
      storage.close();
      factory.close();
      await driver.end();
    }
  }
}
