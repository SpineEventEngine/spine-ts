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

import { create, setExtension, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FieldOptionsSchema,
  FileDescriptorProtoSchema,
  MessageOptionsSchema,
} from "@bufbuild/protobuf/wkt";
import { file_spine_options } from "@spine-event-engine/proto";
import { required } from "@spine-event-engine/proto/generated/spine/options_pb.js";
import { describe, expect, it } from "vitest";

import { AnyMessages } from "@spine-event-engine/core";
import { CommandContextSchema, CommandIdSchema, CommandSchema } from "@spine-event-engine/proto";
import { CommandBus, type CommandDispatcher } from "../../src/index.js";
import { CommandValidationError } from "../../src/bus/command-errors.js";
import { ImplicitRequiredIds } from "../../src/entity/implicit-required-id.js";

type StringCommand = Message<"example.implicit.StringCommand"> & { id: string; later: string };
type BytesCommand = Message<"example.implicit.BytesCommand"> & {
  id: Uint8Array;
  later: string;
};
type RepeatedCommand = Message<"example.implicit.RepeatedCommand"> & {
  id: string[];
  later: string;
};
type IdMessage = Message<"example.implicit.Id"> & { value: string };
type EnumCommand = Message<"example.implicit.EnumCommand"> & { id: number };
type MessageCommand = Message<"example.implicit.MessageCommand"> & { id?: IdMessage };
type MapCommand = Message<"example.implicit.MapCommand"> & { id: Record<string, string> };

const implicitString = commandSchema<StringCommand>(
  "implicit_string_commands.proto",
  "ImplicitString",
  {
    name: "id",
    type: FieldDescriptorProto_Type.STRING,
  },
);
const explicitFalse = commandSchema<StringCommand>(
  "explicit_false_commands.proto",
  "ExplicitFalse",
  {
    name: "id",
    type: FieldDescriptorProto_Type.STRING,
    required: false,
  },
);
const numeric = commandSchema("numeric_commands.proto", "Numeric", {
  name: "id",
  type: FieldDescriptorProto_Type.INT32,
});
const boolean = commandSchema("boolean_commands.proto", "Boolean", {
  name: "id",
  type: FieldDescriptorProto_Type.BOOL,
});
const conventional = commandSchema("task/commands.proto", "Conventional", {
  name: "id",
  type: FieldDescriptorProto_Type.STRING,
});
const ordinary = commandSchema<StringCommand>("ordinary.proto", "Ordinary", {
  name: "id",
  type: FieldDescriptorProto_Type.STRING,
});
const misleading = commandSchema<StringCommand>("notcommands.proto", "Misleading", {
  name: "id",
  type: FieldDescriptorProto_Type.STRING,
});
const eventMessage = commandSchema<StringCommand>("events.proto", "EventMessage", {
  name: "id",
  type: FieldDescriptorProto_Type.STRING,
});
const rejectionMessage = commandSchema<StringCommand>("rejections.proto", "RejectionMessage", {
  name: "id",
  type: FieldDescriptorProto_Type.STRING,
});
const explicitTrue = commandSchema<StringCommand>("explicit_true_commands.proto", "ExplicitTrue", {
  name: "id",
  type: FieldDescriptorProto_Type.STRING,
  required: true,
});
const bytes = commandSchema<BytesCommand>("bytes_commands.proto", "Bytes", {
  name: "id",
  type: FieldDescriptorProto_Type.BYTES,
});
const repeated = commandSchema<RepeatedCommand>("repeated_commands.proto", "Repeated", {
  name: "id",
  type: FieldDescriptorProto_Type.STRING,
  label: FieldDescriptorProto_Label.REPEATED,
});
const shaped = shapeSchemas();

describe("implicit declaration-first ID validation", () => {
  it("rejects an empty declaration-first Command string with one field violation", () => {
    const result = ImplicitRequiredIds.validateCommand(implicitString, create(implicitString));

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("Expected an implicit ID violation.");
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].fieldPath?.fieldName).toEqual(["id"]);
    expect(result.violations[0].typeName).toBe(implicitString.typeName);
    expect(result.violations[0].message?.placeholderValue).toEqual({
      "field.path": "[redacted]",
      "field.type": "[redacted]",
      "message.type": "[redacted]",
      "parent.type": "[redacted]",
    });
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
    expect(ImplicitRequiredIds.validateCommand(boolean, create(boolean)).valid).toBe(true);
    expect(ImplicitRequiredIds.validateCommand(ordinary, create(ordinary)).valid).toBe(true);
    expect(ImplicitRequiredIds.validateCommand(misleading, create(misleading)).valid).toBe(true);
    expect(ImplicitRequiredIds.validateCommand(eventMessage, create(eventMessage)).valid).toBe(
      true,
    );
    expect(
      ImplicitRequiredIds.validateCommand(rejectionMessage, create(rejectionMessage)).valid,
    ).toBe(true);
  });

  it("recognizes the exact conventional commands.proto basename", () => {
    expect(ImplicitRequiredIds.validateCommand(conventional, create(conventional)).valid).toBe(
      false,
    );
  });

  it("supports bytes, enum, message, repeated, and map presence", () => {
    expect(ImplicitRequiredIds.validateCommand(bytes, create(bytes)).valid).toBe(false);
    expect(
      ImplicitRequiredIds.validateCommand(bytes, create(bytes, { id: new Uint8Array([1]) })).valid,
    ).toBe(true);
    expect(ImplicitRequiredIds.validateCommand(repeated, create(repeated)).valid).toBe(false);
    expect(
      ImplicitRequiredIds.validateCommand(repeated, create(repeated, { id: ["one"] })).valid,
    ).toBe(true);
    expect(ImplicitRequiredIds.validateCommand(shaped.enum, create(shaped.enum)).valid).toBe(false);
    expect(
      ImplicitRequiredIds.validateCommand(shaped.enum, create(shaped.enum, { id: 1 })).valid,
    ).toBe(true);
    expect(ImplicitRequiredIds.validateCommand(shaped.message, create(shaped.message)).valid).toBe(
      false,
    );
    expect(
      ImplicitRequiredIds.validateCommand(
        shaped.message,
        create(shaped.message, { id: create(shaped.id, { value: "one" }) }),
      ).valid,
    ).toBe(true);
    expect(ImplicitRequiredIds.validateCommand(shaped.map, create(shaped.map)).valid).toBe(false);
    expect(
      ImplicitRequiredIds.validateCommand(shaped.map, create(shaped.map, { id: { one: "one" } }))
        .valid,
    ).toBe(true);
  });

  it("rejects an empty implicit Command ID before dispatcher side effects", async () => {
    const observed: string[] = [];
    const dispatcher: CommandDispatcher = {
      messageSchemas: () => [implicitString],
      dispatch: () => {
        observed.push("dispatched");
        return Promise.resolve();
      },
    };
    const bus = new CommandBus([dispatcher]);
    const command = create(CommandSchema, {
      id: create(CommandIdSchema, { uuid: "implicit-id-command" }),
      context: create(CommandContextSchema),
      message: AnyMessages.pack(implicitString, create(implicitString), { validate: false }),
    });

    await expect(bus.post(command)).rejects.toBeInstanceOf(CommandValidationError);
    expect(observed).toEqual([]);
  });

  it("leaves explicit true to ordinary validation without adding a second violation", async () => {
    expect(ImplicitRequiredIds.validateCommand(explicitTrue, create(explicitTrue)).valid).toBe(
      true,
    );
    const bus = new CommandBus([
      {
        messageSchemas: () => [explicitTrue],
        dispatch: () => Promise.resolve(),
      },
    ]);
    const command = create(CommandSchema, {
      id: create(CommandIdSchema, { uuid: "explicit-required-command" }),
      context: create(CommandContextSchema),
      message: AnyMessages.pack(explicitTrue, create(explicitTrue), { validate: false }),
    });

    try {
      await bus.post(command);
      throw new Error("Expected explicit required validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(CommandValidationError);
      expect((error as CommandValidationError).validationError.constraintViolation).toHaveLength(1);
    }
  });

  it("allows explicit false through CommandBus validation", async () => {
    const observed: string[] = [];
    const bus = new CommandBus([
      {
        messageSchemas: () => [explicitFalse],
        dispatch: () => {
          observed.push("dispatched");
          return Promise.resolve();
        },
      },
    ]);
    const command = create(CommandSchema, {
      id: create(CommandIdSchema, { uuid: "explicit-false-command" }),
      context: create(CommandContextSchema),
      message: AnyMessages.pack(explicitFalse, create(explicitFalse), { validate: false }),
    });

    await expect(bus.post(command)).resolves.toBeUndefined();
    expect(observed).toEqual(["dispatched"]);
  });
});

interface FieldInput {
  readonly name: string;
  readonly number?: number;
  readonly type: FieldDescriptorProto_Type;
  readonly required?: boolean;
  readonly label?: FieldDescriptorProto_Label;
}

function commandSchema<Shape extends Message = Message>(
  fileName: string,
  messageName: string,
  field: FieldInput,
) {
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
            label: field.label ?? FieldDescriptorProto_Label.OPTIONAL,
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
  return messageDesc(file, 0) as GenMessage<Shape>;
}

function shapeSchemas() {
  const descriptor = create(FileDescriptorProtoSchema, {
    name: "shaped_commands.proto",
    package: "example.implicit",
    syntax: "proto3",
    messageType: [
      {
        name: "Id",
        field: [{ name: "value", number: 1, type: FieldDescriptorProto_Type.STRING }],
      },
      {
        name: "EnumCommand",
        field: [
          {
            name: "id",
            number: 1,
            type: FieldDescriptorProto_Type.ENUM,
            typeName: ".example.implicit.IdKind",
          },
        ],
      },
      {
        name: "MessageCommand",
        field: [
          {
            name: "id",
            number: 1,
            type: FieldDescriptorProto_Type.MESSAGE,
            typeName: ".example.implicit.Id",
          },
        ],
      },
      {
        name: "MapCommand",
        nestedType: [
          {
            name: "IdEntry",
            options: create(MessageOptionsSchema, { mapEntry: true }),
            field: [
              { name: "key", number: 1, type: FieldDescriptorProto_Type.STRING },
              { name: "value", number: 2, type: FieldDescriptorProto_Type.STRING },
            ],
          },
        ],
        field: [
          {
            name: "id",
            number: 1,
            label: FieldDescriptorProto_Label.REPEATED,
            type: FieldDescriptorProto_Type.MESSAGE,
            typeName: ".example.implicit.MapCommand.IdEntry",
          },
        ],
      },
    ],
    enumType: [
      {
        name: "IdKind",
        value: [
          { name: "ID_KIND_UNSPECIFIED", number: 0 },
          { name: "ID_KIND_ONE", number: 1 },
        ],
      },
    ],
  });
  const file = fileDesc(
    Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"),
  );
  return {
    id: messageDesc(file, 0) as GenMessage<IdMessage>,
    enum: messageDesc(file, 1) as GenMessage<EnumCommand>,
    message: messageDesc(file, 2) as GenMessage<MessageCommand>,
    map: messageDesc(file, 3) as GenMessage<MapCommand>,
  };
}
