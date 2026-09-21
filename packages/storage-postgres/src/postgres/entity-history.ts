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

import type { Message } from "@bufbuild/protobuf";
import type { EntityRecord } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import type {
  EntityEventHistoryPort,
  EntityRecordStorage,
  EntityStateHistoryPort,
  EntityStorageInput,
} from "@spine-event-engine/storage/provider";
import {
  disabledEventHistoryPort,
  disabledStateHistoryPort,
} from "@spine-event-engine/storage/provider";
import type {
  NormalizedQueryEntry,
  NormalizedQueryPlan,
  RecordStorage,
} from "@spine-event-engine/storage";

/**
 * Describes PostgreSQL-backed Entity record-family handles.
 */
export interface PostgresEntityStorageHandle<I, S extends Message> {
  // prettier-ignore

  /**
   * Exposes current Entity records.
   */
  readonly current: EntityRecordStorage<I>;

  /**
   * Exposes Entity state history records.
   */
  readonly states: EntityStateHistoryPort<I, S>;

  /**
   * Exposes Entity event history records.
   */
  readonly events: EntityEventHistoryPort<I>;

  /**
   * Returns whether this Entity storage handle accepts operations.
   *
   * @returns Whether the handle is open.
   */
  isOpen(): boolean;

  /**
   * Closes the Entity record-family handles.
   */
  close(): void;
}

/**
 * Provides PostgreSQL-backed current Entity storage and optional disabled history ports.
 */
export class PostgresEntityStorage<I, S extends Message> implements PostgresEntityStorageHandle<
  I,
  S
> {
  /**
   * Exposes current Entity records.
   */
  readonly current: EntityRecordStorage<I>;

  /**
   * Exposes optional Entity state history.
   */
  readonly states: EntityStateHistoryPort<I, S>;

  /**
   * Exposes optional Entity event history.
   */
  readonly events: EntityEventHistoryPort<I>;
  #open = true;

  /**
   * Creates Entity ports around one current-record handle.
   *
   * @param input Supplies Entity identity and materialized column definitions.
   * @param records Stores current Entity record envelopes.
   * @param onClose Unregisters this Entity handle from its factory.
   */
  constructor(
    input: EntityStorageInput<I, S>,
    private readonly records: RecordStorage<I, EntityRecord>,
    private readonly onClose: () => void,
  ) {
    this.current = new PostgresCurrentStorage(input, records);
    this.states = disabledStateHistoryPort<I, S>();
    this.events = disabledEventHistoryPort<I>();
  }

  /**
   * Returns whether this Entity handle accepts operations.
   *
   * @returns Whether this handle remains open.
   */
  isOpen(): boolean {
    return this.#open;
  }

  /**
   * Closes the current-record handle and unregisters this Entity handle.
   */
  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.records.close();
    this.states.close();
    this.events.close();
    this.onClose();
  }
}

class PostgresCurrentStorage<I, S extends Message> implements EntityRecordStorage<I> {
  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: RecordStorage<I, EntityRecord>,
  ) {}

  read(id: I): Promise<EntityRecord | undefined> {
    return this.records.read(id);
  }

  write(record: EntityRecord): Promise<void> {
    return this.records.write(record);
  }

  async query(
    plan: NormalizedQueryPlan<I>,
  ): Promise<readonly NormalizedQueryEntry<I, EntityRecord>[]> {
    const entries = await this.records.queryPlanEntries(plan);
    return entries.map((entry) => ({
      id: entry.id,
      record: entry.record,
      columns: new Map(
        this.input.columns.map((column) => [column.name, column.valueIn(entry.record)]),
      ),
    }));
  }
}
