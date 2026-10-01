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
import type { Event } from "@spine-event-engine/proto";

import type { EntityRecord } from "../entity/entity-record.js";
import type { StorageContext } from "../storage/storage.js";
import type { EntityStorageInput } from "./entity-history.js";
import type { StorageFactory } from "../storage/storage-factory.js";

/**
 * Describes one coordinated provider mutation for an Entity commit.
 *
 * This provider-only contract combines current state, retained histories, and
 * framework delivery events. Memory and transactional database providers apply
 * the changes atomically. MyISAM and Aria tables can retain partial writes.
 * This contract is not an application-level transaction API.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 */
export interface EntityCommitInput<I, S extends Message> {
  // prettier-ignore

  /**
   * Identifies the storage scope for this commit.
   */
  readonly context: StorageContext;

  /**
   * Defines the Entity storage layout mutated by this commit.
   */
  readonly entity: EntityStorageInput<I, S>;

  /**
   * Identifies the Entity record being changed.
   */
  readonly entityId: I;

  /**
   * Stores the next current record.
   */
  readonly next: EntityRecord;

  /**
   * Appends retained Entity state-history rows.
   */
  readonly states?: readonly EntityRecord[];

  /**
   * Appends retained diagnostic Entity-event rows.
   */
  readonly diagnostics?: readonly Event[];

  /**
   * Appends canonical framework delivery events.
   */
  readonly events?: readonly Event[];
}

/**
 * A provider handle for coordinated changes to one bounded Entity scope.
 *
 * Memory and transactional database providers apply each commit atomically.
 * MyISAM and Aria tables can retain partial writes if a commit fails.
 */
export interface EntityCommitStorage {
  // prettier-ignore

  /**
   * Applies one Entity mutation across its current, history, and delivery records.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state message type.
   * @param input Defines the unit of Entity, history, and delivery-event work.
   * @returns Resolves when the Entity mutation completes.
   */
  commit<I, S extends Message>(input: EntityCommitInput<I, S>): Promise<void>;

  /**
   * Closes this independent commit handle.
   */
  close(): void;
}

/**
 * Defines the provider-only storage-factory capability required by repositories.
 */
export interface EntityCommitStorageFactory {
  // prettier-ignore

  /**
   * Creates a handle that coordinates Entity persistence changes for one provider.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state message type.
   * @param input Identifies the Entity storage layout the handle may commit.
   * @returns The independently closeable provider commit handle.
   */
  createEntityCommitStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): EntityCommitStorage;
}

/**
 * The framework-only access point for provider commit factories.
 */
interface EntityCommitFactoryAccess {
  // prettier-ignore

  /**
   * Registers the Entity commit capability of one storage factory.
   *
   * @param factory Identifies the storage factory that provides the capability.
   * @param creator Creates coordinated commit handles for that provider.
   */
  register(factory: StorageFactory, creator: EntityCommitStorageFactory): void;

  /**
   * Creates a commit handle registered by a storage provider.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state message type.
   * @param factory Identifies the provider storage factory.
   * @param input Defines the Entity storage layout to commit.
   * @returns The provider commit handle.
   */
  create<I, S extends Message>(
    factory: StorageFactory,
    input: EntityStorageInput<I, S>,
  ): EntityCommitStorage;
}

/**
 * Provides the typed internal lookup for provider-managed atomic commit handles.
 *
 * Provider adapters register their creator while constructing their factory;
 * the end-user storage root deliberately exposes no commit-construction method.
 */
export const EntityCommitStorageFactories: EntityCommitFactoryAccess = Object.freeze({
  register(factory: StorageFactory, creator: EntityCommitStorageFactory): void {
    creators.set(factory, creator);
  },

  /**
   * Creates the registered provider's Entity commit handle.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state message type.
   * @param factory Identifies the registered provider.
   * @param input Defines the Entity scope.
   * @returns The provider commit handle.
   */
  create<I, S extends Message>(
    factory: StorageFactory,
    input: EntityStorageInput<I, S>,
  ): EntityCommitStorage {
    const creator = creators.get(factory);
    if (creator === undefined)
      throw new Error("StorageFactory does not provide the required atomic Entity commit storage.");
    return creator.createEntityCommitStorage(input);
  },
});

const creators = new WeakMap<StorageFactory, EntityCommitStorageFactory>();
