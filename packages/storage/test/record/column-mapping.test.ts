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
import { EventIdSchema, type EventId } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import {
  ColumnMappings,
  ColumnTypes,
  RecordColumn,
  type ColumnMapping,
  type RecordColumnType,
} from "../../src/index.js";

type Mapping = ColumnMapping<string>;

describe("ColumnMapping", () => {
  it("maps stored and queried values through the same typed rule", () => {
    const type = ColumnTypes.fromField<string>(EventIdSchema.field.value);
    const column = new RecordColumn<EventId, string>("value", type, (record) => record.value);
    const mapping: Mapping = {
      of: mapValue,
      ofNull: () => () => "null",
    };
    const record = create(EventIdSchema, { value: "event-42" });

    const stored = ColumnMappings.value(mapping, column.type, column.valueIn(record));
    const queried = ColumnMappings.value(mapping, column.type, "event-42");

    expect(stored).toBe("scalar:event-42");
    expect(queried).toBe(stored);
  });

  it.each([null, undefined])("uses the null mapping for %s", (value) => {
    const mapping: Mapping = {
      of: () => () => "value",
      ofNull: () => () => "null",
    };

    expect(ColumnMappings.value(mapping, ColumnTypes.scalar(ScalarType.STRING), value)).toBe(
      "null",
    );
  });
});

function mapValue(columnType: RecordColumnType): (value: unknown) => string {
  return (value) => {
    const text = typeof value === "string" ? value : "non-string";
    return `${columnType.kind}:${text}`;
  };
}
