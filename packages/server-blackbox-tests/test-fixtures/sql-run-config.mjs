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
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { URL } from "node:url";

/**
 * Selects the explicitly configured SQL test endpoint for one provider.
 *
 * @param name Identifies the SQL engine under test.
 * @returns The provider name, engine, and configured test endpoint.
 */
export function sqlProvider(name) {
  const postgres = name === "postgres16" || name === "postgres18";
  assert.ok(postgres || name === "mysql84" || name === "mariadb114", "Unknown SQL provider.");
  const variable = postgres ? "SPINE_TS_POSTGRESQL_URL" : "SPINE_TS_MYSQL_URL";
  const url = process.env[variable];
  assert.ok(url, `${variable} is required for this integration test.`);
  assert.ok(new URL(url).pathname.length > 1, "SQL test URL must select a database.");
  return { name, engine: postgres ? "postgres" : "mysql", urls: { spine_test: url } };
}

/**
 * Creates one disposable run directory under the configured OS temporary directory.
 *
 * @param label Identifies the fixture in temporary file listings.
 * @returns The private run directory path.
 */
export function sqlRunDirectory(label) {
  return mkdtemp(join(tmpdir(), `spine-${label}-`));
}
