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
import { UserIdSchema, VersionSchema } from "@spine-event-engine/proto";
import { StringifierRegistry } from "@spine-event-engine/core";
import { SubscriptionRecordSchema, SubscriptionStatus } from "@spine-event-engine/proto/client";
import { ColumnMappings, ColumnTypes } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { MysqlColumnMapping } from "../src/mysql/column-mapping.js";

describe("MysqlColumnMapping", () => {
  const mapping = new MysqlColumnMapping();

  it("maps scalar, enum, bytes, and null values like Spine JDBC", () => {
    expect(ColumnMappings.value(mapping, ColumnTypes.scalar(ScalarType.STRING), "open")).toBe(
      "open",
    );
    expect(ColumnMappings.value(mapping, ColumnTypes.scalar(ScalarType.INT32), 42)).toBe(42);
    expect(ColumnMappings.value(mapping, ColumnTypes.scalar(ScalarType.INT64), 42n)).toBe(42n);
    expect(ColumnMappings.value(mapping, ColumnTypes.scalar(ScalarType.BOOL), true)).toBe(true);
    expect(
      ColumnMappings.value(mapping, ColumnTypes.scalar(ScalarType.BYTES), new Uint8Array([0, 255])),
    ).toEqual(new Uint8Array([0, 255]));
    expect(
      ColumnMappings.value(
        mapping,
        ColumnTypes.fromField(SubscriptionRecordSchema.field.status),
        SubscriptionStatus.ACTIVE,
      ),
    ).toBe(SubscriptionStatus.ACTIVE);
    expect(ColumnMappings.value(mapping, ColumnTypes.scalar(ScalarType.STRING), null)).toBeNull();
  });

  it("maps ordinary messages to compact Proto JSON", () => {
    const user = create(UserIdSchema, { value: "user-42" });

    expect(ColumnMappings.value(mapping, ColumnTypes.message(UserIdSchema), user)).toBe(
      '{"value":"user-42"}',
    );
  });

  it("uses a registered message stringifier symmetrically", () => {
    const registry = new StringifierRegistry();
    registry.register(UserIdSchema, {
      toString: (value) => `user:${value.value}`,
      fromString: (value) => create(UserIdSchema, { value: value.slice(5) }),
    });
    const custom = new MysqlColumnMapping(registry);

    expect(
      ColumnMappings.value(
        custom,
        ColumnTypes.message(UserIdSchema),
        create(UserIdSchema, { value: "42" }),
      ),
    ).toBe("user:42");
  });

  it("maps Timestamp to epoch nanoseconds and Version to its number", () => {
    const timestamp = create(TimestampSchema, { seconds: 42n, nanos: 7 });
    const version = create(VersionSchema, { number: 7 });

    expect(ColumnMappings.value(mapping, ColumnTypes.message(TimestampSchema), timestamp)).toBe(
      42_000_000_007n,
    );
    expect(ColumnMappings.value(mapping, ColumnTypes.message(VersionSchema), version)).toBe(7);
  });
});
