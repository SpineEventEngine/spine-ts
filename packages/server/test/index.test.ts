import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { deriveTypeUrl } from "@spine-ts/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { CommandSchema, file_spine_options } from "@spine-ts/proto";
import {
  serverEntityMetadataFixtureGeneration,
  serverEntityMetadataTestFixtures,
} from "../test-fixtures/entity-metadata-fixtures.js";

import * as serverRoot from "../src/index.js";
import {
  BoundedContext,
  CommandBus,
  type CommandDispatcher,
  CommandRegistrationReadiness,
  type CommandRegistrationAssigneeMetadata,
  type CommandRegistrationReadinessLookup,
  EventBus,
  type EventDispatcher,
  EventRegistrationReadiness,
  type EventRegistrationApplicationMetadata,
  type EventRegistrationReadinessLookup,
  type EventRegistrationReactorMetadata,
  type EventRegistrationSubscriberMetadata,
  describeEntityMetadata,
  DescriptorMetadataError,
  isEntitySchema,
  type BoundedContextName,
  type BoundedContextSnapshot,
  type CommandEndpoint,
  type EventEndpoint,
  type TenantMode,
  Aggregate,
  type EntityVersionMetadata,
  type PlainEntityVersionMetadata,
  Repository,
  HandlerMetadataRegistry,
  defineEntityHandlers,
  type ServerRuntimeLifecycle,
  type ServerRuntimeStateErrorCode,
  ServerRuntimeStateError,
  acceptSignalIntake,
  failSignalIntake,
  type SignalIntakeAcceptedFor,
  type SignalIntakeFailureCode,
  type SignalIntakeResult,
  type SignalKind,
  SingleProcessServerRuntime,
  createServerRuntimeRoutingPlan,
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

class PublicRuntimeSmokeAggregate extends Aggregate<string, typeof AggregateStateSchema, number> {
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

describe("@spine-ts/server", () => {
  it("exports the descriptor-derived entity and handler metadata surface", () => {
    expect(Object.keys(serverRoot).sort()).toEqual(
      [
        "Aggregate",
        "Apply",
        "Assign",
        "BoundedContext",
        "BoundedContextBuilder",
        "BoundedContextNameError",
        "CommandBus",
        "CommandRegistrationReadiness",
        "EntityTransactionDraftStateError",
        "EntityTransaction",
        "EntityTransactionStateError",
        "ContextSpec",
        "DescriptorMetadataError",
        "Command",
        "EventBus",
        "EventRegistrationReadiness",
        "HandlerMetadataError",
        "HandlerMetadataRegistry",
        "HandlerMetadataRegistryError",
        "Entity",
        "ProcessManager",
        "Projection",
        "Repository",
        "RepositoryIdentityError",
        "ServerRuntimeStateError",
        "SingleProcessServerRuntime",
        "TransactionalEntity",
        "TransactionalEntityScopeError",
        "React",
        "Subscribe",
        "acceptSignalIntake",
        "createServerRuntimeRoutingPlan",
        "defineEntityHandlers",
        "describeEntityMetadata",
        "createEntityTransaction",
        "failSignalIntake",
        "isEntitySchema",
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
    expect(BoundedContext.singleTenant("Exports").build().name.value).toBe("Exports");
    expect(new SingleProcessServerRuntime()).toBeInstanceOf(SingleProcessServerRuntime);
    expectTypeOf<SignalKind>().toEqualTypeOf<"command" | "event">();
    expectTypeOf<SignalIntakeAcceptedFor>().toEqualTypeOf<"async-work">();
    expectTypeOf<SignalIntakeFailureCode>().toEqualTypeOf<
      "RUNTIME_NOT_ACCEPTING" | "MALFORMED_ENVELOPE" | "UNSUPPORTED_SIGNAL_KIND"
    >();
    expectTypeOf(acceptSignalIntake("command")).toExtend<SignalIntakeResult>();
    expectTypeOf(failSignalIntake("event", "MALFORMED_ENVELOPE")).toExtend<SignalIntakeResult>();
    expect(acceptSignalIntake("command").acceptedFor).toBe("async-work");
    expect(failSignalIntake("event", "MALFORMED_ENVELOPE").failure.code).toBe("MALFORMED_ENVELOPE");
    expect(new CommandBus()).toBeInstanceOf(CommandBus);
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
    expectTypeOf<EventBus>().not.toHaveProperty("dispatch");
    expectTypeOf<EventDispatcher>().toExtend<{
      messageSchemas(): readonly object[];
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
      readonly entityStateFullTypeName: string;
    }>();
    expect(
      CommandRegistrationReadiness.fromRegistry({
        listEntityHandlers: () => [],
        listHandlers: () => [],
        findEntityHandlersByState: () => [],
        findHandlersByKind: () => [],
        findHandlersByMessageFullTypeName: () => [],
        findCommandAssignment: () => undefined,
        findEventApplication: () => undefined,
      }).registeredCommandMessageFullTypeNames(),
    ).toEqual([]);
    expect(
      EventRegistrationReadiness.fromRegistry({
        listEntityHandlers: () => [],
        listHandlers: () => [],
        findEntityHandlersByState: () => [],
        findHandlersByKind: () => [],
        findHandlersByMessageFullTypeName: () => [],
        findCommandAssignment: () => undefined,
        findEventApplication: () => undefined,
      }).registeredEventMessageFullTypeNames(),
    ).toEqual([]);
    expect(() => new SingleProcessServerRuntime().enqueue(() => undefined)).toThrow(
      ServerRuntimeStateError,
    );
    expectTypeOf<SingleProcessServerRuntime>().toExtend<ServerRuntimeLifecycle>();
    expectTypeOf<ServerRuntimeStateErrorCode>().toEqualTypeOf<"INVALID_RUNTIME_STATE">();
  });

  it("assembles a bounded-context metadata and routing smoke slice from public APIs", () => {
    const repository = new Repository({
      entityType: PublicRuntimeSmokeAggregate,
      schema: AggregateStateSchema,
    });
    const context = BoundedContext.singleTenant("PublicRuntimeSmoke").add(repository).build();
    const handlers = defineEntityHandlers(
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
    const routingPlan = createServerRuntimeRoutingPlan({
      context,
      commands: commandReadiness,
      events: eventReadiness,
    });

    expect(context.name.value).toBe("PublicRuntimeSmoke");
    expect(typeof context.commandBus().post).toBe("function");
    expect(typeof context.eventBus().post).toBe("function");
    expect("register" in context.commandBus()).toBe(false);
    expect("register" in context.eventBus()).toBe(false);
    expect(commandReadiness.registeredCommandMessageFullTypeNames()).toEqual([
      CommandSchema.typeName,
    ]);
    expect(eventReadiness.registeredEventMessageFullTypeNames()).toEqual([
      AggregateStateSchema.typeName,
    ]);
    expect(routingPlan.commands.topics.map(({ messageTypeUrl }) => messageTypeUrl)).toEqual([
      "type.spine.io/spine.core.Command",
    ]);
    expect(routingPlan.events.topics.map(({ messageTypeUrl }) => messageTypeUrl)).toEqual([
      deriveTypeUrl(AggregateStateSchema),
    ]);
    expect(routingPlan.deferred.map(({ signalKind }) => signalKind)).toEqual([
      "query",
      "subscription",
      "system",
    ]);

    for (const member of ["Server", "ImportBus", "GrpcServer", "ZeroMqTransport"]) {
      expect(Object.hasOwn(serverRoot, member)).toBe(false);
    }

    for (const member of [
      "enqueue",
      "importBus",
      "storage",
      "stand",
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

  it("extracts entity kind, default visibility, routing hints, columns, set-once fields, and tags", () => {
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
    expect(metadata.semanticTags).toEqual(["example.tags.ProjectionTag", "example.tags.SharedTag"]);
  });

  it("keeps explicit aggregate visibility and descriptor ordering deterministic", () => {
    const metadata = describeEntityMetadata(AggregateStateSchema);

    expect(metadata.kind).toBe("aggregate");
    expect(metadata.declaredVisibility).toBe("query");
    expect(metadata.visibility).toBe("query");
    expect(metadata.visibilitySource).toBe("explicit");
    expect(metadata.columns).toEqual([]);
    expect(metadata.setOnceFields.map((field) => field.name)).toEqual(["id"]);
    expect(metadata.semanticTags).toEqual(["example.tags.AggregateTag", "example.tags.SharedTag"]);
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
    expect(() => describeEntityMetadata(InvalidTagStateSchema)).toThrow(
      /semantic tag option "InvalidTagState" must declare a non-empty java_type/,
    );
  });
});
