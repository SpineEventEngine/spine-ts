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
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { toBinary } from "@bufbuild/protobuf";
import { AnyPacker, StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { EventSchema } from "@spine-event-engine/proto";
import { InboxMessageSchema, ShardSessionRecordSchema } from "@spine-event-engine/proto/delivery";
import type { StorageFactory } from "@spine-event-engine/storage";
import { MysqlStorageFactory } from "@spine-event-engine/storage-mysql";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { createConnection } from "mysql2/promise";
import { describe, expect, it } from "vitest";

import { TaskListIdSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { Delivery as CoreDelivery } from "../../src/delivery/delivery.js";
import { Inbox } from "../../src/delivery/inbox.js";
import { InboxStorage } from "../../src/delivery/inbox-storage.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import { ShardedWorkRegistry } from "../../src/delivery/sharded-work-registry.js";
import type {
  DeliveryWorkRegistry,
  DeliveryWorkSession,
  LeasedDeliveryWorkSession,
} from "../../src/delivery/delivery-ports.js";
import type { WorkerId } from "@spine-event-engine/proto/delivery";
import { createMessage } from "./inbox-message-fixture.js";

interface SqlClient {
  query(statement: string): Promise<unknown>;
  end(): Promise<void>;
}

const provider = process.env.SPINE_TS_INBOX_PROVIDER;
const execFileAsync = promisify(execFile);
const rootUrl =
  provider === "postgresql"
    ? process.env.SPINE_TS_POSTGRESQL_URL
    : provider === "mysql"
      ? process.env.SPINE_TS_MYSQL_URL
      : undefined;
if (rootUrl === undefined)
  throw new Error(
    "Select a SQL Inbox provider and its task database URL for recovery-clock tests.",
  );

describe("live SQL custom post-release observation", () => {
  it.each(["before", "after"] as const)(
    "rediscovers a separate-process write $phase the final shard release",
    async (phase) => {
      await withSqlInbox(async (fixture) => {
        const { context, databaseUrl, factory, inbox, inboxTable, sessionTable } = fixture;
        const shard = ShardIndex.single();
        const first = createMessage(randomUUID(), randomUUID(), 1n, new Date());
        await inbox.storage.write(first);
        const registry = new ShardedWorkRegistry({ context, storageFactory: factory });
        const gate = new ReleaseGateRegistry(registry, phase);
        const delivered: string[] = [];
        const observed: string[] = [];
        const delivery = new CoreDelivery({
          context,
          storageFactory: factory,
          inbox,
          workRegistry: gate,
        });
        delivery.setDispatcher((message) => {
          delivered.push(message.signalId);
        });
        delivery.setShardObserver((message) => {
          observed.push(message.signalId);
          void delivery.deliverMessagesFrom(message.shard);
        });
        try {
          const firstRun = delivery.deliverMessagesFrom(shard);
          await awaitGate(gate.entered.promise);
          if (phase === "after") await awaitGate(gate.delegated.promise);
          const signalId = randomUUID();
          const writer = await execFileAsync(
            process.execPath,
            [
              fileURLToPath(new URL("./sql-recovery-writer.mjs", import.meta.url)),
              JSON.stringify({
                postgres: provider === "postgresql",
                contextName: context.name,
                inboxTable,
                sessionTable,
                taskListId: "list-1",
                taskId: randomUUID(),
                signalId,
                attemptPickup: phase === "before",
              }),
            ],
            {
              env: { ...process.env, SPINE_TS_RECOVERY_WRITE_URL: databaseUrl },
              timeout: 5_000,
              maxBuffer: 65_536,
            },
          );
          const write = JSON.parse(writer.stdout.trim()) as {
            id: string;
            signalId: string;
            eventHex: string;
            pid: number;
            pickup: "BLOCKED" | "ACQUIRED" | "NOT_ATTEMPTED";
          };
          expect(write.signalId).toBe(signalId);
          expect(write.pid).not.toBe(process.pid);
          expect(write.pickup).toBe(phase === "before" ? "BLOCKED" : "NOT_ATTEMPTED");
          const pending = await inbox.readMessage({ value: write.id, shard });
          expect(pending?.status).toBe("TO_DELIVER");
          const event = pending?.signal && AnyPacker.tryUnpack(pending.signal, EventSchema);
          if (event === undefined) throw new Error("Cross-process Inbox Event is missing.");
          expect(Buffer.from(toBinary(EventSchema, event)).toString("hex")).toBe(write.eventHex);
          expect(delivered).toEqual([first.signalId]);
          gate.resume.resolve(undefined);
          await firstRun;
          await waitFor(() => delivered.length === 2, 3_000);
          expect(observed).toEqual([signalId]);
          expect(delivered).toEqual([first.signalId, signalId]);
          expect(gate.releasedResult).toBe(true);
        } finally {
          gate.resume.resolve(undefined);
          await delivery.close();
          await registry.close();
        }
      });
    },
    12_000,
  );
});

async function withSqlInbox(
  run: (fixture: {
    context: { readonly name: string; readonly multitenant: false };
    database: string;
    databaseUrl: string;
    factory: StorageFactory;
    inbox: Inbox;
    inboxTable: string;
    sessionTable: string;
  }) => Promise<void>,
): Promise<void> {
  if (rootUrl === undefined) throw new Error("The task SQL URL is required.");
  const postgres = provider === "postgresql";
  const database = `sqlrel_clock_${randomUUID().replaceAll("-", "")}`;
  const quoted = postgres ? `"${database}"` : `\`${database}\``;
  const admin = await connect(rootUrl, postgres);
  let created = false;
  let sql: SqlClient | undefined;
  let factory: StorageFactory | undefined;
  let failure: unknown;
  try {
    await admin.query(`CREATE DATABASE ${quoted}`);
    created = true;
    const databaseUrl = new URL(rootUrl);
    databaseUrl.pathname = `/${database}`;
    sql = await connect(databaseUrl.href, postgres);
    const registry = new StringifierRegistry();
    registry.setTypeRegistry(new TypeRegistry([TaskListIdSchema]));
    const inboxTable = `clock_inbox_${randomUUID().slice(0, 8)}`;
    const sessionTable = `clock_session_${randomUUID().slice(0, 8)}`;
    factory = postgres
      ? await PostgresStorageFactory.newBuilder()
          .setOptions({ url: databaseUrl.href })
          .setStringifierRegistry(registry)
          .setTableName(InboxMessageSchema, inboxTable)
          .setTableName(ShardSessionRecordSchema, sessionTable)
          .build()
      : await MysqlStorageFactory.newBuilder()
          .setOptions({ url: databaseUrl.href })
          .setStringifierRegistry(registry)
          .setTableName(InboxMessageSchema, inboxTable)
          .setTableName(ShardSessionRecordSchema, sessionTable)
          .build();
    const context = { name: `clock-${database}`, multitenant: false } as const;
    await run({
      context,
      database,
      databaseUrl: databaseUrl.href,
      factory,
      inbox: new Inbox(new InboxStorage({ context, storageFactory: factory })),
      inboxTable,
      sessionTable,
    });
  } catch (error) {
    failure = error;
  }
  const cleanupFailures: unknown[] = [];
  try {
    await factory?.close();
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    await sql?.end();
  } catch (error) {
    cleanupFailures.push(error);
  }
  if (created) {
    try {
      await dropDatabaseAfterDrain(admin, `DROP DATABASE ${quoted}`, 5_000);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  try {
    await admin.end();
  } catch (error) {
    cleanupFailures.push(error);
  }
  const failures = [...(failure === undefined ? [] : [failure]), ...cleanupFailures];
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "Recovery clock test or SQL cleanup failed.");
}

async function dropDatabaseAfterDrain(
  admin: SqlClient,
  statement: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const attempts: unknown[] = [];
  do {
    try {
      await admin.query(statement);
      return;
    } catch (error) {
      attempts.push(error);
      if (Date.now() >= deadline) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  } while (Date.now() < deadline);
  throw new AggregateError(attempts, "Disposable SQL database did not drain and drop.");
}

async function connect(url: string, postgres: boolean): Promise<SqlClient> {
  if (!postgres) return createConnection(url);
  const pg = createRequire(new URL("../../../storage-postgres/package.json", import.meta.url))(
    "pg",
  ) as {
    Client: new (options: { connectionString: string }) => SqlClient & { connect(): Promise<void> };
  };
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

async function waitFor(predicate: () => boolean, deadlineMs: number): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Durable SQL work missed the recovery deadline.");
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

async function awaitGate(gate: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      gate,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("SQL release gate did not enter."));
        }, 3_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

class ReleaseGateRegistry implements DeliveryWorkRegistry {
  readonly sessionKind = "LEASED" as const;
  readonly entered = Promise.withResolvers<undefined>();
  readonly delegated = Promise.withResolvers<undefined>();
  readonly resume = Promise.withResolvers<undefined>();
  readonly #delegate: ShardedWorkRegistry;
  readonly #phase: "before" | "after";
  delegatedCount = 0;
  releasedResult: boolean | undefined;
  #first = true;

  constructor(delegate: ShardedWorkRegistry, phase: "before" | "after") {
    this.#delegate = delegate;
    this.#phase = phase;
  }

  pickUp(shard: ShardIndex, worker: WorkerId): Promise<DeliveryWorkSession | undefined> {
    return this.#delegate.pickUp(shard, worker);
  }

  renew(session: LeasedDeliveryWorkSession): Promise<LeasedDeliveryWorkSession | undefined> {
    return this.#delegate.renew(session);
  }

  validateOwnership(session: DeliveryWorkSession): Promise<DeliveryWorkSession | undefined> {
    if (session.kind !== "LEASED") return Promise.resolve(undefined);
    return this.#delegate.validateOwnership(session);
  }

  async release(session: DeliveryWorkSession): Promise<boolean> {
    if (session.kind !== "LEASED") return false;
    if (!this.#first) return this.#delegate.release(session);
    this.#first = false;
    this.entered.resolve(undefined);
    if (this.#phase === "before") await this.resume.promise;
    const released = await this.#delegate.release(session);
    this.releasedResult = released;
    this.delegatedCount++;
    this.delegated.resolve(undefined);
    if (this.#phase === "after") await this.resume.promise;
    return released;
  }
}
