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

import { create, toBinary } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { EntityStateKeySchema } from "@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js";
import { describe, expect, it } from "vitest";
import { TaskIdSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { DatastoreColumnMapping } from "../../../storage-datastore/src/datastore/column-mapping.js";
import { DatastoreIdColumn } from "../../../storage-datastore/src/datastore/id-column.js";
import { MysqlColumnMapping } from "../../../storage-mysql/src/mysql/column-mapping.js";
import { MysqlIdColumn } from "../../../storage-mysql/src/mysql/id-column.js";
import { PostgresColumnMapping } from "../../../storage-postgres/src/postgres/column-mapping.js";
import { PostgresIdColumn } from "../../../storage-postgres/src/postgres/id-column.js";
import { ColumnTypes } from "../../src/index.js";

describe("default provider stringifiers", () => {
  it("uses a generated application Any in retained ID and query-column mappings", async () => {
    const id = create(EntityStateKeySchema, {
      entityId: create(AnySchema, {
        typeUrl: `custom/${TaskIdSchema.typeName}`,
        value: toBinary(TaskIdSchema, create(TaskIdSchema, { value: "task-1" })),
      }),
      version: 1,
    });
    const postgresId = new PostgresIdColumn(EntityStateKeySchema);
    const mysqlId = new MysqlIdColumn(EntityStateKeySchema);
    const datastoreId = new DatastoreIdColumn(EntityStateKeySchema);
    const postgresColumn = new PostgresColumnMapping().of(
      ColumnTypes.message(EntityStateKeySchema),
    );
    const mysqlColumn = new MysqlColumnMapping().of(ColumnTypes.message(EntityStateKeySchema));
    const datastoreColumn = new DatastoreColumnMapping().of(
      ColumnTypes.message(EntityStateKeySchema),
    );

    expect(() => postgresId.value(id)).toThrow();
    await import("../../../../examples/todo/generated/proto-module.js");

    const text = postgresId.value(id);
    if (typeof text !== "string") {
      throw new Error("Expected a string value from the PostgreSQL ID column.");
    }
    expect(mysqlId.value(id)).toBe(text);
    expect(datastoreId.value(id)).toBe(text);
    expect(postgresId.read(text)).toEqual(id);
    expect(mysqlId.read(text)).toEqual(id);
    expect(datastoreId.read(text)).toEqual(id);
    expect(postgresColumn(id)).toBe(text);
    expect(mysqlColumn(id)).toBe(text);
    expect(datastoreColumn(id)).toBe(text);
  });
});
