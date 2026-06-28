import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getOption, hasOption, create } from "@bufbuild/protobuf";

import {
  FieldPathSchema,
  TemplateStringSchema,
  ValidationErrorSchema,
  file_spine_options,
  file_spine_validation_validation_error,
  type_url_prefix,
} from "./index.js";

interface ProtoSourceManifest {
  readonly schemaVersion: 1;
  readonly sources: readonly {
    readonly localPath: string;
    readonly repository: string;
    readonly commit: string;
    readonly upstreamPath: string;
    readonly sha256: string;
  }[];
}

describe("@spine-ts/proto", () => {
  it("verifies the copied Spine proto source manifest checksums", () => {
    const manifest = JSON.parse(
      readFileSync(resolve("proto/spine-sources.json"), "utf8"),
    ) as ProtoSourceManifest;

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.sources).toHaveLength(4);

    for (const source of manifest.sources) {
      const contents = readFileSync(resolve(source.localPath));
      const actual = createHash("sha256").update(contents).digest("hex");

      expect(source.repository).toMatch(/^SpineEventEngine\//);
      expect(source.commit).toMatch(/^[0-9a-f]{12}$/);
      expect(source.upstreamPath).toMatch(/\.proto$/);
      expect(actual).toBe(source.sha256);
    }
  });

  it("exports generated schemas for validation errors and their dependencies", () => {
    expect(ValidationErrorSchema.typeName).toBe("spine.validation.ValidationError");
    expect(FieldPathSchema.typeName).toBe("spine.base.FieldPath");
    expect(TemplateStringSchema.typeName).toBe("spine.string.TemplateString");

    const validationError = create(ValidationErrorSchema);

    expect(validationError.$typeName).toBe("spine.validation.ValidationError");
    expect(validationError.constraintViolation).toEqual([]);
  });

  it("preserves the Spine type URL prefix custom option in generated descriptors", () => {
    expect(hasOption(file_spine_options, type_url_prefix)).toBe(true);
    expect(getOption(file_spine_options, type_url_prefix)).toBe("type.spine.io");
    expect(getOption(file_spine_validation_validation_error, type_url_prefix)).toBe(
      "type.spine.io",
    );
  });
});
