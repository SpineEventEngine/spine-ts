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

import { fromJsonString, getOption, ScalarType } from "@bufbuild/protobuf";
import type { DescField, DescMessage, MessageShape } from "@bufbuild/protobuf";
import { Validate, type MessageSchema } from "@spine-event-engine/core";
import { choice, max, min, pattern, range, required } from "@spine-event-engine/proto/agent";
import type { AiValidationIssue } from "./contracts.js";

/**
 * Provider-neutral JSON schema for one supported Protobuf output.
 */
export interface AiOutputSchema {
  /**
   * JSON object discriminator for a message output.
   */
  readonly type: "object";

  /**
   * JSON properties derived from the Protobuf descriptor.
   */
  readonly properties: Readonly<Record<string, unknown>>;

  /**
   * JSON properties that must be supplied for admission.
   */
  readonly required: readonly string[];

  /**
   * Rejects unknown JSON properties.
   */
  readonly additionalProperties: false;

  /**
   * Oneof constraints combined with field constraints.
   */
  readonly allOf?: readonly unknown[];
}

/**
 * Either a locally admitted Protobuf value or precise validation issues.
 *
 * @typeParam S - Output message descriptor.
 */
export type AiCandidateResult<S extends MessageSchema> =
  | {
      /**
       * Indicates exact ProtoJSON and local validation succeeded.
       */
      readonly ok: true;

      /**
       * Validated generated Protobuf output.
       */
      readonly value: MessageShape<S>;
    }
  | {
      /**
       * Indicates candidate admission failed.
       */
      readonly ok: false;

      /**
       * Local defects available for one bounded correction.
       */
      readonly issues: readonly AiValidationIssue[];
    };

/**
 * Fails before provider dispatch for constraints that cannot be represented exactly.
 * @param field Descriptor being lowered.
 * @param path Field-specific diagnostic path.
 */
const checkOptions = (field: DescField, path: string): void => {
  if (getOption(field, range).value) throw new TypeError(`${path}: range is unsupported`);
  if (getOption(field, min).value || getOption(field, max).value) {
    if (field.fieldKind !== "scalar" || (!isNumber32(field.scalar) && !positive64Bound(field)))
      throw new TypeError(`${path}: numeric bound is unsupported`);
  }
  const declaredPattern = getOption(field, pattern);
  if (declaredPattern.regex) {
    if (field.fieldKind !== "scalar" || field.scalar !== ScalarType.STRING)
      throw new TypeError(`${path}: pattern is unsupported`);
    if (
      declaredPattern.modifier ||
      !declaredPattern.regex.startsWith("^") ||
      !declaredPattern.regex.endsWith("$")
    )
      throw new TypeError(`${path}: pattern modifiers or partial matches are unsupported`);
  }
};

/**
 * @param field Numeric descriptor. @returns Whether one exact positive bound is representable.
 */
const positive64Bound = (field: DescField): boolean => {
  return (
    field.fieldKind === "scalar" &&
    isLong64(field.scalar) &&
    getOption(field, min).value === "1" &&
    !getOption(field, min).exclusive &&
    !getOption(field, max).value
  );
};

/**
 * @param scalar Protobuf scalar kind. @returns Whether ProtoJSON requires a decimal string.
 */
const isLong64 = (scalar: ScalarType): boolean => {
  return [
    ScalarType.INT64,
    ScalarType.UINT64,
    ScalarType.SINT64,
    ScalarType.FIXED64,
    ScalarType.SFIXED64,
  ].includes(scalar);
};

/**
 * @param field Descriptor. @returns Whether JSON must supply the field.
 */
const requiredField = (field: DescField): boolean => {
  return (
    getOption(field, required) ||
    positive64Bound(field) ||
    (field.fieldKind === "scalar" &&
      isNumber32(field.scalar) &&
      getOption(field, min).value === "1" &&
      !getOption(field, min).exclusive)
  );
};

/**
 * @param scalar Protobuf scalar kind. @returns Whether JSON represents it as a number.
 */
const isNumber32 = (scalar: ScalarType): boolean => {
  return scalar === ScalarType.DOUBLE || scalar === ScalarType.FLOAT || isInteger32(scalar);
};

/**
 * Checks whether a scalar uses an integral 32-bit ProtoJSON number.
 *
 * @param scalar Protobuf scalar kind.
 * @returns Whether the native schema must require an integer.
 */
const isInteger32 = (scalar: ScalarType): boolean => {
  return [
    ScalarType.INT32,
    ScalarType.UINT32,
    ScalarType.SINT32,
    ScalarType.FIXED32,
    ScalarType.SFIXED32,
  ].includes(scalar);
};

/**
 * @param scalar Protobuf scalar kind. @returns Strict JSON scalar schema.
 */
const scalarSchema = (scalar: ScalarType): Record<string, unknown> => {
  if (scalar === ScalarType.STRING) return { type: "string" };
  if (scalar === ScalarType.BYTES) return { type: "string", contentEncoding: "base64" };
  if (scalar === ScalarType.BOOL) return { type: "boolean" };
  if (isInteger32(scalar)) return { type: "integer" };
  if (isNumber32(scalar)) return { type: "number" };
  if (isLong64(scalar))
    return {
      type: "string",
      pattern: [ScalarType.UINT64, ScalarType.FIXED64].includes(scalar)
        ? "^(0|[1-9][0-9]*)$"
        : "^-?(0|[1-9][0-9]*)$",
    };
  throw new TypeError(`Unsupported scalar kind ${String(scalar)}`);
};

/**
 * @param field Descriptor being lowered. @param path Diagnostic path. @returns JSON schema.
 */
const fieldSchema = (
  field: DescField,
  path: string,
  active: ReadonlySet<string>,
): Record<string, unknown> => {
  checkOptions(field, path);
  if (field.fieldKind === "list") {
    if (field.listKind === "message")
      return { type: "array", items: messageSchema(field.message, path, active) };
    if (field.listKind === "enum")
      return { type: "array", items: { enum: field.enum.values.map((value) => value.name) } };
    return { type: "array", items: scalarSchema(field.scalar) };
  }
  if (field.fieldKind === "map") throw new TypeError(`${path}: maps are unsupported`);
  if (field.fieldKind === "message") return messageSchema(field.message, path, active);
  if (field.fieldKind === "enum")
    return { type: "string", enum: field.enum.values.map((value) => value.name) };
  const schema = scalarSchema(field.scalar);
  const lower = getOption(field, min);
  const upper = getOption(field, max);
  if (lower.value && isNumber32(field.scalar))
    schema[lower.exclusive ? "exclusiveMinimum" : "minimum"] = Number(lower.value);
  if (positive64Bound(field)) schema.pattern = "^[1-9][0-9]*$";
  if (upper.value) schema[upper.exclusive ? "exclusiveMaximum" : "maximum"] = Number(upper.value);
  const regex = getOption(field, pattern).regex;
  if (regex) schema.pattern = regex;
  return schema;
};

/**
 * @param message Nested message. @param path Diagnostic path. @returns JSON schema.
 */
const messageSchema = (
  message: DescMessage,
  path: string,
  active: ReadonlySet<string> = new Set<string>(),
): Record<string, unknown> => {
  if (active.has(message.typeName)) throw new TypeError(`${path}: recursive message unsupported`);
  const nested = new Set(active).add(message.typeName);
  if (
    message.typeName === "google.protobuf.Any" ||
    message.typeName === "google.protobuf.Timestamp" ||
    message.typeName === "google.protobuf.Duration"
  )
    throw new TypeError(`${path}: ${message.typeName} ProtoJSON is unsupported`);
  if (message.typeName === "google.protobuf.Empty")
    return { type: "object", properties: {}, required: [], additionalProperties: false };
  if (message.typeName.endsWith("Value") && message.typeName.startsWith("google.protobuf.")) {
    const value = message.fields[0];
    if (value?.fieldKind !== "scalar") throw new TypeError(`${path}: wrapper unsupported`);
    return scalarSchema(value.scalar);
  }
  const properties = Object.fromEntries(
    message.fields.map((field) => [
      field.jsonName,
      fieldSchema(field, `${path}.${field.name}`, nested),
    ]),
  );
  const allOf = oneofSchemas(message);
  return {
    type: "object",
    properties,
    required: message.fields.filter(requiredField).map((field) => field.jsonName),
    additionalProperties: false,
    ...(allOf.length ? { allOf } : {}),
  };
};

/**
 * Represents declared Protobuf oneofs as exact JSON alternatives.
 *
 * @param message Message descriptor with optional choice constraints.
 * @returns Schema clauses for each oneof.
 */
const oneofSchemas = (message: DescMessage): readonly Record<string, unknown>[] => {
  return message.oneofs.map((oneof) => ({
    oneOf: [
      ...(!getOption(oneof, choice).required
        ? [{ not: { anyOf: oneof.fields.map((field) => ({ required: [field.jsonName] })) } }]
        : []),
      ...oneof.fields.map((field) => ({ required: [field.jsonName] })),
    ],
  }));
};

/**
 * Creates provider-neutral schema directly from a generated descriptor.
 * @param schema Generated Protobuf output schema.
 * @returns Strict schema or a field-specific unsupported-feature error.
 */
export const deriveOutputSchema = (schema: MessageSchema): AiOutputSchema => {
  const candidate: unknown = schema;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    (candidate as { kind?: unknown }).kind !== "message"
  )
    throw new TypeError("output must be a message descriptor");
  if (schema.typeName.startsWith("google.protobuf.") && schema.typeName.endsWith("Value"))
    throw new TypeError(`${schema.typeName}: scalar root wrapper output is unsupported`);
  return messageSchema(schema, schema.typeName) as unknown as AiOutputSchema;
};

/**
 * @param code Machine-readable issue code. @param path JSON field path. @param message Safe diagnostic. @returns Issue.
 */
const issue = (code: string, path: string, message: string): AiValidationIssue => {
  return { code, path, message };
};

/**
 * @param field Descriptor. @param value Raw JSON value. @param path Field path. @returns Shape issues.
 */
const checkField = (field: DescField, value: unknown, path: string): AiValidationIssue[] => {
  if (field.fieldKind === "message") return checkMessageValue(field.message, value, path);
  if (field.fieldKind === "list" && Array.isArray(value))
    return value.flatMap((item, index) => {
      const itemPath = `${path}[${String(index)}]`;
      if (field.listKind === "message") return checkMessageValue(field.message, item, itemPath);
      if (field.listKind === "scalar") return checkLongValue(field.scalar, item, itemPath);
      return [];
    });
  if (field.fieldKind === "scalar") return checkLongValue(field.scalar, value, path);
  return [];
};

/**
 * Checks a scalar before Buf can round an unsafe 64-bit JSON number.
 *
 * @param scalar Protobuf scalar kind.
 * @param value Raw JSON value.
 * @param path Candidate field path.
 * @returns Exact-integer issues.
 */
const checkLongValue = (scalar: ScalarType, value: unknown, path: string): AiValidationIssue[] => {
  return isLong64(scalar) && typeof value !== "string"
    ? [issue("INVALID_INTEGER", path, "64-bit integer must be a decimal string")]
    : [];
};

/**
 * Checks a nested message or scalar-shaped well-known wrapper.
 *
 * @param message Nested message descriptor.
 * @param value Raw ProtoJSON value.
 * @param path Candidate field path.
 * @returns Shape or exact-integer issues.
 */
const checkMessageValue = (
  message: DescMessage,
  value: unknown,
  path: string,
): AiValidationIssue[] => {
  if (message.typeName.startsWith("google.protobuf.") && message.typeName.endsWith("Value")) {
    const scalar = message.fields[0];
    return scalar?.fieldKind === "scalar" ? checkLongValue(scalar.scalar, value, path) : [];
  }
  return checkShape(message, value, path);
};

/**
 * @param message Descriptor. @param value Raw JSON object. @param path Object path. @returns Shape issues.
 */
const checkShape = (message: DescMessage, value: unknown, path: string): AiValidationIssue[] => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return [issue("INVALID_OBJECT", path, "Expected a JSON object")];
  const candidate = value as Record<string, unknown>;
  const names = new Set(message.fields.map((field) => field.jsonName));
  const issues = Object.keys(candidate)
    .filter((key) => !names.has(key))
    .map((key) => issue("UNKNOWN_FIELD", `${path}.${key}`, "Unknown field"));
  for (const field of message.fields) {
    const entry = candidate[field.jsonName];
    if (entry === undefined || entry === null) {
      if (requiredField(field))
        issues.push(issue("REQUIRED", `${path}.${field.jsonName}`, "Required field missing"));
    } else issues.push(...checkField(field, entry, `${path}.${field.jsonName}`));
  }
  for (const oneof of message.oneofs) {
    const count = oneof.fields.filter((field) => candidate[field.jsonName] !== undefined).length;
    if (count > 1 || (count === 0 && getOption(oneof, choice).required))
      issues.push(issue("ONEOF", `${path}.${oneof.name}`, "Exactly one member required"));
  }
  return issues;
};

/**
 * Parses exact ProtoJSON, then applies Spine constraints and application validation.
 *
 * @typeParam S - Output message descriptor.
 * @param schema Generated output descriptor.
 * @param text Exact provider candidate text.
 * @param check Optional pure application validator.
 * @returns Admitted value or bounded local issues for a correction.
 */
export const parseCandidate = <S extends MessageSchema>(
  schema: S,
  text: string,
  check?: (value: MessageShape<S>) => readonly AiValidationIssue[],
): AiCandidateResult<S> => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, issues: [issue("MALFORMED_JSON", "$", "Invalid JSON")] };
  }
  const shapeIssues = checkShape(schema, raw, "$");
  if (shapeIssues.length) return { ok: false, issues: shapeIssues };
  let value: MessageShape<S>;
  try {
    value = fromJsonString(schema, text, { ignoreUnknownFields: false });
  } catch {
    return { ok: false, issues: [issue("INVALID_PROTOJSON", "$", "Invalid Protobuf JSON value")] };
  }
  const result = Validate.message(schema, value);
  if (!result.valid)
    return {
      ok: false,
      issues: result.violations.map((entry) =>
        issue(
          "PROTO_CONSTRAINT",
          entry.fieldPath?.fieldName.join(".") ?? "$",
          entry.message?.withPlaceholders ?? "Invalid field",
        ),
      ),
    };
  const appIssues = check?.(value) ?? [];
  return appIssues.length ? { ok: false, issues: appIssues } : { ok: true, value };
};
