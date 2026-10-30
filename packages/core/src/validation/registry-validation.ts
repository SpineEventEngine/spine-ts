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

import {
  create,
  createRegistry,
  equals,
  fromBinary,
  getOption,
  ScalarType,
} from "@bufbuild/protobuf";
import type { DescField, DescMessage, Message, Registry } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import { validate as validateWithSpine } from "@spine-event-engine/validation";
import {
  ConstraintViolationSchema,
  FieldPathSchema,
  TemplateStringSchema,
} from "@spine-event-engine/proto";
import { required, validate } from "@spine-event-engine/proto/generated/spine/options_pb.js";
import type { ConstraintViolation } from "@spine-event-engine/proto";
import type { MessageSchema, TypeRegistryLookup } from "../index.js";

type CollectionField = Extract<DescField, { fieldKind: "list" | "map" }>;

/**
 * Supplements the pinned validator at annotated application `Any` and required collection edges.
 */
export const RegistryValidation = {
  /**
   * Finds violations the pinned validator cannot see through its descriptor dependency registry.
   * @param schema The root message schema.
   * @param message The message to inspect.
   * @param registry Application types available at packed fields.
   * @returns Supplemental constraint violations.
   */
  collect(
    schema: MessageSchema,
    message: Message,
    registry?: TypeRegistryLookup,
  ): ConstraintViolation[] {
    const covered = RegistryValidation.dependencies(schema);
    const violations: ConstraintViolation[] = [];
    RegistryValidation.scan(schema, message, schema.typeName, [], covered, registry, violations);
    return violations;
  },

  /**
   * Builds the descriptor closure used by the pinned validator for one root.
   * @param schema Descriptor whose file starts the closure.
   * @returns Descriptors visible to upstream validation.
   */
  dependencies(schema: DescMessage): Registry {
    const files = new Map<string, DescMessage["file"]>();
    const pending = [schema.file];
    while (pending.length > 0) {
      const file = pending.pop();
      if (file === undefined || files.has(file.name)) continue;
      files.set(file.name, file);
      pending.push(...file.dependencies);
    }
    return createRegistry(...files.values());
  },

  /**
   * Checks required collections and declared recursive validation edges.
   * @param schema Current message descriptor.
   * @param message Current message.
   * @param root Root type name for violations.
   * @param path Path to the current message.
   * @param covered Descriptors already validated upstream.
   * @param registry Application type lookup.
   * @param violations Accumulated violations.
   */
  scan(
    schema: DescMessage,
    message: Message,
    root: string,
    path: string[],
    covered: Registry,
    registry: TypeRegistryLookup | undefined,
    violations: ConstraintViolation[],
  ): void {
    for (const field of schema.fields) {
      const value = RegistryValidation.value(message, field);
      if (getOption(field, required))
        RegistryValidation.requiredMembers(field, value, root, path, violations);
      if (!getOption(field, validate)) continue;
      const nested = RegistryValidation.messageSchema(field);
      if (nested === undefined) continue;
      RegistryValidation.scanValues(
        field,
        nested,
        value,
        root,
        path,
        covered,
        registry,
        violations,
      );
    }
  },

  /**
   * Processes each selected singular, repeated, or map message value.
   * @param field Declared recursive field.
   * @param nested Descriptor of its message values.
   * @param value Field value.
   * @param root Root type name.
   * @param path Path to the parent message.
   * @param covered Descriptors already validated upstream.
   * @param registry Application type lookup.
   * @param violations Accumulated violations.
   */
  scanValues(
    field: DescField,
    nested: DescMessage,
    value: unknown,
    root: string,
    path: string[],
    covered: Registry,
    registry: TypeRegistryLookup | undefined,
    violations: ConstraintViolation[],
  ): void {
    for (const [key, entry] of RegistryValidation.entries(field, value)) {
      if (entry === null || entry === undefined) continue;
      const nextPath =
        field.fieldKind === "list" || field.fieldKind === "map"
          ? [...path, field.name, key]
          : [...path, field.name];
      if (nested.typeName === AnySchema.typeName) {
        RegistryValidation.any(entry as Any, root, nextPath, covered, registry, violations);
      } else if (typeof entry === "object") {
        RegistryValidation.scan(
          nested,
          entry as Message,
          root,
          nextPath,
          covered,
          registry,
          violations,
        );
      }
    }
  },

  /**
   * Resolves known packed messages while preserving unknown-type allowance.
   * @param packed Packed message.
   * @param root Root type name.
   * @param path Path to the packed field.
   * @param covered Descriptors already validated upstream.
   * @param registry Application type lookup.
   * @param violations Accumulated violations.
   */
  any(
    packed: Any,
    root: string,
    path: string[],
    covered: Registry,
    registry: TypeRegistryLookup | undefined,
    violations: ConstraintViolation[],
  ): void {
    const name = packed.typeUrl.split("/").at(-1);
    const local = name ? covered.getMessage(name) : undefined;
    const schema = registry?.findByTypeUrl(packed.typeUrl)?.schema ?? local;
    if (schema === undefined) return;
    const message = RegistryValidation.decode(schema, packed, root, path, violations);
    if (message === undefined) return;
    if (local === undefined) {
      for (const item of validateWithSpine(schema, message)) {
        violations.push(RegistryValidation.prefixed(item, root, path));
      }
    }
    const nestedCovered = local === undefined ? RegistryValidation.dependencies(schema) : covered;
    RegistryValidation.scan(schema, message, root, path, nestedCovered, registry, violations);
  },

  /**
   * Converts malformed known bytes into a field violation without exposing the bytes.
   * @param schema Known payload descriptor.
   * @param packed Packed message.
   * @param root Root type name.
   * @param path Path to the packed field.
   * @param violations Accumulated violations.
   * @returns Decoded message, if valid.
   */
  decode(
    schema: DescMessage,
    packed: Any,
    root: string,
    path: string[],
    violations: ConstraintViolation[],
  ): Message | undefined {
    try {
      return fromBinary(schema, packed.value);
    } catch {
      violations.push(
        create(ConstraintViolationSchema, {
          typeName: root,
          fieldPath: create(FieldPathSchema, { fieldName: path }),
          message: create(TemplateStringSchema, {
            withPlaceholders: "Known Any payload is malformed.",
          }),
        }),
      );
      return undefined;
    }
  },

  /**
   * Adds a root-relative copy of an application payload violation.
   * @param violation Upstream payload violation.
   * @param root Root type name.
   * @param path Path to the packed field.
   * @returns Violation with the root type and full path.
   */
  prefixed(
    violation: ReturnType<typeof validateWithSpine>[number],
    root: string,
    path: string[],
  ): ConstraintViolation {
    return create(ConstraintViolationSchema, {
      typeName: root,
      fieldPath: create(FieldPathSchema, {
        fieldName: [...path, ...(violation.fieldPath?.fieldName ?? [])],
      }),
      message:
        violation.message === undefined
          ? undefined
          : create(TemplateStringSchema, {
              withPlaceholders: violation.message.withPlaceholders,
              placeholderValue: violation.message.placeholderValue,
            }),
    });
  },

  /**
   * Checks each required list item or map value with the declared presence semantics.
   * @param field Required collection field.
   * @param value Collection value.
   * @param root Root type name.
   * @param path Path to the parent message.
   * @param violations Accumulated violations.
   */
  requiredMembers(
    field: DescField,
    value: unknown,
    root: string,
    path: string[],
    violations: ConstraintViolation[],
  ): void {
    if (field.fieldKind !== "list" && field.fieldKind !== "map") return;
    for (const [key, member] of RegistryValidation.entries(field, value)) {
      if (RegistryValidation.present(field, member)) continue;
      violations.push(
        create(ConstraintViolationSchema, {
          typeName: root,
          fieldPath: create(FieldPathSchema, { fieldName: [...path, field.name, key] }),
          message: create(TemplateStringSchema, {
            withPlaceholders: "A required collection member must have a value.",
          }),
        }),
      );
    }
  },

  /**
   * Determines whether a collection member satisfies declared required semantics.
   * @param field Collection descriptor.
   * @param member Member value.
   * @returns Whether the member is present.
   */
  present(field: CollectionField, member: unknown): boolean {
    if (member === null || member === undefined) return false;
    const kind = field.fieldKind === "list" ? field.listKind : field.mapKind;
    if (kind === "scalar") {
      const scalar = field.scalar;
      if (scalar === ScalarType.STRING) return typeof member === "string" && member.length > 0;
      if (scalar === ScalarType.BYTES) return member instanceof Uint8Array && member.length > 0;
      return true;
    }
    if (kind === "enum") return typeof member === "number" && member !== 0;
    const schema = RegistryValidation.messageSchema(field);
    if (schema && typeof member === "object") {
      return !equals(schema, member as Message, create(schema));
    }
    return false;
  },

  /**
   * Lists field values, including missing list or map members for required checks.
   * @param field Field descriptor.
   * @param value Field value.
   * @returns Entries with stable location segments.
   */
  entries(field: DescField, value: unknown): [string, unknown][] {
    if (field.fieldKind === "list")
      return Array.isArray(value)
        ? Array.from(value, (entry: unknown, index): [string, unknown] => [String(index), entry])
        : [];
    if (field.fieldKind === "map")
      return value && typeof value === "object" ? Object.entries(value) : [];
    return value === undefined || value === null ? [] : [["", value]];
  },

  /**
   * Returns the message schema on a declared recursive edge.
   * @param field Field descriptor.
   * @returns Message descriptor, if present.
   */
  messageSchema(field: DescField): DescMessage | undefined {
    if (field.fieldKind === "message") return field.message;
    if (field.fieldKind === "list" && field.listKind === "message") return field.message;
    if (field.fieldKind === "map" && field.mapKind === "message") return field.message;
    return undefined;
  },

  /**
   * Reads the selected generated field, including a oneof member.
   * @param message Generated message.
   * @param field Field descriptor.
   * @returns Selected value.
   */
  value(message: Message, field: DescField): unknown {
    if (field.oneof === undefined) return (message as Record<string, unknown>)[field.localName];
    const choice = (message as Record<string, unknown>)[field.oneof.localName];
    if (!choice || typeof choice !== "object") return undefined;
    const selected = choice as { case?: string; value?: unknown };
    return selected.case === field.localName ? selected.value : undefined;
  },
};
