import { create } from "@bufbuild/protobuf";
import { StringValueSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import { EventStore } from "../../src/event/event-store.js";
import type { EntityCommitStorage } from "../../src/internal/entity-commit.js";
import { EntityCommitStorageFactories } from "../../src/internal/entity-commit.js";
import type { EntityStorageInput } from "../../src/internal/entity-history.js";
import { InMemoryStorageFactory } from "../../src/memory/in-memory-storage-factory.js";

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
