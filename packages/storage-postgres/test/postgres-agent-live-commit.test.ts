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
import { AnyPacker, StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { AiModelKind, ModelPreferenceSchema } from "@spine-event-engine/proto/agent";
import { VersionSchema } from "@spine-event-engine/proto";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import {
  AgentHistoryStorageFactories,
  EntityCommitStorageFactories,
  StoragePreparations,
  type EntityStorageInput,
} from "@spine-event-engine/storage/provider";
import { describe, expect, it } from "vitest";

import {
  SupportReplyAgentIdSchema,
  type SupportReplyAgentId,
  type SupportReplyAgentState,
  SupportReplyAgentStateSchema,
} from "../../server/test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import { entityInput } from "../../storage/test/entity/agent-live-fixtures.js";
import { conversation } from "../../storage/test/entity/agent-history-fixtures.js";
import { PostgresStorageFactory } from "../src/index.js";

const url = process.env.SPINE_TS_POSTGRESQL_URL;

describe.skipIf(url === undefined)("PostgreSQL live Agent conditional persistence", () => {
  it("drains an admitted Agent commit when close starts in the ID callback", async () => {
    if (url === undefined) throw new Error("Task PostgreSQL URL is required.");
    const registry = new StringifierRegistry();
    registry.setTypeRegistry(new TypeRegistry([SupportReplyAgentIdSchema]));
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url })
      .setStringifierRegistry(registry)
      .build();
    const original = entityInput();
    let closing: Promise<void> | undefined;
    const layout = {
      ...original,
      id: {
        ...original.id,
        clone: (id: SupportReplyAgentId) => {
          closing ??= factory.close();
          return original.id.clone(id);
        },
      },
    } as unknown as EntityStorageInput<SupportReplyAgentId, SupportReplyAgentState>;
    const commits = EntityCommitStorageFactories.create(factory, layout);
    const entityId = create(SupportReplyAgentIdSchema, {
      ticketNumber: `close-${String(Date.now())}-${String(process.pid)}`,
    });
    await commits.commitAgent({
      entityId,
      expectedVersion: 0,
      expectedPreferences: undefined,
      preferences: [],
    });
    await closing;
    await expect(commits.readAgentPreferences(entityId)).rejects.toThrow(/closed/i);
  });

  it("reopens complete preferences, current state, and final audit without an execution head", async () => {
    if (url === undefined) throw new Error("Task PostgreSQL URL is required.");
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(
      new TypeRegistry([SupportReplyAgentIdSchema, SupportReplyAgentStateSchema]),
    );
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url })
      .setStringifierRegistry(stringifiers)
      .build();
    const layout = { ...entityInput(), stateHistory: true } as unknown as EntityStorageInput<
      SupportReplyAgentId,
      SupportReplyAgentState
    >;
    const preparation = StoragePreparations.for(factory);
    await preparation.prepareAgentCommit(layout, "create");
    await preparation.prepareAgentCommit(layout, "check");
    const commits = EntityCommitStorageFactories.create(factory, layout);
    const id = create(SupportReplyAgentIdSchema, {
      ticketNumber: `live-${String(Date.now())}-${String(process.pid)}`,
    });
    const preference = create(ModelPreferenceSchema, {
      kind: AiModelKind.GENERATION,
      selection: { case: "inheritRepositoryDefault", value: create(EmptySchema) },
    });
    const entry = conversation(
      "pg-live-final",
      "draft-reply",
      create(TimestampSchema, { seconds: 101n }),
    );
    const next = create(EntityRecordSchema, {
      entityId: layout.id.pack(id),
      state: AnyPacker.pack(
        SupportReplyAgentStateSchema,
        create(SupportReplyAgentStateSchema, { id }),
      ),
      version: create(VersionSchema, { number: 1 }),
    });
    try {
      await expect(commits.readAgentPreferences(id)).resolves.toBeUndefined();
      const requestedPreferences = [preference];
      const pendingCommit = commits.commitAgent({
        entityId: id,
        expectedVersion: 0,
        expectedPreferences: undefined,
        preferences: requestedPreferences,
        entityCommit: {
          context: layout.context,
          entity: layout,
          entityId: id,
          next,
          states: [next],
        },
        historyEntries: [entry],
      });
      requestedPreferences.splice(0);
      await pendingCommit;
      await expect(commits.readAgentPreferences(id)).resolves.toEqual([preference]);
      const history = AgentHistoryStorageFactories.create(factory, {
        context: layout.context,
        stateType: layout.stateSchema.typeName,
        id: { key: (value: typeof id) => value.ticketNumber },
      });
      try {
        const page = await history.read({ entityId: id, view: { kind: "full" }, count: 10 });
        expect(page.entries).toEqual([entry]);
      } finally {
        history.close();
      }
      await expect(
        commits.commitAgent({
          entityId: id,
          expectedVersion: 0,
          expectedPreferences: [preference],
          preferences: [],
        }),
      ).rejects.toThrow(/Version/i);
      await expect(commits.readAgentPreferences(id)).resolves.toEqual([preference]);
      await commits.commitAgent({
        entityId: id,
        expectedVersion: 1,
        expectedPreferences: [preference],
        preferences: [],
      });
      await expect(commits.readAgentPreferences(id)).resolves.toEqual([]);
      await expect(
        commits.commitAgent({
          entityId: id,
          expectedVersion: 1,
          expectedPreferences: [preference],
          preferences: [preference],
        }),
      ).rejects.toThrow(/preference/i);
      const conflictedNext = create(EntityRecordSchema, {
        ...next,
        version: create(VersionSchema, { number: 2 }),
      });
      await expect(
        commits.commitAgent({
          entityId: id,
          expectedVersion: 1,
          expectedPreferences: [],
          preferences: [preference],
          entityCommit: {
            context: layout.context,
            entity: layout,
            entityId: id,
            next: conflictedNext,
            states: [conflictedNext],
          },
          historyEntries: [
            conversation(
              "pg-live-final",
              "different-final",
              create(TimestampSchema, { seconds: 103n }),
            ),
          ],
        }),
      ).rejects.toThrow();
      await expect(commits.readAgentPreferences(id)).resolves.toEqual([]);
      const current = factory.createRecordStorage(layout.context, layout.recordSpec);
      try {
        await expect(current.read(id)).resolves.toEqual(next);
      } finally {
        current.close();
      }
      const contenderA = EntityCommitStorageFactories.create(factory, layout);
      const contenderB = EntityCommitStorageFactories.create(factory, layout);
      const raceId = create(SupportReplyAgentIdSchema, { ticketNumber: `${id.ticketNumber}-race` });
      try {
        const outcomes = await Promise.allSettled([
          contenderA.commitAgent({
            entityId: raceId,
            expectedVersion: 0,
            expectedPreferences: undefined,
            preferences: [preference],
          }),
          contenderB.commitAgent({
            entityId: raceId,
            expectedVersion: 0,
            expectedPreferences: undefined,
            preferences: [],
          }),
        ]);
        expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
        expect(await contenderA.readAgentPreferences(raceId)).toEqual(
          await contenderB.readAgentPreferences(raceId),
        );
      } finally {
        await Promise.all([contenderA.close(), contenderB.close()]);
      }
      await commits.close();
      const reopened = EntityCommitStorageFactories.create(factory, layout);
      try {
        await expect(reopened.readAgentPreferences(id)).resolves.toEqual([]);
      } finally {
        await reopened.close();
      }
    } finally {
      await commits.close();
      await factory.close();
    }
  });
});
