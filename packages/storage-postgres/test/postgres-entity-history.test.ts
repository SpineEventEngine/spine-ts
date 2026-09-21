/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { AnySchema, StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { RecordSpec } from "@spine-event-engine/storage";
import type { EntityStorageInput } from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";

const driver = vi.hoisted(() => {
  const query = vi.fn((sql: string) =>
    Promise.resolve({ rowCount: sql.includes("schemata") ? 1 : 0, rows: [] }),
  );
  const release = vi.fn();
  const connect = vi.fn(() => Promise.resolve({ query, release }));
  const end = vi.fn(() => Promise.resolve());
  const Pool = vi.fn(function Pool() {
    return { connect, end };
  });
  return { Pool };
});

vi.mock("pg", () => ({ Pool: driver.Pool }));

import { PostgresStorageFactory } from "../src/index.js";

describe("PostgreSQL Entity history", () => {
  it("creates a factory-managed Entity handle with disabled histories", async () => {
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
      .build();

    const entity = (
      factory as unknown as {
        createEntityStorage(input: EntityStorageInput<string, StringValue>): {
          readonly current: unknown;
          readonly states: { backward(id: string, depth: number): Promise<readonly unknown[]> };
          readonly events: { backward(id: string, depth: number): Promise<readonly unknown[]> };
          isOpen(): boolean;
        };
      }
    ).createEntityStorage(entityInput());

    expect(entity.current).toBeDefined();
    expect(entity.isOpen()).toBe(true);
    await expect(entity.states.backward("task", 1)).resolves.toEqual([]);
    await expect(entity.events.backward("task", 1)).resolves.toEqual([]);
  });
});

function entityInput(): EntityStorageInput<string, StringValue> {
  const unpack = (id: NonNullable<EntityRecord["entityId"]>): string | undefined =>
    id.typeUrl.endsWith(`/${StringValueSchema.typeName}`)
      ? fromBinary(StringValueSchema, id.value).value
      : undefined;
  return {
    context: { name: "Tasks", multitenant: false },
    id: {
      clone: (id) => id,
      key: (id) => id,
      pack: (id) =>
        create(AnySchema, {
          typeUrl: `type.spine.io/${StringValueSchema.typeName}`,
          value: toBinary(StringValueSchema, create(StringValueSchema, { value: id })),
        }),
      unpack,
    },
    columns: [],
    recordSpec: new RecordSpec({
      sourceType: StringValueSchema,
      recordType: EntityRecordSchema,
      idKind: "string",
      extractId: (record) => unpack(record.entityId ?? create(AnySchema)) ?? "",
    }),
    sourceType: StringValueSchema,
    stateSchema: StringValueSchema,
  };
}
