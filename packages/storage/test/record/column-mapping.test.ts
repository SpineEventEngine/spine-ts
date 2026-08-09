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
