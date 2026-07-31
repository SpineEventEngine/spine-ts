import type { Message } from "@bufbuild/protobuf";
import type { NormalizedQueryEntry } from "../query/query-execution.js";
import type { NormalizedQueryPlan } from "../query/query-policy.js";

/**
 * Durable latest-state representation shared by all entity kinds.
 */
export interface EntityRecord<I, S extends Message> {
  // prettier-ignore

  /**
   * Identifies the entity represented by the stored row.
   */
  readonly id: I;

  /**
   * Carries the latest entity state.
   */
  readonly state: S;

  /**
   * Records the version associated with the state.
   */
  readonly version: bigint;

  /**
   * Indicates whether the entity is archived.
   */
  readonly archived: boolean;

  /**
   * Indicates whether the entity is deleted.
   */
  readonly deleted: boolean;
}

/**
 * Internal latest-state persistence port shared by entity kinds.
 */
export interface EntityRecordStorage<I, S extends Message> {
  // prettier-ignore

  /**
   * Reads the latest record for an entity ID.
   *
   * @param id Identifies the entity to read.
   * @returns Resolves to the stored record when it exists.
   */
  read(id: I): Promise<EntityRecord<I, S> | undefined>;

  /**
   * Writes the latest record for an entity.
   *
   * @param record Supplies the record to store.
   * @returns Completes when the record is stored.
   */
  write(record: EntityRecord<I, S>): Promise<void>;

  /**
   * Reads normalized latest-state records.
   *
   * @param plan Specifies the normalized query plan.
   * @returns Resolves to matching materialized records.
   */
  query(
    plan: NormalizedQueryPlan<I>,
  ): Promise<readonly NormalizedQueryEntry<I, EntityRecord<I, S>>[]>;
}

/**
 * Closed physical purposes used when deriving entity storage keys.
 */
export type EntityRecordPurpose = "current" | "state-history" | "event-history";

/**
 * Provides stable storage-key derivation for entity records.
 */
export const EntityStorageKey: Readonly<{
  of(stateType: string, purpose: EntityRecordPurpose): string;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Derives a stable storage key for an entity state type and record purpose.
   *
   * @param stateType Names the entity state type.
   * @param purpose Selects the physical record purpose.
   * @returns Returns the stable storage key.
   */
  of(stateType: string, purpose: EntityRecordPurpose): string {
    return `${stateType}:${purpose}`;
  },
});
