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

import process from "node:process";

import {
  createOrdersPostgresFactory,
  configureOrdersEnvironment,
  ordersTenants,
  startOrdersServer,
} from "../src/index.js";
import { ordersLoadLevels, runOrdersLoad } from "../src/load-runner.js";
import { withOrdersServer } from "../src/orders-launch.js";

const sharedUrl = process.env.ORDERS_SHARED_DATABASE_URL;
const northwindUrl = process.env.ORDERS_NORTHWIND_DATABASE_URL;
const contosoUrl = process.env.ORDERS_CONTOSO_DATABASE_URL;
if (!sharedUrl || !northwindUrl || !contosoUrl)
  throw new Error("Three Orders PostgreSQL database URLs are required.");

const users = Number.parseInt(process.env.SPINE_ORDERS_LOAD_USERS ?? "10", 10);
if (!ordersLoadLevels.includes(users as 10 | 100 | 1000))
  throw new Error("SPINE_ORDERS_LOAD_USERS must be one of 10, 100, or 1000.");

const factory = await createOrdersPostgresFactory({ sharedUrl, northwindUrl, contosoUrl });
const setup = await configureOrdersEnvironment({
  storageFactory: factory,
  tenants: [ordersTenants.northwind, ordersTenants.contoso],
  membership: "seed-if-empty",
});
const result = await withOrdersServer(
  setup,
  () => startOrdersServer(setup),
  (server) =>
    runOrdersLoad({
      baseUrl: server.baseUrl,
      users: users as 10 | 100 | 1000,
      tenants: [ordersTenants.northwind, ordersTenants.contoso],
    }),
);
console.log(JSON.stringify(result));
