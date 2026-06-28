import { create } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { describe, expect, expectTypeOf, it } from "vitest";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import {
  type ConstraintViolation,
  ConstraintViolationSchema,
  FieldPathSchema,
  TemplateStringSchema,
  type ValidationError,
  ValidationErrorSchema,
  file_spine_options,
  type_url_prefix,
} from "@spine-ts/proto";

import {
  DEFAULT_TYPE_URL_PREFIX,
  type MessageValidationResult,
  type TypeMetadata,
  TypeRegistry,
  ValidationException,
  checkValid,
  createValidationError,
  createSpineCoreRegistry,
  deriveTypeUrl,
  spineCoreRegistry,
  validateTransition,
  validateMessage,
} from "./index.js";

type RequiredName = Message<"example.validation.RequiredName"> & {
  name: string;
};

// Descriptor fixture compiled from:
// syntax = "proto3"; package example.validation;
// message RequiredName { string name = 1 [(required) = true]; }
const fileExampleValidationFixture = fileDesc(
  "CiBleGFtcGxlL3ZhbGlkYXRpb25fZml4dHVyZS5wcm90bxISZXhhbXBsZS52YWxpZGF0aW9uIiIKDFJlcXVpcmVkTmFtZRISCgRuYW1lGAEgASgJQgSghSQBYgZwcm90bzM",
  [file_spine_options],
);
const RequiredNameSchema = messageDesc(fileExampleValidationFixture, 0) as GenMessage<RequiredName>;

function transitionViolation(message: string): ConstraintViolation {
  return create(ConstraintViolationSchema, {
    typeName: "example.validation.RequiredName",
    fieldPath: create(FieldPathSchema, { fieldName: ["name"] }),
    message: create(TemplateStringSchema, {
      withPlaceholders: message,
    }),
  });
}

describe("@spine-ts/core type registry", () => {
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
      /Explicit type URL "type\.example\.test\/example\.WrongType" must have the form "<prefix>\/spine\.base\.FieldPath"/,
    );

    const metadata = registry.register(FieldPathSchema, {
      typeUrl: "type.example.test/spine.base.FieldPath",
    });

    expect(metadata.typeUrl).toBe("type.example.test/spine.base.FieldPath");
    expect(metadata.typeUrlPrefix).toBe("type.example.test");
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

describe("@spine-ts/core validation facade", () => {
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
        field: "name",
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
      field: "name",
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
