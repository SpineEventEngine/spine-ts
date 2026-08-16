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
import { Int32ValueSchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import { SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import {
  BoundedContextNameSchema,
  BoundedContextOnlineSchema,
  ChannelIdSchema,
  ExternalEventsWantedSchema,
  ExternalMessageSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
} from "@spine-event-engine/proto";
import { eventBusAccess } from "../../src/bus/event-bus.js";
import { afterEach, describe, expect, it } from "vitest";

import { IntegrationBroker } from "../../src/integration/integration-broker.js";
import {
  wrapBoundedContextOnline,
  wrapExternalEvent,
} from "../../src/integration/external-messages.js";
import { RecordingTransportFactory } from "./wave13-red-support.js";

describe("IntegrationBroker module", () => {
  const brokers: IntegrationBroker[] = [];
  afterEach(async () => {
    await Promise.all(brokers.splice(0).map((broker) => broker.close().catch(() => undefined)));
  });

  it("deduplicates a one-shot external schema iterable and uses its canonical channel URL", async () => {
    const factory = new RecordingTransportFactory();
    const bus = eventBusAccess.createForgettingBus();
    eventBusAccess.registerSchemas(bus, [StringValueSchema]);
    let consumed = false;
    const schemas = {
      *[Symbol.iterator]() {
        if (consumed) throw new Error("schema iterable was consumed twice");
        consumed = true;
        yield StringValueSchema;
        yield StringValueSchema;
      },
    };
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "module-consumer" }),
      transportFactory: factory,
      eventBus: bus,
      externalEventSchemas: schemas,
      postImported: () => Promise.resolve(),
    });
    brokers.push(broker);
    await broker.open();
    expect(
      factory.created.filter(
        ({ kind, channel }) =>
          kind === "subscriber" &&
          (channel as { targetType?: string }).targetType === TypeUrls.derive(StringValueSchema),
      ),
    ).toHaveLength(1);
  });

  it("rejects opening after close without acquiring resources", async () => {
    const factory = new RecordingTransportFactory();
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "closed" }),
      transportFactory: factory,
      eventBus: eventBusAccess.createForgettingBus(),
      externalEventSchemas: [],
      postImported: () => Promise.resolve(),
    });
    await broker.close();
    await expect(broker.open()).rejects.toThrow();
    expect(factory.created).toHaveLength(1);
  });

  it("rebroadcasts wanted configuration for a peer online but ignores self and paired origins", async () => {
    const factory = new RecordingTransportFactory();
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "left" }),
      pairedContextName: create(BoundedContextNameSchema, { value: "left_System" }),
      transportFactory: factory,
      eventBus: eventBusAccess.createForgettingBus(),
      externalEventSchemas: [StringValueSchema],
      postImported: () => Promise.resolve(),
    });
    brokers.push(broker);
    await broker.open();
    const channel = create(ChannelIdSchema, {
      targetType: TypeUrls.derive(BoundedContextOnlineSchema),
    });
    const publisher = await factory.createPublisher(channel);
    for (const name of ["left", "left_System", "peer"]) {
      const frame = wrapBoundedContextOnline(
        create(BoundedContextOnlineSchema, {
          context: create(BoundedContextNameSchema, { value: name }),
        }),
      );
      await publisher.publish(required(frame.id, "online frame identity"), frame);
    }
    await publisher.close();
    expect(
      factory.published.filter(
        ({ channel: candidate }) =>
          (candidate as { targetType?: string }).targetType ===
          "type.spine.io/spine.server.integration.ExternalEventsWanted",
      ),
    ).toHaveLength(2);
  });

  it("rejects malformed online and wanted control frames before changing broker state", async () => {
    const factory = new RecordingTransportFactory();
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "validation" }),
      transportFactory: factory,
      eventBus: eventBusAccess.createForgettingBus(),
      externalEventSchemas: [],
      postImported: () => Promise.resolve(),
    });
    brokers.push(broker);
    await broker.open();
    const identity = {
      typeUrl: TypeUrls.derive(StringValueSchema),
      value: toBinary(StringValueSchema, create(StringValueSchema, { value: "control" })),
    };
    for (const targetType of [
      TypeUrls.derive(BoundedContextOnlineSchema),
      TypeUrls.derive(ExternalEventsWantedSchema),
    ]) {
      const publisher = await factory.createPublisher(create(ChannelIdSchema, { targetType }));
      await expect(
        publisher.publish(
          identity,
          create(ExternalMessageSchema, {
            id: identity,
            boundedContextName: create(BoundedContextNameSchema, { value: "peer" }),
            originalMessage: { typeUrl: targetType, value: new Uint8Array([255]) },
          }),
        ),
      ).rejects.toThrow(/Malformed integration control message/u);
      await publisher.close();
    }
    const online = await factory.createPublisher(
      create(ChannelIdSchema, { targetType: TypeUrls.derive(BoundedContextOnlineSchema) }),
    );
    await expect(
      online.publish(
        identity,
        create(ExternalMessageSchema, {
          id: identity,
          originalMessage: {
            typeUrl: TypeUrls.derive(BoundedContextOnlineSchema),
            value: toBinary(BoundedContextOnlineSchema, create(BoundedContextOnlineSchema)),
          },
        }),
      ),
    ).rejects.toThrow(/Malformed integration control message/u);
    await online.close();
  });

  it("retries close after its final wanted publication cleanup fails", async () => {
    const factory = new RecordingTransportFactory();
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "close-retry-publication" }),
      transportFactory: factory,
      eventBus: eventBusAccess.createForgettingBus(),
      externalEventSchemas: [],
      postImported: () => Promise.resolve(),
    });
    brokers.push(broker);
    await broker.open();
    factory.failNextClose();
    await expect(broker.close()).rejects.toThrow(/close failed/u);
    await expect(broker.close()).resolves.toBeUndefined();
  });

  it("retains failed subscriber cleanup and shares a concurrent close promise", async () => {
    const factory = new RecordingTransportFactory();
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "close-resource-retry" }),
      transportFactory: factory,
      eventBus: eventBusAccess.createForgettingBus(),
      externalEventSchemas: [],
      postImported: () => Promise.resolve(),
    });
    brokers.push(broker);
    await broker.open();
    factory.failCloseAfter(1);
    const first = broker.close();
    expect(first).toBe(broker.close());
    await expect(first).rejects.toThrow(/close failed/u);
    await expect(broker.close()).resolves.toBeUndefined();
  });

  it("retains a failed domestic publisher until a later close succeeds", async () => {
    const factory = new RecordingTransportFactory();
    const bus = eventBusAccess.createForgettingBus();
    eventBusAccess.registerSchemas(bus, [StringValueSchema]);
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "close-publisher-retry" }),
      transportFactory: factory,
      eventBus: bus,
      externalEventSchemas: [],
      postImported: () => Promise.resolve(),
    });
    brokers.push(broker);
    await broker.open();
    await publishWanted(factory, "receiver", [StringValueSchema]);
    factory.failCloseAfter(1);
    await expect(broker.close()).rejects.toThrow(/close failed/u);
    await expect(broker.close()).resolves.toBeUndefined();
  });

  it("installs one publisher per type, retains it for another requester, then removes it", async () => {
    const factory = new RecordingTransportFactory();
    const bus = eventBusAccess.createForgettingBus();
    eventBusAccess.registerSchemas(bus, [StringValueSchema, Int32ValueSchema]);
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "producer" }),
      transportFactory: factory,
      eventBus: bus,
      externalEventSchemas: [],
      postImported: () => Promise.resolve(),
    });
    brokers.push(broker);
    await broker.open();
    await publishWanted(factory, "one", [StringValueSchema]);
    await publishWanted(factory, "two", [StringValueSchema]);
    expect(eventPublisherCreations(factory, StringValueSchema)).toHaveLength(1);
    await publishWanted(factory, "one", []);
    expect(factory.openPublisherTargets()).toContain(TypeUrls.derive(StringValueSchema));
    await publishWanted(factory, "two", [Int32ValueSchema]);
    expect(factory.openPublisherTargets()).not.toContain(TypeUrls.derive(StringValueSchema));
    expect(factory.openPublisherTargets()).toContain(TypeUrls.derive(Int32ValueSchema));
  });

  it("ignores a wanted type without a local admitted schema", async () => {
    const factory = new RecordingTransportFactory();
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "unknown-producer" }),
      transportFactory: factory,
      eventBus: eventBusAccess.createForgettingBus(),
      externalEventSchemas: [],
      postImported: () => Promise.resolve(),
    });
    brokers.push(broker);
    await broker.open();
    await expect(publishWanted(factory, "requester", [StringValueSchema])).resolves.toBeUndefined();
    expect(eventPublisherCreations(factory, StringValueSchema)).toHaveLength(0);
  });

  it("cleans a partially acquired replacement and retains the prior wanted publisher", async () => {
    const factory = new RecordingTransportFactory();
    const bus = eventBusAccess.createForgettingBus();
    eventBusAccess.registerSchemas(bus, [StringValueSchema, Int32ValueSchema]);
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "rollback" }),
      transportFactory: factory,
      eventBus: bus,
      externalEventSchemas: [],
      postImported: () => Promise.resolve(),
    });
    brokers.push(broker);
    await broker.open();
    await publishWanted(factory, "requester", [StringValueSchema]);
    factory.failNextPublisherCreation(
      (channel) =>
        (channel as { targetType?: string }).targetType === TypeUrls.derive(Int32ValueSchema),
    );
    await expect(
      publishWanted(factory, "requester", [StringValueSchema, Int32ValueSchema]),
    ).rejects.toThrow(/injected publisher creation failure/u);
    expect(factory.openPublisherTargets()).toContain(TypeUrls.derive(StringValueSchema));
    expect(factory.openPublisherTargets()).not.toContain(TypeUrls.derive(Int32ValueSchema));
  });

  it("serializes overlapping complete wanted replacements to the final authority", async () => {
    const factory = new RecordingTransportFactory();
    const bus = eventBusAccess.createForgettingBus();
    eventBusAccess.registerSchemas(bus, [StringValueSchema, Int32ValueSchema]);
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "overlap" }),
      transportFactory: factory,
      eventBus: bus,
      externalEventSchemas: [],
      postImported: () => Promise.resolve(),
    });
    brokers.push(broker);
    await broker.open();
    await Promise.all([
      publishWanted(factory, "requester", [StringValueSchema]),
      publishWanted(factory, "requester", [Int32ValueSchema]),
    ]);
    expect(factory.openPublisherTargets()).not.toContain(TypeUrls.derive(StringValueSchema));
    expect(factory.openPublisherTargets()).toContain(TypeUrls.derive(Int32ValueSchema));
    expect(eventPublisherCreations(factory, StringValueSchema)).toHaveLength(1);
    expect(eventPublisherCreations(factory, Int32ValueSchema)).toHaveLength(1);
  });

  it("retains failed final removal and retries it without duplicate registration", async () => {
    const factory = new RecordingTransportFactory();
    const bus = eventBusAccess.createForgettingBus();
    eventBusAccess.registerSchemas(bus, [StringValueSchema]);
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "retry" }),
      transportFactory: factory,
      eventBus: bus,
      externalEventSchemas: [],
      postImported: () => Promise.resolve(),
    });
    brokers.push(broker);
    await broker.open();
    await publishWanted(factory, "requester", [StringValueSchema]);
    factory.failNextClose();
    await expect(publishWanted(factory, "requester", [])).rejects.toThrow(
      /Failed to remove domestic publisher/u,
    );
    expect(factory.openPublisherTargets()).toContain(TypeUrls.derive(StringValueSchema));
    await publishWanted(factory, "requester", []);
    expect(factory.openPublisherTargets()).not.toContain(TypeUrls.derive(StringValueSchema));
    expect(eventPublisherCreations(factory, StringValueSchema)).toHaveLength(1);
  });

  it("exports only requested domestic events with complete Event identity and preserves order", async () => {
    const factory = new RecordingTransportFactory();
    const bus = eventBusAccess.createForgettingBus();
    const dispatcher = {
      messageSchemas: () => [StringValueSchema, Int32ValueSchema],
      dispatch: () => Promise.resolve(),
    };
    bus.register(dispatcher);
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "events" }),
      transportFactory: factory,
      eventBus: bus,
      externalEventSchemas: [],
      postImported: () => Promise.resolve(),
    });
    brokers.push(broker);
    await broker.open();
    await publishWanted(factory, "receiver", [StringValueSchema]);
    const first = event("first"),
      second = event("second");
    await bus.post(first);
    await bus.post(
      SignalEnvelopes.event({
        id: create(EventIdSchema, { value: "ignored" }),
        schema: Int32ValueSchema,
        message: create(Int32ValueSchema, { value: 1 }),
      }),
    );
    await bus.post(second);
    const frames = factory.published.filter(
      ({ channel }) =>
        (channel as { targetType?: string }).targetType === TypeUrls.derive(StringValueSchema),
    );
    expect(frames).toHaveLength(2);
    expect(
      (
        required(frames[0], "first exported frame").message as {
          boundedContextName?: { value?: string };
        }
      ).boundedContextName?.value,
    ).toBe("events");
    expect(
      (
        required(frames[0], "first exported frame").message as {
          originalMessage?: { value?: Uint8Array };
        }
      ).originalMessage?.value,
    ).toEqual(toBinary(EventSchema, first));
    expect(
      (
        required(frames[1], "second exported frame").message as {
          originalMessage?: { value?: Uint8Array };
        }
      ).originalMessage?.value,
    ).toEqual(toBinary(EventSchema, second));
  });

  it("does not export an Event already marked external", async () => {
    const factory = new RecordingTransportFactory();
    const bus = eventBusAccess.createForgettingBus();
    bus.register({ messageSchemas: () => [StringValueSchema], dispatch: () => Promise.resolve() });
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "external-loop" }),
      transportFactory: factory,
      eventBus: bus,
      externalEventSchemas: [],
      postImported: () => Promise.resolve(),
    });
    brokers.push(broker);
    await broker.open();
    await publishWanted(factory, "receiver", [StringValueSchema]);
    const before = factory.published.length;
    await bus.post(
      SignalEnvelopes.event({
        id: create(EventIdSchema, { value: "external" }),
        context: create(EventContextSchema, { external: true }),
        schema: StringValueSchema,
        message: create(StringValueSchema, { value: "external" }),
      }),
    );
    expect(factory.published).toHaveLength(before);
  });

  it("imports an external event once and ignores self and paired origins", async () => {
    const factory = new RecordingTransportFactory();
    const received: unknown[] = [];
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "receiver" }),
      pairedContextName: create(BoundedContextNameSchema, { value: "receiver_System" }),
      transportFactory: factory,
      eventBus: eventBusAccess.createForgettingBus(),
      externalEventSchemas: [StringValueSchema],
      postImported: (value) => {
        received.push(value);
        return Promise.resolve();
      },
    });
    brokers.push(broker);
    await broker.open();
    const original = event("imported");
    await publishExternal(factory, original, "producer");
    await publishExternal(factory, original, "receiver");
    await publishExternal(factory, original, "receiver_System");
    expect(received).toEqual([
      expect.objectContaining({
        id: original.id,
        message: original.message,
        context: { ...original.context, external: true },
      }),
    ]);
  });

  it("rejects a mismatched external Event identity before import", async () => {
    const factory = new RecordingTransportFactory();
    let calls = 0;
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "invalid" }),
      transportFactory: factory,
      eventBus: eventBusAccess.createForgettingBus(),
      externalEventSchemas: [StringValueSchema],
      postImported: () => {
        calls++;
        return Promise.resolve();
      },
    });
    brokers.push(broker);
    await broker.open();
    const value = event("event-id");
    const frame = wrapExternalEvent(value, create(BoundedContextNameSchema, { value: "source" }));
    frame.id = {
      ...required(frame.id, "external frame identity"),
      value: toBinary(EventIdSchema, create(EventIdSchema, { value: "other" })),
    };
    const publisher = await factory.createPublisher(
      create(ChannelIdSchema, { targetType: TypeUrls.derive(StringValueSchema) }),
    );
    await expect(publisher.publish(frame.id, frame)).rejects.toThrow(/identity/u);
    expect(calls).toBe(0);
  });

  it("does not re-export an imported event and creates one subscription per canonical external type", async () => {
    const factory = new RecordingTransportFactory();
    const bus = eventBusAccess.createForgettingBus();
    bus.register({
      messageSchemas: () => [StringValueSchema, Int32ValueSchema],
      dispatch: () => Promise.resolve(),
    });
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "no-loop" }),
      transportFactory: factory,
      eventBus: bus,
      externalEventSchemas: [StringValueSchema, StringValueSchema, Int32ValueSchema],
      postImported: (value) => bus.post(value),
    });
    brokers.push(broker);
    await broker.open();
    await publishWanted(factory, "requester", [StringValueSchema]);
    await publishExternal(factory, event("external"), "remote");
    expect(
      factory.created.filter(
        ({ kind, channel }) =>
          kind === "subscriber" &&
          [TypeUrls.derive(StringValueSchema), TypeUrls.derive(Int32ValueSchema)].includes(
            (channel as { targetType?: string }).targetType ?? "",
          ),
      ),
    ).toHaveLength(2);
    expect(
      factory.published.filter(
        ({ channel }) =>
          (channel as { targetType?: string }).targetType === TypeUrls.derive(StringValueSchema),
      ),
    ).toHaveLength(1);
  });

  it("drains an accepted import before close and ignores later intake", async () => {
    const factory = new RecordingTransportFactory();
    let release!: () => void;
    let calls = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "drain" }),
      transportFactory: factory,
      eventBus: eventBusAccess.createForgettingBus(),
      externalEventSchemas: [StringValueSchema],
      postImported: async () => {
        calls++;
        await gate;
      },
    });
    brokers.push(broker);
    await broker.open();
    const pending = publishExternal(factory, event("accepted"), "remote");
    while (calls === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    const closing = broker.close();
    let settled = false;
    void closing.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await pending;
    await closing;
    await publishExternal(factory, event("late"), "remote");
    expect(calls).toBe(1);
  });

  it("closes failed and earlier subscriber attachments when opening fails", async () => {
    const factory = new RecordingTransportFactory();
    factory.failNextConsumerAddition(
      (channel) =>
        (channel as { targetType?: string }).targetType ===
        TypeUrls.derive(ExternalEventsWantedSchema),
    );
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "attach-failure" }),
      transportFactory: factory,
      eventBus: eventBusAccess.createForgettingBus(),
      externalEventSchemas: [],
      postImported: () => Promise.resolve(),
    });
    await expect(broker.open()).rejects.toThrow(/attachment failure/u);
    expect(factory.operations.filter((operation) => operation === "subscriber:close")).toHaveLength(
      2,
    );
  });

  it("reports both attachment and subscriber-close failures", async () => {
    const factory = new RecordingTransportFactory();
    factory.failNextConsumerAddition(
      (channel) =>
        (channel as { targetType?: string }).targetType ===
        TypeUrls.derive(BoundedContextOnlineSchema),
    );
    factory.failNextClose();
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "aggregate-attach" }),
      transportFactory: factory,
      eventBus: eventBusAccess.createForgettingBus(),
      externalEventSchemas: [],
      postImported: () => Promise.resolve(),
    });
    await expect(broker.open()).rejects.toThrow(/Integration subscriber setup failed/u);
  });

  it("retains failed teardown ownership and retries close", async () => {
    const factory = new RecordingTransportFactory();
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "close-retry" }),
      transportFactory: factory,
      eventBus: eventBusAccess.createForgettingBus(),
      externalEventSchemas: [StringValueSchema],
      postImported: () => Promise.resolve(),
    });
    await broker.open();
    factory.failNextClose();
    await expect(broker.close()).rejects.toThrow(/close failed/u);
    await expect(broker.close()).resolves.toBeUndefined();
    expect(
      factory.operations.filter((operation) => operation === "subscriber:close").length,
    ).toBeGreaterThan(0);
  });

  it("drains a gated peer-online resend before its final empty withdrawal", async () => {
    const factory = new RecordingTransportFactory();
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "ordered-close" }),
      transportFactory: factory,
      eventBus: eventBusAccess.createForgettingBus(),
      externalEventSchemas: [StringValueSchema],
      postImported: () => Promise.resolve(),
    });
    brokers.push(broker);
    await broker.open();
    const release = factory.gateNextPublish(
      (channel) =>
        (channel as { targetType?: string }).targetType ===
        TypeUrls.derive(ExternalEventsWantedSchema),
    );
    const publisher = await factory.createPublisher(
      create(ChannelIdSchema, { targetType: TypeUrls.derive(BoundedContextOnlineSchema) }),
    );
    const frame = wrapBoundedContextOnline(
      create(BoundedContextOnlineSchema, {
        context: create(BoundedContextNameSchema, { value: "peer" }),
      }),
    );
    const pending = publisher.publish(required(frame.id, "online frame identity"), frame);
    while (
      factory.published.filter(
        ({ channel }) =>
          (channel as { targetType?: string }).targetType ===
          TypeUrls.derive(ExternalEventsWantedSchema),
      ).length < 2
    )
      await new Promise((resolve) => setTimeout(resolve, 0));
    const closing = broker.close();
    let settled = false;
    void closing.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await pending;
    await closing;
    const wanted = factory.published
      .filter(
        ({ channel }) =>
          (channel as { targetType?: string }).targetType ===
          TypeUrls.derive(ExternalEventsWantedSchema),
      )
      .map(({ message }) =>
        fromBinary(
          ExternalEventsWantedSchema,
          (message as { originalMessage: { value: Uint8Array } }).originalMessage.value,
        ),
      );
    expect(wanted.at(-1)?.type).toEqual([]);
  });
});

function event(id: string) {
  return SignalEnvelopes.event({
    id: create(EventIdSchema, { value: id }),
    schema: StringValueSchema,
    message: create(StringValueSchema, { value: id }),
  });
}
async function publishExternal(
  factory: RecordingTransportFactory,
  value: ReturnType<typeof event>,
  source: string,
): Promise<void> {
  const publisher = await factory.createPublisher(
    create(ChannelIdSchema, { targetType: TypeUrls.derive(StringValueSchema) }),
  );
  const frame = wrapExternalEvent(value, create(BoundedContextNameSchema, { value: source }));
  try {
    await publisher.publish(required(frame.id, "external frame identity"), frame);
  } finally {
    await publisher.close();
  }
}

async function publishWanted(
  factory: RecordingTransportFactory,
  source: string,
  schemas: readonly (typeof StringValueSchema | typeof Int32ValueSchema)[],
): Promise<void> {
  const publisher = await factory.createPublisher(
    create(ChannelIdSchema, { targetType: TypeUrls.derive(ExternalEventsWantedSchema) }),
  );
  const id = {
    typeUrl: TypeUrls.derive(StringValueSchema),
    value: toBinary(StringValueSchema, create(StringValueSchema, { value: crypto.randomUUID() })),
  };
  try {
    await publisher.publish(
      id,
      create(ExternalMessageSchema, {
        id,
        originalMessage: {
          typeUrl: TypeUrls.derive(ExternalEventsWantedSchema),
          value: toBinary(
            ExternalEventsWantedSchema,
            create(ExternalEventsWantedSchema, {
              type: schemas.map((schema) => ({ typeUrl: TypeUrls.derive(schema) })),
            }),
          ),
        },
        boundedContextName: create(BoundedContextNameSchema, { value: source }),
      }),
    );
  } finally {
    await publisher.close();
  }
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

function required<Value>(value: Value | undefined, label: string): Value {
  if (value === undefined) throw new Error(`Expected ${label}.`);
  return value;
}
