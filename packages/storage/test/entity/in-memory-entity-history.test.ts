import { create, fromBinary, ScalarType, toBinary } from "@bufbuild/protobuf";
import {
  AnySchema,
  StringValueSchema,
  TimestampSchema,
  type StringValue,
} from "@bufbuild/protobuf/wkt";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import {
  EnrichmentSchema,
  EventIdSchema,
  EventSchema,
  type Event,
} from "@spine-event-engine/proto";
import { describe, expect, it, vi } from "vitest";

import type { EntityStorageConformance } from "../../src/entity/history-conformance.js";
import { EntityHistoryConformance } from "../../src/entity/history-conformance.js";
import {
  disabledEventHistoryPort,
  disabledStateHistoryPort,
} from "../../src/entity/entity-history-storage.js";
import { eventHistorySpec, stateHistorySpec } from "../../src/entity/entity-history-record-spec.js";
import type { EntityStorageInput } from "../../src/memory/in-memory-entity-history.js";
import {
  MemoryEntityEventHistory,
  MemoryEntityRecordStorage,
  InMemoryEntityHistory,
  type InMemoryMaintenance,
} from "../../src/memory/in-memory-entity-history.js";
import { InMemoryStorageFactory } from "../../src/memory/in-memory-storage-factory.js";
import { RecordColumn } from "../../src/record/record-column.js";
import { ColumnTypes } from "../../src/record/column-type.js";

describe("InMemoryEntityHistory", () => {
  it("passes the reusable generated current-record and state-history conformance checks", async () => {
    const factory = new InMemoryStorageFactory();
    const adapter = {
      create: (entity: EntityStorageInput<string, StringValue>) =>
        factory.createEntityStorage(entity) as EntityStorageConformance<string, StringValue>,
      reopen: (entity: EntityStorageInput<string, StringValue>) =>
        factory.createEntityStorage(entity) as EntityStorageConformance<string, StringValue>,
    };
    await EntityHistoryConformance.check(adapter);
  });

  it("keeps disabled history ports readable and maintenance-safe without writes", async () => {
    const states = disabledStateHistoryPort<string, StringValue>();
    const events = disabledEventHistoryPort<string>();
    await expect(states.backward("task", 1)).resolves.toEqual([]);
    await expect(states.stateAt("task", create(TimestampSchema))).resolves.toBeUndefined();
    await expect(states.trim("task", 0)).resolves.toBeUndefined();
    await expect(states.truncate(create(TimestampSchema))).resolves.toBeUndefined();
    await expect(events.backward("task", 1)).resolves.toEqual([]);
    await expect(events.truncate(create(TimestampSchema))).resolves.toBeUndefined();
    states.close();
    events.close();
    await expect(states.append(record("task", "state", 1))).rejects.toThrow(/disabled/);
    await expect(events.append(event("event", "task", 1, 1))).rejects.toThrow(/disabled/);
  });
  it("stores cloned current records and applies declared current-record query columns", async () => {
    const current = new MemoryEntityRecordStorage({
      idKey: (id: string) => id,
      unpackId: (id) =>
        id.typeUrl.endsWith(`/${StringValueSchema.typeName}`)
          ? fromBinary(StringValueSchema, id.value).value
          : undefined,
      columns: [
        new RecordColumn(
          "value",
          ColumnTypes.scalar(ScalarType.STRING),
          (entry) => state(entry).value,
        ),
        new RecordColumn(
          "archived",
          ColumnTypes.scalar(ScalarType.BOOL),
          (entry) => entry.lifecycleFlags?.archived ?? false,
        ),
      ],
    });
    const active = currentRecord("active", "active", 1);
    await current.write(active);
    if (active.state === undefined) throw new Error("Expected current state.");
    active.state.value[0] = 0;
    await current.write(currentRecord("archived", "archived", 2, true));
    await current.write(currentRecord("deleted", "deleted", 3, false, true));

    const storedActive = await current.read("active");
    if (storedActive === undefined) throw new Error("Expected stored current state.");
    expect(state(storedActive).value).toBe("active");
    expect(
      (
        await current.query({
          predicate: { kind: "comparison", column: "archived", operator: "equal", value: false },
          order: [{ column: "value", direction: "asc" }],
        })
      ).map((entry) => entry.id),
    ).toEqual(["active"]);
    await expect(
      current.write(create(EntityRecordSchema, { entityId: create(AnySchema) })),
    ).rejects.toThrow(/ID schema/);
  });

  it("does not open grouped state storage when state history is disabled", async () => {
    const factory = new InMemoryStorageFactory();
    const createStorage = vi.spyOn(factory, "createRecordStorage");
    const storage = factory.createEntityStorage(input(false)) as EntityStorageConformance<
      string,
      StringValue
    >;
    await expect(storage.states.append(record("task", "first", 1))).rejects.toThrow(/disabled/);
    expect(createStorage).not.toHaveBeenCalled();

    const layout = stateHistorySpec(StringValueSchema);
    const raw = factory.createRecordStorage(input(false).context, layout.spec, layout.group);
    await expect(raw.query()).resolves.toEqual([]);
  });

  it("stores generated EntityRecord rows in the grouped state-history storage", async () => {
    const factory = new InMemoryStorageFactory();
    const storage = factory.createEntityStorage(input(true)) as EntityStorageConformance<
      string,
      StringValue
    >;
    const first = record("task", "first", 1);
    const second = record("task", "second", 2);
    await storage.states.append(first);
    await storage.states.append(second);

    const backward = await storage.states.backward("task", 2);
    expect(backward.map((entry) => state(entry).value)).toEqual(["second", "first"]);
    expect(await storage.states.stateAt("task", create(TimestampSchema, { seconds: 1n }))).toEqual(
      create(StringValueSchema, { value: "first" }),
    );

    const layout = stateHistorySpec(StringValueSchema);
    const raw = factory.createRecordStorage(input(true).context, layout.spec, layout.group);
    expect(await raw.query()).toEqual([first, second]);
  });

  it("uses the packed Entity ID, version, and creation time for record selection", async () => {
    const factory = new InMemoryStorageFactory();
    const storage = factory.createEntityStorage(input(true)) as EntityStorageConformance<
      string,
      StringValue
    >;
    await storage.states.append(record("task", "first", 1));
    await storage.states.append(record("task", "second", 2));
    await storage.states.append(record("other", "other", 3));

    expect(
      (await storage.states.backward("task", 5, 2n)).map((entry) => state(entry).value),
    ).toEqual(["first"]);
    await storage.states.trim("task", 1);
    expect((await storage.states.backward("task", 5)).map((entry) => state(entry).value)).toEqual([
      "second",
    ]);
    await storage.states.truncate(create(TimestampSchema, { seconds: 3n }));
    expect(await storage.states.backward("task", 5)).toEqual([]);
    expect((await storage.states.backward("other", 5)).map((entry) => state(entry).value)).toEqual([
      "other",
    ]);
  });

  it("clones generated records, rejects invalid IDs, and keeps identical retries idempotent", async () => {
    const history = createHistory();
    const first = record("task", "first", 1);
    await history.append(first);
    await history.append(first);
    if (first.state === undefined) throw new Error("Expected state history value.");
    first.state.value[0] = 0;

    const [stored] = await history.backward("task", 1);
    expect(stored).not.toBe(first);
    if (stored === undefined) throw new Error("Expected stored history value.");
    expect(state(stored).value).toBe("first");
    await expect(
      history.append(
        create(EntityRecordSchema, { state: pack(create(StringValueSchema, { value: "bad" })) }),
      ),
    ).rejects.toThrow(/entityId/i);
    await expect(
      history.append(
        create(EntityRecordSchema, {
          entityId: pack(create(StringValueSchema, { value: "task" })),
        }),
      ),
    ).rejects.toThrow(/version/i);
    await expect(
      history.append(
        create(EntityRecordSchema, {
          entityId: pack(create(StringValueSchema, { value: "task" })),
          version: { number: 2 },
        }),
      ),
    ).rejects.toThrow(/timestamp/i);
    await expect(
      history.append(
        create(EntityRecordSchema, {
          entityId: pack(create(StringValueSchema, { value: "task" })),
          version: { number: 2, timestamp: create(TimestampSchema) },
        }),
      ),
    ).rejects.toThrow(/state/i);
    await expect(history.append(record("task", "changed", 1))).rejects.toThrow(/divergent/);
  });

  it("uses version as the time-tie breaker and preserves exclusive continuations", async () => {
    const history = createHistory();
    await history.append(record("task", "one", 1, 5));
    await history.append(record("task", "two", 2, 5));
    await history.append(record("task", "three", 3, 4));

    expect(await history.stateAt("task", create(TimestampSchema, { seconds: 5n }))).toEqual(
      create(StringValueSchema, { value: "two" }),
    );
    expect((await history.backward("task", 10, 3n)).map((entry) => state(entry).value)).toEqual([
      "two",
      "one",
    ]);
  });

  it("isolates state histories by tenant and supports close behavior", async () => {
    const factory = new InMemoryStorageFactory();
    const tenant = input(true, { name: "Tasks", multitenant: true, tenantId: "tenant-a" } as never);
    const other = input(true, { name: "Tasks", multitenant: true, tenantId: "tenant-b" } as never);
    const first = factory.createEntityStorage(tenant) as EntityStorageConformance<
      string,
      StringValue
    >;
    const second = factory.createEntityStorage(other) as EntityStorageConformance<
      string,
      StringValue
    >;
    await first.states.append(record("task", "first", 1));
    expect(await second.states.backward("task", 1)).toEqual([]);
    first.close?.();
    await expect(first.states.backward("task", 1)).rejects.toThrow(/closed/i);
  });

  it("validates bounded reads and trims large histories in maintenance chunks", async () => {
    let chunks = 0;
    const history = createHistory({ batchSize: 3, onChunk: () => void chunks++ });
    for (let version = 1; version <= 17; version++) {
      await history.append(record("task", String(version), version));
    }
    await expect(history.backward("task", 0)).rejects.toThrow(/positive safe integer/);
    await expect(history.trim("task", -1)).rejects.toThrow(/non-negative safe integer/);
    await history.trim("task", 5);
    expect((await history.backward("task", 10)).map((entry) => state(entry).value)).toEqual([
      "17",
      "16",
      "15",
      "14",
      "13",
    ]);
    expect(chunks).toBe(4);
  });

  it("uses bounded record-storage windows for history reads and maintenance", async () => {
    const factory = new InMemoryStorageFactory();
    const entity = input(true);
    const layout = stateHistorySpec(StringValueSchema);
    const records = factory.createRecordStorage(entity.context, layout.spec, layout.group);
    const history = new InMemoryEntityHistory({
      id: entity.id,
      records,
      stateSchema: StringValueSchema,
      maintenance: { batchSize: 2 },
    });
    for (let version = 1; version <= 5; version++) {
      await history.append(record("task", String(version), version));
    }
    const query = vi.spyOn(records, "query");
    const queryEntries = vi.spyOn(records, "queryEntries");

    await history.backward("task", 1);
    await history.stateAt("task", create(TimestampSchema, { seconds: 2n }));
    await history.trim("task", 1);
    await history.truncate(create(TimestampSchema, { seconds: 5n }));

    for (const call of [...query.mock.calls, ...queryEntries.mock.calls]) {
      expect(call[0]?.limit).toBeDefined();
    }
  });

  it("continues state-history reads and maintenance across bounded pages", async () => {
    const history = createHistory({ batchSize: 2, pageSize: 2 });
    for (let version = 1; version <= 5; version++) {
      await history.append(record("task", String(version), version));
    }

    expect((await history.backward("task", 3, 5n)).map((entry) => state(entry).value)).toEqual([
      "4",
      "3",
      "2",
    ]);
    expect(await history.stateAt("task", create(TimestampSchema, { seconds: 3n }))).toEqual(
      create(StringValueSchema, { value: "3" }),
    );
    await history.trim("task", 1);
    expect((await history.backward("task", 5)).map((entry) => state(entry).value)).toEqual(["5"]);

    const truncation = createHistory({ batchSize: 2, pageSize: 2 });
    for (let version = 1; version <= 5; version++) {
      await truncation.append(record("task", String(version), version));
    }
    await truncation.truncate(create(TimestampSchema, { seconds: 5n }));
    expect((await truncation.backward("task", 5)).map((entry) => state(entry).value)).toEqual([
      "5",
    ]);
  });

  it("continues equal-created state versions across keyset page boundaries", async () => {
    const history = createHistory({ batchSize: 2, pageSize: 2 });
    for (let version = 1; version <= 5; version++) {
      await history.append(record("task", String(version), version, 7));
    }
    expect((await history.backward("task", 5)).map((entry) => state(entry).value)).toEqual([
      "5",
      "4",
      "3",
      "2",
      "1",
    ]);
    expect(await history.stateAt("task", create(TimestampSchema, { seconds: 7n }))).toEqual(
      create(StringValueSchema, { value: "5" }),
    );
    await history.trim("task", 1);
    expect((await history.backward("task", 5)).map((entry) => state(entry).value)).toEqual(["5"]);
  });

  it("keeps an append queued during trim and retains an append after truncate selects rows", async () => {
    const selection = deferred();
    const reached = deferred();
    const history = createHistory({
      afterSelection: () => {
        reached.resolve(undefined);
        return selection.promise;
      },
    });
    await history.append(record("task", "one", 1));
    await history.append(record("task", "two", 2));
    const trimming = history.trim("task", 1);
    await reached.promise;
    const append = history.append(record("task", "three", 3));
    selection.resolve(undefined);
    await Promise.all([trimming, append]);
    expect((await history.backward("task", 5)).map((entry) => state(entry).value)).toEqual([
      "three",
      "two",
    ]);

    const laterSelection = deferred();
    const laterReached = deferred();
    const later = createHistory({
      afterSelection: () => {
        laterReached.resolve(undefined);
        return laterSelection.promise;
      },
    });
    await later.append(record("task", "old", 1));
    const truncating = later.truncate(create(TimestampSchema, { seconds: 2n }));
    await laterReached.promise;
    const appended = later.append(record("task", "new", 2));
    laterSelection.resolve(undefined);
    await Promise.all([truncating, appended]);
    expect((await later.backward("task", 5)).map((entry) => state(entry).value)).toEqual(["new"]);
  });

  it("does not open grouped event storage when event history is disabled", async () => {
    const factory = new InMemoryStorageFactory();
    const createStorage = vi.spyOn(factory, "createRecordStorage");
    const storage = factory.createEntityStorage(input(false)) as EntityStorageConformance<
      string,
      StringValue
    > & { readonly events: MemoryEntityEventHistory<string> };
    await expect(storage.events.append(event("event", "task", 1, 1))).rejects.toThrow(/disabled/);
    expect(createStorage).not.toHaveBeenCalled();
  });

  it("stores generated Events in the grouped event history with durable ordering", async () => {
    const factory = new InMemoryStorageFactory();
    const entity = input(false);
    const storage = factory.createEntityStorage({ ...entity, eventHistory: true }) as {
      readonly events: MemoryEntityEventHistory<string>;
    };
    for (const id of ["a", "é", "\uE000", "\u{10000}"]) {
      await storage.events.append(event(id, "task", 2, 2));
    }
    await storage.events.append(event("old", "task", 1, 1));
    expect((await storage.events.backward("task", 5)).map((entry) => entry.id?.value)).toEqual([
      "\u{10000}",
      "\uE000",
      "é",
      "a",
      "old",
    ]);
    expect((await storage.events.backward("task", 5, 2n)).map((entry) => entry.id?.value)).toEqual([
      "old",
    ]);

    const layout = eventHistorySpec(StringValueSchema);
    const raw = factory.createRecordStorage(entity.context, layout.spec, layout.group);
    expect((await raw.query()).map((entry) => entry.id?.value).sort()).toEqual(
      ["a", "old", "é", "\uE000", "\u{10000}"].sort(),
    );
  });

  it("validates event IDs and producer IDs, clones reads, and detects divergent retries", async () => {
    const history = createEventHistory();
    const first = event("event", "task", 1, 1);
    await history.append(first);
    await history.append(first);
    if (first.id === undefined) throw new Error("Expected Event ID.");
    first.id.value = "changed";
    expect((await history.backward("task", 1))[0]?.id?.value).toBe("event");
    await expect(history.append(event("event", "other", 1, 1))).rejects.toThrow(/divergent/);
    await expect(history.append(create(EventSchema))).rejects.toThrow(/event ID/);
    await expect(
      history.append(create(EventSchema, { id: create(EventIdSchema, { value: "missing" }) })),
    ).rejects.toThrow(/producer ID/);
    await expect(
      history.append(
        create(EventSchema, {
          id: create(EventIdSchema, { value: "missing-version" }),
          context: { producerId: pack(create(StringValueSchema, { value: "task" })) },
        }),
      ),
    ).rejects.toThrow(/version/);
    await expect(
      history.append(
        create(EventSchema, {
          id: create(EventIdSchema, { value: "missing-time" }),
          context: {
            producerId: pack(create(StringValueSchema, { value: "task" })),
            version: { number: 1 },
          },
        }),
      ),
    ).rejects.toThrow(/timestamp/);
    const enriched = event("enriched", "task", 2, 2);
    if (enriched.context === undefined) throw new Error("Expected Event context.");
    enriched.context.enrichment = create(EnrichmentSchema);
    await history.append(enriched);
    expect(
      (await history.backward("task", 5)).find((entry) => entry.id?.value === "enriched")?.context
        ?.enrichment,
    ).toBeUndefined();
  });

  it("rejects one divergent concurrent append for the same event ID", async () => {
    const history = createEventHistory();
    const outcomes = await Promise.allSettled([
      history.append(event("same", "task", 1, 1)),
      history.append(event("same", "task", 2, 2)),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect((await history.backward("task", 2)).map((entry) => entry.id?.value)).toEqual(["same"]);
  });

  it("truncates selected generated events in bounded chunks and respects closure", async () => {
    let chunks = 0;
    const history = createEventHistory({ batchSize: 2, onChunk: () => void chunks++ });
    for (let version = 1; version <= 5; version++) {
      await history.append(event(`event-${String(version)}`, "task", version, version));
    }
    await history.truncate(create(TimestampSchema, { seconds: 5n }));
    expect((await history.backward("task", 10)).map((entry) => entry.id?.value)).toEqual([
      "event-5",
    ]);
    expect(chunks).toBe(2);
    history.close();
    await expect(history.backward("task", 1)).rejects.toThrow(/closed/);
  });

  it("continues event-history reads and truncation across bounded pages", async () => {
    const history = createEventHistory({ batchSize: 2, pageSize: 2 });
    for (let version = 1; version <= 5; version++) {
      await history.append(event(`event-${String(version)}`, "task", version, version));
    }

    expect((await history.backward("task", 3, 5n)).map((entry) => entry.id?.value)).toEqual([
      "event-4",
      "event-3",
      "event-2",
    ]);
    await history.truncate(create(TimestampSchema, { seconds: 5n }));
    expect((await history.backward("task", 5)).map((entry) => entry.id?.value)).toEqual([
      "event-5",
    ]);
  });

  it("continues equal event ordering ties with non-BMP IDs across pages", async () => {
    const history = createEventHistory({ batchSize: 2, pageSize: 2 });
    for (const id of ["a", "é", "\uE000", "\u{10000}", "\u{10001}"]) {
      await history.append(event(id, "task", 7, 7));
    }
    expect((await history.backward("task", 5)).map((entry) => entry.id?.value)).toEqual([
      "\u{10001}",
      "\u{10000}",
      "\uE000",
      "é",
      "a",
    ]);
    await history.truncate(create(TimestampSchema, { seconds: 8n }));
    expect(await history.backward("task", 5)).toEqual([]);
  });

  it("selects the canonical UTF-8 event ID from the first tied page", async () => {
    const history = createEventHistory({ batchSize: 2, pageSize: 2 });
    for (const id of ["\uE000", "\u{10000}", "\u{10001}"]) {
      await history.append(event(id, "task", 7, 7));
    }

    expect((await history.backward("task", 1)).map((entry) => entry.id?.value)).toEqual([
      "\u{10001}",
    ]);
  });

  it("resumes event truncation after a chunk failure and preserves an event appended after selection", async () => {
    let chunks = 0;
    const failed = createEventHistoryBundle({
      batchSize: 1,
      onChunk: () => {
        if (++chunks === 1) throw new Error("injected");
      },
    });
    for (let version = 1; version <= 3; version++) {
      await failed.history.append(event(`event-${String(version)}`, "task", version, version));
    }
    await expect(failed.history.truncate(create(TimestampSchema, { seconds: 4n }))).rejects.toThrow(
      "injected",
    );
    await failed.reopen().truncate(create(TimestampSchema, { seconds: 4n }));
    expect(await failed.reopen().backward("task", 5)).toEqual([]);

    const selected = deferred();
    const reached = deferred();
    const concurrent = createEventHistory({
      afterSelection: () => {
        reached.resolve(undefined);
        return selected.promise;
      },
    });
    await concurrent.append(event("old", "task", 1, 1));
    const truncating = concurrent.truncate(create(TimestampSchema, { seconds: 2n }));
    await reached.promise;
    const appended = concurrent.append(event("\u{10000}", "task", 2, 1));
    selected.resolve(undefined);
    await Promise.all([truncating, appended]);
    expect((await concurrent.backward("task", 5)).map((entry) => entry.id?.value)).toEqual([
      "\u{10000}",
    ]);
  });

  it("isolates event history by tenant and retains large histories in declared order", async () => {
    const factory = new InMemoryStorageFactory();
    const tenant = input(false, {
      name: "Tasks",
      multitenant: true,
      tenantId: "tenant-a",
    } as never);
    const other = input(false, { name: "Tasks", multitenant: true, tenantId: "tenant-b" } as never);
    const first = factory.createEntityStorage({ ...tenant, eventHistory: true }) as {
      readonly events: MemoryEntityEventHistory<string>;
    };
    const second = factory.createEntityStorage({ ...other, eventHistory: true }) as {
      readonly events: MemoryEntityEventHistory<string>;
    };
    for (let version = 1; version <= 250; version++) {
      await first.events.append(event(`event-${String(version)}`, "task", version, version));
    }
    expect(await second.events.backward("task", 1)).toEqual([]);
    expect((await first.events.backward("task", 3)).map((entry) => entry.id?.value)).toEqual([
      "event-250",
      "event-249",
      "event-248",
    ]);
    await expect(first.events.backward("task", 0)).rejects.toThrow(/positive safe integer/);
  });
});

function input(
  stateHistory: boolean,
  context = { name: "Tasks", multitenant: false as const },
): EntityStorageInput<string, StringValue> {
  return {
    context,
    id: {
      clone: (id) => id,
      key: (id) => id,
      pack: (id) => pack(create(StringValueSchema, { value: id })),
      unpack: (id) =>
        id.typeUrl.endsWith(`/${StringValueSchema.typeName}`)
          ? fromBinary(StringValueSchema, id.value).value
          : undefined,
    },
    columns: [],
    sourceType: StringValueSchema,
    stateSchema: StringValueSchema,
    stateHistory,
  };
}

function createHistory(maintenance?: InMemoryMaintenance) {
  const factory = new InMemoryStorageFactory();
  const entity = input(true);
  const layout = stateHistorySpec(StringValueSchema);
  return new InMemoryEntityHistory({
    id: entity.id,
    records: factory.createRecordStorage(entity.context, layout.spec, layout.group),
    stateSchema: StringValueSchema,
    ...(maintenance === undefined ? {} : { maintenance }),
  });
}

function createEventHistory(maintenance?: InMemoryMaintenance) {
  return createEventHistoryBundle(maintenance).history;
}

function createEventHistoryBundle(maintenance?: InMemoryMaintenance) {
  const factory = new InMemoryStorageFactory();
  const entity = input(false);
  const layout = eventHistorySpec(StringValueSchema);
  const records = factory.createRecordStorage(entity.context, layout.spec, layout.group);
  return {
    history: new MemoryEntityEventHistory({
      id: entity.id,
      records,
      ...(maintenance === undefined ? {} : { maintenance }),
    }),
    reopen: () =>
      new MemoryEntityEventHistory({
        id: entity.id,
        records,
      }),
  };
}

function record(id: string, value: string, version: number, created = version): EntityRecord {
  return create(EntityRecordSchema, {
    entityId: pack(create(StringValueSchema, { value: id })),
    state: pack(create(StringValueSchema, { value })),
    version: { number: version, timestamp: create(TimestampSchema, { seconds: BigInt(created) }) },
  });
}

function currentRecord(
  id: string,
  value: string,
  version: number,
  archived = false,
  deleted = false,
): EntityRecord {
  return create(EntityRecordSchema, {
    entityId: pack(create(StringValueSchema, { value: id })),
    state: pack(create(StringValueSchema, { value })),
    version: { number: version },
    lifecycleFlags: { archived, deleted },
  });
}

function pack(value: StringValue) {
  return create(AnySchema, {
    typeUrl: `type.spine.io/${StringValueSchema.typeName}`,
    value: toBinary(StringValueSchema, value),
  });
}

function state(record: EntityRecord) {
  if (record.state === undefined) throw new Error("Entity record has no state.");
  return fromBinary(StringValueSchema, record.state.value);
}

function event(id: string, producer: string, version: number, timestamp: number): Event {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    context: {
      producerId: pack(create(StringValueSchema, { value: producer })),
      version: { number: version },
      timestamp: create(TimestampSchema, { seconds: BigInt(timestamp) }),
    },
  });
}

function deferred<T = undefined>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((fulfilled) => {
    resolve = fulfilled;
  });
  return { promise, resolve };
}
