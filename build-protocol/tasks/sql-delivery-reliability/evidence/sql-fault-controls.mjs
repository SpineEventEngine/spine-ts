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
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const root = new URL("../../../../", import.meta.url);
const pg = createRequire(new URL("packages/storage-postgres/package.json", root))("pg");
const mysql = createRequire(new URL("packages/storage-mysql/package.json", root))("mysql2/promise");
const registry = JSON.parse(await readFile(new URL("databases.json", import.meta.url), "utf8"));

for (const provider of registry.records) await verify(provider);

async function verify(provider) {
  const postgres = provider.engine === "postgres";
  const database = `sqlrel_fault_${randomUUID().replaceAll("-", "")}`;
  const quoted = postgres ? `"${database}"` : `\`${database}\``;
  const admin = await connect(provider.urls.spine_test, postgres);
  let client;
  let created = false;
  let result;
  try {
    await admin.query(`CREATE DATABASE ${quoted}`);
    created = true;
    const url = new URL(provider.urls.spine_test);
    url.pathname = `/${database}`;
    client = await connect(url.href, postgres);
    await prepare(client, postgres);
    const errors = [];
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await client.query(`INSERT INTO control_data(id) VALUES (${attempt})`);
        assert.ok(attempt > 2, "Fault budget was not enforced.");
      } catch (error) {
        assert.ok(attempt <= 2, "Fault counter did not survive failed statement.");
        assert.equal(error.code, postgres ? "40P01" : "ER_LOCK_DEADLOCK");
        errors.push({ attempt, code: error.code, sqlState: error.sqlState });
      }
    }
    const rows = await readRows(client, "SELECT id FROM control_data ORDER BY id", postgres);
    assert.deepEqual(
      rows.map((row) => row.id),
      [3, 4],
    );
    const counterSql = postgres
      ? "SELECT last_value AS attempts FROM control_attempts"
      : "SELECT attempts FROM control_attempts";
    const counters = await readRows(client, counterSql, postgres);
    assert.equal(Number(counters[0].attempts), 4);
    result = { provider: provider.name, database, errors, attempts: 4, successfulIds: [3, 4] };
  } finally {
    try {
      if (client !== undefined) await client.end();
      if (created) await admin.query(`DROP DATABASE ${quoted}`);
    } finally {
      await admin.end();
    }
  }
  process.stdout.write(
    `${JSON.stringify({ status: "PASS", ...result, cleanup: "complete", script: fileURLToPath(import.meta.url) })}\n`,
  );
}

async function connect(url, postgres) {
  if (!postgres) return mysql.createConnection(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

async function readRows(client, sql, postgres) {
  const result = await client.query(sql);
  return postgres ? result.rows : result[0];
}

async function prepare(client, postgres) {
  if (postgres) {
    await client.query("CREATE TABLE control_data(id integer PRIMARY KEY)");
    await client.query("CREATE SEQUENCE control_attempts");
    await client.query(`CREATE FUNCTION fail_first_two() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF nextval('control_attempts') <= 2 THEN
          RAISE EXCEPTION USING ERRCODE = '40P01', MESSAGE = 'task injected deadlock';
        END IF;
        RETURN NEW;
      END $$`);
    await client.query(
      "CREATE TRIGGER control_failure BEFORE INSERT ON control_data FOR EACH ROW EXECUTE FUNCTION fail_first_two()",
    );
    return;
  }
  await client.query("CREATE TABLE control_data(id integer PRIMARY KEY) ENGINE=InnoDB");
  await client.query(
    "CREATE TABLE control_attempts(id integer PRIMARY KEY, attempts integer NOT NULL) ENGINE=MyISAM",
  );
  await client.query("INSERT INTO control_attempts VALUES (1, 0)");
  await client.query(`CREATE TRIGGER control_failure BEFORE INSERT ON control_data FOR EACH ROW
    BEGIN
      UPDATE control_attempts SET attempts = attempts + 1 WHERE id = 1;
      IF (SELECT attempts FROM control_attempts WHERE id = 1) <= 2 THEN
        SIGNAL SQLSTATE '40001' SET MYSQL_ERRNO = 1213, MESSAGE_TEXT = 'task injected deadlock';
      END IF;
    END`);
}
