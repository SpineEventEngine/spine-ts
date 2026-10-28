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
import { AnyPacker } from "@spine-event-engine/core";
import { AiModelKind, ModelPreferenceSchema } from "@spine-event-engine/proto/agent";
import { VersionSchema } from "@spine-event-engine/proto";
import { TenantIdSchema } from "@spine-event-engine/proto";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { describe, expect, it } from "vitest";

import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
} from "../../../server/test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import { EntityCommitStorageFactories } from "../../src/internal/entity-commit.js";
import { AgentHistoryStorageFactories } from "../../src/internal/agent-history.js";
import { InMemoryStorageFactory } from "../../src/memory/in-memory-storage-factory.js";
import { InMemoryStorageBackend } from "../../src/memory/in-memory-storage-backend.js";
import { MemoryEntityStorageFactory } from "../../src/memory/in-memory-entity-history.js";
import { StoragePreparations } from "../../src/internal/storage-preparation.js";
import { vi } from "vitest";
import { entityInput } from "./agent-execution-fixtures.js";
import { conversation } from "./agent-history-fixtures.js";

describe("live Agent conditional persistence", () => {
  it("declares Agent families without creating storage or admitting a tenant", async () => {
    const backend = new InMemoryStorageBackend();
    const factory = new InMemoryStorageFactory(backend);
    const layout = {
      ...entityInput(),
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
    const commits = EntityCommitStorageFactories.create(factory, entityInput());
    const entityId = create(SupportReplyAgentIdSchema, { ticketNumber: "T-live" });
    const preferences = [
      create(ModelPreferenceSchema, {
        kind: AiModelKind.GENERATION,
        selection: { case: "inheritRepositoryDefault", value: create(EmptySchema) },
      }),
    ];
    try {
      await expect(commits.readAgentPreferences(entityId)).resolves.toBeUndefined();
      await commits.commitAgent({
        entityId,
        expectedVersion: 0,
        expectedPreferences: undefined,
        preferences,
      });
      await expect(commits.readAgentPreferences(entityId)).resolves.toEqual(preferences);
      await expect(
        commits.commitAgent({
          entityId,
          expectedVersion: 0,
          expectedPreferences: undefined,
          preferences: [],
        }),
      ).rejects.toThrow(/preference|conflict/i);
      await expect(commits.readAgentPreferences(entityId)).resolves.toEqual(preferences);
    } finally {
      await commits.close();
      await factory.close();
    }
  });

  it("commits changed Agent state and final audit together, then rejects stale state", async () => {
    const factory = new InMemoryStorageFactory();
    const layout = { ...entityInput(), stateHistory: true };
    const commits = EntityCommitStorageFactories.create(factory, layout);
    const history = AgentHistoryStorageFactories.create(factory, {
      context: layout.context,
      stateType: layout.stateSchema.typeName,
      id: { key: (id: ReturnType<typeof createAgentId>) => id.ticketNumber },
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
        expectedPreferences: undefined,
        preferences: [],
        entityCommit: { context: layout.context, entity: layout, entityId, next, states: [next] },
        historyEntries: [first],
      });
      const page = await history.read({ entityId, view: { kind: "full" }, count: 10 });
      expect(page.entries).toEqual([first]);
      await expect(
        commits.commitAgent({
          entityId,
          expectedVersion: 0,
          expectedPreferences: [],
          preferences: [],
          historyEntries: [second],
        }),
      ).rejects.toThrow(/Version/i);
      expect((await history.read({ entityId, view: { kind: "full" }, count: 10 })).entries).toEqual(
        [first],
      );
    } finally {
      history.close();
      await commits.close();
      await factory.close();
    }
  });

  it("allows one preference-only winner across independent memory handles", async () => {
    const backend = new InMemoryStorageBackend();
    const firstFactory = new InMemoryStorageFactory(backend);
    const secondFactory = new InMemoryStorageFactory(backend);
    const first = EntityCommitStorageFactories.create(firstFactory, entityInput());
    const second = EntityCommitStorageFactories.create(secondFactory, entityInput());
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
          first.readAgentPreferences(entityId),
          second.readAgentPreferences(entityId),
        ]),
      ).toEqual([undefined, undefined]);
      const outcomes = await Promise.allSettled([
        first.commitAgent({
          entityId,
          expectedVersion: 0,
          expectedPreferences: undefined,
          preferences: selection,
        }),
        second.commitAgent({
          entityId,
          expectedVersion: 0,
          expectedPreferences: undefined,
          preferences: [],
        }),
      ]);
      expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
      const current = await first.readAgentPreferences(entityId);
      expect([[], selection]).toContainEqual(current);
      expect(await second.readAgentPreferences(entityId)).toEqual(current);
    } finally {
      await Promise.all([first.close(), second.close()]);
      await Promise.all([firstFactory.close(), secondFactory.close()]);
    }
  });

  it("drains a turn admitted before a reentrant factory close", async () => {
    const factory = new InMemoryStorageFactory();
    const original = entityInput();
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
      expectedPreferences: undefined,
      preferences: [],
    });
    await closing;
    expect(() => commits.readAgentPreferences(entityId)).toThrow(/closed/i);
  });
});

function createAgentId() {
  return create(SupportReplyAgentIdSchema, { ticketNumber: "T-live-commit" });
}
