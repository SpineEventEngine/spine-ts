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
import { AnyMessages, SignalEnvelopes, TypeUrls, Validate } from "@spine-event-engine/core";
import { EventContextSchema, UserIdSchema, VersionSchema } from "@spine-event-engine/proto";
import { TargetSchema, TopicIdSchema, TopicSchema } from "@spine-event-engine/proto/client";
import { SignalMetadata } from "@spine-event-engine/server";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { AiTestBackend, BlackBox } from "@spine-event-engine/testing";
import { expect, test } from "vitest";
import {
  CancelReleaseGenerationSchema,
  ChangeReleaseInputsSchema,
  EditReleaseNotesSchema,
  OpenReleaseDraftSchema,
  PrepareReleaseNotesExportSchema,
  RequestReleaseGenerationSchema,
} from "../generated/spine/examples/releasenotes/commands_pb.js";
import {
  ReleaseGenerationRequestedSchema,
  ReleaseNotesEditedSchema,
  ReleaseNotesExportPreparedSchema,
  ReleaseNotesProposedSchema,
  ReleaseProposalDiscardedSchema,
} from "../generated/spine/examples/releasenotes/events_pb.js";
import {
  ReleaseExportUnavailableSchema,
  ReleaseInputsConflictSchema,
} from "../generated/spine/examples/releasenotes/rejections_pb.js";
import { ReleaseDraftStateSchema } from "../generated/spine/examples/releasenotes/states_pb.js";
import {
  GitCommitIdSchema,
  ReleaseComparisonPolicy,
  ReleaseComparisonSchema,
  ReleaseDraftIdSchema,
  ReleaseEvidenceCatalogSchema,
  ReleaseGenerationIdSchema,
  ReleaseInstructionSchema,
  ReleaseMarkdownContentSchema,
  ReleaseModelSelectionSchema,
  ReleaseNoteEntrySchema,
  ReleaseNotesDocumentSchema,
  ReleaseNotesSectionSchema,
  ReleaseTitleSchema,
  RepositorySelectionIdSchema,
} from "../generated/spine/examples/releasenotes/types_pb.js";
import { AiOperationIdSchema, ConversationIdSchema } from "@spine-event-engine/proto/agent";
import { ReleaseNotesContext } from "../dist/src/domain/index.js";

const id = create(ReleaseDraftIdSchema, { value: "markdown-draft" });
const comparison = create(ReleaseComparisonSchema, {
  repository: create(RepositorySelectionIdSchema, { value: "selected-repository" }),
  base: create(GitCommitIdSchema, { value: "a".repeat(40) }),
  target: create(GitCommitIdSchema, { value: "b".repeat(40) }),
  policy: ReleaseComparisonPolicy.ANCESTOR_NET_TREE,
});
const encoder = new TextEncoder();

const contextForTest = async () => {
  const backend = AiTestBackend.create({
    ref: ModelRef.of("release-scripted", "v1"),
    kind: "generation",
  });
  const registry = AiRegistry.create({
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
  return ReleaseNotesContext.create(registry, new InMemoryStorageFactory());
};

test("authoritative Markdown preserves arbitrary exact bytes and export snapshots the current Version", async () => {
  const context = await contextForTest();
  const box = await BlackBox.from(context, { timeoutMs: 5_000 });
  const scope = box.asGuest();
  try {
    await scope.post(
      OpenReleaseDraftSchema,
      create(OpenReleaseDraftSchema, {
        id,
        title: create(ReleaseTitleSchema, { value: "Release" }),
        comparison,
        audience: "Customers",
      }),
    );
    await box.eventually(
      () => box.assertEvents(),
      (events) => events.length === 1,
    );
    const opened = await context.stand().readVersioned(ReleaseDraftStateSchema, id);
    expect(opened?.state.markdown?.utf8).toEqual(new Uint8Array());
    const markdown = encoder.encode("# Café 🐈\n\n```js\nconst x = 1;\n```\n\n  trailing  \n");
    await scope.post(
      EditReleaseNotesSchema,
      create(EditReleaseNotesSchema, {
        id,
        expectedVersion: opened?.version,
        markdown: create(ReleaseMarkdownContentSchema, { utf8: markdown }),
      }),
    );
    await box.eventually(
      async () => (await context.stand().read(ReleaseDraftStateSchema, id))?.markdown?.utf8,
      (bytes) => bytes?.length === markdown.length,
    );
    const edited = await context.stand().readVersioned(ReleaseDraftStateSchema, id);
    expect(edited?.state.markdown?.utf8).toEqual(markdown);
    expect(
      Validate.message(
        EditReleaseNotesSchema,
        create(EditReleaseNotesSchema, {
          id,
          expectedVersion: edited?.version,
          markdown: create(ReleaseMarkdownContentSchema),
        }),
      ).valid,
    ).toBe(true);
    expect(
      Validate.message(
        ReleaseNotesEditedSchema,
        create(ReleaseNotesEditedSchema, {
          id,
          markdown: create(ReleaseMarkdownContentSchema),
        }),
      ).valid,
    ).toBe(true);
    await scope.post(
      PrepareReleaseNotesExportSchema,
      create(PrepareReleaseNotesExportSchema, {
        id,
        expectedVersion: edited?.version,
      }),
    );
    const prepared = await box.eventually(
      () =>
        box.assertEvents().flatMap((event) => {
          const value =
            event.message && AnyMessages.unpack(event.message, ReleaseNotesExportPreparedSchema);
          return value ? [value] : [];
        }),
      (events) => events.length === 1,
    );
    expect(prepared[0]?.snapshot?.markdown).toEqual(markdown);
    expect(prepared[0]?.snapshot?.sourceVersion).toEqual(edited?.version);
    const staleExportTopic = create(TopicSchema, {
      id: create(TopicIdSchema, { value: randomUUID() }),
      target: create(TargetSchema, {
        type: TypeUrls.derive(ReleaseExportUnavailableSchema),
        criterion: { case: "includeAll", value: true },
      }),
      context: new SignalMetadata().actorContext({
        actor: create(UserIdSchema, { value: "guest" }),
      }),
    });
    const staleExport = await scope.createSubscription(staleExportTopic, { kind: "event" });
    await staleExport.activate();
    const rejectedExport = staleExport.updates[Symbol.asyncIterator]().next();
    expect(
      (
        await scope.post(
          PrepareReleaseNotesExportSchema,
          create(PrepareReleaseNotesExportSchema, {
            id,
            expectedVersion: opened?.version,
          }),
        )
      ).kind,
    ).toBe("ok");
    const exportDelivery = await rejectedExport;
    expect(exportDelivery.done).toBe(false);
    if (
      exportDelivery.done ||
      exportDelivery.value.kind !== "update" ||
      exportDelivery.value.update.update.case !== "eventUpdates"
    )
      throw new Error("Expected a stale export rejection event");
    expect(
      exportDelivery.value.update.update.value.event.flatMap((event) => {
        const rejected =
          event.message && AnyMessages.unpack(event.message, ReleaseExportUnavailableSchema);
        return rejected ? [rejected.id] : [];
      }),
    ).toEqual([id]);
    await staleExport.cancel();
    expect(
      box
        .assertEvents()
        .filter(
          (event) =>
            event.message && AnyMessages.unpack(event.message, ReleaseNotesExportPreparedSchema),
        ),
    ).toHaveLength(1);
    const afterExport = await context.stand().readVersioned(ReleaseDraftStateSchema, id);
    await scope.post(
      EditReleaseNotesSchema,
      create(EditReleaseNotesSchema, {
        id,
        expectedVersion: afterExport?.version,
        markdown: create(ReleaseMarkdownContentSchema),
      }),
    );
    await box.eventually(
      async () => (await context.stand().read(ReleaseDraftStateSchema, id))?.markdown?.utf8,
      (bytes) => bytes?.length === 0,
    );
    const emptied = await context.stand().readVersioned(ReleaseDraftStateSchema, id);
    expect(emptied?.state.markdown?.utf8).toEqual(new Uint8Array());
  } finally {
    await box.close();
  }
});

test("audience changes preserve edited notes while comparison changes invalidate them", async () => {
  const context = await contextForTest();
  const box = await BlackBox.from(context, { timeoutMs: 5_000 });
  const scope = box.asGuest();
  try {
    expect(
      (
        await scope.post(
          OpenReleaseDraftSchema,
          create(OpenReleaseDraftSchema, {
            id,
            title: create(ReleaseTitleSchema, { value: "Release" }),
            comparison,
            audience: "Customers",
          }),
        )
      ).kind,
    ).toBe("ok");
    const opened = await box.eventually(
      () => context.stand().readVersioned(ReleaseDraftStateSchema, id),
      (value) => value?.version?.number === 1,
    );
    const markdown = encoder.encode("# Reviewed release notes\n");
    expect(
      (
        await scope.post(
          EditReleaseNotesSchema,
          create(EditReleaseNotesSchema, {
            id,
            expectedVersion: opened?.version,
            markdown: create(ReleaseMarkdownContentSchema, { utf8: markdown }),
          }),
        )
      ).kind,
    ).toBe("ok");
    const edited = await box.eventually(
      () => context.stand().readVersioned(ReleaseDraftStateSchema, id),
      (value) => value?.version?.number === 2,
    );
    expect(
      (
        await scope.post(
          ChangeReleaseInputsSchema,
          create(ChangeReleaseInputsSchema, {
            id,
            expectedVersion: edited?.version,
            comparison,
            audience: "Operators",
          }),
        )
      ).kind,
    ).toBe("ok");
    const audienceChanged = await box.eventually(
      () => context.stand().readVersioned(ReleaseDraftStateSchema, id),
      (value) => value?.version?.number === 3,
    );
    expect(audienceChanged?.state.audience).toBe("Operators");
    expect(audienceChanged?.state.markdown?.utf8).toEqual(markdown);
    const nextComparison = create(ReleaseComparisonSchema, {
      ...comparison,
      target: create(GitCommitIdSchema, { value: "c".repeat(40) }),
    });
    expect(
      (
        await scope.post(
          ChangeReleaseInputsSchema,
          create(ChangeReleaseInputsSchema, {
            id,
            expectedVersion: audienceChanged?.version,
            comparison: nextComparison,
            audience: "Operators",
          }),
        )
      ).kind,
    ).toBe("ok");
    const comparisonChanged = await box.eventually(
      () => context.stand().readVersioned(ReleaseDraftStateSchema, id),
      (value) => value?.version?.number === 4,
    );
    expect(comparisonChanged?.state.comparison).toEqual(nextComparison);
    expect(comparisonChanged?.state.markdown?.utf8).toEqual(new Uint8Array());
    const otherRepository = create(ReleaseComparisonSchema, {
      ...nextComparison,
      repository: create(RepositorySelectionIdSchema, { value: "other-repository" }),
    });
    const topic = create(TopicSchema, {
      id: create(TopicIdSchema, { value: randomUUID() }),
      target: create(TargetSchema, {
        type: TypeUrls.derive(ReleaseInputsConflictSchema),
        criterion: { case: "includeAll", value: true },
      }),
      context: new SignalMetadata().actorContext({
        actor: create(UserIdSchema, { value: "guest" }),
      }),
    });
    const subscription = await scope.createSubscription(topic, { kind: "event" });
    await subscription.activate();
    const updates = subscription.updates[Symbol.asyncIterator]();
    for (const [expectedVersion, candidate] of [
      [audienceChanged?.version, nextComparison],
      [comparisonChanged?.version, otherRepository],
    ] as const) {
      const rejection = updates.next();
      expect(
        (
          await scope.post(
            ChangeReleaseInputsSchema,
            create(ChangeReleaseInputsSchema, {
              id,
              expectedVersion,
              comparison: candidate,
              audience: "Wrong",
            }),
          )
        ).kind,
      ).toBe("ok");
      const delivery = await rejection;
      expect(delivery.done).toBe(false);
      if (
        delivery.done ||
        delivery.value.kind !== "update" ||
        delivery.value.update.update.case !== "eventUpdates"
      )
        throw new Error("Expected an input conflict rejection event");
      expect(
        delivery.value.update.update.value.event.flatMap((event) => {
          const rejected =
            event.message && AnyMessages.unpack(event.message, ReleaseInputsConflictSchema);
          return rejected ? [rejected.id] : [];
        }),
      ).toEqual([id]);
    }
    await subscription.cancel();
    const retained = await context.stand().readVersioned(ReleaseDraftStateSchema, id);
    expect(retained?.version).toEqual(comparisonChanged?.version);
    expect(retained?.state.audience).toBe("Operators");
    expect(retained?.state.comparison).toEqual(nextComparison);
  } finally {
    await box.close();
  }
});

test("canceling the matching generation preserves Markdown and discards a late proposal", async () => {
  const context = await contextForTest();
  const box = await BlackBox.from(context, { timeoutMs: 5_000 });
  const scope = box.asGuest();
  const generation = create(ReleaseGenerationIdSchema, { value: "to-cancel" });
  try {
    await scope.post(
      OpenReleaseDraftSchema,
      create(OpenReleaseDraftSchema, {
        id,
        title: create(ReleaseTitleSchema, { value: "Release" }),
        comparison,
        audience: "Customers",
      }),
    );
    await box.eventually(
      () => box.assertEvents(),
      (events) => events.length === 1,
    );
    const opened = await context.stand().readVersioned(ReleaseDraftStateSchema, id);
    const requested = await scope.post(
      RequestReleaseGenerationSchema,
      create(RequestReleaseGenerationSchema, {
        id,
        generation,
        expectedVersion: opened?.version,
        catalog: create(ReleaseEvidenceCatalogSchema),
        instruction: create(ReleaseInstructionSchema, { value: "Draft notes" }),
        conversation: create(ConversationIdSchema, { value: "conversation" }),
        selection: create(ReleaseModelSelectionSchema, {
          registration: "account",
          account: "subject",
          model: ModelRef.of("release-scripted", "v1"),
        }),
      }),
    );
    expect(requested.kind).toBe("ok");
    await box.eventually(
      () =>
        box
          .assertEvents()
          .filter(
            (event) =>
              event.message && AnyMessages.unpack(event.message, ReleaseGenerationRequestedSchema),
          ),
      (events) => events.length === 1,
    );
    const requestedEvent = box.assertEvents().flatMap((event) => {
      const value =
        event.message && AnyMessages.unpack(event.message, ReleaseGenerationRequestedSchema);
      return value ? [value] : [];
    })[0];
    expect(requestedEvent?.currentMarkdownText).toBe("");
    expect(
      (await context.stand().read(ReleaseDraftStateSchema, id))?.pendingGeneration?.value,
    ).toBe(generation.value);
    await scope.post(
      CancelReleaseGenerationSchema,
      create(CancelReleaseGenerationSchema, { id, generation }),
    );
    await box.eventually(
      async () => (await context.stand().read(ReleaseDraftStateSchema, id))?.generationStatus,
      (value) => value === "canceled",
    );
    const at = new SignalMetadata().timestamp();
    await context.eventBus().post(
      SignalEnvelopes.event({
        context: create(EventContextSchema, {
          timestamp: at,
          producerId: AnyMessages.pack(ReleaseDraftIdSchema, id),
          version: create(VersionSchema, { number: 2, timestamp: at }),
        }),
        schema: ReleaseNotesProposedSchema,
        message: create(ReleaseNotesProposedSchema, {
          id,
          generation,
          inputVersion: opened?.version,
          document: create(ReleaseNotesDocumentSchema, {
            sections: [
              create(ReleaseNotesSectionSchema, {
                heading: "Late",
                entries: [create(ReleaseNoteEntrySchema, { text: "Not accepted" })],
              }),
            ],
          }),
          operation: create(AiOperationIdSchema, { value: "late" }),
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
    const saved = await context.stand().read(ReleaseDraftStateSchema, id);
    expect(saved?.markdown?.utf8).toEqual(new Uint8Array());
    expect(saved?.generationStatus).toBe("canceled");
  } finally {
    await box.close();
  }
});

test("generation sees readable edited Markdown and invalid UTF-8 cannot replace it", async () => {
  const context = await contextForTest();
  const box = await BlackBox.from(context, { timeoutMs: 5_000 });
  const scope = box.asGuest();
  const generation = create(ReleaseGenerationIdSchema, { value: "readable-input" });
  try {
    await scope.post(
      OpenReleaseDraftSchema,
      create(OpenReleaseDraftSchema, {
        id,
        title: create(ReleaseTitleSchema, { value: "Release" }),
        comparison,
        audience: "Customers",
      }),
    );
    await box.eventually(
      () => box.assertEvents(),
      (events) => events.length === 1,
    );
    const opened = await context.stand().readVersioned(ReleaseDraftStateSchema, id);
    const markdown = "# Café 🐈\n\nExisting notes.\n";
    await scope.post(
      EditReleaseNotesSchema,
      create(EditReleaseNotesSchema, {
        id,
        expectedVersion: opened?.version,
        markdown: create(ReleaseMarkdownContentSchema, { utf8: encoder.encode(markdown) }),
      }),
    );
    await box.eventually(
      () => box.assertEvents(),
      (events) => events.length === 2,
    );
    const edited = await context.stand().readVersioned(ReleaseDraftStateSchema, id);
    await scope.post(
      EditReleaseNotesSchema,
      create(EditReleaseNotesSchema, {
        id,
        expectedVersion: edited?.version,
        markdown: create(ReleaseMarkdownContentSchema, { utf8: new Uint8Array([0xff]) }),
      }),
    );
    await scope.post(
      RequestReleaseGenerationSchema,
      create(RequestReleaseGenerationSchema, {
        id,
        generation,
        expectedVersion: edited?.version,
        catalog: create(ReleaseEvidenceCatalogSchema),
        instruction: create(ReleaseInstructionSchema, { value: "Revise notes" }),
        conversation: create(ConversationIdSchema, { value: "conversation" }),
        selection: create(ReleaseModelSelectionSchema, {
          registration: "account",
          account: "subject",
          model: ModelRef.of("release-scripted", "v1"),
        }),
      }),
    );
    const accepted = await box.eventually(
      () =>
        box.assertEvents().flatMap((event) => {
          const value =
            event.message && AnyMessages.unpack(event.message, ReleaseGenerationRequestedSchema);
          return value ? [value] : [];
        }),
      (events) => events.length === 1,
    );
    expect(accepted[0]?.currentMarkdownText).toBe(markdown);
    expect((await context.stand().read(ReleaseDraftStateSchema, id))?.markdown?.utf8).toEqual(
      encoder.encode(markdown),
    );
    expect(
      box
        .assertEvents()
        .filter(
          (event) => event.message && AnyMessages.unpack(event.message, ReleaseNotesEditedSchema),
        ),
    ).toHaveLength(1);
  } finally {
    await box.close();
  }
});
