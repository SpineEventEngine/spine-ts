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

import { ServerEnvironment } from "@spine-event-engine/server";

import { TenantScenarios } from "./tenant-scenarios.js";

/**

 * Runs one complete tenant assembly scenario in a fresh Node process.

 */
const mode = process.argv[2];
if (!["single", "single-explicit", "external", "persistent"].includes(mode ?? ""))
  throw new Error("Choose single, single-explicit, external, or persistent.");

try {
  if (mode === "single" || mode === "single-explicit") {
    await TenantScenarios.single(mode === "single-explicit");
    console.log("Single-tenant Bounded Context closed without a tenant directory.");
  } else {
    const result =
      mode === "external" ? await TenantScenarios.external() : await TenantScenarios.persistent();
    if (!result.registered || !result.unknownRejected)
      throw new Error("Multitenant admission did not preserve membership.");
    console.log("Registered tenant admitted; unknown tenant refused; resources closed.");
  }
} finally {
  await ServerEnvironment.instance().close();
}
