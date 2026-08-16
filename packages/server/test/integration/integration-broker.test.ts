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

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import {
  BoolValueSchema,
  Int32ValueSchema,
  StringValueSchema,
  TimestampSchema,
} from "@bufbuild/protobuf/wkt";
import { SignalEnvelopes } from "@spine-event-engine/core";
import { TypeUrls } from "@spine-event-engine/core";
import {
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  BoundedContextNameSchema,
  ChannelIdSchema,
  ExternalEventsWantedSchema,
  ExternalMessageSchema,
  TenantIdSchema,
  VersionSchema,
} from "@spine-event-engine/proto";
import { BoundedContext, EnvironmentType, ServerEnvironment } from "@spine-event-engine/server";
import { resetServerEnvironmentForTest } from "@spine-event-engine/server/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadWave13Contract,
  RecordingTransportFactory,
  requireContractMember,
} from "./wave13-red-support.js";
import {
  createWave13OriginRegistry,
  wave13OriginRouting,
  Wave13OriginProjection,
  Wave13OriginStateSchema,
} from "./wave13-origin-repository.js";

const brokerModule = new URL("../../src/integration/integration-broker.js", import.meta.url).href;
const external = (schemas: readonly unknown[], received: unknown[]) => ({
  messageSchemas: () => schemas,
  externalEventSchemas: () => schemas,
  dispatch: (event: unknown) => Promise.resolve(received.push(event)).then(() => undefined),
});
const domestic = (schemas: readonly unknown[], received: unknown[] = []) => ({
  messageSchemas: () => schemas,
  dispatch: (event: unknown) => Promise.resolve(received.push(event)).then(() => undefined),
});
function event(
  schema?: typeof StringValueSchema,
  id?: string,
  tenantId?: string,
): ReturnType<typeof stringEvent>;
function event(
  schema: typeof Int32ValueSchema,
  id?: string,
  tenantId?: string,
): ReturnType<typeof int32Event>;
function event(
  schema: typeof StringValueSchema | typeof Int32ValueSchema = StringValueSchema,
  id = "wave13-event",
  tenantId?: string,
) {
  return schema === Int32ValueSchema ? int32Event(id, tenantId) : stringEvent(id, tenantId);
}
function eventContext(tenantId?: string) {
  return create(
    EventContextSchema,
    tenantId === undefined
      ? {}
      : {
          origin: {
            case: "importContext",
            value: {
              tenantId: create(TenantIdSchema, { kind: { case: "value", value: tenantId } }),
            },
          },
        },
  );
}
function stringEvent(id: string, tenantId?: string) {
  return SignalEnvelopes.event({
    id: create(EventIdSchema, { value: id }),
    context: eventContext(tenantId),
    schema: StringValueSchema,
    message: create(StringValueSchema, { value: id }),
  });
}
function int32Event(id: string, tenantId?: string) {
  return SignalEnvelopes.event({
    id: create(EventIdSchema, { value: id }),
    context: eventContext(tenantId),
    schema: Int32ValueSchema,
    message: create(Int32ValueSchema, { value: id.length }),
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

describe("Wave 13 IntegrationBroker", () => {
  beforeEach(async () => resetServerEnvironmentForTest());
  afterEach(async () => resetServerEnvironmentForTest());
  it("RED-01 delivers one requested domestic event once between two same-process contexts", async () => {
    await broker("one producer / one consumer delivery");
    const seen: unknown[] = [];
    const consumer = BoundedContext.singleTenant("Red01Consumer")
      .addEventDispatcher(external([StringValueSchema], seen) as never)
      .build();
    const producer = BoundedContext.singleTenant("Red01Producer")
      .addEventDispatcher(domestic([StringValueSchema]) as never)
      .build();
    try {
      const original = event();
      await producer.eventBus().post(original);
      expect(seen).toEqual([expect.objectContaining({ id: original.id })]);
    } finally {
      await close(producer, consumer);
    }
  });
  it("RED-02 fans one producer event out to every requesting consumer", async () => {
    await broker("many-consumer complete-event fan-out");
    const first: unknown[] = [],
      second: unknown[] = [];
    const producer = BoundedContext.singleTenant("Red02Producer")
      .addEventDispatcher(domestic([StringValueSchema]) as never)
      .build();
    const one = BoundedContext.singleTenant("Red02One")
      .addEventDispatcher(external([StringValueSchema], first) as never)
      .build();
    const two = BoundedContext.singleTenant("Red02Two")
      .addEventDispatcher(external([StringValueSchema], second) as never)
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
    const seen: unknown[] = [];
    const consumer = BoundedContext.singleTenant("Red05Consumer")
      .addEventDispatcher(external([StringValueSchema], seen) as never)
      .build();
    const producer = BoundedContext.singleTenant("Red05Producer")
      .addEventDispatcher(domestic([StringValueSchema, Int32ValueSchema]) as never)
      .build();
    try {
      await producer.eventBus().post(event(Int32ValueSchema, "unwanted"));
      await producer.eventBus().post(event(StringValueSchema, "wanted"));
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ id: { value: "wanted" } });
    } finally {
      await close(producer, consumer);
    }
  });
  it("RED-06 does not republish imported events in a bidirectional cycle", async () => {
    await broker("origin-only loop prevention");
    const factory = new RecordingTransportFactory();
    ServerEnvironment.when(EnvironmentType.Local).use({ transportFactory: factory });
    const a: unknown[] = [],
      b: unknown[] = [];
    const left = BoundedContext.singleTenant("Red06A")
      .addEventDispatcher(domestic([StringValueSchema]) as never)
      .addEventDispatcher(external([Int32ValueSchema], a) as never)
      .build();
    const right = BoundedContext.singleTenant("Red06B")
      .addEventDispatcher(domestic([Int32ValueSchema]) as never)
      .addEventDispatcher(external([StringValueSchema], b) as never)
      .build();
    try {
      await left.eventBus().post(event(StringValueSchema, "a"));
      await right.eventBus().post(event(Int32ValueSchema, "b"));
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ id: { value: "b" } });
      expect(b).toHaveLength(1);
      expect(b[0]).toMatchObject({ id: { value: "a" } });
      expect(
        factory.published.filter(({ channel }) =>
          [TypeUrls.derive(StringValueSchema), TypeUrls.derive(Int32ValueSchema)].includes(
            (channel as { targetType?: string }).targetType ?? "",
          ),
        ),
      ).toHaveLength(2);
    } finally {
      await close(left, right);
    }
  });
  it("RED-07 installs one publisher on the first requester and serializes complete-set replacement", async () => {
    await broker("first request and replacement");
    const factory = new RecordingTransportFactory();
    ServerEnvironment.when(EnvironmentType.Local).use({ transportFactory: factory });
    const producer = await BoundedContext.singleTenant(`Red07${crypto.randomUUID()}`)
      .addEventDispatcher(domestic([StringValueSchema, Int32ValueSchema]) as never)
      .buildAsync();
    try {
      await publishWanted(factory, "Red07Peer", [StringValueSchema]);
      const initialConfigCount = configPublications(factory).length;
      const duplicate = publishWanted(factory, "Red07Peer", [StringValueSchema]);
      await waitForConfigPublications(factory, initialConfigCount + 1);
      const expansion = publishWanted(factory, "Red07Peer", [StringValueSchema, Int32ValueSchema]);
      await waitForConfigPublications(factory, initialConfigCount + 2);
      const replacement = publishWanted(factory, "Red07Peer", [Int32ValueSchema]);
      await Promise.all([duplicate, expansion, replacement]);
      const before = eventPublications(factory).length;
      await producer.eventBus().post(event(StringValueSchema, "replaced"));
      await producer.eventBus().post(event(Int32ValueSchema, "final"));
      expect(eventPublications(factory).slice(before)).toHaveLength(1);
      expect(eventPublications(factory)[before]).toMatchObject({
        channel: { targetType: TypeUrls.derive(Int32ValueSchema) },
      });
      expect(eventPublisherCreations(factory, StringValueSchema)).toHaveLength(1);
      expect(eventPublisherCreations(factory, Int32ValueSchema)).toHaveLength(1);
    } finally {
      await producer.close();
      await ServerEnvironment.instance().close();
    }
  });
  it("RED-08 retains publication while another requester still wants the type", async () => {
    await broker("per-origin wanted references");
    const factory = new RecordingTransportFactory();
    ServerEnvironment.when(EnvironmentType.Local).use({ transportFactory: factory });
    const producer = await BoundedContext.singleTenant(`Red08${crypto.randomUUID()}`)
      .addEventDispatcher(domestic([StringValueSchema]) as never)
      .buildAsync();
    try {
      await publishWanted(factory, "Red08First", [StringValueSchema]);
      await publishWanted(factory, "Red08Second", [StringValueSchema]);
      await publishWanted(factory, "Red08First", []);
      const before = eventPublications(factory).length;
      await producer.eventBus().post(event(StringValueSchema, "retained"));
      expect(eventPublications(factory)).toHaveLength(before + 1);
      expect(eventPublisherCreations(factory, StringValueSchema)).toHaveLength(1);
    } finally {
      await producer.close();
      await ServerEnvironment.instance().close();
    }
  });
  it("RED-09 removes publication after the final requester withdraws without losing the prior set on failure", async () => {
    await broker("last withdrawal rollback");
    await assertFailedReplacementKeepsPriorWantedSet();
  });
  it("RED-10 suppresses an unchanged complete wanted-event set", async () => {
    await broker("unchanged complete-set suppression");
    const factory = new RecordingTransportFactory();
    ServerEnvironment.when(EnvironmentType.Local).use({ transportFactory: factory });
    const context = await BoundedContext.singleTenant(`Red10${crypto.randomUUID()}`)
      .addEventDispatcher(external([StringValueSchema], []) as never)
      .addEventDispatcher(external([StringValueSchema], []) as never)
      .buildAsync();
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
    const seen: unknown[] = [];
    const c = BoundedContext.singleTenant("Red13C")
      .addEventDispatcher(external([StringValueSchema], seen) as never)
      .build();
    const p = BoundedContext.singleTenant("Red13P")
      .addEventDispatcher(domestic([StringValueSchema]) as never)
      .build();
    try {
      const one = event(StringValueSchema, "one"),
        two = event(StringValueSchema, "two");
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
  it("RED-15 validates the existing tenant boundary and isolates imported tenants", async () => {
    await broker("tenant-aware imported intake");
    const registry = createWave13OriginRegistry();
    Wave13OriginProjection.reset();
    const c = await BoundedContext.multitenant("Red15")
      .withGeneratedRegistryRoot(registry.root)
      .add(Wave13OriginProjection, { eventRouting: wave13OriginRouting })
      .buildAsync();
    const p = await BoundedContext.multitenant("Red15P")
      .addEventDispatcher(domestic([StringValueSchema]) as never)
      .buildAsync();
    const tenantA = create(TenantIdSchema, { kind: { case: "value", value: "tenant-a" } });
    const tenantB = create(TenantIdSchema, { kind: { case: "value", value: "tenant-b" } });
    try {
      await p.eventBus().post(event(StringValueSchema, "a", "tenant-a"));
      await p.eventBus().post(event(StringValueSchema, "b", "tenant-b"));
      expect(Wave13OriginProjection.externalContexts.map(tenantValue)).toEqual([
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
      await expect(p.eventBus().post(event(StringValueSchema, "missing"))).rejects.toThrow(
        /tenant/u,
      );
      const single = await BoundedContext.singleTenant("Red15Single")
        .addEventDispatcher(external([StringValueSchema], []) as never)
        .buildAsync();
      const forbidden = await BoundedContext.singleTenant("Red15Forbidden")
        .addEventDispatcher(domestic([StringValueSchema]) as never)
        .buildAsync();
      await expect(
        forbidden.eventBus().post(event(StringValueSchema, "forbidden", "tenant-a")),
      ).rejects.toThrow(/tenant/u);
      await close(forbidden, single);
    } finally {
      await close(p, c);
      registry.clear();
    }
  });
  it("RED-16 changes only EventContext.external before posting through the normal EventBus", async () => {
    await broker("normal EventBus import with system/self filtering");
    const factory = new RecordingTransportFactory();
    ServerEnvironment.when(EnvironmentType.Local).use({ transportFactory: factory });
    const seen: unknown[] = [];
    const c = await BoundedContext.singleTenant("Red16C")
      .addEventDispatcher(external([StringValueSchema], seen) as never)
      .buildAsync();
    const p = await BoundedContext.singleTenant("Red16P")
      .addEventDispatcher(domestic([StringValueSchema]) as never)
      .buildAsync();
    try {
      const original = SignalEnvelopes.event({
        id: create(EventIdSchema, { value: "red16-preserved" }),
        context: create(EventContextSchema, {
          timestamp: create(TimestampSchema, { seconds: 1_725_000_000n, nanos: 123_000_000 }),
          producerId: {
            typeUrl: TypeUrls.derive(StringValueSchema),
            value: toBinary(
              StringValueSchema,
              create(StringValueSchema, { value: "red16-producer" }),
            ),
          },
          version: create(VersionSchema, {
            number: 7,
            timestamp: create(TimestampSchema, { seconds: 1_725_000_001n }),
          }),
        }),
        schema: StringValueSchema,
        message: create(StringValueSchema, { value: "preserved" }),
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
  ServerEnvironment.when(EnvironmentType.Local).use({ transportFactory: factory });
  const producer = await BoundedContext.singleTenant(`WantedProducer${crypto.randomUUID()}`)
    .addEventDispatcher(domestic([StringValueSchema, Int32ValueSchema]) as never)
    .buildAsync();
  // RED-07 exercises producer-before-consumer; the peer-online branch creates
  // a consumer before its producer to retain the reverse construction order.
  const consumers = await Promise.all(
    Array.from({ length: options.requesters }, (_, index) =>
      BoundedContext.singleTenant(`WantedConsumer${String(index)}${crypto.randomUUID()}`)
        .addEventDispatcher(external([StringValueSchema], []) as never)
        .buildAsync(),
    ),
  );
  let peer: BoundedContext | undefined;
  try {
    if (options.peerOnline)
      peer = await BoundedContext.singleTenant(`WantedPeer${crypto.randomUUID()}`).buildAsync();
    if (options.closeFirst) await required(consumers[0], "first consumer").close();

    const eventPublicationsBefore = eventPublications(factory).length;
    if (options.closeFirst) await producer.eventBus().post(event(StringValueSchema, "after-close"));

    const wantedFrames = await decodeWantedFrames(factory, "WantedConsumer");
    expect(wantedFrames).toHaveLength(options.expectedWantedFrames);
    expect(
      factory.created.filter(
        (entry) => entry.kind === "publisher" && isEventChannel(entry.channel),
      ),
    ).toHaveLength(options.expectedPublishers);
    expect(wantedFrames.map((entry) => wantedTypeUrls(entry.message))).toEqual(
      expect.arrayContaining([expect.arrayContaining([TypeUrls.derive(StringValueSchema)])]),
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
  ServerEnvironment.when(EnvironmentType.Local).use({ transportFactory: factory });
  const producer = await BoundedContext.singleTenant(`RollbackProducer${crypto.randomUUID()}`)
    .addEventDispatcher(domestic([StringValueSchema, Int32ValueSchema, BoolValueSchema]) as never)
    .buildAsync();
  try {
    await publishWanted(factory, "RollbackPeer", [StringValueSchema]);
    factory.failPublisherCreationAfter(
      1,
      (channel) => isEventChannel(channel) && !isStringEventChannel(channel),
    );
    await expect(
      publishWanted(factory, "RollbackPeer", [Int32ValueSchema, BoolValueSchema]),
    ).rejects.toThrow(/injected publisher creation failure/u);
    expect(factory.openPublisherTargets()).toContain(TypeUrls.derive(StringValueSchema));
    expect(factory.openPublisherTargets()).not.toContain(TypeUrls.derive(Int32ValueSchema));
    expect(factory.openPublisherTargets()).not.toContain(TypeUrls.derive(BoolValueSchema));
    const before = eventPublications(factory).length;
    await producer.eventBus().post(event(StringValueSchema, "prior-still-active"));
    expect(eventPublications(factory)).toHaveLength(before + 1);
    await publishWanted(factory, "RollbackPeer", []);
    expect(factory.openPublisherTargets()).not.toContain(TypeUrls.derive(StringValueSchema));
    const afterWithdrawal = eventPublications(factory).length;
    await producer.eventBus().post(event(StringValueSchema, "withdrawn"));
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
          message: fromBinary(ExternalEventsWantedSchema, frame.originalMessage.value),
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
    TypeUrls.derive(StringValueSchema),
    TypeUrls.derive(Int32ValueSchema),
    TypeUrls.derive(BoolValueSchema),
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

function isStringEventChannel(channel: unknown): boolean {
  return (channel as { targetType?: string }).targetType === TypeUrls.derive(StringValueSchema);
}

function eventPublisherCreations(
  factory: RecordingTransportFactory,
  schema: typeof StringValueSchema | typeof Int32ValueSchema,
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
  schemas: readonly (typeof StringValueSchema | typeof Int32ValueSchema | typeof BoolValueSchema)[],
): Promise<void> {
  const wanted = create(ExternalEventsWantedSchema, {
    type: schemas.map((schema) => ({ typeUrl: TypeUrls.derive(schema) })),
  });
  const id = create(StringValueSchema, { value: crypto.randomUUID() });
  const packedId = create(AnySchema, {
    typeUrl: TypeUrls.derive(StringValueSchema),
    value: toBinary(StringValueSchema, id),
  });
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
        originalMessage: create(AnySchema, {
          typeUrl: "type.spine.io/spine.server.integration.ExternalEventsWanted",
          value: toBinary(ExternalEventsWantedSchema, wanted),
        }),
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
  const packedId = create(AnySchema, {
    typeUrl: TypeUrls.derive(EventIdSchema),
    value: toBinary(EventIdSchema, required(original.id, "external event identity")),
  });
  const publisher = await factory.createPublisher(
    create(ChannelIdSchema, { targetType: TypeUrls.derive(StringValueSchema) }),
  );
  try {
    await publisher.publish(
      packedId,
      create(ExternalMessageSchema, {
        id: packedId,
        originalMessage: create(AnySchema, {
          typeUrl: TypeUrls.derive(EventSchema),
          value: toBinary(EventSchema, original),
        }),
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
