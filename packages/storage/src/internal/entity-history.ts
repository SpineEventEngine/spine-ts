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

/**
 * Provider-only entity persistence SPI. This subpath is intentionally not part
 * of the end-user storage root; storage adapters import it directly.
 */
export type {
  EntityEventHistoryPort,
  EntityStateHistoryPort,
} from "../entity/entity-history-storage.js";
export {
  disabledEventHistoryPort,
  disabledStateHistoryPort,
} from "../entity/entity-history-storage.js";
export type { EntityRecord, EntityRecordStorage } from "../entity/entity-record.js";
export { eventHistorySpec, stateHistorySpec } from "../entity/entity-history-record-spec.js";
export {
  EntityHistoryConformance,
  type EntityHistoryConformanceAdapter,
  type EntityStorageConformance,
} from "../entity/history-conformance.js";
export type { EntityIdCodec, EntityStorageInput } from "../memory/in-memory-entity-history.js";
export type {
  EntityCommitInput,
  EntityCommitResult,
  EntityCommitStorage,
  EntityCommitStorageFactory,
} from "./entity-commit.js";
