import type { Message } from "@bufbuild/protobuf";
import type { NormalizedQueryEntry } from "../query/query-execution.js";
import type { NormalizedQueryPlan } from "../query/query-policy.js";

/** Durable latest-state representation shared by all entity kinds. */
export interface EntityRecord<I, S extends Message> {
  readonly id: I;
  readonly state: S;
  readonly version: bigint;
  readonly archived: boolean;
  readonly deleted: boolean;
}

/** Internal latest-state persistence port shared by entity kinds. */
export interface EntityRecordStorage<I, S extends Message> {
  read(id: I): Promise<EntityRecord<I, S> | undefined>;
  write(record: EntityRecord<I, S>): Promise<void>;
  query(
    plan: NormalizedQueryPlan<I>,
  ): Promise<readonly NormalizedQueryEntry<I, EntityRecord<I, S>>[]>;
}

/** Closed physical purposes used when deriving entity storage keys. */
export type EntityRecordPurpose = "current" | "state-history" | "event-history";

/** Derives the stable storage key for one entity state type and record purpose. */
export function entityStorageKey(stateType: string, purpose: EntityRecordPurpose): string {
  return `${stateType}:${purpose}`;
}
