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

import { create, fromBinary, ScalarType } from "@bufbuild/protobuf";
import { AnySchema, StringValueSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema, TenantIdSchema } from "@spine-event-engine/proto";
import { Identifiers, StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { ColumnTypes, RecordColumn, RecordSpec } from "@spine-event-engine/storage";
import { EntityCommitStorageFactories } from "@spine-event-engine/storage/provider";
import type { EntityStorageInput } from "@spine-event-engine/storage/provider";
import { describe, expect, it } from "vitest";

import { DatastoreStorageFactory } from "../../src/index.js";
import { HistoryDatastoreBackend } from "./entity-history-fixture.js";

function input(
  histories = true,
  columns: readonly RecordColumn<ReturnType<typeof create<typeof EntityRecordSchema>>>[] = [],
): EntityStorageInput<string, ReturnType<typeof create<typeof StringValueSchema>>> {
  const unpack = (id: ReturnType<typeof create<typeof AnySchema>>) =>
    id.typeUrl.endsWith(StringValueSchema.typeName)
      ? fromBinary(StringValueSchema, id.value).value
      : undefined;
  return {
    context: { name: "GeneratedEntity", multitenant: false },
    id: {
      clone: (id) => id,
      key: (id) => id,
      pack: (id) => pack(id),
      unpack,
    },
    columns,
    recordSpec: new RecordSpec({
      sourceType: StringValueSchema,
      recordType: EntityRecordSchema,
      idKind: "string",
      extractId: (record) => {
        const id = record.entityId === undefined ? undefined : unpack(record.entityId);
        if (id === undefined) throw new Error("Entity record has no matching ID.");
        return id;
      },
      columns,
    }),
    sourceType: StringValueSchema,
    stateSchema: StringValueSchema,
    ...(histories ? { stateHistory: true, eventHistory: true } : {}),
  };
}
function pack(value: string) {
  return Identifiers.pack(StringValueSchema, create(StringValueSchema, { value }));
}
function record(value: string, version: number) {
  return create(EntityRecordSchema, {
    entityId: pack("task"),
    state: pack(value),
    version: { number: version, timestamp: create(TimestampSchema, { seconds: BigInt(version) }) },
  });
}
function event(id: string, version: number) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    context: {
      producerId: pack("task"),
      timestamp: create(TimestampSchema, { seconds: BigInt(version) }),
      version: { number: version },
    },
  });
}
function factory(backend: HistoryDatastoreBackend) {
  const stringifiers = new StringifierRegistry();
  stringifiers.setTypeRegistry(new TypeRegistry([StringValueSchema]));
  return DatastoreStorageFactory.newBuilder()
    .setClient(backend.client() as never)
    .setStringifierRegistry(stringifiers)
    .build();
}

describe("Datastore generated Entity records", () => {
  it("stores current, state history, diagnostic history, and Event Store in separate generated families", async () => {
    const backend = new HistoryDatastoreBackend();
    const storage = factory(backend).createEntityStorage(input());
    await storage.current.write(record("current", 1));
    await storage.states.append(record("state", 2));
    await storage.events.append(event("diagnostic", 3));
    expect(
      [...backend.entities.keys()].map(
        (key) => (JSON.parse(key) as [unknown, [string, string]])[1][0],
      ),
    ).toEqual(
      expect.arrayContaining([
        "google.protobuf.StringValue",
        "google.protobuf.StringValue_EntityRecord",
        "google.protobuf.StringValue_Event",
      ]),
    );
    expect([...backend.entities.values()].every((row) => Object.hasOwn(row.data, "bytes"))).toBe(
      true,
    );
    expect([...backend.entities.values()].every((row) => !Object.hasOwn(row.data, "_scope"))).toBe(
      true,
    );
  });

  it("does not open or write disabled history families", async () => {
    const backend = new HistoryDatastoreBackend();
    const storage = factory(backend).createEntityStorage(input(false));
    await expect(storage.states.append(record("state", 1))).rejects.toThrow("disabled");
    await expect(storage.events.append(event("event", 1))).rejects.toThrow("disabled");
    expect(backend.entities).toHaveLength(0);
  });

  it("rejects a commit that tries to append disabled history", async () => {
    const backend = new HistoryDatastoreBackend();
    const entity = input(false);
    const client = backend.client();
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();

    await expect(
      EntityCommitStorageFactories.create(store, entity).commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("current", 1),
        states: [record("retained", 1)],
      }),
    ).rejects.toThrow("disabled");
    expect(client.transactionCalls).toBe(0);
  });

  it("allows an empty disabled-history commit but rejects disabled diagnostic events", async () => {
    const backend = new HistoryDatastoreBackend();
    const entity = input(false);
    const store = factory(backend);
    const commits = EntityCommitStorageFactories.create(store, entity);

    await expect(
      commits.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("current", 1),
        states: [],
        diagnostics: [],
      }),
    ).resolves.toBe("committed");
    await expect(
      commits.commit({
        context: entity.context,
        entity,
        entityId: "task",
        expected: record("current", 1),
        next: record("next", 2),
        diagnostics: [event("diagnostic", 2)],
      }),
    ).rejects.toThrow("disabled");
  });

  it("rejects commits from another Entity source or storage tenancy", async () => {
    const entity = input();
    const commits = EntityCommitStorageFactories.create(
      factory(new HistoryDatastoreBackend()),
      entity,
    );
    const differentSource = { ...entity, sourceType: TimestampSchema };
    const differentTenancy = {
      ...entity,
      context: {
        name: entity.context.name,
        multitenant: true as const,
        tenantId: create(TenantIdSchema, { kind: { case: "value", value: "acme" } }),
      },
    };

    await expect(
      commits.commit({
        context: differentSource.context,
        entity: differentSource,
        entityId: "task",
        next: record("current", 1),
      } as never),
    ).rejects.toThrow("another Entity source or tenant");
    await expect(
      commits.commit({
        context: differentTenancy.context,
        entity: differentTenancy,
        entityId: "task",
        next: record("current", 1),
      }),
    ).rejects.toThrow("another Entity source or tenant");
  });

  it("rejects malformed event IDs and excludes events without the requested producer", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());

    await expect(storage.events.append(create(EventSchema))).rejects.toThrow("requires Event.id");
    await storage.events.append(
      create(EventSchema, { id: create(EventIdSchema, { value: "other" }) }),
    );

    await expect(storage.events.backward("task", 1)).resolves.toEqual([]);
  });

  it("rejects a current record whose ID cannot be unpacked", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    const missing = create(EntityRecordSchema, { state: pack("current"), version: { number: 1 } });
    const invalid = create(EntityRecordSchema, {
      entityId: create(AnySchema, { typeUrl: "type.spine.test/Other", value: new Uint8Array() }),
      state: pack("current"),
      version: { number: 1 },
    });

    await expect(storage.current.write(missing)).rejects.toThrow("does not match");
    await expect(storage.current.write(invalid)).rejects.toThrow("does not match");
    const entity = input();
    const commits = EntityCommitStorageFactories.create(
      factory(new HistoryDatastoreBackend()),
      entity,
    );
    await expect(
      commits.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: invalid,
      }),
    ).rejects.toThrow("does not match");
    await expect(
      commits.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: missing,
      }),
    ).rejects.toThrow("does not match");
  });

  it("returns declared current-record columns with query results", async () => {
    const columns = [
      new RecordColumn(
        "state_type",
        ColumnTypes.scalar(ScalarType.STRING),
        (record: ReturnType<typeof create<typeof EntityRecordSchema>>) => record.state?.typeUrl,
      ),
    ];
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(
      input(true, columns),
    );
    await storage.current.write(record("current", 1));

    const entries = await storage.current.query({});

    expect(entries).toHaveLength(1);
    expect(entries[0]?.columns.get("state_type")).toBe(
      `type.googleapis.com/${StringValueSchema.typeName}`,
    );
  });

  it("honors layouts for Entity families without using record creators", async () => {
    const backend = new HistoryDatastoreBackend();
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(backend.client() as never)
      .organizeRecords(StringValueSchema, EntityRecordSchema, { kind: "CurrentTasks" })
      .build();
    await store.createEntityStorage(input()).current.write(record("one", 1));
    expect(
      [...backend.entities.keys()].map(
        (key) => (JSON.parse(key) as [unknown, [string, string]])[1][0],
      ),
    ).toContain("CurrentTasks");
  });

  it("keeps immutable history and maintains backward, stateAt, trim, and truncate", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    await storage.states.append(record("one", 1));
    await storage.states.append(record("two", 2));
    await expect(storage.states.append(record("changed", 2))).rejects.toThrow("divergent");
    await expect(storage.states.backward("task", 1)).resolves.toMatchObject([
      { version: { number: 2 } },
    ]);
    await expect(
      storage.states.stateAt("task", create(TimestampSchema, { seconds: 1n })),
    ).resolves.toMatchObject({ value: "one" });
    await storage.states.trim("task", 1);
    await expect(storage.states.backward("task", 2)).resolves.toHaveLength(1);
    await storage.states.truncate(create(TimestampSchema, { seconds: 3n }));
    await expect(storage.states.backward("task", 1)).resolves.toEqual([]);
  });

  it("compares Timestamp nanos when selecting and truncating retained states", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    const early = create(EntityRecordSchema, {
      entityId: pack("task"),
      state: pack("early"),
      version: { number: 1, timestamp: create(TimestampSchema, { seconds: 4n, nanos: 100 }) },
    });
    const late = create(EntityRecordSchema, {
      entityId: pack("task"),
      state: pack("late"),
      version: { number: 2, timestamp: create(TimestampSchema, { seconds: 4n, nanos: 900 }) },
    });
    await storage.states.append(early);
    await storage.states.append(late);

    await expect(
      storage.states.stateAt("task", create(TimestampSchema, { seconds: 4n, nanos: 500 })),
    ).resolves.toMatchObject({ value: "early" });
    await storage.states.truncate(create(TimestampSchema, { seconds: 4n, nanos: 500 }));
    await expect(storage.states.backward("task", 2)).resolves.toHaveLength(1);
  });

  it("selects the state at an exact nanosecond and rejects invalid history retention", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    await storage.states.append(
      create(EntityRecordSchema, {
        entityId: pack("task"),
        state: pack("exact"),
        version: {
          number: 1,
          timestamp: create(TimestampSchema, { seconds: 4n, nanos: 500 }),
        },
      }),
    );

    await expect(
      storage.states.stateAt("task", create(TimestampSchema, { seconds: 4n, nanos: 500 })),
    ).resolves.toMatchObject({ value: "exact" });
    await expect(storage.states.backward("task", 0)).rejects.toThrow("positive safe integer");
    await expect(storage.states.trim("task", -1)).rejects.toThrow("non-negative safe integer");
  });

  it("reads an unversioned retained state at version zero without duplicating it", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    const unversioned = create(EntityRecordSchema, {
      entityId: pack("task"),
      state: pack("initial"),
    });
    await storage.states.append(unversioned);
    await storage.states.append(unversioned);

    await expect(storage.states.backward("task", 1, 0n)).resolves.toHaveLength(1);
  });

  it("reads retained states and diagnostic events across a 128-record keyset boundary", async () => {
    const backend = new HistoryDatastoreBackend();
    const storage = factory(backend).createEntityStorage(input());
    for (let version = 1; version <= 129; version += 1) {
      await storage.states.append(record(`state-${String(version)}`, version));
      await storage.events.append(event(`event-${String(version)}`, version));
    }

    const states = await storage.states.backward("task", 129);
    const events = await storage.events.backward("task", 129);

    expect(states).toHaveLength(129);
    expect(states.at(0)).toMatchObject({ version: { number: 129 } });
    expect(states.at(-1)).toMatchObject({ version: { number: 1 } });
    expect(events).toHaveLength(129);
    expect(events.at(0)).toMatchObject({ id: { value: "event-129" } });
    expect(events.at(-1)).toMatchObject({ id: { value: "event-1" } });
  });

  it("fails closed when a later provider page cannot advance its explicit continuation", async () => {
    const backend = new HistoryDatastoreBackend();
    const storage = factory(backend).createEntityStorage(input());
    for (let version = 1; version <= 129; version += 1)
      await storage.states.append(record(`state-${String(version)}`, version));

    backend.malformedQueryAt = 2;
    await expect(storage.states.backward("task", 129)).rejects.toThrow("continuation is malformed");
  });

  it("returns no state when the requested time precedes retained history", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    await storage.states.append(record("first", 2));

    await expect(
      storage.states.stateAt("task", create(TimestampSchema, { seconds: 1n })),
    ).resolves.toBeUndefined();
  });

  it("maintains state and event histories across a 128-record keyset boundary", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    for (let version = 1; version <= 129; version += 1) {
      await storage.states.append(record(`state-${String(version)}`, version));
      await storage.events.append(event(`event-${String(version)}`, version));
    }

    await storage.states.trim("task", 2);
    await storage.events.truncate(create(TimestampSchema, { seconds: 128n }));

    await expect(storage.states.backward("task", 3)).resolves.toMatchObject([
      { version: { number: 129 } },
      { version: { number: 128 } },
    ]);
    await expect(storage.events.backward("task", 3, 129n)).resolves.toMatchObject([
      { id: { value: "event-129" } },
      { id: { value: "event-128" } },
    ]);
  });

  it("keeps provider history reads and retention work bounded to 128-row pages", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(new TypeRegistry([StringValueSchema]));
    const storage = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .setStringifierRegistry(stringifiers)
      .build()
      .createEntityStorage(input());
    for (let version = 1; version <= 129; version += 1)
      await storage.states.append(record(`state-${String(version)}`, version));

    const beforeRead = client.queryCalls;
    await expect(storage.states.backward("task", 129)).resolves.toHaveLength(129);
    expect(client.queryCalls - beforeRead).toBe(2);
    expect(client.queryLimits.slice(-2)).toEqual([128, 1]);
    expect(
      client.queries
        .slice(-2)
        .every((query) =>
          query.filters.some((filter) => Array.isArray(filter) && filter[0] === "entity_id"),
        ),
    ).toBe(true);

    await storage.states.trim("task", 17);
    await expect(storage.states.backward("task", 129)).resolves.toHaveLength(17);
    expect(client.queryLimits.every((limit) => limit <= 128)).toBe(true);
    expect(client.deleteCalls).toBeGreaterThan(0);
  });

  it("resumes a large time-based deletion without an unbounded scan", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const storage = factory(backend).createEntityStorage(input());
    for (let version = 1; version <= 1_129; version += 1)
      await storage.events.append(event(`old-${String(version)}`, version));

    backend.failDeleteAt = 2;
    await expect(
      storage.events.truncate(create(TimestampSchema, { seconds: 2_000n })),
    ).rejects.toThrow("Datastore provider operation failed");
    backend.failDeleteAt = undefined;
    await storage.events.truncate(create(TimestampSchema, { seconds: 2_000n }));

    await expect(storage.events.backward("task", 1)).resolves.toEqual([]);
    expect(client.queryLimits.every((limit) => limit <= 128)).toBe(true);
  }, 30_000);

  it("commits generated families atomically and converges an identical retry", async () => {
    const backend = new HistoryDatastoreBackend();
    const store = factory(backend);
    const entity = input();
    const commit = EntityCommitStorageFactories.create(store, entity);
    const mutation = {
      context: entity.context,
      entity,
      entityId: "task",
      next: record("one", 1),
      states: [record("one", 1)],
      diagnostics: [event("diagnostic", 1)],
      events: [event("delivery", 1)],
    };
    await expect(commit.commit(mutation)).resolves.toBe("committed");
    await expect(commit.commit(mutation)).resolves.toBe("committed");
    expect(backend.entities).toHaveLength(4);
  });

  it("rejects a divergent immutable history row inside an Entity commit", async () => {
    const entity = input();
    const commits = EntityCommitStorageFactories.create(
      factory(new HistoryDatastoreBackend()),
      entity,
    );
    const current = record("current", 1);
    await commits.commit({
      context: entity.context,
      entity,
      entityId: "task",
      next: current,
      states: [record("retained", 1)],
    });

    await expect(
      commits.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: current,
        states: [record("changed", 1)],
      }),
    ).rejects.toThrow("divergent");
  });

  it("treats an event without version or timestamp as version zero for its producer", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    await storage.events.append(
      create(EventSchema, {
        id: create(EventIdSchema, { value: "unversioned" }),
        context: { producerId: pack("task") },
      }),
    );
    await storage.events.append(
      create(EventSchema, {
        id: create(EventIdSchema, { value: "unversioned-second" }),
        context: { producerId: pack("task") },
      }),
    );

    await expect(storage.events.backward("task", 2, 0n)).resolves.toHaveLength(2);
    await storage.events.truncate(create(TimestampSchema, { seconds: 1n }));
    await expect(storage.events.backward("task", 1)).resolves.toEqual([]);
  });

  it("rejects a conflicting current record and rolls back an unapplied provider failure", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();
    const entity = input();
    const commit = EntityCommitStorageFactories.create(store, entity);
    await commit.commit({
      context: entity.context,
      entity,
      entityId: "task",
      next: record("one", 1),
    });
    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: "task",
        expected: record("wrong", 1),
        next: record("two", 2),
      }),
    ).resolves.toBe("conflict");
    const original = client.transaction.bind(client);
    client.transaction = () => {
      const transaction = original();
      transaction.commit = () => Promise.reject(new Error("provider unavailable"));
      return transaction;
    };
    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: "task",
        expected: record("one", 1),
        next: record("two", 2),
      }),
    ).rejects.toThrow("Datastore Entity transaction failed");
    expect(await store.createEntityStorage(entity).current.read("task")).toMatchObject({
      version: { number: 1 },
    });
  });

  it("rejects a 501-row commit before starting a transaction", async () => {
    const backend = new HistoryDatastoreBackend();
    const store = factory(backend);
    const entity = input();
    await expect(
      EntityCommitStorageFactories.create(store, entity).commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("one", 1),
        events: Array.from({ length: 500 }, (_, index) => event(`event-${String(index)}`, 1)),
      }),
    ).rejects.toThrow("500-mutation");
    expect(backend.client().transactionCalls).toBe(0);
  });

  it("accepts 25 distinct groups when every other limit fits", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const entity = input();
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();
    const events = Array.from({ length: 24 }, (_, index) => event(`event-${String(index)}`, 1));
    await expect(
      EntityCommitStorageFactories.create(store, entity).commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("one", 1),
        events,
      }),
    ).resolves.toBe("committed");
    expect(backend.maxTransactionGroups).toBe(25);
  });

  it("rejects 26 groups and a payload over 9 MiB before starting a transaction", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const entity = input();
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();
    const commit = EntityCommitStorageFactories.create(store, entity);
    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("one", 1),
        events: Array.from({ length: 25 }, (_, index) => event(`event-${String(index)}`, 1)),
      }),
    ).rejects.toThrow("25 entity-group");
    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("one", 1),
        events: [largeEvent()],
      }),
    ).rejects.toThrow("payload");
    expect(client.transactionCalls).toBe(0);
  });

  it("rejects empty and duplicate delivery IDs before a transaction", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();
    const entity = input();
    const commit = EntityCommitStorageFactories.create(store, entity);
    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("one", 1),
        events: [event("", 1)],
      }),
    ).rejects.toThrow("non-blank");
    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("one", 1),
        events: [event("same", 1), event("same", 1)],
      }),
    ).rejects.toThrow("unique");
    expect(client.transactionCalls).toBe(0);
  });

  it("rolls back failed reads and commits, and retries only three aborted attempts", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const entity = input();
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();
    const commit = EntityCommitStorageFactories.create(store, entity);
    const mutation = { context: entity.context, entity, entityId: "task", next: record("one", 1) };
    backend.failTransactionRead = new Error("read failed");
    await expect(commit.commit(mutation)).rejects.toThrow("Datastore Entity transaction failed");
    expect(backend.rollbacks).toBe(1);
    backend.failTransactionRead = undefined;
    backend.failTransactionCommit = new Error("commit failed");
    await expect(commit.commit(mutation)).rejects.toThrow("Datastore Entity transaction failed");
    expect(backend.entities).toHaveLength(0);
    backend.failTransactionCommit = undefined;
    backend.abortedTransactions = 2;
    await expect(commit.commit(mutation)).resolves.toBe("committed");
    expect(client.transactionCalls).toBe(5);
    backend.abortedTransactions = 3;
    await expect(
      commit.commit({ ...mutation, expected: record("one", 1), next: record("two", 2) }),
    ).rejects.toThrow("Datastore Entity transaction failed");
    expect(client.transactionCalls).toBe(8);
  });

  it("preserves an operation failure when the compensating rollback fails", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const entity = input();
    const commits = EntityCommitStorageFactories.create(
      DatastoreStorageFactory.newBuilder()
        .setClient(client as never)
        .build(),
      entity,
    );
    backend.failTransactionRead = new Error("provider read failed");
    backend.failRollback = new Error("rollback failed");

    await expect(
      commits.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("current", 1),
      }),
    ).rejects.toThrow("Datastore Entity transaction failed");
    expect(backend.rollbacks).toBe(1);
  });

  it("closes Entity and commit handles idempotently", async () => {
    const entity = input();
    const store = factory(new HistoryDatastoreBackend());
    const handle = store.createEntityStorage(entity);

    handle.close();
    handle.close();
    expect(handle.isOpen()).toBe(false);
    await expect(handle.current.read("task")).rejects.toThrow("closed");
    await expect(handle.states.backward("task", 1)).rejects.toThrow("closed");
    await expect(handle.events.backward("task", 1)).rejects.toThrow("closed");

    const commits = EntityCommitStorageFactories.create(store, entity);
    commits.close();
    commits.close();
    await expect(
      commits.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("current", 1),
      }),
    ).rejects.toThrow("closed");
  });
});

function largeEvent() {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: "large" }),
    message: create(AnySchema, {
      typeUrl: "type.spine.test/Large",
      value: new Uint8Array(10 * 1024 * 1024),
    }),
  });
}
