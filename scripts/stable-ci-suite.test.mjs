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

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { infrastructureTestFiles } from "./test-inventory.mjs";
import infrastructureConfig from "../vitest.infrastructure.config.ts";
import ordinaryConfig from "../vitest.config.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const expectedInfrastructureFiles = [
  "packages/storage-datastore/test/datastore-cloud.test.ts",
  "packages/storage-datastore/test/datastore-emulator.test.ts",
  "packages/storage-rdbms/test/mysql-integration.test.ts",
  "packages/server/test/delivery/inbox-provider-cleanup.test.ts",
];

describe("stable CI test inventory", () => {
  it("keeps the exact external-provider files outside the ordinary Vitest suite", () => {
    expect(infrastructureTestFiles).toEqual(expectedInfrastructureFiles);
    expect(new Set(infrastructureTestFiles).size).toBe(infrastructureTestFiles.length);
    for (const file of infrastructureTestFiles) {
      expect(existsSync(join(root, file))).toBe(true);
    }

    expect(ordinaryConfig.test?.exclude).toEqual(expect.arrayContaining(infrastructureTestFiles));
  });

  it("keeps provider tests available only through explicit infrastructure commands", () => {
    expect(infrastructureConfig.test?.include).toEqual(infrastructureTestFiles);

    const datastore = JSON.parse(
      readFileSync(join(root, "packages/storage-datastore/package.json")),
    );
    expect(datastore.scripts["test:emulator"]).toContain("vitest.infrastructure.config.ts");
    expect(datastore.scripts["test:cloud"]).toMatch(
      /^node scripts\/verify-cloud-config\.mjs && pnpm /u,
    );
    expect(datastore.scripts["test:cloud"]).toContain("vitest.infrastructure.config.ts");
    expect(datastore.scripts["test:cloud"]).toContain("datastore-cloud.test.ts");
    expect(datastore.scripts["test:cloud"]).not.toContain("inbox-provider-cleanup.test.ts");
    expect(datastore.scripts["test:emulator"]).toMatch(
      /^node scripts\/verify-emulator-config\.mjs && SPINE_TS_INBOX_PROVIDER=datastore pnpm /u,
    );
    expect(datastore.scripts["test:emulator"]).toContain("inbox-provider-cleanup.test.ts");

    const rdbms = JSON.parse(readFileSync(join(root, "packages/storage-rdbms/package.json")));
    expect(rdbms.scripts["test:mysql"]).toContain("vitest.infrastructure.config.ts");
    expect(rdbms.scripts["test:mysql"]).toMatch(
      /^node scripts\/mysql\.mjs && SPINE_TS_INBOX_PROVIDER=mysql pnpm /u,
    );
    expect(rdbms.scripts["test:mysql"]).toContain("inbox-provider-cleanup.test.ts");
  });

  it("fails provider commands before Vitest when their required setup is absent", () => {
    const cloudVerifier = spawnSync(
      process.execPath,
      ["packages/storage-datastore/scripts/verify-cloud-config.mjs"],
      { env: withoutProviderEnvironment() },
    );
    expect(cloudVerifier.status).not.toBe(0);

    const emulatorVerifier = spawnSync(
      process.execPath,
      ["packages/storage-datastore/scripts/verify-emulator-config.mjs"],
      { env: withoutProviderEnvironment() },
    );
    expect(emulatorVerifier.status).not.toBe(0);

    const mysqlVerifier = spawnSync(
      process.execPath,
      ["packages/storage-rdbms/scripts/mysql.mjs"],
      {
        env: withoutProviderEnvironment(),
      },
    );
    expect(mysqlVerifier.status).not.toBe(0);
  });

  it("retains self-contained loopback and child-process coverage in the ordinary suite", () => {
    expect(infrastructureTestFiles).not.toContain(
      "packages/server/test/server/managed-remote-delivery-readiness.integration.test.ts",
    );
    expect(ordinaryConfig.test?.include).toContain("packages/*/test/**/*.test.ts");
  });
});

function withoutProviderEnvironment() {
  const environment = { ...process.env };
  delete environment.DATASTORE_EMULATOR_HOST;
  delete environment.DATASTORE_PROJECT_ID;
  delete environment.SPINE_TS_MYSQL_URL;
  delete environment.SPINE_TS_MYSQL_ADMIN_URL;
  return environment;
}
