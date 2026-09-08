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

import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { AnyMessages } from "@spine-event-engine/core";
import { EventSchema, file_spine_options } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import { AbstractEventSubscriber } from "../../src/handler/standalone.js";
import type { GeneratedStandaloneHandlerGroup } from "../../src/handler/generated-handler-registry.js";
import { StandaloneHandlerRuntime } from "../../src/runtime/standalone-handler-runtime.js";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

type TaskEvent = Message<"TaskEvent"> & { id: string; name: string };

const descriptorSet = fromBinary(
  FileDescriptorSetSchema,
  Buffer.from(serverEntityMetadataTestFixtures.handlerRegistryEvents.descriptorSetBase64, "base64"),
);
const descriptor = descriptorSet.file[0];
if (descriptor === undefined) throw new Error("Expected Event fixture descriptor.");
const TaskEventSchema = messageDesc(
  fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [
    file_spine_options,
  ]),
  1,
) as GenMessage<TaskEvent>;

class FilteredSubscriber extends AbstractEventSubscriber {
  readonly calls: string[] = [];

  selected(): void {
    this.calls.push("selected");
  }

  fallback(): void {
    this.calls.push("fallback");
  }
}

describe("StandaloneHandlerRuntime", () => {
  it("selects the matching @Where standalone event subscriber instead of its fallback", async () => {
    const receiver = new FilteredSubscriber();
    const group: GeneratedStandaloneHandlerGroup = {
      receiverKind: "standalone",
      receiverType: FilteredSubscriber,
      handlers: [
        {
          kind: "event-subscription",
          methodName: "selected",
          signalSchema: TaskEventSchema,
          emittedSchemas: [],
          parameterCount: 1,
          origin: "domestic",
          where: { eventField: "name", equals: "selected" },
        },
        {
          kind: "event-subscription",
          methodName: "fallback",
          signalSchema: TaskEventSchema,
          emittedSchemas: [],
          parameterCount: 1,
          origin: "domestic",
        },
      ],
    };
    const runtime = new StandaloneHandlerRuntime([
      { group, instance: receiver, publisher: {} as never },
    ]);
    const dispatcher = runtime.eventDispatcher();
    if (dispatcher === undefined) throw new Error("Expected standalone Event dispatcher.");

    await dispatcher.dispatch(
      create(EventSchema, {
        id: { value: "event-1" },
        message: AnyMessages.pack(TaskEventSchema, create(TaskEventSchema, { name: "selected" })),
      }),
    );

    expect(receiver.calls).toEqual(["selected"]);
  });
});
