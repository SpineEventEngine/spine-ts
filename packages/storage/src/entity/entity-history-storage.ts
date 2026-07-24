import type { Message } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Event } from "@spine-event-engine/proto";

/** Application-managed maintenance for retained entity state history. */
declare const entityStateHistoryState: unique symbol;
declare const entityEventHistoryEntity: unique symbol;

export interface EntityStateHistoryStorage<I, S extends Message> {
  readonly [entityStateHistoryState]?: S;
  /** Retain the most recent versioned states for one entity. */
  trim(entityId: I, keepMostRecent: number): Promise<void>;
  /** Remove states created strictly before the supplied time. */
  truncate(olderThan: Timestamp): Promise<void>;
}

/** Application-managed maintenance for retained diagnostic entity events. */
export interface EntityEventStorage<I> {
  readonly [entityEventHistoryEntity]?: I;
  /** Remove events created strictly before the supplied time. */
  truncate(olderThan: Timestamp): Promise<void>;
}

/** Internal state-history read and append seam used by repository implementations. */
export interface EntityStateHistoryPort<I, S extends Message> extends EntityStateHistoryStorage<
  I,
  S
> {
  append(record: EntityStateHistoryRecord<I, S>): Promise<void>;
  backward(
    entityId: I,
    depth: number,
    startingFromVersion?: bigint,
  ): Promise<readonly EntityStateHistoryRecord<I, S>[]>;
  stateAt(entityId: I, time: Timestamp): Promise<S | undefined>;
}

/** Internal diagnostic event-history read and append seam used by repositories. */
export interface EntityEventHistoryPort<I> extends EntityEventStorage<I> {
  append(record: EntityEventHistoryRecord<I>): Promise<void>;
  backward(entityId: I, depth: number, startingFromVersion?: bigint): Promise<readonly Event[]>;
}

/** Immutable versioned state-history row. */
export interface EntityStateHistoryRecord<I, S extends Message> {
  readonly entityId: I;
  readonly state: S;
  readonly version: bigint;
  readonly createdAt: Timestamp;
}

/** Immutable diagnostic event-history row correlated to its producing entity. */
export interface EntityEventHistoryRecord<I> {
  readonly entityId: I;
  readonly event: Event;
  readonly producerVersion: bigint;
  readonly createdAt: Timestamp;
}
