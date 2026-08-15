/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { create, toBinary } from "@bufbuild/protobuf";
import { AnySchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import { ChannelIdSchema, ExternalMessageSchema } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";
import { InMemoryTransportFactory } from "../../src/memory/message-transport.js";

const channel = () => create(ChannelIdSchema, { targetType: "type.spine.io/wave13.Memory" });
const frame = (value: string) => {
  const id = create(AnySchema, {
    typeUrl: "type.spine.io/google.protobuf.StringValue",
    value: toBinary(StringValueSchema, create(StringValueSchema, { value })),
  });
  return {
    id,
    message: create(ExternalMessageSchema, {
      id,
      originalMessage: id,
      boundedContextName: { value: "Producer" },
    }),
  };
};

describe("InMemoryTransportFactory", () => {
  it("fans out copied frames and removes consumers idempotently", async () => {
    const factory = new InMemoryTransportFactory();
    const first = await factory.createSubscriber(channel());
    const second = await factory.createSubscriber(channel());
    const received: string[] = [];
    const firstHandle = await first.addConsumer((message) => received.push(message.id.typeUrl));
    const secondHandle = await second.addConsumer((message) => received.push(message.id.typeUrl));
    const publisher = await factory.createPublisher(channel());
    const current = frame("one");
    await publisher.publish(current.id, current.message);
    await firstHandle.close();
    await firstHandle.close();
    await publisher.publish(current.id, current.message);
    expect(received).toEqual([
      "type.spine.io/google.protobuf.StringValue",
      "type.spine.io/google.protobuf.StringValue",
      "type.spine.io/google.protobuf.StringValue",
    ]);
    expect(first.isStale()).toBe(true);
    await Promise.all([
      secondHandle.close(),
      publisher.close(),
      first.close(),
      second.close(),
      factory.close(),
    ]);
  });

  it("serializes accepted publishes and drains them before close", async () => {
    const factory = new InMemoryTransportFactory();
    const subscriber = await factory.createSubscriber(channel());
    const values: string[] = [];
    const handle = await subscriber.addConsumer(async (message) => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      values.push(String.fromCharCode(message.id.value.at(-1) ?? 0));
    });
    const publisher = await factory.createPublisher(channel());
    const one = frame("1");
    const two = frame("2");
    const first = publisher.publish(one.id, one.message);
    const second = publisher.publish(two.id, two.message);
    const closing = publisher.close();
    await expect(publisher.publish(one.id, one.message)).rejects.toThrow(/closed/u);
    await Promise.all([first, second, closing]);
    expect(values).toEqual(["1", "2"]);
    await Promise.all([handle.close(), subscriber.close(), factory.close()]);
  });

  it("rejects new work after factory close while draining accepted publication", async () => {
    const factory = new InMemoryTransportFactory();
    const subscriber = await factory.createSubscriber(channel());
    const received: string[] = [];
    const handle = await subscriber.addConsumer(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      received.push("delivered");
    });
    const publisher = await factory.createPublisher(channel());
    const current = frame("close");
    const accepted = publisher.publish(current.id, current.message);
    await factory.close();
    await accepted;
    expect(received).toEqual(["delivered"]);
    await expect(factory.createSubscriber(channel())).rejects.toThrow(/closed/u);
    await handle.close();
  });

  it("copies channel identity and rejects malformed identity and frame boundaries", async () => {
    const factory = new InMemoryTransportFactory();
    await expect(factory.createPublisher(create(ChannelIdSchema))).rejects.toThrow(/canonical/u);
    const mutable = channel();
    const subscriber = await factory.createSubscriber(mutable);
    mutable.targetType = "type.spine.io/changed";
    expect(subscriber.targetType).toBe("type.spine.io/wave13.Memory");
    const publisher = await factory.createPublisher(channel());
    const invalid = create(ExternalMessageSchema);
    await expect(publisher.publish(create(AnySchema), invalid)).rejects.toThrow(/identity/u);
    await Promise.all([publisher.close(), subscriber.close(), factory.close()]);
  });
});
