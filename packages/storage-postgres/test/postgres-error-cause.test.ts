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

import { PostgresStorageErrors, PostgresStorageOperationError } from "../src/postgres/errors.js";

describe("PostgreSQL failure normalization", () => {
  it("keeps the original driver failure internally while retaining a safe provider message", () => {
    const driver = Object.assign(new Error("secret SQL and parameter"), { code: "40P01" });

    const error = PostgresStorageErrors.operation(driver);

    expect(error).toBeInstanceOf(PostgresStorageOperationError);
    expect(error.message).toBe("PostgreSQL storage operation failed.");
    expect(error.cause).toBe(driver);
    expect((error.cause as typeof driver).code).toBe("40P01");
  });
});
