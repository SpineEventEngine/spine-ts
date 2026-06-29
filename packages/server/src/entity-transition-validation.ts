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

/**
 * Request for built-in server entity state transition validation.
 *
 * The built-in rules derive Spine `(set_once)` semantics from descriptor-backed
 * entity metadata. Creation transitions with `previous === undefined` are
 * accepted because the initial state is allowed to establish set-once values.
 */
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

/** Structured, sanitized result returned by {@link validateEntityStateTransition}. */
export type EntityStateTransitionValidationResult = TransitionValidationResult;

/**
 * Validate a proposed entity state transition with built-in, side-effect-free
 * server rules.
 *
 * The validator currently enforces descriptor-derived `(set_once)` fields,
 * delegates result shaping to `@spine-ts/core` `validateTransition()`, and does
 * not instantiate entities, dispatch handlers, touch repositories, or perform
 * runtime I/O. Non-entity schemas still fail through
 * {@link DescriptorMetadataError} from `describeEntityMetadata()`.
 */
export function validateEntityStateTransition<Schema extends DescriptorMessageSchema>(
  request: EntityStateTransitionValidationRequest<Schema>,
): EntityStateTransitionValidationResult {
  const metadata = describeEntityMetadata(request.schema);

  return validateTransition(request, [createSetOnceTransitionRule(metadata.setOnceFields)]);
}

const MAX_EQUALITY_DEPTH = 64;

interface FieldReadResult {
  readonly safe: boolean;
  readonly present: boolean;
  readonly value?: unknown;
}

function createSetOnceTransitionRule<Schema extends DescriptorMessageSchema>(
  setOnceFields: readonly DescriptorFieldMetadata[],
): TransitionValidationRule<Schema> {
  return {
    validateTransition(request) {
      if (request.previous === undefined || setOnceFields.length === 0) {
        return [];
      }

      return setOnceFields.flatMap((field) => {
        const previousValue = readFieldValue(request.previous as Record<string, unknown>, field);
        const nextValue = readFieldValue(request.next, field);

        return previousValue.safe &&
          nextValue.safe &&
          previousValue.present === nextValue.present &&
          (!previousValue.present || valuesAreEqual(previousValue.value, nextValue.value))
          ? []
          : [createSetOnceViolation(request.schema.typeName, field)];
      });
    },
  };
}

function readFieldValue(
  message: Record<string, unknown>,
  field: DescriptorFieldMetadata,
): FieldReadResult {
  const descriptor = Object.getOwnPropertyDescriptor(message, field.localName);

  if (descriptor === undefined) {
    return { safe: !(field.localName in message), present: false };
  }

  if (!isSafeDataDescriptor(descriptor)) {
    return { safe: false, present: false };
  }

  return { safe: true, present: true, value: descriptor.value };
}

function valuesAreEqual(
  previousValue: unknown,
  nextValue: unknown,
  depth = 0,
  activePairs: WeakMap<object, WeakSet<object>> = new WeakMap<object, WeakSet<object>>(),
): boolean {
  if (Object.is(previousValue, nextValue)) {
    return true;
  }

  if (depth > MAX_EQUALITY_DEPTH) {
    return false;
  }

  if (previousValue instanceof Uint8Array && nextValue instanceof Uint8Array) {
    return bytesAreEqual(previousValue, nextValue);
  }

  if (Array.isArray(previousValue) && Array.isArray(nextValue)) {
    return arraysAreEqual(previousValue, nextValue, depth, activePairs);
  }

  if (isRecord(previousValue) && isRecord(nextValue)) {
    return recordsAreEqual(previousValue, nextValue, depth, activePairs);
  }

  return false;
}

function bytesAreEqual(previousValue: Uint8Array, nextValue: Uint8Array): boolean {
  return (
    previousValue.length === nextValue.length &&
    previousValue.every((byte, index) => byte === nextValue[index])
  );
}

function arraysAreEqual(
  previousValue: readonly unknown[],
  nextValue: readonly unknown[],
  depth: number,
  activePairs: WeakMap<object, WeakSet<object>>,
): boolean {
  return (
    previousValue.length === nextValue.length &&
    previousValue.every((value, index) =>
      valuesAreEqual(value, nextValue[index], depth + 1, activePairs),
    )
  );
}

function recordsAreEqual(
  previousValue: Record<string, unknown>,
  nextValue: Record<string, unknown>,
  depth: number,
  activePairs: WeakMap<object, WeakSet<object>>,
): boolean {
  if (Object.getPrototypeOf(previousValue) !== Object.getPrototypeOf(nextValue)) {
    return false;
  }

  if (hasActivePair(previousValue, nextValue, activePairs)) {
    return false;
  }

  markActivePair(previousValue, nextValue, activePairs);

  const previousKeys = Object.keys(previousValue).sort();
  const nextKeys = Object.keys(nextValue).sort();

  const equal =
    arraysAreEqual(previousKeys, nextKeys, depth, activePairs) &&
    previousKeys.every((key) => {
      const previousDescriptor = Object.getOwnPropertyDescriptor(previousValue, key);
      const nextDescriptor = Object.getOwnPropertyDescriptor(nextValue, key);

      return (
        isSafeDataDescriptor(previousDescriptor) &&
        isSafeDataDescriptor(nextDescriptor) &&
        valuesAreEqual(previousDescriptor.value, nextDescriptor.value, depth + 1, activePairs)
      );
    });

  unmarkActivePair(previousValue, nextValue, activePairs);

  return equal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

function isSafeDataDescriptor(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { value: unknown } {
  return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
}

function hasActivePair(
  previousValue: Record<string, unknown>,
  nextValue: Record<string, unknown>,
  activePairs: WeakMap<object, WeakSet<object>>,
): boolean {
  return activePairs.get(previousValue)?.has(nextValue) ?? false;
}

function markActivePair(
  previousValue: Record<string, unknown>,
  nextValue: Record<string, unknown>,
  activePairs: WeakMap<object, WeakSet<object>>,
): void {
  const nextValues = activePairs.get(previousValue);

  if (nextValues === undefined) {
    activePairs.set(previousValue, new WeakSet([nextValue]));
    return;
  }

  nextValues.add(nextValue);
}

function unmarkActivePair(
  previousValue: Record<string, unknown>,
  nextValue: Record<string, unknown>,
  activePairs: WeakMap<object, WeakSet<object>>,
): void {
  activePairs.get(previousValue)?.delete(nextValue);
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
