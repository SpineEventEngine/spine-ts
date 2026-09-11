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

import { type Message } from "@bufbuild/protobuf";
import { CommandSchema } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";
// prettier-ignore
import {
  ProjectOverviewStateSchema as StateSchema,
} from "../../test-fixtures/generated/entity-metadata/project_states_pb.js";
import {
  ScheduleReviewSchema,
  StartReviewSchema,
} from "../../test-fixtures/generated/handler-registry/commands_pb.js";
import { ReviewStartedSchema } from "../../test-fixtures/generated/handler-registry/events_pb.js";
import { ReviewRejectedSchema } from "../../test-fixtures/generated/handler-registry/rejections_pb.js";
import { ReviewStateSchema } from "../../test-fixtures/generated/handler-registry/states_pb.js";
import {
  AbstractAssignee,
  AbstractCommander,
  AbstractEventReactor,
  AbstractEventSubscriber,
  Aggregate,
  HandlerMetadataError,
  HandlerRegistryIngestionError,
  HandlerRegistryIngestor,
  ProcessManager,
  Projection,
} from "../../src/index.js";
import type {
  GeneratedHandlerKind,
  GeneratedHandlerRecordInput,
  GeneratedStandaloneHandlerGroup,
  StandaloneReceiverConstructor,
} from "../../src/handler/generated-handler-registry.js";

class Manager extends ProcessManager<string, typeof StateSchema, number> {
  substitute(command: Message<"spine.server.testing.StartReview">) {
    return command;
  }
}
class AggregateReceiver extends Aggregate<string, typeof StateSchema, number> {
  substitute(command: Message<"spine.server.testing.StartReview">) {
    return command;
  }
}
class ProjectionReceiver extends Projection<string, typeof StateSchema, number> {
  handle(command: Message<"spine.server.testing.StartReview">) {
    return command;
  }
}
class UnrelatedReceiver {
  readonly unrelated = true;
}
class DependencyCommander extends AbstractCommander {
  constructor(readonly dependency: string) {
    super();
  }

  replace(command: Message<"spine.server.testing.StartReview">) {
    return command;
  }
}
class Commander extends AbstractCommander {
  replace(command: Message<"spine.server.testing.StartReview">) {
    return command;
  }
}
class Assignee extends AbstractAssignee {}
class Reactor extends AbstractEventReactor {}
class Subscriber extends AbstractEventSubscriber {}
const substitution = (methodName = "substitute") => ({
  kind: "command-substitution" as const,
  methodName,
  signalSchema: StartReviewSchema,
  emittedSchemas: [ScheduleReviewSchema],
  parameterCount: 1 as const,
  origin: "domestic" as const,
});

const roleMatrix = [
  ["assignee", Assignee, ["command-assignment"]],
  ["commander", Commander, ["command-substitution", "command-reaction"]],
  ["reactor", Reactor, ["event-reaction"]],
  ["subscriber", Subscriber, ["event-subscription", "state-subscription"]],
] as const;

function domainHandler(kind: GeneratedHandlerRecordInput["kind"]): GeneratedHandlerRecordInput {
  const signalSchema =
    kind === "command-assignment" || kind === "command-substitution"
      ? StartReviewSchema
      : kind === "state-subscription"
        ? ReviewStateSchema
        : ReviewStartedSchema;
  const emittedSchemas =
    kind === "command-assignment" || kind === "event-reaction"
      ? [ReviewStartedSchema]
      : kind === "command-substitution" || kind === "command-reaction"
        ? [ScheduleReviewSchema]
        : [];
  return {
    kind,
    methodName: "handle",
    signalSchema,
    emittedSchemas,
    parameterCount: 1,
    origin: "domestic",
  };
}

describe("generated handler registry ingestion", () => {
  it("rejects Projection command assignments from generated metadata", () => {
    expect(() =>
      new HandlerRegistryIngestor().ingest({
        receivers: [
          {
            receiverKind: "entity",
            receiverType: ProjectionReceiver,
            stateSchema: StateSchema,
            handlers: [domainHandler("command-assignment")],
          },
        ],
      }),
    ).toThrow(HandlerMetadataError);
  });

  it("rejects a schema without the descriptor file classifiers require", () => {
    const ingest = () =>
      new HandlerRegistryIngestor().ingest({
        receivers: [
          {
            receiverKind: "entity",
            receiverType: Manager,
            stateSchema: StateSchema,
            handlers: [
              {
                ...substitution(),
                signalSchema: { typeName: "example.Start" },
              },
            ],
          },
        ],
      });

    expect(ingest).toThrow(HandlerRegistryIngestionError);
    expect(ingest).toThrow(/descriptor/i);
  });

  it("rejects a descriptor lookalike before command classification", () => {
    const ingest = () =>
      new HandlerRegistryIngestor().ingest({
        receivers: [
          {
            receiverKind: "entity",
            receiverType: Manager,
            stateSchema: StateSchema,
            handlers: [
              {
                ...substitution(),
                signalSchema: { typeName: "example.Start", file: { name: "commands" } },
              },
            ],
          },
        ],
      });

    expect(ingest).toThrow(HandlerRegistryIngestionError);
    expect(ingest).toThrow(/descriptor/i);
  });

  it("accepts only nominal standalone receiver constructors in generated groups", () => {
    const acceptsStandaloneReceiver = (receiverType: StandaloneReceiverConstructor) => receiverType;

    expect(acceptsStandaloneReceiver(Assignee)).toBe(Assignee);
    expect(acceptsStandaloneReceiver(Commander)).toBe(Commander);
    expect(acceptsStandaloneReceiver(DependencyCommander)).toBe(DependencyCommander);
    expect(acceptsStandaloneReceiver(Reactor)).toBe(Reactor);
    expect(acceptsStandaloneReceiver(Subscriber)).toBe(Subscriber);
    // @ts-expect-error Entity constructors are not standalone receiver constructors.
    acceptsStandaloneReceiver(AggregateReceiver);
    // @ts-expect-error Entity constructors are not standalone receiver constructors.
    acceptsStandaloneReceiver(ProjectionReceiver);
    // @ts-expect-error Entity constructors are not standalone receiver constructors.
    acceptsStandaloneReceiver(Manager);
    // @ts-expect-error Arbitrary constructors are not standalone receiver constructors.
    acceptsStandaloneReceiver(UnrelatedReceiver);

    const group = {
      receiverKind: "standalone" as const,
      receiverType: Commander,
      handlers: [],
    } satisfies GeneratedStandaloneHandlerGroup;
    expect(group.receiverType).toBe(Commander);

    const dependencyGroup = {
      receiverKind: "standalone" as const,
      receiverType: DependencyCommander,
      handlers: [],
    } satisfies GeneratedStandaloneHandlerGroup;
    expect(dependencyGroup.receiverType).toBe(DependencyCommander);
  });

  it("rejects the framework Command envelope as a command handler payload", () => {
    expect(() =>
      new HandlerRegistryIngestor().ingest({
        receivers: [
          {
            receiverKind: "entity" as const,
            receiverType: Manager,
            stateSchema: StateSchema,
            handlers: [{ ...substitution(), signalSchema: CommandSchema }],
          },
        ],
      }),
    ).toThrow("must declare a Command input schema");
  });

  it.each([
    { receivers: [null] },
    { receivers: [{ receiverKind: "standalone", receiverType: Commander, handlers: null }] },
    { receivers: [{ receiverKind: "standalone", receiverType: Commander, handlers: [null] }] },
    { receivers: [{ receiverKind: "standalone", receiverType: Commander, handlers: [{}] }] },
    {
      receivers: [
        {
          receiverKind: "standalone",
          receiverType: Commander,
          handlers: [{ ...substitution(), signalSchema: null }],
        },
      ],
    },
  ])("rejects malformed generated registry records with an ingestion error", (registry) => {
    expect(() => new HandlerRegistryIngestor().ingest(registry)).toThrow(
      HandlerRegistryIngestionError,
    );
  });

  it.each(roleMatrix)("enforces the handler-kind matrix for %s", (_role, receiverType, allowed) => {
    for (const kind of [
      "command-assignment",
      "command-substitution",
      "command-reaction",
      "event-reaction",
      "event-subscription",
      "state-subscription",
    ] satisfies readonly GeneratedHandlerKind[]) {
      const ingest = () =>
        new HandlerRegistryIngestor().ingest({
          receivers: [
            { receiverKind: "standalone", receiverType, handlers: [domainHandler(kind)] },
          ],
        });
      if (allowed.includes(kind as never)) expect(ingest).not.toThrow();
      else expect(ingest).toThrow(HandlerRegistryIngestionError);
    }
  });
  it("enforces standalone handler input, output, origin, and filter semantics", () => {
    const ingestor = new HandlerRegistryIngestor();
    const standalone =
      (
        receiverType: typeof Assignee | typeof Commander | typeof Reactor | typeof Subscriber,
        handler: ReturnType<typeof domainHandler>,
      ) =>
      () =>
        ingestor.ingest({
          receivers: [{ receiverKind: "standalone", receiverType, handlers: [handler] }],
        });

    const assignment = domainHandler("command-assignment");
    expect(standalone(Assignee, assignment)).not.toThrow();
    expect(standalone(Assignee, { ...assignment, signalSchema: ReviewStartedSchema })).toThrow(
      HandlerRegistryIngestionError,
    );
    expect(standalone(Assignee, { ...assignment, emittedSchemas: [ScheduleReviewSchema] })).toThrow(
      HandlerRegistryIngestionError,
    );
    expect(standalone(Assignee, { ...assignment, emittedSchemas: [] })).toThrow(
      HandlerRegistryIngestionError,
    );

    const substitution = domainHandler("command-substitution");
    expect(standalone(Commander, substitution)).not.toThrow();
    expect(standalone(Commander, { ...substitution, signalSchema: ReviewStartedSchema })).toThrow(
      HandlerRegistryIngestionError,
    );
    expect(
      standalone(Commander, { ...substitution, emittedSchemas: [ReviewStartedSchema] }),
    ).toThrow(HandlerRegistryIngestionError);

    const reaction = domainHandler("command-reaction");
    expect(standalone(Commander, reaction)).not.toThrow();
    expect(standalone(Commander, { ...reaction, signalSchema: StartReviewSchema })).toThrow(
      HandlerRegistryIngestionError,
    );
    expect(
      standalone(Commander, { ...reaction, signalSchema: ReviewRejectedSchema }),
    ).not.toThrow();
    expect(standalone(Commander, { ...reaction, emittedSchemas: [] })).toThrow(
      HandlerRegistryIngestionError,
    );

    const eventReaction = domainHandler("event-reaction");
    expect(standalone(Reactor, eventReaction)).not.toThrow();
    expect(standalone(Reactor, { ...eventReaction, signalSchema: StartReviewSchema })).toThrow(
      HandlerRegistryIngestionError,
    );
    expect(
      standalone(Reactor, { ...eventReaction, signalSchema: ReviewRejectedSchema }),
    ).not.toThrow();
    expect(standalone(Reactor, { ...eventReaction, emittedSchemas: [] })).not.toThrow();
    expect(
      standalone(Reactor, { ...eventReaction, emittedSchemas: [ScheduleReviewSchema] }),
    ).toThrow(HandlerRegistryIngestionError);

    const eventSubscription = domainHandler("event-subscription");
    expect(standalone(Subscriber, eventSubscription)).not.toThrow();
    expect(
      standalone(Subscriber, { ...eventSubscription, signalSchema: ReviewStateSchema }),
    ).toThrow(HandlerRegistryIngestionError);
    expect(
      standalone(Subscriber, { ...eventSubscription, emittedSchemas: [ReviewStartedSchema] }),
    ).toThrow(HandlerRegistryIngestionError);
    const stateSubscription = domainHandler("state-subscription");
    expect(standalone(Subscriber, stateSubscription)).not.toThrow();
    expect(
      standalone(Subscriber, { ...stateSubscription, signalSchema: ReviewStartedSchema }),
    ).toThrow(HandlerRegistryIngestionError);
    expect(standalone(Subscriber, { ...stateSubscription, origin: "external" })).toThrow(
      HandlerRegistryIngestionError,
    );
    expect(
      standalone(Subscriber, {
        ...stateSubscription,
        where: { eventField: "id", equals: "review-1" },
      }),
    ).toThrow(HandlerRegistryIngestionError);
  });
  it("rejects a legacy versioned registry and tells applications to regenerate it", () => {
    expect(() => new HandlerRegistryIngestor().ingest({ version: 4, entities: [] })).toThrow(
      /regenerate/i,
    );
  });
  it("ingests an unversioned entity receiver", () => {
    const metadata = new HandlerRegistryIngestor().ingest({
      receivers: [
        {
          receiverKind: "entity" as const,
          receiverType: Manager,
          stateSchema: StateSchema,
          handlers: [substitution()],
        },
      ],
    });
    expect(metadata[0]?.commandSubstitutions).toHaveLength(1);
  });
  it("rejects an Aggregate command substitution", () => {
    expect(() =>
      new HandlerRegistryIngestor().ingest({
        receivers: [
          {
            receiverKind: "entity" as const,
            receiverType: AggregateReceiver,
            stateSchema: StateSchema,
            handlers: [substitution()],
          },
        ],
      }),
    ).toThrow(HandlerRegistryIngestionError);
  });
  it("rejects a standalone commander that declares Event output", () => {
    expect(() =>
      new HandlerRegistryIngestor().ingest({
        receivers: [
          {
            receiverKind: "standalone" as const,
            receiverType: Commander,
            handlers: [{ ...substitution("replace"), emittedSchemas: [StateSchema] }],
          },
        ],
      }),
    ).toThrow(HandlerRegistryIngestionError);
  });
  it("rejects a standalone assignee that declares Entity state output", () => {
    class Assignee extends AbstractAssignee {
      assign(command: Message<"spine.core.Command">) {
        return command;
      }
    }
    expect(() =>
      new HandlerRegistryIngestor().ingest({
        receivers: [
          {
            receiverKind: "standalone" as const,
            receiverType: Assignee,
            handlers: [
              {
                ...substitution("assign"),
                kind: "command-assignment",
                emittedSchemas: [StateSchema],
              },
            ],
          },
        ],
      }),
    ).toThrow(HandlerRegistryIngestionError);
  });
});
