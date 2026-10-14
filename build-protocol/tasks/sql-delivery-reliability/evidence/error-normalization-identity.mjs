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
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const evidence = dirname(fileURLToPath(import.meta.url));
const root = resolve(evidence, "../../../..");

const pgPath = resolve(root, "packages/storage-postgres/dist/postgres/errors.js");
const mysqlPath = resolve(root, "packages/storage-mysql/dist/mysql/errors.js");
const [pgBytes, mysqlBytes] = await Promise.all([readFile(pgPath), readFile(mysqlPath)]);
const pg = await import(pathToFileURL(pgPath).href);
const mysql = await import(pathToFileURL(mysqlPath).href);
const pgClasses = [
  pg.PostgresStorageConfigurationError,
  pg.PostgresStorageConnectionError,
  pg.PostgresStorageSchemaError,
  pg.PostgresStorageDataError,
  pg.PostgresStorageOperationError,
];
const mysqlClasses = [
  mysql.MysqlStorageSchemaError,
  mysql.MysqlStorageDataError,
  mysql.MysqlStorageOperationError,
];
let assertions = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  assertions += 1;
};
const classified = [];

for (const [index, ErrorType] of pgClasses.entries()) {
  const cause = new Error(`synthetic-private-postgres-${index}`);
  const original = new ErrorType("classified PostgreSQL error", { cause });
  const returned = pg.PostgresStorageErrors.operation(original);
  check(returned === original, `PostgreSQL classified identity ${index}`);
  check(returned.cause === cause, `PostgreSQL classified cause ${index}`);
  classified.push({
    provider: "postgres",
    type: ErrorType.name,
    identity: true,
    causeIdentity: true,
  });
}
for (const [index, ErrorType] of mysqlClasses.entries()) {
  const cause = new Error(`synthetic-private-mysql-${index}`);
  const original = new ErrorType("classified MySQL error", { cause });
  const returned = mysql.mysqlError(
    mysql.MysqlStorageOperationError,
    "safe MySQL operation message",
    original,
  );
  check(returned === original, `MySQL classified identity ${index}`);
  check(returned.cause === cause, `MySQL classified cause ${index}`);
  classified.push({ provider: "mysql", type: ErrorType.name, identity: true, causeIdentity: true });
}

const rawPg = Object.assign(new Error("SYNTHETIC_PRIVATE_SQL: SELECT secret FROM private_table"), {
  code: "XX000",
});
const wrappedPg = pg.PostgresStorageErrors.operation(rawPg);
check(wrappedPg !== rawPg, "PostgreSQL raw driver error is wrapped");
check(wrappedPg.cause === rawPg, "PostgreSQL raw driver cause identity");
check(
  wrappedPg.message === "PostgreSQL storage operation failed.",
  "PostgreSQL outer message is safe",
);
check(!wrappedPg.message.includes("SYNTHETIC_PRIVATE_SQL"), "PostgreSQL SQL text is not exposed");

const rawMysql = Object.assign(
  new Error("SYNTHETIC_PRIVATE_SQL: UPDATE private_table SET secret=1"),
  {
    code: "ER_SIGNAL_EXCEPTION",
  },
);
const wrappedMysql = mysql.mysqlError(
  mysql.MysqlStorageOperationError,
  "MySQL storage operation failed.",
  rawMysql,
);
check(wrappedMysql !== rawMysql, "MySQL raw driver error is wrapped");
check(wrappedMysql.cause === rawMysql, "MySQL raw driver cause identity");
check(wrappedMysql.message === "MySQL storage operation failed.", "MySQL outer message is safe");
check(!wrappedMysql.message.includes("SYNTHETIC_PRIVATE_SQL"), "MySQL SQL text is not exposed");

const thrownObject = { message: "SYNTHETIC_PRIVATE_SQL object detail" };
const wrappedPgObject = pg.PostgresStorageErrors.operation(thrownObject);
check(
  wrappedPgObject instanceof pg.PostgresStorageOperationError,
  "PostgreSQL object throw is normalized",
);
check(wrappedPgObject.cause === thrownObject, "PostgreSQL object throw cause identity");
check(
  wrappedPgObject.message === "PostgreSQL storage operation failed.",
  "PostgreSQL object throw message is safe",
);
const wrappedMysqlObject = mysql.mysqlError(
  mysql.MysqlStorageOperationError,
  "MySQL storage operation failed.",
  thrownObject,
);
check(
  wrappedMysqlObject instanceof mysql.MysqlStorageOperationError,
  "MySQL object throw is normalized",
);
check(wrappedMysqlObject.cause === thrownObject, "MySQL object throw cause identity");
check(
  wrappedMysqlObject.message === "MySQL storage operation failed.",
  "MySQL object throw message is safe",
);

const wrappedPgUndefined = pg.PostgresStorageErrors.operation(undefined);
check(
  wrappedPgUndefined instanceof pg.PostgresStorageOperationError,
  "PostgreSQL undefined throw is normalized",
);
check(wrappedPgUndefined.cause === undefined, "PostgreSQL undefined cause remains undefined");
const wrappedMysqlUndefined = mysql.mysqlError(
  mysql.MysqlStorageOperationError,
  "MySQL storage operation failed.",
  undefined,
);
check(
  wrappedMysqlUndefined instanceof mysql.MysqlStorageOperationError,
  "MySQL undefined throw is normalized",
);
check(wrappedMysqlUndefined.cause === undefined, "MySQL undefined cause remains undefined");

const result = {
  status: "PASS",
  scope:
    "built provider error normalizer identity only; not public-service or live-driver evidence",
  profile:
    "orchestrator-dispatched mechanical diagnostic probe, gpt-6-luna / low; runtime metadata unavailable",
  commands: [
    "node --check build-protocol/tasks/sql-delivery-reliability/evidence/error-normalization-identity.mjs",
    "pnpm exec eslint build-protocol/tasks/sql-delivery-reliability/evidence/error-normalization-identity.mjs",
    "pnpm exec prettier --check build-protocol/tasks/sql-delivery-reliability/evidence/error-normalization-identity.mjs",
    "node build-protocol/tasks/sql-delivery-reliability/evidence/error-normalization-identity.mjs",
  ],
  modules: [
    {
      path: "packages/storage-postgres/dist/postgres/errors.js",
      sha256: createHash("sha256").update(pgBytes).digest("hex"),
    },
    {
      path: "packages/storage-mysql/dist/mysql/errors.js",
      sha256: createHash("sha256").update(mysqlBytes).digest("hex"),
    },
  ],
  assertionCount: assertions,
  classifiedInstanceCount: classified.length,
  classified,
  controls: {
    rawDriverErrors: 2,
    rawThrownObjects: 2,
    rawUndefinedThrows: 2,
    privateSqlTextPrinted: false,
  },
};
await writeFile(
  resolve(evidence, "error-normalization-identity.result.json"),
  `${JSON.stringify(result, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(result)}\n`);
