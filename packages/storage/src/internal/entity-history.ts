/**
 * Provider-only entity persistence SPI. This subpath is intentionally not part
 * of the end-user storage root; T-0070D/R adapters import it directly.
 */
export type {
  EntityEventHistoryPort,
  EntityEventHistoryRecord,
  EntityStateHistoryPort,
  EntityStateHistoryRecord,
} from "../entity/entity-history-storage.js";
export type {
  EntityRecord,
  EntityRecordStorage,
  EntityRecordPurpose,
} from "../entity/entity-record.js";
export { EntityStorageKey } from "../entity/entity-record.js";
export {
  EntityHistoryConformance,
  type EntityHistoryConformanceAdapter,
  type EntityStorageConformance,
} from "../entity/history-conformance.js";
export type { EntityIdCodec, EntityStorageInput } from "../memory/in-memory-entity-history.js";
