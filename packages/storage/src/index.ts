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

export {
  EventStore,
  type EventRollback,
  type EventStoreContext,
  type OnEventAccepted,
} from "./event/event-store.js";
export type {
  EntityEventStorage,
  EntityStateHistoryStorage,
} from "./entity/entity-history-storage.js";
export { InMemoryRecordStorage } from "./memory/in-memory-record-storage.js";
export { InMemoryStorageBackend } from "./memory/in-memory-storage-backend.js";
export { InMemoryStorageFactory } from "./memory/in-memory-storage-factory.js";
export { StorageQueryPolicy } from "./query/query-policy.js";
export {
  defaultQueryCandidateLimit,
  QueryCandidateLimitError,
  StorageQueryEvaluator,
} from "./query/query-execution.js";
export type { NormalizedQueryEntry } from "./query/query-execution.js";
export type {
  NormalizedComparisonOperator,
  NormalizedQueryMask,
  NormalizedQueryOrder,
  NormalizedQueryPlan,
  NormalizedQueryPredicate,
  StorageQueryCapabilities,
  StorageQueryFeature,
} from "./query/query-policy.js";
export { RecordColumn } from "./record/record-column.js";
export { ColumnTypes, type RecordColumnType } from "./record/column-type.js";
export {
  ColumnMappings,
  type ColumnMapping,
  type ColumnTypeMapping,
} from "./record/column-mapping.js";
export { RecordMask } from "./record/record-mask.js";
export type {
  RecordContinuation,
  RecordContinuationValue,
  RecordFilter,
  RecordOrder,
  RecordReadOptions,
} from "./record/record-query.js";
export { RecordQuery } from "./record/record-query.js";
export { RecordSpec, type RecordSpecOptions } from "./record/record-spec.js";
export { RecordStorage } from "./record/record-storage.js";
export { StorageGroup } from "./record/storage-group.js";
export type { RecordEntry } from "./record/record-storage.js";
export type { Storage, StorageContext, StorageMode } from "./storage/storage.js";
export { StorageFactory } from "./storage/storage-factory.js";
export {
  TenantBoundary,
  type TenantCatalog,
  type TenantCatalogProvider,
} from "./internal/tenancy.js";
