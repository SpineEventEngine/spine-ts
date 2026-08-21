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

import { clone, create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
  StringValueSchema,
  TimestampSchema,
} from "@bufbuild/protobuf/wkt";
import { AnyMessages, TypeUrls } from "@spine-event-engine/core";
import { EventSchema, VersionSchema, file_spine_options } from "@spine-event-engine/proto";
import {
  InMemoryStorageFactory,
  ColumnTypes,
  EventStore,
  RecordColumn,
  RecordStorage,
  type RecordSpec,
  type NormalizedQueryPlan,
  type StorageContext,
} from "@spine-event-engine/storage";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  InMemorySubscriptionRegistry,
  StorageSubscriptionRegistry,
  EventBus,
  Stand,
  StandStateTypeError,
  type StandSubscription,
  type StandSubscriptionEntry,
  type StandSubscriptionRegistry,
  type StandUpdate,
} from "../../src/index.js";
import { SubscriptionIdSchema, SubscriptionSchema } from "@spine-event-engine/proto/client";
import { standAccess } from "../../src/stand/stand.js";
import {
  EntityRecords,
  standEntityStorageDescriptor,
} from "../../src/entity/entity-storage-descriptor.js";
import {
  SubscriptionRuntime,
  subscriptionRuntimeAccess,
} from "../../src/stand/subscription-runtime.js";
import {
  eventBusAccess,
  type EventBus as EventBusType,
  type EventSubscriber,
} from "../../src/bus/event-bus.js";
import * as EntityLog from "@spine-event-engine/proto/generated/spine/system/server/entity_log_events_pb.js";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";
import { tenant } from "../tenant-fixture.js";

const observedEventBusSubscriptions = vi.hoisted(
  () => [] as { readonly closed: boolean; unsubscribe(): void }[],
);
const failNextObserverUnsubscribe = vi.hoisted(() => ({ value: false }));

vi.mock("../../src/bus/event-bus.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/bus/event-bus.js")>();

  return {
    ...actual,
    eventBusAccess: Object.freeze({
      ...actual.eventBusAccess,
      subscribe(eventBus: EventBusType, typeUrl: string, subscriber: EventSubscriber) {
        const subscription = actual.eventBusAccess.subscribe(eventBus, typeUrl, subscriber);
        const observed = Object.freeze({
          get closed() {
            return subscription.closed;
          },
          unsubscribe() {
            subscription.unsubscribe();
            if (failNextObserverUnsubscribe.value) {
              failNextObserverUnsubscribe.value = false;
              throw new Error("Observer unsubscribe failed.");
            }
          },
        });
        observedEventBusSubscriptions.push(observed);
        return observed;
      },
    }),
  };
});

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

type EmptyState = Message<"EmptyState">;

function createFixtureFileDescriptor(descriptorSetBase64: string, imports = [file_spine_options]) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Stand fixture descriptor set is empty.");
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
const fileEntityEmptyFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.empty.descriptorSetBase64,
);
const EmptyStateSchema = messageDesc(fileEntityEmptyFixture, 0) as GenMessage<EmptyState>;

describe("Stand", () => {
  it("keeps subscription lifecycle operations out of the Stand access seam", () => {
    expect("startSubscriptions" in standAccess).toBe(false);
    expect("consumeSubscription" in standAccess).toBe(false);
    expect("reconcileSubscriptions" in standAccess).toBe(false);
  });

  it("rejects invalid access-seam and closed Stand operations", async () => {
    const invalid = {} as Stand;
    expect(() => standAccess.observedState(invalid, "type.spine.io/example.State")).toThrow(
      /Stand instance/,
    );
    expect(() =>
      standAccess.observeState(invalid, {} as never, {} as never, {} as never, () => undefined),
    ).toThrow(/Stand instance/);
    expect(() => standAccess.readCurrent(invalid, ProjectionStateSchema, "task", {})).toThrow(
      /Stand instance/,
    );
    expect(() =>
      standAccess.deferUpdate(invalid, ProjectionStateSchema, createState("task", "First"), {}),
    ).toThrow(/Stand instance/);

    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectionStateSchema);
    expect(standAccess.observedState(stand, undefined)).toBeUndefined();
    await expect(
      standAccess.readCurrent(stand, ProjectionStateSchema, "missing", {}),
    ).resolves.toBeUndefined();
    const deferred = await standAccess.deferUpdate(
      stand,
      ProjectionStateSchema,
      createState("deferred", "Deferred"),
      {},
    );
    deferred.cancel();
    await stand.close();
    expect(() => {
      stand.register(ProjectionStateSchema);
    }).toThrow(/closed/);
  });

  it("does not attach a deleted definition after its snapshot is released", async () => {
    const factory = new InMemoryStorageFactory();
    const stand = new Stand({
      context: { name: "Gated", multitenant: false },
      storageFactory: factory,
    });
    const bus = eventBusAccess.createSystemBus(undefined);
    const registry = new GatedSnapshotRegistry();
    const subscription = create(SubscriptionSchema, {
      id: create(SubscriptionIdSchema, { value: "gated-delete" }),
      topic: {
        id: { value: "updates" },
        target: {
          type: TypeUrls.derive(ProjectionStateSchema),
          criterion: { case: "includeAll", value: true },
        },
      },
    });
    if (subscription.id === undefined) throw new Error("Expected subscription ID.");
    stand.register(ProjectionStateSchema);
    await registry.create(subscription);
    await registry.activate(subscription.id);
    eventBusAccess.registerSchemas(bus, [EntityLog.EntityStateChangedSchema]);
    registry.gateNextSnapshot();
    const runtime = pairedRuntime(stand, factory, registry, bus, bus);
    runtime.start();
    await registry.snapshotStarted;
    await registry.delete(subscription.id);
    registry.releaseSnapshot();
    await runtime.reconcile();
    let delivered = 0;
    await runtime.consume("gated-delete", () => delivered++);
    await postStateChange(bus, ProjectionStateSchema, createState("deleted", "Deleted"));
    expect(delivered).toBe(0);
    await Promise.all([runtime.close(), stand.close(), bus.close()]);
  });

  it("detaches EventBus observers while a reconciliation snapshot is gated during close", async () => {
    observedEventBusSubscriptions.length = 0;
    const factory = new InMemoryStorageFactory();
    const stand = new Stand({
      context: { name: "Closing", multitenant: false },
      storageFactory: factory,
    });
    const bus = eventBusAccess.createSystemBus(undefined);
    const registry = new GatedSnapshotRegistry();
    const subscription = create(SubscriptionSchema, {
      id: create(SubscriptionIdSchema, { value: "gated-close" }),
      topic: {
        id: { value: "updates" },
        target: {
          type: TypeUrls.derive(ProjectionStateSchema),
          criterion: { case: "includeAll", value: true },
        },
      },
    });
    if (subscription.id === undefined) throw new Error("Expected subscription ID.");
    stand.register(ProjectionStateSchema);
    await registry.create(subscription);
    await registry.activate(subscription.id);
    eventBusAccess.registerSchemas(bus, [EntityLog.EntityStateChangedSchema]);
    const runtime = pairedRuntime(stand, factory, registry, bus, bus);
    runtime.start();
    let deliveries = 0;
    await runtime.consume("gated-close", () => deliveries++);
    expect(observedEventBusSubscriptions).toHaveLength(5);
    const observers = [...observedEventBusSubscriptions];
    expect(observers.every((observer) => !observer.closed)).toBe(true);
    await postStateChange(bus, ProjectionStateSchema, createState("before-close", "Before close"));
    expect(deliveries).toBe(1);

    registry.gateNextSnapshot();
    const reconciliation = runtime.reconcile();
    await registry.snapshotStarted;
    const closing = runtime.close();
    registry.releaseSnapshot();
    await reconciliation;
    await closing;
    expect(observers.every((observer) => observer.closed)).toBe(true);
    await postStateChange(bus, ProjectionStateSchema, createState("after-close", "After close"));
    expect(deliveries).toBe(1);
    await expect(bus.close()).resolves.toBeUndefined();
  });

  it("contains failing stream consumers while delivering peers and snapshots the logger", async () => {
    const factory = new InMemoryStorageFactory();
    const stand = new Stand({
      context: { name: "Fanout", multitenant: false },
      storageFactory: factory,
    });
    const bus = eventBusAccess.createSystemBus(undefined);
    const registry = new InMemorySubscriptionRegistry();
    const id = `subscription-secret-${"x".repeat(257)}`;
    const subscription = create(SubscriptionSchema, {
      id: create(SubscriptionIdSchema, { value: id }),
      topic: {
        id: { value: "updates" },
        target: {
          type: TypeUrls.derive(ProjectionStateSchema),
          criterion: { case: "includeAll", value: true },
        },
      },
    });
    if (subscription.id === undefined) throw new Error("Expected subscription ID.");
    stand.register(ProjectionStateSchema);
    await registry.create(subscription);
    await registry.activate(subscription.id);
    eventBusAccess.registerSchemas(bus, [EntityLog.EntityStateChangedSchema]);
    const runtime = pairedRuntime(stand, factory, registry, bus, bus);
    const warn = vi.fn();
    const logger = { withMetadata: vi.fn(() => ({ warn })) };
    subscriptionRuntimeAccess.installLogger(runtime, logger as never);
    runtime.start();
    await runtime.reconcile();
    const deferred = Promise.withResolvers<undefined>();
    let peer = 0;
    await runtime.consume(id, () => {
      throw new Error("consumer secret");
    });
    const deferredConsumer: (update: unknown) => unknown = () => deferred.promise;
    await runtime.consume(id, deferredConsumer);
    await runtime.consume(id, () => {
      peer++;
    });
    await postStateChange(bus, ProjectionStateSchema, createState("fanout", "Fanout"));
    expect(peer).toBe(1);
    expect(logger.withMetadata).toHaveBeenCalledWith({
      operation: "subscription.consumer",
      reasonCode: "failed",
    });
    subscriptionRuntimeAccess.clearLogger(runtime);
    deferred.reject(new Error("late secret"));
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledTimes(2);
    await postStateChange(
      bus,
      ProjectionStateSchema,
      createState("fanout-without-logger", "Fanout"),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(peer).toBe(2);
    expect(warn).toHaveBeenCalledTimes(2);
    await Promise.all([runtime.close(), stand.close(), bus.close()]);
  });

  it("detaches every observer and clears consumers when one observer unsubscribe fails", async () => {
    observedEventBusSubscriptions.length = 0;
    const factory = new InMemoryStorageFactory();
    const stand = new Stand({
      context: { name: "DetachFailures", multitenant: false },
      storageFactory: factory,
    });
    const bus = eventBusAccess.createSystemBus(undefined);
    const registry = new ClosingRegistry(() =>
      observedEventBusSubscriptions.every((observer) => observer.closed),
    );
    stand.register(ProjectionStateSchema);
    eventBusAccess.registerSchemas(bus, [EntityLog.EntityStateChangedSchema]);
    for (const id of ["detach-one", "detach-two"]) {
      const subscription = create(SubscriptionSchema, {
        id: create(SubscriptionIdSchema, { value: id }),
        topic: { id: { value: id }, target: { type: TypeUrls.derive(ProjectionStateSchema) } },
      });
      if (subscription.id === undefined) throw new Error("Expected subscription ID.");
      await registry.create(subscription);
      await registry.activate(subscription.id);
    }
    const runtime = pairedRuntime(stand, factory, registry, bus, bus);
    await runtime.consume("detach-one", () => undefined);
    await runtime.consume("detach-two", () => undefined);
    expect(observedEventBusSubscriptions).toHaveLength(10);
    failNextObserverUnsubscribe.value = true;

    const closing = runtime.close();
    const failure = await closing.catch((error: unknown) => error);
    expect(failure).toMatchObject({ message: "Subscription runtime close failed." });
    expect((failure as AggregateError).errors.map((error: Error) => error.message)).toEqual([
      "Observer unsubscribe failed.",
      "Registry close failed.",
    ]);
    await expect(runtime.close()).rejects.toBe(failure);
    expect(registry.closeCalls).toBe(1);
    await expect(runtime.consume("detach-one", () => undefined)).rejects.toThrow(
      "Subscription runtime is closing.",
    );
    expect(observedEventBusSubscriptions.every((observer) => observer.closed)).toBe(true);
    await Promise.all([stand.close(), bus.close()]);
  });

  it("removes a consumer when its reconciliation cycle fails", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const stand = new Stand({
      context: { name: "Subscriptions", multitenant: false },
      storageFactory,
    });
    const eventBus = eventBusAccess.createSystemBus(undefined);
    const registry = new FailingSnapshotRegistry();
    const subscription = create(SubscriptionSchema, {
      id: create(SubscriptionIdSchema, { value: "failed-consumer" }),
      topic: {
        id: { value: "updates" },
        target: {
          type: TypeUrls.derive(ProjectionStateSchema),
          criterion: { case: "includeAll", value: true },
        },
      },
    });
    if (subscription.id === undefined) throw new Error("Expected subscription ID.");
    stand.register(ProjectionStateSchema);
    await registry.create(subscription);
    await registry.activate(subscription.id);
    eventBusAccess.registerSchemas(eventBus, [EntityLog.EntityStateChangedSchema]);
    const runtime = pairedRuntime(stand, storageFactory, registry, eventBus, eventBus);
    runtime.start();
    await runtime.reconcile();
    registry.failNextSnapshot();
    let failedConsumerDeliveries = 0;
    await expect(
      runtime.consume("failed-consumer", () => {
        failedConsumerDeliveries++;
      }),
    ).rejects.toThrow("snapshot failed");
    let delivered = 0;
    await runtime.consume("failed-consumer", () => {
      delivered++;
    });

    await postStateChange(eventBus, ProjectionStateSchema, createState("one", "Recovered"));

    expect(failedConsumerDeliveries).toBe(0);
    expect(delivered).toBe(1);
    await Promise.all([runtime.close(), stand.close(), eventBus.close()]);
  });

  it("attaches only the exact active subscription identity and sweeps absent snapshots", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const stand = new Stand({
      context: { name: "Subscriptions", multitenant: false },
      storageFactory,
    });
    const eventBus = eventBusAccess.createSystemBus(undefined);
    stand.register(ProjectionStateSchema);
    const registry = new AttachmentIdentityRegistry();
    const subscription = create(SubscriptionSchema, {
      id: create(SubscriptionIdSchema, { value: "s-1" }),
      topic: {
        id: { value: "updates" },
        target: {
          type: TypeUrls.derive(ProjectionStateSchema),
          criterion: { case: "includeAll", value: true },
        },
      },
    });
    const observed: number[] = [];
    if (subscription.id === undefined) throw new Error("Expected subscription ID.");
    await registry.create(subscription);
    await registry.activate(subscription.id);
    eventBusAccess.registerSchemas(eventBus, [EntityLog.EntityStateChangedSchema]);
    const runtime = pairedRuntime(stand, storageFactory, registry, eventBus, eventBus);
    runtime.start();
    await runtime.consume("s-1", () => observed.push(1));

    await postStateChange(eventBus, ProjectionStateSchema, createState("one", "Before fence"));
    expect(observed).toEqual([]);

    registry.allowExactAttachment = true;
    await runtime.reconcile();
    await postStateChange(eventBus, ProjectionStateSchema, createState("two", "After fence"));
    expect(observed).toEqual([1]);

    await registry.delete(subscription.id);
    await runtime.reconcile();
    await postStateChange(eventBus, ProjectionStateSchema, createState("three", "After sweep"));
    expect(observed).toEqual([1]);
    await Promise.all([runtime.close(), stand.close(), eventBus.close()]);
  });

  it("replaces an attachment when canonical subscription content changes in the same millisecond", async () => {
    observedEventBusSubscriptions.length = 0;
    const storageFactory = new InMemoryStorageFactory();
    const stand = new Stand({
      context: { name: "Replacement", multitenant: false },
      storageFactory,
    });
    const bus = eventBusAccess.createSystemBus(undefined);
    const registry = new AttachmentIdentityRegistry();
    const subscription = create(SubscriptionSchema, {
      id: create(SubscriptionIdSchema, { value: "same-millisecond" }),
      topic: {
        id: { value: "first" },
        target: {
          type: TypeUrls.derive(ProjectionStateSchema),
          criterion: { case: "includeAll", value: true },
        },
      },
    });
    if (subscription.id === undefined) throw new Error("Expected subscription ID.");
    stand.register(ProjectionStateSchema);
    eventBusAccess.registerSchemas(bus, [EntityLog.EntityStateChangedSchema]);
    await registry.create(subscription);
    await registry.activate(subscription.id);
    registry.allowExactAttachment = true;
    const runtime = pairedRuntime(stand, storageFactory, registry, bus, bus);
    await runtime.consume("same-millisecond", () => undefined);
    const previous = [...observedEventBusSubscriptions];

    registry.replaceContent = true;
    await runtime.reconcile();

    expect(previous.every((observer) => observer.closed)).toBe(true);
    expect(observedEventBusSubscriptions.length).toBeGreaterThan(previous.length);
    await Promise.all([runtime.close(), stand.close(), bus.close()]);
  });

  it("rediscovers an active durable definition after restart and detaches it on the next poll", async () => {
    vi.useFakeTimers();
    observedEventBusSubscriptions.length = 0;
    const storageFactory = new InMemoryStorageFactory();
    const context = { name: "DurableRestart", multitenant: false } as const;
    const first = new StorageSubscriptionRegistry(context, storageFactory);
    const subscription = create(SubscriptionSchema, {
      id: create(SubscriptionIdSchema, { value: "restart" }),
      topic: {
        id: { value: "updates" },
        target: {
          type: TypeUrls.derive(ProjectionStateSchema),
          criterion: { case: "includeAll", value: true },
        },
      },
    });
    if (subscription.id === undefined) throw new Error("Expected subscription ID.");
    await first.create(subscription);
    await first.activate(subscription.id);
    await first.close();

    const stand = new Stand({ context, storageFactory });
    const bus = eventBusAccess.createSystemBus(undefined);
    stand.register(ProjectionStateSchema);
    eventBusAccess.registerSchemas(bus, [EntityLog.EntityStateChangedSchema]);
    const restarted = new StorageSubscriptionRegistry(context, storageFactory);
    const runtime = pairedRuntime(stand, storageFactory, restarted, bus, bus);
    runtime.start();
    await runtime.consume("restart", () => undefined);
    expect(observedEventBusSubscriptions.some((observer) => !observer.closed)).toBe(true);

    const remote = new StorageSubscriptionRegistry(context, storageFactory);
    await remote.delete(subscription.id);
    await remote.close();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(observedEventBusSubscriptions.every((observer) => observer.closed)).toBe(true);
    await Promise.all([runtime.close(), stand.close(), bus.close()]);
    vi.useRealTimers();
  });

  it("observes one shared definition from both nodes without crossing local buses", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const registry = new InMemorySubscriptionRegistry();
    const first = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    const second = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    const firstBus = eventBusAccess.createSystemBus(undefined);
    const secondBus = eventBusAccess.createSystemBus(undefined);
    first.register(ProjectionStateSchema);
    second.register(ProjectionStateSchema);
    const subscription = create(SubscriptionSchema, {
      id: create(SubscriptionIdSchema, { value: "shared" }),
      topic: {
        id: { value: "updates" },
        target: {
          type: TypeUrls.derive(ProjectionStateSchema),
          criterion: { case: "includeAll", value: true },
        },
      },
    });
    const observed = { first: 0, second: 0 };
    if (subscription.id === undefined) throw new Error("Expected subscription ID.");
    await registry.create(subscription);
    await registry.activate(subscription.id);
    eventBusAccess.registerSchemas(firstBus, [EntityLog.EntityStateChangedSchema]);
    eventBusAccess.registerSchemas(secondBus, [EntityLog.EntityStateChangedSchema]);
    const firstRuntime = pairedRuntime(first, storageFactory, registry, firstBus, firstBus);
    const secondRuntime = pairedRuntime(second, storageFactory, registry, secondBus, secondBus);
    firstRuntime.start();
    secondRuntime.start();
    await firstRuntime.consume("shared", () => observed.first++);
    await secondRuntime.consume("shared", () => observed.second++);

    await postStateChange(firstBus, ProjectionStateSchema, createState("first", "First node"));
    await postStateChange(secondBus, ProjectionStateSchema, createState("second", "Second node"));

    expect(observed).toEqual({ first: 1, second: 1 });
    await Promise.all([
      firstRuntime.close(),
      secondRuntime.close(),
      first.close(),
      second.close(),
      firstBus.close(),
      secondBus.close(),
    ]);
  });

  it("delivers an event target only from the local EventBus on each reconciled node", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const registry = new InMemorySubscriptionRegistry();
    const first = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    const second = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    const firstBus = new EventBus(
      new EventStore({ name: "Tasks", multitenant: false }, storageFactory),
    );
    const secondBus = new EventBus(
      new EventStore({ name: "Tasks", multitenant: false }, storageFactory),
    );
    eventBusAccess.registerSchemas(firstBus, [ProjectionStateSchema]);
    eventBusAccess.registerSchemas(secondBus, [ProjectionStateSchema]);
    const subscription = create(SubscriptionSchema, {
      id: create(SubscriptionIdSchema, { value: "shared-events" }),
      topic: {
        id: { value: "events" },
        target: {
          type: TypeUrls.derive(ProjectionStateSchema),
          criterion: { case: "includeAll", value: true },
        },
      },
    });
    const observed = { first: 0, second: 0 };
    if (subscription.id === undefined) throw new Error("Expected subscription ID.");
    await registry.create(subscription);
    await registry.activate(subscription.id);
    const firstRuntime = pairedRuntime(first, storageFactory, registry, firstBus, firstBus);
    const secondRuntime = pairedRuntime(second, storageFactory, registry, secondBus, secondBus);
    firstRuntime.start();
    secondRuntime.start();
    await firstRuntime.consume("shared-events", () => observed.first++);
    await secondRuntime.consume("shared-events", () => observed.second++);

    await firstBus.post(createSubscriptionEvent("first-event"));
    expect(observed).toEqual({ first: 1, second: 0 });
    await secondBus.post(createSubscriptionEvent("second-event"));
    expect(observed).toEqual({ first: 1, second: 1 });

    await Promise.all([
      firstRuntime.close(),
      secondRuntime.close(),
      first.close(),
      second.close(),
      firstBus.close(),
      secondBus.close(),
    ]);
  });

  it("registers known entity state types and rejects unknown reads and subscriptions", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });

    stand.register(ProjectionStateSchema);
    stand.register(ProjectionStateSchema);

    expect(stand.stateTypes()).toEqual([TypeUrls.derive(ProjectionStateSchema)]);
    await expect(stand.read(AggregateStateSchema, "task-1")).rejects.toThrow(StandStateTypeError);
    expect(() => stand.subscribe(AggregateStateSchema, () => undefined)).toThrow(
      StandStateTypeError,
    );
  });

  it("rejects registration when a schema has no inferred ID field", () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });

    expect(() => {
      stand.register(EmptyStateSchema);
    }).toThrow('Stand state "EmptyState" requires an entity ID field.');
  });

  it("records entity state updates, reads latest state, and notifies subscribers", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const updates: StandUpdate<typeof ProjectionStateSchema>[] = [];
    stand.register(ProjectionStateSchema);
    const subscription = stand.subscribe(ProjectionStateSchema, (update) => {
      updates.push(update);
    });
    const state = create(ProjectionStateSchema, {
      id: "task-1",
      name: "First",
      priority: 1,
    });

    expectTypeOf(subscription).toEqualTypeOf<StandSubscription>();
    await stand.update(ProjectionStateSchema, state, {
      version: create(VersionSchema, { number: 3 }),
    });
    state.name = "mutated outside";

    const stored = await stand.read(ProjectionStateSchema, "task-1");

    expect(stored).toEqual(
      create(ProjectionStateSchema, {
        id: "task-1",
        name: "First",
        priority: 1,
      }),
    );
    expect(stored).not.toBe(state);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.id).toBe("task-1");
    expect(updates[0]?.typeUrl).toBe(TypeUrls.derive(ProjectionStateSchema));
    expect(updates[0]?.version).toEqual(create(VersionSchema, { number: 3 }));
    expect(updates[0]?.state).toEqual(stored);
    expect(updates[0]?.state).not.toBe(stored);
  });

  it("surfaces copy-safe previous state to direct subscribers", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const updates: StandUpdate<typeof ProjectionStateSchema>[] = [];
    stand.register(ProjectionStateSchema);
    stand.subscribe(ProjectionStateSchema, (update) => {
      updates.push(update);
    });

    await stand.update(ProjectionStateSchema, createState("task-1", "First"));
    await stand.update(ProjectionStateSchema, createState("task-1", "Second"));
    const current = await stand.read(ProjectionStateSchema, "task-1");

    expect(updates).toHaveLength(2);
    expect(updates[0]?.previousState).toBeUndefined();
    const second = updates[1];
    if (second?.previousState === undefined) {
      throw new Error("Expected second Stand update with previous state.");
    }
    expect(second.previousState).toEqual(createState("task-1", "First"));
    expect(second.previousState).not.toBe(current);
    second.previousState.name = "Mutated previous";
    second.state.name = "Mutated current";

    await expect(stand.read(ProjectionStateSchema, "task-1")).resolves.toEqual(
      createState("task-1", "Second"),
    );
  });

  it("reads previous state on update only when same-tenant subscribers can observe it", async () => {
    const storageFactory = new CountingReadStorageFactory();
    const stand = new Stand({
      context: { name: "Tasks", multitenant: true },
      storageFactory,
    });
    stand.register(ProjectionStateSchema);
    stand.subscribe(ProjectionStateSchema, () => undefined, { tenantId: tenant("tenant-b") });

    await stand.update(ProjectionStateSchema, createState("task-1", "Tenant A first"), {
      tenantId: tenant("tenant-a"),
    });
    await stand.update(ProjectionStateSchema, createState("task-1", "Tenant A second"), {
      tenantId: tenant("tenant-a"),
    });

    expect(storageFactory.readCount).toBe(0);

    stand.subscribe(ProjectionStateSchema, () => undefined, { tenantId: tenant("tenant-a") });
    await stand.update(ProjectionStateSchema, createState("task-1", "Tenant A third"), {
      tenantId: tenant("tenant-a"),
    });

    expect(storageFactory.readCount).toBe(0);
  });

  it("returns undefined when a known state has no stored entity", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectionStateSchema);

    await expect(stand.read(ProjectionStateSchema, "missing-task")).resolves.toBeUndefined();
  });

  it("reads all stored entity states with their versions in storage order", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectionStateSchema);

    await stand.update(ProjectionStateSchema, createState("task-2", "Second"), {
      version: create(VersionSchema, { number: 2 }),
    });
    await stand.update(ProjectionStateSchema, createState("task-1", "First"), {
      version: create(VersionSchema, { number: 1 }),
    });

    const results = await stand.readAllVersioned(ProjectionStateSchema);

    expect(results).toEqual([
      {
        state: createState("task-1", "First"),
        version: create(VersionSchema, { number: 1 }),
      },
      {
        state: createState("task-2", "Second"),
        version: create(VersionSchema, { number: 2 }),
      },
    ]);
  });

  it("queries stored entity states with storage options and preserves masked versions", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectionStateSchema);

    await stand.update(ProjectionStateSchema, createState("task-1", "Beta"), {
      version: create(VersionSchema, { number: 1 }),
    });
    await stand.update(ProjectionStateSchema, createState("task-2", "Alpha"), {
      version: create(VersionSchema, { number: 2 }),
    });
    await stand.update(ProjectionStateSchema, createState("task-3", "Ignored"), {
      version: create(VersionSchema, { number: 3 }),
    });

    const results = await stand.queryVersioned(ProjectionStateSchema, {
      filters: [{ column: "priority", value: 1 }],
      sort: [{ field: "name", direction: "asc" }],
      limit: 2,
      mask: ["name"],
    });

    expect(results).toEqual([
      {
        state: create(ProjectionStateSchema, { name: "Alpha" }),
        version: create(VersionSchema, { number: 2 }),
      },
      {
        state: create(ProjectionStateSchema, { name: "Beta" }),
        version: create(VersionSchema, { number: 1 }),
      },
    ]);
  });

  it("evaluates system predicates and ordering from durable current metadata", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectionStateSchema);
    await stand.update(ProjectionStateSchema, createState("task-old", "Old"), {
      version: create(VersionSchema, { number: 1 }),
      lifecycle: { archived: false, deleted: false },
    });
    await stand.update(ProjectionStateSchema, createState("task-archived", "Archived"), {
      version: create(VersionSchema, { number: 3 }),
      lifecycle: { archived: true, deleted: false },
    });
    await stand.update(ProjectionStateSchema, createState("task-active", "Active"), {
      version: create(VersionSchema, { number: 2 }),
      lifecycle: { archived: false, deleted: false },
    });

    const plan: NormalizedQueryPlan<unknown> = {
      predicate: {
        kind: "all",
        predicates: [
          {
            kind: "comparison",
            column: "version",
            operator: "greaterOrEqual",
            value: create(VersionSchema, { number: 2 }),
          },
          { kind: "comparison", column: "deleted", operator: "equal", value: false },
        ],
      },
      order: [{ column: "version", direction: "desc" }],
    };

    await expect(stand.queryPlanVersioned(ProjectionStateSchema, plan)).resolves.toEqual([
      {
        state: createState("task-archived", "Archived"),
        version: create(VersionSchema, { number: 3 }),
      },
      {
        state: createState("task-active", "Active"),
        version: create(VersionSchema, { number: 2 }),
      },
    ]);
  });

  it("returns one authoritative current state and version when the query index is stale", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    stand.register(ProjectionStateSchema);
    await stand.update(ProjectionStateSchema, createState("task-stale", "Indexed old"), {
      version: create(VersionSchema, { number: 1 }),
    });
    await writeStandCurrent(storageFactory, createState("task-stale", "Current new"), 9n, {
      archived: true,
      deleted: false,
    });

    await expect(stand.readAllVersioned(ProjectionStateSchema)).resolves.toEqual([
      {
        state: createState("task-stale", "Current new"),
        version: create(VersionSchema, { number: 9 }),
      },
    ]);
  });

  it("clears stored entity states and their version metadata for one registered type", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectionStateSchema);

    await stand.update(ProjectionStateSchema, createState("task-1", "First"), {
      version: create(VersionSchema, { number: 1 }),
    });
    await stand.update(ProjectionStateSchema, createState("task-2", "Second"), {
      version: create(VersionSchema, { number: 2 }),
    });

    await expect(stand.clear(ProjectionStateSchema)).resolves.toBe(2);
    await expect(stand.read(ProjectionStateSchema, "task-1")).resolves.toBeUndefined();
    await expect(stand.read(ProjectionStateSchema, "task-2")).resolves.toBeUndefined();
    await expect(stand.readAllVersioned(ProjectionStateSchema)).resolves.toEqual([]);
  });

  it("returns copy-safe list read results for state and version", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectionStateSchema);

    await stand.update(ProjectionStateSchema, createState("task-1", "First"), {
      version: create(VersionSchema, { number: 7 }),
    });

    const results = await stand.readAllVersioned(ProjectionStateSchema);
    const first = results[0];
    if (first !== undefined) {
      first.state.name = "Mutated";
      if (first.version !== undefined) {
        first.version.number = 99;
      }
    }

    const reread = await stand.readAllVersioned(ProjectionStateSchema);

    expect(reread).toEqual([
      {
        state: createState("task-1", "First"),
        version: create(VersionSchema, { number: 7 }),
      },
    ]);
  });

  it("clears durable version metadata when an update has no version", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectionStateSchema);

    await stand.update(ProjectionStateSchema, createState("task-1", "First"), {
      version: create(VersionSchema, { number: 7 }),
    });
    await stand.update(ProjectionStateSchema, createState("task-1", "Second"));

    await expect(stand.readVersioned(ProjectionStateSchema, "task-1")).resolves.toEqual({
      state: createState("task-1", "Second"),
    });
  });

  it("reads a durable current state without exposing a zero version", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    stand.register(ProjectionStateSchema);
    await writeStandCurrent(storageFactory, createState("task-zero-version", "Current"), 0n, {
      archived: false,
      deleted: false,
    });

    await expect(stand.readVersioned(ProjectionStateSchema, "task-zero-version")).resolves.toEqual({
      state: createState("task-zero-version", "Current"),
    });
  });

  it("keeps deleted durable current records invisible to direct reads", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    stand.register(ProjectionStateSchema);
    await writeStandCurrent(storageFactory, createState("task-deleted-current", "Deleted"), 4n, {
      archived: false,
      deleted: true,
    });

    await expect(
      stand.read(ProjectionStateSchema, "task-deleted-current"),
    ).resolves.toBeUndefined();
    await expect(
      stand.readVersioned(ProjectionStateSchema, "task-deleted-current"),
    ).resolves.toBeUndefined();
  });

  it("always derives updates from the state schema's first ID field", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectionStateSchema);

    await expect(
      stand.update(ProjectionStateSchema, createState("task-1", "First")),
    ).resolves.toBeUndefined();
    await expect(stand.read(ProjectionStateSchema, "task-1")).resolves.toMatchObject({
      id: "task-1",
    });
  });

  it("cleans up subscribers explicitly and deterministically", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    let deliveries = 0;
    stand.register(ProjectionStateSchema);
    const subscription = stand.subscribe(ProjectionStateSchema, () => {
      deliveries += 1;
    });

    await stand.update(ProjectionStateSchema, createState("task-1", "First"));
    subscription.unsubscribe();
    subscription.unsubscribe();
    await stand.update(ProjectionStateSchema, createState("task-1", "Second"));

    expect(subscription.closed).toBe(true);
    expect(deliveries).toBe(1);
  });

  it("keeps direct subscriptions local to one Stand instance", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const firstStand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    const secondStand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    let firstDeliveries = 0;
    let secondDeliveries = 0;
    firstStand.register(ProjectionStateSchema);
    secondStand.register(ProjectionStateSchema);
    firstStand.subscribe(ProjectionStateSchema, () => {
      firstDeliveries += 1;
    });
    secondStand.subscribe(ProjectionStateSchema, () => {
      secondDeliveries += 1;
    });

    await firstStand.update(ProjectionStateSchema, createState("task-1", "First"));

    expect(firstDeliveries).toBe(1);
    expect(secondDeliveries).toBe(0);
  });

  it("restores the durable version through a later Stand instance", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const first = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    first.register(ProjectionStateSchema);
    await first.update(ProjectionStateSchema, createState("task-versioned", "Persisted"), {
      version: create(VersionSchema, {
        number: 9,
        timestamp: create(TimestampSchema, { seconds: 42n, nanos: 7 }),
      }),
    });
    await first.close();

    const restarted = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    restarted.register(ProjectionStateSchema);

    await expect(restarted.readVersioned(ProjectionStateSchema, "task-versioned")).resolves.toEqual(
      {
        state: createState("task-versioned", "Persisted"),
        version: create(VersionSchema, {
          number: 9,
          timestamp: create(TimestampSchema, { seconds: 42n, nanos: 7 }),
        }),
      },
    );
  });

  it("keeps a cleared record unavailable after a later Stand instance opens", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const first = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    first.register(ProjectionStateSchema);
    await first.update(ProjectionStateSchema, createState("task-cleared", "Before clear"), {
      version: create(VersionSchema, { number: 4 }),
    });
    await first.clear(ProjectionStateSchema);
    await first.close();

    const restarted = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    restarted.register(ProjectionStateSchema);

    await expect(
      restarted.readVersioned(ProjectionStateSchema, "task-cleared"),
    ).resolves.toBeUndefined();
  });

  it("delivers to a snapshot when subscribers mutate subscriptions during delivery", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const deliveries: string[] = [];
    const subscriptions: StandSubscription[] = [];
    let lateSubscribed = false;
    stand.register(ProjectionStateSchema);
    stand.subscribe(ProjectionStateSchema, () => {
      deliveries.push("first");
      subscriptions[0]?.unsubscribe();
      if (!lateSubscribed) {
        lateSubscribed = true;
        stand.subscribe(ProjectionStateSchema, () => {
          deliveries.push("late");
        });
      }
    });
    subscriptions.push(
      stand.subscribe(ProjectionStateSchema, () => {
        deliveries.push("second");
      }),
    );

    await stand.update(ProjectionStateSchema, createState("task-1", "First"));
    expect(deliveries).toEqual(["first", "second"]);

    deliveries.length = 0;
    await stand.update(ProjectionStateSchema, createState("task-1", "Second"));
    expect(deliveries).toEqual(["first", "late"]);
  });

  it("does not open a legacy record-storage index for reads and updates", async () => {
    const storageFactory = new ClosingStorageFactory();
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    stand.register(ProjectionStateSchema);

    await stand.update(ProjectionStateSchema, createState("task-1", "First"));
    await stand.read(ProjectionStateSchema, "task-1");

    expect(storageFactory.storages).toHaveLength(0);
  });

  it("reuses one entity-storage handle per scope and closes it on Stand close", async () => {
    const storageFactory = new EntityHandleCountingFactory();
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    stand.register(ProjectionStateSchema);

    await stand.update(ProjectionStateSchema, createState("task-1", "First"));
    await stand.readVersioned(ProjectionStateSchema, "task-1");
    await stand.readAllVersioned(ProjectionStateSchema);

    expect(storageFactory.openedEntityHandles).toBe(1);
    expect(storageFactory.closedEntityHandles).toBe(0);
    await stand.close();
    expect(storageFactory.closedEntityHandles).toBe(1);
  });

  it("releases entity-storage handles after high-cardinality tenant operations", async () => {
    const storageFactory = new EntityHandleCountingFactory();
    const stand = new Stand({
      context: { name: "Tasks", multitenant: true },
      storageFactory,
    });
    stand.register(ProjectionStateSchema);

    for (let index = 0; index < 128; index++) {
      await stand.read(ProjectionStateSchema, "missing", {
        tenantId: tenant(`tenant-${String(index)}`),
      });
    }

    expect(storageFactory.openedEntityHandles).toBe(128);
    expect(storageFactory.closedEntityHandles).toBe(128);
    await stand.close();
    expect(storageFactory.closedEntityHandles).toBe(128);
  });

  it("closes later entity handles when an earlier handle close fails", async () => {
    const storageFactory = new FailingEntityHandleFactory();
    const stand = new Stand({
      context: { name: "Tasks", multitenant: true },
      storageFactory,
    });
    stand.register(ProjectionStateSchema);

    await stand.update(ProjectionStateSchema, createState("first", "First"), {
      tenantId: tenant("one"),
    });
    await stand.update(ProjectionStateSchema, createState("second", "Second"), {
      tenantId: tenant("two"),
    });

    await expect(stand.close()).rejects.toThrow("Stand close failed.");
    expect(storageFactory.closedEntityHandles).toBe(2);
  });

  it("bounds retained diagnostics when every tenant handle close fails", async () => {
    const storageFactory = new AlwaysFailingEntityHandleFactory();
    const stand = new Stand({
      context: { name: "Tasks", multitenant: true },
      storageFactory,
    });
    stand.register(ProjectionStateSchema);

    for (let index = 0; index < 128; index++) {
      await stand.read(ProjectionStateSchema, "missing", {
        tenantId: tenant(`tenant-${String(index)}`),
      });
    }

    const error: unknown = await stand.close().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError)) throw new Error("Expected Stand close to fail.");
    expect(error.message).toBe("Stand close failed.");
    const errors = Array.from(error.errors as Iterable<unknown>);
    expect(errors).toHaveLength(17);
    expect(errors.at(-1)).toMatchObject({
      message: "112 additional entity handle close failures.",
    });
    expect(storageFactory.closedEntityHandles).toBe(128);
  });

  it("does not open a legacy record-storage index for list reads", async () => {
    const storageFactory = new ClosingStorageFactory();
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    stand.register(ProjectionStateSchema);

    await stand.update(ProjectionStateSchema, createState("task-1", "First"));
    await stand.readAllVersioned(ProjectionStateSchema);

    expect(storageFactory.storages).toHaveLength(0);
  });

  it("does not route list reads through a rejecting legacy record-storage index", async () => {
    const storageFactory = new RejectingQueryStorageFactory();
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    stand.register(ProjectionStateSchema);

    await expect(stand.readAllVersioned(ProjectionStateSchema)).resolves.toEqual([]);
    expect(storageFactory.storages).toHaveLength(0);
  });

  it("keeps multitenant state and subscribers isolated by tenant", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: true },
      storageFactory: new InMemoryStorageFactory(),
    });
    const tenantAUpdates: string[] = [];
    const tenantBUpdates: string[] = [];
    stand.register(ProjectionStateSchema);
    stand.subscribe(
      ProjectionStateSchema,
      (update) => {
        tenantAUpdates.push(update.state.name);
      },
      { tenantId: tenant("tenant-a") },
    );
    stand.subscribe(
      ProjectionStateSchema,
      (update) => {
        tenantBUpdates.push(update.state.name);
      },
      { tenantId: tenant("tenant-b") },
    );

    await expect(
      stand.update(ProjectionStateSchema, createState("task-1", "No Tenant")),
    ).rejects.toThrow(/tenantId/);
    await stand.update(ProjectionStateSchema, createState("task-1", "Tenant A"), {
      tenantId: tenant("tenant-a"),
    });
    await stand.update(ProjectionStateSchema, createState("task-1", "Tenant B"), {
      tenantId: tenant("tenant-b"),
    });

    await expect(
      stand.read(ProjectionStateSchema, "task-1", { tenantId: tenant("tenant-a") }),
    ).resolves.toMatchObject({ name: "Tenant A" });
    await expect(
      stand.read(ProjectionStateSchema, "task-1", { tenantId: tenant("tenant-b") }),
    ).resolves.toMatchObject({ name: "Tenant B" });
    expect(tenantAUpdates).toEqual(["Tenant A"]);
    expect(tenantBUpdates).toEqual(["Tenant B"]);
  });

  it("rejects tenant options for single-tenant stands", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectionStateSchema);

    await expect(
      stand.update(ProjectionStateSchema, createState("task-1", "Tenant"), {
        tenantId: tenant("tenant-a"),
      }),
    ).rejects.toThrow(/single-tenant/i);
    await expect(
      stand.read(ProjectionStateSchema, "task-1", { tenantId: tenant("tenant-a") }),
    ).rejects.toThrow(/single-tenant/i);
    expect(() =>
      stand.subscribe(ProjectionStateSchema, () => undefined, { tenantId: tenant("tenant-a") }),
    ).toThrow(/single-tenant/i);
  });

  it("returns cloned updates to each subscriber", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    let firstUpdate: StandUpdate<typeof ProjectionStateSchema> | undefined;
    let secondUpdate: StandUpdate<typeof ProjectionStateSchema> | undefined;
    stand.register(ProjectionStateSchema);
    stand.subscribe(ProjectionStateSchema, (update) => {
      firstUpdate = update;
      update.state.name = "changed by first subscriber";
    });
    stand.subscribe(ProjectionStateSchema, (update) => {
      secondUpdate = update;
    });

    await stand.update(ProjectionStateSchema, createState("task-1", "First"));

    expect(firstUpdate?.state.name).toBe("changed by first subscriber");
    expect(secondUpdate?.state.name).toBe("First");
    expect(secondUpdate?.state).not.toBe(firstUpdate?.state);
    await expect(stand.read(ProjectionStateSchema, "task-1")).resolves.toMatchObject({
      name: "First",
    });
  });

  it("continues delivery when subscribers throw and reports delivery failures", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    let delivered = 0;
    stand.register(ProjectionStateSchema);
    stand.subscribe(ProjectionStateSchema, () => {
      throw new Error("first subscriber failed");
    });
    stand.subscribe(ProjectionStateSchema, () => {
      delivered += 1;
    });

    await expect(
      stand.update(ProjectionStateSchema, createState("task-1", "First")),
    ).rejects.toThrow("first subscriber failed");
    expect(delivered).toBe(1);
    await expect(stand.read(ProjectionStateSchema, "task-1")).resolves.toMatchObject({
      name: "First",
    });
  });

  it("aggregates multiple subscriber delivery failures", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectionStateSchema);
    stand.subscribe(ProjectionStateSchema, () => {
      throw new Error("first subscriber failed");
    });
    stand.subscribe(ProjectionStateSchema, () => {
      throw new Error("second subscriber failed");
    });

    await expect(
      stand.update(ProjectionStateSchema, createState("task-1", "First")),
    ).rejects.toThrow(AggregateError);
  });

  it("uses generated clone APIs for state and version payloads", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const version = create(VersionSchema, { number: 7 });
    const expectedVersion = clone(VersionSchema, version);
    let observed: StandUpdate<typeof ProjectionStateSchema> | undefined;
    stand.register(ProjectionStateSchema);
    stand.subscribe(ProjectionStateSchema, (update) => {
      observed = update;
    });

    await stand.update(ProjectionStateSchema, createState("task-1", "First"), { version });
    version.number = 99;

    expect(observed?.version).toEqual(expectedVersion);
  });
});

function pairedRuntime(
  domainStand: Stand,
  storageFactory: InMemoryStorageFactory,
  registry: StandSubscriptionRegistry,
  domainEventBus: EventBusType,
  systemEventBus: EventBusType,
): SubscriptionRuntime {
  const systemStand = new Stand({
    context: { name: "__spine/System", multitenant: false },
    storageFactory,
  });
  return new SubscriptionRuntime(
    domainStand,
    systemStand,
    domainEventBus,
    systemEventBus,
    registry,
  );
}

function createState(id: string, name: string): ProjectionState {
  return create(ProjectionStateSchema, {
    id,
    name,
    priority: 1,
  });
}

function createSubscriptionEvent(id: string) {
  return create(EventSchema, {
    id: { value: id },
    message: AnyMessages.pack(ProjectionStateSchema, createState(id, "Event payload"), {
      validate: false,
    }),
  });
}

async function postStateChange(
  eventBus: EventBus,
  schema: GenMessage<Message>,
  state: Message,
): Promise<void> {
  await eventBus.post(
    create(EventSchema, {
      id: { value: `state-change-${String((state as { id?: unknown }).id)}` },
      message: AnyMessages.pack(
        EntityLog.EntityStateChangedSchema,
        create(EntityLog.EntityStateChangedSchema, {
          entity: {
            id: AnyMessages.pack(
              StringValueSchema,
              create(StringValueSchema, { value: String((state as { id?: unknown }).id) }),
            ),
            typeUrl: TypeUrls.derive(schema),
          },
          newState: AnyMessages.pack(schema, state, { validate: false }),
          signalId: [
            {
              id: AnyMessages.pack(
                StringValueSchema,
                create(StringValueSchema, { value: "test-signal" }),
              ),
              typeUrl: TypeUrls.derive(StringValueSchema),
            },
          ],
        }),
      ),
    }),
  );
}

async function writeStandCurrent(
  factory: InMemoryStorageFactory,
  state: ProjectionState,
  version: bigint,
  lifecycle: { readonly archived: boolean; readonly deleted: boolean },
): Promise<void> {
  const input = standEntityStorageDescriptor(
    { name: "Tasks", multitenant: false },
    ProjectionStateSchema,
    ProjectionStateSchema.fields.map(
      (field) =>
        new RecordColumn(
          field.localName,
          ColumnTypes.fromField(field),
          (record) => (record as Record<string, unknown>)[field.localName],
        ),
    ),
  );
  const storage = factory.createEntityStorage(input) as {
    readonly current: {
      write(record: Message): Promise<void>;
    };
    close(): void;
  };

  try {
    await storage.current.write(
      EntityRecords.pack(ProjectionStateSchema, state.id, state, version, lifecycle),
    );
  } finally {
    storage.close();
  }
}

class ClosingStorageFactory extends InMemoryStorageFactory {
  readonly storages: RecordStorage<unknown, Message>[] = [];

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    const storage = super.onCreateRecordStorage(context, recordSpec);
    this.storages.push(storage as unknown as RecordStorage<unknown, Message>);
    return storage;
  }
}

class RejectingQueryStorageFactory extends ClosingStorageFactory {
  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    const storage = super.onCreateRecordStorage(context, recordSpec);
    storage.query = async () => Promise.reject(new Error("query failed"));
    storage.queryEntries = async () => Promise.reject(new Error("query failed"));
    return storage;
  }
}

class CountingReadStorageFactory extends InMemoryStorageFactory {
  readCount = 0;

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    const storage = super.onCreateRecordStorage(context, recordSpec);
    const read = storage.read.bind(storage);
    storage.read = async (...args: Parameters<typeof storage.read>) => {
      this.readCount += 1;
      return read(...args);
    };

    return storage;
  }
}

class AttachmentIdentityRegistry extends InMemorySubscriptionRegistry {
  allowExactAttachment = false;
  replaceContent = false;

  override async get(id: Parameters<InMemorySubscriptionRegistry["get"]>[0]) {
    const entry = await super.get(id);
    if (entry === undefined || this.replaceContent || this.allowExactAttachment)
      return this.replaceContent ? this.#replacement(entry) : entry;
    return Object.freeze({
      ...entry,
      createdAt: entry.createdAt + 1,
    });
  }

  override async snapshot(): Promise<readonly StandSubscriptionEntry[]> {
    const entries = await super.snapshot();
    return this.replaceContent ? entries.map((entry) => this.#replacement(entry)) : entries;
  }

  #replacement(entry: StandSubscriptionEntry): StandSubscriptionEntry;
  #replacement(entry: undefined): undefined;
  #replacement(entry: StandSubscriptionEntry | undefined): StandSubscriptionEntry | undefined;
  #replacement(entry: StandSubscriptionEntry | undefined): StandSubscriptionEntry | undefined {
    if (entry === undefined) return undefined;
    const subscription = clone(SubscriptionSchema, entry.subscription);
    if (subscription.topic?.id !== undefined) subscription.topic.id.value = "replacement";
    return Object.freeze({ ...entry, subscription });
  }
}

class FailingSnapshotRegistry extends InMemorySubscriptionRegistry {
  #fail = false;

  failNextSnapshot(): void {
    this.#fail = true;
  }

  override async snapshot() {
    if (this.#fail) {
      this.#fail = false;
      throw new Error("snapshot failed");
    }
    return await super.snapshot();
  }
}

class GatedSnapshotRegistry extends InMemorySubscriptionRegistry {
  #gate = false;
  #release: (() => void) | undefined;
  #started: (() => void) | undefined;
  readonly snapshotStarted = new Promise<void>((resolve) => {
    this.#started = resolve;
  });

  gateNextSnapshot(): void {
    this.#gate = true;
  }

  releaseSnapshot(): void {
    this.#release?.();
  }

  override async snapshot() {
    const result = await super.snapshot();
    if (this.#gate) {
      this.#gate = false;
      this.#started?.();
      await new Promise<void>((resolve) => {
        this.#release = resolve;
      });
    }
    return result;
  }
}

class ClosingRegistry extends InMemorySubscriptionRegistry {
  closeCalls = 0;

  constructor(private readonly observersDetached: () => boolean) {
    super();
  }

  override async close(): Promise<void> {
    this.closeCalls++;
    if (!this.observersDetached()) throw new Error("Registry closed before observer detach.");
    await super.close();
    throw new Error("Registry close failed.");
  }
}

class EntityHandleCountingFactory extends InMemoryStorageFactory {
  openedEntityHandles = 0;
  closedEntityHandles = 0;

  override createEntityStorage(input: unknown): unknown {
    const handle = super.createEntityStorage(input) as { close(): void } & Record<string, unknown>;
    this.openedEntityHandles++;
    const close = handle.close.bind(handle);
    return Object.freeze({
      ...handle,
      close: () => {
        this.closedEntityHandles++;
        close();
      },
    });
  }
}

class FailingEntityHandleFactory extends EntityHandleCountingFactory {
  #failed = false;

  override createEntityStorage(input: unknown): unknown {
    const handle = super.createEntityStorage(input) as { close(): void } & Record<string, unknown>;
    const close = handle.close.bind(handle);
    return Object.freeze({
      ...handle,
      close: () => {
        close();
        if (!this.#failed) {
          this.#failed = true;
          throw new Error("Entity handle close failed.");
        }
      },
    });
  }
}

class AlwaysFailingEntityHandleFactory extends EntityHandleCountingFactory {
  override createEntityStorage(input: unknown): unknown {
    const handle = super.createEntityStorage(input) as { close(): void } & Record<string, unknown>;
    const close = handle.close.bind(handle);
    return Object.freeze({
      ...handle,
      close: () => {
        close();
        throw new Error("Entity handle close failed.");
      },
    });
  }
}
