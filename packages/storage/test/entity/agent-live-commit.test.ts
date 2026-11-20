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

import { create } from "@bufbuild/protobuf";
import { EmptySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AnyPacker, TypeUrls } from "@spine-event-engine/core";
import { AiModelKind, ModelPreferenceSchema } from "@spine-event-engine/proto/agent";
import { VersionSchema } from "@spine-event-engine/proto";
import { TenantIdSchema } from "@spine-event-engine/proto";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { describe, expect, it } from "vitest";

import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
  type SupportReplyAgentId,
  type SupportReplyAgentState,
} from "../../../server/test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import { EntityCommitStorageFactories } from "../../src/internal/entity-commit.js";
import { AgentHistoryStorageFactories } from "../../src/internal/agent-history.js";
import { AgentHistoryRecords } from "../../src/entity/agent-history-record-spec.js";
import { AgentAttributes } from "../../src/internal/agent-attributes.js";
import { InMemoryStorageFactory } from "../../src/memory/in-memory-storage-factory.js";
import { InMemoryStorageBackend } from "../../src/memory/in-memory-storage-backend.js";
import {
  InMemoryEntityStorage,
  MemoryEntityStorageFactory,
} from "../../src/memory/in-memory-entity-history.js";
import { StoragePreparations } from "../../src/internal/storage-preparation.js";
import { TenantBoundary } from "../../src/internal/tenancy.js";
import { AgentHistoryMutationQueue } from "../../src/memory/agent-history-mutation-queue.js";
import { vi } from "vitest";
import { agentAttributes } from "./agent-live-fixtures.js";
import { RecordSpec } from "../../src/record/record-spec.js";
import type { EntityStorageInput } from "../../src/internal/entity-history.js";
import type { EntityRecord } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { conversation } from "./agent-history-fixtures.js";

describe("live Agent conditional persistence", () => {
  it("reads current state and complete attributes after the preceding memory mutation", async () => {
    const backend = new InMemoryStorageBackend();
    const factory = new InMemoryStorageFactory(backend);
    const layout = sourceEntityInput();
    const commits = EntityCommitStorageFactories.create(factory, layout);
    const id = createAgentId();
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const gate = AgentHistoryMutationQueue.bind(backend, TenantBoundary.of(layout.context)).run(
      id.ticketNumber,
      async () => {
        entered.resolve(undefined);
        await release.promise;
      },
    );
    await entered.promise;
    const attributes = agentAttributes(id);
    const next = create(EntityRecordSchema, {
      entityId: layout.id.pack(id),
      state: AnyPacker.pack(
        SupportReplyAgentStateSchema,
        create(SupportReplyAgentStateSchema, { id }),
      ),
      version: create(VersionSchema, { number: 1 }),
    });
    try {
      const writing = commits.commitAgent({
        entityId: id,
        expectedVersion: 0,
        expectedAttributes: undefined,
        attributes,
        entityCommit: { context: layout.context, entity: layout, entityId: id, next },
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      let readSettled = false;
      const reading = commits.readAgentCurrent(id).then((image) => {
        readSettled = true;
        return image;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(readSettled).toBe(false);
      release.resolve(undefined);
      await gate;
      await writing;
      expect(await reading).toEqual({ current: next, attributes });
    } finally {
      release.resolve(undefined);
      await commits.close();
      await factory.close();
    }
  });

  it("declares Agent families without creating storage or admitting a tenant", async () => {
    const backend = new InMemoryStorageBackend();
    const factory = new InMemoryStorageFactory(backend);
    const layout = {
      ...sourceEntityInput(),
      context: {
        name: "Support",
        multitenant: true as const,
        tenantId: create(TenantIdSchema, { kind: { case: "value", value: "tenant-live" } }),
      },
      stateHistory: true,
    };
    const createStorage = vi.spyOn(MemoryEntityStorageFactory.prototype, "create");
    try {
      const preparation = StoragePreparations.for(factory);
      await preparation.prepareAgentCommit(layout, "create");
      await preparation.prepareAgentCommit(layout, "check");
      expect(createStorage).not.toHaveBeenCalled();
      expect(InMemoryStorageBackend.tenantCount(backend)).toBe(0);
      await expect(factory.tenantCatalog().all()).resolves.toEqual([]);
    } finally {
      createStorage.mockRestore();
      await factory.close();
    }
  });

  it("distinguishes absent preferences from a stale snapshot without Entity state", async () => {
    const factory = new InMemoryStorageFactory();
    const commits = EntityCommitStorageFactories.create(factory, sourceEntityInput());
    const entityId = create(SupportReplyAgentIdSchema, { ticketNumber: "T-live" });
    const preferences = [
      create(ModelPreferenceSchema, {
        kind: AiModelKind.GENERATION,
        selection: { case: "inheritRepositoryDefault", value: create(EmptySchema) },
      }),
    ];
    try {
      await expect(
        commits.readAgentCurrent(entityId).then((data) => data.attributes?.modelPreferences),
      ).resolves.toBeUndefined();
      await commits.commitAgent({
        entityId,
        expectedVersion: 0,
        expectedAttributes: undefined,
        attributes: agentAttributes(entityId, preferences),
      });
      await expect(
        commits.readAgentCurrent(entityId).then((data) => data.attributes?.modelPreferences),
      ).resolves.toEqual(preferences);
      await expect(
        commits.commitAgent({
          entityId,
          expectedVersion: 0,
          expectedAttributes: undefined,
          attributes: agentAttributes(entityId),
        }),
      ).rejects.toThrow(/preference|conflict/i);
      await expect(
        commits.readAgentCurrent(entityId).then((data) => data.attributes?.modelPreferences),
      ).resolves.toEqual(preferences);
    } finally {
      await commits.close();
      await factory.close();
    }
  });

  it("commits changed Agent state and final audit together, then rejects stale state", async () => {
    const factory = new InMemoryStorageFactory();
    const layout = { ...sourceEntityInput(), stateHistory: true };
    const commits = EntityCommitStorageFactories.create(factory, layout);
    const history = AgentHistoryStorageFactories.create(factory, {
      context: layout.context,
      agent: (id: ReturnType<typeof createAgentId>) => AgentAttributes.id(layout, id),
    });
    const entityId = createAgentId();
    const first = conversation(
      "final-first",
      "draft-reply",
      create(TimestampSchema, { seconds: 101n }),
    );
    const second = conversation(
      "final-second",
      "draft-reply",
      create(TimestampSchema, { seconds: 102n }),
    );
    const next = create(EntityRecordSchema, {
      entityId: layout.id.pack(entityId),
      state: AnyPacker.pack(
        SupportReplyAgentStateSchema,
        create(SupportReplyAgentStateSchema, { id: entityId }),
      ),
      version: create(VersionSchema, { number: 1 }),
    });
    try {
      await commits.commitAgent({
        entityId,
        expectedVersion: 0,
        expectedAttributes: undefined,
        attributes: agentAttributes(entityId),
        entityCommit: { context: layout.context, entity: layout, entityId, next, states: [next] },
        historyEntries: [first],
      });
      const page = await history.read({ entityId, view: { kind: "full" }, count: 10 });
      expect(page.entries).toEqual([
        AgentHistoryRecords.capture(AgentAttributes.id(layout, entityId), first),
      ]);
      await expect(
        commits.commitAgent({
          entityId,
          expectedVersion: 0,
          expectedAttributes: agentAttributes(entityId),
          attributes: agentAttributes(entityId),
          historyEntries: [second],
        }),
      ).rejects.toThrow(/Version/i);
      expect((await history.read({ entityId, view: { kind: "full" }, count: 10 })).entries).toEqual(
        [AgentHistoryRecords.capture(AgentAttributes.id(layout, entityId), first)],
      );
    } finally {
      history.close();
      await commits.close();
      await factory.close();
    }
  });

  it("rolls back current, state history, and audit on a late preference conflict", async () => {
    const backend = new InMemoryStorageBackend();
    const firstFactory = new InMemoryStorageFactory(backend);
    const secondFactory = new InMemoryStorageFactory(backend);
    const layout = { ...sourceEntityInput(), stateHistory: true };
    const first = EntityCommitStorageFactories.create(firstFactory, layout);
    const second = EntityCommitStorageFactories.create(secondFactory, layout);
    const states = firstFactory.createEntityStorage(layout) as InMemoryEntityStorage<
      SupportReplyAgentId,
      SupportReplyAgentState
    >;
    const history = AgentHistoryStorageFactories.create(firstFactory, {
      context: layout.context,
      agent: (id: ReturnType<typeof createAgentId>) => AgentAttributes.id(layout, id),
    });
    const entityId = createAgentId();
    const selection = [
      create(ModelPreferenceSchema, {
        kind: AiModelKind.GENERATION,
        selection: { case: "inheritRepositoryDefault", value: create(EmptySchema) },
      }),
    ];
    const firstAudit = conversation("first", "dialog", create(TimestampSchema, { seconds: 1n }));
    const secondAudit = conversation("second", "dialog", create(TimestampSchema, { seconds: 2n }));
    const state = (version: number, proposedReply: string) =>
      create(EntityRecordSchema, {
        entityId: layout.id.pack(entityId),
        state: AnyPacker.pack(
          SupportReplyAgentStateSchema,
          create(SupportReplyAgentStateSchema, { id: entityId, proposedReply }),
        ),
        version: create(VersionSchema, { number: version }),
      });
    const v1 = state(1, "first");
    const v2 = state(2, "second");
    const proposed = {
      entityId,
      expectedVersion: 1,
      historyEntries: [secondAudit],
      entityCommit: {
        context: layout.context,
        entity: layout,
        entityId,
        next: v2,
        states: [v2],
      },
    };
    try {
      await first.commitAgent({
        entityId,
        expectedVersion: 0,
        expectedAttributes: undefined,
        attributes: agentAttributes(entityId),
        entityCommit: { context: layout.context, entity: layout, entityId, next: v1, states: [v1] },
        historyEntries: [firstAudit],
      });
      await second.commitAgent({
        entityId,
        expectedVersion: 1,
        expectedAttributes: agentAttributes(entityId),
        attributes: agentAttributes(entityId, selection),
      });
      await expect(
        first.commitAgent({
          ...proposed,
          expectedAttributes: agentAttributes(entityId),
          attributes: agentAttributes(entityId),
        }),
      ).rejects.toThrow(/preference|conflict/i);
      expect(await states.current.read(entityId)).toEqual(v1);
      expect(await states.states.backward(entityId, 10)).toEqual([v1]);
      expect((await history.read({ entityId, view: { kind: "full" }, count: 10 })).entries).toEqual(
        [AgentHistoryRecords.capture(AgentAttributes.id(layout, entityId), firstAudit)],
      );
      expect(
        await first.readAgentCurrent(entityId).then((data) => data.attributes?.modelPreferences),
      ).toEqual(selection);
      expect(
        await second.readAgentCurrent(entityId).then((data) => data.attributes?.modelPreferences),
      ).toEqual(selection);
      await first.commitAgent({
        ...proposed,
        expectedAttributes: agentAttributes(entityId, selection),
        attributes: agentAttributes(entityId, selection),
      });
      expect(await states.current.read(entityId)).toEqual(v2);
      expect(await states.states.backward(entityId, 10)).toEqual([v2, v1]);
      expect((await history.read({ entityId, view: { kind: "full" }, count: 10 })).entries).toEqual(
        [secondAudit, firstAudit].map((entry) =>
          AgentHistoryRecords.capture(AgentAttributes.id(layout, entityId), entry),
        ),
      );
      expect(
        await first.readAgentCurrent(entityId).then((data) => data.attributes?.modelPreferences),
      ).toEqual(selection);
    } finally {
      states.close();
      history.close();
      await Promise.all([first.close(), second.close()]);
      await Promise.all([firstFactory.close(), secondFactory.close()]);
    }
  });

  it("allows one preference-only winner across independent memory handles", async () => {
    const backend = new InMemoryStorageBackend();
    const firstFactory = new InMemoryStorageFactory(backend);
    const secondFactory = new InMemoryStorageFactory(backend);
    const first = EntityCommitStorageFactories.create(firstFactory, sourceEntityInput());
    const second = EntityCommitStorageFactories.create(secondFactory, sourceEntityInput());
    const entityId = createAgentId();
    const selection = [
      create(ModelPreferenceSchema, {
        kind: AiModelKind.GENERATION,
        selection: { case: "inheritRepositoryDefault", value: create(EmptySchema) },
      }),
    ];
    try {
      expect(
        await Promise.all([
          first.readAgentCurrent(entityId).then((data) => data.attributes?.modelPreferences),
          second.readAgentCurrent(entityId).then((data) => data.attributes?.modelPreferences),
        ]),
      ).toEqual([undefined, undefined]);
      const outcomes = await Promise.allSettled([
        first.commitAgent({
          entityId,
          expectedVersion: 0,
          expectedAttributes: undefined,
          attributes: agentAttributes(entityId, selection),
        }),
        second.commitAgent({
          entityId,
          expectedVersion: 0,
          expectedAttributes: undefined,
          attributes: agentAttributes(entityId),
        }),
      ]);
      expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
      const current = await first
        .readAgentCurrent(entityId)
        .then((data) => data.attributes?.modelPreferences);
      expect([[], selection]).toContainEqual(current);
      expect(
        await second.readAgentCurrent(entityId).then((data) => data.attributes?.modelPreferences),
      ).toEqual(current);
    } finally {
      await Promise.all([first.close(), second.close()]);
      await Promise.all([firstFactory.close(), secondFactory.close()]);
    }
  });

  it("drains a turn admitted before a reentrant factory close", async () => {
    const factory = new InMemoryStorageFactory();
    const original = sourceEntityInput();
    let closing: Promise<void> | undefined;
    const layout = {
      ...original,
      id: {
        ...original.id,
        clone: (id: ReturnType<typeof createAgentId>) => {
          closing ??= factory.close();
          return original.id.clone(id);
        },
      },
    };
    const commits = EntityCommitStorageFactories.create(factory, layout);
    const entityId = createAgentId();
    await commits.commitAgent({
      entityId,
      expectedVersion: 0,
      expectedAttributes: undefined,
      attributes: agentAttributes(entityId),
    });
    await closing;
    expect(() =>
      commits.readAgentCurrent(entityId).then((data) => data.attributes?.modelPreferences),
    ).toThrow(/closed/i);
  });
});

function createAgentId() {
  return create(SupportReplyAgentIdSchema, { ticketNumber: "T-live-commit" });
}

/**
 * Builds the source-package layout used by internal memory storage tests.
 *
 * @returns Typed Support Agent Entity layout.
 */
function sourceEntityInput(): EntityStorageInput<SupportReplyAgentId, SupportReplyAgentState> {
  return {
    context: { name: "Support", multitenant: false },
    id: {
      clone: (id) => create(SupportReplyAgentIdSchema, { ticketNumber: id.ticketNumber }),
      key: (id) => id.ticketNumber,
      pack: (id) => AnyPacker.pack(SupportReplyAgentIdSchema, id),
      unpack: (value) => AnyPacker.tryUnpack(value, SupportReplyAgentIdSchema),
    },
    columns: [],
    recordSpec: new RecordSpec<SupportReplyAgentId, EntityRecord>({
      sourceType: SupportReplyAgentStateSchema,
      recordType: EntityRecordSchema,
      idSchema: SupportReplyAgentIdSchema,
      extractId: (record) => {
        if (record.entityId?.typeUrl !== TypeUrls.derive(SupportReplyAgentIdSchema))
          throw new TypeError("Support Agent current record requires its typed ID.");
        return AnyPacker.unpack(record.entityId, SupportReplyAgentIdSchema);
      },
    }),
    sourceType: SupportReplyAgentStateSchema,
    stateSchema: SupportReplyAgentStateSchema,
  };
}
