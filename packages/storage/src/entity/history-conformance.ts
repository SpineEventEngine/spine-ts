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

import { create, fromBinary, ScalarType, toBinary, type Message } from "@bufbuild/protobuf";
import {
  AnySchema,
  StringValueSchema,
  TimestampSchema,
  type Any,
  type StringValue,
} from "@bufbuild/protobuf/wkt";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { EventIdSchema, EventSchema, VersionSchema } from "@spine-event-engine/proto";

import type { EntityEventHistoryPort, EntityStateHistoryPort } from "./entity-history-storage.js";
import type { EntityRecordStorage } from "./entity-record.js";
import type { EntityStorageInput } from "../memory/in-memory-entity-history.js";
import { RecordColumn } from "../record/record-column.js";
import { ColumnTypes } from "../record/column-type.js";
import { RecordSpec } from "../record/record-spec.js";

/**
 * Provides the current-record and state-history handles used by adapter conformance checks.
 */
export interface EntityStorageConformance<I, S extends Message> {
  // prettier-ignore

  /**
   * Stores current Entity records.
   */
  readonly current: EntityRecordStorage<I>;

  /**
   * Stores retained generated Entity records for state history.
   */
  readonly states: EntityStateHistoryPort<I, S>;

  /**
   * Stores retained generated diagnostic events.
   */
  readonly events: EntityEventHistoryPort<I>;

  /**
   * Closes provider-owned resources when needed.
   */
  close?(): void;
}

/**
 * Creates a provider handle for the reusable current-record and state-history checks.
 */
export interface EntityHistoryConformanceAdapter {
  // prettier-ignore

  /**
   * Creates storage for the supplied Entity shape.
   *
   * @param input Defines the Entity storage scope and schemas.
   * @returns The provider handle.
   */
  readonly create: (
    input: EntityStorageInput<string, StringValue>,
  ) => EntityStorageConformance<string, StringValue>;

  /**
   * Creates a reopened handle for the same Entity shape.
   *
   * @param input Defines the Entity storage scope and schemas.
   * @returns The reopened provider handle.
   */
  readonly reopen: (
    input: EntityStorageInput<string, StringValue>,
  ) => EntityStorageConformance<string, StringValue>;
}

interface EntityHistoryConformanceChecks {
  readonly checkCurrentQueries: (adapter: EntityHistoryConformanceAdapter) => Promise<void>;
  readonly check: (adapter: EntityHistoryConformanceAdapter) => Promise<void>;
}

/**
 * Runs provider-neutral current-record and generated state-history checks.
 */
export const EntityHistoryConformance: EntityHistoryConformanceChecks = Object.freeze({
  // prettier-ignore

  /**
   * Checks the shared current-record behavior.
   *
   * @param adapter Supplies the provider under test.
   * @returns Completes when the behavior is verified.
   */
  async checkCurrentQueries(adapter: EntityHistoryConformanceAdapter): Promise<void> {
    const storage = adapter.create(EntityHistoryFixture.input());
    try {
      await storage.current.write(EntityHistoryFixture.record("task", "task", 3));
      await storage.current.write(EntityHistoryFixture.record("later", "later", 4));
      const queried = await storage.current.query({
        predicate: { kind: "comparison", column: "value", operator: "equal", value: "later" },
        order: [{ column: "value", direction: "asc" }],
        limit: 1,
        candidateLimit: 2,
      });
      const current = await storage.current.read("task");
      EntityHistoryFixture.assert(current !== undefined, "current state must round-trip");
      EntityHistoryFixture.assert(
        EntityHistoryFixture.state(current).value === "task",
        "current state must round-trip",
      );
      EntityHistoryFixture.assert(
        queried.length === 1 && queried[0]?.id === "later",
        "current queries must filter, order, and limit generated records",
      );
    } finally {
      storage.close?.();
    }
    const reopened = adapter.reopen(EntityHistoryFixture.input());
    try {
      EntityHistoryFixture.assert(
        (await reopened.current.read("task")) !== undefined,
        "current record must survive reopen",
      );
    } finally {
      reopened.close?.();
    }
  },

  /**
   * Checks the generated state-history behavior.
   *
   * @param adapter Supplies the provider under test.
   * @returns Completes when the behavior is verified.
   */
  async check(adapter: EntityHistoryConformanceAdapter): Promise<void> {
    await EntityHistoryConformance.checkCurrentQueries(adapter);
    const input = EntityHistoryFixture.input();
    const storage = adapter.create(input);
    try {
      await storage.states.append(EntityHistoryFixture.record("task", "first", 1));
      await storage.states.append(EntityHistoryFixture.record("task", "second", 2));
      const backward = await storage.states.backward("task", 2);
      const newest = backward[0];
      const older = backward[1];
      EntityHistoryFixture.assert(
        newest !== undefined &&
          older !== undefined &&
          EntityHistoryFixture.state(newest).value === "second" &&
          EntityHistoryFixture.state(older).value === "first",
        "state history must return newest records first",
      );
      EntityHistoryFixture.assert(
        (await storage.states.stateAt("task", create(TimestampSchema, { seconds: 1n })))?.value ===
          "first",
        "state history must return the state at an inclusive timestamp",
      );
      const event = EntityHistoryFixture.event("event", "task", 2);
      await storage.events.append(event);
      EntityHistoryFixture.assert(
        (await storage.events.backward("task", 1))[0]?.id?.value === "event",
        "event history must retain generated events",
      );
      await storage.events.truncate(create(TimestampSchema, { seconds: 3n }));
      EntityHistoryFixture.assert(
        (await storage.events.backward("task", 1)).length === 0,
        "event history truncation must remove older generated events",
      );
    } finally {
      storage.close?.();
    }
  },
});

const EntityHistoryFixture: {
  input(): EntityStorageInput<string, StringValue>;
  record(id: string, state: string, version: number): EntityRecord;
  pack(value: StringValue): Any;
  state(record: EntityRecord): StringValue;
  event(id: string, producer: string, version: number): import("@spine-event-engine/proto").Event;
  assert(condition: unknown, message: string): asserts condition;
} = Object.freeze({
  input(): EntityStorageInput<string, StringValue> {
    const unpack = (id: Any): string | undefined =>
      id.typeUrl.endsWith(`/${StringValueSchema.typeName}`)
        ? fromBinary(StringValueSchema, id.value).value
        : undefined;
    const columns = [
      new RecordColumn(
        "value",
        ColumnTypes.scalar(ScalarType.STRING),
        (record: EntityRecord) => EntityHistoryFixture.state(record).value,
      ),
    ];
    return {
      context: { name: "EntityHistoryConformance", multitenant: false },
      id: {
        clone: (id) => id,
        key: (id) => id,
        pack: (id) => EntityHistoryFixture.pack(create(StringValueSchema, { value: id })),
        unpack,
      },
      columns,
      recordSpec: new RecordSpec({
        sourceType: StringValueSchema,
        recordType: EntityRecordSchema,
        idKind: "string",
        extractId: (record) => {
          if (record.entityId === undefined) throw new Error("EntityRecord requires entityId.");
          const id = unpack(record.entityId);
          if (id === undefined) throw new Error("EntityRecord has an incompatible ID.");
          return id;
        },
        columns,
      }),
      sourceType: StringValueSchema,
      stateSchema: StringValueSchema,
      stateHistory: true,
      eventHistory: true,
    };
  },

  record(id: string, state: string, version: number): EntityRecord {
    return create(EntityRecordSchema, {
      entityId: EntityHistoryFixture.pack(create(StringValueSchema, { value: id })),
      state: EntityHistoryFixture.pack(create(StringValueSchema, { value: state })),
      version: {
        number: version,
        timestamp: create(TimestampSchema, { seconds: BigInt(version) }),
      },
    });
  },

  pack(value: StringValue) {
    return create(AnySchema, {
      typeUrl: `type.spine.io/${StringValueSchema.typeName}`,
      value: toBinary(StringValueSchema, value),
    });
  },

  state(record: EntityRecord): StringValue {
    if (record.state === undefined) throw new Error("Entity record has no state.");
    return fromBinary(StringValueSchema, record.state.value);
  },

  event(id: string, producer: string, version: number) {
    return create(EventSchema, {
      id: create(EventIdSchema, { value: id }),
      context: {
        producerId: EntityHistoryFixture.pack(create(StringValueSchema, { value: producer })),
        timestamp: create(TimestampSchema, { seconds: BigInt(version) }),
        version: create(VersionSchema, { number: version }),
      },
    });
  },

  assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(`Entity storage conformance failed: ${message}`);
  },
});
