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
import { VersionSchema } from "@spine-event-engine/proto";
import { ColumnTypes } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { PostgresColumnMapping } from "../src/postgres/column-mapping.js";

describe("PostgresColumnMapping", () => {
  it("converts timestamp and version columns to exact native values", () => {
    const mapping = new PostgresColumnMapping();

    expect(
      mapping.of(ColumnTypes.message(TimestampSchema))(
        create(TimestampSchema, { seconds: 4n, nanos: 7 }),
      ),
    ).toBe(4_000_000_007n);
    expect(
      mapping.of(ColumnTypes.message(VersionSchema))(create(VersionSchema, { number: 7 })),
    ).toBe(7);
  });

  it.each([ScalarType.BYTES, ScalarType.FLOAT, ScalarType.DOUBLE])(
    "keeps PostgreSQL-native scalar values",
    (type) => {
      const value = type === ScalarType.BYTES ? new Uint8Array([1]) : 1.5;
      expect(new PostgresColumnMapping().of(ColumnTypes.scalar(type))(value as never)).toEqual(
        value,
      );
    },
  );
});
