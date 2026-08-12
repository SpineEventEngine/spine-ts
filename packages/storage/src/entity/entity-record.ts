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

import type { EntityRecord } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
export type { EntityRecord } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import type { NormalizedQueryEntry } from "../query/query-execution.js";
import type { NormalizedQueryPlan } from "../query/query-policy.js";

/**
 * Internal latest-state persistence port for one Entity identifier type.
 */
export interface EntityRecordStorage<I> {
  // prettier-ignore

  /**
   * Reads the latest JVM EntityRecord for an entity ID.
   *
   * @param id The entity ID to read.
   * @returns The current EntityRecord, when present.
   */
  read(id: I): Promise<EntityRecord | undefined>;

  /**
   * Writes one JVM EntityRecord envelope.
   *
   * @param record The EntityRecord to persist.
   * @returns A promise that resolves once the record is persisted.
   */
  write(record: EntityRecord): Promise<void>;

  /**
   * Reads normalized current records with provider materialized columns.
   *
   * @param plan The normalized current-record query plan.
   * @returns Matching records and materialized columns.
   */
  query(plan: NormalizedQueryPlan<I>): Promise<readonly NormalizedQueryEntry<I, EntityRecord>[]>;
}
