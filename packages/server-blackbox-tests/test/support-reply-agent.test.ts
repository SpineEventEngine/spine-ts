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
import { AnyMessages } from "@spine-event-engine/core";
import type { Event } from "@spine-event-engine/proto";
import {
  BoundedContext,
  EventRouting,
  type EntityHandlersMetadata,
  HandlerRegistryIngestor,
  Repository,
} from "@spine-event-engine/server";
import { BlackBox } from "@spine-event-engine/testing";
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
import { SupportReplyUnavailableSchema } from "../dist/generated/spine/server/testing/support_agent_rejections_pb.js";
import { SupportReplyAgent } from "../dist/src/agent/support-reply-agent.js";

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

describe("support reply Agent", () => {
  it("registers authored handlers through generated context discovery", async () => {
    const agent = create(SupportReplyAgentIdSchema, { ticketNumber: "T-48" });
    const context = await BoundedContext.singleTenant("Support reply generated")
      .withGeneratedRegistryRoot(new URL("../dist/", import.meta.url))
      .add(SupportReplyAgent)
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
    const context = BoundedContext.singleTenant("Support reply failed reaction")
      .add(
        new Repository({
          entityType: SupportReplyAgent,
          schema: SupportReplyAgentStateSchema,
          handlers: agentHandlers,
          events: [SupportReplyDraftedSchema],
          eventRouting: EventRouting.create().route(SupportTicketUpdatedSchema, () => [agent]),
        }),
      )
      .addCommandDispatcher({
        messageSchemas: () => [ReviewSupportReplySchema],
        dispatch: () => Promise.resolve(),
      })
      .build();
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
    } finally {
      await blackBox.close();
    }
  });

  it("publishes a declared rejection without committing state or domain Events", async () => {
    const agent = create(SupportReplyAgentIdSchema, { ticketNumber: "T-45" });
    const rejections: Event[] = [];
    const context = BoundedContext.singleTenant("Support reply rejection")
      .add(
        new Repository({
          entityType: SupportReplyAgent,
          schema: SupportReplyAgentStateSchema,
          handlers: agentHandlers,
          events: [SupportReplyDraftedSchema],
        }),
      )
      .addEventDispatcher({
        messageSchemas: () => [SupportReplyUnavailableSchema],
        dispatch: (event) => {
          rejections.push(event);
          return Promise.resolve();
        },
      })
      .build();
    const blackBox = await BlackBox.from(context);
    try {
      await blackBox
        .asGuest()
        .post(
          DraftSupportReplySchema,
          create(DraftSupportReplySchema, { agent, question: "reject" }),
        );
      const rejection = await blackBox.eventually(
        () => rejections[0],
        (candidate) => candidate !== undefined,
      );
      expect(
        AnyMessages.unpack(requiredMessage(rejection), SupportReplyUnavailableSchema)?.agent,
      ).toEqual(agent);
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
    const context = BoundedContext.singleTenant("Support reply no-op")
      .add(
        new Repository({
          entityType: SupportReplyAgent,
          schema: SupportReplyAgentStateSchema,
          handlers: agentHandlers,
          events: [SupportReplyDraftedSchema],
          eventRouting: EventRouting.create().route(SupportTicketUpdatedSchema, () => [agent]),
        }),
      )
      .addCommandDispatcher({
        messageSchemas: () => [ReviewSupportReplySchema],
        dispatch: () => Promise.resolve(),
      })
      .build();
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
      expect(await context.stand().read(SupportReplyAgentStateSchema, agent)).toBeUndefined();
      expect(blackBox.assertEvents()).toEqual([]);
    } finally {
      await blackBox.close();
    }
  });

  it("runs matching Event reactions before Command production in one draft", async () => {
    const agent = create(SupportReplyAgentIdSchema, { ticketNumber: "T-43" });
    const context = BoundedContext.singleTenant("Support reply event")
      .add(
        new Repository({
          entityType: SupportReplyAgent,
          schema: SupportReplyAgentStateSchema,
          handlers: agentHandlers,
          events: [SupportReplyDraftedSchema],
          eventRouting: EventRouting.create().route(SupportTicketUpdatedSchema, () => [agent]),
        }),
      )
      .addCommandDispatcher({
        messageSchemas: () => [ReviewSupportReplySchema],
        dispatch: () => Promise.resolve(),
      })
      .build();
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
        () => blackBox.assertEvents(),
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
    } finally {
      await blackBox.close();
    }
  });

  it("routes a generated assignment through BlackBox and commits the proposed reply", async () => {
    const agent = create(SupportReplyAgentIdSchema, { ticketNumber: "T-42" });
    const context = BoundedContext.singleTenant("Support reply")
      .add(
        new Repository({
          entityType: SupportReplyAgent,
          schema: SupportReplyAgentStateSchema,
          handlers: agentHandlers,
          events: [SupportReplyDraftedSchema],
        }),
      )
      .addCommandDispatcher({
        messageSchemas: () => [ReviewSupportReplySchema],
        dispatch: () => Promise.resolve(),
      })
      .build();
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
});
