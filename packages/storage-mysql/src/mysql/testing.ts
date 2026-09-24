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

import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import { EventSchema } from "@spine-event-engine/proto";
import { StringifierRegistry } from "@spine-event-engine/core";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import {
  eventHistorySpec,
  stateHistorySpec,
  type EntityStorageInput,
} from "@spine-event-engine/storage/provider";
import type { RecordSpec, StorageGroup } from "@spine-event-engine/storage";
import type { Pool, RowDataPacket } from "mysql2/promise";

import { MysqlTableResolver } from "./table-resolver.js";
import { MysqlIdColumn } from "./id-column.js";

/**
 * Resolves the default table name for a record-family integration test.
 *
 * @internal
 * @param spec Describes the record family.
 * @param group Identifies an optional storage group.
 * @returns The default physical table name.
 */
export function mysqlRecordTableName<I, R extends Message>(
  spec: RecordSpec<I, R>,
  group?: StorageGroup,
): string {
  return new MysqlTableResolver().resolve(
    spec.sourceType.typeName,
    group?.name,
    undefined,
    spec.recordType.typeName,
  ).tableName;
}

/**
 * Resolves the default tables used by an Entity-family integration test.
 *
 * @internal
 * @param input Describes the Entity family and enabled histories.
 * @returns The current and enabled history table names.
 */
export function mysqlEntityTables<I, S extends Message>(
  input: EntityStorageInput<I, S>,
): readonly string[] {
  const tables = [
    new MysqlTableResolver().resolve(
      input.sourceType.typeName,
      undefined,
      undefined,
      EntityRecordSchema.typeName,
    ).tableName,
  ];
  if (input.stateHistory) {
    const state = stateHistorySpec(input.stateSchema);
    tables.push(mysqlRecordTableName(state.spec, state.group));
  }
  if (input.eventHistory) {
    const event = eventHistorySpec(input.stateSchema);
    tables.push(mysqlRecordTableName(event.spec, event.group));
  }
  return tables;
}

/**
 * Reads the current Entity record for a provider integration test.
 *
 * @internal
 * @param pool Queries the test database.
 * @param input Identifies the Entity family.
 * @param id Identifies the current Entity row.
 * @param stringifiers Converts message-valued identifiers using the factory's mapping.
 * @returns Resolves to the current record, or `undefined` when it is absent.
 */
export async function mysqlCurrentRecord<I, S extends Message>(
  pool: Pool,
  input: EntityStorageInput<I, S>,
  id: I,
  stringifiers: StringifierRegistry = new StringifierRegistry(),
): Promise<
  | import("@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js").EntityRecord
  | undefined
> {
  const table = mysqlEntityTables(input)[0];
  if (table === undefined) throw new Error("Current Entity table is missing.");
  const [rows] = await pool.query<(RowDataPacket & { bytes: Uint8Array })[]>(
    `SELECT bytes FROM \`${table}\` WHERE ID=?`,
    [new MysqlIdColumn(input.recordSpec.idType, stringifiers).value(id)],
  );
  return rows[0] === undefined ? undefined : fromBinary(EntityRecordSchema, rows[0].bytes);
}

/**
 * Returns retained state and diagnostic record counts for one Entity in a provider test.
 *
 * @internal
 * @param pool Queries the test database.
 * @param input Identifies the Entity family.
 * @param id Identifies the Entity whose histories are counted.
 * @returns Resolves to the matching state and diagnostic counts.
 */
export async function mysqlHistoryCounts<I, S extends Message>(
  pool: Pool,
  input: EntityStorageInput<I, S>,
  id: I,
): Promise<{ readonly states: number; readonly events: number }> {
  const packedId = input.id.pack(id);
  let states = 0;
  if (input.stateHistory) {
    const state = stateHistorySpec(input.stateSchema);
    const rows = await recordBytes(pool, input, state.spec, state.group);
    states = rows.filter((bytes) => {
      const record = fromBinary(EntityRecordSchema, bytes);
      return sameAny(record.entityId, packedId);
    }).length;
  }
  let events = 0;
  if (input.eventHistory) {
    const event = eventHistorySpec(input.stateSchema);
    const rows = await recordBytes(pool, input, event.spec, event.group);
    events = rows.filter((bytes) => {
      const record = fromBinary(EventSchema, bytes);
      return sameAny(record.context?.producerId, packedId);
    }).length;
  }
  return { states, events };
}

async function recordBytes<I, J, R extends Message, S extends Message>(
  pool: Pool,
  input: EntityStorageInput<I, S>,
  spec: RecordSpec<J, R>,
  group: StorageGroup,
): Promise<readonly Uint8Array[]> {
  const table = mysqlRecordTableName(spec, group);
  const [rows] = await pool.query<(RowDataPacket & { bytes: Uint8Array })[]>(
    `SELECT bytes FROM \`${table}\``,
  );
  return rows.map((row) => row.bytes);
}

function sameAny(left: Any | undefined, right: Any): boolean {
  return (
    left !== undefined &&
    Buffer.compare(toBinary(AnySchema, left), toBinary(AnySchema, right)) === 0
  );
}
