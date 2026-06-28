import type { GenExtension, GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { FileOptions } from "@bufbuild/protobuf/wkt";
import {
  ConstraintViolationSchema as generatedConstraintViolationSchema,
  ValidationErrorSchema as generatedValidationErrorSchema,
  file_spine_validation_validation_error as generatedFileSpineValidationValidationError,
} from "./generated/spine/validation/validation_error_pb.js";
import type {
  ConstraintViolation,
  ValidationError,
} from "./generated/spine/validation/validation_error_pb.js";
import {
  FieldPathSchema as generatedFieldPathSchema,
  file_spine_base_field_path as generatedFileSpineBaseFieldPath,
} from "./generated/spine/base/field_path_pb.js";
import type { FieldPath } from "./generated/spine/base/field_path_pb.js";
import {
  TemplateStringSchema as generatedTemplateStringSchema,
  file_spine_string_template_string as generatedFileSpineStringTemplateString,
} from "./generated/spine/string/template_string_pb.js";
import type { TemplateString } from "./generated/spine/string/template_string_pb.js";
import {
  file_spine_options as generatedFileSpineOptions,
  type_url_prefix as generatedTypeUrlPrefix,
} from "./generated/spine/options_pb.js";

/**
 * Generated Protobuf-ES schemas for the first Spine proto intake set.
 *
 * Runtime metadata registries, validation facades, and `Any` packing helpers are
 * intentionally deferred to later framework tasks.
 */
export * from "./generated/spine/options_pb.js";
export * from "./generated/spine/base/field_path_pb.js";
export * from "./generated/spine/string/template_string_pb.js";
export * from "./generated/spine/validation/validation_error_pb.js";

/** File descriptor for `spine/options.proto`. */
export const file_spine_options: GenFile = generatedFileSpineOptions;

/** File descriptor for `spine/base/field_path.proto`. */
export const file_spine_base_field_path: GenFile = generatedFileSpineBaseFieldPath;

/** File descriptor for `spine/string/template_string.proto`. */
export const file_spine_string_template_string: GenFile = generatedFileSpineStringTemplateString;

/** File descriptor for `spine/validation/validation_error.proto`. */
export const file_spine_validation_validation_error: GenFile =
  generatedFileSpineValidationValidationError;

/** Spine custom file option that stores the type URL prefix for file messages. */
export const type_url_prefix: GenExtension<FileOptions, string> = generatedTypeUrlPrefix;

/** Schema for `spine.base.FieldPath`. */
export const FieldPathSchema: GenMessage<FieldPath> = generatedFieldPathSchema;

/** Schema for `spine.string.TemplateString`. */
export const TemplateStringSchema: GenMessage<TemplateString> = generatedTemplateStringSchema;

/** Schema for `spine.validation.ValidationError`. */
export const ValidationErrorSchema: GenMessage<ValidationError> = generatedValidationErrorSchema;

/** Schema for `spine.validation.ConstraintViolation`. */
export const ConstraintViolationSchema: GenMessage<ConstraintViolation> =
  generatedConstraintViolationSchema;
