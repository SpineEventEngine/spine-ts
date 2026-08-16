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
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { TypeUrls } from "@spine-event-engine/core";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, expectTypeOf, it } from "vitest";
import { CommandSchema, file_spine_options } from "@spine-event-engine/proto";
import {
  serverEntityMetadataFixtureGeneration,
  serverEntityMetadataTestFixtures,
} from "../test-fixtures/entity-metadata-fixtures.js";

import * as serverRoot from "../src/index.js";
import {
  BoundedContext,
  CommandBus,
  type CommandDispatcher,
  type DeliveryInbox,
  type DeliveryOperationOptions,
  type DeliveryWorkSession,
  CommandRegistrationReadiness,
  type CommandRegistrationAssigneeMetadata,
  type CommandRegistrationReadinessLookup,
  EventBus,
  type EventDispatcher,
  type EventContextInput,
  EventRegistrationReadiness,
  type EventRegistrationApplicationMetadata,
  type EventRegistrationReadinessLookup,
  type EventRegistrationReactorMetadata,
  type EventRegistrationSubscriberMetadata,
  FixedClock,
  Environment,
  EnvironmentType,
  ServerEnvironment,
  type ServerEnvironmentSettings,
  describeEntityMetadata,
  DescriptorMetadataError,
  isEntitySchema,
  type BoundedContextName,
  type ReadCatchUpResult,
  type BoundedContextSnapshot,
  type CommandEndpoint,
  type EventEndpoint,
  type TenantMode,
  Stand,
  type StandReadResult,
  StandStateTypeError,
  type StandSubscription,
  type StandUpdate,
  Aggregate,
  type EntityVersionMetadata,
  Inbox,
  type InboxMessage,
  InboxStorage,
  type PlainEntityVersionMetadata,
  type PrimitiveId,
  Repository,
  ShardIndex,
  ShardSession,
  HandlerMetadataRegistry,
  HandlerRegistryIngestionError,
  HandlerRegistryIngestor,
  GeneratedRegistryDiscovery,
  GeneratedRegistryDiscoveryError,
  type RegistryDiscoveryErrorCode,
  EntityHandlers,
  type HandlerParameterCount,
  type RegistryIngestionErrorCode,
  type RuntimeStateErrorCode,
  type ServerRuntimeLifecycle,
  type ServerRuntimeRejectedState,
  ServerRuntimeStateError,
  acceptSignalIntake,
  failSignalIntake,
  type SignalIntakeAcceptedFor,
  type SignalIntakeFailureCode,
  type SignalIntakeResult,
  type SignalKind,
  SignalIds,
  SignalMetadata,
  type SignalMetadataOptions,
  SingleProcessServerRuntime,
  SystemClock,
  createRoutingPlan,
} from "../src/index.js";

type ProjectionState = Message<"ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

interface ExportedRevisionMetadata {
  readonly revision: number;
  readonly source: "server";
  readonly labels?: readonly string[];
}

interface ExportedSizedMetadata {
  readonly revision: number;
  readonly size: number;
}

type AggregateState = Message<"AggregateState"> & {
  id: string;
  name: string;
  archived: boolean;
};

type GenericState = Message<"GenericState"> & {
  id: string;
  searchable: boolean;
};

type EmptyState = Message<"EmptyState">;
type UnknownKindState = Message<"UnknownKindState"> & { id: string };
type InvalidColumnState = Message<"InvalidColumnState"> & {
  id: string;
  tags: string[];
};
type InvalidTagState = Message<"InvalidTagState"> & { id: string };
type ProcessManagerState = Message<"ProcessManagerState"> & { id: string; queue: string };
type FullVisibilityState = Message<"FullVisibilityState"> & { id: string };
type HiddenState = Message<"HiddenState"> & { id: string };

function createFixtureFileDescriptor(descriptorSetBase64: string, imports = [file_spine_options]) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Server entity metadata fixture descriptor set is empty.");
  }

  return fileDesc(
    Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"),
    imports,
  );
}

// Descriptor fixtures are generated from checked-in test-only .proto sources.
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
const GenericStateSchema = messageDesc(fileEntityMetadataFixture, 2) as GenMessage<GenericState>;

class PublicRuntimeSmokeAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  assignCommand(command: Message<"spine.core.Command">): void {
    void command;
  }

  onAggregateChanged(event: AggregateState): void {
    void event;
  }
}

const fileEntityEmptyFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.empty.descriptorSetBase64,
);
const EmptyStateSchema = messageDesc(fileEntityEmptyFixture, 0) as GenMessage<EmptyState>;

const fileEntityUnknownKindFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.unknownKind.descriptorSetBase64,
);
const UnknownKindStateSchema = messageDesc(
  fileEntityUnknownKindFixture,
  0,
) as GenMessage<UnknownKindState>;

const fileEntityInvalidColumnFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.invalidColumn.descriptorSetBase64,
);
const InvalidColumnStateSchema = messageDesc(
  fileEntityInvalidColumnFixture,
  0,
) as GenMessage<InvalidColumnState>;

const fileEntityInvalidTagFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.invalidTag.descriptorSetBase64,
);
const InvalidTagStateSchema = messageDesc(
  fileEntityInvalidTagFixture,
  0,
) as GenMessage<InvalidTagState>;

const fileEntityVisibilityFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.visibility.descriptorSetBase64,
);
const ProcessManagerStateSchema = messageDesc(
  fileEntityVisibilityFixture,
  0,
) as GenMessage<ProcessManagerState>;
const FullVisibilityStateSchema = messageDesc(
  fileEntityVisibilityFixture,
  1,
) as GenMessage<FullVisibilityState>;
const HiddenStateSchema = messageDesc(fileEntityVisibilityFixture, 2) as GenMessage<HiddenState>;

describe("@spine-event-engine/server", () => {
  it("exports the descriptor-derived entity and handler metadata surface", () => {
    expect(Object.keys(serverRoot).sort()).toEqual(
      [
        "Aggregate",
        "AlreadyPickedUp",
        "Apply",
        "Assign",
        "BoundedContext",
        "BoundedContextBuilder",
        "BoundedContextNameError",
        "CommandBus",
        "CommandRegistrationReadiness",
        "CommandRouting",
        "DeliveryBuilder",
        "DeliveryMonitor",
        "DeliveryShutdownTimeoutError",
        "DeliveryStorageCorruptionError",
        "DeliverySupervisor",
        "DraftStateError",
        "DurableSubscriptionBindings",
        "EntityTransaction",
        "EntityTransactionStateError",
        "Environment",
        "EnvironmentType",
        "UniformAcrossAllShards",
        "ContextSpec",
        "DescriptorMetadataError",
        "Command",
        "EventBus",
        "EventRegistrationReadiness",
        "EventRouting",
        "FailedPickUp",
        "FailedReception",
        "FixedClock",
        "HandlerMetadataError",
        "HandlerMetadataRegistry",
        "HandlerMetadataRegistryError",
        "GeneratedRegistryDiscovery",
        "GeneratedRegistryDiscoveryError",
        "HandlerRegistryIngestionError",
        "HandlerRegistryIngestor",
        "Entity",
        "InMemorySubscriptionRegistry",
        "Inbox",
        "InboxMessageError",
        "InboxStorage",
        "ProcessManager",
        "Projection",
        "Repository",
        "RepositoryIdentityError",
        "RuntimeTransportBinding",
        "RuntimeTransportEnvelopeError",
        "Server",
        "ServerEnvironment",
        "ServerRuntimeStateError",
        "ShardIndex",
        "ShardSession",
        "ShardedWorkRegistry",
        "SignalIds",
        "SignalMetadata",
        "SingleProcessServerRuntime",
        "SpecScanner",
        "SpineServices",
        "Stand",
        "StandConflictError",
        "StandStateTypeError",
        "StorageSubscriptionRegistry",
        "StateUpdateRouting",
        "SystemClock",
        "TransactionalEntity",
        "TransactionalEntityScopeError",
        "React",
        "Subscribe",
        "Where",
        "acceptSignalIntake",
        "createRoutingPlan",
        "EntityHandlers",
        "describeEntityMetadata",
        "createEntityTransaction",
        "failSignalIntake",
        "isEntitySchema",
        "isDurableSubscriptionBindings",
        "materializeDecoratedEntityHandlers",
        "validateEntityStateTransition",
      ].sort(),
    );

    expectTypeOf<{
      readonly revision: number;
      readonly source: string;
      readonly checkpoints: readonly (string | null)[];
    }>().toExtend<EntityVersionMetadata>();
    expectTypeOf<
      PlainEntityVersionMetadata<ExportedRevisionMetadata>
    >().toEqualTypeOf<ExportedRevisionMetadata>();
    expectTypeOf<
      PlainEntityVersionMetadata<ExportedSizedMetadata>
    >().toEqualTypeOf<ExportedSizedMetadata>();
    expectTypeOf<PlainEntityVersionMetadata<Date>>().toBeNever();
    expectTypeOf<BoundedContextName>().toEqualTypeOf<{ readonly value: string }>();
    expectTypeOf<TenantMode>().toEqualTypeOf<"single-tenant" | "multitenant">();
    expectTypeOf(
      BoundedContext.singleTenant("Exports").build().snapshot,
    ).toEqualTypeOf<BoundedContextSnapshot>();
    expectTypeOf(
      BoundedContext.singleTenant("Exports").build().commandBus(),
    ).toEqualTypeOf<CommandEndpoint>();
    expectTypeOf(
      BoundedContext.singleTenant("Exports").build().eventBus(),
    ).toEqualTypeOf<EventEndpoint>();
    expectTypeOf(BoundedContext.singleTenant("Exports").build().stand()).toEqualTypeOf<Stand>();
    expectTypeOf(BoundedContext.singleTenant("Exports").build().catchUpReadSide()).toEqualTypeOf<
      Promise<ReadCatchUpResult>
    >();
    expectTypeOf<StandReadResult>().toExtend<{ readonly state: Message }>();
    expectTypeOf<StandSubscription>().toExtend<{ readonly closed: boolean }>();
    expectTypeOf<StandUpdate>().toExtend<{ readonly typeUrl: string; readonly id: unknown }>();
    expectTypeOf<InboxMessage>().not.toHaveProperty("claim");
    expectTypeOf<Inbox>().not.toHaveProperty("claim");
    expectTypeOf<Inbox>().not.toHaveProperty("unclaim");
    expectTypeOf<DeliveryInbox["removeDelivered"]>().toEqualTypeOf<
      | ((
          message: InboxMessage,
          session: DeliveryWorkSession,
          options?: DeliveryOperationOptions,
        ) => Promise<boolean>)
      | undefined
    >();
    expectTypeOf<ServerEnvironmentSettings["delivery"]>().toEqualTypeOf<
      { close(): unknown } | undefined
    >();
    expect(Environment.instance()).toBe(Environment.instance());
    expect(ServerEnvironment.when.bind(ServerEnvironment)).toBeTypeOf("function");
    expect(EnvironmentType.Local).toBe("local");
    expect(BoundedContext.singleTenant("Exports").build().name.value).toBe("Exports");
    expect(new StandStateTypeError("Unknown", "read")).toBeInstanceOf(StandStateTypeError);
    expect(new SingleProcessServerRuntime()).toBeInstanceOf(SingleProcessServerRuntime);
    expect(new SignalMetadata()).toBeInstanceOf(SignalMetadata);
    expect(new SignalIds()).toBeInstanceOf(SignalIds);
    expect(new FixedClock(new Date(0))).toBeInstanceOf(FixedClock);
    expect(new SystemClock()).toBeInstanceOf(SystemClock);
    expect(new GeneratedRegistryDiscovery()).toBeInstanceOf(GeneratedRegistryDiscovery);
    expect(new HandlerRegistryIngestor()).toBeInstanceOf(HandlerRegistryIngestor);
    expect(
      new GeneratedRegistryDiscoveryError("MODULE_IMPORT_FAILED", "Nope", "file:///tmp/nope.js"),
    ).toBeInstanceOf(GeneratedRegistryDiscoveryError);
    expect(
      new HandlerRegistryIngestionError("UNSUPPORTED_REGISTRY_VERSION", "Nope"),
    ).toBeInstanceOf(HandlerRegistryIngestionError);
    expectTypeOf<HandlerParameterCount>().toEqualTypeOf<1 | 2>();
    expectTypeOf<RegistryDiscoveryErrorCode>().toEqualTypeOf<
      | "MODULE_IMPORT_FAILED"
      | "MISSING_REGISTRY_EXPORT"
      | "INVALID_REGISTRY_MODULE"
      | "REGISTRY_INGESTION_FAILED"
      | "UNSUPPORTED_MODULE_SCHEME"
      | "INVALID_MODULE_REF"
      | "DUPLICATE_REGISTRY_MODULE"
    >();
    expectTypeOf<RegistryIngestionErrorCode>().toEqualTypeOf<
      | "UNSUPPORTED_REGISTRY_VERSION"
      | "UNSUPPORTED_HANDLER_KIND"
      | "INVALID_PARAMETER_COUNT"
      | "INVALID_SCHEMA"
      | "INVALID_SIGNAL_ORIGIN"
      | "EXTERNAL_COMMAND_RECEIVER"
      | "MISSING_EMITTED_SCHEMAS"
      | "UNEXPECTED_EMITTED_SCHEMAS"
    >();
    expectTypeOf<SignalKind>().toEqualTypeOf<"command" | "event">();
    expectTypeOf<SignalIntakeAcceptedFor>().toEqualTypeOf<"async-work">();
    expectTypeOf<SignalIntakeFailureCode>().toEqualTypeOf<
      "RUNTIME_NOT_ACCEPTING" | "MALFORMED_ENVELOPE" | "UNSUPPORTED_SIGNAL_KIND"
    >();
    expectTypeOf<SignalMetadataOptions>().toExtend<{
      readonly ids?: SignalIds;
      readonly clock?: SystemClock | FixedClock | undefined;
    }>();
    expectTypeOf<EventContextInput["producerId"]>().toEqualTypeOf<PrimitiveId | undefined>();
    expectTypeOf(acceptSignalIntake("command")).toExtend<SignalIntakeResult>();
    expectTypeOf(failSignalIntake("event", "MALFORMED_ENVELOPE")).toExtend<SignalIntakeResult>();
    expect(acceptSignalIntake("command").acceptedFor).toBe("async-work");
    expect(failSignalIntake("event", "MALFORMED_ENVELOPE").failure.code).toBe("MALFORMED_ENVELOPE");
    expect(new CommandBus()).toBeInstanceOf(CommandBus);
    expect(
      new InboxStorage({
        context: { name: "Exports", multitenant: false },
        storageFactory: new InMemoryStorageFactory(),
      }),
    ).toBeInstanceOf(InboxStorage);
    expect(
      new Inbox(
        new InboxStorage({
          context: { name: "Exports", multitenant: false },
          storageFactory: new InMemoryStorageFactory(),
        }),
      ),
    ).toBeInstanceOf(Inbox);
    expect(
      new ShardSession(ShardIndex.single(), undefined, new Date(0), new Date(1)),
    ).toBeInstanceOf(ShardSession);
    expect("dispatch" in new CommandBus()).toBe(false);
    expectTypeOf<CommandBus>().not.toHaveProperty("dispatch");
    expectTypeOf<CommandDispatcher>().toExtend<{
      messageSchemas(): readonly object[];
      dispatch(command: object): Promise<void>;
    }>();
    expectTypeOf<CommandRegistrationReadiness>().toExtend<CommandRegistrationReadinessLookup>();
    expectTypeOf<CommandRegistrationAssigneeMetadata>().toExtend<{
      readonly commandFullTypeName: string;
    }>();
    expect(new EventBus({} as never)).toBeInstanceOf(EventBus);
    expect("dispatch" in new EventBus({} as never)).toBe(false);
    expect("eventTypes" in new EventBus({} as never)).toBe(false);
    expect("eventSchemas" in new EventBus({} as never)).toBe(false);
    expectTypeOf<EventBus>().not.toHaveProperty("dispatch");
    expectTypeOf<EventBus>().not.toHaveProperty("eventTypes");
    expectTypeOf<EventBus>().not.toHaveProperty("eventSchemas");
    expectTypeOf<EventDispatcher>().toExtend<{
      messageSchemas(): readonly object[];
      accept?(event: object): Promise<void>;
      dispatch(event: object): Promise<void>;
    }>();
    expectTypeOf<EventRegistrationReadiness>().toExtend<EventRegistrationReadinessLookup>();
    expectTypeOf<EventRegistrationSubscriberMetadata>().toExtend<{
      readonly eventFullTypeName: string;
    }>();
    expectTypeOf<EventRegistrationReactorMetadata>().toExtend<{
      readonly eventFullTypeName: string;
    }>();
    expectTypeOf<EventRegistrationApplicationMetadata>().toExtend<{
      readonly eventFullTypeName: string;
      readonly stateTypeName: string;
    }>();
    expect(
      CommandRegistrationReadiness.fromRegistry({
        listEntityHandlers: () => [],
        listHandlers: () => [],
        findByState: () => [],
        findHandlersByKind: () => [],
        findByMessage: () => [],
        findCommandAssignment: () => undefined,
        findEventApplication: () => undefined,
      }).commandTypeNames(),
    ).toEqual([]);
    expect(
      EventRegistrationReadiness.fromRegistry({
        listEntityHandlers: () => [],
        listHandlers: () => [],
        findByState: () => [],
        findHandlersByKind: () => [],
        findByMessage: () => [],
        findCommandAssignment: () => undefined,
        findEventApplication: () => undefined,
      }).eventTypeNames(),
    ).toEqual([]);
    expect(() => new SingleProcessServerRuntime().enqueue(() => undefined)).toThrow(
      ServerRuntimeStateError,
    );
    expect("enqueueFollowUp" in new SingleProcessServerRuntime()).toBe(false);
    expectTypeOf<SingleProcessServerRuntime>().not.toHaveProperty("enqueueFollowUp");
    expectTypeOf<SingleProcessServerRuntime>().toExtend<ServerRuntimeLifecycle>();
    expectTypeOf<RuntimeStateErrorCode>().toEqualTypeOf<"INVALID_RUNTIME_STATE">();
    expectTypeOf<ServerRuntimeRejectedState>().toEqualTypeOf<
      "created" | "running" | "closing" | "closed" | "running-work"
    >();
  });

  it("assembles a bounded-context metadata and routing smoke slice from public APIs", () => {
    expectTypeOf<typeof EntityHandlers>().toHaveProperty("define");
    expectTypeOf<typeof EntityHandlers>().not.toHaveProperty("isAuthentic");
    expectTypeOf<typeof EntityHandlers>().not.toHaveProperty("emittedSchemas");
    expectTypeOf<typeof EntityHandlers>().not.toHaveProperty("copyEmittedSchemas");
    expectTypeOf<typeof EntityHandlers>().not.toHaveProperty("defineArity");
    expect("isAuthentic" in EntityHandlers).toBe(false);
    expect("emittedSchemas" in EntityHandlers).toBe(false);
    expect("copyEmittedSchemas" in EntityHandlers).toBe(false);
    expect("defineArity" in EntityHandlers).toBe(false);

    const repository = new Repository({
      entityType: PublicRuntimeSmokeAggregate,
      schema: AggregateStateSchema,
    });
    const context = BoundedContext.singleTenant("PublicRuntimeSmoke").add(repository).build();
    const handlers = EntityHandlers.define(
      PublicRuntimeSmokeAggregate,
      AggregateStateSchema,
      (builder) => [
        builder.assign(CommandSchema, "assignCommand"),
        builder.apply(AggregateStateSchema, "onAggregateChanged", { allowImport: true }),
      ],
    );
    const registry = new HandlerMetadataRegistry([handlers]);
    const commandReadiness = CommandRegistrationReadiness.fromRegistry(registry);
    const eventReadiness = EventRegistrationReadiness.fromRegistry(registry);
    const routingPlan = createRoutingPlan({
      context,
      commands: commandReadiness,
      events: eventReadiness,
    });

    expect(context.name.value).toBe("PublicRuntimeSmoke");
    expect(typeof context.commandBus().post).toBe("function");
    expect(typeof context.eventBus().post).toBe("function");
    expect("register" in context.commandBus()).toBe(false);
    expect("register" in context.eventBus()).toBe(false);
    expect(commandReadiness.commandTypeNames()).toEqual([CommandSchema.typeName]);
    expect(eventReadiness.eventTypeNames()).toEqual([AggregateStateSchema.typeName]);
    expect(routingPlan.commands.topics.map(({ messageTypeUrl }) => messageTypeUrl)).toEqual([
      "type.spine.io/spine.core.Command",
    ]);
    expect(routingPlan.events.topics.map(({ messageTypeUrl }) => messageTypeUrl)).toEqual([
      TypeUrls.derive(AggregateStateSchema),
    ]);
    expect(routingPlan.deferred.map(({ signalKind }) => signalKind)).toEqual([
      "query",
      "subscription",
      "system",
    ]);

    for (const member of ["ImportBus", "GrpcServer", "ZeroMqTransport"]) {
      expect(Object.hasOwn(serverRoot, member)).toBe(false);
    }

    for (const member of [
      "enqueue",
      "importBus",
      "storage",
      "tenantIndex",
      "integrationBroker",
      "commandService",
      "queryService",
      "subscriptionService",
      "transport",
      "registerRepository",
      "invoke",
      "dispatch",
      "ack",
    ]) {
      expect(member in context).toBe(false);
      expect(Object.hasOwn(context, member)).toBe(false);
    }
  });

  it("extracts entity kind, default visibility, routing hints, columns, and set-once fields", () => {
    const metadata = describeEntityMetadata(ProjectionStateSchema);

    expect(metadata.fullTypeName).toBe("ProjectionState");
    expect(metadata.fileName).toBe("entity-metadata/main.proto");
    expect(metadata.kind).toBe("projection");
    expect(metadata.declaredVisibility).toBe("default");
    expect(metadata.visibility).toBe("full");
    expect(metadata.visibilitySource).toBe("default");
    expect(metadata.idField.name).toBe("id");
    expect(metadata.idField.number).toBe(1);
    expect(metadata.firstFieldRoutingHint.strategy).toBe("first-field");
    expect(metadata.firstFieldRoutingHint.field.name).toBe("id");
    expect(metadata.columns.map((field) => field.name)).toEqual(["name", "priority"]);
    expect(metadata.setOnceFields.map((field) => field.name)).toEqual(["id"]);
    expect(metadata).not.toHaveProperty("semanticTags");
  });

  it("keeps explicit aggregate visibility and descriptor ordering deterministic", () => {
    const metadata = describeEntityMetadata(AggregateStateSchema);

    expect(metadata.kind).toBe("aggregate");
    expect(metadata.declaredVisibility).toBe("query");
    expect(metadata.visibility).toBe("query");
    expect(metadata.visibilitySource).toBe("explicit");
    expect(metadata.columns).toEqual([]);
    expect(metadata.setOnceFields.map((field) => field.name)).toEqual(["id"]);
  });

  it("normalizes the remaining supported entity kinds and visibility values", () => {
    const processManagerMetadata = describeEntityMetadata(ProcessManagerStateSchema);

    expect(processManagerMetadata.kind).toBe("process-manager");
    expect(processManagerMetadata.visibility).toBe("subscribe");
    expect(processManagerMetadata.columns.map((field) => field.name)).toEqual(["queue"]);
    expect(describeEntityMetadata(FullVisibilityStateSchema).visibility).toBe("full");
    expect(describeEntityMetadata(HiddenStateSchema).visibility).toBe("none");
  });

  it("ignores column declarations on entity kinds that are not column-eligible", () => {
    expect(describeEntityMetadata(AggregateStateSchema).columns).toEqual([]);
    expect(describeEntityMetadata(GenericStateSchema).columns).toEqual([]);
  });

  it("documents the checked-in fixture regeneration path", () => {
    expect(serverEntityMetadataFixtureGeneration.command).toBe(
      "node scripts/generate-server-test-fixtures.mjs",
    );
    expect(serverEntityMetadataFixtureGeneration.protoRoot).toBe(
      "packages/server/test-fixtures/proto/entity-metadata",
    );
  });

  it("distinguishes entity schemas from non-entity schemas", () => {
    expect(isEntitySchema(ProjectionStateSchema)).toBe(true);
    expect(isEntitySchema(GenericStateSchema)).toBe(true);
    expect(isEntitySchema(CommandSchema)).toBe(false);
  });

  it("throws a descriptive error when entity metadata is required for a non-entity schema", () => {
    expect(() => describeEntityMetadata(CommandSchema)).toThrow(DescriptorMetadataError);
    expect(() => describeEntityMetadata(CommandSchema)).toThrow(/requires an \(entity\) option/);
  });

  it("throws clear errors for unsupported entity metadata combinations", () => {
    expect(() => describeEntityMetadata(EmptyStateSchema)).toThrow(
      /must declare at least one field for its ID and routing metadata/,
    );
    expect(() => describeEntityMetadata(UnknownKindStateSchema)).toThrow(
      /declares unsupported entity kind "KIND_UNKNOWN"/,
    );
    expect(() => describeEntityMetadata(InvalidColumnStateSchema)).toThrow(
      /column field "InvalidColumnState\.tags" must be singular/,
    );
    expect(() => describeEntityMetadata(InvalidTagStateSchema)).not.toThrow();
  });
});
