import { create, type MessageShape } from "@bufbuild/protobuf";
import {
  type TransitionValidationResult,
  type TransitionValidationRule,
  validateTransition,
} from "@spine-ts/core";
import {
  type ConstraintViolation,
  ConstraintViolationSchema,
  FieldPathSchema,
  TemplateStringSchema,
} from "@spine-ts/proto";

import {
  describeEntityMetadata,
  type DescriptorFieldMetadata,
  type DescriptorMessageSchema,
} from "./entity-metadata.js";

/** Request for built-in server entity state transition validation. */
export interface EntityStateTransitionValidationRequest<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
> {
  /** Generated Protobuf-ES schema describing the entity state. */
  readonly schema: Schema;
  /** Previous committed entity state, absent when creating the entity state. */
  readonly previous: MessageShape<Schema> | undefined;
  /** Proposed next entity state to validate before commit. */
  readonly next: MessageShape<Schema>;
}

/** Structured result returned by {@link validateEntityStateTransition}. */
export type EntityStateTransitionValidationResult = TransitionValidationResult;

/** Validate a proposed entity state transition with built-in server rules. */
export function validateEntityStateTransition<Schema extends DescriptorMessageSchema>(
  request: EntityStateTransitionValidationRequest<Schema>,
): EntityStateTransitionValidationResult {
  const metadata = describeEntityMetadata(request.schema);

  return validateTransition(request, [createSetOnceTransitionRule(metadata.setOnceFields)]);
}

function createSetOnceTransitionRule<Schema extends DescriptorMessageSchema>(
  setOnceFields: readonly DescriptorFieldMetadata[],
): TransitionValidationRule<Schema> {
  return {
    validateTransition(request) {
      if (request.previous === undefined || setOnceFields.length === 0) {
        return [];
      }

      return setOnceFields.flatMap((field) =>
        valuesAreEqual(
          readFieldValue(request.previous as Record<string, unknown>, field),
          readFieldValue(request.next as Record<string, unknown>, field),
        )
          ? []
          : [createSetOnceViolation(request.schema.typeName, field)],
      );
    },
  };
}

function readFieldValue(message: Record<string, unknown>, field: DescriptorFieldMetadata): unknown {
  return message[field.localName];
}

function valuesAreEqual(previousValue: unknown, nextValue: unknown): boolean {
  if (Object.is(previousValue, nextValue)) {
    return true;
  }

  if (previousValue instanceof Uint8Array && nextValue instanceof Uint8Array) {
    return bytesAreEqual(previousValue, nextValue);
  }

  if (Array.isArray(previousValue) && Array.isArray(nextValue)) {
    return arraysAreEqual(previousValue, nextValue);
  }

  if (isRecord(previousValue) && isRecord(nextValue)) {
    return recordsAreEqual(previousValue, nextValue);
  }

  return false;
}

function bytesAreEqual(previousValue: Uint8Array, nextValue: Uint8Array): boolean {
  return (
    previousValue.length === nextValue.length &&
    previousValue.every((byte, index) => byte === nextValue[index])
  );
}

function arraysAreEqual(previousValue: readonly unknown[], nextValue: readonly unknown[]): boolean {
  return (
    previousValue.length === nextValue.length &&
    previousValue.every((value, index) => valuesAreEqual(value, nextValue[index]))
  );
}

function recordsAreEqual(
  previousValue: Record<string, unknown>,
  nextValue: Record<string, unknown>,
): boolean {
  const previousKeys = Object.keys(previousValue).sort();
  const nextKeys = Object.keys(nextValue).sort();

  return (
    arraysAreEqual(previousKeys, nextKeys) &&
    previousKeys.every((key) => valuesAreEqual(previousValue[key], nextValue[key]))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createSetOnceViolation(
  typeName: string,
  field: DescriptorFieldMetadata,
): ConstraintViolation {
  return create(ConstraintViolationSchema, {
    typeName,
    fieldPath: create(FieldPathSchema, { fieldName: [field.name] }),
    message: create(TemplateStringSchema, {
      withPlaceholders: "Set-once fields cannot change after entity state creation.",
    }),
  });
}
