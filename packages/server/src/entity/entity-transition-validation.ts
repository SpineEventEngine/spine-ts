import { create, fromBinary, ScalarType, toBinary, type MessageShape } from "@bufbuild/protobuf";
import {
  type TransitionValidationResult,
  type TransitionValidationRule,
  Validate,
} from "@spine-event-engine/core";
import {
  type ConstraintViolation,
  ConstraintViolationSchema,
  FieldPathSchema,
  TemplateStringSchema,
} from "@spine-event-engine/proto";

import {
  describeEntityMetadata,
  type DescriptorFieldMetadata,
  type DescriptorMessageSchema,
} from "./entity-metadata.js";
import { ImplicitRequiredIds } from "./implicit-required-id.js";

/**
 * Request for built-in server entity state transition validation.
 *
 * The built-in rules derive Spine `(set_once)` semantics from descriptor-backed
 * entity metadata. Creation transitions with `previous === undefined` may
 * establish supported set-once values; unsupported repeated, map-valued, and
 * explicit optional set-once declarations fail closed even on creation.
 */
export interface StateTransitionRequest<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
> {
  // prettier-ignore

  /**
   * Generated Protobuf-ES schema describing the entity state.
   */
  readonly schema: Schema;

  /**
   * Previous committed entity state, absent when creating the entity state.
   */
  readonly previous: MessageShape<Schema> | undefined;

  /**
   * Proposed next entity state to validate before commit.
   */
  readonly next: MessageShape<Schema>;
}

/**
 * Structured, sanitized result returned by {@link validateEntityStateTransition}.
 */
export type StateTransitionResult = TransitionValidationResult;

const transitionRulesBySchema = new WeakMap<
  DescriptorMessageSchema,
  readonly TransitionValidationRule<DescriptorMessageSchema>[]
>();

/**
 * Returns the built-in validation result for a proposed entity state transition.
 *
 * The validator first applies ordinary message validation, then enforces an
 * implicit required declaration-first Entity ID when no explicit `(required)`
 * option is present, and finally enforces descriptor-derived `(set_once)`
 * fields. It delegates result shaping to `@spine-event-engine/core` and does
 * not instantiate entities, dispatch handlers, touch repositories, or perform
 * runtime I/O. Repeated, map-valued, and explicit optional `(set_once)` fields
 * are rejected with field-specific violations.
 * Non-entity schemas still fail through `DescriptorMetadataError` from
 * `describeEntityMetadata()`.
 *
 * @param request Schema and previous/next state values to validate.
 * @returns Sanitized validation result with any message or transition violations.
 */
export function validateEntityStateTransition<Schema extends DescriptorMessageSchema>(
  request: StateTransitionRequest<Schema>,
): StateTransitionResult {
  const message = Validate.message(request.schema, request.next);
  if (!message.valid) return message;
  return Validate.transition(request, StateTransitions.rules(request.schema));
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

/**
 * Performs descriptor-backed, fail-closed state transition validation.
 */
const StateTransitions = Object.freeze({
  rules<Schema extends DescriptorMessageSchema>(
    schema: Schema,
  ): readonly TransitionValidationRule<Schema>[] {
    const cachedRules = transitionRulesBySchema.get(schema) as
      readonly TransitionValidationRule<Schema>[] | undefined;

    if (cachedRules !== undefined) {
      return cachedRules;
    }

    const metadata = describeEntityMetadata(schema);
    const rules = Object.freeze([
      ImplicitRequiredIds.entityRule(schema),
      StateTransitions.setOnceRule<Schema>(metadata.setOnceFields),
    ]);

    transitionRulesBySchema.set(schema, rules);

    return rules;
  },

  setOnceRule<Schema extends DescriptorMessageSchema>(
    setOnceFields: readonly DescriptorFieldMetadata[],
  ): TransitionValidationRule<Schema> {
    return {
      validateTransition(request) {
        if (setOnceFields.length === 0) {
          return [];
        }

        return setOnceFields.flatMap((field) => {
          if (StateTransitions.unsupported(field)) {
            return [StateTransitions.violation(request.schema.typeName, field)];
          }

          if (request.previous === undefined) {
            return [];
          }

          const previousValue = StateTransitions.field(request.schema, request.previous, field);
          const nextValue = StateTransitions.field(request.schema, request.next, field);

          return previousValue.safe &&
            nextValue.safe &&
            previousValue.present === nextValue.present &&
            (!previousValue.present || StateTransitions.same(previousValue.value, nextValue.value))
            ? []
            : [StateTransitions.violation(request.schema.typeName, field)];
        });
      },
    };
  },

  field(
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
      const property = StateTransitions.property(message, field);

      return property.safe && property.value === undefined
        ? { safe: true, present: false }
        : { safe: false, present: false };
    }

    if (!StateTransitions.dataDescriptor(descriptor)) {
      return { safe: false, present: false };
    }

    const property = StateTransitions.property(message, field);

    if (
      !property.safe ||
      property.value === undefined ||
      !StateTransitions.safeShape(field, property.value)
    ) {
      return { safe: false, present: false };
    }

    const canonicalValue = StateTransitions.canonical(schema, field, property.value);

    return canonicalValue.safe
      ? { safe: true, present: true, value: canonicalValue.value }
      : { safe: false, present: false };
  },

  property(
    message: Record<string, unknown>,
    field: DescriptorFieldMetadata,
  ): FieldPropertyReadResult {
    try {
      return { safe: true, value: message[field.localName] };
    } catch {
      return { safe: false };
    }
  },

  canonical(
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

      return StateTransitions.dataDescriptor(descriptor)
        ? { safe: true, value: descriptor.value }
        : { safe: false };
    } catch {
      return { safe: false };
    }
  },

  safeShape(field: DescriptorFieldMetadata, value: unknown): boolean {
    try {
      return StateTransitions.uncheckedShape(field, value);
    } catch {
      return false;
    }
  },

  uncheckedShape(field: DescriptorFieldMetadata, value: unknown): boolean {
    const descriptor = field.descriptor;

    switch (descriptor.fieldKind) {
      case "scalar":
        if (descriptor.scalar === ScalarType.BYTES) {
          return value instanceof Uint8Array && StateTransitions.bytes(value) !== undefined;
        }

        return descriptor.scalar !== ScalarType.STRING || typeof value === "string";
      case "enum":
        return Number.isInteger(value);
      case "message":
        return StateTransitions.record(value);
      case "list":
      case "map":
        return false;
    }
  },

  same(previousValue: unknown, nextValue: unknown, depth = 0): boolean {
    try {
      if (StateTransitions.samePrimitive(previousValue, nextValue)) {
        return true;
      }

      if (depth > MAX_EQUALITY_DEPTH) {
        return false;
      }

      if (previousValue instanceof Uint8Array && nextValue instanceof Uint8Array) {
        return StateTransitions.sameBytes(previousValue, nextValue);
      }

      if (Array.isArray(previousValue) && Array.isArray(nextValue)) {
        return StateTransitions.sameArray(previousValue, nextValue, depth);
      }

      if (StateTransitions.record(previousValue) && StateTransitions.record(nextValue)) {
        return StateTransitions.sameRecord(previousValue, nextValue, depth);
      }

      return false;
    } catch {
      return false;
    }
  },

  sameBytes(previousValue: Uint8Array, nextValue: Uint8Array): boolean {
    const previousBytes = StateTransitions.bytes(previousValue);
    const nextBytes = StateTransitions.bytes(nextValue);

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
  },

  sameArray(
    previousValue: readonly unknown[],
    nextValue: readonly unknown[],
    depth: number,
  ): boolean {
    if (previousValue.length !== nextValue.length) {
      return false;
    }

    for (let index = 0; index < previousValue.length; index += 1) {
      if (!StateTransitions.same(previousValue[index], nextValue[index], depth + 1)) {
        return false;
      }
    }

    return true;
  },

  sameRecord(
    previousValue: Record<string, unknown>,
    nextValue: Record<string, unknown>,
    depth: number,
  ): boolean {
    if (Object.getPrototypeOf(previousValue) !== Object.getPrototypeOf(nextValue)) {
      return false;
    }

    const previousKeys = Object.keys(previousValue).sort();
    const nextKeys = Object.keys(nextValue).sort();

    if (!StateTransitions.sameArray(previousKeys, nextKeys, depth)) {
      return false;
    }

    for (const key of previousKeys) {
      const previousDescriptor = Object.getOwnPropertyDescriptor(previousValue, key);
      const nextDescriptor = Object.getOwnPropertyDescriptor(nextValue, key);

      if (
        !StateTransitions.dataDescriptor(previousDescriptor) ||
        !StateTransitions.dataDescriptor(nextDescriptor) ||
        !StateTransitions.same(previousDescriptor.value, nextDescriptor.value, depth + 1)
      ) {
        return false;
      }
    }

    return true;
  },

  record(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    let prototype: unknown;

    try {
      prototype = Object.getPrototypeOf(value);
    } catch {
      return false;
    }

    return prototype === Object.prototype || prototype === null;
  },

  dataDescriptor(
    descriptor: PropertyDescriptor | undefined,
  ): descriptor is PropertyDescriptor & { value: unknown } {
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
  },

  samePrimitive(previousValue: unknown, nextValue: unknown): boolean {
    return (
      Object.is(previousValue, nextValue) &&
      (previousValue === null ||
        (typeof previousValue !== "object" && typeof previousValue !== "function"))
    );
  },

  bytes(value: Uint8Array): Uint8Array | undefined {
    try {
      if (Object.getPrototypeOf(value) !== Uint8Array.prototype) {
        return undefined;
      }

      const copy = Uint8Array.prototype.slice.call(value);

      if (!StateTransitions.denseIndexes(value, copy.length)) {
        return undefined;
      }

      for (let index = 0; index < copy.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        const byte = copy[index];

        if (
          byte === undefined ||
          !StateTransitions.dataDescriptor(descriptor) ||
          descriptor.value !== byte
        ) {
          return undefined;
        }
      }

      return copy;
    } catch {
      return undefined;
    }
  },

  denseIndexes(value: object, length: number): boolean {
    const seenIndexes = new Set<number>();

    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        return false;
      }

      const index = StateTransitions.denseIndex(key, length);

      if (index === undefined) {
        return false;
      }

      seenIndexes.add(index);
    }

    return seenIndexes.size === length;
  },

  denseIndex(key: string, length: number): number | undefined {
    const index = Number(key);

    if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
      return undefined;
    }

    return String(index) === key ? index : undefined;
  },

  violation(typeName: string, field: DescriptorFieldMetadata): ConstraintViolation {
    return create(ConstraintViolationSchema, {
      typeName,
      fieldPath: create(FieldPathSchema, { fieldName: [field.name] }),
      message: create(TemplateStringSchema, {
        withPlaceholders: StateTransitions.violationMessage(field),
      }),
    });
  },

  unsupported(field: DescriptorFieldMetadata): boolean {
    return (
      field.descriptor.fieldKind === "list" ||
      field.descriptor.fieldKind === "map" ||
      field.descriptor.proto.proto3Optional
    );
  },

  violationMessage(field: DescriptorFieldMetadata): string {
    if (field.descriptor.proto.proto3Optional) {
      return "Explicit optional set-once fields are not supported by entity state transition validation.";
    }

    switch (field.descriptor.fieldKind) {
      case "list":
        return "Repeated set-once fields are not supported by entity state transition validation.";
      case "map":
        return "Map-valued set-once fields are not supported by entity state transition validation.";
      case "scalar":
      case "enum":
      case "message":
        return "Set-once fields cannot change after entity state creation.";
    }
  },
});
