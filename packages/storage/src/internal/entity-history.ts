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
export {
  entityEventHistoryRecordSpec,
  entityStateHistoryRecordSpec,
} from "../entity/entity-history-record-spec.js";
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
