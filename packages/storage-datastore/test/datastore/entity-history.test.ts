import { create } from "@bufbuild/protobuf";
import {
  AnySchema,
  StringValueSchema,
  TimestampSchema,
  type StringValue,
} from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import { EntityCommitStorageFactories } from "@spine-event-engine/storage/internal/entity-commit";
import { EventStore } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";
import {
  EntityHistoryConformance,
  type EntityStorageInput,
} from "@spine-event-engine/storage/internal/entity-history";

import { DatastoreStorageFactory } from "../../src/index.js";
import { deferred, HistoryDatastoreBackend } from "./entity-history-fixture.js";

const input = (layout = "entity-v1"): EntityStorageInput<string, StringValue> => ({
  context: { name: "History", multitenant: false },
  id: { clone: (id) => id, fingerprint: "string", key: (id) => id },
  extractId: () => "task",
  columns: [],
  layout,
  stateSchema: StringValueSchema,
  storageKey: "tasks.Task:current",
});

describe("Datastore entity history", () => {
  it("supplies the frozen current/state/event history SPI", async () => {
    const backend = new HistoryDatastoreBackend();
    const factory = new DatastoreStorageFactory({ client: backend.client() as never });
    await EntityHistoryConformance.check({
      create: (entityInput: EntityStorageInput<string, StringValue>) =>
        factory.createEntityStorage(entityInput),
      reopen: (entityInput: EntityStorageInput<string, StringValue>) =>
        factory.createEntityStorage(entityInput),
    });
  });

  it("binds compatible layouts and rejects incompatible reopen", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const first = new DatastoreStorageFactory({ client: client as never }).createEntityStorage(
      input(),
    );
    await first.current.write({
      id: "task",
      state: create(StringValueSchema, { value: "dynamic-id" }),
      version: 1n,
      archived: false,
      deleted: false,
    });
    const incompatible = new DatastoreStorageFactory({
      client: client as never,
    }).createEntityStorage(input("other"));
    await expect(incompatible.current.read("task")).rejects.toThrow("incompatible");
  });

  it("reads over 10k rows in newest-first order with exclusive continuation and finite depth", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const storage = new DatastoreStorageFactory({ client: client as never }).createEntityStorage(
      input(),
    );
    for (let index = 1; index <= 10_001; index += 1) await storage.states.append(state(index));
    const before = client.queryCalls;
    const reads = client.getCalls;
    await expect(storage.states.backward("task", 1)).resolves.toMatchObject([
      { state: { value: "10001" } },
    ]);
    expect(client.queryCalls - before).toBe(1);
    expect(client.queryLimits.at(-1)).toBe(1);
    expect(client.getCalls - reads).toBe(1);
    const afterOne = client.queryCalls;
    await expect(storage.states.backward("task", 127)).resolves.toHaveLength(127);
    expect(client.queryCalls - afterOne).toBe(1);
    expect(client.queryLimits.at(-1)).toBe(127);
    const after127 = client.queryCalls;
    await expect(storage.states.backward("task", 129)).resolves.toHaveLength(129);
    expect(client.queryCalls - after127).toBe(2);
    expect(client.queryLimits.slice(-2)).toEqual([128, 1]);
    await expect(storage.states.backward("task", 2, 10_001n)).resolves.toMatchObject([
      { state: { value: "10000" } },
      { state: { value: "9999" } },
    ]);
    const beforeStateAt = client.queryCalls;
    const beforeStateAtGet = client.getCalls;
    await expect(storage.states.stateAt("task", time(10_001))).resolves.toMatchObject({
      value: "10001",
    });
    expect(client.queryCalls - beforeStateAt).toBe(1);
    expect(client.queryLimits.at(-1)).toBe(1);
    expect(client.getCalls - beforeStateAtGet).toBe(1);
  }, 30_000);

  it("keeps exactly one newest state when trim crosses a history page", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const storage = new DatastoreStorageFactory({ client: client as never }).createEntityStorage(
      input(),
    );
    for (let index = 1; index <= 129; index += 1) await storage.states.append(state(index));
    await storage.states.trim("task", 1);
    await expect(storage.states.backward("task", 10)).resolves.toMatchObject([
      { state: { value: "129" } },
    ]);
    const selections = client.queries.filter(
      (query) =>
        query.kind === "$SpineEntityStateOrder" &&
        query.orders.some(([property]) => property === "__key__"),
    );
    expect(selections).not.toHaveLength(0);
    expect(selections.every((query) => query.projection?.flat().includes("__key__") === true)).toBe(
      true,
    );
    expect(selections.every((query) => (query.limitValue ?? 0) <= 8)).toBe(true);
    expect(backend.maxTransactionGroups).toBeLessThanOrEqual(24);
  });

  it("resumes 257-state trim after a committed chunk failure while retaining the requested count", async () => {
    const backend = new HistoryDatastoreBackend();
    const storage = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage(input());
    for (let index = 1; index <= 257; index += 1) await storage.states.append(state(index));
    backend.failDeleteAt = 2;
    await expect(storage.states.trim("task", 1)).rejects.toThrow("delete group failed");
    backend.failDeleteAt = undefined;
    await storage.states.trim("task", 1);
    await expect(storage.states.backward("task", 2)).resolves.toMatchObject([
      { state: { value: "257" } },
    ]);
  });

  it("expects a fixed truncate boundary to retain a concurrent later state and event", async () => {
    const backend = new HistoryDatastoreBackend();
    const storage = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage(input());
    await storage.states.append(state(1));
    await storage.events.append(historyEvent("old", "task"));
    const held = deferred<undefined>();
    backend.heldDelete = held;
    const truncate = storage.states.truncate(time(2));
    await Promise.resolve();
    const append = storage.states.append(state(2));
    held.resolve(undefined);
    await Promise.all([truncate, append]);
    await expect(storage.states.backward("task", 1)).resolves.toMatchObject([
      { state: { value: "2" } },
    ]);
  });

  it("retains a later lower-version append when trim retries after a provider conflict", async () => {
    const backend = new HistoryDatastoreBackend();
    const firstClient = backend.client();
    const first = new DatastoreStorageFactory({ client: firstClient as never }).createEntityStorage(
      input(),
    ).states;
    const second = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage(input()).states;
    await first.append(state(1));
    await first.append(state(2));
    const entered = deferred<undefined>();
    const release = deferred<undefined>();
    const transaction = firstClient.transaction.bind(firstClient);
    let held = false;
    firstClient.transaction = () => {
      const value = transaction();
      const commit = value.commit.bind(value);
      value.commit = async () => {
        if (!held) {
          held = true;
          entered.resolve(undefined);
          await release.promise;
        }
        return commit();
      };
      return value;
    };

    const trim = first.trim("task", 0);
    await entered.promise;
    await second.append(state(-1));
    await second.append(state(0));
    release.resolve(undefined);
    await trim;

    expect(firstClient.transactionCalls).toBeGreaterThanOrEqual(2);
    await expect(second.backward("task", 2)).resolves.toMatchObject([
      { state: { value: "0" } },
      { state: { value: "-1" } },
    ]);
    expect(root(backend, "task")).toMatchObject({ stateCount: { value: "2" } });
  });

  it("retries a conflicted trim plan before selecting destructive chunks", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const storage = new DatastoreStorageFactory({ client: client as never }).createEntityStorage(
      input(),
    );
    await storage.states.append(state(1));
    const transaction = client.transaction.bind(client);
    let conflicts = 1;
    client.transaction = () => {
      const value = transaction();
      const run = value.run.bind(value);
      value.run = async () => {
        if (conflicts > 0) {
          conflicts -= 1;
          throw Object.assign(new Error("transaction aborted"), { code: 10 });
        }
        return run();
      };
      return value;
    };

    await storage.states.trim("task", 0);

    expect(client.transactionCalls).toBeGreaterThanOrEqual(3);
    await expect(storage.states.backward("task", 1)).resolves.toEqual([]);
  });

  it("rejects a trim closed after planning before its first destructive chunk", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const storage = new DatastoreStorageFactory({ client: client as never }).createEntityStorage(
      input(),
    );
    const sibling = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage(input());
    await storage.states.append(state(1));
    const entered = deferred<undefined>();
    const release = deferred<undefined>();
    const transaction = client.transaction.bind(client);
    let held = false;
    client.transaction = () => {
      const value = transaction();
      const get = value.get.bind(value);
      value.get = async (key) => {
        if (!held) {
          held = true;
          entered.resolve(undefined);
          await release.promise;
        }
        return get(key);
      };
      return value;
    };

    const trim = storage.states.trim("task", 0);
    await entered.promise;
    storage.close();
    release.resolve(undefined);

    await expect(trim).rejects.toThrow("closed");
    await expect(sibling.states.backward("task", 1)).resolves.toMatchObject([
      { state: { value: "1" } },
    ]);
  });

  it("captures event truncate high-water so a later eligible event survives", async () => {
    const backend = new HistoryDatastoreBackend();
    const storage = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage(input());
    await storage.events.append(historyEvent("old", "task"));
    const held = deferred<undefined>();
    backend.heldDelete = held;
    const truncate = storage.events.truncate(time(2));
    await Promise.resolve();
    const append = storage.events.append(historyEvent("later", "task"));
    held.resolve(undefined);
    await Promise.all([truncate, append]);
    await expect(storage.events.backward("task", 2)).resolves.toMatchObject([
      { id: { value: "later" } },
    ]);
  });

  it("leaves the sibling handle usable when closed during a held chunk", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const left = new DatastoreStorageFactory({ client: client as never }).createEntityStorage(
      input(),
    );
    const right = new DatastoreStorageFactory({ client: client as never }).createEntityStorage(
      input(),
    );
    for (let index = 1; index <= 129; index += 1) await left.states.append(state(index));
    const held = deferred<undefined>();
    backend.heldDelete = held;
    const trim = left.states.trim("task", 0);
    await Promise.resolve();
    left.close();
    held.resolve(undefined);
    await expect(trim).rejects.toThrow("closed");
    await expect(right.current.read("task")).resolves.toBeUndefined();
  });

  it("orders equal event version/time ties by canonical UTF-8 ID descending", async () => {
    const storage = new DatastoreStorageFactory({
      client: new HistoryDatastoreBackend().client() as never,
    }).createEntityStorage(input());
    await storage.events.append(historyEvent("\uE000", "task"));
    await storage.events.append(historyEvent("\u{10000}", "task"));
    await expect(storage.events.backward("task", 2)).resolves.toMatchObject([
      { id: { value: "\u{10000}" } },
      { id: { value: "\uE000" } },
    ]);
  });

  it("keeps event continuation exclusive across an equal producer-version prefix", async () => {
    const storage = new DatastoreStorageFactory({
      client: new HistoryDatastoreBackend().client() as never,
    }).createEntityStorage(input());
    await storage.events.append(historyEvent("first", "task"));
    await storage.events.append({ ...historyEvent("second", "task"), createdAt: time(2) });
    await expect(storage.events.backward("task", 2, 1n)).resolves.toEqual([]);
  });

  it("preserves history root retention state after a current write", async () => {
    const storage = new DatastoreStorageFactory({
      client: new HistoryDatastoreBackend().client() as never,
    }).createEntityStorage(input());
    await storage.states.append(state(1));
    await storage.states.append(state(2));
    await storage.current.write({
      id: "task",
      state: create(StringValueSchema, { value: "current" }),
      version: 2n,
      archived: false,
      deleted: false,
    });
    await storage.states.trim("task", 1);
    await expect(storage.states.backward("task", 2)).resolves.toMatchObject([
      { state: { value: "2" } },
    ]);
  });

  it("makes state and event retry identity immutable, including event correlation", async () => {
    const storage = new DatastoreStorageFactory({
      client: new HistoryDatastoreBackend().client() as never,
    }).createEntityStorage(input());
    await storage.states.append(state(1));
    await storage.states.append(state(1));
    await expect(
      storage.states.append({
        ...state(1),
        state: create(StringValueSchema, { value: "changed" }),
      }),
    ).rejects.toThrow("divergent");
    const event = historyEvent("event", "task");
    await storage.events.append(event);
    await storage.events.append(event);
    await expect(storage.events.append(historyEvent("event", "other"))).rejects.toThrow(
      "divergent",
    );
  });

  it("retries an independent-client state append race with one immutable marker set", async () => {
    const backend = new HistoryDatastoreBackend();
    const firstClient = backend.client();
    const secondClient = backend.client();
    const first = new DatastoreStorageFactory({ client: firstClient as never }).createEntityStorage(
      input(),
    );
    const second = new DatastoreStorageFactory({
      client: secondClient as never,
    }).createEntityStorage(input());
    await first.current.read("task");
    await second.current.read("task");
    const before = firstClient.transactionCalls + secondClient.transactionCalls;

    await Promise.all([first.states.append(state(1)), second.states.append(state(1))]);

    expect(firstClient.transactionCalls + secondClient.transactionCalls).toBeGreaterThan(
      before + 2,
    );
    expect(countKinds(backend, "$SpineEntityState")).toBe(1);
    expect(countKinds(backend, "$SpineEntityStateOrder")).toBe(1);
    expect(countKinds(backend, "$SpineEntityStateCut")).toBe(1);
    expect(root(backend, "task")).toMatchObject({
      stateCount: { value: "1" },
      revision: { value: "1" },
    });
  });

  it("rejects a divergent state race after persisting one canonical state", async () => {
    const backend = new HistoryDatastoreBackend();
    const first = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage(input());
    const second = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage(input());

    const results = await Promise.allSettled([
      first.states.append(state(1)),
      second.states.append({ ...state(1), state: create(StringValueSchema, { value: "changed" }) }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(countKinds(backend, "$SpineEntityState")).toBe(1);
  });

  it("reopens an event append after an applied commit and preserves global identity", async () => {
    const backend = new HistoryDatastoreBackend();
    const storage = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage(input());
    await storage.current.read("task");
    backend.failCommitAppliedOnce = true;

    await expect(storage.events.append(historyEvent("once", "task"))).resolves.toBeUndefined();

    expect(countKinds(backend, "$SpineEntityEvent")).toBe(1);
    expect(countKinds(backend, "$SpineEntityEventOrder")).toBe(1);
    expect(countKinds(backend, "$SpineEntityEventCut")).toBe(1);
    expect(root(backend, "task")).toMatchObject({ revision: { value: "1" } });
    await expect(storage.events.append(historyEvent("once", "other"))).rejects.toThrow("divergent");
  });

  it("commits current state and history atomically with an immutable receipt", async () => {
    const backend = new HistoryDatastoreBackend();
    const factory = new DatastoreStorageFactory({ client: backend.client() as never });
    const commit = EntityCommitStorageFactories.create(factory, input());
    const mutation = {
      context: input().context,
      entity: input(),
      id: "command-1",
      entityId: "task",
      next: {
        id: "task",
        state: create(StringValueSchema, { value: "one" }),
        version: 1n,
        archived: false,
        deleted: false,
      },
      states: [
        {
          entityId: "task",
          state: create(StringValueSchema, { value: "one" }),
          version: 1n,
          createdAt: time(1),
        },
      ],
      diagnostics: [
        {
          entityId: "task",
          event: create(EventSchema, { id: create(EventIdSchema, { value: "diagnostic-1" }) }),
          producerVersion: 1n,
          createdAt: time(1),
        },
      ],
      events: [
        create(EventSchema, {
          id: create(EventIdSchema, { value: "delivery-1" }),
          message: create(AnySchema, { typeUrl: "type.spine.test/Delivery" }),
        }),
      ],
    };

    await expect(commit.commit(mutation)).resolves.toBe("committed");
    await expect(commit.commit(mutation)).resolves.toBe("replayed");
    await expect(
      commit.commit({ ...mutation, next: { ...mutation.next, version: 2n } }),
    ).rejects.toThrow("reused with different content");
    const normal = factory.createEntityStorage(input());
    await expect(normal.current.read("task")).resolves.toMatchObject({ version: 1n });
    await expect(normal.states.backward("task", 1)).resolves.toMatchObject([{ version: 1n }]);
    await expect(normal.events.backward("task", 1)).resolves.toMatchObject([
      { id: { value: "diagnostic-1" } },
    ]);
    const delivery = new EventStore(input().context, factory);
    await expect(delivery.read()).resolves.toMatchObject([{ id: { value: "delivery-1" } }]);
    delivery.close();
  });

  it("rejects duplicate delivery preflight before starting a Datastore transaction", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const inputValue = input();
    const delivery = create(EventSchema, { id: create(EventIdSchema, { value: "duplicate" }) });

    await expect(
      EntityCommitStorageFactories.create(factory, inputValue).commit({
        context: inputValue.context,
        entity: inputValue,
        id: "duplicate-delivery",
        entityId: "task",
        next: {
          id: "task",
          state: create(StringValueSchema, { value: "next" }),
          version: 1n,
          archived: false,
          deleted: false,
        },
        events: [delivery, delivery],
      }),
    ).rejects.toThrow("unique delivery-event IDs");

    expect(client.transactionCalls).toBe(0);
  });

  it("rejects commits for another Entity scope and closed handles before a transaction", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const inputValue = input();
    const commit = EntityCommitStorageFactories.create(factory, inputValue);
    const mutation = {
      context: inputValue.context,
      entity: inputValue,
      id: "scope",
      entityId: "task",
      next: {
        id: "task",
        state: create(StringValueSchema, { value: "next" }),
        version: 1n,
        archived: false,
        deleted: false,
      },
    };

    await expect(
      commit.commit({ ...mutation, entity: { ...inputValue, storageKey: "other.Task:current" } }),
    ).rejects.toThrow("another Entity storage scope");
    commit.close();
    await expect(commit.commit(mutation)).rejects.toThrow("closed");
    expect(client.transactionCalls).toBe(0);
  });

  it("rejects a commit whose delivery groups exceed the provider limit before a transaction", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const inputValue = input();

    await expect(
      EntityCommitStorageFactories.create(factory, inputValue).commit({
        context: inputValue.context,
        entity: inputValue,
        id: "too-many-deliveries",
        entityId: "task",
        next: {
          id: "task",
          state: create(StringValueSchema, { value: "next" }),
          version: 1n,
          archived: false,
          deleted: false,
        },
        events: Array.from({ length: 25 }, (_, index) =>
          create(EventSchema, {
            id: create(EventIdSchema, { value: `delivery-${String(index)}` }),
          }),
        ),
      }),
    ).rejects.toThrow("25 entity-group limit");

    expect(client.transactionCalls).toBe(0);
  });

  it("retries a transaction abort and returns conflict without durable mutation", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const inputValue = input();
    const commit = EntityCommitStorageFactories.create(factory, inputValue);
    const transaction = client.transaction.bind(client);
    let aborts = 1;
    client.transaction = () => {
      const value = transaction();
      const run = value.run.bind(value);
      value.run = async () => {
        if (aborts > 0) {
          aborts -= 1;
          throw Object.assign(new Error("transaction aborted"), { code: 10 });
        }
        return run();
      };
      return value;
    };
    const mutation = {
      context: inputValue.context,
      entity: inputValue,
      id: "retry",
      entityId: "task",
      next: {
        id: "task",
        state: create(StringValueSchema, { value: "next" }),
        version: 1n,
        archived: false,
        deleted: false,
      },
    };

    await expect(commit.commit(mutation)).resolves.toBe("committed");
    await expect(
      commit.commit({
        ...mutation,
        id: "conflict",
        expected: { ...mutation.next, state: create(StringValueSchema, { value: "wrong" }) },
      }),
    ).resolves.toBe("conflict");
    expect(client.transactionCalls).toBeGreaterThanOrEqual(3);
    await expect(
      factory.createEntityStorage(inputValue).current.read("task"),
    ).resolves.toMatchObject({
      state: { value: "next" },
      version: 1n,
    });
  });

  it("surfaces retry exhaustion after three aborted commit transactions", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const inputValue = input();
    const transaction = client.transaction.bind(client);
    client.transaction = () => {
      const value = transaction();
      value.run = () =>
        Promise.reject(Object.assign(new Error("transaction aborted"), { code: 10 }));
      return value;
    };

    await expect(
      EntityCommitStorageFactories.create(factory, inputValue).commit({
        context: inputValue.context,
        entity: inputValue,
        id: "exhaustion",
        entityId: "task",
        next: {
          id: "task",
          state: create(StringValueSchema, { value: "next" }),
          version: 1n,
          archived: false,
          deleted: false,
        },
      }),
    ).rejects.toThrow("transaction aborted");
    expect(client.transactionCalls).toBe(3);
  });

  it("rejects invalid current and retained-history identities without committing", async () => {
    const backend = new HistoryDatastoreBackend();
    const factory = new DatastoreStorageFactory({ client: backend.client() as never });
    const inputValue = input();
    const base = {
      context: inputValue.context,
      entity: inputValue,
      id: "invalid",
      entityId: "task",
      next: {
        id: "task",
        state: create(StringValueSchema, { value: "next" }),
        version: 1n,
        archived: false,
        deleted: false,
      },
    };

    await expect(
      EntityCommitStorageFactories.create(factory, inputValue).commit({
        ...base,
        states: [{ ...state(1), entityId: "other" }],
      }),
    ).rejects.toThrow("state history belongs to another Entity");
    await expect(
      EntityCommitStorageFactories.create(factory, inputValue).commit({
        ...base,
        diagnostics: [
          {
            entityId: "task",
            event: create(EventSchema),
            producerVersion: 1n,
            createdAt: time(1),
          },
        ],
      }),
    ).rejects.toThrow("Event history requires an event ID");
    const mismatched = { ...inputValue, extractId: (value: StringValue) => value.value };
    await expect(
      EntityCommitStorageFactories.create(factory, mismatched).commit({
        ...base,
        entity: mismatched,
      }),
    ).rejects.toThrow("current record ID does not match");
  });

  it("rejects divergent retained state and diagnostic retries after preserving the first commit", async () => {
    const backend = new HistoryDatastoreBackend();
    const factory = new DatastoreStorageFactory({ client: backend.client() as never });
    const inputValue = input();
    const commit = EntityCommitStorageFactories.create(factory, inputValue);
    const first = {
      context: inputValue.context,
      entity: inputValue,
      id: "first",
      entityId: "task",
      next: {
        id: "task",
        state: create(StringValueSchema, { value: "one" }),
        version: 1n,
        archived: false,
        deleted: false,
      },
      states: [state(1)],
      diagnostics: [historyEvent("diagnostic", "task")],
    };
    await expect(commit.commit(first)).resolves.toBe("committed");
    const expected = first.next;
    await expect(
      commit.commit({
        ...first,
        id: "state-retry",
        expected,
        states: [{ ...state(1), state: create(StringValueSchema, { value: "other" }) }],
        diagnostics: [],
      }),
    ).rejects.toThrow("State-history retry has divergent content");
    await expect(
      commit.commit({
        ...first,
        id: "event-retry",
        expected,
        states: [],
        diagnostics: [{ ...historyEvent("diagnostic", "task"), producerVersion: 2n }],
      }),
    ).rejects.toThrow("Event-history retry has divergent content");
  });

  it("returns committed to the invocation whose ambiguous acknowledgement persisted", async () => {
    const backend = new HistoryDatastoreBackend();
    const firstFactory = new DatastoreStorageFactory({ client: backend.client() as never });
    const mutation = {
      context: input().context,
      entity: input(),
      id: "ambiguous-command",
      entityId: "task",
      next: {
        id: "task",
        state: create(StringValueSchema, { value: "one" }),
        version: 1n,
        archived: false,
        deleted: false,
      },
    };
    // Bind the layout before injecting the lost acknowledgement, so the fault
    // applies to the commit receipt rather than the first-use layout binding.
    await firstFactory.createEntityStorage(input()).current.read("task");
    backend.failCommitAppliedOnce = true;

    await expect(
      EntityCommitStorageFactories.create(firstFactory, input()).commit(mutation),
    ).resolves.toBe("committed");
  });

  it("returns exactly one committed result to competing identical callers", async () => {
    const backend = new HistoryDatastoreBackend();
    const inputValue = input();
    const mutation = {
      context: inputValue.context,
      entity: inputValue,
      id: "competing-command",
      entityId: "task",
      next: {
        id: "task",
        state: create(StringValueSchema, { value: "one" }),
        version: 1n,
        archived: false,
        deleted: false,
      },
    };
    const first = new DatastoreStorageFactory({ client: backend.client() as never });
    const second = new DatastoreStorageFactory({ client: backend.client() as never });

    const outcomes = await Promise.all([
      EntityCommitStorageFactories.create(first, inputValue).commit(mutation),
      EntityCommitStorageFactories.create(second, inputValue).commit(mutation),
    ]);

    expect(outcomes.filter((outcome) => outcome === "committed")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "replayed")).toHaveLength(1);
  });

  it("rejects an independent-client divergent event-ID race with one global marker set", async () => {
    const backend = new HistoryDatastoreBackend();
    const first = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage(input());
    const second = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage(input());

    const results = await Promise.allSettled([
      first.events.append(historyEvent("shared", "task")),
      second.events.append(historyEvent("shared", "other")),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(countKinds(backend, "$SpineEntityEvent")).toBe(1);
    expect(countKinds(backend, "$SpineEntityEventOrder")).toBe(1);
    expect(countKinds(backend, "$SpineEntityEventCut")).toBe(1);
  });

  it("rejects invalid signed-64 and timestamp input before a provider RPC", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const storage = new DatastoreStorageFactory({ client: client as never }).createEntityStorage(
      input(),
    );
    await expect(storage.states.append({ ...state(1), version: 1n << 63n })).rejects.toThrow(
      "signed 64-bit",
    );
    await expect(
      storage.states.stateAt("task", { seconds: 1n, nanos: -1 } as never),
    ).rejects.toThrow("timestamp");
    expect(client.getCalls + client.saveCalls + client.queryCalls).toBe(0);
  });

  it("rejects a state-order marker without its immutable state identity", async () => {
    const backend = new HistoryDatastoreBackend();
    const storage = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage(input());
    await storage.states.append(state(1));
    const stateIdentity = [...backend.entities.keys()].find((serialized) =>
      (JSON.parse(serialized) as [unknown, readonly string[]])[1].includes("$SpineEntityState"),
    );
    if (stateIdentity === undefined) throw new Error("Expected state identity.");
    backend.entities.delete(stateIdentity);

    await expect(storage.states.backward("task", 1)).rejects.toThrow("state identity");
  });

  it("atomically rejects an incompatible concurrent first binding", async () => {
    const backend = new HistoryDatastoreBackend();
    const first = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage(input("first"));
    const second = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage(input("second"));

    const results = await Promise.allSettled([
      first.current.read("task"),
      second.current.read("task"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("persists only the fixed history kind allowlist", async () => {
    const backend = new HistoryDatastoreBackend();
    const storage = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage({ ...input(), extractId: (state) => state.value });

    await storage.current.write({
      id: "dynamic-id",
      state: create(StringValueSchema, { value: "dynamic-id" }),
      version: 1n,
      archived: false,
      deleted: false,
    });

    await storage.states.append(state(1));
    await storage.events.append(historyEvent("event", "dynamic-id"));

    const paths = [...backend.entities.keys()].map(
      (serialized) => (JSON.parse(serialized) as [unknown, readonly string[]])[1],
    );
    expect(
      new Set(paths.flatMap((path) => path.filter((part) => part.startsWith("$Spine")))),
    ).toEqual(
      new Set([
        "$SpineEntityScope",
        "$SpineEntity",
        "$SpineEntityCurrent",
        "$SpineEntityState",
        "$SpineEntityStateOrder",
        "$SpineEntityStateCut",
        "$SpineEntityEvent",
        "$SpineEntityEventOrder",
        "$SpineEntityEventCut",
      ]),
    );
    expect(paths.find((path) => path.includes("$SpineEntityCurrent"))).toHaveLength(4);
    expect(paths.find((path) => path.includes("$SpineEntityState"))).toHaveLength(4);
    expect(paths.find((path) => path.includes("$SpineEntityStateOrder"))).toHaveLength(4);
    expect(paths.find((path) => path.includes("$SpineEntityEventOrder"))).toHaveLength(4);
  });

  it("uses shared canonical scope bytes and collision-free fixed root names", async () => {
    const backend = new HistoryDatastoreBackend();
    const single = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage(input());
    const multitenant = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage({
      ...input(),
      context: { name: "History", multitenant: true, tenantId: "a:b" },
    });
    await single.current.read("a:b");
    await multitenant.current.read("a:b");

    const names = [...backend.entities.keys()].map(
      (serialized) => (JSON.parse(serialized) as [unknown, readonly string[]])[1][1],
    );
    expect(names).toContain(
      Buffer.from("7:History:13:single-tenant:18:tasks.Task:current", "utf8").toString("hex"),
    );
    expect(new Set(names)).toHaveLength(2);
  });

  it("rejects oversize encoded key tokens before binding RPCs", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const storage = new DatastoreStorageFactory({ client: client as never }).createEntityStorage(
      input(),
    );

    await expect(storage.current.read("x".repeat(1_501))).rejects.toThrow("1,500-byte");
    expect(client.getCalls + client.saveCalls + client.queryCalls + client.transactionCalls).toBe(
      0,
    );
  });

  it("leaves a compatible sibling usable after closing one handle", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const left = new DatastoreStorageFactory({ client: client as never }).createEntityStorage(
      input(),
    );
    const right = new DatastoreStorageFactory({ client: client as never }).createEntityStorage(
      input(),
    );

    left.close();

    await expect(
      right.current.write({
        id: "task",
        state: create(StringValueSchema, { value: "state" }),
        version: 1n,
        archived: false,
        deleted: false,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects invalid configuration and operation boundaries before provider work", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const factory = new DatastoreStorageFactory({ client: client as never });

    expect(() => factory.createEntityStorage(input("   "))).toThrow("non-blank");
    expect(() =>
      factory.createEntityStorage({
        ...input(),
        context: { name: "History", multitenant: true },
      }),
    ).toThrow("tenantId");
    const storage = factory.createEntityStorage(input());
    await expect(storage.states.backward("task", 0)).rejects.toThrow("positive safe integer");
    await expect(storage.states.trim("task", -1)).rejects.toThrow("non-negative safe integer");
    await expect(
      storage.events.append({
        ...historyEvent("event", "task"),
        event: create(EventSchema),
      }),
    ).rejects.toThrow("event ID");
    expect(client.getCalls + client.saveCalls + client.queryCalls + client.transactionCalls).toBe(
      0,
    );
  });

  it("uses tenant namespaces for marker and maintenance queries", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const storage = new DatastoreStorageFactory({ client: client as never }).createEntityStorage({
      ...input(),
      context: { name: "History", multitenant: true, tenantId: "tenant-a" },
    });
    await storage.states.append(state(1));
    await storage.states.backward("task", 1);
    await storage.states.truncate(time(2));

    expect(client.queries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "$SpineEntityStateOrder" }),
        expect.objectContaining({ kind: "$SpineEntityStateCut" }),
      ]),
    );
    expect(
      [...backend.entities.keys()].every((serialized) =>
        serialized.startsWith(JSON.stringify(["tenant-a"]).slice(0, -1)),
      ),
    ).toBe(true);
  });

  it("returns empty point-in-time and maintenance results without creating history", async () => {
    const backend = new HistoryDatastoreBackend();
    const storage = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage(input());

    await expect(storage.states.stateAt("task", time(1))).resolves.toBeUndefined();
    await expect(storage.states.backward("task", 1)).resolves.toEqual([]);
    await expect(storage.events.backward("task", 1)).resolves.toEqual([]);
    await expect(storage.states.trim("task", 0)).resolves.toBeUndefined();
    await expect(storage.events.truncate(time(1))).resolves.toBeUndefined();
  });

  it("rejects corrupt state and event order markers before returning history", async () => {
    const backend = new HistoryDatastoreBackend();
    const storage = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage(input());
    await storage.states.append(state(1));
    await storage.events.append(historyEvent("event", "task"));
    const stateMarker = entryForKind(backend, "$SpineEntityStateOrder");
    const eventMarker = entryForKind(backend, "$SpineEntityEventOrder");
    stateMarker.data.$spineStateRef = "not-a-state-reference";
    eventMarker.data["$spine.event.id"] = "";

    await expect(storage.states.backward("task", 1)).rejects.toThrow("state identity reference");
    await expect(storage.events.backward("task", 1)).rejects.toThrow("event identity reference");
  });

  it("fails closed when a retained state marker has no causal revision", async () => {
    const backend = new HistoryDatastoreBackend();
    const storage = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage(input());
    await storage.states.append(state(1));
    delete entryForKind(backend, "$SpineEntityStateOrder").data.$spineStateRevision;

    await expect(storage.states.trim("task", 0)).rejects.toThrow("no causal revision");
  });

  it("fails closed when state retention has no order marker", async () => {
    const backend = new HistoryDatastoreBackend();
    const storage = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage(input());
    await storage.states.append(state(1));
    deleteEntriesForKind(backend, "$SpineEntityStateOrder");

    await expect(storage.states.trim("task", 0)).rejects.toThrow(
      "state retention without an order marker",
    );
  });

  it("stops a planned trim if its durable root disappears before the first chunk", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const storage = new DatastoreStorageFactory({ client: client as never }).createEntityStorage(
      input(),
    );
    await storage.states.append(state(1));
    const transaction = client.transaction.bind(client);
    let planning = true;
    client.transaction = () => {
      const value = transaction();
      if (planning) {
        planning = false;
        const rollback = value.rollback.bind(value);
        value.rollback = async () => {
          const result = await rollback();
          deleteEntityRoot(backend, "task");
          return result;
        };
      }
      return value;
    };

    await expect(storage.states.trim("task", 0)).resolves.toBeUndefined();
    await expect(storage.states.backward("task", 1)).resolves.toMatchObject([
      { state: { value: "1" } },
    ]);
  });

  it("rejects malformed durable order and cut-marker keys during maintenance", async () => {
    const backend = new HistoryDatastoreBackend();
    const storage = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage(input());
    await storage.states.append(state(1));
    corruptMarkerKey(backend, "$SpineEntityStateOrder", "malformed-order-marker");

    await expect(storage.states.trim("task", 0)).rejects.toThrow("state marker has an invalid key");

    const cuts = new HistoryDatastoreBackend();
    const cutStorage = new DatastoreStorageFactory({
      client: cuts.client() as never,
    }).createEntityStorage(input());
    await cutStorage.states.append(state(1));
    corruptMarkerKey(cuts, "$SpineEntityStateCut", (current) =>
      current.split(".").slice(0, -1).join("."),
    );

    await expect(cutStorage.states.truncate(time(2))).rejects.toThrow(
      "history cut marker has an invalid key",
    );
  });

  it("rejects a paged marker response that omits its required continuation cursor", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const storage = new DatastoreStorageFactory({ client: client as never }).createEntityStorage(
      input(),
    );
    for (let index = 1; index <= 129; index += 1) await storage.states.append(state(index));
    const runQuery = client.runQuery.bind(client);
    client.runQuery = async (query) => {
      const [rows, info] = await runQuery(query);
      if (query.kind === "$SpineEntityStateOrder" && rows.length === 128)
        return [rows, { ...info, endCursor: undefined as never }];
      return [rows, info];
    };

    await expect(storage.states.backward("task", 129)).rejects.toThrow("did not return a cursor");
  });

  it("rejects an event pagination response that omits its required continuation cursor", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const storage = new DatastoreStorageFactory({ client: client as never }).createEntityStorage(
      input(),
    );
    for (let index = 1; index <= 129; index += 1)
      await storage.events.append({
        ...historyEvent(`event-${String(index)}`, "task"),
        createdAt: time(index),
      });
    const runQuery = client.runQuery.bind(client);
    client.runQuery = async (query) => {
      const [rows, info] = await runQuery(query);
      if (query.kind === "$SpineEntityEventOrder" && rows.length === 128)
        return [rows, { ...info, endCursor: undefined as never }];
      return [rows, info];
    };

    await expect(storage.events.backward("task", 129)).rejects.toThrow("did not return a cursor");
  });

  it("rejects malformed datastore paging metadata before returning partial state history", async () => {
    const malformedResponses: readonly [
      string,
      (info: { readonly endCursor: Buffer; readonly moreResults: string }) => unknown,
      string,
    ][] = [
      ["missing metadata", () => undefined, "did not return paging information"],
      [
        "invalid continuation cursor",
        (info) => ({ ...info, endCursor: 1 }),
        "invalid continuation cursor",
      ],
      [
        "invalid continuation state",
        (info) => ({ ...info, moreResults: 1 }),
        "invalid continuation state",
      ],
    ];

    for (const [, malformed, expected] of malformedResponses) {
      const backend = new HistoryDatastoreBackend();
      const client = backend.client();
      const storage = new DatastoreStorageFactory({ client: client as never }).createEntityStorage(
        input(),
      );
      await storage.states.append(state(1));
      const runQuery = client.runQuery.bind(client);
      client.runQuery = async (query) => {
        const [rows, info] = await runQuery(query);
        if (query.kind === "$SpineEntityStateOrder") return [rows, malformed(info)] as never;
        return [rows, info];
      };

      await expect(storage.states.backward("task", 2)).rejects.toThrow(expected);
    }
  });

  it("rejects a durable event-order marker whose event row has disappeared", async () => {
    const backend = new HistoryDatastoreBackend();
    const storage = new DatastoreStorageFactory({
      client: backend.client() as never,
    }).createEntityStorage(input());
    await storage.events.append(historyEvent("orphaned-event", "task"));
    const [eventKey] = [...backend.entities.keys()].filter((serialized) =>
      (JSON.parse(serialized) as [unknown, readonly string[]])[1].includes("$SpineEntityEvent"),
    );
    if (eventKey === undefined) throw new Error("Expected a durable event row.");
    backend.entities.delete(eventKey);

    await expect(storage.events.backward("task", 1)).rejects.toThrow(
      "event marker references a missing event identity",
    );
  });

  it("retries a state trim after a provider conflict", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const storage = new DatastoreStorageFactory({ client: client as never }).createEntityStorage(
      input(),
    );
    await storage.states.append(state(1));
    let conflicts = 1;
    const transaction = client.transaction.bind(client);
    client.transaction = () => {
      const value = transaction();
      const commit = value.commit.bind(value);
      value.commit = async () => {
        if (conflicts > 0) {
          conflicts -= 1;
          throw Object.assign(new Error("transaction aborted"), { code: 10 });
        }
        return commit();
      };
      return value;
    };

    await storage.states.trim("task", 0);

    await expect(storage.states.backward("task", 1)).resolves.toEqual([]);
    expect(client.transactionCalls).toBeGreaterThanOrEqual(3);
  });

  it("reopens a failed binding and accepts a state append whose commit was applied", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const storage = new DatastoreStorageFactory({ client: client as never }).createEntityStorage(
      input(),
    );
    let bindingFailure = true;
    const transaction = client.transaction.bind(client);
    client.transaction = () => {
      const value = transaction();
      const commit = value.commit.bind(value);
      value.commit = async () => {
        if (bindingFailure) {
          bindingFailure = false;
          throw new Error("binding connection closed");
        }
        return commit();
      };
      return value;
    };
    await expect(storage.current.read("task")).rejects.toThrow("binding connection closed");
    await expect(storage.current.read("task")).resolves.toBeUndefined();
    backend.failCommitAppliedOnce = true;

    await expect(storage.states.append(state(1))).resolves.toBeUndefined();
    await expect(storage.states.backward("task", 1)).resolves.toMatchObject([
      { state: { value: "1" } },
    ]);
  });
});

function time(seconds: number) {
  return create(TimestampSchema, { seconds: BigInt(seconds), nanos: 0 });
}
function state(version: number) {
  return {
    entityId: "task",
    state: create(StringValueSchema, { value: String(version) }),
    version: BigInt(version),
    createdAt: time(version),
  };
}
function historyEvent(id: string, entityId: string) {
  return {
    entityId,
    event: create(EventSchema, { id: create(EventIdSchema, { value: id }) }),
    producerVersion: 1n,
    createdAt: time(1),
  };
}
function countKinds(backend: HistoryDatastoreBackend, kind: string): number {
  return [...backend.entities.keys()].filter((serialized) =>
    (JSON.parse(serialized) as [unknown, readonly string[]])[1].includes(kind),
  ).length;
}
function root(backend: HistoryDatastoreBackend, entityId: string): Record<string, unknown> {
  const entry = [...backend.entities.entries()].find(([serialized]) => {
    const path = (JSON.parse(serialized) as [unknown, readonly string[]])[1];
    return (
      path[0] === "$SpineEntity" &&
      path.length === 2 &&
      path[1]?.includes(Buffer.from(entityId).toString("hex"))
    );
  });
  if (entry === undefined) throw new Error("Expected an entity root.");
  return entry[1].data;
}
function deleteEntityRoot(backend: HistoryDatastoreBackend, entityId: string): void {
  const serialized = [...backend.entities.keys()].find((candidate) => {
    const path = (JSON.parse(candidate) as [unknown, readonly string[]])[1];
    return (
      path[0] === "$SpineEntity" &&
      path.length === 2 &&
      path[1]?.includes(Buffer.from(entityId).toString("hex"))
    );
  });
  if (serialized === undefined) throw new Error("Expected an entity root.");
  backend.entities.delete(serialized);
}
function deleteEntriesForKind(backend: HistoryDatastoreBackend, kind: string): void {
  for (const serialized of backend.entities.keys()) {
    const path = (JSON.parse(serialized) as [unknown, readonly string[]])[1];
    if (path.includes(kind)) backend.entities.delete(serialized);
  }
}
function entryForKind(
  backend: HistoryDatastoreBackend,
  kind: string,
): { readonly data: Record<string, unknown>; readonly revision: number } {
  const entry = [...backend.entities.entries()].find(([serialized]) =>
    (JSON.parse(serialized) as [unknown, readonly string[]])[1].includes(kind),
  );
  if (entry === undefined) throw new Error(`Expected ${kind} marker.`);
  return entry[1];
}
function corruptMarkerKey(
  backend: HistoryDatastoreBackend,
  kind: string,
  name: string | ((current: string) => string),
): void {
  const entry = [...backend.entities.entries()].find(([serialized]) =>
    (JSON.parse(serialized) as [string | undefined, readonly string[]])[1].includes(kind),
  );
  if (entry === undefined) throw new Error(`Expected ${kind} marker.`);
  const [serialized, value] = entry;
  const [namespace, path] = JSON.parse(serialized) as [string | undefined, string[]];
  const current = path.at(-1);
  if (current === undefined) throw new Error(`Expected ${kind} marker name.`);
  path[path.length - 1] = typeof name === "string" ? name : name(current);
  backend.entities.delete(serialized);
  backend.entities.set(JSON.stringify([namespace, path]), value);
}
