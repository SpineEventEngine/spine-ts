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

import {
  clone,
  create,
  fromBinary,
  toBinary,
  type Message,
  type MessageShape,
} from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  DescriptorProtoSchema,
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FieldDescriptorProtoSchema,
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
} from "@bufbuild/protobuf/wkt";
import { AnyMessages, SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import {
  CommandContextSchema,
  CommandIdSchema,
  UserIdSchema,
  file_spine_options,
  type UserId,
} from "@spine-event-engine/proto";
import {
  QueryIdSchema,
  type QueryResponse,
  QuerySchema,
  TargetFiltersSchema,
  TargetSchema,
} from "@spine-event-engine/proto/client";
import {
  Aggregate,
  BoundedContext,
  type EntityHandlersMetadata,
  EventRouting,
  HandlerRegistryIngestor,
  ProcessManager,
  Projection,
  Repository,
} from "@spine-event-engine/server";
import type { GeneratedHandlerRegistry } from "@spine-event-engine/server/spi/handler-registry";
import { describe, expect, it } from "vitest";

import { BlackBox } from "@spine-event-engine/testing";
import { processManagerDescriptorSetBase64 } from "../src/fixtures/entity-metadata-fixtures.js";
import { testingDescriptorSetBase64 } from "../src/fixtures/main-descriptor.js";

type CompositeId = Message<"CompositeId"> & { reader?: UserId; number: number };
type FanoutEvent = Message<"FanoutEvent"> & { id?: CompositeId; name: string };
type FollowUpAccepted = Message<"FanoutFollowUpAccepted"> & { id?: CompositeId; name: string };
type AggregateState = Message<"FanoutAggregateState"> & { id?: CompositeId; name: string };
type PmState = Message & { id?: CompositeId; queue: string };
type ProjectionState = Message & { id?: CompositeId; name: string };

const sourceFile = (() => {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(testingDescriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];
  if (descriptor === undefined) throw new Error("Testing descriptor fixture is empty.");
  return descriptor;
})();
const processManagerSource = (() => {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(processManagerDescriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0]?.messageType.find(
    (message) => message.name === "ProcessManagerState",
  );
  if (descriptor === undefined) throw new Error("Process Manager fixture is missing.");
  return descriptor;
})();

function schema<T extends Message>(
  file: Parameters<typeof messageDesc>[0],
  name: string,
): GenMessage<T> {
  const index = file.proto.messageType.findIndex((message) => message.name === name);
  if (index < 0) throw new Error(`Fixture message declaration "${name}" is missing.`);
  return messageDesc(file, index);
}

const fanoutFile = (() => {
  const descriptor = clone(FileDescriptorProtoSchema, sourceFile);
  const aggregate = descriptor.messageType.find((message) => message.name === "AggregateState");
  const projection = descriptor.messageType.find((message) => message.name === "ProjectionState");
  const originalId = projection?.field.find((field) => field.name === "id");
  if (aggregate === undefined || projection === undefined || originalId === undefined) {
    throw new Error("Fan-out source declarations are missing.");
  }
  descriptor.name = "cross_repository_event_fanout.proto";
  const id = clone(DescriptorProtoSchema, projection);
  id.name = "CompositeId";
  id.field = [
    create(FieldDescriptorProtoSchema, {
      ...clone(FieldDescriptorProtoSchema, originalId),
      name: "reader",
      number: 1,
      label: FieldDescriptorProto_Label.OPTIONAL,
      type: FieldDescriptorProto_Type.MESSAGE,
      typeName: ".spine.core.UserId",
      jsonName: "reader",
    }),
    create(FieldDescriptorProtoSchema, {
      name: "number",
      number: 2,
      label: FieldDescriptorProto_Label.OPTIONAL,
      type: FieldDescriptorProto_Type.INT32,
      jsonName: "number",
    }),
  ];
  const withId = (source: typeof projection, name: string) => {
    const state = clone(DescriptorProtoSchema, source);
    state.name = name;
    const stateId = state.field.find((field) => field.name === "id");
    if (stateId === undefined) throw new Error(`${name} has no ID field.`);
    stateId.type = FieldDescriptorProto_Type.MESSAGE;
    stateId.typeName = ".CompositeId";
    return state;
  };
  const event = withId(projection, "FanoutEvent");
  event.options = undefined;
  const followUpEvent = withId(projection, "FanoutFollowUpAccepted");
  followUpEvent.options = undefined;
  descriptor.messageType = [
    id,
    withId(aggregate, "FanoutAggregateState"),
    event,
    followUpEvent,
    withId(processManagerSource, "FanoutProcessManagerBState"),
    withId(processManagerSource, "FanoutProcessManagerCState"),
    withId(processManagerSource, "FanoutProcessManagerDState"),
    withId(projection, "FanoutProjectionEState"),
    withId(projection, "FanoutProjectionFState"),
  ];
  descriptor.dependency.push(UserIdSchema.file.proto.name);
  return fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [
    file_spine_options,
    UserIdSchema.file,
  ]);
})();

const CompositeIdSchema = schema<CompositeId>(fanoutFile, "CompositeId");
const AggregateStateSchema = schema<AggregateState>(fanoutFile, "FanoutAggregateState");
const FanoutEventSchema = schema<FanoutEvent>(fanoutFile, "FanoutEvent");
const FollowUpAcceptedSchema = schema<FollowUpAccepted>(fanoutFile, "FanoutFollowUpAccepted");
const PmBSchema = schema<PmState>(fanoutFile, "FanoutProcessManagerBState");
const PmCSchema = schema<PmState>(fanoutFile, "FanoutProcessManagerCState");
const PmDSchema = schema<PmState>(fanoutFile, "FanoutProcessManagerDState");
const ProjectionESchema = schema<ProjectionState>(fanoutFile, "FanoutProjectionEState");
const ProjectionFSchema = schema<ProjectionState>(fanoutFile, "FanoutProjectionFState");

class FanoutAggregate extends Aggregate<CompositeId, typeof AggregateStateSchema, bigint> {
  assign(command: AggregateState): FanoutEvent | FollowUpAccepted {
    this.update((draft) => Object.assign(draft, command));
    return command.name === "fan out"
      ? create(FanoutEventSchema, { id: composite("event", 99), name: command.name })
      : create(FollowUpAcceptedSchema, { id: composite("follow-up", 100), name: command.name });
  }
}

class FanoutProcessManagerB extends ProcessManager<CompositeId, typeof PmBSchema, number> {
  react(event: FanoutEvent): void {
    this.update((draft) => Object.assign(draft, { id: this.id, queue: event.name }));
  }
}
class FanoutProcessManagerC extends ProcessManager<CompositeId, typeof PmCSchema, number> {
  react(event: FanoutEvent): void {
    this.update((draft) => Object.assign(draft, { id: this.id, queue: event.name }));
  }
}
class FanoutProcessManagerD extends ProcessManager<CompositeId, typeof PmDSchema, number> {
  command(event: FanoutEvent): AggregateState {
    this.update((draft) => Object.assign(draft, { id: this.id, queue: event.name }));
    return create(AggregateStateSchema, { id: this.id, name: "follow up" });
  }
}
class FanoutProjectionE extends Projection<CompositeId, typeof ProjectionESchema, number> {
  subscribe(event: FanoutEvent): void {
    this.update((draft) => Object.assign(draft, { id: this.id, name: event.name }));
  }
}
class FanoutProjectionF extends Projection<CompositeId, typeof ProjectionFSchema, number> {
  subscribe(event: FanoutEvent): void {
    this.update((draft) => Object.assign(draft, { id: this.id, name: event.name }));
  }
}

const generatedHandlerRegistry: GeneratedHandlerRegistry = {
  version: 3,
  entities: [
    {
      entityType: FanoutAggregate,
      stateSchema: AggregateStateSchema,
      handlers: [
        {
          kind: "command-assignment",
          methodName: "assign",
          signalSchema: AggregateStateSchema,
          emittedSchemas: [FanoutEventSchema, FollowUpAcceptedSchema],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    },
    {
      entityType: FanoutProcessManagerB,
      stateSchema: PmBSchema,
      handlers: [
        {
          kind: "event-reaction",
          methodName: "react",
          signalSchema: FanoutEventSchema,
          emittedSchemas: [],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    },
    {
      entityType: FanoutProcessManagerC,
      stateSchema: PmCSchema,
      handlers: [
        {
          kind: "event-reaction",
          methodName: "react",
          signalSchema: FanoutEventSchema,
          emittedSchemas: [],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    },
    {
      entityType: FanoutProcessManagerD,
      stateSchema: PmDSchema,
      handlers: [
        {
          kind: "command-reaction",
          methodName: "command",
          signalSchema: FanoutEventSchema,
          emittedSchemas: [AggregateStateSchema],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    },
    {
      entityType: FanoutProjectionE,
      stateSchema: ProjectionESchema,
      handlers: [
        {
          kind: "event-subscription",
          methodName: "subscribe",
          signalSchema: FanoutEventSchema,
          emittedSchemas: [],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    },
    {
      entityType: FanoutProjectionF,
      stateSchema: ProjectionFSchema,
      handlers: [
        {
          kind: "event-subscription",
          methodName: "subscribe",
          signalSchema: FanoutEventSchema,
          emittedSchemas: [],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    },
  ],
};
const generatedHandlers = new HandlerRegistryIngestor().ingest(generatedHandlerRegistry);
function handlersFor<Instance extends object, Schema extends GenMessage<Message>>(
  entityType: object,
  stateSchema: Schema,
): EntityHandlersMetadata<Instance, Schema> {
  const handlers = generatedHandlers.find(
    (candidate) =>
      candidate.entityType === entityType && candidate.entity.fullTypeName === stateSchema.typeName,
  );
  if (handlers === undefined) throw new Error("Generated handler fixture is missing an Entity.");
  return handlers as EntityHandlersMetadata<Instance, Schema>;
}

function composite(reader: string, number: number): CompositeId {
  return create(CompositeIdSchema, { reader: create(UserIdSchema, { value: reader }), number });
}
function routeTo(id: CompositeId): EventRouting<CompositeId> {
  return EventRouting.create<CompositeId>().route(FanoutEventSchema, () => [id]);
}
function query(schema: GenMessage<Message>, id: CompositeId) {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: crypto.randomUUID() }),
    target: create(TargetSchema, {
      type: TypeUrls.derive(schema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, {
          idFilter: { id: [AnyMessages.pack(CompositeIdSchema, id)] },
        }),
      },
    }),
  });
}
function queryState<Schema extends GenMessage<Message>>(
  response: QueryResponse,
  schema: Schema,
): MessageShape<Schema> {
  if (response.message.length !== 1) {
    throw new Error(
      `Expected one Query response state, received ${String(response.message.length)}.`,
    );
  }
  const state = response.message[0]?.state;
  if (state === undefined) throw new Error("Query response state is missing.");
  const unpacked = AnyMessages.unpack(state, schema);
  if (unpacked === undefined)
    throw new Error(`Query response does not contain ${schema.typeName}.`);
  return unpacked;
}
function aggregateRepository(): Repository<typeof FanoutAggregate> {
  return new Repository<typeof FanoutAggregate>({
    entityType: FanoutAggregate,
    schema: AggregateStateSchema,
    handlers: handlersFor<FanoutAggregate, typeof AggregateStateSchema>(
      FanoutAggregate,
      AggregateStateSchema,
    ),
    events: [FanoutEventSchema, FollowUpAcceptedSchema],
  });
}
function processManagerBRepository(
  eventRouting: EventRouting<CompositeId>,
): Repository<typeof FanoutProcessManagerB> {
  return new Repository<typeof FanoutProcessManagerB>({
    entityType: FanoutProcessManagerB,
    schema: PmBSchema,
    handlers: handlersFor<FanoutProcessManagerB, typeof PmBSchema>(
      FanoutProcessManagerB,
      PmBSchema,
    ),
    eventRouting,
  });
}
function processManagerCRepository(
  eventRouting: EventRouting<CompositeId>,
): Repository<typeof FanoutProcessManagerC> {
  return new Repository<typeof FanoutProcessManagerC>({
    entityType: FanoutProcessManagerC,
    schema: PmCSchema,
    handlers: handlersFor<FanoutProcessManagerC, typeof PmCSchema>(
      FanoutProcessManagerC,
      PmCSchema,
    ),
    eventRouting,
  });
}
function processManagerDRepository(): Repository<typeof FanoutProcessManagerD> {
  return new Repository<typeof FanoutProcessManagerD>({
    entityType: FanoutProcessManagerD,
    schema: PmDSchema,
    handlers: handlersFor<FanoutProcessManagerD, typeof PmDSchema>(
      FanoutProcessManagerD,
      PmDSchema,
    ),
  });
}
function projectionERepository(
  eventRouting: EventRouting<CompositeId>,
): Repository<typeof FanoutProjectionE> {
  return new Repository<typeof FanoutProjectionE>({
    entityType: FanoutProjectionE,
    schema: ProjectionESchema,
    handlers: handlersFor<FanoutProjectionE, typeof ProjectionESchema>(
      FanoutProjectionE,
      ProjectionESchema,
    ),
    eventRouting,
  });
}
function projectionFRepository(): Repository<typeof FanoutProjectionF> {
  return new Repository<typeof FanoutProjectionF>({
    entityType: FanoutProjectionF,
    schema: ProjectionFSchema,
    handlers: handlersFor<FanoutProjectionF, typeof ProjectionFSchema>(
      FanoutProjectionF,
      ProjectionFSchema,
    ),
  });
}
function context(
  routeE: EventRouting<CompositeId> | undefined,
  b: CompositeId,
  c: CompositeId,
  e: CompositeId,
) {
  return BoundedContext.singleTenant("cross repository event fanout")
    .add(aggregateRepository())
    .add(processManagerBRepository(routeTo(b)))
    .add(processManagerCRepository(routeTo(c)))
    .add(processManagerDRepository())
    .add(projectionERepository(routeE ?? routeTo(e)))
    .add(projectionFRepository())
    .build();
}
async function awaitStates(
  context: BoundedContext,
  aggregateId: CompositeId,
  reads: readonly (() => Promise<unknown>)[],
) {
  const deadline = Date.now() + 1_000;
  let last: readonly unknown[] = [];
  while (Date.now() < deadline) {
    last = await Promise.all(reads.map((read) => read()));
    const aggregate = await context.stand().read(AggregateStateSchema, aggregateId);
    if (last.every((state) => state !== undefined) && aggregate?.name === "follow up") return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(
    `Timed out waiting for fan-out Entity states: ${last.map((state) => state === undefined).join(",")}.`,
  );
}
async function post(context: BoundedContext, id: CompositeId) {
  await context.commandBus().post(
    SignalEnvelopes.command({
      id: create(CommandIdSchema, { uuid: crypto.randomUUID() }),
      context: create(CommandContextSchema),
      schema: AggregateStateSchema,
      message: create(AggregateStateSchema, { id, name: "fan out" }),
    }),
  );
}

describe("cross-repository Aggregate Event fan-out", () => {
  it("updates all custom and producer-ID routed Entity states", async () => {
    const a = composite("aggregate", 1),
      b = composite("pm-b", 2),
      c = composite("pm-c", 3),
      e = composite("projection-e", 4);
    const boundedContext = context(undefined, b, c, e);
    try {
      await post(boundedContext, a);
      await awaitStates(boundedContext, a, [
        () => boundedContext.stand().read(PmBSchema, b),
        () => boundedContext.stand().read(PmCSchema, c),
        () => boundedContext.stand().read(PmDSchema, a),
        () => boundedContext.stand().read(ProjectionESchema, e),
        () => boundedContext.stand().read(ProjectionFSchema, a),
      ]);
      await expect(boundedContext.stand().read(PmBSchema, b)).resolves.toMatchObject({
        id: b,
        queue: "fan out",
      });
      await expect(boundedContext.stand().read(PmCSchema, c)).resolves.toMatchObject({
        id: c,
        queue: "fan out",
      });
      await expect(boundedContext.stand().read(PmDSchema, a)).resolves.toMatchObject({
        id: a,
        queue: "fan out",
      });
      await expect(boundedContext.stand().read(ProjectionESchema, e)).resolves.toMatchObject({
        id: e,
        name: "fan out",
      });
      await expect(boundedContext.stand().read(ProjectionFSchema, a)).resolves.toMatchObject({
        id: a,
        name: "fan out",
      });
      await expect(boundedContext.stand().read(AggregateStateSchema, a)).resolves.toMatchObject({
        id: a,
        name: "follow up",
      });
    } finally {
      await boundedContext.close();
    }
  });

  it("suppresses only the Entity with an empty custom Event route", async () => {
    const a = composite("aggregate", 1),
      b = composite("pm-b", 2),
      c = composite("pm-c", 3),
      e = composite("projection-e", 4);
    const none = EventRouting.create<CompositeId>().route(FanoutEventSchema, () => []);
    const boundedContext = context(none, b, c, e);
    try {
      await post(boundedContext, a);
      await awaitStates(boundedContext, a, [
        () => boundedContext.stand().read(PmBSchema, b),
        () => boundedContext.stand().read(PmCSchema, c),
        () => boundedContext.stand().read(PmDSchema, a),
        () => boundedContext.stand().read(ProjectionFSchema, a),
      ]);
      await expect(boundedContext.stand().read(ProjectionESchema, e)).resolves.toBeUndefined();
      await expect(boundedContext.stand().read(PmBSchema, b)).resolves.toMatchObject({
        id: b,
        queue: "fan out",
      });
      await expect(boundedContext.stand().read(PmCSchema, c)).resolves.toMatchObject({
        id: c,
        queue: "fan out",
      });
      await expect(boundedContext.stand().read(PmDSchema, a)).resolves.toMatchObject({
        id: a,
        queue: "fan out",
      });
      await expect(boundedContext.stand().read(ProjectionFSchema, a)).resolves.toMatchObject({
        id: a,
        name: "fan out",
      });
      await expect(boundedContext.stand().read(AggregateStateSchema, a)).resolves.toMatchObject({
        id: a,
        name: "follow up",
      });
    } finally {
      await boundedContext.close();
    }
  });

  it("reaches the same persisted states through the public BlackBox API", async () => {
    const a = composite("aggregate", 1),
      b = composite("pm-b", 2),
      c = composite("pm-c", 3),
      e = composite("projection-e", 4);
    const boundedContext = context(undefined, b, c, e);
    const blackBox = await BlackBox.from(boundedContext);
    try {
      const scope = blackBox.asGuest();
      const posted = await scope.post(
        AggregateStateSchema,
        create(AggregateStateSchema, { id: a, name: "fan out" }),
      );
      expect(posted.kind).toBe("ok");
      const results = await blackBox.eventually(
        () =>
          Promise.all([
            scope.send(query(AggregateStateSchema, a)),
            scope.send(query(PmBSchema, b)),
            scope.send(query(PmCSchema, c)),
            scope.send(query(PmDSchema, a)),
            scope.send(query(ProjectionESchema, e)),
            scope.send(query(ProjectionFSchema, a)),
          ]),
        (candidate) => {
          const aggregateState = candidate[0].message[0]?.state;
          return (
            candidate.every((result) => result.message.length === 1) &&
            aggregateState !== undefined &&
            AnyMessages.unpack(aggregateState, AggregateStateSchema)?.name === "follow up"
          );
        },
      );
      expect(queryState(results[0], AggregateStateSchema)).toMatchObject({
        id: a,
        name: "follow up",
      });
      expect(queryState(results[1], PmBSchema)).toMatchObject({
        id: b,
        queue: "fan out",
      });
      expect(queryState(results[2], PmCSchema)).toMatchObject({
        id: c,
        queue: "fan out",
      });
      expect(queryState(results[3], PmDSchema)).toMatchObject({
        id: a,
        queue: "fan out",
      });
      expect(queryState(results[4], ProjectionESchema)).toMatchObject({
        id: e,
        name: "fan out",
      });
      expect(queryState(results[5], ProjectionFSchema)).toMatchObject({
        id: a,
        name: "fan out",
      });
    } finally {
      await blackBox.close();
    }
  });
});
