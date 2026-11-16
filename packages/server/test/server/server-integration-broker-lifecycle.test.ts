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

import { create } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { AnyPacker, TypeUrls } from "@spine-event-engine/core";
import { BoundedContextOnlineSchema, ExternalEventsWantedSchema } from "@spine-event-engine/proto";
import {
  Application,
  BoundedContext,
  EnvironmentType,
  ServerEnvironment,
} from "@spine-event-engine/server";
import { describe, expect, it } from "vitest";

import { RecordingTransportFactory } from "../integration/wave13-red-support.js";
import { ProjectCreatedSchema } from "../../test-fixtures/generated/repository-routing/project_events_pb.js";

describe("Wave 13 broker lifecycle", () => {
  // prettier-ignore
  it(
    "RED-18 gives every BoundedContext one broker that withdraws, detaches, closes, aggregates failures," +
      " and supports retry cleanup",
    async () => {
    const factory = new RecordingTransportFactory();
    const firstName = `Wave13LifecycleA${crypto.randomUUID()}`;
    const secondName = `Wave13LifecycleB${crypto.randomUUID()}`;
    const environment = ServerEnvironment.newBuilder()
      .under(EnvironmentType.Local, (configuration) =>
        { configuration.use({ integrationChannelFactory: factory }); },
      )
      .build();
    const application = await Application.newBuilder()
      .setServerEnvironment(environment)
      .add(
        BoundedContext.singleTenant(firstName).addEventDispatcher({
          messageSchemas: () => [ProjectCreatedSchema],
          externalEventSchemas: () => [ProjectCreatedSchema],
          dispatch: () => Promise.resolve(),
        }),
      )
      .add(BoundedContext.singleTenant(secondName))
      .build();
    const [first, second] = application.contexts();
    if (first === undefined || second === undefined)
      throw new Error("Expected both Bounded Contexts.");
    try {
      expect(environment.integrationChannelFactory).toBe(factory);
      const onlineType = "type.spine.io/spine.server.integration.BoundedContextOnline";
      const wantedType = "type.spine.io/spine.server.integration.ExternalEventsWanted";
      for (const [targetType, publishers] of [[onlineType, 2], [wantedType, 4]] as const) {
        expect(channels(factory, "subscriber", targetType)).toHaveLength(2);
        expect(channels(factory, "publisher", targetType)).toHaveLength(publishers);
      }
      expect(decodedOnline(factory)).toEqual(expect.arrayContaining([firstName, secondName]));
      expect(decodedOnline(factory)).toHaveLength(2);
      const wanted = decodedWanted(factory);
      expect(wanted).toHaveLength(4);
      for (const [name, types] of [
        [firstName, [TypeUrls.derive(ProjectCreatedSchema)]],
        [secondName, []],
      ] as const) {
        expect(wanted.filter((entry) => entry.origin === name)).toEqual([
          { origin: name, types },
          { origin: name, types },
        ]);
      }
      expect(channels(factory, "subscriber", TypeUrls.derive(ProjectCreatedSchema))).toHaveLength(1);
      factory.failCloseAfter(1);
      await expect(first.close()).rejects.toBeInstanceOf(AggregateError);
      expect(factory.operations).toEqual(
        expect.arrayContaining(["publisher:close", "subscriber:close"]),
      );
      const failedAttemptCount = factory.operations.length;
      await first.close();
      expect(factory.operations.length).toBeGreaterThan(failedAttemptCount);
      expect(factory.operations.slice(failedAttemptCount)).not.toContain("consumer:remove");
      expect(decodedWanted(factory).filter((entry) => entry.origin === firstName).at(-1)?.types).toEqual([]);
      await second.close();
      expect(decodedWanted(factory).filter((entry) => entry.origin === secondName).at(-1)?.types).toEqual([]);
    } finally {
      await application.close();
    }
    expect(factory.operations.indexOf("publisher:publish")).toBeLessThan(
      factory.operations.indexOf("consumer:remove"),
    );
    expect(factory.operations).toContain("subscriber:close");
    expect(factory.operations.at(-1)).toBe("factory:close");
    expect(factory.openPublisherTargets()).toEqual([]);
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

function decodedWanted(
  factory: RecordingTransportFactory,
): readonly { readonly origin: string; readonly types: readonly string[] }[] {
  return factory.published.flatMap(({ message }) => {
    const frame = message as {
      boundedContextName?: { value?: string };
      originalMessage?: { typeUrl?: string; value?: Uint8Array };
    };
    const original = frame.originalMessage;
    if (
      original?.typeUrl !== "type.spine.io/spine.server.integration.ExternalEventsWanted" ||
      original.value === undefined ||
      frame.boundedContextName?.value === undefined
    )
      return [];
    const wanted = AnyPacker.unpack(create(AnySchema, original), ExternalEventsWantedSchema);
    return [
      { origin: frame.boundedContextName.value, types: wanted.type.map((type) => type.typeUrl) },
    ];
  });
}

function decodedOnline(factory: RecordingTransportFactory): readonly string[] {
  return factory.published.flatMap(({ message }) => {
    const original = (message as { originalMessage?: { typeUrl?: string; value?: Uint8Array } })
      .originalMessage;
    if (
      original?.typeUrl !== "type.spine.io/spine.server.integration.BoundedContextOnline" ||
      original.value === undefined
    )
      return [];
    const online = AnyPacker.unpack(create(AnySchema, original), BoundedContextOnlineSchema);
    return online.context?.value === undefined ? [] : [online.context.value];
  });
}
