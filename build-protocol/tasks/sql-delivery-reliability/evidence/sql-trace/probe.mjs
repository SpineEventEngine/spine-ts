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
import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";
import { setInterval } from "node:timers";

const mode = process.argv[2];
if (!["success", "failure", "timeout"].includes(mode)) throw new Error("Unknown probe mode.");
if (process.env.SPINE_TS_POSTGRESQL_URL) {
  const require = createRequire(resolve("packages/storage-postgres/package.json"));
  const { Client } = require("pg");
  const client = new Client({ connectionString: process.env.SPINE_TS_POSTGRESQL_URL });
  await client.connect();
  await client.query("SELECT 'sqlrel_trace_wrapper_probe' AS marker");
  await client.end();
} else {
  const require = createRequire(resolve("packages/storage-mysql/package.json"));
  const mysql = require("mysql2/promise");
  const client = await mysql.createConnection(process.env.SPINE_TS_MYSQL_URL);
  await client.query("SELECT 'sqlrel_trace_wrapper_probe' AS marker");
  await client.end();
}
process.stdout.write(`Probe ${mode} queried successfully; pid=${process.pid}.\n`);
if (mode === "failure") process.exitCode = 7;
if (mode === "timeout") {
  process.on("SIGTERM", () =>
    process.stdout.write("Probe received SIGTERM; awaiting escalation.\n"),
  );
  setInterval(() => {}, 1_000);
}
