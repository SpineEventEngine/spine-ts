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
import { AiRegistry, ModelRef } from "@spine-event-engine/ai";
import { AnyMessages, SignalEnvelopes } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  EventContextSchema,
  EventIdSchema,
  VersionSchema,
} from "@spine-event-engine/proto";
import { QueryIdSchema } from "@spine-event-engine/proto/client";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { AiTestBackend, BlackBox } from "@spine-event-engine/testing";
import { SignalMetadata, type BoundedContext } from "@spine-event-engine/server";
import { describe, expect, it } from "vitest";

import {
  ApproveReleaseNotesSchema,
  ChangeReleaseInputsSchema,
  EditReleaseNotesSchema,
  OpenReleaseDraftSchema,
  PrepareReleaseNotesExportSchema,
  RequestReleaseGenerationSchema,
} from "../generated/spine/examples/releasenotes/commands_pb.js";
import {
  ReleaseDraftOpenedSchema,
  ReleaseGenerationAlreadyRequestedSchema,
  ReleaseGenerationFailedSchema,
  ReleaseGenerationRequestedSchema,
  ReleaseGenerationStatusChangedSchema,
  ReleaseInputsChangedSchema,
  ReleaseNotesApprovedSchema,
  ReleaseNotesExportPreparedSchema,
  ReleaseNotesEditedSchema,
  ReleaseNotesProposedSchema,
  ReleaseNotesStagedSchema,
  ReleaseProposalDiscardedSchema,
} from "../generated/spine/examples/releasenotes/events_pb.js";
import {
  ReleaseDraftStateSchema,
  ReleaseDraftViewSchema,
} from "../generated/spine/examples/releasenotes/states_pb.js";
import { ReleaseDraftViewQuery } from "../generated/spine/examples/releasenotes/states_query.js";
import {
  GitCommitIdSchema,
  ReleaseComparisonPolicy,
  ReleaseComparisonSchema,
  ReleaseCommitSchema,
  ReleaseChangeSchema,
  ReleaseDraftIdSchema,
  ReleaseEvidenceCatalogSchema,
  ReleaseEvidenceReferenceSchema,
  ReleaseEvidenceSchema,
  ReleaseGenerationIdSchema,
  ReleaseInstructionSchema,
  ReleaseModelSelectionSchema,
  ReleaseNoteEntrySchema,
  ReleaseNotesDocumentSchema,
  ReleaseNotesSectionSchema,
  ReleaseTitleSchema,
  RepositorySelectionIdSchema,
} from "../generated/spine/examples/releasenotes/types_pb.js";
import { AiOperationIdSchema, ConversationIdSchema } from "@spine-event-engine/proto/agent";
import { ReleaseNotesAgent, ReleaseNotesContext } from "../dist/src/domain/index.js";
import { ReleaseMarkdown } from "../dist/src/domain/markdown.js";
import { createHash } from "node:crypto";

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

  it("invalidates a pending proposal when inputs change and exports only exact approved bytes", async () => {
    const context = await ReleaseNotesContext.create(registry(), new InMemoryStorageFactory());
    const box = await BlackBox.from(context, { timeoutMs: 5_000 });
    const scope = box.asGuest();
    const generation = create(ReleaseGenerationIdSchema, { value: "pending-before-input-change" });
    const evidencePath = 'dir/a<&>"\n.md';
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
      const openedVersion = await currentVersion(context);
      expect(
        (
          await scope.post(
            RequestReleaseGenerationSchema,
            create(RequestReleaseGenerationSchema, {
              id,
              generation,
              expectedVersion: openedVersion,
              catalog: create(ReleaseEvidenceCatalogSchema),
              instruction: create(ReleaseInstructionSchema, { value: "Draft notes" }),
              conversation: create(ConversationIdSchema, { value: "release-1-conversation" }),
              selection: create(ReleaseModelSelectionSchema, {
                registration: "account-registration-1",
                account: "account-1",
                model: ModelRef.of("release-scripted", "v1"),
              }),
            }),
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
                AnyMessages.unpack(event.message, ReleaseGenerationRequestedSchema),
            ),
        (events) => events.length === 1,
      );
      const pendingVersion = await currentVersion(context);
      expect(
        (
          await scope.post(
            ChangeReleaseInputsSchema,
            create(ChangeReleaseInputsSchema, {
              id,
              expectedVersion: pendingVersion,
              comparison,
              audience: "Maintainers",
            }),
          )
        ).kind,
      ).toBe("ok");
      const changed = await box.eventually(
        () =>
          box.assertEvents().flatMap((event) => {
            const value =
              event.message && AnyMessages.unpack(event.message, ReleaseInputsChangedSchema);
            return value ? [value] : [];
          }),
        (events) => events.length === 1,
      );
      expect(changed[0]?.audience).toBe("Maintainers");
      const changedAt = new SignalMetadata().timestamp();
      await context.eventBus().post(
        SignalEnvelopes.event({
          context: create(EventContextSchema, {
            timestamp: changedAt,
            producerId: AnyMessages.pack(ReleaseDraftIdSchema, id),
            version: create(VersionSchema, { number: 2, timestamp: changedAt }),
          }),
          schema: ReleaseNotesProposedSchema,
          message: create(ReleaseNotesProposedSchema, {
            id,
            generation,
            inputVersion: openedVersion,
            document: create(ReleaseNotesDocumentSchema, {
              sections: [
                create(ReleaseNotesSectionSchema, {
                  heading: "Stale output",
                  entries: [create(ReleaseNoteEntrySchema, { text: "Do not stage this." })],
                }),
              ],
            }),
            operation: create(AiOperationIdSchema, { value: "late-after-input-change" }),
          }),
        }),
      );
      await box.eventually(
        () =>
          box
            .assertEvents()
            .filter(
              (event) =>
                event.message && AnyMessages.unpack(event.message, ReleaseProposalDiscardedSchema),
            ),
        (events) => events.length === 1,
      );
      const afterInputChange = await context.stand().read(ReleaseDraftStateSchema, id);
      expect(afterInputChange?.pendingGeneration).toBeUndefined();
      expect(afterInputChange?.document?.sections).toEqual([]);
      const changedVersion = await currentVersion(context);
      const document = create(ReleaseNotesDocumentSchema, {
        sections: [
          create(ReleaseNotesSectionSchema, {
            heading: "Changes",
            entries: [
              create(ReleaseNoteEntrySchema, {
                text: "Faster queries.",
                evidence: [
                  create(ReleaseEvidenceReferenceSchema, {
                    commit: comparison.target,
                    parent: comparison.base,
                    path: evidencePath,
                  }),
                ],
              }),
            ],
          }),
        ],
      });
      expect(
        (
          await scope.post(
            EditReleaseNotesSchema,
            create(EditReleaseNotesSchema, {
              id,
              expectedVersion: changedVersion,
              document,
            }),
          )
        ).kind,
      ).toBe("ok");
      await box.eventually(
        () =>
          box
            .assertEvents()
            .filter(
              (event) =>
                event.message && AnyMessages.unpack(event.message, ReleaseNotesEditedSchema),
            ),
        (events) => events.length === 1,
      );
      const editedVersion = await currentVersion(context);
      const pendingApproval = create(ReleaseGenerationIdSchema, {
        value: "pending-before-approval",
      });
      expect(
        (
          await scope.post(
            RequestReleaseGenerationSchema,
            create(RequestReleaseGenerationSchema, {
              id,
              generation: pendingApproval,
              expectedVersion: editedVersion,
              catalog: create(ReleaseEvidenceCatalogSchema),
              instruction: create(ReleaseInstructionSchema, { value: "Recheck edited notes" }),
              conversation: create(ConversationIdSchema, { value: "release-1-conversation" }),
              selection: create(ReleaseModelSelectionSchema, {
                registration: "account-registration-1",
                account: "account-1",
                model: ModelRef.of("release-scripted", "v1"),
              }),
            }),
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
                AnyMessages.unpack(event.message, ReleaseGenerationRequestedSchema),
            ),
        (events) => events.length === 2,
      );
      const pendingApprovalVersion = await currentVersion(context);
      const markdown = new TextEncoder().encode(
        `# October release\n\n## Changes\n\n- Faster queries.\n  - Evidence: <code>commit=${"b".repeat(40)} parent=${"a".repeat(40)} path=&quot;dir/a&lt;&amp;&gt;\\&quot;\\n.md&quot;</code>\n`,
      );
      const digest = createHash("sha256").update(markdown).digest("hex");
      expect(
        (
          await scope.post(
            ApproveReleaseNotesSchema,
            create(ApproveReleaseNotesSchema, {
              id,
              expectedVersion: pendingApprovalVersion,
              markdown,
              digest,
            }),
          )
        ).kind,
      ).toBe("ok");
      const approved = await box.eventually(
        () =>
          box.assertEvents().flatMap((event) => {
            const value =
              event.message && AnyMessages.unpack(event.message, ReleaseNotesApprovedSchema);
            return value ? [value] : [];
          }),
        (events) => events.length === 1,
      );
      expect(approved[0]?.approval?.markdown).toEqual(markdown);
      expect(approved[0]?.approval?.reviewedVersion).toEqual(pendingApprovalVersion);
      const approvedVersion = await currentVersion(context);
      const approvedAt = new SignalMetadata().timestamp();
      await context.eventBus().post(
        SignalEnvelopes.event({
          context: create(EventContextSchema, {
            timestamp: approvedAt,
            producerId: AnyMessages.pack(ReleaseDraftIdSchema, id),
            version: create(VersionSchema, { number: 2, timestamp: approvedAt }),
          }),
          schema: ReleaseNotesProposedSchema,
          message: create(ReleaseNotesProposedSchema, {
            id,
            generation: pendingApproval,
            inputVersion: editedVersion,
            document,
            operation: create(AiOperationIdSchema, { value: "late-operation" }),
          }),
        }),
      );
      await box.eventually(
        () =>
          box
            .assertEvents()
            .filter(
              (event) =>
                event.message && AnyMessages.unpack(event.message, ReleaseProposalDiscardedSchema),
            ),
        (events) => events.length === 2,
      );
      expect((await context.stand().read(ReleaseDraftStateSchema, id))?.approval?.markdown).toEqual(
        markdown,
      );
      const afterDiscardVersion = await currentVersion(context);
      expect(
        (
          await scope.post(
            PrepareReleaseNotesExportSchema,
            create(PrepareReleaseNotesExportSchema, {
              id,
              expectedVersion: afterDiscardVersion,
            }),
          )
        ).kind,
      ).toBe("ok");
      const prepared = await box.eventually(
        () =>
          box.assertEvents().flatMap((event) => {
            const value =
              event.message && AnyMessages.unpack(event.message, ReleaseNotesExportPreparedSchema);
            return value ? [value] : [];
          }),
        (events) => events.length === 1,
      );
      expect(prepared[0]?.approval).toEqual(approved[0]?.approval);
      const preparedVersion = await currentVersion(context);
      expect(
        (
          await scope.post(
            EditReleaseNotesSchema,
            create(EditReleaseNotesSchema, {
              id,
              expectedVersion: preparedVersion,
              document,
            }),
          )
        ).kind,
      ).toBe("ok");
      await box.eventually(
        () =>
          box
            .assertEvents()
            .filter(
              (event) =>
                event.message && AnyMessages.unpack(event.message, ReleaseNotesEditedSchema),
            ),
        (events) => events.length === 2,
      );
      const laterVersion = await currentVersion(context);
      expect(
        (
          await scope.post(
            PrepareReleaseNotesExportSchema,
            create(PrepareReleaseNotesExportSchema, {
              id,
              expectedVersion: approvedVersion,
            }),
          )
        ).kind,
      ).toBe("ok");
      expect(
        (
          await scope.post(
            ApproveReleaseNotesSchema,
            create(ApproveReleaseNotesSchema, {
              id,
              expectedVersion: editedVersion,
              markdown,
              digest,
            }),
          )
        ).kind,
      ).toBe("ok");
      const replacement = create(ReleaseComparisonSchema, {
        ...comparison,
        target: create(GitCommitIdSchema, { value: "c".repeat(40) }),
      });
      expect(
        (
          await scope.post(
            ChangeReleaseInputsSchema,
            create(ChangeReleaseInputsSchema, {
              id,
              expectedVersion: laterVersion,
              comparison: replacement,
              audience: "Maintainers",
            }),
          )
        ).kind,
      ).toBe("ok");
      const replaced = await box.eventually(
        () =>
          box.assertEvents().flatMap((event) => {
            const value =
              event.message && AnyMessages.unpack(event.message, ReleaseInputsChangedSchema);
            return value ? [value] : [];
          }),
        (events) => events.length === 2,
      );
      expect(replaced[1]?.document?.sections).toEqual([]);
      expect(
        box
          .assertEvents()
          .filter(
            (event) =>
              event.message && AnyMessages.unpack(event.message, ReleaseNotesApprovedSchema),
          ),
      ).toHaveLength(1);
      expect(
        box
          .assertEvents()
          .filter(
            (event) =>
              event.message && AnyMessages.unpack(event.message, ReleaseNotesExportPreparedSchema),
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

  it("publishes a complete accepted snapshot once per generation ID, even after another request", async () => {
    const context = await ReleaseNotesContext.create(registry(), new InMemoryStorageFactory());
    const box = await BlackBox.from(context, { timeoutMs: 5_000 });
    const scope = box.asGuest();
    try {
      const baseCommit = comparison.base;
      const targetCommit = comparison.target;
      if (!baseCommit || !targetCommit) throw new Error("Missing comparison fixture commits.");
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
      const inputVersion = await currentVersion(context);
      const command = create(RequestReleaseGenerationSchema, {
        id,
        generation: create(ReleaseGenerationIdSchema, { value: "generation-1" }),
        expectedVersion: inputVersion,
        catalog: create(ReleaseEvidenceCatalogSchema, {
          commits: [
            create(ReleaseCommitSchema, {
              id: targetCommit,
              parents: [baseCommit],
              subject: "Add release notes",
            }),
          ],
          changes: [create(ReleaseChangeSchema, { path: "release.md", status: "M" })],
          evidence: [
            create(ReleaseEvidenceSchema, {
              commit: targetCommit,
              parent: baseCommit,
              path: "release.md",
              status: "M",
            }),
          ],
        }),
        instruction: create(ReleaseInstructionSchema, { value: "Explain SDK changes" }),
        conversation: create(ConversationIdSchema, { value: "release-1-conversation" }),
        selection: create(ReleaseModelSelectionSchema, {
          registration: "account-registration-1",
          account: "account-1",
          model: ModelRef.of("release-scripted", "v1"),
        }),
      });
      const firstPost = await scope.post(RequestReleaseGenerationSchema, command);
      expect(firstPost.kind).toBe("ok");
      const requested = () =>
        box.assertEvents().flatMap((event) => {
          const value =
            event.message && AnyMessages.unpack(event.message, ReleaseGenerationRequestedSchema);
          return value ? [value] : [];
        });
      const first = await box.eventually(requested, (events) => events.length === 1);
      expect(first[0]).toMatchObject({
        generation: command.generation,
        inputVersion,
        comparison,
        audience: "SDK users",
        instruction: command.instruction,
        conversation: command.conversation,
        selection: command.selection,
        title: create(ReleaseTitleSchema, { value: "October release" }),
      });
      expect(first[0]?.inputDigest).toMatch(/^[a-f0-9]{64}$/);
      const next = create(RequestReleaseGenerationSchema, {
        ...command,
        generation: create(ReleaseGenerationIdSchema, { value: "generation-2" }),
        expectedVersion: await currentVersion(context),
      });
      expect((await scope.post(RequestReleaseGenerationSchema, next)).kind).toBe("ok");
      await box.eventually(requested, (events) => events.length === 2);
      const latestQuery = ReleaseDraftViewQuery.create().byId(id).build().build();
      latestQuery.id = create(QueryIdSchema, { value: "latest-generation-view" });
      latestQuery.context = create(ActorContextSchema);
      const latest = await box.eventually(
        async () =>
          (await scope.send(latestQuery)).message.flatMap(({ state }) => {
            const value = state && AnyMessages.unpack(state, ReleaseDraftViewSchema);
            return value ? [value] : [];
          }),
        (rows) => rows[0]?.generation?.value === "generation-2",
      );
      expect(latest[0]?.generationStatus).toBe("requested");
      expect((await scope.post(RequestReleaseGenerationSchema, command)).kind).toBe("ok");
      const ack = await box.eventually(
        () =>
          box.assertEvents().flatMap((event) => {
            const value =
              event.message &&
              AnyMessages.unpack(event.message, ReleaseGenerationAlreadyRequestedSchema);
            return value ? [value] : [];
          }),
        (events) => events.length === 1,
      );
      expect(ack[0]?.inputDigest).toBe(first[0]?.inputDigest);
      expect(requested()).toHaveLength(2);
      expect(
        (
          await scope.post(
            RequestReleaseGenerationSchema,
            create(RequestReleaseGenerationSchema, {
              ...command,
              expectedVersion: await currentVersion(context),
            }),
          )
        ).kind,
      ).toBe("ok");
      expect(requested()).toHaveLength(2);
      expect(
        (
          await scope.post(
            RequestReleaseGenerationSchema,
            create(RequestReleaseGenerationSchema, {
              ...command,
              instruction: create(ReleaseInstructionSchema, { value: "Different content" }),
            }),
          )
        ).kind,
      ).toBe("ok");
      const latestVersion = await currentVersion(context);
      expect(
        (
          await scope.post(
            RequestReleaseGenerationSchema,
            create(RequestReleaseGenerationSchema, {
              ...command,
              generation: create(ReleaseGenerationIdSchema, { value: "generation-3" }),
              expectedVersion: latestVersion,
            }),
          )
        ).kind,
      ).toBe("ok");
      const afterConflict = await box.eventually(requested, (events) => events.length >= 3);
      expect(afterConflict.map((event) => event.generation?.value)).toEqual([
        "generation-1",
        "generation-2",
        "generation-3",
      ]);
      const currentView = await box.eventually(
        async () =>
          (await scope.send(latestQuery)).message.flatMap(({ state }) => {
            const value = state && AnyMessages.unpack(state, ReleaseDraftViewSchema);
            return value ? [value] : [];
          }),
        (rows) => rows[0]?.generation?.value === "generation-3",
      );
      expect(currentView[0]?.generationStatus).toBe("requested");
      const timestamp = new SignalMetadata().timestamp();
      await context.eventBus().post(
        SignalEnvelopes.event({
          context: create(EventContextSchema, {
            timestamp,
            producerId: AnyMessages.pack(ReleaseDraftIdSchema, id),
            version: create(VersionSchema, { number: 1, timestamp }),
          }),
          schema: ReleaseGenerationFailedSchema,
          message: create(ReleaseGenerationFailedSchema, {
            id,
            generation: command.generation,
            inputVersion,
            reason: "UNAVAILABLE",
            operation: create(AiOperationIdSchema, { value: "old-operation" }),
          }),
        }),
      );
      const latestState = await context.stand().read(ReleaseDraftStateSchema, id);
      expect(latestState?.pendingGeneration?.value).toBe("generation-3");
      expect(latestState?.generationStatus).toBe("requested");
      if (!latestState?.title || !latestState.document) throw new Error("Draft snapshot missing.");
      const markdown = ReleaseMarkdown.render(latestState.title, latestState.document);
      const beforeApproval = await currentVersion(context);
      expect(
        (
          await scope.post(
            ApproveReleaseNotesSchema,
            create(ApproveReleaseNotesSchema, {
              id,
              expectedVersion: beforeApproval,
              markdown,
              digest: ReleaseMarkdown.digest(markdown),
            }),
          )
        ).kind,
      ).toBe("ok");
      await box.eventually(
        () =>
          box
            .assertEvents()
            .filter(
              (event) =>
                event.message && AnyMessages.unpack(event.message, ReleaseNotesApprovedSchema),
            ),
        (events) => events.length === 1,
      );
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
        (events) => events.length === 2,
      );
      const afterAck = await context.stand().readVersioned(ReleaseDraftStateSchema, id);
      expect(afterAck?.state.approval?.markdown).toEqual(markdown);
      if (!afterAck?.version) throw new Error("Acknowledged draft has no Entity Version.");
      expect(
        (
          await scope.post(
            PrepareReleaseNotesExportSchema,
            create(PrepareReleaseNotesExportSchema, { id, expectedVersion: afterAck.version }),
          )
        ).kind,
      ).toBe("ok");
      const prepared = await box.eventually(
        () =>
          box.assertEvents().flatMap((event) => {
            const value =
              event.message && AnyMessages.unpack(event.message, ReleaseNotesExportPreparedSchema);
            return value ? [value] : [];
          }),
        (events) => events.length === 1,
      );
      expect(prepared[0]?.approval?.markdown).toEqual(markdown);
    } finally {
      await box.close();
    }
  });

  it("discards an older model proposal after a manual edit without changing the edited document", async () => {
    const context = await ReleaseNotesContext.create(registry(), new InMemoryStorageFactory());
    const box = await BlackBox.from(context, { timeoutMs: 5_000 });
    const scope = box.asGuest();
    const generation = create(ReleaseGenerationIdSchema, { value: "generation-before-edit" });
    const edited = create(ReleaseNotesDocumentSchema, {
      sections: [
        create(ReleaseNotesSectionSchema, {
          heading: "Editor changes",
          entries: [create(ReleaseNoteEntrySchema, { text: "Manually reviewed note." })],
        }),
      ],
    });
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
      const originalVersion = await currentVersion(context);
      expect(
        (
          await scope.post(
            RequestReleaseGenerationSchema,
            create(RequestReleaseGenerationSchema, {
              id,
              generation,
              expectedVersion: originalVersion,
              catalog: create(ReleaseEvidenceCatalogSchema),
              instruction: create(ReleaseInstructionSchema, { value: "Draft notes" }),
              conversation: create(ConversationIdSchema, { value: "release-1-conversation" }),
              selection: create(ReleaseModelSelectionSchema, {
                registration: "account-registration-1",
                account: "account-1",
                model: ModelRef.of("release-scripted", "v1"),
              }),
            }),
          )
        ).kind,
      ).toBe("ok");
      await box.eventually(
        () => box.assertEvents(),
        (events) => events.length === 2,
      );
      const acceptedVersion = await currentVersion(context);
      expect(
        (
          await scope.post(
            EditReleaseNotesSchema,
            create(EditReleaseNotesSchema, {
              id,
              expectedVersion: acceptedVersion,
              document: edited,
            }),
          )
        ).kind,
      ).toBe("ok");
      await box.eventually(
        () => box.assertEvents(),
        (events) => events.length === 3,
      );
      const timestamp = new SignalMetadata().timestamp();
      await context.eventBus().post(
        SignalEnvelopes.event({
          context: create(EventContextSchema, {
            timestamp,
            producerId: AnyMessages.pack(ReleaseDraftIdSchema, id),
            version: create(VersionSchema, { number: 1, timestamp }),
          }),
          schema: ReleaseNotesProposedSchema,
          message: create(ReleaseNotesProposedSchema, {
            id,
            generation,
            inputVersion: originalVersion,
            document: create(ReleaseNotesDocumentSchema, {
              sections: [
                create(ReleaseNotesSectionSchema, {
                  heading: "Stale model output",
                  entries: [create(ReleaseNoteEntrySchema, { text: "Must not replace edit." })],
                }),
              ],
            }),
            operation: create(AiOperationIdSchema, { value: "operation-1" }),
          }),
        }),
      );
      const discarded = await box.eventually(
        () =>
          box.assertEvents().flatMap((event) => {
            const value =
              event.message && AnyMessages.unpack(event.message, ReleaseProposalDiscardedSchema);
            return value ? [value] : [];
          }),
        (events) => events.length === 1,
      );
      expect(discarded[0]?.generation).toEqual(generation);
      const query = ReleaseDraftViewQuery.create().byId(id).build().build();
      query.id = create(QueryIdSchema, { value: "edited-view" });
      query.context = create(ActorContextSchema);
      const view = await box.eventually(
        async () =>
          (await scope.send(query)).message.flatMap(({ state }) => {
            const value = state && AnyMessages.unpack(state, ReleaseDraftViewSchema);
            return value ? [value] : [];
          }),
        (rows) => rows[0]?.document?.sections[0]?.heading === "Editor changes",
      );
      expect(view[0]?.document).toEqual(edited);
    } finally {
      await box.close();
    }
  });

  it("records the latest safe generation failure without replacing the editor document", async () => {
    const context = await ReleaseNotesContext.create(registry(), new InMemoryStorageFactory());
    const box = await BlackBox.from(context, { timeoutMs: 5_000 });
    const scope = box.asGuest();
    const generation = create(ReleaseGenerationIdSchema, { value: "failed-generation" });
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
      const originalVersion = await currentVersion(context);
      expect(
        (
          await scope.post(
            RequestReleaseGenerationSchema,
            create(RequestReleaseGenerationSchema, {
              id,
              generation,
              expectedVersion: originalVersion,
              catalog: create(ReleaseEvidenceCatalogSchema),
              instruction: create(ReleaseInstructionSchema, { value: "Draft notes" }),
              conversation: create(ConversationIdSchema, { value: "release-1-conversation" }),
              selection: create(ReleaseModelSelectionSchema, {
                registration: "account-registration-1",
                account: "account-1",
                model: ModelRef.of("release-scripted", "v1"),
              }),
            }),
          )
        ).kind,
      ).toBe("ok");
      await box.eventually(
        () => box.assertEvents(),
        (events) => events.length === 2,
      );
      const repeated = create(RequestReleaseGenerationSchema, {
        id,
        generation,
        expectedVersion: originalVersion,
        catalog: create(ReleaseEvidenceCatalogSchema),
        instruction: create(ReleaseInstructionSchema, { value: "Draft notes" }),
        conversation: create(ConversationIdSchema, { value: "release-1-conversation" }),
        selection: create(ReleaseModelSelectionSchema, {
          registration: "account-registration-1",
          account: "account-1",
          model: ModelRef.of("release-scripted", "v1"),
        }),
      });
      expect((await scope.post(RequestReleaseGenerationSchema, repeated)).kind).toBe("ok");
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
      expect((await currentVersion(context)).number).toBeGreaterThan(originalVersion.number);
      const timestamp = new SignalMetadata().timestamp();
      await context.eventBus().post(
        SignalEnvelopes.event({
          context: create(EventContextSchema, {
            timestamp,
            producerId: AnyMessages.pack(ReleaseDraftIdSchema, id),
            version: create(VersionSchema, { number: 1, timestamp }),
          }),
          schema: ReleaseGenerationFailedSchema,
          message: create(ReleaseGenerationFailedSchema, {
            id,
            generation,
            inputVersion: originalVersion,
            reason: "UNAVAILABLE",
            operation: create(AiOperationIdSchema, { value: "operation-2" }),
          }),
        }),
      );
      const failed = await box.eventually(
        () =>
          box.assertEvents().flatMap((event) => {
            const value =
              event.message &&
              AnyMessages.unpack(event.message, ReleaseGenerationStatusChangedSchema);
            return value ? [value] : [];
          }),
        (events) => events.length === 1,
      );
      expect(failed[0]?.reason).toBe("UNAVAILABLE");
      const query = ReleaseDraftViewQuery.create().byId(id).build().build();
      query.id = create(QueryIdSchema, { value: "failed-view" });
      query.context = create(ActorContextSchema);
      const view = await box.eventually(
        async () =>
          (await scope.send(query)).message.flatMap(({ state }) => {
            const value = state && AnyMessages.unpack(state, ReleaseDraftViewSchema);
            return value ? [value] : [];
          }),
        (rows) => rows[0]?.generationStatus === "failed:UNAVAILABLE",
      );
      expect((await currentVersion(context)).number).toBeGreaterThan(originalVersion.number);
      expect(view[0]?.document?.sections).toEqual([]);
    } finally {
      await box.close();
    }
  });

  it("stages a proposal against the accepted input Version after an acknowledgement", async () => {
    const context = await ReleaseNotesContext.create(registry(), new InMemoryStorageFactory());
    const box = await BlackBox.from(context, { timeoutMs: 5_000 });
    const scope = box.asGuest();
    const generation = create(ReleaseGenerationIdSchema, { value: "acknowledged-generation" });
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
      const inputVersion = await currentVersion(context);
      const command = create(RequestReleaseGenerationSchema, {
        id,
        generation,
        expectedVersion: inputVersion,
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
      const document = create(ReleaseNotesDocumentSchema, {
        sections: [
          create(ReleaseNotesSectionSchema, {
            heading: "Changes",
            entries: [create(ReleaseNoteEntrySchema, { text: "Reviewed change." })],
          }),
        ],
      });
      const timestamp = new SignalMetadata().timestamp();
      await context.eventBus().post(
        SignalEnvelopes.event({
          context: create(EventContextSchema, {
            timestamp,
            producerId: AnyMessages.pack(ReleaseDraftIdSchema, id),
            version: create(VersionSchema, { number: 1, timestamp }),
          }),
          schema: ReleaseNotesProposedSchema,
          message: create(ReleaseNotesProposedSchema, {
            id,
            generation,
            inputVersion,
            document,
            operation: create(AiOperationIdSchema, { value: "proposal-after-ack" }),
          }),
        }),
      );
      const staged = await box.eventually(
        () =>
          box.assertEvents().flatMap((event) => {
            const value =
              event.message && AnyMessages.unpack(event.message, ReleaseNotesStagedSchema);
            return value ? [value] : [];
          }),
        (events) => events.length === 1,
      );
      expect(staged[0]?.document).toEqual(document);
      expect(
        (await context.stand().read(ReleaseDraftStateSchema, id))?.pendingGeneration,
      ).toBeUndefined();
    } finally {
      await box.close();
    }
  });
});
