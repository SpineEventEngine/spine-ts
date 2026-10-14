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
import { createRequire } from "node:module";
import { create } from "@bufbuild/protobuf";
import { AnyMessages, StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { InboxMessageSchema, ShardSessionRecordSchema } from "@spine-event-engine/proto/delivery";
import { type StorageFactory } from "@spine-event-engine/storage";
import { MysqlStorageFactory } from "@spine-event-engine/storage-mysql";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { createConnection } from "mysql2/promise";
import { describe, expect, it } from "vitest";

import { DeliveryBuilder } from "../../src/delivery/delivery-builder.js";
import {
  DeliveryMonitor,
  type DeliveryStatistics,
  type FailedReception,
} from "../../src/delivery/delivery-monitor.js";
import { Inbox } from "../../src/delivery/inbox.js";
import { InboxStorage } from "../../src/delivery/inbox-storage.js";
import { TaskListIdSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { createMessage } from "./inbox-message-fixture.js";

interface SqlClient {
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}

const selected = process.env.SPINE_TS_INBOX_PROVIDER;
const url =
  selected === "postgresql"
    ? process.env.SPINE_TS_POSTGRESQL_URL
    : selected === "mysql"
      ? process.env.SPINE_TS_MYSQL_URL
      : undefined;
if (selected !== "postgresql" && selected !== "mysql")
  throw new Error("SPINE_TS_INBOX_PROVIDER must select postgresql or mysql for live faults.");
if (url === undefined) throw new Error(`The selected ${selected} SQL URL is required.`);

describe("live SQL Inbox delivery faults", () => {
  it("attempts exact database removal after both factory and SQL connection close fail", async () => {
    const calls: string[] = [];
    const factoryFailure = new Error("factory close failed");
    const connectionFailure = new Error("connection close failed");
    const database = `sqlrel_delivery_${"a".repeat(32)}`;
    const failures = await releaseSqlResources({
      factory: {
        close: () => {
          calls.push("factory.close");
          throw factoryFailure;
        },
      },
      sql: {
        query: () => Promise.resolve(undefined),
        end: () => {
          calls.push("sql.end");
          return Promise.reject(connectionFailure);
        },
      },
      admin: {
        query: (statement) => {
          calls.push(statement);
          return Promise.resolve(undefined);
        },
        end: () => {
          calls.push("admin.end");
          return Promise.resolve();
        },
      },
      database,
      postgres: true,
    });
    expect(calls).toEqual(["factory.close", "sql.end", `DROP DATABASE "${database}"`, "admin.end"]);
    expect(failures).toEqual([factoryFailure, connectionFailure]);
  });

  it("retains a failed recipient while delivering an unrelated recipient", async () => {
    await withSqlDelivery(async ({ build, inbox }) => {
      const failed = createMessage(`failed-${randomUUID()}`, `event-${randomUUID()}`, 1n);
      const unrelated = {
        ...createMessage(`unrelated-${randomUUID()}`, `event-${randomUUID()}`, 2n),
        inboxId: {
          targetId: AnyMessages.pack(
            TaskListIdSchema,
            create(TaskListIdSchema, { value: "other-task-list" }),
          ),
          targetTypeUrl: failed.inboxId.targetTypeUrl,
        },
      };
      await inbox.storage.write(failed);
      await inbox.storage.write(unrelated);
      const entries: string[] = [];
      let statistics: DeliveryStatistics | undefined;
      const monitor = new (class extends DeliveryMonitor {
        override onDeliveryCompleted(value: DeliveryStatistics): void {
          statistics = value;
        }
      })();
      const result = await build(monitor).run({
        onMessage: (message) => {
          entries.push(message.id.value);
          if (message.id.value === failed.id.value) throw new Error("task processing failure");
        },
      });
      expect(result.status).toBe("COMPLETED");
      expect(entries).toEqual([failed.id.value, unrelated.id.value]);
      expect(statistics).toMatchObject({ processed: 2, delivered: 1, failed: 1 });
      expect(await inbox.readMessage(failed.id)).toMatchObject({ status: "TO_DELIVER" });
      expect(await inbox.readMessage(unrelated.id)).toBeUndefined();
    });
  });

  it.each([
    { policy: "throwing-monitor", expectedEntries: 1, expectedStatus: "TO_DELIVER" },
    { policy: "failed-repeat", expectedEntries: 2, expectedStatus: "TO_DELIVER" },
    { policy: "successful-repeat", expectedEntries: 2, expectedStatus: undefined },
  ] as const)(
    "applies $policy without silently acknowledging a failed SQL Inbox row",
    async ({ policy, expectedEntries, expectedStatus }) => {
      await withSqlDelivery(async ({ build, inbox }) => {
        const message = createMessage(`policy-${randomUUID()}`, `event-${randomUUID()}`, 1n);
        await inbox.storage.write(message);
        let entries = 0;
        const monitor = new (class extends DeliveryMonitor {
          override onReceptionFailure(failure: FailedReception) {
            if (policy === "throwing-monitor") throw new Error("monitor failed");
            return failure.repeatDispatching();
          }
        })();
        const result = await build(monitor).run({
          onMessage: () => {
            entries += 1;
            if (policy !== "successful-repeat" || entries === 1)
              throw new Error("task processing failed");
          },
        });

        expect(result.status).toBe("COMPLETED");
        expect(entries).toBe(expectedEntries);
        const remaining = await inbox.readMessage(message.id);
        expect(remaining?.status).toBe(expectedStatus);
      });
    },
  );

  it.each([
    { failures: 2, expectedStatus: undefined, monitorCalls: 0 },
    { failures: 9, expectedStatus: "TO_DELIVER", monitorCalls: 1 },
  ] as const)(
    "does not rerun successful processing when SQL acknowledgement rejects $failures attempts",
    async ({ failures, expectedStatus, monitorCalls }) => {
      await withSqlDelivery(async ({ build, inbox, sql, inboxTable, postgres }) => {
        const message = createMessage(`ack-${randomUUID()}`, `event-${randomUUID()}`, 1n);
        await inbox.storage.write(message);
        await installAckFault(sql, inboxTable, postgres, failures);
        let handlerEntries = 0;
        let observedFailures = 0;
        const observedCodes: (string | undefined)[] = [];
        const forbiddenRepeatOutcomes: unknown[] = [];
        const monitor = new (class extends DeliveryMonitor {
          override async onReceptionFailure(failure: FailedReception) {
            observedFailures += 1;
            observedCodes.push(causeCode(failure.error));
            forbiddenRepeatOutcomes.push(
              await failure
                .repeatDispatching()
                .execute()
                .then(
                  () => "resolved",
                  (error: unknown) => error,
                ),
            );
            return failure.leavePending();
          }
        })();
        const outcome = await build(monitor).run({
          onMessage: () => {
            handlerEntries += 1;
          },
        });

        expect(outcome.status).toBe("COMPLETED");
        expect(handlerEntries).toBe(1);
        expect(observedFailures).toBe(monitorCalls);
        expect(observedCodes).toEqual(
          monitorCalls === 0 ? [] : [postgres ? "40P01" : "ER_LOCK_DEADLOCK"],
        );
        expect(forbiddenRepeatOutcomes).toHaveLength(monitorCalls);
        if (monitorCalls === 1)
          expect(forbiddenRepeatOutcomes[0]).toMatchObject({
            message: "Successful processing cannot be dispatched again after ack failure.",
          });
        // MySQL retries a deadlock-class CAS three times inside each of the
        // Delivery worker's three acknowledgement attempts.
        expect(await ackAttempts(sql, postgres)).toBe(!postgres && failures === 9 ? 9 : 3);
        expect((await inbox.readMessage(message.id))?.status).toBe(expectedStatus);
      });
    },
  );
});

interface LiveDelivery {
  readonly build: (monitor?: DeliveryMonitor) => ReturnType<DeliveryBuilder["build"]>;
  readonly inbox: Inbox;
  readonly sql: SqlClient;
  readonly inboxTable: string;
  readonly postgres: boolean;
}

async function withSqlDelivery(run: (fixture: LiveDelivery) => Promise<void>): Promise<void> {
  if (url === undefined) throw new Error("The selected SQL URL is required.");
  const postgres = selected === "postgresql";
  const database = `sqlrel_delivery_${randomUUID().replaceAll("-", "")}`;
  const quoted = postgres ? `"${database}"` : `\`${database}\``;
  const admin = await connect(url, postgres);
  let sql: SqlClient | undefined;
  let factory: StorageFactory | undefined;
  let created = false;
  let testFailure: { error: unknown } | undefined;
  try {
    await admin.query(`CREATE DATABASE ${quoted}`);
    created = true;
    const databaseUrl = new URL(url);
    databaseUrl.pathname = `/${database}`;
    sql = await connect(databaseUrl.href, postgres);
    const registry = new StringifierRegistry();
    registry.setTypeRegistry(new TypeRegistry([TaskListIdSchema]));
    const inboxTable = `delivery_inbox_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const sessionTable = `delivery_session_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
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
    const context = { name: `delivery-fault-${database}`, multitenant: false } as const;
    const inbox = new Inbox(new InboxStorage({ context, storageFactory: factory }));
    const readyFactory = factory;
    const build = (monitor?: DeliveryMonitor) => {
      const builder = new DeliveryBuilder()
        .withContext(context)
        .withStorageFactory(readyFactory)
        .withInbox(inbox)
        .withNode(`node-${database}`);
      return (monitor === undefined ? builder : builder.withMonitor(monitor)).build();
    };
    await run({ build, inbox, sql, inboxTable, postgres });
  } catch (error) {
    testFailure = { error };
  }
  const cleanupFailures = await releaseSqlResources({
    factory,
    sql,
    admin,
    ...(created ? { database } : {}),
    postgres,
  });
  const failures = [...(testFailure === undefined ? [] : [testFailure.error]), ...cleanupFailures];
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "Live SQL delivery test or resource cleanup failed.");
}

async function releaseSqlResources(options: {
  readonly factory?: Pick<StorageFactory, "close"> | undefined;
  readonly sql?: SqlClient | undefined;
  readonly admin: SqlClient;
  readonly database?: string;
  readonly postgres: boolean;
}): Promise<readonly unknown[]> {
  const failures: unknown[] = [];
  try {
    options.factory?.close();
  } catch (error) {
    failures.push(error);
  }
  try {
    await options.sql?.end();
  } catch (error) {
    failures.push(error);
  }
  try {
    const database = options.database;
    if (database !== undefined) {
      if (!/^sqlrel_delivery_[0-9a-f]{32}$/u.test(database))
        throw new Error("Refusing to remove an unexpected SQL delivery test database.");
      const quoted = options.postgres ? `"${database}"` : `\`${database}\``;
      await options.admin.query(`DROP DATABASE ${quoted}`);
    }
  } catch (error) {
    failures.push(error);
  }
  try {
    await options.admin.end();
  } catch (error) {
    failures.push(error);
  }
  return failures;
}

async function connect(connectionUrl: string, postgres: boolean): Promise<SqlClient> {
  if (!postgres) return createConnection(connectionUrl);
  const requirePg = createRequire(
    new URL("../../../storage-postgres/package.json", import.meta.url),
  );
  const pgModule: unknown = requirePg("pg");
  const Client = (pgModule as { Client: new (config: { connectionString: string }) => SqlClient })
    .Client;
  const client = new Client({ connectionString: connectionUrl });
  await (client as SqlClient & { connect(): Promise<void> }).connect();
  return client;
}

async function installAckFault(
  sql: SqlClient,
  inboxTable: string,
  postgres: boolean,
  failures: number,
): Promise<void> {
  if (postgres) {
    await sql.query("CREATE SEQUENCE ack_attempts");
    await sql.query(`CREATE FUNCTION fail_ack() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF nextval('ack_attempts') <= ${String(failures)} THEN
          RAISE EXCEPTION USING ERRCODE = '40P01', MESSAGE = 'task injected ack failure';
        END IF;
        RETURN NEW;
      END $$`);
    await sql.query(
      `CREATE TRIGGER ack_failure BEFORE UPDATE ON "${inboxTable}" ` +
        "FOR EACH ROW EXECUTE FUNCTION fail_ack()",
    );
    return;
  }
  await sql.query(
    "CREATE TABLE ack_attempts(id integer PRIMARY KEY, attempts integer NOT NULL) ENGINE=MyISAM",
  );
  await sql.query("INSERT INTO ack_attempts VALUES (1, 0)");
  await sql.query(`CREATE TRIGGER ack_failure BEFORE UPDATE ON \`${inboxTable}\` FOR EACH ROW
    BEGIN
      UPDATE ack_attempts SET attempts = attempts + 1 WHERE id = 1;
      IF (SELECT attempts FROM ack_attempts WHERE id = 1) <= ${String(failures)} THEN
        SIGNAL SQLSTATE '40001' SET MYSQL_ERRNO = 1213,
          MESSAGE_TEXT = 'task injected ack failure';
      END IF;
    END`);
}

async function ackAttempts(sql: SqlClient, postgres: boolean): Promise<number> {
  const result = await sql.query(
    postgres
      ? "SELECT last_value AS attempts FROM ack_attempts"
      : "SELECT attempts FROM ack_attempts",
  );
  const rows = postgres
    ? (result as { rows: readonly { attempts: number | string }[] }).rows
    : (result as [readonly { attempts: number | string }[]])[0];
  const value = rows[0]?.attempts;
  if (value === undefined) throw new Error("Expected a durable SQL acknowledgement counter.");
  return Number(value);
}

function causeCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== "object" || current === null) return undefined;
    const value = current as { code?: unknown; cause?: unknown };
    if (typeof value.code === "string") return value.code;
    current = value.cause;
  }
  return undefined;
}
