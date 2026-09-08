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
import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { CommandSchema, file_spine_options } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";
import { Aggregate, HandlerRegistryIngestionError, HandlerRegistryIngestor, ProcessManager } from "../../src/index.js";

type State = Message<"ProjectionState"> & { id: string; name: string; priority: number };
const descriptorSet = fromBinary(FileDescriptorSetSchema, Buffer.from(serverEntityMetadataTestFixtures.main.descriptorSetBase64, "base64"));
const descriptor = descriptorSet.file[0];
if (descriptor === undefined) throw new Error("Expected Entity fixture descriptor.");
const StateSchema = messageDesc(fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [file_spine_options]), 0) as GenMessage<State>;
class Manager extends ProcessManager<string, typeof StateSchema, number> { substitute(command: Message<"spine.core.Command">) { return command; } }
class AggregateReceiver extends Aggregate<string, typeof StateSchema, number> { substitute(command: Message<"spine.core.Command">) { return command; } }
const substitution = (methodName = "substitute") => ({ kind: "command-substitution" as const, methodName, signalSchema: CommandSchema, emittedSchemas: [CommandSchema], parameterCount: 1 as const, origin: "domestic" as const });

describe("generated handler registry ingestion", () => {
  it("rejects a legacy versioned registry and tells applications to regenerate it", () => {
    expect(() => new HandlerRegistryIngestor().ingest({ version: 4, entities: [] })).toThrow(/regenerate/i);
  });
  it("ingests an unversioned entity receiver", () => {
    const metadata = new HandlerRegistryIngestor().ingest({ receivers: [{ receiverKind: "entity" as const, receiverType: Manager, stateSchema: StateSchema, handlers: [substitution()] }] });
    expect(metadata[0]?.commandSubstitutions).toHaveLength(1);
  });
  it("rejects an Aggregate command substitution", () => {
    expect(() => new HandlerRegistryIngestor().ingest({ receivers: [{ receiverKind: "entity" as const, receiverType: AggregateReceiver, stateSchema: StateSchema, handlers: [substitution()] }] })).toThrow(HandlerRegistryIngestionError);
  });
});
