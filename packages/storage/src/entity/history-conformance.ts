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

import { create, ScalarType, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { AnyPacker } from "@spine-event-engine/core";
import { StringValueSchema, TimestampSchema, type Any } from "@bufbuild/protobuf/wkt";
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
 * @typeParam I Entity identifier type.
 * @typeParam S Generated Entity state type.
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
 * @typeParam S Generated Entity state type.
 */
export interface EntityHistoryConformanceAdapter<S extends Message> {
  // prettier-ignore

  /**
   * Generated descriptor for the test Entity state.
   */
  readonly stateSchema: GenMessage<S>;

  /**
   * Creates one domain-correct Entity state fixture.
   * @param id Entity identifier.
   * @param value State title.
   * @returns Generated Entity state.
   */
  state(id: string, value: string): S;

  /**
   * Reads the title used in conformance assertions.
   * @param state Generated Entity state.
   * @returns State title.
   */
  value(state: S): string;

  /**
   * Creates storage for the supplied Entity shape.
   * @param input Defines the Entity storage scope and schemas.
   * @returns The provider handle.
   */
  create(input: EntityStorageInput<string, S>): EntityStorageConformance<string, S>;

  /**
   * Creates a reopened handle for the same Entity shape.
   * @param input Defines the Entity storage scope and schemas.
   * @returns The reopened provider handle.
   */
  reopen(input: EntityStorageInput<string, S>): EntityStorageConformance<string, S>;
}

interface EntityHistoryConformanceChecks {
  /**
   * Checks current-record querying with the supplied generated state.
   * @typeParam S Generated Entity state type.
   * @param adapter Provider and state fixture.
   * @returns Completion after current-record assertions.
   */
  checkCurrentQueries<S extends Message>(
    adapter: EntityHistoryConformanceAdapter<S>,
  ): Promise<void>;

  /**
   * Checks current-record and state-history behavior.
   * @typeParam S Generated Entity state type.
   * @param adapter Provider and state fixture.
   * @returns Completion after conformance assertions.
   */
  check<S extends Message>(adapter: EntityHistoryConformanceAdapter<S>): Promise<void>;
}

/**
 * Runs provider-neutral current-record and generated state-history checks.
 */
export const EntityHistoryConformance: EntityHistoryConformanceChecks = Object.freeze({
  // prettier-ignore

  /**
   * Checks the shared current-record behavior.
   * @typeParam S Generated Entity state type.
   * @param adapter Supplies the provider under test.
   * @returns Completes when the behavior is verified.
   */
  async checkCurrentQueries<S extends Message>(adapter: EntityHistoryConformanceAdapter<S>): Promise<void> {
    const storage = adapter.create(EntityHistoryFixture.input(adapter));
    try {
      await storage.current.write(EntityHistoryFixture.record(adapter, "task", "task", 3));
      await storage.current.write(EntityHistoryFixture.record(adapter, "later", "later", 4));
      const queried = await storage.current.query({
        predicate: { kind: "comparison", column: "title", operator: "equal", value: "task" },
        order: [{ column: "title", direction: "asc" }],
        limit: 1,
        candidateLimit: 2,
      });
      const current = await storage.current.read("task");
      EntityHistoryFixture.assert(current !== undefined, "current state must round-trip");
      EntityHistoryFixture.assert(
        adapter.value(EntityHistoryFixture.state(adapter, current)) === "task",
        "current state must round-trip",
      );
      EntityHistoryFixture.assert(
        queried.length === 1 && queried[0]?.id === "task",
        "current queries must filter, order, and limit generated records",
      );
    } finally {
      storage.close?.();
    }
    const reopened = adapter.reopen(EntityHistoryFixture.input(adapter));
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
   * @typeParam S Generated Entity state type.
   * @param adapter Supplies the provider under test.
   * @returns Completes when the behavior is verified.
   */
  async check<S extends Message>(adapter: EntityHistoryConformanceAdapter<S>): Promise<void> {
    await EntityHistoryConformance.checkCurrentQueries(adapter);
    const input = EntityHistoryFixture.input(adapter);
    const storage = adapter.create(input);
    try {
      await storage.states.append(EntityHistoryFixture.record(adapter, "task", "first", 1));
      await storage.states.append(EntityHistoryFixture.record(adapter, "task", "second", 2));
      const backward = await storage.states.backward("task", 2);
      const newest = backward[0];
      const older = backward[1];
      EntityHistoryFixture.assert(
        newest !== undefined &&
          older !== undefined &&
          adapter.value(EntityHistoryFixture.state(adapter, newest)) === "second" &&
          adapter.value(EntityHistoryFixture.state(adapter, older)) === "first",
        "state history must return newest records first",
      );
      const stateAt = await storage.states.stateAt(
        "task",
        create(TimestampSchema, { seconds: 1n }),
      );
      EntityHistoryFixture.assert(
        stateAt !== undefined && adapter.value(stateAt) === "first",
        "state history must return the state at an inclusive timestamp",
      );
      await EntityHistoryFixture.checkEvents(storage.events);
    } finally {
      storage.close?.();
    }
  },
});

const EntityHistoryFixture: {
  /**
   * Builds provider input from a generated Entity state fixture.
   * @typeParam S Generated Entity state type.
   * @param adapter Generated state fixture.
   * @returns Provider storage input.
   */
  input<S extends Message>(
    adapter: EntityHistoryConformanceAdapter<S>,
  ): EntityStorageInput<string, S>;

  /**
   * Creates a versioned generated Entity record.
   * @typeParam S Generated Entity state type.
   * @param adapter Generated state fixture.
   * @param id Entity identifier.
   * @param value State title.
   * @param version Entity version.
   * @returns Generated Entity record.
   */
  record<S extends Message>(
    adapter: EntityHistoryConformanceAdapter<S>,
    id: string,
    value: string,
    version: number,
  ): EntityRecord;

  /**
   * Decodes a generated Entity state.
   * @typeParam S Generated Entity state type.
   * @param adapter Generated state fixture.
   * @param record Generated Entity record.
   * @returns Decoded Entity state.
   */
  state<S extends Message>(adapter: EntityHistoryConformanceAdapter<S>, record: EntityRecord): S;

  /**
   * Creates a diagnostic Event for history checks.
   * @param id Event identifier.
   * @param producer Producer identifier.
   * @param version Event version.
   * @returns Generated Event.
   */
  event(id: string, producer: string, version: number): import("@spine-event-engine/proto").Event;

  /**
   * Checks one conformance condition.
   * @param condition Expected condition.
   * @param message Failure explanation.
   */
  assert(condition: unknown, message: string): asserts condition;

  /**
   * Checks generated Event retention and truncation.
   * @param events Event-history port.
   * @returns Completion after Event assertions.
   */
  checkEvents(events: EntityEventHistoryPort<string>): Promise<void>;

  /**
   * Creates the generated record specification.
   * @typeParam S Generated Entity state type.
   * @param adapter Generated state fixture.
   * @param unpack Decodes scalar Entity identifiers.
   * @param columns Declared query columns.
   * @returns Record specification.
   */
  spec<S extends Message>(
    adapter: EntityHistoryConformanceAdapter<S>,
    unpack: (id: Any) => string | undefined,
    columns: RecordColumn<EntityRecord>[],
  ): RecordSpec<string, EntityRecord>;
} = Object.freeze({
  /**
   * Builds provider input using the caller's generated Entity state schema.
   * @typeParam S Generated Entity state type.
   * @param adapter Generated state fixture and provider port factory.
   * @returns Entity storage input for conformance checks.
   */
  input<S extends Message>(
    adapter: EntityHistoryConformanceAdapter<S>,
  ): EntityStorageInput<string, S> {
    const unpack = (id: Any): string | undefined =>
      AnyPacker.tryUnpack(id, StringValueSchema)?.value;
    const columns = [
      new RecordColumn("title", ColumnTypes.scalar(ScalarType.STRING), (record: EntityRecord) =>
        adapter.value(EntityHistoryFixture.state(adapter, record)),
      ),
    ];
    return {
      context: { name: "EntityHistoryConformance", multitenant: false },
      id: {
        clone: (id) => id,
        key: (id) => id,
        pack: (id) => AnyPacker.pack(StringValueSchema, create(StringValueSchema, { value: id })),
        unpack,
      },
      columns,
      recordSpec: EntityHistoryFixture.spec(adapter, unpack, columns),
      sourceType: adapter.stateSchema,
      stateSchema: adapter.stateSchema,
      stateHistory: true,
      eventHistory: true,
    };
  },

  /**
   * Creates a generated Entity record for one state version.
   * @typeParam S Generated Entity state type.
   * @param adapter Generated state fixture and provider port factory.
   * @param id Entity identifier.
   * @param value State title.
   * @param version Entity version.
   * @returns Generated Entity record.
   */
  record<S extends Message>(
    adapter: EntityHistoryConformanceAdapter<S>,
    id: string,
    value: string,
    version: number,
  ): EntityRecord {
    return create(EntityRecordSchema, {
      entityId: AnyPacker.pack(StringValueSchema, create(StringValueSchema, { value: id })),
      state: AnyPacker.pack(adapter.stateSchema, adapter.state(id, value)),
      version: {
        number: version,
        timestamp: create(TimestampSchema, { seconds: BigInt(version) }),
      },
    });
  },

  /**
   * Decodes the caller's Entity state from a generated record.
   * @typeParam S Generated Entity state type.
   * @param adapter Generated state fixture and provider port factory.
   * @param record Generated Entity record.
   * @returns Decoded generated Entity state.
   */
  state<S extends Message>(adapter: EntityHistoryConformanceAdapter<S>, record: EntityRecord): S {
    if (record.state === undefined) throw new Error("Entity record has no state.");
    return AnyPacker.unpack(record.state, adapter.stateSchema);
  },

  /**
   * Builds the current-record specification for the generated state.
   * @typeParam S Generated Entity state type.
   * @param adapter Generated state fixture.
   * @param unpack Decodes scalar Entity identifiers.
   * @param columns Declared query columns.
   * @returns Record specification.
   */
  spec<S extends Message>(
    adapter: EntityHistoryConformanceAdapter<S>,
    unpack: (id: Any) => string | undefined,
    columns: RecordColumn<EntityRecord>[],
  ): RecordSpec<string, EntityRecord> {
    return new RecordSpec({
      sourceType: adapter.stateSchema,
      recordType: EntityRecordSchema,
      idKind: "string",
      extractId: (record) => {
        if (record.entityId === undefined) throw new Error("EntityRecord requires entityId.");
        const id = unpack(record.entityId);
        if (id === undefined) throw new Error("EntityRecord has an incompatible ID.");
        return id;
      },
      columns,
    });
  },

  /**
   * Checks generated Event retention and truncation.
   * @param events Event-history port.
   * @returns Completion after Event assertions.
   */
  async checkEvents(events: EntityEventHistoryPort<string>): Promise<void> {
    await events.append(EntityHistoryFixture.event("event", "task", 2));
    EntityHistoryFixture.assert(
      (await events.backward("task", 1))[0]?.id?.value === "event",
      "event history must retain generated events",
    );
    await events.truncate(create(TimestampSchema, { seconds: 3n }));
    EntityHistoryFixture.assert(
      (await events.backward("task", 1)).length === 0,
      "event history truncation must remove older generated events",
    );
  },

  /**
   * Creates a generated diagnostic Event.
   * @param id Event identifier.
   * @param producer Producer Entity identifier.
   * @param version Event version.
   * @returns Generated Event.
   */
  event(id: string, producer: string, version: number) {
    return create(EventSchema, {
      id: create(EventIdSchema, { value: id }),
      context: {
        producerId: AnyPacker.pack(
          StringValueSchema,
          create(StringValueSchema, { value: producer }),
        ),
        timestamp: create(TimestampSchema, { seconds: BigInt(version) }),
        version: create(VersionSchema, { number: version }),
      },
    });
  },

  /**
   * Checks one conformance condition.
   * @param condition Expected condition.
   * @param message Failure explanation.
   */
  assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(`Entity storage conformance failed: ${message}`);
  },
});
