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

import { randomUUID } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { AiRegistry, ModelRef } from "@spine-event-engine/ai";
import { AnyMessages, TypeUrls } from "@spine-event-engine/core";
import { ActorContextSchema, EventIdSchema, UserIdSchema } from "@spine-event-engine/proto";
import {
  QueryIdSchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { SignalMetadata } from "@spine-event-engine/server";
import { ConversationIdSchema } from "@spine-event-engine/proto/agent";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { AiTestBackend, BlackBox } from "@spine-event-engine/testing";
import type { BoundedContext } from "@spine-event-engine/server";
import { describe, expect, it } from "vitest";

import {
  CancelReleaseGenerationSchema,
  OpenReleaseDraftSchema,
  RequestReleaseGenerationSchema,
} from "../generated/spine/examples/releasenotes/commands_pb.js";
import {
  ReleaseDraftOpenedSchema,
  ReleaseGenerationAlreadyRequestedSchema,
  ReleaseGenerationCancelIgnoredSchema,
  ReleaseGenerationRequestedSchema,
} from "../generated/spine/examples/releasenotes/events_pb.js";
import { ReleaseGenerationInputsConflictSchema } from "../generated/spine/examples/releasenotes/rejections_pb.js";
import {
  ReleaseDraftStateSchema,
  ReleaseDraftViewSchema,
} from "../generated/spine/examples/releasenotes/states_pb.js";
import { ReleaseDraftViewQuery } from "../generated/spine/examples/releasenotes/states_query.js";
import {
  GitCommitIdSchema,
  ReleaseComparisonPolicy,
  ReleaseComparisonSchema,
  ReleaseDraftIdSchema,
  ReleaseEvidenceCatalogSchema,
  ReleaseGenerationIdSchema,
  ReleaseInstructionSchema,
  ReleaseModelSelectionSchema,
  ReleaseTitleSchema,
  RepositorySelectionIdSchema,
} from "../generated/spine/examples/releasenotes/types_pb.js";
import { ReleaseNotesAgent, ReleaseNotesContext } from "../dist/src/domain/index.js";

const id = create(ReleaseDraftIdSchema, { value: "release-1" });
const comparison = create(ReleaseComparisonSchema, {
  repository: create(RepositorySelectionIdSchema, { value: "selected-repository" }),
  base: create(GitCommitIdSchema, { value: "a".repeat(40) }),
  target: create(GitCommitIdSchema, { value: "b".repeat(40) }),
  policy: ReleaseComparisonPolicy.ANCESTOR_NET_TREE,
});

async function currentVersion(context: BoundedContext) {
  const result = await context.stand().readVersioned(ReleaseDraftStateSchema, id);
  if (!result?.version) throw new Error("The draft has no Entity Version.");
  return result.version;
}

function registry(): AiRegistry {
  const backend = AiTestBackend.create({
    ref: ModelRef.of("release-scripted", "v1"),
    kind: "generation",
  });
  return AiRegistry.create({
    defaultModels: { generation: backend.registration.ref },
    invocationLimits: {
      operations: 1,
      modelRequests: 2,
      toolCalls: 3,
      recordedReads: 0,
      deadlineMs: 30_000,
      totalInputBytes: 64_000,
      totalOutputBytes: 64_000,
      maxRecoveryBytes: 256_000,
    },
    concurrentOperations: 1,
    queuedOperations: 0,
  }).register(backend.registration);
}

describe("release notes through BlackBox", () => {
  it("rejects an unaccepted Request after its ignored Cancel advances Version", async () => {
    const context = await ReleaseNotesContext.create(registry(), new InMemoryStorageFactory());
    const box = await BlackBox.from(context, { timeoutMs: 5_000 });
    const scope = box.asGuest();
    try {
      expect(
        (
          await scope.post(
            OpenReleaseDraftSchema,
            create(OpenReleaseDraftSchema, {
              id,
              title: create(ReleaseTitleSchema, { value: "October release" }),
              comparison,
              audience: "SDK users",
            }),
          )
        ).kind,
      ).toBe("ok");
      await box.eventually(
        () => box.assertEvents(),
        (events) => events.length === 1,
      );
      const generation = create(ReleaseGenerationIdSchema, { value: "retained-before-cancel" });
      const request = create(RequestReleaseGenerationSchema, {
        id,
        generation,
        expectedVersion: await currentVersion(context),
        catalog: create(ReleaseEvidenceCatalogSchema),
        instruction: create(ReleaseInstructionSchema, { value: "Draft notes" }),
        conversation: create(ConversationIdSchema, { value: "release-1-conversation" }),
        selection: create(ReleaseModelSelectionSchema, {
          registration: "account-registration-1",
          account: "account-1",
          model: ModelRef.of("release-scripted", "v1"),
        }),
      });
      expect(
        (
          await scope.post(
            CancelReleaseGenerationSchema,
            create(CancelReleaseGenerationSchema, { id, generation }),
          )
        ).kind,
      ).toBe("ok");
      await box.eventually(
        () =>
          box
            .assertEvents()
            .filter(
              (event) =>
                event.message &&
                AnyMessages.unpack(event.message, ReleaseGenerationCancelIgnoredSchema),
            ),
        (events) => events.length === 1,
      );
      const topic = create(TopicSchema, {
        id: create(TopicIdSchema, { value: randomUUID() }),
        target: create(TargetSchema, {
          type: TypeUrls.derive(ReleaseGenerationInputsConflictSchema),
          criterion: { case: "includeAll", value: true },
        }),
        context: new SignalMetadata().actorContext({
          actor: create(UserIdSchema, { value: "guest" }),
        }),
      });
      const subscription = await scope.createSubscription(topic, { kind: "event" });
      try {
        await subscription.activate();
        const delivery = subscription.updates[Symbol.asyncIterator]().next();
        expect((await scope.post(RequestReleaseGenerationSchema, request)).kind).toBe("ok");
        const result = await delivery;
        expect(result.done).toBe(false);
      } finally {
        await subscription.cancel();
      }
      const retained = await context.stand().read(ReleaseDraftStateSchema, id);
      expect(retained?.receipts).toHaveLength(0);
      expect(
        box
          .assertEvents()
          .filter(
            (event) =>
              event.message && AnyMessages.unpack(event.message, ReleaseGenerationRequestedSchema),
          ),
      ).toHaveLength(0);
    } finally {
      await box.close();
    }
  });

  it("assembles a registered Agent repository for trusted history and execution reads", async () => {
    const context = await ReleaseNotesContext.create(registry(), new InMemoryStorageFactory());
    try {
      const agentRepository = context.getRepository(ReleaseNotesAgent);
      const history = await agentRepository.agentHistory(id, {}).fullHistory({ pageSize: 1 });
      expect(history.items).toEqual([]);
      expect(
        await agentRepository.agentExecution(
          id,
          create(EventIdSchema, { value: "unseen-event" }),
          {},
        ),
      ).toBeUndefined();
    } finally {
      await context.close();
    }
  });
  it("rejects duplicate opening without replacing the repository or accepted generation receipt", async () => {
    const context = await ReleaseNotesContext.create(registry(), new InMemoryStorageFactory());
    const box = await BlackBox.from(context, { timeoutMs: 5_000 });
    const scope = box.asGuest();
    try {
      expect(
        (
          await scope.post(
            OpenReleaseDraftSchema,
            create(OpenReleaseDraftSchema, {
              id,
              title: create(ReleaseTitleSchema, { value: "October release" }),
              comparison,
              audience: "SDK users",
            }),
          )
        ).kind,
      ).toBe("ok");
      await box.eventually(
        () => box.assertEvents(),
        (events) => events.length === 1,
      );
      const command = create(RequestReleaseGenerationSchema, {
        id,
        generation: create(ReleaseGenerationIdSchema, { value: "retained-generation" }),
        expectedVersion: await currentVersion(context),
        catalog: create(ReleaseEvidenceCatalogSchema),
        instruction: create(ReleaseInstructionSchema, { value: "Draft notes" }),
        conversation: create(ConversationIdSchema, { value: "release-1-conversation" }),
        selection: create(ReleaseModelSelectionSchema, {
          registration: "account-registration-1",
          account: "account-1",
          model: ModelRef.of("release-scripted", "v1"),
        }),
      });
      expect((await scope.post(RequestReleaseGenerationSchema, command)).kind).toBe("ok");
      await box.eventually(
        () =>
          box
            .assertEvents()
            .filter(
              (event) =>
                event.message &&
                AnyMessages.unpack(event.message, ReleaseGenerationRequestedSchema),
            ),
        (events) => events.length === 1,
      );
      const otherComparison = create(ReleaseComparisonSchema, {
        ...comparison,
        repository: create(RepositorySelectionIdSchema, { value: "another-repository" }),
      });
      expect(
        (
          await scope.post(
            OpenReleaseDraftSchema,
            create(OpenReleaseDraftSchema, {
              id,
              title: create(ReleaseTitleSchema, { value: "Hijacked release" }),
              comparison: otherComparison,
              audience: "Other readers",
            }),
          )
        ).kind,
      ).toBe("ok");
      expect((await scope.post(RequestReleaseGenerationSchema, command)).kind).toBe("ok");
      await box.eventually(
        () =>
          box
            .assertEvents()
            .filter(
              (event) =>
                event.message &&
                AnyMessages.unpack(event.message, ReleaseGenerationAlreadyRequestedSchema),
            ),
        (events) => events.length === 1,
      );
      const retained = await context.stand().read(ReleaseDraftStateSchema, id);
      expect(retained?.comparison?.repository).toEqual(comparison.repository);
      expect(retained?.title?.value).toBe("October release");
      expect(retained?.receipts).toHaveLength(1);
      expect(
        box
          .assertEvents()
          .filter(
            (event) =>
              event.message && AnyMessages.unpack(event.message, ReleaseGenerationRequestedSchema),
          ),
      ).toHaveLength(1);
    } finally {
      await box.close();
    }
  });

  it("opens a draft and projects its authoritative initial state", async () => {
    const context = await ReleaseNotesContext.create(registry(), new InMemoryStorageFactory());
    const box = await BlackBox.from(context, { timeoutMs: 5_000 });
    try {
      const posted = await box.asGuest().post(
        OpenReleaseDraftSchema,
        create(OpenReleaseDraftSchema, {
          id,
          title: create(ReleaseTitleSchema, { value: "October release" }),
          comparison,
          audience: "SDK users",
        }),
      );
      expect(posted.kind).toBe("ok");
      const opened = await box.eventually(
        () =>
          box.assertEvents().flatMap((event) => {
            const value =
              event.message && AnyMessages.unpack(event.message, ReleaseDraftOpenedSchema);
            return value ? [value] : [];
          }),
        (events) => events.length === 1,
      );
      expect(opened[0]?.id).toEqual(id);
      expect((await currentVersion(context)).number).toBeGreaterThan(0);
      const query = ReleaseDraftViewQuery.create().byId(id).build().build();
      query.id = create(QueryIdSchema, { value: "release-view" });
      query.context = create(ActorContextSchema);
      const view = await box.eventually(
        async () =>
          (await box.asGuest().send(query)).message.flatMap(({ state }) => {
            const value = state && AnyMessages.unpack(state, ReleaseDraftViewSchema);
            return value ? [value] : [];
          }),
        (rows) => rows.length === 1,
      );
      expect(view[0]?.comparison).toEqual(comparison);
      expect(view[0]?.title?.value).toBe("October release");
    } finally {
      await box.close();
    }
  });
});
