/* Copyright 2026, CodeMatters. All rights reserved. Licensed under Apache-2.0. */
import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { TypeUrls } from "@spine-event-engine/core";
import { BoundedContextNameSchema } from "@spine-event-engine/proto";
import { eventBusAccess } from "../../src/bus/event-bus.js";
import { afterEach, describe, expect, it } from "vitest";

import { IntegrationBroker } from "../../src/integration/integration-broker.js";
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
});
