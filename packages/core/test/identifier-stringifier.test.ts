import { create, createRegistry, toBinary } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { AnySchema, FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import {
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FieldOptions_JSType,
  FileDescriptorProtoSchema,
} from "@bufbuild/protobuf/wkt";
import { EventIdSchema, UserIdSchema } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import {
  Identifiers,
  StringifierRegistry,
  Stringifiers,
  TypeRegistry,
  type Stringifier,
} from "../src/index.js";

type FieldMessage = Message<"example.stringifiers.FieldMessage"> & {
  value: string;
};

type FieldValues = Message<"example.stringifiers.FieldValues"> & {
  text: string;
  enabled: boolean;
  int32Value: number;
  sint32Value: number;
  fixed32Value: number;
  int64Value: bigint;
  uint64Value: bigint;
  doubleValue: number;
  bytesValue: Uint8Array;
  status: number;
  message?: FieldMessage;
  tags: string[];
  labels: Record<string, string>;
  floatValue: number;
  uint32Value: number;
  sfixed32Value: number;
  fixed64Value: bigint;
  sfixed64Value: bigint;
  sint64Value: bigint;
  stringInt64Value: string;
};

const fieldStringifierFile = fileDesc(
  Buffer.from(
    toBinary(
      FileDescriptorProtoSchema,
      create(FileDescriptorProtoSchema, {
        name: "example/stringifiers.proto",
        package: "example.stringifiers",
        syntax: "proto3",
        enumType: [
          {
            name: "Status",
            value: [
              { name: "STATUS_UNSPECIFIED", number: 0 },
              { name: "STATUS_OPEN", number: 1 },
            ],
          },
        ],
        messageType: [
          {
            name: "FieldMessage",
            field: [field("value", 1, FieldDescriptorProto_Type.STRING)],
          },
          {
            name: "FieldValues",
            nestedType: [
              {
                name: "LabelsEntry",
                options: { mapEntry: true },
                field: [
                  field("key", 1, FieldDescriptorProto_Type.STRING),
                  field("value", 2, FieldDescriptorProto_Type.STRING),
                ],
              },
            ],
            field: [
              field("text", 1, FieldDescriptorProto_Type.STRING),
              field("enabled", 2, FieldDescriptorProto_Type.BOOL),
              field("int32_value", 3, FieldDescriptorProto_Type.INT32),
              field("sint32_value", 4, FieldDescriptorProto_Type.SINT32),
              field("fixed32_value", 5, FieldDescriptorProto_Type.FIXED32),
              field("int64_value", 6, FieldDescriptorProto_Type.INT64),
              field("uint64_value", 7, FieldDescriptorProto_Type.UINT64),
              field("double_value", 8, FieldDescriptorProto_Type.DOUBLE),
              field("bytes_value", 9, FieldDescriptorProto_Type.BYTES),
              field("status", 10, FieldDescriptorProto_Type.ENUM, ".example.stringifiers.Status"),
              field(
                "message",
                11,
                FieldDescriptorProto_Type.MESSAGE,
                ".example.stringifiers.FieldMessage",
              ),
              field(
                "tags",
                12,
                FieldDescriptorProto_Type.STRING,
                undefined,
                FieldDescriptorProto_Label.REPEATED,
              ),
              field(
                "labels",
                13,
                FieldDescriptorProto_Type.MESSAGE,
                ".example.stringifiers.FieldValues.LabelsEntry",
                FieldDescriptorProto_Label.REPEATED,
              ),
              field("float_value", 14, FieldDescriptorProto_Type.FLOAT),
              field("uint32_value", 15, FieldDescriptorProto_Type.UINT32),
              field("sfixed32_value", 16, FieldDescriptorProto_Type.SFIXED32),
              field("fixed64_value", 17, FieldDescriptorProto_Type.FIXED64),
              field("sfixed64_value", 18, FieldDescriptorProto_Type.SFIXED64),
              field("sint64_value", 19, FieldDescriptorProto_Type.SINT64),
              {
                ...field("string_int64_value", 20, FieldDescriptorProto_Type.INT64),
                options: { jstype: FieldOptions_JSType.JS_STRING },
              },
            ],
          },
        ],
      }),
    ),
  ).toString("base64"),
);
const FieldMessageSchema = messageDesc(fieldStringifierFile, 0) as GenMessage<FieldMessage>;
const FieldValuesSchema = messageDesc(fieldStringifierFile, 1) as GenMessage<FieldValues>;

describe("JVM-compatible identifier and stringifier contracts", () => {
  it("packs and unpacks a message identifier through its generated schema", () => {
    const id = create(EventIdSchema, { value: "event-42" });

    const packed = Identifiers.pack(EventIdSchema, id);

    expect(Identifiers.unpack(EventIdSchema, packed)).toEqual(id);
  });

  it("round-trips a message as compact Proto JSON", () => {
    const id = create(EventIdSchema, { value: "event-42" });
    const stringifier = Stringifiers.forMessage(EventIdSchema);

    const stored = stringifier.toString(id);

    expect(stored).toBe('{"value":"event-42"}');
    expect(stringifier.fromString(stored)).toEqual(id);
  });

  it("accepts a native Protobuf registry for compact JSON", () => {
    const id = create(EventIdSchema, { value: "event-42" });
    const stringifier = Stringifiers.forMessage(EventIdSchema, createRegistry(EventIdSchema));

    expect(stringifier.fromString(stringifier.toString(id))).toEqual(id);
  });

  it("restores repeated Proto JSON fields and native-registry Any values", () => {
    const mask = create(FieldMaskSchema, { paths: ["state.name"] });
    const maskStringifier = Stringifiers.forMessage(FieldMaskSchema);
    expect(maskStringifier.fromString(maskStringifier.toString(mask))).toEqual(mask);

    const packed = create(AnySchema, {
      typeUrl: `type.spine.io/${UserIdSchema.typeName}`,
      value: toBinary(UserIdSchema, create(UserIdSchema, { value: "user-42" })),
    });
    const anyStringifier = Stringifiers.forMessage(AnySchema, createRegistry(UserIdSchema));
    const restored = anyStringifier.fromString(anyStringifier.toString(packed));
    expect(restored.typeUrl).toBe(`type.googleapis.com/${UserIdSchema.typeName}`);
    expect(restored.value).toEqual(packed.value);
  });

  it.each([
    ["string", "message-42"],
    ["int32", 42],
    ["int64", 42n],
  ] as const)("packs and unpacks a %s identifier", (type, id) => {
    switch (type) {
      case "string":
        expect(Identifiers.unpack(type, Identifiers.pack(type, id))).toBe(id);
        break;
      case "int32":
        expect(Identifiers.unpack(type, Identifiers.pack(type, id))).toBe(id);
        break;
      case "int64":
        expect(Identifiers.unpack(type, Identifiers.pack(type, id))).toBe(id);
        break;
    }
  });

  it("rejects primitive identifiers outside their declared type", () => {
    expect(() => Identifiers.pack("string", 42 as never)).toThrow("Identifier must be a string.");
    expect(() => Identifiers.pack("int32", 2 ** 31)).toThrow(
      "Identifier is outside the int32 range.",
    );
    expect(() => Identifiers.pack("int64", 1n << 63n)).toThrow(
      "Identifier is outside the int64 range.",
    );
  });

  it("uses an explicitly registered schema stringifier in both directions", () => {
    const registry = new StringifierRegistry();
    const custom: Stringifier<ReturnType<typeof createEventId>> = {
      toString: (id) => `event:${id.value}`,
      fromString: (value) => createEventId(value.replace(/^event:/u, "")),
    };
    registry.register(EventIdSchema, custom);

    const stringifier = registry.forMessage(EventIdSchema);

    expect(stringifier.toString(createEventId("42"))).toBe("event:42");
    expect(stringifier.fromString("event:42")).toEqual(createEventId("42"));
  });

  it("copies registrations without sharing later mutations", () => {
    const original = new StringifierRegistry();
    original.register(EventIdSchema, {
      toString: (id) => `first:${id.value}`,
      fromString: (value) => createEventId(value.slice(6)),
    });
    const snapshot = new StringifierRegistry(original);
    original.register(EventIdSchema, {
      toString: (id) => `second:${id.value}`,
      fromString: (value) => createEventId(value.slice(7)),
    });

    expect(snapshot.forMessage(EventIdSchema).toString(createEventId("42"))).toBe("first:42");
  });

  it("uses the configured generated-type registry for compact Any JSON", () => {
    const registry = new StringifierRegistry();
    registry.setTypeRegistry(new TypeRegistry([UserIdSchema]));
    const packed = create(AnySchema, {
      typeUrl: `type.spine.io/${UserIdSchema.typeName}`,
      value: toBinary(UserIdSchema, create(UserIdSchema, { value: "task" })),
    });

    const text = registry.forMessage(AnySchema).toString(packed);

    const restored = registry.forMessage(AnySchema).fromString(text);
    expect(restored).toEqual(packed);
    expect(registry.forMessage(AnySchema).toString(restored)).toBe(text);
  });

  it.each([
    ["text", "announcements", "announcements"],
    ["enabled", true, "true"],
    ["int32Value", -42, "-42"],
    ["sint32Value", 42, "42"],
    ["fixed32Value", 42, "42"],
    ["int64Value", -42n, "-42"],
    ["uint64Value", 42n, "42"],
    ["doubleValue", 1.5, "1.5"],
    ["floatValue", 1.5, "1.5"],
    ["uint32Value", 42, "42"],
    ["sfixed32Value", -42, "-42"],
    ["fixed64Value", 42n, "42"],
    ["sfixed64Value", -42n, "-42"],
    ["sint64Value", -42n, "-42"],
    ["stringInt64Value", "42", "42"],
  ] as const)("round-trips the singular %s field", (name, value, text) => {
    const stringifier = Stringifiers.forField(FieldValuesSchema.field[name]);

    expect(stringifier.toString(value)).toBe(text);
    expect(stringifier.fromString(text)).toBe(value);
  });

  it("uses canonical standard base64 for a bytes field", () => {
    const stringifier = Stringifiers.forField(FieldValuesSchema.field.bytesValue);
    const value = Uint8Array.from([0, 1, 2, 255]);

    expect(stringifier.toString(value)).toBe("AAEC/w==");
    expect(stringifier.fromString("AAEC/w==")).toEqual(value);
    expect(() => stringifier.fromString("AAEC_w")).toThrow("canonical base64");
  });

  it("accepts enum names and canonical numeric values", () => {
    const stringifier = Stringifiers.forField(FieldValuesSchema.field.status);

    expect(stringifier.toString(1)).toBe("STATUS_OPEN");
    expect(stringifier.fromString("STATUS_OPEN")).toBe(1);
    expect(stringifier.fromString("7")).toBe(7);
    expect(stringifier.toString(7)).toBe("7");
  });

  it("uses compact Proto JSON for message fields", () => {
    const stringifier = Stringifiers.forField(FieldValuesSchema.field.message);
    const value = create(FieldMessageSchema, { value: "message-42" });

    expect(stringifier.toString(value)).toBe('{"value":"message-42"}');
    expect(stringifier.fromString('{"value":"message-42"}')).toEqual(value);
  });

  it("uses a registered message mapping for a message field", () => {
    const registry = new StringifierRegistry();
    registry.register(FieldMessageSchema, {
      toString: (value) => `field:${value.value}`,
      fromString: (value) => create(FieldMessageSchema, { value: value.replace(/^field:/u, "") }),
    });
    const stringifier = registry.forField(FieldValuesSchema.field.message);

    expect(stringifier.toString(create(FieldMessageSchema, { value: "42" }))).toBe("field:42");
    expect(stringifier.fromString("field:42")).toEqual(create(FieldMessageSchema, { value: "42" }));
  });

  it("rejects noncanonical and invalid scalar text", () => {
    expect(() => Stringifiers.forField(FieldValuesSchema.field.enabled).fromString("TRUE")).toThrow(
      "canonical boolean",
    );
    expect(() =>
      Stringifiers.forField(FieldValuesSchema.field.int32Value).fromString("01"),
    ).toThrow("canonical integer");
    expect(() =>
      Stringifiers.forField(FieldValuesSchema.field.doubleValue).fromString("Infinity"),
    ).toThrow("finite number");
    expect(() =>
      Stringifiers.forField(FieldValuesSchema.field.uint64Value).fromString("-1"),
    ).toThrow("uint64 range");
    expect(() =>
      Stringifiers.forField(FieldValuesSchema.field.int32Value).fromString("2147483648"),
    ).toThrow("declared integer range");
    expect(() =>
      Stringifiers.forField(FieldValuesSchema.field.int64Value).fromString("9223372036854775808"),
    ).toThrow("declared integer range");
  });

  it("rejects runtime values that do not match the field representation", () => {
    expect(() => Stringifiers.forField(FieldValuesSchema.field.int32Value).toString(1n)).toThrow(
      "integer",
    );
    expect(() => Stringifiers.forField(FieldValuesSchema.field.int64Value).toString(1)).toThrow(
      "integer",
    );
    expect(() =>
      Stringifiers.forField(FieldValuesSchema.field.stringInt64Value).toString(1n),
    ).toThrow("integer string");
    expect(() => Stringifiers.forField(FieldValuesSchema.field.status).toString(1n)).toThrow(
      "integer number",
    );
    expect(() =>
      Stringifiers.forField(FieldValuesSchema.field.doubleValue).toString(Number.NaN),
    ).toThrow("finite number");
  });

  it("rejects repeated and map fields", () => {
    expect(() => Stringifiers.forField(FieldValuesSchema.field.tags)).toThrow(
      "singular Protobuf fields",
    );
    expect(() => Stringifiers.forField(FieldValuesSchema.field.labels)).toThrow(
      "singular Protobuf fields",
    );
  });
});

function field(
  name: string,
  number: number,
  type: FieldDescriptorProto_Type,
  typeName = "",
  label = FieldDescriptorProto_Label.OPTIONAL,
) {
  return { name, number, type, typeName, label };
}

function createEventId(value: string) {
  return create(EventIdSchema, { value });
}
