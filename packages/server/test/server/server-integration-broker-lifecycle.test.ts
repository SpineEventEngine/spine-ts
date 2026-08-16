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

import { fromBinary } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { BoundedContext, EnvironmentType, ServerEnvironment } from "@spine-event-engine/server";
import { resetServerEnvironmentForTest } from "@spine-event-engine/server/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RecordingTransportFactory } from "../integration/wave13-red-support.js";

describe("Wave 13 broker lifecycle", () => {
  beforeEach(async () => resetServerEnvironmentForTest());
  afterEach(async () => resetServerEnvironmentForTest());
  it("RED-18 gives every BoundedContext one broker that withdraws, detaches, closes, aggregates failures, and supports retry cleanup", async () => {
    const factory = new RecordingTransportFactory();
    ServerEnvironment.when(EnvironmentType.Local).use({ transportFactory: factory });
    const first = await BoundedContext.singleTenant(`Wave13LifecycleA${crypto.randomUUID()}`)
      .addEventDispatcher({
        messageSchemas: () => [StringValueSchema],
        externalEventSchemas: () => [StringValueSchema],
        dispatch: () => Promise.resolve(),
      })
      .buildAsync();
    const second = await BoundedContext.singleTenant(
      `Wave13LifecycleB${crypto.randomUUID()}`,
    ).buildAsync();
    const environment = ServerEnvironment.instance() as unknown as { transportFactory: unknown };
    try {
      expect(environment.transportFactory).toBe(factory);
      for (const [targetType, publishers] of [
        ["type.spine.io/spine.server.integration.BoundedContextOnline", 2],
        ["type.spine.io/spine.server.integration.ExternalEventsWanted", 3],
      ] as const) {
        expect(channels(factory, "subscriber", targetType)).toHaveLength(2);
        expect(channels(factory, "publisher", targetType)).toHaveLength(publishers);
      }
      factory.failCloseAfter(1);
      await expect(first.close()).rejects.toBeInstanceOf(AggregateError);
      expect(factory.operations).toEqual(
        expect.arrayContaining(["publisher:close", "subscriber:close"]),
      );
      const failedAttemptCount = factory.operations.length;
      await first.close();
      expect(factory.operations.length).toBeGreaterThan(failedAttemptCount);
      expect(factory.operations.slice(failedAttemptCount)).not.toContain("consumer:remove");
      expect((await decodedWanted(factory)).at(-1)?.type).toEqual([]);
      await second.close();
    } finally {
      await ServerEnvironment.instance().close();
    }
    expect(factory.operations.indexOf("publisher:publish")).toBeLessThan(
      factory.operations.indexOf("consumer:remove"),
    );
    expect(factory.operations).toContain("subscriber:close");
    expect(factory.operations.at(-1)).toBe("factory:close");
  });
});

function channels(
  factory: RecordingTransportFactory,
  kind: "publisher" | "subscriber",
  targetType: string,
) {
  return factory.created.filter(
    (entry) =>
      entry.kind === kind && (entry.channel as { targetType?: string }).targetType === targetType,
  );
}

async function decodedWanted(
  factory: RecordingTransportFactory,
): Promise<readonly { readonly type: readonly unknown[] }[]> {
  const { ExternalEventsWantedSchema } = await import("@spine-event-engine/proto");
  return factory.published.flatMap(({ message }) => {
    const original = (message as { originalMessage?: { typeUrl?: string; value?: Uint8Array } })
      .originalMessage;
    if (
      original?.typeUrl !== "type.spine.io/spine.server.integration.ExternalEventsWanted" ||
      original.value === undefined
    )
      return [];
    return [fromBinary(ExternalEventsWantedSchema, original.value)];
  });
}
