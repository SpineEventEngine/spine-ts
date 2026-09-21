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

import { describe, expect, it } from "vitest";

import { PostgresIdColumn } from "../src/postgres/id-column.js";

describe("PostgresIdColumn", () => {
  it("uses JDBC-compatible PostgreSQL types and precision-safe bigint reads", () => {
    expect(new PostgresIdColumn("string").postgresType).toBe("VARCHAR(512)");
    expect(new PostgresIdColumn("int32").postgresType).toBe("INT");
    const integer = new PostgresIdColumn("int64");

    expect(integer.postgresType).toBe("BIGINT");
    expect(integer.read("9007199254740993")).toBe(9_007_199_254_740_993n);
  });
});
