import { create, fromBinary, ScalarType, toBinary, type MessageShape } from "@bufbuild/protobuf";
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
 * runtime I/O. Map-valued `(set_once)` fields are unsupported in this slice and
 * fail closed with a field-specific violation. Non-entity schemas still fail through
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

interface FieldPropertyReadResult {
  readonly safe: boolean;
  readonly value?: unknown;
}

interface SafeArrayLengthDescriptor {
  readonly enumerable: false;
  readonly value: number;
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
        const previousValue = readFieldValue(
          request.schema,
          request.previous as Record<string, unknown>,
          field,
        );
        const nextValue = readFieldValue(request.schema, request.next, field);

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
  schema: DescriptorMessageSchema,
  message: Record<string, unknown>,
  field: DescriptorFieldMetadata,
): FieldReadResult {
  let descriptor: PropertyDescriptor | undefined;

  try {
    descriptor = Object.getOwnPropertyDescriptor(message, field.localName);
  } catch {
    return { safe: false, present: false };
  }

  if (descriptor === undefined) {
    const property = readFieldProperty(message, field);

    return property.safe && property.value === undefined
      ? { safe: true, present: false }
      : { safe: false, present: false };
  }

  if (!isSafeDataDescriptor(descriptor)) {
    return { safe: false, present: false };
  }

  const property = readFieldProperty(message, field);

  if (
    !property.safe ||
    property.value === undefined ||
    !fieldValueShapeIsSafe(field, property.value)
  ) {
    return { safe: false, present: false };
  }

  const canonicalValue = canonicalizeFieldValue(schema, field, property.value);

  return canonicalValue.safe
    ? { safe: true, present: true, value: canonicalValue.value }
    : { safe: false, present: false };
}

function readFieldProperty(
  message: Record<string, unknown>,
  field: DescriptorFieldMetadata,
): FieldPropertyReadResult {
  try {
    return { safe: true, value: message[field.localName] };
  } catch {
    return { safe: false };
  }
}

function canonicalizeFieldValue(
  schema: DescriptorMessageSchema,
  field: DescriptorFieldMetadata,
  value: unknown,
): FieldPropertyReadResult {
  try {
    const initialized = create(schema, {
      [field.localName]: value,
    });
    const canonical = fromBinary(
      schema,
      toBinary(schema, initialized, { writeUnknownFields: false }),
    ) as Record<string, unknown>;
    const descriptor = Object.getOwnPropertyDescriptor(canonical, field.localName);

    return isSafeDataDescriptor(descriptor)
      ? { safe: true, value: descriptor.value }
      : { safe: false };
  } catch {
    return { safe: false };
  }
}

function fieldValueShapeIsSafe(field: DescriptorFieldMetadata, value: unknown): boolean {
  const descriptor = field.descriptor;

  switch (descriptor.fieldKind) {
    case "scalar":
      if (descriptor.scalar === ScalarType.BYTES) {
        return value instanceof Uint8Array && readSafeUint8ArrayBytes(value) !== undefined;
      }

      return descriptor.scalar !== ScalarType.STRING || typeof value === "string";
    case "enum":
      return Number.isInteger(value);
    case "message":
      return isRecord(value);
    case "list":
      return Array.isArray(value) && readSafeArrayElements(value) !== undefined;
    case "map":
      return false;
  }
}

function valuesAreEqual(
  previousValue: unknown,
  nextValue: unknown,
  depth = 0,
  activePairs: WeakMap<object, WeakSet<object>> = new WeakMap<object, WeakSet<object>>(),
): boolean {
  if (primitiveValuesAreIdentical(previousValue, nextValue)) {
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
  const previousBytes = readSafeUint8ArrayBytes(previousValue);
  const nextBytes = readSafeUint8ArrayBytes(nextValue);

  if (previousBytes === undefined || nextBytes === undefined) {
    return false;
  }

  if (previousBytes.length !== nextBytes.length) {
    return false;
  }

  for (let index = 0; index < previousBytes.length; index += 1) {
    if (previousBytes[index] !== nextBytes[index]) {
      return false;
    }
  }

  return true;
}

function arraysAreEqual(
  previousValue: readonly unknown[],
  nextValue: readonly unknown[],
  depth: number,
  activePairs: WeakMap<object, WeakSet<object>>,
): boolean {
  const previousElements = readSafeArrayElements(previousValue);
  const nextElements = readSafeArrayElements(nextValue);

  if (previousElements === undefined || nextElements === undefined) {
    return false;
  }

  if (previousElements.length !== nextElements.length) {
    return false;
  }

  for (let index = 0; index < previousElements.length; index += 1) {
    if (!valuesAreEqual(previousElements[index], nextElements[index], depth + 1, activePairs)) {
      return false;
    }
  }

  return true;
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

  try {
    if (!arraysAreEqual(previousKeys, nextKeys, depth, activePairs)) {
      return false;
    }

    for (const key of previousKeys) {
      const previousDescriptor = Object.getOwnPropertyDescriptor(previousValue, key);
      const nextDescriptor = Object.getOwnPropertyDescriptor(nextValue, key);

      if (
        !isSafeDataDescriptor(previousDescriptor) ||
        !isSafeDataDescriptor(nextDescriptor) ||
        !valuesAreEqual(previousDescriptor.value, nextDescriptor.value, depth + 1, activePairs)
      ) {
        return false;
      }
    }

    return true;
  } finally {
    unmarkActivePair(previousValue, nextValue, activePairs);
  }
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

function primitiveValuesAreIdentical(previousValue: unknown, nextValue: unknown): boolean {
  return (
    Object.is(previousValue, nextValue) &&
    (previousValue === null ||
      (typeof previousValue !== "object" && typeof previousValue !== "function"))
  );
}

function readSafeUint8ArrayBytes(value: Uint8Array): Uint8Array | undefined {
  if (Object.getPrototypeOf(value) !== Uint8Array.prototype) {
    return undefined;
  }

  let copy: Uint8Array;

  try {
    copy = Uint8Array.prototype.slice.call(value);
  } catch {
    return undefined;
  }

  if (!hasOnlyDenseIndexedDataProperties(value, copy.length, false)) {
    return undefined;
  }

  for (let index = 0; index < copy.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    const byte = copy[index];

    if (byte === undefined || !isSafeDataDescriptor(descriptor) || descriptor.value !== byte) {
      return undefined;
    }
  }

  return copy;
}

function readSafeArrayElements(value: readonly unknown[]): readonly unknown[] | undefined {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    return undefined;
  }

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");

  if (!isSafeArrayLengthDescriptor(lengthDescriptor)) {
    return undefined;
  }

  const length = lengthDescriptor.value;

  if (!hasOnlyDenseIndexedDataProperties(value, length, true)) {
    return undefined;
  }

  const elements: unknown[] = [];

  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));

    if (!isSafeDataDescriptor(descriptor) || descriptor.value !== value[index]) {
      return undefined;
    }

    elements.push(descriptor.value);
  }

  return elements;
}

function hasOnlyDenseIndexedDataProperties(
  value: object,
  length: number,
  includesLengthProperty: boolean,
): boolean {
  const seenIndexes = new Set<number>();

  for (const key of Reflect.ownKeys(value)) {
    if (key === "length" && includesLengthProperty) {
      continue;
    }

    if (typeof key !== "string") {
      return false;
    }

    const index = parseDenseIndexKey(key, length);

    if (index === undefined) {
      return false;
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);

    if (!isSafeDataDescriptor(descriptor)) {
      return false;
    }

    seenIndexes.add(index);
  }

  return seenIndexes.size === length;
}

function parseDenseIndexKey(key: string, length: number): number | undefined {
  const index = Number(key);

  if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
    return undefined;
  }

  return String(index) === key ? index : undefined;
}

function isSafeArrayLengthDescriptor(
  descriptor: PropertyDescriptor | undefined,
): descriptor is SafeArrayLengthDescriptor {
  return (
    descriptor?.enumerable === false &&
    Object.hasOwn(descriptor, "value") &&
    Number.isSafeInteger(descriptor.value) &&
    descriptor.value >= 0
  );
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
  const message =
    field.descriptor.fieldKind === "map"
      ? "Map-valued set-once fields are not supported by entity state transition validation."
      : "Set-once fields cannot change after entity state creation.";

  return create(ConstraintViolationSchema, {
    typeName,
    fieldPath: create(FieldPathSchema, { fieldName: [field.name] }),
    message: create(TemplateStringSchema, {
      withPlaceholders: message,
    }),
  });
}
