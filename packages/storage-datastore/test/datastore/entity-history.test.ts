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

import { create, fromBinary, ScalarType, toBinary } from "@bufbuild/protobuf";
import { AnySchema, EmptySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  AgentHistoryEntrySchema,
  AiModelKind,
  GenerationResponseSchema,
  ModelPreferenceSchema,
} from "@spine-event-engine/proto/agent";
import { EventIdSchema, EventSchema, TenantIdSchema } from "@spine-event-engine/proto";
import {
  AnyPacker,
  Identifiers,
  StringifierRegistry,
  TypeRegistry,
} from "@spine-event-engine/core";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { ColumnTypes, RecordColumn, RecordSpec } from "@spine-event-engine/storage";
import {
  AgentHistoryRecords,
  AgentHistoryStorageFactories,
  EntityCommitStorageFactories,
} from "@spine-event-engine/storage/provider";
import type { EntityStorageInput } from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";
import {
  TaskIdSchema,
  TaskListIdSchema,
  type TaskId,
} from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { TaskCreatedSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
  type SupportReplyAgentId,
  type SupportReplyAgentState,
} from "../../../server/test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import { entityInput as supportAgentInput } from "../../../storage/test/entity/agent-live-fixtures.js";
import {
  conversation,
  event as agentEvent,
  occurredAt,
  response as agentResponse,
  scope as agentScope,
} from "../../../storage/test/entity/agent-history-fixtures.js";
// prettier-ignore
import {
  SupportReplyDraftedSchema,
} from "../../../server/test-fixtures/generated/entity-metadata/support_agent_events_pb.js";
import {
  TaskSchema,
  type Task,
} from "../../../../examples/todo/generated/spine/examples/todo/tasks_pb.js";

import { DatastoreStorageFactory } from "../../src/index.js";
import type { DatastoreEntityStorageHandle } from "../../src/datastore/storage-factory.js";
import {
  DatastoreEntityCommitStorage,
  DatastoreEntityStorage,
} from "../../src/datastore/entity-history.js";
import { deferred, HistoryDatastoreBackend } from "./entity-history-fixture.js";

function taskId(value: string): TaskId {
  return create(TaskIdSchema, { value });
}
function input(
  histories = true,
  columns: readonly RecordColumn<ReturnType<typeof create<typeof EntityRecordSchema>>>[] = [],
): EntityStorageInput<TaskId, Task> {
  const unpack = (id: ReturnType<typeof create<typeof AnySchema>>) =>
    AnyPacker.tryUnpack(id, TaskIdSchema);
  return {
    context: { name: "GeneratedEntity", multitenant: false },
    id: {
      clone: (id) => create(TaskIdSchema, id),
      key: (id) => id.value,
      pack: (id) => packId(id.value),
      unpack,
    },
    columns,
    recordSpec: new RecordSpec({
      sourceType: TaskSchema,
      recordType: EntityRecordSchema,
      idSchema: TaskIdSchema,
      extractId: (record) => {
        const id = record.entityId === undefined ? undefined : unpack(record.entityId);
        if (id === undefined) throw new Error("Entity record has no matching ID.");
        return id;
      },
      columns,
    }),
    sourceType: TaskSchema,
    stateSchema: TaskSchema,
    ...(histories ? { stateHistory: true, eventHistory: true } : {}),
  };
}
function packId(value: string) {
  return Identifiers.pack(TaskIdSchema, taskId(value));
}
function packState(title: string) {
  return Identifiers.pack(TaskSchema, create(TaskSchema, { id: taskId("task"), title }));
}
function record(value: string, version: number) {
  return create(EntityRecordSchema, {
    entityId: packId("task"),
    state: packState(value),
    version: { number: version, timestamp: create(TimestampSchema, { seconds: BigInt(version) }) },
  });
}
function event(id: string, version: number) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    message: Identifiers.pack(
      TaskCreatedSchema,
      create(TaskCreatedSchema, {
        id: taskId("task"),
        title: id,
        taskListId: create(TaskListIdSchema, { value: "list-1" }),
      }),
    ),
    context: {
      producerId: packId("task"),
      timestamp: create(TimestampSchema, { seconds: BigInt(version) }),
      version: { number: version },
    },
  });
}
function draftedEvent(id: string, agent: SupportReplyAgentId, reply: string, version: number) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    message: AnyPacker.pack(
      SupportReplyDraftedSchema,
      create(SupportReplyDraftedSchema, { agent, reply }),
    ),
    context: {
      producerId: AnyPacker.pack(SupportReplyAgentIdSchema, agent),
      version: { number: version },
      timestamp: create(TimestampSchema, { seconds: BigInt(version) }),
    },
  });
}
function factory(backend: HistoryDatastoreBackend, client = backend.client()) {
  const stringifiers = new StringifierRegistry();
  stringifiers.setTypeRegistry(new TypeRegistry([TaskIdSchema, TaskSchema, TaskCreatedSchema]));
  return DatastoreStorageFactory.newBuilder()
    .setClient(client as never)
    .setStringifierRegistry(stringifiers)
    .build();
}

describe("Datastore generated Entity records", () => {
  it("rejects an oversized late Agent audit row before opening a transaction and permits retry", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const store = factory(backend, client);
    const history = AgentHistoryStorageFactories.create(store, agentScope);
    const small = agentEvent("capacity-first", occurredAt(1_789_200_010n), false);
    const normal = agentResponse("capacity-response", "dialog", occurredAt(1_789_200_011n));
    const oversized = fromBinary(
      AgentHistoryEntrySchema,
      toBinary(AgentHistoryEntrySchema, normal),
    );
    if (oversized.item.case !== "conversationRecord") throw new Error("Expected response fixture.");
    const original = AnyPacker.tryUnpack(oversized.item.value.content, GenerationResponseSchema);
    if (original === undefined) throw new Error("Expected GenerationResponse fixture.");
    oversized.item.value.content = AnyPacker.pack(
      GenerationResponseSchema,
      create(GenerationResponseSchema, { ...original, rawOutput: "x".repeat(1_000_000) }),
    );
    expect(AgentHistoryRecords.bytes(agentScope.stateType, "ticket", oversized)).toBeGreaterThan(
      1_000_000,
    );
    const before = client.transactionCalls;
    try {
      await expect(async () => {
        await history.appendAll("ticket", [small, oversized]);
      }).rejects.toThrow("Datastore entity limit");
      expect(client.transactionCalls).toBe(before);
      expect(backend.entities.size).toBe(0);
      await history.appendAll("ticket", [small, normal]);
      expect(client.transactionCalls).toBe(before + 1);
      const page = await history.read({
        entityId: "ticket",
        view: { kind: "full" },
        count: 3,
        maxBytes: 100_000,
      });
      expect(page.entries.map((entry) => toBinary(AgentHistoryEntrySchema, entry))).toEqual(
        [normal, small].map((entry) => toBinary(AgentHistoryEntrySchema, entry)),
      );
    } finally {
      history.close();
      await store.close();
    }
  });

  it("retries an Agent audit group after the commit applied but its result was lost", async () => {
    const backend = new HistoryDatastoreBackend();
    const store = factory(backend);
    const history = AgentHistoryStorageFactories.create(store, agentScope);
    const entries = [
      agentEvent("audit-first", occurredAt(1_789_200_001n), false),
      agentEvent("audit-second", occurredAt(1_789_200_002n), true),
    ];
    const bytes = (entry: (typeof entries)[number]) =>
      Buffer.from(toBinary(AgentHistoryEntrySchema, entry)).toString("hex");
    const expected = entries.map(bytes).sort();
    try {
      backend.failCommitAppliedOnce = true;
      await expect(history.appendAll("ticket", entries)).rejects.toThrow(
        "commit applied before connection closed",
      );
      await history.appendAll("ticket", entries);
      const page = await history.read({
        entityId: "ticket",
        view: { kind: "full" },
        count: 3,
        maxBytes: 100_000,
      });
      expect(page.hasMore).toBe(false);
      expect(page.entries.map(bytes).sort()).toEqual(expected);
      expect(entries.map(bytes).sort()).toEqual(expected);
      expect(backend.entities.size).toBe(2);
    } finally {
      history.close();
      await store.close();
    }
  });
  it("keeps all optional Agent rows unchanged when a late delivery Event conflicts", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const inspectedKinds: string[] = [];
    const transaction = client.transaction.bind(client);
    vi.spyOn(client, "transaction").mockImplementation(() => {
      const tx = transaction();
      const get = tx.get.bind(tx);
      vi.spyOn(tx, "get").mockImplementation((key) => {
        inspectedKinds.push(key.path.at(-2) ?? "");
        return get(key);
      });
      return tx;
    });
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(new TypeRegistry([SupportReplyAgentIdSchema]));
    const provider = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .setStringifierRegistry(stringifiers)
      .build();
    const layout = {
      ...supportAgentInput(),
      stateHistory: true,
      eventHistory: true,
    } as unknown as EntityStorageInput<SupportReplyAgentId, SupportReplyAgentState>;
    const commits = EntityCommitStorageFactories.create(provider, layout);
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-optional" });
    const first = create(EntityRecordSchema, {
      entityId: layout.id.pack(id),
      state: AnyPacker.pack(
        SupportReplyAgentStateSchema,
        create(SupportReplyAgentStateSchema, { id }),
      ),
      version: { number: 1 },
    });
    const next = create(EntityRecordSchema, {
      entityId: layout.id.pack(id),
      state: AnyPacker.pack(
        SupportReplyAgentStateSchema,
        create(SupportReplyAgentStateSchema, { id, proposedReply: "new" }),
      ),
      version: { number: 2 },
    });
    const originalEvent = draftedEvent("drafted", id, "original", 1);
    const initial = {
      entityId: id,
      expectedVersion: 0,
      expectedPreferences: undefined,
      preferences: [],
      entityCommit: {
        context: layout.context,
        entity: layout,
        entityId: id,
        next: first,
        events: [originalEvent],
      },
      historyEntries: [
        conversation("initial", "support", create(TimestampSchema, { seconds: 1n })),
      ],
    };
    try {
      await commits.commitAgent(initial);
      const before = [...backend.entities];
      const rollbacks = backend.rollbacks;
      inspectedKinds.length = 0;
      const attempted = {
        ...initial,
        expectedVersion: 1,
        expectedPreferences: [],
        entityCommit: {
          ...initial.entityCommit,
          next,
          states: [next],
          diagnostics: [draftedEvent("diagnostic", id, "diagnostic", 2)],
          events: [draftedEvent("drafted", id, "changed", 2)],
        },
        historyEntries: [
          conversation("later", "support", create(TimestampSchema, { seconds: 2n })),
        ],
      };
      await expect(commits.commitAgent(attempted)).rejects.toThrow("divergent");
      expect(inspectedKinds).toContain(`${layout.stateSchema.typeName}_EntityRecord`);
      expect(inspectedKinds).toContain(`${layout.stateSchema.typeName}_Event`);
      expect(backend.rollbacks).toBe(rollbacks + 1);
      expect([...backend.entities]).toEqual(before);
      await commits.commitAgent({
        ...attempted,
        entityCommit: {
          ...attempted.entityCommit,
          events: [draftedEvent("drafted-next", id, "changed", 2)],
        },
      });
      const rows = [...backend.entities].map(([key, row]) => ({
        kind: (JSON.parse(key) as [unknown, [string, string]])[1][0],
        bytes: row.data.bytes,
      }));
      const current = rows.find((row) => row.kind === layout.stateSchema.typeName);
      const stateHistory = rows.find(
        (row) => row.kind === `${layout.stateSchema.typeName}_EntityRecord`,
      );
      const diagnostic = rows.find(
        (row) =>
          row.kind === `${layout.stateSchema.typeName}_Event` &&
          row.bytes instanceof Uint8Array &&
          fromBinary(EventSchema, row.bytes).id?.value === "diagnostic",
      );
      expect(current?.bytes).toBeInstanceOf(Uint8Array);
      expect(stateHistory?.bytes).toBeInstanceOf(Uint8Array);
      expect(diagnostic?.bytes).toBeInstanceOf(Uint8Array);
      if (
        !(current?.bytes instanceof Uint8Array) ||
        !(stateHistory?.bytes instanceof Uint8Array) ||
        !(diagnostic?.bytes instanceof Uint8Array)
      )
        throw new Error("The Agent optional rows were not stored.");
      expect(
        Buffer.from(current.bytes).equals(Buffer.from(toBinary(EntityRecordSchema, next))),
      ).toBe(true);
      expect(
        Buffer.from(stateHistory.bytes).equals(Buffer.from(toBinary(EntityRecordSchema, next))),
      ).toBe(true);
      const expectedDiagnostic = attempted.entityCommit.diagnostics[0];
      if (expectedDiagnostic === undefined) throw new Error("The diagnostic Event is missing.");
      expect(
        Buffer.from(diagnostic.bytes).equals(
          Buffer.from(toBinary(EventSchema, expectedDiagnostic)),
        ),
      ).toBe(true);
    } finally {
      await commits.close();
      await provider.close();
    }
  });
  it("rolls back a failed final Agent transaction and rejects stale images without partial writes", async () => {
    const backend = new HistoryDatastoreBackend();
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(
      new TypeRegistry([SupportReplyAgentIdSchema, SupportReplyAgentStateSchema]),
    );
    const provider = DatastoreStorageFactory.newBuilder()
      .setClient(backend.client() as never)
      .setStringifierRegistry(stringifiers)
      .build();
    const layout = supportAgentInput() as unknown as EntityStorageInput<
      SupportReplyAgentId,
      SupportReplyAgentState
    >;
    const commits = EntityCommitStorageFactories.create(provider, layout);
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-atomic" });
    const preference = create(ModelPreferenceSchema, {
      kind: AiModelKind.GENERATION,
      selection: { case: "inheritRepositoryDefault", value: create(EmptySchema) },
    });
    const historyEntry = conversation(
      "atomic-audit",
      "support",
      create(TimestampSchema, { seconds: 1n }),
    );
    const next = create(EntityRecordSchema, {
      entityId: layout.id.pack(id),
      state: AnyPacker.pack(
        SupportReplyAgentStateSchema,
        create(SupportReplyAgentStateSchema, { id }),
      ),
      version: { number: 1 },
    });
    const input = {
      entityId: id,
      expectedVersion: 0,
      expectedPreferences: undefined,
      preferences: [preference],
      entityCommit: { context: layout.context, entity: layout, entityId: id, next },
      historyEntries: [historyEntry],
    };
    try {
      backend.failTransactionCommit = new Error("final transaction failed");
      await expect(commits.commitAgent(input)).rejects.toThrow("final transaction failed");
      expect(backend.entities.size).toBe(0);
      await expect(commits.readAgentPreferences(id)).resolves.toBeUndefined();
      backend.failTransactionCommit = undefined;
      await commits.commitAgent(input);
      await expect(commits.readAgentPreferences(id)).resolves.toEqual([preference]);
      const current = provider.createRecordStorage(layout.context, layout.recordSpec);
      const history = AgentHistoryStorageFactories.create(provider, {
        context: layout.context,
        stateType: layout.stateSchema.typeName,
        id: { key: (value: typeof id) => value.ticketNumber },
      });
      try {
        await expect(current.read(id)).resolves.toEqual(next);
        const page = await history.read({ entityId: id, view: { kind: "full" }, count: 10 });
        expect(page.entries.map((entry) => toBinary(AgentHistoryEntrySchema, entry))).toEqual([
          toBinary(AgentHistoryEntrySchema, historyEntry),
        ]);
        const nextHistory = conversation(
          "atomic-audit-next",
          "support",
          create(TimestampSchema, { seconds: 2n }),
        );
        const nextState = create(EntityRecordSchema, {
          entityId: layout.id.pack(id),
          state: AnyPacker.pack(
            SupportReplyAgentStateSchema,
            create(SupportReplyAgentStateSchema, { id, proposedReply: "updated" }),
          ),
          version: { number: 2 },
        });
        await expect(
          commits.commitAgent({
            entityId: id,
            expectedVersion: 0,
            expectedPreferences: [preference],
            preferences: [preference],
            historyEntries: [nextHistory],
          }),
        ).rejects.toThrow("Version");
        await expect(
          commits.commitAgent({
            ...input,
            expectedVersion: 1,
            expectedPreferences: [],
            entityCommit: {
              context: layout.context,
              entity: layout,
              entityId: id,
              next: nextState,
            },
            historyEntries: [nextHistory],
          }),
        ).rejects.toThrow("preferences changed");
        expect(backend.entities.size).toBe(3);
        await expect(current.read(id)).resolves.toEqual(next);
        await commits.commitAgent({
          ...input,
          expectedVersion: 1,
          expectedPreferences: [preference],
          entityCommit: { context: layout.context, entity: layout, entityId: id, next: nextState },
          historyEntries: [nextHistory],
        });
        await expect(current.read(id)).resolves.toEqual(nextState);
        const updated = await history.read({ entityId: id, view: { kind: "full" }, count: 10 });
        expect(updated.entries.map((entry) => toBinary(AgentHistoryEntrySchema, entry))).toEqual(
          [nextHistory, historyEntry].map((entry) => toBinary(AgentHistoryEntrySchema, entry)),
        );
      } finally {
        current.close();
        history.close();
      }
    } finally {
      await commits.close();
      await provider.close();
    }
  });
  it("commits Agent preferences and immutable audit without Entity mutation", async () => {
    const backend = new HistoryDatastoreBackend();
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(
      new TypeRegistry([SupportReplyAgentIdSchema, SupportReplyAgentStateSchema]),
    );
    const provider = DatastoreStorageFactory.newBuilder()
      .setClient(backend.client() as never)
      .setStringifierRegistry(stringifiers)
      .build();
    const layout = supportAgentInput() as unknown as EntityStorageInput<
      SupportReplyAgentId,
      SupportReplyAgentState
    >;
    const commits = EntityCommitStorageFactories.create(provider, layout);
    const current = provider.createRecordStorage(layout.context, layout.recordSpec);
    const history = AgentHistoryStorageFactories.create(provider, {
      context: layout.context,
      stateType: layout.stateSchema.typeName,
      id: { key: (value: SupportReplyAgentId) => value.ticketNumber },
    });
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-no-state" });
    const preference = create(ModelPreferenceSchema, {
      kind: AiModelKind.GENERATION,
      selection: { case: "inheritRepositoryDefault", value: create(EmptySchema) },
    });
    const changedPreference = create(ModelPreferenceSchema, {
      kind: AiModelKind.DECISION,
      selection: { case: "inheritRepositoryDefault", value: create(EmptySchema) },
    });
    const time = create(TimestampSchema, { seconds: 7n });
    const entry = conversation("audit-no-state", "support", time);
    const conflicting = conversation("audit-no-state", "other-conversation", time);
    const bytes = (value: typeof entry) => toBinary(AgentHistoryEntrySchema, value);
    const first = {
      entityId: id,
      expectedVersion: 0,
      expectedPreferences: undefined,
      preferences: [preference],
      historyEntries: [entry],
    };
    const readHistory = () => history.read({ entityId: id, view: { kind: "full" }, count: 10 });
    try {
      await commits.commitAgent(first);
      await expect(current.read(id)).resolves.toBeUndefined();
      await expect(commits.readAgentPreferences(id)).resolves.toEqual([preference]);
      expect((await readHistory()).entries.map(bytes)).toEqual([bytes(entry)]);

      await commits.commitAgent({
        ...first,
        expectedPreferences: [preference],
      });
      expect((await readHistory()).entries.map(bytes)).toEqual([bytes(entry)]);
      expect(backend.entities.size).toBe(2);

      const rollbacks = backend.rollbacks;
      await expect(
        commits.commitAgent({
          ...first,
          expectedPreferences: [preference],
          preferences: [changedPreference],
          historyEntries: [conflicting],
        }),
      ).rejects.toThrow("divergent");
      expect(backend.rollbacks).toBe(rollbacks + 1);
      await expect(commits.readAgentPreferences(id)).resolves.toEqual([preference]);
      expect((await readHistory()).entries.map(bytes)).toEqual([bytes(entry)]);
      await expect(current.read(id)).resolves.toBeUndefined();
      expect(backend.entities.size).toBe(2);
    } finally {
      current.close();
      history.close();
      await commits.close();
      await provider.close();
    }
  });
  it("retries an immutable history insert when a colliding row disappears before inspection", async () => {
    const compareAndSet = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const read = vi.fn().mockResolvedValue(undefined);
    const entity = input();
    const storage = new DatastoreEntityStorage(
      entity,
      (spec) =>
        ({
          recordSpec: spec,
          compareAndSet,
          read,
          isOpen: () => true,
          close: () => undefined,
        }) as never,
    );

    await expect(storage.states.append(record("one", 1))).resolves.toBeUndefined();
    expect(compareAndSet).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledOnce();
  });

  it("bounds immutable history insert attempts when each collision disappears", async () => {
    const compareAndSet = vi.fn().mockResolvedValue(false);
    const read = vi.fn().mockResolvedValue(undefined);
    const entity = input();
    const storage = new DatastoreEntityStorage(
      entity,
      (spec) =>
        ({
          recordSpec: spec,
          compareAndSet,
          read,
          isOpen: () => true,
          close: () => undefined,
        }) as never,
    );

    await expect(storage.states.append(record("one", 1))).rejects.toThrow(/not retained/);
    expect(compareAndSet).toHaveBeenCalledTimes(3);
    expect(read).toHaveBeenCalledTimes(3);
  });
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
        "spine.examples.todo.Task",
        "spine.examples.todo.Task_EntityRecord",
        "spine.examples.todo.Task_Event",
      ]),
    );
    expect([...backend.entities.values()].every((row) => Object.hasOwn(row.data, "bytes"))).toBe(
      true,
    );
    expect([...backend.entities.values()].every((row) => !Object.hasOwn(row.data, "_scope"))).toBe(
      true,
    );
  });

  it("commits current state with enabled but empty optional history and delivery families", async () => {
    const backend = new HistoryDatastoreBackend();
    const store = factory(backend);
    const entity = input(true);
    const createBundle = vi.spyOn(store, "createEntityStorage");
    const commits = EntityCommitStorageFactories.create(store, entity);
    expect(createBundle).not.toHaveBeenCalled();

    await commits.commit({
      context: entity.context,
      entity,
      entityId: taskId("task"),
      next: record("current-only", 1),
      states: [],
      diagnostics: [],
      events: [],
    });

    const stored = await store.createEntityStorage(entity).current.read(taskId("task"));
    expect(stored?.version?.number).toBe(1);
    expect(stored?.state?.typeUrl).toContain(TaskSchema.typeName);
    expect(backend.entities).toHaveLength(1);
  });

  it("retains one current record handle across current-only commits", async () => {
    const store = factory(new HistoryDatastoreBackend());
    const entity = input(false);
    let opens = 0;
    const closeRecord = vi.fn();
    const commits = new DatastoreEntityCommitStorage(entity as never, (spec, group) => {
      opens += 1;
      const port = store.createRecordStorage(entity.context, spec, group);
      const close = port.close.bind(port);
      port.close = () => {
        closeRecord();
        close();
      };
      return port;
    });
    for (const title of ["first", "second"])
      await commits.commit({
        context: entity.context,
        entity,
        entityId: taskId("task"),
        next: record(title, 1),
      });
    expect(opens).toBe(1);
    expect(closeRecord).not.toHaveBeenCalled();
    await commits.close();
    expect(closeRecord).toHaveBeenCalledTimes(1);
    await store.close();
  });
  it("retains acquisition and rollback-close failures, then retries", async () => {
    const store = factory(new HistoryDatastoreBackend());
    const entity = input();
    const acquisition = new Error("diagnostic open failed");
    const cleanup = new Error("new record close failed");
    const closed = vi.fn();
    let opens = 0;
    const commits = new DatastoreEntityCommitStorage(entity as never, (spec, group) => {
      opens += 1;
      if (opens === 3) throw acquisition;
      const port = store.createRecordStorage(entity.context, spec, group);
      const original = port.close.bind(port);
      port.close = () => {
        closed();
        original();
        if (opens <= 3) throw cleanup;
      };
      return port;
    });
    const mutation = {
      context: entity.context,
      entity,
      entityId: taskId("task"),
      next: record("stored", 1),
      states: [record("stored", 1)],
      diagnostics: [event("diagnostic", 1)],
    };
    await expect(commits.commit(mutation)).rejects.toMatchObject({
      errors: [acquisition, cleanup, cleanup],
    });
    expect(closed).toHaveBeenCalledTimes(2);
    await expect(commits.commit(mutation)).resolves.toBeUndefined();
    await commits.close();
    await store.close();
  });
  it("attempts every retained commit record close after multiple failures", async () => {
    const store = factory(new HistoryDatastoreBackend());
    const entity = input();
    const failures = [new Error("current close"), new Error("state close")];
    const closed = vi.fn();
    let opens = 0;
    const commits = new DatastoreEntityCommitStorage(entity as never, (spec, group) => {
      const port = store.createRecordStorage(entity.context, spec, group);
      const index = opens++;
      const original = port.close.bind(port);
      port.close = () => {
        closed(index);
        original();
        throw failures[index] ?? new Error("Unexpected retained close.");
      };
      return port;
    });
    await commits.commit({
      context: entity.context,
      entity,
      entityId: taskId("task"),
      next: record("stored", 1),
      states: [record("stored", 1)],
    });
    await expect(commits.close()).rejects.toMatchObject({ errors: [failures[1], failures[0]] });
    expect(closed).toHaveBeenCalledTimes(2);
    await store.close();
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
        entityId: taskId("task"),
        next: record("current", 1),
        states: [record("retained", 1)],
      }),
    ).rejects.toThrow("disabled");
    expect(client.transactionCalls).toBe(0);
  });

  it("cannot enable history by changing the commit input after opening its handle", async () => {
    const backend = new HistoryDatastoreBackend();
    const commits = EntityCommitStorageFactories.create(factory(backend), input(false));
    const enabled = input(true);

    await expect(
      commits.commit({
        context: enabled.context,
        entity: enabled,
        entityId: taskId("task"),
        next: record("current", 1),
        states: [record("retained", 1)],
      }),
    ).rejects.toThrow("disabled");
    expect(backend.entities).toHaveLength(0);
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
        entityId: taskId("task"),
        next: record("current", 1),
        states: [],
        diagnostics: [],
      }),
    ).resolves.toBeUndefined();
    await expect(
      commits.commit({
        context: entity.context,
        entity,
        entityId: taskId("task"),
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
        entityId: taskId("task"),
        next: record("current", 1),
      } as never),
    ).rejects.toThrow("another Entity source or tenant");
    await expect(
      commits.commit({
        context: differentTenancy.context,
        entity: differentTenancy,
        entityId: taskId("task"),
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

    await expect(storage.events.backward(taskId("task"), 1)).resolves.toEqual([]);
  });

  it("rejects a current record whose ID cannot be unpacked", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    const missing = create(EntityRecordSchema, {
      state: packState("current"),
      version: { number: 1 },
    });
    const invalid = create(EntityRecordSchema, {
      entityId: create(AnySchema, { typeUrl: "type.spine.test/Other", value: new Uint8Array() }),
      state: packState("current"),
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
        entityId: taskId("task"),
        next: invalid,
      }),
    ).rejects.toThrow("does not match");
    await expect(
      commits.commit({
        context: entity.context,
        entity,
        entityId: taskId("task"),
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
      `type.spine.examples.todo/${TaskSchema.typeName}`,
    );
  });

  it("honors layouts for Entity families without using record creators", async () => {
    const backend = new HistoryDatastoreBackend();
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(backend.client() as never)
      .organizeRecords(TaskSchema, EntityRecordSchema, { kind: "CurrentTasks" })
      .build();
    await store.createEntityStorage(input(false)).current.write(record("one", 1));
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
    await expect(storage.states.backward(taskId("task"), 1)).resolves.toMatchObject([
      { version: { number: 2 } },
    ]);
    await expect(
      storage.states.stateAt(taskId("task"), create(TimestampSchema, { seconds: 1n })),
    ).resolves.toMatchObject({ title: "one" });
    await storage.states.trim(taskId("task"), 1);
    await expect(storage.states.backward(taskId("task"), 2)).resolves.toHaveLength(1);
    await storage.states.truncate(create(TimestampSchema, { seconds: 3n }));
    await expect(storage.states.backward(taskId("task"), 1)).resolves.toEqual([]);
  });

  it("compares Timestamp nanos when selecting and truncating retained states", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    const early = create(EntityRecordSchema, {
      entityId: packId("task"),
      state: packState("early"),
      version: { number: 1, timestamp: create(TimestampSchema, { seconds: 4n, nanos: 100 }) },
    });
    const late = create(EntityRecordSchema, {
      entityId: packId("task"),
      state: packState("late"),
      version: { number: 2, timestamp: create(TimestampSchema, { seconds: 4n, nanos: 900 }) },
    });
    await storage.states.append(early);
    await storage.states.append(late);

    await expect(
      storage.states.stateAt(taskId("task"), create(TimestampSchema, { seconds: 4n, nanos: 500 })),
    ).resolves.toMatchObject({ title: "early" });
    await storage.states.truncate(create(TimestampSchema, { seconds: 4n, nanos: 500 }));
    await expect(storage.states.backward(taskId("task"), 2)).resolves.toHaveLength(1);
  });

  it("selects the state at an exact nanosecond and rejects invalid history retention", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    await storage.states.append(
      create(EntityRecordSchema, {
        entityId: packId("task"),
        state: packState("exact"),
        version: {
          number: 1,
          timestamp: create(TimestampSchema, { seconds: 4n, nanos: 500 }),
        },
      }),
    );

    await expect(
      storage.states.stateAt(taskId("task"), create(TimestampSchema, { seconds: 4n, nanos: 500 })),
    ).resolves.toMatchObject({ title: "exact" });
    await expect(storage.states.backward(taskId("task"), 0)).rejects.toThrow(
      "positive safe integer",
    );
    await expect(storage.states.trim(taskId("task"), -1)).rejects.toThrow(
      "non-negative safe integer",
    );
  });

  it("reads an unversioned retained state at version zero without duplicating it", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    const unversioned = create(EntityRecordSchema, {
      entityId: packId("task"),
      state: packState("initial"),
    });
    await storage.states.append(unversioned);
    await storage.states.append(unversioned);

    await expect(storage.states.backward(taskId("task"), 1, 0n)).resolves.toHaveLength(1);
  });

  it("reads retained states and diagnostic events across a 128-record keyset boundary", async () => {
    const backend = new HistoryDatastoreBackend();
    const storage = factory(backend).createEntityStorage(input());
    for (let version = 1; version <= 129; version += 1) {
      await storage.states.append(record(`state-${String(version)}`, version));
      await storage.events.append(event(`event-${String(version)}`, version));
    }

    const states = await storage.states.backward(taskId("task"), 129);
    const events = await storage.events.backward(taskId("task"), 129);

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
    await expect(storage.states.backward(taskId("task"), 129)).rejects.toThrow(
      "continuation is malformed",
    );
  });

  it("returns no state when the requested time precedes retained history", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    await storage.states.append(record("first", 2));

    await expect(
      storage.states.stateAt(taskId("task"), create(TimestampSchema, { seconds: 1n })),
    ).resolves.toBeUndefined();
  });

  it("maintains state and event histories across a 128-record keyset boundary", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    for (let version = 1; version <= 129; version += 1) {
      await storage.states.append(record(`state-${String(version)}`, version));
      await storage.events.append(event(`event-${String(version)}`, version));
    }

    await storage.states.trim(taskId("task"), 2);
    await storage.events.truncate(create(TimestampSchema, { seconds: 128n }));

    await expect(storage.states.backward(taskId("task"), 3)).resolves.toMatchObject([
      { version: { number: 129 } },
      { version: { number: 128 } },
    ]);
    await expect(storage.events.backward(taskId("task"), 3, 129n)).resolves.toMatchObject([
      { id: { value: "event-129" } },
      { id: { value: "event-128" } },
    ]);
  });

  it("keeps provider history reads and retention work bounded to 128-row pages", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(new TypeRegistry([TaskIdSchema, TaskSchema, TaskCreatedSchema]));
    const storage = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .setStringifierRegistry(stringifiers)
      .build()
      .createEntityStorage(input());
    for (let version = 1; version <= 129; version += 1)
      await storage.states.append(record(`state-${String(version)}`, version));

    const beforeRead = client.queryCalls;
    await expect(storage.states.backward(taskId("task"), 129)).resolves.toHaveLength(129);
    expect(client.queryCalls - beforeRead).toBe(2);
    expect(client.queryLimits.slice(-2)).toEqual([128, 1]);
    expect(
      client.queries
        .slice(-2)
        .every((query) =>
          query.filters.some((filter) => Array.isArray(filter) && filter[0] === "entity_id"),
        ),
    ).toBe(true);

    await storage.states.trim(taskId("task"), 17);
    await expect(storage.states.backward(taskId("task"), 129)).resolves.toHaveLength(17);
    expect(client.queryLimits.every((limit) => limit <= 128)).toBe(true);
    expect(client.deleteCalls).toBeGreaterThan(0);
  });

  it.each([
    { total: 129, keep: 1 },
    { total: 257, keep: 129 },
  ])("trims $total states to $keep across keyset pages", async ({ total, keep }) => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(new TypeRegistry([TaskIdSchema, TaskSchema, TaskCreatedSchema]));
    const storage = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .setStringifierRegistry(stringifiers)
      .build()
      .createEntityStorage(input());
    for (let version = 1; version <= total; version += 1)
      await storage.states.append(record(`state-${String(version)}`, version));
    const query = client.runQuery.bind(client);
    vi.spyOn(client, "runQuery").mockImplementation((request) => {
      if (client.queryCalls > 4) throw new Error("trim did not advance its provider page");
      return query(request);
    });

    await storage.states.trim(taskId("task"), keep);
    const retained = await storage.states.backward(taskId("task"), total);
    expect(retained).toHaveLength(keep);
    expect(retained.at(-1)?.version?.number).toBe(total - keep + 1);
    expect(client.queryLimits.every((limit) => limit <= 128)).toBe(true);
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

    await expect(storage.events.backward(taskId("task"), 1)).resolves.toEqual([]);
    expect(client.queryLimits.every((limit) => limit <= 128)).toBe(true);
  }, 30_000);

  it("writes generated families independently and converges an identical retry", async () => {
    const backend = new HistoryDatastoreBackend();
    const store = factory(backend);
    const entity = input();
    const commit = EntityCommitStorageFactories.create(store, entity);
    const mutation = {
      context: entity.context,
      entity,
      entityId: taskId("task"),
      next: record("one", 1),
      states: [record("one", 1)],
      diagnostics: [event("diagnostic", 1)],
      events: [event("delivery", 1)],
    };
    await expect(commit.commit(mutation)).resolves.toBeUndefined();
    await expect(commit.commit(mutation)).resolves.toBeUndefined();
    expect(backend.entities).toHaveLength(4);
  });

  it("retains completed Task state history when the next record write fails", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const original = client.transaction.bind(client);
    client.transaction = () => {
      const transaction = original();
      if (client.transactionCalls === 2)
        transaction.commit = () => Promise.reject(new Error("later record failed"));
      return transaction;
    };
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(new TypeRegistry([TaskIdSchema, TaskSchema, TaskCreatedSchema]));
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .setStringifierRegistry(stringifiers)
      .build();
    const entity = input();
    const commit = EntityCommitStorageFactories.create(store, entity);
    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: taskId("task"),
        next: record("next", 1),
        states: [record("next", 1)],
        diagnostics: [event("diagnostic", 1)],
      }),
    ).rejects.toThrow();
    expect(backend.entities).toHaveLength(1);
    const records = store.createEntityStorage(entity);
    await expect(records.current.read(taskId("task"))).resolves.toBeUndefined();
  });

  it("reuses captured Task bytes when a completed current write reports an abort", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const originalSave = client.save.bind(client);
    let ambiguous = true;
    client.save = async (input) => {
      const saved = await originalSave(input);
      if (ambiguous) {
        ambiguous = false;
        throw Object.assign(new Error("completed write reported aborted"), { code: 10 });
      }
      return saved;
    };
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(new TypeRegistry([TaskIdSchema, TaskSchema, TaskCreatedSchema]));
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .setStringifierRegistry(stringifiers)
      .build();
    const entity = input();
    const next = record("captured", 1);
    const commit = EntityCommitStorageFactories.create(store, entity);
    const pending = commit.commit({
      context: entity.context,
      entity,
      entityId: taskId("task"),
      next,
    });
    next.state = packState("mutated");
    await expect(pending).resolves.toBeUndefined();
    const stored = await store.createEntityStorage(entity).current.read(taskId("task"));
    if (stored?.state === undefined) throw new Error("Expected a stored Task state.");
    expect(AnyPacker.unpack(stored.state, TaskSchema).title).toBe("captured");
    expect(client.saveCalls).toBe(1);
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
      entityId: taskId("task"),
      next: current,
      states: [record("retained", 1)],
    });

    await expect(
      commits.commit({
        context: entity.context,
        entity,
        entityId: taskId("task"),
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
        context: { producerId: packId("task") },
      }),
    );
    await storage.events.append(
      create(EventSchema, {
        id: create(EventIdSchema, { value: "unversioned-second" }),
        context: { producerId: packId("task") },
      }),
    );

    await expect(storage.events.backward(taskId("task"), 2, 0n)).resolves.toHaveLength(2);
    await storage.events.truncate(create(TimestampSchema, { seconds: 1n }));
    await expect(storage.events.backward(taskId("task"), 1)).resolves.toEqual([]);
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
        entityId: taskId("task"),
        next: record("one", 1),
        events: [event("", 1)],
      }),
    ).rejects.toThrow("non-blank");
    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: taskId("task"),
        next: record("one", 1),
        events: [event("same", 1), event("same", 1)],
      }),
    ).rejects.toThrow("unique");
    expect(client.transactionCalls).toBe(0);
  });

  it("closes Entity and commit handles idempotently", async () => {
    const entity = input();
    const store = factory(new HistoryDatastoreBackend());
    const handle = store.createEntityStorage(entity);

    await handle.close();
    await handle.close();
    expect(handle.isOpen()).toBe(false);
    await expect(handle.current.read(taskId("task"))).rejects.toThrow("closed");
    await expect(handle.states.backward(taskId("task"), 1)).rejects.toThrow("closed");
    await expect(handle.events.backward(taskId("task"), 1)).rejects.toThrow("closed");

    const commits = EntityCommitStorageFactories.create(store, entity);
    await commits.close();
    await commits.close();
    await expect(
      commits.commit({
        context: entity.context,
        entity,
        entityId: taskId("task"),
        next: record("current", 1),
      }),
    ).rejects.toThrow("closed");
  });

  it("keeps a bundle's read handle open until an admitted commit settles", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();
    const entity = input(false);
    const closeRead = vi.spyOn(DatastoreEntityStorage.prototype, "close");
    const handle = store.createEntityStorage(entity);
    const entered = deferred<undefined>();
    const release = deferred<undefined>();
    const read = client.get.bind(client);
    vi.spyOn(client, "get").mockImplementation(async (key) => {
      entered.resolve(undefined);
      await release.promise;
      return read(key);
    });
    const commit = handle.commits.commit({
      context: entity.context,
      entity,
      entityId: taskId("task"),
      next: record("committed", 1),
    });
    await entered.promise;
    const closing = handle.close();
    expect(handle.isOpen()).toBe(false);
    expect(closeRead).not.toHaveBeenCalled();
    release.resolve(undefined);
    await commit;
    await closing;
    expect(handle.isOpen()).toBe(false);
    expect(closeRead).toHaveBeenCalledOnce();
    closeRead.mockRestore();
  });

  it("closes the complete custom Entity bundle through provider commit access", async () => {
    const client = new HistoryDatastoreBackend().client();
    const close = vi.fn().mockResolvedValue(undefined);
    const closeIdle = vi.fn();
    const commitClose = vi.fn().mockResolvedValue(undefined);
    const commits = {
      commit: vi.fn().mockResolvedValue(undefined),
      readAgentPreferences: vi.fn().mockResolvedValue(undefined),
      commitAgent: vi.fn().mockResolvedValue(undefined),
      close: commitClose,
      closeIdle: vi.fn(),
    };
    const creator = vi.fn(
      () =>
        ({
          current: {} as never,
          states: {} as never,
          events: {} as never,
          commits,
          isOpen: () => true,
          close,
          closeIdle,
        }) satisfies DatastoreEntityStorageHandle<unknown, Task>,
    );
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .useEntityStorage(TaskSchema, creator)
      .build();
    const port = EntityCommitStorageFactories.create(store, input(false));
    expect(creator).toHaveBeenCalledOnce();
    await port.close();
    expect(close).toHaveBeenCalledOnce();
    expect(commitClose).not.toHaveBeenCalled();
    await store.close();
    expect(close).toHaveBeenCalledOnce();
  });
  it("repeats successful custom idle cleanup without releasing the bundle twice", async () => {
    const client = new HistoryDatastoreBackend().client();
    const released = vi.fn();
    let closed = false;
    const release = () => {
      if (!closed) {
        closed = true;
        released();
      }
    };
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .useEntityStorage(
        TaskSchema,
        () =>
          ({
            current: {} as never,
            states: {} as never,
            events: {} as never,
            commits: {
              commit: vi.fn(),
              readAgentPreferences: vi.fn().mockResolvedValue(undefined),
              commitAgent: vi.fn().mockResolvedValue(undefined),
              close: vi.fn(),
              closeIdle: vi.fn(),
            },
            isOpen: () => !closed,
            close: () => {
              release();
              return Promise.resolve();
            },
            closeIdle: release,
          }) satisfies DatastoreEntityStorageHandle<unknown, Task>,
      )
      .build();
    const port = EntityCommitStorageFactories.create(store, input(false));
    const closePort = vi.spyOn(port, "close");
    port.closeIdle();
    port.closeIdle();
    expect(released).toHaveBeenCalledOnce();
    await store.close();
    expect(released).toHaveBeenCalledOnce();
    expect(closePort).not.toHaveBeenCalled();
  });
  it("retains a closing custom bundle after idle cleanup rejects", async () => {
    const release = deferred<undefined>();
    let released = false;
    const close = vi.fn(async () => {
      await release.promise;
      released = true;
    });
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(new HistoryDatastoreBackend().client() as never)
      .useEntityStorage(TaskSchema, () => ({
        current: {} as never,
        states: {} as never,
        events: {} as never,
        commits: {
          commit: vi.fn(),
          readAgentPreferences: vi.fn().mockResolvedValue(undefined),
          commitAgent: vi.fn().mockResolvedValue(undefined),
          close: vi.fn(),
          closeIdle: vi.fn(),
        },
        isOpen: () => false,
        close,
        closeIdle: () => {
          throw new Error("closing bundle is active");
        },
      }))
      .build();
    const port = EntityCommitStorageFactories.create(store, input(false));
    const closing = port.close();
    expect(() => {
      port.closeIdle();
    }).toThrow(/active/);
    const catalogClose = vi.spyOn(store.tenantCatalog(), "close").mockImplementation(() => {
      if (!released) throw new Error("catalog closed before bundle settled");
      return Promise.resolve();
    });
    const factoryClosing = store.close();
    await Promise.resolve();
    await Promise.resolve();
    expect(catalogClose).not.toHaveBeenCalled();
    release.resolve(undefined);
    await expect(closing).resolves.toBeUndefined();
    await expect(factoryClosing).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });
  it("retains a custom bundle when idle cleanup fails before asynchronous close", async () => {
    const release = deferred<undefined>();
    let settled = false;
    const idleFailure = new Error("idle cleanup failed");
    const close = vi.fn(async () => {
      await release.promise;
      settled = true;
    });
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(new HistoryDatastoreBackend().client() as never)
      .useEntityStorage(TaskSchema, () => ({
        current: {} as never,
        states: {} as never,
        events: {} as never,
        commits: {
          commit: vi.fn(),
          readAgentPreferences: vi.fn().mockResolvedValue(undefined),
          commitAgent: vi.fn().mockResolvedValue(undefined),
          close: vi.fn(),
          closeIdle: vi.fn(),
        },
        isOpen: () => true,
        close,
        closeIdle: () => {
          throw idleFailure;
        },
      }))
      .build();
    const port = EntityCommitStorageFactories.create(store, input(false));
    expect(() => {
      port.closeIdle();
    }).toThrow(idleFailure);
    expect(close).not.toHaveBeenCalled();
    const catalogClose = vi.spyOn(store.tenantCatalog(), "close").mockImplementation(() => {
      if (!settled) throw new Error("catalog closed before bundle settled");
      return Promise.resolve();
    });
    const closing = store.close();
    await Promise.resolve();
    expect(catalogClose).not.toHaveBeenCalled();
    release.resolve(undefined);
    await expect(closing).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
    expect(catalogClose).toHaveBeenCalledOnce();
  });
  it("removes individually settled Datastore bundles before factory shutdown", async () => {
    const store = factory(new HistoryDatastoreBackend());
    const handles = Array.from({ length: 4 }, () => store.createEntityStorage(input(false)));
    const closes = handles.map((handle) => vi.spyOn(handle, "close"));
    await Promise.all(handles.map((handle) => handle.close()));
    await store.close();
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
  });
  it("admits ID-validation callbacks before reentrant factory close", async () => {
    const store = factory(new HistoryDatastoreBackend());
    const base = input(false);
    let closing: Promise<void> | undefined;
    const entity = {
      ...base,
      id: {
        ...base.id,
        unpack: (id: ReturnType<typeof AnyPacker.pack>) => {
          expect(() => {
            commit.closeIdle();
          }).toThrow(/active/);
          closing = store.close();
          return base.id.unpack(id);
        },
      },
    };
    const commit = EntityCommitStorageFactories.create(store, entity);
    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: taskId("task"),
        next: record("captured", 1),
      }),
    ).resolves.toBeUndefined();
    await expect(closing).resolves.toBeUndefined();
  });

  it("rejects idle bundle cleanup during an admitted commit without closing read records", async () => {
    const client = new HistoryDatastoreBackend().client();
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();
    const handle = store.createEntityStorage(input(false));
    const entered = deferred<undefined>();
    const release = deferred<undefined>();
    const read = client.get.bind(client);
    vi.spyOn(client, "get").mockImplementation(async (key) => {
      entered.resolve(undefined);
      await release.promise;
      return read(key);
    });
    const closeRead = vi.spyOn(DatastoreEntityStorage.prototype, "close");
    const entity = input(false);
    const work = handle.commits.commit({
      context: entity.context,
      entity,
      entityId: taskId("task"),
      next: record("one", 1),
    });
    await entered.promise;
    expect(() => {
      handle.closeIdle();
    }).toThrow(/active/);
    expect(closeRead).not.toHaveBeenCalled();
    release.resolve(undefined);
    await work;
    await handle.close();
    closeRead.mockRestore();
  });

  it("attempts every built-in read-family close despite multiple failures", () => {
    const closed = vi.fn();
    const storage = new DatastoreEntityStorage(
      input(),
      () =>
        ({
          close: () => {
            closed();
            throw new Error("record close failed");
          },
          isOpen: () => true,
        }) as never,
    );
    expect(() => {
      storage.close();
    }).toThrow(AggregateError);
    expect(closed).toHaveBeenCalledTimes(3);
  });

  it("fences every custom bundle and closes the catalog after a synchronous close failure", async () => {
    const client = new HistoryDatastoreBackend().client();
    const bundleFailure = new Error("first bundle failed");
    const catalogFailure = new Error("catalog close failed");
    const first = vi.fn((): Promise<void> => {
      throw bundleFailure;
    });
    const second = vi.fn().mockResolvedValue(undefined);
    const closes = [first, second];
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .useEntityStorage(TaskSchema, () => {
        const close = closes.shift();
        if (close === undefined) throw new Error("Expected another custom bundle close.");
        return {
          current: {} as never,
          states: {} as never,
          events: {} as never,
          commits: {
            commit: vi.fn(),
            readAgentPreferences: vi.fn().mockResolvedValue(undefined),
            commitAgent: vi.fn().mockResolvedValue(undefined),
            close: vi.fn(),
            closeIdle: vi.fn(),
          },
          isOpen: () => true,
          close,
          closeIdle: vi.fn(),
        } satisfies DatastoreEntityStorageHandle<unknown, Task>;
      })
      .build();
    store.createEntityStorage(input(false));
    store.createEntityStorage(input(false));
    const catalogClose = vi.spyOn(store.tenantCatalog(), "close").mockRejectedValue(catalogFailure);
    await expect(store.close()).rejects.toMatchObject({
      errors: [bundleFailure, catalogFailure],
    });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(catalogClose).toHaveBeenCalledOnce();
  });
});
