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

import { StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { create, toBinary } from "@bufbuild/protobuf";
import { StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { DeliveryCleanupStorageFactories } from "@spine-event-engine/storage/provider";
import { RecordSpec } from "@spine-event-engine/storage";
import { beforeEach, describe, expect, it, vi } from "vitest";

const driver = vi.hoisted(() => {
  const rows = new Map<string, Uint8Array>();
  let commitFailure: Error | undefined;
  let action: { readonly sql: string; after: number; readonly run: () => void } | undefined;
  let failure: { readonly sql: string; after: number; readonly error: Error } | undefined;
  let blocker:
    { readonly sql: string; after: number; release: () => void; reached: () => void } | undefined;
  let blocked = Promise.resolve();
  let endFailure: Error | undefined;
  let transaction = false;
  let pending: (() => void)[] = [];
  let activeClients = 0;
  let drained: (() => void)[] = [];
  const query = vi.fn((sql: string, values: readonly unknown[] = []) => {
    if (action !== undefined && sql.includes(action.sql) && action.after-- === 1) {
      const next = action;
      action = undefined;
      next.run();
    }
    if (failure !== undefined && sql.includes(failure.sql) && failure.after-- === 1) {
      const next = failure.error;
      failure = undefined;
      return Promise.reject(next);
    }
    if (blocker !== undefined && sql.includes(blocker.sql) && blocker.after-- === 1) {
      const waiting = blocker;
      waiting.reached();
      return new Promise((resolve) => {
        waiting.release = () => {
          resolve({ rows: [] });
        };
      });
    }
    if (sql.includes("schemata")) return Promise.resolve({ rowCount: 1, rows: [] });
    if (sql.includes("columns WHERE")) return Promise.resolve({ rows: columns() });
    if (sql.includes("PRIMARY KEY"))
      return Promise.resolve({ rows: [{ column_name: "ID", ordinal_position: 1 }] });
    if (sql === "BEGIN") {
      transaction = true;
      pending = [];
      return Promise.resolve({ rows: [] });
    }
    if (sql === "ROLLBACK") {
      transaction = false;
      pending = [];
      return Promise.resolve({ rows: [] });
    }
    if (sql === "COMMIT" && commitFailure !== undefined) {
      const error = commitFailure;
      commitFailure = undefined;
      return Promise.reject(error);
    }
    if (sql === "COMMIT") {
      for (const change of pending) change();
      transaction = false;
      pending = [];
      return Promise.resolve({ rows: [] });
    }
    if (sql.startsWith('SELECT "bytes"')) {
      const bytes = rows.get(String(values[0]));
      return Promise.resolve({ rows: bytes === undefined ? [] : [{ bytes }] });
    }
    if (sql.startsWith("DELETE")) {
      const id = String(values[0]);
      const deleted = rows.has(id);
      if (transaction && deleted) pending.push(() => rows.delete(id));
      else rows.delete(id);
      return Promise.resolve({ rowCount: deleted ? 1 : 0, rows: [] });
    }
    if (sql.startsWith("INSERT")) {
      const id = String(values[0]);
      const bytes = values[1] as Uint8Array;
      if (transaction) pending.push(() => rows.set(id, bytes));
      else rows.set(id, bytes);
      return Promise.resolve({ rowCount: 1, rows: [] });
    }
    return Promise.resolve({ rowCount: 0, rows: [] });
  });
  const release = vi.fn(() => {
    activeClients -= 1;
    if (activeClients === 0) for (const resolve of drained.splice(0)) resolve();
  });
  const connect = vi.fn(() => {
    activeClients += 1;
    return Promise.resolve({ query, release });
  });
  const end = vi.fn(() => {
    if (endFailure !== undefined) return Promise.reject(endFailure);
    if (activeClients === 0) return Promise.resolve();
    return new Promise<void>((resolve) => drained.push(resolve));
  });
  const Pool = vi.fn(function Pool() {
    return { connect, end };
  });
  return {
    Pool,
    connect,
    query,
    set: (id: string, record: StringValue) => rows.set(id, toBinary(StringValueSchema, record)),
    has: (id: string) => rows.has(id),
    reset: () => {
      rows.clear();
      commitFailure = undefined;
      action = undefined;
      failure = undefined;
      blocker = undefined;
      blocked = Promise.resolve();
      endFailure = undefined;
      transaction = false;
      pending = [];
      activeClients = 0;
      drained = [];
      query.mockClear();
      connect.mockClear();
      release.mockClear();
      end.mockClear();
    },
    failCommit: (error: Error) => (commitFailure = error),
    actOn: (sql: string, run: () => void, after = 1) => (action = { sql, after, run }),
    failOn: (sql: string, error: Error, after = 1) => (failure = { sql, error, after }),
    failEnd: (error: Error) => (endFailure = error),
    blockOn: (sql: string, after = 1) => {
      let reached: () => void = () => undefined;
      blocked = new Promise<void>((resolve) => (reached = resolve));
      blocker = { sql, after, reached, release: () => undefined };
    },
    unblock: () => {
      blocker?.release();
      blocker = undefined;
    },
    waitUntilBlocked: () => blocked,
    waitUntilDrained: () =>
      activeClients === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => drained.push(resolve)),
    end,
  };
});

vi.mock("pg", () => ({ Pool: driver.Pool }));

import { PostgresStorageFactory } from "../src/index.js";

describe("PostgreSQL delivery cleanup", () => {
  beforeEach(() => {
    driver.reset();
  });

  it("registers a factory-managed delivery cleanup handle", async () => {
    const factory = await postgresFactory();

    expect(() => DeliveryCleanupStorageFactories.create(factory)).not.toThrow();
  });

  it("uses the ordinary session-record lock before exact Inbox deletion", async () => {
    const factory = await postgresFactory();
    const expected = create(StringValueSchema, { value: "active" });
    driver.set("session", expected);
    driver.set("inbox", expected);
    const cleanup = DeliveryCleanupStorageFactories.create(factory);

    await expect(cleanup.remove(cleanupInput(expected))).resolves.toBe(true);
    const cleanupLock = driver.query.mock.calls.find(([sql]) =>
      sql.includes("pg_advisory_xact_lock($1)"),
    )?.[1]?.[0];
    driver.query.mockClear();
    const records = factory.createRecordStorage({ name: "cleanup", multitenant: false }, spec);
    await records.compareAndSet("session", expected, expected);
    const mutationLock = driver.query.mock.calls.find(([sql]) =>
      sql.includes("pg_advisory_xact_lock($1)"),
    )?.[1]?.[0];

    expect(cleanupLock).toBe(mutationLock);
  });

  it("keeps the Inbox row when the session snapshot is stale", async () => {
    const factory = await postgresFactory();
    const expected = create(StringValueSchema, { value: "active" });
    driver.set("session", create(StringValueSchema, { value: "replaced" }));
    driver.set("inbox", expected);

    await expect(
      DeliveryCleanupStorageFactories.create(factory).remove(cleanupInput(expected)),
    ).resolves.toBe(false);
    expect(driver.query.mock.calls.some(([sql]) => sql.startsWith("DELETE"))).toBe(false);
  });

  it("fences cleanup from another factory after the session is replaced", async () => {
    const first = await postgresFactory();
    const second = await postgresFactory();
    const expected = create(StringValueSchema, { value: "active" });
    const replacement = create(StringValueSchema, { value: "replaced" });
    driver.set("session", expected);
    driver.set("inbox", expected);
    const sessions = first.createRecordStorage(
      { name: "cleanup", multitenant: false },
      sessionSpec,
    );

    await expect(sessions.compareAndSet("session", expected, replacement)).resolves.toBe(true);
    await expect(
      DeliveryCleanupStorageFactories.create(second).remove(cleanupInput(expected)),
    ).resolves.toBe(false);

    expect(driver.has("inbox")).toBe(true);
  });

  it("keeps the Inbox row when the current session differs from the expected snapshot", async () => {
    const factory = await postgresFactory();
    const expected = create(StringValueSchema, { value: "active" });
    driver.set("session", create(StringValueSchema, { value: "active-new" }));
    driver.set("inbox", expected);

    await expect(
      DeliveryCleanupStorageFactories.create(factory).remove({
        ...cleanupInput(expected),
        session: { ...cleanupInput(expected).session, isCurrent: () => true },
      }),
    ).resolves.toBe(false);

    expect(driver.has("inbox")).toBe(true);
  });

  it.each([
    ["missing", undefined],
    ["replaced", create(StringValueSchema, { value: "other" })],
  ])("keeps the Inbox row when its expected snapshot is %s", async (_name, actual) => {
    const factory = await postgresFactory();
    const expected = create(StringValueSchema, { value: "active" });
    driver.set("session", expected);
    if (actual !== undefined) driver.set("inbox", actual);

    await expect(
      DeliveryCleanupStorageFactories.create(factory).remove(cleanupInput(expected)),
    ).resolves.toBe(false);

    expect(driver.has("inbox")).toBe(actual !== undefined);
  });

  it("declines cancellation before opening cleanup record families", async () => {
    const factory = await postgresFactory();
    const expected = create(StringValueSchema, { value: "active" });
    const before = driver.connect.mock.calls.length;

    await expect(
      DeliveryCleanupStorageFactories.create(factory).remove({
        ...cleanupInput(expected),
        operation: { signal: { aborted: true } },
      }),
    ).resolves.toBe(false);
    expect(driver.connect).toHaveBeenCalledTimes(before);
  });

  it("stops after the session lock when cleanup is cancelled", async () => {
    const factory = await postgresFactory();
    const expected = create(StringValueSchema, { value: "active" });
    let active = true;
    driver.set("session", expected);
    driver.set("inbox", expected);
    driver.actOn("pg_advisory_xact_lock", () => (active = false), 3);

    await expect(
      DeliveryCleanupStorageFactories.create(factory).remove({
        ...cleanupInput(expected),
        operation: { isActive: () => active },
      }),
    ).resolves.toBe(false);

    expect(
      driver.query.mock.calls.filter(([sql]) => sql.startsWith('SELECT "bytes"')),
    ).toHaveLength(0);
    expect(driver.has("inbox")).toBe(true);
  });

  it("stops after reading the session when cleanup is cancelled", async () => {
    const factory = await postgresFactory();
    const expected = create(StringValueSchema, { value: "active" });
    let active = true;
    driver.set("session", expected);
    driver.set("inbox", expected);
    driver.actOn('SELECT "bytes"', () => (active = false));

    await expect(
      DeliveryCleanupStorageFactories.create(factory).remove({
        ...cleanupInput(expected),
        operation: { isActive: () => active },
      }),
    ).resolves.toBe(false);

    expect(
      driver.query.mock.calls.filter(([sql]) => sql.startsWith('SELECT "bytes"')),
    ).toHaveLength(1);
    expect(driver.has("inbox")).toBe(true);
  });

  it.each(["40001", "40P01"])(
    "retries PostgreSQL %s without publishing the failed deletion",
    async (code) => {
      const factory = await postgresFactory();
      const expected = create(StringValueSchema, { value: "active" });
      driver.set("session", expected);
      driver.set("inbox", expected);
      driver.failCommit(Object.assign(new Error("retry"), { code }));
      const before = driver.connect.mock.calls.length;

      await expect(
        DeliveryCleanupStorageFactories.create(factory).remove(cleanupInput(expected)),
      ).resolves.toBe(true);
      expect(driver.connect).toHaveBeenCalledTimes(before + 4);
      expect(driver.query.mock.calls.filter(([sql]) => sql === "ROLLBACK")).toHaveLength(1);
      expect(driver.has("inbox")).toBe(false);
    },
  );

  it("rolls back a staged deletion when cleanup is cancelled before commit", async () => {
    const factory = await postgresFactory();
    const expected = create(StringValueSchema, { value: "active" });
    let active = true;
    driver.set("session", expected);
    driver.set("inbox", expected);
    driver.actOn("DELETE", () => (active = false));

    await expect(
      DeliveryCleanupStorageFactories.create(factory).remove({
        ...cleanupInput(expected),
        operation: { isActive: () => active },
      }),
    ).resolves.toBe(false);

    expect(driver.query.mock.calls.filter(([sql]) => sql === "ROLLBACK")).toHaveLength(1);
    expect(driver.has("inbox")).toBe(true);
  });

  it("does not retry an ordinary deletion error", async () => {
    const factory = await postgresFactory();
    const expected = create(StringValueSchema, { value: "active" });
    driver.set("session", expected);
    driver.set("inbox", expected);
    driver.failOn("DELETE", new Error("database unavailable"));
    const before = driver.connect.mock.calls.length;

    await expect(
      DeliveryCleanupStorageFactories.create(factory).remove(cleanupInput(expected)),
    ).rejects.toThrow("PostgreSQL delivery cleanup failed");

    expect(driver.connect).toHaveBeenCalledTimes(before + 3);
    expect(driver.query.mock.calls.filter(([sql]) => sql === "ROLLBACK")).toHaveLength(1);
    expect(driver.has("inbox")).toBe(true);
  });

  it.each([
    ["begin", "BEGIN", 3],
    ["session lock", "pg_advisory_xact_lock", 3],
    ["session read", 'SELECT "bytes"', 1],
    ["Inbox read", 'SELECT "bytes"', 2],
    ["Inbox delete", "DELETE", 1],
    ["commit", "COMMIT", 3],
  ])("rolls back and preserves Inbox after a failed %s boundary", async (_name, sql, after) => {
    const factory = await postgresFactory();
    const expected = create(StringValueSchema, { value: "active" });
    driver.set("session", expected);
    driver.set("inbox", expected);
    driver.failOn(sql, new Error("boundary failure"), after);

    await expect(
      DeliveryCleanupStorageFactories.create(factory).remove(cleanupInput(expected)),
    ).rejects.toThrow("PostgreSQL delivery cleanup failed");

    expect(driver.query.mock.calls.filter(([query]) => query === "ROLLBACK")).toHaveLength(1);
    expect(driver.has("inbox")).toBe(true);
  });

  it("rejects cleanup started after its handle or factory is closed", async () => {
    const factory = await postgresFactory();
    const expected = create(StringValueSchema, { value: "active" });
    const cleanup = DeliveryCleanupStorageFactories.create(factory);
    cleanup.close();
    const before = driver.connect.mock.calls.length;

    await expect(cleanup.remove(cleanupInput(expected))).rejects.toThrow(
      "cleanup storage is closed",
    );
    factory.close();

    expect(() => DeliveryCleanupStorageFactories.create(factory)).toThrow(
      "StorageFactory is closed",
    );
    expect(driver.connect).toHaveBeenCalledTimes(before);
  });

  it("lets an acquired cleanup finish before the factory drains its pool", async () => {
    const factory = await postgresFactory();
    const expected = create(StringValueSchema, { value: "active" });
    driver.set("session", expected);
    driver.set("inbox", expected);
    driver.blockOn("pg_advisory_xact_lock", 3);
    const cleanup = DeliveryCleanupStorageFactories.create(factory);
    const removal = cleanup.remove(cleanupInput(expected));
    await driver.waitUntilBlocked();

    factory.close();
    await expect(cleanup.remove(cleanupInput(expected))).rejects.toThrow(
      "cleanup storage is closed",
    );
    expect(driver.end).toHaveBeenCalledOnce();
    driver.unblock();

    await expect(removal).resolves.toBe(true);
    await driver.waitUntilDrained();
    expect(driver.has("inbox")).toBe(false);
  });

  it("contains one failed pool drain after idempotent handle and factory closure", async () => {
    const factory = await postgresFactory();
    const cleanup = DeliveryCleanupStorageFactories.create(factory);
    driver.failEnd(new Error("pool drain failed"));

    cleanup.close();
    cleanup.close();
    factory.close();
    factory.close();
    await Promise.resolve();
    await Promise.resolve();

    expect(driver.end).toHaveBeenCalledOnce();
  });
});

const spec = new RecordSpec({
  sourceType: StringValueSchema,
  recordType: StringValueSchema,
  idKind: "string",
  extractId: (record) => record.value,
});

const sessionSpec = new RecordSpec({
  sourceType: StringValueSchema,
  recordType: StringValueSchema,
  idKind: "string",
  extractId: () => "session",
});

function cleanupInput(expected: StringValue) {
  return {
    context: { name: "cleanup", multitenant: false } as const,
    inbox: { spec, id: "inbox", expected },
    session: {
      spec: sessionSpec,
      id: "session",
      expected,
      isCurrent: (record: StringValue) => record.value === "active",
    },
  };
}

function columns() {
  return [
    {
      column_name: "ID",
      data_type: "character varying",
      character_maximum_length: 512,
      is_nullable: "NO",
      column_default: null,
    },
    {
      column_name: "bytes",
      data_type: "bytea",
      character_maximum_length: null,
      is_nullable: "NO",
      column_default: null,
    },
  ];
}

function postgresFactory(): Promise<PostgresStorageFactory> {
  const strings = new StringifierRegistry();
  strings.setTypeRegistry(new TypeRegistry([StringValueSchema]));
  return PostgresStorageFactory.newBuilder()
    .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
    .setStringifierRegistry(strings)
    .build();
}
