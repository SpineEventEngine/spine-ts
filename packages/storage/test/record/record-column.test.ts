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
import { create, ScalarType } from "@bufbuild/protobuf";
import { FieldMaskSchema, StructSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { EventIdSchema, VersionSchema } from "@spine-event-engine/proto";
import { SubscriptionRecordSchema, SubscriptionStatus } from "@spine-event-engine/proto/client";
import { describe, expect, it } from "vitest";

import * as Storage from "../../src/index.js";

describe("RecordColumn", () => {
  it("retains the declared scalar field type", () => {
    expect(Storage).toHaveProperty("ColumnTypes");
    const columnTypes = Storage.ColumnTypes;
    const type = columnTypes.fromField(EventIdSchema.field.value);
    const column = new Storage.RecordColumn(
      "value",
      type,
      (record: { value: string }) => record.value,
    );
    const record = create(EventIdSchema, { value: "event-42" });

    expect(column.type).toEqual({
      kind: "scalar",
      scalar: ScalarType.STRING,
      longAsString: false,
    });
    expect(column.valueIn(record)).toBe("event-42");
  });

  it("retains the declared enum field type", () => {
    const columnTypes = Storage.ColumnTypes;
    const type = columnTypes.fromField(SubscriptionRecordSchema.field.status);
    const column = new Storage.RecordColumn(
      "status",
      type,
      (record: { status: SubscriptionStatus }) => record.status,
    );
    const record = create(SubscriptionRecordSchema, { status: SubscriptionStatus.ACTIVE });

    expect(column.type.kind).toBe("enum");
    expect(column.type.kind === "enum" && column.type.enum.typeName).toBe(
      "spine.client.SubscriptionStatus",
    );
    expect(column.valueIn(record)).toBe(SubscriptionStatus.ACTIVE);
  });

  it("retains the declared message field schema", () => {
    const columnTypes = Storage.ColumnTypes;
    const type = columnTypes.fromField(SubscriptionRecordSchema.field.id);
    const column = new Storage.RecordColumn("id", type, (record: { id?: unknown }) => record.id);
    const record = create(SubscriptionRecordSchema);

    expect(column.type.kind).toBe("message");
    expect(column.type.kind === "message" && column.type.message.typeName).toBe(
      "spine.client.SubscriptionId",
    );
    expect(column.valueIn(record)).toBeUndefined();
  });

  it("declares types for derived scalar and message columns", () => {
    const columnTypes = Storage.ColumnTypes;

    expect(columnTypes.scalar(ScalarType.STRING)).toEqual({
      kind: "scalar",
      scalar: ScalarType.STRING,
      longAsString: false,
    });
    expect(columnTypes.message(EventIdSchema)).toEqual({
      kind: "message",
      message: EventIdSchema,
    });
  });

  it("retains well-known Timestamp and Spine Version schemas", () => {
    const columnTypes = Storage.ColumnTypes;

    expect(columnTypes.message(TimestampSchema)).toMatchObject({
      kind: "message",
      message: { typeName: "google.protobuf.Timestamp" },
    });
    expect(columnTypes.message(VersionSchema)).toMatchObject({
      kind: "message",
      message: { typeName: "spine.core.Version" },
    });
  });

  it("rejects repeated and map fields as physical columns", () => {
    expect(() => Storage.ColumnTypes.fromField(FieldMaskSchema.field.paths)).toThrow(
      /must have one singular value/,
    );
    expect(() => Storage.ColumnTypes.fromField(StructSchema.field.fields)).toThrow(
      /must have one singular value/,
    );
  });
});
