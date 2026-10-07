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
import { AnyMessages } from "@spine-event-engine/core";
import { ActorContextSchema } from "@spine-event-engine/proto";
import { ConversationIdSchema } from "@spine-event-engine/proto/agent";
import { QueryIdSchema } from "@spine-event-engine/proto/client";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { AiTestBackend, BlackBox } from "@spine-event-engine/testing";
import { describe, expect, it } from "vitest";

import {
  DraftSupportReplySchema,
  OpenSupportTicketSchema,
} from "../generated/spine/examples/support/commands_pb.js";
import {
  SupportReplyFailedSchema,
  SupportReplySuggestedSchema,
} from "../generated/spine/examples/support/events_pb.js";
import { SupportReviewStateSchema } from "../generated/spine/examples/support/states_pb.js";
import { SupportReviewStateQuery } from "../generated/spine/examples/support/states_query.js";
import {
  SupportReplySchema,
  SupportRequestSchema,
  SupportTicketIdSchema,
} from "../generated/spine/examples/support/types_pb.js";
import { SupportContext, SupportDraftAgent, draftSupportReply } from "../dist/src/index.js";

const ticketId = create(SupportTicketIdSchema, { value: "SUP-47" });
const request = create(SupportRequestSchema, {
  incident: "Neither packing station can print shipping labels.",
  attemptedSteps: ["Restarted both printers", "Restarted both PCs"],
  impact: "Orders are waiting for the carrier.",
});
const conversation = create(ConversationIdSchema, { value: "SUP-47-draft-1" });

function registry(backend: AiTestBackend): AiRegistry {
  return AiRegistry.create({
    defaultModels: { generation: backend.registration.ref },
    invocationLimits: {
      operations: 1,
      modelRequests: 2,
      toolCalls: 0,
      recordedReads: 1,
      deadlineMs: 30_000,
      totalInputBytes: 32_000,
      totalOutputBytes: 16_000,
      // Two 8 KiB responses retain raw, typed, and admitted copies plus audit rows.
      maxRecoveryBytes: 96_000,
    },
    concurrentOperations: 1,
    queuedOperations: 0,
  }).register(backend.registration);
}

async function started(backend: AiTestBackend) {
  const context = await SupportContext.create(registry(backend), new InMemoryStorageFactory());
  const box = await BlackBox.from(context);
  const scope = box.asGuest();
  const opened = await scope.post(
    OpenSupportTicketSchema,
    create(OpenSupportTicketSchema, {
      id: ticketId,
      request,
    }),
  );
  expect(opened.kind).toBe("ok");
  const posted = await scope.post(
    DraftSupportReplySchema,
    create(DraftSupportReplySchema, {
      id: ticketId,
      request,
      conversation,
    }),
  );
  expect(posted.kind).toBe("ok");
  return { box, context, scope };
}

function reviewQuery() {
  const query = SupportReviewStateQuery.create().byId(ticketId).build().build();
  query.id = create(QueryIdSchema, { value: "support-review" });
  query.context = create(ActorContextSchema);
  return query;
}

describe("warehouse support draft through BlackBox", () => {
  it("proposes a reviewable reply and retains its conversation audit", async () => {
    const backend = AiTestBackend.create({
      ref: ModelRef.of("support-scripted", "v1"),
      kind: "generation",
    });
    const reply = create(SupportReplySchema, {
      subject: "Shipping label printing is blocked",
      body: "I see that neither station prints labels after both printers and PCs were restarted. Which error appears when printing? A support person will review this draft.",
      questions: ["What error appears when either station prints?"],
    });
    backend.forModel(draftSupportReply).respondWith(reply);
    const { box, context, scope } = await started(backend);
    try {
      const suggested = await box.eventually(
        () =>
          box
            .assertEvents()
            .flatMap((event) =>
              event.message === undefined
                ? []
                : [AnyMessages.unpack(event.message, SupportReplySuggestedSchema)],
            )
            .filter((event) => event !== undefined),
        (events) => events.length === 1,
      );
      expect(suggested[0]?.request).toEqual(request);
      expect(suggested[0]?.conversation).toEqual(conversation);
      expect(suggested[0]?.reply).toEqual(reply);
      const review = await box.eventually(
        async () =>
          (await scope.send(reviewQuery())).message
            .flatMap(({ state }) =>
              state === undefined ? [] : [AnyMessages.unpack(state, SupportReviewStateSchema)],
            )
            .filter((row) => row !== undefined),
        (rows) => rows.length === 1 && rows[0]?.hasDraft === true,
      );
      expect(review[0]?.reply).toEqual(reply);
      const repository = context
        .registeredRepositories()
        .find((view) => view.entityType === SupportDraftAgent);
      if (repository === undefined) throw new Error("Support Agent repository is missing.");
      const audit = await box.readAgentHistory(repository, ticketId, { pageSize: 10 });
      expect(audit.items.length).toBeGreaterThan(0);
      expect(audit.items.some((entry) => entry.item.case === "conversationRecord")).toBe(true);
      expect(backend.requests()).toHaveLength(1);
      backend.assertSatisfied();
    } finally {
      await box.close();
    }
  });

  it("records malformed output as a failure without publishing a draft", async () => {
    const backend = AiTestBackend.create({
      ref: ModelRef.of("support-scripted", "v1"),
      kind: "generation",
    });
    backend.forModel(draftSupportReply).respondWithText("not JSON").respondWithText("not JSON");
    const { box, scope } = await started(backend);
    try {
      const failed = await box.eventually(
        () =>
          box
            .assertEvents()
            .flatMap((event) =>
              event.message === undefined
                ? []
                : [AnyMessages.unpack(event.message, SupportReplyFailedSchema)],
            )
            .filter((event) => event !== undefined),
        (events) => events.length === 1,
      );
      expect(failed[0]?.request).toEqual(request);
      expect(failed[0]?.conversation).toEqual(conversation);
      const review = await box.eventually(
        async () =>
          (await scope.send(reviewQuery())).message
            .flatMap(({ state }) =>
              state === undefined ? [] : [AnyMessages.unpack(state, SupportReviewStateSchema)],
            )
            .filter((row) => row !== undefined),
        (rows) => rows.length === 1,
      );
      expect(review[0]?.hasDraft).toBe(false);
      expect(review[0]?.latestRequestFailed).toBe(true);
      expect(review[0]?.reply).toBeUndefined();
      backend.assertSatisfied();
    } finally {
      await box.close();
    }
  });

  it("keeps an earlier accepted reply when a later request fails", async () => {
    const backend = AiTestBackend.create({
      ref: ModelRef.of("support-scripted", "v1"),
      kind: "generation",
    });
    const previousReply = create(SupportReplySchema, {
      subject: "Shipping labels blocked",
      body: "A support person will review this draft about the two stations.",
    });
    backend
      .forModel(draftSupportReply)
      .respondWith(previousReply)
      .respondWithText("not JSON")
      .respondWithText("not JSON");
    const { box, scope } = await started(backend);
    try {
      await box.eventually(
        () =>
          box
            .assertEvents()
            .filter(
              (event) =>
                event.message !== undefined &&
                AnyMessages.unpack(event.message, SupportReplySuggestedSchema) !== undefined,
            ),
        (events) => events.length === 1,
      );
      const updated = create(SupportRequestSchema, {
        incident: request.incident,
        attemptedSteps: [...request.attemptedSteps, "Checked the print queue"],
        impact: request.impact,
      });
      const posted = await scope.post(
        DraftSupportReplySchema,
        create(DraftSupportReplySchema, {
          id: ticketId,
          request: updated,
          conversation: create(ConversationIdSchema, { value: "SUP-47-draft-2" }),
        }),
      );
      expect(posted.kind).toBe("ok");
      await box.eventually(
        () =>
          box
            .assertEvents()
            .filter(
              (event) =>
                event.message !== undefined &&
                AnyMessages.unpack(event.message, SupportReplyFailedSchema) !== undefined,
            ),
        (events) => events.length === 1,
      );
      const review = await box.eventually(
        async () =>
          (await scope.send(reviewQuery())).message
            .flatMap(({ state }) =>
              state === undefined ? [] : [AnyMessages.unpack(state, SupportReviewStateSchema)],
            )
            .filter((row) => row !== undefined),
        (rows) => rows.length === 1 && rows[0]?.latestRequestFailed === true,
      );
      expect(review[0]?.reply).toEqual(previousReply);
      expect(review[0]?.hasDraft).toBe(true);
      expect(review[0]?.request).toEqual(updated);
      expect(review[0]?.conversation).toEqual(
        create(ConversationIdSchema, { value: "SUP-47-draft-2" }),
      );
      backend.assertSatisfied();
    } finally {
      await box.close();
    }
  });

  it("rejects blank draft text before accepting a corrected proposal", async () => {
    const backend = AiTestBackend.create({
      ref: ModelRef.of("support-scripted", "v1"),
      kind: "generation",
    });
    const corrected = create(SupportReplySchema, {
      subject: "Labels blocked at both stations",
      body: "A support person will review this draft and ask for the printer error.",
    });
    backend
      .forModel(draftSupportReply)
      .respondWith(create(SupportReplySchema, { subject: " ", body: " " }))
      .respondWith(corrected);
    const { box } = await started(backend);
    try {
      const suggested = await box.eventually(
        () =>
          box
            .assertEvents()
            .flatMap((event) =>
              event.message === undefined
                ? []
                : [AnyMessages.unpack(event.message, SupportReplySuggestedSchema)],
            )
            .filter((event) => event !== undefined),
        (events) => events.length === 1,
      );
      expect(suggested[0]?.reply).toEqual(corrected);
      expect(backend.requests()).toHaveLength(2);
      backend.assertSatisfied();
    } finally {
      await box.close();
    }
  });
});
