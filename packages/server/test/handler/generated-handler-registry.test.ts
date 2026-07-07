import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { CommandSchema, EventSchema, file_spine_options } from "@spine-ts/proto";
import { describe, expect, expectTypeOf, it } from "vitest";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

import {
  HandlerMetadataError,
  HandlerMetadataRegistry,
  HandlerMetadataRegistryError,
  HandlerRegistryIngestionError,
  HandlerRegistryIngestor,
  type GeneratedEntityHandlers,
  type GeneratedHandlerRecord,
  type GeneratedHandlerRegistry,
} from "../../src/index.js";

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
  it("ingests generated records into canonical frozen handler metadata", () => {
    const metadata = new HandlerRegistryIngestor().ingest({
      version: 1,
      entities: [
        {
          entityType: GeneratedProjection,
          stateSchema: ProjectionStateSchema,
          handlers: [
            record("command-assignment", "assignCreate", CommandSchema, [EventSchema], 1),
            record("command-reaction", "commandFromCommand", CommandSchema, [CommandSchema], 2),
            record("event-subscription", "subscribeCreated", EventSchema, [], 1),
            record("event-reaction", "reactToCreated", EventSchema, [], 2),
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
    expect(entity?.commandAssignments[0]).toBe(entity?.handlers[0]);
    expect(entity?.commandReactions[0]).toBe(entity?.handlers[1]);
    expect(entity?.eventSubscriptions[0]).toBe(entity?.handlers[2]);
    expect(entity?.eventReactions[0]).toBe(entity?.handlers[3]);
    expect(entity?.eventApplications).toEqual([]);
    expect(Object.isFrozen(entity)).toBe(true);
    expect(Object.isFrozen(entity?.handlers)).toBe(true);
    expect(Object.isFrozen(entity?.handlers[0])).toBe(true);
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
        },
      ],
    } satisfies GeneratedEntityHandlers<GeneratedProjection, typeof ProjectionStateSchema>;
    const registry = {
      version: 1,
      entities: [group],
    } satisfies GeneratedHandlerRegistry;

    expectTypeOf(group.handlers[0]?.methodName).toEqualTypeOf<"assignCreate" | undefined>();
    expect(new HandlerRegistryIngestor().ingest(registry)[0]?.commandAssignments).toHaveLength(1);
  });

  it("can register ingested metadata into a caller-owned handler metadata registry", () => {
    const registry = new HandlerRegistryIngestor().register({
      version: 1,
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
      version: 1,
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
          version: 1,
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
      } as never),
    ).toThrow(HandlerRegistryIngestionError);
    expect(() =>
      new HandlerRegistryIngestor().ingest({
        version: 2,
        entities: [],
      } as never),
    ).toThrow(/version 2 is not supported/);
  });

  it("rejects event-application records", () => {
    expect(() =>
      new HandlerRegistryIngestor().ingest({
        version: 1,
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
      } as never),
    ).toThrow(/event-application/);
  });

  it("rejects invalid generated handler arity", () => {
    expect(() =>
      new HandlerRegistryIngestor().ingest({
        version: 1,
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
      } as never),
    ).toThrow(/unsupported parameter count 3/);
  });

  it("rejects malformed generated state, signal, and emitted schemas", () => {
    for (const registry of [
      {
        version: 1,
        entities: [
          {
            entityType: GeneratedProjection,
            stateSchema: null,
            handlers: [record("command-assignment", "assignCreate", CommandSchema, [EventSchema])],
          },
        ],
      },
      {
        version: 1,
        entities: [
          {
            entityType: GeneratedProjection,
            stateSchema: ProjectionStateSchema,
            handlers: [
              record(
                "command-assignment",
                "assignCreate",
                { typeName: "" } as typeof CommandSchema,
                [EventSchema],
              ),
            ],
          },
        ],
      },
      {
        version: 1,
        entities: [
          {
            entityType: GeneratedProjection,
            stateSchema: ProjectionStateSchema,
            handlers: [
              record("command-assignment", "assignCreate", CommandSchema, [
                { typeName: undefined } as typeof EventSchema,
              ]),
            ],
          },
        ],
      },
    ]) {
      expect(() => new HandlerRegistryIngestor().ingest(registry as never)).toThrow(
        HandlerRegistryIngestionError,
      );
      expect(() => new HandlerRegistryIngestor().ingest(registry as never)).toThrow(
        /non-empty typeName/,
      );
    }
  });

  it("rejects empty emitted schemas for emitting generated handler kinds", () => {
    for (const [kind, methodName, signalSchema] of [
      ["command-assignment", "assignCreate", CommandSchema],
      ["command-reaction", "commandFromCommand", CommandSchema],
    ] as const) {
      expect(() =>
        new HandlerRegistryIngestor().ingest({
          version: 1,
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

  it("allows zero emitted schemas on generated event reactions", () => {
    const metadata = new HandlerRegistryIngestor().ingest({
      version: 1,
      entities: [
        {
          entityType: GeneratedProjection,
          stateSchema: ProjectionStateSchema,
          handlers: [record("event-reaction", "reactToCreated", EventSchema, [])],
        },
      ],
    });

    expect(metadata[0]?.eventReactions[0]?.methodName).toBe("reactToCreated");
  });

  it("rejects emitted schemas on generated event subscriptions", () => {
    expect(() =>
      new HandlerRegistryIngestor().ingest({
        version: 1,
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

  it("keeps method validation in defineEntityHandlers", () => {
    expect(() =>
      new HandlerRegistryIngestor().ingest({
        version: 1,
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
        version: 1,
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
  };
}
