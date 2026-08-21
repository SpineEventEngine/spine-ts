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

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { create, type Message } from "@bufbuild/protobuf";
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { StringValueSchema, type Any } from "@bufbuild/protobuf/wkt";
import { Identifiers, TypeUrls, AnyMessages, SignalEnvelopes } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  CommandSchema,
  type Event,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  TenantIdSchema,
  type TenantId,
  UserIdSchema,
  VersionSchema,
  file_spine_options,
} from "@spine-event-engine/proto";
import {
  EventStore,
  InMemoryStorageFactory,
  InMemoryRecordStorage,
  type RecordSpec,
  type RecordStorage,
  type StorageContext,
  StorageFactory,
} from "@spine-event-engine/storage";
import type { EntityRecordStorage } from "@spine-event-engine/storage/provider";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  Aggregate,
  BoundedContext,
  BoundedContextBuilder,
  BoundedContextNameError,
  EventRouting,
  ProcessManager,
  Projection,
  Repository,
  UniformAcrossAllShards,
  type CommandEndpoint,
  type CommandDispatcher,
  type EventEndpoint,
  type EventDispatcher,
  type RepositoryView,
} from "../../src/index.js";
import { boundedContextAccess } from "../../src/context/bounded-context.js";
import { Delivery } from "../../src/delivery/delivery.js";
import type { DeliveryStrategy } from "../../src/delivery/delivery-builder.js";
import type { InboxMessage } from "../../src/delivery/inbox.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import { serverEnvironmentAccess } from "../../src/server/server-environment.js";
import { ServerEnvironment } from "../../src/server/server-environment.js";
import { InMemorySubscriptionRegistry } from "../../src/stand/subscription-registry.js";
import { Stand } from "../../src/stand/stand.js";
import * as EntityLog from "../../../proto/generated/spine/system/server/entity_log_events_pb.js";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";
import { tenant } from "../tenant-fixture.js";

interface InternalSystemPairing {
  readonly domain: {
    readonly name: { readonly value: string };
    readonly tenantMode: "single-tenant" | "multitenant";
  };
  readonly system: {
    readonly name: { readonly value: string };
    readonly multitenant: boolean;
    readonly storesEvents: boolean;
  };
}

interface InternalTenantIndex {
  readonly tenantMode: "single-tenant" | "multitenant";
  all(): Promise<readonly TenantId[]>;
  keep(tenantId: TenantId): Promise<void>;
}

interface InternalDeliveryScope {
  readonly tenantId?: TenantId;
}

interface InternalDeliveryEndpoint {
  readonly label: "HANDLE_COMMAND" | "UPDATE_SUBSCRIBER" | "REACT_UPON_EVENT";
  readonly targetTypeUrl: string;
  readonly shard: { readonly index: number; readonly ofTotal: number };
}

interface InternalDeliveryDescriptor {
  readonly storageFactory: StorageFactory;
  startupScopes(): Promise<readonly InternalDeliveryScope[]>;
  storageContext(scope: InternalDeliveryScope): StorageContext;
  endpoints(): readonly InternalDeliveryEndpoint[];
  replay(message: InboxMessage, tenantId?: string): Promise<void>;
  onReady(onReady: (ready: unknown) => void): () => void;
  transition(scopes: readonly unknown[], onReady: (ready: unknown) => void): Promise<void>;
}

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

type ProcessManagerState = Message<"ProcessManagerState"> & {
  id: string;
  queue: string;
};

function createFixtureFileDescriptor(descriptorSetBase64: string, imports = [file_spine_options]) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Server bounded-context fixture descriptor set is empty.");
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

const fileEntityVisibilityFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.visibility.descriptorSetBase64,
);
const ProcessManagerStateSchema = messageDesc(
  fileEntityVisibilityFixture,
  0,
) as GenMessage<ProcessManagerState>;

class TaskAggregate extends Aggregate<string, typeof AggregateStateSchema, number> {}
class DuplicateTaskAggregate extends Aggregate<string, typeof AggregateStateSchema, number> {}
class ReplayTaskAggregate extends Aggregate<string, typeof AggregateStateSchema, number> {
  assignTask(command: ProjectionState): AggregateState {
    this.update((draft) =>
      Object.assign(
        draft,
        create(AggregateStateSchema, { id: command.id, name: command.name, archived: false }),
      ),
    );
    return create(AggregateStateSchema, { id: command.id, name: command.name, archived: false });
  }
}
class GeneratedTaskAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  assignProjection(command: ProjectionState): ProjectionState {
    this.update((draft) =>
      Object.assign(
        draft,
        create(AggregateStateSchema, {
          id: command.id,
          name: command.name,
          archived: false,
        }),
      ),
    );

    return create(ProjectionStateSchema, command);
  }
}
class TaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  onProjection(event: ProcessManagerState): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectionStateSchema, {
          id: event.id,
          name: event.queue,
          priority: 1,
        }),
      ),
    );
  }
}
class TaskProcessManager extends ProcessManager<string, typeof ProcessManagerStateSchema, number> {}
class GeneratedTaskProcessManager extends ProcessManager<
  string,
  typeof ProcessManagerStateSchema,
  number
> {
  assignTask(command: AggregateState): ProjectionState {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProcessManagerStateSchema, {
          id: command.id,
          queue: `${command.name} assigned`,
        }),
      ),
    );

    return create(ProjectionStateSchema, {
      id: command.id,
      name: `${command.name} event`,
      priority: 1,
    });
  }
}

class ReplayTaskProcessManager extends ProcessManager<
  string,
  typeof ProcessManagerStateSchema,
  number
> {
  assignTask(command: AggregateState): AggregateState {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProcessManagerStateSchema, {
          id: command.id,
          queue: `${command.name} command replayed`,
        }),
      ),
    );
    return create(AggregateStateSchema, command);
  }

  reactToProjection(event: ProjectionState): AggregateState {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProcessManagerStateSchema, {
          id: event.id,
          queue: `${event.name} event replayed`,
        }),
      ),
    );
    return create(AggregateStateSchema, { id: event.id, name: event.name, archived: false });
  }
}

const pendingFreshRecovery = new Error("leave dynamic tenant row for fresh recovery");

class FailingRecoveryProcessManager extends ProcessManager<
  string,
  typeof ProcessManagerStateSchema,
  number
> {
  assignTask(command: AggregateState): void {
    void command;
    throw pendingFreshRecovery;
  }
}

class FreshRecoveryProcessManager extends ProcessManager<
  string,
  typeof ProcessManagerStateSchema,
  number
> {
  assignTask(command: AggregateState): ProjectionState {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProcessManagerStateSchema, {
          id: command.id,
          queue: `${command.name} recovered`,
        }),
      ),
    );
    return create(ProjectionStateSchema, {
      id: command.id,
      name: command.name,
      priority: 1,
    });
  }
}

function internalSystemPairing(context: BoundedContext): InternalSystemPairing {
  return (
    boundedContextAccess as unknown as {
      systemPairing(context: BoundedContext): InternalSystemPairing;
    }
  ).systemPairing(context);
}

function internalTenantIndex(context: BoundedContext): InternalTenantIndex {
  return (
    boundedContextAccess as unknown as {
      tenantIndex(context: BoundedContext): InternalTenantIndex;
    }
  ).tenantIndex(context);
}

function internalDeliveryDescriptor(context: BoundedContext): InternalDeliveryDescriptor {
  return (
    boundedContextAccess as unknown as {
      delivery(context: BoundedContext): InternalDeliveryDescriptor;
    }
  ).delivery(context);
}

describe("BoundedContext assembly", () => {
  it("does not expose a logger before package-private installation", () => {
    const context = BoundedContext.singleTenant("Logger").build();

    expect(() => boundedContextAccess.loggerFor(context)).toThrow(
      "Context logger requires a built BoundedContext instance.",
    );
  });

  it("rejects private delivery transition validation through its promise", async () => {
    const context = BoundedContext.singleTenant("Tasks").build();
    let transition: Promise<void> | undefined;

    expect(() => {
      transition = internalDeliveryDescriptor(context).transition([], () => undefined);
    }).not.toThrow();
    await expect(transition).rejects.toThrow(
      "Delivery readiness transition requires configured scopes.",
    );
  });

  it("rejects empty or blank context names", () => {
    expect(() => BoundedContext.singleTenant("\t\n")).toThrow(BoundedContextNameError);
    expect(() => BoundedContext.multitenant("")).toThrow(BoundedContextNameError);
    expect(() => BoundedContext.singleTenant("__spine/Tasks/tenants")).toThrow(
      BoundedContextNameError,
    );
  });

  it("builds single-tenant and multitenant contexts with names and tenant mode", () => {
    const singleTenant = BoundedContext.singleTenant("Tasks").build();
    const multitenant = BoundedContext.multitenant("Customers").build();

    expect(singleTenant.name.value).toBe("Tasks");
    expect(singleTenant.tenantMode).toBe("single-tenant");
    expect(singleTenant.isMultitenant).toBe(false);
    expect(singleTenant.spec.multitenant).toBe(false);

    expect(multitenant.name.value).toBe("Customers");
    expect(multitenant.tenantMode).toBe("multitenant");
    expect(multitenant.isMultitenant).toBe(true);
    expect(multitenant.spec.multitenant).toBe(true);
  });

  it("derives internal system pairing metadata for built domain contexts", () => {
    const singleTenant = BoundedContext.singleTenant("Tasks").build();
    const multitenant = BoundedContext.multitenant("Customers").build();

    const singlePairing = internalSystemPairing(singleTenant);
    const multitenantPairing = internalSystemPairing(multitenant);

    expect(singlePairing.domain.name.value).toBe("Tasks");
    expect(singlePairing.domain.tenantMode).toBe("single-tenant");
    expect(singlePairing.system.name.value).toBe("Tasks_System");
    expect(singlePairing.system.multitenant).toBe(false);
    expect(singlePairing.system.storesEvents).toBe(false);

    expect(multitenantPairing.domain.name.value).toBe("Customers");
    expect(multitenantPairing.domain.tenantMode).toBe("multitenant");
    expect(multitenantPairing.system.name.value).toBe("Customers_System");
    expect(multitenantPairing.system.multitenant).toBe(true);
    expect(multitenantPairing.system.storesEvents).toBe(false);
  });

  it("persists only paired system events when explicitly enabled", () => {
    const context = BoundedContext.singleTenant("AuditedTasks").persistSystemEvents().build();

    expect(internalSystemPairing(context).system.storesEvents).toBe(true);
  });

  it("defers event record storage until an event operation selects its tenant", async () => {
    const storageFactory = new ObservingStorageFactory([]);
    const context = BoundedContext.singleTenant("AcquisitionOrder")
      .withStorageFactory(storageFactory)
      .persistSystemEvents()
      .build();

    expect(storageFactory.creations.map((creation) => creation.context.name)).not.toContain(
      "AcquisitionOrder_System",
    );
    await context.close();
  });

  it("exposes a constant single-tenant index through internal context access", async () => {
    const context = BoundedContext.singleTenant("Tasks").build();
    const tenantIndex = internalTenantIndex(context);

    expect(tenantIndex.tenantMode).toBe("single-tenant");
    await expect(tenantIndex.all()).resolves.toEqual([]);
    await expect(tenantIndex.keep(tenant("tenant-a"))).rejects.toThrow(
      'Single-tenant context "Tasks" does not accept tenant recording.',
    );
  });

  it("rejects single-tenant index access after context close", async () => {
    const context = BoundedContext.singleTenant("Tasks").build();
    const tenantIndex = internalTenantIndex(context);

    await context.close();

    await expect(tenantIndex.all()).rejects.toThrow("TenantIndex is closed.");
    await expect(tenantIndex.keep(tenant("tenant-a"))).rejects.toThrow("TenantIndex is closed.");
  });

  it("stores multitenant index entries through the configured storage factory", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const first = BoundedContext.multitenant("Customers")
      .withStorageFactory(storageFactory)
      .build();
    const firstIndex = internalTenantIndex(first);

    expect(firstIndex.tenantMode).toBe("multitenant");

    await firstIndex.keep(tenant("tenant-b"));
    await firstIndex.keep(tenant("tenant-a"));
    await firstIndex.keep(tenant("tenant-a"));

    await expect(firstIndex.all()).resolves.toEqual([tenant("tenant-a"), tenant("tenant-b")]);

    const recovered = BoundedContext.multitenant("Customers")
      .withStorageFactory(storageFactory)
      .build();
    const recoveredIndex = internalTenantIndex(recovered);

    await expect(recoveredIndex.all()).resolves.toEqual([tenant("tenant-a"), tenant("tenant-b")]);
  });

  it("describes actual delivery storage and tenant startup scopes through internal access", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const single = BoundedContext.singleTenant("Tasks").withStorageFactory(storageFactory).build();
    const multitenant = BoundedContext.multitenant("Customers")
      .withStorageFactory(storageFactory)
      .build();

    await internalTenantIndex(multitenant).keep(tenant("tenant-b"));
    await internalTenantIndex(multitenant).keep(tenant("tenant-a"));

    expect(internalDeliveryDescriptor(single).storageFactory).toBe(storageFactory);
    await expect(internalDeliveryDescriptor(single).startupScopes()).resolves.toEqual([{}]);
    expect(internalDeliveryDescriptor(single).storageContext({})).toEqual({
      name: "Tasks",
      multitenant: false,
    });
    expect(internalDeliveryDescriptor(multitenant).storageFactory).toBe(storageFactory);
    await expect(internalDeliveryDescriptor(multitenant).startupScopes()).resolves.toEqual([
      { tenantId: tenant("tenant-a") },
      { tenantId: tenant("tenant-b") },
    ]);
    expect(
      internalDeliveryDescriptor(multitenant).storageContext({ tenantId: tenant("tenant-a") }),
    ).toEqual({
      name: "Customers",
      multitenant: true,
      tenantId: tenant("tenant-a"),
    });
  });

  it("describes configured supported delivery endpoints and their shards", async () => {
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: GeneratedTaskProcessManager,
        stateSchema: ProcessManagerStateSchema,
        handlers: [
          {
            kind: "command-assignment",
            methodName: "assignTask",
            signalSchema: AggregateStateSchema,
            emittedSchemas: [ProjectionStateSchema],
            parameterCount: 1,
            origin: "domestic",
          },
        ],
      },
      {
        entityType: TaskProjection,
        stateSchema: ProjectionStateSchema,
        handlers: [
          {
            kind: "state-subscription",
            methodName: "onProjection",
            signalSchema: ProcessManagerStateSchema,
            emittedSchemas: [],
            parameterCount: 1,
            origin: "domestic",
          },
        ],
      },
    ]);
    const context = await BoundedContext.singleTenant("Tasks")
      .withGeneratedRegistryRoot(registryRoot)
      .add(GeneratedTaskProcessManager)
      .add(TaskProjection)
      .buildAsync();

    expect(internalDeliveryDescriptor(context).endpoints()).toEqual([
      {
        label: "HANDLE_COMMAND",
        targetTypeUrl: TypeUrls.derive(ProcessManagerStateSchema),
        shard: { index: 0, ofTotal: 1 },
      },
      {
        label: "UPDATE_SUBSCRIBER",
        targetTypeUrl: TypeUrls.derive(ProjectionStateSchema),
        shard: { index: 0, ofTotal: 1 },
      },
    ]);

    const ready: unknown[] = [];
    const stopObserving = internalDeliveryDescriptor(context).onReady((scope) => ready.push(scope));
    await context.commandBus().post(createAggregateCommand("command-ready"));
    stopObserving();

    expect(ready).toEqual([
      {
        label: "HANDLE_COMMAND",
        targetTypeUrl: TypeUrls.derive(ProcessManagerStateSchema),
        shard: { index: 0, ofTotal: 1 },
      },
      {
        label: "UPDATE_SUBSCRIBER",
        targetTypeUrl: TypeUrls.derive(ProjectionStateSchema),
        shard: { index: 0, ofTotal: 1 },
      },
    ]);

    const attachment = await serverEnvironmentAccess.attach(ServerEnvironment.instance(), {
      ownership: "caller",
      descriptors: [boundedContextAccess.delivery(context)],
    });
    expect(attachment.startup.scopes).toHaveLength(2);
    await context.commandBus().post(createAggregateCommand("command-attached", "task-attached"));
    await waitForCondition(
      async () =>
        (await context.stand().read(ProcessManagerStateSchema, "task-attached")) !== undefined,
      "attached environment delivery",
    );
    await serverEnvironmentAccess.detach(ServerEnvironment.instance(), attachment);
  });

  it("passes custom routing when adding an Entity class with generated handlers", async () => {
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: TaskProjection,
        stateSchema: ProjectionStateSchema,
        handlers: [
          {
            kind: "state-subscription",
            methodName: "onProjection",
            signalSchema: ProcessManagerStateSchema,
            emittedSchemas: [],
            parameterCount: 1,
            origin: "domestic",
          },
        ],
      },
    ]);
    const eventRouting = EventRouting.create<string>().route(ProjectionStateSchema, () => [
      "custom-target",
    ]);
    await expect(
      BoundedContext.singleTenant("CustomRouting")
        .withGeneratedRegistryRoot(registryRoot)
        .add(TaskProjection, { eventRouting })
        .buildAsync(),
    ).rejects.toThrow('unregistered exact route for "ProjectionState"');
  });

  it("rejects generated options for an explicitly assembled repository", () => {
    const builder = BoundedContext.singleTenant("ExplicitRepository");
    const invalidAdd = builder as unknown as {
      add(entry: unknown, options: object): unknown;
    };
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });

    expect(() => invalidAdd.add(repository, {})).toThrow(
      "Explicit Repository instances do not accept generated options.",
    );
  });

  it("enumerates every configured entity inbox shard from the context delivery strategy", async () => {
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: GeneratedTaskProcessManager,
        stateSchema: ProcessManagerStateSchema,
        handlers: [
          {
            kind: "command-assignment",
            methodName: "assignTask",
            signalSchema: AggregateStateSchema,
            emittedSchemas: [ProjectionStateSchema],
            parameterCount: 1,
            origin: "domestic",
          },
        ],
      },
    ]);
    const context = await BoundedContext.singleTenant("Tasks")
      .withDeliveryStrategy(UniformAcrossAllShards.forNumber(3))
      .withGeneratedRegistryRoot(registryRoot)
      .add(GeneratedTaskProcessManager)
      .buildAsync();

    expect(internalDeliveryDescriptor(context).endpoints()).toEqual([
      ...[0, 1, 2].map((index) => ({
        label: "HANDLE_COMMAND" as const,
        targetTypeUrl: TypeUrls.derive(ProcessManagerStateSchema),
        shard: { index, ofTotal: 3 },
      })),
    ]);
  });

  it("protects durable target bytes from a custom delivery strategy", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: GeneratedTaskProcessManager,
        stateSchema: ProcessManagerStateSchema,
        handlers: [
          {
            kind: "command-assignment",
            methodName: "assignTask",
            signalSchema: AggregateStateSchema,
            emittedSchemas: [ProjectionStateSchema],
            parameterCount: 1,
            origin: "domestic",
          },
        ],
      },
    ]);
    const context = await BoundedContext.singleTenant("StrategyClone")
      .withStorageFactory(storageFactory)
      .withDeliveryStrategy({
        shardCount: 1,
        shardFor: (targetId) => {
          targetId.value.fill(0);
          return ShardIndex.single();
        },
      })
      .withGeneratedRegistryRoot(registryRoot)
      .add(GeneratedTaskProcessManager)
      .buildAsync();

    try {
      await context.commandBus().post(createAggregateCommand("strategy-clone", "original-id"));
      const descriptor = internalDeliveryDescriptor(context);
      const rows = await new Delivery({
        context: descriptor.storageContext({}),
        storageFactory,
      }).inbox.read(ShardIndex.single());

      expect(rows.map((row) => Identifiers.unpack("string", row.inboxId.targetId))).toContain(
        "original-id",
      );
    } finally {
      await context.close();
    }
  });

  it("replays nonzero-shard Aggregate and Process Manager descriptor rows", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const strategy = UniformAcrossAllShards.forNumber(3);
    const registry = createGeneratedRegistryFixture([
      aggregateReplayRegistry(ReplayTaskAggregate),
      replayProcessManagerRegistry(ReplayTaskProcessManager),
    ]);
    const context = await BoundedContext.singleTenant("DescriptorReplay")
      .withStorageFactory(storageFactory)
      .withDeliveryStrategy(strategy)
      .withGeneratedRegistryRoot(registry.root)
      .add(ReplayTaskAggregate)
      .add(ReplayTaskProcessManager)
      .buildAsync();

    try {
      const descriptor = internalDeliveryDescriptor(context);
      const aggregateType = TypeUrls.derive(AggregateStateSchema);
      const processManagerType = TypeUrls.derive(ProcessManagerStateSchema);
      const aggregateId = targetForShard(strategy, aggregateType, 1, "aggregate");
      const commandId = targetForShard(strategy, processManagerType, 2, "pm-command");
      const eventId = targetForShard(strategy, processManagerType, 1, "pm-event");
      const aggregateCommand = createProjectionCommand("aggregate-row", aggregateId);
      const processManagerCommand = createAggregateCommand("pm-command-row", commandId);
      const processManagerEvent = createProjectionEvent("pm-event-row", eventId);

      const aggregateRow = await persistDescriptorRow({
        descriptor,
        storageFactory,
        targetTypeUrl: aggregateType,
        targetId: aggregateId,
        signalId: "aggregate-row",
        label: "HANDLE_COMMAND",
        signal: AnyMessages.pack(CommandSchema, aggregateCommand, { validate: false }),
        shard: strategy.shardFor(Identifiers.pack("string", aggregateId), aggregateType),
      });
      const processManagerCommandRow = await persistDescriptorRow({
        descriptor,
        storageFactory,
        targetTypeUrl: processManagerType,
        targetId: commandId,
        signalId: "pm-command-row",
        label: "HANDLE_COMMAND",
        signal: AnyMessages.pack(CommandSchema, processManagerCommand, { validate: false }),
        shard: strategy.shardFor(Identifiers.pack("string", commandId), processManagerType),
      });
      const processManagerEventRow = await persistDescriptorRow({
        descriptor,
        storageFactory,
        targetTypeUrl: processManagerType,
        targetId: eventId,
        signalId: "pm-event-row",
        label: "REACT_UPON_EVENT",
        signal: AnyMessages.pack(EventSchema, processManagerEvent, { validate: false }),
        shard: strategy.shardFor(Identifiers.pack("string", eventId), processManagerType),
      });

      await descriptor.replay(aggregateRow);
      await descriptor.replay(processManagerCommandRow);
      await descriptor.replay(processManagerEventRow);

      await expect(context.stand().read(AggregateStateSchema, aggregateId)).resolves.toMatchObject({
        id: aggregateId,
        name: "Task",
      });
      await expect(
        context.stand().read(ProcessManagerStateSchema, commandId),
      ).resolves.toMatchObject({
        id: commandId,
        queue: "Task Ready command replayed",
      });
      await expect(context.stand().read(ProcessManagerStateSchema, eventId)).resolves.toMatchObject(
        {
          id: eventId,
          queue: "Task event replayed",
        },
      );
    } finally {
      await context.close();
      removeGeneratedRegistry(registry);
    }
  });

  it("rejects forged Aggregate and Process Manager descriptor shards before handlers run", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const strategy = UniformAcrossAllShards.forNumber(3);
    const registry = createGeneratedRegistryFixture([
      aggregateReplayRegistry(ReplayTaskAggregate),
      replayProcessManagerRegistry(ReplayTaskProcessManager),
    ]);
    const context = await BoundedContext.singleTenant("ForgedDescriptorShard")
      .withStorageFactory(storageFactory)
      .withDeliveryStrategy(strategy)
      .withGeneratedRegistryRoot(registry.root)
      .add(ReplayTaskAggregate)
      .add(ReplayTaskProcessManager)
      .buildAsync();

    try {
      const descriptor = internalDeliveryDescriptor(context);
      const aggregateType = TypeUrls.derive(AggregateStateSchema);
      const processManagerType = TypeUrls.derive(ProcessManagerStateSchema);
      const aggregateId = targetForShard(strategy, aggregateType, 1, "forged-aggregate");
      const processManagerId = targetForShard(strategy, processManagerType, 2, "forged-pm");
      const aggregateRow = await persistDescriptorRow({
        descriptor,
        storageFactory,
        targetTypeUrl: aggregateType,
        targetId: aggregateId,
        signalId: "forged-aggregate",
        label: "HANDLE_COMMAND",
        signal: AnyMessages.pack(
          CommandSchema,
          createProjectionCommand("forged-aggregate", aggregateId),
          {
            validate: false,
          },
        ),
        shard: new ShardIndex(0, 3),
      });
      const processManagerRow = await persistDescriptorRow({
        descriptor,
        storageFactory,
        targetTypeUrl: processManagerType,
        targetId: processManagerId,
        signalId: "forged-pm",
        label: "HANDLE_COMMAND",
        signal: AnyMessages.pack(
          CommandSchema,
          createAggregateCommand("forged-pm", processManagerId),
          { validate: false },
        ),
        shard: new ShardIndex(0, 3),
      });

      await expect(descriptor.replay(aggregateRow)).rejects.toThrow(
        "Entity Inbox replay stored shard does not match the routed target.",
      );
      await expect(descriptor.replay(processManagerRow)).rejects.toThrow(
        "Entity Inbox replay stored shard does not match the routed target.",
      );
      await expect(
        context.stand().read(AggregateStateSchema, aggregateId),
      ).resolves.toBeUndefined();
      await expect(
        context.stand().read(ProcessManagerStateSchema, processManagerId),
      ).resolves.toBeUndefined();
    } finally {
      await context.close();
      removeGeneratedRegistry(registry);
    }
  });

  it("recovers every configured Process Manager shard and label through a fresh descriptor", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const strategy = UniformAcrossAllShards.forNumber(3);
    const contextName = "FreshMultiShardDescriptor";
    const registry = createGeneratedRegistryFixture([
      replayProcessManagerRegistry(ReplayTaskProcessManager),
    ]);
    let first: BoundedContext | undefined;
    let recovered: BoundedContext | undefined;

    try {
      first = await BoundedContext.singleTenant(contextName)
        .withStorageFactory(storageFactory)
        .withDeliveryStrategy(strategy)
        .withGeneratedRegistryRoot(registry.root)
        .add(ReplayTaskProcessManager)
        .buildAsync();
      const firstDescriptor = internalDeliveryDescriptor(first);
      const targetTypeUrl = TypeUrls.derive(ProcessManagerStateSchema);
      const rows: InboxMessage[] = [];

      for (const label of ["HANDLE_COMMAND", "REACT_UPON_EVENT"] as const) {
        for (const index of [0, 1, 2]) {
          const targetId = targetForShard(
            strategy,
            targetTypeUrl,
            index,
            `${label}-${String(index)}`,
          );
          const signalId = `${label}-${String(index)}`;
          const signal =
            label === "HANDLE_COMMAND"
              ? AnyMessages.pack(CommandSchema, createAggregateCommand(signalId, targetId), {
                  validate: false,
                })
              : AnyMessages.pack(EventSchema, createProjectionEvent(signalId, targetId), {
                  validate: false,
                });
          rows.push(
            await persistDescriptorRow({
              descriptor: firstDescriptor,
              storageFactory,
              targetTypeUrl,
              targetId,
              signalId,
              label,
              signal,
              shard: strategy.shardFor(Identifiers.pack("string", targetId), targetTypeUrl),
            }),
          );
        }
      }
      await first.close();
      first = undefined;

      recovered = await BoundedContext.singleTenant(contextName)
        .withStorageFactory(storageFactory)
        .withDeliveryStrategy(strategy)
        .withGeneratedRegistryRoot(registry.root)
        .add(ReplayTaskProcessManager)
        .buildAsync();
      const recoveryContext = requireRecoveryContext(recovered);
      const descriptor = internalDeliveryDescriptor(recoveryContext);
      expect(descriptor.endpoints()).toEqual(
        ["HANDLE_COMMAND", "REACT_UPON_EVENT"].flatMap((label) =>
          [0, 1, 2].map((index) => ({
            label,
            targetTypeUrl,
            shard: { index, ofTotal: 3 },
          })),
        ),
      );
      const attachment = await serverEnvironmentAccess.attach(ServerEnvironment.instance(), {
        ownership: "caller",
        descriptors: [boundedContextAccess.delivery(recoveryContext)],
      });
      try {
        await waitForCondition(
          async () =>
            (
              await Promise.all(
                rows.map((row) =>
                  recoveryContext
                    .stand()
                    .read(
                      ProcessManagerStateSchema,
                      Identifiers.unpack("string", row.inboxId.targetId),
                    ),
                ),
              )
            ).every((state) => state !== undefined),
          "fresh multi-shard descriptor recovery",
        );
        for (const row of rows) {
          await expect(
            new Delivery({
              context: descriptor.storageContext({}),
              storageFactory,
            }).inbox.readMessage(row.id),
          ).resolves.toBeUndefined();
        }
      } finally {
        await serverEnvironmentAccess.detach(ServerEnvironment.instance(), attachment);
      }
    } finally {
      await first?.close();
      await recovered?.close();
      removeGeneratedRegistry(registry);
    }
  });

  it("marks a failed dynamic-tenant row delivered without fresh-runtime recovery", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const tenantId = tenant("tenant-first-row");
    const contextName = "FreshRecoveryTasks";
    const failingRegistry = createGeneratedRegistryFixture([
      processManagerRegistry(FailingRecoveryProcessManager),
    ]);
    const recoveryRegistry = createGeneratedRegistryFixture([
      processManagerRegistry(FreshRecoveryProcessManager),
    ]);
    let first: BoundedContext | undefined;
    let recovered: BoundedContext | undefined;

    try {
      first = await BoundedContext.multitenant(contextName)
        .withStorageFactory(storageFactory)
        .withGeneratedRegistryRoot(failingRegistry.root)
        .add(FailingRecoveryProcessManager)
        .addEventDispatcher(createEventDispatcher([ProjectionStateSchema], () => undefined))
        .buildAsync();

      await expect(
        first
          .commandBus()
          .post(createAggregateCommand("dynamic-command", "dynamic-task", "tenant-first-row")),
      ).resolves.toBeUndefined();
      const firstDescriptor = internalDeliveryDescriptor(first);
      const durable = new Delivery({
        context: firstDescriptor.storageContext({ tenantId }),
        storageFactory,
      });
      const delivered = await durable.inbox.read(ShardIndex.single(), {
        statuses: ["DELIVERED"],
      });
      expect(delivered).toHaveLength(1);
      expect(delivered[0]).toMatchObject({
        inboxId: { targetId: Identifiers.pack("string", "dynamic-task") },
        signalId: "dynamic-command",
        version: 1n,
      });
      await first.close();
      first = undefined;

      recovered = await BoundedContext.multitenant(contextName)
        .withStorageFactory(storageFactory)
        .withGeneratedRegistryRoot(recoveryRegistry.root)
        .add(FreshRecoveryProcessManager)
        .addEventDispatcher(createEventDispatcher([ProjectionStateSchema], () => undefined))
        .buildAsync();
      const descriptor = internalDeliveryDescriptor(recovered);

      await expect(descriptor.startupScopes()).resolves.toEqual([{ tenantId }]);
      const attachment = await serverEnvironmentAccess.attach(ServerEnvironment.instance(), {
        ownership: "caller",
        descriptors: [boundedContextAccess.delivery(recovered)],
      });

      expect(attachment.startup.scopes).toHaveLength(1);
      await expect(
        new Delivery({
          context: descriptor.storageContext({ tenantId }),
          storageFactory,
        }).inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
      ).resolves.toMatchObject([
        {
          inboxId: { targetId: Identifiers.pack("string", "dynamic-task") },
          signalId: "dynamic-command",
          version: 1n,
        },
      ]);
      await expect(
        recovered.stand().read(ProcessManagerStateSchema, "dynamic-task", { tenantId }),
      ).resolves.toBeUndefined();
      await serverEnvironmentAccess.detach(ServerEnvironment.instance(), attachment);
    } finally {
      await first?.close();
      await recovered?.close();
      removeGeneratedRegistry(failingRegistry);
      removeGeneratedRegistry(recoveryRegistry);
    }
  });

  it("rejects blank multitenant index entries", async () => {
    const context = BoundedContext.multitenant("Customers").build();
    const tenantIndex = internalTenantIndex(context);

    await expect(tenantIndex.keep(tenant(" \t "))).rejects.toThrow(/non-empty/);
  });

  it("keeps tenant discovery in the factory catalog without a TenantId record family", async () => {
    const storageFactory = new ObservingStorageFactory([]);
    const customers = BoundedContext.multitenant("Customers")
      .withStorageFactory(storageFactory)
      .build();
    const tenantIndex = internalTenantIndex(customers);

    await tenantIndex.keep(tenant("tenant-a"));

    await expect(tenantIndex.all()).resolves.toEqual([tenant("tenant-a")]);
    expect(
      storageFactory.creations.some(
        (creation) => creation.context.name === "__spine/Customers/tenants",
      ),
    ).toBe(false);
  });

  it("exposes stable commandBus() and eventBus() endpoints from the built context", () => {
    const context = BoundedContext.singleTenant("Tasks").build();

    expectTypeOf(context.commandBus()).toEqualTypeOf<CommandEndpoint>();
    expectTypeOf(context.eventBus()).toEqualTypeOf<EventEndpoint>();
    expect(typeof context.commandBus().post).toBe("function");
    expect(typeof context.commandBus().acceptedCommandTypes).toBe("function");
    expect(typeof context.eventBus().post).toBe("function");
    expect(typeof context.eventBus().acceptedEventTypes).toBe("function");
    expect("register" in context.commandBus()).toBe(false);
    expect("register" in context.eventBus()).toBe(false);
    expect(context.commandBus()).toBe(context.commandBus());
    expect(context.eventBus()).toBe(context.eventBus());
  });

  it("owns a stable stand with repository state types registered", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();
    const stand = context.stand();

    expect(stand).toBe(context.stand());
    expect(stand.stateTypes()).toEqual([TypeUrls.derive(ProjectionStateSchema)]);

    await stand.update(
      ProjectionStateSchema,
      create(ProjectionStateSchema, {
        id: "task-1",
        name: "Task",
        priority: 1,
      }),
    );

    await expect(stand.read(ProjectionStateSchema, "task-1")).resolves.toMatchObject({
      id: "task-1",
      name: "Task",
      priority: 1,
    });
  });

  it("registers command dispatchers added to the builder", async () => {
    const observed: string[] = [];
    const dispatcher = createCommandDispatcher([ProjectionStateSchema], (command) => {
      observed.push(command.id?.uuid ?? "missing");
    });
    const context = BoundedContext.singleTenant("Tasks").addCommandDispatcher(dispatcher).build();

    await context.commandBus().post(createProjectionCommand("command-1"));

    expect(observed).toEqual(["command-1"]);
  });

  it("does not register command dispatchers removed before build", async () => {
    const dispatcher = createCommandDispatcher([ProjectionStateSchema], () => undefined);
    const context = BoundedContext.singleTenant("Tasks")
      .addCommandDispatcher(dispatcher)
      .removeCommandDispatcher(dispatcher)
      .build();

    await expect(context.commandBus().post(createProjectionCommand("command-2"))).rejects.toThrow(
      `No command dispatcher registered for "${TypeUrls.derive(ProjectionStateSchema)}".`,
    );
  });

  it("registers event dispatchers added to the builder", async () => {
    const observed: string[] = [];
    const dispatcher = createEventDispatcher([ProjectionStateSchema], (event) => {
      observed.push(event.id?.value ?? "missing");
    });
    const context = BoundedContext.singleTenant("Tasks").addEventDispatcher(dispatcher).build();

    await context.eventBus().post(createProjectionEvent("event-1"));

    expect(observed).toEqual(["event-1"]);
  });

  it("does not expose internal event types accepted by framework dispatchers", () => {
    const dispatcher = createEventDispatcher([EventSchema, ProjectionStateSchema], () => undefined);
    const context = BoundedContext.singleTenant("Tasks").addEventDispatcher(dispatcher).build();

    expect(context.eventBus().acceptedEventTypes()).toEqual([
      TypeUrls.derive(ProjectionStateSchema),
    ]);
  });

  it("rejects package-local event subscriptions for non-context values", () => {
    expect(() =>
      boundedContextAccess.subscribeToEvent(
        {} as BoundedContext,
        TypeUrls.derive(ProjectionStateSchema),
        { onEvent: () => undefined },
      ),
    ).toThrow("Event subscription requires a built BoundedContext instance.");
  });

  it("rejects events whose only dispatcher was removed before build", async () => {
    const observed: string[] = [];
    const dispatcher = createEventDispatcher([ProjectionStateSchema], (event) => {
      observed.push(event.id?.value ?? "missing");
    });
    const context = BoundedContext.singleTenant("Tasks")
      .addEventDispatcher(dispatcher)
      .removeEventDispatcher(dispatcher)
      .build();

    await expect(context.eventBus().post(createProjectionEvent("event-2"))).rejects.toThrow(
      /No event schema registered/,
    );

    expect(observed).toEqual([]);
  });

  it("stores events in the context EventStore before dispatch", async () => {
    const observed: string[] = [];
    const storageFactory = new ObservingStorageFactory(observed);
    const dispatcher = createEventDispatcher([ProjectionStateSchema], (event) => {
      observed.push(`dispatch:${event.id?.value ?? "missing"}`);
    });
    const context = BoundedContext.singleTenant("Tasks")
      .withStorageFactory(storageFactory)
      .addEventDispatcher(dispatcher)
      .build();

    await context.eventBus().post(createProjectionEvent("event-3"));

    expect(observed).toEqual(["store:event-3", "dispatch:event-3"]);
  });

  it("rejects event dispatcher classification before acquiring event storage", () => {
    const storageFactory = new ObservingStorageFactory([]);
    const dispatcher = createEventDispatcher([ProjectionStateSchema], () => undefined);
    const brokenDispatcher = {
      messageSchemas: () => {
        throw new Error("Cannot read event schemas.");
      },
      dispatch: (event: Event): Promise<void> => Promise.resolve(void event),
    } satisfies EventDispatcher;

    expect(() =>
      BoundedContext.singleTenant("Tasks")
        .withStorageFactory(storageFactory)
        .addEventDispatcher(dispatcher)
        .addEventDispatcher(brokenDispatcher)
        .build(),
    ).toThrow("Cannot read event schemas.");

    expect(storageFactory.storages).toHaveLength(0);
  });

  it("does not acquire an event store before dispatcher classification fails", () => {
    const storageFactory = new ObservingStorageFactory([], [1]);
    const brokenDispatcher = {
      messageSchemas: () => {
        throw new Error("Cannot read event schemas.");
      },
      dispatch: (event: Event): Promise<void> => Promise.resolve(void event),
    } satisfies EventDispatcher;

    let thrown: unknown;
    try {
      BoundedContext.singleTenant("Tasks")
        .withStorageFactory(storageFactory)
        .addEventDispatcher(brokenDispatcher)
        .build();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ message: "Cannot read event schemas." });
    expect(storageFactory.storages).toHaveLength(0);
  });

  it("registers repositories added to the builder with the built context", () => {
    const storageFactory = new ObservingStorageFactory([]);
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(repository)
      .build();

    const firstRepositories = context.registeredRepositories();
    const secondRepositories = context.registeredRepositories();

    expectTypeOf(firstRepositories).toEqualTypeOf<readonly RepositoryView[]>();
    expect(firstRepositories).toHaveLength(1);
    expect(firstRepositories[0]).not.toBe(repository);
    expect(firstRepositories[0]?.entityType).toBe(TaskAggregate);
    expect(firstRepositories[0]?.stateFullTypeName).toBe(AggregateStateSchema.typeName);
    expect(secondRepositories).toEqual(firstRepositories);
    expect(secondRepositories).not.toBe(firstRepositories);
    expect(secondRepositories[0]).not.toBe(firstRepositories[0]);
    expect(storageFactory.creationsFor(AggregateStateSchema.typeName)).toHaveLength(0);
  });

  it("builds generated repositories from entity classes with buildAsync", async () => {
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: GeneratedTaskAggregate,
        stateSchema: AggregateStateSchema,
        handlers: [
          {
            kind: "command-assignment",
            methodName: "assignProjection",
            signalSchema: ProjectionStateSchema,
            emittedSchemas: [ProjectionStateSchema],
            parameterCount: 1,
            origin: "domestic",
          },
        ],
      },
      {
        entityType: TaskProjection,
        stateSchema: ProjectionStateSchema,
        handlers: [
          {
            kind: "state-subscription",
            methodName: "onProjection",
            signalSchema: AggregateStateSchema,
            emittedSchemas: [],
            parameterCount: 1,
            origin: "domestic",
          },
        ],
      },
    ]);
    const context = await BoundedContext.singleTenant("Tasks")
      .withGeneratedRegistryRoot(registryRoot)
      .add(GeneratedTaskAggregate)
      .add(TaskProjection)
      .buildAsync();

    expect(context.registeredRepositories().map((repository) => repository.entityType)).toEqual([
      GeneratedTaskAggregate,
      TaskProjection,
    ]);
    expect(context.commandBus().acceptedCommandTypes()).toEqual([
      TypeUrls.derive(ProjectionStateSchema),
    ]);

    await expect(context.commandBus().post(createProjectionCommand("command-4"))).resolves.toBe(
      undefined,
    );
  });

  it("executes a generated process-manager repository assembled through buildAsync", async () => {
    const observed: Event[] = [];
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: GeneratedTaskProcessManager,
        stateSchema: ProcessManagerStateSchema,
        handlers: [
          {
            kind: "command-assignment",
            methodName: "assignTask",
            signalSchema: AggregateStateSchema,
            emittedSchemas: [ProjectionStateSchema],
            parameterCount: 1,
            origin: "domestic",
          },
        ],
      },
    ]);
    const context = await BoundedContext.singleTenant("Tasks")
      .withGeneratedRegistryRoot(registryRoot)
      .add(GeneratedTaskProcessManager)
      .addEventDispatcher(
        createEventDispatcher([ProjectionStateSchema], (event) => {
          observed.push(event);
        }),
      )
      .buildAsync();

    await expect(
      context.commandBus().post(
        SignalEnvelopes.command({
          id: create(CommandIdSchema, { uuid: "command-generated-pm" }),
          context: create(CommandContextSchema, {
            actorContext: create(ActorContextSchema, {
              actor: create(UserIdSchema, { value: "user-1" }),
            }),
          }),
          schema: AggregateStateSchema,
          message: create(AggregateStateSchema, {
            id: "generated-pm",
            name: "Generated PM",
            archived: false,
          }),
        }),
      ),
    ).resolves.toBeUndefined();

    await expect(context.stand().read(ProcessManagerStateSchema, "generated-pm")).resolves.toEqual(
      create(ProcessManagerStateSchema, {
        id: "generated-pm",
        queue: "Generated PM assigned",
      }),
    );
    await waitForCondition(
      () => observed.length === 1,
      "generated process-manager produced event dispatch",
    );
    expect(observed).toHaveLength(1);
    expect(observed[0]?.id).toEqual(create(EventIdSchema, { value: "command-generated-pm-1" }));
    const message = observed[0]?.message;
    if (message === undefined) {
      throw new Error("Expected a generated process-manager produced event.");
    }
    expect(message.typeUrl).toBe(TypeUrls.derive(ProjectionStateSchema));
  });

  it("keeps producer-only event schemas off external routes while admitting follow-ups", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: GeneratedTaskProcessManager,
        stateSchema: ProcessManagerStateSchema,
        handlers: [
          {
            kind: "command-assignment",
            methodName: "assignTask",
            signalSchema: AggregateStateSchema,
            emittedSchemas: [ProjectionStateSchema],
            parameterCount: 1,
            origin: "domestic",
          },
        ],
      },
    ]);
    const context = await BoundedContext.singleTenant("Tasks")
      .withGeneratedRegistryRoot(registryRoot)
      .withStorageFactory(storageFactory)
      .add(GeneratedTaskProcessManager)
      .buildAsync();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, storageFactory);

    expect(context.eventBus().acceptedEventTypes()).toEqual([]);

    await context.commandBus().post(
      SignalEnvelopes.command({
        id: create(CommandIdSchema, { uuid: "command-producer-only" }),
        context: create(CommandContextSchema, {
          actorContext: create(ActorContextSchema, {
            actor: create(UserIdSchema, { value: "user-1" }),
          }),
        }),
        schema: AggregateStateSchema,
        message: create(AggregateStateSchema, {
          id: "producer-only",
          name: "Producer only",
          archived: false,
        }),
      }),
    );

    await waitForCondition(
      async () => (await eventStore.read()).length === 1,
      "producer-only event",
    );
    await expect(eventStore.read()).resolves.toMatchObject([
      { message: { typeUrl: TypeUrls.derive(ProjectionStateSchema) } },
    ]);
  });

  it("requires an explicit generated registry root for entity-class assembly", async () => {
    await expect(
      BoundedContext.singleTenant("Tasks").add(GeneratedTaskAggregate).buildAsync(),
    ).rejects.toThrow("requires withGeneratedRegistryRoot(root)");
  });

  it("accepts generated registry roots passed as file URL strings", async () => {
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: GeneratedTaskAggregate,
        stateSchema: AggregateStateSchema,
        handlers: [],
      },
    ]);

    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot(registryRoot.href)
        .add(GeneratedTaskAggregate)
        .buildAsync(),
    ).resolves.toBeInstanceOf(BoundedContext);
  });

  it("rejects malformed generated registry root URLs", async () => {
    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot("file://%")
        .add(GeneratedTaskAggregate)
        .buildAsync(),
    ).rejects.toThrow('Generated registry root "file://%" is not a valid URL.');
  });

  it("rejects generated registry roots outside file URLs", async () => {
    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot("https://example.com/generated")
        .add(GeneratedTaskAggregate)
        .buildAsync(),
    ).rejects.toThrow("must use the file: URL scheme");
  });

  it("rejects generated registry root URL aliases with query or hash", async () => {
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: GeneratedTaskAggregate,
        stateSchema: AggregateStateSchema,
        handlers: [],
      },
    ]);
    const aliasedRoot = new URL(registryRoot.href);

    aliasedRoot.search = "cache=1";

    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot(aliasedRoot)
        .add(GeneratedTaskAggregate)
        .buildAsync(),
    ).rejects.toThrow("must not include a query or hash");

    aliasedRoot.search = "";
    aliasedRoot.hash = "generated";

    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot(aliasedRoot)
        .add(GeneratedTaskAggregate)
        .buildAsync(),
    ).rejects.toThrow("must not include a query or hash");
  });

  it("rejects generated registry modules that resolve outside the trusted root", async () => {
    const fixture = createGeneratedRegistryFixture([
      {
        entityType: GeneratedTaskAggregate,
        stateSchema: AggregateStateSchema,
        handlers: [],
      },
    ]);
    const root = mkdtempSync(join(tmpdir(), "spine-context-generated-registry-root-"));
    const moduleDir = join(root, "generated/handler");

    mkdirSync(moduleDir, { recursive: true });
    symlinkSync(fixture.registryPath, join(moduleDir, "generated-handler-registry.js"));

    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot(pathToFileURL(root))
        .add(GeneratedTaskAggregate)
        .buildAsync(),
    ).rejects.toThrow("must resolve within the configured generated registry root");
  });

  it("checks the generated registry file before each import instead of using a stale module cache", async () => {
    const fixture = createGeneratedRegistryFixture([
      {
        entityType: GeneratedTaskAggregate,
        stateSchema: AggregateStateSchema,
        handlers: [],
      },
    ]);

    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot(fixture.root)
        .add(GeneratedTaskAggregate)
        .buildAsync(),
    ).resolves.toBeInstanceOf(BoundedContext);

    rmSync(fixture.registryPath);

    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot(fixture.root)
        .add(GeneratedTaskAggregate)
        .buildAsync(),
    ).rejects.toThrow("must exist and be readable");
  });

  it("fails clearly when generated metadata is missing for an entity class", async () => {
    const registryRoot = createGeneratedRegistryRoot([]);

    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot(registryRoot)
        .add(GeneratedTaskAggregate)
        .buildAsync(),
    ).rejects.toThrow("Generated handler registry is missing metadata for GeneratedTaskAggregate.");
  });

  it("fails clearly when sync build sees entity-class generated assembly", () => {
    expect(() => BoundedContext.singleTenant("Tasks").add(GeneratedTaskAggregate).build()).toThrow(
      "Use buildAsync().",
    );
  });

  it("does not register repositories removed before build", () => {
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks").add(repository).remove(repository).build();

    expect(context.registeredRepositories()).toEqual([]);
  });

  it("keeps repeated add of the same repository idempotent for one built context", () => {
    const storageFactory = new ObservingStorageFactory([]);
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(repository)
      .add(repository)
      .build();

    const repositories = context.registeredRepositories();
    expect(repositories).toHaveLength(1);
    expect(repositories[0]?.stateFullTypeName).toBe(AggregateStateSchema.typeName);
    expect(storageFactory.creationsFor(AggregateStateSchema.typeName)).toHaveLength(0);
  });

  it("rejects registering one repository instance with two built contexts", () => {
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });

    BoundedContext.singleTenant("Tasks").add(repository).build();

    expect(() => BoundedContext.singleTenant("Customers").add(repository).build()).toThrow(
      "already registered with Bounded Context",
    );
  });

  it("does not open repository storage during registration", () => {
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const storageFactory = new ObservingStorageFactory([]);

    const context = BoundedContext.singleTenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(repository)
      .build();

    expect(context.registeredRepositories()).toHaveLength(1);
    expect(storageFactory.creationsFor(AggregateStateSchema.typeName)).toEqual([]);
  });

  it("rejects duplicate repository entity or state identities when building", () => {
    const firstTaskRepository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const secondTaskRepository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const duplicateStateRepository = new Repository({
      entityType: DuplicateTaskAggregate,
      schema: AggregateStateSchema,
    });

    expect(() =>
      BoundedContext.singleTenant("Tasks")
        .add(firstTaskRepository)
        .add(secondTaskRepository)
        .build(),
    ).toThrow(`Repository entity type "TaskAggregate" is already registered.`);

    expect(() =>
      BoundedContext.singleTenant("Tasks")
        .add(firstTaskRepository)
        .add(duplicateStateRepository)
        .build(),
    ).toThrow(`Repository state type "${AggregateStateSchema.typeName}" is already registered.`);
  });

  it("rejects structural repository lookalikes before registration", () => {
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const structuralRepository = {
      entityType: repository.entityType,
      entityFamily: repository.entityFamily,
      stateSchema: repository.stateSchema,
      metadata: repository.metadata,
      stateFullTypeName: repository.stateFullTypeName,
      idField: repository.idField,
      snapshot: repository.snapshot,
    } as unknown as Repository<typeof TaskAggregate>;

    expect(() => BoundedContext.singleTenant("Tasks").add(structuralRepository)).toThrow(
      "BoundedContextBuilder.add(repository) requires a Repository instance.",
    );
  });

  it("uses captured repository metadata instead of virtual getters for registration", () => {
    const projectionMetadata = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    }).metadata;
    class SpoofingRepository extends Repository<typeof TaskAggregate> {
      constructor() {
        super({
          entityType: TaskAggregate,
          schema: AggregateStateSchema,
        });
      }

      override get metadata(): Repository<typeof TaskAggregate>["metadata"] {
        return projectionMetadata as unknown as Repository<typeof TaskAggregate>["metadata"];
      }

      override get stateFullTypeName(): Repository<typeof TaskAggregate>["stateFullTypeName"] {
        return ProjectionStateSchema.typeName as Repository<
          typeof TaskAggregate
        >["stateFullTypeName"];
      }
    }

    const storageFactory = new ObservingStorageFactory([]);
    const spoofingRepository = new SpoofingRepository();
    const projectionRepository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(spoofingRepository)
      .add(projectionRepository)
      .build();

    const repositories = context.registeredRepositories();
    expect(repositories.map((repository) => repository.stateFullTypeName)).toEqual([
      AggregateStateSchema.typeName,
      ProjectionStateSchema.typeName,
    ]);
    expect(repositories[0]).not.toBe(spoofingRepository);
    expect(repositories[1]).not.toBe(projectionRepository);
    expect(storageFactory.creationsFor(AggregateStateSchema.typeName)).toHaveLength(0);
  });

  it("defers repository provider failures until an operation selects storage", () => {
    const storageFactory = new FailingStorageFactory(6, ProjectionStateSchema.typeName);
    const aggregateRepository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const projectionRepository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });

    const context = BoundedContext.singleTenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(aggregateRepository)
      .add(projectionRepository)
      .build();

    expect(context.registeredRepositories()).toHaveLength(2);
    expect(storageFactory.creationsFor(AggregateStateSchema.typeName)).toHaveLength(0);
    expect(storageFactory.creationsFor(ProjectionStateSchema.typeName)).toHaveLength(0);
  });

  it("aborts retained domain and System buses when dispatcher registration throws", () => {
    for (const schema of [ProjectionStateSchema, EntityLog.EntityStateChangedSchema]) {
      const storageFactory = new ObservingStorageFactory([]);
      let schemaReads = 0;
      const dispatcher: EventDispatcher = {
        messageSchemas: () => {
          schemaReads++;
          if (schemaReads > 2) throw new Error(`Registration failed for ${schema.typeName}.`);
          return [schema];
        },
        dispatch: () => Promise.resolve(),
      };

      expect(() =>
        BoundedContext.singleTenant("Tasks")
          .withStorageFactory(storageFactory)
          .addEventDispatcher(dispatcher)
          .build(),
      ).toThrow(`Registration failed for ${schema.typeName}.`);
      expect(storageFactory.storages.every((storage) => !storage.isOpen())).toBe(true);
    }
  });

  it("preserves a dispatcher registration failure without opening System event storage", () => {
    const storageFactory = new ObservingStorageFactory([], [1]);
    const primary = new Error("System dispatcher registration failed.");
    let schemaReads = 0;
    const dispatcher: EventDispatcher = {
      messageSchemas: () => {
        schemaReads++;
        if (schemaReads > 2) throw primary;
        return [EntityLog.EntityStateChangedSchema];
      },
      dispatch: () => Promise.resolve(),
    };

    let failure: unknown;
    try {
      BoundedContext.singleTenant("Tasks")
        .persistSystemEvents()
        .withStorageFactory(storageFactory)
        .addEventDispatcher(dispatcher)
        .build();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBe(primary);
    expect(storageFactory.creationsFor(EventSchema.typeName)).toHaveLength(0);
  });

  it("builds without preparing storage for every registered repository", () => {
    const storageFactory = new FailingStorageFactory(7, ProcessManagerStateSchema.typeName, [5]);
    const aggregateRepository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const projectionRepository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const processManagerRepository = new Repository({
      entityType: TaskProcessManager,
      schema: ProcessManagerStateSchema,
    });

    const context = BoundedContext.singleTenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(aggregateRepository)
      .add(projectionRepository)
      .add(processManagerRepository)
      .build();

    expect(context.registeredRepositories()).toHaveLength(3);
    expect(storageFactory.creationsFor(AggregateStateSchema.typeName)).toHaveLength(0);
    expect(storageFactory.creationsFor(ProjectionStateSchema.typeName)).toHaveLength(0);
    expect(storageFactory.creationsFor(ProcessManagerStateSchema.typeName)).toHaveLength(0);
  });

  it("keeps add and remove chainable while maintaining the registration list", () => {
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const builder = BoundedContext.singleTenant("Tasks");

    expect(builder.add(repository)).toBe(builder);
    expect(builder.remove(repository)).toBe(builder);
    expect(builder).toBeInstanceOf(BoundedContextBuilder);
  });

  it("closes owned buses, stand, event store, repository storage, and tenant index once", async () => {
    const storageFactory = new ObservingStorageFactory([]);
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const context = BoundedContext.multitenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(repository)
      .build();

    await context.close();
    await context.close();

    await expect(
      context.commandBus().post(createProjectionCommand("command-closed")),
    ).rejects.toMatchObject({
      operation: "enqueue",
      state: "closed",
    });
    expect(() => context.stand().stateTypes()).toThrow("Stand is closed.");
    expect(storageFactory.storages.every((storage) => !storage.isOpen())).toBe(true);
    expect(storageFactory.isOpen()).toBe(true);
  });

  it("keeps the provider tenant catalog independent of repository registration", async () => {
    const storageFactory = new FailingStorageFactory(6, AggregateStateSchema.typeName);
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });

    const context = BoundedContext.multitenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(repository)
      .build();
    const tenantIndex = internalTenantIndex(context);

    await tenantIndex.keep(tenant("tenant-a"));
    await expect(tenantIndex.all()).resolves.toEqual([tenant("tenant-a")]);
    expect(storageFactory.creationsFor(AggregateStateSchema.typeName)).toHaveLength(0);
  });

  it("transfers and closes a custom subscription registry on a failed first build", async () => {
    const registry = new ObservingSubscriptionRegistry();
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const existing = BoundedContext.singleTenant("Existing").add(repository).build();
    const builder = BoundedContext.singleTenant("Tasks")
      .withSubscriptionRegistry(registry)
      .add(repository);

    try {
      expect(() => builder.build()).toThrow("already registered with Bounded Context");
      expect(registry.closeCalls).toBe(1);

      builder.remove(repository);
      const rebuilt = builder.build();
      expect(boundedContextAccess.subscriptionRegistry(rebuilt)).not.toBe(registry);
      await rebuilt.close();
    } finally {
      await existing.close();
    }
  });

  it("starts one Stand registry reconciliation after repository registration", async () => {
    const registry = new ObservingSubscriptionRegistry();
    const context = BoundedContext.singleTenant("StandReconciliation")
      .withSubscriptionRegistry(registry)
      .build();

    await vi.waitFor(() => {
      expect(registry.snapshotCalls).toBe(1);
    });
    await context.close();
  });

  it("waits for in-flight direct Stand updates before closing subscriptions", async () => {
    const storageFactory = new DelayingStorageFactory();
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(repository)
      .build();
    const deliveries: string[] = [];
    context.stand().subscribe(ProjectionStateSchema, (update) => {
      deliveries.push(update.state.name);
    });

    const update = context.stand().update(
      ProjectionStateSchema,
      create(ProjectionStateSchema, {
        id: "task-in-flight",
        name: "In Flight",
        priority: 1,
      }),
    );
    await storageFactory.writeStarted;
    const close = context.stand().close();

    expect(() => context.stand().stateTypes()).toThrow("Stand is closed.");

    storageFactory.releaseWrite();
    await update;
    await close;

    expect(deliveries).toEqual(["In Flight"]);
    await expect(
      context.stand().update(
        ProjectionStateSchema,
        create(ProjectionStateSchema, {
          id: "task-rejected",
          name: "Rejected",
          priority: 1,
        }),
      ),
    ).rejects.toThrow("Stand is closed.");
  });

  it("attempts every bounded-context close and reports aggregate failure", async () => {
    const storageFactory = new ObservingStorageFactory([], [1, 2]);
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(repository)
      .build();

    const closeFailure = await context.close().then(
      () => {
        throw new Error("Expected BoundedContext close to fail.");
      },
      (error: unknown) => {
        expect(error).toBeInstanceOf(AggregateError);
        return error as AggregateError;
      },
    );

    expect(closeFailure).toBeInstanceOf(AggregateError);
    expect(closeFailure).toMatchObject({
      message: "BoundedContext close failed.",
    });
    await expect(context.close()).rejects.toMatchObject({
      message: "BoundedContext close failed.",
    });
    expect(closeFailure.errors.map((error: Error) => error.message)).toEqual([
      "Cannot close record storage.",
    ]);
    expect(storageFactory.storages.every((storage) => !storage.isOpen())).toBe(true);
  });

  it("closes Stand before the registry without an internal tenant-record storage", async () => {
    const order: string[] = [];
    const storageFactory = new OrderedStorageFactory(order);
    const registry = new OrderedFailingRegistry(order);
    const closeStand = vi.spyOn(Stand.prototype, "close").mockImplementation(async function () {
      order.push("stand");
      await Promise.resolve();
      throw new Error("Stand close failed.");
    });
    const context = BoundedContext.multitenant("Tasks")
      .withStorageFactory(storageFactory)
      .withSubscriptionRegistry(registry)
      .add(new Repository({ entityType: TaskAggregate, schema: AggregateStateSchema }))
      .build();

    try {
      await expect(context.close()).rejects.toMatchObject({
        message: "BoundedContext close failed.",
      });
      expect(order.indexOf("stand")).toBeLessThan(order.indexOf("registry"));
      expect(order).not.toContain("storage:__spine/Tasks/tenants");
    } finally {
      closeStand.mockRestore();
    }
  });

  it("drains accepted domain work through the System bus before terminal cleanup", async () => {
    const order: string[] = [];
    const domainHandleFailure = new Error("domain Stand close failed");
    const systemHandleFailure = new Error("System Stand close failed");
    const registryFailure = new Error("registry close failed");
    const storageFactory = new OrderedStorageFactory(order);
    const registry = new OrderedFailingRegistry(order, registryFailure);
    let releaseCommand!: () => void;
    const commandReleased = new Promise<void>((resolve) => {
      releaseCommand = resolve;
    });
    const systemDispatcher = createEventDispatcher([EntityLog.EntityStateChangedSchema], () => {
      order.push("system event dispatched");
    });
    const commandDispatcher = createCommandDispatcher([ProjectionStateSchema], async () => {
      order.push("domain command accepted");
      await commandReleased;
      await (
        boundedContextAccess as unknown as {
          postSystemEvent(context: BoundedContext, event: Event): Promise<void>;
        }
      ).postSystemEvent(
        context,
        create(EventSchema, {
          id: { value: "terminal-system-event" },
          message: AnyMessages.pack(
            EntityLog.EntityStateChangedSchema,
            create(EntityLog.EntityStateChangedSchema, {
              entity: {
                id: AnyMessages.pack(
                  StringValueSchema,
                  create(StringValueSchema, { value: "task-1" }),
                ),
                typeUrl: TypeUrls.derive(ProjectionStateSchema),
              },
              newState: AnyMessages.pack(
                ProjectionStateSchema,
                create(ProjectionStateSchema, { id: "task-1", name: "Closed", priority: 1 }),
              ),
              signalId: [
                {
                  id: AnyMessages.pack(
                    StringValueSchema,
                    create(StringValueSchema, { value: "terminal-command" }),
                  ),
                  typeUrl: TypeUrls.derive(StringValueSchema),
                },
              ],
            }),
          ),
        }),
      );
      order.push("domain command finished");
    });
    const closeStand = vi.spyOn(Stand.prototype, "close").mockImplementation(function () {
      const role = order.includes("domain Stand close") ? "System" : "domain";
      order.push(`${role} Stand close`);
      return Promise.reject(role === "domain" ? domainHandleFailure : systemHandleFailure);
    });
    const context = BoundedContext.multitenant("Tasks")
      .withStorageFactory(storageFactory)
      .withSubscriptionRegistry(registry)
      .addCommandDispatcher(commandDispatcher)
      .addEventDispatcher(systemDispatcher)
      .build();

    try {
      const command = context.commandBus().post(createProjectionCommand("terminal-command"));
      await vi.waitFor(() => {
        expect(order).toEqual(["domain command accepted"]);
      });
      const firstClose = context.close();
      const secondClose = context.close();
      expect(secondClose).toBe(firstClose);
      releaseCommand();
      await expect(command).resolves.toBeUndefined();
      const failure = await firstClose.then(
        () => {
          throw new Error("Expected terminal close to fail.");
        },
        (error: unknown) => error,
      );

      expect(order).toEqual([
        "domain command accepted",
        "system event dispatched",
        "domain command finished",
        "domain Stand close",
        "System Stand close",
        "registry",
      ]);
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([
        domainHandleFailure,
        systemHandleFailure,
        registryFailure,
      ]);
      await expect(secondClose).rejects.toBe(failure);
      expect(registry.closeCalls).toBe(1);
      await expect(
        context.commandBus().post(createProjectionCommand("late-command")),
      ).rejects.toThrow("server runtime is closed");
      await expect(context.eventBus().post(createProjectionEvent("late-event"))).rejects.toThrow(
        "server runtime is closed",
      );
      await expect(
        context
          .eventBus()
          .post(createProjectionEvent("late-tenant-event", "task-1", tenant("tenant-a"))),
      ).rejects.toThrow("server runtime is closed");
      expect(boundedContextAccess.systemPairing(context)).toBeDefined();
      expect(boundedContextAccess.tenantIndex(context)).toBeDefined();
      expect(boundedContextAccess.storageFactory(context)).toBe(storageFactory);
      expect(boundedContextAccess.delivery(context)).toBeDefined();
      expect(boundedContextAccess.subscriptionRegistry(context)).toBe(registry);
      expect(() => boundedContextAccess.loggerFor(context)).toThrow(
        "Context logger requires a built BoundedContext instance.",
      );
    } finally {
      closeStand.mockRestore();
    }
  });

  it("does not expose repository, delivery, gRPC, or transport APIs on BoundedContext", () => {
    const context = BoundedContext.singleTenant("Tasks").build();
    const forbiddenMembers = [
      "repositories",
      "register",
      "registerRepository",
      "storage",
      "storageFactory",
      "delivery",
      "grpc",
      "transport",
      "importBus",
      "systemContext",
      "tenantIndex",
      "repositoryLifecycle",
      "openStorage",
      "dispatch",
      "invoke",
    ];

    for (const member of forbiddenMembers) {
      expect(member in context).toBe(false);
      expect(Object.hasOwn(context, member)).toBe(false);
    }
  });
});

class ObservingStorageFactory extends InMemoryStorageFactory {
  readonly creations: StorageCreation[] = [];
  readonly storages: RecordStorage<unknown, Message>[] = [];
  #creationCount = 0;

  constructor(
    private readonly observed: string[],
    private readonly throwOnCloseCreations: readonly number[] = [],
  ) {
    super();
  }

  creationsFor(typeName: string): readonly StorageCreation[] {
    return this.creations.filter(
      (creation) => creation.recordSpec.sourceType.typeName === typeName,
    );
  }

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    this.#creationCount += 1;
    this.creations.push({ context, recordSpec: eraseRecordSpec(recordSpec) });
    const storage = this.throwOnCloseCreations.includes(this.#creationCount)
      ? new ThrowingCloseRecordStorage(context, recordSpec, this.observed)
      : new ObservingRecordStorage(context, recordSpec, this.observed);
    this.storages.push(eraseRecordStorage(storage));
    return storage;
  }
}

class DelayingStorageFactory extends InMemoryStorageFactory {
  readonly writeStarted: Promise<void>;
  #startWrite: (() => void) | undefined;
  #finishWrite: (() => void) | undefined;
  #writeFinished: Promise<void>;
  #delayed = false;

  constructor() {
    super();
    this.writeStarted = new Promise((resolve) => {
      this.#startWrite = resolve;
    });
    this.#writeFinished = new Promise((resolve) => {
      this.#finishWrite = resolve;
    });
  }

  releaseWrite(): void {
    this.#finishWrite?.();
  }

  // The protected storage seam intentionally returns unknown; this test fixture
  // narrows only the fields it decorates.
  override createEntityStorage(input: unknown): unknown {
    const storage = super.createEntityStorage(input) as {
      readonly current: EntityRecordStorage<unknown>;
      readonly events: unknown;
      readonly states: unknown;
      close(): void;
    };
    const current = storage.current;
    const delayedCurrent: EntityRecordStorage<unknown> = {
      read: (id) => current.read(id),
      query: (plan) => current.query(plan),
      write: async (record) => {
        if (!this.#delayed) {
          this.#delayed = true;
          this.#startWrite?.();
          await this.#writeFinished;
        }
        await current.write(record);
      },
    };
    return {
      current: delayedCurrent,
      events: storage.events,
      states: storage.states,
      close: () => {
        storage.close();
      },
    };
  }
}

class ObservingSubscriptionRegistry extends InMemorySubscriptionRegistry {
  closeCalls = 0;
  snapshotCalls = 0;

  override snapshot() {
    this.snapshotCalls += 1;
    return super.snapshot();
  }

  override async close(): Promise<void> {
    this.closeCalls += 1;
    await super.close();
  }
}

class OrderedFailingRegistry extends InMemorySubscriptionRegistry {
  closeCalls = 0;

  constructor(
    private readonly order: string[],
    private readonly failure = new Error("Registry close failed."),
  ) {
    super();
  }

  override close(): Promise<void> {
    this.closeCalls += 1;
    this.order.push("registry");
    return Promise.reject(this.failure);
  }
}

class OrderedStorageFactory extends InMemoryStorageFactory {
  constructor(private readonly order: string[]) {
    super();
  }

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new OrderedRecordStorage(context, recordSpec, this.order);
  }
}

class OrderedRecordStorage<I, R extends Message> extends InMemoryRecordStorage<I, R> {
  readonly #contextName: string;

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    private readonly order: string[],
  ) {
    super(context, recordSpec);
    this.#contextName = context.name;
  }

  override close(): void {
    super.close();
    this.order.push(`storage:${this.#contextName}`);
  }
}

class FailingStorageFactory extends ObservingStorageFactory {
  constructor(
    _failedAttempt: number,
    private readonly failedTypeName: string,
    throwOnCloseCreations: readonly number[] = [],
  ) {
    super([], throwOnCloseCreations);
  }

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    if (recordSpec.sourceType.typeName === this.failedTypeName) {
      throw new Error(`Cannot open storage for "${this.failedTypeName}".`);
    }
    return super.onCreateRecordStorage(context, recordSpec);
  }
}

class ObservingRecordStorage<I, R extends Message> extends InMemoryRecordStorage<I, R> {
  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    private readonly observed: string[],
  ) {
    super(context, recordSpec);
  }

  protected override async writeRecord(
    record: ReturnType<RecordSpec<I, R>["materialize"]>,
  ): Promise<void> {
    this.#observe(record);
    await super.writeRecord(record);
  }

  protected override async writeAllRecords(
    records: readonly ReturnType<RecordSpec<I, R>["materialize"]>[],
  ): Promise<void> {
    for (const record of records) {
      this.#observe(record);
    }
    await super.writeAllRecords(records);
  }

  protected override async compareAndSetRecord(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
    const applied = await super.compareAndSetRecord(id, expected, next);
    if (applied && next !== undefined) this.#observe(next);
    return applied;
  }

  #observe(record: ReturnType<RecordSpec<I, R>["materialize"]>): void {
    const candidate = record.record as { id?: { value?: string } };
    this.observed.push(`store:${candidate.id?.value ?? "missing"}`);
  }
}

class ThrowingCloseRecordStorage<I, R extends Message> extends ObservingRecordStorage<I, R> {
  override close(): void {
    super.close();
    throw new Error("Cannot close record storage.");
  }
}

function createCommandDispatcher(
  schemas: readonly GenMessage<Message>[],
  onDispatch: (command: ReturnType<typeof createProjectionCommand>) => void | Promise<void>,
): CommandDispatcher {
  return {
    messageSchemas: () => schemas,
    dispatch: (command) => Promise.resolve(onDispatch(command)),
  };
}

function createEventDispatcher(
  schemas: readonly GenMessage<Message>[],
  onDispatch: (event: ReturnType<typeof createProjectionEvent>) => void | Promise<void>,
): EventDispatcher {
  return {
    messageSchemas: () => schemas,
    dispatch: (event) => Promise.resolve(onDispatch(event)),
  };
}

function createProjectionCommand(id: string, targetId = "task-1") {
  return SignalEnvelopes.command({
    id: create(CommandIdSchema, { uuid: id }),
    context: create(CommandContextSchema, {
      actorContext: create(ActorContextSchema, {
        actor: create(UserIdSchema, { value: "user-1" }),
      }),
    }),
    schema: ProjectionStateSchema,
    message: create(ProjectionStateSchema, {
      id: targetId,
      name: "Task",
      priority: 1,
    }),
  });
}

function createAggregateCommand(id: string, targetId = "task-ready", tenantId?: string) {
  return SignalEnvelopes.command({
    id: create(CommandIdSchema, { uuid: id }),
    context: create(CommandContextSchema, {
      actorContext: create(ActorContextSchema, {
        ...(tenantId === undefined
          ? {}
          : {
              tenantId: create(TenantIdSchema, {
                kind: { case: "value", value: tenantId },
              }),
            }),
        actor: create(UserIdSchema, { value: "user-1" }),
      }),
    }),
    schema: AggregateStateSchema,
    message: create(AggregateStateSchema, {
      id: targetId,
      name: "Task Ready",
      archived: false,
    }),
  });
}

function createProjectionEvent(id: string, targetId = "task-1", tenantId?: TenantId) {
  return SignalEnvelopes.event({
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      ...(tenantId === undefined
        ? {}
        : {
            origin: {
              case: "importContext" as const,
              value: create(ActorContextSchema, { tenantId }),
            },
          }),
      producerId: AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: "aggregate-1" })),
      version: create(VersionSchema, { number: 1 }),
    }),
    schema: ProjectionStateSchema,
    message: create(ProjectionStateSchema, {
      id: targetId,
      name: "Task",
      priority: 1,
    }),
  });
}

function createGeneratedRegistryFixture(
  entities: readonly {
    readonly entityType: object;
    readonly stateSchema: GenMessage<Message>;
    readonly handlers: readonly {
      readonly kind:
        | "command-assignment"
        | "command-reaction"
        | "event-subscription"
        | "state-subscription"
        | "event-reaction";
      readonly methodName: string;
      readonly signalSchema: GenMessage<Message>;
      readonly emittedSchemas: readonly GenMessage<Message>[];
      readonly parameterCount: 1 | 2;
      readonly origin: "domestic" | "external";
    }[];
  }[],
): { readonly root: URL; readonly registryPath: string } {
  const slot = `__spineContextGeneratedRegistry_${Math.random().toString(36).slice(2)}`;
  const root = mkdtempSync(join(tmpdir(), "spine-context-generated-registry-"));
  const moduleDir = join(root, "generated/handler");
  const registryPath = join(moduleDir, "generated-handler-registry.js");
  const values = globalThis as Record<string, unknown>;

  mkdirSync(moduleDir, { recursive: true });
  values[slot] = Object.freeze({ version: 3, entities });
  writeFileSync(
    registryPath,
    `export const generatedHandlerRegistry = globalThis[${JSON.stringify(slot)}];\n`,
    "utf8",
  );

  return Object.freeze({
    root: pathToFileURL(root),
    registryPath,
  });
}

function createGeneratedRegistryRoot(
  entities: Parameters<typeof createGeneratedRegistryFixture>[0],
): URL {
  return createGeneratedRegistryFixture(entities).root;
}

function processManagerRegistry(
  entityType: typeof FailingRecoveryProcessManager | typeof FreshRecoveryProcessManager,
) {
  return {
    entityType,
    stateSchema: ProcessManagerStateSchema,
    handlers: [
      {
        kind: "command-assignment" as const,
        methodName: "assignTask",
        signalSchema: AggregateStateSchema,
        emittedSchemas: [ProjectionStateSchema],
        parameterCount: 1 as const,
        origin: "domestic" as const,
      },
    ],
  };
}

function aggregateReplayRegistry(entityType: typeof ReplayTaskAggregate) {
  return {
    entityType,
    stateSchema: AggregateStateSchema,
    handlers: [
      {
        kind: "command-assignment" as const,
        methodName: "assignTask",
        signalSchema: ProjectionStateSchema,
        emittedSchemas: [AggregateStateSchema],
        parameterCount: 1 as const,
        origin: "domestic" as const,
      },
    ],
  };
}

function replayProcessManagerRegistry(entityType: typeof ReplayTaskProcessManager) {
  return {
    entityType,
    stateSchema: ProcessManagerStateSchema,
    handlers: [
      {
        kind: "command-assignment" as const,
        methodName: "assignTask",
        signalSchema: AggregateStateSchema,
        emittedSchemas: [AggregateStateSchema],
        parameterCount: 1 as const,
        origin: "domestic" as const,
      },
      {
        kind: "event-reaction" as const,
        methodName: "reactToProjection",
        signalSchema: ProjectionStateSchema,
        emittedSchemas: [AggregateStateSchema],
        parameterCount: 1 as const,
        origin: "domestic" as const,
      },
    ],
  };
}

function targetForShard(
  strategy: DeliveryStrategy,
  targetTypeUrl: string,
  index: number,
  prefix: string,
): string {
  for (let suffix = 0; suffix < 1_000; suffix += 1) {
    const targetId = `${prefix}-${String(suffix)}`;
    if (strategy.shardFor(Identifiers.pack("string", targetId), targetTypeUrl).index === index)
      return targetId;
  }
  throw new Error(`Could not find target for shard ${String(index)}.`);
}

async function persistDescriptorRow(input: {
  readonly descriptor: InternalDeliveryDescriptor;
  readonly storageFactory: InMemoryStorageFactory;
  readonly targetTypeUrl: string;
  readonly targetId: string;
  readonly signalId: string;
  readonly label: "HANDLE_COMMAND" | "REACT_UPON_EVENT";
  readonly signal: Any;
  readonly shard: ShardIndex;
}): Promise<InboxMessage> {
  const written = await new Delivery({
    context: input.descriptor.storageContext({}),
    storageFactory: input.storageFactory,
  }).inbox.receive({
    inboxId: {
      targetTypeUrl: input.targetTypeUrl,
      targetId: Identifiers.pack("string", input.targetId),
    },
    signalId: input.signalId,
    label: input.label,
    signal: input.signal,
    shard: input.shard,
    status: "TO_DELIVER",
    whenReceived: new Date("2026-08-04T12:00:00.000Z"),
    version: 1n,
  });
  if (written.outcome !== "WRITTEN") {
    throw new Error("Expected descriptor fixture row to be written.");
  }
  return written.message;
}

function removeGeneratedRegistry(fixture: { readonly registryPath: string }): void {
  rmSync(join(fixture.registryPath, "../../.."), { recursive: true, force: true });
}

function requireRecoveryContext(context: BoundedContext | undefined): BoundedContext {
  if (context === undefined) {
    throw new Error("Expected a fresh bounded context before descriptor recovery.");
  }
  return context;
}

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  label: string,
): Promise<void> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

interface StorageCreation {
  readonly context: StorageContext;
  readonly recordSpec: RecordSpec<unknown, Message>;
}

function eraseRecordSpec<I, R extends Message>(
  recordSpec: RecordSpec<I, R>,
): RecordSpec<unknown, Message> {
  return recordSpec as unknown as RecordSpec<unknown, Message>;
}

function eraseRecordStorage<I, R extends Message>(
  storage: RecordStorage<I, R>,
): RecordStorage<unknown, Message> {
  return storage as unknown as RecordStorage<unknown, Message>;
}
