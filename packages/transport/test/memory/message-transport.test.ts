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
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
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
    const firstHandle = await first.addConsumer((message) => values.push(message.originalMessage.typeUrl));
    const secondHandle = await second.addConsumer((message) => values.push(message.originalMessage.typeUrl));
    const publisher = await factory.createPublisher(channel);

    await publisher.publish(
      frame("first"),
      externalMessage("first"),
    );
    expect(values).toEqual([frame("first").typeUrl, frame("first").typeUrl]);
    await firstHandle.close();
    expect(first.isStale()).toBe(true);
    await publisher.publish(
      frame("second"),
      externalMessage("second"),
    );
    expect(values).toEqual([frame("first").typeUrl, frame("first").typeUrl, frame("second").typeUrl]);
    await secondHandle.close();
    await Promise.all([publisher.close(), first.close(), second.close(), factory.close()]);
  });

  it("rejects noncanonical channel target type URLs", async () => {
    const factory = new InMemoryTransportFactory();
    await expect(factory.createPublisher({ targetType: "not-a-type-url" })).rejects.toThrow(
      /targetType|canonical/u,
    );
    await expect(factory.createSubscriber({ targetType: "type.spine.io/" })).rejects.toThrow(
      /targetType|canonical/u,
    );
    await factory.close();
  });
});

function frame(value: string) {
  return {
    typeUrl: "type.spine.io/google.protobuf.StringValue",
    value: toBinary(StringValueSchema, create(StringValueSchema, { value })),
  };
}

function externalMessage(value: string) {
  return create(ExternalMessageSchema, {
    id: frame(value),
    originalMessage: frame(value),
    boundedContextName: create(BoundedContextNameSchema, { value: "memory-test" }),
  });
}
