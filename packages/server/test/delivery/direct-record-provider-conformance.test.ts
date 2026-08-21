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

import { create, toBinary } from "@bufbuild/protobuf";
import { AnySchema, Int32ValueSchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import { access } from "node:fs/promises";
import { Identifiers, StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import {
  InboxMessageSchema,
  ShardSessionRecordSchema,
  WorkerIdSchema,
} from "@spine-event-engine/proto/delivery";
import { CommandSchema } from "@spine-event-engine/proto";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { createPool } from "mysql2/promise";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import { MysqlStorageFactory } from "@spine-event-engine/storage-rdbms";
import { InboxStorage } from "../../src/delivery/inbox-storage.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import { ShardedWorkRegistry } from "../../src/delivery/sharded-work-registry.js";

vi.mock("mysql2/promise", () => ({ createPool: vi.fn() }));

afterEach(() => vi.clearAllMocks());

describe("direct durable record provider selection", () => {
  it("has no durable delivery-attempt family", async () => {
    await expect(
      access(new URL("../../src/delivery/delivery-attempts.ts", import.meta.url)),
    ).rejects.toThrow();
  });

  it("routes direct delivery records without a generic TenantId record family", async () => {
    const backing = new InMemoryStorageFactory();
    const selected: unknown[] = [];
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient({} as never)
      .useRecordStorage(InboxMessageSchema, (context, spec) => {
        selected.push(spec.recordType);
        return backing.createRecordStorage(context, spec);
      })
      .useRecordStorage(ShardSessionRecordSchema, (context, spec) => {
        selected.push(spec.recordType);
        return backing.createRecordStorage(context, spec);
      })
      .build();
    const inbox = new InboxStorage({
      context: { name: "provider-inbox", multitenant: false },
      storageFactory: factory,
    });
    const registry = new ShardedWorkRegistry({
      context: { name: "provider-shard", multitenant: false },
      storageFactory: factory,
      now: () => new Date(1_000),
    });
    const typedMessage = message();
    await inbox.write(typedMessage);
    await expect(inbox.read(ShardIndex.single())).resolves.toMatchObject([
      { inboxId: { targetId: typedMessage.inboxId.targetId } },
    ]);
    await registry.pickUp(
      ShardIndex.single(),
      create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" }),
    );
    expect(
      [...new Set(selected.map((type) => (type as { readonly typeName: string }).typeName))].sort(),
    ).toEqual([InboxMessageSchema.typeName, ShardSessionRecordSchema.typeName].sort());

    factory.close();
  });

  it("opens the configured MySQL table for each direct durable record family", async () => {
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
      execute: vi.fn((sql: string) => {
        queries.push(sql);
        if (sql.startsWith("SELECT bytes")) return Promise.resolve([[]]);
        return Promise.resolve([{ affectedRows: 1 }]);
      }),
    };
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.resolve(connection)),
      end: vi.fn(() => Promise.resolve()),
    } as never);
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(new TypeRegistry([StringValueSchema, Int32ValueSchema]));
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/direct-records" })
      .setStringifierRegistry(stringifiers)
      .setTableName(InboxMessageSchema, "delivery_inbox_messages")
      .setTableName(ShardSessionRecordSchema, "delivery_shard_sessions")
      .build();
    const inbox = new InboxStorage({
      context: { name: "mysql-inbox", multitenant: false },
      storageFactory: factory,
    });
    const registry = new ShardedWorkRegistry({
      context: { name: "mysql-shard", multitenant: false },
      storageFactory: factory,
      now: () => new Date(1_000),
    });
    await inbox.write(message());
    await registry.pickUp(
      ShardIndex.single(),
      create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" }),
    );
    const schema = queries.join("\n");
    expect(schema).toContain("`delivery_inbox_messages`");
    expect(schema).toContain("`delivery_shard_sessions`");
    expect(schema).not.toContain("delivery_tenants");
    expect(schema).not.toContain("provider-inbox");
    expect(schema).not.toContain("provider-shard");

    factory.close();
  });
});

function message() {
  return {
    id: { value: "provider-message", shard: new ShardIndex(0, 1) },
    inboxId: {
      targetId: Identifiers.pack("int32", 42),
      targetTypeUrl: "type.spine.io/test.Entity",
    },
    signalId: "signal",
    signal: create(AnySchema, {
      typeUrl: "type.spine.io/spine.core.Command",
      value: toBinary(CommandSchema, create(CommandSchema)),
    }),
    label: "HANDLE_COMMAND" as const,
    status: "TO_DELIVER" as const,
    shard: new ShardIndex(0, 1),
    whenReceived: new Date(1_000),
    version: 1n,
  };
}
