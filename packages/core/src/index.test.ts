import { describe, expect, it } from "vitest";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import {
  ConstraintViolationSchema,
  FieldPathSchema,
  TemplateStringSchema,
  ValidationErrorSchema,
  type_url_prefix,
} from "@spine-ts/proto";

import {
  DEFAULT_TYPE_URL_PREFIX,
  type TypeMetadata,
  TypeRegistry,
  createSpineCoreRegistry,
  deriveTypeUrl,
  spineCoreRegistry,
} from "./index.js";

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
