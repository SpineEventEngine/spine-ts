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

import { afterEach, beforeEach, test } from "vitest";
import {
  EnvironmentType,
  PersistentTenantIndex,
  ServerEnvironment,
} from "@spine-event-engine/server";
import { ServerTests } from "@spine-event-engine/server/testing";
import { InMemoryStorageFactory, StorageGroup } from "@spine-event-engine/storage";

import * as testing from "../src/index.js";
import { registerBlackBoxContract } from "./black-box.contract.mjs";

let tenantIndex: PersistentTenantIndex;

beforeEach(async () => {
  tenantIndex = await PersistentTenantIndex.create({
    storageFactory: new InMemoryStorageFactory(),
    group: new StorageGroup("testing-black-box-tenants"),
  });
  ServerEnvironment.when(EnvironmentType.Local).use({ tenantIndex });
  await ServerEnvironment.instance().completeSetup();
});
afterEach(async () => {
  await ServerTests.resetEnvironment();
  await tenantIndex.close();
});

registerBlackBoxContract(test, testing);
