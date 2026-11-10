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

import { expect, it } from "vitest";

it("rejects a PostgreSQL launch whose tenant databases share one target", async () => {
  const { createOrdersPostgresFactory } = await import("../dist/src/orders-postgres.js");
  await expect(
    createOrdersPostgresFactory({
      sharedUrl: "postgresql://localhost/orders_shared",
      northwindUrl: "postgresql://localhost/orders_northwind",
      contosoUrl: "postgresql://localhost/orders_northwind",
    }),
  ).rejects.toThrow(/database|target/i);
});

it("rejects a PostgreSQL launch with a missing tenant database target", async () => {
  const { createOrdersPostgresFactory } = await import("../dist/src/orders-postgres.js");
  await expect(
    createOrdersPostgresFactory({
      sharedUrl: "postgresql://localhost/orders_shared",
      northwindUrl: "",
      contosoUrl: "postgresql://localhost/orders_contoso",
    }),
  ).rejects.toThrow();
});

it("rejects a malformed PostgreSQL database target", async () => {
  const { createOrdersPostgresFactory } = await import("../dist/src/orders-postgres.js");
  await expect(
    createOrdersPostgresFactory({
      sharedUrl: "postgresql://localhost/orders_shared",
      northwindUrl: "not-a-postgresql-url",
      contosoUrl: "postgresql://localhost/orders_contoso",
    }),
  ).rejects.toThrow();
});
