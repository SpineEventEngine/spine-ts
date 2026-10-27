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

import { create, ScalarType, type Message } from "@bufbuild/protobuf";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  EventIdSchema,
  EventSchema,
  TenantIdSchema,
  VersionSchema,
  type Event,
} from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { describe, expect, it, vi } from "vitest";
import { AnyPacker } from "@spine-event-engine/core";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { TaskCreatedSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";
import { TaskListSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_list_pb.js";
import { TaskSchema } from "../../../../examples/todo/generated/spine/examples/todo/tasks_pb.js";

import { EventStore } from "../../src/event/event-store.js";
import { ColumnTypes } from "../../src/record/column-type.js";
import { RecordColumn } from "../../src/record/record-column.js";
import { stateHistorySpec } from "../../src/entity/entity-history-record-spec.js";
import type { EntityCommitStorage } from "../../src/internal/entity-commit.js";
import { EntityCommitStorageFactories } from "../../src/internal/entity-commit.js";
import { StoragePreparations } from "../../src/internal/storage-preparation.js";
import type { EntityStorageInput } from "../../src/internal/entity-history.js";
import { InMemoryStorageFactory } from "../../src/memory/in-memory-storage-factory.js";
import { InMemoryStorageBackend } from "../../src/memory/in-memory-storage-backend.js";
import {
  MemoryEntityRecordStorage,
  MemoryEntityStorageFactory,
} from "../../src/memory/in-memory-entity-history.js";
import { InMemoryRecordStorage } from "../../src/memory/in-memory-record-storage.js";
import { TenantRecords } from "../../src/memory/tenant-records.js";
import { RecordStorage } from "../../src/record/record-storage.js";
import { RecordSpec } from "../../src/record/record-spec.js";
import { StorageFactory } from "../../src/storage/storage-factory.js";

describe("MemoryEntityCommitStorage", () => {
  it("admits all three memory preparation calls before close", async () => {
    const factory = new InMemoryStorageFactory();
    const preparation = StoragePreparations.for(factory);
    const input = entityInput(true);
    const agent = {
      context: input.context,
      stateType: TaskSchema.typeName,
      id: { key: (id: string) => id },
    };
    const admitted = [
      preparation.prepareRecord(input.context, input.recordSpec, undefined, "check"),
      preparation.prepareEntity(input, "check"),
      preparation.prepareAgentHistory(agent, "check"),
    ];
    await factory.close();
    await expect(Promise.all(admitted)).resolves.toEqual([undefined, undefined, undefined]);
    await expect(
      preparation.prepareRecord(input.context, input.recordSpec, undefined, "check"),
    ).rejects.toThrow(/closed/);
    await expect(preparation.prepareEntity(input, "check")).rejects.toThrow(/closed/);
    await expect(preparation.prepareAgentHistory(agent, "check")).rejects.toThrow(/closed/);
  });

  it("rejects Entity query columns that differ from its current RecordSpec", async () => {
    const factory = new InMemoryStorageFactory();
    const input = {
      ...entityInput(false),
      columns: [
        new RecordColumn<EntityRecord>("actual", ColumnTypes.scalar(ScalarType.STRING), () => "x"),
      ],
    };
    await expect(StoragePreparations.for(factory).prepareEntity(input, "check")).rejects.toThrow(
      /columns|incompatible/,
    );
    expect(() => factory.createEntityStorage(input)).toThrow(/columns|incompatible/);
    await factory.close();
  });

  it("validates Agent audit tenancy before registering a preparation", async () => {
    const factory = new InMemoryStorageFactory();
    const preparation = StoragePreparations.for(factory);
    const audit = { stateType: TaskSchema.typeName, id: { key: (id: string) => id } };
    await expect(
      preparation.prepareAgentHistory(
        { ...audit, context: { name: "Tasks", multitenant: true } as never },
        "check",
      ),
    ).rejects.toThrow(/tenantId/);
    await expect(
      preparation.prepareAgentHistory(
        {
          ...audit,
          context: {
            name: "Tasks",
            multitenant: false,
            tenantId: create(TenantIdSchema, { kind: { case: "value", value: "extra" } }),
          } as never,
        },
        "check",
      ),
    ).rejects.toThrow(/does not accept/);
    await expect(
      preparation.prepareAgentHistory({ ...audit, context }, "check"),
    ).resolves.toBeUndefined();
    await factory.close();
  });
  it("prepares current, history, and Agent audit definitions without opening tenant storage", async () => {
    const backend = new InMemoryStorageBackend();
    const factory = new InMemoryStorageFactory(backend);
    const input = {
      ...entityInput(true),
      context: {
        name: "Tasks",
        multitenant: true,
        tenantId: create(TenantIdSchema, { kind: { case: "value", value: "unseen" } }),
      } as const,
    };
    const createEntity = vi.spyOn(MemoryEntityStorageFactory.prototype, "create");
    try {
      const preparation = StoragePreparations.for(factory);
      await preparation.prepareEntity(input, "check");
      await preparation.prepareEntity(input, "create");
      await expect(
        preparation.prepareAgentHistory(
          {
            context: input.context,
            stateType: " ",
            id: { key: (id: string) => id },
          },
          "check",
        ),
      ).rejects.toThrow(/state type/);
      await preparation.prepareAgentHistory(
        {
          context: input.context,
          stateType: TaskSchema.typeName,
          id: { key: (id: string) => id },
        },
        "check",
      );
      expect(createEntity).not.toHaveBeenCalled();
      expect(InMemoryStorageBackend.tenantCount(backend)).toBe(0);
      await expect(factory.tenantCatalog().all()).resolves.toEqual([]);
    } finally {
      createEntity.mockRestore();
      await factory.close();
    }
  });
  it("retains one current adapter across repeated current-only commits", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput(false);
    const created = vi.spyOn(MemoryEntityStorageFactory.prototype, "create");
    const commits = commitStorage(factory, input);
    try {
      for (const name of ["first", "second"]) {
        await commits.commit({
          context: input.context,
          entity: input,
          entityId: "task",
          next: current(name, 1n),
        });
      }
      expect(created).toHaveBeenCalledTimes(1);
    } finally {
      created.mockRestore();
      await commits.close();
      await factory.close();
    }
  });
  it("removes individually closed commit roots before factory shutdown", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput(false);
    const handles = Array.from({ length: 4 }, () => commitStorage(factory, input));
    const closes = handles.map((handle) => vi.spyOn(handle, "close"));
    await Promise.all(handles.map((handle) => handle.close()));
    await factory.close();
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
  });

  it("drains an admitted write before factory and commit closure", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput(false);
    const commits = commitStorage(factory, input);
    const entered = deferred();
    const release = deferred();
    const original = Object.getOwnPropertyDescriptor(MemoryEntityRecordStorage.prototype, "write")
      ?.value as MemoryEntityRecordStorage<unknown>["write"];
    const write = vi
      .spyOn(MemoryEntityRecordStorage.prototype, "write")
      .mockImplementation(async function (this: MemoryEntityRecordStorage<unknown>, record) {
        entered.resolve(undefined);
        await release.promise;
        return original.call(this, record);
      });
    try {
      const admitted = commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("first", 1n),
      });
      await entered.promise;
      const closing = factory.close();
      expect(() =>
        commits.commit({
          context: input.context,
          entity: input,
          entityId: "task",
          next: current("later", 2n),
        }),
      ).toThrow(/closed/);
      release.resolve(undefined);
      await expect(admitted).resolves.toBeUndefined();
      await expect(closing).resolves.toBeUndefined();
      expect(commits.close()).toBe(commits.close());
    } finally {
      release.resolve(undefined);
      write.mockRestore();
    }
  });
  it("registers admission before a reentrant provider acquisition callback", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput(false);
    const commits = commitStorage(factory, input);
    const original = Object.getOwnPropertyDescriptor(MemoryEntityStorageFactory.prototype, "create")
      ?.value as MemoryEntityStorageFactory["create"];
    const create = vi
      .spyOn(MemoryEntityStorageFactory.prototype, "create")
      .mockImplementation(function (this: MemoryEntityStorageFactory, entity) {
        expect(() => {
          commits.closeIdle();
        }).toThrow(/active/);
        return original.call(this, entity);
      });
    try {
      await commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("admitted", 1n),
      });
    } finally {
      create.mockRestore();
      await commits.close();
      await factory.close();
    }
  });
  it("drains a commit when ID cloning reenters factory close", async () => {
    const factory = new InMemoryStorageFactory();
    const base = entityInput(false);
    let closing: Promise<void> | undefined;
    const input = {
      ...base,
      id: {
        ...base.id,
        clone: (id: string) => {
          expect(() => {
            commits.closeIdle();
          }).toThrow(/active/);
          closing = factory.close();
          return id;
        },
      },
    };
    const commits = commitStorage(factory, input);
    const admitted = commits.commit({
      context: input.context,
      entity: input,
      entityId: "task",
      next: current("captured", 1n),
    });
    await expect(admitted).resolves.toBeUndefined();
    await expect(closing).resolves.toBeUndefined();
    await expect(commits.close()).resolves.toBeUndefined();
  });

  it("reports idle cleanup failure synchronously without an orphaned rejection", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const commits = commitStorage(factory, input);
    await commits.commit({
      context: input.context,
      entity: input,
      entityId: "task",
      next: current("stored", 1n),
      states: [state("stored", 1n)],
    });
    const failure = new Error("state close failed");
    const original = Object.getOwnPropertyDescriptor(RecordStorage.prototype, "close")
      ?.value as InMemoryRecordStorage<unknown, Message>["close"];
    const close = vi.spyOn(InMemoryRecordStorage.prototype, "close").mockImplementation(function (
      this: InMemoryRecordStorage<unknown, Message>,
    ) {
      original.call(this);
      throw failure;
    });
    try {
      expect(() => {
        commits.closeIdle();
      }).toThrow(failure);
      expect(() => {
        commits.closeIdle();
      }).toThrow(failure);
      await expect(commits.close()).rejects.toBe(failure);
      await expect(factory.close()).resolves.toBeUndefined();
    } finally {
      close.mockRestore();
    }
  });
  it("retains acquisition and rollback failures, then permits another commit", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const commits = commitStorage(factory, input);
    const acquisition = new Error("history acquisition failed");
    const cleanup = new Error("new current cleanup failed");
    const originalBackend = Object.getOwnPropertyDescriptor(
      MemoryEntityStorageFactory.prototype,
      "backend",
    )?.value as MemoryEntityStorageFactory["backend"];
    const backend = vi.spyOn(MemoryEntityStorageFactory.prototype, "backend");
    const originalClose = Object.getOwnPropertyDescriptor(RecordStorage.prototype, "close")
      ?.value as InMemoryRecordStorage<unknown, Message>["close"];
    const close = vi.spyOn(InMemoryRecordStorage.prototype, "close");
    backend.mockImplementationOnce(function (this: MemoryEntityStorageFactory, entity) {
      return originalBackend.call(this, entity);
    });
    backend.mockImplementationOnce(() => {
      throw acquisition;
    });
    close.mockImplementationOnce(function (this: InMemoryRecordStorage<unknown, Message>) {
      originalClose.call(this);
      throw cleanup;
    });
    try {
      const mutation = {
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("first", 1n),
        states: [state("first", 1n)],
      };
      await expect(commits.commit(mutation)).rejects.toMatchObject({
        errors: [acquisition, cleanup],
      });
      await expect(commits.commit(mutation)).resolves.toBeUndefined();
    } finally {
      backend.mockRestore();
      close.mockRestore();
      await commits.close();
      await factory.close();
    }
  });
  it("attempts every retained close and catalog cleanup after multiple failures", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const commits = commitStorage(factory, input);
    await commits.commit({
      context: input.context,
      entity: input,
      entityId: "task",
      next: current("stored", 1n),
      states: [state("stored", 1n)],
      diagnostics: [diagnostic("stored-diagnostic", 1n)],
      events: [event("stored-event")],
    });
    const failures = [
      new Error("state close"),
      new Error("diagnostic close"),
      new Error("delivery close"),
    ];
    const catalogFailure = new Error("catalog close");
    const originalClose = Object.getOwnPropertyDescriptor(RecordStorage.prototype, "close")
      ?.value as InMemoryRecordStorage<unknown, Message>["close"];
    let closed = 0;
    const close = vi.spyOn(InMemoryRecordStorage.prototype, "close").mockImplementation(function (
      this: InMemoryRecordStorage<unknown, Message>,
    ) {
      originalClose.call(this);
      throw failures[closed++] ?? new Error("Unexpected retained close.");
    });
    const catalog = vi.spyOn(factory.tenantCatalog(), "close").mockRejectedValue(catalogFailure);
    try {
      const outcome = factory.close();
      await expect(outcome).rejects.toMatchObject({
        errors: [{ errors: failures }, catalogFailure],
      });
      expect(closed).toBe(3);
      expect(catalog).toHaveBeenCalledTimes(1);
      await expect(commits.close()).rejects.toMatchObject({ errors: failures });
      expect(factory.close()).toBe(outcome);
    } finally {
      close.mockRestore();
      catalog.mockRestore();
    }
  });
  it("replaces a different current record without an expected-state result", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput(false);
    const entity = factory.createEntityStorage(input) as EntityHandle;
    const commits = commitStorage(factory, input);
    await commits.commit({
      context: input.context,
      entity: input,
      entityId: "task",
      next: current("one", 1n),
    });

    await expect(
      commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("two", 2n),
      }),
    ).resolves.toBeUndefined();
    await expect(entity.current.read("task")).resolves.toEqual(current("two", 2n));
    await commits.close();
    entity.close();
  });

  it("does not clone unrelated current records while committing one Entity", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput(false);
    const entity = factory.createEntityStorage(input) as EntityHandle & {
      current: { write(record: EntityRecord): Promise<void> };
    };
    const commits = commitStorage(factory, input);
    for (let index = 0; index < 500; index++) {
      await entity.current.write(
        current(`seed-${String(index)}`, 1n, undefined, `seed-${String(index)}`),
      );
    }
    const original = globalThis.structuredClone;
    const cloneMap = vi.spyOn(globalThis, "structuredClone").mockImplementation((value) => {
      if (value instanceof Map) throw new Error("whole-map copy");
      return original(value);
    });
    try {
      await expect(
        commits.commit({
          context: input.context,
          entity: input,
          entityId: "task",
          next: current("next", 1n),
        }),
      ).resolves.toBeUndefined();
    } finally {
      cloneMap.mockRestore();
    }
    await expect(entity.current.read("seed-499")).resolves.toEqual(
      current("seed-499", 1n, undefined, "seed-499"),
    );
    await commits.close();
    entity.close();
  });

  it("allows a prepared save for the same Entity to finish while an earlier current write is blocked", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const entity = factory.createEntityStorage(input) as EntityHandle;
    const commits = commitStorage(factory, input);
    const entered = deferred();
    const release = deferred();
    const original = Object.getOwnPropertyDescriptor(MemoryEntityRecordStorage.prototype, "write")
      ?.value as MemoryEntityRecordStorage<unknown>["write"];
    let writes = 0;
    const write = vi
      .spyOn(MemoryEntityRecordStorage.prototype, "write")
      .mockImplementation(async function (this: MemoryEntityRecordStorage<unknown>, record) {
        if (++writes === 1) {
          entered.resolve(undefined);
          await release.promise;
        }
        return original.call(this, record);
      });
    try {
      const first = commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("first", 1n),
        states: [state("first", 1n)],
      });
      await entered.promise;
      await expect(
        commits.commit({
          context: input.context,
          entity: input,
          entityId: "task",
          next: current("second", 2n),
          states: [state("second", 2n)],
        }),
      ).resolves.toBeUndefined();
      await expect(entity.current.read("task")).resolves.toEqual(current("second", 2n));
      await expect(entity.states.backward("task", 2)).resolves.toEqual([
        state("second", 2n),
        state("first", 1n),
      ]);
      release.resolve(undefined);
      await first;
      await expect(entity.current.read("task")).resolves.toEqual(current("first", 1n));
    } finally {
      release.resolve(undefined);
      write.mockRestore();
      await commits.close();
      entity.close();
    }
  });

  it("isolates current, history, and delivery records from caller mutation", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const entity = factory.createEntityStorage(input) as EntityHandle;
    const commits = commitStorage(factory, input);
    const next = current("next", 1n);
    const retained = state("next", 1n);
    const delivery = event("delivery-isolated");
    await commits.commit({
      context: input.context,
      entity: input,
      entityId: "task",
      next,
      states: [retained],
      events: [delivery],
    });
    if (next.version === undefined || retained.version === undefined || delivery.id === undefined)
      throw new Error("Expected versioned Entity records and a delivery ID.");
    next.version.number = 99;
    retained.version.number = 99;
    delivery.id.value = "changed";
    await expect(entity.current.read("task")).resolves.toEqual(current("next", 1n));
    await expect(entity.states.backward("task", 1)).resolves.toEqual([state("next", 1n)]);
    const events = new EventStore(input.context, factory);
    expect((await events.read()).map((entry) => entry.id?.value)).toEqual(["delivery-isolated"]);
    await events.close();
    await commits.close();
    entity.close();
  });

  it("keeps staged history keys and writes on the pre-await input snapshot", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const entity = factory.createEntityStorage(input) as EntityHandle;
    const commits = commitStorage(factory, input);
    const entered = deferred();
    const release = deferred();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Call keeps the concrete storage receiver.
    const original = MemoryEntityRecordStorage.prototype.write;
    const write = vi
      .spyOn(MemoryEntityRecordStorage.prototype, "write")
      .mockImplementation(async function (this: MemoryEntityRecordStorage<unknown>, record) {
        entered.resolve(undefined);
        await release.promise;
        return original.call(this, record);
      });
    const next = current("accepted", 1n);
    const retained = state("accepted", 1n);
    const observed = diagnostic("accepted-diagnostic", 1n);
    const delivery = event("accepted-delivery");
    try {
      const pending = commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next,
        states: [retained],
        diagnostics: [observed],
        events: [delivery],
      });
      await entered.promise;
      if (
        next.version === undefined ||
        retained.version === undefined ||
        observed.context?.version === undefined ||
        delivery.id === undefined
      )
        throw new Error("Expected versioned records and an Event ID.");
      next.version.number = 8;
      retained.version.number = 8;
      observed.context.version.number = 8;
      delivery.id.value = "later-delivery";
      release.resolve(undefined);
      await expect(pending).resolves.toBeUndefined();
      await expect(entity.current.read("task")).resolves.toEqual(current("accepted", 1n));
      await expect(entity.states.backward("task", 1)).resolves.toEqual([state("accepted", 1n)]);
      expect((await entity.events.backward("task", 1))[0]?.id?.value).toBe("accepted-diagnostic");
      const events = new EventStore(input.context, factory);
      expect((await events.read()).map((entry) => entry.id?.value)).toEqual(["accepted-delivery"]);
      await events.close();
    } finally {
      release.resolve(undefined);
      write.mockRestore();
      await commits.close();
      entity.close();
    }
  });

  it("snapshots a queued commit before the earlier Entity write releases", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const entity = factory.createEntityStorage(input) as EntityHandle;
    const commits = commitStorage(factory, input);
    const entered = deferred();
    const release = deferred();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Call keeps the concrete storage receiver.
    const original = MemoryEntityRecordStorage.prototype.write;
    let writes = 0;
    const write = vi
      .spyOn(MemoryEntityRecordStorage.prototype, "write")
      .mockImplementation(async function (this: MemoryEntityRecordStorage<unknown>, record) {
        if (++writes === 1) {
          entered.resolve(undefined);
          await release.promise;
        }
        return original.call(this, record);
      });
    try {
      const first = commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("first", 1n),
        states: [state("first", 1n)],
      });
      await entered.promise;
      const next = current("second", 2n);
      const retained = state("second", 2n);
      const second = commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next,
        states: [retained],
      });
      if (next.version === undefined || retained.version === undefined)
        throw new Error("Expected versioned Entity records.");
      next.version.number = 9;
      retained.version.number = 9;
      release.resolve(undefined);
      await Promise.all([first, second]);
      await expect(entity.current.read("task")).resolves.toEqual(current("second", 2n));
      await expect(entity.states.backward("task", 2)).resolves.toEqual([
        state("second", 2n),
        state("first", 1n),
      ]);
    } finally {
      release.resolve(undefined);
      write.mockRestore();
      await commits.close();
      entity.close();
    }
  });

  it("keeps queued current, history, and delivery records in the selected tenant", async () => {
    const factory = new InMemoryStorageFactory();
    const tenantId = create(TenantIdSchema, { kind: { case: "value", value: "A" } });
    const selected = { name: "Tasks", multitenant: true as const, tenantId };
    const input = { ...entityInput(), context: selected };
    const commits = commitStorage(factory, input);
    const entered = deferred();
    const release = deferred();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Call keeps the concrete storage receiver.
    const original = MemoryEntityRecordStorage.prototype.write;
    let writes = 0;
    const write = vi
      .spyOn(MemoryEntityRecordStorage.prototype, "write")
      .mockImplementation(async function (this: MemoryEntityRecordStorage<unknown>, record) {
        if (++writes === 1) {
          entered.resolve(undefined);
          await release.promise;
        }
        return original.call(this, record);
      });
    try {
      const first = commits.commit({
        context: selected,
        entity: input,
        entityId: "task",
        next: current("first", 1n),
        states: [state("first", 1n)],
      });
      await entered.promise;
      const second = commits.commit({
        context: selected,
        entity: input,
        entityId: "task",
        next: current("second", 2n),
        states: [state("second", 2n)],
        events: [event("queued-A")],
      });
      tenantId.kind = { case: "value", value: "B" };
      release.resolve(undefined);
      await Promise.all([first, second]);

      const contextA = {
        name: "Tasks",
        multitenant: true as const,
        tenantId: create(TenantIdSchema, { kind: { case: "value", value: "A" } }),
      };
      const entityA = factory.createEntityStorage({ ...input, context: contextA }) as EntityHandle;
      await expect(entityA.current.read("task")).resolves.toEqual(current("second", 2n));
      await expect(entityA.states.backward("task", 2)).resolves.toEqual([
        state("second", 2n),
        state("first", 1n),
      ]);
      const eventsA = new EventStore(contextA, factory);
      expect((await eventsA.read()).map((entry) => entry.id?.value)).toEqual(["queued-A"]);
      await eventsA.close();
      entityA.close();

      const contextB = {
        name: "Tasks",
        multitenant: true as const,
        tenantId: create(TenantIdSchema, { kind: { case: "value", value: "B" } }),
      };
      const entityB = factory.createEntityStorage({ ...input, context: contextB }) as EntityHandle;
      await expect(entityB.current.read("task")).resolves.toBeUndefined();
      await expect(entityB.states.backward("task", 2)).resolves.toEqual([]);
      const eventsB = new EventStore(contextB, factory);
      expect(await eventsB.read()).toEqual([]);
      await eventsB.close();
      entityB.close();
      expect(() =>
        commits.commit({
          context: selected,
          entity: input,
          entityId: "task",
          next: current("wrong-scope", 3n),
        }),
      ).toThrow(/another Entity storage scope/);
      expect(() =>
        commits.commit({
          context: contextA,
          entity: input,
          entityId: "task",
          next: current("wrong-entity-scope", 3n),
        }),
      ).toThrow(/another Entity storage scope/);
    } finally {
      release.resolve(undefined);
      write.mockRestore();
      await commits.close();
    }
  });

  it("rejects a divergent live history slot before changing current state", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const entity = factory.createEntityStorage(input) as EntityHandle;
    const commits = commitStorage(factory, input);
    await commits.commit({
      context: input.context,
      entity: input,
      entityId: "task",
      next: current("first", 1n),
      states: [state("first", 1n)],
    });
    await expect(
      commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("second", 2n),
        states: [state("different", 1n)],
      }),
    ).rejects.toThrow(/divergent content/);
    await expect(entity.current.read("task")).resolves.toEqual(current("first", 1n));
    await expect(entity.states.backward("task", 2)).resolves.toEqual([state("first", 1n)]);
    await commits.close();
    entity.close();
  });

  it("retains history and diagnostic records if a later delivery Event insert fails", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const entity = factory.createEntityStorage(input) as EntityHandle;
    const commits = commitStorage(factory, input);
    const original = Object.getOwnPropertyDescriptor(TenantRecords.prototype, "compareAndSet")
      ?.value as TenantRecords<unknown, Message>["compareAndSet"];
    const compareAndSet = vi
      .spyOn(TenantRecords.prototype, "compareAndSet")
      .mockImplementation(function (this: TenantRecords<unknown, Message>, id, expected, next) {
        if ((next as { record: Message } | undefined)?.record.$typeName === EventSchema.typeName)
          throw new Error("injected delivery Event failure");
        return original.call(this, id, expected, next);
      });
    try {
      await expect(
        commits.commit({
          context: input.context,
          entity: input,
          entityId: "task",
          next: current("partial", 1n),
          states: [state("partial", 1n)],
          diagnostics: [diagnostic("partial-diagnostic", 1n)],
          events: [event("partial-delivery")],
        }),
      ).rejects.toThrow(/injected delivery Event failure/);
    } finally {
      compareAndSet.mockRestore();
    }
    await expect(entity.current.read("task")).resolves.toBeUndefined();
    await expect(entity.states.backward("task", 1)).resolves.toEqual([state("partial", 1n)]);
    await expect(entity.events.backward("task", 1)).resolves.toMatchObject([
      { id: { value: "partial-diagnostic" } },
    ]);
    const events = new EventStore(input.context, factory);
    await expect(events.read()).resolves.toEqual([]);
    await events.close();
    await commits.close();
    entity.close();
  });

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
    ).resolves.toBeUndefined();

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
    ).resolves.toBeUndefined();
    await events.close();
    await commits.close();
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

    await expect(
      commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("partial", 1n),
        events: [create(EventSchema, { message: event("missing-id").message })],
      }),
    ).rejects.toThrow(/unique delivery-event IDs/);

    await expect(entity.current.read("task")).resolves.toBeUndefined();
    await expect(entity.states.backward("task", 10)).resolves.toEqual([]);
    await expect(entity.events.backward("task", 10)).resolves.toEqual([]);
    const events = new EventStore(input.context, factory);
    await expect(events.read()).resolves.toEqual([]);
    await events.close();
    await commits.close();
    entity.close();
  });

  it("retains a completed state-history prefix when a later diagnostic write fails", async () => {
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
    await expect(entity.states.backward("task", 10)).resolves.toEqual([state("partial", 1n)]);
    await expect(entity.events.backward("task", 10)).resolves.toEqual([]);
    await commits.close();
    entity.close();
  });

  it("serializes competing compatible handles and permits later replacement", async () => {
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
    expect(results).toEqual([undefined, undefined]);
    await expect(
      first.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("divergent", 2n),
      }),
    ).resolves.toBeUndefined();
    await first.close();
    expect(() =>
      first.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("closed", 2n),
      }),
    ).toThrow(/closed/);
    await second.close();
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
    await commits.close();
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
        next: current("new", 2n, create(TimestampSchema, { seconds: 2n })),
        states: [state("new", 2n)],
      });
      selected.resolve(undefined);
      await Promise.all([truncating, committing]);
    } finally {
      queryEntries.mockRestore();
    }

    expect(await entity.states.backward("task", 5)).toEqual([state("new", 2n)]);
    await commits.close();
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
    ).resolves.toBeUndefined();
    await expect(
      commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("after", 2n, create(TimestampSchema, { seconds: 42n, nanos: 8 })),
      }),
    ).resolves.toBeUndefined();
    await expect(entity.current.read("task")).resolves.toEqual(
      current("after", 2n, create(TimestampSchema, { seconds: 42n, nanos: 8 })),
    );

    await commits.close();
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
    ).resolves.toBeUndefined();

    await expect(entity.current.read("task")).resolves.toEqual(current("current-only", 1n));
    await expect(entity.states.backward("task", 10)).resolves.toEqual([]);
    await expect(entity.events.backward("task", 10)).resolves.toEqual([]);
    const events = new EventStore(input.context, factory);
    await expect(events.read()).resolves.toEqual([]);
    await events.close();
    await commits.close();
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
    ).resolves.toBeUndefined();

    expect(createStorage).not.toHaveBeenCalled();
    await expect(entity.current.read("task")).resolves.toEqual(current("current-only", 1n));
    await commits.close();
    entity.close();
  });

  it("does not consult or close supplied history handles for a current-only commit", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const layout = stateHistorySpec(TaskSchema);
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
    ).resolves.toBeUndefined();

    expect(read).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(supplied.isOpen()).toBe(true);
    supplied.close();
    await commits.close();
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
    await commits.close();
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
    await events.close();
    await commits.close();
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
    await commits.close();
    entity.close();
  });

  it("replaces current records with no expected-state condition", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const commits = commitStorage(factory, input);
    const persisted = current("persisted", 1n);
    await expect(
      commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: persisted,
      }),
    ).resolves.toBeUndefined();
    await expect(
      commits.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("unexpected", 2n),
      }),
    ).resolves.toBeUndefined();
    const entity = factory.createEntityStorage(input) as EntityHandle;
    await expect(entity.current.read("task")).resolves.toEqual(current("unexpected", 2n));
    entity.close();
    await commits.close();
  });

  it("keeps sibling handles usable after a handle is closed repeatedly", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const first = commitStorage(factory, input);
    const second = commitStorage(factory, input);

    await first.close();
    await expect(first.close()).resolves.toBeUndefined();
    await expect(
      second.commit({
        context: input.context,
        entity: input,
        entityId: "task",
        next: current("sibling", 1n),
      }),
    ).resolves.toBeUndefined();
    await second.close();
  });

  it("rejects a commit input from another entity storage scope", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const commits = commitStorage(factory, input);
    const incompatible = { ...input, sourceType: TaskListSchema };

    expect(() =>
      commits.commit({
        context: incompatible.context,
        entity: incompatible,
        entityId: "task",
        next: current("wrong-scope", 1n),
      }),
    ).toThrow(/another Entity storage scope/);
    await commits.close();
  });

  it("rejects absent or mismatched current IDs before writing history or current state", async () => {
    const factory = new InMemoryStorageFactory();
    const input = entityInput();
    const commits = commitStorage(factory, input);
    const storage = factory.createEntityStorage(input) as EntityHandle;
    for (const next of [
      create(EntityRecordSchema, { state: current("missing", 1n).state }),
      current("other", 1n, undefined, "other-task"),
    ]) {
      await expect(
        commits.commit({
          context: input.context,
          entity: input,
          entityId: "task",
          next,
          states: [state("attempted", 1n)],
        }),
      ).rejects.toThrow(/another Entity/);
    }
    await expect(storage.current.read("task")).resolves.toBeUndefined();
    await expect(storage.states.backward("task", 1)).resolves.toEqual([]);
    await commits.close();
    storage.close();
  });

  it("reports when a storage factory has not registered atomic commits", () => {
    expect(() =>
      EntityCommitStorageFactories.create(new UnregisteredStorageFactory(), entityInput()),
    ).toThrow(/does not provide the required Entity commit storage/);
  });
});

const context = Object.freeze({ name: "Tasks", multitenant: false });

function commitStorage(
  factory: InMemoryStorageFactory,
  input: EntityStorageInput<string, ReturnType<typeof createTask>>,
): EntityCommitStorage {
  return EntityCommitStorageFactories.create(factory, input);
}

function entityInput(histories = true): EntityStorageInput<string, ReturnType<typeof createTask>> {
  return {
    context,
    id: {
      clone: (id) => id,
      key: (id) => id,
      pack: packedId,
      unpack: unpackTaskId,
    },
    columns: [],
    recordSpec: new RecordSpec<string, EntityRecord>({
      sourceType: TaskSchema,
      recordType: EntityRecordSchema,
      idKind: "string",
      extractId: (record) => {
        if (record.entityId === undefined) throw new Error("EntityRecord.entityId is required.");
        const id = unpackTaskId(record.entityId);
        if (id === undefined) throw new Error("EntityRecord.entityId has the wrong type.");
        return id;
      },
    }),
    sourceType: TaskSchema,
    stateSchema: TaskSchema,
    stateHistory: histories,
    eventHistory: histories,
  };
}

function createTask(value: string, id = "task") {
  return create(TaskSchema, {
    id: create(TaskIdSchema, { value: id }),
    title: value,
    taskListId: create(TaskListIdSchema, { value: "list-1" }),
  });
}

function current(value: string, version: bigint, timestamp?: Timestamp, id = "task"): EntityRecord {
  return create(EntityRecordSchema, {
    entityId: packedId(id),
    lifecycleFlags: { archived: false, deleted: false },
    state: AnyPacker.pack(TaskSchema, createTask(value, id)),
    version: create(VersionSchema, {
      number: Number(version),
      ...(timestamp === undefined ? {} : { timestamp }),
    }),
  });
}

function packedId(value: string) {
  return AnyPacker.pack(TaskIdSchema, create(TaskIdSchema, { value }));
}

function unpackTaskId(id: NonNullable<EntityRecord["entityId"]>) {
  return AnyPacker.tryUnpack(id, TaskIdSchema)?.value;
}

function state(value: string, version: bigint, id = "task") {
  return current(value, version, create(TimestampSchema, { seconds: version }), id);
}

function diagnostic(id: string, version: bigint, producer = "task") {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    context: {
      producerId: packedId(producer),
      version: create(VersionSchema, { number: Number(version) }),
      timestamp: create(TimestampSchema, { seconds: version }),
    },
    message: taskCreated(id),
  });
}

function event(id: string) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    message: taskCreated(id),
  });
}

function taskCreated(id: string) {
  return AnyPacker.pack(
    TaskCreatedSchema,
    create(TaskCreatedSchema, {
      id: create(TaskIdSchema, { value: id }),
      title: id,
      taskListId: create(TaskListIdSchema, { value: "list-1" }),
    }),
  );
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
