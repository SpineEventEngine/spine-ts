/* Copyright 2026, CodeMatters. All rights reserved. Licensed under Apache-2.0. */
import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { TypeUrls } from "@spine-event-engine/core";
import {
  BoundedContextNameSchema,
  BoundedContextOnlineSchema,
  ChannelIdSchema,
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
});
