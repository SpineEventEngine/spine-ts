import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { CommandSchema, EventSchema, file_spine_options } from "@spine-ts/proto";
import { serverEntityMetadataTestFixtures } from "../test-fixtures/entity-metadata-fixtures.js";

import { defineEntityHandlers, describeEntityMetadata, HandlerMetadataError } from "./index.js";

type ProjectionState = Message<"ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

class TaskProjection {
  assignCreate(command: Message<"spine.core.Command">): void {
    void command;
  }

  commandFromCommand(command: Message<"spine.core.Command">): void {
    void command;
  }

  subscribeCreated(event: Message<"spine.core.Event">): void {
    void event;
  }

  reactToCreated(event: Message<"spine.core.Event">): void {
    void event;
  }

  applyCreated(event: Message<"spine.core.Event">): void {
    void event;
  }
}

function createFixtureFileDescriptor(descriptorSetBase64: string, imports = [file_spine_options]) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Server handler metadata fixture descriptor set is empty.");
  }

  return fileDesc(
    Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"),
    imports,
  );
}

const fileEntityMetadataFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.main.descriptorSetBase64,
);
const ProjectionStateSchema = messageDesc(
  fileEntityMetadataFixture,
  0,
) as GenMessage<ProjectionState>;

describe("handler metadata", () => {
  it("defines frozen explicit handler metadata in declaration order", () => {
    const entity = describeEntityMetadata(ProjectionStateSchema);

    const metadata = defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
      builder.command(CommandSchema, "commandFromCommand"),
      builder.subscribe(EventSchema, "subscribeCreated"),
      builder.react(EventSchema, "reactToCreated"),
      builder.apply(EventSchema, "applyCreated", { allowImport: true }),
    ]);

    expect(metadata.entity).toMatchObject({
      fullTypeName: entity.fullTypeName,
      kind: entity.kind,
      visibility: entity.visibility,
    });
    expect(metadata.entityType).toBe(TaskProjection);
    expect(metadata.handlers.map((handler) => handler.kind)).toEqual([
      "command-assignment",
      "command-reaction",
      "event-subscription",
      "event-reaction",
      "event-application",
    ]);
    expect(metadata.handlers.map((handler) => handler.methodName)).toEqual([
      "assignCreate",
      "commandFromCommand",
      "subscribeCreated",
      "reactToCreated",
      "applyCreated",
    ]);
    expect(metadata.handlers.map((handler) => handler.messageFullTypeName)).toEqual([
      "spine.core.Command",
      "spine.core.Command",
      "spine.core.Event",
      "spine.core.Event",
      "spine.core.Event",
    ]);
    expect(metadata.commandAssignments[0]).toBe(metadata.handlers[0]);
    expect(metadata.commandReactions[0]).toBe(metadata.handlers[1]);
    expect(metadata.eventSubscriptions[0]).toBe(metadata.handlers[2]);
    expect(metadata.eventReactions[0]).toBe(metadata.handlers[3]);
    expect(metadata.eventApplications[0]).toBe(metadata.handlers[4]);
    expect(metadata.eventApplications[0]?.allowImport).toBe(true);

    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata.handlers)).toBe(true);
    expect(Object.isFrozen(metadata.handlers[0])).toBe(true);
    expect(Object.isFrozen(metadata.eventApplications)).toBe(true);
  });

  it("rejects method names that do not exist on the entity prototype", () => {
    expect(() =>
      defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
        builder.assign(CommandSchema, "missingMethod" as never),
      ]),
    ).toThrow(HandlerMetadataError);
    expect(() =>
      defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
        builder.assign(CommandSchema, "missingMethod" as never),
      ]),
    ).toThrow(/must exist on the registered entity prototype/);
  });
});
