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

import { create, toBinary } from "@bufbuild/protobuf";
import { AnySchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import {
  BoundedContextNameSchema,
  ChannelIdSchema,
  ExternalMessageSchema,
} from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import { InMemoryTransportFactory } from "../../src/index.js";

describe("InMemoryTransportFactory", () => {
  it("keeps canonical typed-channel fan-out, stale, and close behavior", async () => {
    const factory = new InMemoryTransportFactory();
    const channel = create(ChannelIdSchema, { targetType: "type.spine.io/wave13.Conformance" });
    const first = await factory.createSubscriber(channel);
    const second = await factory.createSubscriber(channel);
    const values: string[] = [];
    const firstHandle = await first.addConsumer((message) => {
      values.push(message.originalMessage?.typeUrl ?? "");
    });
    const secondHandle = await second.addConsumer((message) => {
      values.push(message.originalMessage?.typeUrl ?? "");
    });
    const publisher = await factory.createPublisher(channel);

    await publisher.publish(frame("first"), externalMessage("first"));
    expect(values).toEqual([frame("first").typeUrl, frame("first").typeUrl]);
    await firstHandle.close();
    expect(first.isStale()).toBe(true);
    await publisher.publish(frame("second"), externalMessage("second"));
    expect(values).toEqual([
      frame("first").typeUrl,
      frame("first").typeUrl,
      frame("second").typeUrl,
    ]);
    await secondHandle.close();
    await Promise.all([publisher.close(), first.close(), second.close(), factory.close()]);
  });

  it("rejects noncanonical channel target type URLs", async () => {
    const factory = new InMemoryTransportFactory();
    await expect(
      factory.createPublisher(create(ChannelIdSchema, { targetType: "not-a-type-url" })),
    ).rejects.toThrow(/targetType|canonical/u);
    await expect(
      factory.createSubscriber(create(ChannelIdSchema, { targetType: "type.spine.io/" })),
    ).rejects.toThrow(/targetType|canonical/u);
    await factory.close();
  });

  it("rejects malformed or mismatched message identities", async () => {
    const factory = new InMemoryTransportFactory();
    const channel = create(ChannelIdSchema, { targetType: "type.spine.io/wave13.Validation" });
    const publisher = await factory.createPublisher(channel);
    await expect(
      publisher.publish(frame("identity"), create(ExternalMessageSchema)),
    ).rejects.toThrow("External message must contain identity");
    await expect(publisher.publish(frame("identity"), externalMessage("other"))).rejects.toThrow(
      "External message identity must match",
    );
    await expect(publisher.close()).rejects.toThrow("Accepted message publication failed");
    await factory.close();
  });

  it("drains FIFO publications before publisher close", async () => {
    const factory = new InMemoryTransportFactory();
    const channel = create(ChannelIdSchema, { targetType: "type.spine.io/wave13.Fifo" });
    const subscriber = await factory.createSubscriber(channel);
    const values: string[] = [];
    await subscriber.addConsumer((message) => {
      values.push(message.originalMessage?.typeUrl ?? "");
    });
    const publisher = await factory.createPublisher(channel);
    const first = publisher.publish(frame("first"), externalMessage("first"));
    const second = publisher.publish(frame("second"), externalMessage("second"));
    await Promise.all([first, second, publisher.close()]);
    expect(values).toEqual([frame("first").typeUrl, frame("second").typeUrl]);
    await Promise.all([subscriber.close(), factory.close()]);
  });

  it("drains accepted publication when the factory closes and rejects later channels", async () => {
    const factory = new InMemoryTransportFactory();
    const channel = create(ChannelIdSchema, { targetType: "type.spine.io/wave13.FactoryClose" });
    const subscriber = await factory.createSubscriber(channel);
    const consumerStarted = Promise.withResolvers<void>();
    const releaseConsumer = Promise.withResolvers<void>();
    const values: string[] = [];
    await subscriber.addConsumer(async (message) => {
      values.push(message.originalMessage?.typeUrl ?? "");
      consumerStarted.resolve();
      await releaseConsumer.promise;
    });
    const publisher = await factory.createPublisher(channel);
    const publication = publisher.publish(frame("accepted"), externalMessage("accepted"));
    await consumerStarted.promise;

    const firstClose = factory.close();
    expect(factory.close()).toBe(firstClose);
    releaseConsumer.resolve();

    await Promise.all([publication, firstClose]);
    expect(values).toEqual([frame("accepted").typeUrl]);
    await expect(factory.createPublisher(channel)).rejects.toThrow(
      "In-memory message transport is closed",
    );
  });

  it("propagates consumer failures through publication and publisher close", async () => {
    const factory = new InMemoryTransportFactory();
    const channel = create(ChannelIdSchema, { targetType: "type.spine.io/wave13.Failure" });
    const subscriber = await factory.createSubscriber(channel);
    await subscriber.addConsumer(() => {
      throw new Error("consumer failed");
    });
    const publisher = await factory.createPublisher(channel);
    await expect(publisher.publish(frame("failed"), externalMessage("failed"))).rejects.toThrow(
      "consumer failed",
    );
    await expect(publisher.close()).rejects.toThrow("Accepted message publication failed");
    await Promise.all([subscriber.close(), factory.close()]);
  });

  it("defensively copies frames before consumer delivery", async () => {
    const factory = new InMemoryTransportFactory();
    const channel = create(ChannelIdSchema, { targetType: "type.spine.io/wave13.Copy" });
    const subscriber = await factory.createSubscriber(channel);
    const values: string[] = [];
    await subscriber.addConsumer((message) => {
      values.push(message.boundedContextName?.value ?? "");
      if (message.boundedContextName !== undefined) message.boundedContextName.value = "mutated";
    });
    await subscriber.addConsumer((message) => {
      values.push(message.boundedContextName?.value ?? "");
    });
    const publisher = await factory.createPublisher(channel);
    const message = externalMessage("copy");
    await publisher.publish(frame("copy"), message);
    expect(values).toEqual(["memory-test", "memory-test"]);
    expect(message.boundedContextName?.value).toBe("memory-test");
    await Promise.all([publisher.close(), subscriber.close(), factory.close()]);
  });
});

function frame(value: string) {
  return create(AnySchema, {
    typeUrl: "type.spine.io/google.protobuf.StringValue",
    value: toBinary(StringValueSchema, create(StringValueSchema, { value })),
  });
}

function externalMessage(value: string) {
  return create(ExternalMessageSchema, {
    id: frame(value),
    originalMessage: frame(value),
    boundedContextName: create(BoundedContextNameSchema, { value: "memory-test" }),
  });
}
