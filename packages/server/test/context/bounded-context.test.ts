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

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { create, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { StringValueSchema, type Any } from "@bufbuild/protobuf/wkt";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Identifiers, TypeUrls, AnyPacker, SignalEnvelopes } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  CommandSchema,
  type Event,
  EventContextSchema,
  type EventContext,
  EventIdSchema,
  EventSchema,
  TenantIdSchema,
  type TenantId,
  UserIdSchema,
  VersionSchema,
} from "@spine-event-engine/proto";
import {
  EventStore,
  InMemoryStorageBackend,
  InMemoryStorageFactory,
  InMemoryRecordStorage,
  type RecordSpec,
  type RecordStorage,
  type StorageGroup,
  type StorageContext,
  StorageFactory,
} from "@spine-event-engine/storage";
import { InboxMessageSchema } from "@spine-event-engine/proto/delivery";
import {
  StoragePreparations,
  type EntityRecordStorage,
} from "@spine-event-engine/storage/provider";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  Aggregate,
  AbstractAssignee,
  AbstractCommander,
  AbstractEventReactor,
  AbstractEventSubscriber,
  BoundedContext,
  BoundedContextBuilder,
  BoundedContextNameError,
  DuplicateEntityStateException,
  EventRouting,
  ProcessManager,
  Projection,
  Repository,
  SingleProcessServerRuntime,
  UniformAcrossAllShards,
  type CommandEndpoint,
  type CommandDispatcher,
  type EventEndpoint,
  type EventDispatcher,
  type RepositoryView,
  type EntityOptions,
} from "../../src/index.js";
import { boundedContextAccess } from "../../src/context/bounded-context.js";
import { TenantIndexes } from "../../src/context/tenant-index.js";
import { StandaloneHandlerRuntime } from "../../src/runtime/standalone-handler-runtime.js";
import type { DeliveryStrategy } from "../../src/delivery/delivery-builder.js";
import { Inbox, type InboxMessage } from "../../src/delivery/inbox.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import { serverEnvironmentAccess } from "../../src/server/server-environment.js";
import {
  ServerEnvironment,
  ServerEnvironmentLifecycle,
} from "../../src/server/server-environment.js";
import { EnvironmentType } from "../../src/server/environment.js";
import { IntegrationBroker } from "../../src/integration/integration-broker.js";
import { GeneratedRegistryDiscovery } from "../../src/handler/generated-registry-discovery.js";
import {
  InMemorySubscriptionRegistry,
  StorageSubscriptionRegistry,
} from "../../src/stand/subscription-registry.js";
import { Stand } from "../../src/stand/stand.js";
import * as EntityLog from "@spine-event-engine/proto/generated/spine/system/server/entity_log_events_pb.js";
import {
  type AssignReviewTask,
  AssignReviewTaskSchema,
  type ScheduleReviewTask,
  ScheduleReviewTaskSchema,
} from "../../test-fixtures/generated/handler-registry/commands_pb.js";
import {
  type ReviewStarted,
  ReviewStartedSchema,
  type ReviewTaskAssigned,
  ReviewTaskAssignedSchema,
} from "../../test-fixtures/generated/handler-registry/events_pb.js";
import {
  type ProcessManagerState,
  ProcessManagerStateSchema,
} from "../../test-fixtures/generated/entity-metadata/visibility_pb.js";
import { tenant } from "../tenant-fixture.js";

beforeEach(async () => {
  await ServerEnvironment.instance().completeSetup();
});

afterEach(async () => {
  const environment = ServerEnvironment.instance();
  for (const context of serverEnvironmentAccess.openContexts(environment)) await context.close();
  await ServerEnvironmentLifecycle.resetForTest();
});

async function configureStorage(storageFactory: StorageFactory): Promise<void> {
  await ServerEnvironmentLifecycle.resetForTest();
  ServerEnvironment.when(EnvironmentType.Local).use({ storageFactory });
  await ServerEnvironment.instance().completeSetup();
}

async function configureDelivery(
  storageFactory: StorageFactory,
  strategy: DeliveryStrategy,
): Promise<void> {
  await ServerEnvironmentLifecycle.resetForTest();
  ServerEnvironment.when(EnvironmentType.Local).use({ storageFactory, deliveryStrategy: strategy });
  await ServerEnvironment.instance().completeSetup();
}

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
  all(): Promise<readonly TenantId[]>;
  contains(tenantId: TenantId): Promise<boolean>;
  keep(tenantId: TenantId): Promise<void>;
}

interface InternalDeliveryEndpoint {
  readonly label: "HANDLE_COMMAND" | "UPDATE_SUBSCRIBER" | "REACT_UPON_EVENT";
  readonly targetTypeUrl: string;
  readonly shard: { readonly index: number; readonly ofTotal: number };
}

interface InternalDeliveryDescriptor {
  endpoints(): readonly InternalDeliveryEndpoint[];
  replay(message: InboxMessage, tenantId?: string): Promise<void>;
}

type ProjectState = Message<"ProjectState"> & {
  id: string;
  name: string;
  archived: boolean;
};

const { ProjectOverviewStateSchema, ProjectStateSchema } =
  await import("../../test-fixtures/generated/entity-metadata/project_states_pb.js");

class TaskAggregate extends Aggregate<string, typeof ProjectStateSchema> {}
class DuplicateTaskAggregate extends Aggregate<string, typeof ProjectStateSchema> {}
class ReplayTaskAggregate extends Aggregate<string, typeof ProjectStateSchema> {
  assignTask(command: AssignReviewTask): ReviewStarted {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectStateSchema, { id: command.id, name: command.name, archived: false }),
      ),
    );
    return create(ReviewStartedSchema, { id: command.id });
  }
}
class GeneratedTaskAggregate extends Aggregate<string, typeof ProjectStateSchema> {
  assignProjection(command: AssignReviewTask): ReviewTaskAssigned {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectStateSchema, {
          id: command.id,
          name: command.name,
          archived: false,
        }),
      ),
    );

    return create(ReviewTaskAssignedSchema, { id: command.id, name: command.name });
  }
}
class TaskProjection extends Projection<string, typeof ProjectOverviewStateSchema> {
  onProjection(event: ProcessManagerState): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectOverviewStateSchema, {
          id: event.id,
          name: event.queue,
          priority: 1,
        }),
      ),
    );
  }
}
class TaskProcessManager extends ProcessManager<string, typeof ProcessManagerStateSchema> {}
class StandaloneAssignee extends AbstractAssignee {
  assign(): ReviewTaskAssigned {
    return create(ReviewTaskAssignedSchema, { id: "event-1", name: "assigned" });
  }
}
class OtherStandaloneAssignee extends AbstractAssignee {
  assign(): ReviewTaskAssigned {
    return create(ReviewTaskAssignedSchema, { id: "event-2", name: "other" });
  }
}
class StandaloneCommander extends AbstractCommander {
  substitute(command: ScheduleReviewTask): AssignReviewTask {
    return create(AssignReviewTaskSchema, { id: command.id, name: command.name });
  }
}
class DependencyInjectedStandaloneCommander extends AbstractCommander {
  constructor(readonly dependency: string) {
    super();
  }

  substitute(command: ScheduleReviewTask): AssignReviewTask {
    return create(AssignReviewTaskSchema, {
      id: command.id,
      name: `${command.name} ${this.dependency}`,
    });
  }
}
class CollidingStandaloneCommander extends AbstractCommander {
  substitute(command: AssignReviewTask): AssignReviewTask {
    return create(AssignReviewTaskSchema, { id: command.id, name: command.name });
  }
}
class SiblingStandaloneCommander extends AbstractCommander {
  substitute(): readonly AssignReviewTask[] {
    return [
      create(AssignReviewTaskSchema, { id: "failing-produced-command", name: "Failing" }),
      create(AssignReviewTaskSchema, { id: "later-produced-command", name: "Later" }),
    ];
  }
}
class StandaloneReactor extends AbstractEventReactor {
  calls = 0;
  react(_event: ReviewTaskAssigned, _context: EventContext): void {
    void _event;
    void _context;
    this.calls += 1;
  }
}
class StandaloneSubscriber extends AbstractEventSubscriber {
  calls = 0;
  subscribe(_event: ReviewTaskAssigned, _context: EventContext): void {
    void _event;
    void _context;
    this.calls += 1;
  }
}
class ProducingStandaloneReactor extends AbstractEventReactor {
  react(): ReviewStarted {
    return create(ReviewStartedSchema, { id: "produced-event" });
  }
}
class StateOutputSubscriber extends AbstractEventSubscriber {
  subscribe(_state: ProjectState): ReviewTaskAssigned {
    void _state;
    return create(ReviewTaskAssignedSchema, { id: "illegal", name: "illegal output" });
  }
}
class GeneratedTaskProcessManager extends ProcessManager<string, typeof ProcessManagerStateSchema> {
  assignTask(command: AssignReviewTask): ReviewTaskAssigned {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProcessManagerStateSchema, {
          id: command.id,
          queue: `${command.name} assigned`,
        }),
      ),
    );

    return create(ReviewTaskAssignedSchema, {
      id: command.id,
      name: `${command.name} event`,
    });
  }
}
class ConfiguredTaskAssignment extends GeneratedTaskProcessManager {
  constructor(
    options: EntityOptions<string, typeof ProcessManagerStateSchema>,
    readonly service: string,
  ) {
    super(options);
  }

  override assignTask(command: AssignReviewTask): ReviewTaskAssigned {
    const event = super.assignTask(command);
    this.update((draft) => {
      draft.queue += this.service;
    });
    return event;
  }
}

class ReplayTaskProcessManager extends ProcessManager<string, typeof ProcessManagerStateSchema> {
  assignTask(command: ScheduleReviewTask): ReviewStarted {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProcessManagerStateSchema, {
          id: command.id,
          queue: `${command.name} command replayed`,
        }),
      ),
    );
    return create(ReviewStartedSchema, { id: command.id });
  }

  reactToProjection(event: ReviewTaskAssigned): ReviewStarted {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProcessManagerStateSchema, {
          id: event.id,
          queue: `${event.name} event replayed`,
        }),
      ),
    );
    return create(ReviewStartedSchema, { id: event.id });
  }
}

const inboxReadFailure = new Error("Inbox read unavailable before dispatch");

class FailingInboxReadStorageFactory extends InMemoryStorageFactory {
  #failInboxQueries = false;

  failInboxQueries(): void {
    this.#failInboxQueries = true;
  }

  allowInboxQueries(): void {
    this.#failInboxQueries = false;
  }

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): RecordStorage<I, R> {
    const storage = super.onCreateRecordStorage(context, recordSpec, group);
    if (recordSpec.sourceType.typeName !== InboxMessageSchema.typeName) return storage;
    const queryEntries = storage.queryEntries.bind(storage);
    vi.spyOn(storage, "queryEntries").mockImplementation((query) => {
      if (this.#failInboxQueries) {
        return Promise.reject(inboxReadFailure);
      }
      return queryEntries(query);
    });
    return storage;
  }
}

class FreshRecoveryProcessManager extends ProcessManager<string, typeof ProcessManagerStateSchema> {
  assignTask(command: AssignReviewTask): ReviewTaskAssigned {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProcessManagerStateSchema, {
          id: command.id,
          queue: `${command.name} recovered`,
        }),
      ),
    );
    return create(ReviewTaskAssignedSchema, {
      id: command.id,
      name: command.name,
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
  it("requires creation options for generated classes with required constructor services", () => {
    const assertGeneratedCreationTypes = () => {
      // @ts-expect-error the generated repository cannot construct the required service alone.
      BoundedContext.singleTenant("Tasks").add(ConfiguredTaskAssignment);
      BoundedContext.singleTenant("Tasks").add(ConfiguredTaskAssignment, {
        onCreate: (options) => new ConfiguredTaskAssignment(options, "ready"),
      });
      BoundedContext.singleTenant("Tasks").add(ConfiguredTaskAssignment, {
        onCreate: () =>
          // @ts-expect-error generated onCreate must return the registered class.
          new GeneratedTaskProcessManager(
            {} as EntityOptions<string, typeof ProcessManagerStateSchema>,
          ),
      });
    };
    expectTypeOf(assertGeneratedCreationTypes).not.toBeAny();
  });

  it("uses generated onCreate for a Process Manager constructor service", async () => {
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: ConfiguredTaskAssignment,
        stateSchema: ProcessManagerStateSchema,
        handlers: [
          {
            kind: "command-assignment",
            methodName: "assignTask",
            input: { schema: AssignReviewTaskSchema, origin: "domestic" },
            outcomes: { returned: [ReviewTaskAssignedSchema], thrown: [] },
            parameterCount: 1,
          },
        ],
      },
    ]);
    const seen: number[] = [];
    const context = await BoundedContext.singleTenant("Tasks")
      .withGeneratedRegistryRoot(registryRoot)
      .add(ConfiguredTaskAssignment, {
        onCreate(options) {
          seen.push(options.version?.number ?? -1);
          return new ConfiguredTaskAssignment(options, " via client");
        },
      })
      .build();

    try {
      await context
        .commandBus()
        .post(createAggregateCommand("generated-service-1", "generated-service"));
      await context
        .commandBus()
        .post(createAggregateCommand("generated-service-2", "generated-service"));
      expect(seen).toEqual([0, 1]);
      await expect(
        context.stand().read(ProcessManagerStateSchema, "generated-service"),
      ).resolves.toMatchObject({ queue: "Task Ready assigned via client" });
    } finally {
      await context.close();
    }
  });
  it("installs the environment logger before a completed build is exposed", async () => {
    const context = await BoundedContext.singleTenant("Logger").build();
    try {
      expect(boundedContextAccess.loggerFor(context)).toBeDefined();
    } finally {
      await context.close();
    }
  });

  it("rejects empty or blank context names", () => {
    expect(() => BoundedContext.singleTenant("\t\n")).toThrow(BoundedContextNameError);
    expect(() => BoundedContext.multitenant("")).toThrow(BoundedContextNameError);
    expect(() => BoundedContext.singleTenant("__spine/Tasks/tenants")).toThrow(
      BoundedContextNameError,
    );
  });

  it("builds single-tenant and multitenant contexts with names and tenant mode", async () => {
    const singleTenant = await BoundedContext.singleTenant("Tasks").build();
    const multitenant = await BoundedContext.multitenant("Customers").build();

    expect(singleTenant.name.value).toBe("Tasks");
    expect(singleTenant.tenantMode).toBe("single-tenant");
    expect(singleTenant.isMultitenant).toBe(false);
    expect(singleTenant.spec.multitenant).toBe(false);

    expect(multitenant.name.value).toBe("Customers");
    expect(multitenant.tenantMode).toBe("multitenant");
    expect(multitenant.isMultitenant).toBe(true);
    expect(multitenant.spec.multitenant).toBe(true);
  });

  it("derives internal system pairing metadata for built domain contexts", async () => {
    const singleTenant = await BoundedContext.singleTenant("Tasks").build();
    const multitenant = await BoundedContext.multitenant("Customers").build();

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

  it("persists only paired system events when explicitly enabled", async () => {
    const context = await BoundedContext.singleTenant("AuditedTasks").persistSystemEvents().build();

    expect(internalSystemPairing(context).system.storesEvents).toBe(true);
  });

  it("defers event record storage until an event operation selects its tenant", async () => {
    const storageFactory = new ObservingStorageFactory([]);
    await configureStorage(storageFactory);
    const context = await BoundedContext.singleTenant("AcquisitionOrder")
      .persistSystemEvents()
      .build();

    expect(storageFactory.creations.map((creation) => creation.context.name)).not.toContain(
      "AcquisitionOrder_System",
    );
    await context.close();
  });

  it("does not register a synthetic tenant for a single-tenant context", async () => {
    const context = await BoundedContext.singleTenant("Tasks").build();
    const tenantIndex = internalTenantIndex(context);

    expect(context.tenantMode).toBe("single-tenant");
    expect(context.tenantIndex).toBe(ServerEnvironment.instance().tenantIndex);
    await expect(tenantIndex.contains(tenant("tenant-a"))).resolves.toBe(false);
  });

  it("keeps the shared index usable after context close", async () => {
    const context = await BoundedContext.singleTenant("Tasks").build();
    const tenantIndex = internalTenantIndex(context);

    await context.close();

    await tenantIndex.keep(tenant("after-close"));
    await expect(tenantIndex.contains(tenant("after-close"))).resolves.toBe(true);
  });

  it("stores multitenant index entries through the configured storage factory", async () => {
    const storageFactory = new InMemoryStorageFactory();
    await configureStorage(storageFactory);
    const selectedIndex = TenantIndexes.fromFactory(storageFactory);
    const first = await BoundedContext.multitenant("Customers")
      .withTenantIndex(selectedIndex)
      .build();
    const firstIndex = internalTenantIndex(first);

    expect(firstIndex).toBe(selectedIndex);

    await firstIndex.keep(tenant("tenant-b"));
    await firstIndex.keep(tenant("tenant-a"));
    await firstIndex.keep(tenant("tenant-a"));

    await expect(firstIndex.all()).resolves.toEqual([tenant("tenant-a"), tenant("tenant-b")]);

    const recovered = await BoundedContext.multitenant("Customers")
      .withTenantIndex(selectedIndex)
      .build();
    const recoveredIndex = internalTenantIndex(recovered);

    await expect(recoveredIndex.all()).resolves.toEqual([tenant("tenant-a"), tenant("tenant-b")]);
  });

  it("uses the environment delivery and tenant index across sibling contexts", async () => {
    const storageFactory = new InMemoryStorageFactory();
    await configureStorage(storageFactory);
    const selectedIndex = TenantIndexes.fromFactory(storageFactory);
    const single = await BoundedContext.singleTenant("Tasks").build();
    const multitenant = await BoundedContext.multitenant("Customers")
      .withTenantIndex(selectedIndex)
      .build();

    await internalTenantIndex(multitenant).keep(tenant("tenant-b"));
    await internalTenantIndex(multitenant).keep(tenant("tenant-a"));

    expect(ServerEnvironment.instance().storageFactory).toBe(storageFactory);
    expect(single.tenantIndex).toBe(ServerEnvironment.instance().tenantIndex);
    await expect(multitenant.tenantIndex.all()).resolves.toEqual([
      tenant("tenant-a"),
      tenant("tenant-b"),
    ]);
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
            input: { schema: AssignReviewTaskSchema, origin: "domestic" },
            outcomes: { returned: [ReviewTaskAssignedSchema], thrown: [] },
            parameterCount: 1,
          },
        ],
      },
      {
        entityType: TaskProjection,
        stateSchema: ProjectOverviewStateSchema,
        handlers: [
          {
            kind: "state-subscription",
            methodName: "onProjection",
            input: { schema: ProcessManagerStateSchema, origin: "domestic" },
            outcomes: { returned: [], thrown: [] },
            parameterCount: 1,
          },
        ],
      },
    ]);
    const context = await BoundedContext.singleTenant("Tasks")
      .withGeneratedRegistryRoot(registryRoot)
      .add(GeneratedTaskProcessManager)
      .add(TaskProjection)
      .build();

    expect(internalDeliveryDescriptor(context).endpoints()).toEqual([
      {
        label: "HANDLE_COMMAND",
        targetTypeUrl: TypeUrls.derive(ProcessManagerStateSchema),
        shard: { index: 0, ofTotal: 1 },
      },
      {
        label: "UPDATE_SUBSCRIBER",
        targetTypeUrl: TypeUrls.derive(ProjectOverviewStateSchema),
        shard: { index: 0, ofTotal: 1 },
      },
    ]);

    await context.commandBus().post(createAggregateCommand("command-ready"));

    await context.commandBus().post(createAggregateCommand("command-attached", "task-attached"));
    await waitForCondition(
      async () =>
        (await context.stand().read(ProcessManagerStateSchema, "task-attached")) !== undefined,
      "shared environment delivery",
    );
  });

  it("passes custom routing when adding an Entity class with generated handlers", async () => {
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: TaskProjection,
        stateSchema: ProjectOverviewStateSchema,
        handlers: [
          {
            kind: "state-subscription",
            methodName: "onProjection",
            input: { schema: ProcessManagerStateSchema, origin: "domestic" },
            outcomes: { returned: [], thrown: [] },
            parameterCount: 1,
          },
        ],
      },
    ]);
    const eventRouting = EventRouting.create<string>().route(ReviewTaskAssignedSchema, () => [
      "custom-target",
    ]);
    await expect(
      BoundedContext.singleTenant("CustomRouting")
        .withGeneratedRegistryRoot(registryRoot)
        .add(TaskProjection, { eventRouting })
        .build(),
    ).rejects.toThrow(
      'unregistered exact route for "spine.server.testing.handlerregistry.ReviewTaskAssigned"',
    );
  });

  it("rejects generated options for an explicitly assembled repository", () => {
    const builder = BoundedContext.singleTenant("ExplicitRepository");
    const invalidAdd = builder as unknown as {
      add(entry: unknown, options: object): unknown;
    };
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectOverviewStateSchema,
    });

    expect(() => invalidAdd.add(repository, {})).toThrow(
      "Explicit Repository instances do not accept generated options.",
    );
  });

  it("matches standalone generated metadata by exact registered constructor", async () => {
    const registryRoot = createStandaloneGeneratedRegistryRoot([
      standaloneReceiver(
        StandaloneAssignee,
        "command-assignment",
        "assign",
        AssignReviewTaskSchema,
        [ReviewTaskAssignedSchema],
      ),
    ]);

    await expect(
      BoundedContext.singleTenant("StandaloneExact")
        .withGeneratedRegistryRoot(registryRoot)
        .addAssignee(new OtherStandaloneAssignee())
        .build(),
    ).rejects.toThrow(
      "Generated standalone receiver StandaloneAssignee has no explicitly registered instance",
    );
  });

  it("rejects duplicate standalone instances during generated assembly", async () => {
    const instance = new StandaloneAssignee();
    const registryRoot = createStandaloneGeneratedRegistryRoot([
      standaloneReceiver(
        StandaloneAssignee,
        "command-assignment",
        "assign",
        AssignReviewTaskSchema,
        [ReviewTaskAssignedSchema],
      ),
    ]);

    await expect(
      BoundedContext.singleTenant("StandaloneDuplicate")
        .withGeneratedRegistryRoot(registryRoot)
        .addAssignee(instance)
        .addAssignee(instance)
        .build(),
    ).rejects.toThrow("Standalone receiver StandaloneAssignee is registered more than once");
  });

  it("installs assignee and commander through their public registration paths", async () => {
    const assignee = new StandaloneAssignee();
    const commander = new StandaloneCommander();
    const registryRoot = createStandaloneGeneratedRegistryRoot([
      standaloneReceiver(
        StandaloneAssignee,
        "command-assignment",
        "assign",
        AssignReviewTaskSchema,
        [ReviewTaskAssignedSchema],
      ),
      standaloneReceiver(
        StandaloneCommander,
        "command-substitution",
        "substitute",
        ScheduleReviewTaskSchema,
        [AssignReviewTaskSchema],
      ),
    ]);
    const context = await BoundedContext.singleTenant("StandalonePaths")
      .withGeneratedRegistryRoot(registryRoot)
      .addAssignee(assignee)
      .addCommandDispatcher(commander)
      .build();

    try {
      await context.commandBus().post(createAggregateCommand("standalone-assignee"));
      await context.commandBus().post(createScheduleReviewTask("standalone-commander"));
    } finally {
      await context.close();
    }
  });

  it("rejects an assignee and commander generated for the same Command before intake", async () => {
    const registryRoot = createStandaloneGeneratedRegistryRoot([
      standaloneReceiver(
        StandaloneAssignee,
        "command-assignment",
        "assign",
        AssignReviewTaskSchema,
        [ReviewTaskAssignedSchema],
      ),
      standaloneReceiver(
        CollidingStandaloneCommander,
        "command-substitution",
        "substitute",
        AssignReviewTaskSchema,
        [AssignReviewTaskSchema],
      ),
    ]);

    await expect(
      BoundedContext.singleTenant("StandaloneMixedReceptor")
        .withGeneratedRegistryRoot(registryRoot)
        .addAssignee(new StandaloneAssignee())
        .addCommandDispatcher(new CollidingStandaloneCommander())
        .build(),
    ).rejects.toThrow("Standalone command receptors conflict");
  });

  it("installs reactor and subscriber through the public Event dispatcher path", async () => {
    const reactor = new StandaloneReactor();
    const subscriber = new StandaloneSubscriber();
    const registryRoot = createStandaloneGeneratedRegistryRoot([
      standaloneReceiver(
        StandaloneReactor,
        "event-reaction",
        "react",
        ReviewTaskAssignedSchema,
        [],
      ),
      standaloneReceiver(
        StandaloneSubscriber,
        "event-subscription",
        "subscribe",
        ReviewTaskAssignedSchema,
        [],
      ),
    ]);
    const context = await BoundedContext.singleTenant("StandaloneEvents")
      .withGeneratedRegistryRoot(registryRoot)
      .addEventDispatcher(reactor)
      .addEventDispatcher(subscriber)
      .build();
    try {
      await context.eventBus().post(createReviewTaskAssigned("standalone-event"));
      expect(reactor.calls).toBe(1);
      expect(subscriber.calls).toBe(1);
    } finally {
      await context.close();
    }
  });

  it("delivers standalone-produced Commands and Events through this context buses", async () => {
    const commands: string[] = [];
    const events: string[] = [];
    const registryRoot = createStandaloneGeneratedRegistryRoot([
      standaloneReceiver(
        StandaloneCommander,
        "command-substitution",
        "substitute",
        ScheduleReviewTaskSchema,
        [AssignReviewTaskSchema],
      ),
      standaloneReceiver(
        ProducingStandaloneReactor,
        "event-reaction",
        "react",
        ReviewTaskAssignedSchema,
        [ReviewStartedSchema],
      ),
    ]);
    const context = await BoundedContext.singleTenant("StandaloneProducedSignals")
      .withGeneratedRegistryRoot(registryRoot)
      .addCommandDispatcher(new StandaloneCommander())
      .addCommandDispatcher(
        createCommandDispatcher([AssignReviewTaskSchema], (command) => {
          commands.push(command.id?.uuid ?? "missing");
        }),
      )
      .addEventDispatcher(new ProducingStandaloneReactor())
      .addEventDispatcher(
        createEventDispatcher([ReviewStartedSchema], (event) => {
          events.push(event.id?.value ?? "missing");
        }),
      )
      .build();

    try {
      await context.commandBus().post(createScheduleReviewTask("standalone-command"));
      await context.eventBus().post(createReviewTaskAssigned("standalone-event"));
    } finally {
      await context.close();
    }

    expect(commands).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it("matches a dependency-injected standalone commander by its registered constructor", async () => {
    const names: string[] = [];
    const commander = new DependencyInjectedStandaloneCommander("dependency");
    const registryRoot = createStandaloneGeneratedRegistryRoot([
      standaloneReceiver(
        DependencyInjectedStandaloneCommander,
        "command-substitution",
        "substitute",
        ScheduleReviewTaskSchema,
        [AssignReviewTaskSchema],
      ),
    ]);
    const context = await BoundedContext.singleTenant("DependencyInjectedStandalone")
      .withGeneratedRegistryRoot(registryRoot)
      .addCommandDispatcher(commander)
      .addCommandDispatcher(
        createCommandDispatcher([AssignReviewTaskSchema], (command) => {
          if (command.message === undefined)
            throw new Error("Expected a produced AssignReviewTask payload.");
          const message = AnyPacker.tryUnpack(command.message, AssignReviewTaskSchema);
          if (message === undefined) throw new Error("Expected a produced AssignReviewTask.");
          names.push(message.name);
        }),
      )
      .build();

    try {
      await context.commandBus().post(createScheduleReviewTask("standalone-command"));
    } finally {
      await context.close();
    }

    expect(names).toEqual(["Task Ready dependency"]);
  });

  it("drains a produced Command when close starts before its bus dispatch", async () => {
    const commands: string[] = [];
    const registryRoot = createStandaloneGeneratedRegistryRoot([
      standaloneReceiver(
        StandaloneCommander,
        "command-substitution",
        "substitute",
        ScheduleReviewTaskSchema,
        [AssignReviewTaskSchema],
      ),
    ]);
    const context = await BoundedContext.singleTenant("StandaloneCloseDrain")
      .withGeneratedRegistryRoot(registryRoot)
      .addCommandDispatcher(new StandaloneCommander())
      .addCommandDispatcher(
        createCommandDispatcher([AssignReviewTaskSchema], (command) => {
          commands.push(command.id?.uuid ?? "missing");
        }),
      )
      .build();

    let closing: Promise<void> | undefined;
    const observer = boundedContextAccess.observeProducedSignals(context, {
      onCommand: () => {
        closing ??= context.close();
      },
    });
    try {
      await context.commandBus().post(createScheduleReviewTask("closing-command"));
      await closing;
    } finally {
      observer.close();
      await context.close();
    }

    expect(commands).toHaveLength(1);
  });

  it("drains an ordinary Entity Command handed off before close", async () => {
    const backend = new InMemoryStorageBackend();
    await configureStorage(new InMemoryStorageFactory(backend));
    const registryRoot = createStandaloneGeneratedRegistryRoot([
      standaloneReceiver(
        StandaloneCommander,
        "command-substitution",
        "substitute",
        ScheduleReviewTaskSchema,
        [AssignReviewTaskSchema],
      ),
      {
        receiverKind: "entity",
        receiverType: ReplayTaskAggregate,
        ...aggregateReplayRegistry(ReplayTaskAggregate),
      },
    ]);
    const build = () =>
      BoundedContext.singleTenant("OrdinaryHandoffClose")
        .withGeneratedRegistryRoot(registryRoot)
        .addCommandDispatcher(new StandaloneCommander())
        .add(ReplayTaskAggregate)
        .build();
    const first = await build();
    const durable = serverEnvironmentAccess.coreDelivery(ServerEnvironment.instance());
    const receiveStarted = Promise.withResolvers<undefined>();
    const releaseReceive = Promise.withResolvers<undefined>();
    const receive = Inbox.prototype.receive.bind(durable.inbox);
    const delayedReceive = vi
      .spyOn(Inbox.prototype, "receive")
      .mockImplementation(async (input) => {
        receiveStarted.resolve(undefined);
        await releaseReceive.promise;
        return receive(input);
      });
    let closing: Promise<void> | undefined;
    const observer = boundedContextAccess.observeProducedSignals(first, {
      onCommand: () => {
        closing ??= first.close();
      },
    });
    try {
      const posted = first.commandBus().post(createScheduleReviewTask("pending", "pending-task"));
      await receiveStarted.promise;
      expect(closing).toBeDefined();
      releaseReceive.resolve(undefined);
      await posted;
      await closing;
      const reopened = await build();
      try {
        expect((await reopened.stand().read(ProjectStateSchema, "pending-task"))?.name).toBe(
          "Task Ready",
        );
      } finally {
        await reopened.close();
      }
    } finally {
      releaseReceive.resolve(undefined);
      delayedReceive.mockRestore();
      observer.close();
      await first.close();
    }
  });

  it("contains one standalone-produced Command failure without suppressing its later sibling", async () => {
    const delivered: string[] = [];
    const unhandled: unknown[] = [];
    const registryRoot = createStandaloneGeneratedRegistryRoot([
      standaloneReceiver(
        SiblingStandaloneCommander,
        "command-substitution",
        "substitute",
        ScheduleReviewTaskSchema,
        [AssignReviewTaskSchema],
      ),
    ]);
    const context = await BoundedContext.singleTenant("StandaloneSiblingFailure")
      .withGeneratedRegistryRoot(registryRoot)
      .addCommandDispatcher(new SiblingStandaloneCommander())
      .addCommandDispatcher(
        createCommandDispatcher([AssignReviewTaskSchema], (command) => {
          const message =
            command.message === undefined
              ? undefined
              : AnyPacker.tryUnpack(command.message, AssignReviewTaskSchema);
          if (message?.id === "failing-produced-command")
            throw new Error("expected produced failure");
          delivered.push(message?.id ?? "missing");
        }),
      )
      .build();
    const observeUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", observeUnhandled);
    try {
      await context.commandBus().post(createScheduleReviewTask("sibling-source"));
      await context.close();
      await Promise.resolve();
    } finally {
      process.off("unhandledRejection", observeUnhandled);
      await context.close();
    }

    expect(delivered).toEqual(["later-produced-command"]);
    expect(unhandled).toEqual([]);
  });

  it("rejects signals returned by a standalone state subscriber", async () => {
    const runtime = new StandaloneHandlerRuntime([
      {
        group: standaloneReceiver(
          StateOutputSubscriber,
          "state-subscription",
          "subscribe",
          ProjectStateSchema,
          [],
        ) as never,
        instance: new StateOutputSubscriber(),
        publisher: {} as never,
      },
    ]);
    const dispatcher = runtime.stateDispatcher();
    if (dispatcher === undefined) throw new Error("Expected a state dispatcher.");

    await expect(
      dispatcher.dispatch(
        createEntityStateChangedEvent(
          ProjectStateSchema,
          create(ProjectStateSchema, {
            id: "state-output",
            name: "State",
            archived: false,
          }),
        ),
      ),
    ).rejects.toThrow('Standalone subscriber "subscribe" must not return signals.');
  });

  it("rejects a raw command dispatcher that collides with generated standalone metadata", async () => {
    const registryRoot = createStandaloneGeneratedRegistryRoot([
      standaloneReceiver(
        StandaloneAssignee,
        "command-assignment",
        "assign",
        AssignReviewTaskSchema,
        [ReviewTaskAssignedSchema],
      ),
    ]);
    await expect(
      BoundedContext.singleTenant("StandaloneCollision")
        .withGeneratedRegistryRoot(registryRoot)
        .addAssignee(new StandaloneAssignee())
        .addCommandDispatcher({
          messageSchemas: () => [AssignReviewTaskSchema],
          dispatch: () => Promise.resolve(),
        })
        .build(),
    ).rejects.toThrow();
  });

  it("enumerates every configured entity inbox shard from the context delivery strategy", async () => {
    const strategy = UniformAcrossAllShards.forNumber(3);
    await configureDelivery(new InMemoryStorageFactory(), strategy);
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: GeneratedTaskProcessManager,
        stateSchema: ProcessManagerStateSchema,
        handlers: [
          {
            kind: "command-assignment",
            methodName: "assignTask",
            input: { schema: AssignReviewTaskSchema, origin: "domestic" },
            outcomes: { returned: [ReviewTaskAssignedSchema], thrown: [] },
            parameterCount: 1,
          },
        ],
      },
    ]);
    const context = await BoundedContext.singleTenant("Tasks")
      .withGeneratedRegistryRoot(registryRoot)
      .add(GeneratedTaskProcessManager)
      .build();

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
    const strategy: DeliveryStrategy = {
      shardCount: 1,
      shardFor: (targetId) => {
        targetId.value.fill(0);
        return ShardIndex.single();
      },
    };
    await configureDelivery(storageFactory, strategy);
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: GeneratedTaskProcessManager,
        stateSchema: ProcessManagerStateSchema,
        handlers: [
          {
            kind: "command-assignment",
            methodName: "assignTask",
            input: { schema: AssignReviewTaskSchema, origin: "domestic" },
            outcomes: { returned: [ReviewTaskAssignedSchema], thrown: [] },
            parameterCount: 1,
          },
        ],
      },
    ]);
    const context = await BoundedContext.singleTenant("StrategyClone")
      .withGeneratedRegistryRoot(registryRoot)
      .add(GeneratedTaskProcessManager)
      .build();

    try {
      await context.commandBus().post(createAggregateCommand("strategy-clone", "original-id"));
      const rows = await ServerEnvironment.instance().delivery.inbox.read(ShardIndex.single());

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
    await configureDelivery(storageFactory, strategy);
    const registry = createGeneratedRegistryFixture([
      aggregateReplayRegistry(ReplayTaskAggregate),
      replayProcessManagerRegistry(ReplayTaskProcessManager),
    ]);
    const context = await BoundedContext.singleTenant("DescriptorReplay")
      .withGeneratedRegistryRoot(registry.root)
      .add(ReplayTaskAggregate)
      .add(ReplayTaskProcessManager)
      .build();
    try {
      const descriptor = internalDeliveryDescriptor(context);
      const aggregateType = TypeUrls.derive(ProjectStateSchema);
      const processManagerType = TypeUrls.derive(ProcessManagerStateSchema);
      const aggregateId = targetForShard(strategy, aggregateType, 1, "aggregate");
      const commandId = targetForShard(strategy, processManagerType, 2, "pm-command");
      const eventId = targetForShard(strategy, processManagerType, 1, "pm-event");
      const aggregateCommand = createAggregateCommand("aggregate-row", aggregateId);
      const processManagerCommand = createScheduleReviewTask("pm-command-row", commandId);
      const processManagerEvent = createReviewTaskAssigned("pm-event-row", eventId);

      const aggregateRow = await persistDescriptorRow({
        descriptor,
        storageFactory,
        targetTypeUrl: aggregateType,
        targetId: aggregateId,
        signalId: "aggregate-row",
        label: "HANDLE_COMMAND",
        signal: AnyPacker.pack(CommandSchema, aggregateCommand),
        shard: strategy.shardFor(Identifiers.pack("string", aggregateId), aggregateType),
      });
      const processManagerCommandRow = await persistDescriptorRow({
        descriptor,
        storageFactory,
        targetTypeUrl: processManagerType,
        targetId: commandId,
        signalId: "pm-command-row",
        label: "HANDLE_COMMAND",
        signal: AnyPacker.pack(CommandSchema, processManagerCommand),
        shard: strategy.shardFor(Identifiers.pack("string", commandId), processManagerType),
      });
      const processManagerEventRow = await persistDescriptorRow({
        descriptor,
        storageFactory,
        targetTypeUrl: processManagerType,
        targetId: eventId,
        signalId: "pm-event-row",
        label: "REACT_UPON_EVENT",
        signal: AnyPacker.pack(EventSchema, processManagerEvent),
        shard: strategy.shardFor(Identifiers.pack("string", eventId), processManagerType),
      });

      await descriptor.replay(aggregateRow);
      await descriptor.replay(processManagerCommandRow);
      await descriptor.replay(processManagerEventRow);

      await expect(context.stand().read(ProjectStateSchema, aggregateId)).resolves.toMatchObject({
        id: aggregateId,
        name: "Task Ready",
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
    await configureDelivery(storageFactory, strategy);
    const registry = createGeneratedRegistryFixture([
      aggregateReplayRegistry(ReplayTaskAggregate),
      replayProcessManagerRegistry(ReplayTaskProcessManager),
    ]);
    const context = await BoundedContext.singleTenant("ForgedDescriptorShard")
      .withGeneratedRegistryRoot(registry.root)
      .add(ReplayTaskAggregate)
      .add(ReplayTaskProcessManager)
      .build();

    try {
      const descriptor = internalDeliveryDescriptor(context);
      const aggregateType = TypeUrls.derive(ProjectStateSchema);
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
        signal: AnyPacker.pack(
          CommandSchema,
          createProjectionCommand("forged-aggregate", aggregateId),
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
        signal: AnyPacker.pack(
          CommandSchema,
          createScheduleReviewTask("forged-pm", processManagerId),
        ),
        shard: new ShardIndex(0, 3),
      });

      await expect(descriptor.replay(aggregateRow)).rejects.toThrow(
        "Entity Inbox replay stored shard does not match the routed target.",
      );
      await expect(descriptor.replay(processManagerRow)).rejects.toThrow(
        "Entity Inbox replay stored shard does not match the routed target.",
      );
      await expect(context.stand().read(ProjectStateSchema, aggregateId)).resolves.toBeUndefined();
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
    await configureDelivery(storageFactory, strategy);
    const contextName = "FreshMultiShardDescriptor";
    const registry = createGeneratedRegistryFixture([
      replayProcessManagerRegistry(ReplayTaskProcessManager),
    ]);
    let first: BoundedContext | undefined;
    let recovered: BoundedContext | undefined;

    try {
      first = await BoundedContext.singleTenant(contextName)
        .withGeneratedRegistryRoot(registry.root)
        .add(ReplayTaskProcessManager)
        .build();
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
              ? AnyPacker.pack(CommandSchema, createScheduleReviewTask(signalId, targetId))
              : AnyPacker.pack(EventSchema, createReviewTaskAssigned(signalId, targetId));
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
        .withGeneratedRegistryRoot(registry.root)
        .add(ReplayTaskProcessManager)
        .build();
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
      {
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
            serverEnvironmentAccess
              .coreDelivery(ServerEnvironment.instance())
              .inbox.readMessage(row.id),
          ).resolves.toBeUndefined();
        }
      }
    } finally {
      await first?.close();
      await recovered?.close();
      removeGeneratedRegistry(registry);
    }
  });

  it("retains a dynamic-tenant row after an Inbox read fault for fresh-runtime recovery", async () => {
    const storageFactory = new FailingInboxReadStorageFactory();
    await configureDelivery(storageFactory, UniformAcrossAllShards.singleShard());
    const selectedIndex = TenantIndexes.fromFactory(storageFactory);
    const tenantId = tenant("tenant-first-row");
    const contextName = "FreshRecoveryTasks";
    const firstRegistry = createGeneratedRegistryFixture([
      processManagerRegistry(FreshRecoveryProcessManager),
    ]);
    const recoveryRegistry = createGeneratedRegistryFixture([
      processManagerRegistry(FreshRecoveryProcessManager),
    ]);
    let first: BoundedContext | undefined;
    let recovered: BoundedContext | undefined;

    try {
      await selectedIndex.keep(tenantId);
      first = await BoundedContext.multitenant(contextName)
        .withTenantIndex(selectedIndex)
        .withGeneratedRegistryRoot(firstRegistry.root)
        .add(FreshRecoveryProcessManager)
        .addEventDispatcher(createEventDispatcher([ReviewTaskAssignedSchema], () => undefined))
        .build();

      storageFactory.failInboxQueries();
      await expect(
        first
          .commandBus()
          .post(createAggregateCommand("dynamic-command", "dynamic-task", "tenant-first-row")),
      ).rejects.toBe(inboxReadFailure);
      storageFactory.allowInboxQueries();
      const durable = serverEnvironmentAccess.coreDelivery(ServerEnvironment.instance());
      const pending = await durable.inbox.read(ShardIndex.single(), {
        statuses: ["TO_DELIVER"],
      });
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        inboxId: { targetId: Identifiers.pack("string", "dynamic-task") },
        signalId: "dynamic-command",
        version: 1n,
      });
      await expect(
        first.stand().read(ProcessManagerStateSchema, "dynamic-task", { tenantId }),
      ).resolves.toBeUndefined();
      await first.close();
      first = undefined;

      recovered = await BoundedContext.multitenant(contextName)
        .withTenantIndex(selectedIndex)
        .withGeneratedRegistryRoot(recoveryRegistry.root)
        .add(FreshRecoveryProcessManager)
        .addEventDispatcher(createEventDispatcher([ReviewTaskAssignedSchema], () => undefined))
        .build();
      await waitForCondition(
        async () =>
          (await recovered
            ?.stand()
            .read(ProcessManagerStateSchema, "dynamic-task", { tenantId })) !== undefined,
        "fresh dynamic-tenant recovery",
      );
      await expect(
        recovered.stand().read(ProcessManagerStateSchema, "dynamic-task", { tenantId }),
      ).resolves.toMatchObject({ queue: "Task Ready recovered" });
      await expect(
        durable.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
      ).resolves.toHaveLength(1);
    } finally {
      await first?.close();
      await recovered?.close();
      removeGeneratedRegistry(firstRegistry);
      removeGeneratedRegistry(recoveryRegistry);
    }
  });

  it("rejects blank multitenant index entries", async () => {
    const context = await BoundedContext.multitenant("Customers").build();
    const tenantIndex = internalTenantIndex(context);

    await expect(tenantIndex.keep(tenant(" \t "))).rejects.toThrow(/non-empty/);
  });

  it("keeps tenant discovery in the factory catalog without a TenantId record family", async () => {
    const storageFactory = new ObservingStorageFactory([]);
    await configureStorage(storageFactory);
    const customers = await BoundedContext.multitenant("Customers")
      .withTenantIndex(TenantIndexes.fromFactory(storageFactory))
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

  it("exposes stable commandBus() and eventBus() endpoints from the built context", async () => {
    const context = await BoundedContext.singleTenant("Tasks").build();

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
      schema: ProjectOverviewStateSchema,
    });
    const context = await BoundedContext.singleTenant("Tasks").add(repository).build();
    const stand = context.stand();

    expect(stand).toBe(context.stand());
    expect(stand.stateTypes()).toEqual([TypeUrls.derive(ProjectOverviewStateSchema)]);

    await stand.update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, {
        id: "task-1",
        name: "Task",
        priority: 1,
      }),
    );

    await expect(stand.read(ProjectOverviewStateSchema, "task-1")).resolves.toMatchObject({
      id: "task-1",
      name: "Task",
      priority: 1,
    });
  });

  it("registers command dispatchers added to the builder", async () => {
    const observed: string[] = [];
    const dispatcher = createCommandDispatcher([AssignReviewTaskSchema], (command) => {
      observed.push(command.id?.uuid ?? "missing");
    });
    const context = await BoundedContext.singleTenant("Tasks")
      .addCommandDispatcher(dispatcher)
      .build();

    await context.commandBus().post(createProjectionCommand("command-1"));

    expect(observed).toEqual(["command-1"]);
  });

  it("checks the live receiving tenant before direct command or event dispatch", async () => {
    const index = TenantIndexes.fromFactory({} as StorageFactory);
    const commands: string[] = [];
    const events: string[] = [];
    const context = await BoundedContext.multitenant("Tasks")
      .withTenantIndex(index)
      .addCommandDispatcher(
        createCommandDispatcher([AssignReviewTaskSchema], (command) => {
          commands.push(command.id?.uuid ?? "missing");
        }),
      )
      .addEventDispatcher(
        createEventDispatcher([ReviewTaskAssignedSchema], (event) => {
          events.push(event.id?.value ?? "missing");
        }),
      )
      .build();

    await expect(
      context.commandBus().post(createAggregateCommand("unknown", "task-1", "a")),
    ).rejects.toMatchObject({ type: "TENANT_UNKNOWN" });
    await expect(
      context.eventBus().post(createProjectionEvent("unknown", "task-1", tenant("a"))),
    ).rejects.toMatchObject({ type: "TENANT_UNKNOWN" });
    expect(commands).toEqual([]);
    expect(events).toEqual([]);
    context.stand().register(ProjectOverviewStateSchema);
    await expect(
      context.stand().read(ProjectOverviewStateSchema, "task-1", { tenantId: tenant("a") }),
    ).rejects.toMatchObject({ type: "TENANT_UNKNOWN" });
    await expect(
      context.stand().queryVersioned(ProjectOverviewStateSchema, {}, { tenantId: tenant("a") }),
    ).rejects.toMatchObject({ type: "TENANT_UNKNOWN" });
    const lookupFailure = new Error("tenant directory unavailable");
    vi.spyOn(index, "contains").mockRejectedValueOnce(lookupFailure);
    await expect(
      context.commandBus().post(createAggregateCommand("failed-lookup", "task-1", "a")),
    ).rejects.toBe(lookupFailure);
    await index.keep(tenant("a"));
    await context.commandBus().post(createAggregateCommand("known", "task-1", "a"));
    await context.eventBus().post(createProjectionEvent("known", "task-1", tenant("a")));
    expect(commands).toEqual(["known"]);
    expect(events).toEqual(["known"]);
    await expect(
      context.stand().read(ProjectOverviewStateSchema, "task-1", { tenantId: tenant("a") }),
    ).resolves.toBeUndefined();
  });

  it("does not consult a configured company index for single-tenant work", async () => {
    const index = TenantIndexes.fromFactory({} as StorageFactory);
    const lookup = vi.spyOn(index, "contains").mockRejectedValue(new Error("unexpected lookup"));
    const observed: string[] = [];
    const context = await BoundedContext.singleTenant("Tasks")
      .withTenantIndex(index)
      .addCommandDispatcher(
        createCommandDispatcher([AssignReviewTaskSchema], (command) => {
          observed.push(command.id?.uuid ?? "missing");
        }),
      )
      .build();

    await context.commandBus().post(createAggregateCommand("single", "task-1"));
    expect(observed).toEqual(["single"]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("does not register command dispatchers removed before build", async () => {
    const dispatcher = createCommandDispatcher([AssignReviewTaskSchema], () => undefined);
    const context = await BoundedContext.singleTenant("Tasks")
      .addCommandDispatcher(dispatcher)
      .removeCommandDispatcher(dispatcher)
      .build();

    await expect(context.commandBus().post(createProjectionCommand("command-2"))).rejects.toThrow(
      `No command dispatcher registered for "${TypeUrls.derive(AssignReviewTaskSchema)}".`,
    );
  });

  it("registers event dispatchers added to the builder", async () => {
    const observed: string[] = [];
    const dispatcher = createEventDispatcher([ReviewTaskAssignedSchema], (event) => {
      observed.push(event.id?.value ?? "missing");
    });
    const context = await BoundedContext.singleTenant("Tasks")
      .addEventDispatcher(dispatcher)
      .build();

    await context.eventBus().post(createProjectionEvent("event-1"));

    expect(observed).toEqual(["event-1"]);
  });

  it("does not expose internal event types accepted by framework dispatchers", async () => {
    const dispatcher = createEventDispatcher(
      [EventSchema, ReviewTaskAssignedSchema],
      () => undefined,
    );
    const context = await BoundedContext.singleTenant("Tasks")
      .addEventDispatcher(dispatcher)
      .build();

    expect(context.eventBus().acceptedEventTypes()).toEqual([
      TypeUrls.derive(ReviewTaskAssignedSchema),
    ]);
  });

  it("rejects package-local event subscriptions for non-context values", () => {
    expect(() =>
      boundedContextAccess.subscribeToEvent(
        {} as BoundedContext,
        TypeUrls.derive(ReviewTaskAssignedSchema),
        { onEvent: () => undefined },
      ),
    ).toThrow("Event subscription requires a built BoundedContext instance.");
  });

  it("rejects events whose only dispatcher was removed before build", async () => {
    const observed: string[] = [];
    const dispatcher = createEventDispatcher([ReviewTaskAssignedSchema], (event) => {
      observed.push(event.id?.value ?? "missing");
    });
    const context = await BoundedContext.singleTenant("Tasks")
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
    await configureStorage(storageFactory);
    const dispatcher = createEventDispatcher([ReviewTaskAssignedSchema], (event) => {
      observed.push(`dispatch:${event.id?.value ?? "missing"}`);
    });
    const context = await BoundedContext.singleTenant("Tasks")
      .addEventDispatcher(dispatcher)
      .build();

    await context.eventBus().post(createProjectionEvent("event-3"));

    expect(observed).toEqual(["store:event-3", "dispatch:event-3"]);
  });

  it("rejects event dispatcher classification before acquiring event storage", async () => {
    const storageFactory = new ObservingStorageFactory([]);
    await configureStorage(storageFactory);
    const dispatcher = createEventDispatcher([ReviewTaskAssignedSchema], () => undefined);
    const brokenDispatcher = {
      messageSchemas: () => {
        throw new Error("Cannot read event schemas.");
      },
      dispatch: (event: Event): Promise<void> => Promise.resolve(void event),
    } satisfies EventDispatcher;

    await expect(
      BoundedContext.singleTenant("Tasks")
        .addEventDispatcher(dispatcher)
        .addEventDispatcher(brokenDispatcher)
        .build(),
    ).rejects.toThrow("Cannot read event schemas.");

    expect(storageFactory.storages).toHaveLength(0);
  });

  it("does not acquire an event store before dispatcher classification fails", async () => {
    const storageFactory = new ObservingStorageFactory([], [1]);
    await configureStorage(storageFactory);
    const brokenDispatcher = {
      messageSchemas: () => {
        throw new Error("Cannot read event schemas.");
      },
      dispatch: (event: Event): Promise<void> => Promise.resolve(void event),
    } satisfies EventDispatcher;

    let thrown: unknown;
    try {
      await BoundedContext.singleTenant("Tasks").addEventDispatcher(brokenDispatcher).build();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ message: "Cannot read event schemas." });
    expect(storageFactory.storages).toHaveLength(0);
  });

  it("registers repositories added to the builder with the built context", async () => {
    const storageFactory = new ObservingStorageFactory([]);
    await configureStorage(storageFactory);
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: ProjectStateSchema,
    });
    const context = await BoundedContext.singleTenant("Tasks").add(repository).build();

    const firstRepositories = context.registeredRepositories();
    const secondRepositories = context.registeredRepositories();

    expectTypeOf(firstRepositories).toEqualTypeOf<readonly RepositoryView[]>();
    expect(firstRepositories).toHaveLength(1);
    expect(firstRepositories[0]).not.toBe(repository);
    expect(firstRepositories[0]?.entityType).toBe(TaskAggregate);
    expect(firstRepositories[0]?.stateFullTypeName).toBe(ProjectStateSchema.typeName);
    expect(secondRepositories).toEqual(firstRepositories);
    expect(secondRepositories).not.toBe(firstRepositories);
    expect(secondRepositories[0]).not.toBe(firstRepositories[0]);
    expect(storageFactory.creationsFor(ProjectStateSchema.typeName)).toHaveLength(0);
  });

  it("builds generated repositories from entity classes with build", async () => {
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: GeneratedTaskAggregate,
        stateSchema: ProjectStateSchema,
        handlers: [
          {
            kind: "command-assignment",
            methodName: "assignProjection",
            input: { schema: AssignReviewTaskSchema, origin: "domestic" },
            outcomes: { returned: [ReviewTaskAssignedSchema], thrown: [] },
            parameterCount: 1,
          },
        ],
      },
      {
        entityType: TaskProjection,
        stateSchema: ProjectOverviewStateSchema,
        handlers: [
          {
            kind: "state-subscription",
            methodName: "onProjection",
            input: { schema: ProjectStateSchema, origin: "domestic" },
            outcomes: { returned: [], thrown: [] },
            parameterCount: 1,
          },
        ],
      },
    ]);
    const context = await BoundedContext.singleTenant("Tasks")
      .withGeneratedRegistryRoot(registryRoot)
      .add(GeneratedTaskAggregate)
      .add(TaskProjection)
      .build();

    expect(context.registeredRepositories().map((repository) => repository.entityType)).toEqual([
      GeneratedTaskAggregate,
      TaskProjection,
    ]);
    expect(context.commandBus().acceptedCommandTypes()).toEqual([
      TypeUrls.derive(AssignReviewTaskSchema),
    ]);

    await expect(context.commandBus().post(createAggregateCommand("command-4"))).resolves.toBe(
      undefined,
    );
  });

  it("executes a generated process-manager repository assembled through build", async () => {
    const observed: Event[] = [];
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: GeneratedTaskProcessManager,
        stateSchema: ProcessManagerStateSchema,
        handlers: [
          {
            kind: "command-assignment",
            methodName: "assignTask",
            input: { schema: AssignReviewTaskSchema, origin: "domestic" },
            outcomes: { returned: [ReviewTaskAssignedSchema], thrown: [] },
            parameterCount: 1,
          },
        ],
      },
    ]);
    const context = await BoundedContext.singleTenant("Tasks")
      .withGeneratedRegistryRoot(registryRoot)
      .add(GeneratedTaskProcessManager)
      .addEventDispatcher(
        createEventDispatcher([ReviewTaskAssignedSchema], (event) => {
          observed.push(event);
        }),
      )
      .build();

    await expect(
      context.commandBus().post(
        SignalEnvelopes.command({
          context: create(CommandContextSchema, {
            actorContext: create(ActorContextSchema, {
              actor: create(UserIdSchema, { value: "user-1" }),
            }),
          }),
          schema: AssignReviewTaskSchema,
          message: create(AssignReviewTaskSchema, {
            id: "generated-pm",
            name: "Generated PM",
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
    expect(observed[0]?.id?.value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(observed[0]?.id?.value).not.toBe("command-generated-pm-1");
    const message = observed[0]?.message;
    if (message === undefined) {
      throw new Error("Expected a generated process-manager produced event.");
    }
    expect(message.typeUrl).toBe(TypeUrls.derive(ReviewTaskAssignedSchema));
  });

  it("advertises producer-only event schemas without creating external routes", async () => {
    const storageFactory = new InMemoryStorageFactory();
    await configureStorage(storageFactory);
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: GeneratedTaskProcessManager,
        stateSchema: ProcessManagerStateSchema,
        handlers: [
          {
            kind: "command-assignment",
            methodName: "assignTask",
            input: { schema: AssignReviewTaskSchema, origin: "domestic" },
            outcomes: { returned: [ReviewTaskAssignedSchema], thrown: [] },
            parameterCount: 1,
          },
        ],
      },
    ]);
    const context = await BoundedContext.singleTenant("Tasks")
      .withGeneratedRegistryRoot(registryRoot)
      .add(GeneratedTaskProcessManager)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, storageFactory);

    expect(context.eventBus().acceptedEventTypes()).toEqual([
      TypeUrls.derive(ReviewTaskAssignedSchema),
    ]);

    await context.commandBus().post(
      SignalEnvelopes.command({
        context: create(CommandContextSchema, {
          actorContext: create(ActorContextSchema, {
            actor: create(UserIdSchema, { value: "user-1" }),
          }),
        }),
        schema: AssignReviewTaskSchema,
        message: create(AssignReviewTaskSchema, {
          id: "producer-only",
          name: "Producer only",
        }),
      }),
    );

    await waitForCondition(
      async () => (await eventStore.read()).length === 1,
      "producer-only event",
    );
    await expect(eventStore.read()).resolves.toMatchObject([
      { message: { typeUrl: TypeUrls.derive(ReviewTaskAssignedSchema) } },
    ]);
  });

  it("requires an explicit generated registry root for entity-class assembly", async () => {
    await expect(
      BoundedContext.singleTenant("Tasks").add(GeneratedTaskAggregate).build(),
    ).rejects.toThrow("requires withGeneratedRegistryRoot(root)");
  });

  it("accepts generated registry roots passed as file URL strings", async () => {
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: GeneratedTaskAggregate,
        stateSchema: ProjectStateSchema,
        handlers: [],
      },
    ]);

    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot(registryRoot.href)
        .add(GeneratedTaskAggregate)
        .build(),
    ).resolves.toBeInstanceOf(BoundedContext);
  });

  it("discovers receiver-only generated registries", async () => {
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: GeneratedTaskAggregate,
        stateSchema: ProjectStateSchema,
        handlers: [],
      },
    ]);

    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot(registryRoot)
        .add(GeneratedTaskAggregate)
        .build(),
    ).resolves.toBeInstanceOf(BoundedContext);
  });

  it("rejects malformed generated registry root URLs", async () => {
    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot("file://%")
        .add(GeneratedTaskAggregate)
        .build(),
    ).rejects.toThrow('Generated registry root "file://%" is not a valid URL.');
  });

  it("rejects generated registry roots outside file URLs", async () => {
    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot("https://example.com/generated")
        .add(GeneratedTaskAggregate)
        .build(),
    ).rejects.toThrow("must use the file: URL scheme");
  });

  it("rejects generated registry root URL aliases with query or hash", async () => {
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: GeneratedTaskAggregate,
        stateSchema: ProjectStateSchema,
        handlers: [],
      },
    ]);
    const aliasedRoot = new URL(registryRoot.href);

    aliasedRoot.search = "cache=1";

    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot(aliasedRoot)
        .add(GeneratedTaskAggregate)
        .build(),
    ).rejects.toThrow("must not include a query or hash");

    aliasedRoot.search = "";
    aliasedRoot.hash = "generated";

    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot(aliasedRoot)
        .add(GeneratedTaskAggregate)
        .build(),
    ).rejects.toThrow("must not include a query or hash");
  });

  it("rejects generated registry modules that resolve outside the trusted root", async () => {
    const fixture = createGeneratedRegistryFixture([
      {
        entityType: GeneratedTaskAggregate,
        stateSchema: ProjectStateSchema,
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
        .build(),
    ).rejects.toThrow("must resolve within the configured generated registry root");
  });

  it("checks the generated registry file before each import instead of using a stale module cache", async () => {
    const fixture = createGeneratedRegistryFixture([
      {
        entityType: GeneratedTaskAggregate,
        stateSchema: ProjectStateSchema,
        handlers: [],
      },
    ]);

    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot(fixture.root)
        .add(GeneratedTaskAggregate)
        .build(),
    ).resolves.toBeInstanceOf(BoundedContext);

    rmSync(fixture.registryPath);

    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot(fixture.root)
        .add(GeneratedTaskAggregate)
        .build(),
    ).rejects.toThrow("must exist and be readable");
  });

  it("retries a failed generated registry import from the same root and dispatches its Command", async () => {
    const registry = createGeneratedRegistryFixture([aggregateReplayRegistry(ReplayTaskAggregate)]);
    const original = readFileSync(registry.registryPath, "utf8");
    writeFileSync(registry.registryPath, 'throw new Error("temporary registry import failure");\n');
    const loader = vi.spyOn(GeneratedRegistryDiscovery.prototype, "load");
    let context: BoundedContext | undefined;
    try {
      await expect(
        BoundedContext.singleTenant("RegistryRetry")
          .withGeneratedRegistryRoot(registry.root)
          .add(ReplayTaskAggregate)
          .build(),
      ).rejects.toMatchObject({
        code: "MODULE_IMPORT_FAILED",
      });
      expect(serverEnvironmentAccess.openContexts(ServerEnvironment.instance())).toEqual([]);
      writeFileSync(registry.registryPath, original);
      context = await BoundedContext.singleTenant("RegistryRetry")
        .withGeneratedRegistryRoot(registry.root)
        .add(ReplayTaskAggregate)
        .build();
      expect(loader.mock.calls.at(-1)?.[0].cacheBust).toBe("retry-1");
      await context.commandBus().post(createAggregateCommand("registry-retry", "recovered-task"));
      await expect(
        context.stand().read(ProjectStateSchema, "recovered-task"),
      ).resolves.toMatchObject({
        name: "Task Ready",
      });
    } finally {
      await context?.close();
      loader.mockRestore();
      removeGeneratedRegistry(registry);
    }
  });

  it("fails clearly when generated metadata is missing for an entity class", async () => {
    const registryRoot = createGeneratedRegistryRoot([]);

    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot(registryRoot)
        .add(GeneratedTaskAggregate)
        .build(),
    ).rejects.toThrow("Generated handler registry is missing metadata for GeneratedTaskAggregate.");
  });

  it("does not register repositories removed before build", async () => {
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: ProjectStateSchema,
    });
    const context = await BoundedContext.singleTenant("Tasks")
      .add(repository)
      .remove(repository)
      .build();

    expect(context.registeredRepositories()).toEqual([]);
  });

  it("keeps repeated add of the same repository idempotent for one built context", async () => {
    const storageFactory = new ObservingStorageFactory([]);
    await configureStorage(storageFactory);
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: ProjectStateSchema,
    });
    const context = await BoundedContext.singleTenant("Tasks")
      .add(repository)
      .add(repository)
      .build();

    const repositories = context.registeredRepositories();
    expect(repositories).toHaveLength(1);
    expect(repositories[0]?.stateFullTypeName).toBe(ProjectStateSchema.typeName);
    expect(storageFactory.creationsFor(ProjectStateSchema.typeName)).toHaveLength(0);
  });

  it("rejects registering one repository instance with two built contexts", async () => {
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: ProjectStateSchema,
    });

    await BoundedContext.singleTenant("Tasks").add(repository).build();

    await expect(BoundedContext.singleTenant("Customers").add(repository).build()).rejects.toThrow(
      "already registered with Bounded Context",
    );
  });

  it("rejects the same Entity state in distinct open contexts even with equal names", async () => {
    const first = await BoundedContext.singleTenant("Tasks")
      .add(new Repository({ entityType: TaskAggregate, schema: ProjectStateSchema }))
      .build();
    const environment = ServerEnvironment.instance();
    const stateType = TypeUrls.derive(ProjectStateSchema);
    expect(serverEnvironmentAccess.contextsServing(environment, stateType)).toEqual(["Tasks"]);
    try {
      await expect(
        BoundedContext.singleTenant("Tasks")
          .add(new Repository({ entityType: DuplicateTaskAggregate, schema: ProjectStateSchema }))
          .build(),
      ).rejects.toThrow(DuplicateEntityStateException);
    } finally {
      await first.close();
    }
    expect(serverEnvironmentAccess.contextsServing(environment, stateType)).toEqual([]);
    const next = await BoundedContext.singleTenant("Tasks")
      .add(new Repository({ entityType: DuplicateTaskAggregate, schema: ProjectStateSchema }))
      .build();
    await next.close();
  });

  it("holds the state reservation until asynchronous context cleanup settles", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const registry = new ObservingSubscriptionRegistry();
    const closeRegistry = registry.close.bind(registry);
    vi.spyOn(registry, "close").mockImplementation(async () => {
      entered.resolve(undefined);
      await release.promise;
      await closeRegistry();
    });
    const first = await BoundedContext.singleTenant("First")
      .withSubscriptionRegistry(registry)
      .add(new Repository({ entityType: TaskAggregate, schema: ProjectStateSchema }))
      .build();
    const closing = first.close();
    await entered.promise;
    await expect(
      BoundedContext.singleTenant("Second")
        .add(new Repository({ entityType: DuplicateTaskAggregate, schema: ProjectStateSchema }))
        .build(),
    ).rejects.toThrow(DuplicateEntityStateException);
    release.resolve(undefined);
    await closing;
    const next = await BoundedContext.singleTenant("Second")
      .add(new Repository({ entityType: DuplicateTaskAggregate, schema: ProjectStateSchema }))
      .build();
    await next.close();
  });

  it("awaits the first subscription pass before eager build completes", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const registry = new InMemorySubscriptionRegistry();
    vi.spyOn(registry, "snapshot").mockImplementation(async () => {
      entered.resolve(undefined);
      await release.promise;
      return [];
    });
    const building = BoundedContext.singleTenant("EagerMonitor")
      .withSubscriptionRegistry(registry)
      .build();
    try {
      await entered.promise;
      let settled = false;
      void building.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
    } finally {
      release.resolve(undefined);
      await (await building).close();
    }
  });

  it("defers the initial subscription pass when both build flags are false", async () => {
    const registry = new ObservingSubscriptionRegistry();
    const context = await BoundedContext.singleTenant("LazyMonitor")
      .withSubscriptionRegistry(registry)
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    try {
      expect(registry.snapshotCalls).toBe(0);
    } finally {
      await context.close();
    }
  });

  it("prepares a lazy model before its first valid Stand read", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const preparation = StoragePreparations.for(factory);
    const prepareEntity = vi.spyOn(preparation, "prepareEntity");
    const context = await BoundedContext.singleTenant("LazyRead")
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    try {
      expect(prepareEntity).not.toHaveBeenCalled();
      await expect(
        context.stand().read(ProjectOverviewStateSchema, "task-1"),
      ).resolves.toBeUndefined();
      expect(prepareEntity).toHaveBeenCalledOnce();
    } finally {
      await context.close();
    }
  });

  it("uses an explicit compatibility check as readiness without starting monitoring", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const preparation = StoragePreparations.for(factory);
    const prepareEntity = vi.spyOn(preparation, "prepareEntity");
    const registry = new ObservingSubscriptionRegistry();
    const context = await BoundedContext.singleTenant("CheckedBeforeInput")
      .withSubscriptionRegistry(registry)
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    try {
      await context.runtime.checkStructureCompatibility();
      expect(prepareEntity).toHaveBeenCalledOnce();
      expect(prepareEntity.mock.calls[0]?.[1]).toBe("check");
      expect(registry.snapshotCalls).toBe(0);
      await context.stand().read(ProjectOverviewStateSchema, "checked-task");
      expect(registry.snapshotCalls).toBe(1);
    } finally {
      await context.close();
    }
  });

  it("validates every explicit tenant before preparing any context structure", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const index = TenantIndexes.fromFactory(factory);
    await index.keep(tenant("known"));
    const prepareEntity = vi.spyOn(StoragePreparations.for(factory), "prepareEntity");
    const context = await BoundedContext.multitenant("ExplicitTenantValidation")
      .withTenantIndex(index)
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    try {
      await expect(
        context.runtime.createStorageStructures(tenant("known"), tenant("unknown")),
      ).rejects.toThrow("not registered");
      expect(prepareEntity).not.toHaveBeenCalled();
      await context.runtime.createStorageStructures(tenant("known"));
      expect(prepareEntity).toHaveBeenCalledOnce();
    } finally {
      await context.close();
    }
  });

  it("rejects environment preparation without a completed context", async () => {
    const environment = ServerEnvironment.instance();
    await expect(environment.createStorageStructures()).rejects.toThrow(
      "no completed Bounded Context",
    );
    await expect(environment.checkStructureCompatibility()).rejects.toThrow(
      "no completed Bounded Context",
    );
    const context = await BoundedContext.singleTenant("NowCompleted")
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    try {
      await environment.checkStructureCompatibility();
      await context.stand().read(ProjectOverviewStateSchema, "prepared-after-build");
    } finally {
      await context.close();
    }
  });

  it("validates every environment tenant before preparing matching override contexts", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const firstIndex = TenantIndexes.fromFactory({} as StorageFactory);
    const secondIndex = TenantIndexes.fromFactory({} as StorageFactory);
    await firstIndex.keep(tenant("first"));
    await secondIndex.keep(tenant("second"));
    const prepareEntity = vi.spyOn(StoragePreparations.for(factory), "prepareEntity");
    const first = await BoundedContext.multitenant("FirstOverride")
      .withTenantIndex(firstIndex)
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    const second = await BoundedContext.multitenant("SecondOverride")
      .withTenantIndex(secondIndex)
      .add(new Repository({ entityType: TaskAggregate, schema: ProjectStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    const environment = ServerEnvironment.instance();
    try {
      await expect(
        environment.createStorageStructures(tenant("first"), tenant("missing")),
      ).rejects.toThrow("not registered");
      expect(prepareEntity).not.toHaveBeenCalled();
      await environment.checkStructureCompatibility(tenant("first"));
      expect(
        prepareEntity.mock.calls.map(([input, mode]) => ({
          context: input.context.name,
          tenantId: input.context.tenantId,
          mode,
        })),
      ).toEqual([{ context: "FirstOverride", tenantId: tenant("first"), mode: "check" }]);
      prepareEntity.mockClear();
      const supplied = tenant("first");
      const checking = environment.checkStructureCompatibility(supplied, tenant("second"));
      supplied.kind = { case: "value", value: "mutated" };
      await checking;
      expect(
        prepareEntity.mock.calls.map(([input, mode]) => ({
          context: input.context.name,
          tenantId: input.context.tenantId,
          mode,
        })),
      ).toEqual([
        { context: "FirstOverride", tenantId: tenant("first"), mode: "check" },
        { context: "SecondOverride", tenantId: tenant("second"), mode: "check" },
      ]);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("joins a pending read-only check without escalating it to creation", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const preparation = StoragePreparations.for(factory);
    const original = preparation.prepareEntity.bind(preparation);
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const prepareEntity = vi
      .spyOn(preparation, "prepareEntity")
      .mockImplementation(async (input, mode) => {
        entered.resolve(undefined);
        await release.promise;
        await original(input, mode);
      });
    const context = await BoundedContext.singleTenant("JoinedExplicitCheck")
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    const checking = context.runtime.checkStructureCompatibility();
    await entered.promise;
    const creating = context.runtime.createStorageStructures();
    try {
      expect(prepareEntity).toHaveBeenCalledOnce();
      expect(prepareEntity.mock.calls[0]?.[1]).toBe("check");
      release.resolve(undefined);
      await Promise.all([checking, creating]);
      expect(prepareEntity).toHaveBeenCalledOnce();
    } finally {
      release.resolve(undefined);
      await context.close();
    }
  });

  it("drains an admitted explicit check before context close releases storage", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const preparation = StoragePreparations.for(factory);
    const original = preparation.prepareEntity.bind(preparation);
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    vi.spyOn(preparation, "prepareEntity").mockImplementation(async (input, mode) => {
      entered.resolve(undefined);
      await release.promise;
      await original(input, mode);
    });
    const context = await BoundedContext.singleTenant("HeldExplicitCheck")
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    const checking = context.runtime.checkStructureCompatibility();
    await entered.promise;
    const closing = context.close();
    try {
      await expect(context.runtime.createStorageStructures()).rejects.toThrow("closing");
      release.resolve(undefined);
      await checking;
      await closing;
    } finally {
      release.resolve(undefined);
      await Promise.allSettled([checking, closing]);
    }
  });

  it("captures explicit tenant identity before caller mutation", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const index = TenantIndexes.fromFactory(factory);
    await index.keep(tenant("captured"));
    const context = await BoundedContext.multitenant("CapturedExplicitTenant")
      .withTenantIndex(index)
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    const supplied = tenant("captured");
    try {
      const preparing = context.runtime.checkStructureCompatibility(supplied);
      supplied.kind = { case: "value", value: "mutated" };
      await preparing;
      await expect(index.contains(tenant("mutated"))).resolves.toBe(false);
    } finally {
      await context.close();
    }
  });

  it("returns a rejected promise for a malformed explicit tenant", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const index = TenantIndexes.fromFactory(factory);
    await index.keep(tenant("valid"));
    const prepareEntity = vi.spyOn(StoragePreparations.for(factory), "prepareEntity");
    const context = await BoundedContext.multitenant("MalformedExplicitTenant")
      .withTenantIndex(index)
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    try {
      const invalid = tenant("");
      let operation = Promise.resolve();
      expect(() => {
        operation = context.runtime.checkStructureCompatibility(invalid);
      }).not.toThrow();
      await expect(Promise.all([operation])).rejects.toThrow("non-empty");
      expect(prepareEntity).not.toHaveBeenCalled();
      await expect(index.contains(invalid)).rejects.toThrow("non-empty");
      await context.runtime.checkStructureCompatibility(tenant("valid"));
      expect(prepareEntity).toHaveBeenCalledOnce();
    } finally {
      await context.close();
    }
  });

  it("rechecks selected tenant membership after shared preparation waits", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const index = TenantIndexes.fromFactory(factory);
    await index.keep(tenant("departing"));
    const contains = index.contains.bind(index);
    let present = true;
    vi.spyOn(index, "contains").mockImplementation(async (id) => present && contains(id));
    const preparation = StoragePreparations.for(factory);
    const original = preparation.prepareRecord.bind(preparation);
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    vi.spyOn(preparation, "prepareRecord").mockImplementation(async (...args) => {
      entered.resolve(undefined);
      await release.promise;
      return original(...args);
    });
    const prepareEntity = vi.spyOn(preparation, "prepareEntity");
    const context = await BoundedContext.multitenant("DepartingTenant")
      .withTenantIndex(index)
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    const preparing = context.runtime.createStorageStructures(tenant("departing"));
    await entered.promise;
    try {
      present = false;
      release.resolve(undefined);
      await expect(preparing).rejects.toThrow("not registered");
      expect(prepareEntity).not.toHaveBeenCalled();
    } finally {
      release.resolve(undefined);
      await Promise.allSettled([preparing, context.close()]);
    }
  });

  it("checks every current tenant through finite index pages", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const index = TenantIndexes.fromFactory(factory);
    for (let number = 0; number < 65; number += 1)
      await index.keep(tenant(`paged-${String(number)}`));
    const pages = vi.spyOn(index, "page");
    const prepareEntity = vi.spyOn(StoragePreparations.for(factory), "prepareEntity");
    const context = await BoundedContext.multitenant("PagedExplicitTenants")
      .withTenantIndex(index)
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    try {
      await context.runtime.checkStructureCompatibility();
      expect(pages).toHaveBeenCalledTimes(2);
      expect(prepareEntity).toHaveBeenCalledTimes(65);
      expect(prepareEntity.mock.calls.every((call) => call[1] === "check")).toBe(true);
    } finally {
      await context.close();
    }
  });

  it("starts monitoring explicitly without preparing every tenant", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const index = TenantIndexes.fromFactory(factory);
    await index.keep(tenant("monitor-only"));
    const registry = new ObservingSubscriptionRegistry();
    const prepareEntity = vi.spyOn(StoragePreparations.for(factory), "prepareEntity");
    const context = await BoundedContext.multitenant("ExplicitMonitoring")
      .withTenantIndex(index)
      .withSubscriptionRegistry(registry)
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    try {
      await context.runtime.startSubscriptionMonitoring();
      expect(registry.snapshotCalls).toBe(1);
      expect(prepareEntity).not.toHaveBeenCalled();
    } finally {
      await context.close();
    }
  });

  it("retains a selected context during environment membership lookup and preparation", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const index = TenantIndexes.fromFactory(factory);
    await index.keep(tenant("held"));
    const contains = index.contains.bind(index);
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    vi.spyOn(index, "contains").mockImplementation(async (id) => {
      entered.resolve(undefined);
      await release.promise;
      return contains(id);
    });
    const context = await BoundedContext.multitenant("HeldEnvironmentLookup")
      .withTenantIndex(index)
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    const preparing = ServerEnvironment.instance().createStorageStructures(tenant("held"));
    await entered.promise;
    const closing = context.close();
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
      release.resolve(undefined);
      await preparing;
      await closing;
    } finally {
      release.resolve(undefined);
      await Promise.allSettled([preparing, closing]);
    }
  });

  it("automatically cleans up after failed explicit structure preparation", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const failure = new Error("explicit preparation failed");
    vi.spyOn(StoragePreparations.for(factory), "prepareEntity").mockRejectedValueOnce(failure);
    const context = await BoundedContext.singleTenant("FailedExplicitCheck")
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    await expect(context.runtime.createStorageStructures()).rejects.toBe(failure);
    await expect(ServerEnvironment.instance().close()).rejects.toBe(failure);
    await expect(context.runtime.startSubscriptionMonitoring()).rejects.toBe(failure);
  });

  it("releases every environment admission before joining fatal cleanup", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const failure = new Error("environment preparation failed");
    vi.spyOn(StoragePreparations.for(factory), "prepareEntity").mockRejectedValueOnce(failure);
    const first = await BoundedContext.singleTenant("FirstPreparedContext")
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    const second = await BoundedContext.singleTenant("SecondPreparedContext")
      .add(new Repository({ entityType: TaskAggregate, schema: ProjectStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    await expect(ServerEnvironment.instance().createStorageStructures()).rejects.toBe(failure);
    await expect(first.runtime.checkStructureCompatibility()).rejects.toBe(failure);
    await expect(second.runtime.checkStructureCompatibility()).rejects.toBe(failure);
  });

  it.each([
    { createStorageStructures: true, startSubscriptionMonitoring: false },
    { createStorageStructures: false, startSubscriptionMonitoring: true },
  ])("keeps build preparation flags independent: %o", async (options) => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const prepareEntity = vi.spyOn(StoragePreparations.for(factory), "prepareEntity");
    const registry = new ObservingSubscriptionRegistry();
    const context = await BoundedContext.singleTenant("IndependentBuildFlags")
      .withSubscriptionRegistry(registry)
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build(options);
    try {
      expect(prepareEntity).toHaveBeenCalledTimes(options.createStorageStructures ? 1 : 0);
      expect(registry.snapshotCalls).toBe(options.startSubscriptionMonitoring ? 1 : 0);
    } finally {
      await context.close();
    }
  });

  it("prepares only the first selected tenant after lazy multitenant build", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const index = TenantIndexes.fromFactory(factory);
    await index.keep(tenant("tenant-a"));
    await index.keep(tenant("tenant-b"));
    const prepareEntity = vi.spyOn(StoragePreparations.for(factory), "prepareEntity");
    const context = await BoundedContext.multitenant("LazyTenants")
      .withTenantIndex(index)
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    try {
      expect(prepareEntity).not.toHaveBeenCalled();
      await expect(
        context.stand().read(ProjectOverviewStateSchema, "unknown", {
          tenantId: tenant("tenant-missing"),
        }),
      ).rejects.toMatchObject({ type: "TENANT_UNKNOWN" });
      expect(prepareEntity).not.toHaveBeenCalled();
      await context
        .stand()
        .read(ProjectOverviewStateSchema, "task-a", { tenantId: tenant("tenant-a") });
      expect(prepareEntity).toHaveBeenCalledOnce();
      expect(prepareEntity.mock.calls[0]?.[0].context.tenantId).toEqual(tenant("tenant-a"));
      await index.keep(tenant("tenant-c"));
      await context
        .stand()
        .read(ProjectOverviewStateSchema, "task-c", { tenantId: tenant("tenant-c") });
      expect(prepareEntity).toHaveBeenCalledTimes(2);
      expect(prepareEntity.mock.calls[1]?.[0].context.tenantId).toEqual(tenant("tenant-c"));
    } finally {
      await context.close();
    }
  });

  it("rejects an invalid Command before preparing its lazy model", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const prepareEntity = vi.spyOn(StoragePreparations.for(factory), "prepareEntity");
    const context = await BoundedContext.singleTenant("InvalidLazyCommand")
      .add(new Repository({ entityType: TaskAggregate, schema: ProjectStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    try {
      const command = createAggregateCommand("invalid-lazy-command");
      command.message = undefined;
      await expect(context.commandBus().post(command)).rejects.toThrow(
        "CommandBus requires command.message.typeUrl.",
      );
      expect(prepareEntity).not.toHaveBeenCalled();
    } finally {
      await context.close();
    }
  });

  it("prepares a lazy Event recipient before imported Event dispatch", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const prepareEntity = vi.spyOn(StoragePreparations.for(factory), "prepareEntity");
    const dispatched = vi.fn();
    const context = await BoundedContext.singleTenant("LazyImportedEvent")
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .addEventDispatcher(createEventDispatcher([ReviewTaskAssignedSchema], dispatched))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    try {
      expect(prepareEntity).not.toHaveBeenCalled();
      await context.eventBus().post(createProjectionEvent("lazy-imported-event"));
      expect(prepareEntity).toHaveBeenCalledOnce();
      expect(dispatched).toHaveBeenCalledOnce();
    } finally {
      await context.close();
    }
  });

  it("retries the first lazy monitor failure before dispatching a later Event", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const registry = new InMemorySubscriptionRegistry();
    const failure = new Error("first subscription snapshot failed");
    const snapshot = vi.spyOn(registry, "snapshot").mockRejectedValueOnce(failure);
    const dispatched = vi.fn();
    const context = await BoundedContext.singleTenant("LazyMonitorRetry")
      .withSubscriptionRegistry(registry)
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .addEventDispatcher(createEventDispatcher([ReviewTaskAssignedSchema], dispatched))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    try {
      await expect(
        context.eventBus().post(createProjectionEvent("first-monitor-event")),
      ).rejects.toBe(failure);
      expect(dispatched).not.toHaveBeenCalled();
      await context.eventBus().post(createProjectionEvent("second-monitor-event"));
      expect(dispatched).toHaveBeenCalledOnce();
      expect(snapshot).toHaveBeenCalledTimes(2);
    } finally {
      await context.close();
    }
  });

  it("rejects an invalid imported Event before lazy provider preparation", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const prepareEntity = vi.spyOn(StoragePreparations.for(factory), "prepareEntity");
    const context = await BoundedContext.singleTenant("InvalidLazyEvent")
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .addEventDispatcher(createEventDispatcher([ReviewTaskAssignedSchema], () => undefined))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    try {
      const event = createProjectionEvent("invalid-lazy-event");
      event.message = undefined;
      await expect(context.eventBus().post(event)).rejects.toThrow(
        "EventBus requires event.message.typeUrl.",
      );
      expect(prepareEntity).not.toHaveBeenCalled();
    } finally {
      await context.close();
    }
  });

  it("coalesces concurrent first reads and retries a failed preparation", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const preparation = StoragePreparations.for(factory);
    const original = preparation.prepareEntity.bind(preparation);
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const failure = new Error("temporary model preparation failure");
    const prepareEntity = vi
      .spyOn(preparation, "prepareEntity")
      .mockImplementation(async (input, mode) => {
        if (prepareEntity.mock.calls.length === 1) {
          entered.resolve(undefined);
          await release.promise;
        }
        await original(input, mode);
      });
    const context = await BoundedContext.singleTenant("ConcurrentLazyRead")
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    try {
      const first = context.stand().read(ProjectOverviewStateSchema, "task-1");
      const second = context.stand().read(ProjectOverviewStateSchema, "task-2");
      const firstRejected = expect(first).rejects.toBe(failure);
      const secondRejected = expect(second).rejects.toBe(failure);
      await entered.promise;
      expect(prepareEntity).toHaveBeenCalledOnce();
      release.reject(failure);
      await firstRejected;
      await secondRejected;
      await expect(
        context.stand().read(ProjectOverviewStateSchema, "task-3"),
      ).resolves.toBeUndefined();
      expect(prepareEntity).toHaveBeenCalledTimes(2);
    } finally {
      await context.close();
    }
  });

  it("retries failed shared subscription preparation on the next lazy read", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const preparation = StoragePreparations.for(factory);
    const original = preparation.prepareRecord.bind(preparation);
    const failure = new Error("shared registry preparation failed");
    const prepare = vi.spyOn(preparation, "prepareRecord").mockRejectedValueOnce(failure);
    const context = await BoundedContext.singleTenant("RetrySharedRegistry")
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    try {
      await expect(context.stand().read(ProjectOverviewStateSchema, "first")).rejects.toBe(failure);
      prepare.mockImplementation(original);
      await expect(
        context.stand().read(ProjectOverviewStateSchema, "second"),
      ).resolves.toBeUndefined();
      expect(prepare).toHaveBeenCalledTimes(3);
      expect(prepare.mock.calls[0]?.[1].recordType.typeName).toBe(
        prepare.mock.calls[1]?.[1].recordType.typeName,
      );
    } finally {
      await context.close();
    }
  });

  it("drains an admitted lazy read before context close releases its model", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const registry = new ObservingSubscriptionRegistry();
    const preparation = StoragePreparations.for(factory);
    const original = preparation.prepareEntity.bind(preparation);
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    vi.spyOn(preparation, "prepareEntity").mockImplementation(async (input, mode) => {
      entered.resolve(undefined);
      await release.promise;
      await original(input, mode);
    });
    const context = await BoundedContext.singleTenant("ClosingLazyRead")
      .withSubscriptionRegistry(registry)
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    const reading = context.stand().read(ProjectOverviewStateSchema, "task-1");
    await entered.promise;
    const closing = context.close();
    let closed = false;
    void closing.then(
      () => {
        closed = true;
      },
      () => {
        closed = true;
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
    release.resolve(undefined);
    await expect(reading).resolves.toBeUndefined();
    await closing;
    expect(registry.snapshotCalls).toBe(0);
    await expect(context.stand().read(ProjectOverviewStateSchema, "task-2")).rejects.toThrow();
  });

  it("fences later builds after required eager model preparation fails", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const first = await BoundedContext.singleTenant("ReadySibling")
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build();
    const preparation = StoragePreparations.for(factory);
    const original = preparation.prepareEntity.bind(preparation);
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const failure = new Error("required model preparation failed");
    vi.spyOn(preparation, "prepareEntity").mockImplementation(async (input, mode) => {
      if (input.stateSchema.typeName === ProjectStateSchema.typeName) {
        entered.resolve(undefined);
        await release.promise;
        throw failure;
      }
      await original(input, mode);
    });
    try {
      const building = BoundedContext.singleTenant("FailingSibling")
        .add(new Repository({ entityType: TaskAggregate, schema: ProjectStateSchema }))
        .build();
      const rejected = expect(building).rejects.toBe(failure);
      await entered.promise;
      await expect(
        first.stand().read(ProjectOverviewStateSchema, "ready-task"),
      ).resolves.toBeUndefined();
      release.resolve(undefined);
      await rejected;
      const later = await BoundedContext.singleTenant("AfterFailedPreparation")
        .build()
        .then(
          async (context) => {
            await context.close();
            return context;
          },
          (error: unknown) => error,
        );
      expect(later).toBeInstanceOf(Error);
    } finally {
      release.resolve(undefined);
      await first.close();
    }
  });

  it("does not start a later eager tenant after another build sets the fatal fence", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const index = TenantIndexes.fromFactory(factory);
    await index.keep(tenant("tenant-a"));
    await index.keep(tenant("tenant-b"));
    const page = index.page.bind(index);
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    vi.spyOn(index, "page").mockImplementation(async (options) => {
      const returned = await page(options);
      entered.resolve(undefined);
      await release.promise;
      return returned;
    });
    const prepare = vi.spyOn(StoragePreparations.for(factory), "prepareEntity");
    const collecting = BoundedContext.multitenant("PagedDuringFatal")
      .withTenantIndex(index)
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build();
    await entered.promise;
    const failure = new Error("other required family failed");
    prepare.mockRejectedValueOnce(failure);
    const closeStarted = Promise.withResolvers<undefined>();
    const contextClose: unknown = Reflect.get(BoundedContext.prototype, "close");
    if (typeof contextClose !== "function") throw new Error("Expected context close method.");
    const closeSpy = vi.spyOn(BoundedContext.prototype, "close").mockImplementation(function (
      this: BoundedContext,
    ) {
      if (this.name.value === "FatalDuringPage") closeStarted.resolve(undefined);
      return Reflect.apply(contextClose, this, []) as Promise<void>;
    });
    const failing = BoundedContext.singleTenant("FatalDuringPage")
      .add(new Repository({ entityType: TaskAggregate, schema: ProjectStateSchema }))
      .build();
    const results = Promise.allSettled([collecting, failing]);
    try {
      await closeStarted.promise;
      expect(serverEnvironmentAccess.hasStartupFailure(ServerEnvironment.instance())).toBe(true);
      release.resolve(undefined);
      await results;
      expect(prepare).toHaveBeenCalledOnce();
    } finally {
      release.resolve(undefined);
      closeSpy.mockRestore();
    }
  });

  it("does not start an eager tenant page after shared readiness crosses the fatal fence", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const index = TenantIndexes.fromFactory(factory);
    await index.keep(tenant("tenant-a"));
    const page = vi.spyOn(index, "page");
    const preparation = StoragePreparations.for(factory);
    const prepareRecord = preparation.prepareRecord.bind(preparation);
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    vi.spyOn(preparation, "prepareRecord").mockImplementation(
      async (context, spec, group, mode) => {
        if (context.name === "PageAfterFatal:subscriptions") {
          entered.resolve(undefined);
          await release.promise;
        }
        await prepareRecord(context, spec, group, mode);
      },
    );
    const collecting = BoundedContext.multitenant("PageAfterFatal")
      .withTenantIndex(index)
      .withSubscriptionRegistry(
        new StorageSubscriptionRegistry(
          { name: "PageAfterFatal:subscriptions", multitenant: false },
          factory,
        ),
      )
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build();
    await entered.promise;
    const failure = new Error("different required family failed");
    vi.spyOn(preparation, "prepareEntity").mockRejectedValueOnce(failure);
    const closed = Promise.withResolvers<undefined>();
    const close: unknown = Reflect.get(BoundedContext.prototype, "close");
    if (typeof close !== "function") throw new Error("Expected context close method.");
    const closeSpy = vi.spyOn(BoundedContext.prototype, "close").mockImplementation(function (
      this: BoundedContext,
    ) {
      if (this.name.value === "PageFatalTrigger") closed.resolve(undefined);
      return Reflect.apply(close, this, []) as Promise<void>;
    });
    const failing = BoundedContext.singleTenant("PageFatalTrigger")
      .add(new Repository({ entityType: TaskAggregate, schema: ProjectStateSchema }))
      .build();
    const settled = Promise.allSettled([collecting, failing]);
    try {
      await closed.promise;
      release.resolve(undefined);
      await settled;
      expect(page).not.toHaveBeenCalled();
    } finally {
      release.resolve(undefined);
      closeSpy.mockRestore();
    }
  });

  it("fences public reads before a completed sibling finishes fatal cleanup", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const sibling = await BoundedContext.singleTenant("FatalReadSibling")
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build();
    const preparation = StoragePreparations.for(factory);
    const failure = new Error("required Entity preparation failed");
    vi.spyOn(preparation, "prepareEntity").mockRejectedValueOnce(failure);
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const close: unknown = Reflect.get(BoundedContext.prototype, "close");
    if (typeof close !== "function") throw new Error("Expected context close method.");
    const closeSpy = vi.spyOn(BoundedContext.prototype, "close").mockImplementation(async function (
      this: BoundedContext,
    ) {
      if (this === sibling) {
        entered.resolve(undefined);
        await release.promise;
      }
      await Reflect.apply(close, this, []);
    });
    try {
      const building = BoundedContext.singleTenant("FatalReadFailure")
        .add(new Repository({ entityType: TaskAggregate, schema: ProjectStateSchema }))
        .build();
      await entered.promise;
      await expect(sibling.stand().read(ProjectOverviewStateSchema, "task-1")).rejects.toThrow(
        "closing",
      );
      release.resolve(undefined);
      await expect(building).rejects.toBe(failure);
    } finally {
      release.resolve(undefined);
      await sibling.close();
      closeSpy.mockRestore();
    }
  });

  it("waits for a metadata-loading build before automatic fatal facility cleanup", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const registry = createGeneratedRegistryFixture([aggregateReplayRegistry(ReplayTaskAggregate)]);
    const load: unknown = Reflect.get(GeneratedRegistryDiscovery.prototype, "load");
    if (typeof load !== "function") throw new Error("Expected generated registry loader.");
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const order: string[] = [];
    const loader = vi
      .spyOn(GeneratedRegistryDiscovery.prototype, "load")
      .mockImplementation(async function (this: GeneratedRegistryDiscovery, options) {
        entered.resolve(undefined);
        await release.promise;
        order.push("metadata-settled");
        return Reflect.apply(load, this, [options]) as ReturnType<
          GeneratedRegistryDiscovery["load"]
        >;
      });
    const factoryClose = factory.close.bind(factory);
    vi.spyOn(factory, "close").mockImplementation(async () => {
      order.push("factory-close");
      await factoryClose();
    });
    const partialClosing = Promise.withResolvers<undefined>();
    const contextClose: unknown = Reflect.get(BoundedContext.prototype, "close");
    if (typeof contextClose !== "function") throw new Error("Expected context close method.");
    const closeSpy = vi.spyOn(BoundedContext.prototype, "close").mockImplementation(function (
      this: BoundedContext,
    ) {
      if (this.name.value === "FailingDuringLoad") partialClosing.resolve(undefined);
      return Reflect.apply(contextClose, this, []) as Promise<void>;
    });
    try {
      const loading = BoundedContext.singleTenant("LoadingDuringFatal")
        .withGeneratedRegistryRoot(registry.root)
        .add(ReplayTaskAggregate)
        .build();
      await entered.promise;
      const failure = new Error("required model preparation failed");
      vi.spyOn(StoragePreparations.for(factory), "prepareEntity").mockRejectedValueOnce(failure);
      const failing = BoundedContext.singleTenant("FailingDuringLoad")
        .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
        .build();
      await partialClosing.promise;
      expect(serverEnvironmentAccess.hasStartupFailure(ServerEnvironment.instance())).toBe(true);
      expect(order).toEqual([]);
      await expect(BoundedContext.singleTenant("TooLate").build()).rejects.toThrow();
      release.resolve(undefined);
      await expect(failing).rejects.toBe(failure);
      await expect(loading).rejects.toBe(failure);
      expect(order).toEqual(["metadata-settled", "factory-close"]);
      expect(serverEnvironmentAccess.openContexts(ServerEnvironment.instance())).toEqual([]);
    } finally {
      release.resolve(undefined);
      loader.mockRestore();
      closeSpy.mockRestore();
    }
  });

  it("observes completed-context close failure while another build remains held", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const registry = new ObservingSubscriptionRegistry();
    const cleanup = new Error("early completed context close failed");
    const closeStarted = Promise.withResolvers<undefined>();
    vi.spyOn(registry, "close").mockImplementationOnce(() => {
      closeStarted.resolve(undefined);
      return Promise.reject(cleanup);
    });
    await BoundedContext.singleTenant("CompletedBeforeFatal")
      .withSubscriptionRegistry(registry)
      .build();
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const load: unknown = Reflect.get(GeneratedRegistryDiscovery.prototype, "load");
    if (typeof load !== "function") throw new Error("Expected generated registry loader.");
    const loader = vi
      .spyOn(GeneratedRegistryDiscovery.prototype, "load")
      .mockImplementation(async function (this: GeneratedRegistryDiscovery, options) {
        entered.resolve(undefined);
        await release.promise;
        return Reflect.apply(load, this, [options]) as ReturnType<
          GeneratedRegistryDiscovery["load"]
        >;
      });
    const observed: unknown[] = [];
    const onUnhandled = (error: unknown) => observed.push(error);
    process.on("unhandledRejection", onUnhandled);
    try {
      const loading = BoundedContext.singleTenant("HeldDuringCompletedClose")
        .withGeneratedRegistryRoot(
          createGeneratedRegistryFixture([aggregateReplayRegistry(ReplayTaskAggregate)]).root,
        )
        .add(ReplayTaskAggregate)
        .build();
      await entered.promise;
      const failure = new Error("required eager family failed");
      vi.spyOn(StoragePreparations.for(factory), "prepareEntity").mockRejectedValueOnce(failure);
      const failing = BoundedContext.singleTenant("TriggersCompletedClose")
        .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
        .build();
      const results = Promise.allSettled([loading, failing]);
      await closeStarted.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      const earlyUnhandled = [...observed];
      release.resolve(undefined);
      for (const result of await results)
        if (result.status === "rejected")
          expect((result.reason as AggregateError).errors).toEqual([failure, cleanup]);
      expect(earlyUnhandled).toEqual([]);
    } finally {
      release.resolve(undefined);
      loader.mockRestore();
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("reports independent required failures and factory cleanup after both builds settle", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const first = new Error("first required family failed");
    const second = new Error("second required family failed");
    const cleanup = new Error("factory cleanup failed");
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const rollback = new Error("first partial context close failed");
    const firstClosed = Promise.withResolvers<undefined>();
    vi.spyOn(StoragePreparations.for(factory), "prepareEntity").mockImplementation(
      async (input) => {
        if (input.stateSchema.typeName === ProjectStateSchema.typeName) throw first;
        entered.resolve(undefined);
        await release.promise;
        throw second;
      },
    );
    const contextClose: unknown = Reflect.get(BoundedContext.prototype, "close");
    if (typeof contextClose !== "function") throw new Error("Expected context close method.");
    const closeSpy = vi.spyOn(BoundedContext.prototype, "close").mockImplementation(async function (
      this: BoundedContext,
    ) {
      await (Reflect.apply(contextClose, this, []) as Promise<void>);
      if (this.name.value === "FirstRequiredFailure") {
        firstClosed.resolve(undefined);
        throw rollback;
      }
    });
    const close = factory.close.bind(factory);
    const factoryCloseSpy = vi.spyOn(factory, "close").mockImplementation(async () => {
      await close();
      throw cleanup;
    });
    const a = BoundedContext.singleTenant("FirstRequiredFailure")
      .add(new Repository({ entityType: TaskAggregate, schema: ProjectStateSchema }))
      .build();
    const b = BoundedContext.singleTenant("SecondRequiredFailure")
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build();
    const settled = Promise.allSettled([a, b]);
    await entered.promise;
    await firstClosed.promise;
    release.resolve(undefined);
    for (const result of await settled) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected")
        expect((result.reason as AggregateError).errors).toEqual([
          first,
          second,
          rollback,
          cleanup,
        ]);
    }
    expect(factoryCloseSpy).toHaveBeenCalledOnce();
    closeSpy.mockRestore();
  });

  it("keeps a directory enumeration failure local to its eager build", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const index = TenantIndexes.fromFactory(factory);
    await index.keep(tenant("known"));
    const failure = new Error("tenant directory page failed");
    vi.spyOn(index, "page").mockRejectedValueOnce(failure);
    await expect(
      BoundedContext.multitenant("DirectoryFailure")
        .withTenantIndex(index)
        .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
        .build(),
    ).rejects.toBe(failure);
    const later = await BoundedContext.multitenant("DirectoryRecovered")
      .withTenantIndex(index)
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build();
    await later.close();
  });

  it("preserves a completed sibling cleanup error with the required startup cause", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const sibling = await BoundedContext.singleTenant("CleanupErrorSibling")
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build();
    const startup = new Error("required family failed");
    const cleanup = new Error("sibling Stand close failed");
    vi.spyOn(StoragePreparations.for(factory), "prepareEntity").mockRejectedValueOnce(startup);
    const stand = sibling.stand();
    const close = stand.close.bind(stand);
    const closeSpy = vi.spyOn(stand, "close").mockImplementation(async () => {
      await close();
      throw cleanup;
    });
    try {
      const result = BoundedContext.singleTenant("CleanupErrorFailure")
        .add(new Repository({ entityType: TaskAggregate, schema: ProjectStateSchema }))
        .build();
      await expect(result).rejects.toMatchObject({ errors: [startup, cleanup] });
      expect(serverEnvironmentAccess.openContexts(ServerEnvironment.instance())).toEqual([]);
    } finally {
      closeSpy.mockRestore();
    }
  });

  it("keeps shared storage open for an admitted sibling replay during fatal cleanup", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const sibling = await BoundedContext.singleTenant("AdmittedFatalSibling")
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build();
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const replay = boundedContextAccess.trackReplay(sibling, async () => {
      entered.resolve(undefined);
      await release.promise;
      await factory.checkConnection();
    });
    await entered.promise;
    const closed = vi.spyOn(factory, "close");
    const closeStarted = Promise.withResolvers<undefined>();
    const originalClose: unknown = Reflect.get(BoundedContext.prototype, "close");
    if (typeof originalClose !== "function") throw new Error("Expected context close method.");
    const closeSpy = vi.spyOn(BoundedContext.prototype, "close").mockImplementation(function (
      this: BoundedContext,
    ) {
      if (this === sibling) closeStarted.resolve(undefined);
      return Reflect.apply(originalClose, this, []) as Promise<void>;
    });
    const failure = new Error("required startup preparation failed");
    vi.spyOn(StoragePreparations.for(factory), "prepareEntity").mockRejectedValueOnce(failure);
    const closing = BoundedContext.singleTenant("AdmittedFatalFailure")
      .add(new Repository({ entityType: TaskAggregate, schema: ProjectStateSchema }))
      .build();
    try {
      await closeStarted.promise;
      await expect(sibling.stand().read(ProjectOverviewStateSchema, "new-read")).rejects.toThrow(
        "closing",
      );
      expect(closed).not.toHaveBeenCalled();
    } finally {
      release.resolve(undefined);
      await replay;
      await closing.catch(() => undefined);
      closeSpy.mockRestore();
    }
    await expect(closing).rejects.toBe(failure);
    expect(closed).toHaveBeenCalledOnce();
  });

  it("excludes gated integration until ready while retaining reservation and reset guards", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const open: unknown = Reflect.get(IntegrationBroker.prototype, "open");
    if (typeof open !== "function") throw new Error("Expected integration open method.");
    const spy = vi.spyOn(IntegrationBroker.prototype, "open").mockImplementation(async function (
      this: IntegrationBroker,
    ) {
      entered.resolve(undefined);
      await release.promise;
      await Reflect.apply(open, this, []);
    });
    const environment = ServerEnvironment.instance();
    const before = serverEnvironmentAccess.openContexts(environment);
    try {
      const building = BoundedContext.singleTenant("GatedReady")
        .add(new Repository({ entityType: TaskAggregate, schema: ProjectStateSchema }))
        .build();
      await entered.promise;
      expect(serverEnvironmentAccess.openContexts(environment)).toEqual(before);
      await expect(ServerEnvironmentLifecycle.resetForTest()).rejects.toThrow(
        "active Bounded Contexts",
      );
      await expect(
        BoundedContext.singleTenant("CompetingReady")
          .add(new Repository({ entityType: DuplicateTaskAggregate, schema: ProjectStateSchema }))
          .build(),
      ).rejects.toThrow(DuplicateEntityStateException);
      release.resolve(undefined);
      const context = await building;
      expect(serverEnvironmentAccess.openContexts(environment)).toContain(context);
      await context.close();
      expect(serverEnvironmentAccess.openContexts(environment)).toEqual(before);
    } finally {
      release.resolve(undefined);
      spy.mockRestore();
    }
  });

  it("closes shared facilities after required integration and rollback both fail", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const registry = new ObservingSubscriptionRegistry();
    const closeRegistry = registry.close.bind(registry);
    const startup = new Error("integration open failed");
    const rollback = new Error("partial subscription close failed");
    const open = vi.spyOn(IntegrationBroker.prototype, "open").mockRejectedValueOnce(startup);
    vi.spyOn(registry, "close").mockImplementation(async () => {
      await closeRegistry();
      throw rollback;
    });
    const closeFactory = vi.spyOn(factory, "close");
    try {
      const result = BoundedContext.singleTenant("FailingIntegration")
        .withSubscriptionRegistry(registry)
        .build();
      await expect(result).rejects.toMatchObject({ errors: [startup, rollback] });
      expect(closeFactory).toHaveBeenCalledOnce();
      expect(serverEnvironmentAccess.openContexts(ServerEnvironment.instance())).toEqual([]);
      await expect(
        BoundedContext.singleTenant("AfterIntegrationFailure").build(),
      ).rejects.toThrow();
    } finally {
      open.mockRestore();
    }
  });

  it("waits for failed pre-context bus shutdown and retains its cleanup error", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const cleanup = new Error("bus close failed");
    const close: unknown = Reflect.get(SingleProcessServerRuntime.prototype, "close");
    if (typeof close !== "function") throw new Error("Expected runtime close method.");
    let gated = false;
    const spy = vi
      .spyOn(SingleProcessServerRuntime.prototype, "close")
      .mockImplementation(async function (this: SingleProcessServerRuntime) {
        if (!gated) {
          gated = true;
          entered.resolve(undefined);
          await release.promise;
          await Reflect.apply(close, this, []);
          throw cleanup;
        }
        await Reflect.apply(close, this, []);
      });
    const instance = new StandaloneAssignee();
    const root = createStandaloneGeneratedRegistryRoot([
      standaloneReceiver(
        StandaloneAssignee,
        "command-assignment",
        "assign",
        AssignReviewTaskSchema,
        [ReviewTaskAssignedSchema],
      ),
    ]);
    try {
      let settled = false;
      const result = BoundedContext.singleTenant("BusCleanup")
        .withGeneratedRegistryRoot(root)
        .addAssignee(instance)
        .addAssignee(instance)
        .build()
        .then(
          () => {
            settled = true;
            return undefined;
          },
          (error: unknown) => {
            settled = true;
            return error;
          },
        );
      await entered.promise;
      expect(settled).toBe(false);
      await expect(ServerEnvironmentLifecycle.resetForTest()).rejects.toThrow(
        "active Bounded Contexts",
      );
      release.resolve(undefined);
      const failure = await result;
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toContain(cleanup);
    } finally {
      release.resolve(undefined);
      spy.mockRestore();
    }
  });

  it("preserves registration and asynchronous cleanup failures", async () => {
    const first = await BoundedContext.singleTenant("First")
      .add(new Repository({ entityType: TaskAggregate, schema: ProjectStateSchema }))
      .build();
    const registry = new ObservingSubscriptionRegistry();
    const cleanup = new Error("registry close failed");
    vi.spyOn(registry, "close").mockRejectedValueOnce(cleanup);
    try {
      let failure: unknown;
      try {
        await BoundedContext.singleTenant("Second")
          .withSubscriptionRegistry(registry)
          .add(new Repository({ entityType: DuplicateTaskAggregate, schema: ProjectStateSchema }))
          .build();
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(AggregateError);
      const causes = (failure as AggregateError).errors.flatMap((error: unknown): unknown[] =>
        error instanceof AggregateError ? (error.errors as unknown[]) : [error],
      );
      expect(causes).toContain(cleanup);
      expect(causes.some((error: unknown) => error instanceof DuplicateEntityStateException)).toBe(
        true,
      );
    } finally {
      await first.close();
    }
  });

  it("does not open repository storage during registration", async () => {
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: ProjectStateSchema,
    });
    const storageFactory = new ObservingStorageFactory([]);
    await configureStorage(storageFactory);

    const context = await BoundedContext.singleTenant("Tasks").add(repository).build();

    expect(context.registeredRepositories()).toHaveLength(1);
    expect(storageFactory.creationsFor(ProjectStateSchema.typeName)).toEqual([]);
  });

  it("returns only this context's exact registered repository without opening storage", async () => {
    const storageFactory = new ObservingStorageFactory([]);
    await configureStorage(storageFactory);
    const repository = new Repository({ entityType: TaskAggregate, schema: ProjectStateSchema });
    const context = await BoundedContext.singleTenant("Tasks").add(repository).build();
    expectTypeOf(context.getRepository(TaskAggregate)).toEqualTypeOf<
      Repository<typeof TaskAggregate>
    >();
    expect(context.getRepository(TaskAggregate)).toBe(repository);
    const SameName = class TaskAggregate extends Aggregate<string, typeof ProjectStateSchema> {};
    expect(() => context.getRepository(SameName)).toThrow(/not registered/);
    expect(() => context.getRepository(DuplicateTaskAggregate)).toThrow(/not registered/);
    expect(storageFactory.creationsFor(ProjectStateSchema.typeName)).toEqual([]);
    const closing = context.close();
    expect(() => context.getRepository(TaskAggregate)).toThrow(/closing|closed/);
    await closing;
    const other = await BoundedContext.singleTenant("Other")
      .add(new Repository({ entityType: TaskAggregate, schema: ProjectStateSchema }))
      .build();
    expect(repository).not.toBe(other.getRepository(TaskAggregate));
    await other.close();
  });

  it("retrieves the actual repository assembled from generated handlers", async () => {
    const registryRoot = createGeneratedRegistryRoot([
      { entityType: GeneratedTaskAggregate, stateSchema: ProjectStateSchema, handlers: [] },
    ]);
    const context = await BoundedContext.singleTenant("Tasks")
      .withGeneratedRegistryRoot(registryRoot)
      .add(GeneratedTaskAggregate)
      .build();
    expect(context.getRepository(GeneratedTaskAggregate).entityType).toBe(GeneratedTaskAggregate);
    await context.close();
  });

  it("rejects duplicate repository entity or state identities when building", async () => {
    const firstTaskRepository = new Repository({
      entityType: TaskAggregate,
      schema: ProjectStateSchema,
    });
    const secondTaskRepository = new Repository({
      entityType: TaskAggregate,
      schema: ProjectStateSchema,
    });
    const duplicateStateRepository = new Repository({
      entityType: DuplicateTaskAggregate,
      schema: ProjectStateSchema,
    });

    await expect(
      BoundedContext.singleTenant("Tasks")
        .add(firstTaskRepository)
        .add(secondTaskRepository)
        .build(),
    ).rejects.toThrow(`Repository entity type "TaskAggregate" is already registered.`);

    await expect(
      BoundedContext.singleTenant("Tasks")
        .add(firstTaskRepository)
        .add(duplicateStateRepository)
        .build(),
    ).rejects.toThrow(
      `Repository state type "${ProjectStateSchema.typeName}" is already registered.`,
    );
  });

  it("rejects structural repository lookalikes before registration", () => {
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: ProjectStateSchema,
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

  it("uses captured repository metadata instead of virtual getters for registration", async () => {
    const projectionMetadata = new Repository({
      entityType: TaskProjection,
      schema: ProjectOverviewStateSchema,
    }).metadata;
    class SpoofingRepository extends Repository<typeof TaskAggregate> {
      constructor() {
        super({
          entityType: TaskAggregate,
          schema: ProjectStateSchema,
        });
      }

      override get metadata(): Repository<typeof TaskAggregate>["metadata"] {
        return projectionMetadata as unknown as Repository<typeof TaskAggregate>["metadata"];
      }

      override get stateFullTypeName(): Repository<typeof TaskAggregate>["stateFullTypeName"] {
        return ProjectOverviewStateSchema.typeName as Repository<
          typeof TaskAggregate
        >["stateFullTypeName"];
      }
    }

    const storageFactory = new ObservingStorageFactory([]);
    await configureStorage(storageFactory);
    const spoofingRepository = new SpoofingRepository();
    const projectionRepository = new Repository({
      entityType: TaskProjection,
      schema: ProjectOverviewStateSchema,
    });
    const context = await BoundedContext.singleTenant("Tasks")
      .add(spoofingRepository)
      .add(projectionRepository)
      .build();

    const repositories = context.registeredRepositories();
    expect(repositories.map((repository) => repository.stateFullTypeName)).toEqual([
      ProjectStateSchema.typeName,
      ProjectOverviewStateSchema.typeName,
    ]);
    expect(repositories[0]).not.toBe(spoofingRepository);
    expect(repositories[1]).not.toBe(projectionRepository);
    expect(storageFactory.creationsFor(ProjectStateSchema.typeName)).toHaveLength(0);
  });

  it("defers repository provider failures until an operation selects storage", async () => {
    const storageFactory = new FailingStorageFactory(6, ProjectOverviewStateSchema.typeName);
    await configureStorage(storageFactory);
    const aggregateRepository = new Repository({
      entityType: TaskAggregate,
      schema: ProjectStateSchema,
    });
    const projectionRepository = new Repository({
      entityType: TaskProjection,
      schema: ProjectOverviewStateSchema,
    });

    const context = await BoundedContext.singleTenant("Tasks")
      .add(aggregateRepository)
      .add(projectionRepository)
      .build();

    expect(context.registeredRepositories()).toHaveLength(2);
    expect(storageFactory.creationsFor(ProjectStateSchema.typeName)).toHaveLength(0);
    expect(storageFactory.creationsFor(ProjectOverviewStateSchema.typeName)).toHaveLength(0);
  });

  it("aborts retained domain and System buses when dispatcher registration throws", async () => {
    for (const schema of [ProjectOverviewStateSchema, EntityLog.EntityStateChangedSchema]) {
      const storageFactory = new ObservingStorageFactory([]);
      await configureStorage(storageFactory);
      let schemaReads = 0;
      const dispatcher: EventDispatcher = {
        messageSchemas: () => {
          schemaReads++;
          if (schemaReads > 2) throw new Error(`Registration failed for ${schema.typeName}.`);
          return [schema];
        },
        dispatch: () => Promise.resolve(),
      };

      await expect(
        BoundedContext.singleTenant("Tasks").addEventDispatcher(dispatcher).build(),
      ).rejects.toThrow(`Registration failed for ${schema.typeName}.`);
      expect(storageFactory.storages.every((storage) => !storage.isOpen())).toBe(true);
    }
  });

  it("preserves a dispatcher registration failure without opening System event storage", async () => {
    const storageFactory = new ObservingStorageFactory([], [1]);
    await configureStorage(storageFactory);
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
      await BoundedContext.singleTenant("Tasks")
        .persistSystemEvents()
        .addEventDispatcher(dispatcher)
        .build();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBe(primary);
    expect(storageFactory.creationsFor(EventSchema.typeName)).toHaveLength(0);
  });

  it("reports dispatcher registration and awaited EventStore cleanup failures together", async () => {
    const primary = new Error("dispatcher registration failed");
    const cleanup = new Error("EventStore cleanup failed");
    const closeStore: unknown = Reflect.get(EventStore.prototype, "close");
    if (typeof closeStore !== "function") throw new Error("Expected EventStore close method.");
    const close = vi.spyOn(EventStore.prototype, "close").mockImplementationOnce(async function (
      this: EventStore,
    ) {
      await Reflect.apply(closeStore, this, []);
      throw cleanup;
    });
    let schemaReads = 0;
    const dispatcher: EventDispatcher = {
      messageSchemas: () => {
        schemaReads++;
        if (schemaReads > 2) throw primary;
        return [EntityLog.EntityStateChangedSchema];
      },
      dispatch: () => Promise.resolve(),
    };

    try {
      let failure: unknown;
      try {
        await BoundedContext.singleTenant("Tasks")
          .persistSystemEvents()
          .addEventDispatcher(dispatcher)
          .build();
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(AggregateError);
      const errors = (failure as AggregateError).errors.flatMap((error: unknown): unknown[] =>
        error instanceof AggregateError ? (error.errors as unknown[]) : [error],
      );
      expect(errors).toEqual(expect.arrayContaining([primary, cleanup]));
    } finally {
      close.mockRestore();
    }
  });

  it("builds without preparing storage for every registered repository", async () => {
    const storageFactory = new FailingStorageFactory(7, ProcessManagerStateSchema.typeName, [5]);
    await configureStorage(storageFactory);
    const aggregateRepository = new Repository({
      entityType: TaskAggregate,
      schema: ProjectStateSchema,
    });
    const projectionRepository = new Repository({
      entityType: TaskProjection,
      schema: ProjectOverviewStateSchema,
    });
    const processManagerRepository = new Repository({
      entityType: TaskProcessManager,
      schema: ProcessManagerStateSchema,
    });

    const context = await BoundedContext.singleTenant("Tasks")
      .add(aggregateRepository)
      .add(projectionRepository)
      .add(processManagerRepository)
      .build();

    expect(context.registeredRepositories()).toHaveLength(3);
    expect(storageFactory.creationsFor(ProjectStateSchema.typeName)).toHaveLength(0);
    expect(storageFactory.creationsFor(ProjectOverviewStateSchema.typeName)).toHaveLength(0);
    expect(storageFactory.creationsFor(ProcessManagerStateSchema.typeName)).toHaveLength(0);
  });

  it("keeps add and remove chainable while maintaining the registration list", () => {
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: ProjectStateSchema,
    });
    const builder = BoundedContext.singleTenant("Tasks");

    expect(builder.add(repository)).toBe(builder);
    expect(builder.remove(repository)).toBe(builder);
    expect(builder).toBeInstanceOf(BoundedContextBuilder);
  });

  it("closes owned buses, stand, event store, repository storage, and tenant index once", async () => {
    const storageFactory = new ObservingStorageFactory([]);
    await configureStorage(storageFactory);
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: ProjectStateSchema,
    });
    const context = await BoundedContext.multitenant("Tasks").add(repository).build();

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
    const storageFactory = new FailingStorageFactory(6, ProjectStateSchema.typeName);
    await configureStorage(storageFactory);
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: ProjectStateSchema,
    });

    const context = await BoundedContext.multitenant("Tasks")
      .withTenantIndex(TenantIndexes.fromFactory(storageFactory))
      .add(repository)
      .build();
    const tenantIndex = internalTenantIndex(context);

    await tenantIndex.keep(tenant("tenant-a"));
    await expect(tenantIndex.all()).resolves.toEqual([tenant("tenant-a")]);
    expect(storageFactory.creationsFor(ProjectStateSchema.typeName)).toHaveLength(0);
  });

  it("transfers and closes a custom subscription registry on a failed first build", async () => {
    const registry = new ObservingSubscriptionRegistry();
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: ProjectStateSchema,
    });
    const existing = await BoundedContext.singleTenant("Existing").add(repository).build();
    const builder = BoundedContext.singleTenant("Tasks")
      .withSubscriptionRegistry(registry)
      .add(repository);

    try {
      await expect(builder.build()).rejects.toThrow("already registered with Bounded Context");
      expect(registry.closeCalls).toBe(1);

      builder.remove(repository);
      const rebuilt = await builder.build();
      expect(boundedContextAccess.subscriptionRegistry(rebuilt)).not.toBe(registry);
      await rebuilt.close();
    } finally {
      await existing.close();
    }
  });

  it("starts one Stand registry reconciliation after repository registration", async () => {
    const registry = new ObservingSubscriptionRegistry();
    const context = await BoundedContext.singleTenant("StandReconciliation")
      .withSubscriptionRegistry(registry)
      .build();

    await vi.waitFor(() => {
      expect(registry.snapshotCalls).toBe(1);
    });
    await context.close();
  });

  it("waits for in-flight direct Stand updates before closing subscriptions", async () => {
    const storageFactory = new DelayingStorageFactory();
    await configureStorage(storageFactory);
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectOverviewStateSchema,
    });
    const context = await BoundedContext.singleTenant("Tasks").add(repository).build();
    const deliveries: string[] = [];
    context.stand().subscribe(ProjectOverviewStateSchema, (update) => {
      deliveries.push(update.state.name);
    });

    const update = context.stand().update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, {
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
        ProjectOverviewStateSchema,
        create(ProjectOverviewStateSchema, {
          id: "task-rejected",
          name: "Rejected",
          priority: 1,
        }),
      ),
    ).rejects.toThrow("Stand is closed.");
  });

  it("keeps state reserved and resources open until an entered shared replay settles", async () => {
    await configureStorage(new InMemoryStorageFactory());
    const repository = new Repository({ entityType: TaskAggregate, schema: ProjectStateSchema });
    const context = await BoundedContext.singleTenant("EnteredReplayClose").add(repository).build();
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const replay = boundedContextAccess.trackReplay(context, async () => {
      entered.resolve(undefined);
      await release.promise;
    });
    await entered.promise;
    const closing = context.close();
    let settled = false;
    void closing.then(() => {
      settled = true;
    });
    try {
      await Promise.resolve();
      expect(settled).toBe(false);
      await expect(
        BoundedContext.singleTenant("SameStateWhileClosing")
          .add(new Repository({ entityType: TaskAggregate, schema: ProjectStateSchema }))
          .build(),
      ).rejects.toThrow("already registered");
    } finally {
      release.resolve(undefined);
      await Promise.all([replay, closing]);
    }
  });

  it("leaves a newly notified shared row pending while one recipient closes", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const registry = createGeneratedRegistryFixture([aggregateReplayRegistry(ReplayTaskAggregate)]);
    const closingContext = await BoundedContext.singleTenant("ClosingRecipient")
      .withGeneratedRegistryRoot(registry.root)
      .add(ReplayTaskAggregate)
      .build();
    const sibling = await BoundedContext.singleTenant("HealthySibling")
      .add(new Repository({ entityType: TaskProjection, schema: ProjectOverviewStateSchema }))
      .build();
    const durable = serverEnvironmentAccess.coreDelivery(ServerEnvironment.instance());
    const row = await persistDescriptorRow({
      descriptor: internalDeliveryDescriptor(closingContext),
      storageFactory: factory,
      targetTypeUrl: TypeUrls.derive(ProjectStateSchema),
      targetId: "pending-close",
      signalId: "pending-close-command",
      label: "HANDLE_COMMAND",
      signal: AnyPacker.pack(
        CommandSchema,
        createAggregateCommand("pending-close-command", "pending-close"),
      ),
      shard: ShardIndex.single(),
    });
    const release = Promise.withResolvers<undefined>();
    const closeStand = vi.spyOn(Stand.prototype, "close").mockImplementation(() => release.promise);
    const closing = closingContext.close();
    try {
      durable.wake(row.shard);
      await durable.whenIdle();
      expect(
        (await durable.inbox.read(row.shard, { statuses: ["TO_DELIVER"] })).some(
          (message) => message.id.value === row.id.value,
        ),
      ).toBe(true);
      expect(
        await sibling.stand().read(ProjectOverviewStateSchema, "pending-close"),
      ).toBeUndefined();
    } finally {
      release.resolve(undefined);
      await closing;
      closeStand.mockRestore();
      await sibling.close();
    }
  });

  it("keeps a persisted ordinary Inbox row pending when lazy preparation fails", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const registry = createGeneratedRegistryFixture([aggregateReplayRegistry(ReplayTaskAggregate)]);
    const context = await BoundedContext.singleTenant("LazyInboxReplay")
      .withGeneratedRegistryRoot(registry.root)
      .add(ReplayTaskAggregate)
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    const durable = serverEnvironmentAccess.coreDelivery(ServerEnvironment.instance());
    const row = await persistDescriptorRow({
      descriptor: internalDeliveryDescriptor(context),
      storageFactory: factory,
      targetTypeUrl: TypeUrls.derive(ProjectStateSchema),
      targetId: "pending-preparation",
      signalId: "pending-preparation-command",
      label: "HANDLE_COMMAND",
      signal: AnyPacker.pack(
        CommandSchema,
        createAggregateCommand("pending-preparation-command", "pending-preparation"),
      ),
      shard: ShardIndex.single(),
    });
    const failure = new Error("temporary replay preparation failure");
    vi.spyOn(StoragePreparations.for(factory), "prepareEntity").mockRejectedValueOnce(failure);
    try {
      await expect(
        boundedContextAccess.trackReplay(context, () =>
          boundedContextAccess.delivery(context).replay(row, undefined),
        ),
      ).rejects.toBe(failure);
      expect(
        (await durable.inbox.read(row.shard, { statuses: ["TO_DELIVER"] })).some(
          (message) => message.id.value === row.id.value,
        ),
      ).toBe(true);
    } finally {
      await context.close();
      removeGeneratedRegistry(registry);
    }
  });

  it("attempts every bounded-context close and reports aggregate failure", async () => {
    const storageFactory = new ObservingStorageFactory([], [1, 2]);
    await configureStorage(storageFactory);
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: ProjectStateSchema,
    });
    const context = await BoundedContext.singleTenant("Tasks").add(repository).build();

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

  it("waits for an entered Stand close without imposing a context deadline", async () => {
    vi.useFakeTimers();
    const release = Promise.withResolvers<undefined>();
    const closeStand = vi.spyOn(Stand.prototype, "close").mockImplementation(() => release.promise);
    const context = await BoundedContext.singleTenant("Tasks").build();
    try {
      const close = context.close();
      await vi.advanceTimersByTimeAsync(5_001);
      let settled = false;
      void close
        .finally(() => {
          settled = true;
        })
        .catch(() => undefined);
      await Promise.resolve();
      expect(settled).toBe(false);
      release.resolve(undefined);
      await expect(close).resolves.toBeUndefined();
    } finally {
      closeStand.mockRestore();
      vi.useRealTimers();
    }
  });

  it("closes Stand before the registry without an internal tenant-record storage", async () => {
    const order: string[] = [];
    const storageFactory = new OrderedStorageFactory(order);
    await configureStorage(storageFactory);
    const registry = new OrderedFailingRegistry(order);
    const closeStand = vi.spyOn(Stand.prototype, "close").mockImplementation(async function () {
      order.push("stand");
      await Promise.resolve();
      throw new Error("Stand close failed.");
    });
    const context = await BoundedContext.multitenant("Tasks")
      .withSubscriptionRegistry(registry)
      .add(new Repository({ entityType: TaskAggregate, schema: ProjectStateSchema }))
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
    await configureStorage(storageFactory);
    const registry = new OrderedFailingRegistry(order, registryFailure);
    let releaseCommand!: () => void;
    const commandReleased = new Promise<void>((resolve) => {
      releaseCommand = resolve;
    });
    const systemDispatcher = createEventDispatcher([EntityLog.EntityStateChangedSchema], () => {
      order.push("system event dispatched");
    });
    const commandDispatcher = createCommandDispatcher([AssignReviewTaskSchema], async () => {
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
          message: AnyPacker.pack(
            EntityLog.EntityStateChangedSchema,
            create(EntityLog.EntityStateChangedSchema, {
              entity: {
                id: AnyPacker.pack(
                  StringValueSchema,
                  create(StringValueSchema, { value: "task-1" }),
                ),
                typeUrl: TypeUrls.derive(ProjectOverviewStateSchema),
              },
              newState: AnyPacker.pack(
                ProjectOverviewStateSchema,
                create(ProjectOverviewStateSchema, { id: "task-1", name: "Closed", priority: 1 }),
              ),
              signalId: [
                {
                  id: AnyPacker.pack(
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
    const context = await BoundedContext.multitenant("Tasks")
      .withSubscriptionRegistry(registry)
      .addCommandDispatcher(commandDispatcher)
      .addEventDispatcher(systemDispatcher)
      .build();

    try {
      await context.tenantIndex.keep(tenant("tenant-a"));
      const command = context
        .commandBus()
        .post(createProjectionCommand("terminal-command", "task-1", tenant("tenant-a")));
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
      expect(boundedContextAccess.loggerFor(context)).toBeDefined();
    } finally {
      closeStand.mockRestore();
    }
  });

  it("does not expose repository, delivery, gRPC, or transport APIs on BoundedContext", async () => {
    const context = await BoundedContext.singleTenant("Tasks").build();
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

function createProjectionCommand(id: string, targetId = "task-1", tenantId?: TenantId) {
  return create(CommandSchema, {
    id: create(CommandIdSchema, { uuid: id }),
    context: create(CommandContextSchema, {
      actorContext: create(ActorContextSchema, {
        ...(tenantId === undefined ? {} : { tenantId }),
        actor: create(UserIdSchema, { value: "user-1" }),
      }),
    }),
    message: AnyPacker.pack(
      AssignReviewTaskSchema,
      create(AssignReviewTaskSchema, { id: targetId, name: "Task" }),
    ),
  });
}

function createAggregateCommand(id: string, targetId = "task-ready", tenantId?: string) {
  return create(CommandSchema, {
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
    message: AnyPacker.pack(
      AssignReviewTaskSchema,
      create(AssignReviewTaskSchema, { id: targetId, name: "Task Ready" }),
    ),
  });
}

function createScheduleReviewTask(id: string, targetId = "task-ready") {
  return create(CommandSchema, {
    id: create(CommandIdSchema, { uuid: id }),
    context: create(CommandContextSchema, {
      actorContext: create(ActorContextSchema, {
        actor: create(UserIdSchema, { value: "user-1" }),
      }),
    }),
    message: AnyPacker.pack(
      ScheduleReviewTaskSchema,
      create(ScheduleReviewTaskSchema, { id: targetId, name: "Task Ready" }),
    ),
  });
}

function createProjectionEvent(id: string, targetId = "task-1", tenantId?: TenantId) {
  return create(EventSchema, {
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
      producerId: AnyPacker.pack(UserIdSchema, create(UserIdSchema, { value: "aggregate-1" })),
      version: create(VersionSchema, { number: 1 }),
    }),
    message: AnyPacker.pack(
      ReviewTaskAssignedSchema,
      create(ReviewTaskAssignedSchema, { id: targetId, name: "Task" }),
    ),
  });
}

function createReviewTaskAssigned(id: string, targetId = "task-1") {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema),
    message: AnyPacker.pack(
      ReviewTaskAssignedSchema,
      create(ReviewTaskAssignedSchema, { id: targetId, name: "Task" }),
    ),
  });
}

function createGeneratedRegistryFixture(
  receivers: readonly {
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
      readonly input: {
        readonly schema: GenMessage<Message>;
        readonly origin: "domestic" | "external";
      };
      readonly outcomes: {
        readonly returned: readonly GenMessage<Message>[];
        readonly thrown: readonly GenMessage<Message>[];
      };
      readonly parameterCount: 1 | 2;
    }[];
  }[],
): { readonly root: URL; readonly registryPath: string } {
  const slot = `__spineContextGeneratedRegistry_${Math.random().toString(36).slice(2)}`;
  const root = mkdtempSync(join(tmpdir(), "spine-context-generated-registry-"));
  const moduleDir = join(root, "generated/handler");
  const registryPath = join(moduleDir, "generated-handler-registry.js");
  const values = globalThis as Record<string, unknown>;

  mkdirSync(moduleDir, { recursive: true });
  values[slot] = Object.freeze({
    receivers: receivers.map(({ entityType, ...receiver }) =>
      Object.freeze({ receiverKind: "entity" as const, receiverType: entityType, ...receiver }),
    ),
  });
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
  receivers: Parameters<typeof createGeneratedRegistryFixture>[0],
): URL {
  return createGeneratedRegistryFixture(receivers).root;
}

function createStandaloneGeneratedRegistryRoot(receivers: readonly object[]): URL {
  const slot = `__spineStandaloneRegistry_${Math.random().toString(36).slice(2)}`;
  const root = mkdtempSync(join(tmpdir(), "spine-standalone-generated-registry-"));
  const moduleDir = join(root, "generated/handler");
  mkdirSync(moduleDir, { recursive: true });
  (globalThis as Record<string, unknown>)[slot] = Object.freeze({
    receivers: Object.freeze(receivers),
  });
  writeFileSync(
    join(moduleDir, "generated-handler-registry.js"),
    `export const generatedHandlerRegistry = globalThis[${JSON.stringify(slot)}];\n`,
    "utf8",
  );
  return pathToFileURL(root);
}

function standaloneReceiver(
  receiverType: object,
  kind:
    | "command-assignment"
    | "command-substitution"
    | "event-reaction"
    | "event-subscription"
    | "state-subscription",
  methodName: string,
  inputSchema: GenMessage<Message>,
  returnedSchemas: readonly GenMessage<Message>[],
  parameterCount: 1 | 2 = 1,
) {
  return Object.freeze({
    receiverKind: "standalone" as const,
    receiverType,
    handlers: Object.freeze([
      Object.freeze({
        kind,
        methodName,
        input: { schema: inputSchema, origin: "domestic" as const },
        outcomes: { returned: returnedSchemas, thrown: [] },
        parameterCount,
      }),
    ]),
  });
}

function createEntityStateChangedEvent(schema: GenMessage<Message>, state: Message): Event {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: "state-change" }),
    message: AnyPacker.pack(
      EntityLog.EntityStateChangedSchema,
      create(EntityLog.EntityStateChangedSchema, {
        entity: {
          id: AnyPacker.pack(StringValueSchema, create(StringValueSchema, { value: "1" })),
          typeUrl: TypeUrls.derive(schema),
        },
        newState: AnyPacker.pack(schema, state as never),
        signalId: [
          {
            id: AnyPacker.pack(
              StringValueSchema,
              create(StringValueSchema, { value: "state-change" }),
            ),
            typeUrl: TypeUrls.derive(StringValueSchema),
          },
        ],
      }),
    ),
  });
}

function processManagerRegistry(entityType: typeof FreshRecoveryProcessManager) {
  return {
    entityType,
    stateSchema: ProcessManagerStateSchema,
    handlers: [
      {
        kind: "command-assignment" as const,
        methodName: "assignTask",
        input: { schema: AssignReviewTaskSchema, origin: "domestic" as const },
        outcomes: { returned: [ReviewTaskAssignedSchema], thrown: [] },
        parameterCount: 1 as const,
      },
    ],
  };
}

function aggregateReplayRegistry(entityType: typeof ReplayTaskAggregate) {
  return {
    entityType,
    stateSchema: ProjectStateSchema,
    handlers: [
      {
        kind: "command-assignment" as const,
        methodName: "assignTask",
        input: { schema: AssignReviewTaskSchema, origin: "domestic" as const },
        outcomes: { returned: [ReviewStartedSchema], thrown: [] },
        parameterCount: 1 as const,
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
        input: { schema: ScheduleReviewTaskSchema, origin: "domestic" as const },
        outcomes: { returned: [ReviewStartedSchema], thrown: [] },
        parameterCount: 1 as const,
      },
      {
        kind: "event-reaction" as const,
        methodName: "reactToProjection",
        input: { schema: ReviewTaskAssignedSchema, origin: "domestic" as const },
        outcomes: { returned: [ReviewStartedSchema], thrown: [] },
        parameterCount: 1 as const,
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
  const written = await serverEnvironmentAccess
    .coreDelivery(ServerEnvironment.instance())
    .inbox.receive({
      inboxId: {
        targetTypeUrl: input.targetTypeUrl,
        targetId: Identifiers.pack("string", input.targetId),
      },
      signalId: input.signalId,
      label: input.label,
      signal: input.signal,
      shard: input.shard,
      status: "TO_DELIVER",
      whenReceived: timestampFromDate(new Date("2026-08-04T12:00:00.000Z")),
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
