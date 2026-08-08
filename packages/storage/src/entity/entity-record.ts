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
