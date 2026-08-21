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
import {
  EventIdSchema,
  EventSchema,
  UserIdSchema,
  VersionSchema,
  type UserId,
} from "@spine-event-engine/proto";
import { StringifierRegistry } from "@spine-event-engine/core";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { RecordSpec } from "@spine-event-engine/storage";
import type { EntityStorageInput } from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";

import { mysqlEntityLockKey, MysqlEntityCommitCoordinator } from "../src/mysql/entity-commit.js";
import { MysqlEntityStorage } from "../src/mysql/entity-history.js";
import { mysqlCurrentRecord, mysqlEntityTables, mysqlHistoryCounts } from "../src/mysql/testing.js";

describe("MysqlEntityCommitCoordinator", () => {
  it("derives a 64-character lowercase hexadecimal advisory key for each entity identity", () => {
    const first = mysqlEntityLockKey({
      databaseName: "first",
      entityKey: "42",
      sourceTypeName: "example.Order",
    });
    const second = mysqlEntityLockKey({
      databaseName: "first",
      entityKey: "43",
      sourceTypeName: "example.Order",
    });

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
    expect(
      mysqlEntityLockKey({
        databaseName: "second",
        entityKey: "42",
        sourceTypeName: "example.Order",
      }),
    ).not.toBe(first);
  });

  it("uses one transactional connection and creates no receipt table", async () => {
    const calls: string[] = [];
    const coordinator = new MysqlEntityCommitCoordinator({
      acquire: () =>
        Promise.resolve({
          beginTransaction: () => Promise.resolve(calls.push("BEGIN")),
          commit: () => Promise.resolve(calls.push("COMMIT")),
          rollback: () => Promise.resolve(calls.push("ROLLBACK")),
          query: () => Promise.resolve([[{ engine: "InnoDB" }], []] as never),
          execute: (sql: string) => {
            calls.push(sql);
            return Promise.resolve([{ affectedRows: 1 }, []] as never);
          },
        } as never),
      release: () => undefined,
    });

    await coordinator.commit(["entities"], "entity-key", () => Promise.resolve());

    expect(calls).toEqual(["BEGIN", "COMMIT"]);
    expect(calls.join(" ")).not.toMatch(/receipt|spine_ts_entity_commits/i);
  });

  it("rolls a transactional unit back when its work fails", async () => {
    const calls: string[] = [];
    const coordinator = new MysqlEntityCommitCoordinator({
      acquire: () =>
        Promise.resolve({
          beginTransaction: () => Promise.resolve(calls.push("BEGIN")),
          commit: () => Promise.resolve(calls.push("COMMIT")),
          rollback: () => Promise.resolve(calls.push("ROLLBACK")),
          query: () => Promise.resolve([[{ engine: "InnoDB" }], []] as never),
        } as never),
      release: () => undefined,
    });

    await expect(
      coordinator.commit(["entities"], "entity-key", () => Promise.reject(new Error("fail"))),
    ).rejects.toThrow("fail");
    expect(calls).toEqual(["BEGIN", "ROLLBACK"]);
  });

  it("retries one InnoDB deadlock after rolling its transaction back", async () => {
    const calls: string[] = [];
    let attempts = 0;
    const coordinator = new MysqlEntityCommitCoordinator({
      acquire: () =>
        Promise.resolve({
          beginTransaction: () => Promise.resolve(calls.push("BEGIN")),
          commit: () => Promise.resolve(calls.push("COMMIT")),
          rollback: () => Promise.resolve(calls.push("ROLLBACK")),
          query: () => Promise.resolve([[{ engine: "InnoDB" }], []] as never),
        } as never),
      release: () => undefined,
    });

    await expect(
      coordinator.commit(["entities"], "entity-key", () => {
        attempts += 1;
        if (attempts === 1)
          return Promise.reject(Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK" }));
        return Promise.resolve("committed");
      }),
    ).resolves.toBe("committed");
    expect(calls).toEqual(["BEGIN", "ROLLBACK", "BEGIN", "COMMIT"]);
  });

  it("holds and releases a database advisory lock around nontransactional work", async () => {
    const calls: string[] = [];
    const coordinator = new MysqlEntityCommitCoordinator({
      acquire: () =>
        Promise.resolve({
          query: () => Promise.resolve([[{ engine: "MyISAM" }], []] as never),
          execute: (sql: string) => {
            calls.push(sql);
            return Promise.resolve([[{ acquired: 1 }], []] as never);
          },
        } as never),
      release: () => undefined,
    });
    await coordinator.commit(["entities"], "entity-key", () => Promise.resolve());
    expect(calls).toEqual(["SELECT GET_LOCK(?, ?) AS acquired", "SELECT RELEASE_LOCK(?)"]);
  });

  it("rejects an unavailable advisory lock without running the work", async () => {
    let ran = false;
    const coordinator = new MysqlEntityCommitCoordinator({
      acquire: () =>
        Promise.resolve({
          query: () => Promise.resolve([[{ engine: "MyISAM" }], []] as never),
          execute: () => Promise.resolve([[{ acquired: 0 }], []] as never),
        } as never),
      release: () => undefined,
    });

    await expect(
      coordinator.commit(["entities"], "entity-key", () => Promise.resolve((ran = true))),
    ).rejects.toThrow(/acquire/i);
    expect(ran).toBe(false);
  });

  it("attempts to release a nontransactional advisory lock after work fails", async () => {
    const calls: string[] = [];
    const coordinator = new MysqlEntityCommitCoordinator({
      acquire: () =>
        Promise.resolve({
          execute: (sql: string) => {
            calls.push(sql);
            return Promise.resolve([[{ acquired: 1 }], []] as never);
          },
          query: () => Promise.resolve([[{ engine: "MyISAM" }], []] as never),
        } as never),
      release: () => undefined,
    });

    await expect(
      coordinator.commit(["events"], "lock-key", () => Promise.reject(new Error("fail"))),
    ).rejects.toThrow("fail");

    expect(calls).toContain("SELECT RELEASE_LOCK(?)");
  });
});

describe("MysqlEntityStorage history behavior", () => {
  it("resolves only enabled Entity-family tables", () => {
    expect(mysqlEntityTables(entityInput(false, false))).toHaveLength(1);
    expect(mysqlEntityTables(entityInput(true, true))).toHaveLength(3);
  });

  it("returns absent and decoded current records from provider rows", async () => {
    const value = create(EntityRecordSchema);
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce([[], []])
        .mockResolvedValueOnce([[{ bytes: toBinary(EntityRecordSchema, value) }], []]),
    };
    const input = entityInput(false, false);

    await expect(mysqlCurrentRecord(pool as never, input, "missing")).resolves.toBeUndefined();
    await expect(mysqlCurrentRecord(pool as never, input, "present")).resolves.toEqual(value);
    expect(pool.query).toHaveBeenNthCalledWith(1, expect.any(String), ["missing"]);
    expect(pool.query).toHaveBeenNthCalledWith(2, expect.any(String), ["present"]);
  });

  it("queries current Entity rows with direct message ID values", async () => {
    const query = vi.fn(() => Promise.resolve([[], []]));
    const input = messageIdInput();
    const id = create(UserIdSchema, { value: "user-42" });

    await expect(mysqlCurrentRecord({ query } as never, input, id)).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(expect.any(String), ['{"value":"user-42"}']);
  });

  it("queries current Entity rows with the factory's custom message ID stringifier", async () => {
    const query = vi.fn(() => Promise.resolve([[], []]));
    const input = messageIdInput();
    const id = create(UserIdSchema, { value: "user-42" });
    const stringifiers = new StringifierRegistry();
    stringifiers.register(UserIdSchema, {
      toString: (value) => `user:${value.value}`,
      fromString: (value) => create(UserIdSchema, { value: value.slice("user:".length) }),
    });

    await expect(
      mysqlCurrentRecord({ query } as never, input, id, stringifiers),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(expect.any(String), ["user:user-42"]);
  });

  it("counts only matching enabled state and event histories", async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce([
          [
            { bytes: toBinary(EntityRecordSchema, record("task", 1n, 1n)) },
            { bytes: toBinary(EntityRecordSchema, record("other", 2n, 2n)) },
            { bytes: toBinary(EntityRecordSchema, create(EntityRecordSchema)) },
          ],
          [],
        ])
        .mockResolvedValueOnce([
          [
            { bytes: toBinary(EventSchema, event("task", "one", 1n, 1n)) },
            { bytes: toBinary(EventSchema, event("other", "two", 2n, 2n)) },
            { bytes: toBinary(EventSchema, create(EventSchema)) },
          ],
          [],
        ]),
    };
    await expect(
      mysqlHistoryCounts(pool as never, entityInput(true, true), "task"),
    ).resolves.toEqual({ states: 1, events: 1 });
    await expect(
      mysqlHistoryCounts({ query: vi.fn() } as never, entityInput(false, false), "task"),
    ).resolves.toEqual({ states: 0, events: 0 });
  });

  it("translates Entity-ID predicates before querying the canonical current family", async () => {
    const current = fakeRecords([]);
    const storage = new MysqlEntityStorage(entityInput(false, false), () => current as never);
    const plans: unknown[] = [];
    (
      current as unknown as { queryPlanEntries(plan: unknown): Promise<readonly unknown[]> }
    ).queryPlanEntries = (plan) => {
      plans.push(plan);
      return Promise.resolve([]);
    };

    await storage.current.query({ predicate: { kind: "ids", ids: ["one"] } });
    await storage.current.query({});
    await storage.current.query({
      predicate: {
        kind: "all",
        predicates: [
          { kind: "comparison", column: "state", operator: "equal", value: "x" },
          { kind: "either", predicates: [{ kind: "ids", ids: ["two"] }] },
        ],
      },
    });
    await storage.current.query({
      order: [{ column: "ID", direction: "asc" }],
      mask: { paths: ["state"] },
      limit: 1,
      candidateLimit: 2,
    });

    expect(plans).toMatchObject([
      { predicate: { kind: "ids", ids: ["one"] } },
      {},
      { predicate: { kind: "all", predicates: [{ kind: "comparison" }, { kind: "either" }] } },
      { order: [{ column: "ID", direction: "asc" }], limit: 1, candidateLimit: 2 },
    ]);
  });

  it("closes every family once and reports its closed lifecycle", () => {
    const current = fakeRecords([]);
    const states = fakeRecords([]);
    const events = fakeRecords([]);
    const stores = [current, states, events];
    let removed = 0;
    const storage = new MysqlEntityStorage(
      entityInput(true, true),
      () => stores.shift() as never,
      () => removed++,
    );

    expect(storage.isOpen()).toBe(true);
    storage.close();
    storage.close();

    expect(storage.isOpen()).toBe(false);
    expect(current.closed + states.closed + events.closed).toBe(3);
    expect(removed).toBe(1);
  });

  it("keeps disabled histories inert while rejecting disabled appends", async () => {
    const storage = new MysqlEntityStorage(
      entityInput(false, false),
      () => fakeRecords([]) as never,
    );

    await expect(storage.states.backward("task", 10)).resolves.toEqual([]);
    await expect(storage.states.stateAt("task", create(TimestampSchema))).resolves.toBeUndefined();
    await expect(storage.events.backward("task", 10)).resolves.toEqual([]);
    await expect(storage.states.trim("task", 1)).resolves.toBeUndefined();
    await expect(
      storage.states.truncate(create(TimestampSchema, { seconds: 1n })),
    ).resolves.toBeUndefined();
    await expect(
      storage.events.truncate(create(TimestampSchema, { seconds: 1n })),
    ).resolves.toBeUndefined();
    await expect(storage.states.append(record("task", 1n, 1n))).rejects.toThrow(/disabled/i);
    await expect(storage.events.append(event("task", "event", 1n, 1n))).rejects.toThrow(
      /disabled/i,
    );
    expect(() => {
      storage.close();
    }).not.toThrow();
  });

  it("returns descending histories, finds state at a boundary, and removes only obsolete rows", async () => {
    const current = fakeRecords([]);
    const states = fakeRecords([
      record("task", 1n, 1n),
      record("task", 2n, 2n),
      record("other", 3n, 3n),
    ]);
    const events = fakeRecords([
      event("task", "first", 1n, 1n),
      event("task", "second", 2n, 2n),
      event("other", "third", 3n, 3n),
    ]);
    const stores = [current, states, events];
    const storage = new MysqlEntityStorage(entityInput(true, true), () => stores.shift() as never);

    await expect(storage.states.backward("task", 10, 1n)).resolves.toMatchObject([
      { version: { number: 1 } },
    ]);
    await expect(
      storage.states.stateAt("task", create(TimestampSchema, { seconds: 1n })),
    ).resolves.toEqual(create(StringValueSchema, { value: "state-1" }));
    await expect(
      storage.states.stateAt("task", create(TimestampSchema, { seconds: 0n })),
    ).resolves.toBeUndefined();
    await expect(storage.events.backward("task", 1)).resolves.toMatchObject([
      { id: { value: "second" } },
    ]);

    await storage.states.trim("task", 1);
    await storage.events.truncate(create(TimestampSchema, { seconds: 2n }));
    await storage.states.truncate(create(TimestampSchema, { seconds: 2n }));

    expect(states.values).toHaveLength(2);
    expect(states.values.map((value) => versionOf(value))).toContain(2n);
    expect(events.values).toHaveLength(2);
    expect(
      events.values.map((value) => (value as { id?: { value?: string } }).id?.value),
    ).toContain("second");
    storage.close();
    expect(current.closed + states.closed + events.closed).toBe(3);
  });

  it("prepares, binds, and preflights every enabled Entity family", async () => {
    const current = fakeRecords([]);
    const states = fakeRecords([]);
    const events = fakeRecords([]);
    const stores = [current, states, events];
    const storage = new MysqlEntityStorage(entityInput(true, true), () => stores.shift() as never);
    const state = record("task", 1n, 1n);
    const diagnostic = event("task", "diagnostic", 1n, 1n);

    await storage.prepare();
    await storage.preflightImmutable([state], [diagnostic]);
    await expect(storage.withConnection({} as never, () => Promise.resolve("bound"))).resolves.toBe(
      "bound",
    );

    expect(storage.tableNames()).toEqual(["fake", "fake", "fake"]);
    expect(current.prepared + states.prepared + events.prepared).toBe(3);
    expect(states.immutable).toEqual([state]);
    expect(events.immutable).toEqual([diagnostic]);
  });

  it("opens only the configured history families and keeps their connection nesting valid", async () => {
    for (const [stateHistory, eventHistory, expectedTables] of [
      [true, false, 2],
      [false, true, 2],
    ] as const) {
      const current = fakeRecords([]);
      const history = fakeRecords([]);
      const stores = [current, history];
      const storage = new MysqlEntityStorage(
        entityInput(stateHistory, eventHistory),
        () => stores.shift() as never,
      );

      await expect(
        storage.withConnection({} as never, () => Promise.resolve("bound")),
      ).resolves.toBe("bound");
      await storage.prepare();
      const capability = storage.commitCapability();
      await capability.prepare();
      await capability.preflightImmutable([], []);
      await capability.appendStateImmutable(record("task", 1n, 1n));
      await capability.appendDiagnosticImmutable(event("task", "diagnostic", 1n, 1n));

      expect(storage.tableNames()).toHaveLength(expectedTables);
      expect(capability.tableNames()).toHaveLength(expectedTables);
      expect(current.prepared + history.prepared).toBe(4);
      storage.close();
    }
  });

  it("rejects malformed current Entity records while retaining only timestamp-eligible histories", async () => {
    const current = fakeRecords([]);
    const states = fakeRecords([
      create(EntityRecordSchema, { version: create(VersionSchema, { number: 9 }) }),
      record("task", 2n, 2n),
      record("task", 1n, 1n),
    ]);
    const events = fakeRecords([
      create(EventSchema, { id: create(EventIdSchema, { value: "missing-context" }) }),
      event("task", "late", 3n, 3n),
      event("task", "boundary", 2n, 2n),
    ]);
    const stores = [current, states, events];
    const storage = new MysqlEntityStorage(entityInput(true, true), () => stores.shift() as never);
    (current as unknown as { queryPlanEntries: () => Promise<unknown[]> }).queryPlanEntries = () =>
      Promise.resolve([{ record: create(EntityRecordSchema) }]);

    await expect(storage.current.query({})).rejects.toThrow(/requires entityId/i);
    await expect(
      storage.states.stateAt("task", create(TimestampSchema, { seconds: 2n, nanos: 0 })),
    ).resolves.toEqual(create(StringValueSchema, { value: "state-2" }));
    await expect(storage.events.backward("task", 10, 2n)).resolves.toMatchObject([
      { id: { value: "boundary" } },
    ]);

    await storage.states.trim("task", 1);
    await storage.states.truncate(create(TimestampSchema, { seconds: 1n, nanos: 0 }));
    await storage.events.truncate(create(TimestampSchema, { seconds: 2n, nanos: 0 }));

    expect(states.values.some((value) => versionOf(value) === 2n)).toBe(true);
    expect(events.values.some((value) => versionOf(value) === 2n)).toBe(true);
  });
});

function entityInput(
  stateHistory: boolean,
  eventHistory: boolean,
): EntityStorageInput<string, StringValue> {
  const recordSpec = new RecordSpec<string, EntityRecord>({
    sourceType: StringValueSchema,
    recordType: EntityRecordSchema,
    idKind: "string",
    extractId: (record) => {
      if (record.entityId === undefined) throw new Error("EntityRecord.entityId is required.");
      return fromBinary(StringValueSchema, record.entityId.value).value;
    },
  });
  return {
    context: { name: "history", multitenant: false },
    id: {
      clone: (id: string) => id,
      key: (id: string) => id,
      pack: (id: string) => packed(id),
      unpack: (value: { typeUrl: string; value: Uint8Array }) =>
        value.typeUrl === "type.spine.io/google.protobuf.StringValue"
          ? fromBinary(StringValueSchema, value.value).value
          : undefined,
    },
    columns: [],
    recordSpec,
    sourceType: StringValueSchema,
    stateSchema: StringValueSchema,
    stateHistory,
    eventHistory,
  };
}

function messageIdInput(): EntityStorageInput<UserId, StringValue> {
  return {
    ...entityInput(false, false),
    id: {
      clone: (id) => create(UserIdSchema, { value: id.value }),
      key: (id) => id.value,
      pack: () => create(AnySchema),
      unpack: () => undefined,
    },
    recordSpec: new RecordSpec({
      sourceType: StringValueSchema,
      recordType: EntityRecordSchema,
      idSchema: UserIdSchema,
      extractId: () => create(UserIdSchema),
    }),
  };
}

function packed(id: string) {
  return create(AnySchema, {
    typeUrl: "type.spine.io/google.protobuf.StringValue",
    value: toBinary(StringValueSchema, create(StringValueSchema, { value: id })),
  });
}

function record(id: string, version: bigint, seconds: bigint) {
  return create(EntityRecordSchema, {
    entityId: packed(id),
    state: packed(`state-${String(version)}`),
    version: create(VersionSchema, {
      number: Number(version),
      timestamp: create(TimestampSchema, { seconds }),
    }),
  });
}

function event(id: string, value: string, version: bigint, seconds: bigint) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value }),
    context: {
      producerId: packed(id),
      version: create(VersionSchema, { number: Number(version) }),
      timestamp: create(TimestampSchema, { seconds }),
    },
  });
}

function fakeRecords(values: object[]) {
  return {
    values,
    closed: 0,
    prepared: 0,
    immutable: [] as object[],
    read: () => Promise.resolve(undefined),
    write: (value: object) => {
      values.push(value);
      return Promise.resolve();
    },
    query: () => Promise.resolve([...values].sort(byDescendingVersion)),
    delete: (key: { version?: bigint; entityId?: unknown; value?: string }) => {
      const index = values.findIndex((value) => {
        const candidate = value as { version?: { number?: bigint }; id?: { value?: string } };
        return key.version !== undefined
          ? candidate.version?.number === key.version
          : candidate.id?.value === key.value;
      });
      if (index >= 0) values.splice(index, 1);
      return Promise.resolve(index >= 0);
    },
    close() {
      this.closed += 1;
    },
    withConnection(_connection: unknown, work: () => Promise<unknown>) {
      return work();
    },
    tableName: "fake",
    prepare() {
      this.prepared += 1;
      return Promise.resolve();
    },
    assertImmutable(value: object) {
      this.immutable.push(value);
      return Promise.resolve();
    },
    writeImmutable(value: object) {
      this.immutable.push(value);
      return Promise.resolve();
    },
  };
}

function byDescendingVersion(left: object, right: object): number {
  const first = versionOf(left);
  const second = versionOf(right);
  return first === second ? 0 : first > second ? -1 : 1;
}

function versionOf(value: object): bigint {
  const record = value as {
    version?: { number?: bigint };
    context?: { version?: { number?: bigint } };
  };
  return BigInt(record.version?.number ?? record.context?.version?.number ?? 0);
}
