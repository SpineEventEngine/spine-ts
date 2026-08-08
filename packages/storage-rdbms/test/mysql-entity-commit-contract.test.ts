import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { AnySchema, StringValueSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema, VersionSchema } from "@spine-event-engine/proto";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { describe, expect, it } from "vitest";

import { mysqlEntityLockKey, MysqlEntityCommitCoordinator } from "../src/mysql/entity-commit.js";
import { MysqlEntityStorage } from "../src/mysql/entity-history.js";
import { mysqlCurrentRevision, mysqlEntityTables } from "../src/mysql/testing.js";

describe("MysqlEntityCommitCoordinator", () => {
  it("derives a 64-character lowercase hexadecimal advisory key for each entity identity", () => {
    const first = mysqlEntityLockKey({
      databaseName: "first",
      contextName: "orders",
      entityKey: "42",
      sourceTypeName: "example.Order",
    });
    const second = mysqlEntityLockKey({
      databaseName: "first",
      contextName: "orders",
      entityKey: "43",
      sourceTypeName: "example.Order",
    });

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
    expect(
      mysqlEntityLockKey({
        databaseName: "second",
        contextName: "orders",
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

  it("reads the internal current revision with canonical single and tenant scopes", async () => {
    const values: unknown[][] = [[{ revision: "4" }], [{ revision: "5" }], []];
    const pool = { query: () => Promise.resolve([values.shift() ?? [], []] as never) };
    await expect(
      mysqlCurrentRevision(pool as never, entityInput(false, false), "one"),
    ).resolves.toBe(4n);
    await expect(
      mysqlCurrentRevision(
        pool as never,
        {
          ...entityInput(false, false),
          context: { name: "tenant", multitenant: true, tenantId: "acme" },
        },
        "two",
      ),
    ).resolves.toBe(5n);
    await expect(
      mysqlCurrentRevision(pool as never, entityInput(false, false), "missing"),
    ).rejects.toThrow(/missing/i);
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

function entityInput(stateHistory: boolean, eventHistory: boolean) {
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
    sourceType: StringValueSchema,
    stateSchema: StringValueSchema,
    stateHistory,
    eventHistory,
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
