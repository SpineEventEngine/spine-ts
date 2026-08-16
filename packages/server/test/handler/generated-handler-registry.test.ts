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

import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
  StringValueSchema,
} from "@bufbuild/protobuf/wkt";
import { CommandSchema, EventSchema, file_spine_options } from "@spine-event-engine/proto";
import { describe, expect, expectTypeOf, it } from "vitest";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

import {
  HandlerMetadataError,
  HandlerMetadataRegistry,
  HandlerMetadataRegistryError,
  HandlerRegistryIngestionError,
  HandlerRegistryIngestor,
  type CommandAssignmentHandlerMetadata,
  type CommandReactionHandlerMetadata,
  type EventReactionHandlerMetadata,
} from "../../src/index.js";
import type {
  GeneratedEntityHandlers,
  GeneratedHandlerRecord,
  GeneratedHandlerRegistry,
} from "../../src/handler/generated-handler-registry.js";
import { HandlerMetadataValues } from "../../src/handler/handler-metadata.js";

type ProjectionState = Message<"ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

type AggregateState = Message<"AggregateState"> & {
  id: string;
  name: string;
  archived: boolean;
};

class GeneratedProjection {
  assignCreate(command: Message<"spine.core.Command">): void {
    void command;
  }

  commandFromCommand(command: Message<"spine.core.Command">): void {
    void command;
  }

  subscribeCreated(event: Message<"spine.core.Event">): void {
    void event;
  }

  reactToCreated(event: Message<"spine.core.Event">): void {
    void event;
  }
}

class OtherGeneratedProjection {
  assignCreate(command: Message<"spine.core.Command">): void {
    void command;
  }
}

function createFixtureFileDescriptor(descriptorSetBase64: string, imports = [file_spine_options]) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Server generated handler registry fixture descriptor set is empty.");
  }

  return fileDesc(
    Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"),
    imports,
  );
}

const fileEntityMetadataFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.main.descriptorSetBase64,
);
const ProjectionStateSchema = messageDesc(
  fileEntityMetadataFixture,
  0,
) as GenMessage<ProjectionState>;
const AggregateStateSchema = messageDesc(
  fileEntityMetadataFixture,
  1,
) as GenMessage<AggregateState>;

describe("generated handler registry ingestion", () => {
  it("ingests version-2 state subscriptions separately from Event subscriptions", () => {
    const metadata = new HandlerRegistryIngestor().ingest({
      version: 3,
      entities: [
        {
          entityType: GeneratedProjection,
          stateSchema: ProjectionStateSchema,
          handlers: [
            record("event-subscription", "subscribeCreated", EventSchema, []),
            {
              kind: "state-subscription",
              methodName: "subscribeCreated",
              signalSchema: ProjectionStateSchema,
              emittedSchemas: [],
              parameterCount: 1,
              origin: "domestic",
            },
          ],
        },
      ],
    });
    const entity = metadata[0] as (typeof metadata)[number] & {
      readonly stateSubscriptions: readonly { readonly kind: string }[];
    };

    expect(entity.eventSubscriptions.map((handler) => handler.kind)).toEqual([
      "event-subscription",
    ]);
    expect(entity.stateSubscriptions.map((handler) => handler.kind)).toEqual([
      "state-subscription",
    ]);
  });

  it("rejects version-1 generated registries after the version-2 cutover", () => {
    expect(() => new HandlerRegistryIngestor().ingest({ version: 1, entities: [] })).toThrow(
      /version 1 is not supported/,
    );
  });

  it("rejects an Event subscription record that declares an Entity-state schema", () => {
    expect(() =>
      new HandlerRegistryIngestor().ingest({
        version: 3,
        entities: [
          {
            entityType: GeneratedProjection,
            stateSchema: ProjectionStateSchema,
            handlers: [
              {
                kind: "event-subscription",
                methodName: "subscribeCreated",
                signalSchema: ProjectionStateSchema,
                emittedSchemas: [],
                parameterCount: 1,
                origin: "domestic",
              },
            ],
          },
        ],
      }),
    ).toThrow(/must not declare an entity state schema/);
  });

  it("rejects a state subscription whose signal is not an Entity state", () => {
    expect(() =>
      new HandlerRegistryIngestor().ingest({
        version: 3,
        entities: [
          {
            entityType: GeneratedProjection,
            stateSchema: ProjectionStateSchema,
            handlers: [
              {
                kind: "state-subscription",
                methodName: "subscribeCreated",
                signalSchema: EventSchema,
                emittedSchemas: [],
                parameterCount: 1,
                origin: "domestic",
              },
            ],
          },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_SCHEMA" }));
  });

  it("rejects a filter on a command-input command reactor", () => {
    expect(() =>
      new HandlerRegistryIngestor().ingest({
        version: 3,
        entities: [
          {
            entityType: GeneratedProjection,
            stateSchema: ProjectionStateSchema,
            handlers: [
              {
                ...record("command-reaction", "commandFromCommand", CommandSchema, [CommandSchema]),
                where: { eventField: "id.value", equals: "command" },
              },
            ],
          },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_SCHEMA" }));
  });

  it("ingests generated records into canonical frozen handler metadata", () => {
    const metadata = new HandlerRegistryIngestor().ingest({
      version: 3,
      entities: [
        {
          entityType: GeneratedProjection,
          stateSchema: ProjectionStateSchema,
          handlers: [
            record("command-assignment", "assignCreate", CommandSchema, [EventSchema], 1),
            record("command-reaction", "commandFromCommand", CommandSchema, [CommandSchema], 2),
            record("event-subscription", "subscribeCreated", EventSchema, [], 1),
            record("event-reaction", "reactToCreated", EventSchema, [EventSchema], 2),
          ],
        },
      ],
    });
    const entity = metadata[0];

    expect(metadata).toHaveLength(1);
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(entity?.entityType).toBe(GeneratedProjection);
    expect(entity?.entity.fullTypeName).toBe("ProjectionState");
    expect(entity?.handlers.map((handler) => handler.kind)).toEqual([
      "command-assignment",
      "command-reaction",
      "event-subscription",
      "event-reaction",
    ]);
    expect(entity?.handlers.map((handler) => handler.methodName)).toEqual([
      "assignCreate",
      "commandFromCommand",
      "subscribeCreated",
      "reactToCreated",
    ]);
    expect(entity?.handlers.map((handler) => handler.messageFullTypeName)).toEqual([
      "spine.core.Command",
      "spine.core.Command",
      "spine.core.Event",
      "spine.core.Event",
    ]);
    expect(entity?.handlers.map((handler) => handler.parameterCount)).toEqual([1, 2, 1, 2]);
    expect(entity?.commandAssignments[0]).not.toHaveProperty("emittedSchemas");
    expect(entity?.commandReactions[0]).not.toHaveProperty("emittedSchemas");
    expect(entity?.eventSubscriptions[0]).not.toHaveProperty("emittedSchemas");
    expect(entity?.eventReactions[0]).not.toHaveProperty("emittedSchemas");
    const [assignment] = entity?.commandAssignments ?? [];
    const [commandReaction] = entity?.commandReactions ?? [];
    const [subscription] = entity?.eventSubscriptions ?? [];
    const [eventReaction] = entity?.eventReactions ?? [];

    if (
      assignment === undefined ||
      commandReaction === undefined ||
      subscription === undefined ||
      eventReaction === undefined
    ) {
      throw new Error("Expected generated handler metadata for every handler kind.");
    }
    expect(HandlerMetadataValues.emittedSchemas(assignment)).toEqual([EventSchema]);
    expect(HandlerMetadataValues.emittedSchemas(commandReaction)).toEqual([CommandSchema]);
    expect(HandlerMetadataValues.emittedSchemas(subscription)).toEqual([]);
    expect(HandlerMetadataValues.emittedSchemas(eventReaction)).toEqual([EventSchema]);
    expectTypeOf<CommandAssignmentHandlerMetadata>().not.toHaveProperty("emittedSchemas");
    expectTypeOf<CommandReactionHandlerMetadata>().not.toHaveProperty("emittedSchemas");
    expectTypeOf<EventReactionHandlerMetadata>().not.toHaveProperty("emittedSchemas");
    expect(entity?.commandAssignments[0]).toBe(entity?.handlers[0]);
    expect(entity?.commandReactions[0]).toBe(entity?.handlers[1]);
    expect(entity?.eventSubscriptions[0]).toBe(entity?.handlers[2]);
    expect(entity?.eventReactions[0]).toBe(entity?.handlers[3]);
    expect(entity?.eventApplications).toEqual([]);
    expect(Object.isFrozen(entity)).toBe(true);
    expect(Object.isFrozen(entity?.handlers)).toBe(true);
    expect(Object.isFrozen(entity?.handlers[0])).toBe(true);
  });

  it("preserves and freezes generated Event field filters", () => {
    const where = { eventField: "board", equals: '{"value":"announcements"}' };
    const metadata = new HandlerRegistryIngestor().ingest({
      version: 3,
      entities: [
        {
          entityType: GeneratedProjection,
          stateSchema: ProjectionStateSchema,
          handlers: [
            {
              ...record("event-subscription", "subscribeCreated", EventSchema, []),
              where,
            },
          ],
        },
      ],
    });
    const filter = metadata[0]?.eventSubscriptions[0]?.where;

    expect(filter).toEqual(where);
    expect(filter).not.toBe(where);
    expect(Object.isFrozen(filter)).toBe(true);
  });

  it("accepts normalized generated Event and rejection source names", () => {
    const generatedEvent = {
      ...EventSchema,
      file: { ...EventSchema.file, name: "example/task_events" },
    } as typeof EventSchema;
    const generatedRejection = {
      ...StringValueSchema,
      file: { ...StringValueSchema.file, name: "example/task_rejections" },
    } as unknown as typeof EventSchema;

    for (const signalSchema of [generatedEvent, generatedRejection]) {
      expect(() =>
        new HandlerRegistryIngestor().ingest({
          version: 3,
          entities: [
            {
              entityType: GeneratedProjection,
              stateSchema: ProjectionStateSchema,
              handlers: [
                {
                  ...record("event-subscription", "subscribeCreated", signalSchema, []),
                  where: { eventField: "value", equals: "accepted" },
                },
              ],
            },
          ],
        }),
      ).not.toThrow();
    }
  });

  it("rejects normalized misleading Event source names", () => {
    const misleadingEvent = {
      ...StringValueSchema,
      file: { ...StringValueSchema.file, name: "example/notevents" },
    } as unknown as typeof EventSchema;

    expect(() =>
      new HandlerRegistryIngestor().ingest({
        version: 3,
        entities: [
          {
            entityType: GeneratedProjection,
            stateSchema: ProjectionStateSchema,
            handlers: [
              {
                ...record("event-subscription", "subscribeCreated", misleadingEvent, []),
                where: { eventField: "value", equals: "rejected" },
              },
            ],
          },
        ],
      }),
    ).toThrow(/invalid Event field filter/);
  });

  it("rejects malformed or unsupported generated Event field filters", () => {
    const invalid = [
      { eventField: "", equals: "announcements" },
      { eventField: "board", equals: "announcements", extra: true },
    ];

    for (const where of invalid) {
      expect(() =>
        new HandlerRegistryIngestor().ingest({
          version: 3,
          entities: [
            {
              entityType: GeneratedProjection,
              stateSchema: ProjectionStateSchema,
              handlers: [
                {
                  ...record("event-subscription", "subscribeCreated", EventSchema, []),
                  where,
                },
              ],
            },
          ],
        }),
      ).toThrow(/invalid Event field filter/);
    }

    expect(() =>
      new HandlerRegistryIngestor().ingest({
        version: 3,
        entities: [
          {
            entityType: GeneratedProjection,
            stateSchema: ProjectionStateSchema,
            handlers: [
              {
                ...record("command-assignment", "assignCreate", CommandSchema, [EventSchema]),
                where: { eventField: "board", equals: "announcements" },
              },
            ],
          },
        ],
      }),
    ).toThrow(/invalid Event field filter/);
  });

  it("reports hostile generated filter values through the ingestion error contract", () => {
    for (const where of [null, ["board", "announcements"], 42]) {
      let failure: unknown;
      try {
        new HandlerRegistryIngestor().ingest({
          version: 3,
          entities: [
            {
              entityType: GeneratedProjection,
              stateSchema: ProjectionStateSchema,
              handlers: [
                {
                  ...record("event-subscription", "subscribeCreated", EventSchema, []),
                  where,
                },
              ],
            },
          ],
        });
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(HandlerRegistryIngestionError);
      expect(failure).toMatchObject({ code: "INVALID_SCHEMA" });
    }
  });

  it("rejects filtered generated input from a misleading rejection filename", () => {
    const misleadingSchema = {
      ...StringValueSchema,
      file: {
        ...StringValueSchema.file,
        name: "example/notrejections.proto",
        proto: { ...StringValueSchema.file.proto, name: "example/notrejections.proto" },
      },
    } as unknown as typeof EventSchema;

    expect(() =>
      new HandlerRegistryIngestor().ingest({
        version: 3,
        entities: [
          {
            entityType: GeneratedProjection,
            stateSchema: ProjectionStateSchema,
            handlers: [
              {
                ...record("event-subscription", "subscribeCreated", misleadingSchema, []),
                where: { eventField: "value", equals: "rejected" },
              },
            ],
          },
        ],
      }),
    ).toThrow(/invalid Event field filter/);
  });

  it("accepts generated event reactions with no emitted schemas", () => {
    const metadata = new HandlerRegistryIngestor().ingest({
      version: 3,
      entities: [
        {
          entityType: GeneratedProjection,
          stateSchema: ProjectionStateSchema,
          handlers: [record("event-reaction", "reactToCreated", EventSchema, [])],
        },
      ],
    });
    const [eventReaction] = metadata[0]?.eventReactions ?? [];

    expect(metadata[0]?.handlers).toHaveLength(1);
    if (eventReaction === undefined) {
      throw new Error("Expected no-emission event reaction metadata.");
    }
    expect(eventReaction.methodName).toBe("reactToCreated");
    expect(HandlerMetadataValues.emittedSchemas(eventReaction)).toEqual([]);
  });

  it("accepts concrete entity handler groups in top-level generated registries", () => {
    const group = {
      entityType: GeneratedProjection,
      stateSchema: ProjectionStateSchema,
      handlers: [
        {
          kind: "command-assignment",
          methodName: "assignCreate",
          signalSchema: CommandSchema,
          emittedSchemas: [EventSchema],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    } satisfies GeneratedEntityHandlers<GeneratedProjection, typeof ProjectionStateSchema>;
    const registry = {
      version: 3,
      entities: [group],
    } satisfies GeneratedHandlerRegistry;

    expectTypeOf(group.handlers[0]?.methodName).toEqualTypeOf<"assignCreate" | undefined>();
    expect(new HandlerRegistryIngestor().ingest(registry)[0]?.commandAssignments).toHaveLength(1);
  });

  it("can register ingested metadata into a caller-owned handler metadata registry", () => {
    const registry = new HandlerRegistryIngestor().register({
      version: 3,
      entities: [
        {
          entityType: GeneratedProjection,
          stateSchema: ProjectionStateSchema,
          handlers: [record("command-assignment", "assignCreate", CommandSchema, [EventSchema])],
        },
      ],
    });

    expect(registry).toBeInstanceOf(HandlerMetadataRegistry);
    expect(registry.findCommandAssignment("spine.core.Command")?.entityType).toBe(
      GeneratedProjection,
    );
    expect(registry.listEntityHandlers()).toHaveLength(1);
  });

  it("does not mutate caller-owned registries when registration validation fails", () => {
    const ingestor = new HandlerRegistryIngestor();
    const registry = ingestor.register({
      version: 3,
      entities: [
        {
          entityType: OtherGeneratedProjection,
          stateSchema: AggregateStateSchema,
          handlers: [
            otherRecord("command-assignment", "assignCreate", CommandSchema, [EventSchema]),
          ],
        },
      ],
    });
    const originalEntityHandlers = registry.listEntityHandlers();

    expect(() =>
      ingestor.register(
        {
          version: 3,
          entities: [
            {
              entityType: GeneratedProjection,
              stateSchema: ProjectionStateSchema,
              handlers: [
                record("command-reaction", "commandFromCommand", CommandSchema, [CommandSchema]),
              ],
            },
            {
              entityType: GeneratedProjection,
              stateSchema: ProjectionStateSchema,
              handlers: [
                record("command-assignment", "assignCreate", CommandSchema, [EventSchema]),
              ],
            },
          ],
        },
        registry,
      ),
    ).toThrow(HandlerMetadataRegistryError);
    expect(registry.listEntityHandlers()).toEqual(originalEntityHandlers);
    expect(registry.findHandlersByKind("command-reaction")).toEqual([]);
  });

  it("rejects unsupported generated registry versions", () => {
    expect(() =>
      new HandlerRegistryIngestor().ingest({
        version: 2,
        entities: [],
      }),
    ).toThrow(HandlerRegistryIngestionError);
    expect(() =>
      new HandlerRegistryIngestor().ingest({
        version: 4,
        entities: [],
      }),
    ).toThrow(/version 4 is not supported/);
  });

  it("rejects event-application records", () => {
    expect(() =>
      new HandlerRegistryIngestor().ingest({
        version: 3,
        entities: [
          {
            entityType: GeneratedProjection,
            stateSchema: ProjectionStateSchema,
            handlers: [
              {
                ...record("event-reaction", "reactToCreated", EventSchema, [EventSchema]),
                kind: "event-application",
              },
            ],
          },
        ],
      }),
    ).toThrow(/event-application/);
  });

  it("rejects invalid generated handler arity", () => {
    expect(() =>
      new HandlerRegistryIngestor().ingest({
        version: 3,
        entities: [
          {
            entityType: GeneratedProjection,
            stateSchema: ProjectionStateSchema,
            handlers: [
              {
                ...record("command-assignment", "assignCreate", CommandSchema, [EventSchema]),
                parameterCount: 3,
              },
            ],
          },
        ],
      }),
    ).toThrow(/unsupported parameter count 3/);
  });

  it("rejects malformed generated state, signal, and emitted schemas", () => {
    for (const registry of [
      {
        version: 3,
        entities: [
          {
            entityType: GeneratedProjection,
            stateSchema: null,
            handlers: [record("command-assignment", "assignCreate", CommandSchema, [EventSchema])],
          },
        ],
      },
      {
        version: 3,
        entities: [
          {
            entityType: GeneratedProjection,
            stateSchema: ProjectionStateSchema,
            handlers: [
              record(
                "command-assignment",
                "assignCreate",
                { typeName: "" } as unknown as typeof CommandSchema,
                [EventSchema],
              ),
            ],
          },
        ],
      },
      {
        version: 3,
        entities: [
          {
            entityType: GeneratedProjection,
            stateSchema: ProjectionStateSchema,
            handlers: [
              record("command-assignment", "assignCreate", CommandSchema, [
                { typeName: undefined } as unknown as typeof EventSchema,
              ]),
            ],
          },
        ],
      },
    ]) {
      expect(() => new HandlerRegistryIngestor().ingest(registry)).toThrow(
        HandlerRegistryIngestionError,
      );
      expect(() => new HandlerRegistryIngestor().ingest(registry)).toThrow(/non-empty typeName/);
    }
  });

  it("rejects empty emitted schemas for command-producing generated handler kinds", () => {
    for (const [kind, methodName, signalSchema] of [
      ["command-assignment", "assignCreate", CommandSchema],
      ["command-reaction", "commandFromCommand", CommandSchema],
    ] as const) {
      expect(() =>
        new HandlerRegistryIngestor().ingest({
          version: 3,
          entities: [
            {
              entityType: GeneratedProjection,
              stateSchema: ProjectionStateSchema,
              handlers: [record(kind, methodName, signalSchema, [])],
            },
          ],
        }),
      ).toThrow(/must declare at least one emitted schema/);
    }
  });

  it("rejects emitted schemas on generated event subscriptions", () => {
    expect(() =>
      new HandlerRegistryIngestor().ingest({
        version: 3,
        entities: [
          {
            entityType: GeneratedProjection,
            stateSchema: ProjectionStateSchema,
            handlers: [
              record("event-subscription", "subscribeCreated", EventSchema, [EventSchema]),
            ],
          },
        ],
      }),
    ).toThrow(/must not declare emitted schemas/);
  });

  it("keeps method validation in EntityHandlers.define", () => {
    expect(() =>
      new HandlerRegistryIngestor().ingest({
        version: 3,
        entities: [
          {
            entityType: GeneratedProjection,
            stateSchema: ProjectionStateSchema,
            handlers: [
              record("command-assignment", "missingMethod" as never, CommandSchema, [EventSchema]),
            ],
          },
        ],
      }),
    ).toThrow(HandlerMetadataError);
  });

  it("keeps duplicate validation in HandlerMetadataRegistry", () => {
    expect(() =>
      new HandlerRegistryIngestor().register({
        version: 3,
        entities: [
          {
            entityType: GeneratedProjection,
            stateSchema: ProjectionStateSchema,
            handlers: [record("command-assignment", "assignCreate", CommandSchema, [EventSchema])],
          },
          {
            entityType: OtherGeneratedProjection,
            stateSchema: AggregateStateSchema,
            handlers: [record("command-assignment", "assignCreate", CommandSchema, [EventSchema])],
          },
        ],
      }),
    ).toThrow(HandlerMetadataRegistryError);
  });
});

function record<Instance extends GeneratedProjection>(
  kind: GeneratedHandlerRecord<Instance>["kind"],
  methodName: GeneratedHandlerRecord<Instance>["methodName"],
  signalSchema: typeof CommandSchema | typeof EventSchema,
  emittedSchemas: readonly (typeof CommandSchema | typeof EventSchema)[],
  parameterCount: 1 | 2 = 1,
): GeneratedHandlerRecord<Instance> {
  return {
    kind,
    methodName,
    signalSchema,
    emittedSchemas,
    parameterCount,
    origin: "domestic",
  };
}

function otherRecord<Instance extends OtherGeneratedProjection>(
  kind: GeneratedHandlerRecord<Instance>["kind"],
  methodName: GeneratedHandlerRecord<Instance>["methodName"],
  signalSchema: typeof CommandSchema | typeof EventSchema,
  emittedSchemas: readonly (typeof CommandSchema | typeof EventSchema)[],
  parameterCount: 1 | 2 = 1,
): GeneratedHandlerRecord<Instance> {
  return {
    kind,
    methodName,
    signalSchema,
    emittedSchemas,
    parameterCount,
    origin: "domestic",
  };
}
