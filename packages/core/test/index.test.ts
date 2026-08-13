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

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { describe, expect, expectTypeOf, it } from "vitest";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  CommandSchema,
  type ConstraintViolation,
  ConstraintViolationSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  FieldPathSchema,
  type ProtoModule,
  TemplateStringSchema,
  TenantIdSchema,
  UserIdSchema,
  type ValidationError,
  ValidationErrorSchema,
  VersionSchema,
  file_spine_options,
  type_url_prefix,
} from "@spine-event-engine/proto";

import {
  DEFAULT_TYPE_URL_PREFIX,
  MessageInterfaces,
  type MessageValidationResult,
  type TypeMetadata,
  TypeRegistry,
  ValidationException,
  RejectionThrowable,
  spineCoreRegistry,
  Validate,
  TypeUrls,
  AnyMessages,
  SignalEnvelopes,
} from "../src/index.js";

type SignalMessage = Message & {
  readonly $typeName: string;
};

describe("MessageInterfaces", () => {
  it("creates immutable nominal tokens with copied, deduplicated membership", () => {
    const schemas = [CommandSchema, EventSchema, CommandSchema] as const;
    const token = MessageInterfaces.define<SignalMessage, typeof schemas>(schemas);

    expect(token.schemas).toEqual([CommandSchema, EventSchema]);
    expect(token.schemas).not.toBe(schemas);
    expect(Object.isFrozen(token)).toBe(true);
    expect(Object.isFrozen(token.schemas)).toBe(true);
    expect(MessageInterfaces.is(token)).toBe(true);

    const copies = [
      { ...token },
      Object.assign({}, token),
      Object.create(token),
      JSON.parse('{"schemas":[]}'),
      { schemas: token.schemas },
    ];
    for (const copy of copies) expect(MessageInterfaces.is(copy)).toBe(false);
  });

  it("rejects empty and malformed runtime membership", () => {
    expect(() => MessageInterfaces.define([] as never)).toThrow("at least one schema");
    expect(() => MessageInterfaces.define([{}] as never)).toThrow("generated message schema");
  });
});

type RequiredName = Message<"example.validation.RequiredName"> & {
  name: string;
};

// Descriptor fixture compiled from:
// syntax = "proto3"; package example.validation;
// message RequiredName { string name = 1 [(required) = true]; }
const fileExampleValidationFixture = fileDesc(
  "CiBleGFtcGxlL3ZhbGlkYXRpb25fZml4dHVyZS5wcm90bxISZXhhbXBsZS52YWxpZGF0aW9uIiIK" +
    "DFJlcXVpcmVkTmFtZRISCgRuYW1lGAEgASgJQgSghSQBYgZwcm90bzM",
  [file_spine_options],
);
const RequiredNameSchema = messageDesc(fileExampleValidationFixture, 0) as GenMessage<RequiredName>;

const fileRequiredRejectionsFixture = fileDesc(
  "CiFleGFtcGxlL3JlcXVpcmVkX3JlamVjdGlvbnMucHJvdG8SEmV4YW1wbGUudmFsaWRhdGlvbiIi" +
    "CgxSZXF1aXJlZE5hbWUSEgoEbmFtZRgBIAEoCUIEoIUkAWIGcHJvdG8z",
  [file_spine_options],
);
const RequiredRejectionSchema = messageDesc(
  fileRequiredRejectionsFixture,
  0,
) as GenMessage<RequiredName>;

type RejectionDetail = Message<"example.rejection.PayloadRejected.Detail"> & {
  note: string;
};

type PayloadRejected = Message<"example.rejection.PayloadRejected"> & {
  data: Uint8Array;
  detail?: RejectionDetail;
  labels: Record<string, string>;
};

type NestedRejection = Message<"example.rejection.PayloadRejected.NestedRejection"> & {
  reason: string;
};

const filePayloadRejectionsFixture = fileDesc(
  "CiBleGFtcGxlL3BheWxvYWRfcmVqZWN0aW9ucy5wcm90bxIRZXhhbXBsZS5yZWplY3Rpb24itAIK" +
    "D1BheWxvYWRSZWplY3RlZBISCgRkYXRhGAEgASgMUgRkYXRhEkEKBmRldGFpbBgCIAEoCzIpLmV4" +
    "YW1wbGUucmVqZWN0aW9uLlBheWxvYWRSZWplY3RlZC5EZXRhaWxSBmRldGFpbBJGCgZsYWJlbHMY" +
    "AyADKAsyLi5leGFtcGxlLnJlamVjdGlvbi5QYXlsb2FkUmVqZWN0ZWQuTGFiZWxzRW50cnlSBmxh" +
    "YmVscxocCgZEZXRhaWwSEgoEbm90ZRgBIAEoCVIEbm90ZRo5CgtMYWJlbHNFbnRyeRIQCgNrZXkY" +
    "ASABKAlSA2tleRIUCgV2YWx1ZRgCIAEoCVIFdmFsdWU6AjgBGikKD05lc3RlZFJlamVjdGlvbhIW" +
    "CgZyZWFzb24YASABKAlSBnJlYXNvbmIGcHJvdG8z",
);
const PayloadRejectedSchema = messageDesc(
  filePayloadRejectionsFixture,
  0,
) as GenMessage<PayloadRejected>;
const NestedRejectionSchema = messageDesc(
  filePayloadRejectionsFixture,
  0,
  2,
) as GenMessage<NestedRejection>;

function transitionViolation(message: string): ConstraintViolation {
  return create(ConstraintViolationSchema, {
    typeName: "example.validation.RequiredName",
    fieldPath: create(FieldPathSchema, { fieldName: ["name"] }),
    message: create(TemplateStringSchema, {
      withPlaceholders: message,
    }),
  });
}

function commandContext() {
  return create(CommandContextSchema, {
    actorContext: create(ActorContextSchema, {
      actor: create(UserIdSchema, { value: "user-1" }),
    }),
  });
}

function eventContext() {
  const producerId = create(UserIdSchema, { value: "aggregate-1" });

  return create(EventContextSchema, {
    producerId: AnyMessages.pack(UserIdSchema, producerId),
    version: create(VersionSchema, { number: 1 }),
  });
}

function fieldPathWithUnknownFields() {
  const encoded = toBinary(FieldPathSchema, create(FieldPathSchema, { fieldName: ["task"] }));
  const unknownField = new Uint8Array([0x98, 0x06, 0x7b]);

  return fromBinary(FieldPathSchema, new Uint8Array([...encoded, ...unknownField]));
}

function module(
  name: string,
  schemas: readonly GenMessage<Message>[],
  dependencies: readonly ProtoModule[] = [],
): ProtoModule {
  return Object.freeze({
    name,
    schemas: Object.freeze([...schemas]),
    dependencies: Object.freeze([...dependencies]),
  });
}

function cyclicModule(name: string): {
  name: string;
  schemas: never[];
  dependencies: ProtoModule[];
} {
  return { name, schemas: [], dependencies: [] };
}

function freezeModule(module: { schemas: never[]; dependencies: ProtoModule[] }): void {
  Object.freeze(module.schemas);
  Object.freeze(module.dependencies);
  Object.freeze(module);
}

describe("RejectionThrowable", () => {
  it("keeps a nominal, cloned rejection message with Error behavior", () => {
    const rejection = RejectionThrowable.create(RequiredRejectionSchema, {
      name: "Task already done",
    });

    expect(rejection).toBeInstanceOf(Error);
    expect(rejection).toBeInstanceOf(RejectionThrowable);
    expect(rejection.name).toBe("RejectionThrowable");
    expect(rejection.stack).toContain("RejectionThrowable");
    expect(rejection.schema).toBe(RequiredRejectionSchema);
    expect(rejection.messageData).toEqual({
      $typeName: "example.validation.RequiredName",
      name: "Task already done",
    });
  });

  it("validates the rejection message before creating the throwable", () => {
    expect(() => RejectionThrowable.create(RequiredRejectionSchema, {})).toThrow(
      ValidationException,
    );
  });

  it("owns a private payload snapshot and returns defensive clones", () => {
    const encoded = toBinary(
      PayloadRejectedSchema,
      create(PayloadRejectedSchema, {
        data: new Uint8Array([1, 2, 3]),
        detail: { note: "original" },
        labels: { priority: "high" },
      }),
    );
    const input = fromBinary(PayloadRejectedSchema, new Uint8Array([...encoded, 0x98, 0x06, 0x7b]));
    const rejection = RejectionThrowable.create(PayloadRejectedSchema, input);
    const inputDetail = input.detail;
    const inputUnknown = input.$unknown?.[0];

    if (inputDetail === undefined || inputUnknown === undefined) {
      throw new Error("Payload rejection fixture is incomplete.");
    }

    input.data[0] = 9;
    inputDetail.note = "input changed";
    input.labels.priority = "low";
    inputUnknown.data[0] = 0;

    const firstRead = rejection.messageData;
    expect(firstRead.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(firstRead.detail?.note).toBe("original");
    expect(firstRead.labels).toEqual({ priority: "high" });
    expect(firstRead.$unknown?.[0]?.data).toEqual(new Uint8Array([0x7b]));
    const firstDetail = firstRead.detail;
    const firstUnknown = firstRead.$unknown?.[0];

    if (firstDetail === undefined || firstUnknown === undefined) {
      throw new Error("Snapshotted rejection payload is incomplete.");
    }

    firstRead.data[1] = 8;
    firstDetail.note = "read changed";
    firstRead.labels.priority = "urgent";
    firstUnknown.data[0] = 1;

    const secondRead = rejection.messageThrown();
    expect(secondRead.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(secondRead.detail?.note).toBe("original");
    expect(secondRead.labels).toEqual({ priority: "high" });
    expect(secondRead.$unknown?.[0]?.data).toEqual(new Uint8Array([0x7b]));
    expect(() => Object.defineProperty(rejection, "schema", { value: AnySchema })).toThrow();
    expect(() => Object.defineProperty(rejection, "messageData", { value: secondRead })).toThrow();
  });

  it("recognizes only factory-created rejection throwables", () => {
    const rejection = RejectionThrowable.create(RequiredRejectionSchema, {
      name: "Task already done",
    });
    const spoofedError = new Error("spoofed");

    Object.setPrototypeOf(spoofedError, RejectionThrowable.prototype);

    expect(RejectionThrowable.is(rejection)).toBe(true);
    expect(RejectionThrowable.is(new Error("ordinary"))).toBe(false);
    expect(spoofedError).toBeInstanceOf(RejectionThrowable);
    expect(RejectionThrowable.is(spoofedError)).toBe(false);
    expect(RejectionThrowable.is({ schema: RequiredRejectionSchema })).toBe(false);
  });

  it("accepts only top-level messages declared in rejections.proto files", () => {
    expect(() =>
      RejectionThrowable.create(RequiredRejectionSchema, { name: "valid" }),
    ).not.toThrow();
    expect(() => RejectionThrowable.create(RequiredNameSchema, { name: "ordinary" })).toThrow(
      TypeError,
    );
    expect(() => RejectionThrowable.create(NestedRejectionSchema, { reason: "nested" })).toThrow(
      TypeError,
    );
    const packageRejectionSchema = {
      ...RequiredRejectionSchema,
      file: {
        ...RequiredRejectionSchema.file,
        proto: {
          ...RequiredRejectionSchema.file.proto,
          name: "example/rejections.proto",
        },
      },
    } as typeof RequiredRejectionSchema;
    expect(() =>
      RejectionThrowable.create(packageRejectionSchema, { name: "package rejection" }),
    ).not.toThrow();
    const misleadingSchema = {
      ...RequiredRejectionSchema,
      file: {
        ...RequiredRejectionSchema.file,
        proto: {
          ...RequiredRejectionSchema.file.proto,
          name: "example/notrejections.proto",
        },
      },
    } as typeof RequiredRejectionSchema;
    expect(() => RejectionThrowable.create(misleadingSchema, { name: "misleading" })).toThrow(
      TypeError,
    );
  });

  it("rejects direct construction at compile time and runtime", () => {
    expect(() => {
      // @ts-expect-error The validated factory is the only construction API.
      new RejectionThrowable(
        RequiredRejectionSchema,
        create(RequiredRejectionSchema, { name: "invalid construction" }),
      );
    }).toThrow(TypeError);
  });

  it("preserves the schema-specific create input type", () => {
    const TaskAlreadyDone = {
      create: (
        input: Parameters<typeof RejectionThrowable.create<typeof RequiredRejectionSchema>>[1],
      ) => RejectionThrowable.create(RequiredRejectionSchema, input),
    };

    expectTypeOf<{ name: string }>().toExtend<Parameters<typeof TaskAlreadyDone.create>[0]>();
    expectTypeOf<{ name: number }>().not.toExtend<Parameters<typeof TaskAlreadyDone.create>[0]>();
    expect(TaskAlreadyDone).toBeDefined();
  });
});

describe("@spine-event-engine/core type registry", () => {
  it("accepts equivalent graphs when only one graph reuses a dependency object", () => {
    const shared = module("example.shared", [FieldPathSchema]);
    const left = module("example.application", [], [shared, shared]);
    const right = module(
      "example.application",
      [],
      [module("example.shared", [FieldPathSchema]), module("example.shared", [FieldPathSchema])],
    );

    expect(TypeRegistry.from(left, right).list()).toHaveLength(1);
  });

  it("composes a deep acyclic dependency chain without exhausting the call stack", () => {
    let chain = module("example.chain.0", [FieldPathSchema]);

    for (let index = 1; index <= 20_000; index += 1) {
      chain = module(`example.chain.${String(index)}`, [], [chain]);
    }

    expect(TypeRegistry.from(chain).list()[0]?.fullTypeName).toBe("spine.base.FieldPath");
  });

  it("rejects self and indirect module dependency cycles", () => {
    const self = cyclicModule("example.self");
    self.dependencies.push(self);
    freezeModule(self);
    const first = cyclicModule("example.first");
    const second = cyclicModule("example.second");
    first.dependencies.push(second);
    second.dependencies.push(first);
    freezeModule(first);
    freezeModule(second);

    expect(() => TypeRegistry.from(self)).toThrow(
      'Proto module dependency cycle at "example.self".',
    );
    expect(() => TypeRegistry.from(first)).toThrow(
      'Proto module dependency cycle at "example.first".',
    );
  });

  it("dynamically unpacks types owned by dependencies", () => {
    const registry = TypeRegistry.from(
      module("example.application", [], [module("example.dependency", [UserIdSchema])]),
    );
    const packed = AnyMessages.pack(
      UserIdSchema,
      create(UserIdSchema, { value: "dependency-user" }),
    );

    expect(AnyMessages.unpackUsing(registry, packed)).toEqual(
      create(UserIdSchema, { value: "dependency-user" }),
    );
  });

  it("names the nested module that has conflicting content", () => {
    const left = module(
      "example.application",
      [],
      [module("example.shared", [], [module("example.nested", [FieldPathSchema])])],
    );
    const right = module(
      "example.application",
      [],
      [module("example.shared", [], [module("example.nested", [UserIdSchema])])],
    );

    expect(() => TypeRegistry.from(left, right)).toThrow(
      'Proto module conflict for "example.nested".',
    );
  });

  it("composes modules dependency-first and deduplicates equivalent definitions", () => {
    const shared = module("example.shared", [FieldPathSchema]);
    const equivalentShared = module("example.shared", [FieldPathSchema]);
    const application = module("example.application", [UserIdSchema], [shared, equivalentShared]);

    const registry = TypeRegistry.from(application, shared);

    expect(registry.list().map((metadata) => metadata.fullTypeName)).toEqual([
      "spine.base.FieldPath",
      "spine.core.UserId",
    ]);
  });

  it("rejects modules that use one name for different definitions", () => {
    const first = module("example.conflict", [FieldPathSchema]);
    const conflicting = module("example.conflict", [UserIdSchema]);

    expect(() => TypeRegistry.from(first, conflicting)).toThrow(
      'Proto module conflict for "example.conflict".',
    );
  });

  it("dynamically unpacks only exact registered type URLs", () => {
    const registry = TypeRegistry.from(module("example.application", [UserIdSchema]));
    const message = create(UserIdSchema, { value: "user-1" });
    const packed = AnyMessages.pack(UserIdSchema, message);
    const unknown = create(AnySchema, {
      typeUrl: "type.spine.io/spine.core.UserId.extra",
      value: packed.value,
    });
    const malformed = create(AnySchema, {
      typeUrl: packed.typeUrl,
      value: new Uint8Array([0xff]),
    });

    expect(AnyMessages.unpackUsing(registry, packed)).toEqual(message);
    expect(AnyMessages.unpackUsing(registry, unknown)).toBeUndefined();
    expect(AnyMessages.unpackUsing(registry, malformed)).toBeUndefined();
  });

  it("derives type URLs from Spine file type_url_prefix options", () => {
    expect(TypeUrls.derive(FieldPathSchema)).toBe("type.spine.io/spine.base.FieldPath");
    expect(TypeUrls.derive(ValidationErrorSchema)).toBe(
      "type.spine.io/spine.validation.ValidationError",
    );
  });

  it("uses the documented fallback prefix when a file has no Spine prefix option", () => {
    expect(DEFAULT_TYPE_URL_PREFIX).toBe("type.googleapis.com");
    expect(TypeUrls.derive(AnySchema)).toBe("type.googleapis.com/google.protobuf.Any");
  });

  it.each(["", " \t\n", "/", "///"])(
    "rejects malformed custom fallback prefix %j for schemas without a Spine option",
    (fallbackPrefix) => {
      const message = "Fallback type URL prefix must be non-empty and contain no whitespace.";

      expect(() => TypeUrls.prefix(AnySchema, fallbackPrefix)).toThrow(new TypeError(message));
      expect(() => TypeUrls.derive(AnySchema, { fallbackPrefix })).toThrow(new TypeError(message));
    },
  );

  it.each(["type.example.test", "type.example.test/", "type.example.test///"])(
    "canonicalizes valid custom fallback prefix %j for schemas without a Spine option",
    (fallbackPrefix) => {
      const expectedPrefix = "type.example.test";

      expect(TypeUrls.prefix(AnySchema, fallbackPrefix)).toBe(expectedPrefix);
      expect(TypeUrls.derive(AnySchema, { fallbackPrefix })).toBe(
        `${expectedPrefix}/google.protobuf.Any`,
      );
    },
  );

  it("uses a Spine file option before considering an unused custom fallback", () => {
    expect(TypeUrls.prefix(FieldPathSchema, "///")).toBe("type.spine.io");
    expect(TypeUrls.derive(FieldPathSchema, { fallbackPrefix: "///" })).toBe(
      "type.spine.io/spine.base.FieldPath",
    );
  });

  it("registers schemas and looks them up by full name, type URL, and schema identity", () => {
    const registry = new TypeRegistry();

    const metadata = registry.register(FieldPathSchema);
    const schemaTypedMetadata: TypeMetadata<typeof FieldPathSchema> =
      registry.getBySchema(FieldPathSchema);

    expect(metadata.fullTypeName).toBe("spine.base.FieldPath");
    expect(metadata.typeUrl).toBe("type.spine.io/spine.base.FieldPath");
    expect(schemaTypedMetadata.schema).toBe(FieldPathSchema);
    expect(registry.getByFullName("spine.base.FieldPath")).toBe(metadata);
    expect(registry.getByTypeUrl("type.spine.io/spine.base.FieldPath")).toBe(metadata);
    expect(registry.getBySchema(FieldPathSchema)).toBe(metadata);
    expect(registry.findByFullName("missing.Type")).toBeUndefined();
    expect(registry.findByTypeUrl("type.spine.io/missing.Type")).toBeUndefined();
  });

  it("throws descriptive lookup errors for missing required types", () => {
    const registry = new TypeRegistry();

    expect(() => registry.getByFullName("missing.Type")).toThrow(
      /No schema registered for Protobuf type name "missing\.Type"/,
    );
    expect(() => registry.getByTypeUrl("type.spine.io/missing.Type")).toThrow(
      /No schema registered for type URL "type\.spine\.io\/missing\.Type"/,
    );
    expect(() => registry.getBySchema(FieldPathSchema)).toThrow(
      /No metadata registered for schema "spine\.base\.FieldPath"/,
    );
  });

  it("rejects duplicate full names, duplicate type URLs, and conflicting schema identities", () => {
    const duplicateFieldPathSchema = { ...FieldPathSchema };
    const conflictingSchemaIdentity = { ...FieldPathSchema, typeName: "example.Other" };
    const duplicateTypeUrlSchema = { ...FieldPathSchema };
    const registry = new TypeRegistry();

    registry.register(FieldPathSchema);

    expect(() => registry.register(duplicateFieldPathSchema)).toThrow(
      /Duplicate Protobuf type name "spine\.base\.FieldPath"/,
    );
    expect(() =>
      registry.register(duplicateTypeUrlSchema, {
        typeUrl: "type.spine.io/spine.base.FieldPath",
      }),
    ).toThrow(/Duplicate type URL "type\.spine\.io\/spine\.base\.FieldPath"/);
    expect(() => registry.register(conflictingSchemaIdentity)).toThrow(
      /Schema identity conflict for "spine\.base\.FieldPath"/,
    );
  });

  it("validates explicit type URLs against the registered schema identity", () => {
    const registry = new TypeRegistry();

    expect(() =>
      registry.register(FieldPathSchema, {
        typeUrl: "type.example.test/example.WrongType",
      }),
    ).toThrow(
      new RegExp(
        'Explicit type URL "type\\.example\\.test/example\\.WrongType" must have ' +
          'the form "<prefix>/spine\\.base\\.FieldPath"',
      ),
    );

    const metadata = registry.register(FieldPathSchema, {
      typeUrl: "type.example.test/spine.base.FieldPath",
    });

    expect(metadata.typeUrl).toBe("type.example.test/spine.base.FieldPath");
    expect(metadata.typeUrlPrefix).toBe("type.example.test");
  });

  it("keeps default registry derivation and explicit valid registry URLs canonical", () => {
    const defaultRegistry = new TypeRegistry();
    const explicitRegistry = new TypeRegistry();

    expect(defaultRegistry.register(AnySchema).typeUrl).toBe(
      "type.googleapis.com/google.protobuf.Any",
    );
    expect(
      explicitRegistry.register(AnySchema, {
        typeUrl: "type.example.test/google.protobuf.Any",
      }).typeUrl,
    ).toBe("type.example.test/google.protobuf.Any");
  });

  it("exposes descriptor-backed metadata and option helpers", () => {
    const registry = new TypeRegistry();

    const metadata = registry.register(ValidationErrorSchema);

    expect(metadata.schema).toBe(ValidationErrorSchema);
    expect(metadata.descriptor).toBe(ValidationErrorSchema);
    expect(metadata.fileDescriptor.name).toBe("spine/validation/validation_error");
    expect(metadata.fileName).toBe("spine/validation/validation_error.proto");
    expect(metadata.firstField?.name).toBe("constraint_violation");
    expect(metadata.firstFieldName).toBe("constraint_violation");
    expect(metadata.typeUrlPrefix).toBe("type.spine.io");
    expect(metadata.hasFileOption(type_url_prefix)).toBe(true);
    expect(metadata.getFileOption(type_url_prefix)).toBe("type.spine.io");
  });

  it("does not expose semantic registry metadata or lookup APIs", () => {
    const registry = new TypeRegistry();
    const metadata = registry.register(FieldPathSchema);
    expect(metadata).not.toHaveProperty("semanticTags");
    expect(metadata).not.toHaveProperty("isTypes");
    expect(metadata).not.toHaveProperty("everyIsTypes");
    expect(registry).not.toHaveProperty("findBySemanticTag");
    expect(registry).not.toHaveProperty("findByIs");
    expect(registry).not.toHaveProperty("findByEveryIs");
  });

  it("registers the current curated Spine schemas in the default registry", () => {
    const registry = TypeRegistry.spineCore();

    expect(registry.getBySchema(FieldPathSchema).typeUrl).toBe(
      "type.spine.io/spine.base.FieldPath",
    );
    expect(registry.getBySchema(TemplateStringSchema).typeUrl).toBe(
      "type.spine.io/spine.string.TemplateString",
    );
    expect(registry.getBySchema(ValidationErrorSchema).typeUrl).toBe(
      "type.spine.io/spine.validation.ValidationError",
    );
    expect(registry.getBySchema(ConstraintViolationSchema).typeUrl).toBe(
      "type.spine.io/spine.validation.ConstraintViolation",
    );
    expect(spineCoreRegistry.getByFullName("spine.validation.ConstraintViolation").schema).toBe(
      ConstraintViolationSchema,
    );
  });

  it("registers representative core signal envelope and context schemas", () => {
    const registry = TypeRegistry.spineCore();

    expect(registry.getBySchema(CommandSchema).typeUrl).toBe("type.spine.io/spine.core.Command");
    expect(registry.getBySchema(EventSchema).typeUrl).toBe("type.spine.io/spine.core.Event");
    expect(registry.getBySchema(ActorContextSchema).typeUrl).toBe(
      "type.spine.io/spine.core.ActorContext",
    );
    expect(registry.getBySchema(TenantIdSchema).typeUrl).toBe("type.spine.io/spine.core.TenantId");
    expect(registry.getBySchema(UserIdSchema).typeUrl).toBe("type.spine.io/spine.core.UserId");
    expect(registry.getBySchema(VersionSchema).typeUrl).toBe("type.spine.io/spine.core.Version");
    expect(registry.getByFullName("spine.core.Command").schema).toBe(CommandSchema);
    expect(registry.getByTypeUrl("type.spine.io/spine.core.Event").schema).toBe(EventSchema);
  });

  it("exports the shared default registry as a read-only lookup view", () => {
    expect("register" in spineCoreRegistry).toBe(false);
    expect(spineCoreRegistry.getByFullName("spine.base.FieldPath").schema).toBe(FieldPathSchema);
    expect(spineCoreRegistry.getByTypeUrl("type.spine.io/spine.base.FieldPath").schema).toBe(
      FieldPathSchema,
    );
    expect(spineCoreRegistry.getBySchema(FieldPathSchema).typeUrl).toBe(
      "type.spine.io/spine.base.FieldPath",
    );
    expect(spineCoreRegistry.findByFullName("spine.base.FieldPath")?.schema).toBe(FieldPathSchema);
    expect(spineCoreRegistry.findByTypeUrl("type.spine.io/spine.base.FieldPath")?.schema).toBe(
      FieldPathSchema,
    );
    expect(spineCoreRegistry.findBySchema(FieldPathSchema)?.schema).toBe(FieldPathSchema);
    expect(spineCoreRegistry).not.toHaveProperty("findBySemanticTag");
    expect(spineCoreRegistry).not.toHaveProperty("findByIs");
    expect(spineCoreRegistry).not.toHaveProperty("findByEveryIs");
    expect(spineCoreRegistry.list().map((metadata) => metadata.fullTypeName)).toContain(
      "spine.validation.ValidationError",
    );
  });
});

describe("@spine-event-engine/core validation facade", () => {
  it("narrows result invariants for valid and invalid validation outcomes", () => {
    const validResult: MessageValidationResult = Validate.message(ValidationErrorSchema, {
      $typeName: "spine.validation.ValidationError",
      constraintViolation: [],
    });

    if (validResult.valid) {
      expectTypeOf(validResult.violations).toEqualTypeOf<readonly []>();
      expectTypeOf(validResult.error).toEqualTypeOf<undefined>();
      expect(validResult.violations).toEqual([]);
      expect(validResult.error).toBeUndefined();
    }

    const invalidResult: MessageValidationResult = Validate.message(
      RequiredNameSchema,
      create(RequiredNameSchema, { name: "" }),
    );

    if (!invalidResult.valid) {
      expectTypeOf(invalidResult.violations).toEqualTypeOf<
        readonly [ConstraintViolation, ...ConstraintViolation[]]
      >();
      expectTypeOf(invalidResult.error).toEqualTypeOf<ValidationError>();
      expect(invalidResult.violations.length).toBeGreaterThan(0);
      expect(invalidResult.error.constraintViolation).toEqual(invalidResult.violations);
    }
  });

  it("returns a typed valid result for a valid Protobuf message", () => {
    const result = Validate.message(ValidationErrorSchema, {
      $typeName: "spine.validation.ValidationError",
      constraintViolation: [],
    });

    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it("throws a ValidationException that exposes structured ValidationError data", () => {
    const message = create(RequiredNameSchema, { name: "" });

    expect(() => Validate.check(RequiredNameSchema, message)).toThrow(ValidationException);

    try {
      Validate.check(RequiredNameSchema, message);
      throw new Error("Expected Validate.check() to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationException);
      const validationError = (error as ValidationException).asMessage();

      expect(validationError.$typeName).toBe("spine.validation.ValidationError");
      expect(validationError.constraintViolation).toHaveLength(1);
      expect(validationError.constraintViolation[0]?.$typeName).toBe(
        "spine.validation.ConstraintViolation",
      );
      expect(validationError.constraintViolation[0]?.typeName).toBe(
        "example.validation.RequiredName",
      );
      expect(validationError.constraintViolation[0]?.fieldPath?.fieldName).toEqual(["name"]);
      expect(validationError.constraintViolation[0]?.message?.withPlaceholders).toBe(
        "The field `${parent.type}.${field.path}` of the type `${field.type}` must have a non-default value.",
      );
      expect(validationError.constraintViolation[0]?.message?.placeholderValue).toEqual({
        "field.path": "[redacted]",
        "field.type": "[redacted]",
        "message.type": "[redacted]",
        "parent.type": "[redacted]",
      });
    }
  });

  it("returns invalid results and creates ValidationError messages without direct upstream imports", () => {
    const result = Validate.message(RequiredNameSchema, create(RequiredNameSchema, { name: "" }));

    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.$typeName).toBe("spine.validation.ConstraintViolation");
    expect(result.violations[0]?.fieldPath?.fieldName).toEqual(["name"]);
    expect(result.violations[0]?.fieldValue).toBeUndefined();
    expect(result.violations[0]?.message?.placeholderValue).toEqual({
      "field.path": "[redacted]",
      "field.type": "[redacted]",
      "message.type": "[redacted]",
      "parent.type": "[redacted]",
    });
    expect(result.error?.$typeName).toBe("spine.validation.ValidationError");
    expect(result.error?.constraintViolation).toEqual(result.violations);

    const validationError = Validate.createError(result.violations);

    expect(validationError.$typeName).toBe("spine.validation.ValidationError");
    expect(validationError.constraintViolation).toEqual(result.violations);
  });

  it("returns the original message from Validate.check and accepts empty transition rule sets", () => {
    const message = create(RequiredNameSchema, { name: "ready" });

    expect(Validate.check(RequiredNameSchema, message)).toBe(message);
    expect(Validate.transition({ schema: RequiredNameSchema, previous: undefined, next: message }))
      .toMatchInlineSnapshot(`
        {
          "error": undefined,
          "valid": true,
          "violations": [],
        }
      `);
  });

  it("runs framework transition rules separately from single-message validation", () => {
    const previous = create(RequiredNameSchema, { name: "first" });
    const next = create(RequiredNameSchema, { name: "second" });
    const violation = transitionViolation("The field `name` cannot be reassigned.");

    const singleMessageResult = Validate.message(RequiredNameSchema, next);
    const transitionResult = Validate.transition({ schema: RequiredNameSchema, previous, next }, [
      {
        validateTransition() {
          return [violation];
        },
      },
    ]);

    expect(singleMessageResult.valid).toBe(true);
    expect(transitionResult.valid).toBe(false);
    expect(transitionResult.violations).toEqual([violation]);
    expect(transitionResult.error?.constraintViolation).toEqual([violation]);
  });

  it("sanitizes transition-rule returned violation details before aggregation", () => {
    const previous = create(RequiredNameSchema, { name: "previous-secret" });
    const next = create(RequiredNameSchema, { name: "next-secret" });
    const leakingViolation = create(ConstraintViolationSchema, {
      typeName: "example.validation.RequiredName",
      fieldPath: create(FieldPathSchema, { fieldName: ["name"] }),
      fieldValue: create(AnySchema, {
        typeUrl: "type.example.test/example.SecretState",
        value: new Uint8Array([115, 101, 99, 114, 101, 116]),
      }),
      message: create(TemplateStringSchema, {
        withPlaceholders: "Name changed from `${previous}` to `${next}`.",
        placeholderValue: {
          previous: "previous-secret",
          next: "next-secret",
          arbitrary: "rule-owned-secret",
        },
      }),
    });

    const result = Validate.transition({ schema: RequiredNameSchema, previous, next }, [
      {
        validateTransition() {
          return [leakingViolation];
        },
      },
    ]);

    expect(result.valid).toBe(false);
    if (result.valid) {
      throw new Error("Expected transition validation to fail.");
    }
    const [violation] = result.violations;

    expect(violation.typeName).toBe("example.validation.RequiredName");
    expect(violation.fieldPath?.fieldName).toEqual(["name"]);
    expect(violation.fieldValue).toBeUndefined();
    expect(violation.message?.withPlaceholders).toBe(
      "Name changed from `${previous}` to `${next}`.",
    );
    expect(violation.message?.placeholderValue).toEqual({
      previous: "[redacted]",
      next: "[redacted]",
      arbitrary: "[redacted]",
    });
    expect(result.error.constraintViolation).toEqual(result.violations);
    expect(JSON.stringify(result.violations)).not.toContain("previous-secret");
    expect(JSON.stringify(result.error)).not.toContain("next-secret");
    expect(JSON.stringify(result.error)).not.toContain("rule-owned-secret");

    try {
      throw new ValidationException(result.error);
    } catch (error) {
      const validationError = (error as ValidationException).asMessage();

      expect(JSON.stringify(validationError)).not.toContain("previous-secret");
      expect(JSON.stringify(validationError)).not.toContain("next-secret");
      expect(JSON.stringify(validationError)).not.toContain("rule-owned-secret");
    }
  });

  it("preserves a minimal transition violation without optional details", () => {
    const state = create(RequiredNameSchema, { name: "ready" });
    const result = Validate.transition(
      { schema: RequiredNameSchema, previous: undefined, next: state },
      [
        {
          validateTransition() {
            return [
              create(ConstraintViolationSchema, { typeName: "example.Minimal" }),
              create(ConstraintViolationSchema, {
                typeName: "example.MessageOnly",
                message: create(TemplateStringSchema, { withPlaceholders: "Message only." }),
              }),
            ];
          },
        },
      ],
    );

    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations[0]?.typeName).toBe("example.Minimal");
    expect(result.violations[0]?.message).toBeUndefined();
    expect(result.violations[0]?.fieldPath).toBeUndefined();
    expect(result.violations[1]?.message?.placeholderValue).toEqual({});
  });

  it("isolates throwing transition rules and preserves deterministic rule order", () => {
    const previous = create(RequiredNameSchema, { name: "first" });
    const next = create(RequiredNameSchema, { name: "second" });
    const firstViolation = transitionViolation("first transition violation");
    const lastViolation = transitionViolation("last transition violation");
    const calls: string[] = [];

    const result = Validate.transition({ schema: RequiredNameSchema, previous, next }, [
      {
        validateTransition() {
          calls.push("first");
          return [firstViolation];
        },
      },
      {
        validateTransition() {
          calls.push("throwing");
          throw new Error("raw transition payload secret");
        },
      },
      {
        validateTransition() {
          calls.push("last");
          return [lastViolation];
        },
      },
    ]);

    expect(calls).toEqual(["first", "throwing", "last"]);
    expect(result.valid).toBe(false);
    expect(result.violations.map((violation) => violation.message?.withPlaceholders)).toEqual([
      "first transition violation",
      "Transition validation rule failed.",
      "last transition violation",
    ]);
    expect(result.violations[1]?.typeName).toBe("example.validation.RequiredName");
    expect(JSON.stringify(result.error)).not.toContain("raw transition payload secret");
  });
});

describe("@spine-event-engine/core envelope packing", () => {
  it("exposes immutable public owner methods", () => {
    const rejectsReassignment = () => {
      // @ts-expect-error Frozen owner methods cannot be reassigned.
      Validate.message = () => ({ valid: true, violations: [], error: undefined });
    };
    void rejectsReassignment;
    for (const [owner, method] of [
      [Validate, "message"],
      [TypeUrls, "derive"],
      [AnyMessages, "pack"],
      [SignalEnvelopes, "command"],
    ] as const) {
      expect(Object.isFrozen(owner)).toBe(true);
      expect(Object.getOwnPropertyDescriptor(owner, method)?.writable).toBe(false);
    }
  });

  it("keeps packing for schemas without a Spine option on the default canonical URL", () => {
    const packed = AnyMessages.pack(AnySchema, create(AnySchema));

    expect(packed.typeUrl).toBe("type.googleapis.com/google.protobuf.Any");
  });

  it("packs Any values with Spine type URLs and Protobuf-ES binary payloads", () => {
    const message = create(FieldPathSchema, { fieldName: ["task", "id"] });

    const packed = AnyMessages.pack(FieldPathSchema, message);

    expect(packed.typeUrl).toBe("type.spine.io/spine.base.FieldPath");
    expect(packed.typeUrl).toBe(TypeUrls.derive(FieldPathSchema));
    expect(packed.typeUrl).not.toBe("type.googleapis.com/spine.base.FieldPath");
    expect(packed.value).toEqual(toBinary(FieldPathSchema, message));
    expect(AnyMessages.unpack(packed, FieldPathSchema)).toEqual(message);
    expect(AnyMessages.unpack(packed, ValidationErrorSchema)).toBeUndefined();
  });

  it("omits unknown fields from framework-packed Any payloads by default", () => {
    const message = fieldPathWithUnknownFields();

    const packed = AnyMessages.pack(FieldPathSchema, message);
    const stableBytes = toBinary(FieldPathSchema, message, { writeUnknownFields: false });

    expect(toBinary(FieldPathSchema, message)).not.toEqual(stableBytes);
    expect(packed.value).toEqual(stableBytes);
  });

  it("returns undefined instead of throwing when matching Any payload bytes are malformed", () => {
    const malformed = create(AnySchema, {
      typeUrl: TypeUrls.derive(FieldPathSchema),
      value: new Uint8Array([0xff]),
    });

    expect(AnyMessages.unpack(malformed, FieldPathSchema)).toBeUndefined();
  });

  it("lets callers opt out of payload validation when packing already-trusted messages", () => {
    const invalidMessage = create(RequiredNameSchema, { name: "" });

    expect(() => AnyMessages.pack(RequiredNameSchema, invalidMessage)).toThrow(ValidationException);

    const packed = AnyMessages.pack(RequiredNameSchema, invalidMessage, { validate: false });

    expect(packed.typeUrl).toBe(TypeUrls.derive(RequiredNameSchema));
    expect(AnyMessages.unpack(packed, RequiredNameSchema)).toEqual(invalidMessage);
  });

  it("packs caller-supplied command IDs and contexts without generating runtime metadata", () => {
    const id = create(CommandIdSchema, { uuid: "command-id-from-caller" });
    const context = commandContext();
    const message = create(FieldPathSchema, { fieldName: ["task"] });

    const command = SignalEnvelopes.command({
      id,
      context,
      schema: FieldPathSchema,
      message,
    });

    expect(command.$typeName).toBe("spine.core.Command");
    expect(command.id).toEqual(id);
    expect(command.context).toEqual(context);
    expect(command.systemProperties).toBeUndefined();
    expect(command.message?.typeUrl).toBe(TypeUrls.derive(FieldPathSchema));
    expect(command.message?.value).toEqual(toBinary(FieldPathSchema, message));
    expect(AnyMessages.unpack(command.message ?? create(AnySchema), FieldPathSchema)).toEqual(
      message,
    );

    id.uuid = "mutated-command-id";
    if (context.actorContext?.actor === undefined) {
      throw new Error("Expected command context actor fixture.");
    }
    context.actorContext.actor.value = "mutated-user";

    expect(command.id?.uuid).toBe("command-id-from-caller");
    expect(command.context?.actorContext?.actor?.value).toBe("user-1");
  });

  it("packs caller-supplied event IDs and contexts without generating producer policy", () => {
    const id = create(EventIdSchema, { value: "event-id-from-caller" });
    const context = eventContext();
    const message = create(FieldPathSchema, { fieldName: ["task", "created"] });

    const event = SignalEnvelopes.event({
      id,
      context,
      schema: FieldPathSchema,
      message,
    });

    expect(event.$typeName).toBe("spine.core.Event");
    expect(event.id).toEqual(id);
    expect(event.context).toEqual(context);
    expect(event.message?.typeUrl).toBe(TypeUrls.derive(FieldPathSchema));
    expect(event.message?.value).toEqual(toBinary(FieldPathSchema, message));
    expect(AnyMessages.unpack(event.message ?? create(AnySchema), FieldPathSchema)).toEqual(
      message,
    );

    id.value = "mutated-event-id";
    if (context.version === undefined) {
      throw new Error("Expected event context version fixture.");
    }
    context.version.number = 99;

    expect(event.id?.value).toBe("event-id-from-caller");
    expect(event.context?.version?.number).toBe(1);
  });
});
