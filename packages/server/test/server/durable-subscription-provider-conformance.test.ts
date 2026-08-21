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

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { ActorContextSchema, TenantIdSchema, UserIdSchema } from "@spine-event-engine/proto";
import { GatewayAuthenticatedSubscriptionSchema } from "@spine-event-engine/proto/auth";
import { SubscriptionSchema, TopicSchema } from "@spine-event-engine/proto/client";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import { InMemoryStorageFactory, type StorageFactory } from "@spine-event-engine/storage";
import { createPool } from "mysql2/promise";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MysqlStorageFactory } from "@spine-event-engine/storage-rdbms";
import { DurableSubscriptionBindings } from "../../src/index.js";

vi.mock("mysql2/promise", () => ({ createPool: vi.fn() }));

const context = create(ActorContextSchema, {
  actor: create(UserIdSchema, { value: "actor" }),
  tenantId: create(TenantIdSchema, { kind: { case: "value", value: "tenant" } }),
});
const topic = toBinary(TopicSchema, create(TopicSchema, { context }));

async function exercise(factory: StorageFactory, reopen = true): Promise<void> {
  const first = new DurableSubscriptionBindings({
    storageFactory: factory,
    namespace: "provider",
    nextId: () => "subscription",
    cleanup: () => Promise.resolve(),
  });
  const wire = await first.create({
    topic: { kind: "subscription-topic", bytes: topic },
    whenExpires: 1_000,
  });
  if (reopen) await first.close();
  const reopened = reopen
    ? new DurableSubscriptionBindings({
        storageFactory: factory,
        namespace: "provider",
        nextId: () => "other",
        cleanup: () => Promise.resolve(),
      })
    : first;
  const restored: Uint8Array[] = [];
  if (reopen)
    await reopened.recoverActive({
      nowMs: 1,
      onDefinition: (value) => {
        restored.push(value.bytes);
        return Promise.resolve();
      },
    });
  const id = fromBinary(SubscriptionSchema, wire.bytes).id?.value;
  if (id === undefined) throw new Error("created subscription has no ID");
  await reopened.cancel({ id, context, nowMs: 1, onDefinition: () => Promise.resolve() });
  if (reopen) expect(restored).toEqual([wire.bytes]);
  await reopened.close();
}

afterEach(() => vi.clearAllMocks());

describe("DurableSubscriptionBindings provider selection", () => {
  it("uses only the configured MySQL approved-record table", async () => {
    const records = new Map<string, Uint8Array>();
    const queries: string[] = [];
    let columns: readonly { readonly column_name: string }[] = [];
    const connection = {
      release: vi.fn(),
      beginTransaction: vi.fn(() => Promise.resolve()),
      commit: vi.fn(() => Promise.resolve()),
      rollback: vi.fn(() => Promise.resolve()),
      query: vi.fn((sql: string) => {
        queries.push(sql);
        if (sql.startsWith("CREATE TABLE")) {
          columns = [...(/\((.*), PRIMARY KEY/.exec(sql)?.[1] ?? "").matchAll(/`([^`]+)`/g)].map(
            (match) => ({ column_name: match[1] ?? "" }),
          );
        }
        if (sql.includes("information_schema.columns")) return Promise.resolve([columns]);
        if (sql.includes("information_schema.tables"))
          return Promise.resolve([[{ engine: "InnoDB" }]]);
        return Promise.resolve([[]]);
      }),
      execute: vi.fn((sql: string, values: readonly unknown[] = []) => {
        queries.push(sql);
        if (sql.startsWith("SELECT bytes"))
          return Promise.resolve([records.size === 0 ? [] : [{ bytes: [...records.values()][0] }]]);
        if (sql.startsWith("INSERT INTO")) {
          records.set("record", values[1] as Uint8Array);
          return Promise.resolve([{ affectedRows: 1 }]);
        }
        if (sql.startsWith("DELETE FROM")) {
          const deleted = records.size > 0;
          records.clear();
          return Promise.resolve([{ affectedRows: deleted ? 1 : 0 }]);
        }
        return Promise.resolve([[]]);
      }),
    };
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.resolve(connection)),
      end: vi.fn(() => Promise.resolve()),
    } as never);
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/auth" })
      .setTableName(GatewayAuthenticatedSubscriptionSchema, "gateway_authenticated_subscriptions")
      .build();

    await exercise(factory, false);

    expect(queries.some((sql) => sql.includes("`gateway_authenticated_subscriptions`"))).toBe(true);
    expect(
      queries.every(
        (sql) => !sql.includes("SubscriptionBinding") && !sql.includes("SubscriptionBindingQuota"),
      ),
    ).toBe(true);
    factory.close();
  });

  it("uses only the configured Datastore approved-record creator", async () => {
    const backing = new InMemoryStorageFactory();
    const selected: unknown[] = [];
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient({} as never)
      .useRecordStorage(GatewayAuthenticatedSubscriptionSchema, (storageContext, spec) => {
        selected.push(spec.recordType);
        return backing.createRecordStorage(storageContext, spec);
      })
      .build();

    await exercise(factory);

    expect(selected).toEqual([
      GatewayAuthenticatedSubscriptionSchema,
      GatewayAuthenticatedSubscriptionSchema,
    ]);
    factory.close();
  });
});
