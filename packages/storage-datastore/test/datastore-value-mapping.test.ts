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
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Datastore } from "@google-cloud/datastore";
import { StringifierRegistry } from "@spine-event-engine/core";
import { UserIdSchema, VersionSchema } from "@spine-event-engine/proto";
import { OrderBy_DirectionSchema } from "@spine-event-engine/proto/generated/spine/client/query_pb.js";
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
    expect(
      (
        ColumnMappings.value(mapping, ColumnTypes.enum(OrderBy_DirectionSchema), 2) as {
          value: string;
        }
      ).value,
    ).toBe("2");
  });

  it.each([
    [ScalarType.STRING, "text", "text"],
    [ScalarType.BOOL, true, true],
    [ScalarType.INT32, -42, "-42"],
    [ScalarType.SINT32, -42, "-42"],
    [ScalarType.SFIXED32, -42, "-42"],
    [ScalarType.UINT32, 42, "42"],
    [ScalarType.FIXED32, 42, "42"],
    [ScalarType.INT64, -42n, "-42"],
    [ScalarType.SINT64, -42n, "-42"],
    [ScalarType.SFIXED64, -42n, "-42"],
    [ScalarType.UINT64, 42n, "42"],
    [ScalarType.FIXED64, 42n, "42"],
    [ScalarType.FLOAT, 1.5, 1.5],
    [ScalarType.DOUBLE, 1.5, 1.5],
  ] as const)("maps scalar type %s to its native value", (type, input, expected) => {
    const result = ColumnMappings.value(
      new DatastoreColumnMapping(),
      ColumnTypes.scalar(type),
      input,
    );
    const actual =
      typeof result === "object" && result !== null && "value" in result ? result.value : result;
    expect(actual).toBe(expected);
  });

  it("rejects invalid integer and timestamp values before provider work", () => {
    const mapping = new DatastoreColumnMapping();
    const value = (type: ScalarType, input: unknown) =>
      ColumnMappings.value(mapping, ColumnTypes.scalar(type), input);

    expect(() => value(ScalarType.INT32, 2 ** 31)).toThrow("outside its range");
    expect(() => value(ScalarType.INT32, -(2 ** 31) - 1)).toThrow("outside its range");
    expect(() => value(ScalarType.UINT32, -1)).toThrow("outside its range");
    expect(() => value(ScalarType.UINT32, 2 ** 32)).toThrow("outside its range");
    expect(() => value(ScalarType.UINT64, 1n << 63n)).toThrow("signed 64-bit provider range");
    expect(() => value(ScalarType.INT64, 1.5)).toThrow("integer column is invalid");
    expect(() => value(ScalarType.INT64, "01")).toThrow("integer column is invalid");
    expect((value(ScalarType.INT64, "42") as ReturnType<typeof Datastore.int>).value).toBe("42");

    const timestamp = (seconds: unknown, nanos: unknown) =>
      ColumnMappings.value(mapping, ColumnTypes.message(TimestampSchema), {
        seconds,
        nanos,
      });
    expect(() => timestamp(1, 0)).toThrow("timestamp column is invalid");
    expect(() => timestamp(1n, 0.5)).toThrow("timestamp column is invalid");
    expect(() => timestamp(1n, -1)).toThrow("timestamp column is invalid");
    expect(() => timestamp(1n, 1_000_000_000)).toThrow("timestamp column is invalid");
    expect(() => timestamp(10n ** 400n, 0)).toThrow("outside the supported range");
  });

  it("rejects unsupported and malformed IDs", () => {
    expect(new DatastoreIdColumn("int32").read("42")).toBe(42);
    expect(new DatastoreIdColumn("int64").read("42")).toBe(42n);
    expect(() => new DatastoreIdColumn("float")).toThrow("does not support");
    expect(() => new DatastoreIdColumn("string").value(42)).toThrow("identifier is invalid");
    expect(() => new DatastoreIdColumn("int32").read("not-an-integer")).toThrow(
      "identifier is invalid",
    );
    expect(() => new DatastoreIdColumn("int64").read("not-an-integer")).toThrow();
    expect(() => new DatastoreIdColumn("string").value("")).toThrow("must be non-empty");
    expect(() => new DatastoreIdColumn("string").value("x".repeat(1_501))).toThrow("1,500-byte");
  });
});
