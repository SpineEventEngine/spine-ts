import { create, type Message } from "@bufbuild/protobuf";
import { StringValueSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import { EventStore } from "../../src/event/event-store.js";
import type { EntityCommitStorage } from "../../src/internal/entity-commit.js";
import { EntityCommitStorageFactories } from "../../src/internal/entity-commit.js";
import type { EntityStorageInput } from "../../src/internal/entity-history.js";
import { InMemoryStorageFactory } from "../../src/memory/in-memory-storage-factory.js";
import type { RecordStorage } from "../../src/record/record-storage.js";
import { StorageFactory } from "../../src/storage/storage-factory.js";

describe("MemoryEntityCommitStorage", () => {
  it("makes current, histories, events, and receipt visible as one commit", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const entity = factory.createEntityStorage(input) as EntityHandle;
    const commits = commitStorage(factory, input);
    const delivery = event("delivery-1");

    await expect(
      commits.commit({
        context: input.context,
        entity: input,
        id: "command-1:task",
        entityId: "task",
        next: current("next", 1n),
        states: [state("next", 1n)],
        diagnostics: [diagnostic("diagnostic-1", 1n)],
        events: [delivery],
      }),
    ).resolves.toBe("committed");

    await expect(entity.current.read("task")).resolves.toMatchObject({
      state: { value: "next" },
      version: 1n,
    });
    await expect(entity.states.backward("task", 10)).resolves.toMatchObject([
      { state: { value: "next" }, version: 1n },
    ]);
    await expect(entity.events.backward("task", 10)).resolves.toMatchObject([
      { id: { value: "diagnostic-1" } },
    ]);
    const events = new EventStore(input.context, factory);
    await expect(events.read()).resolves.toMatchObject([{ id: { value: "delivery-1" } }]);

    await expect(
      commits.commit({
        context: input.context,
        entity: input,
        id: "command-1:task",
        entityId: "task",
        next: current("next", 1n),
        states: [state("next", 1n)],
        diagnostics: [diagnostic("diagnostic-1", 1n)],
        events: [delivery],
      }),
    ).resolves.toBe("replayed");
    events.close();
    commits.close();
    entity.close();
  });

  it("leaves every store unchanged when preflight rejects the commit", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const entity = factory.createEntityStorage(input) as EntityHandle;
    const commits = commitStorage(factory, input);
    const duplicate = event("duplicate");

    await expect(
      commits.commit({
        context: input.context,
        entity: input,
        id: "failed:task",
        entityId: "task",
        next: current("partial", 1n),
        states: [state("partial", 1n)],
        diagnostics: [diagnostic("diagnostic-partial", 1n)],
        events: [duplicate, duplicate],
      }),
    ).rejects.toThrow(/unique delivery-event IDs/);

    await expect(entity.current.read("task")).resolves.toBeUndefined();
    await expect(entity.states.backward("task", 10)).resolves.toEqual([]);
    await expect(entity.events.backward("task", 10)).resolves.toEqual([]);
    const events = new EventStore(input.context, factory);
    await expect(events.read()).resolves.toEqual([]);
    events.close();
    commits.close();
    entity.close();
  });

  it("serializes competing compatible handles and rejects divergent receipt reuse", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const first = commitStorage(factory, input);
    const second = commitStorage(factory, input);
    const results = await Promise.all([
      first.commit({
        context: input.context,
        entity: input,
        id: "first:task",
        entityId: "task",
        next: current("first", 1n),
      }),
      second.commit({
        context: input.context,
        entity: input,
        id: "second:task",
        entityId: "task",
        next: current("second", 1n),
      }),
    ]);
    expect(results.sort()).toEqual(["committed", "conflict"]);
    await expect(
      first.commit({
        context: input.context,
        entity: input,
        id: "first:task",
        entityId: "task",
        next: current("divergent", 2n),
      }),
    ).rejects.toThrow(/different content/);
    first.close();
    expect(() =>
      first.commit({
        context: input.context,
        entity: input,
        id: "closed",
        entityId: "task",
        next: current("closed", 2n),
      }),
    ).toThrow(/closed/);
    second.close();
  });

  it("commits a current record when optional histories and delivery events are omitted", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const entity = factory.createEntityStorage(input) as EntityHandle;
    const commits = commitStorage(factory, input);

    await expect(
      commits.commit({
        context: input.context,
        entity: input,
        id: "current-only:task",
        entityId: "task",
        next: current("current-only", 1n),
      }),
    ).resolves.toBe("committed");

    await expect(entity.current.read("task")).resolves.toMatchObject({
      state: { value: "current-only" },
      version: 1n,
    });
    await expect(entity.states.backward("task", 10)).resolves.toEqual([]);
    await expect(entity.events.backward("task", 10)).resolves.toEqual([]);
    const events = new EventStore(input.context, factory);
    await expect(events.read()).resolves.toEqual([]);
    events.close();
    commits.close();
    entity.close();
  });

  it("returns conflict for absent or meaningfully different expected current records", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const commits = commitStorage(factory, input);
    const persisted = current("persisted", 1n);

    await expect(
      commits.commit({
        context: input.context,
        entity: input,
        id: "missing:task",
        entityId: "task",
        expected: current("missing", 0n),
        next: current("unexpected", 1n),
      }),
    ).resolves.toBe("conflict");
    await expect(
      commits.commit({
        context: input.context,
        entity: input,
        id: "seed:task",
        entityId: "task",
        next: persisted,
      }),
    ).resolves.toBe("committed");

    for (const [id, expected] of [
      ["undefined", undefined],
      ["state", current("different", 1n)],
      ["version", current("persisted", 2n)],
      ["archived", { ...persisted, archived: true }],
      ["deleted", { ...persisted, deleted: true }],
    ] as const) {
      await expect(
        commits.commit({
          context: input.context,
          entity: input,
          id: `${id}:task`,
          entityId: "task",
          ...(expected === undefined ? {} : { expected }),
          next: current("unexpected", 2n),
        }),
      ).resolves.toBe("conflict");
    }
    commits.close();
  });

  it("keeps sibling handles usable after a handle is closed repeatedly", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const first = commitStorage(factory, input);
    const second = commitStorage(factory, input);

    first.close();
    expect(() => {
      first.close();
    }).not.toThrow();
    await expect(
      second.commit({
        context: input.context,
        entity: input,
        id: "sibling:task",
        entityId: "task",
        next: current("sibling", 1n),
      }),
    ).resolves.toBe("committed");
    second.close();
  });

  it("rejects a commit input from another entity storage scope", () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const commits = commitStorage(factory, input);
    const incompatible = { ...input, storageKey: "tasks.Other:current" };

    expect(() =>
      commits.commit({
        context: incompatible.context,
        entity: incompatible,
        id: "wrong-scope:task",
        entityId: "task",
        next: current("wrong-scope", 1n),
      }),
    ).toThrow(/another Entity storage scope/);
    commits.close();
  });

  it("reports when a storage factory has not registered atomic commits", () => {
    expect(() =>
      EntityCommitStorageFactories.create(new UnregisteredStorageFactory(), entityInput()),
    ).toThrow(/does not provide the required atomic Entity commit storage/);
  });
});

const context = Object.freeze({ name: "Tasks", multitenant: false });

function commitStorage(
  factory: InMemoryStorageFactory,
  input: EntityStorageInput<string, ReturnType<typeof createString>>,
): EntityCommitStorage {
  return EntityCommitStorageFactories.create(factory, input);
}

function entityInput(): EntityStorageInput<string, ReturnType<typeof createString>> {
  return {
    context,
    id: { clone: (id) => id, fingerprint: "string", key: (id) => id },
    extractId: () => "task",
    columns: [],
    layout: "entity-v1",
    stateSchema: StringValueSchema,
    storageKey: "tasks.Task:current",
  };
}

function createString(value: string) {
  return create(StringValueSchema, { value });
}

function current(value: string, version: bigint) {
  return {
    id: "task",
    state: createString(value),
    version,
    archived: false,
    deleted: false,
  };
}

function state(value: string, version: bigint) {
  return {
    entityId: "task",
    state: createString(value),
    version,
    createdAt: create(TimestampSchema, { seconds: version }),
  };
}

function diagnostic(id: string, version: bigint) {
  return {
    entityId: "task",
    event: event(id),
    producerVersion: version,
    createdAt: create(TimestampSchema, { seconds: version }),
  };
}

function event(id: string) {
  return create(EventSchema, { id: create(EventIdSchema, { value: id }) });
}

interface EntityHandle {
  readonly current: { read(id: string): Promise<unknown> };
  readonly states: { backward(id: string, depth: number): Promise<readonly unknown[]> };
  readonly events: { backward(id: string, depth: number): Promise<readonly unknown[]> };
  close(): void;
}

class UnregisteredStorageFactory extends StorageFactory {
  protected onCreateRecordStorage<I, R extends Message>(): RecordStorage<I, R> {
    throw new Error("This test factory cannot create record storage.");
  }
}
