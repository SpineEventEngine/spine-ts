import type { Message } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Event } from "@spine-event-engine/proto";

/** Represents application-managed maintenance for retained entity state history. */
declare const entityStateHistoryState: unique symbol;
declare const entityEventHistoryEntity: unique symbol;

/** Defines retention maintenance for one entity state history. */
export interface EntityStateHistoryStorage<I, S extends Message> {
  /** Brands the storage with its retained state type. */
  readonly [entityStateHistoryState]?: S;
  /** Updates retained versioned states for one entity.
   * @param entityId The entity whose history is trimmed.
   * @param keepMostRecent The number of newest states to keep.
   */
  trim(entityId: I, keepMostRecent: number): Promise<void>;
  /** Removes states created strictly before the supplied time.
   * @param olderThan The exclusive retention cutoff.
   */
  truncate(olderThan: Timestamp): Promise<void>;
}

/** Application-managed maintenance for retained diagnostic entity events. */
export interface EntityEventStorage<I> {
  /** Brands the storage with its retained entity identifier type. */
  readonly [entityEventHistoryEntity]?: I;
  /** Removes events created strictly before the supplied time.
   * @param olderThan The exclusive retention cutoff.
   */
  truncate(olderThan: Timestamp): Promise<void>;
}

/** Internal state-history read and append seam used by repository implementations. */
export interface EntityStateHistoryPort<I, S extends Message> extends EntityStateHistoryStorage<
  I,
  S
> {
  /** Stores one versioned state-history record.
   * @param record The state-history record to append.
   */
  append(record: EntityStateHistoryRecord<I, S>): Promise<void>;
  /** Reads versioned states backward from an optional version.
   * @param entityId The entity whose history is read.
   * @param depth The maximum number of records to return.
   * @param startingFromVersion The inclusive version at which to start.
   * @returns The matching history records in reverse version order.
   */
  backward(
    entityId: I,
    depth: number,
    startingFromVersion?: bigint,
  ): Promise<readonly EntityStateHistoryRecord<I, S>[]>;
  /** Reads the state current at a specific time.
   * @param entityId The entity whose state is read.
   * @param time The point in time to inspect.
   * @returns The state at that time, if retained.
   */
  stateAt(entityId: I, time: Timestamp): Promise<S | undefined>;
}

/** Internal diagnostic event-history read and append seam used by repositories. */
export interface EntityEventHistoryPort<I> extends EntityEventStorage<I> {
  /** Stores one diagnostic event-history record.
   * @param record The event-history record to append.
   */
  append(record: EntityEventHistoryRecord<I>): Promise<void>;
  /** Reads diagnostic events backward from an optional version.
   * @param entityId The entity whose events are read.
   * @param depth The maximum number of events to return.
   * @param startingFromVersion The inclusive version at which to start.
   * @returns The matching events in reverse version order.
   */
  backward(entityId: I, depth: number, startingFromVersion?: bigint): Promise<readonly Event[]>;
}

/** Immutable versioned state-history row. */
export interface EntityStateHistoryRecord<I, S extends Message> {
  /** Identifies the entity that owns this state record. */
  readonly entityId: I;
  /** Holds the recorded entity state. */
  readonly state: S;
  /** Holds the entity version represented by this record. */
  readonly version: bigint;
  /** Records when this state was stored. */
  readonly createdAt: Timestamp;
}

/** Immutable diagnostic event-history row correlated to its producing entity. */
export interface EntityEventHistoryRecord<I> {
  /** Identifies the entity that produced this event. */
  readonly entityId: I;
  /** Holds the recorded diagnostic event. */
  readonly event: Event;
  /** Holds the producing entity version. */
  readonly producerVersion: bigint;
  /** Records when this event was stored. */
  readonly createdAt: Timestamp;
}
