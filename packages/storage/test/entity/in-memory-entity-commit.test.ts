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

import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import {
  AnySchema,
  StringValueSchema,
  TimestampSchema,
  type Timestamp,
} from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema, VersionSchema, type Event } from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  LifecycleFlagsSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { describe, expect, it, vi } from "vitest";

import { EventStore } from "../../src/event/event-store.js";
import { stateHistorySpec } from "../../src/entity/entity-history-record-spec.js";
import type { EntityCommitStorage } from "../../src/internal/entity-commit.js";
import { EntityCommitStorageFactories } from "../../src/internal/entity-commit.js";
import type { EntityStorageInput } from "../../src/internal/entity-history.js";
import { InMemoryStorageFactory } from "../../src/memory/in-memory-storage-factory.js";
import { InMemoryRecordStorage } from "../../src/memory/in-memory-record-storage.js";
import { RecordStorage } from "../../src/record/record-storage.js";
import { RecordSpec } from "../../src/record/record-spec.js";
import { StorageFactory } from "../../src/storage/storage-factory.js";

describe("MemoryEntityCommitStorage", () => {
  it("makes current state, both histories, and delivery events visible as one commit", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const entity = factory.createEntityStorage(input) as EntityHandle;
    const commits = commitStorage(factory, input);
    const delivery = event("delivery-1");

    await expect(
      commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("next", 1n),
        states: [state("next", 1n)],
        diagnostics: [diagnostic("diagnostic-1", 1n)],
        events: [delivery],
      }),
    ).resolves.toBe("committed");

    await expect(entity.current.read("task")).resolves.toEqual(current("next", 1n));
    await expect(entity.states.backward("task", 10)).resolves.toEqual([state("next", 1n)]);
    await expect(entity.events.backward("task", 10)).resolves.toMatchObject([
      { id: { value: "diagnostic-1" } },
    ]);
    const events = new EventStore(input.context, factory);
    await expect(events.read()).resolves.toMatchObject([{ id: { value: "delivery-1" } }]);

    await expect(
      commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("next", 1n),
        states: [state("next", 1n)],
        diagnostics: [diagnostic("diagnostic-1", 1n)],
        events: [delivery],
      }),
    ).resolves.toBe("conflict");
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

  it("publishes nothing when a staged history write fails after current state is staged", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const entity = factory.createEntityStorage(input) as EntityHandle;
    const commits = commitStorage(factory, input);

    await expect(
      commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("partial", 1n),
        states: [state("partial", 1n)],
        diagnostics: [event("invalid-diagnostic")],
      }),
    ).rejects.toThrow(/producer ID/);

    await expect(entity.current.read("task")).resolves.toBeUndefined();
    await expect(entity.states.backward("task", 10)).resolves.toEqual([]);
    await expect(entity.events.backward("task", 10)).resolves.toEqual([]);
    commits.close();
    entity.close();
  });

  it("serializes competing compatible handles and returns a current-state conflict", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const first = commitStorage(factory, input);
    const second = commitStorage(factory, input);
    const results = await Promise.all([
      first.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("first", 1n),
      }),
      second.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("second", 1n),
      }),
    ]);
    expect(results.sort()).toEqual(["committed", "conflict"]);
    await expect(
      first.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("divergent", 2n),
      }),
    ).resolves.toBe("conflict");
    first.close();
    expect(() =>
      first.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("closed", 2n),
      }),
    ).toThrow(/closed/);
    second.close();
  });

  it("retains current and enabled history rows from concurrent commits for different entity IDs", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const entity = factory.createEntityStorage(input) as EntityHandle;
    const commits = commitStorage(factory, input);

    await Promise.all([
      commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("task", 1n, undefined, "task"),
        states: [state("task", 1n, "task")],
        diagnostics: [diagnostic("task-event", 1n, "task")],
      }),
      commits.commit({
        context: input.context,
        entity: input,
        entityId: "other",
        next: current("other", 1n, undefined, "other"),
        states: [state("other", 1n, "other")],
        diagnostics: [diagnostic("other-event", 1n, "other")],
      }),
    ]);

    await expect(entity.current.read("task")).resolves.toEqual(
      current("task", 1n, undefined, "task"),
    );
    await expect(entity.current.read("other")).resolves.toEqual(
      current("other", 1n, undefined, "other"),
    );
    expect((await entity.states.backward("task", 1)).length).toBe(1);
    expect((await entity.states.backward("other", 1)).length).toBe(1);
    expect((await entity.events.backward("task", 1)).map((value) => value.id?.value)).toEqual([
      "task-event",
    ]);
    expect((await entity.events.backward("other", 1)).map((value) => value.id?.value)).toEqual([
      "other-event",
    ]);
    commits.close();
    entity.close();
  });

  it("serializes a state-history truncate ahead of a queued Entity commit", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const entity = factory.createEntityStorage(input) as EntityHandle;
    const commits = commitStorage(factory, input);
    const seeded = current("old", 1n, create(TimestampSchema, { seconds: 1n }));
    await commits.commit({
      context: input.context,
      entity: input,
      entityId: "task",
      next: seeded,
      states: [state("old", 1n)],
    });

    const selected = deferred();
    const reached = deferred();
    let pause = true;
    const queryEntries = vi
      .spyOn(InMemoryRecordStorage.prototype, "queryEntries")
      .mockImplementation(async function (this: InMemoryRecordStorage<unknown, Message>, query) {
        if (pause) {
          pause = false;
          reached.resolve(undefined);
          await selected.promise;
        }
        return RecordStorage.prototype.queryEntries.call(this, query);
      });
    try {
      const truncating = entity.states.truncate(create(TimestampSchema, { seconds: 2n }));
      await reached.promise;
      const committing = commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        expected: seeded,
        next: current("new", 2n, create(TimestampSchema, { seconds: 2n })),
        states: [state("new", 2n)],
      });
      selected.resolve(undefined);
      await Promise.all([truncating, committing]);
    } finally {
      queryEntries.mockRestore();
    }

    expect(await entity.states.backward("task", 5)).toEqual([state("new", 2n)]);
    commits.close();
    entity.close();
  });

  it("compares the complete persisted Version envelope during a read-modify-write commit", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const entity = factory.createEntityStorage(input) as EntityHandle;
    const commits = commitStorage(factory, input);
    const seeded = current("before", 1n, create(TimestampSchema, { seconds: 41n, nanos: 7 }));

    await expect(
      commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: seeded,
      }),
    ).resolves.toBe("committed");
    const loaded = (await entity.current.read("task")) as EntityRecord;

    await expect(
      commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        expected: loaded,
        next: current("after", 2n, create(TimestampSchema, { seconds: 42n, nanos: 8 })),
      }),
    ).resolves.toBe("committed");
    await expect(entity.current.read("task")).resolves.toEqual(
      current("after", 2n, create(TimestampSchema, { seconds: 42n, nanos: 8 })),
    );

    commits.close();
    entity.close();
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
        entityId: "task",
        next: current("current-only", 1n),
      }),
    ).resolves.toBe("committed");

    await expect(entity.current.read("task")).resolves.toEqual(current("current-only", 1n));
    await expect(entity.states.backward("task", 10)).resolves.toEqual([]);
    await expect(entity.events.backward("task", 10)).resolves.toEqual([]);
    const events = new EventStore(input.context, factory);
    await expect(events.read()).resolves.toEqual([]);
    events.close();
    commits.close();
    entity.close();
  });

  it("does not bind any grouped histories or the Event Store for a current-only commit", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput(false);
    const createStorage = vi.spyOn(factory, "createRecordStorage");
    const entity = factory.createEntityStorage(input) as EntityHandle;
    const commits = commitStorage(factory, input);

    await expect(
      commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("current-only", 1n),
      }),
    ).resolves.toBe("committed");

    expect(createStorage).not.toHaveBeenCalled();
    await expect(entity.current.read("task")).resolves.toEqual(current("current-only", 1n));
    commits.close();
    entity.close();
  });

  it("does not consult or close supplied history handles for a current-only commit", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const layout = stateHistorySpec(StringValueSchema);
    const supplied = factory.createRecordStorage(input.context, layout.spec, layout.group);
    const read = vi.spyOn(supplied, "read");
    const close = vi.spyOn(supplied, "close");
    const commits = commitStorage(factory, { ...input, stateHistoryStorage: supplied });
    const commitInput = { ...input, stateHistoryStorage: supplied };

    await expect(
      commits.commit({
        context: input.context,
        entity: commitInput,
        entityId: "task",
        next: current("current-only", 1n),
      }),
    ).resolves.toBe("committed");

    expect(read).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(supplied.isOpen()).toBe(true);
    supplied.close();
    commits.close();
  });

  it("rejects retained history rows when that history is disabled", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput(false);
    const commits = commitStorage(factory, input);

    await expect(
      commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("next", 1n),
        states: [state("next", 1n)],
      }),
    ).rejects.toThrow(/state history when it is disabled/);
    await expect(
      commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("next", 1n),
        diagnostics: [diagnostic("diagnostic", 1n)],
      }),
    ).rejects.toThrow(/event history when it is disabled/);
    commits.close();
  });

  it("retains a direct Event Store append concurrent with an Entity commit", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const commits = commitStorage(factory, input);
    const events = new EventStore(input.context, factory);

    await Promise.all([
      events.append(event("direct")),
      commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("next", 1n),
        events: [event("committed")],
      }),
    ]);

    expect((await events.read()).map((entry) => entry.id?.value).sort()).toEqual([
      "committed",
      "direct",
    ]);
    events.close();
    commits.close();
  });

  it("retains a direct event-history append concurrent with an Entity commit", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const entity = factory.createEntityStorage(input) as EntityHandle;
    const commits = commitStorage(factory, input);

    await Promise.all([
      entity.events.append(diagnostic("direct-history", 1n)),
      commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("next", 2n),
        diagnostics: [diagnostic("committed-history", 2n)],
      }),
    ]);

    expect(
      (await entity.events.backward("task", 10)).map((value) => value.id?.value).sort(),
    ).toEqual(["committed-history", "direct-history"]);
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
        entityId: "task",
        expected: current("missing", 0n),
        next: current("unexpected", 1n),
      }),
    ).resolves.toBe("conflict");
    await expect(
      commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: persisted,
      }),
    ).resolves.toBe("committed");

    for (const [, expected] of [
      ["undefined", undefined],
      ["state", current("different", 1n)],
      ["version", current("persisted", 2n)],
      [
        "archived",
        create(EntityRecordSchema, {
          ...persisted,
          lifecycleFlags: create(LifecycleFlagsSchema, { archived: true }),
        }),
      ],
      [
        "deleted",
        create(EntityRecordSchema, {
          ...persisted,
          lifecycleFlags: create(LifecycleFlagsSchema, { deleted: true }),
        }),
      ],
    ] as const) {
      await expect(
        commits.commit({
          context: input.context,
          entity: input,
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
    const incompatible = { ...input, sourceType: EventSchema };

    expect(() =>
      commits.commit({
        context: incompatible.context,
        entity: incompatible,
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

function entityInput(
  histories = true,
): EntityStorageInput<string, ReturnType<typeof createString>> {
  return {
    context,
    id: {
      clone: (id) => id,
      key: (id) => id,
      pack: (id) => packed(createString(id)),
      unpack: unpackStringId,
    },
    columns: [],
    recordSpec: new RecordSpec<string, EntityRecord>({
      sourceType: StringValueSchema,
      recordType: EntityRecordSchema,
      idKind: "string",
      extractId: (record) => {
        if (record.entityId === undefined) throw new Error("EntityRecord.entityId is required.");
        const id = unpackStringId(record.entityId);
        if (id === undefined) throw new Error("EntityRecord.entityId has the wrong type.");
        return id;
      },
    }),
    sourceType: StringValueSchema,
    stateSchema: StringValueSchema,
    stateHistory: histories,
    eventHistory: histories,
  };
}

function createString(value: string) {
  return create(StringValueSchema, { value });
}

function current(value: string, version: bigint, timestamp?: Timestamp, id = "task"): EntityRecord {
  return create(EntityRecordSchema, {
    entityId: packed(createString(id)),
    lifecycleFlags: { archived: false, deleted: false },
    state: packed(createString(value)),
    version: create(VersionSchema, {
      number: Number(version),
      ...(timestamp === undefined ? {} : { timestamp }),
    }),
  });
}

function packed(value: ReturnType<typeof createString>) {
  return create(AnySchema, {
    typeUrl: "type.spine.io/google.protobuf.StringValue",
    value: toBinary(StringValueSchema, value),
  });
}

function unpackStringId(id: NonNullable<EntityRecord["entityId"]>) {
  return id.typeUrl === "type.spine.io/google.protobuf.StringValue"
    ? fromBinary(StringValueSchema, id.value).value
    : undefined;
}

function state(value: string, version: bigint, id = "task") {
  return current(value, version, create(TimestampSchema, { seconds: version }), id);
}

function diagnostic(id: string, version: bigint, producer = "task") {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    context: {
      producerId: packed(createString(producer)),
      version: create(VersionSchema, { number: Number(version) }),
      timestamp: create(TimestampSchema, { seconds: version }),
    },
  });
}

function event(id: string) {
  return create(EventSchema, { id: create(EventIdSchema, { value: id }) });
}

interface EntityHandle {
  readonly current: { read(id: string): Promise<unknown> };
  readonly states: {
    backward(id: string, depth: number): Promise<readonly EntityRecord[]>;
    truncate(olderThan: Timestamp): Promise<void>;
  };
  readonly events: {
    append(event: Event): Promise<void>;
    backward(id: string, depth: number): Promise<readonly Event[]>;
  };
  close(): void;
}

function deferred<T = undefined>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((fulfilled) => {
    resolve = fulfilled;
  });
  return { promise, resolve };
}

class UnregisteredStorageFactory extends StorageFactory {
  protected onCreateRecordStorage<I, R extends Message>(): RecordStorage<I, R> {
    throw new Error("This test factory cannot create record storage.");
  }
}
