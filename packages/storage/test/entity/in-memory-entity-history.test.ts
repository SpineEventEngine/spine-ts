import { create } from "@bufbuild/protobuf";
import { AnySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import {
  MemoryEntityEventHistory,
  MemoryEntityRecordStorage,
  InMemoryEntityHistory,
  MemoryEntityStorageFactory,
} from "../../src/memory/in-memory-entity-history.js";
import { InMemoryStorageBackend } from "../../src/index.js";
import { EntityHistoryConformance } from "../../src/internal/entity-history.js";

describe("InMemoryEntityHistory", () => {
  it("uses isolated default current-record storage and ID cloning", async () => {
    const storage = new MemoryEntityRecordStorage({
      columns: [],
      extractId: () => "task",
      stateSchema: StringValueSchema,
      idKey: (id: string) => id,
    });
    await expect(storage.read("missing")).resolves.toBeUndefined();
    await storage.write({
      id: "task",
      state: createString("current"),
      version: 1n,
      archived: false,
      deleted: false,
    });
    await expect(storage.read("task")).resolves.toMatchObject({
      id: "task",
      state: { value: "current" },
    });
  });

  it("passes the shared adapter conformance fixture", async () => {
    const factory = new MemoryEntityStorageFactory();
    await EntityHistoryConformance.check({
      create: (input) => factory.create(input),
      reopen: (input) => factory.create(input),
    });
  });

  it("orders producer events by version, time, and descending event ID", async () => {
    const events = new MemoryEntityEventHistory({ idKey: (id: string) => id });
    for (const id of ["a", "z", "b"])
      await events.append({
        entityId: "one",
        event: event(id),
        producerVersion: 2n,
        createdAt: timestamp(2),
      });
    await events.append({
      entityId: "one",
      event: event("old"),
      producerVersion: 1n,
      createdAt: timestamp(1),
    });
    await events.append({
      entityId: "two",
      event: event("other"),
      producerVersion: 3n,
      createdAt: timestamp(3),
    });
    await expect(events.backward("one", 3)).resolves.toMatchObject([
      { id: { value: "z" } },
      { id: { value: "b" } },
      { id: { value: "a" } },
    ]);
    await expect(events.backward("one", 10, 2n)).resolves.toMatchObject([{ id: { value: "old" } }]);
    await events.append({
      entityId: "one",
      event: event("a"),
      producerVersion: 2n,
      createdAt: timestamp(2),
    });
    await expect(
      events.append({
        entityId: "one",
        event: event("a"),
        producerVersion: 2n,
        createdAt: timestamp(9),
      }),
    ).rejects.toThrow(/divergent/);
  });
  it("isolates compatible scoped records across default factory backends", async () => {
    const firstFactory = new MemoryEntityStorageFactory();
    const secondFactory = new MemoryEntityStorageFactory();
    const input = {
      context: { name: "Tasks", multitenant: false },
      id: { clone: (id: string) => id, key: (id: string) => id },
      extractId: () => "task",
      columns: [],
      sourceType: StringValueSchema,
      stateSchema: StringValueSchema,
    };
    const first = firstFactory.create(input);
    const second = secondFactory.create(input);
    await first.current.write({
      id: "task",
      state: create(StringValueSchema, { value: "current" }),
      version: 1n,
      archived: true,
      deleted: false,
    });
    await expect(second.current.read("task")).resolves.toBeUndefined();
  });
  it("shares entity rows with one backend token and isolates distinct source types", async () => {
    const backend = new InMemoryStorageBackend();
    const firstFactory = new MemoryEntityStorageFactory(backend);
    const secondFactory = new MemoryEntityStorageFactory(backend);
    const input = entityStorageInput();
    const first = firstFactory.create(input);
    const second = secondFactory.create(input);
    await first.current.write({
      id: "task",
      state: createString("current"),
      version: 1n,
      archived: false,
      deleted: false,
    });

    await expect(second.current.read("task")).resolves.toMatchObject({
      state: { value: "current" },
    });
    const otherSource = secondFactory.create({ ...input, sourceType: AnySchema });
    await expect(otherSource.current.read("task")).resolves.toBeUndefined();
  });

  it("length-delimits context, tenant, and source-type scopes without collisions", async () => {
    const factory = new MemoryEntityStorageFactory();
    const first = factory.create(
      entityStorageInput({
        context: { name: "ab", multitenant: true, tenantId: "c" },
      }),
    );
    const tupleCollision = factory.create(
      entityStorageInput({
        context: { name: "a", multitenant: true, tenantId: "bc" },
      }),
    );
    const otherTenant = factory.create(
      entityStorageInput({
        context: { name: "ab", multitenant: true, tenantId: "other" },
      }),
    );
    const otherSource = factory.create({ ...entityStorageInput(), sourceType: AnySchema });
    await first.current.write({
      id: "task",
      state: createString("current"),
      version: 1n,
      archived: false,
      deleted: false,
    });

    await expect(tupleCollision.current.read("task")).resolves.toBeUndefined();
    await expect(otherTenant.current.read("task")).resolves.toBeUndefined();
    await expect(otherSource.current.read("task")).resolves.toBeUndefined();
  });

  it("shares one explicit multitenant tenant scope without colliding with single-tenant storage", async () => {
    const factory = new MemoryEntityStorageFactory();
    const firstTenant = factory.create(
      entityStorageInput({
        context: { name: "TenantScopeTest", multitenant: true, tenantId: "tenant" },
      }),
    );
    const sameTenant = factory.create(
      entityStorageInput({
        context: { name: "TenantScopeTest", multitenant: true, tenantId: "tenant" },
      }),
    );
    const singleTenant = factory.create(
      entityStorageInput({ context: { name: "TenantScopeTest", multitenant: false } }),
    );
    await firstTenant.current.write({
      id: "task",
      state: createString("tenantless"),
      version: 1n,
      archived: false,
      deleted: false,
    });

    await expect(sameTenant.current.read("task")).resolves.toMatchObject({
      state: { value: "tenantless" },
    });
    await expect(singleTenant.current.read("task")).resolves.toBeUndefined();
  });

  it("rejects missing and blank multitenant tenant IDs before opening entity storage", () => {
    const factory = new MemoryEntityStorageFactory();
    for (const tenantId of [undefined, "", " "]) {
      expect(() =>
        factory.create(
          entityStorageInput({
            context: {
              name: "TenantValidation",
              multitenant: true,
              ...(tenantId === undefined ? {} : { tenantId }),
            },
          }),
        ),
      ).toThrow(/tenant/i);
    }
  });
  it("reads state history newest-first and answers temporal state reads", async () => {
    const history = new InMemoryEntityHistory({
      stateSchema: StringValueSchema,
      idKey: (id: string) => id,
    });
    await history.append({
      entityId: "task-1",
      state: create(StringValueSchema, { value: "first" }),
      version: 1n,
      createdAt: timestamp(1),
    });
    await history.append({
      entityId: "task-1",
      state: create(StringValueSchema, { value: "second" }),
      version: 2n,
      createdAt: timestamp(2),
    });

    await expect(history.backward("task-1", 2)).resolves.toMatchObject([
      { state: { value: "second" } },
      { state: { value: "first" } },
    ]);
    await expect(history.stateAt("task-1", timestamp(1))).resolves.toMatchObject({
      value: "first",
    });
  });

  it("returns independently cloned versioned state-history records", async () => {
    const history = new InMemoryEntityHistory({
      stateSchema: StringValueSchema,
      idKey: (id: { value: string }) => id.value,
    });
    const entityId = { value: "task" };
    await history.append({
      entityId,
      state: create(StringValueSchema, { value: "first" }),
      version: 5n,
      createdAt: timestamp(7),
    });

    const [record] = await history.backward(entityId, 1);
    expect(record).toMatchObject({
      entityId: { value: "task" },
      state: { value: "first" },
      version: 5n,
      createdAt: { seconds: 7n, nanos: 0 },
    });
    expect(record?.entityId).not.toBe(entityId);
    expect(record?.createdAt).not.toBe((await history.backward(entityId, 1))[0]?.createdAt);
  });

  it("makes identical retries no-ops and excludes the continuation version", async () => {
    const history = new InMemoryEntityHistory({
      stateSchema: StringValueSchema,
      idKey: (id: string) => id,
    });
    const first = {
      entityId: "task",
      state: create(StringValueSchema, { value: "one" }),
      version: 1n,
      createdAt: timestamp(1),
    };
    await history.append(first);
    await history.append(first);
    await history.append({
      ...first,
      version: 2n,
      state: create(StringValueSchema, { value: "two" }),
      createdAt: timestamp(2),
    });
    await expect(history.backward("task", 2, 2n)).resolves.toMatchObject([
      { state: { value: "one" } },
    ]);
    await expect(
      history.append({ ...first, state: create(StringValueSchema, { value: "changed" }) }),
    ).rejects.toThrow(/divergent/);
  });

  it("uses canonical state temporal ties and exclusive version continuation", async () => {
    const history = new InMemoryEntityHistory({
      stateSchema: StringValueSchema,
      idKey: (id: string) => id,
    });
    await history.append({ ...stateRecord(1), createdAt: timestamp(5) });
    await history.append({ ...stateRecord(2), createdAt: timestamp(5) });
    await history.append({ ...stateRecord(3), createdAt: timestamp(4) });

    await expect(history.stateAt("task", timestamp(5))).resolves.toMatchObject({ value: "2" });
    await expect(history.backward("task", 10, 3n)).resolves.toMatchObject([
      { state: { value: "2" } },
      { state: { value: "1" } },
    ]);
  });

  it("orders event timestamp ties by descending canonical event-ID bytes", async () => {
    const events = new MemoryEntityEventHistory({ idKey: (id: string) => id });
    for (const id of ["\u{10000}", "\uE000"]) {
      await events.append({
        entityId: "task",
        event: event(id),
        producerVersion: 1n,
        createdAt: timestamp(1),
      });
    }

    await expect(events.backward("task", 2)).resolves.toMatchObject([
      { id: { value: "\u{10000}" } },
      { id: { value: "\uE000" } },
    ]);
  });

  it("orders one-, two-, three-, and four-byte UTF-8 event IDs canonically", async () => {
    const events = new MemoryEntityEventHistory({ idKey: (id: string) => id });
    for (const id of ["a", "é", "\uE000", "\u{10000}"]) {
      await events.append({
        entityId: "task",
        event: event(id),
        producerVersion: 1n,
        createdAt: timestamp(1),
      });
    }

    await expect(events.backward("task", 4)).resolves.toMatchObject([
      { id: { value: "\u{10000}" } },
      { id: { value: "\uE000" } },
      { id: { value: "é" } },
      { id: { value: "a" } },
    ]);
  });

  it("rejects missing and blank event IDs without retaining an event", async () => {
    const events = new MemoryEntityEventHistory({ idKey: (id: string) => id });
    for (const invalidEvent of [create(EventSchema), event(" ")]) {
      await expect(
        events.append({
          entityId: "task",
          event: invalidEvent,
          producerVersion: 1n,
          createdAt: timestamp(1),
        }),
      ).rejects.toThrow(/event ID/);
    }
    await expect(events.backward("task", 1)).resolves.toEqual([]);
  });

  it("rejects an identical event retry correlated to another canonical entity", async () => {
    const events = new MemoryEntityEventHistory({ idKey: (id: string) => id });
    const record = {
      entityId: "task-a",
      event: event("event"),
      producerVersion: 1n,
      createdAt: timestamp(1),
    };

    await events.append(record);
    await expect(events.append({ ...record, entityId: "task-b" })).rejects.toThrow(/divergent/);
  });

  it("rejects every event-history operation after close", async () => {
    const events = new MemoryEntityEventHistory({ idKey: (id: string) => id });
    events.close();

    await expect(
      events.append({
        entityId: "task",
        event: event("event"),
        producerVersion: 1n,
        createdAt: timestamp(1),
      }),
    ).rejects.toThrow(/closed/);
    await expect(events.backward("task", 1)).rejects.toThrow(/closed/);
    await expect(events.truncate(timestamp(2))).rejects.toThrow(/closed/);
  });

  it("returns short and large state and event histories without changing total order", async () => {
    const states = new InMemoryEntityHistory({
      stateSchema: StringValueSchema,
      idKey: (id: string) => id,
    });
    const events = new MemoryEntityEventHistory({ idKey: (id: string) => id });
    for (let version = 1; version <= 250; version++) {
      await states.append({ ...stateRecord(version), createdAt: timestamp(version) });
      await events.append({
        entityId: "task",
        event: event(`event-${String(version)}`),
        producerVersion: BigInt(version),
        createdAt: timestamp(version),
      });
    }

    await expect(states.backward("task", 3)).resolves.toMatchObject([
      { state: { value: "250" } },
      { state: { value: "249" } },
      { state: { value: "248" } },
    ]);
    await expect(states.backward("task", 500)).resolves.toHaveLength(250);
    await expect(events.backward("task", 3)).resolves.toMatchObject([
      { id: { value: "event-250" } },
      { id: { value: "event-249" } },
      { id: { value: "event-248" } },
    ]);
    await expect(events.backward("task", 500)).resolves.toHaveLength(250);
  });

  it("returns no temporal state when no retained state predates the requested time", async () => {
    const history = new InMemoryEntityHistory({
      stateSchema: StringValueSchema,
      idKey: (id: string) => id,
    });
    await history.append({ ...stateRecord(1), createdAt: timestamp(2) });

    await expect(history.stateAt("task", timestamp(1))).resolves.toBeUndefined();
    await expect(history.stateAt("unknown", timestamp(2))).resolves.toBeUndefined();
  });

  it("rejects invalid trim counts and history depths", async () => {
    const history = new InMemoryEntityHistory({
      stateSchema: StringValueSchema,
      idKey: (id: string) => id,
    });
    const events = new MemoryEntityEventHistory({ idKey: (id: string) => id });
    for (const count of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(history.trim("task", count)).rejects.toThrow(/non-negative safe integer/);
    }
    for (const depth of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(history.backward("task", depth)).rejects.toThrow(/positive safe integer/);
      await expect(events.backward("task", depth)).rejects.toThrow(/positive safe integer/);
    }
  });

  it("uses default record maps and omitted maintenance hooks", async () => {
    const history = new InMemoryEntityHistory({
      stateSchema: StringValueSchema,
      idKey: (id: string) => id,
    });
    const events = new MemoryEntityEventHistory({ idKey: (id: string) => id });
    await history.append(stateRecord(1));
    await events.append({
      entityId: "task",
      event: event("event"),
      producerVersion: 1n,
      createdAt: timestamp(1),
    });

    await expect(history.trim("task", 0)).resolves.toBeUndefined();
    await expect(events.truncate(timestamp(2))).resolves.toBeUndefined();
    await expect(history.backward("task", 1)).resolves.toEqual([]);
    await expect(events.backward("task", 1)).resolves.toEqual([]);
  });

  it("resumes truncate after a completed deletion chunk fails", async () => {
    let chunks = 0;
    const records = new Map<string, never>();
    const history = new InMemoryEntityHistory({
      stateSchema: StringValueSchema,
      idKey: (id: string) => id,
      records,
      maintenance: {
        onChunk: () => {
          if (++chunks === 1) throw new Error("injected");
        },
      },
    });
    for (let version = 1; version <= 3; version++)
      await history.append({
        entityId: "task",
        state: create(StringValueSchema, { value: String(version) }),
        version: BigInt(version),
        createdAt: timestamp(version),
      });
    await expect(history.truncate(timestamp(4))).rejects.toThrow("injected");
    const resumed = new InMemoryEntityHistory({
      stateSchema: StringValueSchema,
      idKey: (id: string) => id,
      records,
    });
    await resumed.truncate(timestamp(4));
    await expect(resumed.backward("task", 1)).resolves.toEqual([]);
  });

  it("resumes trim after a completed deletion chunk fails", async () => {
    let chunks = 0;
    const records = new Map<string, never>();
    const history = new InMemoryEntityHistory({
      stateSchema: StringValueSchema,
      idKey: (id: string) => id,
      records,
      maintenance: {
        onChunk: () => {
          if (++chunks === 1) throw new Error("injected");
        },
      },
    });
    for (let version = 1; version <= 3; version++) await history.append(stateRecord(version));

    await expect(history.trim("task", 1)).rejects.toThrow("injected");
    const resumed = new InMemoryEntityHistory({
      stateSchema: StringValueSchema,
      idKey: (id: string) => id,
      records,
    });
    await resumed.trim("task", 1);
    await expect(resumed.backward("task", 3)).resolves.toMatchObject([{ state: { value: "3" } }]);
  });

  it("trims only the selected entity when another entity is present", async () => {
    const history = new InMemoryEntityHistory({
      stateSchema: StringValueSchema,
      idKey: (id: string) => id,
    });
    await history.append(stateRecord(1));
    await history.append({ ...stateRecord(2), entityId: "other" });

    await history.trim("task", 0);

    await expect(history.backward("task", 1)).resolves.toEqual([]);
    await expect(history.backward("other", 1)).resolves.toMatchObject([{ state: { value: "2" } }]);
  });

  it("resumes event truncation after a completed deletion chunk fails", async () => {
    let chunks = 0;
    const records = new Map<string, never>();
    const events = new MemoryEntityEventHistory({
      idKey: (id: string) => id,
      records,
      maintenance: {
        onChunk: () => {
          if (++chunks === 1) throw new Error("injected");
        },
      },
    });
    for (let version = 1; version <= 3; version++) {
      await events.append({
        entityId: "task",
        event: event(`event-${String(version)}`),
        producerVersion: BigInt(version),
        createdAt: timestamp(version),
      });
    }

    await expect(events.truncate(timestamp(4))).rejects.toThrow("injected");
    const resumed = new MemoryEntityEventHistory({ idKey: (id: string) => id, records });
    await resumed.truncate(timestamp(4));
    await expect(resumed.backward("task", 1)).resolves.toEqual([]);
  });

  it("settles one event truncate chunk then stops when closed", async () => {
    const events = new MemoryEntityEventHistory({
      idKey: (id: string) => id,
      maintenance: {
        onChunk: () => {
          events.close();
        },
      },
    });
    await events.append({
      entityId: "task",
      event: event("first"),
      producerVersion: 1n,
      createdAt: timestamp(1),
    });
    await events.append({
      entityId: "task",
      event: event("second"),
      producerVersion: 2n,
      createdAt: timestamp(1),
    });

    await expect(events.truncate(timestamp(2))).rejects.toThrow(/closed/);
    await expect(events.backward("task", 1)).rejects.toThrow(/closed/);
  });

  it("settles the active chunk and stops maintenance when closed", async () => {
    const history = new InMemoryEntityHistory({
      stateSchema: StringValueSchema,
      idKey: (id: string) => id,
      maintenance: {
        onChunk: () => {
          history.close();
        },
      },
    });
    for (let version = 1; version <= 2; version++)
      await history.append({
        entityId: "task",
        state: createString(String(version)),
        version: BigInt(version),
        createdAt: timestamp(version),
      });
    await expect(history.truncate(timestamp(3))).rejects.toThrow(/closed/);
    await expect(history.truncate(timestamp(3))).rejects.toThrow(/closed/);
  });

  it("holds a trim entity lock after selection so a concurrent append survives", async () => {
    const selection = deferred<undefined>();
    let selectionReached = false;
    const history = new InMemoryEntityHistory({
      stateSchema: StringValueSchema,
      idKey: (id: string) => id,
      maintenance: {
        afterSelection: () => {
          selectionReached = true;
          return selection.promise;
        },
      },
    });
    await history.append(stateRecord(1));
    await history.append(stateRecord(2));

    const trim = history.trim("task", 1);
    expect(selectionReached).toBe(true);
    let appendFinished = false;
    const append = history.append(stateRecord(3)).then(() => {
      appendFinished = true;
    });
    expect(appendFinished).toBe(false);

    selection.resolve(undefined);
    await trim;
    await append;
    await expect(history.backward("task", 2)).resolves.toMatchObject([
      { state: { value: "3" } },
      { state: { value: "2" } },
    ]);
  });

  it("removes only a truncate selection when an eligible append arrives during its barrier", async () => {
    const selection = deferred<undefined>();
    let selectionReached = false;
    const history = new InMemoryEntityHistory({
      stateSchema: StringValueSchema,
      idKey: (id: string) => id,
      maintenance: {
        afterSelection: () => {
          selectionReached = true;
          return selection.promise;
        },
      },
    });
    await history.append(stateRecord(1));

    const truncate = history.truncate(timestamp(2));
    expect(selectionReached).toBe(true);
    await history.append(stateRecord(2));
    selection.resolve(undefined);
    await truncate;
    await expect(history.backward("task", 2)).resolves.toMatchObject([{ state: { value: "2" } }]);

    await history.truncate(timestamp(2));
    await expect(history.backward("task", 2)).resolves.toEqual([]);
  });

  it("keeps an eligible later-key event appended after truncate starts across multiple chunks", async () => {
    const firstChunk = deferred<undefined>();
    let chunks = 0;
    const events = new MemoryEntityEventHistory({
      idKey: (id: string) => id,
      maintenance: {
        batchSize: 1,
        onChunk: () => {
          if (++chunks === 1) return firstChunk.promise;
        },
      },
    });
    await events.append({
      entityId: "task",
      event: event("a"),
      producerVersion: 1n,
      createdAt: timestamp(1),
    });
    await events.append({
      entityId: "task",
      event: event("b"),
      producerVersion: 2n,
      createdAt: timestamp(1),
    });

    const truncate = events.truncate(timestamp(2));
    await Promise.resolve();
    await events.append({
      entityId: "task",
      event: event("z"),
      producerVersion: 3n,
      createdAt: timestamp(1),
    });
    firstChunk.resolve(undefined);
    await truncate;

    await expect(events.backward("task", 2)).resolves.toMatchObject([{ id: { value: "z" } }]);
    expect(chunks).toBe(2);
  });

  it("keeps a later canonical UTF-8 event key appended during multi-chunk truncate", async () => {
    const firstChunk = deferred<undefined>();
    let chunks = 0;
    const events = new MemoryEntityEventHistory({
      idKey: (id: string) => id,
      maintenance: {
        batchSize: 1,
        onChunk: () => {
          if (++chunks === 1) return firstChunk.promise;
        },
      },
    });
    await events.append({
      entityId: "task",
      event: event("a"),
      producerVersion: 1n,
      createdAt: timestamp(1),
    });
    await events.append({
      entityId: "task",
      event: event("\uE000"),
      producerVersion: 2n,
      createdAt: timestamp(1),
    });

    const truncate = events.truncate(timestamp(2));
    await Promise.resolve();
    await events.append({
      entityId: "task",
      event: event("\u{10000}"),
      producerVersion: 3n,
      createdAt: timestamp(1),
    });
    firstChunk.resolve(undefined);
    await truncate;

    await expect(events.backward("task", 2)).resolves.toMatchObject([
      { id: { value: "\u{10000}" } },
    ]);
    expect(chunks).toBe(2);
  });

  it("trims large state histories through bounded oldest-key chunks while retaining the top N", async () => {
    let chunks = 0;
    const history = new InMemoryEntityHistory({
      stateSchema: StringValueSchema,
      idKey: (id: string) => id,
      maintenance: { batchSize: 3, onChunk: () => void chunks++ },
    });
    for (let version = 1; version <= 17; version++) await history.append(stateRecord(version));

    await history.trim("task", 5);

    await expect(history.backward("task", 10)).resolves.toMatchObject([
      { state: { value: "17" } },
      { state: { value: "16" } },
      { state: { value: "15" } },
      { state: { value: "14" } },
      { state: { value: "13" } },
    ]);
    expect(chunks).toBe(4);
  });
});

function timestamp(seconds: number) {
  return create(TimestampSchema, { seconds: BigInt(seconds) });
}

function createString(value: string) {
  return create(StringValueSchema, { value });
}
function event(value: string) {
  return create(EventSchema, { id: create(EventIdSchema, { value }) });
}
function stateRecord(version: number) {
  return {
    entityId: "task",
    state: createString(String(version)),
    version: BigInt(version),
    createdAt: timestamp(1),
  };
}

function entityStorageInput(
  overrides: Partial<{
    readonly context: {
      readonly name: string;
      readonly multitenant: boolean;
      readonly tenantId?: string;
    };
  }> = {},
) {
  return {
    context: { name: "Tasks", multitenant: false },
    id: { clone: (id: string) => id, key: (id: string) => id },
    extractId: () => "task",
    columns: [],
    sourceType: StringValueSchema,
    stateSchema: StringValueSchema,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((fulfilled) => {
    resolve = fulfilled;
  });
  return { promise, resolve };
}
