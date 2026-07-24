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
  type MessageValidationResult,
  type TypeMetadata,
  TypeRegistry,
  ValidationException,
  RejectionThrowable,
  checkValid,
  createRejectionThrowable,
  createValidationError,
  createSpineCoreRegistry,
  deriveTypeUrl,
  getTypeUrlPrefix,
  isRejectionThrowable,
  packAny,
  packCommand,
  packEvent,
  spineCoreRegistry,
  unpackAny,
  validateTransition,
  validateMessage,
} from "../src/index.js";

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
    producerId: packAny(UserIdSchema, producerId),
    version: create(VersionSchema, { number: 1 }),
  });
}

function fieldPathWithUnknownFields() {
  const encoded = toBinary(FieldPathSchema, create(FieldPathSchema, { fieldName: ["task"] }));
  const unknownField = new Uint8Array([0x98, 0x06, 0x7b]);

  return fromBinary(FieldPathSchema, new Uint8Array([...encoded, ...unknownField]));
}

describe("RejectionThrowable", () => {
  it("keeps a nominal, cloned rejection message with Error behavior", () => {
    const rejection = createRejectionThrowable(RequiredRejectionSchema, {
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
    expect(() => createRejectionThrowable(RequiredRejectionSchema, {})).toThrow(
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
    const rejection = createRejectionThrowable(PayloadRejectedSchema, input);
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
    const rejection = createRejectionThrowable(RequiredRejectionSchema, {
      name: "Task already done",
    });
    const spoofedError = new Error("spoofed");

    Object.setPrototypeOf(spoofedError, RejectionThrowable.prototype);

    expect(isRejectionThrowable(rejection)).toBe(true);
    expect(isRejectionThrowable(new Error("ordinary"))).toBe(false);
    expect(spoofedError).toBeInstanceOf(RejectionThrowable);
    expect(isRejectionThrowable(spoofedError)).toBe(false);
    expect(isRejectionThrowable({ schema: RequiredRejectionSchema })).toBe(false);
  });

  it("accepts only top-level messages declared in rejections.proto files", () => {
    expect(() =>
      createRejectionThrowable(RequiredRejectionSchema, { name: "valid" }),
    ).not.toThrow();
    expect(() => createRejectionThrowable(RequiredNameSchema, { name: "ordinary" })).toThrow(
      TypeError,
    );
    expect(() => createRejectionThrowable(NestedRejectionSchema, { reason: "nested" })).toThrow(
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
        input: Parameters<typeof createRejectionThrowable<typeof RequiredRejectionSchema>>[1],
      ) => createRejectionThrowable(RequiredRejectionSchema, input),
    };

    expectTypeOf<{ name: string }>().toExtend<Parameters<typeof TaskAlreadyDone.create>[0]>();
    expectTypeOf<{ name: number }>().not.toExtend<Parameters<typeof TaskAlreadyDone.create>[0]>();
    expect(TaskAlreadyDone).toBeDefined();
  });
});

describe("@spine-event-engine/core type registry", () => {
  it("derives type URLs from Spine file type_url_prefix options", () => {
    expect(deriveTypeUrl(FieldPathSchema)).toBe("type.spine.io/spine.base.FieldPath");
    expect(deriveTypeUrl(ValidationErrorSchema)).toBe(
      "type.spine.io/spine.validation.ValidationError",
    );
  });

  it("uses the documented fallback prefix when a file has no Spine prefix option", () => {
    expect(DEFAULT_TYPE_URL_PREFIX).toBe("type.googleapis.com");
    expect(deriveTypeUrl(AnySchema)).toBe("type.googleapis.com/google.protobuf.Any");
  });

  it.each(["", " \t\n", "/", "///"])(
    "rejects malformed custom fallback prefix %j for schemas without a Spine option",
    (fallbackPrefix) => {
      const message = "Fallback type URL prefix must be non-empty and contain no whitespace.";

      expect(() => getTypeUrlPrefix(AnySchema, fallbackPrefix)).toThrow(new TypeError(message));
      expect(() => deriveTypeUrl(AnySchema, { fallbackPrefix })).toThrow(new TypeError(message));
    },
  );

  it.each(["type.example.test", "type.example.test/", "type.example.test///"])(
    "canonicalizes valid custom fallback prefix %j for schemas without a Spine option",
    (fallbackPrefix) => {
      const expectedPrefix = "type.example.test";

      expect(getTypeUrlPrefix(AnySchema, fallbackPrefix)).toBe(expectedPrefix);
      expect(deriveTypeUrl(AnySchema, { fallbackPrefix })).toBe(
        `${expectedPrefix}/google.protobuf.Any`,
      );
    },
  );

  it("uses a Spine file option before considering an unused custom fallback", () => {
    expect(getTypeUrlPrefix(FieldPathSchema, "///")).toBe("type.spine.io");
    expect(deriveTypeUrl(FieldPathSchema, { fallbackPrefix: "///" })).toBe(
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

  it("indexes caller-provided semantic tags", () => {
    const registry = new TypeRegistry();
    const metadata = registry.register(FieldPathSchema, {
      semanticTags: ["io.spine.FieldSelector"],
    });

    expect(registry.findBySemanticTag("io.spine.FieldSelector")).toEqual([metadata]);
  });

  it("registers the current curated Spine schemas in the default registry", () => {
    const registry = createSpineCoreRegistry();

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
    const registry = createSpineCoreRegistry();

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
    expect(spineCoreRegistry.findBySemanticTag("io.spine.SomeMarker")).toEqual([]);
    expect(spineCoreRegistry.list().map((metadata) => metadata.fullTypeName)).toContain(
      "spine.validation.ValidationError",
    );
  });

  it("keeps semantic tag lookup future-compatible without inventing tags", () => {
    const registry = createSpineCoreRegistry();

    expect(registry.findBySemanticTag("io.spine.SomeMarker")).toEqual([]);
    expect(registry.getBySchema(FieldPathSchema).semanticTags).toEqual([]);
  });
});

describe("@spine-event-engine/core validation facade", () => {
  it("narrows result invariants for valid and invalid validation outcomes", () => {
    const validResult: MessageValidationResult = validateMessage(ValidationErrorSchema, {
      $typeName: "spine.validation.ValidationError",
      constraintViolation: [],
    });

    if (validResult.valid) {
      expectTypeOf(validResult.violations).toEqualTypeOf<readonly []>();
      expectTypeOf(validResult.error).toEqualTypeOf<undefined>();
      expect(validResult.violations).toEqual([]);
      expect(validResult.error).toBeUndefined();
    }

    const invalidResult: MessageValidationResult = validateMessage(
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
    const result = validateMessage(ValidationErrorSchema, {
      $typeName: "spine.validation.ValidationError",
      constraintViolation: [],
    });

    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it("throws a ValidationException that exposes structured ValidationError data", () => {
    const message = create(RequiredNameSchema, { name: "" });

    expect(() => checkValid(RequiredNameSchema, message)).toThrow(ValidationException);

    try {
      checkValid(RequiredNameSchema, message);
      throw new Error("Expected checkValid() to throw.");
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
        "A value must be set.",
      );
      expect(validationError.constraintViolation[0]?.message?.placeholderValue).toEqual({
        field: "[redacted]",
        value: "[redacted]",
      });
    }
  });

  it("returns invalid results and creates ValidationError messages without validation-ts imports", () => {
    const result = validateMessage(RequiredNameSchema, create(RequiredNameSchema, { name: "" }));

    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.$typeName).toBe("spine.validation.ConstraintViolation");
    expect(result.violations[0]?.fieldPath?.fieldName).toEqual(["name"]);
    expect(result.violations[0]?.fieldValue).toBeUndefined();
    expect(result.violations[0]?.message?.placeholderValue).toEqual({
      field: "[redacted]",
      value: "[redacted]",
    });
    expect(result.error?.$typeName).toBe("spine.validation.ValidationError");
    expect(result.error?.constraintViolation).toEqual(result.violations);

    const validationError = createValidationError(result.violations);

    expect(validationError.$typeName).toBe("spine.validation.ValidationError");
    expect(validationError.constraintViolation).toEqual(result.violations);
  });

  it("returns the original message from checkValid and accepts empty transition rule sets", () => {
    const message = create(RequiredNameSchema, { name: "ready" });

    expect(checkValid(RequiredNameSchema, message)).toBe(message);
    expect(validateTransition({ schema: RequiredNameSchema, previous: undefined, next: message }))
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

    const singleMessageResult = validateMessage(RequiredNameSchema, next);
    const transitionResult = validateTransition({ schema: RequiredNameSchema, previous, next }, [
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

    const result = validateTransition({ schema: RequiredNameSchema, previous, next }, [
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

  it("isolates throwing transition rules and preserves deterministic rule order", () => {
    const previous = create(RequiredNameSchema, { name: "first" });
    const next = create(RequiredNameSchema, { name: "second" });
    const firstViolation = transitionViolation("first transition violation");
    const lastViolation = transitionViolation("last transition violation");
    const calls: string[] = [];

    const result = validateTransition({ schema: RequiredNameSchema, previous, next }, [
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
  it("keeps packing for schemas without a Spine option on the default canonical URL", () => {
    const packed = packAny(AnySchema, create(AnySchema));

    expect(packed.typeUrl).toBe("type.googleapis.com/google.protobuf.Any");
  });

  it("packs Any values with Spine type URLs and Protobuf-ES binary payloads", () => {
    const message = create(FieldPathSchema, { fieldName: ["task", "id"] });

    const packed = packAny(FieldPathSchema, message);

    expect(packed.typeUrl).toBe("type.spine.io/spine.base.FieldPath");
    expect(packed.typeUrl).toBe(deriveTypeUrl(FieldPathSchema));
    expect(packed.typeUrl).not.toBe("type.googleapis.com/spine.base.FieldPath");
    expect(packed.value).toEqual(toBinary(FieldPathSchema, message));
    expect(unpackAny(packed, FieldPathSchema)).toEqual(message);
    expect(unpackAny(packed, ValidationErrorSchema)).toBeUndefined();
  });

  it("omits unknown fields from framework-packed Any payloads by default", () => {
    const message = fieldPathWithUnknownFields();

    const packed = packAny(FieldPathSchema, message);
    const stableBytes = toBinary(FieldPathSchema, message, { writeUnknownFields: false });

    expect(toBinary(FieldPathSchema, message)).not.toEqual(stableBytes);
    expect(packed.value).toEqual(stableBytes);
  });

  it("returns undefined instead of throwing when matching Any payload bytes are malformed", () => {
    const malformed = create(AnySchema, {
      typeUrl: deriveTypeUrl(FieldPathSchema),
      value: new Uint8Array([0xff]),
    });

    expect(unpackAny(malformed, FieldPathSchema)).toBeUndefined();
  });

  it("lets callers opt out of payload validation when packing already-trusted messages", () => {
    const invalidMessage = create(RequiredNameSchema, { name: "" });

    expect(() => packAny(RequiredNameSchema, invalidMessage)).toThrow(ValidationException);

    const packed = packAny(RequiredNameSchema, invalidMessage, { validate: false });

    expect(packed.typeUrl).toBe(deriveTypeUrl(RequiredNameSchema));
    expect(unpackAny(packed, RequiredNameSchema)).toEqual(invalidMessage);
  });

  it("packs caller-supplied command IDs and contexts without generating runtime metadata", () => {
    const id = create(CommandIdSchema, { uuid: "command-id-from-caller" });
    const context = commandContext();
    const message = create(FieldPathSchema, { fieldName: ["task"] });

    const command = packCommand({
      id,
      context,
      schema: FieldPathSchema,
      message,
    });

    expect(command.$typeName).toBe("spine.core.Command");
    expect(command.id).toEqual(id);
    expect(command.context).toEqual(context);
    expect(command.systemProperties).toBeUndefined();
    expect(command.message?.typeUrl).toBe(deriveTypeUrl(FieldPathSchema));
    expect(command.message?.value).toEqual(toBinary(FieldPathSchema, message));
    expect(unpackAny(command.message ?? create(AnySchema), FieldPathSchema)).toEqual(message);

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

    const event = packEvent({
      id,
      context,
      schema: FieldPathSchema,
      message,
    });

    expect(event.$typeName).toBe("spine.core.Event");
    expect(event.id).toEqual(id);
    expect(event.context).toEqual(context);
    expect(event.message?.typeUrl).toBe(deriveTypeUrl(FieldPathSchema));
    expect(event.message?.value).toEqual(toBinary(FieldPathSchema, message));
    expect(unpackAny(event.message ?? create(AnySchema), FieldPathSchema)).toEqual(message);

    id.value = "mutated-event-id";
    if (context.version === undefined) {
      throw new Error("Expected event context version fixture.");
    }
    context.version.number = 99;

    expect(event.id?.value).toBe("event-id-from-caller");
    expect(event.context?.version?.number).toBe(1);
  });
});
