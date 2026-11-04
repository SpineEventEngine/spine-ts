import { afterEach, beforeEach, test } from "node:test";
import {
  EnvironmentType,
  PersistentTenantIndex,
  ServerEnvironment,
} from "@spine-event-engine/server";
import { ServerTests } from "@spine-event-engine/server/testing";
import { InMemoryStorageFactory, StorageGroup } from "@spine-event-engine/storage";
import * as testing from "@spine-event-engine/testing";
import { registerBlackBoxContract } from "./black-box.contract.mjs";

let tenantIndex;

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
