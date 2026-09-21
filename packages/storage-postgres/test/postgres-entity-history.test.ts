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
import {
  AnySchema,
  StringValueSchema,
  TimestampSchema,
  type StringValue,
} from "@bufbuild/protobuf/wkt";
import { Identifiers, StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { EventSchema, type Event } from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { RecordSpec } from "@spine-event-engine/storage";
import type { EntityStorageInput } from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";

import { entityStorage } from "./postgres-entity-seam.js";

const driver = vi.hoisted(() => {
  const calls: { client: number; sql: string; values: readonly unknown[] }[] = [];
  const keyPages: unknown[][] = [];
  const lockFailures: { sql: string; error: Error }[] = [];
  let stateRows: { ID: string; version: number; created: bigint }[] | undefined;
  const unlocks: (false | Error)[] = [];
  let deleteHook: (() => Promise<unknown>) | undefined;
  let historyRecords: readonly { readonly bytes: Uint8Array; readonly ID?: string }[] = [];
  let highWater:
    { readonly created: bigint; readonly version: number; readonly ID: string } | undefined = {
    created: 1n,
    version: 2,
    ID: "high-water",
  };
  let nextClient = 0;
  const locks = new Map<string, { exclusive?: number; shared: Set<number> }>();
  const held = new Map<number, { key: string; shared: boolean; transaction: boolean }[]>();
  const waiting: {
    readonly lock: { client: number; key: string; shared: boolean; transaction: boolean };
    readonly resolve: (value: { rows: never[] }) => void;
  }[] = [];
  const query = (client: number, sql: string, values: readonly unknown[] = []) => {
    calls.push({ client, sql, values });
    if (sql === "COMMIT" || sql === "ROLLBACK") releaseTransactions(client);
    const lock = lockRequest(sql, values, client);
    if (lock !== undefined) return acquire(lock);
    const unlock = unlockRequest(sql, values, client);
    if (unlock !== undefined) {
      releaseLock(unlock);
      const outcome = unlocks.shift();
      if (outcome instanceof Error) return Promise.reject(outcome);
      if (outcome === false) return Promise.resolve({ rows: [{ pg_advisory_unlock: false }] });
      return Promise.resolve({ rows: [{ pg_advisory_unlock: true }] });
    }
    if (sql.includes("schemata")) return Promise.resolve({ rowCount: 1, rows: [] });
    if (sql.includes("columns WHERE")) {
      if (values[1] === "google_protobuf_stringvalue")
        return Promise.resolve({
          rows: [
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
          ],
        });
      return Promise.resolve({
        rows: [
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
          {
            column_name: "entity_id",
            data_type: "text",
            character_maximum_length: null,
            is_nullable: "YES",
            column_default: null,
          },
          {
            column_name: "created",
            data_type: "bigint",
            character_maximum_length: null,
            is_nullable: "YES",
            column_default: null,
          },
          {
            column_name: "version",
            data_type: "integer",
            character_maximum_length: null,
            is_nullable: "YES",
            column_default: null,
          },
        ],
      });
    }
    if (sql.includes("PRIMARY KEY"))
      return Promise.resolve({ rows: [{ column_name: "ID", ordinal_position: 1 }] });
    if (sql.startsWith('SELECT "bytes"')) return Promise.resolve({ rows: historyRecords });
    if (sql.startsWith('SELECT "ID", "bytes"')) return Promise.resolve({ rows: historyRecords });
    if (sql.startsWith('SELECT "created"'))
      return Promise.resolve({ rows: highWater === undefined ? [] : [highWater] });
    if (sql.startsWith('SELECT "version", "created", "ID"') && stateRows !== undefined) {
      const offset = values[1] as number;
      const row = orderedStates()[offset];
      return Promise.resolve({ rows: row === undefined ? [] : [row] });
    }
    if (sql.startsWith('SELECT "version", "created", "ID"'))
      return Promise.resolve({ rows: [{ version: 1, created: 1n, ID: "retained-key" }] });
    if (sql.startsWith('SELECT "ID"')) {
      if (stateRows !== undefined) {
        const boundary = [values[1] as number, values[2] as bigint, values[3] as string] as const;
        const rows = orderedStates()
          .filter((row) => compareState(row, boundary) <= (sql.includes("<=") ? 0 : -1))
          .slice(0, values[4] as number);
        return Promise.resolve({ rows });
      }
      const keys = keyPages.shift() ?? ["retained-key"];
      return Promise.resolve({ rows: keys.map((ID) => ({ ID })) });
    }
    if (sql.startsWith("DELETE") && stateRows !== undefined) {
      const ids = new Set(values as string[]);
      stateRows = stateRows.filter(({ ID }) => !ids.has(ID));
      return Promise.resolve({ rowCount: ids.size, rows: [] });
    }
    if (sql.startsWith("DELETE") && deleteHook !== undefined) return deleteHook();
    return Promise.resolve({ rowCount: 1, rows: [] });
  };
  const releaseClient = vi.fn();
  const connect = vi.fn(() => {
    const client = nextClient++;
    return Promise.resolve({
      query: (sql: string, values: readonly unknown[] = []) => query(client, sql, values),
      release: (...args: unknown[]) => {
        releaseClient(...args);
        for (const lock of [...(held.get(client) ?? [])]) releaseLock({ client, ...lock });
      },
    });
  });
  const end = vi.fn(() => Promise.resolve());
  const Pool = vi.fn(function Pool() {
    return { connect, end };
  });
  return {
    Pool,
    calls,
    keyPages,
    setStateRows: (rows: readonly { ID: string; version: number; created: bigint }[]) =>
      (stateRows = [...rows]),
    clearStateRows: () => (stateRows = undefined),
    stateRows: () => stateRows ?? [],
    failUnlock: (outcome: false | Error) => unlocks.push(outcome),
    setHistoryRecords: (records: readonly { readonly bytes: Uint8Array; readonly ID?: string }[]) =>
      (historyRecords = records),
    setHighWater: (value: typeof highWater) => (highWater = value),
    setDeleteHook: (hook: (() => Promise<unknown>) | undefined) => (deleteHook = hook),
    release: releaseClient,
    failLock: (sql: string, error: Error) => lockFailures.push({ sql, error }),
  };

  function lockRequest(sql: string, values: readonly unknown[], client: number) {
    const shared =
      sql.includes("pg_advisory_xact_lock_shared") || sql.includes("pg_advisory_lock_shared");
    const transaction = sql.includes("pg_advisory_xact_lock");
    if (!transaction && !sql.includes("pg_advisory_lock")) return undefined;
    return { client, key: String(values[0]), shared, transaction };
  }

  function orderedStates() {
    return [...(stateRows ?? [])].sort(
      (left, right) =>
        right.version - left.version ||
        Number(right.created - left.created) ||
        right.ID.localeCompare(left.ID),
    );
  }

  function compareState(
    row: { ID: string; version: number; created: bigint },
    boundary: readonly [number, bigint, string],
  ): number {
    return (
      row.version - boundary[0] ||
      Number(row.created - boundary[1]) ||
      row.ID.localeCompare(boundary[2])
    );
  }

  function unlockRequest(sql: string, values: readonly unknown[], client: number) {
    if (!sql.includes("pg_advisory_unlock")) return undefined;
    return { client, key: String(values[0]), shared: sql.includes("_shared"), transaction: false };
  }

  function acquire(lock: { client: number; key: string; shared: boolean; transaction: boolean }) {
    const failure = lock.transaction
      ? -1
      : lockFailures.findIndex(
          ({ sql }) =>
            sql ===
            (lock.shared ? "SELECT pg_advisory_lock_shared($1)" : "SELECT pg_advisory_lock($1)"),
        );
    if (failure >= 0) return Promise.reject(lockFailures.splice(failure, 1)[0].error);
    if (available(lock)) {
      grant(lock);
      return Promise.resolve({ rows: [] });
    }
    return new Promise<{ rows: never[] }>((resolve) => {
      waiting.push({ lock, resolve });
    });
  }

  function available(lock: { client: number; key: string; shared: boolean }) {
    const entry = locks.get(lock.key);
    return (
      entry === undefined ||
      (lock.shared
        ? entry.exclusive === undefined
        : entry.exclusive === undefined && entry.shared.size === 0)
    );
  }

  function grant(lock: { client: number; key: string; shared: boolean; transaction: boolean }) {
    const entry = locks.get(lock.key) ?? { shared: new Set<number>() };
    if (lock.shared) entry.shared.add(lock.client);
    else entry.exclusive = lock.client;
    locks.set(lock.key, entry);
    held.set(lock.client, [...(held.get(lock.client) ?? []), lock]);
  }

  function releaseLock(lock: { client: number; key: string; shared: boolean }) {
    const clientLocks = held.get(lock.client) ?? [];
    const index = clientLocks.findIndex(
      (item) => item.key === lock.key && item.shared === lock.shared,
    );
    if (index < 0) return;
    clientLocks.splice(index, 1);
    held.set(lock.client, clientLocks);
    const entry = locks.get(lock.key);
    if (entry === undefined) return;
    if (lock.shared) entry.shared.delete(lock.client);
    else delete entry.exclusive;
    if (entry.exclusive === undefined && entry.shared.size === 0) locks.delete(lock.key);
    drain();
  }

  function releaseTransactions(client: number) {
    for (const lock of [...(held.get(client) ?? [])])
      if (lock.transaction) releaseLock({ client, ...lock });
  }

  function drain() {
    for (let index = 0; index < waiting.length;) {
      const waiter = waiting[index];
      if (waiter === undefined) return;
      if (!available(waiter.lock)) {
        index += 1;
        continue;
      }
      waiting.splice(index, 1);
      grant(waiter.lock);
      waiter.resolve({ rows: [] });
    }
  }
});

vi.mock("pg", () => ({ Pool: driver.Pool }));

import { PostgresStorageFactory } from "../src/index.js";

describe("PostgreSQL Entity history", () => {
  it("creates a factory-managed Entity handle with disabled histories", async () => {
    const factory = await postgresFactory();

    const entity = (
      factory as unknown as {
        createEntityStorage(input: EntityStorageInput<string, StringValue>): {
          readonly current: unknown;
          readonly states: { backward(id: string, depth: number): Promise<readonly unknown[]> };
          readonly events: { backward(id: string, depth: number): Promise<readonly unknown[]> };
          isOpen(): boolean;
        };
      }
    ).createEntityStorage(entityInput());

    expect(entity.current).toBeDefined();
    expect(entity.isOpen()).toBe(true);
    await expect(entity.states.backward("task", 1)).resolves.toEqual([]);
    await expect(entity.events.backward("task", 1)).resolves.toEqual([]);
  });

  it("enables the state-history port when the Entity input requests history", async () => {
    const factory = await postgresFactory();
    const entity = (
      factory as unknown as {
        createEntityStorage(input: EntityStorageInput<string, StringValue>): {
          readonly states: { append(record: EntityRecord): Promise<void> };
        };
      }
    ).createEntityStorage(entityInput(true));

    await expect(entity.states.append(stateRecord("task", "one", 1))).resolves.toBeUndefined();
  });

  it("reads state at a timestamp and bounds state and event history continuations", async () => {
    const factory = await postgresFactory();
    const states = entityStorage(factory, entityInput(true)).states;
    const events = entityStorage(factory, entityInput(false, true)).events;
    const state = create(StringValueSchema, { value: "at-five" });
    const before = driver.calls.length;
    driver.setHistoryRecords([
      { bytes: toBinary(EntityRecordSchema, stateRecord("task", "at-five", 1)) },
    ]);
    await expect(
      states.stateAt("task", create(TimestampSchema, { seconds: 5n, nanos: 4 })),
    ).resolves.toEqual(state);
    driver.setHistoryRecords([]);
    await expect(
      states.stateAt("task", create(TimestampSchema, { seconds: 6n })),
    ).resolves.toBeUndefined();
    await states.backward("task", 2, 9n);
    await events.backward("task", 3, 10n);

    const calls = driver.calls.slice(before);
    expect(
      calls.some(
        ({ sql, values }) => sql.includes('"created" <= $2') && values[1] === 5_000_000_004n,
      ),
    ).toBe(true);
    expect(
      calls.some(({ sql }) => sql.includes('"version" <= $2') && sql.includes("LIMIT $3")),
    ).toBe(true);
  });

  it("returns no point-in-time state for a state-less record and rejects malformed state bytes", async () => {
    const factory = await postgresFactory();
    const states = entityStorage(factory, entityInput(true)).states;
    const at = create(TimestampSchema, { seconds: 5n });
    driver.setHistoryRecords([{ bytes: toBinary(EntityRecordSchema, create(EntityRecordSchema)) }]);

    await expect(states.stateAt("task", at)).resolves.toBeUndefined();

    driver.setHistoryRecords([
      {
        bytes: toBinary(
          EntityRecordSchema,
          create(EntityRecordSchema, {
            state: {
              typeUrl: "type.googleapis.com/google.protobuf.StringValue",
              value: Uint8Array.of(255),
            },
          }),
        ),
      },
    ]);
    await expect(states.stateAt("task", at)).rejects.toThrow(
      /stored PostgreSQL state data is invalid/i,
    );
    driver.setHistoryRecords([]);
  });

  it("reads, writes, and maps current Entity query entries through the factory handle", async () => {
    const factory = await postgresFactory();
    const current = entityStorage(factory, entityInput()).current;
    const record = stateRecord("task", "current", 2);
    driver.setHistoryRecords([{ ID: "task", bytes: toBinary(EntityRecordSchema, record) }]);

    await expect(current.write(record)).resolves.toBeUndefined();
    await expect(current.read("task")).resolves.toEqual(record);
    await expect(current.query({})).resolves.toEqual([
      {
        id: "task",
        record,
        columns: new Map(),
      },
    ]);
    driver.calls.splice(0);
    driver.setHistoryRecords([]);
  });

  it("rejects invalid history bounds before preparing a record family", async () => {
    const factory = await postgresFactory();
    const states = entityStorage(factory, entityInput(true)).states;
    const events = entityStorage(factory, entityInput(false, true)).events;

    await expect(states.backward("task", 0)).rejects.toThrow(/positive finite integer/i);
    await expect(events.backward("task", Number.NaN)).rejects.toThrow(/positive finite integer/i);
    await expect(states.backward("task", Number.POSITIVE_INFINITY)).rejects.toThrow(
      /positive finite integer/i,
    );
    await expect(states.trim("task", -1)).rejects.toThrow(/non-negative safe integer/i);
    await expect(states.trim("task", Number.NaN)).rejects.toThrow(/non-negative safe integer/i);
  });

  it("does not open a deletion page when history has no pre-cutoff high-water record", async () => {
    const factory = await postgresFactory();
    const states = entityStorage(factory, entityInput(true)).states;
    const events = entityStorage(factory, entityInput(false, true)).events;
    driver.setHighWater(undefined);
    const before = driver.calls.length;

    await states.truncate(create(TimestampSchema, { seconds: 5n }));
    await events.truncate(create(TimestampSchema, { seconds: 5n }));

    expect(driver.calls.slice(before).some(({ sql }) => sql.startsWith('SELECT "ID"'))).toBe(false);
    driver.setHighWater({ created: 1n, version: 2, ID: "high-water" });
  });

  it("rejects history work after its Entity handle closes", async () => {
    const factory = await postgresFactory();
    const entity = entityStorage(factory, entityInput(true, true));

    entity.close();
    entity.close();

    await expect(entity.states.backward("task", 1)).rejects.toThrow(/state history is closed/i);
    await expect(entity.events.backward("task", 1)).rejects.toThrow(/event history is closed/i);
    await expect(entity.events.append(eventRecord("closed", "task", 1))).rejects.toThrow(
      /event history is closed/i,
    );
  });

  it("trims state history through bounded key pages", async () => {
    const factory = await postgresFactory();
    const entity = entityStorage(factory, entityInput(true));

    await expect(entity.states.trim("task", 0)).resolves.toBeUndefined();

    expect(
      driver.calls.filter(({ sql }) => sql.startsWith('SELECT "ID"')).map(({ sql }) => sql),
    ).toEqual([expect.stringContaining('("version", "created", "ID") <= ($2, $3, $4)')]);
    expect(
      driver.calls.some(({ sql }) => sql.startsWith("DELETE") && sql.includes('"ID" IN ($1)')),
    ).toBe(true);
  });

  it("continues trim with a second bounded 128-key page", async () => {
    driver.keyPages.push(
      Array.from({ length: 128 }, (_, index) => `key-${String(index)}`),
      [],
    );
    const factory = await postgresFactory();
    const entity = entityStorage(factory, entityInput(true));
    const before = driver.calls.length;

    await entity.states.trim("task", 0);

    const calls = driver.calls.slice(before).filter(({ sql }) => sql.startsWith('SELECT "ID"'));
    expect(calls).toHaveLength(2);
    expect(calls.every(({ values }) => values.at(-1) === 128)).toBe(true);
  });

  it.each([
    [0, 1],
    [3, 12],
    [5, 300],
  ])("retains exactly %i newest state rows from %i rows", async (keep, count) => {
    driver.setStateRows(
      Array.from({ length: count }, (_, index) => ({
        ID: `state-${String(index)}`,
        version: index,
        created: BigInt(index),
      })),
    );
    const factory = await postgresFactory();
    const states = entityStorage(factory, entityInput(true)).states;
    const before = driver.calls.length;

    try {
      await states.trim("task", keep);
      expect(
        driver
          .stateRows()
          .map(({ version }) => version)
          .sort((a, b) => b - a),
      ).toEqual(Array.from({ length: keep }, (_, index) => count - index - 1));
      const calls = driver.calls.slice(before);
      expect(
        calls.filter(({ sql }) => sql.startsWith('SELECT "version", "created", "ID"')),
      ).toHaveLength(1);
      const pages = calls.filter(({ sql }) => sql.startsWith('SELECT "ID"'));
      expect(pages.every(({ sql }) => !sql.includes("OFFSET"))).toBe(true);
      if (count > 256) {
        expect(pages[1].values.slice(1, 4)).not.toEqual(pages[0].values.slice(1, 4));
        expect(pages[1]?.sql).toContain('("version", "created", "ID") < ($2, $3, $4)');
      }
    } finally {
      driver.clearStateRows();
    }
  });

  it("discards the trim client and reports a sanitized error when advisory unlock is false", async () => {
    const factory = await postgresFactory();
    const entity = entityStorage(factory, entityInput(true));
    const releases = driver.release.mock.calls.length;
    driver.failUnlock(false);

    await expect(entity.states.trim("task", 0)).rejects.toThrow(/history cleanup failed/i);

    expect(driver.release.mock.calls.length).toBeGreaterThan(releases);
    expect(driver.release.mock.calls.at(-1)?.[0]).toBeInstanceOf(Error);
  });

  it("releases successful state trim Entity and family locks in reverse order", async () => {
    const factory = await postgresFactory();
    const entity = entityStorage(factory, entityInput(true));
    const before = driver.calls.length;

    await expect(entity.states.trim("task", 0)).resolves.toBeUndefined();

    const locks = driver.calls
      .slice(before)
      .filter(
        ({ sql }) =>
          sql === "SELECT pg_advisory_unlock($1)" || sql === "SELECT pg_advisory_unlock_shared($1)",
      )
      .map(({ sql }) => sql);
    expect(locks).toEqual([
      "SELECT pg_advisory_unlock($1)",
      "SELECT pg_advisory_unlock_shared($1)",
    ]);
  });

  it("releases the acquired family lock and discards the client after Entity lock acquisition fails", async () => {
    const factory = await postgresFactory();
    const entity = entityStorage(factory, entityInput(true));
    const before = driver.calls.length;
    const releases = driver.release.mock.calls.length;
    driver.failLock("SELECT pg_advisory_lock($1)", new Error("postgres password and SQL"));
    driver.failUnlock(false);

    await expect(entity.states.trim("task", 0)).rejects.toThrow(/record operation failed/i);

    const calls = driver.calls.slice(before);
    expect(calls.map(({ sql }) => sql)).toEqual(
      expect.arrayContaining([
        "SELECT pg_advisory_lock_shared($1)",
        "SELECT pg_advisory_lock($1)",
        "SELECT pg_advisory_unlock_shared($1)",
      ]),
    );
    expect(driver.release.mock.calls.length).toBeGreaterThan(releases);
    expect(driver.release.mock.calls.at(-1)?.[0]).toBeInstanceOf(Error);
  });

  it.each(["states", "events"] as const)(
    "discards the %s truncate client when advisory unlock rejects",
    async (history) => {
      const factory = await postgresFactory();
      const entity = entityStorage(
        factory,
        entityInput(history === "states", history === "events"),
      );
      const releases = driver.release.mock.calls.length;
      driver.failUnlock(new Error("postgres password and SQL"));

      await expect(
        entity[history].truncate(create(TimestampSchema, { seconds: 5n })),
      ).rejects.toThrow(/history cleanup failed/i);

      expect(driver.release.mock.calls.length).toBeGreaterThan(releases);
      expect(driver.release.mock.calls.at(-1)?.[0]).toBeInstanceOf(Error);
    },
  );

  it("preserves an earlier trim failure while discarding after unlock failure", async () => {
    const factory = await postgresFactory();
    const entity = entityStorage(factory, entityInput(true));
    const releases = driver.release.mock.calls.length;
    driver.setDeleteHook(() => Promise.reject(new Error("earlier operation failure")));
    driver.failUnlock(false);

    await expect(entity.states.trim("task", 0)).rejects.toThrow(/record operation failed/i);

    expect(driver.release.mock.calls.length).toBeGreaterThan(releases);
    expect(driver.release.mock.calls.at(-1)?.[0]).toBeInstanceOf(Error);
    driver.setDeleteHook(undefined);
  });

  it("freezes a high-water key before bounded state-history truncation", async () => {
    const factory = await postgresFactory();
    const entity = entityStorage(factory, entityInput(true));

    await entity.states.truncate(create(TimestampSchema, { seconds: 5n }));

    expect(
      driver.calls.some(({ sql }) => sql.startsWith('SELECT "created", "version", "ID"')),
    ).toBe(true);
    expect(
      driver.calls.some(
        ({ sql, values }) =>
          sql.startsWith('SELECT "ID"') &&
          sql.includes('("created", "version", "ID") <=') &&
          values.includes("high-water"),
      ),
    ).toBe(true);
  });

  it("waits to append an event until another factory finishes global truncation", async () => {
    let finishDelete: (() => void) | undefined;
    driver.keyPages.splice(0);
    driver.keyPages.push(
      Array.from({ length: 128 }, (_, index) => `event-${String(index)}`),
      [],
    );
    driver.setDeleteHook(
      () =>
        new Promise((resolve) => {
          finishDelete = () => {
            resolve({ rowCount: 128, rows: [] });
          };
        }),
    );
    const first = await postgresFactory();
    const second = await postgresFactory();
    const before = driver.calls.length;
    const truncating = entityStorage(first, entityInput(false, true)).events.truncate(
      create(TimestampSchema, { seconds: 5n }),
    );
    await vi.waitFor(() => {
      expect(finishDelete).toBeDefined();
    });
    const appending = entityStorage(second, entityInput(false, true)).events.append(
      eventRecord("event-2", "task", 2),
    );

    await vi.waitFor(() => {
      expect(
        driver.calls.slice(before).some(({ sql }) => sql.includes("pg_advisory_xact_lock_shared")),
      ).toBe(true);
    });
    expect(driver.calls.slice(before).some(({ sql }) => sql.startsWith("INSERT"))).toBe(false);

    finishDelete?.();
    await Promise.all([truncating, appending]);

    const calls = driver.calls.slice(before);
    const unlock = calls.findIndex(({ sql }) => sql.includes("pg_advisory_unlock($1)"));
    expect(calls.findIndex(({ sql }) => sql.startsWith("INSERT"))).toBeGreaterThan(unlock);
    expect(calls.filter(({ sql }) => sql.startsWith('SELECT "ID"'))).toHaveLength(2);
    driver.setDeleteHook(undefined);
  });

  it("holds the state family and Entity locks while another factory trims", async () => {
    let finishDelete: (() => void) | undefined;
    driver.setDeleteHook(
      () =>
        new Promise((resolve) => {
          finishDelete = () => {
            resolve({ rowCount: 1, rows: [] });
          };
        }),
    );
    const first = await postgresFactory();
    const second = await postgresFactory();
    const before = driver.calls.length;
    const trimming = entityStorage(first, entityInput(true)).states.trim("task", 0);
    await vi.waitFor(() => {
      expect(finishDelete).toBeDefined();
    });
    const appending = entityStorage(second, entityInput(true)).states.append(
      stateRecord("task", "two", 2),
    );

    await vi.waitFor(() => {
      expect(
        driver.calls.slice(before).some(({ sql }) => sql.includes("pg_advisory_xact_lock_shared")),
      ).toBe(true);
    });
    const calls = driver.calls.slice(before);
    const trimClient = calls.find(
      ({ sql }) => sql === "SELECT pg_advisory_lock_shared($1)",
    )?.client;
    const appendClient = calls.find(
      ({ sql }) => sql === "SELECT pg_advisory_xact_lock_shared($1)",
    )?.client;
    const trimFamily = calls.findIndex(
      ({ client, sql }) => client === trimClient && sql === "SELECT pg_advisory_lock_shared($1)",
    );
    const trimEntity = calls.findIndex(
      ({ client, sql }) => client === trimClient && sql === "SELECT pg_advisory_lock($1)",
    );
    const appendFamily = calls.findIndex(
      ({ client, sql }) =>
        client === appendClient && sql === "SELECT pg_advisory_xact_lock_shared($1)",
    );
    const appendEntity = calls.findIndex(
      ({ client, sql }) => client === appendClient && sql === "SELECT pg_advisory_xact_lock($1)",
    );
    expect(trimFamily).toBeGreaterThanOrEqual(0);
    expect(trimEntity).toBeGreaterThan(trimFamily);
    expect(appendFamily).toBeGreaterThanOrEqual(0);
    expect(appendEntity).toBeGreaterThan(appendFamily);
    expect(driver.calls.slice(before).some(({ sql }) => sql.startsWith("INSERT"))).toBe(false);

    finishDelete?.();
    await Promise.all([trimming, appending]);
    driver.setDeleteHook(undefined);
  });

  it("enables immutable diagnostic event history through the factory handle", async () => {
    const factory = await postgresFactory();
    const entity = entityStorage(factory, entityInput(false, true));

    await expect(entity.events.append(eventRecord("event-1", "task", 1))).resolves.toBeUndefined();
  });

  it("truncates event history in bounded high-water pages without reading payloads", async () => {
    driver.keyPages.splice(0);
    driver.keyPages.push(
      Array.from({ length: 128 }, (_, index) => `event-${String(index)}`),
      ["retained-event"],
    );
    const factory = await postgresFactory();
    const entity = entityStorage(factory, entityInput(false, true));
    const before = driver.calls.length;

    await entity.events.truncate(create(TimestampSchema, { seconds: 5n }));

    const pages = driver.calls.slice(before).filter(({ sql }) => sql.startsWith('SELECT "ID"'));
    expect(pages).toHaveLength(2);
    expect(pages.every(({ sql }) => !sql.includes('"bytes"'))).toBe(true);
    expect(
      pages.every(
        ({ sql, values }) =>
          sql.includes('("created", "version", "ID") <=') && values.at(-1) === 128,
      ),
    ).toBe(true);
    expect(pages.every(({ values }) => values.includes("high-water"))).toBe(true);
  });

  it("closes grouped state history with its Entity handle", async () => {
    const factory = await postgresFactory();
    const entity = entityStorage(factory, entityInput(true));

    entity.close();

    await expect(entity.states.append(stateRecord("task", "one", 1))).rejects.toThrow("closed");
  });

  it("settles an active trim page before close and starts no next page", async () => {
    let settle: (() => void) | undefined;
    driver.keyPages.splice(0);
    driver.keyPages.push(
      Array.from({ length: 128 }, (_, index) => `key-${String(index)}`),
      [],
    );
    driver.setDeleteHook(
      () =>
        new Promise((resolve) => {
          settle = () => {
            resolve({ rowCount: 128, rows: [] });
          };
        }),
    );
    const factory = await postgresFactory();
    const entity = entityStorage(factory, entityInput(true));
    const before = driver.calls.length;
    const trimming = entity.states.trim("task", 0);
    await vi.waitFor(() => {
      expect(settle).toBeDefined();
    });

    entity.close();
    if (settle !== undefined) settle();
    await trimming;

    expect(
      driver.calls.slice(before).filter(({ sql }) => sql.startsWith('SELECT "ID"')),
    ).toHaveLength(1);
    expect(driver.release).toHaveBeenCalled();
    driver.setDeleteHook(undefined);
  });

  it("rolls back a failed trim page and retries its keys without skipping", async () => {
    const failure = new Error("delete failed");
    driver.keyPages.splice(0);
    driver.keyPages.push(["retry-key"]);
    driver.setDeleteHook(() => Promise.reject(failure));
    const factory = await postgresFactory();
    const entity = entityStorage(factory, entityInput(true));
    await entity.states.backward("task", 1);
    const before = driver.calls.length;
    const releases = driver.release.mock.calls.length;

    await expect(entity.states.trim("task", 0)).rejects.toThrow(
      "PostgreSQL record operation failed.",
    );

    expect(driver.calls.slice(before).some(({ sql }) => sql === "ROLLBACK")).toBe(true);
    expect(driver.calls.slice(before).some(({ sql }) => sql.includes("pg_advisory_unlock"))).toBe(
      true,
    );
    expect(driver.release.mock.calls.length).toBe(releases + 1);
    driver.setDeleteHook(undefined);
    driver.keyPages.push(["retry-key"]);
    await entity.states.trim("task", 0);
    expect(driver.calls.slice(before).filter(({ sql }) => sql.startsWith("DELETE"))).toHaveLength(
      2,
    );
  });
});

function entityInput(
  stateHistory = false,
  eventHistory = false,
): EntityStorageInput<string, StringValue> {
  const unpack = (id: NonNullable<EntityRecord["entityId"]>): string | undefined =>
    id.typeUrl.endsWith(`/${StringValueSchema.typeName}`)
      ? fromBinary(StringValueSchema, id.value).value
      : undefined;
  return {
    context: { name: "Tasks", multitenant: false },
    id: {
      clone: (id) => id,
      key: (id) => id,
      pack: (id) => Identifiers.pack(StringValueSchema, create(StringValueSchema, { value: id })),
      unpack,
    },
    columns: [],
    recordSpec: new RecordSpec({
      sourceType: StringValueSchema,
      recordType: EntityRecordSchema,
      idKind: "string",
      extractId: (record) => unpack(record.entityId ?? create(AnySchema)) ?? "",
    }),
    sourceType: StringValueSchema,
    stateSchema: StringValueSchema,
    stateHistory,
    eventHistory,
  };
}

function stateRecord(id: string, value: string, version: number): EntityRecord {
  return create(EntityRecordSchema, {
    entityId: packed(id),
    state: packed(value),
    version: { number: version },
  });
}

function packed(value: string) {
  return Identifiers.pack(StringValueSchema, create(StringValueSchema, { value }));
}

function eventRecord(id: string, entityId: string, version: number): Event {
  return create(EventSchema, {
    id: { value: id },
    context: { producerId: packed(entityId), version: { number: version } },
  });
}

function postgresFactory() {
  const stringifiers = new StringifierRegistry();
  stringifiers.setTypeRegistry(new TypeRegistry([StringValueSchema]));
  return PostgresStorageFactory.newBuilder()
    .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
    .setStringifierRegistry(stringifiers)
    .build();
}
