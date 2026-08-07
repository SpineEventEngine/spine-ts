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

/**
 * Closed physical purposes used when deriving entity storage keys.
 */
export type EntityRecordPurpose = "current" | "state-history" | "event-history";

/**
 * Provides stable storage-key derivation for entity records.
 */
export const EntityStorageKey: Readonly<{
  // prettier-ignore

  /**
   * Creates a stable physical storage key for an Entity state type and purpose.
   *
   * @param stateType Fully qualified generated Entity state type name.
   * @param purpose Closed Entity-record storage purpose.
   * @returns The stable physical storage key.
   */
  of(stateType: string, purpose: EntityRecordPurpose): string;
}> = Object.freeze({
  of(stateType: string, purpose: EntityRecordPurpose): string {
    return `${stateType}:${purpose}`;
  },
});
