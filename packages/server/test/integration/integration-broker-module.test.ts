/* Copyright 2026, CodeMatters. All rights reserved. Licensed under Apache-2.0. */
import { create, toBinary } from "@bufbuild/protobuf";
import { Int32ValueSchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import { TypeUrls } from "@spine-event-engine/core";
import {
  BoundedContextNameSchema,
  BoundedContextOnlineSchema,
  ChannelIdSchema,
  ExternalEventsWantedSchema,
  ExternalMessageSchema,
} from "@spine-event-engine/proto";
import { eventBusAccess } from "../../src/bus/event-bus.js";
import { afterEach, describe, expect, it } from "vitest";

import { IntegrationBroker } from "../../src/integration/integration-broker.js";
import { wrapBoundedContextOnline } from "../../src/integration/external-messages.js";
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
      transportFactory: factory as never,
      eventBus: bus,
      externalEventSchemas: schemas,
      postImported: async () => undefined,
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
      transportFactory: factory as never,
      eventBus: eventBusAccess.createForgettingBus(),
      externalEventSchemas: [],
      postImported: async () => undefined,
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
      transportFactory: factory as never,
      eventBus: eventBusAccess.createForgettingBus(),
      externalEventSchemas: [StringValueSchema],
      postImported: () => Promise.resolve(),
    });
    brokers.push(broker);
    await broker.open();
    const channel = create(ChannelIdSchema, {
      targetType: TypeUrls.derive(BoundedContextOnlineSchema),
    });
    const publisher = await factory.createPublisher(channel as never);
    for (const name of ["left", "left_System", "peer"]) {
      const frame = wrapBoundedContextOnline(
        create(BoundedContextOnlineSchema, {
          context: create(BoundedContextNameSchema, { value: name }),
        }),
      );
      await publisher.publish(frame.id!, frame);
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

  it("installs one publisher per type, retains it for another requester, then removes it", async () => {
    const factory = new RecordingTransportFactory();
    const bus = eventBusAccess.createForgettingBus();
    eventBusAccess.registerSchemas(bus, [StringValueSchema, Int32ValueSchema]);
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: "producer" }),
      transportFactory: factory as never,
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
});

async function publishWanted(
  factory: RecordingTransportFactory,
  source: string,
  schemas: readonly (typeof StringValueSchema | typeof Int32ValueSchema)[],
): Promise<void> {
  const publisher = await factory.createPublisher(
    create(ChannelIdSchema, { targetType: TypeUrls.derive(ExternalEventsWantedSchema) }) as never,
  );
  const id = {
    typeUrl: TypeUrls.derive(StringValueSchema),
    value: toBinary(StringValueSchema, create(StringValueSchema, { value: crypto.randomUUID() })),
  };
  try {
    await publisher.publish(
      id as never,
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
