/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * distributed under the License.
 */

import { ScalarType, type DescField } from "@bufbuild/protobuf";

type Classification =
  | { readonly supported: false; readonly reason: string }
  | {
      readonly supported: true;
      readonly valueKind: "bigint" | "boolean" | "bytes" | "enum" | "message" | "number" | "string";
      readonly comparison: "equality" | "ordering";
      readonly messageType?: string;
    };

/**
 * Classifies descriptor fields accepted by Entity columns.
 *
 * @internal
 */
export const EntityFieldClassification: Readonly<{
  readonly classify: (field: DescField) => Classification;
}> = Object.freeze({
  classify(field: DescField): Classification {
    if (field.fieldKind === "list" || field.fieldKind === "map")
      return { supported: false, reason: "singular" };
    if (field.oneof !== undefined) return { supported: false, reason: "oneof" };
    if (field.fieldKind === "enum")
      return { supported: true, valueKind: "enum", comparison: "equality" };
    if (field.fieldKind === "message") {
      const messageType = field.message?.typeName;
      if (messageType === undefined) return { supported: false, reason: "message" };
      return {
        supported: true,
        valueKind: "message",
        messageType,
        comparison:
          messageType === "google.protobuf.Timestamp" || messageType === "spine.core.Version"
            ? "ordering"
            : "equality",
      };
    }
    if (field.scalar === ScalarType.BOOL)
      return { supported: true, valueKind: "boolean", comparison: "equality" };
    if (field.scalar === ScalarType.BYTES)
      return { supported: true, valueKind: "bytes", comparison: "equality" };
    if (
      [
        ScalarType.INT64,
        ScalarType.UINT64,
        ScalarType.FIXED64,
        ScalarType.SFIXED64,
        ScalarType.SINT64,
      ].includes(field.scalar as ScalarType)
    )
      return {
        supported: true,
        valueKind: field.longAsString ? "string" : "bigint",
        comparison: "ordering",
      };
    return {
      supported: true,
      valueKind: field.scalar === ScalarType.STRING ? "string" : "number",
      comparison: "ordering",
    };
  },
});
