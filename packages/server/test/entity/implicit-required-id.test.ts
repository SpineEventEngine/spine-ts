import { create, setExtension, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FieldOptionsSchema,
  FileDescriptorProtoSchema,
} from "@bufbuild/protobuf/wkt";
import { file_spine_options } from "@spine-event-engine/proto";
import { required } from "@spine-event-engine/proto/generated/spine/options_pb.js";
import { describe, expect, it } from "vitest";

import { ImplicitRequiredIds } from "../../src/entity/implicit-required-id.js";

const implicitString = commandSchema("implicit_string_commands.proto", "ImplicitString", {
  name: "id",
  type: FieldDescriptorProto_Type.STRING,
});
const explicitFalse = commandSchema("explicit_false_commands.proto", "ExplicitFalse", {
  name: "id",
  type: FieldDescriptorProto_Type.STRING,
  required: false,
});
const numeric = commandSchema("numeric_commands.proto", "Numeric", {
  name: "id",
  type: FieldDescriptorProto_Type.INT32,
});
const ordinary = commandSchema("ordinary.proto", "Ordinary", {
  name: "id",
  type: FieldDescriptorProto_Type.STRING,
});

describe("implicit declaration-first ID validation", () => {
  it("rejects an empty declaration-first Command string with one field violation", () => {
    const result = ImplicitRequiredIds.validateCommand(implicitString, create(implicitString));

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("Expected an implicit ID violation.");
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].fieldPath?.fieldName).toEqual(["id"]);
    expect(result.violations[0].typeName).toBe(implicitString.typeName);
  });

  it("uses declaration order instead of field number order", () => {
    const schema = commandSchema("ordered_commands.proto", "Ordered", {
      name: "id",
      number: 7,
      type: FieldDescriptorProto_Type.STRING,
    });

    expect(ImplicitRequiredIds.validateCommand(schema, create(schema)).valid).toBe(false);
  });

  it("honors explicit false and excludes numeric and ordinary first fields", () => {
    expect(ImplicitRequiredIds.validateCommand(explicitFalse, create(explicitFalse)).valid).toBe(
      true,
    );
    expect(ImplicitRequiredIds.validateCommand(numeric, create(numeric)).valid).toBe(true);
    expect(ImplicitRequiredIds.validateCommand(ordinary, create(ordinary)).valid).toBe(true);
  });
});

interface FieldInput {
  readonly name: string;
  readonly number?: number;
  readonly type: FieldDescriptorProto_Type;
  readonly required?: boolean;
}

function commandSchema(fileName: string, messageName: string, field: FieldInput) {
  const options = create(FieldOptionsSchema);
  if (field.required !== undefined) setExtension(options, required, field.required);
  const descriptor = create(FileDescriptorProtoSchema, {
    name: fileName,
    package: "example.implicit",
    syntax: "proto3",
    dependency: [file_spine_options.name],
    messageType: [
      {
        name: messageName,
        field: [
          {
            name: field.name,
            number: field.number ?? 1,
            label: FieldDescriptorProto_Label.OPTIONAL,
            type: field.type,
            options,
          },
          {
            name: "later",
            number: field.number === 7 ? 1 : 2,
            label: FieldDescriptorProto_Label.OPTIONAL,
            type: FieldDescriptorProto_Type.STRING,
          },
        ],
      },
    ],
  });
  const file = fileDesc(
    Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"),
    [file_spine_options],
  );
  return messageDesc(file, 0) as GenMessage<Message>;
}
