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
import type { Any } from "@bufbuild/protobuf/wkt";
import { AiRegistry } from "@spine-event-engine/ai";
import { AnyMessages } from "@spine-event-engine/core";
// prettier-ignore
import {
  CommandDispatchedToHandlerSchema,
} from "@spine-event-engine/proto/generated/spine/system/server/entity_log_events_pb.js";
import {
  BoundedContext,
  EventRouting,
  type EntityHandlersMetadata,
  HandlerRegistryIngestor,
  Repository,
} from "@spine-event-engine/server";
import { BlackBox } from "@spine-event-engine/testing";
import { readAgentHistory } from "@spine-event-engine/server/testing";
import { describe, expect, it } from "vitest";

import { generatedHandlerRegistry } from "../dist/generated/handler/generated-handler-registry.js";
import {
  DraftSupportReplySchema,
  ReviewSupportReplySchema,
} from "../dist/generated/spine/server/testing/support_agent_commands_pb.js";
import {
  SupportReplyDraftedSchema,
  SupportTicketUpdatedSchema,
} from "../dist/generated/spine/server/testing/support_agent_events_pb.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
} from "../dist/generated/spine/server/testing/support_agent_states_pb.js";
import { SupportReplyReviewStartedSchema } from "../dist/generated/spine/server/testing/support_review_events_pb.js";
import { SupportReplyAgent } from "../dist/src/agent/support-reply-agent.js";
import {
  SupportRejectionSubscriber,
  SupportReviewAssignee,
} from "../dist/src/agent/support-reply-receivers.js";
import {
  SupportDraftObserver,
  SupportDraftReceiptObserver,
} from "../dist/src/agent/support-draft-receivers.js";

const generatedHandlers = new HandlerRegistryIngestor().ingest(generatedHandlerRegistry);
const discoveredAgent = generatedHandlers.find((entry) => entry.entityType === SupportReplyAgent);
if (discoveredAgent === undefined)
  throw new Error("Generated registry did not discover SupportReplyAgent.");
const agentHandlers = discoveredAgent as EntityHandlersMetadata<
  SupportReplyAgent,
  typeof SupportReplyAgentStateSchema
>;

function requiredMessage(signal: { readonly message?: Any | undefined } | undefined): Any {
  if (signal?.message === undefined) throw new Error("Expected a produced signal message.");
  return signal.message;
}

function emptyModelRegistry(): AiRegistry {
  return AiRegistry.create({
    defaultModels: {},
    invocationLimits: {
      operations: 1,
      modelRequests: 1,
      toolCalls: 0,
      recordedReads: 1,
      deadlineMs: 1_000,
      totalInputBytes: 4_000,
      totalOutputBytes: 4_000,
      maxRecoveryBytes: 4_000,
    },
    concurrentOperations: 1,
    queuedOperations: 0,
  });
}

function supportContext(name: string) {
  return BoundedContext.singleTenant(name).withAi(emptyModelRegistry()).persistSystemEvents();
}

function generatedSupportContext(
  name: string,
  assignee = new SupportReviewAssignee(),
  subscriber = new SupportRejectionSubscriber(),
) {
  return supportContext(name)
    .withGeneratedRegistryRoot(new URL("../dist/", import.meta.url))
    .addAssignee(assignee)
    .addEventDispatcher(subscriber)
    .addEventDispatcher(new SupportDraftReceiptObserver())
    .addEventDispatcher(new SupportDraftObserver());
}

describe("support reply Agent", () => {
  it("registers authored handlers through generated context discovery", async () => {
    const agent = create(SupportReplyAgentIdSchema, { ticketNumber: "T-48" });
    const context = await generatedSupportContext("Support reply generated")
      .add(SupportReplyAgent, {
        agentCodeRevision: "support-reply-v1",
        ai: { models: [] },
      })
      .buildAsync();
    const blackBox = await BlackBox.from(context);
    try {
      const result = await blackBox
        .asGuest()
        .post(
          DraftSupportReplySchema,
          create(DraftSupportReplySchema, { agent, question: "Delivery status?" }),
        );
      expect(result.kind).toBe("ok");
      const state = await blackBox.eventually(
        () => context.stand().read(SupportReplyAgentStateSchema, agent),
        (candidate) => candidate?.proposedReply === "Answer: Delivery status?",
      );
      expect(state?.id).toEqual(agent);
    } finally {
      await blackBox.close();
    }
  });

  it("discards the whole Event draft when a later reactor fails", async () => {
    const agent = create(SupportReplyAgentIdSchema, { ticketNumber: "T-47" });
    const assignee = new SupportReviewAssignee();
    const context = await generatedSupportContext("Support reply failed reaction", assignee)
      .add(
        new Repository({
          entityType: SupportReplyAgent,
          agentCodeRevision: "support-reply-v1",
          ai: { models: [] },
          schema: SupportReplyAgentStateSchema,
          handlers: agentHandlers,
          events: [SupportReplyDraftedSchema],
          eventRouting: EventRouting.create().route(SupportTicketUpdatedSchema, () => [agent]),
        }),
      )
      .buildAsync();
    const blackBox = await BlackBox.from(context);
    try {
      await blackBox
        .asGuest()
        .postEvent(
          SupportTicketUpdatedSchema,
          create(SupportTicketUpdatedSchema, { agent, question: "fail" }),
        );
      await blackBox.eventually(
        () => (SupportReplyAgent as unknown as { failedReactions?: number }).failedReactions,
        (count) => count === 1,
      );
      expect(await context.stand().read(SupportReplyAgentStateSchema, agent)).toBeUndefined();
      expect(blackBox.assertEvents()).toEqual([]);
      expect(blackBox.assertCommands()).toEqual([]);
      expect(assignee.requests).toEqual([]);
    } finally {
      await blackBox.close();
    }
  });

  it("publishes a declared rejection without committing state or domain Events", async () => {
    const agent = create(SupportReplyAgentIdSchema, { ticketNumber: "T-45" });
    const subscriber = new SupportRejectionSubscriber();
    const context = await generatedSupportContext("Support reply rejection", undefined, subscriber)
      .add(
        new Repository({
          entityType: SupportReplyAgent,
          agentCodeRevision: "support-reply-v1",
          ai: { models: [] },
          schema: SupportReplyAgentStateSchema,
          handlers: agentHandlers,
          events: [SupportReplyDraftedSchema],
        }),
      )
      .buildAsync();
    const blackBox = await BlackBox.from(context);
    try {
      await blackBox
        .asGuest()
        .post(
          DraftSupportReplySchema,
          create(DraftSupportReplySchema, { agent, question: "reject" }),
        );
      const rejection = await blackBox.eventually(
        () => subscriber.rejections[0],
        (candidate) => candidate !== undefined,
      );
      expect(rejection?.agent).toEqual(agent);
      await blackBox.eventually(
        () => (SupportReplyAgent as unknown as { rejectionsSeen?: number }).rejectionsSeen,
        (count) => count === 1,
      );
      expect(await context.stand().read(SupportReplyAgentStateSchema, agent)).toBeUndefined();
      expect(blackBox.assertEvents()).toEqual([]);
    } finally {
      await blackBox.close();
    }
  });

  it("posts a review Command without creating Agent state when reactions return undefined", async () => {
    const agent = create(SupportReplyAgentIdSchema, { ticketNumber: "T-44" });
    const assignee = new SupportReviewAssignee();
    const context = await generatedSupportContext("Support reply no-op", assignee)
      .add(
        new Repository({
          entityType: SupportReplyAgent,
          agentCodeRevision: "support-reply-v1",
          ai: { models: [] },
          schema: SupportReplyAgentStateSchema,
          handlers: agentHandlers,
          events: [SupportReplyDraftedSchema],
          eventRouting: EventRouting.create().route(SupportTicketUpdatedSchema, () => [agent]),
        }),
      )
      .buildAsync();
    const blackBox = await BlackBox.from(context);
    try {
      await blackBox
        .asGuest()
        .postEvent(
          SupportTicketUpdatedSchema,
          create(SupportTicketUpdatedSchema, { agent, question: "ignore" }),
        );
      const commands = await blackBox.eventually(
        () => blackBox.assertCommands(),
        (candidate) => candidate.length === 1,
      );
      expect(
        AnyMessages.unpack(requiredMessage(commands[0]), ReviewSupportReplySchema)?.agent,
      ).toEqual(agent);
      expect(assignee.requests).toHaveLength(1);
      expect(await context.stand().read(SupportReplyAgentStateSchema, agent)).toBeUndefined();
      const review = await blackBox.eventually(
        () =>
          blackBox
            .assertEvents()
            .map((event) =>
              AnyMessages.unpack(requiredMessage(event), SupportReplyReviewStartedSchema),
            )
            .filter((event) => event !== undefined),
        (events) => events.length === 1,
      );
      expect(review[0]?.agent).toEqual(agent);
    } finally {
      await blackBox.close();
    }
  });

  it("runs matching Event reactions before Command production in one draft", async () => {
    const agent = create(SupportReplyAgentIdSchema, { ticketNumber: "T-43" });
    const assignee = new SupportReviewAssignee();
    const repository = new Repository({
      entityType: SupportReplyAgent,
      agentCodeRevision: "support-reply-v1",
      ai: { models: [] },
      schema: SupportReplyAgentStateSchema,
      handlers: agentHandlers,
      events: [SupportReplyDraftedSchema],
      eventRouting: EventRouting.create().route(SupportTicketUpdatedSchema, () => [agent]),
    });
    const context = await generatedSupportContext("Support reply event", assignee)
      .add(repository)
      .buildAsync();
    const blackBox = await BlackBox.from(context);
    try {
      await blackBox
        .asGuest()
        .postEvent(
          SupportTicketUpdatedSchema,
          create(SupportTicketUpdatedSchema, { agent, question: "Can I change my address?" }),
        );
      const state = await blackBox.eventually(
        () => context.stand().read(SupportReplyAgentStateSchema, agent),
        (candidate) => candidate?.proposedReply === "Answer: Can I change my address? [review]",
      );
      expect(state?.proposedReply).toBe("Answer: Can I change my address? [review]");
      expect(
        (await context.stand().readVersioned(SupportReplyAgentStateSchema, agent))?.version?.number,
      ).toBe(1);
      const events = await blackBox.eventually(
        () =>
          blackBox
            .assertEvents()
            .filter(
              (event) =>
                AnyMessages.unpack(requiredMessage(event), SupportReplyDraftedSchema) !== undefined,
            ),
        (candidate) => candidate.length === 2,
      );
      expect(
        events.map(
          (event) => AnyMessages.unpack(requiredMessage(event), SupportReplyDraftedSchema)?.reply,
        ),
      ).toEqual(["Answer: Can I change my address?", "Answer: Can I change my address? [review]"]);
      const commands = await blackBox.eventually(
        () => blackBox.assertCommands(),
        (candidate) => candidate.length === 1,
      );
      expect(
        AnyMessages.unpack(requiredMessage(commands[0]), ReviewSupportReplySchema)?.agent,
      ).toEqual(agent);
      expect(assignee.requests).toHaveLength(1);
      const review = await blackBox.eventually(
        () =>
          blackBox
            .assertEvents()
            .map((event) =>
              AnyMessages.unpack(requiredMessage(event), SupportReplyReviewStartedSchema),
            )
            .filter((event) => event !== undefined),
        (items) => items.length === 1,
      );
      expect(review[0]?.agent).toEqual(agent);
      const audit = await readAgentHistory(
        repository,
        agent,
        { kind: "system" },
        { count: 10, maxBytes: 1_048_576 },
      );
      expect(audit.entries.some((entry) => entry.item.case === "systemEvent")).toBe(true);
    } finally {
      await blackBox.close();
    }
  });

  it("routes a generated assignment through BlackBox and commits the proposed reply", async () => {
    const agent = create(SupportReplyAgentIdSchema, { ticketNumber: "T-42" });
    const context = await generatedSupportContext("Support reply")
      .add(
        new Repository({
          entityType: SupportReplyAgent,
          agentCodeRevision: "support-reply-v1",
          ai: { models: [] },
          schema: SupportReplyAgentStateSchema,
          handlers: agentHandlers,
          events: [SupportReplyDraftedSchema],
        }),
      )
      .buildAsync();
    const blackBox = await BlackBox.from(context);
    try {
      const result = await blackBox
        .asGuest()
        .post(
          DraftSupportReplySchema,
          create(DraftSupportReplySchema, { agent, question: "Where is my order?" }),
        );
      expect(result.kind).toBe("ok");
      const state = await blackBox.eventually(
        () => context.stand().read(SupportReplyAgentStateSchema, agent),
        (candidate) => candidate?.proposedReply === "Answer: Where is my order?",
      );
      expect(state?.id).toEqual(agent);
      const events = await blackBox.eventually(
        () => blackBox.assertEvents(),
        (candidate) => candidate.length === 1,
      );
      expect(AnyMessages.unpack(requiredMessage(events[0]), SupportReplyDraftedSchema)?.reply).toBe(
        "Answer: Where is my order?",
      );
    } finally {
      await blackBox.close();
    }
  });

  it("retains original emitted Event envelopes in mandatory repository history", async () => {
    const agent = create(SupportReplyAgentIdSchema, { ticketNumber: "T-history" });
    const repository = new Repository({
      entityType: SupportReplyAgent,
      agentCodeRevision: "support-reply-v1",
      ai: { models: [] },
      schema: SupportReplyAgentStateSchema,
      handlers: agentHandlers,
      events: [SupportReplyDraftedSchema],
    });
    const context = supportContext("Support history").add(repository).build();
    const blackBox = await BlackBox.from(context);
    try {
      const result = await blackBox
        .asGuest()
        .post(
          DraftSupportReplySchema,
          create(DraftSupportReplySchema, { agent, question: "Where is my order?" }),
        );
      expect(result.kind).toBe("ok");
      const published = await blackBox.eventually(
        () => blackBox.assertEvents(),
        (events) => events.length === 1,
      );
      const history = await readAgentHistory(
        repository,
        agent,
        { kind: "domain" },
        { count: 10, maxBytes: 1_048_576 },
      );
      expect(history.entries).toHaveLength(1);
      expect(history.entries[0]?.item).toEqual({ case: "domainEvent", value: published[0] });
      const audit = await readAgentHistory(
        repository,
        agent,
        { kind: "system" },
        { count: 10, maxBytes: 1_048_576 },
      );
      expect(audit.entries).toHaveLength(1);
      const dispatch = audit.entries[0]?.item;
      expect(dispatch?.case).toBe("systemEvent");
      if (dispatch?.case !== "systemEvent")
        throw new Error("Expected the System dispatch envelope.");
      expect(
        AnyMessages.unpack(requiredMessage(dispatch.value), CommandDispatchedToHandlerSchema)
          ?.payload?.id,
      ).toBeDefined();
    } finally {
      await blackBox.close();
    }
  });
});
