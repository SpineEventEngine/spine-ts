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

/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { create } from "@bufbuild/protobuf";
import type { Any } from "@bufbuild/protobuf/wkt";
import { AnyPacker, Identifiers } from "@spine-event-engine/core";
import { EventIdSchema, EventSchema, TenantIdSchema } from "@spine-event-engine/proto";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import {
  EntityCommitStorageFactories,
  type EntityStorageInput,
} from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";
import {
  TaskIdSchema,
  TaskListIdSchema,
  type TaskId,
} from "../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { TaskCreatedSchema } from "../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";
import {
  TaskSchema,
  type Task,
} from "../../../examples/todo/generated/spine/examples/todo/tasks_pb.js";

const seam = vi.hoisted(() => ({
  current: undefined,
  calls: [] as string[],
  close: vi.fn(),
  failDiagnostic: 0,
  diagnosticFailure: new Error("driver detail"),
  acquisitionFailure: undefined as Error | undefined,
  poolEnd: vi.fn(() => Promise.resolve()),
}));

vi.mock("mysql2/promise", () => ({
  createPool: vi.fn(() => ({
    getConnection: () =>
      Promise.resolve({
        query: () => Promise.resolve([[], []]),
        release: () => undefined,
      }),
    end: seam.poolEnd,
  })),
}));
vi.mock("../src/mysql/entity-history.js", () => ({
  MysqlEntityStorage: class {
    current = {
      read: async () => seam.current,
      write: async () => seam.calls.push("write"),
    };
    states = { append: async () => seam.calls.push("state") };
    events = {
      append: async () => {
        seam.calls.push("diagnostic");
        if (seam.failDiagnostic > 0) {
          seam.failDiagnostic -= 1;
          throw seam.diagnosticFailure;
        }
      },
    };
    ensure = () => {
      if (seam.acquisitionFailure !== undefined) throw seam.acquisitionFailure;
    };
    prepare = async () => seam.calls.push("families.prepare");
    close() {
      seam.close();
    }
  },
}));
vi.mock("../src/mysql/record-storage.js", () => ({
  MysqlRecordStorage: class {
    tableName = "events";
    prepare = async () => seam.calls.push("events.prepare");
    writeImmutable = async () => seam.calls.push("event");
    close = () => seam.close();
  },
}));
vi.mock("../src/mysql/entity-commit.js", () => ({
  MysqlEntityCommitCoordinator: class {
    commit = async () => {
      throw new Error("Unexpected Entity coordination.");
    };
  },
}));

import { MysqlStorageFactory } from "../src/index.js";

describe("MysqlStorageFactory mocked entity commits", () => {
  it("persists independent commit families in order through the public factory", async () => {
    seam.calls = [];
    seam.current = undefined;
    seam.diagnosticFailure = Object.assign(new Error("driver deadlock detail"), {
      code: "ER_LOCK_DEADLOCK",
    });
    seam.close.mockClear();
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/commit_mock" })
      .build();
    const context = { name: "orders", multitenant: false } as const;
    const entity = {
      context,
      id: {
        clone: (id: ReturnType<typeof create<typeof TaskIdSchema>>) => create(TaskIdSchema, id),
        key: (id: ReturnType<typeof create<typeof TaskIdSchema>>) => id.value,
        pack: (id: ReturnType<typeof create<typeof TaskIdSchema>>) =>
          Identifiers.pack(TaskIdSchema, id),
        unpack: (packed: Any) => AnyPacker.tryUnpack(packed, TaskIdSchema),
      },
      columns: [],
      sourceType: TaskSchema,
      stateSchema: TaskSchema,
      stateHistory: true,
      eventHistory: true,
    } as unknown as EntityStorageInput<TaskId, Task>;
    const commits = EntityCommitStorageFactories.create(factory, entity);
    const taskId = create(TaskIdSchema, { value: "order-1" });
    const next = create(EntityRecordSchema, {
      entityId: AnyPacker.pack(TaskIdSchema, taskId),
      state: AnyPacker.pack(TaskSchema, create(TaskSchema, { id: taskId, title: "Order" })),
    });
    const domainEvent = AnyPacker.pack(
      TaskCreatedSchema,
      create(TaskCreatedSchema, {
        id: taskId,
        title: "Order",
        taskListId: create(TaskListIdSchema, { value: "list-1" }),
      }),
    );
    await expect(
      commits.commit({
        context,
        entity,
        entityId: taskId,
        next,
        states: [next],
        diagnostics: [
          create(EventSchema, {
            id: create(EventIdSchema, { value: "diagnostic-1" }),
            message: domainEvent,
          }),
        ],
        events: [
          create(EventSchema, {
            id: create(EventIdSchema, { value: "event-1" }),
            message: domainEvent,
          }),
        ],
      }),
    ).resolves.toBeUndefined();
    expect(seam.calls).toEqual([
      "families.prepare",
      "events.prepare",
      "state",
      "diagnostic",
      "event",
      "write",
    ]);
    seam.calls = [];
    seam.failDiagnostic = 1;
    await expect(
      commits.commit({
        context,
        entity,
        entityId: taskId,
        next,
        states: [next],
        diagnostics: [
          create(EventSchema, {
            id: create(EventIdSchema, { value: "retry-diagnostic" }),
            message: domainEvent,
          }),
        ],
        events: [
          create(EventSchema, {
            id: create(EventIdSchema, { value: "retry-delivery" }),
            message: domainEvent,
          }),
        ],
      }),
    ).resolves.toBeUndefined();
    expect(seam.calls).toEqual([
      "families.prepare",
      "events.prepare",
      "state",
      "diagnostic",
      "state",
      "diagnostic",
      "event",
      "write",
    ]);
    const diagnostic = create(EventSchema, {
      id: create(EventIdSchema, { value: "failure-diagnostic" }),
      message: domainEvent,
    });
    for (const failure of [
      new Error("permanent driver failure"),
      new Error("malformed driver failure", { cause: "primitive cause" }),
    ]) {
      seam.calls = [];
      seam.failDiagnostic = 1;
      seam.diagnosticFailure = failure;
      await expect(
        commits.commit({
          context,
          entity,
          entityId: taskId,
          next,
          states: [next],
          diagnostics: [diagnostic],
        }),
      ).rejects.toThrow("MySQL Entity commit failed");
      expect(seam.calls).toEqual(["families.prepare", "state", "diagnostic"]);
    }
    seam.calls = [];
    seam.failDiagnostic = 1;
    seam.diagnosticFailure = Object.assign(new Error("numeric deadlock detail"), { errno: 1213 });
    await expect(
      commits.commit({
        context,
        entity,
        entityId: taskId,
        next,
        states: [next],
        diagnostics: [diagnostic],
      }),
    ).resolves.toBeUndefined();
    expect(seam.calls).toEqual([
      "families.prepare",
      "state",
      "diagnostic",
      "state",
      "diagnostic",
      "write",
    ]);
    seam.calls = [];
    await expect(
      commits.commit({ context, entity, entityId: taskId, next }),
    ).resolves.toBeUndefined();
    expect(seam.calls).toEqual(["families.prepare", "write"]);
    const eventWithId = (value: string) =>
      create(EventSchema, { id: create(EventIdSchema, { value }), message: domainEvent });
    const otherId = create(TaskIdSchema, { value: "another-task" });
    const otherRecord = create(EntityRecordSchema, {
      entityId: Identifiers.pack(TaskIdSchema, otherId),
      state: next.state,
    });
    for (const invalid of [
      { events: [eventWithId(" ")] },
      { events: [eventWithId("duplicate"), eventWithId("duplicate")] },
      { events: [create(EventSchema, { message: domainEvent })] },
      { diagnostics: [create(EventSchema, { message: domainEvent })] },
      { diagnostics: [eventWithId(" ")] },
      { diagnostics: [eventWithId("duplicate"), eventWithId("duplicate")] },
      { next: create(EntityRecordSchema, { state: next.state }) },
      { next: otherRecord },
      { states: [otherRecord] },
    ]) {
      seam.calls = [];
      await expect(
        commits.commit({ context, entity, entityId: taskId, next, ...invalid }),
      ).rejects.toThrow(/Entity commit/);
      expect(seam.calls).toEqual([]);
    }
    await expect(
      commits.commit({
        context,
        entity: {
          ...entity,
          context: {
            name: "other",
            multitenant: true,
            tenantId: create(TenantIdSchema, { kind: { case: "value", value: "other" } }),
          },
        },
        entityId: taskId,
        next,
      }),
    ).rejects.toThrow("context is incompatible");
    expect(seam.close).not.toHaveBeenCalled();
    await commits.close();
    await commits.close();
    expect(seam.close).toHaveBeenCalledTimes(2);
    await factory.close();
  });
});

describe("MysqlStorageFactory commit cleanup failures", () => {
  it("admits ID-validation callbacks before reentrant factory close", async () => {
    seam.close.mockReset();
    seam.poolEnd.mockReset().mockResolvedValue(undefined);
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/commit_capture" })
      .build();
    const base = cleanupEntity();
    let closing: Promise<void> | undefined;
    const entity = {
      ...base,
      id: {
        ...base.id,
        unpack: (id: Any) => {
          expect(() => {
            commit.closeIdle();
          }).toThrow(/active/);
          closing = factory.close();
          return base.id.unpack(id);
        },
      },
    };
    const commit = EntityCommitStorageFactories.create(factory, entity);
    await expect(commit.commit(cleanupMutation(entity, true))).resolves.toBeUndefined();
    await expect(closing).resolves.toBeUndefined();
    expect(seam.close).toHaveBeenCalledTimes(2);
  });
  it("retains acquisition and both rollback-close errors", async () => {
    seam.close.mockReset();
    seam.poolEnd.mockReset().mockResolvedValue(undefined);
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/commit_cleanup" })
      .build();
    const entity = cleanupEntity();
    const commit = EntityCommitStorageFactories.create(factory, entity);
    const acquisition = new Error("family acquisition failed");
    const eventClose = new Error("new delivery close failed");
    const storageClose = new Error("new Entity close failed");
    seam.acquisitionFailure = acquisition;
    seam.close
      .mockImplementationOnce(() => {
        throw eventClose;
      })
      .mockImplementationOnce(() => {
        throw storageClose;
      });
    try {
      await expect(commit.commit(cleanupMutation(entity, true))).rejects.toMatchObject({
        cause: { errors: [acquisition, eventClose, storageClose] },
      });
      expect(seam.close).toHaveBeenCalledTimes(2);
      seam.acquisitionFailure = undefined;
      await expect(commit.commit(cleanupMutation(entity, true))).resolves.toBeUndefined();
    } finally {
      seam.acquisitionFailure = undefined;
      await factory.close();
    }
  });

  it("attempts both retained commit closes and reports both failures", async () => {
    seam.close.mockReset();
    seam.poolEnd.mockReset().mockResolvedValue(undefined);
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/commit_cleanup" })
      .build();
    const entity = cleanupEntity();
    const commit = EntityCommitStorageFactories.create(factory, entity);
    await commit.commit(cleanupMutation(entity, true));
    const eventClose = new Error("delivery close failed");
    const storageClose = new Error("Entity close failed");
    seam.close
      .mockImplementationOnce(() => {
        throw eventClose;
      })
      .mockImplementationOnce(() => {
        throw storageClose;
      });
    await expect(commit.close()).rejects.toMatchObject({ errors: [eventClose, storageClose] });
    expect(seam.close).toHaveBeenCalledTimes(2);
    await factory.close();
  });

  it("reports commit and pool failure after both cleanup attempts", async () => {
    seam.close.mockReset();
    seam.poolEnd.mockReset().mockResolvedValue(undefined);
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/commit_cleanup" })
      .build();
    const entity = cleanupEntity();
    const commit = EntityCommitStorageFactories.create(factory, entity);
    await commit.commit(cleanupMutation(entity, false));
    const commitClose = new Error("commit close failed");
    const poolClose = new Error("pool close failed");
    seam.close.mockImplementationOnce(() => {
      throw commitClose;
    });
    seam.poolEnd.mockRejectedValueOnce(poolClose);
    await expect(factory.close()).rejects.toMatchObject({ errors: [commitClose, poolClose] });
    expect(seam.close).toHaveBeenCalledTimes(1);
    expect(seam.poolEnd).toHaveBeenCalledTimes(1);
  });
});

function cleanupEntity(): EntityStorageInput<TaskId, Task> {
  return {
    context: { name: "Tasks", multitenant: false },
    id: {
      clone: (id: TaskId) => create(TaskIdSchema, id),
      key: (id: TaskId) => id.value,
      pack: (id: TaskId) => AnyPacker.pack(TaskIdSchema, id),
      unpack: (id: Any) => AnyPacker.tryUnpack(id, TaskIdSchema),
    },
    columns: [],
    sourceType: TaskSchema,
    stateSchema: TaskSchema,
    stateHistory: true,
    eventHistory: true,
  } as unknown as EntityStorageInput<TaskId, Task>;
}

function cleanupMutation(entity: EntityStorageInput<TaskId, Task>, withEvent: boolean) {
  const id = create(TaskIdSchema, { value: "cleanup-task" });
  const message = AnyPacker.pack(
    TaskCreatedSchema,
    create(TaskCreatedSchema, {
      id,
      title: "Created",
      taskListId: create(TaskListIdSchema, { value: "list-1" }),
    }),
  );
  return {
    context: entity.context,
    entity,
    entityId: id,
    next: create(EntityRecordSchema, {
      entityId: AnyPacker.pack(TaskIdSchema, id),
      state: AnyPacker.pack(TaskSchema, create(TaskSchema, { id, title: "Task" })),
    }),
    ...(withEvent
      ? {
          events: [create(EventSchema, { id: create(EventIdSchema, { value: "event" }), message })],
        }
      : {}),
  };
}
