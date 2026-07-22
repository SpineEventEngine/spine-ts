import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  FieldOptionsSchema,
  FileDescriptorSetSchema,
  FileOptionsSchema,
  SourceCodeInfoSchema,
} from "@bufbuild/protobuf/wkt";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildDescriptorSet,
  compareNormalizedDescriptorSets,
  normalizeDescriptorSet,
} from "../scripts/verify-descriptor-compatibility.mjs";

type DescriptorSet = ReturnType<typeof buildDescriptorSet>;
type DescriptorFile = DescriptorSet["file"][number];
type DescriptorMessage = DescriptorFile["messageType"][number];
type DescriptorField = DescriptorMessage["field"][number];

let descriptorSet: DescriptorSet;

beforeAll(() => {
  descriptorSet = buildDescriptorSet();
});

function clonedDescriptorSet(): DescriptorSet {
  return fromBinary(FileDescriptorSetSchema, toBinary(FileDescriptorSetSchema, descriptorSet));
}

function requireFile(set: DescriptorSet, name: string): DescriptorFile {
  const file = set.file.find((candidate) => candidate.name === name);
  if (file === undefined) {
    throw new Error(`Expected descriptor file ${name}.`);
  }
  return file;
}

function requireMessage(file: DescriptorFile, name: string): DescriptorMessage {
  const message = file.messageType.find((candidate) => candidate.name === name);
  if (message === undefined) {
    throw new Error(`Expected message ${name} in ${file.name}.`);
  }
  return message;
}

function requireField(message: DescriptorMessage, name: string): DescriptorField {
  const field = message.field.find((candidate) => candidate.name === name);
  if (field === undefined) {
    throw new Error(`Expected field ${name} in ${message.name}.`);
  }
  return field;
}

function requireFirst<T>(items: readonly T[], description: string): T {
  const item = items[0];
  if (item === undefined) {
    throw new Error(`Expected ${description}.`);
  }
  return item;
}

function commandMessage(set: DescriptorSet) {
  return requireMessage(requireFile(set, "spine/core/command.proto"), "Command");
}

function scalarCommandField(set: DescriptorSet) {
  return requireField(
    requireMessage(requireFile(set, "spine/core/tenant_id.proto"), "TenantId"),
    "value",
  );
}

function typedCommandField(set: DescriptorSet) {
  return requireField(commandMessage(set), "id");
}

function commandServiceMethod(set: DescriptorSet) {
  const service = requireFirst(
    requireFile(set, "spine/client/command_service.proto").service,
    "CommandService descriptor",
  );
  return requireFirst(service.method, "CommandService method descriptor");
}

describe("frozen Spine descriptor compatibility", () => {
  it("normalizes only source_code_info", () => {
    const withSourceInfo = clonedDescriptorSet();
    const file = requireFirst(withSourceInfo.file, "descriptor fixture file");
    file.sourceCodeInfo = create(SourceCodeInfoSchema, {
      location: [{ path: [1], span: [0, 0, 0] }],
    });

    expect(compareNormalizedDescriptorSets(descriptorSet, withSourceInfo)).toEqual({ equal: true });
    expect(normalizeDescriptorSet(descriptorSet)).toEqual(normalizeDescriptorSet(withSourceInfo));
  });

  it("detects every compatibility-relevant descriptor category", () => {
    const cases: readonly [string, (set: DescriptorSet) => void][] = [
      ["file identity", (set) => (requireFirst(set.file, "file").name = "renamed.proto")],
      ["package", (set) => (requireFirst(set.file, "file").package = "spine.changed")],
      ["import", (set) => requireFirst(set.file, "file").dependency.push("spine/changed.proto")],
      ["message name", (set) => (commandMessage(set).name = "Changed")],
      ["field name", (set) => (scalarCommandField(set).name = "changed")],
      ["field number", (set) => (scalarCommandField(set).number += 100)],
      ["scalar field type", (set) => (scalarCommandField(set).type = 8)],
      ["referenced field type name", (set) => (typedCommandField(set).typeName = ".spine.changed.Message")],
      ["field label", (set) => (scalarCommandField(set).label = 3)],
      ["oneof", (set) => (requireFirst(requireMessage(requireFile(set, "spine/core/tenant_id.proto"), "TenantId").oneofDecl, "TenantId oneof").name = "changed")],
      ["proto3 optional", (set) => (scalarCommandField(set).proto3Optional = !scalarCommandField(set).proto3Optional)],
      ["map-entry structure", (set) => {
        const mapEntry = requireFirst(
          requireMessage(requireFile(set, "spine/core/command.proto"), "CommandContext").nestedType,
          "CommandContext map-entry message",
        );
        if (mapEntry.options === undefined) {
          throw new Error("Expected map-entry options.");
        }
        mapEntry.options.mapEntry = !mapEntry.options.mapEntry;
      }],
      ["packed option", (set) => {
        scalarCommandField(set).options = fromBinary(FieldOptionsSchema, Buffer.from([0x10, 0x01]));
      }],
      ["default option", (set) => (scalarCommandField(set).defaultValue = "changed")],
      ["JSON name", (set) => (scalarCommandField(set).jsonName = "changedName")],
      ["enum name", (set) => (requireFirst(requireFile(set, "spine/core/command.proto").enumType, "command enum").name = "Changed")],
      ["message extension range", (set) => (requireFirst(requireMessage(requireFile(set, "google/protobuf/descriptor.proto"), "FileDescriptorSet").extensionRange, "message extension range").start += 1)],
      ["extension declaration", (set) => (requireFirst(requireFile(set, "spine/options.proto").extension, "Spine option extension").name = "changed")],
      ["custom option bytes", (set) => (requireFirst(set.file, "file").options = fromBinary(FileOptionsSchema, Buffer.from([0x88, 0xb5, 0x18, 0x01])))],
      ["service name", (set) => (requireFirst(requireFile(set, "spine/client/command_service.proto").service, "CommandService").name = "Changed")],
      ["method name", (set) => (commandServiceMethod(set).name = "Changed")],
      ["RPC input", (set) => (commandServiceMethod(set).inputType = ".spine.changed.Input")],
      ["RPC output", (set) => (commandServiceMethod(set).outputType = ".spine.changed.Output")],
      ["RPC client streaming", (set) => (commandServiceMethod(set).clientStreaming = !commandServiceMethod(set).clientStreaming)],
      ["RPC server streaming", (set) => (commandServiceMethod(set).serverStreaming = !commandServiceMethod(set).serverStreaming)],
    ];

    for (const [category, mutate] of cases) {
      const changed = clonedDescriptorSet();
      mutate(changed);
      expect(compareNormalizedDescriptorSets(descriptorSet, changed), category).toEqual({ equal: false });
    }
  });
});
