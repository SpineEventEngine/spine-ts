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
import {
  AbstractAssignee,
  AbstractCommander,
  AbstractEventReactor,
  AbstractEventSubscriber,
  Aggregate,
  HandlerRegistryIngestionError,
  HandlerRegistryIngestor,
  ProcessManager,
} from "../../src/index.js";

type State = Message<"ProjectionState"> & { id: string; name: string; priority: number };
const descriptorSet = fromBinary(FileDescriptorSetSchema, Buffer.from(serverEntityMetadataTestFixtures.main.descriptorSetBase64, "base64"));
const descriptor = descriptorSet.file[0];
if (descriptor === undefined) throw new Error("Expected Entity fixture descriptor.");
const StateSchema = messageDesc(fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [file_spine_options]), 0) as GenMessage<State>;

function handlerRegistrySchema(descriptorSetBase64: string, index: number) {
  const set = fromBinary(FileDescriptorSetSchema, Buffer.from(descriptorSetBase64, "base64"));
  const descriptor = set.file[0];
  if (descriptor === undefined) throw new Error("Expected handler-registry fixture descriptor.");
  return messageDesc(
    fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [file_spine_options]),
    index,
  );
}

const StartReviewSchema = handlerRegistrySchema(
  serverEntityMetadataTestFixtures.handlerRegistryCommands.descriptorSetBase64,
  0,
);
const ScheduleReviewSchema = handlerRegistrySchema(
  serverEntityMetadataTestFixtures.handlerRegistryCommands.descriptorSetBase64,
  1,
);
const ReviewStartedSchema = handlerRegistrySchema(
  serverEntityMetadataTestFixtures.handlerRegistryEvents.descriptorSetBase64,
  0,
);
const ReviewRejectedSchema = handlerRegistrySchema(
  serverEntityMetadataTestFixtures.handlerRegistryRejections.descriptorSetBase64,
  0,
);
const ReviewStateSchema = handlerRegistrySchema(
  serverEntityMetadataTestFixtures.handlerRegistryStates.descriptorSetBase64,
  0,
);
class Manager extends ProcessManager<string, typeof StateSchema, number> { substitute(command: Message<"spine.core.Command">) { return command; } }
class AggregateReceiver extends Aggregate<string, typeof StateSchema, number> { substitute(command: Message<"spine.core.Command">) { return command; } }
class Commander extends AbstractCommander { replace(command: Message<"spine.core.Command">) { return command; } }
class Assignee extends AbstractAssignee {}
class Reactor extends AbstractEventReactor {}
class Subscriber extends AbstractEventSubscriber {}
const substitution = (methodName = "substitute") => ({ kind: "command-substitution" as const, methodName, signalSchema: CommandSchema, emittedSchemas: [CommandSchema], parameterCount: 1 as const, origin: "domestic" as const });

const roleMatrix = [
  ["assignee", Assignee, ["command-assignment"]],
  ["commander", Commander, ["command-substitution", "command-reaction"]],
  ["reactor", Reactor, ["event-reaction"]],
  ["subscriber", Subscriber, ["event-subscription", "state-subscription"]],
] as const;

function domainHandler(kind: string) {
  const signalSchema =
    kind === "command-assignment" || kind === "command-substitution"
      ? StartReviewSchema
      : kind === "state-subscription"
        ? ReviewStateSchema
        : ReviewStartedSchema;
  const emittedSchemas =
    kind === "command-assignment" || kind === "event-reaction"
      ? [ReviewStartedSchema]
      : kind === "command-substitution" || kind === "command-reaction"
        ? [ScheduleReviewSchema]
        : [];
  return { kind, methodName: "handle", signalSchema, emittedSchemas, parameterCount: 1, origin: "domestic" };
}

describe("generated handler registry ingestion", () => {
  it.each(roleMatrix)("enforces the handler-kind matrix for %s", (_role, receiverType, allowed) => {
    for (const kind of ["command-assignment", "command-substitution", "command-reaction", "event-reaction", "event-subscription", "state-subscription"]) {
      const ingest = () => new HandlerRegistryIngestor().ingest({ receivers: [{ receiverKind: "standalone", receiverType, handlers: [domainHandler(kind)] }] });
      if (allowed.includes(kind as never)) expect(ingest).not.toThrow(); else expect(ingest).toThrow(HandlerRegistryIngestionError);
    }
  });
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
  it("rejects a standalone commander that declares Event output", () => {
    expect(() => new HandlerRegistryIngestor().ingest({ receivers: [{ receiverKind: "standalone" as const, receiverType: Commander, handlers: [{ ...substitution("replace"), emittedSchemas: [StateSchema] }] }] })).toThrow(HandlerRegistryIngestionError);
  });
  it("rejects a standalone assignee that declares Entity state output", () => {
    class Assignee extends AbstractAssignee { assign(command: Message<"spine.core.Command">) { return command; } }
    expect(() => new HandlerRegistryIngestor().ingest({ receivers: [{ receiverKind: "standalone" as const, receiverType: Assignee, handlers: [{ ...substitution("assign"), kind: "command-assignment", emittedSchemas: [StateSchema] }] }] })).toThrow(HandlerRegistryIngestionError);
  });
});
