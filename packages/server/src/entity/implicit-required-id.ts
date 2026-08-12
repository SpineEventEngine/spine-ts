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
  entityRule<Schema extends DescriptorMessageSchema>(
    schema: Schema,
  ): TransitionValidationRule<Schema>;
}

const commandRules = new WeakMap<DescriptorMessageSchema, TransitionValidationRule>();
const entityRules = new WeakMap<DescriptorMessageSchema, TransitionValidationRule>();

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
    if (!ImplicitRequiredIdsInternal.commandSchema(schema)) {
      return Validate.transition({ schema, previous: undefined, next: message });
    }
    const rule = ImplicitRequiredIdsInternal.cachedRule(commandRules, schema);
    return Validate.transition({ schema, previous: undefined, next: message }, [rule]);
  },

  entityRule<Schema extends DescriptorMessageSchema>(
    schema: Schema,
  ): TransitionValidationRule<Schema> {
    return ImplicitRequiredIdsInternal.cachedRule(entityRules, schema);
  },
});

const ImplicitRequiredIdsInternal = Object.freeze({
  commandSchema(schema: DescriptorMessageSchema): boolean {
    const fileName = schema.file.proto.name.split("/").at(-1);
    return fileName === "commands.proto" || fileName?.endsWith("_commands.proto") === true;
  },

  cachedRule<Schema extends DescriptorMessageSchema>(
    cache: WeakMap<DescriptorMessageSchema, TransitionValidationRule>,
    schema: Schema,
  ): TransitionValidationRule<Schema> {
    const cached = cache.get(schema) as TransitionValidationRule<Schema> | undefined;
    if (cached !== undefined) return cached;
    const rule = ImplicitRequiredIdsInternal.rule<Schema>(schema.fields[0]);
    cache.set(schema, rule);
    return rule;
  },

  rule<Schema extends DescriptorMessageSchema>(
    field: DescField | undefined,
  ): TransitionValidationRule<Schema> {
    if (
      field === undefined ||
      hasOption(field, required) ||
      !ImplicitRequiredIdsInternal.supported(field)
    ) {
      return { validateTransition: () => [] };
    }
    return {
      validateTransition: ({ schema, next }) =>
        ImplicitRequiredIdsInternal.missing(field, next)
          ? [ImplicitRequiredIdsInternal.violation(schema, field)]
          : [],
    };
  },

  violation(schema: DescriptorMessageSchema, field: DescField) {
    return create(ConstraintViolationSchema, {
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
    });
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
