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

import { create } from "@bufbuild/protobuf";
import {
  SubscriptionIdSchema,
  SubscriptionRecordSchema,
  SubscriptionSchema,
  type SubscriptionId,
  type SubscriptionRecord,
} from "@spine-event-engine/proto/client";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import {
  InMemoryStorageFactory,
  type RecordSpec,
  type StorageContext,
  type StorageFactory,
} from "@spine-event-engine/storage";
import { createPool } from "mysql2/promise";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StorageSubscriptionRegistry } from "../../src/stand/subscription-registry.js";
import { MysqlStorageFactory } from "@spine-event-engine/storage-rdbms";

vi.mock("mysql2/promise", () => ({ createPool: vi.fn() }));

function id(value: string): SubscriptionId {
  return create(SubscriptionIdSchema, { value });
}

function subscription(value: string) {
  return create(SubscriptionSchema, {
    id: id(value),
    topic: { id: { value: "provider.selection" } },
  });
}

async function exerciseRegistry(factory: StorageFactory): Promise<void> {
  const registry = new StorageSubscriptionRegistry(
    { name: "provider-selection", multitenant: false },
    factory,
  );
  await expect(registry.create(subscription("one"))).resolves.toMatchObject({ kind: "created" });
  await expect(registry.get(id("one"))).resolves.toMatchObject({
    subscription: { id: { value: "one" } },
  });
  await expect(registry.delete(id("one"))).resolves.toBe("deleted");
  await registry.close();
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("StorageSubscriptionRegistry provider configuration", () => {
  it("exposes the approved physical activation-expiry column name", () => {
    const factory = new InMemoryStorageFactory();
    const open = factory.createRecordStorage.bind(factory);
    let columns: readonly string[] = [];
    factory.createRecordStorage = ((
      context: StorageContext,
      spec: RecordSpec<SubscriptionId, SubscriptionRecord>,
    ) => {
      columns = spec.columns.map((column) => column.name);
      return open(context, spec);
    }) as never;

    new StorageSubscriptionRegistry({ name: "provider-columns", multitenant: false }, factory);

    expect(columns).toContain("when_activation_expires");
    expect(columns).not.toContain("whenActivationExpires");
  });

  it("uses the configured MySQL SubscriptionRecord table", async () => {
    const queries: string[] = [];
    const records = new Map<string, Uint8Array>();
    let schemaColumns: readonly { readonly column_name: string }[] = [];
    const connection = {
      release: vi.fn(),
      beginTransaction: vi.fn(() => Promise.resolve()),
      commit: vi.fn(() => Promise.resolve()),
      rollback: vi.fn(() => Promise.resolve()),
      query: vi.fn(async (sql: string) => {
        await Promise.resolve();
        queries.push(sql);
        if (sql.startsWith("CREATE TABLE")) {
          const definitions = /\((.*), PRIMARY KEY/.exec(sql)?.[1] ?? "";
          schemaColumns = [...definitions.matchAll(/`([^`]+)`/g)].map((match) => ({
            column_name: match[1] ?? "",
          }));
          return [[]];
        }
        if (sql.includes("information_schema.columns")) return [schemaColumns];
        if (sql.includes("information_schema.tables")) return [[{ engine: "InnoDB" }]];
        return [[]];
      }),
      execute: vi.fn(async (sql: string, values: readonly unknown[] = []) => {
        await Promise.resolve();
        queries.push(sql);
        if (sql.startsWith("SELECT bytes")) {
          const value = records.get(String(values[0]));
          return [value === undefined ? [] : [{ bytes: value }]];
        }
        if (sql.startsWith("INSERT INTO")) {
          records.set(String(values[0]), values[1] as Uint8Array);
          return [{ affectedRows: 1 }];
        }
        if (sql.startsWith("DELETE FROM")) {
          const key = String(values[0]);
          const deleted = records.delete(key);
          return [{ affectedRows: deleted ? 1 : 0 }];
        }
        return [[]];
      }),
    };
    expect(vi.isMockFunction(createPool)).toBe(true);
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.resolve(connection)),
      end: vi.fn(() => Promise.resolve()),
    } as never);
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/provider_selection" })
      .setTableName(SubscriptionRecordSchema, "stand_subscription_records")
      .build();

    await exerciseRegistry(factory);

    expect(queries.some((sql) => sql.includes("`stand_subscription_records`"))).toBe(true);
    factory.close();
  });

  it("uses the configured Datastore SubscriptionRecord storage handle", async () => {
    const backing = new InMemoryStorageFactory();
    let selected = false;
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient({} as never)
      .useRecordStorage(SubscriptionRecordSchema, (context, spec) => {
        selected = spec.recordType === SubscriptionRecordSchema;
        return backing.createRecordStorage(context, spec);
      })
      .build();

    await exerciseRegistry(factory);

    expect(selected).toBe(true);
    factory.close();
  });
});
