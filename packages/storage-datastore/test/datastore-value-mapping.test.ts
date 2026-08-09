import { create, ScalarType } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Datastore } from "@google-cloud/datastore";
import { StringifierRegistry } from "@spine-event-engine/core";
import { UserIdSchema, VersionSchema } from "@spine-event-engine/proto";
import { ColumnMappings, ColumnTypes } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { DatastoreColumnMapping } from "../src/datastore/column-mapping.js";
import { DatastoreIdColumn } from "../src/datastore/id-column.js";

describe("Spine JVM Datastore value mappings", () => {
  it("uses reversible stringifier text for message and primitive key names", () => {
    const user = create(UserIdSchema, { value: "user-42" });

    expect(new DatastoreIdColumn(UserIdSchema).value(user)).toBe('{"value":"user-42"}');
    expect(new DatastoreIdColumn(UserIdSchema).read('{"value":"user-42"}')).toEqual(user);
    expect(new DatastoreIdColumn("string").value("record-42")).toBe("record-42");
    expect(new DatastoreIdColumn("int32").value(42)).toBe("42");
    expect(new DatastoreIdColumn("int64").value(42n)).toBe("42");
  });

  it("uses one custom message stringifier for IDs and ordinary columns", () => {
    const registry = new StringifierRegistry();
    registry.register(UserIdSchema, {
      toString: (id) => `user:${id.value}`,
      fromString: (value) => create(UserIdSchema, { value: value.slice("user:".length) }),
    });
    const user = create(UserIdSchema, { value: "42" });
    const mapping = new DatastoreColumnMapping(registry);

    expect(new DatastoreIdColumn(UserIdSchema, registry).value(user)).toBe("user:42");
    expect(ColumnMappings.value(mapping, ColumnTypes.message(UserIdSchema), user)).toBe("user:42");
  });

  it("uses native Datastore scalar, blob, enum, timestamp, version, and null values", () => {
    const mapping = new DatastoreColumnMapping();
    const integer = ColumnMappings.value(
      mapping,
      ColumnTypes.scalar(ScalarType.INT64),
      42n,
    ) as ReturnType<typeof Datastore.int>;
    const floating = ColumnMappings.value(
      mapping,
      ColumnTypes.scalar(ScalarType.DOUBLE),
      42,
    ) as ReturnType<typeof Datastore.double>;
    const bytes = ColumnMappings.value(
      mapping,
      ColumnTypes.scalar(ScalarType.BYTES),
      new Uint8Array([0, 255]),
    );
    const timestamp = ColumnMappings.value(
      mapping,
      ColumnTypes.message(TimestampSchema),
      create(TimestampSchema, { seconds: 42n, nanos: 7 }),
    ) as Date;
    const version = ColumnMappings.value(
      mapping,
      ColumnTypes.message(VersionSchema),
      create(VersionSchema, { number: 7 }),
    ) as ReturnType<typeof Datastore.int>;

    expect(integer.value).toBe("42");
    expect(floating.value).toBe(42);
    expect(bytes).toEqual(Buffer.from([0, 255]));
    expect(timestamp).toBeInstanceOf(Date);
    expect(timestamp.getTime()).toBe(42_000);
    expect(timestamp.getMilliseconds() * 1_000_000).toBe(7);
    expect(version.value).toBe("7");
    expect(ColumnMappings.value(mapping, ColumnTypes.scalar(ScalarType.STRING), null)).toBeNull();
  });
});
