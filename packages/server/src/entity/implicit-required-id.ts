import { create, hasOption, ScalarType, toBinary, type MessageShape } from "@bufbuild/protobuf";
import type { DescField } from "@bufbuild/protobuf";
import {
  type MessageSchema,
  type MessageValidationResult,
  type TransitionValidationRule,
  Validate,
} from "@spine-event-engine/core";
import {
  ConstraintViolationSchema,
  FieldPathSchema,
  TemplateStringSchema,
} from "@spine-event-engine/proto";
import { required } from "@spine-event-engine/proto/generated/spine/options_pb.js";

import type { DescriptorMessageSchema } from "./entity-metadata.js";

const requiredMessage =
  "The field `${parent.type}.${field.path}` of the type `${field.type}` must have a non-default value.";

interface ImplicitRequiredIdPolicy {
  validateCommand<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    message: MessageShape<Schema>,
  ): MessageValidationResult;
  entityRule<Schema extends DescriptorMessageSchema>(): TransitionValidationRule<Schema>;
}

/**
 * Applies the declaration-first implicit-required convention at server signal boundaries.
 *
 * @internal
 */
export const ImplicitRequiredIds: Readonly<ImplicitRequiredIdPolicy> = Object.freeze({
  validateCommand<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    message: MessageShape<Schema>,
  ): MessageValidationResult {
    return schema.file.proto.name.endsWith("commands.proto")
      ? ImplicitRequiredIdsInternal.validate(schema, message)
      : Validate.transition({ schema, previous: undefined, next: message });
  },

  entityRule<Schema extends DescriptorMessageSchema>(): TransitionValidationRule<Schema> {
    return {
      validateTransition: ({ schema, next }) =>
        ImplicitRequiredIdsInternal.violations(schema, next),
    };
  },
});

const ImplicitRequiredIdsInternal = Object.freeze({
  validate<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    message: MessageShape<Schema>,
  ): MessageValidationResult {
    return Validate.transition({ schema, previous: undefined, next: message }, [
      ImplicitRequiredIds.entityRule<Schema>(),
    ]);
  },

  violations<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    message: MessageShape<Schema>,
  ) {
    const [field] = schema.fields;
    if (
      field === undefined ||
      hasOption(field, required) ||
      !ImplicitRequiredIdsInternal.supported(field) ||
      !ImplicitRequiredIdsInternal.missing(field, message)
    ) {
      return [];
    }
    return [
      create(ConstraintViolationSchema, {
        typeName: schema.typeName,
        fieldPath: create(FieldPathSchema, { fieldName: [field.name] }),
        message: create(TemplateStringSchema, {
          withPlaceholders: requiredMessage,
          placeholderValue: {
            "field.path": field.name,
            "field.type": ImplicitRequiredIdsInternal.typeName(field),
            "message.type": schema.typeName,
            "parent.type": schema.typeName,
          },
        }),
      }),
    ];
  },

  supported(field: DescField): boolean {
    if (field.fieldKind === "scalar") {
      return field.scalar === ScalarType.STRING || field.scalar === ScalarType.BYTES;
    }
    return true;
  },

  missing(field: DescField, message: Record<string, unknown>): boolean {
    let value: unknown;
    try {
      value = message[field.localName];
    } catch {
      return true;
    }
    switch (field.fieldKind) {
      case "scalar":
        return field.scalar === ScalarType.STRING
          ? value === ""
          : !(value instanceof Uint8Array) || value.length === 0;
      case "enum":
        return value === 0;
      case "message":
        return (
          value === undefined ||
          toBinary(field.message as MessageSchema, value as never).length === 0
        );
      case "list":
        return !Array.isArray(value) || value.length === 0;
      case "map":
        return typeof value !== "object" || value === null || Object.keys(value).length === 0;
    }
  },

  typeName(field: DescField): string {
    switch (field.fieldKind) {
      case "scalar":
        return ScalarType[field.scalar];
      case "enum":
        return field.enum.typeName;
      case "message":
        return field.message.typeName;
      case "list":
        return "repeated";
      case "map":
        return "map";
    }
  },
});
