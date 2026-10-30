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

import { create, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { StringValueSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AnyPacker, Identifiers, type MessageSchema } from "@spine-event-engine/core";
import { TypeUrls } from "@spine-event-engine/core";
import {
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  type Event,
  type EventContext,
  BoundedContextNameSchema,
  ChannelIdSchema,
  ExternalEventsWantedSchema,
  ExternalMessageSchema,
  TenantIdSchema,
  VersionSchema,
} from "@spine-event-engine/proto";
import {
  AbstractEventSubscriber,
  BoundedContext,
  EnvironmentType,
  EventRouting,
  Projection,
  ServerEnvironment,
} from "@spine-event-engine/server";
import { resetServerEnvironmentForTest } from "@spine-event-engine/server/testing";
import {
  registerSpineMetadata,
  type SpineMetadata,
} from "@spine-event-engine/server/spi/handler-registry";
import { spineMetadataTestAccess } from "../../dist/handler/spine-metadata-inventory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadWave13Contract,
  RecordingTransportFactory,
  requireContractMember,
} from "./wave13-red-support.js";
import { Wave13OriginStateSchema } from "./wave13-origin-repository.js";
import {
  ReviewStartedSchema,
  ReviewTaskAssignedSchema,
  ReviewFollowUpScheduledSchema,
} from "../../test-fixtures/generated/handler-registry/events_pb.js";

type ReviewTaskAssigned = Message<"ReviewTaskAssigned"> & { id: string; name: string };
class ReviewTaskAssignedOriginProjection extends Projection<
  string,
  typeof Wave13OriginStateSchema
> {
  static externalContexts: EventContext[] = [];

  static reset(): void {
    this.externalContexts = [];
  }

  onExternal(event: ReviewTaskAssigned, context: EventContext): void {
    ReviewTaskAssignedOriginProjection.externalContexts.push(context);
    this.update((draft) =>
      Object.assign(
        draft,
        create(Wave13OriginStateSchema, {
          id: event.id,
          name: `external:${event.id}`,
          priority: 1,
        }),
      ),
    );
  }
}

const taskEventOriginRouting = EventRouting.create<string>().route(
  ReviewTaskAssignedSchema,
  (event) => [event.id],
);

const brokerModule = new URL("../../src/integration/integration-broker.js", import.meta.url).href;
const external = (schemas: readonly MessageSchema[], received: unknown[]) => ({
  messageSchemas: () => schemas,
  externalEventSchemas: () => schemas,
  dispatch: (event: Event) => Promise.resolve(received.push(event)).then(() => undefined),
});
const domestic = (schemas: readonly MessageSchema[], received: unknown[] = []) => ({
  messageSchemas: () => schemas,
  dispatch: (event: Event) => Promise.resolve(received.push(event)).then(() => undefined),
});
function event(
  schema?: typeof ReviewTaskAssignedSchema,
  id?: string,
  tenantId?: string,
): ReturnType<typeof taskEvent>;
function event(
  schema: typeof ReviewStartedSchema,
  id?: string,
  tenantId?: string,
): ReturnType<typeof reviewStartedEvent>;
function event(
  schema: typeof ReviewTaskAssignedSchema | typeof ReviewStartedSchema = ReviewTaskAssignedSchema,
  id = "wave13-event",
  tenantId?: string,
) {
  return schema === ReviewStartedSchema
    ? reviewStartedEvent(id, tenantId)
    : taskEvent(id, tenantId);
}
function eventContext(tenantId?: string) {
  return create(EventContextSchema, {
    producerId: Identifiers.pack("string", "review-task-1"),
    version: create(VersionSchema, { number: 1 }),
    ...(tenantId === undefined
      ? {}
      : {
          origin: {
            case: "importContext",
            value: {
              tenantId: create(TenantIdSchema, { kind: { case: "value", value: tenantId } }),
            },
          },
        }),
  });
}
function taskEvent(id: string, tenantId?: string) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    context: eventContext(tenantId),
    message: AnyPacker.pack(
      ReviewTaskAssignedSchema,
      create(ReviewTaskAssignedSchema, { id, name: id }),
    ),
  });
}
function reviewStartedEvent(id: string, tenantId?: string) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    context: eventContext(tenantId),
    message: AnyPacker.pack(ReviewStartedSchema, create(ReviewStartedSchema, { id })),
  });
}
async function broker(behavior: string) {
  return requireContractMember(
    await loadWave13Contract(brokerModule),
    "IntegrationBroker",
    behavior,
  );
}
async function close(...contexts: BoundedContext[]) {
  await Promise.all(contexts.map((context) => context.close()));
}

function createStandaloneGeneratedRegistryRoot(receivers: readonly object[]): SpineMetadata {
  const metadata = { receivers } as SpineMetadata;
  registerSpineMetadata(metadata, "integration-broker-fixture");
  return metadata;
}

function createEntityGeneratedRegistryRoot(
  receivers: readonly {
    readonly entityType: object;
    readonly stateSchema: GenMessage<Message>;
    readonly handlers: readonly object[];
  }[],
): SpineMetadata {
  return createStandaloneGeneratedRegistryRoot(
    receivers.map(({ entityType, ...receiver }) => ({
      receiverKind: "entity" as const,
      receiverType: entityType,
      ...receiver,
    })),
  );
}

describe("Wave 13 IntegrationBroker", () => {
  beforeEach(async () => {
    spineMetadataTestAccess.clear();
    await resetServerEnvironmentForTest();
  });
  afterEach(async () => resetServerEnvironmentForTest());
  it("RED-01 delivers one requested domestic event once between two same-process contexts", async () => {
    await broker("one producer / one consumer delivery");
    await ServerEnvironment.instance().completeSetup();
    const seen: unknown[] = [];
    const consumer = await BoundedContext.singleTenant("Red01Consumer")
      .addEventDispatcher(external([ReviewTaskAssignedSchema], seen))
      .build();
    const producer = await BoundedContext.singleTenant("Red01Producer")
      .addEventDispatcher(domestic([ReviewTaskAssignedSchema]))
      .build();
    try {
      const original = event();
      await producer.eventBus().post(original);
      expect(seen).toEqual([expect.objectContaining({ id: original.id })]);
    } finally {
      await close(producer, consumer);
    }
  });
  it("advertises and delivers a standalone external Event through the context broker", async () => {
    await broker("standalone external Event interest and imported delivery");
    const factory = new RecordingTransportFactory();
    ServerEnvironment.when(EnvironmentType.Local).use({ integrationChannelFactory: factory });
    await ServerEnvironment.instance().completeSetup();
    class ExternalSubscriber extends AbstractEventSubscriber {
      calls = 0;
      subscribe(): void {
        this.calls += 1;
      }
    }
    const subscriber = new ExternalSubscriber();
    createStandaloneGeneratedRegistryRoot([
      {
        receiverKind: "standalone",
        receiverType: ExternalSubscriber,
        handlers: [
          {
            kind: "event-subscription",
            methodName: "subscribe",
            input: { schema: ReviewTaskAssignedSchema, origin: "external" },
            outcomes: { returned: [], thrown: [] },
            parameterCount: 1,
          },
        ],
      },
    ]);
    const consumer = await BoundedContext.singleTenant("StandaloneExternalConsumer")
      .addEventDispatcher(subscriber)
      .build();
    const producer = await BoundedContext.singleTenant("StandaloneExternalProducer")
      .addEventDispatcher(domestic([ReviewTaskAssignedSchema]))
      .build();
    try {
      await producer.eventBus().post(event(ReviewTaskAssignedSchema, "standalone-external"));
      expect(subscriber.calls).toBe(1);
      const wanted = await decodeWantedFrames(factory, "StandaloneExternalConsumer");
      expect(wanted.flatMap(({ message }) => wantedTypeUrls(message))).toContain(
        TypeUrls.derive(ReviewTaskAssignedSchema),
      );
    } finally {
      await close(producer, consumer);
      await ServerEnvironment.instance().close();
    }
  });
  it("RED-02 fans one producer event out to every requesting consumer", async () => {
    await broker("many-consumer complete-event fan-out");
    await ServerEnvironment.instance().completeSetup();
    const first: unknown[] = [],
      second: unknown[] = [];
    const producer = await BoundedContext.singleTenant("Red02Producer")
      .addEventDispatcher(domestic([ReviewTaskAssignedSchema]))
      .build();
    const one = await BoundedContext.singleTenant("Red02One")
      .addEventDispatcher(external([ReviewTaskAssignedSchema], first))
      .build();
    const two = await BoundedContext.singleTenant("Red02Two")
      .addEventDispatcher(external([ReviewTaskAssignedSchema], second))
      .build();
    try {
      await producer.eventBus().post(event());
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
    } finally {
      await close(producer, one, two);
    }
  });
  it("RED-05 does not export an unrequested domestic event", async () => {
    await broker("wanted-type-only domestic publication");
    await ServerEnvironment.instance().completeSetup();
    const seen: unknown[] = [];
    const consumer = await BoundedContext.singleTenant("Red05Consumer")
      .addEventDispatcher(external([ReviewTaskAssignedSchema], seen))
      .build();
    const producer = await BoundedContext.singleTenant("Red05Producer")
      .addEventDispatcher(domestic([ReviewTaskAssignedSchema, ReviewStartedSchema]))
      .build();
    try {
      await producer.eventBus().post(event(ReviewStartedSchema, "unwanted"));
      await producer.eventBus().post(event(ReviewTaskAssignedSchema, "wanted"));
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ id: { value: "wanted" } });
    } finally {
      await close(producer, consumer);
    }
  });
  it("RED-06 does not republish imported events in a bidirectional cycle", async () => {
    await broker("origin-only loop prevention");
    const factory = new RecordingTransportFactory();
    ServerEnvironment.when(EnvironmentType.Local).use({ integrationChannelFactory: factory });
    await ServerEnvironment.instance().completeSetup();
    const a: unknown[] = [],
      b: unknown[] = [];
    const left = await BoundedContext.singleTenant("Red06A")
      .addEventDispatcher(domestic([ReviewTaskAssignedSchema]))
      .addEventDispatcher(external([ReviewStartedSchema], a))
      .build();
    const right = await BoundedContext.singleTenant("Red06B")
      .addEventDispatcher(domestic([ReviewStartedSchema]))
      .addEventDispatcher(external([ReviewTaskAssignedSchema], b))
      .build();
    try {
      await left.eventBus().post(event(ReviewTaskAssignedSchema, "a"));
      await right.eventBus().post(event(ReviewStartedSchema, "b"));
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ id: { value: "b" } });
      expect(b).toHaveLength(1);
      expect(b[0]).toMatchObject({ id: { value: "a" } });
      expect(
        factory.published.filter(({ channel }) =>
          [
            TypeUrls.derive(ReviewTaskAssignedSchema),
            TypeUrls.derive(ReviewStartedSchema),
          ].includes((channel as { targetType?: string }).targetType ?? ""),
        ),
      ).toHaveLength(2);
    } finally {
      await close(left, right);
    }
  });
  it("RED-07 installs one publisher on the first requester and serializes complete-set replacement", async () => {
    await broker("first request and replacement");
    const factory = new RecordingTransportFactory();
    ServerEnvironment.when(EnvironmentType.Local).use({ integrationChannelFactory: factory });
    await ServerEnvironment.instance().completeSetup();
    const producer = await BoundedContext.singleTenant(`Red07${crypto.randomUUID()}`)
      .addEventDispatcher(domestic([ReviewTaskAssignedSchema, ReviewStartedSchema]))
      .build();
    try {
      await publishWanted(factory, "Red07Peer", [ReviewTaskAssignedSchema]);
      const initialConfigCount = configPublications(factory).length;
      const duplicate = publishWanted(factory, "Red07Peer", [ReviewTaskAssignedSchema]);
      await waitForConfigPublications(factory, initialConfigCount + 1);
      const expansion = publishWanted(factory, "Red07Peer", [
        ReviewTaskAssignedSchema,
        ReviewStartedSchema,
      ]);
      await waitForConfigPublications(factory, initialConfigCount + 2);
      const replacement = publishWanted(factory, "Red07Peer", [ReviewStartedSchema]);
      await Promise.all([duplicate, expansion, replacement]);
      const before = eventPublications(factory).length;
      await producer.eventBus().post(event(ReviewTaskAssignedSchema, "replaced"));
      await producer.eventBus().post(event(ReviewStartedSchema, "final"));
      expect(eventPublications(factory).slice(before)).toHaveLength(1);
      expect(eventPublications(factory)[before]).toMatchObject({
        channel: { targetType: TypeUrls.derive(ReviewStartedSchema) },
      });
      expect(eventPublisherCreations(factory, ReviewTaskAssignedSchema)).toHaveLength(1);
      expect(eventPublisherCreations(factory, ReviewStartedSchema)).toHaveLength(1);
    } finally {
      await producer.close();
      await ServerEnvironment.instance().close();
    }
  });
  it("RED-08 retains publication while another requester still wants the type", async () => {
    await broker("per-origin wanted references");
    const factory = new RecordingTransportFactory();
    ServerEnvironment.when(EnvironmentType.Local).use({ integrationChannelFactory: factory });
    await ServerEnvironment.instance().completeSetup();
    const producer = await BoundedContext.singleTenant(`Red08${crypto.randomUUID()}`)
      .addEventDispatcher(domestic([ReviewTaskAssignedSchema]))
      .build();
    try {
      await publishWanted(factory, "Red08First", [ReviewTaskAssignedSchema]);
      await publishWanted(factory, "Red08Second", [ReviewTaskAssignedSchema]);
      await publishWanted(factory, "Red08First", []);
      const before = eventPublications(factory).length;
      await producer.eventBus().post(event(ReviewTaskAssignedSchema, "retained"));
      expect(eventPublications(factory)).toHaveLength(before + 1);
      expect(eventPublisherCreations(factory, ReviewTaskAssignedSchema)).toHaveLength(1);
    } finally {
      await producer.close();
      await ServerEnvironment.instance().close();
    }
  });
  // prettier-ignore
  it(
    "RED-09 removes publication after the final requester withdraws without losing the prior set on failure",
    async () => {
    await broker("last withdrawal rollback");
    await assertFailedReplacementKeepsPriorWantedSet();
  });
  it("RED-10 suppresses an unchanged complete wanted-event set", async () => {
    await broker("unchanged complete-set suppression");
    const factory = new RecordingTransportFactory();
    ServerEnvironment.when(EnvironmentType.Local).use({ integrationChannelFactory: factory });
    await ServerEnvironment.instance().completeSetup();
    const context = await BoundedContext.singleTenant(`Red10${crypto.randomUUID()}`)
      .addEventDispatcher(external([ReviewTaskAssignedSchema], []))
      .addEventDispatcher(external([ReviewTaskAssignedSchema], []))
      .build();
    try {
      expect(await decodeWantedFrames(factory)).toHaveLength(1);
    } finally {
      await context.close();
      await ServerEnvironment.instance().close();
    }
  });
  it("RED-11 rebroadcasts an unchanged wanted-event set after a peer comes online", async () => {
    await broker("online forces complete-set resend");
    await assertWantedLifecycle({
      requesters: 1,
      peerOnline: true,
      expectedPublishers: 1,
      expectedWantedFrames: 2,
    });
  });
  it("RED-12 publishes an empty wanted set before consumer teardown", async () => {
    await broker("close withdrawal ordering");
    await assertWantedLifecycle({
      requesters: 1,
      closeFirst: true,
      expectedPublishers: 1,
      expectedWantedFrames: 2,
      assertCloseOrder: true,
    });
  });
  it("RED-13 preserves per-producer order, complete Event bytes, and EventId", async () => {
    await broker("full Event identity and order");
    await ServerEnvironment.instance().completeSetup();
    const seen: unknown[] = [];
    const c = await BoundedContext.singleTenant("Red13C")
      .addEventDispatcher(external([ReviewTaskAssignedSchema], seen))
      .build();
    const p = await BoundedContext.singleTenant("Red13P")
      .addEventDispatcher(domestic([ReviewTaskAssignedSchema]))
      .build();
    try {
      const one = event(ReviewTaskAssignedSchema, "one"),
        two = event(ReviewTaskAssignedSchema, "two");
      await p.eventBus().post(one);
      await p.eventBus().post(two);
      expect(seen).toEqual([
        expect.objectContaining({ id: one.id }),
        expect.objectContaining({ id: two.id }),
      ]);
    } finally {
      await close(p, c);
    }
  });
  it("retains an entity state schema in passive metadata", () => {
    const metadata = createEntityGeneratedRegistryRoot([
      {
        entityType: ReviewTaskAssignedOriginProjection,
        stateSchema: Wave13OriginStateSchema,
        handlers: [],
      },
    ]);

    expect(metadata.receivers[0]).toMatchObject({ stateSchema: Wave13OriginStateSchema });
  });
  it("RED-15 validates the existing tenant boundary and isolates imported tenants", async () => {
    await broker("tenant-aware imported intake");
    await ServerEnvironment.instance().completeSetup();
    createEntityGeneratedRegistryRoot([
      {
        entityType: ReviewTaskAssignedOriginProjection,
        stateSchema: Wave13OriginStateSchema,
        handlers: [
          {
            kind: "event-subscription",
            methodName: "onExternal",
            input: { schema: ReviewTaskAssignedSchema, origin: "external" },
            outcomes: { returned: [], thrown: [] },
            parameterCount: 2,
          },
        ],
      },
    ]);
    ReviewTaskAssignedOriginProjection.reset();
    const c = await BoundedContext.multitenant("Red15")
      .add(ReviewTaskAssignedOriginProjection, { eventRouting: taskEventOriginRouting })
      .build();
    const p = await BoundedContext.multitenant("Red15P")
      .addEventDispatcher(domestic([ReviewTaskAssignedSchema]))
      .build();
    const tenantA = create(TenantIdSchema, { kind: { case: "value", value: "tenant-a" } });
    const tenantB = create(TenantIdSchema, { kind: { case: "value", value: "tenant-b" } });
    try {
      await p.tenantIndex.keep(tenantA);
      await p.tenantIndex.keep(tenantB);
      await c.tenantIndex.keep(tenantA);
      await c.tenantIndex.keep(tenantB);
      await p.eventBus().post(event(ReviewTaskAssignedSchema, "a", "tenant-a"));
      await p.eventBus().post(event(ReviewTaskAssignedSchema, "b", "tenant-b"));
      expect(ReviewTaskAssignedOriginProjection.externalContexts.map(tenantValue)).toEqual([
        "tenant-a",
        "tenant-b",
      ]);
      await expect(
        c.stand().read(Wave13OriginStateSchema, "a", { tenantId: tenantA }),
      ).resolves.toMatchObject({ name: "external:a" });
      await expect(
        c.stand().read(Wave13OriginStateSchema, "b", { tenantId: tenantB }),
      ).resolves.toMatchObject({ name: "external:b" });
      await expect(
        c.stand().read(Wave13OriginStateSchema, "a", { tenantId: tenantB }),
      ).resolves.toBeUndefined();
      await expect(p.eventBus().post(event(ReviewTaskAssignedSchema, "missing"))).rejects.toThrow(
        /tenant/u,
      );
      const single = await BoundedContext.singleTenant("Red15Single")
        .addEventDispatcher(external([ReviewTaskAssignedSchema], []))
        .build();
      const forbidden = await BoundedContext.singleTenant("Red15Forbidden")
        .addEventDispatcher(domestic([ReviewTaskAssignedSchema]))
        .build();
      await expect(
        forbidden.eventBus().post(event(ReviewTaskAssignedSchema, "forbidden", "tenant-a")),
      ).rejects.toThrow(/tenant/u);
      await close(forbidden, single);
    } finally {
      await close(p, c);
    }
  });
  it("RED-16 changes only EventContext.external before posting through the normal EventBus", async () => {
    await broker("normal EventBus import with system/self filtering");
    const factory = new RecordingTransportFactory();
    ServerEnvironment.when(EnvironmentType.Local).use({ integrationChannelFactory: factory });
    await ServerEnvironment.instance().completeSetup();
    const seen: unknown[] = [];
    const c = await BoundedContext.singleTenant("Red16C")
      .addEventDispatcher(external([ReviewTaskAssignedSchema], seen))
      .build();
    const p = await BoundedContext.singleTenant("Red16P")
      .addEventDispatcher(domestic([ReviewTaskAssignedSchema]))
      .build();
    try {
      const original = create(EventSchema, {
        id: create(EventIdSchema, { value: "red16-preserved" }),
        context: create(EventContextSchema, {
          timestamp: create(TimestampSchema, { seconds: 1_725_000_000n, nanos: 123_000_000 }),
          producerId: AnyPacker.pack(
            StringValueSchema,
            create(StringValueSchema, { value: "red16-producer" }),
          ),
          version: create(VersionSchema, {
            number: 7,
            timestamp: create(TimestampSchema, { seconds: 1_725_000_001n }),
          }),
        }),
        message: AnyPacker.pack(
          ReviewTaskAssignedSchema,
          create(ReviewTaskAssignedSchema, { id: "preserved", name: "preserved" }),
        ),
      });
      await p.eventBus().post(original);
      expect(seen).toEqual([
        expect.objectContaining({
          id: original.id,
          context: { ...original.context, external: true },
        }),
      ]);
      const beforeIgnored = seen.length;
      await publishExternalEvent(factory, original, "Red16C");
      await publishExternalEvent(factory, original, "Red16C_System");
      expect(seen).toHaveLength(beforeIgnored);
    } finally {
      await close(p, c);
      await ServerEnvironment.instance().close();
    }
  });
});

async function assertWantedLifecycle(options: {
  readonly requesters: number;
  readonly closeFirst?: boolean;
  readonly peerOnline?: boolean;
  readonly expectedPublishers: number;
  readonly expectedWantedFrames: number;
  readonly assertCloseOrder?: boolean;
  readonly assertNoPublicationAfterWithdrawal?: boolean;
}): Promise<void> {
  const factory = new RecordingTransportFactory();
  ServerEnvironment.when(EnvironmentType.Local).use({ integrationChannelFactory: factory });
  await ServerEnvironment.instance().completeSetup();
  const producer = await BoundedContext.singleTenant(`WantedProducer${crypto.randomUUID()}`)
    .addEventDispatcher(domestic([ReviewTaskAssignedSchema, ReviewStartedSchema]))
    .build();
  // RED-07 exercises producer-before-consumer; the peer-online branch creates
  // a consumer before its producer to retain the reverse construction order.
  const consumers = await Promise.all(
    Array.from({ length: options.requesters }, (_, index) =>
      BoundedContext.singleTenant(`WantedConsumer${String(index)}${crypto.randomUUID()}`)
        .addEventDispatcher(external([ReviewTaskAssignedSchema], []) as never)
        .build(),
    ),
  );
  let peer: BoundedContext | undefined;
  try {
    if (options.peerOnline)
      peer = await BoundedContext.singleTenant(`WantedPeer${crypto.randomUUID()}`).build();
    if (options.closeFirst) await required(consumers[0], "first consumer").close();

    const eventPublicationsBefore = eventPublications(factory).length;
    if (options.closeFirst)
      await producer.eventBus().post(event(ReviewTaskAssignedSchema, "after-close"));

    const wantedFrames = await decodeWantedFrames(factory, "WantedConsumer");
    expect(wantedFrames).toHaveLength(options.expectedWantedFrames);
    expect(
      factory.created.filter(
        (entry) => entry.kind === "publisher" && isEventChannel(entry.channel),
      ),
    ).toHaveLength(options.expectedPublishers);
    expect(wantedFrames.map((entry) => wantedTypeUrls(entry.message))).toEqual(
      expect.arrayContaining([expect.arrayContaining([TypeUrls.derive(ReviewTaskAssignedSchema)])]),
    );
    if (options.assertCloseOrder) {
      const emptyWithdrawal = required(wantedFrames.at(-1), "final wanted frame");
      expect(wantedTypeUrls(emptyWithdrawal.message)).toEqual([]);
      expect(emptyWithdrawal.operationIndex).toBeLessThan(
        factory.operations.indexOf("consumer:remove"),
      );
    }
    if (options.assertNoPublicationAfterWithdrawal)
      expect(eventPublications(factory)).toHaveLength(eventPublicationsBefore);
  } finally {
    await Promise.all([
      producer.close(),
      ...consumers.slice(options.closeFirst ? 1 : 0).map((context) => context.close()),
      peer?.close(),
    ]);
    await ServerEnvironment.instance().close();
  }
}

async function assertFailedReplacementKeepsPriorWantedSet(): Promise<void> {
  const factory = new RecordingTransportFactory();
  ServerEnvironment.when(EnvironmentType.Local).use({ integrationChannelFactory: factory });
  await ServerEnvironment.instance().completeSetup();
  const producer = await BoundedContext.singleTenant(`RollbackProducer${crypto.randomUUID()}`)
    .addEventDispatcher(
      domestic([ReviewTaskAssignedSchema, ReviewStartedSchema, ReviewFollowUpScheduledSchema]),
    )
    .build();
  try {
    await publishWanted(factory, "RollbackPeer", [ReviewTaskAssignedSchema]);
    factory.failPublisherCreationAfter(
      1,
      (channel) => isEventChannel(channel) && !isReviewTaskAssignedChannel(channel),
    );
    await expect(
      publishWanted(factory, "RollbackPeer", [ReviewStartedSchema, ReviewFollowUpScheduledSchema]),
    ).rejects.toThrow(/injected publisher creation failure/u);
    expect(factory.openPublisherTargets()).toContain(TypeUrls.derive(ReviewTaskAssignedSchema));
    expect(factory.openPublisherTargets()).not.toContain(TypeUrls.derive(ReviewStartedSchema));
    expect(factory.openPublisherTargets()).not.toContain(
      TypeUrls.derive(ReviewFollowUpScheduledSchema),
    );
    const before = eventPublications(factory).length;
    await producer.eventBus().post(event(ReviewTaskAssignedSchema, "prior-still-active"));
    expect(eventPublications(factory)).toHaveLength(before + 1);
    await publishWanted(factory, "RollbackPeer", []);
    expect(factory.openPublisherTargets()).not.toContain(TypeUrls.derive(ReviewTaskAssignedSchema));
    const afterWithdrawal = eventPublications(factory).length;
    await producer.eventBus().post(event(ReviewTaskAssignedSchema, "withdrawn"));
    expect(eventPublications(factory)).toHaveLength(afterWithdrawal);
  } finally {
    await producer.close();
    await ServerEnvironment.instance().close();
  }
}

function decodeWantedFrames(
  factory: RecordingTransportFactory,
  contextPrefix?: string,
): Promise<
  readonly {
    readonly message: { readonly type: readonly { readonly typeUrl: string }[] };
    readonly operationIndex: number;
  }[]
> {
  return Promise.resolve(
    factory.published.flatMap(({ message, operationIndex }) => {
      const frame = message as {
        readonly boundedContextName?: { readonly value?: string };
        readonly originalMessage?: { readonly typeUrl?: string; readonly value?: Uint8Array };
      };
      if (
        frame.originalMessage?.typeUrl !==
          "type.spine.io/spine.server.integration.ExternalEventsWanted" ||
        frame.originalMessage.value === undefined ||
        (contextPrefix !== undefined && !frame.boundedContextName?.value?.startsWith(contextPrefix))
      )
        return [];
      return [
        {
          message: AnyPacker.unpack(
            create(AnySchema, frame.originalMessage),
            ExternalEventsWantedSchema,
          ),
          operationIndex,
        },
      ];
    }),
  );
}
function wantedTypeUrls(message: {
  readonly type: readonly { readonly typeUrl: string }[];
}): readonly string[] {
  return message.type.map((entry) => entry.typeUrl);
}
function isEventChannel(channel: unknown): boolean {
  const target = (channel as { targetType?: string }).targetType;
  return [
    TypeUrls.derive(ReviewTaskAssignedSchema),
    TypeUrls.derive(ReviewStartedSchema),
    TypeUrls.derive(ReviewFollowUpScheduledSchema),
  ].includes(target ?? "");
}

function isConfigChannel(channel: unknown): boolean {
  return (
    (channel as { targetType?: string }).targetType ===
    "type.spine.io/spine.server.integration.ExternalEventsWanted"
  );
}

function eventPublications(factory: RecordingTransportFactory) {
  return factory.published.filter(({ channel }) => isEventChannel(channel));
}

function configPublications(factory: RecordingTransportFactory) {
  return factory.published.filter(({ channel }) => isConfigChannel(channel));
}

function isReviewTaskAssignedChannel(channel: unknown): boolean {
  return (
    (channel as { targetType?: string }).targetType === TypeUrls.derive(ReviewTaskAssignedSchema)
  );
}

function eventPublisherCreations(
  factory: RecordingTransportFactory,
  schema: typeof ReviewTaskAssignedSchema | typeof ReviewStartedSchema,
) {
  return factory.created.filter(
    ({ kind, channel }) =>
      kind === "publisher" &&
      (channel as { targetType?: string }).targetType === TypeUrls.derive(schema),
  );
}

async function publishWanted(
  factory: RecordingTransportFactory,
  source: string,
  schemas: readonly (
    | typeof ReviewTaskAssignedSchema
    | typeof ReviewStartedSchema
    | typeof ReviewFollowUpScheduledSchema
  )[],
): Promise<void> {
  const wanted = create(ExternalEventsWantedSchema, {
    type: schemas.map((schema) => ({ typeUrl: TypeUrls.derive(schema) })),
  });
  const id = create(StringValueSchema, { value: crypto.randomUUID() });
  const packedId = AnyPacker.pack(StringValueSchema, id);
  const publisher = await factory.createPublisher(
    create(ChannelIdSchema, {
      targetType: "type.spine.io/spine.server.integration.ExternalEventsWanted",
    }),
  );
  try {
    await publisher.publish(
      packedId,
      create(ExternalMessageSchema, {
        id: packedId,
        originalMessage: AnyPacker.pack(ExternalEventsWantedSchema, wanted),
        boundedContextName: create(BoundedContextNameSchema, { value: source }),
      }),
    );
  } finally {
    await publisher.close();
  }
}

async function publishExternalEvent(
  factory: RecordingTransportFactory,
  original: ReturnType<typeof event>,
  source: string,
): Promise<void> {
  const packedId = AnyPacker.pack(EventIdSchema, required(original.id, "external event identity"));
  const publisher = await factory.createPublisher(
    create(ChannelIdSchema, { targetType: TypeUrls.derive(ReviewTaskAssignedSchema) }),
  );
  try {
    await publisher.publish(
      packedId,
      create(ExternalMessageSchema, {
        id: packedId,
        originalMessage: AnyPacker.pack(EventSchema, original),
        boundedContextName: create(BoundedContextNameSchema, { value: source }),
      }),
    );
  } finally {
    await publisher.close();
  }
}

async function waitForConfigPublications(
  factory: RecordingTransportFactory,
  count: number,
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (configPublications(factory).length < count) {
    if (Date.now() >= deadline)
      throw new Error(`Timed out waiting for ${String(count)} configuration publications.`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function required<Value>(value: Value | undefined, label: string): Value {
  if (value === undefined) throw new Error(`Expected ${label}.`);
  return value;
}

function tenantValue(context: unknown): string {
  if (typeof context !== "object" || context === null)
    throw new Error("Expected an Event context.");
  const origin = (
    context as {
      readonly origin?: {
        readonly case?: unknown;
        readonly value?: { readonly tenantId?: unknown };
      };
    }
  ).origin;
  const tenantId = origin?.case === "importContext" ? origin.value?.tenantId : undefined;
  if (typeof tenantId !== "object" || tenantId === null)
    throw new Error("Expected an Event context tenant identity.");
  const kind = (
    tenantId as { readonly kind?: { readonly case?: unknown; readonly value?: unknown } }
  ).kind;
  const value = kind?.case === "value" ? kind.value : undefined;
  if (typeof value !== "string") throw new Error("Expected a string tenant identity.");
  return value;
}
