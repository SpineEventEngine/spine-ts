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

import type { Message } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Event } from "@spine-event-engine/proto";
import type { EntityRecord } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";

/**
 * Represents application-managed maintenance for retained entity state history.
 */
declare const entityStateHistoryState: unique symbol;
declare const entityEventHistoryEntity: unique symbol;

/**
 * Defines retention maintenance for one entity state history.
 */
export interface EntityStateHistoryStorage<I, S extends Message> {
  // prettier-ignore

  /**
   * Brands the storage with its retained state type.
   */
  readonly [entityStateHistoryState]?: S;

  /**
   * Updates retained versioned states for one entity.
   * @param entityId The entity whose history is trimmed.
   * @param keepMostRecent The number of newest states to keep.
   * @returns Completes when maintenance finishes.
   */
  trim(entityId: I, keepMostRecent: number): Promise<void>;

  /**
   * Removes states created strictly before the supplied time.
   * @param olderThan The exclusive retention cutoff.
   * @returns Completes when maintenance finishes.
   */
  truncate(olderThan: Timestamp): Promise<void>;
}

/**
 * Application-managed maintenance for retained diagnostic entity events.
 */
export interface EntityEventStorage<I> {
  // prettier-ignore

  /**
   * Brands the storage with its retained entity identifier type.
   */
  readonly [entityEventHistoryEntity]?: I;

  /**
   * Removes events created strictly before the supplied time.
   * @param olderThan The exclusive retention cutoff.
   * @returns Completes when maintenance finishes.
   */
  truncate(olderThan: Timestamp): Promise<void>;
}

/**
 * Internal state-history read and append seam used by repository implementations.
 */
export interface EntityStateHistoryPort<I, S extends Message> extends EntityStateHistoryStorage<
  I,
  S
> {
  // prettier-ignore

  /**
   * Stores one versioned state-history record.
   * @param record The state-history record to append.
   * @returns Completes when the record is stored.
   */
  append(record: EntityRecord): Promise<void>;

  /**
   * Reads versioned states backward from an optional version.
   * @param entityId The entity whose history is read.
   * @param depth The maximum number of records to return.
   * @param startingFromVersion The inclusive version at which to start.
   * @returns The matching history records in reverse version order.
   */
  backward(
    entityId: I,
    depth: number,
    startingFromVersion?: bigint,
  ): Promise<readonly EntityRecord[]>;

  /**
   * Reads the state current at a specific time.
   * @param entityId The entity whose state is read.
   * @param time The point in time to inspect.
   * @returns The state at that time, if retained.
   */
  stateAt(entityId: I, time: Timestamp): Promise<S | undefined>;

  /**
   * Closes the state-history storage.
   */
  close(): void;
}

/**
 * Internal diagnostic event-history read and append seam used by repositories.
 */
export interface EntityEventHistoryPort<I> extends EntityEventStorage<I> {
  // prettier-ignore

  /**
   * Stores one diagnostic event-history record.
   * @param record The event-history record to append.
   * @returns Completes when the record is stored.
   */
  append(record: Event): Promise<void>;

  /**
   * Reads diagnostic events backward from an optional version.
   * @param entityId The entity whose events are read.
   * @param depth The maximum number of events to return.
   * @param startingFromVersion The inclusive version at which to start.
   * @returns The matching events in reverse version order.
   */
  backward(entityId: I, depth: number, startingFromVersion?: bigint): Promise<readonly Event[]>;

  /**
   * Closes the event-history storage.
   */
  close(): void;
}

/**
 * Creates a history port that deliberately allocates no backing storage.
 * @returns The disabled state-history port.
 */
export function disabledStateHistoryPort<I, S extends Message>(): EntityStateHistoryPort<I, S> {
  return {
    append: () => Promise.reject(new Error("Entity state history is disabled.")),
    backward: () => Promise.resolve(Object.freeze([])),
    stateAt: () => Promise.resolve(undefined),
    trim: () => Promise.resolve(),
    truncate: () => Promise.resolve(),
    close: () => undefined,
  };
}

/**
 * Creates a diagnostic event-history port that deliberately allocates no backing storage.
 * @returns The disabled event-history port.
 */
export function disabledEventHistoryPort<I>(): EntityEventHistoryPort<I> {
  return {
    append: () => Promise.reject(new Error("Entity event history is disabled.")),
    backward: () => Promise.resolve(Object.freeze([])),
    truncate: () => Promise.resolve(),
    close: () => undefined,
  };
}
