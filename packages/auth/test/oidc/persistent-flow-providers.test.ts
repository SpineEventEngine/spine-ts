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

import { randomUUID } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Datastore } from "@google-cloud/datastore";
import { StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import {
  OidcLoginGrantSchema,
  OidcLoginTransactionSchema,
  AuthenticatedPrincipalSchema,
} from "@spine-event-engine/proto/auth";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import { MysqlStorageFactory } from "@spine-event-engine/storage-mysql";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { StorageGroup, type StorageFactory, type RecordStorage } from "@spine-event-engine/storage";
import { describe, expect, it, vi } from "vitest";
import type { OidcLoginGrant, OidcLoginTransaction } from "@spine-event-engine/proto/auth";

import { PersistentOidcFlowStore } from "../../src/index.js";
import { OidcFlowKeys } from "../../src/oidc/records.js";

const postgres = process.env.SPINE_TS_POSTGRESQL_URL;
const mysql = process.env.SPINE_TS_MYSQL_URL;
const maria = process.env.SPINE_TS_MARIADB_URL;
const datastore = process.env.DATASTORE_EMULATOR_HOST;

for (const [name, url, open] of [
  [
    "PostgreSQL",
    postgres,
    () => {
      if (postgres === undefined) throw new Error("PostgreSQL URL is required.");
      return PostgresStorageFactory.newBuilder()
        .setOptions({ url: postgres })
        .setStringifierRegistry(stringifiers())
        .build();
    },
  ],
  [
    "MySQL",
    mysql,
    () => {
      if (mysql === undefined) throw new Error("MySQL URL is required.");
      return MysqlStorageFactory.newBuilder()
        .setOptions({ url: mysql })
        .setStringifierRegistry(stringifiers())
        .build();
    },
  ],
  [
    "MariaDB",
    maria,
    () => {
      if (maria === undefined) throw new Error("MariaDB URL is required.");
      return MysqlStorageFactory.newBuilder()
        .setOptions({ url: maria })
        .setStringifierRegistry(stringifiers())
        .build();
    },
  ],
  [
    "Datastore",
    datastore,
    () =>
      DatastoreStorageFactory.newBuilder()
        .setClient(new Datastore({ projectId: "spine-persistent-tenant-auth-emulator" }))
        .build(),
  ],
] as const) {
  describe.skipIf(url === undefined)(`${name} OIDC flow storage`, () => {
    it("retains independent consumption and scopes indexed exact expiry by flow", async () => {
      await exercise(open);
    });
  });
}

/**
 * Exercises complete records and exact indexed maintenance through independent provider factories.
 * @param open Constructs a provider factory for a disposable group.
 */
async function exercise(open: () => StorageFactory | Promise<StorageFactory>): Promise<void> {
  const group = new StorageGroup(`oidc_${randomUUID().replaceAll("-", "")}`);
  const clock = () => create(TimestampSchema, { seconds: 200n });
  let firstFactory: StorageFactory | undefined;
  let secondFactory: StorageFactory | undefined;
  let first: PersistentOidcFlowStore | undefined;
  let second: PersistentOidcFlowStore | undefined;
  let other: PersistentOidcFlowStore | undefined;
  try {
    firstFactory = await open();
    secondFactory = await open();
    const opened = vi.spyOn(firstFactory, "createRecordStorage");
    first = await PersistentOidcFlowStore.create({
      storageFactory: firstFactory,
      group,
      flowId: "employee",
      clock,
    });
    second = await PersistentOidcFlowStore.create({
      storageFactory: secondFactory,
      group,
      flowId: "employee",
      clock,
      createMissingStructures: false,
    });
    other = await PersistentOidcFlowStore.create({
      storageFactory: secondFactory,
      group,
      flowId: "partner",
      clock,
      createMissingStructures: false,
    });
    const state = transaction("employee", "state", -1n, 999_999_999);
    expect(await first.insertTransaction(state)).toBe(true);
    expect(await second.readTransaction(state.lookupDigest)).toEqual(state);
    expect(
      (
        await Promise.all([first.consumeTransaction(state), second.consumeTransaction(state)])
      ).sort(),
    ).toEqual([false, true]);
    expect(await first.readTransaction(state.lookupDigest)).toBeUndefined();
    const usedGrant = grant("employee", "used-grant", -1n, 999_999_999);
    expect(await first.insertGrant(usedGrant)).toBe(true);
    expect(await second.readGrant(usedGrant.lookupDigest)).toEqual(usedGrant);
    expect(
      (await Promise.all([first.consumeGrant(usedGrant), second.consumeGrant(usedGrant)])).sort(),
    ).toEqual([false, true]);
    expect(await first.readGrant(usedGrant.lookupDigest)).toBeUndefined();
    for (let index = 0; index < 24; index += 1)
      expect(
        await other.insertTransaction(transaction("partner", `other-${String(index)}`, -1n, 1)),
      ).toBe(true);
    const selected = transaction("employee", "selected", -1n, 1);
    const later = transaction("employee", "later", -1n, 2);
    const selectedGrant = grant("employee", "selected-grant", -1n, 1);
    const laterGrant = grant("employee", "later-grant", -1n, 2);
    expect(await first.insertTransaction(selected)).toBe(true);
    expect(await second.insertTransaction(later)).toBe(true);
    expect(await first.insertGrant(selectedGrant)).toBe(true);
    expect(await second.insertGrant(laterGrant)).toBe(true);
    expect(await other.insertGrant(grant("partner", "other-grant", -1n, 1))).toBe(true);
    const handle = opened.mock.results[0]?.value as RecordStorage<string, OidcLoginTransaction>;
    const grantHandle = opened.mock.results[1]?.value as RecordStorage<string, OidcLoginGrant>;
    const query = handle.queryPlanEntries.bind(handle);
    const queryGrants = grantHandle.queryPlanEntries.bind(grantHandle);
    const cutoff = create(TimestampSchema, { seconds: -1n, nanos: 1 });
    let discoveries = 0;
    vi.spyOn(handle, "queryPlanEntries").mockImplementation(async (plan) => {
      discoveries += 1;
      expect(plan.predicate).toMatchObject({
        kind: "all",
        predicates: [
          {
            column: "expires_order",
            operator: "lessOrEqual",
            value: OidcFlowKeys.upperBound("employee", cutoff),
          },
          discoveries === 1
            ? {
                column: "expires_order",
                operator: "greaterOrEqual",
                value: OidcFlowKeys.lowerBound("employee"),
              }
            : {
                column: "expires_order",
                operator: "greaterThan",
                value: OidcFlowKeys.orderKey(selected),
              },
        ],
      });
      const rows = await query(plan);
      expect(rows.every((row) => row.record.flowId === "employee")).toBe(true);
      return rows;
    });
    let grantDiscoveries = 0;
    vi.spyOn(grantHandle, "queryPlanEntries").mockImplementation(async (plan) => {
      grantDiscoveries += 1;
      expect(plan.predicate).toMatchObject({
        kind: "all",
        predicates: [
          {
            column: "expires_order",
            operator: "lessOrEqual",
            value: OidcFlowKeys.upperBound("employee", cutoff),
          },
          grantDiscoveries === 1
            ? {
                column: "expires_order",
                operator: "greaterOrEqual",
                value: OidcFlowKeys.lowerBound("employee"),
              }
            : {
                column: "expires_order",
                operator: "greaterThan",
                value: OidcFlowKeys.orderKey(selectedGrant),
              },
        ],
      });
      const rows = await queryGrants(plan);
      expect(rows.every((row) => row.record.flowId === "employee")).toBe(true);
      return rows;
    });
    expect(await first.purgeExpired(cutoff)).toEqual({
      transactions: 1,
      grants: 1,
    });
    expect(discoveries).toBe(2);
    expect(grantDiscoveries).toBe(2);
    expect(await second.readTransaction(selected.lookupDigest)).toBeUndefined();
    expect(await first.readTransaction(later.lookupDigest)).toBeDefined();
    expect(await second.readGrant(selectedGrant.lookupDigest)).toBeUndefined();
    expect(await first.readGrant(laterGrant.lookupDigest)).toBeDefined();
    expect(await other.readGrant(OidcFlowKeys.digest("partner", "other-grant"))).toBeDefined();
    expect(await other.readTransaction(OidcFlowKeys.digest("partner", "other-0"))).toBeDefined();
    await first.close();
    first = undefined;
    const reopened = await PersistentOidcFlowStore.create({
      storageFactory: firstFactory,
      group,
      flowId: "employee",
      clock,
      createMissingStructures: false,
    });
    expect(await reopened.readTransaction(later.lookupDigest)).toBeDefined();
    expect(await reopened.readGrant(laterGrant.lookupDigest)).toBeDefined();
    await reopened.close();
  } finally {
    await first?.close();
    await second?.close();
    await other?.close();
    await firstFactory?.close();
    await secondFactory?.close();
  }
}

/**
 * Creates a complete transaction with a selected exact timestamp.
 * @param flowId Logical flow identity.
 * @param state Browser state material.
 * @param seconds Deadline seconds.
 * @param nanos Deadline nanoseconds.
 * @returns The complete typed transaction record.
 */
function transaction(flowId: string, state: string, seconds: bigint, nanos: number) {
  return create(OidcLoginTransactionSchema, {
    lookupDigest: OidcFlowKeys.digest(flowId, state),
    flowId,
    providerIssuer: "https://issuer.example",
    clientId: "browser-app",
    callbackUri: "https://app.example/callback",
    nonce: "nonce",
    providerCodeVerifier: "verifier",
    browserCodeChallenge: "challenge",
    postLoginRedirect: "https://app.example/home",
    whenExpires: create(TimestampSchema, { seconds, nanos }),
  });
}

/**
 * Creates a complete application grant with a selected exact timestamp.
 * @param flowId Logical flow identity.
 * @param value Random grant material.
 * @param seconds Deadline seconds.
 * @param nanos Deadline nanoseconds.
 * @returns The complete typed grant record.
 */
function grant(flowId: string, value: string, seconds: bigint, nanos: number) {
  return create(OidcLoginGrantSchema, {
    lookupDigest: OidcFlowKeys.digest(flowId, value),
    flowId,
    principal: create(AuthenticatedPrincipalSchema, { id: "person" }),
    browserCodeChallenge: "challenge",
    postLoginRedirect: "https://app.example/home",
    whenExpires: create(TimestampSchema, { seconds, nanos }),
  });
}

/**
 * Supplies complete metadata for provider serialization.
 * @returns A registry with transaction, grant, and principal schemas.
 */
function stringifiers(): StringifierRegistry {
  const registry = new StringifierRegistry();
  registry.setTypeRegistry(
    new TypeRegistry([
      AuthenticatedPrincipalSchema,
      OidcLoginTransactionSchema,
      OidcLoginGrantSchema,
    ]),
  );
  return registry;
}
